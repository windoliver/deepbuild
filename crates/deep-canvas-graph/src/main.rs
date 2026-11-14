//! `deep-graph layout`: JSON lines in, one JSON line out per input line, in order, exit 0; a line
//! that can't be read or lacks a required field answers `{"ok":false,"code":"bad_input"}`. The
//! surface is the #394 acceptance README's, with #399's `replaced`, `ms` (on a line that lays new
//! nodes into the kept picture), the kept `memory` on a refusal and the planted `from_scratch`;
//! #1417's `timed: true` adds `ms` to a fresh layout's answer, the time its cost is fitted to.

use std::io::{self, BufRead, Write};
use std::time::Instant;

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
    // #399 AC1's wrong program: a from-scratch layout with the same seed, the memory ignored.
    let from_scratch = match input.get("planted") {
        None => false,
        Some(v) if v == "from_scratch" => true,
        Some(_) => {
            return Err(Refused {
                code: "bad_input",
                names: String::new(),
            })
        }
    };
    let timed = match input.get("timed") {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            return Err(Refused {
                code: "bad_input",
                names: String::new(),
            })
        }
    };
    let started = Instant::now();
    let graph = read_graph(graph)?;
    let layout = read_layout(layout)?;
    let fresh = |graph, layout| -> Result<Value, Refused> {
        let memory = layered(graph, layout)?;
        let ms = started.elapsed().as_secs_f64() * 1e3;
        let mut ranks: Vec<u32> = memory.values().map(|p| p.rank).collect();
        ranks.sort_unstable();
        ranks.dedup();
        let mut answer = json!({"ok": true, "memory": write_memory(&memory), "replaced": ranks});
        if timed {
            answer["ms"] = json!(ms);
        }
        Ok(answer)
    };
    let memory = match input.get("memory") {
        None | Some(Value::Null) => return fresh(&graph, &layout),
        Some(_) if from_scratch => return fresh(&graph, &layout),
        Some(memory) => read_memory(memory)?,
    };
    Ok(match keep(&graph, &layout, &memory)? {
        // A line that lays nodes into the kept picture carries its layout's time; one that
        // changes nothing stays the same bytes in every process (#394).
        Ok((kept, replaced)) if replaced.is_empty() => {
            json!({"ok": true, "memory": write_memory(&kept), "replaced": replaced})
        }
        Ok((kept, replaced)) => json!({"ok": true, "memory": write_memory(&kept),
                                       "replaced": replaced,
                                       "ms": started.elapsed().as_secs_f64() * 1e3}),
        Err(relayout) => json!({
            "ok": false,
            "code": "layout.relayout_needed",
            "memory": write_memory(&memory),
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
    let mut out = io::stdout().lock();
    for buf in io::stdin().lock().split(b'\n') {
        let Ok(buf) = buf else { break };
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
