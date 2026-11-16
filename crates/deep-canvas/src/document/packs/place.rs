//! #233: a recipe's `place` step, which places an item the document already holds, such as a
//! matrix entry, a number line's label or a group's member, given to the recipe by its ID (Pack:
//! math@1: "matrix and table to a frame grid", "vector@1 labels placed onto the axis's ticks").
//! It gives that item a relation (`at.place`, `at.align`) or a parent, never a position it
//! computed, and only an item that has none of its own, so the item's own words win. The placed
//! item is written as the expansion writes its derived items, in the writer's item's place, so the
//! drawn document holds it placed and the expansion shows what it changed.

use serde_json::{json, Map, Value};

use crate::document::Issue;

/// The fields a `place` step's params write, each onto the item `item` names.
const WRITES: [&str; 3] = ["place", "align", "parent"];

/// The item `params` names (`item`), placed by its `place`, `align` and `parent`, for instance
/// `id`, with its ID; none, with an issue, when there is no such item or it places itself.
pub(super) fn apply(
    items: &Map<String, Value>,
    id: &str,
    step: &str,
    params: &Map<String, Value>,
    issues: &mut Vec<Issue>,
) -> Option<(String, Value)> {
    let path = format!("items/{id}/steps/{step}/params");
    let target = params
        .get("item")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let Some(mut item) = items.get(target).and_then(Value::as_object).cloned() else {
        let what = format!("`{target}` is no item of the document to place");
        issues.push(Issue::error(
            "ref_unresolved",
            id,
            format!("{path}/item"),
            json!(target),
            &what,
        ));
        return None;
    };
    let at = item.get("at").and_then(Value::as_object);
    let own = WRITES.iter().find(|k| {
        let written = |v: Option<&Value>| v.is_some_and(|v| !v.is_null());
        params.get(**k).is_some_and(|v| !v.is_null())
            && match **k {
                "parent" => written(item.get("parent")),
                k => written(at.and_then(|a| a.get(k))),
            }
    });
    if let Some(k) = own {
        let what = format!("`{target}` already has its own {k}: it is placed as written");
        issues.push(Issue::error(
            "out_of_range",
            id,
            format!("{path}/{k}"),
            json!(target),
            &what,
        ));
        return None;
    }
    for k in WRITES {
        let Some(v) = params.get(k).filter(|v| !v.is_null()) else {
            continue;
        };
        if k == "parent" {
            item.insert(k.into(), v.clone());
            continue;
        }
        let at = item.entry("at").or_insert_with(|| json!({}));
        if let Some(at) = at.as_object_mut() {
            at.insert(k.into(), v.clone());
            // A relation places it whole: the place it was written at would add after it.
            at.remove("pos");
        }
    }
    Some((target.to_string(), Value::Object(item)))
}
