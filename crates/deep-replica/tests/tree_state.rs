//! Issue #1459's state in the snapshot, past its acceptance suite: a state is read as its status-map entry, the
//! snapshot holds the menu bar's title and what holds the keyboard, the question card's node is valued by its arming
//! state, and what an agent's panel draws sits under a node saying an agent wrote it. Each test drives the real
//! deep-drive binary over the #338 fixture record.
#![cfg(target_os = "macos")]

use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

use serde_json::{json, Value};

struct Drive {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    replica: Value,
    out: std::path::PathBuf,
}

impl Drive {
    fn launch(name: &str, launch: Value) -> Drive {
        let out = std::env::temp_dir().join(format!("deep-tree-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&out);
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-drive"))
            .arg("--out")
            .arg(&out)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("deep-drive starts");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut drive = Drive {
            child,
            stdin,
            stdout,
            replica: Value::Null,
            out,
        };
        assert_eq!(drive.read()["ready"], true);
        let reply = drive.call(json!({"call": "launch", "launch": launch}));
        assert_eq!(reply["ok"], true, "launch: {reply}");
        drive.replica = reply["replica"].clone();
        drive
    }

    fn read(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("a reply line");
        serde_json::from_str(&line).expect("a JSON reply")
    }

    fn call(&mut self, mut call: Value) -> Value {
        call["replica"] = self.replica.clone();
        writeln!(self.stdin, "{call}").unwrap();
        self.read()
    }

    fn see(&mut self) -> Value {
        let reply = self.call(json!({"call": "see", "see": {}}));
        assert_eq!(reply["ok"], true, "see: {reply}");
        reply["snapshot"].clone()
    }

    fn click(&mut self, id: &str) {
        let reply =
            self.call(json!({"call": "act", "locator": {"id": id}, "act": {"kind": "click"}}));
        assert_eq!(reply["ok"], true, "click {id}: {reply}");
    }
}

impl Drop for Drive {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.out);
    }
}

fn nodes(node: &Value) -> Vec<&Value> {
    let mut all = vec![node];
    for child in node["children"].as_array().into_iter().flatten() {
        all.extend(nodes(child));
    }
    all
}

fn with_id<'a>(snapshot: &'a Value, prefix: &str) -> Vec<&'a Value> {
    nodes(&snapshot["tree"])
        .into_iter()
        .filter(|n| n["id"].as_str().is_some_and(|id| id.starts_with(prefix)))
        .collect()
}

/// The word on every surface and its status-map entry, from the design's States people see.
const ENTRIES: [(&str, &str); 11] = [
    ("queued", "idle"),
    ("working", "running"),
    ("says done", "running"),
    ("PASS", "pass"),
    ("sent back", "fail"),
    ("BLOCKED", "blocked"),
    ("INVALID", "invalid"),
    ("INCONCLUSIVE", "inconclusive"),
    ("needs you", "needs_you"),
    ("stale", "stale"),
    ("quiet", "idle"),
];

#[test]
fn a_state_is_read_as_its_status_map_entry() {
    let snapshot = Drive::launch("value", json!({"from": "fixture"})).see();
    let rows = with_id(&snapshot, "session:");
    assert!(!rows.is_empty(), "the sidebar has session rows");
    for row in rows {
        let name = row["name"].as_str().unwrap_or_default();
        let (_, said) = name
            .split_once(" · ")
            .unwrap_or_else(|| panic!("{name} says its state"));
        let (_, entry) = ENTRIES
            .iter()
            .find(|(word, _)| said.starts_with(word))
            .unwrap_or_else(|| panic!("{name} says a state's word"));
        assert_eq!(
            row["value"], *entry,
            "the row {name} is valued by its state's entry"
        );
    }
    let asks = with_id(&snapshot, "ask:");
    assert!(!asks.is_empty(), "Needs you has rows");
    for ask in asks {
        assert_eq!(ask["value"], "needs_you", "{ask}");
    }
}

#[test]
fn the_snapshot_holds_the_menu_bar_title_and_the_ringed_row_as_focus() {
    let mut drive = Drive::launch("focus", json!({"from": "fixture"}));
    let before = drive.see();
    assert_eq!(
        before["menu_bar"]["title"],
        with_id(&before, "ask:").len().to_string(),
        "the menu bar counts the asks Needs you lists"
    );
    assert_eq!(
        before["focus"],
        Value::Null,
        "nothing holds the keyboard at launch"
    );
    let second = with_id(&before, "session:")[1]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    drive.click(&second);
    assert_eq!(
        drive.see()["focus"],
        second.as_str(),
        "the clicked row is ringed and holds the keyboard"
    );
}

#[test]
fn the_question_card_is_valued_by_its_arming_state_and_holds_the_keyboard() {
    let mut drive = Drive::launch("card", json!({"from": "fixture"}));
    let ask = with_id(&drive.see(), "ask:")[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    drive.click(&ask);
    let shown = drive.see();
    let card = with_id(&shown, "question-card");
    assert_eq!(card.len(), 1, "one card node");
    assert_eq!(
        card[0]["value"], "presented",
        "a card just shown isn't armed"
    );
    assert_eq!(shown["focus"], "question-card");
    let armed = drive.call(json!({
        "call": "expect", "locator": {"id": "question-card"},
        "expect": {"name": "the card arms", "assert": "value", "value": "armed"}, "timeout": 2000,
    }));
    assert_eq!(armed["assertion"]["passed"], true, "{armed}");
}

#[test]
fn what_an_agents_panel_draws_sits_under_a_node_saying_an_agent_wrote_it() {
    let panel = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/agent-words-panel"
    );
    let snapshot = Drive::launch("agent", json!({"from": "fixture", "panel": panel})).see();
    let marked: Vec<&Value> = nodes(&snapshot["tree"])
        .into_iter()
        .filter(|n| n["name"] == "Written by an agent")
        .collect();
    assert_eq!(marked.len(), 1, "one node marks the panel");
    assert_eq!(marked[0]["role"], "group");
    let words = |n: &&Value| n["name"] == "Deploy finished";
    let inside = nodes(marked[0]).into_iter().filter(words).count();
    let everywhere: Vec<&Value> = nodes(&snapshot["tree"]).into_iter().filter(words).collect();
    assert_eq!(
        (inside, everywhere.len()),
        (1, 1),
        "the panel's words are in the tree once, under its mark {}: {everywhere:?}",
        marked[0]["bounds"]
    );
}
