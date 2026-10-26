//! A three-way merge by stable ID (technical design: Provenance; canvas primitives: Order keys):
//! documents several writers wrote from one base merge entry by entry, in every layer and every
//! map keyed by ID, and an entry both sides changed differently is a conflict, never a change
//! dropped.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use super::requires::write_required_kinds;
use super::{member, ID_MAPS};
use crate::kinds::Registry;

/// A merge's outcome.
#[derive(Clone, Debug, PartialEq)]
pub enum Merged {
    Clean(Value),
    /// Each entry both sides changed differently: its map (`""` for an envelope field) and key.
    Conflict(Vec<(String, String)>),
}

/// The three-way choice for one entry: the same on both sides, or changed on one side only,
/// takes that side; changed differently on both is a conflict. `None` is absent.
fn pick<'a>(
    base: Option<&'a Value>,
    a: Option<&'a Value>,
    b: Option<&'a Value>,
) -> Result<Option<&'a Value>, ()> {
    if a == b || b == base {
        Ok(a)
    } else if a == base {
        Ok(b)
    } else {
        Err(())
    }
}

/// Merges `a` and `b`, each a revision of `base`. `merge(base, a, b)` and `merge(base, b, a)`
/// give the same document, its keys sorted, with `requires.kinds` as the merged fields need.
pub fn merge(base: &Value, a: &Value, b: &Value, registry: &Registry) -> Merged {
    let empty = Map::new();
    let (fb, fa, fbb) = (
        base.as_object().unwrap_or(&empty),
        a.as_object().unwrap_or(&empty),
        b.as_object().unwrap_or(&empty),
    );
    let mut conflicts = Vec::new();
    let mut out = Map::new();
    let keys: BTreeSet<&String> = fb.keys().chain(fa.keys()).chain(fbb.keys()).collect();
    for key in keys {
        let by_id = key == "layers" || key == "items" || ID_MAPS.contains(&key.as_str());
        if key == "requires" {
            // Each side's kinds are needed by its own fields: merged by need, below.
            continue;
        }
        if !by_id {
            match pick(fb.get(key), fa.get(key), fbb.get(key)) {
                Ok(Some(v)) => {
                    out.insert(key.clone(), v.clone());
                }
                Ok(None) => {}
                Err(()) => conflicts.push((String::new(), key.clone())),
            }
            continue;
        }
        let (mb, ma, mbb) = (
            fb.get(key).and_then(Value::as_object).unwrap_or(&empty),
            fa.get(key).and_then(Value::as_object).unwrap_or(&empty),
            fbb.get(key).and_then(Value::as_object).unwrap_or(&empty),
        );
        let ids: BTreeSet<&String> = mb.keys().chain(ma.keys()).chain(mbb.keys()).collect();
        let mut merged = Map::new();
        for id in ids {
            match pick(mb.get(id), ma.get(id), mbb.get(id)) {
                Ok(Some(v)) => {
                    merged.insert(id.clone(), v.clone());
                }
                Ok(None) => {}
                Err(()) => conflicts.push((key.clone(), id.clone())),
            }
        }
        if [fb, fa, fbb].iter().any(|f| f.contains_key(key)) {
            out.insert(key.clone(), Value::Object(merged));
        }
    }
    if !conflicts.is_empty() {
        return Merged::Conflict(conflicts);
    }
    // The kinds either side requires, at the higher minor, then lowered to what the merged
    // fields use where this build can.
    let mut kinds: Vec<String> = [a, b]
        .iter()
        .filter_map(|d| member(d, "requires").and_then(|r| member(r, "kinds")))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    kinds.sort();
    kinds.dedup();
    let requires = pick(fb.get("requires"), fa.get("requires"), fbb.get("requires"))
        .ok()
        .flatten()
        .cloned();
    let mut doc = Value::Object(out);
    if requires.is_some() || !kinds.is_empty() {
        let mut r = requires.unwrap_or_else(|| json!({}));
        if let Some(fields) = r.as_object_mut() {
            if !kinds.is_empty() {
                fields.insert("kinds".into(), json!(kinds));
            }
        }
        doc["requires"] = r;
    }
    write_required_kinds(&mut doc, registry);
    Merged::Clean(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::registry;

    #[test]
    fn disjoint_changes_merge_symmetrically_and_a_double_change_conflicts() {
        let base = json!({"items": {"n": {"x": 1}}});
        let a = json!({"items": {"n": {"x": 1}, "a": {"x": 2}}});
        let b = json!({"items": {"n": {"x": 1}, "b": {"x": 3}}});
        let reg = registry();
        let ab = merge(&base, &a, &b, &reg);
        assert_eq!(ab, merge(&base, &b, &a, &reg));
        let Merged::Clean(doc) = ab else {
            panic!("clean")
        };
        assert_eq!(doc["items"].as_object().unwrap().len(), 3);
        let a2 = json!({"items": {"n": {"x": 5}}});
        let b2 = json!({"items": {"n": {"x": 6}}});
        assert_eq!(
            merge(&base, &a2, &b2, &reg),
            Merged::Conflict(vec![("items".into(), "n".into())])
        );
        // A delete on one side and no change on the other deletes.
        let gone = json!({"items": {}});
        let Merged::Clean(doc) = merge(&base, &gone, &base, &reg) else {
            panic!("clean")
        };
        assert_eq!(doc["items"], json!({}));
    }
}
