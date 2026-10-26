//! Issue #383: your input to a canvas, through the core's interaction scope, and the frames a
//! panel presents. Each panel's canvas has one scope; the input router gives every input a serial;
//! a frame at vsync v draws what was current at its latch, v − lead: the revision and the camera
//! the latest input before it left (Frame clock and scheduler; Frame callback and presentation
//! feedback).

use deep_canvas::scope::{self, Event, Phase, Scope};
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};
use crate::shared::FLICKS;

/// A panel's scope and the camera after each input, by the time it arrived.
pub struct PanelScope {
    scope: Scope,
    cameras: Vec<(i64, Value)>,
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

    /// The current revision a panel shows.
    fn panel_document(&self, panel: &str) -> Option<Value> {
        let doc = self.panel_doc(panel)?;
        match self.shared.get(&doc) {
            Some(s) => Some(s.doc.clone()),
            None => self.current(&doc).map(|r| r.doc.clone()),
        }
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
            let doc = self
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
            let cameras = vec![(0, scope.pose().to_json())];
            self.scopes
                .insert(panel.to_string(), PanelScope { scope, cameras });
        }
        Ok(self.scopes.get_mut(panel).expect("inserted above"))
    }

    /// `input`: one hardware input to a panel's canvas.
    pub fn input(&mut self, panel: &str, event: &Event) -> Value {
        let Some(doc) = self.panel_document(panel) else {
            return refused("not_presented");
        };
        self.serial += 1;
        let (serial, now) = (self.serial, self.now);
        let late = self.scenario.planted == Some(Planted::DragShowsOnRelease)
            && matches!(event, Event::Move(_));
        let s = match self.panel_scope(panel) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let done = s.scope.input(&doc, now, serial, event);
        if !late {
            s.cameras.push((now, s.scope.pose().to_json()));
        }
        json!({
            "serial": serial,
            "state": s.scope.to_json(),
            "picks": done.picks,
            "commits": done.commits.iter().map(|g| json!({"gesture": g})).collect::<Vec<_>>(),
        })
    }

    /// `scope`: a panel's scope, with no input.
    pub fn scope_reply(&mut self, panel: &str) -> Value {
        match self.panel_scope(panel) {
            Ok(s) => json!({"state": s.scope.to_json()}),
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

    /// `presented`: every frame presented for a panel's document up to now. A frame presents at
    /// a vsync when what its latch sees, the revision and the camera, differs from the last one.
    pub fn presented(&mut self, panel: &str) -> Value {
        let Some(clock) = self.scenario.clock else {
            return refused("no_clock");
        };
        let Some(doc) = self.panel_doc(panel) else {
            return refused("unknown_panel");
        };
        let currents = self.currents(&doc);
        let now = self.now;
        let cameras = match self.panel_scope(panel) {
            Ok(s) => s.cameras.clone(),
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
        let mut last: Option<(u64, &Value)> = None;
        let mut k = 1;
        while k * period <= now {
            let vsync = k * period;
            let latch = vsync - clock.lead;
            k += 1;
            let rev = currents
                .iter()
                .filter(|(at, _)| *at + late <= latch)
                .map(|(_, r)| *r)
                .max();
            let camera = cameras.iter().rev().find(|(at, _)| *at <= latch);
            let (Some(rev), Some((_, camera))) = (rev, camera) else {
                continue;
            };
            if last.is_some_and(|(r, c)| r == rev && c == camera) {
                continue;
            }
            last = Some((rev, camera));
            frames.push(json!({"vsync": vsync, "rev": rev, "camera": camera}));
        }
        json!({"frames": frames})
    }
}
