//! The stand-in hub (README: The stand-in hub): #16's line protocol on a Unix socket, as #34's and #1141's scripted
//! hubs speak it. It says the hello the app's check accepts (#41: the contract and every method the app calls), takes
//! the app's control token, and answers each call with what the test's `answer` gives. It logs every call it receives,
//! by method and in order, and the exact reply line it wrote, so a test counts the calls a page made and parses the
//! pages the app read. It runs on threads of its own, so the counting allocator never counts it.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

pub const START: &str = "01KB2661START0000000000001";

/// What the hub answers a call with: `(method, params, n)`, where `n` counts this method's calls from 1.
pub type Answer = Arc<dyn Fn(&str, &Value, usize) -> Value + Send + Sync>;

/// One call the hub received.
#[derive(Clone, Debug)]
pub struct Call {
    pub method: String,
    pub params: Value,
    /// The reply line the hub wrote for it, as sent.
    pub reply: String,
}

pub struct StandIn {
    dir: PathBuf,
    pub socket: PathBuf,
    pub token_file: PathBuf,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl Drop for StandIn {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

static HUBS: AtomicUsize = AtomicUsize::new(0);

impl StandIn {
    pub fn start(answer: Answer) -> StandIn {
        let n = HUBS.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(format!("/tmp/da2661-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the stand-in hub's folder");
        let socket = dir.join("hub.sock");
        let token_file = dir.join("control.token");
        let token = format!("stand-in-token-{}-{n}", std::process::id());
        std::fs::write(&token_file, format!("{token}\n")).expect("the control token");
        let listener = UnixListener::bind(&socket).expect("the stand-in hub's socket");
        let calls: Arc<Mutex<Vec<Call>>> = Arc::default();
        let log = calls.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let (token, answer, log) = (token.clone(), answer.clone(), log.clone());
                thread::spawn(move || serve(stream, &token, answer, log));
            }
        });
        StandIn {
            dir,
            socket,
            token_file,
            calls,
        }
    }

    /// Every call received so far, in order.
    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    /// How many calls of `method` the hub has received.
    pub fn count(&self, method: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call.method == method)
            .count()
    }
}

/// The hello the app's check accepts: the contract it speaks and every method it calls (`hub::NEEDS`).
fn hello() -> Value {
    json!({
        "v": 1, "hello": "deep-hub", "start": START, "contract": deep_app::hub::CONTRACT,
        "features": deep_app::hub::NEEDS,
    })
}

fn serve(stream: UnixStream, token: &str, answer: Answer, log: Arc<Mutex<Vec<Call>>>) {
    let mut writer = stream.try_clone().expect("the connection's writer");
    let mut write = |line: &str| writer.write_all(format!("{line}\n").as_bytes()).is_ok();
    if !write(&hello().to_string()) {
        return;
    }
    let mut lines = BufReader::new(stream).lines();
    let Some(Ok(first)) = lines.next() else {
        return;
    };
    let said: Value = serde_json::from_str(&first).unwrap_or(Value::Null);
    if said["hello"] != "app" || said["token"] != token {
        write(&json!({ "v": 1, "id": null, "error": { "code": "credential", "retryable": false } }).to_string());
        return;
    }
    write(&json!({ "v": 1, "role": "app" }).to_string());
    for line in lines {
        let Ok(line) = line else { return };
        let Ok(call) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let method = call["method"].as_str().unwrap_or_default().to_owned();
        let params = call.get("params").cloned().unwrap_or(json!({}));
        let n = 1 + log
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.method == method)
            .count();
        let result = answer(&method, &params, n);
        let reply = json!({ "v": 1, "id": call["id"], "result": result }).to_string();
        // Logged before it is written, so a test that sees the reply also sees the call.
        log.lock().unwrap().push(Call {
            method,
            params,
            reply: reply.clone(),
        });
        if !write(&reply) {
            return;
        }
    }
}

/// The calls every reader makes at connect, on a record of `events` (each with its `log_pos`, in order): the inbox's
/// read with no asks and no rows, its pages a thousand at a time, and the subscription. `None` for any other method.
pub fn record_answer(method: &str, params: &Value, events: &dyn Fn(u64) -> Value, end: u64) -> Option<Value> {
    Some(match method {
        "inbox.read" => json!({ "start": START, "log_pos": end, "asks": [] }),
        "events.read" => {
            let after = params["after"].as_u64().unwrap_or(0);
            let limit = params["limit"].as_u64().unwrap_or(1_000).clamp(1, 1_000);
            let last = end.min(after + limit);
            let page: Vec<Value> = (after + 1..=last).map(events).collect();
            // A full page reflects its last event, a short one the log's end.
            let log_pos = if last.saturating_sub(after) == limit { last } else { end.max(after) };
            json!({ "start": START, "log_pos": log_pos, "events": page })
        }
        "stream.subscribe" => {
            json!({ "subscribed": true, "after": params["after"].as_u64().unwrap_or(end), "start": START })
        }
        _ => return None,
    })
}
