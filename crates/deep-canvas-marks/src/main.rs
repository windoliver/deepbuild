//! `deep-layout solve`: JSON lines in, one JSON line out per input line, in order, exit 0; a line
//! that can't be read or has no `doc` answers `{"ok":false,"code":"bad_input"}`. Each document is
//! laid out as given (`deep-canvas check` is its own gate): `{"ok":true,"boxes":{id:[x,y,w,h]}}`,
//! or a refusal naming its code and item. `readings` is accepted and never read: a text bound to
//! a reading is measured by its `widest`.

use std::io::{self, BufRead, Write};

use deep_canvas_marks::layout::solve;
use deep_text::Shaper;
use serde_json::{json, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn solve_line(shaper: &mut Shaper, line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    let Some(doc) = input.get("doc").filter(|d| d.is_object()) else {
        return bad_input();
    };
    match solve(doc, shaper) {
        Ok(boxes) => json!({"ok": true, "boxes": boxes}),
        Err(r) if r.code == "bad_input" => bad_input(),
        Err(r) => json!({"ok": false, "code": r.code, "item": r.item}),
    }
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if command != ["solve"] {
        eprintln!("deep-layout: usage: deep-layout solve");
        std::process::exit(2);
    }
    let mut shaper = Shaper::new();
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let answer = match std::str::from_utf8(&buf) {
            Ok(text) => solve_line(&mut shaper, text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input(),
        };
        if writeln!(out, "{answer}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
