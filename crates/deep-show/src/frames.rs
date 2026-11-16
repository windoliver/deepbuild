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
use crate::hub::{Call, Eval, EvalTime, Frames, Hub, Show, INTERFACE_RUNS, SEAL_RUNS};
use crate::snapshot::{self, Drawn, Unfit};

/// An operator's error as a revision's issue.
pub fn op_issue(i: &OpIssue) -> Issue {
    let what = format!("{} can't evaluate this", i.operator);
    let actual = i.actual.clone().unwrap_or(Value::Null);
    // #544: a read a logic item doesn't declare names its close declared names as the canvas
    // does an unknown kind's.
    let close = actual
        .get("close")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|n| json!({"name": n}))
        .collect();
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

    /// Every canvas module's fixtures, the core's first; a planted document, which the check
    /// refuses, is the kit's alone (#2085).
    pub fn fixtures_reply(&self) -> Value {
        let list: Vec<Value> = self
            .startup
            .sealed
            .fixtures
            .iter()
            .filter(|(_, f)| !f.planted)
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
        self.load_frame(doc, t);
        let session = self.sessions.get_mut(doc)?;
        let view = session_view(session, &Map::new());
        session.frame(&mut self.sched, t, &view);
        let drawing = drawing_of(&self.sched, session)?;
        self.renderer
            .prepare_drawing(&drawing, &self.scenario.evidence)
            .ok()
    }

    /// #223: `path` of an item under a group's warp: its outline as the frame at `t` draws it,
    /// through its groups' warps at their values then, each sub-path flattened to its points.
    pub fn warped_path(&mut self, doc: &str, item: &str, t: &EvalTime) -> Value {
        let t = match self.resolve_time(doc, t) {
            Ok(t) => t,
            Err(code) => return json!({"outcome": "refused", "code": code}),
        };
        self.load_frame(doc, t);
        let planted = crate::warps::planted(self.scenario.module_planted.as_deref());
        let Some(session) = self.sessions.get_mut(doc) else {
            return json!({"outcome": "refused", "code": "no_revision"});
        };
        let view = session_view(session, &Map::new());
        session.frame(&mut self.sched, t, &view);
        let (Some(form), Some(items)) = (
            session.document().and_then(Value::as_object).cloned(),
            crate::warps::items_at(&self.sched, session),
        ) else {
            return json!({"outcome": "refused", "code": "no_revision"});
        };
        match crate::warps::drawn(&form, &items, item, planted) {
            Ok(Some(subpaths)) => {
                json!({"item": item, "t": t, "subpaths": subpaths, "notices": []})
            }
            Ok(None) => json!({"outcome": "refused", "code": "ref_unresolved", "item": item}),
            Err(r) => json!({"outcome": "refused", "code": r.code, "item": item, "path": r.path}),
        }
    }

    /// #225: a vector field at its frame: its streams, its arrows and its flow windows at t, its
    /// vars as the frame read them, by the integrator the scenario plants, if any.
    pub fn vector_field(&mut self, doc: &str, item: &str, t: &EvalTime) -> Value {
        let t = match self.resolve_time(doc, t) {
            Ok(t) => t,
            Err(code) => return json!({"outcome": "refused", "code": code}),
        };
        self.load_frame(doc, t);
        let method =
            deep_canvas_marks::vector_field::method_of(self.scenario.module_planted.as_deref());
        let Some(session) = self.sessions.get_mut(doc) else {
            return json!({"outcome": "refused", "code": "no_revision"});
        };
        let view = session_view(session, &Map::new());
        session.frame(&mut self.sched, t, &view);
        let Some(items) = crate::warps::items_at(&self.sched, session) else {
            return json!({"outcome": "refused", "code": "no_revision"});
        };
        let Some(field) = items.get(item).filter(|i| {
            i.get("kind").and_then(Value::as_str) == Some(deep_canvas_marks::vector_field::KIND)
        }) else {
            return json!({"outcome": "refused", "code": "ref_unresolved", "item": item});
        };
        let seconds = t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        match deep_canvas_marks::vector_field::read_item(item, field, &|_| None, method) {
            Ok(vf) => deep_canvas_marks::vector_field::answer(item, &vf, seconds),
            Err(r) => json!({"outcome": "refused", "code": r.code, "item": item, "path": r.path}),
        }
    }

    /// One frame of a document's session (`eval`). #542: a golden pins each view setting to its
    /// declared default (Scope and input classes), so the frame leaves the session's view-class
    /// values out, and the live session gets them back after.
    pub fn eval(&mut self, e: &Eval) -> Value {
        let held = self.take_view(&e.doc);
        if held.is_some() {
            self.replay(&e.doc, self.now);
        }
        let reply = self.eval_frame(e);
        if let Some(view) = held {
            if let Some(s) = self.session_state.get_mut(&e.doc) {
                s["view"] = view;
            }
            self.replay(&e.doc, self.now);
        }
        reply
    }

    /// The document's view-class session values, taken out; none when it holds none.
    fn take_view(&mut self, doc: &str) -> Option<Value> {
        let view = self.session_state.get_mut(doc)?.get_mut("view")?;
        view.as_object()
            .is_some_and(|m| !m.is_empty())
            .then(|| view.take())
    }

    fn eval_frame(&mut self, e: &Eval) -> Value {
        if !self.doc_visible(&e.doc) {
            return json!({"outcome": "not_presented", "reason": "hidden", "nodes": []});
        }
        let rev = self.current(&e.doc).map(|r| r.rev);
        let t = match self.resolve_time(&e.doc, &e.t) {
            Ok(t) => t,
            Err(code) => return json!({"outcome": "refused", "code": code, "issues": []}),
        };
        match &e.track {
            Some(track) => self.load_with(&e.doc, track, t),
            None => self.load_frame(&e.doc, t),
        }

        // Planted (#504): a document with controls runs a program through the sandbox each frame.
        if self.planted(crate::hub::Planted::BoardRunsProgramPerFrame)
            && self
                .forms
                .get(&e.doc)
                .is_some_and(|f| f.get("controls").is_some())
        {
            self.sandbox.runs += 1;
        }
        // #169: every row of the core's carried-state list as a play on this track leaves it at
        // `t`, so steps the live session ran under another track never answer for it.
        let carried: Option<Value> = self.played_form(&e.doc).filter(|_| e.carried).map(|form| {
            let form = e
                .track
                .as_ref()
                .map_or(form.clone(), |t| crate::played::with_track(&form, t));
            (self.carried_at(&form, t).into_iter())
                .map(|c| json!({"owner": c.module, "kind": c.kind, "key": c.key, "hash": c.hash}))
                .collect()
        });
        let Some(session) = self.sessions.get_mut(&e.doc).filter(|_| rev.is_some()) else {
            return json!({"outcome": "refused", "code": "no_revision", "issues": []});
        };
        // #544's planted start_on: a run starts at the session's first frame at or after it.
        if self.scenario.planted == Some(crate::hub::Planted::StartOnAtFirstFrame)
            && !self.first_frames.contains_key(&e.doc)
        {
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
        let mut nodes: Vec<Value> = evaluated
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
        // Planted (#504): a plug-in's code computes a part each frame, outside every sealed operator.
        if self.scenario.planted == Some(crate::hub::Planted::PluginCodePerFrame) {
            nodes.push(json!({"operator": "plugin.place", "module": "plugin", "phase": "items", "item": null, "run": "ran"}));
        }
        // Planted (#233): math@1 expands its instances again each frame.
        if self.scenario.pack_planted.as_deref() == Some(crate::math_twins::EXPANDS_EACH_FRAME) {
            if let Some(form) = self.forms.get(&e.doc) {
                let again =
                    crate::math_twins::expand_again(form, &self.startup.sealed, &self.packs);
                nodes.extend(again);
            }
        }
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
        // #535: a logic column's row whose value goes out of range raises column.out_of_range at
        // the frame of the step its excursion begins.
        if let (Some(doc), Some(list)) = (evaluated.document(), reply["issues"].as_array_mut()) {
            // #537: and scene3d's readers', an instancer's columns and a line's points; #538: and
            // the cell grid's, keyed copy's and flip's, in the session's locale.
            let raised = [
                deep_canvas::columns::raised_at(doc, t),
                deep_canvas_scene3d::arrays::raised_at(doc, t),
                crate::logic::raised_at(
                    doc,
                    Some(t),
                    view[deep_canvas::schedule::LOCALE].as_str().unwrap_or("en"),
                ),
            ];
            list.extend(raised.iter().flatten().map(|i| i.to_json()));
        }
        if !e.arrays.is_empty() {
            // #497: each named array as this frame read it.
            let read: Map<String, Value> = e
                .arrays
                .iter()
                .map(|name| {
                    (
                        name.clone(),
                        deep_play::read::array(&self.sched, evaluated, name, t),
                    )
                })
                .collect();
            reply["arrays"] = Value::Object(read);
        }
        if !e.paths.is_empty() {
            reply["values"] = crate::query::values(&self.sched, evaluated, &e.paths);
        }
        if let Some(rows) = carried {
            reply["carried"] = rows;
        }
        if e.data_hash {
            reply["data_hash"] = json!(crate::data_hash::of(&self.sched, evaluated));
        }
        if self.startup.test_build {
            reply["access"] = json!(report
                .access
                .iter()
                .map(|a| json!({"operator": a.operator, "item": a.item, "read": a.read}))
                .collect::<Vec<_>>());
        }
        // #493: a 2D film's shots: the sides its frame draws, and the film block.
        let reduced = e
            .view
            .get("reduced_motion")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let program = crate::film::program_of(&self.sched, evaluated);
        let document = evaluated.document().cloned();
        let sides = match (&program, &document) {
            (Some(p), Some(d)) => crate::film::sides(p, d, t, reduced),
            _ => None,
        };
        // #507: the timeline position the frame at this clock time shows.
        reply["position"] = json!(program.as_ref().map_or(t, |p| p.position(t).0));
        // #1968: each text diff's tokens at t, for the film block.
        let diffs = e.film.then(|| diff_report(&self.sched, evaluated));
        let drawing = if e.pixels || e.film || e.texts {
            drawing_of(&self.sched, evaluated).map(|p| match &document {
                // #466: the look's boil on the frame's lines.
                Some(d) => self.boiled(d, t, reduced, p),
                None => p,
            })
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
            self.caption_at(d, t);
        }
        if e.film {
            let glyphs = drawing
                .as_ref()
                .and_then(|d| {
                    self.renderer
                        .prepare_drawing(d, &self.scenario.evidence)
                        .ok()
                })
                .map(|d| d.glyphs())
                .unwrap_or_default();
            let mut film = match (&program, &document) {
                (Some(p), Some(d)) => crate::film::block(p, d, t, reduced, glyphs),
                _ => json!({"cameras": {}, "dissolve": null, "parallax": {}, "glyphs": glyphs}),
            };
            film["diffs"] = Value::Object(diffs.unwrap_or_default());
            reply["film"] = film;
            // #466: every list the document's reveals compile.
            if let Some(d) = &document {
                reply["film"]["occurrences"] = Value::Object(self.reveal_lists(d));
            }
        }
        if e.texts {
            reply["texts"] = Value::Object(
                drawing
                    .as_ref()
                    .and_then(|d| d.drawing.as_deref())
                    .map(crate::film_audit::drawn_texts)
                    .unwrap_or_default(),
            );
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
        // #903: the tour pointer as this frame draws it, in px of the frame at its own size.
        if e.tour_pointer {
            let form = self.played_form(&e.doc).map(|form| match &e.track {
                Some(track) => crate::played::with_track(&form, track),
                None => form,
            });
            let pointer = form.and_then(|f| self.tour_pointer(&f, t, reduced));
            reply["tour_pointer"] = crate::tour::reading(pointer);
        }
        // #504: an eval's own track lasts the call: the session goes back to the hub's.
        if e.track.is_some() {
            self.replay(&e.doc, t);
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
        let rgba = if self.renderer.caption.is_some() {
            // #502: the caption layer draws over every item and under the status marks.
            let mut rgba = self.renderer.raster(
                &drawn.part(drawn.view, true, false),
                size,
                self.ground(opaque),
            );
            self.caption_over(&mut rgba, size);
            let status = self
                .renderer
                .raster(&drawn.part(drawn.view, false, true), size, None);
            snapshot::over(&mut rgba, &status);
            rgba
        } else {
            self.renderer.raster(&drawn, size, self.ground(opaque))
        };
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
        let (rgba, status, size) = self.film_rgba(drawing, size, sides, doc, (true, None))?;
        Ok((self.put_png(rgba, size)?, status, size))
    }

    /// #501: the raster [`Hub::film_png`] stores, as [`Hub::canonical_rgba`] is to
    /// [`Hub::canonical_png`]; an export's (#157) opaque sides each through their look's print
    /// finish at `print_at` (its grain), as the canvas shows them.
    pub(crate) fn film_rgba(
        &mut self,
        drawing: &Painted,
        size: Option<[u16; 2]>,
        sides: &crate::film::Sides,
        doc: &Value,
        (opaque, print_at): (bool, Option<i64>),
    ) -> Result<(Vec<u8>, Drawn, [u16; 2]), Unfit> {
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let size = size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
        let ground = self.ground(opaque);
        // #466: a dip's color is a look role, ink unless it names another.
        let role = match &sides.mix {
            Some(crate::film::Mix::Dip { role, .. }) => role.as_str(),
            _ => "ink",
        };
        let Some(ink) = self.look.light.get(role).copied() else {
            return Err(Unfit {
                code: "role_unresolved",
                path: "transitions".into(),
            });
        };
        let frame = drawn.frame.size;
        let mut pictures = Vec::with_capacity(sides.sides.len());
        for side in &sides.sides {
            let part = drawn.part(Some(crate::film::view(&side.pose, frame)), true, false);
            let printed = match print_at
                .filter(|_| opaque)
                .and_then(|t| Some((t, self.print_look(doc, side.look.as_deref())?)))
            {
                Some((t, def)) => self.print_part(&def, doc, &part, size, t)?,
                None => None,
            };
            let mut rgba = printed.unwrap_or_else(|| self.renderer.raster(&part, size, ground));
            if let Some(map) = side.look.as_deref().and_then(|l| self.tone_of(doc, l)) {
                crate::film::finish(&mut rgba, map);
            }
            pictures.push(rgba);
        }
        let mut rgba = match (&sides.mix, pictures.len()) {
            (Some(mix), 2) => {
                let pass = self.transition_pass(doc, mix, &pictures, size)?;
                crate::film::blend(&pictures[0], &pictures[1], mix, size, ink, pass.as_deref())
            }
            _ => pictures.swap_remove(0),
        };
        self.caption_over(&mut rgba, size);
        let top = &sides.sides[sides.status.min(sides.sides.len() - 1)];
        let status = drawn.part(Some(crate::film::view(&top.pose, frame)), false, true);
        let over = self.renderer.raster(&status, size, None);
        crate::film::over(&mut rgba, &over);
        Ok((rgba, status, size))
    }

    /// #466: an operator transition's pass over the two finished sides, or `None` for a mix of
    /// another kind.
    fn transition_pass(
        &self,
        doc: &Value,
        mix: &crate::film::Mix,
        pictures: &[Vec<u8>],
        size: [u16; 2],
    ) -> Result<Option<Vec<u8>>, Unfit> {
        let crate::film::Mix::Operator { id, op, p } = mix else {
            return Ok(None);
        };
        let roles = self
            .look
            .light
            .iter()
            .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
            .collect();
        let sides = [pictures[0].as_slice(), pictures[1].as_slice()];
        crate::film_operator::draw(doc, id, op, *p, sides, size, &roles).map(Some)
    }

    /// A shot's look's tone map: the look@1 the document names by asset, read from the evidence
    /// store (#1162's way).
    fn tone_of(&self, doc: &Value, name: &str) -> Option<deep_canvas_marks::finish::ToneMap> {
        let def = self.look_named(doc, name)?;
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
        let size = size.unwrap_or_else(|| snapshot::px(drawing.size));
        // #506: with its insets' pictures, its overlay frames at their anchors and its view
        // overlays (over3d.rs).
        let mut rgba = self
            .frame3d(doc, t, size, Some(drawing))
            .map_err(|u| match u.code {
                "unsupported_platform" => Unfit {
                    code: "gpu_unavailable",
                    path: "snapshots".into(),
                },
                _ => u,
            })?;
        self.caption_over(&mut rgba, size);
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
        let mut seen = BTreeMap::new();
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
            let t = f.from + f.step * k as i64;
            self.load_frame(&f.doc, t);
            let Some(session) = self.sessions.get_mut(&f.doc) else {
                break;
            };
            let view = session_view(session, &Map::new());
            let before = f
                .timings
                .then(|| crate::timings::mappings(&self.sched, session));
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
            frame["remaps"] = remaps(&self.sched, &self.sessions[&f.doc]);
            if let (Some(before), Some(doc)) = (&before, self.sessions[&f.doc].document()) {
                let after = crate::timings::mappings(&self.sched, &self.sessions[&f.doc]);
                crate::timings::add(&mut frame, (doc, before, &after, t), &mut seen);
                let (tokens, aligns) =
                    crate::timings::code(&self.sched, &self.sessions[&f.doc], doc);
                frame["tokens"] = tokens;
                frame["aligns"] = aligns;
            }
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

pub(crate) use deep_play::drawing::Painted;

/// What a session's frame draws, as [`deep_play::drawing::drawing_of`] reads it, with this build's
/// film placement (#466).
pub(crate) fn drawing_of(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Option<Painted> {
    deep_play::drawing::drawing_of(sched, session, &crate::film::program_of)
}

/// Each text diff's tokens at the session's time, for the film block (#1968).
pub(crate) fn diff_report(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Map<String, Value> {
    deep_play::drawing::diff_report(sched, session, &crate::film::program_of)
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
/// #535: for each mark set that reads a logic array, the rows its data module mapped again for
/// each step the frame applied, `[{set, step, rows}]`: a set's rows remapped for a step are its
/// columns' most.
fn remaps(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &deep_canvas::schedule::Session,
) -> Value {
    type Mapped = BTreeMap<String, deep_canvas::columns::Mapped>;
    let mut out = Vec::new();
    for n in session.nodes(sched) {
        let (Some(set), true) = (
            &n.item,
            n.operator == "data.columns" && n.run == deep_canvas::schedule::Run::Ran,
        ) else {
            continue;
        };
        let Some(columns) = n.values.iter().find_map(|v| v.as_typed::<Mapped>()) else {
            continue;
        };
        let mut steps: BTreeMap<i64, usize> = BTreeMap::new();
        for (step, rows) in columns.values().flat_map(|m| &m.remaps) {
            let e = steps.entry(*step).or_default();
            *e = (*e).max(*rows);
        }
        out.extend(
            steps
                .into_iter()
                .map(|(step, rows)| json!({"set": set, "step": step, "rows": rows})),
        );
    }
    Value::Array(out)
}

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
            let refused: Vec<_> = live
                .report
                .issues
                .iter()
                .map(|i| (i.code, &i.path))
                .collect();
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
