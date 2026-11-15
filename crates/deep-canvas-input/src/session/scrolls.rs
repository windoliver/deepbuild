//! #542: the scroll control in a session of the input module (canvas primitives: Control:
//! scroll). A `scroll` op over a scroll control's area turns wheel lines and trackpad pixels into
//! whole steps once, at the event: each step is one entry of yours stamped with the event's own
//! time, so the same events played at any frame rate write one track. A trackpad gesture belongs
//! to the control it began over; outside every area the camera keeps the wheel and the session
//! writes nothing.

use serde_json::{json, Map, Value};

use super::{contains, pair, refused, Refused, Session};
use crate::scroll::{rounded_share, Gesture, Spec};
use crate::track::{Entry, Writer};

/// A scroll control: its ID, fields and area, its position, and the gesture under way.
struct Control {
    id: String,
    spec: Spec,
    area: String,
    document: bool,
    at: i32,
    gesture: Gesture,
}

/// The document's scroll controls and the trackpad gesture under way.
#[derive(Default)]
pub(super) struct Scrolls {
    list: Vec<Control>,
    /// The control the trackpad gesture under way began over, or none: the camera's.
    latched: Option<Option<usize>>,
    /// The planted per-frame rounding: the frame taking the gesture's pixels, and their sum.
    share: Option<(i64, f64)>,
}

impl Scrolls {
    pub(super) fn of(doc: &Value) -> Scrolls {
        let controls = doc.get("controls").and_then(Value::as_object);
        let list = controls
            .into_iter()
            .flatten()
            .filter(|(_, c)| c.get("kind").and_then(Value::as_str) == Some("scroll"))
            .filter_map(|(id, c)| {
                let spec = Spec::of(c)?;
                let default = c.get("default").and_then(Value::as_i64).unwrap_or(0);
                Some(Control {
                    id: id.clone(),
                    at: spec.clamp(default),
                    area: c.pointer("/scroll/area")?.as_str()?.to_string(),
                    document: c.get("class").and_then(Value::as_str) != Some("view"),
                    spec,
                    gesture: Gesture::default(),
                })
            })
            .collect();
        Scrolls {
            list,
            ..Scrolls::default()
        }
    }
}

impl Session {
    /// `{op: scroll, phase, at, delta, unit?}`: a trackpad's pixels or, with `unit: line`, a
    /// wheel's notch, which is a gesture of its own.
    pub(super) fn scroll(&mut self, op: &Map<String, Value>, t: i64) -> Result<Value, Refused> {
        let phase = op.get("phase").and_then(Value::as_str).unwrap_or("");
        if !matches!(phase, "begin" | "change" | "end") {
            return Err(refused("bad_input", "phase"));
        }
        let at = pair(op.get("at")).ok_or_else(|| refused("bad_input", "at"))?;
        let delta = pair(op.get("delta")).ok_or_else(|| refused("bad_input", "delta"))?;
        let line = op.get("unit").and_then(Value::as_str) == Some("line");
        self.advance(t, true);
        let w = self.world(at);
        let over = self
            .scrolls
            .list
            .iter()
            .position(|c| self.items.get(&c.area).is_some_and(|r| contains(r, w)));
        let target = if line {
            over
        } else {
            if phase == "begin" {
                self.scrolls.latched = Some(over);
            }
            self.scrolls.latched.unwrap_or(over)
        };
        let ends = phase == "end" || line;
        if phase == "end" && !line {
            self.scrolls.latched = None;
        }
        let Some(i) = target else {
            return Ok(json!({"appended": 0, "dropped": 0}));
        };
        let (rounds, nearest) = (
            self.planted.scroll_rounds_each_frame && !line,
            self.planted.scroll_snaps_to_nearest,
        );
        let frame = self.frame;
        let scale = self.scale;
        let c = &mut self.scrolls.list[i];
        let d = if c.spec.axis_x { delta[0] } else { delta[1] };
        let mut written: Vec<(i64, i32)> = Vec::new();
        let per_step = c.spec.step / scale;
        if rounds {
            // Planted: each frame's pixels summed and rounded on their own, at the frame.
            let k = (t + frame - 1).div_euclid(frame);
            if let Some((fk, px)) = self.scrolls.share.filter(|(fk, _)| *fk != k || ends) {
                let steps = rounded_share(&c.spec, &mut c.at, px, per_step);
                written.extend(steps.into_iter().map(|p| (fk * frame, p)));
                self.scrolls.share = None;
            }
            if phase == "change" {
                let sum = self.scrolls.share.map_or(0.0, |s| s.1) + d;
                self.scrolls.share = Some((k, sum));
            }
        } else if line {
            let steps = c.gesture.lines(&c.spec, &mut c.at, d);
            written.extend(steps.into_iter().map(|p| (t, p)));
        } else if phase == "change" {
            let steps = c.gesture.pixels(&c.spec, &mut c.at, d, per_step);
            written.extend(steps.into_iter().map(|p| (t, p)));
        }
        if ends {
            let snapped = c.gesture.end(&c.spec, &mut c.at, nearest);
            written.extend(snapped.into_iter().map(|p| (t, p)));
        }
        if !c.document || written.is_empty() {
            return Ok(json!({"appended": 0, "dropped": 0}));
        }
        let id = c.id.clone();
        let serial = self.next_serial();
        let mut dropped = 0;
        for (stamp, p) in &written {
            dropped += self.track.append(Entry {
                t: *stamp,
                seq: 0,
                control: id.clone(),
                value: json!(p),
                samples: None,
                writer: Writer::You,
                serial: Some(serial),
            });
        }
        Ok(json!({"appended": written.len(), "dropped": dropped}))
    }
}
