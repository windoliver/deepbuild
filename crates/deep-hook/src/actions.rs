//! `deep-hook mcp actions`: deep-actions (#363), the second MCP server entry, which serves the plug-ins' two action
//! tools apart from the deep_* tools. It is deep-hook rather than a second Node process so that a session's servers
//! fit #824's memory budget: an idle Node process alone holds about 11 MB on the reference Mac. It serves what `deep
//! mcp actions` serves, from actions.json (scripts/actions-server.mjs writes it from the hub's own tool list and
//! codes): newline-delimited JSON-RPC on stdin and stdout, each tool call forwarded to the hub as `deep mcp` forwards
//! it, presenting the agent that started it as its parent. With the hub away a call is answered within a second that
//! the hub is unreachable, never with a success.

use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::process::{Command, ExitCode};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use deep_contracts::{jcs, parse, Value};

use super::{address, home, member, quoted, read_line, setting, worktree_hub, Got, CWD};

/// The two tools and the codes' pages, as the hub lists them.
const DATA: &str = include_str!("actions.json");
/// How long the hub has to take the connection and name its role.
const UNREACHABLE: Duration = Duration::from_millis(1000);
/// Longer than any call the hub holds open, as `deep mcp` waits.
const ANSWER: Duration = Duration::from_secs(55);

fn object(members: Vec<(&str, Value)>) -> Value {
    Value::Object(
        members
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}
fn text(s: &str) -> Value {
    Value::String(s.to_string())
}
fn list(value: Option<&Value>) -> &[Value] {
    match value {
        Some(Value::Array(items)) => items,
        _ => &[],
    }
}
fn string(value: Option<&Value>) -> &str {
    match value {
        Some(Value::String(s)) => s,
        _ => "",
    }
}

/// JSON as `JSON.stringify` writes it, members in the order they came: the text an agent reads, and its hooks see,
/// is `deep mcp actions`' to the byte, so a failure's signature (#26) doesn't change with the server.
fn ordered(value: &Value) -> String {
    match value {
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(ordered).collect::<Vec<_>>().join(",")
        ),
        Value::Object(members) => {
            // A JavaScript object lists its array-index keys first, in ascending order, then the rest as they came.
            let index = |k: &str| match k.parse::<u32>() {
                Ok(n) if n < u32::MAX && n.to_string() == k => Some(n),
                _ => None,
            };
            let mut keys: Vec<&(String, Value)> =
                members.iter().filter(|(k, _)| index(k).is_some()).collect();
            keys.sort_by_key(|(k, _)| index(k));
            keys.extend(members.iter().filter(|(k, _)| index(k).is_none()));
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|(k, v)| format!("{}:{}", quoted(k), ordered(v)))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        leaf => jcs(leaf),
    }
}

/// error@2 for a hub that can't be reached: retryable, nothing recorded.
fn unreachable(why: &str) -> Value {
    object(vec![
        ("code", text("unavailable")),
        ("retryable", Value::Bool(true)),
        ("remediation", text(&format!("The DeepBuild hub is unreachable ({why}); nothing was recorded. Call again once it is back."))),
        ("path", text("")),
        ("actual", text("")),
        ("evidence", Value::Array(Vec::new())),
    ])
}

/// The agent that started this server, by PID and start time as `ps -o lstart=` prints it.
fn parent() -> (u32, String) {
    let pid = std::os::unix::process::parent_id();
    let start = Command::new("ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .env("LC_ALL", "C")
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .unwrap_or_default();
    (pid, start)
}

/// What the hub answered a call: its result, its refusal (or the hub's unreachability), or a reply line this
/// parser can't read, passed on as the hub wrote it.
enum Reply {
    Result(Value),
    Refused(Value),
    Unread(String),
}

/// The calls waiting on a connection, by id; None once it has closed.
type Waiting = Arc<Mutex<Option<HashMap<String, mpsc::Sender<Reply>>>>>;

/// A call that stopped waiting, so a late reply goes nowhere.
fn forget(waiting: &Waiting, id: &str) {
    if let Some(calls) = waiting.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        calls.remove(id);
    }
}

/// The hub as `deep mcp` holds it: one connection, made at the first call and again after it closes, with the
/// hello said once on it; requests queue for it as Node's socket buffers them, and each reply goes to its call by id.
struct Hub {
    hello: String,
    // The queue to the connection's writer while it is up, with the calls waiting on it.
    conn: Mutex<Option<(mpsc::Sender<String>, Waiting)>>,
    ids: AtomicU64,
    // A connect still running, perhaps past its second.
    connecting: Arc<AtomicBool>,
    // Connects that failed so far: calls that waited on a try that failed fail with it, as `deep mcp`'s share one.
    failed: AtomicU64,
}

impl Hub {
    /// A connection the hub has taken and named its role on, within UNREACHABLE.
    fn connect(&self) -> Option<(mpsc::Sender<String>, Waiting)> {
        // As `deep mcp` reads the address setting: a worktree sent to a dev hub reaches it; otherwise a config.json
        // that isn't JSON, or a hub.address that isn't unix:<absolute path>, reaches no hub rather than the default.
        let path = match worktree_hub(setting("hub", "use").as_ref()) {
            Some(path) => path,
            None => {
                if let Ok(text) = fs::read_to_string(home().join("config.json")) {
                    let config = parse(&text).ok()?;
                    match member(&config, "hub").and_then(|hub| member(hub, "address")) {
                        None => {}
                        Some(Value::String(a))
                            if a.strip_prefix("unix:").is_some_and(|p| p.starts_with('/')) => {}
                        Some(_) => return None,
                    }
                }
                address()
            }
        };
        let due = Instant::now() + UNREACHABLE;
        // A hub that takes no connection (its backlog full, or stopped) is unreachable within the second too; while
        // one try is still stuck there, no other starts.
        if self.connecting.swap(true, Ordering::SeqCst) {
            return None;
        }
        let (tx, rx) = mpsc::channel();
        let connecting = Arc::clone(&self.connecting);
        let started = thread::Builder::new().spawn(move || {
            let tried = UnixStream::connect(path);
            connecting.store(false, Ordering::SeqCst);
            let _ = tx.send(tried);
        });
        if started.is_err() {
            self.connecting.store(false, Ordering::SeqCst);
            return None;
        }
        let stream = rx.recv_timeout(UNREACHABLE).ok()?.ok()?;
        let mut writer = stream.try_clone().ok()?;
        let mut reader = BufReader::new(stream);
        if !matches!(read_line(&mut reader, Some(due)), Got::Line(_)) {
            return None;
        }
        writer.write_all(self.hello.as_bytes()).ok()?;
        loop {
            match read_line(&mut reader, Some(due)) {
                Got::Line(line)
                    if parse(line.trim_end()).is_ok_and(|v| member(&v, "role").is_some()) =>
                {
                    break
                }
                Got::Line(_) => {}
                _ => return None,
            }
        }
        let waiting: Waiting = Arc::new(Mutex::new(Some(HashMap::new())));
        let woken = Arc::clone(&waiting);
        // A write that fails shuts the connection, which the reader takes as its close.
        let (queue, requests) = mpsc::channel::<String>();
        thread::Builder::new()
            .spawn(move || {
                for request in requests {
                    if writer.write_all(request.as_bytes()).is_err() {
                        let _ = writer.shutdown(Shutdown::Both);
                        return;
                    }
                }
            })
            .ok()?;
        thread::Builder::new()
            .spawn(move || loop {
                let line = match read_line(&mut reader, None) {
                    Got::Line(line) => line,
                    _ => {
                        // Closed: every call still waiting on it is told so, and the next call connects again.
                        let closed = woken.lock().unwrap_or_else(|e| e.into_inner()).take();
                        for (_, wake) in closed.into_iter().flatten() {
                            let _ =
                                wake.send(Reply::Refused(unreachable("it closed the connection")));
                        }
                        return;
                    }
                };
                let line = line.trim_end();
                let (id, reply) = match parse(line) {
                    Ok(reply) => {
                        let id = string(member(&reply, "id")).to_string();
                        match member(&reply, "error") {
                            Some(error) => (id, Reply::Refused(error.clone())),
                            None => (
                                id,
                                Reply::Result(
                                    member(&reply, "result").cloned().unwrap_or(Value::Null),
                                ),
                            ),
                        }
                    }
                    // The hub writes a reply's id first; past it is what this parser couldn't read.
                    Err(_) => match line
                        .strip_prefix("{\"v\":1,\"id\":\"")
                        .and_then(|rest| rest.split_once('"'))
                    {
                        Some((id, _)) => (id.to_string(), Reply::Unread(line.to_string())),
                        None => continue,
                    },
                };
                let wake = woken
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_mut()
                    .and_then(|calls| calls.remove(&id));
                if let Some(wake) = wake {
                    let _ = wake.send(reply);
                }
            })
            .ok()?;
        Some((queue, waiting))
    }

    /// One call through the hub, answered within ANSWER of its start.
    fn call(&self, tool: &str, arguments: &Value) -> Reply {
        let due = Instant::now() + ANSWER;
        let id = format!("mcp#{}", self.ids.fetch_add(1, Ordering::Relaxed) + 1);
        let request = format!(
            "{{\"v\":1,\"id\":{},\"method\":\"mcp.call\",\"params\":{{\"tool\":{},\"arguments\":{}}}}}\n",
            quoted(&id),
            quoted(tool),
            ordered(arguments)
        );
        let (tx, rx) = mpsc::channel();
        let failed = self.failed.load(Ordering::SeqCst);
        let waiting = {
            // Calls made while it connects wait for that connection, as `deep mcp`'s do.
            let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            // The call is waiting before its request goes, on a connection still open, or on a new one.
            let mut tx = Some(tx);
            let mut wait_on = |waiting: &Waiting| match waiting
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_mut()
            {
                Some(calls) => calls
                    .insert(id.clone(), tx.take().expect("one wait per call"))
                    .is_none(),
                None => false,
            };
            if !conn.as_ref().is_some_and(|(_, waiting)| wait_on(waiting)) {
                // A try that failed while this call waited for it is this call's answer too.
                *conn = None;
                if self.failed.load(Ordering::SeqCst) != failed {
                    return Reply::Refused(unreachable("no answer on its socket"));
                }
                *conn = self.connect();
                if !conn.as_ref().is_some_and(|(_, waiting)| wait_on(waiting)) {
                    *conn = None;
                    self.failed.fetch_add(1, Ordering::SeqCst);
                    return Reply::Refused(unreachable("no answer on its socket"));
                }
            }
            let (queue, waiting) = conn.as_ref().expect("connected above");
            let waiting = Arc::clone(waiting);
            if queue.send(request).is_err() {
                *conn = None;
                forget(&waiting, &id);
                return Reply::Refused(unreachable("it closed the connection"));
            }
            waiting
        };
        match rx.recv_timeout(due.saturating_duration_since(Instant::now())) {
            Ok(reply) => reply,
            Err(_) => {
                forget(&waiting, &id);
                Reply::Refused(unreachable("it did not answer in time"))
            }
        }
    }
}

/// Serves the agent on stdin and stdout until stdin closes, then waits for the calls still running.
pub fn serve() -> ExitCode {
    let data = parse(DATA).expect("actions.json is JSON");
    let tools = list(member(&data, "tools")).to_vec();
    let codes = list(member(&data, "codes")).to_vec();
    let (pid, start) = parent();
    let folder = std::env::current_dir().unwrap_or_default();
    // A worktree `deep hub use --root` sent to a dev hub reaches that hub, as the session's hooks do.
    let _ = CWD.set(folder.clone());
    let cwd = folder.to_string_lossy().into_owned();
    let hub = Hub {
        hello: format!(
            "{{\"v\":1,\"hello\":\"mcp\",\"parent\":{{\"pid\":{pid},\"start\":{}}},\"cwd\":{}}}\n",
            quoted(&start),
            quoted(&cwd)
        ),
        conn: Mutex::new(None),
        ids: AtomicU64::new(0),
        connecting: Arc::default(),
        failed: AtomicU64::new(0),
    };
    let out = Mutex::new(io::stdout());
    let send = |id: &Value, key: &str, value: Value| {
        let message = object(vec![
            ("jsonrpc", text("2.0")),
            ("id", id.clone()),
            (key, value),
        ]);
        let mut out = out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(out, "{}", ordered(&message));
        let _ = out.flush();
    };
    let failure = |code: f64, message: String| {
        object(vec![
            ("code", Value::Number(code)),
            ("message", Value::String(message)),
        ])
    };
    thread::scope(|scope| {
        for raw in io::stdin().lock().lines() {
            let Ok(raw) = raw else { break };
            let Ok(request) = parse(&raw) else {
                send(
                    &Value::Null,
                    "error",
                    failure(
                        -32700.0,
                        "Parse error: send one JSON-RPC message per line.".into(),
                    ),
                );
                continue;
            };
            // A notification.
            let Some(id) = member(&request, "id").cloned() else {
                continue;
            };
            let empty = Value::Object(Vec::new());
            let params = member(&request, "params").unwrap_or(&empty);
            let method = match member(&request, "method") {
                Some(Value::String(method)) => method.clone(),
                Some(other) => jcs(other),
                None => "undefined".into(),
            };
            match method.as_str() {
                "initialize" => {
                    let version = match member(params, "protocolVersion") {
                        Some(Value::String(v)) => v.clone(),
                        _ => "2025-06-18".into(),
                    };
                    let capabilities =
                        object(vec![("tools", empty.clone()), ("resources", empty.clone())]);
                    let info = object(vec![
                        ("name", text("deep-actions")),
                        ("version", text("0.0.0")),
                    ]);
                    send(
                        &id,
                        "result",
                        object(vec![
                            ("protocolVersion", Value::String(version)),
                            ("capabilities", capabilities),
                            ("serverInfo", info),
                        ]),
                    );
                }
                "ping" => send(&id, "result", empty.clone()),
                "tools/list" => send(
                    &id,
                    "result",
                    object(vec![("tools", Value::Array(tools.clone()))]),
                ),
                "resources/list" => {
                    let listed = codes.iter().map(|page| {
                        let code = string(member(page, "code"));
                        object(vec![
                            ("uri", Value::String(format!("deep://codes/{code}"))),
                            ("name", text(code)),
                            (
                                "description",
                                member(page, "meaning").cloned().unwrap_or(Value::Null),
                            ),
                            ("mimeType", text("application/json")),
                        ])
                    });
                    send(
                        &id,
                        "result",
                        object(vec![("resources", Value::Array(listed.collect()))]),
                    );
                }
                "resources/read" => {
                    let uri = match member(params, "uri") {
                        Some(Value::String(uri)) => uri.clone(),
                        Some(other) => jcs(other),
                        None => "undefined".into(),
                    };
                    let code = uri.strip_prefix("deep://codes/").filter(|c| {
                        !c.is_empty() && c.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
                    });
                    match code
                        .and_then(|c| codes.iter().find(|page| string(member(page, "code")) == c))
                    {
                        Some(page) => {
                            let content = object(vec![
                                ("uri", Value::String(uri.clone())),
                                ("mimeType", text("application/json")),
                                ("text", Value::String(ordered(page))),
                            ]);
                            send(
                                &id,
                                "result",
                                object(vec![("contents", Value::Array(vec![content]))]),
                            );
                        }
                        None => {
                            let all: Vec<String> = codes
                                .iter()
                                .map(|p| format!("deep://codes/{}", string(member(p, "code"))))
                                .collect();
                            send(
                                &id,
                                "error",
                                failure(
                                    -32002.0,
                                    format!(
                                        "No resource {uri}; the codes' pages are {}.",
                                        all.join(", ")
                                    ),
                                ),
                            );
                        }
                    }
                }
                "tools/call" => {
                    let name = match member(params, "name") {
                        Some(Value::String(name)) => name.clone(),
                        Some(other) => jcs(other),
                        None => "undefined".into(),
                    };
                    if !tools.iter().any(|t| string(member(t, "name")) == name) {
                        let names: Vec<&str> =
                            tools.iter().map(|t| string(member(t, "name"))).collect();
                        send(
                            &id,
                            "error",
                            failure(
                                -32602.0,
                                format!("No tool {name}; the tools are {}.", names.join(", ")),
                            ),
                        );
                        continue;
                    }
                    let arguments = match member(params, "arguments") {
                        None | Some(Value::Null) => empty.clone(),
                        Some(given) => given.clone(),
                    };
                    let (send, hub) = (&send, &hub);
                    // A call that waits holds up no other call.
                    scope.spawn(move || {
                        let (ok, value) = match hub.call(&name, &arguments) {
                            Reply::Result(value) => (true, value),
                            Reply::Refused(value) => (false, value),
                            // Not "unreachable": the hub answered, and the call may have run.
                            Reply::Unread(line) => {
                                let content = object(vec![
                                    ("type", text("text")),
                                    ("text", Value::String(format!("deep-actions couldn't read the hub's reply as JSON both languages read alike; the call may have run. The hub's reply: {line}"))),
                                ]);
                                send(&id, "result", object(vec![("content", Value::Array(vec![content])), ("isError", Value::Bool(true))]));
                                return;
                            }
                        };
                        // A plug-in action that started and failed is an error the agent sees, with its report (#363).
                        let failed = ok && string(member(&value, "status")) == "failed";
                        let content = object(vec![
                            ("type", text("text")),
                            ("text", Value::String(ordered(&value))),
                        ]);
                        let mut result = vec![
                            ("content", Value::Array(vec![content])),
                            ("isError", Value::Bool(!ok || failed)),
                        ];
                        if ok {
                            result.push(("structuredContent", value));
                        }
                        send(&id, "result", object(result));
                    });
                }
                method => send(
                    &id,
                    "error",
                    failure(-32601.0, format!("Method {method} not found.")),
                ),
            }
        }
    });
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::ordered;
    use deep_contracts::parse;

    #[test]
    fn a_text_is_what_json_stringify_writes() {
        // Node's JSON.stringify(JSON.parse(input)), read off Node 24: index keys first and ascending, a repeated
        // key where it first came with its last value, numbers in ECMAScript's form.
        let input = "{\"b\":1,\"2\":0,\"10\":{\"z\":1,\"0\":2},\"01\":2,\"4294967295\":3,\"4294967294\":4,\"a\":[1e21,-0,0.1,\"\u{2028}\\u0001\\\"x\"],\"b\":5}";
        let node = "{\"2\":0,\"10\":{\"0\":2,\"z\":1},\"4294967294\":4,\"b\":5,\"01\":2,\"4294967295\":3,\"a\":[1e+21,0,0.1,\"\u{2028}\\u0001\\\"x\"]}";
        assert_eq!(ordered(&parse(input).unwrap()), node);
    }
}
