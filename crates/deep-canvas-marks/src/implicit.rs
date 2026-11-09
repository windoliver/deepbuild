//! Issue #505: an implicit path function, `fn: {zero: g(x, y)}` (canvas primitives: Path
//! `path@1`: function), traced on an interval quadtree. A cell whose bound excludes 0 is dropped;
//! any other is split, level by level, until it is under the tolerance on both axes or the cap
//! is reached; a cell's bound is the hull of its bounds over a 4 × 4 cover of it. A cell whose
//! corners share a sign but whose bound holds 0 is split, not dropped,
//! so a loop smaller than a cell is found. The kept cells are all of the finest level, so the
//! curve runs through them by marching squares on one grid, each kept cell cut 4 × 4, its crossings placed by a secant
//! between corner samples and joined across cells into sub-paths. Past the cap the cells left
//! draw from their corner samples as an estimate, and the box they cover is named.

use std::collections::{BTreeMap, HashMap};

use deep_canvas::interval::Iv;

/// The traced curve, in the function's own x and y.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Traced {
    pub subpaths: Vec<Vec<[f64; 2]>>,
    /// The box `[x0, y0, x1, y1]` the cap left as an estimate, when it was reached.
    pub estimate: Option<[f64; 4]>,
    /// The cells the trace kept (each whose bound held 0).
    pub cells: usize,
}

/// One cell: its level and its column and row on that level's grid.
#[derive(Clone, Copy)]
struct Cell {
    level: u32,
    i: u64,
    j: u64,
}

/// The grid of the box `[x0, x1] × [y0, y1]`.
struct Grid {
    x: [f64; 2],
    y: [f64; 2],
}

impl Grid {
    fn at(&self, level: u32, i: u64, j: u64) -> [f64; 2] {
        let n = (1u64 << level) as f64;
        [
            self.x[0] + (self.x[1] - self.x[0]) * i as f64 / n,
            self.y[0] + (self.y[1] - self.y[0]) * j as f64 / n,
        ]
    }

    fn range(&self, c: Cell) -> (Iv, Iv) {
        let a = self.at(c.level, c.i, c.j);
        let b = self.at(c.level, c.i + 1, c.j + 1);
        (Iv::new(a[0], b[0]), Iv::new(a[1], b[1]))
    }
}

/// The pieces a side of a cell is cut into for its bound.
const COVER: usize = 4;

/// The deepest level the trace goes to, so a level's cells never shrink past adjacent floats.
const DEEPEST: u32 = 40;

/// `g = 0` over the box, cells split until under `tol` on each axis (the function's units for
/// 0.5 px), at most `max_cells` kept. `corner_signs` is the planted tracer that drops a cell by
/// its corners' signs alone, which a loop smaller than a cell slips past.
pub fn trace(
    g: &dyn Fn(f64, f64) -> f64,
    bound: &dyn Fn(Iv, Iv) -> Iv,
    over_x: [f64; 2],
    over_y: [f64; 2],
    tol: [f64; 2],
    max_cells: usize,
    corner_signs: bool,
) -> Traced {
    let grid = Grid {
        x: over_x,
        y: over_y,
    };
    let holds_zero = |c: Cell| -> bool {
        if corner_signs {
            let s: Vec<bool> = [(0, 0), (1, 0), (0, 1), (1, 1)]
                .iter()
                .map(|&(di, dj)| {
                    let p = grid.at(c.level, c.i + di, c.j + dj);
                    g(p[0], p[1]) > 0.0
                })
                .collect();
            return s.iter().any(|v| *v != s[0]);
        }
        // The bound over a 4 × 4 cover of the cell: still certain to hold every value g takes
        // there, and far tighter than one bound of the whole cell, so fewer cells are kept.
        let (x, y) = grid.range(c);
        let at = |r: Iv, k: usize| r.lo + (r.hi - r.lo) * k as f64 / COVER as f64;
        (0..COVER).any(|i| {
            (0..COVER).any(|j| {
                let xi = Iv::new(at(x, i), if i + 1 == COVER { x.hi } else { at(x, i + 1) });
                let yj = Iv::new(at(y, j), if j + 1 == COVER { y.hi } else { at(y, j + 1) });
                bound(xi, yj).contains(0.0)
            })
        })
    };
    let small = |level: u32| {
        let n = (1u64 << level) as f64;
        (over_x[1] - over_x[0]) / n <= tol[0] && (over_y[1] - over_y[0]) / n <= tol[1]
    };
    let mut kept = 0usize;
    let mut level_cells = vec![Cell {
        level: 0,
        i: 0,
        j: 0,
    }];
    let mut leaves: Vec<Cell> = Vec::new();
    let mut left: Vec<Cell> = Vec::new();
    while !level_cells.is_empty() {
        let level = level_cells[0].level;
        let mut next = Vec::new();
        for (k, &c) in level_cells.iter().enumerate() {
            if kept >= max_cells {
                left.extend_from_slice(&level_cells[k..]);
                break;
            }
            if !holds_zero(c) {
                continue;
            }
            kept += 1;
            if small(level) || level >= DEEPEST {
                leaves.push(c);
                continue;
            }
            for (di, dj) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                next.push(Cell {
                    level: level + 1,
                    i: 2 * c.i + di,
                    j: 2 * c.j + dj,
                });
            }
        }
        if !left.is_empty() {
            // The cap: what this level has yet to examine, and the whole next level, draw from
            // their corners as an estimate.
            left.extend(next);
            break;
        }
        level_cells = next;
    }
    // Each kept cell is marched on a 4 × 4 grid of its own, on the one lattice of the level two
    // below, so neighbours still meet edge to edge and a crossing of curves inside a cell isn't
    // cut across a whole cell.
    let fine: Vec<Cell> = leaves
        .iter()
        .flat_map(|c| {
            (0..4u64).flat_map(move |a| {
                (0..4u64).map(move |b| Cell {
                    level: c.level + 2,
                    i: 4 * c.i + a,
                    j: 4 * c.j + b,
                })
            })
        })
        .collect();
    let mut subpaths = march(&grid, &fine, g);
    let mut estimate = None;
    if !left.is_empty() {
        subpaths.extend(march(&grid, &left, g));
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for &c in &left {
            let (x, y) = grid.range(c);
            b = [
                b[0].min(x.lo),
                b[1].min(y.lo),
                b[2].max(x.hi),
                b[3].max(y.hi),
            ];
        }
        estimate = Some(b);
    }
    Traced {
        subpaths,
        estimate,
        cells: kept,
    }
}

/// An edge of a level's grid: its level, whether it runs along x, and its lower corner.
type Edge = (u32, bool, u64, u64);

/// Marching squares over `cells` (each on its own level's grid), with crossings by a secant
/// between corner samples, joined into sub-paths where cells share an edge.
fn march(grid: &Grid, cells: &[Cell], g: &dyn Fn(f64, f64) -> f64) -> Vec<Vec<[f64; 2]>> {
    let mut values: HashMap<(u32, u64, u64), f64> = HashMap::new();
    let mut value = |level: u32, i: u64, j: u64| -> f64 {
        *values.entry((level, i, j)).or_insert_with(|| {
            let p = grid.at(level, i, j);
            g(p[0], p[1])
        })
    };
    let mut points: BTreeMap<Edge, [f64; 2]> = BTreeMap::new();
    let mut segments: Vec<(Edge, Edge)> = Vec::new();
    for &c in cells {
        let (l, i, j) = (c.level, c.i, c.j);
        // Corners counterclockwise from the lower left, and the edges between them.
        let corner = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)];
        let v: Vec<f64> = corner.iter().map(|&(a, b)| value(l, a, b)).collect();
        if v.iter().any(|x| !x.is_finite()) {
            continue;
        }
        let edges: [Edge; 4] = [
            (l, true, i, j),
            (l, false, i + 1, j),
            (l, true, i, j + 1),
            (l, false, i, j),
        ];
        let mut crossing: Vec<usize> = Vec::new();
        for e in 0..4 {
            let (a, b) = (e, (e + 1) % 4);
            if (v[a] > 0.0) != (v[b] > 0.0) {
                crossing.push(e);
                points.entry(edges[e]).or_insert_with(|| {
                    let pa = grid.at(l, corner[a].0, corner[a].1);
                    let pb = grid.at(l, corner[b].0, corner[b].1);
                    let t = v[a] / (v[a] - v[b]);
                    [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]
                });
            }
        }
        match crossing.as_slice() {
            [a, b] => segments.push((edges[*a], edges[*b])),
            [a, b, c, d] => {
                // A saddle: the center's sign says which corners join.
                let p = grid.at(l + 1, 2 * i + 1, 2 * j + 1);
                let center = g(p[0], p[1]) > 0.0;
                if center == (v[0] > 0.0) {
                    segments.push((edges[*a], edges[*d]));
                    segments.push((edges[*b], edges[*c]));
                } else {
                    segments.push((edges[*a], edges[*b]));
                    segments.push((edges[*c], edges[*d]));
                }
            }
            _ => {}
        }
    }
    join(&segments, &points)
}

/// Segments joined end to end into sub-paths; a closed one repeats its first point at its end.
fn join(segments: &[(Edge, Edge)], points: &BTreeMap<Edge, [f64; 2]>) -> Vec<Vec<[f64; 2]>> {
    let mut at: HashMap<Edge, Vec<usize>> = HashMap::new();
    for (k, (a, b)) in segments.iter().enumerate() {
        at.entry(*a).or_default().push(k);
        at.entry(*b).or_default().push(k);
    }
    let mut used = vec![false; segments.len()];
    let mut out = Vec::new();
    let other = |k: usize, e: Edge| {
        if segments[k].0 == e {
            segments[k].1
        } else {
            segments[k].0
        }
    };
    // Open runs first, from an end only one segment meets, then the loops left.
    let mut starts: Vec<(Edge, usize)> = Vec::new();
    for (k, (a, b)) in segments.iter().enumerate() {
        for e in [*a, *b] {
            if at[&e].len() == 1 {
                starts.push((e, k));
            }
        }
    }
    for (k, (a, _)) in segments.iter().enumerate() {
        starts.push((*a, k));
    }
    for (start, first) in starts {
        if used[first] {
            continue;
        }
        let mut run = vec![points[&start]];
        let (mut e, mut k) = (start, first);
        loop {
            used[k] = true;
            e = other(k, e);
            run.push(points[&e]);
            match at[&e].iter().find(|&&n| !used[n]) {
                Some(&n) => k = n,
                None => break,
            }
        }
        out.push(run);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::interval::Iv;

    fn circle(cx: f64, cy: f64, r: f64) -> (impl Fn(f64, f64) -> f64, impl Fn(Iv, Iv) -> Iv) {
        (
            move |x: f64, y: f64| (x - cx) * (x - cx) + (y - cy) * (y - cy) - r * r,
            move |x: Iv, y: Iv| {
                x.sub(Iv::point(cx))
                    .sqr()
                    .add(y.sub(Iv::point(cy)).sqr())
                    .sub(Iv::point(r * r))
            },
        )
    }

    #[test]
    fn the_unit_circle_is_one_closed_loop_near_the_circle() {
        let (g, b) = circle(0.0, 0.0, 1.0);
        let t = trace(
            &g,
            &b,
            [-2.0, 2.0],
            [-2.0, 2.0],
            [0.01, 0.01],
            16_384,
            false,
        );
        assert_eq!(t.subpaths.len(), 1);
        assert!(t.estimate.is_none());
        let s = &t.subpaths[0];
        assert_eq!(s.first(), s.last());
        for p in s {
            let r = (p[0] * p[0] + p[1] * p[1]).sqrt();
            assert!((r - 1.0).abs() < 0.01, "{r}");
        }
    }

    #[test]
    fn a_loop_smaller_than_a_cell_is_found_and_the_planted_tracer_misses_it() {
        let (g, b) = circle(1.5, 0.0, 0.02);
        let honest = trace(
            &g,
            &b,
            [-2.0, 2.0],
            [-2.0, 2.0],
            [0.005, 0.005],
            16_384,
            false,
        );
        assert_eq!(honest.subpaths.len(), 1);
        let planted = trace(
            &g,
            &b,
            [-2.0, 2.0],
            [-2.0, 2.0],
            [0.005, 0.005],
            16_384,
            true,
        );
        assert!(planted.subpaths.is_empty());
    }

    #[test]
    fn the_cap_leaves_an_estimate_with_its_box() {
        let (g, b) = circle(0.0, 0.0, 1.0);
        let t = trace(&g, &b, [-2.0, 2.0], [-2.0, 2.0], [1e-6, 1e-6], 64, false);
        assert!(t.cells <= 64);
        assert!(t.estimate.is_some());
    }
}
