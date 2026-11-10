//! Issue #1462: a replica's own copy of the hub (design: Replica). Every call the app makes of its hub lands here in
//! place of a socket, in order, so `see` can say what the app sent; nothing reaches your hub. It records `ask.later`
//! as the core does, so the list folds it, and refuses what the hub refuses with no view installed. It never confirms
//! you: only `test-confirm`'s file stands in for the OS.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
        let answered = self.answer(method, params);
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
            "box.say" => Ok(json!({"unread": "A replica drafts nothing."})),
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
