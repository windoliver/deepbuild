//! #191: sensors across body kinds. A sensor box of half extent 0.5 m on a static, a kinematic and a
//! dynamic body, each held still, meets five crossers: a 0.25 m sphere on a dynamic body and on a
//! kinematic body and a character capsule, each crossing along +x at 2 m/s from 2 m away (one
//! `sensor_enter` at step 75, 0.625 s, one `sensor_exit` at step 165, 1.375 s, each within a step); a
//! character `place`d inside at step 300 and out at step 360; and a dynamic body inside from the start,
//! which enters at step 1 and, deactivated at step 240, exits then. The character and `place` cells
//! need a character controller and join with the character body (#182).

use serde_json::{json, Value};

use super::fixtures::{fixture, material, world};
use super::{Fixture, Measure, Tolerance};

const SENSORS: [&str; 3] = ["static", "kinematic", "dynamic"];
const CROSSERS: [&str; 5] = ["dynamic", "kinematic", "character", "placed", "inside"];

/// The sensor on a body of kind `sensor`, held still, and the mover of kind `kind` at x = `x`.
fn cell_world(sensor: &str, kind: &str, x: f64) -> Value {
    let still = json!({"kind": sensor, "shapes": [{"shape": "gate", "contact_material": "m", "sensor": true}],
                       "pose": {"pos": [0, 1, 0]}, "gravity_scale": 0, "sleep": false});
    let shape = if kind == "character" {
        "capsule"
    } else {
        "ball"
    };
    let mover = json!({"kind": kind, "shapes": [{"shape": shape, "contact_material": "m"}], "pose": {"pos": [x, 1, 0]},
                       "gravity_scale": 0, "sleep": false});
    world(json!({"contact_materials": {"m": material(0.0, 0.0)},
                 "shapes": {"gate": {"kind": "box", "half": [0.5, 0.5, 0.5]}, "ball": {"kind": "sphere", "radius": 0.25},
                            "capsule": {"kind": "capsule", "half_height": 0.25, "radius": 0.25}},
                 "bodies": {"sensor": still, "mover": mover}}))
}

fn cell(sensor: &str, crosser: &str) -> Fixture {
    let (enter, exit, within) = match crosser {
        "placed" => (300.0, 360.0, 0.0),
        "inside" => (1.0, 240.0, 0.0),
        _ => (75.0, 165.0, 1.0),
    };
    let (kind, x) = match crosser {
        "placed" => ("character", -4.0),
        "inside" => ("dynamic", 0.0),
        k => (k, -2.0),
    };
    let mut w = cell_world(sensor, kind, x);
    let m = Measure::Cell {
        mover: "mover",
        sensor: "sensor",
        enter,
        exit,
    };
    let mut f = fixture(
        format!("sensor/{sensor}/{crosser}"),
        Value::Null,
        420,
        m,
        enter,
        Tolerance::Steps(within),
    );
    match crosser {
        "dynamic" => w["bodies"]["mover"]["velocity"] = json!({"linear": [2, 0, 0]}),
        "kinematic" => f.moves = vec![("mover", [2.0, 0.0, 0.0])],
        // Walked at 2 m/s by #182's `move` input, which joins with the character body.
        "character" => f.caps = vec!["character_controller"],
        "placed" => {
            w["inputs"] = json!({"place": {"kind": "place", "targets": ["mover"]}});
            f.track = json!([{"step": 299, "kind": "place", "target": "mover", "data": {"pose": {"pos": [0, 1, 0]}}},
                             {"step": 359, "kind": "place", "target": "mover", "data": {"pose": {"pos": [4, 1, 0]}}}]);
            f.caps = vec!["character_controller"];
        }
        _ => {
            w["inputs"] = json!({"off": {"kind": "deactivate", "targets": ["mover"]}});
            f.track = json!([{"step": 239, "kind": "deactivate", "target": "mover"}]);
        }
    }
    f.world = w;
    f
}

/// Every cell of the matrix.
pub fn all() -> Vec<Fixture> {
    SENSORS
        .iter()
        .flat_map(|s| CROSSERS.iter().map(move |c| cell(s, c)))
        .collect()
}
