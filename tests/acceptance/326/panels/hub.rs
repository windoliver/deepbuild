//! #326 AC4: a hub on a Unix socket that speaks the App API's line protocol (the hello, the reads,
//! `events.read`, and `stream.subscribe` with a frame per appended event, in `log_pos` order, each
//! sent once; tests/acceptance/34/README.md, The socket), and the ask events it serves. Shared by
//! `panels.rs` and `planted.rs`.
#![allow(dead_code)]

use std::{
    io::{BufRead as _, BufReader, Write as _},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
};

use serde_json::{json, Value};

use super::common::Scratch;

pub const SESSION: &str = "c0ffee00-1111-2222-3333-444455556666";
pub const START: &str = "01K7START00000000000326";

pub fn event_id(log_pos: u64) -> String {
    format!("01K7{log_pos:022}")
}

/// An `ask.created` as the asks core appends it; the ask's handle is `ask:<its event ID>`.
pub fn ask_created(log_pos: u64) -> Value {
    json!({
        "v": 1, "id": event_id(log_pos), "kind": "ask.created", "log_pos": log_pos,
        "writer": "core", "actor": "you", "scope": "you", "ts": 1_800_000_000_000u64 + log_pos,
        "session": SESSION, "agent": "claude-code",
        "data": {
            "kind": "taste", "question": format!("Which header colour, take {log_pos}?"),
            "options": [
                { "id": "blue", "label": "Blue header", "decision": "none" },
                { "id": "green", "label": "Green header", "decision": "none" }
            ],
            "recommended": "blue", "deadline": 1_800_086_400_000u64, "fallback": "you", "default": "blue",
            "provisional": false, "owner": "you",
            "key": format!("{log_pos:064}"),
            "pinned_to": { "kind": "evidence", "ref": format!("{log_pos:064}") }
        },
        "evidence": [], "verified": true,
    })
}

/// An `ask.answered` closing the ask `handle`.
pub fn ask_answered(log_pos: u64, handle: &str) -> Value {
    json!({
        "v": 1, "id": event_id(log_pos), "kind": "ask.answered", "log_pos": log_pos, "subject": handle,
        "writer": "app", "actor": "you", "scope": "you", "ts": 1_800_000_000_000u64 + log_pos,
        "session": SESSION, "agent": "claude-code",
        "data": { "option": "blue", "decision": "none" },
        "evidence": [], "verified": true,
    })
}

pub fn handle_of(event: &Value) -> String {
    format!("ask:{}", event["id"].as_str().unwrap())
}

/// A hub on a Unix socket that speaks the App API's line protocol (tests/acceptance/34/README.md,
/// The socket): the hello, the reads, `events.read`, and `stream.subscribe` with a frame for
/// each event appended, in `log_pos` order, sent once.
pub struct Hub {
    _scratch: Scratch,
    pub socket: PathBuf,
    pub token_file: PathBuf,
    shared: Arc<(Mutex<HubState>, Condvar)>,
}

#[derive(Default)]
struct HubState {
    log: Vec<Value>,
    subscribers: Vec<(Arc<Mutex<UnixStream>>, Value, u64)>,
    subscriptions: usize,
}

fn write_line(writer: &Arc<Mutex<UnixStream>>, line: &Value) {
    let mut text = line.to_string();
    text.push('\n');
    let _ = writer.lock().unwrap().write_all(text.as_bytes());
}

impl HubState {
    fn end(&self) -> u64 {
        self.log
            .last()
            .map_or(0, |event| event["log_pos"].as_u64().unwrap())
    }

    fn inbox(&self) -> Vec<Value> {
        let mut rows: Vec<Value> = Vec::new();
        for event in &self.log {
            if event["kind"] == "ask.created" {
                rows.push(json!({
                    "ask": handle_of(event), "kind": event["data"]["kind"], "session": SESSION,
                    "status": "shown", "outcome": "unanswered", "owner": "you",
                }));
            } else if event["kind"] == "ask.answered" {
                for row in rows.iter_mut().filter(|row| row["ask"] == event["subject"]) {
                    row["status"] = json!("closed");
                    row["outcome"] = json!("answered");
                }
            }
        }
        rows
    }

    /// Sends each subscriber the frames it hasn't had.
    fn flush(&mut self) {
        let log = self.log.clone();
        for (writer, id, sent) in &mut self.subscribers {
            let from = *sent;
            for event in log
                .iter()
                .filter(|event| event["log_pos"].as_u64().unwrap() > from)
            {
                write_line(writer, &json!({ "v": 1, "id": id, "event": event }));
                *sent = event["log_pos"].as_u64().unwrap();
            }
        }
    }
}

impl Hub {
    pub fn start() -> Hub {
        let scratch = Scratch::new();
        let socket = scratch.0.join("hub.sock");
        let token_file = scratch.0.join("control.token");
        std::fs::write(&token_file, "token-326-panels\n").unwrap();
        let shared = Arc::new((Mutex::new(HubState::default()), Condvar::new()));
        let listener = UnixListener::bind(&socket).unwrap();
        let accepting = shared.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let shared = accepting.clone();
                std::thread::spawn(move || serve(stream, shared));
            }
        });
        Hub {
            _scratch: scratch,
            socket,
            token_file,
            shared,
        }
    }

    pub fn append(&self, event: Value) {
        let mut state = self.shared.0.lock().unwrap();
        state.log.push(event);
        state.flush();
        self.shared.1.notify_all();
    }

    pub fn subscriptions(&self) -> usize {
        self.shared.0.lock().unwrap().subscriptions
    }
}

fn serve(stream: UnixStream, shared: Arc<(Mutex<HubState>, Condvar)>) {
    let writer = Arc::new(Mutex::new(stream.try_clone().unwrap()));
    write_line(
        &writer,
        &json!({ "v": 1, "hello": "deep-hub", "start": START, "features": [] }),
    );
    let mut lines = BufReader::new(stream).lines();
    let Some(Ok(first)) = lines.next() else {
        return;
    };
    let hello: Value = serde_json::from_str(&first).unwrap_or(Value::Null);
    if hello["hello"] != "app" || hello["token"] != "token-326-panels" {
        write_line(
            &writer,
            &json!({ "v": 1, "id": null, "error": { "code": "credential" } }),
        );
        return;
    }
    write_line(&writer, &json!({ "v": 1, "role": "app" }));
    for line in lines {
        let Ok(line) = line else { return };
        let Ok(call) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = call["id"].clone();
        let method = call["method"].as_str().unwrap_or_default().to_owned();
        let params = call.get("params").cloned().unwrap_or(json!({}));
        let mut state = shared.0.lock().unwrap();
        let end = state.end();
        let result = match method.as_str() {
            "inbox.read" => json!({ "start": START, "log_pos": end, "asks": state.inbox() }),
            "sessions.read" => {
                json!({ "start": START, "log_pos": end, "sessions": [{ "session": SESSION, "agent": "claude-code" }] })
            }
            "changes.read" => json!({ "start": START, "log_pos": end, "changes": [] }),
            "numbers.read" => json!({ "start": START, "log_pos": end, "numbers": {} }),
            "events.read" => {
                let after = params["after"].as_u64().unwrap_or(0);
                let events: Vec<Value> = state
                    .log
                    .iter()
                    .filter(|event| event["log_pos"].as_u64().unwrap() > after)
                    .cloned()
                    .collect();
                json!({ "start": START, "log_pos": end.max(after), "events": events })
            }
            "stream.subscribe" => {
                let after = params["after"].as_u64().unwrap_or(end);
                write_line(
                    &writer,
                    &json!({ "v": 1, "id": id, "result": { "subscribed": true, "after": after, "start": START } }),
                );
                state.subscriptions += 1;
                state.subscribers.push((writer.clone(), id.clone(), after));
                state.flush();
                continue;
            }
            other => {
                write_line(
                    &writer,
                    &json!({ "v": 1, "id": id, "error": { "code": "unknown_method", "actual": other } }),
                );
                continue;
            }
        };
        write_line(&writer, &json!({ "v": 1, "id": id, "result": result }));
    }
}
