//! What #1929's Scope states and its acceptance suite leaves out: `moves` left out, `on`, a box
//! with a side of 0 m, a control mesh that is not manifold, wound inward or too small, a vertex
//! within 1e-6 m of the control mesh, the 64 vertices a refusal names at most, the bind a host's memo
//! keeps between its frames, and the path a refusal has where the scene builds the item.

use super::*;
use crate::builders::{self, Ctx, CODED};
use crate::stack::{apply, Run};

/// The 1 m slab cube, standing on its origin.
fn cube() -> Mesh {
    let doc = json!({"items": {}});
    let ctx = Ctx {
        id: "it",
        doc: &doc,
        plants: Default::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    builders::build("slab@1", &json!({"size": [1, 1, 1]}), &ctx).unwrap()
}

/// The octahedron `r` m out from the cube's centre, wound outward.
fn octahedron(r: f64) -> Value {
    let points = [
        [r, 0.5, 0.0],
        [-r, 0.5, 0.0],
        [0.0, 0.5 + r, 0.0],
        [0.0, 0.5 - r, 0.0],
        [0.0, 0.5, r],
        [0.0, 0.5, -r],
    ];
    let triangles = [
        [0, 2, 4],
        [2, 1, 4],
        [1, 3, 4],
        [3, 0, 4],
        [2, 0, 5],
        [1, 2, 5],
        [3, 1, 5],
        [0, 3, 5],
    ];
    json!({"points": points, "triangles": triangles})
}

/// The cube under one deform of every vertex: its mesh, or its refusal.
fn bound(kind: &str, params: Value) -> Result<Mesh, Refused> {
    let all = vec![true; cube().positions.len()];
    deform(&cube(), &all, kind, &params, None, None).map(|(m, _)| m)
}

/// The cube under a stack: its mesh, or the refusal's code and what it found.
fn stacked(modifiers: Value) -> Result<Mesh, (String, Value)> {
    let item = json!({"modifiers": modifiers});
    let built = apply(
        cube(),
        &item,
        &json!({"items": {}}),
        "it",
        0.0,
        &Run::default(),
    );
    built.map(|b| b.0).map_err(|fault| {
        let part: Vec<&str> = fault.split(CODED).collect();
        (part[0].to_string(), serde_json::from_str(part[2]).unwrap())
    })
}

#[test]
fn moves_left_out_are_zero() {
    let grid = json!({"from": [-1, -0.5, -1], "to": [1, 1.5, 1], "points": [2, 3, 4]});
    assert_eq!(bound(BOX, grid).unwrap().positions, cube().positions);
    let cage = json!({"mesh": octahedron(2.0)});
    assert_eq!(bound(MESH, cage).unwrap().positions, cube().positions);
}

#[test]
fn on_binds_and_moves_its_part_alone() {
    // The box holds the cube's top alone, and its four points on +y move 1 m up.
    let lift = |j: usize| [0, usize::from(j / 2 % 2 == 1), 0];
    let moves: Vec<[usize; 3]> = (0..8).map(lift).collect();
    let params =
        json!({"from": [-1, 0.75, -1], "to": [1, 1.25, 1], "points": [2, 2, 2], "moves": moves});
    let (base, top) = (cube(), "top");
    let moved = stacked(json!([{"kind": BOX, "on": top, "params": params}])).unwrap();
    let mut part = vec![false; base.positions.len()];
    for &t in &base.parts[top] {
        for j in 0..3 {
            part[base.indices[3 * t as usize + j] as usize] = true;
        }
    }
    for (v, p) in base.positions.iter().enumerate() {
        let lifted = if part[v] { 0.5 } else { 0.0 };
        assert_eq!(
            moved.positions[v],
            [p[0], p[1] + lifted, p[2]],
            "vertex {v}"
        );
    }
    // With no `on`, the vertices under the box are refused.
    let (code, _) = stacked(json!([{"kind": BOX, "params": params}])).unwrap_err();
    assert_eq!(code, CODES[0]);
}

#[test]
fn a_box_with_a_side_of_0_m_is_refused() {
    let flat = json!({"from": [-1, 0.5, -1], "to": [1, 0.5, 1], "points": [2, 2, 2]});
    assert_eq!(
        bound(BOX, flat).unwrap_err(),
        (CODES[1], json!({"reason": "side"}))
    );
}

#[test]
fn a_control_mesh_not_manifold_wound_inward_or_of_3_points_is_refused() {
    let whole = octahedron(2.0);
    let reason = |mesh: Value| bound(MESH, json!({"mesh": mesh})).unwrap_err();
    let mut twice = whole.clone();
    twice["triangles"]
        .as_array_mut()
        .unwrap()
        .push(json!([0, 2, 4]));
    assert_eq!(reason(twice), (CODES[3], json!({"reason": "non_manifold"})));
    let mut inward = whole.clone();
    for t in inward["triangles"].as_array_mut().unwrap() {
        t.as_array_mut().unwrap().swap(1, 2);
    }
    assert_eq!(reason(inward), (CODES[3], json!({"reason": "inward"})));
    let three = json!({"points": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "triangles": [[0, 1, 2]]});
    assert_eq!(reason(three), (CODES[3], json!({"reason": "points"})));
}

#[test]
fn a_vertex_within_1e_6_m_of_the_control_mesh_is_refused() {
    // The cube's corners lie `gap` m inside an octahedron 1.5 m + gap × √3 out.
    let around = |gap: f64| bound(MESH, json!({"mesh": octahedron(1.5 + gap * sqrt(3.0))}));
    let (code, found) = around(5e-7).unwrap_err();
    assert_eq!(
        (code, found["vertices"].as_array().unwrap().len()),
        (CODES[2], 8)
    );
    assert!(around(2e-6).is_ok());
}

#[test]
fn a_refusal_names_64_vertices_at_most() {
    let fine = json!({"kind": "mod.subdivide@1", "params": {"levels": 3, "scheme": "simple"}});
    let away = json!({"from": [5, 5, 5], "to": [6, 6, 6], "points": [2, 2, 2]});
    let (code, found) = stacked(json!([fine, {"kind": BOX, "params": away}])).unwrap_err();
    assert_eq!(
        (code.as_str(), found["vertices"].as_array().unwrap().len()),
        (CODES[0], 64)
    );
}

#[test]
fn a_host_that_keeps_a_memo_binds_once_between_its_frames() {
    let memo = std::cell::RefCell::new(crate::contributed::Memo::default());
    let fills = crate::contributed::Fills {
        memo: Some(&memo),
        ..Default::default()
    };
    let frame = |lift: f64| {
        let moves = [
            [0.0; 3],
            [0.0; 3],
            [0.0, lift, 0.0],
            [0.0; 3],
            [0.0; 3],
            [0.0; 3],
        ];
        let deform = json!({"kind": MESH, "params": {"mesh": octahedron(2.0), "moves": moves}});
        let item = json!({"kind": "slab@1", "params": {"size": [1, 1, 1]}, "modifiers": [deform]});
        let doc = json!({"items": {"it": item}});
        let mesh = crate::scene::mesh_of(&doc, "it", &doc["items"]["it"], 0.0, fills).unwrap();
        let bind = memo.borrow().binds["it"][0].clone().unwrap();
        (mesh.positions, bind.computed)
    };
    let (still, first) = frame(0.0);
    let (lifted, second) = frame(1.0);
    assert_eq!((first, second), (true, false));
    assert_ne!(still, lifted);
}

#[test]
fn the_scene_names_the_modifier_a_refusal_is_at() {
    let away = json!({"from": [5, 5, 5], "to": [6, 6, 6], "points": [2, 2, 2]});
    let deform = json!({"kind": BOX, "params": away});
    let item = json!({"kind": "slab@1", "params": {"size": [1, 1, 1]}, "modifiers": [deform]});
    let doc = json!({"items": {"it": item}});
    let fills = crate::contributed::Fills::default();
    let refused = crate::scene::mesh_of(&doc, "it", &doc["items"]["it"], 0.0, fills).unwrap_err();
    assert_eq!(
        (refused.code, refused.path.as_str()),
        (CODES[0], "items/it/modifiers/0")
    );
}
