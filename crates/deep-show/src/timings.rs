//! #538: `frames`' `timings`, the proof readings of the live-game-state budgets. `compares`: each
//! logic step whose arrays a frame applies first, with the bytes its item wrote and the time the
//! logic module took comparing them with their values after the step before, which the bake
//! recorded where the step ran. `remaps[].ms`: the time remapping a mark set's array columns took
//! this frame, measured by running the data module's own mapping (the core's column view, from
//! the frame before's mapping) on the same inputs again, since a canvas module reads no clock.

use std::collections::BTreeMap;

use deep_canvas::columns::{map, Mapped};
use deep_canvas::schedule::{Scheduler, Session};
use serde_json::{json, Value};

/// Each mark set's array columns as the data module last mapped them, by set and column path.
pub(crate) type Mappings = BTreeMap<String, BTreeMap<String, Mapped>>;

pub(crate) fn mappings(sched: &Scheduler<'_>, session: &Session) -> Mappings {
    let mut out = Mappings::new();
    for n in session.nodes(sched) {
        let (Some(set), true) = (&n.item, n.operator == "data.columns") else {
            continue;
        };
        if let Some(m) = n.values.iter().find_map(|v| v.as_typed::<BTreeMap<String, Mapped>>()) {
            out.insert(set.clone(), (*m).clone());
        }
    }
    out
}

/// Adds `ms` to each of `remaps`' entries: the time mapping its set's columns at `t` takes from
/// `before`, the mappings the frame started from.
pub(crate) fn time_remaps(remaps: &mut Value, doc: &Value, before: &Mappings, after: &Mappings, t: i64) {
    let mut ms: BTreeMap<String, f64> = BTreeMap::new();
    for (set, columns) in after {
        let started = std::time::Instant::now();
        for key in columns.keys() {
            if let Some(column) = doc.pointer(&format!("/items/{set}/{key}")) {
                let last = before.get(set).and_then(|m| m.get(key));
                std::hint::black_box(map(column, t, last, false));
            }
        }
        ms.insert(set.clone(), started.elapsed().as_secs_f64() * 1000.0);
    }
    for r in remaps.as_array_mut().into_iter().flatten() {
        let set = r["set"].as_str().unwrap_or_default();
        r["ms"] = json!(ms.get(set).copied().unwrap_or(0.0));
    }
}

/// The compares a frame at `t` applies first: each logic item's steps after the one its last
/// frame here applied (`seen`, updated), up to the frame's own; a first frame applies its own.
pub(crate) fn compares(doc: &Value, t: i64, seen: &mut BTreeMap<String, i64>) -> Value {
    let mut out = Vec::new();
    for (name, a) in doc.get("arrays").and_then(Value::as_object).into_iter().flatten() {
        let Some(list) = a.get("compares").and_then(Value::as_array) else { continue };
        let logic = name.split('.').next().unwrap_or_default().to_string();
        let k = t.div_euclid(a["every"].as_i64().unwrap_or(1).max(1));
        let from = seen.get(&logic).copied().unwrap_or(k - 1);
        for c in list {
            let step = c[0].as_i64().unwrap_or(-1);
            if step > from && step <= k {
                out.push(json!({"logic": logic, "step": step, "bytes": c[1], "ms": c[2]}));
            }
        }
        seen.insert(logic, k);
    }
    Value::Array(out)
}

/// A frame's `timings` fields, for `frame` (a `frames` entry).
pub(crate) fn add(frame: &mut Value, timed: (&Value, &Mappings, &Mappings, i64), seen: &mut BTreeMap<String, i64>) {
    let (doc, before, after, t) = timed;
    frame["compares"] = compares(doc, t, seen);
    let mut remaps = frame["remaps"].take();
    time_remaps(&mut remaps, doc, before, after, t);
    frame["remaps"] = remaps;
}
