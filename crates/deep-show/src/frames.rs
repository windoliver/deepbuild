//! The scheduler's side of `deep-show run` (issue #387; the #387 acceptance README: The surface
//! under test): the registry with every operator and contribution the seal kept, the canvas
//! modules' fixtures, `eval` (one frame of a document's session, live or clean, with a read-set
//! perturbation), `frames` (the scheduler's allocations and CPU per frame), interned handles and
//! outside data's batches.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas::document::Issue;
use deep_canvas::schedule::{
    default_view, HashVersion, OpIssue, Session as DocSession, Target, Val,
};
use deep_canvas_marks::modules::{Drawing, Run, StatusDrawing};
use deep_text::worker::Pending;
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Call, Eval, Frames, Hub, Show, SEAL_RUNS};
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
                    json!({"module": o.module, "phase": o.op.phase, "reads": o.op.reads, "writes": o.op.writes,
                           "thread_safe": !o.op.serial}),
                )
            })
            .collect();
        // #379: every render pass the build registers, and every operator's and pass's cost
        // model, its coefficients and the micro-benchmark that measured them.
        let reference = &sealed.costs;
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
    /// frame's drawing when it ran. `readings` stand in for the scenario's record: a kit
    /// fixture's own.
    pub fn probe(
        &mut self,
        doc: &Value,
        t: i64,
        frames: bool,
        readings: Option<&BTreeMap<String, Value>>,
    ) -> (Vec<OpIssue>, Option<Painted>) {
        let mut base = self.new_session();
        if let Some(r) = readings {
            base.set_readings(r.clone());
        }
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
        let t = match self.resolve_time(&e.doc, &e.t) {
            Ok(t) => t,
            Err(code) => return json!({"outcome": "refused", "code": code, "issues": []}),
        };
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
        let started = Instant::now();
        let evaluated: &DocSession = if e.clean {
            scratch = session.clean(&mut self.sched, t, &view, perturb.flatten());
            &scratch
        } else {
            session.frame(&mut self.sched, t, &view);
            session
        };
        let frame_ms = started.elapsed().as_secs_f64() * 1000.0;
        let nodes: Vec<Value> = evaluated
            .nodes(&self.sched)
            .into_iter()
            .map(|n| {
                let mut node = json!({"operator": n.operator, "module": n.module, "phase": n.phase, "item": n.item,
                       "key": n.key, "result": n.result, "run": n.run.name(), "thread": n.thread});
                if e.debug_text {
                    node["debug"] = debug_digest(&n.values);
                }
                node
            })
            .collect();
        let report = &evaluated.report;
        let mut reply = json!({
            "outcome": if evaluated.frozen().is_some() { "frozen" } else { "evaluated" },
            "hash": self.sched.hash().name(),
            "rev": rev,
            "t": t,
            "epoch": evaluated.epoch(),
            "threads": evaluated.threads(),
            "frame_ms": frame_ms,
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
            match self.canonical_png(&drawing, e.size) {
                Ok((sha, drawn, size)) => {
                    reply["snapshots"] = json!([snapshot::entry(&sha, &drawn, size)]);
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

    /// A frame's drawing as its canonical render: prepared, rastered at `size` (the drawing's
    /// own frame when none is given) over the look's ground, and stored as a PNG in the evidence
    /// store. Its SHA-256, the drawn frame and the size; or why it can't be drawn, an evidence
    /// store that takes no write counted as such (nothing missing passes).
    pub(crate) fn canonical_png(
        &mut self,
        drawing: &Painted,
        size: Option<[u16; 2]>,
    ) -> Result<(String, Drawn, [u16; 2]), Unfit> {
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let size = size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let rgba = self.renderer.raster(&drawn, size, Some(ground));
        let png = snapshot::png(rgba, size);
        let sha = evidence::put(&self.scenario.evidence, &png).map_err(|_| Unfit {
            code: "evidence_unwritable",
            path: "snapshots".into(),
        })?;
        Ok((sha, drawn, size))
    }

    /// `count` frames of a session, `step` apart from `from`: how many nodes ran in each, the
    /// heap allocations the scheduler made and its CPU time (#387); and (#856) the UI thread's CPU
    /// per frame, whether the frame is settling and, with `pixels`, its pixel hash. A revision
    /// that arrives at a frame's latch is admitted there, unless a text in it that the cost model
    /// estimates past 1 ms to shape isn't shaped yet: that text shapes on the render worker, and
    /// the frames draw the current revision, its last shaped run, settling, until it is ready.
    pub fn frames(&mut self, f: &Frames) -> Value {
        if !self.doc_visible(&f.doc) {
            return json!({"outcome": "not_presented", "reason": "hidden", "frames": []});
        }
        if !self.sessions.contains_key(&f.doc) {
            return json!({"outcome": "refused", "code": "no_revision", "frames": []});
        }
        let started = Instant::now();
        let period = Duration::from_secs_f64(f.step.max(0) as f64 / FLICKS_PER_SECOND);
        let mut pending: Option<(&Value, Vec<Pending>)> = None;
        let mut revised = Value::Null;
        // The last frame's drawing and its hash: an unchanged drawing isn't drawn again.
        let mut last: Option<(Option<*const Drawing>, Option<*const StatusDrawing>, String)> = None;
        let mut out = Vec::with_capacity(f.count);
        for k in 0..f.count {
            if f.paced {
                let due = started + period * k as u32;
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
            }
            let cpu = thread_cpu_ns();
            if let Some((_, document)) = f.revise.as_ref().filter(|(at, _)| *at == k) {
                let shaping = if self.startup.shapes_on_ui_thread {
                    Vec::new()
                } else {
                    shape_ahead(document)
                };
                pending = Some((document, shaping));
            }
            if pending
                .as_ref()
                .is_some_and(|(_, shaping)| shaping.iter().all(Pending::ready))
            {
                let (document, _) = pending.take().expect("checked above");
                revised = self.revise(&f.doc, document);
            }
            let Some(session) = self.sessions.get_mut(&f.doc) else {
                break;
            };
            let view = session_view(session, &Map::new());
            let t = f.from + f.step * k as i64;
            let _ = self.sched.take_json();
            let frame_started = Instant::now();
            let (ran, allocs) =
                crate::count_allocations(|| session.frame(&mut self.sched, t, &view));
            let ms = frame_started.elapsed().as_secs_f64() * 1000.0;
            // #855: the JSON values the frame's operators wrote, each counted by the heap
            // allocations it takes, which a copy of it takes again, and its shared handle.
            let json_values: u64 = self
                .sched
                .take_json()
                .iter()
                .map(|v| crate::count_allocations(|| (**v).clone()).1 + 1)
                .sum();
            let mut frame = json!({"t": t, "ran": ran, "allocs": allocs, "scheduler_ms": ms,
                                   "frame_ms": ms, "settling": pending.is_some(),
                                   "json_values": json_values});
            let mut capture = 0;
            if f.pixels {
                let before = thread_cpu_ns();
                let drawing = drawing_of(&self.sched, &self.sessions[&f.doc]);
                let ptrs = drawing.as_ref().map_or((None, None), |d| {
                    (
                        d.drawing.as_ref().map(Arc::as_ptr),
                        d.status.as_ref().map(Arc::as_ptr),
                    )
                });
                let hash = match (&last, &drawing) {
                    (Some((a, b, hash)), Some(d)) if (*a, *b) == ptrs && d.boxes.is_empty() => {
                        Some(hash.clone())
                    }
                    (_, Some(d)) => self.canonical_png(d, None).ok().map(|(sha, _, _)| sha),
                    (_, None) => None,
                };
                if let Some(hash) = &hash {
                    last = Some((ptrs.0, ptrs.1, hash.clone()));
                }
                frame["pixel_hash"] = json!(hash);
                capture = thread_cpu_ns() - before;
            }
            let ui = thread_cpu_ns().saturating_sub(cpu).saturating_sub(capture);
            frame["ui_ms"] = json!(ui as f64 / 1e6);
            out.push(frame);
        }
        // #857: each background job's frames from its start to this reply.
        let background: Vec<Value> = self
            .background
            .iter()
            .map(|(job, replica, frames)| {
                let mut v = json!({"job": job, "frames": frames.load(Ordering::Relaxed)});
                if let Some(r) = replica {
                    v["replica"] = json!(r);
                }
                v
            })
            .collect();
        let threads = self.sessions.get(&f.doc).map(|s| s.threads());
        let mut reply = json!({"threads": threads, "frames": out, "background": background});
        if !revised.is_null() {
            reply["revised"] = revised;
        }
        reply
    }

    /// One frame of a background job's session at `t` (#857); false when it has no revision,
    /// as when the check refused its document.
    pub fn job_frame(&mut self, doc: &str, t: i64, over: &Map<String, Value>) -> bool {
        let Some(session) = self.sessions.get_mut(doc) else {
            return false;
        };
        let view = session_view(session, over);
        session.frame(&mut self.sched, t, &view);
        true
    }

    /// A whole revision of `doc` from whoever sent its last one, admitted as a deep_show call is.
    fn revise(&mut self, doc: &str, document: &Value) -> Value {
        let Some(via) = self.vias.get(doc).cloned() else {
            return json!({"outcome": "refused", "code": "no_session"});
        };
        self.call(&Call::Show(Box::new(Show {
            via,
            doc: doc.to_string(),
            document: document.clone(),
            removes: Vec::new(),
            t: 0,
            size: None,
            include: Vec::new(),
            check: false,
            claim: None,
        })))
    }

    /// #856: the shaped-run cache's runs of `text`: the times this process shaped each one's key,
    /// and the documents whose current revision draws it, each evaluated at its frame.
    pub fn shaped_runs(&mut self, text: &str) -> Value {
        for shaping in deep_text::cache::take_log() {
            *self.shapings.entry(shaping.key).or_default() += 1;
        }
        let mut drawn: Vec<(String, Arc<deep_text::Shaped>)> = Vec::new();
        for (doc, session) in self.sessions.iter_mut() {
            let view = session_view(session, &Map::new());
            session.frame(&mut self.sched, 0, &view);
            let ids: Vec<String> = session
                .document()
                .and_then(|d| d["items"].as_object())
                .map(|items| items.keys().cloned().collect())
                .unwrap_or_default();
            for id in ids {
                let run = session
                    .value(&self.sched, "text.run", Some(&id))
                    .and_then(|v| v.as_typed::<Run>());
                if let Some(run) = run {
                    drawn.push((doc.clone(), run.shaped.clone()));
                }
            }
        }
        let runs: Vec<Value> = deep_text::cache::runs_of(text)
            .into_iter()
            .map(|(key, run)| {
                let docs: Vec<&String> = drawn
                    .iter()
                    .filter(|(_, r)| Arc::ptr_eq(r, &run))
                    .map(|(doc, _)| doc)
                    .collect();
                json!({"shaped": self.shapings.get(&key).copied().unwrap_or(0), "docs": docs})
            })
            .collect();
        json!({ "runs": runs })
    }

    /// `migrate`: rekeys the process's content-key cache under `to`, once (#855).
    pub fn migrate(&mut self, to: HashVersion) -> Value {
        let from = self.sched.hash();
        let mut sessions: Vec<&mut DocSession> = self.sessions.values_mut().collect();
        let rekeyed = self.sched.migrate(to, &mut sessions);
        json!({"from": from.name(), "to": to.name(), "entries": self.sched.cached(), "rekeyed": rekeyed})
    }

    /// `keys`: every content key of the session's current revision computed afresh, `runs`
    /// times, each pass timed by this binary's clock (#855).
    pub fn keys(&mut self, doc: &str, runs: usize) -> Value {
        let Some(session) = self.sessions.get_mut(doc) else {
            return json!({"outcome": "refused", "code": "no_revision"});
        };
        let mut ns = Vec::with_capacity(runs);
        for _ in 0..runs {
            let started = Instant::now();
            session.rekey(&mut self.sched);
            ns.push(started.elapsed().as_nanos() as u64);
        }
        json!({"hash": self.sched.hash().name(), "nodes": session.node_count(), "ns": ns})
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

/// Flicks in a second: the document clock's unit.
const FLICKS_PER_SECOND: f64 = 705_600_000.0;

/// The calling thread's CPU time, in ns.
fn thread_cpu_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

/// Hands the render worker each text of `document` whose shaping the cost model estimates past
/// 1 ms, cold, and whose run the shaped-run cache doesn't hold yet; what to wait for.
fn shape_ahead(document: &Value) -> Vec<Pending> {
    let terms = deep_canvas::cost::Coefficients::reference().get("text.shape");
    let mut out = Vec::new();
    for (id, item) in document["items"].as_object().into_iter().flatten() {
        let is_text = item["kind"]
            .as_str()
            .is_some_and(|k| k.split('@').next() == Some("text"));
        let Some(params) = item["params"].as_object().filter(|_| is_text) else {
            continue;
        };
        let glyphs = deep_canvas::cost::counts(item).glyphs;
        if terms.ns_per_item + terms.ns_per_glyph * glyphs <= 1e6 {
            continue;
        }
        let Ok(spec) = deep_canvas_marks::scene::text_spec(id, params, None) else {
            continue;
        };
        let Some(spec) = spec.shaper_spec() else {
            continue;
        };
        if !deep_text::Shaper::is_cached(&spec) {
            out.push(deep_text::worker::shape_later(&spec));
        }
    }
    out
}

/// The view a frame reads: the session's current revision's defaults, with the call's locale
/// and reduced motion over them.
pub(crate) fn session_view(session: &DocSession, over: &Map<String, Value>) -> [Value; 6] {
    let mut view = default_view(session.document().unwrap_or(&Value::Null));
    if let Some(l) = over.get("locale") {
        view[deep_canvas::schedule::LOCALE] = l.clone();
    }
    if let Some(r) = over.get("reduced_motion") {
        view[deep_canvas::schedule::REDUCED_MOTION] = r.clone();
    }
    view
}

/// What a session's frame draws: marks2d's draw list, in a build that holds marks2d, else the
/// core's boxes; and the text module's status marks with the legend, at the document's size.
pub(crate) struct Painted {
    pub drawing: Option<Arc<Drawing>>,
    pub boxes: Vec<CoreBox>,
    pub status: Option<Arc<StatusDrawing>>,
    pub size: [f64; 2],
}

/// An item of a canvas module's kind that the core draws as `rect@1` (Kind: `draws_as`): its
/// lowered box, moved by its world position, filled in the color of the role its paint names.
pub(crate) struct CoreBox {
    pub rect: [f64; 4],
    pub color: [u8; 3],
}

/// In a build without marks2d, the core's own boxes, in item order: every item whose kind a
/// canvas module registered with `draws_as: rect@1`. Marks2d draws them where it is held.
fn core_boxes(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
) -> Vec<CoreBox> {
    let mut items: Vec<(&str, &str)> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, item)| {
            item["kind"]
                .as_str()
                .is_some_and(|k| sched.sealed.draws_as(k) == Some("rect@1"))
        })
        .map(|(id, item)| (item["order"].as_str().unwrap_or(""), id.as_str()))
        .collect();
    items.sort();
    let json = |array: &str, id: &str| match session.value(sched, array, Some(id)) {
        Some(Val::Json(v)) => Some(v),
        _ => None,
    };
    let num = |v: &Value| v.as_f64().unwrap_or(0.0);
    items
        .into_iter()
        .filter_map(|(_, id)| {
            let lowered = json("core.lowered", id)?;
            let b = lowered["params"]["box"].as_array()?;
            let pos = session
                .value(sched, "core.world", Some(id))
                .and_then(|w| w.as_typed::<deep_canvas::schedule::core_ops::Transform>())
                .map(|w| [w.pos[0], w.pos[1]]);
            let [x, y] = pos.unwrap_or([0.0, 0.0]);
            let role = lowered["params"]["paint"]["fill"]["role"]
                .as_str()
                .unwrap_or("ink");
            let c = session.look().get(role)?.as_array()?;
            let channel = |i: usize| c.get(i)?.as_u64().and_then(|v| u8::try_from(v).ok());
            Some(CoreBox {
                rect: [
                    x + num(b.first()?),
                    y + num(b.get(1)?),
                    num(b.get(2)?),
                    num(b.get(3)?),
                ],
                color: [channel(0)?, channel(1)?, channel(2)?],
            })
        })
        .collect()
}

/// Each cell grid's marks (#402): a cell whose background isn't the grid's own as a box, then
/// each row as one line of the mono face, its runs in their cells' colors.
fn cell_grids(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
) -> Vec<deep_canvas_marks::scene::Drawn> {
    use deep_canvas_cells::module::Grid;
    use deep_canvas_marks::scene::{self, Fill, Mark};
    let mut out = Vec::new();
    // Each grid by its item, read once from the grid operator's own nodes (#854: a lookup per
    // item scanned every node, which a 10,000-item board paid on every frame).
    let grids: BTreeMap<&str, Val> = session
        .values(sched, "cells.grid")
        .into_iter()
        .filter_map(|(id, v)| Some((id?, v)))
        .collect();
    if grids.is_empty() {
        return out;
    }
    for (id, _) in doc["items"].as_object().into_iter().flatten() {
        let Some(g) = grids.get(id.as_str()).and_then(|v| v.as_typed::<Grid>()) else {
            continue;
        };
        let mark = |m: Mark| scene::Drawn {
            mark: m,
            clip: None,
            scopes: Vec::new(),
        };
        let [cw, ch] = g.cell;
        let w = cw * g.rows.first().map_or(0, |r| r.text.chars().count()) as f64;
        out.push(mark(Mark::Rect {
            item: id.clone(),
            bounds: [g.origin[0], g.origin[1], w, ch * g.rows.len() as f64],
            radius: 0.0,
            fill: Fill::Solid(g.bg),
        }));
        for (r, row) in g.rows.iter().enumerate() {
            let y = g.origin[1] + ch * r as f64;
            for (from, to, c) in &row.fills {
                out.push(mark(Mark::Rect {
                    item: id.clone(),
                    bounds: [
                        g.origin[0] + cw * *from as f64,
                        y,
                        cw * (to - from) as f64,
                        ch,
                    ],
                    radius: 0.0,
                    fill: Fill::Solid(*c),
                }));
            }
            let base = row.runs.first().map_or([0; 3], |r| r.2);
            let runs = row
                .runs
                .iter()
                .map(|(from, to, c)| scene::TextRun {
                    from: *from,
                    to: *to,
                    role: String::new(),
                    color: *c,
                })
                .collect();
            out.push(mark(Mark::Text {
                item: id.clone(),
                spec: scene::TextSpec {
                    text: row.text.trim_end().to_string(),
                    font: "mono".into(),
                    size: g.font_size,
                    weight: 400,
                    width: None,
                    align: scene::Align::Start,
                    bound: false,
                },
                origin: [g.origin[0], y],
                role: None,
                color: base,
                runs,
            }));
        }
    }
    out
}

/// What the frame's operators left in a session to draw; `None` before it has a document.
pub(crate) fn drawing_of(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Option<Painted> {
    let doc = session.document()?;
    let mut drawing = session
        .value(sched, "marks2d.frame", None)
        .and_then(|v| v.as_typed::<Drawing>());
    // #402: each cell grid's rows, drawn through the one shaper over the frame's marks.
    let grids = cell_grids(sched, session, doc);
    if let (Some(d), false) = (&mut drawing, grids.is_empty()) {
        let mut frame = d.frame.clone();
        frame.layers.push(deep_canvas_marks::scene::Layer {
            id: "cells".into(),
            marks: grids.into_iter().map(Arc::new).collect(),
            key: deep_canvas_marks::key::ContentKey([0; 16]),
        });
        *d = Arc::new(Drawing {
            frame,
            runs: d.runs.clone(),
            animated: d.animated.clone(),
        });
    }
    let status = session
        .value(sched, "text.status", None)
        .and_then(|v| v.as_typed::<StatusDrawing>());
    let side = |k: usize| doc["size"][k].as_f64().unwrap_or(1.0);
    let boxes = match drawing {
        Some(_) => Vec::new(),
        None => core_boxes(sched, session, doc),
    };
    Some(Painted {
        drawing,
        boxes,
        status,
        size: [side(0), side(1)],
    })
}

/// A value's Debug text, as a diagnostic shows it; never a digest's input. A test build with
/// `test-debug-alt` prints every value another way, as another compiler might (#855).
pub(crate) fn debug_text(value: &dyn std::fmt::Debug) -> String {
    if cfg!(feature = "test-debug-alt") {
        format!("{value:#?} (alt)")
    } else {
        format!("{value:?}")
    }
}

/// The SHA-256 of the Debug text of the typed values a node wrote, in the order it wrote them;
/// `null` when it wrote none. A diagnostic only: no key or digest reads it.
fn debug_digest(values: &[Val]) -> Value {
    let texts: Vec<String> = values
        .iter()
        .filter_map(Val::debug)
        .map(debug_text)
        .collect();
    if texts.is_empty() {
        return Value::Null;
    }
    json!(deep_canvas::schedule::sha256_hex(texts.concat().as_bytes()))
}
