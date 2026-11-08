//! Issue #494: path keys whose shapes differ in point or sub-path counts, matched once at check
//! (canvas primitives: Channel and key, path). Sub-paths pair by area and centroid; each pair is
//! resampled by arc length to the larger point count, keeping every vertex the shorter one had;
//! a closed pair's start point turns to the rotation with the least summed squared distance; and
//! a sub-path with no partner grows from or shrinks to its centroid. The result has one structure
//! for every key, so a segment mixes point by point as equal counts do.

use deep_canvas::ops::sqrt;
use deep_canvas_marks::path::Verb;
use serde_json::{json, Map, Value};

use crate::doc::{Ctx, Refused};

/// One sub-path: its points in u, and whether it closes.
#[derive(Clone, Debug, PartialEq)]
pub struct Sub {
    pub points: Vec<[f64; 2]>,
    pub closed: bool,
}

pub type Shape = Vec<Sub>;

/// A shape's structure: each sub-path's point count and whether it closes.
pub type Structure = Vec<(usize, bool)>;

/// Tolerance in u a path key's curves flatten to.
pub const FLATTEN: f64 = 0.001;

/// An SVG path string's shape: its curves flattened within [`FLATTEN`] u.
pub fn of_d(d: &str) -> Option<Shape> {
    let verbs = deep_canvas_marks::path::parse(d)?;
    let lines = deep_canvas_marks::path::flatten(&verbs, FLATTEN);
    (!lines.is_empty()).then(|| lines.into_iter().map(|l| Sub { points: l.points, closed: l.closed }).collect())
}

/// A shape as an SVG path string: `M x y L x y … Z` for each sub-path.
pub fn d_of(shape: &Shape) -> String {
    let mut d = String::new();
    for s in shape {
        for (i, p) in s.points.iter().enumerate() {
            if !d.is_empty() {
                d.push(' ');
            }
            d.push_str(&format!("{} {} {}", if i == 0 { 'M' } else { 'L' }, p[0], p[1]));
        }
        if s.closed {
            d.push_str(" Z");
        }
    }
    d
}

pub fn structure(shape: &Shape) -> Structure {
    shape.iter().map(|s| (s.points.len(), s.closed)).collect()
}

/// The shape as one flat run of coordinates, sub-path after sub-path.
pub fn flat(shape: &Shape) -> Vec<f64> {
    shape.iter().flat_map(|s| s.points.iter().flat_map(|p| [p[0], p[1]])).collect()
}

/// A flat run back into a shape of `structure`.
pub fn unflat(values: &[f64], structure: &Structure) -> Shape {
    let mut at = 0;
    structure
        .iter()
        .map(|&(n, closed)| {
            let points = (0..n).map(|k| [values[2 * (at + k)], values[2 * (at + k) + 1]]).collect();
            at += n;
            Sub { points, closed }
        })
        .collect()
}

/// The shoelace area, signed, and the centroid of the points.
fn area_centroid(s: &Sub) -> (f64, [f64; 2]) {
    let n = s.points.len();
    let mut area = 0.0;
    for i in 0..n {
        let (a, b) = (s.points[i], s.points[(i + 1) % n]);
        area += a[0] * b[1] - b[0] * a[1];
    }
    let mut c = [0.0, 0.0];
    for p in &s.points {
        c[0] += p[0] / n.max(1) as f64;
        c[1] += p[1] / n.max(1) as f64;
    }
    (area / 2.0, c)
}

fn dist(a: [f64; 2], b: [f64; 2]) -> f64 {
    sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]))
}

/// The pairs of sub-paths, by index into `a` and `b`, cheapest first: area difference over the
/// larger area plus centroid distance over the shapes' size. Ties go to the earlier index.
fn pair(a: &Shape, b: &Shape) -> Vec<(Option<usize>, Option<usize>)> {
    let ma: Vec<_> = a.iter().map(area_centroid).collect();
    let mb: Vec<_> = b.iter().map(area_centroid).collect();
    let size = a
        .iter()
        .chain(b)
        .flat_map(|s| s.points.iter())
        .fold(0.0f64, |m, p| m.max(p[0].abs()).max(p[1].abs()))
        .max(1e-9);
    let mut costs = Vec::new();
    for (i, (aa, ca)) in ma.iter().enumerate() {
        for (j, (ab, cb)) in mb.iter().enumerate() {
            let areas = (aa.abs() - ab.abs()).abs() / aa.abs().max(ab.abs()).max(1e-12);
            costs.push((areas + dist(*ca, *cb) / size, i, j));
        }
    }
    costs.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)).then(x.2.cmp(&y.2)));
    let (mut used_a, mut used_b) = (vec![false; a.len()], vec![false; b.len()]);
    let mut pairs = Vec::new();
    for (_, i, j) in costs {
        if !used_a[i] && !used_b[j] {
            used_a[i] = true;
            used_b[j] = true;
            pairs.push((Some(i), Some(j)));
        }
    }
    pairs.sort_by_key(|p| p.0);
    pairs.extend((0..a.len()).filter(|&i| !used_a[i]).map(|i| (Some(i), None)));
    pairs.extend((0..b.len()).filter(|&j| !used_b[j]).map(|j| (None, Some(j))));
    pairs
}

/// `s` with `n ≥` its own count of points: its vertices kept, and the extra points spread over its
/// edges by arc length (each edge takes a share by its length, largest remainders first, and
/// splits evenly).
pub fn resample(s: &Sub, n: usize) -> Sub {
    let m = s.points.len();
    if m == 0 || n <= m {
        return s.clone();
    }
    let edges = if s.closed { m } else { m - 1 };
    if edges == 0 {
        return Sub { points: vec![s.points[0]; n], closed: s.closed };
    }
    let lengths: Vec<f64> = (0..edges).map(|i| dist(s.points[i], s.points[(i + 1) % m])).collect();
    let total: f64 = lengths.iter().sum();
    let extra = n - m;
    let shares: Vec<f64> = lengths
        .iter()
        .map(|l| if total > 0.0 { extra as f64 * l / total } else { extra as f64 / edges as f64 })
        .collect();
    let mut add: Vec<usize> = shares.iter().map(|s| s.floor() as usize).collect();
    let mut left = extra - add.iter().sum::<usize>();
    let mut order: Vec<usize> = (0..edges).collect();
    order.sort_by(|&x, &y| (shares[y] - shares[y].floor()).total_cmp(&(shares[x] - shares[x].floor())).then(x.cmp(&y)));
    for &e in order.iter().cycle() {
        if left == 0 {
            break;
        }
        add[e] += 1;
        left -= 1;
    }
    let mut points = Vec::with_capacity(n);
    for (i, &p) in s.points.iter().enumerate() {
        points.push(p);
        if let Some(&k) = add.get(i) {
            let q = s.points[(i + 1) % m];
            for j in 1..=k {
                let f = j as f64 / (k + 1) as f64;
                points.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
            }
        }
    }
    Sub { points, closed: s.closed }
}

/// `b` turned so its start is the rotation with the least summed squared distance to `a`.
fn turned(a: &Sub, b: &Sub) -> Sub {
    let n = b.points.len();
    if !(a.closed && b.closed) || n != a.points.len() || n == 0 {
        return b.clone();
    }
    let cost = |k: usize| -> f64 {
        (0..n)
            .map(|i| {
                let (p, q) = (a.points[i], b.points[(i + k) % n]);
                (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1])
            })
            .sum()
    };
    let best = (0..n).map(|k| (cost(k), k)).fold((f64::INFINITY, 0), |m, c| if c.0 < m.0 { c } else { m }).1;
    Sub { points: (0..n).map(|i| b.points[(i + best) % n]).collect(), closed: b.closed }
}

/// A sub-path collapsed to its centroid, `n` points long.
fn point_at_centroid(s: &Sub, n: usize) -> Sub {
    Sub { points: vec![area_centroid(s).1; n], closed: s.closed }
}

/// `a` and `b` matched: one structure, `a`'s and `b`'s points on it.
pub fn matched(a: &Shape, b: &Shape) -> (Shape, Shape) {
    let (mut ma, mut mb) = (Vec::new(), Vec::new());
    for p in pair(a, b) {
        match p {
            (Some(i), Some(j)) => {
                let n = a[i].points.len().max(b[j].points.len());
                let closed = a[i].closed && b[j].closed;
                let sa = Sub { closed, ..resample(&a[i], n) };
                let sb = Sub { closed, ..resample(&b[j], n) };
                mb.push(turned(&sa, &sb));
                ma.push(sa);
            }
            (Some(i), None) => {
                ma.push(a[i].clone());
                mb.push(point_at_centroid(&a[i], a[i].points.len()));
            }
            (None, Some(j)) => {
                ma.push(point_at_centroid(&b[j], b[j].points.len()));
                mb.push(b[j].clone());
            }
            (None, None) => {}
        }
    }
    (ma, mb)
}

/// Every key's shape on one structure: the keys matched left to right, each later key against the
/// structure so far, then every key again against the final one, so a segment between any two
/// keys mixes point by point.
pub fn matched_all(shapes: &[Shape]) -> Vec<Shape> {
    let Some(first) = shapes.first() else {
        return Vec::new();
    };
    let mut reference = first.clone();
    for s in &shapes[1..] {
        reference = matched(&reference, s).0;
    }
    shapes
        .iter()
        .map(|s| if structure(s) == structure(&reference) { s.clone() } else { matched(&reference, s).1 })
        .collect()
}

/// A path value as written: `{verbs, pts}` (path@1's own columns, verbs as letters or their u8
/// codes M 0, L 1, Q 2, C 3, Z 4), `{d}`, or an SVG path string.
pub fn of_value(v: &Value) -> Option<Shape> {
    if let Some(d) = v.as_str().or_else(|| v.get("d").and_then(Value::as_str)) {
        return of_d(d);
    }
    let (verbs, pts) = (v.get("verbs")?.as_array()?, v.get("pts")?.as_array()?);
    let pts: Vec<f64> = pts.iter().map(|p| p.as_f64().filter(|p| p.is_finite())).collect::<Option<_>>()?;
    let mut at = 0;
    let mut next = || -> Option<[f64; 2]> {
        let p = [*pts.get(at)?, *pts.get(at + 1)?];
        at += 2;
        Some(p)
    };
    let mut out = Vec::new();
    for verb in verbs {
        let name = match verb {
            Value::String(s) => s.as_str(),
            Value::Number(n) => ["M", "L", "Q", "C", "Z"].get(n.as_u64()? as usize).copied()?,
            _ => return None,
        };
        out.push(match name {
            "M" => Verb::Move(next()?),
            "L" => Verb::Line(next()?),
            "Q" => Verb::Quad(next()?, next()?),
            "C" => Verb::Cubic(next()?, next()?, next()?),
            "Z" => Verb::Close,
            _ => return None,
        });
    }
    if at != pts.len() {
        return None;
    }
    let lines = deep_canvas_marks::path::flatten(&out, FLATTEN);
    (!lines.is_empty()).then(|| lines.into_iter().map(|l| Sub { points: l.points, closed: l.closed }).collect())
}

/// A shape as path@1's columns, `{verbs, pts}`, verbs as letters.
pub fn value_of(shape: &Shape) -> Value {
    let (mut verbs, mut pts) = (Vec::new(), Vec::new());
    for s in shape {
        for (i, p) in s.points.iter().enumerate() {
            verbs.push(if i == 0 { "M" } else { "L" });
            pts.extend([p[0], p[1]]);
        }
        if s.closed {
            verbs.push("Z");
        }
    }
    json!({"verbs": verbs, "pts": pts})
}

/// The shape an evaluated item draws, in its own space (its `at` left out): a path's columns or
/// `d`, or a vector import's outline, whole or one part's (`params.outline`, which the evidence
/// store's holder inlines).
pub fn of_item(item: &Value, part: Option<&str>) -> Option<Shape> {
    let params = item.get("params")?;
    match part {
        Some(part) => of_value(params.pointer("/outline/parts")?.get(part)?),
        None if params.get("verbs").is_some() => of_value(params),
        None => params.get("d").and_then(Value::as_str).or_else(|| params.pointer("/outline/d").and_then(Value::as_str)).and_then(of_d),
    }
}

/// An item's `at` in the plane: `x ↦ pos + R(rot z)·S(scale)·(x − pivot)` (Units and axes), as
/// a 2×2 matrix and an offset.
fn at_of(item: &Value) -> ([[f64; 2]; 2], [f64; 2]) {
    let v = |name: &str, k: usize, or: f64| item.pointer(&format!("/at/{name}/{k}")).and_then(Value::as_f64).unwrap_or(or);
    let turn = deep_canvas::ops::rad(v("rot", 2, 0.0));
    let (s, c) = (deep_canvas::ops::sin(turn), deep_canvas::ops::cos(turn));
    let (sx, sy) = (v("scale", 0, 1.0), v("scale", 1, 1.0));
    let m = [[c * sx, -s * sy], [s * sx, c * sy]];
    let (px, py) = (v("pivot", 0, 0.0), v("pivot", 1, 0.0));
    (m, [v("pos", 0, 0.0) - (m[0][0] * px + m[0][1] * py), v("pos", 1, 0.0) - (m[1][0] * px + m[1][1] * py)])
}

fn mapped(shape: &Shape, f: impl Fn([f64; 2]) -> [f64; 2]) -> Shape {
    shape.iter().map(|s| Sub { points: s.points.iter().map(|&p| f(p)).collect(), closed: s.closed }).collect()
}

/// A shape in an item's own space placed in the document by the item's `at`.
pub fn placed(item: &Value, shape: &Shape) -> Shape {
    let (m, t) = at_of(item);
    mapped(shape, |p| [m[0][0] * p[0] + m[0][1] * p[1] + t[0], m[1][0] * p[0] + m[1][1] * p[1] + t[1]])
}

/// A shape in the document taken into an item's own space.
pub fn unplaced(item: &Value, shape: &Shape) -> Shape {
    let (m, t) = at_of(item);
    let det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    mapped(shape, |p| {
        let (x, y) = (p[0] - t[0], p[1] - t[1]);
        if det == 0.0 {
            return [x, y];
        }
        [(m[1][1] * x - m[0][1] * y) / det, (-m[1][0] * x + m[0][0] * y) / det]
    })
}

/// A vector import's parts as a match morph pairs them: `ID#part`, keyed by the part's id, each
/// in document u.
pub fn vector_parts(id: &str, item: &Value) -> Vec<Part> {
    let Some(parts) = item.pointer("/params/outline/parts").and_then(Value::as_object) else {
        return Vec::new();
    };
    parts
        .iter()
        .filter_map(|(key, d)| Some(Part { name: format!("{id}#{key}"), key: key.clone(), shape: placed(item, &of_value(d)?) }))
        .collect()
}

// ---------------------------------------------------------------------------------------------------
// The match morph between two items in one shot (Transition: match_morph)

/// What a match morph does with the parts no pairing takes (`unpaired`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unpaired {
    Fade,
    Morph,
    CrossFade,
    Split,
}

/// A match morph from one item to another inside a shot.
#[derive(Clone, Debug, PartialEq)]
pub struct Between {
    pub id: String,
    pub from: String,
    pub to: String,
    pub start: i64,
    pub end: i64,
    pub ease: crate::curve::Ease,
    /// `pairs`, part to part, each without its `#`, named before any other pairing.
    pub pairs: Vec<(String, String)>,
    pub unpaired: Unpaired,
}

impl Between {
    /// The progress at t: 0 before the window, 1 after, eased inside it.
    pub fn progress(&self, t: i64) -> f64 {
        if t <= self.start {
            0.0
        } else if t >= self.end {
            1.0
        } else {
            self.ease.at((t - self.start) as f64 / (self.end - self.start) as f64)
        }
    }
}

fn refused(code: &'static str, path: String) -> Refused {
    Refused { code, path, detail: None }
}

/// The document's match morphs that name two items rather than two shots or placements.
pub fn betweens_of(doc: &Map<String, Value>, ctx: &Ctx) -> Result<Vec<Between>, Refused> {
    let items = doc.get("items").and_then(Value::as_object);
    let is_item = |v: Option<&Value>| v.and_then(Value::as_str).is_some_and(|n| items.is_some_and(|i| i.contains_key(n)));
    let mut out = Vec::new();
    for (id, tr) in doc.get("transitions").and_then(Value::as_object).into_iter().flatten() {
        let path = format!("transitions/{id}");
        if tr.get("kind").and_then(Value::as_str) != Some("match_morph") || !(is_item(tr.get("from")) || is_item(tr.get("to"))) {
            continue;
        }
        let name = |f: &str| -> Result<String, Refused> {
            tr.get(f).and_then(Value::as_str).filter(|_| is_item(tr.get(f))).map(str::to_string).ok_or_else(|| refused("ref_unresolved", format!("{path}/{f}")))
        };
        let (from, to) = (name("from")?, name("to")?);
        let span = crate::doc::time_of(tr.get("span"), ctx, &format!("{path}/span"))?;
        if span <= 0 {
            return Err(refused("transition_span", format!("{path}/span")));
        }
        let at = crate::doc::time_of(tr.get("at"), ctx, &format!("{path}/at"))?;
        let start = match tr.get("align").and_then(Value::as_str) {
            None | Some("center") => at - span / 2,
            Some("start") => at,
            Some("end") => at - span,
            Some(_) => return Err(refused("bad_doc", format!("{path}/align"))),
        };
        let ease = crate::shots::ease_named(tr.get("progress"), &format!("{path}/progress"))?;
        let fields = tr.get("match_morph");
        let mut pairs = Vec::new();
        match fields.and_then(|f| f.get("pairs")) {
            None => {}
            Some(Value::Object(p)) => {
                for (a, b) in p {
                    let b = b.as_str().ok_or_else(|| refused("bad_doc", format!("{path}/match_morph/pairs/{a}")))?;
                    pairs.push((a.trim_start_matches('#').to_string(), b.trim_start_matches('#').to_string()));
                }
            }
            Some(_) => return Err(refused("bad_doc", format!("{path}/match_morph/pairs"))),
        }
        let unpaired = match fields.and_then(|f| f.get("unpaired")).map(|u| u.as_str()) {
            None | Some(Some("fade")) => Unpaired::Fade,
            Some(Some("morph")) => Unpaired::Morph,
            Some(Some("cross_fade")) => Unpaired::CrossFade,
            Some(Some("split")) => Unpaired::Split,
            Some(_) => return Err(refused("bad_doc", format!("{path}/match_morph/unpaired"))),
        };
        out.push(Between { id: id.clone(), from, to, start, end: start + span, ease, pairs, unpaired });
    }
    Ok(out)
}

/// One side's part: its name (`item#part`), the key it pairs by (a part's id or a row's key), and
/// its shape in document u.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub name: String,
    pub key: String,
    pub shape: Shape,
}

/// One piece a match morph draws at its progress: the parts it comes from and goes to, its
/// centre, its opacity and its shape.
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub from: Option<String>,
    pub to: Option<String>,
    pub centre: [f64; 2],
    pub opacity: f64,
    pub shape: Shape,
}

/// A shape's box: `[x0, y0, x1, y1]`.
fn bbox(shape: &Shape) -> [f64; 4] {
    shape.iter().flat_map(|s| &s.points).fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, p| {
        [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])]
    })
}

/// A shape's box centre.
pub fn centre(shape: &Shape) -> [f64; 2] {
    let b = bbox(shape);
    [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0]
}

/// A shape with its box's corner at the origin, rounded to 1e-6 u: equal for two copies of one
/// shape wherever they sit.
fn shape_hash(shape: &Shape) -> String {
    let b = bbox(shape);
    let q = |v: f64| (v * 1e6).round() as i64;
    shape.iter().map(|s| s.points.iter().map(|p| format!("{},{};", q(p[0] - b[0]), q(p[1] - b[1]))).collect::<String>() + if s.closed { "Z" } else { "|" }).collect()
}

/// Reading order: by the box's top, then its left.
fn reading(parts: &[Part]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..parts.len()).collect();
    order.sort_by(|&i, &j| {
        let (a, b) = (bbox(&parts[i].shape), bbox(&parts[j].shape));
        a[1].total_cmp(&b[1]).then(a[0].total_cmp(&b[0])).then(i.cmp(&j))
    });
    order
}

fn lerp2(a: [f64; 2], b: [f64; 2], p: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p]
}

/// `a` morphing into `b` at progress p, their points matched.
fn mixed(a: &Shape, b: &Shape, p: f64) -> Shape {
    let (ma, mb) = if structure(a) == structure(b) { (a.clone(), b.clone()) } else { matched(a, b) };
    let (fa, fb) = (flat(&ma), flat(&mb));
    let v: Vec<f64> = fa.iter().zip(&fb).map(|(x, y)| x + (y - x) * p).collect();
    unflat(&v, &structure(&ma))
}

/// The pieces of a match morph at progress p: `pairs` first, then parts whose keys are equal,
/// then what's left by shape hash in reading order; the rest as `unpaired` says (Transition).
pub fn pieces(a: &[Part], b: &[Part], pairs: &[(String, String)], unpaired: Unpaired, p: f64) -> Vec<Piece> {
    let (mut used_a, mut used_b) = (vec![false; a.len()], vec![false; b.len()]);
    let mut paired: Vec<(usize, usize)> = Vec::new();
    let mut take = |i: usize, j: usize, used_a: &mut Vec<bool>, used_b: &mut Vec<bool>| {
        if !used_a[i] && !used_b[j] {
            used_a[i] = true;
            used_b[j] = true;
            paired.push((i, j));
        }
    };
    for (x, y) in pairs {
        if let (Some(i), Some(j)) = (a.iter().position(|q| &q.key == x), b.iter().position(|q| &q.key == y)) {
            take(i, j, &mut used_a, &mut used_b);
        }
    }
    for (i, part) in a.iter().enumerate() {
        if let Some(j) = b.iter().position(|q| q.key == part.key) {
            take(i, j, &mut used_a, &mut used_b);
        }
    }
    let (ra, rb) = (reading(a), reading(b));
    for &i in &ra {
        let hash = shape_hash(&a[i].shape);
        if let Some(&j) = rb.iter().find(|&&j| !used_b[j] && !used_a[i] && shape_hash(&b[j].shape) == hash) {
            take(i, j, &mut used_a, &mut used_b);
        }
    }
    let left_a: Vec<usize> = ra.iter().copied().filter(|&i| !used_a[i]).collect();
    let left_b: Vec<usize> = rb.iter().copied().filter(|&j| !used_b[j]).collect();
    let morph = |i: usize, j: usize, opacity: f64| Piece {
        from: Some(a[i].name.clone()),
        to: Some(b[j].name.clone()),
        centre: lerp2(centre(&a[i].shape), centre(&b[j].shape), p),
        opacity,
        shape: mixed(&a[i].shape, &b[j].shape, p),
    };
    let mut out: Vec<Piece> = paired.iter().map(|&(i, j)| morph(i, j, 1.0)).collect();
    let going = |i: usize, opacity: f64| Piece { from: Some(a[i].name.clone()), to: None, centre: centre(&a[i].shape), opacity, shape: a[i].shape.clone() };
    let coming = |j: usize, opacity: f64| Piece { from: None, to: Some(b[j].name.clone()), centre: centre(&b[j].shape), opacity, shape: b[j].shape.clone() };
    match unpaired {
        Unpaired::Fade | Unpaired::CrossFade => {
            out.extend(left_a.iter().map(|&i| going(i, 1.0 - p)));
            out.extend(left_b.iter().map(|&j| coming(j, p)));
        }
        Unpaired::Morph => {
            let n = left_a.len().min(left_b.len());
            out.extend((0..n).map(|k| morph(left_a[k], left_b[k], 1.0)));
            out.extend(left_a[n..].iter().map(|&i| going(i, 1.0 - p)));
            out.extend(left_b[n..].iter().map(|&j| coming(j, p)));
        }
        Unpaired::Split => {
            // Each part left over on the incoming side comes from the nearest left on the
            // outgoing side, so one part becomes as many copies as it has: copies that start as
            // the one part (their opacities sum to its own) and end whole on their parts.
            let near = |j: usize| {
                left_a.iter().copied().min_by(|&x, &y| {
                    let (cx, cy, cj) = (centre(&a[x].shape), centre(&a[y].shape), centre(&b[j].shape));
                    let d = |c: [f64; 2]| (c[0] - cj[0]) * (c[0] - cj[0]) + (c[1] - cj[1]) * (c[1] - cj[1]);
                    d(cx).total_cmp(&d(cy))
                })
            };
            let sources: Vec<(usize, Option<usize>)> = left_b.iter().map(|&j| (j, near(j))).collect();
            for &i in &left_a {
                let copies: Vec<usize> = sources.iter().filter(|(_, s)| *s == Some(i)).map(|(j, _)| *j).collect();
                if copies.is_empty() {
                    out.push(going(i, 1.0 - p));
                }
                let n = copies.len() as f64;
                out.extend(copies.iter().map(|&j| morph(i, j, (1.0 - p) / n + p)));
            }
            out.extend(sources.iter().filter(|(_, s)| s.is_none()).map(|&(j, _)| coming(j, p)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::ops::{cos, sin, PI};

    fn ngon(n: usize, r: f64, inner: Option<f64>) -> Sub {
        let k = if inner.is_some() { 2 * n } else { n };
        let points = (0..k)
            .map(|i| {
                let a = 2.0 * PI * i as f64 / k as f64 - PI / 2.0;
                let rr = if i % 2 == 1 { inner.unwrap_or(r) } else { r };
                [rr * cos(a), rr * sin(a)]
            })
            .collect();
        Sub { points, closed: true }
    }

    #[test]
    fn a_circle_and_a_star_match_to_one_count_keeping_the_stars_corners() {
        let (circle, star) = (vec![ngon(64, 1.0, None)], vec![ngon(5, 1.0, Some(0.4))]);
        let (a, b) = matched(&circle, &star);
        assert_eq!(structure(&a), structure(&b));
        assert_eq!(a[0].points.len(), 64);
        assert_eq!(a, circle);
        for corner in &star[0].points {
            assert!(b[0].points.contains(corner), "corner {corner:?} kept");
        }
    }

    #[test]
    fn an_unpartnered_sub_path_grows_from_its_centroid() {
        let one = vec![ngon(4, 1.0, None)];
        let two = vec![ngon(4, 1.0, None), Sub { points: ngon(4, 0.5, None).points.iter().map(|p| [p[0] + 5.0, p[1]]).collect(), closed: true }];
        let (a, b) = matched(&one, &two);
        assert_eq!(a.len(), 2);
        assert!(a[1].points.iter().all(|p| (p[0] - 5.0).abs() < 1e-12 && p[1].abs() < 1e-12));
        assert_eq!(b[1], two[1]);
    }
}
