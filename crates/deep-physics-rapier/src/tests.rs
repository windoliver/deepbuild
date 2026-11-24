use super::*;

/// A static 2 × 2 m height field of 3 × 3 samples, raised only at its (column 2, row 0)
/// corner, through the physics document and the backend interface.
#[test]
fn a_ray_down_meets_a_heightfield_on_its_shipped_split() {
    let mut heights = vec![0.0; 9];
    heights[2] = 1.0;
    let doc = json!({
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
        "gravity": [0, 0, 0], "mode": "dynamic",
        "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
        "backend": {"name": "rapier3d", "version": "=0.36.1"},
        "shapes": {"land": {"kind": "heightfield", "cols": 3, "rows": 3, "heights": heights, "scale": [2, 1, 2]}},
        "bodies": {"ground": {"kind": "static", "shapes": [{"shape": "land"}]}}
    });
    let w = deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let mut b = Rapier::default();
    b.build(&w).unwrap();
    let down = [0.0, -1.0, 0.0];
    // The raised cell's centre lies on the diagonal through its raised corner: 0.5 m.
    let k = b.ray([0.5, 2.0, -0.5], down, 10.0).unwrap();
    assert!((2.0 - k - 0.5).abs() < 1e-6, "{k}");
    assert!((2.0 - b.ray([-0.5, 2.0, 0.5], down, 10.0).unwrap()).abs() < 1e-6);
    assert_eq!(b.ray([5.0, 2.0, 0.0], down, 10.0), None);
}

/// #2240: a body that leaves its mass to its shapes still reads that mass, density × volume,
/// with its centre of mass written, so #523's mass-ratio check reads it as before.
#[test]
fn a_written_centre_of_mass_keeps_the_mass_the_shapes_give() {
    let body = |centre: Option<[f64; 3]>| {
        let mut b =
            json!({"kind": "dynamic", "shapes": [{"shape": "box", "contact_material": "m"}]});
        if let Some(c) = centre {
            b["centre_of_mass"] = json!(c);
        }
        b
    };
    let doc = json!({
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
        "gravity": [0, 0, 0], "mode": "dynamic",
        "capacity": {"bodies": 2, "shapes": 2, "joints": 0, "contacts": 0, "particles": 0},
        "backend": {"name": "rapier3d", "version": "=0.36.1"},
        "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 250}},
        "shapes": {"box": {"kind": "box", "half": [0.5, 1.0, 0.5]}},
        "bodies": {"bare": body(None), "low": body(Some([0.0, -0.75, 0.0]))}
    });
    let w = deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let mut b = Rapier::default();
    b.build(&w).unwrap();
    // 250 kg/m³ × 1 × 2 × 1 m, as f32 holds it.
    let bare = b.shapes_mass("bare").unwrap();
    assert!((bare - 500.0).abs() < 1e-3, "{bare}");
    assert_eq!(b.shapes_mass("low"), Some(bare));
}

/// #2240: the bounds the check holds a centre of mass to are those of the shapes as built: a
/// box turned by degrees about three axes, a capsule turned by a quaternion, a rounded hull
/// and a compound of a turned box and a turned cylinder, each at an offset.
#[test]
fn the_bounds_a_centre_of_mass_is_held_to_are_the_built_shapes() {
    let turned = [0.1, 0.2, 0.3, 0.9];
    let child = |shape: &str, pos: [f64; 3], rot: Value| json!({"shape": shape, "pose": {"pos": pos, "rot": rot}});
    let body = |shape: &str, pos: [f64; 3], rot: Value| json!({"kind": "dynamic", "shapes": [{"shape": shape, "contact_material": "m", "offset": {"pos": pos, "rot": rot}}]});
    let doc = json!({
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
        "gravity": [0, 0, 0], "mode": "dynamic",
        "capacity": {"bodies": 4, "shapes": 8, "joints": 0, "contacts": 0, "particles": 0},
        "backend": {"name": "rapier3d", "version": "=0.36.1"},
        "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 1000}},
        "shapes": {"box": {"kind": "box", "half": [0.5, 1.0, 0.25]},
                   "pill": {"kind": "capsule", "half_height": 0.6, "radius": 0.2},
                   "can": {"kind": "cylinder", "half_height": 0.7, "radius": 0.3},
                   "hull": {"kind": "convex", "points": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], "radius": 0.05},
                   "pair": {"kind": "compound", "children": [child("box", [1.0, 0.0, 0.0], json!([10, 20, 30])),
                                                             child("can", [0.0, 2.0, 0.0], json!(turned))]}},
        "bodies": {"a": body("box", [0.1, 0.2, 0.3], json!([30, 40, 50])),
                   "b": body("pill", [-0.3, 0.0, 0.2], json!(turned)),
                   "c": body("hull", [0.0, 0.5, 0.0], json!([0, 0, 75])),
                   "d": body("pair", [0.4, -0.1, 0.0], json!([0, 0, 0]))}
    });
    let w = deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let mut b = Rapier::default();
    b.build(&w).unwrap();
    for (id, h) in &b.bodies {
        let built = b.world.bodies[*h]
            .colliders()
            .iter()
            .map(|c| b.world.colliders[*c].compute_aabb())
            .reduce(|x, y| x.merged(&y))
            .unwrap();
        let (lo, hi) = deep_canvas_physics::doc::bounds(&w.shapes, &w.bodies[id].shapes).unwrap();
        for (read, built) in [(lo, built.mins), (hi, built.maxs)] {
            let off = (v3(read) - built).abs().max_element();
            assert!(off < 1e-5, "{id}: {read:?} at check, {built:?} built");
        }
    }
}
