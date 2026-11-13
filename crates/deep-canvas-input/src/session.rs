//! A session of the input module (canvas primitives: Control; Input track; Tour; Scope and input
//! classes): a document's controls driven by pointer and key events, the parameter tool and the
//! tour, writing the one input track. Every entry is resolved once, at the gesture: its value and
//! the polyline of values it passed through, with modifiers and anchors already applied, so a
//! replay reads what was recorded at any frame rate and wherever the camera has moved since.
//!
//! The drag grammar (issue #308, "One drag grammar"): grabbing the handle keeps the offset;
//! pressing the track elsewhere moves there and drags from there; motion inside 3 px of the press
//! is discarded once; Shift is 1/20 speed (1/10 for `turn`) and a Shift change moves the anchor;
//! past a limit the anchor moves by the overshoot; ⌘ snaps to `increment`.

use std::collections::BTreeMap;

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops;
use deep_canvas_motion::follow::{Follow, Model, Segment};
use serde_json::{json, Map, Value};

use crate::track::{Entry, Sample, Track, Writer};

const F: i64 = FLICKS_PER_SECOND;
/// Motion inside this many px of the press is discarded, once, at the start of a drag.
pub const THRESHOLD_PX: f64 = 3.0;

/// How a control kind takes input and what its value is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Behavior {
    /// A number dragged along an axis (slider): Shift is 1/20 speed.
    Number,
    /// A number turned (turn): Shift is 1/10 speed.
    Turn,
    /// A boolean flipped (toggle, transport).
    Toggle,
    /// One of its options (choice).
    Choice,
    /// One of its stages (stages).
    Stages,
    /// A fraction of a path's arc length (drag_along).
    Path,
    /// One entry per press (press).
    Press,
    /// Viewer state while the pointer is over its target (hover).
    Hover,
}

/// The core kinds `control@1` holds, each with its behavior.
pub const KINDS: [(&str, Behavior); 9] = [
    ("slider", Behavior::Number),
    ("toggle", Behavior::Toggle),
    ("choice", Behavior::Choice),
    ("stages", Behavior::Stages),
    ("transport", Behavior::Toggle),
    ("drag_along", Behavior::Path),
    ("turn", Behavior::Turn),
    ("press", Behavior::Press),
    ("hover", Behavior::Hover),
];

/// The planted programs the criteria name, each a wrong input module.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The slider reads the pointer's absolute place.
    pub slider_absolute: bool,
    /// A Shift change recomputes the value from the whole drag at the new speed.
    pub shift_recompute: bool,
    /// Past a limit the anchor stays.
    pub no_anchor_move: bool,
    /// Modifiers and stamps are read at the frame that handles the event.
    pub reads_modifiers: bool,
    /// A dragged entry is computed again from the pointer and the camera at replay.
    pub recompute: bool,
    /// A seek drops the entries after it.
    pub forks_on_scrub: bool,
    /// The parameter tool stamps its entry as yours.
    pub tool_stamps_you: bool,
    /// The tour doesn't yield to your gesture.
    pub tour_ignores_you: bool,
    /// A transition changing mid-way starts from its old target.
    pub smoothing_from_peak: bool,
    /// A control's value is looked up by scanning the track.
    pub scanning_lookup: bool,
    /// The kind has no keyboard path: keys do nothing.
    pub no_keyboard: bool,
    /// An agent's pointer input writes an entry.
    pub agent_input: bool,
}

impl Planted {
    /// A planted program by the name `deep-input input` takes.
    pub fn named(name: &str) -> Option<Planted> {
        let mut p = Planted::default();
        match name {
            "slider_absolute" => p.slider_absolute = true,
            "shift_recompute" => p.shift_recompute = true,
            "no_anchor_move" => p.no_anchor_move = true,
            "kind_reads_modifiers" => p.reads_modifiers = true,
            "drag_along_recompute" => p.recompute = true,
            "transport_forks_on_scrub" => p.forks_on_scrub = true,
            "tool_stamps_you" => p.tool_stamps_you = true,
            "tour_writes_during_drag" => p.tour_ignores_you = true,
            "smoothing_fall_from_peak" => p.smoothing_from_peak = true,
            "scanning_lookup" => p.scanning_lookup = true,
            _ => return None,
        }
        Some(p)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Class {
    Document,
    View,
}

#[derive(Clone, Debug)]
enum Along {
    /// Along x (0) or y (1), over `travel` u from the item's centre.
    Axis(usize, f64),
    Path(Vec<[f64; 2]>),
}

#[derive(Clone, Debug)]
struct Control {
    id: String,
    behavior: Behavior,
    class: Class,
    min: f64,
    max: f64,
    default: Value,
    increment: Option<f64>,
    options: Vec<String>,
    stages: Vec<(String, Vec<String>)>,
    keys: Map<String, Value>,
    handle: Option<(String, Along)>,
    targets: Vec<(String, String)>,
    smoothing: Option<Model>,
}

/// A box in u: x, y, w, h.
type Rect = [f64; 4];

fn contains(r: &Rect, p: [f64; 2]) -> bool {
    p[0] >= r[0] && p[0] <= r[0] + r[2] && p[1] >= r[1] && p[1] <= r[1] + r[3]
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

fn pair(v: Option<&Value>) -> Option<[f64; 2]> {
    let a = v?.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
}

/// A drag under way.
#[derive(Clone, Debug)]
struct Drag {
    control: usize,
    serial: u32,
    t0: i64,
    samples: Vec<Sample>,
    press_a: f64,
    v0: f64,
    anchor_a: f64,
    anchor_v: f64,
    speed: f64,
    shift: bool,
    past: bool,
    value: f64,
}

#[derive(Clone, Debug)]
enum Gesture {
    Drag(Drag),
    /// A press on a target, which picks on release over the same item.
    Pick {
        control: usize,
        option: String,
        item: String,
        serial: u32,
        t0: i64,
    },
}

#[derive(Clone, Debug)]
struct Tour {
    keys: Vec<(String, Vec<(i64, Value)>)>,
    idle_after: i64,
    resume_after: i64,
    period: i64,
}

/// What a follow channel built so far: its source's changes and its segments.
#[derive(Clone, Debug, Default)]
struct Channel {
    changes: Vec<(i64, f64)>,
    follow: Option<Follow>,
    solves: u64,
}

/// One session of the input module over a document.
pub struct Session {
    controls: Vec<Control>,
    items: BTreeMap<String, Rect>,
    channels: Map<String, Value>,
    target: [f64; 2],
    scale: f64,
    viewport: [f64; 2],
    frame: i64,
    reduced_motion: bool,
    pub planted: Planted,
    pub track: Track,
    pub playhead: i64,
    serial: u32,
    gesture: Option<Gesture>,
    /// A press held down on a key, until its release.
    held: bool,
    last_end: i64,
    interrupted: bool,
    frozen_origin: Option<i64>,
    tour: Option<Tour>,
    hover: BTreeMap<usize, (bool, Vec<(i64, f64)>)>,
    built: BTreeMap<String, Channel>,
}

/// A refusal: the code and what it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

fn refused(code: &'static str, path: impl Into<String>) -> Refused {
    Refused {
        code,
        path: path.into(),
    }
}

fn flicks(seconds: f64) -> i64 {
    // Whole flicks for the decimal seconds a document writes.
    let x = seconds * F as f64;
    let r = x as i64;
    if x - r as f64 >= 0.5 {
        r + 1
    } else {
        r
    }
}

impl Session {
    /// A session over `doc` in a view of `viewport` px played at `fps`, with the kinds `extra`
    /// beside the core's.
    pub fn new(
        doc: &Value,
        viewport: [f64; 2],
        fps: (u32, u32),
        reduced_motion: bool,
        planted: Planted,
        extra: &[(&str, Behavior)],
    ) -> Result<Session, Refused> {
        let items = items_of(doc);
        let (target, view_width) = camera_of(doc);
        let scale = view_width.map_or(1.0, |w| w / viewport[0]);
        let mut controls = Vec::new();
        if let Some(map) = doc.get("controls").and_then(Value::as_object) {
            for (id, c) in map {
                if let Some(c) = control_of(id, c, extra)? {
                    controls.push(c);
                }
            }
        }
        let tour = match doc.get("tour") {
            Some(t) => tour_of(t)?,
            None => None,
        };
        let frame = (i64::from(fps.1) * F) / i64::from(fps.0.max(1));
        Ok(Session {
            controls,
            items,
            channels: doc
                .get("channels")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default(),
            target,
            scale,
            viewport,
            frame: frame.max(1),
            reduced_motion,
            planted,
            track: Track::default(),
            playhead: 0,
            serial: 0,
            gesture: None,
            held: false,
            last_end: 0,
            interrupted: false,
            frozen_origin: None,
            tour,
            hover: BTreeMap::new(),
            built: BTreeMap::new(),
        })
    }

    fn index(&self, id: &str) -> Result<usize, Refused> {
        self.controls
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| refused("ref_unresolved", format!("controls/{id}")))
    }

    fn world(&self, px: [f64; 2]) -> [f64; 2] {
        [
            self.target[0] + (px[0] - self.viewport[0] / 2.0) * self.scale,
            self.target[1] + (px[1] - self.viewport[1] / 2.0) * self.scale,
        ]
    }

    /// The time a sample is stamped with: the event's own, or, in the planted program that reads
    /// at the frame, the frame that handles it.
    fn stamp(&self, t: i64) -> i64 {
        if self.planted.reads_modifiers {
            let k = (t + self.frame - 1).div_euclid(self.frame);
            k * self.frame
        } else {
            t
        }
    }

    /// Appends `f` copies' worth: `count` entries of yours for `control`, entry i at flick
    /// (i + 1) × 1000 with the value (i mod 1000) ÷ 1000.
    pub fn fill(&mut self, control: &str, count: usize) -> Result<(), Refused> {
        self.index(control)?;
        for i in 0..count {
            self.serial += 1;
            self.track.append(Entry {
                t: (i as i64 + 1) * 1000,
                seq: 0,
                control: control.into(),
                value: json!((i % 1000) as f64 / 1000.0),
                samples: None,
                writer: Writer::You,
                serial: Some(self.serial),
            });
        }
        Ok(())
    }

    // -------------------------------------------------------------------------------- values

    fn number(&self, c: &Control, v: &Value) -> f64 {
        v.as_f64().unwrap_or(c.min)
    }

    /// `c`'s value at the playhead as its entries give it, or its default.
    fn current(&self, i: usize) -> Value {
        let c = &self.controls[i];
        match self.track.last_at(&c.id, self.playhead) {
            Some(e) => e.value.clone(),
            None => c.default.clone(),
        }
    }

    /// The control's value at `t` as a driver reads it.
    fn read_value(&self, i: usize, t: i64, mode: &str) -> Value {
        let c = &self.controls[i];
        if c.class == Class::View {
            if mode != "live" {
                return c.default.clone();
            }
            return json!(self.hover_at(i, t));
        }
        let e = if self.planted.scanning_lookup {
            self.track.last_at_scanning(&c.id, t)
        } else {
            self.track.last_at(&c.id, t)
        };
        let mut v = e.map_or_else(|| c.default.clone(), |e| e.value.clone());
        if self.planted.recompute {
            let px = e.and_then(|e| e.samples.as_ref()?.last()?.px);
            if let Some(px) = px {
                let w = self.world(px);
                if let Some(x) = self.place(c, w) {
                    v = json!(x.0);
                }
            }
        }
        match c.behavior {
            Behavior::Choice => {
                let at = v
                    .as_str()
                    .and_then(|s| c.options.iter().position(|o| o == s));
                json!(at.map_or(-1, |k| k as i64))
            }
            _ => v,
        }
    }

    /// The value a pointer at `w` puts a handle at, absolutely, and its place on a path.
    fn place(&self, c: &Control, w: [f64; 2]) -> Option<(f64, Option<[f64; 2]>)> {
        let (item, along) = c.handle.as_ref()?;
        let r = self.items.get(item)?;
        let centre = [r[0] + r[2] / 2.0, r[1] + r[3] / 2.0];
        match along {
            Along::Axis(k, travel) => {
                let v = c.min + (w[*k] - centre[*k]) / travel * (c.max - c.min);
                Some((v.clamp(c.min, c.max), None))
            }
            Along::Path(points) => {
                let (f, p) = project(points, w);
                Some((c.min + f * (c.max - c.min), Some(p)))
            }
        }
    }

    /// The handle's box at value `v`.
    fn knob(&self, c: &Control, v: f64) -> Option<Rect> {
        let (item, along) = c.handle.as_ref()?;
        let r = *self.items.get(item)?;
        let f = if c.max > c.min {
            (v - c.min) / (c.max - c.min)
        } else {
            0.0
        };
        let centre = match along {
            Along::Axis(k, travel) => {
                let mut p = [r[0] + r[2] / 2.0, r[1] + r[3] / 2.0];
                p[*k] += travel * f;
                p
            }
            Along::Path(points) => point_at(points, f),
        };
        Some([centre[0] - r[2] / 2.0, centre[1] - r[3] / 2.0, r[2], r[3]])
    }

    fn hover_at(&self, i: usize, t: i64) -> f64 {
        let c = &self.controls[i];
        let start = c.default.as_f64().unwrap_or(c.min);
        let Some((_, changes)) = self.hover.get(&i) else {
            return start;
        };
        match c.smoothing {
            Some(model) => {
                Follow::with(model, start, changes, self.planted.smoothing_from_peak)
                    .at(t)
                    .value
            }
            None => changes
                .iter()
                .take_while(|(ct, _)| *ct <= t)
                .last()
                .map_or(start, |(_, v)| *v),
        }
    }

    // -------------------------------------------------------------------------------- the tour

    fn gesturing(&self) -> bool {
        self.gesture.is_some() || self.held
    }

    /// When the tour's clock starts: idle_after past your last gesture, or resume_after once a
    /// gesture interrupted it; none while you gesture.
    fn origin(&self) -> Option<i64> {
        let tour = self.tour.as_ref()?;
        if self.reduced_motion {
            return None;
        }
        if let Some(o) = self.frozen_origin {
            return Some(o);
        }
        if self.gesturing() {
            return None;
        }
        let wait = if self.interrupted {
            tour.resume_after
        } else {
            tour.idle_after
        };
        Some(self.last_end + wait)
    }

    /// A gesture of yours starts at `t`: a tour under way yields to it.
    fn begin(&mut self, t: i64) {
        if self.frozen_origin.is_some() {
            return;
        }
        if self.origin().is_some_and(|o| o <= t) {
            self.interrupted = true;
        }
    }

    fn end(&mut self, t: i64) {
        self.last_end = t;
    }

    /// Plays the playhead to `t`, the tour writing its keys on the way: up to `t` itself, or
    /// short of it when a gesture of yours starts there. Returns frames, work and entries.
    fn advance(&mut self, t: i64, inclusive: bool) -> (i64, u64, usize) {
        if t <= self.playhead {
            self.playhead = t;
            return (0, 0, 0);
        }
        let p0 = self.playhead;
        let frames = t.div_euclid(self.frame) - p0.div_euclid(self.frame);
        let mut appended = 0;
        if let (Some(origin), Some(tour)) = (self.origin(), self.tour.clone()) {
            let mut due: Vec<(i64, usize, Value)> = Vec::new();
            let looping = tour.period > 0;
            let first = if looping {
                ((p0 - origin) / tour.period - 1).max(0)
            } else {
                0
            };
            let mut k = first;
            loop {
                let base = origin + k * tour.period;
                if base > t {
                    break;
                }
                for (ci, (_, keys)) in tour.keys.iter().enumerate() {
                    for (kt, v) in keys {
                        if looping && *kt >= tour.period {
                            continue;
                        }
                        let at = base + kt;
                        if at > p0 && (at < t || (inclusive && at == t)) {
                            due.push((at, ci, v.clone()));
                        }
                    }
                }
                if !looping {
                    break;
                }
                k += 1;
            }
            due.sort_by_key(|a| (a.0, a.1));
            for (at, ci, value) in due {
                if self.track.last_t().is_some_and(|last| at < last) {
                    continue;
                }
                if self.planted.tour_ignores_you && self.frozen_origin.is_none() {
                    self.frozen_origin = Some(origin);
                }
                self.track.append(Entry {
                    t: at,
                    seq: 0,
                    control: tour.keys[ci].0.clone(),
                    value,
                    samples: None,
                    writer: Writer::Tour,
                    serial: None,
                });
                appended += 1;
            }
        }
        self.playhead = t;
        (frames, appended as u64, appended)
    }

    // -------------------------------------------------------------------------------- entries

    fn append(&mut self, e: Entry) -> usize {
        self.track.append(e)
    }

    fn yours(
        &mut self,
        control: usize,
        t: i64,
        value: Value,
        samples: Option<Vec<Sample>>,
        serial: u32,
    ) -> usize {
        let id = self.controls[control].id.clone();
        self.append(Entry {
            t,
            seq: 0,
            control: id,
            value,
            samples,
            writer: Writer::You,
            serial: Some(serial),
        })
    }

    fn next_serial(&mut self) -> u32 {
        self.serial += 1;
        self.serial
    }

    // -------------------------------------------------------------------------------- ops

    /// One op of `deep-input input` but `lookup`; its result.
    pub fn op(&mut self, op: &Map<String, Value>) -> Result<Value, Refused> {
        let kind = op.get("op").and_then(Value::as_str).unwrap_or("");
        let t = op.get("t").and_then(Value::as_i64);
        let need_t = || t.ok_or_else(|| refused("bad_input", "t"));
        match kind {
            "pointer" => {
                let phase = op.get("phase").and_then(Value::as_str).unwrap_or("");
                let at = pair(op.get("at")).ok_or_else(|| refused("bad_input", "at"))?;
                let mods = mods_of(op.get("mods"));
                self.pointer(phase, at, need_t()?, mods)
            }
            "key" => {
                let control = op.get("control").and_then(Value::as_str).unwrap_or("");
                let key = op.get("key").and_then(Value::as_str).unwrap_or("");
                let phase = op.get("phase").and_then(Value::as_str).unwrap_or("down");
                let repeat = op.get("repeat").and_then(Value::as_bool).unwrap_or(false);
                let mods = mods_of(op.get("mods"));
                self.key(control, key, phase, repeat, mods, need_t()?)
            }
            "control" | "tool" => {
                let control = op.get("control").and_then(Value::as_str).unwrap_or("");
                let value = op.get("value").cloned().unwrap_or(Value::Null);
                if kind == "control" {
                    self.set(control, value, need_t()?)
                } else {
                    self.tool(control, value, need_t()?)
                }
            }
            "seek" => {
                let t = need_t()?;
                let dropped = if self.planted.forks_on_scrub {
                    self.track.cut_after(t)
                } else {
                    0
                };
                self.playhead = t;
                Ok(json!({"dropped": dropped}))
            }
            "advance" => {
                let (frames, work, appended) = self.advance(need_t()?, true);
                Ok(json!({"frames": frames, "input_work": work, "appended": appended}))
            }
            "drag" => {
                if let Some(t) = t {
                    self.advance(t, true);
                }
                let d = pair(op.get("delta")).ok_or_else(|| refused("bad_input", "delta"))?;
                self.target[0] -= d[0] * self.scale;
                self.target[1] -= d[1] * self.scale;
                Ok(json!({}))
            }
            "read" => {
                let t = need_t()?;
                if t > self.playhead {
                    self.advance(t, true);
                }
                if let Some(ch) = op.get("channel").and_then(Value::as_str) {
                    return self.read_channel(ch, t);
                }
                let control = op.get("control").and_then(Value::as_str).unwrap_or("");
                let i = self.index(control)?;
                let mode = op.get("mode").and_then(Value::as_str).unwrap_or("live");
                Ok(
                    json!({"value": self.read_value(i, t, mode), "count": self.track.count_at(control, t)}),
                )
            }
            _ => Err(refused("bad_input", "op")),
        }
    }

    /// `control`'s value at `t` as the budget probe looks it up.
    pub fn lookup(&self, control: &str, t: i64) -> Value {
        let e = if self.planted.scanning_lookup {
            self.track.last_at_scanning(control, t)
        } else {
            self.track.last_at(control, t)
        };
        match e {
            Some(e) => e.value.clone(),
            None => self
                .index(control)
                .map_or(Value::Null, |i| self.controls[i].default.clone()),
        }
    }

    fn pointer(&mut self, phase: &str, px: [f64; 2], t: i64, mods: Mods) -> Result<Value, Refused> {
        let w = self.world(px);
        match phase {
            "down" => {
                self.advance(t, false);
                if self.gesture.is_some() {
                    return Ok(json!({"appended": 0, "dropped": 0}));
                }
                let Some(g) = self.press(w, px, t, mods)? else {
                    return Ok(json!({"appended": 0, "dropped": 0}));
                };
                let value = match &g {
                    Gesture::Drag(d) => Some(json!(d.value)),
                    Gesture::Pick { .. } => None,
                };
                self.begin(t);
                self.gesture = Some(g);
                let mut out = json!({"appended": 0, "dropped": 0});
                if let Some(v) = value {
                    out["value"] = v;
                }
                Ok(out)
            }
            "move" | "up" => {
                self.advance(t, true);
                let up = phase == "up";
                match self.gesture.take() {
                    Some(Gesture::Drag(mut d)) => {
                        let c = self.controls[d.control].clone();
                        let (v, at) = self.drag_to(&c, &mut d, w, mods);
                        d.samples.push(Sample {
                            t: self.stamp(t),
                            value: json!(v),
                            at,
                            px: self.planted.recompute.then_some(px),
                        });
                        if !up {
                            self.gesture = Some(Gesture::Drag(d));
                            return Ok(json!({"value": v, "appended": 0, "dropped": 0}));
                        }
                        let dropped =
                            self.yours(d.control, d.t0, json!(v), Some(d.samples), d.serial);
                        self.end(t);
                        Ok(json!({"value": v, "appended": 1, "dropped": dropped}))
                    }
                    Some(Gesture::Pick {
                        control,
                        option,
                        item,
                        serial,
                        t0,
                    }) => {
                        if !up {
                            self.gesture = Some(Gesture::Pick {
                                control,
                                option,
                                item,
                                serial,
                                t0,
                            });
                            return Ok(json!({"appended": 0, "dropped": 0}));
                        }
                        self.end(t);
                        let over = self.items.get(&item).is_some_and(|r| contains(r, w));
                        if !over {
                            return Ok(json!({"appended": 0, "dropped": 0}));
                        }
                        let value = self.picked(control, &option);
                        let dropped = self.yours(control, t0, value.clone(), None, serial);
                        Ok(json!({"value": value, "appended": 1, "dropped": dropped}))
                    }
                    None => Ok(self.hover_move(w, t)),
                }
            }
            _ => Err(refused("bad_input", "phase")),
        }
    }

    /// What a press at `w` grabs: a handle, the track under it, or a target to pick.
    fn press(
        &mut self,
        w: [f64; 2],
        px: [f64; 2],
        t: i64,
        mods: Mods,
    ) -> Result<Option<Gesture>, Refused> {
        for i in 0..self.controls.len() {
            let c = self.controls[i].clone();
            if c.class != Class::Document {
                continue;
            }
            match c.behavior {
                Behavior::Number | Behavior::Turn | Behavior::Path => {
                    let v = self.number(&c, &self.current(i));
                    let Some(knob) = self.knob(&c, v) else {
                        continue;
                    };
                    let on_knob = contains(&knob, w);
                    let on_track = !on_knob && self.on_track(&c, w);
                    if !on_knob && !on_track {
                        continue;
                    }
                    let a = self.along(&c, w);
                    let speed = if mods.shift { fine(c.behavior) } else { 1.0 };
                    let mut d = Drag {
                        control: i,
                        serial: self.next_serial(),
                        t0: t,
                        samples: Vec::new(),
                        press_a: a,
                        v0: v,
                        anchor_a: a,
                        anchor_v: v,
                        speed,
                        shift: mods.shift,
                        past: false,
                        value: v,
                    };
                    let mut at = None;
                    if c.behavior == Behavior::Path || on_track || self.planted.slider_absolute {
                        if let Some((pv, p)) = self.place(&c, w) {
                            d.value = pv;
                            d.v0 = pv;
                            d.anchor_v = pv;
                            d.past = true;
                            at = p;
                        }
                    }
                    if c.behavior == Behavior::Path && at.is_none() {
                        at = self
                            .knob(&c, d.value)
                            .map(|r| [r[0] + r[2] / 2.0, r[1] + r[3] / 2.0]);
                    }
                    d.samples.push(Sample {
                        t: self.stamp(t),
                        value: json!(d.value),
                        at,
                        px: self.planted.recompute.then_some(px),
                    });
                    return Ok(Some(Gesture::Drag(d)));
                }
                Behavior::Choice | Behavior::Toggle | Behavior::Press | Behavior::Stages => {
                    for (option, item) in &c.targets {
                        if self.items.get(item).is_some_and(|r| contains(r, w)) {
                            return Ok(Some(Gesture::Pick {
                                control: i,
                                option: option.clone(),
                                item: item.clone(),
                                serial: self.next_serial(),
                                t0: t,
                            }));
                        }
                    }
                }
                Behavior::Hover => {}
            }
        }
        Ok(None)
    }

    /// The value a pick of `option` on control `i` writes.
    fn picked(&self, i: usize, option: &str) -> Value {
        let c = &self.controls[i];
        match c.behavior {
            Behavior::Toggle => json!(!self.current(i).as_bool().unwrap_or(false)),
            Behavior::Press => c.keys.values().next().cloned().unwrap_or(json!(1)),
            _ => json!(option),
        }
    }

    fn along(&self, c: &Control, w: [f64; 2]) -> f64 {
        match &c.handle {
            Some((_, Along::Axis(k, _))) => w[*k],
            _ => w[0],
        }
    }

    fn on_track(&self, c: &Control, w: [f64; 2]) -> bool {
        let Some((item, along)) = &c.handle else {
            return false;
        };
        let Some(r) = self.items.get(item) else {
            return false;
        };
        match along {
            Along::Axis(k, travel) => {
                let j = 1 - k;
                let centre = [r[0] + r[2] / 2.0, r[1] + r[3] / 2.0];
                let half = [r[2] / 2.0, r[3] / 2.0];
                w[*k] >= centre[*k] - half[*k]
                    && w[*k] <= centre[*k] + travel + half[*k]
                    && (w[j] - centre[j]).abs() <= half[j]
            }
            Along::Path(points) => {
                let (_, p) = project(points, w);
                ops::hypot(p[0] - w[0], p[1] - w[1]) <= r[2].max(r[3]) / 2.0
            }
        }
    }

    /// The drag grammar: the value a drag reaches at `w`.
    fn drag_to(
        &self,
        c: &Control,
        d: &mut Drag,
        w: [f64; 2],
        mods: Mods,
    ) -> (f64, Option<[f64; 2]>) {
        if c.behavior == Behavior::Path {
            let (v, p) = self.place(c, w).unwrap_or((d.value, None));
            d.value = v;
            return (v, p);
        }
        let travel = match &c.handle {
            Some((_, Along::Axis(_, travel))) => *travel,
            _ => 1.0,
        };
        let per = (c.max - c.min) / travel;
        let a = self.along(c, w);
        if self.planted.slider_absolute {
            let v = self.place(c, w).map_or(d.value, |x| x.0);
            d.value = v;
            return (v, None);
        }
        if mods.shift != d.shift {
            d.shift = mods.shift;
            d.speed = if mods.shift { fine(c.behavior) } else { 1.0 };
            if self.planted.shift_recompute {
                let s = if a >= d.press_a { 1.0 } else { -1.0 };
                d.anchor_a = d.press_a + THRESHOLD_PX * s;
                d.anchor_v = d.v0;
            } else {
                d.anchor_a = a;
                d.anchor_v = d.value;
            }
            d.past = true;
        }
        if !d.past {
            let moved = a - d.press_a;
            if moved.abs() <= THRESHOLD_PX {
                return (d.value, None);
            }
            d.past = true;
            d.anchor_a = d.press_a + THRESHOLD_PX * if moved > 0.0 { 1.0 } else { -1.0 };
            d.anchor_v = d.v0;
        }
        let raw = d.anchor_v + (a - d.anchor_a) * d.speed * per;
        let mut v = raw.clamp(c.min, c.max);
        if raw != v && !self.planted.no_anchor_move {
            d.anchor_a = a;
            d.anchor_v = v;
        }
        if mods.cmd {
            if let Some(inc) = c.increment.filter(|i| *i > 0.0) {
                let steps = (v - c.min) / inc;
                let r = if steps - steps.floor() >= 0.5 {
                    steps.floor() + 1.0
                } else {
                    steps.floor()
                };
                v = (c.min + r * inc).clamp(c.min, c.max);
            }
        }
        d.value = v;
        (v, None)
    }

    fn hover_move(&mut self, w: [f64; 2], t: i64) -> Value {
        let mut out = json!({"appended": 0, "dropped": 0});
        for i in 0..self.controls.len() {
            let c = &self.controls[i];
            if c.behavior != Behavior::Hover {
                continue;
            }
            let over = c
                .targets
                .iter()
                .any(|(_, item)| self.items.get(item).is_some_and(|r| contains(r, w)));
            let (lo, hi) = (c.min, c.max);
            let state = self.hover.entry(i).or_insert((false, Vec::new()));
            if state.0 != over {
                state.0 = over;
                state.1.push((t, if over { hi } else { lo }));
            }
            if over {
                out["value"] = json!(hi);
            }
        }
        out
    }

    fn key(
        &mut self,
        control: &str,
        key: &str,
        phase: &str,
        repeat: bool,
        mods: Mods,
        t: i64,
    ) -> Result<Value, Refused> {
        let i = self.index(control)?;
        let c = self.controls[i].clone();
        let press_down = phase == "down" && !repeat;
        if c.behavior == Behavior::Press && press_down {
            self.advance(t, false);
        } else {
            self.advance(t, true);
        }
        let none = |s: &Self| json!({"value": s.current(i), "appended": 0, "dropped": 0});
        if phase == "up" {
            if self.held {
                self.held = false;
                self.end(t);
            }
            return Ok(none(self));
        }
        if self.planted.no_keyboard {
            return Ok(none(self));
        }
        let value = match c.behavior {
            Behavior::Press => {
                if repeat {
                    self.end(t);
                    return Ok(none(self));
                }
                let bound = c.keys.get(key).cloned();
                let default_key = c.keys.is_empty() && (key == "Enter" || key == " ");
                if bound.is_none() && !default_key {
                    return Ok(none(self));
                }
                self.begin(t);
                self.held = true;
                bound.unwrap_or(json!(1))
            }
            Behavior::Hover => {
                let target = if key == "Escape" { c.min } else { c.max };
                let state = self.hover.entry(i).or_insert((false, Vec::new()));
                state.0 = key != "Escape";
                state.1.push((t, target));
                return Ok(json!({"value": target, "appended": 0, "dropped": 0}));
            }
            _ => {
                let Some(v) = self.keyed(i, key, mods) else {
                    return Ok(none(self));
                };
                self.begin(t);
                self.end(t);
                v
            }
        };
        let serial = self.next_serial();
        let dropped = self.yours(i, t, value.clone(), None, serial);
        Ok(json!({"value": value, "appended": 1, "dropped": dropped}))
    }

    /// The controls that take `key` with `mods` held, in the document's order (#501: the film
    /// viewer's keymap check names them). A hover control reads every key and is not listed.
    pub fn holders(&self, key: &str, mods: &[&str]) -> Vec<String> {
        let mods = Mods {
            shift: mods.contains(&"shift"),
            cmd: mods.contains(&"cmd"),
        };
        // A press with no keys of its own takes Enter and Space, as `key` reads it.
        let press = |c: &Control| {
            c.behavior == Behavior::Press && c.keys.is_empty() && (key == "Enter" || key == " ")
        };
        let takes = |(i, c): &(usize, &Control)| press(c) || self.keyed(*i, key, mods).is_some();
        self.controls
            .iter()
            .enumerate()
            .filter(takes)
            .map(|(_, c)| c.id.clone())
            .collect()
    }

    /// The value key `key` gives control `i`: its own `keys` first, then the default keys.
    fn keyed(&self, i: usize, key: &str, mods: Mods) -> Option<Value> {
        let c = &self.controls[i];
        let now = self.current(i);
        if let Some(bound) = c.keys.get(key) {
            return Some(match bound {
                Value::String(s) if s == "toggle" => json!(!now.as_bool().unwrap_or(false)),
                Value::Object(o) if o.contains_key("delta") => {
                    let d = num(o.get("delta")).unwrap_or(0.0);
                    json!((self.number(c, &now) + d).clamp(c.min, c.max))
                }
                v => v.clone(),
            });
        }
        let step = |dir: i64| -> Option<usize> {
            let n = match c.behavior {
                Behavior::Choice => c.options.len(),
                _ => c.stages.len(),
            };
            if n == 0 {
                return None;
            }
            let at = now.as_str().and_then(|s| match c.behavior {
                Behavior::Choice => c.options.iter().position(|o| o == s),
                _ => c.stages.iter().position(|(id, _)| id == s),
            });
            Some(match at {
                None => 0,
                Some(k) => (k as i64 + dir).clamp(0, n as i64 - 1) as usize,
            })
        };
        let dir = match key {
            "ArrowRight" | "ArrowUp" => 1,
            "ArrowLeft" | "ArrowDown" => -1,
            _ => 0,
        };
        match c.behavior {
            Behavior::Number | Behavior::Turn | Behavior::Path => {
                let v = self.number(c, &now);
                let range = c.max - c.min;
                let inc = c.increment.unwrap_or(range / 100.0);
                let next = match key {
                    "ArrowRight" | "ArrowUp" | "ArrowLeft" | "ArrowDown" => {
                        let d = if mods.shift { inc / 10.0 } else { inc };
                        v + d * dir as f64
                    }
                    "PageUp" => v + inc.max(range / 10.0),
                    "PageDown" => v - inc.max(range / 10.0),
                    "Home" => c.min,
                    "End" => c.max,
                    _ => return None,
                };
                Some(json!(next.clamp(c.min, c.max)))
            }
            Behavior::Toggle => {
                (key == " " || key == "Enter").then(|| json!(!now.as_bool().unwrap_or(false)))
            }
            Behavior::Choice => (dir != 0)
                .then(|| step(dir))
                .flatten()
                .map(|k| json!(c.options[k])),
            Behavior::Stages => {
                if let Some((id, _)) = c
                    .stages
                    .iter()
                    .find(|(_, keys)| keys.iter().any(|k| k == key))
                {
                    return Some(json!(id));
                }
                (dir != 0)
                    .then(|| step(dir))
                    .flatten()
                    .map(|k| json!(c.stages[k].0))
            }
            Behavior::Press | Behavior::Hover => None,
        }
    }

    /// A programmatic entry of yours: a whole gesture, with its serial.
    fn set(&mut self, control: &str, value: Value, t: i64) -> Result<Value, Refused> {
        let i = self.index(control)?;
        self.advance(t, false);
        if self.controls[i].class == Class::View {
            return Ok(json!({"appended": 0, "dropped": 0}));
        }
        self.begin(t);
        self.end(t);
        let serial = self.next_serial();
        let dropped = self.yours(i, t, value, None, serial);
        Ok(json!({"appended": 1, "dropped": dropped}))
    }

    /// The parameter tool: one entry stamped as the agent, with no serial, on a figure's
    /// parameter; it can't answer a choice or a stage, and it can't move view state.
    fn tool(&mut self, control: &str, value: Value, t: i64) -> Result<Value, Refused> {
        let i = self.index(control)?;
        self.advance(t, true);
        let c = &self.controls[i];
        let parameter = matches!(
            c.behavior,
            Behavior::Number | Behavior::Turn | Behavior::Path | Behavior::Toggle
        );
        if c.class != Class::Document || !parameter {
            return Ok(json!({"appended": 0, "dropped": 0, "refused": "not_a_parameter"}));
        }
        let id = c.id.clone();
        let (writer, serial) = if self.planted.tool_stamps_you {
            (Writer::You, Some(self.next_serial()))
        } else {
            (Writer::Agent, None)
        };
        let dropped = self.append(Entry {
            t,
            seq: 0,
            control: id,
            value,
            samples: None,
            writer,
            serial,
        });
        Ok(json!({"appended": 1, "dropped": dropped}))
    }

    /// An agent's pointer press and release at `px` on control `control`: never an entry, since
    /// no entry lands without your gesture but the parameter tool's.
    pub fn agent_pointer(&mut self, control: &str, px: [f64; 2], t: i64) -> Result<usize, Refused> {
        let i = self.index(control)?;
        if !self.planted.agent_input {
            return Ok(0);
        }
        let c = self.controls[i].clone();
        let v = self
            .place(&c, self.world(px))
            .map_or_else(|| self.current(i), |x| json!(x.0));
        self.append(Entry {
            t,
            seq: 0,
            control: c.id,
            value: v,
            samples: None,
            writer: Writer::Agent,
            serial: None,
        });
        Ok(1)
    }

    fn read_channel(&mut self, id: &str, t: i64) -> Result<Value, Refused> {
        let path = format!("channels/{id}");
        let ch = self
            .channels
            .get(id)
            .ok_or_else(|| refused("ref_unresolved", path.clone()))?;
        let f = ch
            .get("follow")
            .and_then(Value::as_object)
            .ok_or_else(|| refused("bad_doc", path.clone()))?;
        let spec = deep_canvas_motion::doc::follow_spec(f, &format!("{path}/follow"))
            .map_err(|r| refused(r.code, r.path))?;
        let deep_canvas_motion::follow::Source::Control(control) = &spec.source else {
            return Err(refused("bad_doc", format!("{path}/follow/source")));
        };
        let i = self.index(control)?;
        let c = &self.controls[i];
        let initial = c.default.as_f64().unwrap_or(c.min);
        let changes: Vec<(i64, f64)> = self
            .track
            .of(control)
            .map(|e| (e.t, e.value.as_f64().unwrap_or(initial)))
            .collect();
        let built = self.built.entry(id.to_string()).or_default();
        if built.follow.is_none() || built.changes != changes {
            // Only the segments from the first change that differs are solved again.
            let same = built
                .changes
                .iter()
                .zip(&changes)
                .take_while(|(a, b)| a == b)
                .count();
            let mut follow = match &built.follow {
                Some(f) if f.model == spec.model => Follow {
                    model: f.model,
                    segments: f.segments[..=same].to_vec(),
                },
                _ => Follow::new(spec.model, initial, &[]),
            };
            let from = follow.segments.len() - 1;
            for &(ct, target) in &changes[from..] {
                let start = follow.at(ct);
                follow.segments.push(Segment {
                    t: ct,
                    target,
                    start,
                });
                built.solves += 1;
            }
            built.follow = Some(follow);
            built.changes = changes;
        }
        let f = built
            .follow
            .as_ref()
            .map(|f| f.at(t).value)
            .unwrap_or(initial);
        let segments = built.follow.as_ref().map_or(0, |f| f.segments.len() - 1);
        Ok(json!({"value": f, "solves": built.solves, "segments": segments}))
    }
}

fn fine(b: Behavior) -> f64 {
    if b == Behavior::Turn {
        0.1
    } else {
        0.05
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Mods {
    shift: bool,
    cmd: bool,
}

fn mods_of(v: Option<&Value>) -> Mods {
    let has = |m: &str| {
        v.and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(m)))
    };
    Mods {
        shift: has("shift"),
        cmd: has("cmd"),
    }
}

fn items_of(doc: &Value) -> BTreeMap<String, Rect> {
    let mut out = BTreeMap::new();
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return out;
    };
    for (id, item) in items {
        let pos = pair(item.get("at").and_then(|a| a.get("pos"))).unwrap_or([0.0, 0.0]);
        let params = item.get("params");
        let size = |k: &str| num(params.and_then(|p| p.get(k)));
        let rect = match (size("w"), size("h")) {
            (Some(w), Some(h)) => Some([pos[0], pos[1], w, h]),
            _ => params
                .and_then(|p| p.get("box"))
                .and_then(Value::as_array)
                .and_then(|b| {
                    let n: Vec<f64> = b.iter().filter_map(Value::as_f64).collect();
                    (n.len() == 4).then(|| [pos[0] + n[0], pos[1] + n[1], n[2], n[3]])
                }),
        };
        if let Some(r) = rect {
            out.insert(id.clone(), r);
        }
    }
    out
}

/// The document's camera: its 2D target and view width.
fn camera_of(doc: &Value) -> ([f64; 2], Option<f64>) {
    let item = doc
        .get("camera")
        .and_then(Value::as_str)
        .and_then(|id| doc.get("items")?.get(id));
    let params = item.and_then(|i| i.get("params"));
    let target = pair(params.and_then(|p| p.get("target")));
    let width = num(params.and_then(|p| p.get("view_width")));
    match (target, doc.get("size")) {
        (Some(t), _) => (t, width),
        (None, size) => {
            let s = pair(size).unwrap_or([0.0, 0.0]);
            (
                [s[0] / 2.0, s[1] / 2.0],
                width.or(Some(s[0]).filter(|w| *w > 0.0)),
            )
        }
    }
}

fn control_of(id: &str, c: &Value, extra: &[(&str, Behavior)]) -> Result<Option<Control>, Refused> {
    let Some(kind) = c.get("kind").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(behavior) = KINDS
        .iter()
        .chain(extra.iter())
        .find(|(n, _)| *n == kind)
        .map(|(_, b)| *b)
    else {
        return Err(refused("out_of_range", format!("controls/{id}/kind")));
    };
    let class = match c.get("class").and_then(Value::as_str) {
        Some("view") | Some("viewer") => Class::View,
        Some(_) => Class::Document,
        None if behavior == Behavior::Hover => Class::View,
        None => Class::Document,
    };
    let range = c.get("range").and_then(Value::as_array);
    let r = |k: usize, d: f64| {
        range
            .and_then(|a| a.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(d)
    };
    let top = if behavior == Behavior::Turn {
        360.0
    } else {
        1.0
    };
    let (min, max) = (r(0, 0.0), r(1, top));
    // A value is clamped into the range, which panics on a range that runs high to low.
    if min > max {
        return Err(refused("out_of_range", format!("controls/{id}/range")));
    }
    let options: Vec<String> = c
        .get("options")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|o| o.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let stages: Vec<(String, Vec<String>)> = c
        .get("stages")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(sid, s)| {
                    let keys = s
                        .get("keys")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter_map(|k| k.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    (sid.clone(), keys)
                })
                .collect()
        })
        .unwrap_or_default();
    let default = match c.get("default") {
        Some(d) => d.clone(),
        None => match behavior {
            Behavior::Number | Behavior::Turn | Behavior::Path | Behavior::Hover => json!(min),
            Behavior::Toggle => json!(false),
            Behavior::Stages => stages.first().map_or(Value::Null, |s| json!(s.0)),
            _ => Value::Null,
        },
    };
    let handle = match c.get("handle") {
        Some(h) => {
            let item = h
                .get("item")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let along = match h.get("along") {
                Some(Value::String(a)) => {
                    let travel = num(h.get("travel")).unwrap_or(100.0);
                    Along::Axis(if a == "y" { 1 } else { 0 }, travel)
                }
                Some(Value::Object(o)) => {
                    let points: Vec<[f64; 2]> = o
                        .get("polyline")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|p| pair(Some(p))).collect())
                        .unwrap_or_default();
                    if points.len() < 2 {
                        return Err(refused(
                            "out_of_range",
                            format!("controls/{id}/handle/along"),
                        ));
                    }
                    Along::Path(points)
                }
                _ => {
                    return Err(refused(
                        "out_of_range",
                        format!("controls/{id}/handle/along"),
                    ))
                }
            };
            Some((item, along))
        }
        None => None,
    };
    let targets = c
        .get("targets")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let smoothing = match c.get("smoothing") {
        Some(Value::Object(o)) => match o.get("follow") {
            Some(model) => {
                let mut f = Map::new();
                f.insert("source".into(), json!(format!("controls/{id}/value")));
                f.insert("model".into(), model.clone());
                let spec = deep_canvas_motion::doc::follow_spec(
                    &f,
                    &format!("controls/{id}/smoothing/follow"),
                )
                .map_err(|r| refused(r.code, r.path))?;
                Some(spec.model)
            }
            None => None,
        },
        _ => None,
    };
    Ok(Some(Control {
        id: id.into(),
        behavior,
        class,
        min,
        max,
        default,
        increment: num(c.get("increment")),
        options,
        stages,
        keys: c
            .get("keys")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        handle,
        targets,
        smoothing,
    }))
}

fn tour_of(t: &Value) -> Result<Option<Tour>, Refused> {
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
            ks.push((at, a.get(1).cloned().unwrap_or(Value::Null)));
        }
        out.push((control.clone(), ks));
    }
    let secs = |k: &str, d: f64| num(t.get(k)).unwrap_or(d);
    let looping = t.get("loop").and_then(Value::as_bool).unwrap_or(true);
    Ok(Some(Tour {
        keys: out,
        idle_after: flicks(secs("idle_after", 1.4)),
        resume_after: flicks(secs("resume_after", 3.6)),
        period: if looping { last } else { 0 },
    }))
}

/// The point at fraction `f` of a polyline's arc length.
fn point_at(points: &[[f64; 2]], f: f64) -> [f64; 2] {
    let total: f64 = points
        .windows(2)
        .map(|w| ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]))
        .sum();
    let mut d = f.clamp(0.0, 1.0) * total;
    for w in points.windows(2) {
        let len = ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]);
        if d <= len && len > 0.0 {
            let u = d / len;
            return [
                w[0][0] + (w[1][0] - w[0][0]) * u,
                w[0][1] + (w[1][1] - w[0][1]) * u,
            ];
        }
        d -= len;
    }
    points[points.len() - 1]
}

/// The nearest point of a polyline to `p`: its fraction of the arc length, and the point.
fn project(points: &[[f64; 2]], p: [f64; 2]) -> (f64, [f64; 2]) {
    let total: f64 = points
        .windows(2)
        .map(|w| ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]))
        .sum();
    let mut best = (f64::INFINITY, 0.0, points[0]);
    let mut run = 0.0;
    for w in points.windows(2) {
        let (dx, dy) = (w[1][0] - w[0][0], w[1][1] - w[0][1]);
        let len2 = dx * dx + dy * dy;
        let u = if len2 > 0.0 {
            (((p[0] - w[0][0]) * dx + (p[1] - w[0][1]) * dy) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let q = [w[0][0] + dx * u, w[0][1] + dy * u];
        let d = ops::hypot(p[0] - q[0], p[1] - q[1]);
        let len = ops::sqrt(len2);
        if d < best.0 {
            best = (d, run + u * len, q);
        }
        run += len;
    }
    let f = if total > 0.0 { best.1 / total } else { 0.0 };
    (f, best.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_range_written_high_to_low_is_refused() {
        let doc = json!({"controls": {"gain": {"kind": "slider", "range": [1, 0]}}});
        let key = json!({"op": "key", "control": "gain", "key": "ArrowRight", "t": 0});
        let refusal = Session::new(
            &doc,
            [640.0, 360.0],
            (60, 1),
            false,
            Planted::default(),
            &[],
        )
        .and_then(|mut s| s.op(key.as_object().expect("an op")))
        .err();
        assert_eq!(
            refusal,
            Some(refused("out_of_range", "controls/gain/range"))
        );
    }

    #[test]
    fn holders_names_the_controls_a_key_reaches_and_no_other() {
        let doc = json!({"controls": {
            "speed": {"kind": "slider"},
            "sound": {"kind": "toggle", "keys": {"m": "toggle"}},
            "go": {"kind": "press"},
        }});
        let s = Session::new(
            &doc,
            [640.0, 360.0],
            (60, 1),
            false,
            Planted::default(),
            &[],
        )
        .unwrap();
        assert_eq!(s.holders("m", &[]), ["sound"]);
        assert_eq!(s.holders("ArrowRight", &["alt"]), ["speed"]);
        assert_eq!(s.holders(" ", &[]), ["sound", "go"]);
        assert_eq!(s.holders("j", &[]), [] as [&str; 0]);
    }
}
