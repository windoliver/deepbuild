//! Issue #326: States people see. Every surface names a session's state with one word from the design's table,
//! with its extra (the round a claim was sent back in, the checks' expected time, when a quiet session was last
//! seen), and draws the look's status-map entry and glyph for it. The state comes from the record alone.

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

const CLOSING: [&str; 6] = [
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

/// Whether an event closed the ask `handle`.
pub fn closes(event: &Value, handle: &str) -> bool {
    CLOSING.contains(&event["kind"].as_str().unwrap_or_default()) && event["subject"] == handle
}

/// The open asks, oldest first; of one session when `session` names one. Events carry their session as the
/// record's `session` column.
pub fn open_asks<'a>(events: &'a [Value], session: Option<&str>) -> Vec<&'a Value> {
    events
        .iter()
        .filter(|event| event["kind"] == "ask.created")
        .filter(|ask| session.is_none_or(|session| ask["session"] == session))
        .filter(|ask| !events.iter().any(|event| closes(event, &handle(ask))))
        .collect()
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
        .map_or_else(
            || format!("Session {}", &session[..session.len().min(8)]),
            str::to_owned,
        )
}

/// A session's state, from the record's events.
pub fn state(events: &[Value], session: &str) -> State {
    if !open_asks(events, Some(session)).is_empty() {
        return State::NeedsYou;
    }
    let mine: Vec<&Value> = events
        .iter()
        .filter(|event| event["session"] == session)
        .collect();
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
                expected_ms: expected(&mine, &handle),
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
    sessions(events)
        .iter()
        .map(|session| {
            format!(
                "{} · {}",
                title(events, session),
                mark(&state(events, session), now)
            )
        })
        .collect()
}
