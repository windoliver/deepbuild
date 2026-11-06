//! Issue #402: the cell grid in the app (canvas primitives: Cell grid `cells@1`). A terminal's
//! screen, from the cells module's emulator, painted row by row through the canvas's one shaper
//! and its atlas (deep-text-gpui), never GPUI's text system: each row one mono label, its runs of
//! one foreground color in that color, each cell whose background isn't the grid's own a quad
//! behind it. What it drew is recorded as a canvas item, so a replica's snapshot lists the grid's
//! rows, and the grid holds no selection.

use std::ops::Range;

use deep_canvas_cells::emulator::{Cell, Terminal};
use deep_canvas_cells::palette::resolve;
use deep_text_gpui::{Label, Role};
use gpui_kit::*;
use serde_json::{json, Value};

use crate::canvas::record;

/// A cell's size at a 13 px mono face.
pub const CELL: [f32; 2] = [8., 16.];

/// One row of the screen: its text, and its runs of one foreground color by grapheme.
#[derive(Clone)]
pub struct Row {
    pub text: String,
    pub runs: Vec<(Range<usize>, [u8; 3])>,
    pub fills: Vec<(usize, usize, [u8; 3])>,
}

/// What the grid draws this frame: the terminal's screen as rows, at a revision.
#[derive(Clone)]
pub struct Screen {
    pub revision: u64,
    pub cols: u16,
    pub rows: Vec<Row>,
    pub bg: [u8; 3],
}

impl Screen {
    /// The terminal's screen as it stands, colors resolved against `fg` and `bg`.
    pub fn of(term: &Terminal, revision: u64, fg: [u8; 3], bg: [u8; 3]) -> Screen {
        let rows = (0..term.rows()).map(|y| row(term.row(y), fg, bg)).collect();
        Screen {
            revision,
            cols: term.cols(),
            rows,
            bg,
        }
    }

    /// Issue #1172: the screen the hub's canvas core holds, from its `cells` reply: each row's text and its runs of
    /// `[from, to, fg, bg]`, as `#rrggbb`. `None` for any other reply.
    pub fn from_reply(reply: &Value) -> Option<Screen> {
        let bg = hex(reply["bg"].as_str()?)?;
        let rows = reply["text"]
            .as_array()?
            .iter()
            .zip(reply["runs"].as_array()?)
            .map(|(text, runs)| {
                let mut row = Row {
                    text: text.as_str()?.to_owned(),
                    runs: Vec::new(),
                    fills: Vec::new(),
                };
                for run in runs.as_array()? {
                    let (from, to) = (run[0].as_u64()? as usize, run[1].as_u64()? as usize);
                    row.runs.push((from..to, hex(run[2].as_str()?)?));
                    let fill = hex(run[3].as_str()?)?;
                    if fill != bg {
                        row.fills.push((from, to, fill));
                    }
                }
                Some(row)
            })
            .collect::<Option<_>>()?;
        Some(Screen {
            revision: reply["revision"].as_u64()?,
            cols: u16::try_from(reply["cols"].as_u64()?).ok()?,
            rows,
            bg,
        })
    }
}

/// `#rrggbb` as bytes.
fn hex(text: &str) -> Option<[u8; 3]> {
    let byte = |at: usize| u8::from_str_radix(text.get(at..at + 2)?, 16).ok();
    Some([byte(1)?, byte(3)?, byte(5)?])
}

fn row(cells: &[Cell], fg: [u8; 3], bg: [u8; 3]) -> Row {
    let mut out = Row {
        text: Terminal::text_of(cells),
        runs: Vec::new(),
        fills: Vec::new(),
    };
    for (i, c) in cells.iter().enumerate() {
        let f = resolve(c.fg, fg);
        match out.runs.last_mut() {
            Some((span, color)) if *color == f && span.end == i => span.end = i + 1,
            _ => out.runs.push((i..i + 1, f)),
        }
        let b = resolve(c.bg, bg);
        if b != bg {
            out.fills.push((i, i + 1, b));
        }
    }
    out
}

fn color(c: [u8; 3]) -> Hsla {
    Rgba {
        r: f32::from(c[0]) / 255.,
        g: f32::from(c[1]) / 255.,
        b: f32::from(c[2]) / 255.,
        a: 1.,
    }
    .into()
}

fn label(text: &str) -> Label {
    Label {
        family: Role::Mono.family(),
        ..Label::new(text)
    }
}

/// The grid as a canvas element: `screen` painted in its bounds from the top left.
pub fn cells(id: &str, screen: Screen) -> Canvas<()> {
    let id = id.to_owned();
    let width = px(CELL[0] * f32::from(screen.cols));
    let height = px(CELL[1] * screen.rows.len() as f32);
    canvas(
        // Every row's glyphs placed before any is painted, so a page goes up once a frame.
        {
            let texts: Vec<String> = screen.rows.iter().map(|r| r.text.clone()).collect();
            move |_, window, _| {
                for t in texts.iter().filter(|t| !t.is_empty()) {
                    deep_text_gpui::prepare(&label(t), window.scale_factor());
                }
            }
        },
        move |bounds, _, window, _| {
            window.paint_quad(fill(bounds, color(screen.bg)));
            let mut sprites = 0;
            for (y, r) in screen.rows.iter().enumerate() {
                let top = bounds.origin.y + px(CELL[1] * y as f32);
                for (from, to, b) in &r.fills {
                    let at = point(bounds.origin.x + px(CELL[0] * *from as f32), top);
                    let size = size(px(CELL[0] * (to - from) as f32), px(CELL[1]));
                    window.paint_quad(fill(Bounds { origin: at, size }, color(*b)));
                }
                if r.text.is_empty() {
                    continue;
                }
                let runs: Vec<(Range<usize>, Hsla)> =
                    r.runs.iter().map(|(s, c)| (s.clone(), color(*c))).collect();
                let base = r.runs.first().map_or(Hsla::default(), |(_, c)| color(*c));
                let painted = deep_text_gpui::paint_runs(
                    point(bounds.origin.x, top),
                    &label(&r.text),
                    base,
                    &runs,
                    window,
                );
                sprites += painted.sprites;
            }
            record(
                &id,
                json!({
                    "kind": "cells@1",
                    "revision": screen.revision,
                    "text": screen.rows.iter().map(|r| r.text.clone()).collect::<Vec<_>>(),
                    "sprites": sprites,
                }),
                bounds,
            );
        },
    )
    .w(width)
    .h(height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[::core::prelude::v1::test]
    fn a_screen_from_the_hubs_reply_keeps_each_rows_runs_and_its_fills_off_the_ground() {
        let reply = json!({"revision": 2, "cols": 4, "bg": "#101010", "text": ["ab"], // color-literal-exception: the program's own colors on the wire, which a terminal draws as they come; review 2027-05-05
            "runs": [[[0, 2, "#e8e8e8", "#101010"], [2, 3, "#e8e8e8", "#d81b9a"], [3, 4, "#e8e8e8", "#101010"]]]}); // color-literal-exception: the program's own colors on the wire, which a terminal draws as they come; review 2027-05-05
        let screen = Screen::from_reply(&reply).expect("a cells reply");
        assert_eq!((screen.revision, screen.cols), (2, 4));
        assert_eq!(screen.rows[0].text, "ab");
        assert_eq!(screen.rows[0].runs[0], (0..2, [0xe8; 3]));
        assert_eq!(screen.rows[0].fills, [(2, 3, [0xd8, 0x1b, 0x9a])]);
        assert!(Screen::from_reply(&json!({"code": "page_closed"})).is_none());
    }

    #[::core::prelude::v1::test]
    fn a_row_keeps_its_text_its_color_runs_and_its_cells_off_the_grids_background() {
        let mut t = Terminal::new(10, 2, 0);
        t.feed(b"ab\x1b[31mcd\x1b[0m\x1b[44me\x1b[0m");
        let s = Screen::of(&t, 1, [200; 3], [0; 3]);
        let r = &s.rows[0];
        assert_eq!(r.text, "abcde");
        assert_eq!(r.runs[0], (0..2, [200; 3]));
        assert_eq!(
            r.runs[1],
            (
                2..4,
                resolve(deep_canvas_cells::emulator::Color::Indexed(1), [0; 3])
            )
        );
        assert_eq!(
            r.fills,
            [(
                4,
                5,
                resolve(deep_canvas_cells::emulator::Color::Indexed(4), [0; 3])
            )]
        );
        assert_eq!(s.rows[1].text, "");
    }
}
