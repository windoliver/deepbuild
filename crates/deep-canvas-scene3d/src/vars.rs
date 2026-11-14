//! A formula's vars bound to numbers at t (issue #224; canvas primitives: Builder `surface`,
//! Curve `curve@1`'s `fn`): before anything reads a `surface@1` or a `curve@1` with `fn`, each
//! var naming a path is replaced by its value, so a builder is a pure function of its params and
//! a seek to t gives what playing to t gives. A var reads `t` (seconds), a control's value
//! (`controls/<id>/value`: the input track's last entry at or before t, else its default), a
//! keyed data value (`data/<name>`, which a channel may target), a channel (`channels/<id>`), or
//! an item's evaluated field (`items/<id>/<field>`).

use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, State};
use serde_json::{Map, Value};

use crate::scene::Refused;

use crate::surface::KEEPS_FIRST;

/// Where an item's vars sit, when it has a formula with vars.
fn pointer(item: &Value) -> Option<&'static str> {
    match item.get("kind").and_then(Value::as_str)? {
        "surface@1" => Some("/params/vars"),
        "curve@1" if item.pointer("/params/fn").is_some() => Some("/params/fn/vars"),
        _ => None,
    }
}

/// Whether an item's formula reads a var by its path, so its build follows the frame.
pub fn reads(item: &Value) -> bool {
    pointer(item)
        .and_then(|p| item.pointer(p))
        .and_then(Value::as_object)
        .is_some_and(|o| o.values().any(Value::is_string))
}

/// A var's value at `t`.
fn value(
    path: &str,
    map: &Map<String, Value>,
    program: &Program,
    state: &State,
    t: i64,
) -> Option<f64> {
    if path == "t" {
        return Some(t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64);
    }
    if let Some(id) = path
        .strip_prefix("controls/")
        .and_then(|p| p.strip_suffix("/value"))
    {
        let last = program
            .options
            .input
            .iter()
            .filter(|e| e.control == id && e.t <= t)
            .max_by_key(|e| e.key());
        return match last {
            Some(e) => e.value.as_f64(),
            None => map.get("controls")?.get(id)?.get("default")?.as_f64(),
        };
    }
    if let Some(id) = path.strip_prefix("channels/") {
        return program.channel_value(state, id);
    }
    // A keyed data value, as 2D path@1's fn reads one: its slot at t, else its value.
    if let Some(name) = path.strip_prefix("data/") {
        if let Some(f) = program
            .fields
            .iter()
            .find(|f| f.data.as_deref() == Some(name))
        {
            return state.slots.get(f.slot).copied();
        }
        let d = map.get("data")?.get(name)?;
        return d.get("value").unwrap_or(d).as_f64();
    }
    let (id, field) = path.strip_prefix("items/")?.split_once('/')?;
    let parts: Vec<String> = field.split('/').map(str::to_string).collect();
    match program.slot_of(id, &parts) {
        Some(s) => state.slots.get(s).copied(),
        None => map
            .get("items")?
            .get(id)?
            .pointer(&format!("/{field}"))?
            .as_f64(),
    }
}

/// `map` with every formula's vars bound to numbers at `t` (at 0 under the planted build that
/// keeps its first mesh), or `None` when no item reads one; a var that reads nothing is refused.
pub fn lowered(
    map: &Map<String, Value>,
    program: &Program,
    state: &State,
    t: i64,
    planted: Option<&str>,
) -> Result<Option<Map<String, Value>>, Refused> {
    let Some(items) = map.get("items").and_then(Value::as_object) else {
        return Ok(None);
    };
    if !items.values().any(reads) {
        return Ok(None);
    }
    let first;
    let (state, t) = if planted == Some(KEEPS_FIRST) {
        let mut s = program.state();
        program.evaluate_local(0, Validity::Full, &mut s);
        first = s;
        (&first, 0)
    } else {
        (state, t)
    };
    let mut out = map.clone();
    let list = out
        .get_mut("items")
        .and_then(Value::as_object_mut)
        .expect("items");
    for (id, item) in list.iter_mut() {
        let Some(p) = pointer(item).filter(|_| reads(item)) else {
            continue;
        };
        let vars = item
            .pointer_mut(p)
            .and_then(Value::as_object_mut)
            .expect("vars");
        for (name, v) in vars.iter_mut() {
            let Value::String(path) = v else { continue };
            let x = value(path, map, program, state, t).ok_or_else(|| Refused {
                code: "ref_unresolved",
                path: format!("items/{id}{p}/{name}"),
            })?;
            *v = Value::from(x);
        }
    }
    Ok(Some(out))
}

/// The document with its formulas' vars bound at `t`, or `None` when nothing reads one.
pub fn at(doc: &Value, t: i64, planted: Option<&str>) -> Result<Option<Value>, Refused> {
    let Some(map) = doc.as_object() else {
        return Ok(None);
    };
    let reading = map
        .get("items")
        .and_then(Value::as_object)
        .is_some_and(|i| i.values().any(reads));
    if !reading {
        return Ok(None);
    }
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    Ok(lowered(map, &program, &state, t, planted)?.map(Value::Object))
}
