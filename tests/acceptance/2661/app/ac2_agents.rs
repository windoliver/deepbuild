//! AC2: with the Agents page hidden for 60 s, a stand-in hub receives no `agents.read()`. Shown again, it receives one
//! within 100 ms and the page draws that reading. On the merge base it receives 30.
//!
//! The app's window opens on Home (README: The window). Agents is shown once, so it has been seen, then Home is shown
//! and 60 s pass with Agents hidden, a frame every 250 ms. Then Agents is shown again and 100 ms pass, a frame each
//! 60th of a second. The stand-in answers the n-th `agents.read` with one MCP server named `stand-in reading n`, so
//! the page's server row names the reading it draws.

use std::sync::Arc;
use std::time::Duration;

use gpui_kit::{ElementId, TestAppContext};
use serde_json::{json, Value};

use crate::hub::{record_answer, StandIn};
use crate::window::{every_label, labels, open, pass, show};

const HIDDEN: Duration = Duration::from_secs(60);
const SHOWN_WITHIN: Duration = Duration::from_millis(100);
const FRAME: Duration = Duration::from_micros(16_667);
const TICK: Duration = Duration::from_millis(250);

fn reading(n: usize) -> String {
    format!("stand-in reading {n}")
}

/// The Agents page's model as the hub's `agents.read` gives it (packages/hub/src/agents.ts), its one server named for
/// the reading.
fn agents(n: usize) -> Value {
    json!({
        "agents": [{ "id": "claude-code", "name": "Claude Code", "installed": true }],
        "servers": [{ "name": reading(n), "spec": { "transport": "stdio", "scope": { "repos": [] } }, "agents": ["claude-code"] }],
        "skills": [],
        "syncs": [],
    })
}

#[gpui_kit::test]
fn ac2_a_hidden_agents_page_asks_the_hub_nothing_and_shown_again_reads_once_within_100_ms(cx: &mut TestAppContext) {
    let no_events = |_: u64| Value::Null;
    let hub = StandIn::start(Arc::new(move |method: &str, params: &Value, n: usize| match method {
        "agents.read" => agents(n),
        _ => record_answer(method, params, &no_events, 0).unwrap_or(json!({})),
    }));
    let (window, _home) = open(cx, &hub);
    let mut failures = Vec::new();

    // Agents shown, then hidden behind Home for 60 s.
    show(cx, window, "page/agents");
    show(cx, window, "page/home");
    let before = hub.count("agents.read");
    pass(cx, window, HIDDEN, TICK);
    let hidden = hub.count("agents.read") - before;
    if hidden != 0 {
        failures.push(format!(
            "with the Agents page hidden for 60 s, the stand-in hub received {hidden} agents.read, not 0"
        ));
    }

    // Shown again: one read within 100 ms, and the page draws it.
    let before = hub.count("agents.read");
    show(cx, window, "page/agents");
    pass(cx, window, SHOWN_WITHIN, FRAME);
    let shown = hub.count("agents.read") - before;
    if shown != 1 {
        failures.push(format!(
            "shown again, the Agents page made {shown} agents.read within 100 ms, not 1"
        ));
    }
    let newest = reading(hub.count("agents.read"));
    let rows = labels(cx, window, &ElementId::from(("agents-server", 0usize)));
    if !rows.iter().any(|row| row.contains(&newest)) {
        let drawn: Vec<String> = every_label(cx, window)
            .into_iter()
            .filter(|label| label.contains("stand-in reading"))
            .collect();
        failures.push(format!(
            "shown again, the Agents page draws {drawn:?}, not the hub's newest reading, \"{newest}\" (server rows: {rows:?})"
        ));
    }
    assert!(failures.is_empty(), "FAIL: {}", failures.join("; "));
}
