//! The `(ID, path)` pairs a patch writes and a revision wrote, and the planted merge by path.

use super::*;

/// The `(ID, path)` pairs a patch's ops write, the path below the item; `None` when an op writes
/// a whole item (a create, delete, move or reorder).
pub(super) fn written_paths(patch: &Value) -> Option<Paths> {
    let mut out = Paths::new();
    for op in patch["ops"].as_array()? {
        let (Some("set" | "unset"), Some(id), Some(path)) =
            (op["op"].as_str(), op["id"].as_str(), op["path"].as_str())
        else {
            return None;
        };
        let rest = path.strip_prefix(&format!("items/{id}/"))?;
        out.insert((id.to_string(), rest.to_string()));
    }
    Some(out)
}

/// The planted path-granular rebase's merge: each path the patch wrote on its base, set to what
/// it holds there in the current document.
pub(super) fn merge_paths(doc: &mut Value, on_base: &Value, patch: &Value) -> Patched {
    let mut done = Patched::default();
    for (id, path) in written_paths(patch).unwrap_or_default() {
        let before = doc["items"].get(&id).cloned();
        done.before.entry(id.clone()).or_insert(before);
        let parts: Vec<&str> = path.split('/').collect();
        let mut from = &on_base["items"][&id];
        for p in &parts {
            from = &from[*p];
        }
        let value = from.clone();
        let Some((last, head)) = parts.split_last() else {
            continue;
        };
        let mut at = &mut doc["items"][&id];
        for p in head {
            at = &mut at[*p];
        }
        match (value.is_null(), at.as_object_mut()) {
            (true, Some(map)) => {
                map.shift_remove(*last);
            }
            (false, _) => at[*last] = value,
            _ => {}
        }
    }
    done
}

/// The paths a revision wrote, as `(ID, path)`: `""` for an item it created or deleted, else
/// each field of the item it changed, and each member of `params` and `at` (Patch: an undo is
/// refused if another writer has touched those paths since).
pub fn paths_of(before: &BTreeMap<String, Option<Value>>, doc: &Value) -> Paths {
    let mut out = Paths::new();
    for (id, was) in before {
        match (was, doc["items"].get(id)) {
            (Some(Value::Object(a)), Some(Value::Object(b))) => {
                let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
                for k in keys.into_iter().filter(|k| a.get(*k) != b.get(*k)) {
                    match (a.get(k), b.get(k)) {
                        (Some(Value::Object(x)), Some(Value::Object(y)))
                            if k == "params" || k == "at" =>
                        {
                            let members: BTreeSet<&String> = x.keys().chain(y.keys()).collect();
                            for m in members.into_iter().filter(|m| x.get(*m) != y.get(*m)) {
                                out.insert((id.clone(), format!("{k}/{m}")));
                            }
                        }
                        _ => {
                            out.insert((id.clone(), k.clone()));
                        }
                    }
                }
            }
            (a, b) if a.as_ref() != b => {
                out.insert((id.clone(), String::new()));
            }
            _ => {}
        }
    }
    out
}
