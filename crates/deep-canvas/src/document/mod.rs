//! The document layer (canvas primitives: What the kernel holds; What holds a document to its
//! rules): the check over a document, patches applied as a writer, and the document's canonical
//! shape for its revision hash.
//!
//! Documents stay `serde_json::Value`s (with `preserve_order`, so maps are ordered, never hashed)
//! read through small accessors; there is no struct model, so an unknown kind's item passes
//! through byte for byte and a field the check never reads is never touched.
//!
//! # Public API
//!
//! - [`check`]: migrations, then the check of the lowered form → [`CheckResult`].
//! - [`apply`]: patches as a writer, each all or nothing, checked after each → [`ApplyResult`].
//! - [`canonical`]: the canonical bytes and SHA-256 of a document; [`DocShape`] is the
//!   [`crate::canon::Shape`] the document declares.
//! - [`duration`]: a duration field's flicks, as the check reads `stale_after`.
//! - [`STATUS_ROLE`]: the prefix of the status roles only a status binding reaches.
//! - [`Issue`] and [`Notice`], as the check writes them.

mod apply;
mod check;
mod merge;
mod order;
mod requires;
mod rows;
mod rules;
mod shape;
mod transform;

use serde_json::{json, Map, Value};

pub use apply::{
    apply, apply_ops, rollback, store_migrations, touched, touched_in, writer_layer, ApplyResult,
    Patched, Refused, Writing,
};
pub use check::{
    check, check_in, check_with, duration, recheck, recheck_skipping_referrers, CheckResult,
};
pub use merge::{merge, Merged};
pub use order::key_between;
pub use requires::{derived_kinds, write_required_kinds};
pub use rules::STATUS_ROLE;
pub use shape::{canonical, canonical_in, extends_by_default, Canonical, DocShape};

/// The check kind every issue here is raised by.
pub const CHECK: &str = "document.validate";

/// The envelope keys the design lists (Document envelope). Any other key is `unknown_field`.
pub const ENVELOPE_KEYS: &[&str] = &[
    "format",
    "id",
    "profile",
    "title",
    "description",
    "seed",
    "transport",
    "size",
    "safe",
    "aspect",
    "look",
    "camera",
    "locale",
    "budget",
    "requires",
    "packs",
    "data",
    "assets",
    "layers",
    "items",
    "collections",
    "assemblies",
    "channels",
    "drivers",
    "constraints",
    "clips",
    "placements",
    "transitions",
    "shots",
    "markers",
    "controls",
    "inputs",
    "bound_values",
    "status_bindings",
    "variants",
    "card",
    "audit",
    "script",
    "record",
    "source",
    "worlds",
    "brief",
    "checks",
];

/// An item's keys (Item and kind), in this slice.
/// The maps keyed by ID besides `layers` and `items`: each defaults to empty, each key an ID.
pub const ID_MAPS: &[&str] = &[
    "collections",
    "assemblies",
    "channels",
    "drivers",
    "constraints",
    "clips",
    "placements",
    "transitions",
    "shots",
    "markers",
    "controls",
    "inputs",
    "bound_values",
    "status_bindings",
    "variants",
    "worlds",
];

pub const ITEM_KEYS: &[&str] = &[
    "id", "kind", "layer", "parent", "name", "role", "params", "at", "adjust", "visible",
    "pickable", "order",
];

/// The item fields a path or an op may reach besides `params` and `at`.
pub const ITEM_OWN_FIELDS: &[&str] = &[
    "id", "kind", "layer", "parent", "name", "role", "visible", "pickable", "order",
];

/// The item fields `unset` may remove (every one with a default).
pub const ITEM_OPTIONAL_FIELDS: &[&str] =
    &["parent", "role", "visible", "pickable", "at", "adjust"];

/// An item's color adjustments (Item and kind: adjust), each a channel; `invert` a bool one.
pub const ADJUST_FIELDS: &[&str] = &[
    "opacity",
    "tint",
    "hue",
    "saturation",
    "brightness",
    "contrast",
    "exposure",
    "gamma",
    "invert",
];

/// The `at` members that are vectors of three.
pub const AT_VECTORS: &[&str] = &["pos", "rot", "scale", "pivot"];

/// The most characters a description has.
pub const MAX_DESCRIPTION: usize = 400;

/// An issue the check raised: an error or a warning.
#[derive(Clone, Debug, PartialEq)]
pub struct Issue {
    pub code: &'static str,
    /// `error` or `warning`.
    pub severity: &'static str,
    pub ids: Vec<String>,
    pub path: String,
    pub actual: Value,
    pub what: String,
    pub fix: String,
    /// The forms a field takes; only on `bad_unit`.
    pub forms: Vec<String>,
    /// The fix as patch ops, where the code's fix is ops (the check catalog).
    pub fix_ops: Option<Vec<Value>>,
}

impl Issue {
    /// An error at `path` with one ID.
    pub fn error(code: &'static str, id: &str, path: String, actual: Value, what: &str) -> Issue {
        Issue {
            code,
            severity: "error",
            ids: vec![id.to_string()],
            path,
            actual,
            what: what.to_string(),
            fix: fix_for(code),
            forms: Vec::new(),
            fix_ops: None,
        }
    }

    /// An error at `path` with no ID (the envelope's).
    pub fn envelope(code: &'static str, path: String, actual: Value, what: &str) -> Issue {
        Issue {
            ids: Vec::new(),
            ..Issue::error(code, "", path, actual, what)
        }
    }

    pub fn to_json(&self) -> Value {
        let mut out = Map::new();
        out.insert("check".into(), json!(CHECK));
        out.insert("code".into(), json!(self.code));
        out.insert("severity".into(), json!(self.severity));
        out.insert("ids".into(), json!(self.ids));
        out.insert("path".into(), json!(self.path));
        out.insert("actual".into(), self.actual.clone());
        out.insert("what".into(), json!(self.what));
        out.insert("fix".into(), json!(self.fix));
        if self.code == "bad_unit" {
            out.insert("forms".into(), json!(self.forms));
        }
        if let Some(ops) = &self.fix_ops {
            out.insert("fix_ops".into(), json!(ops));
        }
        Value::Object(out)
    }
}

/// A notice the check recorded: a migration, a skipped kind or a skipped field.
#[derive(Clone, Debug, PartialEq)]
pub struct Notice {
    pub code: &'static str,
    pub ids: Vec<String>,
    pub path: String,
    pub actual: Value,
    pub what: String,
    /// On `migrated`: the kind (`family.name`) and the step's majors.
    pub migration: Option<(String, u32, u32)>,
}

impl Notice {
    pub fn to_json(&self) -> Value {
        let mut out = Map::new();
        out.insert("code".into(), json!(self.code));
        out.insert("severity".into(), json!("notice"));
        out.insert("ids".into(), json!(self.ids));
        out.insert("path".into(), json!(self.path));
        out.insert("actual".into(), self.actual.clone());
        out.insert("what".into(), json!(self.what));
        if let Some((kind, from, to)) = &self.migration {
            out.insert("kind".into(), json!(kind));
            out.insert("from".into(), json!(from));
            out.insert("to".into(), json!(to));
        }
        Value::Object(out)
    }
}

/// The core's codes in the check catalog, each with what it means; its fix is [`fix_for`]'s
/// (What holds a document to its rules: each code with its canvas module, meaning and fix).
pub const CORE_CODES: &[(&str, &str)] = &[
    (
        "unknown_field",
        "A field the kind or the envelope doesn't define at the document's minor.",
    ),
    (
        "unknown_kind",
        "An item of a kind no registry in this build holds.",
    ),
    (
        "kind_too_new",
        "An item saved at a major newer than this build knows.",
    ),
    (
        "module_missing",
        "The document needs a canvas module this build lacks.",
    ),
    (
        "out_of_range",
        "A value outside its type or range, or a required field absent.",
    ),
    (
        "ref_unresolved",
        "A reference to an ID, session or document that doesn't exist.",
    ),
    (
        "cycle",
        "An item that descends from itself through its parents.",
    ),
    (
        "not_your_layer",
        "A patch writes an item in another writer's layer.",
    ),
    (
        "stale_base",
        "Another writer changed what the patch touches since its base.",
    ),
    (
        "undo_conflict",
        "An undo by another writer, or over another writer's later change.",
    ),
    (
        "over_quota",
        "The writer's quota of patches, items or documents is spent.",
    ),
    (
        "too_large",
        "A message larger than the writer's quota lets it send.",
    ),
    ("bad_unit", "A literal in a unit the field doesn't take."),
    (
        "bad_path",
        "A path that isn't <section>/<id>[#<sub>]/<field>.",
    ),
    (
        "bad_handle",
        "A handle that isn't <scheme>:<id>[#<fragment>].",
    ),
    ("bad_id", "An ID outside the ID grammar."),
    (
        "bad_time",
        "A time that isn't a span the time grammar reads.",
    ),
    (
        "bound_typed_over",
        "A bound value's text typed over, where its reading shows.",
    ),
    (
        "number_unsourced",
        "A number in text with no reading or computation behind it.",
    ),
    (
        "status_color_unbound",
        "A status color painted with no status binding behind it.",
    ),
    (
        "over_budget",
        "The document's estimated frame CPU passes its budget.",
    ),
    (
        "record_view",
        "A patch to a view of the record, which is rebuilt, never patched.",
    ),
    (
        "migrated",
        "An item saved at an earlier major of its kind, migrated at load.",
    ),
];

/// The one-line fix each code carries.
pub fn fix_for(code: &str) -> String {
    match code {
        "unknown_field" => "Remove the field, or require the kind's minor that defines it.",
        "unknown_kind" => "Register the kind, or remove the item.",
        "kind_too_new" => "Save the item at a major this build knows.",
        "module_missing" => "Open the document in a build with the module, or remove the field.",
        "out_of_range" => "Give the field a value of its type inside its range.",
        "ref_unresolved" => "Name an ID the document holds, or remove the reference.",
        "cycle" => "Give the item a parent that does not descend from it.",
        "not_your_layer" => "Patch only items in your own layer.",
        "stale_base" => "Read the current revision and send the patch again on it.",
        "undo_conflict" => "Leave it: another writer changed what the undo would put back.",
        "over_quota" => "Send fewer patches a second, or coalesce them.",
        "bad_unit" => "Write the value as a number in the field's unit or as one of its forms.",
        "bad_path" => "Write the path as <section>/<id>[#<sub>]/<field>[/<field>...].",
        "bad_handle" => "Write the handle as <scheme>:<id>[#<fragment>].",
        "bad_id" => "Write the ID as 1 to 8 segments of [a-z0-9][a-z0-9_-]{0,47} joined by `.`.",
        "bad_time" => "Write the time as a span such as 2s or 120f.",
        "bound_typed_over" => "Leave a bound value's text empty; its reading shows there.",
        "number_unsourced" => {
            "Bind the number to a reading with a bound value, or compute it in the document."
        }
        "status_color_unbound" => {
            "Bind the paint slot to a verdict, run, ask or session with a status binding."
        }
        "over_budget" => "Make the items cheaper, or fewer, so the frame fits its CPU budget.",
        "record_view" => "Change the record, and the view is rebuilt from it.",
        "too_large" => "Send a smaller patch, or split it.",
        "migrated" => {
            "Nothing to do: the item's writer stores the migrated form on its next patch."
        }
        _ => "See the issue.",
    }
    .to_string()
}

/// Sorts issues errors first, then by code, first ID and path (stable), so the order never
/// depends on the order the document's keys were read in.
pub(crate) fn sort_issues(issues: &mut [Issue]) {
    issues.sort_by(|a, b| {
        let rank = |s: &str| if s == "error" { 0 } else { 1 };
        rank(a.severity)
            .cmp(&rank(b.severity))
            .then_with(|| a.code.cmp(b.code))
            .then_with(|| a.ids.first().cmp(&b.ids.first()))
            .then_with(|| a.path.cmp(&b.path))
    });
}

/// Sorts notices by code, first ID and path; the sort is stable, so one item's `migrated`
/// notices (one path) keep their step order.
pub(crate) fn sort_notices(notices: &mut [Notice]) {
    notices.sort_by(|a, b| {
        a.code
            .cmp(b.code)
            .then_with(|| a.ids.first().cmp(&b.ids.first()))
            .then_with(|| a.path.cmp(&b.path))
    });
}

/// The object member `key` of `value`, if `value` is an object holding it.
pub fn member<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|o| o.get(key))
}

/// The `family.name@major` text of an item, if it carries one.
pub(crate) fn kind_text(item: &Value) -> Option<&str> {
    member(item, "kind").and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The patch fuzzer's fifth law: after each seeded patch (a create, a set of a param in and out
    /// of range, a move under another item or under itself, a delete that leaves children
    /// behind), the incremental re-check gives the full check's issues, by code, IDs and path.
    #[test]
    fn the_incremental_recheck_gives_the_full_checks_issues() {
        let mut doc = base();
        for i in 0..12 {
            let parent = if i % 3 == 0 {
                Value::Null
            } else {
                json!(format!("s{}", i / 3 * 3))
            };
            doc["items"][format!("s{i}")] = json!({"id": format!("s{i}"), "kind": "test.slab@3",
                "layer": "main", "name": format!("S{i}"), "order": "a0", "parent": parent,
                "params": {"width": 2}});
        }
        let key = |is: &[Issue]| -> Vec<(String, Vec<String>, String)> {
            is.iter()
                .map(|i| (i.code.to_string(), i.ids.clone(), i.path.clone()))
                .collect()
        };
        let mut issues = check(&doc).issues;
        let mut seed: u64 = 96;
        let knows = |_: &str| true;
        for n in 0..300 {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let pick = |k: u64| format!("s{}", (seed >> (17 + k)) % 14);
            let op = match (seed >> 33) % 5 {
                0 => {
                    json!({"op": "set", "id": pick(1), "path": format!("items/{}/params/width", pick(1)), "value": if seed.is_multiple_of(7) { json!(-5) } else { json!(3) }})
                }
                1 => json!({"op": "move", "id": pick(1), "parent": pick(5)}),
                2 => json!({"op": "delete", "id": pick(1)}),
                3 => json!({"op": "move", "id": pick(1), "parent": null}),
                _ => {
                    json!({"op": "create", "item": {"id": pick(1), "kind": "test.slab@3", "name": "New", "order": "a1", "parent": pick(4), "params": {}}})
                }
            };
            let patch = json!({"patch": "01J9Z00000000000000000AC05", "doc": "doc-1", "base": 0, "reason": "law 5", "ops": [op]});
            let writing = Writing {
                layer: "main",
                writer: "agent-a",
                you: false,
                base: None,
                knows: &knows,
            };
            let was = doc.clone();
            let Ok(patched) = apply_ops(&mut doc, &patch, "patch", "doc-1", &writing) else {
                assert_eq!(
                    doc.to_string(),
                    was.to_string(),
                    "patch {n}: a refused op left a change"
                );
                continue;
            };
            let changed = patched.changed(&doc);
            let incremental =
                recheck(&doc, &issues, &changed, &crate::registry::core()).expect("items only");
            let full = check(&doc).issues;
            assert_eq!(key(&incremental), key(&full), "patch {n}: {op}");
            // Taken back out, the document is what it was, byte for byte.
            let mut back = doc.clone();
            rollback(&mut back, &patched);
            assert_eq!(
                back.to_string(),
                was.to_string(),
                "patch {n}: the rollback of {op}"
            );
            issues = full;
        }
        assert!(!issues.is_empty(), "the walk left some issue to compare");
    }

    /// One op as `agent-a`, applied through `apply_ops`, on `doc`.
    fn op_on(doc: &Value, op: Value) -> Result<Value, Refused> {
        let mut out = doc.clone();
        let patch = json!({"patch": "01J9Z00000000000000000AC96", "doc": "doc-1", "base": 0,
                           "reason": "ops", "ops": [op]});
        let knows = |_: &str| true;
        let writing = Writing {
            layer: "main",
            writer: "agent-a",
            you: false,
            base: None,
            knows: &knows,
        };
        apply_ops(&mut out, &patch, "patch", "doc-1", &writing).map(|_| out)
    }

    #[test]
    fn a_move_keeps_the_item_in_place_in_the_world_unless_told_local() {
        let mut doc = base();
        doc["items"] = json!({
            "a": {"id": "a", "kind": "test.slab@3", "layer": "main", "name": "A", "order": "a0", "params": {}, "at": {"pos": [40, 40, 0]}},
            "b": {"id": "b", "kind": "test.slab@3", "layer": "main", "name": "B", "order": "a1", "params": {}, "at": {"pos": [40, 200, 0]}},
            "c": {"id": "c", "kind": "test.slab@3", "layer": "main", "name": "C", "order": "a2", "params": {}, "parent": "a", "at": {"pos": [10, 0, 0]}},
        });
        let world = op_on(&doc, json!({"op": "move", "id": "c", "parent": "b"})).unwrap();
        // c sat at (50, 40) in the world; under b, at (40, 200), that is (10, -160).
        assert_eq!(world["items"]["c"]["at"]["pos"], json!([10.0, -160.0, 0.0]));
        assert_eq!(world["items"]["c"]["parent"], json!("b"));
        let local = op_on(
            &doc,
            json!({"op": "move", "id": "c", "parent": "b", "keep": "local"}),
        )
        .unwrap();
        assert_eq!(local["items"]["c"]["at"]["pos"], json!([10, 0, 0]));
        let root = op_on(&doc, json!({"op": "move", "id": "c", "parent": null})).unwrap();
        assert_eq!(root["items"]["c"]["at"]["pos"], json!([50.0, 40.0, 0.0]));
    }

    #[test]
    fn rows_ops_edit_a_mark_set_by_key_and_a_view_of_the_record_is_never_patched() {
        let mut doc = base();
        doc["items"]["set"] = json!({"id": "set", "kind": "marks@1", "layer": "main", "name": "S", "order": "a0",
            "params": {"mark": "point", "n": 1, "key": "k", "columns": {
                "k": {"dtype": "str", "len": 1, "data": ["a"]},
                "v": {"dtype": "u8", "len": 1, "data": "Bw=="}}}});
        let out = op_on(
            &doc,
            json!({"op": "rows", "id": "set", "append": [{"k": "b", "v": 9}]}),
        )
        .unwrap();
        assert_eq!(out["items"]["set"]["params"]["n"], json!(2));
        assert_eq!(
            out["items"]["set"]["params"]["columns"]["v"]["data"],
            json!("Bwk=")
        );
        let refused = op_on(&doc, json!({"op": "rows", "id": "set", "remove": ["z"]})).unwrap_err();
        assert_eq!(refused.code, "ref_unresolved");
        let mut view = doc.clone();
        view["source"] = json!({"projections": ["tasks"]});
        let refused =
            op_on(&view, json!({"op": "rows", "id": "set", "remove": ["a"]})).unwrap_err();
        assert_eq!(
            (refused.code, refused.path.as_str()),
            ("record_view", "source")
        );
    }

    #[test]
    fn a_coalesce_key_is_a_string_and_no_other_patch_field_is_read() {
        let mut out = base();
        let knows = |_: &str| true;
        let writing = Writing {
            layer: "main",
            writer: "agent-a",
            you: false,
            base: None,
            knows: &knows,
        };
        let patch = |extra: Value| {
            let mut p = json!({"patch": "01J9Z00000000000000000AC96", "doc": "doc-1", "base": 0, "reason": "r", "ops": []});
            for (k, v) in extra.as_object().unwrap() {
                p[k] = v.clone();
            }
            p
        };
        assert!(apply_ops(
            &mut out,
            &patch(json!({"coalesce_key": "drag"})),
            "patch",
            "doc-1",
            &writing
        )
        .is_ok());
        let bad = apply_ops(
            &mut out,
            &patch(json!({"coalesce_key": 3})),
            "patch",
            "doc-1",
            &writing,
        )
        .unwrap_err();
        assert_eq!(bad.code, "out_of_range");
        let unknown = apply_ops(
            &mut out,
            &patch(json!({"preview": true})),
            "patch",
            "doc-1",
            &writing,
        )
        .unwrap_err();
        assert_eq!(unknown.code, "unknown_field");
    }

    /// The smallest document the check passes: every required envelope field, one layer, no item.
    fn base() -> Value {
        json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [10, 10],
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {}
        })
    }

    #[test]
    fn an_empty_document_fails_naming_each_required_field() {
        let result = check(&json!({}));
        assert!(!result.ok);
        let mut paths: Vec<&str> = result
            .issues
            .iter()
            .filter(|i| i.code == "out_of_range")
            .map(|i| i.path.as_str())
            .collect();
        paths.sort_unstable();
        assert_eq!(
            paths,
            [
                "description",
                "format",
                "id",
                "items",
                "layers",
                "profile",
                "size",
                "title"
            ]
        );
        assert!(check(&base()).ok);
    }

    #[test]
    fn layers_and_items_are_required_maps_that_may_be_empty() {
        // Both are written in every canonical form (shape: no default), so a document without
        // one differs in bytes and hash from one with it empty; the check refuses the absence.
        for key in ["layers", "items"] {
            let mut doc = base();
            doc.as_object_mut().unwrap().remove(key);
            let result = check(&doc);
            assert!(!result.ok, "{key} absent");
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == "out_of_range" && i.path == key),
                "{key}: {:?}",
                result.issues
            );
        }
        let mut doc = base();
        doc["layers"] = json!({});
        doc["items"] = json!({});
        assert!(check(&doc).ok);
    }

    #[test]
    fn a_camera_field_of_a_module_this_build_lacks_is_module_missing_and_a_core_one_is_kept() {
        let mut doc = base();
        doc["items"]["cam"] = json!({
            "id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
            "params": {"fit": {"keep": ["cam"]}, "dof": {"f_stop": 2.8}}
        });
        let result = check(&doc);
        let codes: Vec<(&str, &str)> = result
            .issues
            .iter()
            .map(|i| (i.code, i.path.as_str()))
            .collect();
        assert_eq!(codes, [("module_missing", "items/cam/params/dof")]);
        doc["items"]["cam"]["params"] = json!({"fit": {"keep": ["cam"]}, "dof": null});
        assert!(check(&doc).ok);
    }

    #[test]
    fn apply_hashes_what_it_applies_and_refuses_a_result_missing_required_fields() {
        let out = apply(&base(), "agent-a", &[]);
        assert_eq!(out.outcome, "applied");
        assert_eq!(out.hash.len(), 64);
        let out = apply(
            &json!({"id": "doc-1", "layers": base()["layers"]}),
            "agent-a",
            &[patch(json!([]))],
        );
        assert_eq!(out.outcome, "refused");
        assert!(out.issues.iter().any(|i| i.path == "profile"));
    }

    /// A well-formed patch envelope around `ops`, for `base()`.
    fn patch(ops: Value) -> Value {
        json!({"patch": "01J9Z000000000000000000001", "doc": "doc-1", "base": 0, "reason": "test", "ops": ops})
    }

    #[test]
    fn apply_refuses_a_patch_envelope_that_is_malformed_before_any_op_runs() {
        let refused_at = |p: Value| {
            let out = apply(&base(), "agent-a", &[p]);
            assert_eq!(out.outcome, "refused");
            assert_eq!(out.issues.len(), 1);
            (out.issues[0].code, out.issues[0].path.clone())
        };
        assert_eq!(
            refused_at(json!({"ops": []})),
            ("out_of_range", "patches/0/patch".to_string())
        );
        let mut p = patch(json!([]));
        p["patch"] = json!("not-a-ulid");
        assert_eq!(refused_at(p), ("bad_id", "patches/0/patch".to_string()));
        let mut p = patch(json!([]));
        p["doc"] = json!("doc-2");
        assert_eq!(
            refused_at(p),
            ("ref_unresolved", "patches/0/doc".to_string())
        );
        let mut p = patch(json!([]));
        p["base"] = json!(-1);
        assert_eq!(
            refused_at(p),
            ("out_of_range", "patches/0/base".to_string())
        );
        let mut p = patch(json!([]));
        p["reason"] = json!(7);
        assert_eq!(
            refused_at(p),
            ("out_of_range", "patches/0/reason".to_string())
        );
        let mut p = patch(json!([]));
        p["lease"] = json!("x");
        assert_eq!(
            refused_at(p),
            ("unknown_field", "patches/0/lease".to_string())
        );
        assert_eq!(
            refused_at(json!([])),
            ("out_of_range", "patches/0".to_string())
        );
        // The well-formed envelope applies, and the refusals changed nothing.
        let out = apply(&base(), "agent-a", &[patch(json!([]))]);
        assert_eq!(out.outcome, "applied");
        assert_eq!(out.doc, base());
    }

    #[test]
    fn apply_refuses_an_op_with_a_field_its_op_does_not_have_or_a_cascade_that_is_not_a_bool() {
        let item =
            json!({"id": "a", "kind": "test.slab@3", "name": "A", "order": "a0", "params": {}});
        let refused_at = |op: Value| {
            let out = apply(&base(), "agent-a", &[patch(json!([op]))]);
            assert_eq!(out.outcome, "refused");
            assert_eq!(out.doc, base());
            (out.issues[0].code, out.issues[0].path.clone())
        };
        assert_eq!(
            refused_at(json!({"op": "create", "item": item, "lease": "x"})),
            ("unknown_field", "ops/0/lease".to_string())
        );
        assert_eq!(
            refused_at(json!({"op": "set", "id": "a", "path": "items/a/params/width"})),
            ("out_of_range", "ops/0/value".to_string())
        );
        assert_eq!(
            refused_at(json!({"op": "delete", "id": "a", "cascade": "yes"})),
            ("out_of_range", "ops/0/cascade".to_string())
        );
        assert_eq!(
            refused_at(json!({"op": "break_out", "id": "a"})),
            ("unknown_field", "ops/0/op".to_string())
        );
        assert_eq!(
            refused_at(json!({"op": "move", "id": "a"})),
            ("out_of_range", "ops/0/parent".to_string())
        );
        assert_eq!(
            refused_at(json!({"op": "reorder", "id": "a"})),
            ("out_of_range", "ops/0/after".to_string())
        );
        assert_eq!(refused_at(json!(7)), ("out_of_range", "ops/0".to_string()));
        let out = apply(
            &base(),
            "agent-a",
            &[patch(json!([{"op": "create", "item": item}]))],
        );
        assert_eq!(out.outcome, "applied", "{:?}", out.issues);
    }

    #[test]
    fn a_key_outside_the_id_grammar_is_bad_id_in_every_map_keyed_by_id() {
        let mut doc = base();
        doc["layers"]["bad/layer"] = json!({"writer": "agent-b", "title": "B", "order": "a1"});
        doc["channels"] = json!({"Bad Key": {"target": "items/a/params/width"}});
        doc["bound_values"] = json!({"x/y": {"target": "items/a/params/width", "source": "task:01J9Z000000000000000000001"}});
        // Every other map keyed by ID too, whatever it holds, and each must be an object.
        doc["collections"] = json!({"BAD": {}});
        doc["markers"] = json!({"x y": {}});
        doc["worlds"] = json!({"W": {}});
        doc["controls"] = json!(7);
        let result = check(&doc);
        assert!(!result.ok);
        let mut bad: Vec<&str> = result
            .issues
            .iter()
            .filter(|i| i.code == "bad_id")
            .map(|i| i.path.as_str())
            .collect();
        bad.sort_unstable();
        assert_eq!(
            bad,
            [
                "bound_values/x/y",
                "channels/Bad Key",
                "collections/BAD",
                "layers/bad/layer",
                "markers/x y",
                "worlds/W"
            ]
        );
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "out_of_range" && i.path == "controls"),
            "{:?}",
            result.issues
        );
    }

    #[test]
    fn two_layers_with_one_writer_are_refused_whichever_comes_first() {
        let layer = |title: &str| json!({"writer": "agent-a", "title": title, "order": "a0"});
        let mut ab = base();
        ab["layers"] = json!({"a": layer("A"), "b": layer("B")});
        let mut ba = base();
        ba["layers"] = json!({"b": layer("B"), "a": layer("A")});
        for doc in [&ab, &ba] {
            let result = check(doc);
            assert!(!result.ok);
            let dup = result
                .issues
                .iter()
                .find(|i| i.path == "layers/b/writer")
                .expect("the second layer by ID carries the issue");
            assert_eq!(dup.code, "out_of_range");
            let out = apply(doc, "agent-a", &[patch(json!([]))]);
            assert_eq!(out.outcome, "refused");
            assert_eq!(out.issues[0].path, "layers/b/writer");
        }
        // Even with no patch to check, apply can't say which layer the writer's is.
        let (none_ab, none_ba) = (apply(&ab, "agent-a", &[]), apply(&ba, "agent-a", &[]));
        assert_eq!(none_ab.outcome, "refused");
        assert_eq!(none_ab.to_json(), none_ba.to_json());
    }

    #[test]
    fn apply_refuses_a_document_with_no_canonical_form_instead_of_an_empty_hash() {
        let mut doc = base();
        // Two `data` keys that are one key after NFC: precomposed and decomposed `é`.
        doc["data"] = json!({"\u{e9}": 1, "e\u{301}": 2});
        let out = apply(&doc, "agent-a", &[]);
        assert_eq!(out.outcome, "refused");
        assert_eq!(out.issues.len(), 1);
        assert_eq!(out.issues[0].code, "out_of_range");
        assert_eq!(out.issues[0].path, "data/\u{e9}");
        assert!(out.issues[0].what.contains("NFC"));
    }

    /// An item in `layer` with `parent`, in the fixture shape.
    fn item(id: &str, layer: &str, parent: Value) -> Value {
        json!({
            "id": id, "kind": "test.slab@3", "layer": layer, "name": id, "role": "part",
            "order": "a0", "parent": parent, "visible": true, "pickable": true, "params": {},
            "at": {"pos": [0, 0, 0], "rot": [0, 0, 0], "scale": [1, 1, 1]}
        })
    }

    #[test]
    fn a_patch_stores_the_migration_of_its_writers_items_and_keeps_other_writers_as_saved() {
        // Migration runs at load; the stored document changes only when its writer next patches
        // it (canvas primitives: Migration), and another writer's items stay byte for byte.
        let mut doc = base();
        doc["layers"]["other"] = json!({"writer": "agent-b", "title": "Other", "order": "a1"});
        doc["items"] =
            json!({"p": item("p", "main", Value::Null), "q": item("q", "other", Value::Null)});
        for id in ["p", "q"] {
            doc["items"][id]["kind"] = json!("test.slab@1");
            doc["items"][id]["params"] = json!({"w": 20, "h": 7});
        }
        let out = apply(
            &doc,
            "agent-a",
            &[patch(
                json!([{"op": "set", "id": "p", "path": "items/p/name", "value": "P"}]),
            )],
        );
        assert_eq!(out.outcome, "applied", "{:?}", out.issues);
        assert_eq!(out.doc["items"]["p"]["kind"], json!("test.slab@3"));
        assert_eq!(
            out.doc["items"]["p"]["params"],
            json!({"width": 20, "height": 7})
        );
        assert_eq!(out.doc["items"]["q"], doc["items"]["q"]);
        // The hash is of what comes out, and a fresh check finds nothing left to migrate for p.
        assert_eq!(out.hash, apply(&out.doc, "agent-a", &[]).hash);
        let checked = check(&out.doc);
        let migrated: Vec<&Notice> = checked
            .notices
            .iter()
            .filter(|n| n.code == "migrated")
            .collect();
        assert!(migrated.iter().all(|n| n.ids == ["q"]), "{migrated:?}");
        assert_eq!(migrated.len(), 2);
    }

    #[test]
    fn a_cascade_stops_at_another_writers_layer_and_changes_nothing() {
        let mut doc = base();
        doc["layers"]["other"] = json!({"writer": "agent-b", "title": "Other", "order": "a1"});
        doc["items"] = json!({
            "p": item("p", "main", Value::Null),
            "c": item("c", "other", json!("p")),
        });
        assert!(check(&doc).ok);
        let out = apply(
            &doc,
            "agent-a",
            &[patch(json!([{"op": "delete", "id": "p", "cascade": true}]))],
        );
        assert_eq!(out.outcome, "refused");
        assert_eq!(out.issues.len(), 1);
        assert_eq!(out.issues[0].code, "not_your_layer");
        assert_eq!(out.issues[0].ids, ["c"]);
        assert_eq!(out.issues[0].path, "items/c/layer");
        assert_eq!(out.doc, doc);
    }

    #[test]
    fn a_required_minor_applies_only_to_its_own_major() {
        let mut doc = base();
        doc["items"] = json!({"p": item("p", "main", Value::Null)});
        doc["items"]["p"]["params"] = json!({"extra": 1});
        // Major 1 at a newer minor says nothing about a major-3 item: `extra` is an error.
        doc["requires"] = json!({"kinds": ["test.slab@1.9"]});
        let result = check(&doc);
        assert!(!result.ok);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].code, "unknown_field");
        assert_eq!(result.issues[0].path, "items/p/params/extra");
        // The same minor at the item's own major skips the field with a notice.
        doc["requires"] = json!({"kinds": ["test.slab@3.9"]});
        let result = check(&doc);
        assert!(result.ok);
        assert_eq!(result.notices.len(), 1);
        assert_eq!(result.notices[0].code, "unknown_field");
    }

    #[test]
    fn a_sub_address_resolves_to_nothing_in_this_build() {
        let mut doc = base();
        doc["items"] = json!({"p": item("p", "main", Value::Null)});
        let out = apply(
            &doc,
            "agent-a",
            &[patch(
                json!([{"op": "set", "id": "p", "path": "items/p#42/params/width", "value": 1}]),
            )],
        );
        assert_eq!(out.outcome, "refused");
        assert_eq!(out.issues.len(), 1);
        assert_eq!(out.issues[0].code, "ref_unresolved");
        assert_eq!(out.issues[0].ids, ["p"]);
        assert!(out.issues[0].what.contains("#42"), "{}", out.issues[0].what);
        assert_eq!(out.doc, doc);
        doc["channels"] = json!({"grow": {"target": "items/p#42/params/width"}});
        let result = check(&doc);
        assert!(!result.ok);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].code, "ref_unresolved");
        assert_eq!(result.issues[0].path, "channels/grow/target");
    }

    #[test]
    fn a_channel_or_bound_value_holds_exactly_its_declared_fields() {
        // A channel is `{target}` and a bound value `{target, source}`; any other key is
        // `unknown_field` at the key, and an entry that isn't an object is `out_of_range`.
        let mut doc = base();
        doc["items"] = json!({"p": item("p", "main", Value::Null)});
        let codes = |doc: &Value, path: &str| -> Vec<&'static str> {
            check(doc)
                .issues
                .iter()
                .filter(|i| i.path == path)
                .map(|i| i.code)
                .collect()
        };
        doc["channels"] = json!({"c": {"target": "items/p/params/width", "gain": 1}});
        assert_eq!(codes(&doc, "channels/c/gain"), ["unknown_field"]);
        doc["channels"] = json!({"c": {"target": "items/p/params/width", "source": "task:01J9Z000000000000000000001"}});
        assert_eq!(codes(&doc, "channels/c/source"), ["unknown_field"]);
        doc["channels"] = json!({"c": "items/p/params/width"});
        assert_eq!(codes(&doc, "channels/c"), ["out_of_range"]);
        doc["channels"] = json!({"c": {"target": "items/p/params/width"}});
        doc["bound_values"] = json!({"b": {"target": "items/p/params/width", "source": "task:01J9Z000000000000000000001", "extra": true}});
        assert_eq!(codes(&doc, "bound_values/b/extra"), ["unknown_field"]);
        doc["bound_values"]["b"] =
            json!({"target": "items/p/params/width", "source": "task:01J9Z000000000000000000001"});
        assert!(check(&doc).ok, "{:?}", check(&doc).issues);
    }

    #[test]
    fn requires_is_a_closed_object_of_core_kinds_modules_and_preview() {
        // canvas primitives: `requires: {core: semver, kinds: [family.name@major.minor],
        // modules: {canvas module → semver range}, preview: [name@major]}`.
        let issue = |doc: &Value, code: &str, path: &str| {
            let result = check(doc);
            assert!(!result.ok, "{path}");
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == code && i.path == path),
                "{path}: {:?}",
                result.issues
            );
        };
        let with = |requires: Value| {
            let mut doc = base();
            doc["requires"] = requires;
            doc
        };
        issue(&with(json!(7)), "out_of_range", "requires");
        issue(
            &with(json!({"kinds": [], "extra": 1})),
            "unknown_field",
            "requires/extra",
        );
        issue(&with(json!({"core": 1})), "out_of_range", "requires/core");
        issue(
            &with(json!({"modules": []})),
            "out_of_range",
            "requires/modules",
        );
        issue(
            &with(json!({"modules": {"grid": 1}})),
            "out_of_range",
            "requires/modules/grid",
        );
        issue(
            &with(json!({"preview": "x@1"})),
            "out_of_range",
            "requires/preview",
        );
        issue(
            &with(json!({"preview": [1]})),
            "out_of_range",
            "requires/preview/0",
        );
        // A required kind's name follows the kind grammar too; a well-formed one this build lacks
        // is fine, since it binds only its own kind's items.
        issue(
            &with(json!({"kinds": ["bad name.x@1.0"]})),
            "out_of_range",
            "requires/kinds/0",
        );
        issue(
            &with(json!({"kinds": ["a..b@1.0"]})),
            "out_of_range",
            "requires/kinds/0",
        );
        assert!(check(&with(json!({"kinds": ["other.kind@7.2"]}))).ok);
        // The core's own modules (text, and R1's marks2d) are held by every build.
        assert!(check(&with(json!({"modules": {"text": "^1", "marks2d": "^1"}}))).ok);
        let full = with(json!({
            "core": "1.2.3",
            "kinds": ["test.slab@3.1"],
            "modules": {},
            "preview": ["fluid@1"]
        }));
        assert!(check(&full).ok, "{:?}", check(&full).issues);
        // A required canvas module this build lacks refuses the document, naming it (#305:
        // Registry and seal), where #389's slice only read the range's type.
        issue(
            &with(json!({"modules": {"grid": "^1"}})),
            "module_missing",
            "requires/modules/grid",
        );
        issue(
            &with(json!({"modules": {"grid": 1}})),
            "out_of_range",
            "requires/modules/grid",
        );
    }

    #[test]
    fn an_item_of_an_unknown_kind_still_meets_the_common_item_contract() {
        // Its params stay opaque and the item is kept byte for byte, but `id`, `layer`, the
        // closed item keys and the references are core's, whatever the kind.
        let mut doc = base();
        doc["items"]["bad"] = json!({"kind": "test.cube@1", "surprise": true, "layer": "nowhere"});
        let result = check(&doc);
        assert!(!result.ok);
        let has = |code: &str, path: &str| {
            result
                .issues
                .iter()
                .any(|i| i.code == code && i.path == path && i.ids == ["bad"])
        };
        assert!(
            has("unknown_field", "items/bad/surprise"),
            "{:?}",
            result.issues
        );
        assert!(has("bad_id", "items/bad/id"), "{:?}", result.issues);
        assert!(
            has("ref_unresolved", "items/bad/layer"),
            "{:?}",
            result.issues
        );
        assert!(result.notices.iter().any(|n| n.code == "unknown_kind"));
        // Well formed, it passes with the notice alone and is not drawn.
        let mut doc = base();
        doc["items"]["cube"] = json!({
            "id": "cube", "kind": "test.cube@1", "layer": "main", "name": "Cube", "order": "a0",
            "params": {"side": 2}
        });
        let result = check(&doc);
        assert!(result.ok, "{:?}", result.issues);
        assert_eq!(result.notices.len(), 1);
        assert!(!result.draws.contains(&"cube".to_string()));
        // `params` is always written (even `{}`), whatever the kind: absent or not an object is
        // out of range before the kind decides what its members mean.
        for params in [None, Some(json!(7))] {
            let mut doc = base();
            doc["items"]["cube"] = json!({
                "id": "cube", "kind": "test.cube@1", "layer": "main", "name": "Cube", "order": "a0"
            });
            if let Some(params) = params {
                doc["items"]["cube"]["params"] = params;
            }
            let result = check(&doc);
            assert!(!result.ok, "params absent or not an object");
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == "out_of_range" && i.path == "items/cube/params"),
                "{:?}",
                result.issues
            );
        }
    }

    #[test]
    fn a_number_past_its_f32_width_is_out_of_range_in_the_check_not_only_in_the_hash() {
        // `size`, the `at` vectors, `shear` and an f32 param are f32 fields; 1e300 is a finite
        // f64 that overflows them, which the canonical form refuses, so the check must too, or a
        // document would pass with no revision hash.
        let slab = |params: Value| {
            json!({
                "id": "slab", "kind": "test.slab@3", "layer": "main", "name": "Slab",
                "order": "a0", "params": params
            })
        };
        let mut doc = base();
        doc["size"] = json!([1e300, 480]);
        doc["items"]["slab"] = slab(json!({"width": 20}));
        doc["items"]["slab"]["at"] = json!({"pos": [0, 1e300, 0], "shear": -1e300});
        let result = check(&doc);
        assert!(!result.ok);
        for path in ["size", "items/slab/at/pos", "items/slab/at/shear"] {
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == "out_of_range" && i.path == path),
                "{path}: {:?}",
                result.issues
            );
        }
        let mut doc = base();
        doc["items"]["slab"] = slab(json!({"width": 1e300}));
        let result = check(&doc);
        assert!(!result.ok);
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "out_of_range" && i.path == "items/slab/params/width"),
            "{:?}",
            result.issues
        );
        // The largest f32 is in range (the param by its own bounds), and the document hashes.
        let mut doc = base();
        doc["size"] = json!([3.4e38, 480]);
        doc["items"]["slab"] = slab(json!({"width": 1000}));
        let result = check(&doc);
        assert!(result.ok, "{:?}", result.issues);
        assert_eq!(apply(&doc, "agent-a", &[]).outcome, "applied");
    }

    #[test]
    fn kind_text_outside_the_grammar_is_out_of_range_not_an_unknown_kind() {
        // An unknown kind is `family.name@major` this build has not registered, kept for the
        // build that has; text that is not a kind at all is refused at the field, with no notice.
        for text in [
            "slab",
            "test.slab",
            "test.slab@01",
            "test.slab@1.2",
            "@1",
            "test.slab@",
            "bad family.name@1",
            "bad/name.x@1",
            ".name@1",
            "family.@1",
            "a..b@1",
            "a.b.@1",
            "a.B@1",
            "a.b@1 ",
        ] {
            let mut doc = base();
            doc["items"]["x"] = json!({
                "id": "x", "kind": text, "layer": "main", "name": "X", "order": "a0", "params": {}
            });
            let result = check(&doc);
            assert!(!result.ok, "{text}");
            assert!(
                result.issues.iter().any(|i| i.code == "out_of_range"
                    && i.path == "items/x/kind"
                    && i.ids == ["x"]),
                "{text}: {:?}",
                result.issues
            );
            assert!(result.notices.is_empty(), "{text}: {:?}", result.notices);
        }
    }

    #[test]
    fn the_document_id_follows_the_one_id_grammar() {
        // `id: ID` in the envelope: the same grammar as every key, refused with bad_id at `id`.
        for id in ["BAD/ID", "Doc", "a..b", "", "doc 1", "doc#1", "-doc"] {
            let mut doc = base();
            doc["id"] = json!(id);
            let result = check(&doc);
            assert!(!result.ok, "{id:?}");
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == "bad_id" && i.path == "id"),
                "{id:?}: {:?}",
                result.issues
            );
        }
        let mut doc = base();
        doc["id"] = json!("doc-1.v2_a");
        assert!(check(&doc).ok);
    }

    #[test]
    fn a_layers_role_and_locked_are_typed_and_closed() {
        // `role: content | annotation = content`, `locked: bool = false` (canvas primitives: Layer).
        for (field, value) in [
            ("role", json!(false)),
            ("role", json!("decoration")),
            ("locked", json!({})),
            ("locked", json!("true")),
        ] {
            let mut doc = base();
            doc["layers"]["main"][field] = value.clone();
            let result = check(&doc);
            assert!(!result.ok, "{field}: {value}");
            let path = format!("layers/main/{field}");
            assert!(
                result
                    .issues
                    .iter()
                    .any(|i| i.code == "out_of_range" && i.path == path),
                "{field}: {:?}",
                result.issues
            );
        }
        let mut doc = base();
        doc["layers"]["main"]["role"] = json!("annotation");
        doc["layers"]["main"]["locked"] = json!(true);
        assert!(check(&doc).ok, "{:?}", check(&doc).issues);
    }

    #[test]
    fn a_profile_outside_the_closed_set_is_refused() {
        // canvas primitives: `profile: figure | film | scene | world | view | board | sheet |
        // chart | cells`; the shape's default aspect is chosen by it, so a typo must not pass.
        for profile in [
            "figure", "film", "scene", "world", "view", "board", "sheet", "chart", "cells",
        ] {
            let mut doc = base();
            doc["profile"] = json!(profile);
            assert!(check(&doc).ok, "{profile}");
        }
        let mut doc = base();
        doc["profile"] = json!("typo");
        let result = check(&doc);
        assert!(!result.ok);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].code, "out_of_range");
        assert_eq!(result.issues[0].path, "profile");
    }

    #[test]
    fn a_path_into_another_section_resolves_only_where_a_value_is() {
        // No kind in this build gives `controls` a schema, so a field step there must reach a
        // value in the document itself: a key of an object or an index of a list.
        let mut doc = base();
        doc["controls"] = json!({"slider": {"value": 1, "range": [0, 10]}});
        let refused = |target: &str| {
            let mut doc = doc.clone();
            doc["channels"] = json!({"c": {"target": target}});
            let result = check(&doc);
            result
                .issues
                .iter()
                .find(|i| i.path == "channels/c/target")
                .map(|i| i.code)
        };
        for target in ["controls/slider/value", "controls/slider/range/1"] {
            assert_eq!(refused(target), None, "{target}");
        }
        for target in [
            "controls/slider/nonexistent",
            "controls/slider/value/deeper",
            "controls/slider/range/5",
            "controls/slider/range/x",
        ] {
            assert_eq!(refused(target), Some("ref_unresolved"), "{target}");
        }
    }

    #[test]
    fn issues_and_notices_sort_the_same_whatever_order_they_were_found_in() {
        let issue = |path: &str| Issue::error("out_of_range", "x", path.into(), Value::Null, "w");
        let mut forward = vec![issue("items/x/a"), issue("items/x/b")];
        let mut backward = vec![issue("items/x/b"), issue("items/x/a")];
        sort_issues(&mut forward);
        sort_issues(&mut backward);
        let paths = |v: &[Issue]| v.iter().map(|i| i.path.clone()).collect::<Vec<_>>();
        assert_eq!(paths(&forward), paths(&backward));
        let notice = |path: &str| Notice {
            code: "unknown_kind",
            ids: vec!["x".into()],
            path: path.into(),
            actual: Value::Null,
            what: String::new(),
            migration: None,
        };
        let mut forward = vec![notice("items/x/a"), notice("items/x/b")];
        let mut backward = vec![notice("items/x/b"), notice("items/x/a")];
        sort_notices(&mut forward);
        sort_notices(&mut backward);
        let paths = |v: &[Notice]| v.iter().map(|n| n.path.clone()).collect::<Vec<_>>();
        assert_eq!(paths(&forward), paths(&backward));
    }
}
