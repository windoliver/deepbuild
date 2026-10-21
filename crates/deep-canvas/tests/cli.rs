//! The CLI answers one JSON line per input line, in order: a line that can't be read, an empty
//! one or one that isn't UTF-8 included, answers `bad_input` rather than nothing.
use std::io::Write;
use std::process::{Command, Stdio};

fn answers(input: &[u8]) -> Vec<String> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-canvas"))
        .args(["parse", "id"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-canvas starts");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(input)
        .expect("stdin written");
    let out = child.wait_with_output().expect("deep-canvas exits");
    assert!(out.status.success());
    String::from_utf8(out.stdout)
        .expect("utf-8 out")
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn an_empty_line_gets_a_bad_input_answer_so_answers_stay_in_step_with_lines() {
    let out = answers(b"{\"text\":\"a\"}\n\n{\"text\":\"b\"}\n");
    assert_eq!(out.len(), 3, "{out:?}");
    assert_eq!(out[1], r#"{"ok":false,"code":"bad_input"}"#);
    assert!(out[0].contains(r#""printed":"a""#));
    assert!(out[2].contains(r#""printed":"b""#));
}

#[test]
fn a_line_that_is_not_utf8_is_bad_input_not_a_lossy_reading() {
    // `{"text":"<0xFF>"}`: lossy decoding would read it as U+FFFD and refuse with bad_id.
    let out = answers(b"{\"text\":\"\xff\"}\n");
    assert_eq!(out, [r#"{"ok":false,"code":"bad_input"}"#]);
}
