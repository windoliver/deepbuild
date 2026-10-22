//! `requires.kinds` as a document's fields need it (Document envelope: "each kind's minor is the
//! lowest its used fields need"; technical design: Documents that age well): so a document that
//! uses no field a newer minor added still opens in the release before it.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{as_object, kind_text, member};
use crate::kinds::{lookup, parse_required, Lookup, Registry};

/// `family.name@major.minor` for each kind of `registry` the items use, at the lowest minor that
/// defines every param they set, sorted.
pub fn derived_kinds(doc: &Value, registry: &Registry) -> Vec<String> {
    let mut minors: BTreeMap<String, u32> = BTreeMap::new();
    let Some(items) = member(doc, "items").and_then(as_object) else {
        return Vec::new();
    };
    for item in items.values() {
        let Some(text) = kind_text(item) else {
            continue;
        };
        let Lookup::Known { entry, saved } = lookup(registry, text) else {
            continue;
        };
        let Some(version) = entry.version(saved) else {
            continue;
        };
        let used = member(item, "params")
            .and_then(as_object)
            .map(|params| {
                params
                    .keys()
                    .filter_map(|name| version.param(name).map(|p| p.minor))
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        let slot = minors
            .entry(format!("{}@{saved}", entry.full_name()))
            .or_default();
        *slot = (*slot).max(used);
    }
    minors
        .into_iter()
        .map(|(kind, minor)| format!("{kind}.{minor}"))
        .collect()
}

/// Writes `requires.kinds` as [`derived_kinds`] gives it. An entry this build can't lower is
/// kept: a kind it doesn't register, or a minor above the build's, which an app that wrote a
/// field this build skips still needs. An empty list is left out, and so is a `requires` that
/// only held it.
pub fn write_required_kinds(doc: &mut Value, registry: &Registry) {
    let mut kinds: BTreeMap<String, String> = derived_kinds(doc, registry)
        .into_iter()
        .map(|k| (k.rsplit_once('.').map_or(k.clone(), |(n, _)| n.into()), k))
        .collect();
    let written = member(doc, "requires")
        .and_then(|r| member(r, "kinds"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for entry in written {
        let Some(text) = entry.as_str() else {
            continue;
        };
        let Some((name, major, minor)) = parse_required(text) else {
            kinds.insert(text.to_string(), text.to_string());
            continue;
        };
        let build_minor = registry
            .entry(&name)
            .and_then(|e| e.version(major))
            .map(|v| v.minor);
        if build_minor.is_none_or(|m| minor > m) {
            kinds.insert(format!("{name}@{major}"), text.to_string());
        }
    }
    let Some(envelope) = doc.as_object_mut() else {
        return;
    };
    let had = envelope.contains_key("requires");
    let requires = envelope.entry("requires").or_insert_with(|| json!({}));
    let Some(fields) = requires.as_object_mut() else {
        return;
    };
    if kinds.is_empty() {
        fields.shift_remove("kinds");
    } else {
        fields.insert(
            "kinds".into(),
            json!(kinds.into_values().collect::<Vec<_>>()),
        );
    }
    if fields.is_empty() && !had {
        envelope.shift_remove("requires");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::registry;

    fn doc(kinds: Option<Value>, params: Value) -> Value {
        let mut d = json!({"items": {"s": {"id": "s", "kind": "test.slab@3", "params": params}}});
        if let Some(k) = kinds {
            d["requires"] = json!({"kinds": k});
        }
        d
    }

    #[test]
    fn the_lowest_minor_the_fields_use_is_written() {
        let reg = registry();
        let mut plain = doc(None, json!({"width": 5}));
        write_required_kinds(&mut plain, &reg);
        assert_eq!(plain["requires"]["kinds"], json!(["test.slab@3.0"]));
        let mut cornered = doc(Some(json!(["test.slab@3.0"])), json!({"corner": 2}));
        write_required_kinds(&mut cornered, &reg);
        assert_eq!(cornered["requires"]["kinds"], json!(["test.slab@3.1"]));
    }

    #[test]
    fn a_minor_above_the_build_and_an_unregistered_kind_are_kept() {
        let reg = registry();
        let mut newer = doc(
            Some(json!(["test.slab@3.2", "acme.gizmo@2.4"])),
            json!({"width": 5}),
        );
        write_required_kinds(&mut newer, &reg);
        assert_eq!(
            newer["requires"]["kinds"],
            json!(["acme.gizmo@2.4", "test.slab@3.2"])
        );
    }
}
