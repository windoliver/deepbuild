//! #507 (canvas primitives: Marker: present mode): what the hub reads of the timeline's path.
//! The motion program folds the clock and the input track into the position the document reads;
//! here the mix, the film audit and the export follow it. Sound is mapped onto the clock before
//! the mix is built: a strip that holds with the timeline becomes one strip per stretch the
//! position runs through it, and a strip marked `at_stage: play` (by default one that loops) runs
//! on the clock from where the position enters its span to where it leaves. The player reads
//! strips as pure functions of the clock, so a seek still renders what playing did.

use std::collections::BTreeSet;

use deep_canvas::schedule::Scheduler;
use deep_canvas::scope::Event;
use deep_canvas_input::track::{Entry, Writer};
use deep_canvas_media::mix::{Gain, Strip};
use deep_canvas_motion::present::{Kind, Path, Stop, MOST_PATHS};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// The far end of a clock range that never closes.
const OPEN: i64 = i64::MAX / 8;

/// Whether `doc` has a marker present mode reads: a stage, or one that waits or jumps.
fn has_stops(doc: &Value) -> bool {
    doc.get("markers")
        .and_then(Value::as_object)
        .is_some_and(|m| {
            m.values().any(|m| {
                m.get("kind").and_then(Value::as_str) == Some("stage")
                    || m.get("goto").is_some()
                    || m.get("waits_for").is_some()
            })
        })
}

/// The path of a played form (its track and present flag inlined); empty where it has no stops
/// or its program doesn't compile, which the document check reports on its own.
pub(crate) fn path_of(doc: &Value) -> Path {
    if !has_stops(doc) {
        return Path::default();
    }
    doc.as_object()
        .and_then(|d| Program::compile(d).ok())
        .map(|p| p.path)
        .unwrap_or_default()
}

/// Each clock stretch the position runs through `[s0, s1)`: `(from, to, position at from)`. A
/// strip that `plays` stays on through a hold or a jump that lands inside its span; any other
/// is silent while the timeline holds and starts again where it runs.
fn stretches(path: &Path, s0: i64, s1: i64, plays: bool) -> Vec<(i64, i64, i64)> {
    let mut out: Vec<(i64, i64, i64)> = Vec::new();
    for (i, piece) in path.pieces.iter().enumerate() {
        let end = path.pieces.get(i + 1).map_or(OPEN, |n| n.t);
        if end <= piece.t {
            continue;
        }
        let seg = match piece.kind {
            Kind::Run => {
                let (a, b) = (
                    piece.p.max(s0),
                    (piece.p.saturating_add(end - piece.t)).min(s1),
                );
                (a < b).then(|| (piece.t + (a - piece.p), piece.t + (b - piece.p), a))
            }
            Kind::Hold | Kind::Loop { .. } if plays && (s0..s1).contains(&piece.p) => {
                Some((piece.t, end, piece.p))
            }
            _ => None,
        };
        let Some(seg) = seg else { continue };
        match out.last_mut() {
            // On the clock, a playing strip carries on; a held one only where the position does.
            Some(last) if last.1 == seg.0 && (plays || last.2 + (last.1 - last.0) == seg.2) => {
                last.1 = seg.1
            }
            _ => out.push(seg),
        }
    }
    out
}

/// Spans of the timeline, such as narration a bus ducks under, as spans of the clock.
pub(crate) fn clock_spans(path: &Path, spans: &[(i64, i64)]) -> Vec<(i64, i64)> {
    if path.pieces.is_empty() {
        return spans.to_vec();
    }
    spans
        .iter()
        .flat_map(|&(a, b)| {
            stretches(path, a, b, false)
                .into_iter()
                .map(|(f, t, _)| (f, t))
        })
        .collect()
}

/// `strips` on the clock: each strip whose ID is in `play`, or that loops and names no
/// `at_stage`, plays on through holds; the rest hold with the timeline. `step` is one sample in
/// flicks, so a strip moved onto the clock stays on whole samples and reads its source exactly.
pub(crate) fn clocked(
    strips: Vec<Strip>,
    path: &Path,
    play: &BTreeSet<String>,
    step: i64,
) -> Vec<Strip> {
    if path.pieces.is_empty() {
        return strips;
    }
    let mut out = Vec::new();
    for s in &strips {
        let plays = play.contains(&s.id);
        let list = stretches(path, s.start, s.start.saturating_add(s.span), plays);
        let n = list.len();
        for (k, (from, to, pos)) in list.into_iter().enumerate() {
            let shift = (from - pos).div_euclid(step.max(1)) * step.max(1);
            let start = pos + shift;
            let rel = pos - s.start;
            let skip = (i128::from(rel) * i128::from(s.rate.0))
                .div_euclid(i128::from(s.rate.1.max(1))) as i64;
            let moved = |t: i64| {
                if t == i64::MIN || t == i64::MAX {
                    t
                } else {
                    t.saturating_add(shift)
                }
            };
            out.push(Strip {
                id: s.id.clone(),
                source: s.source.clone(),
                start,
                r#in: s.r#in + skip,
                out: s.out,
                rate: s.rate,
                gain: match &s.gain {
                    Gain::Keys(keys) => {
                        Gain::Keys(keys.iter().map(|&(t, db, l)| (moved(t), db, l)).collect())
                    }
                    g => g.clone(),
                },
                pan: s.pan,
                fade_in: if rel == 0 { s.fade_in } else { None },
                fade_out: if k + 1 == n { s.fade_out } else { None },
                looped: s.looped,
                span: (to.min(OPEN) - start).max(0),
                bus: s.bus,
                disabled: s
                    .disabled
                    .iter()
                    .map(|&(a, b)| (moved(a), moved(b)))
                    .collect(),
                emitter: s.emitter.clone(),
                synth: s.synth.clone(),
            });
        }
    }
    out
}

/// The strips of `doc` that play on through a hold: `at_stage: play`, or looping with none.
pub(crate) fn playing(doc: &Value) -> BTreeSet<String> {
    let strips = doc.get("strips").and_then(Value::as_object);
    strips
        .into_iter()
        .flatten()
        .filter(|(_, s)| match s.get("at_stage").and_then(Value::as_str) {
            Some(a) => a == "play",
            None => s.get("loop").and_then(Value::as_bool).unwrap_or(false),
        })
        .map(|(id, _)| id.clone())
        .collect()
}

/// `form` with `track` as its whole input track and present mode off: one path's play.
pub(crate) fn with_track_only(form: &Value, track: &[Value]) -> Value {
    let mut out = form.clone();
    if let Some(o) = out.as_object_mut() {
        o.remove("present");
        o.insert("track".into(), Value::Array(track.to_vec()));
    }
    out
}

/// The hold still open at the end of `path`, which a further entry ends: its stop and clock.
fn open_hold(path: &Path) -> Option<(usize, i64)> {
    let last = path.pieces.last()?;
    last.stop
        .filter(|_| last.kind != Kind::Run)
        .map(|k| (k, last.t))
}

/// One value per place a waiting stop's options go on, the first option of each, or the
/// control's default where it has no options.
fn representatives(stop: &Stop) -> Vec<Value> {
    let Some(w) = &stop.waits else {
        return Vec::new();
    };
    if w.options.is_empty() {
        return vec![Value::Null];
    }
    let mut seen: Vec<Option<i64>> = Vec::new();
    let mut out = Vec::new();
    for (o, to) in w.options.iter().zip(&w.then) {
        let to = to.or(stop.goto);
        if !seen.contains(&to) {
            seen.push(to);
            out.push(json!(o));
        }
    }
    out
}

/// One path's export: its played form, its frames and what the receipt says of it.
pub(crate) struct Exported {
    pub doc: Value,
    pub frames: i64,
    pub ranges: Vec<[i64; 2]>,
    pub holds: Vec<Value>,
}

impl Hub<'_> {
    /// #507: each stage marker inside a speaking narration line, refused naming both, since a
    /// hold there would cut the line.
    pub(crate) fn stages_in_narration(&mut self, d: &Value) -> Vec<deep_canvas::document::Issue> {
        let Some(markers) = d.get("markers").and_then(Value::as_object) else {
            return Vec::new();
        };
        if !markers.values().any(|m| m["kind"] == "stage") {
            return Vec::new();
        }
        let Some(script) = self.script_of(d) else {
            return Vec::new();
        };
        let times = crate::time::context_of(d).markers;
        let mut out = Vec::new();
        for (id, _) in markers.iter().filter(|(_, m)| m["kind"] == "stage") {
            let Some(&(t, _)) = times.get(id) else {
                continue;
            };
            for line in &script.lines {
                let (Some(first), Some(last)) = (line.words.first(), line.words.last()) else {
                    continue;
                };
                if first.0 < t && t < last.1 {
                    let what = format!("the stage marker `{id}` falls inside the narration line `{}`, which a hold there would cut", line.id);
                    out.push(deep_canvas::document::Issue::error(
                        "stage_in_narration",
                        id,
                        format!("markers/{id}/t"),
                        json!({"marker": id, "line": line.id}),
                        &what,
                    ));
                }
            }
        }
        out
    }

    /// The entry that ends the open hold at stop `k` from clock `t` with `value`, once the hold
    /// has lasted what the film audit's hold rule asks for the text shown there, whole bars with
    /// a tempo map.
    fn ending(&mut self, doc: &Value, input: &Value, stop: &Stop, t: i64, value: Value) -> Value {
        let need = self.hold_need(doc, input, t);
        // The fold ends a hold on the beat at the fewest whole bars reaching past the entry.
        let at = match stop.bar {
            Some(bar) if bar > 0 => t + need.max(1) - 1,
            _ => t + need,
        };
        let control = stop.waits.as_ref().map_or("", |w| w.control.as_str());
        json!({"t": at, "seq": 0, "control": control, "value": value})
    }

    /// #507: the input tracks of every path `drawn`'s waits and branches make, each hold as long
    /// as the hold rule asks; `None` where nothing waits.
    pub(crate) fn audit_tracks(&mut self, drawn: &Value, input: &Value) -> Option<Vec<Vec<Value>>> {
        let first = path_of(&with_track_only(drawn, &[]));
        if !first.stops.iter().any(|s| s.waits.is_some()) {
            return None;
        }
        let mut done = Vec::new();
        let mut open = vec![Vec::new()];
        while let Some(track) = open.pop() {
            let doc = with_track_only(drawn, &track);
            let path = path_of(&doc);
            let Some((k, t)) = open_hold(&path).filter(|_| track.len() <= path.stops.len()) else {
                done.push(track);
                continue;
            };
            for value in representatives(&path.stops[k]) {
                let mut next = track.clone();
                next.push(self.ending(&doc, input, &path.stops[k], t, value));
                open.push(next);
            }
            if done.len() + open.len() > MOST_PATHS {
                break;
            }
        }
        done.extend(open);
        Some(done)
    }

    /// #507: the one path an export of `doc` (its recorded track inlined) renders over `range:
    /// whole`: at each waiting marker the last entry made there, else the control's default, else
    /// refused naming the marker; each hold as long as the film audit's hold rule asks. `None`
    /// where no marker waits or jumps.
    pub(crate) fn export_path(&mut self, doc: &Value, end: i64) -> Result<Option<Exported>, Value> {
        let recorded = path_of(&with_track_only(
            doc,
            &doc.get("track")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        ));
        if recorded.pieces.is_empty() {
            return Ok(None);
        }
        let entries: Vec<Value> = doc
            .get("track")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|e| e.get("present").is_none())
            .cloned()
            .collect();
        // Each stop's last entry made while it held, on the recorded path.
        let made = |k: usize| -> Option<Value> {
            let w = recorded.stops[k].waits.as_ref()?;
            let held: Vec<(i64, i64)> = recorded
                .pieces
                .iter()
                .enumerate()
                .filter(|(_, p)| p.stop == Some(k))
                .map(|(i, p)| (p.t, recorded.pieces.get(i + 1).map_or(i64::MAX, |n| n.t)))
                .collect();
            let made = entries.iter().rfind(|e| {
                e["control"] == w.control.as_str()
                    && e["t"]
                        .as_i64()
                        .is_some_and(|t| held.iter().any(|(a, b)| (*a..=*b).contains(&t)))
            });
            let control = doc.get("controls").and_then(|c| c.get(&w.control));
            made.map(|e| e["value"].clone())
                .or_else(|| control.and_then(|c| c.get("default")).cloned())
        };
        let mut track: Vec<Value> = Vec::new();
        let input = json!({});
        loop {
            let played = with_track_only(doc, &track);
            let path = path_of(&played);
            let Some((k, t)) = open_hold(&path).filter(|_| track.len() <= path.stops.len()) else {
                let clock = path
                    .clock_end(end)
                    .ok_or_else(|| json!({"code": "export_holds_open"}))?;
                let holds = path
                    .pieces
                    .iter()
                    .enumerate()
                    .filter(|(_, p)| p.kind != Kind::Run)
                    .filter_map(|(i, p)| Some(json!({"marker": path.stops[p.stop?].marker, "t": p.t, "held": path.pieces.get(i + 1)?.t - p.t})))
                    .collect();
                let ranges = path.ranges(end).into_iter().map(|(a, b)| [a, b]).collect();
                return Ok(Some(Exported {
                    doc: played,
                    frames: clock,
                    ranges,
                    holds,
                }));
            };
            // A stop reached on this path but never on the recorded one takes its default.
            let stop = path.stops[k].clone();
            let Some(value) = recorded
                .stops
                .iter()
                .position(|s| s.marker == stop.marker)
                .and_then(made)
            else {
                return Err(json!({"code": "export_wait_unmade", "marker": stop.marker,
                    "why": format!("the marker `{}` waits for `{}`, which has no entry there and no default", stop.marker, stop.waits.as_ref().map_or("", |w| w.control.as_str()))}));
            };
            let entry = self.ending(&played, &input, &stop, t, value);
            track.push(entry);
        }
    }
}

/// Present mode as the shell runs it (Marker: present mode): the piece it shows, on which
/// display, since when, and what the room's keys have set.
pub(crate) struct Presenting {
    pub doc: String,
    pub panel: String,
    pub display: String,
    pub since: i64,
    /// When Esc ended it; the card it kept off the display then opens.
    pub ended: Option<i64>,
    blank: bool,
    /// The stage number typed so far, which Enter takes.
    digits: String,
    notice: Option<String>,
    /// When the notice was set: it shows for [`NOTICE_FOR`].
    notice_at: i64,
    /// When Shift+P opened the presenter view.
    presenter: Option<i64>,
}

/// The shell's present-mode calls.
pub(crate) enum PresentCall {
    /// `present {panel, pixels?, size?}`: what present mode shows on the panel's display, and
    /// with `pixels` that display drawn at `size` pixels.
    State {
        panel: String,
        pixels: Option<[u16; 2]>,
    },
    /// `presenter {pixels?, size?}`: what the presenter view shows, and with `pixels` the view
    /// drawn.
    Presenter { pixels: Option<[u16; 2]> },
    /// `menu_bar`: the menu bar's count of asks.
    MenuBar,
}

/// The reference window in pixels: 1512 × 982 points at 2× (How we know version 0 works).
const REFERENCE: [u16; 2] = [3024, 1964];

/// A call's `pixels: true`, drawn at its `size` or the reference window's; `None` without it.
fn pixels_of(c: &Map<String, Value>) -> Option<Option<[u16; 2]>> {
    if c.get("pixels") != Some(&Value::Bool(true)) {
        return Some(None);
    }
    match c.get("size").and_then(Value::as_array).map(Vec::as_slice) {
        None => Some(Some(REFERENCE)),
        Some([w, h]) => Some(Some([
            u16::try_from(w.as_u64()?).ok()?,
            u16::try_from(h.as_u64()?).ok()?,
        ])),
        Some(_) => None,
    }
}

pub(crate) fn parse_call(name: &str, c: &Map<String, Value>) -> Option<PresentCall> {
    match name {
        "present" => Some(PresentCall::State {
            panel: c.get("panel")?.as_str()?.to_string(),
            pixels: pixels_of(c)?,
        }),
        "presenter" => Some(PresentCall::Presenter {
            pixels: pixels_of(c)?,
        }),
        "menu_bar" => Some(PresentCall::MenuBar),
        _ => None,
    }
}

/// `size` pixels of one color, RGBA.
fn filled(size: [u16; 2], rgba: [u8; 4]) -> Vec<u8> {
    rgba.repeat(usize::from(size[0]) * usize::from(size[1]))
}

/// `img` (`at` pixels, RGBA) laid over `canvas` with its top-left corner at `(x, y)`, clipped.
fn paste(canvas: &mut [u8], size: [u16; 2], img: &[u8], at: [u16; 2], x: usize, y: usize) {
    let (w, h) = (usize::from(size[0]), usize::from(size[1]));
    let (iw, ih) = (usize::from(at[0]), usize::from(at[1]));
    let n = iw.min(w.saturating_sub(x)) * 4;
    for row in 0..ih.min(h.saturating_sub(y)) {
        let to = ((y + row) * w + x) * 4;
        canvas[to..to + n].copy_from_slice(&img[row * iw * 4..row * iw * 4 + n]);
    }
}

/// The largest even size with `doc`'s aspect that fits in `room`, so a film letterboxes.
fn fit(doc: &Value, room: [u16; 2]) -> [u16; 2] {
    let w = doc["size"][0].as_f64().unwrap_or(16.0).max(1.0);
    let h = doc["size"][1].as_f64().unwrap_or(9.0).max(1.0);
    let s = (f64::from(room[0]) / w).min(f64::from(room[1]) / h);
    [((w * s) as u16) & !1, ((h * s) as u16) & !1]
}

/// The viewer keys present mode holds while it runs, which the keymap check names as shadowed.
const SHADOWED: [&str; 13] = [
    " ",
    "ArrowLeft",
    "ArrowRight",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
];

/// How long a notice shows.
const NOTICE_FOR: i64 = 3 * deep_canvas::grammar::FLICKS_PER_SECOND;

/// The notice for a stage number that lies behind: only back goes back.
const BEHIND: &str = "That stage is behind you: press back (←) to go back to it.";

/// The timeline's position at clock `t` in `doc`, through its stops' holds and jumps.
pub(crate) fn position_at(doc: &Value, t: i64) -> i64 {
    doc.as_object()
        .and_then(|d| Program::compile(d).ok())
        .map_or(t, |p| p.position(t).0)
}

impl Hub<'_> {
    /// Present mode while it runs.
    pub(crate) fn presenting(&self) -> Option<&Presenting> {
        self.present.as_ref().filter(|p| p.ended.is_none())
    }

    /// The display present mode shows a piece on, from when, until when (`i64::MAX` while it runs).
    pub(crate) fn present_span(&self) -> Option<(&str, i64, i64)> {
        self.present
            .as_ref()
            .map(|p| (p.display.as_str(), p.since, p.ended.unwrap_or(i64::MAX)))
    }

    /// The played form's present-mode field for `doc`: `{until}`, null while it runs.
    pub(crate) fn present_field(&self, doc: &str) -> Option<Value> {
        self.present
            .as_ref()
            .filter(|p| p.doc == doc)
            .map(|p| json!({"until": p.ended}))
    }

    /// A pop-out full screen onto `display` puts a piece with stage markers or a stages control
    /// in present mode.
    pub(crate) fn start_present(&mut self, panel: &str, display: &str) {
        let Some(doc) = self.panel_doc(panel) else {
            return;
        };
        let Some(form) = self.forms.get(&doc) else {
            return;
        };
        let markers = form
            .get("markers")
            .and_then(Value::as_object)
            .is_some_and(|m| m.values().any(|m| m["kind"] == "stage"));
        let stages = form
            .get("controls")
            .and_then(Value::as_object)
            .is_some_and(|c| c.values().any(|c| c["kind"] == "stages"));
        if !(markers || stages) {
            return;
        }
        self.present = Some(Presenting {
            doc,
            panel: panel.to_string(),
            display: display.to_string(),
            since: self.now,
            ended: None,
            blank: false,
            digits: String::new(),
            notice: None,
            notice_at: 0,
            presenter: None,
        });
    }

    /// The path of the piece present mode shows, as its session plays it.
    fn present_path(&self) -> Option<Path> {
        let p = self.present.as_ref()?;
        Some(path_of(&self.played_form(&p.doc)?))
    }

    /// One present-mode entry on the piece's input track, stamped with the clock, and the
    /// session replayed; the entry as the input track writes it.
    fn present_entry(&mut self, value: Value, serial: u64) -> Value {
        let (doc, now) = (
            self.present
                .as_ref()
                .map(|p| p.doc.clone())
                .unwrap_or_default(),
            self.now,
        );
        let entry = Entry {
            t: now,
            seq: 0,
            control: String::new(),
            value,
            samples: None,
            writer: Writer::You,
            serial: Some(serial as u32),
        };
        let track = self.tracks.entry(doc.clone()).or_default();
        track.append(entry);
        let written = track
            .entries()
            .last()
            .map(Entry::to_json)
            .unwrap_or(Value::Null);
        self.replay(&doc, now);
        written
    }

    /// A key while present mode shows the piece in `panel`: present mode's meaning wins over the
    /// film viewer's and a control's (Marker: present mode); `None` for a key it doesn't hold.
    pub(crate) fn present_key(&mut self, panel: &str, event: &Event, serial: u64) -> Option<Value> {
        let Event::Key {
            key,
            cmd: false,
            alt: false,
        } = event
        else {
            return None;
        };
        if self.presenting().is_none_or(|p| p.panel != panel) {
            return None;
        }
        let reply =
            |appended: Vec<Value>| json!({"serial": serial, "appended": appended, "present": true});
        let entry = match key.as_str() {
            "ArrowRight" | " " | "PageDown" => json!("advance"),
            "ArrowLeft" | "PageUp" => json!("back"),
            "b" | "B" => {
                let p = self.present.as_mut()?;
                p.blank = !p.blank;
                json!("blank")
            }
            "P" => {
                self.present.as_mut()?.presenter.get_or_insert(self.now);
                return Some(reply(Vec::new()));
            }
            "Escape" => {
                let now = self.now;
                self.present.as_mut()?.ended = Some(now);
                let doc = self.present.as_ref()?.doc.clone();
                self.replay(&doc, now);
                return Some(reply(Vec::new()));
            }
            k if k.len() == 1 && k.as_bytes()[0].is_ascii_digit() => {
                self.present.as_mut()?.digits.push_str(k);
                return Some(reply(Vec::new()));
            }
            "Return" | "Enter" => {
                let digits = std::mem::take(&mut self.present.as_mut()?.digits);
                let path = self.present_path()?;
                let now = path.at(self.now);
                let wanted = digits.parse::<usize>().ok();
                let stop = wanted.and_then(|n| path.stops.iter().find(|s| s.stage == Some(n)));
                match stop {
                    Some(s) if path.stage_ahead(&s.marker, now).is_some() => {
                        json!({"goto": s.marker})
                    }
                    Some(_) => {
                        let now = self.now;
                        let p = self.present.as_mut()?;
                        (p.notice, p.notice_at) = (Some(BEHIND.to_string()), now);
                        return Some(reply(Vec::new()));
                    }
                    None => return Some(reply(Vec::new())),
                }
            }
            _ => return None,
        };
        self.present.as_mut()?.notice = None;
        let written = self.present_entry(entry, serial);
        Some(reply(vec![written]))
    }

    /// The stage at clock `t` on `path`, with its number.
    fn stage_of(path: &Path, t: i64) -> Option<&Stop> {
        let n = path.stage_at(t)?;
        path.stops.iter().find(|s| s.stage == Some(n))
    }

    pub(crate) fn present_call(&mut self, call: &PresentCall) -> Value {
        match call {
            PresentCall::State { panel, pixels } => {
                let Some(p) = self.present.as_ref().filter(|p| p.panel == *panel) else {
                    return json!({"present": {"on": false, "display": null, "stage": null, "number": null, "blank": false, "notice": null}});
                };
                let on = p.ended.is_none();
                let (display, blank, notice) = (p.display.clone(), p.blank, self.notice_now());
                let path = self.present_path().unwrap_or_default();
                let stage = Self::stage_of(&path, self.now);
                let mut out = json!({"present": {"on": on, "display": display, "stage": stage.map(|s| s.marker.clone()), "number": stage.and_then(|s| s.stage),
                    "blank": on && blank, "notice": notice}});
                if let Some(size) = pixels {
                    out["present"]["picture"] = self.presented_picture(*size);
                }
                out
            }
            PresentCall::Presenter { pixels } => self.presenter_view(*pixels),
            PresentCall::MenuBar => {
                // The asks open now: the card's, from its creation until it's answered.
                let open = self.card_json().is_some_and(|c| c.answer.is_none());
                json!({"count": u64::from(open)})
            }
        }
    }

    /// The presenter view: on the display present mode doesn't show the piece on, the held
    /// stage's notes, the next stage's first frame (hashed as the export hashes frames), the stage
    /// number and name and the time since present mode began; never an ask.
    fn presenter_view(&mut self, pixels: Option<[u16; 2]>) -> Value {
        let Some(p) = self.presenting() else {
            return json!({"presenter": null});
        };
        if p.presenter.is_none() {
            return json!({"presenter": null});
        }
        let (doc, shown_on, since, blank) = (p.doc.clone(), p.display.clone(), p.since, p.blank);
        let display = self
            .placement
            .display_uuids()
            .into_iter()
            .find(|d| *d != shown_on);
        let path = self.present_path().unwrap_or_default();
        let Some(stage) = Self::stage_of(&path, self.now).cloned() else {
            return json!({"presenter": null});
        };
        let next = path
            .stops
            .iter()
            .find(|s| s.stage.is_some() && s.stage > stage.stage)
            .cloned();
        let current = self.current_doc(&doc).ok();
        let hash = match (&next, &current) {
            (Some(n), Some(d)) => self
                .frame_hashes(d, &[n.at])
                .ok()
                .and_then(|h| h.into_iter().next()),
            _ => None,
        };
        let mut out = json!({"presenter": {"display": display, "stage": stage.marker, "number": stage.stage, "name": stage.name, "notes": stage.notes,
            "next": next.as_ref().map(|n| json!({"stage": n.marker, "hash": hash})), "elapsed": self.now - since,
            "blank": blank, "notice": self.notice_now()}});
        if let (Some(size), Some(d)) = (pixels, &current) {
            let stages = path.stops.iter().filter(|s| s.stage.is_some()).count();
            out["presenter"]["picture"] =
                self.presenter_picture(&out["presenter"], stages, next.as_ref(), d, size);
        }
        out
    }

    /// The card as it stands, with `deadline_at`: the clock its default applies at, counted
    /// from the ask's creation, or, for an ask present mode kept unpresented, from present mode's
    /// end; null while it hasn't started.
    pub(crate) fn card_reply(&self) -> Value {
        let Some(card) = self.card_json() else {
            return Value::Null;
        };
        let mut out = card.to_json();
        let (deadline, asked) = match self.scenario.card.as_ref() {
            Some(crate::hub::Card {
                deadline,
                slot: crate::hub::Slot::Placed { at, .. },
                ..
            }) => (*deadline, *at),
            _ => (None, 0),
        };
        let others = self.placement.display_uuids().len() > 1;
        let start = match self.present_span() {
            Some((_, _, until)) if !others && asked < until => (until <= self.now).then_some(until),
            _ => Some(asked),
        };
        out["deadline_at"] = match (deadline, start) {
            (Some(d), Some(s)) => json!(s + d),
            _ => Value::Null,
        };
        out
    }

    /// `doc`'s frame at clock `t`, drawn at `size` as an export draws it, from a fresh session.
    fn frame_at(&mut self, doc: &Value, t: i64, size: [u16; 2]) -> Option<(Vec<u8>, [u16; 2])> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session = self.new_session();
        session.load(&mut sched, doc);
        self.export_frame(&mut sched, &mut session, doc, t, Some(size), true)
            .ok()
    }

    /// RGBA rows stored as a PNG in the evidence store, as a snapshot names them.
    fn stored_picture(&self, rgba: Vec<u8>, size: [u16; 2]) -> Value {
        self.put_png(rgba, size).map_or(
            Value::Null,
            |sha| json!({"sha256": sha, "w": size[0], "h": size[1]}),
        )
    }

    /// The notice present mode shows now: one set in the last [`NOTICE_FOR`].
    fn notice_now(&self) -> Option<String> {
        let p = self.present.as_ref()?;
        p.notice
            .clone()
            .filter(|_| self.now < p.notice_at + NOTICE_FOR)
    }

    /// `items` laid out by the canvas on a board `points` wide and tall, drawn at `size` pixels.
    fn board_rgba(
        &mut self,
        id: &str,
        items: Vec<Value>,
        points: [f64; 2],
        size: [u16; 2],
    ) -> Option<(Vec<u8>, [u16; 2])> {
        let items: Map<String, Value> = items
            .into_iter()
            .map(|i| (i["id"].as_str().unwrap_or_default().to_string(), i))
            .collect();
        let board = json!({"format": 1, "id": id, "profile": "board", "title": "Present mode",
            "description": "What present mode draws for the presenter.", "size": points, "items": items});
        let writer = deep_canvas::show::Writer {
            kind: deep_canvas::show::WriterKind::Shell,
            id: "presenter".into(),
        };
        let stamped = deep_canvas::show::stamp(board, id, &writer, "Present mode").ok()?;
        let (form, _) = self.drawing_form(&stamped);
        let session = self.evaluated(&form, 0);
        let painted = crate::frames::drawing_of(&self.sched, &session)?;
        let (rgba, _, size) = self.canonical_rgba(&painted, Some(size), true).ok()?;
        Some((rgba, size))
    }

    /// What present mode shows on its display now, `size` pixels: the piece at the clock,
    /// letterboxed in black, or black while blanked; with no presenter view open, a notice shows
    /// in a band along its foot for [`NOTICE_FOR`].
    fn presented_picture(&mut self, size: [u16; 2]) -> Value {
        let Some(p) = self.present.as_ref() else {
            return Value::Null;
        };
        let (doc, blank) = (p.doc.clone(), p.blank && p.ended.is_none());
        let mut out = filled(size, [0, 0, 0, 255]);
        if !blank {
            let Some(form) = self.played_form(&doc) else {
                return Value::Null;
            };
            let now = self.now;
            if let Some((rgba, at)) = self.frame_at(&form, now, fit(&form, size)) {
                let (x, y) = ((size[0] - at[0]) / 2, (size[1] - at[1]) / 2);
                paste(&mut out, size, &rgba, at, usize::from(x), usize::from(y));
            }
        }
        let open = self.present.as_ref().is_some_and(|p| p.presenter.is_some());
        if let (Some(words), false) = (self.notice_now(), open) {
            let w = f64::from(size[0]) / 2.0;
            let band = [size[0], size[1] / 12];
            let items = vec![
                json!({"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0", "params": {"box": [0, 0, w, f64::from(band[1]) / 2.0], "paint": {"fill": {"role": "ground"}}}}),
                json!({"id": "notice", "kind": "text@1", "name": "Notice", "order": "a1", "at": {"pos": [24, 12, 0]},
                    "params": {"text": words, "font": "body", "size": 20, "box": {"w": w - 48.0, "h": 30}, "align": "start"}}),
            ];
            if let Some((rgba, at)) =
                self.board_rgba("present-notice", items, [w, f64::from(band[1]) / 2.0], band)
            {
                paste(&mut out, size, &rgba, at, 0, usize::from(size[1] - at[1]));
            }
        }
        self.stored_picture(out, size)
    }

    /// The presenter view drawn at `size` pixels (points at 2×): its stage's number and name, the
    /// elapsed time and the notes as text the canvas lays out, and the next stage's first frame,
    /// framed, beside them. Nothing of an ask is in it.
    fn presenter_picture(
        &mut self,
        view: &Value,
        stages: usize,
        next: Option<&Stop>,
        doc: &Value,
        size: [u16; 2],
    ) -> Value {
        let (w, h) = (f64::from(size[0]) / 2.0, f64::from(size[1]) / 2.0);
        let column = w * 0.45;
        // Names, not readings: the digits a stage's number and the clock show are its labels.
        let text = |id: &str, words: String, pt: f64, x: f64, y: f64, lines: f64| {
            json!({"id": id, "kind": "text@1", "name": id, "order": format!("a{id}"), "at": {"pos": [x, y, 0]},
                "params": {"text": words, "name": true, "font": "body", "size": pt, "box": {"w": column, "h": pt * 1.5 * lines}, "align": "start"}})
        };
        let number = view["number"].as_u64().unwrap_or(0);
        let seconds = view["elapsed"].as_i64().unwrap_or(0) as f64
            / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        let mut items = vec![
            json!({"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0", "params": {"box": [0, 0, w, h], "paint": {"fill": {"role": "ground"}}}}),
            text(
                "number",
                format!("Stage {number} of {stages}"),
                22.0,
                48.0,
                48.0,
                1.0,
            ),
            text(
                "title",
                view["name"].as_str().unwrap_or_default().to_string(),
                44.0,
                48.0,
                88.0,
                1.0,
            ),
            text(
                "elapsed",
                format!("Elapsed {seconds:.1} s"),
                22.0,
                48.0,
                168.0,
                1.0,
            ),
        ];
        // What the presenter must know of the room, a line of two each: a blanked display, and
        // a notice. The notes go below them.
        let mut y = 204.0;
        if view["blank"] == true {
            let words = "Blank: the room sees black. Press B to show the stage.".to_string();
            items.push(text("blanked", words, 18.0, 48.0, y, 2.0));
            y += 56.0;
        }
        if let Some(words) = view["notice"].as_str() {
            items.push(text("notice", words.to_string(), 18.0, 48.0, y, 2.0));
            y += 56.0;
        }
        let y = y.max(248.0);
        items.push(text("notes_label", "Notes".to_string(), 18.0, 48.0, y, 1.0));
        let notes = view["notes"].as_str().unwrap_or_default().to_string();
        items.push(text("notes", notes, 28.0, 48.0, y + 32.0, 8.0));
        if let Some(n) = next {
            let label = format!("Next: stage {}, {}", n.stage.unwrap_or(0), n.name);
            items.push(text("next_label", label, 18.0, w * 0.52, 248.0, 1.0));
        }
        let Some((mut rgba, size)) = self.board_rgba("presenter-view", items, [w, h], size) else {
            return Value::Null;
        };
        if let Some(n) = next {
            let room = [
                (f64::from(size[0]) * 0.45) as u16,
                (f64::from(size[1]) * 0.45) as u16,
            ];
            if let Some((frame, at)) = self.frame_at(doc, n.at, fit(doc, room)) {
                let (x, y) = (
                    (f64::from(size[0]) * 0.52) as usize,
                    (f64::from(size[1]) * 0.3) as usize,
                );
                let border = [at[0] + 8, at[1] + 8];
                paste(
                    &mut rgba,
                    size,
                    &filled(border, [120, 120, 128, 255]),
                    border,
                    x - 4,
                    y - 4,
                );
                paste(&mut rgba, size, &frame, at, x, y);
            }
        }
        self.stored_picture(rgba, size)
    }

    /// The keymap check's present-mode rows: each film-viewer key present mode holds while it
    /// runs, as shadowed on the piece it shows.
    pub(crate) fn present_conflicts(&self) -> Vec<Value> {
        let Some(p) = self.presenting() else {
            return Vec::new();
        };
        SHADOWED
            .iter()
            .map(|k| json!({"chord": if *k == " " { "space".to_string() } else { k.to_lowercase() }, "context": "film_viewer", "doc": p.doc, "by": "present_mode"}))
            .collect()
    }

    /// What the shell draws over the piece in each of a panel's presented frames, on its display:
    /// the card, a toast, the presenter view and its notes.
    pub(crate) fn mark_over(&self, frames: &mut [Value]) {
        let card = self.card_json();
        let presenter = self
            .present
            .as_ref()
            .and_then(|p| Some((p.presenter?, p.ended.unwrap_or(i64::MAX), p.display.clone())));
        let other = presenter.as_ref().and_then(|(_, _, shown_on)| {
            self.placement
                .display_uuids()
                .into_iter()
                .find(|d| d != shown_on)
        });
        for f in frames {
            let (Some(at), Some(display)) = (
                f["vsync"].as_i64(),
                f["display"].as_str().map(str::to_string),
            ) else {
                f["over"] = json!([]);
                continue;
            };
            let mut over = Vec::new();
            if let Some(c) = &card {
                let shown = c.states.first().is_some_and(|(_, from)| *from <= at)
                    && c.answer.as_ref().is_none_or(|(_, t)| at < *t);
                if shown && c.display == display {
                    over.push("card");
                }
            }
            if self.toast_on(&display, at) {
                over.push("toast");
            }
            if let (Some((from, until, _)), Some(o)) = (&presenter, &other) {
                if *o == display && *from <= at && at < *until {
                    over.extend(["presenter", "notes"]);
                }
            }
            f["over"] = json!(over);
        }
    }
}
