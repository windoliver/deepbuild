//! An item's shapes: its geometry as Lottie's own (rc, el, sh), the path ops Lottie has (tm, rd,
//! pb) after it, a repeater as its copies, and its paints, all in one group named by the item.
//! An item whose path Lottie can't build itself (zig zag, offset path, twist, ends, an
//! attachment, a bend, a lagged or slid repeater) writes its output paths where they draw,
//! keyed at each export frame where they change.

use deep_canvas::ops;
use deep_canvas_marks::path::{parse, Verb};
use deep_canvas_marks::pathops::Affine;
use deep_canvas_marks::scene::{base_verbs, path_report, Planted};
use serde_json::{json, Map, Value};

use super::keys::{num, nums};
use super::{layers, paint, Ctx, Warning};

pub struct Shapes {
    pub list: Vec<Value>,
    /// Its paths sit where they draw: the layer applies only the turn.
    pub baked: bool,
}

type P = [f64; 2];

/// A point placed by `x ↦ s·x + o`.
pub fn place(v: Verb, s: [f64; 2], o: [f64; 2]) -> Verb {
    let m = |p: P| [s[0] * p[0] + o[0], s[1] * p[1] + o[1]];
    match v {
        Verb::Move(p) => Verb::Move(m(p)),
        Verb::Line(p) => Verb::Line(m(p)),
        Verb::Quad(a, b) => Verb::Quad(m(a), m(b)),
        Verb::Cubic(a, b, c) => Verb::Cubic(m(a), m(b), m(c)),
        Verb::Close => Verb::Close,
    }
}

/// One Lottie path: closed or not, its vertices and each vertex's in and out tangents relative
/// to it.
#[derive(Clone, Debug, PartialEq)]
pub struct LPath {
    pub c: bool,
    pub v: Vec<P>,
    pub i: Vec<P>,
    pub o: Vec<P>,
}

impl LPath {
    pub fn json(&self) -> Value {
        let pts = |l: &[P]| Value::Array(l.iter().map(|p| nums(p)).collect());
        json!({"c": self.c, "v": pts(&self.v), "i": pts(&self.i), "o": pts(&self.o)})
    }
}

/// Verbs as Lottie paths, one per sub-path; a closing segment back to the start folds into the
/// first vertex.
pub fn lottie_paths(verbs: &[Verb]) -> Vec<LPath> {
    let mut out: Vec<LPath> = Vec::new();
    let mut cur: Option<LPath> = None;
    let sub = |p: P, q: P| [p[0] - q[0], p[1] - q[1]];
    let finish = |cur: &mut Option<LPath>, out: &mut Vec<LPath>, closed: bool| {
        if let Some(mut l) = cur.take() {
            if closed && l.v.len() > 1 {
                let (first, last) = (l.v[0], l.v[l.v.len() - 1]);
                if (first[0] - last[0]).abs() < 1e-9 && (first[1] - last[1]).abs() < 1e-9 {
                    let i_last = l.i.pop().unwrap_or([0.0, 0.0]);
                    l.v.pop();
                    l.o.pop();
                    l.i[0] = i_last;
                }
            }
            l.c = closed;
            if !l.v.is_empty() {
                out.push(l);
            }
        }
    };
    for v in verbs {
        match *v {
            Verb::Move(p) => {
                finish(&mut cur, &mut out, false);
                cur = Some(LPath {
                    c: false,
                    v: vec![p],
                    i: vec![[0.0, 0.0]],
                    o: vec![[0.0, 0.0]],
                });
            }
            Verb::Line(p) => {
                if let Some(l) = cur.as_mut() {
                    l.v.push(p);
                    l.i.push([0.0, 0.0]);
                    l.o.push([0.0, 0.0]);
                }
            }
            Verb::Quad(c, p) => {
                if let Some(l) = cur.as_mut() {
                    let prev = l.v[l.v.len() - 1];
                    let c1 = [
                        prev[0] + 2.0 / 3.0 * (c[0] - prev[0]),
                        prev[1] + 2.0 / 3.0 * (c[1] - prev[1]),
                    ];
                    let c2 = [
                        p[0] + 2.0 / 3.0 * (c[0] - p[0]),
                        p[1] + 2.0 / 3.0 * (c[1] - p[1]),
                    ];
                    let n = l.o.len() - 1;
                    l.o[n] = sub(c1, prev);
                    l.v.push(p);
                    l.i.push(sub(c2, p));
                    l.o.push([0.0, 0.0]);
                }
            }
            Verb::Cubic(c1, c2, p) => {
                if let Some(l) = cur.as_mut() {
                    let prev = l.v[l.v.len() - 1];
                    let n = l.o.len() - 1;
                    l.o[n] = sub(c1, prev);
                    l.v.push(p);
                    l.i.push(sub(c2, p));
                    l.o.push([0.0, 0.0]);
                }
            }
            Verb::Close => finish(&mut cur, &mut out, true),
        }
    }
    finish(&mut cur, &mut out, false);
    out
}

/// A shape property from the paths at each export frame: static, or a key at each frame where it
/// changes (a sampled value, listed). `None` when the paths' structure changes, which Lottie's
/// shape keys can't follow.
pub fn path_prop(ctx: &mut Ctx, id: &str, field: &str, frames: &[Vec<Verb>]) -> Option<Value> {
    let paths: Vec<Vec<LPath>> = frames.iter().map(|v| lottie_paths(v)).collect();
    let first = paths.first()?;
    if first.len() != 1 {
        // One shape property holds one sub-path; a caller with more splits them.
        return None;
    }
    one_prop(
        ctx,
        id,
        field,
        &paths.iter().map(|p| p[0].clone()).collect::<Vec<_>>(),
    )
}

/// [`path_prop`], with the shape written as Lottie's own hold keys at `holds` (export frames) when
/// the shape only changes there; otherwise as [`path_prop`] writes it.
pub fn path_prop_holding(
    ctx: &mut Ctx,
    id: &str,
    field: &str,
    frames: &[Vec<Verb>],
    holds: Option<Vec<f64>>,
) -> Option<Value> {
    let paths: Vec<Vec<LPath>> = frames.iter().map(|v| lottie_paths(v)).collect();
    if let (Some(times), true) = (holds, paths.first().is_some_and(|p| p.len() == 1)) {
        let one: Vec<LPath> = paths.iter().map(|p| p[0].clone()).collect();
        if one.iter().all(|p| p == &one[0]) {
            return Some(json!({"a": 0, "k": one[0].json()}));
        }
        let n = one.len();
        // Each key holds the shape of the first export frame at or after its time.
        let mut keys: Vec<(f64, usize)> = vec![(0.0, 0)];
        for t in times.into_iter().filter(|t| *t > 0.0 && *t < n as f64) {
            keys.push((t, t.ceil() as usize));
        }
        let held = |j: usize| {
            keys.iter()
                .rev()
                .find(|(t, _)| *t <= j as f64)
                .map_or(0, |k| k.1)
        };
        if (0..n).all(|j| one[held(j)] == one[j]) {
            let list: Vec<Value> = keys
                .iter()
                .map(|(t, j)| json!({"t": num(*t), "s": [one[*j].json()], "h": 1}))
                .collect();
            return Some(json!({"a": 1, "k": list}));
        }
    }
    path_prop(ctx, id, field, frames)
}

fn one_prop(ctx: &mut Ctx, id: &str, field: &str, frames: &[LPath]) -> Option<Value> {
    let first = frames.first()?;
    if frames.iter().all(|p| p == first) {
        return Some(json!({"a": 0, "k": first.json()}));
    }
    if frames
        .iter()
        .any(|p| p.v.len() != first.v.len() || p.c != first.c)
    {
        ctx.warnings.push(Warning::cant_hold(
            id,
            format!("{field}: a path whose point count changes over time"),
            format!("items/{id}/{field}"),
        ));
        return None;
    }
    ctx.sampled(id, field);
    let n = frames.len();
    let mut keys = Vec::new();
    for (j, p) in frames.iter().enumerate() {
        let same_before = j > 0 && frames[j - 1] == *p;
        let same_after = frames.get(j + 1) == Some(p);
        if same_before && (same_after || j + 1 == frames.len()) {
            continue;
        }
        let mut k = Map::new();
        k.insert("t".into(), json!(j));
        k.insert("s".into(), json!([p.json()]));
        if j + 1 < n {
            k.insert("o".into(), json!({"x": 0, "y": 0}));
            k.insert("i".into(), json!({"x": 1, "y": 1}));
        }
        keys.push(Value::Object(k));
    }
    Some(json!({"a": 1, "k": keys}))
}

/// Sub-path shapes (`sh`), one per sub-path, from the paths at each frame.
fn sh_list(ctx: &mut Ctx, id: &str, field: &str, frames: &[Vec<Verb>]) -> Option<Vec<Value>> {
    let paths: Vec<Vec<LPath>> = frames.iter().map(|v| lottie_paths(v)).collect();
    let count = paths.first()?.len();
    if paths.iter().any(|p| p.len() != count) {
        ctx.warnings.push(Warning::cant_hold(
            id,
            format!("{field}: a path whose sub-path count changes over time"),
            format!("items/{id}/{field}"),
        ));
        return None;
    }
    (0..count)
        .map(|k| {
            let per: Vec<LPath> = paths.iter().map(|p| p[k].clone()).collect();
            let ks = one_prop(ctx, id, field, &per)?;
            Some(json!({"ty": "sh", "nm": format!("{id}.path.{k}"), "ks": ks}))
        })
        .collect()
}

/// The op kinds Lottie writes as its own modifiers.
const NATIVE_OPS: [&str; 3] = ["trim", "round_corners", "pucker"];

fn op_kind(op: &Value) -> Option<&str> {
    op.as_object()?.keys().next().map(String::as_str)
}

/// Whether Lottie can build the item's path itself from its geometry and ops.
fn native(item: &Value) -> bool {
    let p = item.get("params").and_then(Value::as_object);
    let Some(p) = p else { return true };
    if ["attach", "bend", "ends", "width", "outline"]
        .iter()
        .any(|k| p.get(*k).is_some_and(|v| !v.is_null()))
    {
        return false;
    }
    if item.get("kind").and_then(Value::as_str) == Some("circle@1")
        && p.get("inner_r").and_then(Value::as_f64).unwrap_or(0.0) != 0.0
    {
        return false;
    }
    let ops = p
        .get("ops")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for (k, op) in ops.iter().enumerate() {
        match op_kind(op) {
            Some(n) if NATIVE_OPS.contains(&n) => {}
            Some("repeater") if k + 1 == ops.len() => {
                let r = &op["repeater"];
                let plain = r.get("lag").is_none_or(Value::is_null)
                    && r.get("partial")
                        .and_then(Value::as_str)
                        .is_none_or(|s| s == "fade")
                    && r.get("ease").is_none_or(Value::is_null);
                if !plain {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

/// The item's shapes, with its hard drop and its unblurred halos as copies below it.
pub fn of(ctx: &mut Ctx, id: &str, item: &Value) -> Option<Shapes> {
    let (list, baked) = if native(item) {
        (native_shapes(ctx, id, item)?, false)
    } else {
        (baked_shapes(ctx, id, item)?, true)
    };
    let mut out = list.clone();
    out.extend(copies_below(ctx, id, item, &list));
    Some(Shapes { list: out, baked })
}

/// A color as Lottie writes it.
fn rgba(c: [u8; 3]) -> Value {
    nums(&[
        f64::from(c[0]) / 255.0,
        f64::from(c[1]) / 255.0,
        f64::from(c[2]) / 255.0,
        1.0,
    ])
}

/// `group`'s geometry with every paint replaced by `paints`.
fn repainted(group: &Value, paints: &[Value]) -> Value {
    let mut g = group.clone();
    if let Some(it) = g.get_mut("it").and_then(Value::as_array_mut) {
        let tr = it.pop();
        it.retain(|s| {
            !matches!(
                s.get("ty").and_then(Value::as_str),
                Some("fl" | "st" | "gf" | "gs")
            )
        });
        for x in it.iter_mut() {
            if x.get("ty").and_then(Value::as_str) == Some("gr") {
                *x = repainted(x, paints);
            }
        }
        if !it
            .iter()
            .any(|x| x.get("ty").and_then(Value::as_str) == Some("gr"))
        {
            it.extend(paints.iter().cloned());
        }
        it.extend(tr);
        let np = it.len();
        g["np"] = json!(np);
    }
    g
}

/// A hard drop as an offset copy in its color, and each halo with no blur as a stroked copy,
/// drawn below the item (Lottie draws later shapes below earlier ones).
pub(crate) fn copies_below(ctx: &mut Ctx, id: &str, item: &Value, list: &[Value]) -> Vec<Value> {
    let Some(main) = list.first() else {
        return Vec::new();
    };
    let color = |o: &Value| {
        o.get("role")
            .and_then(Value::as_str)
            .and_then(|r| ctx.palette.get(r))
            .copied()
    };
    let mut out = Vec::new();
    let fills = item.pointer("/params/paint/fill").is_some();
    let strokes = item
        .pointer("/params/paint/stroke/width")
        .and_then(Value::as_f64);
    if let Some(d) = item
        .pointer("/params/paint/drop")
        .filter(|d| d.get("blur").and_then(Value::as_f64).unwrap_or(0.0) == 0.0)
    {
        if let Some(c) = color(d) {
            let mut paints = Vec::new();
            if let Some(w) = strokes {
                paints.push(json!({"ty": "st", "nm": "drop", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": num(w)}, "lc": 1, "lj": 1, "ml": 4}));
            }
            if fills || strokes.is_none() {
                paints.push(json!({"ty": "fl", "nm": "drop", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "r": 1}));
            }
            let off = d
                .get("offset")
                .and_then(Value::as_array)
                .map(|a| {
                    [
                        a.first().and_then(Value::as_f64).unwrap_or(6.0),
                        a.get(1).and_then(Value::as_f64).unwrap_or(6.0),
                    ]
                })
                .unwrap_or([6.0, 6.0]);
            let o = d.get("opacity").and_then(Value::as_f64).unwrap_or(1.0) * 100.0;
            let body = repainted(main, &paints);
            let t = tr(
                json!({"a": 0, "k": nums(&off)}),
                json!({"a": 0, "k": 0}),
                json!({"a": 0, "k": [100, 100]}),
                json!({"a": 0, "k": num(o)}),
            );
            out.push(group(format!("{id}.drop"), vec![body], t));
        }
    }
    // Halos draw on text only (Text: halo); a text's copies come from its own layer.
    let texts = item.get("kind").and_then(Value::as_str) == Some("text@1");
    let mut halos: Vec<&Value> = item
        .pointer("/params/halo")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|_| texts)
        .collect();
    // The widest halo draws lowest.
    halos.sort_by(|a, b| {
        let w = |h: &Value| h.get("width").and_then(Value::as_f64).unwrap_or(2.0);
        w(a).total_cmp(&w(b))
    });
    for (k, h) in halos.into_iter().enumerate() {
        if h.get("blur").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 {
            continue;
        }
        let Some(c) = color(h) else { continue };
        let w = h.get("width").and_then(Value::as_f64).unwrap_or(2.0);
        let o = h.get("opacity").and_then(Value::as_f64).unwrap_or(1.0) * 100.0;
        let off = h
            .get("offset")
            .and_then(Value::as_array)
            .map(|a| {
                [
                    a.first().and_then(Value::as_f64).unwrap_or(0.0),
                    a.get(1).and_then(Value::as_f64).unwrap_or(0.0),
                ]
            })
            .unwrap_or([0.0, 0.0]);
        let paints = vec![
            json!({"ty": "st", "nm": "halo", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": num(2.0 * w + strokes.unwrap_or(0.0))}, "lc": 2, "lj": 2, "ml": 4}),
            json!({"ty": "fl", "nm": "halo", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "r": 1}),
        ];
        let body = repainted(main, &paints);
        let t = tr(
            json!({"a": 0, "k": nums(&off)}),
            json!({"a": 0, "k": 0}),
            json!({"a": 0, "k": [100, 100]}),
            json!({"a": 0, "k": num(o)}),
        );
        out.push(group(format!("{id}.halo.{k}"), vec![body], t));
    }
    out
}

fn tr(p: Value, r: Value, s: Value, o: Value) -> Value {
    json!({"ty": "tr", "nm": "transform", "p": p, "a": {"a": 0, "k": [0, 0]}, "s": s, "r": r, "o": o,
        "sk": {"a": 0, "k": 0}, "sa": {"a": 0, "k": 0}})
}

pub(crate) fn identity() -> Value {
    identity_tr()
}

fn identity_tr() -> Value {
    tr(
        json!({"a": 0, "k": [0, 0]}),
        json!({"a": 0, "k": 0}),
        json!({"a": 0, "k": [100, 100]}),
        json!({"a": 0, "k": 100}),
    )
}

fn group(nm: String, mut it: Vec<Value>, tr: Value) -> Value {
    it.push(tr);
    let np = it.len();
    json!({"ty": "gr", "nm": nm, "np": np, "it": it})
}

/// Geometry as Lottie's own shape.
fn geometry(ctx: &mut Ctx, id: &str, item: &Value) -> Option<Vec<Value>> {
    let kind = item.get("kind").and_then(Value::as_str)?;
    let get = |i: &Value, k: &str| i.pointer(&format!("/params/{k}")).cloned();
    // A trim measures from where the path starts and runs the way it runs: Lottie's own
    // rectangle and ellipse start elsewhere, so a trimmed one is written as the path it draws.
    let trimmed = item
        .pointer("/params/ops")
        .and_then(Value::as_array)
        .is_some_and(|ops| ops.iter().any(|o| op_kind(o) == Some("trim")));
    let kind = if trimmed && matches!(kind, "rect@1" | "circle@1") {
        "outline"
    } else {
        kind
    };
    match kind {
        "rect@1" => {
            let pread = |i: &Value| {
                let b = get(i, "box")?;
                let b: Vec<f64> = b.as_array()?.iter().filter_map(Value::as_f64).collect();
                Some(vec![b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])
            };
            let pmap = |b: &[f64]| vec![b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
            let sread = |i: &Value| {
                let b = get(i, "box")?;
                let b: Vec<f64> = b.as_array()?.iter().filter_map(Value::as_f64).collect();
                Some(vec![b[2], b[3]])
            };
            let smap = |b: &[f64]| vec![b[2], b[3]];
            let rread = |i: &Value| {
                Some(vec![get(i, "radius")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)])
            };
            let rmap = |v: &[f64]| vec![v[0]];
            let p = layers::prop(
                ctx,
                id,
                "params/box",
                &pread,
                &[(&["params", "box"], &pmap)],
            );
            let s = layers::prop(
                ctx,
                id,
                "params/box",
                &sread,
                &[(&["params", "box"], &smap)],
            );
            let r = layers::prop(
                ctx,
                id,
                "params/radius",
                &rread,
                &[(&["params", "radius"], &rmap)],
            );
            Some(vec![
                json!({"ty": "rc", "nm": id, "d": 1, "p": p.json(false), "s": s.json(false), "r": r.json(true)}),
            ])
        }
        "circle@1" => {
            let pread = |i: &Value| {
                Some(
                    get(i, "center")?
                        .as_array()?
                        .iter()
                        .filter_map(Value::as_f64)
                        .take(2)
                        .collect(),
                )
            };
            let pmap = |c: &[f64]| c[..2].to_vec();
            let sread = |i: &Value| {
                let r = get(i, "r").and_then(|v| v.as_f64()).unwrap_or(0.0);
                Some(vec![2.0 * r, 2.0 * r])
            };
            let smap = |r: &[f64]| vec![2.0 * r[0], 2.0 * r[0]];
            let p = layers::prop(
                ctx,
                id,
                "params/center",
                &pread,
                &[(&["params", "center"], &pmap)],
            );
            let s = layers::prop(ctx, id, "params/r", &sread, &[(&["params", "r"], &smap)]);
            Some(vec![
                json!({"ty": "el", "nm": id, "d": 1, "p": p.json(false), "s": s.json(false)}),
            ])
        }
        _ => {
            // A path's `d`, or any other shape's outline, as Lottie paths.
            let frames: Option<Vec<Vec<Verb>>> = ctx
                .evals
                .iter()
                .map(|items| {
                    let i = items.get(id)?;
                    let params = i.get("params")?.as_object()?;
                    let own = i.get("kind").and_then(Value::as_str)?;
                    if own == "path@1" {
                        parse(params.get("d")?.as_str()?)
                    } else {
                        base_verbs(own, params)
                    }
                })
                .collect();
            sh_list(ctx, id, "params/d", &frames?)
        }
    }
}

/// The native ops, in order, as Lottie modifiers.
fn modifiers(ctx: &mut Ctx, id: &str, item: &Value) -> Vec<Value> {
    let ops = item
        .pointer("/params/ops")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for (k, op) in ops.iter().enumerate() {
        let Some(name) = op_kind(op) else { continue };
        let field = |f: &str| format!("params/ops/{k}/{name}/{f}");
        let ptr = |f: &str| format!("/params/ops/{k}/{name}/{f}");
        let scalar = |ctx: &mut Ctx, f: &str, default: f64, scale: f64| {
            let p = ptr(f);
            let read = move |i: &Value| {
                Some(vec![
                    i.pointer(&p).and_then(Value::as_f64).unwrap_or(default) * scale,
                ])
            };
            let map = move |v: &[f64]| vec![v[0] * scale];
            let kk = k.to_string();
            let path: Vec<&str> = vec!["params", "ops", &kk, name, f];
            layers::prop(ctx, id, &field(f), &read, &[(&path, &map)])
        };
        match name {
            "trim" => {
                let s = scalar(ctx, "start", 0.0, 100.0);
                let e = scalar(ctx, "end", 1.0, 100.0);
                let o = scalar(ctx, "offset", 0.0, 1.0);
                let each = op
                    .pointer("/trim/each")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                out.push(json!({"ty": "tm", "nm": format!("{id}.trim.{k}"), "s": s.json(true), "e": e.json(true), "o": o.json(true), "m": if each { 1 } else { 2 }}));
            }
            "round_corners" => {
                let r = scalar(ctx, "radius", 10.0, 1.0);
                out.push(json!({"ty": "rd", "nm": format!("{id}.round.{k}"), "r": r.json(true)}));
            }
            "pucker" => {
                let a = scalar(ctx, "amount", 0.0, 100.0);
                out.push(json!({"ty": "pb", "nm": format!("{id}.pucker.{k}"), "a": a.json(true)}));
            }
            _ => {}
        }
    }
    out
}

/// An affine as Lottie's position, rotation and scale (no shear).
fn decompose(m: Affine) -> ([f64; 2], f64, [f64; 2]) {
    let [a, b, c, d, e, f] = m;
    let sx = ops::hypot(a, b);
    let rot = ops::deg(ops::atan2(b, a));
    let sy = if sx == 0.0 { 0.0 } else { (a * d - b * c) / sx };
    ([e, f], rot, [sx * 100.0, sy * 100.0])
}

fn native_shapes(ctx: &mut Ctx, id: &str, item: &Value) -> Option<Vec<Value>> {
    let mut it = geometry(ctx, id, item)?;
    it.extend(modifiers(ctx, id, item));
    let paints = paint::paints(ctx, id, item);
    let repeats = item
        .pointer("/params/ops")
        .and_then(Value::as_array)
        .and_then(|o| o.last())
        .and_then(op_kind)
        == Some("repeater");
    if !repeats {
        it.extend(paints);
        return Some(vec![group(id.to_string(), it, identity_tr())]);
    }
    // The repeater's copies, as the path report places them at each frame.
    let copies: Vec<Vec<(Affine, f64)>> = (0..ctx.evals.len())
        .map(|j| {
            let r = path_report(
                ctx.doc,
                &ctx.evals[j],
                (ctx.palette, ctx.ty),
                id,
                Planted::None,
            )
            .ok()
            .flatten();
            r.and_then(|r| r.copies)
                .map(|c| c.into_iter().map(|(m, o, _)| (m, o)).collect())
                .unwrap_or_default()
        })
        .collect();
    let most = copies.iter().map(Vec::len).max().unwrap_or(0);
    let mut groups = Vec::new();
    // Copy 0 draws on top with the default composite (each new copy below the last).
    for k in 0..most {
        let series: Vec<(Affine, f64)> = copies
            .iter()
            .map(|c| {
                c.get(k).copied().unwrap_or_else(|| {
                    (
                        c.last()
                            .map_or(deep_canvas_marks::pathops::IDENTITY, |x| x.0),
                        0.0,
                    )
                })
            })
            .collect();
        let field = format!("params/ops/repeater/copy {k}");
        let p_series: Vec<Vec<f64>> = series
            .iter()
            .map(|(m, _)| decompose(*m).0.to_vec())
            .collect();
        let r_series: Vec<Vec<f64>> = series.iter().map(|(m, _)| vec![decompose(*m).1]).collect();
        let s_series: Vec<Vec<f64>> = series
            .iter()
            .map(|(m, _)| decompose(*m).2.to_vec())
            .collect();
        let o_series: Vec<Vec<f64>> = series.iter().map(|(_, o)| vec![o * 100.0]).collect();
        let mut prop = |s: &[Vec<f64>], scalar: bool| {
            let (p, made) = super::keys::choose(s, None);
            if made == super::keys::Made::Sampled {
                ctx.sampled(id, &field);
            }
            p.json(scalar)
        };
        let t = tr(
            prop(&p_series, false),
            prop(&r_series, true),
            prop(&s_series, false),
            prop(&o_series, true),
        );
        let mut copy = it.clone();
        copy.extend(paints.iter().cloned());
        groups.push(group(format!("{id}.copy.{k}"), copy, t));
    }
    Some(vec![group(id.to_string(), groups, identity_tr())])
}

/// The output paths where they draw at each frame, each repeater copy a group with its opacity.
fn baked_shapes(ctx: &mut Ctx, id: &str, item: &Value) -> Option<Vec<Value>> {
    let reports: Vec<_> = (0..ctx.evals.len())
        .map(|j| {
            path_report(
                ctx.doc,
                &ctx.evals[j],
                (ctx.palette, ctx.ty),
                id,
                Planted::None,
            )
            .ok()
            .flatten()
        })
        .collect();
    if reports.iter().any(Option::is_none) {
        ctx.warnings.push(Warning::cant_hold(
            id,
            "a path the writer can't build".into(),
            format!("items/{id}"),
        ));
        return None;
    }
    let reports: Vec<_> = reports.into_iter().flatten().collect();
    let copies = reports.iter().map(|r| r.placed.len()).max().unwrap_or(0);
    let paints = paint::paints(ctx, id, item);
    let mut groups = Vec::new();
    for k in 0..copies {
        let frames: Vec<Vec<Verb>> = reports
            .iter()
            .map(|r| r.placed.get(k).cloned().unwrap_or_default())
            .collect();
        let Some(mut it) = sh_list(ctx, id, "params/ops", &frames) else {
            continue;
        };
        it.extend(paints.iter().cloned());
        let o: Vec<Vec<f64>> = reports
            .iter()
            .map(|r| {
                vec![
                    r.copies
                        .as_ref()
                        .and_then(|c| c.get(k))
                        .map_or(1.0, |c| c.1)
                        * 100.0,
                ]
            })
            .collect();
        let (op, made) = super::keys::choose(&o, None);
        if made == super::keys::Made::Sampled {
            ctx.sampled(id, "params/ops");
        }
        let t = tr(
            json!({"a": 0, "k": [0, 0]}),
            json!({"a": 0, "k": 0}),
            json!({"a": 0, "k": [100, 100]}),
            op.json(true),
        );
        groups.push(group(format!("{id}.copy.{k}"), it, t));
    }
    // Ends: each head a path of its own where it draws, in the stroke's color, keyed at each
    // export frame where it moves.
    let heads = reports.first().map_or(0, |r| r.ends.len());
    let stroke = item.pointer("/params/paint/stroke");
    let ink = stroke
        .and_then(|s| s.get("role"))
        .and_then(Value::as_str)
        .and_then(|r| ctx.palette.get(r))
        .copied();
    for h in 0..heads {
        let frames: Vec<Vec<Verb>> = reports
            .iter()
            .map(|r| r.ends.get(h).map(|e| e.verbs.clone()).unwrap_or_default())
            .collect();
        let Some(mut it) = sh_list(ctx, id, "params/ends", &frames) else {
            continue;
        };
        let filled = reports[0].ends[h].filled;
        if let Some(c) = ink {
            if filled {
                it.push(json!({"ty": "fl", "nm": "end", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "r": 1}));
            } else {
                let w = stroke
                    .and_then(|s| s.get("width"))
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0);
                it.push(json!({"ty": "st", "nm": "end", "c": {"a": 0, "k": rgba(c)}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": num(w)}, "lc": 1, "lj": 1, "ml": 4}));
            }
        }
        let at = reports[0].ends[h].at;
        groups.insert(0, group(format!("{id}.end.{at}.{h}"), it, identity_tr()));
    }
    Some(vec![group(id.to_string(), groups, identity_tr())])
}
