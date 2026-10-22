//! `deep-graph layout`: JSON lines in, one JSON line out per input line, in order, exit 0; a line
//! that can't be read or lacks a required field answers `{"ok":false,"code":"bad_input"}`. The
//! surface is the #394 acceptance README's.

use std::io::{self, BufRead, Write};

use deep_canvas_graph::{
    keep, layered, read_graph, read_layout, read_memory, write_memory, Refused,
};
use serde_json::{json, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refusal(r: Refused) -> Value {
    if r.code == "bad_input" {
        return bad_input();
    }
    json!({"ok": false, "code": r.code, "names": r.names})
}

fn layout_line(input: &Value) -> Result<Value, Refused> {
    let (Some(graph), Some(layout)) = (input.get("graph"), input.get("layout")) else {
        return Err(Refused {
            code: "bad_input",
            names: String::new(),
        });
    };
    let graph = read_graph(graph)?;
    let layout = read_layout(layout)?;
    let memory = match input.get("memory") {
        None | Some(Value::Null) => {
            return Ok(json!({"ok": true, "memory": write_memory(&layered(&graph, &layout)?)}))
        }
        Some(memory) => read_memory(memory)?,
    };
    Ok(match keep(&graph, &layout, &memory)? {
        Ok(kept) => json!({"ok": true, "memory": write_memory(&kept)}),
        Err(relayout) => json!({
            "ok": false,
            "code": "layout.relayout_needed",
            "names": relayout.nodes,
            "relayout": write_memory(&relayout.offered),
        }),
    })
}

fn answer(line: &str) -> Value {
    let Ok(input @ Value::Object(_)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    layout_line(&input).unwrap_or_else(refusal)
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if command.as_slice() != ["layout"] {
        eprintln!("deep-graph: usage: deep-graph layout");
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
