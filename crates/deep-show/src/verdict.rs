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

use deep_canvas::document::{check_in, Issue, Notice, CHECK};
use deep_canvas::registry::{Raised, CORE_CHECK_KINDS};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted, Requirement, Show};
use crate::kit::catalog::fix_of;
use crate::shared::knows;

/// A document the hub holds, at its current revision.
struct Current {
    rev: u64,
    hash: String,
    doc: Value,
}

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

    /// A document's current revision: a shared document's, or a session's. A view of the record
    /// has no revisions (Revision), so it is no deliverable a verdict can be keyed by.
    fn current_of(&self, doc: &str) -> Option<Current> {
        if let Some(shared) = self.shared.get(doc) {
            if shared.doc.get("source").is_some() {
                return None;
            }
            let k = shared.revs.len().checked_sub(1)?;
            return Some(Current {
                rev: shared.current().rev,
                hash: shared.hash(k, &self.startup.sealed).to_string(),
                doc: shared.doc.clone(),
            });
        }
        let row = self.current(doc)?;
        Some(Current {
            rev: row.rev,
            hash: row.hash.clone(),
            doc: row.doc.clone(),
        })
    }

    /// `{"call": "verdict", "claim"}`: judges the claim on its deliverables' current revisions
    /// and records the verdict, keyed by those revisions' hashes.
    pub fn verdict_call(&mut self, claim: &str) -> Value {
        let Some(c) = self.scenario.claims.get(claim) else {
            return json!({"result": "INVALID", "key": {"revisions": []}, "stale": false, "requirements": []});
        };
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
            .map(|r| self.judge(r, &docs, missing))
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
        let recorded =
            json!({"result": result, "key": {"revisions": revisions}, "requirements": rows});
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

    /// One requirement's row: its check input's kind run on every deliverable.
    fn judge(&self, r: &Requirement, docs: &[(String, Current)], missing: bool) -> Value {
        let kind = r.check["kind"].as_str().unwrap_or_default().to_string();
        let sealed = &self.startup.sealed;
        let mut row = Map::new();
        row.insert("id".into(), json!(r.id));
        row.insert("kind".into(), json!(kind));
        row.insert("issues".into(), json!([]));
        if missing {
            return done(row, "INVALID", Vec::new());
        }
        if docs.is_empty() {
            return done(row, "INCONCLUSIVE", Vec::new());
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
        if core && kind != CHECK {
            // The core's other kinds land with R6 (Check input: Lands); unrun, they never pass.
            let b = json!({"code": "not_run", "kind": kind, "ids": []});
            return done(row, "BLOCKED", vec![b]);
        }
        let mut issues: Vec<Value> = Vec::new();
        let mut blocked: Vec<Value> = Vec::new();
        let mut by_kind = BTreeMap::new();
        for (doc, cur) in docs {
            let checked = check_in(&cur.doc, sealed);
            if !self.planted(Planted::ChecksSkipUnknownKind) {
                unknown_by_kind(&checked.notices, &mut by_kind);
            }
            // A document that requires a canvas module the build lacks is BLOCKED, never a
            // FAIL (#305), naming the module where the `requires/modules/<module>` path does.
            for i in checked.issues.iter().filter(|i| i.code == "module_missing") {
                let mut b = json!({"code": "module_missing", "kind": kind, "ids": i.ids});
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
                raised.extend(run_check(
                    self,
                    check,
                    &kind,
                    &m.name,
                    &checked.lowered,
                    &r.check,
                ));
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
        } else {
            "PASS"
        };
        row.insert("issues".into(), Value::Array(issues));
        done(row, result, blocked)
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
