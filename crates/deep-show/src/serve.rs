//! Issue #402: `deep-show serve`, the hub's terminal side on the wall clock, with real
//! processes (technical design: Blocks for plug-ins that host something live; Panels and devices:
//! Stream and raw input). Line 1 is the setup, a scenario with no calls (plus `clipboard`, the
//! test clipboard, and `record`, a record the hub must never write a stream to); each later line
//! is one call, answered by one line.
//!
//! - A terminal's program runs on a PTY the hub opens, in a session of its own, and its panel
//!   host is a process of its own (`deep-show host`), never the hub. The hub reads the program's
//!   output into the terminal's stream and writes it on to the host.
//! - The stream applies backpressure: it holds at most [`WINDOW`] bytes the host hasn't taken.
//!   Once that is full the hub stops reading the PTY, the PTY's own buffer fills, and the
//!   program's writes block until the host takes more. Nothing is dropped, and nothing of the
//!   stream is written to the record.
//! - Raw input comes only from you: keys, text and paste from the input seam go to the panel
//!   that holds keyboard focus, whatever the pointer is over, and on to its program; a write from
//!   an agent's session is refused, naming the writer.
//! - The host never answers the program, so a clipboard read through the terminal's escape gets
//!   no reply and no byte of the clipboard.

use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Map, Value};

/// The most a terminal's stream holds that its host hasn't taken: 16 MiB.
pub const WINDOW: usize = 16 * 1024 * 1024;
/// One read of the PTY, and one frame to the host, at most.
const CHUNK: usize = 64 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Plant {
    None,
    /// The stream drops its oldest chunks when full instead of blocking the program.
    DropsOldest,
    /// The host answers every clipboard read with the clipboard's text.
    RepliesSecret,
    /// The host answers a clipboard read ended by `ESC \` with an empty answer.
    RepliesInSt,
    /// Keys go to the panel under the pointer.
    FollowsPointer,
    /// A raw-input write from an agent's session is delivered.
    AgentAccepted,
    /// Each line of a stream is written to the record as an event.
    ToRecord,
}

/// One frame for the host: the program's bytes, or a query, which reads every byte before it.
enum Item {
    Data(Vec<u8>),
    Query(Vec<u8>),
}

/// What the stream holds and has done, shared by its threads.
#[derive(Default)]
struct Flow {
    queue: VecDeque<Item>,
    queued: usize,
    /// Bytes read from the program, bytes the host applied, chunks and bytes dropped.
    sent: u64,
    delivered: u64,
    dropped_chunks: u64,
    dropped_bytes: u64,
    closed: bool,
}

struct Stream {
    flow: Mutex<Flow>,
    wake: Condvar,
}

/// A query's answer from the host, routed back to the call waiting on it.
type Replies = Arc<(Mutex<VecDeque<Value>>, Condvar)>;

struct Term {
    panel: String,
    master: Arc<File>,
    /// The program, reaped by its own thread once it ends, and the host.
    program: Arc<Mutex<Option<Child>>>,
    host: Child,
    stream: Arc<Stream>,
    replies: Replies,
    /// The bracketed-paste, mouse and focus modes, as the host last reported them.
    modes: Value,
}

struct Serve {
    panels: BTreeMap<String, [f64; 4]>,
    /// Plug-in panels: which terminal each shows, and whether it takes raw input.
    terminals_of: BTreeMap<String, (String, bool)>,
    sessions: Vec<String>,
    terms: BTreeMap<String, Term>,
    focus: Option<String>,
    pointer: Option<[f64; 2]>,
    serial: u64,
    clipboard: String,
    record: Option<String>,
    plant: Plant,
}

fn bad() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn frame(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 5);
    out.push(kind);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    out
}

/// A PTY of `cols` × `rows`: its master and the slave for the program.
fn openpty(cols: u16, rows: u16) -> Option<(OwnedFd, OwnedFd)> {
    let mut master = -1;
    let mut slave = -1;
    let mut size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: openpty writes two descriptors it opened into the two ints we pass; the name and
    // termios pointers may be null, and the winsize is read only.
    let rc = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if rc != 0 {
        return None;
    }
    // SAFETY: both descriptors were just opened by openpty and are owned by nothing else.
    Some(unsafe { (OwnedFd::from_raw_fd(master), OwnedFd::from_raw_fd(slave)) })
}

#[cfg(target_os = "macos")]
const TIOCSWINSZ: libc::c_ulong = 0x8008_7467;
#[cfg(not(target_os = "macos"))]
const TIOCSWINSZ: libc::c_ulong = libc::TIOCSWINSZ as libc::c_ulong;

fn set_size(master: &File, cols: u16, rows: u16) -> bool {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: the ioctl reads one winsize from the pointer; the descriptor is a PTY master.
    unsafe { libc::ioctl(master.as_raw_fd(), TIOCSWINSZ as _, &size) == 0 }
}

impl Serve {
    fn setup(input: &Map<String, Value>) -> Option<Serve> {
        let panels = match input.get("panels") {
            None => BTreeMap::new(),
            Some(p) => p
                .as_object()?
                .iter()
                .map(|(k, v)| {
                    let r: Vec<f64> = v
                        .get("rect")?
                        .as_array()?
                        .iter()
                        .filter_map(Value::as_f64)
                        .collect();
                    Some((k.clone(), <[f64; 4]>::try_from(r.as_slice()).ok()?))
                })
                .collect::<Option<_>>()?,
        };
        let plant = match input.get("planted").map(Value::as_str) {
            None => Plant::None,
            Some(Some("terminal_drops_oldest")) => Plant::DropsOldest,
            Some(Some("osc52_replies_secret")) => Plant::RepliesSecret,
            Some(Some("osc52_replies_in_st_form")) => Plant::RepliesInSt,
            Some(Some("router_follows_pointer")) => Plant::FollowsPointer,
            Some(Some("agent_raw_input_accepted")) => Plant::AgentAccepted,
            Some(Some("stream_to_record")) => Plant::ToRecord,
            _ => return None,
        };
        Some(Serve {
            panels,
            terminals_of: BTreeMap::new(),
            sessions: input
                .get("sessions")
                .and_then(Value::as_object)
                .map(|s| s.keys().cloned().collect())
                .unwrap_or_default(),
            terms: BTreeMap::new(),
            focus: None,
            pointer: None,
            serial: 0,
            clipboard: match input.get("clipboard") {
                None => String::new(),
                Some(c) => c.as_str()?.to_string(),
            },
            record: match input.get("record") {
                None => None,
                Some(r) => Some(r.as_str()?.to_string()),
            },
            plant,
        })
    }

    fn panel_at(&self, pos: [f64; 2]) -> Option<String> {
        self.panels
            .iter()
            .find(|(_, r)| {
                pos[0] >= r[0] && pos[0] < r[0] + r[2] && pos[1] >= r[1] && pos[1] < r[1] + r[3]
            })
            .map(|(id, _)| id.clone())
    }

    fn call(&mut self, c: &Map<String, Value>) -> Value {
        let s = |k: &str| c.get(k).and_then(Value::as_str).map(str::to_string);
        let Some(name) = s("call") else { return bad() };
        match name.as_str() {
            "install" => self.install(c),
            "terminal_open" => self.open(c),
            "terminal_resize" => self.resize(c),
            "input" => self.input(c),
            "focus" => json!({"kb_focus": self.focus}),
            "pointer" => {
                let Some(pos) = pos(c.get("pos")) else {
                    return bad();
                };
                self.pointer = Some(pos);
                json!({"over": self.panel_at(pos)})
            }
            "seam" => self.seam(c),
            "raw_input" => self.raw_input(c),
            "stream_stats" => self.stats(c),
            "cells" | "rows" | "cell" => {
                let Some(t) = s("terminal") else { return bad() };
                let mut q = c.clone();
                q.insert("q".into(), json!(name));
                self.ask(&t, &Value::Object(q))
            }
            _ => bad(),
        }
    }

    fn install(&mut self, c: &Map<String, Value>) -> Value {
        let Some(panels) = c
            .get("manifest")
            .and_then(|m| m.get("panels"))
            .and_then(Value::as_object)
        else {
            return bad();
        };
        for (id, p) in panels {
            let raw = p.get("raw_input").and_then(Value::as_bool).unwrap_or(false);
            let terminal = p
                .get("tree")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|e| e.get("component").and_then(Value::as_str) == Some("cells"))
                .and_then(|e| e.get("terminal")?.as_str());
            if let Some(t) = terminal {
                self.terminals_of.insert(id.clone(), (t.to_string(), raw));
            }
        }
        json!({"installed": true})
    }

    fn open(&mut self, c: &Map<String, Value>) -> Value {
        let s = |k: &str| c.get(k).and_then(Value::as_str).map(str::to_string);
        let n = |k: &str, d: u64| c.get(k).map_or(Some(d), Value::as_u64);
        let (Some(id), Some(panel), Some(cols), Some(rows), Some(history)) = (
            s("terminal"),
            s("panel"),
            n("cols", 120),
            n("rows", 36),
            n("history", 10_000),
        ) else {
            return bad();
        };
        if self.terminals_of.get(&panel).map(|(t, _)| t.as_str()) != Some(id.as_str()) {
            return json!({"code": "unknown_panel"});
        }
        let Some(program) = c.get("program") else {
            return bad();
        };
        let argv: Vec<String> = program
            .get("argv")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|a| a.as_str().map(str::to_string))
            .collect();
        let Some((exe, args)) = argv.split_first() else {
            return bad();
        };
        let (cols, rows) = (cols as u16, rows as u16);
        let Some((master, slave)) = openpty(cols, rows) else {
            return json!({"code": "pty_failed"});
        };
        let mut cmd = Command::new(exe);
        cmd.args(args).env_clear();
        for (k, v) in program
            .get("env")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some(v) = v.as_str() {
                cmd.env(k, v);
            }
        }
        if let Some(cwd) = program.get("cwd").and_then(Value::as_str) {
            cmd.current_dir(cwd);
        }
        let fd = slave.as_raw_fd();
        // SAFETY: between fork and exec the child only calls login_tty, which is async-signal
        // safe: a new session with the slave as its controlling terminal and stdio.
        unsafe {
            cmd.pre_exec(move || match libc::login_tty(fd) {
                0 => Ok(()),
                _ => Err(std::io::Error::last_os_error()),
            });
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let program = match cmd.spawn() {
            Ok(p) => p,
            Err(e) => return json!({"code": "spawn_failed", "what": e.to_string()}),
        };
        drop(slave);
        let mut host_args = vec![
            "host".to_string(),
            cols.to_string(),
            rows.to_string(),
            history.to_string(),
        ];
        if matches!(self.plant, Plant::RepliesSecret | Plant::RepliesInSt) {
            host_args.push("answers".into());
        }
        let host = Command::new(std::env::current_exe().unwrap_or_default())
            .args(&host_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let mut host = match host {
            Ok(h) => h,
            Err(e) => return json!({"code": "spawn_failed", "what": e.to_string()}),
        };
        let master = Arc::new(File::from(master));
        let stream = Arc::new(Stream {
            flow: Mutex::new(Flow::default()),
            wake: Condvar::new(),
        });
        let to_host = File::from(OwnedFd::from(host.stdin.take().expect("piped")));
        let replies: Replies = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
        self.spawn_reader(Arc::clone(&master), Arc::clone(&stream));
        self.spawn_writer(Arc::clone(&stream), to_host);
        self.spawn_host_reader(
            host.stdout.take().expect("piped"),
            Arc::clone(&stream),
            Arc::clone(&replies),
            Arc::clone(&master),
        );
        let (host_pid, program_pid) = (host.id(), program.id());
        // The program is reaped as soon as it ends, so its PID is gone, not a zombie.
        let program = Arc::new(Mutex::new(Some(program)));
        let reaped = Arc::clone(&program);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(50));
            let mut p = reaped.lock().expect("program");
            match p.as_mut().map(Child::try_wait) {
                Some(Ok(None)) => {}
                _ => {
                    p.take();
                    return;
                }
            }
        });
        self.terms.insert(
            id.clone(),
            Term {
                panel,
                master,
                program,
                host,
                stream,
                replies,
                modes: Value::Null,
            },
        );
        json!({"opened": true, "terminal": id, "host": {"pid": host_pid}, "program": {"pid": program_pid}, "stream": format!("stream:{id}")})
    }

    /// The PTY's reader: the program's output into the stream, never past its window. A full
    /// window stops the reads, so the program's writes block; the planted stream drops its
    /// oldest chunks instead and reads on.
    fn spawn_reader(&self, master: Arc<File>, stream: Arc<Stream>) {
        let plant = self.plant;
        let record = self.record.clone();
        thread::spawn(move || {
            let mut buf = vec![0u8; CHUNK];
            let mut line = Vec::new();
            loop {
                {
                    // The window counts what the hub holds, one chunk on its way to the host and
                    // the host's pipe, so all of it stays under 16 MiB.
                    let mut f = stream.flow.lock().expect("flow");
                    while f.queued + 4 * CHUNK > WINDOW && plant != Plant::DropsOldest && !f.closed
                    {
                        f = stream.wake.wait(f).expect("flow");
                    }
                }
                let n = match (&*master).read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                if plant == Plant::ToRecord {
                    if let Some(path) = &record {
                        line.extend_from_slice(&buf[..n]);
                        record_lines(path, &mut line);
                    }
                }
                // The planted stream keeps its chunks to whole lines, so what it drops is lines.
                let chunk = match plant {
                    Plant::DropsOldest => {
                        line.extend_from_slice(&buf[..n]);
                        let Some(end) = line.iter().rposition(|b| *b == b'\n') else {
                            continue;
                        };
                        line.drain(..=end).collect()
                    }
                    _ => buf[..n].to_vec(),
                };
                let n = chunk.len();
                let mut f = stream.flow.lock().expect("flow");
                f.sent += n as u64;
                f.queued += n;
                f.queue.push_back(Item::Data(chunk));
                while plant == Plant::DropsOldest && f.queued + 4 * CHUNK > WINDOW {
                    let Some(at) = f.queue.iter().position(|i| matches!(i, Item::Data(_))) else {
                        break;
                    };
                    let Some(Item::Data(old)) = f.queue.remove(at) else {
                        break;
                    };
                    f.queued -= old.len();
                    f.dropped_chunks += 1;
                    f.dropped_bytes += old.len() as u64;
                }
                stream.wake.notify_all();
            }
            let mut f = stream.flow.lock().expect("flow");
            f.closed = true;
            stream.wake.notify_all();
        });
    }

    /// The stream's writer: queued frames to the host, in order. A stopped host fills its pipe
    /// and this write blocks, so the window fills.
    fn spawn_writer(&self, stream: Arc<Stream>, mut to_host: File) {
        thread::spawn(move || loop {
            let bytes = {
                // A program that ended leaves its host to answer queries, so the writer runs
                // until the hub ends it.
                let mut f = stream.flow.lock().expect("flow");
                while f.queue.is_empty() {
                    f = stream.wake.wait(f).expect("flow");
                }
                let Some(item) = f.queue.pop_front() else {
                    return;
                };
                stream.wake.notify_all();
                match item {
                    Item::Data(c) => {
                        f.queued -= c.len();
                        frame(b'D', &c)
                    }
                    Item::Query(q) => frame(b'Q', &q),
                }
            };
            if to_host.write_all(&bytes).is_err() {
                return;
            }
        });
    }

    /// The host's answers: `A n` for bytes applied, `C <end>` for a clipboard read only the
    /// planted host reports, and one JSON line per query.
    fn spawn_host_reader(
        &self,
        out: std::process::ChildStdout,
        stream: Arc<Stream>,
        replies: Replies,
        master: Arc<File>,
    ) {
        let (plant, secret) = (self.plant, self.clipboard.clone());
        thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                let Ok(line) = line else { break };
                if let Some(n) = line.strip_prefix("A ") {
                    let mut f = stream.flow.lock().expect("flow");
                    f.delivered = n.parse().unwrap_or(f.delivered);
                    stream.wake.notify_all();
                } else if let Some(end) = line.strip_prefix("C ") {
                    let answer = match (plant, end) {
                        (Plant::RepliesSecret, _) => {
                            Some(format!("\x1b]52;c;{}\x07", base64(secret.as_bytes())))
                        }
                        (Plant::RepliesInSt, "st") => Some("\x1b]52;c;\x1b\\".to_string()),
                        _ => None,
                    };
                    if let Some(a) = answer {
                        let _ = (&*master).write_all(a.as_bytes());
                    }
                } else {
                    let v = serde_json::from_str(&line).unwrap_or(Value::Null);
                    let (q, cv) = &*replies;
                    q.lock().expect("replies").push_back(v);
                    cv.notify_all();
                }
            }
        });
    }

    /// A query to a terminal's host, answered once every byte the stream held before it is applied.
    fn ask(&mut self, id: &str, q: &Value) -> Value {
        let Some(t) = self.terms.get(id) else {
            return json!({"code": "unknown_terminal"});
        };
        // The query goes after what the stream already holds, so its answer reads them.
        {
            let mut f = t.stream.flow.lock().expect("flow");
            f.queue
                .push_back(Item::Query(serde_json::to_vec(q).unwrap_or_default()));
            t.stream.wake.notify_all();
        }
        let (lock, cv) = &*t.replies;
        let mut r = lock.lock().expect("replies");
        loop {
            if let Some(v) = r.pop_front() {
                return v;
            }
            let (g, timeout) = cv
                .wait_timeout(r, Duration::from_secs(600))
                .expect("replies");
            if timeout.timed_out() && g.is_empty() {
                return json!({"code": "host_gone"});
            }
            r = g;
        }
    }

    fn stats(&self, c: &Map<String, Value>) -> Value {
        let Some(id) = c
            .get("stream")
            .and_then(Value::as_str)
            .and_then(|s| s.strip_prefix("stream:"))
        else {
            return bad();
        };
        let Some(t) = self.terms.get(id) else {
            return json!({"code": "unknown_stream"});
        };
        let f = t.stream.flow.lock().expect("flow");
        // What the hub holds, and what the host's pipe holds besides: sent less applied.
        json!({"kind": "terminal", "sent": f.sent, "delivered": f.delivered,
               "buffered": f.sent - f.delivered - f.dropped_bytes,
               "dropped": {"chunks": f.dropped_chunks, "bytes": f.dropped_bytes}})
    }

    fn resize(&mut self, c: &Map<String, Value>) -> Value {
        let s = c
            .get("terminal")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let (Some(cols), Some(rows)) = (
            c.get("cols").and_then(Value::as_u64),
            c.get("rows").and_then(Value::as_u64),
        ) else {
            return bad();
        };
        let Some(t) = self.terms.get(&s) else {
            return json!({"code": "unknown_terminal"});
        };
        if !set_size(&t.master, cols as u16, rows as u16) {
            return json!({"code": "resize_failed"});
        }
        let _ = self.ask(&s, &json!({"q": "resize", "cols": cols, "rows": rows}));
        json!({"resized": true})
    }

    /// Your input from a panel (#401's `input`): a press gives the panel keyboard focus, and a
    /// program that asked for focus events hears it.
    fn input(&mut self, c: &Map<String, Value>) -> Value {
        let Some(panel) = c.get("panel").and_then(Value::as_str).map(str::to_string) else {
            return bad();
        };
        let ty = c
            .get("event")
            .and_then(|e| e.get("type"))
            .and_then(Value::as_str);
        self.serial += 1;
        if ty == Some("down") && self.focus.as_deref() != Some(panel.as_str()) {
            if let Some(old) = self.focus.replace(panel.clone()) {
                self.focus_event(&old, false);
            }
            self.focus_event(&panel, true);
        }
        json!({"serial": self.serial})
    }

    fn term_of_panel(&self, panel: &str) -> Option<&str> {
        self.terms
            .iter()
            .find(|(_, t)| t.panel == panel)
            .map(|(id, _)| id.as_str())
    }

    fn modes(&mut self, terminal: &str) -> Value {
        let m = self.ask(terminal, &json!({"q": "modes"}));
        if let Some(t) = self.terms.get_mut(terminal) {
            t.modes = m.clone();
        }
        m
    }

    fn focus_event(&mut self, panel: &str, gained: bool) {
        let Some(id) = self.term_of_panel(panel).map(str::to_string) else {
            return;
        };
        if self.modes(&id)["focus_events"] == true {
            self.write(&id, if gained { b"\x1b[I" } else { b"\x1b[O" });
        }
    }

    fn write(&self, terminal: &str, bytes: &[u8]) {
        if let Some(t) = self.terms.get(terminal) {
            let _ = (&*t.master).write_all(bytes);
        }
    }

    /// One event of the input seam's test backend, naming no panel: keys, text and paste go to
    /// the panel that holds keyboard focus, the mouse to the panel under it.
    fn seam(&mut self, c: &Map<String, Value>) -> Value {
        let Some(e) = c.get("event").and_then(Value::as_object) else {
            return bad();
        };
        self.serial += 1;
        let serial = self.serial;
        let ty = e.get("type").and_then(Value::as_str).unwrap_or("");
        let to = match (ty, self.plant) {
            ("mouse", _) => pos(e.get("pos")).and_then(|p| self.panel_at(p)),
            (_, Plant::FollowsPointer) => self
                .pointer
                .and_then(|p| self.panel_at(p))
                .or(self.focus.clone()),
            _ => self.focus.clone(),
        };
        // Raw input goes only to a panel that asked for it.
        let Some(panel) = to.filter(|p| self.terminals_of.get(p).is_some_and(|(_, raw)| *raw))
        else {
            return json!({"serial": serial, "reached": ["shell"]});
        };
        let Some(id) = self.term_of_panel(&panel).map(str::to_string) else {
            return json!({"serial": serial, "reached": ["shell"]});
        };
        let bytes: Vec<u8> = match ty {
            "key" => match e.get("phase").and_then(Value::as_str) {
                // A legacy terminal has no escape for a release.
                Some("release") => Vec::new(),
                _ => key_bytes(e.get("key").and_then(Value::as_str).unwrap_or("")),
            },
            "text" => e
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .as_bytes()
                .to_vec(),
            "paste" => {
                let text = e.get("text").and_then(Value::as_str).unwrap_or("");
                match self.modes(&id)["bracketed_paste"] == true {
                    true => format!("\x1b[200~{text}\x1b[201~").into_bytes(),
                    false => text.as_bytes().to_vec(),
                }
            }
            "mouse" => {
                let m = self.modes(&id);
                let (Some(p), Some(r)) = (pos(e.get("pos")), self.panels.get(&panel)) else {
                    return bad();
                };
                let x = ((p[0] - r[0]) / 8.0).floor() as i64 + 1;
                let y = ((p[1] - r[1]) / 16.0).floor() as i64 + 1;
                let down = e.get("phase").and_then(Value::as_str) == Some("down");
                match (m["mouse"].as_str(), down) {
                    (Some("sgr"), true) => format!("\x1b[<0;{x};{y}M").into_bytes(),
                    (Some("sgr"), false) => format!("\x1b[<0;{x};{y}m").into_bytes(),
                    (Some("x10"), _) => {
                        let b = if down { 32u8 } else { 35 };
                        vec![
                            0x1b,
                            b'[',
                            b'M',
                            b,
                            (32 + x).min(255) as u8,
                            (32 + y).min(255) as u8,
                        ]
                    }
                    _ => Vec::new(),
                }
            }
            _ => return bad(),
        };
        self.write(&id, &bytes);
        json!({"serial": serial, "reached": [format!("panel:{panel}")]})
    }

    /// A raw-input write from an agent's session: refused, naming it; raw input comes only from
    /// your focused panel.
    fn raw_input(&mut self, c: &Map<String, Value>) -> Value {
        let Some(session) = c
            .get("by")
            .and_then(|b| b.get("session"))
            .and_then(Value::as_str)
        else {
            return bad();
        };
        let terminal = c.get("terminal").and_then(Value::as_str).unwrap_or("");
        let writer = format!("mcp:{session}");
        if self.plant == Plant::AgentAccepted {
            let bytes = c.get("bytes").and_then(Value::as_str).unwrap_or("");
            self.write(terminal, bytes.as_bytes());
            return json!({"written": true});
        }
        let _ = &self.sessions;
        json!({"code": "raw_input_from_agent", "writer": writer,
               "what": format!("raw input comes only from your focused panel; {writer} is an agent's session")})
    }

    /// Ends every host and program it started, by the PIDs it holds.
    fn close(&mut self) {
        for (_, mut t) in std::mem::take(&mut self.terms) {
            let mut program = t.program.lock().expect("program").take();
            for child in std::iter::once(&mut t.host).chain(program.as_mut()) {
                let pid = child.id() as libc::pid_t;
                // SAFETY: kill on a PID this process started and has not reaped, so it is still
                // that child's.
                unsafe {
                    libc::kill(pid, libc::SIGCONT);
                    libc::kill(pid, libc::SIGKILL);
                }
                let _ = child.wait();
            }
        }
    }
}

fn pos(v: Option<&Value>) -> Option<[f64; 2]> {
    let a = v?.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
}

/// The bytes a key sends: its character, or the escape of a named key.
fn key_bytes(key: &str) -> Vec<u8> {
    match key {
        "enter" | "return" => b"\r".to_vec(),
        "tab" => b"\t".to_vec(),
        "backspace" => vec![0x7f],
        "escape" => vec![0x1b],
        "up" => b"\x1b[A".to_vec(),
        "down" => b"\x1b[B".to_vec(),
        "right" => b"\x1b[C".to_vec(),
        "left" => b"\x1b[D".to_vec(),
        k => k.as_bytes().to_vec(),
    }
}

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= c.len() {
                out.push(char::from(A[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The planted stream's write of each whole line into the record, as an event.
fn record_lines(path: &str, pending: &mut Vec<u8>) {
    let Some(end) = pending.iter().rposition(|b| *b == b'\n') else {
        return;
    };
    let lines: Vec<u8> = pending.drain(..=end).collect();
    let mut sql = String::from("BEGIN;");
    for l in String::from_utf8_lossy(&lines).lines() {
        let text = l.replace('\'', "''");
        sql.push_str(&format!(
            "INSERT INTO events (id, log_pos, v, ts, writer, actor, scope, kind, data, hash) VALUES (lower(hex(randomblob(13))), (SELECT coalesce(max(log_pos),0)+1 FROM events), 1, 0, 'app', 'you', 'you', 'stream.line', json_object('text', '{text}'), '');"
        ));
    }
    sql.push_str("COMMIT;");
    let _ = Command::new("sqlite3").arg(path).arg(sql).output();
}

/// `deep-show serve`: the setup, then one call a line, until stdin closes.
pub fn run() -> i32 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut lines = stdin.lock().lines();
    let Some(Ok(first)) = lines.next() else {
        return 0;
    };
    let parsed = serde_json::from_str::<Value>(&first).ok();
    let Some(mut serve) = parsed
        .as_ref()
        .and_then(Value::as_object)
        .and_then(Serve::setup)
    else {
        let _ = writeln!(out, "{}", bad());
        return 0;
    };
    let _ = writeln!(out, "{}", json!({"ok": true}));
    let _ = out.flush();
    for line in lines {
        let Ok(line) = line else { break };
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Object(c)) => serve.call(&c),
            _ => bad(),
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
    serve.close();
    0
}
