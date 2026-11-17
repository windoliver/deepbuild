//! Documents several writers share (issue #96; canvas primitives: Writer layer, Patch, Revision,
//! Admission and latch; technical design: Provenance): patches stamped with the writer their
//! connection proves, a stale base rebased only when no ID the patch touches changed since, undo
//! by writer, whole revisions diffed against the writer's own layer, an item's history and the
//! by-writer lens, and the commit point: a layer file written by hash, then the `doc.patched`
//! event that makes its revision current.
//!
//! The hub holds each shared document's current revision and, for every committed revision
//! numbered from the stored document's 0, what it changed and how those entries were before, so
//! a patch costs its ops and an earlier revision is rebuilt only when asked for. With a state
//! folder, layer files go to `<state>/layers` by hash and the events to `<state>/record.jsonl`; a
//! run that finds a record restarts from it, taking each layer from the file its latest event
//! names, so a layer file no event names is never current.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::rc::Rc;
use std::time::Instant;

use deep_canvas::document::{
    apply_ops, canonical_in, check_packed, pack_kinds, recheck_with, rollback, store_migrations,
    touched_in, Issue, Notice, Packs, Patched, Referrers, Writing, ID_MAPS,
};
use deep_canvas::grammar::{Path as FieldPath, Section};
use deep_canvas::kinds::{lookup, registry, Lookup};
use deep_canvas::registry::Sealed;
use deep_canvas::show::{
    inline_count, order_issues, truncated, unreadable_handles, whole_diff_by, Writer, WriterKind,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::evidence;
use crate::frames::unfit_issue;
use crate::hub::{
    diff_reply, refused_reply, Body, Call, Hub, Include, PatchCall, Planted, Show, Via,
};
use crate::snapshot::Unfit;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Mark, Palette, Record, Refused};

/// Flicks per second (Time and the flick).
pub const FLICKS: i64 = 705_600_000;

/// Which writer's layer holds each entry of the maps keyed by ID besides `items`, which carry
/// their `layer` themselves: `(map, ID) → layer`.
pub type Owners = BTreeMap<(String, String), String>;

/// The paths a revision wrote: `(ID, path)`, the path `""` for a whole item.
pub type Paths = BTreeSet<(String, String)>;

/// A writer's quota (Writer connection), each cap optional: patches applied a second, items its
/// layers hold, bytes a message carries, and shared documents it writes.
#[derive(Clone, Copy, Debug, Default)]
pub struct Quota {
    pub patches_per_s: Option<u32>,
    pub items: Option<u32>,
    pub msg_bytes: Option<u32>,
    pub docs: Option<u32>,
}

/// A fault the commit hits, reachable only through the scenario's `fault`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitFault {
    /// The hub ends at once, as SIGKILL would, after writing this patch's layer file and before
    /// its `doc.patched` event.
    KillAfterLayerFile(String),
    /// Writing this patch's layer file fails at its commit.
    LayerFileFails(String),
}

/// The virtual display clock: vsync at `k × FLICKS / refresh_hz`, the latch `lead` before it,
/// and `check` flicks of the checker per patch it takes.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    /// `None` with `displays` (#400): each display has its own refresh, so a revision is
    /// current from its check and each window's latches read it.
    pub refresh_hz: Option<i64>,
    pub lead: i64,
    pub check: i64,
}

impl Clock {
    /// The first latch at or after `t`; `t` itself when every display has its own grid.
    pub fn latch_from(&self, t: i64) -> i64 {
        let Some(refresh_hz) = self.refresh_hz else {
            return t;
        };
        let period = FLICKS / refresh_hz;
        let k = (t + self.lead + period - 1).div_euclid(period).max(1);
        k * period - self.lead
    }
}

/// One committed revision of a shared document: who made it, what it changed and how that was.
pub struct Rev {
    pub rev: u64,
    pub base_rev: u64,
    /// `None` for the stored document, revision 0.
    pub writer: Option<Writer>,
    /// The patch it applied: a patch's, an undo's or a whole revision's ULID.
    pub patch: Option<String>,
    pub reason: String,
    /// The IDs whose entries it changed: an item's, or another map's.
    pub changed: BTreeSet<String>,
    /// Each item it wrote as it was before (`None`: it created it).
    pub before: BTreeMap<String, Option<Value>>,
    /// The paths it wrote, which an undo puts back.
    pub paths: Paths,
    /// The document's other fields and their owners before, when it changed them: a layer
    /// added, or a whole revision's entries.
    pub envelope_before: Option<(Map<String, Value>, Owners)>,
    /// The issues the check found in it.
    pub issues: Rc<Vec<Issue>>,
    /// The notices its check raised, `migrated` among them: kept when a check of the stored
    /// revision made it, else taken the first time `read` asks (#1959).
    pub notices: OnceCell<Vec<Notice>>,
    /// The revision hash, taken the first time it is asked for: a pure function of the document.
    pub hash: OnceCell<String>,
    /// The latch it became current at, on the clock.
    pub current_at: Option<i64>,
}

/// A shared document: its current revision, every revision's change, and what the hub owes its
/// writers.
pub struct Shared {
    /// The document ID as the scenario writes it.
    pub id: String,
    pub doc: Value,
    pub owners: Owners,
    pub revs: Vec<Rev>,
    /// Patches each writer was told applied and that never became current, by writer text, to
    /// report on its next reply.
    pub lost: BTreeMap<String, Vec<String>>,
    /// The layers that hold an item of a kind's older major, which their writer's next patch
    /// migrates (Migration), so a patch reads its layer's kinds only when there is one.
    pub older: BTreeSet<String>,
    /// Who names and who hangs from each item, as of the revision it gives (#896): a patch's
    /// recheck finds what it reaches by these, and a revision made another way rebuilds them.
    pub referrers: Option<(u64, Referrers)>,
}

impl Shared {
    pub fn current(&self) -> &Rev {
        self.revs.last().expect("a shared document has revision 0")
    }

    /// Revision `k`'s document and owners: the current ones, or rebuilt from them by putting
    /// back what each later revision changed.
    pub fn at(&self, k: usize) -> (Cow<'_, Value>, Cow<'_, Owners>) {
        if k + 1 >= self.revs.len() {
            return (Cow::Borrowed(&self.doc), Cow::Borrowed(&self.owners));
        }
        let (mut doc, mut owners) = (self.doc.clone(), self.owners.clone());
        for r in self.revs[k + 1..].iter().rev() {
            if let Some((fields, was)) = &r.envelope_before {
                let items = doc["items"].take();
                doc = Value::Object(fields.clone());
                doc["items"] = items;
                owners = was.clone();
            }
            if let Some(Value::Object(items)) = doc.get_mut("items") {
                for (id, was) in &r.before {
                    match was {
                        Some(item) => items.insert(id.clone(), item.clone()),
                        None => items.shift_remove(id),
                    };
                }
            }
        }
        (Cow::Owned(doc), Cow::Owned(owners))
    }

    /// Revision `k`'s hash, by the kinds of the build's sealed set.
    pub fn hash(&self, k: usize, sealed: &Sealed) -> &str {
        self.revs[k].hash.get_or_init(|| {
            canonical_in(&self.at(k).0, &sealed.kinds())
                .map(|c| c.sha256)
                .unwrap_or_default()
        })
    }

    /// Finds the layers that hold an item of a kind's older major.
    fn find_older(&mut self) {
        let registry = registry();
        self.older = self.doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, item)| {
                item["kind"]
                    .as_str()
                    .is_some_and(|k| match lookup(&registry, k) {
                        Lookup::Known { entry, saved } => saved < entry.current().major,
                        _ => false,
                    })
            })
            .filter_map(|(_, item)| item["layer"].as_str().map(str::to_string))
            .collect();
    }

    /// The document's fields besides its items, and the owners, as they are now.
    fn envelope(&self) -> (Map<String, Value>, Owners) {
        let mut fields = self.doc.as_object().cloned().unwrap_or_default();
        fields.shift_remove("items");
        (fields, self.owners.clone())
    }
}

/// What a check-and-commit leaves in the reply: an applied patch, or why not.
enum Outcome {
    Applied(Box<Applied>),
    Refused(Vec<Issue>),
    Conflict {
        ids: Vec<String>,
        writers: Vec<Writer>,
    },
}

/// An applied patch's result.
struct Applied {
    rev: u64,
    achieved: Value,
    cost: Value,
    undo: Vec<Value>,
    ids: Map<String, Value>,
    current_at: Option<i64>,
    /// The issues the last good revision had too, returned marked carried.
    carried: Vec<Issue>,
    /// The notices of its check, when it checked the whole document (#1961).
    notices: Vec<Value>,
}

/// A writer as a layer's `writer` holds it: `kind:id`.
pub fn writer_of_text(text: &str) -> Option<Writer> {
    let (kind, id) = text.split_once(':')?;
    let kind = match kind {
        "you" => WriterKind::You,
        "shell" => WriterKind::Shell,
        "record" => WriterKind::Record,
        "agent" => WriterKind::Agent,
        "plugin" => WriterKind::Plugin,
        _ => return None,
    };
    Some(Writer {
        kind,
        id: id.to_string(),
    })
}

/// Whether this build knows a kind: the marks module or scene3d draws it, or the kernel registers it.
pub fn knows(kind: &str) -> bool {
    deep_canvas_marks::scene::KINDS.contains(&kind)
        || deep_canvas_scene3d::scene::is_3d(kind)
        || kind == deep_canvas_scene3d::scene::OVERLAY
        // A readout (#419), such as the overlay that discloses an exaggerated length (#1183).
        || kind == "overlay.text@1"
        // #506: an inset, and a view of the document from another camera in a rect of the frame.
        || kind == deep_canvas_scene3d::inset::KIND
        || kind == deep_canvas_scene3d::views::KIND
        // The vector module's kind (#1162): an item the view draws, hears and points at.
        || kind == "vector@1"
        // A logic item (#544): baked at check into the occurrence lists its readers read; it draws nothing.
        || kind == "logic@1"
        || !matches!(lookup(&registry(), kind), Lookup::UnknownKind)
}

/// The layer whose `writer` is this writer's text, if the document has one.
pub fn layer_of(doc: &Value, writer: &Writer) -> Option<String> {
    let text = writer.text();
    doc.get("layers")?
        .as_object()?
        .iter()
        .find(|(_, l)| l.get("writer").and_then(Value::as_str) == Some(text.as_str()))
        .map(|(id, _)| id.clone())
}

/// The items that draw: of a kind this build knows, visible, and every parent they name there.
/// An item whose parent is gone hides, and only it and what hangs from it.
pub fn draws(doc: &Value) -> Vec<String> {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut out: Vec<String> = items
        .iter()
        .filter(|(_, item)| {
            item.get("kind").and_then(Value::as_str).is_some_and(knows)
                && item.get("visible") != Some(&Value::Bool(false))
        })
        .filter(|(id, _)| {
            let mut at = id.as_str();
            for _ in 0..=items.len() {
                match items[at].get("parent").and_then(Value::as_str) {
                    None => return true,
                    Some(p) if items.contains_key(p) => at = p,
                    // #504: an item joins an assembly by naming it as its parent.
                    Some(p) => return doc.get("assemblies").and_then(|a| a.get(p)).is_some(),
                }
            }
            false
        })
        .map(|(id, _)| id.clone())
        .collect();
    out.sort();
    out
}

/// The document as the marks module draws it: only the items that draw.
pub fn drawable(doc: &Value) -> Value {
    let keep: BTreeSet<String> = draws(doc).into_iter().collect();
    let mut out = doc.clone();
    if let Some(Value::Object(items)) = out.get_mut("items") {
        items.retain(|id, _| keep.contains(id));
    }
    out
}

/// The layer file of `layer`: its writer, its entry in `layers`, its items and the entries of
/// the other maps it holds, each map sorted by ID. Its SHA-256 names it.
pub fn layer_file(doc_id: &str, doc: &Value, owners: &Owners, layer: &str) -> Vec<u8> {
    let meta = doc
        .get("layers")
        .and_then(|l| l.get(layer))
        .cloned()
        .unwrap_or(Value::Null);
    let writer = meta
        .get("writer")
        .and_then(Value::as_str)
        .and_then(writer_of_text)
        .map_or(Value::Null, |w| w.to_json());
    let mut out = Map::new();
    out.insert("doc".into(), json!(doc_id));
    out.insert("layer".into(), json!(layer));
    out.insert("writer".into(), writer);
    out.insert("meta".into(), meta);
    let mut items: BTreeMap<&String, &Value> = BTreeMap::new();
    if let Some(Value::Object(all)) = doc.get("items") {
        for (id, item) in all {
            if item.get("layer").and_then(Value::as_str) == Some(layer) {
                items.insert(id, item);
            }
        }
    }
    out.insert("items".into(), json!(items));
    for map in ID_MAPS {
        let mut entries: BTreeMap<&String, &Value> = BTreeMap::new();
        if let Some(Value::Object(all)) = doc.get(*map) {
            for (id, entry) in all {
                if owners
                    .get(&(map.to_string(), id.clone()))
                    .map(String::as_str)
                    == Some(layer)
                {
                    entries.insert(id, entry);
                }
            }
        }
        if !entries.is_empty() {
            out.insert((*map).into(), json!(entries));
        }
    }
    serde_json::to_vec(&Value::Object(out)).expect("a layer file serializes")
}

/// Each layer's file hash.
pub fn files(doc_id: &str, doc: &Value, owners: &Owners) -> BTreeMap<String, String> {
    doc.get("layers")
        .and_then(Value::as_object)
        .map(|layers| {
            layers
                .keys()
                .map(|l| {
                    let sha = evidence::sha256_hex(&layer_file(doc_id, doc, owners, l));
                    (l.clone(), sha)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A ULID from `seed`: a zero time part and 80 bits of its hash, in Crockford's base 32.
pub fn ulid_of(seed: &str) -> String {
    const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let digest = Sha256::digest(seed.as_bytes());
    let mut out = String::from("0000000000");
    for b in &digest[..16] {
        out.push(CROCKFORD[(*b & 31) as usize] as char);
    }
    out
}

/// The key an issue is matched by across revisions: its code and IDs. The planted admission
/// that matches carried issues by code alone drops the IDs.
fn key(issue: &Issue, planted: Option<Planted>) -> (String, Vec<String>) {
    let ids = match planted {
        Some(Planted::MatchesCarriedByCode) => Vec::new(),
        _ => issue.ids.clone(),
    };
    (issue.code.to_string(), ids)
}

/// The errors of `issues` a writer's revision is refused for: ones the last good revision didn't
/// have that are the document's own or fall on an item it wrote or its layer holds. An error it
/// leaves on another writer's item, as a parent it deleted, goes to that writer instead. A
/// `module_missing` refuses every revision, had or not: this build can't check the document
/// (#305).
pub fn blocking(
    issues: &[Issue],
    last: &[Issue],
    doc: &Value,
    layer: &str,
    changed: &BTreeSet<String>,
    planted: Option<Planted>,
) -> Vec<Issue> {
    let had: BTreeSet<(String, Vec<String>)> = last.iter().map(|i| key(i, planted)).collect();
    let counts_every = planted == Some(Planted::CountsEveryIssue);
    let mine = |id: &String| {
        changed.contains(id)
            || doc
                .get("items")
                .and_then(|i| i.get(id))
                .and_then(|i| i.get("layer"))
                .and_then(Value::as_str)
                == Some(layer)
    };
    issues
        .iter()
        .filter(|i| {
            i.severity == "error"
                && (counts_every || i.code == "module_missing" || !had.contains(&key(i, planted)))
        })
        .filter(|i| i.ids.is_empty() || i.ids.iter().any(mine))
        .cloned()
        .collect()
}

/// The issues of `issues` the last good revision had too, matched by code and IDs, marked
/// carried: show-time admission returns them and refuses for none of them (Revision).
pub fn carried(issues: &[Issue], last: &[Issue], planted: Option<Planted>) -> Vec<Issue> {
    let had: BTreeSet<(String, Vec<String>)> = last.iter().map(|i| key(i, planted)).collect();
    issues
        .iter()
        .filter(|i| had.contains(&key(i, planted)))
        .map(|i| Issue {
            carried: true,
            ..i.clone()
        })
        .collect()
}

/// `not_your_layer` for each entry `layer` holds that writes a path of an item in another
/// writer's layer: a channel's, driver's, constraint's or bound value's target, or a placement's
/// slot (Writer layer: no other writer's channel, placement, driver, control or bound value
/// writes your item).
pub fn foreign_writes(doc: &Value, owners: &Owners, layer: &str) -> Vec<Issue> {
    let layer_of = |id: &str| {
        doc.get("items")
            .and_then(|i| i.get(id))
            .and_then(|i| i.get("layer"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let mut out = Vec::new();
    for ((map, id), owner) in owners {
        if owner != layer {
            continue;
        }
        let Some(entry) = doc.get(map.as_str()).and_then(|m| m.get(id)) else {
            continue;
        };
        let mut targets: Vec<(String, String)> = Vec::new();
        if let Some(text) = entry.get("target").and_then(Value::as_str) {
            if let Ok(path) = FieldPath::parse(text) {
                if path.section() == Section::Items {
                    targets.push((path.id().as_str().to_string(), format!("{map}/{id}/target")));
                }
            }
        }
        if let Some(Value::Object(slots)) = entry.get("slots").filter(|_| map == "placements") {
            for (slot, item) in slots {
                if let Some(item) = item.as_str() {
                    targets.push((item.to_string(), format!("{map}/{id}/slots/{slot}")));
                }
            }
        }
        for (item, path) in targets {
            if layer_of(&item).is_some_and(|l| l != layer) {
                out.push(Issue::error(
                    "not_your_layer",
                    id,
                    path,
                    json!(item),
                    "this entry writes a path of an item in another writer's layer",
                ));
            }
        }
    }
    out
}

/// The IDs whose items or entries differ between two documents.
pub fn changed_between(a: &Value, b: &Value) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for map in std::iter::once("items").chain(ID_MAPS.iter().copied()) {
        let (ma, mb) = (a[map].as_object(), b[map].as_object());
        let ids: BTreeSet<&String> = ma
            .into_iter()
            .flat_map(|m| m.keys())
            .chain(mb.into_iter().flat_map(|m| m.keys()))
            .collect();
        for id in ids {
            if ma.and_then(|m| m.get(id)) != mb.and_then(|m| m.get(id)) {
                out.insert(id.clone());
            }
        }
    }
    out
}

/// The writer a layer file names.
fn file_writer(file: &Value) -> Option<Writer> {
    let w = &file["writer"];
    writer_of_text(&format!("{}:{}", w["kind"].as_str()?, w["id"].as_str()?))
}

/// `doc` with layer `file["layer"]` as the file holds it.
fn take_layer(doc: &mut Value, owners: &mut Owners, file: &Value) {
    let Some(layer) = file["layer"].as_str() else {
        return;
    };
    if !file["meta"].is_null() {
        doc["layers"][layer] = file["meta"].clone();
    }
    if let Some(Value::Object(items)) = doc.get_mut("items") {
        items.retain(|_, i| i["layer"].as_str() != Some(layer));
        for (id, item) in file["items"].as_object().into_iter().flatten() {
            items.insert(id.clone(), item.clone());
        }
    }
    drop_owned(doc, owners, layer);
    for map in ID_MAPS {
        for (id, entry) in file[*map].as_object().into_iter().flatten() {
            if !doc[*map].is_object() {
                doc[*map] = json!({});
            }
            doc[*map][id] = entry.clone();
            owners.insert((map.to_string(), id.clone()), layer.to_string());
        }
    }
}

/// Every layer file in `root` with the time it was written.
fn layer_files(root: &Path) -> Vec<(std::time::SystemTime, Value)> {
    let mut out = Vec::new();
    for dir in fs::read_dir(root).into_iter().flatten().flatten() {
        for file in fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let (Ok(meta), Ok(bytes)) = (file.metadata(), fs::read(file.path())) else {
                continue;
            };
            if let (Ok(time), Ok(value)) = (meta.modified(), serde_json::from_slice(&bytes)) {
                out.push((time, value));
            }
        }
    }
    out
}

/// The record's writer for a call: the MCP session it came over, or the CLI.
fn recorded_by(via: &Via) -> String {
    match via {
        Via::Mcp(Some(s)) => format!("mcp:{s}"),
        _ => "cli".to_string(),
    }
}

mod calls;
pub use calls::*;

/// Whether two revisions wrote one path: the same item, and one path the other's or below it.
fn overlaps(a: &Paths, b: &Paths) -> bool {
    let under = |p: &str, q: &str| p.is_empty() || p == q || q.starts_with(&format!("{p}/"));
    a.iter().any(|(ia, pa)| {
        b.iter()
            .any(|(ib, pb)| ia == ib && (under(pa, pb) || under(pb, pa)))
    })
}

/// An undo of a revision whose items were `before` and whose paths were `paths`, in place: each
/// path put back as it was, so another writer's change to another path of the item stays. Every
/// item it writes must be in `layer`, the undoing writer's, unless the undo hands back an item
/// the revision took. Returns the patch a rollback can take back out, or why it's refused.
pub(crate) fn put_back(
    doc: &mut Value,
    before: &BTreeMap<String, Option<Value>>,
    paths: &Paths,
    layer: &str,
) -> Result<Patched, Box<Issue>> {
    let mut patched = Patched::default();
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return Ok(patched);
    };
    // Every item it writes, as the document holds it before the undo, first.
    for (id, path) in paths {
        let now = items.get(id);
        let owned = now.is_none_or(|i| i["layer"].as_str() == Some(layer));
        if !owned {
            let what = "the item is in another writer's layer now";
            let actual = now.map_or(Value::Null, |i| i["layer"].clone());
            return Err(Box::new(Issue::error(
                "not_your_layer",
                id,
                format!("items/{id}/layer"),
                actual,
                what,
            )));
        }
        if !path.is_empty() && now.is_none() {
            let what = "the item the undo would put back is gone";
            return Err(Box::new(Issue::error(
                "undo_conflict",
                id,
                format!("items/{id}"),
                Value::Null,
                what,
            )));
        }
    }
    for (id, path) in paths {
        let was = before.get(id).cloned().flatten();
        let now = items.get(id);
        patched
            .before
            .entry(id.clone())
            .or_insert_with(|| now.cloned());
        if path.is_empty() {
            match was {
                Some(item) => {
                    items.insert(id.clone(), item);
                }
                None => {
                    if let Some(at) = items.keys().position(|k| k == id) {
                        items.shift_remove(id);
                        patched.removed.push((id.clone(), at));
                    }
                }
            }
            continue;
        }
        let item = items
            .get_mut(id)
            .and_then(Value::as_object_mut)
            .expect("checked above");
        let old = |p: &str| {
            was.as_ref()
                .and_then(|w| w.pointer(&format!("/{p}")))
                .cloned()
        };
        match path.split_once('/') {
            Some((field, name)) => {
                let slot = item.entry(field).or_insert_with(|| json!({}));
                if let Some(map) = slot.as_object_mut() {
                    match old(path) {
                        Some(v) => map.insert(name.to_string(), v),
                        None => map.shift_remove(name),
                    };
                }
            }
            None => {
                match old(path) {
                    Some(v) => item.insert(path.clone(), v),
                    None => item.shift_remove(path),
                };
            }
        }
    }
    Ok(patched)
}

/// The items `doc`'s other maps read by path or slot, which a frame of a few items still needs.
fn referenced(doc: &Value) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for map in ID_MAPS {
        for entry in doc[*map].as_object().into_iter().flat_map(|m| m.values()) {
            if let Some(Ok(path)) = entry["target"].as_str().map(FieldPath::parse) {
                out.insert(path.id().as_str().to_string());
            }
            for slot in entry["slots"]
                .as_object()
                .into_iter()
                .flat_map(|s| s.values())
            {
                if let Some(id) = slot.as_str() {
                    out.insert(id.to_string());
                }
            }
        }
    }
    out
}

/// The marks module's frame over `items` in `doc`'s envelope: the vertices it draws (four for
/// each quad, a rect, circle, text or image; a path's tessellation; an outline's points), or why
/// it can't draw.
fn marks(doc: &Value, items: &Map<String, Value>, palette: &Palette) -> Result<i64, Refused> {
    let empty = Map::new();
    let envelope = doc.as_object().unwrap_or(&empty);
    let frame = scene::frame(envelope, items, palette, &Record::default(), 1.0)?;
    let bucket = deep_canvas_marks::path::bucket(1.0);
    Ok(frame
        .layers
        .iter()
        .flat_map(|l| &l.marks)
        .map(|drawn| match &drawn.mark {
            Mark::Path { geometry, .. } => geometry.tessellate(bucket).vertices.len() as i64,
            // An outline drawn from its verbs: its points.
            Mark::Shape { verbs, .. } => verbs
                .iter()
                .map(|v| match v {
                    Verb::Move(_) | Verb::Line(_) => 1,
                    Verb::Quad(..) => 2,
                    Verb::Cubic(..) => 3,
                    Verb::Close => 0,
                })
                .sum(),
            _ => 4,
        })
        .sum())
}

/// The marks module's check of the items a patch wrote, and what it changed in the cost model
/// (Patch: result). The items it wrote are drawn as they are now and as they were, beside what
/// they read (their ancestors, the items their params name, and those other maps target), so a
/// patch the module can't draw is refused as a whole revision is, unless the item couldn't be
/// drawn before either.
/// A 2D mark lights nothing, so `lights` is 0; `cpu_ms`, `gpu_ms` and `gpu_mb` are the cost
/// model's estimate (#379) of the items it wrote as they are now, less as they were, from the
/// build's coefficients.
fn marks_check(
    doc: &Value,
    before: &BTreeMap<String, Option<Value>>,
    palette: &Palette,
    sealed: &Sealed,
) -> Result<Value, Box<Issue>> {
    let draws_kind = |item: &Value| item["kind"].as_str().is_some_and(knows);
    let mut context = referenced(doc);
    let named = |item: &Value, out: &mut BTreeSet<String>| {
        let mut stack: Vec<&Value> = vec![&item["params"]];
        while let Some(v) = stack.pop() {
            match v {
                Value::String(s) if doc["items"].get(s).is_some() => {
                    out.insert(s.clone());
                }
                Value::Array(a) => stack.extend(a),
                Value::Object(o) => stack.extend(o.values()),
                _ => {}
            }
        }
    };
    let now_items: Map<String, Value> = before
        .keys()
        .filter_map(|id| Some((id.clone(), doc["items"].get(id)?.clone())))
        .filter(|(_, i)| draws_kind(i))
        .collect();
    let was_items: Map<String, Value> = before
        .iter()
        .filter_map(|(id, i)| Some((id.clone(), i.clone()?)))
        .filter(|(_, i)| draws_kind(i))
        .collect();
    for item in now_items.values().chain(was_items.values()) {
        named(item, &mut context);
        // Its ancestors, which a frame reads for what scopes it.
        let mut at = item["parent"].as_str();
        while let Some(p) =
            at.filter(|p| doc["items"].get(*p).is_some() && context.insert(p.to_string()))
        {
            at = doc["items"][p]["parent"].as_str();
        }
    }
    context.retain(|id| !before.contains_key(id));
    let with_context = |subset: &Map<String, Value>| {
        let mut out = subset.clone();
        for id in &context {
            if let Some(item) = doc["items"].get(id).filter(|i| draws_kind(i)) {
                out.insert(id.clone(), item.clone());
            }
        }
        out
    };
    let now = marks(doc, &with_context(&now_items), palette);
    let was = marks(doc, &with_context(&was_items), palette);
    let vertices = match (&now, &was) {
        (Ok(n), Ok(w)) => n - w,
        (Ok(n), Err(_)) => *n,
        (Err(e), Err(old)) if e == old => 0,
        (Err(Refused { code, path }), _) => return Err(Box::new(unfit_issue(code, path.clone()))),
    };
    let coefficients = &sealed.costs;
    let estimate = |items: Map<String, Value>| {
        // The document's envelope with only these items: the rest of its items never enter.
        let mut subset: Map<String, Value> = doc
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(k, _)| k.as_str() != "items")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        subset.insert("items".into(), Value::Object(items));
        deep_canvas::cost::estimate(&Value::Object(subset), sealed, coefficients)
    };
    let written = |at: &dyn Fn(&str) -> Option<Value>| -> Map<String, Value> {
        before
            .keys()
            .filter_map(|id| Some((id.clone(), at(id)?)))
            .collect()
    };
    let now_cost = estimate(written(&|id| doc["items"].get(id).cloned()));
    let was_cost = estimate(written(&|id| before[id].clone()));
    Ok(json!({
        "cpu_ms": now_cost.cpu_ms - was_cost.cpu_ms,
        "gpu_ms": now_cost.gpu_ms - was_cost.gpu_ms,
        "vertices": vertices,
        "lights": 0,
        "gpu_mb": now_cost.gpu_mb - was_cost.gpu_mb,
    }))
}

/// Drops every entry of an ID map that `layer` owns, from `doc` and from `owners`.
fn drop_owned(doc: &mut Value, owners: &mut Owners, layer: &str) {
    let held: Vec<(String, String)> = owners
        .iter()
        .filter(|(_, l)| l.as_str() == layer)
        .map(|(k, _)| k.clone())
        .collect();
    for (map, id) in held {
        if let Some(Value::Object(m)) = doc.get_mut(map.as_str()) {
            m.shift_remove(&id);
        }
        owners.remove(&(map, id));
    }
}

/// Rebuilds `shared` from the record in `state`: each event, in order, takes each layer from the
/// layer file it names, at its revision. The planted twin takes each layer's newest file instead.
fn restore(
    shared: &mut Shared,
    state: &Path,
    sealed: &Sealed,
    packs: &Packs,
    planted: Option<Planted>,
) {
    let Ok(text) = fs::read_to_string(state.join("record.jsonl")) else {
        return;
    };
    let subject = format!("doc:{}", shared.id);
    for line in text.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event = &entry["event"];
        if event["data"]["doc"].as_str() != Some(subject.as_str()) {
            continue;
        }
        let files: Vec<Value> = event["evidence"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|sha| sha.as_str())
            .filter_map(|sha| evidence::read(&state.join("layers"), sha))
            .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
            .collect();
        let prev = shared.doc.clone();
        let envelope_before = Some(shared.envelope());
        let mut writer = None;
        for file in &files {
            writer = writer.or_else(|| file_writer(file));
            take_layer(&mut shared.doc, &mut shared.owners, file);
        }
        let changed = changed_between(&prev, &shared.doc);
        let before: BTreeMap<String, Option<Value>> = changed
            .iter()
            .filter(|id| prev["items"].get(*id).is_some() || shared.doc["items"].get(*id).is_some())
            .map(|id| (id.clone(), prev["items"].get(id).cloned()))
            .collect();
        let paths = paths_of(&before, &shared.doc);
        let rev = shared.current().rev;
        let checked = check_packed(&shared.doc, sealed, packs);
        shared.revs.push(Rev {
            rev: event["data"]["rev"].as_u64().unwrap_or(rev + 1),
            base_rev: rev,
            writer,
            patch: event["data"]["patch"].as_str().map(str::to_string),
            reason: String::new(),
            changed,
            before,
            paths,
            envelope_before,
            issues: Rc::new(checked.issues),
            notices: OnceCell::from(checked.notices),
            hash: OnceCell::new(),
            current_at: None,
        });
    }
    if planted == Some(Planted::NewestLayerFileCurrent) {
        // The planted hub: each layer is the newest file written for it, named or not.
        let mut newest: BTreeMap<String, (std::time::SystemTime, Value)> = BTreeMap::new();
        for (time, file) in layer_files(&state.join("layers")) {
            if file["doc"].as_str() != Some(shared.id.as_str()) {
                continue;
            }
            let layer = file["layer"].as_str().unwrap_or_default().to_string();
            if newest.get(&layer).is_none_or(|(t, _)| time > *t) {
                newest.insert(layer, (time, file));
            }
        }
        for (_, file) in newest.values() {
            take_layer(&mut shared.doc, &mut shared.owners, file);
        }
    }
}
