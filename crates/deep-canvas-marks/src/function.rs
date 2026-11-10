//! A path drawn from a formula (canvas primitives: Path `path@1`: function; issues #490, #505):
//! `fn: {y, over, vars, scales, samples}` over x, `{x, y}` over s, or `{zero, over_x, over_y,
//! max_cells}` where an expression over x and y is 0, in place of `d`. The expression is the
//! core's closed function list in pinned f64 math, its vars bound to numbers by the frame that
//! draws it. With `samples: adaptive` each segment splits until the expression's interval form,
//! taken over sixteen pieces of the segment, shows the curve within 0.5 px of the segment's chord
//! at every x (every s), at most 2,000 points: the line holds everywhere, not only at its samples.
//! A non-finite sample breaks the curve; a stretch the bound can't settle within the points draws
//! from its samples as an estimate, which the drawing names by its range and which never decides
//! a check. An implicit form is traced on an interval quadtree ([`crate::implicit`]).
//!
//! Probes evaluate the formula at a point, with a central-difference slope; an area is its
//! integral by adaptive Gauss-Kronrod with an interval bound from the same forms; a color ramp
//! mixes roles in OKLab by x or y.

use deep_canvas::color::Oklab;
use deep_canvas::expr::{Expr, Nothing, Resolve};
use deep_canvas::interval::Iv;
use serde_json::Value;

/// The most points a path function draws.
pub const MAX_POINTS: usize = 2000;
/// How far the drawn line may sit from the curve, in px (u at zoom 1).
const TOLERANCE: f64 = 0.5;
/// The most nodes a path function's expression takes once its sums expand.
pub const CAP: usize = 512;
/// The pieces a segment's bound is taken over, so the chord's own slope isn't charged to it.
const PIECES: usize = 16;

/// Why a path function is refused: the field, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub field: &'static str,
    pub why: String,
}

fn refuse(field: &'static str, why: impl Into<String>) -> Refusal {
    Refusal {
        field,
        why: why.into(),
    }
}

/// A linear map from the function's units to u (a scale's domain to its range).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lin {
    pub domain: [f64; 2],
    pub range: [f64; 2],
}

impl Lin {
    pub const IDENTITY: Lin = Lin {
        domain: [0.0, 1.0],
        range: [0.0, 1.0],
    };

    fn k(&self) -> f64 {
        (self.range[1] - self.range[0]) / (self.domain[1] - self.domain[0])
    }

    pub fn map(&self, v: f64) -> f64 {
        self.range[0] + (v - self.domain[0]) * self.k()
    }

    /// A range of values to the range of u it lands in, rounded outward.
    fn map_iv(&self, v: Iv) -> Iv {
        if v.is_empty() {
            return v;
        }
        v.sub(Iv::point(self.domain[0]))
            .mul(Iv::point(self.k()))
            .add(Iv::point(self.range[0]))
    }

    /// The function's units one px spans.
    fn per_px(&self) -> f64 {
        1.0 / self.k().abs()
    }
}

/// The two maps a function draws through: its x and y scales, or none (x and y in u).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Axes {
    pub x: Lin,
    pub y: Lin,
}

impl Default for Axes {
    fn default() -> Axes {
        Axes {
            x: Lin::IDENTITY,
            y: Lin::IDENTITY,
        }
    }
}

/// The planted wrong programs the checks must fail on (never in a shipped document's drawing).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// #505 AC3: the sampler stops splitting a segment once its midpoint lies within 0.5 px of
    /// its chord, with no interval bound.
    StopsAtMidpoint,
    /// #505 AC4: the tracer drops a cell whose four corners share a sign.
    DropsCellsByCornerSigns,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        match name {
            "stops_at_midpoint" => Some(Planted::StopsAtMidpoint),
            "drops_cells_by_corner_signs" => Some(Planted::DropsCellsByCornerSigns),
            _ => None,
        }
    }
}

/// One expression with its free variables and its vars bound to numbers.
#[derive(Clone)]
pub struct Formula {
    expr: Expr,
    /// For each of the expression's vars, its free variable's index or its bound value.
    slots: Vec<Slot>,
}

#[derive(Clone, Copy)]
enum Slot {
    Free(usize),
    Fixed(f64),
}

impl Formula {
    /// `text` compiled with `free` as its free variables and `fixed` as its vars' values; a name
    /// that is neither is refused.
    pub fn compile(
        text: &str,
        free: &[&str],
        fixed: &dyn Fn(&str) -> Option<f64>,
        resolve: &dyn Resolve,
        field: &'static str,
    ) -> Result<Formula, Refusal> {
        let expr = Expr::compile(text, resolve, CAP).map_err(|r| refuse(field, r.to_string()))?;
        let mut slots = Vec::with_capacity(expr.vars.len());
        for n in &expr.vars {
            slots.push(match free.iter().position(|f| f == n) {
                Some(i) => Slot::Free(i),
                None => match fixed(n) {
                    Some(v) => Slot::Fixed(v),
                    None => return Err(refuse(field, format!("`{n}` is no var of the function"))),
                },
            });
        }
        Ok(Formula { expr, slots })
    }

    pub fn at(&self, free: &[f64]) -> f64 {
        let vars: Vec<f64> = self
            .slots
            .iter()
            .map(|s| match s {
                Slot::Free(i) => free[*i],
                Slot::Fixed(v) => *v,
            })
            .collect();
        self.expr.eval_num(&vars)
    }

    pub fn over(&self, free: &[Iv]) -> Iv {
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

/// What a path function is, once compiled.
#[derive(Clone)]
pub enum Form {
    /// y over x in [a, b].
    Over { y: Formula, over: [f64; 2] },
    /// x and y over s in [a, b].
    Param {
        x: Formula,
        y: Formula,
        over: [f64; 2],
    },
    /// zero(x, y) = 0 over a box, at most `max_cells` cells.
    Zero {
        g: Formula,
        over_x: [f64; 2],
        over_y: [f64; 2],
        max_cells: usize,
    },
}

/// A path function's drawing, in u: its sub-paths, whether each closes, the ranges it holds by
/// its bound and those it drew as estimates (x or s, in the function's units), an implicit
/// curve's estimate box and the cells its trace took.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawn {
    pub subpaths: Vec<Vec<[f64; 2]>>,
    pub closed: Vec<bool>,
    pub bound: Vec<[f64; 2]>,
    pub estimates: Vec<[f64; 2]>,
    pub estimate_box: Option<[f64; 4]>,
    pub cells: Option<usize>,
}

/// An ordered range `[a, b]` with finite ends.
fn range_of(v: Option<&Value>, field: &'static str) -> Result<[f64; 2], Refusal> {
    match v.and_then(Value::as_array).map(Vec::as_slice) {
        Some([a, b]) => match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b)) if a < b && a.is_finite() && b.is_finite() => Ok([a, b]),
            _ => Err(refuse(field, "a range is [a, b], finite, with a < b")),
        },
        _ => Err(refuse(field, "a range is [a, b]")),
    }
}

impl Form {
    /// `fn` compiled: `fixed` gives each var's value, `over` the x range when `fn` names none
    /// (its x scale's domain), and an `over` end may be an expression over the vars.
    pub fn read(
        f: &Value,
        fixed: &dyn Fn(&str) -> Option<f64>,
        default_over: Option<[f64; 2]>,
        default_box: Option<([f64; 2], [f64; 2])>,
    ) -> Result<Form, Refusal> {
        let text = |k: &str| f.get(k).and_then(Value::as_str);
        if let Some(zero) = text("zero") {
            let g = Formula::compile(zero, &["x", "y"], fixed, &Nothing, "zero")?;
            let (over_x, over_y) = match (f.get("over_x"), f.get("over_y"), default_box) {
                (None, None, Some(b)) => b,
                (ox, oy, b) => (
                    match ox {
                        None => b
                            .map(|b| b.0)
                            .ok_or(refuse("over_x", "no range and no scale"))?,
                        v => range_of(v, "over_x")?,
                    },
                    match oy {
                        None => b
                            .map(|b| b.1)
                            .ok_or(refuse("over_y", "no range and no scale"))?,
                        v => range_of(v, "over_y")?,
                    },
                ),
            };
            let max_cells = match f.get("max_cells") {
                None => 16_384,
                Some(v) => v
                    .as_u64()
                    .filter(|n| (1..=u64::from(u32::MAX)).contains(n))
                    .ok_or(refuse("max_cells", "max_cells is a u32 above 0"))?
                    as usize,
            };
            return Ok(Form::Zero {
                g,
                over_x,
                over_y,
                max_cells,
            });
        }
        // An end of `over`: a number, or an expression over the vars.
        let end = |v: &Value| -> Result<f64, Refusal> {
            match v {
                Value::String(s) => {
                    let e = Formula::compile(s, &[], fixed, &Nothing, "over")?;
                    Ok(e.at(&[]))
                }
                v => v
                    .as_f64()
                    .ok_or(refuse("over", "an end is a number or an expression")),
            }
        };
        let over = match f.get("over").and_then(Value::as_array).map(Vec::as_slice) {
            None if f.get("over").is_none() => {
                default_over.ok_or(refuse("over", "over is [a, b], or the x scale's domain"))?
            }
            Some([a, b]) => {
                let (a, b) = (end(a)?, end(b)?);
                if !(a.is_finite() && b.is_finite() && a <= b) {
                    return Err(refuse("over", "over is [a, b], finite, with a ≤ b"));
                }
                [a, b]
            }
            _ => return Err(refuse("over", "over is [a, b]")),
        };
        match (text("x"), text("y")) {
            (Some(x), Some(y)) => Ok(Form::Param {
                x: Formula::compile(x, &["s"], fixed, &Nothing, "x")?,
                y: Formula::compile(y, &["s"], fixed, &Nothing, "y")?,
                over,
            }),
            (None, Some(y)) => Ok(Form::Over {
                y: Formula::compile(y, &["x"], fixed, &Nothing, "y")?,
                over,
            }),
            _ => Err(refuse("y", "a path function's y is an expression over x")),
        }
    }

    /// The drawing, through `axes`, with `samples` (adaptive, or a count).
    pub fn draw(
        &self,
        axes: &Axes,
        samples: Option<&Value>,
        planted: Planted,
    ) -> Result<Drawn, Refusal> {
        let fixed_n = match samples {
            None => None,
            Some(Value::String(s)) if s == "adaptive" => None,
            Some(v) => match v.as_u64() {
                Some(n) if (2..=MAX_POINTS as u64).contains(&n) => Some(n as usize),
                _ => return Err(refuse("samples", "samples is adaptive or 2 to 2,000")),
            },
        };
        Ok(match self {
            Form::Over { y, over } => {
                let curve = |s: f64| [s, y.at(&[s])];
                let bound = |s: Iv| (s, y.over(&[s]));
                sampled(*over, &curve, &bound, axes, fixed_n, false, planted)
            }
            Form::Param { x, y, over } => {
                let curve = |s: f64| [x.at(&[s]), y.at(&[s])];
                let bound = |s: Iv| (x.over(&[s]), y.over(&[s]));
                sampled(*over, &curve, &bound, axes, fixed_n, true, planted)
            }
            Form::Zero {
                g,
                over_x,
                over_y,
                max_cells,
            } => {
                let t = crate::implicit::trace(
                    &|x, y| g.at(&[x, y]),
                    &|x, y| g.over(&[x, y]),
                    *over_x,
                    *over_y,
                    [TOLERANCE * axes.x.per_px(), TOLERANCE * axes.y.per_px()],
                    *max_cells,
                    planted == Planted::DropsCellsByCornerSigns,
                );
                let closed: Vec<bool> = t
                    .subpaths
                    .iter()
                    .map(|s| s.len() > 2 && s.first() == s.last())
                    .collect();
                Drawn {
                    subpaths: t
                        .subpaths
                        .iter()
                        .map(|s| {
                            s.iter()
                                .map(|p| [axes.x.map(p[0]), axes.y.map(p[1])])
                                .collect()
                        })
                        .collect(),
                    closed,
                    estimate_box: t.estimate,
                    cells: Some(t.cells),
                    ..Drawn::default()
                }
            }
        })
    }

    /// y at x, for a function over x; `None` for the other forms.
    pub fn y_at(&self, x: f64) -> Option<f64> {
        match self {
            Form::Over { y, .. } => Some(y.at(&[x])),
            _ => None,
        }
    }

    /// y's interval form over x in `r`, for a function over x.
    pub fn y_over(&self, r: Iv) -> Option<Iv> {
        match self {
            Form::Over { y, .. } => Some(y.over(&[r])),
            _ => None,
        }
    }

    /// A function over x drawn over `over` alone (an area's edge).
    pub fn restricted(&self, over: [f64; 2]) -> Option<Form> {
        match self {
            Form::Over { y, .. } => Some(Form::Over { y: y.clone(), over }),
            _ => None,
        }
    }

    pub fn over(&self) -> Option<[f64; 2]> {
        match self {
            Form::Over { over, .. } | Form::Param { over, .. } => Some(*over),
            Form::Zero { .. } => None,
        }
    }

    /// The point, and the slope dy/dx by a central difference at 1e-6 of the span, at the
    /// parameter `at` (x, or s).
    pub fn probe(&self, at: f64) -> Option<([f64; 2], f64)> {
        let [a, b] = self.over()?;
        let h = 1e-6 * (b - a).max(f64::MIN_POSITIVE);
        match self {
            Form::Over { y, .. } => {
                let slope = (y.at(&[at + h]) - y.at(&[at - h])) / (2.0 * h);
                Some(([at, y.at(&[at])], slope))
            }
            Form::Param { x, y, .. } => {
                let dx = x.at(&[at + h]) - x.at(&[at - h]);
                let dy = y.at(&[at + h]) - y.at(&[at - h]);
                Some(([x.at(&[at]), y.at(&[at])], dy / dx))
            }
            Form::Zero { .. } => None,
        }
    }
}

/// The adaptive (or fixed-count) samples of a curve over s in `over`, drawn through `axes`: each
/// segment split until its bound shows the curve within the tolerance of its chord, the points
/// going first where a stretch is nearest to settling, and the stretches left as estimates once
/// the points run out. A non-finite sample, or a segment split to adjacent floats and still unsettled
/// (a jump or a pole), breaks the curve.
fn sampled(
    over: [f64; 2],
    curve: &dyn Fn(f64) -> [f64; 2],
    bound: &dyn Fn(Iv) -> (Iv, Iv),
    axes: &Axes,
    fixed_n: Option<usize>,
    param: bool,
    planted: Planted,
) -> Drawn {
    let [a, b] = over;
    let u = |p: [f64; 2]| [axes.x.map(p[0]), axes.y.map(p[1])];
    if let Some(n) = fixed_n {
        let ss: Vec<f64> = (0..n)
            .map(|i| a + (b - a) * i as f64 / (n - 1) as f64)
            .collect();
        let mut d = runs(&ss, curve, &u);
        d.bound = Vec::new();
        return d;
    }
    if a == b {
        let mut d = runs(&[a], curve, &u);
        d.bound = vec![[a, b]];
        return d;
    }
    // How far the curve may sit from a segment's chord, in u: over each of its pieces, the
    // curve's bound against the chord's span there; unbounded where the bound is. The planted
    // sampler reads only the midpoint's distance.
    let deviation = |lo: f64, hi: f64| -> f64 {
        let (p0, p1) = (curve(lo), curve(hi));
        let (c0, c1) = (u(p0), u(p1));
        if !(c0.iter().chain(c1.iter()).all(|v| v.is_finite())) {
            return f64::INFINITY;
        }
        let chord = |s: f64| {
            let f = (s - lo) / (hi - lo);
            [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f]
        };
        if planted == Planted::StopsAtMidpoint {
            let m = 0.5 * (lo + hi);
            let (p, c) = (u(curve(m)), chord(m));
            return ops_hypot(p[0] - c[0], p[1] - c[1]);
        }
        let mut worst: f64 = 0.0;
        for k in 0..PIECES {
            let s0 = lo + (hi - lo) * k as f64 / PIECES as f64;
            let s1 = if k + 1 == PIECES {
                hi
            } else {
                lo + (hi - lo) * (k + 1) as f64 / PIECES as f64
            };
            let (bx, by) = bound(Iv::new(s0, s1));
            let (bx, by) = (axes.x.map_iv(bx), axes.y.map_iv(by));
            if by.is_empty() || bx.is_empty() {
                continue;
            }
            if !(bx.is_bounded() && by.is_bounded()) {
                return f64::INFINITY;
            }
            let (l0, l1) = (chord(s0), chord(s1));
            let dev = |b: Iv, i: usize| {
                let (lo, hi) = (l0[i].min(l1[i]), l0[i].max(l1[i]));
                (b.hi - lo).max(hi - b.lo)
            };
            // Over x the chord is at the curve's own x: only y's distance counts.
            let d = if param {
                ops_hypot(dev(bx, 0), dev(by, 1))
            } else {
                dev(by, 1)
            };
            worst = worst.max(d);
        }
        worst
    };
    // Each settled segment, and the open ones with their deviation. Each split adds one point,
    // and goes where it bounds the most of the range per point: the open segment with the most
    // width for its deviation (the points a stretch needs grow with its deviation), the widest
    // of equals, so the points bound every stretch they can before the rest is an estimate.
    let mut segs: Vec<(f64, f64, bool)> = Vec::new();
    let mut open: Vec<(f64, f64, f64)> = vec![(a, b, deviation(a, b))];
    let mut breaks: Vec<f64> = Vec::new();
    let mut points = 2;
    loop {
        let (settled, rest): (Vec<_>, Vec<_>) = open.into_iter().partition(|o| o.2 <= TOLERANCE);
        segs.extend(settled.into_iter().map(|(lo, hi, _)| (lo, hi, true)));
        open = rest;
        if open.is_empty() || points >= MAX_POINTS {
            break;
        }
        let gain = |o: &(f64, f64, f64)| (o.1 - o.0) / o.2;
        let next = (0..open.len())
            .max_by(|&i, &j| {
                let (p, q) = (&open[i], &open[j]);
                gain(p)
                    .total_cmp(&gain(q))
                    .then((p.1 - p.0).total_cmp(&(q.1 - q.0)))
            })
            .expect("an open segment");
        let (lo, hi, _) = open.swap_remove(next);
        let mid = 0.5 * (lo + hi);
        // Split down to adjacent floats and still unsettled: a jump (floor, a comparison, a
        // pole), which breaks the curve rather than drawing a wall.
        if mid <= lo || mid >= hi {
            breaks.push(hi);
            segs.push((lo, hi, true));
            continue;
        }
        points += 1;
        open.push((lo, mid, deviation(lo, mid)));
        open.push((mid, hi, deviation(mid, hi)));
    }
    segs.extend(open.into_iter().map(|(lo, hi, _)| (lo, hi, false)));
    segs.sort_by(|p, q| p.0.total_cmp(&q.0));
    let finite = |s: f64| curve(s).iter().all(|v| v.is_finite());
    let mut ss = vec![a];
    let mut estimates: Vec<[f64; 2]> = Vec::new();
    let mut held: Vec<[f64; 2]> = Vec::new();
    let join = |list: &mut Vec<[f64; 2]>, lo: f64, hi: f64| match list.last_mut() {
        Some(e) if e[1] == lo => e[1] = hi,
        _ => list.push([lo, hi]),
    };
    for &(lo, hi, done) in &segs {
        if done {
            join(&mut held, lo, hi);
        } else if finite(lo) && finite(hi) {
            join(&mut estimates, lo, hi);
            // A stretch whose bound is unbounded may hold a pole between its samples: it
            // breaks the curve rather than drawing a wall across it.
            let (bx, by) = bound(Iv::new(lo, hi));
            if !(bx.is_bounded() && by.is_bounded()) {
                breaks.push(hi);
            }
        }
        if breaks.contains(&hi) {
            ss.push(f64::NAN);
        }
        ss.push(hi);
    }
    let mut d = runs(&ss, curve, &u);
    d.estimates = estimates;
    d.bound = held;
    d
}

fn ops_hypot(a: f64, b: f64) -> f64 {
    deep_canvas::ops::hypot(a, b)
}

/// The sub-paths through the samples `ss` (a NaN marks a break), in u.
fn runs(ss: &[f64], curve: &dyn Fn(f64) -> [f64; 2], u: &dyn Fn([f64; 2]) -> [f64; 2]) -> Drawn {
    let mut subpaths: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut run: Vec<[f64; 2]> = Vec::new();
    for &s in ss {
        let p = if s.is_nan() {
            [f64::NAN; 2]
        } else {
            u(curve(s))
        };
        if p.iter().all(|v| v.is_finite()) {
            run.push(p);
        } else if !run.is_empty() {
            subpaths.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        subpaths.push(run);
    }
    let closed = vec![false; subpaths.len()];
    Drawn {
        subpaths,
        closed,
        ..Drawn::default()
    }
}

/// `fn`'s drawing in its own units, with no vars and no scales (#490's path call).
pub fn draw(f: &Value) -> Result<Drawn, Refusal> {
    let form = Form::read(f, &|_| None, None, None)?;
    form.draw(&Axes::default(), f.get("samples"), Planted::None)
}

// ---- the area under a curve

/// Gauss-Kronrod 7-15 nodes on [−1, 1] (the positive half; 0 last) and weights.
const KRONROD_X: [f64; 8] = [
    0.991_455_371_120_812_6,
    0.949_107_912_342_758_5,
    0.864_864_423_359_769_1,
    0.741_531_185_599_394_4,
    0.586_087_235_467_691_1,
    0.405_845_151_377_397_2,
    0.207_784_955_007_898_5,
    0.0,
];
const KRONROD_W: [f64; 8] = [
    0.022_935_322_010_529_22,
    0.063_092_092_629_978_55,
    0.104_790_010_322_250_2,
    0.140_653_259_715_525_9,
    0.169_004_726_639_267_9,
    0.190_350_578_064_785_4,
    0.204_432_940_075_298_9,
    0.209_482_141_084_727_8,
];
/// The Gauss 7-point weights, at Kronrod nodes 1, 3, 5 and 0.
const GAUSS_W: [f64; 4] = [
    0.129_484_966_168_869_7,
    0.279_705_391_489_276_7,
    0.381_830_050_505_118_9,
    0.417_959_183_673_469_4,
];

fn kronrod(f: &dyn Fn(f64) -> f64, a: f64, b: f64) -> (f64, f64) {
    let (c, h) = (0.5 * (a + b), 0.5 * (b - a));
    let mut k = KRONROD_W[7] * f(c);
    let mut g = GAUSS_W[3] * f(c);
    for i in 0..7 {
        let pair = f(c - h * KRONROD_X[i]) + f(c + h * KRONROD_X[i]);
        k += KRONROD_W[i] * pair;
        if i % 2 == 1 {
            g += GAUSS_W[i / 2] * pair;
        }
    }
    (k * h, (k - g).abs() * h)
}

/// ∫ f over [a, b] by adaptive Gauss-Kronrod, to 1e-13 of the area or past 2,000 pieces.
fn integral(f: &dyn Fn(f64) -> f64, a: f64, b: f64) -> f64 {
    let mut pieces = vec![(a, b, kronrod(f, a, b))];
    while pieces.len() < 2000 {
        let total: f64 = pieces.iter().map(|p| p.2 .1).sum();
        let value: f64 = pieces.iter().map(|p| p.2 .0).sum();
        if total <= 1e-13 * value.abs().max(1e-300) || total == 0.0 {
            break;
        }
        let (i, _) = pieces
            .iter()
            .enumerate()
            .max_by(|x, y| x.1 .2 .1.total_cmp(&y.1 .2 .1))
            .expect("a piece");
        let (lo, hi, _) = pieces.swap_remove(i);
        let mid = 0.5 * (lo + hi);
        if mid <= lo || mid >= hi {
            pieces.push((lo, hi, kronrod(f, lo, hi)));
            break;
        }
        pieces.push((lo, mid, kronrod(f, lo, mid)));
        pieces.push((mid, hi, kronrod(f, mid, hi)));
    }
    pieces.iter().map(|p| p.2 .0).sum()
}

/// The area between `f` and `g` (the axis when `None`) over [a, b]: its value by Gauss-Kronrod
/// and an interval certain to hold it, from the interval forms over 256 pieces.
pub fn area(f: &Form, g: Option<&Form>, over: [f64; 2]) -> Option<(f64, Iv)> {
    let [a, b] = over;
    let diff = |x: f64| {
        f.y_at(x).unwrap_or(f64::NAN) - g.map_or(Some(0.0), |g| g.y_at(x)).unwrap_or(f64::NAN)
    };
    let value = if a == b { 0.0 } else { integral(&diff, a, b) };
    let n = 256;
    let mut sum = Iv::point(0.0);
    for k in 0..n {
        let x0 = a + (b - a) * k as f64 / n as f64;
        let x1 = if k + 1 == n {
            b
        } else {
            a + (b - a) * (k + 1) as f64 / n as f64
        };
        let fy = f.y_over(Iv::new(x0, x1))?;
        let gy = match g {
            Some(g) => g.y_over(Iv::new(x0, x1))?,
            None => Iv::point(0.0),
        };
        let width = Iv::point(x1).sub(Iv::point(x0));
        sum = sum.add(fy.sub(gy).mul(width));
    }
    Some((value, sum))
}

// ---- color by value

/// The ramp's color at `v` across `domain`: its roles evenly spaced, mixed in OKLab.
pub fn ramp_at(ramp: &[Oklab], domain: [f64; 2], v: f64) -> Oklab {
    let t = ((v - domain[0]) / (domain[1] - domain[0])).clamp(0.0, 1.0);
    if ramp.len() == 1 {
        return ramp[0];
    }
    let f = t * (ramp.len() - 1) as f64;
    let i = (f.floor() as usize).min(ramp.len() - 2);
    let w = f - i as f64;
    let (p, q) = (ramp[i], ramp[i + 1]);
    Oklab {
        l: p.l + (q.l - p.l) * w,
        a: p.a + (q.a - p.a) * w,
        b: p.b + (q.b - p.b) * w,
    }
}

// ---- the derivative check

/// mulberry32 seeded with `seed`, in [0, 1).
fn seeded(seed: u32, n: usize) -> Vec<f64> {
    let mut a = seed;
    (0..n)
        .map(|_| {
            a = a.wrapping_add(0x6d2b_79f5);
            let mut t = a;
            t = (t ^ (t >> 15)).wrapping_mul(t | 1);
            t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
            f64::from(t ^ (t >> 14)) / 4_294_967_296.0
        })
        .collect()
}

/// `fn.derivative`: `d` against `f`'s central-difference slope at 256 seeded x over both ranges,
/// through `d`'s y scale; the first x (ascending) where they part by more than 0.5 px.
pub fn derivative_misses(d: &Form, f: &Form, y: &Lin) -> Option<f64> {
    let ([a0, b0], [a1, b1]) = (d.over()?, f.over()?);
    let (a, b) = (a0.max(a1), b0.min(b1));
    if a >= b {
        return None;
    }
    let mut xs: Vec<f64> = seeded(0x505, 256).iter().map(|r| a + (b - a) * r).collect();
    xs.sort_by(f64::total_cmp);
    xs.into_iter().find(|&x| {
        let slope = f.probe(x).map_or(f64::NAN, |p| p.1);
        let mine = d.y_at(x).unwrap_or(f64::NAN);
        // A gap that is not a number is off the curve too.
        let gap = (y.map(mine) - y.map(slope)).abs();
        gap.is_nan() || gap > TOLERANCE
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn form(f: Value) -> Form {
        Form::read(&f, &|_| None, None, None).unwrap()
    }

    #[test]
    fn sinc_draws_as_one_sub_path_with_no_estimate() {
        let d = draw(&json!({"y": "sinc(x)", "over": [-10, 10]})).unwrap();
        assert_eq!(d.subpaths.len(), 1);
        assert!(d.estimates.is_empty());
        assert!(d.subpaths[0].len() <= MAX_POINTS);
    }

    #[test]
    fn a_jump_breaks_the_curve_with_no_estimate() {
        let d = draw(&json!({"y": "floor(x)", "over": [0.5, 1.5]})).unwrap();
        assert_eq!(d.subpaths.len(), 2);
        assert!(d.estimates.is_empty());
    }

    #[test]
    fn a_pole_leaves_points_for_both_sides() {
        let d = draw(&json!({"y": "1 / x", "over": [-3, 3]})).unwrap();
        assert_eq!(d.subpaths.len(), 2);
        assert!(d.subpaths.iter().all(|s| s.len() > 100));
    }

    #[test]
    fn a_pole_off_the_samples_breaks_the_curve() {
        let d = draw(&json!({"y": "1 / (x - 0.1)", "over": [-3, 3]})).unwrap();
        assert!(d.subpaths.len() >= 2);
        for s in &d.subpaths {
            assert!(
                s.windows(2)
                    .all(|w| (w[0][0] - 0.1) * (w[1][0] - 0.1) >= 0.0),
                "a wall across x = 0.1"
            );
        }
    }

    #[test]
    fn a_curve_it_cannot_settle_spends_its_whole_budget() {
        let d = draw(&json!({"y": "sin(1 / x)", "over": [0.0001, 1]})).unwrap();
        let points: usize = d.subpaths.iter().map(Vec::len).sum();
        assert!(points > 1900, "{points}");
        assert!(!d.estimates.is_empty());
    }

    #[test]
    fn a_long_straight_line_settles_within_its_budget() {
        let d = draw(&json!({"y": "x", "over": [-300, 300]})).unwrap();
        assert_eq!(d.subpaths.len(), 1);
        assert!(d.estimates.is_empty());
        assert!(d.subpaths[0].len() <= MAX_POINTS);
    }

    #[test]
    fn a_pole_breaks_the_curve() {
        let d = draw(&json!({"y": "1 / x", "over": [-1, 1], "samples": 101})).unwrap();
        assert_eq!(d.subpaths.len(), 2);
    }

    #[test]
    fn the_area_under_x_squared_is_a_third_within_its_bound() {
        let f = form(json!({"y": "x^2", "over": [0, 1]}));
        let (v, b) = area(&f, None, [0.0, 1.0]).unwrap();
        assert!((v - 1.0 / 3.0).abs() < 1e-14, "{v}");
        assert!(b.contains(1.0 / 3.0));
    }

    #[test]
    fn a_probe_reads_the_value_and_the_slope() {
        let f = Form::read(
            &json!({"y": "a * x^2", "over": [-2, 2]}),
            &|n| (n == "a").then_some(2.0),
            None,
            None,
        )
        .unwrap();
        let (p, slope) = f.probe(1.5).unwrap();
        assert!(
            (p[1] - 4.5).abs() < 1e-12 && (slope - 6.0).abs() < 1e-6,
            "{p:?} {slope}"
        );
    }

    #[test]
    fn a_derivative_off_by_a_tenth_is_named_and_the_true_one_passes() {
        let f = form(json!({"y": "x^2", "over": [0, 2]}));
        let y = Lin {
            domain: [0.0, 4.0],
            range: [440.0, 40.0],
        };
        assert_eq!(
            derivative_misses(&form(json!({"y": "2 * x", "over": [0, 2]})), &f, &y),
            None
        );
        assert!(
            derivative_misses(&form(json!({"y": "2 * x + 0.1", "over": [0, 2]})), &f, &y).is_some()
        );
    }
}
