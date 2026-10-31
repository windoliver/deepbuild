//! Issue #105: a capture of a screen for a bug report (technical design: Device gate and capture;
//! canvas primitives: Capture). The trusted ring's, never a canvas module's:
//!
//! - you start a capture for a session's ask with your words, and the system picker opens; only
//!   your pick names what is recorded, and a pick is good for one hold, never a standing grant;
//! - frames are kept only while the shortcut is held, read from the HID key-state table that only
//!   the keyboard writes; a synthetic press, whatever source state and pid it carries, never moves
//!   it (#339). Every frame the picked display presents during the hold is kept, from the first
//!   vsync at or after the key went down, for at most `max` (120 s), with both indicators on;
//! - the frames wait in memory while the hold runs, so no record row, event or log line holds one
//!   and a crash leaves nothing; at the release they are saved as one asset by hash, origin
//!   `deepbuild` and redaction `unknown`, named by a `capture.saved` event in the record;
//! - the saved capture opens an ask-task in its session with your words, holding the asset as
//!   evidence, and drafts a required check that reproduces it, which the fix must pass;
//! - a Send that attaches it waits for your approval, since its redaction isn't `complete`.
//!
//! The model's frames are `frame <display uuid> <vsync> <feed>\n` per vsync, and its encoder keeps
//! them unchanged and in order (the #105 acceptance README: Frames).

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Hub, Planted};
use crate::refused;
use crate::shared::FLICKS;

/// Capture's `max: s = 120`.
const MAX: i64 = 120 * FLICKS;

/// The calls this issue adds to `deep-show run`.
pub enum CaptureCall {
    Start {
        session: String,
        words: String,
    },
    /// Your answer in the picker: a display's uuid, or `None` for cancel.
    Pick(Option<String>),
    Shortcut {
        down: bool,
        hid: bool,
    },
    Indicator,
    Captures,
    Task(String),
    Send {
        session: String,
        to: String,
        files: Vec<String>,
    },
    Approve(String),
}

/// One of this issue's calls, or `None` for a line that lacks a field it needs.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<CaptureCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        // Camera and microphone land in R6; window capture has no window to pick in this model.
        "capture" if s("source")? == "screen" => CaptureCall::Start {
            session: s("session")?,
            words: s("words")?,
        },
        "pick" => match c.get("cancel") {
            Some(Value::Bool(true)) => CaptureCall::Pick(None),
            None => CaptureCall::Pick(Some(s("display")?)),
            _ => return None,
        },
        "shortcut" => CaptureCall::Shortcut {
            down: match s("phase")?.as_str() {
                "down" => true,
                "up" => false,
                _ => return None,
            },
            hid: match s("source")?.as_str() {
                "hid" => true,
                // A posted event's source state and pid are provenance, never trusted.
                "synthetic" => {
                    c.get("state")?.as_i64()?;
                    c.get("pid")?.as_i64()?;
                    false
                }
                _ => return None,
            },
        },
        "indicator" => CaptureCall::Indicator,
        "captures" => CaptureCall::Captures,
        "task" => CaptureCall::Task(s("task")?),
        "send" => CaptureCall::Send {
            session: s("session")?,
            to: s("to")?,
            files: c
                .get("files")?
                .as_array()?
                .iter()
                .map(|f| f.as_str().map(str::to_string))
                .collect::<Option<_>>()?,
        },
        "approve" => CaptureCall::Approve(s("send")?),
        _ => return None,
    })
}

enum State {
    Picking,
    Armed(usize),
    Recording {
        display: usize,
        down: i64,
        /// The next vsync whose frame is due.
        next: i64,
        frames: Vec<u8>,
    },
    Saved,
    Cancelled,
}

impl State {
    fn name(&self) -> &'static str {
        match self {
            State::Picking => "picking",
            State::Armed(_) => "armed",
            State::Recording { .. } => "recording",
            State::Saved => "saved",
            State::Cancelled => "cancelled",
        }
    }
}

struct Capture {
    /// Its number in `capture:<n>`, kept across a restart.
    n: usize,
    session: String,
    words: String,
    state: State,
    frames: u64,
    asset: Option<String>,
    ask: Option<String>,
}

struct Task {
    session: String,
    words: String,
    asset: String,
    checks: Vec<Value>,
}

struct Send {
    to: String,
    files: Vec<String>,
    state: &'static str,
}

/// The captures, the asks they opened and the sends that attach them.
#[derive(Default)]
pub struct Capturing {
    captures: Vec<Capture>,
    /// The HID key-state table's entry for the capture chord.
    held: bool,
    tasks: Vec<(String, Task)>,
    sends: Vec<Send>,
}

/// The check a saved capture drafts into its ask's definition of done: it reproduces the bug,
/// and the fix must pass it.
fn drafted(id: &str, sha: &str, planted: Option<Planted>) -> Vec<Value> {
    match planted {
        Some(Planted::DraftsNoCheck) => vec![],
        _ => vec![json!({
            "id": format!("check:{id}-reproduces"),
            "state": "drafted",
            "reproduces": sha,
            "required": true,
        })],
    }
}

impl Capturing {
    /// The saved captures and the asks they opened, from the `capture.saved` events of the
    /// record in `state`, as #96's documents restart from it. A hold a crash cut short wrote no
    /// event, so it isn't there.
    pub fn restore(state: Option<&Path>, planted: Option<Planted>) -> Self {
        let mut capturing = Capturing::default();
        let Some(text) = state.and_then(|s| fs::read_to_string(s.join("record.jsonl")).ok()) else {
            return capturing;
        };
        for line in text.lines() {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let (event, data) = (&entry["event"], &entry["event"]["data"]);
            if event["kind"] != "capture.saved" {
                continue;
            }
            let n =
                (data["capture"].as_str()).and_then(|id| id.strip_prefix("capture:")?.parse().ok());
            let (Some(n), Some(session), Some(sha), Some(ask)) = (
                n,
                data["session"].as_str(),
                event["evidence"][0].as_str(),
                data["ask"].as_str(),
            ) else {
                continue;
            };
            let words = data["words"].as_str().unwrap_or_default().to_string();
            capturing.captures.push(Capture {
                n,
                session: session.to_string(),
                words: words.clone(),
                state: State::Saved,
                frames: data["frames"].as_u64().unwrap_or_default(),
                asset: Some(sha.to_string()),
                ask: Some(ask.to_string()),
            });
            let task = Task {
                session: session.to_string(),
                words,
                asset: sha.to_string(),
                checks: drafted(&format!("capture:{n}"), sha, planted),
            };
            capturing.tasks.push((ask.to_string(), task));
        }
        capturing
    }
}

fn redaction(planted: Option<Planted>) -> &'static str {
    match planted {
        Some(Planted::LabelsRedactionComplete) => "complete",
        _ => "unknown",
    }
}

/// Appends one event to the record in `state` (#96's line shape).
fn append(state: &Path, session: &str, kind: &str, subject: &str, data: Value, files: &[&str]) {
    let record = state.join("record.jsonl");
    let log_pos = fs::read_to_string(&record).map_or(0, |t| t.lines().count()) + 1;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let event = json!({
        "v": 1, "kind": kind, "subject": subject, "writer": "hub", "actor": "you", "scope": "you",
        "ts": ts, "log_pos": log_pos, "data": data, "evidence": files,
    });
    let line = json!({"log_pos": log_pos, "session": session, "event": event});
    let _ = fs::create_dir_all(state);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&record)
        .and_then(|mut f| writeln!(f, "{line}"));
}

/// Standard base64, for the planted program that writes frames into the record.
fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |n, b| n << 8 | *b as u32) << (8 * (3 - chunk.len()));
        for k in 0..4 {
            out.push(match k <= chunk.len() {
                true => A[(n >> (18 - 6 * k) & 63) as usize] as char,
                false => '=',
            });
        }
    }
    out
}

/// One request to an `http://` address on this machine: `body` `POST`ed if given, else a `GET`. Nothing else is
/// reached.
pub(crate) fn local_http(url: &str, body: Option<&[u8]>) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let (host, path) = match rest.split_once('/') {
        Some((h, p)) => (h, format!("/{p}")),
        None => (rest, "/".to_string()),
    };
    if !host.starts_with("127.0.0.1:") && !host.starts_with("localhost:") {
        return false;
    }
    let Ok(mut stream) = std::net::TcpStream::connect(host) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let head = match body {
        Some(body) => format!(
            "POST {path} HTTP/1.0\r\nHost: {host}\r\nContent-Length: {}\r\n\r\n",
            body.len()
        ),
        None => format!("GET {path} HTTP/1.0\r\nHost: {host}\r\n\r\n"),
    };
    stream.write_all(head.as_bytes()).is_ok()
        && stream.write_all(body.unwrap_or_default()).is_ok()
        && stream.read_to_end(&mut Vec::new()).is_ok()
}

impl Hub<'_> {
    /// One of this issue's calls, at `self.now`.
    pub fn capture_call(&mut self, call: &CaptureCall) -> Value {
        let now = self.now;
        let planted = self.scenario.planted;
        match call {
            CaptureCall::Start { session, words } => {
                if !self.scenario.sessions.contains_key(session) {
                    return refused("no_session");
                }
                let c = &mut self.capturing.captures;
                let n = c.last().map_or(0, |c| c.n) + 1;
                c.push(Capture {
                    n,
                    session: session.clone(),
                    words: words.clone(),
                    state: State::Picking,
                    frames: 0,
                    asset: None,
                    ask: None,
                });
                json!({"capture": format!("capture:{n}"), "state": "picking"})
            }
            CaptureCall::Pick(display) => {
                let display = match display {
                    None => None,
                    Some(uuid) => {
                        match self.scenario.displays.iter().position(|d| &d.uuid == uuid) {
                            Some(i) => Some(i),
                            None => return refused("unknown_display"),
                        }
                    }
                };
                let Some(c) = self
                    .capturing
                    .captures
                    .iter_mut()
                    .rfind(|c| matches!(c.state, State::Picking))
                else {
                    return refused("no_picker");
                };
                c.state = match display {
                    Some(i) => State::Armed(i),
                    None => State::Cancelled,
                };
                json!({"state": c.state.name()})
            }
            CaptureCall::Shortcut { down, hid } => {
                // Only the HID table holds the gate; the planted gate takes any press.
                if *hid || planted == Some(Planted::RecordsWithoutHold) {
                    match (*down, self.capturing.held) {
                        (true, false) => {
                            for c in &mut self.capturing.captures {
                                if let State::Armed(display) = c.state {
                                    let next =
                                        self.scenario.displays[display].grid().vsync_from(now);
                                    c.state = State::Recording {
                                        display,
                                        down: now,
                                        next,
                                        frames: Vec::new(),
                                    };
                                }
                            }
                        }
                        (false, true) => self.release(now),
                        _ => {}
                    }
                    self.capturing.held = *down;
                }
                json!({"held": self.capturing.held})
            }
            CaptureCall::Indicator => {
                let on = self.recording();
                json!({"indicator": {"system": on, "app": on}})
            }
            CaptureCall::Captures => {
                let red = redaction(planted);
                let list: Vec<Value> = (self.capturing.captures.iter())
                    .map(|c| {
                        json!({
                            "capture": format!("capture:{}", c.n),
                            "session": c.session,
                            "state": c.state.name(),
                            "frames": c.frames,
                            "asset": c.asset.as_ref().map(|sha| json!({
                                "sha256": sha, "redaction": red, "origin": "deepbuild",
                            })),
                            "ask": c.ask,
                        })
                    })
                    .collect();
                json!({"captures": list})
            }
            CaptureCall::Task(handle) => {
                let Some((_, t)) = self.capturing.tasks.iter().find(|(h, _)| h == handle) else {
                    return refused("unknown_task");
                };
                json!({"task": {
                    "handle": handle,
                    "session": t.session,
                    "open": true,
                    "words": t.words,
                    "evidence": [{"sha256": t.asset, "redaction": redaction(planted)}],
                    "checks": t.checks,
                }})
            }
            CaptureCall::Send { session, to, files } => {
                if !self.scenario.sessions.contains_key(session) {
                    return refused("no_session");
                }
                // Files leave only by hash from the evidence store.
                if files
                    .iter()
                    .any(|sha| evidence::read(&self.scenario.evidence, sha).is_none())
                {
                    return refused("unknown_file");
                }
                let sends = &mut self.capturing.sends;
                sends.push(Send {
                    to: to.clone(),
                    files: files.clone(),
                    state: "waiting",
                });
                let id = format!("send:{}", sends.len());
                // A capture's redaction is `unknown` until reviewed, so its Send waits for you.
                if planted == Some(Planted::SendsWithoutApproval) {
                    return self.deliver(&id);
                }
                json!({"send": {"id": id, "state": "waiting"}})
            }
            CaptureCall::Approve(id) => self.deliver(id),
        }
    }

    /// Whether a capture keeps frames now: both indicators show exactly then.
    fn recording(&self) -> bool {
        (self.capturing.captures.iter()).any(|c| matches!(c.state, State::Recording { .. }))
    }

    /// The send `id` delivered once: each file `POST`ed to its address by its bytes.
    fn deliver(&mut self, id: &str) -> Value {
        let i = id
            .strip_prefix("send:")
            .and_then(|n| n.parse::<usize>().ok());
        let Some(send) = i.and_then(|i| self.capturing.sends.get_mut(i.checked_sub(1)?)) else {
            return refused("unknown_send");
        };
        if send.state == "waiting" {
            let root = &self.scenario.evidence;
            let sent = (send.files.iter()).all(|sha| {
                evidence::read(root, sha).is_some_and(|b| local_http(&send.to, Some(&b)))
            });
            send.state = if sent { "sent" } else { "failed" };
        }
        json!({"send": {"id": id, "state": send.state}})
    }

    /// The captures' frames up to `to`: each recording keeps every frame its display presents
    /// before `to`, and one that reaches `max` is saved there. A `kill_at` fault ends the hub at
    /// its time, as SIGKILL would: no answer, nothing after.
    pub fn advance_capture(&mut self, to: i64) {
        if let Some(kill) = self.scenario.kill_at.filter(|k| *k <= to) {
            self.frames_until(kill);
            std::process::abort();
        }
        self.frames_until(to);
    }

    fn frames_until(&mut self, to: i64) {
        let planted = self.scenario.planted;
        let state = self.scenario.state.clone();
        let mut ended = Vec::new();
        for (i, c) in self.capturing.captures.iter_mut().enumerate() {
            let n = c.n;
            let State::Recording {
                display,
                down,
                next,
                frames,
            } = &mut c.state
            else {
                continue;
            };
            let end = match planted {
                Some(Planted::RecordsPastMax) => i64::MAX,
                _ => *down + MAX,
            };
            let d = &self.scenario.displays[*display];
            let grid = d.grid();
            let feed = d.feed.as_deref().unwrap_or_default();
            while *next < to.min(end) {
                let frame = format!("frame {} {} {feed}\n", d.uuid, *next);
                frames.extend_from_slice(frame.as_bytes());
                c.frames += 1;
                if let (Some(Planted::FramesToRecord), Some(state)) = (planted, &state) {
                    let data = json!({"capture": format!("capture:{n}"), "vsync": *next,
                        "bytes": base64(frame.as_bytes())});
                    append(state, &c.session, "capture.frame", "capture", data, &[]);
                }
                if planted == Some(Planted::KeepsAssetAfterCrash) {
                    let _ = evidence::put(&self.scenario.evidence, frames);
                }
                *next += grid.period;
            }
            if to >= end {
                ended.push((i, end));
            }
        }
        for (i, end) in ended {
            self.save(i, end);
        }
    }

    /// The hold ends: every recording keeps its frames before `now` and is saved.
    fn release(&mut self, now: i64) {
        self.frames_until(now);
        let recording: Vec<usize> = (self.capturing.captures.iter().enumerate())
            .filter(|(_, c)| matches!(c.state, State::Recording { .. }))
            .map(|(i, _)| i)
            .collect();
        for i in recording {
            self.save(i, now);
        }
    }

    /// Capture `i`'s frames saved as one asset by hash, named by the record, attached to the ask
    /// it opens in its session with a drafted check that reproduces it.
    fn save(&mut self, i: usize, at: i64) {
        let planted = self.scenario.planted;
        let c = &mut self.capturing.captures[i];
        let State::Recording { frames, down, .. } = std::mem::replace(&mut c.state, State::Saved)
        else {
            return;
        };
        let Ok(sha) = evidence::put(&self.scenario.evidence, &frames) else {
            c.state = State::Cancelled;
            return;
        };
        let id = format!("capture:{}", c.n);
        let handle = format!("task:{}-capture-{}", c.session, c.n);
        if let Some(state) = &self.scenario.state {
            let data = json!({
                "capture": id, "session": c.session, "source": "screen", "via": "picker",
                "type": "application/x-deep-frames", "size": frames.len(), "frames": c.frames,
                "held": [down, at], "redaction": redaction(planted), "origin": "deepbuild",
                "ask": handle, "words": c.words,
            });
            append(state, &c.session, "capture.saved", &id, data, &[&sha]);
        }
        let checks = drafted(&id, &sha, planted);
        c.asset = Some(sha.clone());
        c.ask = Some(handle.clone());
        let task = Task {
            session: c.session.clone(),
            words: c.words.clone(),
            asset: sha,
            checks,
        };
        self.capturing.tasks.push((handle, task));
    }
}
