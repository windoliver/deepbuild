//! Issue #402: the cell grid in the app (canvas primitives: Cell grid `cells@1`). A terminal's
//! screen, from the cells module's emulator, painted row by row through the canvas's one shaper
//! and its atlas (deep-text-gpui), never GPUI's text system: each row one mono label, its runs of
//! one foreground color in that color, each cell whose background isn't the grid's own a quad
//! behind it. What it drew is recorded as a canvas item, so a replica's snapshot lists the grid's
//! rows, and the grid holds no selection.
//!
//! Issue #990: [`terminal`] is the grid as the terminal tab: to the platform's accessibility a text
//! area whose lines are the screen's rows, its caret on the program's cursor even when the program
//! hides it, so VoiceOver reads its lines and the cursor's row; and your input method's composition
//! drawn over the cursor's cell, never into the grid or to the program.

use std::ops::Range;

use crate::chrome::sizes;
use deep_canvas_cells::emulator::{Cell, Terminal, G};
use deep_canvas_cells::palette::{resolve_in, ANSI};
use deep_text_gpui::{Label, Role};
use gpui_kit::*;
use serde_json::{json, Value};

use crate::canvas::record;

/// A cell's size at a 13 px mono face.
pub const CELL: [f32; 2] = [8., 16.];

/// `cols` by `rows` cells, in points.
fn grid(cols: f32, rows: f32) -> Size<Pixels> {
    size(px(CELL[0] * cols), px(CELL[1] * rows)) // size-literal-exception: a terminal cell, the mono face's advance and line at 13 pt (#1003); review 2027-04-30
}

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
    /// The grid's own foreground, which the composition is drawn in.
    pub fg: [u8; 3],
    /// The program's cursor cell, shown or not.
    pub cursor: (u16, u16),
    /// The cursor's place in its row's text, in characters: a cell can hold more than one.
    pub caret: usize,
}

impl Screen {
    /// The terminal's screen as it stands, colors resolved against `fg` and `bg`, and the 16 ANSI colors as `ansi`,
    /// the look's (#1003).
    pub fn of(
        term: &Terminal,
        revision: u64,
        fg: [u8; 3],
        bg: [u8; 3],
        ansi: &[[u8; 3]; 16],
    ) -> Screen {
        let rows = (0..term.rows())
            .map(|y| row(term.row(y), fg, bg, ansi))
            .collect();
        let (x, y) = term.cursor();
        let before = &term.row(y)[..usize::from(x).min(usize::from(term.cols()))];
        let caret = before
            .iter()
            .map(|c| match &c.g {
                G::Many(t) => t.chars().count(),
                _ => 1,
            })
            .sum();
        Screen {
            revision,
            cols: term.cols(),
            rows,
            bg,
            fg,
            cursor: (x, y),
            caret,
        }
    }

    /// Issue #1172: the screen the hub's canvas core holds, from its `cells` reply: each row's text and its runs of
    /// `[from, to, fg, bg]`, as `#rrggbb`. `None` for any other reply. Its caret is the cursor's column: only
    /// [`terminal`] reads a caret, and this screen is drawn by [`cells`].
    pub fn from_reply(reply: &Value) -> Option<Screen> {
        let bg = hex(reply["bg"].as_str()?)?;
        let cursor = (
            u16::try_from(reply["cursor"]["x"].as_u64()?).ok()?,
            u16::try_from(reply["cursor"]["y"].as_u64()?).ok()?,
        );
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
            fg: hex(reply["fg"].as_str()?)?,
            cursor,
            caret: usize::from(cursor.0),
        })
    }

    /// The screen `bytes` draw on a fresh `cols` × `rows` terminal: a host's screen, sent as the
    /// bytes that redraw it, in xterm's 16 colors (the replica's terminal tab, #990).
    pub fn drawn(cols: u16, rows: u16, bytes: &[u8], fg: [u8; 3], bg: [u8; 3]) -> Screen {
        let mut term = Terminal::new(cols, rows, 0);
        term.feed(bytes);
        Screen::of(&term, 1, fg, bg, &ANSI)
    }
}

/// `#rrggbb` as bytes.
fn hex(text: &str) -> Option<[u8; 3]> {
    let byte = |at: usize| u8::from_str_radix(text.get(at..at + 2)?, 16).ok();
    Some([byte(1)?, byte(3)?, byte(5)?])
}

fn row(cells: &[Cell], fg: [u8; 3], bg: [u8; 3], ansi: &[[u8; 3]; 16]) -> Row {
    let mut out = Row {
        text: Terminal::text_of(cells),
        runs: Vec::new(),
        fills: Vec::new(),
    };
    for (i, c) in cells.iter().enumerate() {
        let f = resolve_in(c.fg, fg, ansi);
        match out.runs.last_mut() {
            Some((span, color)) if *color == f && span.end == i => span.end = i + 1,
            _ => out.runs.push((i..i + 1, f)),
        }
        let b = resolve_in(c.bg, bg, ansi);
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
    let Size { width, height } = grid(f32::from(screen.cols), screen.rows.len() as f32);
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
                let top = bounds.origin.y + grid(0., y as f32).height;
                for (from, to, b) in &r.fills {
                    let at = point(bounds.origin.x + grid(*from as f32, 0.).width, top);
                    let size = grid((to - from) as f32, 1.);
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

/// The look's 16 terminal colors in light or dark, as a terminal draws them (#1003): one row each, its index and
/// name in that color on the terminal's background.
pub fn look_colors(dark: bool) -> Screen {
    const NAMES: [&str; 8] = [
        "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    ];
    let (ansi, bg, fg) = crate::chrome::terminal(dark);
    let mut term = Terminal::new(48, 16, 0);
    for i in 0..16 {
        let name = if i < 8 {
            NAMES[i].to_owned()
        } else {
            format!("bright {}", NAMES[i - 8])
        };
        let end = if i < 15 { "\r\n" } else { "" };
        term.feed(
            format!(
                "\x1b[38;5;{i}m\u{2588}\u{2588} {i:>2} {name:<15} The quick brown fox\x1b[0m{end}"
            )
            .as_bytes(),
        );
    }
    Screen::of(&term, 1, fg, bg, &ansi)
}

/// [`look_colors`] as a page: the grid on the terminal's background, which fills the page.
pub fn look_colors_page(dark: bool) -> Div {
    let screen = look_colors(dark);
    div()
        .size_full()
        .p(sizes().space(3))
        .bg(color(screen.bg))
        .child(cells("terminal-colors", screen))
}

/// The terminal tab's grid: `screen` with its lines and caret for accessibility, focusable by
/// `focus`, and `preedit`, the composition you are typing, drawn at the cursor's cell.
pub fn terminal(
    id: &str,
    screen: Screen,
    preedit: Option<String>,
    focus: &FocusHandle,
) -> Stateful<Div> {
    let lines: Vec<String> = screen.rows.iter().map(|r| r.text.clone()).collect();
    let (x, y) = screen.cursor;
    let caret = screen.caret;
    let (fg, bg) = (screen.fg, screen.bg);
    div()
        .id(SharedString::from(format!("{id}:text")))
        .key_context("Terminal")
        .track_focus(focus)
        .role(gpui_kit::Role::MultilineTextInput)
        .aria_label("Terminal")
        .a11y_synthetic_children(move |builder| lines_and_caret(builder, &lines, caret, y))
        .relative()
        // The whole tab in the grid's background, past the last column and row too.
        .size_full()
        .bg(color(bg))
        .child(cells(id, screen))
        .children(preedit.filter(|p| !p.is_empty()).map(|text| {
            // The composition inverted over the cells it covers, underlined as input methods mark
            // marked text.
            let cols = text.chars().map(width).sum::<usize>() as f32;
            div()
                .absolute()
                .left(grid(f32::from(x), 0.).width)
                .top(grid(0., f32::from(y)).height)
                .w(grid(cols, 0.).width)
                .h(grid(0., 1.).height)
                .bg(color(fg))
                .border_b(sizes().hairline)
                .border_color(color(bg))
                .child(
                    canvas(
                        {
                            let text = text.clone();
                            move |_, window, _| {
                                deep_text_gpui::prepare(&label(&text), window.scale_factor());
                            }
                        },
                        move |bounds, _, window, _| {
                            let runs = [(0..text.chars().count(), color(bg))];
                            deep_text_gpui::paint_runs(
                                bounds.origin,
                                &label(&text),
                                color(bg),
                                &runs,
                                window,
                            );
                        },
                    )
                    .size_full(),
                )
        }))
}

/// How many cells a character of a composition covers: two for the wide scripts.
fn width(c: char) -> usize {
    match u32::from(c) {
        0x1100..=0x115f
        | 0x2e80..=0xa4cf
        | 0xac00..=0xd7a3
        | 0xf900..=0xfaff
        | 0xfe30..=0xfe4f
        | 0xff00..=0xff60
        | 0xffe0..=0xffe6
        | 0x1f300..=0x1faff
        | 0x20000..=0x3fffd => 2,
        _ => 1,
    }
}

/// The text area's lines as text runs, one a row, each but the last ending in its line break, and
/// the caret `caret` characters into row `y`: on the row's line break when that is past its text.
fn lines_and_caret(builder: &mut A11ySubtreeBuilder, lines: &[String], caret: usize, y: u16) {
    use gpui_kit::accesskit::{Node, Role as A11y, TextPosition, TextSelection};
    let last = lines.len().saturating_sub(1);
    let mut at = None;
    for (i, line) in lines.iter().enumerate() {
        let id = builder.synthetic_node_id(i);
        let mut text = line.clone();
        if i < last {
            text.push('\n');
        }
        let lengths: Vec<u8> = text.chars().map(|c| c.len_utf8() as u8).collect();
        if i == usize::from(y) {
            let end = lengths.len() - usize::from(i < last);
            at = Some(TextPosition {
                node: id,
                character_index: caret.min(end),
            });
        }
        let mut node = Node::new(A11y::TextRun);
        node.set_value(text);
        node.set_character_lengths(lengths);
        builder.push_child(id, node);
    }
    if let Some(at) = at {
        builder.parent_node().set_text_selection(TextSelection {
            anchor: at,
            focus: at,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[::core::prelude::v1::test]
    fn a_screen_from_the_hubs_reply_keeps_each_rows_runs_and_its_fills_off_the_ground() {
        let reply = json!({"revision": 2, "cols": 4, "bg": "#101010", "fg": "#e8e8e8", "cursor": {"x": 2, "y": 0}, "text": ["ab"], // color-literal-exception: the program's own colors on the wire, which a terminal draws as they come; review 2027-05-05
            "runs": [[[0, 2, "#e8e8e8", "#101010"], [2, 3, "#e8e8e8", "#d81b9a"], [3, 4, "#e8e8e8", "#101010"]]]}); // color-literal-exception: the program's own colors on the wire, which a terminal draws as they come; review 2027-05-05
        let screen = Screen::from_reply(&reply).expect("a cells reply");
        assert_eq!((screen.revision, screen.cols), (2, 4));
        assert_eq!(screen.rows[0].text, "ab");
        assert_eq!(screen.rows[0].runs[0], (0..2, [0xe8; 3]));
        assert_eq!(screen.rows[0].fills, [(2, 3, [0xd8, 0x1b, 0x9a])]);
        assert_eq!((screen.fg, screen.cursor), ([0xe8; 3], (2, 0)));
        assert!(Screen::from_reply(&json!({"code": "page_closed"})).is_none());
    }

    #[::core::prelude::v1::test]
    fn a_row_keeps_its_text_its_color_runs_and_its_cells_off_the_grids_background() {
        let mut t = Terminal::new(10, 2, 0);
        t.feed(b"ab\x1b[31mcd\x1b[0m\x1b[44me\x1b[0m");
        let ansi: [[u8; 3]; 16] = std::array::from_fn(|i| [i as u8 * 10, 1, 2]);
        let s = Screen::of(&t, 1, [200; 3], [0; 3], &ansi);
        let r = &s.rows[0];
        assert_eq!(r.text, "abcde");
        assert_eq!(r.runs[0], (0..2, [200; 3]));
        // The 16 ANSI colors are the ones given, the look's.
        assert_eq!(r.runs[1], (2..4, ansi[1]));
        assert_eq!(r.fills, [(4, 5, ansi[4])]);
        assert_eq!(s.rows[1].text, "");
    }

    #[::core::prelude::v1::test]
    fn the_caret_counts_every_character_a_cell_before_the_cursor_holds() {
        // #990: "e" and a combining acute are one cell and two characters, so the cursor on "x",
        // its third cell, comes after three characters.
        let mut t = Terminal::new(10, 2, 0);
        t.feed("e\u{301} x\x1b[1;3H".as_bytes());
        let s = Screen::of(&t, 1, [200; 3], [0; 3], &ANSI);
        assert_eq!(s.cursor, (2, 0));
        assert_eq!(s.rows[0].text.chars().nth(s.caret), Some('x'));
    }
}
