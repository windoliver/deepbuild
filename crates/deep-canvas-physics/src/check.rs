//! The world check: the reader's refusals and what the backend's caps refuse, each naming its field
//! and, where the backend can't run it, the backend.

use serde_json::Value;

use crate::caps::Caps;
use crate::doc::{read, Refusal, World};
use crate::roles::{self, Row};

/// The code of a refusal by a backend's caps.
pub const BACKEND_CAP: &str = "physics.backend_cap";

/// The codes this module adds to the check catalog: each with its meaning and fix.
pub const CODES: [(&str, &str, &str); 7] = [
    (BACKEND_CAP, "The backend this build pins can't run the field as written; the issue names the field and the backend.", "Set the field to what the backend runs (most often 0), or use a construct the backend has."),
    ("physics.unsupported", "The field is in physics.world@1 but this backend interface doesn't run it yet; the issue names the issue that brings it.", "Remove the field until that issue lands."),
    ("physics.missing_field", "A required world field is missing.", "Add the field."),
    ("physics.role", "A shape use's role can't expand: it also names explicit groups, the role isn't in the table, or its owner isn't a shot's or isn't a body.", "Give the shape a role or explicit member and collides, not both; a shot's owner names the body that fired it."),
    ("physics.no_group", "A shape is a member of no collision group, so physics.pairs can't place it in the matrix.", "Name at least one group in the shape's member, or give it a role."),
    (SCALED, "A body is bound to an item, or built per element of an instancer, whose world transform scales it; a body's shapes carry sizes in metres and its pose has no scale.", "Size the shape in metres instead (double a box's half extents rather than scale its item) and draw the item at scale 1."),
    (MASS_RATIO, "A joint's two dynamic bodies' masses, declared or density × volume, differ by more than 10:1, so the chain jitters or blows apart.", "Bring the two masses within 10:1: declare the lighter body's mass, or raise its density."),
];

/// #523: the code of a joint whose two dynamic bodies' masses differ by more than 10:1.
pub const MASS_RATIO: &str = "physics.mass_ratio";

/// The most two jointed dynamic bodies' masses may differ by (#523).
pub const MOST_MASS_RATIO: f64 = 10.0;

/// #523: each joint of `w` whose two dynamic bodies' masses, as `mass` gives each (declared, or
/// density × volume), differ by more than 10:1, naming the joint, both bodies and the ratio.
pub fn mass_ratios(
    w: &World,
    mass: impl Fn(&str) -> Option<f64>,
) -> Vec<(String, String, String, f64)> {
    let dynamic = |e: &crate::doc::End| {
        let id = e.body.as_ref()?;
        (w.bodies.get(id)?.kind == crate::doc::BodyKind::Dynamic).then(|| id.clone())
    };
    let mut out = Vec::new();
    for (id, j) in &w.joints {
        let (Some(a), Some(b)) = (dynamic(&j.a), dynamic(&j.b)) else {
            continue;
        };
        let (Some(ma), Some(mb)) = (mass(&a), mass(&b)) else {
            continue;
        };
        let ratio = ma.max(mb) / ma.min(mb);
        if ma > 0.0 && mb > 0.0 && ratio > MOST_MASS_RATIO {
            out.push((id.clone(), a, b, ratio));
        }
    }
    out
}

/// The code of a body whose item or element is drawn scaled (#1921).
pub const SCALED: &str = "physics.scaled";

/// The one-line fix of `code`: this module's, else the core's.
pub fn fix(code: &str) -> String {
    CODES.iter().find(|(c, _, _)| *c == code).map_or_else(
        || deep_canvas::document::fix_for(code),
        |(_, _, f)| f.to_string(),
    )
}

/// Every refusal `doc` raises against `caps`, its roles expanded through `table` (roles.rs), the
/// reader's and the caps' together, or the world it builds when there is none.
pub fn check(doc: &Value, caps: &Caps, table: &[Row]) -> Result<World, Vec<Refusal>> {
    let expanded = roles::expand(doc, table)?;
    let doc = &expanded.doc;
    let mut out = refused_by(doc, caps);
    match read(doc) {
        Ok(w) if out.is_empty() => {
            out.extend(springs(&w));
            out.extend(capacity(&w));
            if out.is_empty() {
                return Ok(w);
            }
        }
        Ok(w) => {
            out.extend(springs(&w));
            out.extend(capacity(&w));
        }
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
        } else if kinematic && matches!(k, "rack" | "path") {
            out.push(Refusal {
                code: "physics.unsupported",
                path: format!("joints/{id}/kind"),
                actual: j["kind"].clone(),
                what: format!("a {k} joint isn't run by this backend interface yet"),
            });
        }
    }
    out
}

/// A world that builds more bodies than `capacity.bodies`, each element body of an `each:` body
/// counted (World: it can never grow past its capacity; #1921).
fn capacity(w: &World) -> Option<Refusal> {
    let most = *w.capacity.get("bodies")?;
    let n = w.bodies.len() as u64;
    (n > most).then(|| Refusal {
        code: "out_of_range",
        path: "capacity/bodies".into(),
        actual: most.into(),
        what: format!("capacity/bodies is {most}, below the {n} bodies this world builds; raise it to at least {n}"),
    })
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
