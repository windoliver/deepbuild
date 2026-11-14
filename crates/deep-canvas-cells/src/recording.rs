//! Issue #1967: terminal recordings (canvas primitives: Asset: terminal recordings; Cell grid
//! `cells@1`: `play`). A recording is a size, then output bytes with their times. It is converted
//! once, at import in the decode worker, by this crate's emulator (the pinned terminal emulator)
//! into a keyframe of the whole grid every second and row patches stamped in flicks. A grid that
//! plays it shows, at a source time, the keyframe at or before that time plus the patches up to
//! it, so seeking equals playing and nothing parses escapes per frame.
//!
//! Pure and deterministic: no I/O, no clock.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use crate::emulator::{Cell, Color, Terminal, G};

/// A keyframe of the whole grid every second of the recording.
pub const KEYFRAME_EVERY: i64 = FLICKS_PER_SECOND;
/// The history a recording's emulator keeps, in rows, as a live terminal's does.
const HISTORY: usize = 10_000;
/// The emulator that converts a recording, as the asset's `decoder` names it.
pub const DECODER: (&str, &str) = ("deep-canvas-cells", "1.0.0");

/// The wrong programs this module plants, each reachable only through a proof surface: a grid
/// that shows a recording's every patch whatever t; a seek (a session's first frame, or a frame
/// earlier than the one before) that shows the keyframe and none of the patches after it; and an
/// import that stamps each patch at its time rounded to the nearest whole second, halves up.
pub const PLANTED: [&str; 3] = [
    "cells_play_every_patch",
    "cells_seek_skips_patches",
    "cells_patch_times_whole_seconds",
];

/// A recording as read: a size, then output bytes with their times in flicks, in time order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recording {
    pub cols: u16,
    pub rows: u16,
    pub chunks: Vec<(i64, Vec<u8>)>,
}

impl Recording {
    /// A recording file: UTF-8 JSON lines, the size `{"cols", "rows"}` first, then one chunk of
    /// output a line, `{"at": flicks from the start, "text": what the program wrote}`. `None` for
    /// bytes that aren't one, so the decode worker tries its other formats.
    pub fn parse(data: &[u8]) -> Option<Recording> {
        let text = std::str::from_utf8(data).ok()?;
        let mut lines = text.lines().filter(|l| !l.trim().is_empty());
        let size: Value = serde_json::from_str(lines.next()?).ok()?;
        let dim = |k: &str| {
            u16::try_from(size.get(k)?.as_u64()?)
                .ok()
                .filter(|n| *n > 0)
        };
        let (cols, rows) = (dim("cols")?, dim("rows")?);
        let mut chunks = Vec::new();
        for line in lines {
            let chunk: Value = serde_json::from_str(line).ok()?;
            let at = chunk.get("at")?.as_i64()?;
            let text = chunk.get("text")?.as_str()?;
            chunks.push((at, text.as_bytes().to_vec()));
        }
        Some(Recording { cols, rows, chunks })
    }

    /// The planted import's times: each chunk's rounded to the nearest whole second, halves up.
    pub fn whole_seconds(mut self) -> Recording {
        let s = FLICKS_PER_SECOND;
        for c in &mut self.chunks {
            c.0 = (c.0 + s / 2).div_euclid(s) * s;
        }
        self
    }
}

/// A color as a recording keeps it: absent for the palette's default, an index, or `#rrggbb`.
fn color_value(c: Color) -> Option<Value> {
    match c {
        Color::Default => None,
        Color::Indexed(i) => Some(json!(i)),
        Color::Rgb([r, g, b]) => Some(json!(format!("#{r:02x}{g:02x}{b:02x}"))),
    }
}

/// A kept color read back: the palette's default when absent.
pub fn color_of(v: &Value) -> Color {
    if let Some(i) = v.as_u64().and_then(|i| u8::try_from(i).ok()) {
        return Color::Indexed(i);
    }
    let hex = v
        .as_str()
        .and_then(|s| s.strip_prefix('#'))
        .filter(|s| s.len() == 6);
    let byte = |i: usize| u8::from_str_radix(hex?.get(i..i + 2)?, 16).ok();
    match (byte(0), byte(2), byte(4)) {
        (Some(r), Some(g), Some(b)) => Color::Rgb([r, g, b]),
        _ => Color::Default,
    }
}

/// One cell as a recording keeps it: its grapheme, and its colors, attribute bits and link
/// where they aren't the defaults.
fn cell_value(c: &Cell) -> Value {
    let mut m = Map::new();
    m.insert("g".into(), json!(c.g.text()));
    if let Some(fg) = color_value(c.fg) {
        m.insert("fg".into(), fg);
    }
    if let Some(bg) = color_value(c.bg) {
        m.insert("bg".into(), bg);
    }
    if c.attrs != 0 {
        m.insert("attrs".into(), json!(c.attrs));
    }
    if c.link != 0 {
        m.insert("link".into(), json!(c.link));
    }
    Value::Object(m)
}

/// A kept cell read back.
pub fn cell_of(v: &Value) -> Cell {
    let g = match v["g"].as_str().unwrap_or("") {
        "" => G::Empty,
        s => {
            let mut chars = s.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => G::One(c),
                _ => G::Many(s.into()),
            }
        }
    };
    let n = |k: &str| v[k].as_u64().unwrap_or(0);
    Cell {
        g,
        fg: color_of(&v["fg"]),
        bg: color_of(&v["bg"]),
        attrs: u16::try_from(n("attrs")).unwrap_or(0),
        link: u32::try_from(n("link")).unwrap_or(0),
    }
}

/// What the grid shows besides its cells: the cursor and what the terminal's escapes said.
fn state(t: &Terminal) -> Value {
    let (x, y) = t.cursor();
    let links: Map<String, Value> = t
        .links
        .iter()
        .map(|(id, url)| (id.to_string(), json!(url)))
        .collect();
    json!({
        "cursor": {"x": x, "y": y, "shape": t.shape.name(), "visible": t.visible, "blink": t.blink},
        "scroll": {"history": t.history_len(), "offset": 0},
        "title": t.title,
        "cwd": t.cwd,
        "progress": t.progress,
        "bell": t.bell,
        "modes": {
            "alt_screen": t.modes.alt_screen,
            "bracketed_paste": t.modes.bracketed_paste,
            "app_cursor": t.modes.app_cursor,
            "focus_events": t.modes.focus_events,
            "mouse": t.modes.mouse_name(),
        },
        "links": links,
    })
}

fn rows_of(t: &Terminal) -> Vec<Vec<Value>> {
    (0..t.rows())
        .map(|y| t.row(y).iter().map(cell_value).collect())
        .collect()
}

/// A recording converted (Asset: terminal recordings): its probe, a keyframe of the whole grid
/// every second, each holding what the chunks up to its time made, and one patch per chunk with
/// the rows it changed, each row from the first cell that changed to the last.
pub fn convert(r: &Recording) -> Value {
    let mut term = Terminal::new(r.cols, r.rows, HISTORY);
    let mut chunks: Vec<&(i64, Vec<u8>)> = r.chunks.iter().collect();
    chunks.sort_by_key(|c| c.0);
    let span = chunks.last().map_or(0, |c| c.0.max(0));
    let mut shown = rows_of(&term);
    let mut patches: Vec<Value> = Vec::new();
    let mut keyframes = Vec::new();
    // The keyframe at k seconds holds what every chunk at or before it made.
    let keyframe = |k: i64, shown: &[Vec<Value>], term: &Terminal, patches: usize| json!({"at": k * KEYFRAME_EVERY, "revision": patches, "cells": shown.concat(), "state": state(term)});
    for (at, bytes) in chunks {
        let at = (*at).max(0);
        while (keyframes.len() as i64) * KEYFRAME_EVERY < at {
            keyframes.push(keyframe(
                keyframes.len() as i64,
                &shown,
                &term,
                patches.len(),
            ));
        }
        term.feed(bytes);
        // A recording has no program to answer, nor a session to read its status.
        term.replies.clear();
        term.statuses.clear();
        let now = rows_of(&term);
        let mut rows = Vec::new();
        for (y, (was, is)) in shown.iter().zip(&now).enumerate() {
            let differs = |x: &usize| was.get(*x) != is.get(*x);
            let Some(from) = (0..is.len()).find(differs) else {
                continue;
            };
            let to = (0..is.len()).rfind(differs).unwrap_or(from);
            rows.push(json!({"y": y, "x": from, "cells": is[from..=to]}));
        }
        let revision = patches.len() as u64 + 1;
        patches.push(json!({
            "at": at, "revision": revision, "base": revision - 1,
            "rows": rows, "state": state(&term),
        }));
        shown = now;
    }
    while (keyframes.len() as i64) <= span / KEYFRAME_EVERY {
        keyframes.push(keyframe(
            keyframes.len() as i64,
            &shown,
            &term,
            patches.len(),
        ));
    }
    json!({
        "probe": {"terminal": {"cols": term.cols(), "rows": term.rows(), "span": span, "keyframes": keyframes.len()}},
        "decoder": {"name": DECODER.0, "version": DECODER.1},
        "keyframes": keyframes,
        "patches": patches,
    })
}

/// The grid a converted recording shows at `source` flicks: the keyframe at or before it plus
/// the patches after that keyframe up to it, as a frame (Cell grid: `frame`) of `cols × rows`
/// cells, row-major, with its revision and state. `None` for a value that isn't a conversion.
pub fn frame_at(converted: &Value, source: i64) -> Option<Value> {
    let probe = &converted["probe"]["terminal"];
    let cols = usize::try_from(probe["cols"].as_u64()?).ok()?;
    let keyframes = converted["keyframes"].as_array()?;
    let patches = converted["patches"].as_array()?;
    let source = source.max(0);
    let last = keyframes.len().checked_sub(1)?;
    let k = usize::try_from(source / KEYFRAME_EVERY).map_or(last, |k| k.min(last));
    let key = &keyframes[k];
    let mut cells = key["cells"].as_array()?.clone();
    let mut revision = key["revision"].as_u64()?;
    let mut state = key["state"].clone();
    let at = |p: &Value| p["at"].as_i64().unwrap_or(0);
    // The patches after the keyframe's own: those whose revision passes it, up to `source`.
    let first = usize::try_from(revision).ok()?;
    for p in patches.iter().skip(first).take_while(|p| at(p) <= source) {
        for row in p["rows"].as_array().into_iter().flatten() {
            let n = |k: &str| row[k].as_u64().and_then(|n| usize::try_from(n).ok());
            let (Some(y), Some(x)) = (n("y"), n("x")) else {
                continue;
            };
            for (i, c) in row["cells"].as_array().into_iter().flatten().enumerate() {
                if let Some(slot) = cells.get_mut(y * cols + x + i).filter(|_| x + i < cols) {
                    *slot = c.clone();
                }
            }
        }
        revision = p["revision"].as_u64()?;
        state = p["state"].clone();
    }
    let mut frame = state.as_object()?.clone();
    frame.insert("revision".into(), json!(revision));
    frame.insert("cells".into(), Value::Array(cells));
    Some(Value::Object(frame))
}

/// Each run of digits a converted recording shows, as `{at, row, x, text}` (Cell grid: a grid
/// that plays a recording quotes it, so honest numbers lists its digits as quotation): those on
/// the first keyframe's rows, then each one a patch puts on a row it changed.
pub fn digits(converted: &Value) -> Vec<Value> {
    let Some(cols) = converted["probe"]["terminal"]["cols"]
        .as_u64()
        .and_then(|c| usize::try_from(c).ok())
    else {
        return Vec::new();
    };
    let Some(first) = converted["keyframes"].get(0) else {
        return Vec::new();
    };
    let mut cells = first["cells"].as_array().cloned().unwrap_or_default();
    let runs = |cells: &[Value], y: usize| -> Vec<(usize, String)> {
        let row = cells.get(y * cols..(y + 1) * cols).unwrap_or_default();
        let mut out: Vec<(usize, String)> = Vec::new();
        for (x, c) in row.iter().enumerate() {
            match c["g"]
                .as_str()
                .filter(|g| g.len() == 1 && g.as_bytes()[0].is_ascii_digit())
            {
                Some(d) if out.last().is_some_and(|(at, run)| at + run.len() == x) => {
                    out.last_mut().expect("a run").1.push_str(d);
                }
                Some(d) => out.push((x, d.to_string())),
                None => {}
            }
        }
        out
    };
    let rows = cells.len() / cols.max(1);
    let mut out: Vec<Value> = (0..rows)
        .flat_map(|y| runs(&cells, y).into_iter().map(move |r| (y, r)))
        .map(|(y, (x, text))| json!({"at": first["at"], "row": y, "x": x, "text": text}))
        .collect();
    let skip = first["revision"]
        .as_u64()
        .and_then(|r| usize::try_from(r).ok())
        .unwrap_or(0);
    for p in converted["patches"]
        .as_array()
        .into_iter()
        .flatten()
        .skip(skip)
    {
        for row in p["rows"].as_array().into_iter().flatten() {
            let n = |k: &str| row[k].as_u64().and_then(|n| usize::try_from(n).ok());
            let (Some(y), Some(x)) = (n("y"), n("x")) else {
                continue;
            };
            let before = runs(&cells, y);
            for (i, c) in row["cells"].as_array().into_iter().flatten().enumerate() {
                if let Some(slot) = cells.get_mut(y * cols + x + i).filter(|_| x + i < cols) {
                    *slot = c.clone();
                }
            }
            for (x, text) in runs(&cells, y).into_iter().filter(|r| !before.contains(r)) {
                out.push(json!({"at": p["at"], "row": y, "x": x, "text": text}));
            }
        }
    }
    out
}

/// A `play` field's source time at film time `t` (Cell grid: `play`; as a strip maps its film
/// time): `in + (t − start) × rate`, in whole flicks, floored. `start` and `in` are flicks; `rate`
/// is a number, `"p/q"` or `[p, q]`, 1 by default.
pub fn source_time(play: &Value, start: i64, t: i64) -> Option<i64> {
    let input = match play.get("in") {
        None | Some(Value::Null) => 0,
        Some(v) => v.as_i64()?,
    };
    let (p, q): (i128, i128) = match play.get("rate") {
        None | Some(Value::Null) => (1, 1),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => (i.into(), 1),
            None => ((n.as_f64()? * 1_000_000.0).round() as i128, 1_000_000),
        },
        Some(Value::String(s)) => {
            let (p, q) = s.split_once('/').unwrap_or((s, "1"));
            (p.trim().parse().ok()?, q.trim().parse().ok()?)
        }
        Some(Value::Array(a)) if a.len() == 2 => (a[0].as_i64()?.into(), a[1].as_i64()?.into()),
        _ => return None,
    };
    if p <= 0 || q <= 0 {
        return None;
    }
    let scaled = (i128::from(t) - i128::from(start)) * p;
    i64::try_from(i128::from(input) + scaled.div_euclid(q)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HALF: i64 = KEYFRAME_EVERY / 2;

    fn steps() -> Recording {
        Recording {
            cols: 20,
            rows: 4,
            chunks: vec![
                (HALF, b"\x1b[1mstep\x1b[0m 1\r\n".to_vec()),
                (3 * HALF, b"\x1b]2;tests\x07step 2\r\n".to_vec()),
                (5 * HALF, b"\x1b[31mok\x1b[0m".to_vec()),
            ],
        }
    }

    /// A live terminal fed the chunks up to `to`, as a frame's cells and state.
    fn live(r: &Recording, to: i64) -> Value {
        let mut t = Terminal::new(r.cols, r.rows, HISTORY);
        for (_, bytes) in r.chunks.iter().filter(|c| c.0 <= to) {
            t.feed(bytes);
        }
        let revision = r.chunks.iter().filter(|c| c.0 <= to).count();
        let mut frame = state(&t).as_object().cloned().unwrap_or_default();
        frame.insert("revision".into(), json!(revision));
        frame.insert("cells".into(), Value::Array(rows_of(&t).concat()));
        Value::Object(frame)
    }

    fn text(frame: &Value, cols: usize) -> Vec<String> {
        let cells = frame["cells"].as_array().cloned().unwrap_or_default();
        cells
            .chunks(cols)
            .map(|row| {
                let s: String = row
                    .iter()
                    .map(|c| c["g"].as_str().filter(|g| !g.is_empty()).unwrap_or(" "))
                    .collect();
                s.trim_end().to_string()
            })
            .collect()
    }

    #[test]
    fn a_recording_plays_by_its_source_time_and_equals_a_live_grid_fed_the_same_bytes() {
        let r = steps();
        let c = convert(&r);
        assert_eq!(
            c["probe"],
            json!({"terminal": {"cols": 20, "rows": 4, "span": 5 * HALF, "keyframes": 3}})
        );
        let at = |t| frame_at(&c, t).expect("a frame");
        assert_eq!(text(&at(KEYFRAME_EVERY), 20), ["step 1", "", "", ""]);
        assert_eq!(
            text(&at(2 * KEYFRAME_EVERY), 20),
            ["step 1", "step 2", "", ""]
        );
        assert_eq!(text(&at(HALF - 1), 20), ["", "", "", ""]);
        for t in (0..=6 * HALF).step_by(usize::try_from(HALF / 7).unwrap_or(1)) {
            assert_eq!(at(t), live(&r, t), "the grid at {t} flicks");
        }
    }

    /// The oracle lane (#136), run on our output: an upstream terminal's ref recordings (byte
    /// streams of real programs: an editor, a process viewer in a multiplexer, a scroll test,
    /// hyperlinks, colors, wrapped lines on the alternate screen), each cut into 97-byte chunks
    /// a quarter second apart so escapes split across chunks and patches span keyframes. At every
    /// chunk's time, and between chunks, the recording's grid equals a live grid fed the same
    /// bytes up to that time (tests/oracle/README.md).
    #[test]
    fn upstream_recordings_play_as_a_live_grid_fed_the_same_bytes_shows_them() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/oracle");
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .expect("the oracle recordings")
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name())
            .collect();
        names.sort();
        assert_eq!(names.len(), 8, "every recording the README lists");
        let quarter = KEYFRAME_EVERY / 4;
        for name in names {
            let at = dir.join(&name);
            let bytes = std::fs::read(at.join("recording")).expect("a recording");
            let size: Value =
                serde_json::from_slice(&std::fs::read(at.join("size.json")).expect("a size"))
                    .expect("a size");
            let dim =
                |k: &str| u16::try_from(size[k].as_u64().expect("a dimension")).expect("a u16");
            let r = Recording {
                cols: dim("columns"),
                rows: dim("screen_lines"),
                chunks: bytes
                    .chunks(97)
                    .enumerate()
                    .map(|(k, c)| (k as i64 * quarter, c.to_vec()))
                    .collect(),
            };
            let c = convert(&r);
            assert_eq!(
                c["probe"]["terminal"]["keyframes"].as_u64(),
                Some((r.chunks.len() as u64 - 1) / 4 + 1),
                "{name:?}"
            );
            let mut live = Terminal::new(r.cols, r.rows, HISTORY);
            for (k, (t, chunk)) in r.chunks.iter().enumerate() {
                live.feed(chunk);
                let mut frame = state(&live).as_object().cloned().unwrap_or_default();
                frame.insert("revision".into(), json!(k + 1));
                frame.insert("cells".into(), Value::Array(rows_of(&live).concat()));
                let frame = Value::Object(frame);
                assert_eq!(
                    frame_at(&c, *t),
                    Some(frame.clone()),
                    "{name:?} at chunk {k}"
                );
                assert_eq!(
                    frame_at(&c, t + quarter - 1),
                    Some(frame),
                    "{name:?} before chunk {}",
                    k + 1
                );
            }
        }
    }

    #[test]
    fn every_keyframe_is_the_grid_the_patches_before_it_make() {
        let r = steps();
        let c = convert(&r);
        let empty = Recording {
            chunks: Vec::new(),
            ..r.clone()
        };
        let mut played = frame_at(&convert(&empty), 0).expect("a blank frame");
        let cols = 20;
        let patches = c["patches"].as_array().cloned().unwrap_or_default();
        let keyframes = c["keyframes"].as_array().cloned().unwrap_or_default();
        assert_eq!(keyframes.len(), 3);
        let mut next = patches.iter().peekable();
        for key in &keyframes {
            let key_at = key["at"].as_i64().expect("a time");
            while let Some(p) = next.next_if(|p| p["at"].as_i64().is_some_and(|at| at <= key_at)) {
                let cells = played["cells"].as_array_mut().expect("cells");
                for row in p["rows"].as_array().into_iter().flatten() {
                    let (y, x) = (
                        row["y"].as_u64().unwrap_or(0) as usize,
                        row["x"].as_u64().unwrap_or(0) as usize,
                    );
                    for (i, cell) in row["cells"].as_array().into_iter().flatten().enumerate() {
                        cells[y * cols + x + i] = cell.clone();
                    }
                }
            }
            assert_eq!(played["cells"], key["cells"], "the keyframe at {key_at}");
        }
        assert_eq!(
            next.count(),
            1,
            "the chunk after the last whole second is a patch past every keyframe"
        );
        assert_eq!(
            c["patches"][1]["rows"],
            json!([{"y": 1, "x": 0, "cells": [
            {"g": "s"}, {"g": "t"}, {"g": "e"}, {"g": "p"}, {"g": " "}, {"g": "2"}]}])
        );
    }

    #[test]
    fn the_digits_a_recording_shows_are_listed_once_with_the_time_they_appear() {
        let listed: Vec<(i64, u64, String)> = digits(&convert(&steps()))
            .iter()
            .map(|d| {
                (
                    d["at"].as_i64().unwrap_or(-1),
                    d["row"].as_u64().unwrap_or(99),
                    d["text"].as_str().unwrap_or("").to_string(),
                )
            })
            .collect();
        assert_eq!(
            listed,
            [(HALF, 0, "1".to_string()), (3 * HALF, 1, "2".to_string())]
        );
    }

    #[test]
    fn a_recording_file_is_its_size_then_timed_chunks() {
        let file = b"{\"cols\":20,\"rows\":4}\n{\"at\":352800000,\"text\":\"step 1\\r\\n\"}\n";
        let r = Recording::parse(file).expect("a recording");
        assert_eq!((r.cols, r.rows), (20, 4));
        assert_eq!(r.chunks, vec![(HALF, b"step 1\r\n".to_vec())]);
        assert_eq!(r.whole_seconds().chunks[0].0, KEYFRAME_EVERY);
        assert_eq!(Recording::parse(b"\x89PNG\r\n"), None);
        assert_eq!(Recording::parse(b"{\"cols\":0,\"rows\":4}\n"), None);
    }

    #[test]
    fn a_play_maps_film_time_to_source_time_as_a_strip_does() {
        let s = KEYFRAME_EVERY;
        assert_eq!(source_time(&json!({}), 0, s), Some(s));
        assert_eq!(source_time(&json!({"in": s}), 2 * s, 3 * s), Some(2 * s));
        assert_eq!(source_time(&json!({"rate": "1/2"}), 0, s), Some(s / 2));
        assert_eq!(source_time(&json!({"rate": 2}), s, 0), Some(-2 * s));
        assert_eq!(source_time(&json!({"rate": 0}), 0, s), None);
    }
}
