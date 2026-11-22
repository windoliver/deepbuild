//! #3044: `deep-show canvas` builds its pack store afresh for every call, and a pack version's
//! check runs once a process, not on each call (#1720), its libraries' and interfaces' fixtures
//! included. The first-party lanes pack carries a library and its interface: its check compiles
//! and runs their fixtures, seconds in a dev build, which every later call paid again.
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Instant;

use serde_json::{json, Value};

const DOCS: [&str; 3] = [
    "01JB3044000000000000000001",
    "01JB3044000000000000000002",
    "01JB3044000000000000000003",
];

#[test]
fn a_library_packs_check_runs_on_the_first_call_only() {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let evidence = std::env::temp_dir().join(format!("deep-show-3044-{}", std::process::id()));
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("canvas")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    let mut stdin = child.stdin.take().expect("stdin");
    let mut lines = BufReader::new(child.stdout.take().expect("stdout")).lines();
    let mut ask = |line: Value| -> (Value, f64) {
        let at = Instant::now();
        writeln!(stdin, "{line}").expect("written");
        let answer = lines.next().expect("an answer").expect("a line");
        (
            serde_json::from_str(&answer).expect("JSON"),
            at.elapsed().as_secs_f64(),
        )
    };
    let world = json!({"world": {
        "evidence": evidence,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 0, "start": 0}}},
        "record": {},
        "panels": {"main": {"rect": [0, 0, 800, 600]}},
        "docs": DOCS.iter().map(|d| (d.to_string(), json!({"panel": "main"}))).collect::<serde_json::Map<_, _>>(),
        "packs": [{"id": "deepbuild/lanes", "dir": repo.join("packs/lanes-1.0.0")}],
    }});
    assert_eq!(ask(world).0["ok"], json!(true), "the world is taken");
    let (packs, first) = ask(json!({"call": {"call": "packs"}}));
    let row = packs["reply"]["packs"]
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["pack"] == "deepbuild/lanes"))
        .cloned();
    assert_eq!(
        row.as_ref().map(|r| r["state"].clone()),
        Some(json!("installed")),
        "the lanes pack passes its check: {packs}"
    );
    let board = json!({"format": 1, "profile": "board", "title": "Probe", "description": "A probe.", "size": [320, 200],
        "items": {"back": {"id": "back", "kind": "rect@1", "name": "Backdrop", "order": "a0",
                           "params": {"box": [0, 0, 320, 200], "paint": {"fill": {"role": "ground"}}}}}});
    for doc in DOCS {
        let (shown, took) = ask(json!({"call": {"call": "deep_show", "session": "sess-alpha", "doc": doc, "document": board, "include": ["issues"]}}));
        assert_eq!(shown["reply"]["outcome"], json!("presented"), "{shown}");
        assert!(
            took <= first / 5.0,
            "deep_show of {doc} took {took:.2} s, against {first:.2} s for the call that checked the pack: the pack's check ran again"
        );
    }
    drop(stdin);
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&evidence);
}
