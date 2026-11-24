//! #1931: the force laws' fixtures, at 120 Hz with gravity_scale 0, each answer worked from its
//! law (Physics: behavior kit), and how the kit reads an orbit, a gyration and a pair from the
//! body states a run left.

use deep_canvas::ops;
use serde_json::{json, Value};

use super::fixtures::{dynamic, fixture, material, world};
use super::{body_of, dist, path, reading, Fixture, Measure, Reading, Tolerance, Trace};

const PI: f64 = std::f64::consts::PI;

/// A world of 0.05 m balls and `forces`, at `substeps`.
fn lab(substeps: u32, bodies: Value, forces: Value) -> Value {
    world(
        json!({"substeps": substeps, "contact_materials": {"m": material(0.0, 0.0)},
                 "shapes": {"ball": {"kind": "sphere", "radius": 0.05}}, "bodies": bodies, "forces": forces}),
    )
}

/// A ball of `mass` kg at `pos` moving at `linear`, which gravity doesn't pull.
fn ball(pos: [f64; 3], mass: f64, linear: [f64; 3]) -> Value {
    let extra = json!({"mass": mass, "gravity_scale": 0, "velocity": {"linear": linear}});
    dynamic("ball", "m", pos, extra)
}

/// A 2 kg body 2 m from the point of `inverse_square {k: −4π²}`, launched at π m/s square to the
/// line, at 1 substep: it stays 2 m from the point within 1% for 8 s and first comes back to its
/// start line after 2π√(m r³ ÷ |k|) = 4 s, within 1%.
fn orbit() -> Fixture {
    let (m, r, k) = (2.0, 2.0, -4.0 * PI * PI);
    let law = json!({"inverse_square": {"point": [0, 0, 0], "k": k, "min_distance": 0.1}});
    let w = lab(
        1,
        json!({"body": ball([r, 0.0, 0.0], m, [0.0, PI, 0.0])}),
        json!({"pull": {"kind": law, "applies_to": ["body"]}}),
    );
    let measure = Measure::Orbit {
        body: "body",
        point: [0.0; 3],
        period: 2.0 * PI * ops::sqrt(m * r * r * r / -k),
    };
    let mut f = fixture(
        "inverse_square_orbit",
        w,
        960,
        measure,
        r,
        Tolerance::Relative(0.01),
    );
    f.caps = vec!["inverse_square"];
    f
}

/// A 1 kg body under `magnetic {field: (0, 0, 3), charge: 2}`, started at the origin at
/// (3, 0, 0) m/s: it keeps 3 m/s within 0.1% for 5 s and circles at m·v ÷ (q·B) = 0.5 m, within
/// 1%, between y = −1 m and 0 m.
fn gyration() -> Fixture {
    let (m, v, q, b) = (1.0, 3.0, 2.0, 3.0);
    let law = json!({"magnetic": {"field": [0, 0, b], "charge": q}});
    let w = lab(
        4,
        json!({"body": ball([0.0; 3], m, [v, 0.0, 0.0])}),
        json!({"turn": {"kind": law, "applies_to": ["body"]}}),
    );
    let measure = Measure::Gyration {
        body: "body",
        speed: v,
        band: 0.001,
        between: [-1.0, 0.0],
    };
    let mut f = fixture(
        "magnetic_gyration",
        w,
        600,
        measure,
        m * v / (q * b),
        Tolerance::Relative(0.01),
    );
    f.caps = vec!["magnetic"];
    f
}

/// Two 1 kg bodies under `lennard_jones {epsilon: 1, sigma: 0.5, cutoff: 1.25}` and
/// `drag {linear: 2}`, released at rest 0.7 m apart, at 1 substep: 2^(1/6) × σ = 0.5612 m apart
/// at 10 s, within 0.5%.
fn pair() -> Fixture {
    let sigma = 0.5;
    let at = |x: f64| ball([x, 0.0, 0.0], 1.0, [0.0; 3]);
    let law = json!({"lennard_jones": {"epsilon": 1, "sigma": sigma, "cutoff": 1.25}});
    let both = json!(["a", "b"]);
    let forces = json!({"bond": {"kind": law, "applies_to": both},
                        "drag": {"kind": {"drag": {"linear": 2}}, "applies_to": both}});
    let w = lab(1, json!({"a": at(-0.35), "b": at(0.35)}), forces);
    let measure = Measure::Apart {
        a: "a",
        b: "b",
        step: 1200,
    };
    let answer = ops::sqrt(ops::cbrt(2.0)) * sigma;
    let mut f = fixture(
        "lennard_jones_rest",
        w,
        1200,
        measure,
        answer,
        Tolerance::Relative(0.005),
    );
    f.caps = vec!["lennard_jones"];
    f
}

/// The three force-law fixtures, in report order.
pub fn all() -> Vec<Fixture> {
    vec![orbit(), gyration(), pair()]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}

/// Of `values` by step, the one farthest from `due`, the first of equals.
fn farthest(values: impl Iterator<Item = (usize, f64)>, due: f64) -> Option<(usize, f64)> {
    values.reduce(|far, x| {
        if (x.1 - due).abs() > (far.1 - due).abs() {
            x
        } else {
            far
        }
    })
}

/// An orbit's reading: `body`'s distance from `point` after each step, the one farthest from the
/// `answer`, m, beside its `period`, the time it first comes back to the line from the point
/// through its start, s. Broken at the first step whose distance is more than `room` from the
/// answer, naming the step, and where the period is more than the same share off `due`.
pub(super) fn orbit_of(
    t: &Trace,
    (body, point): (&str, [f64; 3]),
    due: f64,
    (answer, room): (f64, f64),
) -> Reading {
    let from: Vec<[f64; 3]> = path(t, body)
        .iter()
        .map(|p| [0, 1, 2].map(|i| p[i] - point[i]))
        .collect();
    let launch = t.states.first().and_then(|s| body_of(s, body));
    let (Some(start), Some(launch)) = (from.first().copied(), launch.map(|b| b.linear)) else {
        return reading(None, json!({"body": body}));
    };
    // After step k, how far the body is along its launch, which is 0 on its start line.
    let along = |k: usize| dot(from[k], launch);
    let back = (1..from.len())
        .find(|&k| along(k - 1) < 0.0 && along(k) >= 0.0 && dot(from[k], start) > 0.0);
    let period = back.map(|k| (k as f64 - 1.0 + along(k - 1) / (along(k - 1) - along(k))) / t.rate);
    let away = |k: usize| dist(from[k], [0.0; 3]);
    let far = farthest((1..from.len()).map(|k| (k, away(k))), answer);
    let mut out = reading(far.map(|f| f.1), json!({"body": body, "period": period}));
    let mut broke = Vec::new();
    if let Some(k) = (1..from.len()).find(|&k| (away(k) - answer).abs() > room) {
        out.extra.insert("step".into(), json!(k));
        broke.push(format!(
            "at step {k} body {body} is {:.4} m from the point, outside the answer {answer} m",
            away(k)
        ));
    }
    if !period.is_some_and(|p| (p - due).abs() <= due * room / answer) {
        let came = period.map_or_else(|| "at no time".into(), |p| format!("after {p:.4} s"));
        broke.push(format!(
            "body {body} first comes back to its start line {came}, where {due:.4} s is due"
        ));
    }
    if !broke.is_empty() {
        out.broke = Some(broke.join("; "));
    }
    out
}

/// A gyration's reading: the radius of the circle `body` turns in, half its path's extent along
/// y, m, beside its `speed`, the one farthest from `speed`, m/s, and its path's lowest and
/// highest `y`, m. Broken where that speed is more than `band`, a share, off, naming the speed,
/// and where its path leaves y `between` by more than `room`, naming the side.
pub(super) fn gyration_of(
    t: &Trace,
    body: &str,
    (speed, band): (f64, f64),
    between: [f64; 2],
    room: f64,
) -> Reading {
    let ys = path(t, body).into_iter().map(|p| p[1]);
    let (lo, hi) = ys.fold((f64::MAX, f64::MIN), |(lo, hi), y| (lo.min(y), hi.max(y)));
    let speeds = t.states.iter().enumerate();
    let speeds = speeds.filter_map(|(k, s)| Some((k, dist(body_of(s, body)?.linear, [0.0; 3]))));
    let Some((k, worst)) = farthest(speeds, speed) else {
        return reading(None, json!({"body": body}));
    };
    let mut out = reading(
        Some((hi - lo) / 2.0),
        json!({"body": body, "speed": worst, "y": [lo, hi]}),
    );
    let mut broke = Vec::new();
    if (worst - speed).abs() > band * speed {
        broke.push(format!("at step {k} body {body}'s speed is {worst:.4} m/s, where {speed} m/s within {}% is due at every step", band * 100.0));
    }
    if lo < between[0] - room || hi > between[1] + room {
        let side = if hi > between[1] + room { "+y" } else { "−y" };
        broke.push(format!("body {body}'s path lies between y = {lo:.4} m and {hi:.4} m, past the {side} side of y = {} m to {} m, where its turn keeps it", between[0], between[1]));
    }
    if !broke.is_empty() {
        out.broke = Some(broke.join("; "));
    }
    out
}

/// How far apart `a` and `b` are after step `step`, m.
pub(super) fn apart_of(t: &Trace, a: &str, b: &str, step: usize) -> Reading {
    let (p, q) = (path(t, a), path(t, b));
    let apart = p.get(step).zip(q.get(step)).map(|(x, y)| dist(*x, *y));
    reading(apart, json!({"bodies": [a, b]}))
}
