//! The `simplify` call (issue #425; canvas primitives: Level of detail: levels by error, Asset job:
//! `simplify`; tests/acceptance/425/README.md, Assumed surfaces 4): a JSON glTF node's mesh given
//! index-only levels over its one vertex buffer by meshoptimizer, each level's error the probe's,
//! a fraction of the mesh's extent. `auto` halves the triangles per level, needs each level's
//! error to grow by at least `growth`, and stops when a level saves less than `min_gain` or passes
//! `max_error`; listed levels keep their own targets. No level's error is lower than the one before.
//! The output is the input with the levels on its primitive (`extras.lod`), as `mesh.asset@1`
//! reads them, written under `out` named by its SHA-256. #427: the reply's `measured_m` is each
//! level's error as the probe measures it, the two-sided distance in m between the level's
//! surface and the input's (`deep_canvas_scene3d::deviation`), 0 for the input.
//!
//! #1636: `doc` and `item` in place of `asset` and `node` take a session document's item, its
//! evaluated mesh at t = 0 in item space, written as a JSON glTF of its own with the levels on it.
//! With `proxy` in place of `levels`, the job makes one proxy (Level of detail: proxies) instead.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_scene3d::geom::{Mesh, V3};
use meshopt::{SimplifyOptions, VertexDataAdapter};
use serde_json::{json, Value};

use crate::frames::hex;
use crate::refused;

struct Auto {
    growth: f64,
    min_gain: f64,
    max_error: f64,
}

/// One simplification of `indices` toward `target` triangles: its indices and its error.
fn simplify(
    indices: &[u32],
    adapter: &VertexDataAdapter<'_>,
    target: usize,
    max: f64,
) -> (Vec<u32>, f64) {
    let mut error = 0.0f32;
    let out = meshopt::simplify(
        indices,
        adapter,
        target * 3,
        max as f32,
        SimplifyOptions::None,
        Some(&mut error),
    );
    (out, f64::from(error))
}

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for k in 0..4 {
            if k <= c.len() {
                s.push(A[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

pub fn call(out: &str, call: &Value) -> Value {
    match run(out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(out: &str, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let (mut doc, mesh_i, mesh) = match call.get("doc") {
        Some(_) => {
            let mesh = item_mesh(call)?;
            (gltf_of(&mesh.positions, &mesh.indices), 0, mesh)
        }
        None => asset(call)?,
    };
    if let Some(p) = call.get("proxy") {
        return proxy(out, p, &mesh);
    }
    let auto = Auto {
        growth: call
            .pointer("/auto/growth")
            .and_then(Value::as_f64)
            .unwrap_or(1.5),
        min_gain: call
            .pointer("/auto/min_gain")
            .and_then(Value::as_f64)
            .unwrap_or(0.25),
        max_error: call
            .pointer("/auto/max_error")
            .and_then(Value::as_f64)
            .unwrap_or(1.0),
    };
    let positions = flat(&mesh.positions);
    let adapter = VertexDataAdapter::new(bytemuck::cast_slice(&positions), 12, 0)
        .map_err(|e| bad(&format!("asset: {e}")))?;
    let extent = f64::from(meshopt::simplify_scale(&adapter));
    let input = mesh.indices.clone();
    let tris = input.len() / 3;
    let mut levels: Vec<(Vec<u32>, f64)> = vec![(input.clone(), 0.0)];
    match call.get("levels") {
        None | Some(Value::Null) => auto_levels(&input, &adapter, &auto, &mut levels),
        Some(Value::String(s)) if s == "auto" => auto_levels(&input, &adapter, &auto, &mut levels),
        Some(Value::Array(list)) => {
            for (i, l) in list.iter().enumerate() {
                let ratio = l["ratio"].as_f64().filter(|r| (0.0..=1.0).contains(r));
                let max = l["max_triangles"].as_u64().map(|m| m as usize);
                let target = match (ratio, max) {
                    (None, None) => {
                        return Err(bad(&format!("levels/{i} is {{ratio, max_triangles}}")))
                    }
                    (r, m) => {
                        ((r.unwrap_or(1.0) * tris as f64) as usize).min(m.unwrap_or(usize::MAX))
                    }
                };
                let (idx, error) = simplify(&input, &adapter, target.max(1), 1.0);
                let last = levels.last().expect("level 0");
                // A level no coarser, or with a lower error than the one before, is never emitted.
                if idx.len() < last.0.len() && error >= last.1 {
                    levels.push((idx, error));
                }
            }
        }
        Some(_) => return Err(bad("levels is auto or a list of {ratio, max_triangles}")),
    }
    // #427: the probe's measured error per level, in m: the two-sided distance between the
    // level's surface and the input's, over the input's positions as the glTF holds them.
    let measured: Vec<f64> = levels
        .iter()
        .enumerate()
        .map(|(k, (idx, _))| match k {
            0 => 0.0,
            _ => {
                deep_canvas_scene3d::deviation::measure(
                    &mesh.positions,
                    idx,
                    &mesh.positions,
                    &input,
                    false,
                )
                .largest_m
            }
        })
        .collect();
    // The levels after the input, on the primitive, in one buffer of their own.
    let mut buffer = Vec::new();
    let mut entries = Vec::new();
    let base_view = doc["bufferViews"].as_array().map_or(0, Vec::len);
    let base_acc = doc["accessors"].as_array().map_or(0, Vec::len);
    let buf_i = doc["buffers"].as_array().map_or(0, Vec::len);
    for (k, (idx, error)) in levels.iter().enumerate().skip(1) {
        let offset = buffer.len();
        buffer.extend(idx.iter().flat_map(|i| i.to_le_bytes()));
        let view = json!({"buffer": buf_i, "byteOffset": offset, "byteLength": idx.len() * 4});
        let acc = json!({"bufferView": base_view + k - 1, "componentType": 5125, "count": idx.len(), "type": "SCALAR"});
        push(&mut doc, "bufferViews", view);
        push(&mut doc, "accessors", acc);
        entries.push(json!({"indices": base_acc + k - 1, "error": error}));
    }
    if !buffer.is_empty() {
        let uri = format!("data:application/octet-stream;base64,{}", base64(&buffer));
        push(
            &mut doc,
            "buffers",
            json!({"byteLength": buffer.len(), "uri": uri}),
        );
    }
    doc["meshes"][mesh_i]["primitives"][0]["extras"]["lod"] =
        json!({"extent": extent, "levels": entries});
    let written = serde_json::to_vec(&doc).map_err(|e| refused("not_written", e.to_string()))?;
    let sha = hex(&written);
    std::fs::write(
        std::path::Path::new(out).join(format!("{sha}.gltf")),
        &written,
    )
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(json!({
        "sha256": sha,
        "levels": levels.iter().map(|(i, _)| json!({"triangles": i.len() / 3})).collect::<Vec<_>>(),
        "lod_errors": levels.iter().map(|(_, e)| e).collect::<Vec<_>>(),
        "measured_m": measured,
    }))
}

fn push(doc: &mut Value, key: &str, v: Value) {
    match doc[key].as_array_mut() {
        Some(a) => a.push(v),
        None => doc[key] = json!([v]),
    }
}

/// The JSON glTF at `asset`, the index of node `node`'s mesh, and that mesh: one triangle
/// primitive.
fn asset(call: &Value) -> Result<(Value, usize, Mesh), Value> {
    let bad = |what: &str| refused("bad_input", what);
    let path = call["asset"]
        .as_str()
        .ok_or_else(|| bad("asset is a path"))?;
    let bytes = std::fs::read(path).map_err(|e| bad(&format!("asset: {e}")))?;
    let node = call.get("node").cloned().unwrap_or(json!(0));
    let doc: Value = serde_json::from_slice(&bytes).map_err(|_| bad("asset is a JSON glTF"))?;
    let mesh =
        deep_canvas_scene3d::gltf::mesh(&bytes, &node).map_err(|p| refused("out_of_range", p))?;
    let mesh_i = match &node {
        Value::Number(n) => n.as_u64().map(|n| n as usize),
        Value::String(name) => doc["nodes"]
            .as_array()
            .and_then(|ns| ns.iter().position(|n| n["name"].as_str() == Some(name))),
        _ => None,
    }
    .and_then(|n| doc["nodes"][n]["mesh"].as_u64())
    .ok_or_else(|| bad("node names a node with a mesh"))? as usize;
    let prims = doc["meshes"][mesh_i]["primitives"]
        .as_array()
        .map_or(0, Vec::len);
    if prims != 1 {
        return Err(bad("the node's mesh is one triangle primitive"));
    }
    Ok((doc, mesh_i, mesh))
}

/// #1636: item `item` of the session document at `doc`: its evaluated mesh at t = 0 in item
/// space, its builder's mesh through its stack with the formulas' vars bound at 0, as `geometry`
/// reports it at stage final.
fn item_mesh(call: &Value) -> Result<Mesh, Value> {
    use deep_canvas_scene3d::{builders, building, scene};
    let bad = |what: &str| refused("bad_input", what);
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    let id = call["item"].as_str().ok_or_else(|| bad("item is an ID"))?;
    let doc = deep_canvas_scene3d::vars::at(&doc, 0, None)
        .map_err(|r| refused(r.code, r.path))?
        .unwrap_or(doc);
    let item = doc["items"]
        .get(id)
        .ok_or_else(|| refused("ref_unresolved", format!("items/{id}")))?;
    let kind = item["kind"].as_str().unwrap_or("");
    if !builders::KINDS.contains(&kind) && !building::KINDS.contains(&kind) {
        return Err(bad("item names an item a builder makes a mesh for"));
    }
    let mesh = scene::mesh_of(&doc, id, item, 0.0, scene::Outlines::default())
        .map_err(|r| refused(r.code, r.path))?;
    if mesh.indices.is_empty() {
        return Err(bad("item names an item with triangles"));
    }
    Ok(mesh)
}

/// #1636: one proxy of `mesh` (Level of detail: proxies): without the triangles of the parts
/// `drop` names, nor those of a card hanging on a branch of one of them (a tree's leaves, which
/// would float), and the rest simplified to `ratio` of its triangles within `error`, a fraction of
/// the bounds. Both default to 1, so with no `ratio` the kept triangles stay as built. Written
/// under `out` as a JSON glTF of the vertices it uses, named by its SHA-256.
fn proxy(out: &str, p: &Value, mesh: &Mesh) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let share = |key: &str| match p.get(key) {
        None => Ok(1.0),
        Some(v) => v
            .as_f64()
            .filter(|r| *r > 0.0 && *r <= 1.0)
            .ok_or_else(|| bad(&format!("proxy/{key} is in (0, 1]"))),
    };
    let (ratio, error) = (share("ratio")?, share("error")?);
    let drop = p["drop"]
        .as_array()
        .ok_or_else(|| bad("proxy is {drop: [part], ratio?, error?}"))?;
    let mut gone = vec![false; mesh.indices.len() / 3];
    let mut dropped = BTreeSet::new();
    for (k, name) in drop.iter().enumerate() {
        let (name, tris) = name
            .as_str()
            .and_then(|n| mesh.parts.get_key_value(n))
            .ok_or_else(|| refused("ref_unresolved", format!("proxy/drop/{k}")))?;
        dropped.insert(name.as_str());
        for t in tris {
            gone[*t as usize] = true;
        }
    }
    // A card's triangles go with the part of the branch it hangs on.
    let outputs = |key: &str| {
        mesh.outputs
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
    };
    let part_of: BTreeMap<&str, &str> = outputs("branches")
        .filter_map(|b| Some((b["id"].as_str()?, b["part"].as_str()?)))
        .collect();
    let floating: BTreeSet<u64> = outputs("cards")
        .filter(|c| {
            c["twig"]
                .as_str()
                .and_then(|t| part_of.get(t))
                .is_some_and(|part| dropped.contains(part))
        })
        .flat_map(|c| c["vertices"].as_array().into_iter().flatten())
        .filter_map(Value::as_u64)
        .collect();
    for (t, tri) in mesh.indices.chunks(3).enumerate() {
        if tri.iter().any(|v| floating.contains(&u64::from(*v))) {
            gone[t] = true;
        }
    }
    let parts: Vec<&String> = mesh
        .parts
        .iter()
        .filter(|(_, tris)| tris.iter().any(|t| !gone[*t as usize]))
        .map(|(name, _)| name)
        .collect();
    let mut kept: Vec<u32> = mesh
        .indices
        .chunks(3)
        .zip(&gone)
        .filter(|(_, g)| !**g)
        .flat_map(|(tri, _)| tri.iter().copied())
        .collect();
    if ratio < 1.0 {
        let positions = flat(&mesh.positions);
        let adapter = VertexDataAdapter::new(bytemuck::cast_slice(&positions), 12, 0)
            .map_err(|e| bad(&format!("item: {e}")))?;
        let target = (ratio * (kept.len() / 3) as f64) as usize;
        kept = simplify(&kept, &adapter, target.max(1), error).0;
    }
    if kept.is_empty() {
        return Err(bad("the proxy keeps a triangle"));
    }
    // Its own vertices, in the order its triangles first use them.
    let mut new_of = vec![u32::MAX; mesh.positions.len()];
    let mut used = Vec::new();
    let indices: Vec<u32> = kept
        .iter()
        .map(|&v| {
            let v = v as usize;
            if new_of[v] == u32::MAX {
                new_of[v] = used.len() as u32;
                used.push(v);
            }
            new_of[v]
        })
        .collect();
    let positions: Vec<V3> = used.iter().map(|&v| mesh.positions[v]).collect();
    let written = serde_json::to_vec(&gltf_of(&positions, &indices))
        .map_err(|e| refused("not_written", e.to_string()))?;
    let sha = hex(&written);
    std::fs::write(
        std::path::Path::new(out).join(format!("{sha}.gltf")),
        &written,
    )
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(json!({"sha256": sha, "triangles": indices.len() / 3, "parts": parts}))
}

/// A JSON glTF of one mesh of one triangle primitive: f32 positions in m and u32 indices, its
/// one buffer inline.
fn gltf_of(positions: &[V3], indices: &[u32]) -> Value {
    let mut bytes: Vec<u8> = flat(positions)
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let at_indices = bytes.len();
    bytes.extend(indices.iter().flat_map(|i| i.to_le_bytes()));
    let bound = |pick: fn(f32, f32) -> f32, from: f32| {
        positions
            .iter()
            .fold([from; 3], |b, p| [0, 1, 2].map(|c| pick(b[c], p[c] as f32)))
    };
    json!({
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": positions.len(), "type": "VEC3",
             "min": bound(f32::min, f32::INFINITY), "max": bound(f32::max, f32::NEG_INFINITY)},
            {"bufferView": 1, "componentType": 5125, "count": indices.len(), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": at_indices},
            {"buffer": 0, "byteOffset": at_indices, "byteLength": bytes.len() - at_indices},
        ],
        "buffers": [{"byteLength": bytes.len(),
                     "uri": format!("data:application/octet-stream;base64,{}", base64(&bytes))}],
    })
}

/// Positions as the simplifier reads them: f32, three to a vertex.
fn flat(positions: &[V3]) -> Vec<f32> {
    positions.iter().flat_map(|p| p.map(|v| v as f32)).collect()
}

/// `auto`: halve the triangles a level at a time; a level whose error hasn't grown by `growth`
/// over the last is halved again, and the run stops at a level that saves less than `min_gain`
/// of the last's triangles or passes `max_error`.
fn auto_levels(
    input: &[u32],
    adapter: &VertexDataAdapter<'_>,
    auto: &Auto,
    levels: &mut Vec<(Vec<u32>, f64)>,
) {
    loop {
        let (last_len, last_error) = {
            let l = levels.last().expect("level 0");
            (l.0.len() / 3, l.1)
        };
        let mut target = last_len / 2;
        let next = loop {
            if target < 2 {
                break None;
            }
            let (idx, error) = simplify(input, adapter, target, auto.max_error);
            if error >= last_error * auto.growth && error > 0.0 {
                break Some((idx, error));
            }
            target /= 2;
        };
        let Some((idx, error)) = next else { return };
        let tris = idx.len() / 3;
        let gain = 1.0 - tris as f64 / last_len as f64;
        if gain < auto.min_gain || error > auto.max_error || tris == 0 {
            return;
        }
        levels.push((idx, error));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_proxy_drops_the_cards_of_dropped_twigs_and_refuses_what_it_cannot_resolve() {
        let dir = std::env::temp_dir().join(format!("deep-gpu-simplify-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let params = json!({"seed": 1636, "levels": 4, "length": 4, "radius": 0.15, "split": 3,
                            "angle": 40, "roll": 30, "gravity": 0.3,
                            "leaves": {"per_twig": 6, "size": 0.12}, "segments": 8, "rings": 8});
        let path = dir.join("doc.json");
        let items = json!({"items": {"tree": {"kind": "tree@1", "params": params},
                                     "cam": {"kind": "camera@1"}}});
        std::fs::write(&path, items.to_string()).unwrap();
        let (out, doc) = (dir.to_str().unwrap(), path.to_str().unwrap());
        let ask = |item: &str, drop: Value| {
            call(
                out,
                &json!({"call": "simplify", "doc": doc, "item": item, "proxy": {"drop": drop}}),
            )
        };
        let full = item_mesh(&json!({"doc": doc, "item": "tree"})).unwrap();
        let r = ask("tree", json!(["twigs"]));
        // The leaves hang on the twigs: they go with them, and only the two tube parts stay whole.
        assert_eq!(r["parts"], json!(["branches", "trunk"]), "{r}");
        let kept = full.parts["trunk"].len() + full.parts["branches"].len();
        assert_eq!(r["triangles"], json!(kept), "{r}");
        assert_eq!(ask("tree", json!(["roots"]))["code"], "ref_unresolved");
        assert_eq!(ask("oak", json!([]))["code"], "ref_unresolved");
        assert_eq!(ask("cam", json!([]))["code"], "bad_input");
        std::fs::remove_dir_all(&dir).ok();
    }
}
