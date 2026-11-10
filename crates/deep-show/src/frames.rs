//! The scheduler's side of `deep-show run` (issue #387; the #387 acceptance README: The surface
//! under test): the registry with every operator and contribution the seal kept, the canvas
//! modules' fixtures, `eval` (one frame of a document's session, live or clean, with a read-set
//! perturbation), `frames` (the scheduler's allocations and CPU per frame), interned handles and
//! outside data's batches.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::shaper::Pending;
use deep_canvas::document::Issue;
use deep_canvas::schedule::{
    default_view, HashVersion, OpIssue, Session as DocSession, Target, Val,
};
use deep_canvas_marks::modules::{Drawing, Run, StatusDrawing};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Call, Eval, Frames, Hub, Show, INTERFACE_RUNS, SEAL_RUNS};
use crate::snapshot::{self, Drawn, Unfit};

/// An operator's error as a revision's issue.
pub fn op_issue(i: &OpIssue) -> Issue {
    let what = format!("{} can't evaluate this", i.operator);
    let actual = i.actual.clone().unwrap_or(Value::Null);
    // #544: a read a logic item doesn't declare names its close declared names as the canvas
    // does an unknown kind's.
    let close = actual.get("close").and_then(Value::as_array).into_iter().flatten().map(|n| json!({"name": n})).collect();
    let issue = match &i.item {
        Some(id) => Issue::error(i.code, id, i.path.clone(), actual, &what),
        None => Issue::envelope(i.code, i.path.clone(), actual, &what),
    };
    Issue { close, ..issue }
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
                        "visibility": if a.private { "private" } else { "public" },
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
                let mut pass = json!({"module": m.name, "place": p.place});
                // #200: the gpu.step@1 steps a GPU pass compiles from, each resolved at the seal.
                if !p.steps.is_empty() {
                    pass["steps"] = json!(p.steps);
                }
                passes.insert(p.name.clone(), pass);
                cost(&p.name, &m.name);
            }
        }
        // #411: every item kind the build draws, as documents name it, with its canvas module.
        let kinds: Map<String, Value> = crate::kit::manifest::Manifest::kinds_of(sealed)
            .into_iter()
            .map(|k| {
                let module = self.module_of(&k);
                (k, json!(module))
            })
            .collect();
        json!({
            "build_set": sealed.build_set.name(),
            "state": sealed.state(),
            "kinds": kinds,
            "modules": sealed.modules.iter().map(|m| m.name.clone()).collect::<Vec<_>>(),
            "versions": sealed.modules.iter().map(|m| (m.name.clone(), json!(m.version.to_string()))).collect::<Map<_, _>>(),
            "digests": sealed.modules.iter().map(|m| (m.name.clone(), json!(m.digest))).collect::<Map<_, _>>(),
            "arrays": arrays,
            "operators": operators,
            "passes": passes,
            "costs": costs,
            "plan": sealed.plan,
            "schedule": {"uri": sealed.schedule_uri(), "sha256": deep_canvas::schedule::sha256_hex(&deep_canvas::schedule::canonical(&sealed.schedule()))},
            "seal": {"ms": self.startup.seal_ms, "runs": SEAL_RUNS.load(Ordering::Relaxed),
                     "interfaces": {"ms": sealed.interface_ns as f64 / 1e6, "runs": INTERFACE_RUNS.load(Ordering::Relaxed)},
                     "registries": {"ms": sealed.registry_ns as f64 / 1e6, "runs": INTERFACE_RUNS.load(Ordering::Relaxed)}},
            "registries": {"uri": sealed.registries_uri()},
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
        // #544's planted start_on: a run starts at the session's first frame at or after it.
        if self.scenario.planted == Some(crate::hub::Planted::StartOnAtFirstFrame) && !self.first_frames.contains_key(&e.doc) {
            self.first_frames.insert(e.doc.clone(), t);
            if let Some(mut d) = session.document().cloned() {
                crate::logic::from_first_frame(&mut d, t);
                session.load(&mut self.sched, &d);
            }
        }
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
        if !e.arrays.is_empty() {
            // #497: each named array as this frame read it.
            let read: Map<String, Value> = e
                .arrays
                .iter()
                .map(|name| {
                    let v = evaluated.array(&self.sched, name);
                    let n = v.as_ref().and_then(|v| v.as_typed::<i64>()).map(|n| json!(*n));
                    let x = v.as_ref().and_then(|v| v.as_typed::<f64>()).map(|x| json!(*x));
                    // #533: a logic item's array `<logic ID>.<name>` of count 1, as the logic
                    // module's last step at or before the frame left it.
                    let logic = || {
                        let state = evaluated.array(&self.sched, deep_logic::module::STATE)?;
                        let state = state.as_typed::<deep_logic::module::State>()?;
                        match state.arrays.get(name)?.as_slice() {
                            [one] => Some(one.clone()),
                            _ => None,
                        }
                    };
                    (name.clone(), n.or(x).or_else(logic).unwrap_or(Value::Null))
                })
                .collect();
            reply["arrays"] = Value::Object(read);
        }
        if self.startup.test_build {
            reply["access"] = json!(report
                .access
                .iter()
                .map(|a| json!({"operator": a.operator, "item": a.item, "read": a.read}))
                .collect::<Vec<_>>());
        }
        // #493: a 2D film's shots: the sides its frame draws, and the film block.
        let reduced = e.view.get("reduced_motion").and_then(Value::as_bool).unwrap_or(false);
        let program = crate::film::program_of(&self.sched, evaluated);
        let document = evaluated.document().cloned();
        let sides = match (&program, &document) {
            (Some(p), Some(d)) => crate::film::sides(p, d, t, reduced),
            _ => None,
        };
        let drawing = if e.pixels || e.film {
            drawing_of(&self.sched, evaluated)
        } else {
            None
        };
        // #499: each video image item's frame at t, and its picture for the snapshot.
        if let Some(d) = &document {
            let (video, pictures) = self.videos_at(d, t, false);
            if !video.is_empty() {
                reply["video"] = Value::Object(video);
            }
            self.renderer.videos = pictures;
        }
        if e.film {
            let glyphs = drawing
                .as_ref()
                .and_then(|d| self.renderer.prepare_drawing(d, &self.scenario.evidence).ok())
                .map(|d| d.glyphs())
                .unwrap_or_default();
            reply["film"] = match (&program, &document) {
                (Some(p), Some(d)) => crate::film::block(p, d, t, reduced, glyphs),
                _ => json!({"cameras": {}, "dissolve": null, "parallax": {}, "glyphs": glyphs}),
            };
        }
        let drawing = drawing.filter(|_| e.pixels);
        reply["hashes"] = json!(self
            .sched
            .take_hashes()
            .iter()
            .map(|h| json!({"of": h.of, "bytes": h.bytes}))
            .collect::<Vec<_>>());
        if let Some(drawing) = drawing {
            let drawn = match (&sides, &document) {
                (Some(sides), Some(doc)) => self.film_png(&drawing, e.size, sides, doc),
                _ => self.canonical_png(&drawing, e.size),
            };
            match drawn {
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
        let (rgba, drawn, size) = self.canonical_rgba(drawing, size, true)?;
        Ok((self.put_png(rgba, size)?, drawn, size))
    }

    /// #501: the raster [`Hub::canonical_png`] stores, straight RGBA rows top-down: over the
    /// look's ground when `opaque`, over nothing otherwise (an export with alpha). A still and an
    /// export frame are this one function, so each equals the live frame.
    pub(crate) fn canonical_rgba(
        &mut self,
        drawing: &Painted,
        size: Option<[u16; 2]>,
        opaque: bool,
    ) -> Result<(Vec<u8>, Drawn, [u16; 2]), Unfit> {
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let size = size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
        let rgba = self.renderer.raster(&drawn, size, self.ground(opaque));
        Ok((rgba, drawn, size))
    }

    /// The look's ground, when the frame is opaque.
    fn ground(&self, opaque: bool) -> Option<[u8; 3]> {
        opaque.then(|| self.look.light.get("ground").copied().unwrap_or([255; 3]))
    }

    /// A PNG of `rgba` in the evidence store, its SHA-256; a store that takes no write is unfit.
    pub(crate) fn put_png(&self, rgba: Vec<u8>, size: [u16; 2]) -> Result<String, Unfit> {
        evidence::put(&self.scenario.evidence, &snapshot::png(rgba, size)).map_err(|_| Unfit {
            code: "evidence_unwritable",
            path: "snapshots".into(),
        })
    }

    /// #493: [`Hub::canonical_png`] of a 2D film whose shots write its camera: each side the
    /// frame draws through its own camera, finished in its own look, the sides blended as
    /// finished pixels, and the status marks drawn once on top from the side that holds the
    /// reveal, never blended (Transition).
    pub(crate) fn film_png(
        &mut self,
        drawing: &Painted,
        size: Option<[u16; 2]>,
        sides: &crate::film::Sides,
        doc: &Value,
    ) -> Result<(String, Drawn, [u16; 2]), Unfit> {
        let (rgba, status, size) = self.film_rgba(drawing, size, sides, doc, true)?;
        Ok((self.put_png(rgba, size)?, status, size))
    }

    /// #501: the raster [`Hub::film_png`] stores, as [`Hub::canonical_rgba`] is to
    /// [`Hub::canonical_png`].
    pub(crate) fn film_rgba(
        &mut self,
        drawing: &Painted,
        size: Option<[u16; 2]>,
        sides: &crate::film::Sides,
        doc: &Value,
        opaque: bool,
    ) -> Result<(Vec<u8>, Drawn, [u16; 2]), Unfit> {
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let size = size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
        let ground = self.ground(opaque);
        let ink = self.look.light.get("ink").copied().unwrap_or([0; 3]);
        let frame = drawn.frame.size;
        let mut pictures = Vec::with_capacity(sides.sides.len());
        for side in &sides.sides {
            let part = drawn.part(Some(crate::film::view(&side.pose, frame)), true, false);
            let mut rgba = self.renderer.raster(&part, size, ground);
            if let Some(map) = side.look.as_deref().and_then(|l| self.tone_of(doc, l)) {
                crate::film::finish(&mut rgba, map);
            }
            pictures.push(rgba);
        }
        let mut rgba = match (&sides.mix, pictures.len()) {
            (Some(mix), 2) => crate::film::blend(&pictures[0], &pictures[1], mix, size, ink),
            _ => pictures.swap_remove(0),
        };
        let top = &sides.sides[sides.status.min(sides.sides.len() - 1)];
        let status = drawn.part(Some(crate::film::view(&top.pose, frame)), false, true);
        let over = self.renderer.raster(&status, size, None);
        crate::film::over(&mut rgba, &over);
        Ok((rgba, status, size))
    }

    /// A shot's look's tone map: the look@1 the document names by asset, read from the evidence
    /// store (#1162's way).
    fn tone_of(&self, doc: &Value, name: &str) -> Option<deep_canvas_marks::finish::ToneMap> {
        let sha = doc.pointer(&format!("/assets/{name}/sha256"))?.as_str()?;
        let bytes = (sha.len() == 64)
            .then(|| std::fs::read(self.scenario.evidence.join(&sha[..2]).join(&sha[2..])).ok())
            .flatten()?;
        let def: Value = serde_json::from_slice(&bytes).ok()?;
        deep_canvas_marks::finish::read_tone_map(def.get("tone_map")).ok()
    }

    /// The raster of a document with 3D writer layers: its 3D frame at `t` on the GPU, the 2D
    /// items drawn over it with no ground of their own, as render-back draws it (#1162), at
    /// `size` when given (#501).
    pub(crate) fn rgba3d(
        &mut self,
        doc: &Value,
        t: i64,
        drawing: &Painted,
        size: Option<[u16; 2]>,
    ) -> Result<(Vec<u8>, [u16; 2]), Unfit> {
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let size = size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
        let (mut rgba, size, _) = self.draw3d(doc, t, Some(size)).map_err(|()| Unfit {
            code: "gpu_unavailable",
            path: "snapshots".into(),
        })?;
        let over = self.renderer.raster(&drawn, size, None);
        snapshot::over(&mut rgba, &over);
        Ok((rgba, size))
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
        let mut revised_now = false;
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
                revised_now = true;
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
            // #1732: the solves of each arrangement this frame ran, from the scheduler's nodes.
            frame["solves"] = solves(&self.sched, &self.sessions[&f.doc], revised_now);
            revised_now = false;
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
            out.push(crate::shaper::shape_later(&spec));
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
                    family: Some(deep_text::Role::Mono.family()),
                    fallback: Vec::new(),
                    lang: None,
                    size: g.font_size,
                    weight: 400,
                    width: None,
                    max_lines: None,
                    mask: false,
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

/// Each vector writing on at t (#1162; Vector and formula `vector@1`: write_on), drawn as the
/// write draws it: the whole outline marks2d draws for it gives way to each of its paths as the
/// vector module's lowering writes them at the item's evaluated progress (outline first, then
/// fill), from the SVG the evidence store's holder inlined, in the look's roles. `None` when no
/// vector is mid-write.
fn written_vectors(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
    frame: &deep_canvas_marks::scene::Frame,
) -> Option<deep_canvas_marks::scene::Frame> {
    use deep_canvas::schedule::core_ops::Fields;
    use deep_canvas_marks::path::Verb;
    use deep_canvas_marks::scene::{Drawn, Fill, Line, Mark, Rgb};
    use deep_canvas_vector::{lower, svg};
    type Written = (Vec<Verb>, Option<(Rgb, f64)>, Option<(Rgb, f64, f64)>);
    let rgb = |role: Option<&str>| -> Option<Rgb> {
        let c = session.look().get(role?)?.as_array()?;
        let channel = |i: usize| c.get(i)?.as_u64().and_then(|v| u8::try_from(v).ok());
        Some([channel(0)?, channel(1)?, channel(2)?])
    };
    let mut swap: BTreeMap<&str, Vec<Written>> = BTreeMap::new();
    let mut mix = [0u8; 8];
    for (id, item) in doc["items"].as_object()? {
        if item["kind"].as_str() != Some("vector@1") {
            continue;
        }
        // With motion's edits folded in, as marks2d reads them.
        let Some(fields) = session
            .read(sched, "core.fields", Some(id))
            .and_then(|(v, _)| v.as_typed::<Fields>())
            .map(|f| f.to_json())
        else {
            continue;
        };
        let params = &fields["params"];
        let Some(progress) = params.pointer("/write_on/progress").and_then(Value::as_f64) else {
            continue;
        };
        let (Some(src), Some(map)) = (
            params.pointer("/outline/svg").and_then(Value::as_str),
            params.as_object(),
        ) else {
            continue;
        };
        if progress >= 1.0 {
            continue;
        }
        let classes: Vec<String> = params["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let (Ok(svg), Ok(colors)) = (
            svg::import(src.as_bytes(), &classes, svg::Twin::Honest),
            lower::colors(id, map),
        ) else {
            continue;
        };
        // In the item's own units: marks2d placed its outline at the mark's offset.
        let mut local = fields.clone();
        if let Some(m) = local.as_object_mut() {
            m.remove("at");
        }
        let mut paths = Vec::new();
        for (_, part) in lower::lower(id, &local, &svg, &colors, lower::Write::Honest) {
            let p = &part["params"];
            let Some(verbs) = p["d"].as_str().and_then(deep_canvas_marks::path::parse) else {
                continue;
            };
            let paint = |k: &str| -> Option<(Rgb, f64)> {
                let f = p.pointer(&format!("/paint/{k}"))?;
                Some((
                    rgb(f["role"].as_str())?,
                    f["opacity"].as_f64().unwrap_or(1.0),
                ))
            };
            let width = p.pointer("/paint/stroke/width").and_then(Value::as_f64);
            let stroke = paint("stroke").map(|(c, o)| (c, o, width.unwrap_or(1.0)));
            paths.push((verbs, paint("fill"), stroke));
        }
        for (m, b) in mix.iter_mut().zip(progress.to_bits().to_le_bytes()) {
            *m ^= b;
        }
        swap.insert(id.as_str(), paths);
    }
    if swap.is_empty() {
        return None;
    }
    let shift = |v: &Verb, [dx, dy]: [f64; 2]| {
        let s = |p: [f64; 2]| [p[0] + dx, p[1] + dy];
        match *v {
            Verb::Move(p) => Verb::Move(s(p)),
            Verb::Line(p) => Verb::Line(s(p)),
            Verb::Quad(a, b) => Verb::Quad(s(a), s(b)),
            Verb::Cubic(a, b, c) => Verb::Cubic(s(a), s(b), s(c)),
            Verb::Close => Verb::Close,
        }
    };
    let mut frame = frame.clone();
    for layer in &mut frame.layers {
        fn swapped<'m, 's>(
            m: &'m Drawn,
            swap: &'s BTreeMap<&str, Vec<Written>>,
        ) -> Option<(&'m String, [f64; 2], &'s Vec<Written>)> {
            match &m.mark {
                Mark::Path { item, offset, .. } => {
                    swap.get(item.as_str()).map(|p| (item, *offset, p))
                }
                _ => None,
            }
        }
        if !layer.marks.iter().any(|m| swapped(m, &swap).is_some()) {
            continue;
        }
        layer.marks = layer
            .marks
            .iter()
            .flat_map(|m| match swapped(m, &swap) {
                None => vec![m.clone()],
                // The whole outline unpainted first, so the item keeps its box in the view
                // while its write hasn't reached it all.
                Some((item, offset, paths)) => std::iter::once(match &m.mark {
                    Mark::Path { geometry, .. } => (geometry.verbs.clone(), None, None),
                    _ => (Vec::new(), None, None),
                })
                .chain(paths.iter().cloned())
                .map(|(verbs, fill, stroke)| {
                    Arc::new(Drawn {
                        mark: Mark::Shape {
                            item: item.clone(),
                            verbs: verbs.iter().map(|v| shift(v, offset)).collect(),
                            fill: fill.map(|(c, o)| (Fill::Solid(c), o)),
                            stroke: stroke.map(|(c, o, w)| Line {
                                width: w,
                                paint: Fill::Solid(c),
                                opacity: o,
                                dashes: None,
                                profile: None,
                            }),
                        },
                        clip: m.clip,
                        scopes: m.scopes.clone(),
                    })
                })
                .collect(),
            })
            .collect();
        for (k, b) in layer.key.0.iter_mut().zip(mix) {
            *k ^= b;
        }
    }
    Some(frame)
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
            built: d.built,
            damage: Vec::new(),
            basis: None,
        });
    }
    if let Some(d) = &mut drawing {
        if let Some(frame) = written_vectors(sched, session, doc, &d.frame) {
            *d = Arc::new(Drawing {
                frame,
                runs: d.runs.clone(),
                animated: d.animated.clone(),
                built: d.built,
                damage: Vec::new(),
                basis: None,
            });
        }
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

/// How many solves of each arrangement the session's last frame ran (#1732): the document's
/// check-phase solve when the frame took a new revision, and a frame-phase solve that wrote a
/// result.
fn solves(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &deep_canvas::schedule::Session,
    revised: bool,
) -> Value {
    let mut out = Map::new();
    let items = session
        .document()
        .and_then(|d| d.get("items"))
        .and_then(Value::as_object);
    for (id, _) in items
        .into_iter()
        .flatten()
        .filter(|(_, i)| deep_canvas_motion::arrange::is_arrangement(i))
    {
        out.insert(id.clone(), json!(0));
    }
    for n in session.nodes(sched) {
        if n.run != deep_canvas::schedule::Run::Ran {
            continue;
        }
        // The check-phase solve covers every arrangement of the document at once.
        let ids: Vec<String> = match (n.operator.as_str(), &n.item) {
            ("motion.arrange", None) if revised => out.keys().cloned().collect(),
            ("motion.arrangelive", Some(id))
                if n.values
                    .iter()
                    .any(|v| !matches!(v, deep_canvas::schedule::Val::None)) =>
            {
                vec![id.clone()]
            }
            _ => Vec::new(),
        };
        for id in ids {
            if let Some(c) = out.get_mut(&id) {
                *c = json!(c.as_u64().unwrap_or(0) + 1);
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod story_tests {
    use deep_canvas::registry::{BuildSet, Registry};
    use deep_canvas::schedule::{default_view, Options, Scheduler, Session};
    use deep_canvas_marks::modules::{tokens, Drawing};
    use deep_canvas_marks::scene::Mark;
    use serde_json::{json, Value};

    const SECOND: i64 = 705_600_000;

    fn numbers(v: &[i32]) -> Value {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
    }

    fn text(source: Value, order: &str) -> Value {
        json!({"id": order, "kind": "text@1", "name": order, "order": order, "layer": "a",
               "params": {"text": {"counter": {"source": source, "tabular": true,
                                               "format": {"group": "none"}}},
                          "size": 13, "box": {"w": 80, "h": 20}, "widest": "888888"}})
    }

    /// A race and a revealed line whose readers aren't touched as `at` and `to` move: labels
    /// through `rows_of`, counters on both anchors and on a driver, and a dot on the head.
    fn story() -> Value {
        let key = |at: &str, v: i32, after: i32| {
            json!({"target": at, "type": "f32", "keys": {
                "k0": {"t": "0s", "value": v, "interp": "linear"},
                "k1": {"t": "2s", "value": after, "interp": "linear"}}})
        };
        json!({
            "format": 1, "profile": "board", "title": "Story", "description": "d",
            "size": [320, 200], "transport": {"span": "2s"},
            "layers": {"a": {"writer": "agent:t", "title": "A", "order": "a1"}},
            "data": {"goal": {"value": 100, "source": "story"}, "share": {"value": 0, "source": "story"},
                     "shown": {"value": 0, "source": "story"}},
            "items": {
                "bars": {"id": "bars", "kind": "marks@1", "name": "Bars", "order": "a0", "layer": "a",
                         "params": {"mark": "point", "n": 2, "key": "key",
                                    "columns": {"year": numbers(&[2000, 2002]),
                                                "key": {"dtype": "str", "len": 2, "data": ["a", "a"]},
                                                "value": numbers(&[10, 30])},
                                    "transforms": [{"periods": {"by": "year", "at": 2000}}],
                                    "encode": {"x": {"column": "value"}, "y": 10}}},
                "labels": {"id": "labels", "kind": "marks@1", "name": "Labels", "order": "a1",
                           "layer": "a",
                           "params": {"mark": "text", "rows_of": "bars",
                                      "encode": {"x": 10, "y": 40, "text": {"column": "value"}}}},
                "line": {"id": "line", "kind": "marks@1", "name": "Line", "order": "a2", "layer": "a",
                         "params": {"mark": "path", "n": 2, "key": "year",
                                    "columns": {"year": numbers(&[0, 2]), "value": numbers(&[100, 140])},
                                    "transforms": [{"reveal": {"by": "year", "to": 0}}],
                                    "encode": {"x": {"column": "value"}, "y": 50}}},
                "dot": {"id": "dot", "kind": "circle@1", "name": "Dot", "order": "a3", "layer": "a",
                        "params": {"center": [0, 0], "r": 2, "paint": {"fill": {"role": "ink"}}},
                        "at": {"pos": [0, 0, 0], "anchor": "line#head"}},
                "p": text(json!("items/bars#period/by"), "p"),
                "q": text(json!("items/line#head/value"), "q"),
                "r": text(json!("climb"), "r")
            },
            "channels": {
                "at": key("items/bars/params/transforms/0/periods/at", 2000, 2002),
                "to": key("items/line/params/transforms/0/reveal/to", 0, 2),
                "share": key("data/share", 0, 1)
            },
            "drivers": {"climb": {"target": "data/shown", "expr": "goal * share",
                                  "vars": {"goal": "data/goal", "share": "data/share"}}}
        })
    }

    /// In a live session, what each reader of the rows shows at `t`, frame after frame: the
    /// operators of these items see no change of their own, so a stale value would stay.
    #[test]
    fn a_session_shows_what_the_rows_hold_at_t_in_every_reader() {
        let mut registry = Registry::new(BuildSet::R2);
        for m in crate::modules(BuildSet::R2) {
            registry = registry.with(m);
        }
        let sealed = registry.seal().expect("seals");
        let look = tokens(&crate::hub::shipped_look().light);
        let mut s = Scheduler::new(&sealed, Options::default());
        let doc = story();
        let mut live = Session::new(0, look);
        live.load(&mut s, &doc);
        for (t, labels, year, head, count, dot) in [
            (0, "10", "2000", "100", "0", 100.0),
            (SECOND / 2, "15", "2000", "110", "25", 110.0),
            (SECOND, "20", "2000", "120", "50", 120.0),
            (2 * SECOND, "30", "2002", "140", "100", 140.0),
        ] {
            live.frame(&mut s, t, &default_view(&doc));
            let refused: Vec<_> = live.report.issues.iter().map(|i| (i.code, &i.path)).collect();
            assert!(refused.is_empty(), "at {t}: {refused:?}");
            let drawing = live
                .value(&s, "marks2d.frame", None)
                .and_then(|v| v.as_typed::<Drawing>())
                .expect("a drawing");
            let shown = |item: &str| {
                let marks = drawing.frame.layers.iter().flat_map(|l| l.marks.iter());
                marks
                    .filter_map(|d| match &d.mark {
                        Mark::Text { item: i, spec, .. } if i == item => Some(spec.text.clone()),
                        _ => None,
                    })
                    .next()
                    .unwrap_or_else(|| panic!("{item} draws at {t}"))
            };
            let mut marks = drawing.frame.layers.iter().flat_map(|l| l.marks.iter());
            let at_dot = marks.find_map(|d| match &d.mark {
                Mark::Circle { item, center, .. } if item == "dot" => Some(center[0]),
                _ => None,
            });
            assert_eq!(shown("labels#a"), labels, "a label through rows_of at {t}");
            assert_eq!(shown("p"), year, "a counter on #period at {t}");
            assert_eq!(shown("q"), head, "a counter on #head at {t}");
            assert_eq!(shown("r"), count, "a counter on a driver at {t}");
            assert_eq!(at_dot, Some(dot), "an item on #head at {t}");
        }
    }
}
