//! #1921: bodies a world builds from its scene's items. A body with `item: ID` is bound to that
//! item and built at its world position and rotation at t = 0; one with `each: instancer ID` is
//! one body per element of the scene's `instance@1` item, `<body>#<element id>`, each with the
//! body's own fields, built at its element's row. Scale stays out of physics: an item, an
//! instancer or an element whose transform scales it is refused, naming it and the scale, so a
//! drawn mesh's scale never reaches a collider; shapes carry their sizes in metres.

use std::collections::BTreeSet;

use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, TRANSFORM};
use deep_canvas_physics::check::SCALED;
use deep_canvas_physics::doc::Refusal;
use serde_json::{json, Map, Value};

/// The issue that brings `each:` over an instancer that is moved, turned or scattered.
const PLACED_LATER: &str = "#2288";

fn refusal(code: &'static str, path: String, actual: &Value, what: String) -> Refusal {
    Refusal {
        code,
        path,
        actual: actual.clone(),
        what,
    }
}

/// A rotation of Euler degrees about X, then Y, then Z in fixed axes (R = Rz·Ry·Rx, Units and
/// conventions) as a quaternion `[x, y, z, w]`.
fn quat(d: &[f64]) -> [f64; 4] {
    let h = |a: f64| (a.to_radians() / 2.0).sin_cos();
    let ((sx, cx), (sy, cy), (sz, cz)) = (h(d[0]), h(d[1]), h(d[2]));
    [
        cz * cy * sx - sz * sy * cx,
        cz * sy * cx + sz * cy * sx,
        sz * cy * cx - cz * sy * sx,
        cz * cy * cx + sz * sy * sx,
    ]
}

/// The numbers of `v`, an array of `n` of them.
fn numbers(v: &Value, n: usize) -> Option<Vec<f64>> {
    let a = v.as_array().filter(|a| a.len() == n)?;
    a.iter().map(Value::as_f64).collect()
}

/// One element's pose and scale from an instancer's columns: `pos`, `rot` (a quaternion) or
/// `yaw` (deg about +Y), and `scale` (a vec3 or one number a row, or one for all).
fn element(params: &Map<String, Value>, row: usize) -> Option<(Vec<f64>, [f64; 4], Vec<f64>)> {
    let pos = match params.get("pos") {
        Some(c) => numbers(c.get(row)?, 3)?,
        None => vec![0.0; 3],
    };
    let rot = match (params.get("rot"), params.get("yaw")) {
        (Some(c), _) => {
            let q = numbers(c.get(row)?, 4)?;
            [q[0], q[1], q[2], q[3]]
        }
        (None, Some(c)) => quat(&[0.0, c.get(row)?.as_f64()?, 0.0]),
        (None, None) => [0.0, 0.0, 0.0, 1.0],
    };
    let scale = match params.get("scale") {
        None => vec![1.0; 3],
        Some(Value::Number(n)) => vec![n.as_f64()?; 3],
        Some(c) => match c.get(row)? {
            Value::Number(n) => vec![n.as_f64()?; 3],
            v => numbers(v, 3)?,
        },
    };
    Some((pos, rot, scale))
}

/// `doc`, a world document, with each body bound to `scene`'s items expanded: an `item:` body
/// posed at its item, an `each:` body replaced by its element bodies; unchanged when no body binds.
/// Without a scene, or with a binding that can't build, the refusals naming each.
pub fn expand(scene: Option<&Value>, doc: &Value) -> Result<Value, Vec<Refusal>> {
    // #524: its closed soft bodies' meshes first (source.rs).
    let doc = &crate::source::expand(scene, doc)?;
    let Some(bodies) = doc.get("bodies").and_then(Value::as_object) else {
        return Ok(doc.clone());
    };
    let binds = |b: &Value| b.get("item").is_some() || b.get("each").is_some();
    if !bodies.values().any(binds) {
        return Ok(doc.clone());
    }
    let Some(scene) = scene.and_then(Value::as_object) else {
        let out = bodies.iter().filter(|(_, b)| binds(b)).map(|(id, b)| {
            let key = if b.get("item").is_some() { "item" } else { "each" };
            let what = format!("body {id}'s {key} names an item of the world's scene, and this world isn't read in a scene");
            refusal("ref_unresolved", format!("bodies/{id}/{key}"), &b[key], what)
        });
        return Err(out.collect());
    };
    let program = Program::compile(scene).map_err(|r| {
        let what = format!("the scene's motion refuses it: {} at {}", r.code, r.path);
        vec![refusal(r.code, r.path, &Value::Null, what)]
    })?;
    let mut state = program.state();
    program.evaluate(0, Validity::Full, &mut state);
    // An item's position, rotation (deg) and scale at t = 0.
    let at = |id: &str| {
        let i = program.items.iter().position(|x| x == id)?;
        Some(state.slots[i * TRANSFORM..i * TRANSFORM + 9].to_vec())
    };
    let items = scene.get("items").and_then(Value::as_object);
    let mut out = Vec::new();
    let mut expanded = Map::new();
    for (id, b) in bodies {
        let p = format!("bodies/{id}");
        let (item, each) = (b.get("item"), b.get("each"));
        let mut fields = b.as_object().cloned().unwrap_or_default();
        if item.is_none() && each.is_none() {
            expanded.insert(id.clone(), b.clone());
            continue;
        }
        if item.is_some() && each.is_some() || b.get("pose").is_some() {
            let what = format!("body {id} takes its pose from its item or its elements: one of item and each, and no pose");
            out.push(refusal("out_of_range", p, b, what));
            continue;
        }
        fields.remove("item");
        fields.remove("each");
        let key = if item.is_some() { "item" } else { "each" };
        let named = item.or(each).unwrap_or(&Value::Null);
        let name = named.as_str().unwrap_or_default();
        let kind = items.and_then(|m| m.get(name)).map(|i| &i["kind"]);
        let transform =
            at(name).filter(|_| kind.is_some_and(|k| each.is_none() || k == "instance@1"));
        let Some(t) = transform else {
            let what = match key {
                "item" => format!("{named} is not an item of the world's scene"),
                _ => format!("{named} is not an instance@1 item of the world's scene"),
            };
            out.push(refusal("ref_unresolved", format!("{p}/{key}"), named, what));
            continue;
        };
        if t[6..9].iter().any(|s| *s != 1.0) {
            let what = format!("body {id} is bound to {name}, whose world transform scales it by {:?}; scale stays out of physics", &t[6..9]);
            out.push(refusal(SCALED, format!("{p}/{key}"), &json!(t[6..9]), what));
            continue;
        }
        if item.is_some() {
            fields.insert(
                "pose".into(),
                json!({"pos": t[0..3], "rot": quat(&t[3..6])}),
            );
            expanded.insert(id.clone(), Value::Object(fields));
            continue;
        }
        let params = items.and_then(|m| m[name]["params"].as_object());
        let params = params.cloned().unwrap_or_default();
        if t[0..6].iter().any(|x| *x != 0.0) || params.contains_key("from") {
            let what = format!("each: over an instancer that is moved, turned or scattered isn't run by this backend interface yet; {PLACED_LATER} brings it (place {name} at the origin with its own ids and pos)");
            out.push(refusal(
                "physics.unsupported",
                format!("{p}/each"),
                named,
                what,
            ));
            continue;
        }
        let rows = match (params.get("ids"), params.get("pos")) {
            (Some(Value::Array(ids)), _) => ids.len(),
            (None, Some(Value::Array(pos))) => pos.len(),
            _ => 0,
        };
        let mut seen = BTreeSet::new();
        for row in 0..rows {
            let e = match params.get("ids") {
                Some(ids) => ids[row].as_u64().filter(|e| *e <= u64::from(u32::MAX)),
                None => Some(row as u64),
            };
            let at = format!("items/{name}/params");
            let Some((e, (pos, rot, scale))) = e
                .zip(element(&params, row))
                .filter(|(e, _)| seen.insert(*e))
            else {
                let what = format!(
                    "{name}'s row {row} isn't an element: a new u32 ID with its pos, rot and scale"
                );
                out.push(refusal("out_of_range", at, &json!(row), what));
                break;
            };
            if scale.iter().any(|s| *s != 1.0) {
                let what = format!("body {id} is built per element of {name}, whose element {e} is scaled by {scale:?}; scale stays out of physics");
                out.push(refusal(SCALED, format!("{p}/each"), &json!(scale), what));
                break;
            }
            let mut body = fields.clone();
            body.insert("pose".into(), json!({"pos": pos, "rot": rot}));
            expanded.insert(format!("{id}#{e}"), Value::Object(body));
        }
    }
    if !out.is_empty() {
        return Err(out);
    }
    let mut doc = doc.clone();
    doc["bodies"] = Value::Object(expanded);
    Ok(doc)
}
