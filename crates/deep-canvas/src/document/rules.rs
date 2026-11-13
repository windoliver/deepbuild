//! The honest-numbers and status-color rules over the lowered document (canvas primitives: Honest
//! numbers; The status-color rule; Status binding).
//!
//! - A text that shows a number names its source: its text is a bound value's target, or it is
//!   refused `number_unsourced`, naming the item.
//! - A bound value's text is never typed over: its item's own text stays empty
//!   (`bound_typed_over`).
//! - A template's words follow the same rule, and each slot shows a value its path resolves to
//!   (`ref_unresolved`). A story's own number (a constant whose source is `story`) passes only in a
//!   document that binds no status and no reading and isn't shown inside one that does
//!   ([`shown_inside`]); elsewhere the honest-numbers check finds it unsourced.
//! - A text marked `{name: true}` is a name, so its digits aren't counted, and a name an
//!   `honest_numbers` check input lists (`names`) is skipped wherever it shows; that input's
//!   `number_words: false` stops number words counting; a code item's digits count unless it
//!   quotes its source, whose digits are quotation (#406).
//! - A status color comes only through a status binding whose source is a verdict, a run, an ask or
//!   a session. A paint or a scale that names a status role (`status.<state>`), and a binding fed
//!   anything else (a reading, which only a threshold could cut into states), are refused
//!   `status_color_unbound`, naming the item that would take the color.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use super::{kind_text, member, Issue};
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

/// An item as its own rules read it: its ID and itself.
pub(crate) type Entry<'e> = (&'e String, &'e Value);

/// What a run of items' own rules found: each item's status-role issue, the IDs of the items that
/// name a status role, and each item's number issues.
pub(crate) struct ItemRules<'e> {
    roles: Vec<Issue>,
    scales: Vec<&'e str>,
    numbers: Vec<Issue>,
}

/// The rules over `doc`, each item's own read through `split`, which runs `work` over runs of the
/// items and returns each run's findings in order: the check splits a big document's across the
/// cores. The issues come in the same order however the items were split.
pub(crate) fn check(
    doc: &Value,
    issues: &mut Vec<Issue>,
    split: impl for<'e> FnOnce(
        &mut [Entry<'e>],
        &(dyn Fn(&mut [Entry<'e>]) -> ItemRules<'e> + Sync),
    ) -> Vec<ItemRules<'e>>,
) {
    let items = member(doc, "items").and_then(Value::as_object);
    // #1183: an assembly's `shown_at` and an `exaggerate`, which lengths drawn larger than real read.
    crate::lengths::check(doc, issues);
    status_bindings(doc, items, issues);
    let Some(items) = items else {
        return;
    };
    let texts = Texts::of(doc);
    let mut entries: Vec<Entry<'_>> = items.iter().collect();
    let found = split(&mut entries, &|run| {
        let mut r = ItemRules {
            roles: Vec::new(),
            scales: Vec::new(),
            numbers: Vec::new(),
        };
        for &(id, item) in run.iter() {
            if status_role_of(id, item, &mut r.roles) {
                r.scales.push(id.as_str());
            }
            numbers_of(doc, &texts, id, item, &mut r.numbers);
        }
        r
    });
    let mut scales = BTreeSet::new();
    let mut numbers = Vec::new();
    for r in found {
        issues.extend(r.roles);
        scales.extend(r.scales);
        numbers.extend(r.numbers);
    }
    scaled_status(items, &scales, issues);
    issues.extend(numbers);
}

/// What the number rules read of the document as a whole.
struct Texts<'d> {
    /// The texts a bound value fills: each shows its reading, with its source and as-of time.
    sourced: BTreeSet<&'d str>,
    binds_status_or_reading: bool,
    /// The marked names an `honest_numbers` check input lists, which the scan skips.
    names: Vec<&'d str>,
    /// Whether number words count as numbers (`number_words`, true unless a check input says
    /// false).
    number_words: bool,
    /// The overlays that disclose an exaggeration, whose templates are displayed text (#1183).
    disclosures: BTreeSet<&'d str>,
}

impl<'d> Texts<'d> {
    fn of(doc: &'d Value) -> Self {
        let sourced = member(doc, "bound_values")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|b| b.values())
            .filter_map(|b| member(b, "target").and_then(Value::as_str))
            .filter_map(|t| t.strip_prefix("items/")?.strip_suffix("/params/text"))
            .collect();
        let binds = |key: &str| {
            member(doc, key)
                .and_then(Value::as_object)
                .is_some_and(|m| !m.is_empty())
        };
        // The document's own `honest_numbers` check inputs (Check input; Honest numbers).
        let inputs: Vec<&Value> = member(doc, "checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|c| member(c, "kind").and_then(Value::as_str) == Some("honest_numbers"))
            .collect();
        Texts {
            sourced,
            binds_status_or_reading: binds("status_bindings") || binds("bound_values"),
            names: inputs
                .iter()
                .filter_map(|c| member(c, "names").and_then(Value::as_array))
                .flatten()
                .filter_map(Value::as_str)
                .filter(|n| !n.is_empty())
                .collect(),
            number_words: !inputs
                .iter()
                .any(|c| member(c, "number_words") == Some(&Value::Bool(false))),
            disclosures: crate::lengths::disclosures(doc).collect(),
        }
    }

    /// True when `text`, with each marked name taken out, shows a number: a digit, or (unless
    /// turned off) a number word on its own.
    fn shows_number(&self, text: &str) -> bool {
        let mut text = text.to_string();
        for name in &self.names {
            text = text.replace(name, " ");
        }
        text.chars().any(|c| c.is_ascii_digit())
            || (self.number_words
                && text
                    .split(|c: char| !c.is_alphabetic())
                    .any(|word| NUMBER_WORDS.contains(&word.to_lowercase().as_str())))
    }
}

/// The number rules over one item.
fn numbers_of(doc: &Value, texts: &Texts<'_>, id: &String, item: &Value, issues: &mut Vec<Issue>) {
    // An outline in `outline.source@1`'s text form shows its string as text@1 shows its own, so a
    // 3D title is displayed text (#443; Builder `extrude`: outlines from text, paths and SVG).
    let outline = member(item, "params").and_then(|p| member(p, "outline"));
    if let Some(Value::String(text)) = outline.and_then(|o| member(o, "text")) {
        if texts.shows_number(text) {
            issues.push(Issue::error(
                "number_unsourced",
                id,
                format!("items/{id}/params/outline/text"),
                json!(text),
                "the title shows a number with no source; mark it a name in the honest_numbers check input, or bind or compute the number",
            ));
        }
        return;
    }
    let disclosure = texts.disclosures.contains(id.as_str());
    if !disclosure && !kind_text(item).is_some_and(|k| k.starts_with("text@")) {
        return;
    }
    let params = member(item, "params");
    let param = |key: &str| params.and_then(|p| member(p, key));
    // A marked name's digits aren't a number; nothing guesses that a string is a name.
    if param("name") == Some(&Value::Bool(true)) {
        return;
    }
    if let Some(Value::String(t)) = param("template") {
        template_numbers(doc, texts, id, t, issues);
        return;
    }
    // A code item's text is its raw bytes' display form. A quote's digits are quotation, listed
    // and never counted; an unquoted code item's digits count as numbers (Text `text@1`: code).
    if param("code").is_some() {
        // #1965: a raw that is an asset shows its bytes, which its host read into `base64`.
        let raw = match param("raw") {
            Some(Value::String(raw)) => Some(raw.clone()),
            Some(raw) => member(raw, "base64")
                .and_then(Value::as_str)
                .and_then(crate::base64::decode)
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()),
            None => None,
        };
        if let (None, Some(raw)) = (param("quote"), &raw) {
            if texts.shows_number(raw) {
                issues.push(Issue::error(
                    "number_unsourced",
                    id,
                    format!("items/{id}/params/raw"),
                    json!(raw),
                    "unquoted code shows a number with no source; quote it from its source, or bind or compute the number",
                ));
            }
        }
        return;
    }
    let Some(Value::String(text)) = param("text") else {
        return;
    };
    if texts.sourced.contains(id.as_str()) {
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
    } else if texts.shows_number(text) {
        issues.push(Issue::error(
            "number_unsourced",
            id,
            format!("items/{id}/params/text"),
            json!(text),
            "shows a number with no source or as-of time; bind it to a reading, or compute it in the document",
        ));
    }
}

/// A template's words and slots: words that show a number are unsourced, and a slot names a value
/// its path resolves to.
fn template_numbers(doc: &Value, texts: &Texts<'_>, id: &str, t: &str, issues: &mut Vec<Issue>) {
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
            Part::Words(words) if texts.shows_number(words) => issues.push(Issue::error(
                "number_unsourced",
                id,
                path.clone(),
                json!(t),
                "its words show a number with no source; show the number through a `{path}` slot",
            )),
            Part::Words(_) => {}
            Part::Slot(slot)
                if template::value_in(doc, id, slot).is_none()
                    && !template::reads_anchor(doc, slot) =>
            {
                issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    path.clone(),
                    json!(slot),
                    "the slot's path names no data constant this build shows",
                ))
            }
            Part::Slot(_) => {}
        }
    }
    // A story number shown where a status or a reading is bound is the honest-numbers check's
    // finding, as a number from a table an agent wrote is (deep_canvas_marks::check::numbers),
    // never a refusal of the revision (#1162).
}

/// Each story number a template shows where it is shown inside a document that binds a status
/// or a reading: unsourced there.
pub fn story_issues(doc: &Value, id: &str, t: &str, issues: &mut Vec<Issue>) {
    for (slot, _) in template::story_numbers(doc, t) {
        issues.push(Issue::error(
            "number_unsourced",
            id,
            format!("items/{id}/params/template"),
            json!(slot),
            "shows a story's own number, which only a document that binds no status and no reading, and isn't shown inside one that does, may show; bind it to a reading",
        ));
    }
}

/// The honest-numbers issues `doc` raises once shown inside a document where status can show, as
/// on a return card (Honest numbers): each story number it shows. A document that binds a status
/// or a reading itself raised them in its own check, so they aren't raised twice.
pub fn shown_inside(doc: &Value) -> Vec<Issue> {
    let mut issues = Vec::new();
    let Some(items) = member(doc, "items").and_then(Value::as_object) else {
        return issues;
    };
    if Texts::of(doc).binds_status_or_reading {
        return issues;
    }
    for (id, item) in items {
        let params = member(item, "params");
        let template = params.and_then(|p| member(p, "template"));
        let named = params.and_then(|p| member(p, "name")) == Some(&Value::Bool(true));
        if let (true, false, Some(Value::String(t))) = (
            kind_text(item).is_some_and(|k| k.starts_with("text@")),
            named,
            template,
        ) {
            story_issues(doc, id, t, &mut issues);
        }
    }
    issues
}

/// The path under `value` to its first status role (a `role`, or an entry of a `range` or of
/// `stops`), each step after a `/`, and the role. The path is written only for a role found,
/// since every item's params are searched.
fn status_role(value: &Value) -> Option<(String, String)> {
    match value {
        Value::Object(map) => map.iter().find_map(|(k, v)| match (k.as_str(), v) {
            ("role", Value::String(s)) if s.starts_with(STATUS_ROLE) => {
                Some((format!("/{k}"), s.clone()))
            }
            // #1646: a dither fill's stops are role names.
            ("range" | "stops", Value::Array(list)) => {
                list.iter().enumerate().find_map(|(i, r)| match r {
                    Value::String(s) if s.starts_with(STATUS_ROLE) => {
                        Some((format!("/{k}/{i}"), s.clone()))
                    }
                    _ => status_role(r).map(|(path, role)| (format!("/{k}/{i}{path}"), role)),
                })
            }
            _ => status_role(v).map(|(path, role)| (format!("/{k}{path}"), role)),
        }),
        Value::Array(list) => list
            .iter()
            .enumerate()
            .find_map(|(i, v)| status_role(v).map(|(path, role)| (format!("/{i}{path}"), role))),
        _ => None,
    }
}

/// The status-role rule over one item; true when its params name a status role.
fn status_role_of(id: &String, item: &Value, issues: &mut Vec<Issue>) -> bool {
    let Some(params) = member(item, "params") else {
        return false;
    };
    let Some((path, role)) = status_role(params) else {
        return false;
    };
    issues.push(Issue::error(
        "status_color_unbound",
        id,
        format!("items/{id}/params{path}"),
        json!(role),
        "names a status color itself; a status color comes only through a status binding",
    ));
    true
}

/// A mark set whose role goes through a scale in `scales`, one naming a status role, takes the
/// color: name it with the scale.
fn scaled_status(items: &Map<String, Value>, scales: &BTreeSet<&str>, issues: &mut Vec<Issue>) {
    if scales.is_empty() {
        return;
    }
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
    let Some(bindings) = member(doc, "status_bindings").and_then(Value::as_object) else {
        return;
    };
    for (key, binding) in bindings {
        let at = format!("status_bindings/{key}");
        let Some(fields) = binding.as_object() else {
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

    #[test]
    fn a_listed_name_is_skipped_where_it_shows_and_number_words_can_be_turned_off() {
        let mut d = doc("");
        d["items"]["m"] = json!({"id": "m", "kind": "text@1", "layer": "main", "name": "M", "order": "a1",
            "params": {"text": "The T-800, one of a kind", "font": "body", "size": 13}});
        let unsourced = |d: &serde_json::Value| -> Vec<serde_json::Value> {
            check(d)
                .issues
                .into_iter()
                .filter(|i| i.code == "number_unsourced")
                .map(|i| i.actual)
                .collect()
        };
        assert_eq!(unsourced(&d), [json!("The T-800, one of a kind")]);
        d["checks"] = json!([{"kind": "honest_numbers", "names": ["T-800"]}]);
        // The listed name is skipped; "one" still counts.
        assert_eq!(unsourced(&d), [json!("The T-800, one of a kind")]);
        d["checks"][0]["number_words"] = json!(false);
        assert_eq!(unsourced(&d), Vec::<serde_json::Value>::new());
        d["items"]["m"]["params"]["text"] = json!("The T-800 in 3 days");
        assert_eq!(unsourced(&d), [json!("The T-800 in 3 days")]);
        d["checks"][0]["names"] = json!([]);
        d["items"]["m"]["params"]["text"] = json!("The T-800");
        assert_eq!(unsourced(&d), [json!("The T-800")]);
    }

    #[test]
    fn an_unquoted_code_item_s_digits_count_and_a_quote_s_do_not() {
        let mut d = doc("");
        d["items"]["c"] = json!({"id": "c", "kind": "text@1", "layer": "main", "name": "C", "order": "a1",
            "params": {"font": "mono", "size": 13, "code": {"language": "python"}, "raw": "retries = 3\n"}});
        let unsourced = |d: &serde_json::Value| -> Vec<Vec<String>> {
            check(d)
                .issues
                .into_iter()
                .filter(|i| i.code == "number_unsourced")
                .map(|i| i.ids)
                .collect()
        };
        assert_eq!(unsourced(&d), [vec!["c".to_string()]]);
        d["items"]["c"]["params"]["quote"] =
            json!({"source": "0".repeat(64), "path": "r.py", "lines": [1, 1]});
        assert_eq!(unsourced(&d), Vec::<Vec<String>>::new());
        // #1965: a raw that is an asset counts as its bytes do, once its host has read them.
        d["items"]["c"]["params"]
            .as_object_mut()
            .unwrap()
            .remove("quote");
        let read = crate::base64::encode(b"caf\xe9 = 3\n");
        d["items"]["c"]["params"]["raw"] = json!({"asset": "0".repeat(64), "base64": read});
        assert_eq!(unsourced(&d), [vec!["c".to_string()]]);
        let read = crate::base64::encode(b"caf\xe9\n");
        d["items"]["c"]["params"]["raw"] = json!({"asset": "0".repeat(64), "base64": read});
        assert_eq!(unsourced(&d), Vec::<Vec<String>>::new());
    }
}
