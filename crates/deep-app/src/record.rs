//! The app's one record reader (#34): it holds the hub's stream and its `log_pos` and feeds every view, so no two
//! views show the record as of different log positions. It reads the inbox, subscribes after the `log_pos` that
//! read reflects, ignores a frame it already has, refetches from its last `log_pos` when a frame isn't the next
//! one and moves to the `log_pos` the refetch reflects, and redoes its reads when the hub's start ID is new,
//! since frames it got before a power cut may be gone. A consumer cut off with `fell_behind` resumes from its
//! last `log_pos`.
//!
//! Issue #1141: it keeps what the app shows, the record folded as events arrive ([`Table`]), not the events: a view
//! that needs the record's history reads it from the hub when it opens ([`history`]).
//!
//! Issue #994: the reader can start before the hub does. [`HubWatch`] keeps trying on its schedule and says when the
//! hub isn't answering, and a refused read counts the same as no answer. The app's notification setting goes to the
//! hub on every connection.

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};
use crate::states::{closes, handle, Table};

/// Once a session holds this many open asks, its further asks fold into one exception.
pub const FOLD_AFTER: usize = 5;

/// The kinds that close an ask, and the outcome the inbox shows for each, as the asks core names them.
const CLOSING: [(&str, &str); 7] = [
    ("decision.applied", "decided_for_you"),
    ("ask.answered", "answered"),
    ("ask.defaulted", "defaulted"),
    ("ask.escalated", "escalated"),
    ("ask.cancelled", "cancelled"),
    ("ask.superseded", "superseded"),
    ("ask.moot", "moot"),
];
/// The events one refetch asks for at a time.
const PAGE: usize = 1000;
/// The newest events a view keeps.
const TAIL: usize = 256;
/// While the hub doesn't answer the app tries it this often, and after [`SLOW_AFTER`] [`SLOWLY`].
const RETRY: u64 = 2_000;
const SLOW_AFTER: u64 = 60_000;
const SLOWLY: u64 = 30_000;

/// When to read the hub, and whether it answered the last read.
#[derive(Debug, Default)]
pub struct HubWatch {
    /// Since when reads have failed, and when to try next.
    down: Option<(u64, u64)>,
}

impl HubWatch {
    /// Reads at `now` unless the hub is down and its next try isn't due; `read` says whether it answered.
    pub fn tick(&mut self, now: u64, read: impl FnOnce() -> bool) {
        if self.down.is_some_and(|(_, next)| now < next) {
            return;
        }
        self.down = (!read()).then(|| {
            let since = self.down.map_or(now, |(since, _)| since);
            let wait = if now - since < SLOW_AFTER {
                RETRY
            } else {
                SLOWLY
            };
            (since, now + wait)
        });
    }

    pub fn down(&self) -> bool {
        self.down.is_some()
    }
}

/// The record as of one start ID and one `log_pos`.
#[derive(Clone, Debug, Default)]
pub struct View {
    /// The hub start ID the view was read under.
    pub start: String,
    /// The `log_pos` the view reflects.
    pub log_pos: u64,
    /// The inbox read's rows, with a row for each ask created since and each close applied.
    pub inbox: Vec<Value>,
    /// The events applied since the reads, folded: what the views and the notifier read, through [`View::table`].
    table: Table,
    /// The planted walker's every event.
    #[cfg(feature = "plant-walks-events")]
    all: Vec<Value>,
    /// The newest events applied since the reads, at most [`TAIL`], in `log_pos` order, each once.
    pub events: VecDeque<Value>,
    /// The events the notifier reads, applied since it last took them: each that opens an ask or sends a notice.
    pub unseen: Vec<Value>,
}

impl View {
    /// The record folded, as every view and the notifier read it.
    #[cfg(not(feature = "plant-walks-events"))]
    pub fn table(&self) -> Cow<'_, Table> {
        Cow::Borrowed(&self.table)
    }

    /// The planted walker reads the record by walking every event it applied.
    #[cfg(feature = "plant-walks-events")]
    pub fn table(&self) -> Cow<'_, Table> {
        let mut table = Table::default();
        for event in &self.all {
            table.apply(event);
        }
        Cow::Owned(table)
    }

    /// The open asks' handles, oldest first; of one session when `session` names one.
    pub fn open_asks(&self, session: Option<&str>) -> Vec<String> {
        self.table()
            .open_asks(session)
            .into_iter()
            .map(handle)
            .collect()
    }

    /// When the open ask `ask`, a handle, defaults.
    pub fn deadline(&self, ask: &str) -> Option<u64> {
        let table = self.table();
        let created = table
            .open_asks(None)
            .into_iter()
            .find(|open| handle(open) == ask)?;
        table.deadline(created)
    }

    /// Folds the record up to the view's `log_pos` into its table, read from the hub a page at a time. The reads
    /// already reflect those events, so nothing else of the view takes them, and the notifier never sees them as new.
    fn fold_before(&mut self, client: &mut HubClient) -> Result<(), HubError> {
        let mut after = 0;
        while after < self.log_pos {
            let page = client.call("events.read", json!({ "after": after, "limit": PAGE }))?;
            let events = page["events"].as_array().cloned().unwrap_or_default();
            for event in &events {
                after = event["log_pos"].as_u64().unwrap_or(after);
                if after > self.log_pos {
                    return Ok(());
                }
                self.table.apply(event);
            }
            if events.len() < PAGE {
                break;
            }
        }
        Ok(())
    }

    /// Applies one event the view doesn't have yet.
    pub fn apply(&mut self, event: Value) {
        self.log_pos = event["log_pos"].as_u64().unwrap_or(self.log_pos);
        let kind = event["kind"].as_str().unwrap_or_default();
        if kind == "ask.created" {
            let ask = format!("ask:{}", event["id"].as_str().unwrap_or_default());
            if !self.inbox.iter().any(|row| row["ask"] == ask.as_str()) {
                // Past a session's fifth open ask, it folds, as in the core.
                let mine = self
                    .inbox
                    .iter()
                    .filter(|row| row["session"] == event["session"] && row["status"] != "closed");
                let status = if mine.count() < FOLD_AFTER {
                    "shown"
                } else {
                    "folded"
                };
                self.inbox.push(json!({
                    "ask": ask, "kind": event["data"]["kind"], "session": event["session"],
                    "status": status, "outcome": "unanswered", "owner": event["data"]["owner"],
                    "question": event["data"]["question"],
                }));
            }
        } else if kind == "ask.later" && event["writer"] == "core" {
            // Only the core's Later hides an ask, as in the core: an app's or the CLI's own event changes nothing.
            for row in self
                .inbox
                .iter_mut()
                .filter(|row| row["ask"] == event["subject"] && row["status"] != "closed")
            {
                row["status"] = json!("later");
                // When it comes back, which the list reads by its clock (#1462).
                row["until"] = event["data"]["until"].clone();
            }
        } else if let Some((_, outcome)) = CLOSING.iter().find(|(k, _)| *k == kind) {
            // The close rule the rest of the app reads, and the first close to append decides, as in the core.
            for row in self.inbox.iter_mut().filter(|row| {
                row["status"] != "closed" && closes(&event, row["ask"].as_str().unwrap_or_default())
            }) {
                row["status"] = json!("closed");
                row["outcome"] = json!(outcome);
            }
        } else if kind == "default.undone"
            && event["writer"] == "core"
            && event["data"]["deadline"].is_u64()
        {
            // Open again, still shown, as in the core.
            for row in self
                .inbox
                .iter_mut()
                .filter(|row| row["ask"] == event["subject"] && row["outcome"] == "defaulted")
            {
                row["status"] = json!("shown");
                row["outcome"] = json!("unanswered");
            }
        }
        self.table.apply(&event);
        #[cfg(feature = "plant-walks-events")]
        self.all.push(event.clone());
        if crate::notify::reads(&event) {
            self.unseen.push(event.clone());
        }
        if self.events.len() == TAIL {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }
}

pub struct RecordReader {
    socket: PathBuf,
    token_file: PathBuf,
    client: Option<HubClient>,
    view: View,
    /// The notification setting the hub should hold.
    setting: Option<&'static str>,
    /// Whether each new read also folds the record before it, for the window's views.
    folds: bool,
    /// Whether it checks the hub's hello covers the app before any call (#41), as the window's reader does.
    checks: bool,
}

impl RecordReader {
    /// A reader that hasn't tried the hub yet: its first [`poll`](RecordReader::poll) connects.
    pub fn unopened(socket: &Path, token_file: &Path) -> RecordReader {
        RecordReader {
            socket: socket.to_path_buf(),
            token_file: token_file.to_path_buf(),
            client: None,
            view: View::default(),
            setting: None,
            folds: false,
            checks: false,
        }
    }

    /// Issue #1172: as [`RecordReader::unopened`], for the window: its sidebar and session pages read the folded
    /// record, so each new read also folds what the record held before the app or the hub started. Issue #41: it
    /// calls nothing on a hub whose hello doesn't cover what the app calls.
    pub fn unopened_folded(socket: &Path, token_file: &Path) -> RecordReader {
        RecordReader {
            folds: true,
            checks: true,
            ..RecordReader::unopened(socket, token_file)
        }
    }

    /// Connects as the app, does its reads and subscribes after the `log_pos` they reflect.
    pub fn open(socket: &Path, token_file: &Path) -> Result<RecordReader, HubError> {
        let mut reader = RecordReader::unopened(socket, token_file);
        reader.connect()?;
        Ok(reader)
    }

    /// As [`RecordReader::open`], folded as [`RecordReader::unopened_folded`] is.
    pub fn open_folded(socket: &Path, token_file: &Path) -> Result<RecordReader, HubError> {
        let mut reader = RecordReader::unopened_folded(socket, token_file);
        reader.connect()?;
        Ok(reader)
    }

    /// Tells the hub the app's notification setting, now if connected and on every connection after.
    fn report(&mut self, setting: &'static str) {
        if self.setting != Some(setting) {
            self.setting = Some(setting);
            self.send_report();
        }
    }

    fn send_report(&mut self) {
        if let (Some(client), Some(setting)) = (self.client.as_mut(), self.setting) {
            let reported = client.call("notifications.report", json!({ "setting": setting }));
            if let Err(error) = reported {
                eprintln!("deep-app: the notification setting didn't reach the hub: {error:?}");
            }
        }
    }

    /// `deep-app --hub-check` (#41): connects as the window does, once, making the calls it makes on connect.
    pub fn check(&mut self) -> Result<(), HubError> {
        self.connect()
    }

    pub fn view(&self) -> View {
        self.view.clone()
    }

    /// Handles what comes within `timeout`. A hub it can't reach, or a closed connection, isn't an error: it
    /// connects again on the next call.
    pub fn poll(&mut self, timeout: Duration) -> Result<(), HubError> {
        let deadline = Instant::now() + timeout;
        if self.client.is_none() {
            match self.connect() {
                Ok(()) => {}
                Err(HubError::Refused(error)) => return Err(HubError::Refused(error)),
                Err(_) => {
                    std::thread::sleep(timeout);
                    return Ok(());
                }
            }
        }
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let client = self.client.as_mut().expect("connected");
            let line = match client.next(left) {
                Ok(Some(line)) => line,
                Ok(None) => return Ok(()),
                Err(HubError::Refused(error)) => return Err(HubError::Refused(error)),
                Err(_) => {
                    self.client = None;
                    return Ok(());
                }
            };
            if let Err(error) = self.handle(line) {
                if let HubError::Refused(_) = error {
                    return Err(error);
                }
                self.client = None;
                return Ok(());
            }
        }
    }

    /// Connects, redoing the reads when the hub's start ID isn't the view's, and subscribes after the view's
    /// `log_pos`.
    fn connect(&mut self) -> Result<(), HubError> {
        let token = std::fs::read_to_string(&self.token_file)?;
        let mut client = HubClient::connect(&self.socket)?;
        if self.checks {
            let covered = client.covers_app();
            OLDER.with(|older| {
                *older.borrow_mut() = match &covered {
                    Err(HubError::Older(screen)) => Some(screen.clone()),
                    _ => None,
                }
            });
            covered?;
        }
        client.hello_app(token.trim())?;
        let start = client.hello["start"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if start != self.view.start {
            let inbox = client.call("inbox.read", json!({}))?;
            self.view = View {
                start,
                log_pos: inbox["log_pos"].as_u64().unwrap_or(0),
                inbox: inbox["asks"].as_array().cloned().unwrap_or_default(),
                ..View::default()
            };
            if self.folds {
                self.view.fold_before(&mut client)?;
            }
        }
        client.call("stream.subscribe", json!({ "after": self.view.log_pos }))?;
        self.client = Some(client);
        self.send_report();
        Ok(())
    }

    fn handle(&mut self, line: Value) -> Result<(), HubError> {
        if line["error"]["code"] == "fell_behind" {
            // Cut off: resumes from its last log_pos.
            self.client = None;
            return self.connect();
        }
        let Some(event) = line.get("event") else {
            return Ok(());
        };
        let at = event["log_pos"].as_u64().unwrap_or(0);
        if at <= self.view.log_pos {
            return Ok(());
        }
        if at > self.view.log_pos + 1 {
            self.refetch()?;
            if at <= self.view.log_pos {
                return Ok(());
            }
        }
        self.view.apply(event.clone());
        Ok(())
    }

    /// Reads the log from the view's `log_pos` and moves to the `log_pos` the read reflects, so a gap that stays
    /// empty is crossed once.
    fn refetch(&mut self) -> Result<(), HubError> {
        loop {
            let client = self.client.as_mut().expect("connected");
            let page = client.call(
                "events.read",
                json!({ "after": self.view.log_pos, "limit": PAGE }),
            )?;
            if page["start"].as_str() != Some(self.view.start.as_str()) {
                // A new start: the reads are redone.
                self.view.start.clear();
                self.client = None;
                return self.connect();
            }
            let events = page["events"].as_array().cloned().unwrap_or_default();
            let full = events.len() == PAGE;
            for event in events {
                if event["log_pos"].as_u64().unwrap_or(0) > self.view.log_pos {
                    self.view.apply(event);
                }
            }
            self.view.log_pos = self.view.log_pos.max(page["log_pos"].as_u64().unwrap_or(0));
            if !full {
                return Ok(());
            }
        }
    }

    /// The record's events up to the view's `log_pos`, oldest first, read from the hub a page at a time.
    fn history(&mut self) -> Result<Vec<Value>, HubError> {
        if self.client.is_none() {
            self.connect()?;
        }
        let client = self.client.as_mut().expect("connected");
        let (mut events, mut after) = (Vec::new(), 0);
        loop {
            let page = client.call("events.read", json!({ "after": after, "limit": PAGE }))?;
            let read = page["events"].as_array().cloned().unwrap_or_default();
            let full = read.len() == PAGE;
            for event in read {
                after = event["log_pos"].as_u64().unwrap_or(after);
                if after > self.view.log_pos {
                    return Ok(events);
                }
                events.push(event);
            }
            if !full {
                return Ok(events);
            }
        }
    }
}

/// Where the one reader reads: the hub's socket in the app, or a record the replica feeds event by event, which it
/// holds whole.
enum Source {
    Hub(Box<RecordReader>),
    Local(Box<View>, Vec<Value>, LocalHub),
}

/// How a record held in memory answers a read, for the replica: the hub it stands in for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalHub {
    Answers,
    Stops,
    Refuses,
}

/// How often the app's one reader reads the hub: the reader's tick (#1546).
pub const TICK: Duration = Duration::from_millis(250);

/// Issue #1546: the record and the bound values as the views observe them. The reader and [`crate::bound`] hold what
/// they draw; this entity holds where those stand, so a change the reader applied, or a bound value set, notifies
/// every view that observes it, and marks its window dirty with no input.
pub struct Shown {
    at: (String, u64, u64),
}

struct Live(gpui_kit::Entity<Shown>);

impl gpui_kit::Global for Live {}

/// The app's start ID, `log_pos` and bound values' revision, as the reader holds them now.
fn standing() -> (String, u64, u64) {
    let (start, log_pos) = with_view(|view| (view.start.clone(), view.log_pos)).unwrap_or_default();
    (start, log_pos, crate::bound::revision())
}

fn live(cx: &mut gpui_kit::App) -> gpui_kit::Entity<Shown> {
    use gpui_kit::AppContext as _;
    if let Some(live) = cx.try_global::<Live>() {
        return live.0.clone();
    }
    let live = cx.new(|_| Shown { at: standing() });
    cx.set_global(Live(live.clone()));
    live
}

/// #1546's planted views read the record in render and observe nothing, as the merge base's did.
fn unobserved() -> bool {
    crate::plain::planted("record-in-thread-local")
}

/// A view observes the record: it draws again whenever [`sync`] finds the record or the bound values moved.
pub fn observe<V: 'static>(cx: &mut gpui_kit::Context<V>) {
    on_move(cx, |_, cx| cx.notify());
}

/// Runs `moved` whenever [`sync`] finds the record or the bound values moved, so a view can compare what it would
/// draw with what it drew before it draws again (#2117).
pub fn on_move<V: 'static>(
    cx: &mut gpui_kit::Context<V>,
    mut moved: impl FnMut(&mut V, &mut gpui_kit::Context<V>) + 'static,
) {
    if unobserved() {
        return;
    }
    let live = live(cx);
    cx.observe(&live, move |view, _, cx| moved(view, cx))
        .detach();
}

/// Tells the views where the record and the bound values stand: those that observe them draw again if either moved.
pub fn sync(cx: &mut gpui_kit::App) {
    if unobserved() {
        return;
    }
    let at = standing();
    let moved = live(cx).update(cx, |shown, cx| {
        let moved = shown.at != at;
        if moved {
            shown.at = at;
            cx.notify();
        }
        moved
    });
    // A panel's script reads the record through `deepbuild.needs_you`, so it renders again too (#1459).
    if moved {
        crate::refresh_panels(cx);
    }
}

/// Tells the views something they draw beside the record moved, such as what the app can reach (#994).
pub fn notify_views(cx: &mut gpui_kit::App) {
    if !unobserved() {
        live(cx).update(cx, |_, cx| cx.notify());
    }
}

/// Delivers one event to a record held in memory, as the hub's stream would, and tells the views (a replica's feed).
pub fn deliver(event: Value, cx: &mut gpui_kit::App) {
    feed(event);
    sync(cx);
}

/// The one screen the window shows while the hub it reached is older than the app (#41): which side is older, and
/// the one step that fixes it. `None` once a hub covers the app, or before any hub answered.
pub fn older() -> Option<String> {
    OLDER.with(|older| older.borrow().clone())
}

thread_local! {
    static OLDER: RefCell<Option<String>> = const { RefCell::new(None) };
    static READER: RefCell<Option<Source>> = const { RefCell::new(None) };
}

/// Makes `reader` the app's one record reader: every view reads what it holds.
pub fn install(reader: RecordReader) {
    READER.with(|cell| *cell.borrow_mut() = Some(Source::Hub(Box::new(reader))));
}

/// Makes a record held in memory the one reader's, its events applied in order: the replica's record.
pub fn install_local(events: impl IntoIterator<Item = Value>) {
    let mut view = View::default();
    let record: Vec<Value> = events.into_iter().collect();
    for event in &record {
        view.apply(event.clone());
    }
    READER.with(|cell| {
        *cell.borrow_mut() = Some(Source::Local(Box::new(view), record, LocalHub::Answers))
    });
}

/// Delivers one event to a record held in memory, as the hub's stream would.
pub fn feed(event: Value) {
    READER.with(|cell| {
        if let Some(Source::Local(view, record, _)) = cell.borrow_mut().as_mut() {
            if event["log_pos"].as_u64().unwrap_or(0) > view.log_pos {
                view.apply(event.clone());
                record.push(event);
            }
        }
    });
}

/// Handles what the hub sends within `timeout`; a record held in memory has nothing to wait for.
pub fn poll(timeout: Duration) -> Result<(), HubError> {
    READER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(Source::Hub(reader)) => reader.poll(timeout),
        Some(Source::Local(_, _, LocalHub::Refuses)) => Err(HubError::Refused(json!({}))),
        _ => Ok(()),
    })
}

/// Whether the one reader holds a connection to the hub.
pub fn connected() -> bool {
    READER.with(|cell| match cell.borrow().as_ref() {
        Some(Source::Hub(reader)) => reader.client.is_some(),
        Some(Source::Local(_, _, hub)) => *hub == LocalHub::Answers,
        None => false,
    })
}

/// One read of the hub: whether it answered. A refusal counts as no answer.
pub fn read(timeout: Duration) -> bool {
    match poll(timeout) {
        Ok(()) => connected(),
        Err(error) => {
            eprintln!("deep-app: the hub refused a read: {error:?}");
            false
        }
    }
}

/// Tells the hub the app's notification setting.
pub fn report_setting(setting: &'static str) {
    READER.with(|cell| {
        if let Some(Source::Hub(reader)) = cell.borrow_mut().as_mut() {
            reader.report(setting);
        }
    });
}

/// How the replica's record answers reads from now on.
pub fn set_local_hub(hub: LocalHub) {
    READER.with(|cell| {
        if let Some(Source::Local(_, _, answers)) = cell.borrow_mut().as_mut() {
            *answers = hub;
        }
    });
}

/// Reads the one reader's view; `None` before one is installed.
pub fn with_view<R>(read: impl FnOnce(&View) -> R) -> Option<R> {
    READER.with(|cell| {
        cell.borrow().as_ref().map(|source| match source {
            Source::Hub(reader) => read(&reader.view),
            Source::Local(view, ..) => read(view),
        })
    })
}

/// Takes the events the notifier reads that the one reader applied since they were last taken.
pub fn take_unseen() -> Vec<Value> {
    READER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(Source::Hub(reader)) => std::mem::take(&mut reader.view.unseen),
        Some(Source::Local(view, ..)) => std::mem::take(&mut view.unseen),
        None => Vec::new(),
    })
}

/// One call to the hub on the one reader's connection; `None` when no hub is connected or it refused.
pub fn call(method: &str, params: Value) -> Option<Value> {
    READER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(Source::Hub(reader)) => reader.client.as_mut()?.call(method, params).ok(),
        _ => None,
    })
}

/// The record's events up to the one reader's `log_pos`, oldest first, for a view that needs its history: read from
/// the hub when the view asks, or the record held in memory. Empty when the hub can't be read.
pub fn history() -> Vec<Value> {
    READER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(Source::Hub(reader)) => reader.history().unwrap_or_default(),
        Some(Source::Local(_, record, _)) => record.clone(),
        None => Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(view: &View, ask: &str) -> (String, String) {
        let row = view
            .inbox
            .iter()
            .find(|row| row["ask"] == ask)
            .expect("a row");
        (
            row["status"].as_str().unwrap().to_owned(),
            row["outcome"].as_str().unwrap().to_owned(),
        )
    }

    #[test]
    fn the_inbox_closes_an_ask_as_the_core_does() {
        let mut view = View::default();
        for id in ["a1", "a2", "a3"] {
            view.apply(json!({"kind": "ask.created", "id": id, "session": "s1", "data": {"kind": "choice"}}));
        }
        view.apply(
            json!({"kind": "decision.applied", "writer": "core", "subject": "ask:a3",
                          "data": {"decision": "d1", "ask": "ask:a1"}}),
        );
        view.apply(json!({"kind": "ask.cancelled", "writer": "mcp:agent", "subject": "ask:a2", "data": {}}));
        view.apply(
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a1", "data": {}}),
        );
        let closed = |outcome: &str| ("closed".to_owned(), outcome.to_owned());
        let open = ("shown".to_owned(), "unanswered".to_owned());
        assert_eq!(row(&view, "ask:a1"), closed("decided_for_you"));
        assert_eq!(row(&view, "ask:a2"), open);
        assert_eq!(row(&view, "ask:a3"), open);

        // The core undoes a2's default: open again. An agent's undo, or one of an answer, opens nothing.
        let defaulted = |id: &str| json!({"kind": "ask.defaulted", "writer": "core", "subject": format!("ask:{id}"), "data": {}});
        let undo = |id: &str, writer: &str| json!({"kind": "default.undone", "writer": writer, "subject": format!("ask:{id}"), "data": {"deadline": 9}});
        view.apply(defaulted("a2"));
        view.apply(defaulted("a3"));
        view.apply(undo("a1", "core"));
        view.apply(undo("a2", "core"));
        view.apply(undo("a3", "mcp:agent"));
        assert_eq!(row(&view, "ask:a1"), closed("decided_for_you"));
        assert_eq!(row(&view, "ask:a2"), open);
        assert_eq!(row(&view, "ask:a3"), closed("defaulted"));
    }

    #[test]
    fn only_the_cores_later_moves_an_ask_to_later() {
        let mut view = View::default();
        for id in ["a1", "a2"] {
            view.apply(json!({"kind": "ask.created", "id": id, "session": "s1", "data": {"kind": "choice"}}));
        }
        let later = |id: &str, writer: &str| json!({"kind": "ask.later", "writer": writer, "subject": format!("ask:{id}"), "data": {"until": 9}});
        view.apply(later("a1", "cli"));
        view.apply(later("a2", "core"));
        assert_eq!(row(&view, "ask:a1").0, "shown");
        assert_eq!(row(&view, "ask:a2").0, "later");
    }
}
