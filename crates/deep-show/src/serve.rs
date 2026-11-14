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
//! - The host never answers a clipboard read through the terminal's escape: it gets no reply and
//!   no byte of the clipboard.
//! - Issue #990: a key's bytes follow the program's modes as the host holds them after every byte
//!   the program wrote before the key ([`deep_canvas_cells::keys`]); the host's answers to the
//!   program's queries go to the program ahead of any later input, since input first waits for
//!   the PTY to be read empty and the host to apply all of it. A paste loses every end marker in
//!   its text. Each program-status report becomes a reading on the terminal's session, signal
//!   only. Every mode a program set is reset when it exits, when the shell takes its terminal
//!   back from it, and when the host restarts the program. Composing text is shown at the
//!   program's cursor and never sent; text another app inserts waits in the session's box,
//!   naming the app, until your Enter. Mouse reports map to the cells as drawn.

use std::collections::{BTreeMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use deep_canvas_cells::keys::{encode, release, Mods};
use serde_json::{json, Map, Value};

use crate::optional;
use crate::shared::ulid_of;

/// The most a terminal's stream holds that its host hasn't taken: 16 MiB.
pub const WINDOW: usize = 16 * 1024 * 1024;
/// One read of the PTY, and one frame to the host, at most.
const CHUNK: usize = 64 * 1024;
/// The host's answers to a program's queries waiting for it to read its input, at most.
const ANSWERS: usize = 64;

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
    /// The encoder sends a bare carriage return for Shift+Enter.
    ShiftEnterBareCr,
    /// A paste keeps the end markers inside its text.
    PasteKeepsMarker,
    /// The host answers none of the program's queries.
    QueriesDropped,
    /// Each program-status reading also sets the session's state.
    StatusSetsState,
    /// Nothing is reset when a program exits or restarts.
    ModesLeftOn,
    /// Composing text is sent to the program as it changes.
    ImeSendsComposing,
    /// Text another app inserts is dropped.
    InsertDropped,
    /// Text another app inserts goes straight to the program.
    InsertTypedStraight,
}

/// One frame for the host: the program's bytes, or a query, which reads every byte before it.
enum Item {
    Data(Vec<u8>),
    Query(Vec<u8>),
    /// The program's modes are reset, after every byte before it.
    Reset,
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
    /// Held while the PTY is read and the bytes queued, so input can wait for it to be empty.
    reading: Mutex<()>,
}

/// The PTY's master, which a restart replaces.
type Master = Arc<Mutex<Arc<File>>>;

/// A query's answer from the host, routed back to the call waiting on it.
type Replies = Arc<(Mutex<VecDeque<Value>>, Condvar)>;

struct Term {
    panel: String,
    master: Master,
    /// The program, reaped by its own thread once it ends, and the host.
    program: Arc<Mutex<Option<Child>>>,
    host: Child,
    stream: Arc<Stream>,
    replies: Replies,
    /// The bracketed-paste, mouse and focus modes, as the host last reported them.
    modes: Value,
    /// The terminal's size in cells, which a restarted program starts at.
    size: (u16, u16),
    /// The grid's top left and one cell's size as drawn, in window px.
    drawn: [f64; 4],
    /// The text you are composing in an input method, shown and never sent.
    preedit: String,
    /// Text another app inserted, and that app, waiting for your Enter.
    inserted: Option<(String, String)>,
}

impl Term {
    fn master(&self) -> Arc<File> {
        Arc::clone(&self.master.lock().expect("master"))
    }
}

/// One cell's size as drawn at a font size, in px: 8 × 16 at the cell grid's default 13 points.
fn cell_size(points: f64) -> [f64; 2] {
    [points * 8.0 / 13.0, points * 16.0 / 13.0]
}

/// What poll says of the PTY's output within `ms`: its events, none when nothing came.
fn poll_in(master: &File, ms: libc::c_int) -> libc::c_short {
    let mut fds = libc::pollfd {
        fd: master.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: poll reads and writes the one pollfd we pass.
    match unsafe { libc::poll(&mut fds, 1, ms) } {
        n if n > 0 => fds.revents,
        _ => 0,
    }
}

/// Whether the PTY holds output nobody has read, asked of poll without waiting. FIONREAD can't
/// say: on macOS a PTY master's FIONREAD counts the program's unread input, not its output.
fn unread(master: &File) -> bool {
    poll_in(master, 0) & libc::POLLIN != 0
}

/// A paste's text with every bracketed-paste marker taken out, so it can't end early.
fn unmarked(text: &str) -> String {
    let mut t = text.to_string();
    while t.contains("\x1b[200~") || t.contains("\x1b[201~") {
        t = t.replace("\x1b[200~", "").replace("\x1b[201~", "");
    }
    t
}

struct Serve {
    panels: BTreeMap<String, [f64; 4]>,
    /// Plug-in panels: which terminal each shows, and whether it takes raw input.
    terminals_of: BTreeMap<String, (String, bool)>,
    terms: BTreeMap<String, Term>,
    focus: Option<String>,
    pointer: Option<[f64; 2]>,
    serial: u64,
    clipboard: String,
    record: Option<String>,
    plant: Plant,
    /// The app windows `ax` left up, ended with the rest by their PIDs.
    windows: Vec<Child>,
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
    // The master closes on exec, so no program started later holds a terminal's other end.
    // SAFETY: fcntl sets a flag on the descriptor openpty just opened.
    unsafe { libc::fcntl(master, libc::F_SETFD, libc::FD_CLOEXEC) };
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

/// Starts `program` (`{argv, env, cwd}`) on a new PTY of `cols` × `rows`, in a session of its
/// own with the PTY as its controlling terminal: the PTY's master and the program.
fn spawn_program(program: &Value, cols: u16, rows: u16) -> Result<(File, Child), Value> {
    let argv: Vec<String> = program
        .get("argv")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|a| a.as_str().map(str::to_string))
        .collect();
    let Some((exe, args)) = argv.split_first() else {
        return Err(bad());
    };
    let Some((master, slave)) = openpty(cols, rows) else {
        return Err(json!({"code": "pty_failed"}));
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
    let child = cmd
        .spawn()
        .map_err(|e| json!({"code": "spawn_failed", "what": e.to_string()}))?;
    drop(slave);
    Ok((File::from(master), child))
}

/// The program, reaped by its own thread as soon as it ends, so its PID is gone, not a zombie.
fn reaped(child: Child) -> Arc<Mutex<Option<Child>>> {
    let program = Arc::new(Mutex::new(Some(child)));
    let watched = Arc::clone(&program);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(50));
        let mut p = watched.lock().expect("program");
        match p.as_mut().map(Child::try_wait) {
            Some(Ok(None)) => {}
            _ => {
                p.take();
                return;
            }
        }
    });
    program
}

fn unhex(h: &str) -> Vec<u8> {
    (0..h.len() / 2)
        .filter_map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).ok())
        .collect()
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
            Some(Some("shift_enter_bare_cr")) => Plant::ShiftEnterBareCr,
            Some(Some("paste_keeps_end_marker")) => Plant::PasteKeepsMarker,
            Some(Some("queries_dropped")) => Plant::QueriesDropped,
            Some(Some("status_sets_state")) => Plant::StatusSetsState,
            Some(Some("modes_left_on")) => Plant::ModesLeftOn,
            Some(Some("ime_sends_composing")) => Plant::ImeSendsComposing,
            Some(Some("insert_dropped")) => Plant::InsertDropped,
            Some(Some("insert_typed_straight")) => Plant::InsertTypedStraight,
            _ => return None,
        };
        Some(Serve {
            panels,
            terminals_of: BTreeMap::new(),
            terms: BTreeMap::new(),
            focus: None,
            pointer: None,
            serial: 0,
            clipboard: match input.get("clipboard") {
                None => String::new(),
                Some(c) => c.as_str()?.to_string(),
            },
            record: optional(input.get("record"), |r| Some(r.as_str()?.to_string()))?,
            plant,
            windows: Vec::new(),
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
            "terminal_restart" => self.restart(c),
            "screenshot" => self.screenshot(c),
            "ax" => self.ax(c),
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
                let mut reply = self.ask(&t, &Value::Object(q));
                if let (Some(term), "cells", Some(r)) =
                    (self.terms.get(&t), name.as_str(), reply.as_object_mut())
                {
                    // What the app draws beside the grid: your composition at the program's
                    // cursor, the box of inserted text, and where the cells are drawn.
                    let cursor = r.get("cursor").cloned().unwrap_or(Value::Null);
                    r.insert(
                        "preedit".into(),
                        match term.preedit.is_empty() {
                            true => Value::Null,
                            false => {
                                json!({"text": term.preedit, "x": cursor["x"], "y": cursor["y"]})
                            }
                        },
                    );
                    r.insert(
                        "box".into(),
                        match &term.inserted {
                            None => Value::Null,
                            Some((text, app)) => json!({"text": text, "source": app}),
                        },
                    );
                    let [x, y, w, h] = term.drawn;
                    r.insert("drawn".into(), json!({"x": x, "y": y, "w": w, "h": h}));
                }
                reply
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
        let (Some(id), Some(cols), Some(rows), Some(history)) = (
            s("terminal"),
            n("cols", 120),
            n("rows", 36),
            n("history", 10_000),
        ) else {
            return bad();
        };
        // A plug-in's panel shows the terminal, or the hub hosts it for a session.
        let session = s("session");
        let panel = match (s("panel"), &session) {
            (Some(p), None) => {
                if self.terminals_of.get(&p).map(|(t, _)| t.as_str()) != Some(id.as_str()) {
                    return json!({"code": "unknown_panel"});
                }
                p
            }
            (None, Some(sid)) => format!("session:{sid}"),
            _ => return bad(),
        };
        let points = c
            .get("font")
            .map_or(Some(13.0), |f| f.get("size").and_then(Value::as_f64))
            .filter(|p| *p > 0.0);
        let (Some(points), Some(program)) = (points, c.get("program")) else {
            return bad();
        };
        let (cols, rows) = (cols as u16, rows as u16);
        let (master, program) = match spawn_program(program, cols, rows) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let mut host_args = vec![
            "host".to_string(),
            cols.to_string(),
            rows.to_string(),
            history.to_string(),
        ];
        match self.plant {
            Plant::RepliesSecret | Plant::RepliesInSt => host_args.push("answers".into()),
            Plant::QueriesDropped => host_args.push("queries_dropped".into()),
            _ => {}
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
        let master: Master = Arc::new(Mutex::new(Arc::new(master)));
        let stream = Arc::new(Stream {
            flow: Mutex::new(Flow::default()),
            wake: Condvar::new(),
            reading: Mutex::new(()),
        });
        let to_host = File::from(OwnedFd::from(host.stdin.take().expect("piped")));
        let replies: Replies = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
        let program_pid = program.id();
        self.spawn_reader(Arc::clone(&master), program_pid, Arc::clone(&stream));
        self.spawn_writer(Arc::clone(&stream), to_host);
        self.spawn_host_reader(
            host.stdout.take().expect("piped"),
            Arc::clone(&stream),
            Arc::clone(&replies),
            Arc::clone(&master),
            session.filter(|_| self.record.is_some()),
        );
        let host_pid = host.id();
        let program = reaped(program);
        let origin = self.panels.get(&panel).map_or([0.0, 0.0], |r| [r[0], r[1]]);
        let [w, h] = cell_size(points);
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
                size: (cols, rows),
                drawn: [origin[0], origin[1], w, h],
                preedit: String::new(),
                inserted: None,
            },
        );
        json!({"opened": true, "terminal": id, "host": {"pid": host_pid}, "program": {"pid": program_pid}, "stream": format!("stream:{id}")})
    }

    /// The host starts a new program on the same terminal and grid: the old one, if it still
    /// runs, is ended by its PID, and every mode it set is reset before the new one reads input.
    fn restart(&mut self, c: &Map<String, Value>) -> Value {
        let id = c
            .get("terminal")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let Some(program) = c.get("program") else {
            return bad();
        };
        let Some(t) = self.terms.get(&id) else {
            return json!({"code": "unknown_terminal"});
        };
        if let Some(mut old) = t.program.lock().expect("program").take() {
            // SAFETY: kill on a PID this process started and has not reaped.
            unsafe { libc::kill(old.id() as libc::pid_t, libc::SIGKILL) };
            let _ = old.wait();
        }
        let (master, child) = match spawn_program(program, t.size.0, t.size.1) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let pid = child.id();
        {
            // Under the reading lock, so no byte the old program left is read after the reset.
            let _held = t.stream.reading.lock().expect("reading");
            {
                let mut f = t.stream.flow.lock().expect("flow");
                if self.plant != Plant::ModesLeftOn {
                    f.queue.push_back(Item::Reset);
                }
                f.closed = false;
                t.stream.wake.notify_all();
            }
            *t.master.lock().expect("master") = Arc::new(master);
        }
        self.spawn_reader(Arc::clone(&t.master), pid, Arc::clone(&t.stream));
        if let Some(t) = self.terms.get_mut(&id) {
            t.program = reaped(child);
        }
        json!({"restarted": true, "program": {"pid": pid}})
    }

    /// The PTY's reader: the program's output into the stream, never past its window. A full
    /// window stops the reads, so the program's writes block; the planted stream drops its
    /// oldest chunks instead and reads on. It reads only what the PTY holds, under the stream's
    /// reading lock, so input can wait for every byte written before it. When the shell (the
    /// program, `leader`) takes its terminal back from a program it ran, or the program ends,
    /// the modes are reset after every byte read so far and before any the shell writes. Once a
    /// restart replaces its PTY, it stops, and says nothing of the old program's end.
    fn spawn_reader(&self, slot: Master, leader: u32, stream: Arc<Stream>) {
        let plant = self.plant;
        let record = self.record.clone();
        thread::spawn(move || {
            let master = Arc::clone(&slot.lock().expect("master"));
            let current = || Arc::ptr_eq(&slot.lock().expect("master"), &master);
            let fd = master.as_raw_fd();
            let leader = leader as libc::pid_t;
            let mut buf = vec![0u8; CHUNK];
            let mut line = Vec::new();
            let mut foreground = leader;
            let push = |chunk: Vec<u8>, line: &mut Vec<u8>| {
                if plant == Plant::ToRecord {
                    if let Some(path) = &record {
                        line.extend_from_slice(&chunk);
                        record_lines(path, line);
                    }
                }
                // The planted stream keeps its chunks to whole lines, so what it drops is lines.
                let chunk = match plant {
                    Plant::DropsOldest => {
                        line.extend_from_slice(&chunk);
                        let Some(end) = line.iter().rposition(|b| *b == b'\n') else {
                            return;
                        };
                        line.drain(..=end).collect()
                    }
                    _ => chunk,
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
            };
            let reset = || {
                if plant != Plant::ModesLeftOn {
                    let mut f = stream.flow.lock().expect("flow");
                    f.queue.push_back(Item::Reset);
                    stream.wake.notify_all();
                }
            };
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
                let revents = poll_in(&master, 20);
                let _held = stream.reading.lock().expect("reading");
                if !current() {
                    return;
                }
                // SAFETY: tcgetpgrp only reads the descriptor's terminal.
                let now = unsafe { libc::tcgetpgrp(fd) };
                // The shell already holds its terminal again when it writes, so what the PTY
                // holds now is the shell's and comes after the reset.
                if now == leader && foreground != leader && foreground > 0 {
                    reset();
                }
                if now > 0 {
                    foreground = now;
                }
                // Read only what the PTY holds, so the read never blocks while the lock is held;
                // a hang-up with nothing left reads its end, and so does a descriptor poll can't
                // watch, rather than polling it forever.
                let hung = revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0;
                if revents == 0 || (!unread(&master) && !hung) {
                    continue;
                }
                // One chunk of everything the PTY holds, up to CHUNK, read in as few passes as it
                // takes; a read the PTY has output for returns what it holds without waiting.
                let mut n = 0;
                loop {
                    match (&*master).read(&mut buf[n..]) {
                        Ok(0) | Err(_) => break,
                        Ok(k) => n += k,
                    }
                    if n == CHUNK || !unread(&master) {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
                push(buf[..n].to_vec(), &mut line);
            }
            if !current() {
                return;
            }
            reset();
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
                    Item::Reset => frame(b'X', &[]),
                }
            };
            if to_host.write_all(&bytes).is_err() {
                return;
            }
        });
    }

    /// The host's answers: `A n` for bytes applied, `R <hex>` for its answers to the program's
    /// queries, written to the program as they come, `S <hex>` for a program-status report,
    /// kept as a reading on the terminal's session, `C <end>` for a clipboard read only the
    /// planted host reports, and one JSON line per query.
    fn spawn_host_reader(
        &self,
        out: std::process::ChildStdout,
        stream: Arc<Stream>,
        replies: Replies,
        master: Master,
        session: Option<String>,
    ) {
        let (plant, secret, record) = (self.plant, self.clipboard.clone(), self.record.clone());
        // Readings are written on a thread of their own, so the program's answers never wait on
        // the record.
        let (to_record, reports) = std::sync::mpsc::channel::<String>();
        if let (Some(path), Some(sid)) = (record, session) {
            thread::spawn(move || {
                for (n, report) in reports.iter().enumerate() {
                    record_reading(
                        &path,
                        &sid,
                        &report,
                        n as u64,
                        plant == Plant::StatusSetsState,
                    );
                }
            });
        }
        // The answers to the program's queries are written on a thread of their own, so a
        // program that reads none of its input stalls only them, never the host's other lines;
        // past ANSWERS waiting, more are dropped.
        let (answers, to_write) = std::sync::mpsc::sync_channel::<Vec<u8>>(ANSWERS);
        thread::spawn(move || {
            for bytes in to_write {
                let m = Arc::clone(&master.lock().expect("master"));
                let _ = (&*m).write_all(&bytes);
            }
        });
        thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                let Ok(line) = line else { break };
                let to_program = |bytes: &[u8]| {
                    let _ = answers.try_send(bytes.to_vec());
                };
                if let Some(n) = line.strip_prefix("A ") {
                    let mut f = stream.flow.lock().expect("flow");
                    f.delivered = n.parse().unwrap_or(f.delivered);
                    stream.wake.notify_all();
                } else if let Some(h) = line.strip_prefix("R ") {
                    to_program(&unhex(h));
                } else if let Some(h) = line.strip_prefix("S ") {
                    let _ = to_record.send(String::from_utf8_lossy(&unhex(h)).into_owned());
                } else if let Some(end) = line.strip_prefix("C ") {
                    let answer = match (plant, end) {
                        (Plant::RepliesSecret, _) => {
                            Some(format!("\x1b]52;c;{}\x07", base64(secret.as_bytes())))
                        }
                        (Plant::RepliesInSt, "st") => Some("\x1b]52;c;\x1b\\".to_string()),
                        _ => None,
                    };
                    if let Some(a) = answer {
                        to_program(a.as_bytes());
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
        if !set_size(&t.master(), cols as u16, rows as u16) {
            return json!({"code": "resize_failed"});
        }
        if let Some(t) = self.terms.get_mut(&s) {
            t.size = (cols as u16, rows as u16);
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
            let _ = (&*t.master()).write_all(bytes);
        }
    }

    /// Waits until the program's output is read empty and applied, so the host's answers to
    /// every query before your input reach the program first, and returns the modes after it.
    fn settled_modes(&mut self, terminal: &str) -> Value {
        if let Some(t) = self.terms.get(terminal) {
            let master = t.master();
            for _ in 0..2000 {
                // A full window holds the PTY unread on purpose; your input doesn't wait on it.
                let full = t.stream.flow.lock().expect("flow").queued + 4 * CHUNK > WINDOW;
                let empty = full || {
                    let _held = t.stream.reading.lock().expect("reading");
                    !unread(&master)
                };
                if empty {
                    break;
                }
                thread::sleep(Duration::from_millis(1));
            }
        }
        self.modes(terminal)
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
        let m = self.settled_modes(&id);
        let plant = self.plant;
        let text = e
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let paste = |text: &str| -> Vec<u8> {
            let text = match plant {
                Plant::PasteKeepsMarker => text.to_string(),
                _ => unmarked(text),
            };
            match m["bracketed_paste"] == true {
                true => format!("\x1b[200~{text}\x1b[201~").into_bytes(),
                false => text.into_bytes(),
            }
        };
        let bytes: Vec<u8> = match ty {
            "key" => {
                let key = e.get("key").and_then(Value::as_str).unwrap_or("");
                let held = |n: &str| {
                    e.get("mods")
                        .and_then(Value::as_array)
                        .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(n)))
                };
                let mods = Mods {
                    shift: held("shift"),
                    alt: held("alt"),
                    ctrl: held("ctrl"),
                };
                let code = e.get("code").and_then(Value::as_str);
                let flags = m["keyboard_flags"].as_u64().unwrap_or(0) as u8;
                match e.get("phase").and_then(Value::as_str) {
                    // A release has an escape only once the program asked for event types.
                    Some("release") => release(key, code, mods, flags),
                    _ => {
                        let mut out = match (plant, key, mods) {
                            (
                                Plant::ShiftEnterBareCr,
                                "enter",
                                Mods {
                                    shift: true,
                                    alt: false,
                                    ctrl: false,
                                },
                            ) => b"\r".to_vec(),
                            _ => encode(key, code, mods, m["app_cursor"] == true, flags),
                        };
                        // Your Enter sends the text another app inserted, whole, then the Enter.
                        let inserted = self.terms.get_mut(&id).and_then(|t| match key {
                            "enter" | "return" => t.inserted.take(),
                            _ => None,
                        });
                        if let Some((text, _)) = inserted {
                            let mut first = paste(&text);
                            first.append(&mut out);
                            out = first;
                        }
                        out
                    }
                }
            }
            "text" => {
                if let Some(t) = self.terms.get_mut(&id) {
                    t.preedit.clear();
                }
                text.into_bytes()
            }
            // An input method's marked text is shown at the program's cursor, never sent.
            "preedit" => {
                if let Some(t) = self.terms.get_mut(&id) {
                    t.preedit = text.clone();
                }
                match plant {
                    Plant::ImeSendsComposing => text.into_bytes(),
                    _ => Vec::new(),
                }
            }
            // Text another app inserts (dictation, text expansion) waits in the session's box,
            // naming the app, until your Enter.
            "insert" => {
                let app = e
                    .get("app")
                    .and_then(Value::as_str)
                    .unwrap_or("another app")
                    .to_string();
                match plant {
                    Plant::InsertDropped => Vec::new(),
                    Plant::InsertTypedStraight => text.into_bytes(),
                    _ => {
                        if let Some(t) = self.terms.get_mut(&id) {
                            let mut held = t.inserted.take().map(|(t, _)| t).unwrap_or_default();
                            held.push_str(&text);
                            t.inserted = Some((held, app));
                        }
                        Vec::new()
                    }
                }
            }
            "paste" => paste(&text),
            "mouse" => {
                let (Some(p), Some(t)) = (pos(e.get("pos")), self.terms.get(&id)) else {
                    return bad();
                };
                let [ox, oy, w, h] = t.drawn;
                let x = ((p[0] - ox) / w).floor() as i64 + 1;
                let y = ((p[1] - oy) / h).floor() as i64 + 1;
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
        json!({"code": "raw_input_from_agent", "writer": writer,
               "what": format!("raw input comes only from your focused panel; {writer} is an agent's session")})
    }

    /// What the app draws for a call naming a `terminal` or a `session`: that terminal's screen and
    /// your composition (a session's, its hosted terminal), and the record's events, which the
    /// sidebar's session rows read with their readings.
    fn app_spec(&mut self, c: &Map<String, Value>) -> Result<Value, Value> {
        let s = |k: &str| c.get(k).and_then(Value::as_str).map(str::to_string);
        let terminal = s("terminal").or_else(|| {
            let panel = format!("session:{}", s("session")?);
            self.term_of_panel(&panel).map(str::to_string)
        });
        let terminal = match terminal {
            None => None,
            Some(id) => {
                let screen = self.ask(&id, &json!({"q": "screen"}));
                if screen.get("code").is_some() {
                    return Err(screen);
                }
                let preedit = self
                    .terms
                    .get(&id)
                    .map(|t| t.preedit.clone())
                    .filter(|p| !p.is_empty());
                Some(
                    json!({"cols": screen["cols"], "rows": screen["rows"], "screen": screen["screen"], "preedit": preedit}),
                )
            }
        };
        let events = self
            .record
            .as_deref()
            .map(record_events)
            .unwrap_or_default();
        Ok(
            json!({"terminal": terminal, "events": events, "session": s("session"), "part": s("part")}),
        )
    }

    /// A PNG of the app at the reference window, drawing what the call names (macOS).
    fn screenshot(&mut self, c: &Map<String, Value>) -> Value {
        let Some(path) = c.get("path").and_then(Value::as_str).map(str::to_string) else {
            return bad();
        };
        if !cfg!(target_os = "macos") {
            return json!({"code": "unsupported_platform"});
        }
        match self.app_spec(c) {
            Ok(mut spec) => {
                spec["path"] = json!(path);
                shoot(&spec)
            }
            Err(e) => e,
        }
    }

    /// The terminal tab as accessibility reads it in the real app window (macOS), which stays up,
    /// its tab focused, until serve ends.
    fn ax(&mut self, c: &Map<String, Value>) -> Value {
        if !cfg!(target_os = "macos") {
            return json!({"code": "unsupported_platform"});
        }
        let spec = match self.app_spec(c) {
            Ok(spec) => spec,
            Err(e) => return e,
        };
        let path = std::env::temp_dir().join(format!(
            "deep-990-ax-{}-{}.json",
            std::process::id(),
            self.windows.len()
        ));
        if std::fs::write(&path, spec.to_string()).is_err() {
            return json!({"code": "spec_unwritten"});
        }
        let child = Command::new(std::env::current_exe().unwrap_or_default())
            .arg("term-ax")
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => return json!({"code": "spawn_failed", "what": e.to_string()}),
        };
        // Its one line once the window has drawn, or nothing: a window that never draws (no
        // display session, a prompt over it) is ended after a minute and a half.
        let (tx, rx) = std::sync::mpsc::channel();
        if let Some(out) = child.stdout.take() {
            thread::spawn(move || {
                let mut line = String::new();
                let _ = BufReader::new(out).read_line(&mut line);
                let _ = tx.send(line);
            });
        }
        let line = rx.recv_timeout(Duration::from_secs(90));
        let _ = std::fs::remove_file(&path);
        let Ok(line) = line else {
            // SAFETY: kill on a PID this process started and has not reaped.
            unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGKILL) };
            let _ = child.wait();
            return json!({"code": "ax_timeout", "what": "the app window drew nothing to read in 90 s"});
        };
        self.windows.push(child);
        serde_json::from_str(&line).unwrap_or_else(|_| json!({"code": "ax_failed", "what": line}))
    }

    /// Ends every host and program it started, by the PIDs it holds.
    fn close(&mut self) {
        for mut window in std::mem::take(&mut self.windows) {
            // SAFETY: kill on a PID this process started and has not reaped.
            unsafe { libc::kill(window.id() as libc::pid_t, libc::SIGKILL) };
            let _ = window.wait();
        }
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

#[cfg(target_os = "macos")]
fn shoot(spec: &Value) -> Value {
    deep_replica::terminal::screenshot(spec)
        .unwrap_or_else(|what| json!({"code": "screenshot_failed", "what": what}))
}

#[cfg(not(target_os = "macos"))]
fn shoot(_: &Value) -> Value {
    json!({"code": "unsupported_platform"})
}

/// The record's events, in log order, as the app reads them: kind, writer, session, time, data.
fn record_events(path: &str) -> Vec<Value> {
    let out = Command::new("sqlite3")
        .arg("-json")
        .arg(path)
        .arg("SELECT log_pos, ts, kind, writer, session_id AS session, data FROM events ORDER BY log_pos")
        .output();
    let rows: Vec<Value> = out
        .ok()
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or_default();
    rows.into_iter()
        .map(|mut row| {
            if let Some(data) = row["data"]
                .as_str()
                .and_then(|d| serde_json::from_str(d).ok())
            {
                row["data"] = data;
            }
            row
        })
        .collect()
}

/// A program-status report (`state[;text]`) as a reading on its session in the record: a signal
/// only, never a state. The planted twin also sets the session's state from it.
fn record_reading(path: &str, session: &str, report: &str, n: u64, sets_state: bool) {
    // A reading is a line on the session's row: its first 200 characters.
    let report: String = report.chars().take(200).collect();
    let (state, text) = report.split_once(';').unwrap_or((&report, ""));
    let reading = match text {
        "" => format!("its terminal's program reports {state}"),
        t => format!("its terminal's program reports {state}: {t}"),
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    let q = |t: &str| t.replace('\'', "''");
    let subject = format!(
        "session:{}",
        session
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
    );
    let insert = |kind: &str, data: String, seed: &str| {
        format!(
            "INSERT INTO events (id, log_pos, v, ts, session_id, writer, actor, scope, kind, subject, data, hash) VALUES ('{}', (SELECT coalesce(max(log_pos),0)+1 FROM events), 1, {ts}, '{}', 'core', 'you', 'you', '{kind}', '{}', {data}, '');",
            ulid_of(&format!("{session}:{seed}:{n}:{ts}")),
            q(session),
            q(&subject),
        )
    };
    let mut sql = String::from("BEGIN;");
    sql.push_str(&insert(
        "session.reading",
        format!("json_object('reading', '{}')", q(&reading)),
        "reading",
    ));
    if sets_state {
        let to = match state {
            "blocked" => "waiting_you",
            "done" => "finished",
            s => s,
        };
        sql.push_str(&insert(
            "session.attention",
            format!("json_object('state', '{}')", q(to)),
            "state",
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
    let Some(first) = lines.next() else {
        return 0;
    };
    // A line that can't be read, as one that is not UTF-8, is no setup.
    let parsed = first
        .ok()
        .and_then(|first| serde_json::from_str::<Value>(&first).ok());
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
        let reply = match line {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(Value::Object(c)) => serve.call(&c),
                _ => bad(),
            },
            // A line that is not UTF-8 was read to its end: it is one that can't be read.
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => bad(),
            Err(_) => break,
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
    serve.close();
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_started_later_does_not_inherit_a_pty_master() {
        let (master, _slave) = openpty(80, 24).expect("a pty");
        let held = format!("[ -e /dev/fd/{} ]", master.as_raw_fd());
        let child = Command::new("/bin/sh").arg("-c").arg(held).status();
        assert!(
            !child.expect("sh runs").success(),
            "the child holds the master"
        );
    }
}
