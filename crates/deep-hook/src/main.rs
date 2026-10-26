//! deep-hook: every agent hook runs it as `deep-hook <agent> <event>` with the hook's JSON on stdin. It
//! stamps the call with its seq and id from one read of the wall clock, matches it against the guard
//! entries in ~/.deepbuild/rules.json, forwards it to the hub at the address setting, and prints the
//! hub's reply. When the hub isn't there, refuses the request, sends a reply that doesn't parse, doesn't
//! acknowledge it in time, or doesn't reply by the hold it acknowledged, it denies a call a fail_closed
//! entry matches, allows every other call, and spools the request byte for byte for the hub to replay.
//! As `deep-hook statusline`, Claude Code's status line command, it sends the hub the plan windows the
//! status line reads (#159), then runs your own status line command and prints what it prints.

use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{env, io};

use deep_contracts::{parse, Value};

mod matcher;
mod shell;

/// How long the hub has to acknowledge a request, from the hook's start: the 20 ms the hub has to acknowledge
/// once it reads it. The rest of the design's 50 ms is for the process to start, decide, spool and exit.
const ACK_BUDGET: Duration = Duration::from_millis(20);

/// The environment variables that make an agent bill an API account instead of your plan. SessionStart
/// reports whether each is set, never its value.
const BILLING_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "OPENAI_API_KEY",
];

/// The features this build supports; the request carries only those the hub lists too.
const FEATURES: &[&str] = if cfg!(feature = "plant-f-test") {
    &["f_test"]
} else {
    &[]
};

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_default()).join(".deepbuild")
}

/// The setting `section.key` in ~/.deepbuild/config.json.
fn setting(section: &str, key: &str) -> Option<Value> {
    let config = parse(&fs::read_to_string(home().join("config.json")).ok()?).ok()?;
    member(member(&config, section)?, key).cloned()
}

/// The one address setting: `hub.address` in ~/.deepbuild/config.json, `unix:<path>`; absent, ~/.deepbuild/hub.sock.
fn address() -> PathBuf {
    match setting("hub", "address") {
        Some(Value::String(address)) if address.starts_with("unix:") => {
            PathBuf::from(&address[5..])
        }
        _ => home().join("hub.sock"),
    }
}

fn member<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

/// The wall clock in nanoseconds since the Unix epoch, read once when the hook starts. A debug build takes
/// it from DEEP_HOOK_TEST_CLOCK_NS when a test sets it.
fn wall_clock_ns() -> u128 {
    #[cfg(debug_assertions)]
    if let Some(ns) = env::var("DEEP_HOOK_TEST_CLOCK_NS")
        .ok()
        .and_then(|text| text.parse::<u64>().ok())
    {
        return u128::from(ns);
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A ULID at `ms`: 48 bits of time and 80 from the OS's random source.
fn ulid(ms: u128) -> String {
    let mut random = [0u8; 10];
    if let Ok(mut source) = fs::File::open("/dev/urandom") {
        let _ = source.read_exact(&mut random);
    }
    let tail = random
        .iter()
        .fold(0u128, |acc, &byte| acc << 8 | u128::from(byte));
    let value = (ms & ((1 << 48) - 1)) << 80 | tail;
    (0..26)
        .rev()
        .map(|i| CROCKFORD[((value >> (5 * i)) & 31) as usize] as char)
        .collect()
}

/// The JSON text quoted as a JSON string.
fn quoted(text: &str) -> String {
    deep_contracts::jcs(&Value::String(text.to_string()))
}

// ---- Guards.

/// A guard entry from rules.json, as far as deep-hook acts on it with the hub away.
struct Guard {
    name: String,
    pattern: String,
    fail_closed: bool,
    reason: String,
    next_step: String,
}

/// The entries of ~/.deepbuild/rules.json, `{"v": 1, "entries": {<name>: guard@1}}`; none when it is missing,
/// and why not when it can't be read or isn't that shape.
fn guards() -> Result<Vec<Guard>, String> {
    let text = match fs::read_to_string(home().join("rules.json")) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("can't be read: {error}")),
    };
    let rules = parse(&text).map_err(|_| "isn't JSON".to_string())?;
    let Some(Value::Object(entries)) = member(&rules, "entries") else {
        return Err("has no entries object".to_string());
    };
    entries
        .iter()
        .map(|(name, entry)| {
            guard(name, entry)
                .ok_or_else(|| format!("has an entry {name} that isn't a guard@1 entry"))
        })
        .collect()
}

/// One entry as guard@1 has it: every field there and of its type, and no other; None when it isn't one.
fn guard(name: &str, entry: &Value) -> Option<Guard> {
    let Value::Object(fields) = entry else {
        return None;
    };
    const FIELDS: [&str; 6] = [
        "match",
        "scope",
        "mode",
        "reason",
        "next_step",
        "fail_closed",
    ];
    if fields
        .iter()
        .any(|(key, _)| !FIELDS.contains(&key.as_str()))
    {
        return None;
    }
    let text = |key: &str| match member(entry, key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    let Some(Value::Bool(fail_closed)) = member(entry, "fail_closed") else {
        return None;
    };
    text("scope")?;
    if !["watch", "warn", "block"].contains(&text("mode")?.as_str()) {
        return None;
    }
    let pattern = text("match").filter(|m| matcher::known(m))?;
    Some(Guard {
        name: name.to_string(),
        pattern,
        fail_closed: *fail_closed,
        reason: text("reason")?,
        next_step: text("next_step")?,
    })
}

/// The call a tool hook makes, as guards read it: a shell command (Bash's `tool_input.command`), a file tool's
/// path (Edit, MultiEdit, Write, NotebookEdit; Read and Grep read theirs) or a patch's (Codex's apply_patch);
/// None for any other tool.
fn call(payload: &Value) -> Option<matcher::Call> {
    let Some(Value::String(tool)) = member(payload, "tool_name") else {
        return None;
    };
    let input = member(payload, "tool_input");
    let field = |key: &str| match input.and_then(|i| member(i, key)) {
        Some(Value::String(text)) => Some(text.as_str()),
        _ => None,
    };
    let (command, paths, read) = match tool.as_str() {
        "Bash" => (Some(field("command")?), Vec::new(), false),
        "Edit" | "MultiEdit" | "Write" => (None, vec![field("file_path")?.to_string()], false),
        "NotebookEdit" => (None, vec![field("notebook_path")?.to_string()], false),
        "apply_patch" => (None, matcher::patched(field("command")?), false),
        "Read" => (None, vec![field("file_path")?.to_string()], true),
        "Grep" => (
            None,
            field("path").map(str::to_string).into_iter().collect(),
            true,
        ),
        _ => return None,
    };
    let cwd = match member(payload, "cwd") {
        Some(Value::String(cwd)) if Path::new(cwd).is_absolute() => Some(PathBuf::from(cwd)),
        _ => None,
    };
    let home = PathBuf::from(env::var_os("HOME").unwrap_or_default());
    Some(matcher::Call::new(
        tool,
        command,
        (&paths, read),
        cwd.as_deref(),
        &home,
        &address(),
    ))
}

// ---- The exchange with the hub.

/// What the hub's reply came to, or how deep-hook came to act as it does with the hub away.
enum Outcome {
    Reply {
        exit: u8,
        stdout: String,
        stderr: String,
    },
    /// The hub isn't there, refused the request or sent what doesn't parse; `late` when it was there but
    /// didn't acknowledge in time or didn't reply by its hold.
    Down { late: bool },
}

enum Got {
    Line(String),
    Timeout,
    Closed,
}

/// Reads one line by `deadline`, or with no deadline at all.
fn read_line(reader: &mut BufReader<UnixStream>, deadline: Option<Instant>) -> Got {
    // A line already read off the socket is in time, whatever the clock says now.
    if reader.buffer().contains(&b'\n') {
        let mut text = String::new();
        return match reader.read_line(&mut text) {
            Ok(_) => Got::Line(text),
            Err(_) => Got::Closed,
        };
    }
    let left = match deadline {
        Some(deadline) => match deadline.checked_duration_since(Instant::now()) {
            Some(left) if !left.is_zero() => Some(left),
            _ => return Got::Timeout,
        },
        None => None,
    };
    if reader.get_ref().set_read_timeout(left).is_err() {
        return Got::Closed;
    }
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(n) if n > 0 && line.ends_with('\n') => Got::Line(line),
        Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => Got::Timeout,
        _ => Got::Closed,
    }
}

fn integer(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(n)) if n.fract() == 0.0 => Some(*n),
        _ => None,
    }
}

/// Whether a socket line is an object of exactly `fields`, its `v` 1: a hook line's contract, before its values.
fn shaped(value: &Value, fields: &[&str]) -> bool {
    matches!(value, Value::Object(members)
        if members.len() == fields.len() && members.iter().all(|(key, _)| fields.contains(&key.as_str())))
        && integer(member(value, "v")) == Some(1.0)
}

/// One exchange with the hub: its hello, the request `id`, its acknowledgement and its reply. Returns the line
/// sent, the outcome, and the last line the hub wrote (only a planted build prints it).
fn exchange(
    start: Instant,
    id: &str,
    line: impl Fn(&[&str]) -> String,
) -> (Option<String>, Outcome, String) {
    let ack_due = start + ACK_BUDGET;
    // Only the planted connect-timeout-only build reads with no deadline.
    let ack_deadline = (!cfg!(feature = "plant-connect-timeout-only")).then_some(ack_due);
    let late = Outcome::Down { late: true };
    let down = Outcome::Down { late: false };
    let stream = match UnixStream::connect(address()) {
        Ok(stream) => stream,
        Err(_) => return (None, down, String::new()),
    };
    let mut reader = BufReader::new(stream);
    let hello = match read_line(&mut reader, ack_deadline) {
        Got::Line(text) => text,
        Got::Timeout => return (None, late, String::new()),
        Got::Closed => return (None, down, String::new()),
    };
    let Ok(hello_value) = parse(hello.trim_end()) else {
        return (None, down, hello);
    };
    let listed = match member(&hello_value, "features") {
        Some(Value::Array(items)) => items.as_slice(),
        _ => &[],
    };
    let on: Vec<&str> = FEATURES
        .iter()
        .copied()
        .filter(|f| {
            listed
                .iter()
                .any(|l| matches!(l, Value::String(s) if s == f))
        })
        .collect();
    let request = line(&on);
    // Past the deadline already, the request isn't sent: the spooled copy, marked late, is the one recorded.
    if ack_deadline.is_some_and(|due| Instant::now() >= due) {
        return (Some(request), late, hello);
    }
    // A hub that stops reading can't hold the write past the deadline either.
    let left = ack_due
        .checked_duration_since(Instant::now())
        .unwrap_or(Duration::from_millis(1));
    let _ = reader
        .get_ref()
        .set_write_timeout(ack_deadline.map(|_| left.max(Duration::from_millis(1))));
    if let Err(error) = reader.get_mut().write_all(request.as_bytes()) {
        let late = matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut);
        return (Some(request), Outcome::Down { late }, hello);
    }
    // The first line back must be the acknowledgement; a refusal, or anything else, is the hub away.
    let ack_text = match read_line(&mut reader, ack_deadline) {
        Got::Line(text) => text,
        Got::Timeout => return (Some(request), late, hello),
        Got::Closed => return (Some(request), down, hello),
    };
    // Only a hook.ack@2 of this request: one of another, or out of shape, is the hub away.
    let ack = match parse(ack_text.trim_end()) {
        Ok(ack)
            if shaped(&ack, &["v", "ack", "hold_until_ms"])
                && matches!(member(&ack, "ack"), Some(Value::String(acked)) if acked == id)
                && (matches!(member(&ack, "hold_until_ms"), Some(Value::Null))
                    || integer(member(&ack, "hold_until_ms"))
                        .is_some_and(|ms| (0.0..=9_007_199_254_740_991.0).contains(&ms))) =>
        {
            ack
        }
        _ => return (Some(request), down, ack_text),
    };
    // A reply is due by the hold the hub acknowledged, however far ahead; with no hold, by the same deadline. A hold
    // past what this machine's clock can hold is the hub away.
    let due = match integer(member(&ack, "hold_until_ms")) {
        Some(ms) if !cfg!(feature = "plant-fixed-deadline") => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64;
            match Instant::now().checked_add(Duration::from_millis((ms - now).max(0.0) as u64)) {
                Some(due) => Some(due),
                None => return (Some(request), down, ack_text),
            }
        }
        _ => ack_deadline,
    };
    // The hub has the call: from here its hold, not the watchdog, says how long the hook waits.
    ACKED.store(true, Ordering::SeqCst);
    let reply_text = match read_line(&mut reader, due) {
        Got::Line(text) => text,
        Got::Timeout => return (Some(request), late, ack_text),
        Got::Closed => return (Some(request), down, ack_text),
    };
    // Only a reply that holds to hook.reply@2 is printed; never bytes deep-hook couldn't parse.
    let Ok(reply) = parse(reply_text.trim_end()) else {
        return (Some(request), down, reply_text);
    };
    if !shaped(&reply, &["v", "exit", "stdout", "stderr"]) {
        return (Some(request), down, reply_text);
    }
    match (
        integer(member(&reply, "exit")),
        member(&reply, "stdout"),
        member(&reply, "stderr"),
    ) {
        (Some(exit), Some(Value::String(stdout)), Some(Value::String(stderr)))
            if (0.0..=255.0).contains(&exit) =>
        {
            let outcome = Outcome::Reply {
                exit: exit as u8,
                stdout: stdout.clone(),
                stderr: stderr.clone(),
            };
            (Some(request), outcome, reply_text)
        }
        _ => (Some(request), down, reply_text),
    }
}

/// Appends the request as one write of one line to the spool every deep-hook shares, for the hub to replay
/// when it starts. A debug build holds after DEEP_HOOK_TEST_SPOOL_STALL bytes, so a test can cut the write.
///
/// The hub renames the file aside before it replays it, so a write may land in a file the hub has already read
/// and removed. After its write, deep-hook checks that the path still names the file it wrote to; when it doesn't,
/// it writes the line again to the new file. The hub records an ID once, so a line it took twice changes nothing.
///
/// The line is synced, and the names that lead to it with it: a power cut keeps what ran. The sync runs in a
/// process of its own (`deep-hook spool-sync`). A sync takes as long as the disk does, and a process can't finish
/// exiting while one of its threads is in one, so a sync run here would hold the hook past its 50 ms even once
/// spool_by stops waiting for it.
fn spool(request: &str, written: &mut dyn FnMut()) -> io::Result<()> {
    let folder = home().join("spool");
    let upto = append(&folder, request, &mut || {})?;
    written();
    let synced = Command::new(env::current_exe()?)
        .arg("spool-sync")
        .arg(&folder)
        .arg(upto)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if !synced.success() {
        return Err(io::Error::other(
            "the spool line was written but not synced",
        ));
    }
    Ok(())
}

/// `deep-hook spool-sync <folder> <file|folder|parent>`: syncs the spool file and, as far up as `upto` says, the
/// folder that names it and the folder's parent. One runs at a time for a spool, holding a lock on its folder, so
/// hooks on a stalled disk leave at most one sync behind. One that finds the lock held leaves its line to the
/// holder, which syncs the file again until it stops changing, and looks once more after letting go: a line
/// written as it let go is synced by it or by the next holder. The write that made the file or the folder waits
/// for the lock instead, since a holder syncs only the file; that's one write per spool file, not one per hook.
fn sync(folder: &Path, upto: &str) -> io::Result<()> {
    let path = folder.join("spool.jsonl");
    let state = || fs::symlink_metadata(&path).ok().map(|m| (m.ino(), m.len()));
    let mut names = upto != "file";
    loop {
        let lock = File::open(folder)?;
        if names {
            lock.lock()?;
        } else {
            match lock.try_lock() {
                Ok(()) => {}
                Err(fs::TryLockError::WouldBlock) => return Ok(()),
                Err(fs::TryLockError::Error(error)) => return Err(error),
            }
        }
        let mut seen;
        loop {
            seen = state();
            if seen.is_some() {
                OpenOptions::new()
                    .read(true)
                    .custom_flags(NOFOLLOW)
                    .open(&path)?
                    .sync_data()?;
            }
            if names {
                lock.sync_all()?;
                if upto == "parent" {
                    if let Some(parent) = folder.parent() {
                        File::open(parent)?.sync_all()?;
                    }
                }
                names = false;
            }
            if state() == seen {
                break;
            }
        }
        drop(lock);
        if state() == seen {
            return Ok(());
        }
    }
}

/// The spool's one append, with `opened` run between opening the file and writing to it (a test moves it there).
/// Returns how far up the line's sync must reach: the folder too when the file was made, and the folder's parent
/// when the folder was.
fn append(folder: &Path, request: &str, opened: &mut dyn FnMut()) -> io::Result<&'static str> {
    let path = folder.join("spool.jsonl");
    for _ in 0..3 {
        // Made by this write, exactly: only one write makes the folder, and only one makes each spool file.
        let made = match DirBuilder::new().mode(0o700).create(folder) {
            Ok(()) => true,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => false,
            Err(_) => {
                DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(folder)?;
                true
            }
        };
        // The spool is a folder of its own and one file in it, never a link to somewhere else: deep-hook only appends.
        let dir = fs::symlink_metadata(folder)?;
        if !dir.is_dir() || dir.mode() & 0o022 != 0 {
            return Err(io::Error::other(
                "the spool folder is a link, or others can write it",
            ));
        }
        let (mut file, fresh) = match OpenOptions::new()
            .create_new(true)
            .append(true)
            .mode(0o600)
            .custom_flags(NOFOLLOW)
            .open(&path)
        {
            Ok(file) => (file, true),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                match OpenOptions::new()
                    .append(true)
                    .custom_flags(NOFOLLOW)
                    .open(&path)
                {
                    Ok(file) => (file, false),
                    // The hub moved it aside since: make the next one.
                    Err(error) if error.kind() == ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        };
        let made_file = file.metadata()?;
        if !made_file.is_file() || made_file.nlink() != 1 {
            return Err(io::Error::other("the spool file is a link to another file"));
        }
        opened();
        #[cfg(debug_assertions)]
        if let Some(n) = stall() {
            file.write_all(&request.as_bytes()[..n.min(request.len())])?;
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
        // One write call, never write_all's retries: a second call could land after another hook's line. A short
        // write leaves a cut line, which the hub skips, and the next try writes the whole line again.
        if file.write(request.as_bytes())? < request.len() {
            continue;
        }
        let written = file.metadata()?;
        match fs::symlink_metadata(&path) {
            Ok(now) if now.dev() == written.dev() && now.ino() == written.ino() => {}
            _ => continue,
        }
        return Ok(if made {
            "parent"
        } else if fresh {
            "folder"
        } else {
            "file"
        });
    }
    Err(io::Error::other(
        "the spool line was cut or moved in each of three tries",
    ))
}

/// O_NOFOLLOW, which std doesn't name: opening a symlink fails rather than following it.
#[cfg(target_os = "macos")]
const NOFOLLOW: i32 = 0x0100;
#[cfg(target_os = "linux")]
const NOFOLLOW: i32 = 0o400000;

/// DEEP_HOOK_TEST_SPOOL_STALL in a debug build: spool only this many bytes of the line, then wait to be killed.
#[cfg(debug_assertions)]
fn stall() -> Option<usize> {
    env::var("DEEP_HOOK_TEST_SPOOL_STALL")
        .ok()
        .and_then(|text| text.parse::<usize>().ok())
}

/// How long after the hook's start deep-hook stops waiting for its spool write and exits with its decision: a
/// filesystem that stalls loses the spooled copy, never the 50 ms.
const SPOOL_DEADLINE: Duration = Duration::from_millis(45);

/// How long after the hook's start deep-hook waits for a written line's sync. The line is in the spool already, and
/// its sync runs on in a process of its own; waiting the whole SPOOL_DEADLINE for it left a hook started by a busy
/// machine no time to exit within the 50 ms.
const SYNC_DEADLINE: Duration = Duration::from_millis(25);

/// How a spool on its own thread is going: its line written, then its sync done or failed.
enum Spooling {
    Written,
    Done(io::Result<()>),
}

/// Spools on a thread of its own and waits for its write only until SPOOL_DEADLINE after `start`, and for the
/// sync of a written line only until SYNC_DEADLINE, in steps (see sleep_until). Says whether a write that ran out
/// of time had its line in the spool, so it will be replayed.
fn spool_by(request: String, id: &str, start: Instant) {
    let (tell, told) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let written = tell.clone();
        let result = spool(&request, &mut || {
            let _ = written.send(Spooling::Written);
        });
        let _ = tell.send(Spooling::Done(result));
    });
    #[cfg(debug_assertions)]
    let forever = stall().is_some();
    #[cfg(not(debug_assertions))]
    let forever = false;
    let mut written = false;
    let result = loop {
        let due = if written {
            SYNC_DEADLINE
        } else {
            SPOOL_DEADLINE
        };
        let left = due.saturating_sub(start.elapsed());
        let step = if forever {
            Duration::MAX
        } else {
            left.min(STEP)
        };
        match told.recv_timeout(step) {
            Ok(Spooling::Written) => written = true,
            Ok(Spooling::Done(result)) => break Some(result),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) if forever || !left.is_zero() => {}
            Err(_) => break None,
        }
    };
    match result {
        Some(Ok(())) => {}
        Some(Err(error)) => eprintln!("deep-hook: could not spool {id}: {error}"),
        None if written => {
            eprintln!("deep-hook: spooled {id}, but its sync didn't finish within the hook's 50 ms")
        }
        None => eprintln!("deep-hook: could not spool {id} within the hook's 50 ms"),
    }
}

/// The longest any wait for a deadline sleeps at once. Under load macOS lets one long sleep run up to 10 ms late
/// (timer coalescing), more than the 50 ms can spare; short sleeps keep to their time.
const STEP: Duration = Duration::from_millis(1);

/// Sleeps until `after` past `start`, in STEPs.
fn sleep_until(start: Instant, after: Duration) {
    loop {
        let left = after.saturating_sub(start.elapsed());
        if left.is_zero() {
            return;
        }
        std::thread::sleep(left.min(STEP));
    }
}

fn forward(agent: &str, event: &str) -> ExitCode {
    let start = Instant::now();
    // Guards hold a tool's call before it runs, so only a PreToolUse reads rules.json: no other hook waits on it.
    // It is marked before the watchdog starts and before rules.json is read, then the call: until the call is read
    // and matched, the watchdog doesn't let it through while a fail_closed entry is installed.
    let ruling = event == "PreToolUse";
    RULING.store(ruling, Ordering::SeqCst);
    watchdog(start);
    let now = wall_clock_ns();
    let seq = now.min(i64::MAX as u128).to_string();
    let id = ulid(now / 1_000_000);
    let guards = if ruling { guards() } else { Ok(Vec::new()) };
    // Guards that can't be read may hold a call: with the hub away it is denied, never let through unguarded.
    match &guards {
        Err(why) => {
            let _ = DENIAL.set(format!(
                "DeepBuild blocked this: ~/.deepbuild/rules.json {why}, so deep-hook can't check its guards while the hub doesn't answer. Fix that file, then retry."
            ));
        }
        Ok(guards) if !guards.iter().any(|g| g.fail_closed) => {
            RULING.store(false, Ordering::SeqCst)
        }
        Ok(_) => {}
    }
    READ_RULES.store(true, Ordering::SeqCst);
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let parsed = parse(&input).ok();
    // The agent's hook JSON goes as it came: a raw newline in valid JSON is only whitespace, so it becomes a space.
    let payload = if parsed.is_some() {
        input.trim().replace(['\n', '\r'], " ")
    } else {
        quoted(&input)
    };
    let called = parsed.as_ref().filter(|_| ruling).and_then(call);
    let guards = guards.unwrap_or_default();
    let matched: Vec<(&Guard, matcher::Hit)> = match &called {
        Some(call) => guards
            .iter()
            .filter_map(|g| call.matches(&g.pattern).map(|hit| (g, hit)))
            .collect(),
        None => Vec::new(),
    };
    // With the hub away, a fail_closed entry the call matched still denies it.
    if let Some((guard, hit)) = matched.iter().find(|(g, _)| g.fail_closed) {
        let detail = hit
            .detail
            .as_deref()
            .map(|d| format!(" {d}"))
            .unwrap_or_default();
        let _ = DENIAL.set(format!(
            "DeepBuild blocked this: {} {}{detail} (guard {}, which holds while the hub doesn't answer)",
            guard.reason, guard.next_step, guard.name
        ));
    }
    RULED.store(true, Ordering::SeqCst);
    let names = matched
        .iter()
        .map(|(g, _)| quoted(&g.name))
        .collect::<Vec<_>>()
        .join(",");
    // What the matcher read of the call for an entry, so the hub's denial says it too.
    let notes = matched
        .iter()
        .filter_map(|(g, hit)| {
            hit.detail
                .as_ref()
                .map(|d| format!("{}:{}", quoted(&g.name), quoted(d)))
        })
        .collect::<Vec<_>>()
        .join(",");
    let notes = if notes.is_empty() {
        notes
    } else {
        format!(",\"notes\":{{{notes}}}")
    };
    // At SessionStart, whether each billing key is set in the environment the agent gave this process.
    let billing = if event == "SessionStart" {
        let keys = BILLING_KEYS
            .iter()
            .map(|key| {
                // A key counts when set; a CLAUDE_CODE_USE_ switch only when on, as Claude Code reads it.
                let value = env::var(key).unwrap_or_default().to_ascii_lowercase();
                let set = if key.starts_with("CLAUDE_CODE_USE_") {
                    matches!(value.as_str(), "1" | "true" | "yes" | "on")
                } else {
                    !value.is_empty()
                };
                format!("\"{key}\":{set}")
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(",\"billing\":{{{keys}}}")
    } else {
        String::new()
    };
    let force =
        cfg!(feature = "plant-f-test") && env::var("DEEP_HOOK_FORCE_F_TEST").as_deref() == Ok("1");
    let line = |on: &[&str]| {
        let f_test = if on.contains(&"f_test") || force {
            ",\"f_test\":true"
        } else {
            ""
        };
        format!(
            "{{\"v\":1,\"agent\":{},\"event\":{},\"seq\":\"{seq}\",\"id\":\"{id}\",\"pid\":{},\"ppid\":{},\"matched\":[{names}]{notes},\"payload\":{payload}{billing}{f_test}}}\n",
            quoted(agent),
            quoted(event),
            std::process::id(),
            std::os::unix::process::parent_id(),
        )
    };
    let (sent, outcome, last) = exchange(start, &id, line);
    let late = match outcome {
        Outcome::Reply {
            exit,
            stdout,
            stderr,
        } => {
            decide();
            print!("{stdout}");
            eprint!("{stderr}");
            return ExitCode::from(exit);
        }
        Outcome::Down { late } => late,
    };
    if cfg!(feature = "plant-print-reply") {
        print!("{last}");
    }
    let mut request = sent.unwrap_or_else(|| line(&[]));
    if late {
        // A call let through because the hub was late is spooled marked late.
        request.truncate(request.len() - 2);
        request.push_str(",\"late\":true}\n");
    }
    decide();
    // Before an acknowledgement the 50 ms run from the hook's start; after a hold the hub acknowledged ran out or
    // broke, or past the watchdog's 50 ms while it waited for a fail_closed match, the spool's time runs from now,
    // since the hook was already allowed to wait.
    let from = if ACKED.load(Ordering::SeqCst) || start.elapsed() >= WATCHDOG {
        Instant::now()
    } else {
        start
    };
    spool_by(request, &id, from);
    match DENIAL.get() {
        Some(denial) => {
            eprintln!("{denial}");
            ExitCode::from(2)
        }
        None => ExitCode::SUCCESS,
    }
}

/// Set once the hub has acknowledged the call; then the watchdog stands down.
static ACKED: AtomicBool = AtomicBool::new(false);
/// Set by whichever of the hook and its watchdog makes the decision first; the other stops.
static DECIDED: AtomicBool = AtomicBool::new(false);
/// What a matched fail_closed entry prints when it denies the call with the hub away.
static DENIAL: OnceLock<String> = OnceLock::new();
/// Set at a PreToolUse until its call is read and matched (RULED), unless rules.json holds no fail_closed entry.
static RULING: AtomicBool = AtomicBool::new(false);
static RULED: AtomicBool = AtomicBool::new(false);
/// Set once rules.json is read, before the call is.
static READ_RULES: AtomicBool = AtomicBool::new(false);
/// When, after the hook's start, the watchdog decides for a hook the hub hasn't acknowledged.
const WATCHDOG: Duration = Duration::from_millis(48);
/// How long, after the hook's start, the watchdog waits for a call a fail_closed entry may hold to be matched.
const RULING_LIMIT: Duration = Duration::from_millis(500);

/// Claims the decision for the hook; if the watchdog has it already, waits for the watchdog to end the process.
fn decide() {
    if DECIDED.swap(true, Ordering::SeqCst) {
        loop {
            std::thread::park();
        }
    }
}

/// Keeps the 50 ms whatever holds the hook up before the hub acknowledges it (a stdin that never ends, a slow
/// disk under rules.json): at WATCHDOG it exits with the decision for the hub away, deny when a fail_closed entry
/// has matched and allow otherwise; while rules.json or, with a fail_closed entry installed, the call is still being
/// read or matched, it waits for that until RULING_LIMIT and then denies. That call isn't spooled; a turn of its tool calls then reads as not reaching the hub. The builds that must hang for a test (a connect timeout only, a stalled spool write) run without it.
fn watchdog(start: Instant) {
    if cfg!(feature = "plant-connect-timeout-only") {
        return;
    }
    #[cfg(debug_assertions)]
    if stall().is_some() {
        return;
    }
    std::thread::spawn(move || {
        sleep_until(start, WATCHDOG);
        // A call a fail_closed entry may hold is decided by its match, not the clock: the watchdog gives the hook
        // until RULING_LIMIT to read the call and match it, and only past that denies it unchecked.
        while RULING.load(Ordering::SeqCst)
            && !RULED.load(Ordering::SeqCst)
            && !ACKED.load(Ordering::SeqCst)
            && start.elapsed() < RULING_LIMIT
        {
            std::thread::sleep(STEP);
        }
        if ACKED.load(Ordering::SeqCst) || DECIDED.swap(true, Ordering::SeqCst) {
            return;
        }
        // RULED first: the hook sets a denial before it sets RULED, so once RULED is read as set, DENIAL is final.
        let ruled = RULED.load(Ordering::SeqCst);
        match DENIAL.get() {
            Some(denial) => {
                eprintln!("{denial}");
                std::process::exit(2)
            }
            None if RULING.load(Ordering::SeqCst) && !ruled => {
                if READ_RULES.load(Ordering::SeqCst) {
                    eprintln!("DeepBuild blocked this: deep-hook couldn't read this call and check it against the guards that hold while the hub doesn't answer within 500 ms. Retry it.");
                } else {
                    eprintln!("DeepBuild blocked this: deep-hook couldn't read its guards in ~/.deepbuild/rules.json within 500 ms, with the hub not answering. Check that file, then retry.");
                }
                std::process::exit(2)
            }
            None => std::process::exit(0),
        }
    });
}

/// The account Claude Code records beside your sign-in: `oauthAccount.accountUuid` in ~/.claude.json.
fn account() -> Option<String> {
    let text = fs::read_to_string(PathBuf::from(env::var_os("HOME")?).join(".claude.json")).ok()?;
    match member(member(&parse(&text).ok()?, "oauthAccount")?, "accountUuid")? {
        Value::String(id) if !id.is_empty() => Some(id.clone()),
        _ => None,
    }
}

/// How long the status line's sender waits for the hub's hello, and then for its answer.
const SEND_BUDGET: Duration = Duration::from_secs(5);

/// Your status line command: run as its words when it has no shell syntax, else by /bin/sh.
fn yours(command: &str) -> Command {
    let plain = command
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || " /._-+:,@%".contains(c));
    let words: Vec<&str> = command.split_whitespace().collect();
    if plain && !words.is_empty() {
        let mut run = Command::new(words[0]);
        run.args(&words[1..]);
        run
    } else {
        let mut run = Command::new("/bin/sh");
        run.args(["-c", command]);
        run
    }
}

/// The status line: the windows its input reads go to the hub from a sender of their own, which nothing waits
/// for; `statusline.yours` in ~/.deepbuild/config.json gets the same input, and its output is printed as is.
fn statusline() -> ExitCode {
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let status = parse(&input).ok();
    if let (Some(limits), Some(account)) = (
        status.as_ref().and_then(|s| member(s, "rate_limits")),
        account(),
    ) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let report = Value::Object(vec![
            ("v".into(), Value::Number(1.0)),
            ("id".into(), Value::String(ulid(now.as_millis()))),
            ("method".into(), Value::String("windows.report".into())),
            (
                "params".into(),
                Value::Object(vec![
                    ("agent".into(), Value::String("claude-code".into())),
                    ("account".into(), Value::String(account)),
                    ("rate_limits".into(), limits.clone()),
                ]),
            ),
        ]);
        // A sender of its own, which nothing waits for: it holds none of the status line's output open.
        if let Ok(me) = env::current_exe() {
            let _ = Command::new(me)
                .args(["statusline-send", &deep_contracts::jcs(&report)])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }
    let Some(Value::String(command)) = setting("statusline", "yours") else {
        return ExitCode::SUCCESS;
    };
    let Ok(mut child) = yours(&command).stdin(Stdio::piped()).spawn() else {
        return ExitCode::from(1);
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    match child.wait() {
        Ok(exit) => ExitCode::from(exit.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(_) => ExitCode::from(1),
    }
}

/// The status line's sender: the one line to the hub once it has said hello, then its answer awaited, so the
/// hub reads the line before the connection ends.
fn send(line: &str) {
    let start = Instant::now();
    let Ok(stream) = UnixStream::connect(address()) else {
        return;
    };
    let mut reader = BufReader::new(stream);
    if matches!(
        read_line(&mut reader, Some(start + SEND_BUDGET)),
        Got::Line(_)
    ) && reader
        .get_mut()
        .write_all(format!("{line}\n").as_bytes())
        .is_ok()
    {
        let _ = read_line(&mut reader, Some(Instant::now() + SEND_BUDGET));
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [arg] if arg == "--version" => println!("{}", env!("CARGO_PKG_VERSION")),
        [arg] if arg == "--help" => println!(
            "Usage: deep-hook [--help | --version]\n       deep-hook <agent> <event>    the hook's JSON on stdin\n       deep-hook statusline         Claude Code's status line JSON on stdin"
        ),
        [arg] if arg == "statusline" => return statusline(),
        [arg, line] if arg == "statusline-send" => {
            send(line);
            return ExitCode::SUCCESS;
        }
        [arg, folder, upto] if arg == "spool-sync" => {
            return match sync(Path::new(folder), upto) {
                Ok(()) => ExitCode::SUCCESS,
                Err(_) => ExitCode::from(1),
            };
        }
        [agent, event] if !agent.starts_with('-') => return forward(agent, event),
        _ => {
            eprintln!("Usage: deep-hook <agent> <event>, with the hook's JSON on stdin. Run deep-hook --help.");
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::append;
    use super::shell::glob;
    use std::fs;

    #[test]
    fn a_line_written_to_a_spool_moved_aside_is_written_again_to_the_new_one() {
        let folder = std::env::temp_dir().join(format!("dh315-append-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        let live = folder.join("spool.jsonl");
        let moved = folder.join("replay-1.jsonl");
        // The hub moves the file aside, reads it and removes it while this write holds it open.
        let mut first = true;
        append(&folder, "{\"id\":\"A\"}\n", &mut || {
            if first {
                first = false;
                fs::rename(&live, &moved).unwrap();
                fs::remove_file(&moved).unwrap();
            }
        })
        .unwrap();
        assert_eq!(fs::read_to_string(&live).unwrap(), "{\"id\":\"A\"}\n");
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_star_matches_any_run_and_the_rest_matches_whole() {
        assert!(glob(b"pkill *", b"pkill -f node"));
        assert!(glob(b"ls*", b"ls"));
        assert!(glob(b"ls*", b"ls -la"));
        assert!(!glob(b"pkill *", b"git push origin main"));
        assert!(!glob(b"pkill *", b"pkill"));
        assert!(!glob(b"ls*", b"echo ls"));
        assert!(glob(b"a*b*c", b"a xx b yy c"));
        assert!(!glob(b"a*b*c", b"a xx b yy"));
    }
}
