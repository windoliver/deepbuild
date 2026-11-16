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
mod close;
pub mod expands;
mod merge;
mod order;
pub mod pack_kinds;
pub mod packs;
pub mod patch_schema;
mod reads;
mod requires;
mod rows;
mod rules;
mod shape;
mod transform;
pub mod variants;

use serde_json::{json, Map, Value};

pub use apply::{
    apply, apply_ops, rollback, store_migrations, touched, touched_in, writer_layer, ApplyResult,
    Patched, Refused, Writing,
};
pub use check::{
    check, check_costed, check_in, check_packed, check_with, duration, frame_of, frame_rate_of,
    literal_forms, recheck, recheck_skipping_referrers, recheck_with, CheckResult, Referrers,
};
pub use close::{field_names, kind_names, owners, undeclared};
pub use merge::{merge, Merged};
pub use order::key_between;
pub use packs::{Expansion, Pack, PackId, Packs, Planted as PackPlanted};
pub use requires::{derived_kinds, write_required_kinds};
pub use rules::{shown_inside, story_issues, STATUS_ROLE};
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
    "light_policy",
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
    "time_remaps",
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
    // #427: the media module's strips and the voices placed on items (Strip and track, Emitter).
    "strips",
    "emitters",
    // #499: the media module's buses and processors (Bus, Processor).
    "buses",
    "processors",
    // #544: the media module's spawns (Spawn), which may read a logic item's occurrences.
    "spawns",
    // #502: the media module's ducking entries (Ducking), each a bus's gain under speech spans.
    "ducking",
    // #503: the media module's bakes (Analysis bake), each baked at check into its array.
    "bakes",
    "tempo_map",
    // #935: the media module's generated sounds, each held to audio.gen before an item names it.
    "sounds",
    // #903: the input module's tour (Tour), its keys and its pointer.
    "tour",
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
    "time_remaps",
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
    "id",
    "kind",
    "layer",
    "parent",
    "name",
    "role",
    "params",
    "at",
    "adjust",
    "visible",
    "pickable",
    "order",
    "broken_out",
    // A solid's modifier stack (Modifier; #411), checked by the canvas module whose kind it is.
    "modifiers",
    // An object's fields (Object; #420): its materials, constraints, shadows, level of detail,
    // and in a figure its tone, halo and relations.
    "materials",
    "material",
    "constraints",
    "cast_shadow",
    "receive_shadow",
    "lod",
    "tone",
    "halo",
    "relations",
];

/// The item fields a path or an op may reach besides `params` and `at`.
pub const ITEM_OWN_FIELDS: &[&str] = &[
    "id",
    "kind",
    "layer",
    "parent",
    "name",
    "role",
    "visible",
    "pickable",
    "order",
    "broken_out",
    "material",
    "cast_shadow",
    "receive_shadow",
    "tone",
    "halo",
];

/// The item fields `unset` may remove (every one with a default).
pub const ITEM_OPTIONAL_FIELDS: &[&str] = &[
    "parent",
    "role",
    "visible",
    "pickable",
    "at",
    "adjust",
    "broken_out",
];

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

/// The `at` members that place an item by relation (Item and kind: relations).
pub const AT_RELATIONS: &[&str] = &["place", "align"];

/// The nine box points every 2D item has, read-only (closed: determinism).
pub const BOX_POINTS: &[&str] = &["n", "ne", "e", "se", "s", "sw", "w", "nw", "c"];

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
    /// The forms a field takes: on `bad_unit`, and on a structured value no form takes (#1973).
    pub forms: Vec<String>,
    /// The fix as patch ops, where the code's fix is ops (the check catalog).
    pub fix_ops: Option<Vec<Value>>,
    /// The last good revision, checked by the same rules, had it too: show-time admission
    /// returns it marked carried and never refuses for it (Revision).
    pub carried: bool,
    /// On `unknown_kind` and `unknown_field`: at most three close names, a rename or retirement
    /// record's first (#412).
    pub close: Vec<Value>,
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
            carried: false,
            close: Vec::new(),
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
        out.insert("actual".into(), cut(&self.actual));
        out.insert("what".into(), json!(self.what));
        out.insert("fix".into(), json!(self.fix));
        if self.code == "bad_unit" || !self.forms.is_empty() {
            out.insert("forms".into(), json!(self.forms));
        }
        // The column view's issue names its reader, column, row, value and step (#397); a terrain
        // overlay's its array, cell, value and step (#537); a bake's empty bands, theirs (#503).
        if matches!(
            self.code,
            "column.out_of_range"
                | "terrain.overlay_range"
                | "spectrum_band_empty"
                | "surface.nonfinite"
                | "surface.coarse"
        ) {
            if let Value::Object(fields) = &self.actual {
                for (k, v) in fields {
                    out.entry(k.clone()).or_insert_with(|| v.clone());
                }
            }
        }
        // A pack kind's rule names its own code, `<pack>.<rule>` (#490).
        if self.code == packs::KIND_RULE {
            if let Some(rule) = self.actual.get("rule") {
                out.insert("code".into(), rule.clone());
            }
        }
        if let Some(ops) = &self.fix_ops {
            out.insert("fix_ops".into(), json!(ops));
        }
        if self.carried {
            out.insert("carried".into(), json!(true));
        }
        if !self.close.is_empty() {
            out.insert("close".into(), json!(self.close));
        }
        // An operator's issue at one of its steps names the step (#431: `operator_kind_rule
        // {step, reason}`).
        if let Some((_, step)) = self.path.split_once("/params/steps/") {
            out.insert("step".into(), json!(step));
        }
        Value::Object(out)
    }
}

/// An issue's `actual` as it is written out: the value refused at its path, cut at the read cap
/// (What holds a document to its rules). A longer string keeps its first 8,192 characters; any
/// other value whose JSON text is longer is written as that text, cut the same way.
pub fn cut(actual: &Value) -> Value {
    let first = |text: &str| -> String { text.chars().take(crate::show::READ_CAP).collect() };
    match actual {
        Value::String(text) if text.chars().count() > crate::show::READ_CAP => json!(first(text)),
        Value::Array(_) | Value::Object(_) => {
            let text = actual.to_string();
            if text.chars().count() > crate::show::READ_CAP {
                json!(first(&text))
            } else {
                actual.clone()
            }
        }
        _ => actual.clone(),
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
    /// On `deprecated`: the kind that replaces it (`family.name@major`) and the release since
    /// which it is deprecated.
    pub replaced_by: Option<(String, String)>,
    /// On `unknown_kind` and `unknown_field`: at most three close names (#412).
    pub close: Vec<Value>,
}

impl Notice {
    pub fn to_json(&self) -> Value {
        let mut out = Map::new();
        out.insert("code".into(), json!(self.code));
        out.insert("severity".into(), json!("notice"));
        out.insert("ids".into(), json!(self.ids));
        out.insert("path".into(), json!(self.path));
        out.insert("actual".into(), cut(&self.actual));
        out.insert("what".into(), json!(self.what));
        if let Some((kind, from, to)) = &self.migration {
            out.insert("kind".into(), json!(kind));
            out.insert("from".into(), json!(from));
            out.insert("to".into(), json!(to));
        }
        if let Some((replaced_by, since)) = &self.replaced_by {
            out.insert("replaced_by".into(), json!(replaced_by));
            out.insert("deprecated_since".into(), json!(since));
        }
        if !self.close.is_empty() {
            out.insert("close".into(), json!(self.close));
        }
        // `pack_missing {pack, version, ids}` (Pack: retired and missing).
        if self.code == "pack_missing" {
            packs::retired::fields(&self.actual, &mut out);
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
        "pack_missing",
        "The document names a pack version this build lacks.",
    ),
    (
        "derived_item",
        "A patch targets an item a recipe instance expands to, which only a break-out makes a writer's own.",
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
        "bad_rate",
        "A transport frame or sample rate that isn't a rate, or whose frame or sample isn't a whole number of flicks.",
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
        "column.out_of_range" => "Read the column as a type that holds the value, or fix the source's value.",
        "pack_missing" => "Install the pack at that version, or open the document where it is installed; never draw it with another version.",
        "derived_item" => "Patch the instance's inputs, or break the item out first with `break_out {instance, item}`.",
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
        "bad_rate" => "Use a rate whose frame or sample is a whole number of flicks: 60/1, 30000/1001 or 8/1 fps, 48000 or 44100 Hz.",
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
        "deprecated" => "Move the item to the kind its notice names in replaced_by.",
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
mod tests;
