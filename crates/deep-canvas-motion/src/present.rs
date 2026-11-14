//! #507 (canvas primitives: Marker: present mode): the timeline's position as a fold over the
//! clock and the input track. The clock stamps every entry and the document reads the position,
//! which follows the clock except where it holds at a stop or jumps. The fold is compiled with
//! the program into pieces, each starting at a clock time with the position it shows there, and a
//! frame finds its piece by binary search, so a seek reads what playing reached. A piece's start
//! depends only on entries at or before it, so a later entry never moves an earlier piece.
//!
//! A stop is a stage marker or a marker with `goto`. It holds the timeline when it waits for a
//! control, or, in present mode, when it is a stage. Paths only go forward: `then` and `goto`
//! name later markers, so the fold ends, and back retraces the stages the path took.

use serde_json::{json, Map, Value};

use crate::doc::{Motion, Refused};
use crate::input::Entry;
use crate::program::Program;
use crate::tempo::Tempo;

/// The most paths a film's waits and branches may make; the film audit runs on each.
pub const MOST_PATHS: usize = 64;

/// The longest stage notes, in characters.
const NOTES: usize = 2_000;

/// How the position runs through one piece.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// With the clock, from the piece's position.
    Run,
    /// Held at the piece's position.
    Hold,
    /// Held, replaying `[from, from + len)` on the clock (`hold: loop {from}`).
    Loop { from: i64, len: i64 },
}

/// From clock `t` the position is `p` and runs by `kind`; `stop` is the stop it holds at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Piece {
    pub t: i64,
    pub p: i64,
    pub kind: Kind,
    pub stop: Option<usize>,
}

/// What a stop waits for: a document-class control, its options and where each goes on.
#[derive(Clone, Debug, PartialEq)]
pub struct Wait {
    pub control: String,
    pub options: Vec<String>,
    /// The default's option, when the control has options and a default.
    pub default: Option<usize>,
    /// Whether the control has a value before any entry: a default.
    pub valued: bool,
    /// Per option, the marker time `then` sends it to; an option left out plays on.
    pub then: Vec<Option<i64>>,
}

/// A stage marker or a marker with `goto`, with its present-mode fields.
#[derive(Clone, Debug, PartialEq)]
pub struct Stop {
    pub marker: String,
    pub at: i64,
    /// Its stage number, from 1 in time order, when it is a stage marker.
    pub stage: Option<usize>,
    pub name: String,
    pub notes: String,
    pub waits: Option<Wait>,
    pub goto: Option<i64>,
    /// `hold: loop {from}`: the start of the span the hold replays.
    pub from: Option<i64>,
    /// With a tempo map, the length of the bar at the marker: a hold lasts whole bars.
    pub bar: Option<i64>,
}

/// The stops, the pieces their fold over the track makes, and until when present mode runs on
/// the clock (`None`: it doesn't), so a stage reached before then holds.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Path {
    pub stops: Vec<Stop>,
    pub pieces: Vec<Piece>,
    pub present: Option<i64>,
    start: i64,
}

/// What an entry does to the path.
enum Act<'a> {
    Advance,
    Back,
    /// A jump to the stage marker named, when it lies ahead.
    Goto(&'a str),
    Control(&'a str),
    Nothing,
}

fn act(e: &Entry) -> Act<'_> {
    if !e.control.is_empty() {
        return Act::Control(&e.control);
    }
    match &e.value {
        Value::String(s) if s == "advance" => Act::Advance,
        Value::String(s) if s == "back" => Act::Back,
        Value::Object(o) => o
            .get("goto")
            .and_then(Value::as_str)
            .map_or(Act::Nothing, Act::Goto),
        _ => Act::Nothing,
    }
}

fn bad(code: &'static str, path: String, detail: Value) -> Refused {
    Refused {
        code,
        path,
        detail: Some(Box::new(detail)),
    }
}

/// A control's input class (Scope and input classes): its own `class`; a choice that names a
/// variant set is `view`; any other `document`.
fn class_of(control: &Value) -> &str {
    match control.get("class").and_then(Value::as_str) {
        Some(c) => c,
        None if control.get("variant").is_some() => "view",
        None => "document",
    }
}

/// A control's options in order: a choice's `options`, a stages control's stages, a toggle's
/// `false` and `true`; none for any other kind.
fn options_of(control: &Value) -> Vec<String> {
    match control.get("kind").and_then(Value::as_str) {
        Some("toggle") => vec!["false".into(), "true".into()],
        Some("stages") => control
            .get("stages")
            .and_then(Value::as_object)
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default(),
        _ => control
            .get("options")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|o| o.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The option a value names, a bool naming a toggle's.
fn option_of(options: &[String], value: &Value) -> Option<usize> {
    let name = match value {
        Value::Bool(b) => b.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    options.iter().position(|o| *o == name)
}

/// A choice's entries `(t, seq, index)`, its value before any, and its range.
pub(crate) type ChoiceRead = (Vec<(i64, i64, f64)>, f64, (f64, f64));

/// #507: a choice read in an expression: the index of its option from 0, its default's before
/// any entry or −1 with none (Control), its entries `(t, seq, index)` in track order.
pub(crate) fn choice_read(control: &Value, id: &str, track: &[Entry]) -> Option<ChoiceRead> {
    if control.get("kind").and_then(Value::as_str) != Some("choice") {
        return None;
    }
    let options = options_of(control);
    let mut entries: Vec<&Entry> = track.iter().filter(|e| e.control == id).collect();
    entries.sort_by_key(|e| e.key());
    let index = |v: &Value| option_of(&options, v).map_or(-1.0, |i| i as f64);
    let read = entries
        .into_iter()
        .map(|e| (e.t, e.seq, index(&e.value)))
        .collect();
    let default = control.get("default").map_or(-1.0, index);
    Some((read, default, (-1.0, options.len() as f64 - 1.0)))
}

impl Program {
    /// The timeline position placements read at `doc_t`: the look's quantize, then a document
    /// remap.
    pub fn timeline(&self, doc_t: i64) -> i64 {
        let shown = self
            .quantize
            .map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        self.motion.document_time(shown)
    }

    /// The export frame `doc_t` falls in: start + k × Δ, floored, in exact flicks.
    pub fn frame_index(&self, doc_t: i64) -> i64 {
        let (p, q) = self.motion.frame_rate;
        let d = i128::from(doc_t - self.motion.transport.start) * i128::from(p);
        d.div_euclid(i128::from(deep_canvas::grammar::FLICKS_PER_SECOND) * i128::from(q)) as i64
    }

    /// What remap `r` reads as parent time at `doc_t`: its placement's local time before the
    /// remap, or the timeline's from the transport's start.
    pub fn remap_parent(&self, r: usize, doc_t: i64) -> i64 {
        let motion = &self.motion;
        let at = self.timeline(doc_t);
        match motion.placements.iter().find(|p| p.timing.remap == Some(r)) {
            Some(p) => p.parent_time(motion, at),
            None => at - motion.transport.start,
        }
    }

    /// #507: the timeline's position at clock `t` and the loop's pass: the path's position, then
    /// the transport's wrap.
    pub fn position(&self, t: i64) -> (i64, i64) {
        let p = self.path.at(t);
        if self.options.unwrap {
            (p, 0)
        } else {
            crate::eval::position(&self.motion, p)
        }
    }
}

impl Path {
    /// The stops of `doc` and their fold over `track`; `present` comes from the played form:
    /// `true`, or `{until}`, the clock at which present mode ended.
    pub fn build(
        doc: &Map<String, Value>,
        motion: &Motion,
        track: &[Entry],
    ) -> Result<Path, Refused> {
        let path = Path {
            stops: stops_of(doc, motion)?,
            pieces: Vec::new(),
            present: match doc.get("present") {
                Some(Value::Bool(true)) => Some(i64::MAX),
                Some(Value::Object(p)) => {
                    Some(p.get("until").and_then(Value::as_i64).unwrap_or(i64::MAX))
                }
                _ => None,
            },
            start: motion.transport.start,
        };
        let paths = path.paths();
        if paths > MOST_PATHS {
            return Err(bad(
                "too_many_paths",
                "markers".into(),
                json!({"paths": paths, "most": MOST_PATHS}),
            ));
        }
        Ok(path.fold(track))
    }

    /// Whether stop `s`, reached at clock `t`, holds the timeline.
    fn holds(&self, s: &Stop, t: i64) -> bool {
        s.waits.is_some() || (self.present.is_some_and(|until| t < until) && s.stage.is_some())
    }

    /// The first stop at or after position `p`, past stop `after` when it is at `p` too.
    fn next_stop(&self, p: i64, after: Option<usize>) -> Option<usize> {
        let from = self.stops.partition_point(|s| s.at < p);
        (from..self.stops.len()).find(|&k| self.stops[k].at > p || after.is_none_or(|a| k > a))
    }

    /// The piece that holds at stop `k` from clock `t`.
    fn held(&self, k: usize, t: i64) -> Piece {
        let s = &self.stops[k];
        let kind = match s.from {
            Some(from) => Kind::Loop {
                from,
                len: s.at - from,
            },
            None => Kind::Hold,
        };
        Piece {
            t,
            p: s.at,
            kind,
            stop: Some(k),
        }
    }

    /// The stage stop at marker `marker`, when it lies after position `p`.
    pub fn stage_ahead(&self, marker: &str, p: i64) -> Option<usize> {
        self.stops
            .iter()
            .position(|s| s.stage.is_some() && s.marker == marker && s.at > p)
    }

    /// The path refolded over `track`: no pieces where nothing holds or jumps, so the position
    /// is the clock.
    pub fn fold(mut self, track: &[Entry]) -> Path {
        self.pieces = Vec::new();
        if !self
            .stops
            .iter()
            .any(|s| self.holds(s, i64::MIN) || s.goto.is_some())
        {
            return self;
        }
        let mut entries: Vec<&Entry> = track.iter().collect();
        entries.sort_by_key(|e| e.key());
        let mut pieces = vec![Piece {
            t: self.start,
            p: self.start,
            kind: Kind::Run,
            stop: None,
        }];
        let (mut t, mut p, mut after) = (self.start, self.start, None);
        let mut stack: Vec<usize> = Vec::new();
        let mut i = 0;
        // The stop held at and the clock it held from, while a hold is open.
        let mut holding: Option<(usize, i64)> = None;
        loop {
            if let Some((k, th)) = holding {
                let Some(e) = entries.get(i) else { break };
                i += 1;
                let et = e.t.max(th);
                let s = &self.stops[k];
                let option = match (act(e), &s.waits) {
                    (Act::Control(c), Some(w)) if c == w.control => option_of(&w.options, &e.value),
                    (Act::Advance, None) => None,
                    (Act::Advance, Some(w)) => {
                        let last = entries[..i].iter().rev().find(|x| x.control == w.control);
                        match last {
                            Some(x) => option_of(&w.options, &x.value),
                            None if w.valued => w.default,
                            None => continue,
                        }
                    }
                    (Act::Back, _) => {
                        if stack.len() > 1 {
                            stack.pop();
                        }
                        let top = stack[stack.len() - 1];
                        pieces.push(self.held(top, et));
                        holding = Some((top, et));
                        continue;
                    }
                    (Act::Goto(m), _) => {
                        if let Some(n) = self.stage_ahead(m, s.at) {
                            stack.push(n);
                            pieces.push(self.held(n, et));
                            holding = Some((n, et));
                        }
                        continue;
                    }
                    _ => continue,
                };
                // With a tempo map the hold lasts the fewest whole bars that reach past the entry.
                t = match s.bar {
                    Some(bar) if bar > 0 => th + ((et - th).div_euclid(bar) + 1) * bar,
                    _ => et,
                };
                let to = option
                    .and_then(|o| s.waits.as_ref().and_then(|w| w.then[o]))
                    .or(s.goto);
                (p, after) = match to {
                    Some(g) => (g, None),
                    None => (s.at, Some(k)),
                };
                pieces.push(Piece {
                    t,
                    p,
                    kind: Kind::Run,
                    stop: None,
                });
                holding = None;
                continue;
            }
            let next = self.next_stop(p, after);
            let arrive = next.map(|k| t + (self.stops[k].at - p));
            // While it runs, back returns to the stage the path last held at, and a stage number
            // goes ahead to that stage.
            if let Some(e) = entries.get(i).filter(|e| arrive.is_none_or(|a| e.t < a)) {
                i += 1;
                let at = e.t.max(t);
                let now = p + (at - t);
                let to = match act(e) {
                    Act::Back if !stack.is_empty() => {
                        if stack.len() > 1 {
                            stack.pop();
                        }
                        Some(stack[stack.len() - 1])
                    }
                    Act::Goto(m) => self.stage_ahead(m, now).inspect(|&n| stack.push(n)),
                    _ => None,
                };
                if let Some(k) = to {
                    pieces.push(self.held(k, at));
                    holding = Some((k, at));
                }
                continue;
            }
            let (Some(k), Some(a)) = (next, arrive) else {
                break;
            };
            (t, p) = (a, self.stops[k].at);
            let s = &self.stops[k];
            if self.holds(s, t) {
                stack.push(k);
                pieces.push(self.held(k, t));
                holding = Some((k, t));
            } else if let Some(g) = s.goto {
                (p, after) = (g, None);
                pieces.push(Piece {
                    t,
                    p,
                    kind: Kind::Run,
                    stop: None,
                });
            } else {
                after = Some(k);
            }
        }
        self.pieces = pieces;
        self
    }

    /// The piece clock `t` falls in.
    fn piece(&self, t: i64) -> Option<(usize, &Piece)> {
        let i = self.pieces.partition_point(|p| p.t <= t).checked_sub(1)?;
        Some((i, &self.pieces[i]))
    }

    /// The position at clock `t`: the clock itself before any piece and on an empty path.
    pub fn at(&self, t: i64) -> i64 {
        match self.piece(t) {
            None => t,
            Some((_, piece)) => match piece.kind {
                Kind::Run => piece.p + (t - piece.t),
                Kind::Hold => piece.p,
                Kind::Loop { from, len } => from + (t - piece.t).rem_euclid(len.max(1)),
            },
        }
    }

    /// The clock at which a frame at `t` changes next, given `next`, the next change in the
    /// position's own terms: a run carries it to the clock, a hold changes only where its piece
    /// ends, and a loop also where its span starts over.
    pub fn until(&self, t: i64, next: Option<i64>) -> Option<i64> {
        let Some((i, piece)) = self.piece(t) else {
            return next;
        };
        let end = self.pieces.get(i + 1).map(|n| n.t);
        let p = self.at(t);
        let mapped = match piece.kind {
            Kind::Run => next.map(|n| t + (n - p)),
            Kind::Hold => None,
            Kind::Loop { len, .. } => {
                let len = len.max(1);
                let restart = piece.t + ((t - piece.t).div_euclid(len) + 1) * len;
                Some(next.map_or(restart, |n| (t + (n - p)).min(restart)))
            }
        };
        [mapped, end].into_iter().flatten().min()
    }

    /// The stop the position holds at, at clock `t`.
    pub fn held_at(&self, t: i64) -> Option<usize> {
        self.piece(t).and_then(|(_, piece)| piece.stop)
    }

    /// The stage at clock `t`: the one held at, else the last stage the position has passed.
    pub fn stage_at(&self, t: i64) -> Option<usize> {
        if let Some(k) = self.held_at(t) {
            return self.stops[k].stage;
        }
        let p = self.at(t);
        self.stops
            .iter()
            .rev()
            .find(|s| s.stage.is_some() && s.at <= p)
            .and_then(|s| s.stage)
    }

    /// The clock at which the position first reaches `end`, or `None` while a hold stays open.
    pub fn clock_end(&self, end: i64) -> Option<i64> {
        if self.pieces.is_empty() {
            return Some(end);
        }
        for (i, piece) in self.pieces.iter().enumerate() {
            if piece.kind != Kind::Run {
                continue;
            }
            let span = self.pieces.get(i + 1).map(|n| n.t - piece.t);
            if piece.p <= end && span.is_none_or(|s| end <= piece.p + s) {
                return Some(piece.t + (end - piece.p));
            }
        }
        None
    }

    /// The timeline ranges the pieces play, `[from, to)` in position, up to position `end`.
    pub fn ranges(&self, end: i64) -> Vec<(i64, i64)> {
        if self.pieces.is_empty() {
            return vec![(self.start, end)];
        }
        let mut out: Vec<(i64, i64)> = Vec::new();
        for (i, piece) in self.pieces.iter().enumerate() {
            if piece.kind != Kind::Run || piece.p >= end {
                continue;
            }
            let to = self
                .pieces
                .get(i + 1)
                .map_or(end, |n| (piece.p + (n.t - piece.t)).min(end));
            match out.last_mut() {
                Some(last) if last.1 == piece.p => last.1 = to,
                _ if to > piece.p => out.push((piece.p, to)),
                _ => {}
            }
        }
        out
    }

    /// How many forward paths the waits and branches make, outside present mode: each waiting
    /// stop counts the distinct places its options go on; past [`MOST_PATHS`] it stops counting.
    pub fn paths(&self) -> usize {
        let mut memo = vec![None; self.stops.len()];
        let first = self.next_stop(i64::MIN, None);
        first.map_or(1, |k| self.paths_from(k, &mut memo))
    }

    fn paths_from(&self, k: usize, memo: &mut Vec<Option<usize>>) -> usize {
        if let Some(n) = memo[k] {
            return n;
        }
        let s = &self.stops[k];
        let mut targets: Vec<Option<i64>> = match &s.waits {
            Some(w) if !w.options.is_empty() => w.then.iter().map(|t| t.or(s.goto)).collect(),
            _ => vec![s.goto],
        };
        targets.sort_unstable();
        targets.dedup();
        let mut n = 0usize;
        for to in targets {
            let next = match to {
                Some(g) => self.next_stop(g, None),
                None => self.next_stop(s.at, Some(k)),
            };
            n = n
                .saturating_add(next.map_or(1, |j| self.paths_from(j, memo)))
                .min(MOST_PATHS + 1);
        }
        memo[k] = Some(n);
        n
    }
}

/// Each stage marker and each marker with `goto`, in time order, with its fields read and
/// checked: a `then` or `goto` target at or before its marker, a loop's start at or after its
/// stage, and a waiting control that isn't of class document are refused, naming them.
fn stops_of(doc: &Map<String, Value>, motion: &Motion) -> Result<Vec<Stop>, Refused> {
    let Some(written) = doc.get("markers").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let controls = doc.get("controls").and_then(Value::as_object);
    let tempo = Tempo::read(doc, &crate::doc::Ctx::of(motion.frame_rate).time, false)?;
    let time = |id: &str| motion.markers.iter().find(|m| m.id == id).map(|m| m.start);
    let mut stages: Vec<(i64, &str)> = motion
        .markers
        .iter()
        .filter(|m| m.kind == "stage")
        .map(|m| (m.start, m.id.as_str()))
        .collect();
    stages.sort_unstable();
    let mut stops = Vec::new();
    for m in &motion.markers {
        let Some(src) = written.get(&m.id).and_then(Value::as_object) else {
            continue;
        };
        let path = format!("markers/{}", m.id);
        let stage = stages.iter().position(|s| s.1 == m.id).map(|i| i + 1);
        // A target is a later marker, named.
        let ahead = |v: &Value, at: String| -> Result<i64, Refused> {
            let Some(name) = v.as_str() else {
                return Err(bad("bad_doc", at, json!({"marker": m.id})));
            };
            let Some(t) = time(name) else {
                return Err(bad(
                    "ref_unresolved",
                    at,
                    json!({"marker": m.id, "target": name}),
                ));
            };
            if t <= m.start {
                return Err(bad(
                    "marker_order",
                    at,
                    json!({"marker": m.id, "target": name, "why": "a then or goto names a later marker"}),
                ));
            }
            Ok(t)
        };
        let staged = |field: &str| -> Result<(), Refused> {
            match (src.get(field), stage) {
                (Some(_), None) => Err(bad(
                    "bad_marker_kind",
                    format!("{path}/{field}"),
                    json!({"marker": m.id, "why": "only a stage marker takes it"}),
                )),
                _ => Ok(()),
            }
        };
        for field in ["waits_for", "notes", "hold"] {
            staged(field)?;
        }
        let goto = src
            .get("goto")
            .map(|g| ahead(g, format!("{path}/goto")))
            .transpose()?;
        let waits = match src.get("waits_for") {
            None => {
                if src.contains_key("then") {
                    return Err(bad(
                        "bad_doc",
                        format!("{path}/then"),
                        json!({"marker": m.id, "why": "then needs waits_for"}),
                    ));
                }
                None
            }
            Some(Value::String(id)) => {
                let at = format!("{path}/waits_for");
                let Some(control) = controls.and_then(|c| c.get(id)) else {
                    return Err(bad(
                        "ref_unresolved",
                        at,
                        json!({"marker": m.id, "control": id}),
                    ));
                };
                let class = class_of(control);
                if class != "document" {
                    return Err(bad(
                        "waits_for_class",
                        at,
                        json!({"marker": m.id, "control": id, "class": class}),
                    ));
                }
                let options = options_of(control);
                let then = src.get("then").and_then(Value::as_object);
                for name in then.into_iter().flatten().map(|(k, _)| k) {
                    if !options.contains(name) {
                        return Err(bad(
                            "ref_unresolved",
                            format!("{path}/then/{name}"),
                            json!({"marker": m.id, "option": name}),
                        ));
                    }
                }
                let then = options
                    .iter()
                    .map(|o| {
                        then.and_then(|t| t.get(o))
                            .map(|v| ahead(v, format!("{path}/then/{o}")))
                            .transpose()
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let default = control.get("default");
                Some(Wait {
                    control: id.clone(),
                    default: default.and_then(|d| option_of(&options, d)),
                    valued: default.is_some_and(|d| !d.is_null()),
                    options,
                    then,
                })
            }
            Some(_) => {
                return Err(bad(
                    "bad_doc",
                    format!("{path}/waits_for"),
                    json!({"marker": m.id}),
                ))
            }
        };
        let from = match src.get("hold") {
            None => None,
            Some(Value::String(s)) if s == "still" => None,
            Some(h) => {
                let at = format!("{path}/hold/loop/from");
                let Some(name) = h
                    .get("loop")
                    .and_then(|l| l.get("from"))
                    .and_then(Value::as_str)
                else {
                    return Err(bad(
                        "bad_doc",
                        format!("{path}/hold"),
                        json!({"marker": m.id}),
                    ));
                };
                let Some(t) = time(name) else {
                    return Err(bad(
                        "ref_unresolved",
                        at,
                        json!({"marker": m.id, "target": name}),
                    ));
                };
                if t >= m.start {
                    return Err(bad(
                        "marker_order",
                        at,
                        json!({"marker": m.id, "target": name, "why": "a loop replays from an earlier marker"}),
                    ));
                }
                Some(t)
            }
        };
        let notes = match src.get("notes") {
            None => String::new(),
            Some(Value::String(n)) if n.chars().count() <= NOTES => n.clone(),
            Some(Value::String(_)) => {
                return Err(bad(
                    "out_of_range",
                    format!("{path}/notes"),
                    json!({"marker": m.id, "most": NOTES}),
                ))
            }
            Some(_) => {
                return Err(bad(
                    "bad_doc",
                    format!("{path}/notes"),
                    json!({"marker": m.id}),
                ))
            }
        };
        if stage.is_none() && goto.is_none() {
            continue;
        }
        stops.push(Stop {
            marker: m.id.clone(),
            at: m.start,
            stage,
            name: src
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&m.id)
                .to_string(),
            notes,
            waits,
            goto,
            from,
            bar: tempo.as_ref().and_then(|t| t.bar_len(m.start)),
        });
    }
    stops.sort_by(|a, b| (a.at, &a.marker).cmp(&(b.at, &b.marker)));
    Ok(stops)
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;

    fn stop(marker: &str, at: i64, stage: Option<usize>) -> Stop {
        Stop {
            marker: marker.into(),
            at,
            stage,
            name: marker.into(),
            notes: String::new(),
            waits: None,
            goto: None,
            from: None,
            bar: None,
        }
    }

    fn entry(t: i64, seq: i64, control: &str, value: Value) -> Entry {
        Entry {
            t,
            seq,
            control: control.into(),
            value,
            player: 1,
        }
    }

    fn quiz() -> Path {
        // The criterion's film: a choice at 8 s (B goes on at 21 s), a goto at 20 s to 30 s,
        // questions waiting at 33, 37 and 41 s.
        let wait = |c: &str, options: &[&str], then: Vec<Option<i64>>| Wait {
            control: c.into(),
            options: options.iter().map(|s| s.to_string()).collect(),
            default: None,
            valued: false,
            then,
        };
        let mut pick = stop("pick", 8 * S, Some(1));
        pick.waits = Some(wait("route", &["A", "B"], vec![None, Some(21 * S)]));
        let mut jump = stop("jump", 20 * S, None);
        jump.goto = Some(30 * S);
        let mut stops = vec![pick, jump];
        for (i, at) in [33, 37, 41].into_iter().enumerate() {
            let mut q = stop(&format!("q{i}"), at * S, Some(i + 2));
            q.waits = Some(wait(&format!("a{i}"), &["x", "y", "z"], vec![None; 3]));
            stops.push(q);
        }
        stops.push(stop("land", 21 * S, None));
        stops.sort_by_key(|s| s.at);
        Path {
            stops: stops
                .into_iter()
                .filter(|s| s.stage.is_some() || s.goto.is_some())
                .collect(),
            ..Path::default()
        }
    }

    #[test]
    fn a_choice_goes_on_where_its_option_says_and_skips_the_goto() {
        let track = vec![
            entry(10 * S, 0, "route", json!("B")),
            entry(30 * S, 0, "a0", json!("x")),
            entry(40 * S, 0, "a1", json!("y")),
            entry(50 * S, 0, "a2", json!("z")),
        ];
        let path = quiz().fold(&track);
        assert_eq!(path.at(9 * S), 8 * S, "held at the choice");
        assert_eq!(path.at(10 * S), 21 * S, "B goes on at 21 s");
        assert_eq!(path.ranges(50 * S), vec![(0, 8 * S), (21 * S, 50 * S)]);
        assert_eq!(path.paths(), 2, "the questions add no path; A and B do");
    }

    #[test]
    fn a_seek_reads_what_playing_reached() {
        let track = vec![
            entry(10 * S, 0, "route", json!("A")),
            entry(26 * S, 0, "a0", json!("x")),
            entry(31 * S, 0, "", json!("advance")),
        ];
        let whole = quiz().fold(&track);
        for t in (0..60).map(|k| k * S / 2) {
            let prefix: Vec<Entry> = track.iter().filter(|e| e.t <= t).cloned().collect();
            assert_eq!(quiz().fold(&prefix).at(t), whole.at(t), "at {t}");
        }
    }

    #[test]
    fn back_returns_to_the_previous_stage_on_the_path_taken() {
        let mut path = quiz();
        path.present = Some(i64::MAX);
        // Pick A at 9 s; answer q0 at 30 s; back at 35 s while q1 holds.
        let track = vec![
            entry(9 * S, 0, "route", json!("A")),
            entry(30 * S, 0, "a0", json!("x")),
            entry(35 * S, 0, "", json!("back")),
        ];
        let path = path.fold(&track);
        // A plays 8→20 s (9..21 on the clock), jumps to 30 s, reaches q0 at 33 s (24 s).
        assert_eq!(path.at(24 * S), 33 * S);
        assert_eq!(path.at(34 * S), 37 * S, "q1 holds");
        assert_eq!(path.at(36 * S), 33 * S, "back holds at q0");
    }

    #[test]
    fn a_hold_on_the_beat_lasts_whole_bars() {
        let mut s = stop("st", 5 * S, Some(1));
        s.bar = Some(2 * S);
        let path = Path {
            stops: vec![s],
            present: Some(i64::MAX),
            ..Path::default()
        };
        let path = path.fold(&[entry(5 * S + 33 * S / 10, 0, "", json!("advance"))]);
        assert_eq!(path.at(9 * S - 1), 5 * S, "held until 4.0 s into the hold");
        assert_eq!(path.at(9 * S), 5 * S);
        assert_eq!(path.at(10 * S), 6 * S);
    }

    #[test]
    fn a_loop_hold_replays_its_span_on_the_clock() {
        let mut s = stop("st", 10 * S, Some(1));
        s.from = Some(8 * S);
        let path = Path {
            stops: vec![s],
            present: Some(i64::MAX),
            ..Path::default()
        }
        .fold(&[entry(17 * S, 0, "", json!("advance"))]);
        for k in [0, 2, 4, 6] {
            assert_eq!(path.at(10 * S + k * S), 8 * S, "offset {k} s");
        }
        assert_eq!(path.at(10 * S + 3 * S), 9 * S);
        assert_eq!(path.at(18 * S), 11 * S, "goes on from the stage marker");
    }
}
