//! #1217 (canvas primitives: Selection (session state), `viewer_tools.measure`): the measure tool
//! in a panel. In a document that offers it, the viewer's setting `measure` turns it on; then a
//! click places a point where the pointer's ray meets the item the object-ID target names
//! (`deep_canvas_scene3d::measure`), the first A, the second B, a third A again; Esc clears both;
//! Tab walks the parts' anchors and Enter places a point at the one focused. A press that moves
//! is still the camera's drag. The points are the panel's session state: no entry, value or
//! revision is written, a click the tool takes selects nothing, and only the app's window draws
//! them, over the frame.

use deep_canvas::scope::{Done, Event, Hit};
use deep_canvas_input::track::{Entry, Writer};
use deep_canvas_scene3d::measure::{self, Point, Tool};
use deep_canvas_scene3d::scene::{Leader, Overlay, Scene, Shape2};
use deep_canvas_scene3d::{overlay, pointer};
use serde_json::{json, Value};

use crate::hub::Hub;
use crate::points::Gesture;

/// A press turns into a drag, the camera's, once the pointer has moved this many px.
const DRAG_PX: f64 = 3.0;

/// A panel's measure tool, and where a press that may still be its click went down, panel px.
#[derive(Default)]
pub(crate) struct Viewer {
    pub(crate) tool: Tool,
    press: Option<[f64; 2]>,
}

impl Viewer {
    /// The tool in a scope's state, for a document that offers it: `measure`, and the focused
    /// anchor as the Tab stop with focus.
    pub(crate) fn shown_in(&self, doc: &Value, planted: Option<&str>, state: &mut Value) {
        if !Tool::offered(doc) {
            return;
        }
        state["measure"] = self.tool.to_json(doc, planted);
        if let Some(anchor) = &self.tool.focus {
            state["focus"] = json!(anchor);
        }
    }
}

/// `top` (straight RGBA, `top_size` px) drawn over `base` (`size` px) with its top left at `at`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn over_at(base: &mut [u8], size: [u16; 2], top: &[u8], top_size: [u16; 2], at: [i64; 2]) {
    let (w, h) = (i64::from(size[0]), i64::from(size[1]));
    for (row, line) in top.chunks_exact(usize::from(top_size[0]) * 4).enumerate() {
        let y = at[1] + row as i64;
        for (col, t) in line.as_chunks::<4>().0.iter().enumerate() {
            let (x, a) = (at[0] + col as i64, u32::from(t[3]));
            if a == 0 || !(0..w).contains(&x) || !(0..h).contains(&y) {
                continue;
            }
            let b = &mut base[((y * w + x) * 4) as usize..][..4];
            for c in 0..3 {
                b[c] = ((u32::from(t[c]) * a + u32::from(b[c]) * (255 - a) + 127) / 255) as u8;
            }
            b[3] = (a + u32::from(b[3]) * (255 - a) / 255) as u8;
        }
    }
}

impl Hub<'_> {
    /// An input to a panel whose document offers the tool, before anything else takes it: `Some`
    /// with the reply when the tool took it.
    pub(crate) fn measure_input(
        &mut self,
        panel: &str,
        doc: &Value,
        event: &Event,
        g: &Gesture,
        serial: u64,
    ) -> Result<Option<Value>, Value> {
        let Some(id) = self.panel_doc(panel).filter(|_| Tool::offered(doc)) else {
            return Ok(None);
        };
        let Some(v) = self.scopes.get(panel).map(|s| &s.measure) else {
            return Ok(None);
        };
        let (on, press, focused) = (v.tool.on, v.press, v.tool.focus.is_some());
        let primary = g.button.as_deref().is_none_or(|b| b == "primary");
        let moved = |to: &[f64; 2]| {
            press.is_some_and(|p| deep_canvas::ops::hypot(to[0] - p[0], to[1] - p[1]) >= DRAG_PX)
        };
        let (mut placed, mut done) = (None, None);
        match event {
            Event::Control { control, value }
                if control == "measure" && doc.pointer("/controls/measure").is_none() =>
            {
                let Some(to) = value.as_bool() else {
                    return Err(
                        json!({"code": "out_of_range", "control": control, "value": value}),
                    );
                };
                if let Some(s) = self.scopes.get_mut(panel) {
                    s.measure.tool.set(doc, to);
                    s.measure.press = None;
                }
            }
            // The press may still move, and then it turns the view: the scope takes it too. A
            // press on the canvas's own button stays the button's.
            Event::Down { pos, .. }
                if on && primary && self.scopes[panel].scope.hit(doc, *pos) != Hit::Button =>
            {
                if let Some(s) = self.scopes.get_mut(panel) {
                    s.measure.press = Some(*pos);
                }
                done = Some(self.measure_scope(panel, doc, event, serial));
            }
            Event::Move(pos) if moved(pos) => {
                if let Some(s) = self.scopes.get_mut(panel) {
                    s.measure.press = None;
                }
                return Ok(None);
            }
            // A click: a point where it went down, and neither a selection nor a card.
            Event::Up(_) if press.is_some() => {
                if let Some(s) = self.scopes.get_mut(panel) {
                    s.measure.press = None;
                    s.scope.release();
                }
                placed = self.measure_pick(panel, &id, press.unwrap_or_default())?;
                if let (Some(p), Some(s)) = (&placed, self.scopes.get_mut(panel)) {
                    s.measure.tool.put(p.clone());
                }
            }
            Event::Key {
                key, cmd: false, ..
            } if on => match key.as_str() {
                "Escape" => {
                    let cleared = self.scopes.get_mut(panel).map(|s| s.measure.tool.clear());
                    if cleared != Some(true) {
                        return Ok(None);
                    }
                }
                // Tab walks the parts' anchors, then the document's own stops, and round again.
                "Tab" => {
                    if self
                        .scopes
                        .get(panel)
                        .is_some_and(|s| s.scope.focus.is_some())
                    {
                        return Ok(None);
                    }
                    let anchors = self.measure_anchors(panel, &id, doc)?;
                    let Some(s) = self.scopes.get_mut(panel) else {
                        return Ok(None);
                    };
                    s.measure.tool.tab(&anchors);
                    if s.measure.tool.focus.is_none() {
                        return Ok(None);
                    }
                }
                "Enter" | "Return" if focused => {
                    let anchors = self.measure_anchors(panel, &id, doc)?;
                    if let Some(tool) = self.scopes.get_mut(panel).map(|s| &mut s.measure.tool) {
                        if tool.enter(&anchors) {
                            placed = tool.b.clone().or(tool.a.clone());
                        }
                    }
                }
                _ => return Ok(None),
            },
            _ => return Ok(None),
        }
        // Planted (#1217 criterion 4): each point placed also appends an input entry.
        let mut appended = Vec::new();
        let plants = self.scenario.module_planted.as_deref() == Some(measure::WRITES_ENTRY);
        if let Some(p) = placed.filter(|_| plants) {
            let entry = Entry {
                t: self.now,
                seq: 0,
                control: "measure".into(),
                value: json!({"item": p.item, "point": p.point}),
                samples: None,
                writer: Writer::You,
                serial: Some(serial as u32),
                player: None,
            };
            appended.push(entry.to_json());
            self.tracks.entry(id).or_default().append(entry);
        }
        let (picks, commits) = match done {
            Some(d) => (d.picks, d.commits),
            None => (u32::from(matches!(event, Event::Up(_))), vec![serial]),
        };
        Ok(Some(json!({
            "serial": serial,
            "state": self.state(panel),
            "picks": picks,
            "commits": commits.iter().map(|g| json!({"gesture": g})).collect::<Vec<_>>(),
            "appended": appended,
        })))
    }

    /// `event` given to the panel's scope, and what the panel shows after it.
    fn measure_scope(&mut self, panel: &str, doc: &Value, event: &Event, serial: u64) -> Done {
        let now = self.now;
        let done = match self.scopes.get_mut(panel) {
            Some(s) => s.scope.input(doc, now, serial, event),
            None => Done::default(),
        };
        if let (Some(seen), Some(s)) = (self.seen(panel), self.scopes.get_mut(panel)) {
            s.seen.push((now, seen));
        }
        done
    }

    /// The point a click at panel point `pos` places: on the item the object-ID target names
    /// there, within the hit margin, where the click's ray meets it; none on the sky, or where
    /// this machine draws no 3D.
    fn measure_pick(
        &mut self,
        panel: &str,
        doc: &str,
        pos: [f64; 2],
    ) -> Result<Option<Point>, Value> {
        let now = self.now;
        let snap = self.scopes.get(panel).map_or(0.0, |s| s.measure.tool.snap);
        let Some((scene, look)) = self.scene_at(panel, doc, now)? else {
            return Ok(None);
        };
        let px = self.frame_px(panel, &scene, pos);
        let Some((_, drawn)) = self.gpu3().and_then(|g| g.draw_scene(&scene, &look, false)) else {
            return Ok(None);
        };
        let ids = pointer::Ids {
            size: drawn.size,
            ids: &drawn.ids,
            picks: &drawn.picks,
        };
        let named = pointer::topmost(&scene, &ids, px, measure::MARGIN, &|_: &str| true, None);
        Ok(named.and_then(|target| measure::place(&scene, px, &target, snap)))
    }

    /// The anchors of the parts the panel shows now, in the world.
    fn measure_anchors(
        &mut self,
        panel: &str,
        id: &str,
        doc: &Value,
    ) -> Result<Vec<(String, [f64; 3])>, Value> {
        let now = self.now;
        let scene = self.scene_at(panel, id, now)?;
        Ok(scene.map_or_else(Vec::new, |(scene, _)| measure::anchors(&scene, doc)))
    }

    /// The panel's measure drawn over its frame `rgba` (`size` px, the frame `scene` drew): its
    /// line, its points and its readout, in the look's accent. Display only.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn measure_over(
        &mut self,
        panel: &str,
        scene: &Scene,
        rgba: &mut [u8],
        size: [u16; 2],
    ) {
        let tool = self.scopes.get(panel).map(|s| s.measure.tool.clone());
        let (Some(tool), Some((doc, _))) = (tool.filter(|t| t.on), self.panel_document(panel))
        else {
            return;
        };
        let role = |name: &str| self.look.light.get(name).copied();
        let color = role("accent").or(role("ink")).unwrap_or([0; 3]);
        // The frame's px a point of the document.
        let k = match doc["size"][0].as_f64() {
            Some(w) if w > 0.0 => scene.camera.size[0] / w,
            _ => 1.0,
        };
        let [a, b] = measure::shown(&tool, scene);
        let line = (a.zip(b)).map(|(a, b)| Leader {
            points: Some(vec![a, b]),
            width: 2.0 * k,
            color,
            dot: false,
        });
        let dots = [a, b].into_iter().flatten().map(|at| Overlay {
            id: String::new(),
            layer: String::new(),
            origin: Some(at),
            shapes: vec![Shape2::Circle {
                center: [0.0, 0.0],
                r: 4.0 * k,
                color,
            }],
            leader: None,
        });
        let pictures = (line.as_ref().and_then(overlay::leader_picture).into_iter())
            .chain(dots.filter_map(|d| overlay::picture(&d)));
        for p in pictures {
            over_at(rgba, size, &p.rgba, p.size, p.at);
        }
        let planted = self.scenario.module_planted.clone();
        let (Some(read), Some((a, b))) = (tool.readout(&doc, planted.as_deref()), a.zip(b)) else {
            return;
        };
        let text = measure::label(&read);
        // A plate beside the line's middle, kept inside the frame.
        let (w, h) = (text.chars().count() as f64 * 7.3 + 16.0, 24.0);
        let paint = json!({"fill": {"role": "ground"}, "stroke": {"role": "accent", "width": 1}});
        let items = vec![
            json!({"id": "plate", "kind": "rect@1", "name": "Plate", "order": "a0",
                "params": {"box": [0.5, 0.5, w - 1.0, h - 1.0], "paint": paint}}),
            json!({"id": "readout", "kind": "text@1", "name": "Measure", "order": "a1", "at": {"pos": [8, 5, 0]},
                "params": {"text": text, "font": "mono", "size": 12, "box": {"w": w - 16.0, "h": h - 8.0}}}),
        ];
        let px = [(w * k).round() as u16, (h * k).round() as u16];
        let Some((plate, px)) = self.board_rgba("measure-readout", items, [w, h], px) else {
            return;
        };
        let room = |i: usize| (i64::from(size[i]) - i64::from(px[i])).max(0);
        let at = [
            (((a[0] + b[0]) / 2.0 + 12.0 * k) as i64).clamp(0, room(0)),
            (((a[1] + b[1]) / 2.0) as i64 - i64::from(px[1]) / 2).clamp(0, room(1)),
        ];
        over_at(rgba, size, &plate, px, at);
    }
}
