//! Issue #384: point and ask (Selection). You type into a panel's ask box and send it to an
//! agent's session: what you point at, or the panel's selection, goes beside your words as an
//! attachment `{handles, t, doc_rev, precision, region?, quote?}`: the frame's time, the revision
//! you saw, how exactly the pointer hit, and the text of a text item under it as a quote, never
//! folded into your words. Each handle resolves when the agent reads it, against the revision
//! current then: one whose item is gone comes back `detached`, with its last name and the writer
//! and revision that removed it, and the ask-task stays open. Render-back draws any revision a
//! document has had at any time, so the agent can see the frame you pointed at.

use deep_canvas::scope::{region_about, Pointed, Precision};
use deep_canvas::show::Writer;
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::refused;

/// One message an ask sent to a session, as sent.
pub struct Asked {
    pub words: String,
    pub attachment: Map<String, Value>,
    /// The doc ID the attachment's handles name, if any.
    pub doc: Option<String>,
    pub task: String,
}

fn region_json(r: [f64; 4]) -> Value {
    json!({"x": r[0], "y": r[1], "w": r[2], "h": r[3]})
}

/// An ask-task as it stands: its handle, its state and whether it is open. An ask the agent
/// hasn't started is `queued` (States people see).
fn task_json(handle: &str, closed: bool) -> Value {
    match closed {
        false => json!({"handle": handle, "state": "queued", "open": true}),
        true => json!({"handle": handle, "state": "closed", "open": false}),
    }
}

impl Hub<'_> {
    /// `ask`: your words sent from a panel's ask box to a session, about what `pointer` (window
    /// px) points at, or without one about the panel's selection; opens an ask-task.
    pub fn ask(
        &mut self,
        panel: &str,
        session: &str,
        words: &str,
        pointer: Option<[f64; 2]>,
    ) -> Value {
        if !self.scenario.sessions.contains_key(session) {
            return refused("no_session");
        }
        let Some(spec) = self.scenario.panels.get(panel) else {
            return refused("unknown_panel");
        };
        let planted = self.scenario.planted;
        let mut attachment = Map::new();
        let mut doc_id = None;
        if let Some(page) = &spec.html {
            // A web page holds no item IDs: a place on it is a region of the page, in page px.
            if !page.is_file() {
                return refused("not_presented");
            }
            // A page has no selection, so an ask on it points somewhere.
            let Some(p) = pointer else {
                return refused("nothing_pointed");
            };
            let r = self.slot(panel).unwrap_or(spec.rect);
            let at = [p[0] - r[0], p[1] - r[1]];
            attachment.insert("handles".into(), json!([]));
            attachment.insert("precision".into(), json!(Precision::Region.name()));
            attachment.insert(
                "region".into(),
                region_json(region_about(at, [0.0, 0.0, r[2], r[3]])),
            );
        } else {
            if let Err(e) = self.panel_scope(panel) {
                return e;
            }
            let (Some(doc), Some(shown)) = (self.panel_doc(panel), self.panel_document(panel))
            else {
                return refused("not_presented");
            };
            let scope = &self.scopes[panel].scope;
            let t = scope.playhead().unwrap_or(self.now);
            let mut pointed = match pointer {
                Some(p) => scope.point(&shown.0, p),
                None if scope.selection().is_empty() => return refused("nothing_selected"),
                None => Pointed {
                    id: None,
                    precision: Precision::Id,
                    region: None,
                    quote: None,
                },
            };
            // A 3D view's 2D items draw over it (Writer layer: overlays), so they take the
            // pointer first, a vector item by its part; a text under the pointer, 2D or a label
            // in depth, is the quote (#1162).
            let rect = self.placed(panel).map(|p| p.0).or(self.slot(panel));
            if let (Some(p), Some(rect)) = (pointer, rect) {
                if deep_canvas_scene3d::scene::has_3d(&shown.0) {
                    let at = [p[0] - rect[0], p[1] - rect[1]];
                    let (hit, quote) = self.overlay_at(&shown.0, t, [rect[2], rect[3]], at);
                    if let Some(id) = hit {
                        pointed = Pointed {
                            id: Some(id),
                            precision: Precision::Id,
                            region: None,
                            quote: None,
                        };
                    }
                    if quote.is_some() {
                        pointed.quote = quote;
                    }
                }
            }
            let scope = &self.scopes[panel].scope;
            let ids: Vec<String> = match (&pointer, &pointed.id) {
                (None, _) => scope.selection().to_vec(),
                (Some(_), Some(id)) => vec![id.clone()],
                (Some(_), None) => Vec::new(),
            };
            let handles: Vec<String> = ids.iter().map(|id| format!("doc:{doc}#{id}")).collect();
            attachment.insert("handles".into(), json!(handles));
            // The frame's time: the playhead's where the transport is paused, else the clock's;
            // a still, which has no transport, has none.
            if shown.0.get("transport").is_some() {
                attachment.insert("t".into(), json!(t));
            }
            let seen = self.rev_at(&doc, scope.time().unwrap_or(self.now));
            attachment.insert("doc_rev".into(), json!(seen));
            attachment.insert("precision".into(), json!(pointed.precision.name()));
            if let Some(r) = pointed.region {
                attachment.insert("region".into(), region_json(r));
            }
            if let Some(q) = pointed.quote {
                attachment.insert("quote".into(), json!(q));
            }
            doc_id = Some(doc);
        }
        let mut words = words.to_string();
        match planted {
            Some(Planted::BoxFoldsQuote) => {
                if let Some(Value::String(q)) = attachment.remove("quote") {
                    words = format!("{words} {q}");
                }
            }
            Some(Planted::BoxDropsT) => {
                attachment.remove("t");
            }
            Some(Planted::BoxDropsDocRev) => {
                attachment.remove("doc_rev");
            }
            Some(Planted::BoxSendsEveryId) => {
                attachment.insert("precision".into(), json!(Precision::Id.name()));
            }
            _ => {}
        }
        self.serial += 1;
        let serial = self.serial;
        let task = format!("task:{session}-{serial}");
        let asked = Asked {
            words,
            attachment,
            doc: doc_id,
            task,
        };
        let message = json!({
            "words": asked.words,
            "attachment": asked.attachment,
            "task": task_json(&asked.task, false),
        });
        self.asks
            .entry(session.to_string())
            .or_default()
            .push(asked);
        json!({"serial": serial, "message": message})
    }

    /// `messages`: a session's messages as the agent reads them now, each handle resolved
    /// against the revision current, and the handles the session shows as its context.
    pub fn messages(&mut self, session: &str) -> Value {
        if !self.scenario.sessions.contains_key(session) {
            return refused("no_session");
        }
        let mut context: Vec<String> = Vec::new();
        let mut out = Vec::new();
        let asks = self
            .asks
            .get(session)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for asked in asks {
            let handles: Vec<String> = asked.attachment["handles"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|h| h.as_str().map(str::to_string))
                .collect();
            let mut closed = false;
            let resolved: Vec<Value> = handles
                .iter()
                .map(|h| {
                    let r = self.resolve_handle(asked.doc.as_deref(), h);
                    if r["state"] == "detached" {
                        match self.scenario.planted {
                            Some(Planted::ResolverOnlyRefUnresolved) => {
                                return json!({"handle": h, "code": "ref_unresolved"})
                            }
                            Some(Planted::ResolverClosesTask) => closed = true,
                            _ => {}
                        }
                    }
                    r
                })
                .collect();
            for h in handles {
                if !context.contains(&h) {
                    context.push(h);
                }
            }
            out.push(json!({
                "words": asked.words,
                "attachment": asked.attachment,
                "task": task_json(&asked.task, closed),
                "resolved": resolved,
            }));
        }
        json!({"messages": out, "context": context})
    }

    /// One handle as the agent reads it now: `live` with its item and name while the revision
    /// current holds it; `detached` with its last name and the revision that removed it, and
    /// that revision's writer, once it is gone; `ref_unresolved` for one it never named.
    fn resolve_handle(&self, doc: Option<&str>, handle: &str) -> Value {
        let unresolved = || json!({"handle": handle, "code": "ref_unresolved"});
        let (Some(doc), Some(id)) = (doc, handle.split_once('#').map(|(_, id)| id)) else {
            return unresolved();
        };
        let Some(now) = self.rev_at(doc, self.now) else {
            return unresolved();
        };
        let item = |rev: u64| {
            let d = self.revision(doc, rev)?;
            d.get("items")?.get(id).cloned()
        };
        let name = |item: &Value| item.get("name").cloned().unwrap_or(Value::Null);
        if let Some(it) = item(now) {
            return json!({"handle": handle, "state": "live", "id": id, "name": name(&it)});
        }
        // The last revision up to now that held it, and the one after it that removed it.
        let revs: Vec<u64> = self
            .currents(doc)
            .into_iter()
            .map(|(_, r)| r)
            .filter(|r| *r <= now)
            .collect();
        let held = revs.iter().rev().find_map(|r| item(*r).map(|it| (*r, it)));
        let Some((last, it)) = held else {
            return unresolved();
        };
        let Some(removed) = revs.iter().copied().find(|r| *r > last) else {
            return unresolved();
        };
        let writer = self.rev_writer(doc, removed).map(|w| w.to_json());
        json!({
            "handle": handle,
            "state": "detached",
            "name": name(&it),
            "removed": {"writer": writer, "rev": removed},
        })
    }

    /// What `at` (px from the view's top-left, a view of `size` px) is over at `t` in `doc`, a
    /// document drawn in 3D whose 2D items draw over the view at their evaluated boxes: the
    /// topmost 2D item there, as `item#part` on a vector item's part, and the text of a text
    /// item under it, a 2D one or a label in depth at its drawn box (Selection: `quote`).
    fn overlay_at(
        &mut self,
        doc: &Value,
        t: i64,
        size: [f64; 2],
        at: [f64; 2],
    ) -> (Option<String>, Option<String>) {
        let empty = Map::new();
        let items = doc.get("items").and_then(Value::as_object).unwrap_or(&empty);
        let order = |id: &str| {
            let item = items.get(id);
            let order = item.and_then(|i| i.get("order")).and_then(Value::as_str);
            order.unwrap_or_default().to_string()
        };
        let text_of = |id: &str| -> Option<String> {
            let item = items.get(id)?;
            let params = item.get("params")?;
            match params.get("template").and_then(Value::as_str) {
                Some(template) => deep_canvas::template::expand(doc, template).ok(),
                None => params.get("text")?.as_str().map(str::to_string),
            }
        };
        let within = |b: [f64; 4], p: [f64; 2]| {
            p[0] >= b[0] && p[1] >= b[1] && p[0] <= b[0] + b[2] && p[1] <= b[1] + b[3]
        };
        // The 2D items draw one document unit to a px of a view the document's size.
        let page = [0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(size[i]));
        let u = [0, 1].map(|i| at[i] * page[i] / size[i].max(1.0));
        // The form the frame draws: the agent's tables and the vectors inlined (#1162).
        let mut form = doc.clone();
        let _ = self.inline_tables(&mut form);
        let _ = self.inline_vectors(&mut form);
        let session = self.evaluated(&form, t);
        let mut hits: Vec<(String, String)> = Vec::new();
        let mut quote = None;
        if let Some(drawing) = crate::frames::drawing_of(&self.sched, &session) {
            if let Ok(drawn) = self
                .renderer
                .prepare_drawing(&drawing, &self.scenario.evidence)
            {
                for (id, _) in drawn.boxes().into_iter().filter(|(_, b)| within(*b, u)) {
                    let text = items.get(&id).and_then(|i| i.get("kind")) == Some(&json!("text@1"));
                    if text && quote.is_none() {
                        quote = text_of(&id);
                    }
                    hits.push((order(&id), id));
                }
            }
        }
        // A vector item's parts, each at its box where the item is placed at t.
        let bytes = |sha: &str| crate::evidence::read(&self.scenario.evidence, sha);
        let whole = doc.as_object().cloned().unwrap_or_default();
        let (_, imported) =
            deep_canvas_vector::check(&whole, bytes, deep_canvas_vector::svg::Twin::Honest);
        for (id, found) in &imported {
            let Some(mut item) = items.get(id).cloned() else {
                continue;
            };
            let world = ["marks2d.at", "core.world"].iter().find_map(|a| {
                let (v, _) = session.read(&self.sched, a, Some(id.as_str()))?;
                v.as_typed::<deep_canvas::schedule::core_ops::Transform>()
                    .map(|t| t.pos)
            });
            // One the frame didn't place draws nowhere, so nothing hits it.
            let Some(pos) = world else {
                continue;
            };
            item["at"] = json!({"pos": pos});
            let part = found
                .svg
                .parts
                .iter()
                .filter_map(|p| {
                    let b = deep_canvas_vector::bounds(&item, found, Some(p.id.as_str()))?;
                    within(b, u).then(|| (b[2] * b[3], p.id.clone()))
                })
                .min_by(|a, b| a.0.total_cmp(&b.0));
            match part {
                Some((_, part)) => hits.push((order(id), format!("{id}#{part}"))),
                None => {
                    let whole = deep_canvas_vector::bounds(&item, found, None);
                    if whole.is_some_and(|b| within(b, u)) {
                        hits.push((order(id), id.clone()));
                    }
                }
            }
        }
        // A label in depth under the pointer, at the box it draws in.
        if quote.is_none() {
            let mut sized = doc.clone();
            sized["size"] = json!(size);
            let look = deep_canvas_scene3d::look::Look3::from_roles(self.look.light.clone());
            let mut labels = deep_canvas_scene3d::label::Labels::new();
            if let Ok(scene) = deep_canvas_scene3d::scene::evaluate(&sized, t, &look, &mut labels)
            {
                quote = scene
                    .boxes()
                    .into_iter()
                    .filter(|(id, b)| {
                        let kind = items.get(id).and_then(|i| i.get("kind"));
                        kind == Some(&json!("mark.text@1")) && within(*b, at)
                    })
                    .find_map(|(id, _)| text_of(&id));
            }
        }
        let top = hits.into_iter().max_by(|a, b| a.0.cmp(&b.0)).map(|(_, id)| id);
        (top, quote)
    }

    /// The writer of a document's revision `rev`.
    fn rev_writer(&self, doc: &str, rev: u64) -> Option<Writer> {
        match self.shared.get(doc) {
            Some(s) => s.revs.iter().find(|r| r.rev == rev)?.writer.clone(),
            None => self
                .revisions
                .get(doc)?
                .iter()
                .find(|r| r.rev == rev)
                .map(|r| r.writer.clone()),
        }
    }

    /// `render_back`: a session's render-back of a document at `t` as of revision `rev`, any
    /// revision it has had, as a PNG in the evidence store; a 3D one on the GPU, through a
    /// camera and with pixel probes (#1401).
    pub fn render_back(
        &mut self,
        session: &str,
        doc: &str,
        t: i64,
        rev: u64,
        size: Option<[u16; 2]>,
        probes: &crate::probe::Probes,
    ) -> Value {
        if !self.scenario.sessions.contains_key(session) {
            return refused("no_session");
        }
        let Some(document) = self.revision(doc, rev) else {
            return refused("unknown_revision");
        };
        // A 3D revision is evaluated whole: its materials, cameras and meshes are items too.
        if crate::probe::draws_3d(&document) {
            return self.render_back_3d(session, rev, &document, t, size, probes);
        }
        let shown = crate::shared::drawable(&document);
        // A camera and probes ask about a 3D frame; a 2D one has neither.
        for (asked, path) in [
            (probes.camera.is_some(), "camera"),
            (!probes.at.is_empty(), "probes"),
        ] {
            if asked {
                return json!({"code": "out_of_range", "path": path});
            }
        }
        match self.snapshot(&shown, t, size) {
            Ok(snap) => json!({
                "rev": rev, "t": t, "outcome": "presented", "snapshots": [snap],
                "backends": crate::seams::backends(true),
            }),
            Err(e) => e,
        }
    }
}
