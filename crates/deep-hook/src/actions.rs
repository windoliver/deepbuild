//! `deep-hook mcp actions`: deep-actions (#363), the second MCP server entry, which serves the plug-ins' two action
//! tools apart from the deep_* tools. It is deep-hook rather than a second Node process so that a session's servers
//! fit #824's memory budget: an idle Node process alone holds about 11 MB on the reference Mac. It serves what `deep
//! mcp actions` serves, from actions.json (scripts/actions-server.mjs writes it from the hub's own tool list and
//! codes): newline-delimited JSON-RPC on stdin and stdout, each tool call forwarded to the hub as `deep mcp` forwards
//! it, presenting the agent that started it as its parent. With the hub away a call is answered within a second that
//! the hub is unreachable, never with a success.

use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::{Command, ExitCode};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use deep_contracts::{jcs, parse, Value};

use super::{address, home, member, quoted, read_line, Got, CWD};

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

/// One call through the hub on a connection of its own: the hub's result, or its refusal or unreachability.
fn call(tool: &str, arguments: &Value, hello: &str) -> Result<Value, Value> {
    // As `deep mcp` reads the address setting: a config.json that isn't JSON, or a hub.address that isn't
    // unix:<absolute path>, reaches no hub rather than the default one.
    if let Ok(text) = fs::read_to_string(home().join("config.json")) {
        let Ok(config) = parse(&text) else {
            return Err(unreachable("no answer on its socket"));
        };
        match member(&config, "hub").and_then(|hub| member(hub, "address")) {
            None => {}
            Some(Value::String(a))
                if a.strip_prefix("unix:").is_some_and(|p| p.starts_with('/')) => {}
            Some(_) => return Err(unreachable("no answer on its socket")),
        }
    }
    let Ok(stream) = UnixStream::connect(address()) else {
        return Err(unreachable("no answer on its socket"));
    };
    let mut reader = BufReader::new(stream);
    let due = Some(Instant::now() + UNREACHABLE);
    if !matches!(read_line(&mut reader, due), Got::Line(_))
        || reader.get_mut().write_all(hello.as_bytes()).is_err()
    {
        return Err(unreachable("no answer on its socket"));
    }
    loop {
        match read_line(&mut reader, due) {
            Got::Line(line)
                if parse(line.trim_end()).is_ok_and(|v| member(&v, "role").is_some()) =>
            {
                break
            }
            Got::Line(_) => {}
            _ => return Err(unreachable("no answer on its socket")),
        }
    }
    let request = format!(
        "{{\"v\":1,\"id\":\"mcp#1\",\"method\":\"mcp.call\",\"params\":{{\"tool\":{},\"arguments\":{}}}}}\n",
        quoted(tool),
        jcs(arguments)
    );
    if reader.get_mut().write_all(request.as_bytes()).is_err() {
        return Err(unreachable("it closed the connection"));
    }
    let due = Some(Instant::now() + ANSWER);
    loop {
        match read_line(&mut reader, due) {
            Got::Line(line) => {
                let Ok(reply) = parse(line.trim_end()) else {
                    continue;
                };
                if string(member(&reply, "id")) != "mcp#1" {
                    continue;
                }
                return match member(&reply, "error") {
                    Some(error) => Err(error.clone()),
                    None => Ok(member(&reply, "result").cloned().unwrap_or(Value::Null)),
                };
            }
            Got::Timeout => return Err(unreachable("it did not answer in time")),
            Got::Closed => return Err(unreachable("it closed the connection")),
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
    let hello = format!(
        "{{\"v\":1,\"hello\":\"mcp\",\"parent\":{{\"pid\":{pid},\"start\":{}}},\"cwd\":{}}}\n",
        quoted(&start),
        quoted(&cwd)
    );
    let out = Mutex::new(io::stdout());
    let send = |id: &Value, key: &str, value: Value| {
        let message = object(vec![
            ("jsonrpc", text("2.0")),
            ("id", id.clone()),
            (key, value),
        ]);
        let mut out = out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(out, "{}", jcs(&message));
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
                                ("text", Value::String(jcs(page))),
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
                    let (send, hello) = (&send, &hello);
                    // A call that waits holds up no other call.
                    scope.spawn(move || {
                        let (ok, value) = match call(&name, &arguments, hello) {
                            Ok(value) => (true, value),
                            Err(value) => (false, value),
                        };
                        // A plug-in action that started and failed is an error the agent sees, with its report (#363).
                        let failed = ok && string(member(&value, "status")) == "failed";
                        let content = object(vec![
                            ("type", text("text")),
                            ("text", Value::String(jcs(&value))),
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
