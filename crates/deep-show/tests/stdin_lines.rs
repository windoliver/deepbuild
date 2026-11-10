//! A line of stdin that is not UTF-8 is a line that can't be read (the #393 acceptance README:
//! one JSON object per input line): `run` and `serve` answer it `bad_input` and go on to the
//! next line. Each drives the binary as the acceptance tests do.
use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

/// What `deep-show <command>` writes for `input`, line by line.
fn lines(command: &str, input: &[u8]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    let mut stdin = child.stdin.take().expect("stdin");
    stdin.write_all(input).expect("written");
    drop(stdin);
    let out = child.wait_with_output().expect("deep-show exits");
    assert!(out.status.success(), "deep-show {command} exits 0");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| serde_json::from_str(l).expect("a JSON line"))
        .collect()
}

fn bad() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

#[test]
fn run_answers_a_line_that_is_not_utf8_and_the_line_after_it() {
    let evidence = std::env::temp_dir().join(format!("deep-393-lines-{}", std::process::id()));
    let scenario = json!({"evidence": evidence, "calls": []});
    let mut input = b"\xff\n".to_vec();
    input.extend_from_slice(format!("{scenario}\n").as_bytes());
    let got = lines("run", &input);
    let _ = std::fs::remove_dir_all(&evidence);
    assert_eq!(got, [bad(), json!({"ok": true, "replies": []})]);
}

#[test]
fn serve_answers_a_line_that_is_not_utf8_and_the_line_after_it() {
    let ok = json!({"ok": true});
    assert_eq!(lines("serve", b"{}\n\xff\n[]\n"), [ok, bad(), bad()]);
}

#[test]
fn serve_answers_a_setup_line_that_is_not_utf8() {
    assert_eq!(lines("serve", b"\xff\n"), [bad()]);
}
