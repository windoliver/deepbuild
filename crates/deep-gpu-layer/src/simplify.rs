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
    let path = call["asset"]
        .as_str()
        .ok_or_else(|| bad("asset is a path"))?;
    let bytes = std::fs::read(path).map_err(|e| bad(&format!("asset: {e}")))?;
    let node = call.get("node").cloned().unwrap_or(json!(0));
    let mut doc: Value = serde_json::from_slice(&bytes).map_err(|_| bad("asset is a JSON glTF"))?;
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
    let positions: Vec<f32> = mesh
        .positions
        .iter()
        .flat_map(|p| p.map(|v| v as f32))
        .collect();
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
