//! The waiter (#25): `deep-hook <agent> waiter`, which Claude Code's Stop entry runs, waits for an answer to its
//! session and wakes the session with it. It says hello bound to its session by its agent (#1851), with no token.

use std::fs;
use std::io::{self, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::process::ExitCode;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use deep_contracts::{parse, Value};

use crate::{
    address, agent_pid, alive, args_of, hub_plant, member, quoted, read_line, Got, SEND_BUDGET,
};

/// How often a waiter looks whether its session's agent still runs, and how long it waits to ask a hub that is away.
const WAITER_LOOK: Duration = Duration::from_millis(500);
/// How long a waiter the hub refused to bind waits before it asks again: each hello costs the hub a look at processes.
const WAITER_REFUSED: Duration = Duration::from_secs(5);

enum Waited {
    /// The hub handed over an answer for the session: exit 2 with it, which wakes the session.
    Answer(String),
    /// The hub said this waiter is done: a newer one replaced it, the stop hold took the answer, or the session ended.
    Done,
    /// The hub is away, or went: ask again once it is back.
    Away,
    /// The hub refused this waiter, or took too long to say whether it binds it: ask again after a while. Why is
    /// the hub's to say, in its output: the waiter's stderr becomes the prompt of the wake it carries.
    Refused,
}

/// One wait on the hub's socket as its session's waiter (#1851): the hub binds the connection to the session by this
/// process's parent, the agent, and its start time, as it binds a deep mcp; no control token is read or sent.
fn wait_once(session: &str, request: &str, gone: &dyn Fn() -> bool) -> Waited {
    let Ok(stream) = UnixStream::connect(address()) else {
        return Waited::Away;
    };
    let mut reader = BufReader::new(stream);
    let soon = || Some(Instant::now() + SEND_BUDGET);
    if !matches!(read_line(&mut reader, soon()), Got::Line(_)) {
        return Waited::Away;
    }
    let hello = format!(
        "{{\"v\":1,\"hello\":\"waiter\",\"session\":{}}}\n",
        quoted(session)
    );
    if reader.get_mut().write_all(hello.as_bytes()).is_err() {
        return Waited::Away;
    }
    match read_line(&mut reader, soon()) {
        // A hub that won't bind this process to the session (it hasn't met the session since it started, say), or
        // that looks at processes too slowly to say in time, is asked again later, less often than one that is away.
        Got::Line(text) => match parse(text.trim_end()) {
            Ok(reply) if member(&reply, "error").is_some() => return refused(&reply),
            Ok(_) => {}
            Err(_) => return Waited::Away,
        },
        Got::Timeout => return Waited::Refused,
        Got::Closed => return Waited::Away,
    }
    if reader.get_mut().write_all(request.as_bytes()).is_err() {
        return Waited::Away;
    }
    loop {
        match read_line(&mut reader, Some(Instant::now() + WAITER_LOOK)) {
            Got::Timeout if gone() => return Waited::Done,
            Got::Timeout => {}
            Got::Closed => return Waited::Away,
            Got::Line(text) => {
                let Ok(reply) = parse(text.trim_end()) else {
                    return Waited::Away;
                };
                return match member(&reply, "result") {
                    Some(result) => match member(result, "text") {
                        Some(Value::String(answer)) => Waited::Answer(answer.clone()),
                        _ => Waited::Done,
                    },
                    None if member(&reply, "error").is_some() => refused(&reply),
                    None => Waited::Away,
                };
            }
        }
    }
}

/// What a waiter does with the hub's error: a retryable one, such as a hub stopping, is a hub away.
fn refused(reply: &Value) -> Waited {
    let error = member(reply, "error");
    match error.and_then(|error| member(error, "retryable")) {
        Some(Value::Bool(true)) => Waited::Away,
        _ => Waited::Refused,
    }
}

/// `deep-hook <agent> waiter`: waits, as long as Claude Code lets the entry run, for an answer to the session the
/// payload names, and exits 2 with it on stderr. Its life is its session's: it exits when the agent that started it
/// does, and waits across the hub's restarts. It uses no CPU while it waits but a look at its agent twice a second.
pub(crate) fn waiter() -> ExitCode {
    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let payload = parse(&input).ok();
    let field = |key: &str| match payload.as_ref().and_then(|p| member(p, key)) {
        Some(Value::String(text)) => text.clone(),
        _ => String::new(),
    };
    let session = field("session_id");
    if session.is_empty() {
        return ExitCode::SUCCESS;
    }
    // #824's planted wrong program: a copy of the session's transcript in the waiter's own memory while it waits.
    let kept = if hub_plant().as_deref() == Some("waiter-keeps-transcript") {
        fs::read(field("transcript_path")).unwrap_or_default()
    } else {
        Vec::new()
    };
    let request = format!(
        "{{\"v\":1,\"id\":1,\"method\":\"session.wait\",\"params\":{{\"session\":{},\"cwd\":{},\"since\":{since}}}}}\n",
        quoted(&session),
        quoted(&field("cwd"))
    );
    let agent = agent_pid();
    // A print run (`claude -p`) has no later turn to wake, and it waits for its async Stop entries before it exits,
    // while this waits for it to exit: under one, the waiter is done at once (#668).
    if args_of(agent)
        .iter()
        .skip(1)
        .any(|arg| arg == "-p" || arg == "--print")
    {
        return ExitCode::SUCCESS;
    }
    // Only the planted wrong program waiter-outlives-session doesn't watch its session's agent.
    let watched = hub_plant().as_deref() != Some("waiter-outlives-session");
    let gone = || watched && (agent_pid() != agent || !alive(agent));
    loop {
        std::hint::black_box(&kept);
        if gone() {
            return ExitCode::SUCCESS;
        }
        match wait_once(&session, &request, &gone) {
            Waited::Answer(text) => {
                eprintln!("{text}");
                return ExitCode::from(2);
            }
            Waited::Done => return ExitCode::SUCCESS,
            Waited::Away => std::thread::sleep(WAITER_LOOK),
            Waited::Refused => std::thread::sleep(WAITER_REFUSED),
        }
    }
}
