//! Issue #221: placement by relation (canvas primitives: Item and kind: relations; Constraint).
//! An item is placed against another item's box, a point or the frame by `at.place` (beside,
//! edge, onto) and `at.align`, solved every frame from evaluated bounds at t in one dependency
//! order: after its targets and before the item's own constraints, with `at.pos` added after.
//! Box points are the nine of a closed list, read from geometry only (no stroke width, halo,
//! drop or glow). A cycle through relations or parents is refused as `relation_cycle`, naming
//! the chain. Every solve runs a fixed number of ops and reads nothing from an earlier frame;
//! these are the marks2d module's entries in `constraint@1`, each with the fixture its kit reads.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::path::Verb;

/// A box `[x, y, w, h]` in document u, y down.
pub type Box4 = [f64; 4];

/// The code a cycle through relations is refused with.
pub const CYCLE: &str = deep_canvas::registry::core_lists::RELATION_CYCLE;

/// The nine box points (closed: determinism).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Point {
    N,
    Ne,
    E,
    Se,
    S,
    Sw,
    W,
    Nw,
    C,
}

/// The box points by name.
pub const POINTS: [(&str, Point); 9] = [
    ("n", Point::N),
    ("ne", Point::Ne),
    ("e", Point::E),
    ("se", Point::Se),
    ("s", Point::S),
    ("sw", Point::Sw),
    ("w", Point::W),
    ("nw", Point::Nw),
    ("c", Point::C),
];

impl Point {
    /// A box point by its name, with or without its `#`.
    pub fn parse(name: &str) -> Option<Point> {
        let name = name.strip_prefix('#').unwrap_or(name);
        POINTS.iter().find(|(n, _)| *n == name).map(|(_, p)| *p)
    }

    /// Which way it points from the box's centre, x right and y down.
    fn dir(self) -> [f64; 2] {
        match self {
            Point::N => [0.0, -1.0],
            Point::Ne => [1.0, -1.0],
            Point::E => [1.0, 0.0],
            Point::Se => [1.0, 1.0],
            Point::S => [0.0, 1.0],
            Point::Sw => [-1.0, 1.0],
            Point::W => [-1.0, 0.0],
            Point::Nw => [-1.0, -1.0],
            Point::C => [0.0, 0.0],
        }
    }

    /// Where it sits on `b`.
    pub fn of(self, b: Box4) -> [f64; 2] {
        let d = self.dir();
        [
            b[0] + b[2] * (d[0] + 1.0) / 2.0,
            b[1] + b[3] * (d[1] + 1.0) / 2.0,
        ]
    }
}

/// What a relation reads a box from: an item (or one of its parts), a point, or the frame.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Item { id: String, part: Option<String> },
    At([f64; 2]),
    Frame,
}

/// How `beside` lines up the axis across its side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cross {
    Start,
    Center,
    End,
    Baseline,
}

/// The side `align` lines up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Line {
    N,
    S,
    E,
    W,
    Cx,
    Cy,
}

/// One relation, an entry of `constraint@1`.
#[derive(Clone, Debug, PartialEq)]
pub enum Relation {
    Beside {
        target: Target,
        side: Point,
        gap: f64,
        align: Cross,
        own: Option<String>,
    },
    Edge {
        side: Point,
        margin: f64,
    },
    Onto {
        target: Target,
        point: Point,
    },
    Align {
        to: Target,
        side: Line,
    },
}

impl Relation {
    /// Its entry's name in `constraint@1`.
    pub fn kind(&self) -> &'static str {
        match self {
            Relation::Beside { .. } => "beside",
            Relation::Edge { .. } => "edge",
            Relation::Onto { .. } => "onto",
            Relation::Align { .. } => "align",
        }
    }

    fn target(&self) -> &Target {
        match self {
            Relation::Beside { target, .. } | Relation::Onto { target, .. } => target,
            Relation::Align { to, .. } => to,
            Relation::Edge { .. } => &Target::Frame,
        }
    }
}

/// Why a document's relations can't be read or solved: its code, the path that names it and,
/// for a cycle, the chain of items, its first item again at its end.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub chain: Vec<String>,
}

fn bad(path: String) -> Refusal {
    Refusal {
        code: "bad_doc",
        path,
        chain: Vec::new(),
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn target(v: Option<&Value>, frame: bool, path: &str) -> Result<Target, Refusal> {
    match v {
        Some(Value::String(s)) if frame && s == "frame" => Ok(Target::Frame),
        Some(Value::String(s)) if !s.is_empty() => {
            let (id, part) = match s.split_once('#') {
                Some((id, part)) => (id, Some(part.to_string())),
                None => (s.as_str(), None),
            };
            Ok(Target::Item {
                id: id.to_string(),
                part,
            })
        }
        Some(Value::Array(a)) if a.len() == 2 => match (num(a.first()), num(a.get(1))) {
            (Some(x), Some(y)) => Ok(Target::At([x, y])),
            _ => Err(bad(path.into())),
        },
        _ => Err(bad(path.into())),
    }
}

fn point(
    v: Option<&Value>,
    default: Point,
    corner_or_side: bool,
    path: &str,
) -> Result<Point, Refusal> {
    match v {
        None => Ok(default),
        Some(Value::String(s)) => match Point::parse(s) {
            Some(Point::C) if corner_or_side => Err(bad(path.into())),
            Some(p) => Ok(p),
            None => Err(bad(path.into())),
        },
        Some(_) => Err(bad(path.into())),
    }
}

/// The relations an item, as evaluated, carries: its `at.place`, then each `at.align`, in the
/// order they solve; `safe` is the document's safe margin, `edge`'s default.
pub fn read(id: &str, item: &Value, safe: f64) -> Result<Vec<Relation>, Refusal> {
    let at = format!("items/{id}/at");
    let mut out = Vec::new();
    let Some(at_value) = item.get("at") else {
        return Ok(out);
    };
    if let Some(place) = at_value.get("place") {
        let path = format!("{at}/place");
        let Some(p) = place.as_object() else {
            return Err(bad(path));
        };
        let field = |k: &str| format!("{path}/{k}");
        let gap = |k: &str, default: f64| match p.get(k) {
            None => Ok(default),
            v => num(v).ok_or_else(|| bad(field(k))),
        };
        let relation = match (p.get("beside"), p.get("edge"), p.get("onto")) {
            (Some(b), None, None) => Relation::Beside {
                target: target(Some(b), false, &field("beside"))?,
                side: point(p.get("side"), Point::E, true, &field("side"))?,
                gap: gap("gap", 16.0)?,
                align: match p.get("align").map(Value::as_str) {
                    None | Some(Some("center")) => Cross::Center,
                    Some(Some("start")) => Cross::Start,
                    Some(Some("end")) => Cross::End,
                    Some(Some("baseline")) => Cross::Baseline,
                    _ => return Err(bad(field("align"))),
                },
                own: match p.get("own") {
                    None => None,
                    Some(Value::String(s)) => Some(s.strip_prefix('#').unwrap_or(s).to_string()),
                    Some(_) => return Err(bad(field("own"))),
                },
            },
            (None, Some(e), None) => Relation::Edge {
                side: point(Some(e), Point::N, true, &field("edge"))?,
                margin: gap("margin", safe)?,
            },
            (None, None, Some(o)) => Relation::Onto {
                target: target(Some(o), false, &field("onto"))?,
                point: point(p.get("point"), Point::C, false, &field("point"))?,
            },
            _ => return Err(bad(path)),
        };
        out.push(relation);
    }
    if let Some(align) = at_value.get("align") {
        let path = format!("{at}/align");
        let list = match align {
            Value::Array(list) if list.len() <= 2 => list,
            _ => return Err(bad(path)),
        };
        for (i, a) in list.iter().enumerate() {
            let path = format!("{path}/{i}");
            let side = match a.get("side").and_then(Value::as_str) {
                Some("n") => Line::N,
                Some("s") => Line::S,
                Some("e") => Line::E,
                Some("w") => Line::W,
                Some("cx") => Line::Cx,
                Some("cy") => Line::Cy,
                _ => return Err(bad(format!("{path}/side"))),
            };
            out.push(Relation::Align {
                to: target(a.get("to"), true, &format!("{path}/to"))?,
                side,
            });
        }
    }
    Ok(out)
}

// ------------------------------------------------------------------------------------------------
// One relation's solve.

/// The ops a solve runs, counted: the kit reads that the count never changes with the params.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ops(pub u64);

impl Ops {
    fn add(&mut self, a: f64, b: f64) -> f64 {
        self.0 += 1;
        a + b
    }
    fn sub(&mut self, a: f64, b: f64) -> f64 {
        self.0 += 1;
        a - b
    }
    fn mid(&mut self, a: f64, w: f64) -> f64 {
        self.0 += 2;
        a + w / 2.0
    }
}

/// A box's low, middle and high on an axis.
fn span(ops: &mut Ops, b: Box4, axis: usize) -> [f64; 3] {
    let (lo, w) = (b[axis], b[axis + 2]);
    [lo, ops.mid(lo, w), ops.add(lo, w)]
}

/// What a solve reads beside the boxes: the frame's size, and each text's first baseline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reads {
    pub own: Box4,
    pub target: Box4,
    pub own_baseline: Option<f64>,
    pub target_baseline: Option<f64>,
}

/// How far `relation` moves an item whose box, `at.pos` left out, is `reads.own`: on each axis
/// it places, `None` on one it leaves.
pub fn solve(relation: &Relation, reads: &Reads, ops: &mut Ops) -> [Option<f64>; 2] {
    let (own, to) = (reads.own, reads.target);
    let mut out = [None, None];
    match relation {
        Relation::Beside {
            side, gap, align, ..
        } => {
            let d = side.dir();
            for axis in 0..2 {
                let (o, t) = (span(ops, own, axis), span(ops, to, axis));
                out[axis] = Some(if d[axis] > 0.0 {
                    let at = ops.add(t[2], *gap);
                    ops.sub(at, o[0])
                } else if d[axis] < 0.0 {
                    let at = ops.sub(t[0], *gap);
                    ops.sub(at, o[2])
                } else {
                    match align {
                        Cross::Start => ops.sub(t[0], o[0]),
                        Cross::Center => ops.sub(t[1], o[1]),
                        Cross::End => ops.sub(t[2], o[2]),
                        Cross::Baseline if axis == 1 => {
                            match (reads.target_baseline, reads.own_baseline) {
                                (Some(tb), Some(ob)) => ops.sub(tb, ob),
                                _ => ops.sub(t[2], o[2]),
                            }
                        }
                        Cross::Baseline => ops.sub(t[1], o[1]),
                    }
                });
            }
        }
        Relation::Edge { side, margin } => {
            let d = side.dir();
            for axis in 0..2 {
                let (o, t) = (span(ops, own, axis), span(ops, to, axis));
                if d[axis] < 0.0 {
                    let at = ops.add(t[0], *margin);
                    out[axis] = Some(ops.sub(at, o[0]));
                } else if d[axis] > 0.0 {
                    let at = ops.sub(t[2], *margin);
                    out[axis] = Some(ops.sub(at, o[2]));
                }
            }
        }
        Relation::Onto { point, .. } => {
            let (o, t) = (point.of(own), point.of(to));
            ops.0 += 8;
            out = [Some(ops.sub(t[0], o[0])), Some(ops.sub(t[1], o[1]))];
        }
        Relation::Align { side, .. } => {
            let (axis, at) = match side {
                Line::W => (0, 0),
                Line::Cx => (0, 1),
                Line::E => (0, 2),
                Line::N => (1, 0),
                Line::Cy => (1, 1),
                Line::S => (1, 2),
            };
            let (o, t) = (span(ops, own, axis), span(ops, to, axis));
            out[axis] = Some(ops.sub(t[at], o[at]));
        }
    }
    out
}

// ------------------------------------------------------------------------------------------------
// Boxes from geometry.

/// The tight box of `verbs` on their curves (each segment's ends and the roots of its
/// derivative), not their control points; `None` for no points.
pub fn tight(verbs: &[Verb]) -> Option<Box4> {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    let mut put = |p: [f64; 2]| {
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    };
    let mut cur = [0.0, 0.0];
    for v in verbs {
        match *v {
            Verb::Move(p) | Verb::Line(p) => {
                put(p);
                cur = p;
            }
            Verb::Quad(c, p) => {
                put(p);
                for k in 0..2 {
                    // B'(t) = 0 at t = (p0 − c) / (p0 − 2c + p1).
                    let den = cur[k] - 2.0 * c[k] + p[k];
                    if den != 0.0 {
                        let t = (cur[k] - c[k]) / den;
                        if t > 0.0 && t < 1.0 {
                            let u = 1.0 - t;
                            let q = |i: usize| u * u * cur[i] + 2.0 * u * t * c[i] + t * t * p[i];
                            put([q(0), q(1)]);
                        }
                    }
                }
                cur = p;
            }
            Verb::Cubic(c1, c2, p) => {
                put(p);
                for k in 0..2 {
                    // B'(t)/3 = a t² + b t + c over the segment's four points.
                    let a = -cur[k] + 3.0 * c1[k] - 3.0 * c2[k] + p[k];
                    let b = 2.0 * (cur[k] - 2.0 * c1[k] + c2[k]);
                    let c = c1[k] - cur[k];
                    let mut roots = [f64::NAN; 2];
                    if a.abs() < 1e-12 {
                        if b != 0.0 {
                            roots[0] = -c / b;
                        }
                    } else {
                        let disc = b * b - 4.0 * a * c;
                        if disc >= 0.0 {
                            let s = ops::sqrt(disc);
                            roots = [(-b + s) / (2.0 * a), (-b - s) / (2.0 * a)];
                        }
                    }
                    for t in roots {
                        if t > 0.0 && t < 1.0 {
                            let u = 1.0 - t;
                            let q = |i: usize| {
                                u * u * u * cur[i]
                                    + 3.0 * u * u * t * c1[i]
                                    + 3.0 * u * t * t * c2[i]
                                    + t * t * t * p[i]
                            };
                            put([q(0), q(1)]);
                        }
                    }
                }
                cur = p;
            }
            Verb::Close => {}
        }
    }
    lo[0]
        .is_finite()
        .then(|| [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]])
}

/// Four numbers, as a box is written.
fn four(v: Option<&Value>) -> Option<Box4> {
    let b: Option<Vec<f64>> = v?.as_array()?.iter().map(|v| num(Some(v))).collect();
    <[f64; 4]>::try_from(b?.as_slice()).ok()
}

/// The geometry box of a 2D item of marks2d's in its own space, before `at`: a rect's or an
/// image's or a frame's box, a circle's or a star's extent, a path's tight box. A text's is its
/// shaped box, which the caller measures; a group has none of its own.
pub fn own_box(kind: &str, params: &Map<String, Value>) -> Option<Box4> {
    let center = || {
        let c = params.get("center")?.as_array()?;
        Some([num(c.first())?, num(c.get(1))?])
    };
    match kind {
        "rect@1" | "image@1" | "frame@1" => four(params.get("box")),
        "circle@1" => {
            let [x, y] = crate::scene::circle_center(params.get("center"))?;
            let r = num(params.get("r")).unwrap_or(0.0);
            Some([x - r, y - r, 2.0 * r, 2.0 * r])
        }
        "star@1" => {
            let [x, y] = center()?;
            let r = num(params.get("outer_r")).unwrap_or(0.0);
            Some([x - r, y - r, 2.0 * r, 2.0 * r])
        }
        "path@1" => tight(&crate::path::parse(params.get("d")?.as_str()?)?),
        // A vector's box is its `size` from its origin (Vector and formula `vector@1`).
        "vector@1" => {
            let s = params.get("size")?.as_array()?;
            Some([0.0, 0.0, num(s.first())?, num(s.get(1))?])
        }
        _ => None,
    }
}

/// `at`'s scale and position as an item draws by them, `x ↦ scale·x + offset`: with a box-point
/// pivot, the item scales about that point of `local`, its box before `at`, which stays put.
pub fn place_of(item: &Value, local: Option<Box4>) -> ([f64; 2], [f64; 2]) {
    let at = item.get("at");
    let v = |k: &str, i: usize, default: f64| match at.and_then(|a| a.get(k)) {
        Some(Value::Array(a)) => num(a.get(i)).unwrap_or(default),
        Some(n) if k == "scale" => num(Some(n)).unwrap_or(default),
        _ => default,
    };
    let scale = [v("scale", 0, 1.0), v("scale", 1, 1.0)];
    let mut offset = [v("pos", 0, 0.0), v("pos", 1, 0.0)];
    let pivot = at
        .and_then(|a| a.get("pivot"))
        .and_then(Value::as_str)
        .and_then(Point::parse);
    if let (Some(p), Some(b)) = (pivot, local) {
        let p = p.of(b);
        for k in 0..2 {
            offset[k] += p[k] - scale[k] * p[k];
        }
    }
    (scale, offset)
}

/// `b` as an item placed by `(scale, offset)` covers it.
pub fn placed(b: Box4, (scale, offset): ([f64; 2], [f64; 2])) -> Box4 {
    let a = [scale[0] * b[0] + offset[0], scale[1] * b[1] + offset[1]];
    let z = [
        scale[0] * (b[0] + b[2]) + offset[0],
        scale[1] * (b[1] + b[3]) + offset[1],
    ];
    [
        a[0].min(z[0]),
        a[1].min(z[1]),
        (z[0] - a[0]).abs(),
        (z[1] - a[1]).abs(),
    ]
}

fn union(a: Option<Box4>, b: Box4) -> Box4 {
    match a {
        None => b,
        Some([x, y, w, h]) => {
            let (x0, y0) = (x.min(b[0]), y.min(b[1]));
            let (x1, y1) = ((x + w).max(b[0] + b[2]), (y + h).max(b[1] + b[3]));
            [x0, y0, x1 - x0, y1 - y0]
        }
    }
}

/// What a solve asks of the module that draws each item: its own box where it draws now
/// (`part` for one of its parts), and a text's first baseline.
pub trait Bounds {
    fn own(&mut self, id: &str, item: &Value, part: Option<&str>) -> Option<Box4>;
    fn baseline(&mut self, id: &str, item: &Value) -> Option<f64>;
    /// A read beside the boxes (`frame.size`, `earlier(self.place)`) or `solve` as it happens,
    /// for the constraint kit's fixture.
    fn note(&mut self, _what: &'static str) {}
}

// ------------------------------------------------------------------------------------------------
// The document's order and solve.

/// Each item's parent, children and relations, as read from the evaluated items. Parents and
/// relations never change during a solve, only places.
struct Graph {
    parents: BTreeMap<String, String>,
    children: BTreeMap<String, Vec<String>>,
    relations: BTreeMap<String, Vec<Relation>>,
    ids: BTreeSet<String>,
}

impl Graph {
    fn new(items: &Map<String, Value>, safe: f64) -> Result<Graph, Refusal> {
        let mut g = Graph {
            parents: BTreeMap::new(),
            children: BTreeMap::new(),
            relations: BTreeMap::new(),
            ids: items.keys().cloned().collect(),
        };
        for (id, item) in items {
            if let Some(p) = item.get("parent").and_then(Value::as_str) {
                g.parents.insert(id.clone(), p.to_string());
                g.children
                    .entry(p.to_string())
                    .or_default()
                    .push(id.clone());
            }
            let r = read(id, item, safe)?;
            if !r.is_empty() {
                g.relations.insert(id.clone(), r);
            }
        }
        Ok(g)
    }

    fn ancestors(&self, id: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut at = self.parents.get(id);
        while let Some(p) = at {
            if out.contains(p) || out.len() > self.ids.len() {
                break;
            }
            out.push(p.clone());
            at = self.parents.get(p);
        }
        out
    }

    /// `id` and every item under it, depth first.
    fn subtree(&self, id: &str, out: &mut Vec<String>) {
        if out.iter().any(|o| o == id) || !self.ids.contains(id) {
            return;
        }
        out.push(id.to_string());
        for c in self.children.get(id).into_iter().flatten() {
            self.subtree(c, out);
        }
    }

    /// The placed items `id`'s solve reads, each solved before it: every placed item in its
    /// targets' subtrees, its targets' and its own ancestors below where they meet, and the
    /// placed items under it, whose places its box holds.
    fn reads(&self, id: &str) -> Vec<String> {
        let mut out: BTreeSet<String> = BTreeSet::new();
        let keep = |v: Vec<String>, out: &mut BTreeSet<String>| {
            for x in v {
                if x != id && self.relations.contains_key(&x) {
                    out.insert(x);
                }
            }
        };
        let own_up = self.ancestors(id);
        let mut under = Vec::new();
        for c in self.children.get(id).into_iter().flatten() {
            self.subtree(c, &mut under);
        }
        keep(under, &mut out);
        for r in &self.relations[id] {
            match r.target() {
                Target::Item { id: t, .. } => {
                    let mut sub = Vec::new();
                    self.subtree(t, &mut sub);
                    keep(sub, &mut out);
                    let t_up = self.ancestors(t);
                    keep(
                        t_up.iter()
                            .filter(|a| !own_up.contains(a))
                            .cloned()
                            .collect(),
                        &mut out,
                    );
                    keep(
                        own_up
                            .iter()
                            .filter(|a| !t_up.contains(a) && *a != t)
                            .cloned()
                            .collect(),
                        &mut out,
                    );
                }
                Target::Frame | Target::At(_) => keep(own_up.clone(), &mut out),
            }
        }
        out.into_iter().collect()
    }

    /// The placed items in the order they solve, each after everything it reads; a cycle is
    /// refused as `relation_cycle`, naming its chain.
    fn order(&self) -> Result<Vec<String>, Refusal> {
        let mut done = BTreeSet::new();
        let mut out = Vec::new();
        for id in self.relations.keys() {
            self.visit(id, &mut done, &mut Vec::new(), &mut out)?;
        }
        Ok(out)
    }

    fn visit(
        &self,
        id: &str,
        done: &mut BTreeSet<String>,
        stack: &mut Vec<String>,
        out: &mut Vec<String>,
    ) -> Result<(), Refusal> {
        if done.contains(id) {
            return Ok(());
        }
        if let Some(from) = stack.iter().position(|s| s == id) {
            let mut chain = stack[from..].to_vec();
            chain.push(id.to_string());
            return Err(Refusal {
                code: CYCLE,
                path: format!("items/{}/at", stack[from]),
                chain,
            });
        }
        stack.push(id.to_string());
        for r in self.reads(id) {
            self.visit(&r, done, stack, out)?;
        }
        stack.pop();
        done.insert(id.to_string());
        out.push(id.to_string());
        Ok(())
    }
}

/// The document's relations checked: each read, and a cycle through relations or parents
/// refused as `relation_cycle`, naming its chain; an item a relation names that the document
/// lacks is `ref_unresolved`.
pub fn check(items: &Map<String, Value>, safe: f64) -> Result<(), Refusal> {
    let g = Graph::new(items, safe)?;
    for (id, rs) in &g.relations {
        for r in rs {
            if let Target::Item { id: t, .. } = r.target() {
                if !items.contains_key(t) {
                    return Err(Refusal {
                        code: "ref_unresolved",
                        path: format!(
                            "items/{id}/at/{}",
                            if r.kind() == "align" {
                                "align"
                            } else {
                                "place"
                            }
                        ),
                        chain: Vec::new(),
                    });
                }
            }
        }
    }
    g.order().map(|_| ())
}

/// The frame relations read: its size and safe margin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub size: [f64; 2],
    pub safe: f64,
}

impl Frame {
    /// A document's frame: `size` (1920 × 1080 when left out) and `safe` (24 u).
    pub fn of(doc: &Map<String, Value>) -> Frame {
        let size = doc.get("size").and_then(Value::as_array);
        let n = |i: usize, d: f64| num(size.and_then(|s| s.get(i))).unwrap_or(d);
        Frame {
            size: [n(0, 1920.0), n(1, 1080.0)],
            safe: num(doc.get("safe")).unwrap_or(24.0),
        }
    }
}

/// #221's planted solves, for the constraint kit's proof: one that iterates to convergence, and
/// one that reads its own place from the previous frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    Iterates,
    PreviousPlace,
}

/// What a solve carries between frames: nothing, except in the planted program that reads its
/// previous place.
#[derive(Clone, Debug, Default)]
pub struct Carried(BTreeMap<String, [f64; 2]>);

/// Every placed item of `items`, as evaluated at t, moved to where its relations put it, with
/// `offsets` (each item's own `at.pos`) added after; the items under it move with it. Solved in
/// one dependency order; `ops` counts the solves' ops.
pub fn place(
    items: &mut Map<String, Value>,
    offsets: &BTreeMap<String, [f64; 2]>,
    frame: Frame,
    bounds: &mut dyn Bounds,
    ops: &mut Ops,
) -> Result<(), Refusal> {
    place_planted(
        items,
        offsets,
        frame,
        bounds,
        ops,
        Planted::None,
        &mut Carried::default(),
    )
}

/// [`place`], with a planted wrong solve and what it carries between frames.
pub fn place_planted(
    items: &mut Map<String, Value>,
    offsets: &BTreeMap<String, [f64; 2]>,
    frame: Frame,
    bounds: &mut dyn Bounds,
    ops: &mut Ops,
    planted: Planted,
    carried: &mut Carried,
) -> Result<(), Refusal> {
    let g = Graph::new(items, frame.safe)?;
    for id in g.order()? {
        let relations = &g.relations[&id];
        let mut moved = Vec::new();
        g.subtree(&id, &mut moved);
        let offset = offsets.get(&id).copied().unwrap_or([0.0, 0.0]);
        let mut delta = [0.0, 0.0];
        for r in relations {
            let own_box = match r {
                Relation::Beside {
                    own: Some(part), ..
                } => bounds.own(&id, &items[&id], Some(part)),
                _ => box_of(items, &moved, bounds),
            };
            let Some(own) = own_box else { continue };
            // The box as the relation sees it: `at.pos` left out, with what earlier relations
            // of this item moved it by.
            let own = [
                own[0] - offset[0] + delta[0],
                own[1] - offset[1] + delta[1],
                own[2],
                own[3],
            ];
            let target = match r.target() {
                Target::Frame => {
                    bounds.note("frame.size");
                    [0.0, 0.0, frame.size[0], frame.size[1]]
                }
                Target::At(p) => [p[0], p[1], 0.0, 0.0],
                Target::Item {
                    id: t,
                    part: Some(part),
                } => {
                    match items
                        .get(t)
                        .and_then(|item| bounds.own(t, item, Some(part)))
                    {
                        Some(b) => b,
                        None => continue,
                    }
                }
                Target::Item { id: t, part: None } => {
                    let mut sub = Vec::new();
                    g.subtree(t, &mut sub);
                    match box_of(items, &sub, bounds) {
                        Some(b) => b,
                        None => continue,
                    }
                }
            };
            let mut baseline = |id: &str| items.get(id).and_then(|i| bounds.baseline(id, i));
            let reads = Reads {
                own,
                target,
                own_baseline: baseline(&id).map(|b| b - offset[1] + delta[1]),
                target_baseline: match r.target() {
                    Target::Item { id: t, .. } => baseline(t),
                    _ => None,
                },
            };
            let moves = match planted {
                Planted::Iterates => iterate(r, &reads, ops),
                _ => solve(r, &reads, ops),
            };
            bounds.note("solve");
            for k in 0..2 {
                delta[k] += moves[k].unwrap_or(0.0);
            }
        }
        // A relation moves the item on the axes it places, `at.pos` added back there.
        let mut by = delta;
        if planted == Planted::PreviousPlace {
            bounds.note("earlier(self.place)");
            let before = carried.0.get(&id).copied().unwrap_or(by);
            carried.0.insert(id.clone(), by);
            by = [(before[0] + by[0]) / 2.0, (before[1] + by[1]) / 2.0];
        }
        for m in &moved {
            shift(items, m, by);
        }
    }
    Ok(())
}

/// The planted solve: steps half way to the place until it's within 1e-9 u, so its op count
/// grows with how far it moves.
fn iterate(r: &Relation, reads: &Reads, ops: &mut Ops) -> [Option<f64>; 2] {
    let goal = solve(r, reads, ops);
    let mut out = [None, None];
    for k in 0..2 {
        let Some(g) = goal[k] else { continue };
        let mut at = 0.0;
        while (g - at).abs() > 1e-9 {
            at = ops.add(at, (g - at) / 2.0);
        }
        out[k] = Some(g);
    }
    out
}

/// The box of the items in `ids` where they draw now.
fn box_of(items: &Map<String, Value>, ids: &[String], bounds: &mut dyn Bounds) -> Option<Box4> {
    let mut out = None;
    for id in ids {
        if let Some(item) = items.get(id) {
            if let Some(b) = bounds.own(id, item, None) {
                out = Some(union(out, b));
            }
        }
    }
    out
}

/// Moves the item `id`'s `at.pos` by `by`.
fn shift(items: &mut Map<String, Value>, id: &str, by: [f64; 2]) {
    let Some(item) = items.get_mut(id).and_then(Value::as_object_mut) else {
        return;
    };
    let at = item
        .entry("at")
        .or_insert_with(|| Value::Object(Map::new()));
    if !at.is_object() {
        *at = Value::Object(Map::new());
    }
    let Some(at) = at.as_object_mut() else { return };
    let mut pos = [0.0, 0.0, 0.0];
    if let Some(Value::Array(p)) = at.get("pos") {
        for (o, v) in pos.iter_mut().zip(p) {
            *o = v.as_f64().unwrap_or(0.0);
        }
    }
    pos[0] += by[0];
    pos[1] += by[1];
    at.insert("pos".into(), json!(pos));
}

// ------------------------------------------------------------------------------------------------
// The marks2d module's entries in `constraint@1`, each with its fixture.

/// The relations' entries in `constraint@1` and the reads each declares.
pub const ENTRIES: [(&str, &[&str]); 4] = [
    ("beside", &["target.bounds", "self.bounds"]),
    ("edge", &["frame.size", "self.bounds"]),
    ("onto", &["target.bounds", "self.bounds"]),
    ("align", &["target.bounds", "self.bounds"]),
];

/// Rects' boxes for the fixture, each read noted as the target's or the placed item's.
struct Fixture {
    order: Vec<&'static str>,
}

impl Bounds for Fixture {
    fn own(&mut self, id: &str, item: &Value, _: Option<&str>) -> Option<Box4> {
        self.order.push(if id == "b" {
            "self.bounds"
        } else {
            "target.bounds"
        });
        let local = own_box("rect@1", item.get("params")?.as_object()?)?;
        Some(placed(local, place_of(item, Some(local))))
    }
    fn baseline(&mut self, _: &str, _: &Value) -> Option<f64> {
        None
    }
    fn note(&mut self, what: &'static str) {
        self.order.push(what);
    }
}

/// The fixture's relation of kind `name`, with its one param `p` (a gap, a margin or where it
/// puts the item).
fn fixture_relation(name: &str, p: f64) -> Value {
    match name {
        "beside" => json!({"place": {"beside": "a", "side": "e", "gap": p}}),
        "edge" => json!({"place": {"edge": "n", "margin": p}}),
        "onto" => json!({"place": {"onto": "a", "point": "nw"}}),
        _ => json!({"align": [{"to": "a", "side": "n"}]}),
    }
}

/// The fixture's items: a rect `a` at `[x, y]`, and a rect `b` placed by `relation`.
fn fixture_items(x: f64, y: f64, relation: Value) -> Map<String, Value> {
    let rect = |id: &str, b: [f64; 4], at: Value| {
        (
            id.to_string(),
            json!({"id": id, "kind": "rect@1", "params": {"box": b}, "at": at}),
        )
    };
    let mut at = relation;
    at["pos"] = json!([0.0, 0.0, 0.0]);
    [
        rect("a", [0.0, 0.0, 40.0, 20.0], json!({"pos": [x, y, 0.0]})),
        rect("b", [0.0, 0.0, 30.0, 10.0], at),
    ]
    .into_iter()
    .collect()
}

const FIXTURE_FRAME: Frame = Frame {
    size: [320.0, 180.0],
    safe: 24.0,
};

/// One fixture solve: `b`'s place, the reads in the order the solve made them and its ops. `a`
/// sits lower as the param grows, so every kind moves `b` farther.
fn fixture_run(
    name: &str,
    p: f64,
    x: f64,
    planted: Planted,
    carried: &mut Carried,
) -> ([f64; 2], Vec<&'static str>, u64) {
    let mut items = fixture_items(x, 50.0 + 4.0 * p, fixture_relation(name, p));
    let mut seen = Fixture { order: Vec::new() };
    let mut ops = Ops::default();
    let offsets = BTreeMap::new();
    let placed = place_planted(
        &mut items,
        &offsets,
        FIXTURE_FRAME,
        &mut seen,
        &mut ops,
        planted,
        carried,
    );
    let pos = |i: usize| items["b"]["at"]["pos"][i].as_f64().unwrap_or(f64::NAN);
    match placed {
        Ok(()) => ([pos(0), pos(1)], seen.order, ops.0),
        Err(_) => ([f64::NAN; 2], seen.order, ops.0),
    }
}

/// The digest of places by time, bit for bit.
fn digest(places: &BTreeMap<u32, [f64; 2]>) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for (t, p) in places {
        h.update(t.to_le_bytes());
        h.update(p[0].to_bits().to_le_bytes());
        h.update(p[1].to_bits().to_le_bytes());
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The entry `name`'s fixture, from its solve (or the planted one) run for real: the reads it
/// made in order and what it read, its op counts at three params, the digests of its places at
/// 50 times played in order and sought in a shuffled order, and the check's answer to a
/// two-item cycle through it.
pub fn fixture(name: &str, planted: Planted) -> Value {
    let (_, order, _) = fixture_run(name, 16.0, 40.0, planted, &mut Carried::default());
    let ops: Vec<u64> = [0.0, 16.0, 64.0]
        .iter()
        .map(|p| fixture_run(name, *p, 40.0, planted, &mut Carried::default()).2)
        .collect();
    // Where `a` is and the param at time t, both keyed: every frame's place differs.
    let x = |t: u32| 10.0 + 7.25 * f64::from(t);
    let p = |t: u32| 16.0 + 0.5 * f64::from(t);
    let mut carried = Carried::default();
    let play: BTreeMap<u32, [f64; 2]> = (0..50u32)
        .map(|t| (t, fixture_run(name, p(t), x(t), planted, &mut carried).0))
        .collect();
    // A fixed shuffle (a full-period LCG step over 50), so seeking jumps back and forth.
    let mut carried = Carried::default();
    let seek: BTreeMap<u32, [f64; 2]> = (0..50u32)
        .map(|i| (i * 31 + 7) % 50)
        .map(|t| (t, fixture_run(name, p(t), x(t), planted, &mut carried).0))
        .collect();
    // A two-item cycle through it: `a` placed by it against `b`, and `b` beside `a`; an edge
    // reads `a`'s box, which holds its child `b`.
    let mut items = fixture_items(40.0, 50.0, json!({"place": {"beside": "a"}}));
    let mut on_a = fixture_relation(name, 16.0);
    if let Some(o) = on_a.as_object_mut() {
        for v in o.values_mut() {
            for k in ["beside", "onto"] {
                if v.get(k).is_some() {
                    v[k] = json!("b");
                }
            }
            if let Some(list) = v.as_array_mut() {
                for a in list {
                    a["to"] = json!("b");
                }
            }
        }
        if name == "edge" {
            items["b"]["parent"] = json!("a");
        }
        for (k, v) in o {
            items["a"]["at"][k.as_str()] = v.clone();
        }
    }
    let cycle = match check(&items, FIXTURE_FRAME.safe) {
        Err(r) => json!({"code": r.code, "chain": r.chain}),
        Ok(()) => json!({"code": null, "chain": []}),
    };
    let read: BTreeSet<&str> = order.iter().copied().filter(|r| *r != "solve").collect();
    json!({
        "read": read, "order": order, "ops": ops,
        "play": digest(&play), "seek": digest(&seek), "cycle": cycle,
    })
}

/// The marks2d module's `constraint@1` entries, `(name, value)`, each with its fixture; the
/// planted program's in a planted build.
pub fn entries(planted: Planted) -> Vec<(&'static str, Value)> {
    ENTRIES
        .iter()
        .map(|(name, reads)| {
            let fixture = fixture(name, planted);
            (
                *name,
                json!({"reads": reads, "writes": ["self.place"], "fixture": fixture}),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kit() -> deep_canvas::registry::lists::RegistryDef {
        deep_canvas::registry::core_lists::registries()
            .into_iter()
            .find(|d| d.name == "constraint@1")
            .expect("the core declares constraint@1")
    }

    #[test]
    fn every_relation_passes_the_constraint_kit() {
        for (name, value) in entries(Planted::None) {
            let r = kit().run_kit(name, &value);
            assert!(r.pass(), "{name}: {:?} {value}", r.failed());
        }
    }

    #[test]
    fn the_planted_solves_fail_the_rule_they_break() {
        for (name, value) in entries(Planted::Iterates) {
            let failed = kit().run_kit(name, &value).failed();
            assert!(failed.contains(&"fixed_ops"), "{name}: {failed:?} {value}");
        }
        for (name, value) in entries(Planted::PreviousPlace) {
            let failed = kit().run_kit(name, &value).failed();
            assert!(failed.contains(&"declared_reads"), "{name}: {failed:?}");
            assert!(failed.contains(&"seek_equals_play"), "{name}: {failed:?}");
        }
    }

    #[test]
    fn a_cubic_box_is_measured_on_its_curve() {
        // Control points reach y = −100; the curve itself only to −75.
        let b = tight(&[
            Verb::Move([0.0, 0.0]),
            Verb::Cubic([0.0, -100.0], [100.0, -100.0], [100.0, 0.0]),
        ])
        .unwrap();
        assert!((b[1] + 75.0).abs() < 1e-9, "{b:?}");
    }
}
