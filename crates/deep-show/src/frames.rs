//! The scheduler's side of `deep-show run` (issue #387; the #387 acceptance README: The surface
//! under test): the registry with every operator and contribution the seal kept, the canvas
//! modules' fixtures, `eval` (one frame of a document's session, live or clean, with a read-set
//! perturbation), `frames` (the scheduler's allocations and CPU per frame), interned handles and
//! outside data's batches.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use deep_canvas::document::Issue;
use deep_canvas::schedule::{default_view, OpIssue, Session as DocSession, Target, Val};
use deep_canvas_marks::modules::Drawing;
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Eval, Hub, SEAL_RUNS};
use crate::snapshot::{self, Drawn, Unfit};

/// An operator's error as a revision's issue.
pub fn op_issue(i: &OpIssue) -> Issue {
    let what = format!("{} can't evaluate this", i.operator);
    match &i.item {
        Some(id) => Issue::error(i.code, id, i.path.clone(), Value::Null, &what),
        None => Issue::envelope(i.code, i.path.clone(), Value::Null, &what),
    }
}

/// What the renderer can't draw, as a revision's issue.
pub fn unfit_issue(code: &'static str, path: String) -> Issue {
    let what = "the marks module can't draw this";
    let item = path
        .strip_prefix("items/")
        .and_then(|p| p.split('/').next())
        .map(str::to_string);
    match item {
        Some(id) => Issue::error(code, &id, path.clone(), Value::Null, what),
        None => Issue::envelope(code, path, Value::Null, what),
    }
}

/// Every number past f64's range in a document (read as an overflow marker), refused with
/// `out_of_range` at its path.
pub fn overflows(doc: &Value) -> Vec<Issue> {
    fn walk(v: &Value, path: &mut Vec<String>, out: &mut Vec<Issue>) {
        match v {
            Value::String(s) if s.starts_with(crate::OVERFLOW) => {
                let p = path.join("/");
                let what = "a number past f64's range: NaN and infinity have no place in a param";
                match (path.first().map(String::as_str), path.get(1)) {
                    (Some("items"), Some(id)) => {
                        out.push(Issue::error("out_of_range", id, p, Value::Null, what))
                    }
                    _ => out.push(Issue::envelope("out_of_range", p, Value::Null, what)),
                }
            }
            Value::Array(list) => {
                for (i, x) in list.iter().enumerate() {
                    path.push(i.to_string());
                    walk(x, path, out);
                    path.pop();
                }
            }
            Value::Object(map) => {
                for (k, x) in map {
                    path.push(k.clone());
                    walk(x, path, out);
                    path.pop();
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(doc, &mut Vec::new(), &mut out);
    out
}

fn issue_json(i: &OpIssue) -> Value {
    let mut v = json!({
        "code": i.code, "severity": "error", "ids": i.item.iter().collect::<Vec<_>>(),
        "module": i.module, "operator": i.operator, "path": i.path,
    });
    if let Some(r) = &i.read {
        v["read"] = json!(r);
    }
    v
}

impl<'a> Hub<'a> {
    /// The sealed set as the build holds it (#305), with each module's version and digest,
    /// every operator the seal kept (the core's own as module `core`) with its read set as its
    /// module registered it, and each array's contribution (#387).
    pub fn registry_reply(&self) -> Value {
        let sealed = &self.startup.sealed;
        let arrays: Map<String, Value> = sealed
            .arrays
            .iter()
            .map(|(k, a)| {
                (
                    k.clone(),
                    json!({
                        "owner": a.owner, "type": a.ty, "domain": a.domain,
                        "class": a.class, "phase": a.phase, "contributes_to": a.contributes_to,
                    }),
                )
            })
            .collect();
        let operators: Map<String, Value> = sealed
            .ops
            .iter()
            .map(|o| {
                (
                    o.key.clone(),
                    json!({"module": o.module, "phase": o.op.phase, "reads": o.op.reads, "writes": o.op.writes}),
                )
            })
            .collect();
        // #379: every render pass the build registers, and every operator's and pass's cost
        // model, its coefficients and the micro-benchmark that measured them.
        let reference = deep_canvas::cost::Coefficients::reference();
        let mut passes = Map::new();
        let mut costs = Map::new();
        let mut cost = |name: &str, module: &str| {
            let terms = reference.terms.get(name).copied().unwrap_or_default();
            costs.insert(
                name.to_string(),
                json!({"module": module, "terms": terms.to_json(), "fingerprint": reference.fingerprint,
                       "benchmark": {"task": "canvas-costs", "case": name}}),
            );
        };
        for o in &sealed.ops {
            cost(&o.key, &o.module);
        }
        for m in &sealed.modules {
            for p in &m.shapes.passes {
                passes.insert(p.name.clone(), json!({"module": m.name, "place": p.place}));
                cost(&p.name, &m.name);
            }
        }
        json!({
            "build_set": sealed.build_set.name(),
            "state": sealed.state(),
            "modules": sealed.modules.iter().map(|m| m.name.clone()).collect::<Vec<_>>(),
            "versions": sealed.modules.iter().map(|m| (m.name.clone(), json!(m.version.to_string()))).collect::<Map<_, _>>(),
            "digests": sealed.modules.iter().map(|m| (m.name.clone(), json!(m.digest))).collect::<Map<_, _>>(),
            "arrays": arrays,
            "operators": operators,
            "passes": passes,
            "costs": costs,
            "plan": sealed.plan,
            "schedule": {"uri": sealed.schedule_uri(), "sha256": deep_canvas::schedule::sha256_hex(&deep_canvas::schedule::canonical(&sealed.schedule()))},
            "seal": {"ms": self.startup.seal_ms, "runs": SEAL_RUNS.load(Ordering::Relaxed)},
        })
    }

    /// Every canvas module's fixtures, the core's first.
    pub fn fixtures_reply(&self) -> Value {
        let list: Vec<Value> = self
            .startup
            .sealed
            .fixtures
            .iter()
            .map(|(module, f)| {
                let mut v = json!({"module": module, "name": f.name, "document": f.document});
                if let Some(r) = &f.record {
                    v["record"] = r.clone();
                }
                v
            })
            .collect();
        json!({ "fixtures": list })
    }

    /// The revision `doc` checked before it becomes current: the operators' errors, and the
    /// frame's drawing when it ran.
    pub fn probe(
        &mut self,
        doc: &Value,
        t: i64,
        frames: bool,
    ) -> (Vec<OpIssue>, Option<Arc<Drawing>>) {
        let base = self.new_session();
        let scratch = base.probe(&mut self.sched, doc, t, frames);
        let drawing = drawing_of(&self.sched, &scratch);
        (scratch.report.issues, drawing)
    }

    /// The session's own frame at `t` in its current view, drawn: render-back's snapshot.
    pub fn live_drawn(&mut self, doc: &str, t: i64) -> Option<Drawn> {
        let session = self.sessions.get_mut(doc)?;
        let view = session_view(session, &Map::new());
        session.frame(&mut self.sched, t, &view);
        let drawing = drawing_of(&self.sched, session)?;
        self.renderer
            .prepare_drawing(&drawing, &self.scenario.evidence)
            .ok()
    }

    /// One frame of a document's session (`eval`).
    pub fn eval(&mut self, e: &Eval) -> Value {
        if !self.doc_visible(&e.doc) {
            return json!({"outcome": "not_presented", "reason": "hidden", "nodes": []});
        }
        let rev = self.current(&e.doc).map(|r| r.rev);
        let Some(session) = self.sessions.get_mut(&e.doc).filter(|_| rev.is_some()) else {
            return json!({"outcome": "refused", "code": "no_revision", "issues": []});
        };
        let view = session_view(session, &e.view);
        let _ = self.sched.take_hashes();
        let perturb = e.perturb.as_deref().map(Target::parse);
        if perturb.as_ref().is_some_and(|p| p.is_none() || !e.clean) {
            return json!({"outcome": "refused", "code": "bad_input", "issues": []});
        }
        let targets = session.targets(&self.sched);
        let scratch;
        let evaluated: &DocSession = if e.clean {
            scratch = session.clean(&mut self.sched, e.t, &view, perturb.flatten());
            &scratch
        } else {
            session.frame(&mut self.sched, e.t, &view);
            session
        };
        let nodes: Vec<Value> = evaluated
            .nodes(&self.sched)
            .into_iter()
            .map(|n| {
                json!({"operator": n.operator, "module": n.module, "phase": n.phase, "item": n.item,
                       "key": n.key, "result": n.result, "run": n.run.name()})
            })
            .collect();
        let report = &evaluated.report;
        let mut reply = json!({
            "outcome": if evaluated.frozen().is_some() { "frozen" } else { "evaluated" },
            "rev": rev,
            "t": e.t,
            "epoch": evaluated.epoch(),
            "nodes": nodes,
            "targets": targets.iter().map(|t| json!({"target": t.name(), "term": t.term()})).collect::<Vec<_>>(),
            "steps": report.steps.iter().map(|s| json!({"module": s.module, "t": s.t, "count": s.count, "read": s.read})).collect::<Vec<_>>(),
            "issues": report.issues.iter().map(issue_json).collect::<Vec<_>>(),
        });
        if self.startup.test_build {
            reply["access"] = json!(report
                .access
                .iter()
                .map(|a| json!({"operator": a.operator, "item": a.item, "read": a.read}))
                .collect::<Vec<_>>());
        }
        let drawing = if e.pixels {
            drawing_of(&self.sched, evaluated)
        } else {
            None
        };
        reply["hashes"] = json!(self
            .sched
            .take_hashes()
            .iter()
            .map(|h| json!({"of": h.of, "bytes": h.bytes}))
            .collect::<Vec<_>>());
        if let Some(drawing) = drawing {
            match self
                .renderer
                .prepare_drawing(&drawing, &self.scenario.evidence)
            {
                Ok(drawn) => {
                    let size = e.size.unwrap_or_else(|| {
                        let [w, h] = drawn.frame.size;
                        [
                            w.round().clamp(1.0, 8192.0) as u16,
                            h.round().clamp(1.0, 8192.0) as u16,
                        ]
                    });
                    let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
                    let rgba = self.renderer.raster(&drawn, size, Some(ground));
                    let png = snapshot::png(rgba, size);
                    if let Ok(sha) = evidence::put(&self.scenario.evidence, &png) {
                        reply["snapshots"] = json!([{"sha256": sha, "w": size[0], "h": size[1]}]);
                    }
                }
                Err(Unfit { code, path }) => {
                    reply["issues"]
                        .as_array_mut()
                        .expect("issues")
                        .push(json!({"code": code, "severity": "error", "path": path, "ids": []}));
                }
            }
        }
        reply
    }

    /// `count` frames of a session, `step` apart from `from`: how many nodes ran in each, the
    /// heap allocations the scheduler made and its CPU time.
    pub fn frames(&mut self, doc: &str, count: usize, from: i64, step: i64) -> Value {
        if !self.doc_visible(doc) {
            return json!({"outcome": "not_presented", "reason": "hidden", "frames": []});
        }
        let Some(session) = self.sessions.get_mut(doc) else {
            return json!({"outcome": "refused", "code": "no_revision", "frames": []});
        };
        let view = session_view(session, &Map::new());
        let mut out = Vec::with_capacity(count);
        for k in 0..count {
            let t = from + step * k as i64;
            let allocs = crate::allocations();
            let started = Instant::now();
            let ran = session.frame(&mut self.sched, t, &view);
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let allocs = crate::allocations() - allocs;
            out.push(json!({"t": t, "ran": ran, "allocs": allocs, "scheduler_ms": ms}));
        }
        json!({ "frames": out })
    }

    /// An item's interned handle in the session's current revision.
    pub fn intern(&mut self, doc: &str, id: &str) -> Value {
        match self.sessions.get(doc).and_then(|s| s.intern(id)) {
            Some(handle) => json!({ "handle": handle }),
            None => json!({"code": "ref_unresolved"}),
        }
    }

    /// The item a handle names, or `stale_handle` for one interned in another revision.
    pub fn resolve(&mut self, doc: &str, handle: &Value) -> Value {
        match self.sessions.get(doc).and_then(|s| s.resolve(handle)) {
            Some(id) => json!({ "id": id }),
            None => json!({"code": "stale_handle"}),
        }
    }

    /// A new batch of a document's source: each column hashed once as it arrives.
    pub fn batch(&mut self, doc: &str, source: &str, columns: &BTreeMap<String, Vec<u8>>) -> Value {
        if !self.sessions.contains_key(doc) {
            let fresh = self.new_session();
            self.sessions.insert(doc.to_string(), fresh);
        }
        let session = self.sessions.get_mut(doc).expect("made above");
        let rows = columns.values().map(|c| c.len() / 8).max().unwrap_or(0);
        let hashes = session.batch(
            columns
                .iter()
                .map(|(k, v)| (k.clone(), Arc::<[u8]>::from(v.as_slice())))
                .collect(),
        );
        json!({
            "source": source, "rows": rows,
            "hashes": hashes.iter().map(|h| json!({"of": h.of, "bytes": h.bytes})).collect::<Vec<_>>(),
        })
    }
}

/// The view a frame reads: the session's current revision's defaults, with the call's locale
/// and reduced motion over them.
fn session_view(session: &DocSession, over: &Map<String, Value>) -> [Value; 6] {
    let mut view = default_view(session.document().unwrap_or(&Value::Null));
    if let Some(l) = over.get("locale") {
        view[deep_canvas::schedule::LOCALE] = l.clone();
    }
    if let Some(r) = over.get("reduced_motion") {
        view[deep_canvas::schedule::REDUCED_MOTION] = r.clone();
    }
    view
}

/// The drawing marks2d's frame operator left in a session.
pub(crate) fn drawing_of(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Option<Arc<Drawing>> {
    match session.value(sched, "marks2d.frame", None)? {
        Val::Any(any, _) => any.downcast::<Drawing>().ok(),
        _ => None,
    }
}
