//! Issue #326: States people see. Every surface names a session's state with one word from the design's table,
//! with its extra (the round a claim was sent back in, the checks' expected time, when a quiet session was last
//! seen), and draws the look's status-map entry and glyph for it. The state comes from the record alone.

use std::collections::{BTreeMap, BTreeSet, HashMap};
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

/// The table's rows: the word on every surface, its status-map entry, and the words that never name it. Stuck,
/// flagged and finished are the states the hub's one reading gives a session that no claim names (#992), which the
/// list's rows carry (#1463); running is a running job's row (#1925).
pub const TABLE: [(&str, &str, &[&str]); 15] = [
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
    ("stuck", "blocked", &[]),
    ("flagged", "fail", &[]),
    ("finished", "idle", &[]),
    ("running", "running", &[]),
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
                let age = now.saturating_sub(*last_seen);
                changes_after(changes_in(age));
                // #1458's planted row reads its time the way no surface may, in a test build only.
                if crate::plain::planted("row-says-ago") {
                    return "quiet · last seen 2 min ago".to_owned();
                }
                format!("quiet · last seen {}", span(age))
            }
            other => other.word().to_owned(),
        }
    }
}

/// A moment as every surface writes it (#1458), in your time zone: "16:40" today, "tomorrow 16:40", and on another
/// day its weekday, "Mon 16:40". An ask's row, its card and its notification say when its default applies in these
/// words.
pub fn moment(at: u64, now: u64) -> String {
    use chrono::{Local, TimeZone as _};
    let local = |ms: u64| Local.timestamp_millis_opt(ms as i64).unwrap();
    let (at, today) = (local(at), local(now).date_naive());
    let time = at.format("%H:%M");
    match (at.date_naive() - today).num_days() {
        0 => time.to_string(),
        1 => format!("tomorrow {time}"),
        _ => format!("{} {time}", at.format("%a")),
    }
}

thread_local! {
    /// In ms from the `now` it was written at, when the soonest age a state's text showed since [`ages_written`]
    /// next reads differently (#1546).
    static AGE_CHANGES: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// When the soonest age written since the last call next reads differently, in ms from the `now` it was written at;
/// `None` when no text written since showed an age. A view draws its texts, then takes this to set its next tick.
pub fn ages_written() -> Option<u64> {
    AGE_CHANGES.with(std::cell::Cell::take)
}

/// Notes that something just written from the clock reads differently `wait` ms from now.
pub fn changes_after(wait: u64) {
    AGE_CHANGES.with(|soonest| {
        soonest.set(Some(soonest.get().map_or(wait, |was: u64| was.min(wait))));
    });
}

/// How long until [`span`] of an age `ms` reads differently: at the next whole second, minute, hour or day it shows.
pub fn changes_in(ms: u64) -> u64 {
    let unit = match ms / 1000 {
        s if s >= 86_400 => 86_400_000,
        s if s >= 3600 => 3_600_000,
        s if s >= 60 => 60_000,
        _ => 1000,
    };
    unit - ms % unit
}

/// `words` and the length [`span`] wrote at their end, if one is: a row draws that length in a slot of its own at
/// its right edge, so a ticking time moves nothing else in the row (#1458).
pub fn time_at_end(words: &str) -> (&str, Option<&str>) {
    let mut parts = words.rsplitn(3, ' ');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(unit), Some(n), Some(rest))
            if ["s", "min", "h", "d"].contains(&unit)
                && !n.is_empty()
                && n.bytes().all(|b| b.is_ascii_digit()) =>
        {
            (rest, Some(&words[rest.len() + 1..]))
        }
        _ => (words, None),
    }
}

/// A running job's row words after its kind (#1925): its count from its tool's own counter with its time left, as the
/// hub wrote them; or, when its tool reports no counter, the word running and how long it has run, which a row draws
/// at its right edge. Never a bar, and never a count its tool didn't report.
pub fn job_words(row: &Value, now: u64) -> String {
    let title = row["title"].as_str().unwrap_or_default();
    match row["progress"].as_str() {
        Some(progress) => format!("{title} · {progress}"),
        None => {
            let ran = now.saturating_sub(row["since"].as_u64().unwrap_or(now));
            format!("{title} · running {}", span(ran))
        }
    }
}

/// A length of time as every surface writes it (#1458): "40 s", "12 min", "3 h" or "2 d", with a space and no "ago",
/// since the slot it's in says it's since.
pub fn span(ms: u64) -> String {
    match ms / 1000 {
        s if s >= 86_400 => format!("{} d", s / 86_400),
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

/// The kinds that close an ask: each move of the contract's ask.machine@1 into a final state, so the app keeps no
/// close list of its own (#2026).
pub fn closing() -> &'static [String] {
    static KINDS: OnceLock<Vec<String>> = OnceLock::new();
    KINDS.get_or_init(|| {
        let machine: Value = serde_json::from_str(include_str!(
            "../../../packages/contracts/schemas/ask.machine@1.json"
        ))
        .expect("ask.machine@1 is JSON");
        let mut kinds: Vec<String> = machine["moves"]
            .as_array()
            .expect("ask.machine@1 holds moves")
            .iter()
            .filter(|step| {
                machine["final"]
                    .as_array()
                    .is_some_and(|end| end.contains(&step["to"]))
            })
            .filter_map(|step| step["event"].as_str().map(str::to_owned))
            .collect();
        kinds.sort();
        kinds.dedup();
        kinds
    })
}

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
    closing().iter().any(|kind| event["kind"] == kind.as_str())
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

/// When the ask's default applies: the deadline the core last gave it, by an undo of its default or a move (#908),
/// else its own.
pub fn deadline(events: &[Value], ask: &Value) -> Option<u64> {
    reading(events, &handle(ask))
        .deadline
        .or_else(|| ask["data"]["deadline"].as_u64())
}

/// An ask as the core reads the record in order: the first close decides, only the core's undo of a default opens it
/// again, and the core moves an open ask's deadline.
#[derive(Clone, Debug, Default)]
struct Reading {
    closed: Option<&'static str>,
    deadline: Option<u64>,
}

impl Reading {
    fn open(&self) -> bool {
        self.closed.is_none()
    }

    /// Whether no event can open it again: closed other than by its default.
    fn done(&self) -> bool {
        self.closed.is_some_and(|kind| kind != "ask.defaulted")
    }

    /// One event about this ask, in log order.
    fn read(&mut self, event: &Value, handle: &str) {
        if self.closed.is_none() && closes(event, handle) {
            self.closed = closing()
                .iter()
                .find(|kind| event["kind"] == kind.as_str())
                .map(String::as_str);
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
fn reading(events: &[Value], handle: &str) -> Reading {
    let mut reading = Reading::default();
    for event in events {
        reading.read(event, handle);
    }
    reading
}

/// Every ask an event names, each read from the events about it alone: what [`reading`] gives each, in one pass.
/// Only an event about an ask can change one's reading, so the others are passed over.
fn readings(events: &[Value]) -> BTreeMap<&str, Reading> {
    let mut out: BTreeMap<&str, Reading> = BTreeMap::new();
    for event in events {
        if let Some(handle) = about(event) {
            out.entry(handle).or_default().read(event, handle);
        }
    }
    out
}

/// The one ask an event can be about: a decision applied names its ask in its data, any other its subject.
fn about(event: &Value) -> Option<&str> {
    let about = if event["kind"] == "decision.applied" {
        &event["data"]["ask"]
    } else {
        &event["subject"]
    };
    about.as_str().filter(|handle| handle.starts_with("ask:"))
}

/// The readings a session's row shows beside it, newest last.
pub const READINGS: usize = 3;

/// Issue #1141: the record folded as its events arrive, in log order, each once: what the app shows of it, each
/// session's title, the inputs of its state and its open asks, and each ask's reading, not the events themselves.
/// A read costs what it shows, whatever the record's length, and gives what reading every event would.
#[derive(Clone, Debug, Default)]
pub struct Table {
    /// The sessions, in the order each first appears.
    order: Vec<String>,
    sessions: HashMap<String, Session>,
    /// Each thread's title, from the first task.created that names it.
    titles: HashMap<String, Option<String>>,
    /// Every ask an event is about, read as the core reads it.
    readings: HashMap<String, Reading>,
    /// The ask.created events, in log order, of every ask some event could still leave open.
    asks: Vec<Value>,
    /// Each reading's newest value and the time it is as of, in ms (#1172).
    values: HashMap<String, (f64, u64)>,
    /// Each start's facts from its `start.started` (#1348): the run's approval ask, the issue, the branch and
    /// the repo, by start; and the session each start became, from its `start.session`.
    starts: HashMap<String, Start>,
    started: HashMap<String, String>,
    /// The list's rows the hub built (#1463), by ID: each one's place in the list and the row, as its newest
    /// row.set gives them.
    rows: HashMap<String, (String, Value)>,
    /// Whether the record holds any row.set: a record from before the hub built rows keeps the app's own reading.
    listed: bool,
    /// Each session's project, from the first event that names one (#1462): the list's heading it goes under.
    projects: HashMap<String, String>,
}

/// What a start says of the session it became (#1348): the approval ask of the work run it's part of, and the real
/// names a session's page shows.
#[derive(Clone, Debug, Default)]
struct Start {
    ask: String,
    issue: Option<u64>,
    branch: String,
    repo: String,
}

/// What a session's state is read from: of its own events, only the newest of each kind it reads, and each claim's
/// verdict, send-back and checks.
#[derive(Clone, Debug, Default)]
struct Session {
    /// The newest time its events give, but for the core's `session.state` and `session.gone` (#992).
    last_seen: Option<u64>,
    /// The state and cause the core last recorded for it as `session.state` (#992), from the one reading over the
    /// record that `deep status` lists.
    listed: Option<(String, String)>,
    /// The state its newest session.attention gives.
    attention: Option<String>,
    /// The `log_pos` of its newest activity: an attention, a tool call or a prompt.
    activity: Option<u64>,
    /// The `log_pos` of its newest work (#992): a tool call, a prompt, or an attention that it works or waits on you.
    /// The sidebar row's claim is its stop's, which neither the turn's end the core records again after the claim nor
    /// the idle prompt a minute later hides.
    work: Option<u64>,
    /// Its newest claim.made: the claim's handle and its `log_pos`.
    claim: Option<(String, u64)>,
    /// Each claim's newest verdict: its outcome and the verdict's handle.
    verdicts: HashMap<String, (String, String)>,
    /// The verdicts a verdict.stale names.
    stale: BTreeSet<String>,
    /// The round each claim's newest send-back names.
    rounds: HashMap<String, Option<u64>>,
    /// The checks each claim's runs ran.
    checks: HashMap<String, BTreeSet<String>>,
    /// Each run's first start of each check, with its time; a run as its JSON.
    starts: HashMap<String, Vec<(String, Option<u64>)>>,
    /// The times each run finished clean.
    passed: HashMap<String, Vec<Option<u64>>>,
    /// Its newest readings (#990), oldest first: what the hub saw beside it, such as its terminal's program status.
    readings: Vec<String>,
    /// How long each check's clean runs took, shortest first.
    took: HashMap<String, Vec<u64>>,
    /// Its newest run's failure when that run failed (#1348): what it gave, its trace included, else its assertion.
    failure: Option<String>,
    /// The cause of its newest stop of its own turn when that turn ended failed (#2029).
    stopped: Option<String>,
    /// Each claim's newest verdict's reasons the core gave of its own (#2029): each code with its sentence.
    why: HashMap<String, Vec<(String, String)>>,
}

impl Table {
    /// Folds one event in, the next in log order.
    pub fn apply(&mut self, event: &Value) {
        if cfg!(feature = "plant-drops-close") && event["kind"] == "ask.moot" {
            return;
        }
        if let Some(handle) = about(event) {
            let reading = self.readings.entry(handle.to_owned()).or_default();
            let done = reading.done();
            reading.read(event, handle);
            if !done && reading.done() {
                self.asks.retain(|ask| self::handle(ask) != handle);
            }
        }
        if let (Some(session), Some(project)) =
            (event["session"].as_str(), event["project"].as_str())
        {
            if !project.is_empty() {
                self.projects
                    .entry(session.to_owned())
                    .or_insert_with(|| project.to_owned());
            }
        }
        let kind = event["kind"].as_str().unwrap_or_default();
        if kind == "ask.created" && !self.readings.get(&handle(event)).is_some_and(Reading::done) {
            self.asks.push(event.clone());
        }
        if kind == "reading.recorded" {
            let data = &event["data"];
            if let (Some(reading), Some(value)) = (data["reading"].as_str(), data["value"].as_f64())
            {
                let as_of = data["as_of"].as_u64().unwrap_or(0);
                self.values.insert(reading.to_owned(), (value, as_of));
            }
        }
        if kind == "start.started" {
            let data = &event["data"];
            let text = |key: &str| data[key].as_str().unwrap_or_default().to_owned();
            self.starts.insert(
                text("run"),
                Start {
                    ask: text("ask"),
                    issue: data["issue"].as_u64(),
                    branch: text("branch"),
                    repo: text("repo"),
                },
            );
        }
        if kind == "start.session" {
            let data = &event["data"];
            if let (Some(run), Some(session)) = (data["run"].as_str(), data["session"].as_str()) {
                self.started.insert(session.to_owned(), run.to_owned());
            }
        }
        if kind == "row.set" {
            let data = &event["data"];
            if let Some(id) = data["id"].as_str() {
                self.listed = true;
                if data["listed"] == true {
                    let order = data["order"].as_str().unwrap_or_default().to_owned();
                    self.rows.insert(id.to_owned(), (order, data.clone()));
                } else {
                    self.rows.remove(id);
                }
            }
        }
        if kind == "task.created" {
            if let Some(thread) = event["data"]["thread"].as_str() {
                self.titles
                    .entry(thread.to_owned())
                    .or_insert_with(|| event["data"]["title"].as_str().map(str::to_owned));
            }
        }
        let Some(session) = event["session"].as_str() else {
            return;
        };
        if !self.sessions.contains_key(session) {
            self.order.push(session.to_owned());
        }
        self.sessions
            .entry(session.to_owned())
            .or_default()
            .apply(event, kind);
    }

    /// The rows a read of the hub gives, in its order (#2026): what the views draw until the record before the read is
    /// folded, so Needs you never waits on the history.
    pub fn seeded(rows: &[Value]) -> Table {
        let mut table = Table {
            listed: true,
            ..Table::default()
        };
        for (at, row) in rows.iter().enumerate() {
            if let Some(id) = row["id"].as_str() {
                table
                    .rows
                    .insert(id.to_owned(), (format!("{at:010}"), row.clone()));
            }
        }
        table
    }

    /// Whether the record holds the list's rows (#1463), so every view reads them and not its own reading.
    pub fn listed(&self) -> bool {
        self.listed
    }

    /// The list's rows (#1463), in the list's one order: by each row's order key's bytes, then by ID.
    pub fn list(&self) -> Vec<&Value> {
        let mut rows: Vec<(&String, &String, &Value)> = self
            .rows
            .iter()
            .map(|(id, (order, row))| (order, id, row))
            .collect();
        rows.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
        rows.into_iter().map(|(.., row)| row).collect()
    }

    /// The list's order key of the row with this ID.
    pub fn order_of(&self, id: &str) -> Option<String> {
        self.rows.get(id).map(|(order, _)| order.clone())
    }

    /// The list's row with this ID.
    pub fn row_of(&self, id: &str) -> Option<&Value> {
        self.rows.get(id).map(|(_, row)| row)
    }

    /// A reading's newest value and the time it is as of, in ms.
    pub fn value(&self, reading: &str) -> Option<(f64, u64)> {
        self.values.get(reading).copied()
    }

    /// The sessions in the record, in the order they first appear.
    pub fn sessions(&self) -> &[String] {
        &self.order
    }

    /// The title of the session's task, as every surface draws it. The agent chooses it, so its controls and
    /// direction marks show as the question card shows them (#1738); the record keeps the bytes.
    /// The project a session is part of, as its events name it; empty when none does (#1462).
    pub fn project(&self, session: &str) -> String {
        self.projects.get(session).cloned().unwrap_or_default()
    }

    pub fn title(&self, session: &str) -> String {
        let title = self
            .titles
            .get(session)
            .cloned()
            .flatten()
            .unwrap_or_else(|| untitled(session));
        crate::question::visible(&title)
    }

    /// A session's state.
    pub fn state(&self, session: &str) -> State {
        // An ask the session raised, still open, leaves it needing you.
        if !self.open_asks(Some(session)).is_empty() {
            return State::NeedsYou;
        }
        self.sessions
            .get(session)
            .map_or(State::Queued, Session::state)
    }

    /// The sidebar row's words after the session's title, and the status-map entry its mark draws (#992): the state
    /// the core last recorded for the session as `session.state`, so the sidebar and `deep status` name it the same,
    /// with "process gone mid-turn" for a process gone; then a claim's state, if the session's newest stop made one.
    /// A session with no `session.state` yet reads as [`Table::state`] does, but for its stop's claim, which it keeps.
    pub fn row(&self, session: &str, now: u64) -> (String, &'static str) {
        // The claim the row adds is its stop's, which only later work hides.
        let shown = match self.sessions.get(session) {
            Some(own) if self.open_asks(Some(session)).is_empty() => own.read(own.work),
            _ => self.state(session),
        };
        let Some((listed, cause)) = self.sessions.get(session).and_then(|s| s.listed.as_ref())
        else {
            return (shown.text(now), shown.entry());
        };
        // The planted app reads a session waiting on you as working, in a build with the env-plants feature only.
        let planted = crate::plain::planted("waiting-as-working");
        let (word, entry) = match listed.as_str() {
            _ if planted && cause == "waiting" => ("working".to_owned(), "running"),
            "needs you" => ("needs you".to_owned(), "needs_you"),
            "stuck" => ("stuck".to_owned(), "blocked"),
            "flagged" if cause == "gone" => ("flagged · process gone mid-turn".to_owned(), "fail"),
            "flagged" => ("flagged".to_owned(), "fail"),
            "finished" => ("finished".to_owned(), "idle"),
            "quiet" => {
                let last_seen = self
                    .sessions
                    .get(session)
                    .and_then(|s| s.last_seen)
                    .unwrap_or(0);
                (State::Quiet { last_seen }.text(now), "idle")
            }
            _ => ("working".to_owned(), "running"),
        };
        match shown {
            State::SaysDone { .. }
            | State::Pass
            | State::SentBack { .. }
            | State::Blocked
            | State::Invalid
            | State::Inconclusive
            | State::Stale => (format!("{word} · {}", shown.text(now)), shown.entry()),
            _ => (word, entry),
        }
    }

    /// A session's newest readings, oldest first, at most [`READINGS`].
    pub fn readings(&self, session: &str) -> &[String] {
        self.sessions.get(session).map_or(&[], |s| &s.readings)
    }

    /// Every session in the record, in the order each first appears, with its task's title and its state.
    pub fn every_session(&self) -> Vec<(String, String, State)> {
        self.order
            .iter()
            .map(|session| (session.clone(), self.title(session), self.state(session)))
            .collect()
    }

    /// The open asks, oldest first; of one session when `session` names one.
    pub fn open_asks(&self, session: Option<&str>) -> Vec<&Value> {
        self.asks
            .iter()
            .filter(|ask| session.is_none_or(|session| ask["session"] == session))
            .filter(|ask| self.is_open(&handle(ask)))
            .collect()
    }

    /// How many asks a decision applied for you closed: #2026's planted count adds them back.
    pub fn decided(&self) -> usize {
        self.readings
            .values()
            .filter(|reading| reading.closed == Some("decision.applied"))
            .count()
    }

    /// Whether the ask `handle` is open: any ask no event closed is, whether or not the record holds its creation.
    pub fn is_open(&self, handle: &str) -> bool {
        self.readings.get(handle).is_none_or(Reading::open)
    }

    /// When the ask's default applies: the deadline the core last gave it, else its own.
    pub fn deadline(&self, ask: &Value) -> Option<u64> {
        self.readings
            .get(&handle(ask))
            .and_then(|reading| reading.deadline)
            .or_else(|| ask["data"]["deadline"].as_u64())
    }

    /// The failure of the session's newest run, when it failed (#1348).
    pub fn failure(&self, session: &str) -> Option<&str> {
        self.sessions.get(session)?.failure.as_deref()
    }

    /// The cause of a session's newest stop when its turn ended failed (#2029), with the core's text for it: its list
    /// row's why, as the hub words it.
    pub fn stopped(&self, session: &str) -> Option<(String, String)> {
        let cause = self.sessions.get(session)?.stopped.clone()?;
        let row = self
            .rows
            .values()
            .find(|(_, row)| row["session"] == session);
        let core = row
            .and_then(|(_, row)| row["why"].as_str())
            .unwrap_or("its turn ended failed");
        Some((cause, core.to_owned()))
    }

    /// The reasons the core gave of its own (#2029) to the verdict on a session's newest claim: each code with its sentence.
    pub fn why(&self, session: &str) -> &[(String, String)] {
        let Some(own) = self.sessions.get(session) else {
            return &[];
        };
        own.claim
            .as_ref()
            .and_then(|(claim, _)| own.why.get(claim))
            .map_or(&[], Vec::as_slice)
    }

    /// The real names a session's page shows of a session a work run started (#1348): the session, and its start's
    /// issue, branch and repo. None for a session no start names.
    pub fn names(&self, session: &str) -> Vec<String> {
        let Some(start) = self
            .started
            .get(session)
            .and_then(|run| self.starts.get(run))
        else {
            return Vec::new();
        };
        let mut names = vec![format!("Session {session}")];
        names.extend(start.issue.map(|issue| format!("Issue #{issue}")));
        names.extend((!start.branch.is_empty()).then(|| format!("Branch {}", start.branch)));
        names.extend((!start.repo.is_empty()).then(|| format!("Repo {}", start.repo)));
        names
    }

    /// Each work run whose every session has stopped (#1348): none queued, working, waiting on its checks or sent
    /// back to try again. A run is its approval's ask, with its sessions in the order they started.
    pub fn ended_runs(&self) -> Vec<(String, Vec<String>)> {
        let mut runs: Vec<(String, Vec<String>)> = Vec::new();
        for session in &self.order {
            let Some(start) = self
                .started
                .get(session)
                .and_then(|run| self.starts.get(run))
            else {
                continue;
            };
            match runs.iter_mut().find(|(ask, _)| *ask == start.ask) {
                Some((_, sessions)) => sessions.push(session.clone()),
                None => runs.push((start.ask.clone(), vec![session.clone()])),
            }
        }
        runs.retain(|(_, sessions)| {
            sessions.iter().all(|session| {
                !matches!(
                    self.state(session),
                    State::Queued
                        | State::Working
                        | State::SaysDone { .. }
                        | State::SentBack { .. }
                )
            })
        });
        runs
    }
}

impl Session {
    /// One of the session's events, the next in log order.
    fn apply(&mut self, event: &Value, kind: &str) {
        let data = &event["data"];
        let text = |value: &Value| value.as_str().map(str::to_owned);
        let pos = event["log_pos"].as_u64().unwrap_or(0);
        // A reading is shown beside the session and moves nothing about it (#990): no state, no sign of life.
        if kind == "session.reading" {
            if let Some(reading) = text(&data["reading"]) {
                self.readings.push(reading);
                let over = self.readings.len().saturating_sub(READINGS);
                self.readings.drain(..over);
            }
            return;
        }
        // The core's reading of its state and its finding the process gone (#992) are no sign of the session.
        if kind == "session.state" || kind == "session.gone" {
            if kind == "session.state" && event["writer"] == "core" {
                let word = |key: &str| data[key].as_str().unwrap_or_default().to_owned();
                self.listed = Some((word("state"), word("cause")));
            }
            return;
        }
        if let Some(ts) = event["ts"].as_u64() {
            self.last_seen = Some(self.last_seen.map_or(ts, |seen| seen.max(ts)));
        }
        if kind == "session.attention" {
            self.attention = Some(data["state"].as_str().unwrap_or_default().to_owned());
        }
        if [
            "session.attention",
            "tool.before",
            "tool.after",
            "prompt.submitted",
        ]
        .contains(&kind)
        {
            self.activity = Some(pos);
            // A turn's end, the core's again after its claim, the idle prompt's a minute later (#992), or the core's
            // quiet reading is no new work.
            if kind != "session.attention"
                || ["working", "waiting"].contains(&data["state"].as_str().unwrap_or_default())
            {
                self.work = Some(pos);
            }
        }
        match kind {
            "claim.made" => {
                let id = event["id"].as_str().unwrap_or_default();
                self.claim = Some((format!("claim:{id}"), pos));
            }
            "verdict.made" => {
                if let Some(claim) = text(&data["claim"]) {
                    let outcome = data["outcome"].as_str().unwrap_or_default().to_owned();
                    let verdict = data["verdict"].as_str().unwrap_or_default().to_owned();
                    let why = data["why"].as_array().into_iter().flatten();
                    let why = why.map(|w| {
                        (
                            text(&w["reason"]).unwrap_or_default(),
                            text(&w["text"]).unwrap_or_default(),
                        )
                    });
                    self.why.insert(claim.clone(), why.collect());
                    self.verdicts.insert(claim, (outcome, verdict));
                }
            }
            "verdict.stale" => self.stale.extend(text(&data["verdict"])),
            // A child's stop ends no turn of the session's own; a turn that ended well names no cause to show.
            "agent.stop" if data["child"].is_null() => {
                self.stopped =
                    (data["outcome"] == "failed").then(|| text(&data["cause"]).unwrap_or_default());
            }
            "claim.sent_back" => {
                if let Some(claim) = text(&data["claim"]) {
                    self.rounds.insert(claim, data["round"].as_u64());
                }
            }
            "run.started" => {
                let Some(check) = text(&data["check"]) else {
                    return;
                };
                if let Some(claim) = text(&data["claim"]) {
                    self.checks.entry(claim).or_default().insert(check.clone());
                }
                let run = data["run"].to_string();
                let starts = self.starts.entry(run.clone()).or_default();
                if starts.iter().any(|(known, _)| *known == check) {
                    return;
                }
                let at = event["ts"].as_u64();
                starts.push((check.clone(), at));
                for finished in self.passed.get(&run).into_iter().flatten() {
                    took(&mut self.took, &check, at, *finished);
                }
            }
            "run.finished" if data["outcome"] == "failed" => {
                self.failure = ["actual", "assertion", "check"]
                    .iter()
                    .find_map(|key| text(&data[*key]).filter(|text| !text.is_empty()));
            }
            "run.finished" if data["outcome"] == "passed" => {
                self.failure = None;
                let run = data["run"].to_string();
                let at = event["ts"].as_u64();
                self.passed.entry(run.clone()).or_default().push(at);
                for (check, started) in self.starts.get(&run).into_iter().flatten() {
                    took(&mut self.took, check, *started, at);
                }
            }
            _ => {}
        }
    }

    /// Its state, with no ask of it open.
    fn state(&self) -> State {
        self.read(self.activity)
    }

    /// Its state, with no ask of it open, with `activity` as its newest activity: a claim made since shows.
    fn read(&self, activity: Option<u64>) -> State {
        if let Some((claim, _)) = self
            .claim
            .as_ref()
            .filter(|(_, at)| activity.is_none_or(|activity| activity < *at))
        {
            let Some((outcome, verdict)) = self.verdicts.get(claim) else {
                return State::SaysDone {
                    expected_ms: self.expected(claim),
                };
            };
            if self.stale.contains(verdict) {
                return State::Stale;
            }
            return match outcome.as_str() {
                "PASS" => State::Pass,
                "FAIL" => State::SentBack {
                    round: self.rounds.get(claim).copied().flatten().unwrap_or(1),
                },
                "BLOCKED" => State::Blocked,
                "INVALID" => State::Invalid,
                _ => State::Inconclusive,
            };
        }
        match self.attention.as_deref() {
            Some("unknown") => State::Quiet {
                last_seen: self.last_seen.unwrap_or(0),
            },
            Some(_) => State::Working,
            None if activity.is_some() => State::Working,
            None => State::Queued,
        }
    }

    /// How long the claim's checks are expected to take: for each check it runs, the median of that check's clean
    /// runs, the longest of them.
    fn expected(&self, claim: &str) -> Option<u64> {
        self.checks
            .get(claim)
            .into_iter()
            .flatten()
            .filter_map(|check| {
                let took = self.took.get(check)?;
                took.get(took.len() / 2).copied()
            })
            .max()
    }
}

/// A clean run of `check` that started at `started` and finished at `finished` took the time between, kept in order.
fn took(
    took: &mut HashMap<String, Vec<u64>>,
    check: &str,
    started: Option<u64>,
    finished: Option<u64>,
) {
    if let Some(ms) = finished
        .zip(started)
        .and_then(|(finished, started)| finished.checked_sub(started))
    {
        let took = took.entry(check.to_owned()).or_default();
        let at = took.partition_point(|known| *known <= ms);
        took.insert(at, ms);
    }
}

/// A session's title when no task names it.
fn untitled(session: &str) -> String {
    format!("Session {}", &session[..session.len().min(8)])
}

/// The verdict line the app sends to the session's chat.
pub fn verdict_line(table: &Table, session: &str, now: u64) -> String {
    format!(
        "DeepBuild {} · {}",
        mark(&table.state(session), now),
        table.title(session)
    )
}

/// The one count of what needs you: every open ask in the record, the same on every device.
pub fn count(table: &Table) -> usize {
    if table.listed() {
        return table
            .list()
            .iter()
            .filter(|row| row["id"].as_str().is_some_and(|id| id.starts_with("ask:")))
            .count();
    }
    table.open_asks(None).len()
}

/// A status-map entry the hub names, as the table holds it; one the table doesn't name draws as idle.
pub fn entry_of(entry: &str) -> &'static str {
    TABLE
        .iter()
        .find(|(_, known, _)| *known == entry)
        .map_or("idle", |(_, known, _)| known)
}

/// The menu bar's menu under the count: a line per session, its task and its status mark. A record whose rows the hub
/// built (#1463) says each session as the list and `deep status` do: its row's title, its entry's mark and its word
/// (#1462).
pub fn menu(table: &Table, now: u64) -> Vec<String> {
    if table.listed() {
        return table
            .list()
            .into_iter()
            .filter(|row| {
                row["id"]
                    .as_str()
                    .is_some_and(|id| id.starts_with("session:"))
            })
            .map(|row| {
                let text = |key: &str| row[key].as_str().unwrap_or_default();
                let title = crate::question::visible(text("title"));
                format!(
                    "{title} · {} {}",
                    glyph(entry_of(text("entry"))),
                    text("word")
                )
            })
            .collect();
    }
    table
        .every_session()
        .into_iter()
        .map(|(_, title, state)| format!("{title} · {}", mark(&state, now)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// #1925: a running job's row shows its tool's count as the hub wrote it; with no counter, the word running and
    /// how long it has run, in the row's time slot, never a count it wasn't given.
    #[test]
    fn a_job_row_counts_only_from_its_tools_counter() {
        let counted = json!({"title": "test.encode", "progress": "300 of 600 · 40 s left", "since": 0});
        assert_eq!(
            job_words(&counted, 45_000),
            "test.encode · 300 of 600 · 40 s left"
        );
        let bare = json!({"title": "test.encode", "since": 1_000});
        let words = job_words(&bare, 41_000);
        assert_eq!(words, "test.encode · running 40 s");
        assert_eq!(
            time_at_end(&words),
            ("test.encode · running", Some("40 s"))
        );
    }

    /// #1546: an age's next tick is the first ms its span reads differently, never later, never earlier.
    #[test]
    fn an_age_changes_exactly_when_its_span_next_reads_differently() {
        let ages = (0..200_000).step_by(997).chain([
            59_999,
            60_000,
            90_000,
            3_599_999,
            3_600_000,
            7_300_123,
            86_399_999,
            86_400_000,
            200_000_000,
        ]);
        for age in ages {
            let wait = changes_in(age);
            assert!(wait > 0, "{age}");
            assert_eq!(
                span(age + wait - 1),
                span(age),
                "{age} reads the same until {wait} ms on"
            );
            assert_ne!(
                span(age + wait),
                span(age),
                "{age} reads differently {wait} ms on"
            );
        }
    }

    fn table(events: &[Value]) -> Table {
        let mut table = Table::default();
        for event in events {
            table.apply(event);
        }
        table
    }

    fn ask(id: &str) -> Value {
        json!({"v": 4, "id": id, "kind": "ask.created", "session": "s1", "data": {"question": "Push?"}})
    }

    #[test]
    fn the_menu_bar_shows_a_titles_controls_and_direction_marks() {
        // #1738: the menu bar lists every session by its task's title, which the agent chose.
        let events = vec![
            json!({"kind": "task.created", "writer": "core", "log_pos": 1, "ts": 1,
                   "data": {"thread": "s1", "title": "Fix\u{202e}txt\x1b[2K\rok\nship"}}),
            json!({"kind": "session.start", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 1, "data": {}}),
        ];
        let menu = menu(&table(&events), 1);
        assert!(
            menu[0].starts_with("Fix\\u{202e}txt\\x1b[2K\\rok\\nship · "),
            "{menu:?}"
        );
    }

    #[test]
    fn a_sessions_readings_show_beside_it_and_move_nothing() {
        // #990: a terminal program's status readings are signal only: the row keeps the newest three, and the
        // session's state and row words are what they were without them.
        let before = vec![
            json!({"kind": "permission.request", "writer": "hook", "session": "s1", "log_pos": 1, "ts": 1, "data": {}}),
        ];
        let mut events = before.clone();
        for (i, word) in ["started", "working", "blocked", "done"].iter().enumerate() {
            events.push(json!({"kind": "session.reading", "writer": "core", "session": "s1", "log_pos": 2 + i,
                               "ts": 1_000_000 + i, "data": {"reading": format!("its terminal's program reports {word}")}}));
        }
        let (with, without) = (table(&events), table(&before));
        assert_eq!(
            with.readings("s1"),
            ["working", "blocked", "done"].map(|w| format!("its terminal's program reports {w}"))
        );
        assert_eq!(with.state("s1"), without.state("s1"));
        assert_eq!(with.row("s1", 2_000_000), without.row("s1", 2_000_000));
    }

    #[test]
    fn every_hooks_attention_is_attention_as_the_whole_list_read_has_it() {
        // #1141's equivalence: the fold reads a session as the record's whole-list reading does, so a hook's finished
        // after the core read the session quiet is attention too, and the session works.
        let events = vec![
            json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 1, "ts": 1,
                   "data": {"state": "unknown"}}),
            json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 2,
                   "data": {"state": "finished"}}),
        ];
        assert_eq!(table(&events).state("s1"), State::Working);
    }

    #[test]
    fn a_hooks_word_that_the_session_works_again_is_its_attention() {
        // A hook's working after the core read the session quiet is the session at work again, as the record's
        // whole-list reading has it (#1141).
        let events = vec![
            json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 1, "ts": 1,
                   "data": {"state": "unknown"}}),
            json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 2,
                   "data": {"state": "working"}}),
        ];
        assert_eq!(table(&events).state("s1"), State::Working);
    }

    #[test]
    fn the_sidebar_row_keeps_its_stops_claim_past_the_turns_end_and_the_idle_prompt() {
        // A turn's claim at its stop, the turn's end the core records again after it, then the idle prompt's
        // Notification a minute later (#992), as the hub's record has them: the sidebar names the state the core
        // recorded, and the stop's claim, which neither the turn's end nor the idle prompt hides.
        let events = vec![
            json!({"kind": "tool.before", "writer": "hook", "session": "s1", "log_pos": 1, "ts": 1, "data": {}}),
            json!({"kind": "claim.made", "writer": "core", "session": "s1", "id": "c1", "log_pos": 2, "ts": 2, "data": {}}),
            json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 3, "ts": 3,
                   "data": {"state": "finished"}}),
            json!({"kind": "session.state", "writer": "core", "session": "s1", "log_pos": 4, "ts": 4,
                   "data": {"state": "finished", "cause": "finished"}}),
            json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 5, "ts": 60_000,
                   "data": {"state": "finished"}}),
        ];
        let (words, entry) = table(&events).row("s1", 60_000);
        assert_eq!((words.as_str(), entry), ("finished · says done", "running"));
        // Later work hides it: a tool call after the stop.
        let mut later = events.clone();
        later.push(json!({"kind": "tool.before", "writer": "hook", "session": "s1", "log_pos": 6, "ts": 61_000, "data": {}}));
        assert_eq!(
            table(&later).row("s1", 61_000),
            ("finished".to_owned(), "idle")
        );
    }

    #[test]
    fn a_decision_the_core_applied_closes_the_ask_it_names() {
        let events = vec![
            ask("a1"),
            ask("a2"),
            json!({"kind": "decision.applied", "writer": "core", "subject": "ask:a1",
                   "data": {"decision": "d1", "ask": "ask:a2"}}),
        ];
        let open: Vec<&str> = open_asks(&events, None)
            .iter()
            .map(|ask| ask["id"].as_str().unwrap())
            .collect();
        assert_eq!(open, ["a1"]);
    }

    #[test]
    fn the_cores_undo_of_a_default_opens_the_ask_again_with_its_new_deadline() {
        let undo = |id: &str, writer: &str| json!({"kind": "default.undone", "writer": writer, "subject": format!("ask:{id}"), "data": {"deadline": 9}});
        let events = vec![
            ask("a1"),
            ask("a2"),
            ask("a3"),
            ask("a4"),
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a1", "data": {}}),
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a2", "data": {}}),
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a3", "data": {}}),
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a4", "data": {}}),
            // A close after the first changes nothing: the core still undoes the default.
            json!({"kind": "ask.cancelled", "writer": "core", "subject": "ask:a1", "data": {}}),
            undo("a1", "core"),
            undo("a2", "mcp:agent"),
            undo("a3", "core"),
            undo("a4", "core"),
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a4", "data": {}}),
        ];
        let open: Vec<&str> = open_asks(&events, None)
            .iter()
            .map(|ask| ask["id"].as_str().unwrap())
            .collect();
        assert_eq!(open, ["a1"]);
        assert_eq!(deadline(&events, &events[0]), Some(9));
        let mut own = ask("a5");
        own["data"]["deadline"] = json!(5);
        assert_eq!(deadline(&[own.clone()], &own), Some(5));
    }

    #[test]
    fn a_session_whose_asks_all_closed_no_longer_needs_you() {
        let events = vec![
            ask("a1"),
            json!({"kind": "tool.before", "session": "s1", "writer": "hook", "log_pos": 2, "data": {}}),
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a1", "data": {}}),
        ];
        assert_eq!(table(&events).state("s1"), State::Working);
        assert_eq!(table(&events[..2]).state("s1"), State::NeedsYou);
        assert_eq!(table(&events).every_session()[0].2, State::Working);
    }

    #[test]
    fn no_agent_closes_an_ask() {
        let events = vec![
            ask("a1"),
            ask("a2"),
            ask("a3"),
            json!({"kind": "ask.answered", "writer": "hook", "subject": "ask:a1", "data": {}}),
            json!({"kind": "ask.cancelled", "writer": "mcp:agent", "subject": "ask:a2", "data": {}}),
            json!({"kind": "ask.cancelled", "writer": "core", "subject": "ask:a3", "data": {}}),
        ];
        let open: Vec<&str> = open_asks(&events, None)
            .iter()
            .map(|ask| ask["id"].as_str().unwrap())
            .collect();
        assert_eq!(open, ["a1", "a2"]);
    }

    /// A record of asks and the events that move them, drawn from `seed`: closes of every kind by every writer,
    /// decisions applied that name an ask in their data, undone defaults, moved deadlines and events about no ask.
    fn drawn(seed: u64) -> Vec<Value> {
        let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
        let mut next = |n: u64| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state % n
        };
        let kinds = [
            "ask.created",
            "ask.answered",
            "ask.defaulted",
            "ask.escalated",
            "ask.cancelled",
            "ask.superseded",
            "ask.moot",
            "decision.applied",
            "default.undone",
            "deadline.moved",
            "tool.before",
            "agent.stop",
            "session.attention",
            "claim.made",
            "verdict.made",
            "verdict.stale",
            "claim.sent_back",
            "task.created",
            "run.started",
            "run.finished",
        ];
        let writers = ["core", "hook", "mcp:agent", "app"];
        let outcomes = ["PASS", "FAIL", "BLOCKED", "INVALID", "INCONCLUSIVE"];
        let attention = ["unknown", "waiting", "finished"];
        let finished = ["passed", "failed"];
        (0..next(60) + 1)
            .map(|i| {
                let kind = kinds[next(kinds.len() as u64) as usize];
                let about = format!("ask:a{}", next(6));
                let other = format!("ask:a{}", next(6));
                let writer = writers[next(writers.len() as u64) as usize];
                let session = format!("s{}", next(3));
                let claim = format!("claim:c{}", next(3));
                let pos = i + 1;
                match kind {
                    "ask.created" => json!({"kind": kind, "id": about[4..], "session": session, "writer": "core", "log_pos": pos,
                                            "data": {"deadline": next(9)}}),
                    "decision.applied" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "subject": about, "log_pos": pos,
                                                 "data": {"ask": other}}),
                    "default.undone" | "deadline.moved" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "log_pos": pos,
                                                           "subject": about, "data": {"deadline": next(9)}}),
                    "tool.before" | "agent.stop" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "session": session,
                                                    "log_pos": pos, "ts": next(1000), "subject": format!("session:{session}"), "data": {}}),
                    "session.attention" => json!({"kind": kind, "id": format!("e{i}"), "writer": "hook", "session": session, "log_pos": pos,
                                                  "ts": next(1000), "data": {"state": attention[next(3) as usize]}}),
                    "claim.made" => json!({"kind": kind, "id": claim[6..], "writer": "mcp:agent", "session": session, "log_pos": pos, "data": {}}),
                    "verdict.made" => json!({"kind": kind, "id": format!("v{}", next(3)), "writer": "core", "session": session, "log_pos": pos,
                                             "data": {"claim": claim, "verdict": format!("verdict:v{}", next(3)), "outcome": outcomes[next(5) as usize]}}),
                    "verdict.stale" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos,
                                              "data": {"verdict": format!("verdict:v{}", next(3))}}),
                    "claim.sent_back" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos,
                                                "data": {"claim": claim, "round": next(4)}}),
                    "task.created" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "log_pos": pos,
                                             "data": {"thread": format!("s{}", next(3)), "title": format!("task {}", next(3))}}),
                    "run.started" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos, "ts": next(1000),
                                            "data": {"claim": claim, "check": format!("k{}", next(2)), "run": format!("r{}", next(4))}}),
                    "run.finished" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos, "ts": next(2000),
                                             "data": {"run": format!("r{}", next(4)), "outcome": finished[next(2) as usize]}}),
                    _ => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "subject": about, "log_pos": pos, "data": {}}),
                }
            })
            .collect()
    }

    #[test]
    fn the_open_asks_read_in_one_pass_and_folded_are_those_each_asks_own_reading_leaves_open() {
        // The reference: each ask read alone over every event, as the core reads it.
        for seed in 0..2_000 {
            let events = drawn(seed);
            let folded = table(&events);
            for session in [None, Some("s0"), Some("s1")] {
                let want: Vec<&Value> = events
                    .iter()
                    .filter(|event| event["kind"] == "ask.created")
                    .filter(|ask| session.is_none_or(|session| ask["session"] == session))
                    .filter(|ask| is_open(&events, &handle(ask)))
                    .collect();
                assert_eq!(
                    open_asks(&events, session),
                    want,
                    "seed {seed}, session {session:?}: {events:#?}"
                );
                assert_eq!(
                    folded.open_asks(session),
                    want,
                    "folded, seed {seed}, session {session:?}: {events:#?}"
                );
            }
            // Every ask the events name, created in them or not, reads open folded exactly when it reads open alone,
            // with the same deadline.
            for n in 0..7 {
                let handle = format!("ask:a{n}");
                assert_eq!(
                    folded.is_open(&handle),
                    is_open(&events, &handle),
                    "seed {seed}, {handle}: {events:#?}"
                );
                let ask = json!({"id": format!("a{n}"), "data": {"deadline": 99}});
                assert_eq!(
                    folded.deadline(&ask),
                    deadline(&events, &ask),
                    "seed {seed}, {handle}: {events:#?}"
                );
            }
        }
    }
}
