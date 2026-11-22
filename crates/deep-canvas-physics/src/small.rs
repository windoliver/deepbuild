//! #2308: small bodies. The lint `physics.small_body`, run at check, names a dynamic body too small
//! for the world's solver. Of kind `unit`: one whose thinnest extent is under a twentieth of
//! `solver.length_unit`, the length the backend scales its own lengths by, with the largest power
//! of ten at or under that extent as the length to set. Of kind `soft`: one that would sink more
//! than 2% of its thinnest extent resting on a body of its own mass, 2 × g ÷ (2π × `contact_hz`)²
//! since a contact is a spring, with the least frequency that brings it under 2% and the least
//! step rate at which a contact settles at that frequency (#2309).

use std::f64::consts::PI;

use deep_canvas::ops;
use serde_json::{json, Value};

use crate::doc::{most_contact_hz, Body, BodyKind, World};

/// The lint's code.
pub const SMALL_BODY: &str = "physics.small_body";

/// The share of `solver.length_unit` under which a body's thinnest extent is too small for it.
const LEAST_SHARE: f64 = 1.0 / 20.0;
/// The most a body at rest may sink, as a share of its thinnest extent.
const MOST_SINK: f64 = 0.02;
/// The fastest step the reader takes, Hz.
const MOST_RATE: f64 = 1e6;

/// A planted lint (tests/acceptance/2308): one that reads only the first shape of each body.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    FirstShape,
}

/// How far a body at rest on a body of its own mass sinks at a contact frequency of `hz`, m.
fn sink(g: f64, hz: f64) -> f64 {
    let w = 2.0 * PI * hz;
    2.0 * g / (w * w)
}

/// The least step rate, Hz, at or above `w`'s at which a contact settles at `hz`: `w`'s own when
/// it already does, and none when no rate the reader takes does.
fn least_rate(w: &World, hz: f64) -> Option<f64> {
    let substeps = f64::from(w.substeps);
    if most_contact_hz(w.step_rate, substeps) >= hz {
        return Some(w.step_rate);
    }
    let mut rate = (hz * 6.0 / substeps).ceil();
    while rate <= MOST_RATE {
        if deep_canvas::time::step_length(rate).is_ok() {
            return Some(rate);
        }
        rate += 1.0;
    }
    None
}

/// #2317: body `b` of `w`'s thinnest extent, m, when this lint names it of kind `unit`; none for
/// any other body. A backend that keeps a pair's contact points within a share of
/// `solver.length_unit` reads it, since such a body is thinner than that distance.
pub fn unit_extent(w: &World, b: &Body) -> Option<f64> {
    let extent = crate::fast::thinnest(w, b, usize::MAX).filter(|_| b.kind == BodyKind::Dynamic);
    extent.filter(|e| *e < w.solver.length_unit * LEAST_SHARE)
}

/// The lint's issues over `w`, a body at a time in ID order, its `unit` issue before its `soft`.
pub fn issues(w: &World, planted: Planted) -> Vec<Value> {
    let unit = w.solver.length_unit;
    let g = ops::sqrt(w.gravity.iter().map(|x| x * x).sum());
    let sinks = sink(g, w.solver.contact_hz);
    let mut out = Vec::new();
    for (id, b) in &w.bodies {
        let shapes = match planted {
            Planted::None => b.shapes.len(),
            Planted::FirstShape => 1,
        };
        let Some(extent) =
            crate::fast::thinnest(w, b, shapes).filter(|_| b.kind == BodyKind::Dynamic)
        else {
            continue;
        };
        if extent < unit * LEAST_SHARE {
            let mut tens = 1.0;
            while 1.0 / tens > extent {
                tens *= 10.0;
            }
            let length = 1.0 / tens;
            out.push(json!({"check": SMALL_BODY, "code": SMALL_BODY, "kind": "unit", "severity": "warning", "ids": [id],
                "path": "solver/length_unit", "body": id, "extent": extent, "length_unit": length, "t": Value::Null,
                "what": format!("body {id}'s thinnest extent, {extent} m, is under a twentieth of solver.length_unit, {unit} m, the length the backend scales its own lengths by, so it meets contacts tuned for a body far larger"),
                "fix": format!("Set solver.length_unit to {length}.")}));
        }
        if sinks > MOST_SINK * extent {
            let hz = (ops::sqrt(2.0 * g / (MOST_SINK * extent)) / (2.0 * PI)).floor() + 1.0;
            let rate = least_rate(w, hz);
            let step = match rate {
                Some(r) if r == w.step_rate => format!("which step_rate {r} allows as it is"),
                Some(r) => format!("which needs step_rate {r} at {} substeps", w.substeps),
                None => "which no step_rate allows at these substeps".into(),
            };
            out.push(json!({"check": SMALL_BODY, "code": SMALL_BODY, "kind": "soft", "severity": "warning", "ids": [id],
                "path": "solver/contact_hz", "body": id, "extent": extent, "sink": sinks, "contact_hz": hz, "step_rate": rate, "t": Value::Null,
                "what": format!("body {id} at rest on a body of its own mass sinks {sinks:.6} m at solver.contact_hz {} Hz, more than 2% of its thinnest extent, {extent} m", w.solver.contact_hz),
                "fix": format!("Raise solver.contact_hz to at least {hz} Hz, {step}.")}));
        }
    }
    out
}
