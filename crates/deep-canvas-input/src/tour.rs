//! The tour (canvas primitives: Tour): the keys a document replays as input entries of the writer
//! `tour` while no one gives input, and, #903, the pointer that shows what they press.
//!
//! The pointer is a function of the tour's keys, the clock a run of the tour started on and the
//! layout alone. Before each key on a control that is drawn it glides to the centre of that
//! control's hit box as the layout has it at the key's time, starting at the later of the key
//! before and the key's time less `glide`, by the look's ease for a change of state; it rests
//! where it arrived; and on a slider whose key owns a segment it stays on the thumb until the
//! value stops. A key on a control that isn't drawn leaves it where it is. It holds no state of
//! its own, so a frame sought to and a frame played to draw the same pointer.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_motion::curve::Ease;
use serde_json::{json, Value};

use crate::session::Refused;
use crate::track::{Entry, Sample, Writer};

const F: i64 = FLICKS_PER_SECOND;
/// Your first gesture fades the pointer over this long.
const FADE: i64 = F / 5;

/// One key: at `t` on the tour's clock its control takes `value`. A `linear` key owns the
/// segment to its control's next key (Channel and key: `interp`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Key {
    pub t: i64,
    pub value: Value,
    pub linear: bool,
}

/// `tour.pointer`: whether it draws, how long a glide takes and how long a press's ring shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Pointer {
    pub show: bool,
    pub glide: i64,
    pub ring: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tour {
    /// Each keyed control's keys, in the document's order.
    pub(crate) keys: Vec<(String, Vec<Key>)>,
    pub idle_after: i64,
    pub(crate) resume_after: i64,
    /// The loop's length; 0 for a tour that plays once.
    pub(crate) period: i64,
    pub(crate) pointer: Pointer,
}

/// A key on the clock of one run of the tour: when it fires, its control (an index in
/// [`Tour::keys`]), its value, and for a linear key where and at what value its segment ends.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Stop {
    pub t: i64,
    pub control: usize,
    pub value: Value,
    pub to: Option<(i64, f64)>,
}

/// One stretch of the tour playing: its clock starts at `origin` with the pointer at `home`, and
/// your gesture at `end` stops it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Run {
    pub origin: i64,
    pub home: [f64; 2],
    pub end: Option<i64>,
}

/// The pointer as a frame draws it: its tip in px, the share of itself it draws with, and how
/// far a press's ring has come, 0 to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Drawn {
    pub tip: [f64; 2],
    pub opacity: f64,
    pub ring: Option<f64>,
}

/// What the pointer reads of the layout.
pub trait Layout {
    /// The centre of `control`'s hit box in px, in the layout evaluated at `t` with the control
    /// at `value`; none for a control that isn't drawn.
    fn anchor(&self, control: &str, value: &Value, t: i64) -> Option<[f64; 2]>;
    /// Whether a key on `control` presses it: a press or a toggle, which shows a ring.
    fn presses(&self, control: &str) -> bool;
}

/// Whole flicks for the decimal seconds a document writes.
fn flicks(seconds: f64) -> i64 {
    let x = seconds * F as f64;
    let r = x as i64;
    if x - r as f64 >= 0.5 {
        r + 1
    } else {
        r
    }
}

fn refused(code: &'static str, path: impl Into<String>) -> Refused {
    Refused {
        code,
        path: path.into(),
    }
}

/// The document's tour at check: its keys as the tour reads them, a refusal naming the key.
pub fn check(doc: &Value) -> Vec<deep_canvas::document::Issue> {
    let Some(tour) = doc.get("tour") else {
        return Vec::new();
    };
    let refused = Tour::of(tour).err().map(|r| {
        let what = "a tour's keys are {control: [[seconds, value, interp]]}";
        deep_canvas::document::Issue::envelope(r.code, r.path, tour.clone(), what)
    });
    refused.into_iter().collect()
}

impl Tour {
    /// A document's `tour`.
    pub fn of(t: &Value) -> Result<Tour, Refused> {
        let Some(keys) = t.get("keys").and_then(Value::as_object) else {
            return Err(refused("bad_doc", "tour/keys"));
        };
        let mut out = Vec::new();
        let mut last = 0;
        for (control, list) in keys {
            let mut ks = Vec::new();
            for (i, k) in list.as_array().into_iter().flatten().enumerate() {
                let a = k
                    .as_array()
                    .ok_or_else(|| refused("bad_doc", format!("tour/keys/{control}/{i}")))?;
                let s = a
                    .first()
                    .and_then(Value::as_f64)
                    .ok_or_else(|| refused("bad_doc", format!("tour/keys/{control}/{i}")))?;
                let at = flicks(s);
                last = last.max(at);
                ks.push(Key {
                    t: at,
                    value: a.get(1).cloned().unwrap_or(Value::Null),
                    linear: a.get(2).and_then(Value::as_str) == Some("linear"),
                });
            }
            out.push((control.clone(), ks));
        }
        let secs = |of: &Value, k: &str, d: f64| of.get(k).and_then(Value::as_f64).unwrap_or(d);
        let looping = t.get("loop").and_then(Value::as_bool).unwrap_or(true);
        let pointer = t.get("pointer").unwrap_or(&Value::Null);
        Ok(Tour {
            keys: out,
            idle_after: flicks(secs(t, "idle_after", 1.4)),
            resume_after: flicks(secs(t, "resume_after", 3.6)),
            period: if looping { last } else { 0 },
            pointer: Pointer {
                show: pointer.get("show").and_then(Value::as_bool).unwrap_or(true),
                glide: flicks(secs(pointer, "glide", 0.5)),
                ring: flicks(secs(pointer, "ring", 0.3)),
            },
        })
    }

    /// The lap a clock started at `origin` is in at `t`.
    pub(crate) fn lap(&self, origin: i64, t: i64) -> i64 {
        if self.period > 0 {
            ((t - origin) / self.period).max(0)
        } else {
            0
        }
    }

    /// The keys of laps `first` to `last` on a clock started at `origin`, in time order, keys of
    /// one flick in the controls' order. A tour that plays once has the one lap.
    pub(crate) fn stops(&self, origin: i64, first: i64, last: i64) -> Vec<Stop> {
        let last = if self.period > 0 { last } else { last.min(0) };
        let mut out = Vec::new();
        for lap in first..=last {
            let base = origin + lap * self.period;
            for (control, (_, keys)) in self.keys.iter().enumerate() {
                for (k, key) in keys.iter().enumerate() {
                    // A looping tour's key at the loop's end is the next lap's start.
                    if self.period > 0 && key.t >= self.period {
                        continue;
                    }
                    let to = keys
                        .get(k + 1)
                        .filter(|next| key.linear && key.value.is_number() && next.t > key.t)
                        .and_then(|next| Some((base + next.t, next.value.as_f64()?)));
                    out.push(Stop {
                        t: base + key.t,
                        control,
                        value: key.value.clone(),
                        to,
                    });
                }
            }
        }
        out.sort_by_key(|s| (s.t, s.control));
        out
    }

    /// The entry `stop` writes: stamped `tour`, with no serial, and for a linear key the two
    /// ends of its segment as its polyline.
    pub(crate) fn entry(&self, stop: &Stop) -> Entry {
        let sample = |t: i64, value: Value| Sample {
            t,
            value,
            at: None,
            px: None,
        };
        Entry {
            t: stop.t,
            seq: 0,
            control: self.keys[stop.control].0.clone(),
            value: stop.value.clone(),
            samples: stop
                .to
                .map(|(t, v)| vec![sample(stop.t, stop.value.clone()), sample(t, json!(v))]),
            writer: Writer::Tour,
            serial: None,
        }
    }

    /// The entries the tour writes up to `until` where no one gives input: its clock starts
    /// `idle_after` past 0 and nothing stops it.
    pub fn entries(&self, until: i64) -> Vec<Entry> {
        if until < self.idle_after {
            return Vec::new();
        }
        let stops = self.stops(self.idle_after, 0, self.lap(self.idle_after, until));
        let due = stops.iter().filter(|s| s.t <= until);
        due.map(|s| self.entry(s)).collect()
    }

    /// The pointer a frame at `t` draws in `run`, or none where no pointer pixel draws: hidden
    /// by `show`, before the run, or once your gesture has faded it. `ease` is the look's ease
    /// for a change of state. `eager` is the planted program whose every glide starts `glide`
    /// before its key, whatever came before.
    pub fn pointer(
        &self,
        run: &Run,
        t: i64,
        layout: &dyn Layout,
        ease: Ease,
        eager: bool,
    ) -> Option<Drawn> {
        if !self.pointer.show || t < run.origin {
            return None;
        }
        // From your gesture on it holds its place and fades.
        let (at, opacity) = match run.end {
            Some(end) if t - end >= FADE => return None,
            Some(end) if t >= end => (end, 1.0 - (t - end) as f64 / FADE as f64),
            _ => (t, 1.0),
        };
        let lap = self.lap(run.origin, at);
        let first = (lap - 1).max(0);
        let stops = self.stops(run.origin, first, lap + 1);
        let glides = Glides {
            tour: self,
            stops: &stops,
            floor: run.origin + first * self.period,
            home: run.home,
            layout,
            ease,
            eager,
        };
        let (tip, on) = glides.place(stops.len(), at);
        let ring = on
            .filter(|&j| layout.presses(&self.keys[stops[j].control].0))
            .map(|j| at - stops[j].t)
            .filter(|since| *since < self.pointer.ring)
            .map(|since| since as f64 / self.pointer.ring as f64);
        Some(Drawn { tip, opacity, ring })
    }
}

/// The pointer's path over a run's stops.
struct Glides<'a> {
    tour: &'a Tour,
    stops: &'a [Stop],
    /// No glide starts before this: the run's origin, or the first lap looked at.
    floor: i64,
    home: [f64; 2],
    layout: &'a dyn Layout,
    ease: Ease,
    eager: bool,
}

impl Glides<'_> {
    /// Where the pointer is at `t`, counting only the stops before `upto`, and the stop it
    /// rests on, if it has arrived at one.
    fn place(&self, upto: usize, t: i64) -> ([f64; 2], Option<usize>) {
        for j in (0..upto).rev() {
            let stop = &self.stops[j];
            let before = j.checked_sub(1).map_or(self.floor, |k| self.stops[k].t);
            let start = match self.eager {
                true => stop.t - self.tour.pointer.glide,
                false => (stop.t - self.tour.pointer.glide).max(before),
            };
            if start > t {
                continue;
            }
            let control = &self.tour.keys[stop.control].0;
            // A key on a control that isn't drawn leaves the pointer where it is.
            let Some(to) = self.layout.anchor(control, &stop.value, stop.t) else {
                continue;
            };
            if t >= stop.t {
                return (self.rest(stop, control, to, t), Some(j));
            }
            let (from, on) = self.place(j, start);
            // A key inside the segment of the slider the pointer rides leaves it on the thumb.
            let rides = |ridden: &Stop| {
                ridden.control == stop.control && ridden.to.is_some_and(|(end, _)| end >= stop.t)
            };
            if on.is_some_and(|i| rides(&self.stops[i])) {
                return self.place(j, t);
            }
            let w = self.ease.at((t - start) as f64 / (stop.t - start) as f64);
            let mix = |k: usize| from[k] + (to[k] - from[k]) * w;
            return ([mix(0), mix(1)], None);
        }
        (self.home, None)
    }

    /// Where the pointer rests after `stop`: where it arrived, or, while a linear key's value
    /// moves, on the control's hit box as the layout then has it.
    fn rest(&self, stop: &Stop, control: &str, arrived: [f64; 2], t: i64) -> [f64; 2] {
        let (Some((end, last)), Some(first)) = (stop.to, stop.value.as_f64()) else {
            return arrived;
        };
        let at = t.min(end);
        let value = first + (last - first) * ((at - stop.t) as f64 / (end - stop.t) as f64);
        let moved = self.layout.anchor(control, &json!(value), at);
        moved.unwrap_or(arrived)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two buttons 100 px apart on a line, and a slider whose thumb is at 1000 × its value.
    struct Row;
    impl Layout for Row {
        fn anchor(&self, control: &str, value: &Value, _: i64) -> Option<[f64; 2]> {
            match control {
                "a" => Some([100.0, 0.0]),
                "b" => Some([200.0, 0.0]),
                "s" => Some([1000.0 * value.as_f64()?, 50.0]),
                _ => None,
            }
        }
        fn presses(&self, control: &str) -> bool {
            control != "s"
        }
    }

    const RUN: Run = Run {
        origin: 0,
        home: [0.0, 0.0],
        end: None,
    };

    fn at(tour: &Tour, seconds: f64) -> Drawn {
        let drawn = tour.pointer(&RUN, flicks(seconds), &Row, Ease::Linear, false);
        drawn.expect("a pointer")
    }

    #[test]
    fn a_key_on_a_control_that_is_not_drawn_leaves_the_pointer_where_it_is() {
        let keys = json!({"a": [[1, 1, "hold"]], "key": [[2, 1, "hold"]], "b": [[4, 1, "hold"]]});
        let t = Tour::of(&json!({"keys": keys, "idle_after": 0, "loop": false})).expect("a tour");
        assert_eq!(at(&t, 2.0).tip, [100.0, 0.0]);
        assert_eq!(at(&t, 3.5).tip, [100.0, 0.0]);
        assert_eq!(at(&t, 3.75).tip, [150.0, 0.0]);
    }

    #[test]
    fn a_press_shows_its_ring_over_ring_and_a_slider_key_shows_none() {
        let keys = json!({"a": [[1, 1, "hold"]], "s": [[3, 0.5, "hold"]]});
        let t = Tour::of(&json!({"keys": keys, "idle_after": 0, "loop": false})).expect("a tour");
        assert_eq!(at(&t, 0.9).ring, None);
        assert_eq!(at(&t, 1.15).ring, Some(0.5));
        assert_eq!(at(&t, 1.3).ring, None);
        assert_eq!(at(&t, 3.1).ring, None);
    }

    #[test]
    fn a_linear_key_writes_the_two_ends_of_its_segment_as_its_polyline() {
        let keys = json!({"s": [[4, 0, "linear"], [6, 1, "hold"]]});
        let t = Tour::of(&json!({"keys": keys, "idle_after": 1, "loop": false})).expect("a tour");
        let entries = t.entries(flicks(6.5));
        let ends = |e: &Entry| -> Vec<(i64, Value)> {
            let samples = e.samples.iter().flatten();
            samples.map(|s| (s.t, s.value.clone())).collect()
        };
        assert_eq!(entries.len(), 1, "the key at 7 s is still to come");
        let (from, to) = (flicks(5.0), flicks(7.0));
        assert_eq!((entries[0].t, entries[0].writer), (from, Writer::Tour));
        assert_eq!(ends(&entries[0]), [(from, json!(0)), (to, json!(1.0))]);
        assert_eq!(t.entries(flicks(7.0))[1].samples, None);
    }

    #[test]
    fn the_check_refuses_a_tour_with_no_keys_and_a_key_with_no_time() {
        let paths = |tour: Value| -> Vec<String> {
            let issues = check(&json!({"tour": tour}));
            issues.into_iter().map(|i| i.path).collect()
        };
        let untimed = json!({"keys": {"a": [["soon", 1]]}});
        let keyed = json!({"keys": {"a": [[1, 1, "hold"]]}});
        assert_eq!(paths(json!({"idle_after": 1})), ["tour/keys"]);
        assert_eq!(paths(untimed), ["tour/keys/a/0"]);
        assert_eq!(paths(keyed), [] as [&str; 0]);
        assert_eq!(check(&json!({})), []);
    }

    #[test]
    fn a_looping_tour_glides_on_from_where_the_lap_before_left_it() {
        let keys = json!({"a": [[1, 1, "hold"]], "b": [[2, 1, "hold"]], "end": [[4, 1, "hold"]]});
        let t = Tour::of(&json!({"keys": keys, "idle_after": 0})).expect("a tour");
        assert_eq!(at(&t, 3.0).tip, [200.0, 0.0]);
        assert_eq!(at(&t, 4.75).tip, [150.0, 0.0]);
        assert_eq!(at(&t, 41.0).tip, [100.0, 0.0]);
    }
}
