// Copied verbatim from crates/deep-app/src/states.rs at the merge base 15de8c5b (deep-app is identical at 502541f6),
// without its #[cfg(test)] module: the merge base's whole-list reads, the reference #1141's AC2 compares against.

//! Issue #326: States people see. Every surface names a session's state with one word from the design's table,
//! with its extra (the round a claim was sent back in, the checks' expected time, when a quiet session was last
//! seen), and draws the look's status-map entry and glyph for it. The state comes from the record alone.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use serde_json::Value;

/// How many times a claim is sent back before it becomes one ask (Stalled claims).
pub const SEND_BACKS: u64 = 3;

/// One row of States people see.
#[derive(Clone, Debug, PartialEq)]
pub enum State {
    /// A task the agent hasn't started.
    Queued,
    /// The agent's turn in progress.
    Working,
    /// A stop that claims done, its checks still running; how long they're expected to take, if known.
    SaysDone {
        expected_ms: Option<u64>,
    },
    Pass,
    /// A claim's verdict FAIL, with its round.
    SentBack {
        round: u64,
    },
    Blocked,
    Invalid,
    Inconclusive,
    /// An open ask.
    NeedsYou,
    /// A verdict on a commit that has moved.
    Stale,
    /// A session whose source went quiet, with when it was last seen.
    Quiet {
        last_seen: u64,
    },
}

/// The table's rows: the word on every surface, its status-map entry, and the words that never name it.
pub const TABLE: [(&str, &str, &[&str]); 11] = [
    ("queued", "idle", &[]),
    ("working", "running", &["in progress"]),
    ("says done", "running", &["done"]),
    ("PASS", "pass", &["proven", "passed"]),
    ("sent back", "fail", &["failed"]),
    ("BLOCKED", "blocked", &[]),
    ("INVALID", "invalid", &[]),
    ("INCONCLUSIVE", "inconclusive", &[]),
    ("needs you", "needs_you", &["waiting on you"]),
    ("stale", "stale", &["pass", "passed", "proven"]),
    ("quiet", "idle", &[]),
];

impl State {
    pub fn word(&self) -> &'static str {
        TABLE[self.row()].0
    }

    /// The status-map entry its mark draws.
    pub fn entry(&self) -> &'static str {
        TABLE[self.row()].1
    }

    fn row(&self) -> usize {
        match self {
            State::Queued => 0,
            State::Working => 1,
            State::SaysDone { .. } => 2,
            State::Pass => 3,
            State::SentBack { .. } => 4,
            State::Blocked => 5,
            State::Invalid => 6,
            State::Inconclusive => 7,
            State::NeedsYou => 8,
            State::Stale => 9,
            State::Quiet { .. } => 10,
        }
    }

    /// The word with its extra, as every surface writes it.
    pub fn text(&self, now: u64) -> String {
        match self {
            State::SentBack { round } => format!("sent back {round} of {SEND_BACKS}"),
            State::SaysDone {
                expected_ms: Some(ms),
            } => format!("says done · checks take {}", span(*ms)),
            State::Quiet { last_seen } => {
                format!(
                    "quiet · last seen {} ago",
                    span(now.saturating_sub(*last_seen))
                )
            }
            other => other.word().to_owned(),
        }
    }
}

/// How long until `deadline` from `now`, as a card or a notification says when a default applies: whole days once a
/// day or more is left ("3 d"), else [`span`]. Read to the nearest minute first, so a deadline a second short of
/// three days away still reads "3 d".
pub fn span_until(deadline: u64, now: u64) -> String {
    const MINUTE: u64 = 60_000;
    const DAY: u64 = 86_400_000;
    let left = (deadline.saturating_sub(now) + MINUTE / 2) / MINUTE * MINUTE;
    if left >= DAY {
        format!("{} d", left / DAY)
    } else {
        span(left)
    }
}

/// A span of time as a person reads it: "4 min", "2 h", "12 s".
pub fn span(ms: u64) -> String {
    match ms / 1000 {
        s if s >= 3600 => format!("{} h", s / 3600),
        s if s >= 60 => format!("{} min", s / 60),
        s => format!("{s} s"),
    }
}

/// The app's look, the clean one: its status map gives each entry a color and a glyph.
fn look() -> &'static Value {
    static LOOK: OnceLock<Value> = OnceLock::new();
    LOOK.get_or_init(|| deep_canvas_marks::look::shipped("clean").expect("the clean look ships"))
}

/// The glyph the app's look gives a status-map entry.
pub fn glyph(entry: &str) -> &'static str {
    look()["status_treatment"]["glyph"][entry]
        .as_str()
        .unwrap_or("?")
}

/// The color the look gives a status-map entry, as `0xrrggbb`. Only a status mark is drawn in it.
pub fn color(entry: &str) -> u32 {
    look()["status"][entry]
        .as_str()
        .and_then(|hex| u32::from_str_radix(hex.trim_start_matches('#'), 16).ok())
        .unwrap_or(0)
}

/// A state as a status mark and its words: "✓ PASS".
pub fn mark(state: &State, now: u64) -> String {
    format!("{} {}", glyph(state.entry()), state.text(now))
}

const CLOSING: [&str; 7] = [
    "decision.applied",
    "ask.answered",
    "ask.defaulted",
    "ask.escalated",
    "ask.cancelled",
    "ask.superseded",
    "ask.moot",
];

/// An ask's handle, `ask:<the id of its ask.created>`.
pub fn handle(ask: &Value) -> String {
    format!("ask:{}", ask["id"].as_str().unwrap_or_default())
}

/// Whether an event closed the ask `handle`, as the core reads it: a decision applied names its ask in its data,
/// and no agent closes an ask.
pub fn closes(event: &Value, handle: &str) -> bool {
    let writer = event["writer"].as_str().unwrap_or_default();
    let ask = if event["kind"] == "decision.applied" {
        &event["data"]["ask"]
    } else {
        &event["subject"]
    };
    CLOSING.contains(&event["kind"].as_str().unwrap_or_default())
        && ask == handle
        && writer != "hook"
        && !writer.starts_with("mcp:")
}

/// The open asks, oldest first; of one session when `session` names one. Events carry their session as the
/// record's `session` column. One pass over the events reads every ask, so a long record costs one walk, not one
/// per ask.
pub fn open_asks<'a>(events: &'a [Value], session: Option<&str>) -> Vec<&'a Value> {
    let readings = readings(events);
    events
        .iter()
        .filter(|event| event["kind"] == "ask.created")
        .filter(|ask| session.is_none_or(|session| ask["session"] == session))
        .filter(|ask| readings.get(handle(ask).as_str()).is_none_or(Reading::open))
        .collect()
}

/// Whether the ask `handle` is open, as the core reads the record.
pub fn is_open(events: &[Value], handle: &str) -> bool {
    reading(events, handle).open()
}

/// The asks the events close, as the core reads the record, in one pass: any other ask is open, as [`is_open`]
/// reads it, whether or not the events hold its creation.
pub fn closed_asks(events: &[Value]) -> BTreeSet<&str> {
    readings(events)
        .into_iter()
        .filter(|(_, reading)| !reading.open())
        .map(|(handle, _)| handle)
        .collect()
}

/// When the ask's default applies: the deadline the core last gave it, by an undo of its default or a move (#908),
/// else its own.
pub fn deadline(events: &[Value], ask: &Value) -> Option<u64> {
    reading(events, &handle(ask))
        .deadline
        .or_else(|| ask["data"]["deadline"].as_u64())
}

/// An ask as the core reads the record in order: the first close decides, only the core's undo of a default opens it
/// again, and the core moves an open ask's deadline.
#[derive(Default)]
struct Reading<'a> {
    closed: Option<&'a str>,
    deadline: Option<u64>,
}

impl<'a> Reading<'a> {
    fn open(&self) -> bool {
        self.closed.is_none()
    }

    /// One event about this ask, in log order.
    fn read(&mut self, event: &'a Value, handle: &str) {
        if self.closed.is_none() && closes(event, handle) {
            self.closed = event["kind"].as_str();
        } else if self.closed.is_none()
            && event["kind"] == "deadline.moved"
            && event["writer"] == "core"
            && event["subject"] == handle
        {
            self.deadline = event["data"]["deadline"].as_u64().or(self.deadline);
        } else if self.closed == Some("ask.defaulted")
            && event["kind"] == "default.undone"
            && event["writer"] == "core"
            && event["subject"] == handle
        {
            if let Some(again) = event["data"]["deadline"].as_u64() {
                self.closed = None;
                self.deadline = Some(again);
            }
        }
    }
}

/// The ask `handle`, read from every event.
fn reading<'a>(events: &'a [Value], handle: &str) -> Reading<'a> {
    let mut reading = Reading::default();
    for event in events {
        reading.read(event, handle);
    }
    reading
}

/// Every ask an event names, each read from the events about it alone: what [`reading`] gives each, in one pass.
/// Only an event about an ask can change one's reading, so the others are passed over.
fn readings(events: &[Value]) -> BTreeMap<&str, Reading<'_>> {
    let mut out: BTreeMap<&str, Reading<'_>> = BTreeMap::new();
    for event in events {
        // The one ask an event can be about: a decision applied names its ask in its data, any other its subject.
        let about = if event["kind"] == "decision.applied" {
            &event["data"]["ask"]
        } else {
            &event["subject"]
        };
        if let Some(handle) = about.as_str().filter(|handle| handle.starts_with("ask:")) {
            out.entry(handle).or_default().read(event, handle);
        }
    }
    out
}

/// The sessions in the record, in the order they first appear.
pub fn sessions(events: &[Value]) -> Vec<String> {
    let mut sessions: Vec<String> = Vec::new();
    for session in events.iter().filter_map(|event| event["session"].as_str()) {
        if !sessions.iter().any(|known| known == session) {
            sessions.push(session.to_owned());
        }
    }
    sessions
}

/// The title of the session's task.
pub fn title(events: &[Value], session: &str) -> String {
    events
        .iter()
        .find(|event| event["kind"] == "task.created" && event["data"]["thread"] == session)
        .and_then(|event| event["data"]["title"].as_str())
        .map_or_else(|| untitled(session), str::to_owned)
}

/// A session's state, from the record's events.
pub fn state(events: &[Value], session: &str) -> State {
    let mine: Vec<&Value> = events
        .iter()
        .filter(|event| event["session"] == session)
        .collect();
    state_of(&mine, &readings(events))
}

/// Every session in the record, in the order each first appears, with its task's title and its state: what
/// [`sessions`], [`title`] and [`state`] give each, read in one pass over the events, not three per session.
pub fn every_session(events: &[Value]) -> Vec<(String, String, State)> {
    let mut order: Vec<&str> = Vec::new();
    let mut by: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    let mut titles: BTreeMap<&str, Option<&str>> = BTreeMap::new();
    for event in events {
        if let Some(session) = event["session"].as_str() {
            by.entry(session)
                .or_insert_with(|| {
                    order.push(session);
                    Vec::new()
                })
                .push(event);
        }
        // The first task.created that names a thread titles it, as `title` reads it, whichever session's event it is.
        if event["kind"] == "task.created" {
            if let Some(thread) = event["data"]["thread"].as_str() {
                titles
                    .entry(thread)
                    .or_insert(event["data"]["title"].as_str());
            }
        }
    }
    let readings = readings(events);
    order
        .into_iter()
        .map(|session| {
            let title = titles
                .get(session)
                .copied()
                .flatten()
                .map_or_else(|| untitled(session), str::to_owned);
            (session.to_owned(), title, state_of(&by[session], &readings))
        })
        .collect()
}

/// A session's title when no task names it.
fn untitled(session: &str) -> String {
    format!("Session {}", &session[..session.len().min(8)])
}

/// A session's state from its own events, in log order, and every ask's reading.
fn state_of(mine: &[&Value], readings: &BTreeMap<&str, Reading<'_>>) -> State {
    // An ask the session raised, still open, leaves it needing you.
    if mine.iter().any(|event| {
        event["kind"] == "ask.created"
            && readings
                .get(handle(event).as_str())
                .is_none_or(Reading::open)
    }) {
        return State::NeedsYou;
    }
    let pos = |event: &Value| event["log_pos"].as_u64().unwrap_or(0);
    let newest = |kinds: &[&str]| {
        mine.iter()
            .rev()
            .find(|event| kinds.contains(&event["kind"].as_str().unwrap_or_default()))
            .copied()
    };
    let attention = newest(&["session.attention"]);
    let activity = newest(&[
        "session.attention",
        "tool.before",
        "tool.after",
        "prompt.submitted",
    ]);
    if let Some(claim) =
        newest(&["claim.made"]).filter(|claim| activity.is_none_or(|a| pos(a) < pos(claim)))
    {
        let handle = format!("claim:{}", claim["id"].as_str().unwrap_or_default());
        let of = |kind: &str, field: &str, value: &str| {
            mine.iter()
                .rev()
                .find(|event| event["kind"] == kind && event["data"][field] == value)
                .copied()
        };
        let Some(verdict) = of("verdict.made", "claim", &handle) else {
            return State::SaysDone {
                expected_ms: expected(mine, &handle),
            };
        };
        if of(
            "verdict.stale",
            "verdict",
            verdict["data"]["verdict"].as_str().unwrap_or_default(),
        )
        .is_some()
        {
            return State::Stale;
        }
        return match verdict["data"]["outcome"].as_str().unwrap_or_default() {
            "PASS" => State::Pass,
            "FAIL" => State::SentBack {
                round: of("claim.sent_back", "claim", &handle)
                    .and_then(|sent| sent["data"]["round"].as_u64())
                    .unwrap_or(1),
            },
            "BLOCKED" => State::Blocked,
            "INVALID" => State::Invalid,
            _ => State::Inconclusive,
        };
    }
    match attention.map(|event| event["data"]["state"].as_str().unwrap_or_default()) {
        Some("unknown") => State::Quiet {
            last_seen: mine
                .iter()
                .filter_map(|event| event["ts"].as_u64())
                .max()
                .unwrap_or(0),
        },
        Some(_) => State::Working,
        None if activity.is_some() => State::Working,
        None => State::Queued,
    }
}

/// How long the claim's checks are expected to take: for each check it runs, the median of that check's clean
/// runs before, the longest of them.
fn expected(events: &[&Value], claim: &str) -> Option<u64> {
    let checks: Vec<&str> = events
        .iter()
        .filter(|event| event["kind"] == "run.started" && event["data"]["claim"] == claim)
        .filter_map(|event| event["data"]["check"].as_str())
        .collect();
    checks
        .into_iter()
        .filter_map(|check| {
            let mut took: Vec<u64> = events
                .iter()
                .filter(|event| {
                    event["kind"] == "run.finished" && event["data"]["outcome"] == "passed"
                })
                .filter_map(|finished| {
                    let started = events.iter().find(|event| {
                        event["kind"] == "run.started"
                            && event["data"]["run"] == finished["data"]["run"]
                            && event["data"]["check"] == check
                    })?;
                    finished["ts"]
                        .as_u64()?
                        .checked_sub(started["ts"].as_u64()?)
                })
                .collect();
            took.sort_unstable();
            took.get(took.len() / 2).copied()
        })
        .max()
}

/// The verdict line the app sends to the session's chat.
pub fn verdict_line(events: &[Value], session: &str, now: u64) -> String {
    format!(
        "DeepBuild {} · {}",
        mark(&state(events, session), now),
        title(events, session)
    )
}

/// The one count of what needs you: every open ask in the record, the same on every device.
pub fn count(events: &[Value]) -> usize {
    open_asks(events, None).len()
}

/// The menu bar's menu under the count: a line per session, its task and its status mark.
pub fn menu(events: &[Value], now: u64) -> Vec<String> {
    every_session(events)
        .into_iter()
        .map(|(_, title, state)| format!("{title} · {}", mark(&state, now)))
        .collect()
}
