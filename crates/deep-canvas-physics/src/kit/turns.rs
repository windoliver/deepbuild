//! #2317: a body at rest on a body that turns. A box set on a turntable, a heavy disc on a hinge
//! whose motor brings it up to speed, is carried round by friction where friction can hold it: at
//! 90°/s, 1 m from the axis, it needs ω²r = 2.47 m/s² toward the axis, half of the μg = 4.905 m/s²
//! its friction gives. A backend that holds it by contact points the turn has left behind lets it
//! slide out.

use serde_json::json;

use super::fixtures::{dynamic, fixture, material, world};
use super::{reading, Fixture, Measure, Reading, Tolerance};

/// The motor's speed, deg/s, and the steps over which its target rises to it: 2 s.
const SPEED: f64 = 90.0;
const RISE: u64 = 240;

/// A dynamic disc of 20,000 kg and radius 30 m, its top face y = 0, on a hinge to the world about
/// the vertical through its centre, whose velocity motor's target rises from 0 to 90°/s over 2 s
/// and holds 4 s; a 1 kg box of half extent 0.25 m set on it 1 m from the axis, both of friction
/// 0.5. The box's centre stays within 0.06 m of 1 m from the axis at every step of the 6 s.
pub fn turntable() -> Fixture {
    let disc = dynamic("disc", "m", [0.0, -0.1, 0.0], json!({"mass": 20000}));
    let motor = json!({"mode": "velocity", "target": "items/dial/at/pos/0", "max_torque": 100_000_000, "hz": 30, "damping_ratio": 1});
    let axle = json!({"kind": "hinge", "a": "world", "b": "disc",
                      "frame_a": {"anchor": [0, -0.1, 0], "axis": [0, 1, 0]},
                      "frame_b": {"anchor": [0, 0, 0], "axis": [0, 1, 0]}, "motor": motor});
    let w = world(json!({"contact_materials": {"m": material(0.5, 0.0)},
        "shapes": {"disc": {"kind": "cylinder", "half_height": 0.1, "radius": 30},
                   "box": {"kind": "box", "half": [0.25, 0.25, 0.25]}},
        "bodies": {"disc": disc, "box": dynamic("box", "m", [1.0, 0.25, 0.0], json!({"mass": 1}))},
        "joints": {"axle": axle}}));
    let m = Measure::Rides { body: "box" };
    let mut f = fixture("turntable", w, 720, m, 1.0, Tolerance::M(0.06));
    f.ramps = vec![("axle", SPEED, RISE)];
    f
}

/// How far `body`, on `path`, is from the vertical through the origin, m, after the step that
/// leaves it farthest from `answer`; and the first step that leaves it more than `room` from it.
pub(super) fn rode(path: &[[f64; 3]], body: &str, answer: f64, room: f64) -> Reading {
    let far: Vec<f64> = path
        .iter()
        .map(|p| super::dist([p[0], 0.0, p[2]], [0.0; 3]))
        .collect();
    let off = |d: &f64| (d - answer).abs();
    let worst = far
        .iter()
        .copied()
        .reduce(|a, d| if off(&d) > off(&a) { d } else { a });
    let mut r = reading(worst, json!({"body": body}));
    if let Some(k) = far.iter().position(|d| off(d) > room) {
        r.extra.insert("step".into(), json!(k));
    }
    r
}
