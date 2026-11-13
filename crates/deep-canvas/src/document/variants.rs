//! Variants (canvas primitives: Variant; issue #504): a named patch applied at compile on top of
//! the writer layers, and the shape the check holds a document's `variants` and a control's
//! `variant` and `targets` to.
//!
//! [`applied`] is the one applier: the GPU layer's warm-up (#432) and the hub's played form both
//! call it, so a pick draws the same in a session and an export.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::{member, Issue};

/// Sets `value` at `path` (`items/<id>/params/…`) in `doc`, making the objects on the way; a
/// part that indexes an array (`at/pos/1`) sets that element.
pub fn set_path(doc: &mut Value, path: &str, value: Value) {
    let mut at = doc;
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    for (k, p) in parts.iter().enumerate() {
        if let (true, Ok(i)) = (at.is_array(), p.parse::<usize>()) {
            let Some(slot) = at.as_array_mut().and_then(|a| a.get_mut(i)) else {
                return;
            };
            if k + 1 == parts.len() {
                *slot = value;
                return;
            }
            at = slot;
            continue;
        }
        if !at.is_object() {
            *at = json!({});
        }
        let o = at.as_object_mut().expect("made above");
        if k + 1 == parts.len() {
            o.insert((*p).to_string(), value);
            return;
        }
        at = o.entry((*p).to_string()).or_insert_with(|| json!({}));
    }
}

/// One op of a variant's patch: `set` a path, `create` an item, `delete` one.
fn apply_op(doc: &mut Value, op: &Value) {
    match op["op"].as_str() {
        Some("set") => {
            if let Some(path) = op["path"].as_str() {
                set_path(doc, path, op["value"].clone());
            }
        }
        Some("create") => {
            let item = &op["item"];
            if let (Some(id), Some(items)) = (item["id"].as_str(), doc["items"].as_object_mut()) {
                items.insert(id.to_string(), item.clone());
            }
        }
        Some("delete") => {
            if let (Some(id), Some(items)) = (op["id"].as_str(), doc["items"].as_object_mut()) {
                items.remove(id);
            }
        }
        _ => {}
    }
}

/// `doc` with each variant set's picked option's patch applied, in set order; a set with no
/// pick applies its default, and one with neither applies nothing.
pub fn applied(doc: &Value, picked: &BTreeMap<String, String>) -> Value {
    let mut out = doc.clone();
    for (set, spec) in doc["variants"].as_object().into_iter().flatten() {
        let name = picked
            .get(set)
            .map(String::as_str)
            .or_else(|| spec["default"].as_str());
        let option = spec["options"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|o| name.is_some() && o["name"].as_str() == name);
        for op in option
            .map(|o| &o["patch"])
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            apply_op(&mut out, op);
        }
    }
    out
}

/// The option names a control picks among: a variant choice's set's options, a choice's
/// `options`, or a stages control's stage IDs.
pub fn option_names(doc: &Value, control: &Value) -> Vec<String> {
    let names = |list: Option<&Value>| -> Vec<String> {
        list.and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|o| {
                o.as_str()
                    .or_else(|| o["name"].as_str())
                    .or_else(|| o["id"].as_str())
            })
            .map(String::from)
            .collect()
    };
    if let Some(set) = control["variant"].as_str() {
        return names(doc["variants"][set].get("options"));
    }
    match control["kind"].as_str() {
        Some("stages") => control["stages"]
            .as_object()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default(),
        _ => names(control.get("options")),
    }
}

/// The check of `variants`, and of each control's `variant` and `targets`, with the codes every
/// section uses: a malformed field is `out_of_range`, a name that names nothing `ref_unresolved`.
pub(crate) fn check(doc: &Value, issues: &mut Vec<Issue>) {
    let sets = member(doc, "variants").and_then(Value::as_object);
    for (set, spec) in sets.into_iter().flatten() {
        let mut bad = |code, field: &str, actual: Value, what: &str| {
            let path = if field.is_empty() {
                format!("variants/{set}")
            } else {
                format!("variants/{set}/{field}")
            };
            issues.push(Issue::error(code, set, path, actual, what));
        };
        let Some(options) = spec["options"].as_array() else {
            bad(
                "out_of_range",
                "options",
                spec["options"].clone(),
                "not a list of options",
            );
            continue;
        };
        let mut seen = BTreeSet::new();
        for (i, o) in options.iter().enumerate() {
            let Some(name) = o["name"].as_str() else {
                bad(
                    "out_of_range",
                    &format!("options/{i}/name"),
                    o["name"].clone(),
                    "not a name",
                );
                continue;
            };
            if !seen.insert(name) {
                bad(
                    "out_of_range",
                    &format!("options/{i}/name"),
                    json!(name),
                    "names an option twice",
                );
            }
            let Some(patch) = o["patch"].as_array() else {
                bad(
                    "out_of_range",
                    &format!("options/{i}/patch"),
                    o["patch"].clone(),
                    "not a list of ops",
                );
                continue;
            };
            for (k, op) in patch.iter().enumerate() {
                let ok = match op["op"].as_str() {
                    Some("set") => op["path"].is_string() && op.get("value").is_some(),
                    Some("create") => op["item"]["id"].is_string(),
                    Some("delete") => op["id"].is_string(),
                    _ => false,
                };
                if !ok {
                    let path = format!("options/{i}/patch/{k}");
                    bad(
                        "out_of_range",
                        &path,
                        op.clone(),
                        "not a set, create or delete op",
                    );
                }
            }
        }
        if let Some(d) = spec.get("default").filter(|d| !d.is_null()) {
            if !d.as_str().is_some_and(|d| seen.contains(d)) {
                bad(
                    "ref_unresolved",
                    "default",
                    d.clone(),
                    "names no option of the set",
                );
            }
        }
    }
    let items = member(doc, "items").and_then(Value::as_object);
    let collections = member(doc, "collections").and_then(Value::as_object);
    for (id, c) in member(doc, "controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let mut bad = |code, field: &str, actual: Value, what: &str| {
            issues.push(Issue::error(
                code,
                id,
                format!("controls/{id}/{field}"),
                actual,
                what,
            ));
        };
        if let Some(set) = c.get("variant") {
            if c["kind"].as_str() != Some("choice") {
                bad(
                    "out_of_range",
                    "variant",
                    set.clone(),
                    "only a choice picks a variant",
                );
            } else if !set
                .as_str()
                .is_some_and(|s| sets.is_some_and(|m| m.contains_key(s)))
            {
                bad(
                    "ref_unresolved",
                    "variant",
                    set.clone(),
                    "names no variant set of the document",
                );
            }
        }
        let Some(targets) = c.get("targets") else {
            continue;
        };
        let Some(targets) = targets.as_object() else {
            bad("out_of_range", "targets", targets.clone(), "not an object");
            continue;
        };
        let options = option_names(doc, c);
        let picks = matches!(c["kind"].as_str(), Some("choice" | "stages"));
        for (option, item) in targets {
            if picks && !options.contains(option) {
                bad(
                    "ref_unresolved",
                    &format!("targets/{option}"),
                    json!(option),
                    "names no option or stage of the control",
                );
            }
            let known = item.as_str().is_some_and(|i| {
                items.is_some_and(|m| m.contains_key(i))
                    || collections.is_some_and(|m| m.contains_key(i))
            });
            if !known {
                bad(
                    "ref_unresolved",
                    &format!("targets/{option}"),
                    item.clone(),
                    "names no item or collection of the document",
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> Value {
        json!({
            "items": {"case": {"params": {"color": "a"}}},
            "variants": {"color": {"default": "red", "options": [
                {"name": "red", "label": "Red", "patch": [{"op": "set", "path": "items/case/params/color", "value": "r"}]},
                {"name": "blue", "label": "Blue", "patch": [{"op": "set", "path": "items/case/params/color", "value": "b"}]}
            ]}},
            "controls": {"pick": {"kind": "choice", "variant": "color", "role": "radiogroup", "targets": {"blue": "case"}}}
        })
    }

    #[test]
    fn a_pick_applies_its_option_and_no_pick_its_default() {
        let d = doc();
        assert_eq!(
            applied(&d, &BTreeMap::new())["items"]["case"]["params"]["color"],
            "r"
        );
        let picked = BTreeMap::from([("color".to_string(), "blue".to_string())]);
        assert_eq!(
            applied(&d, &picked)["items"]["case"]["params"]["color"],
            "b"
        );
    }

    #[test]
    fn the_check_names_a_default_a_set_and_a_target_that_name_nothing() {
        let mut d = doc();
        d["variants"]["color"]["default"] = json!("green");
        d["controls"]["pick"]["targets"] = json!({"green": "wall"});
        d["controls"]["other"] = json!({"kind": "slider", "variant": "nope"});
        let mut issues = Vec::new();
        check(&d, &mut issues);
        let paths: Vec<String> = issues
            .iter()
            .map(|i| format!("{} {}", i.code, i.path))
            .collect();
        assert!(
            paths.contains(&"ref_unresolved variants/color/default".to_string()),
            "{paths:?}"
        );
        assert!(
            paths.contains(&"ref_unresolved controls/pick/targets/green".to_string()),
            "{paths:?}"
        );
        assert!(
            paths.contains(&"out_of_range controls/other/variant".to_string()),
            "{paths:?}"
        );
        let mut clean = Vec::new();
        check(&doc(), &mut clean);
        assert!(
            clean.is_empty(),
            "{:?}",
            clean.iter().map(|i| &i.path).collect::<Vec<_>>()
        );
    }
}
