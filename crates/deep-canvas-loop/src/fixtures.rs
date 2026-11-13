//! The loop module's planted fixtures (#138's kit: each code's fixture raises exactly it): each
//! a scene of one `mesh.asset@1` whose glTF the fixture registers with it, since a kit fixture
//! has no evidence store.

use deep_canvas::registry::Registrar;
use serde_json::{json, Value};

use crate::KIND;

/// A glTF of one node's mesh, one triangle primitive (positions, its normals where given, its
/// UV sets in order, its indices), with a skin of one joint at its bind pose where `skinned`; its
/// buffer inline.
fn gltf(
    positions: &[[f32; 3]],
    normals: &[[f32; 3]],
    uvs: &[&[[f32; 2]]],
    indices: &[u32],
    skinned: bool,
) -> Vec<u8> {
    let mut bin: Vec<u8> = Vec::new();
    let mut views = Vec::new();
    let mut view = |bytes: Vec<u8>, bin: &mut Vec<u8>| {
        views.push(json!({"buffer": 0, "byteOffset": bin.len(), "byteLength": bytes.len()}));
        bin.extend(bytes);
        views.len() - 1
    };
    let floats = |rows: &[[f32; 3]]| -> Vec<u8> {
        rows.iter()
            .flatten()
            .flat_map(|f| f.to_le_bytes())
            .collect()
    };
    let mut accessors = vec![
        json!({"bufferView": view(floats(positions), &mut bin), "componentType": 5126,
                                    "count": positions.len(), "type": "VEC3"}),
    ];
    let mut attributes = json!({"POSITION": 0});
    if !normals.is_empty() {
        accessors.push(
            json!({"bufferView": view(floats(normals), &mut bin), "componentType": 5126,
                              "count": normals.len(), "type": "VEC3"}),
        );
        attributes["NORMAL"] = json!(1);
    }
    for (k, uv) in uvs.iter().enumerate() {
        let bytes: Vec<u8> = uv.iter().flatten().flat_map(|f| f.to_le_bytes()).collect();
        accessors.push(
            json!({"bufferView": view(bytes, &mut bin), "componentType": 5126,
                              "count": uv.len(), "type": "VEC2"}),
        );
        attributes[format!("TEXCOORD_{k}")] = json!(accessors.len() - 1);
    }
    let idx: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    accessors.push(
        json!({"bufferView": view(idx, &mut bin), "componentType": 5125,
                          "count": indices.len(), "type": "SCALAR"}),
    );
    let mut node = json!({"mesh": 0});
    let mut nodes = vec![];
    if skinned {
        node["skin"] = json!(0);
    }
    nodes.push(node);
    let mut doc = json!({
        "asset": {"version": "2.0"},
        "nodes": nodes,
        "meshes": [{"primitives": [{"attributes": attributes, "indices": accessors.len() - 1}]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": bin.len(),
                     "uri": format!("data:application/octet-stream;base64,{}", deep_canvas::base64::encode(&bin))}],
    });
    if skinned {
        doc["nodes"]
            .as_array_mut()
            .expect("nodes")
            .push(json!({"name": "joint"}));
        doc["skins"] = json!([{"joints": [1]}]);
    }
    serde_json::to_vec(&doc).expect("a glTF")
}

/// A scene of one mesh asset of `bytes`, by hash.
fn scene(title: &str, sha: &str) -> Value {
    json!({
        "format": 1, "profile": "figure", "title": title, "description": title, "size": [320, 240],
        "camera": "cam", "requires": {"modules": {"scene3d": "^1", "loop": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "isometric", "target": [0, 0, 0], "view_width": 4}},
            "asset": {"id": "asset", "kind": "mesh.asset@1", "name": "Asset", "order": "a1",
                      "params": {"sha256": sha, "node": 0}},
        }
    })
}

/// Registers the fixture `name` that raises exactly `code`, its asset `bytes` (none: the asset
/// is missing).
fn planted(r: &mut Registrar, name: &str, code: &str, bytes: Option<Vec<u8>>) {
    let sha = deep_canvas::canon::sha256_hex(bytes.as_deref().unwrap_or(name.as_bytes()));
    // Its items are scene3d's, so it sits in the parity suite's scene3d category.
    let sidecar = json!({"checks": [{"kind": KIND}], "oracles": ["analytic"], "codes": [code]});
    r.parity(
        "scene3d",
        &format!("shading-{name}"),
        scene(name, &sha),
        sidecar,
    )
    .fixture_assets(bytes.into_iter().collect());
}

pub fn register(r: &mut Registrar) {
    // A tetrahedron, wound out; its faces' corners in turn.
    let tet = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ];
    let out = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    let inward: Vec<u32> = out.chunks(3).flat_map(|t| [t[0], t[2], t[1]]).collect();
    let tri = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
    planted(r, "unreadable", "loop.unreadable", None);
    // The tetrahedron with a face whose corners weld together.
    let mut sliver = out.to_vec();
    sliver.extend([0, 1, 1]);
    planted(
        r,
        "degenerate",
        "loop.degenerate",
        Some(gltf(&tet, &[], &[], &sliver, false)),
    );
    // One triangle wound up +Z, its normals down.
    let down = [[0.0, 0.0, -1.0]; 3];
    planted(
        r,
        "flipped",
        "loop.flipped",
        Some(gltf(&tri, &down, &[], &[0, 1, 2], false)),
    );
    // Two triangles that run their shared edge the same way.
    let quad = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [1.0, 1.0, 0.0],
    ];
    planted(
        r,
        "inconsistent",
        "loop.inconsistent",
        Some(gltf(&quad, &[], &[], &[0, 1, 2, 1, 2, 3], false)),
    );
    planted(
        r,
        "inward",
        "loop.normals_inward",
        Some(gltf(&tet, &[], &[], &inward, false)),
    );
    // A skinned triangle: one triangle never pairs into a quad.
    planted(
        r,
        "quad-ratio",
        "loop.quad_ratio",
        Some(gltf(&tri, &[], &[], &[0, 1, 2], true)),
    );
    // One triangle whose uv1 reaches past the unit square; its uv0 may tile, so uv0 lies past it
    // too and raises nothing.
    let past = [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5]];
    planted(
        r,
        "uv",
        "loop.uv",
        Some(gltf(&tri, &[], &[&past, &past], &[0, 1, 2], false)),
    );
}
