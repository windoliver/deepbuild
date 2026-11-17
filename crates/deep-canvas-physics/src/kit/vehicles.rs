//! #251: the vehicle body's fixtures (Physics: behavior kit), which define its controller's
//! behavior in the interface: a 1,000 kg chassis on four wheels at the corners of a 2.5 m
//! wheelbase and a 1.6 m track, centred under its centre of mass, front wheels steering and rear
//! wheels driving, on 2 Hz springs with damping ratio 0.3, rest 0.3 m and travel 0.2 m. Each
//! needs a vehicle controller; a backend that claims none reads `excluded_by_caps`.

use serde_json::{json, Value};

use super::fixtures::{fixture, material, world, G, HZ};
use super::{Fixture, Measure, Tolerance};
use crate::backend::{BodyState, State, VehicleState};
use deep_canvas::ops;

/// The car's wheel radius and suspension rest, m: its chassis's mount points sit rest + radius
/// above the floor when its rays first reach it.
const RADIUS: f64 = 0.3;
const REST: f64 = 0.3;
/// The wheelbase and track, m.
const BASE: f64 = 2.5;
const TRACK: f64 = 1.6;
/// The steps the car settles on its springs before a fixture's input: 2 s.
const SETTLE: u64 = 240;

/// The fixture car on level ground, its mount points `drop` m above where its rays first reach
/// the floor, with the inputs it takes.
pub fn car_world(drop: f64) -> Value {
    let wheel = |x: f64, z: f64, front: bool| {
        json!({"at": [x, 0, z], "radius": RADIUS, "suspension": {"rest": REST, "travel": 0.2, "hz": 2, "damping_ratio": 0.3},
               "steers": front, "drives": !front})
    };
    let (x, z) = (TRACK / 2.0, BASE / 2.0);
    let wheels = json!({"fl": wheel(x, z, true), "fr": wheel(-x, z, true), "rl": wheel(x, -z, false), "rr": wheel(-x, -z, false)});
    let targets = json!(["car"]);
    world(json!({
        "contact_materials": {"m": material(0.8, 0.0)},
        "shapes": {"floor": {"kind": "box", "half": [200, 0.1, 200]}, "chassis": {"kind": "box", "half": [0.9, 0.25, 2.0]}},
        "bodies": {
            "floor": {"kind": "static", "shapes": [{"shape": "floor", "contact_material": "m"}], "pose": {"pos": [0, -0.1, 0]}},
            "car": {"kind": "vehicle", "shapes": [{"shape": "chassis", "contact_material": "m"}], "mass": 1000, "sleep": false,
                    "pose": {"pos": [0, REST + RADIUS + drop, 0]}, "vehicle": {"wheels": wheels}}},
        "inputs": {"go": {"kind": "launch", "targets": targets}, "drive": {"kind": "drive", "targets": targets},
                   "steer": {"kind": "steer", "targets": targets}, "brake": {"kind": "brake", "targets": targets}}}))
}

fn entry(step: u64, kind: &str, data: Value) -> Value {
    json!({"step": step, "kind": kind, "target": "car", "data": data})
}

fn vehicle(mut f: Fixture, track: Value) -> Fixture {
    f.track = track;
    f.caps = vec!["vehicle_controller"];
    f
}

/// The sag: on 2 Hz springs each settles g ÷ (2π × 2)² after 3 s, within 2%.
fn sag() -> Fixture {
    let omega = 2.0 * std::f64::consts::PI * 2.0;
    let m = Measure::Sag {
        body: "car",
        step: 360,
    };
    vehicle(
        fixture(
            "vehicle_sag",
            car_world(0.0),
            360,
            m,
            G / (omega * omega),
            Tolerance::Relative(0.02),
        ),
        json!([]),
    )
}

/// The brake: settled, from 10 m/s a brake of 4,000 N stops it in m·v² ÷ 2F = 12.5 m, within 3%.
fn brake() -> Fixture {
    let m = Measure::Stop {
        body: "car",
        step: SETTLE as usize,
    };
    let track = json!([
        entry(SETTLE, "launch", json!({"linear": [0, 0, 10]})),
        entry(SETTLE, "brake", json!({"force": 4000}))
    ]);
    vehicle(
        fixture(
            "vehicle_brake",
            car_world(0.0),
            SETTLE + 360,
            m,
            1000.0 * 100.0 / 8000.0,
            Tolerance::Relative(0.03),
        ),
        track,
    )
}

/// The drive: settled, a drive of 2,000 N from rest reaches 4 m/s in 2 s, within 2%.
fn drive() -> Fixture {
    let step = (SETTLE + 2 * HZ as u64) as usize;
    let m = Measure::Speed { body: "car", step };
    let track = json!([entry(SETTLE, "drive", json!({"force": 2000}))]);
    vehicle(
        fixture(
            "vehicle_drive",
            car_world(0.0),
            step as u64,
            m,
            4.0,
            Tolerance::Relative(0.02),
        ),
        track,
    )
}

/// The turn: rolling from 3 m/s with steer 15°, the middle of the rear axle circles at
/// L ÷ tan δ = 9.330 m, fitted over one turn, within 3%.
fn turn() -> Fixture {
    let m = Measure::Circle {
        body: "car",
        point: [0.0, 0.0, -BASE / 2.0],
        step: SETTLE as usize + 60,
    };
    let track = json!([
        entry(SETTLE, "launch", json!({"linear": [0, 0, 3]})),
        entry(SETTLE, "steer", json!({"angle": 15}))
    ]);
    let answer = BASE / ops::tan(ops::rad(15.0));
    vehicle(
        fixture(
            "vehicle_turn",
            car_world(0.0),
            SETTLE + 30 * HZ as u64,
            m,
            answer,
            Tolerance::Relative(0.03),
        ),
        track,
    )
}

/// The contacts: dropped from 1 m above where its rays reach the floor, each wheel writes its
/// first contact_begin at √(2h/g) = 0.4515 s, within one step.
fn contacts() -> Fixture {
    let m = Measure::Wheels {
        kind: "contact_begin",
        body: "car",
        ground: "floor",
    };
    vehicle(
        fixture(
            "vehicle_contacts",
            car_world(1.0),
            120,
            m,
            ops::sqrt(2.0 / G),
            Tolerance::Steps(1.0),
        ),
        json!([]),
    )
}

/// #2306: the fixture car set down on `ground`'s top at `at` (x, z), springs at rest length, in a
/// world that also holds `parts`' shapes, bodies and joints; the floor and car take material
/// `material`.
fn on(ground: f64, at: [f64; 2], parts: Value, material: &str) -> Value {
    let mut w = car_world(0.0);
    w["bodies"]["car"]["pose"]["pos"] = json!([at[0], ground + REST + RADIUS, at[1]]);
    for key in ["contact_materials", "shapes", "bodies", "joints"] {
        for (k, v) in parts[key].as_object().into_iter().flatten() {
            w[key][k] = v.clone();
        }
    }
    for id in ["floor", "car"] {
        w["bodies"][id]["shapes"][0]["contact_material"] = json!(material);
    }
    w
}

/// A dynamic slab of `mass` kg and half extents `half` lying on the floor.
fn slab(mass: f64, half: [f64; 3], material: &str) -> Value {
    json!({"shapes": {"slab": {"kind": "box", "half": half}},
           "bodies": {"slab": {"kind": "dynamic", "shapes": [{"shape": "slab", "contact_material": material}],
                               "mass": mass, "sleep": false, "pose": {"pos": [0, half[1], 0]}}}})
}

/// The weight: set down on a 100 kg slab, 8 × 0.2 × 6 m, the slab's contact impulse over each step
/// of the fourth second reads (1,000 + 100) × g times the step's length, within 1%.
fn weight() -> Fixture {
    let m = Measure::Load {
        body: "slab",
        from: 3 * HZ as usize,
        to: 4 * HZ as usize,
    };
    let w = on(0.2, [0.0, 0.0], slab(100.0, [4.0, 0.1, 3.0], "m"), "m");
    vehicle(
        fixture(
            "vehicle_weight",
            w,
            4 * HZ as u64,
            m,
            1100.0 * G,
            Tolerance::Relative(0.01),
        ),
        json!([]),
    )
}

/// The beam: braked at 4,000 N with its centre 2.5 m from the pivot of a level 10 m beam of
/// 200 kg hinged at its middle to the world with limits of ±15°, from 0.5 s on the hinge reads
/// 15° toward the car, within 0.1°.
fn beam() -> Fixture {
    let axis = [1.0, 0.0, 0.0];
    let parts = json!({"shapes": {"beam": {"kind": "box", "half": [1.5, 0.1, 5.0]}},
        "bodies": {"beam": {"kind": "dynamic", "shapes": [{"shape": "beam", "contact_material": "m"}],
                            "mass": 200, "sleep": false, "pose": {"pos": [0, 2, 0]}}},
        "joints": {"pivot": {"kind": "hinge", "a": "world", "b": "beam",
                             "frame_a": {"anchor": [0, 2, 0], "axis": axis}, "frame_b": {"anchor": [0, 0, 0], "axis": axis},
                             "limits": {"min": -15, "max": 15}}}});
    let m = Measure::Angle {
        joint: "pivot",
        from: HZ as usize / 2,
    };
    vehicle(
        fixture(
            "vehicle_beam",
            on(2.1, [0.0, 2.5], parts, "m"),
            2 * HZ as u64,
            m,
            15.0,
            Tolerance::Deg(0.1),
        ),
        json!([entry(0, "brake", json!({"force": 4000}))]),
    )
}

/// The slab: settled on a free 1,000 kg slab, 60 × 0.2 × 6 m, on a floor, slab and floor of
/// friction 0, a drive of 2,000 N for 2 s moves the slab at 4.00 m/s the other way, within 2%.
fn slab_back() -> Fixture {
    let mut parts = slab(1000.0, [3.0, 0.1, 30.0], "ice");
    parts["contact_materials"] = json!({"ice": material(0.0, 0.0)});
    let step = SETTLE as usize + 2 * HZ as usize;
    let m = Measure::Speed { body: "slab", step };
    vehicle(
        fixture(
            "vehicle_slab",
            on(0.2, [0.0, 0.0], parts, "ice"),
            step as u64,
            m,
            4.0,
            Tolerance::Relative(0.02),
        ),
        json!([entry(SETTLE, "drive", json!({"force": 2000}))]),
    )
}

/// The platform: braked at 4,000 N and set down moving with a kinematic platform that holds
/// 2 m/s along its axle, it is within 0.02 m of its place on the platform 3 s on.
fn platform() -> Fixture {
    let parts = json!({"shapes": {"platform": {"kind": "box", "half": [10, 0.1, 4]}},
        "bodies": {"platform": {"kind": "kinematic", "shapes": [{"shape": "platform", "contact_material": "m"}],
                                "pose": {"pos": [0, 0.5, 0]}}}});
    let step = 3 * HZ as usize;
    let m = Measure::Carried {
        body: "car",
        ground: "platform",
        step,
    };
    let mut f = vehicle(
        fixture(
            "vehicle_platform",
            on(0.6, [0.0, 0.0], parts, "m"),
            step as u64,
            m,
            0.0,
            Tolerance::M(0.02),
        ),
        json!([
            entry(0, "launch", json!({"linear": [2, 0, 0]})),
            entry(0, "brake", json!({"force": 4000}))
        ]),
    );
    f.moves = vec![("platform", [2.0, 0.0, 0.0])];
    f
}

/// The nine, in report order.
pub fn all() -> Vec<Fixture> {
    vec![
        sag(),
        brake(),
        drive(),
        turn(),
        contacts(),
        weight(),
        beam(),
        slab_back(),
        platform(),
    ]
}

fn body<'a>(s: &'a State, id: &str) -> Option<&'a BodyState> {
    s.bodies.iter().find(|b| b.id == id)
}

fn size(v: [f64; 3]) -> f64 {
    ops::sqrt(v.iter().map(|x| x * x).sum())
}

/// Each wheel's compression (rest less its suspension's length) after step `step`: the one
/// farthest from `answer`, naming it.
pub fn sag_of(
    vehicles: &[Vec<VehicleState>],
    id: &str,
    step: usize,
    rest: f64,
    answer: f64,
) -> (Option<f64>, Value) {
    let v = vehicles
        .get(step)
        .and_then(|vs| vs.iter().find(|v| v.id == id));
    let worst = v.and_then(|v| {
        v.wheels
            .iter()
            .map(|w| (w.name.clone(), rest - w.length))
            .max_by(|a, b| (a.1 - answer).abs().total_cmp(&(b.1 - answer).abs()))
    });
    let wheel = worst.as_ref().map(|w| format!("{id}#{}", w.0));
    (worst.map(|w| w.1), json!({"body": id, "wheel": wheel}))
}

/// How far body `id` travels from where it stood after step `step` to the first step its
/// velocity stops pointing the way it moved on the step after (the step an entry stamped `step`
/// applies on).
pub fn stop_of(states: &[State], id: &str, step: usize) -> Option<f64> {
    let start = body(states.get(step)?, id)?.pos;
    let dir = body(states.get(step + 1)?, id)?.linear;
    let k = (step + 2..states.len()).find(|&k| {
        body(&states[k], id)
            .is_some_and(|b| (0..3).map(|i| b.linear[i] * dir[i]).sum::<f64>() <= 1e-6)
    })?;
    let at = body(&states[k], id)?.pos;
    Some(size([0, 1, 2].map(|i| at[i] - start[i])))
}

/// Body `id`'s speed after step `step`, m/s.
pub fn speed_of(states: &[State], id: &str, step: usize) -> Option<f64> {
    Some(size(body(states.get(step)?, id)?.linear))
}

/// The radius of the circle `point` on body `id` traces on the ground from step `step`, fitted
/// by least squares over at most one turn of its heading.
pub fn circle_of(states: &[State], id: &str, point: [f64; 3], step: usize) -> Option<f64> {
    let mut pts = Vec::new();
    let mut turned = 0.0;
    let mut last: Option<f64> = None;
    for s in states.iter().skip(step) {
        let b = body(s, id)?;
        let p = rotate(b.rot, point);
        let heading = rotate(b.rot, [0.0, 0.0, 1.0]);
        let yaw = ops::atan2(heading[0], heading[2]);
        if let Some(l) = last {
            let mut d = yaw - l;
            if d > std::f64::consts::PI {
                d -= 2.0 * std::f64::consts::PI;
            } else if d < -std::f64::consts::PI {
                d += 2.0 * std::f64::consts::PI;
            }
            turned += d.abs();
        }
        last = Some(yaw);
        pts.push([b.pos[0] + p[0], b.pos[2] + p[2]]);
        if turned >= 2.0 * std::f64::consts::PI {
            break;
        }
    }
    fit(&pts)
}

/// `v` turned by the quaternion `q` (`[x, y, z, w]`).
fn rotate(q: [f64; 4], v: [f64; 3]) -> [f64; 3] {
    let (u, w) = ([q[0], q[1], q[2]], q[3]);
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let t = cross(u, v).map(|x| 2.0 * x);
    let c = cross(u, t);
    [0, 1, 2].map(|i| v[i] + w * t[i] + c[i])
}

/// The least-squares circle through `pts` (Kåsa's fit about their mean), its radius.
fn fit(pts: &[[f64; 2]]) -> Option<f64> {
    if pts.len() < 3 {
        return None;
    }
    let n = pts.len() as f64;
    let (mx, my) = (
        pts.iter().map(|p| p[0]).sum::<f64>() / n,
        pts.iter().map(|p| p[1]).sum::<f64>() / n,
    );
    let (mut suu, mut svv, mut suv, mut suuu, mut svvv, mut suvv, mut svuu) =
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for p in pts {
        let (u, v) = (p[0] - mx, p[1] - my);
        suu += u * u;
        svv += v * v;
        suv += u * v;
        suuu += u * u * u;
        svvv += v * v * v;
        suvv += u * v * v;
        svuu += v * u * u;
    }
    let det = suu * svv - suv * suv;
    if det.abs() < 1e-12 {
        return None;
    }
    let (b1, b2) = ((suuu + suvv) / 2.0, (svvv + svuu) / 2.0);
    let uc = (b1 * svv - b2 * suv) / det;
    let vc = (b2 * suu - b1 * suv) / det;
    Some(ops::sqrt(uc * uc + vc * vc + (suu + svv) / n))
}

/// The time of each wheel of body `id`'s first `kind` row with `ground`: the one farthest from
/// `answer`, naming it, or none when a wheel writes none.
pub fn wheels_of(
    rows: &[crate::occurrence::Row],
    vehicles: &[Vec<VehicleState>],
    (kind, id, ground): (&str, &str, &str),
    rate: f64,
    answer: f64,
) -> (Option<f64>, Value) {
    let names: Vec<String> = vehicles
        .first()
        .and_then(|vs| vs.iter().find(|v| v.id == id))
        .map(|v| {
            v.wheels
                .iter()
                .map(|w| format!("{id}#{}", w.name))
                .collect()
        })
        .unwrap_or_default();
    let mut worst: Option<(String, Option<f64>)> = None;
    for name in &names {
        let row = rows.iter().find(|r| {
            crate::occurrence::KINDS.get(r.raw.kind as usize) == Some(&kind)
                && ((r.raw.a == *name && r.raw.b.as_deref() == Some(ground))
                    || (r.raw.b.as_deref() == Some(name) && r.raw.a == ground))
        });
        let t = row.map(|r| f64::from(r.step) / rate);
        let off = |t: Option<f64>| t.map_or(f64::MAX, |t| (t - answer).abs());
        if worst.as_ref().is_none_or(|w| off(t) > off(w.1)) {
            worst = Some((name.clone(), t));
        }
    }
    let wheel = worst.as_ref().map(|w| w.0.clone());
    (worst.and_then(|w| w.1), json!({"body": id, "wheel": wheel}))
}
