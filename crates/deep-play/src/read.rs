//! What a frame holds, read as the app's `eval` reads it (#497's `arrays`, #1918's `paths`), so
//! the web player's `probe()` reads the same values the app does (#172).

use deep_canvas::schedule::core_ops::{Fields, Transform};
use deep_canvas::schedule::{Key, Scheduler, Session};
use serde_json::{json, Value};

/// `items/<id>/<field…>` split at the item.
pub fn item_path(path: &str) -> Option<(&str, &str)> {
    path.strip_prefix("items/")?.split_once('/')
}

/// The JSON at a `/`-separated field path.
pub fn at_field<'v>(value: &'v Value, field: &str) -> Option<&'v Value> {
    field.split('/').try_fold(value, |v, part| match v {
        Value::Array(list) => list.get(part.parse::<usize>().ok()?),
        Value::Object(map) => map.get(part),
        _ => None,
    })
}

/// Item `id`'s evaluated `field` in `s`: its transform's `at/…`, or one of its fields, with the
/// keys of what made it (`deep_query`'s read, and #1918's `eval` `paths`).
pub fn item_value(
    sched: &Scheduler<'_>,
    s: &Session,
    id: &str,
    field: &str,
) -> Option<(Value, Vec<Key>)> {
    // #142: the whole `at` reads the evaluated transform too, as each of its fields does.
    let (array, rest) = match field.strip_prefix("at/") {
        Some(rest) => ("core.transform", rest),
        None if field == "at" => ("core.transform", ""),
        None => ("core.fields", field),
    };
    let (val, keys) = s.read(sched, array, Some(id))?;
    let value = match array {
        "core.transform" => {
            let t = val.as_typed::<Transform>()?;
            let mut at = json!({"pos": t.pos, "rot": t.rot, "scale": t.scale});
            if rest.is_empty() {
                if let Some(p) = t.pivot {
                    at["pivot"] = json!(p);
                }
                return Some((at, keys));
            }
            at_field(&at, rest)?.clone()
        }
        _ => at_field(&val.as_typed::<Fields>()?.to_json(), rest)?.clone(),
    };
    Some((value, keys))
}

/// #1918: each item path's value in `s` (`eval`'s `paths`), read as `deep_query` reads one, null
/// for a path it can't read.
pub fn values(sched: &Scheduler<'_>, s: &Session, paths: &[String]) -> Value {
    let read = |p: &String| {
        let (id, field) = item_path(p)?;
        // #1921: a field the core's lowered form doesn't hold, such as a 3D kind's params, reads
        // as the frame's document holds it, an instancer's columns a world writes included.
        let drawn = || at_field(s.document()?.get("items")?.get(id)?, field).cloned();
        // #222: a path channel's target `path` reads as what the item draws, its `d`.
        let outline = || {
            let (v, _) = item_value(sched, s, id, "params")?;
            v.get("d").or_else(|| v.pointer("/outline/d")).cloned()
        };
        item_value(sched, s, id, field)
            .map(|(v, _)| v)
            .or_else(drawn)
            .or_else(|| (field == "path").then(outline).flatten())
    };
    Value::Object(
        paths
            .iter()
            .map(|p| (p.clone(), read(p).unwrap_or(Value::Null)))
            .collect(),
    )
}

/// Array `name` as the frame at `t` read it (`eval`'s `arrays`): a count-1 i64 or f64 array, a
/// logic item's array `<logic ID>.<name>` of count 1 as the logic module's last step at or before
/// the frame left it, or the document's baked array (a spectrum's bands) at `t`; null otherwise.
pub fn array(sched: &Scheduler<'_>, s: &Session, name: &str, t: i64) -> Value {
    let v = s.array(sched, name);
    let n = v
        .as_ref()
        .and_then(|v| v.as_typed::<i64>())
        .map(|n| json!(*n));
    let x = v
        .as_ref()
        .and_then(|v| v.as_typed::<f64>())
        .map(|x| json!(*x));
    let logic = || {
        let state = s.array(sched, deep_logic::module::STATE)?;
        let state = state.as_typed::<deep_logic::module::State>()?;
        match state.arrays.get(name)?.as_slice() {
            [one] => Some(one.clone()),
            _ => None,
        }
    };
    let bands = || {
        s.document()
            .and_then(|d| deep_canvas::columns::map(d.get("arrays")?.get(name)?, t, None, false))
            .map(|m| json!(m.values))
    };
    n.or(x).or_else(logic).or_else(bands).unwrap_or(Value::Null)
}
