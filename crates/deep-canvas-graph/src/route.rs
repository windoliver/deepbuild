//! Routes `route@1` (canvas primitives: Route): orthogonal routes that keep `clearance` from every
//! node, node label and frame title, found by A* over a sparse grid made from the obstacles' box
//! edges, with a bend penalty, no doubling back, and a cost on running along a route already
//! placed, so two edges share at most one segment. Routes are placed in edge-ID order, so the same
//! boxes give the same bytes.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

/// A box to keep clear of: its owner's ID and `[x, y, w, h]` in u.
#[derive(Clone, Debug, PartialEq)]
pub struct Obstacle {
    pub id: String,
    pub rect: [f64; 4],
}

/// One edge to route between two boxes, leaving `a` by `a_side` and entering `b` by `b_side`.
#[derive(Clone, Debug, PartialEq)]
pub struct Ask {
    pub id: String,
    pub a: [f64; 4],
    pub b: [f64; 4],
    pub a_side: Side,
    pub b_side: Side,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    N,
    E,
    S,
    W,
}

impl Side {
    pub fn read(s: &str) -> Option<Side> {
        Some(match s {
            "n" => Side::N,
            "e" => Side::E,
            "s" => Side::S,
            "w" => Side::W,
            _ => return None,
        })
    }

    fn out(self) -> (f64, f64) {
        match self {
            Side::N => (0.0, -1.0),
            Side::E => (1.0, 0.0),
            Side::S => (0.0, 1.0),
            Side::W => (-1.0, 0.0),
        }
    }
}

/// A point in u.
pub type Point = (f64, f64);

/// Every edge's route by edge ID, and the edges that found no way through.
pub type Routes = (BTreeMap<String, Vec<Point>>, Vec<String>);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Style {
    pub clearance: f64,
    /// What one bend costs, in u of length.
    pub bend: f64,
}

/// What a route that runs along one already placed costs per u, beyond its length.
const SHARED: f64 = 8.0;

/// The point where a side's port sits: spread over the side when several edges leave it.
fn port(rect: [f64; 4], side: Side, slot: usize, slots: usize) -> (f64, f64) {
    let f = (slot as f64 + 1.0) / (slots as f64 + 1.0);
    let [x, y, w, h] = rect;
    match side {
        Side::N => (x + w * f, y),
        Side::S => (x + w * f, y + h),
        Side::W => (x, y + h * f),
        Side::E => (x + w, y + h * f),
    }
}

/// Whether `v` is strictly inside the span from `lo` over `len`, grown by the clearance `c`.
fn within(lo: f64, len: f64, c: f64, v: f64) -> bool {
    const EPS: f64 = 1e-9;
    v > lo - c + EPS && v < lo + len + c - EPS
}

fn inside(rect: &[f64; 4], c: f64, p: (f64, f64)) -> bool {
    within(rect[0], rect[2], c, p.0) && within(rect[1], rect[3], c, p.1)
}

#[derive(Clone, Copy, PartialEq)]
struct Open {
    cost: f64,
    at: usize,
    dir: u8,
}

impl Eq for Open {}

impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.at.cmp(&self.at))
            .then_with(|| other.dir.cmp(&self.dir))
    }
}

impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Every edge's route as a polyline of corner points, from `a`'s port to `b`'s, in u. An edge
/// with no way through comes back as the straight line between its ports, named in `blocked`.
pub fn route(asks: &[Ask], obstacles: &[Obstacle], style: Style) -> Routes {
    // Ports spread over each box side in the order the edges reach it.
    let mut slots: BTreeMap<(String, u8), usize> = BTreeMap::new();
    let key = |r: &[f64; 4], s: Side| (format!("{:?}", r), s as u8);
    for ask in asks {
        *slots.entry(key(&ask.a, ask.a_side)).or_default() += 1;
        *slots.entry(key(&ask.b, ask.b_side)).or_default() += 1;
    }
    let mut taken: BTreeMap<(String, u8), usize> = BTreeMap::new();
    let mut used: Vec<(Point, Point)> = Vec::new();
    let mut out = BTreeMap::new();
    let mut blocked = Vec::new();
    for ask in asks {
        let mut end = |r: &[f64; 4], s: Side| {
            let k = key(r, s);
            let slot = taken.entry(k.clone()).or_default();
            let p = port(*r, s, *slot, slots[&k]);
            *slot += 1;
            p
        };
        let pa = end(&ask.a, ask.a_side);
        let pb = end(&ask.b, ask.b_side);
        let stub = |p: (f64, f64), s: Side| {
            let (dx, dy) = s.out();
            (p.0 + dx * style.clearance, p.1 + dy * style.clearance)
        };
        let (sa, sb) = (stub(pa, ask.a_side), stub(pb, ask.b_side));
        let path = search(sa, sb, ask, obstacles, &used, style);
        let points = match path {
            Some(mut mid) => {
                mid.insert(0, pa);
                mid.push(pb);
                simplify(mid)
            }
            None => {
                blocked.push(ask.id.clone());
                vec![pa, pb]
            }
        };
        for w in points.windows(2) {
            used.push((w[0], w[1]));
        }
        out.insert(ask.id.clone(), points);
    }
    (out, blocked)
}

/// A* from one stub to the other over the grid of obstacle edges, the stubs' lines and the lanes
/// halfway between them.
fn search(
    from: (f64, f64),
    to: (f64, f64),
    ask: &Ask,
    obstacles: &[Obstacle],
    used: &[(Point, Point)],
    style: Style,
) -> Option<Vec<(f64, f64)>> {
    let c = style.clearance;
    let mut rects: Vec<[f64; 4]> = obstacles.iter().map(|o| o.rect).collect();
    rects.push(ask.a);
    rects.push(ask.b);
    let lanes = |pick: fn(&[f64; 4]) -> (f64, f64), ends: [f64; 2]| {
        let mut v: Vec<f64> = ends.to_vec();
        for r in &rects {
            let (lo, hi) = pick(r);
            v.push(lo - c);
            v.push(hi + c);
        }
        v.sort_by(f64::total_cmp);
        v.dedup_by(|p, q| (*p - *q).abs() < 1e-9);
        let mids: Vec<f64> = v.windows(2).map(|w| (w[0] + w[1]) / 2.0).collect();
        v.extend(mids);
        v.sort_by(f64::total_cmp);
        v
    };
    let xs = lanes(|r| (r[0], r[0] + r[2]), [from.0, to.0]);
    let ys = lanes(|r| (r[1], r[1] + r[3]), [from.1, to.1]);
    let (nx, ny) = (xs.len(), ys.len());
    let at = |i: usize, j: usize| j * nx + i;
    let free = |p: (f64, f64)| !rects.iter().any(|r| inside(r, c, p));
    // A box blocks the lanes inside its two spans: each box marks its own cells, where
    // asking every cell about every box was cubic in the boxes.
    let mut ok = vec![true; nx * ny];
    let mut columns: Vec<usize> = Vec::new();
    for r in &rects {
        columns.clear();
        columns.extend((0..nx).filter(|&i| within(r[0], r[2], c, xs[i])));
        if columns.is_empty() {
            continue;
        }
        for j in (0..ny).filter(|&j| within(r[1], r[3], c, ys[j])) {
            for &i in &columns {
                ok[at(i, j)] = false;
            }
        }
    }
    let find = |v: &[f64], x: f64| v.iter().position(|&p| (p - x).abs() < 1e-9);
    let start = at(find(&xs, from.0)?, find(&ys, from.1)?);
    let goal = at(find(&xs, to.0)?, find(&ys, to.1)?);
    if !ok[start] || !ok[goal] {
        return None;
    }
    let shared = |p: (f64, f64), q: (f64, f64)| {
        used.iter().any(|&(u, v)| {
            let along_x =
                (p.1 - q.1).abs() < 1e-9 && (u.1 - v.1).abs() < 1e-9 && (p.1 - u.1).abs() < 1e-9;
            let along_y =
                (p.0 - q.0).abs() < 1e-9 && (u.0 - v.0).abs() < 1e-9 && (p.0 - u.0).abs() < 1e-9;
            let overlap = |a: f64, b: f64, c: f64, d: f64| {
                a.min(b).max(c.min(d)) < a.max(b).min(c.max(d)) - 1e-9
            };
            (along_x && overlap(p.0, q.0, u.0, v.0)) || (along_y && overlap(p.1, q.1, u.1, v.1))
        })
    };
    // Directions: 0 east, 1 south, 2 west, 3 north; 4 for the start, which any step may leave.
    const STEPS: [(isize, isize); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];
    let h = |k: usize| (xs[k % nx] - to.0).abs() + (ys[k / nx] - to.1).abs();
    let mut best = vec![f64::INFINITY; nx * ny * 5];
    let mut back: Vec<Option<(usize, u8)>> = vec![None; nx * ny * 5];
    let mut heap = BinaryHeap::new();
    best[start * 5 + 4] = 0.0;
    heap.push(Open {
        cost: h(start),
        at: start,
        dir: 4,
    });
    while let Some(Open { at: k, dir, .. }) = heap.pop() {
        if k == goal {
            let mut path = vec![(xs[k % nx], ys[k / nx])];
            let mut state = (k, dir);
            while let Some(prev) = back[state.0 * 5 + state.1 as usize] {
                path.push((xs[prev.0 % nx], ys[prev.0 / nx]));
                state = prev;
            }
            path.reverse();
            return Some(path);
        }
        let g = best[k * 5 + dir as usize];
        let (i, j) = ((k % nx) as isize, (k / nx) as isize);
        for (d, &(dx, dy)) in STEPS.iter().enumerate() {
            if dir < 4 && (d as u8 + 2) % 4 == dir {
                continue;
            }
            let (ni, nj) = (i + dx, j + dy);
            if ni < 0 || nj < 0 || ni >= nx as isize || nj >= ny as isize {
                continue;
            }
            let nk = at(ni as usize, nj as usize);
            let (p, q) = ((xs[k % nx], ys[k / nx]), (xs[nk % nx], ys[nk / nx]));
            if !ok[nk] || !free(((p.0 + q.0) / 2.0, (p.1 + q.1) / 2.0)) {
                continue;
            }
            let len = (q.0 - p.0).abs() + (q.1 - p.1).abs();
            let mut cost = g + len;
            if dir < 4 && dir != d as u8 {
                cost += style.bend;
            }
            if shared(p, q) {
                cost += SHARED * len;
            }
            let slot = nk * 5 + d;
            if cost < best[slot] - 1e-12 {
                best[slot] = cost;
                back[slot] = Some((k, dir));
                heap.push(Open {
                    cost: cost + h(nk),
                    at: nk,
                    dir: d as u8,
                });
            }
        }
    }
    None
}

/// Drops the points that lie on a straight run, keeping the corners.
fn simplify(points: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for p in points {
        if out.last().is_some_and(|&q| q == p) {
            continue;
        }
        if out.len() >= 2 {
            let (a, b) = (out[out.len() - 2], out[out.len() - 1]);
            let line = ((a.0 - b.0).abs() < 1e-9 && (b.0 - p.0).abs() < 1e-9)
                || ((a.1 - b.1).abs() < 1e-9 && (b.1 - p.1).abs() < 1e-9);
            if line {
                out.pop();
            }
        }
        out.push(p);
    }
    out
}
