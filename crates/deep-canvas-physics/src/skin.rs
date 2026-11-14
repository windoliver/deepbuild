//! #524: what a world's skins write into its scene (Physics output: a skin). A skin draws a soft
//! body on an item built on its own lattice: a plate whose grid has a cloth's nu × nv vertices, a
//! tube whose path takes a rope's particles in index order, a geodesic ball whose detail is a
//! balloon's subdivisions, or for a volume the item it was built from. With `item: auto` the core
//! builds that item itself (a two-sided plate, a tube as thick as the particle radius and at
//! least 1 cm, or a ball; for a volume its source). The bake keeps each skin's particle positions
//! after every step in the form's `arrays` as `<world>.<output>.positions`, every particle each
//! step it moved, with the item it draws; a frame at t writes them, lerped between the two steps
//! around t by Physics output's rule as f32, into the item: a tube's path, any other item's
//! `skin: {positions}`, whose vertices scene3d moves and whose normals it makes again. The item's
//! own transform is left out, since the positions are world metres. Any other pairing is refused
//! at check, naming both items.

use serde_json::{json, Map, Value};

use crate::doc::{Output, Refusal, Soft, SoftShape, World};
use crate::occurrence::step_flicks;

/// The code of a skin whose item isn't built on its soft body's lattice.
pub const LATTICE: &str = "physics.skin_lattice";

/// The ID of the item the core builds for an output's `item: auto`.
pub fn auto_id(world: &str, output: &str) -> String {
    format!("{world}.{output}")
}

/// Each skin output of `w` with its soft body.
fn skins(w: &World) -> impl Iterator<Item = (&String, &Output, &Soft)> {
    w.outputs
        .iter()
        .filter(|(_, o)| o.skin.is_some())
        .filter_map(|(id, o)| Some((id, o, w.soft.get(o.from.as_str())?)))
}

fn count(item: &Value, at: &str) -> Option<u64> {
    item.pointer(at).and_then(Value::as_u64)
}

/// What `soft`'s lattice is, in words, and whether `item` (`item_id`) is built on it.
fn lattice(soft: &Soft, item_id: &str, item: &Value) -> (String, String, bool) {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
    let p = |k: &str| item.pointer(&format!("/params/{k}"));
    let plain = item
        .get("modifiers")
        .and_then(Value::as_array)
        .is_none_or(|m| m.iter().all(|x| x.get("enabled") == Some(&json!(false))));
    let smooth = p("shade").is_none_or(|s| s == "smooth");
    match &soft.shape {
        SoftShape::Cloth { nu, nv } => {
            let grid = (count(item, "/params/grid/0"), count(item, "/params/grid/1"));
            let ok = kind == "plate@1"
                && grid == (Some(*nu as u64 - 1), Some(*nv as u64 - 1))
                && p("outline").is_none()
                && p("terrain").is_none()
                && smooth
                && plain;
            let has = match grid {
                (Some(x), Some(y)) if kind == "plate@1" => {
                    format!("plate {item_id} has {} × {} vertices", x + 1, y + 1)
                }
                _ => format!("{item_id} is a {kind}, not a plate on a grid"),
            };
            (format!("{nu} × {nv} particles"), has, ok)
        }
        SoftShape::Rope => {
            let n = p("path").and_then(Value::as_array).map(Vec::len);
            let bend = p("bend").and_then(Value::as_f64).unwrap_or(0.0);
            let ok = kind == "tube@1" && n == Some(soft.positions.len()) && bend == 0.0 && plain;
            let has = match n {
                Some(n) if kind == "tube@1" => format!("tube {item_id}'s path has {n} points"),
                _ => format!("{item_id} is a {kind}, not a tube on a path of points"),
            };
            (format!("{} particles", soft.positions.len()), has, ok)
        }
        SoftShape::Balloon { subdivisions } => {
            let detail = count(item, "/params/detail").unwrap_or(0);
            let geodesic = p("tessellation").and_then(Value::as_str) == Some("geodesic");
            let base = p("base").is_none_or(|b| b == "icosa");
            let ok =
                kind == "ball@1" && geodesic && base && detail == u64::from(*subdivisions) && plain;
            let has = if kind == "ball@1" && geodesic {
                format!("ball {item_id} has detail {detail}")
            } else {
                format!("{item_id} is a {kind}, not a geodesic ball")
            };
            (format!("subdivisions {subdivisions}"), has, ok)
        }
        SoftShape::Volume { from } => (
            format!("its source {from}"),
            format!("{item_id} is another item"),
            item_id == from,
        ),
    }
}

/// Each skin of `w` whose item `scene` holds isn't built on its soft body's lattice, or that
/// names no item of the scene, refused naming both.
pub fn check(w: &World, scene: &Value) -> Vec<Refusal> {
    let mut out = Vec::new();
    for (oid, o, soft) in skins(w) {
        let Some(item_id) = o.skin.as_ref().and_then(|s| s.item.clone()) else {
            continue;
        };
        let path = format!("outputs/{oid}/to/skin/item");
        let Some(item) = scene.get("items").and_then(|i| i.get(&item_id)) else {
            out.push(Refusal {
                code: "ref_unresolved",
                path,
                actual: json!(item_id),
                what: format!("{item_id} is not an item of the world's scene, which skin {oid} draws soft body {} on", o.from),
            });
            continue;
        };
        let (wants, has, ok) = lattice(soft, &item_id, item);
        if !ok {
            out.push(Refusal {
                code: LATTICE,
                path,
                actual: json!(item_id),
                what: format!("soft body {} has {wants} and {has}: a skin draws a soft body only on an item built on its own lattice", o.from),
            });
        }
    }
    out
}

/// The item the core builds for a skin with `item: auto` (`None` for a volume, which draws on
/// its source), its first positions `first`.
fn auto(soft: &Soft, first: &[[f64; 3]], material: Option<&String>) -> Option<Value> {
    let length = |d: [f64; 3]| deep_canvas::ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    let mut item = match &soft.shape {
        SoftShape::Cloth { nu, nv } => {
            let (a, b) = (soft.positions[0], soft.positions[1]);
            let c = soft.positions[*nu];
            let du = length([0, 1, 2].map(|k| b[k] - a[k]));
            let dv = length([0, 1, 2].map(|k| c[k] - a[k]));
            json!({"kind": "plate@1", "params": {"grid": [nu - 1, nv - 1],
                "size": [du * (*nu - 1) as f64, dv * (*nv - 1) as f64], "two_sided": true}})
        }
        SoftShape::Rope => json!({"kind": "tube@1", "params": {"path": first,
            "radius": soft.particle_radius.max(0.01)}}),
        SoftShape::Balloon { subdivisions } => json!({"kind": "ball@1", "params": {
            "tessellation": "geodesic", "detail": subdivisions}}),
        SoftShape::Volume { .. } => return None,
    };
    if let Some(m) = material {
        item["material"] = json!(m);
    }
    Some(item)
}

/// The arrays world `id`'s skins write, `<world>.<output>.positions`, from its bake's
/// `particles` (each soft body's positions after each step from step 0, `{addresses, positions}`).
pub fn arrays(id: &str, w: &World, particles: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    for (oid, o, soft) in skins(w) {
        let Some(steps) = particles
            .pointer(&format!("/{}/positions", o.from))
            .and_then(Value::as_array)
        else {
            continue;
        };
        let skin = o.skin.as_ref().expect("a skin output");
        let first: Vec<[f64; 3]> = steps
            .first()
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| {
                        Some([
                            p.get(0)?.as_f64()?,
                            p.get(1)?.as_f64()?,
                            p.get(2)?.as_f64()?,
                        ])
                    })
                    .collect()
            })
            .unwrap_or_default();
        let item = match (&skin.item, &soft.shape) {
            (Some(i), _) => i.clone(),
            (None, SoftShape::Volume { from }) => from.clone(),
            (None, _) => auto_id(id, oid),
        };
        let built = if skin.item.is_none() {
            auto(soft, &first, skin.material.as_ref())
        } else {
            None
        };
        let path = matches!(soft.shape, SoftShape::Rope);
        let (mut prev, mut kept) = (&Value::Null, Vec::new());
        for (k, s) in steps.iter().enumerate() {
            if s != prev {
                kept.push(json!({"step": k, "changed": [[0, first.len()]], "values": [[0, s]]}));
            }
            prev = s;
        }
        out.insert(
            format!("{id}.{oid}.positions"),
            json!({"type": "vec3", "count": first.len(), "every": step_flicks(w), "linear": false,
                   "hold": o.hold, "steps": kept,
                   "skin": {"item": item, "as": if path { "path" } else { "vertices" }, "auto": built}}),
        );
    }
    out
}

/// Whether `form` holds a skin's array.
pub fn writes(form: &Value) -> bool {
    form.get("arrays")
        .and_then(Value::as_object)
        .is_some_and(|a| a.values().any(|x| x.get("skin").is_some()))
}

/// The rows of `array` after step `k`: the last kept step at or before it.
fn rows(array: &Value, k: i64) -> Option<&Vec<Value>> {
    let steps = array["steps"].as_array()?;
    let i = steps.partition_point(|s| s["step"].as_i64().is_some_and(|x| x <= k));
    steps
        .get(i.checked_sub(1)?)?
        .pointer("/values/0/1")?
        .as_array()
}

/// `array`'s positions as a frame at `t` (flicks) shows them: step k's where t is on it or the
/// array holds, else lerped toward step k + 1's, each an f32.
fn at(array: &Value, t: i64) -> Option<Vec<Value>> {
    let every = array["every"].as_i64().unwrap_or(1).max(1);
    let (k, rem) = (t.div_euclid(every), t.rem_euclid(every));
    let a = rows(array, k)?;
    let b = rows(array, k + 1).filter(|_| rem != 0 && array["hold"] != json!(true));
    let alpha = rem as f64 / every as f64;
    let f = |v: &Value, i: usize| v.get(i).and_then(Value::as_f64).unwrap_or(f64::NAN);
    Some(
        a.iter()
            .enumerate()
            .map(|(r, p)| {
                let q = b.and_then(|b| b.get(r));
                json!([0, 1, 2].map(|i| {
                    let x = f(p, i);
                    let y = q.map_or(x, |q| f(q, i));
                    f64::from((x + alpha * (y - x)) as f32)
                }))
            })
            .collect(),
    )
}

/// `form` with each skin's item drawn at `t`, from the form's `arrays` (baked by [`arrays`]): an
/// `auto` item built where none is, its transform left out, and its positions written.
pub fn write(form: &mut Value, t: i64) {
    let mut writes = Vec::new();
    for a in form
        .get("arrays")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(_, a)| a)
    {
        let Some(skin) = a.get("skin") else { continue };
        if let (Some(item), Some(positions)) = (skin["item"].as_str(), at(a, t)) {
            writes.push((
                item.to_string(),
                skin["as"] == "path",
                skin["auto"].clone(),
                positions,
            ));
        }
    }
    for (id, path, auto, positions) in writes {
        let Some(items) = form.get_mut("items").and_then(Value::as_object_mut) else {
            return;
        };
        if !auto.is_null() {
            items.entry(id.clone()).or_insert(auto);
        }
        let Some(item) = items.get_mut(&id).and_then(Value::as_object_mut) else {
            continue;
        };
        item.remove("at");
        item.remove("parent");
        if path {
            if let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) {
                params.insert("path".into(), Value::Array(positions));
            }
        } else {
            item.insert("skin".into(), json!({ "positions": positions }));
        }
    }
}
