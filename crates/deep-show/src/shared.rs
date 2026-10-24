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

use deep_canvas::document::{
    apply_ops, canonical_in, check_in, recheck, rollback, store_migrations, touched_in, Issue,
    Patched, Writing, ID_MAPS,
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
use crate::hub::{diff_reply, Body, Call, Hub, PatchCall, Planted, Show, Via};
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
    pub refresh_hz: i64,
    pub lead: i64,
    pub check: i64,
}

impl Clock {
    /// The first latch at or after `t`.
    pub fn latch_from(&self, t: i64) -> i64 {
        let period = FLICKS / self.refresh_hz;
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

/// Whether this build knows a kind: the marks module draws it, or the kernel registers it.
pub fn knows(kind: &str) -> bool {
    deep_canvas_marks::scene::KINDS.contains(&kind)
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
                    Some(_) => return false,
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

/// The key an issue is matched by across revisions: its code and IDs.
fn key(issue: &Issue) -> (String, Vec<String>) {
    (issue.code.to_string(), issue.ids.clone())
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
) -> Vec<Issue> {
    let had: BTreeSet<(String, Vec<String>)> = last.iter().map(key).collect();
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
        .filter(|i| i.severity == "error" && (i.code == "module_missing" || !had.contains(&key(i))))
        .filter(|i| i.ids.is_empty() || i.ids.iter().any(mine))
        .cloned()
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

impl Hub<'_> {
    /// Opens every shared document: from the state folder's record when it has one (a restart),
    /// else at revision 0, the stored document.
    pub fn open_shared(&mut self) {
        for (id, seed) in &self.scenario.seeds {
            let mut doc = seed.clone();
            if let Some(fields) = doc.as_object_mut() {
                fields.insert("id".into(), json!(id.to_ascii_lowercase()));
            }
            let issues = check_in(&doc, &self.startup.sealed).issues;
            let mut shared = Shared {
                id: id.clone(),
                doc,
                owners: Owners::new(),
                revs: vec![Rev {
                    rev: 0,
                    base_rev: 0,
                    writer: None,
                    patch: None,
                    reason: String::new(),
                    changed: BTreeSet::new(),
                    before: BTreeMap::new(),
                    paths: Paths::new(),
                    envelope_before: None,
                    issues: Rc::new(issues),
                    hash: OnceCell::new(),
                    current_at: None,
                }],
                lost: BTreeMap::new(),
                older: BTreeSet::new(),
            };
            if let Some(state) = &self.scenario.state {
                restore(
                    &mut shared,
                    state,
                    &self.startup.sealed,
                    self.scenario.planted,
                );
            }
            shared.find_older();
            self.shared.insert(id.clone(), shared);
        }
    }

    /// The index of the revision a read shows: the newest one current at the hub's time.
    pub fn shown(&self, doc: &str) -> Option<usize> {
        let shared = self.shared.get(doc)?;
        shared
            .revs
            .iter()
            .rposition(|r| r.current_at.is_none_or(|t| t <= self.now))
    }

    /// The writer a call acts as, and the session it acts for.
    fn acting(&self, via: &Via) -> Option<(Writer, Option<String>)> {
        let (writer, _) = self.writer(via)?;
        let session = self.session_of(via, &writer);
        Some((writer, session))
    }

    /// `lost` for this writer on this document, reported once.
    fn take_lost(&mut self, doc: &str, writer: &Writer, reply: &mut Map<String, Value>) {
        let lost = self
            .shared
            .get_mut(doc)
            .and_then(|s| s.lost.remove(&writer.text()))
            .unwrap_or_default();
        if !lost.is_empty() {
            reply.insert("lost".into(), json!(lost));
        }
    }

    /// A patch or an undo, checked at `checked` (the clock's time, else 0) after arriving at
    /// `arrived`: its reply, the Patch result.
    pub fn patch(&mut self, call: &PatchCall, arrived: Option<i64>, checked: i64) -> Value {
        let mut reply = Map::new();
        let outcome = self.check_patch(call, checked, &mut reply);
        let current_rev = self.shared.get(&call.doc).map_or(0, |s| s.current().rev);
        let zero = json!({"created": {}, "updated": 0, "deleted": {}, "unchanged": true});
        let (name, rev, achieved, undo, issues, ids, current) = match outcome {
            Outcome::Applied(a) => {
                let Applied {
                    rev,
                    achieved,
                    cost,
                    undo,
                    ids,
                    current_at,
                } = *a;
                reply.insert("cost_delta".into(), cost);
                ("applied", rev, achieved, undo, Vec::new(), ids, current_at)
            }
            Outcome::Refused(issues) => (
                "refused",
                current_rev,
                zero,
                Vec::new(),
                issues,
                Map::new(),
                None,
            ),
            Outcome::Conflict { ids, writers } => {
                let writers: Vec<Value> = writers.iter().map(Writer::to_json).collect();
                reply.insert("conflict".into(), json!({"ids": ids, "writers": writers}));
                let issue = Issue {
                    ids: ids.clone(),
                    ..Issue::envelope(
                        "stale_base",
                        "base".into(),
                        json!(ids),
                        "another writer changed what this patch touches since its base",
                    )
                };
                let none = Map::new();
                (
                    "conflict",
                    current_rev,
                    zero,
                    Vec::new(),
                    vec![issue],
                    none,
                    None,
                )
            }
        };
        reply.insert("outcome".into(), json!(name));
        reply.insert("rev".into(), json!(rev));
        reply.insert("ids".into(), Value::Object(ids));
        reply.insert("achieved".into(), achieved);
        // Errors first, inlined up to the read cap, with `truncated` when cut.
        let mut issues: Vec<Value> = issues.iter().map(Issue::to_json).collect();
        order_issues(&mut issues);
        let shown = inline_count(&issues);
        if shown < issues.len() {
            reply.insert("truncated".into(), truncated(&issues, shown));
        }
        issues.truncate(shown);
        reply.insert("issues".into(), json!(issues));
        // Nothing applied changes nothing.
        if !reply.contains_key("cost_delta") {
            let none = json!({"cpu_ms": 0, "gpu_ms": 0, "vertices": 0, "lights": 0, "gpu_mb": 0});
            reply.insert("cost_delta".into(), none);
        }
        reply.insert("undo".into(), json!(undo));
        if let Some(arrived) = arrived {
            reply.insert("arrived".into(), json!(arrived));
            reply.insert("checked".into(), json!(checked));
            reply.insert("current".into(), json!(current));
        }
        Value::Object(reply)
    }

    fn check_patch(
        &mut self,
        call: &PatchCall,
        checked: i64,
        reply: &mut Map<String, Value>,
    ) -> Outcome {
        let refused = |code: &'static str, path: &str, what: &str| {
            Outcome::Refused(vec![Issue::envelope(code, path.into(), Value::Null, what)])
        };
        let Some((writer, session)) = self.acting(&call.via) else {
            return refused("ref_unresolved", "session", "the call binds to no session");
        };
        if !self.shared.contains_key(&call.doc) {
            return refused("ref_unresolved", "doc", "no shared document has this ID");
        }
        self.take_lost(&call.doc, &writer, reply);
        // A writer's quota: patches applied in the second before this check, the bytes a message
        // carries and the documents it writes; the items its layer holds are counted below.
        let quota = session
            .as_ref()
            .and_then(|s| self.scenario.quotas.get(s))
            .copied()
            .unwrap_or_default();
        if let Some(cap) = quota.patches_per_s {
            let times = self.applied_at.entry(writer.text()).or_default();
            times.retain(|t| *t > checked - FLICKS);
            if times.len() >= cap as usize {
                let what = "this writer's patches a second are spent";
                return refused("over_quota", "patch", what);
            }
        }
        if let (Some(cap), Body::Patch(p)) = (quota.msg_bytes, &call.body) {
            let bytes = serde_json::to_vec(p).map_or(usize::MAX, |b| b.len());
            if bytes > cap as usize {
                let what = format!(
                    "the patch is {bytes} bytes; this writer's messages carry at most {cap}"
                );
                return refused("too_large", "patch", &what);
            }
        }
        let written = self.written.get(&writer.text());
        if let Some(cap) = quota.docs {
            let count = written.map_or(0, |w| w.len());
            if !written.is_some_and(|w| w.contains(&call.doc)) && count >= cap as usize {
                let what = format!("this writer writes at most {cap} shared documents");
                return refused("over_quota", "doc", &what);
            }
        }
        let shared = &self.shared[&call.doc];
        let cur = shared.current().rev;
        let (patch, base, undoing) = match &call.body {
            Body::Patch(p) => (p.clone(), p["base"].as_u64().unwrap_or(cur), None),
            Body::Undo { patch, of } => {
                let Some(target) = shared
                    .revs
                    .iter()
                    .position(|r| r.patch.as_deref() == Some(of))
                else {
                    return refused(
                        "ref_unresolved",
                        "undo/of",
                        "no revision applied this patch",
                    );
                };
                let t = &shared.revs[target];
                // An agent can't undo your change, and nobody undoes over another writer's.
                if t.writer.as_ref() != Some(&writer) {
                    let what = "an undo is by the writer whose change it undoes";
                    return refused("undo_conflict", "undo/of", what);
                }
                if shared.revs[target + 1..]
                    .iter()
                    .any(|r| r.writer.as_ref() != Some(&writer) && overlaps(&r.paths, &t.paths))
                {
                    let what = "another writer changed what this undo would put back";
                    return refused("undo_conflict", "undo/of", what);
                }
                let p = json!({"patch": patch, "doc": call.doc, "base": cur,
                               "reason": format!("undo {of}"), "ops": []});
                (p, cur, Some(target))
            }
        };
        if base > cur {
            return refused("stale_base", "base", "no such revision yet");
        }
        // A stale base rebases when no ID the patch touches changed since; otherwise it's a
        // conflict naming both writers. (The planted path-granular rebase merges a patch whose
        // paths no later revision wrote, as computed on its base.)
        let mut base_doc = None;
        let mut path_merge: Option<Value> = None;
        if base < cur && undoing.is_none() {
            let targets_only = self.scenario.planted == Some(Planted::RebaseCountsOpTargetsOnly);
            let (base_items, _) = shared.at(base as usize);
            let touches = touched_in(&patch, &base_items, targets_only);
            let mut ids = BTreeSet::new();
            let mut writers = vec![writer.clone()];
            for r in &shared.revs[base as usize + 1..] {
                let hit: Vec<&String> = r.changed.intersection(&touches).collect();
                if !hit.is_empty() {
                    ids.extend(hit.into_iter().cloned());
                    if let Some(w) = r.writer.as_ref().filter(|w| !writers.contains(w)) {
                        writers.push(w.clone());
                    }
                }
            }
            if !ids.is_empty() {
                let by_path = self.scenario.planted == Some(Planted::RebaseByPath)
                    && written_paths(&patch).is_some_and(|written| {
                        !shared.revs[base as usize + 1..].iter().any(|r| {
                            r.paths
                                .iter()
                                .any(|p| p.1.is_empty() || written.contains(p))
                        })
                    });
                if !by_path {
                    let ids = ids.into_iter().collect();
                    return Outcome::Conflict { ids, writers };
                }
                path_merge = Some(shared.at(base as usize).0.into_owned());
            }
            // A reorder's key falls between its neighbors as the patch's base had them.
            let reorders = patch["ops"]
                .as_array()
                .is_some_and(|ops| ops.iter().any(|o| o["op"] == "reorder"));
            if reorders {
                base_doc = Some(shared.at(base as usize).0.into_owned());
            }
        }

        // The writer's layer, added when it has none: a change to the envelope, so the whole
        // document is checked again.
        let layer_text = writer.text();
        let found = layer_of(&shared.doc, &writer);
        let added = found.is_none().then(|| shared.envelope());
        let layer = match found {
            Some(l) => l,
            None => {
                let mut doc =
                    std::mem::take(&mut self.shared.get_mut(&call.doc).expect("open").doc);
                let l = self.add_layer(&mut doc, &writer);
                self.shared.get_mut(&call.doc).expect("open").doc = doc;
                l
            }
        };
        let shared = self.shared.get_mut(&call.doc).expect("open");
        let take_back = |shared: &mut Shared, patched: &Patched| {
            rollback(&mut shared.doc, patched);
            if let Some((fields, owners)) = &added {
                let items = shared.doc["items"].take();
                shared.doc = Value::Object(fields.clone());
                shared.doc["items"] = items;
                shared.owners = owners.clone();
            }
        };
        let applied = match undoing {
            Some(target) => {
                let t = &shared.revs[target];
                put_back(&mut shared.doc, &t.before, &t.paths, &layer)
            }
            None => {
                // The build knows the kinds its canvas modules register, too.
                let kinds = self.startup.sealed.kinds();
                let known = |kind: &str| {
                    knows(kind) || !matches!(lookup(&kinds, kind), Lookup::UnknownKind)
                };
                let writing = Writing {
                    layer: &layer,
                    writer: &layer_text,
                    you: writer.kind == WriterKind::You,
                    base: base_doc.as_ref(),
                    knows: &known,
                };
                match path_merge.take() {
                    Some(mut on_base) => {
                        match apply_ops(&mut on_base, &patch, "patch", &call.doc, &writing) {
                            Ok(_) => Ok(merge_paths(&mut shared.doc, &on_base, &patch)),
                            Err(e) => Err(e),
                        }
                    }
                    None => apply_ops(&mut shared.doc, &patch, "patch", &call.doc, &writing),
                }
            }
        };
        let mut patched = match applied {
            Ok(p) => p,
            Err(issue) => {
                take_back(shared, &Patched::default());
                return Outcome::Refused(vec![*issue]);
            }
        };
        let changed = patched.changed(&shared.doc);
        let last = Rc::clone(&shared.current().issues);
        // Re-checked incrementally where the patch reached only items; else in full.
        let issues = if added.is_some() {
            None
        } else {
            recheck(&shared.doc, &last, &changed, &self.startup.sealed)
        }
        .unwrap_or_else(|| check_in(&shared.doc, &self.startup.sealed).issues);
        // An undo may put back an issue the revision it undoes was made on already held.
        let mut allowed = (*last).clone();
        if let Some(t) = undoing.filter(|t| *t > 0) {
            allowed.extend(shared.revs[t - 1].issues.iter().cloned());
        }
        let refusals = blocking(&issues, &allowed, &shared.doc, &layer, &changed);
        if !refusals.is_empty() {
            take_back(shared, &patched);
            return Outcome::Refused(refusals);
        }
        // The marks module checks what the patch wrote, and counts what it costs.
        let cost = match marks_check(&shared.doc, &patched.before, &self.look.light) {
            Ok(cost) => cost,
            Err(issue) => {
                take_back(shared, &patched);
                return Outcome::Refused(vec![*issue]);
            }
        };
        if let Some(cap) = quota.items {
            let mine =
                |i: Option<&Value>| i.is_some_and(|i| i["layer"].as_str() == Some(layer.as_str()));
            let now = shared.doc["items"]
                .as_object()
                .map_or(0, |i| i.values().filter(|v| mine(Some(v))).count());
            // What the patch added to the layer: what it created or took, less what it deleted.
            let added: i64 = patched
                .before
                .iter()
                .map(|(id, was)| {
                    i64::from(mine(shared.doc["items"].get(id))) - i64::from(mine(was.as_ref()))
                })
                .sum();
            if now > cap as usize && added > 0 {
                take_back(shared, &patched);
                let what =
                    format!("this writer's layer would hold {now} items; its quota is {cap}");
                return refused("over_quota", "items", &what);
            }
        }
        let achieved = patched.achieved(&shared.doc);
        let (undo, ids) = (patched.undo(&shared.doc), patched.ids.clone());
        // A dry run returns what the commit would, and commits nothing.
        if patch.get("dry_run") == Some(&json!(true)) {
            take_back(shared, &patched);
            reply.insert("dry_run".into(), json!(true));
            return Outcome::Applied(Box::new(Applied {
                rev: cur,
                achieved,
                cost,
                undo: Vec::new(),
                ids,
                current_at: None,
            }));
        }
        if shared.older.contains(&layer) {
            for (id, was) in store_migrations(&mut shared.doc, &layer) {
                patched.before.entry(id).or_insert(Some(was));
            }
        }
        let patch_id = patch["patch"].as_str().unwrap_or_default().to_string();
        let current_at = self.scenario.clock.map(|c| c.latch_from(checked));
        let next = Rev {
            rev: cur + 1,
            base_rev: base,
            writer: Some(writer.clone()),
            patch: Some(patch_id.clone()),
            reason: patch["reason"].as_str().unwrap_or_default().to_string(),
            changed,
            paths: paths_of(&patched.before, &shared.doc),
            before: patched.before.clone(),
            envelope_before: added.clone(),
            issues: Rc::new(issues),
            hash: OnceCell::new(),
            current_at,
        };
        if self.commit(&call.doc, next, session, &recorded_by(&call.via), &achieved) {
            // The writer's layer holds no older major now: this patch migrated it.
            let shared = self.shared.get_mut(&call.doc).expect("open");
            shared.older.remove(&layer);
            self.applied_at
                .entry(writer.text())
                .or_default()
                .push(checked);
            self.written
                .entry(writer.text())
                .or_default()
                .insert(call.doc.clone());
        } else {
            // Acknowledged as applied here, and never current: the writer hears on its next call.
            let shared = self.shared.get_mut(&call.doc).expect("open");
            take_back(shared, &patched);
            shared.lost.entry(writer.text()).or_default().push(patch_id);
        }
        Outcome::Applied(Box::new(Applied {
            rev: cur + 1,
            achieved,
            cost,
            undo,
            ids,
            current_at,
        }))
    }

    /// A layer for `writer` in `doc`, after every other: its ID from the writer, titled with the
    /// agent's name.
    pub fn add_layer(&self, doc: &mut Value, writer: &Writer) -> String {
        let id = writer.layer_id();
        let last = doc["layers"]
            .as_object()
            .and_then(|l| l.values().filter_map(|v| v["order"].as_str()).max())
            .map(str::to_string);
        let seed = writer.text();
        let order = deep_canvas::document::key_between(last.as_deref(), None, seed.as_bytes())
            .unwrap_or_else(|| "z".into());
        let title = self.agent_name(writer).unwrap_or_else(|| "You".into());
        if !doc["layers"].is_object() {
            doc["layers"] = json!({});
        }
        doc["layers"][&id] = json!({"writer": writer.text(), "title": title, "order": order});
        id
    }

    /// Commits `next`, already applied to the document: each layer it changed written to its
    /// file by hash, then its `doc.patched` event appended, which makes it current. False when a
    /// layer file couldn't be written: the revision never becomes current, nothing of it is
    /// recorded, and the caller takes it back out.
    fn commit(
        &mut self,
        doc: &str,
        next: Rev,
        session: Option<String>,
        recorded_by: &str,
        achieved: &Value,
    ) -> bool {
        let patch = next.patch.clone().unwrap_or_default();
        let fault = self.scenario.commit_fault.as_ref();
        if fault == Some(&CommitFault::LayerFileFails(patch.clone())) {
            return false;
        }
        let shared = &self.shared[doc];
        if let Some(state) = &self.scenario.state {
            // The layers it changed: its items' layers before and after, and every layer whose
            // entry in `layers` or whose other entries it changed.
            let mut layers: BTreeSet<String> = BTreeSet::new();
            for id in &next.changed {
                let now = shared.doc["items"][id]["layer"].as_str();
                let was = next.before.get(id).and_then(|w| w.as_ref());
                for l in [now, was.and_then(|w| w["layer"].as_str())]
                    .into_iter()
                    .flatten()
                {
                    layers.insert(l.to_string());
                }
            }
            if let Some((fields, owners)) = &next.envelope_before {
                for (id, l) in shared.doc["layers"].as_object().into_iter().flatten() {
                    if fields.get("layers").and_then(|ls| ls.get(id)) != Some(l) {
                        layers.insert(id.clone());
                    }
                }
                for (k, l) in owners.iter().chain(shared.owners.iter()) {
                    if owners.get(k) != shared.owners.get(k) {
                        layers.insert(l.clone());
                    }
                }
            }
            let mut written = Vec::new();
            for layer in &layers {
                let bytes = layer_file(doc, &shared.doc, &shared.owners, layer);
                match evidence::put(&state.join("layers"), &bytes) {
                    Ok(sha) => written.push(sha),
                    Err(_) => return false,
                }
            }
            if fault == Some(&CommitFault::KillAfterLayerFile(patch.clone())) {
                // As SIGKILL would: no answer, nothing after.
                std::process::abort();
            }
            let record = state.join("record.jsonl");
            let log_pos = fs::read_to_string(&record).map_or(0, |t| t.lines().count()) + 1;
            let writer = next.writer.as_ref().expect("a commit has a writer");
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64);
            let event = json!({
                "v": 1,
                "id": ulid_of(&format!("{doc}|{}|{patch}", next.rev)),
                "kind": "doc.patched",
                "subject": format!("doc:{doc}"),
                "writer": recorded_by,
                "actor": "you",
                "scope": "you",
                "ts": ts,
                "log_pos": log_pos,
                "data": {
                    "doc": format!("doc:{doc}"),
                    "rev": next.rev,
                    "patch": patch,
                    "writer": writer.kind.name(),
                    "achieved": achieved,
                },
                "evidence": written,
            });
            let line = json!({"log_pos": log_pos, "session": session, "event": event});
            let appended = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&record)
                .and_then(|mut f| writeln!(f, "{line}"));
            if appended.is_err() {
                return false;
            }
        }
        self.shared
            .get_mut(doc)
            .expect("committed to an open document")
            .revs
            .push(next);
        true
    }

    /// A whole revision of a shared document: the writer's layer replaced by the payload's items
    /// and entries, diffed against what that layer held, so another writer's entries never count
    /// as removed and stay as they are.
    pub fn show_shared(&mut self, show: &Show) -> Value {
        let refused =
            |code: &str| json!({"outcome": "refused", "code": code, "issues": [], "snapshots": []});
        let Some((writer, session)) = self.acting(&show.via) else {
            return refused("no_session");
        };
        let Some(panel) = self
            .scenario
            .docs
            .get(&show.doc)
            .and_then(|p| self.scenario.panels.get(p))
        else {
            return refused("ref_unresolved");
        };
        let mut reply = Map::new();
        self.take_lost(&show.doc, &writer, &mut reply);
        let shared = &self.shared[&show.doc];
        let cur = shared.current().rev;
        let last = Rc::clone(&shared.current().issues);
        let (was_doc, was_owners) = (&shared.doc, &shared.owners);
        let mut doc = was_doc.clone();
        let mut owners = was_owners.clone();
        let layer = match layer_of(&doc, &writer) {
            Some(l) => l,
            None => self.add_layer(&mut doc, &writer),
        };

        // The payload: the layer and its writer come from the connection, never from it.
        let mut issues = Vec::new();
        let claimed = "the layer and its writer come from the connection, never the payload";
        let payload = show.document.as_object().cloned().unwrap_or_default();
        if let Some(source) = doc.get("source") {
            let what = "a view of the record is rebuilt from the record, never written";
            issues.push(Issue::envelope(
                "record_view",
                "source".into(),
                source.clone(),
                what,
            ));
        }
        // The writer's quota: the bytes its message carries, the documents it writes and the
        // items its layer would hold.
        let quota = session
            .as_ref()
            .and_then(|s| self.scenario.quotas.get(s))
            .copied()
            .unwrap_or_default();
        let bytes = serde_json::to_vec(&show.document).map_or(usize::MAX, |b| b.len());
        if quota.msg_bytes.is_some_and(|cap| bytes > cap as usize) {
            let what = "the revision is larger than this writer's messages may be";
            issues.push(Issue::envelope(
                "too_large",
                String::new(),
                json!(bytes),
                what,
            ));
        }
        let written = self.written.get(&writer.text());
        let new_doc = !written.is_some_and(|w| w.contains(&show.doc));
        if quota
            .docs
            .is_some_and(|cap| new_doc && written.map_or(0, |w| w.len()) >= cap as usize)
        {
            let what = "this writer writes no more shared documents";
            issues.push(Issue::envelope(
                "over_quota",
                "doc".into(),
                json!(show.doc),
                what,
            ));
        }
        let count = payload
            .get("items")
            .and_then(Value::as_object)
            .map_or(0, Map::len);
        if quota.items.is_some_and(|cap| count > cap as usize) {
            let what = "this writer's layer would hold more items than its quota";
            issues.push(Issue::envelope(
                "over_quota",
                "items".into(),
                json!(count),
                what,
            ));
        }
        for key in ["layers", "writer"] {
            if let Some(v) = payload.get(key) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    key.into(),
                    v.clone(),
                    claimed,
                ));
            }
        }
        // The writer's layer, emptied, then filled with the payload's entries.
        if let Some(Value::Object(items)) = doc.get_mut("items") {
            items.retain(|_, i| i["layer"].as_str() != Some(layer.as_str()));
        }
        drop_owned(&mut doc, &mut owners, &layer);
        let mut view = Map::new();
        let empty = Map::new();
        for map in std::iter::once("items").chain(ID_MAPS.iter().copied()) {
            let mut stamped = Map::new();
            for (id, entry) in payload
                .get(map)
                .and_then(Value::as_object)
                .unwrap_or(&empty)
            {
                let mut entry = entry.clone();
                if map == "items" {
                    if let Some(l) = entry.get("layer") {
                        let path = format!("items/{id}/layer");
                        issues.push(Issue::error("unknown_field", id, path, l.clone(), claimed));
                    }
                    entry["layer"] = json!(layer);
                }
                if doc[map].get(id).is_some() {
                    let what = "another writer's layer holds this ID";
                    let path = format!("{map}/{id}");
                    issues.push(Issue::error("not_your_layer", id, path, json!(id), what));
                    continue;
                }
                if !doc[map].is_object() {
                    doc[map] = json!({});
                }
                doc[map][id] = entry.clone();
                if map != "items" {
                    owners.insert((map.to_string(), id.clone()), layer.clone());
                }
                stamped.insert(id.clone(), entry);
            }
            view.insert(map.to_string(), Value::Object(stamped));
        }

        // Diffed against what the writer's layer held; the planted twin against everything.
        let whole = self.scenario.planted == Some(Planted::DiffsWholeDocument);
        let held_by = |map: &str, id: &str, entry: &Value| {
            whole
                || if map == "items" {
                    entry["layer"].as_str() == Some(layer.as_str())
                } else {
                    was_owners.get(&(map.to_string(), id.to_string())) == Some(&layer)
                }
        };
        let view = Value::Object(view);
        let diff = whole_diff_by(
            Some(was_doc),
            &view,
            &held_by,
            &|_, _, _| true,
            &show.removes,
        );
        let diff = match diff {
            Ok(diff) => Some(diff),
            Err(missing) => {
                issues.extend(missing);
                None
            }
        };
        let changed = changed_between(was_doc, &doc);
        let result = check_in(&doc, &self.startup.sealed);
        issues.extend(blocking(&result.issues, &last, &doc, &layer, &changed));
        issues.extend(foreign_writes(&doc, &owners, &layer));
        let mine = |id: &String| {
            ["bound_values", "status_bindings"]
                .iter()
                .any(|m| owners.get(&(m.to_string(), id.clone())) == Some(&layer))
        };
        let unreadable = unreadable_handles(&doc, |h| self.can_read(&writer, h));
        issues.extend(unreadable.into_iter().filter(|i| i.ids.iter().any(mine)));
        let mut drawn = None;
        if !issues.iter().any(|i| i.severity == "error") {
            let shown = drawable(&doc);
            match self.renderer.prepare(
                shown.as_object().expect("a document is an object"),
                show.t,
                &self.look.light,
                self.look.status.as_ref(),
                &self.record(),
                &self.scenario.evidence,
            ) {
                Ok(d) => drawn = Some(d),
                Err(Unfit { code, path }) => issues.push(unfit_issue(code, path)),
            }
        }
        reply.insert("rev".into(), json!(cur));
        if self.issue_reply(&issues, &mut reply) {
            reply.insert("outcome".into(), json!("refused"));
            if show.check {
                reply.insert("result".into(), json!("FAIL"));
            }
            return Value::Object(reply);
        }

        // Committed: the document becomes this revision.
        let shared = self.shared.get_mut(&show.doc).expect("open");
        let before = changed
            .iter()
            .filter(|id| shared.doc["items"].get(*id).is_some() || doc["items"].get(*id).is_some())
            .map(|id| (id.clone(), shared.doc["items"].get(id).cloned()))
            .collect();
        let patched = Patched {
            before,
            ..Patched::default()
        };
        let achieved = patched.achieved(&doc);
        let paths = paths_of(&patched.before, &doc);
        let envelope_before = Some(shared.envelope());
        let was = (
            std::mem::replace(&mut shared.doc, doc),
            std::mem::replace(&mut shared.owners, owners),
        );
        let rev = cur + 1;
        let next = Rev {
            rev,
            base_rev: cur,
            writer: Some(writer.clone()),
            patch: Some(ulid_of(&format!("{}|{rev}|whole", show.doc))),
            reason: "whole revision".into(),
            changed,
            before: patched.before,
            paths,
            envelope_before,
            issues: Rc::new(result.issues),
            hash: OnceCell::new(),
            current_at: None,
        };
        if !self.commit(&show.doc, next, session, &recorded_by(&show.via), &achieved) {
            let shared = self.shared.get_mut(&show.doc).expect("open");
            (shared.doc, shared.owners) = was;
            reply.insert("outcome".into(), json!("refused"));
            return Value::Object(reply);
        }
        self.written
            .entry(writer.text())
            .or_default()
            .insert(show.doc.clone());
        self.shared.get_mut(&show.doc).expect("open").find_older();
        reply.insert("rev".into(), json!(rev));
        if let Some(diff) = diff {
            diff_reply(diff, &mut reply);
        }
        let visible = panel.visible;
        self.present(show, visible, drawn.as_ref(), reply)
    }

    /// `read`: the revision shown, as the reader sees it.
    pub fn read(&mut self, doc: &str, via: Option<&Via>) -> Value {
        let reader = via.and_then(|v| self.acting(v)).map(|(w, _)| w);
        let (Some(k), Some(shared)) = (self.shown(doc), self.shared.get(doc)) else {
            return json!({"outcome": "refused", "code": "ref_unresolved"});
        };
        let (shown, owners) = shared.at(k);
        let layer = reader.as_ref().and_then(|w| layer_of(&shown, w));
        let in_layer = |id: &String| shown["items"][id]["layer"].as_str() == layer.as_deref();
        let issues: Vec<Value> = shared.revs[k]
            .issues
            .iter()
            .filter(|i| reader.is_none() || i.ids.iter().any(in_layer))
            .map(Issue::to_json)
            .collect();
        let mut reply = Map::new();
        reply.insert("rev".into(), json!(shared.revs[k].rev));
        reply.insert("hash".into(), json!(shared.hash(k, &self.startup.sealed)));
        reply.insert("draws".into(), json!(draws(&shown)));
        reply.insert("issues".into(), json!(issues));
        reply.insert("files".into(), json!(files(doc, &shown, &owners)));
        reply.insert("document".into(), shown.into_owned());
        if let Some(w) = reader {
            self.take_lost(doc, &w, &mut reply);
        }
        Value::Object(reply)
    }

    /// `history`: every revision that changed the item, in order.
    pub fn history(&self, doc: &str, item: &str) -> Value {
        let rows: Vec<Value> = self
            .shared
            .get(doc)
            .into_iter()
            .flat_map(|s| s.revs.iter())
            .filter(|r| r.changed.contains(item))
            .map(|r| {
                let writer = r.writer.as_ref().map(Writer::to_json);
                json!({"rev": r.rev, "patch": r.patch, "writer": writer, "reason": r.reason})
            })
            .collect();
        json!({"history": rows})
    }

    /// `by_writer`: each layer's writer, the items it holds now and the patches its writer
    /// applied, in order.
    pub fn by_writer(&self, doc: &str) -> Value {
        let (Some(k), Some(shared)) = (self.shown(doc), self.shared.get(doc)) else {
            return json!({"writers": []});
        };
        let (shown, _) = shared.at(k);
        let mut rows = Vec::new();
        for (layer, entry) in shown["layers"].as_object().into_iter().flatten() {
            let Some(writer) = entry["writer"].as_str().and_then(writer_of_text) else {
                continue;
            };
            let mut items: Vec<&String> = shown["items"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, i)| i["layer"].as_str() == Some(layer.as_str()))
                .map(|(id, _)| id)
                .collect();
            items.sort();
            let patches: Vec<&String> = shared.revs[..=k]
                .iter()
                .filter(|r| r.writer.as_ref() == Some(&writer))
                .filter_map(|r| r.patch.as_ref())
                .collect();
            rows.push(json!({"writer": writer.to_json(), "layer": layer, "items": items, "patches": patches}));
        }
        json!({"writers": rows})
    }

    /// `revisions` of a shared document: every committed revision, the newest current.
    pub fn shared_revisions(&self, doc: &str) -> Value {
        let shared = &self.shared[doc];
        let last = shared.current().rev;
        let rows: Vec<Value> = shared
            .revs
            .iter()
            .enumerate()
            .map(|(k, r)| {
                json!({
                    "rev": r.rev,
                    "base_rev": r.base_rev,
                    "writer": r.writer.as_ref().map(Writer::to_json),
                    "hash": shared.hash(k, &self.startup.sealed),
                    "state": if r.rev == last { "current" } else { "superseded" },
                    "patches": r.patch.iter().collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({"revisions": rows})
    }

    /// Runs the scenario's calls, one reply each in call order. On the clock, calls arrive at
    /// their `at`; each writer's patches wait in its own queue, and one checker takes them in
    /// turn across writers, one at a time, so one writer's flood never delays another's patch.
    pub fn run_calls(&mut self) -> Vec<Value> {
        self.open_shared();
        let calls = &self.scenario.calls;
        let Some(clock) = self.scenario.clock else {
            return calls.iter().map(|c| self.call(c)).collect();
        };
        let mut replies = vec![Value::Null; calls.len()];
        let mut order: Vec<usize> = (0..calls.len()).collect();
        order.sort_by_key(|i| (self.scenario.at[*i], *i));
        let fifo = self.scenario.planted == Some(Planted::OneFifoCheckQueue);
        let mut queues: Vec<(String, VecDeque<usize>)> = Vec::new();
        let mut turn = 0usize;
        let mut free_at = 0i64;
        let mut next = 0usize;
        loop {
            let queued = queues.iter().any(|(_, q)| !q.is_empty());
            let arrival = order.get(next).map(|i| self.scenario.at[*i]);
            match arrival {
                // What arrives by the time the checker is free is queued before it takes one.
                Some(at) if !queued || at <= free_at => {
                    let i = order[next];
                    next += 1;
                    self.now = at;
                    let Call::Patch(p) = &calls[i] else {
                        replies[i] = self.call(&calls[i]);
                        continue;
                    };
                    let key = match (fifo, self.acting(&p.via)) {
                        (true, _) => String::new(),
                        (false, Some((w, _))) => w.text(),
                        (false, None) => {
                            replies[i] = self.patch(p, Some(at), at);
                            continue;
                        }
                    };
                    // A coalesce key keeps only the latest value: a waiting patch of this writer's
                    // with the same key is superseded by this one.
                    if let Some(c) = coalesce_key(p) {
                        let writer = self.acting(&p.via).map(|(w, _)| w.text());
                        for (_, q) in &mut queues {
                            let same = |j: &usize| match &calls[*j] {
                                Call::Patch(o) => {
                                    coalesce_key(o) == Some(c)
                                        && self.acting(&o.via).map(|(w, _)| w.text()) == writer
                                }
                                _ => false,
                            };
                            if let Some(k) = q.iter().position(same) {
                                let j = q.remove(k).expect("found");
                                let Call::Patch(o) = &calls[j] else { continue };
                                replies[j] = self.superseded(o, self.scenario.at[j], None, p);
                            }
                        }
                    }
                    let queued = queues.iter().any(|(_, q)| !q.is_empty());
                    if !queued {
                        free_at = free_at.max(at);
                    }
                    match queues.iter_mut().find(|(k, _)| *k == key) {
                        Some((_, q)) => q.push_back(i),
                        None => queues.push((key, VecDeque::from([i]))),
                    }
                }
                _ if queued => {
                    // The next writer in turn with a patch waiting.
                    let n = queues.len();
                    let w = (1..=n)
                        .map(|k| (turn + k) % n)
                        .find(|w| !queues[*w].1.is_empty())
                        .expect("a queue holds a patch");
                    turn = w;
                    let i = queues[w].1.pop_front().expect("not empty");
                    free_at += clock.check;
                    self.now = free_at;
                    let Call::Patch(p) = &calls[i] else {
                        unreachable!("only patches are queued")
                    };
                    replies[i] = self.patch(p, Some(self.scenario.at[i]), free_at);
                    // Over its quota with a coalesce key, a patch whose key a later patch of its
                    // writer's carries is superseded by that one instead.
                    let over = replies[i]["issues"]
                        .as_array()
                        .is_some_and(|l| l.iter().any(|x| x["code"] == "over_quota"));
                    if let (true, Some(c)) = (over, coalesce_key(p)) {
                        let writer = self.acting(&p.via).map(|(w, _)| w.text());
                        let later = queues.iter().flat_map(|(_, q)| q.iter()).find(|j| {
                            matches!(&calls[**j], Call::Patch(o) if coalesce_key(o) == Some(c)
                                && self.acting(&o.via).map(|(w, _)| w.text()) == writer)
                        });
                        if let Some(Call::Patch(o)) = later.map(|j| &calls[*j]) {
                            replies[i] = self.superseded(p, self.scenario.at[i], Some(free_at), o);
                        }
                    }
                }
                _ => break,
            }
        }
        // A patch reply the queue built itself, or a superseded one, skipped `call`'s stamp.
        for reply in &mut replies {
            self.stamp(reply);
        }
        replies
    }
}

/// The `(ID, path)` pairs a patch's ops write, the path below the item; `None` when an op writes
/// a whole item (a create, delete, move or reorder).
fn written_paths(patch: &Value) -> Option<Paths> {
    let mut out = Paths::new();
    for op in patch["ops"].as_array()? {
        let (Some("set" | "unset"), Some(id), Some(path)) =
            (op["op"].as_str(), op["id"].as_str(), op["path"].as_str())
        else {
            return None;
        };
        let rest = path.strip_prefix(&format!("items/{id}/"))?;
        out.insert((id.to_string(), rest.to_string()));
    }
    Some(out)
}

/// The planted path-granular rebase's merge: each path the patch wrote on its base, set to what
/// it holds there in the current document.
fn merge_paths(doc: &mut Value, on_base: &Value, patch: &Value) -> Patched {
    let mut done = Patched::default();
    for (id, path) in written_paths(patch).unwrap_or_default() {
        let before = doc["items"].get(&id).cloned();
        done.before.entry(id.clone()).or_insert(before);
        let parts: Vec<&str> = path.split('/').collect();
        let mut from = &on_base["items"][&id];
        for p in &parts {
            from = &from[*p];
        }
        let value = from.clone();
        let Some((last, head)) = parts.split_last() else {
            continue;
        };
        let mut at = &mut doc["items"][&id];
        for p in head {
            at = &mut at[*p];
        }
        match (value.is_null(), at.as_object_mut()) {
            (true, Some(map)) => {
                map.shift_remove(*last);
            }
            (false, _) => at[*last] = value,
            _ => {}
        }
    }
    done
}

/// A patch's coalesce key.
fn coalesce_key(call: &PatchCall) -> Option<&str> {
    match &call.body {
        Body::Patch(p) => p["coalesce_key"].as_str(),
        Body::Undo { .. } => None,
    }
}

impl Hub<'_> {
    /// The reply of a patch a later one with its coalesce key superseded: nothing applied, and
    /// the patch that carries its value.
    fn superseded(
        &self,
        call: &PatchCall,
        arrived: i64,
        checked: Option<i64>,
        by: &PatchCall,
    ) -> Value {
        let rev = self.shared.get(&call.doc).map_or(0, |s| s.current().rev);
        let by = match &by.body {
            Body::Patch(p) => p["patch"].clone(),
            Body::Undo { patch, .. } => json!(patch),
        };
        json!({
            "outcome": "superseded",
            "rev": rev,
            "superseded_by": by,
            "ids": {},
            "achieved": {"created": {}, "updated": 0, "deleted": {}, "unchanged": true},
            "issues": [],
            "cost_delta": {"cpu_ms": 0, "gpu_ms": 0, "vertices": 0, "lights": 0, "gpu_mb": 0},
            "undo": [],
            "arrived": arrived,
            "checked": checked,
            "current": null,
        })
    }
}

/// The paths a revision wrote, as `(ID, path)`: `""` for an item it created or deleted, else
/// each field of the item it changed, and each member of `params` and `at` (Patch: an undo is
/// refused if another writer has touched those paths since).
pub fn paths_of(before: &BTreeMap<String, Option<Value>>, doc: &Value) -> Paths {
    let mut out = Paths::new();
    for (id, was) in before {
        match (was, doc["items"].get(id)) {
            (Some(Value::Object(a)), Some(Value::Object(b))) => {
                let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
                for k in keys.into_iter().filter(|k| a.get(*k) != b.get(*k)) {
                    match (a.get(k), b.get(k)) {
                        (Some(Value::Object(x)), Some(Value::Object(y)))
                            if k == "params" || k == "at" =>
                        {
                            let members: BTreeSet<&String> = x.keys().chain(y.keys()).collect();
                            for m in members.into_iter().filter(|m| x.get(*m) != y.get(*m)) {
                                out.insert((id.clone(), format!("{k}/{m}")));
                            }
                        }
                        _ => {
                            out.insert((id.clone(), k.clone()));
                        }
                    }
                }
            }
            (a, b) if a.as_ref() != b => {
                out.insert((id.clone(), String::new()));
            }
            _ => {}
        }
    }
    out
}

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
/// A 2D mark lights nothing, so `lights` is 0; this build has no time or memory model for 2D
/// marks yet, so `cpu_ms`, `gpu_ms` and `gpu_mb` read 0 until the meter's cost model (#379) lands.
fn marks_check(
    doc: &Value,
    before: &BTreeMap<String, Option<Value>>,
    palette: &Palette,
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
    Ok(json!({"cpu_ms": 0, "gpu_ms": 0, "vertices": vertices, "lights": 0, "gpu_mb": 0}))
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
fn restore(shared: &mut Shared, state: &Path, sealed: &Sealed, planted: Option<Planted>) {
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
            issues: Rc::new(check_in(&shared.doc, sealed).issues),
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
