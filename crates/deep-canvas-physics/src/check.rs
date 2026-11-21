//! The world check: the reader's refusals and what the backend's caps refuse, each naming its field
//! and, where the backend can't run it, the backend.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::caps::Caps;
use crate::doc::{read, BodyKind, JointKind, Read, Refusal, World};
use crate::roles::{self, Row};

/// The code of a refusal by a backend's caps.
pub const BACKEND_CAP: &str = "physics.backend_cap";

/// The codes this module adds to the check catalog: each with its meaning and fix.
pub const CODES: [(&str, &str, &str); 11] = [
    (BACKEND_CAP, "The backend this build pins can't run the field as written; the issue names the field and the backend.", "Set the field to what the backend runs (most often 0), or use a construct the backend has."),
    ("physics.unsupported", "The field is in physics.world@1 but this backend interface doesn't run it yet; the issue names the issue that brings it.", "Remove the field until that issue lands."),
    ("physics.missing_field", "A required world field is missing.", "Add the field."),
    ("physics.role", "A shape use's role can't expand: it also names explicit groups, the role isn't in the table, or its owner isn't a shot's or isn't a body.", "Give the shape a role or explicit member and collides, not both; a shot's owner names the body that fired it."),
    ("physics.no_group", "A shape is a member of no collision group, so physics.pairs can't place it in the matrix.", "Name at least one group in the shape's member, or give it a role."),
    (crate::doc::OPEN_MESH, "A soft volume's source mesh isn't closed: some edge isn't on exactly two triangles; the issue names the first such edge by its two particles.", "Close the source mesh (or build the volume from a closed item), or draw it as cloth instead."),
    (SCALED, "A body is bound to an item, or built per element of an instancer, whose world transform scales it; a body's shapes carry sizes in metres and its pose has no scale.", "Size the shape in metres instead (double a box's half extents rather than scale its item) and draw the item at scale 1."),
    (crate::fast::FAST_BODY, "A body's fastest point (its move in a step plus its turn times its farthest extent from its centre of mass) moves farther in one step than half its thinnest extent where the backend's sweep doesn't hold it: a dynamic body with ccd off; a kinematic body, which starts no sweep (kind kinematic, with its own fix); or two bodies whose swept bounds meet where neither a sweep nor a body's contact prediction holds them and ccd on the fast one can't settle it (kind pair, with its own fix). The issue names the body or both, the step, the move and that half.", "Turn the body's ccd on, or slow it."),
    (MASS_RATIO, "A joint's two dynamic bodies' masses, declared or density × volume, differ by more than 10:1, so the chain jitters or blows apart.", "Bring the two masses within 10:1: declare the lighter body's mass, raise its density, or make the joint articulated."),
    (ARTICULATION_TREE, "The articulated joints of a world form trees: this one makes a body the b of two of them, or closes a loop of them; the issue names it.", "Leave the joint the issue names separate: a loop is closed by a separate joint."),
    (ARTICULATION_GAP, "An articulated joint's two anchors are written more than 1 mm apart, and its second body starts where its coordinates put it; the issue names the joint and the gap in metres.", "Write the second body's pose so that its anchor lies on the first body's."),
];

/// #2310: the code of an articulated joint that makes a body the `b` of two, or closes a loop;
/// and of one whose two anchors are written more than 1 mm apart, which the backend raises as it
/// builds the joint from its bodies' poses.
pub const ARTICULATION_TREE: &str = "physics.articulation_tree";
pub const ARTICULATION_GAP: &str = "physics.articulation_gap";

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
    // #2310: an articulated joint's anchors can't part, whatever the masses it holds.
    for (id, j) in w.joints.iter().filter(|(_, j)| !j.articulated) {
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
    out.extend(crate::doc::flat(doc));
    match read(doc) {
        Ok(w) if out.is_empty() => {
            out.extend(springs(&w));
            out.extend(capacity(&w));
            out.extend(belts(&w));
            out.extend(crate::wind::uncaught(&w));
            out.extend(articulated(&w));
            if out.is_empty() {
                return Ok(w);
            }
        }
        Ok(w) => {
            out.extend(springs(&w));
            out.extend(capacity(&w));
            out.extend(belts(&w));
            out.extend(crate::wind::uncaught(&w));
            out.extend(articulated(&w));
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
    // #2098: an unwritten `dimensions` is 3, which a 2D backend refuses as it does a written one.
    let d = doc.get("dimensions").cloned().unwrap_or(Value::from(3));
    if d.as_f64() != Some(f64::from(caps.dimensions)) {
        let what = format!("runs only {}D worlds", caps.dimensions);
        out.push(cap("dimensions".into(), &d, caps, &what));
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
    if !caps.scales_lengths {
        let unit = doc.pointer("/solver/length_unit");
        if let Some(v) = unit.filter(|v| v.as_f64() != Some(1.0)) {
            out.push(cap(
                "solver/length_unit".into(),
                v,
                caps,
                "scales none of its lengths by a world's; solver.length_unit must be 1",
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
        // #2241: a belt on a backend that claims none.
        if !caps.claims.contains(&"belts") {
            if let Some(v) = nonzero(m.get("tangent_speed")) {
                out.push(cap(
                    format!("contact_materials/{id}/tangent_speed"),
                    v,
                    caps,
                    "claims no belts; a contact material's tangent_speed must be 0",
                ));
            }
        }
    }
    // #191: a world needing a feature the backend doesn't claim; and #2239: `ccd` on a kinematic
    // or a static body, where the backend starts no sweep from one.
    let claims = |c: &str| caps.claims.contains(&c);
    for (id, b) in doc
        .get("bodies")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(v) = b.get("ccd").filter(|v| v.as_bool() == Some(true)) else {
            continue;
        };
        let unswept = b
            .get("kind")
            .and_then(Value::as_str)
            .filter(|k| matches!(*k, "kinematic" | "static") && !caps.sweep.starts.contains(k));
        if !claims("ccd") {
            out.push(cap(
                format!("bodies/{id}/ccd"),
                v,
                caps,
                "claims no swept collision (ccd)",
            ));
        } else if let Some(kind) = unswept {
            let from = caps.sweep.starts.join(" or ");
            let what = format!("starts no sweep from a {kind} body, only from a {from} one");
            out.push(cap(format!("bodies/{id}/ccd"), v, caps, &what));
        }
    }
    // #251: a vehicle body on a backend with no vehicle controller, naming the body.
    if !claims("vehicle_controller") {
        for (id, b) in doc
            .get("bodies")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some(v) = b.get("kind").filter(|k| *k == "vehicle") {
                let what = format!("claims no vehicle controller to move vehicle body {id}");
                out.push(cap(format!("bodies/{id}/kind"), v, caps, &what));
            }
        }
    }
    if !claims("soft_bodies") {
        if let Some(v) = doc
            .get("soft")
            .filter(|s| s.as_object().is_some_and(|m| !m.is_empty()))
        {
            out.push(cap("soft".into(), v, caps, "claims no soft bodies"));
        }
    }
    // #182: a character body needs the backend's character controller.
    if !claims("character_controller") {
        for (id, b) in doc
            .get("bodies")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some(v) = b.get("kind").filter(|k| k.as_str() == Some("character")) {
                out.push(cap(
                    format!("bodies/{id}/kind"),
                    v,
                    caps,
                    &format!(
                        "claims no character controller, so character body {id} can't run on it"
                    ),
                ));
            }
        }
    }
    // #524: no backend this module runs takes a soft body's pressure (caps.declared).
    for (id, b) in doc
        .get("soft")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if let Some(v) = b.get("pressure") {
            out.push(cap(
                format!("soft/{id}/pressure"),
                v,
                caps,
                &format!(
                    "takes no pressure: soft body {id} holds inflate times its rest volume instead"
                ),
            ));
        }
    }
    let kinematic = doc.get("mode").and_then(Value::as_str) == Some("kinematic");
    for (id, j) in doc
        .get("joints")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        // #2310: an articulated joint on a backend with no articulations, naming the joint.
        if let Some(v) = j.get("articulated").filter(|v| v.as_bool() == Some(true)) {
            if !claims("articulations") {
                let what =
                    format!("claims no articulations, so joint {id} can't be articulated on it");
                out.push(cap(format!("joints/{id}/articulated"), v, caps, &what));
            }
        }
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

/// #2310: what an articulated joint is and holds (Joint: `articulated`). It is a fixed, ball, hinge
/// or slider joint whose second body is a dynamic one; the articulated joints of a world form
/// trees, so no body is the `b` of two of them and none closes a loop; and it has no lock to
/// load, so `breaks_at`, `spring`, `active: false` and an output's `joint_force` on one are
/// refused, and so is a velocity written on a body one holds. Each refusal names its field.
fn articulated(w: &World) -> Vec<Refusal> {
    let mut out = Vec::new();
    // Each body's tree, the world's among them (`None`), and the joint that holds each body as
    // its `b`, as the joints before this one in canonical order left them.
    let mut tree: BTreeMap<Option<&str>, usize> = BTreeMap::new();
    let mut trees = 0;
    let mut held: BTreeMap<&str, &str> = BTreeMap::new();
    for (id, j) in w.joints.iter().filter(|(_, j)| j.articulated) {
        let mut refuse = |code: &'static str, field: &str, actual: Value, what: String| {
            out.push(Refusal {
                code,
                path: format!("joints/{id}/{field}"),
                actual,
                what: format!("articulated joint {id} {what}"),
            });
        };
        let kinds = [
            JointKind::Fixed,
            JointKind::Ball,
            JointKind::Hinge,
            JointKind::Slider,
        ];
        if !kinds.contains(&j.kind) {
            refuse("out_of_range", "articulated", json!(true), "is neither a fixed, a ball, a hinge nor a slider joint, the kinds an articulation places a body by".into());
        }
        if j.breaks_at.is_some() {
            refuse("out_of_range", "breaks_at", Value::Null, "writes breaks_at: its bodies are placed from its coordinates, so it has no lock whose load could pass a threshold; leave it separate to break it".into());
        }
        if j.spring.is_some() {
            refuse(
                "out_of_range",
                "spring",
                Value::Null,
                "writes spring, which an articulated joint doesn't hold; leave it separate".into(),
            );
        }
        if !j.active {
            refuse("out_of_range", "active", json!(false), "writes active: false, and a link of an articulation is never let go; leave it separate".into());
        }
        let (a, b) = (j.a.body.as_deref(), j.b.body.as_deref());
        let dynamic = b.and_then(|b| w.bodies.get(b));
        if !dynamic.is_some_and(|x| x.kind == BodyKind::Dynamic && x.vehicle.is_none()) {
            let named = b.unwrap_or("world");
            refuse("out_of_range", "b", json!(named), format!("holds {named} as its b, which isn't a dynamic body; an articulation places only a dynamic body from a joint's coordinates"));
        }
        if let Some(first) = b.and_then(|b| held.insert(b, id.as_str())) {
            let named = b.unwrap_or_default();
            refuse(ARTICULATION_TREE, "articulated", json!(true), format!("is the second to hold {named} as its b, after {first}: the articulated joints of a world form trees, so no body is the b of two of them; leave one separate"));
        }
        // A joint whose two bodies an earlier one already joins, through any others, closes a loop.
        let mut of = |end| {
            *tree.entry(end).or_insert_with(|| {
                trees += 1;
                trees
            })
        };
        let (ta, tb) = (of(a), of(b));
        if ta == tb {
            refuse(ARTICULATION_TREE, "articulated", json!(true), "closes a loop: the articulated joints of a world form trees; leave the joint that closes a loop separate".into());
        } else {
            tree.values_mut()
                .filter(|t| **t == tb)
                .for_each(|t| *t = ta);
        }
    }
    // A body an articulation holds moves by its joints' coordinates alone, so a velocity written
    // on one would move nothing.
    let ends = w.joints.values().filter(|j| j.articulated);
    let linked: BTreeSet<&str> = ends
        .flat_map(|j| [j.a.body.as_deref(), j.b.body.as_deref()])
        .flatten()
        .collect();
    for id in linked {
        let moving = w.bodies.get(id).filter(|b| {
            b.kind == BodyKind::Dynamic && (b.linear != [0.0; 3] || b.angular != [0.0; 3])
        });
        if let Some(b) = moving {
            out.push(Refusal {
                code: "out_of_range",
                path: format!("bodies/{id}/velocity"),
                actual: json!({"linear": b.linear, "angular": b.angular}),
                what: format!("body {id} writes a velocity and an articulated joint holds it: a body of an articulation moves by its joints' coordinates alone, so the velocity would move nothing; start it at rest, or leave its joints separate"),
            });
        }
    }
    for (id, o) in &w.outputs {
        if o.read == Read::JointForce && w.joints.get(&o.from).is_some_and(|j| j.articulated) {
            out.push(Refusal {
                code: "out_of_range",
                path: format!("outputs/{id}/read"),
                actual: json!("joint_force"),
                what: format!("output {id} reads joint_force of articulated joint {}, whose bodies are placed from its coordinates, so it has no lock or limit impulse to read; read a separate joint's", o.from),
            });
        }
    }
    out
}

/// #2241: a belt is a surface of a static or kinematic body; a shape use of any other body whose
/// contact material carries a `tangent_speed` is refused, naming the field.
fn belts(w: &World) -> Vec<Refusal> {
    let mut out = Vec::new();
    for (id, b) in &w.bodies {
        if matches!(b.kind, BodyKind::Static | BodyKind::Kinematic) {
            continue;
        }
        for (i, u) in b.shapes.iter().enumerate() {
            let Some(m) = &u.material else { continue };
            let speed = w.contact_materials.get(m).map_or(0.0, |c| c.tangent_speed);
            if speed != 0.0 {
                out.push(Refusal {
                    code: "out_of_range",
                    path: format!("contact_materials/{m}/tangent_speed"),
                    actual: speed.into(),
                    what: format!("contact material {m} carries tangent_speed {speed} m/s, and shape {i} of body {id}, which is neither static nor kinematic, uses it; only a static or kinematic body's shape use carries a tangent_speed"),
                });
            }
        }
    }
    out
}

/// A world that builds more bodies than `capacity.bodies`, each element body of an `each:` body
/// counted (World: it can never grow past its capacity; #1921), or more soft-body particles than
/// `capacity.particles` (#524).
fn capacity(w: &World) -> Vec<Refusal> {
    let counts = [
        ("bodies", w.bodies.len()),
        (
            "particles",
            w.soft.values().map(|s| s.positions.len()).sum(),
        ),
    ];
    let mut out = Vec::new();
    for (key, n) in counts {
        let (Some(most), n) = (w.capacity.get(key).copied(), n as u64) else {
            continue;
        };
        if n > most {
            out.push(Refusal {
                code: "out_of_range",
                path: format!("capacity/{key}"),
                actual: most.into(),
                what: format!("capacity/{key} is {most}, below the {n} {key} this world builds; raise it to at least {n}"),
            });
        }
    }
    out
}

/// A spring or motor stiffer than the step resolves: above (step rate × substeps) ÷ 4 Hz (Joint);
/// and (#2309) a contact, a spring too, stiffer than the step settles: above a sixth.
fn springs(w: &World) -> Vec<Refusal> {
    let most = w.step_rate * f64::from(w.substeps) / 4.0;
    let mut out = Vec::new();
    let hz = w.solver.contact_hz;
    let settles = crate::doc::most_contact_hz(w.step_rate, f64::from(w.substeps));
    if hz > settles {
        out.push(Refusal {
            code: "out_of_range",
            path: "solver/contact_hz".into(),
            actual: hz.into(),
            what: format!("solver/contact_hz at {hz} Hz is stiffer than a contact settles at this step, so nothing on it ever rests: at most (step_rate × substeps) ÷ 6 = {settles} Hz"),
        });
    }
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
    // #524: a soft body's stretch, shear and bend are springs too.
    for (id, s) in &w.soft {
        for (field, k) in [("stretch", s.stretch), ("shear", s.shear), ("bend", s.bend)] {
            if k.hz > most {
                out.push(Refusal {
                    code: "out_of_range",
                    path: format!("soft/{id}/{field}/hz"),
                    actual: k.hz.into(),
                    what: format!("soft body {id}'s {field} at {} Hz is stiffer than the step resolves: at most (step_rate × substeps) ÷ 4 = {most} Hz", k.hz),
                });
            }
        }
    }
    out
}
