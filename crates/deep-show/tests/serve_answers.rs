//! Issue #990: a program that asks its terminal more than its input holds, and never reads the
//! answers, stalls only those answers: `deep-show serve` still answers you about its terminal.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

#[test]
fn a_program_that_never_reads_its_answers_leaves_the_terminal_answering() {
    let mut serve = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("serve starts");
    let mut to_serve = serve.stdin.take().expect("stdin");
    let (lines, replies) = mpsc::channel();
    let out = serve.stdout.take().expect("stdout");
    thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let _ = lines.send(line);
        }
    });
    let mut call = |c: Value| -> Option<Value> {
        writeln!(to_serve, "{c}").expect("serve reads");
        let line = replies.recv_timeout(Duration::from_secs(20)).ok()?;
        serde_json::from_str(&line).ok()
    };
    call(json!({"panels": {"term": {"rect": [0, 0, 960, 576]}}})).expect("setup");
    call(
        json!({"call": "install", "manifest": {"panels": {"term": {"raw_input": true,
        "tree": [{"id": "s", "component": "cells", "terminal": "T1"}]}}}}),
    )
    .expect("install");
    // 30,000 device-attribute queries, 270 KB of answers: far more than a PTY's input holds.
    // Raw and without echo, as a busy full-screen program is: its input fills, nothing is dropped
    // or echoed.
    let asks = "stty raw -echo; printf '\\033[c%.0s' $(seq 30000); echo ASKED; sleep 120";
    let opened = call(
        json!({"call": "terminal_open", "terminal": "T1", "panel": "term",
        "cols": 80, "rows": 24, "program": {"argv": ["/bin/sh", "-c", asks]}}),
    )
    .expect("terminal_open");
    assert_eq!(opened["opened"], true, "{opened}");
    let mut outcome = "the screen never showed the program past its queries in 30 s";
    for _ in 0..60 {
        thread::sleep(Duration::from_millis(500));
        let Some(cells) = call(json!({"call": "cells", "terminal": "T1"})) else {
            outcome = "serve stopped answering about the terminal once its program's input filled with answers";
            break;
        };
        let rows = cells["text"].as_array().cloned().unwrap_or_default();
        if rows
            .iter()
            .filter_map(Value::as_str)
            .any(|r| r.contains("ASKED"))
        {
            outcome = "answered";
            break;
        }
    }
    let _ = serve.kill();
    let _ = serve.wait();
    assert_eq!(outcome, "answered");
}
