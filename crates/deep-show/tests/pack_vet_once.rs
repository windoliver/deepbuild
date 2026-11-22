//! Issue #1172: the canvas side builds its store afresh for every call, and a pack version this
//! process already checked is not checked again, so the hub's later calls don't pay for it.
//!
//! The check of a pack's libraries counts in none of the sandbox's counters, so this reads its
//! cost: lanes' check (its libraries compiled and their fixtures run) is most of a first call,
//! and a later call that checks it again takes about half of one. The bound is a ratio, not a
//! time, so a loaded machine slows both sides alike.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Instant;

use serde_json::{json, Value};

#[test]
fn a_checked_pack_version_is_not_checked_again_on_a_later_call() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let evidence = std::env::temp_dir().join(format!("deep-1172-vet-{}", std::process::id()));
    std::fs::create_dir_all(&evidence).expect("evidence folder");
    let mut core = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("canvas")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the canvas core starts");
    let mut input = core.stdin.take().expect("stdin");
    let mut output = BufReader::new(core.stdout.take().expect("stdout")).lines();
    let mut send = |line: Value| -> (Value, f64) {
        let start = Instant::now();
        writeln!(input, "{line}").expect("the core reads");
        let reply = output.next().expect("a reply").expect("a line");
        (serde_json::from_str(&reply).expect("JSON"), start.elapsed().as_secs_f64())
    };
    let packs = json!([{"id": "deepbuild/lanes", "dir": repo.join("packs/lanes-1.0.0")}]);
    let world = json!({"evidence": evidence, "sessions": {}, "record": {}, "docs": {}, "packs": packs});
    assert_eq!(send(json!({"world": world})).0["ok"], true, "the core takes the world");
    let call = json!({"call": {"call": "packs"}});

    // A row's `checks` counts this call's store's runs, so only the rest is compared.
    let held = |reply: &Value| {
        let r = &reply["reply"]["packs"][0];
        json!([r["state"], r["version"], r["issues"], r["layouts"]])
    };
    let (first, first_s) = send(call.clone());
    let row = held(&first);
    assert_eq!(row[0], "installed", "the first call checks and installs lanes: {first}");
    let mut later = Vec::new();
    for _ in 0..3 {
        let (again, s) = send(call.clone());
        assert_eq!(held(&again), row, "a later call changed lanes' row: {again}");
        later.push(s);
    }
    let fastest = later.iter().cloned().fold(f64::INFINITY, f64::min);
    assert!(
        fastest < first_s / 4.0,
        "a later call took {fastest:.3} s against the first's {first_s:.3} s: it checked lanes again"
    );
    drop(input);
    let _ = core.wait();
    let _ = std::fs::remove_dir_all(&evidence);
}
