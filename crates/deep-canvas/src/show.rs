//! deep_show's whole revisions (issue #393; canvas primitives: Writer layer, Revision, Band, What
//! holds a document to its rules): an agent's payload stamped into its own writer layer from its
//! connection, the diff of a whole revision against the current one by every ID its layer holds,
//! the handles a binding reads that the writer's credential can't, and the issues a reply inlines
//! up to the read cap.
//!
//! # Public API
//!
//! - [`Writer`] and [`WriterKind`]: who a connection proves, and the [`Band`] its layer draws in.
//! - [`stamp`]: a payload as a document of one writer layer, or the fields that name a layer or
//!   a writer.
//! - [`whole_diff`] and [`whole_diff_by`]: the IDs changed, unchanged, created and removed, or
//!   `unintended_removal`.
//! - [`unreadable_handles`]: `ref_unresolved` for each binding source the writer can't read.
//! - [`order_issues`], [`inline_count`] and [`truncated`]: the reply's issue list.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::document::{member, Issue, ID_MAPS};
use crate::grammar::{Handle, Scheme};

/// The tech design's read cap: the most characters of issues a reply inlines.
pub const READ_CAP: usize = 8_192;

/// A writer's kind (Writer connection: `writer.kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum WriterKind {
    You,
    Shell,
    Record,
    Agent,
    Plugin,
}

impl WriterKind {
    pub fn name(self) -> &'static str {
        match self {
            WriterKind::You => "you",
            WriterKind::Shell => "shell",
            WriterKind::Record => "record",
            WriterKind::Agent => "agent",
            WriterKind::Plugin => "plugin",
        }
    }
}

/// A writer as its connection proves it, never as a payload claims it. An agent's `id` is its
/// session's thread, so an ID `/clear` or `/compact` rotates keeps its layer.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Writer {
    pub kind: WriterKind,
    pub id: String,
}

impl Writer {
    /// The writer as a layer's `writer` field holds it: `kind:id`.
    pub fn text(&self) -> String {
        format!("{}:{}", self.kind.name(), self.id)
    }

    /// `{kind, id}`, as a revision's row names its writer.
    pub fn to_json(&self) -> Value {
        json!({"kind": self.kind.name(), "id": self.id})
    }

    /// The ID of this writer's layer: its kind and the first 48 bits of the SHA-256 of its text,
    /// so any thread ID gives a layer ID the ID grammar reads, and one writer one layer.
    pub fn layer_id(&self) -> String {
        let digest = Sha256::digest(self.text().as_bytes());
        let hex: String = digest[..6].iter().map(|b| format!("{b:02x}")).collect();
        format!("{}-{hex}", self.kind.name())
    }

    /// The band the core gives this writer's layer (Band: never one it picks).
    pub fn band(&self) -> Band {
        match self.kind {
            WriterKind::Record => Band::Record,
            WriterKind::You => Band::Work,
            WriterKind::Agent => Band::Agent,
            WriterKind::Plugin => Band::PluginOverlay,
            WriterKind::Shell => Band::Shell,
        }
    }

    /// An agent's layer is outlined with its name, for you to hide.
    pub fn outlined(&self) -> bool {
        self.kind == WriterKind::Agent
    }
}

/// The bands, in the order they compose: the card always last.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Band {
    Record,
    Work,
    Agent,
    PluginOverlay,
    Shell,
    Card,
}

impl Band {
    pub fn name(self) -> &'static str {
        match self {
            Band::Record => "record",
            Band::Work => "work",
            Band::Agent => "agent",
            Band::PluginOverlay => "plugin_overlay",
            Band::Shell => "shell",
            Band::Card => "card",
        }
    }
}

/// `payload` as `writer`'s document `doc`: the envelope with `id`, one layer for the writer,
/// titled `title`, and every item in it. A payload that names a layer or a writer (a `layers`
/// map, an item's `layer`, a `writer` field) is refused, each field an `unknown_field` issue: the
/// layer and its writer come from the connection alone.
pub fn stamp(
    payload: &Value,
    doc: &str,
    writer: &Writer,
    title: &str,
) -> Result<Value, Vec<Issue>> {
    let Some(envelope) = payload.as_object() else {
        return Err(vec![Issue::envelope(
            "out_of_range",
            String::new(),
            Value::Null,
            "a document is an object",
        )]);
    };
    let claimed = "the layer and its writer come from the connection, never the payload";
    let mut issues = Vec::new();
    for key in ["layers", "writer"] {
        if let Some(value) = envelope.get(key) {
            issues.push(Issue::envelope(
                "unknown_field",
                key.into(),
                value.clone(),
                claimed,
            ));
        }
    }
    if let Some(Value::Object(items)) = envelope.get("items") {
        for (id, item) in items {
            if let Some(layer) = member(item, "layer") {
                issues.push(Issue::error(
                    "unknown_field",
                    id,
                    format!("items/{id}/layer"),
                    layer.clone(),
                    claimed,
                ));
            }
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let layer = writer.layer_id();
    let mut out = Map::new();
    out.insert("id".into(), json!(doc));
    for (key, value) in envelope {
        if key != "id" {
            out.insert(key.clone(), value.clone());
        }
    }
    out.insert(
        "layers".into(),
        json!({&layer: {"writer": writer.text(), "title": title, "order": "a0"}}),
    );
    if let Some(Value::Object(items)) = out.get_mut("items") {
        for item in items.values_mut() {
            if let Value::Object(fields) = item {
                fields.insert("layer".into(), json!(layer));
            }
        }
    }
    Ok(Value::Object(out))
}

/// Which maps a whole revision is diffed in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// Every map keyed by ID (Revision).
    Every,
    /// The items map alone: #393's planted deep_show, which fails its acceptance test.
    ItemsOnly,
}

/// A presented whole revision's IDs, each list sorted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Diff {
    pub changed: Vec<String>,
    pub unchanged: Vec<String>,
    pub created: Vec<String>,
    pub removed: Vec<String>,
}

impl Diff {
    pub fn to_json(&self) -> Value {
        json!({
            "changed": self.changed,
            "unchanged": self.unchanged,
            "created": self.created,
            "removed": self.removed,
        })
    }
}

/// The entries of `doc`'s maps keyed by ID (items first) that `owns` gives a writer, by map.
fn held<'a>(
    doc: &'a Value,
    owns: &dyn Fn(&str, &str, &Value) -> bool,
) -> BTreeMap<&'static str, BTreeMap<&'a str, &'a Value>> {
    let mut out = BTreeMap::new();
    for map in std::iter::once("items").chain(ID_MAPS.iter().copied()) {
        let mut entries = BTreeMap::new();
        if let Some(Value::Object(m)) = member(doc, map) {
            for (id, entry) in m {
                if owns(map, id, entry) {
                    entries.insert(id.as_str(), entry);
                }
            }
        }
        out.insert(map, entries);
    }
    out
}

/// `next`, a whole revision of `layer`, against `current`: each ID the layer holds now that
/// `next` leaves out must be in `removes`, or the revision is refused with one
/// `unintended_removal` issue per ID it dropped. Otherwise the IDs changed, unchanged, created and
/// removed. In R1 a deep_show document has one writer, so every map keyed by ID but the items is
/// held whole (`Scope::Every`).
pub fn whole_diff(
    current: Option<&Value>,
    next: &Value,
    layer: &str,
    removes: &[String],
    scope: Scope,
) -> Result<Diff, Vec<Issue>> {
    let owns = |map: &str, _: &str, entry: &Value| {
        if map == "items" {
            member(entry, "layer").and_then(Value::as_str) == Some(layer)
        } else {
            scope == Scope::Every
        }
    };
    whole_diff_by(current, next, &owns, &owns, removes)
}

/// `next` against `current`, each read through what the writer holds in it (`was`, `now`): an
/// entry `was` gives the writer that `next` leaves out must be named in `removes`, or it is an
/// `unintended_removal`, so a writer's whole revision of a shared document never counts another
/// writer's entries as removed.
pub fn whole_diff_by(
    current: Option<&Value>,
    next: &Value,
    was: &dyn Fn(&str, &str, &Value) -> bool,
    now: &dyn Fn(&str, &str, &Value) -> bool,
    removes: &[String],
) -> Result<Diff, Vec<Issue>> {
    let empty = Value::Null;
    let before = held(current.unwrap_or(&empty), was);
    let after = held(next, now);
    let mut diff = Diff::default();
    let mut issues = Vec::new();
    for (map, was) in &before {
        let now = &after[map];
        for (id, old) in was {
            match now.get(id) {
                Some(new) if new == old => diff.unchanged.push(id.to_string()),
                Some(_) => diff.changed.push(id.to_string()),
                None if removes.iter().any(|r| r == id) => diff.removed.push(id.to_string()),
                None => issues.push(Issue::error(
                    "unintended_removal",
                    id,
                    format!("{map}/{id}"),
                    Value::Null,
                    "the revision leaves this ID out and doesn't name it in `removes`",
                )),
            }
        }
        diff.created.extend(
            now.keys()
                .filter(|id| !was.contains_key(*id))
                .map(|id| id.to_string()),
        );
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    for list in [
        &mut diff.changed,
        &mut diff.unchanged,
        &mut diff.created,
        &mut diff.removed,
    ] {
        list.sort();
    }
    Ok(diff)
}

/// `ref_unresolved` for each status binding's and bound value's source that is a handle of the
/// record `can_read` refuses for this writer, naming the handle: a value it couldn't read is
/// never shown.
pub fn unreadable_handles(doc: &Value, can_read: impl Fn(&str) -> bool) -> Vec<Issue> {
    let mut issues = Vec::new();
    for map in ["status_bindings", "bound_values"] {
        let Some(Value::Object(bindings)) = member(doc, map) else {
            continue;
        };
        for (id, binding) in bindings {
            let Some(source) = member(binding, "source").and_then(Value::as_str) else {
                continue;
            };
            let Ok(handle) = Handle::parse(source) else {
                continue;
            };
            if handle.scheme() != Scheme::Doc && !can_read(source) {
                issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    format!("{map}/{id}/source"),
                    json!(source),
                    "this writer's credential can't read the handle",
                ));
            }
        }
    }
    issues
}

/// Sorts a reply's issues: errors first, then by code, then by IDs, each by code point.
pub fn order_issues(issues: &mut [Value]) {
    let key = |i: &Value| {
        let rank = match member(i, "severity").and_then(Value::as_str) {
            Some("error") => 0,
            Some("warning") => 1,
            Some("notice") => 2,
            _ => 3,
        };
        let code = member(i, "code")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let ids: Vec<String> = member(i, "ids")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        (rank, code, ids)
    };
    issues.sort_by_cached_key(key);
}

/// How many of `issues`, from the first, a reply inlines: the longest prefix whose JSON text, as
/// the hub's JSON writes it, is at most [`READ_CAP`] characters.
pub fn inline_count(issues: &[Value]) -> usize {
    // `[` and `]`, then each issue and the comma before every one but the first.
    let mut size = 2;
    for (n, issue) in issues.iter().enumerate() {
        let next = size + usize::from(n > 0) + json_chars(issue);
        if next > READ_CAP {
            return n;
        }
        size = next;
    }
    issues.len()
}

/// `truncated: {shown, total, by_code}` for a reply that inlines `shown` of `issues`.
pub fn truncated(issues: &[Value], shown: usize) -> Value {
    let mut by_code: BTreeMap<&str, u64> = BTreeMap::new();
    for issue in issues {
        *by_code
            .entry(member(issue, "code").and_then(Value::as_str).unwrap_or(""))
            .or_default() += 1;
    }
    json!({"shown": shown, "total": issues.len(), "by_code": by_code})
}

/// The characters of `value`'s JSON text as the hub's JSON writer (`JSON.stringify`) writes it:
/// no whitespace, and numbers in JavaScript's form, so the cap counts what an agent reads.
pub fn json_chars(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(b) => {
            if *b {
                4
            } else {
                5
            }
        }
        Value::Number(n) => number_text(n).chars().count(),
        Value::String(s) => string_chars(s),
        Value::Array(a) => 2 + a.len().saturating_sub(1) + a.iter().map(json_chars).sum::<usize>(),
        Value::Object(o) => {
            2 + o.len().saturating_sub(1)
                + o.iter()
                    .map(|(k, v)| string_chars(k) + 1 + json_chars(v))
                    .sum::<usize>()
        }
    }
}

fn string_chars(s: &str) -> usize {
    2 + s
        .chars()
        .map(|c| match c {
            '"' | '\\' | '\u{8}' | '\u{c}' | '\n' | '\r' | '\t' => 2,
            c if (c as u32) < 0x20 => 6,
            _ => 1,
        })
        .sum::<usize>()
}

/// A number as JavaScript prints it (Number::toString): the shortest digits that read back,
/// plain from 1e-6 up to 1e21, exponential with an explicit sign outside.
fn number_text(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let x = n.as_f64().unwrap_or(0.0);
    if x == 0.0 {
        return "0".into();
    }
    // Rust's `{:e}` is the shortest round-trip: `d[.ddd]e<exp>`.
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i64;
    let n = exp.parse::<i64>().unwrap_or(0) + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e >= 0 { "+" } else { "-" };
        match digits.len() {
            1 => format!("{digits}e{sign}{}", e.abs()),
            _ => format!("{}.{}e{sign}{}", &digits[..1], &digits[1..], e.abs()),
        }
    };
    if x < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_as_javascript_does() {
        for (x, js) in [
            (1.5, "1.5"),
            (1e21, "1e+21"),
            (1.25e21, "1.25e+21"),
            (123456.0, "123456"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (-2.5e-7, "-2.5e-7"),
            (0.1, "0.1"),
        ] {
            let n = serde_json::Number::from_f64(x).unwrap();
            assert_eq!(number_text(&n), js, "{x}");
        }
    }

    #[test]
    fn strings_count_their_escapes() {
        // "a\"b\n\u0001" is 2 quotes + a, \", b, \n, \u0001.
        assert_eq!(json_chars(&json!("a\"b\n\u{1}")), 2 + 1 + 2 + 1 + 2 + 6);
        assert_eq!(
            json_chars(&json!({"k": [1, null]})),
            r#"{"k":[1,null]}"#.len()
        );
    }
}
