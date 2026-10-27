//! Issue #383: your input to a canvas, through the core's interaction scope, and the frames a
//! panel presents. Each panel's canvas has one scope; the input router gives every input a serial;
//! a frame at vsync v draws what was current at its latch, v − lead: the revision and the camera
//! the latest input before it left (Frame clock and scheduler; Frame callback and presentation
//! feedback). A view scrubbed back in time shows the revision current then, and a view comparing
//! shows the revision it compares against as before. A revision whose parts move presents a
//! frame at each vsync until they settle; a still one presents none after its first.

use std::collections::BTreeMap;

use deep_canvas::scope::{self, Event, Phase, Scope};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};
use crate::shared::FLICKS;

/// What a frame draws besides the revision: the camera, and the view controls that choose the
/// revision and what it hides.
#[derive(Clone, PartialEq)]
struct Seen {
    camera: Value,
    time: Option<i64>,
    compare: Option<u64>,
    hidden: Vec<String>,
}

/// A panel's scope and what it drew after each input, by the time it arrived.
pub struct PanelScope {
    scope: Scope,
    seen: Vec<(i64, Seen)>,
}

fn point(v: &Value) -> Option<[f64; 2]> {
    let a = v.as_array().filter(|a| a.len() == 2)?;
    Some([a[0].as_f64()?, a[1].as_f64()?])
}

/// One event of an `input` call (the #383 acceptance README: Event).
pub fn event(v: &Value) -> Option<Event> {
    let pos = || point(v.get("pos")?);
    let phase = || match v.get("phase")?.as_str()? {
        "begin" => Some(Phase::Begin),
        "change" => Some(Phase::Change),
        "end" => Some(Phase::End),
        _ => None,
    };
    Some(match v.get("type")?.as_str()? {
        "down" => Event::Down(pos()?),
        "up" => Event::Up(pos()?),
        "move" => Event::Move(pos()?),
        "scroll" => Event::Scroll {
            phase: phase()?,
            pos: pos()?,
            delta: point(v.get("delta")?)?,
        },
        "pinch" => Event::Pinch {
            phase: phase()?,
            pos: pos()?,
            scale: v.get("scale")?.as_f64()?,
        },
        "key" => {
            let mods = match v.get("mods") {
                None => Vec::new(),
                Some(m) => m
                    .as_array()?
                    .iter()
                    .map(Value::as_str)
                    .collect::<Option<Vec<_>>>()?,
            };
            Event::Key {
                key: v.get("key")?.as_str()?.to_string(),
                cmd: mods.contains(&"cmd"),
            }
        }
        "text" => Event::Text(v.get("text")?.as_str()?.to_string()),
        "control" => Event::Control {
            control: v.get("control")?.as_str()?.to_string(),
            value: v.get("value")?.clone(),
        },
        _ => return None,
    })
}

fn refused(code: &str) -> Value {
    json!({"code": code})
}

impl Hub<'_> {
    /// The document a panel shows, by ID.
    fn panel_doc(&self, panel: &str) -> Option<String> {
        self.scenario
            .docs
            .iter()
            .find(|(_, p)| *p == panel)
            .map(|(d, _)| d.clone())
    }

    /// A document's revision `rev`, as it was.
    fn revision(&self, doc: &str, rev: u64) -> Option<Value> {
        match self.shared.get(doc) {
            Some(s) => {
                let k = s.revs.iter().position(|r| r.rev == rev)?;
                Some(s.at(k).0.into_owned())
            }
            None => self
                .revisions
                .get(doc)?
                .iter()
                .find(|r| r.rev == rev)
                .map(|r| r.doc.clone()),
        }
    }

    /// The revision of a document current at `t`.
    fn rev_at(&self, doc: &str, t: i64) -> Option<u64> {
        self.currents(doc)
            .into_iter()
            .filter(|(at, _)| *at <= t)
            .map(|(_, r)| r)
            .max()
    }

    /// The revision a panel shows now: live, or as of the time its view is scrubbed to; and the
    /// one it compares against.
    fn panel_document(&self, panel: &str) -> Option<(Value, Option<Value>)> {
        let doc = self.panel_doc(panel)?;
        let s = self.scopes.get(panel).map(|s| &s.scope);
        let t = s.and_then(Scope::time).unwrap_or(self.now);
        let shown = self.revision(&doc, self.rev_at(&doc, t)?)?;
        let before = s
            .and_then(Scope::compare)
            .and_then(|rev| self.revision(&doc, rev));
        Some((shown, before))
    }

    /// What the panel's scope draws now.
    fn seen(&self, panel: &str) -> Option<Seen> {
        let (doc, _) = self.panel_document(panel)?;
        let s = &self.scopes.get(panel)?.scope;
        Some(Seen {
            camera: s.pose().to_json(),
            time: s.time(),
            compare: s.compare(),
            hidden: s.hidden(&doc),
        })
    }

    /// The panel's scope, made on first use from the revision it shows.
    fn panel_scope(&mut self, panel: &str) -> Result<&mut PanelScope, Value> {
        if !self.scopes.contains_key(panel) {
            let rect = self
                .scenario
                .panels
                .get(panel)
                .ok_or_else(|| refused("unknown_panel"))?
                .rect;
            let (doc, _) = self
                .panel_document(panel)
                .ok_or_else(|| refused("not_presented"))?;
            let display = self
                .scenario
                .display
                .or(self.scenario.window)
                .unwrap_or([rect[0] + rect[2], rect[1] + rect[3]]);
            let p = self.scenario.planted;
            let planted = scope::Planted {
                line_scroll_pans: p == Some(Planted::LineScrollPans),
                commit_every_move: p == Some(Planted::CommitEveryMove),
                pick_mid_gesture: p == Some(Planted::PickMidGesture),
                full_screen_only_3d: p == Some(Planted::FullScreenOnly3d),
                esc_to_root: p == Some(Planted::EscToRoot),
            };
            let scope = Scope::new(&doc, rect, display, planted)
                .map_err(|r| json!({"code": r.code, "path": r.path}))?;
            self.scopes.insert(
                panel.to_string(),
                PanelScope {
                    scope,
                    seen: Vec::new(),
                },
            );
            let first = self.seen(panel).ok_or_else(|| refused("not_presented"))?;
            if let Some(s) = self.scopes.get_mut(panel) {
                s.seen.push((0, first));
            }
        }
        Ok(self.scopes.get_mut(panel).expect("inserted above"))
    }

    /// `input`: one hardware input to a panel's canvas.
    pub fn input(&mut self, panel: &str, event: &Event) -> Value {
        if let Err(e) = self.panel_scope(panel) {
            return e;
        }
        let Some((doc, _)) = self.panel_document(panel) else {
            return refused("not_presented");
        };
        self.serial += 1;
        let (serial, now) = (self.serial, self.now);
        let late = self.scenario.planted == Some(Planted::DragShowsOnRelease)
            && matches!(event, Event::Move(_));
        let done = match self.scopes.get_mut(panel) {
            Some(s) => s.scope.input(&doc, now, serial, event),
            None => return refused("unknown_panel"),
        };
        let seen = self.seen(panel);
        if let (false, Some(seen), Some(s)) = (late, seen, self.scopes.get_mut(panel)) {
            s.seen.push((now, seen));
        }
        json!({
            "serial": serial,
            "state": self.state(panel),
            "picks": done.picks,
            "commits": done.commits.iter().map(|g| json!({"gesture": g})).collect::<Vec<_>>(),
        })
    }

    /// The panel's scope over the revisions it shows and compares against.
    fn state(&self, panel: &str) -> Value {
        match (self.scopes.get(panel), self.panel_document(panel)) {
            (Some(s), Some((doc, before))) => {
                s.scope
                    .to_json(&doc, before.as_ref(), &self.scenario.verdicts)
            }
            _ => Value::Null,
        }
    }

    /// `view`: the panel's view drawn by render-back, as a PNG in the evidence store: the
    /// revision it shows with what it hides invisible and its lens's colors, never saved.
    pub fn view(&mut self, panel: &str) -> Value {
        if let Err(e) = self.panel_scope(panel) {
            return e;
        }
        let (Some(s), Some((doc, before))) = (self.scopes.get(panel), self.panel_document(panel))
        else {
            return refused("not_presented");
        };
        let shown = crate::shared::drawable(&s.scope.view_document(&doc, before.as_ref()));
        let drawn = match self.renderer.prepare(
            shown.as_object().expect("a document is an object"),
            0,
            &self.look.light,
            self.look.status.as_ref(),
            &self.record(),
            &self.scenario.evidence,
        ) {
            Ok(d) => d,
            Err(u) => return json!({"code": u.code, "path": u.path}),
        };
        let [w, h] = drawn.frame.size;
        let size = [
            w.round().clamp(1.0, 8192.0) as u16,
            h.round().clamp(1.0, 8192.0) as u16,
        ];
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let png = crate::snapshot::png(self.renderer.raster(&drawn, size, Some(ground)), size);
        match crate::evidence::put(&self.scenario.evidence, &png) {
            Ok(sha) => json!({"snapshot": {"sha256": sha, "w": size[0], "h": size[1]}}),
            Err(_) => refused("not_written"),
        }
    }

    /// `scope`: a panel's scope, with no input.
    pub fn scope_reply(&mut self, panel: &str) -> Value {
        match self.panel_scope(panel) {
            Ok(_) => json!({"state": self.state(panel)}),
            Err(e) => e,
        }
    }

    /// Each revision of a panel's document and the time it became current, in order.
    fn currents(&self, doc: &str) -> Vec<(i64, u64)> {
        match self.shared.get(doc) {
            Some(s) => s
                .revs
                .iter()
                .filter_map(|r| match (&r.writer, r.current_at) {
                    (None, _) => Some((0, r.rev)),
                    (Some(_), at) => at.map(|at| (at, r.rev)),
                })
                .collect(),
            None => self.shown_at.get(doc).cloned().unwrap_or_default(),
        }
    }

    /// Revision `rev` of `doc`'s motion, compiled; `None` when it has none to read.
    fn motion_at(&self, doc: &str, rev: u64) -> Option<Program> {
        let compile = |d: &Value| d.as_object().and_then(|m| Program::compile(m).ok());
        match self.shared.get(doc) {
            Some(s) => {
                let k = s.revs.iter().position(|r| r.rev == rev)?;
                compile(&s.at(k).0)
            }
            None => compile(&self.revisions.get(doc)?.iter().find(|r| r.rev == rev)?.doc),
        }
    }

    /// `presented`: every frame presented for a panel's document up to now. A frame presents at
    /// a vsync when what its latch sees, the revision, the camera and the view, differs from the
    /// last one, or when the last frame's `valid_until` has passed: its parts moved. A scrubbed view draws the revision current at its time; a comparing view names
    /// its before.
    pub fn presented(&mut self, panel: &str) -> Value {
        let Some(clock) = self.scenario.clock else {
            return refused("no_clock");
        };
        let Some(doc) = self.panel_doc(panel) else {
            return refused("unknown_panel");
        };
        let currents = self.currents(&doc);
        let now = self.now;
        let seen = match self.panel_scope(panel) {
            Ok(s) => s.seen.clone(),
            Err(e) => return e,
        };
        let period = FLICKS / clock.refresh_hz;
        // The planted twin draws a revision current at a latch one frame later than it may.
        let late = if self.scenario.planted == Some(Planted::PatchShowsAFrameLate) {
            period
        } else {
            0
        };
        let mut frames = Vec::new();
        let mut last: Option<(u64, &Seen)> = None;
        let mut until: Option<i64> = None;
        let mut motion: BTreeMap<u64, Option<Program>> = BTreeMap::new();
        let mut k = 1;
        while k * period <= now {
            let vsync = k * period;
            let latch = vsync - clock.lead;
            k += 1;
            let Some((_, view)) = seen.iter().rev().find(|(at, _)| *at <= latch) else {
                continue;
            };
            let shows = view.time.unwrap_or(latch);
            let rev = currents
                .iter()
                .filter(|(at, _)| *at + late <= shows)
                .map(|(_, r)| *r)
                .max();
            let Some(rev) = rev else {
                continue;
            };
            if last.is_some_and(|(r, v)| r == rev && v == view) && until.is_none_or(|u| shows < u) {
                continue;
            }
            last = Some((rev, view));
            until = motion
                .entry(rev)
                .or_insert_with(|| self.motion_at(&doc, rev))
                .as_ref()
                .and_then(|p| {
                    let mut state = p.state();
                    p.evaluate(shows, Validity::Full, &mut state);
                    state.valid_until
                });
            let mut frame = json!({"vsync": vsync, "rev": rev, "camera": view.camera});
            if let Some(before) = view.compare {
                frame["before"] = json!(before);
            }
            if !view.hidden.is_empty() {
                frame["hidden"] = json!(view.hidden);
            }
            frames.push(frame);
        }
        json!({"frames": frames})
    }
}
