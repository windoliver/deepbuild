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
