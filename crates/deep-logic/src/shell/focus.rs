//! Focus on a shell screen (Recipe: shell@1 game shell): viewer state that writes no entry. A screen's focus order
//! is its own `focus` list, or its controls by their evaluated boxes, rows top to bottom and then left to right; the
//! first key or pad input on a screen focuses the first enabled control, and a focused control that turns disabled
//! hands focus at that step to the next enabled one.

use super::Screen;

/// An evaluated box, `[x, y, w, h]` in the view's pixels.
pub type Box4 = [f64; 4];

/// The screen's controls in focus order, as indices into its controls; a control with no box sorts last.
pub fn order(screen: &Screen, boxes: &[Option<Box4>]) -> Vec<usize> {
    if let Some(f) = &screen.focus {
        let mut out: Vec<usize> = f.iter().filter_map(|id| screen.controls.iter().position(|c| &c.id == id)).collect();
        let rest: Vec<usize> = (0..screen.controls.len()).filter(|i| !out.contains(i)).collect();
        out.extend(rest);
        return out;
    }
    let mut placed: Vec<(usize, Box4)> = (0..screen.controls.len()).filter_map(|i| Some((i, boxes.get(i).copied().flatten()?))).collect();
    placed.sort_by(|a, b| a.1[1].total_cmp(&b.1[1]).then(a.1[0].total_cmp(&b.1[0])));
    // Rows: a control joins the row above when their vertical spans overlap by half the shorter one's height.
    let mut rows: Vec<Vec<(usize, Box4)>> = Vec::new();
    for (i, b) in placed {
        let joins = rows.last().is_some_and(|row| {
            row.iter().any(|(_, r)| {
                let overlap = (r[1] + r[3]).min(b[1] + b[3]) - r[1].max(b[1]);
                overlap >= 0.5 * r[3].min(b[3])
            })
        });
        if joins {
            rows.last_mut().expect("a row").push((i, b));
        } else {
            rows.push(vec![(i, b)]);
        }
    }
    let mut out = Vec::new();
    for mut row in rows {
        row.sort_by(|a, b| a.1[0].total_cmp(&b.1[0]));
        out.extend(row.into_iter().map(|(i, _)| i));
    }
    let rest: Vec<usize> = (0..screen.controls.len()).filter(|i| !out.contains(i)).collect();
    out.extend(rest);
    out
}

/// The next enabled control from `from` in `order`, forward or back, wrapping; the first enabled one with none.
pub fn step(order: &[usize], enabled: &[bool], from: Option<usize>, forward: bool) -> Option<usize> {
    let n = order.len();
    if n == 0 {
        return None;
    }
    let at = from.and_then(|f| order.iter().position(|i| *i == f));
    for k in 1..=n {
        let j = match (at, forward) {
            (None, _) => k - 1,
            (Some(a), true) => (a + k) % n,
            (Some(a), false) => (a + n * 2 - k) % n,
        };
        if enabled.get(order[j]).copied().unwrap_or(false) {
            return Some(order[j]);
        }
    }
    None
}

/// Focus after the controls' enabled states changed: kept on an enabled control, else the next enabled one.
pub fn settle(order: &[usize], enabled: &[bool], focus: Option<usize>) -> Option<usize> {
    match focus {
        Some(f) if enabled.get(f).copied().unwrap_or(false) => Some(f),
        Some(f) => step(order, enabled, Some(f), true),
        None => None,
    }
}
