//! Patches applied as a writer (canvas primitives: Patch): each patch all or nothing, the full
//! check after each, and the revision hash of what comes out.

use serde_json::{json, Map, Value};

use super::check::{check, migrate_item};
use super::shape::DocShape;
use super::{as_object, member, Issue, AT_VECTORS, ITEM_OPTIONAL_FIELDS, ITEM_OWN_FIELDS};
use crate::canon::revision_hash;
use crate::grammar::{HandleId, Id, Path, Section};

/// A patch's fields (canvas primitives: Patch). `base` is carried, not checked against a
/// revision here.
const PATCH_KEYS: &[&str] = &["patch", "doc", "base", "reason", "ops"];

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
type Refused = Box<Issue>;

/// The revision hash of `doc`, or the issue of a document with no canonical form (a float
/// outside its width, two keys that are one key after NFC).
fn hash_of(doc: &Value) -> Result<String, Refused> {
    revision_hash(doc, &DocShape::new(doc)).map_err(|e| {
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
/// result with no canonical form. `applied` always carries the revision hash of what comes out.
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
    let doc_id = member(doc, "id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut working = doc.clone();
    for (i, patch) in patches.iter().enumerate() {
        let ops = match patch_ops(i, patch, doc_id) {
            Ok(ops) => ops,
            Err(issue) => return refused(vec![*issue]),
        };
        let mut next = working.clone();
        for (j, op) in ops.iter().enumerate() {
            if let Err(issue) = apply_op(&mut next, &layer, j, op) {
                return refused(vec![*issue]);
            }
        }
        let result = check(&next);
        if !result.ok {
            return refused(result.issues);
        }
        store_migrations(&mut next, &layer);
        working = next;
    }
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

/// Stores the migrations of the items in `layer`, the writer's, in place. The check just passed
/// on the migrated form, so each step is one the build carries; the notices are the check's.
fn store_migrations(doc: &mut Value, layer: &str) {
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return;
    };
    let mut notices = Vec::new();
    for (key, item) in items.iter_mut() {
        if member(item, "layer").and_then(Value::as_str) == Some(layer) {
            migrate_item(key, item, &mut notices);
        }
    }
}

/// The ops of patch `i`, once its envelope holds exactly the patch's fields: `patch` a ULID,
/// `doc` this document's ID, `base` a u64, `reason` a string and `ops` a list. A patch that
/// can't say which patch it is, or which document it is for, is refused before any op runs.
fn patch_ops<'a>(i: usize, patch: &'a Value, doc_id: &str) -> Result<&'a Vec<Value>, Refused> {
    let at = |field: &str| format!("patches/{i}/{field}");
    let refuse = |code: &'static str, field: &str, what: &str| -> Refused {
        Box::new(Issue::envelope(
            code,
            at(field),
            member(patch, field).cloned().unwrap_or(Value::Null),
            what,
        ))
    };
    let Some(envelope) = as_object(patch) else {
        return Err(Box::new(Issue::envelope(
            "out_of_range",
            format!("patches/{i}"),
            patch.clone(),
            "a patch is an object",
        )));
    };
    if let Some(key) = envelope.keys().find(|k| !PATCH_KEYS.contains(&k.as_str())) {
        return Err(refuse(
            "unknown_field",
            key,
            "not a field of a patch (patch, doc, base, reason, ops)",
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
    envelope["ops"]
        .as_array()
        .ok_or_else(|| refuse("out_of_range", "ops", "not a list of ops"))
}

/// The one layer whose `writer` is `writer`. None is `ref_unresolved`; two would make the
/// outcome depend on the layers' order, so that is refused too (the check refuses it as well,
/// but the input is not checked before the first patch).
fn writer_layer(doc: &Value, writer: &str) -> Result<String, Refused> {
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

/// The fields each op has, `op` included; `cascade` is the one optional field.
fn op_fields(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "create" => Some(&["op", "item"]),
        "set" => Some(&["op", "id", "path", "value"]),
        "unset" => Some(&["op", "id", "path"]),
        "delete" => Some(&["op", "id", "cascade"]),
        _ => None,
    }
}

/// Refuses an op whose fields are not exactly its op's: an unknown field is `unknown_field`,
/// an absent one `out_of_range`, and `cascade` must be a bool when present.
fn check_op_fields(j: usize, op: &Map<String, Value>, name: &str) -> Result<(), Refused> {
    let Some(fields) = op_fields(name) else {
        return Err(Box::new(Issue::envelope(
            "unknown_field",
            format!("ops/{j}/op"),
            json!(name),
            "not an op of this slice (create, set, unset, delete)",
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
        if *field != "cascade" && !op.contains_key(*field) {
            return Err(Box::new(Issue::envelope(
                "out_of_range",
                format!("ops/{j}/{field}"),
                Value::Null,
                "required, and absent",
            )));
        }
    }
    if let Some(cascade) = op.get("cascade") {
        if !cascade.is_boolean() {
            return Err(Box::new(Issue::envelope(
                "out_of_range",
                format!("ops/{j}/cascade"),
                cascade.clone(),
                "not a bool",
            )));
        }
    }
    Ok(())
}

/// The op's `id` field as text.
fn op_id(j: usize, op: &Value) -> Result<String, Refused> {
    match member(op, "id") {
        Some(Value::String(id)) => Ok(id.clone()),
        other => Err(Box::new(Issue::envelope(
            "bad_id",
            format!("ops/{j}/id"),
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

/// The item `id` in the writer's layer, for a set, unset or delete.
fn own_item<'a>(
    items: &'a mut Map<String, Value>,
    id: &str,
    layer: &str,
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
    let Some(fields) = item.as_object_mut() else {
        return Err(Box::new(Issue::error(
            "out_of_range",
            id,
            format!("items/{id}"),
            Value::Null,
            "not an object",
        )));
    };
    if fields.get("layer").and_then(Value::as_str) != Some(layer) {
        return Err(Box::new(Issue::error(
            "not_your_layer",
            id,
            format!("items/{id}/layer"),
            fields.get("layer").cloned().unwrap_or(Value::Null),
            "the item is in another writer's layer",
        )));
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

fn apply_op(doc: &mut Value, layer: &str, j: usize, op: &Value) -> Result<(), Refused> {
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
        "create" => create(doc, layer, j, op),
        "set" => set(doc, layer, j, op),
        "unset" => unset(doc, layer, j, op),
        _ => delete(doc, layer, j, op),
    }
}

fn create(doc: &mut Value, layer: &str, j: usize, op: &Value) -> Result<(), Refused> {
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
    let mut stamped = item.clone();
    stamped.insert("layer".into(), json!(layer));
    items.insert(id.clone(), Value::Object(stamped));
    Ok(())
}

fn set(doc: &mut Value, layer: &str, j: usize, op: &Value) -> Result<(), Refused> {
    let id = op_id(j, op)?;
    let fields = op_path(&id, op)?;
    let value = member(op, "value").cloned().unwrap_or(Value::Null);
    let item = own_item(items_mut(doc)?, &id, layer)?;
    let steps: Vec<&str> = fields.iter().map(String::as_str).collect();
    match steps.as_slice() {
        ["params", name] => {
            object_at(item, "params").insert((*name).to_string(), value);
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

fn unset(doc: &mut Value, layer: &str, j: usize, op: &Value) -> Result<(), Refused> {
    let id = op_id(j, op)?;
    let fields = op_path(&id, op)?;
    let item = own_item(items_mut(doc)?, &id, layer)?;
    let steps: Vec<&str> = fields.iter().map(String::as_str).collect();
    match steps.as_slice() {
        ["params", name] => {
            if let Some(Value::Object(params)) = item.get_mut("params") {
                params.shift_remove(*name);
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

fn delete(doc: &mut Value, layer: &str, j: usize, op: &Value) -> Result<(), Refused> {
    let id = op_id(j, op)?;
    let cascade = member(op, "cascade")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let items = items_mut(doc)?;
    own_item(items, &id, layer)?;
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
                if child_layer.and_then(Value::as_str) != Some(layer) {
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
            }
            gone.extend(more);
        }
    }
    for id in gone {
        items.shift_remove(&id);
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
