//! #524: the meshes a world's closed soft bodies are built on, resolved where the world meets its
//! scene. A balloon's is the geodesic ball its subdivisions name (`ball@1`, detail =
//! subdivisions), at its center; a volume's is its source item's mesh as the scene evaluates it at
//! t = 0, in world metres. Each is welded as scene3d welds a mesh (positions equal to 1e-6 m are
//! one particle, numbered in order of first appearance), so a particle `v{i}` is the item's
//! welded vertex `i`, and written into the soft body as `mesh: {vertices, triangles}` for the
//! physics module to read, which refuses one that isn't closed. A source the scene can't build
//! is refused here, naming it. #2457: a `mesh.asset@1` source's mesh is its glTF node's, as the
//! scene draws the item. A world reads no store, so the host that holds one keeps each such
//! asset's bytes in the scene it hands over ([`sourced`]); an asset it doesn't hold is refused.

use std::borrow::Cow;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use deep_canvas_physics::doc::Refusal;
#[cfg(not(target_arch = "wasm32"))]
use deep_canvas_scene3d::{build, geom::Mesh, gltf, scene::placed_at, scene::Affine3, stack};
use serde_json::{json, Map, Value};

/// The issue that brings balloons and soft volumes to the wasm32 build, which links no scene3d.
pub const WASM_LATER: &str = "#2466";

/// Reads a stored asset's bytes by its SHA-256, as a host's asset store answers.
pub type Assets<'a> = &'a dyn Fn(&str) -> Option<Vec<u8>>;

/// The scene key that holds, by SHA-256 and as base64, the glTF of each mesh asset a soft volume
/// is built from.
const KEPT: &str = "physics.assets";

/// `scene` with the glTF of each `mesh.asset@1` item one of its worlds' soft volumes names as
/// its source, read by `read` and kept in it for [`expand`]; `scene` itself when `read` holds none.
pub fn sourced<'a>(scene: &'a Value, read: Assets<'_>) -> Cow<'a, Value> {
    let worlds = scene.get("worlds").and_then(Value::as_object);
    let soft = worlds
        .into_iter()
        .flatten()
        .filter_map(|(_, w)| w.get("soft")?.as_object())
        .flatten();
    let kept: Map<String, Value> = soft
        .filter_map(|(_, s)| {
            let item = scene.get("items")?.get(s.get("from")?.as_str()?)?;
            let sha = item.pointer("/params/sha256")?.as_str()?;
            let asset = s["shape"] == "volume" && item["kind"] == "mesh.asset@1";
            let bytes = asset.then(|| read(sha)).flatten()?;
            Some((sha.to_string(), json!(STANDARD.encode(bytes))))
        })
        .collect();
    if kept.is_empty() {
        return Cow::Borrowed(scene);
    }
    let mut out = scene.clone();
    out[KEPT] = Value::Object(kept);
    Cow::Owned(out)
}

/// What the evidence store at `root` keeps under `sha` (`<first 2 hex>/<other 62 hex>`), through
/// the checked read every store file takes (Asset): the name is 64 lowercase hex digits, the file
/// is inside the store, and its bytes hash to the name.
pub(crate) fn stored(root: &std::path::Path, sha: &str) -> Option<Vec<u8>> {
    let named = sha.len() == 64 && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    let file = named.then(|| root.join(&sha[..2]).join(&sha[2..]))?;
    let bytes = std::fs::read(file).ok()?;
    (deep_canvas::canon::sha256_hex(&bytes) == sha).then_some(bytes)
}

/// The wasm32 build: a balloon's or a volume's mesh is built by scene3d, which it doesn't link, so
/// each is refused, naming the issue that brings it; ropes and cloth run as natively.
#[cfg(target_arch = "wasm32")]
pub fn expand(_: Option<&Value>, doc: &Value) -> Result<Value, Vec<Refusal>> {
    let soft = doc
        .get("soft")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    let closed = soft.filter(|(_, s)| {
        matches!(
            s.get("shape").and_then(Value::as_str),
            Some("balloon" | "volume")
        )
    });
    let refused: Vec<Refusal> = closed
        .map(|(id, s)| {
            let what = format!("soft body {id}'s mesh is built by scene3d, which this wasm32 build doesn't link yet; {WASM_LATER} brings it");
            refusal("physics.unsupported", format!("soft/{id}/shape"), &s["shape"], what)
        })
        .collect();
    if refused.is_empty() {
        Ok(doc.clone())
    } else {
        Err(refused)
    }
}

fn refusal(code: &'static str, path: String, actual: &Value, what: String) -> Refusal {
    Refusal {
        code,
        path,
        actual: actual.clone(),
        what,
    }
}

#[cfg(not(target_arch = "wasm32"))]
/// `m`'s welded vertices placed by `place`, and its triangles over them, a triangle two of whose
/// corners weld into one left out.
fn welded(m: &Mesh, place: impl Fn([f64; 3]) -> [f64; 3]) -> Value {
    let w = m.welded();
    let n = w.iter().max().map_or(0, |x| *x as usize + 1);
    let mut vertices = vec![Value::Null; n];
    for (k, i) in w.iter().enumerate() {
        if vertices[*i as usize].is_null() {
            vertices[*i as usize] = json!(place(m.positions[k]));
        }
    }
    let triangles: Vec<[u32; 3]> = m
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| t.map(|i| w[i as usize]))
        .filter(|[a, b, c]| a != b && b != c && a != c)
        .collect();
    json!({"vertices": vertices, "triangles": triangles})
}

#[cfg(not(target_arch = "wasm32"))]
/// `p` by the 3 × 4 world transform `a`.
fn placed(a: &Affine3, p: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|r| a[r][0] * p[0] + a[r][1] * p[1] + a[r][2] * p[2] + a[r][3])
}

#[cfg(not(target_arch = "wasm32"))]
/// The scene's items as evaluated at t = 0 with their world transforms, or why the scene can't be.
type Placed = Result<Vec<(String, Value, Affine3)>, String>;

#[cfg(not(target_arch = "wasm32"))]
/// `doc`, a world document, with each balloon's and each volume's `mesh` built; unchanged when it
/// has neither. Without a scene a volume is left to the reader, which refuses it.
pub fn expand(scene: Option<&Value>, doc: &Value) -> Result<Value, Vec<Refusal>> {
    let Some(soft) = doc.get("soft").and_then(Value::as_object) else {
        return Ok(doc.clone());
    };
    let mut out = doc.clone();
    let mut refused = Vec::new();
    let mut items: Option<Placed> = None;
    for (id, s) in soft {
        let p = format!("soft/{id}");
        let mesh = match s.get("shape").and_then(Value::as_str) {
            Some("balloon") => {
                let num = |k: &str, d: f64| s.get(k).and_then(Value::as_f64).unwrap_or(d);
                let c = s.get("center").and_then(Value::as_array);
                let at = |k: usize| c.and_then(|c| c.get(k)?.as_f64()).unwrap_or(0.0);
                let center = [at(0), at(1), at(2)];
                let detail = s.get("subdivisions").cloned().unwrap_or(json!(2));
                let item = json!({"kind": "ball@1", "params": {"radius": num("radius", 0.5),
                    "tessellation": "geodesic", "detail": detail}});
                match build::built(&json!({}), id, &item, &stack::Run::default(), 0.0) {
                    Ok(b) => b
                        .mesh
                        .map(|m| welded(&m, |q| [0, 1, 2].map(|k| q[k] + center[k]))),
                    // The reader refuses the field the builder couldn't take.
                    Err(_) => None,
                }
            }
            Some("volume") => {
                let (Some(from), Some(scene)) = (s.get("from").and_then(Value::as_str), scene)
                else {
                    continue;
                };
                let placed_items = items.get_or_insert_with(|| {
                    placed_at(scene, 0).map_err(|r| format!("{} at {}", r.code, r.path))
                });
                let found = match placed_items {
                    Ok(list) => list.iter().find(|(i, _, _)| i == from),
                    Err(what) => {
                        let what = format!(
                            "volume {id}'s source {from} isn't built: the scene is refused, {what}"
                        );
                        refused.push(refusal(
                            "ref_unresolved",
                            format!("{p}/from"),
                            &s["from"],
                            what,
                        ));
                        continue;
                    }
                };
                let Some((_, item, a)) = found else {
                    let what =
                        format!("volume {id}'s source {from} is not an item of the world's scene");
                    refused.push(refusal(
                        "ref_unresolved",
                        format!("{p}/from"),
                        &s["from"],
                        what,
                    ));
                    continue;
                };
                let built = if item.get("kind").and_then(Value::as_str) == Some("mesh.asset@1") {
                    let sha = item.pointer("/params/sha256").and_then(Value::as_str);
                    let kept = sha.and_then(|sha| scene.get(KEPT)?.get(sha)?.as_str());
                    let Some(bytes) = kept.and_then(|b| STANDARD.decode(b).ok()) else {
                        let what = format!("volume {id}'s source {from} is the mesh asset {}, which the asset store this world is read with doesn't hold", sha.unwrap_or_default());
                        refused.push(refusal(
                            "asset_missing",
                            format!("{p}/from"),
                            &s["from"],
                            what,
                        ));
                        continue;
                    };
                    let node = item.pointer("/params/node").cloned().unwrap_or(json!(0));
                    gltf::mesh(&bytes, &node).ok()
                } else {
                    let built = build::built(scene, from, item, &stack::Run::default(), 0.0);
                    built.ok().and_then(|b| b.mesh)
                };
                let Some(m) = built else {
                    let what = format!("volume {id}'s source {from} builds no mesh");
                    refused.push(refusal(
                        "ref_unresolved",
                        format!("{p}/from"),
                        &s["from"],
                        what,
                    ));
                    continue;
                };
                Some(welded(&m, |q| placed(a, q)))
            }
            _ => None,
        };
        if let Some(mesh) = mesh {
            out["soft"][id]["mesh"] = mesh;
        }
    }
    if refused.is_empty() {
        Ok(out)
    } else {
        Err(refused)
    }
}
