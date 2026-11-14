//! Picks on rows and grid focus (canvas primitives: Control: picks on rows and grid focus): the
//! drawn rows of the sets a pick control names, and the moves of its roving focus over them.
//! The host reads the rows from what a frame draws, so a row that doesn't draw is never here:
//! never focused, picked or announced. Focus is viewer state and writes no entry.

use std::cmp::Ordering;

/// The wrong programs of picks on rows, chosen only by a proof scenario's `planted`: a pick
/// whose row a replay resolves again from the pointer's point, a hit test that meets rows whose
/// `alive` is false, one that takes a hex row by its quad, an export that keeps the live hover,
/// and a focus that moves over rows that don't draw.
pub const PLANTED: [&str; 5] = [
    "pick_resolves_on_replay",
    "hit_ignores_alive",
    "hit_by_quad_bounds",
    "export_keeps_live_hover",
    "focus_stops_on_hidden_rows",
];

/// A drawn row of a set a pick control names.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// The set's index in the control's `rows`.
    pub set: u8,
    /// An integer key column's value and 0, a grid's `(cx, cy)` or a fed instancer's
    /// `(slot, gen)`.
    pub key: [i64; 2],
    pub centre: [f64; 2],
    /// Whether the set is a grid, so the key is its cell `(cx, cy)`.
    pub grid: bool,
}

/// A key that moves the roving focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
}

impl Move {
    pub fn of(key: &str) -> Option<Move> {
        Some(match key {
            "ArrowLeft" | "Left" => Move::Left,
            "ArrowRight" | "Right" => Move::Right,
            "ArrowUp" | "Up" => Move::Up,
            "ArrowDown" | "Down" => Move::Down,
            "Home" => Move::Home,
            "End" => Move::End,
            _ => return None,
        })
    }
}

/// Reading order: center y, then x, then set and key.
fn reading(a: &Row, b: &Row) -> Ordering {
    a.centre[1]
        .total_cmp(&b.centre[1])
        .then(a.centre[0].total_cmp(&b.centre[0]))
        .then((a.set, a.key).cmp(&(b.set, b.key)))
}

/// The row focus starts on: the row of `start`'s key in the first set holding it, else the first
/// drawn row in reading order.
pub fn start(rows: &[Row], start: Option<[i64; 2]>) -> Option<usize> {
    let keyed = start.and_then(|k| {
        (0..rows.len())
            .filter(|i| rows[*i].key == k)
            .min_by_key(|i| rows[*i].set)
    });
    keyed.or_else(|| (0..rows.len()).min_by(|a, b| reading(&rows[*a], &rows[*b])))
}

/// Where `m` moves focus from `rows[at]`; `at` itself when there is none that way.
///
/// On a grid, Left and Right go to the nearest drawn cell that way on the focused cell's row; Up
/// and Down to the nearest row that way holding a drawn cell, at the drawn cell whose center's x
/// is nearest the focused one's, ties to the smaller cx. Off a grid the arrows follow reading
/// order. Home and End go to the first and last drawn rows.
pub fn moved(rows: &[Row], at: usize, m: Move) -> usize {
    let Some(here) = rows.get(at) else { return at };
    let order = || (0..rows.len()).filter(|i| !rows[*i].grid || !here.grid);
    let found = match m {
        Move::Home => (0..rows.len()).min_by(|a, b| reading(&rows[*a], &rows[*b])),
        Move::End => (0..rows.len()).max_by(|a, b| reading(&rows[*a], &rows[*b])),
        _ if here.grid => grid(rows, here, m),
        Move::Right | Move::Down => order()
            .filter(|i| reading(&rows[*i], here) == Ordering::Greater)
            .min_by(|a, b| reading(&rows[*a], &rows[*b])),
        Move::Left | Move::Up => order()
            .filter(|i| reading(&rows[*i], here) == Ordering::Less)
            .max_by(|a, b| reading(&rows[*a], &rows[*b])),
    };
    found.unwrap_or(at)
}

fn grid(rows: &[Row], here: &Row, m: Move) -> Option<usize> {
    let [cx, cy] = here.key;
    let cells = || (0..rows.len()).filter(|i| rows[*i].grid && rows[*i].set == here.set);
    match m {
        Move::Left => cells()
            .filter(|i| rows[*i].key[1] == cy && rows[*i].key[0] < cx)
            .max_by_key(|i| rows[*i].key[0]),
        Move::Right => cells()
            .filter(|i| rows[*i].key[1] == cy && rows[*i].key[0] > cx)
            .min_by_key(|i| rows[*i].key[0]),
        _ => {
            let row = if m == Move::Up {
                cells().map(|i| rows[i].key[1]).filter(|y| *y < cy).max()
            } else {
                cells().map(|i| rows[i].key[1]).filter(|y| *y > cy).min()
            }?;
            let off = |i: &usize| (rows[*i].centre[0] - here.centre[0]).abs();
            cells().filter(|i| rows[*i].key[1] == row).min_by(|a, b| {
                off(a)
                    .total_cmp(&off(b))
                    .then(rows[*a].key[0].cmp(&rows[*b].key[0]))
            })
        }
    }
}

/// Where focus goes when its row, `gone`, stops drawing: the nearest drawn row by center
/// distance, ties to the smaller key.
pub fn nearest(rows: &[Row], gone: &Row) -> Option<usize> {
    let d = |i: &usize| {
        let (x, y) = (
            rows[*i].centre[0] - gone.centre[0],
            rows[*i].centre[1] - gone.centre[1],
        );
        x * x + y * y
    };
    (0..rows.len()).min_by(|a, b| {
        d(a).total_cmp(&d(b))
            .then((rows[*a].key, rows[*a].set).cmp(&(rows[*b].key, rows[*b].set)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A square grid of `n` × `n` cells of 16 u, without the cells `gone`.
    fn square(n: i64, gone: &[[i64; 2]]) -> Vec<Row> {
        let mut out = Vec::new();
        for cy in 0..n {
            for cx in 0..n {
                if !gone.contains(&[cx, cy]) {
                    out.push(Row {
                        set: 0,
                        key: [cx, cy],
                        centre: [cx as f64 * 16.0 + 8.0, cy as f64 * 16.0 + 8.0],
                        grid: true,
                    });
                }
            }
        }
        out
    }

    fn walk(rows: &[Row], from: [i64; 2], keys: &[Move]) -> [i64; 2] {
        let mut at = rows.iter().position(|r| r.key == from).expect("a start");
        for m in keys {
            at = moved(rows, at, *m);
        }
        rows[at].key
    }

    #[test]
    fn arrows_walk_a_square_grid_over_drawn_cells_only() {
        let rows = square(12, &[]);
        use Move::*;
        assert_eq!(
            walk(&rows, [0, 0], &[Right, Right, Right, Down, Down]),
            [3, 2]
        );
        assert_eq!(walk(&rows, [0, 0], &[Left, Up]), [0, 0]);
        assert_eq!(walk(&rows, [5, 5], &[Home]), [0, 0]);
        assert_eq!(walk(&rows, [5, 5], &[End]), [11, 11]);
        assert_eq!(walk(&square(12, &[[1, 0]]), [0, 0], &[Right]), [2, 0]);
        assert_eq!(start(&rows, None).map(|i| rows[i].key), Some([0, 0]));
        assert_eq!(
            start(&rows, Some([4, 4])).map(|i| rows[i].key),
            Some([4, 4])
        );
    }

    /// The pointy odd hex rows: odd rows shift half a cell right; Up from (1, 1) meets (1, 0) and
    /// (2, 0) equally far in x, and the tie goes to the smaller cx.
    #[test]
    fn up_on_a_pointy_odd_hex_grid_ties_to_the_smaller_cx() {
        let mut rows = Vec::new();
        for cy in 0..6 {
            for cx in 0..6 {
                let s = if cy % 2 == 1 { 0.5 } else { 0.0 };
                rows.push(Row {
                    set: 0,
                    key: [cx, cy],
                    centre: [32.0 * (cx as f64 + s), 0.75 * 28.0 * cy as f64],
                    grid: true,
                });
            }
        }
        assert_eq!(walk(&rows, [1, 1], &[Move::Up]), [1, 0]);
        assert_eq!(walk(&rows, [1, 0], &[Move::Down]), [0, 1]);
    }

    #[test]
    fn off_a_grid_arrows_follow_reading_order_and_a_lost_row_goes_to_the_nearest() {
        let unit = |k: i64, x: f64, y: f64| Row {
            set: 1,
            key: [k, 0],
            centre: [x, y],
            grid: false,
        };
        let rows = vec![
            unit(3, 50.0, 10.0),
            unit(1, 10.0, 10.0),
            unit(2, 10.0, 40.0),
        ];
        assert_eq!(walk(&rows, [1, 0], &[Move::Right]), [3, 0]);
        assert_eq!(walk(&rows, [3, 0], &[Move::Down]), [2, 0]);
        assert_eq!(walk(&rows, [2, 0], &[Move::Up, Move::Up]), [1, 0]);
        let gone = unit(9, 30.0, 10.0);
        assert_eq!(nearest(&rows, &gone).map(|i| rows[i].key), Some([1, 0]));
    }
}
