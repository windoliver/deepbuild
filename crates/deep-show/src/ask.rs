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

/// One message an ask sent to a session, as sent.
pub struct Asked {
    pub words: String,
    pub attachment: Map<String, Value>,
    /// The doc ID the attachment's handles name, if any.
    pub doc: Option<String>,
    pub task: String,
}

fn refused(code: &str) -> Value {
    json!({"code": code})
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
            let r = spec.rect;
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
            let pointed = match pointer {
                Some(p) => scope.point(&shown.0, p),
                None if scope.selection().is_empty() => return refused("nothing_selected"),
                None => Pointed {
                    id: None,
                    precision: Precision::Id,
                    region: None,
                    quote: None,
                },
            };
            let ids: Vec<String> = match (&pointer, &pointed.id) {
                (None, _) => scope.selection().to_vec(),
                (Some(_), Some(id)) => vec![id.clone()],
                (Some(_), None) => Vec::new(),
            };
            let handles: Vec<String> = ids.iter().map(|id| format!("doc:{doc}#{id}")).collect();
            attachment.insert("handles".into(), json!(handles));
            // The frame's time: the playhead's where the transport is paused, else the clock's;
            // a still, which has no transport, has none.
            let t = scope.playhead().unwrap_or(self.now);
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
    /// revision it has had, as a PNG in the evidence store.
    pub fn render_back(
        &mut self,
        session: &str,
        doc: &str,
        t: i64,
        rev: u64,
        size: Option<[u16; 2]>,
    ) -> Value {
        if !self.scenario.sessions.contains_key(session) {
            return refused("no_session");
        }
        let Some(document) = self.revision(doc, rev) else {
            return refused("unknown_revision");
        };
        let shown = crate::shared::drawable(&document);
        match self.snapshot(&shown, t, size) {
            Ok(snap) => json!({"rev": rev, "t": t, "snapshots": [snap]}),
            Err(e) => e,
        }
    }
}
