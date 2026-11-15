//! #542: the scroll control in a session of the input module (canvas primitives: Control:
//! scroll). A `scroll` op over a scroll control's area turns wheel lines and trackpad pixels into
//! whole steps once, at the event: each step is one entry of yours stamped with the event's own
//! time, so the same events played at any frame rate write one track. A trackpad gesture belongs
//! to the control it began over; outside every area the camera keeps the wheel and the session
//! writes nothing.

use serde_json::{json, Map, Value};

use deep_canvas::scope::Phase;

use super::{contains, mods_of, pair, refused, Refused, Session};
use crate::scroll::{rounded_share, Gesture, Route, Router, Spec};
use crate::track::{Entry, Writer};

/// A scroll control: its ID, fields and area, its position, and the gesture under way.
struct Control {
    id: String,
    spec: Spec,
    area: String,
    document: bool,
    default: i64,
    at: i32,
    gesture: Gesture,
}

/// The document's scroll controls and the trackpad gesture under way.
#[derive(Default)]
pub(super) struct Scrolls {
    list: Vec<Control>,
    /// Where the trackpad gesture under way goes.
    router: Router,
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
                    default,
                    at: spec.clamp(default),
                    area: c.pointer("/scroll/area")?.as_str()?.to_string(),
                    document: Spec::document(c),
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
        let phase = match op.get("phase").and_then(Value::as_str) {
            Some("begin") => Phase::Begin,
            Some("change") => Phase::Change,
            Some("end") => Phase::End,
            _ => return Err(refused("bad_input", "phase")),
        };
        let mods = mods_of(op.get("mods"));
        let at = pair(op.get("at")).ok_or_else(|| refused("bad_input", "at"))?;
        let delta = pair(op.get("delta")).ok_or_else(|| refused("bad_input", "delta"))?;
        let line = op.get("unit").and_then(Value::as_str) == Some("line");
        self.advance(t, true);
        let w = self.world(at);
        let over = self
            .scrolls
            .list
            .iter()
            .find(|c| self.items.get(&c.area).is_some_and(|r| contains(r, w)))
            .map(|c| c.id.clone());
        let route = self.scrolls.router.route(
            phase,
            line,
            false,
            [mods.shift, false, false, mods.cmd],
            over.as_deref(),
        );
        let ends = phase == Phase::End || line;
        let Route::To(id) = route else {
            return Ok(json!({"appended": 0, "dropped": 0}));
        };
        let Some(i) = self.scrolls.list.iter().position(|c| c.id == id) else {
            return Ok(json!({"appended": 0, "dropped": 0}));
        };
        // A document-class position is the track's at the event, which a seek may have moved.
        let c = &self.scrolls.list[i];
        if c.document {
            let default = c.spec.clamp(c.default);
            let at = self.track.last_at(&c.id, t).and_then(|e| e.value.as_i64());
            let at = at.map_or(default, |p| c.spec.clamp(p));
            self.scrolls.list[i].at = at;
        }
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
            if phase == Phase::Change {
                let sum = self.scrolls.share.map_or(0.0, |s| s.1) + d;
                self.scrolls.share = Some((k, sum));
            }
        } else if line {
            let steps = c.gesture.lines(&c.spec, &mut c.at, d);
            written.extend(steps.into_iter().map(|p| (t, p)));
        } else if phase == Phase::Change {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::session::{Planted, Session};

    #[test]
    fn a_wheel_line_after_a_seek_moves_on_from_the_position_at_its_time() {
        let doc = json!({"size": [480, 240], "items": {"listbox": {"params": {"box": [0, 0, 240, 240]}}},
            "controls": {"list": {"kind": "scroll", "class": "document", "default": 0,
                "scroll": {"step": 24, "range": [0, 190], "area": "listbox"}}}});
        let mut s = Session::new(
            &doc,
            [480.0, 240.0],
            (60, 1),
            false,
            Planted::default(),
            &[],
        )
        .expect("a session");
        let second = 705_600_000;
        let line = |t: i64| json!({"op": "scroll", "phase": "change", "at": [120, 120], "delta": [0, 1], "unit": "line", "t": t});
        for k in 0..3 {
            s.op(line(second + k).as_object().expect("an op"))
                .expect("a line");
        }
        s.op(json!({"op": "seek", "t": 0}).as_object().expect("an op"))
            .expect("a seek");
        s.op(line(second / 2).as_object().expect("an op"))
            .expect("a line");
        let values: Vec<_> = s.track.entries().iter().map(|e| e.value.clone()).collect();
        assert_eq!(values, [json!(1)]);
    }
}
