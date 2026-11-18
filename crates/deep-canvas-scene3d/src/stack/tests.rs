use super::*;
use crate::builders::{self, Ctx};

fn box_mesh() -> Mesh {
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

fn plate() -> Mesh {
    let doc = json!({"items": {}});
    let ctx = Ctx {
        id: "it",
        doc: &doc,
        plants: Default::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    builders::build("plate@1", &json!({"grid": [2, 2], "size": [1, 1]}), &ctx).unwrap()
}

fn run(m: Mesh, modifiers: Value, t: f64) -> Mesh {
    let item = json!({"modifiers": modifiers});
    apply(m, &item, &json!({"items": {}}), "it", t, &Run::default())
        .unwrap()
        .0
}

/// Every closed part's welded V − E + F, with its open edges: what `close_components` and
/// a watertight build agree on.
fn euler(m: &Mesh) -> Vec<(i64, usize, u32)> {
    let w = m.welded();
    m.closed
        .values()
        .map(|(tris, g)| {
            let mut edges: BTreeMap<(u32, u32), u32> = BTreeMap::new();
            let mut verts = std::collections::BTreeSet::new();
            for &t in tris {
                let v = [0, 1, 2].map(|j| w[m.indices[3 * t as usize + j] as usize]);
                for j in 0..3 {
                    let (a, b) = (v[j], v[(j + 1) % 3]);
                    verts.insert(a);
                    *edges.entry((a.min(b), a.max(b))).or_default() += 1;
                }
            }
            let open = edges.values().filter(|c| **c != 2).count();
            (
                verts.len() as i64 - edges.len() as i64 + tris.len() as i64,
                open,
                *g,
            )
        })
        .collect()
}

fn declared(modifiers: Value, base: &Mesh) -> u64 {
    let item = json!({"modifiers": modifiers});
    let before = |k: usize| -> Result<Mesh, Fault> {
        Ok(apply(
            base.clone(),
            &prefix(&item, k),
            &json!({"items": {}}),
            "it",
            0.0,
            &Run::default(),
        )?
        .0)
    };
    estimate(
        (base.positions.len() as u64, base.triangles() as u64),
        &item,
        &before,
    )
    .unwrap()
    .vertices
}

#[test]
fn subdivide_splits_each_triangle_in_four_and_keeps_the_box_closed() {
    let m = run(
        box_mesh(),
        json!([{"kind": "mod.subdivide@1", "params": {"levels": 2}}]),
        0.0,
    );
    assert_eq!(m.triangles(), 12 * 16);
    assert_eq!(
        m.positions.len() as u64,
        declared(
            json!([{"kind": "mod.subdivide@1", "params": {"levels": 2}}]),
            &box_mesh()
        )
    );
    assert_eq!(euler(&m), vec![(2, 0, 0)]);
}

#[test]
fn bevel_chamfers_a_box_closed_with_its_count_declared() {
    for segments in [1, 3] {
        let mods = json!([{"kind": "mod.bevel@1", "params": {"width": 0.1, "segments": segments}}]);
        let m = run(box_mesh(), mods.clone(), 0.0);
        assert_eq!(m.positions.len() as u64, declared(mods, &box_mesh()));
        assert_eq!(euler(&m), vec![(2, 0, 0)], "segments {segments}");
        // The corners are cut: no point stays at a cube's corner.
        assert!(m
            .positions
            .iter()
            .all(|p| !(p[0].abs() > 0.4999 && (p[1] - 0.5).abs() > 0.4999 && p[2].abs() > 0.4999)));
        let vol = m.closed.values().map(|(t, _)| m.volume(t)).sum::<f64>();
        assert!(vol < 1.0 && vol > 0.9, "{vol}");
    }
}

#[test]
fn solidify_closes_an_open_plate_into_one_shell() {
    let mods = json!([{"kind": "mod.solidify@1", "params": {"thickness": 0.1}}]);
    let m = run(plate(), mods.clone(), 0.0);
    assert_eq!(euler(&m), vec![(2, 0, 0)]);
    assert_eq!(m.positions.len() as u64, declared(mods, &plate()));
    let vol: f64 = m.closed.values().map(|(t, _)| m.volume(t)).sum();
    assert!((vol.abs() - 0.1).abs() < 1e-9, "{vol}");
}

#[test]
fn build_keeps_its_fraction_of_triangles_in_order_or_seeded() {
    let half = run(
        box_mesh(),
        json!([{"kind": "mod.build@1", "params": {"from": 0, "to": 0.5}}]),
        0.0,
    );
    assert_eq!(half.triangles(), 6);
    assert_eq!(&half.indices[..], &box_mesh().indices[..18]);
    assert!(half.closed.is_empty());
    let seeded = run(
        box_mesh(),
        json!([{"kind": "mod.build@1", "params": {"to": 0.5, "order": "seeded", "seed": 3}}]),
        0.0,
    );
    assert_eq!(seeded.triangles(), 6);
    assert_ne!(seeded.indices, half.indices);
}

#[test]
fn store_keeps_a_height_field_that_sway_reads_by_name() {
    let mods = json!([
        {"kind": "mod.store@1", "params": {"name": "wind", "field": "height"}},
        {"kind": "mod.sway@1", "params": {"amount": 0.2, "weight": "wind", "hz": 1.0}}
    ]);
    let base = box_mesh();
    let at = |t: f64| run(base.clone(), mods.clone(), t);
    let m = at(0.3);
    assert_eq!(m.attributes["wind"].len(), m.positions.len());
    // The sway moves nothing at build (#2016): it keeps the stored field as its weights, the
    // foot's 0 and the top's 1, for the GPU to move by at each frame, and no t changes it.
    let sway = m.sway.as_ref().expect("a sway");
    assert_eq!(m.positions, base.positions);
    assert_eq!(sway.weights, m.attributes["wind"]);
    for (k, p) in base.positions.iter().enumerate() {
        assert_eq!(sway.weights[k], if p[1] < 1e-9 { 0.0 } else { 1.0 });
    }
    assert_eq!((sway.amount, sway.hz), (0.2, 1.0));
    assert_eq!(at(0.7), m);
    let rows = apply(
        base.clone(),
        &json!({"modifiers": mods}),
        &json!({}),
        "it",
        0.0,
        &Run::default(),
    )
    .unwrap()
    .1;
    assert_eq!(
        rows.iter()
            .map(|r| (r.reads_time, r.gpu))
            .collect::<Vec<_>>(),
        vec![(false, false), (true, true)]
    );
}

#[test]
fn displace_moves_welded_points_together_so_the_box_stays_closed() {
    let a = run(
        box_mesh(),
        json!([{"kind": "mod.displace@1", "params": {"amount": 0.05, "seed": 1}}]),
        0.0,
    );
    assert_eq!(euler(&a), vec![(2, 0, 0)]);
    assert_ne!(a.positions, box_mesh().positions);
    let b = run(
        box_mesh(),
        json!([{"kind": "mod.displace@1", "params": {"amount": 0.05, "seed": 2}}]),
        0.0,
    );
    assert_ne!(a.positions, b.positions);
}

#[test]
fn bob_wave_and_spin_are_closed_forms_in_t() {
    for kind in ["mod.bob@1", "mod.wave@1", "mod.spin@1"] {
        let mods = json!([{"kind": kind, "params": {}}]);
        let at = |t: f64| run(box_mesh(), mods.clone(), t).positions;
        assert_eq!(at(0.25), at(0.25), "{kind}");
        assert_ne!(at(0.25), at(0.5), "{kind}");
    }
    // A quarter turn at 90 deg/s after 1 s.
    let p = run(
        box_mesh(),
        json!([{"kind": "mod.spin@1", "params": {"rate": 90}}]),
        1.0,
    );
    for (q, r) in p.positions.iter().zip(&box_mesh().positions) {
        assert!(
            (q[1] - r[1]).abs() < 1e-12 && (q[0] - r[2]).abs() < 1e-9 && (q[2] + r[0]).abs() < 1e-9
        );
    }
}

#[test]
fn array_fits_lays_along_and_turns_around_with_exact_counts() {
    let doc = json!({"items": {"rail": {"kind": "curve@1", "params": {"points": [[0, 0, 0], [4, 0, 0]]}}}});
    let base = box_mesh();
    for (params, copies) in [
        (json!({"fit": 3, "offset": [1, 0, 0]}), 4),
        (json!({"count": 3, "along": "rail"}), 3),
        (
            json!({"count": 4, "around": {"axis": "y", "pivot": [2, 0, 0]}}),
            4,
        ),
    ] {
        let item = json!({"modifiers": [{"kind": "mod.array@1", "params": params}]});
        let m = apply(base.clone(), &item, &doc, "it", 0.0, &Run::default())
            .unwrap()
            .0;
        assert_eq!(m.positions.len(), copies * base.positions.len(), "{params}");
        let before = |k: usize| -> Result<Mesh, Fault> {
            Ok(apply(
                base.clone(),
                &prefix(&item, k),
                &doc,
                "it",
                0.0,
                &Run::default(),
            )?
            .0)
        };
        let n = estimate(
            (base.positions.len() as u64, base.triangles() as u64),
            &item,
            &before,
        )
        .unwrap()
        .vertices;
        assert_eq!(n as usize, m.positions.len(), "{params}");
    }
    let along = apply(
        base.clone(),
        &json!({"modifiers": [{"kind": "mod.array@1", "params": {"count": 3, "along": "rail"}}]}),
        &doc,
        "it",
        0.0,
        &Run::default(),
    )
    .unwrap()
    .0;
    assert!((along.bounds()[1][0] - 4.5).abs() < 1e-9);
}

#[test]
fn a_deform_on_a_part_moves_only_that_part() {
    let doc = json!({"items": {}});
    let ctx = Ctx {
        id: "it",
        doc: &doc,
        plants: Default::default(),
        outlines: &[],
        planted: None,
        pool: None,
    };
    let d = builders::build("display@1", &json!({"size": [0.6, 0.4]}), &ctx).unwrap();
    let m = run(
        d.clone(),
        json!([{"kind": "mod.bob@1", "on": "screen", "params": {"amount": 0.1, "hz": 1}}]),
        0.25,
    );
    let idx = &d.indices;
    let screen: std::collections::BTreeSet<u32> = d.parts["screen"]
        .iter()
        .flat_map(|t| (0..3).map(move |j| idx[3 * *t as usize + j]))
        .collect();
    for k in 0..d.positions.len() {
        assert_eq!(
            m.positions[k] == d.positions[k],
            !screen.contains(&(k as u32)),
            "vertex {k}"
        );
    }
    let item = json!({"modifiers": [{"kind": "mod.subdivide@1", "on": "screen"}]});
    assert!(apply(d, &item, &doc, "it", 0.0, &Run::default()).is_err());
}

/// The box moved off the mirror plane, with an attribute on each domain (#1781): a u32 on its
/// points and on its faces and an f32 on its corners and on its edges, each element holding its
/// own index.
fn tagged() -> Mesh {
    use crate::attrs::{Attribute, Domain, Elements, Type};
    let mut m = box_mesh().mapped(|p| add(p, [2.0, 0.0, 0.0]), |_, n| n);
    let e = Elements::of(&m);
    for (name, domain, ty) in [
        ("point", Domain::Point, Type::U32),
        ("face", Domain::Face, Type::U32),
        ("corner", Domain::Corner, Type::F32),
        ("edge", Domain::Edge, Type::F32),
    ] {
        let values = (0..e.count(domain)).map(|i| i as f64).collect();
        let attribute = Attribute { domain, ty, values };
        e.write(&mut m, name, attribute).unwrap();
    }
    m
}

/// Why `out`, made of `src`, doesn't hold each attribute by its sources: `point` maps one of
/// `out`'s points to the point of `src` it was made from. A face's source is the face of `src`
/// whose value it holds, which must run through its corners' sources; a corner's is that
/// face's corner at its own source; and an edge's the edge between its ends' sources (where
/// `src` still carries one).
fn carried(src: &Mesh, out: &Mesh, point: &dyn Fn(V3) -> u32) -> Vec<String> {
    use crate::attrs::Elements;
    let (e, o) = (Elements::of(src), Elements::of(out));
    let held =
        |m: &Mesh, name: &str, i: usize| m.typed.get(name).and_then(|a| a.values.get(i).copied());
    let from: Vec<u32> = o.poly.points.iter().map(|p| point(*p)).collect();
    let mut wrong = Vec::new();
    let mut check = |name: &str, i: usize, source: Option<usize>| {
        let want = source.and_then(|s| held(src, name, s));
        if held(out, name, i) != want || want.is_none() {
            wrong.push(format!(
                "{name} {i}: {:?}, not {want:?}",
                held(out, name, i)
            ));
        }
    };
    for (i, s) in from.iter().enumerate() {
        check("point", i, Some(*s as usize));
    }
    for (f, c) in o.poly.faces.iter().enumerate() {
        let sources: Vec<u32> = c.iter().map(|q| from[*q as usize]).collect();
        // Each source face holds its own index.
        let through = |s: &usize| sources.iter().all(|q| e.poly.faces[*s].contains(q));
        let face = held(out, "face", f)
            .map(|s| s as usize)
            .filter(|s| *s < e.poly.faces.len() && through(s));
        check("face", f, face);
        for (k, q) in sources.iter().enumerate() {
            let corner = face.and_then(|s| {
                let at = e.poly.faces[s].iter().position(|p| p == q)?;
                Some(e.starts()[s] as usize + at)
            });
            check("corner", o.starts()[f] as usize + k, corner);
        }
    }
    if src.typed.contains_key("edge") {
        let edges: Vec<(u32, u32)> = e.poly.edges().into_keys().collect();
        for (i, (a, b)) in o.poly.edges().into_keys().enumerate() {
            let ends = crate::poly::key(from[a as usize], from[b as usize]);
            check("edge", i, edges.iter().position(|s| *s == ends));
        }
    }
    wrong
}

/// The point of `m` nearest `p`.
fn nearest(m: &Mesh, p: V3) -> u32 {
    let points = crate::attrs::Elements::of(m).poly.points;
    let far = |q: &V3| crate::geom::length(sub(*q, p));
    (0..points.len())
        .min_by(|a, b| far(&points[*a]).total_cmp(&far(&points[*b])))
        .unwrap() as u32
}

#[test]
fn a_mirror_carries_every_attribute_from_the_element_it_copies() {
    let m = tagged();
    let mirror = json!([{"kind": "mod.mirror@1", "params": {"axes": ["x"]}}]);
    let out = run(m.clone(), mirror, 0.0);
    let source = |p: V3| nearest(&m, [p[0].abs(), p[1], p[2]]);
    assert_eq!(out.typed["edge"].values.len(), 24);
    assert_eq!(carried(&m, &out, &source), Vec::<String>::new());
}

#[test]
fn a_bevel_and_a_build_carry_points_faces_and_corners_and_refuse_an_edge_attribute() {
    let mut m = tagged();
    for step in [
        json!({"kind": "mod.bevel@1", "params": {"width": 0.1, "limit": "all"}}),
        json!({"kind": "mod.build@1", "params": {"from": 0.5}}),
    ] {
        // With its edge attribute the step has no rule, and says which.
        let item = json!({"modifiers": [step]});
        let refused = apply(m.clone(), &item, &json!({}), "it", 0.0, &Run::default()).unwrap_err();
        let kind = item["modifiers"][0]["kind"].as_str().unwrap();
        for name in [
            "attribute.no_rule",
            kind,
            r#""attribute":"edge""#,
            r#""domain":"edge""#,
            r#""type":"f32""#,
        ] {
            assert!(refused.contains(name), "{refused} names {name}");
        }
    }
    m.typed.remove("edge");
    let bevel = json!([{"kind": "mod.bevel@1", "params": {"width": 0.1, "limit": "all"}}]);
    let out = run(m.clone(), bevel, 0.0);
    assert!(out.positions.len() > m.positions.len());
    // A bevel's point is made from the old point it stands by.
    assert_eq!(carried(&m, &out, &|p| nearest(&m, p)), Vec::<String>::new());
    let half = run(
        m.clone(),
        json!([{"kind": "mod.build@1", "params": {"from": 0.5}}]),
        0.0,
    );
    assert_eq!(half.typed["face"].values.len(), 3);
    assert_eq!(
        carried(&m, &half, &|p| nearest(&m, p)),
        Vec::<String>::new()
    );
}

#[test]
fn a_solidify_fills_its_rim_from_its_sources_never_with_0() {
    let store = |name: &str, domain: &str, field: &str| json!({"kind": "mod.store@1", "params": {"name": name, "domain": domain, "field": field}});
    let stored = json!([
        store("w", "point", "position.x + 3 * position.z + 9"),
        store("f", "face", "index + 1"),
        store("c", "corner", "index + 1")
    ]);
    let open = run(plate(), stored, 0.0);
    let shell = json!([{"kind": "mod.solidify@1", "params": {"thickness": 0.1}}]);
    let out = run(open.clone(), shell, 0.0);
    let (vertices, tris) = (open.positions.len(), open.triangles());
    assert!(out.triangles() > 2 * tris);
    // Every vertex, the rim's too, holds the field where it stands over the plate.
    let w: Vec<f64> = out
        .positions
        .iter()
        .map(|p| p[0] + 3.0 * p[2] + 9.0)
        .collect();
    assert_eq!(out.attributes["w"], w);
    // Each rim triangle holds the value of the plate's triangle on its edge: the one through
    // both of the places its corners stand over.
    let over = |m: &Mesh, t: usize| -> Vec<[i64; 2]> {
        let place = |j: usize| {
            let p = m.positions[m.indices[3 * t + j] as usize];
            [(p[0] * 1e6).round() as i64, (p[2] * 1e6).round() as i64]
        };
        [0, 1, 2].map(place).to_vec()
    };
    let f = &out.face_attributes["f"];
    assert_eq!(f.len(), out.triangles());
    assert_eq!(f[..tris], f[tris..2 * tris]);
    for (t, held) in f.iter().enumerate().skip(2 * tris) {
        let source = (0..tris).find(|s| over(&out, t).iter().all(|q| over(&open, *s).contains(q)));
        assert_eq!(
            Some(*held),
            source.map(|s| open.face_attributes["f"][s]),
            "rim triangle {t}"
        );
    }
    assert_eq!(
        out.positions.len(),
        2 * vertices + 4 * (out.triangles() - 2 * tris) / 2
    );
    let corners = &out.typed["c"].values;
    assert_eq!(
        corners.len(),
        crate::attrs::Elements::of(&out).poly.corners()
    );
    assert!(corners.iter().all(|c| open.typed["c"].values.contains(c)));
}

#[test]
fn a_second_writer_of_a_name_on_another_domain_is_refused_naming_both() {
    // Every builder's mesh carries `height` on its points.
    let store = json!({"kind": "mod.store@1", "params": {"name": "height", "domain": "face", "field": "x"}});
    let item = json!({"modifiers": [store]});
    let refused = apply(box_mesh(), &item, &json!({}), "it", 0.0, &Run::default()).unwrap_err();
    for name in [
        "attribute.second_writer",
        r#""attribute":"height""#,
        r#""first":{"domain":"point","type":"f32"}"#,
        r#""second":{"domain":"face","type":"f32"}"#,
    ] {
        assert!(refused.contains(name), "{refused} names {name}");
    }
}

#[test]
fn a_vector_point_attribute_interpolates_through_a_subdivide() {
    let stored = json!([
        {"kind": "mod.store@1", "params": {"name": "at", "type": "vec3", "field": "position"}},
        {"kind": "mod.subdivide@1", "params": {"levels": 1, "scheme": "simple"}}
    ]);
    let out = run(box_mesh(), stored, 0.0);
    // A simple subdivide moves nothing, so each of the 26 points holds its own position.
    let points = crate::attrs::Elements::of(&out).poly.points;
    assert_eq!(points.len(), 26);
    assert_eq!(out.typed["at"].values, points.concat());
}

#[test]
fn a_store_on_a_part_with_no_earlier_store_leaves_the_others_at_0() {
    let store = json!([{"kind": "mod.store@1", "on": "top",
                        "params": {"name": "w", "type": "vec2", "field": "vec2(3, position.y + 4)"}}]);
    let out = run(box_mesh(), store, 0.0);
    let points = crate::attrs::Elements::of(&out).poly.points;
    let want: Vec<f64> = points
        .iter()
        .flat_map(|p| if p[1] > 0.5 { [3.0, 5.0] } else { [0.0, 0.0] })
        .collect();
    assert_eq!(out.typed["w"].values, want);
}
