//! A sheet's cells (#394 Fields; canvas primitives: Sheet `sheet@1`): treatments, the texture
//! cache key (content key, size, treatment, look), highlights beside a cell and never on it, a
//! caption naming each look when the sheet mixes looks, and the four things a cell can show.

use std::io::Write;
use std::process::{Command, Stdio};

use deep_canvas::color::{srgb_to_oklab, Srgb};
use deep_canvas_sheet::{
    captions, cell_key, place, render, Cell, Still, Treatment, MARK, MARK_OFF,
};
use serde_json::{json, Value};

fn still(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Still {
    let mut rgba = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let [r, g, b] = pixel(x, y);
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    Still {
        width,
        height,
        rgba,
    }
}

fn px(s: &Still, rgba: &[u8], x: u32, y: u32) -> [u8; 3] {
    let i = ((y * s.width + x) * 4) as usize;
    [rgba[i], rgba[i + 1], rgba[i + 2]]
}

fn lightness(c: [u8; 3]) -> f64 {
    let v = |c: u8| f64::from(c) / 255.0;
    srgb_to_oklab(Srgb {
        r: v(c[0]),
        g: v(c[1]),
        b: v(c[2]),
    })
    .l
}

/// Four columns of red, green, blue and orange over two rows.
fn colors() -> Still {
    still(4, 2, |x, _| {
        [[230, 30, 30], [30, 200, 60], [40, 60, 230], [250, 160, 20]][x as usize]
    })
}

#[test]
fn mono_keeps_each_pixels_lightness_in_grey() {
    let s = colors();
    let out = render(&s, Treatment::Mono);
    for x in 0..4 {
        let [r, g, b] = px(&s, &out, x, 0);
        assert!(r == g && g == b, "column {x} is grey");
        // An average of r, g and b gives a grey whose lightness is off by up to 0.2 here.
        let d = lightness([r, g, b]) - lightness(px(&s, &s.rgba, x, 0));
        assert!(
            d.abs() < 0.003,
            "column {x} keeps its OKLab lightness: off by {d}"
        );
    }
}

#[test]
fn reversed_mirror_and_none_move_pixels_as_named() {
    let s = colors();
    let reversed = render(&s, Treatment::Reversed);
    let mirror = render(&s, Treatment::Mirror);
    for y in 0..2 {
        for x in 0..4 {
            assert_eq!(
                px(&s, &reversed, x, y),
                px(&s, &s.rgba, x, y).map(|c| 255 - c)
            );
            assert_eq!(px(&s, &mirror, x, y), px(&s, &s.rgba, 3 - x, y));
        }
    }
    assert_eq!(render(&s, Treatment::None), s.rgba);
}

#[test]
fn blur_spreads_a_point_evenly_and_only_nearby() {
    // 64 px square: radius 2, so three passes reach 6 px from the point.
    let s = still(
        64,
        64,
        |x, y| if (x, y) == (32, 32) { [255; 3] } else { [0; 3] },
    );
    let out = render(&s, Treatment::Blur);
    let at = |x, y| px(&s, &out, x, y)[0];
    assert!(at(32, 32) < 255 && at(32, 32) > 0, "the point is spread");
    for d in 1..=3 {
        assert_eq!(at(32 - d, 32), at(32 + d, 32), "even left and right at {d}");
        assert_eq!(at(32, 32 - d), at(32, 32 + d), "even up and down at {d}");
    }
    assert!(at(33, 32) > 0, "a neighbour gets some");
    assert_eq!(at(39, 32), 0, "nothing past three radii");
    assert_eq!(at(32, 25), 0, "nothing past three radii");
}

#[test]
fn a_cells_key_changes_with_its_content_size_treatment_and_look() {
    let s = colors();
    let key = cell_key(&s, Treatment::None, "studio");
    assert_eq!(
        key,
        cell_key(&colors(), Treatment::None, "studio"),
        "the same cell, the same key"
    );
    let reshaped = Still {
        width: 2,
        height: 4,
        rgba: s.rgba.clone(),
    };
    let mut repainted = s.clone();
    repainted.rgba[0] ^= 1;
    for (other, what) in [
        (cell_key(&repainted, Treatment::None, "studio"), "content"),
        (cell_key(&reshaped, Treatment::None, "studio"), "size"),
        (cell_key(&s, Treatment::Mono, "studio"), "treatment"),
        (cell_key(&s, Treatment::None, "dusk"), "look"),
    ] {
        assert_ne!(other, key, "a cell whose {what} differs is cached apart");
    }
}

fn cell(id: &str, size: [u32; 2], look: Option<&str>, highlights: Vec<[u32; 4]>) -> Cell {
    Cell {
        id: id.to_string(),
        size,
        names_option: Some(id.to_string()),
        look: look.map(str::to_string),
        highlights,
    }
}

fn overlaps(a: [u32; 4], b: [u32; 4]) -> bool {
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

#[test]
fn highlights_mark_their_regions_beside_the_cell_never_on_it() {
    let cells = [
        cell("a", [100, 60], None, vec![[10, 20, 30, 15]]),
        cell("b", [100, 60], None, vec![]),
    ];
    let placed = place([1280, 800], [360, 240], &cells, None, 8).expect("fits");
    let [a, b] = [placed.cells[0], placed.cells[1]];
    assert_eq!([a[2], a[3]], [100, 60], "the cell keeps its exact size");
    let [right, below] = placed.marks[0][0];
    assert_eq!(
        right,
        [a[0] + 100 + MARK_OFF, a[1] + 20, MARK, 15],
        "the rows it marks, right of the cell"
    );
    assert_eq!(
        below,
        [a[0] + 10, a[1] + 60 + MARK_OFF, 30, MARK],
        "the columns it marks, below the cell"
    );
    for mark in [right, below] {
        assert!(
            !overlaps(mark, a) && !overlaps(mark, b),
            "a mark covers no cell"
        );
    }
    let outside = [cell("c", [100, 60], None, vec![[90, 0, 20, 10]])];
    assert_eq!(
        place([1280, 800], [360, 240], &outside, None, 8),
        Err("sheet.highlight_outside")
    );
}

#[test]
fn a_sheet_that_mixes_looks_names_each_cells_look() {
    let labels = ["Warm".to_string(), "Cool".to_string()];
    let same = [
        cell("a", [10, 10], Some("studio"), vec![]),
        cell("b", [10, 10], Some("studio"), vec![]),
    ];
    assert_eq!(captions(&same, &labels), labels);
    let mixed = [
        cell("a", [10, 10], Some("studio"), vec![]),
        cell("b", [10, 10], Some("dusk"), vec![]),
    ];
    assert_eq!(
        captions(&mixed, &labels),
        ["Warm · look studio", "Cool · look dusk"]
    );
}

fn sheet(lines: &[Value], command: &str) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-sheet"))
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-sheet runs");
    let mut input = child.stdin.take().expect("stdin");
    for line in lines {
        writeln!(input, "{line}").expect("written");
    }
    drop(input);
    let out = child.wait_with_output().expect("it exits");
    String::from_utf8(out.stdout)
        .expect("utf-8")
        .lines()
        .map(|l| serde_json::from_str(l).expect("a JSON line"))
        .collect()
}

#[test]
fn a_cell_shows_a_doc_handle_an_ask_option_a_time_or_a_variant_and_nothing_else() {
    let view = |show: Value| {
        json!({"view": [1280, 800], "card": {"ask": "ask:01", "size": [360, 240]}, "inputs": [],
               "sheet": {"cells": [{"id": "c", "show": show, "size": [40, 30], "label": "C"}]}})
    };
    let shows = [
        json!({"doc": "doc:01JB0000000000000000000000"}),
        json!({"ask_option": "warm"}),
        json!({"time": "1.5s"}),
        json!({"variant": "palette/warm"}),
        json!({"color": "red"}),
        json!({"time": "1.5s", "variant": "palette/warm"}),
    ];
    let out = sheet(&shows.map(view), "view");
    let ok: Vec<bool> = out.iter().map(|o| o["ok"] == true).collect();
    assert_eq!(ok, [true, true, true, true, false, false]);
}

#[test]
fn render_draws_each_cell_through_its_treatment_at_its_exact_size() {
    let s = colors();
    let b64 = |bytes: &[u8]| {
        const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in bytes.chunks(3) {
            let n = c
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
            for i in 0..4 {
                out.push(if i <= c.len() {
                    ABC[(n >> (18 - 6 * i) & 63) as usize] as char
                } else {
                    '='
                });
            }
        }
        out
    };
    let still = json!({"size": [4, 2], "rgba": b64(&s.rgba)});
    let line = |size: [u32; 2]| {
        json!({"look": "studio", "stills": {"m": still, "r": still},
               "sheet": {"cells": [{"id": "m", "show": {"ask_option": "m"}, "size": size, "treatment": "mirror"},
                                   {"id": "r", "show": {"ask_option": "r"}, "size": [4, 2], "treatment": "reversed"}]}})
    };
    let out = sheet(&[line([4, 2]), line([8, 4])], "render");
    assert_eq!(
        out[0]["cells"]["m"]["rgba"],
        json!(b64(&render(&s, Treatment::Mirror)))
    );
    assert_eq!(
        out[0]["cells"]["r"]["rgba"],
        json!(b64(&render(&s, Treatment::Reversed)))
    );
    assert_eq!(
        out[0]["cells"]["m"]["key"],
        json!(cell_key(&s, Treatment::Mirror, "studio").hex())
    );
    assert_eq!(
        out[1],
        json!({"ok": false, "code": "sheet.size_mismatch"}),
        "a cell never scales its still"
    );
}
