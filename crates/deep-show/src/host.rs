//! Issue #402: the panel host for a terminal (`deep-show host <cols> <rows> <history> [planted]`),
//! a process of its own, apart from the hub. It holds the terminal's emulator and cell grid and
//! takes the program's output through its stream, on stdin, framed: `D` and the bytes the
//! program wrote, or `Q` and a query (its grid, rows of it, its modes, or a resize), answered on
//! stdout as one JSON line, after every byte that came before it in the stream is applied. After
//! each `D` frame it writes `A <bytes applied>`.
//!
//! It has no way to write to the program: a clipboard read through the terminal's escape is
//! counted and never answered. Only the planted twins report each read (`C <terminator>`) for the
//! hub to answer.

use std::io::{BufWriter, Read, Write};

use deep_canvas_cells::emulator::Terminal;
use serde_json::{json, Value};

use crate::terminal::{cell_json, grid_json};

/// The host's main loop, until its stream closes.
pub fn run(args: &[String]) -> i32 {
    let n = |i: usize| args.get(i).and_then(|a| a.parse::<usize>().ok());
    let (Some(cols), Some(rows), Some(history)) = (n(1), n(2), n(3)) else {
        return 2;
    };
    let planted = args.get(4).map(String::as_str);
    let mut term = Terminal::new(cols as u16, rows as u16, history);
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let mut applied: u64 = 0;
    let mut answered = 0usize;
    let mut head = [0u8; 5];
    let mut buf = Vec::new();
    loop {
        if input.read_exact(&mut head).is_err() {
            return 0;
        }
        let len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
        buf.resize(len, 0);
        if input.read_exact(&mut buf).is_err() {
            return 0;
        }
        match head[0] {
            b'D' => {
                term.feed(&buf);
                applied += len as u64;
                if planted.is_some() {
                    for (_, end) in &term.queries[answered..] {
                        let _ = writeln!(out, "C {end}");
                    }
                    answered = term.queries.len();
                }
                let _ = writeln!(out, "A {applied}");
            }
            b'Q' => {
                let q: Value = serde_json::from_slice(&buf).unwrap_or(Value::Null);
                let reply = query(&mut term, &q);
                let _ = writeln!(out, "{reply}");
            }
            _ => return 2,
        }
        let _ = out.flush();
    }
}

fn query(term: &mut Terminal, q: &Value) -> Value {
    let n = |k: &str| q.get(k).and_then(Value::as_u64);
    match q.get("q").and_then(Value::as_str) {
        Some("cells") => {
            let mut g = grid_json(term, 0);
            g["vsync"] = Value::Null;
            g
        }
        Some("cell") => {
            let (Some(x), Some(y)) = (n("x"), n("y")) else {
                return json!({"code": "bad_input"});
            };
            if x >= u64::from(term.cols()) || y >= u64::from(term.rows()) {
                return json!({"code": "out_of_range"});
            }
            cell_json(&term.row(y as u16)[x as usize], None)
        }
        Some("rows") => {
            let (from, count) = (
                n("from").unwrap_or(0) as usize,
                n("count").unwrap_or(0) as usize,
            );
            let history = term.history_len();
            let total = history + usize::from(term.rows());
            let rows: Vec<String> = (from..(from + count).min(total))
                .map(|i| match i < history {
                    true => term.history_text(i),
                    false => Terminal::text_of(term.row((i - history) as u16)),
                })
                .collect();
            json!({"rows": rows})
        }
        Some("modes") => json!({
            "bracketed_paste": term.modes.bracketed_paste,
            "app_cursor": term.modes.app_cursor,
            "focus_events": term.modes.focus_events,
            "mouse": term.modes.mouse_name(),
        }),
        Some("resize") => {
            let (Some(cols), Some(rows)) = (n("cols"), n("rows")) else {
                return json!({"code": "bad_input"});
            };
            term.resize(cols as u16, rows as u16);
            json!({"resized": true})
        }
        _ => json!({"code": "bad_input"}),
    }
}
