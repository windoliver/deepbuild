//! What the loop's checks on evaluated data share (#1938): the document evaluated on the CPU at a
//! checked time, the times a check input names, and the kept items it is about.

use std::collections::BTreeMap;

use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{self, Labels, Scene};
use serde_json::{json, Value};

/// A blocked row: what a check couldn't read, naming its kind, the IDs and the path.
pub(crate) fn blocked(code: &str, kind: &str, ids: &[String], path: &str) -> Value {
    json!({"code": code, "kind": kind, "ids": ids, "path": path})
}

/// Every role a document's items name, each grey: the evaluation paints with them, and no check
/// on evaluated data reads a color.
fn look_of(doc: &Value) -> Look3 {
    fn roles(v: &Value, out: &mut BTreeMap<String, [u8; 3]>) {
        match v {
            Value::Object(m) => {
                for (k, v) in m {
                    if let (true, Some(r)) = (k == "role", v.as_str()) {
                        out.insert(r.to_string(), [128, 128, 128]);
                    }
                    roles(v, out);
                }
            }
            Value::Array(a) => a.iter().for_each(|v| roles(v, out)),
            _ => {}
        }
    }
    let mut out: BTreeMap<String, [u8; 3]> = ["ground", "ink", "muted", "accent"]
        .into_iter()
        .map(|r| (r.to_string(), [128, 128, 128]))
        .collect();
    roles(doc.get("items").unwrap_or(&Value::Null), &mut out);
    Look3::from_roles(out)
}

/// `doc` at `t` as scene3d evaluates it, its assets read from the check input's `assets`; what
/// it refuses, as a blocked row of `kind`.
pub(crate) fn evaluate(doc: &Value, input: &Value, t: i64, kind: &str) -> Result<Scene, Value> {
    let read = |sha: &str| {
        input
            .pointer(&format!("/assets/{sha}"))
            .and_then(Value::as_str)
            .and_then(deep_canvas::base64::decode)
    };
    // Where things are reads no color: a mark that names no paint and no material is painted
    // in a stand-in role, as the geometry audit reads it unpainted.
    let mut doc = doc.clone();
    for item in doc
        .get_mut("items")
        .and_then(Value::as_object_mut)
        .into_iter()
        .flat_map(|m| m.values_mut())
    {
        let mark = item
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|k| k.starts_with("mark."));
        if mark && item.get("material").is_none() && item.pointer("/params/paint").is_none() {
            item["params"]["paint"] = json!({"fill": {"role": "ink"}});
        }
    }
    scene::evaluate_with(&doc, t, &look_of(&doc), &mut Labels::new(), &read)
        .map_err(|r| blocked(r.code, kind, &[], &r.path))
}

/// `doc` with a stand-in camera where it names none, for what reads no camera, such as an
/// item's size (as #226's geometry rows do).
pub(crate) fn camera_free(doc: &Value) -> Value {
    let mut doc = doc.clone();
    if camera_of(&doc).is_none() {
        let id = "\u{0}camera";
        doc["camera"] = json!(id);
        doc["items"][id] = json!({"id": id, "kind": "camera@1", "params": {"projection": "orthographic",
            "view_width": 10, "target": [0, 0, 0], "position": [0, 0, 10]}});
    }
    if doc.get("size").is_none() {
        doc["size"] = json!([640, 360]);
    }
    doc
}

/// The times a check input's `at_times` names, in flicks (a time in the grammar at 60 fps, or
/// flicks), else the start.
pub(crate) fn times(input: &Value, kind: &str) -> Result<Vec<i64>, Value> {
    let Some(list) = input.get("at_times") else {
        return Ok(vec![0]);
    };
    let ctx = TimeContext {
        frame_rate: (60, 1),
        ..TimeContext::default()
    };
    let one = |t: &Value| {
        t.as_i64().or_else(|| {
            let text = t.as_str()?;
            Time::parse(text).ok()?.resolve(&ctx).ok()
        })
    };
    let ts: Option<Vec<i64>> = list
        .as_array()
        .and_then(|a| a.iter().map(one).collect::<Option<Vec<i64>>>());
    match ts {
        Some(ts) if !ts.is_empty() => Ok(ts),
        _ => Err(blocked("out_of_range", kind, &[], "at_times")),
    }
}

/// The items a check is about, from its input's `field`: a list of IDs, a collection's name, or
/// `kept` (the default), the kept items of the document's camera, `fit.keep`. None is BLOCKED,
/// never a pass.
pub(crate) fn kept(
    doc: &Value,
    input: &Value,
    field: &str,
    kind: &str,
) -> Result<Vec<String>, Value> {
    let ids = |v: &Value| -> Option<Vec<String>> {
        v.as_array()?
            .iter()
            .map(|s| s.as_str().map(str::to_string))
            .collect()
    };
    let refused = || blocked("out_of_range", kind, &[], field);
    let listed = match input.get(field) {
        Some(Value::String(s)) if s == "kept" => None,
        None => None,
        Some(Value::String(name)) => Some(
            doc.pointer(&format!("/collections/{name}/members"))
                .and_then(ids)
                .ok_or_else(refused)?,
        ),
        Some(v) => Some(ids(v).ok_or_else(refused)?),
    };
    let keep = match listed {
        Some(k) => k,
        None => camera_of(doc)
            .and_then(|(_, c)| c.pointer("/params/fit/keep"))
            .and_then(ids)
            .unwrap_or_default(),
    };
    if keep.is_empty() {
        return Err(blocked("no_subject", kind, &[], field));
    }
    Ok(keep)
}

/// The document's camera: the item its envelope's `camera` names, with its ID.
pub(crate) fn camera_of(doc: &Value) -> Option<(String, &Value)> {
    let id = doc.get("camera")?.as_str()?;
    let item = doc.get("items")?.get(id)?;
    (item.get("kind").and_then(Value::as_str) == Some("camera@1")).then(|| (id.to_string(), item))
}

/// Whether the solid `solid` draws the item `id`: its own, or a part of it (`id#…`).
pub(crate) fn is_of(solid: &str, id: &str) -> bool {
    solid == id
        || solid
            .strip_prefix(id)
            .is_some_and(|rest| rest.starts_with('#'))
}

/// `doc` with `value` set at the item path `path` (`items/<id>/…`): a fix applied to a copy, so a
/// check names only a fix that its own measure passes.
pub(crate) fn with_set(doc: &Value, path: &str, value: Value) -> Value {
    let mut out = doc.clone();
    let mut at = &mut out;
    let parts: Vec<&str> = path.split('/').collect();
    for (k, p) in parts.iter().enumerate() {
        if k + 1 == parts.len() {
            if let Some(m) = at.as_object_mut() {
                m.insert((*p).to_string(), value);
            }
            break;
        }
        if at.get(*p).is_none() {
            if let Some(m) = at.as_object_mut() {
                m.insert((*p).to_string(), json!({}));
            }
        }
        match at.get_mut(*p) {
            Some(next) => at = next,
            None => break,
        }
    }
    out
}
