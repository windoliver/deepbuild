//! `render.review`'s ID view and observations (#456; canvas primitives: Check input: loop kinds:
//! ID view and observations): beside each snapshot, the same frame drawn flat in a color per item
//! from its ID hash, with a number at the visible centre of each item in render-back's ID table,
//! drawn from the object-ID pass. A kept item that doesn't show is listed under a number with no
//! mark. An observation names a category from the closed `observe` list and a number; one with no
//! number, a number the view doesn't list or another category is dropped and counted. The model's
//! reading never passes a requirement: this module only draws and sorts, it judges nothing.

use deep_canvas::registry::Frame;
use serde_json::Value;

use crate::scene;

pub const KIND: &str = "render.review";

/// The closed list a reading may use.
pub const OBSERVE: [&str; 9] = [
    "exposure_tone",
    "color_cast",
    "crushed_shadows",
    "clipped_highlights",
    "missing_item",
    "extra_item",
    "wrong_material",
    "framing",
    "other",
];

/// One item of the ID view: its number, its ID and where its number is drawn, `None` for a kept
/// item that doesn't show.
#[derive(Clone, Debug, PartialEq)]
pub struct Numbered {
    pub n: u16,
    pub id: String,
    pub at: Option<[u32; 2]>,
}

/// The ID view of one frame: straight RGBA8, rows top-down, and its numbered items.
#[derive(Clone, Debug)]
pub struct IdView {
    pub size: [u32; 2],
    pub rgba: Vec<u8>,
    pub items: Vec<Numbered>,
}

/// The flat color of item `id`, from its ID's hash: each channel kept between 48 and 207, so
/// it is never the background's black or the numbers' white and black. `salt` is empty but in a
/// planted wrong program.
pub fn color(id: &str, salt: &str) -> [u8; 3] {
    let h = deep_canvas::canon::sha256_hex(format!("{salt}{id}").as_bytes());
    let byte = |k: usize| u8::from_str_radix(&h[k * 2..k * 2 + 2], 16).unwrap_or(0);
    [0, 1, 2].map(|k| 48 + (u16::from(byte(k)) * 159 / 255) as u8)
}

/// Each px's chamfer distance (3 to a side, 4 to a corner) to the nearest px of another pick or
/// the frame's edge: the visible centre of an item is its px farthest in.
fn inside(ids: &[u32], w: usize, h: usize) -> Vec<u32> {
    const FAR: u32 = u32::MAX / 2;
    let at = |x: isize, y: isize| -> Option<u32> {
        (x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h).then(|| ids[y as usize * w + x as usize])
    };
    let mut d: Vec<u32> = (0..w * h)
        .map(|i| {
            let (x, y) = ((i % w) as isize, (i / w) as isize);
            let edge = [(-1, 0), (1, 0), (0, -1), (0, 1)]
                .iter()
                .any(|(dx, dy)| at(x + dx, y + dy) != Some(ids[i]));
            if edge {
                1
            } else {
                FAR
            }
        })
        .collect();
    let forward = [(-1isize, 0isize, 3u32), (-1, -1, 4), (0, -1, 3), (1, -1, 4)];
    for y in 0..h {
        for x in 0..w {
            for (dx, dy, c) in forward {
                let (nx, ny) = (x as isize + dx, y as isize + dy);
                if at(nx, ny).is_some() {
                    let v = d[ny as usize * w + nx as usize] + c;
                    d[y * w + x] = d[y * w + x].min(v);
                }
            }
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            for (dx, dy, c) in forward {
                let (nx, ny) = (x as isize - dx, y as isize - dy);
                if at(nx, ny).is_some() {
                    let v = d[ny as usize * w + nx as usize] + c;
                    d[y * w + x] = d[y * w + x].min(v);
                }
            }
        }
    }
    d
}

/// 3 × 5 glyphs of the digits, a row a byte, its three low bits left to right.
const DIGITS: [[u8; 5]; 10] = [
    [7, 5, 5, 5, 7],
    [2, 6, 2, 2, 7],
    [7, 1, 7, 4, 7],
    [7, 1, 7, 1, 7],
    [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7],
    [7, 4, 7, 5, 7],
    [7, 1, 1, 1, 1],
    [7, 5, 7, 5, 7],
    [7, 5, 7, 1, 7],
];

/// `n` drawn white on a black plate centred at `at`, each glyph cell `s` px.
fn number(rgba: &mut [u8], [w, h]: [usize; 2], n: u16, at: [u32; 2], s: usize) {
    let text = n.to_string();
    let (tw, th) = (text.len() * 4 * s - s, 5 * s);
    let (x0, y0) = (at[0] as isize - (tw as isize) / 2 - s as isize, at[1] as isize - (th as isize) / 2 - s as isize);
    let mut put = |x: isize, y: isize, v: u8| {
        if x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h {
            let i = (y as usize * w + x as usize) * 4;
            rgba[i..i + 4].copy_from_slice(&[v, v, v, 255]);
        }
    };
    for y in 0..(th + 2 * s) as isize {
        for x in 0..(tw + 2 * s) as isize {
            put(x0 + x, y0 + y, 0);
        }
    }
    for (k, ch) in text.bytes().enumerate() {
        let glyph = DIGITS[usize::from(ch - b'0')];
        for (row, bits) in glyph.iter().enumerate() {
            for col in 0..3 {
                if bits & (4 >> col) == 0 {
                    continue;
                }
                for (dy, dx) in (0..s).flat_map(|dy| (0..s).map(move |dx| (dy, dx))) {
                    let x = x0 + (s + k * 4 * s + col * s + dx) as isize;
                    let y = y0 + (s + row * s + dy) as isize;
                    put(x, y, 255);
                }
            }
        }
    }
}

/// The ID view of `frame`, numbering `table`'s items (render-back's ID table) from 1 in its
/// order: each item's px flat in its color, a number at the px of the item farthest in, and an
/// item none of whose px shows listed with no mark. Px of no listed item are black.
pub fn id_view(frame: &Frame, table: &[String], salt: &str) -> IdView {
    let [w, h] = frame.size.map(|v| v as usize);
    let n = w * h;
    // Each px's entry in `table`, by its pick's item or the item it is a part of.
    let entry_of_pick: std::collections::BTreeMap<u32, usize> = frame
        .picks
        .iter()
        .filter_map(|(p, id)| table.iter().position(|t| scene::is_of(id, t)).map(|k| (*p, k)))
        .collect();
    let entries: Vec<Option<usize>> = (0..n)
        .map(|i| frame.ids.get(i).and_then(|p| entry_of_pick.get(p).copied()))
        .collect();
    let keyed: Vec<u32> = entries
        .iter()
        .map(|e| e.map_or(0, |k| k as u32 + 1))
        .collect();
    let depth = inside(&keyed, w, h);
    let mut best: Vec<Option<(u32, usize)>> = vec![None; table.len()];
    for (i, e) in entries.iter().enumerate() {
        if let Some(k) = e {
            if best[*k].is_none_or(|(d, _)| depth[i] > d) {
                best[*k] = Some((depth[i], i));
            }
        }
    }
    let colors: Vec<[u8; 3]> = table.iter().map(|id| color(id, salt)).collect();
    let mut rgba = vec![0u8; n * 4];
    for (i, e) in entries.iter().enumerate() {
        let c = e.map_or([0, 0, 0], |k| colors[k]);
        rgba[i * 4..i * 4 + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
    }
    let items: Vec<Numbered> = table
        .iter()
        .enumerate()
        .map(|(k, id)| Numbered {
            n: k as u16 + 1,
            id: id.clone(),
            at: best[k].map(|(_, i)| [(i % w) as u32, (i / w) as u32]),
        })
        .collect();
    let s = (w.min(h) / 180).max(2);
    for it in &items {
        if let Some(at) = it.at {
            number(&mut rgba, [w, h], it.n, at, s);
        }
    }
    IdView {
        size: frame.size,
        rgba,
        items,
    }
}

/// The observations a reading keeps, each `(category, number)` with its item's ID, and how many
/// it dropped: one with no number, a number `view` doesn't list, or a category outside `observe`
/// (the check input's list, else the closed list).
pub fn sift(observations: &[Value], view: &[Numbered], observe: &[String]) -> (Vec<(String, u16, String)>, u16) {
    let allowed = |c: &str| {
        OBSERVE.contains(&c) && (observe.is_empty() || observe.iter().any(|o| o == c))
    };
    let mut kept = Vec::new();
    let mut dropped = 0u16;
    for o in observations {
        let category = o["category"].as_str().filter(|c| allowed(c));
        let item = o["item"]
            .as_u64()
            .and_then(|n| view.iter().find(|v| u64::from(v.n) == n));
        match (category, item) {
            (Some(c), Some(v)) => kept.push((c.to_string(), v.n, v.id.clone())),
            _ => dropped = dropped.saturating_add(1),
        }
    }
    (kept, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    /// A 40 × 20 frame: item `a` on the left half, `b` an L on the right, and `c` listed but drawn
    /// nowhere.
    fn frame() -> (Frame, Vec<String>) {
        let (w, h) = (40usize, 20usize);
        let ids = (0..w * h)
            .map(|i| {
                let (x, y) = (i % w, i / w);
                if x < 20 {
                    1
                } else if x < 26 || y >= 14 {
                    2
                } else {
                    0
                }
            })
            .collect();
        let picks = BTreeMap::from([(1, "a".to_string()), (2, "b#leg".to_string())]);
        let frame = Frame {
            size: [w as u32, h as u32],
            ids,
            picks,
            ..Frame::default()
        };
        (frame, vec!["a".into(), "b".into(), "c".into()])
    }

    #[test]
    fn numbers_each_listed_item_at_a_px_of_its_own_and_lists_a_hidden_one_with_no_mark() {
        let (f, table) = frame();
        let v = id_view(&f, &table, "");
        assert_eq!(v.items.iter().map(|i| i.n).collect::<Vec<_>>(), [1, 2, 3]);
        let at = |k: usize| v.items[k].at.expect("a mark");
        // Each mark lands on its own item's px, the L's in its body and not its empty corner.
        assert_eq!(f.ids[(at(0)[1] * 40 + at(0)[0]) as usize], 1);
        assert_eq!(f.ids[(at(1)[1] * 40 + at(1)[0]) as usize], 2);
        assert_eq!(v.items[2].at, None);
        // The left half's centre, give or take the chamfer's ties.
        assert!((8..=11).contains(&at(0)[0]) && (8..=11).contains(&at(0)[1]), "{:?}", at(0));
    }

    #[test]
    fn the_view_is_the_same_bytes_every_draw() {
        let (f, table) = frame();
        assert_eq!(id_view(&f, &table, "").rgba, id_view(&f, &table, "").rgba);
    }

    #[test]
    fn drops_an_observation_with_no_number_an_unlisted_one_or_another_category() {
        let view: Vec<Numbered> = (1..=12)
            .map(|n| Numbered {
                n,
                id: format!("i{n}"),
                at: None,
            })
            .collect();
        let obs = [
            json!({"category": "missing_item", "item": 12}),
            json!({"category": "missing_item"}),
            json!({"category": "framing", "item": 99}),
            json!({"category": "too_blue", "item": 3}),
        ];
        let (kept, dropped) = sift(&obs, &view, &[]);
        assert_eq!(kept, [("missing_item".to_string(), 12, "i12".to_string())]);
        assert_eq!(dropped, 3);
    }
}
