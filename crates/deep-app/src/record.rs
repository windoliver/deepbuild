//! The app's one record reader (#34): it holds the hub's stream and its `log_pos` and feeds every view, so no two
//! views show the record as of different log positions. It reads the inbox, subscribes after the `log_pos` that
//! read reflects, ignores a frame it already has, refetches from its last `log_pos` when a frame isn't the next
//! one and moves to the `log_pos` the refetch reflects, and redoes its reads when the hub's start ID is new,
//! since frames it got before a power cut may be gone. A consumer cut off with `fell_behind` resumes from its
//! last `log_pos`.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};

/// The kinds that close an ask, and the outcome the inbox shows for each, as the asks core names them.
const CLOSING: [(&str, &str); 6] = [
    ("ask.answered", "answered"),
    ("ask.defaulted", "defaulted"),
    ("ask.escalated", "escalated"),
    ("ask.cancelled", "cancelled"),
    ("ask.superseded", "superseded"),
    ("ask.moot", "moot"),
];
/// The events one refetch asks for at a time.
const PAGE: usize = 1000;

/// The record as of one start ID and one `log_pos`.
#[derive(Clone, Debug, Default)]
pub struct View {
    /// The hub start ID the view was read under.
    pub start: String,
    /// The `log_pos` the view reflects.
    pub log_pos: u64,
    /// The inbox read's rows, with a row for each ask created since and each close applied.
    pub inbox: Vec<Value>,
    /// Each event applied since the reads, in `log_pos` order, each once.
    pub events: Vec<Value>,
}

impl View {
    /// Applies one event the view doesn't have yet.
    pub fn apply(&mut self, event: Value) {
        self.log_pos = event["log_pos"].as_u64().unwrap_or(self.log_pos);
        let kind = event["kind"].as_str().unwrap_or_default();
        if kind == "ask.created" {
            let ask = format!("ask:{}", event["id"].as_str().unwrap_or_default());
            if !self.inbox.iter().any(|row| row["ask"] == ask.as_str()) {
                self.inbox.push(json!({
                    "ask": ask, "kind": event["data"]["kind"], "session": event["session"],
                    "status": "shown", "outcome": "unanswered", "owner": event["data"]["owner"],
                }));
            }
        } else if let Some((_, outcome)) = CLOSING.iter().find(|(k, _)| *k == kind) {
            let ask = event["subject"].as_str().unwrap_or_default();
            for row in self.inbox.iter_mut().filter(|row| row["ask"] == ask) {
                row["status"] = json!("closed");
                row["outcome"] = json!(outcome);
            }
        }
        self.events.push(event);
    }
}

pub struct RecordReader {
    socket: PathBuf,
    token_file: PathBuf,
    client: Option<HubClient>,
    view: View,
}

impl RecordReader {
    /// Connects as the app, does its reads and subscribes after the `log_pos` they reflect.
    pub fn open(socket: &Path, token_file: &Path) -> Result<RecordReader, HubError> {
        let mut reader = RecordReader {
            socket: socket.to_path_buf(),
            token_file: token_file.to_path_buf(),
            client: None,
            view: View::default(),
        };
        reader.connect()?;
        Ok(reader)
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
                events: Vec::new(),
            };
        }
        client.call("stream.subscribe", json!({ "after": self.view.log_pos }))?;
        self.client = Some(client);
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
}

/// Where the one reader reads: the hub's socket in the app, or a record the replica feeds event by event.
enum Source {
    Hub(Box<RecordReader>),
    Local(View),
}

thread_local! {
    static READER: RefCell<Option<Source>> = const { RefCell::new(None) };
}

/// Makes `reader` the app's one record reader: every view reads what it holds.
pub fn install(reader: RecordReader) {
    READER.with(|cell| *cell.borrow_mut() = Some(Source::Hub(Box::new(reader))));
}

/// Makes a record held in memory the one reader's, its events applied in order: the replica's record.
pub fn install_local(events: impl IntoIterator<Item = Value>) {
    let mut view = View::default();
    for event in events {
        view.apply(event);
    }
    READER.with(|cell| *cell.borrow_mut() = Some(Source::Local(view)));
}

/// Delivers one event to a record held in memory, as the hub's stream would.
pub fn feed(event: Value) {
    READER.with(|cell| {
        if let Some(Source::Local(view)) = cell.borrow_mut().as_mut() {
            if event["log_pos"].as_u64().unwrap_or(0) > view.log_pos {
                view.apply(event);
            }
        }
    });
}

/// Handles what the hub sends within `timeout`; a record held in memory has nothing to wait for.
pub fn poll(timeout: Duration) -> Result<(), HubError> {
    READER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(Source::Hub(reader)) => reader.poll(timeout),
        _ => Ok(()),
    })
}

/// Reads the one reader's view; `None` before one is installed.
pub fn with_view<R>(read: impl FnOnce(&View) -> R) -> Option<R> {
    READER.with(|cell| {
        cell.borrow().as_ref().map(|source| match source {
            Source::Hub(reader) => read(&reader.view),
            Source::Local(view) => read(view),
        })
    })
}
