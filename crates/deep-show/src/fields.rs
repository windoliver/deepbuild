//! #542 (canvas primitives: Control: text; Control: scroll): a panel's text and scroll controls,
//! before its scope takes an input.
//!
//! A text control's field takes the keys while its Tab stop has focus: typed text, a paste
//! refused whole past the cap with a notice, the input seam's input method composing a
//! candidate, ⌘Z and ⇧⌘Z on an undo stack of its own. Its commit, Enter in a one-line field,
//! ⌘Enter in a many-line one, leaving it by Tab or a click elsewhere, writes one entry, its bytes
//! as typed; Esc discards the edit. The field, its text and its stack are viewer state, drawn in
//! the panel's right half.
//!
//! A scroll control takes the wheel and the trackpad over its area, and the camera keeps them
//! elsewhere. Deltas become whole steps once, at the event (`deep_canvas_input::scroll`), each
//! step one entry, or session state in class view. A trackpad gesture stays with the target it
//! began over, its momentum tail too, until a key press ends the tail; from the first modifier
//! change, its events drop until a new gesture. With focus, the arrows, Page Up and Page Down,
//! Home and End move it, announced by its `value_text`.

use std::collections::BTreeMap;

use deep_canvas::scope::{Event, Phase};
use deep_canvas_input::scroll::{self, Gesture as Steps, Spec as ScrollSpec};
use deep_canvas_input::text::{Did, Field, Spec as TextSpec};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::hub::Hub;
use crate::played::class_of;
use crate::points::Gesture;

/// What a panel holds of its text and scroll controls, all viewer state.
#[derive(Default)]
pub(crate) struct Viewer {
    /// Each text control's field.
    fields: BTreeMap<String, Field>,
    /// Each scroll control's gesture under way.
    steps: BTreeMap<String, Steps>,
    /// The trackpad gesture under way.
    latch: Option<Latch>,
}

/// A trackpad gesture: the scroll control it began over (none: the camera's), the modifiers it
/// began with, and whether its tail has ended: by a key press, or a modifier change.
struct Latch {
    target: Option<String>,
    mods: [bool; 4],
    ended: bool,
}

/// The document's controls of `kind`.
fn of_kind<'a>(doc: &'a Value, kind: &'a str) -> impl Iterator<Item = (&'a String, &'a Value)> {
    let controls = doc.get("controls").and_then(Value::as_object);
    controls
        .into_iter()
        .flatten()
        .filter(move |(_, c)| c.get("kind").and_then(Value::as_str) == Some(kind))
}

/// An item's box in page u: its `params.box` placed at its `at.pos`.
fn box_of(doc: &Value, id: &str) -> Option<[f64; 4]> {
    let item = doc.get("items")?.get(id)?;
    let b = item.pointer("/params/box")?.as_array()?;
    let n = |k: usize| b.get(k).and_then(Value::as_f64);
    let at = |k: usize| {
        item.pointer(&format!("/at/pos/{k}"))
            .and_then(Value::as_f64)
    };
    Some([
        n(0)? + at(0).unwrap_or(0.0),
        n(1)? + at(1).unwrap_or(0.0),
        n(2)?,
        n(3)?,
    ])
}

fn within(b: &[f64; 4], p: [f64; 2]) -> bool {
    p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3]
}

/// Where the `i`th text control's field draws on a page of `size` u: the right half, clear of
/// the page's bottom corner.
fn field_box(size: [f64; 2], i: usize) -> [f64; 4] {
    let (w, h) = (size[0] / 2.0, size[1] * 0.6);
    [w + 16.0, 16.0 + i as f64 * (h + 8.0), w - 32.0, h]
}

fn page_size(doc: &Value) -> [f64; 2] {
    let s = doc.get("size").and_then(Value::as_array);
    let n = |k: usize| s.and_then(|s| s.get(k)).and_then(Value::as_f64);
    [n(0).unwrap_or(480.0), n(1).unwrap_or(240.0)]
}

impl Hub<'_> {
    fn field_planted(&self, name: &str) -> bool {
        self.scenario.module_planted.as_deref() == Some(name)
    }

    /// A page point (u) of panel point `pos` (px), through the scope's flat camera.
    fn page_point(&self, panel: &str, pos: [f64; 2]) -> Option<[f64; 2]> {
        let s = &self.scopes.get(panel)?.scope;
        let (pose, rect) = (s.pose(), s.rect());
        let k = pose.view_width / rect[2];
        Some([
            pose.target[0] + (pos[0] - rect[0] - rect[2] / 2.0) * k,
            pose.target[1] + (pos[1] - rect[1] - rect[3] / 2.0) * k,
        ])
    }

    /// An input to a panel's text or scroll controls, before its scope takes it: whether one of
    /// them took it whole, and the entries it wrote.
    pub(crate) fn field_input(
        &mut self,
        panel: &str,
        doc: &Value,
        event: &Event,
        g: &Gesture,
        serial: u64,
    ) -> Result<(bool, Vec<Value>), Value> {
        // A key press ends a momentum tail under way (planted: the tail goes on).
        if let (Event::Key { .. }, Some(s)) = (event, self.scopes.get_mut(panel)) {
            if !self
                .scenario
                .module_planted
                .as_deref()
                .is_some_and(|p| p == "scroll_tail_survives_keys")
            {
                if let Some(l) = s.fields.latch.as_mut() {
                    l.ended = true;
                }
            }
        }
        if let Event::Scroll { phase, pos, delta } = event {
            return self.scroll_input(panel, doc, *phase, *pos, *delta, g, serial);
        }
        let focus = self
            .scopes
            .get(panel)
            .and_then(|s| s.scope.focused_control())
            .map(str::to_string);
        let Some(focus) = focus else {
            return Ok((false, Vec::new()));
        };
        let Some(c) = doc.get("controls").and_then(|c| c.get(&focus)) else {
            return Ok((false, Vec::new()));
        };
        match c.get("kind").and_then(Value::as_str) {
            Some("text") => self.text_input(panel, doc, &focus, c, event, g, serial),
            Some("scroll") => self.scroll_key(panel, &focus, c, event, serial),
            _ => Ok((false, Vec::new())),
        }
    }

    /// An input to the focused text control `id`.
    #[allow(clippy::too_many_arguments)]
    fn text_input(
        &mut self,
        panel: &str,
        doc: &Value,
        id: &str,
        c: &Value,
        event: &Event,
        g: &Gesture,
        serial: u64,
    ) -> Result<(bool, Vec<Value>), Value> {
        let Some(spec) = TextSpec::of(c) else {
            return Ok((false, Vec::new()));
        };
        let ime_commits = self.field_planted("text_commits_on_ime_confirm");
        let index = of_kind(doc, "text").position(|(k, _)| k == id).unwrap_or(0);
        let on_field = match event {
            Event::Down { pos, .. } => self
                .page_point(panel, *pos)
                .is_some_and(|p| within(&field_box(page_size(doc), index), p)),
            _ => false,
        };
        let Some(s) = self.scopes.get_mut(panel) else {
            return Ok((false, Vec::new()));
        };
        let field = s.fields.fields.entry(id.to_string()).or_default();
        let (took, did) = match event {
            Event::Text(t) => (true, field.typed(spec, t)),
            Event::Paste(t) => (true, field.paste(spec, t)),
            Event::Ime(m) => (true, field.compose(m)),
            Event::Key { key, cmd, .. } => match key.as_str() {
                // Tab commits and moves: the scope moves the focus.
                "Tab" => (false, field.leave()),
                "Escape" => (true, field.escape()),
                "Enter" | "Return" => (true, field.enter(spec, *cmd, ime_commits)),
                "z" | "Z" if *cmd && g.mods[0] => (true, field.redo()),
                "z" | "Z" if *cmd => (true, field.undo()),
                "Backspace" => (true, field.backspace()),
                _ => (true, Did::Edited),
            },
            // A press off the field leaves it, which commits an edit; the scope takes the press.
            Event::Down { .. } if !on_field => {
                let did = field.leave();
                s.scope.blur();
                (false, did)
            }
            _ => (false, Did::Edited),
        };
        let mut appended = Vec::new();
        match did {
            Did::Commit(text) => {
                // Planted: the commit normalizes the field's text to NFC.
                let text = if self.field_planted("text_normalizes_nfc") {
                    text.nfc().collect()
                } else {
                    text
                };
                let doc_id = self.panel_doc(panel).unwrap_or_default();
                appended.extend(self.enter(&doc_id, id, json!(text), self.now, serial)?);
            }
            Did::Refused(notice) => {
                let t = self.now;
                if let Some(s) = self.scopes.get_mut(panel) {
                    s.picks.said.push(json!({"t": t, "id": id, "text": notice}));
                }
            }
            Did::Edited | Did::Discarded => {}
        }
        Ok((took, appended))
    }

    /// Scroll control `id`'s position: its last entry, its session value in class view, or its
    /// default.
    fn scroll_at(&self, doc: &str, id: &str, c: &Value, spec: &ScrollSpec) -> i32 {
        let v = if class_of(c) == "view" {
            self.session_state
                .get(doc)
                .and_then(|s| s.pointer(&format!("/view/{id}")))
                .and_then(Value::as_i64)
        } else {
            self.tracks
                .get(doc)
                .and_then(|t| t.last_at(id, i64::MAX))
                .and_then(|e| e.value.as_i64())
        };
        spec.clamp(
            v.or_else(|| c.get("default").and_then(Value::as_i64))
                .unwrap_or(0),
        )
    }

    /// Positions `to`, each written as control `id`'s value: an entry, or session state.
    fn scroll_to(
        &mut self,
        panel: &str,
        id: &str,
        to: Vec<i32>,
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        let doc = self.panel_doc(panel).unwrap_or_default();
        let mut appended = Vec::new();
        for p in to {
            appended.extend(self.enter(&doc, id, json!(p), self.now, serial)?);
        }
        Ok(appended)
    }

    /// A key on the focused scroll control `id`: a step, a page or an end, announced.
    fn scroll_key(
        &mut self,
        panel: &str,
        id: &str,
        c: &Value,
        event: &Event,
        serial: u64,
    ) -> Result<(bool, Vec<Value>), Value> {
        let (
            Event::Key {
                key, cmd: false, ..
            },
            Some(spec),
        ) = (event, ScrollSpec::of(c))
        else {
            return Ok((false, Vec::new()));
        };
        let doc = self.panel_doc(panel).unwrap_or_default();
        let at = self.scroll_at(&doc, id, c, &spec);
        let Some(to) = scroll::key(&spec, at, key) else {
            return Ok((false, Vec::new()));
        };
        let appended = if to == at {
            Vec::new()
        } else {
            self.scroll_to(panel, id, vec![to], serial)?
        };
        let template = c
            .get("value_text")
            .and_then(Value::as_str)
            .unwrap_or("{value}");
        let text = template.replace("{value}", &to.to_string());
        let t = self.now;
        if let Some(s) = self.scopes.get_mut(panel) {
            s.picks.said.push(json!({"t": t, "id": id, "text": text}));
        }
        Ok((true, appended))
    }

    /// A wheel or trackpad event: to the scroll control the gesture began over, or, outside
    /// every scroll area, to the scope's camera.
    #[allow(clippy::too_many_arguments)]
    fn scroll_input(
        &mut self,
        panel: &str,
        doc: &Value,
        phase: Phase,
        pos: [f64; 2],
        delta: [f64; 2],
        g: &Gesture,
        serial: u64,
    ) -> Result<(bool, Vec<Value>), Value> {
        let everywhere = self.field_planted("wheel_to_list_everywhere");
        let point = self.page_point(panel, pos);
        let over = of_kind(doc, "scroll")
            .find(|(_, c)| {
                everywhere
                    || c.pointer("/scroll/area")
                        .and_then(Value::as_str)
                        .and_then(|a| box_of(doc, a))
                        .zip(point)
                        .is_some_and(|(b, p)| within(&b, p))
            })
            .map(|(id, _)| id.clone());
        let Some(s) = self.scopes.get_mut(panel) else {
            return Ok((false, Vec::new()));
        };
        let latch = &mut s.fields.latch;
        let target = if g.line {
            over
        } else if g.momentum {
            match latch {
                // The tail stays with its gesture; once ended, it drops whole.
                Some(l) => {
                    if l.mods != g.mods {
                        l.ended = true;
                    }
                    if l.ended {
                        if phase == Phase::End {
                            *latch = None;
                        }
                        return Ok((true, Vec::new()));
                    }
                    let t = l.target.clone();
                    if phase == Phase::End {
                        *latch = None;
                    }
                    t
                }
                None => over,
            }
        } else {
            if phase == Phase::Begin || latch.is_none() {
                *latch = Some(Latch {
                    target: over.clone(),
                    mods: g.mods,
                    ended: false,
                });
            }
            let l = latch.as_mut().expect("set above");
            if l.mods != g.mods {
                l.ended = true;
            }
            if l.ended {
                return Ok((true, Vec::new()));
            }
            l.target.clone()
        };
        let Some(id) = target else {
            return Ok((false, Vec::new()));
        };
        let Some(c) = doc.get("controls").and_then(|c| c.get(&id)).cloned() else {
            return Ok((false, Vec::new()));
        };
        let Some(spec) = ScrollSpec::of(&c) else {
            return Ok((false, Vec::new()));
        };
        let doc_id = self.panel_doc(panel).unwrap_or_default();
        let mut at = self.scroll_at(&doc_id, &id, &c, &spec);
        // A step's size on screen, in px.
        let per_step = {
            let sc = &self.scopes[panel].scope;
            spec.step * sc.rect()[2] / sc.pose().view_width
        };
        let d = if spec.axis_x { delta[0] } else { delta[1] };
        let s = self.scopes.get_mut(panel).expect("looked up above");
        let steps = s.fields.steps.entry(id.clone()).or_default();
        let mut to = Vec::new();
        if g.line {
            to.extend(steps.lines(&spec, &mut at, d));
            to.extend(steps.end(&spec, &mut at, false));
        } else {
            match phase {
                Phase::Begin => *steps = Steps::default(),
                Phase::Change => to.extend(steps.pixels(&spec, &mut at, d, per_step)),
                Phase::End => to.extend(steps.end(&spec, &mut at, false)),
            }
        }
        Ok((true, self.scroll_to(panel, &id, to, serial)?))
    }

    /// The panel's text fields, drawn into `form` (viewer state): a box per text control in the
    /// page's right half with its text, outlined while it has focus.
    pub(crate) fn fields_into(&self, panel: &str, form: &mut Value) {
        let Some(s) = self.scopes.get(panel) else {
            return;
        };
        let size = page_size(form);
        let focus = s.scope.focused_control().map(str::to_string);
        let texts: Vec<(String, String)> = of_kind(form, "text")
            .map(|(id, _)| {
                let f = s.fields.fields.get(id);
                let mut text = f.map(|f| f.text.clone()).unwrap_or_default();
                text.push_str(f.and_then(|f| f.composing.as_deref()).unwrap_or(""));
                (id.clone(), text)
            })
            .collect();
        let Some(items) = form.get_mut("items").and_then(Value::as_object_mut) else {
            return;
        };
        // On the document's own writer layer.
        let layer = items.values().find_map(|i| i.get("layer")).cloned();
        let mut put = |id: String, mut item: Value| {
            if let Some(layer) = &layer {
                item["layer"] = layer.clone();
            }
            items.insert(id, item);
        };
        for (i, (id, text)) in texts.into_iter().enumerate() {
            let b = field_box(size, i);
            let stroke = if focus.as_deref() == Some(id.as_str()) {
                json!({"role": "accent", "width": 2})
            } else {
                json!({"role": "muted", "width": 1})
            };
            let frame = format!("{id}-field");
            put(
                frame.clone(),
                json!({"id": frame, "kind": "rect@1", "name": "Field", "role": "decoration", "order": "zy",
                "params": {"box": b, "paint": {"fill": {"role": "ground"}, "stroke": stroke}}}),
            );
            if !text.is_empty() {
                let shown = format!("{id}-text");
                put(
                    shown.clone(),
                    json!({"id": shown, "kind": "text@1", "name": "Field text", "role": "label", "order": "zz",
                    "at": {"pos": [b[0] + 6.0, b[1] + 6.0, 0.0]},
                    "params": {"text": text, "font": "mono", "size": 12, "box": {"w": b[2] - 12.0, "h": b[3] - 12.0}}}),
                );
            }
        }
    }
}
