//! #853: the lowered operators pass the operator check and, run on the CPU as the stepped
//! runtime runs them, do what the criteria name: particles ride and leave a moving floor, none
//! crosses a thin wall (the planted end test lets them), and grains kept apart fill a tray level,
//! one to a cell.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::*;
use crate::check::{self, Checked};
use crate::graph::{self, From, Sc};
use crate::interp::{self, Env, Val};
use crate::module::operator_of;

struct Run {
    ops: Vec<(String, Checked)>,
    held: BTreeMap<(String, String), Vec<f64>>,
    rate: f64,
    step: u32,
}

fn checked(items: &[(String, Value)]) -> Vec<(String, Checked)> {
    items
        .iter()
        .map(|(id, item)| {
            let op = graph::read(&operator_of(id, item).expect("an operator item"))
                .unwrap_or_else(|e| panic!("{id} reads: {e:?}"));
            (
                id.clone(),
                check::check(&op).unwrap_or_else(|e| panic!("{id} passes the check: {e:?}")),
            )
        })
        .collect()
}

impl Run {
    fn new(id: &str, s: &Spec, boxes: &[Collider], planted: Planted) -> Run {
        let ops = checked(&lower(id, s, boxes, seed_of(853, id), planted));
        Run {
            ops,
            held: BTreeMap::new(),
            rate: f64::from(s.rate),
            step: 0,
        }
    }

    /// One fixed step, as the runtime runs it: each operator in order, reading the buffer as the
    /// step before left it, its other outputs starting at their clear value.
    fn step(&mut self, id: &str, channels: &BTreeMap<String, Value>) -> Vec<f64> {
        let key = (id.to_string(), BUFFER.to_string());
        let prev = self.held.get(&key).cloned();
        for (op, c) in &self.ops {
            let mut inputs = interp::inputs(c, channels, &BTreeMap::new());
            let mut storage = BTreeMap::new();
            for (name, input) in &c.op.inputs {
                match &input.from {
                    From::Step => {
                        inputs.insert(name.clone(), Val::N(Sc::U32, vec![f64::from(self.step)]));
                    }
                    From::Storage {
                        op,
                        output,
                        previous,
                    } => {
                        let words = match previous {
                            true => prev.clone(),
                            false => self.held.get(&(op.clone(), output.clone())).cloned(),
                        };
                        let count = match input.ty {
                            graph::Ty::Storage(_, n) => n as usize,
                            _ => 0,
                        };
                        storage.insert(name.clone(), words.unwrap_or_else(|| vec![0.0; count]));
                    }
                    _ => {}
                }
            }
            for (name, out) in c.op.storage.iter().filter(|(_, o)| o.clear != 0) {
                storage.insert(name.clone(), vec![f64::from(out.clear); out.count as usize]);
            }
            let env = Env {
                t: f64::from(self.step) / self.rate,
                seed: 0,
                clip: [0.0; 16],
                inverse_clip: [0.0; 16],
                eye: [0.0; 4],
                inputs,
                textures: BTreeMap::new(),
                normals: [[0.0; 3]; 3],
            };
            for (name, words) in
                interp::compute(c, &env, storage).unwrap_or_else(|e| panic!("{op} runs: {e}"))
            {
                self.held.insert((op.clone(), name), words);
            }
        }
        self.step += 1;
        self.held[&key].clone()
    }
}

fn spec(count: u32, extra: Value) -> Spec {
    let mut params =
        json!({"count": count, "step_rate": 60, "forces": {"gravity": [0.0, -9.81, 0.0]}});
    for (k, v) in extra.as_object().expect("fields") {
        params[k] = v.clone();
    }
    let at = params["at"].take();
    let doc = json!({"budget": {"class": "showpiece"}});
    read(
        &doc,
        "p",
        &json!({"kind": "particles.stepped@1", "at": {"pos": at}, "params": params}),
    )
    .expect("the fixture reads")
}

fn fixed(centre: [f64; 3], half: [f64; 3]) -> Collider {
    Collider {
        centre,
        half,
        follow: None,
    }
}

fn tray(half: f64, wall: f64, high: f64) -> Vec<Collider> {
    let (outer, side) = (half + wall, half + wall / 2.0);
    vec![
        fixed([0.0, -0.1, 0.0], [outer, 0.1, outer]),
        fixed([side, high / 2.0, 0.0], [wall / 2.0, high / 2.0, outer]),
        fixed([-side, high / 2.0, 0.0], [wall / 2.0, high / 2.0, outer]),
        fixed([0.0, high / 2.0, -side], [outer, high / 2.0, wall / 2.0]),
        fixed([0.0, high / 2.0, side], [outer, high / 2.0, wall / 2.0]),
    ]
}

#[test]
fn the_pour_and_the_flood_lower_to_operators_that_pass_the_check_within_eight_fetches() {
    for (count, d, half, emit) in [
        (100_000u32, 0.02, 0.4, 50_000.0),
        (1_000_000, 0.01, 1.0, 500_000.0),
    ] {
        let s = spec(
            count,
            json!({"at": [0.0, 1.8, 0.0], "spacing": d, "collide": {"world": "pit"},
            "emit": {"shape": {"box": {"size": [0.6, 0.1, 0.6]}}, "rate": emit, "span": 2, "velocity": [0.0, -3.0, 0.0]},
            "readings": {"in": {"count": {"box": [[0, 0, 0], [1, 1, 1]]}}}}),
        );
        let boxes = tray(half, 0.2, 2.2);
        assert_eq!(fits("p", &s, &boxes), None);
        let ops = checked(&lower("p", &s, &boxes, 7, Planted::default()));
        let ids: Vec<&str> = ops.iter().map(|o| o.0.as_str()).collect();
        assert_eq!(
            ids,
            [
                "p.top",
                "p.ground",
                "p.move",
                "p.plan",
                "p",
                "p.readings",
                "p-rows"
            ]
        );
        for (id, c) in &ops {
            assert!(c.fetches <= 8, "{id} reads {} values an element", c.fetches);
        }
        let buffer = &ops[4].1;
        let carried = &buffer.op.storage[BUFFER];
        assert_eq!(
            (carried.count, carried.carry.is_some()),
            (count * STRIDE, true)
        );
        assert_eq!(
            buffer.class,
            graph::Class::SameMachine,
            "the buffer's class"
        );
    }
}

#[test]
fn particles_at_rest_on_a_floor_rise_with_it_at_the_step_it_moves_and_leave_it_when_it_stops() {
    // The floor's top is y = 0 until step 60, rises 0.02 m a step to 1.2 m at step 120, and stops.
    let top = |k: u32| 0.02 * f64::from(k.clamp(60, 120) - 60);
    let s = spec(
        64,
        json!({"at": [0.0, 0.01, 0.0], "emit": {"shape": {"box": {"size": [1, 0, 1]}}, "bursts": [{"t": 0, "count": 64}]}, "collide": {"world": "stage"}}),
    );
    let lift = Collider {
        centre: [0.0, -0.1, 0.0],
        half: [1.0, 0.1, 1.0],
        follow: Some("items/lift/at/pos".into()),
    };
    let mut run = Run::new("p", &s, &[lift], Planted::default());
    let mut rise = vec![f64::NEG_INFINITY; 64];
    for k in 0..=150u32 {
        let pose = [0.0, top(k) - 0.1, 0.0];
        let channels = (0..3)
            .map(|a| (format!("items/lift/at/pos/{a}"), json!(pose[a])))
            .collect();
        let w = run.step("p", &channels);
        for i in 0..64usize {
            let (y, age) = (w[7 * i + 1], w[7 * i + 6]);
            assert!(age >= 0.0, "particle {i} is live at step {k}");
            if (50..=60).contains(&k) {
                assert!(
                    (y - top(k)).abs() <= 0.005,
                    "at step {k} particle {i} rests on the floor: y = {y}"
                );
            }
            if k > 60 {
                assert!(
                    y >= top(k) - 0.005,
                    "at step {k} particle {i} is at {y}, under the floor at {}",
                    top(k)
                );
            }
            if k > 120 {
                rise[i] = rise[i].max(y - top(120));
            }
        }
    }
    let least = 1.2 * 1.2 / (2.0 * 9.81) / 2.0;
    assert!(
        rise.iter().all(|r| *r >= least),
        "each particle leaves the stopped floor at its speed: {rise:?}"
    );
}

/// The corridor: particles at 24 m/s toward two walls 2 cm thick; how many end past a far face.
fn through_the_walls(planted: Planted) -> usize {
    let s = spec(
        64,
        json!({"at": [0.0, 0.0, 0.0], "forces": {"gravity": [0, 0, 0]}, "collide": {"world": "room"},
        "emit": {"shape": {"box": {"size": [1, 1, 1]}}, "bursts": [{"t": 0, "count": 64}], "velocity": [24, 0, 0]}}),
    );
    let walls = [
        fixed([3.01, 0.0, 0.0], [0.01, 2.0, 2.0]),
        fixed([-3.01, 0.0, 0.0], [0.01, 2.0, 2.0]),
    ];
    let mut run = Run::new("p", &s, &walls, planted);
    let mut past = std::collections::BTreeSet::new();
    let mut before = Vec::new();
    for k in 0..=120u32 {
        let w = run.step("p", &BTreeMap::new());
        if k == 2 {
            assert!(
                (0..64).all(|i| w[7 * i] - before[7 * i] >= 0.39),
                "each particle moves 0.4 m a step"
            );
        }
        past.extend((0..64usize).filter(|i| w[7 * i].abs() > 3.02));
        before = w;
    }
    past.len()
}

#[test]
fn no_fast_particle_passes_a_thin_wall_and_the_planted_end_test_lets_them_through() {
    assert_eq!(through_the_walls(Planted::default()), 0);
    let planted = Planted {
        collide_at_end: true,
        ..Default::default()
    };
    assert!(
        through_the_walls(planted) > 32,
        "a step that tests only where it ends lets most of them tunnel"
    );
}

#[test]
fn grains_kept_apart_fill_a_tray_level_one_to_a_cell_and_come_to_rest() {
    // 600 grains 2 cm apart into a tray 0.2 m square: 100 columns, so a level bed is 6 high.
    let s = spec(
        600,
        json!({"at": [0.0, 0.5, 0.0], "spacing": 0.02, "collide": {"world": "pit"},
        "emit": {"shape": {"box": {"size": [0.14, 0.04, 0.14]}}, "rate": 600, "span": 1, "velocity": [0.0, -1.0, 0.0]}}),
    );
    let boxes = tray(0.1, 0.1, 0.8);
    let mut run = Run::new("p", &s, &boxes, Planted::default());
    let mut w = Vec::new();
    let mut half = 0;
    for k in 0..=200u32 {
        w = run.step("p", &BTreeMap::new());
        if k == 30 {
            half = (0..600).filter(|i| w[7 * i + 6] >= 0.0).count();
        }
    }
    assert!(
        (240..=360).contains(&half),
        "about half are poured half way: {half}"
    );
    let mut tops = BTreeMap::new();
    let mut cells = std::collections::BTreeSet::new();
    for i in 0..600usize {
        let (x, y, z) = (w[7 * i], w[7 * i + 1], w[7 * i + 2]);
        assert!(
            w[7 * i + 6] >= 0.0 && w[7 * i + 3..7 * i + 6] == [0.0; 3],
            "grain {i} is live and at rest"
        );
        assert!(
            y > 0.0 && x.abs() < 0.1 && z.abs() < 0.1,
            "grain {i} is in the tray: ({x}, {y}, {z})"
        );
        let column = (
            ((x + 0.1) / 0.02).floor() as i64,
            ((z + 0.1) / 0.02).floor() as i64,
        );
        assert!(
            cells.insert((column, (y / 0.02).floor() as i64)),
            "grain {i} has its cell to itself: ({x}, {y}, {z})"
        );
        let top: &mut f64 = tops.entry(column).or_insert(0.0);
        *top = top.max(y);
    }
    let (low, high) = tops
        .values()
        .fold((f64::MAX, 0.0f64), |(l, h), y| (l.min(*y), h.max(*y)));
    assert_eq!(tops.len(), 100, "every column holds grains");
    assert!(
        high - low <= 0.0801 && low >= 0.05,
        "the bed is level within four cells: {low} to {high}"
    );
}

#[test]
fn a_reading_counts_the_live_particles_inside_its_box_after_the_step() {
    let s = spec(
        64,
        json!({"at": [0.0, 2.5, 0.0], "emit": {"shape": {"box": {"size": [0.5, 1, 0.5]}}, "bursts": [{"t": 0, "count": 64}]},
        "readings": {"in_gate": {"count": {"box": [[0, 0, -1], [1, 1.9, 1]]}}}}),
    );
    let mut run = Run::new("p", &s, &[], Planted::default());
    let mut seen = Vec::new();
    for _ in 0..60 {
        let w = run.step("p", &BTreeMap::new());
        let inside = (0..64usize)
            .filter(|i| {
                w[7 * i] >= 0.0 && w[7 * i] <= 1.0 && w[7 * i + 1] >= 0.0 && w[7 * i + 1] <= 1.9
            })
            .count();
        let words = &run.held[&(readings_op("p"), COUNTS.to_string())];
        assert_eq!(words[..], [inside as f64, 0.0, 0.0, 0.0]);
        seen.push(inside);
    }
    assert!(
        seen[0] == 0 && seen[59] == 0 && (20..=44).contains(&seen[33]),
        "the drops fall through the gate: {seen:?}"
    );
}

#[test]
fn a_rate_with_no_whole_flick_step_and_a_count_past_the_cap_are_refused_naming_the_field() {
    let doc = json!({});
    let item = |params: Value| json!({"kind": "particles.stepped@1", "params": params});
    let r = read(&doc, "p", &item(json!({"count": 8, "step_rate": 85}))).expect_err("85 Hz");
    assert_eq!(
        (r.code, r.path.as_str()),
        ("bad_rate", "items/p/params/step_rate")
    );
    let r = read(&doc, "p", &item(json!({"count": 65_537}))).expect_err("past a figure's cap");
    assert_eq!(
        (r.path.as_str(), &r.actual["cap"]),
        ("items/p/params/count", &json!(65_536))
    );
}

/// 16 particles born at step 0 in a box 0.2 m across at `at`, with no gravity unless `extra` says.
fn cloud(at: [f64; 3], extra: Value) -> Spec {
    let mut fields = json!({"at": at, "forces": {"gravity": [0, 0, 0]},
        "emit": {"shape": {"box": {"size": [0.2, 0.2, 0.2]}}, "bursts": [{"t": 0, "count": 16}]}});
    for (k, v) in extra.as_object().expect("fields") {
        match (fields[k].as_object_mut(), v.as_object()) {
            (Some(into), Some(from)) => into.extend(from.clone()),
            _ => fields[k] = v.clone(),
        }
    }
    spec(16, fields)
}

fn run_of(s: &Spec, steps: u32) -> Vec<Vec<f64>> {
    let mut run = Run::new("p", s, &[], Planted::default());
    (0..steps)
        .map(|_| run.step("p", &BTreeMap::new()))
        .collect()
}

#[test]
fn an_attractor_pulls_each_particle_toward_its_point_and_none_moves_without_one() {
    // The squared distance to the attractor's point.
    let far = |w: &[f64], i: usize| {
        let d = [w[7 * i] - 2.0, w[7 * i + 1], w[7 * i + 2]];
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    };
    let pulled = run_of(
        &cloud(
            [0.0; 3],
            json!({"forces": {"attractors": [{"at": [2, 0, 0], "strength": 4}]}}),
        ),
        30,
    );
    let still = run_of(&cloud([0.0; 3], json!({})), 30);
    for i in 0..16 {
        assert!(
            far(&pulled[29], i) < far(&pulled[0], i) - 0.3,
            "particle {i} nears the attractor"
        );
        assert_eq!(
            far(&still[29], i),
            far(&still[0], i),
            "particle {i} stays where no force is"
        );
    }
}

#[test]
fn a_declared_plane_keeps_falling_particles_above_it_and_turns_them_back() {
    let s = cloud(
        [0.0, 0.5, 0.0],
        json!({"forces": {"gravity": [0.0, -9.81, 0.0]},
        "collide": {"planes": [{"normal": [0, 1, 0], "offset": 0}], "restitution": 0.5}}),
    );
    let states = run_of(&s, 60);
    let mut rose = [false; 16];
    for (k, w) in states.iter().enumerate().skip(1) {
        for i in 0..16 {
            assert!(
                w[7 * i + 1] >= 0.0,
                "at step {k} particle {i} is at y = {}, under the plane",
                w[7 * i + 1]
            );
            rose[i] |= w[7 * i + 4] > 0.5 && states[k - 1][7 * i + 4] < 0.0;
        }
    }
    assert!(
        rose.iter().all(|r| *r),
        "each particle leaves the plane upward: {rose:?}"
    );
    let open = run_of(
        &cloud(
            [0.0, 0.5, 0.0],
            json!({"forces": {"gravity": [0.0, -9.81, 0.0]}}),
        ),
        60,
    );
    assert!(
        (0..16).all(|i| open[59][7 * i + 1] < -1.0),
        "with no plane they fall past y = 0"
    );
}

#[test]
fn an_attribute_is_a_word_of_each_particle_hashed_in_its_range_and_carried() {
    let s = cloud([0.0; 3], json!({"attributes": {"heat": [2, 3], "mass": 5}}));
    assert_eq!(s.stride(), 9);
    let states = run_of(&s, 3);
    let heat: Vec<f64> = (0..16).map(|i| states[2][9 * i + 7]).collect();
    assert!(
        heat.iter().all(|h| (2.0..=3.0).contains(h)),
        "each heat is in its range: {heat:?}"
    );
    assert!(
        heat.iter().any(|h| *h != heat[0]),
        "the particles differ in heat"
    );
    assert!((0..16).all(|i| states[2][9 * i + 8] == 5.0 && states[0][9 * i + 7] == heat[i]));
}

#[test]
fn a_centroid_reading_is_the_mean_place_of_the_live_particles_inside_its_box() {
    let s = cloud(
        [0.5, 0.5, 0.5],
        json!({"readings": {"mid": {"centroid": {"box": [[0, 0, 0], [1, 1, 2]]}}}}),
    );
    let mut run = Run::new("p", &s, &[], Planted::default());
    let w = run.step("p", &BTreeMap::new());
    let words = run.held[&(readings_op("p"), COUNTS.to_string())].clone();
    assert_eq!(words[0], 16.0, "every particle is inside the box");
    let words: Vec<u32> = words.iter().map(|x| *x as u32).collect();
    let read = s.readings[0].centre(&words);
    for (a, size) in [1.0, 1.0, 2.0].iter().enumerate() {
        let mean = (0..16).map(|i| w[7 * i + a]).sum::<f64>() / 16.0;
        assert!(
            (read[a] - mean).abs() <= size / 4095.0,
            "axis {a}: read {}, the mean {mean}",
            read[a]
        );
    }
    assert_eq!(
        s.readings[0].centre(&[0; 4]),
        [0.5, 0.5, 1.0],
        "the box's middle when it is empty"
    );
}

#[test]
fn an_occurrence_kills_the_particles_within_its_radius_at_its_step_and_they_stay_dead() {
    let mut s = cloud([0.0; 3], json!({"kill": {"radius": 1}}));
    s.deaths = vec![Event {
        t: 0.25,
        point: [0.0; 3],
        count: 0,
    }];
    let near = run_of(&s, 30);
    assert!(
        (0..16).all(|i| near[14][7 * i + 6] >= 0.0),
        "all live before 0.25 s (step 15)"
    );
    assert!((0..16).all(|i| near[15][7 * i + 6] == -2.0 && near[29][7 * i + 6] == -2.0));
    s.deaths[0].point = [5.0, 0.0, 0.0];
    assert!(
        (0..16).all(|i| run_of(&s, 30)[29][7 * i + 6] >= 0.0),
        "none dies 5 m from it"
    );
}

#[test]
fn an_occurrence_list_gives_births_at_each_row_s_time_and_point() {
    let doc = json!({"budget": {"class": "showpiece"}, "occurrences": {"pit.occurrences": [
        {"t": 705_600_000u64 / 2, "kind": "contact", "a": 1, "b": 2, "point": [3, 0, 0], "speed": 1},
        {"t": 705_600_000u64, "kind": "sleep", "a": 3, "b": 4, "point": [9, 9, 9], "speed": 1},
    ]}});
    let item = json!({"kind": "particles.stepped@1", "params": {"count": 8, "forces": {"gravity": [0, 0, 0]},
        "emit": {"on": {"list": "pit.occurrences", "kinds": ["contact"], "count": "5"}}}});
    let s = read(&doc, "p", &item).expect("it reads");
    assert_eq!(
        s.births,
        [Event {
            t: 0.5,
            point: [3.0, 0.0, 0.0],
            count: 5
        }]
    );
    let states = run_of(&s, 40);
    let live = |k: usize| (0..8).filter(|i| states[k][7 * i + 6] >= 0.0).count();
    assert_eq!(
        (live(29), live(30), live(39)),
        (0, 5, 5),
        "five are born at 0.5 s, step 30"
    );
    assert!(
        (0..5).all(|i| states[30][7 * i..7 * i + 3] == [3.0, 0.0, 0.0]),
        "at the row's point"
    );
    let unbaked = json!({"budget": {"class": "showpiece"}});
    assert_eq!(
        read(&unbaked, "p", &item).expect_err("no list").code,
        "unbaked_list"
    );
}

#[test]
fn turbulence_drifts_each_particle_along_the_closed_form_s_table_within_its_strength() {
    let s = cloud(
        [0.0; 3],
        json!({"forces": {"turbulence": {"strength": 0.5, "travel": 1}}}),
    );
    let states = run_of(&s, 90);
    let moved = |k: usize, i: usize| {
        let d: Vec<f64> = (0..3)
            .map(|a| states[k][7 * i + a] - states[0][7 * i + a])
            .collect();
        deep_canvas::ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
    };
    let most = |i: usize| (1..60).map(|k| moved(k, i)).fold(0.0, f64::max);
    assert!((0..16).any(|i| most(i) > 0.2), "the table moves them");
    for i in 0..16 {
        // A step and a table segment don't end together, so the bound has a step's slack.
        assert!(
            most(i) <= 0.6,
            "particle {i} wanders {} m, past its strength",
            most(i)
        );
        assert_eq!(
            moved(89, i),
            moved(61, i),
            "particle {i} holds past the table's travel"
        );
    }
}

#[test]
fn an_item_with_every_field_at_its_most_lowers_to_operators_that_pass_the_check() {
    // The runtime leaves out an operator that fails the check, so each must pass at the caps:
    // 16 timed births, 4 attractors, turbulence, 6 planes, 16 deaths, 4 attributes, 8 readings,
    // and 16 boxes, two of them kinematic.
    for spacing in [json!(null), json!(0.05)] {
        let readings: serde_json::Map<String, Value> = (0..MAX_READINGS)
            .map(|r| {
                (
                    format!("r{r}"),
                    json!({"centroid": {"box": [[0, 0, 0], [1, 1, 1]]}}),
                )
            })
            .collect();
        let planes: Vec<Value> = (0..MAX_PLANES)
            .map(|p| json!({"normal": [0, 1, 0], "offset": -(p as f64)}))
            .collect();
        let mut s = spec(
            4096,
            json!({"at": [0.0, 1.0, 0.0], "spacing": spacing, "life": 30,
            "emit": {"shape": {"box": {"size": [0.5, 0.1, 0.5]}}, "rate": 100, "span": 2,
                     "bursts": vec![json!({"t": 0, "count": 8}); 8]},
            "forces": {"gravity": [0.0, -9.81, 0.0], "drag": 0.1, "turbulence": {"strength": 0.2},
                       "attractors": vec![json!({"at": [1, 0, 0], "strength": 1}); MAX_ATTRACTORS]},
            "collide": {"world": "pit", "planes": planes, "restitution": 0.3},
            "attributes": {"a": 1, "b": [0, 1], "c": [2, 3], "d": 4},
            "kill": {"radius": 0.5}, "readings": readings}),
        );
        let event = Event {
            t: 0.5,
            point: [0.0; 3],
            count: 4,
        };
        (s.births, s.deaths) = (vec![event; 8], vec![event; MAX_EVENTS]);
        let mut boxes: Vec<Collider> = (0..MAX_BOXES)
            .map(|b| fixed([b as f64, -0.1, 0.0], [0.5, 0.1, 0.5]))
            .collect();
        boxes[0].follow = Some("items/a/at/pos".into());
        boxes[1].follow = Some("items/b/at/pos".into());
        assert_eq!(fits("p", &s, &boxes), None);
        let ops = checked(&lower("p", &s, &boxes, 7, Planted::default()));
        assert_eq!(ops.len(), if spacing.is_null() { 3 } else { 7 });
        assert!(ops.iter().all(|(_, c)| c.fetches <= 8));
    }
}
