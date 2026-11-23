use super::*;
use serde_json::json;

fn both(kind: &str, p: Value) -> (Mesh, u64) {
    let doc = json!({"items": {}});
    let ctx = Ctx {
        doc: &doc,
        id: "",
        plants: Plants::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    (
        build(kind, &p, &ctx).unwrap(),
        estimate(kind, &p, &ctx).unwrap(),
    )
}

#[test]
fn declared_counts_equal_built_counts() {
    for (kind, p) in [
        ("slab@1", json!({"size": [1, 2, 3]})),
        ("slab@1", json!({"size": [1, 1, 1], "radius": 0.1})),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0.5, 2]], "segments": 16}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0, 1]], "segments": 16}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0.5, 1]], "sweep": 180, "caps": "cut"}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.12, 0], [0.08, 0.8]], "segments": 6, "shade": "flat"}),
        ),
        ("ball@1", json!({"radius": 1, "segments": 32})),
        (
            "ball@1",
            json!({"radius": 1, "tessellation": "geodesic", "detail": 2}),
        ),
        (
            "extrude@1",
            json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "holes": [[[0.5, 0.25], [1.5, 0.25], [1.5, 0.75], [0.5, 0.75]]], "depth": 0.5}),
        ),
        (
            "tube@1",
            json!({"path": [[0, 0, 0], [0, 2, 0]], "radius": 0.5, "caps": "round"}),
        ),
        (
            "coil@1",
            json!({"radius": 0.5, "pitch": 0.2, "wire": 0.05, "turns": 3}),
        ),
        (
            "plate@1",
            json!({"grid": [4, 3], "size": [2, 1.5], "two_sided": true}),
        ),
        ("display@1", json!({"size": [0.6, 0.4], "bezel": 0.02})),
    ] {
        let (m, n) = both(kind, p.clone());
        assert_eq!(m.positions.len() as u64, n, "{kind} {p}");
    }
}

/// Welded on a 1e-6 m grid: each closed part's open edges and V − E + F.
fn closed_parts(m: &Mesh) -> Vec<(String, usize, i64, u32)> {
    let key = |p: V3| p.map(|x| (x / 1e-6).round() as i64);
    let mut ids = std::collections::BTreeMap::new();
    let at: Vec<usize> = m
        .positions
        .iter()
        .map(|p| {
            let n = ids.len();
            *ids.entry(key(*p)).or_insert(n)
        })
        .collect();
    m.closed
        .iter()
        .map(|(name, (tris, genus))| {
            let mut edges = std::collections::BTreeMap::new();
            let mut verts = std::collections::BTreeSet::new();
            let mut faces = 0i64;
            for &t in tris {
                let v = [0, 1, 2].map(|j| at[m.indices[3 * t as usize + j] as usize]);
                if v[0] == v[1] || v[1] == v[2] || v[0] == v[2] {
                    continue;
                }
                faces += 1;
                for j in 0..3 {
                    let (a, b) = (v[j], v[(j + 1) % 3]);
                    verts.insert(a);
                    *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
                }
            }
            let open = edges.values().filter(|n| **n != 2).count();
            let chi = verts.len() as i64 - edges.len() as i64 + faces;
            (name.clone(), open, chi, *genus)
        })
        .collect()
}

#[test]
fn the_issues_builder_params_change_the_mesh_keep_their_count_and_stay_watertight() {
    let doc = json!({"items": {"rail": {"kind": "curve@1", "params": {"points": [[0, 0, 0], [2, 0, 0], [2, 0, 2]]}}}});
    let ctx = Ctx {
        doc: &doc,
        id: "it",
        plants: Plants::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    for (kind, plain, p) in [
        (
            "slab@1",
            json!({"size": [2, 0.2, 1]}),
            json!({"size": [2, 0.2, 1], "bevel": 0.05}),
        ),
        (
            "slab@1",
            json!({"size": [2, 0.2, 1]}),
            json!({"size": [2, 0.2, 1], "groove": {"depth": 0.05, "width": 0.2}}),
        ),
        (
            "slab@1",
            json!({"size": [2, 0.2, 1]}),
            json!({"size": [2, 0.2, 1], "along": {"path": "rail", "from": 0.25, "to": 0.9}}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
            json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16, "ribs": {"count": 8, "depth": 0.05, "span": 0.5}}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
            json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16, "thread": {"pitch": 0.2, "depth": 0.02}}),
        ),
        (
            "lathe@1",
            json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
            json!({"outline": [[0.5, 0], [0.5, 1]], "rim": [[1, 0], [0, 1], [-1, 0], [0, -1]]}),
        ),
        (
            "extrude@1",
            json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "depth": 0.5}),
            json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "depth": {"from": 0.1, "to": 0.6, "up": [0, 1, 1]}, "bevel": 0.05}),
        ),
        (
            "tube@1",
            json!({"path": "rail", "radius": 0.1}),
            json!({"path": "rail", "radius": 0.1, "bend": 0.4}),
        ),
    ] {
        let (a, b) = (
            build(kind, &plain, &ctx).unwrap(),
            build(kind, &p, &ctx).unwrap(),
        );
        assert_ne!(
            a.positions, b.positions,
            "{kind} {p}: the param moves the mesh"
        );
        assert_eq!(
            b.positions.len() as u64,
            estimate(kind, &p, &ctx).unwrap(),
            "{kind} {p}: declared = built"
        );
        let parts = closed_parts(&b);
        assert!(!parts.is_empty(), "{kind} {p}: a closed part");
        for (name, open, chi, genus) in parts {
            assert_eq!(
                (open, chi),
                (0, 2 - 2 * i64::from(genus)),
                "{kind} {p} part {name}"
            );
        }
    }
    let field = json!({"grid": [4, 3], "size": [2, 1.5], "height": {"noise": {"amplitude": 0.2, "scale": 0.5, "seed": 3}}});
    let flat = build("plate@1", &json!({"grid": [4, 3], "size": [2, 1.5]}), &ctx).unwrap();
    let hilly = build("plate@1", &field, &ctx).unwrap();
    assert_ne!(
        flat.positions, hilly.positions,
        "a height field lifts the plate"
    );
    assert_eq!(
        hilly.positions.len() as u64,
        estimate("plate@1", &field, &ctx).unwrap()
    );
    let bands = build("lathe@1", &json!({"outline": [[0.5, 0], [0.5, 1]], "bands": [{"y0": 0, "y1": 0.5, "material": "wood"}]}), &ctx).unwrap();
    assert!(
        !bands.parts["band.0"].is_empty(),
        "a band names the triangles between its heights"
    );
}

#[test]
fn builders_return_anchors_values_attributes_and_points_on_their_faces_seeded_by_id() {
    let doc = json!({"items": {}});
    let p = json!({"size": [2, 1, 1], "scatter": {"count": 50}});
    let at = |id: &'static str| {
        build(
            "slab@1",
            &p,
            &Ctx {
                doc: &doc,
                id,
                plants: Plants::default(),
                outlines: &[],
                planted: None,
                pool: None,
            },
        )
        .unwrap()
    };
    let (a, again, other) = (at("a"), at("a"), at("b"));
    assert_eq!(a.anchors["top"][0], [0.0, 1.0, 0.0]);
    assert_eq!(a.anchors["bottom"][0], [0.0, 0.0, 0.0]);
    assert!((a.values["area"] - 10.0).abs() < 1e-9 && (a.values["volume"] - 2.0).abs() < 1e-9);
    assert_eq!(a.uv0.len(), a.positions.len());
    assert_eq!(a.attributes["height"].len(), a.positions.len());
    let pts = |m: &Mesh| m.outputs["points"].as_array().unwrap().clone();
    assert_eq!(pts(&a).len(), 50);
    assert_eq!(pts(&a), pts(&again), "one ID lays out one set of points");
    assert_ne!(pts(&a), pts(&other), "another ID another");
    for q in pts(&a) {
        let q: Vec<f64> = q
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let on = (q[0].abs() - 1.0).abs() < 1e-9
            || q[1].abs() < 1e-9
            || (q[1] - 1.0).abs() < 1e-9
            || (q[2].abs() - 0.5).abs() < 1e-9;
        assert!(on, "{q:?} lies on a face");
    }
    let tube = build(
        "tube@1",
        &json!({"path": [[0, 0, 0], [0, 2, 0]], "radius": 0.1}),
        &Ctx {
            doc: &doc,
            id: "t",
            plants: Plants::default(),
            outlines: &[],
            planted: None,
            pool: None,
        },
    )
    .unwrap();
    assert_eq!(
        (tube.anchors["start"][0], tube.anchors["end"][0]),
        ([0.0, 0.0, 0.0], [0.0, 2.0, 0.0])
    );
}

#[test]
fn a_swept_square_shades_each_side_flat_with_hard_corners() {
    // An off-centre bar with a hole, swept along a straight line: every side is flat.
    let doc = json!({"items": {"c": {"kind": "curve@1",
        "params": {"points": [[0, 0, 0], [0, 0, 1]], "mode": "linear"}}}});
    let p = json!({"outline": [[0, 0], [0.1, 0], [0.1, 0.04], [0, 0.04]],
        "holes": [[[0.02, 0.01], [0.04, 0.01], [0.04, 0.03], [0.02, 0.03]]],
        "along": {"curve": "c", "rings": 4}});
    let ctx = Ctx {
        doc: &doc,
        id: "bar",
        plants: Plants::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    let m = build("extrude@1", &p, &ctx).unwrap();
    assert_eq!(
        estimate("extrude@1", &p, &ctx).unwrap(),
        m.positions.len() as u64
    );
    for t in 0..m.triangles() {
        let ids = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        let [a, b, c] = ids.map(|i| m.positions[i]);
        let face = unit(cross(sub(b, a), sub(c, a)));
        for i in ids {
            let n = m.normals[i];
            assert!(
                dot(n, face) > 1.0 - 1e-9,
                "triangle {t}: vertex {i} at {:?} has normal {n:?}, its face {face:?}",
                m.positions[i]
            );
        }
    }
}

#[test]
fn a_uv_ball_of_32_has_561_vertices_and_a_geodesic_icosahedron_at_detail_2_has_540() {
    assert_eq!(both("ball@1", json!({"radius": 1, "segments": 32})).1, 561);
    assert_eq!(
        both(
            "ball@1",
            json!({"radius": 1, "tessellation": "geodesic", "base": "icosa", "detail": 2})
        )
        .1,
        540
    );
}
