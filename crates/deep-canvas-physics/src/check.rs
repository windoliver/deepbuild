//! The world check: the reader's refusals and what the backend's caps refuse, each naming its field
//! and, where the backend can't run it, the backend.

use serde_json::Value;

use crate::caps::Caps;
use crate::doc::{read, Refusal, World};

/// The code of a refusal by a backend's caps.
pub const BACKEND_CAP: &str = "physics.backend_cap";

/// The codes this module adds to the check catalog: each with its meaning and fix.
pub const CODES: [(&str, &str, &str); 3] = [
    (BACKEND_CAP, "The backend this build pins can't run the field as written; the issue names the field and the backend.", "Set the field to what the backend runs (most often 0), or use a construct the backend has."),
    ("physics.unsupported", "The field is in physics.world@1 but this backend interface doesn't run it yet; the issue names the issue that brings it.", "Remove the field until that issue lands."),
    ("physics.missing_field", "A required world field is missing.", "Add the field."),
];

/// The one-line fix of `code`: this module's, else the core's.
pub fn fix(code: &str) -> String {
    CODES.iter().find(|(c, _, _)| *c == code).map_or_else(
        || deep_canvas::document::fix_for(code),
        |(_, _, f)| f.to_string(),
    )
}

/// Every refusal `doc` raises against `caps`, the reader's and the caps' together, or the world it
/// builds when there is none.
pub fn check(doc: &Value, caps: &Caps) -> Result<World, Vec<Refusal>> {
    let mut out = refused_by(doc, caps);
    match read(doc) {
        Ok(w) if out.is_empty() => {
            out.extend(springs(&w));
            if out.is_empty() {
                return Ok(w);
            }
        }
        Ok(w) => out.extend(springs(&w)),
        Err(e) => out.extend(e),
    }
    Err(out)
}

fn cap(path: String, actual: &Value, caps: &Caps, what: &str) -> Refusal {
    Refusal {
        code: BACKEND_CAP,
        what: format!(
            "{} {} {what}, so {path} is refused",
            caps.backend, caps.version
        ),
        path,
        actual: actual.clone(),
    }
}

fn nonzero(v: Option<&Value>) -> Option<&Value> {
    v.filter(|x| x.as_f64() != Some(0.0))
}

/// What `caps` refuses in `doc`, read from the document as written.
fn refused_by(doc: &Value, caps: &Caps) -> Vec<Refusal> {
    let mut out = Vec::new();
    if let Some(d) = doc
        .get("dimensions")
        .filter(|d| d.as_f64() != Some(f64::from(caps.dimensions)))
    {
        out.push(cap(
            "dimensions".into(),
            d,
            caps,
            &format!(
                "runs only {}D worlds (2D on rapier2d is #2098)",
                caps.dimensions
            ),
        ));
    }
    if let Some(b) = doc.get("backend").and_then(Value::as_object) {
        if let Some(n) = b.get("name").filter(|n| n.as_str() != Some(caps.backend)) {
            out.push(cap(
                "backend/name".into(),
                n,
                caps,
                &format!("is the backend this build runs, not {n}"),
            ));
        }
        let pinned = format!("={}", caps.version);
        if let Some(v) = b
            .get("version")
            .filter(|v| v.as_str() != Some(&pinned) && v.as_str() != Some(caps.version))
        {
            out.push(cap(
                "backend/version".into(),
                v,
                caps,
                &format!("is the version this build pins ({pinned}), not {v}"),
            ));
        }
    }
    if !caps.restitution_threshold {
        if let Some(v) = nonzero(doc.pointer("/solver/restitution_threshold")) {
            out.push(cap(
                "solver/restitution_threshold".into(),
                v,
                caps,
                "has no restitution threshold (a new contact bounces at any speed); it must be 0",
            ));
        }
    }
    for (id, m) in doc
        .get("contact_materials")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !caps.rolling_resistance {
            if let Some(v) = nonzero(m.get("rolling_resistance")) {
                out.push(cap(format!("contact_materials/{id}/rolling_resistance"), v, caps, "has no rolling resistance; it must be 0, and a ball that should roll to rest takes angular damping"));
            }
        }
        if !caps.tangent_speed {
            if let Some(v) = nonzero(m.get("tangent_speed")) {
                out.push(cap(
                    format!("contact_materials/{id}/tangent_speed"),
                    v,
                    caps,
                    "has no tangent speed; it must be 0",
                ));
            }
        }
    }
    let kinematic = doc.get("mode").and_then(Value::as_str) == Some("kinematic");
    for (id, j) in doc
        .get("joints")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(k) = j
            .get("kind")
            .and_then(Value::as_str)
            .filter(|k| matches!(*k, "gear" | "rack" | "pulley" | "path"))
        else {
            continue;
        };
        if !kinematic && !caps.dynamic_couplings {
            out.push(cap(
                format!("joints/{id}/kind"),
                &j["kind"],
                caps,
                &format!(
                    "has no {k} joint in dynamic mode (joint {id}); it runs only in kinematic mode"
                ),
            ));
        } else if kinematic {
            out.push(Refusal {
                code: "physics.unsupported",
                path: format!("joints/{id}/kind"),
                actual: j["kind"].clone(),
                what: format!(
                    "a {k} joint isn't run by this backend interface yet; #523 brings it"
                ),
            });
        }
    }
    out
}

/// A spring or motor stiffer than the step resolves: above (step rate × substeps) ÷ 4 Hz (Joint).
fn springs(w: &World) -> Vec<Refusal> {
    let most = w.step_rate * f64::from(w.substeps) / 4.0;
    let mut out = Vec::new();
    for (id, j) in &w.joints {
        let hz = [
            ("spring", j.spring.as_ref().map(|s| s.hz)),
            ("motor", j.motor.as_ref().map(|m| m.hz)),
        ];
        for (field, hz) in hz {
            if let Some(hz) = hz.filter(|hz| *hz > most) {
                out.push(Refusal {
                    code: "out_of_range",
                    path: format!("joints/{id}/{field}/hz"),
                    actual: hz.into(),
                    what: format!("joint {id}'s {field} at {hz} Hz is stiffer than the step resolves: at most (step_rate × substeps) ÷ 4 = {most} Hz"),
                });
            }
        }
    }
    out
}
