//! Issue #383: your input to a canvas, through the core's interaction scope, and the frames a
//! panel presents. Each panel's canvas has one scope; the input router gives every input a serial;
//! a frame at vsync v draws what was current at its latch, v − lead: the revision and the camera
//! the latest input before it left (Frame clock and scheduler; Frame callback and presentation
//! feedback). A view scrubbed back in time shows the revision current then, and a view comparing
//! shows the revision it compares against as before. A revision whose parts move presents a
//! frame at each vsync until they settle; a still one presents none after its first.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::scope::{self, Event, Phase, Scope};
use deep_canvas::show::{Writer, WriterKind};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};
use crate::placement::Grid;
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
    pub(crate) scope: Scope,
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
    let mods = || -> Option<Vec<&str>> {
        match v.get("mods") {
            None => Some(Vec::new()),
            Some(m) => m.as_array()?.iter().map(Value::as_str).collect(),
        }
    };
    Some(match v.get("type")?.as_str()? {
        "down" => Event::Down {
            pos: pos()?,
            toggle: mods()?.contains(&"shift"),
        },
        "up" => {
            mods()?;
            Event::Up(pos()?)
        }
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
        "key" => Event::Key {
            key: v.get("key")?.as_str()?.to_string(),
            cmd: mods()?.contains(&"cmd"),
        },
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
    pub(crate) fn panel_doc(&self, panel: &str) -> Option<String> {
        self.scenario
            .docs
            .iter()
            .find(|(_, p)| *p == panel)
            .map(|(d, _)| d.clone())
    }

    /// A document's revision `rev`, as it was.
    pub(crate) fn revision(&self, doc: &str, rev: u64) -> Option<Value> {
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
    pub(crate) fn rev_at(&self, doc: &str, t: i64) -> Option<u64> {
        self.currents(doc)
            .into_iter()
            .filter(|(at, _)| *at <= t)
            .map(|(_, r)| r)
            .max()
    }

    /// The revision a panel shows now: live, or as of the time its view is scrubbed to; and the
    /// one it compares against.
    pub(crate) fn panel_document(&self, panel: &str) -> Option<(Value, Option<Value>)> {
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
    pub(crate) fn panel_scope(&mut self, panel: &str) -> Result<&mut PanelScope, Value> {
        if !self.scopes.contains_key(panel) {
            let rect = self.slot(panel).ok_or_else(|| refused("unknown_panel"))?;
            let (doc, _) = self
                .panel_document(panel)
                .ok_or_else(|| refused("not_presented"))?;
            // A view popped out fills its own window, in that window's px (#400).
            let (rect, display) = match self.placed(panel) {
                Some(p) => p,
                None => (
                    rect,
                    self.scenario
                        .display
                        .or(self.main_display_size())
                        .or(self.scenario.window)
                        .unwrap_or([rect[0] + rect[2], rect[1] + rect[3]]),
                ),
            };
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

    /// The main window's display's size, with `displays` (#400).
    fn main_display_size(&self) -> Option<[f64; 2]> {
        let w = self.placement.main_window()?;
        let d = self.placement.display(&w.display)?;
        Some([d.bounds[2], d.bounds[3]])
    }

    /// A popped-out panel's rect in its own window's px, and that window's display size.
    fn placed(&self, panel: &str) -> Option<([f64; 4], [f64; 2])> {
        let w = self.placement.window_of(panel)?;
        if w.view.as_deref() != Some(panel) {
            return None;
        }
        let d = self.placement.display(&w.display)?;
        Some(([0.0, 0.0, w.rect[2], w.rect[3]], [d.bounds[2], d.bounds[3]]))
    }

    /// Where a panel sits in the main window: where it was last placed, else its slot (#401).
    pub(crate) fn slot(&self, panel: &str) -> Option<[f64; 4]> {
        self.ring
            .rect_of(panel)
            .or_else(|| Some(self.scenario.panels.get(panel)?.rect))
    }

    /// A piece placed anew: its scope hit-tests and draws at its new rect (#401).
    pub(crate) fn lay_out(&mut self, panel: &str) {
        if self.placed(panel).is_some() {
            return;
        }
        let display = self.main_display_size().or(self.scenario.display);
        if let (Some(rect), Some(display), Some(s)) =
            (self.slot(panel), display, self.scopes.get_mut(panel))
        {
            s.scope.placed(rect, display);
        }
    }

    /// `move_window`: your drag of a window, as the window server reports it (#400). A popped
    /// view's scope follows its window's display.
    pub fn move_window(&mut self, window: &str, rect: [f64; 4], agent: bool) -> Value {
        let moved = match self.placement.move_window(self.now, window, rect, agent) {
            Ok(w) => w,
            Err(e) => return e,
        };
        let reply = json!({"window": moved.to_json()});
        // The scopes the move carried to another display: the popped view's, or every unpopped
        // panel's when the main window moved.
        let panels: Vec<String> = match &moved.view {
            Some(p) => vec![p.clone()],
            None => self
                .scenario
                .panels
                .keys()
                .filter(|p| self.placed(p).is_none())
                .cloned()
                .collect(),
        };
        let main = self.main_display_size();
        for panel in panels {
            let at = self
                .placed(&panel)
                .or_else(|| Some((self.slot(&panel)?, main?)));
            if let (Some((rect, display)), Some(s)) = (at, self.scopes.get_mut(&panel)) {
                s.scope.placed(rect, display);
            }
        }
        reply
    }

    /// `pop_out`: your pop-out of a panel's view into a window of its own on a display (#400).
    /// Its scope moves with it.
    pub fn pop_out(
        &mut self,
        panel: &str,
        display: &str,
        serial: Option<u64>,
        full_screen: bool,
        agent: bool,
    ) -> Value {
        // An agent never holds a serial.
        if agent {
            return refused("agent_cannot_pop_out");
        }
        let Some(spec) = self.scenario.panels.get(panel) else {
            return refused("unknown_panel");
        };
        let rect = self.slot(panel).unwrap_or(spec.rect);
        let size = [rect[2], rect[3]];
        let reply = self
            .placement
            .pop_out(self.now, panel, display, serial, full_screen, size);
        if let (Some((rect, display)), Some(s)) = (self.placed(panel), self.scopes.get_mut(panel)) {
            s.scope.placed(rect, display);
        }
        reply
    }

    /// `input`: one hardware input to a panel's canvas.
    pub fn input(&mut self, panel: &str, event: &Event) -> Value {
        if let Err(e) = self.panel_scope(panel) {
            return e;
        }
        let Some((doc, _)) = self.panel_document(panel) else {
            return refused("not_presented");
        };
        // The router's serial, your latest input for the card's display, and the gesture a
        // pop-out needs (#400, #401). A key goes to the panel that holds keyboard focus.
        let (serial, reached) = self.route(panel, event);
        let now = self.now;
        if matches!(reached, Some(ref to) if to.as_deref() != Some(panel)) {
            return json!({"serial": serial, "reached": [reached.flatten().map_or("shell".to_string(), |p| format!("panel:{p}"))]});
        }
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
        match self.snapshot(&shown, 0, None) {
            Ok(snap) => json!({"snapshot": snap}),
            Err(e) => e,
        }
    }

    /// A document drawn by render-back at `t`, at `size` or its own, as a PNG in the evidence
    /// store: `{sha256, w, h}`.
    pub(crate) fn snapshot(
        &mut self,
        doc: &Value,
        t: i64,
        size: Option<[u16; 2]>,
    ) -> Result<Value, Value> {
        let drawn = self
            .renderer
            .prepare(
                doc.as_object().expect("a document is an object"),
                t,
                &self.look.light,
                self.look.status.as_ref(),
                &self.record(),
                &self.scenario.evidence,
            )
            .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let [w, h] = drawn.frame.size;
        let size = size.unwrap_or([
            w.round().clamp(1.0, 8192.0) as u16,
            h.round().clamp(1.0, 8192.0) as u16,
        ]);
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let png = crate::snapshot::png(self.renderer.raster(&drawn, size, Some(ground)), size);
        crate::evidence::put(&self.scenario.evidence, &png)
            .map(|sha| json!({"sha256": sha, "w": size[0], "h": size[1]}))
            .map_err(|_| refused("not_written"))
    }

    /// `scope`: a panel's scope, with no input.
    pub fn scope_reply(&mut self, panel: &str) -> Value {
        match self.panel_scope(panel) {
            Ok(_) => json!({"state": self.state(panel)}),
            Err(e) => e,
        }
    }

    /// Each revision of a panel's document and the time it became current, in order.
    pub(crate) fn currents(&self, doc: &str) -> Vec<(i64, u64)> {
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
        // With displays, the window's own display paces the panel (#400): its vsync grid, and
        // the window's frame sequence over every panel it holds.
        let paced = self
            .placement
            .pacing(panel)
            .map(|(w, d)| (w.id.clone(), d.uuid.clone(), d.grid()));
        let grid = match (&paced, clock.refresh_hz) {
            (Some((_, _, g)), _) => *g,
            (None, Some(hz)) => Grid {
                next_vsync: FLICKS / hz,
                period: FLICKS / hz,
            },
            (None, None) => return refused("no_display"),
        };
        // A window's caps leave it only some of its display's vsyncs; a hidden one, none.
        let (slots, unseen) = match &paced {
            Some((window, _, g)) => self.placement.slots(window, *g, clock.lead, self.now),
            None => (grid.vsyncs_through(self.now).collect(), Vec::new()),
        };
        let mut frames = match self.panel_frames(panel, grid, &slots, clock.lead) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if let Some((window, display, _)) = paced {
            // The window's other panels' frames count in its sequence; reading them makes their
            // scopes as a `scope` call would.
            let siblings: Vec<String> = self
                .scenario
                .panels
                .keys()
                .filter(|p| p.as_str() != panel)
                .filter(|p| self.placement.window_of(p).is_some_and(|w| w.id == window))
                .cloned()
                .collect();
            let mut vsyncs: Vec<i64> = frames.iter().filter_map(|f| f["vsync"].as_i64()).collect();
            for p in siblings {
                if let Ok(f) = self.panel_frames(&p, grid, &slots, clock.lead) {
                    vsyncs.extend(f.iter().filter_map(|f| f["vsync"].as_i64()));
                }
            }
            vsyncs.sort_unstable();
            vsyncs.dedup();
            for f in &mut frames {
                let seq = f["vsync"]
                    .as_i64()
                    .and_then(|v| vsyncs.binary_search(&v).ok())
                    .map_or(0, |i| i + 1);
                f["window"] = json!(window);
                f["display"] = json!(display);
                f["frame_seq"] = json!(seq);
            }
            let evaluations = self.evaluations(panel, &window, &frames, &unseen, clock.lead);
            return json!({"frames": frames, "evaluations": evaluations});
        }
        json!({"frames": frames})
    }

    /// Every evaluation of the sessions drawn in `panel`, in order: one for each frame at its
    /// vsync, the predicted presentation time, and one at each vsync in `unseen` that presented
    /// nothing. An agent's session is drawn when a revision it wrote is current.
    fn evaluations(
        &self,
        panel: &str,
        window: &str,
        frames: &[Value],
        unseen: &[i64],
        lead: i64,
    ) -> Vec<Value> {
        let Some(doc) = self.panel_doc(panel) else {
            return Vec::new();
        };
        let currents = self.currents(&doc);
        let latest = |latch: i64| {
            currents
                .iter()
                .filter(|(at, _)| *at <= latch)
                .map(|(_, r)| *r)
                .max()
        };
        let mut at: Vec<(i64, u64)> = frames
            .iter()
            .filter_map(|f| Some((f["vsync"].as_i64()?, f["rev"].as_u64()?)))
            .chain(unseen.iter().filter_map(|v| Some((*v, latest(v - lead)?))))
            .collect();
        at.sort_unstable();
        let writer = |rev: u64| -> Option<&Writer> {
            match self.shared.get(&doc) {
                Some(s) => s.revs.iter().find(|r| r.rev == rev)?.writer.as_ref(),
                None => Some(
                    &self
                        .revisions
                        .get(&doc)?
                        .iter()
                        .find(|r| r.rev == rev)?
                        .writer,
                ),
            }
        };
        let mut out = Vec::new();
        for (vsync, rev) in at {
            // The agents' sessions whose revisions, current by then, the frame draws; an agent
            // writes as its session's thread.
            let sessions: BTreeSet<&str> = currents
                .iter()
                .filter(|(_, r)| *r <= rev)
                .filter_map(|(_, r)| writer(*r))
                .filter(|w| w.kind == WriterKind::Agent)
                .filter_map(|w| {
                    self.scenario
                        .sessions
                        .iter()
                        .find(|(_, s)| s.thread == w.id)
                })
                .map(|(id, _)| id.as_str())
                .collect();
            for session in sessions {
                out.push(json!({"at": vsync, "session": session, "window": window}));
            }
        }
        out
    }

    /// The frames a panel presented on `grid` up to now, at those of its vsyncs in `slots`
    /// (the ones its window's caps leave it), each latched `lead` before its vsync.
    fn panel_frames(
        &mut self,
        panel: &str,
        grid: Grid,
        slots: &[i64],
        lead: i64,
    ) -> Result<Vec<Value>, Value> {
        let doc = self
            .panel_doc(panel)
            .ok_or_else(|| refused("unknown_panel"))?;
        if !self.scenario.panels.contains_key(panel) {
            return Err(refused("unknown_panel"));
        }
        let currents = self.currents(&doc);
        // A document with no revision current yet, every one refused, has presented nothing
        // (#376: a refused figure never shows).
        if currents.is_empty() {
            return Ok(Vec::new());
        }
        let seen = self.panel_scope(panel)?.seen.clone();
        // The planted twin draws a revision current at a latch one frame later than it may.
        let late = if self.scenario.planted == Some(Planted::PatchShowsAFrameLate) {
            grid.period
        } else {
            0
        };
        let mut frames = Vec::new();
        let mut last: Option<(u64, &Seen)> = None;
        let mut until: Option<i64> = None;
        let mut motion: BTreeMap<u64, Option<Program>> = BTreeMap::new();
        for &vsync in slots {
            let latch = vsync - lead;
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
        Ok(frames)
    }
}
