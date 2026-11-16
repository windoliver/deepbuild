//! #233: a grid frame's rules between its tracks (Pack: math@1: "table to a frame grid with
//! rules between tracks"). A `frame@1` laid out as a grid may state `rules: {lines: inner |
//! outer | both, role = ink, width = 1}`: inner rules run down the middle of each gap between
//! two columns and across the middle of each gap between two rows, the grid's full height or
//! width; outer rules run around its cells. Each is a straight line, read from where the layout
//! put the cells, so a column as wide as its widest cell keeps its rules beside it.

use std::cmp::Ordering;

use serde_json::{json, Map, Value};

use crate::scene::{num, Refused};

/// `items/<id>/params/box` as four numbers.
pub(crate) fn frame_box(id: &str, item: &Value) -> Result<[f64; 4], Refused> {
    let b: Option<Vec<f64>> = item
        .get("params")
        .and_then(|p| p.get("box"))
        .and_then(Value::as_array)
        .map(|b| b.iter().map(|v| num(Some(v))).collect())
        .unwrap_or(None);
    b.as_deref()
        .and_then(|b| <[f64; 4]>::try_from(b).ok())
        .ok_or(Refused {
            code: "bad_doc",
            path: format!("items/{id}/params/box"),
        })
}

/// IDs in order with their numbers read whole, so `t.cell.10` comes after `t.cell.9`: the order
/// a grid's cells flow in when their order keys tie, as a recipe's derived cells' do.
pub(crate) fn natural(a: &str, b: &str) -> Ordering {
    let runs = |s: &str| -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.chars() {
            let digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, run)) if *d == digit => run.push(c),
                _ => out.push((digit, c.to_string())),
            }
        }
        out
    };
    for (x, y) in runs(a).iter().zip(runs(b).iter()) {
        let o = match (x, y) {
            ((true, x), (true, y)) => (x.len(), x).cmp(&(y.len(), y)),
            ((_, x), (_, y)) => x.cmp(y),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

/// A grid's rules: each line's ends in the frame's space, with the role and width they all take.
pub(crate) struct Rules {
    pub lines: Vec<[[f64; 2]; 2]>,
    pub role: Value,
    pub width: f64,
}

/// The rules of grid frame `id`.
pub(crate) fn rules(id: &str, params: &Map<String, Value>, items: &Map<String, Value>) -> Rules {
    let r = params.get("rules");
    let mut out = Rules {
        lines: Vec::new(),
        role: r
            .and_then(|r| r.get("role"))
            .cloned()
            .unwrap_or(json!("ink")),
        width: num(r.and_then(|r| r.get("width"))).unwrap_or(1.0),
    };
    let Some(r) = r else {
        return out;
    };
    let lines = r.get("lines").and_then(Value::as_str).unwrap_or("inner");
    let cols = params
        .get("grid")
        .and_then(|g| g.get("cols"))
        .and_then(Value::as_array)
        .map_or(1, |c| c.len().max(1));
    let mut cells: Vec<(&str, &str, [f64; 4])> = items
        .iter()
        .filter(|(_, i)| i.get("parent").and_then(Value::as_str) == Some(id))
        .filter_map(|(cid, i)| {
            let order = i.get("order").and_then(Value::as_str).unwrap_or("");
            let pos = i.pointer("/at/pos");
            let [x, y] = [0, 1].map(|k| num(pos.and_then(|p| p.get(k))).unwrap_or(0.0));
            let [_, _, w, h] = frame_box(cid, i).ok()?;
            Some((order, cid.as_str(), [x, y, w, h]))
        })
        .collect();
    cells.sort_by(|a, b| a.0.cmp(b.0).then_with(|| natural(a.1, b.1)));
    if cells.is_empty() {
        return out;
    }
    let rows = cells.len().div_ceil(cols);
    // Each track's extent: [start, end] across its cells.
    let span = |pick: &dyn Fn(usize) -> bool, axis: usize| -> Option<[f64; 2]> {
        let mut out: Option<[f64; 2]> = None;
        for (k, (_, _, b)) in cells.iter().enumerate().filter(|(k, _)| pick(*k)) {
            let _ = k;
            let (a, z) = (b[axis], b[axis] + b[axis + 2]);
            out = Some(out.map_or([a, z], |o| [o[0].min(a), o[1].max(z)]));
        }
        out
    };
    let col_spans: Vec<[f64; 2]> = (0..cols)
        .filter_map(|c| span(&|k| k % cols == c, 0))
        .collect();
    let row_spans: Vec<[f64; 2]> = (0..rows)
        .filter_map(|r| span(&|k| k / cols == r, 1))
        .collect();
    let (Some(first_col), Some(last_col)) = (col_spans.first(), col_spans.last()) else {
        return out;
    };
    let (Some(first_row), Some(last_row)) = (row_spans.first(), row_spans.last()) else {
        return out;
    };
    let ([x0, x1], [y0, y1]) = ([first_col[0], last_col[1]], [first_row[0], last_row[1]]);
    if matches!(lines, "inner" | "both") {
        for w in col_spans.windows(2) {
            let x = (w[0][1] + w[1][0]) / 2.0;
            out.lines.push([[x, y0], [x, y1]]);
        }
        for w in row_spans.windows(2) {
            let y = (w[0][1] + w[1][0]) / 2.0;
            out.lines.push([[x0, y], [x1, y]]);
        }
    }
    if matches!(lines, "outer" | "both") {
        let corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        for k in 0..4 {
            out.lines.push([corners[k], corners[(k + 1) % 4]]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_in_ids_order_whole() {
        let mut ids = vec!["t.cell.10", "t.cell.2", "t.cell.1", "t.cell.11"];
        ids.sort_by(|a, b| natural(a, b));
        assert_eq!(ids, ["t.cell.1", "t.cell.2", "t.cell.10", "t.cell.11"]);
    }

    #[test]
    fn a_three_by_four_grid_has_five_inner_rules_and_four_outer() {
        let mut items = Map::new();
        for k in 0..12 {
            let (r, c) = (k / 4, k % 4);
            items.insert(
                format!("g.cell.{k}"),
                json!({"parent": "g",
                "at": {"pos": [c * 50, r * 30, 0]}, "params": {"box": [0, 0, 40, 20]}}),
            );
        }
        let grid = |lines: &str| {
            json!({"grid": {"cols": ["hug", "hug", "hug", "hug"]},
            "rules": {"lines": lines}})
            .as_object()
            .cloned()
            .unwrap()
        };
        assert_eq!(rules("g", &grid("inner"), &items).lines.len(), 5);
        assert_eq!(rules("g", &grid("outer"), &items).lines.len(), 4);
        let inner = rules("g", &grid("inner"), &items);
        // The first column rule runs down the middle of the gap from 40 to 50.
        assert_eq!(inner.lines[0], [[45.0, 0.0], [45.0, 80.0]]);
    }
}
