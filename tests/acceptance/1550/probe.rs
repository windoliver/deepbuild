//! Issue #1550's probe, written blind with its acceptance tests (README.md). It runs chrome's own wrapper and
//! nothing else: GPUI's text system on this platform, the font the question card draws its rows in (`.SystemUIFont`
//! at `text_xs`, 12 px), and the two public routes chrome text wraps by:
//!
//! - `wrap_line`: `TextSystem::line_wrapper(font, size).wrap_line(&[LineFragment::text(text)], width, NoIndent)`,
//!   the wrapper itself (gpui-kit's editor and inline flow);
//! - `shape_text`: `WindowTextSystem::shape_text(text, size, runs, Some(width), None)`, the call a text element
//!   (a card's line) makes, its wrap boundaries read back as the byte index of the glyph each line starts at.
//!
//! JSON lines in, one JSON line out per line in. Offsets are code point offsets into the text, as
//! `LineBreakTest.txt` counts. No judgment is made here: the tests judge what this answers.
//!
//! - `{"call":"wrap","route":"wrap_line"|"shape_text","text":s,"widths":[px...]}` ->
//!   `{"ok":true,"starts":[[k...]...]}`, for each width the code point offsets where a line after the first starts.
//! - `{"call":"measure","texts":[s...]}` -> `{"ok":true,"measures":[{"advances":[px...],"shaped":px}...]}`: each
//!   code point's advance as the wrapper reads it (`TextSystem::layout_width`), and the text shaped as one line
//!   (`WindowTextSystem::layout_line`).

use std::io::{BufRead, Write};
use std::sync::Arc;

use gpui_kit::{
    font, px, IndentAdjustment, LineFragment, SharedString, TextRun, TextSystem, WindowTextSystem,
};
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
    let text = |v: &Value| v.as_str().map(str::to_owned).ok_or("a text is a string");
    match call["call"].as_str() {
        Some("wrap") => {
            let text = text(&call["text"])?;
            let widths: Vec<f32> = call["widths"]
                .as_array()
                .ok_or("widths is an array")?
                .iter()
                .map(|w| w.as_f64().map(|w| w as f32).ok_or("a width is a number"))
                .collect::<Result<_, _>>()?;
            let starts = match call["route"].as_str() {
                Some("wrap_line") => wrap_line(text_system, &text, &widths),
                Some("shape_text") => shape_text(text_system, &text, &widths)?,
                other => return Err(format!("route is wrap_line or shape_text, not {other:?}")),
            };
            Ok(json!({"ok": true, "starts": starts}))
        }
        Some("measure") => {
            let font_id = text_system.resolve_font(&font(FAMILY));
            let window = WindowTextSystem::new(text_system.clone());
            let measures = call["texts"]
                .as_array()
                .ok_or("texts is an array")?
                .iter()
                .map(|t| {
                    let t = text(t)?;
                    let advances: Vec<f32> = t
                        .chars()
                        .map(|c| f32::from(text_system.layout_width(font_id, px(SIZE), c)))
                        .collect();
                    let shaped = f32::from(window.layout_line(&t, px(SIZE), &runs(&t), None).width);
                    Ok(json!({"advances": advances, "shaped": shaped}))
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(json!({"ok": true, "measures": measures}))
        }
        other => Err(format!("call is wrap or measure, not {other:?}")),
    }
}

fn runs(text: &str) -> Vec<TextRun> {
    vec![TextRun {
        len: text.len(),
        font: font(FAMILY),
        ..Default::default()
    }]
}

/// A byte offset as a code point offset; a byte inside a code point is answered as -1, so a test sees it.
fn code_point(text: &str, byte: usize) -> i64 {
    if !text.is_char_boundary(byte) {
        return -1;
    }
    text[..byte.min(text.len())].chars().count() as i64
}

fn wrap_line(text_system: &Arc<TextSystem>, text: &str, widths: &[f32]) -> Vec<Vec<i64>> {
    let mut wrapper = text_system.line_wrapper(font(FAMILY), px(SIZE));
    let fragments = [LineFragment::text(text)];
    widths
        .iter()
        .map(|&w| {
            wrapper
                .wrap_line(&fragments, px(w), IndentAdjustment::NoIndent)
                .map(|b| code_point(text, b.ix))
                .collect()
        })
        .collect()
}

fn shape_text(
    text_system: &Arc<TextSystem>,
    text: &str,
    widths: &[f32],
) -> Result<Vec<Vec<i64>>, String> {
    // A fresh window text system per text, so its layout cache holds this text's layouts alone.
    let window = WindowTextSystem::new(text_system.clone());
    widths
        .iter()
        .map(|&w| {
            let lines = window
                .shape_text(
                    SharedString::from(text.to_owned()),
                    px(SIZE),
                    &runs(text),
                    Some(px(w)),
                    None,
                )
                .map_err(|e| e.to_string())?;
            Ok(lines
                .iter()
                .flat_map(|line| {
                    line.wrap_boundaries()
                        .iter()
                        .map(|b| code_point(text, line.runs()[b.run_ix].glyphs[b.glyph_ix].index))
                        .collect::<Vec<_>>()
                })
                .collect())
        })
        .collect()
}
