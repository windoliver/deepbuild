//! #191: the rigid fixtures, with g = 9.81 m/s² at 120 Hz and 4 substeps, each answer worked out
//! from the world's own laws (Physics: behavior kit), and the fast body at a thin wall.

use serde_json::{json, Value};

use super::{Fixture, Measure, Tolerance};
use deep_canvas::ops;

pub const G: f64 = 9.81;
pub const HZ: f64 = 120.0;

/// A world of `parts` at the kit's gravity, rate and substeps.
pub fn world(parts: Value) -> Value {
    let mut w = json!({"kind": "physics.world@1", "dimensions": 3, "step_rate": HZ, "substeps": 4,
                       "gravity": [0, -G, 0], "mode": "dynamic",
                       "capacity": {"bodies": 32, "shapes": 32, "joints": 4, "contacts": 128, "particles": 0}});
    for (k, v) in parts.as_object().into_iter().flatten() {
        w[k] = v.clone();
    }
    w
}

pub fn material(friction: f64, restitution: f64) -> Value {
    json!({"friction": friction, "restitution": restitution, "density": 1000})
}

/// A static floor whose top face is y = 0.
pub fn floor(material: &str) -> Value {
    json!({"kind": "static", "shapes": [{"shape": "floor", "contact_material": material}], "pose": {"pos": [0, -0.1, 0]}})
}

pub fn dynamic(shape: &str, material: &str, pos: [f64; 3], extra: Value) -> Value {
    let mut b = json!({"kind": "dynamic", "shapes": [{"shape": shape, "contact_material": material}],
                       "pose": {"pos": pos}, "sleep": false});
    for (k, v) in extra.as_object().into_iter().flatten() {
        b[k] = v.clone();
    }
    b
}

pub fn fixture(
    name: impl Into<String>,
    world: Value,
    steps: u64,
    measure: Measure,
    answer: f64,
    tolerance: Tolerance,
) -> Fixture {
    Fixture {
        name: name.into(),
        world,
        steps,
        track: json!([]),
        moves: Vec::new(),
        measure,
        answer,
        tolerance,
        never_past: false,
        caps: Vec::new(),
    }
}

fn free_fall() -> Fixture {
    let w = world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"ball": {"kind": "sphere", "radius": 0.1}},
                         "bodies": {"ball": dynamic("ball", "m", [0.0, 10.0, 0.0], json!({}))}}),
    );
    // ½gt² after 1 s.
    fixture(
        "free_fall",
        w,
        120,
        Measure::Travel {
            body: "ball",
            step: 120,
        },
        0.5 * G,
        Tolerance::Relative(0.01),
    )
}

fn projectile() -> Fixture {
    let v = 10.0 * ops::cos(ops::rad(45.0));
    let w = world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"ball": {"kind": "sphere", "radius": 0.05}},
                         "bodies": {"ball": dynamic("ball", "m", [0.0, 1.0, 0.0], json!({"velocity": {"linear": [v, v, 0]}}))}}),
    );
    // v² sin 2θ ÷ g.
    fixture(
        "projectile_range",
        w,
        240,
        Measure::Range { body: "ball" },
        100.0 / G,
        Tolerance::Relative(0.01),
    )
}

fn pendulum() -> Fixture {
    let th = ops::rad(10.0);
    let (s, c) = (ops::sin(th), ops::cos(th));
    let w = world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"bob": {"kind": "sphere", "radius": 0.05}},
                         "bodies": {"bob": dynamic("bob", "m", [s, 2.0 - c, 0.0], json!({}))},
                         "joints": {"rod": {"kind": "ball", "a": "world", "b": "bob",
                                            "frame_a": {"anchor": [0, 2, 0]}, "frame_b": {"anchor": [-s, c, 0]}}}}),
    );
    // 2π√(L/g) × (1 + θ²/16), L = 1 m.
    let answer = 2.0 * std::f64::consts::PI * ops::sqrt(1.0 / G) * (1.0 + th * th / 16.0);
    fixture(
        "pendulum_period",
        w,
        720,
        Measure::Period { body: "bob" },
        answer,
        Tolerance::Relative(0.01),
    )
}

/// Restitution 0.5 against 0.9, dropped 1 m: the first bounce's height e²h under `rule`.
fn bounce(rule: &'static str, name: &'static str) -> Fixture {
    let e = match rule {
        "max" => 0.9,
        "min" => 0.5,
        "average" => 0.7,
        "geometric" => ops::sqrt(0.45),
        _ => 0.45,
    };
    let w = world(
        json!({"combine": {"friction": "geometric", "restitution": rule},
                         "contact_materials": {"ball": material(0.0, 0.5), "ground": material(0.0, 0.9)},
                         "shapes": {"ball": {"kind": "sphere", "radius": 0.1}, "floor": {"kind": "box", "half": [10, 0.1, 10]}},
                         "bodies": {"floor": floor("ground"), "ball": dynamic("ball", "ball", [0.0, 1.1, 0.0], json!({}))}}),
    );
    fixture(
        name,
        w,
        240,
        Measure::Apex {
            body: "ball",
            base: 0.1,
        },
        e * e,
        Tolerance::Relative(0.03),
    )
}

/// Friction 0.2 against 0.8, a box sliding from 5 m/s: v² ÷ 2μg under `rule`.
fn slide(rule: &'static str, name: &'static str) -> Fixture {
    let mu = match rule {
        "geometric" => 0.4,
        "average" => 0.5,
        "min" => 0.2,
        "max" => 0.8,
        _ => 0.16,
    };
    let w = world(json!({"combine": {"friction": rule, "restitution": "max"},
                         "contact_materials": {"block": material(0.2, 0.0), "ground": material(0.8, 0.0)},
                         "shapes": {"block": {"kind": "box", "half": [0.25, 0.25, 0.25]}, "floor": {"kind": "box", "half": [30, 0.1, 30]}},
                         "bodies": {"floor": floor("ground"),
                                    "block": dynamic("block", "block", [-15.0, 0.25, 0.0], json!({"velocity": {"linear": [5, 0, 0]}}))}}));
    fixture(
        name,
        w,
        600,
        Measure::Travel {
            body: "block",
            step: 600,
        },
        25.0 / (2.0 * mu * G),
        Tolerance::Relative(0.03),
    )
}

/// A box on a 30° slope of friction `mu` on both sides, over 2 s.
fn slope(mu: f64) -> Value {
    let th = ops::rad(30.0);
    let n = [ops::sin(th), ops::cos(th)];
    world(json!({"contact_materials": {"m": material(mu, 0.0)},
                 "shapes": {"block": {"kind": "box", "half": [0.25, 0.25, 0.25]}, "ramp": {"kind": "box", "half": [10, 0.1, 2]}},
                 "bodies": {"ramp": {"kind": "static", "shapes": [{"shape": "ramp", "contact_material": "m"}],
                                     "pose": {"pos": [-0.1 * n[0], -0.1 * n[1], 0], "rot": [0, 0, -30]}},
                            "block": dynamic("block", "m", [0.25 * n[0], 0.25 * n[1], 0.0], json!({"pose": {"pos": [0.25 * n[0], 0.25 * n[1], 0.0], "rot": [0, 0, -30]}}))}}))
}

fn slope_hold() -> Fixture {
    fixture(
        "slope_hold",
        slope(0.6),
        240,
        Measure::Travel {
            body: "block",
            step: 240,
        },
        0.0,
        Tolerance::M(0.001),
    )
}

fn slope_slide() -> Fixture {
    let th = ops::rad(30.0);
    // g(sin θ − μ cos θ)t²/2 over 2 s.
    let answer = G * (ops::sin(th) - 0.5 * ops::cos(th)) * 2.0;
    fixture(
        "slope_slide",
        slope(0.5),
        240,
        Measure::Travel {
            body: "block",
            step: 240,
        },
        answer,
        Tolerance::Relative(0.03),
    )
}

/// A 1 m bar from the world on a hinge about `axis`, `joint` its extra fields.
fn hinged(axis: [f64; 3], joint: Value) -> Value {
    let mut j = json!({"kind": "hinge", "a": "world", "b": "bar",
                       "frame_a": {"anchor": [0, 2, 0], "axis": axis}, "frame_b": {"anchor": [-0.5, 0, 0], "axis": axis}});
    for (k, v) in joint.as_object().into_iter().flatten() {
        j[k] = v.clone();
    }
    world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"bar": {"kind": "box", "half": [0.5, 0.05, 0.05]}},
                 "bodies": {"bar": dynamic("bar", "m", [0.5, 2.0, 0.0], json!({}))}, "joints": {"pin": j}}),
    )
}

fn hinge_limit() -> Fixture {
    let w = hinged([0.0, 0.0, 1.0], json!({"limits": {"min": -30, "max": 30}}));
    let mut f = fixture(
        "hinge_limit",
        w,
        240,
        Measure::Peak { joint: "pin" },
        30.0,
        Tolerance::Deg(0.5),
    );
    f.never_past = true;
    f
}

fn slider_limit() -> Fixture {
    let w = world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"car": {"kind": "box", "half": [0.1, 0.1, 0.1]}},
                         "bodies": {"car": dynamic("car", "m", [0.0, 2.0, 0.0], json!({}))},
                         "joints": {"rail": {"kind": "slider", "a": "world", "b": "car",
                                             "frame_a": {"anchor": [0, 2, 0], "axis": [0, -1, 0]}, "frame_b": {"anchor": [0, 0, 0], "axis": [0, -1, 0]},
                                             "limits": {"min": 0, "max": 0.5}}}}),
    );
    let mut f = fixture(
        "slider_limit",
        w,
        240,
        Measure::Peak { joint: "rail" },
        0.5,
        Tolerance::M(0.005),
    );
    f.never_past = true;
    f
}

fn hinge_motor() -> Fixture {
    // Torque to spare: a 5 kg bar turning about the vertical, which gravity doesn't turn, on a motor
    // of 1,000 N·m answering at 10 Hz.
    let w = hinged(
        [0.0, 1.0, 0.0],
        json!({"motor": {"mode": "velocity", "target": 90, "max_torque": 1000, "hz": 10}}),
    );
    fixture(
        "hinge_motor",
        w,
        60,
        Measure::Spin {
            body: "bar",
            step: 60,
        },
        90.0,
        Tolerance::Relative(0.01),
    )
}

/// A 0.1 m ball whose lowest point falls 1 m to a floor, through a sensor slab whose top is 0.5 m
/// below it.
fn drop_world() -> Value {
    world(json!({"contact_materials": {"m": material(0.5, 0.0)},
                 "shapes": {"ball": {"kind": "sphere", "radius": 0.1}, "floor": {"kind": "box", "half": [10, 0.1, 10]},
                            "gate": {"kind": "box", "half": [1, 0.05, 1]}},
                 "bodies": {"floor": floor("m"), "ball": dynamic("ball", "m", [0.0, 1.1, 0.0], json!({})),
                            "gate": {"kind": "static", "shapes": [{"shape": "gate", "contact_material": "m", "sensor": true}],
                                     "pose": {"pos": [0, 0.45, 0]}}}}))
}

fn first_contact() -> Fixture {
    let m = Measure::When {
        kind: "contact_begin",
        a: "ball",
        b: "floor",
    };
    fixture(
        "first_contact_time",
        drop_world(),
        120,
        m,
        ops::sqrt(2.0 / G),
        Tolerance::Steps(1.0),
    )
}

fn contact_speed() -> Fixture {
    let m = Measure::Field {
        kind: "hit",
        a: "ball",
        b: "floor",
        field: "speed",
    };
    fixture(
        "first_contact_speed",
        drop_world(),
        120,
        m,
        ops::sqrt(2.0 * G),
        Tolerance::Relative(0.02),
    )
}

fn sensor_entry() -> Fixture {
    let m = Measure::When {
        kind: "sensor_enter",
        a: "ball",
        b: "gate",
    };
    fixture(
        "sensor_entry",
        drop_world(),
        120,
        m,
        ops::sqrt(1.0 / G),
        Tolerance::Steps(1.0),
    )
}

/// A box dropped 0.5 m that settles, under a world whose sleep is `on`.
fn settle(on: bool) -> Value {
    world(
        json!({"solver": {"sleep": {"on": on, "speed": 0.05, "time": 0.5}}, "contact_materials": {"m": material(0.5, 0.0)},
                 "shapes": {"block": {"kind": "box", "half": [0.25, 0.25, 0.25]}, "floor": {"kind": "box", "half": [10, 0.1, 10]}},
                 "bodies": {"floor": floor("m"), "block": dynamic("block", "m", [0.0, 0.75, 0.0], json!({"sleep": true}))}}),
    )
}

fn sleep() -> Fixture {
    // The world's sleep time, 0.5 s, in steps.
    let mut f = fixture(
        "sleep",
        settle(true),
        360,
        Measure::SleepSteps {
            body: "block",
            speed: 0.05,
        },
        0.5 * HZ,
        Tolerance::Steps(2.0),
    );
    f.never_past = true;
    f
}

fn sleep_off() -> Fixture {
    fixture(
        "sleep_off",
        settle(false),
        360,
        Measure::Count {
            kind: "rest",
            body: "block",
        },
        0.0,
        Tolerance::Relative(0.0),
    )
}

/// The fast body: a 0.05 m sphere at 200 m/s with `ccd` on, its centre 10 m before a static wall
/// 0.02 m thick and 2 m tall.
pub fn fast_world(ccd: Option<bool>) -> Value {
    let mut ball = dynamic(
        "ball",
        "m",
        [0.0, 1.0, 0.0],
        json!({"velocity": {"linear": [200, 0, 0]}}),
    );
    if let Some(on) = ccd {
        ball["ccd"] = json!(on);
    }
    // The document's default friction, 0.5.
    world(json!({"contact_materials": {"m": material(0.5, 0.0)},
                 "shapes": {"ball": {"kind": "sphere", "radius": 0.05}, "wall": {"kind": "box", "half": [0.01, 1, 1]}},
                 "bodies": {"wall": {"kind": "static", "shapes": [{"shape": "wall", "contact_material": "m"}], "pose": {"pos": [10.01, 1, 0]}},
                            "ball": ball}}))
}

fn ccd_wall() -> Fixture {
    // The first contact at (10 − 0.05) ÷ 200 s, the ball's centre never past the far face.
    let m = Measure::Wall {
        body: "ball",
        wall: "wall",
        far: 10.02,
    };
    let mut f = fixture(
        "ccd_wall",
        fast_world(Some(true)),
        120,
        m,
        9.95 / 200.0,
        Tolerance::Steps(1.0),
    );
    f.caps = vec!["ccd"];
    f
}

/// The test fixture of criterion 4, in a test build's kit only: a free fall of a body with `ccd`
/// on, which a backend whose caps leave out `ccd` is refused.
pub fn test_capped() -> Fixture {
    let w = world(
        json!({"contact_materials": {"m": material(0.0, 0.0)}, "shapes": {"ball": {"kind": "sphere", "radius": 0.1}},
                         "bodies": {"ball": dynamic("ball", "m", [0.0, 10.0, 0.0], json!({"ccd": true}))}}),
    );
    let mut f = fixture(
        "test_capped",
        w,
        120,
        Measure::Travel {
            body: "ball",
            step: 120,
        },
        0.5 * G,
        Tolerance::Relative(0.01),
    );
    f.caps = vec!["ccd"];
    f
}

/// Every fixture of the behavior part, in report order.
pub fn all() -> Vec<Fixture> {
    let mut out = vec![free_fall(), projectile(), pendulum()];
    for (rule, name) in [
        ("max", "bounce_max"),
        ("min", "bounce_min"),
        ("average", "bounce_average"),
        ("geometric", "bounce_geometric"),
        ("multiply", "bounce_multiply"),
    ] {
        out.push(bounce(rule, name));
    }
    for (rule, name) in [
        ("geometric", "slide_geometric"),
        ("average", "slide_average"),
        ("min", "slide_min"),
        ("max", "slide_max"),
        ("multiply", "slide_multiply"),
    ] {
        out.push(slide(rule, name));
    }
    out.extend([
        slope_hold(),
        slope_slide(),
        hinge_limit(),
        slider_limit(),
        hinge_motor(),
    ]);
    out.extend([
        first_contact(),
        contact_speed(),
        sensor_entry(),
        sleep(),
        sleep_off(),
    ]);
    out.push(super::scan::queries());
    out.push(ccd_wall());
    out.extend(super::sensors::all());
    out.extend(super::walks::all());
    out.extend(super::vehicles::all());
    out
}
