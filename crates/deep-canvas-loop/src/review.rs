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
/// the frame's edge: the visible centre of an item is its px farthest in. Two passes, each row
/// first lowered from the row before it, where every px is independent, then along itself
/// (#3017: a 1936 × 1584 frame in a few ms, the same distances as px by px).
fn inside(ids: &[u32], w: usize, h: usize) -> Vec<u32> {
    const FAR: u32 = u32::MAX / 2;
    let mut d = vec![0u32; w * h];
    // Forward: 1 on the frame's edge and beside a px of another pick, else FAR lowered from the
    // row above (straight up 3, its corners 4); then from the left (3).
    for y in 0..h {
        let (done, rest) = d.split_at_mut(y * w);
        let row = &mut rest[..w];
        if y == 0 || y + 1 == h || w < 3 {
            row.fill(1);
            continue;
        }
        let n = w - 2;
        let at = |r: usize, x: usize| &ids[r * w + x..r * w + x + n];
        let (c, l, r, u, b) = (at(y, 1), at(y, 0), at(y, 2), at(y - 1, 1), at(y + 1, 1));
        let above = &done[(y - 1) * w..];
        let (a0, a1, a2) = (&above[..n], &above[1..n + 1], &above[2..n + 2]);
        let out = &mut row[1..n + 1];
        for i in 0..n {
            let k = c[i];
            let edge = (k != l[i]) | (k != r[i]) | (k != u[i]) | (k != b[i]);
            let seed = if edge { 1 } else { FAR };
            out[i] = seed.min(a1[i] + 3).min(a0[i] + 4).min(a2[i] + 4);
        }
        row[0] = 1;
        row[w - 1] = 1;
        run_right(row);
    }
    // Backward: from the row below, then from the right. The first and last rows hold 1s.
    for y in (1..h.saturating_sub(1)).rev() {
        let (row, below) = d[y * w..].split_at_mut(w);
        if w > 2 {
            let n = w - 2;
            let (b0, b1, b2) = (&below[..n], &below[1..n + 1], &below[2..n + 2]);
            let out = &mut row[1..n + 1];
            for i in 0..n {
                out[i] = out[i].min(b1[i] + 3).min(b0[i] + 4).min(b2[i] + 4);
            }
        }
        run_left(row);
    }
    d
}

/// Each px of `row` lowered to the px on its left plus 3. Eight px at a time: a block whose own
/// left neighbours, as they stand, lower none of it, and whose first px the run reaching it
/// doesn't lower either, is left as it is (most are), so only the rest wait on the px before.
fn run_right(row: &mut [u32]) {
    let w = row.len();
    let Some(&first) = row.first() else { return };
    let (mut prev, mut x) = (first, 1);
    while x < w {
        let end = (x + 8).min(w);
        let (block, left) = (&row[x..end], &row[x - 1..end - 1]);
        let still = left
            .iter()
            .zip(block)
            .fold(prev + 3 >= block[0], |a, (l, v)| a & (l + 3 >= *v));
        if !still {
            for v in &mut row[x..end] {
                if prev + 3 < *v {
                    *v = prev + 3;
                }
                prev = *v;
            }
        }
        prev = row[end - 1];
        x = end;
    }
}

/// [`run_right`] the other way: each px lowered to the px on its right plus 3.
fn run_left(row: &mut [u32]) {
    let Some(&last) = row.last() else { return };
    let (mut prev, mut x) = (last, row.len() - 1);
    while x > 0 {
        let start = x.saturating_sub(8);
        let (block, right) = (&row[start..x], &row[start + 1..x + 1]);
        let still = right
            .iter()
            .zip(block)
            .fold(prev + 3 >= block[x - start - 1], |a, (r, v)| {
                a & (r + 3 >= *v)
            });
        if !still {
            for v in row[start..x].iter_mut().rev() {
                if prev + 3 < *v {
                    *v = prev + 3;
                }
                prev = *v;
            }
        }
        prev = row[start];
        x = start;
    }
}

/// Where each of `n` keys shows farthest in, in a frame `w` px wide keyed per px (key `k` in
/// `1..=n`, 0 for none): its px of the largest [`inside`] distance, the first in row order on a
/// tie, as `[x, y]`; `None` for a key with no px. The ID view numbers its items there, and a 3D
/// snapshot's visible table gives it as each row's `at` (#3017).
pub fn centres(keys: &[u32], w: usize, n: usize) -> Vec<Option<[u32; 2]>> {
    let h = keys.len().checked_div(w).unwrap_or(0);
    let depth = inside(keys, w, h);
    // Each key's largest distance so far (0: none yet, as every px's is at least 1) and its px.
    let (mut far, mut at) = (vec![0u32; n + 1], vec![0usize; n + 1]);
    for (i, (&k, &d)) in keys.iter().zip(&depth).enumerate() {
        if let Some(f) = far.get_mut(k as usize) {
            if d > *f {
                *f = d;
                at[k as usize] = i;
            }
        }
    }
    (1..=n)
        .map(|k| (far[k] > 0).then(|| [(at[k] % w) as u32, (at[k] / w) as u32]))
        .collect()
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
    let (x0, y0) = (
        at[0] as isize - (tw as isize) / 2 - s as isize,
        at[1] as isize - (th as isize) / 2 - s as isize,
    );
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
        .filter_map(|(p, id)| {
            table
                .iter()
                .position(|t| scene::is_of(id, t))
                .map(|k| (*p, k))
        })
        .collect();
    let entries: Vec<Option<usize>> = (0..n)
        .map(|i| frame.ids.get(i).and_then(|p| entry_of_pick.get(p).copied()))
        .collect();
    let keyed: Vec<u32> = entries
        .iter()
        .map(|e| e.map_or(0, |k| k as u32 + 1))
        .collect();
    let best = centres(&keyed, w, table.len());
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
            at: best[k],
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
pub fn sift(
    observations: &[Value],
    view: &[Numbered],
    observe: &[String],
) -> (Vec<(String, u16, String)>, u16) {
    let allowed =
        |c: &str| OBSERVE.contains(&c) && (observe.is_empty() || observe.iter().any(|o| o == c));
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
        assert!(
            (8..=11).contains(&at(0)[0]) && (8..=11).contains(&at(0)[1]),
            "{:?}",
            at(0)
        );
    }

    /// The chamfer pass as #456 first wrote it, px by px: the reference the row-wise passes keep.
    fn inside_px_by_px(ids: &[u32], w: usize, h: usize) -> Vec<u32> {
        let at = |x: isize, y: isize| {
            (x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h)
                .then(|| ids[y as usize * w + x as usize])
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
                    u32::MAX / 2
                }
            })
            .collect();
        let steps = [(-1isize, 0isize, 3u32), (-1, -1, 4), (0, -1, 3), (1, -1, 4)];
        for back in [false, true] {
            for j in 0..w * h {
                let i = if back { w * h - 1 - j } else { j };
                let (x, y) = ((i % w) as isize, (i / w) as isize);
                for (dx, dy, c) in steps {
                    let (dx, dy) = if back { (-dx, -dy) } else { (dx, dy) };
                    if at(x + dx, y + dy).is_some() {
                        let v = d[(y + dy) as usize * w + (x + dx) as usize] + c;
                        d[i] = d[i].min(v);
                    }
                }
            }
        }
        d
    }

    #[test]
    fn the_row_wise_chamfer_matches_the_px_by_px_one_on_random_frames() {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = |m: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % m
        };
        for _ in 0..300 {
            let (w, h) = (1 + next(24) as usize, 1 + next(24) as usize);
            // Blocks of a few keys, so regions have insides as well as edges.
            let (bw, bh, keys) = (1 + next(8) as usize, 1 + next(8) as usize, 1 + next(5));
            let cells: Vec<u32> = (0..w.div_ceil(bw) * h.div_ceil(bh))
                .map(|_| next(keys) as u32)
                .collect();
            let ids: Vec<u32> = (0..w * h)
                .map(|i| cells[(i / w / bh) * w.div_ceil(bw) + (i % w) / bw])
                .collect();
            assert_eq!(inside(&ids, w, h), inside_px_by_px(&ids, w, h), "{w} × {h}");
        }
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
