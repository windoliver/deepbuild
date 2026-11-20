//! #2717: the defaults run's part for what the physics module lists in `deep_kinds` through its
//! tool entries (tests/acceptance/2717/README.md: The surface under test). For the vehicle body
//! the run builds the behavior kit's fixture car with every field its entry prints a default for
//! left out, on the pinned backend, and reads the car's `vehicle` back as the world reader took
//! it. A field read back as other than the default its line prints fails the run, naming the
//! field at its wheel.

use deep_canvas::registry::Sealed;
use deep_canvas_physics::backend::Backend;
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::doc::{Refusal, Vehicle};
use deep_canvas_physics::kit::car_world;
use deep_canvas_physics::roles::TABLE;
use deep_physics_rapier::Rapier;
use serde_json::{json, Map, Value};

/// The entry the physics module lists the vehicle body under, and the fixture car's ID.
const ENTRY: &str = "body@1.vehicle";
const CAR: &str = "car";

/// What the planted world reader (`vehicle_reader_takes_other_defaults`) takes for each field of
/// `vehicle` left out, where the listing prints 0.3, 1, false, false, true and 35.
fn other_defaults() -> [(&'static str, Value); 6] {
    [
        ("vehicle.wheels.<name>.suspension.damping_ratio", json!(0.6)),
        ("vehicle.wheels.<name>.grip", json!(2)),
        ("vehicle.wheels.<name>.steers", json!(true)),
        ("vehicle.wheels.<name>.drives", json!(true)),
        ("vehicle.wheels.<name>.brakes", json!(false)),
        ("vehicle.steer_max", json!(30)),
    ]
}

/// Where a listed field's `path` leads in a body with `wheels`, as the JSON pointer of its
/// parent and its key: one place per wheel where `<name>` stands for a wheel's name.
fn places(path: &str, wheels: &[String]) -> Vec<(String, String)> {
    let (parent, key) = path.rsplit_once('.').unwrap_or(("", path));
    let parent = format!("/{}", parent.replace('.', "/"));
    if !parent.contains("<name>") {
        return vec![(parent, key.to_string())];
    }
    let at = |w: &String| (parent.replace("<name>", w), key.to_string());
    wheels.iter().map(at).collect()
}

/// The object at `parent` in the car `doc` holds.
fn object<'a>(doc: &'a mut Value, parent: &str) -> Option<&'a mut Map<String, Value>> {
    doc["bodies"][CAR].pointer_mut(parent)?.as_object_mut()
}

/// A vehicle's fields as the world reader took them, in the document's own shape.
fn taken(v: &Vehicle) -> Value {
    let wheel = |w: &deep_canvas_physics::doc::Wheel| {
        let suspension = json!({"rest": w.rest, "travel": w.travel, "hz": w.hz, "damping_ratio": w.damping_ratio});
        json!({"at": w.at, "radius": w.radius, "suspension": suspension, "grip": w.grip,
               "steers": w.steers, "drives": w.drives, "brakes": w.brakes})
    };
    let wheels: Map<String, Value> = (v.wheels.iter())
        .map(|(name, w)| (name.clone(), wheel(w)))
        .collect();
    json!({"wheels": wheels, "steer_max": v.steer_max})
}

/// `doc` read and checked by the world reader and built on the pinned backend: the IDs of the
/// bodies built and the car's `vehicle` as read, or why there is none.
fn built(doc: &Value) -> Result<(Vec<String>, Value), String> {
    let refused = |r: Vec<Refusal>| {
        let first = r.first();
        first.map_or_else(String::new, |r| {
            format!("{} at {}: {}", r.code, r.path, r.what)
        })
    };
    let w = check(doc, &RAPIER3D, &TABLE).map_err(refused)?;
    let mut b = Rapier::default();
    b.build(&w).map_err(refused)?;
    let read = w.bodies.get(CAR).and_then(|b| b.vehicle.as_ref());
    let read = read.ok_or_else(|| format!("the world reader read no vehicle on {CAR}"))?;
    Ok((b.built(), taken(read)))
}

/// The report's `lists`, the vehicle body's entry when this build lists it, and each field whose
/// value read back isn't the default its line prints. `planted` runs the planted world reader,
/// which reads the same document as if each field it leaves out were written with another value.
pub(crate) fn lists(sealed: &Sealed, planted: bool) -> (Vec<Value>, Vec<Value>) {
    let entries = sealed.modules.iter().flat_map(|m| &m.shapes.tool_entries);
    let listed = entries
        .filter(|t| t.tool == "deep_kinds")
        .filter_map(|t| serde_json::from_str::<Value>(&t.entry).ok())
        .find(|e| e["name"] == ENTRY);
    let Some(listed) = listed else {
        return (Vec::new(), Vec::new());
    };
    // The default each field's line prints after ` = `: a JSON value, or its text when it isn't.
    let fields = listed["fields"].as_object().into_iter().flatten();
    let printed: Vec<(&String, Value)> = fields
        .filter_map(|(path, line)| {
            let (_, default) = line.as_str()?.split_once(" = ")?;
            let value = serde_json::from_str(default).unwrap_or_else(|_| json!(default));
            Some((path, value))
        })
        .collect();
    let mut world = car_world(0.0);
    let wheels = world["bodies"][CAR]["vehicle"]["wheels"].as_object();
    let wheels: Vec<String> = wheels.into_iter().flat_map(Map::keys).cloned().collect();
    for (path, _) in &printed {
        for (parent, key) in places(path, &wheels) {
            if let Some(o) = object(&mut world, &parent) {
                o.remove(&key);
            }
        }
    }
    let mut read_as = world.clone();
    if planted {
        for (path, other) in other_defaults() {
            for (parent, key) in places(path, &wheels) {
                if let Some(o) = object(&mut read_as, &parent) {
                    o.entry(key).or_insert(other.clone());
                }
            }
        }
    }
    let mut entry = json!({"name": ENTRY, "world": world});
    let (bodies, read) = match built(&read_as) {
        Ok(b) => b,
        Err(why) => {
            let what =
                format!("{ENTRY}: the car with each listed default left out isn't built: {why}");
            return (vec![entry], vec![json!({"kind": ENTRY, "what": what})]);
        }
    };
    let body = json!({"vehicle": read});
    let same = |a: &Value, b: &Value| match (a.as_f64(), b.as_f64()) {
        (Some(a), Some(b)) => a == b,
        _ => a == b,
    };
    let mut failures = Vec::new();
    for (path, default) in &printed {
        for (parent, key) in places(path, &wheels) {
            let at = format!("{parent}/{key}");
            let read = body.pointer(&at).cloned().unwrap_or(Value::Null);
            if !same(&read, default) {
                let at = at[1..].replace('/', ".");
                let what = format!(
                    "{ENTRY}: {at} left out reads back {read}, where deep_kinds prints {default}"
                );
                failures.push(json!({"kind": ENTRY, "field": path, "path": at, "listed": default, "read": read, "what": what}));
            }
        }
    }
    (entry["built"], entry["read"]) = (json!(bodies), body["vehicle"].clone());
    (vec![entry], failures)
}
