//! The document check: migrations first, then every rule of the document contract over the
//! lowered form, which is returned with the issues, the notices and the draw list.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::{
    as_f64, as_object, kind_text, member, sort_issues, sort_notices, Issue, Notice, ADJUST_FIELDS,
    AT_VECTORS, ENVELOPE_KEYS, ID_MAPS, ITEM_KEYS, ITEM_OWN_FIELDS, MAX_DESCRIPTION,
};
use crate::grammar::{
    forms_for, Handle, Id, Path, Refusal, Section, Time, TimeContext, UnitContext, UnitLiteral,
};
use crate::kinds::{
    lookup, parse_kind, parse_required, Entry, Lookup, ParamType, Registry, Version,
};
use crate::registry::{self, core_name, Range, Sealed};

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
    /// `core@<version>` of the build that checked (Registry and seal).
    pub core: String,
    /// The module-set digest of that build.
    pub set_digest: String,
}

impl CheckResult {
    pub fn to_json(&self) -> Value {
        json!({
            "core": self.core,
            "set_digest": self.set_digest,
            "ok": self.ok,
            "issues": self.issues.iter().map(Issue::to_json).collect::<Vec<_>>(),
            "notices": self.notices.iter().map(Notice::to_json).collect::<Vec<_>>(),
            "draws": self.draws,
            "lowered": self.lowered,
        })
    }
}

/// Checks `doc` in the core's own build.
pub fn check(doc: &Value) -> CheckResult {
    check_in(doc, &registry::core())
}

/// Checks `doc` in the build `sealed` describes: a document that needs a canvas module the
/// build lacks, through `requires.modules`, a kind or a field an absent module evaluates, is
/// refused with `module_missing` naming the module.
pub fn check_in(doc: &Value, sealed: &Sealed) -> CheckResult {
    check_by(doc, sealed, &sealed.kinds())
}

/// Checks `doc` as a build whose kinds are `kinds`, as an earlier release with an older minor
/// of some kind reads it (Document envelope: `requires`); the core's own canvas modules.
pub fn check_with(doc: &Value, kinds: &Registry) -> CheckResult {
    check_by(doc, &registry::core(), kinds)
}

/// Checks `doc` in the build `sealed` describes, reading kinds by `kinds`.
fn check_by(doc: &Value, sealed: &Sealed, kinds: &Registry) -> CheckResult {
    let mut issues = Vec::new();
    let mut notices = Vec::new();
    let mut draws = Vec::new();
    let mut lowered = doc.clone();

    check_envelope(doc, &mut issues);
    let required = required_minors(doc, sealed, &mut issues);
    // The canvas modules the document declares, which every module kind it uses must be among.
    let declared: BTreeSet<String> = member(doc, "requires")
        .and_then(|r| member(r, "modules"))
        .and_then(as_object)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
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
                migrate_item(key, item, &mut notices, kinds);
            }
            let ctx = ItemContext {
                layer_ids: &layer_ids,
                item_ids: &item_ids,
                parents: &parents,
                required: &required,
                declared: &declared,
                sealed,
                kinds,
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

    module_checks(&lowered, sealed, &mut issues, &mut notices);
    check_id_maps(&lowered, &mut issues);
    check_targets(&lowered, "channels", false, kinds, sealed, &mut issues);
    check_targets(&lowered, "bound_values", true, kinds, sealed, &mut issues);
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
        core: core_name(),
        set_digest: sealed.set_digest.clone(),
    }
}

/// The frame CPU the budget estimate allows a document, in ms (`document.budget`).
pub const FRAME_CPU_MS: f64 = 16.0;

/// The checks canvas modules register over their kinds' items, and the budget estimate over
/// the costs they register: a module's code carries its catalog's fix, and the estimate past
/// the frame's CPU is `over_budget`, naming the items that cost.
fn module_checks(
    lowered: &Value,
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) {
    let Some(items) = member(lowered, "items").and_then(as_object) else {
        return;
    };
    let mut cost = 0.0;
    let mut costly = Vec::new();
    for (id, item) in items {
        let Some((full, _)) = kind_text(item).and_then(crate::kinds::parse_kind) else {
            continue;
        };
        for (module, rule) in sealed.rules_for(&full) {
            for r in rule(lowered, id, item) {
                if r.severity == "notice" {
                    notices.push(Notice {
                        code: r.code,
                        ids: vec![id.clone()],
                        path: r.path,
                        actual: Value::Null,
                        what: r.what,
                        migration: None,
                    });
                    continue;
                }
                let fix = module
                    .shapes
                    .catalog
                    .iter()
                    .find(|c| c.code == r.code)
                    .map(|c| c.fix.clone());
                let mut issue = Issue::error(r.code, id, r.path, Value::Null, &r.what);
                issue.severity = if r.severity == "warning" {
                    "warning"
                } else {
                    "error"
                };
                if let Some(fix) = fix {
                    issue.fix = fix;
                }
                issue.fix_ops = r.fix_ops;
                issues.push(issue);
            }
        }
        for c in sealed.costs_for(&full) {
            let ms = c(item);
            if ms > 0.0 {
                cost += ms;
                costly.push(id.clone());
            }
        }
    }
    if cost > FRAME_CPU_MS {
        let mut issue = Issue::envelope(
            "over_budget",
            "items".into(),
            json!(cost),
            &format!("the items cost {cost} ms of CPU a frame, past the {FRAME_CPU_MS} ms budget"),
        );
        issue.severity = "warning";
        issue.ids = costly;
        issues.push(issue);
    }
}

/// The issues of `doc`, a patch's result that changed only the items `changed`, re-checked
/// incrementally from `prev_issues`, the issues of the revision it was applied to (Patch: "re-checked incrementally"; the patch fuzzer's fifth
/// law: the same issues, by code, IDs and path, as a full check). The items the patch changed are
/// checked again, with those hanging from them and those whose params name one of them, in a
/// document of only them and what they read (their ancestors, the items their params name and the
/// camera); every other item keeps its issues. `None` when a full check is needed: the document
/// holds entries of other maps keyed by ID, which read items by path. A patch that reached
/// beyond items (a layer added) takes a full check, which the caller runs. Checked in the build
/// `sealed` describes, as [`check_in`] checks.
pub fn recheck(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
) -> Option<Vec<Issue>> {
    recheck_by(doc, prev_issues, changed, sealed, true)
}

/// [`recheck`]'s planted wrong program (the conformance kit's fifth law): the items the patch
/// changed are checked again, and those that hang from them or name them are not.
pub fn recheck_skipping_referrers(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
) -> Option<Vec<Issue>> {
    recheck_by(doc, prev_issues, changed, sealed, false)
}

fn recheck_by(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
    referrers: bool,
) -> Option<Vec<Issue>> {
    let after = doc.as_object()?;
    let maps_empty = ID_MAPS
        .iter()
        .all(|m| member(doc, m).and_then(as_object).is_none_or(Map::is_empty));
    // The budget estimate sums the whole document, so a build whose modules cost needs it whole.
    if !maps_empty || sealed.has_costs() {
        return None;
    }
    let items = member(doc, "items")?.as_object()?;
    // The items to check again: those changed, those whose params name one, and below them, in
    // passes over the items until a pass adds none.
    let mut affected: BTreeSet<String> = changed.clone();
    // The planted wrong program checks the changed items alone.
    loop {
        let more: Vec<&String> = items
            .iter()
            .filter(|_| referrers)
            .filter(|(id, item)| {
                !affected.contains(*id)
                    && (member(item, "parent")
                        .and_then(Value::as_str)
                        .is_some_and(|p| affected.contains(p))
                        || member(item, "params").is_some_and(|p| names_any(p, changed)))
            })
            .map(|(id, _)| id)
            .collect();
        if more.is_empty() {
            break;
        }
        affected.extend(more.into_iter().cloned());
    }
    // What they read: their ancestors, the items their params name, and the camera.
    let mut context: BTreeSet<String> = affected.clone();
    if let Some(camera) = member(doc, "camera").and_then(Value::as_str) {
        context.insert(camera.to_string());
    }
    for id in &affected {
        let Some(item) = items.get(id) else { continue };
        if let Some(params) = member(item, "params") {
            strings_in(params, &mut |s| {
                if items.contains_key(s) {
                    context.insert(s.to_string());
                }
            });
        }
        let mut at = member(item, "parent").and_then(Value::as_str);
        while let Some(p) = at.filter(|p| context.insert(p.to_string())) {
            at = items
                .get(p)
                .and_then(|i| member(i, "parent"))
                .and_then(Value::as_str);
        }
    }
    let mut reduced = Map::new();
    for (k, v) in after {
        if k != "items" {
            reduced.insert(k.clone(), v.clone());
        }
    }
    let subset: Map<String, Value> = context
        .iter()
        .filter_map(|id| Some((id.clone(), items.get(id)?.clone())))
        .collect();
    reduced.insert("items".into(), Value::Object(subset));
    let fresh = check_in(&Value::Object(reduced), sealed).issues;
    let touches = |i: &Issue| i.ids.iter().any(|id| affected.contains(id));
    let mut out: Vec<Issue> = prev_issues
        .iter()
        .filter(|i| !touches(i))
        .cloned()
        .chain(fresh.into_iter().filter(|i| touches(i)))
        .collect();
    sort_issues(&mut out);
    Some(out)
}

/// Calls `f` with each string `value` holds, at any depth.
fn strings_in(value: &Value, f: &mut dyn FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(list) => list.iter().for_each(|v| strings_in(v, f)),
        Value::Object(map) => map.values().for_each(|v| strings_in(v, f)),
        _ => {}
    }
}

/// Whether `value` holds, at any depth, a string in `ids`.
fn names_any(value: &Value, ids: &BTreeSet<String>) -> bool {
    match value {
        Value::String(s) => ids.contains(s),
        Value::Array(list) => list.iter().any(|v| names_any(v, ids)),
        Value::Object(map) => map.values().any(|v| names_any(v, ids)),
        _ => false,
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
fn required_minors(doc: &Value, sealed: &Sealed, issues: &mut Vec<Issue>) -> BTreeMap<String, u32> {
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
                        // A key that is no module name is the document's fault, not a
                        // module this build lacks.
                        if !registry::well_named(module) {
                            // An empty key has no path segment of its own.
                            let (at, what) = if module.is_empty() {
                                (path.clone(), "has an empty module name")
                            } else {
                                (format!("{path}/{module}"), "not a module name")
                            };
                            issues.push(Issue::envelope("out_of_range", at, range.clone(), what));
                            continue;
                        }
                        let parsed = range.as_str().and_then(Range::parse);
                        let Some(parsed) = parsed else {
                            issues.push(Issue::envelope(
                                "out_of_range",
                                format!("{path}/{module}"),
                                range.clone(),
                                "not a version range",
                            ));
                            continue;
                        };
                        // An absent module is `module_missing` (the check is BLOCKED); a
                        // present one at a version outside the range is the document's
                        // fault, `out_of_range`.
                        if !sealed.satisfies(module, &parsed) {
                            let (code, what) = match sealed.module(module) {
                                None => (
                                    "module_missing",
                                    format!(
                                        "the document requires the {module} module, which this build lacks"
                                    ),
                                ),
                                Some(m) => (
                                    "out_of_range",
                                    format!(
                                        "the document requires the {module} module at {parsed}; this build has {}",
                                        m.version
                                    ),
                                ),
                            };
                            issues.push(Issue::envelope(
                                code,
                                format!("{path}/{module}"),
                                range.clone(),
                                &what,
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
pub(super) fn migrate_item(
    key: &str,
    item: &mut Value,
    notices: &mut Vec<Notice>,
    registry: &Registry,
) {
    let Some(text) = kind_text(item).map(str::to_string) else {
        return;
    };
    let Lookup::Known { entry, saved } = lookup(registry, &text) else {
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
            crate::kinds::migrate_step(step, params);
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
    declared: &'a BTreeSet<String>,
    sealed: &'a Sealed,
    kinds: &'a crate::kinds::Registry,
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
    // A kind of a canvas module this build lacks is refused, naming the module, and nothing of
    // the item is read past its kind: a logic program's bytes, for one, are never opened. Text
    // outside the kind grammar is no module's kind; the lookup below refuses it.
    if let Some((name, _)) = parse_kind(&text) {
        if let Some(module) = ctx.sealed.missing_for_kind(&name) {
            issues.push(Issue::error(
                "module_missing",
                key,
                at("kind"),
                json!(text),
                &format!(
                    "kind `{text}` is evaluated by the {module} module, which this build lacks"
                ),
            ));
            return false;
        }
        // A document declares the canvas modules its kinds need (Document envelope), so a
        // build without the module has the name to refuse with.
        if let Some(module) = ctx.sealed.module_of_kind(&name) {
            if !ctx.declared.contains(module) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    at("kind"),
                    json!(text),
                    &format!(
                        "kind `{text}` is the `{module}` module's, and `requires.modules` does not name it"
                    ),
                ));
                return false;
            }
        }
    }
    // The kind decides the params alone: an item of a kind this build does not know, or knows
    // only at a lower major, still meets the item contract core defines (its keys, its id, its
    // layer and parent, its common fields), and is kept byte for byte, its params unread.
    let known = match lookup(ctx.kinds, &text) {
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
    if let Some(adjust) = fields.get("adjust") {
        check_adjust(key, adjust, issues);
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
        check_params(
            key,
            params,
            entry,
            version,
            required_minor,
            ctx.sealed,
            issues,
            notices,
        );
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

/// An item's `adjust`: its known channels, each a number in range (`tint` a look role, `invert` a
/// bool); opacity in 0..1, gamma above 0 and the rest that scale never below 0.
fn check_adjust(key: &str, adjust: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = as_object(adjust) else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/adjust"),
            adjust.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/adjust/{name}");
        if !ADJUST_FIELDS.contains(&name.as_str()) {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a channel of adjust",
            ));
            continue;
        }
        let (fits, what) = match name.as_str() {
            "invert" => (value.is_boolean(), "not a boolean"),
            "tint" => (value.is_string(), "not a look role"),
            "opacity" => (
                as_f64(value).is_some_and(|v| (0.0..=1.0).contains(&v)),
                "not a number in 0..1",
            ),
            "gamma" => (
                fits_f32(value) && as_f64(value).is_some_and(|v| v > 0.0),
                "not a number above 0",
            ),
            "hue" | "exposure" => (fits_f32(value), "not a number finite at f32"),
            _ => (
                fits_f32(value) && as_f64(value).is_some_and(|v| v >= 0.0),
                "not a number at or above 0",
            ),
        };
        if !fits {
            issues.push(Issue::error("out_of_range", key, path, value.clone(), what));
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

#[allow(clippy::too_many_arguments)]
fn check_params(
    key: &str,
    params: &mut Map<String, Value>,
    entry: &Entry,
    version: &Version,
    required_minor: Option<u32>,
    sealed: &Sealed,
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
            if let Some(missing) = sealed.missing_for(param.module, param.operator) {
                issues.push(Issue::error(
                    "module_missing",
                    key,
                    path,
                    value.clone(),
                    &lacks(name, param.module, &missing),
                ));
                continue;
            }
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
fn check_targets(
    doc: &Value,
    section: &str,
    with_source: bool,
    kinds: &crate::kinds::Registry,
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
) {
    let Some(entries) = member(doc, section).and_then(as_object) else {
        return;
    };
    // A channel has the fields of Channel and key, whose values the motion module reads; a bound
    // value has the fields of Bound value; nothing else.
    let allowed: &[&str] = if with_source {
        BOUND_VALUE_FIELDS
    } else {
        CHANNEL_FIELDS
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
                    if let Err(what) = resolve(doc, &path, kinds) {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            key,
                            target_path,
                            json!(text),
                            &what,
                        ));
                    } else if let Some((module, missing)) =
                        left_out_param(doc, &path, kinds, sealed)
                    {
                        // A channel or bound value drives the param, so the document uses the
                        // feature its evaluator reads, as a written value would.
                        issues.push(Issue::error(
                            "module_missing",
                            key,
                            target_path,
                            json!(text),
                            &lacks(&path.fields()[1], module, &missing),
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
            let refused = match member(entry, "source") {
                Some(Value::String(text)) => Handle::parse(text)
                    .err()
                    .map(|r| Issue::error("bad_handle", key, source_path, json!(text), &r.what)),
                other => Some(Issue::error(
                    "out_of_range",
                    key,
                    source_path,
                    other.cloned().unwrap_or(Value::Null),
                    "not a handle",
                )),
            };
            if let Some(mut issue) = refused {
                // The source is what the number on screen rests on, so its issue also names the
                // item, or the mark set's row, the value fills (picking's `<id>#<key>`).
                if let Some(path) = member(entry, "target")
                    .and_then(Value::as_str)
                    .and_then(|t| Path::parse(t).ok())
                    .filter(|p| p.section() == Section::Items)
                {
                    issue.ids.push(match path.sub() {
                        Some(sub) => format!("{}#{sub}", path.id().as_str()),
                        None => path.id().as_str().to_string(),
                    });
                }
                issues.push(issue);
            }
        }
    }
}

/// A channel's fields (Channel and key).
const CHANNEL_FIELDS: &[&str] = &[
    "target",
    "type",
    "space",
    "mode",
    "keys",
    "extrapolate",
    "modifiers",
    "range",
    "morph",
];

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

/// Why a param is not evaluated in this build: the module that evaluates it is the one the
/// build lacks, or its operator reads a missing optional dependency.
fn lacks(name: &str, module: &str, missing: &str) -> String {
    if module == missing {
        format!("`{name}` is evaluated by the {missing} module, which this build lacks")
    } else {
        format!("`{name}` reads the {missing} module, which this build lacks")
    }
}

/// A target param's evaluating module and the missing module that keeps its operator out of
/// this build, when the target is `items/<id>/params/<name>` of such a kind.
fn left_out_param(
    doc: &Value,
    path: &Path,
    kinds: &crate::kinds::Registry,
    sealed: &Sealed,
) -> Option<(&'static str, String)> {
    if path.section() != Section::Items {
        return None;
    }
    let [field, name] = path.fields() else {
        return None;
    };
    if field != "params" {
        return None;
    }
    let item = member(doc, "items").and_then(|m| member(m, path.id().as_str()))?;
    let Lookup::Known { entry, saved } = lookup(kinds, kind_text(item)?) else {
        return None;
    };
    let param = entry
        .version(saved)
        .unwrap_or(entry.current())
        .param(name)?;
    if param.module.is_empty() {
        return None;
    }
    sealed
        .missing_for(param.module, param.operator)
        .map(|missing| (param.module, missing))
}

/// Resolves a path against the (lowered) document: the item exists and each field step reaches
/// something. An item's fields resolve against its kind's schema; in this slice no kind gives
/// another section a schema, so a field step there must reach a value the document holds: a
/// key of an object or an index of a list.
pub(crate) fn resolve(
    doc: &Value,
    path: &Path,
    kinds: &crate::kinds::Registry,
) -> Result<(), String> {
    let id = path.id().as_str();
    let section = path.section().as_str();
    let Some(target) = member(doc, section).and_then(|m| member(m, id)) else {
        return Err(format!("{section}/{id} is not in the document"));
    };
    if let Some(sub) = path.sub() {
        // A mark set's row key is the one part this build names: `items/<set>#<key>/<column>`.
        let params = member(target, "params").and_then(as_object);
        return match (path.section(), path.fields(), params) {
            (Section::Items, [column], Some(params)) if params.contains_key("columns") => {
                super::rows::row_column(params, sub, column)
                    .map_err(|what| format!("`#{sub}` names no row of {section}/{id}: {what}"))
            }
            _ => Err(format!(
                "`#{sub}` names a part of {section}/{id}, and only a mark set's row key, \
                 followed by one of its columns, names a part in this build"
            )),
        };
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
            let known = match kind_text(target).map(|text| lookup(kinds, text)) {
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
        ["adjust", name] if ADJUST_FIELDS.contains(name) => Ok(()),
        [field] if ITEM_OWN_FIELDS.contains(field) => Ok(()),
        _ => unreachable(),
    }
}
