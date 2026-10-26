//! `deep-salience level`: JSON lines in, one JSON line out per input line, in order, exit 0; a
//! line that can't be read or lacks a required field answers `{"ok":false,"code":"bad_input"}`.
//! The surface is the #394 acceptance README's.

use std::io::{self, BufRead, Write};

use deep_canvas_record::{item, level, Hold, Options};
use serde_json::{json, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn level_line(input: &Value) -> Option<Value> {
    input.get("level")?.as_str()?;
    let show = match input.get("show") {
        None => 9,
        Some(s) => u8::try_from(s.as_u64()?).ok()?,
    };
    let fits = usize::try_from(input.get("fits")?.as_u64()?).ok()?;
    let items = input
        .get("items")?
        .as_array()?
        .iter()
        .map(item)
        .collect::<Option<Vec<_>>>()?;
    let evidence = match input.get("evidence") {
        None => false,
        Some(e) => e.as_bool()?,
    };
    // The level as it was last held, while it stays open; absent when it opens.
    let hold = match input.get("held") {
        None => None,
        Some(h) => Some(Hold {
            shown: h
                .get("shown")?
                .as_array()?
                .iter()
                .map(|id| id.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()?,
            items: h
                .get("items")?
                .as_array()?
                .iter()
                .map(item)
                .collect::<Option<Vec<_>>>()?,
        }),
    };
    let mut ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        return Some(json!({"ok": false, "code": "salience.duplicate_id"}));
    }
    let out = level(
        &items,
        &Options {
            show,
            fits,
            evidence,
        },
        hold.as_ref(),
    );
    let shown: Vec<Value> = out
        .shown
        .iter()
        .map(|s| json!({"id": s.id, "rank": s.rank, "reasons": s.reasons}))
        .collect();
    let fold = out.fold.map_or(
        Value::Null,
        |f| json!({"count": f.items.len(), "items": f.items, "line": f.line}),
    );
    Some(json!({"ok": true, "shown": shown, "fold": fold, "new": out.new}))
}

fn answer(line: &str) -> Value {
    let Ok(input @ Value::Object(_)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    level_line(&input).unwrap_or_else(bad_input)
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if command.as_slice() != ["level"] {
        eprintln!("deep-salience: usage: deep-salience level");
        std::process::exit(2);
    }
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
            Ok(text) => answer(text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input(),
        };
        let text = serde_json::to_string(&answer).unwrap_or_else(|_| bad_input().to_string());
        if writeln!(out, "{text}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
