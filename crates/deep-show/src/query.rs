//! `deep_query` (issue #411; the #411 acceptance README: deep_query): a revision's evaluated rows
//! and values by stable ID, with a coverage block; its summary; and the why behind one value.
//! `deep.canvas.read` is the same call made for a check plug-in, under its grant.
//!
//! A query evaluates its revision in a session of its own, so it reads exactly the revision it
//! names at the times it names, never the live session's frame. A value read through a handle
//! the reader may not read is `ref_unresolved`, never the value; an answer cut to its cap is cut
//! depth first, so every row it keeps has its parent, and its coverage block names the cut.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::document::{check_packed, Expansion};
use deep_canvas::schedule::core_ops::{Fields, Transform};
use deep_canvas::schedule::{default_view, Hasher, Key, Session as DocSession};
use deep_canvas::show::{Writer, WriterKind};
use deep_canvas_motion::program::{Program, Traced};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted, Via};

/// The rows an answer keeps when the call names no cap.
pub const DEFAULT_CAP: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum What {
    Rows,
    Summary,
    Why,
}

/// A check plug-in reading through `deep.canvas.read`: its package ID and the documents its
/// grant covers.
#[derive(Clone, Debug)]
pub struct Plugin {
    pub id: String,
    pub docs: Vec<String>,
}

#[derive(Clone)]
pub struct Query {
    pub via: Via,
    pub plugin: Option<Plugin>,
    pub doc: String,
    pub rev: Option<u64>,
    pub what: What,
    pub items: Option<Vec<String>>,
    pub paths: Vec<String>,
    /// Flicks, in the call's order.
    pub at: Vec<i64>,
    pub cap: usize,
    /// `expect: {none: {kind}}`: the kind the caller asks to conclude no row is of.
    pub none_of_kind: Option<String>,
    /// The why's path and time.
    pub path: Option<String>,
    pub t: i64,
}

/// One revision as a query reads it: the document as written, the form that draws, and the
/// recipe instances it expanded.
pub(crate) struct Revision {
    pub rev: u64,
    pub doc: Value,
    pub drawn: Value,
    pub expansions: Vec<Expansion>,
}

fn refused(code: &str) -> Value {
    json!({"code": code})
}

/// `items/<id>/<field…>` split at the item.
fn item_path(path: &str) -> Option<(&str, &str)> {
    path.strip_prefix("items/")?.split_once('/')
}

/// The JSON at a `/`-separated field path.
fn at_field<'v>(value: &'v Value, field: &str) -> Option<&'v Value> {
    field.split('/').try_fold(value, |v, part| match v {
        Value::Array(list) => list.get(part.parse::<usize>().ok()?),
        Value::Object(map) => map.get(part),
        _ => None,
    })
}

/// One key for a value several nodes made: the node's own key when one made it.
fn one_key(keys: &[Key], v: deep_canvas::schedule::HashVersion) -> Key {
    match keys {
        [k] => *k,
        many => {
            let mut h = Hasher::of(v, "deep_query.value");
            many.iter().for_each(|k| {
                h.key(k);
            });
            h.finish()
        }
    }
}

impl Hub<'_> {
    /// A `deep_query` call's reply.
    pub fn scene_query(&mut self, q: &Query) -> Value {
        let reader = match &q.plugin {
            Some(p) => Writer {
                kind: WriterKind::Plugin,
                id: p.id.clone(),
            },
            None => match self.writer(&q.via) {
                Some((w, _)) => w,
                None => return refused("no_session"),
            },
        };
        let Some(revision) = self.query_revision(&q.doc, q.rev) else {
            return refused("no_revision");
        };
        let rev = revision.rev;
        // A plug-in reads only the documents its grant covers: anything else is unresolved.
        if q.plugin
            .as_ref()
            .is_some_and(|p| !p.docs.iter().any(|d| d.eq_ignore_ascii_case(&q.doc)))
        {
            return outside_grant(q, rev);
        }
        let hidden = self.hidden_items(&revision.doc, &reader);
        match q.what {
            What::Summary => json!({"rev": rev, "summary": self.summary(&revision.doc)}),
            What::Why => {
                let Some(path) = q.path.as_deref() else {
                    return refused("bad_input");
                };
                if item_path(path).is_some_and(|(id, _)| hidden.contains_key(id)) {
                    return json!({"rev": rev, "code": "ref_unresolved", "path": path});
                }
                match self.why(&revision, path, q.t) {
                    Some(why) => json!({"rev": rev, "why": why}),
                    None => json!({"rev": rev, "code": "ref_unresolved", "path": path}),
                }
            }
            What::Rows => self.rows_reply(q, &revision, &hidden),
        }
    }

    /// The document and drawn form of `doc` at `rev` (its current revision without one).
    pub(crate) fn query_revision(&self, doc: &str, rev: Option<u64>) -> Option<Revision> {
        let (rev, document) = if let Some(shared) = self.shared.get(doc) {
            let k = match rev {
                Some(r) => shared.revs.iter().position(|x| x.rev == r)?,
                None => shared.revs.len() - 1,
            };
            (shared.revs[k].rev, shared.at(k).0.into_owned())
        } else {
            let rows = self.revisions.get(doc)?;
            let row = match rev {
                Some(r) => rows.iter().find(|x| x.rev == r && x.state != "refused")?,
                None => rows.iter().find(|x| x.state == "current")?,
            };
            (row.rev, row.doc.clone())
        };
        let result = check_packed(&document, &self.startup.sealed, &self.packs);
        let skipped = crate::verdict::unknown_items(&result.notices);
        let mut drawn = crate::verdict::without(
            &crate::packs::drawn(&document, &result.expansions),
            &skipped,
        );
        self.keep_instances(&document, &result.expansions, &mut drawn);
        Some(Revision {
            rev,
            doc: document,
            drawn,
            expansions: result.expansions,
        })
    }

    /// Puts each recipe instance back beside its derived items, its params filled with its
    /// recipe's defaults as the expansion filled them: a path into the instance, such as a driver's
    /// var or its own transform, then reads in the form the query evaluates.
    fn keep_instances(&self, doc: &Value, expansions: &[Expansion], drawn: &mut Value) {
        let mut issues = Vec::new();
        let resolved = deep_canvas::document::packs::resolve(
            doc,
            &self.packs,
            Some(&self.startup.sealed),
            &mut issues,
        );
        for e in expansions {
            let Some(mut item) = doc.get("items").and_then(|i| i.get(&e.instance)).cloned() else {
                continue;
            };
            if let (Some((_, recipe)), Some(map)) = (resolved.recipe(&e.kind), item.as_object_mut())
            {
                let params = map.entry("params").or_insert_with(|| json!({}));
                if let Some(params) = params.as_object_mut() {
                    for (name, input) in &recipe.inputs {
                        params
                            .entry(name.clone())
                            .or_insert_with(|| input.default.clone());
                    }
                }
            }
            if let Some(items) = drawn.get_mut("items").and_then(Value::as_object_mut) {
                items.insert(e.instance.clone(), item);
            }
        }
    }

    /// Each item a status binding or bound value writes from a handle `reader` can't read, with
    /// that handle: nothing read through it reaches the reader.
    fn hidden_items(&self, doc: &Value, reader: &Writer) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for map in ["status_bindings", "bound_values"] {
            for (_, b) in doc
                .get(map)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                let (Some(target), Some(source)) = (
                    b.get("target").and_then(Value::as_str),
                    b.get("source").and_then(Value::as_str),
                ) else {
                    continue;
                };
                if source.starts_with("doc:") || self.can_read(reader, source) {
                    continue;
                }
                if let Some((id, _)) = item_path(target) {
                    out.insert(id.to_string(), source.to_string());
                }
            }
        }
        out
    }

    /// The document's own counts by kind, writer layer and canvas module.
    fn summary(&self, doc: &Value) -> Value {
        let mut by_kind: BTreeMap<String, u64> = BTreeMap::new();
        let mut by_layer: BTreeMap<String, u64> = BTreeMap::new();
        let mut by_module: BTreeMap<String, u64> = BTreeMap::new();
        let items = doc.get("items").and_then(Value::as_object);
        for item in items.into_iter().flatten().map(|(_, i)| i) {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
            *by_kind.entry(kind.to_string()).or_default() += 1;
            let layer = item
                .get("layer")
                .and_then(Value::as_str)
                .unwrap_or_default();
            *by_layer.entry(layer.to_string()).or_default() += 1;
            *by_module.entry(self.module_of(kind)).or_default() += 1;
        }
        json!({"items": items.map_or(0, Map::len), "by_kind": by_kind, "by_layer": by_layer,
               "by_module": by_module})
    }

    /// The canvas module a kind is: the one that registers it, else marks2d for R1's kinds it
    /// draws without a registry entry, else `core`.
    pub fn module_of(&self, kind: &str) -> String {
        let sealed = &self.startup.sealed;
        let full = kind.split('@').next().unwrap_or(kind);
        if let Some(m) = sealed.module_of_kind(full) {
            return m.to_string();
        }
        let marks2d = sealed.modules.iter().any(|m| m.name == "marks2d");
        if marks2d && deep_canvas_marks::scene::KINDS.contains(&kind) {
            return "marks2d".into();
        }
        "core".into()
    }

    /// A fresh session holding `drawn`, evaluated at `t`.
    pub(crate) fn evaluated(&mut self, drawn: &Value, t: i64) -> DocSession {
        let mut session = self.new_session();
        session.load(&mut self.sched, drawn);
        let view = default_view(drawn);
        session.frame(&mut self.sched, t, &view);
        session
    }

    fn rows_reply(
        &mut self,
        q: &Query,
        revision: &Revision,
        hidden: &BTreeMap<String, String>,
    ) -> Value {
        let rev = revision.rev;
        let mut unresolved: Vec<Value> = Vec::new();
        // Values and keys, one per time, never cut.
        let times = if q.at.is_empty() {
            vec![0]
        } else {
            q.at.clone()
        };
        let mut values = Map::new();
        let mut keys = Map::new();
        let mut sessions: Vec<DocSession> = Vec::new();
        if !q.paths.is_empty() {
            for t in &times {
                let s = self.evaluated(&revision.drawn, *t);
                sessions.push(s);
            }
        }
        for path in &q.paths {
            let hidden_by = item_path(path).and_then(|(id, _)| hidden.get(id));
            let mut vs = Vec::new();
            let mut ks = Vec::new();
            for s in &sessions {
                let read = match hidden_by {
                    Some(_) => None,
                    None => self.read_path(s, &revision.doc, path),
                };
                match read {
                    Some((v, k)) => {
                        vs.push(v);
                        ks.push(json!(k.hex()));
                    }
                    None => {
                        vs.push(Value::Null);
                        ks.push(Value::Null);
                    }
                }
            }
            if hidden_by.is_some() || vs.iter().all(Value::is_null) {
                let mut entry = json!({"path": path, "code": "ref_unresolved"});
                if let Some(h) = hidden_by {
                    entry["handle"] = json!(h);
                }
                unresolved.push(entry);
            }
            values.insert(path.clone(), Value::Array(vs));
            keys.insert(path.clone(), Value::Array(ks));
        }

        // Rows by stable ID, each after its parent, cut depth first to the cap.
        let items = revision
            .doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let matched: BTreeSet<&str> = match &q.items {
            Some(ids) => ids
                .iter()
                .filter(|id| items.contains_key(*id))
                .map(String::as_str)
                .collect(),
            None => items.keys().map(String::as_str).collect(),
        };
        let parent_of =
            |id: &str| -> Option<&str> { items[id].get("parent").and_then(Value::as_str) };
        let mut children: BTreeMap<Option<&str>, Vec<&str>> = BTreeMap::new();
        for id in &matched {
            let p = parent_of(id).filter(|p| matched.contains(p));
            children.entry(p).or_default().push(id);
        }
        let mut order: Vec<&str> = Vec::with_capacity(matched.len());
        let mut stack: Vec<&str> = children.get(&None).cloned().unwrap_or_default();
        stack.reverse();
        while let Some(id) = stack.pop() {
            order.push(id);
            if let Some(kids) = children.get(&Some(id)) {
                stack.extend(kids.iter().rev());
            }
        }
        let kept: Vec<&str> = if self.scenario.planted == Some(Planted::CutsByRowOrder) {
            // The planted cut: the first `cap` items by ID, parents or not.
            matched.iter().take(q.cap).copied().collect()
        } else {
            order.iter().take(q.cap).copied().collect()
        };
        let row_session = if kept.is_empty() {
            None
        } else {
            Some(match sessions.first() {
                Some(_) => sessions.swap_remove(0),
                None => self.evaluated(&revision.drawn, times[0]),
            })
        };
        let lowered = row_session
            .as_ref()
            .map(|s| self.lowered_keys(s))
            .unwrap_or_default();
        let kept_set: BTreeSet<&str> = kept.iter().copied().collect();
        let mut rows = Vec::with_capacity(kept.len());
        for id in &kept {
            let item = &items[*id];
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
            let mut row = json!({
                "id": id,
                "parent": parent_of(id),
                "kind": kind,
                "layer": item.get("layer").cloned().unwrap_or(Value::Null),
                "module": self.module_of(kind),
                "key": lowered.get(*id).map(Key::hex),
                "children_total": children.get(&Some(*id)).map_or(0, Vec::len),
            });
            if let Some(h) = hidden.get(*id) {
                row["code"] = json!("ref_unresolved");
                unresolved.push(json!({"id": id, "code": "ref_unresolved", "handle": h}));
            }
            rows.push(row);
        }
        let mut cut = Vec::new();
        let top = children.get(&None).map_or(0, Vec::len);
        let shown_top = kept
            .iter()
            .filter(|id| parent_of(id).filter(|p| matched.contains(p)).is_none())
            .count();
        if shown_top < top {
            cut.push(json!({"parent": null, "shown": shown_top, "total": top}));
        }
        for id in &kept {
            let total = children.get(&Some(*id)).map_or(0, Vec::len);
            let shown = children
                .get(&Some(*id))
                .map_or(0, |k| k.iter().filter(|c| kept_set.contains(*c)).count());
            if shown < total {
                cut.push(json!({"parent": id, "shown": shown, "total": total}));
            }
        }
        let complete = cut.is_empty() && kept.len() == matched.len() && unresolved.is_empty();
        let mut reply = json!({
            "rev": rev,
            "rows": rows,
            "values": values,
            "keys": keys,
            "unresolved": unresolved,
            "coverage": {"complete": complete, "rows_total": matched.len(),
                         "rows_shown": kept.len(), "cut": cut},
        });
        if let Some(kind) = &q.none_of_kind {
            let found = kept
                .iter()
                .any(|id| items[*id].get("kind").and_then(Value::as_str) == Some(kind));
            if found || complete {
                reply["absent"] = json!(!found);
            } else {
                // The rows left out may hold one: absence can't be concluded from this answer.
                reply["code"] = json!("partial_result");
            }
        }
        reply
    }

    /// Each item's key in a session: its lowered form's node, which reads its canonical bytes.
    fn lowered_keys(&self, s: &DocSession) -> BTreeMap<String, Key> {
        let l = &self.sched;
        let mut out = BTreeMap::new();
        for (id, _) in s
            .document()
            .and_then(|d| d.get("items"))
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some((_, keys)) = s.read(l, "core.lowered", Some(id)) {
                out.insert(id.clone(), one_key(&keys, s.hash()));
            }
        }
        out
    }

    /// The evaluated value at `path` in an evaluated session, with the content key of what made
    /// it; `None` for a path the revision doesn't hold.
    fn read_path(&self, s: &DocSession, doc: &Value, path: &str) -> Option<(Value, Key)> {
        let (id, field) = item_path(path)?;
        if let Some(k) = field
            .strip_prefix("modifiers/")
            .and_then(|r| r.strip_suffix("#out"))
        {
            return self.prefix(s, id, k.parse().ok()?);
        }
        if let Some(read) = self.status_value(doc, path) {
            return read;
        }
        let (array, rest) = match field.strip_prefix("at/") {
            Some(rest) => ("core.transform", rest),
            None => ("core.fields", field),
        };
        let (val, keys) = s.read(&self.sched, array, Some(id))?;
        let value = match array {
            "core.transform" => {
                let t = val.as_typed::<Transform>()?;
                let at = json!({"pos": t.pos, "rot": t.rot, "scale": t.scale});
                at_field(&at, rest)?.clone()
            }
            _ => at_field(&val.as_typed::<Fields>()?.to_json(), rest)?.clone(),
        };
        Some((value, one_key(&keys, s.hash())))
    }

    /// A status binding's value at its target: the state its source holds and the color the
    /// look gives it. `None` for a path no binding writes; `Some(None)` for one whose source the
    /// record doesn't hold.
    fn status_value(&self, doc: &Value, path: &str) -> Option<Option<(Value, Key)>> {
        let bindings = doc.get("status_bindings").and_then(Value::as_object)?;
        let source = bindings
            .values()
            .find(|b| b.get("target").and_then(Value::as_str) == Some(path))?
            .get("source")
            .and_then(Value::as_str)?;
        let Some(state) = self
            .scenario
            .record
            .get(source)
            .and_then(|o| o.state.as_deref())
        else {
            return Some(None);
        };
        let color = self
            .look
            .status
            .as_ref()
            .and_then(|s| s.colors.get(state))
            .map(|[r, g, b]| format!("#{r:02x}{g:02x}{b:02x}"));
        let key = Hasher::of(self.sched.hash(), "deep_query.status")
            .text(source)
            .text(state)
            .finish();
        Some(Some((json!({"status": state, "color": color}), key)))
    }

    /// `items/<id>/modifiers/<k>#out`: the stack's result after modifier k, from its prefix cache.
    fn prefix(&self, s: &DocSession, id: &str, k: usize) -> Option<(Value, Key)> {
        let (val, _) = s.read(&self.sched, "scene3d.stack", Some(id))?;
        let stack = val.as_typed::<deep_canvas_scene3d::modifiers::Stack>()?;
        let k = if self.scenario.planted == Some(Planted::PrefixReadsFinal) {
            stack.prefixes.len().checked_sub(1)?
        } else {
            k
        };
        let p = stack.prefixes.get(k)?;
        Some((p.to_json(), p.key))
    }

    /// The why for the value at `path` at `t`: every write to it in evaluation order, the canvas
    /// module and operator whose write stands with its reads, and the document fields and recipe
    /// defaults it traces to.
    fn why(&mut self, revision: &Revision, path: &str, t: i64) -> Option<Value> {
        let (id, field) = item_path(path)?;
        let session = self.evaluated(&revision.drawn, t);
        let (value, _) = self.read_path(&session, &revision.doc, path)?;
        let traced = self.traced(&revision.drawn, id, field, t);
        let operator = |key: &str| {
            self.startup
                .sealed
                .ops
                .iter()
                .find(|o| o.key == key)
                .map(|o| (format!("{}@{}", o.module, o.version), o.op.reads.clone()))
        };
        let (module, op_name, reads, read_paths): (
            String,
            String,
            Vec<String>,
            Vec<(String, f64)>,
        ) = match traced.last() {
            Some(w) => {
                let (m, r) = operator(&format!("motion.{}", w.operator))?;
                (m, w.operator.to_string(), r, w.reads.clone())
            }
            None => {
                let name = if field.starts_with("at/") {
                    "transform"
                } else {
                    "fields"
                };
                let (m, r) = operator(&format!("core.{name}"))?;
                let own = value
                    .as_f64()
                    .map(|v| vec![(path.to_string(), v)])
                    .unwrap_or_default();
                (m, name.to_string(), r, own)
            }
        };
        let mut writes: Vec<Value> = Vec::new();
        for (i, w) in traced.iter().enumerate() {
            let (m, _) = operator(&format!("motion.{}", w.operator))?;
            let mut row = json!({"entry": w.entry, "module": m, "operator": w.operator,
                                 "value": w.value, "status": "stands"});
            if let Some(next) = traced.get(i + 1) {
                row["status"] = json!(if next.limit {
                    "clamped_by"
                } else {
                    "overwritten_by"
                });
                row["by"] = json!({"entry": next.entry, "module": m, "operator": next.operator});
            }
            writes.push(row);
        }
        if self.scenario.planted == Some(Planted::WhyNamesKeyOnly) {
            writes.truncate(1);
            if let Some(w) = writes.first_mut() {
                w["status"] = json!("stands");
                w.as_object_mut().map(|o| o.remove("by"));
            }
        }
        // Each read the standing write made, nearest first: a field the document holds is a
        // source; one a recipe's input filled with its default names that recipe and default.
        let mut sources = Vec::new();
        let mut defaults = Vec::new();
        for (p, v) in &read_paths {
            if let Some(held) = held_at(&revision.doc, p) {
                sources.push(json!({"path": p, "value": held}));
            } else if let Some(d) = default_of(&revision.expansions, p, *v) {
                defaults.push(d);
            }
        }
        if self.scenario.planted == Some(Planted::WhyNamesOperatorOnly) {
            sources.clear();
            defaults.clear();
        }
        Some(json!({
            "path": path, "t": t, "value": value, "module": module, "operator": op_name,
            "reads": reads, "writes": writes, "sources": sources, "defaults": defaults,
        }))
    }

    /// Motion's writes to `field` of item `id` at `t`, in evaluation order.
    fn traced(&self, drawn: &Value, id: &str, field: &str, t: i64) -> Vec<Traced> {
        let Ok(canonical) =
            deep_canvas::canon::canonical_value(drawn, &deep_canvas::canon::NoShape)
        else {
            return Vec::new();
        };
        let Some(doc) = canonical.as_object() else {
            return Vec::new();
        };
        let Ok(program) = Program::compile(doc) else {
            return Vec::new();
        };
        let field: Vec<String> = field.split('/').map(str::to_string).collect();
        match program.slot_of(id, &field) {
            Some(slot) => program.trace(t, slot),
            None => Vec::new(),
        }
    }
}

/// The value the document as written holds at a path.
fn held_at(doc: &Value, path: &str) -> Option<Value> {
    at_field(doc, path).filter(|v| !v.is_null()).cloned()
}

/// A recipe default a read took: the read's path is an instance's param its document leaves out.
fn default_of(expansions: &[Expansion], path: &str, value: f64) -> Option<Value> {
    let (id, field) = item_path(path)?;
    let input = field.strip_prefix("params/")?;
    let e = expansions.iter().find(|e| e.instance == id)?;
    Some(json!({"recipe": e.kind, "pack": e.pack, "input": input, "value": value}))
}

/// A read of a document the plug-in's grant doesn't cover: every path unresolved, no value.
fn outside_grant(q: &Query, rev: u64) -> Value {
    let times = q.at.len().max(1);
    let nulls = Value::Array(vec![Value::Null; times]);
    let values: Map<String, Value> = q.paths.iter().map(|p| (p.clone(), nulls.clone())).collect();
    let unresolved: Vec<Value> = q
        .paths
        .iter()
        .map(|p| json!({"path": p, "code": "ref_unresolved"}))
        .collect();
    json!({"rev": rev, "rows": [], "values": values, "keys": values.clone(),
           "unresolved": unresolved,
           "coverage": {"complete": false, "rows_total": 0, "rows_shown": 0, "cut": []}})
}
