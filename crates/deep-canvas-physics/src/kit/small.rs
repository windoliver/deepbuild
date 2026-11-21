//! #2308: small things. Dice, a marble and dominoes at their true sizes, at 480 Hz and 4 substeps
//! with contacts at 240 Hz and a solver length of 0.01 m: twins of the resting stack, the bounce
//! and the slide with 1 cm bodies; a 1 cm cube that slides off a table's edge and drops, where a
//! contact the backend reused past the edge would hang it in the air; and ten dominoes that fall
//! in order and end resting on each other, not in each other.

use deep_canvas::ops;
use serde_json::{json, Value};

use super::fixtures::{dynamic, fixture, floor, material, world, G};
use super::{body_of, reading, Fixture, Measure, Reading, Tolerance, Trace};
use crate::backend::{rotate, BodyState};

/// The small world's step rate, Hz, and a die's side, m.
const HZ: f64 = 480.0;
const SIDE: f64 = 0.01;
/// A domino's half extents, m: 7.5 mm thick along x, 48 mm tall and 24 mm wide.
const DOMINO: [f64; 3] = [0.00375, 0.024, 0.012];
/// How far apart the dominoes stand, centre to centre, m, and how many there are.
const PITCH: f64 = 0.02;
const DOMINOES: usize = 10;

/// A world of `parts` on the kit's floor at the small world's step, contact frequency and solver
/// length, with a die among its shapes.
fn small(parts: Value) -> Value {
    let half = [SIDE / 2.0; 3];
    let mut w = world(parts);
    w["step_rate"] = json!(HZ);
    w["solver"] = json!({"contact_hz": 240, "length_unit": SIDE});
    w["shapes"]["cube"] = json!({"kind": "box", "half": half});
    w["shapes"]["floor"] = json!({"kind": "box", "half": [10, 0.1, 10]});
    w
}

/// Five 1 cm cubes of friction 0.5 set one on another: the top one stays 4.5 sides up.
fn stack() -> Fixture {
    let mut bodies = json!({"floor": floor("m")});
    for i in 0..5 {
        let pos = [0.0, (f64::from(i) + 0.5) * SIDE, 0.0];
        bodies[format!("cube{}", i + 1)] = dynamic("cube", "m", pos, json!({}));
    }
    let w = small(json!({"contact_materials": {"m": material(0.5, 0.0)}, "bodies": bodies}));
    let m = Measure::Sink {
        body: "cube5",
        step: 1440,
    };
    fixture("small_stack", w, 1440, m, 0.0, Tolerance::M(0.02 * SIDE))
}

/// A 1 cm ball of restitution 0.5 dropped with its lowest point 0.1 m above a floor of
/// restitution 0, under `max`: its first bounce reaches e²h.
fn bounce() -> Fixture {
    let r = SIDE / 2.0;
    let mut w = small(
        json!({"combine": {"friction": "geometric", "restitution": "max"},
                             "contact_materials": {"ball": material(0.0, 0.5), "ground": material(0.0, 0.0)},
                             "bodies": {"floor": floor("ground"), "ball": dynamic("ball", "ball", [0.0, 0.1 + r, 0.0], json!({}))}}),
    );
    w["shapes"] = json!({"ball": {"kind": "sphere", "radius": r}, "floor": w["shapes"]["floor"]});
    let m = Measure::Apex {
        body: "ball",
        base: r,
    };
    fixture("small_bounce", w, 240, m, 0.025, Tolerance::Relative(0.03))
}

/// A 1 cm cube of friction 0.5 on a floor of 0.5, sliding from 0.7 m/s: it stops in v² ÷ 2μg.
fn slide() -> Fixture {
    let cube = dynamic(
        "cube",
        "m",
        [0.0, SIDE / 2.0, 0.0],
        json!({"velocity": {"linear": [0.7, 0, 0]}}),
    );
    let w = small(json!({"contact_materials": {"m": material(0.5, 0.0)},
                         "bodies": {"floor": floor("m"), "cube": cube}}));
    let m = Measure::Travel {
        body: "cube",
        step: 240,
    };
    fixture(
        "small_slide",
        w,
        240,
        m,
        0.49 / G,
        Tolerance::Relative(0.03),
    )
}

/// A 1 cm cube of friction 0 sliding toward a table's edge at x = 0 at 0.886 m/s, the speed that
/// crosses 4 sides while a free body falls one: it has dropped a twentieth of its side before
/// its centre is 1.6 sides past the edge.
fn edge() -> Fixture {
    let cube = dynamic(
        "cube",
        "m",
        [-4.0 * SIDE, SIDE / 2.0, 0.0],
        json!({"velocity": {"linear": [0.886, 0, 0]}}),
    );
    let table = json!({"kind": "static", "shapes": [{"shape": "table", "contact_material": "m"}], "pose": {"pos": [-0.1, -0.05, 0]}});
    let mut w = small(json!({"contact_materials": {"m": material(0.0, 0.0)},
                             "bodies": {"table": table, "cube": cube}}));
    w["shapes"] =
        json!({"cube": w["shapes"]["cube"], "table": {"kind": "box", "half": [0.1, 0.05, 0.1]}});
    let m = Measure::Past {
        body: "cube",
        edge: 0.0,
        drop: SIDE / 20.0,
    };
    let mut f = fixture("small_edge", w, 120, m, 1.6 * SIDE, Tolerance::M(0.0));
    f.never_past = true;
    f
}

/// The IDs of the dominoes, first to last along +x.
fn dominoes_ids() -> Vec<String> {
    (1..=DOMINOES).map(|i| format!("domino{i}")).collect()
}

/// Ten dominoes of friction 0.5 standing along +x, the first tipped 10° about its far bottom
/// edge: all ten pass 45° in order, the last between 0.6 s and 0.8 s, and at 4 s no two
/// neighbours are more than 0.05 of a thickness inside each other.
fn dominoes() -> Fixture {
    let [t, h, _] = DOMINO;
    let th = ops::rad(10.0);
    let (s, c) = (ops::sin(th), ops::cos(th));
    let mut bodies = json!({"floor": floor("m")});
    for (i, id) in dominoes_ids().into_iter().enumerate() {
        bodies[id] = if i == 0 {
            // Its far bottom edge stays at (t, 0); its centre is (−t, h) from it, turned.
            let at = [t - t * c + h * s, t * s + h * c, 0.0];
            dynamic(
                "domino",
                "m",
                at,
                json!({"pose": {"pos": at, "rot": [0, 0, -10]}}),
            )
        } else {
            dynamic("domino", "m", [i as f64 * PITCH, h, 0.0], json!({}))
        };
    }
    let mut w = small(json!({"contact_materials": {"m": material(0.5, 0.0)}, "bodies": bodies}));
    w["shapes"] = json!({"domino": {"kind": "box", "half": DOMINO}, "floor": w["shapes"]["floor"]});
    let m = Measure::Topple {
        last: [0.6, 0.8],
        tilt: 45.0,
    };
    fixture(
        "small_dominoes",
        w,
        1920,
        m,
        0.0,
        Tolerance::M(0.05 * 2.0 * t),
    )
}

/// The small fixtures, in report order.
pub fn all() -> Vec<Fixture> {
    vec![stack(), bounce(), slide(), edge(), dominoes()]
}

/// How far past x = `edge` `body`'s centre is after the first step that ends with it `drop` below
/// where it started, m, with that step.
pub(super) fn past(path: &[[f64; 3]], body: &str, edge: f64, drop: f64) -> Reading {
    let step = path.iter().position(|p| path[0][1] - p[1] >= drop);
    reading(
        step.map(|k| path[k][0] - edge),
        json!({"body": body, "step": step}),
    )
}

/// How far two boxes of half extents `half` are inside each other, m: the least overlap over
/// their separating axes, 0 when one of them parts the two.
fn inside(a: &BodyState, b: &BodyState, half: [f64; 3]) -> f64 {
    let frame = |s: &BodyState| {
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]].map(|e| rotate(s.rot, e))
    };
    let (fa, fb) = (frame(a), frame(b));
    let dot = |u: [f64; 3], v: [f64; 3]| u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let between = [0, 1, 2].map(|i| b.pos[i] - a.pos[i]);
    let mut axes = fa.to_vec();
    axes.extend(fb);
    for u in fa {
        for v in fb {
            let n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            let len = ops::sqrt(dot(n, n));
            if len > 1e-9 {
                axes.push(n.map(|x| x / len));
            }
        }
    }
    let reach = |f: [[f64; 3]; 3], n: [f64; 3]| -> f64 {
        (0..3).map(|i| half[i] * dot(f[i], n).abs()).sum()
    };
    axes.into_iter()
        .map(|n| reach(fa, n) + reach(fb, n) - dot(between, n).abs())
        .fold(f64::INFINITY, f64::min)
        .max(0.0)
}

/// A row of dominoes: how deep the deepest two neighbours are inside each other after the last
/// step, m, with that pair; it fails wherever one never passes `tilt` degrees from upright, one
/// passes it no later than the one before it, or the last passes it outside `last` seconds.
pub(super) fn toppled(t: &Trace, last: [f64; 2], tilt: f64) -> Reading {
    let ids = dominoes_ids();
    let low = ops::cos(ops::rad(tilt));
    let passes = |id: &str| {
        t.states
            .iter()
            .position(|s| body_of(s, id).is_some_and(|b| rotate(b.rot, [0.0, 1.0, 0.0])[1] < low))
    };
    let steps: Vec<Option<usize>> = ids.iter().map(|id| passes(id)).collect();
    let end = t.states.last();
    let pairs = ids.windows(2).filter_map(|p| {
        let (a, b) = (body_of(end?, &p[0])?, body_of(end?, &p[1])?);
        Some((inside(a, b, DOMINO), [p[0].clone(), p[1].clone()]))
    });
    let deepest = pairs.max_by(|a, b| a.0.total_cmp(&b.0));
    let mut r = reading(
        deepest.as_ref().map(|d| d.0),
        json!({"bodies": deepest.as_ref().map(|d| &d.1), "steps": steps}),
    );
    let never = ids.iter().zip(&steps).find(|(_, s)| s.is_none());
    let early = (1..ids.len()).find(|&i| steps[i] <= steps[i - 1]);
    let at = steps.last().copied().flatten().map(|k| k as f64 / t.rate);
    r.broke = if let Some((id, _)) = never {
        Some(format!("{id} never passes {tilt}°"))
    } else if let Some(i) = early {
        Some(format!(
            "{} passes {tilt}° no later than {} before it",
            ids[i],
            ids[i - 1]
        ))
    } else {
        at.filter(|s| *s < last[0] || *s > last[1]).map(|s| {
            format!(
                "the last passes {tilt}° at {s} s, outside {} s to {} s",
                last[0], last[1]
            )
        })
    };
    r
}
