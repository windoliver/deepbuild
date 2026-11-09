//! Issue #1550's redraft probe (REDRAFT.md), written blind beside the original `../probe.rs`, which stays as it is. It
//! answers the one thing the original doesn't: each row of a `shape_text` wrap as the glyphs it draws, so the tests can
//! read a row's text as the dispute asks (DISPUTE.md: "The reading asked for"). It runs chrome's own text system and
//! nothing else, at the font the question card draws its rows in (`.SystemUIFont` at `text_xs`, 12 px), and judges
//! nothing.
//!
//! JSON lines in, one JSON line out per line in:
//!
//! - `{"call":"rows","text":s,"widths":[px...]}` -> `{"ok":true,"rows":[[[k...]...]...]}`: for each width,
//!   `WindowTextSystem::shape_text(text, size, runs, Some(width), None)`'s rows in the order `paint_line` draws them
//!   (the glyphs before the first wrap boundary, then from each boundary's glyph up to the next one's), each row the
//!   code point offset of each of its glyphs (`ShapedGlyph::index`) in glyph order. A byte inside a code point reads -1.
//!   A text holds no newline, so it shapes to one line; anything else is refused.

use std::io::{BufRead, Write};
use std::sync::Arc;

use gpui_kit::{font, px, SharedString, TextRun, TextSystem, WindowTextSystem};
use serde_json::{json, Value};

const FAMILY: &str = ".SystemUIFont";
const SIZE: f32 = 12.;

fn main() {
    let text_system = Arc::new(TextSystem::new(
        gpui_kit::platform::current_platform(true).text_system(),
    ));
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(call) => {
                answer(&text_system, &call).unwrap_or_else(|e| json!({"ok": false, "error": e}))
            }
            Err(e) => json!({"ok": false, "error": format!("not JSON: {e}")}),
        };
        writeln!(out, "{reply}").expect("stdout");
        out.flush().expect("stdout");
    }
}

fn answer(text_system: &Arc<TextSystem>, call: &Value) -> Result<Value, String> {
    if call["call"].as_str() != Some("rows") {
        return Err(format!("call is rows, not {:?}", call["call"]));
    }
    let text = call["text"].as_str().ok_or("text is a string")?.to_owned();
    let widths: Vec<f32> = call["widths"]
        .as_array()
        .ok_or("widths is an array")?
        .iter()
        .map(|w| w.as_f64().map(|w| w as f32).ok_or("a width is a number"))
        .collect::<Result<_, _>>()?;
    // A fresh window text system per text, so its layout cache holds this text's layouts alone.
    let window = WindowTextSystem::new(text_system.clone());
    let runs = vec![TextRun {
        len: text.len(),
        font: font(FAMILY),
        ..Default::default()
    }];
    let rows = widths
        .iter()
        .map(|&w| {
            let lines = window
                .shape_text(
                    SharedString::from(text.clone()),
                    px(SIZE),
                    &runs,
                    Some(px(w)),
                    None,
                )
                .map_err(|e| e.to_string())?;
            let [line] = lines.as_slice() else {
                return Err(format!("shape_text gave {} lines for a text with no newline", lines.len()));
            };
            let mut wraps = line.wrap_boundaries().iter().peekable();
            let mut rows: Vec<Vec<i64>> = vec![Vec::new()];
            for (run_ix, run) in line.runs().iter().enumerate() {
                for (glyph_ix, glyph) in run.glyphs.iter().enumerate() {
                    // As paint_line: a boundary's glyph is the first one drawn on a new row.
                    if wraps.peek().is_some_and(|b| b.run_ix == run_ix && b.glyph_ix == glyph_ix) {
                        wraps.next();
                        rows.push(Vec::new());
                    }
                    rows.last_mut().expect("a row").push(code_point(&text, glyph.index));
                }
            }
            if wraps.next().is_some() {
                return Err("a wrap boundary names no glyph of the line, in order".to_owned());
            }
            Ok(rows)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({"ok": true, "rows": rows}))
}

/// A byte offset as a code point offset; a byte inside a code point is answered as -1, so a test sees it.
fn code_point(text: &str, byte: usize) -> i64 {
    if byte > text.len() || !text.is_char_boundary(byte) {
        return -1;
    }
    text[..byte].chars().count() as i64
}
