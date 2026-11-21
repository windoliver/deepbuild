//! #2500: what a shot frames and a reach aims at: an item's own extent, or a text's read-only
//! anchors, `<id>#line:n` and `<id>#tok:k` (Text `text@1`: code). Motion shapes no text: a text's
//! box is the text module's, from its one shaped run, about the item's origin.

use serde_json::{Map, Value};

use crate::doc::Refused;

/// `<id>#<part>` as its item and part.
pub fn split(id: &str) -> (&str, Option<&str>) {
    match id.split_once('#') {
        Some((id, part)) => (id, Some(part)),
        None => (id, None),
    }
}

/// Item `id`'s own extent `[lo, hi]` about its origin (Camera `camera@1`: framing): a box,
/// cylinder or sphere by its size (#504, read as the geometry audit reads it), a rect by its box,
/// a text by its shaped run, any other kind a point; with `part`, a text's line or token by its
/// box. `None` for a part the item lacks.
pub fn extent(id: &str, item: &Value, part: Option<&str>) -> Option<[[f64; 3]; 2]> {
    let text = deep_canvas_marks::lines::text_box(id, item, part)
        .map(|[x, y, w, h]| [[x, y, 0.0], [x + w, y + h, 0.0]]);
    if part.is_some() {
        return text;
    }
    let params = item.get("params");
    Some(match item.get("kind").and_then(Value::as_str) {
        Some("mark.box@1" | "mark.cylinder@1" | "mark.sphere@1") => {
            let half = match params.and_then(|p| p.get("size")) {
                Some(Value::Array(s)) if s.len() == 3 => {
                    [0, 1, 2].map(|k| s[k].as_f64().unwrap_or(0.0) / 2.0)
                }
                Some(v) => [v.as_f64().unwrap_or(0.0) / 2.0; 3],
                None => [0.5; 3],
            };
            [[-half[0], -half[1], -half[2]], half]
        }
        Some("rect@1") => match params.and_then(|p| p.get("box")).and_then(Value::as_array) {
            Some(b) if b.len() == 4 => {
                let v = |k: usize| b[k].as_f64().unwrap_or(0.0);
                [[v(0), v(1), 0.0], [v(0) + v(2), v(1) + v(3), 0.0]]
            }
            _ => [[0.0; 3]; 2],
        },
        _ => text.unwrap_or([[0.0; 3]; 2]),
    })
}

/// What a constraint reads of `x`, named at `at`: an item ID its evaluated world pose, and
/// `items/<id>/at/<group>` that group as its channels and drivers write it.
pub(crate) fn read(
    items: &[String],
    x: &str,
    at: String,
) -> Result<(usize, Option<usize>), Refused> {
    let no = |code: &'static str, path: String| Refused {
        code,
        path,
        detail: None,
    };
    let index = |id: &str, at: String| {
        let found = items.iter().position(|x| x == id);
        found.ok_or_else(|| no("ref_unresolved", at))
    };
    match x.split('/').collect::<Vec<_>>().as_slice() {
        ["items", id, "at", g] => {
            let g = ["pos", "rot", "scale"].iter().position(|n| n == g);
            let g = g.ok_or_else(|| no("bad_path", at.clone()))?;
            Ok((index(id, at)?, Some(g)))
        }
        [id] => Ok((index(id, at)?, None)),
        _ => Err(no("bad_path", at)),
    }
}

/// Where a reach's `target` aims in its item's own space: for a text's `<id>#line:n` or
/// `<id>#tok:k`, the centre of that line's or token's box; `None` for an item itself. A part of
/// an item that isn't a text, or one the text lacks, is `ref_unresolved` at `<path>/target`.
pub(crate) fn aim(
    items: &Map<String, Value>,
    target: &str,
    path: &str,
) -> Result<Option<[f64; 2]>, Refused> {
    let (id, Some(part)) = split(target) else {
        return Ok(None);
    };
    let found = items
        .get(id)
        .and_then(|item| deep_canvas_marks::lines::text_box(id, item, Some(part)));
    match found {
        Some([x, y, w, h]) => Ok(Some([x + w / 2.0, y + h / 2.0])),
        None => Err(Refused {
            code: "ref_unresolved",
            path: format!("{path}/target"),
            detail: None,
        }),
    }
}

/// `local`, a point in an item's own space, through the item's world transform slots `w`
/// (position, rotation in degrees, scale), so a reach re-solves as the text moves.
pub(crate) fn through(w: &[f64], local: [f64; 2]) -> [f64; 2] {
    let (x, y) = (local[0] * w[6], local[1] * w[7]);
    let a = deep_canvas::ops::rad(w[5]);
    let (cos, sin) = (deep_canvas::ops::cos(a), deep_canvas::ops::sin(a));
    [w[0] + x * cos - y * sin, w[1] + x * sin + y * cos]
}
