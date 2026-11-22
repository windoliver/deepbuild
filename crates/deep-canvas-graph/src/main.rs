//! `deep-graph layout`: JSON lines in, one JSON line out per input line, in order, exit 0; a line
//! that can't be read or lacks a required field answers `{"ok":false,"code":"bad_input"}`. The
//! surface is the #394 acceptance README's, with #399's `replaced`, `ms` (on a line that lays new
//! nodes into the kept picture), the kept `memory` on a refusal and the planted `from_scratch`;
//! #1417's `timed: true` adds `ms` to a fresh layout's answer, the time its cost is fitted to.
//! #1826's suite adds `layout.algo` `tree`, `treemap` (with `layout.box` and the answer's `boxes`)
//! and `grid`, and the planted `rank_by_id` and `even_treemap`.

use std::io::{self, BufRead, Write};
use std::time::Instant;

use deep_canvas_graph::{lay, read_graph, read_layout, read_memory, write_memory, Algo, Refused};
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
    // The wrong programs, reachable only here. #399 AC1's `from_scratch`: a from-scratch layout
    // with the same seed, the memory ignored. #1826 AC1's `rank_by_id`: the layout's places handed
    // out in ID order, so a node's rank is its ID's, not its depth's. #1826 AC2's `even_treemap`:
    // every leaf's `size` read as 1, so the box splits evenly.
    let planted = match input.get("planted") {
        None => "",
        Some(Value::String(p))
            if ["from_scratch", "rank_by_id", "even_treemap"].contains(&p.as_str()) =>
        {
            p.as_str()
        }
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
    let elapsed_ms = || started.elapsed().as_secs_f64() * 1e3;
    let mut graph = read_graph(graph)?;
    let layout = read_layout(layout)?;
    if planted == "even_treemap" {
        for node in &mut graph.nodes {
            node.size = 1.0;
        }
    }
    let memory = match input.get("memory") {
        None | Some(Value::Null) => None,
        Some(_) if planted == "from_scratch" => None,
        Some(memory) => Some(read_memory(memory)?),
    };
    let mut laid = match lay(&graph, &layout, memory.as_ref())? {
        Ok(laid) => laid,
        Err(relayout) => {
            return Ok(json!({
                "ok": false,
                "code": "layout.relayout_needed",
                "memory": write_memory(&memory.unwrap_or_default()),
                "names": relayout.nodes,
                "relayout": write_memory(&relayout.offered),
            }))
        }
    };
    let ms = elapsed_ms();
    if planted == "rank_by_id" {
        let mut places: Vec<_> = laid.memory.values().copied().collect();
        places.sort_by_key(|p| (p.rank, p.order));
        laid.memory = laid.memory.into_keys().zip(places).collect();
    }
    // A layout afresh places every rank and carries its time when asked; a line that lays nodes
    // into the kept picture carries it always; one that changes nothing stays the same bytes in
    // every process (#394).
    let (replaced, with_ms) = match &memory {
        None => {
            let mut ranks: Vec<u32> = laid.memory.values().map(|p| p.rank).collect();
            ranks.sort_unstable();
            ranks.dedup();
            (ranks, timed)
        }
        Some(_) => {
            let with_ms = !laid.replaced.is_empty();
            (laid.replaced, with_ms)
        }
    };
    let mut answer =
        json!({"ok": true, "memory": write_memory(&laid.memory), "replaced": replaced});
    if with_ms {
        answer["ms"] = json!(ms);
    }
    if layout.algo == Algo::Treemap {
        answer["boxes"] = json!(laid.boxes);
    }
    Ok(answer)
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
