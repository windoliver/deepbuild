//! The building canvas module (canvas primitives: Building module; issue #420): walls,
//! openings, slabs, roofs, stairs, zones, levels and guard rails as trusted builders, each
//! declaring what it reads. No runtime boolean geometry: a wall builds its openings' holes into
//! its own outline and its mitres from the walls that meet its ends; a slab builds the stair
//! well it names into its own outline. Plan coordinates `[x, y]` are the item's x and z.

use deep_canvas::ops::{rad, tan};
use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use serde_json::{json, Map, Value};

use crate::builders::{self, outline, prism, Ctx, Fault};
use crate::geom::{area2, Mesh, V2, V3};

/// The building module's kinds.
pub const KINDS: [&str; 8] = [
    "arch.wall@1",
    "arch.opening@1",
    "arch.slab@1",
    "arch.roof@1",
    "arch.stair@1",
    "arch.zone@1",
    "arch.level@1",
    "arch.guard_rail@1",
];

/// A stair's riser is at most this tall (Building module).
pub const RISER_MAX: f64 = 0.18;
/// A stair's going, metres.
const GOING: f64 = 0.25;

fn manifest() -> Manifest {
    let dep = |r: &str| Dependency {
        range: Range::parse(r).expect("a range"),
        optional: false,
    };
    Manifest {
        name: "building".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [
            ("scene3d".to_string(), dep("^1")),
            ("motion".to_string(), dep("^1")),
        ]
        .into_iter()
        .collect(),
        feature: "building".into(),
        license: "Apache-2.0".into(),
        implements: "building@1".into(),
        implementation: deep_canvas::registry::Implementation::reference(
            "building",
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// The building module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

fn register(r: &mut Registrar) {
    for spec in crate::spec::building() {
        let name = &spec.kind["arch.".len()..spec.kind.len() - "@1".len()];
        r.kind(crate::spec::entry(&spec, "arch", name), &[], "");
    }
    crate::build::operators(r, "building", is_building, shades, keyed);
    // A corner of a house, so the kit evaluates the module's operators on its kinds.
    r.fixture("house", house(), None).sidecar(json!({
        "codes": [],
        "covers": {
            "kinds": ["arch.wall@1", "arch.opening@1", "arch.slab@1", "arch.roof@1", "arch.stair@1"],
            "fields": ["arch.wall@1/params/a", "arch.wall@1/params/b", "arch.slab@1/params/outline", "arch.stair@1/params/rise"],
        },
    }));
}

/// Two walls meeting at a corner with a door in one, a floor with a stair's well, a gable roof
/// and the stair.
fn house() -> Value {
    let wall = |id: &str, a: [f64; 2], b: [f64; 2], order: &str| {
        json!({"id": id, "kind": "arch.wall@1", "name": id, "order": order,
               "params": {"a": a, "b": b, "thickness": 0.2, "height": 2.7, "justify": "center", "outside": "left", "cut_height": 1.2}})
    };
    json!({
        "format": 1, "profile": "figure", "title": "A corner of a house",
        "description": "Two walls at a corner, a door in one, a floor with a stair's well, a gable roof and the stair.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1", "building": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "isometric", "target": [2, 1, 1.5], "view_width": 12}},
            "wa": wall("wa", [0.0, 0.0], [4.0, 0.0], "a1"),
            "wb": wall("wb", [4.0, 0.0], [4.0, 3.0], "a2"),
            "door": {"id": "door", "kind": "arch.opening@1", "name": "Door", "order": "a3", "parent": "wa",
                     "params": {"wall": "wa", "type": "door", "at_along": 1, "width": 0.9, "height": 2.1, "sill": 0}},
            "floor": {"id": "floor", "kind": "arch.slab@1", "name": "Floor", "order": "a4",
                      "params": {"outline": [[-1, -1], [9, -1], [9, 7], [-1, 7]], "holes": ["stair"], "thickness": 0.2},
                      "at": {"pos": [0, -0.2, 0]}},
            "roof": {"id": "roof", "kind": "arch.roof@1", "name": "Roof", "order": "a5",
                     "params": {"type": "gable", "size": [4.4, 3.4], "pitch": 30, "overhang": 0.2}, "at": {"pos": [2, 2.7, 1.5]}},
            "stair": {"id": "stair", "kind": "arch.stair@1", "name": "Stair", "order": "a6",
                      "params": {"type": "straight", "rise": 2.6, "width": 0.9}, "at": {"pos": [5, 0, 1]}}
        }
    })
}

fn is_building(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind")
        .and_then(Value::as_str)
        .is_some_and(|k| KINDS.contains(&k))
}

fn shades(d: &Value, i: &str, item: &Value) -> bool {
    is_building(d, i, item) && crate::build::has_shading(d, i, item)
}

fn items(doc: &Value) -> impl Iterator<Item = (&String, &Value)> {
    doc.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
}

fn kind_of(item: &Value) -> &str {
    item.get("kind").and_then(Value::as_str).unwrap_or("")
}

fn v2(v: Option<&Value>) -> Option<V2> {
    let a = v?.as_array().filter(|a| a.len() == 2)?;
    Some([a[0].as_f64()?, a[1].as_f64()?])
}

fn num(p: &Value, name: &str, default: f64) -> Result<f64, Fault> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .ok_or_else(|| format!("params/{name}")),
    }
}

fn pos(item: &Value) -> V3 {
    let a = item.pointer("/at/pos").and_then(Value::as_array);
    let at = |k: usize| {
        a.and_then(|a| a.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    [at(0), at(1), at(2)]
}

const EPS: f64 = 1e-6;

fn near(a: V2, b: V2) -> bool {
    (a[0] - b[0]).abs() < EPS && (a[1] - b[1]).abs() < EPS
}

/// The walls that meet `id`'s ends: every other wall with an end on one of its own.
fn neighbours<'a>(doc: &'a Value, id: &str, item: &Value) -> Vec<(&'a String, &'a Value)> {
    let (Some(a), Some(b)) = (v2(item.pointer("/params/a")), v2(item.pointer("/params/b"))) else {
        return Vec::new();
    };
    items(doc)
        .filter(|(other, w)| other.as_str() != id && kind_of(w) == "arch.wall@1")
        .filter(|(_, w)| {
            [w.pointer("/params/a"), w.pointer("/params/b")]
                .into_iter()
                .filter_map(v2)
                .any(|e| near(e, a) || near(e, b))
        })
        .collect()
}

/// A wall's openings: its children, and the openings that name it.
fn openings<'a>(doc: &'a Value, id: &str) -> Vec<(&'a String, &'a Value)> {
    items(doc)
        .filter(|(_, o)| kind_of(o) == "arch.opening@1")
        .filter(|(_, o)| {
            o.get("parent").and_then(Value::as_str) == Some(id)
                || o.pointer("/params/wall").and_then(Value::as_str) == Some(id)
        })
        .collect()
}

/// What a building kind's build node keys on: its geometry params and transform, and each item
/// it reads (Building module: "Each declares `reads`"), only those its params name or meet.
fn keyed(doc: &Value, id: &str, item: &Value, planted: Option<&str>) -> Value {
    let kind = kind_of(item);
    let mut refs = Map::new();
    let mut add = |id: &String, v: &Value| {
        refs.insert(id.clone(), v.clone());
    };
    let get = |id: &str| doc.get("items").and_then(|i| i.get(id));
    match kind {
        "arch.wall@1" => {
            for (k, v) in neighbours(doc, id, item)
                .into_iter()
                .chain(openings(doc, id))
            {
                add(k, v);
            }
        }
        "arch.opening@1" => {
            if let Some(w) = item.pointer("/params/wall").and_then(Value::as_str) {
                if let Some(v) = get(w) {
                    add(&w.to_string(), v);
                }
            }
        }
        "arch.slab@1" | "arch.zone@1" => {
            let named = item
                .pointer("/params/holes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten();
            let floor = item.pointer("/params/floor").into_iter();
            for h in named.chain(floor).filter_map(Value::as_str) {
                if let Some(v) = get(h) {
                    add(&h.to_string(), v);
                }
            }
        }
        "arch.guard_rail@1" => {
            if let Some(a) = item.pointer("/params/around").and_then(Value::as_str) {
                if let Some(v) = get(a) {
                    add(&a.to_string(), v);
                }
            }
            if item
                .pointer("/params/skip_along_walls")
                .and_then(Value::as_bool)
                == Some(true)
            {
                for (k, v) in items(doc).filter(|(_, w)| kind_of(w) == "arch.wall@1") {
                    add(k, v);
                }
            }
        }
        _ => {}
    }
    json!({"kind": kind, "params": crate::spec::params_of(item, kind, true, planted),
           "at": item.get("at"), "refs": refs})
}

/// Builds a building kind; its outputs ride on the mesh.
pub fn build(doc: &Value, id: &str, item: &Value) -> Result<Mesh, Fault> {
    let p = item.get("params").cloned().unwrap_or(json!({}));
    let mut m = match kind_of(item) {
        "arch.wall@1" => wall(doc, id, &p)?,
        "arch.opening@1" => opening(doc, &p)?,
        "arch.slab@1" => slab(doc, item, &p)?,
        "arch.roof@1" => roof(&p)?,
        "arch.stair@1" => stair(item, &p)?.0,
        "arch.zone@1" => zone(doc, item, &p)?,
        "arch.level@1" => {
            let mut m = Mesh::default();
            m.outputs
                .insert("elevation".into(), json!(num(&p, "elevation", 0.0)?));
            m.outputs
                .insert("height".into(), json!(num(&p, "height", 2.7)?));
            m
        }
        "arch.guard_rail@1" => guard_rail(doc, item, &p)?,
        _ => return Err("kind".into()),
    };
    m.orient();
    Ok(m)
}

/// A wall's plan: its start, its unit direction, its left normal and its length.
struct Plan {
    a: V2,
    d: V2,
    n: V2,
    len: f64,
}

fn plan_of(p: &Value) -> Result<Plan, Fault> {
    let a = v2(p.get("a")).ok_or("params/a")?;
    let b = v2(p.get("b")).ok_or("params/b")?;
    let len = deep_canvas::ops::hypot(b[0] - a[0], b[1] - a[1]);
    if len < EPS {
        return Err("params/b".into());
    }
    let d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    Ok(Plan {
        a,
        d,
        n: [-d[1], d[0]],
        len,
    })
}

/// How far the face at offset `w` runs past the joint at `end` (0 at a, 1 at b), along the
/// wall away from the joint's inside, so it meets the face of the wall `e` leaves along.
fn mitre(f: V2, e: V2, n: V2, w: f64) -> f64 {
    let k = [f[0] + e[0], f[1] + e[1]];
    let kl = deep_canvas::ops::hypot(k[0], k[1]);
    if kl < 1e-9 {
        return 0.0;
    }
    let k = [k[0] / kl, k[1] / kl];
    let det = -f[0] * k[1] + k[0] * f[1];
    if det.abs() < 1e-9 {
        return 0.0;
    }
    (n[0] * w * k[1] - k[0] * n[1] * w) / det
}

fn wall(doc: &Value, id: &str, p: &Value) -> Result<Mesh, Fault> {
    let plan = plan_of(p)?;
    let t = num(p, "thickness", 0.2)?;
    let h = num(p, "height", 2.7)?;
    if t <= 0.0 {
        return Err("params/thickness".into());
    }
    if h <= 0.0 {
        return Err("params/height".into());
    }
    let (w0, w1) = match p.get("justify").and_then(Value::as_str).unwrap_or("center") {
        "center" => (-t / 2.0, t / 2.0),
        "left" => (0.0, t),
        "right" => (-t, 0.0),
        _ => return Err("params/justify".into()),
    };
    let outside = p.get("outside").and_then(Value::as_str).unwrap_or("none");
    if !["left", "right", "none"].contains(&outside) {
        return Err("params/outside".into());
    }
    let cut = num(p, "cut_height", 1.2)?;
    let b = [
        plan.a[0] + plan.d[0] * plan.len,
        plan.a[1] + plan.d[1] * plan.len,
    ];
    // Each end's neighbour, by ID order: the direction it leaves the joint along.
    let me = json!({"params": p});
    let leaves = |end: V2| -> Option<V2> {
        neighbours(doc, id, &me).into_iter().find_map(|(_, w)| {
            let (wa, wb) = (v2(w.pointer("/params/a"))?, v2(w.pointer("/params/b"))?);
            let (from, to) = if near(wa, end) {
                (wa, wb)
            } else if near(wb, end) {
                (wb, wa)
            } else {
                return None;
            };
            let l = deep_canvas::ops::hypot(to[0] - from[0], to[1] - from[1]);
            (l > EPS).then(|| [(to[0] - from[0]) / l, (to[1] - from[1]) / l])
        })
    };
    let (at_a, at_b) = (leaves(plan.a), leaves(b));
    let limit = 10.0 * t;
    let ua = |w: f64| at_a.map_or(0.0, |e| mitre(plan.d, e, plan.n, w).clamp(-limit, limit));
    let ub = |w: f64| {
        at_b.map_or(0.0, |e| {
            mitre([-plan.d[0], -plan.d[1]], e, plan.n, w).clamp(-limit, limit)
        })
    };
    // The elevation (along, height): a door down to the floor notches the outline, any other
    // opening is a hole in it.
    let mut notches = Vec::new();
    let mut holes = Vec::new();
    for (_, o) in openings(doc, id) {
        let q = o.get("params").cloned().unwrap_or(json!({}));
        let u0 = num(&q, "at_along", 0.0)?.max(0.0);
        let u1 = (u0 + num(&q, "width", 0.9)?).min(plan.len);
        let v0 = num(&q, "sill", 0.0)?.max(0.0);
        let v1 = (v0 + num(&q, "height", 2.1)?).min(h);
        if u1 - u0 < EPS || v1 - v0 < EPS {
            continue;
        }
        if v0 < EPS {
            notches.push((u0, u1, v1));
        } else {
            holes.push(vec![[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        }
    }
    notches.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut outline: Vec<V2> = vec![[0.0, 0.0]];
    for (u0, u1, v1) in &notches {
        outline.extend([[*u0, 0.0], [*u0, *v1], [*u1, *v1], [*u1, 0.0]]);
    }
    outline.extend([[plan.len, 0.0], [plan.len, h], [0.0, h]]);
    outline.dedup_by(|x, y| near(*x, *y));
    let lift = |q: V2, cap: usize| -> V3 {
        let w = if cap == 0 { w0 } else { w1 };
        let u = if q[0].abs() < EPS {
            ua(w)
        } else if (q[0] - plan.len).abs() < EPS {
            plan.len - ub(w)
        } else {
            q[0]
        };
        let x = plan.a[0] + plan.d[0] * u + plan.n[0] * w;
        let z = plan.a[1] + plan.d[1] * u + plan.n[1] * w;
        [x, q[1], z]
    };
    let mut m = prism(&outline, &holes, lift);
    // Each broad face: the first cap is the right face (w0), the second the left.
    let faces = (m.triangles() - 2 * (outline.len() + 4 * holes.len())) / 2;
    let side = |left: bool| -> Vec<u32> {
        let from = if left { faces } else { 0 } as u32;
        (from..from + faces as u32).collect()
    };
    if outside != "none" {
        m.parts.insert("outside".into(), side(outside == "left"));
        m.parts.insert("inside".into(), side(outside != "left"));
    }
    // Its plan at the cut height: the runs of wall the openings leave.
    let mut runs = vec![[0.0, plan.len]];
    for (_, o) in openings(doc, id) {
        let q = o.get("params").cloned().unwrap_or(json!({}));
        let (u0, v0) = (num(&q, "at_along", 0.0)?, num(&q, "sill", 0.0)?);
        let (u1, v1) = (u0 + num(&q, "width", 0.9)?, v0 + num(&q, "height", 2.1)?);
        if (v0..v1).contains(&cut) {
            runs = runs
                .into_iter()
                .flat_map(|[s, e]| [[s, e.min(u0)], [s.max(u1), e]])
                .filter(|[s, e]| e - s > EPS)
                .collect();
        }
    }
    m.outputs.insert("plan".into(), json!(runs));
    // Its two ends on the floor: x along the wall, y up, z its left normal.
    let (dx, nx) = ([plan.d[0], 0.0, plan.d[1]], [plan.n[0], 0.0, plan.n[1]]);
    m.anchors.insert(
        "a".into(),
        [[plan.a[0], 0.0, plan.a[1]], dx, [0.0, 1.0, 0.0], nx],
    );
    m.anchors
        .insert("b".into(), [[b[0], 0.0, b[1]], dx, [0.0, 1.0, 0.0], nx]);
    m.outputs.insert(
        "mitres".into(),
        json!({"a": [ua(w0), ua(w1)], "b": [ub(w0), ub(w1)]}),
    );
    Ok(m)
}

fn opening(doc: &Value, p: &Value) -> Result<Mesh, Fault> {
    let wall_id = p.get("wall").and_then(Value::as_str).ok_or("params/wall")?;
    let w = doc
        .get("items")
        .and_then(|i| i.get(wall_id))
        .filter(|w| kind_of(w) == "arch.wall@1")
        .ok_or("params/wall")?;
    let plan = plan_of(w.get("params").unwrap_or(&Value::Null))?;
    let door = match p.get("type").and_then(Value::as_str).unwrap_or("door") {
        "door" => true,
        "window" => false,
        _ => return Err("params/type".into()),
    };
    let u0 = num(p, "at_along", 0.0)?;
    let width = num(p, "width", 0.9)?;
    let height = num(p, "height", 2.1)?;
    let sill = num(p, "sill", 0.0)?;
    if width <= 0.0 || height <= 0.0 {
        return Err("params/width".into());
    }
    let open = num(p, "open", 0.0)?;
    if !(0.0..=1.0).contains(&open) {
        return Err("params/open".into());
    }
    let swing = match p.get("swing").and_then(Value::as_str).unwrap_or("in") {
        "in" => 1.0,
        "out" => -1.0,
        _ => return Err("params/swing".into()),
    };
    let left = match p.get("hinge").and_then(Value::as_str).unwrap_or("left") {
        "left" => true,
        "right" => false,
        _ => return Err("params/hinge".into()),
    };
    let thick = if door { 0.04 } else { 0.02 };
    let doc0 = json!({"items": {}});
    let ctx = Ctx {
        doc: &doc0,
        id: "",
        plants: Default::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    let leaf = builders::build("slab@1", &json!({"size": [width, height, thick]}), &ctx)?;
    // The leaf turns about its hinge, the side it hangs on, by `open` of a quarter turn.
    let angle = rad(90.0 * open) * swing * if left { 1.0 } else { -1.0 };
    let (c, s) = (deep_canvas::ops::cos(angle), deep_canvas::ops::sin(angle));
    let hinge = if left { u0 } else { u0 + width };
    let along = if left { 1.0 } else { -1.0 };
    let place = |q: V3| -> V3 {
        // Local x across the leaf from its hinge, y up from the sill, z through the wall.
        let x = q[0] + width / 2.0;
        let (x, z) = (x * c - q[2] * s, x * s + q[2] * c);
        let u = hinge + along * x;
        let px = plan.a[0] + plan.d[0] * u + plan.n[0] * z;
        let pz = plan.a[1] + plan.d[1] * u + plan.n[1] * z;
        [px, q[1] + sill, pz]
    };
    let mut m = leaf.mapped(place, |_, n| n);
    // Normals turned as the leaf turns.
    for k in 0..m.normals.len() {
        let n = leaf.normals[k];
        let (x, z) = (along * (n[0] * c - n[2] * s), n[0] * s + n[2] * c);
        m.normals[k] = crate::geom::unit([
            plan.d[0] * x + plan.n[0] * z,
            n[1],
            plan.d[1] * x + plan.n[1] * z,
        ]);
    }
    m.outputs
        .insert("hole".into(), json!([u0, u0 + width, sill, sill + height]));
    Ok(m)
}

/// A polygon clipped to a convex one (Sutherland–Hodgman).
fn clip(poly: &[V2], to: &[V2]) -> Vec<V2> {
    let ccw = area2(to) > 0.0;
    let mut out = poly.to_vec();
    for k in 0..to.len() {
        let (a, b) = (to[k], to[(k + 1) % to.len()]);
        let side = |p: V2| {
            let c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
            if ccw {
                c
            } else {
                -c
            }
        };
        let input = std::mem::take(&mut out);
        for i in 0..input.len() {
            let (p, q) = (input[i], input[(i + 1) % input.len()]);
            let (sp, sq) = (side(p), side(q));
            if sp >= 0.0 {
                out.push(p);
            }
            if (sp >= 0.0) != (sq >= 0.0) {
                let t = sp / (sp - sq);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
        if out.is_empty() {
            break;
        }
    }
    out
}

fn convex(poly: &[V2]) -> bool {
    let n = poly.len();
    let signs: Vec<bool> = (0..n)
        .map(|k| {
            let (a, b, c) = (poly[k], poly[(k + 1) % n], poly[(k + 2) % n]);
            (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) >= 0.0
        })
        .collect();
    signs.iter().all(|s| *s) || signs.iter().all(|s| !*s)
}

/// A slab's or zone's holes, in its own plan: polygons as written, and the well of each stair
/// (or the outline of each slab or zone) an ID names, from where that item stands.
fn plan_holes(doc: &Value, item: &Value, p: &Value, outer: &[V2]) -> Result<Vec<Vec<V2>>, Fault> {
    let me = pos(item);
    let mut out = Vec::new();
    for (k, h) in p
        .get("holes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let at = format!("params/holes/{k}");
        let hole: Vec<V2> = match h {
            Value::String(id) => {
                let other = doc.get("items").and_then(|i| i.get(id)).ok_or(at.clone())?;
                let world: Vec<V2> = match kind_of(other) {
                    "arch.stair@1" => {
                        let q = other.get("params").cloned().unwrap_or(json!({}));
                        stair(other, &q)?.1
                    }
                    "arch.slab@1" | "arch.zone@1" => {
                        let o = outline(other.get("params").unwrap_or(&Value::Null), "outline")
                            .map_err(|_| at.clone())?;
                        let q = pos(other);
                        o.iter().map(|v| [v[0] + q[0], v[1] + q[2]]).collect()
                    }
                    _ => return Err(at),
                };
                world.iter().map(|v| [v[0] - me[0], v[1] - me[2]]).collect()
            }
            other => {
                let wrapped = json!({"h": other});
                outline(&wrapped, "h").map_err(|_| at.clone())?
            }
        };
        let hole = if convex(outer) {
            clip(&hole, outer)
        } else {
            hole
        };
        if hole.len() >= 3 && area2(&hole).abs() > 1e-9 {
            out.push(hole);
        }
    }
    Ok(out)
}

fn slab(doc: &Value, item: &Value, p: &Value) -> Result<Mesh, Fault> {
    let o = outline(p, "outline")?;
    let t = num(p, "thickness", 0.2)?;
    if t <= 0.0 {
        return Err("params/thickness".into());
    }
    let holes = plan_holes(doc, item, p, &o)?;
    let mut m = prism(&o, &holes, |q, cap| {
        [q[0], if cap == 0 { 0.0 } else { t }, q[1]]
    });
    let area = area2(&o).abs() - holes.iter().map(|h| area2(h).abs()).sum::<f64>();
    m.outputs.insert("area".into(), json!(area));
    Ok(m)
}

fn zone(doc: &Value, item: &Value, p: &Value) -> Result<Mesh, Fault> {
    let o = outline(p, "outline")?;
    let holes = plan_holes(doc, item, p, &o)?;
    let elevation = match p.get("floor").and_then(Value::as_str) {
        None => 0.0,
        Some(id) => {
            let level = doc
                .get("items")
                .and_then(|i| i.get(id))
                .filter(|l| kind_of(l) == "arch.level@1")
                .ok_or("params/floor")?;
            num(
                level.get("params").unwrap_or(&Value::Null),
                "elevation",
                0.0,
            )?
        }
    };
    let mut m = Mesh::default();
    let mut outer: Vec<V3> = o.iter().map(|q| [q[0], elevation, q[1]]).collect();
    if area2(&o) > 0.0 {
        outer.reverse();
    }
    let inner: Vec<Vec<V3>> = holes
        .iter()
        .map(|h| {
            let mut v: Vec<V3> = h.iter().map(|q| [q[0], elevation, q[1]]).collect();
            if area2(h) < 0.0 {
                v.reverse();
            }
            v
        })
        .collect();
    m.polygon(&outer, &inner);
    m.part("floor", 0);
    let area = area2(&o).abs() - holes.iter().map(|h| area2(h).abs()).sum::<f64>();
    m.outputs.insert("area".into(), json!(area));
    m.outputs.insert("elevation".into(), json!(elevation));
    Ok(m)
}

fn roof(p: &Value) -> Result<Mesh, Fault> {
    let size = v2(p.get("size"))
        .filter(|s| s[0] > 0.0 && s[1] > 0.0)
        .ok_or("params/size")?;
    let pitch = num(p, "pitch", 30.0)?;
    if !(0.0..89.0).contains(&pitch) {
        return Err("params/pitch".into());
    }
    let over = num(p, "overhang", 0.0)?;
    let parapet = num(p, "parapet", 0.0)?;
    if over < 0.0 || parapet < 0.0 {
        return Err("params/overhang".into());
    }
    let (hx, hz) = (size[0] / 2.0 + over, size[1] / 2.0 + over);
    let rise = hz * tan(rad(pitch));
    let ty = p.get("type").and_then(Value::as_str).unwrap_or("gable");
    // A section across z swept along x.
    let along_x = |section: Vec<V2>| {
        prism(&section, &[], |q, cap| {
            [if cap == 0 { -hx } else { hx }, q[1], q[0]]
        })
    };
    let mut m = match ty {
        "gable" => along_x(vec![[-hz, 0.0], [hz, 0.0], [0.0, rise]]),
        "shed" => along_x(vec![[-hz, 0.0], [hz, 0.0], [-hz, 2.0 * rise]]),
        "gambrel" => along_x(vec![
            [-hz, 0.0],
            [hz, 0.0],
            [0.5 * hz, 0.7 * rise],
            [0.0, rise],
            [-0.5 * hz, 0.7 * rise],
        ]),
        "flat" => {
            let mut m = along_x(vec![[-hz, 0.0], [hz, 0.0], [hz, 0.2], [-hz, 0.2]]);
            if parapet > 0.0 {
                let ring = prism(
                    &[[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]],
                    &[vec![
                        [-hx + 0.1, -hz + 0.1],
                        [-hx + 0.1, hz - 0.1],
                        [hx - 0.1, hz - 0.1],
                        [hx - 0.1, -hz + 0.1],
                    ]],
                    |q, cap| [q[0], if cap == 0 { 0.2 } else { 0.2 + parapet }, q[1]],
                );
                let mut ring = ring;
                ring.closed
                    .insert("solid".into(), (ring.closed["solid"].0.clone(), 1));
                m.append(&ring, ".parapet");
            }
            m
        }
        "hip" | "mansard" | "dutch" => {
            let ridge = (hx - hz).max(0.0);
            let top = if ty == "mansard" { 0.6 * rise } else { rise };
            let pts: [V3; 6] = [
                [-hx, 0.0, -hz],
                [hx, 0.0, -hz],
                [hx, 0.0, hz],
                [-hx, 0.0, hz],
                [-ridge, top, 0.0],
                [ridge, top, 0.0],
            ];
            let mut m = Mesh::default();
            let faces: [&[usize]; 5] = [
                &[0, 1, 2, 3],
                &[0, 4, 5, 1],
                &[1, 5, 2],
                &[2, 5, 4, 3],
                &[3, 4, 0],
            ];
            for f in faces {
                let mut q: Vec<V3> = f.iter().map(|&i| pts[i]).collect();
                q.dedup_by(|a, b| (0..3).all(|k| (a[k] - b[k]).abs() < EPS));
                if q.len() >= 3
                    && crate::geom::length(crate::geom::cross(
                        crate::geom::sub(q[1], q[0]),
                        crate::geom::sub(q[2], q[0]),
                    )) > 1e-12
                {
                    m.polygon(&q, &[]);
                }
            }
            m.close("solid", 0, 0);
            m
        }
        "conical" => {
            let doc0 = json!({"items": {}});
            let ctx = Ctx {
                doc: &doc0,
                id: "",
                plants: Default::default(),
                outlines: &[],
                planted: None,
                pool: None,
            };
            builders::build(
                "lathe@1",
                &json!({"outline": [[hx.max(hz), 0, false], [0, rise, false]], "segments": 24}),
                &ctx,
            )?
        }
        _ => return Err("params/type".into()),
    };
    m.outputs.insert("rise".into(), json!(rise));
    Ok(m)
}

/// A stair's mesh and its well, the outline it takes out of the floor above, in world plan.
fn stair(item: &Value, p: &Value) -> Result<(Mesh, Vec<V2>), Fault> {
    let rise = num(p, "rise", 2.7)?;
    let width = num(p, "width", 0.9)?;
    if rise <= 0.0 {
        return Err("params/rise".into());
    }
    if width <= 0.0 {
        return Err("params/width".into());
    }
    let ty = p.get("type").and_then(Value::as_str).unwrap_or("straight");
    let turn = match p.get("turn").and_then(Value::as_str).unwrap_or("left") {
        "left" => 1.0,
        "right" => -1.0,
        _ => return Err("params/turn".into()),
    };
    let rails = p.get("rails").and_then(Value::as_str).unwrap_or("none");
    if !["none", "left", "right", "both"].contains(&rails) {
        return Err("params/rails".into());
    }
    let risers = (rise / RISER_MAX - 1e-9).ceil().max(1.0) as usize;
    let r = rise / risers as f64;
    let split = match p.get("split") {
        None => 0,
        Some(v) => v.as_u64().ok_or("params/split")? as usize,
    };
    // One flight of `n` risers from `y0`, starting at (x0, z0) and running along `dir` (unit,
    // in plan), `width` to its left: its stepped side section swept across its width.
    let flight = |n: usize, y0: f64, x0: f64, z0: f64, dir: V2| -> (Mesh, Vec<V2>) {
        let mut section: Vec<V2> = vec![[0.0, 0.0]];
        for k in 0..n {
            section.push([k as f64 * GOING, (k + 1) as f64 * r]);
            section.push([(k + 1) as f64 * GOING, (k + 1) as f64 * r]);
        }
        section.push([n as f64 * GOING, 0.0]);
        let left = [-dir[1] * turn, dir[0] * turn];
        let at = |s: f64, w: f64| [x0 + dir[0] * s + left[0] * w, z0 + dir[1] * s + left[1] * w];
        let m = prism(&section, &[], |q, cap| {
            let [x, z] = at(q[0], if cap == 0 { 0.0 } else { width });
            [x, y0 + q[1], z]
        });
        let run = n as f64 * GOING;
        (
            m,
            vec![at(0.0, 0.0), at(run, 0.0), at(run, width), at(0.0, width)],
        )
    };
    let mut m = Mesh::default();
    let mut feet: Vec<Vec<V2>> = Vec::new();
    let first = if split == 0 {
        risers / 2
    } else {
        split.min(risers)
    };
    match ty {
        "straight" => {
            let (f, foot) = flight(risers, 0.0, 0.0, 0.0, [1.0, 0.0]);
            m.append(&f, ".0");
            feet.push(foot);
        }
        "l" | "u" => {
            let (f, foot) = flight(first, 0.0, 0.0, 0.0, [1.0, 0.0]);
            m.append(&f, ".0");
            feet.push(foot);
            let run = first as f64 * GOING;
            let (x0, z0, dir) = if ty == "l" {
                (run + width, width * turn, [0.0, turn])
            } else {
                (run, 2.0 * width * turn, [-1.0, 0.0])
            };
            let (f, foot) = flight(risers - first, first as f64 * r, x0, z0, dir);
            m.append(&f, ".1");
            feet.push(foot);
        }
        "spiral" => {
            for k in 0..risers {
                let a = rad(30.0 * k as f64) * turn;
                let dir = [deep_canvas::ops::cos(a), deep_canvas::ops::sin(a)];
                let (f, foot) = flight(1, k as f64 * r, 0.0, 0.0, dir);
                m.append(&f, &format!(".{k}"));
                feet.push(foot);
            }
        }
        _ => return Err("params/type".into()),
    }
    for (side, w) in [("left", width - 0.05), ("right", 0.0)] {
        if rails == side || rails == "both" {
            for foot in feet.clone() {
                let (a, b) = (foot[0], foot[1]);
                let len = deep_canvas::ops::hypot(b[0] - a[0], b[1] - a[1]);
                let d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
                let lf = [-d[1] * turn, d[0] * turn];
                let base = [a[0] + lf[0] * w, a[1] + lf[1] * w];
                let rail = prism(
                    &[[0.0, 0.0], [len, 0.0], [len, 0.05], [0.0, 0.05]],
                    &[],
                    |q, cap| {
                        let s = if cap == 0 { 0.0 } else { 0.05 };
                        [
                            base[0] + d[0] * q[0] + lf[0] * s,
                            0.9 + q[1],
                            base[1] + d[1] * q[0] + lf[1] * s,
                        ]
                    },
                );
                m.append(&rail, &format!(".rail.{side}"));
            }
        }
    }
    let at = pos(item);
    // The well: the stair's whole footprint, from where it stands.
    let xs = feet.iter().flatten().map(|v| v[0]);
    let zs = feet.iter().flatten().map(|v| v[1]);
    let (x0, x1) = (
        xs.clone().fold(f64::INFINITY, f64::min),
        xs.fold(f64::NEG_INFINITY, f64::max),
    );
    let (z0, z1) = (
        zs.clone().fold(f64::INFINITY, f64::min),
        zs.fold(f64::NEG_INFINITY, f64::max),
    );
    let well = vec![
        [x0 + at[0], z0 + at[2]],
        [x1 + at[0], z0 + at[2]],
        [x1 + at[0], z1 + at[2]],
        [x0 + at[0], z1 + at[2]],
    ];
    m.outputs.insert("risers".into(), json!(risers));
    m.outputs.insert("riser".into(), json!(r));
    m.outputs.insert("going".into(), json!(GOING));
    m.outputs.insert("well".into(), json!(well));
    Ok((m, well))
}

fn guard_rail(doc: &Value, item: &Value, p: &Value) -> Result<Mesh, Fault> {
    let id = p
        .get("around")
        .and_then(Value::as_str)
        .ok_or("params/around")?;
    let around = doc
        .get("items")
        .and_then(|i| i.get(id))
        .ok_or("params/around")?;
    let ap = around.get("params").cloned().unwrap_or(json!({}));
    let o = outline(&ap, "outline").map_err(|_| "params/around".to_string())?;
    let except: Vec<u64> = match p.get("except") {
        None => Vec::new(),
        Some(v) => v
            .as_array()
            .ok_or("params/except")?
            .iter()
            .map(|e| e.as_u64().ok_or("params/except".to_string()))
            .collect::<Result<_, _>>()?,
    };
    let skip = p
        .get("skip_along_walls")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (ao, me) = (pos(around), pos(item));
    let top = ao[1] + ap.get("thickness").and_then(Value::as_f64).unwrap_or(0.2) - me[1];
    let walls: Vec<(V2, V2)> = items(doc)
        .filter(|(_, w)| kind_of(w) == "arch.wall@1")
        .filter_map(|(_, w)| Some((v2(w.pointer("/params/a"))?, v2(w.pointer("/params/b"))?)))
        .collect();
    let mut m = Mesh::default();
    for k in 0..o.len() {
        if except.contains(&(k as u64)) {
            continue;
        }
        let (a, b) = (o[k], o[(k + 1) % o.len()]);
        let (a, b) = (
            [a[0] + ao[0] - me[0], a[1] + ao[2] - me[2]],
            [b[0] + ao[0] - me[0], b[1] + ao[2] - me[2]],
        );
        let on = |p: V2, (s, e): (V2, V2)| {
            let c = (e[0] - s[0]) * (p[1] - s[1]) - (e[1] - s[1]) * (p[0] - s[0]);
            let t = ((p[0] - s[0]) * (e[0] - s[0]) + (p[1] - s[1]) * (e[1] - s[1]))
                / ((e[0] - s[0]) * (e[0] - s[0]) + (e[1] - s[1]) * (e[1] - s[1]));
            c.abs() < 1e-6 && (-1e-6..=1.0 + 1e-6).contains(&t)
        };
        if skip && walls.iter().any(|w| on(a, *w) && on(b, *w)) {
            continue;
        }
        let len = deep_canvas::ops::hypot(b[0] - a[0], b[1] - a[1]);
        if len < EPS {
            continue;
        }
        let d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let n = [-d[1], d[0]];
        let rail = prism(
            &[[0.0, 0.0], [len, 0.0], [len, 1.0], [0.0, 1.0]],
            &[],
            |q, cap| {
                let s = if cap == 0 { 0.0 } else { 0.05 };
                [
                    a[0] + d[0] * q[0] + n[0] * s,
                    top + q[1],
                    a[1] + d[1] * q[0] + n[1] * s,
                ]
            },
        );
        m.append(&rail, &format!(".{k}"));
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn door_leaf_fills_its_hole_from_the_sill() {
        let doc = house();
        for (sill, height) in [(0.0, 2.1), (0.9, 1.2)] {
            let item = json!({"kind": "arch.opening@1",
                "params": {"wall": "wa", "type": "door", "at_along": 1, "width": 0.9, "height": height, "sill": sill}});
            let b = build(&doc, "door", &item).unwrap().bounds();
            assert!(
                (b[0][1] - sill).abs() < 1e-9 && (b[1][1] - (sill + height)).abs() < 1e-9,
                "leaf y runs {}..{}, the hole {}..{}",
                b[0][1],
                b[1][1],
                sill,
                sill + height
            );
        }
    }
}
