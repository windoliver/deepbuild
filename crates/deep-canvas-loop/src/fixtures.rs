//! The loop module's planted fixtures (#138's kit: each code's fixture raises exactly it): each
//! a scene of one `mesh.asset@1` whose glTF the fixture registers with it, since a kit fixture
//! has no evidence store.

use deep_canvas::registry::Registrar;
use serde_json::{json, Value};

use crate::KIND;

/// A glTF of one node's mesh, one triangle primitive (positions, its normals where given, its
/// indices), with a skin of one joint at its bind pose where `skinned`; its buffer inline.
fn gltf(positions: &[[f32; 3]], normals: &[[f32; 3]], indices: &[u32], skinned: bool) -> Vec<u8> {
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

/// A scene of `items` through the camera `cam`, its modules required.
fn staged(title: &str, items: Value) -> Value {
    let mut items = items;
    let mut k = 0;
    for (id, item) in items.as_object_mut().into_iter().flatten() {
        item["id"] = json!(id);
        item["name"] = json!(id);
        item["order"] = json!(format!("a{k}"));
        k += 1;
    }
    json!({
        "format": 1, "profile": "figure", "title": title, "description": title, "size": [320, 240],
        "camera": "cam",
        "requires": {"modules": {"scene3d": "^1", "building": "^1", "loop": "^1"}},
        "items": items,
    })
}

/// #1938: the fixture `name` of `kind` that raises exactly `codes`.
fn loop_fixture(r: &mut Registrar, name: &str, kind: &str, codes: &[&str], doc: Value) {
    let sidecar = json!({"checks": [{"kind": kind}], "oracles": ["analytic"], "codes": codes});
    r.parity("scene3d", &format!("loop-{name}"), doc, sidecar);
}

/// #1938's planted faults and their clean twins, one pair a code.
fn loop_fixtures(r: &mut Registrar) {
    use crate::{contrast, exposure, framing, noise, scale};
    // A door in a wall, 20 m tall, and its twin at 2.1 m.
    let door = |h: f64| {
        let cam = json!({"kind": "camera@1", "params": {"projection": "isometric", "target": [2, 1, 0], "view_width": 12}});
        let wall = json!({"kind": "arch.wall@1", "params": {"a": [0, 0], "b": [4, 0], "thickness": 0.2,
            "height": 2.7, "justify": "center", "outside": "left", "cut_height": 1.2}});
        let door = json!({"kind": "arch.opening@1", "parent": "wall", "params": {"wall": "wall",
            "type": "door", "at_along": 1.5, "width": 0.9, "height": h, "sill": 0}});
        staged("A door in a wall", json!({"cam": cam, "wall": wall, "door": door}))
    };
    loop_fixture(r, "scale-door", scale::KIND, &[scale::CODE], door(20.0));
    loop_fixture(r, "scale-door-clean", scale::KIND, &[], door(2.1));
    // A box the camera keeps, its horizon rolled 5°, and its twin level.
    let rolled = |roll: f64| {
        let cam = json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0],
            "fov": 40, "roll": roll, "fit": {"keep": ["box"]}}});
        let b = json!({"kind": "mark.box@1", "params": {"size": [0.1, 0.1, 0.1],
            "paint": {"fill": {"role": "ink"}}}});
        staged("A kept box", json!({"cam": cam, "box": b}))
    };
    loop_fixture(r, "framing-horizon", framing::KIND, &[framing::CODE], rolled(5.0));
    loop_fixture(r, "framing-clean", framing::KIND, &[], rolled(0.0));
    // A grey plate the camera keeps under a sun straight above: at 8π lx it clips, at π lx
    // middle grey shows as middle grey.
    let lit = |lx: f64| {
        let cam = json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0],
            "orbit": {"azimuth": 0, "elevation": 60}, "fov": 40, "fit": {"keep": ["plate"]}}});
        let mat = json!({"kind": "material@1", "params": {"base_color": [0.18, 0.18, 0.18], "roughness": 1, "metallic": 0}});
        let plate = json!({"kind": "mark.box@1", "material": "mat", "params": {"size": [2, 0.05, 2]}});
        let sun = json!({"kind": "light.sun@1", "params": {"illuminance": lx, "shadow": false}, "at": {"rot": [-90, 0, 0]}});
        staged("A lit plate", json!({"cam": cam, "mat": mat, "plate": plate, "sun": sun}))
    };
    let pi = std::f64::consts::PI;
    loop_fixture(r, "exposure-clipped", exposure::KIND, &[exposure::CODE], lit(8.0 * pi));
    loop_fixture(r, "exposure-clean", exposure::KIND, &[], lit(pi));
    // A label in the look's muted role on its ground, and its twin in ink.
    let label = |role: &str| {
        let cam = json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0],
            "position": [0, 0, 5], "fov": 40}});
        let text = json!({"kind": "mark.text@1", "params": {"text": "Exposure 1/60", "size": 24,
            "paint": {"fill": {"role": role}}}});
        staged("A label", json!({"cam": cam, "label": text}))
    };
    loop_fixture(r, "contrast-muted", contrast::KIND, &[contrast::CODE], label("muted"));
    loop_fixture(r, "contrast-clean", contrast::KIND, &[], label("ink"));
    // A plaster plate whose material's pattern seed a driver steps each frame, and its twin
    // seeded once.
    let grain = |reseeds: bool| {
        let cam = json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0],
            "position": [0, 3, 0.01], "fov": 40}});
        let mat = json!({"kind": "material@1", "params": {"base_color": [0.5, 0.5, 0.5], "roughness": 1,
            "pattern": "plaster", "pattern_scale": 0.2, "pattern_seed": 1}});
        let plate = json!({"kind": "mark.box@1", "material": "mat", "params": {"size": [3, 0.05, 3]}});
        let sun = json!({"kind": "light.sun@1", "params": {"illuminance": std::f64::consts::PI, "shadow": false},
            "at": {"rot": [-90, 0, 0]}});
        let mut doc = staged("A plaster plate", json!({"cam": cam, "mat": mat, "plate": plate, "sun": sun}));
        if reseeds {
            doc["drivers"] = json!({"reseed": {"target": "items/mat/params/pattern_seed",
                "expr": "floor(t * 60)", "vars": {"t": "time"}}});
        }
        doc
    };
    loop_fixture(r, "noise-reseeds", noise::KIND, &[noise::CODE], grain(true));
    loop_fixture(r, "noise-clean", noise::KIND, &[], grain(false));
}

pub fn register(r: &mut Registrar) {
    loop_fixtures(r);
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
        Some(gltf(&tet, &[], &sliver, false)),
    );
    // One triangle wound up +Z, its normals down.
    let down = [[0.0, 0.0, -1.0]; 3];
    planted(
        r,
        "flipped",
        "loop.flipped",
        Some(gltf(&tri, &down, &[0, 1, 2], false)),
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
        Some(gltf(&quad, &[], &[0, 1, 2, 1, 2, 3], false)),
    );
    planted(
        r,
        "inward",
        "loop.normals_inward",
        Some(gltf(&tet, &[], &inward, false)),
    );
    // A skinned triangle: one triangle never pairs into a quad.
    planted(
        r,
        "quad-ratio",
        "loop.quad_ratio",
        Some(gltf(&tri, &[], &[0, 1, 2], true)),
    );
}
