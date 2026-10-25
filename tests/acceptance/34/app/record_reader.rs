//! #34, the app's half: the app's one record reader, `deep_app::record::RecordReader`, against the issue's test
//! stream (a scripted hub on a Unix socket, `TestStream` below, which drops, repeats and skips frames as each
//! criterion says) and against a real hub on the design's test VFS. The reader is the only consumer of the
//! stream in the app (technical-design.md, Extension API: the App API row), so these tests reach it alone.
//!
//! Wired into deep-app by one `[[test]]` entry in crates/deep-app/Cargo.toml (README, The surface):
//!     [[test]]
//!     name = "acceptance_34"
//!     path = "../../tests/acceptance/34/app/record_reader.rs"
//! and run, from the checkout, with `cargo test --locked -p deep-app --test acceptance_34 -- --test-threads=1`
//! (`app.test.ts` does that). The real-hub test runs the built CLI, `packages/cli/dist/main.js`, with the `node`
//! on PATH (24.22 or newer); it starts its own hub on a temp home and stops only that process, by its PID.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use deep_app::hub::HubClient;
use deep_app::record::{RecordReader, View};
use serde_json::{json, Value};

// ---- Folders: short paths under /tmp, since a Unix socket's path must fit in 104 bytes on macOS.

static NEXT: AtomicU32 = AtomicU32::new(0);

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let dir = PathBuf::from(format!(
            "/tmp/da34-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ---- Events as the hub's record writes them (`toJson` of @deepbuild/record, plus `verified`).

/// An event ID: a ULID-shaped string that names its log_pos, so a failure message can be read back.
fn event_id(log_pos: u64) -> String {
    format!("01K7{log_pos:022}")
}
fn tool_event(log_pos: u64) -> Value {
    json!({
        "v": 1, "id": event_id(log_pos), "kind": "tool.before", "log_pos": log_pos,
        "writer": "hook", "actor": "you", "scope": "you", "ts": 1_760_013_451_123u64 + log_pos,
        "seq": format!("{}", 1_760_013_451_123_456_789u64 + log_pos),
        "session": "c0ffee00-1111-2222-3333-444455556666", "agent": "claude-code",
        "data": { "kind": "shell", "paths": [], "command": "npm test" }, "evidence": [], "verified": true,
    })
}
/// An `ask.created` as the asks core appends it (#318): the ask's handle is `ask:<the event's ID>`.
fn ask_event(log_pos: u64) -> Value {
    json!({
        "v": 1, "id": event_id(log_pos), "kind": "ask.created", "log_pos": log_pos,
        "writer": "core", "actor": "you", "scope": "you", "ts": 1_760_013_451_123u64 + log_pos,
        "data": {
            "kind": "taste", "question": "Which header colour?",
            "options": [
                { "id": "blue", "label": "Blue header", "decision": "none" },
                { "id": "green", "label": "Green header", "decision": "none" }
            ],
            "recommended": "blue", "deadline": 1_760_186_251_123u64, "fallback": "you", "default": "blue",
            "provisional": false, "owner": "you",
            "key": "e3ec83bf9a447263636dfa7746083bdc44fedc91cb656f21f18d9060159b7bcd",
            "pinned_to": { "kind": "evidence", "ref": "894368daa195264b0ee144b62f90e92318d394d925f9e2a6691cb8b48d5efb42" }
        },
        "evidence": [], "verified": true,
    })
}
fn handle_of(event: &Value) -> String {
    format!("ask:{}", event["id"].as_str().unwrap())
}

// ---- The test stream: a scripted hub that speaks the hub's line protocol (README, The socket).

#[derive(Clone, Debug)]
struct Request {
    method: String,
    params: Value,
    answered: bool,
}

struct State {
    start: String,
    token: String,
    /// The log, in log_pos order; positions it lacks were never handed out (a power cut's gap).
    log: Vec<Value>,
    /// The inbox projection: one row per ask the log created.
    inbox: Vec<Value>,
    /// Every method call, in the order it arrived.
    requests: Vec<Request>,
}
impl State {
    fn end(&self) -> u64 {
        self.log
            .last()
            .map_or(0, |e| e["log_pos"].as_u64().unwrap())
    }
    fn append(&mut self, event: Value) {
        if event["kind"] == "ask.created" {
            self.inbox.push(json!({
                "ask": handle_of(&event), "kind": event["data"]["kind"], "session": "",
                "status": "shown", "outcome": "unanswered", "owner": "you", "age": 0
            }));
        }
        self.log.push(event);
    }
}

type Shared = Arc<(Mutex<State>, Condvar)>;
type Script = Arc<dyn Fn(&Feed) + Send + Sync>;

/// What a script does on one subscription: append to the log, open the subscription, send frames, wait.
struct Feed {
    shared: Shared,
    writer: Arc<Mutex<UnixStream>>,
    sub: Value,
    /// The `after` the consumer subscribed with; None when it asked for the stream's current end.
    after: Option<u64>,
}
impl Feed {
    fn append(&self, event: Value) {
        let (lock, cv) = &*self.shared;
        lock.lock().unwrap().append(event);
        cv.notify_all();
    }
    fn write(&self, line: &Value) {
        let mut text = line.to_string();
        text.push('\n');
        let _ = self.writer.lock().unwrap().write_all(text.as_bytes());
    }
    /// The subscription's reply, the stream's first frame: it carries the start ID. Then, as the hub does, a frame
    /// for every event after `after` already in the log; asked with no `after`, the stream starts at its current end.
    fn open(&self) {
        let (start, catch_up) = {
            let state = self.shared.0.lock().unwrap();
            let after = self.after.unwrap_or_else(|| state.end());
            let catch_up: Vec<Value> = state
                .log
                .iter()
                .filter(|e| e["log_pos"].as_u64().unwrap() > after)
                .cloned()
                .collect();
            (state.start.clone(), catch_up)
        };
        let after = self.after.map_or(Value::Null, Value::from);
        self.write(&json!({ "v": 1, "id": self.sub, "result": { "subscribed": true, "after": after, "start": start } }));
        for event in catch_up {
            self.write(&json!({ "v": 1, "id": self.sub, "event": event }));
        }
    }
    /// A frame for the event at `log_pos`, which must be in the log.
    fn frame(&self, log_pos: u64) {
        let event = {
            let state = self.shared.0.lock().unwrap();
            state
                .log
                .iter()
                .find(|e| e["log_pos"] == log_pos)
                .cloned()
                .expect("a frame for an event in the log")
        };
        self.write(&json!({ "v": 1, "id": self.sub, "event": event }));
    }
    /// Waits until an `events.read` from `after` has been answered, or the time is up.
    fn wait_for_read_from(&self, after: u64, within: Duration) -> bool {
        let (lock, cv) = &*self.shared;
        let deadline = Instant::now() + within;
        let mut state = lock.lock().unwrap();
        loop {
            if state
                .requests
                .iter()
                .any(|r| r.answered && r.method == "events.read" && r.params["after"] == after)
            {
                return true;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = cv.wait_timeout(state, deadline - now).unwrap().0;
        }
    }
}

struct TestStream {
    /// Holds the socket and the token file; removed when the stream is dropped.
    _dir: TempDir,
    socket: PathBuf,
    token_file: PathBuf,
    shared: Shared,
}
impl TestStream {
    /// A test stream whose log holds the events at log_pos 1 to `up_to`, with `script` run on each subscription.
    fn new(up_to: u64, script: impl Fn(&Feed) + Send + Sync + 'static) -> Self {
        let dir = TempDir::new();
        let socket = dir.0.join("hub.sock");
        let token_file = dir.0.join("control.token");
        let token = format!("test-stream-token-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        std::fs::write(&token_file, format!("{token}\n")).unwrap();
        let shared: Shared = Arc::new((
            Mutex::new(State {
                start: format!("01K7START{:017}", NEXT.fetch_add(1, Ordering::Relaxed)),
                token,
                log: (1..=up_to).map(tool_event).collect(),
                inbox: Vec::new(),
                requests: Vec::new(),
            }),
            Condvar::new(),
        ));
        let listener = UnixListener::bind(&socket).unwrap();
        let script: Script = Arc::new(script);
        let accepting = shared.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let shared = accepting.clone();
                let script = script.clone();
                thread::spawn(move || serve(stream, shared, script));
            }
        });
        TestStream {
            _dir: dir,
            socket,
            token_file,
            shared,
        }
    }
    fn requests(&self) -> Vec<Request> {
        self.shared.0.lock().unwrap().requests.clone()
    }
    fn reads_from(&self, after: u64) -> usize {
        self.requests()
            .iter()
            .filter(|r| r.method == "events.read" && r.params["after"] == after)
            .count()
    }
    fn subscriptions(&self) -> Vec<Value> {
        self.requests()
            .into_iter()
            .filter(|r| r.method == "stream.subscribe")
            .map(|r| r.params)
            .collect()
    }
}

fn serve(stream: UnixStream, shared: Shared, script: Script) {
    let writer = Arc::new(Mutex::new(stream.try_clone().unwrap()));
    let write = |line: &Value| {
        let mut text = line.to_string();
        text.push('\n');
        let _ = writer.lock().unwrap().write_all(text.as_bytes());
    };
    let start = shared.0.lock().unwrap().start.clone();
    write(&json!({ "v": 1, "hello": "deep-hub", "start": start, "features": [] }));
    let mut lines = BufReader::new(stream).lines();
    let Some(Ok(first)) = lines.next() else {
        return;
    };
    let hello: Value = serde_json::from_str(&first).unwrap_or(Value::Null);
    let token = shared.0.lock().unwrap().token.clone();
    if hello["hello"] != "app" || hello["token"] != token.as_str() {
        write(
            &json!({ "v": 1, "id": null, "error": { "code": "credential", "retryable": false, "remediation": "Present the control token.", "path": "/token", "actual": "", "evidence": [] } }),
        );
        return;
    }
    write(&json!({ "v": 1, "role": "app" }));
    for line in lines {
        let Ok(line) = line else { return };
        let Ok(call) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = call["id"].clone();
        let method = call["method"].as_str().unwrap_or_default().to_string();
        let params = call.get("params").cloned().unwrap_or(json!({}));
        let index = {
            let mut state = shared.0.lock().unwrap();
            state.requests.push(Request {
                method: method.clone(),
                params: params.clone(),
                answered: false,
            });
            state.requests.len() - 1
        };
        let reply = {
            let state = shared.0.lock().unwrap();
            let (start, end) = (state.start.clone(), state.end());
            match method.as_str() {
                "inbox.read" => {
                    Some(json!({ "start": start, "log_pos": end, "asks": state.inbox }))
                }
                "sessions.read" => Some(json!({ "start": start, "log_pos": end, "sessions": [] })),
                "numbers.read" => Some(json!({ "start": start, "log_pos": end, "numbers": {} })),
                "events.read" => {
                    let after = params["after"].as_u64().unwrap_or(0);
                    let limit = params["limit"].as_u64().unwrap_or(1000).clamp(1, 1000) as usize;
                    let page: Vec<Value> = state
                        .log
                        .iter()
                        .filter(|e| e["log_pos"].as_u64().unwrap() > after)
                        .take(limit)
                        .cloned()
                        .collect();
                    // A full page reflects its last event; a short one reflects the log's end, gaps included.
                    let log_pos = if page.len() == limit {
                        page.last().unwrap()["log_pos"].as_u64().unwrap()
                    } else {
                        end.max(after)
                    };
                    Some(json!({ "start": start, "log_pos": log_pos, "events": page }))
                }
                "stream.subscribe" => None,
                _ => {
                    write(
                        &json!({ "v": 1, "id": id, "error": { "code": "unknown_method", "retryable": false, "remediation": "The test stream serves the reads and the stream.", "path": "/method", "actual": method, "evidence": [] } }),
                    );
                    continue;
                }
            }
        };
        match reply {
            Some(result) => write(&json!({ "v": 1, "id": id, "result": result })),
            None => {
                let feed = Feed {
                    shared: shared.clone(),
                    writer: writer.clone(),
                    sub: id.clone(),
                    after: params["after"].as_u64(),
                };
                let script = script.clone();
                thread::spawn(move || script(&feed));
            }
        }
        let (lock, cv) = &*shared;
        lock.lock().unwrap().requests[index].answered = true;
        cv.notify_all();
    }
}

// ---- Driving the reader.

/// Polls the reader until `done` holds for its view or the time is up; returns the last view.
fn pump(reader: &mut RecordReader, within: Duration, done: impl Fn(&View) -> bool) -> View {
    let deadline = Instant::now() + within;
    loop {
        let view = reader.view();
        if done(&view) || Instant::now() >= deadline {
            return view;
        }
        reader
            .poll(Duration::from_millis(50))
            .expect("the record reader's poll");
    }
}
/// Polls the reader for `long`, whatever it shows, so a late frame or refetch has time to happen.
fn settle(reader: &mut RecordReader, long: Duration) -> View {
    pump(reader, long, |_| false)
}
fn positions(view: &View) -> Vec<u64> {
    view.events
        .iter()
        .map(|e| {
            e["log_pos"]
                .as_u64()
                .expect("every event the reader holds has its log_pos")
        })
        .collect()
}
/// The first log_pos `expected` holds that the view lacks, and the first it holds twice.
fn first_missing(view: &View, expected: &[u64]) -> Option<u64> {
    let held = positions(view);
    expected.iter().copied().find(|p| !held.contains(p))
}
fn first_twice(view: &View) -> Option<u64> {
    let held = positions(view);
    held.iter()
        .copied()
        .find(|p| held.iter().filter(|q| *q == p).count() > 1)
}

// ---- AC5 #34.ed028526: cold start.

/// The app reads the inbox at log_pos 800; the ask at 801 is appended before its subscription opens.
fn cold_start_stream() -> TestStream {
    TestStream::new(800, |feed| {
        feed.append(ask_event(801));
        feed.open();
    })
}

#[test]
fn ac5_cold_start_the_app_subscribes_after_800_and_shows_the_ask_appended_at_801() {
    let stream = cold_start_stream();
    let mut reader = RecordReader::open(&stream.socket, &stream.token_file)
        .expect("the reader opens on the test stream");
    let ask = handle_of(&ask_event(801));
    let reads: Vec<Request> = stream
        .requests()
        .into_iter()
        .filter(|r| r.method != "stream.subscribe")
        .collect();
    assert!(
        reads.iter().any(|r| r.method == "inbox.read"),
        "the app reads the inbox when it opens; it read: {:?}",
        reads.iter().map(|r| &r.method).collect::<Vec<_>>()
    );
    let view = pump(&mut reader, Duration::from_secs(3), |v| {
        v.inbox.iter().any(|row| row["ask"] == ask.as_str())
    });
    let subscribed = stream.subscriptions();
    assert!(
        view.inbox.iter().any(|row| row["ask"] == ask.as_str()),
        "the app doesn't show {ask}, appended at log_pos 801 after its inbox read at 800 and before its subscription opened; it subscribed with {subscribed:?}"
    );
    assert_eq!(
        subscribed.first().map(|p| p["after"].clone()),
        Some(json!(800)),
        "the app subscribes after the log_pos its read reflects, 800"
    );
    assert_eq!(
        view.log_pos, 801,
        "the view reflects log_pos 801 once it shows {ask}"
    );
    assert_eq!(
        view.start,
        stream.shared.0.lock().unwrap().start,
        "the view is the start ID's the hub said"
    );
    assert_eq!(positions(&view), vec![801], "the ask's event, once");
}

// ---- AC6 #34.ef7fb9f9: a test stream drops the frame at 701 and sends the one at 702 twice.

fn drop_and_repeat_stream() -> TestStream {
    TestStream::new(700, |feed| {
        feed.open();
        feed.append(tool_event(701));
        feed.append(tool_event(702));
        // 701's frame is dropped; 702's comes twice.
        feed.frame(702);
        feed.frame(702);
        feed.wait_for_read_from(700, Duration::from_secs(2));
        feed.append(tool_event(703));
        feed.frame(703);
    })
}

#[test]
fn ac6_a_dropped_frame_at_701_is_refetched_from_700_before_702_applies_and_702_applies_once() {
    let stream = drop_and_repeat_stream();
    let mut reader = RecordReader::open(&stream.socket, &stream.token_file)
        .expect("the reader opens on the test stream");
    pump(&mut reader, Duration::from_secs(5), |v| v.log_pos >= 703);
    let view = settle(&mut reader, Duration::from_millis(300));
    if let Some(missing) = first_missing(&view, &[701, 702, 703]) {
        panic!(
            "the app skipped log_pos {missing}: it holds {:?}",
            positions(&view)
        );
    }
    if let Some(twice) = first_twice(&view) {
        panic!(
            "the app applied log_pos {twice} more than once: it holds {:?}",
            positions(&view)
        );
    }
    assert_eq!(
        positions(&view),
        vec![701, 702, 703],
        "the app applies 701 before 702, each once, in log_pos order"
    );
    assert!(
        stream.reads_from(700) >= 1,
        "the app refetches from 700 when the frame at 702 isn't the next one; its calls: {:?}",
        stream
            .requests()
            .iter()
            .map(|r| (&r.method, &r.params))
            .collect::<Vec<_>>()
    );
    assert_eq!(view.log_pos, 703, "the view reflects log_pos 703");
}

// ---- AC10 #34.af8f9478: log positions 701 to 749 skipped by a power cut.

fn gap_stream() -> TestStream {
    TestStream::new(700, |feed| {
        feed.open();
        // 701 to 749 were handed out from a block a power cut lost: they stay empty for good.
        feed.append(tool_event(750));
        feed.frame(750);
        feed.wait_for_read_from(700, Duration::from_secs(2));
        for log_pos in 751..=755 {
            feed.append(tool_event(log_pos));
            feed.frame(log_pos);
            thread::sleep(Duration::from_millis(40));
        }
    })
}

#[test]
fn ac10_an_app_at_700_that_gets_750_refetches_from_700_once_moves_to_750_and_refetches_nothing_for_751(
) {
    let stream = gap_stream();
    let mut reader = RecordReader::open(&stream.socket, &stream.token_file)
        .expect("the reader opens on the test stream");
    pump(&mut reader, Duration::from_secs(5), |v| v.log_pos >= 755);
    let view = settle(&mut reader, Duration::from_millis(300));
    let reads: Vec<Value> = stream
        .requests()
        .into_iter()
        .filter(|r| r.method == "events.read")
        .map(|r| r.params)
        .collect();
    assert_eq!(
        stream.reads_from(700),
        1,
        "the app refetched from 700 {} times; once crosses the gap: {reads:?}",
        stream.reads_from(700)
    );
    assert_eq!(
        reads.len(),
        1,
        "the app refetched {} times in all, and none is needed for 751 to 755: {reads:?}",
        reads.len()
    );
    assert_eq!(
        positions(&view),
        vec![750, 751, 752, 753, 754, 755],
        "the app shows the event at 750, from the refetch, then 751 to 755, each once"
    );
    assert_eq!(view.log_pos, 755, "the view reflects log_pos 755");
}

// ---- AC11 #34.6ce4b9ff: with the test VFS, a power cut drops the events at log_pos 900 to 905.

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

struct RealHub {
    child: Child,
    socket: PathBuf,
    start: String,
    root: PathBuf,
    /// Set once this test has ended the process itself, so the drop never signals a PID that may be reused.
    ended: bool,
}
impl RealHub {
    /// `deep hub run` on `home` under the test VFS. `cutAfter` far past any point makes every synchronous=FULL
    /// commit reach ledger.db at once (packages/hub/src/vfs.ts), so a SIGKILL loses exactly what a power cut would.
    fn start(home: &Path) -> Self {
        let mut child = Command::new("node")
            .arg(repo().join("packages/cli/dist/main.js"))
            .args(["hub", "run"])
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", home)
            .env("LC_ALL", "C")
            .env("DEEP_HUB_TEST_VFS", r#"{"cutAfter":1000000000}"#)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("node runs the built deep CLI (npm run build first)");
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        let ready: Value = serde_json::from_str(&ready)
            .unwrap_or_else(|_| panic!("BLOCKED: the hub printed no ready line: {ready:?}"));
        RealHub {
            child,
            socket: PathBuf::from(ready["socket"].as_str().unwrap()),
            start: ready["start"].as_str().unwrap().to_string(),
            root: home.join(".deepbuild"),
            ended: false,
        }
    }
    fn token_file(&self) -> PathBuf {
        self.root.join("control.token")
    }
    fn app(&self) -> HubClient {
        let token = std::fs::read_to_string(self.token_file()).unwrap();
        let mut client = HubClient::connect(&self.socket).expect("the hub answers");
        client
            .hello_app(token.trim())
            .expect("the hub takes the app's credential");
        client
    }
    /// Every log_pos in the log, paged through events.read.
    fn log(&self) -> Vec<(u64, String)> {
        let mut app = self.app();
        let mut out = Vec::new();
        let mut after = 0;
        loop {
            let page = app
                .call("events.read", json!({ "after": after, "limit": 1000 }))
                .expect("events.read");
            let events = page["events"].as_array().cloned().unwrap_or_default();
            if events.is_empty() {
                return out;
            }
            for e in &events {
                out.push((
                    e["log_pos"].as_u64().unwrap(),
                    e["kind"].as_str().unwrap_or_default().to_string(),
                ));
            }
            after = out.last().unwrap().0;
        }
    }
    /// One PreToolUse hook, as deep-hook sends it; the hub appends one tool.before for it.
    fn hook(&self, n: u64) {
        let mut stream = UnixStream::connect(&self.socket).expect("the hub's socket");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut hello = String::new();
        reader.read_line(&mut hello).unwrap();
        let request = json!({
            "v": 1, "agent": "claude-code", "event": "PreToolUse",
            "seq": format!("{}", 1_760_013_451_123_456_789u64 + n), "id": format!("01K74FKZVK8Q2X5R7M{n:08}"),
            "pid": std::process::id(), "ppid": std::process::id(), "matched": [],
            "payload": {
                "session_id": "c0ffee00-1111-2222-3333-444455556666", "transcript_path": "/tmp/da34-none.jsonl",
                "cwd": "/tmp", "hook_event_name": "PreToolUse", "permission_mode": "default",
                "tool_name": "Bash", "tool_input": { "command": "ls" }, "tool_use_id": format!("call_{n}")
            }
        });
        stream.write_all(format!("{request}\n").as_bytes()).unwrap();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                panic!("BLOCKED: the hub closed hook {n} without a reply");
            }
            let line: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
            if line.get("exit").is_some() {
                return;
            }
            assert!(
                line.get("error").is_none(),
                "BLOCKED: the hub refused hook {n}: {line}"
            );
        }
    }
    fn wait_for_end(&self, end: u64) {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let last = self.log().last().map_or(0, |e| e.0);
            if last >= end || Instant::now() > deadline {
                assert_eq!(last, end, "BLOCKED: setup: the log should end at {end}");
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for RealHub {
    fn drop(&mut self) {
        if !self.ended {
            let _ = Command::new("kill")
                .arg(self.child.id().to_string())
                .status();
            let _ = self.child.wait();
        }
    }
}

#[test]
fn ac11_after_a_power_cut_drops_900_to_905_the_app_sees_the_new_start_id_redoes_its_reads_and_no_longer_shows_them(
) {
    let home = TempDir::new();
    let mut hub = RealHub::start(&home.0);
    // The log up to 898 in NORMAL commits, then a verdict at 899 in a synchronous=FULL one: what a cut keeps.
    let have = hub.log().last().map_or(0, |e| e.0);
    assert!(
        have <= 898,
        "BLOCKED: setup: a fresh hub's log already ends at {have}"
    );
    for n in have..898 {
        hub.hook(n);
    }
    hub.wait_for_end(898);
    hub.app()
        .call("test.load", json!({ "verdicts": 1 }))
        .expect("test.load under the test VFS");
    hub.wait_for_end(899);
    assert_eq!(
        hub.log().last().map(|e| e.1.clone()),
        Some("verdict.made".to_string()),
        "BLOCKED: setup: 899 is the FULL verdict"
    );

    let mut reader =
        RecordReader::open(&hub.socket, &hub.token_file()).expect("the reader opens on the hub");
    let opened = pump(&mut reader, Duration::from_secs(5), |v| v.log_pos >= 899);
    assert_eq!(
        opened.start, hub.start,
        "the view is the start ID the hub said in its ready line"
    );
    for n in 900..=905 {
        hub.hook(n);
    }
    let shown = pump(&mut reader, Duration::from_secs(10), |v| {
        (900..=905).all(|p| positions(v).contains(&p))
    });
    assert!(
        (900..=905).all(|p| positions(&shown).contains(&p)),
        "BLOCKED: setup: the app must show the events at 900 to 905 before the cut; it holds {:?}",
        positions(&shown)
    );

    // The power cut: the hub ends as by kill -9, and the test VFS loses every write since the last FULL commit.
    let old = hub.start.clone();
    hub.child.kill().unwrap();
    hub.child.wait().unwrap();
    hub.ended = true;
    drop(hub);
    let hub = RealHub::start(&home.0);
    assert_ne!(hub.start, old, "the restarted hub has a new start ID");
    let log = hub.log();
    let kept: Vec<u64> = log
        .iter()
        .map(|e| e.0)
        .filter(|p| (900..=905).contains(p))
        .collect();
    assert!(
        kept.is_empty(),
        "BLOCKED: setup: the cut should have dropped 900 to 905, and the log holds {kept:?}"
    );
    let end = log.last().map_or(0, |e| e.0);

    pump(&mut reader, Duration::from_secs(15), |v| {
        v.start == hub.start
    });
    let view = settle(&mut reader, Duration::from_millis(1000));
    assert_eq!(
        view.start, hub.start,
        "the app takes the restarted hub's new start ID"
    );
    let still: Vec<u64> = positions(&view)
        .into_iter()
        .filter(|p| (900..=905).contains(p))
        .collect();
    assert!(
        still.is_empty(),
        "the app still shows log_pos {} after the restarted hub's new start ID: it resumed instead of redoing its reads (it holds {:?})",
        still.first().unwrap(),
        positions(&view)
    );
    assert!(
        view.log_pos >= end,
        "the redone reads reflect the restarted hub's log, which ends at {end}; the view is at {}",
        view.log_pos
    );
}
