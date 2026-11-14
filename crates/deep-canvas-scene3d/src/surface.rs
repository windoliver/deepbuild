//! The trusted builder `surface` (canvas primitives: Builder `surface`: surfaces from a formula,
//! implicit surfaces and grid lines; issue #224).
//!
//! From a formula, x, y and z over (u, v) are sampled on a grid of u knots and v knots, so there
//! are no T-junctions: each pass bounds the cells by the expressions' interval forms over a 4 × 4
//! cover, and a cell whose bound leaves its bilinear patch by more than `tolerance` flags its u
//! span and its v span, which halve, up to `max` knots a side. Ends that meet within 1e-6 m, and
//! an end that collapses to one point (a sphere's pole), weld. A non-finite sample drops the
//! cells at it, and the hull of the dropped (u, v) is the output `surface.nonfinite`. Grid lines
//! fall at whole multiples of their step, which are knots, so each runs along mesh edges.
//!
//! Implicit (`zero`), the box is an octree's root, refined a level at a time in Morton order: a
//! cell whose interval bound excludes 0 is dropped and every other splits, until its diagonal is
//! at most `tolerance`, or until the next level would keep more than `max_cells`, which stops at
//! the level before and writes the output `surface.coarse`. Surface nets put one vertex in each
//! kept cell with a sign change on an edge, at the mean of its edges' secant crossings, and join
//! the four cells around each crossed edge by a quad wound toward positive values. A level's
//! cells run in fixed blocks, joined in block order, so the mesh is the same for any thread count.
//!
//! Formulas read only their free names and their vars, which the frame has bound to numbers
//! ([`crate::vars`]), in pinned f64 math, so a build is a pure function of its params.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
use deep_canvas::document::Issue;
use deep_canvas::expr::{Expr, Nothing};
use deep_canvas::interval::Iv;
use deep_canvas::schedule::Pool;
use deep_canvas_marks::function::ramp_at;
use serde_json::{json, Map, Value};

use crate::geom::{add, cross, length, scale, sub, unit, EdgeKind, Mesh, V3};
use crate::look::Look3;
use crate::scene::{Affine3, EdgesOf, Line, Refused};

/// The builder cap: the most vertices one `surface` makes.
pub const CAP: u64 = 262_144;
/// The most nodes an expression takes once its sums expand.
const NODES: usize = 512;
/// The pieces a cell's side is cut into for its bound.
const COVER: usize = 4;
/// Points closer than this are one.
const WELD: f64 = 1e-6;
/// The fixed blocks a level's cells run in.
const BLOCKS: usize = 64;

/// The wrong programs #224's criteria plant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// Grid lines counted in steps from the range's start, not at whole multiples.
    LinesFromStart,
    /// The implicit mesher numbers vertices in the order its threads finish their blocks.
    NumberedByThread,
    /// The implicit mesher drops every cell whose corners share a sign.
    CornerSigns,
    /// The implicit mesher stops part way through a level at the cap.
    StopsMidLevel,
    /// The build keeps its first mesh: its vars stay as they were at t = 0 ([`crate::vars`]).
    KeepsFirst,
}

/// The planted build that keeps its first mesh: [`crate::vars`] binds its vars at t = 0.
pub const KEEPS_FIRST: &str = "zero_keeps_first_mesh";

/// #224's plants, which scene3d's `PLANTED` lists.
pub const PLANTS: [&str; 5] = [
    "grid_lines_from_start",
    "nets_number_by_thread",
    "octree_drops_same_sign",
    "octree_stops_mid_level",
    KEEPS_FIRST,
];

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "grid_lines_from_start" => Planted::LinesFromStart,
            "nets_number_by_thread" => Planted::NumberedByThread,
            "octree_drops_same_sign" => Planted::CornerSigns,
            "octree_stops_mid_level" => Planted::StopsMidLevel,
            KEEPS_FIRST => Planted::KeepsFirst,
            _ => return None,
        })
    }
}

type Fault = String;

fn bad(path: &str) -> Fault {
    format!("params/{path}")
}

/// One expression with its free names and its vars bound to numbers.
pub(crate) struct F {
    expr: Expr,
    slots: Vec<Slot>,
}

#[derive(Clone, Copy)]
enum Slot {
    Free(usize),
    Fixed(f64),
}

impl F {
    pub(crate) fn compile(
        text: Option<&Value>,
        free: &[&str],
        vars: &Map<String, Value>,
        field: &str,
    ) -> Result<F, Fault> {
        let text = text.and_then(Value::as_str).ok_or_else(|| bad(field))?;
        let expr = Expr::compile(text, &Nothing, NODES).map_err(|_| bad(field))?;
        let slots = expr
            .vars
            .iter()
            .map(|n| match free.iter().position(|f| f == n) {
                Some(i) => Ok(Slot::Free(i)),
                None => vars
                    .get(n)
                    .and_then(Value::as_f64)
                    .map(Slot::Fixed)
                    .ok_or_else(|| bad(field)),
            })
            .collect::<Result<_, _>>()?;
        Ok(F { expr, slots })
    }

    pub(crate) fn at(&self, free: &[f64]) -> f64 {
        let mut few = [0.0; 16];
        let mut many = Vec::new();
        let vars: &mut [f64] = if self.slots.len() <= few.len() {
            &mut few[..self.slots.len()]
        } else {
            many.resize(self.slots.len(), 0.0);
            &mut many
        };
        for (x, s) in vars.iter_mut().zip(&self.slots) {
            *x = match s {
                Slot::Free(i) => free[*i],
                Slot::Fixed(v) => *v,
            };
        }
        self.expr.eval_num(vars)
    }

    pub(crate) fn over(&self, free: &[Iv]) -> Iv {
        let vars: Vec<Iv> = self
            .slots
            .iter()
            .map(|s| match s {
                Slot::Free(i) => free[*i],
                Slot::Fixed(v) => Iv::point(*v),
            })
            .collect();
        self.expr.bound_num(&vars)
    }
}

/// The item's vars, each a number once the frame has bound it.
pub(crate) fn vars(p: &Value) -> Result<Map<String, Value>, Fault> {
    match p.get("vars") {
        None => Ok(Map::new()),
        Some(Value::Object(o)) => {
            for (k, v) in o {
                if !v.as_f64().is_some_and(f64::is_finite) {
                    return Err(bad(&format!("vars/{k}")));
                }
            }
            Ok(o.clone())
        }
        Some(_) => Err(bad("vars")),
    }
}

fn range(p: &Value, name: &str) -> Result<[f64; 2], Fault> {
    p.get(name)
        .and_then(Value::as_array)
        .filter(|a| a.len() == 2)
        .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
        .filter(|r| r[0].is_finite() && r[1].is_finite() && r[0] < r[1])
        .ok_or_else(|| bad(name))
}

fn positive(p: &Value, name: &str, default: f64) -> Result<f64, Fault> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad(name)),
    }
}

/// Whether `p` is an implicit surface.
pub fn is_implicit(p: &Value) -> bool {
    p.get("zero").is_some()
}

/// `max` as a pair of knot counts a side.
fn max_of(p: &Value) -> Result<[usize; 2], Fault> {
    match p.get("max") {
        None => Ok([256, 256]),
        Some(v) => v
            .as_array()
            .filter(|a| a.len() == 2)
            .and_then(|a| Some([a[0].as_u64()?, a[1].as_u64()?]))
            .filter(|m| m.iter().all(|n| (2..=u16::MAX as u64).contains(n)))
            .map(|m| [m[0] as usize, m[1] as usize])
            .ok_or_else(|| bad("max")),
    }
}

fn max_cells(p: &Value) -> Result<u64, Fault> {
    match p.get("max_cells") {
        None => Ok(65_536),
        Some(v) => v
            .as_u64()
            .filter(|n| (1..=CAP).contains(n))
            .ok_or_else(|| bad("max_cells")),
    }
}

/// The vertices and triangles a surface declares from its params alone: its grid at `max` (with
/// a checker's duplicated borders), or one vertex a cell at `max_cells`; past the cap, refused,
/// naming the grid.
pub fn counts(p: &Value) -> Result<(u64, u64), Fault> {
    if is_implicit(p) {
        for field in ["fn", "u", "v", "max", "closed", "checker", "grid_lines"] {
            if p.get(field).is_some() {
                return Err(bad(field));
            }
        }
        let n = max_cells(p)?;
        return Ok((n, 6 * n));
    }
    let [mu, mv] = max_of(p)?;
    let cells = checker_cells(p)?.unwrap_or([1, 1]);
    let (nu, nv) = ((mu + cells[0] - 1) as u64, (mv + cells[1] - 1) as u64);
    if nu * nv > CAP {
        return Err(bad("max"));
    }
    Ok((nu * nv, 2 * (mu as u64 - 1) * (mv as u64 - 1)))
}

fn checker_cells(p: &Value) -> Result<Option<[usize; 2]>, Fault> {
    let Some(c) = p.get("checker") else {
        return Ok(None);
    };
    let roles = c
        .get("roles")
        .and_then(Value::as_array)
        .filter(|r| (1..=4).contains(&r.len()));
    roles.ok_or_else(|| bad("checker/roles"))?;
    c.get("cells")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 2)
        .and_then(|a| Some([a[0].as_u64()?, a[1].as_u64()?]))
        .filter(|n| n.iter().all(|k| (1..=u16::MAX as u64).contains(k)))
        .map(|n| Some([n[0] as usize, n[1] as usize]))
        .ok_or_else(|| bad("checker/cells"))
}

/// The surface `p` describes, its vars already numbers, meshed on the host's threads when it
/// lends them.
pub fn built(p: &Value, planted: Planted, pool: Option<(&dyn Pool, usize)>) -> Result<Mesh, Fault> {
    if is_implicit(p) {
        implicit(p, planted, pool)
    } else {
        parametric(p, planted, pool)
    }
}

// ---- from a formula over (u, v)

/// The knots of one direction: sorted values, with how many it may grow to.
struct Knots {
    at: Vec<f64>,
    max: usize,
}

/// The values a direction's mesh must have edges at: its ends, each grid line and each checker
/// boundary.
fn fixed_knots(r: [f64; 2], lines: &[f64], cells: usize) -> Vec<f64> {
    let mut at = vec![r[0], r[1]];
    at.extend(lines.iter().copied());
    at.extend((1..cells).map(|k| r[0] + (r[1] - r[0]) * k as f64 / cells as f64));
    at.sort_by(f64::total_cmp);
    at.dedup_by(|a, b| (*a - *b).abs() <= 1e-12 * (r[1] - r[0]));
    at
}

/// A grid line's values: whole multiples of `step` inside `r`, an end within 1e-9 of one (relative
/// to the step) carrying it; the planted twin counts steps from the range's start.
fn line_values(r: [f64; 2], step: f64, planted: Planted) -> Vec<f64> {
    if planted == Planted::LinesFromStart {
        let n = ((r[1] - r[0]) / step + 1e-9).floor() as i64;
        return (0..=n).map(|k| r[0] + k as f64 * step).collect();
    }
    let first = (r[0] / step - 1e-9).ceil() as i64;
    let last = (r[1] / step + 1e-9).floor() as i64;
    (first..=last)
        .map(|k| {
            let x = k as f64 * step;
            if (x - r[0]).abs() <= 1e-9 * step {
                r[0]
            } else if (x - r[1]).abs() <= 1e-9 * step {
                r[1]
            } else {
                x
            }
        })
        .collect()
}

/// The grid-line steps: u's and v's, each a positive step or none.
fn line_steps(p: &Value) -> Result<[Option<f64>; 2], Fault> {
    let Some(g) = p.get("grid_lines") else {
        return Ok([None, None]);
    };
    let step = |d: &str| -> Result<Option<f64>, Fault> {
        match g.get(d) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) if s == "none" => Ok(None),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x > 0.0)
                .map(Some)
                .ok_or_else(|| bad(&format!("grid_lines/{d}"))),
        }
    };
    Ok([step("u")?, step("v")?])
}

/// Whether an end closes: `true`, `false` or `auto`.
fn closed_of(p: &Value, d: &str) -> Result<Option<bool>, Fault> {
    match p.get("closed") {
        None => Ok(None),
        Some(Value::String(s)) if s == "auto" => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(Value::Object(o)) => match o.get(d) {
            None => Ok(None),
            Some(Value::String(s)) if s == "auto" => Ok(None),
            Some(Value::Bool(b)) => Ok(Some(*b)),
            Some(_) => Err(bad(&format!("closed/{d}"))),
        },
        Some(_) => Err(bad("closed")),
    }
}

/// How far x, y and z over the cell may stray from the cell's bilinear patch: over each piece
/// of a 4 × 4 cover, the bound against the patch's range there; unbounded where a bound is.
fn deviation(f: &[F; 3], u: [f64; 2], v: [f64; 2], corners: [V3; 4]) -> f64 {
    // corners: (u0, v0), (u1, v0), (u0, v1), (u1, v1)
    let patch = |a: f64, b: f64| -> V3 {
        let lerp = |p: V3, q: V3, t: f64| add(p, scale(sub(q, p), t));
        lerp(
            lerp(corners[0], corners[1], a),
            lerp(corners[2], corners[3], a),
            b,
        )
    };
    let at = |r: [f64; 2], k: usize| r[0] + (r[1] - r[0]) * k as f64 / COVER as f64;
    let mut worst: f64 = 0.0;
    for i in 0..COVER {
        for j in 0..COVER {
            let (ua, ub) = (at(u, i), if i + 1 == COVER { u[1] } else { at(u, i + 1) });
            let (va, vb) = (at(v, j), if j + 1 == COVER { v[1] } else { at(v, j + 1) });
            let free = [Iv::new(ua, ub), Iv::new(va, vb)];
            let fa = (i as f64 / COVER as f64, (i + 1) as f64 / COVER as f64);
            let fb = (j as f64 / COVER as f64, (j + 1) as f64 / COVER as f64);
            let pc = [
                patch(fa.0, fb.0),
                patch(fa.1, fb.0),
                patch(fa.0, fb.1),
                patch(fa.1, fb.1),
            ];
            let mut d = [0.0; 3];
            for (axis, fx) in f.iter().enumerate() {
                let b = fx.over(&free);
                if b.is_empty() || !b.is_bounded() {
                    return f64::INFINITY;
                }
                let lo = pc.iter().map(|c| c[axis]).fold(f64::INFINITY, f64::min);
                let hi = pc.iter().map(|c| c[axis]).fold(f64::NEG_INFINITY, f64::max);
                d[axis] = (b.hi - lo).max(hi - b.lo);
            }
            worst = worst.max(length(d));
        }
    }
    worst
}

fn finite(p: V3) -> bool {
    p.iter().all(|x| x.is_finite())
}

/// The grid split until every cell holds within `tol` of its patch, or `max` is reached: each pass
/// flags the spans of the cells that don't, then halves every flagged span it can.
fn refine(f: &[F; 3], ku: &mut Knots, kv: &mut Knots, tol: f64, sample: &Sampler<'_>) -> Vec<V3> {
    let mut pos = sample(&ku.at, &kv.at, None);
    loop {
        let (nu, nv) = (ku.at.len(), kv.at.len());
        let (can_u, can_v) = (nu < ku.max, nv < kv.max);
        if !can_u && !can_v {
            return pos;
        }
        // The spans each pass flags, and how many are still open.
        let mut flags = (vec![!can_u; nu - 1], vec![!can_v; nv - 1]);
        let mut open = if can_u { nu - 1 } else { 0 } + if can_v { nv - 1 } else { 0 };
        let test = |i: usize, j: usize, flags: &mut (Vec<bool>, Vec<bool>), open: &mut usize| {
            if flags.0[i] && flags.1[j] {
                return;
            }
            let c = [
                pos[i * nv + j],
                pos[(i + 1) * nv + j],
                pos[i * nv + j + 1],
                pos[(i + 1) * nv + j + 1],
            ];
            let settled = c.iter().all(|p| finite(*p)) && {
                // A cell whose corners alone span more than the cover could settle can't: its spans
                // flag without bounds, which only adds knots.
                let spread = (0..3)
                    .map(|a| {
                        let lo = c.iter().map(|p| p[a]).fold(f64::INFINITY, f64::min);
                        let hi = c.iter().map(|p| p[a]).fold(f64::NEG_INFINITY, f64::max);
                        hi - lo
                    })
                    .fold(0.0, f64::max);
                spread <= 2.0 * COVER as f64 * tol
                    && deviation(f, [ku.at[i], ku.at[i + 1]], [kv.at[j], kv.at[j + 1]], c) <= tol
            };
            if !settled {
                for flag in [&mut flags.0[i], &mut flags.1[j]] {
                    if !*flag {
                        *flag = true;
                        *open -= 1;
                    }
                }
            }
        };
        // The diagonal first, which meets every span; then every cell with a span still open.
        let m = (nu - 1).max(nv - 1);
        for k in 0..m {
            test(k * (nu - 1) / m, k * (nv - 1) / m, &mut flags, &mut open);
        }
        'cells: for i in 0..nu - 1 {
            for j in 0..nv - 1 {
                if open == 0 {
                    break 'cells;
                }
                test(i, j, &mut flags, &mut open);
            }
        }
        let (flag_u, flag_v) = flags;
        let split = |k: &mut Knots, flags: &[bool], can: bool| -> bool {
            if !can {
                return false;
            }
            let mut spans: Vec<usize> = (0..flags.len()).filter(|s| flags[*s]).collect();
            spans.sort_by(|a, b| {
                (k.at[*b + 1] - k.at[*b])
                    .total_cmp(&(k.at[*a + 1] - k.at[*a]))
                    .then(a.cmp(b))
            });
            spans.truncate(k.max - k.at.len());
            let mids: Vec<f64> = spans
                .iter()
                .map(|s| 0.5 * (k.at[*s] + k.at[*s + 1]))
                .filter(|m| k.at.iter().all(|x| x != m))
                .collect();
            k.at.extend(&mids);
            k.at.sort_by(f64::total_cmp);
            !mids.is_empty()
        };
        let (old_u, old_v) = (ku.at.clone(), kv.at.clone());
        let a = split(ku, &flag_u, can_u);
        let b = split(kv, &flag_v, can_v);
        if !a && !b {
            return pos;
        }
        pos = sample(&ku.at, &kv.at, Some((&old_u, &old_v, &pos)));
    }
}

/// Samples a grid of u knots by v knots, row by row, copying the points an earlier grid already
/// has.
type Sampler<'a> = dyn Fn(&[f64], &[f64], Option<(&[f64], &[f64], &[V3])>) -> Vec<V3> + 'a;

/// x, y and z at each knot pair, rows in fixed blocks on the host's threads, joined in order.
fn sampled(
    f: &[F; 3],
    us: &[f64],
    vs: &[f64],
    old: Option<(&[f64], &[f64], &[V3])>,
    pool: Option<(&dyn Pool, usize)>,
) -> Vec<V3> {
    let find = |list: &[f64], x: f64| list.binary_search_by(|y| y.total_cmp(&x)).ok();
    let (oi, oj): (Vec<Option<usize>>, Vec<Option<usize>>) = match old {
        Some((ou, ov, _)) => (
            us.iter().map(|u| find(ou, *u)).collect(),
            vs.iter().map(|v| find(ov, *v)).collect(),
        ),
        None => (vec![None; us.len()], vec![None; vs.len()]),
    };
    let ov = old.map_or(0, |o| o.1.len());
    let rows = us.len().div_ceil(BLOCKS).max(1);
    let n = us.len().div_ceil(rows);
    let (parts, _) = blocks(n, pool, &|b| {
        let mut out = Vec::with_capacity(rows * vs.len());
        for i in b * rows..((b + 1) * rows).min(us.len()) {
            for (j, &v) in vs.iter().enumerate() {
                out.push(match (oi[i], oj[j], old) {
                    (Some(a), Some(c), Some((_, _, p))) => p[a * ov + c],
                    _ => {
                        let at = [us[i], v];
                        [f[0].at(&at), f[1].at(&at), f[2].at(&at)]
                    }
                });
            }
        }
        out
    });
    parts.concat()
}

fn parametric(
    p: &Value,
    planted: Planted,
    pool: Option<(&dyn Pool, usize)>,
) -> Result<Mesh, Fault> {
    let vars = vars(p)?;
    let fx = p
        .get("fn")
        .filter(|f| f.is_object())
        .ok_or_else(|| bad("fn"))?;
    let f = [
        F::compile(fx.get("x"), &["u", "v"], &vars, "fn/x")?,
        F::compile(fx.get("y"), &["u", "v"], &vars, "fn/y")?,
        F::compile(fx.get("z"), &["u", "v"], &vars, "fn/z")?,
    ];
    let (ru, rv) = (range(p, "u")?, range(p, "v")?);
    let tol = positive(p, "tolerance", 0.002)?;
    let max = max_of(p)?;
    counts(p)?;
    let steps = line_steps(p)?;
    let cells = checker_cells(p)?;
    let lines = [
        steps[0]
            .map(|s| line_values(ru, s, planted))
            .unwrap_or_default(),
        steps[1]
            .map(|s| line_values(rv, s, planted))
            .unwrap_or_default(),
    ];
    let cu = cells.map_or(1, |c| c[0]);
    let cv = cells.map_or(1, |c| c[1]);
    let mut ku = Knots {
        at: fixed_knots(ru, &lines[0], cu),
        max: max[0],
    };
    let mut kv = Knots {
        at: fixed_knots(rv, &lines[1], cv),
        max: max[1],
    };
    if ku.at.len() > max[0] {
        return Err(bad(if steps[0].is_some() {
            "grid_lines/u"
        } else {
            "checker/cells"
        }));
    }
    if kv.at.len() > max[1] {
        return Err(bad(if steps[1].is_some() {
            "grid_lines/v"
        } else {
            "checker/cells"
        }));
    }
    let sample = |us: &[f64], vs: &[f64], old: Option<(&[f64], &[f64], &[V3])>| {
        sampled(&f, us, vs, old, pool)
    };
    let pos = refine(&f, &mut ku, &mut kv, tol, &sample);
    let (us, vs) = (ku.at, kv.at);
    let (nu, nv) = (us.len(), vs.len());
    let at = |i: usize, j: usize| pos[i * nv + j];

    // Which ends meet: every finite pair across the end within the weld distance.
    let meets = |a: &dyn Fn(usize) -> V3, b: &dyn Fn(usize) -> V3, n: usize| {
        let pairs: Vec<(V3, V3)> = (0..n)
            .map(|k| (a(k), b(k)))
            .filter(|(x, y)| finite(*x) && finite(*y))
            .collect();
        !pairs.is_empty() && pairs.iter().all(|(x, y)| length(sub(*x, *y)) <= WELD)
    };
    let close_u =
        closed_of(p, "u")?.unwrap_or_else(|| meets(&|j| at(0, j), &|j| at(nu - 1, j), nv));
    let close_v =
        closed_of(p, "v")?.unwrap_or_else(|| meets(&|i| at(i, 0), &|i| at(i, nv - 1), nu));
    // An end whose finite points are all one point (a pole) is one vertex.
    let collapsed = |pts: Vec<V3>| {
        let pts: Vec<V3> = pts.into_iter().filter(|q| finite(*q)).collect();
        pts.len() > 1 && pts.iter().all(|q| length(sub(*q, pts[0])) <= WELD)
    };
    let pole_v = [
        collapsed((0..nu).map(|i| at(i, 0)).collect()),
        collapsed((0..nu).map(|i| at(i, nv - 1)).collect()),
    ];
    let pole_u = [
        collapsed((0..nv).map(|j| at(0, j)).collect()),
        collapsed((0..nv).map(|j| at(nu - 1, j)).collect()),
    ];

    // Checker blocks: knot index ranges between its boundaries (one block without a checker).
    let bounds = |ks: &[f64], r: [f64; 2], n: usize| -> Vec<usize> {
        let mut b: Vec<usize> = (0..=n)
            .map(|k| {
                let x = r[0] + (r[1] - r[0]) * k as f64 / n as f64;
                (0..ks.len())
                    .min_by(|a, c| (ks[*a] - x).abs().total_cmp(&(ks[*c] - x).abs()))
                    .unwrap_or(0)
            })
            .collect();
        b.dedup();
        b
    };
    let (bu, bv) = (bounds(&us, ru, cu), bounds(&vs, rv, cv));
    let one_block = bu.len() == 2 && bv.len() == 2;

    let mut m = Mesh::default();
    let mut dropped: Option<([f64; 2], [f64; 2])> = None;
    let mut checker = Vec::new();
    let mut uvs = Vec::new();
    let mut grid: Vec<(usize, f64, Vec<[u32; 2]>)> = Vec::new();
    let (span_u, span_v) = (ru[1] - ru[0], rv[1] - rv[0]);
    for (bi, wu) in bu.windows(2).enumerate() {
        for (bj, wv) in bv.windows(2).enumerate() {
            let (i0, i1, j0, j1) = (wu[0], wu[1], wv[0], wv[1]);
            // The knot each knot's vertex is: seams and poles weld within a block.
            let canon = |mut i: usize, mut j: usize| -> (usize, usize) {
                if one_block && close_u && i == nu - 1 {
                    i = 0;
                }
                if one_block && close_v && j == nv - 1 {
                    j = 0;
                }
                if j == 0 && pole_v[0] || j == nv - 1 && pole_v[1] {
                    i = i0;
                }
                if i == 0 && pole_u[0] || i == nu - 1 && pole_u[1] {
                    j = j0;
                }
                (i, j)
            };
            let mut ids = vec![u32::MAX; nu * nv];
            let face0 = m.next_face();
            let role = (bi + bj) as f64;
            let mut vid = |m: &mut Mesh, i: usize, j: usize| -> u32 {
                let k = canon(i, j);
                let slot = &mut ids[k.0 * nv + k.1];
                if *slot == u32::MAX {
                    uvs.push([(us[k.0] - ru[0]) / span_u, (vs[k.1] - rv[0]) / span_v]);
                    checker.push(role);
                    *slot = m.vertex(at(k.0, k.1), [0.0, 1.0, 0.0]);
                }
                *slot
            };
            let mut kept = vec![false; (i1 - i0) * (j1 - j0)];
            for i in i0..i1 {
                for j in j0..j1 {
                    let c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
                    if !c.iter().all(|q| finite(*q)) {
                        let d = dropped.get_or_insert(([us[i], us[i + 1]], [vs[j], vs[j + 1]]));
                        d.0 = [d.0[0].min(us[i]), d.0[1].max(us[i + 1])];
                        d.1 = [d.1[0].min(vs[j]), d.1[1].max(vs[j + 1])];
                        continue;
                    }
                    kept[(i - i0) * (j1 - j0) + j - j0] = true;
                    let q = [
                        vid(&mut m, i, j),
                        vid(&mut m, i + 1, j),
                        vid(&mut m, i + 1, j + 1),
                        vid(&mut m, i, j + 1),
                    ];
                    let face = face0 + ((i - i0) * (j1 - j0) + j - j0) as u32;
                    m.quad(q[0], q[1], q[2], q[3], face);
                }
            }
            let kept_at = |i: isize, j: isize| -> bool {
                (i0 as isize..i1 as isize).contains(&i)
                    && (j0 as isize..j1 as isize).contains(&j)
                    && kept[(i as usize - i0) * (j1 - j0) + j as usize - j0]
            };
            // Grid lines in this block: along each line's knot, the edges of kept cells; a line on
            // a block's border draws in the first block that has it, and a closed seam's once.
            for (dir, values) in lines.iter().enumerate() {
                for &x in values {
                    let ks = if dir == 0 { &us } else { &vs };
                    let Some(k) = ks.iter().position(|y| *y == x) else {
                        continue;
                    };
                    let (lo, hi) = if dir == 0 { (i0, i1) } else { (j0, j1) };
                    let first = if dir == 0 {
                        bi == 0 || k > lo
                    } else {
                        bj == 0 || k > lo
                    };
                    let seam = if dir == 0 {
                        close_u && k == nu - 1
                    } else {
                        close_v && k == nv - 1
                    };
                    if !(lo..=hi).contains(&k) || !first || seam {
                        continue;
                    }
                    let mut edges = Vec::new();
                    let (a0, a1) = if dir == 0 { (j0, j1) } else { (i0, i1) };
                    for a in a0..a1 {
                        let (ci, cj) = if dir == 0 {
                            (k as isize, a as isize)
                        } else {
                            (a as isize, k as isize)
                        };
                        let on = if dir == 0 {
                            kept_at(ci - 1, cj) || kept_at(ci, cj)
                        } else {
                            kept_at(ci, cj - 1) || kept_at(ci, cj)
                        };
                        if !on {
                            continue;
                        }
                        let (p, q) = if dir == 0 {
                            ((k, a), (k, a + 1))
                        } else {
                            ((a, k), (a + 1, k))
                        };
                        let e = [vid(&mut m, p.0, p.1), vid(&mut m, q.0, q.1)];
                        if e[0] != e[1] {
                            edges.push(e);
                        }
                    }
                    if !edges.is_empty() {
                        grid.push((dir, x, edges));
                    }
                }
            }
        }
    }
    // A surface its seams and poles close (a sphere, a torus) faces out: wound the other way
    // round when what it encloses comes out negative.
    let shut = |seam: bool, poles: [bool; 2]| seam || (poles[0] && poles[1]);
    if shut(close_u, pole_u) && shut(close_v, pole_v) {
        let all: Vec<u32> = (0..m.triangles() as u32).collect();
        if m.volume(&all) < 0.0 {
            for t in m.indices.chunks_mut(3) {
                t.swap(1, 2);
            }
        }
    }
    smooth(&mut m);
    m.uv0 = uvs;
    if cells.is_some() {
        m.attributes.insert("checker".into(), checker);
    }
    if let Some((u, v)) = dropped {
        m.outputs
            .insert("surface.nonfinite".into(), json!({"u": u, "v": v}));
    }
    if !grid.is_empty() {
        let rows: Vec<Value> = grid
            .into_iter()
            .map(|(d, x, e)| json!({if d == 0 { "u" } else { "v" }: x, "edges": e}))
            .collect();
        m.outputs.insert("grid_lines".into(), Value::Array(rows));
    }
    color(&mut m, p, &vars, &["u", "v", "x", "y", "z"])?;
    Ok(m)
}

/// Each vertex's normal from the faces about it, by area.
fn smooth(m: &mut Mesh) {
    let mut acc = vec![[0.0; 3]; m.positions.len()];
    for t in 0..m.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        let n = cross(
            sub(m.positions[b], m.positions[a]),
            sub(m.positions[c], m.positions[a]),
        );
        for v in [a, b, c] {
            acc[v] = add(acc[v], n);
        }
    }
    m.normals = acc.into_iter().map(unit).collect();
}

/// `color: {by, ramp, domain}`: each vertex's value, which the frame maps through the ramp's roles
/// in OKLab, kept as the attribute `color.value`.
fn color(m: &mut Mesh, p: &Value, vars: &Map<String, Value>, free: &[&str]) -> Result<(), Fault> {
    let Some(c) = p.get("color") else {
        return Ok(());
    };
    let ramp = c
        .get("ramp")
        .and_then(Value::as_array)
        .filter(|r| (1..=8).contains(&r.len()));
    ramp.filter(|r| r.iter().all(Value::is_string))
        .ok_or_else(|| bad("color/ramp"))?;
    range(c, "domain").map_err(|_| bad("color/domain"))?;
    let by = c
        .get("by")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("color/by"))?;
    let uv = &m.uv0;
    let (ru, rv) = (range(p, "u").ok(), range(p, "v").ok());
    let values: Vec<f64> = match by {
        "x" | "y" | "z" => {
            let a = ["x", "y", "z"].iter().position(|n| *n == by).unwrap_or(0);
            m.positions.iter().map(|q| q[a]).collect()
        }
        "u" | "v" if free.contains(&by) => {
            let (r, k) = if by == "u" { (ru, 0) } else { (rv, 1) };
            let r = r.ok_or_else(|| bad("color/by"))?;
            uv.iter().map(|t| r[0] + (r[1] - r[0]) * t[k]).collect()
        }
        text => {
            let f = F::compile(Some(&json!(text)), free, vars, "color/by")?;
            (0..m.positions.len())
                .map(|k| {
                    let q = m.positions[k];
                    let mut at = Vec::with_capacity(free.len());
                    for n in free {
                        at.push(match *n {
                            "x" => q[0],
                            "y" => q[1],
                            "z" => q[2],
                            "u" => ru.map_or(0.0, |r| {
                                r[0] + (r[1] - r[0]) * uv.get(k).map_or(0.0, |t| t[0])
                            }),
                            _ => rv.map_or(0.0, |r| {
                                r[0] + (r[1] - r[0]) * uv.get(k).map_or(0.0, |t| t[1])
                            }),
                        });
                    }
                    f.at(&at)
                })
                .collect()
        }
    };
    m.attributes.insert("color.value".into(), values);
    Ok(())
}

// ---- where a formula over (x, y, z) is 0

/// A cell of the octree: its level and its place on that level's lattice.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
struct Cell {
    i: u32,
    j: u32,
    k: u32,
}

/// `job` over `0..n` on the host's threads (on this one without a pool), results in index order,
/// with the order the jobs finished in.
fn blocks<T: Send>(
    n: usize,
    pool: Option<(&dyn Pool, usize)>,
    job: &(dyn Fn(usize) -> T + Sync),
) -> (Vec<T>, Vec<usize>) {
    let Some((pool, threads)) = pool.filter(|(_, t)| *t > 1 && n > 1) else {
        return ((0..n).map(job).collect(), (0..n).collect());
    };
    let done: Mutex<Vec<(usize, T)>> = Mutex::new(Vec::with_capacity(n));
    pool.run(threads, n, &|k, _| {
        let r = job(k);
        if let Ok(mut d) = done.lock() {
            d.push((k, r));
        }
    });
    let finished = done.into_inner().unwrap_or_default();
    let order: Vec<usize> = finished.iter().map(|(k, _)| *k).collect();
    let mut slots: Vec<Option<T>> = (0..n).map(|_| None).collect();
    for (k, r) in finished {
        slots[k] = Some(r);
    }
    (
        slots
            .into_iter()
            .map(|s| s.expect("every block ran"))
            .collect(),
        order,
    )
}

fn implicit(p: &Value, planted: Planted, pool: Option<(&dyn Pool, usize)>) -> Result<Mesh, Fault> {
    counts(p)?;
    let vars = vars(p)?;
    let g = F::compile(p.get("zero"), &["x", "y", "z"], &vars, "zero")?;
    let bx = p
        .get("box")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 3)
        .and_then(|a| {
            let r = |v: &Value| -> Option<[f64; 2]> {
                let a = v.as_array().filter(|a| a.len() == 2)?;
                Some([a[0].as_f64()?, a[1].as_f64()?])
                    .filter(|r| r[0].is_finite() && r[1].is_finite() && r[0] < r[1])
            };
            Some([r(&a[0])?, r(&a[1])?, r(&a[2])?])
        })
        .ok_or_else(|| bad("box"))?;
    let tol = positive(p, "tolerance", 0.05)?;
    let cap = max_cells(p)? as usize;
    let side = [
        bx[0][1] - bx[0][0],
        bx[1][1] - bx[1][0],
        bx[2][1] - bx[2][0],
    ];
    let corner = |level: u32, c: [u64; 3]| -> V3 {
        let n = (1u64 << level) as f64;
        [0, 1, 2].map(|a| bx[a][0] + side[a] * c[a] as f64 / n)
    };
    let range_of = |level: u32, c: Cell| -> [Iv; 3] {
        let lo = corner(level, [c.i as u64, c.j as u64, c.k as u64]);
        let hi = corner(level, [c.i as u64 + 1, c.j as u64 + 1, c.k as u64 + 1]);
        [0, 1, 2].map(|a| Iv::new(lo[a], hi[a]))
    };
    let signs = |level: u32, c: Cell| -> [f64; 8] {
        let mut out = [0.0; 8];
        for (n, o) in out.iter_mut().enumerate() {
            let q = corner(
                level,
                [
                    c.i as u64 + (n & 1) as u64,
                    c.j as u64 + (n >> 1 & 1) as u64,
                    c.k as u64 + (n >> 2 & 1) as u64,
                ],
            );
            *o = g.at(&q);
        }
        out
    };
    let holds_zero = |level: u32, c: Cell| -> bool {
        if planted == Planted::CornerSigns {
            let s = signs(level, c);
            return s.iter().any(|x| (*x > 0.0) != (s[0] > 0.0));
        }
        let b = g.over(&range_of(level, c));
        !b.is_empty() && (b.contains(0.0) || !b.is_bounded())
    };
    let diagonal = |level: u32| length(side) / (1u64 << level) as f64;
    // Refine a level at a time, each kept cell's eight children in Morton order.
    let mut level = 0u32;
    let mut cells = vec![Cell { i: 0, j: 0, k: 0 }];
    let mut coarse = None;
    if !holds_zero(0, cells[0]) {
        cells.clear();
    }
    while !cells.is_empty() && diagonal(level) > tol && level < 20 {
        let per = cells.len().div_ceil(BLOCKS);
        let n = cells.len().div_ceil(per);
        let (parts, _) = blocks(n, pool, &|b| {
            let mut kept = Vec::new();
            for c in &cells[b * per..((b + 1) * per).min(cells.len())] {
                for o in 0..8u32 {
                    let child = Cell {
                        i: 2 * c.i + (o & 1),
                        j: 2 * c.j + (o >> 1 & 1),
                        k: 2 * c.k + (o >> 2 & 1),
                    };
                    if holds_zero(level + 1, child) {
                        kept.push(child);
                    }
                }
            }
            kept
        });
        let mut next: Vec<Cell> = parts.into_iter().flatten().collect();
        if next.len() > cap {
            if planted == Planted::StopsMidLevel {
                next.truncate(cap);
                cells = next;
                level += 1;
            }
            coarse = Some(side.iter().fold(0.0, |a: f64, s| a.max(*s)) / (1u64 << level) as f64);
            break;
        }
        cells = next;
        level += 1;
    }
    // Surface nets: each cell with a crossed edge has one vertex, at the mean of its crossings.
    let edges: [(usize, usize); 12] = [
        (0, 1),
        (2, 3),
        (4, 5),
        (6, 7),
        (0, 2),
        (1, 3),
        (4, 6),
        (5, 7),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ];
    let per = cells.len().div_ceil(BLOCKS).max(1);
    let n = cells.len().div_ceil(per);
    let (parts, finished) = blocks(n, pool, &|b| {
        cells[b * per..((b + 1) * per).min(cells.len())]
            .iter()
            .map(|c| {
                let s = signs(level, *c);
                let mut sum = [0.0; 3];
                let mut count = 0;
                for (a, b) in edges {
                    if (s[a] > 0.0) == (s[b] > 0.0) {
                        continue;
                    }
                    let at = |n: usize| {
                        corner(
                            level,
                            [
                                c.i as u64 + (n & 1) as u64,
                                c.j as u64 + (n >> 1 & 1) as u64,
                                c.k as u64 + (n >> 2 & 1) as u64,
                            ],
                        )
                    };
                    let t = s[a] / (s[a] - s[b]);
                    sum = add(sum, add(at(a), scale(sub(at(b), at(a)), t)));
                    count += 1;
                }
                (s, (count > 0).then(|| scale(sum, 1.0 / count as f64)))
            })
            .collect::<Vec<_>>()
    });
    // Vertices numbered in octree order; the planted mesher numbers them as its blocks finished.
    let order: Vec<usize> = if planted == Planted::NumberedByThread {
        finished
    } else {
        (0..n).collect()
    };
    let mut m = Mesh::default();
    let mut vid: HashMap<Cell, u32> = HashMap::new();
    let mut corners: HashMap<Cell, [f64; 8]> = HashMap::new();
    let h = 1e-6 * side.iter().fold(0.0, |a: f64, s| a.max(*s));
    for b in order {
        for (k, (s, q)) in parts[b].iter().enumerate() {
            let c = cells[b * per + k];
            corners.insert(c, *s);
            if let Some(q) = q {
                let d = |a: usize| {
                    let mut lo = *q;
                    let mut hi = *q;
                    lo[a] -= h;
                    hi[a] += h;
                    (g.at(&hi) - g.at(&lo)) / (2.0 * h)
                };
                vid.insert(c, m.vertex(*q, unit([d(0), d(1), d(2)])));
            }
        }
    }
    // A quad for each crossed edge from a kept cell's lowest corner, around it the four cells
    // that share it, wound toward positive values.
    for c in &cells {
        let s = corners[c];
        let (i, j, k) = (c.i as i64, c.j as i64, c.k as i64);
        let around = |list: [(i64, i64, i64); 4]| -> Option<[u32; 4]> {
            let mut out = [0; 4];
            for (o, (a, b, d)) in out.iter_mut().zip(list) {
                if a < 0 || b < 0 || d < 0 {
                    return None;
                }
                *o = *vid.get(&Cell {
                    i: a as u32,
                    j: b as u32,
                    k: d as u32,
                })?;
            }
            Some(out)
        };
        for (axis, far) in [(0usize, 1usize), (1, 2), (2, 4)] {
            if (s[0] > 0.0) == (s[far] > 0.0) {
                continue;
            }
            let ring = match axis {
                0 => [(i, j - 1, k - 1), (i, j, k - 1), (i, j, k), (i, j - 1, k)],
                1 => [(i - 1, j, k - 1), (i - 1, j, k), (i, j, k), (i, j, k - 1)],
                _ => [(i - 1, j - 1, k), (i, j - 1, k), (i, j, k), (i - 1, j, k)],
            };
            let Some(q) = around(ring) else { continue };
            let face = m.next_face();
            if s[far] > 0.0 {
                m.quad(q[0], q[1], q[2], q[3], face);
            } else {
                m.quad(q[3], q[2], q[1], q[0], face);
            }
        }
    }
    if let Some(size) = coarse {
        m.outputs
            .insert("surface.coarse".into(), json!({"size": size}));
    }
    m.values.insert("cells".into(), cells.len() as f64);
    m.values.insert(
        "cell".into(),
        side.iter().fold(0.0, |a: f64, s| a.max(*s)) / (1u64 << level) as f64,
    );
    color(&mut m, p, &vars, &["x", "y", "z"])?;
    Ok(m)
}

// ---- issues

/// The warnings a frame at `t` of `doc` raises for its surfaces, from what each build left:
/// `surface.nonfinite {item, u, v}`, the (u, v) range it dropped, and `surface.coarse {item,
/// size}`, the cell edge it stopped at.
pub fn raised_at(doc: &Value, t: i64) -> Vec<Issue> {
    let lowered = crate::vars::at(doc, t, None).ok().flatten();
    let doc = lowered.as_ref().unwrap_or(doc);
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("surface@1") {
            continue;
        }
        let Ok(m) = built(
            item.get("params").unwrap_or(&Value::Null),
            Planted::None,
            None,
        ) else {
            continue;
        };
        let mut warn = |code: &'static str, path: &str, fields: Value, what: &str, fix: &str| {
            let mut fields = fields;
            fields["item"] = json!(id);
            let mut issue =
                Issue::error(code, id, format!("items/{id}/params/{path}"), fields, what);
            issue.severity = "warning";
            issue.fix = fix.into();
            out.push(issue);
        };
        if let Some(r) = m.outputs.get("surface.nonfinite") {
            warn(
                "surface.nonfinite",
                "fn",
                r.clone(),
                "the formula is not finite over this (u, v) range; its cells are dropped",
                "Narrow u or v to where the formula is finite, or accept the hole.",
            );
        }
        if let Some(r) = m.outputs.get("surface.coarse") {
            warn(
                "surface.coarse",
                "max_cells",
                r.clone(),
                "the next level would pass max_cells; the surface meshes at this cell edge",
                "Raise max_cells, shrink the box, or loosen the tolerance to this cell edge.",
            );
        }
    }
    out
}

// ---- drawn

fn refused(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Each vertex's color in OKLab, its roles through `role`: `color` maps each vertex's value
/// through its ramp's roles in OKLab, `checker` takes each cell's role by (i + j) mod count; none
/// for a surface with neither. `Err` is the path under the params of a role `role` doesn't know.
pub fn colors(
    m: &Mesh,
    params: &Value,
    role: &dyn Fn(&str) -> Option<Oklab>,
) -> Result<Option<Vec<Oklab>>, String> {
    let roles = |list: &Value, at: &str| -> Result<Vec<Oklab>, String> {
        let names = list.as_array().cloned().unwrap_or_default();
        names
            .iter()
            .enumerate()
            .map(|(k, r)| r.as_str().and_then(role).ok_or_else(|| format!("{at}/{k}")))
            .collect()
    };
    if let Some(values) = m.attributes.get("color.value") {
        let ramp = roles(&params["color"]["ramp"], "color/ramp")?;
        let d = &params["color"]["domain"];
        let domain = [d[0].as_f64().unwrap_or(0.0), d[1].as_f64().unwrap_or(1.0)];
        return Ok(Some(
            values.iter().map(|v| ramp_at(&ramp, domain, *v)).collect(),
        ));
    }
    if let Some(cells) = m.attributes.get("checker") {
        let list = roles(&params["checker"]["roles"], "checker/roles")?;
        return Ok(Some(
            cells
                .iter()
                .map(|c| list[*c as usize % list.len()])
                .collect(),
        ));
    }
    Ok(None)
}

/// The mesh with its colors resolved through the look's roles, sRGB in 0..1 as the attributes
/// `color.r`, `color.g` and `color.b`, which the renderer draws per vertex.
pub fn tinted(mut m: Mesh, params: &Value, look: &Look3, path: &str) -> Result<Mesh, Refused> {
    let role = |name: &str| {
        look.role(name).map(|c| {
            srgb_to_oklab(Srgb {
                r: c[0] as f64 / 255.0,
                g: c[1] as f64 / 255.0,
                b: c[2] as f64 / 255.0,
            })
        })
    };
    let labs = match colors(&m, params, &role) {
        Ok(Some(labs)) => labs,
        Ok(None) => return Ok(m),
        Err(at) => return Err(refused("ref_unresolved", format!("{path}/{at}"))),
    };
    let rgb: Vec<Srgb> = labs.into_iter().map(oklab_to_srgb).collect();
    for (name, k) in [("color.r", 0), ("color.g", 1), ("color.b", 2)] {
        let channel = rgb
            .iter()
            .map(|c| [c.r, c.g, c.b][k].clamp(0.0, 1.0))
            .collect();
        m.attributes.insert(name.into(), channel);
    }
    Ok(m)
}

/// A surface's grid lines as one line along its mesh's edges, placed by `model`, in its stroke's
/// role, width (px, 1.5 by default) and dash, depth-tested as mesh edges are.
pub fn grid_line(
    id: &str,
    m: &Arc<Mesh>,
    params: &Value,
    look: &Look3,
    model: Affine3,
) -> Result<Option<Line>, Refused> {
    let Some(rows) = m.outputs.get("grid_lines").and_then(Value::as_array) else {
        return Ok(None);
    };
    let path = format!("items/{id}/params/grid_lines/stroke");
    let stroke = &params["grid_lines"]["stroke"];
    let role = stroke.get("role").and_then(Value::as_str).unwrap_or("ink");
    let color = look
        .role(role)
        .ok_or_else(|| refused("ref_unresolved", format!("{path}/role")))?;
    let width = match stroke.get("width") {
        None | Some(Value::Null) => 1.5,
        Some(v) => v
            .as_f64()
            .filter(|w| w.is_finite() && *w >= 0.0)
            .ok_or_else(|| refused("out_of_range", format!("{path}/width")))?,
    };
    let dash = match stroke.get("dash") {
        None | Some(Value::Null) => [0.0; 2],
        Some(v) => match v
            .as_array()
            .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<f64>>>())
        {
            Some(Some(d)) if matches!(d.len(), 1 | 2) && d.iter().all(|x| *x >= 0.0) => {
                [d[0], d[d.len() - 1]]
            }
            _ => return Err(refused("out_of_range", format!("{path}/dash"))),
        },
    };
    let mut list = Vec::new();
    for row in rows {
        for e in row["edges"].as_array().into_iter().flatten() {
            let (a, b) = (
                e[0].as_u64().unwrap_or(0) as usize,
                e[1].as_u64().unwrap_or(0) as usize,
            );
            if let (Some(p), Some(q)) = (m.positions.get(a), m.positions.get(b)) {
                list.push([*p, *q]);
            }
        }
    }
    let source = EdgesOf {
        mesh: m.clone(),
        kind: EdgeKind::All,
        model,
        width,
        list: Arc::new(list),
        derived: true,
    };
    Ok(Some(Line {
        id: format!("{id}#grid"),
        segments: source.segments(true),
        world: false,
        color,
        edges: Some(Arc::new(source)),
        over: false,
        // A line's edges are one drawn line's pieces, so their caps draw no soft edge.
        joined: true,
        dash,
        dash_world: false,
        cap: Default::default(),
        trail: None,
    }))
}
