//! Issue #403: a verdict on a claim whose deliverables are documents (canvas primitives: What
//! holds a document to its rules, Check input; technical design: Document check, What done
//! means). Each requirement of the claim's definition is one check input, whose `kind` is read
//! against the document check registry: `document.validate` runs the core's check, a kind a
//! canvas module in the build registers runs that module's, and a kind no module registers is
//! BLOCKED with `module_missing` naming the kind and its module, never PASS and never skipped.
//! An item of a kind the build doesn't know blocks the checks of its document, naming the kind.
//! The verdict's key names each deliverable's revision by hash, so any writer's patch that makes
//! a new revision leaves it stale, as a new commit would.

use std::collections::BTreeMap;

use deep_canvas::document::{check_packed, Issue, Notice, CHECK};
use deep_canvas::registry::{Raised, CORE_CHECK_KINDS};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted, Requirement, Show};
use crate::kit::catalog::fix_of;
use crate::shared::knows;

/// A document the hub holds, at its current revision.
struct Current<'h> {
    rev: u64,
    hash: &'h str,
    doc: &'h Value,
}

/// The core's honest-numbers check kind (canvas primitives: Honest numbers, the check).
const HONEST: &str = "honest_numbers";

/// The core's determinism check kind (Check input).
const DETERMINISM: &str = "document.determinism";

/// The verdicts a claim can get, worst first: the claim's is the worst of its requirements'.
const WORST_FIRST: [&str; 5] = ["INVALID", "BLOCKED", "FAIL", "INCONCLUSIVE", "PASS"];

/// The items of a kind this build doesn't know among `notices`, by kind: the check's
/// `unknown_kind` notices, less the kinds the build draws without a registry entry (`knows`).
fn unknown_by_kind(notices: &[Notice], into: &mut BTreeMap<String, Vec<String>>) {
    for n in notices.iter().filter(|n| n.code == "unknown_kind") {
        let kind = n.actual.as_str().unwrap_or_default();
        if knows(kind) {
            continue;
        }
        let ids = into.entry(kind.to_string()).or_default();
        for id in &n.ids {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
    }
}

/// The items of a kind this build doesn't know, which the check skipped (sorted).
pub fn unknown_items(notices: &[Notice]) -> Vec<String> {
    let mut by_kind = BTreeMap::new();
    unknown_by_kind(notices, &mut by_kind);
    let mut ids: Vec<String> = by_kind.into_values().flatten().collect();
    ids.sort();
    ids
}

/// `doc` without the items `skipped`: what the frame evaluates and draws, so the rest of a
/// document still draws around an item of a kind this build doesn't know.
pub fn without(doc: &Value, skipped: &[String]) -> Value {
    if skipped.is_empty() {
        return doc.clone();
    }
    let mut out = doc.clone();
    if let Some(Value::Object(items)) = out.get_mut("items") {
        for id in skipped {
            items.remove(id);
        }
    }
    out
}

/// A requirement's row, decided.
fn done(mut row: Map<String, Value>, result: &str, blocked: Vec<Value>) -> Value {
    row.insert("result".into(), json!(result));
    if !blocked.is_empty() {
        row.insert("blocked".into(), Value::Array(blocked));
    }
    Value::Object(row)
}

/// Why checks are BLOCKED, one row per kind the build doesn't know with the items of that kind.
fn blocked_rows(by_kind: BTreeMap<String, Vec<String>>) -> Vec<Value> {
    by_kind
        .into_iter()
        .map(|(kind, ids)| json!({"code": "unknown_kind", "kind": kind, "ids": ids}))
        .collect()
}

impl<'a> Hub<'a> {
    /// What blocks a `deep show --check`'s claim on this revision: the items of a kind the
    /// build doesn't know, when the claim names the document among its deliverables. Outside a
    /// claim they stay notices (#389).
    pub fn blocked_in_claim(&self, show: &Show, notices: &[Notice]) -> Vec<Value> {
        let in_claim = show.check
            && show
                .claim
                .as_ref()
                .and_then(|h| self.scenario.claims.get(h))
                .is_some_and(|c| c.deliverables.contains(&show.doc));
        if !in_claim || self.planted(Planted::ChecksSkipUnknownKind) {
            return Vec::new();
        }
        let mut by_kind = BTreeMap::new();
        unknown_by_kind(notices, &mut by_kind);
        blocked_rows(by_kind)
    }

    /// What a canvas module this build lacks blocks in a `deep show --check` whose claim names
    /// the document (#1162): each item of a kind that module evaluates is kept as written and
    /// never drawn, as an unknown kind's is (#403), and blocks the claim naming its kind; the
    /// rest still draws. The module's own `requires` entry stops refusing once its items are set
    /// apart. Outside such a claim the document is refused with `module_missing` (#305).
    pub fn missing_in_claim(
        &self,
        show: &Show,
        issues: &mut Vec<Issue>,
        skipped: &mut Vec<String>,
    ) -> Vec<Value> {
        let in_claim = show.check
            && show
                .claim
                .as_ref()
                .and_then(|h| self.scenario.claims.get(h))
                .is_some_and(|c| c.deliverables.contains(&show.doc));
        if !in_claim {
            return Vec::new();
        }
        let item_kind = |i: &Issue| {
            (i.code == "module_missing" && i.path.starts_with("items/") && i.path.ends_with("/kind"))
                .then(|| i.actual.as_str().map(str::to_string))
                .flatten()
        };
        let mut by_kind: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for i in issues.iter() {
            if let Some(kind) = item_kind(i) {
                by_kind.entry(kind).or_default().extend(i.ids.iter().cloned());
            }
        }
        if by_kind.is_empty() {
            return Vec::new();
        }
        issues.retain(|i| {
            item_kind(i).is_none()
                && !(i.code == "module_missing" && i.path.starts_with("requires/modules/"))
        });
        let mut rows = Vec::new();
        for (kind, ids) in by_kind {
            skipped.extend(ids.iter().cloned());
            rows.push(json!({"code": "module_missing", "kind": kind, "ids": ids}));
        }
        skipped.sort();
        skipped.dedup();
        rows
    }

    /// A document's current revision: a shared document's, or a session's. A view of the record
    /// has no revisions (Revision), so it is no deliverable a verdict can be keyed by.
    fn current_of(&self, doc: &str) -> Option<Current<'_>> {
        if let Some(shared) = self.shared.get(doc) {
            if shared.doc.get("source").is_some() {
                return None;
            }
            let k = shared.revs.len().checked_sub(1)?;
            return Some(Current {
                rev: shared.current().rev,
                hash: shared.hash(k, &self.startup.sealed),
                doc: &shared.doc,
            });
        }
        let row = self.current(doc)?;
        Some(Current {
            rev: row.rev,
            hash: &row.hash,
            doc: &row.doc,
        })
    }

    /// `{"call": "verdict", "claim"}`: judges the claim on its deliverables' current revisions
    /// and records the verdict, keyed by those revisions' hashes.
    pub fn verdict_call(&mut self, claim: &str) -> Value {
        let scenario = self.scenario;
        let Some(c) = scenario.claims.get(claim) else {
            return json!({"result": "INVALID", "key": {"revisions": []}, "stale": false, "requirements": []});
        };
        let read = self.evaluated_reads(c);
        let determinism = self.determinism_runs(c);
        let layout = self.film_layout_runs(c);
        let mut docs: Vec<(String, Current)> = Vec::new();
        let mut missing = false;
        for d in &c.deliverables {
            match self.current_of(d) {
                Some(cur) => docs.push((d.clone(), cur)),
                None => missing = true,
            }
        }
        let keyed_by_doc = self.planted(Planted::VerdictKeyedByDoc);
        let revisions: Vec<Value> = docs
            .iter()
            .map(|(d, cur)| {
                if keyed_by_doc {
                    json!({"doc": d})
                } else {
                    json!({"doc": d, "rev": cur.rev, "hash": cur.hash})
                }
            })
            .collect();
        // A document check passes a claim only when the definition names the document among its
        // deliverables: a claim naming none is checked on nothing.
        let none = docs.is_empty() && !missing;
        let rows: Vec<Value> = c
            .requirements
            .iter()
            .map(|r| {
                let laid = layout.get(&r.id);
                let compared = determinism.get(&r.id).or(laid.map(|(i, _)| i));
                let mut row = self.judge(r, &docs, missing, &read, &c.session, compared);
                // #408: film.layout's own time on the requirement.
                if let (Some((_, ms)), Some(map)) = (laid, row.as_object_mut()) {
                    map.insert("timing".into(), json!({"check_ms": ms}));
                }
                row
            })
            .collect();
        // A deliverable the hub doesn't hold is INVALID; a definition with no requirement checks
        // nothing, so it never passes.
        let result = if missing {
            "INVALID"
        } else if none {
            "INCONCLUSIVE"
        } else {
            WORST_FIRST
                .iter()
                .copied()
                .find(|w| rows.iter().any(|r| r["result"] == *w))
                .unwrap_or("INCONCLUSIVE")
        };
        // #200: the approvals asked for, one per requirement only the working agent's own entry
        // covers.
        let asks: Vec<Value> = rows
            .iter()
            .flat_map(|r| r["asks"].as_array().cloned().unwrap_or_default())
            .collect();
        let mut recorded =
            json!({"result": result, "key": {"revisions": revisions}, "requirements": rows});
        if !asks.is_empty() {
            recorded["asks"] = Value::Array(asks);
        }
        self.verdicts_made
            .entry(claim.to_string())
            .or_default()
            .push(recorded.clone());
        self.with_stale(recorded)
    }

    /// `{"call": "verdicts", "claim"}`: every verdict made on the claim, in the order made.
    pub fn verdicts_call(&self, claim: &str) -> Value {
        let list: Vec<Value> = self
            .verdicts_made
            .get(claim)
            .into_iter()
            .flatten()
            .map(|v| self.with_stale(v.clone()))
            .collect();
        json!({"verdicts": list})
    }

    /// A recorded verdict with `stale` as of now: a document in its key whose current revision
    /// is not the one the key names, by revision and hash (Pinned to a commit). A key with no
    /// revision (the planted one) can't go stale; a key with no hash always has.
    fn with_stale(&self, mut verdict: Value) -> Value {
        let stale = verdict["key"]["revisions"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|r| {
                let Some(rev) = r["rev"].as_u64() else {
                    return false;
                };
                let hash = r["hash"].as_str().unwrap_or_default();
                let doc = r["doc"].as_str().unwrap_or_default();
                hash.is_empty()
                    || self
                        .current_of(doc)
                        .is_none_or(|c| c.rev != rev || c.hash != hash)
            });
        verdict["stale"] = json!(stale);
        verdict
    }

    /// Every array a claim's check kinds read beside the lowered document (#411), evaluated on
    /// each deliverable's current revision: doc → array → item → its value's canonical bytes, hex.
    fn evaluated_reads(&mut self, c: &crate::hub::Claim) -> BTreeMap<String, Value> {
        let sealed = &self.startup.sealed;
        let arrays: Vec<String> = c
            .requirements
            .iter()
            .filter_map(|r| sealed.check_kind(r.check["kind"].as_str()?))
            .flat_map(|(_, check)| check.reads.clone())
            .collect();
        let mut out = BTreeMap::new();
        if arrays.is_empty() {
            return out;
        }
        for doc in &c.deliverables {
            let Some(revision) = self.query_revision(doc, None) else {
                continue;
            };
            let session = self.evaluated(&revision.drawn, 0);
            let ids: Vec<String> = revision
                .drawn
                .get("items")
                .and_then(Value::as_object)
                .map(|i| i.keys().cloned().collect())
                .unwrap_or_default();
            let mut by_array = Map::new();
            for array in &arrays {
                let values: Map<String, Value> = ids
                    .iter()
                    .filter_map(|id| {
                        let (v, _) = session.read(&self.sched, array, Some(id))?;
                        let hex: String = v.bytes().iter().map(|b| format!("{b:02x}")).collect();
                        Some((id.clone(), json!(hex)))
                    })
                    .collect();
                by_array.insert(array.clone(), Value::Object(values));
            }
            out.insert(doc.clone(), Value::Object(by_array));
        }
        out
    }

    /// The core's `document.determinism` on each requirement that names it: every deliverable's
    /// current revision played to and seeked to each of the input's `at_times` (#488's
    /// comparison on a 60 Hz display), an error for each time whose pixels differ or that
    /// couldn't be drawn. Requirement ID → its issues.
    fn determinism_runs(&mut self, c: &crate::hub::Claim) -> BTreeMap<String, Vec<Value>> {
        let mut out = BTreeMap::new();
        for r in c.requirements.iter().filter(|r| r.check["kind"] == DETERMINISM) {
            let at_times: Option<Vec<i64>> = r.check["at_times"].as_array().map(|ts| {
                ts.iter()
                    .filter_map(|t| t.as_str().and_then(crate::hub::flicks).or_else(|| t.as_i64()))
                    .collect()
            });
            let mut issues = Vec::new();
            for doc in &c.deliverables {
                let d = crate::time::Determinism {
                    doc: doc.clone(),
                    display_hz: 60,
                    play: crate::time::PlayPath::Warm,
                    at_times: at_times.clone(),
                };
                let compared = self.determinism(&d);
                let Some(frames) = compared["frames"].as_array() else {
                    issues.push(json!({"check": DETERMINISM, "code": "not_drawn", "severity": "error",
                        "ids": [], "doc": doc, "what": format!("the revision couldn't be drawn: {}", compared["code"])}));
                    continue;
                };
                for f in frames {
                    let (play, seek) = (&f["play"]["pixels"], &f["seek"]["pixels"]);
                    if play.is_null() || play != seek {
                        issues.push(json!({"check": DETERMINISM, "code": "seek_differs", "severity": "error",
                            "ids": [], "doc": doc, "t": f["t"],
                            "what": format!("playing to {} draws {play}, seeking to it {seek}", f["t"])}));
                    }
                }
            }
            out.insert(r.id.clone(), issues);
        }
        out
    }

    /// One requirement's row: its check input's kind run on every deliverable, with the machines
    /// its result holds on and the determinism class of what it read (#411).
    fn judge(
        &self,
        r: &Requirement,
        docs: &[(String, Current)],
        missing: bool,
        read: &BTreeMap<String, Value>,
        author: &str,
        compared: Option<&Vec<Value>>,
    ) -> Value {
        let kind = r.check["kind"].as_str().unwrap_or_default().to_string();
        let sealed = &self.startup.sealed;
        let mut row = Map::new();
        row.insert("id".into(), json!(r.id));
        row.insert("kind".into(), json!(kind));
        row.insert("issues".into(), json!([]));
        // The core's own document checks read the lowered document on the CPU: exact, any machine.
        let (machines, determinism) = match sealed.check_kind(&kind) {
            Some((_, check)) => (check.machines.as_str(), sealed.check_determinism(check)),
            None => ("any", "exact"),
        };
        row.insert("machines".into(), json!(machines));
        row.insert("determinism".into(), json!(determinism));
        if missing {
            return done(row, "INVALID", Vec::new());
        }
        if docs.is_empty() {
            return done(row, "INCONCLUSIVE", Vec::new());
        }
        // #464: a check that would read a display-only snapshot is refused: it never counts.
        if let Some(sha) = r.check["snapshot"]
            .as_str()
            .filter(|s| self.display_only.contains(*s))
        {
            let refusal = json!({"code": "display_only", "snapshot": sha});
            return done(row, "INVALID", vec![refusal]);
        }
        let core = CORE_CHECK_KINDS.contains(&kind.as_str());
        let registered = if core { None } else { sealed.check_kind(&kind) };
        if !core && registered.is_none() {
            // No module in the build registers the kind: BLOCKED, naming it and its module.
            if self.planted(Planted::MissingKindInconclusive) {
                return done(row, "INCONCLUSIVE", Vec::new());
            }
            let mut b = json!({"code": "module_missing", "kind": kind, "ids": []});
            if let Some(m) = sealed.module_of_check(&kind) {
                b["module"] = json!(m);
            }
            return done(row, "BLOCKED", vec![b]);
        }
        let run_first = kind == DETERMINISM || kind == crate::film_layout::FILM_LAYOUT;
        if let (true, Some(raised)) = (run_first, compared) {
            // Run on every deliverable before judging (`determinism_runs`, `film_layout_runs`):
            // each time where playing to it and seeking to it draw different pixels, or a text
            // cut, overlapping, crossed or covered, is an error; a notice decides nothing (#408).
            let errors = raised.iter().any(|i| i["severity"] == "error");
            let result = if errors { "FAIL" } else { "PASS" };
            row.insert("issues".into(), Value::Array(raised.clone()));
            return done(row, result, Vec::new());
        }
        let honest = kind == HONEST;
        if core && kind != CHECK && !honest {
            // The core's other kinds land with R6 (Check input: Lands); unrun, they never pass.
            let b = json!({"code": "not_run", "kind": kind, "ids": []});
            return done(row, "BLOCKED", vec![b]);
        }
        let mut issues: Vec<Value> = Vec::new();
        let mut blocked: Vec<Value> = Vec::new();
        let mut by_kind = BTreeMap::new();
        let mut own: Vec<(String, String)> = Vec::new();
        // Honest numbers (canvas primitives: Honest numbers, the check): every number each
        // deliverable shows, with what it traces to.
        let mut numbers: Vec<Value> = Vec::new();
        let mut results: Vec<Value> = Vec::new();
        for (doc, cur) in docs {
            // Checked with the pack store, so a deliverable that names an installed pack resolves
            // it, as its show did (#200).
            let checked = check_packed(cur.doc, sealed, &self.packs);
            if !self.planted(Planted::ChecksSkipUnknownKind) {
                unknown_by_kind(&checked.notices, &mut by_kind);
            }
            // A document that requires a canvas module the build lacks is BLOCKED, never a
            // FAIL (#305), naming the module where the `requires/modules/<module>` path does.
            for i in checked.issues.iter().filter(|i| i.code == "module_missing") {
                // An item of a kind whose module the build lacks names that kind (#1162).
                let item_kind = (i.path.ends_with("/kind") && i.path.starts_with("items/"))
                    .then(|| i.actual.as_str())
                    .flatten();
                let mut b = json!({"code": "module_missing", "kind": item_kind.unwrap_or(&kind), "ids": i.ids});
                if let Some(module) = i.path.strip_prefix("requires/modules/") {
                    b["module"] = json!(module);
                }
                blocked.push(b);
            }
            // A check that decides a verdict counts every issue of the revision (Revision), the
            // document's own validation among them whatever kind runs; each names its document,
            // since item IDs are one document's.
            let mut raised: Vec<Value> = checked.issues.iter().map(Issue::to_json).collect();
            if let Some((m, check)) = registered {
                let mut input = r.check.clone();
                if let (Some(map), Some(values)) = (input.as_object_mut(), read.get(doc)) {
                    map.insert("read".into(), values.clone());
                }
                // #200: the entry a check input names, resolved through the deliverable's pinned
                // packs in a registry the check's module declares.
                if let Some(name) = r.check["entry"].as_str() {
                    let found = sealed
                        .registries
                        .iter()
                        .filter(|reg| reg.owner == m.name)
                        .find_map(|reg| {
                            self.entry_for(cur.doc, &reg.def.name, name)
                                .map(|e| (reg, e))
                        });
                    if let Some((reg, e)) = found {
                        // With binds author, an entry the working agent wrote binds only its own
                        // claims: it can't make this claim's PASS.
                        let by_author = e.origin == "agent"
                            && self.pack_authors.get(&e.pack).is_some_and(|s| s == author);
                        if reg.def.binds == "author" && by_author {
                            own.push((reg.def.name.clone(), e.name.clone()));
                        }
                        if let Some(map) = input.as_object_mut() {
                            map.insert("resolved".into(), e.to_json());
                        }
                    }
                }
                if let Some(report) = check.report {
                    // #453: a check that measures reads the assets its items name, and only the
                    // proof surface plants its wrong program.
                    if let Some(map) = input.as_object_mut() {
                        map.insert("assets".into(), self.assets_of(&checked.lowered));
                        map.remove("planted");
                        if let Some(p) = &self.scenario.module_planted {
                            map.insert("planted".into(), json!(p));
                        }
                    }
                    let out = report(&checked.lowered, &input);
                    for (id, r, actual) in out.raised {
                        let mut issue = raised_json(self, &kind, &m.name, &id, r);
                        issue["actual"] = actual;
                        raised.push(issue);
                    }
                    let in_doc = |mut v: Value| {
                        v["doc"] = json!(doc);
                        v
                    };
                    results.extend(out.results.into_iter().map(in_doc));
                    blocked.extend(out.blocked.into_iter().map(in_doc));
                } else {
                    raised.extend(run_check(
                        self,
                        check,
                        &kind,
                        &m.name,
                        &checked.lowered,
                        &input,
                    ));
                }
            }
            if honest {
                match self.honest_numbers(cur.doc) {
                    Ok((found, raised_here)) => {
                        numbers.extend(found);
                        raised.extend(raised_here.iter().map(Issue::to_json));
                    }
                    Err(b) => blocked.push(b),
                }
            }
            for i in &mut raised {
                i["doc"] = json!(doc);
            }
            issues.extend(raised);
        }
        let errors = issues.iter().any(|i| i["severity"] == "error");
        blocked.extend(blocked_rows(by_kind));
        let result = if !blocked.is_empty() {
            "BLOCKED"
        } else if errors {
            "FAIL"
        } else if !own.is_empty() {
            // Its only cover is the working agent's own entry: INCONCLUSIVE, with your approval
            // asked for, never PASS.
            let asks: Vec<Value> = own
                .iter()
                .map(|(registry, entry)| json!({
                    "kind": "approval", "requirement": r.id, "registry": registry, "entry": entry,
                    "why": format!("`{entry}` is the working agent's own entry in `{registry}`, which binds author: it binds only its own claims"),
                }))
                .collect();
            row.insert("asks".into(), Value::Array(asks));
            "INCONCLUSIVE"
        } else {
            "PASS"
        };
        row.insert("issues".into(), Value::Array(issues));
        if honest {
            row.insert("numbers".into(), Value::Array(numbers));
        }
        if registered.is_some_and(|(_, c)| c.report.is_some()) {
            row.insert("results".into(), Value::Array(results));
        }
        done(row, result, blocked)
    }

    /// The honest-numbers check on one deliverable: its mark sets' table columns read from the
    /// evidence store with their traces (#397), then every number it shows and the issues
    /// tracing them raises, a table an agent wrote where status can show among them. A table it
    /// can't read blocks the check, naming the column.
    fn honest_numbers(&self, doc: &Value) -> Result<(Vec<Value>, Vec<Issue>), Value> {
        let mut doc = doc.clone();
        if let Err(r) = self.inline_tables(&mut doc) {
            return Err(json!({"code": r.code, "kind": HONEST, "ids": [], "path": r.path}));
        }
        let empty = serde_json::Map::new();
        Ok(deep_canvas_marks::check::numbers(doc.as_object().unwrap_or(&empty)))
    }

    /// The bytes of every asset a lowered document's items name by hash that the evidence store
    /// holds, in base64 by hash (#453).
    fn assets_of(&self, lowered: &Value) -> Value {
        let mut out = Map::new();
        for item in lowered
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(_, v)| v)
        {
            if let Some(sha) = item.pointer("/params/sha256").and_then(Value::as_str) {
                if let Some(b) = crate::evidence::read(&self.scenario.evidence, sha) {
                    out.insert(sha.to_string(), json!(deep_canvas::base64::encode(&b)));
                }
            }
        }
        Value::Object(out)
    }
}

/// A module's check kind run on the lowered document for the check input `input`: its errors
/// and warnings as a reply carries them, naming the check kind and the module. A notice decides
/// nothing and is left out.
pub fn run_check(
    hub: &Hub<'_>,
    check: &deep_canvas::registry::Check,
    kind: &str,
    module: &str,
    lowered: &Value,
    input: &Value,
) -> Vec<Value> {
    (check.run)(lowered, input)
        .into_iter()
        .filter(|(_, raised)| raised.severity != "notice")
        .map(|(id, raised)| raised_json(hub, kind, module, &id, raised))
        .collect()
}

/// An issue a module's check raised, as a reply carries it, naming the check kind.
fn raised_json(hub: &Hub<'_>, kind: &str, module: &str, id: &str, raised: Raised) -> Value {
    let mut issue = Issue::error(raised.code, id, raised.path, Value::Null, &raised.what);
    issue.severity = raised.severity;
    issue.fix = fix_of(hub, module, raised.code);
    issue.fix_ops = raised.fix_ops;
    let mut out = issue.to_json();
    out["check"] = json!(kind);
    out["module"] = json!(module);
    out
}
