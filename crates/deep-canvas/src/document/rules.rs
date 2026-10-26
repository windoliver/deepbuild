//! The honest-numbers and status-color rules over the lowered document (canvas primitives: Honest
//! numbers; The status-color rule; Status binding).
//!
//! - A text that shows a number names its source: its text is a bound value's target, or it is
//!   refused `number_unsourced`, naming the item.
//! - A bound value's text is never typed over: its item's own text stays empty
//!   (`bound_typed_over`).
//! - A template's words follow the same rule, and each slot shows a value its path resolves to
//!   (`ref_unresolved`). A story's own number (a constant whose source is `story`) passes only in a
//!   document that binds no status and no reading; elsewhere it is unsourced (`number_unsourced`).
//! - A status color comes only through a status binding whose source is a verdict, a run, an ask or
//!   a session. A paint or a scale that names a status role (`status.<state>`), and a binding fed
//!   anything else (a reading, which only a threshold could cut into states), are refused
//!   `status_color_unbound`, naming the item that would take the color.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use super::{as_object, kind_text, member, Issue};
use crate::grammar::{Handle, Path, Scheme, Section};
use crate::template::{self, Part};

/// The prefix of every status role; only a status binding reaches one.
pub const STATUS_ROLE: &str = "status.";

/// What a status binding may read: a verdict, a run, an open ask or a session (Status binding).
const STATUS_SOURCES: &[Scheme] = &[Scheme::Verdict, Scheme::Run, Scheme::Ask, Scheme::Session];

/// A status binding's fields (Status binding).
const STATUS_FIELDS: &[&str] = &["target", "source", "as_of", "legend"];

/// The paint slots a status binding may own.
const PAINT_SLOTS: &[&str] = &["fill", "stroke", "badge"];

/// Number words count as numbers ("one taste call", Honest numbers).
const NUMBER_WORDS: &[&str] = &[
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
    "thousand",
    "million",
    "billion",
    "dozen",
];

pub(crate) fn check(doc: &Value, issues: &mut Vec<Issue>) {
    let items = member(doc, "items").and_then(as_object);
    status_bindings(doc, items, issues);
    if let Some(items) = items {
        status_roles(items, issues);
        numbers(doc, items, issues);
    }
}

/// True when `text` shows a number: a digit, or a number word on its own.
fn shows_number(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_digit())
        || text
            .split(|c: char| !c.is_alphabetic())
            .any(|word| NUMBER_WORDS.contains(&word.to_lowercase().as_str()))
}

fn numbers(doc: &Value, items: &Map<String, Value>, issues: &mut Vec<Issue>) {
    // The texts a bound value fills: each shows its reading, with its source and as-of time.
    let sourced: BTreeSet<&str> = member(doc, "bound_values")
        .and_then(as_object)
        .into_iter()
        .flat_map(|b| b.values())
        .filter_map(|b| member(b, "target").and_then(Value::as_str))
        .filter_map(|t| t.strip_prefix("items/")?.strip_suffix("/params/text"))
        .collect();
    let binds = |key: &str| {
        member(doc, key)
            .and_then(as_object)
            .is_some_and(|m| !m.is_empty())
    };
    let binds_status_or_reading = binds("status_bindings") || binds("bound_values");
    for (id, item) in items {
        if !kind_text(item).is_some_and(|k| k.starts_with("text@")) {
            continue;
        }
        if let Some(Value::String(t)) = member(item, "params").and_then(|p| member(p, "template")) {
            template_numbers(doc, id, t, binds_status_or_reading, issues);
            continue;
        }
        let Some(Value::String(text)) = member(item, "params").and_then(|p| member(p, "text"))
        else {
            continue;
        };
        if sourced.contains(id.as_str()) {
            // A bound value's text is its reading's; nothing types over it (Bound value).
            if !text.is_empty() {
                issues.push(Issue::error(
                    "bound_typed_over",
                    id,
                    format!("items/{id}/params/text"),
                    json!(text),
                    "a bound value fills this text; leave it empty, since its reading shows there",
                ));
            }
        } else if shows_number(text) {
            issues.push(Issue::error(
                "number_unsourced",
                id,
                format!("items/{id}/params/text"),
                json!(text),
                "shows a number with no source or as-of time; bind it to a reading, or compute it in the document",
            ));
        }
    }
}

/// A template's words and slots: words that show a number are unsourced, a slot names a value its
/// path resolves to, and a story's own number shows only where no status or reading is bound.
fn template_numbers(doc: &Value, id: &str, t: &str, binds: bool, issues: &mut Vec<Issue>) {
    let path = format!("items/{id}/params/template");
    let Ok(parts) = template::parts(t) else {
        issues.push(Issue::error(
            "out_of_range",
            id,
            path,
            json!(t),
            "a brace that opens no slot or closes none; a slot is `{path}`",
        ));
        return;
    };
    for part in parts {
        match part {
            Part::Words(words) if shows_number(words) => issues.push(Issue::error(
                "number_unsourced",
                id,
                path.clone(),
                json!(t),
                "its words show a number with no source; show the number through a `{path}` slot",
            )),
            Part::Words(_) => {}
            Part::Slot(slot) => match template::value(doc, slot) {
                None => issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    path.clone(),
                    json!(slot),
                    "the slot's path names no data constant this build shows",
                )),
                Some(shown) if binds && shown.number && shown.source.as_deref() == Some("story") => {
                    issues.push(Issue::error(
                        "number_unsourced",
                        id,
                        path.clone(),
                        json!(slot),
                        "shows a story's own number, which only a document that binds no status and no reading may show; bind it to a reading",
                    ))
                }
                Some(_) => {}
            },
        }
    }
}

/// The path to the first status role under `value`: a `role`, or an entry of a `range`.
fn status_role(value: &Value, at: &str) -> Option<(String, String)> {
    match value {
        Value::Object(map) => map.iter().find_map(|(k, v)| {
            let here = format!("{at}/{k}");
            match (k.as_str(), v) {
                ("role", Value::String(s)) if s.starts_with(STATUS_ROLE) => Some((here, s.clone())),
                ("range", Value::Array(list)) => list.iter().enumerate().find_map(|(i, r)| {
                    r.as_str()
                        .filter(|s| s.starts_with(STATUS_ROLE))
                        .map(|s| (format!("{here}/{i}"), s.to_string()))
                }),
                _ => status_role(v, &here),
            }
        }),
        Value::Array(list) => list
            .iter()
            .enumerate()
            .find_map(|(i, v)| status_role(v, &format!("{at}/{i}"))),
        _ => None,
    }
}

fn status_roles(items: &Map<String, Value>, issues: &mut Vec<Issue>) {
    let mut scales = BTreeSet::new();
    for (id, item) in items {
        let Some(params) = member(item, "params") else {
            continue;
        };
        if let Some((path, role)) = status_role(params, &format!("items/{id}/params")) {
            scales.insert(id.as_str());
            issues.push(Issue::error(
                "status_color_unbound",
                id,
                path,
                json!(role),
                "names a status color itself; a status color comes only through a status binding",
            ));
        }
    }
    // A mark set whose role goes through such a scale takes the color: name it with the scale.
    for (id, item) in items {
        let scale = member(item, "params")
            .and_then(|p| member(p, "encode"))
            .and_then(|e| member(e, "role"))
            .and_then(|r| member(r, "scale"))
            .and_then(Value::as_str);
        if let Some(scale) = scale.filter(|s| scales.contains(s) && *s != id) {
            issues.push(Issue {
                ids: vec![id.clone(), scale.to_string()],
                ..Issue::error(
                    "status_color_unbound",
                    id,
                    format!("items/{id}/params/encode/role/scale"),
                    json!(scale),
                    "maps a column onto status colors through a scale; a status color comes only through a status binding",
                )
            });
        }
    }
}

fn status_bindings(doc: &Value, items: Option<&Map<String, Value>>, issues: &mut Vec<Issue>) {
    let Some(bindings) = member(doc, "status_bindings").and_then(as_object) else {
        return;
    };
    for (key, binding) in bindings {
        let at = format!("status_bindings/{key}");
        let Some(fields) = as_object(binding) else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at,
                binding.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !STATUS_FIELDS.contains(&field.as_str()) {
                issues.push(Issue::error(
                    "unknown_field",
                    key,
                    format!("{at}/{field}"),
                    value.clone(),
                    "not a field of a status binding",
                ));
            }
        }
        if let Some(legend) = fields.get("legend") {
            if legend != "auto" {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    format!("{at}/legend"),
                    legend.clone(),
                    "a status binding's legend is auto and can't be turned off",
                ));
            }
        }
        // The item that takes the color: the target's, once it names a paint slot of an item.
        let target = fields.get("target");
        let item = match target {
            Some(Value::String(text)) => match Path::parse(text) {
                Ok(path) => {
                    let fields: Vec<&str> = path.fields().iter().map(String::as_str).collect();
                    let id = path.id().as_str().to_string();
                    let slot = matches!(fields.as_slice(), ["params", "paint", s] if PAINT_SLOTS.contains(s));
                    if path.section() != Section::Items || path.sub().is_some() || !slot {
                        issues.push(Issue::error(
                            "out_of_range",
                            key,
                            format!("{at}/target"),
                            json!(text),
                            "a status binding targets an item's paint slot: items/<id>/params/paint/fill, stroke or badge",
                        ));
                        None
                    } else if !items.is_some_and(|i| i.contains_key(&id)) {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            key,
                            format!("{at}/target"),
                            json!(text),
                            &format!("items/{id} is not in the document"),
                        ));
                        None
                    } else {
                        Some(id)
                    }
                }
                Err(r) => {
                    issues.push(Issue::error(
                        "bad_path",
                        key,
                        format!("{at}/target"),
                        json!(text),
                        &r.what,
                    ));
                    None
                }
            },
            other => {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    format!("{at}/target"),
                    other.cloned().unwrap_or(Value::Null),
                    "not a path",
                ));
                None
            }
        };
        match fields.get("source") {
            Some(Value::String(text)) => match Handle::parse(text) {
                Ok(handle) if STATUS_SOURCES.contains(&handle.scheme()) => {}
                Ok(handle) => issues.push(Issue::error(
                    "status_color_unbound",
                    item.as_deref().unwrap_or(key),
                    format!("{at}/source"),
                    json!(text),
                    &format!(
                        "a status binding reads a verdict, a run, an ask or a session, never a `{}:` handle, which only a threshold could turn into a state",
                        handle.scheme().as_str()
                    ),
                )),
                Err(r) => issues.push(Issue::error(
                    "bad_handle",
                    key,
                    format!("{at}/source"),
                    json!(text),
                    &r.what,
                )),
            },
            other => issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{at}/source"),
                other.cloned().unwrap_or(Value::Null),
                "not a handle",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::document::check;

    fn doc(text: &str) -> serde_json::Value {
        json!({
            "format": 1, "id": "typed", "profile": "board", "title": "Typed", "description": "A bound text.", "size": [100, 40],
            "layers": {"main": {"writer": "a", "title": "Main", "order": "a0"}},
            "items": {"n": {"id": "n", "kind": "text@1", "layer": "main", "name": "N", "order": "a0",
                "params": {"text": text, "font": "body", "size": 13}}},
            "bound_values": {"v": {"target": "items/n/params/text", "source": "reading:01JB3000000000000000000001"}},
        })
    }

    #[test]
    fn a_bound_value_s_text_typed_over_is_refused_naming_the_item() {
        let codes = |d: &serde_json::Value| -> Vec<(&'static str, Vec<String>)> {
            check(d)
                .issues
                .into_iter()
                .map(|i| (i.code, i.ids))
                .collect()
        };
        assert_eq!(codes(&doc("")), []);
        assert_eq!(
            codes(&doc("1,234")),
            [("bound_typed_over", vec!["n".to_string()])]
        );
        assert_eq!(
            codes(&doc("Open")),
            [("bound_typed_over", vec!["n".to_string()])]
        );
    }
}
