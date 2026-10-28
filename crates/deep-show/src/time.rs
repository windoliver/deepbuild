//! Issue #488's calls on the canvas time core (the #488 acceptance README: The surface under
//! test): `rate`, the valid-rates rule and the integer conversions for one rate; `time`, a
//! literal resolved against a document's rate and markers, which `eval`'s `t` shares; `export`,
//! the rule applied where an export's rates are set; `play`, the live transport on a virtual
//! display, drawing only when the frame clock arms a frame; and `determinism`, seeking against
//! playing on canonical renders, each side on its own scheduler and session.

use std::collections::BTreeSet;

use deep_canvas::document::frame_rate_of;
use deep_canvas::grammar::{Seeded, Time, TimeContext, FLICKS_PER_SECOND};
use deep_canvas::schedule::{default_view, Scheduler, Session as DocSession, Val};
use deep_canvas::time::{self as clock, Rate, CHECKPOINT_EVERY};
use deep_canvas_motion::doc::{read as read_motion, Motion};
use serde_json::{json, Map, Value};

use crate::hub::{Call, EvalTime, Hub, Planted};

/// A `rate` call: the rule for one rate, with no document.
pub struct RateCall {
    pub rate: Rate,
    pub t: Option<i64>,
    pub k: Option<i64>,
    /// The rule for a source (a sound at that rate): resampled when invalid, never refused.
    pub source: bool,
}

/// An `export` call: a plan at explicit rates, or the document's.
pub struct Export {
    pub doc: String,
    pub frame_rate: Option<(u32, u32)>,
    pub sample_rate: Option<u32>,
}

/// Which path `determinism`'s play side runs: the live transport's warm path, or a cold
/// evaluation at t alone (the comparison the design calls INVALID; never proof).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayPath {
    Warm,
    Cold,
}

/// A `determinism` call.
pub struct Determinism {
    pub doc: String,
    pub display_hz: u32,
    pub play: PlayPath,
    pub at_times: Option<Vec<i64>>,
}

/// One of this issue's calls, parsed; `None` is `bad_input`.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<Call> {
    let doc = || Some(c.get("doc")?.as_str()?.to_string());
    let whole = |v: &Value| u32::try_from(v.as_u64()?).ok();
    let pair = |v: &Value| -> Option<(u32, u32)> {
        let a = v.as_array().filter(|a| a.len() == 2)?;
        Some((whole(&a[0])?, whole(&a[1])?))
    };
    match name {
        "rate" => {
            let rate = match (c.get("frame_rate"), c.get("sample_rate")) {
                (Some(f), None) => {
                    let (p, q) = pair(f)?;
                    Rate::Frame { p, q }
                }
                (None, Some(s)) => Rate::Sample { hz: whole(s)? },
                _ => return None,
            };
            let int = |k: &str| match c.get(k) {
                None => Some(None),
                Some(v) => v.as_i64().map(Some),
            };
            let source = match c.get("source") {
                None => false,
                Some(b) => b.as_bool()?,
            };
            if source && matches!(rate, Rate::Frame { .. }) {
                return None;
            }
            Some(Call::Rate(RateCall {
                rate,
                t: int("t")?,
                k: int("k")?,
                source,
            }))
        }
        "time" => Some(Call::Time {
            doc: doc()?,
            text: c.get("text")?.as_str()?.to_string(),
        }),
        "export" => {
            let frame_rate = match c.get("frame_rate") {
                None => None,
                Some(f) => Some(pair(f)?),
            };
            let sample_rate = match c.get("audio") {
                None => None,
                Some(a) => Some(whole(a.get("sample_rate")?)?),
            };
            Some(Call::Export(Export {
                doc: doc()?,
                frame_rate,
                sample_rate,
            }))
        }
        "play" => Some(Call::Play {
            doc: doc()?,
            display_hz: whole(c.get("display_hz")?)?,
            to: c.get("to")?.as_i64()?,
        }),
        "determinism" => {
            let play = match c.get("play") {
                None => PlayPath::Warm,
                Some(p) => match p.as_str()? {
                    "warm" => PlayPath::Warm,
                    "cold" => PlayPath::Cold,
                    _ => return None,
                },
            };
            let at_times = match c.get("at_times") {
                None => None,
                Some(v) => Some(
                    v.as_array()?
                        .iter()
                        .map(Value::as_i64)
                        .collect::<Option<Vec<_>>>()?,
                ),
            };
            Some(Call::Determinism(Determinism {
                doc: doc()?,
                display_hz: whole(c.get("display_hz")?)?,
                play,
                at_times,
            }))
        }
        _ => None,
    }
}

/// `eval`'s `t`: absent is the start, a JSON integer is a flick count, and text is a time
/// literal resolved against the document.
pub fn eval_time(v: Option<&Value>) -> Option<EvalTime> {
    match v {
        None => Some(EvalTime::Flicks(0)),
        Some(Value::Number(n)) => Some(EvalTime::Flicks(n.as_i64()?)),
        Some(Value::String(s)) => Some(EvalTime::Literal(s.clone())),
        _ => None,
    }
}

fn refused(code: &str) -> Value {
    json!({"outcome": "refused", "code": code})
}

fn bad_rate(rate: Rate, why: &str) -> Value {
    json!({"outcome": "refused", "code": "bad_rate", "rate": rate.text(), "why": why})
}

/// A virtual display's frame in flicks. A display whose rate doesn't divide the second samples
/// the document at times rounded to the nearest flick (Time and the flick); that sampling isn't
/// on this surface, so such a display is refused as input, not as a bad rate.
fn display_frame(hz: u32) -> Result<i64, Value> {
    clock::sample_length(hz).map_err(|_| {
        json!({
            "outcome": "refused",
            "code": "bad_input",
            "why": format!("a {hz} Hz display doesn't divide the second; play and determinism run on one that does"),
        })
    })
}

/// The time grammar's context for a document: its transport's frame rate and its markers as
/// motion resolves them (Marker: `t`, resolved at check).
fn context_of(doc: &Value) -> TimeContext {
    let mut ctx = TimeContext {
        frame_rate: doc
            .get("transport")
            .and_then(frame_rate_of)
            .unwrap_or((60, 1)),
        ..TimeContext::default()
    };
    if let Some(motion) = doc.as_object().and_then(|m| read_motion(m).ok()) {
        for m in motion.markers {
            ctx.markers.insert(m.id, (m.start, m.end));
        }
    }
    ctx
}

/// The transport's sample rate, or the default 48 kHz.
fn sample_rate_of(doc: &Value) -> u32 {
    doc.get("transport")
        .and_then(|t| t.get("sample_rate"))
        .and_then(Value::as_u64)
        .and_then(|hz| u32::try_from(hz).ok())
        .unwrap_or(48_000)
}

/// Determinism's default `at_times` for a document: the start; every key, marker, cut and wrap
/// flick and the flick before each; every checkpoint flick, the flick before it and the midpoint
/// to the next; the span's last flick; and 100 times from the document's seed. Ascending,
/// unique, never before the start. The design's set also names fork flicks; a fork is an
/// input-track `fork_at`, and there is no input track at this base, so none is listed.
fn default_times(doc: &Value, motion: Option<&Motion>) -> Vec<i64> {
    let mut set = BTreeSet::new();
    set.insert(0);
    let mut named = Vec::new();
    let mut span = None;
    if let Some(m) = motion {
        span = m.transport.span;
        for c in &m.channels {
            named.extend(c.curve.keys.iter().map(|k| k.t));
        }
        for p in &m.placements {
            let Some(clip) = m.clip(&p.clip) else {
                continue;
            };
            let delays: Vec<i64> = if p.bindings.is_empty() {
                vec![0]
            } else {
                p.bindings.iter().map(|b| b.delay).collect()
            };
            for delay in delays {
                // A repeat's passes, the first 64: the set is for a comparison, not a count.
                for i in (0..i64::from(p.count)).take(64) {
                    let base = p.start + delay + i * clip.span;
                    named.push(base);
                    named.push(base + clip.span);
                    for c in &clip.channels {
                        named.extend(c.curve.keys.iter().map(|k| base + k.t));
                    }
                }
            }
        }
        for mk in &m.markers {
            named.push(mk.start);
            named.push(mk.end);
        }
        named.extend(m.cuts.iter().map(|c| c.at));
        if m.transport.wrap {
            if let Some(s) = span {
                named.push(m.transport.start + s);
            }
        }
    }
    for t in named {
        set.insert(t);
        set.insert(t - 1);
    }
    let span = span.unwrap_or(0);
    let mut c = 0;
    while c < span {
        set.insert(c);
        set.insert(c - 1);
        let mid = c + CHECKPOINT_EVERY / 2;
        if mid < span {
            set.insert(mid);
        }
        c += CHECKPOINT_EVERY;
    }
    if span > 0 {
        set.insert(span - 1);
    }
    let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
    let mut rng = Seeded::new(seed);
    let mut added = 0;
    let mut draws = 0;
    while added < 100 && draws < 10_000 {
        draws += 1;
        if set.insert(rng.below(span.max(1) as u64) as i64) {
            added += 1;
        }
    }
    set.into_iter().filter(|t| *t >= 0).collect()
}

impl Hub<'_> {
    /// The document's current revision, or the `no_revision` refusal.
    fn current_doc(&self, doc: &str) -> Result<Value, Value> {
        self.current(doc)
            .map(|r| r.doc.clone())
            .ok_or_else(|| refused("no_revision"))
    }

    /// The whole-flick sample at `hz`, or why there is none; the planted check takes every
    /// rate from 8 to 192 kHz.
    fn sample_length(&self, hz: u32) -> Result<i64, String> {
        if self.scenario.planted == Some(Planted::AcceptsEverySampleRate8To192k) {
            return if (8_000..=192_000).contains(&hz) {
                Ok(FLICKS_PER_SECOND / i64::from(hz))
            } else {
                Err(format!("sample rate {hz} Hz is outside 8 to 192 kHz"))
            };
        }
        clock::sample_length(hz)
    }

    /// The whole-flick length of a rate, or why it has none: the rule every call applies.
    fn length_of(&self, rate: Rate) -> Result<i64, String> {
        match rate {
            Rate::Frame { p, q } => clock::frame_length(p, q),
            Rate::Sample { hz } => self.sample_length(hz),
        }
    }

    /// `rate`: the rule for one rate, and the integer conversions at `t` and `k`.
    pub fn rate_reply(&self, call: &RateCall) -> Value {
        let text = call.rate.text();
        let length = match self.length_of(call.rate) {
            Ok(length) => length,
            Err(why) if call.source => {
                return json!({"outcome": "resampled", "rate": text, "why": why})
            }
            Err(why) => return bad_rate(call.rate, &why),
        };
        let mut reply = json!({"outcome": "valid", "rate": text, "length": length});
        if let Some(t) = call.t {
            let index = match (self.scenario.planted, call.rate) {
                (Some(Planted::FrameIndexI64Product), Rate::Frame { p, q }) => t
                    .wrapping_mul(i64::from(p))
                    .div_euclid(FLICKS_PER_SECOND * i64::from(q)),
                (Some(Planted::FrameIndexTruncatingDivision), _) => t / length,
                _ => clock::index(t, length),
            };
            reply["index"] = json!(index);
        }
        if let Some(k) = call.k {
            match clock::at(k, length) {
                Some(t) => reply["t"] = json!(t),
                None => return json!({"outcome": "refused", "code": "out_of_range", "rate": text}),
            }
        }
        reply
    }

    /// `eval`'s and `time`'s `t`: a flick count as it is, or a literal resolved against the
    /// document's current revision, its frame rate and its markers.
    pub(crate) fn resolve_time(&self, doc: &str, t: &EvalTime) -> Result<i64, &'static str> {
        match t {
            EvalTime::Flicks(t) => Ok(*t),
            EvalTime::Literal(text) => {
                let doc = self.current(doc).map(|r| &r.doc).ok_or("no_revision")?;
                let time = Time::parse(text).map_err(|r| r.code)?;
                time.resolve(&context_of(doc)).map_err(|r| r.code)
            }
        }
    }

    /// `time`: a literal's flicks in a document.
    pub fn time_reply(&self, doc: &str, text: &str) -> Value {
        match self.resolve_time(doc, &EvalTime::Literal(text.to_string())) {
            Ok(t) => json!({"outcome": "resolved", "t": t}),
            Err(code) => refused(code),
        }
    }

    /// `export`: the plan's rates, the document's unless given, each a whole number of flicks.
    pub fn export_reply(&self, e: &Export) -> Value {
        let doc = match self.current_doc(&e.doc) {
            Ok(doc) => doc,
            Err(reply) => return reply,
        };
        let (p, q) = e
            .frame_rate
            .or_else(|| doc.get("transport").and_then(frame_rate_of))
            .unwrap_or((60, 1));
        let hz = e.sample_rate.unwrap_or_else(|| sample_rate_of(&doc));
        let frame = match self.length_of(Rate::Frame { p, q }) {
            Ok(frame) => frame,
            Err(why) => return bad_rate(Rate::Frame { p, q }, &why),
        };
        let sample = match self.length_of(Rate::Sample { hz }) {
            Ok(sample) => sample,
            Err(why) => return bad_rate(Rate::Sample { hz }, &why),
        };
        json!({
            "outcome": "planned",
            "frame_rate": [p, q],
            "frame": frame,
            "sample_rate": hz,
            "sample": sample,
        })
    }

    /// `play`: the document's session on a virtual display at `display_hz` from the start to
    /// `to`. The display runs a frame at every multiple of its frame; the transport draws the
    /// first, then one only when the last drawn frame's `valid_until` has come or a stepping
    /// operator steps, a change (Frame clock and scheduler: never unasked).
    pub fn play(&mut self, doc: &str, display_hz: u32, to: i64) -> Value {
        let document = match self.current_doc(doc) {
            Ok(doc) => doc,
            Err(reply) => return reply,
        };
        let display = match display_frame(display_hz) {
            Ok(display) => display,
            Err(reply) => return reply,
        };
        if to < 0 {
            return refused("bad_input");
        }
        let view = default_view(&document);
        let mut session = self.new_session();
        session.load(&mut self.sched, &document);
        // The step of every stepping operator the document has a node for: each step changes
        // what it writes, so the next step arms a frame whatever motion says.
        let steps: Vec<i64> = {
            let present: BTreeSet<String> = session
                .nodes(&self.sched)
                .into_iter()
                .map(|n| n.operator)
                .collect();
            self.sched
                .sealed
                .ops
                .iter()
                .filter(|o| present.contains(&o.key))
                .filter_map(|o| o.op.step)
                .collect()
        };
        let (mut frames, mut drawn, mut last) = (0u64, 0u64, None);
        let mut armed = Some(0);
        let mut k = 0i64;
        while let Some(t) = k.checked_mul(display).filter(|t| *t <= to) {
            frames += 1;
            if armed.is_some_and(|a| a <= t) {
                session.frame(&mut self.sched, t, &view);
                drawn += 1;
                last = Some(t);
                let next_motion = match session.value(&self.sched, "motion.next", None) {
                    Some(Val::Json(v)) => v.as_i64(),
                    _ => None,
                };
                let next_step = steps
                    .iter()
                    .filter_map(|s| (t.div_euclid(*s) + 1).checked_mul(*s))
                    .min();
                armed = [next_motion, next_step].into_iter().flatten().min();
            }
            k += 1;
        }
        json!({"outcome": "played", "frames": frames, "drawn": drawn, "last_drawn": last})
    }

    /// `determinism`: for each time, the frame reached by playing to it against the frame
    /// reached by seeking to it, each on a fresh scheduler and session, as canonical renders
    /// and node results.
    pub fn determinism(&mut self, d: &Determinism) -> Value {
        let document = match self.current_doc(&d.doc) {
            Ok(doc) => doc,
            Err(reply) => return reply,
        };
        let display = match display_frame(d.display_hz) {
            Ok(display) => display,
            Err(reply) => return reply,
        };
        let at_times: Vec<i64> = match &d.at_times {
            Some(given) => given
                .iter()
                .copied()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            None => {
                let motion = document.as_object().and_then(|m| read_motion(m).ok());
                default_times(&document, motion.as_ref())
            }
        };
        let view = default_view(&document);
        let mut frames = Vec::with_capacity(at_times.len());
        for &t in &at_times {
            // Play (warm): every display frame from the start before t, then t, in one session.
            // Play (cold): t alone. Seek: a cold jump from a second later.
            let play_times: Vec<i64> = match d.play {
                PlayPath::Warm => (0..)
                    .map_while(|k: i64| k.checked_mul(display))
                    .take_while(|f| *f < t)
                    .chain(std::iter::once(t))
                    .collect(),
                PlayPath::Cold => vec![t],
            };
            let seek_times = [t.saturating_add(FLICKS_PER_SECOND), t];
            let play = match self.side(&document, &view, &play_times) {
                Ok(side) => side,
                Err(code) => return refused(&code),
            };
            let seek = match self.side(&document, &view, &seek_times) {
                Ok(side) => side,
                Err(code) => return refused(&code),
            };
            frames.push(json!({"t": t, "play": play, "seek": seek}));
        }
        json!({"outcome": "compared", "at_times": at_times, "frames": frames})
    }

    /// One side of a comparison: a fresh scheduler and session framed at `times` in order, its
    /// last frame's canonical render (the SHA-256 of its PNG, in the evidence store) and its
    /// nodes' results.
    fn side(&mut self, doc: &Value, view: &[Value; 6], times: &[i64]) -> Result<Value, String> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        for &t in times {
            session.frame(&mut sched, t, view);
        }
        let drawing =
            crate::frames::drawing_of(&sched, &session).ok_or_else(|| "no_drawing".to_string())?;
        let (sha, _, _) = self
            .canonical_png(&drawing, None)
            .map_err(|u| u.code.to_string())?;
        let nodes: Vec<Value> = session
            .nodes(&sched)
            .into_iter()
            .map(|n| {
                json!({"operator": n.operator, "module": n.module, "item": n.item, "result": n.result})
            })
            .collect();
        Ok(json!({"pixels": sha, "nodes": nodes}))
    }
}
