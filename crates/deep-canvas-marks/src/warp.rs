//! Issue #223: a group's warp (canvas primitives: Frame and group: warp). Every path and vector
//! outline under the group maps point by point to p′ = mix(p, f(p), mix) in the group's space read
//! through its plane, through a formula (`map`), a matrix mixed from the identity (`linear`) or a
//! complex function of z = x + iy (`complex`), and may flow along a stream table (`flow`).
//!
//! Each cubic maps to the cubic through its ends' images along its tangents' images, each sampled
//! 1% along its handle. Where that strays from the true image at a third or two thirds of the way
//! by more than `tolerance`, every cubic of the path is cut into 2, 4, 8 … equal pieces, the same
//! count for all, up to 256. The true image there is the map's interval form at that point, a
//! range certain to hold it, so rounding never hides a stray. A cubic matched at its ends and
//! tangents strays most at its middle, by 81/64 of its stray at a third, so the stray is scaled by
//! that before it is compared: each piece then holds within `tolerance` all along. A linear map
//! carries a cubic exactly by its control points, so it is never cut and lines stay straight.
//!
//! Strokes are drawn after mapping, at their authored width; the scene calls this before it builds
//! heads, so `ends: redraw` draws them along the mapped tangent at their own size.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas::expr::{Expr, Nothing, B, V};
use deep_canvas::interval::Iv;
use deep_canvas::streams;
use serde_json::{Map, Value};

use crate::key::{ContentKey, KeyBuilder};
use crate::path::Verb;
use crate::scene::{num, Refused};

/// The most pieces a cubic is cut into.
pub const MAX_CUTS: usize = 256;
/// The default most mapped points a group takes.
pub const MAX_POINTS: u64 = 200_000;
/// How far along each handle its tangent's image is sampled.
const HANDLE: f64 = 0.01;
/// A matched cubic's stray at its middle over its stray at a third.
const MIDDLE: f64 = 81.0 / 64.0;
/// Below this share of the tolerance a piece's stray at a point holds without its interval form:
/// that form's range at a point is the point's value widened by rounding, far below the rest.
const SURE: f64 = 0.9;
/// The vars a formula's evaluation holds on the stack.
const FEW: usize = 6;
/// The most nodes a warp's formula takes, as a field's.
const NODES: usize = 256;
/// The most steps a flow integrates.
pub const MAX_FLOW_STEPS: f64 = 100_000.0;

type P = [f64; 2];

/// What a formula's var reads at a point.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Slot {
    X,
    Y,
    Z,
    Num(f64),
}

#[derive(Clone, Debug)]
struct Formula {
    expr: Expr,
    slots: Vec<Slot>,
}

impl Formula {
    fn compile(
        text: &str,
        vars: &BTreeMap<String, f64>,
        free: &[&str],
        path: &str,
    ) -> Result<Formula, Refused> {
        let expr = Expr::compile(text, &Nothing, NODES).map_err(|_| bad(path))?;
        let slots = expr
            .vars
            .iter()
            .map(|n| match n.as_str() {
                "x" if free.contains(&"x") => Ok(Slot::X),
                "y" if free.contains(&"y") => Ok(Slot::Y),
                "z" if free.contains(&"z") => Ok(Slot::Z),
                other => vars
                    .get(other)
                    .map(|v| Slot::Num(*v))
                    .ok_or_else(|| Refused {
                        code: "ref_unresolved",
                        path: path.to_string(),
                    }),
            })
            .collect::<Result<_, _>>()?;
        Ok(Formula { expr, slots })
    }

    fn at(&self, q: P) -> V {
        let fill = |s: &Slot| match *s {
            Slot::X => V::S(q[0]),
            Slot::Y => V::S(q[1]),
            Slot::Z => V::V(2, [q[0], q[1], 0.0, 0.0]),
            Slot::Num(v) => V::S(v),
        };
        let mut few = [V::S(0.0); FEW];
        if self.slots.len() <= few.len() {
            for (slot, s) in few.iter_mut().zip(&self.slots) {
                *slot = fill(s);
            }
            return self.expr.eval(&few[..self.slots.len()]);
        }
        let v: Vec<V> = self.slots.iter().map(fill).collect();
        self.expr.eval(&v)
    }

    fn over(&self, q: P) -> B {
        let fill = |s: &Slot| match *s {
            Slot::X => B::S(Iv::point(q[0])),
            Slot::Y => B::S(Iv::point(q[1])),
            Slot::Z => B::V(2, [Iv::point(q[0]), Iv::point(q[1]), Iv::EMPTY, Iv::EMPTY]),
            Slot::Num(v) => B::S(Iv::point(v)),
        };
        let mut few = [B::S(Iv::EMPTY); FEW];
        if self.slots.len() <= few.len() {
            for (slot, s) in few.iter_mut().zip(&self.slots) {
                *slot = fill(s);
            }
            return self.expr.bound(&few[..self.slots.len()]);
        }
        let v: Vec<B> = self.slots.iter().map(fill).collect();
        self.expr.bound(&v)
    }
}

/// A value read as a point: a vec2, or a number as (x, 0).
fn as_point(v: V) -> P {
    match v {
        V::S(x) => [x, 0.0],
        V::V(_, c) => [c[0], c[1]],
    }
}

fn as_box(b: B) -> [Iv; 2] {
    match b {
        B::S(x) => [x, Iv::point(0.0)],
        B::V(_, c) => [c[0], c[1]],
    }
}

#[derive(Clone, Debug)]
enum Map2 {
    Formula { x: Formula, y: Formula },
    Linear([[f64; 2]; 2]),
    Complex(Formula),
    Identity,
}

/// A flow along a stream table's field, for `time`, by RK4 at the table's step.
#[derive(Clone, Debug)]
struct Flow {
    x: Formula,
    y: Formula,
    step: f64,
    time: f64,
    /// What keys it: the table's bytes.
    table: Vec<u8>,
}

impl Flow {
    fn field(&self, q: P) -> P {
        [self.x.at(q).num(), self.y.at(q).num()]
    }

    fn carry(&self, mut q: P) -> P {
        let whole = (self.time.abs() / self.step).floor();
        let sign = self.time.signum();
        let steps = (0..whole as u64)
            .map(|_| self.step)
            .chain(std::iter::once(self.time.abs() - whole * self.step).filter(|h| *h > 0.0));
        for h in steps {
            let h = h * sign;
            let a = |p: P, k: P, s: f64| [p[0] + k[0] * s, p[1] + k[1] * s];
            let k1 = self.field(q);
            let k2 = self.field(a(q, k1, h / 2.0));
            let k3 = self.field(a(q, k2, h / 2.0));
            let k4 = self.field(a(q, k3, h));
            q = [
                q[0] + h / 6.0 * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]),
                q[1] + h / 6.0 * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]),
            ];
        }
        q
    }
}

/// How a head is drawn under a warp.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ends {
    /// At the mapped end along the mapped tangent, at its own size.
    Redraw,
    /// Built before the warp, and carried through it with the path.
    Warp,
}

/// A group's `params.warp`, read and compiled.
#[derive(Clone, Debug)]
pub struct Warp {
    map: Map2,
    flow: Option<Flow>,
    mix: f64,
    origin: P,
    unit: f64,
    /// −1 with y up (the screen's y runs down), 1 with `y: down`.
    y: f64,
    pub tolerance: f64,
    pub max_points: u64,
    pub ends: Ends,
    /// The planted twin that maps only each verb's own points (#223 AC1).
    anchors_only: bool,
    /// What keys it, beside the points it carries.
    feed: String,
}

fn bad(path: &str) -> Refused {
    Refused {
        code: "bad_doc",
        path: path.to_string(),
    }
}

fn text<'a>(v: Option<&'a Value>, path: &str) -> Result<&'a str, Refused> {
    v.and_then(Value::as_str).ok_or_else(|| bad(path))
}

/// The planted wrong programs a warp's proofs fail on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Each verb's own points mapped, with no cut and no handle carried.
    pub anchors_only: bool,
    /// A flow that finds its stream table by the `vector_field@1` kind, not by its layout.
    pub flow_by_kind: bool,
}

impl Warp {
    /// The warp of group `id`, or `None`. A var reads a number, or an item's field as
    /// `items/<id>/<field…>` among `items`; the frame's evaluator binds time, channels and
    /// controls to numbers before the scene reads them.
    pub fn read(
        id: &str,
        params: &Map<String, Value>,
        items: &Map<String, Value>,
        planted: Planted,
    ) -> Result<Option<Warp>, Refused> {
        let path = format!("items/{id}/params/warp");
        let w = match params.get("warp") {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(w)) => w,
            Some(_) => return Err(bad(&path)),
        };
        let at = |f: &str| format!("{path}/{f}");
        let mut vars = BTreeMap::new();
        if let Some(v) = w.get("vars").filter(|v| !v.is_null()) {
            let v = v.as_object().ok_or_else(|| bad(&at("vars")))?;
            for (name, value) in v {
                let p = at(&format!("vars/{name}"));
                let n = match value {
                    Value::String(s) if s.starts_with("items/") => {
                        let (item, field) = s[6..].split_once('/').unwrap_or((&s[6..], ""));
                        num(items
                            .get(item)
                            .and_then(|i| i.pointer(&format!("/{field}"))))
                    }
                    // Seeking a still frame of a document nothing evaluated reads time 0.
                    Value::String(s) if s == "time" => Some(0.0),
                    v => num(Some(v)),
                };
                vars.insert(
                    name.clone(),
                    n.ok_or(Refused {
                        code: "ref_unresolved",
                        path: p,
                    })?,
                );
            }
        }
        // `map: {x, y} | linear {matrix} | complex {f}`: the map, or the map as `{linear: …}` or
        // `{complex: …}`; the warp's own `linear` or `complex` reads the same.
        let (form, form_path) = match w.get("map").filter(|m| !m.is_null()) {
            Some(Value::Object(m)) => (Some(m), at("map")),
            Some(_) => return Err(bad(&at("map"))),
            None => (None, path.clone()),
        };
        let form = form.unwrap_or(w);
        let linear = form.get("linear").filter(|v| !v.is_null());
        let complex = form.get("complex").filter(|v| !v.is_null());
        let formula = form.contains_key("x") || form.contains_key("y");
        if [linear.is_some(), complex.is_some(), formula]
            .iter()
            .filter(|b| **b)
            .count()
            > 1
        {
            return Err(bad(&form_path));
        }
        let mut feed = String::new();
        let map = if let Some(l) = linear {
            let p = format!("{form_path}/linear/matrix");
            let m = l
                .get("matrix")
                .and_then(Value::as_array)
                .ok_or_else(|| bad(&p))?;
            let row = |i: usize| -> Result<[f64; 2], Refused> {
                let r = m
                    .get(i)
                    .and_then(Value::as_array)
                    .filter(|r| r.len() == 2)
                    .ok_or_else(|| bad(&p))?;
                Ok([
                    num(r.first()).ok_or_else(|| bad(&p))?,
                    num(r.get(1)).ok_or_else(|| bad(&p))?,
                ])
            };
            if m.len() != 2 {
                return Err(bad(&p));
            }
            let mm = [row(0)?, row(1)?];
            feed += &format!("linear {mm:?};");
            Map2::Linear(mm)
        } else if let Some(c) = complex {
            let p = format!("{form_path}/complex/f");
            let f = text(c.get("f"), &p)?;
            feed += &format!("complex {f};");
            Map2::Complex(Formula::compile(f, &vars, &["z"], &p)?)
        } else if formula {
            let (px, py) = (format!("{form_path}/x"), format!("{form_path}/y"));
            let (x, y) = (text(form.get("x"), &px)?, text(form.get("y"), &py)?);
            feed += &format!("map {x}; {y};");
            Map2::Formula {
                x: Formula::compile(x, &vars, &["x", "y"], &px)?,
                y: Formula::compile(y, &vars, &["x", "y"], &py)?,
            }
        } else {
            Map2::Identity
        };
        let flow = match w.get("flow").filter(|f| !f.is_null()) {
            None => None,
            Some(f) => Some(flow_of(f, items, &at("flow"), planted)?),
        };
        if matches!(map, Map2::Identity) && flow.is_none() {
            return Err(bad(&path));
        }
        let mix = match w.get("mix") {
            None | Some(Value::Null) => 1.0,
            v => num(v).ok_or_else(|| bad(&at("mix")))?.clamp(0.0, 1.0),
        };
        let plane = w.get("plane").filter(|p| !p.is_null());
        let origin = match plane.and_then(|p| p.get("origin")) {
            None | Some(Value::Null) => [0.0, 0.0],
            Some(o) => {
                let a = o
                    .as_array()
                    .filter(|a| a.len() == 2)
                    .ok_or_else(|| bad(&at("plane/origin")))?;
                [num(a.first()), num(a.get(1))]
                    .map(|v| v.ok_or_else(|| bad(&at("plane/origin"))))
                    .into_iter()
                    .collect::<Result<Vec<_>, _>>()
                    .map(|v| [v[0], v[1]])?
            }
        };
        let unit = match plane.and_then(|p| p.get("unit")) {
            None | Some(Value::Null) => 100.0,
            v => num(v)
                .filter(|u| *u > 0.0)
                .ok_or_else(|| bad(&at("plane/unit")))?,
        };
        let y = match plane.and_then(|p| p.get("y")).and_then(Value::as_str) {
            None | Some("up") => -1.0,
            Some("down") => 1.0,
            Some(_) => return Err(bad(&at("plane/y"))),
        };
        let tolerance = match w.get("tolerance") {
            None | Some(Value::Null) => 0.5,
            v => num(v)
                .filter(|t| *t > 0.0)
                .ok_or_else(|| bad(&at("tolerance")))?,
        };
        let max_points = match w.get("max_points") {
            None | Some(Value::Null) => MAX_POINTS,
            Some(v) => v.as_u64().ok_or_else(|| bad(&at("max_points")))?,
        };
        let ends = match w.get("ends").and_then(Value::as_str) {
            None | Some("redraw") => Ends::Redraw,
            Some("warp") => Ends::Warp,
            Some(_) => return Err(bad(&at("ends"))),
        };
        for (n, v) in &vars {
            feed += &format!("{n}={v};");
        }
        if let Some(f) = &flow {
            feed += &format!("flow {} {};", f.time, f.step);
        }
        feed += &format!("{mix} {origin:?} {unit} {y} {tolerance} {ends:?}");
        Ok(Some(Warp {
            map,
            flow,
            mix,
            origin,
            unit,
            y,
            tolerance,
            max_points,
            ends,
            anchors_only: planted.anchors_only,
            feed,
        }))
    }

    /// Whether it changes nothing, at mix 0.
    pub fn is_identity(&self) -> bool {
        self.mix == 0.0
    }

    fn to_plane(&self, p: P) -> P {
        [
            (p[0] - self.origin[0]) / self.unit,
            self.y * (p[1] - self.origin[1]) / self.unit,
        ]
    }

    fn from_plane(&self, q: P) -> P {
        [
            self.origin[0] + q[0] * self.unit,
            self.origin[1] + self.y * q[1] * self.unit,
        ]
    }

    /// f(q) in the plane, flowed.
    fn image(&self, q: P) -> P {
        let f = match &self.map {
            Map2::Formula { x, y } => [x.at(q).num(), y.at(q).num()],
            Map2::Linear(m) => [
                m[0][0] * q[0] + m[0][1] * q[1],
                m[1][0] * q[0] + m[1][1] * q[1],
            ],
            Map2::Complex(f) => as_point(f.at(q)),
            Map2::Identity => q,
        };
        match &self.flow {
            Some(flow) => flow.carry(f),
            None => f,
        }
    }

    /// Where a point of the group's space lands.
    pub fn point(&self, p: P) -> P {
        let q = self.to_plane(p);
        let f = self.image(q);
        self.from_plane([
            q[0] + self.mix * (f[0] - q[0]),
            q[1] + self.mix * (f[1] - q[1]),
        ])
    }

    /// A range of the group's space certain to hold where `p` lands: the map's interval form at
    /// the point, mixed. A flow has no interval form, so its image stands for itself.
    fn enclosure(&self, p: P) -> [Iv; 2] {
        let q = self.to_plane(p);
        let f = match (&self.map, &self.flow) {
            (Map2::Formula { x, y }, None) => [x.over(q).num(), y.over(q).num()],
            (Map2::Complex(f), None) => as_box(f.over(q)),
            _ => self.image(q).map(Iv::point),
        };
        let mixed = [0, 1].map(|i| {
            Iv::point(1.0 - self.mix)
                .mul(Iv::point(q[i]))
                .add(Iv::point(self.mix).mul(f[i]))
        });
        let o = [Iv::point(self.origin[0]), Iv::point(self.origin[1])];
        [
            o[0].add(mixed[0].mul(Iv::point(self.unit))),
            o[1].add(mixed[1].mul(Iv::point(self.y * self.unit))),
        ]
    }

    /// What keys this warp's output beside the points it carries.
    pub fn feed(&self, k: &mut KeyBuilder) {
        k.text(&self.feed).int(i64::from(self.anchors_only));
        if let Some(f) = &self.flow {
            k.bytes(&f.table);
        }
    }

    /// `verbs` in the group's space carried through the warp, with `tolerance` already in that
    /// space's u: the carried verbs, the cut count and the points they hold.
    pub fn carry(&self, verbs: &[Verb], tolerance: f64) -> (Vec<Verb>, usize, u64) {
        let subs = subs(verbs);
        let points = |out: &[Verb]| out.iter().map(|v| verb_points(v) as u64).sum();
        if self.is_identity() {
            return (verbs.to_vec(), 1, points(verbs));
        }
        if matches!(self.map, Map2::Linear(_)) && self.flow.is_none() || self.anchors_only {
            let out = pointwise(verbs, |p| self.point(p));
            let n = points(&out);
            return (out, 1, n);
        }
        let mut n = 1;
        let pieces = loop {
            match self.cut(&subs, n, tolerance, n >= MAX_CUTS) {
                Some(p) => break p,
                None => n *= 2,
            }
        };
        let mut out = Vec::new();
        for (s, (start, ps)) in subs.iter().zip(&pieces) {
            out.push(Verb::Move(*start));
            out.extend(ps.iter().map(|c| Verb::Cubic(c[0], c[1], c[2])));
            if s.closed {
                out.push(Verb::Close);
            }
        }
        let count = points(&out);
        (out, n, count)
    }

    /// Every sub-path's start mapped and its cubics cut `n` ways and mapped, or `None` where a
    /// piece strays past `tolerance` (unless `last`, which keeps them all).
    fn cut(
        &self,
        subs: &[Sub],
        n: usize,
        tolerance: f64,
        last: bool,
    ) -> Option<Vec<(P, Vec<[P; 3]>)>> {
        let mut out = Vec::with_capacity(subs.len());
        for s in subs {
            let mut ps = Vec::with_capacity(s.segs.len() * n);
            let first = self.point(s.start);
            // Each cubic starts where the one before it ends, so its start is mapped once.
            let mut start = first;
            for c in &s.segs {
                for k in 0..n {
                    let piece = piece_of(c, k, n);
                    let end = self.point(piece[3]);
                    let m = self.mapped(&piece, start, end);
                    if !last && self.strays(&piece, &m, tolerance) {
                        return None;
                    }
                    ps.push([m[1], m[2], m[3]]);
                    start = end;
                }
            }
            out.push((first, ps));
        }
        Some(out)
    }

    /// The cubic through the images of a piece's ends along its tangents' images.
    fn mapped(&self, c: &[P; 4], p0: P, p3: P) -> [P; 4] {
        let along = |a: P, b: P| [a[0] + HANDLE * (b[0] - a[0]), a[1] + HANDLE * (b[1] - a[1])];
        let handle = |end: P, sample: P| {
            [
                end[0] + (sample[0] - end[0]) / HANDLE,
                end[1] + (sample[1] - end[1]) / HANDLE,
            ]
        };
        let p1 = handle(p0, self.point(along(c[0], c[1])));
        let p2 = handle(p3, self.point(along(c[3], c[2])));
        [p0, p1, p2, p3]
    }

    fn strays(&self, c: &[P; 4], m: &[P; 4], tolerance: f64) -> bool {
        [1.0 / 3.0, 2.0 / 3.0].iter().any(|s| {
            let at = bezier(c, *s);
            let got = bezier(m, *s);
            // The point's own image settles a piece well inside the tolerance or well past it; the
            // interval form, a range certain to hold the true image, decides the ones near it.
            let image = self.point(at);
            let near = deep_canvas::ops::hypot(got[0] - image[0], got[1] - image[1]) * MIDDLE;
            if near <= SURE * tolerance {
                return false;
            }
            if !(near <= tolerance) {
                return true;
            }
            let want = self.enclosure(at);
            if !want.iter().all(Iv::is_bounded) || want.iter().any(Iv::is_empty) {
                return true;
            }
            let d = [0, 1].map(|i| (got[i] - want[i].lo).abs().max((got[i] - want[i].hi).abs()));
            let far = deep_canvas::ops::hypot(d[0], d[1]);
            !(far * MIDDLE <= tolerance)
        })
    }
}

fn flow_of(
    f: &Value,
    items: &Map<String, Value>,
    path: &str,
    planted: Planted,
) -> Result<Flow, Refused> {
    let at = |k: &str| format!("{path}/{k}");
    let id = text(f.get("streams"), &at("streams"))?;
    let unresolved = || Refused {
        code: "ref_unresolved",
        path: format!("{}: {id}", at("streams")),
    };
    let item = items.get(id).ok_or_else(unresolved)?;
    if planted.flow_by_kind && item.get("kind").and_then(Value::as_str) != Some("vector_field@1") {
        return Err(unresolved());
    }
    // By its data layout, never by the kind that built it.
    let table = item
        .pointer("/params/streams")
        .and_then(streams::from_json)
        .ok_or_else(unresolved)?;
    let time = num(f.get("time")).ok_or_else(|| bad(&at("time")))?;
    if time.abs() / table.step > MAX_FLOW_STEPS {
        return Err(Refused {
            code: "out_of_range",
            path: at("time"),
        });
    }
    let vars: BTreeMap<String, f64> = table.vars.iter().cloned().collect();
    let x = Formula::compile(&table.fn_x, &vars, &["x", "y"], &at("streams"))?;
    let y = Formula::compile(&table.fn_y, &vars, &["x", "y"], &at("streams"))?;
    Ok(Flow {
        x,
        y,
        step: table.step,
        time,
        table: streams::encode(&table),
    })
}

/// A sub-path as cubics `[start, c1, c2, end]`; a line is a cubic with its handles at its thirds.
struct Sub {
    start: P,
    segs: Vec<[P; 4]>,
    closed: bool,
}

fn line(a: P, b: P) -> [P; 4] {
    let at = |s: f64| [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])];
    [a, at(1.0 / 3.0), at(2.0 / 3.0), b]
}

fn subs(verbs: &[Verb]) -> Vec<Sub> {
    let mut out: Vec<Sub> = Vec::new();
    let mut at = [0.0, 0.0];
    for v in verbs {
        match *v {
            Verb::Move(p) => {
                out.push(Sub {
                    start: p,
                    segs: Vec::new(),
                    closed: false,
                });
                at = p;
            }
            Verb::Line(p) => {
                if out.is_empty() {
                    out.push(Sub {
                        start: at,
                        segs: Vec::new(),
                        closed: false,
                    });
                }
                out.last_mut().map(|s| s.segs.push(line(at, p)));
                at = p;
            }
            Verb::Quad(c, p) => {
                if out.is_empty() {
                    out.push(Sub {
                        start: at,
                        segs: Vec::new(),
                        closed: false,
                    });
                }
                let c1 = [
                    at[0] + 2.0 / 3.0 * (c[0] - at[0]),
                    at[1] + 2.0 / 3.0 * (c[1] - at[1]),
                ];
                let c2 = [
                    p[0] + 2.0 / 3.0 * (c[0] - p[0]),
                    p[1] + 2.0 / 3.0 * (c[1] - p[1]),
                ];
                out.last_mut().map(|s| s.segs.push([at, c1, c2, p]));
                at = p;
            }
            Verb::Cubic(a, b, p) => {
                if out.is_empty() {
                    out.push(Sub {
                        start: at,
                        segs: Vec::new(),
                        closed: false,
                    });
                }
                out.last_mut().map(|s| s.segs.push([at, a, b, p]));
                at = p;
            }
            Verb::Close => {
                if let Some(s) = out.last_mut() {
                    if at != s.start {
                        s.segs.push(line(at, s.start));
                    }
                    s.closed = true;
                    at = s.start;
                }
            }
        }
    }
    out
}

fn lerp(a: P, b: P, s: f64) -> P {
    [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]
}

fn bezier(c: &[P; 4], s: f64) -> P {
    let (a, b, d) = (
        lerp(c[0], c[1], s),
        lerp(c[1], c[2], s),
        lerp(c[2], c[3], s),
    );
    let (e, f) = (lerp(a, b, s), lerp(b, d, s));
    lerp(e, f, s)
}

/// The piece `k` of `n` equal pieces of a cubic, by parameter.
fn piece_of(c: &[P; 4], k: usize, n: usize) -> [P; 4] {
    if n == 1 {
        return *c;
    }
    let (s0, s1) = (k as f64 / n as f64, (k + 1) as f64 / n as f64);
    // Split at s1, keep the first part, then split that at s0 / s1 and keep the second.
    let split = |c: &[P; 4], s: f64| -> ([P; 4], [P; 4]) {
        let (a, b, d) = (
            lerp(c[0], c[1], s),
            lerp(c[1], c[2], s),
            lerp(c[2], c[3], s),
        );
        let (e, f) = (lerp(a, b, s), lerp(b, d, s));
        let g = lerp(e, f, s);
        ([c[0], a, e, g], [g, f, d, c[3]])
    };
    let (head, _) = if k + 1 == n { (*c, *c) } else { split(c, s1) };
    if k == 0 {
        return head;
    }
    let (_, piece) = split(&head, s0 / s1);
    piece
}

fn verb_points(v: &Verb) -> usize {
    match v {
        Verb::Move(_) | Verb::Line(_) => 1,
        Verb::Quad(..) => 2,
        Verb::Cubic(..) => 3,
        Verb::Close => 0,
    }
}

/// Each verb's own points through `f`.
pub fn pointwise(verbs: &[Verb], f: impl Fn(P) -> P) -> Vec<Verb> {
    verbs
        .iter()
        .map(|v| match *v {
            Verb::Move(p) => Verb::Move(f(p)),
            Verb::Line(p) => Verb::Line(f(p)),
            Verb::Quad(a, b) => Verb::Quad(f(a), f(b)),
            Verb::Cubic(a, b, c) => Verb::Cubic(f(a), f(b), f(c)),
            Verb::Close => Verb::Close,
        })
        .collect()
}

/// Whether `item` is a group whose warp reads time through a var.
pub fn reads_time(item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("group@1")
        && item
            .pointer("/params/warp/vars")
            .and_then(Value::as_object)
            .is_some_and(|v| v.values().any(|v| v.as_str() == Some("time")))
}

/// Whether a warp among `items` reads a var a frame's evaluator binds: time, a control or data.
pub fn binds(items: &Map<String, Value>) -> bool {
    items.values().any(|i| {
        i.pointer("/params/warp/vars")
            .and_then(Value::as_object)
            .is_some_and(|v| {
                v.values()
                    .any(|v| v.as_str().is_some_and(|s| !s.starts_with("items/")))
            })
    })
}

/// Each warp's vars that read time (`time`, in seconds), a control (`controls/<id>/value`) or data
/// (`data/<name>`) bound to the number they read at the frame, as `value` reads them; one that
/// reads nothing is left for the scene to refuse.
pub fn bind(items: &mut Map<String, Value>, seconds: f64, value: &dyn Fn(&str) -> Option<f64>) {
    for item in items.values_mut() {
        let Some(Value::Object(vars)) = item.pointer_mut("/params/warp/vars") else {
            continue;
        };
        for v in vars.values_mut() {
            let n = match v.as_str() {
                Some("time") => Some(seconds),
                Some(p) if !p.starts_with("items/") => value(p),
                _ => continue,
            };
            if let Some(n) = n.and_then(serde_json::Number::from_f64) {
                *v = Value::Number(n);
            }
        }
    }
}

/// A frame's warps, each group's read once per build with where the group draws, and the points
/// each item under it carries, which the frame checks against the group's `max_points`.
#[derive(Default)]
pub(crate) struct Warps {
    pub(crate) read: std::cell::RefCell<BTreeMap<String, Option<Arc<(Warp, crate::place::Place)>>>>,
    pub(crate) points: std::cell::RefCell<BTreeMap<String, BTreeMap<String, u64>>>,
}

impl Warps {
    /// The first group over the frame's points past its `max_points`, as a refusal naming it.
    pub(crate) fn over(&self) -> Result<(), Refused> {
        let read = self.read.borrow();
        for (group, items) in self.points.borrow().iter() {
            let Some(Some(w)) = read.get(group) else {
                continue;
            };
            if items.values().sum::<u64>() > w.0.max_points {
                return Err(Refused {
                    code: "out_of_range",
                    path: format!("items/{group}/params/warp/max_points"),
                });
            }
        }
        Ok(())
    }
}

/// Carried paths kept by their content key, so a warp whose inputs didn't change since a frame
/// carried them costs a lookup, and a seek finds what playing made.
static CARRIED: Mutex<BTreeMap<ContentKey, Arc<(Vec<Vec<Verb>>, usize, u64)>>> =
    Mutex::new(BTreeMap::new());
/// The most carried paths kept.
const KEPT: usize = 512;

/// The planted names a proof surface's `planted` field takes for #223's twins.
pub const ANCHORS_ONLY: &str = "warp_maps_anchors_only";
pub const FLOW_BY_KIND: &str = "flow_by_vector_field_kind";
pub const PLANTED: [&str; 2] = [ANCHORS_ONLY, FLOW_BY_KIND];

/// A clock in milliseconds, which a binary that times its frames hands in: checked code reads none.
pub type Clock = fn() -> f64;

/// The clock warps are timed by, and what they mapped since it was last taken: points, and
/// milliseconds by the clock. Process-wide, since a frame may build its items on worker threads.
static CLOCK: Mutex<Option<Clock>> = Mutex::new(None);
static MAPPED: Mutex<Option<(u64, f64)>> = Mutex::new(None);

/// Times warps by `clock` from now on (`None` stops).
pub fn time_with(clock: Option<Clock>) {
    if let Ok(mut c) = CLOCK.lock() {
        *c = clock;
    }
}

/// The points warps mapped since the last take and the milliseconds they took; `None` when no
/// warp was read.
pub fn take_mapped() -> Option<(u64, f64)> {
    MAPPED.lock().ok().and_then(|mut m| m.take())
}

fn note(points: u64, ms: f64) {
    if let Ok(mut m) = MAPPED.lock() {
        let (p, t) = m.unwrap_or((0, 0.0));
        *m = Some((p + points, t + ms));
    }
}

/// What `key` carried, or `make`'s answer kept under it.
pub fn kept(
    key: ContentKey,
    make: impl FnOnce() -> (Vec<Vec<Verb>>, usize, u64),
) -> Arc<(Vec<Vec<Verb>>, usize, u64)> {
    if let Some(hit) = CARRIED.lock().ok().and_then(|m| m.get(&key).cloned()) {
        note(0, 0.0);
        return hit;
    }
    let clock = CLOCK.lock().ok().and_then(|c| *c);
    let started = clock.map(|c| c());
    let made = Arc::new(make());
    note(made.2, started.zip(clock).map_or(0.0, |(s, c)| c() - s));
    if let Ok(mut m) = CARRIED.lock() {
        if m.len() >= KEPT {
            m.clear();
        }
        m.insert(key, made.clone());
    }
    made
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn warp(w: Value) -> Warp {
        let params = json!({"warp": w});
        Warp::read(
            "g",
            params.as_object().unwrap(),
            &Map::new(),
            Planted::default(),
        )
        .unwrap()
        .unwrap()
    }

    fn close(a: P, b: P, tol: f64) -> bool {
        (a[0] - b[0]).abs() <= tol && (a[1] - b[1]).abs() <= tol
    }

    #[test]
    fn a_quarter_turn_mixes_its_matrix_from_the_identity() {
        let w = warp(
            json!({"map": {"linear": {"matrix": [[0, -1], [1, 0]]}}, "mix": 0.5, "plane": {"y": "down", "unit": 1}}),
        );
        assert!(close(w.point([1.0, 0.0]), [0.5, 0.5], 1e-12));
        let s = warp(
            json!({"map": {"linear": {"matrix": [[2, 1], [1, 1]]}}, "mix": 0.5, "plane": {"y": "down", "unit": 1}}),
        );
        assert!(close(s.point([1.0, 0.0]), [1.5, 0.5], 1e-12));
    }

    #[test]
    fn times_i_turns_counterclockwise_on_screen_with_y_up() {
        let up = warp(json!({"map": {"complex": {"f": "cmul(vec2(0, 1), z)"}}}));
        assert!(close(up.point([100.0, 0.0]), [0.0, -100.0], 1e-9));
        let down =
            warp(json!({"map": {"complex": {"f": "cmul(vec2(0, 1), z)"}}, "plane": {"y": "down"}}));
        assert!(close(down.point([100.0, 0.0]), [0.0, 100.0], 1e-9));
    }

    #[test]
    fn a_flow_turns_a_point_about_the_origin_along_minus_y_x() {
        let table = streams::Table {
            fn_x: "-y".into(),
            fn_y: "x".into(),
            vars: Vec::new(),
            step: 0.01,
            streams: Vec::new(),
        };
        let items = json!({"f": {"kind": "test.streams@1", "params": {"streams": streams::to_json(&table)}}});
        let params =
            json!({"warp": {"flow": {"streams": "f", "time": std::f64::consts::FRAC_PI_2}}});
        let w = Warp::read(
            "g",
            params.as_object().unwrap(),
            items.as_object().unwrap(),
            Planted::default(),
        )
        .unwrap()
        .unwrap();
        assert!(
            close(w.point([100.0, 0.0]), [0.0, -100.0], 1e-6),
            "{:?}",
            w.point([100.0, 0.0])
        );
        let by_kind = Planted {
            flow_by_kind: true,
            ..Planted::default()
        };
        let refused = Warp::read(
            "g",
            params.as_object().unwrap(),
            items.as_object().unwrap(),
            by_kind,
        )
        .unwrap_err();
        assert!(
            refused.path.ends_with(": f"),
            "the refusal names the item: {}",
            refused.path
        );
    }

    /// The densest deviation of each carried piece from the true image, in u.
    fn worst(w: &Warp, verbs: &[Verb], out: &[Verb]) -> f64 {
        let truth = subs(verbs);
        let got = subs(out);
        let mut worst: f64 = 0.0;
        for (t, g) in truth.iter().zip(&got) {
            let n = g.segs.len() / t.segs.len();
            for (i, c) in t.segs.iter().enumerate() {
                for k in 0..n {
                    let piece = piece_of(c, k, n);
                    let m = g.segs[i * n + k];
                    for j in 0..=64 {
                        let s = j as f64 / 64.0;
                        let a = w.point(bezier(&piece, s));
                        let b = bezier(&m, s);
                        worst = worst.max(deep_canvas::ops::hypot(a[0] - b[0], a[1] - b[1]));
                    }
                }
            }
        }
        worst
    }

    #[test]
    fn each_cubic_is_cut_alike_and_holds_within_its_tolerance_all_along() {
        let maps = [
            json!({"map": {"complex": {"f": "cmul(z, z)"}}}),
            json!({"map": {"complex": {"f": "cexp(z)"}}}),
            json!({"map": {"x": "x", "y": "y + 1.5 * u * sin(2 * x - 6 * u)"}, "vars": {"u": 0.4}}),
        ];
        let paths = [
            vec![Verb::Move([-200.0, 100.0]), Verb::Line([200.0, 100.0])],
            vec![
                Verb::Move([100.0, -200.0]),
                Verb::Line([100.0, 200.0]),
                Verb::Line([-50.0, 30.0]),
            ],
            vec![
                Verb::Move([-150.0, 0.0]),
                Verb::Cubic([-100.0, 150.0], [80.0, -150.0], [150.0, 20.0]),
                Verb::Close,
            ],
        ];
        for m in &maps {
            let w = warp(m.clone());
            for verbs in &paths {
                let (out, n, _) = w.carry(verbs, 0.5);
                assert!(n.is_power_of_two() && n <= MAX_CUTS, "{m}: {n}");
                let segs: usize = subs(verbs).iter().map(|s| s.segs.len()).sum();
                let cubics = out.iter().filter(|v| matches!(v, Verb::Cubic(..))).count();
                assert_eq!(cubics, segs * n, "{m}: every cubic is cut {n} ways");
                if n < MAX_CUTS {
                    assert!(
                        worst(&w, verbs, &out) <= 0.5,
                        "{m}: {}",
                        worst(&w, verbs, &out)
                    );
                }
            }
        }
    }

    #[test]
    fn the_anchors_only_twin_strays_where_a_line_bends() {
        let params = json!({"warp": {"map": {"complex": {"f": "cmul(z, z)"}}}});
        let twin = Planted {
            anchors_only: true,
            ..Planted::default()
        };
        let w = Warp::read("g", params.as_object().unwrap(), &Map::new(), twin)
            .unwrap()
            .unwrap();
        let verbs = vec![Verb::Move([100.0, -200.0]), Verb::Line([100.0, 200.0])];
        let (out, n, _) = w.carry(&verbs, 0.5);
        assert_eq!(n, 1);
        assert!(
            matches!(out[1], Verb::Line(_)),
            "the twin keeps a straight chord"
        );
        let mid = w.point([100.0, 0.0]);
        let chord = lerp(w.point([100.0, -200.0]), w.point([100.0, 200.0]), 0.5);
        assert!(deep_canvas::ops::hypot(mid[0] - chord[0], mid[1] - chord[1]) > 5.0);
    }
}
