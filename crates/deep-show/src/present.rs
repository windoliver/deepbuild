//! #507 (canvas primitives: Marker: present mode): what the hub reads of the timeline's path.
//! The motion program folds the clock and the input track into the position the document reads;
//! here the mix, the film audit and the export follow it. Sound is mapped onto the clock before
//! the mix is built: a strip that holds with the timeline becomes one strip per stretch the
//! position runs through it, and a strip marked `at_stage: play` (by default one that loops) runs
//! on the clock from where the position enters its span to where it leaves. The player reads
//! strips as pure functions of the clock, so a seek still renders what playing did.

use std::collections::BTreeSet;

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
    /// When Shift+P opened the presenter view.
    presenter: Option<i64>,
}

/// The shell's present-mode calls.
pub(crate) enum PresentCall {
    /// `present {panel}`: what present mode shows on the panel's display.
    State(String),
    /// `presenter`: what the presenter view shows.
    Presenter,
    /// `menu_bar`: the menu bar's count of asks.
    MenuBar,
}

pub(crate) fn parse_call(name: &str, c: &Map<String, Value>) -> Option<PresentCall> {
    match name {
        "present" => Some(PresentCall::State(c.get("panel")?.as_str()?.to_string())),
        "presenter" => Some(PresentCall::Presenter),
        "menu_bar" => Some(PresentCall::MenuBar),
        _ => None,
    }
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
                        self.present.as_mut()?.notice = Some(BEHIND.to_string());
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
            PresentCall::State(panel) => {
                let Some(p) = self.present.as_ref().filter(|p| p.panel == *panel) else {
                    return json!({"present": {"on": false, "display": null, "stage": null, "number": null, "blank": false, "notice": null}});
                };
                let on = p.ended.is_none();
                let (display, blank, notice) = (p.display.clone(), p.blank, p.notice.clone());
                let path = self.present_path().unwrap_or_default();
                let stage = Self::stage_of(&path, self.now);
                json!({"present": {"on": on, "display": display, "stage": stage.map(|s| s.marker.clone()), "number": stage.and_then(|s| s.stage),
                    "blank": on && blank, "notice": notice}})
            }
            PresentCall::Presenter => self.presenter_view(),
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
    fn presenter_view(&mut self) -> Value {
        let Some(p) = self.presenting() else {
            return json!({"presenter": null});
        };
        if p.presenter.is_none() {
            return json!({"presenter": null});
        }
        let (doc, shown_on, since) = (p.doc.clone(), p.display.clone(), p.since);
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
        let hash = match (&next, self.current_doc(&doc)) {
            (Some(n), Ok(d)) => self
                .frame_hashes(&d, &[n.at])
                .ok()
                .and_then(|h| h.into_iter().next()),
            _ => None,
        };
        json!({"presenter": {"display": display, "stage": stage.marker, "number": stage.stage, "name": stage.name, "notes": stage.notes,
            "next": next.map(|n| json!({"stage": n.marker, "hash": hash})), "elapsed": self.now - since}})
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
