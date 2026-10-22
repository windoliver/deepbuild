//! The document check: migrations first, then every rule of the document contract over the
//! lowered form, which is returned with the issues, the notices and the draw list.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::{
    as_f64, as_object, kind_text, member, sort_issues, sort_notices, Issue, Notice, AT_VECTORS,
    ENVELOPE_KEYS, ID_MAPS, ITEM_KEYS, ITEM_OWN_FIELDS, MAX_DESCRIPTION,
};
use crate::grammar::{
    forms_for, Handle, Id, Path, Refusal, Section, Time, TimeContext, UnitContext, UnitLiteral,
};
use crate::kinds::{lookup, parse_required, registry, Entry, Lookup, ParamType, Version};

/// The closed list of item roles.
const ROLES: &[&str] = &["part", "control", "label", "data", "decoration"];
/// The closed list of layer roles (canvas primitives: Layer).
const LAYER_ROLES: &[&str] = &["content", "annotation"];
/// The closed list of document profiles (canvas primitives: Document).
const PROFILES: &[&str] = &[
    "figure", "film", "scene", "world", "view", "board", "sheet", "chart", "cells",
];
/// A layer's keys.
const LAYER_KEYS: &[&str] = &["writer", "title", "order", "role", "locked"];

/// What a check returns.
#[derive(Clone, Debug)]
pub struct CheckResult {
    /// True when no issue of severity `error` was raised.
    pub ok: bool,
    pub issues: Vec<Issue>,
    pub notices: Vec<Notice>,
    /// The IDs of the items that would draw, sorted.
    pub draws: Vec<String>,
    /// The document as the check read it: migrated, skipped fields dropped, literals converted.
    pub lowered: Value,
}

impl CheckResult {
    pub fn to_json(&self) -> Value {
        json!({
            "ok": self.ok,
            "issues": self.issues.iter().map(Issue::to_json).collect::<Vec<_>>(),
            "notices": self.notices.iter().map(Notice::to_json).collect::<Vec<_>>(),
            "draws": self.draws,
            "lowered": self.lowered,
        })
    }
}

/// Checks `doc`.
pub fn check(doc: &Value) -> CheckResult {
    let mut issues = Vec::new();
    let mut notices = Vec::new();
    let mut draws = Vec::new();
    let mut lowered = doc.clone();

    check_envelope(doc, &mut issues);
    let required = required_minors(doc, &mut issues);
    let layer_ids = check_layers(doc, &mut issues);
    let item_ids: BTreeSet<String> = member(doc, "items")
        .and_then(as_object)
        .map(|items| items.keys().cloned().collect())
        .unwrap_or_default();
    // The parents as written, for the cycle walk.
    let parents: BTreeMap<String, String> = member(doc, "items")
        .and_then(as_object)
        .map(|items| {
            items
                .iter()
                .filter_map(|(k, v)| {
                    member(v, "parent")
                        .and_then(Value::as_str)
                        .map(|p| (k.clone(), p.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    match lowered.get_mut("items") {
        None => {}
        Some(Value::Object(items)) => {
            for (key, item) in items.iter_mut() {
                migrate_item(key, item, &mut notices);
            }
            let ctx = ItemContext {
                layer_ids: &layer_ids,
                item_ids: &item_ids,
                parents: &parents,
                required: &required,
            };
            for (key, item) in items.iter_mut() {
                if check_item(key, item, &ctx, &mut issues, &mut notices) {
                    draws.push(key.clone());
                }
            }
        }
        Some(other) => issues.push(Issue::envelope(
            "out_of_range",
            "items".into(),
            other.clone(),
            "not an object",
        )),
    }

    check_id_maps(&lowered, &mut issues);
    check_targets(&lowered, "channels", false, &mut issues);
    check_targets(&lowered, "bound_values", true, &mut issues);
    super::rules::check(&lowered, &mut issues);

    sort_issues(&mut issues);
    sort_notices(&mut notices);
    draws.sort();
    let ok = !issues.iter().any(|i| i.severity == "error");
    CheckResult {
        ok,
        issues,
        notices,
        draws,
        lowered,
    }
}

fn check_envelope(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(envelope) = as_object(doc) else {
        issues.push(Issue::envelope(
            "out_of_range",
            String::new(),
            doc.clone(),
            "a document is an object",
        ));
        return;
    };
    // The envelope's fields without a default (Document envelope, and the shape, which writes
    // `layers` and `items` in every canonical form): absent is out of range, since a document
    // with no profile or size has nothing to check against, and one with no `layers` or `items`
    // would differ in bytes and hash from one with them empty. The other maps keyed by ID
    // default to empty.
    for key in [
        "format",
        "id",
        "profile",
        "title",
        "description",
        "size",
        "layers",
        "items",
    ] {
        if !envelope.contains_key(key) {
            issues.push(Issue::envelope(
                "out_of_range",
                key.into(),
                Value::Null,
                "required, and absent",
            ));
        }
    }
    for (key, value) in envelope {
        if !ENVELOPE_KEYS.contains(&key.as_str()) {
            issues.push(Issue::envelope(
                "unknown_field",
                key.clone(),
                value.clone(),
                "not a field of the document envelope",
            ));
        }
    }
    if let Some(format) = envelope.get("format") {
        if as_f64(format) != Some(1.0) {
            issues.push(Issue::envelope(
                "out_of_range",
                "format".into(),
                format.clone(),
                "format is 1",
            ));
        }
    }
    if let Some(description) = envelope.get("description") {
        match description.as_str() {
            Some(s) if s.chars().count() <= MAX_DESCRIPTION => {}
            Some(_) => issues.push(Issue::envelope(
                "out_of_range",
                "description".into(),
                description.clone(),
                "longer than 400 characters",
            )),
            // The closed code list has no type code: a value of the wrong type is out of the
            // field's range.
            None => issues.push(Issue::envelope(
                "out_of_range",
                "description".into(),
                description.clone(),
                "not a string",
            )),
        }
    }
    for key in ["id", "profile", "title"] {
        if let Some(value) = envelope.get(key) {
            if !value.is_string() {
                issues.push(Issue::envelope(
                    "out_of_range",
                    key.into(),
                    value.clone(),
                    "not a string",
                ));
            }
        }
    }
    // `id: ID`: the one ID grammar, as every key keyed by ID.
    if let Some(Value::String(id)) = envelope.get("id") {
        if let Err(r) = Id::parse(id) {
            issues.push(Issue::envelope("bad_id", "id".into(), json!(id), &r.what));
        }
    }
    if let Some(Value::String(profile)) = envelope.get("profile") {
        if !PROFILES.contains(&profile.as_str()) {
            issues.push(Issue::envelope(
                "out_of_range",
                "profile".into(),
                json!(profile),
                &format!("not a profile; one of {}", PROFILES.join(", ")),
            ));
        }
    }
    if let Some(size) = envelope.get("size") {
        if !is_vector(size, 2) {
            issues.push(Issue::envelope(
                "out_of_range",
                "size".into(),
                size.clone(),
                "not two numbers finite at f32",
            ));
        }
    }
}

/// `requires` (Document envelope: `{core: semver, kinds: [family.name@major.minor], modules:
/// {canvas module → semver range}, preview: [name@major]}`) checked as a closed object, and
/// `requires.kinds` read: the highest minor the document requires of each kind at each major,
/// keyed `family.name@major`; a minor is a schema of one major, so it says nothing about another.
fn required_minors(doc: &Value, issues: &mut Vec<Issue>) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    let Some(requires) = member(doc, "requires") else {
        return out;
    };
    let Some(fields) = as_object(requires) else {
        issues.push(Issue::envelope(
            "out_of_range",
            "requires".into(),
            requires.clone(),
            "not an object",
        ));
        return out;
    };
    for (field, value) in fields {
        let path = format!("requires/{field}");
        let wrong = |what: &str| Issue::envelope("out_of_range", path.clone(), value.clone(), what);
        match field.as_str() {
            "kinds" => {}
            "core" => {
                if !value.is_string() {
                    issues.push(wrong("not a version"));
                }
            }
            "modules" => match as_object(value) {
                Some(modules) => {
                    for (module, range) in modules {
                        if !range.is_string() {
                            issues.push(Issue::envelope(
                                "out_of_range",
                                format!("{path}/{module}"),
                                range.clone(),
                                "not a version range",
                            ));
                        }
                    }
                }
                None => issues.push(wrong("not an object")),
            },
            "preview" => match value.as_array() {
                Some(names) => {
                    for (i, name) in names.iter().enumerate() {
                        if !name.is_string() {
                            issues.push(Issue::envelope(
                                "out_of_range",
                                format!("{path}/{i}"),
                                name.clone(),
                                "not a name@major",
                            ));
                        }
                    }
                }
                None => issues.push(wrong("not a list")),
            },
            _ => issues.push(Issue::envelope(
                "unknown_field",
                path.clone(),
                value.clone(),
                "not a field of requires",
            )),
        }
    }
    let Some(kinds) = member(requires, "kinds") else {
        return out;
    };
    let Some(list) = kinds.as_array() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "requires/kinds".into(),
            kinds.clone(),
            "not a list",
        ));
        return out;
    };
    for (i, entry) in list.iter().enumerate() {
        match entry.as_str().and_then(parse_required) {
            Some((name, major, minor)) => {
                let slot = out.entry(format!("{name}@{major}")).or_insert(0);
                *slot = (*slot).max(minor);
            }
            None => issues.push(Issue::envelope(
                "out_of_range",
                format!("requires/kinds/{i}"),
                entry.clone(),
                "not `family.name@major.minor`",
            )),
        }
    }
    out
}

fn check_layers(doc: &Value, issues: &mut Vec<Issue>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let Some(layers) = member(doc, "layers") else {
        return ids;
    };
    let Some(layers) = as_object(layers) else {
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
        let Some(fields) = as_object(layer) else {
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

/// Runs an item's migrations in place, one major a step, with a notice per step. The check runs
/// it on its lowered copy at load; `apply` runs it on the stored document for the writer's own
/// items once a patch of theirs goes through.
pub(super) fn migrate_item(key: &str, item: &mut Value, notices: &mut Vec<Notice>) {
    let Some(text) = kind_text(item).map(str::to_string) else {
        return;
    };
    let registry = registry();
    let Lookup::Known { entry, saved } = lookup(&registry, &text) else {
        return;
    };
    let Some(steps) = entry.steps_from(saved) else {
        return;
    };
    let Some(fields) = item.as_object_mut() else {
        return;
    };
    for step in steps {
        if let Some(Value::Object(params)) = fields.get_mut("params") {
            for rename in &step.renames {
                if params.contains_key(rename.to) {
                    continue;
                }
                if let Some(value) = params.shift_remove(rename.from) {
                    params.insert(rename.to.to_string(), value);
                }
            }
        }
        fields.insert(
            "kind".into(),
            json!(format!("{}@{}", entry.full_name(), step.to)),
        );
        notices.push(Notice {
            code: "migrated",
            ids: vec![key.to_string()],
            path: format!("items/{key}/kind"),
            actual: json!(text),
            what: format!(
                "migrated {} from major {} to {}",
                entry.full_name(),
                step.from,
                step.to
            ),
            migration: Some((entry.full_name(), step.from, step.to)),
        });
    }
}

struct ItemContext<'a> {
    layer_ids: &'a BTreeSet<String>,
    item_ids: &'a BTreeSet<String>,
    parents: &'a BTreeMap<String, String>,
    required: &'a BTreeMap<String, u32>,
}

/// Checks one lowered item in place; true when it draws.
fn check_item(
    key: &str,
    item: &mut Value,
    ctx: &ItemContext<'_>,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) -> bool {
    let at = |field: &str| format!("items/{key}/{field}");
    let Some(fields) = item.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}"),
            item.clone(),
            "not an object",
        ));
        return false;
    };
    if let Err(r) = Id::parse(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            format!("items/{key}"),
            json!(key),
            &r.what,
        ));
    }
    let Some(text) = kind_text(item).map(str::to_string) else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            at("kind"),
            fields.get("kind").cloned().unwrap_or(Value::Null),
            "not a string",
        ));
        return false;
    };
    // The kind decides the params alone: an item of a kind this build does not know, or knows
    // only at a lower major, still meets the item contract core defines (its keys, its id, its
    // layer and parent, its common fields), and is kept byte for byte, its params unread.
    let registry = registry();
    let known = match lookup(&registry, &text) {
        Lookup::UnknownKind => {
            notices.push(Notice {
                code: "unknown_kind",
                ids: vec![key.to_string()],
                path: at("kind"),
                actual: json!(text),
                what: format!("kind `{text}` is not registered in this build; the item is skipped"),
                migration: None,
            });
            None
        }
        Lookup::Malformed => {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at("kind"),
                json!(text),
                "not family.name@major",
            ));
            None
        }
        Lookup::TooNew { entry, saved } => {
            issues.push(Issue::error(
                "kind_too_new",
                key,
                at("kind"),
                json!(text),
                &format!(
                    "{} is at major {} in this build, below {saved}",
                    entry.full_name(),
                    entry.current().major
                ),
            ));
            None
        }
        Lookup::Known { entry, saved } => Some((entry, saved)),
    };

    for (field, value) in fields {
        if !ITEM_KEYS.contains(&field.as_str()) {
            issues.push(Issue::error(
                "unknown_field",
                key,
                at(field),
                value.clone(),
                "not a field of an item",
            ));
        }
    }
    if fields.get("id").and_then(Value::as_str) != Some(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            at("id"),
            fields.get("id").cloned().unwrap_or(Value::Null),
            "an item's id equals its key",
        ));
    }
    match fields.get("layer").and_then(Value::as_str) {
        Some(layer) if ctx.layer_ids.contains(layer) => {}
        _ => issues.push(Issue::error(
            "ref_unresolved",
            key,
            at("layer"),
            fields.get("layer").cloned().unwrap_or(Value::Null),
            "names no layer of the document",
        )),
    }
    match fields.get("parent") {
        None | Some(Value::Null) => {}
        Some(Value::String(parent)) if ctx.item_ids.contains(parent) => {
            if has_cycle(key, ctx.parents) {
                issues.push(Issue::error(
                    "cycle",
                    key,
                    at("parent"),
                    json!(parent),
                    "the parents lead back to the item",
                ));
            }
        }
        Some(parent) => issues.push(Issue::error(
            "ref_unresolved",
            key,
            at("parent"),
            parent.clone(),
            "names no item of the document",
        )),
    }
    for field in ["name", "order"] {
        if !fields.get(field).is_some_and(Value::is_string) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at(field),
                fields.get(field).cloned().unwrap_or(Value::Null),
                "not a string",
            ));
        }
    }
    if let Some(role) = fields.get("role") {
        if !role.as_str().is_some_and(|r| ROLES.contains(&r)) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at("role"),
                role.clone(),
                "not one of part, control, label, data, decoration",
            ));
        }
    }
    for field in ["visible", "pickable"] {
        if let Some(value) = fields.get(field) {
            if !value.is_boolean() {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    at(field),
                    value.clone(),
                    "not a boolean",
                ));
            }
        }
    }
    if let Some(at_value) = fields.get("at") {
        check_at(key, at_value, issues);
    }

    // `params` is always written, even `{}`, whatever the kind; only its members wait for one.
    if !fields.get("params").is_some_and(Value::is_object) {
        issues.push(Issue::error(
            "out_of_range",
            key,
            at("params"),
            fields.get("params").cloned().unwrap_or(Value::Null),
            "not an object",
        ));
    }
    let Some((entry, major)) = known else {
        return false;
    };
    // After migration the lowered kind is the build's major; a kind no step reaches stays at
    // its saved schema.
    let version = entry.version(major).unwrap_or(entry.current());

    // Params: the schema decides each one; the lowered form gets converted literals and loses
    // the fields a required newer minor skips.
    let required_minor = ctx
        .required
        .get(&format!("{}@{}", entry.full_name(), version.major))
        .copied();
    let Some(fields) = item.as_object_mut() else {
        return false;
    };
    if let Some(Value::Object(params)) = fields.get_mut("params") {
        check_params(key, params, entry, version, required_minor, issues, notices);
    }
    true
}

/// True when following parents from `start` returns to it.
fn has_cycle(start: &str, parents: &BTreeMap<String, String>) -> bool {
    let mut at = start;
    for _ in 0..=parents.len() {
        match parents.get(at) {
            Some(next) if next == start => return true,
            Some(next) => at = next,
            None => return false,
        }
    }
    false
}

fn check_at(key: &str, at_value: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = as_object(at_value) else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/at"),
            at_value.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/at/{name}");
        if AT_VECTORS.contains(&name.as_str()) {
            if !is_vector(value, 3) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not three numbers finite at f32",
                ));
            }
        } else if name == "shear" {
            if !fits_f32(value) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not a number finite at f32",
                ));
            }
        } else {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a member of at in this slice",
            ));
        }
    }
}

/// A number an f32 field holds: finite at that width, as the canonical form requires, so a
/// document the check passes always has a revision hash.
fn fits_f32(value: &Value) -> bool {
    as_f64(value).is_some_and(|f| (f as f32).is_finite())
}

/// `n` numbers of an f32 vector (`size`, the `at` vectors).
fn is_vector(value: &Value, n: usize) -> bool {
    value
        .as_array()
        .is_some_and(|a| a.len() == n && a.iter().all(fits_f32))
}

fn check_params(
    key: &str,
    params: &mut Map<String, Value>,
    entry: &Entry,
    version: &Version,
    required_minor: Option<u32>,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) {
    let mut dropped = Vec::new();
    let mut converted = Vec::new();
    for (name, value) in params.iter() {
        let path = format!("items/{key}/params/{name}");
        let Some(param) = version.param(name) else {
            if required_minor.is_some_and(|m| m > version.minor) {
                notices.push(Notice {
                    code: "unknown_field",
                    ids: vec![key.to_string()],
                    path,
                    actual: value.clone(),
                    what: format!(
                        "{}@{}.{} does not define `{name}`; the document requires a newer minor, so it is skipped",
                        entry.full_name(),
                        version.major,
                        version.minor
                    ),
                    migration: None,
                });
                dropped.push(name.clone());
            } else {
                issues.push(Issue::error(
                    "unknown_field",
                    key,
                    path,
                    value.clone(),
                    &format!(
                        "{}@{}.{} does not define `{name}`",
                        entry.full_name(),
                        version.major,
                        version.minor
                    ),
                ));
            }
            continue;
        };
        if !param.module.is_empty() && !value.is_null() {
            issues.push(Issue::error(
                "module_missing",
                key,
                path,
                value.clone(),
                &format!(
                    "`{name}` is evaluated by the {} module, which this build lacks",
                    param.module
                ),
            ));
            continue;
        }
        match param.ty {
            // The kind's own reader checks the value's shape when it evaluates the item.
            ParamType::Json => {}
            ParamType::Str => {
                if !value.is_string() {
                    // The closed code list has no type code; a value of another type is out of
                    // the field's range.
                    issues.push(Issue::error(
                        "out_of_range",
                        key,
                        path,
                        value.clone(),
                        "not a string",
                    ));
                }
            }
            ParamType::F32 => {
                let number = match value {
                    Value::Number(_) => as_f64(value),
                    Value::String(text) => match convert_literal(text, param.unit) {
                        Ok(n) => {
                            converted.push((name.clone(), n));
                            Some(n)
                        }
                        Err(r) => {
                            issues.push(Issue {
                                forms: literal_forms(param.unit),
                                ..Issue::error(
                                    "bad_unit",
                                    key,
                                    path.clone(),
                                    value.clone(),
                                    &r.what,
                                )
                            });
                            None
                        }
                    },
                    _ => {
                        issues.push(Issue {
                            forms: literal_forms(param.unit),
                            ..Issue::error(
                                "bad_unit",
                                key,
                                path.clone(),
                                value.clone(),
                                "neither a number nor a unit literal",
                            )
                        });
                        None
                    }
                };
                if let Some(n) = number {
                    let below = param.min.is_some_and(|min| n < min);
                    let above = param.max.is_some_and(|max| n > max);
                    if below || above || !(n as f32).is_finite() {
                        issues.push(Issue::error(
                            "out_of_range",
                            key,
                            path,
                            json!(n),
                            &format!(
                                "outside {} to {}",
                                param.min.unwrap_or(f64::NEG_INFINITY),
                                param.max.unwrap_or(f64::INFINITY)
                            ),
                        ));
                    }
                }
            }
        }
    }
    for name in dropped {
        params.shift_remove(&name);
    }
    for (name, n) in converted {
        params.insert(name, json!(n));
    }
}

/// A unit literal's value in a field declared in `unit`, as an f64.
fn convert_literal(text: &str, unit: &str) -> Result<f64, Refusal> {
    let literal = UnitLiteral::parse(text)?;
    let value = literal.convert(unit, &UnitContext::default())?;
    Ok(value.to_f64())
}

/// The forms a field in `unit` takes, each a literal the unit printer wrote (`1m`, `1cm`, …);
/// the bare form is left out.
pub(crate) fn literal_forms(unit: &str) -> Vec<String> {
    forms_for(unit)
        .into_iter()
        .filter(|form| form.bytes().any(|c| c.is_ascii_lowercase()))
        .collect()
}

/// Checks a map of `{target: path[, source: handle]}` entries against the lowered document.
/// Every map keyed by ID takes keys in the ID grammar; a key a path can't name is `bad_id`.
fn check_key(section: &str, key: &str, issues: &mut Vec<Issue>) {
    if let Err(r) = Id::parse(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            format!("{section}/{key}"),
            json!(key),
            &r.what,
        ));
    }
}

/// Every map keyed by ID besides `layers` and `items`: an object whose keys follow the one ID
/// grammar, whatever its entries hold (their shapes belong to the issues that give them behavior).
fn check_id_maps(doc: &Value, issues: &mut Vec<Issue>) {
    for section in ID_MAPS {
        let Some(entries) = member(doc, section) else {
            continue;
        };
        let Some(entries) = as_object(entries) else {
            issues.push(Issue::envelope(
                "out_of_range",
                (*section).into(),
                entries.clone(),
                "not an object",
            ));
            continue;
        };
        for key in entries.keys() {
            check_key(section, key, issues);
        }
    }
}

/// The entries of `channels` or `bound_values`; the section and its keys are [`check_id_maps`]'s.
fn check_targets(doc: &Value, section: &str, with_source: bool, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, section).and_then(as_object) else {
        return;
    };
    // A channel is `{target}`; a bound value is `{target, source}` with the fields of Bound
    // value, nothing else.
    let allowed: &[&str] = if with_source {
        BOUND_VALUE_FIELDS
    } else {
        &["target"]
    };
    for (key, entry) in entries {
        let Some(fields) = as_object(entry) else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{section}/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !allowed.contains(&field.as_str()) {
                issues.push(Issue::error(
                    "unknown_field",
                    key,
                    format!("{section}/{key}/{field}"),
                    value.clone(),
                    &format!("not a field of a {section} entry"),
                ));
            }
        }
        let target_path = format!("{section}/{key}/target");
        match member(entry, "target") {
            Some(Value::String(text)) => match Path::parse(text) {
                Ok(path) => {
                    if let Err(what) = resolve(doc, &path) {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            key,
                            target_path,
                            json!(text),
                            &what,
                        ));
                    }
                }
                Err(r) => {
                    let code = if r.code == "bad_id" {
                        "bad_id"
                    } else {
                        "bad_path"
                    };
                    issues.push(Issue::error(code, key, target_path, json!(text), &r.what));
                }
            },
            other => issues.push(Issue::error(
                "out_of_range",
                key,
                target_path,
                other.cloned().unwrap_or(Value::Null),
                "not a path",
            )),
        }
        if let Some(stale_after) = member(entry, "stale_after") {
            if let Err(what) = duration(doc, stale_after) {
                issues.push(Issue::error(
                    "bad_time",
                    key,
                    format!("{section}/{key}/stale_after"),
                    stale_after.clone(),
                    &what,
                ));
            }
        }
        if with_source {
            let source_path = format!("{section}/{key}/source");
            match member(entry, "source") {
                Some(Value::String(text)) => {
                    if let Err(r) = Handle::parse(text) {
                        issues.push(Issue::error(
                            "bad_handle",
                            key,
                            source_path,
                            json!(text),
                            &r.what,
                        ));
                    }
                }
                other => issues.push(Issue::error(
                    "out_of_range",
                    key,
                    source_path,
                    other.cloned().unwrap_or(Value::Null),
                    "not a handle",
                )),
            }
        }
    }
}

/// A bound value's fields (Bound value).
const BOUND_VALUE_FIELDS: &[&str] = &[
    "target",
    "source",
    "select",
    "format",
    "as_of",
    "show",
    "stale_after",
    "missing",
];

/// A duration field's flicks: a time span (`"2s"`, `"120f"` at the transport's rate), above 0.
pub fn duration(doc: &Value, value: &Value) -> Result<i64, String> {
    let Value::String(text) = value else {
        return Err("not a time literal".into());
    };
    let rate = member(doc, "transport")
        .and_then(|t| member(t, "frame_rate"))
        .and_then(Value::as_array)
        .and_then(|pq| {
            let p = u32::try_from(pq.first()?.as_u64()?).ok()?;
            let q = u32::try_from(pq.get(1)?.as_u64()?).ok()?;
            Some((p, q))
        })
        .unwrap_or((60, 1));
    let ctx = TimeContext {
        frame_rate: rate,
        ..TimeContext::default()
    };
    match Time::parse(text) {
        Ok(Time::Span(span)) => match span.resolve(&ctx) {
            Ok(flicks) if flicks > 0 => Ok(flicks),
            Ok(_) => Err("a duration is above 0".into()),
            Err(r) => Err(r.what),
        },
        Ok(_) => Err("a duration is a span, such as 2s or 120f".into()),
        Err(r) => Err(r.what),
    }
}

/// Resolves a path against the (lowered) document: the item exists and each field step reaches
/// something. An item's fields resolve against its kind's schema; in this slice no kind gives
/// another section a schema, so a field step there must reach a value the document holds: a
/// key of an object or an index of a list.
pub(crate) fn resolve(doc: &Value, path: &Path) -> Result<(), String> {
    let id = path.id().as_str();
    let section = path.section().as_str();
    let Some(target) = member(doc, section).and_then(|m| member(m, id)) else {
        return Err(format!("{section}/{id} is not in the document"));
    };
    if let Some(sub) = path.sub() {
        return Err(format!(
            "`#{sub}` names a part of {section}/{id}, and no kind in this build has parts"
        ));
    }
    let fields: Vec<&str> = path.fields().iter().map(String::as_str).collect();
    let unreachable = || {
        Err(format!(
            "{section}/{id}/{} reaches nothing",
            fields.join("/")
        ))
    };
    if path.section() != Section::Items {
        let mut cursor = target;
        for field in &fields {
            cursor = match cursor {
                Value::Object(map) => map.get(*field),
                Value::Array(list) => field.parse::<usize>().ok().and_then(|i| list.get(i)),
                _ => None,
            }
            .ok_or_else(|| unreachable().unwrap_err())?;
        }
        return Ok(());
    }
    match fields.as_slice() {
        [] | ["params"] | ["at"] => Ok(()),
        ["params", name] => {
            let registry = registry();
            let known = match kind_text(target).map(|text| lookup(&registry, text)) {
                Some(Lookup::Known { entry, saved }) => entry
                    .version(saved)
                    .unwrap_or(entry.current())
                    .param(name)
                    .is_some(),
                _ => member(target, "params")
                    .and_then(as_object)
                    .is_some_and(|p| p.contains_key(*name)),
            };
            if known {
                Ok(())
            } else {
                unreachable()
            }
        }
        ["at", name] if AT_VECTORS.contains(name) || *name == "shear" => Ok(()),
        ["at", name, index] if AT_VECTORS.contains(name) && ["0", "1", "2"].contains(index) => {
            Ok(())
        }
        [field] if ITEM_OWN_FIELDS.contains(field) => Ok(()),
        _ => unreachable(),
    }
}
