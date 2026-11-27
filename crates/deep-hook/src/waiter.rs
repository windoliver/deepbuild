use std::fs;
use std::io::{self, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::process::ExitCode;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use deep_contracts::{parse, Value};

use crate::{
    address, agent_pid, alive, args_of, hub_plant, member, quoted, read_line, Got, SEND_BUDGET,
};

const WAITER_LOOK: Duration = Duration::from_millis(500);
const WAITER_REFUSED: Duration = Duration::from_secs(5);

enum Waited {
    Answer(String),
    Done,
    Away,
    Refused,
}

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

fn refused(reply: &Value) -> Waited {
    let error = member(reply, "error");
    match error.and_then(|error| member(error, "retryable")) {
        Some(Value::Bool(true)) => Waited::Away,
        _ => Waited::Refused,
    }
}

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
    if args_of(agent)
        .iter()
        .skip(1)
        .any(|arg| arg == "-p" || arg == "--print")
    {
        return ExitCode::SUCCESS;
    }
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
