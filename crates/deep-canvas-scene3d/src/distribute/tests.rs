use super::*;

const I: Affine3 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
];

/// A flat plate `x` × `z` m at y 0, centred on the origin, facing +Y.
fn plate(x: f64, z: f64) -> Vec<Tri> {
    let c = [
        [-x / 2.0, 0.0, -z / 2.0],
        [x / 2.0, 0.0, -z / 2.0],
        [-x / 2.0, 0.0, z / 2.0],
        [x / 2.0, 0.0, z / 2.0],
    ];
    [[c[0], c[3], c[1]], [c[0], c[2], c[3]]]
        .into_iter()
        .filter_map(Tri::new)
        .collect()
}

fn scene(on: Vec<Tri>) -> Scene<'static> {
    Scene {
        on,
        avoid: Vec::new(),
        project: Vec::new(),
        protos: vec![[[-0.05; 3], [0.05; 3]]],
        world: I,
        id: "stones",
        planted: None,
    }
}

fn least(rows: &[Row]) -> f64 {
    let mut d = f64::INFINITY;
    for (i, a) in rows.iter().enumerate() {
        for b in &rows[i + 1..] {
            d = d.min(length(sub(a.pos, b.pos)));
        }
    }
    d
}

/// The furthest any point of a 0.05 m lattice over the plate's inner square lies from a row.
fn widest_gap(rows: &[Row], half: f64) -> f64 {
    let n = (2.0 * half / 0.05) as i64;
    let mut worst: f64 = 0.0;
    for i in 0..=n {
        for j in 0..=n {
            let (x, z) = (-half + i as f64 * 0.05, -half + j as f64 * 0.05);
            let near = rows
                .iter()
                .map(|r| length(sub(r.pos, [x, 0.0, z])))
                .fold(f64::INFINITY, f64::min);
            worst = worst.max(near);
        }
    }
    worst
}

#[test]
fn poisson_keeps_its_distance_and_leaves_no_room_and_is_the_same_twice() {
    let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013});
    let rows_a = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
    assert!(least(&rows_a) >= 0.5, "{}", least(&rows_a));
    // Maximal to within the fill lattice: no point of the plate is 0.64 m from every element.
    assert!(
        widest_gap(&rows_a, 4.5) < 0.5 * 1.28,
        "{}",
        widest_gap(&rows_a, 4.5)
    );
    assert!(rows_a.len() > 250, "{}", rows_a.len());
    assert_eq!(rows_a, rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap());
    // The seed is the scatter's: another instancer with it lays out the same points.
    let mut other = scene(plate(10.0, 10.0));
    other.id = "pebbles";
    assert_eq!(rows_a, rows(&d, "p", &other).unwrap());
    // The planted sampler stops after 10 points, which leave most of the plate empty.
    let mut planted = scene(plate(10.0, 10.0));
    planted.planted = Some(STOPS_AFTER_10);
    let few = rows(&d, "p", &planted).unwrap();
    assert_eq!(few.len(), 10);
    assert!(least(&few) >= 0.5 && widest_gap(&few, 4.5) > 1.0);
}

#[test]
fn a_density_field_thins_and_a_max_caps() {
    let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "density": "max(sign(position.x), 0)"});
    let right = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
    assert!(right.len() > 100 && right.iter().all(|r| r.pos[0] > 0.0));
    let half = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "density": 0.5});
    let all = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013});
    let (thinned, full) = (
        rows(&half, "p", &scene(plate(10.0, 10.0))).unwrap(),
        rows(&all, "p", &scene(plate(10.0, 10.0))).unwrap(),
    );
    // A thinned scatter is some of the same elements, by ID.
    assert!(
        thinned.len() * 10 > full.len() * 3 && thinned.len() * 10 < full.len() * 7,
        "{} of {}",
        thinned.len(),
        full.len()
    );
    assert!(thinned
        .iter()
        .all(|t| full.iter().any(|f| f.id == t.id && f.pos == t.pos)));
    let capped =
        json!({"on": "plate", "mode": "poisson", "min_distance": 0.08, "seed": 2013, "max": 50});
    assert_eq!(
        rows(&capped, "p", &scene(plate(1.0, 1.0))).unwrap().len(),
        50
    );
}

#[test]
fn elimination_spreads_its_points_at_least_the_minimum_distance_apart() {
    let d = json!({"on": "plate", "mode": "elimination", "min_distance": 0.5, "seed": 7});
    let got = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
    assert!(least(&got) >= 0.5, "{}", least(&got));
    // 0.65 × area ÷ distance², less what the distance rule took.
    assert!(got.len() <= 260 && got.len() > 200, "{}", got.len());
    assert_eq!(got, rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap());
    let ids: Vec<u32> = got.iter().map(|r| r.id).collect();
    assert!(ids.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn a_grid_and_a_random_scatter_fill_by_spacing_inside_the_margin() {
    let grid = json!({"on": "plate", "mode": "grid", "spacing": 1.0, "margin": 0.75});
    let got = rows(&grid, "p", &scene(plate(10.0, 10.0))).unwrap();
    // Lattice points from −4 to 4 on both axes: the rows at ±5 lie inside the margin.
    assert_eq!(got.len(), 81);
    assert!(got
        .iter()
        .all(|r| r.pos[0].abs() <= 4.0 && r.pos[2].abs() <= 4.0 && r.pos[0].fract() == 0.0));
    let random = json!({"on": "plate", "mode": "random", "spacing": 1.0, "seed": 3});
    assert_eq!(
        rows(&random, "p", &scene(plate(10.0, 10.0))).unwrap().len(),
        100
    );
}

#[test]
fn pruning_leaves_no_two_bounds_passing_into_each_other() {
    let mut s = scene(plate(10.0, 10.0));
    s.protos = vec![[[-0.6; 3], [0.6; 3]], [[-0.15; 3], [0.15; 3]]];
    let field = |prune: &str| json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "prune": prune});
    let overlaps = |rows: &[Row]| {
        let b: Vec<[V3; 2]> = rows.iter().map(|r| bounds_of(r, &s.protos)).collect();
        let mut n = 0;
        for i in 0..b.len() {
            for j in i + 1..b.len() {
                n +=
                    usize::from((0..3).all(|k| b[i][0][k] < b[j][1][k] && b[j][0][k] < b[i][1][k]));
            }
        }
        n
    };
    let loose = rows(&field("none"), "p", &s).unwrap();
    assert!(overlaps(&loose) > 0);
    let count = |rows: &[Row], proto: usize| rows.iter().filter(|r| r.proto == proto).count();
    let larger = rows(&field("larger_first"), "p", &s).unwrap();
    let smaller = rows(&field("smaller_first"), "p", &s).unwrap();
    let equal = rows(&field("equal"), "p", &s).unwrap();
    for kept in [&larger, &smaller, &equal] {
        assert_eq!(overlaps(kept), 0);
        assert!(kept.len() > 20 && kept.iter().all(|k| loose.contains(k)));
    }
    // Larger first keeps more of the large prototype, smaller first more of the small.
    assert!(count(&larger, 0) > count(&smaller, 0) && count(&smaller, 1) > count(&larger, 1));
}

#[test]
fn avoid_keeps_points_off_a_shape_and_project_drops_them_onto_one() {
    let mut s = scene(plate(10.0, 10.0));
    s.avoid = vec![Shape::Obb {
        c: [2.0, 0.0, 0.0],
        axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        half: [1.0, 0.1, 5.0],
    }];
    // A ramp under the plate: its top falls from y −1 at x −5 to y −3 at x 5.
    let (c, sn) = (cos(rad(-11.309932474020215)), sin(rad(-11.309932474020215)));
    s.project = vec![Shape::Obb {
        c: [0.0, -2.0, 0.0],
        axes: [[c, sn, 0.0], [-sn, c, 0.0], [0.0, 0.0, 1.0]],
        half: [20.0, 0.0, 20.0],
    }];
    let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 1, "avoid": ["path"], "project": {"to": "ramp", "align": "normal"}});
    let got = rows(&d, "p", &s).unwrap();
    assert!(got.len() > 100);
    for r in &got {
        assert!(!(1.0..=3.0).contains(&r.pos[0]), "{:?}", r.pos);
        assert!(
            (r.pos[1] - (-2.0 - 0.2 * r.pos[0])).abs() < 1e-9,
            "{:?}",
            r.pos
        );
        // Its up is the ramp's normal.
        let up = r.turn.map(|m| [m[0][1], m[1][1], m[2][1]]).unwrap();
        assert!(length(sub(up, [-sn, c, 0.0])) < 1e-9, "{up:?}");
    }
}

#[test]
fn a_field_out_of_range_or_unknown_is_refused_by_its_path() {
    let s = scene(plate(1.0, 1.0));
    for (d, code, at) in [
        (
            json!({"on": "plate", "mode": "spiral", "min_distance": 0.5}),
            "out_of_range",
            "p/mode",
        ),
        (
            json!({"on": "plate", "mode": "poisson"}),
            "out_of_range",
            "p/min_distance",
        ),
        (
            json!({"on": "plate", "mode": "grid"}),
            "out_of_range",
            "p/spacing",
        ),
        (
            json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "max": 100_001}),
            "out_of_range",
            "p/max",
        ),
        (
            json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "density": "position.x + t"}),
            "out_of_range",
            "p/density",
        ),
        (
            json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "rows": 3}),
            "unknown_field",
            "p/rows",
        ),
    ] {
        let r = rows(&d, "p", &s).unwrap_err();
        assert_eq!((r.code, r.path.as_str()), (code, at));
    }
}
