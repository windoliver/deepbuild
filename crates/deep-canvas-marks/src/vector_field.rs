//! Issue #225: a vector field `vector_field@1` (canvas primitives: Vector field `vector_field@1`),
//! the data module's. One formula gives a vector at each point, in 2D or 3D. Arrows on a grid are
//! evaluated from it per frame; streams are integrated by RK4 at a fixed step in pinned f64 (every
//! transcendental through the core's `ops`), each whole step and then one step of what remains, so
//! a stream ends on its `time` exactly. A stream stops where it leaves the grid's box widened by
//! `pad`, meets a non-finite vector or reaches `max_points`. The flow is a trim window in closed
//! form, p = fract(t × speed ÷ time + phase_i), so seeking equals playing. A 2D field's streams are
//! its stream table in data layout `streams@1`, which a group's warp reads by layout.
//!
//! `follow_stream` (canvas primitives: Constraint) carries an item along the stream from `from`:
//! a table of points at the field's step built at check, read at field time τ as the point at
//! ⌊τ ÷ step⌋ and one RK4 step of what remains, so its op count is fixed and nothing iterates.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas::expr::{Expr, Nothing};
use deep_canvas::streams;
use serde_json::{Map, Value};

use crate::scene::Refused;

pub const KIND: &str = "vector_field@1";
/// The most arrows, and the most stream starts, a field takes.
pub const MAX_ARROWS: usize = 4096;
pub const MAX_STARTS: usize = 4096;
/// A stream's default most points, and the most it may take when there are at most
/// [`FEW_STARTS`] starts.
pub const MAX_POINTS: usize = 512;
pub const MAX_POINTS_FEW: usize = 16_384;
pub const FEW_STARTS: usize = 8;
/// The most roles a ramp takes.
pub const MAX_RAMP: usize = 8;
/// The most nodes a component's formula takes, as a field's.
const NODES: usize = 256;

pub type P3 = [f64; 3];

fn refused<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

/// What a component's var reads: a coordinate or a var's number.
#[derive(Clone, Copy, Debug)]
enum Slot {
    Axis(usize),
    Num(f64),
}

#[derive(Clone, Debug)]
struct Comp {
    expr: Expr,
    slots: Vec<Slot>,
}

impl Comp {
    fn compile(
        text: &str,
        dim: usize,
        vars: &BTreeMap<String, f64>,
        path: &str,
    ) -> Result<Comp, Refused> {
        let expr = Expr::compile(text, &Nothing, NODES).or_else(|_| refused("bad_doc", path))?;
        let axes = ["x", "y", "z"];
        let slots = expr
            .vars
            .iter()
            .map(|n| match axes[..dim].iter().position(|a| a == n) {
                Some(i) => Ok(Slot::Axis(i)),
                None => vars.get(n).map(|v| Slot::Num(*v)).ok_or_else(|| Refused {
                    code: "ref_unresolved",
                    path: format!("{path}: {n}"),
                }),
            })
            .collect::<Result<_, _>>()?;
        Ok(Comp { expr, slots })
    }

    fn at(&self, p: &P3) -> f64 {
        let mut few = [0.0; 8];
        let fill = |s: &Slot| match *s {
            Slot::Axis(i) => p[i],
            Slot::Num(v) => v,
        };
        if self.slots.len() <= few.len() {
            for (slot, s) in few.iter_mut().zip(&self.slots) {
                *slot = fill(s);
            }
            return self.expr.eval_num(&few[..self.slots.len()]);
        }
        let v: Vec<f64> = self.slots.iter().map(fill).collect();
        self.expr.eval_num(&v)
    }
}

/// The field's formula, compiled with its vars' values: two components or three.
#[derive(Clone, Debug)]
pub struct Field {
    comps: Vec<Comp>,
    /// Each component's text, x first.
    pub texts: Vec<String>,
    /// The vars' values it was compiled with, by name.
    pub vars: BTreeMap<String, f64>,
}

impl Field {
    /// `fn` (`{x, y}` or `{x, y, z}`) compiled with `vars`' values.
    pub fn compile(f: &Value, vars: &BTreeMap<String, f64>, path: &str) -> Result<Field, Refused> {
        let Some(f) = f.as_object() else {
            return refused("bad_doc", path);
        };
        let dim = if f.contains_key("z") { 3 } else { 2 };
        if f.keys().any(|k| !["x", "y", "z"].contains(&k.as_str())) {
            return refused("bad_doc", path);
        }
        let mut comps = Vec::new();
        let mut texts = Vec::new();
        for axis in &["x", "y", "z"][..dim] {
            let at = format!("{path}/{axis}");
            let Some(text) = f.get(*axis).and_then(Value::as_str) else {
                return refused("bad_doc", at);
            };
            comps.push(Comp::compile(text, dim, vars, &at)?);
            texts.push(text.to_string());
        }
        Ok(Field {
            comps,
            texts,
            vars: vars.clone(),
        })
    }

    pub fn dim(&self) -> usize {
        self.comps.len()
    }

    /// The vector at `p`; a 2D field's z is 0.
    pub fn at(&self, p: &P3) -> P3 {
        let mut out = [0.0; 3];
        for (o, c) in out.iter_mut().zip(&self.comps) {
            *o = c.at(p);
        }
        out
    }
}

fn add(p: &P3, k: &P3, s: f64) -> P3 {
    [p[0] + k[0] * s, p[1] + k[1] * s, p[2] + k[2] * s]
}

/// The integrator: RK4, or the planted twin a proof surface names, one Euler step.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Method {
    #[default]
    Rk4,
    Euler,
}

/// The planted integrator: Euler's method, which drifts outward on a closed orbit.
pub const PLANTED_EULER: &str = "streams_euler";

/// One step of `h` from `p`.
pub fn step(field: &Field, p: &P3, h: f64, method: Method) -> P3 {
    let k1 = field.at(p);
    if method == Method::Euler {
        return add(p, &k1, h);
    }
    let k2 = field.at(&add(p, &k1, h / 2.0));
    let k3 = field.at(&add(p, &k2, h / 2.0));
    let k4 = field.at(&add(p, &k3, h));
    [0, 1, 2].map(|i| p[i] + h / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]))
}

/// The steps a stream of `time` takes at `step`: its whole steps, then what remains, if any.
pub fn steps(time: f64, step: f64) -> impl Iterator<Item = f64> {
    let whole = (time / step).floor();
    let rest = time - whole * step;
    (0..whole as u64)
        .map(move |_| step)
        .chain(std::iter::once(rest).filter(|h| *h > 0.0))
}

/// An axis-aligned box a stream stays in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub lo: P3,
    pub hi: P3,
}

impl Bounds {
    fn holds(&self, p: &P3, dim: usize) -> bool {
        (0..dim).all(|i| p[i] >= self.lo[i] && p[i] <= self.hi[i])
    }
}

/// What a stream is integrated with.
#[derive(Clone, Copy, Debug)]
pub struct Integration {
    pub step: f64,
    pub time: f64,
    pub bounds: Option<Bounds>,
    pub max_points: usize,
    pub method: Method,
}

/// The stream from `start`: its points, the start first, stopping where it leaves the bounds,
/// meets a non-finite vector or reaches `max_points`.
pub fn stream(field: &Field, start: P3, how: &Integration) -> Vec<P3> {
    let dim = field.dim();
    let mut out = Vec::with_capacity(how.max_points.min(1 + (how.time / how.step) as usize + 1));
    if !start.iter().all(|c| c.is_finite()) {
        return out;
    }
    out.push(start);
    let mut p = start;
    for h in steps(how.time, how.step) {
        if out.len() >= how.max_points {
            break;
        }
        let next = step(field, &p, h, how.method);
        if !next.iter().all(|c| c.is_finite()) {
            break;
        }
        if how.bounds.is_some_and(|b| !b.holds(&next, dim)) {
            break;
        }
        out.push(next);
        p = next;
    }
    out
}

/// A grid `{x, y, z: [a, b, step]}`: each axis's values, a to b inclusive.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    pub axes: Vec<[f64; 3]>,
}

impl Grid {
    fn read(g: &Value, dim: usize, path: &str) -> Result<Grid, Refused> {
        let mut axes = Vec::new();
        for (i, name) in ["x", "y", "z"][..dim].iter().enumerate() {
            let at = format!("{path}/{name}");
            let r = match g.get(*name) {
                Some(Value::Array(a)) if a.len() == 3 => {
                    let v: Vec<f64> = a.iter().filter_map(|x| num(Some(x))).collect();
                    if v.len() != 3 || v[2].is_nan() || v[2] <= 0.0 || v[1] < v[0] {
                        return refused("out_of_range", at);
                    }
                    [v[0], v[1], v[2]]
                }
                // A 2D field's grid in 3D axes may leave z out: one plane at 0.
                None if i == 2 => [0.0, 0.0, 1.0],
                _ => return refused("bad_doc", at),
            };
            axes.push(r);
        }
        Ok(Grid { axes })
    }

    fn counts(&self) -> Vec<usize> {
        self.axes
            .iter()
            .map(|[a, b, s]| ((b - a) / s + 1e-9).floor() as usize + 1)
            .collect()
    }

    fn len(&self) -> usize {
        self.counts().iter().product()
    }

    /// Every point, x fastest.
    pub fn points(&self) -> Vec<P3> {
        let counts = self.counts();
        let mut out = Vec::with_capacity(self.len());
        let n = |i: usize| counts.get(i).copied().unwrap_or(1);
        for k in 0..n(2) {
            for j in 0..n(1) {
                for i in 0..n(0) {
                    let at = |axis: usize, idx: usize| {
                        self.axes
                            .get(axis)
                            .map_or(0.0, |[a, _, s]| a + s * idx as f64)
                    };
                    out.push([at(0, i), at(1, j), at(2, k)]);
                }
            }
        }
        out
    }

    /// The box the grid spans, widened by `pad` on every side.
    pub fn bounds(&self, pad: f64) -> Bounds {
        let mut lo = [f64::NEG_INFINITY; 3];
        let mut hi = [f64::INFINITY; 3];
        for (i, [a, b, _]) in self.axes.iter().enumerate() {
            lo[i] = a - pad;
            hi[i] = b + pad;
        }
        Bounds { lo, hi }
    }

    /// The smallest step of its axes: the default arrow length's unit.
    pub fn step(&self) -> f64 {
        self.axes
            .iter()
            .take(2)
            .map(|a| a[2])
            .fold(f64::INFINITY, f64::min)
    }
}

/// How an arrow's length follows its vector's magnitude.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Length {
    Sigmoid,
    Linear,
    Constant,
}

/// What an arrow's color reads.
#[derive(Clone, Debug)]
pub enum ColorBy {
    Magnitude,
    Expression(Comp3),
}

mod arrows;
pub use arrows::*;

/// What keys an integration: the field's texts and vars, and the streams' starts and options.
fn key_of(field: &Field, s: &Streams) -> Vec<u8> {
    let mut k = Vec::new();
    for t in &field.texts {
        k.extend_from_slice(&(t.len() as u64).to_le_bytes());
        k.extend_from_slice(t.as_bytes());
    }
    for (n, v) in &field.vars {
        k.extend_from_slice(&(n.len() as u64).to_le_bytes());
        k.extend_from_slice(n.as_bytes());
        k.extend_from_slice(&v.to_bits().to_le_bytes());
    }
    let h = &s.how;
    for x in [h.step, h.time] {
        k.extend_from_slice(&x.to_bits().to_le_bytes());
    }
    if let Some(b) = h.bounds {
        for x in b.lo.iter().chain(&b.hi) {
            k.extend_from_slice(&x.to_bits().to_le_bytes());
        }
    }
    k.extend_from_slice(&(h.max_points as u64).to_le_bytes());
    k.push(h.method as u8);
    for p in &s.starts {
        for x in p {
            k.extend_from_slice(&x.to_bits().to_le_bytes());
        }
    }
    k
}

/// The integrations kept, by what keys them, at most [`KEPT`]: a frame whose field and vars are
/// as before reuses its streams, so streams integrate once at check and again only when a var
/// changes.
const KEPT: usize = 16;
type Kept = Mutex<Vec<(Vec<u8>, Arc<Vec<Vec<P3>>>, f64)>>;
static INTEGRATED: Mutex<Option<Arc<Kept>>> = Mutex::new(None);

fn kept() -> Arc<Kept> {
    let mut g = INTEGRATED.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

/// The clock integrations are timed by, which the host hands in: the canvas reads no clock.
static CLOCK: Mutex<Option<crate::warp::Clock>> = Mutex::new(None);

/// Times integrations by `clock` from now on (`None` stops).
pub fn time_with(clock: Option<crate::warp::Clock>) {
    *CLOCK.lock().unwrap_or_else(|e| e.into_inner()) = clock;
}

/// Each stream of `s` integrated over `field`, and the milliseconds that took by the host's
/// clock (0 without one), from the kept integrations when one matches.
pub fn integrated(field: &Field, s: &Streams) -> (Arc<Vec<Vec<P3>>>, f64) {
    let key = key_of(field, s);
    let kept = kept();
    if let Some((_, got, ms)) = kept
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|(k, _, _)| *k == key)
    {
        return (got.clone(), *ms);
    }
    let clock = *CLOCK.lock().unwrap_or_else(|e| e.into_inner());
    let start = clock.map(|c| c());
    let got = Arc::new(integrate_all(field, s));
    let ms = match (clock, start) {
        (Some(c), Some(t0)) => c() - t0,
        _ => 0.0,
    };
    let mut list = kept.lock().unwrap_or_else(|e| e.into_inner());
    if list.len() >= KEPT {
        list.remove(0);
    }
    list.push((key, got.clone(), ms));
    (got, ms)
}

/// Each stream of `s`, integrated afresh.
pub fn integrate_all(field: &Field, s: &Streams) -> Vec<Vec<P3>> {
    s.starts.iter().map(|p| stream(field, *p, &s.how)).collect()
}

/// A `follow_stream`'s table: the points from `from` at the field's step, which the item reads at
/// a field time with one remainder step.
#[derive(Clone, Debug)]
pub struct Follow {
    pub field: Field,
    pub step: f64,
    pub points: Vec<P3>,
}

/// The most steps a `follow_stream` table takes.
pub const MAX_FOLLOW_STEPS: usize = 100_000;

impl Follow {
    /// The table from `from` over `span` field seconds at `step`, by `method`.
    pub fn build(field: Field, from: P3, step: f64, span: f64, method: Method) -> Follow {
        let n = ((span.max(0.0) / step).ceil() as usize).min(MAX_FOLLOW_STEPS);
        let mut points = Vec::with_capacity(n + 1);
        points.push(from);
        let mut p = from;
        for _ in 0..n {
            p = self::step(&field, &p, step, method);
            if !p.iter().all(|c| c.is_finite()) {
                break;
            }
            points.push(p);
        }
        Follow {
            field,
            step,
            points,
        }
    }

    /// Where the item is at field time `tau`, and the ops it took, the same at every time: the
    /// table's point at ⌊τ ÷ step⌋ and one RK4 step of what remains (a step of 0 leaves it
    /// there); before 0 it's at `from`, past the table's end at its last point.
    pub fn at(&self, tau: f64) -> (P3, u64) {
        let last = self.points.len() - 1;
        let tau = if tau > 0.0 { tau } else { 0.0 };
        let k = ((tau / self.step).floor() as usize).min(last);
        let rest = if k == last {
            0.0
        } else {
            tau - k as f64 * self.step
        };
        // One lookup and the step's four field evaluations.
        (step(&self.field, &self.points[k], rest, Method::Rk4), 5)
    }
}

/// The field item's params, its vars bound by `value`, read for a frame.
pub fn read_item(
    id: &str,
    item: &Value,
    value: &dyn Fn(&str) -> Option<f64>,
    method: Method,
) -> Result<VectorField, Refused> {
    let path = format!("items/{id}/params");
    let params = item.get("params").unwrap_or(&Value::Null);
    let vars = var_values(params, &path, value)?;
    VectorField::read(params, &vars, &path, method)
}

/// Whether `items` holds a vector field.
pub fn any(items: &Map<String, Value>) -> bool {
    items
        .values()
        .any(|i| i.get("kind").and_then(Value::as_str) == Some(KIND))
}

// ---- placing: field units to the item's space

/// How field points are placed: through a chart's two scales, or as they are.
#[allow(clippy::large_enum_variant)]
pub enum Place {
    Scales(crate::data::Scale, crate::data::Scale),
    Plain,
}

impl Place {
    /// The field's place among `items`: its scales when it names them.
    pub fn of(vf: &VectorField, items: &Map<String, Value>, path: &str) -> Result<Place, Refused> {
        match &vf.scales {
            Some([x, y]) => Ok(Place::Scales(
                crate::data::scale_named(items, x, &format!("{path}/scales/x"))?,
                crate::data::scale_named(items, y, &format!("{path}/scales/y"))?,
            )),
            None => Ok(Place::Plain),
        }
    }

    /// A field point in the item's space.
    pub fn at(&self, p: &P3) -> P3 {
        match self {
            Place::Scales(x, y) => [x.map(p[0]), y.map(p[1]), p[2]],
            Place::Plain => *p,
        }
    }
}

// ---- drawing in 2D

/// The stroke width of an arrow's shaft and of a stream, in px.
const WIDTH: f64 = 2.0;
/// An arrow head's length and half-width, in shaft widths.
const HEAD: (f64, f64) = (4.0, 2.0);
/// How many points of a stream share one color.
const CHUNK: usize = 8;

/// The ramp's color at `v` across `domain`: its roles evenly spaced, mixed in OKLab.
pub fn ramp_color(ramp: &[crate::scene::Rgb], domain: [f64; 2], v: f64) -> crate::scene::Rgb {
    let t = ((v - domain[0]) / (domain[1] - domain[0])).clamp(0.0, 1.0);
    if ramp.len() == 1 {
        return ramp[0];
    }
    let f = t * (ramp.len() - 1) as f64;
    let i = (f.floor() as usize).min(ramp.len() - 2);
    crate::paint::rgb_of(crate::paint::oklab_mix(ramp[i], ramp[i + 1], f - i as f64))
}

/// The part of a polyline from `a` to `b` of its length, each in [0, 1]; empty when b ≤ a.
pub fn trimmed(points: &[[f64; 2]], a: f64, b: f64) -> Vec<[f64; 2]> {
    if points.len() < 2 || b <= a {
        return Vec::new();
    }
    let mut lengths = vec![0.0];
    for w in points.windows(2) {
        let d = deep_canvas::ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]);
        lengths.push(lengths.last().copied().unwrap_or(0.0) + d);
    }
    let total = lengths[lengths.len() - 1];
    if total.is_nan() || total <= 0.0 {
        return Vec::new();
    }
    let at = |s: f64| -> [f64; 2] {
        let s = s.clamp(0.0, total);
        let k = lengths
            .partition_point(|l| *l < s)
            .clamp(1, points.len() - 1);
        let (l0, l1) = (lengths[k - 1], lengths[k]);
        let w = if l1 > l0 { (s - l0) / (l1 - l0) } else { 0.0 };
        let (p, q) = (points[k - 1], points[k]);
        [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w]
    };
    let (s0, s1) = (a.clamp(0.0, 1.0) * total, b.clamp(0.0, 1.0) * total);
    let mut out = vec![at(s0)];
    out.extend(
        points
            .iter()
            .zip(&lengths)
            .filter(|(_, l)| **l > s0 && **l < s1)
            .map(|(p, _)| *p),
    );
    out.push(at(s1));
    out
}

/// A stream's window as the pieces of it it shows: one, or two where it wraps past the end.
pub fn pieces(window: [f64; 2]) -> Vec<[f64; 2]> {
    let [a, b] = window;
    if b <= 1.0 {
        vec![[a, b]]
    } else {
        vec![[a, 1.0], [0.0, b - 1.0]]
    }
}

fn polyline(
    item: &str,
    points: &[[f64; 2]],
    offset: [f64; 2],
    color: crate::scene::Rgb,
) -> crate::scene::Mark {
    let mut d = String::new();
    for (i, p) in points.iter().enumerate() {
        d.push_str(&format!(
            "{} {} {} ",
            if i == 0 { "M" } else { "L" },
            p[0],
            p[1]
        ));
    }
    let d = d.trim_end().to_string();
    crate::scene::Mark::Path {
        item: item.to_string(),
        geometry: crate::scene::Geometry {
            verbs: crate::path::parse(&d).unwrap_or_default(),
            stroke: Some(WIDTH),
            fill: false,
        },
        d,
        offset,
        color,
    }
}

/// A field's marks in 2D, as the frame's fields hold it (its vars numbers, its windows written):
/// each arrow as a shaft and a filled head in its ramp color, each stream's shown window as
/// strokes colored at their points' magnitudes.
pub fn marks(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &crate::scene::Palette,
    pos: [f64; 2],
    method: Method,
) -> Result<Vec<crate::scene::Mark>, Refused> {
    use crate::scene::Mark;
    let path = format!("items/{id}/params");
    let params = item.get("params").unwrap_or(&Value::Null);
    let vf = read_item(id, item, &|_| None, method)?;
    if vf.axes.is_some() {
        // A field on 3D axes draws in 3D, through the core's fills; one on 2D scales or none
        // draws its x and y here.
        return Ok(Vec::new());
    }
    let place = Place::of(&vf, items, &path)?;
    let roles = |ramp: &[String], at: &str| -> Result<Vec<crate::scene::Rgb>, Refused> {
        ramp.iter()
            .map(|r| {
                palette.get(r).copied().ok_or(Refused {
                    code: "role_unresolved",
                    path: format!("{path}/{at}: {r}"),
                })
            })
            .collect()
    };
    let (ramp, domain) = match &vf.arrows {
        Some(a) => (roles(&a.ramp, "arrows/color/ramp")?, a.domain),
        None => (
            roles(&["ink".to_string()], "arrows/color/ramp")?,
            [0.0, 2.0],
        ),
    };
    let mut out = Vec::new();
    let flat = |p: &P3| {
        let q = place.at(p);
        [q[0], q[1]]
    };
    let windows: Vec<f64> = params
        .get("windows")
        .and_then(Value::as_array)
        .map(|w| w.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    for (i, s) in vf.streams().iter().enumerate() {
        let points: Vec<[f64; 2]> = s.iter().map(flat).collect();
        let shown = match windows.get(2 * i..2 * i + 2) {
            Some(w) => pieces([w[0], w[1]]),
            None => vec![[0.0, 1.0]],
        };
        let sub = format!("{id}#s{i}");
        for [a, b] in shown {
            let piece = trimmed(&points, a, b);
            for chunk in piece.windows(2).collect::<Vec<_>>().chunks(CHUNK) {
                let mut line: Vec<[f64; 2]> = chunk.iter().map(|w| w[0]).collect();
                line.push(chunk[chunk.len() - 1][1]);
                // The chunk's color is the field's magnitude at its middle, in field units.
                let mid = line[line.len() / 2];
                let m = nearest_magnitude(&vf.field, s, &points, mid);
                out.push(polyline(&sub, &line, pos, ramp_color(&ramp, domain, m)));
            }
        }
    }
    if let Some(arrows) = &vf.arrows {
        for (i, a) in arrows.at(&vf.field).iter().enumerate() {
            let (t, h) = (flat(&a.tail), flat(&a.tip));
            let color = ramp_color(&ramp, domain, a.value);
            let sub = format!("{id}#a{i}");
            let d = [h[0] - t[0], h[1] - t[1]];
            let len = deep_canvas::ops::hypot(d[0], d[1]);
            if len.is_nan() || len <= 0.0 {
                continue;
            }
            let u = [d[0] / len, d[1] / len];
            let head = (HEAD.0 * WIDTH).min(len / 2.0);
            let base = [h[0] - u[0] * head, h[1] - u[1] * head];
            out.push(polyline(&sub, &[t, base], pos, color));
            let w = HEAD.1 * WIDTH * head / (HEAD.0 * WIDTH);
            let n = [-u[1] * w, u[0] * w];
            let tri = format!(
                "M {} {} L {} {} L {} {} Z",
                h[0],
                h[1],
                base[0] + n[0],
                base[1] + n[1],
                base[0] - n[0],
                base[1] - n[1]
            );
            out.push(Mark::Path {
                item: sub,
                geometry: crate::scene::Geometry {
                    verbs: crate::path::parse(&tri).unwrap_or_default(),
                    stroke: None,
                    fill: true,
                },
                d: tri,
                offset: pos,
                color,
            });
        }
    }
    Ok(out)
}

/// The field's magnitude at the stream point drawn nearest `at`.
fn nearest_magnitude(field: &Field, stream: &[P3], drawn: &[[f64; 2]], at: [f64; 2]) -> f64 {
    let k = drawn
        .iter()
        .enumerate()
        .min_by(|(_, p), (_, q)| {
            let d =
                |r: &[f64; 2]| (r[0] - at[0]) * (r[0] - at[0]) + (r[1] - at[1]) * (r[1] - at[1]);
            d(p).total_cmp(&d(q))
        })
        .map_or(0, |(k, _)| k);
    norm(&field.at(&stream[k]))
}

// ---- the proof surface's answer

/// The ramp's two neighbouring roles at `v` across `domain`, and how far from the first to the
/// second `v` sits.
pub fn ramp_mix(ramp: &[String], domain: [f64; 2], v: f64) -> ([String; 2], f64) {
    let t = ((v - domain[0]) / (domain[1] - domain[0])).clamp(0.0, 1.0);
    if ramp.len() == 1 {
        return ([ramp[0].clone(), ramp[0].clone()], 0.0);
    }
    let f = t * (ramp.len() - 1) as f64;
    let i = (f.floor() as usize).min(ramp.len() - 2);
    ([ramp[i].clone(), ramp[i + 1].clone()], f - i as f64)
}

/// What a field holds at `seconds`, in its own coordinates: each stream's points and their bytes
/// (little-endian f64, point after point), each arrow, each flow window, and the milliseconds its
/// integration took.
pub fn answer(id: &str, vf: &VectorField, seconds: f64) -> Value {
    use serde_json::json;
    let dims = vf.field.dim();
    let (streams, ms) = vf.streams_timed();
    let streams: Vec<Value> = streams
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let mut bytes = Vec::with_capacity(s.len() * dims * 8);
            for p in s {
                for c in &p[..dims] {
                    bytes.extend_from_slice(&c.to_le_bytes());
                }
            }
            json!({
                "id": format!("{id}#s{i}"),
                "points": s.iter().map(|p| p[..dims].to_vec()).collect::<Vec<_>>(),
                "bytes": deep_canvas::base64::encode(&bytes),
            })
        })
        .collect();
    let arrows: Vec<Value> = vf
        .arrows
        .as_ref()
        .map(|a| {
            a.at(&vf.field)
                .iter()
                .map(|arrow| {
                    let v: Vec<f64> = (0..dims).map(|k| arrow.tip[k] - arrow.tail[k]).collect();
                    let (roles, mix) = ramp_mix(&a.ramp, a.domain, arrow.value);
                    json!({
                        "at": arrow.tail[..dims].to_vec(),
                        "vector": v,
                        "length": arrow.length,
                        "color": {"roles": roles, "mix": mix},
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let trims: Vec<Value> = match (&vf.flow, &vf.streams) {
        (Some(flow), Some(s)) => (0..s.starts.len())
            .map(|i| json!(flow.window(i, seconds, s.how.time)))
            .collect(),
        _ => Vec::new(),
    };
    json!({
        "outcome": "answered", "dims": dims, "streams": streams, "arrows": arrows,
        "trims": trims, "integrate_ms": ms,
    })
}

/// The integrator a test build plants by name, else RK4.
pub fn method_of(planted: Option<&str>) -> Method {
    if planted == Some(PLANTED_EULER) {
        Method::Euler
    } else {
        Method::Rk4
    }
}

// ---- the data module's registration

/// The params a frame writes onto a field: its stream table (a 2D field's) and each stream's
/// flow window at `seconds`, as `(path, value)`.
pub fn frame_fields(vf: &VectorField, seconds: f64) -> Vec<(Vec<String>, Value)> {
    let mut out = Vec::new();
    let at = |k: &[&str]| k.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    // Each var as the number it read, so the frame draws from its fields alone.
    for (name, v) in &vf.field.vars {
        out.push((at(&["params", "vars", name]), Value::from(*v)));
    }
    if let Some(table) = vf.table() {
        let j = streams::to_json(&table);
        out.push((at(&["params", "streams", "layout"]), j["layout"].clone()));
        out.push((at(&["params", "streams", "bytes"]), j["bytes"].clone()));
    }
    if let (Some(flow), Some(s)) = (&vf.flow, &vf.streams) {
        // Each window as it draws: while the flow warms up, none wraps past a stream's end.
        let warming = flow.warming(seconds, s.how.time);
        let windows: Vec<Value> = (0..s.starts.len())
            .flat_map(|i| {
                let [a, b] = flow.window(i, seconds, s.how.time);
                [a, if warming { b.min(1.0) } else { b }]
            })
            .map(Value::from)
            .collect();
        out.push((at(&["params", "windows"]), Value::Array(windows)));
    }
    out
}

/// `items` with each vector field's frame fields written in at `seconds`, its vars read through
/// `value`; one it can't read is left for the scene to refuse.
pub fn bind(items: &mut Map<String, Value>, seconds: f64, value: &dyn Fn(&str) -> Option<f64>) {
    let ids: Vec<String> = items
        .iter()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some(KIND))
        .map(|(k, _)| k.clone())
        .collect();
    for id in ids {
        let Ok(vf) = read_item(&id, &items[&id], value, Method::Rk4) else {
            continue;
        };
        for (path, v) in frame_fields(&vf, seconds) {
            let mut slot = &mut items[&id];
            for k in &path {
                if !slot.is_object() {
                    *slot = Value::Object(Map::new());
                }
                slot = slot
                    .as_object_mut()
                    .expect("an object")
                    .entry(k.clone())
                    .or_insert(Value::Null);
            }
            *slot = v;
        }
    }
}

use deep_canvas::registry::{Raised, Registrar};
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{OpError, Val, View};

/// A var's value where the scheduler evaluates a frame: a number, or `time` in seconds.
fn frame_value(seconds: f64) -> impl Fn(&str) -> Option<f64> {
    move |p: &str| (p == "time").then_some(seconds)
}

fn seconds_of(t: i64) -> f64 {
    t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
}

fn is_field(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some(KIND)
}

/// Each `follow_stream` constraint of `doc`: its ID and fields.
fn follows(doc: &Value) -> impl Iterator<Item = (&String, &Value)> {
    doc.get("constraints")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("kind").and_then(Value::as_str) == Some(FOLLOW))
}

fn is_follower(doc: &Value, id: &str, _: &Value) -> bool {
    follows(doc).any(|(_, c)| c.get("owner").and_then(Value::as_str) == Some(id))
}

/// The constraint kind this module fills in the core's `constraint@1`.
pub const FOLLOW: &str = "follow_stream";
/// What a `follow_stream` reads, in its order: the frame's time, then its field's table.
const FOLLOW_READS: [&str; 2] = ["t", "vector_field.table"];

/// Registers the vector field with the data module: each frame's stream table and flow windows
/// on the field's fields, each followed item's place in the core's transform, its check, its
/// marks in 3D and its `follow_stream` entry.
pub fn register(r: &mut Registrar) {
    r.contribution(
        "data.vector_field",
        "fields",
        "item",
        "geometry",
        "items",
        "core.fields",
    );
    r.operator(
        "vector_field",
        "items",
        &["self", "t"],
        &["data.vector_field"],
    )
    .applies(is_field)
    .run(field_op);
    r.contribution(
        "data.follow",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.operator("follow_stream", "items", &["refs", "t"], &["data.follow"])
        .applies(is_follower)
        .run(follow_op);
    r.rule("vector_field", rule);
    r.marks3d(KIND, marks3d);
    r.entry("constraint@1", FOLLOW, entry(), "R6");
}

fn field_op(v: &mut View<'_>) -> Result<(), OpError> {
    let method = method_of(v.planted());
    let seconds = seconds_of(v.t()?);
    let id = v.id().unwrap_or_default().to_string();
    let item = v.item()?;
    let vf = read_item(&id, item, &frame_value(seconds), method)
        .map_err(|r| OpError::new(r.code, r.path))?;
    let edits = frame_fields(&vf, seconds)
        .into_iter()
        .map(|(path, value)| Edit {
            add: false,
            path,
            value: match value {
                Value::String(s) => Datum::Text(s),
                Value::Array(a) => Datum::Nums(a.iter().filter_map(Value::as_f64).collect()),
                other => Datum::Num(other.as_f64().unwrap_or(0.0)),
            },
        })
        .collect();
    v.write("data.vector_field", Val::typed(Edits(edits)))
}

/// A `follow_stream` read: its field, start, speed and offset.
struct FollowSpec {
    field: String,
    from: P3,
    speed: f64,
    offset: f64,
}

fn follow_spec(id: &str, c: &Value) -> Result<FollowSpec, Refused> {
    let at = |k: &str| format!("constraints/{id}/{k}");
    let field = c
        .get("vector_field")
        .and_then(Value::as_str)
        .map_or_else(|| refused("bad_doc", at("vector_field")), Ok)?
        .to_string();
    let from = c
        .get("from")
        .and_then(vec3)
        .map_or_else(|| refused("bad_doc", at("from")), Ok)?;
    let speed = match c.get("speed") {
        None => 1.0,
        v => num(v).map_or_else(|| refused("out_of_range", at("speed")), Ok)?,
    };
    let offset = match c.get("time_offset") {
        None => 0.0,
        Some(Value::String(s)) => time_of(s, None)
            .map(seconds_of)
            .map_or_else(|| refused("bad_doc", at("time_offset")), Ok)?,
        v => num(v).map_or_else(|| refused("bad_doc", at("time_offset")), Ok)?,
    };
    Ok(FollowSpec {
        field,
        from,
        speed,
        offset,
    })
}

/// A time literal in flicks, at the transport's frame rate.
fn time_of(text: &str, transport: Option<&Value>) -> Option<i64> {
    let ctx = deep_canvas::grammar::TimeContext {
        frame_rate: transport
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1)),
        markers: Default::default(),
    };
    deep_canvas::grammar::Time::parse(text)
        .ok()?
        .resolve(&ctx)
        .ok()
}

/// The document's span in seconds, from its transport.
fn span_of(doc: &Value) -> f64 {
    let transport = doc.get("transport");
    match transport.and_then(|t| t.get("span")) {
        Some(Value::String(t)) => time_of(t, transport).map_or(0.0, seconds_of),
        Some(v) => v.as_i64().map_or(0.0, seconds_of),
        None => 0.0,
    }
}

type FollowKept = Mutex<Vec<(Vec<u8>, Arc<Follow>)>>;
static FOLLOWS: Mutex<Option<Arc<FollowKept>>> = Mutex::new(None);

/// The table a follow reads, built once for its field, start, step and span, and kept.
fn table_for(field: &Field, from: P3, step: f64, span: f64, method: Method) -> Arc<Follow> {
    let mut key = vec![method as u8];
    for t in &field.texts {
        key.extend_from_slice(&(t.len() as u64).to_le_bytes());
        key.extend_from_slice(t.as_bytes());
    }
    for (n, v) in &field.vars {
        key.extend_from_slice(n.as_bytes());
        key.extend_from_slice(&v.to_bits().to_le_bytes());
    }
    for x in from.iter().chain(&[step, span]) {
        key.extend_from_slice(&x.to_bits().to_le_bytes());
    }
    let kept = {
        let mut g = FOLLOWS.lock().unwrap_or_else(|e| e.into_inner());
        g.get_or_insert_with(|| Arc::new(Mutex::new(Vec::new())))
            .clone()
    };
    let mut list = kept.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, f)) = list.iter().find(|(k, _)| *k == key) {
        return f.clone();
    }
    let f = Arc::new(Follow::build(field.clone(), from, step, span, method));
    if list.len() >= KEPT {
        list.remove(0);
    }
    list.push((key, f.clone()));
    f
}

/// Where a followed item is at document time `seconds`, in its field's space, and the reads it
/// made in order.
fn followed(
    doc: &Value,
    spec: &FollowSpec,
    seconds: f64,
    path: &str,
    method: Method,
    note: &mut dyn FnMut(&'static str),
) -> Result<(P3, u64), Refused> {
    note(FOLLOW_READS[0]);
    let items = doc.get("items").and_then(Value::as_object);
    let item = items
        .and_then(|i| i.get(&spec.field))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some(KIND))
        .map_or_else(
            || {
                refused(
                    "ref_unresolved",
                    format!("{path}/vector_field: {}", spec.field),
                )
            },
            Ok,
        )?;
    let vf = read_item(&spec.field, item, &frame_value(seconds), method)?;
    // The table runs at the field's step for its streams' time, else for the document's span.
    let step = vf.streams.as_ref().map_or(0.05, |s| s.how.step);
    let span = vf
        .streams
        .as_ref()
        .map_or(span_of(doc) * spec.speed.abs(), |s| s.how.time)
        .max(step);
    note(FOLLOW_READS[1]);
    let table = table_for(&vf.field, spec.from, step, span, method);
    note("solve");
    Ok(table.at((seconds - spec.offset) * spec.speed))
}

fn follow_op(v: &mut View<'_>) -> Result<(), OpError> {
    let method = method_of(v.planted());
    let seconds = seconds_of(v.t()?);
    let id = v.id().unwrap_or_default().to_string();
    let doc = v.document()?;
    let mut edits = Vec::new();
    for (cid, c) in follows(doc) {
        if c.get("owner").and_then(Value::as_str) != Some(id.as_str()) {
            continue;
        }
        let path = format!("constraints/{cid}");
        let err = |r: Refused| OpError::new(r.code, r.path);
        let spec = follow_spec(cid, c).map_err(err)?;
        let (p, _) = followed(doc, &spec, seconds, &path, method, &mut |_| {}).map_err(err)?;
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let vf = read_item(
            &spec.field,
            &items[&spec.field],
            &frame_value(seconds),
            method,
        )
        .map_err(err)?;
        let placed = Place::of(&vf, &items, &format!("items/{}/params", spec.field))
            .map_err(err)?
            .at(&p);
        edits.push(Edit {
            add: false,
            path: vec!["pos".into()],
            value: Datum::Nums(placed.to_vec()),
        });
    }
    v.write("data.follow", Val::typed(Edits(edits)))
}

/// Each item a `follow_stream` of `doc` owns placed in `items` at `seconds`, where a host
/// evaluates a frame without the scheduler; one it can't place is left where it was.
pub fn place_followers(doc: &Value, items: &mut Map<String, Value>, seconds: f64) {
    let authored = doc
        .get("items")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (cid, c) in follows(doc) {
        let Some(owner) = c.get("owner").and_then(Value::as_str) else {
            continue;
        };
        let Ok(spec) = follow_spec(cid, c) else {
            continue;
        };
        let path = format!("constraints/{cid}");
        let Ok((p, _)) = followed(doc, &spec, seconds, &path, Method::Rk4, &mut |_| {}) else {
            continue;
        };
        let Some(vf) = authored
            .get(&spec.field)
            .and_then(|f| read_item(&spec.field, f, &frame_value(seconds), Method::Rk4).ok())
        else {
            continue;
        };
        let Ok(place) = Place::of(&vf, &authored, &format!("items/{}/params", spec.field)) else {
            continue;
        };
        let q = place.at(&p);
        if let Some(item) = items.get_mut(owner).and_then(Value::as_object_mut) {
            let at = item
                .entry("at")
                .or_insert_with(|| Value::Object(Map::new()));
            if !at.is_object() {
                *at = Value::Object(Map::new());
            }
            at["pos"] = serde_json::json!([q[0], q[1]]);
        }
    }
}

/// Each `follow_stream` whose field reads its own item back through a var: the cycle as a chain
/// from the item through the field to the item.
pub fn cycles(doc: &Value) -> Vec<(String, Vec<String>)> {
    let items = doc.get("items").and_then(Value::as_object);
    follows(doc)
        .filter_map(|(cid, c)| {
            let owner = c.get("owner").and_then(Value::as_str)?;
            let field = c.get("vector_field").and_then(Value::as_str)?;
            let vars = items?.get(field)?.pointer("/params/vars")?.as_object()?;
            let back = vars.values().filter_map(Value::as_str).any(|p| {
                p.strip_prefix("items/")
                    .is_some_and(|r| r.split(['/', '#']).next() == Some(owner))
            });
            back.then(|| {
                (
                    cid.clone(),
                    vec![owner.to_string(), field.to_string(), owner.to_string()],
                )
            })
        })
        .collect()
}

/// The check over a field: its params read (each var a path as 0), and each `follow_stream`
/// through it that reads its own item back, a cycle naming the chain.
fn rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let raised = |code: &'static str, path: String, what: String| Raised {
        code,
        severity: "error",
        path,
        what,
        fix_ops: None,
    };
    let mut out = Vec::new();
    match read_item(id, item, &|_| Some(0.0), Method::Rk4) {
        Err(r) => out.push(raised(r.code, r.path.clone(), r.path)),
        Ok(vf) => {
            let items = doc
                .get("items")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Err(r) = Place::of(&vf, &items, &format!("items/{id}/params")) {
                out.push(raised(r.code, r.path.clone(), r.path));
            }
            // The streams integrate here, at check, and are kept for the frames.
            vf.streams();
        }
    }
    for (cid, chain) in cycles(doc) {
        if chain.get(1).map(String::as_str) == Some(id) {
            out.push(raised(
                deep_canvas::registry::core_lists::CYCLE,
                format!("constraints/{cid}"),
                chain.join(" → "),
            ));
        }
    }
    out
}

/// A 3D field's marks: each arrow and each stream as a line, through its 3D axes when it names
/// them.
fn marks3d(
    req: &deep_canvas::contributed::Request,
) -> Result<Vec<deep_canvas::contributed::Mark>, deep_canvas::outline::Refusal> {
    use deep_canvas::contributed::Mark;
    let refusal = |r: Refused| deep_canvas::outline::Refusal {
        code: r.code,
        what: r.path.clone(),
        path: r.path,
    };
    let seconds = 0.0;
    let vf = read_item(req.id, req.value, &frame_value(seconds), Method::Rk4).map_err(refusal)?;
    let axes = match &vf.axes {
        Some(a) => {
            let item = (req.item)(a).ok_or_else(|| {
                refusal(Refused {
                    code: "ref_unresolved",
                    path: format!("items/{}/params/axes: {a}", req.id),
                })
            })?;
            Some(
                crate::axes3d::read(a, item, req.item, req.channels).map_err(|r| {
                    deep_canvas::outline::Refusal {
                        code: r.code,
                        what: r.path.clone(),
                        path: r.path,
                    }
                })?,
            )
        }
        None => None,
    };
    let place = |p: &P3| -> [f64; 3] {
        match &axes {
            Some(a) => a.place(*p).unwrap_or([f64::NAN; 3]),
            None => *p,
        }
    };
    let mut out = Vec::new();
    for (i, s) in vf.streams().iter().enumerate() {
        let points: Vec<Value> = s
            .iter()
            .map(place)
            .filter(|q| q.iter().all(|c| c.is_finite()))
            .map(|q| serde_json::json!(q))
            .collect();
        if points.len() < 2 {
            continue;
        }
        out.push(Mark {
            sub: format!("s{i}"),
            kind: "mark.line@1",
            at: [0.0; 3],
            params: serde_json::json!({"points": points, "width": 2.0, "role": "ink"}),
            opacity: 1.0,
        });
    }
    if let Some(arrows) = &vf.arrows {
        for (i, a) in arrows.at(&vf.field).iter().enumerate() {
            let role = ramp_role(&arrows.ramp, arrows.domain, a.value);
            out.push(Mark {
                sub: format!("a{i}"),
                kind: "mark.line@1",
                at: [0.0; 3],
                params: serde_json::json!({
                    "points": [place(&a.tail), place(&a.tip)],
                    "width": [3.0, 0.0],
                    "role": role,
                }),
                opacity: 1.0,
            });
        }
    }
    Ok(out)
}

/// The ramp's nearest role at `v` across `domain`, for a mark that takes one role.
fn ramp_role(ramp: &[String], domain: [f64; 2], v: f64) -> String {
    let t = ((v - domain[0]) / (domain[1] - domain[0])).clamp(0.0, 1.0);
    let i = (t * (ramp.len() - 1) as f64).round() as usize;
    ramp.get(i).cloned().unwrap_or_else(|| "ink".into())
}

// ---- the `follow_stream` entry of `constraint@1`

/// A fixture document: the swirl F = (−y, x) and a dot following it from (2, 0), with `vars` on
/// the field.
fn fixture_doc(speed: f64, vars: Value) -> Value {
    serde_json::json!({
        "transport": {"span": "10s"},
        "items": {
            "f": {"kind": KIND, "params": {"fn": {"x": "-y", "y": "x"}, "vars": vars,
                  "streams": {"starts": [[1, 0]], "step": 0.05, "time": 6.3}}},
            "dot": {"kind": "circle@1", "params": {"r": 4}},
        },
        "constraints": {"go": {"owner": "dot", "kind": FOLLOW, "vector_field": "f",
                               "from": [2, 0], "speed": speed}},
    })
}

/// The entry's fixture, from its solve run for real: the reads it made in order, its op counts
/// at three speeds, the digests of its places at 50 times played in order and sought in a
/// shuffled order, and the check's answer to a two-item cycle through it.
fn fixture() -> Value {
    use sha2::{Digest, Sha256};
    let run = |doc: &Value, seconds: f64, note: &mut dyn FnMut(&'static str)| {
        let spec = follow_spec("go", &doc["constraints"]["go"]).expect("the fixture's follow");
        followed(doc, &spec, seconds, "constraints/go", Method::Rk4, note)
            .expect("the fixture's field")
    };
    let mut order = Vec::new();
    let doc = fixture_doc(1.0, serde_json::json!({}));
    run(&doc, 1.0, &mut |r| order.push(r));
    let ops: Vec<u64> = [0.5, 1.0, 2.0]
        .iter()
        .map(|s| run(&fixture_doc(*s, serde_json::json!({})), 1.0, &mut |_| {}).1)
        .collect();
    let digest = |times: &mut dyn Iterator<Item = u32>| {
        let mut places: BTreeMap<u32, P3> = BTreeMap::new();
        for t in times {
            places.insert(t, run(&doc, 0.2 * f64::from(t), &mut |_| {}).0);
        }
        let mut h = Sha256::new();
        for (t, p) in &places {
            h.update(t.to_le_bytes());
            for c in p {
                h.update(c.to_bits().to_le_bytes());
            }
        }
        h.finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let play = digest(&mut (0..50u32));
    let seek = digest(&mut (0..50u32).map(|i| (i * 31 + 7) % 50));
    // A two-item cycle: the field reads the dot's place back through a var.
    let cyclic = fixture_doc(1.0, serde_json::json!({"k": "items/dot/at/pos/0"}));
    let cycle = match cycles(&cyclic).into_iter().next() {
        Some((_, chain)) => {
            serde_json::json!({"code": deep_canvas::registry::core_lists::CYCLE, "chain": chain})
        }
        None => serde_json::json!({"code": null, "chain": []}),
    };
    let read: Vec<&str> = order.iter().copied().filter(|r| *r != "solve").collect();
    serde_json::json!({
        "read": read, "order": order, "ops": ops, "play": play, "seek": seek, "cycle": cycle,
    })
}

/// The `follow_stream` entry: what it reads and writes, and its fixture.
pub fn entry() -> Value {
    serde_json::json!({"reads": FOLLOW_READS, "writes": ["self.transform"], "fixture": fixture()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn swirl(scale: &str) -> Field {
        Field::compile(
            &json!({"x": format!("-y{scale}"), "y": format!("x{scale}")}),
            &BTreeMap::new(),
            "fn",
        )
        .unwrap()
    }

    fn how(time: f64, step: f64, method: Method) -> Integration {
        Integration {
            step,
            time,
            bounds: None,
            max_points: MAX_POINTS_FEW,
            method,
        }
    }

    #[test]
    fn a_swirl_stream_returns_to_its_start_after_one_turn_and_euler_does_not() {
        let tau = 2.0 * std::f64::consts::PI;
        let f = swirl("");
        let s = stream(&f, [1.0, 0.0, 0.0], &how(tau, 0.05, Method::Rk4));
        let end = s.last().unwrap();
        assert!(
            deep_canvas::ops::hypot(end[0] - 1.0, end[1]) < 1e-4,
            "{end:?}"
        );
        let e = stream(&f, [1.0, 0.0, 0.0], &how(tau, 0.05, Method::Euler));
        let end = e.last().unwrap();
        assert!(
            deep_canvas::ops::hypot(end[0] - 1.0, end[1]) > 0.1,
            "{end:?}"
        );
    }

    #[test]
    fn an_arrow_of_half_the_swirl_points_up_at_its_sigmoid_length() {
        let f = swirl(" / 2");
        let a = Arrows {
            grid: Grid {
                axes: vec![[1.0, 1.0, 1.0], [0.0, 0.0, 1.0]],
            },
            length: Length::Sigmoid,
            max: 0.45,
            color: ColorBy::Magnitude,
            ramp: vec![],
            domain: [0.0, 2.0],
        };
        let arrow = a.at(&f)[0];
        let d = [arrow.tip[0] - arrow.tail[0], arrow.tip[1] - arrow.tail[1]];
        assert!(d[0].abs() < 1e-12 && d[1] > 0.0);
        assert!((d[1] - 0.45 * sigmoid(0.5)).abs() < 1e-12);
        assert_eq!(arrow.value, 0.5);
    }

    #[test]
    fn a_followed_dot_is_a_quarter_turn_on_at_half_pi() {
        let follow = Follow::build(swirl(""), [2.0, 0.0, 0.0], 0.05, 10.0, Method::Rk4);
        let (p, _) = follow.at(std::f64::consts::FRAC_PI_2);
        assert!(p[0].abs() < 1e-6 && (p[1] - 2.0).abs() < 1e-6, "{p:?}");
    }

    #[test]
    fn the_lorenz_stream_is_one_stream_within_its_cap() {
        let f = Field::compile(
            &json!({"x": "10 * (y - x)", "y": "x * (28 - z) - y", "z": "x * y - 8 / 3 * z"}),
            &BTreeMap::new(),
            "fn",
        )
        .unwrap();
        let s = stream(&f, [1.0, 1.0, 1.0], &how(40.0, 0.005, Method::Rk4));
        assert_eq!(s.len(), 8001);
    }

    #[test]
    fn a_flow_window_seeks_as_it_plays() {
        let flow = Flow {
            speed: 1.0,
            flash: 0.3,
            phase: Phase::Hashed,
            warm_up: true,
        };
        let w = flow.window(3, 7.3, 3.0);
        let u = 7.3 / 3.0 + phase_of(3);
        assert_eq!(w[0], u - u.floor());
        assert_eq!(w[1], w[0] + 0.3);
    }
}
