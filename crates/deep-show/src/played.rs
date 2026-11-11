//! The played form (issue #504): a document as a frame draws it, the form its session loaded
//! with its one input track inlined under `track` and each view-class control's session value as
//! that control's default, and, at a time, each variant set's pick applied (Scope and input
//! classes: `frame(t) = eval(doc, t, inputs ≤ t, view)`; Variant).
//!
//! The track is the hub's, per document, never the document's: the saved revision and its hash
//! never change when you pick, as #544 inlines a logic item's occurrences only into the drawn
//! form. Motion reads `track` when it compiles, so every reader of the motion program (the draw,
//! 3D placement, `see`, the audit, render-back and export) replays the same entries.

use std::borrow::Cow;
use std::collections::BTreeMap;

use deep_canvas::document::variants;
use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_input::track::{Entry, Track, Writer};
use serde_json::{json, Value};

use crate::hub::Hub;

/// A control's input class (Scope and input classes): its own `class`; a choice that names a
/// variant set is `view` unless it says otherwise (Control: `variant`); any other `document`.
pub(crate) fn class_of(control: &Value) -> &str {
    match control.get("class").and_then(Value::as_str) {
        Some(c) => c,
        None if control.get("variant").is_some() => "view",
        None => "document",
    }
}

/// `form` with `entries` inlined as its `track`; `form` itself when there are none.
pub(crate) fn with_track(form: &Value, entries: &[Value]) -> Value {
    let mut out = form.clone();
    if !entries.is_empty() {
        out["track"] = Value::Array(entries.to_vec());
    }
    out
}

/// Each variant set's pick at `t`, by set: a document-class choice's last entry at or before
/// `t`, else its default; a view-class choice's default, which [`Hub::played`] wrote from the
/// session.
pub(crate) fn picks_at(form: &Value, t: i64) -> BTreeMap<String, String> {
    let entries = form.get("track").and_then(Value::as_array);
    let mut out = BTreeMap::new();
    for (id, c) in form.get("controls").and_then(Value::as_object).into_iter().flatten() {
        let Some(set) = c.get("variant").and_then(Value::as_str) else {
            continue;
        };
        let entry = (class_of(c) == "document")
            .then(|| {
                // Entries stay in time order, so the last one at or before `t` is the pick.
                entries?
                    .iter()
                    .filter(|e| e["control"] == id.as_str() && e["t"].as_i64().is_some_and(|et| et <= t))
                    .next_back()
            })
            .flatten();
        let pick = entry.map(|e| &e["value"]).or_else(|| c.get("default"));
        if let Some(name) = pick.and_then(Value::as_str) {
            out.insert(set.to_string(), name.to_string());
        }
    }
    out
}

/// What a frame at `t` draws of the played form: each variant set's pick at `t` applied, or the
/// form itself when it has no variants.
pub(crate) fn at(form: &Value, t: i64) -> Cow<'_, Value> {
    if form.get("variants").is_none() {
        return Cow::Borrowed(form);
    }
    Cow::Owned(variants::applied(form, &picks_at(form, t)))
}

/// Loads [`at`]`(form, t)` into `session` when it isn't what the session holds, so a pick
/// recompiles the items it changes once, on the frame it starts (Variant: an incremental
/// recompile of the affected items on a switch), and a frame with the same picks loads nothing.
pub(crate) fn load_at(sched: &mut Scheduler<'_>, session: &mut DocSession, form: &Value, t: i64) {
    if form.get("variants").is_none() {
        return;
    }
    let shown = at(form, t);
    if session.document() != Some(shown.as_ref()) {
        session.load(sched, shown.as_ref());
    }
}

impl Hub<'_> {
    /// The document's input track as entries a form inlines.
    pub(crate) fn track_json(&self, doc: &str) -> Vec<Value> {
        self.tracks.get(doc).map(|t| t.entries().iter().map(Entry::to_json).collect()).unwrap_or_default()
    }

    /// `form` played: its track inlined, and each view-class control's value from the
    /// document's session state written as that control's default.
    pub(crate) fn played(&self, doc: &str, form: &Value) -> Value {
        let mut out = with_track(form, &self.track_json(doc));
        let view = self.session_state.get(doc).and_then(|s| s.get("view")).and_then(Value::as_object);
        if let (Some(view), Some(controls)) = (view, out.get_mut("controls").and_then(Value::as_object_mut)) {
            for (id, c) in controls.iter_mut() {
                if let Some(v) = view.get(id).filter(|_| class_of(c) == "view") {
                    c["default"] = v.clone();
                }
            }
        }
        out
    }

    /// `form` played and shown at `t`, owned: what a 3D frame of the document draws.
    pub(crate) fn shown_at(&self, doc: &str, form: &Value, t: i64) -> Value {
        at(&self.played(doc, form), t).into_owned()
    }

    /// The played form of the document as its last `deep_show` loaded it, if any.
    pub(crate) fn played_form(&self, doc: &str) -> Option<Value> {
        self.forms.get(doc).map(|f| self.played(doc, f))
    }

    /// Before a frame of `doc` at `t`: the session holds what that frame draws.
    pub(crate) fn load_frame(&mut self, doc: &str, t: i64) {
        let Some(form) = self.played_form(doc) else {
            return;
        };
        if let Some(session) = self.sessions.get_mut(doc) {
            load_at(&mut self.sched, session, &form, t);
        }
    }

    /// Before a frame of `doc` at `t` on a given input track (an `eval`'s `track`), over the hub's.
    pub(crate) fn load_with(&mut self, doc: &str, track: &[Value], t: i64) {
        let Some(form) = self.played_form(doc).map(|f| with_track(&f, track)) else {
            return;
        };
        if let Some(session) = self.sessions.get_mut(doc) {
            if session.document() != Some(&form) {
                session.load(&mut self.sched, &form);
            }
            load_at(&mut self.sched, session, &form, t);
        }
    }

    /// One input to a document's own control at `t`, with the router's `serial` (Control): a
    /// document-class control appends one entry, stamped as yours; a view-class one changes the
    /// session's view state and never the document; a viewer-class one changes nothing here.
    /// Then the session replays what it holds. The entry it appended, if any.
    pub(crate) fn enter(&mut self, doc: &str, control: &str, value: Value, t: i64, serial: u64) -> Result<Option<Value>, Value> {
        let form = self.forms.get(doc).ok_or_else(|| json!({"code": "no_revision"}))?;
        let c = form
            .get("controls")
            .and_then(|c| c.get(control))
            .ok_or_else(|| json!({"code": "unknown_control", "control": control}))?;
        let options = variants::option_names(form, c);
        if value.is_string() && !options.is_empty() && !options.iter().any(|o| Some(o.as_str()) == value.as_str()) {
            return Err(json!({"code": "not_an_option", "control": control, "value": value}));
        }
        let mut appended = None;
        match class_of(c) {
            "document" => {
                let entry = Entry {
                    t,
                    seq: 0,
                    control: control.to_string(),
                    value,
                    samples: None,
                    writer: Writer::You,
                    serial: Some(serial as u32),
                };
                appended = Some(entry.to_json());
                self.tracks.entry(doc.to_string()).or_insert_with(Track::default).append(entry);
            }
            "view" if self.planted(crate::hub::Planted::VariantPickWritesRevision) && c.get("variant").is_some() => {
                // Planted (#504): the pick written into the document as a revision.
                let set = c["variant"].as_str().unwrap_or_default().to_string();
                let picked = BTreeMap::from([(set, value.as_str().unwrap_or_default().to_string())]);
                if let Some(row) = self.current(doc).map(|r| r.doc.clone()) {
                    self.push_revision(doc, variants::applied(&row, &picked));
                }
            }
            "view" => {
                let state = self
                    .session_state
                    .entry(doc.to_string())
                    .or_insert_with(|| json!({"selection": [], "view": {}}));
                state["view"][control] = value;
            }
            _ => {}
        }
        self.replay(doc, t);
        Ok(appended)
    }

    /// The document's session reloaded from its played form, then shown at `t`.
    pub(crate) fn replay(&mut self, doc: &str, t: i64) {
        let Some(form) = self.played_form(doc) else {
            return;
        };
        if let Some(session) = self.sessions.get_mut(doc) {
            session.load(&mut self.sched, &form);
            load_at(&mut self.sched, session, &form, t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form() -> Value {
        json!({
            "items": {"case": {"params": {"fill": "a"}}},
            "variants": {"color": {"default": "red", "options": [
                {"name": "red", "patch": [{"op": "set", "path": "items/case/params/fill", "value": "r"}]},
                {"name": "green", "patch": [{"op": "set", "path": "items/case/params/fill", "value": "g"}]},
                {"name": "blue", "patch": [{"op": "set", "path": "items/case/params/fill", "value": "b"}]}
            ]}},
            "controls": {"pick": {"kind": "choice", "class": "document", "variant": "color", "role": "radiogroup"}}
        })
    }

    #[test]
    fn a_document_choice_picks_from_its_entry_on_and_its_default_before() {
        const S: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;
        let entries: Vec<Value> = [(2, "green"), (4, "blue"), (6, "red")]
            .iter()
            .map(|(s, v)| json!({"t": s * S, "seq": 0, "control": "pick", "value": v}))
            .collect();
        let played = with_track(&form(), &entries);
        let fill = |t: i64| at(&played, t)["items"]["case"]["params"]["fill"].clone();
        assert_eq!(fill(2 * S - 1), "r", "the default before the first entry");
        assert_eq!(fill(2 * S), "g");
        assert_eq!(fill(4 * S), "b");
        assert_eq!(fill(6 * S), "r");
    }

    #[test]
    fn a_choice_naming_a_set_is_view_class_unless_it_says_otherwise() {
        assert_eq!(class_of(&json!({"kind": "choice", "variant": "color"})), "view");
        assert_eq!(class_of(&json!({"kind": "stages"})), "document");
        assert_eq!(class_of(&json!({"kind": "choice", "variant": "c", "class": "document"})), "document");
    }
}
