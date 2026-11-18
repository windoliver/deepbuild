//! #182: the character fixtures (Physics: behavior kit), the character body's rules as data in the
//! interface: the slope (a 45° limit climbs a 30° ramp and not a 50° one, and a 25° limit stops at
//! 30°), the step (a 0.35 m step height climbs a 0.3 m step and not a 0.4 m one, and a 0.25 m one
//! stops at 0.3 m), the snap (grounded at every step down a 20° ramp at 3 m/s with snap 0.2 m,
//! airborne at least once with snap 0) and the jump (a 1 m jump at 120 Hz peaks 1.0185 m up, the
//! discrete solution); and the rules of grounded and sliding: a capsule held 0.04 m above a floor
//! reads grounded and one 0.07 m above doesn't, and one walking up a 30° ramp under a 45° limit
//! reads sliding false where one standing on a 50° slope reads it true. Each walks a capsule of
//! radius 0.3 m and half height 0.6 m, offset 0.01 m, along +x.

use serde_json::{json, Map, Value};

use super::fixtures::{fixture, material, world, G, HZ};
use super::{Fixture, Measure, Tolerance};
use deep_canvas::ops;

/// The capsule's radius and half height, and its offset, m.
const R: f64 = 0.3;
const HALF: f64 = 0.6;
const OFFSET: f64 = 0.01;
/// The lanes characters walk in, 4 m apart along z.
const LANE: f64 = 4.0;

/// What one character of a fixture must do.
#[derive(Clone, Debug, PartialEq)]
pub enum Rule {
    /// Its lowest point stands `rise` m above its start at step `by`, within `within` m.
    Climbs { rise: f64, within: f64, by: usize },
    /// Its lowest point never rises more than `most` m above its start.
    Stops { most: f64 },
    /// Its lowest point's highest rise is `rise` m, within `within` m.
    Peaks { rise: f64, within: f64 },
    /// It reads `grounded` (or `sliding`) as `on` at every step from 1.
    Reads { read: &'static str, on: bool },
    /// It reads `grounded` false on at least one step.
    LeavesGround,
}

/// One character of a fixture: its body, what it meets and its rule.
#[derive(Clone, Debug, PartialEq)]
pub struct Walk {
    pub body: &'static str,
    pub meets: &'static str,
    pub rule: Rule,
}

/// The highest a jump of `h` m rises at `hz` under `g`, as the steps take it: the jump's step
/// moves it by √(2gh) × the step's length, and each later step first lowers its vertical speed
/// by g × the step's length, while it rises.
pub fn jump_peak(g: f64, h: f64, hz: f64) -> f64 {
    let (dt, mut v) = (1.0 / hz, ops::sqrt(2.0 * g * h));
    let mut rise = 0.0;
    while v > 0.0 {
        rise += v * dt;
        v -= g * dt;
    }
    rise
}

/// A character body at `x`, its lowest point `lift` m above y = `floor`, in lane `lane`.
fn walker(x: f64, floor: f64, lift: f64, lane: usize, character: Value) -> Value {
    json!({"kind": "character", "shapes": [{"shape": "capsule", "contact_material": "m"}],
           "pose": {"pos": [x, floor + lift + R + HALF, lane as f64 * LANE]}, "character": character})
}

/// A static prism `name` along z through lane `lane` whose side (x, y) is the convex polygon
/// `side`: its shape and its body.
fn prism(name: &str, side: &[[f64; 2]], lane: usize) -> (Value, Value) {
    let z = lane as f64 * LANE;
    let points: Vec<Value> = side
        .iter()
        .flat_map(|[x, y]| [json!([x, y, z - 1.0]), json!([x, y, z + 1.0])])
        .collect();
    (
        json!({"kind": "convex", "points": points}),
        json!({"kind": "static", "shapes": [{"shape": name, "contact_material": "m"}]}),
    )
}

/// A ramp rising `deg` from its foot at x = 0 to `rise` m, then flat for 6 m.
fn ramp(deg: f64, rise: f64) -> Vec<[f64; 2]> {
    let run = rise / ops::tan(ops::rad(deg));
    vec![[0.0, 0.0], [run, rise], [run + 6.0, rise], [run + 6.0, 0.0]]
}

/// A step `h` m high from x = 0, 6 m long.
fn step(h: f64) -> Vec<[f64; 2]> {
    vec![[0.0, 0.0], [0.0, h], [6.0, h], [6.0, 0.0]]
}

/// A fixture of `lanes`, each a character, the ground it meets (a convex polygon along z, none
/// for the floor) and its body, each walking +x at `speed` m/s from step 0 over `steps`, over a
/// floor at y = 0.
fn course(name: &str, lanes: Vec<(Walk, Vec<[f64; 2]>, Value)>, steps: u64, speed: f64) -> Fixture {
    let mut shapes = Map::new();
    let mut bodies = Map::new();
    shapes.insert(
        "capsule".into(),
        json!({"kind": "capsule", "half_height": HALF, "radius": R}),
    );
    shapes.insert(
        "floor".into(),
        json!({"kind": "box", "half": [60, 0.1, 60]}),
    );
    bodies.insert("floor".into(), json!({"kind": "static", "shapes": [{"shape": "floor", "contact_material": "m"}], "pose": {"pos": [0, -0.1, 0]}}));
    let mut track = Vec::new();
    let mut walks = Vec::new();
    for (lane, (walk, side, body)) in lanes.into_iter().enumerate() {
        if !side.is_empty() {
            let (shape, ground) = prism(walk.meets, &side, lane);
            shapes.insert(walk.meets.into(), shape);
            bodies.insert(walk.meets.into(), ground);
        }
        bodies.insert(walk.body.into(), body);
        if speed != 0.0 {
            track.push(json!({"step": 0, "kind": "move", "target": walk.body, "data": {"velocity": [speed, 0, 0]}}));
        }
        walks.push(walk);
    }
    let targets: Vec<&str> = walks.iter().map(|w| w.body).collect();
    let w = world(json!({"contact_materials": {"m": material(0.5, 0.0)},
                         "shapes": shapes, "bodies": bodies,
                         "inputs": {"walk": {"kind": "move", "targets": targets},
                                    "jump": {"kind": "jump", "targets": targets}}}));
    let mut f = fixture(
        name,
        w,
        steps,
        Measure::Walks(walks),
        0.0,
        Tolerance::Relative(0.0),
    );
    f.track = Value::Array(track);
    f.caps = vec!["character_controller"];
    f
}

fn walk(body: &'static str, meets: &'static str, rule: Rule) -> Walk {
    Walk { body, meets, rule }
}

/// A character's own fields: slope limit, step height and snap.
fn character(limit: f64, step: f64, snap: f64) -> Value {
    json!({"slope_limit": limit, "step": {"height": step}, "snap": snap, "offset": OFFSET})
}

fn slope() -> Fixture {
    let stops = Rule::Stops { most: 0.05 };
    course(
        "character/slope",
        vec![
            (
                walk(
                    "climber",
                    "ramp_30",
                    Rule::Climbs {
                        rise: 2.0,
                        within: 0.02,
                        by: 600,
                    },
                ),
                ramp(30.0, 2.0),
                walker(-1.0, 0.0, OFFSET, 0, character(45.0, 0.35, 0.2)),
            ),
            (
                walk("steep", "ramp_50", stops.clone()),
                ramp(50.0, 2.0),
                walker(-1.0, 0.0, OFFSET, 1, character(45.0, 0.35, 0.2)),
            ),
            (
                walk("strict", "ramp_30_strict", stops),
                ramp(30.0, 2.0),
                walker(-1.0, 0.0, OFFSET, 2, character(25.0, 0.35, 0.2)),
            ),
        ],
        600,
        2.0,
    )
}

fn steps() -> Fixture {
    let stops = Rule::Stops { most: 0.05 };
    course(
        "character/step",
        vec![
            (
                walk(
                    "climber",
                    "step_30",
                    Rule::Climbs {
                        rise: 0.3,
                        within: 0.02,
                        by: 240,
                    },
                ),
                step(0.3),
                walker(-1.0, 0.0, OFFSET, 0, character(45.0, 0.35, 0.2)),
            ),
            (
                walk("high", "step_40", stops.clone()),
                step(0.4),
                walker(-1.0, 0.0, OFFSET, 1, character(45.0, 0.35, 0.2)),
            ),
            (
                walk("short", "step_30_short", stops),
                step(0.3),
                walker(-1.0, 0.0, OFFSET, 2, character(45.0, 0.25, 0.2)),
            ),
        ],
        600,
        2.0,
    )
}

/// Down a 20° ramp at 3 m/s from a flat top 3 m high, 2 m before its edge.
fn snap() -> Fixture {
    let run = 3.0 / ops::tan(ops::rad(20.0));
    let hill = vec![[-6.0, 0.0], [-6.0, 3.0], [0.0, 3.0], [run, 0.0]];
    course(
        "character/snap",
        vec![
            (
                walk(
                    "snapped",
                    "hill",
                    Rule::Reads {
                        read: "grounded",
                        on: true,
                    },
                ),
                hill.clone(),
                walker(-2.0, 3.0, OFFSET, 0, character(45.0, 0.3, 0.2)),
            ),
            (
                walk("loose", "hill_loose", Rule::LeavesGround),
                hill,
                walker(-2.0, 3.0, OFFSET, 1, character(45.0, 0.3, 0.0)),
            ),
        ],
        240,
        3.0,
    )
}

/// A 1 m jump at 120 Hz on flat ground, from rest.
fn jump() -> Fixture {
    let peak = jump_peak(G, 1.0, HZ);
    let mut f = course(
        "character/jump",
        vec![(
            walk(
                "jumper",
                "floor",
                Rule::Peaks {
                    rise: peak,
                    within: 0.001,
                },
            ),
            Vec::new(),
            walker(0.0, 0.0, 0.0, 0, json!({"jump": {"height": 1.0}})),
        )],
        150,
        0.0,
    );
    f.track = json!([{"step": 1, "kind": "jump", "target": "jumper", "data": {"height": 1.0}}]);
    f
}

/// The rules of grounded: a capsule held still (its gravity scale 0, no snap) 0.04 m and 0.07 m
/// above a floor.
fn grounded(name: &str, lift: f64, on: bool) -> Fixture {
    let mut body = walker(0.0, 0.0, lift, 0, character(45.0, 0.3, 0.0));
    body["gravity_scale"] = json!(0);
    course(
        name,
        vec![(
            walk(
                "held",
                "floor",
                Rule::Reads {
                    read: "grounded",
                    on,
                },
            ),
            Vec::new(),
            body,
        )],
        10,
        0.0,
    )
}

/// The rules of sliding: up a 30° ramp under a 45° limit, and standing on a 50° slope.
fn sliding() -> [Fixture; 2] {
    let up = course(
        "character/sliding_30",
        vec![(
            walk(
                "walker",
                "ramp_30",
                Rule::Reads {
                    read: "sliding",
                    on: false,
                },
            ),
            ramp(30.0, 2.0),
            walker(-1.0, 0.0, OFFSET, 0, character(45.0, 0.3, 0.2)),
        )],
        360,
        2.0,
    );
    // On a 50° face rising along +x, the capsule's lower sphere touching it 1 m up.
    let (s, c) = (ops::sin(ops::rad(50.0)), ops::cos(ops::rad(50.0)));
    let foot = [1.0 / ops::tan(ops::rad(50.0)), 1.0];
    let centre = [
        foot[0] - s * (R + OFFSET),
        foot[1] + c * (R + OFFSET) + HALF,
    ];
    let mut body = walker(0.0, 0.0, 0.0, 0, character(45.0, 0.3, 0.2));
    body["pose"]["pos"] = json!([centre[0], centre[1], 0.0]);
    let steep = course(
        "character/sliding_50",
        vec![(
            walk(
                "stander",
                "slope_50",
                Rule::Reads {
                    read: "sliding",
                    on: true,
                },
            ),
            ramp(50.0, 4.0),
            body,
        )],
        30,
        0.0,
    );
    [up, steep]
}

/// Every character fixture: the four of the character body's controller, then the rules of
/// grounded and sliding.
pub fn all() -> Vec<Fixture> {
    let mut out = vec![slope(), steps(), snap(), jump()];
    out.push(grounded("character/grounded_0.04", 0.04, true));
    out.push(grounded("character/grounded_0.07", 0.07, false));
    out.extend(sliding());
    out
}
