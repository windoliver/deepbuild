//! #524: the meshes a world's closed soft bodies are built on, resolved where the world meets its
//! scene. A balloon's is the geodesic ball its subdivisions name (`ball@1`, detail =
//! subdivisions), at its center; a volume's is its source item's mesh as the scene evaluates it at
//! t = 0, in world metres. Each is welded as scene3d welds a mesh (positions equal to 1e-6 m are
//! one particle, numbered in order of first appearance), so a particle `v{i}` is the item's
//! welded vertex `i`, and written into the soft body as `mesh: {vertices, triangles}` for the
//! physics module to read, which refuses one that isn't closed. A source the scene can't build,
//! or a mesh asset, is refused here, naming it.

use deep_canvas_physics::doc::Refusal;
#[cfg(not(target_arch = "wasm32"))]
use deep_canvas_scene3d::{build, geom::Mesh, scene::placed_at, scene::Affine3, stack};
#[cfg(not(target_arch = "wasm32"))]
use serde_json::json;
use serde_json::Value;

/// The issue that brings a soft volume built from a mesh asset.
pub const ASSET_LATER: &str = "#2457";

/// The issue that brings balloons and soft volumes to the wasm32 build, which links no scene3d.
pub const WASM_LATER: &str = "#2466";

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
                if item.get("kind").and_then(Value::as_str) == Some("mesh.asset@1") {
                    let what = format!("volume {id}'s source {from} is a mesh asset, which this backend interface doesn't build a soft volume from yet; {ASSET_LATER} brings it");
                    refused.push(refusal(
                        "physics.unsupported",
                        format!("{p}/from"),
                        &s["from"],
                        what,
                    ));
                    continue;
                }
                match build::built(scene, from, item, &stack::Run::default(), 0.0) {
                    Ok(b) if b.mesh.is_some() => b.mesh.map(|m| welded(&m, |q| placed(a, q))),
                    Ok(_) | Err(_) => {
                        let what = format!("volume {id}'s source {from} builds no mesh");
                        refused.push(refusal(
                            "ref_unresolved",
                            format!("{p}/from"),
                            &s["from"],
                            what,
                        ));
                        continue;
                    }
                }
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
