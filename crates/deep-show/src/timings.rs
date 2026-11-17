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
        if let Some(m) = n
            .values
            .iter()
            .find_map(|v| v.as_typed::<BTreeMap<String, Mapped>>())
        {
            out.insert(set.clone(), (*m).clone());
        }
    }
    out
}

/// Adds `ms` to each of `remaps`' entries: the time mapping its set's columns at `t` takes from
/// `before`, the mappings the frame started from.
pub(crate) fn time_remaps(
    remaps: &mut Value,
    doc: &Value,
    before: &Mappings,
    after: &Mappings,
    t: i64,
) {
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
    for (name, a) in doc
        .get("arrays")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(list) = a.get("compares").and_then(Value::as_array) else {
            continue;
        };
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

/// #1968: `tokens`, each code item's tokens mapped to runs in the session's look as a change to the
/// item maps them (its display form, its tokens' spans, their runs); and `aligns`, each text diff's
/// two versions read and aligned as the check aligns them. Each is timed by doing the module's own
/// work on the frame's inputs again.
pub(crate) fn code(sched: &Scheduler<'_>, session: &Session, doc: &Value) -> (Value, Value) {
    use deep_canvas_marks::scene::object_or_empty;
    use deep_canvas_marks::{code, diff, modules::LookValue};
    let look = session
        .value(sched, "look.palette", None)
        .and_then(|v| v.as_typed::<LookValue>());
    let items = doc["items"].as_object();
    let params =
        |id: &str| object_or_empty(items.and_then(|i| i.get(id)).and_then(|i| i.get("params")));
    let ms = |started: std::time::Instant| started.elapsed().as_secs_f64() * 1000.0;
    let mut tokens = Vec::new();
    for (id, item) in items.into_iter().flatten() {
        let (Some(look), true) = (
            &look,
            item["kind"] == "text@1" && params(id).contains_key("code"),
        ) else {
            continue;
        };
        let path = format!("items/{id}");
        let started = std::time::Instant::now();
        let d = code::read(params(id), &path).ok().flatten();
        std::hint::black_box(
            code::runs(
                (&look.palette, &look.ty),
                params(id),
                d.as_ref(),
                &path,
                Vec::new(),
            )
            .ok(),
        );
        tokens.push(json!({"item": id, "ms": ms(started)}));
    }
    let mut aligns = Vec::new();
    for (id, tr) in doc["transitions"].as_object().into_iter().flatten() {
        let (Some(from), Some(to), true) = (
            tr["from"].as_str(),
            tr["to"].as_str(),
            tr["kind"] == "text_diff",
        ) else {
            continue;
        };
        let started = std::time::Instant::now();
        if let (Ok(Some(old)), Ok(Some(new))) = (
            diff::Version::read(params(from), ""),
            diff::Version::read(params(to), ""),
        ) {
            std::hint::black_box(diff::matching(&old, &new));
        }
        aligns.push(json!({"transition": id, "ms": ms(started)}));
    }
    (Value::Array(tokens), Value::Array(aligns))
}

/// A frame's `timings` fields, for `frame` (a `frames` entry).
pub(crate) fn add(
    frame: &mut Value,
    timed: (&Value, &Mappings, &Mappings, i64),
    seen: &mut BTreeMap<String, i64>,
) {
    let (doc, before, after, t) = timed;
    frame["compares"] = compares(doc, t, seen);
    let mut remaps = frame["remaps"].take();
    time_remaps(&mut remaps, doc, before, after, t);
    frame["remaps"] = remaps;
}
