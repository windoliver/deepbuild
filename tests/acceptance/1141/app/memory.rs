//! #1141 AC1 (`#1141.d671320f`): with 30 sessions and 200,000 streamed events, the app's resident memory stays under
//! 300 MB on the reference Mac; the merge base exceeds it and the test fails, naming the count.
//!
//! A test binary of its own, so the process holds the app's one record reader and nothing another test allocated: the
//! reader opens on a scripted hub on a Unix socket (as #34's test stream, README: The scripted hub), which streams the
//! 200,000 events of `bulk.rs`, each made as it is sent, so the hub keeps none of them. The process's peak resident
//! memory (getrusage's `ru_maxrss`) is read once the reader's view reflects log_pos 200,000.
//!
//! Wired into deep-app by a `[[test]]` entry (`acceptance_1141_memory`); run with
//! `cargo test --locked -p deep-app --test acceptance_1141_memory`.

#[path = "bulk.rs"]
mod bulk;
#[path = "environment.rs"]
mod environment;
#[path = "surface.rs"]
mod surface;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use deep_app::record::{self, RecordReader};
use serde_json::{json, Value};

/// The issue's count and budget.
const EVENTS: u64 = 200_000;
const BUDGET_BYTES: u64 = 300_000_000;
/// The body's events, then `bulk::tail`'s two a session.
const BODY: u64 = EVENTS - 2 * bulk::SESSIONS;

// ---- The scripted hub: #16's line protocol on a Unix socket, the reads the app makes at connect, and one stream.

struct Hub {
    dir: PathBuf,
    socket: PathBuf,
    token_file: PathBuf,
}

impl Drop for Hub {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The record's event at `log_pos`, made when it is sent.
fn at(log_pos: u64) -> Value {
    if log_pos <= BODY {
        bulk::event(log_pos)
    } else {
        let mut tail = bulk::tail(BODY + 1);
        tail.swap_remove((log_pos - BODY - 1) as usize)
    }
}

impl Hub {
    /// A hub whose log is empty when the app connects; once the app subscribes, it appends and streams the record's
    /// 200,000 events in order. `appended` is how far the log has got, for an `events.read`.
    fn start() -> Hub {
        let dir = PathBuf::from(format!("/tmp/da1141-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("hub.sock");
        let token_file = dir.join("control.token");
        let token = format!("scripted-hub-token-{}", std::process::id());
        std::fs::write(&token_file, format!("{token}\n")).unwrap();
        let listener = UnixListener::bind(&socket).unwrap();
        let appended = Arc::new(Mutex::new(0u64));
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let (token, appended) = (token.clone(), appended.clone());
                thread::spawn(move || serve(stream, &token, appended));
            }
        });
        Hub {
            dir,
            socket,
            token_file,
        }
    }
}

const START: &str = "01K9START000000000000001141";

fn serve(stream: UnixStream, token: &str, appended: Arc<Mutex<u64>>) {
    let writer = Arc::new(Mutex::new(stream.try_clone().unwrap()));
    let write = |writer: &Mutex<UnixStream>, line: &Value| {
        let mut text = line.to_string();
        text.push('\n');
        writer.lock().unwrap().write_all(text.as_bytes()).is_ok()
    };
    write(
        &writer,
        &json!({ "v": 1, "hello": "deep-hub", "start": START, "features": [] }),
    );
    let mut lines = BufReader::new(stream).lines();
    let Some(Ok(first)) = lines.next() else {
        return;
    };
    let hello: Value = serde_json::from_str(&first).unwrap_or(Value::Null);
    if hello["hello"] != "app" || hello["token"] != token {
        write(
            &writer,
            &json!({ "v": 1, "id": null, "error": { "code": "credential", "retryable": false } }),
        );
        return;
    }
    write(&writer, &json!({ "v": 1, "role": "app" }));
    for line in lines {
        let Ok(line) = line else { return };
        let Ok(call) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = call["id"].clone();
        let params = call.get("params").cloned().unwrap_or(json!({}));
        let end = *appended.lock().unwrap();
        let result = match call["method"].as_str().unwrap_or_default() {
            "inbox.read" => json!({ "start": START, "log_pos": end, "asks": [] }),
            "sessions.read" => json!({ "start": START, "log_pos": end, "sessions": [] }),
            "events.read" => {
                let after = params["after"].as_u64().unwrap_or(0);
                let limit = params["limit"].as_u64().unwrap_or(1_000).clamp(1, 1_000);
                let last = end.min(after + limit);
                let events: Vec<Value> = (after + 1..=last).map(at).collect();
                // A full page reflects its last event, a short one the log's end.
                let log_pos = if last - after.min(last) == limit {
                    last
                } else {
                    end.max(after)
                };
                json!({ "start": START, "log_pos": log_pos, "events": events })
            }
            "stream.subscribe" => {
                let after = params["after"].as_u64().unwrap_or(end);
                write(
                    &writer,
                    &json!({ "v": 1, "id": id, "result": { "subscribed": true, "after": after, "start": START } }),
                );
                let (writer, appended, sub) = (writer.clone(), appended.clone(), id.clone());
                thread::spawn(move || {
                    let mut next = after + 1;
                    // Catch up on what the log already holds, then append and send the rest, one frame an event.
                    while next <= EVENTS {
                        {
                            let mut end = appended.lock().unwrap();
                            *end = (*end).max(next);
                        }
                        if !write(&writer, &json!({ "v": 1, "id": sub, "event": at(next) })) {
                            return;
                        }
                        next += 1;
                    }
                });
                continue;
            }
            other => {
                write(
                    &writer,
                    &json!({ "v": 1, "id": id, "error": { "code": "unknown_method", "retryable": false, "actual": other } }),
                );
                continue;
            }
        };
        write(&writer, &json!({ "v": 1, "id": id, "result": result }));
    }
}

// ---- The process's own peak resident memory.

#[repr(C)]
struct Rusage {
    utime: [i64; 2],
    stime: [i64; 2],
    maxrss: i64,
    rest: [i64; 13],
}

extern "C" {
    fn getrusage(who: i32, usage: *mut Rusage) -> i32;
}

/// The process's peak resident memory, in bytes (macOS reports `ru_maxrss` in bytes).
fn peak_resident() -> u64 {
    let mut usage = Rusage {
        utime: [0; 2],
        stime: [0; 2],
        maxrss: 0,
        rest: [0; 13],
    };
    // SAFETY: RUSAGE_SELF (0) and a struct laid out as macOS's `struct rusage`.
    assert_eq!(unsafe { getrusage(0, &mut usage) }, 0, "getrusage");
    usage.maxrss as u64
}

/// The process's resident memory now, in bytes, as `ps` reads it.
fn resident_now() -> u64 {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<u64>()
        .unwrap_or(0)
        * 1024
}

fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1e6)
}

#[test]
fn ac1_with_30_sessions_and_200000_streamed_events_the_apps_resident_memory_stays_under_300_mb() {
    if !cfg!(target_os = "macos") {
        panic!("INCONCLUSIVE: the reference Macs run macOS; ru_maxrss is read as macOS reports it");
    }
    let hub = Hub::start();
    let reader = RecordReader::open(&hub.socket, &hub.token_file)
        .expect("the app's record reader opens on the scripted hub");
    record::install(reader);
    let began = Instant::now();
    loop {
        let at = record::with_view(|view| view.log_pos).expect("the reader is installed");
        if at >= EVENTS {
            break;
        }
        assert!(
            began.elapsed() < Duration::from_secs(900),
            "BLOCKED: the app's record reader reached log_pos {at} of {} in 900 s",
            environment::grouped(EVENTS)
        );
        record::poll(Duration::from_millis(50)).expect("the record reader's poll");
    }
    let (peak, now) = (peak_resident(), resident_now());
    let reading = format!(
        "with {} sessions and {} streamed events the app's record reader process peaked at {} resident ({} now), \
         streamed in {:.1} s",
        bulk::SESSIONS,
        environment::grouped(EVENTS),
        mb(peak),
        mb(now),
        began.elapsed().as_secs_f64()
    );
    println!("{reading}");
    assert!(
        peak < BUDGET_BYTES,
        "FAIL: {reading}: past the 300 MB budget at {} events",
        environment::grouped(EVENTS)
    );

    // What it holds is what the app shows: every session, its task's title and the state the stream left it in.
    let rows = surface::sidebar();
    let want: Vec<(String, String, String)> = (0..bulk::SESSIONS)
        .map(|k| {
            (
                bulk::session(k),
                bulk::title(k),
                format!("{:?}", bulk::expected(k)),
            )
        })
        .collect();
    let got: Vec<(String, String, String)> = rows
        .iter()
        .map(|(session, title, state)| (session.clone(), title.clone(), format!("{state:?}")))
        .collect();
    assert_eq!(
        got, want,
        "after {} streamed events the sidebar shows other sessions, titles or states than the stream left",
        environment::grouped(EVENTS)
    );

    if let Some(problem) = environment::not_a_reference_mac() {
        panic!("INCONCLUSIVE (a reading only: {problem}): {reading}");
    }
}
