//! Issue #402: the panel host for a terminal (`deep-show host <cols> <rows> <history> [planted]`),
//! a process of its own, apart from the hub. It holds the terminal's emulator and cell grid and
//! takes the program's output through its stream, on stdin, framed: `D` and the bytes the
//! program wrote, `X` when the program's modes are reset (#990: it exited, or the shell took its
//! terminal back), or `Q` and a query (its grid, rows of it, its modes, or a resize), answered on
//! stdout as one JSON line, after every byte that came before it in the stream is applied. After
//! each `D` frame it writes `R <hex>`, the emulator's answers to the program's queries in their
//! order, for the hub to write to the program, `S <hex>` for each program-status report, and
//! `A <bytes applied>`.
//!
//! A clipboard read through the terminal's escape is counted and never answered. Only the planted
//! twins report each read (`C <terminator>`) for the hub to answer, or drop every answer.

use std::io::{BufWriter, Read, Write};

use deep_canvas_cells::emulator::Terminal;
use serde_json::{json, Value};

use crate::terminal::{cell_json, grid_json, Colors};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The host's main loop, until its stream closes.
pub fn run(args: &[String]) -> i32 {
    let n = |i: usize| args.get(i).and_then(|a| a.parse::<usize>().ok());
    let (Some(cols), Some(rows), Some(history)) = (n(1), n(2), n(3)) else {
        return 2;
    };
    let planted = args.get(4).map(String::as_str);
    let mut term = Terminal::new(cols as u16, rows as u16, history);
    // The look's terminal colors, as the hub draws them (#1003), and OSC 10 and 11 answer.
    let colors = Colors::of(&crate::hub::shipped_look());
    term.colors = colors.defaults();
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
                let replies = std::mem::take(&mut term.replies);
                if !replies.is_empty() && planted != Some("queries_dropped") {
                    let _ = writeln!(out, "R {}", hex(&replies));
                }
                for status in std::mem::take(&mut term.statuses) {
                    let _ = writeln!(out, "S {}", hex(status.as_bytes()));
                }
                if planted == Some("answers") {
                    for (_, end) in &term.queries[answered..] {
                        let _ = writeln!(out, "C {end}");
                    }
                    answered = term.queries.len();
                }
                let _ = writeln!(out, "A {applied}");
            }
            b'X' => term.reset_modes(),
            b'Q' => {
                let q: Value = serde_json::from_slice(&buf).unwrap_or(Value::Null);
                let reply = query(&mut term, &q, &colors);
                let _ = writeln!(out, "{reply}");
            }
            _ => return 2,
        }
        let _ = out.flush();
    }
}

fn query(term: &mut Terminal, q: &Value, colors: &Colors) -> Value {
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
            cell_json(&term.row(y as u16)[x as usize], colors, None)
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
        // #990: the screen as the bytes that redraw it, rows and cursor, for the app to draw.
        Some("screen") => {
            let mut bytes = String::from("\x1b[2J");
            for y in 0..term.rows() {
                let row = Terminal::text_of(term.row(y));
                bytes.push_str(&format!("\x1b[{};1H{row}", y + 1));
            }
            let (x, y) = term.cursor();
            bytes.push_str(&format!("\x1b[{};{}H", y + 1, x + 1));
            json!({"cols": term.cols(), "rows": term.rows(), "screen": hex(bytes.as_bytes())})
        }
        Some("modes") => json!({
            "bracketed_paste": term.modes.bracketed_paste,
            "app_cursor": term.modes.app_cursor,
            "focus_events": term.modes.focus_events,
            "mouse": term.modes.mouse_name(),
            "alt_screen": term.modes.alt_screen,
            "keyboard_flags": term.keyboard_flags(),
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
