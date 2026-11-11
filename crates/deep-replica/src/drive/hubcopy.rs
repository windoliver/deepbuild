//! Issue #1462: a replica's own copy of the hub (design: Replica). Every call the app makes of its hub lands here in
//! place of a socket, in order, so `see` can say what the app sent; nothing reaches your hub. It records `ask.later`
//! as the core does, so the list folds it, an answer and a row read as the core does (#1461), and refuses what the hub
//! refuses with no view installed. It never confirms you: only `test-confirm`'s file stands in for the OS. ⌘K's
//! lookups (#2024) it answers from a copy of your record taken at launch, through the hub's own lookup run beside it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};

use deep_app::hub::HubError;
use serde_json::{json, Value};

/// How long before its default a later ask comes back: the drafted hour (#1462).
const LATER_BEFORE_MS: u64 = 60 * 60 * 1000;

#[derive(Default)]
pub struct HubCopy {
    /// Every call, `{method, params}` and `error` when refused, in order.
    calls: Mutex<Vec<Value>>,
    /// The events the copy recorded that the replica hasn't delivered to the app's reader yet.
    pending: Mutex<Vec<Value>>,
    /// Each ask the record holds: its session and when its default applies.
    asks: Mutex<HashMap<String, (String, u64)>>,
    /// The hub's lookup over the copy of your record taken at launch, when the replica copied one, or why it didn't
    /// start (#2024).
    lookups: Mutex<Option<Result<Lookups, String>>>,
    /// The reads a slow hub holds, and the turn each takes once it answers again: the newest first (#2024).
    held: Mutex<Held>,
    turn: Condvar,
}

#[derive(Default)]
struct Held {
    slow: bool,
    /// The held reads by ticket, oldest first.
    waiting: Vec<u64>,
    tickets: u64,
}

/// `packages/reading/dist/lookups.js` running beside the replica: a query line in, a lookup line out, in turn.
struct Lookups {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    /// Where it says why it stopped.
    stderr: std::path::PathBuf,
    /// Its copy is taken: the launch never waits for it, the first lookup does.
    ready: bool,
}

impl Lookups {
    fn line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        match self.output.read_line(&mut line) {
            Ok(n) if n > 0 => Ok(line),
            _ => Err(format!(
                "the copy of your record for ⌘K stopped: {}",
                std::fs::read_to_string(&self.stderr)
                    .unwrap_or_default()
                    .trim()
            )),
        }
    }

    fn ask(&mut self, query: &str) -> Result<Value, String> {
        if !self.ready {
            let line = self.line()?;
            if line.trim() != r#"{"ready":true}"# {
                return Err(format!("the copy of your record for ⌘K said {line:?}"));
            }
            self.ready = true;
        }
        writeln!(self.input, "{}", json!({"query": query})).map_err(|e| e.to_string())?;
        let line = self.line()?;
        serde_json::from_str(&line).map_err(|_| format!("the lookup answered {line:?}"))
    }
}

impl Drop for Lookups {
    fn drop(&mut self) {
        // The replica's own child, by its handle: nothing else is stopped.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl HubCopy {
    pub fn new(events: &[Value]) -> Arc<HubCopy> {
        let copy = HubCopy::default();
        for event in events {
            copy.saw(event);
        }
        Arc::new(copy)
    }

    /// An event of the record, as the replica holds it.
    pub fn saw(&self, event: &Value) {
        if event["kind"] != "ask.created" {
            return;
        }
        let handle = format!("ask:{}", event["id"].as_str().unwrap_or_default());
        let session = event["session"].as_str().unwrap_or_default().to_owned();
        let deadline = event["data"]["deadline"].as_u64().unwrap_or(0);
        lock(&self.asks).insert(handle, (session, deadline));
    }

    /// Starts copying the record under the hub's `root` into `folder`, and answers ⌘K's lookups from that copy from
    /// now on (#2024). A copy that can't start leaves the launch as it is; each lookup then says why.
    pub fn copy_lookups(&self, root: &Path, folder: &Path) {
        let started = (|| {
            std::fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
            let script = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../packages/reading/dist/lookups.js");
            let stderr = folder.join("stderr");
            let mut child = Command::new("node")
                .arg(&script)
                .arg(root)
                .arg(folder)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(std::fs::File::create(&stderr).map_err(|e| e.to_string())?)
                .spawn()
                .map_err(|e| format!("node {}: {e}", script.display()))?;
            Ok(Lookups {
                input: child.stdin.take().expect("piped"),
                output: BufReader::new(child.stdout.take().expect("piped")),
                child,
                stderr,
                ready: false,
            })
        })();
        *lock(&self.lookups) = Some(started);
    }

    /// Whether the hub is slow: its reads neither answer nor fail until it answers again, the newest first.
    pub fn set_slow(&self, slow: bool) {
        lock(&self.held).slow = slow;
        self.turn.notify_all();
    }

    /// Holds a read while the hub is slow, until it answers again and every read held after it has answered.
    fn hold(&self) -> Option<u64> {
        let mut held = lock(&self.held);
        if !held.slow {
            return None;
        }
        held.tickets += 1;
        let ticket = held.tickets;
        held.waiting.push(ticket);
        let _held = self
            .turn
            .wait_while(held, |h| h.slow || h.waiting.last() != Some(&ticket))
            .unwrap_or_else(|e| e.into_inner());
        Some(ticket)
    }

    /// A held read answered: the next newest takes its turn.
    fn answered(&self, ticket: Option<u64>) {
        if let Some(ticket) = ticket {
            lock(&self.held).waiting.retain(|t| *t != ticket);
            self.turn.notify_all();
        }
    }

    /// What the app sent its hub since launch.
    pub fn calls(&self) -> Vec<Value> {
        lock(&self.calls).clone()
    }

    /// The events recorded since last taken, for the replica to deliver.
    pub fn take_pending(&self) -> Vec<Value> {
        std::mem::take(&mut *lock(&self.pending))
    }

    /// One call of the app's, answered as the hub would.
    pub fn take(&self, method: &str, params: &Value) -> Result<Value, HubError> {
        let ticket = (method == "find.read").then(|| self.hold()).flatten();
        let answered = self.answer(method, params);
        self.answered(ticket);
        let mut call = json!({"method": method, "params": params});
        if let Err(error) = &answered {
            call["error"] = json!(deep_app::hub::why(error));
        }
        lock(&self.calls).push(call);
        answered
    }

    fn answer(&self, method: &str, params: &Value) -> Result<Value, HubError> {
        let refused = |path: &str, message: String| {
            Err(HubError::Refused(
                json!({"code": "not_found", "path": path, "message": message}),
            ))
        };
        match method {
            "command.run" => refused(
                "/params/action",
                format!(
                    "No installed view runs {}.",
                    params["action"].as_str().unwrap_or_default()
                ),
            ),
            "ask.confirm" => Err(HubError::Refused(
                json!({"code": "confirm", "message": "No one confirms you in a replica."}),
            )),
            "ask.later" => {
                let ask = params["ask"].as_str().unwrap_or_default().to_owned();
                let Some((session, deadline)) = lock(&self.asks).get(&ask).cloned() else {
                    return refused("/params/ask", format!("{ask} is no ask"));
                };
                self.record(
                    &session,
                    json!({"kind": "ask.later", "subject": ask, "data": {"until": deadline.saturating_sub(LATER_BEFORE_MS)}}),
                );
                Ok(json!({"ask": ask}))
            }
            "session.pause" => {
                let session = params["session"].as_str().unwrap_or_default().to_owned();
                // A session subject in letters and digits, as every session event names it.
                let letters: String = session
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .collect();
                self.record(
                    &session,
                    json!({"kind": "session.paused", "subject": format!("session:{letters}"), "data": {}}),
                );
                Ok(json!({"session": session, "paused": true}))
            }
            // A rename is the name you gave the session, and its row is set with it, as the core records them (#2018).
            "session.rename" => {
                let session = params["session"].as_str().unwrap_or_default().to_owned();
                let name = params["name"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                if name.is_empty() {
                    return Err(HubError::Refused(
                        json!({"code": "type", "path": "/params/name", "message": "Give the session a name."}),
                    ));
                }
                let letters: String = session
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .collect();
                self.record(
                    &session,
                    json!({"kind": "session.named", "subject": format!("session:{letters}"), "data": {"name": name, "by": "you"}}),
                );
                let id = format!("session:{session}");
                let row = deep_app::record::with_view(|view| {
                    let table = view.table();
                    Some((table.row_of(&id)?.clone(), table.order_of(&id)?))
                })
                .flatten();
                if let Some((mut row, order)) = row {
                    row["title"] = json!(name);
                    row["listed"] = json!(true);
                    row["order"] = json!(order);
                    self.record(&session, json!({"kind": "row.set", "data": row}));
                }
                Ok(json!({"session": session, "name": name}))
            }
            "box.say" => Ok(json!({"unread": "A replica drafts nothing."})),
            // ⌘K's lookup, from the copy of your record; a replica of a fixture holds no archive, so it finds nothing.
            "find.read" => match lock(&self.lookups).as_mut() {
                Some(Ok(lookups)) => lookups
                    .ask(params["query"].as_str().unwrap_or_default())
                    .map_err(|message| {
                        HubError::Refused(json!({"code": "lookup", "message": message}))
                    }),
                Some(Err(why)) => Err(HubError::Refused(
                    json!({"code": "lookup", "message": why.clone()}),
                )),
                None => Ok(json!({"hits": []})),
            },
            // An answer closes its ask and its row leaves the list, as the core records them (#1461).
            "ask.answer" => {
                let ask = params["ask"].as_str().unwrap_or_default().to_owned();
                let Some((session, _)) = lock(&self.asks).get(&ask).cloned() else {
                    return refused("/params/ask", format!("{ask} is no ask"));
                };
                self.record(
                    &session,
                    json!({"kind": "ask.answered", "subject": ask, "data": {"answer": params["option"], "words": params["words"], "via": "card"}}),
                );
                self.record(
                    &session,
                    json!({"kind": "row.set", "data": {"id": ask, "listed": false}}),
                );
                Ok(json!({"answered": true}))
            }
            // A row read: the row as the record holds it, no longer unread (#1461).
            "row.read" => {
                let id = params["id"].as_str().unwrap_or_default().to_owned();
                let row = deep_app::record::with_view(|view| {
                    let table = view.table();
                    Some((table.row_of(&id)?.clone(), table.order_of(&id)?))
                })
                .flatten();
                if let Some((mut row, order)) = row {
                    row["unread"] = json!(false);
                    row["listed"] = json!(true);
                    row["order"] = json!(order);
                    let session = row["session"].as_str().unwrap_or_default().to_owned();
                    self.record(&session, json!({"kind": "row.set", "data": row}));
                }
                Ok(json!({"id": id}))
            }
            _ => Ok(json!({})),
        }
    }

    /// An event the copy appends as the core.
    fn record(&self, session: &str, mut event: Value) {
        event["v"] = json!(1);
        event["writer"] = json!("core");
        event["actor"] = json!("you");
        event["scope"] = json!("you");
        event["session"] = json!(session);
        lock(&self.pending).push(event);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
