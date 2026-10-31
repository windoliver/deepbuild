//! Bug captures past #105's acceptance tests (its README: "a run whose `state` already holds a
//! record restarts from it, as #96's does"): a saved capture and the ask it opened come back from
//! the record after a restart, and a new capture there takes the next id.
//! Each drives `deep-show run` as the acceptance tests do.
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const SEC: i64 = 705_600_000;
const B: &str = "9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49";

/// Plays `calls` with displays A and B, alpha's session, and `dir`'s evidence store and state
/// folder; one reply per call.
fn run(dir: &Path, calls: Vec<Value>) -> Vec<Value> {
    let scenario = json!({
        "evidence": dir.join("evidence"),
        "state": dir.join("state"),
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "clock": {"lead": SEC / 500, "check": SEC / 2000},
        "displays": [
            {"uuid": "37D8832A-2D66-02CA-B9F7-8F30A301B230", "bounds": [0, 0, 1512, 982], "scale": 2,
             "refresh_hz": 120, "next_vsync": SEC / 120, "color_space": "p3", "feed": "feed-a"},
            {"uuid": B, "bounds": [1512, 0, 1920, 1080], "scale": 1,
             "refresh_hz": 60, "next_vsync": 3 * SEC / 1000, "color_space": "srgb", "feed": "feed-b"}
        ],
        "window": [1200, 700],
        "panels": {},
        "calls": calls,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    answer["replies"].as_array().expect("replies").clone()
}

#[test]
fn a_saved_capture_and_its_ask_come_back_after_a_restart() {
    let dir = std::env::temp_dir().join(format!("deep-show-capture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let first = run(
        &dir,
        vec![
            json!({"call": "capture", "at": 0, "session": "sess-alpha", "source": "screen", "words": "the total is wrong"}),
            json!({"call": "pick", "at": SEC / 10, "display": B}),
            json!({"call": "shortcut", "at": SEC / 2, "phase": "down", "source": "hid"}),
            json!({"call": "shortcut", "at": 5 * SEC / 2, "phase": "up", "source": "hid"}),
            json!({"call": "captures", "at": 4 * SEC}),
        ],
    );
    let saved = first[4]["captures"][0].clone();
    assert_eq!(saved["state"], json!("saved"), "{saved}");
    let sha = saved["asset"]["sha256"].clone();
    let ask = saved["ask"].as_str().expect("an ask").to_string();

    let after = run(
        &dir,
        vec![
            json!({"call": "captures", "at": SEC}),
            json!({"call": "task", "at": SEC, "task": ask}),
            json!({"call": "capture", "at": 2 * SEC, "session": "sess-alpha", "source": "screen", "words": "again"}),
            json!({"call": "captures", "at": 3 * SEC}),
        ],
    );
    let _ = std::fs::remove_dir_all(&dir);
    let back = &after[0]["captures"][0];
    assert_eq!(
        back["capture"], saved["capture"],
        "after the restart: {back}"
    );
    assert_eq!(back["state"], json!("saved"), "after the restart: {back}");
    assert_eq!(back["frames"], saved["frames"], "after the restart: {back}");
    assert_eq!(back["asset"], saved["asset"], "after the restart: {back}");
    assert_eq!(back["ask"], json!(ask), "after the restart: {back}");
    let task = &after[1]["task"];
    assert_eq!(task["session"], json!("sess-alpha"), "{task}");
    assert_eq!(task["open"], json!(true), "{task}");
    assert_eq!(task["words"], json!("the total is wrong"), "{task}");
    assert_eq!(
        task["evidence"],
        json!([{"sha256": sha, "redaction": "unknown"}]),
        "{task}"
    );
    let checks = task["checks"].as_array().expect("checks");
    assert_eq!(checks.len(), 1, "{task}");
    assert_eq!(checks[0]["state"], json!("drafted"), "{task}");
    assert_eq!(checks[0]["reproduces"], sha, "{task}");
    assert_eq!(checks[0]["required"], json!(true), "{task}");
    let ids: Vec<&Value> = after[3]["captures"]
        .as_array()
        .expect("captures")
        .iter()
        .map(|c| &c["capture"])
        .collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert_ne!(
        ids[0], ids[1],
        "a new capture after the restart takes its own id: {ids:?}"
    );
}
