//! deep-hook: every agent hook runs it as `deep-hook <agent> <event>` with the hook's JSON on stdin. It
//! stamps the call with its seq and id, forwards it to the hub at the address setting, and prints the
//! hub's reply. When the hub isn't there, refuses the request, or doesn't acknowledge it within 50 ms of
//! the hook's start, it allows the call and spools the request byte for byte for the hub to replay.
//! As `deep-hook statusline`, Claude Code's status line command, it sends the hub the plan windows the
//! status line reads (#159), then runs your own status line command and prints what it prints.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{env, io};

use deep_contracts::{parse, Value};

/// How long the hub has to acknowledge a request, from the hook's start.
const ACK_BUDGET: Duration = Duration::from_millis(50);
/// How long a reply the hub acknowledged with no hold may take after the acknowledgement.
const REPLY_BUDGET: Duration = Duration::from_secs(1);

/// The features this build supports; the request carries only those the hub lists too.
fn features() -> &'static [&'static str] {
    if cfg!(feature = "plant-f-test") {
        &["f_test"]
    } else {
        &[]
    }
}

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_default()).join(".deepbuild")
}

/// The one address setting: `hub.address` in ~/.deepbuild/config.json, `unix:<path>`; absent, ~/.deepbuild/hub.sock.
fn address() -> PathBuf {
    let configured = fs::read_to_string(home().join("config.json"))
        .ok()
        .and_then(|text| parse(&text).ok())
        .and_then(|config| {
            member(&config, "hub")
                .and_then(|hub| member(hub, "address"))
                .cloned()
        });
    match configured {
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

/// What the hub's reply came to, or why deep-hook acts as it does with the hub down.
enum Outcome {
    Reply {
        exit: u8,
        stdout: String,
        stderr: String,
    },
    Down,
}

fn read_line(reader: &mut BufReader<UnixStream>, deadline: Instant) -> Option<Value> {
    let left = deadline.checked_duration_since(Instant::now())?;
    reader
        .get_ref()
        .set_read_timeout(Some(left.max(Duration::from_millis(1))))
        .ok()?;
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(n) if n > 0 && line.ends_with('\n') => parse(line.trim_end()).ok(),
        _ => None,
    }
}

fn integer(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(n)) if n.fract() == 0.0 => Some(*n),
        _ => None,
    }
}

/// One exchange with the hub: its hello, the request, its acknowledgement and its reply. Returns the line sent.
fn exchange(start: Instant, line: impl Fn(&[&str]) -> String) -> (Option<String>, Outcome) {
    let deadline = start + ACK_BUDGET;
    let stream = match UnixStream::connect(address()) {
        Ok(stream) => stream,
        Err(_) => return (None, Outcome::Down),
    };
    let mut reader = BufReader::new(stream);
    let Some(hello) = read_line(&mut reader, deadline) else {
        return (None, Outcome::Down);
    };
    let listed: Vec<String> = match member(&hello, "features") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|f| {
                if let Value::String(s) = f {
                    Some(s.clone())
                } else {
                    None
                }
            })
            .collect(),
        _ => Vec::new(),
    };
    let on: Vec<&str> = features()
        .iter()
        .copied()
        .filter(|f| listed.iter().any(|l| l == f))
        .collect();
    let request = line(&on);
    if reader.get_mut().write_all(request.as_bytes()).is_err() {
        return (Some(request), Outcome::Down);
    }
    // The first line back must be the acknowledgement; a refusal, or anything else, is the hub down.
    let Some(ack) = read_line(&mut reader, deadline) else {
        return (Some(request), Outcome::Down);
    };
    if member(&ack, "ack").is_none() || member(&ack, "v").is_none() {
        return (Some(request), Outcome::Down);
    }
    let due = match integer(member(&ack, "hold_until_ms")) {
        Some(ms) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64;
            Instant::now() + Duration::from_millis((ms - now).max(0.0) as u64)
        }
        None => Instant::now() + REPLY_BUDGET,
    };
    let Some(reply) = read_line(&mut reader, due) else {
        return (Some(request), Outcome::Down);
    };
    // Only a reply that holds to hook.reply@2 is printed; never bytes deep-hook couldn't parse.
    match (
        member(&reply, "v"),
        integer(member(&reply, "exit")),
        member(&reply, "stdout"),
        member(&reply, "stderr"),
    ) {
        (Some(_), Some(exit), Some(Value::String(stdout)), Some(Value::String(stderr)))
            if (0.0..=255.0).contains(&exit) =>
        {
            (
                Some(request),
                Outcome::Reply {
                    exit: exit as u8,
                    stdout: stdout.clone(),
                    stderr: stderr.clone(),
                },
            )
        }
        _ => (Some(request), Outcome::Down),
    }
}

/// Saves the request as one append of one line, in a file of its own, for the hub to replay when it starts.
fn spool(request: &str, id: &str) -> io::Result<()> {
    let folder = home().join("spool");
    fs::create_dir_all(&folder)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(folder.join(format!("{}-{id}.jsonl", std::process::id())))?;
    file.write_all(request.as_bytes())
}

fn forward(agent: &str, event: &str) -> ExitCode {
    let start = Instant::now();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seq = now.as_nanos().min(i64::MAX as u128).to_string();
    let id = ulid(now.as_millis());
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    // The agent's hook JSON goes as it came: a raw newline in valid JSON is only whitespace, so it becomes a space.
    let payload = if parse(&input).is_ok() {
        input.trim().replace(['\n', '\r'], " ")
    } else {
        quoted(&input)
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
            "{{\"v\":1,\"agent\":{},\"event\":{},\"seq\":\"{seq}\",\"id\":\"{id}\",\"pid\":{},\"ppid\":{},\"matched\":[],\"payload\":{payload}{f_test}}}\n",
            quoted(agent),
            quoted(event),
            std::process::id(),
            std::os::unix::process::parent_id(),
        )
    };
    match exchange(start, line) {
        (
            _,
            Outcome::Reply {
                exit,
                stdout,
                stderr,
            },
        ) => {
            print!("{stdout}");
            eprint!("{stderr}");
            ExitCode::from(exit)
        }
        (sent, Outcome::Down) => {
            let request = sent.unwrap_or_else(|| line(&[]));
            if let Err(error) = spool(&request, &id) {
                if error.kind() != ErrorKind::Interrupted {
                    eprintln!("deep-hook: could not spool {id}: {error}");
                }
            }
            // With the hub down the call is allowed; the fail_closed entries come with the matcher (#17).
            ExitCode::SUCCESS
        }
    }
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
    let command = fs::read_to_string(home().join("config.json"))
        .ok()
        .and_then(|text| parse(&text).ok())
        .and_then(|config| {
            member(&config, "statusline")
                .and_then(|s| member(s, "yours"))
                .cloned()
        });
    let Some(Value::String(command)) = command else {
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
    if read_line(&mut reader, start + SEND_BUDGET).is_some()
        && reader
            .get_mut()
            .write_all(format!("{line}\n").as_bytes())
            .is_ok()
    {
        let _ = read_line(&mut reader, Instant::now() + SEND_BUDGET);
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
        [agent, event] if !agent.starts_with('-') => return forward(agent, event),
        _ => {
            eprintln!("Usage: deep-hook <agent> <event>, with the hook's JSON on stdin. Run deep-hook --help.");
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}
