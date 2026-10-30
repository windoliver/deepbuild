//! Issue #401: panels in the trusted ring (technical design: Panels and devices; canvas
//! primitives: Input router, focus and gesture serial; Bound value). A plug-in installs panels,
//! the recorded behaviour of their scripts, its sources, actions and keymap. A script's ops run
//! on the scenario's clock, and the ring decides each one:
//!
//! - its own fetch or program is refused, since a panel's policy is empty; a read of a source it
//!   declared goes through the hub, which makes the call, keeps the as-of time of the call that
//!   answered, and makes no reading from a call that failed;
//! - focus, a pop-out, a clipboard write, a toast and a placement need a fresh serial of your
//!   press in that panel, under 30 s old (the token's `expires ≤ 30 s`), never one from a timer
//!   or from your input in another panel;
//! - words into a session need one too, one send per serial; without one they wait as one draft
//!   per panel in the session's box, beside the text you typed;
//! - a keymap is checked at install: no chord sends, spends or answers, the escape chord is the
//!   shell's, and chords two plug-ins bind in one context are reported as a conflict;
//! - a piece you placed stays where you put it, whatever a plug-in or a suggestion asks;
//! - a bound value draws through the canvas's own bound-value text, from the readings latched by
//!   the frame, greyed with its age once past its freshness.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::time::Duration;

use deep_canvas::scope::Event;
use deep_canvas_marks::scene::{bound_text, Record, Shown};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::shared::FLICKS;

/// How long a plug-in's toast stays up; the design names no number.
const TOAST_LIFE: i64 = 4 * FLICKS;
const TOAST: [f64; 2] = [320.0, 64.0];
const TOAST_MARGIN: f64 = 20.0;
/// The escape chord: no plug-in binds it, and a focused panel never takes it from the shell.
const ESCAPE: &str = "escape";
/// A timer's shortest period: 1 ms.
const MIN_EVERY: i64 = FLICKS / 1000;
const SAY_KINDS: [&str; 3] = ["steer", "follow_up", "prompt"];

/// One op a panel's script asks of its host (#401 acceptance README: Script).
#[derive(Clone)]
enum Op {
    Fetch(String),
    Run(Vec<String>),
    Focus,
    PopOut(String),
    Clipboard(String),
    Toast(String),
    Read(String),
    Say {
        session: String,
        kinds: Vec<String>,
        text: String,
    },
    Place {
        piece: String,
        rect: [f64; 4],
    },
}

impl Op {
    fn name(&self) -> &'static str {
        match self {
            Op::Fetch(_) => "fetch",
            Op::Run(_) => "run",
            Op::Focus => "focus",
            Op::PopOut(_) => "pop_out",
            Op::Clipboard(_) => "clipboard",
            Op::Toast(_) => "toast",
            Op::Read(_) => "read",
            Op::Say { .. } => "say",
            Op::Place { .. } => "place",
        }
    }
}

/// Who asks to put a piece somewhere.
pub enum Placer {
    /// Your drag, with the serial of your press in that piece.
    You(u64),
    /// An agent's suggestion.
    Suggestion,
}

/// The calls this issue adds to `deep-show run`.
pub enum RingCall {
    Install {
        plugin: String,
        manifest: Value,
    },
    Attempts(String),
    Focus,
    Clipboard,
    Toasts,
    Place {
        piece: String,
        rect: [f64; 4],
        by: Placer,
    },
    Pieces,
    Drawn(String),
    Reading(String),
    Type {
        session: String,
        text: String,
    },
    Box(String),
    Turns(String),
    Keymap,
}

fn rect4(v: Option<&Value>) -> Option<[f64; 4]> {
    let a = v?.as_array().filter(|a| a.len() == 4)?;
    let r = [
        a[0].as_f64()?,
        a[1].as_f64()?,
        a[2].as_f64()?,
        a[3].as_f64()?,
    ];
    (r.iter().all(|n| n.is_finite()) && r[2] > 0.0 && r[3] > 0.0).then_some(r)
}

/// One of this issue's calls, or `None` for a line that lacks a field it needs.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<RingCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        "install" => RingCall::Install {
            plugin: s("plugin")?,
            manifest: c.get("manifest")?.clone(),
        },
        "attempts" => RingCall::Attempts(s("panel")?),
        "focus" => RingCall::Focus,
        "clipboard" => RingCall::Clipboard,
        "toasts" => RingCall::Toasts,
        "place" => RingCall::Place {
            piece: s("piece")?,
            rect: rect4(c.get("rect"))?,
            by: match (c.get("serial"), c.get("session")) {
                (Some(n), None) => Placer::You(n.as_u64()?),
                (None, Some(v)) => {
                    v.as_str()?;
                    Placer::Suggestion
                }
                _ => return None,
            },
        },
        "pieces" => RingCall::Pieces,
        "drawn" => RingCall::Drawn(s("panel")?),
        "reading" => RingCall::Reading(s("source")?),
        "type" => RingCall::Type {
            session: s("session")?,
            text: s("text")?,
        },
        "box" => RingCall::Box(s("session")?),
        "turns" => RingCall::Turns(s("session")?),
        "keymap" => RingCall::Keymap,
        _ => return None,
    })
}

/// A bound value in a panel's element tree: where it draws, what it binds, and its freshness.
struct Bound {
    element: String,
    bind: Value,
    source: String,
    stale_after: i64,
}

struct PanelDef {
    plugin: String,
    bound: Vec<Bound>,
    /// The terminals whose cell grids the panel shows (#402).
    terminals: Vec<String>,
    on_read_failed: Vec<Op>,
    raw_input: bool,
}

struct Timer {
    panel: String,
    next: i64,
    every: i64,
    until: Option<i64>,
    ops: Vec<Op>,
}

#[derive(Clone)]
enum Answer {
    Value(f64, String),
    Fails,
}

struct Source {
    plugin: String,
    replay: Vec<Answer>,
    then: Option<Answer>,
    /// Each call the hub made: when, and whether it was answered.
    calls: Vec<(i64, bool)>,
}

#[derive(Clone)]
struct Reading {
    value: f64,
    unit: String,
    as_of: i64,
}

struct Binding {
    plugin: String,
    chord: String,
    context: String,
    command: Value,
}

struct Piece {
    rect: [f64; 4],
    by: &'static str,
}

struct Toast {
    plugin: String,
    text: String,
    display: String,
    rect: [f64; 4],
    made: i64,
}

#[derive(Default)]
struct SessionBox {
    typed: String,
    /// One draft per panel, in the order first made.
    drafts: Vec<Value>,
}

/// The ring's state while a scenario runs.
#[derive(Default)]
pub struct Ring {
    plugins: Vec<String>,
    panels: BTreeMap<String, PanelDef>,
    timers: Vec<Timer>,
    sources: BTreeMap<String, Source>,
    /// Each source's readings, each with the time the hub made it.
    readings: BTreeMap<String, Vec<(i64, Reading)>>,
    /// The serials sends spent, one each.
    spent: std::collections::BTreeSet<u64>,
    /// How many sends each panel made, for the kind each next one takes.
    sends: BTreeMap<String, usize>,
    attempts: BTreeMap<String, Vec<Value>>,
    kb_focus: Option<String>,
    clipboard: Option<Value>,
    toasts: Vec<Toast>,
    pieces: BTreeMap<String, Piece>,
    turns: BTreeMap<String, Vec<Value>>,
    boxes: BTreeMap<String, SessionBox>,
    bindings: Vec<Binding>,
}

impl Ring {
    /// The ring over the scenario's panels, each a piece in its slot.
    pub fn new(slots: impl Iterator<Item = (String, [f64; 4])>) -> Ring {
        Ring {
            pieces: slots
                .map(|(id, rect)| {
                    (
                        id,
                        Piece {
                            rect,
                            by: "default",
                        },
                    )
                })
                .collect(),
            ..Ring::default()
        }
    }

    /// Where a key sent to `named` goes. While a plug-in's panel holds keyboard focus, keys are
    /// its when it asked for raw input, and the shell's otherwise; the escape chord is always
    /// the shell's (unless planted). Otherwise the core's own views, which the shell draws, take
    /// the keys sent to them, Esc included. `None` is the shell.
    pub fn key_to<'a>(
        &'a self,
        named: &'a str,
        escape: bool,
        takes_escape: bool,
    ) -> Option<&'a str> {
        match self
            .kb_focus
            .as_deref()
            .and_then(|f| Some((f, self.panels.get(f)?)))
        {
            Some(_) if escape && !takes_escape => None,
            Some((f, d)) => d.raw_input.then_some(f),
            None => (!self.owns(named)).then_some(named),
        }
    }

    /// Whether a plug-in's panel shows `terminal`'s cell grid (#402).
    pub fn terminal_panel(&self, panel: &str, terminal: &str) -> bool {
        self.panels
            .get(panel)
            .is_some_and(|d| d.terminals.iter().any(|t| t == terminal))
    }

    /// Whether a plug-in's install claimed the panel.
    pub fn owns(&self, panel: &str) -> bool {
        self.panels.contains_key(panel)
    }

    /// Your press moved keyboard focus to `panel`, a plug-in's or not.
    pub fn focus(&mut self, panel: &str) {
        self.kb_focus = Some(panel.to_string());
    }

    /// Where the piece is laid out in the main window: its slot until something placed it.
    pub fn rect_of(&self, piece: &str) -> Option<[f64; 4]> {
        self.pieces.get(piece).map(|p| p.rect)
    }

    /// The source's reading the hub had made by `t`.
    fn reading_at(&self, source: &str, t: i64) -> Option<&Reading> {
        self.readings
            .get(source)?
            .iter()
            .rev()
            .find(|(made, _)| *made <= t)
            .map(|(_, r)| r)
    }

    /// One call to a source, at `now`: the n-th gets its n-th recorded answer, later ones the
    /// `then` answer or the last again. A failed call makes no reading; the planted refresh
    /// serves the cached one again with the call's time as its as-of.
    fn call_source(&mut self, id: &str, now: i64, restamp: bool) -> bool {
        let Some(s) = self.sources.get_mut(id) else {
            return false;
        };
        let answer = s
            .replay
            .get(s.calls.len())
            .or(s.then.as_ref())
            .or(s.replay.last())
            .cloned()
            .unwrap_or(Answer::Fails);
        let made = self.readings.entry(id.to_string()).or_default();
        match answer {
            Answer::Value(value, unit) => {
                s.calls.push((now, true));
                made.push((
                    now,
                    Reading {
                        value,
                        unit,
                        as_of: now,
                    },
                ));
                true
            }
            Answer::Fails => {
                s.calls.push((now, false));
                if let Some((_, cached)) = made.last().filter(|_| restamp).cloned() {
                    made.push((
                        now,
                        Reading {
                            as_of: now,
                            ..cached
                        },
                    ));
                }
                false
            }
        }
    }

    /// Puts a piece at `rect`; a piece you placed moves only by you.
    fn place(&mut self, piece: &str, rect: [f64; 4], by: &'static str, moves_yours: bool) -> Value {
        let Some(p) = self.pieces.get_mut(piece) else {
            return json!({"code": "unknown_piece"});
        };
        if p.by == "you" && by != "you" && !moves_yours {
            return json!({"code": "placed_by_you", "piece": piece});
        }
        p.rect = rect;
        p.by = by;
        json!({"piece": {"piece": piece, "rect": rect, "placed_by": by}})
    }

    /// Chords two or more plug-ins bind in one context.
    fn conflicts(&self) -> Vec<Value> {
        let mut by: BTreeMap<(&str, &str), Vec<&str>> = BTreeMap::new();
        for b in &self.bindings {
            let plugins = by.entry((&b.chord, &b.context)).or_default();
            if !plugins.contains(&b.plugin.as_str()) {
                plugins.push(&b.plugin);
            }
        }
        by.into_iter()
            .filter(|(_, p)| p.len() > 1)
            .map(|((chord, context), plugins)| {
                json!({"chord": chord, "context": context, "plugins": plugins})
            })
            .collect()
    }
}

/// A chord in one spelling: its modifiers in a fixed order, then its key; `esc` is `escape`.
fn canonical_chord(chord: &str) -> Option<String> {
    const MODS: [&str; 4] = ["cmd", "ctrl", "alt", "shift"];
    let parts: Vec<String> = chord
        .split('+')
        .map(|p| p.trim().to_lowercase())
        .map(|p| match p.as_str() {
            "command" | "meta" | "super" | "⌘" => "cmd".to_string(),
            "control" | "⌃" => "ctrl".to_string(),
            "option" | "opt" | "⌥" => "alt".to_string(),
            "⇧" => "shift".to_string(),
            "esc" => ESCAPE.to_string(),
            _ => p,
        })
        .collect();
    let (key, mods) = parts.split_last()?;
    if key.is_empty()
        || MODS.contains(&key.as_str())
        || mods.iter().any(|m| !MODS.contains(&m.as_str()))
    {
        return None;
    }
    let mut out: Vec<&str> = MODS
        .iter()
        .copied()
        .filter(|m| mods.iter().any(|x| x == m))
        .collect();
    if out.len() != mods.len() {
        return None;
    }
    out.push(key);
    Some(out.join("+"))
}

/// A duration in flicks as a seconds literal the canvas's time grammar reads (up to five
/// fraction digits).
fn seconds_literal(flicks: i64) -> Option<String> {
    if flicks <= 0 || (flicks % FLICKS) * 100_000 % FLICKS != 0 {
        return None;
    }
    let frac = format!("{:05}", (flicks % FLICKS) * 100_000 / FLICKS);
    let frac = frac.trim_end_matches('0');
    Some(match frac {
        "" => format!("{}s", flicks / FLICKS),
        f => format!("{}.{f}s", flicks / FLICKS),
    })
}

/// A bound value as a frame pinned at `pinned` draws it, through the canvas's own bound-value
/// text (Bound value: stale once past its freshness, greyed with its age).
fn draw(b: &Bound, reading: Option<&Reading>, pinned: i64) -> Option<Shown> {
    let handle = format!("reading:{}", b.source);
    let mut bound = Map::new();
    bound.insert("target".into(), json!("items/v/params/text"));
    bound.insert("source".into(), json!(handle));
    for k in ["format", "missing"] {
        if let Some(v) = b.bind.get(k) {
            bound.insert(k.into(), v.clone());
        }
    }
    bound.insert("stale_after".into(), json!(seconds_literal(b.stale_after)?));
    let mut doc = Map::new();
    doc.insert("bound_values".into(), json!({ "v": bound }));
    let mut record = Record {
        pinned,
        ..Record::default()
    };
    if let Some(r) = reading {
        record.readings.insert(handle.clone(), r.value);
        record.as_of.insert(handle, r.as_of);
    }
    bound_text(&doc, "v", &json!({}), &record, "en").ok()?
}

fn op(v: &Value) -> Option<Op> {
    let s = |k: &str| Some(v.get(k)?.as_str()?.to_string());
    Some(match v.get("op")?.as_str()? {
        "fetch" => Op::Fetch(s("url")?),
        "run" => Op::Run(
            v.get("argv")?
                .as_array()?
                .iter()
                .map(|a| a.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .filter(|a| !a.is_empty())?,
        ),
        "focus" => Op::Focus,
        "pop_out" => Op::PopOut(s("display")?),
        "clipboard" => Op::Clipboard(s("text")?),
        "toast" => Op::Toast(s("text")?),
        "read" => Op::Read(s("source")?),
        "say" => Op::Say {
            session: s("session")?,
            kinds: v
                .get("kinds")?
                .as_array()?
                .iter()
                .map(|k| {
                    k.as_str()
                        .filter(|k| SAY_KINDS.contains(k))
                        .map(str::to_string)
                })
                .collect::<Option<Vec<_>>>()
                .filter(|k| !k.is_empty())?,
            text: s("text")?,
        },
        "place" => Op::Place {
            piece: s("piece")?,
            rect: rect4(v.get("rect"))?,
        },
        _ => return None,
    })
}

fn ops(v: Option<&Value>) -> Option<Vec<Op>> {
    match v {
        None => Some(Vec::new()),
        Some(list) => list.as_array()?.iter().map(op).collect(),
    }
}

/// Why an install is refused: a code, and the chord or path it names.
fn refusal(code: &str, names: (&str, &str)) -> Value {
    let mut r = json!({"installed": false, "code": code});
    r[names.0] = json!(names.1);
    r
}

fn bad(path: &str) -> Value {
    refusal("bad_manifest", ("path", path))
}

/// The check every binding of a keymap passes at install, or the refusal naming its chord: no
/// chord sends, spends or answers an ask, and the escape chord is the shell's.
fn check_binding(
    chord: &str,
    command: &Value,
    actions: &BTreeMap<String, String>,
) -> Result<(), Value> {
    let refuse = |code: &str| Err(refusal(code, ("chord", chord)));
    // The escape chord is the shell's, with any modifier.
    if chord.rsplit('+').next() == Some(ESCAPE) {
        return refuse("escape_chord");
    }
    match (
        command.get("action").and_then(Value::as_str),
        command.get("core").and_then(Value::as_str),
    ) {
        (Some(a), None) => match actions.get(a).map(String::as_str) {
            Some("send") => refuse("binds_send"),
            Some("spend") => refuse("binds_spend"),
            Some(_) => Ok(()),
            None => refuse("unknown_action"),
        },
        (None, Some("session.send")) => refuse("binds_send"),
        (None, Some("ask.answer")) => refuse("binds_answer"),
        _ => refuse("unknown_command"),
    }
}

/// The wrong program `panel_policy_open`: the script's own HTTP fetch, made.
fn fetch(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let (host, path) = match rest.split_once('/') {
        Some((h, p)) => (h, format!("/{p}")),
        None => (rest, "/".to_string()),
    };
    // Even the wrong program reaches only this machine.
    if !host.starts_with("127.0.0.1:") && !host.starts_with("localhost:") {
        return false;
    }
    let Ok(mut stream) = std::net::TcpStream::connect(host) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let request = format!("GET {path} HTTP/1.0\r\nHost: {host}\r\n\r\n");
    stream.write_all(request.as_bytes()).is_ok() && stream.read_to_end(&mut Vec::new()).is_ok()
}

/// The wrong program `panel_policy_open`: the script's own program, run, if it is the Node the
/// tests run under (the only program any scenario names).
fn run_program(argv: &[String]) -> bool {
    let named = std::path::Path::new(&argv[0]);
    if named.file_stem().and_then(|n| n.to_str()) != Some("node") || !named.is_absolute() {
        return false;
    }
    std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .status()
        .is_ok_and(|s| s.success())
}

impl Hub<'_> {
    fn planted_is(&self, p: Planted) -> bool {
        self.scenario.planted == Some(p)
    }

    /// One of this issue's calls.
    pub fn ring_call(&mut self, call: &RingCall) -> Value {
        let now = self.now;
        match call {
            RingCall::Install { plugin, manifest } => self.install(plugin, manifest),
            RingCall::Attempts(panel) => match self.ring.owns(panel) {
                true => {
                    json!({"attempts": self.ring.attempts.get(panel).cloned().unwrap_or_default()})
                }
                false => json!({"code": "unknown_panel"}),
            },
            RingCall::Focus => json!({"kb_focus": self.ring.kb_focus}),
            RingCall::Clipboard => json!({"clipboard": self.ring.clipboard}),
            RingCall::Toasts => {
                let card = self.card_json();
                let showing = card.is_some_and(|c| {
                    matches!(c.states.last(), Some((s, _)) if *s == "presented" || *s == "armed")
                });
                let shown = !showing || self.planted_is(Planted::ToastsIgnoreCard);
                let list: Vec<Value> = self
                    .ring
                    .toasts
                    .iter()
                    .filter(|t| t.made <= now && now < t.made + TOAST_LIFE)
                    .map(|t| {
                        json!({"plugin": t.plugin, "text": t.text, "display": t.display,
                               "rect": t.rect, "shown": shown})
                    })
                    .collect();
                json!({ "toasts": list })
            }
            RingCall::Place { piece, rect, by } => {
                let reply = match by {
                    Placer::You(serial) => {
                        match self.placement.serial_fresh_in(*serial, piece, now) {
                            true => self.ring.place(piece, *rect, "you", false),
                            false => json!({"code": "serial_not_fresh_in_piece"}),
                        }
                    }
                    Placer::Suggestion => {
                        let moves = self.planted_is(Planted::PlacementMovesYours);
                        self.ring.place(piece, *rect, "suggestion", moves)
                    }
                };
                self.lay_out(piece);
                reply
            }
            RingCall::Pieces => {
                let list: Vec<Value> = self
                    .ring
                    .pieces
                    .iter()
                    .map(|(id, p)| json!({"piece": id, "rect": p.rect, "placed_by": p.by}))
                    .collect();
                json!({ "pieces": list })
            }
            RingCall::Drawn(panel) => self.drawn(panel),
            RingCall::Reading(source) => {
                let Some(s) = self.ring.sources.get(source) else {
                    return json!({"code": "unknown_source"});
                };
                let calls: Vec<Value> = s
                    .calls
                    .iter()
                    .filter(|(at, _)| *at <= now)
                    .map(|(at, ok)| json!({"at": at, "outcome": if *ok { "answered" } else { "failed" }}))
                    .collect();
                let reading = self.ring.reading_at(source, now).map(|r| {
                    json!({"value": r.value, "unit": r.unit, "as_of": r.as_of,
                           "source": format!("reading:{source}")})
                });
                json!({"reading": reading, "calls": calls})
            }
            RingCall::Type { session, text } => {
                if !self.scenario.sessions.contains_key(session) {
                    return json!({"code": "unknown_session"});
                }
                self.ring
                    .boxes
                    .entry(session.clone())
                    .or_default()
                    .typed
                    .push_str(text);
                self.box_json(session)
            }
            RingCall::Box(session) => self.box_json(session),
            RingCall::Turns(session) => {
                json!({"turns": self.ring.turns.get(session).cloned().unwrap_or_default()})
            }
            RingCall::Keymap => {
                let bindings: Vec<Value> = self
                    .ring
                    .bindings
                    .iter()
                    .map(|b| {
                        json!({"plugin": b.plugin, "chord": b.chord, "context": b.context,
                               "command": b.command})
                    })
                    .collect();
                json!({"bindings": bindings, "conflicts": self.reported_conflicts()})
            }
        }
    }

    fn reported_conflicts(&self) -> Vec<Value> {
        match self.planted_is(Planted::ConflictsUnreported) {
            true => Vec::new(),
            false => self.ring.conflicts(),
        }
    }

    fn box_json(&self, session: &str) -> Value {
        let b = self.ring.boxes.get(session);
        json!({"box": {"typed": b.map_or("", |b| b.typed.as_str()),
                       "drafts": b.map(|b| b.drafts.clone()).unwrap_or_default()}})
    }

    /// `install`: a plug-in's manifest, checked whole before anything of it is taken.
    fn install(&mut self, plugin: &str, manifest: &Value) -> Value {
        if self.ring.plugins.iter().any(|p| p == plugin) {
            return refusal("already_installed", ("plugin", plugin));
        }
        let Some(m) = manifest.as_object() else {
            return bad("");
        };
        let empty = Map::new();
        let section = |k: &str| match m.get(k) {
            None => Some(&empty),
            Some(v) => v.as_object(),
        };
        let (Some(panels), Some(sources), Some(actions)) =
            (section("panels"), section("sources"), section("actions"))
        else {
            return bad("");
        };
        // Its actions, by kind.
        let mut kinds = BTreeMap::new();
        for (id, a) in actions {
            match a.get("kind").and_then(Value::as_str) {
                Some(k @ ("change" | "send" | "spend")) => kinds.insert(id.clone(), k.to_string()),
                _ => return bad(&format!("actions/{id}")),
            };
        }
        // Its sources, with their recorded answers.
        let answer = |v: &Value| -> Option<Answer> {
            match (v.get("value"), v.get("fails")) {
                (Some(n), None) => Some(Answer::Value(
                    n.as_f64()?,
                    v.get("unit")?.as_str()?.to_string(),
                )),
                (None, Some(f)) => f.as_str().map(|_| Answer::Fails),
                _ => None,
            }
        };
        let mut new_sources = BTreeMap::new();
        let mut fresh_for = BTreeMap::new();
        for (id, s) in sources {
            let parsed = (|| {
                let fresh = s.get("fresh_for")?.as_i64().filter(|f| *f > 0)?;
                let replay = s
                    .get("replay")?
                    .as_array()?
                    .iter()
                    .map(answer)
                    .collect::<Option<Vec<_>>>()?;
                let then = match s.get("then") {
                    None => None,
                    Some(t) => Some(answer(t)?),
                };
                Some((fresh, replay, then))
            })();
            let Some((fresh, replay, then)) = parsed else {
                return bad(&format!("sources/{id}"));
            };
            if self.ring.sources.contains_key(id) {
                return refusal("source_taken", ("path", &format!("sources/{id}")));
            }
            fresh_for.insert(id.clone(), fresh);
            new_sources.insert(
                id.clone(),
                Source {
                    plugin: plugin.to_string(),
                    replay,
                    then,
                    calls: Vec::new(),
                },
            );
        }
        // Its keymap: each binding checked, unless planted.
        let mut bindings = Vec::new();
        if let Some(list) = m.get("keymap") {
            let Some(list) = list.as_array() else {
                return bad("keymap");
            };
            for (i, b) in list.iter().enumerate() {
                let (Some(chord), Some(context), Some(command)) = (
                    b.get("chord").and_then(Value::as_str),
                    b.get("context").and_then(Value::as_str),
                    b.get("command").filter(|c| c.is_object()),
                ) else {
                    return bad(&format!("keymap/{i}"));
                };
                let written = chord;
                let Some(chord) = canonical_chord(written) else {
                    return bad(&format!("keymap/{i}/chord"));
                };
                if !self.planted_is(Planted::KeymapUnchecked) {
                    // Judged in its one spelling; the refusal names it as the plug-in wrote it.
                    if let Err(mut refused) = check_binding(&chord, command, &kinds) {
                        refused["chord"] = json!(written);
                        return refused;
                    }
                }
                bindings.push(Binding {
                    plugin: plugin.to_string(),
                    chord,
                    context: context.to_string(),
                    command: command.clone(),
                });
            }
        }
        // Its panels: each claims a slot, with its bound values and its script.
        let mut defs = BTreeMap::new();
        let mut timers = Vec::new();
        for (id, p) in panels {
            // A panel takes the scenario's slot of its ID when there is one; one with none is
            // installed and laid out nowhere.
            if self.ring.owns(id) || self.panel_doc(id).is_some() {
                return refusal("panel_unavailable", ("path", &format!("panels/{id}")));
            }
            let Some(def) = self.panel_def(plugin, p, &fresh_for) else {
                return bad(&format!("panels/{id}"));
            };
            let Some(script) = (match p.get("script") {
                None => Some(Vec::new()),
                Some(s) => self.timers(id, s),
            }) else {
                return bad(&format!("panels/{id}/script"));
            };
            // Timers run on the scenario's clock; without one they would never fire.
            if !script.is_empty() && self.scenario.clock.is_none() {
                return refusal("no_clock", ("path", &format!("panels/{id}/script")));
            }
            timers.extend(script);
            defs.insert(id.clone(), def);
        }
        self.ring.plugins.push(plugin.to_string());
        self.ring.sources.extend(new_sources);
        self.ring.bindings.extend(bindings);
        self.ring.panels.extend(defs);
        self.ring.timers.extend(timers);
        json!({"installed": true, "plugin": plugin, "conflicts": self.reported_conflicts()})
    }

    /// A panel's element tree read for its bound values, each drawn once to check it.
    fn panel_def(
        &self,
        plugin: &str,
        p: &Value,
        fresh_for: &BTreeMap<String, i64>,
    ) -> Option<PanelDef> {
        let mut found: Vec<(String, &Value)> = Vec::new();
        let mut terminals = Vec::new();
        for e in p.get("tree")?.as_array()? {
            let eid = e.get("id")?.as_str()?;
            match e.get("component")?.as_str()? {
                "text" => found.extend(e.get("bind").map(|b| (eid.to_string(), b))),
                "sheet" => {
                    for cell in e.get("cells")?.as_array()? {
                        let cid = cell.get("id")?.as_str()?;
                        found.extend(cell.get("bind").map(|b| (format!("{eid}/{cid}"), b)));
                    }
                }
                "chart" => found.push((format!("{eid}/label"), e.get("label")?.get("bind")?)),
                // #402: the panel shows a terminal's cell grid.
                "cells" => terminals.push(e.get("terminal")?.as_str()?.to_string()),
                _ => return None,
            }
        }
        let mut bound = Vec::new();
        for (element, bind) in found {
            let source = bind
                .get("source")?
                .as_str()?
                .strip_prefix("reading:")?
                .to_string();
            if !matches!(
                bind.get("select").and_then(Value::as_str),
                None | Some("value")
            ) {
                return None;
            }
            // A binding never shows a reading as live past the source's own freshness.
            let fresh = *fresh_for.get(&source)?;
            let stale_after = match bind.get("stale_after") {
                None => fresh,
                Some(s) => s.as_i64().filter(|s| *s > 0)?.min(fresh),
            };
            let b = Bound {
                element,
                bind: bind.clone(),
                source,
                stale_after,
            };
            draw(&b, None, 0)?;
            bound.push(b);
        }
        Some(PanelDef {
            plugin: plugin.to_string(),
            bound,
            terminals,
            on_read_failed: ops(p.get("script").and_then(|s| s.get("on_read_failed")))?,
            raw_input: p.get("raw_input").and_then(Value::as_bool).unwrap_or(false),
        })
    }

    /// A script's timers, each firing from its first time at or after the install.
    fn timers(&self, panel: &str, script: &Value) -> Option<Vec<Timer>> {
        let list = match script.get("timers") {
            None => return Some(Vec::new()),
            Some(t) => t.as_array()?,
        };
        list.iter()
            .map(|t| {
                // At most one tick a millisecond, so an hour's script stays a few million steps.
                let every = t.get("every")?.as_i64().filter(|e| *e >= MIN_EVERY)?;
                let mut next = t.get("first")?.as_i64().filter(|f| *f >= 0)?;
                while next < self.now {
                    next += every;
                }
                Some(Timer {
                    panel: panel.to_string(),
                    next,
                    every,
                    until: match t.get("until") {
                        None => None,
                        Some(u) => Some(u.as_i64()?),
                    },
                    ops: ops(t.get("do"))?,
                })
            })
            .collect()
    }

    /// Runs every timer due by `to`, in time order (ties by install order).
    pub fn advance_ring(&mut self, to: i64) {
        loop {
            let due = self
                .ring
                .timers
                .iter()
                .enumerate()
                .filter(|(_, t)| t.next <= to && t.until.is_none_or(|u| t.next <= u))
                .min_by_key(|(i, t)| (t.next, *i))
                .map(|(i, _)| i);
            let Some(i) = due else { break };
            let t = &mut self.ring.timers[i];
            let (at, panel, ops) = (t.next, t.panel.clone(), t.ops.clone());
            t.next += t.every;
            self.now = at;
            for op in &ops {
                self.run_op(&panel, op, false);
            }
        }
    }

    /// One op of a panel's script, decided by the ring and recorded as an attempt.
    fn run_op(&mut self, panel: &str, op: &Op, nested: bool) {
        let now = self.now;
        let Some(plugin) = self.ring.panels.get(panel).map(|d| d.plugin.clone()) else {
            return;
        };
        let mut failed_read = false;
        let (outcome, serial) = match op {
            // The panel's policy is empty: no network or program of its own.
            Op::Fetch(url) => match self.planted_is(Planted::PanelPolicyOpen) && fetch(url) {
                true => ("done", None),
                false => ("refused", None),
            },
            Op::Run(argv) => match self.planted_is(Planted::PanelPolicyOpen) && run_program(argv) {
                true => ("done", None),
                false => ("refused", None),
            },
            // The hub makes the call, to a source the plug-in declared.
            Op::Read(source) => {
                if self.ring.sources.get(source).map(|s| s.plugin.as_str()) != Some(&plugin) {
                    ("refused", None)
                } else {
                    let restamp = self.planted_is(Planted::RefreshRestampsCached);
                    match self.ring.call_source(source, now, restamp) {
                        true => ("done", None),
                        false => {
                            failed_read = !nested;
                            ("failed", None)
                        }
                    }
                }
            }
            Op::Say {
                session,
                kinds,
                text,
            } => self.say(&plugin, panel, session, kinds, text),
            _ => {
                let serial = self.placement.fresh_serial(panel, now, |_| true);
                let unguarded = self.planted_is(Planted::ScriptOpsNeedNoSerial)
                    && matches!(op, Op::Focus | Op::PopOut(_) | Op::Clipboard(_));
                match serial.is_some() || unguarded {
                    true if self.gated(&plugin, panel, op, serial) => ("done", serial),
                    _ => ("refused", serial),
                }
            }
        };
        self.ring
            .attempts
            .entry(panel.to_string())
            .or_default()
            .push(json!({"at": now, "op": op.name(), "outcome": outcome, "serial": serial}));
        if failed_read {
            let handler = self.ring.panels[panel].on_read_failed.clone();
            for op in &handler {
                self.run_op(panel, op, true);
            }
        }
    }

    /// An op a serial let through: whether it was done.
    fn gated(&mut self, plugin: &str, panel: &str, op: &Op, serial: Option<u64>) -> bool {
        let now = self.now;
        match op {
            Op::Focus => self.ring.kb_focus = Some(panel.to_string()),
            Op::Clipboard(text) => {
                self.ring.clipboard = Some(json!({"text": text, "plugin": plugin, "panel": panel}))
            }
            Op::Toast(text) => {
                let Some(w) = self.placement.window_of(panel) else {
                    return false;
                };
                let r = w.rect;
                self.ring.toasts.push(Toast {
                    plugin: plugin.to_string(),
                    text: text.clone(),
                    display: w.display.clone(),
                    rect: [
                        r[0] + r[2] - TOAST[0] - TOAST_MARGIN,
                        r[1] + TOAST_MARGIN,
                        TOAST[0],
                        TOAST[1],
                    ],
                    made: now,
                });
            }
            Op::PopOut(display) => {
                let Some(rect) = self.ring.rect_of(panel) else {
                    return false;
                };
                let size = [rect[2], rect[3]];
                let reply = match serial {
                    Some(_) => self
                        .placement
                        .pop_out(now, panel, display, serial, false, size),
                    // Only the planted host lets a script's pop-out through with no serial.
                    None => self.placement.open_view(now, panel, display, false, size),
                };
                return reply.get("window").is_some();
            }
            Op::Place { piece, rect } => {
                let moves = self.planted_is(Planted::PlacementMovesYours);
                let placed = self.ring.place(piece, *rect, "plugin", moves);
                self.lay_out(piece);
                return placed.get("piece").is_some();
            }
            _ => return false,
        }
        true
    }

    /// A panel's words into a session: sent with a fresh serial of your press in the panel that
    /// no send has spent, else one draft per panel in the session's box.
    fn say(
        &mut self,
        plugin: &str,
        panel: &str,
        session: &str,
        kinds: &[String],
        text: &str,
    ) -> (&'static str, Option<u64>) {
        let now = self.now;
        if !self.scenario.sessions.contains_key(session) {
            return ("refused", None);
        }
        let n = self.ring.sends.entry(panel.to_string()).or_default();
        let kind = kinds[*n % kinds.len()].clone();
        *n += 1;
        let many = self.planted_is(Planted::SerialCarriesManySends);
        let spent = &self.ring.spent;
        let serial = self
            .placement
            .fresh_serial(panel, now, |s| many || !spent.contains(&s));
        let by = json!({"plugin": plugin, "panel": panel});
        if serial.is_some() || self.planted_is(Planted::SendsWithoutSerial) {
            if let Some(s) = serial {
                self.ring.spent.insert(s);
            }
            self.ring
                .turns
                .entry(session.to_string())
                .or_default()
                .push(json!({"at": now, "kind": kind, "text": text, "by": by}));
            return ("sent", serial);
        }
        let draft = json!({"text": text, "plugin": plugin, "panel": panel, "kind": kind});
        let drafts = &mut self
            .ring
            .boxes
            .entry(session.to_string())
            .or_default()
            .drafts;
        match drafts.iter_mut().find(|d| d["panel"] == panel) {
            Some(d) => *d = draft,
            None => drafts.push(draft),
        }
        ("draft", None)
    }

    /// Your input to a panel a plug-in claimed: its serial; a press gives the panel keyboard
    /// focus, and a key goes to the focused panel that takes raw input, but the escape chord
    /// always to the shell. `None` for any other panel.
    pub fn ring_input(&mut self, panel: &str, event: &Event) -> Option<Value> {
        if !self.ring.owns(panel) {
            return None;
        }
        let (serial, reached) = self.route(panel, event);
        let mut reply = json!({ "serial": serial });
        if let Some(to) = reached {
            reply["reached"] = json!([to.map_or("shell".to_string(), |p| format!("panel:{p}"))]);
        }
        Some(reply)
    }

    /// The input router (Input router, focus and gesture serial): your input to `panel` gets
    /// the next serial and raises its window. A press moves keyboard focus to the panel and is a
    /// gesture there; a key goes where focus is, as a gesture of that panel, and the escape chord
    /// always to the shell, never as anyone's gesture. A hover or a scroll is no gesture. Returns
    /// the serial, and for a key where it went (`None` for the shell).
    pub fn route(&mut self, panel: &str, event: &Event) -> (u64, Option<Option<String>>) {
        self.serial += 1;
        let (serial, now) = (self.serial, self.now);
        self.placement.input(now, panel);
        match event {
            Event::Down { .. } => {
                self.ring.focus(panel);
                self.placement.gesture(now, panel, serial);
                (serial, None)
            }
            Event::Key { key, .. } => {
                let escape = key.eq_ignore_ascii_case(ESCAPE);
                let takes = self.planted_is(Planted::FocusedPanelTakesEscape);
                let to = self.ring.key_to(panel, escape, takes).map(str::to_string);
                if let Some(f) = &to {
                    self.placement.gesture(now, f, serial);
                }
                (serial, Some(to))
            }
            _ => (serial, None),
        }
    }

    /// `drawn`: the frame on screen in the panel now, the newest vsync of its window's display,
    /// with each bound value as that frame draws it from the readings made by its latch.
    fn drawn(&self, panel: &str) -> Value {
        let Some(def) = self.ring.panels.get(panel) else {
            return json!({"code": "unknown_panel"});
        };
        let Some((_, display)) = self.placement.pacing(panel) else {
            return json!({"code": "no_display"});
        };
        let grid = display.grid();
        let now = self.now;
        let first = grid.vsync_from(now);
        let vsync = if first <= now {
            first
        } else if first - grid.period >= grid.next_vsync {
            first - grid.period
        } else {
            return json!({"code": "not_presented"});
        };
        let lead = self.scenario.clock.map_or(0, |c| c.lead);
        let late = match self.planted_is(Planted::BoundValueAFrameLate) {
            true => grid.period,
            false => 0,
        };
        let latch = vsync - lead - late;
        let bound: Vec<Value> = def
            .bound
            .iter()
            .map(|b| {
                let reading = self.ring.reading_at(&b.source, latch);
                let shown = draw(b, reading, vsync);
                json!({
                    "element": b.element,
                    "text": shown.as_ref().map_or("—", |s| s.text.as_str()),
                    "stale": shown.as_ref().is_some_and(|s| s.stale),
                    "age": shown.as_ref().and_then(|s| s.age),
                    "as_of": reading.map(|r| r.as_of),
                    "source": format!("reading:{}", b.source),
                })
            })
            .collect();
        json!({"vsync": vsync, "bound": bound})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chord_has_one_spelling_and_the_escape_chord_is_known_in_any() {
        assert_eq!(
            canonical_chord("shift+cmd+K").as_deref(),
            Some("cmd+shift+k")
        );
        assert_eq!(
            canonical_chord("Command+Shift+k").as_deref(),
            Some("cmd+shift+k")
        );
        assert_eq!(canonical_chord("Esc").as_deref(), Some("escape"));
        assert_eq!(
            canonical_chord("shift+esc").as_deref(),
            Some("shift+escape")
        );
        assert_eq!(canonical_chord("cmd+"), None);
        assert_eq!(canonical_chord("hyper+k"), None);
        let none = BTreeMap::new();
        let change = json!({"core": "session.send"});
        assert!(check_binding("shift+escape", &change, &none).is_err());
    }
}
