//! Documents the hub minted (issue #1721; canvas primitives: Patch, Revision, Writer layer): one
//! with no stored document is a shared document from its first revision, whoever writes it. Its
//! revisions are the hub's rows, as a whole revision leaves them, so every call on a deep_show
//! document reads what a patch made. What #96 holds beside them, who wrote what and what each
//! revision changed, is brought up to the newest row when a patch, a `read` or a history asks. A
//! document's revisions in the record (`doc.patched`) open it again after a restart.

use super::*;
use crate::hub::Row;
use deep_canvas::document::packs::Expansion;

/// A document's revision as the record holds it.
#[derive(Clone, Debug)]
pub struct Recorded {
    rev: u64,
    writer: Writer,
    patch: Option<String>,
    hash: String,
    /// The canonical document the evidence store keeps by `hash`; `None` when its bytes are gone
    /// or don't hash to it.
    doc: Option<Value>,
}

/// A world's documents as a release stored them, `docs.<id>.document` (#96).
pub fn seeds(input: &Map<String, Value>) -> Option<BTreeMap<String, Value>> {
    let seeds = crate::entries(input, "docs", |d| Some(d.get("document").cloned()))?;
    Some(
        seeds
            .into_iter()
            .filter_map(|(id, s)| Some((id, s?)))
            .collect(),
    )
}

/// A world's documents as the record holds them, `docs.<id>.recorded`: each revision `{rev, writer:
/// "kind:id", patch, hash}`, its canonical document read from the evidence store.
pub fn recorded(input: &Map<String, Value>) -> Option<BTreeMap<String, Vec<Recorded>>> {
    let evidence = Path::new(input.get("evidence")?.as_str()?);
    let read = |r: &Value| {
        let hash = r["hash"].as_str()?.to_string();
        Some(Recorded {
            rev: r["rev"].as_u64().filter(|n| *n > 0)?,
            writer: writer_of_text(r["writer"].as_str()?)?,
            patch: r["patch"].as_str().map(str::to_string),
            doc: evidence::read(evidence, &hash).and_then(|b| serde_json::from_slice(&b).ok()),
            hash,
        })
    };
    let docs = crate::entries(input, "docs", |d| match d.get("recorded") {
        None => Some(Vec::new()),
        Some(list) => list.as_array()?.iter().map(read).collect(),
    })?;
    Some(docs.into_iter().filter(|(_, r)| !r.is_empty()).collect())
}

/// What a writer's whole revision of a document with other writers' layers is checked against.
pub(crate) struct Beside {
    layer: String,
    was: Owners,
    owners: Owners,
    last: Rc<Vec<Issue>>,
}

impl Beside {
    /// `next` against `current`, by what the writer's layer holds in each.
    pub(crate) fn diff(
        &self,
        current: Option<&Value>,
        next: &Value,
        removes: &[String],
    ) -> Result<deep_canvas::show::Diff, Vec<Issue>> {
        let held = |owners: &Owners, map: &str, id: &str, entry: &Value| match map {
            "items" => entry["layer"].as_str() == Some(self.layer.as_str()),
            _ => owners.get(&(map.to_string(), id.to_string())) == Some(&self.layer),
        };
        let was = |map: &str, id: &str, entry: &Value| held(&self.was, map, id, entry);
        let now = |map: &str, id: &str, entry: &Value| held(&self.owners, map, id, entry);
        whole_diff_by(current, next, &was, &now, removes)
    }

    /// Marks carried each error of `issues` the revision isn't refused for, and adds what its layer
    /// writes of another's.
    pub(crate) fn carry(
        &self,
        issues: &mut Vec<Issue>,
        current: &Value,
        next: &Value,
        planted: Option<Planted>,
    ) {
        let changed = changed_between(current, next);
        for i in issues.iter_mut().filter(|i| i.severity == "error") {
            let one = std::slice::from_ref(&*i);
            i.carried = blocking(one, &self.last, next, &self.layer, &changed, planted).is_empty();
        }
        issues.extend(foreign_writes(next, &self.owners, &self.layer));
    }
}

/// The items of `doc` that hide: those an error of `issues` names, which the revision wasn't
/// refused for, and what hangs from them (Writer layer).
pub(crate) fn hidden(doc: &Value, issues: &[Issue]) -> Vec<String> {
    let errors = issues.iter().filter(|i| i.severity == "error");
    let mut out: BTreeSet<String> = errors.flat_map(|i| i.ids.iter().cloned()).collect();
    let mut named = 0;
    while named < out.len() {
        named = out.len();
        for (id, item) in doc["items"].as_object().into_iter().flatten() {
            if item["parent"].as_str().is_some_and(|p| out.contains(p)) {
                out.insert(id.clone());
            }
        }
    }
    out.into_iter().collect()
}

/// A patch to `layer` that moves an arranged item from where `prev` had it breaks it out of its
/// arrangement, as a whole revision does (#1732): the arrangement is an item the patch changed.
pub(super) fn break_outs(prev: &Value, doc: &mut Value, layer: &str, patched: &mut Patched) {
    let items = doc["items"].as_object().into_iter().flatten();
    let mine = items.filter(|(_, i)| i["layer"].as_str() == Some(layer));
    let before: Vec<(String, Value)> = mine
        .filter(|(_, i)| deep_canvas_motion::arrange::is_arrangement(i))
        .map(|(id, i)| (id.clone(), i.clone()))
        .collect();
    if before.is_empty() {
        return;
    }
    let mut broken = doc.clone();
    deep_canvas_motion::arrange::carry_break_outs(Some(prev), &mut broken);
    for (id, was) in before {
        let now = broken["items"][&id].take();
        if now != was {
            doc["items"][&id] = now;
            patched.before.entry(id).or_insert(Some(was));
        }
    }
}

impl Shared {
    /// A minted document before its first revision: nothing in it, at revision 0.
    fn minted(id: &str) -> Shared {
        let mut shared = Shared::open(id, json!({"items": {}}), Vec::new(), Vec::new());
        shared.numbers = Some(0);
        shared
    }

    /// The number the next revision takes: past one a refused whole revision took.
    pub(super) fn next_rev(&self) -> u64 {
        self.numbers.unwrap_or(0).max(self.current().rev) + 1
    }

    /// Adds `rev`, so a revision sits at its number: one that changed nothing stands for each
    /// number a refused whole revision took.
    pub(super) fn push(&mut self, rev: Rev) {
        while self.numbers.is_some() && (self.revs.len() as u64) < rev.rev {
            let last = self.current();
            let skipped = Rev::of(self.revs.len() as u64, last.rev, Rc::clone(&last.issues));
            self.revs.push(skipped);
        }
        self.revs.push(rev);
    }

    /// Takes a row made without a patch here: a whole revision, or one the record holds. Each entry
    /// it changed is in its writer's layer.
    fn take(&mut self, row: &Row, issues: Vec<Issue>) {
        let layer = row.writer.layer_id();
        let envelope_before = Some(self.envelope());
        let prev = std::mem::replace(&mut self.doc, row.doc.clone());
        let changed = changed_between(&prev, &self.doc);
        for (map, id) in ID_MAPS
            .iter()
            .flat_map(|m| changed.iter().map(move |id| (*m, id)))
        {
            let key = (map.to_string(), id.clone());
            match self.doc[map].get(id) {
                None => drop(self.owners.remove(&key)),
                now if now != prev[map].get(id) => drop(self.owners.insert(key, layer.clone())),
                _ => {}
            }
        }
        let item = |doc: &Value, id: &str| doc["items"].get(id).cloned();
        let before: BTreeMap<String, Option<Value>> = changed
            .iter()
            .filter(|id| item(&prev, id).is_some() || item(&self.doc, id).is_some())
            .map(|id| (id.clone(), item(&prev, id)))
            .collect();
        let whole = || ulid_of(&format!("{}|{}|whole", self.id, row.rev));
        let rev = Rev {
            writer: Some(row.writer.clone()),
            patch: Some(row.patch.clone().unwrap_or_else(whole)),
            reason: match row.patch {
                Some(_) => String::new(),
                None => "whole revision".into(),
            },
            paths: paths_of(&before, &self.doc),
            changed,
            before,
            envelope_before,
            ..Rev::of(row.rev, row.base_rev, Rc::new(issues))
        };
        self.push(rev);
    }
}

impl Hub<'_> {
    /// Opens each document the record holds at its newest revision, the earlier ones superseded,
    /// from the first one after any whose bytes are gone. One whose newest bytes are gone stays
    /// shut, and every call on it says so.
    pub(super) fn open_recorded(&mut self) {
        let scenario = self.scenario;
        for (id, revs) in scenario.recorded.iter() {
            let from = revs
                .iter()
                .rposition(|r| r.doc.is_none())
                .map_or(0, |k| k + 1);
            for (k, r) in revs.iter().enumerate().skip(from) {
                let row = Row {
                    rev: r.rev,
                    base_rev: k.checked_sub(1).map_or(0, |b| revs[b].rev),
                    writer: r.writer.clone(),
                    patch: r.patch.clone(),
                    hash: r.hash.clone(),
                    state: "current",
                    doc: r.doc.clone().expect("read from the store"),
                };
                let seen = self.shown_at.entry(id.clone()).or_default();
                seen.push((0, r.rev));
                self.push_row(id, row);
            }
            if from == revs.len() {
                self.unread.insert(id.clone(), revs[from - 1].hash.clone());
            } else {
                let doc = revs[revs.len() - 1].doc.as_ref();
                self.take_look(doc.expect("read from the store"));
                self.asleep.insert(id.clone());
            }
        }
    }

    /// Why no call on `doc` is answered: a restart stopped it, or the bytes of its newest recorded
    /// revision are gone.
    pub(crate) fn unread_issue(&self, doc: &str) -> Option<Issue> {
        // #1412: a document a restart stopped answers with why.
        if let Some(issue) = self.shared.get(doc).and_then(|s| s.stopped.clone()) {
            return Some(issue);
        }
        let hash = self.unread.get(doc)?;
        let what = "the evidence store doesn't hold the document's newest recorded revision";
        let issue = Issue::envelope("asset_missing", "doc".into(), json!(hash), what);
        Some(issue)
    }

    /// Before `call`: a document opened from the record that it may draw becomes its session's
    /// current one, the first time one does, so a call that draws none of it pays nothing for it.
    pub(crate) fn wake(&mut self, call: &Call) {
        if self.asleep.is_empty() {
            return;
        }
        let reads = matches!(
            call,
            Call::Show(_)
                | Call::Patch(_)
                | Call::Read { .. }
                | Call::History { .. }
                | Call::ByWriter(_)
                | Call::Revisions(_)
                | Call::Kinds(_)
                | Call::Packs
        );
        if reads {
            return;
        }
        let named = crate::states::session_call(call).map(|(doc, _)| doc);
        let asleep = self.asleep.iter();
        let ids = asleep.filter(|id| named.is_none_or(|n| n == id.as_str()));
        for id in ids.cloned().collect::<Vec<_>>() {
            let Some(doc) = self.current(&id).map(|r| r.doc.clone()) else {
                continue;
            };
            let checked = check_packed(&doc, &self.startup.sealed, &self.packs);
            let skipped = crate::verdict::unknown_items(&checked.notices);
            let (form, _) = self.form_of(&id, &doc, &checked.expansions, skipped, &checked.issues);
            self.expansions.insert(id.clone(), checked.expansions);
            self.make_current(&id, form, 0);
        }
    }

    /// The form `doc` draws from, as a whole revision's admission makes it, and what that found:
    /// less `skipped` and the items that hide.
    pub(super) fn form_of(
        &mut self,
        id: &str,
        doc: &Value,
        expansions: &[Expansion],
        mut skipped: Vec<String>,
        issues: &[Issue],
    ) -> (Value, Vec<Issue>) {
        skipped.extend(hidden(doc, issues));
        let mut found = crate::frames::overflows(doc);
        found.extend(self.sandbox.provide(&self.startup.sealed, id, doc));
        let form = self.checked_form(id, doc, expansions, &skipped, 0, None, &mut found);
        (form, found)
    }

    /// A patch's revision, committed to the minted document `id`: its row, and its session's
    /// current one.
    pub(super) fn adopt(&mut self, id: &str, form: Value) {
        let shared = &self.shared[id];
        let k = shared.revs.len() - 1;
        let r = &shared.revs[k];
        let row = Row {
            rev: r.rev,
            base_rev: r.base_rev,
            writer: r.writer.clone().expect("a commit has a writer"),
            patch: r.patch.clone(),
            hash: shared.hash(k, &self.startup.sealed).to_string(),
            state: "current",
            doc: shared.doc.clone(),
        };
        let at = r.current_at.unwrap_or(self.now);
        let seen = self.shown_at.entry(id.to_string()).or_default();
        seen.push((at, row.rev));
        self.push_row(id, row);
        self.make_current(id, form, 0);
    }

    /// Brings what #96 holds of the minted document `id` up to its newest revision; false for a
    /// document with none.
    fn mint(&mut self, id: &str) -> bool {
        let Some(rows) = self.revisions.get(id) else {
            return false;
        };
        let Some(newest) = rows.iter().rposition(|r| r.state != "refused") else {
            return false;
        };
        let held = self.minted.remove(id);
        let mut shared = held.unwrap_or_else(|| Shared::minted(id));
        shared.numbers = rows.last().map(|r| r.rev);
        let at = shared.current().rev;
        let new = |r: &Row| r.state != "refused" && r.rev > at;
        for (k, row) in rows.iter().enumerate().filter(|(_, r)| new(r)) {
            let issues = match k == newest {
                true => check_packed(&row.doc, &self.startup.sealed, &self.packs).issues,
                false => Vec::new(),
            };
            shared.take(row, issues);
            shared.find_older();
        }
        self.minted.insert(id.to_string(), shared);
        true
    }

    /// `act` with the minted document `id` held among the shared ones, as #96's calls read it.
    pub(crate) fn as_shared<T>(&mut self, id: &str, act: impl FnOnce(&mut Self) -> T) -> T {
        if self.shared.contains_key(id) || !self.mint(id) {
            return act(self);
        }
        let shared = self.minted.remove(id).expect("minted");
        self.shared.insert(id.to_string(), shared);
        let out = act(self);
        let shared = self.shared.remove(id).expect("held through the call");
        self.minted.insert(id.to_string(), shared);
        out
    }

    /// A whole revision of `id` as `writer` stamped it, beside the layers other writers hold there:
    /// its own layer filled from it, and the envelope too when the document's first layer is its
    /// own. `None` when no other writer holds a layer.
    pub(crate) fn beside(
        &mut self,
        id: &str,
        stamped: &Value,
        writer: &Writer,
        issues: &mut Vec<Issue>,
    ) -> Option<(Value, Beside)> {
        let mut layers = self.current(id)?.doc["layers"].as_object()?.keys();
        if !layers.any(|l| *l != writer.layer_id()) || !self.mint(id) {
            return None;
        }
        let shared = &self.minted[id];
        let (was, last) = (shared.owners.clone(), Rc::clone(&shared.current().issues));
        let (mut doc, mut owners) = (shared.doc.clone(), was.clone());
        let layer = match layer_of(&doc, writer) {
            Some(l) => l,
            None => self.add_layer(&mut doc, writer),
        };
        let first = doc["layers"].as_object().and_then(|l| {
            let order = |(id, v): &(&String, &Value)| {
                (v["order"].as_str().map(str::to_string), id.to_string())
            };
            l.iter().min_by_key(order).map(|(id, _)| id.clone())
        });
        let payload = stamped.as_object()?;
        if let (true, Some(fields)) = (first.as_ref() == Some(&layer), doc.as_object_mut()) {
            let mapped = |k: &str| ["items", "layers"].contains(&k) || ID_MAPS.contains(&k);
            fields.retain(|k, _| mapped(k));
            let envelope = payload.iter().filter(|(k, _)| !mapped(k));
            fields.extend(envelope.map(|(k, v)| (k.clone(), v.clone())));
        }
        fill_layer(&mut doc, &mut owners, payload, &layer, issues);
        Some((
            doc,
            Beside {
                layer,
                was,
                owners,
                last,
            },
        ))
    }
}
