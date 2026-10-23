//! Patches applied as a writer (canvas primitives: Patch): each patch all or nothing, the full
//! check after each, and the revision hash of what comes out.
//!
//! [`apply_ops`] is one patch's ops on one document as one writer, with what the hub needs to
//! commit it: the real IDs of its temporary ones, each item it changed as it was before (for its
//! achieved counts and its undo), and the IDs it touches (for a rebase).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::check::{check, migrate_item};
use super::order::key_between;
use super::requires::write_required_kinds;
use super::shape::DocShape;
use super::{
    as_object, kind_text, member, Issue, AT_VECTORS, ITEM_OPTIONAL_FIELDS, ITEM_OWN_FIELDS,
};
use super::{rows, transform};
use crate::canon::{revision_hash, sha256_hex};
use crate::grammar::{HandleId, Id, Path, Section};
use crate::kinds::{lookup, registry, Lookup};

/// A patch's fields (canvas primitives: Patch). `base` is carried, not checked against a
/// revision here.
const PATCH_KEYS: &[&str] = &["patch", "doc", "base", "reason", "ops"];
/// A patch's optional field the core reads at admission: `coalesce_key`, a string (Admission and
/// latch: a coalesce key keeps only the latest value).
const COALESCE_KEY: &str = "coalesce_key";

/// What an apply returns.
#[derive(Clone, Debug)]
pub struct ApplyResult {
    /// `applied` or `refused`.
    pub outcome: &'static str,
    pub issues: Vec<Issue>,
    /// The revision hash of `doc`: always set when `applied`; empty only on a refusal whose
    /// input has no canonical form.
    pub hash: String,
    /// The document after the last applied patch; the input, unchanged, when refused.
    pub doc: Value,
}

impl ApplyResult {
    pub fn to_json(&self) -> Value {
        json!({
            "outcome": self.outcome,
            "issues": self.issues.iter().map(Issue::to_json).collect::<Vec<_>>(),
            "hash": self.hash,
            "doc": self.doc,
        })
    }
}

/// The issue an op is refused with, boxed so the ok path stays small.
pub type Refused = Box<Issue>;

/// Who a patch writes as, and what it reads besides the document it changes.
pub struct Writing<'a> {
    /// The writer's layer.
    pub layer: &'a str,
    /// The writer's text, `kind:id`: it seeds the patch's order keys and minted IDs.
    pub writer: &'a str,
    /// A patch from you takes another writer's item into your layer (Writer layer).
    pub you: bool,
    /// The revision the patch was made on, when it isn't the document patched: a new order key
    /// falls between its neighbors there.
    pub base: Option<&'a Value>,
    /// Whether this build knows a kind: an item of a kind it doesn't is never targeted.
    pub knows: &'a dyn Fn(&str) -> bool,
}

/// One patch applied in place, before any check: what [`rollback`] needs to take it back.
#[derive(Clone, Debug, Default)]
pub struct Patched {
    /// Each temporary ID (`~n`) and the ID it got.
    pub ids: Map<String, Value>,
    /// Each item the patch wrote, as it was before (`None`: it created it).
    pub before: BTreeMap<String, Option<Value>>,
    /// Each item it removed and where it sat then, in order, so a rollback puts it back there
    /// and leaves the bytes as they were.
    pub removed: Vec<(String, usize)>,
}

impl Patched {
    /// The IDs whose items changed in `doc`: created, changed, moved, taken or deleted.
    pub fn changed(&self, doc: &Value) -> BTreeSet<String> {
        let after = member(doc, "items");
        self.before
            .iter()
            .filter(|(id, was)| was.as_ref() != after.and_then(|i| member(i, id)))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// `{created: {kind: n}, updated: n, deleted: {kind: n}, unchanged}` (Patch: result).
    pub fn achieved(&self, doc: &Value) -> Value {
        let after = member(doc, "items");
        let mut created: BTreeMap<String, u64> = BTreeMap::new();
        let mut deleted: BTreeMap<String, u64> = BTreeMap::new();
        let mut updated = 0u64;
        for (id, was) in &self.before {
            let now = after.and_then(|i| member(i, id));
            match (was, now) {
                (None, Some(item)) => *created.entry(kind_of(item)).or_default() += 1,
                (Some(item), None) => *deleted.entry(kind_of(item)).or_default() += 1,
                (Some(a), Some(b)) if a != b => updated += 1,
                _ => {}
            }
        }
        let unchanged = created.is_empty() && deleted.is_empty() && updated == 0;
        json!({"created": created, "updated": updated, "deleted": deleted, "unchanged": unchanged})
    }

    /// The inverse ops, for the same writer: deletes for what it created, creates for what it
    /// deleted and the fields it changed set back. A take has no op: undoing the patch that took
    /// an item hands it back through the hub's undo, which restores items as they were.
    pub fn undo(&self, doc: &Value) -> Vec<Value> {
        let after = member(doc, "items");
        let mut ops = Vec::new();
        for (id, was) in &self.before {
            let now = after.and_then(|i| member(i, id));
            match (was, now) {
                (None, Some(_)) => ops.push(json!({"op": "delete", "id": id, "cascade": false})),
                (Some(item), None) => {
                    let mut item = item.clone();
                    if let Some(fields) = item.as_object_mut() {
                        fields.shift_remove("layer");
                    }
                    ops.push(json!({"op": "create", "item": item}));
                }
                (Some(Value::Object(a)), Some(Value::Object(b))) => {
                    let fields: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
                    for f in fields {
                        if ["id", "kind", "layer"].contains(&f.as_str()) || a.get(f) == b.get(f) {
                            continue;
                        }
                        let path = format!("items/{id}/{f}");
                        ops.push(match a.get(f) {
                            Some(v) => json!({"op": "set", "id": id, "path": path, "value": v}),
                            None => json!({"op": "unset", "id": id, "path": path}),
                        });
                    }
                }
                _ => {}
            }
        }
        ops
    }
}

fn kind_of(item: &Value) -> String {
    kind_text(item).unwrap_or_default().to_string()
}

/// The revision hash of `doc`, or the issue of a document with no canonical form (a float
/// outside its width, two keys that are one key after NFC).
fn hash_of(doc: &Value) -> Result<String, Refused> {
    // `apply` checks in the core's own build (`check`), so it hashes by the core's own kinds.
    let kinds = crate::kinds::registry();
    revision_hash(doc, &DocShape::new(doc, &kinds)).map_err(|e| {
        Box::new(Issue::envelope(
            "out_of_range",
            e.path,
            Value::Null,
            &e.what,
        ))
    })
}

/// Applies `patches` to `doc` in order as `writer`. A patch with any refused op, or whose
/// result fails the check, refuses the run with those issues and the input unchanged; so does a
/// result with no canonical form. `applied` always carries the revision hash of what comes out,
/// and `requires.kinds` as its fields need it.
/// The input itself is not checked before the first patch: a history may start from an
/// envelope whose references its patches go on to create.
///
/// Migrations run at load, on the check's lowered copy; the stored document changes only when
/// its writer next patches it (canvas primitives: Migration). So each applied patch also stores
/// the migrated kind and params of the items in the writer's layer, and nothing else the check
/// lowers: another writer's items stay byte for byte (R2), a unit literal stays as written, and
/// a field a required newer minor skips is kept for the app that wrote it.
pub fn apply(doc: &Value, writer: &str, patches: &[Value]) -> ApplyResult {
    let refused = |issues: Vec<Issue>| ApplyResult {
        outcome: "refused",
        issues,
        hash: hash_of(doc).unwrap_or_default(),
        doc: doc.clone(),
    };
    let layer = match writer_layer(doc, writer) {
        Ok(layer) => layer,
        Err(issue) => return refused(vec![*issue]),
    };
    let reg = registry();
    let knows = |kind: &str| !matches!(lookup(&reg, kind), Lookup::UnknownKind);
    let doc_id = member(doc, "id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut working = doc.clone();
    for (i, patch) in patches.iter().enumerate() {
        let writing = Writing {
            layer: &layer,
            writer,
            you: writer.starts_with("you:"),
            base: None,
            knows: &knows,
        };
        // A refusal returns before `working` is read again, so the ops apply to it in place.
        let at = format!("patches/{i}");
        if let Err(issue) = apply_ops(&mut working, patch, &at, doc_id, &writing) {
            return refused(vec![*issue]);
        }
        let result = check(&working);
        if !result.ok {
            return refused(result.issues);
        }
        store_migrations(&mut working, &layer);
    }
    write_required_kinds(&mut working, &reg);
    match hash_of(&working) {
        Ok(hash) => ApplyResult {
            outcome: "applied",
            issues: Vec::new(),
            hash,
            doc: working,
        },
        Err(issue) => refused(vec![*issue]),
    }
}

/// Stores the migrations of the items in `layer`, the writer's, in place, and returns each item
/// it migrated as it was before. The check just passed on the migrated form, so each step is one
/// the build carries; the notices are the check's.
pub fn store_migrations(doc: &mut Value, layer: &str) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return out;
    };
    let mut notices = Vec::new();
    let registry = registry();
    for (key, item) in items.iter_mut() {
        if member(item, "layer").and_then(Value::as_str) != Some(layer) {
            continue;
        }
        let older = kind_text(item).is_some_and(|k| match lookup(&registry, k) {
            Lookup::Known { entry, saved } => saved < entry.current().major,
            _ => false,
        });
        if older {
            out.push((key.clone(), item.clone()));
            migrate_item(key, item, &mut notices, &registry);
        }
    }
    out
}

/// One patch's ops on `doc`, in place, as `writing` says: all or nothing, before any check, so a
/// refused op leaves `doc` as it was, byte for byte. `at` prefixes the envelope's paths in an
/// issue (`patches/0`). Its cost is its ops', never the document's (Admission and latch).
pub fn apply_ops(
    doc: &mut Value,
    patch: &Value,
    at: &str,
    doc_id: &str,
    writing: &Writing<'_>,
) -> Result<Patched, Refused> {
    let ops = patch_ops(at, patch, doc_id)?;
    // A view of the record is rebuilt from projections, never patched (Patch: it can never edit
    // a view of the record).
    if let Some(source) = member(doc, "source") {
        return Err(Box::new(Issue::envelope(
            "record_view",
            "source".into(),
            source.clone(),
            "a view of the record is rebuilt from the record, never patched",
        )));
    }
    let patch_id = member(patch, "patch")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let ids = mint_ids(doc, ops, writing, patch_id);
    let mut done = Patched {
        ids: ids.clone(),
        ..Patched::default()
    };
    for (j, op) in ops.iter().enumerate() {
        let op = with_ids(op, &ids);
        let seed = format!("{}|{patch_id}|{j}", writing.writer);
        if let Err(issue) = apply_op(doc, writing, j, &op, &seed, &mut done) {
            rollback(doc, &done);
            return Err(issue);
        }
    }
    Ok(done)
}

/// Takes a patch applied in place back out of `doc`, leaving it as it was, its items in their
/// places.
pub fn rollback(doc: &mut Value, patched: &Patched) {
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return;
    };
    // What it created goes; what it removed comes back where it sat, the last removed first;
    // what it changed takes its old value in its place.
    for (id, was) in &patched.before {
        if was.is_none() {
            items.shift_remove(id);
        }
    }
    for (id, at) in patched.removed.iter().rev() {
        if let Some(Some(item)) = patched.before.get(id) {
            items.shift_remove(id);
            items.shift_insert((*at).min(items.len()), id.clone(), item.clone());
        }
    }
    for (id, was) in &patched.before {
        if let Some(item) = was {
            items.insert(id.clone(), item.clone());
        }
    }
}

/// The IDs a patch touches (Patch): those its ops target, plus the parent a create or move
/// names and the neighbor a reorder names; `targets_only` leaves out the parents and neighbors.
pub fn touched(patch: &Value, targets_only: bool) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let ops = member(patch, "ops").and_then(Value::as_array);
    for op in ops.into_iter().flatten() {
        let item = member(op, "item");
        let mut take = |v: Option<&Value>| {
            if let Some(id) = v.and_then(Value::as_str) {
                out.insert(id.to_string());
            }
        };
        take(member(op, "id"));
        take(item.and_then(|i| member(i, "id")));
        if !targets_only {
            take(item.and_then(|i| member(i, "parent")));
            if member(op, "op").and_then(Value::as_str) == Some("move") {
                take(member(op, "parent"));
            }
            take(member(op, "after"));
            take(member(op, "before"));
        }
    }
    out.retain(|id| !id.starts_with('~'));
    out
}

/// A real ID for each temporary one a create names (`~n`), from the writer's layer, the writer,
/// the patch and `n`, so a replay mints the same ID; never one the document holds.
fn mint_ids(doc: &Value, ops: &[Value], writing: &Writing<'_>, patch: &str) -> Map<String, Value> {
    let mut out = Map::new();
    let items = member(doc, "items").and_then(as_object);
    for op in ops {
        let Some(temp) = member(op, "item")
            .and_then(|i| member(i, "id"))
            .and_then(Value::as_str)
            .filter(|id| is_temporary(id))
        else {
            continue;
        };
        let hex = sha256_hex(format!("{}|{patch}|{temp}", writing.writer).as_bytes());
        let mut len = 8;
        let mut id = format!("{}.t{}", writing.layer, &hex[..len]);
        while items.is_some_and(|i| i.contains_key(&id)) && len < hex.len() {
            len += 4;
            id = format!("{}.t{}", writing.layer, &hex[..len]);
        }
        out.insert(temp.to_string(), json!(id));
    }
    out
}

fn is_temporary(id: &str) -> bool {
    id.strip_prefix('~')
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// `op` with each temporary ID it names replaced by its real one.
fn with_ids(op: &Value, ids: &Map<String, Value>) -> Value {
    if ids.is_empty() {
        return op.clone();
    }
    let real = |v: &mut Value| {
        if let Some(id) = v.as_str().and_then(|t| ids.get(t)) {
            *v = id.clone();
        }
    };
    let mut op = op.clone();
    if let Some(fields) = op.as_object_mut() {
        for key in ["id", "parent", "after", "before"] {
            if let Some(v) = fields.get_mut(key) {
                real(v);
            }
        }
        if let Some(Value::String(path)) = fields.get_mut("path") {
            for (temp, id) in ids {
                if let (Some(rest), Some(id)) =
                    (path.strip_prefix(&format!("items/{temp}/")), id.as_str())
                {
                    *path = format!("items/{id}/{rest}");
                    break;
                }
            }
        }
        if let Some(Value::Object(item)) = fields.get_mut("item") {
            for key in ["id", "parent"] {
                if let Some(v) = item.get_mut(key) {
                    real(v);
                }
            }
        }
    }
    op
}

/// The ops of a patch, once its envelope holds exactly the patch's fields: `patch` a ULID,
/// `doc` this document's ID, `base` a u64, `reason` a string and `ops` a list. A patch that
/// can't say which patch it is, or which document it is for, is refused before any op runs.
fn patch_ops<'a>(at: &str, patch: &'a Value, doc_id: &str) -> Result<&'a Vec<Value>, Refused> {
    let path = |field: &str| format!("{at}/{field}");
    let refuse = |code: &'static str, field: &str, what: &str| -> Refused {
        Box::new(Issue::envelope(
            code,
            path(field),
            member(patch, field).cloned().unwrap_or(Value::Null),
            what,
        ))
    };
    let Some(envelope) = as_object(patch) else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            at.to_string(),
            patch.clone(),
            "a patch is an object",
        )));
    };
    let known = |k: &String| PATCH_KEYS.contains(&k.as_str()) || k == COALESCE_KEY;
    if let Some(key) = envelope.keys().find(|k| !known(k)) {
        return Err(refuse(
            "unknown_field",
            key,
            "not a field of a patch (patch, doc, base, reason, ops, coalesce_key)",
        ));
    }
    for field in PATCH_KEYS {
        if !envelope.contains_key(*field) {
            return Err(refuse("out_of_range", field, "required, and absent"));
        }
    }
    match envelope["patch"].as_str().map(HandleId::parse) {
        Some(Ok(HandleId::Ulid(_))) => {}
        _ => return Err(refuse("bad_id", "patch", "not a ULID")),
    }
    if envelope["doc"].as_str() != Some(doc_id) {
        return Err(refuse(
            "ref_unresolved",
            "doc",
            "not the ID of the document patched",
        ));
    }
    if envelope["base"].as_u64().is_none() {
        return Err(refuse("out_of_range", "base", "not a u64 revision"));
    }
    if !envelope["reason"].is_string() {
        return Err(refuse("out_of_range", "reason", "not a string"));
    }
    if envelope.get(COALESCE_KEY).is_some_and(|k| !k.is_string()) {
        return Err(refuse("out_of_range", COALESCE_KEY, "not a string"));
    }
    envelope["ops"]
        .as_array()
        .ok_or_else(|| refuse("out_of_range", "ops", "not a list of ops"))
}

/// The one layer whose `writer` is `writer`. None is `ref_unresolved`; two would make the
/// outcome depend on the layers' order, so that is refused too (the check refuses it as well,
/// but the input is not checked before the first patch).
pub fn writer_layer(doc: &Value, writer: &str) -> Result<String, Refused> {
    let mut found: Vec<&String> = Vec::new();
    if let Some(layers) = member(doc, "layers").and_then(as_object) {
        for (id, layer) in layers {
            if member(layer, "writer").and_then(Value::as_str) == Some(writer) {
                found.push(id);
            }
        }
    }
    found.sort();
    match found.as_slice() {
        [id] => Ok((*id).clone()),
        [] => Err(Box::new(Issue::envelope(
            "ref_unresolved",
            "layers".into(),
            json!(writer),
            "no layer has this writer",
        ))),
        [first, second, ..] => Err(Box::new(Issue::envelope(
            "out_of_range",
            format!("layers/{second}/writer"),
            json!(writer),
            &format!("layer `{first}` has this writer too"),
        ))),
    }
}

/// The fields each op has, `op` included; the optional ones are listed in [`OPTIONAL`].
fn op_fields(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "create" => Some(&["op", "item"]),
        "set" => Some(&["op", "id", "path", "value"]),
        "unset" => Some(&["op", "id", "path"]),
        "delete" => Some(&["op", "id", "cascade"]),
        "move" => Some(&["op", "id", "parent", "keep"]),
        "reorder" => Some(&["op", "id", "after", "before"]),
        "rows" => Some(&["op", "id", "append", "set", "remove"]),
        _ => None,
    }
}

/// The op fields that may be left out: a delete's `cascade`, a move's `keep`, a reorder's `after`
/// and `before`, of which it names exactly one, and a rows op's `append`, `set` and `remove`,
/// likewise one.
const OPTIONAL: &[&str] = &[
    "cascade", "keep", "after", "before", "append", "set", "remove",
];

/// Refuses an op whose fields are not exactly its op's: an unknown field is `unknown_field`,
/// an absent one `out_of_range`; `cascade` must be a bool, `keep` world or local, and a reorder
/// names one neighbor.
fn check_op_fields(j: usize, op: &Map<String, Value>, name: &str) -> Result<(), Refused> {
    let bad = |field: &str, what: &str| -> Refused {
        Box::new(Issue::envelope(
            "out_of_range",
            format!("ops/{j}/{field}"),
            op.get(field).cloned().unwrap_or(Value::Null),
            what,
        ))
    };
    let Some(fields) = op_fields(name) else {
        return Err(Box::new(Issue::envelope(
            "unknown_field",
            format!("ops/{j}/op"),
            json!(name),
            "not an op of this slice (create, set, unset, delete, move, reorder, rows)",
        )));
    };
    if let Some(key) = op.keys().find(|k| !fields.contains(&k.as_str())) {
        return Err(Box::new(Issue::envelope(
            "unknown_field",
            format!("ops/{j}/{key}"),
            op[key].clone(),
            &format!("not a field of `{name}` ({})", fields.join(", ")),
        )));
    }
    for field in fields {
        if !OPTIONAL.contains(field) && !op.contains_key(*field) {
            return Err(bad(field, "required, and absent"));
        }
    }
    if op.get("cascade").is_some_and(|c| !c.is_boolean()) {
        return Err(bad("cascade", "not a bool"));
    }
    if op
        .get("keep")
        .is_some_and(|k| !matches!(k.as_str(), Some("world" | "local")))
    {
        return Err(bad("keep", "not world or local"));
    }
    if name == "reorder" && op.contains_key("after") == op.contains_key("before") {
        return Err(bad("after", "a reorder names one of after and before"));
    }
    let edits = ["append", "set", "remove"]
        .iter()
        .filter(|k| op.contains_key(**k))
        .count();
    if name == "rows" && edits != 1 {
        return Err(bad(
            "append",
            "a rows op names one of append, set and remove",
        ));
    }
    Ok(())
}

/// The op's ID field `key` as text.
fn op_text(j: usize, op: &Value, key: &str) -> Result<String, Refused> {
    match member(op, key) {
        Some(Value::String(id)) => Ok(id.clone()),
        other => Err(Box::new(Issue::envelope(
            "bad_id",
            format!("ops/{j}/{key}"),
            other.cloned().unwrap_or(Value::Null),
            "not an ID",
        ))),
    }
}

/// The mutable items map, created when absent.
fn items_mut(doc: &mut Value) -> Result<&mut Map<String, Value>, Refused> {
    let Some(envelope) = doc.as_object_mut() else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            String::new(),
            Value::Null,
            "a document is an object",
        )));
    };
    let items = envelope
        .entry("items")
        .or_insert_with(|| Value::Object(Map::new()));
    items.as_object_mut().ok_or_else(|| {
        Box::new(Issue::envelope(
            "out_of_range",
            "items".into(),
            Value::Null,
            "not an object",
        ))
    })
}

/// The item `id` for a writer to change: one of a kind this build knows, in the writer's layer,
/// or taken into yours by your patch. Its value before the patch goes into `before`.
fn writable<'a>(
    items: &'a mut Map<String, Value>,
    id: &str,
    writing: &Writing<'_>,
    done: &mut Patched,
) -> Result<&'a mut Map<String, Value>, Refused> {
    let Some(item) = items.get_mut(id) else {
        return Err(Box::new(Issue::error(
            "ref_unresolved",
            id,
            format!("items/{id}"),
            json!(id),
            "no such item",
        )));
    };
    if let Some(kind) = kind_text(item).filter(|k| !(writing.knows)(k)) {
        return Err(Box::new(Issue::error(
            "unknown_kind",
            id,
            format!("items/{id}/kind"),
            json!(kind),
            "this build doesn't know the item's kind: it is kept as written, and never patched",
        )));
    }
    done.before
        .entry(id.to_string())
        .or_insert_with(|| Some(item.clone()));
    let Some(fields) = item.as_object_mut() else {
        return Err(Box::new(Issue::error(
            "out_of_range",
            id,
            format!("items/{id}"),
            Value::Null,
            "not an object",
        )));
    };
    if fields.get("layer").and_then(Value::as_str) != Some(writing.layer) {
        if !writing.you {
            return Err(Box::new(Issue::error(
                "not_your_layer",
                id,
                format!("items/{id}/layer"),
                fields.get("layer").cloned().unwrap_or(Value::Null),
                "the item is in another writer's layer",
            )));
        }
        // Your patch takes the item into your layer with its ID and values.
        fields.insert("layer".into(), json!(writing.layer));
    }
    Ok(fields)
}

/// Parses the op's path, requiring its ID part to be `id` and its section `items`; returns
/// the field steps.
fn op_path(id: &str, op: &Value) -> Result<Vec<String>, Refused> {
    let at = format!("items/{id}");
    let Some(Value::String(text)) = member(op, "path") else {
        return Err(Box::new(Issue::error(
            "bad_path",
            id,
            at,
            member(op, "path").cloned().unwrap_or(Value::Null),
            "not a path",
        )));
    };
    let path = Path::parse(text).map_err(|r| {
        let code = if r.code == "bad_id" {
            "bad_id"
        } else {
            "bad_path"
        };
        Box::new(Issue::error(code, id, at.clone(), json!(text), &r.what))
    })?;
    if path.id().as_str() != id {
        return Err(Box::new(Issue::error(
            "bad_path",
            id,
            at,
            json!(text),
            "the path's ID is not the op's id",
        )));
    }
    if path.section() != Section::Items {
        return Err(Box::new(Issue::error(
            "ref_unresolved",
            id,
            at,
            json!(text),
            "a patch reaches only items",
        )));
    }
    if let Some(sub) = path.sub() {
        return Err(Box::new(Issue::error(
            "ref_unresolved",
            id,
            at,
            json!(text),
            &format!("`#{sub}` names a part of the item, and no kind in this build has parts"),
        )));
    }
    Ok(path.fields().to_vec())
}

fn unresolved(id: &str, op: &Value) -> Refused {
    let text = member(op, "path").cloned().unwrap_or(Value::Null);
    Box::new(Issue::error(
        "ref_unresolved",
        id,
        format!("items/{id}"),
        text,
        "the path resolves to nothing",
    ))
}

fn apply_op(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    seed: &str,
    done: &mut Patched,
) -> Result<(), Refused> {
    let Some(fields) = as_object(op) else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            format!("ops/{j}"),
            op.clone(),
            "an op is an object",
        )));
    };
    let Some(name) = fields.get("op").and_then(Value::as_str) else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            format!("ops/{j}/op"),
            fields.get("op").cloned().unwrap_or(Value::Null),
            "not an op name",
        )));
    };
    check_op_fields(j, fields, name)?;
    match name {
        "create" => create(doc, writing.layer, j, op, done),
        "set" => set(doc, writing, j, op, done),
        "unset" => unset(doc, writing, j, op, done),
        "move" => move_to(doc, writing, j, op, done),
        "reorder" => reorder(doc, writing, j, op, seed, done),
        "rows" => rows_op(doc, writing, j, op, done),
        _ => delete(doc, writing, j, op, done),
    }
}

fn create(
    doc: &mut Value,
    layer: &str,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let Some(item) = member(op, "item").and_then(as_object) else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            format!("ops/{j}/item"),
            member(op, "item").cloned().unwrap_or(Value::Null),
            "not an item",
        )));
    };
    let Some(Value::String(id)) = item.get("id") else {
        return Err(Box::new(Issue::envelope(
            "bad_id",
            format!("ops/{j}/item/id"),
            item.get("id").cloned().unwrap_or(Value::Null),
            "not an ID",
        )));
    };
    if let Err(r) = Id::parse(id) {
        return Err(Box::new(Issue::error(
            "bad_id",
            id,
            format!("items/{id}"),
            json!(id),
            &r.what,
        )));
    }
    let items = items_mut(doc)?;
    if items.contains_key(id) {
        // The closed list has no duplicate-ID code; the ID is not usable, which is `bad_id`.
        return Err(Box::new(Issue::error(
            "bad_id",
            id,
            format!("items/{id}"),
            json!(id),
            "ID already exists",
        )));
    }
    done.before.entry(id.clone()).or_insert(None);
    let mut stamped = item.clone();
    stamped.insert("layer".into(), json!(layer));
    items.insert(id.clone(), Value::Object(stamped));
    Ok(())
}

fn set(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let fields = op_path(&id, op)?;
    let value = member(op, "value").cloned().unwrap_or(Value::Null);
    let item = writable(items_mut(doc)?, &id, writing, done)?;
    let steps: Vec<&str> = fields.iter().map(String::as_str).collect();
    match steps.as_slice() {
        ["params" | "at"] if value.is_object() => {
            item.insert(steps[0].to_string(), value);
        }
        ["params", path @ ..] if !path.is_empty() => {
            let (last, parents) = path.split_last().expect("not empty");
            let mut at = object_at(item, "params");
            for step in parents {
                let slot = at
                    .entry((*step).to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                at = slot.as_object_mut().ok_or_else(|| unresolved(&id, op))?;
            }
            at.insert((*last).to_string(), value);
        }
        ["at", name] if AT_VECTORS.contains(name) || *name == "shear" => {
            object_at(item, "at").insert((*name).to_string(), value);
        }
        ["at", name, index] if AT_VECTORS.contains(name) => {
            let Some(i) = ["0", "1", "2"].iter().position(|x| x == index) else {
                return Err(unresolved(&id, op));
            };
            let at = object_at(item, "at");
            let default = if *name == "scale" {
                json!([1, 1, 1])
            } else {
                json!([0, 0, 0])
            };
            let vector = at.entry((*name).to_string()).or_insert(default.clone());
            if vector.as_array().is_none_or(|a| a.len() != 3) {
                *vector = default;
            }
            if let Some(list) = vector.as_array_mut() {
                list[i] = value;
            }
        }
        [field] if ITEM_OWN_FIELDS.contains(field) && !["id", "kind", "layer"].contains(field) => {
            item.insert((*field).to_string(), value);
        }
        _ => return Err(unresolved(&id, op)),
    }
    Ok(())
}

fn unset(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let fields = op_path(&id, op)?;
    let item = writable(items_mut(doc)?, &id, writing, done)?;
    let steps: Vec<&str> = fields.iter().map(String::as_str).collect();
    match steps.as_slice() {
        ["params", path @ ..] if !path.is_empty() => {
            let (last, parents) = path.split_last().expect("not empty");
            let mut at = item.get_mut("params");
            for step in parents {
                at = at.and_then(|v| v.get_mut(*step));
            }
            if let Some(Value::Object(map)) = at {
                map.shift_remove(*last);
            }
        }
        ["at", name] if AT_VECTORS.contains(name) || *name == "shear" => {
            if let Some(Value::Object(at)) = item.get_mut("at") {
                at.shift_remove(*name);
            }
        }
        [field] if ITEM_OPTIONAL_FIELDS.contains(field) => {
            item.shift_remove(*field);
        }
        _ => return Err(unresolved(&id, op)),
    }
    Ok(())
}

/// `move {id, parent, keep}`: the item under a new parent (an ID any writer holds, or null for
/// none), never under itself. No drawing in this build composes a parent's transform, so the
/// item's `at` is its place in the world either way and `keep` changes nothing yet.
fn move_to(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let parent = match member(op, "parent") {
        Some(Value::Null) => None,
        _ => Some(op_text(j, op, "parent")?),
    };
    let items = items_mut(doc)?;
    if let Some(p) = &parent {
        if !items.contains_key(p) {
            return Err(Box::new(Issue::error(
                "ref_unresolved",
                &id,
                format!("items/{id}/parent"),
                json!(p),
                "no such item",
            )));
        }
        // Walk up from the new parent: reaching the item is a cycle.
        let mut at = Some(p.clone());
        for _ in 0..=items.len() {
            let Some(here) = at else { break };
            if here == id {
                return Err(Box::new(Issue::error(
                    "cycle",
                    &id,
                    format!("items/{id}/parent"),
                    json!(p),
                    "the new parent descends from the item",
                )));
            }
            at = items
                .get(&here)
                .and_then(|i| member(i, "parent"))
                .and_then(Value::as_str)
                .map(str::to_string);
        }
    }
    // `keep: world` (the default) rewrites `at` so the item stays where it is in the world.
    let world = member(op, "keep").and_then(Value::as_str) != Some("local");
    let kept = if world {
        let old_parent = items
            .get(&id)
            .and_then(|i| member(i, "parent"))
            .and_then(Value::as_str);
        let at = items.get(&id).and_then(|i| member(i, "at"));
        let place = transform::world(items, old_parent)
            .and_then(|old| Ok((old, transform::world(items, parent.as_deref())?)))
            .and_then(|(old, new)| transform::keep_world(at, old, new));
        match place {
            Ok(kept) => kept,
            Err(why) => {
                return Err(Box::new(Issue::error(
                    "out_of_range",
                    &id,
                    format!("items/{id}/at"),
                    at.cloned().unwrap_or(Value::Null),
                    &format!(
                        "keep: world can't be written in `at` here: {why}; move with keep: local"
                    ),
                )))
            }
        }
    } else {
        None
    };
    let item = writable(items, &id, writing, done)?;
    match parent {
        Some(p) => item.insert("parent".into(), json!(p)),
        None => item.shift_remove("parent"),
    };
    if let Some(at) = kept {
        item.insert("at".into(), at);
    }
    Ok(())
}

/// `rows {id, append | set | remove}`: a mark set's rows edited in place, by key.
fn rows_op(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let item = writable(items_mut(doc)?, &id, writing, done)?;
    let empty = Map::new();
    let params = item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let edit = as_object(op).expect("an op is an object");
    match rows::rows(params, edit) {
        Ok(params) => {
            item.insert("params".into(), Value::Object(params));
            Ok(())
        }
        Err((code, path, what)) => {
            let at = if path.starts_with("params") {
                format!("items/{id}/{path}")
            } else {
                format!("ops/{j}/{path}")
            };
            Err(Box::new(Issue::error(code, &id, at, Value::Null, &what)))
        }
    }
}

/// `reorder {id, after | before}`: a key between the named sibling and its neighbor on that side
/// in the patch's base, with jitter seeded from the writer, the patch and the op.
fn reorder(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    seed: &str,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let after = member(op, "after").is_some();
    let neighbor = op_text(j, op, if after { "after" } else { "before" })?;
    let parent_of = |items: &Map<String, Value>, k: &str| {
        items
            .get(k)
            .and_then(|i| member(i, "parent"))
            .cloned()
            .unwrap_or(Value::Null)
    };
    let items = items_mut(doc)?;
    let refuse = |code: &'static str, what: &str| -> Refused {
        Box::new(Issue::error(
            code,
            &id,
            format!("items/{id}/order"),
            json!(neighbor),
            what,
        ))
    };
    if !items.contains_key(&neighbor) || neighbor == id {
        return Err(refuse("ref_unresolved", "no other item has this ID"));
    }
    let parent = parent_of(items, &id);
    // The siblings in the base, where the neighbor is there; else as the patch has them.
    let base = writing
        .base
        .and_then(|b| member(b, "items"))
        .and_then(as_object)
        .filter(|b| b.contains_key(&neighbor))
        .unwrap_or(&*items);
    if parent_of(base, &neighbor) != parent {
        return Err(refuse("out_of_range", "the neighbor has another parent"));
    }
    let key = |v: &Value| {
        member(v, "order")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let mut siblings: Vec<(String, &String)> = base
        .iter()
        .filter(|(k, v)| **k != id && member(v, "parent").cloned().unwrap_or(Value::Null) == parent)
        .map(|(k, v)| (key(v), k))
        .collect();
    siblings.sort();
    let at = key(&base[&neighbor]);
    let (lo, hi) = if after {
        let hi = siblings.iter().map(|s| &s.0).find(|k| **k > at);
        (Some(at.as_str()), hi.map(String::as_str))
    } else {
        let lo = siblings.iter().map(|s| &s.0).rev().find(|k| **k < at);
        (lo.map(String::as_str), Some(at.as_str()))
    };
    let lo = lo.filter(|k| !k.is_empty());
    let Some(order) = key_between(lo, hi, seed.as_bytes()) else {
        return Err(refuse(
            "out_of_range",
            "no order key fits between the neighbors",
        ));
    };
    writable(items, &id, writing, done)?.insert("order".into(), json!(order));
    Ok(())
}

fn delete(
    doc: &mut Value,
    writing: &Writing<'_>,
    j: usize,
    op: &Value,
    done: &mut Patched,
) -> Result<(), Refused> {
    let id = op_text(j, op, "id")?;
    let cascade = member(op, "cascade")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let items = items_mut(doc)?;
    writable(items, &id, writing, done)?;
    let mut gone = vec![id.clone()];
    if cascade {
        // Every descendant: repeat until no item's parent is among the gone. A descendant in
        // another writer's layer stops the whole delete: a writer removes only its own items.
        loop {
            let more: Vec<String> = items
                .iter()
                .filter(|(k, v)| {
                    !gone.contains(k)
                        && member(v, "parent")
                            .and_then(Value::as_str)
                            .is_some_and(|p| gone.iter().any(|g| g == p))
                })
                .map(|(k, _)| k.clone())
                .collect();
            if more.is_empty() {
                break;
            }
            for child in &more {
                let child_layer = items.get(child).and_then(|v| member(v, "layer"));
                if child_layer.and_then(Value::as_str) != Some(writing.layer) && !writing.you {
                    return Err(Box::new(Issue::error(
                        "not_your_layer",
                        child,
                        format!("items/{child}/layer"),
                        child_layer.cloned().unwrap_or(Value::Null),
                        &format!(
                            "the cascade from `{id}` reaches an item in another writer's layer"
                        ),
                    )));
                }
                writable(items, child, writing, done)?;
            }
            gone.extend(more);
        }
    }
    for id in gone {
        if let Some(at) = items.keys().position(|k| *k == id) {
            items.shift_remove(&id);
            done.removed.push((id, at));
        }
    }
    Ok(())
}

/// The object member `key` of `item`, created empty when absent or not an object.
fn object_at<'a>(item: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let slot = item
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !slot.is_object() {
        *slot = Value::Object(Map::new());
    }
    // Just made an object above when it was not one.
    slot.as_object_mut().expect("an object was just put here")
}
