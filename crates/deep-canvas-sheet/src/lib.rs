//! Issue #394: the sheet module (canvas primitives: Sheet `sheet@1`). A taste call that picks
//! among candidates shows them side by side on a variant sheet, with none of these on the card:
//! two candidates whose stills differ by an OKLab ΔE under 0.1 at the 90th percentile of their
//! pixels count as one, and the later is dropped before the ask and named in it. The view reserves
//! the question card's slot and draws the sheet beside it, each cell at its exact size in device
//! px; a click on a cell preselects its option and answers nothing, since only the card answers.
//! A cell renders its still through its treatment (mono, reversed, blur or mirror) once, cached by
//! (content key, size, treatment, look); its highlights draw beside it, never on it; and a sheet
//! whose cells show different looks names each cell's look in its caption.

use deep_canvas::color::{linear_to_oklab, oklab_to_srgb, srgb_decode, LinearRgb, Oklab};
use deep_canvas::ops;
use deep_canvas_marks::key::{ContentKey, KeyBuilder};
use serde_json::{json, Map, Value};

/// Two stills closer than this at the 90th percentile of their pixels' OKLab ΔE count as one.
pub const NEAR: f64 = 0.1;
/// The option a taste call adds, which sends the work back with your note.
pub const NONE_OF_THESE: &str = "none_of_these";
/// Between cells, in device px (Sheet: `gap: px = 8`).
pub const GAP: u32 = 8;
/// Around the card's slot and the sheet inside the view, in device px.
pub const MARGIN: u32 = 16;
/// A highlight's mark beside its cell: 2 px off the cell's edge, 3 px thick.
pub const MARK_OFF: u32 = 2;
pub const MARK: u32 = 3;

/// A candidate's still: opaque sRGB-encoded RGBA8, row-major from the top left.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Still {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

fn oklab(px: &[u8]) -> Oklab {
    let channel = |c: u8| srgb_decode(f64::from(c) / 255.0);
    linear_to_oklab(LinearRgb {
        r: channel(px[0]),
        g: channel(px[1]),
        b: channel(px[2]),
    })
}

/// The 90th percentile (nearest rank) of the per-pixel OKLab ΔE between two stills of one size;
/// `None` for stills of different sizes, which never count as one.
pub fn p90_delta_e(a: &Still, b: &Still) -> Option<f64> {
    if (a.width, a.height) != (b.width, b.height) || a.rgba.is_empty() {
        return None;
    }
    let mut d: Vec<f64> = a
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .zip(b.rgba.as_chunks::<4>().0)
        .map(|(p, q)| {
            let (p, q) = (oklab(p), oklab(q));
            let (dl, da, db) = (p.l - q.l, p.a - q.a, p.b - q.b);
            ops::sqrt(dl * dl + da * da + db * db)
        })
        .collect();
    d.sort_by(f64::total_cmp);
    let rank = (d.len() * 9).div_ceil(10);
    Some(d[rank - 1])
}

/// Decodes standard base64 with padding.
pub fn base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for (k, quad) in bytes.as_chunks::<4>().0.iter().enumerate() {
        let last = k + 1 == bytes.len() / 4;
        let pad = quad.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && !last) {
            return None;
        }
        let mut n = 0u32;
        for &c in &quad[..4 - pad] {
            n = n << 6 | u32::from(value(c)?);
        }
        n <<= 6 * pad as u32;
        out.extend_from_slice(&n.to_be_bytes()[1..4 - pad]);
    }
    Some(out)
}

/// A candidate dropped as a near copy of an earlier one the sheet keeps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dropped {
    pub option: String,
    pub same_as: String,
}

/// Which candidates count as one: each is compared with every earlier one kept, in order, and
/// dropped as the same as the first it's near.
pub fn near_copies(candidates: &[(String, Still)]) -> Vec<Dropped> {
    let mut kept: Vec<&(String, Still)> = Vec::new();
    let mut dropped = Vec::new();
    for c in candidates {
        let same = kept
            .iter()
            .find(|k| p90_delta_e(&k.1, &c.1).is_some_and(|d| d < NEAR));
        match same {
            Some(k) => dropped.push(Dropped {
                option: c.0.clone(),
                same_as: k.0.clone(),
            }),
            None => kept.push(c),
        }
    }
    dropped
}

/// The taste call to raise and its variant sheet.
pub struct Taste {
    pub ask: Map<String, Value>,
    pub sheet: Value,
    pub dropped: Vec<Dropped>,
}

/// Drops the near copies from an agent's taste call (ask.created taste data, one option per
/// candidate), adds none of these and names the dropped copies in the ask; a recommendation or a
/// default that named a dropped copy names the candidate it counts as one with.
pub fn taste(
    ask: &Map<String, Value>,
    candidates: &[(String, Still)],
) -> Result<Taste, &'static str> {
    if ask.get("kind").and_then(Value::as_str) != Some("taste") {
        return Err("sheet.not_a_taste_call");
    }
    let options = ask
        .get("options")
        .and_then(Value::as_array)
        .ok_or("bad_input")?;
    let id = |o: &Value| o.get("id").and_then(Value::as_str).map(str::to_string);
    let ids: Vec<String> = options
        .iter()
        .map(id)
        .collect::<Option<_>>()
        .ok_or("bad_input")?;
    if ids.iter().any(|i| i == NONE_OF_THESE) {
        return Err("sheet.option_taken");
    }
    let mut named: Vec<&str> = candidates.iter().map(|c| c.0.as_str()).collect();
    named.sort_unstable();
    named.dedup();
    let mut offered: Vec<&str> = ids.iter().map(String::as_str).collect();
    offered.sort_unstable();
    if candidates.is_empty() || named.len() != candidates.len() || named != offered {
        return Err("sheet.candidates_mismatch");
    }
    let dropped = near_copies(candidates);
    let is_dropped = |o: &str| dropped.iter().find(|d| d.option == o);
    let mut out = ask.clone();
    let mut kept: Vec<Value> = options
        .iter()
        .filter(|o| id(o).is_some_and(|i| is_dropped(&i).is_none()))
        .cloned()
        .collect();
    kept.push(json!({"id": NONE_OF_THESE, "label": "None of these", "decision": "none"}));
    out.insert("options".into(), Value::Array(kept));
    for field in ["recommended", "default"] {
        if let Some(d) = out.get(field).and_then(Value::as_str).and_then(is_dropped) {
            out.insert(field.into(), json!(d.same_as));
        }
    }
    out.insert(
        "dropped".into(),
        dropped
            .iter()
            .map(|d| json!({"option": d.option, "same_as": d.same_as}))
            .collect(),
    );
    let label = |o: &str| {
        options
            .iter()
            .find(|v| id(v).as_deref() == Some(o))
            .and_then(|v| v.get("label").cloned())
            .unwrap_or(Value::Null)
    };
    let cells: Vec<Value> = candidates
        .iter()
        .filter(|c| is_dropped(&c.0).is_none())
        .map(|(option, still)| {
            json!({
                "id": option,
                "show": {"ask_option": option},
                "size": [still.width, still.height],
                "treatment": "none",
                "label": label(option),
                "names_option": option,
                "highlights": [],
            })
        })
        .collect();
    Ok(Taste {
        ask: out,
        sheet: json!({"cells": cells, "columns": "auto", "gap": GAP}),
        dropped,
    })
}

/// A rect `[x, y, w, h]` in device px.
pub type Rect = [u32; 4];

/// A sheet's cell as the view reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub id: String,
    pub size: [u32; 2],
    pub names_option: Option<String>,
    /// The look the cell's still shows, when the sheet names one.
    pub look: Option<String>,
    /// Regions of the cell `[x, y, w, h]` in its own px, marked beside it.
    pub highlights: Vec<Rect>,
}

/// What a cell shows (Sheet: `show: doc handle | ask option | time | variant`).
pub const SHOWS: [&str; 4] = ["doc", "ask_option", "time", "variant"];

/// Where a view that lists one ask puts the card's slot, the sheet and each cell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placed {
    pub card: Rect,
    pub sheet: Rect,
    pub cells: Vec<Rect>,
    /// Per cell, per highlight: its mark right of the cell (its rows) and below it (its columns).
    pub marks: Vec<Vec<[Rect; 2]>>,
}

/// The card's slot at the view's top left, the sheet to its right at the same top, its cells in
/// rows of `columns` (or as many as fit, for auto), each at its exact size, with room beside and
/// below a cell for its highlights' marks. A sheet that doesn't fit beside the card is refused: a
/// cell never scales.
pub fn place(
    view: [u32; 2],
    card: [u32; 2],
    cells: &[Cell],
    columns: Option<usize>,
    gap: u32,
) -> Result<Placed, &'static str> {
    let slot = [MARGIN, MARGIN, card[0], card[1]];
    let left = MARGIN + card[0] + MARGIN;
    let room = view[0]
        .checked_sub(left + MARGIN)
        .ok_or("sheet.does_not_fit")?;
    let mut rects = Vec::with_capacity(cells.len());
    let mut marks = Vec::with_capacity(cells.len());
    let (mut x, mut y, mut row_h, mut in_row, mut widest) = (0u32, 0u32, 0u32, 0usize, 0u32);
    for c in cells {
        let [w, h] = c.size;
        if c.highlights
            .iter()
            .any(|r| r[0] + r[2] > w || r[1] + r[3] > h)
        {
            return Err("sheet.highlight_outside");
        }
        let beside = if c.highlights.is_empty() {
            0
        } else {
            MARK_OFF + MARK
        };
        let full = columns.is_some_and(|n| in_row == n);
        let over = columns.is_none() && in_row > 0 && x + gap + w + beside > room;
        if full || over {
            y += row_h + gap;
            (x, row_h, in_row) = (0, 0, 0);
        }
        if in_row > 0 {
            x += gap;
        }
        let (cx, cy) = (left + x, MARGIN + y);
        rects.push([cx, cy, w, h]);
        marks.push(
            c.highlights
                .iter()
                .map(|r| {
                    [
                        [cx + w + MARK_OFF, cy + r[1], MARK, r[3]],
                        [cx + r[0], cy + h + MARK_OFF, r[2], MARK],
                    ]
                })
                .collect(),
        );
        x += w + beside;
        row_h = row_h.max(h + beside);
        widest = widest.max(x);
        in_row += 1;
    }
    let sheet = [left, MARGIN, widest, y + row_h];
    let fits = |r: &Rect| r[0] + r[2] + MARGIN <= view[0] && r[1] + r[3] + MARGIN <= view[1];
    if !fits(&slot) || !fits(&sheet) {
        return Err("sheet.does_not_fit");
    }
    Ok(Placed {
        card: slot,
        sheet,
        cells: rects,
        marks,
    })
}

/// Each cell's caption: its label, and its look's name when the sheet's cells show different looks.
pub fn captions(cells: &[Cell], labels: &[String]) -> Vec<String> {
    let mixed = cells.windows(2).any(|w| w[0].look != w[1].look);
    cells
        .iter()
        .zip(labels)
        .map(|(c, label)| match (&c.look, mixed) {
            (Some(look), true) => format!("{label} · look {look}"),
            (None, true) => format!("{label} · no look named"),
            _ => label.clone(),
        })
        .collect()
}

/// How a cell renders its still (Sheet: `treatment`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Treatment {
    None,
    /// Grey at each pixel's OKLab lightness.
    Mono,
    /// Each channel's code value reversed, 255 − c.
    Reversed,
    /// Three passes of a box blur, its radius a 32nd of the shorter side (at least 1 px).
    Blur,
    /// Flipped left to right.
    Mirror,
}

impl Treatment {
    pub fn read(name: &str) -> Option<Treatment> {
        Some(match name {
            "none" => Treatment::None,
            "mono" => Treatment::Mono,
            "reversed" => Treatment::Reversed,
            "blur" => Treatment::Blur,
            "mirror" => Treatment::Mirror,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Treatment::None => "none",
            Treatment::Mono => "mono",
            Treatment::Reversed => "reversed",
            Treatment::Blur => "blur",
            Treatment::Mirror => "mirror",
        }
    }
}

fn code(v: f64) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// One box blur pass along rows (`stride` 4) or columns (`stride` 4 × width), edges clamped.
fn box_pass(rgba: &[u8], width: usize, height: usize, radius: usize, rows: bool) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let (lines, len) = if rows {
        (height, width)
    } else {
        (width, height)
    };
    let at = |line: usize, i: usize| {
        if rows {
            (line * width + i) * 4
        } else {
            (i * width + line) * 4
        }
    };
    let n = (2 * radius + 1) as u32;
    for line in 0..lines {
        for i in 0..len {
            for c in 0..3 {
                let sum: u32 = (0..n as usize)
                    .map(|k| {
                        u32::from(rgba[at(line, (i + k).saturating_sub(radius).min(len - 1)) + c])
                    })
                    .sum();
                out[at(line, i) + c] = ((sum + n / 2) / n) as u8;
            }
        }
    }
    out
}

/// The cell's pixels: its still through its treatment, at the still's exact size.
pub fn render(still: &Still, treatment: Treatment) -> Vec<u8> {
    let (w, h) = (still.width as usize, still.height as usize);
    match treatment {
        Treatment::None => still.rgba.clone(),
        Treatment::Mono => still
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|px| {
                let grey = oklab_to_srgb(Oklab {
                    l: oklab(px).l,
                    a: 0.0,
                    b: 0.0,
                });
                let v = code(grey.g);
                [v, v, v, px[3]]
            })
            .collect(),
        Treatment::Reversed => still
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|px| [255 - px[0], 255 - px[1], 255 - px[2], px[3]])
            .collect(),
        _ if w == 0 || h == 0 => still.rgba.clone(),
        Treatment::Mirror => still
            .rgba
            .chunks_exact(w * 4)
            .flat_map(|row| row.as_chunks::<4>().0.iter().rev().flatten().copied())
            .collect(),
        Treatment::Blur => {
            let radius = (w.min(h) / 32).max(1);
            let mut px = still.rgba.clone();
            for _ in 0..3 {
                px = box_pass(&px, w, h, radius, true);
                px = box_pass(&px, w, h, radius, false);
            }
            px
        }
    }
}

/// A cell texture's cache key: what it shows, its size, its treatment and the look.
pub fn cell_key(still: &Still, treatment: Treatment, look: &str) -> ContentKey {
    KeyBuilder::new("cell@sheet.1")
        .bytes(&still.rgba)
        .int(i64::from(still.width))
        .int(i64::from(still.height))
        .text(treatment.name())
        .text(look)
        .finish()
}

/// The cell under a point, if any.
pub fn hit(placed: &Placed, point: [f64; 2]) -> Option<usize> {
    placed.cells.iter().position(|r| {
        let [x, y, w, h] = r.map(f64::from);
        point[0] >= x && point[0] < x + w && point[1] >= y && point[1] < y + h
    })
}
