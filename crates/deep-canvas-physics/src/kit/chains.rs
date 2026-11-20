//! #2310: the articulated fixtures (Physics: behavior kit): a chain of ten 0.1 kg links of 0.1 m
//! on articulated ball joints from the world to a bob of radius 0.05 m. Hung with a 10 kg bob,
//! the bob's centre stays 10 × 0.1 + 0.05 = 1.05 m from the fixed point, within 0.1 mm; let go
//! level with a 100 kg bob, gravity square to it, the bob passes its lowest point at
//! √(2 × 9.81 × 1.05) = 4.539 m/s, within 1%; and no joint's two anchors are ever more than
//! 0.1 mm apart. Each is measured here from body states, never reported by a backend.

use serde_json::{json, Map, Value};

use super::fixtures::{dynamic, fixture, material, world, G};
use super::{dist, path, reading, Fixture, Measure, Reading, Tolerance, Trace};
use crate::backend::rotate;
use crate::doc::{End, World};
use deep_canvas::ops;

/// The links, each one's length and mass, the bob's radius, and the bob's centre from the fixed
/// point, m and kg.
const LINKS: usize = 10;
const LINK: f64 = 0.1;
const LINK_MASS: f64 = 0.1;
const BOB: f64 = 0.05;
const REACH: f64 = LINKS as f64 * LINK + BOB;
/// The farthest an articulated joint's two anchors may be apart at any step, m.
const OPEN: f64 = 1e-4;

/// The chain hung along −y from the origin with a bob of `bob` kg, under `gravity`.
fn chain(bob: f64, gravity: [f64; 3]) -> Value {
    let (mut bodies, mut joints) = (Map::new(), Map::new());
    let ball = |a: String, b: String, from: f64, to: f64| {
        json!({"kind": "ball", "a": a, "b": b, "articulated": true,
               "frame_a": {"anchor": [0, from, 0]}, "frame_b": {"anchor": [0, to, 0]}})
    };
    let link = |i: usize| format!("link_{i:02}");
    for i in 1..=LINKS {
        let y = -(LINK / 2.0 + LINK * (i - 1) as f64);
        let body = dynamic("link", "m", [0.0, y, 0.0], json!({"mass": LINK_MASS}));
        bodies.insert(link(i), body);
        let (a, from) = match i {
            1 => ("world".to_string(), 0.0),
            _ => (link(i - 1), -LINK / 2.0),
        };
        joints.insert(format!("joint_{i:02}"), ball(a, link(i), from, LINK / 2.0));
    }
    let body = dynamic("bob", "m", [0.0, -REACH, 0.0], json!({"mass": bob}));
    bodies.insert("bob".into(), body);
    let last = ball(link(LINKS), "bob".into(), -LINK / 2.0, BOB);
    joints.insert(format!("joint_{:02}", LINKS + 1), last);
    world(
        json!({"gravity": gravity, "contact_materials": {"m": material(0.0, 0.0)},
        "capacity": {"bodies": 16, "shapes": 16, "joints": 16, "contacts": 64, "particles": 0},
        "shapes": {"link": {"kind": "capsule", "half_height": LINK / 2.0 - 0.01, "radius": 0.01},
                   "bob": {"kind": "sphere", "radius": BOB}},
        "bodies": bodies, "joints": joints}),
    )
}

fn held(name: &str, world: Value, measure: Measure, answer: f64, tolerance: Tolerance) -> Fixture {
    let mut f = fixture(name, world, 480, measure, answer, tolerance);
    f.caps = vec!["articulations"];
    f
}

/// The loaded chain and the swing.
pub fn all() -> Vec<Fixture> {
    let from = [0.0; 3];
    let reach = Measure::Reach { body: "bob", from };
    let lowest = Measure::Lowest {
        body: "bob",
        from,
        along: [0.0, -1.0, 0.0],
    };
    vec![
        held(
            "articulated/loaded_chain",
            chain(10.0, [0.0, -G, 0.0]),
            reach,
            REACH,
            Tolerance::M(OPEN),
        ),
        held(
            "articulated/swing",
            chain(100.0, [G, 0.0, 0.0]),
            lowest,
            ops::sqrt(2.0 * G * REACH),
            Tolerance::Relative(0.01),
        ),
    ]
}

/// The first joint of `w` whose two anchors a step leaves more than [`OPEN`] apart, as what
/// broke, naming the joint and the step.
fn opened(w: &World, t: &Trace) -> Option<(String, String)> {
    let at = |e: &End, k: usize| match &e.body {
        None => Some(e.point),
        Some(id) => {
            let s = t.states[k].bodies.iter().find(|b| &b.id == id)?;
            let p = rotate(s.rot, e.point);
            Some([0, 1, 2].map(|i| s.pos[i] + p[i]))
        }
    };
    (0..t.states.len()).find_map(|k| {
        w.joints.iter().find_map(|(id, j)| {
            let gap = dist(at(&j.a, k)?, at(&j.b, k)?);
            let what = format!("joint {id}'s two anchors are {:.3} mm apart at step {k}, more than the {} mm they may part", gap * 1e3, OPEN * 1e3);
            (gap.is_nan() || gap > OPEN).then(|| (id.clone(), what))
        })
    })
}

/// A chain's reading `value` at `step`, broken where a joint of its world opens.
fn chained(w: &World, t: &Trace, body: &str, value: Option<(usize, f64)>) -> Reading {
    let mut r = reading(
        value.map(|v| v.1),
        json!({"body": body, "step": value.map(|v| v.0)}),
    );
    if let Some((joint, what)) = opened(w, t) {
        r.extra.insert("joint".into(), json!(joint));
        r.broke = Some(what);
    }
    r
}

/// `body`'s distance from `from` after each step: the one farthest from `answer`.
pub(super) fn reach(w: &World, t: &Trace, body: &str, from: [f64; 3], answer: f64) -> Reading {
    let far = path(t, body).into_iter().map(|p| dist(p, from)).enumerate();
    let off = |x: &(usize, f64)| (x.1 - answer).abs();
    chained(w, t, body, far.max_by(|a, b| off(a).total_cmp(&off(b))))
}

/// `body`'s speed where it passes its lowest point: let go along `along` from `from`, square to
/// gravity, it is lowest where it crosses the line through `from` along gravity; read at the
/// nearer of the two steps the crossing lies between.
pub(super) fn lowest(
    w: &World,
    t: &Trace,
    body: &str,
    (from, along): ([f64; 3], [f64; 3]),
) -> Reading {
    let side: Vec<f64> = path(t, body)
        .iter()
        .map(|p| (0..3).map(|i| (p[i] - from[i]) * along[i]).sum())
        .collect();
    let crossed = (1..side.len()).find(|&k| side[k] <= 0.0);
    let step = crossed.map(|k| {
        if side[k - 1].abs() < side[k].abs() {
            k - 1
        } else {
            k
        }
    });
    let speed = |k: usize| {
        let s = t.states[k].bodies.iter().find(|b| b.id == body)?;
        Some((k, dist(s.linear, [0.0; 3])))
    };
    chained(w, t, body, step.and_then(speed))
}
