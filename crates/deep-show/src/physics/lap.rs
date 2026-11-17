//! #251: the vehicle body's course in the conformance kit (#138; tests/acceptance/251/README.md:
//! the course in the conformance kit). A second stepper carries the course, a kart settled at the
//! origin of level ground with four posts, as the backend's whole-world checkpoint, its vehicle
//! state with it; its fixture `parity/physics/vehicle-lap.board` runs the lap's opening 4.5 s,
//! its drive and its first two steers, so `carried_state` seeks it from each checkpoint and
//! `late_entry` brings each entry late, against the straight run. (Each kit step loads and
//! checkpoints the whole world, and `late_entry` replays each entry eight ways; the whole lap's
//! twelve entries over 1,200 steps cost ten times as much for no part a shorter run leaves out.)

use deep_canvas::registry::{Registrar, StepInput, Stepper};
use serde_json::{json, Value};

use super::kit::{built_from, load_in, state_of, step_on};

/// The steps whose checkpoints the course keeps: the state before each runs, every second; and
/// the steps the kit runs it.
const EVERY: i64 = 120;
const STEPS: i64 = 540;

/// The course: level ground, four posts at (±90, ±90) and the kart, settled at the origin heading
/// +Z: a 1,000 kg chassis on four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track,
/// on 2 Hz springs, front wheels steering, rear wheels driving; its drive, steer and brake
/// derived from the logic item `driver`.
fn course() -> Value {
    let wheel = |x: f64, z: f64, front: bool| {
        json!({"at": [x, -0.15, z], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2, "damping_ratio": 0.3},
               "steers": front, "drives": !front})
    };
    let post = |x: f64, z: f64| json!({"kind": "static", "shapes": [{"shape": "post", "contact_material": "ground"}], "pose": {"pos": [x, 1, z]}});
    let sag = 9.81 / (4.0 * std::f64::consts::PI).powi(2);
    let input = |kind: &str| json!({"kind": kind, "targets": ["kart"], "on": {"logic": "driver"}});
    json!({"kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4, "gravity": [0, -9.81, 0],
           "mode": "dynamic", "capacity": {"bodies": 8, "shapes": 8, "joints": 0, "contacts": 64, "particles": 0},
           "contact_materials": {"ground": {"friction": 0.8, "restitution": 0, "density": 1000},
                                 "shell": {"friction": 0.3, "restitution": 0, "density": 100}},
           "shapes": {"ground": {"kind": "box", "half": [100, 0.5, 100]}, "chassis": {"kind": "box", "half": [0.8, 0.15, 1.5]},
                      "post": {"kind": "box", "half": [0.5, 1, 0.5]}},
           "bodies": {"ground": {"kind": "static", "shapes": [{"shape": "ground", "contact_material": "ground"}], "pose": {"pos": [0, -0.5, 0]}},
                      "post_ne": post(90.0, 90.0), "post_nw": post(-90.0, 90.0), "post_se": post(90.0, -90.0), "post_sw": post(-90.0, -90.0),
                      "kart": {"kind": "vehicle", "shapes": [{"shape": "chassis", "contact_material": "shell"}], "mass": 1000,
                               "sleep": false, "pose": {"pos": [0, 0.75 - sag, 0]},
                               "vehicle": {"wheels": {"fl": wheel(0.8, 1.25, true), "fr": wheel(-0.8, 1.25, true),
                                                      "rl": wheel(0.8, -1.25, false), "rr": wheel(-0.8, -1.25, false)}}}},
           "inputs": {"drive": input("drive"), "steer": input("steer"), "brake": input("brake")}})
}

/// The lap's entries, each stamped two steps on, the kit's steps counting from 1 and the late
/// joint's stepper keeping its one checkpoint at step 2, so every stepper holds a checkpoint at or
/// before each entry: drive 1,500 N from the start, steer 20° at 1.5 s, 0° at 3.5 s, −15° at 4.5 s,
/// a brake at 6 s, the drive again at 6.5 s, steer 25° at 7.5 s, and a stop at 9 s.
fn lap() -> Vec<Value> {
    let e = |step: i64, kind: &str, key: &str, v: f64| json!({"step": step + 2, "kind": kind, "target": "kart", "data": {key: v}});
    vec![
        e(0, "drive", "force", 1500.0),
        e(180, "steer", "angle", 20.0),
        e(420, "steer", "angle", 0.0),
        e(540, "steer", "angle", -15.0),
        e(720, "steer", "angle", 0.0),
        e(720, "brake", "force", 3000.0),
        e(780, "brake", "force", 0.0),
        e(780, "drive", "force", 2500.0),
        e(900, "steer", "angle", 25.0),
        e(1080, "drive", "force", 0.0),
        e(1080, "steer", "angle", 0.0),
        e(1080, "brake", "force", 2000.0),
    ]
}

fn init() -> Value {
    state_of(&built_from(&course()).1, Vec::new())
}

fn step(state: &mut Value, input: &StepInput<'_>) {
    step_on(load_in(built_from(&course()), state), state, input);
}

pub(super) fn register(r: &mut Registrar) {
    r.stepper(Stepper {
        hz: 120,
        checkpoints: (0..STEPS / EVERY).map(|i| 1 + i * EVERY).collect(),
        init,
        step,
        checkpoint: Value::clone,
        restore: Value::clone,
        rollback: |_, cp| cp.clone(),
        occurrences: |s| s["rows"].as_array().cloned().unwrap_or_default(),
    });
    // An item for the kit's time_order twin to move, of scene3d's kind, as the late joint's has.
    let plate = json!({"id": "plate", "kind": "mark.box@1", "name": "Plate", "order": "a0",
                       "params": {"size": [0.3, 0.3, 0.3], "paint": {"fill": {"role": "muted"}}}});
    let board = json!({"format": 1, "profile": "board", "title": "Vehicle lap",
                       "description": "A fixture of the physics module: a kart driven round a course by its drive, steer and brake.",
                       "size": [320, 200], "requires": {"modules": {"scene3d": "^1", "physics": "^1"}}, "items": {"plate": plate}});
    r.parity(
        "physics",
        "vehicle-lap",
        board,
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [],
               "at_times": ["0s", "4.5s"], "inputs": lap().into_iter().filter(|e| e["step"].as_i64() < Some(STEPS)).collect::<Vec<_>>()}),
    );
}
