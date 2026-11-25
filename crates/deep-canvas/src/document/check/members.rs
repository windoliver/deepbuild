//! The envelope's `layers` and `ports` members, checked (moved out of check.rs whole, #3292).

use super::*;

pub(super) fn check_layers(doc: &Value, issues: &mut Vec<Issue>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let Some(layers) = member(doc, "layers") else {
        return ids;
    };
    let Some(layers) = layers.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "layers".into(),
            layers.clone(),
            "not an object",
        ));
        return ids;
    };
    for (key, layer) in layers {
        ids.insert(key.clone());
        check_key("layers", key, issues);
        let Some(fields) = layer.as_object() else {
            issues.push(Issue::envelope(
                "out_of_range",
                format!("layers/{key}"),
                layer.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !LAYER_KEYS.contains(&field.as_str()) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    format!("layers/{key}/{field}"),
                    value.clone(),
                    "not a field of a layer",
                ));
            }
        }
        for field in ["writer", "title", "order"] {
            if !fields.get(field).is_some_and(Value::is_string) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/{field}"),
                    fields.get(field).cloned().unwrap_or(Value::Null),
                    "not a string",
                ));
            }
        }
        if let Some(role) = fields.get("role") {
            if !role.as_str().is_some_and(|r| LAYER_ROLES.contains(&r)) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/role"),
                    role.clone(),
                    "not a layer role",
                ));
            }
        }
        if let Some(locked) = fields.get("locked") {
            if !locked.is_boolean() {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/locked"),
                    locked.clone(),
                    "not a boolean",
                ));
            }
        }
    }
    // One writer, one layer: apply stamps the writer's layer, so two layers with one writer
    // would make a patch's outcome depend on the layers' order.
    // The layer first by ID keeps the writer, whatever order the file lists them in.
    let mut writers: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (key, layer) in layers {
        if let Some(writer) = member(layer, "writer").and_then(Value::as_str) {
            writers.entry(writer).or_default().insert(key);
        }
    }
    for (writer, keys) in &writers {
        let mut keys = keys.iter();
        let Some(first) = keys.next() else {
            continue;
        };
        for key in keys {
            issues.push(Issue::envelope(
                "out_of_range",
                format!("layers/{key}/writer"),
                json!(writer),
                &format!("layer `{first}` has this writer too"),
            ));
        }
    }
    ids
}

/// The most ports a document declares (#210).
const MAX_PORTS: usize = 8;

/// #210: `ports: {name → {plugin, out: [control ID | occurrence list], in: [reading ID], sound}}`.
pub(super) fn check_ports(envelope: &Map<String, Value>, ports: &Value, issues: &mut Vec<Issue>) {
    let bad = |at: String, value: &Value, what: &str| {
        Issue::envelope("out_of_range", at, value.clone(), what)
    };
    let Some(ports) = ports.as_object() else {
        issues.push(bad("ports".into(), ports, "not an object of ports by name"));
        return;
    };
    if ports.len() > MAX_PORTS {
        issues.push(bad(
            "ports".into(),
            &json!(ports.len()),
            "more than 8 ports",
        ));
    }
    let controls = envelope.get("controls").and_then(Value::as_object);
    let items = envelope.get("items").and_then(Value::as_object);
    for (name, port) in ports {
        let at = format!("ports/{name}");
        let Some(port) = port.as_object() else {
            issues.push(bad(at, port, "not an object"));
            continue;
        };
        for (key, value) in port {
            if !["plugin", "out", "in", "sound"].contains(&key.as_str()) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    format!("{at}/{key}"),
                    value.clone(),
                    "not a field of a port",
                ));
            }
        }
        if !port.get("plugin").is_some_and(Value::is_string) {
            issues.push(bad(
                format!("{at}/plugin"),
                &Value::Null,
                "a port names its plug-in",
            ));
        }
        if port.get("sound").is_some_and(|s| !s.is_boolean()) {
            issues.push(bad(format!("{at}/sound"), &port["sound"], "not a boolean"));
        }
        for side in ["out", "in"] {
            let Some(list) = port.get(side) else { continue };
            let Some(list) = list.as_array() else {
                issues.push(bad(format!("{at}/{side}"), list, "not a list of names"));
                continue;
            };
            for (i, entry) in list.iter().enumerate() {
                let here = format!("{at}/{side}/{i}");
                let Some(id) = entry.as_str() else {
                    issues.push(bad(here, entry, "not a name"));
                    continue;
                };
                let known = if side == "in" {
                    id.starts_with("reading:")
                } else if let Some(item) = id.strip_suffix(".occurrences") {
                    items
                        .and_then(|m| m.get(item))
                        .is_some_and(|i| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
                } else {
                    controls.is_some_and(|c| c.contains_key(id))
                };
                if !known {
                    issues.push(Issue::envelope(
                        "ref_unresolved",
                        here,
                        entry.clone(),
                        if side == "in" {
                            "a port reads a reading (`reading:<source>`)"
                        } else {
                            "a port sends a control of the document or a logic item's occurrence list"
                        },
                    ));
                }
            }
        }
    }
}
