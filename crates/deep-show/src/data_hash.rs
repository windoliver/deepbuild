//! #222's evaluated-data hash: `eval`'s `data_hash`, a digest of what each drawn item evaluates
//! to at t (its transform and the fields it draws with, opacity, paint, bounds and shape params),
//! by item ID, and nothing about how a value was made: no document field, channel, cue, key or
//! marker, and no item that draws nothing. A value written at its default hashes as unwritten, so
//! a path build that has ended (a trim from 0 to 1) or an opacity of 1 hash as no write at all.

use deep_canvas::schedule::core_ops::{Fields, Transform};
use deep_canvas::schedule::{canonical, sha256_hex, Session as DocSession};
use serde_json::{json, Map, Value};

/// The color adjustments at their defaults (Adjust), which change nothing.
const ADJUST_DEFAULTS: [(&str, f64); 7] = [
    ("opacity", 1.0),
    ("hue", 0.0),
    ("saturation", 1.0),
    ("brightness", 1.0),
    ("contrast", 1.0),
    ("exposure", 0.0),
    ("gamma", 1.0),
];

/// The fields that name or file an item rather than draw it.
const LABELS: [&str; 6] = ["id", "name", "order", "layer", "description", "locked"];

/// The hex digest of every drawn item's evaluated data in `s` at its frame.
pub(crate) fn of(sched: &deep_canvas::schedule::Scheduler<'_>, s: &DocSession) -> Option<String> {
    let items = s.document()?.get("items")?.as_object()?;
    let mut out = Map::new();
    for (id, item) in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        if kind.starts_with("camera") || kind == "cues@1" {
            continue;
        }
        let at = s
            .read(sched, "core.transform", Some(id))
            .and_then(|(v, _)| {
                v.as_typed::<Transform>()
                    .map(|t| json!({"pos": t.pos, "rot": t.rot, "scale": t.scale}))
            });
        let mut fields = s
            .read(sched, "core.fields", Some(id))
            .and_then(|(v, _)| v.as_typed::<Fields>().map(|f| f.to_json()))
            .unwrap_or_else(|| item.clone());
        unwritten_defaults(&mut fields);
        out.insert(id.clone(), json!({"at": at, "fields": fields}));
    }
    Some(sha256_hex(&canonical(&Value::Object(out))))
}

/// Drops what an item holds at its default: its labels, an opacity of 1, and path ops that change
/// nothing (a trim from 0 to 1 with no offset), then whatever that leaves empty.
fn unwritten_defaults(fields: &mut Value) {
    let Some(map) = fields.as_object_mut() else {
        return;
    };
    for label in LABELS {
        map.remove(label);
    }
    map.remove("at");
    if let Some(adjust) = map.get_mut("adjust").and_then(Value::as_object_mut) {
        for (k, d) in ADJUST_DEFAULTS {
            if adjust.get(k).and_then(Value::as_f64) == Some(d) {
                adjust.remove(k);
            }
        }
    }
    if map
        .get("adjust")
        .and_then(Value::as_object)
        .is_some_and(Map::is_empty)
    {
        map.remove("adjust");
    }
    let params = map.get_mut("params").and_then(Value::as_object_mut);
    if let Some(params) = params {
        if let Some(ops) = params.get_mut("ops").and_then(Value::as_array_mut) {
            ops.retain(|op| !identity(op));
            if ops.is_empty() {
                params.remove("ops");
            }
        }
    }
}

/// A path op that leaves its path as it is: none, or a trim from 0 to 1 with no offset.
fn identity(op: &Value) -> bool {
    let Some(trim) = op
        .get("trim")
        .filter(|_| op.as_object().is_some_and(|o| o.len() == 1))
    else {
        return op.is_null();
    };
    let at = |k: &str, d: f64| trim.get(k).map_or(Some(d), Value::as_f64) == Some(d);
    trim.as_object().is_some_and(|t| {
        t.keys()
            .all(|k| ["start", "end", "offset"].contains(&k.as_str()))
    }) && at("start", 0.0)
        && at("end", 1.0)
        && at("offset", 0.0)
}
