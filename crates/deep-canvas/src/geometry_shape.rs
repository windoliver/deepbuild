//! Issue #1700: the core's `geometry.shape` readings (canvas primitives: Check input: shape
//! readings). A surface is the triangles a check names, placed in world metres and read in f64
//! after joining positions within 1e-6 of its bounds diagonal, never by how they were built. Every
//! count comes from sorting, never hashing, so a reading is the same on every machine.

use crate::ops::{atan2, sqrt};

pub type V3 = [f64; 3];

/// The share of a surface's bounds diagonal within which two positions are one point.
pub const WELD: f64 = 1e-6;

/// How far a surface's lowest point may be from what lies below it and still rest on it, in m.
pub const TOUCH: f64 = 0.001;

/// At most this many faces are named.
const NAMED: usize = 64;

/// A direction no lattice of positions lines up across, a little shorter than 1, so two
/// positions within a distance are within it along this direction too.
const ALONG: V3 = [
    0.569_840_290_998_053_2,
    0.618_033_988_749_894_9,
    0.541_196_100_146_197,
];

/// The wrong programs #1700's criteria name, each a flag at its branch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// `holes` counts the hole contours on flat faces, not the genus.
    pub contours: bool,
    /// `volume` sums an open part's triangles anyway.
    pub sums_open: bool,
    /// A section leaves its cut segments unjoined.
    pub unjoined: bool,
    /// A probe meets each part's bounding box, not its triangles.
    pub boxes: bool,
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The box around `points`, `[lo, hi]`.
pub fn bounds(points: &[V3]) -> [V3; 2] {
    let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for p in points {
        for k in 0..3 {
            b[0][k] = b[0][k].min(p[k]);
            b[1][k] = b[1][k].max(p[k]);
        }
    }
    b
}

/// The distance within which two of `points` are one: `WELD` of their bounds diagonal.
pub fn weld_distance(points: &[V3]) -> f64 {
    if points.is_empty() {
        return 0.0;
    }
    let [lo, hi] = bounds(points);
    let d = sub(hi, lo);
    WELD * sqrt(dot(d, d))
}

fn find(root: &mut [u32], mut x: u32) -> u32 {
    while root[x as usize] != x {
        let up = root[root[x as usize] as usize];
        root[x as usize] = up;
        x = up;
    }
    x
}

/// Joins `a`'s and `b`'s sets under the lesser root, so a set's root is its first member.
fn join(root: &mut [u32], a: u32, b: u32) {
    let (ra, rb) = (find(root, a), find(root, b));
    if ra != rb {
        root[ra.max(rb) as usize] = ra.min(rb);
    }
}

/// Each member's set, numbered in the order sets first appear, and each set's first member.
fn numbered(root: &mut [u32]) -> (Vec<u32>, Vec<u32>) {
    let mut number = vec![u32::MAX; root.len()];
    let mut first = Vec::new();
    let mut out = Vec::with_capacity(root.len());
    for i in 0..root.len() as u32 {
        let r = find(root, i);
        if number[r as usize] == u32::MAX {
            number[r as usize] = first.len() as u32;
            first.push(r);
        }
        out.push(number[r as usize]);
    }
    (out, first)
}

/// Each position's point: positions within `within` of each other are one, found by a sweep in
/// the order of their distance along one direction. Points are numbered in the order their first
/// position appears; the second list is each point's first position.
pub fn weld(points: &[V3], within: f64) -> (Vec<u32>, Vec<u32>) {
    let key: Vec<f64> = points.iter().map(|p| dot(*p, ALONG)).collect();
    let mut order: Vec<u32> = (0..points.len() as u32).collect();
    order.sort_unstable_by(|a, b| key[*a as usize].total_cmp(&key[*b as usize]).then(a.cmp(b)));
    let mut root: Vec<u32> = (0..points.len() as u32).collect();
    let mut kept: Vec<u32> = Vec::new();
    let mut from = 0;
    for &i in &order {
        let (p, k) = (points[i as usize], key[i as usize]);
        while from < kept.len() && key[kept[from] as usize] < k - within {
            from += 1;
        }
        let mut same = false;
        for &j in &kept[from..] {
            let q = points[j as usize];
            let d = sub(p, q);
            if q == p || dot(d, d) <= within * within {
                join(&mut root, i, j);
                same |= q == p;
            }
        }
        if !same {
            kept.push(i);
        }
    }
    numbered(&mut root)
}

fn key(a: u32, b: u32) -> u64 {
    (u64::from(a.min(b)) << 32) | u64::from(a.max(b))
}

fn ends(k: u64) -> [u32; 2] {
    [(k >> 32) as u32, k as u32]
}

/// The next half-edge round its triangle: the one that starts where `h` ends.
fn next(h: u32) -> u32 {
    3 * (h / 3) + (h % 3 + 1) % 3
}

/// A sum that keeps what each addition rounds away.
#[derive(Clone, Copy, Default)]
struct Sum(f64, f64);

impl Sum {
    fn add(&mut self, x: f64) {
        let t = self.0 + x;
        self.1 += if self.0.abs() >= x.abs() {
            (self.0 - t) + x
        } else {
            (x - t) + self.0
        };
        self.0 = t;
    }
    fn total(&self) -> f64 {
        self.0 + self.1
    }
}

/// Why a part isn't closed: its first edge held by other than two triangles in opposite
/// directions, as two world points, and, where its winding is what's wrong, the input triangles
/// turned against the rest (at most 64).
#[derive(Clone, Debug, PartialEq)]
pub struct Open {
    pub edge: [V3; 2],
    pub faces: Vec<u32>,
}

/// A part: triangles joined across shared edges.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    /// The input triangle of its first triangle, which names it.
    pub first: u32,
    pub open: Option<Open>,
    /// Its genus from V − E + F = 2 − 2g, known when it's closed.
    pub holes: Option<u32>,
    /// Its signed volume in m³ by the divergence theorem, known when it's closed.
    pub volume: Option<f64>,
}

/// A surface read: its points, its triangles on them, and its parts.
#[derive(Clone, Debug, Default)]
pub struct Surface {
    /// Each point at its first position.
    pub points: Vec<V3>,
    /// The triangles whose three corners are three points, with each one's input index and part.
    tris: Vec<[u32; 3]>,
    source: Vec<u32>,
    part_of: Vec<u32>,
    /// Each edge's two points, once.
    edges: Vec<[u32; 2]>,
    pub weld: f64,
    pub parts: Vec<Part>,
}

impl Surface {
    /// Reads `indices`' triangles on `points` (world metres).
    pub fn read(points: &[V3], indices: &[u32], planted: Planted) -> Surface {
        let weld = weld_distance(points);
        let (point_of, first) = self::weld(points, weld);
        let mut s = Surface {
            points: first.iter().map(|&i| points[i as usize]).collect(),
            weld,
            ..Surface::default()
        };
        for (t, c) in indices.as_chunks::<3>().0.iter().enumerate() {
            let v = c.map(|i| point_of[i as usize]);
            if v[0] != v[1] && v[1] != v[2] && v[0] != v[2] {
                s.tris.push(v);
                s.source.push(t as u32);
            }
        }
        let n = s.tris.len();
        let from = |h: u32| s.tris[h as usize / 3][h as usize % 3];
        let mut half: Vec<(u64, u32)> = Vec::with_capacity(3 * n);
        for (k, v) in s.tris.iter().enumerate() {
            for j in 0..3 {
                half.push((key(v[j], v[(j + 1) % 3]), (3 * k + j) as u32));
            }
        }
        half.sort_unstable();
        // Runs of one edge: two half-edges in opposite directions are twins; anything else leaves
        // its part open, and two in one direction turn one triangle against the other.
        let mut tri_root: Vec<u32> = (0..n as u32).collect();
        let (mut twins, mut turned, mut unsound) = (Vec::new(), Vec::new(), Vec::new());
        let mut i = 0;
        while i < half.len() {
            let mut j = i + 1;
            while j < half.len() && half[j].0 == half[i].0 {
                j += 1;
            }
            let run = &half[i..j];
            s.edges.push(ends(run[0].0));
            for h in &run[1..] {
                join(&mut tri_root, run[0].1 / 3, h.1 / 3);
            }
            if let [a, b] = run {
                if from(a.1) == from(b.1) {
                    turned.push((a.1 / 3, b.1 / 3));
                } else {
                    twins.push((a.1, b.1));
                }
            }
            if run.len() != 2 || from(run[0].1) == from(run[1].1) {
                unsound.push((run[0].1 / 3, run[0].0));
            }
            i = j;
        }
        let (part_of, firsts) = numbered(&mut tri_root);
        s.part_of = part_of;
        s.parts = firsts
            .iter()
            .map(|&k| Part {
                first: s.source[k as usize],
                open: None,
                holes: None,
                volume: None,
            })
            .collect();
        unsound.sort_unstable();
        for &(k, e) in &unsound {
            let p = &mut s.parts[s.part_of[k as usize] as usize];
            if p.open.is_none() {
                p.open = Some(Open {
                    edge: ends(e).map(|v| s.points[v as usize]),
                    faces: Vec::new(),
                });
            }
        }
        if !turned.is_empty() {
            s.name_turned(&twins, &turned);
        }
        s.count_holes(&twins, planted);
        s.measure(planted);
        s
    }

    /// Each open part's triangles turned against the rest: the lesser side of an orientation
    /// flood across its edges, none where no winding agrees with every edge.
    fn name_turned(&mut self, twins: &[(u32, u32)], turned: &[(u32, u32)]) {
        let n = self.tris.len();
        let mut links: Vec<(u32, u32, bool)> = Vec::with_capacity(2 * (twins.len() + turned.len()));
        for &(a, b) in twins {
            links.extend([(a / 3, b / 3, false), (b / 3, a / 3, false)]);
        }
        for &(a, b) in turned {
            links.extend([(a, b, true), (b, a, true)]);
        }
        links.sort_unstable();
        let mut start = vec![0usize; n + 1];
        for l in &links {
            start[l.0 as usize + 1] += 1;
        }
        for k in 0..n {
            start[k + 1] += start[k];
        }
        let mut side = vec![u8::MAX; n];
        let mut bad = vec![false; self.parts.len()];
        let mut stack = Vec::new();
        for k0 in 0..n {
            let p = self.part_of[k0] as usize;
            if side[k0] != u8::MAX || self.parts[p].open.is_none() {
                continue;
            }
            side[k0] = 0;
            stack.push(k0);
            while let Some(k) = stack.pop() {
                for &(_, other, flip) in &links[start[k]..start[k + 1]] {
                    let want = side[k] ^ u8::from(flip);
                    let o = other as usize;
                    if side[o] == u8::MAX {
                        side[o] = want;
                        stack.push(o);
                    } else if side[o] != want {
                        bad[p] = true;
                    }
                }
            }
        }
        let mut count = vec![[0usize; 2]; self.parts.len()];
        for k in (0..n).filter(|&k| side[k] < 2) {
            count[self.part_of[k] as usize][side[k] as usize] += 1;
        }
        // The lesser side is the turned one; on a tie, the side the part's first isn't on.
        let turned: Vec<u8> = count.iter().map(|c| u8::from(c[1] <= c[0])).collect();
        for (k, s) in side.iter().enumerate() {
            let p = self.part_of[k] as usize;
            let Some(open) = self.parts[p]
                .open
                .as_mut()
                .filter(|o| !bad[p] && o.faces.len() < NAMED)
            else {
                continue;
            };
            if *s == turned[p] {
                open.faces.push(self.source[k]);
            }
        }
    }

    /// Each closed part's genus from V − E + F = 2 − 2g, a point counted once per fan of
    /// triangles round it; planted, the hole contours on its flat faces instead.
    fn count_holes(&mut self, twins: &[(u32, u32)], planted: Planted) {
        let n = self.tris.len();
        if planted.contours {
            let counts = self.contours(twins);
            for (p, part) in self.parts.iter_mut().enumerate() {
                part.holes = part.open.is_none().then_some(counts[p]);
            }
            return;
        }
        let mut corner: Vec<u32> = (0..3 * n as u32).collect();
        for &(a, b) in twins {
            join(&mut corner, a, next(b));
            join(&mut corner, next(a), b);
        }
        let mut seen = vec![u32::MAX; 3 * n];
        let (mut fans, mut faces) = (vec![0i64; self.parts.len()], vec![0i64; self.parts.len()]);
        for k in 0..3 * n as u32 {
            let p = self.part_of[k as usize / 3];
            faces[p as usize] += i64::from(k % 3 == 0);
            let r = find(&mut corner, k) as usize;
            if seen[r] != p {
                seen[r] = p;
                fans[p as usize] += 1;
            }
        }
        for p in 0..self.parts.len() {
            if self.parts[p].open.is_some() {
                continue;
            }
            let f = faces[p];
            let chi = fans[p] - 3 * f / 2 + f;
            self.parts[p].holes = Some(((2 - chi) / 2).max(0) as u32);
        }
    }

    /// The planted reading: per part, the hole contours of its flat regions, 1 − χ of each.
    fn contours(&self, twins: &[(u32, u32)]) -> Vec<u32> {
        let n = self.tris.len();
        let normal = |k: usize| {
            let [a, b, c] = self.tris[k].map(|v| self.points[v as usize]);
            let m = cross(sub(b, a), sub(c, a));
            let l = sqrt(dot(m, m));
            [m[0] / l, m[1] / l, m[2] / l]
        };
        let mut region: Vec<u32> = (0..n as u32).collect();
        for &(a, b) in twins {
            let (ka, kb) = (a as usize / 3, b as usize / 3);
            let (na, nb) = (normal(ka), normal(kb));
            let off = dot(
                na,
                sub(
                    self.points[self.tris[kb][0] as usize],
                    self.points[self.tris[ka][0] as usize],
                ),
            );
            if dot(na, nb) >= 1.0 - 1e-9 && off.abs() <= self.weld {
                join(&mut region, ka as u32, kb as u32);
            }
        }
        let (region, _) = numbered(&mut region);
        let mut verts: Vec<(u32, u32)> = Vec::with_capacity(3 * n);
        let mut edges: Vec<(u32, u64)> = Vec::with_capacity(3 * n);
        for (k, v) in self.tris.iter().enumerate() {
            for j in 0..3 {
                verts.push((region[k], v[j]));
                edges.push((region[k], key(v[j], v[(j + 1) % 3])));
            }
        }
        verts.sort_unstable();
        verts.dedup();
        edges.sort_unstable();
        edges.dedup();
        let r = region.iter().max().map_or(0, |m| *m as usize + 1);
        let mut chi = vec![0i64; r];
        let mut part_of_region = vec![0u32; r];
        for (k, &g) in region.iter().enumerate() {
            chi[g as usize] += 1;
            part_of_region[g as usize] = self.part_of[k];
        }
        verts.iter().for_each(|(g, _)| chi[*g as usize] += 1);
        edges.iter().for_each(|(g, _)| chi[*g as usize] -= 1);
        let mut out = vec![0u32; self.parts.len()];
        for g in 0..r {
            out[part_of_region[g] as usize] += (1 - chi[g]).max(0) as u32;
        }
        out
    }

    /// Each closed part's signed volume, Σ a·(b × c)/6 about its first point; planted, an open
    /// part's too.
    fn measure(&mut self, planted: Planted) {
        let mut origin = vec![None; self.parts.len()];
        let mut acc = vec![Sum::default(); self.parts.len()];
        for (k, v) in self.tris.iter().enumerate() {
            let p = self.part_of[k] as usize;
            if self.parts[p].open.is_some() && !planted.sums_open {
                continue;
            }
            let o = *origin[p].get_or_insert(self.points[v[0] as usize]);
            let [a, b, c] = v.map(|i| sub(self.points[i as usize], o));
            acc[p].add(dot(a, cross(b, c)) / 6.0);
        }
        for (p, a) in acc.iter().enumerate() {
            if origin[p].is_some() {
                self.parts[p].volume = Some(a.total());
            }
        }
    }

    /// Where the whole line through `from` along the unit `dir` crosses the surface, in m along
    /// `dir`, least first. Each triangle is tested in the line's own frame by three edge
    /// functions, which a shared edge gives its two triangles as exact negatives, so a line on
    /// that edge meets one of them and never slips between. Planted, each part's bounding box.
    pub fn probe(&self, from: V3, dir: V3, planted: Planted) -> Vec<f64> {
        let mut hits = Vec::new();
        if planted.boxes {
            let mut boxes = vec![[[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]]; self.parts.len()];
            for (k, v) in self.tris.iter().enumerate() {
                let b = &mut boxes[self.part_of[k] as usize];
                *b = bounds(&[
                    b[0],
                    b[1],
                    self.points[v[0] as usize],
                    self.points[v[1] as usize],
                    self.points[v[2] as usize],
                ]);
            }
            for [lo, hi] in boxes {
                let (mut near, mut far) = (f64::NEG_INFINITY, f64::INFINITY);
                for k in 0..3 {
                    if dir[k] == 0.0 {
                        if from[k] < lo[k] || from[k] > hi[k] {
                            far = f64::NEG_INFINITY;
                        }
                        continue;
                    }
                    let (a, b) = ((lo[k] - from[k]) / dir[k], (hi[k] - from[k]) / dir[k]);
                    near = near.max(a.min(b));
                    far = far.min(a.max(b));
                }
                if near <= far {
                    hits.extend([near, far]);
                }
            }
        } else {
            let kz = (0..3).fold(0, |m, k| if dir[k].abs() > dir[m].abs() { k } else { m });
            let (kx, ky) = ((kz + 1) % 3, (kz + 2) % 3);
            let (sx, sy, sz) = (dir[kx] / dir[kz], dir[ky] / dir[kz], 1.0 / dir[kz]);
            let q: Vec<V3> = self
                .points
                .iter()
                .map(|p| {
                    let a = sub(*p, from);
                    [a[kx] - sx * a[kz], a[ky] - sy * a[kz], sz * a[kz]]
                })
                .collect();
            let e = |p: V3, r: V3| p[0] * r[1] - p[1] * r[0];
            for v in &self.tris {
                let [a, b, c] = v.map(|i| q[i as usize]);
                let (u, w, x) = (e(b, c), e(c, a), e(a, b));
                if (u < 0.0 || w < 0.0 || x < 0.0) && (u > 0.0 || w > 0.0 || x > 0.0) {
                    continue;
                }
                let det = u + w + x;
                if det != 0.0 {
                    hits.push((u * a[2] + w * b[2] + x * c[2]) / det);
                }
            }
        }
        hits.sort_unstable_by(f64::total_cmp);
        hits
    }

    /// The outer tips round `axis`: the surface projected along it, the stretches of its outline
    /// on the convex hull, counted as the hull's stretches no projected edge covers. A convex
    /// outline has none; unknown where the projection has no area.
    pub fn tips(&self, axis: usize) -> Option<u32> {
        let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
        let flat: Vec<V3> = self.points.iter().map(|p| [p[i], p[j], 0.0]).collect();
        let (on, first) = weld(&flat, self.weld);
        let q: Vec<[f64; 2]> = first
            .iter()
            .map(|&k| [flat[k as usize][0], flat[k as usize][1]])
            .collect();
        let hull = hull(&q);
        let n = hull.len();
        if n < 3 {
            return None;
        }
        let c = hull.iter().fold([0.0, 0.0], |s, &h| {
            [s[0] + q[h][0] / n as f64, s[1] + q[h][1] / n as f64]
        });
        let angle = |p: [f64; 2]| atan2(p[1] - c[1], p[0] - c[0]);
        let lowest = (0..n)
            .min_by(|a, b| angle(q[hull[*a]]).total_cmp(&angle(q[hull[*b]])))
            .unwrap_or(0);
        let hull: Vec<usize> = (0..n).map(|k| hull[(lowest + k) % n]).collect();
        let at: Vec<f64> = hull.iter().map(|&h| angle(q[h])).collect();
        // Each side: its start, unit direction and length.
        let sides: Vec<([f64; 2], [f64; 2], f64)> = (0..n)
            .map(|s| {
                let (a, b) = (q[hull[s]], q[hull[(s + 1) % n]]);
                let d = [b[0] - a[0], b[1] - a[1]];
                let l = sqrt(d[0] * d[0] + d[1] * d[1]);
                (a, [d[0] / l, d[1] / l], l)
            })
            .collect();
        let w = self.weld;
        let place = |s: usize, p: [f64; 2]| -> Option<f64> {
            let (a, d, l) = sides[s];
            let r = [p[0] - a[0], p[1] - a[1]];
            let t = r[0] * d[0] + r[1] * d[1];
            ((r[0] * d[1] - r[1] * d[0]).abs() <= w && t >= -w && t <= l + w).then_some(t)
        };
        // Each projected point's sides, found by its angle round the hull's centre.
        let on_sides: Vec<Vec<(usize, f64)>> = q
            .iter()
            .map(|&p| {
                let s = at
                    .partition_point(|x| *x <= angle(p))
                    .checked_sub(1)
                    .unwrap_or(n - 1);
                [s + n - 1, s, s + 1]
                    .iter()
                    .map(|k| k % n)
                    .filter_map(|k| place(k, p).map(|t| (k, t)))
                    .collect()
            })
            .collect();
        let mut cover: Vec<Vec<(f64, f64)>> = vec![Vec::new(); n];
        for e in &self.edges {
            let (a, b) = (on[e[0] as usize] as usize, on[e[1] as usize] as usize);
            if a == b {
                continue;
            }
            for &(s, ta) in &on_sides[a] {
                if let Some(&(_, tb)) = on_sides[b].iter().find(|(k, _)| *k == s) {
                    cover[s].push((ta.min(tb), ta.max(tb)));
                }
            }
        }
        let mut gaps = 0;
        for (s, list) in cover.iter_mut().enumerate() {
            list.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
            let mut reach = 0.0_f64;
            for &(a, b) in list.iter() {
                if a > reach + w {
                    gaps += 1;
                }
                reach = reach.max(b);
            }
            if reach < sides[s].2 - w {
                gaps += 1;
            }
        }
        Some(gaps)
    }

    /// The gap from the surface's lowest points (least y) down to what lies below: the plane
    /// y = 0 with no `on`, else `on`'s surface straight below them, the nearest crossing at or
    /// below each point's height plus `TOUCH`.
    pub fn rests(&self, on: Option<&Surface>) -> Rest {
        let used: Vec<V3> = self
            .tris
            .iter()
            .flatten()
            .map(|&v| self.points[v as usize])
            .collect();
        let low = used.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
        let Some(on) = on else { return Rest::Gap(low) };
        let mut gap: Option<f64> = None;
        for p in used.iter().filter(|p| p[1] <= low + self.weld) {
            for t in on.probe(*p, [0.0, -1.0, 0.0], Planted::default()) {
                if t >= -TOUCH {
                    gap = Some(gap.map_or(t, |g| g.min(t)));
                }
            }
        }
        if let Some(g) = gap {
            return Rest::Gap(g);
        }
        let ([alo, ahi], [blo, bhi]) = (bounds(&self.points), bounds(&on.points));
        let under = alo[0] <= bhi[0]
            && blo[0] <= ahi[0]
            && alo[2] <= bhi[2]
            && blo[2] <= ahi[2]
            && blo[1] <= low + TOUCH;
        if under {
            Rest::Unknown
        } else {
            Rest::Nothing
        }
    }
}

/// What `rests` found below a surface.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rest {
    /// The gap in m, negative where the surface sinks into what's below.
    Gap(f64),
    /// Nothing lies below it.
    Nothing,
    /// Something lies under it, but under none of its lowest points.
    Unknown,
}

/// The convex hull of `q`, counter-clockwise, with no point on a side between its corners.
fn hull(q: &[[f64; 2]]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..q.len()).collect();
    order.sort_unstable_by(|a, b| {
        q[*a][0]
            .total_cmp(&q[*b][0])
            .then(q[*a][1].total_cmp(&q[*b][1]))
    });
    let turn = |o: usize, a: usize, b: usize| {
        (q[a][0] - q[o][0]) * (q[b][1] - q[o][1]) - (q[a][1] - q[o][1]) * (q[b][0] - q[o][0])
    };
    let chain = |pts: &mut dyn Iterator<Item = usize>| {
        let mut h: Vec<usize> = Vec::new();
        for p in pts {
            while h.len() >= 2 && turn(h[h.len() - 2], h[h.len() - 1], p) <= 0.0 {
                h.pop();
            }
            h.push(p);
        }
        h.pop();
        h
    };
    let mut h = chain(&mut order.iter().copied());
    h.extend(chain(&mut order.iter().rev().copied()));
    h
}

/// A loop where a plane cuts a surface: its area and centroid.
#[derive(Clone, Debug, PartialEq)]
pub struct Loop {
    pub area: f64,
    pub centroid: V3,
}

/// A section: its closed loops, by centroid, and how many cut chains don't close.
#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub loops: Vec<Loop>,
    pub open: u32,
}

/// Where the plane across `axis` at `at` cuts `indices`' triangles on `points` (world metres).
/// Only the triangles near the plane are welded; a point on the plane counts as above it, each
/// cut triangle gives one segment between the two edges it crosses, and segments join by those
/// edges, never by distance. Planted, the segments are left unjoined.
pub fn section(points: &[V3], indices: &[u32], axis: usize, at: f64, planted: Planted) -> Section {
    let w = weld_distance(points);
    let h = |p: &V3| p[axis] - at;
    let local: Vec<V3> = indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|c| {
            let hs = c.map(|i| h(&points[i as usize]));
            hs.iter().copied().fold(f64::INFINITY, f64::min) <= w
                && hs.iter().copied().fold(f64::NEG_INFINITY, f64::max) >= -w
        })
        .flat_map(|c| [c[0], c[1], c[2]].map(|i| points[i as usize]))
        .collect();
    let (point_of, first) = weld(&local, w);
    let above: Vec<bool> = first
        .iter()
        .map(|&i| h(&local[i as usize]) >= 0.0)
        .collect();
    let mut segs: Vec<[u64; 2]> = Vec::new();
    for &v in point_of.as_chunks::<3>().0 {
        if v[0] == v[1] || v[1] == v[2] || v[0] == v[2] {
            continue;
        }
        let crossed: Vec<u64> = (0..3)
            .filter(|&j| above[v[j] as usize] != above[v[(j + 1) % 3] as usize])
            .map(|j| key(v[j], v[(j + 1) % 3]))
            .collect();
        if let [a, b] = crossed[..] {
            segs.push([a, b]);
        }
    }
    if planted.unjoined {
        return Section {
            loops: Vec::new(),
            open: segs.len() as u32,
        };
    }
    let mut nodes: Vec<u64> = segs.iter().flatten().copied().collect();
    nodes.sort_unstable();
    nodes.dedup();
    let node = |k: u64| nodes.binary_search(&k).unwrap_or(0) as u32;
    let mut root: Vec<u32> = (0..nodes.len() as u32).collect();
    let mut links = vec![Vec::new(); nodes.len()];
    for s in &segs {
        let (a, b) = (node(s[0]), node(s[1]));
        join(&mut root, a, b);
        links[a as usize].push(b);
        links[b as usize].push(a);
    }
    let (comp, firsts) = numbered(&mut root);
    let mut closes = vec![true; firsts.len()];
    for (k, l) in links.iter().enumerate() {
        closes[comp[k] as usize] &= l.len() == 2;
    }
    let cut = |k: u64| {
        let [u, v] = ends(k).map(|x| local[first[x as usize] as usize]);
        let t = h(&u) / (h(&u) - h(&v));
        let mut p = [
            u[0] + t * (v[0] - u[0]),
            u[1] + t * (v[1] - u[1]),
            u[2] + t * (v[2] - u[2]),
        ];
        p[axis] = at;
        p
    };
    let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut loops = Vec::new();
    for (c, &start) in firsts.iter().enumerate() {
        if !closes[c] {
            continue;
        }
        let mut ring = vec![start];
        let (mut prev, mut cur) = (u32::MAX, start);
        loop {
            let l = &links[cur as usize];
            let nxt = if l[0] != prev { l[0] } else { l[1] };
            if nxt == start {
                break;
            }
            ring.push(nxt);
            (prev, cur) = (cur, nxt);
        }
        let pts: Vec<V3> = ring.iter().map(|&k| cut(nodes[k as usize])).collect();
        let o = pts[0];
        let d: Vec<[f64; 2]> = pts.iter().map(|p| [p[i] - o[i], p[j] - o[j]]).collect();
        let (mut a2, mut cx, mut cy) = (0.0, 0.0, 0.0);
        for k in 1..d.len().saturating_sub(1) {
            let (p, r) = (d[k], d[k + 1]);
            let x = p[0] * r[1] - p[1] * r[0];
            a2 += x;
            cx += x * (p[0] + r[0]) / 3.0;
            cy += x * (p[1] + r[1]) / 3.0;
        }
        let mut centroid = [0.0; 3];
        centroid[axis] = at;
        centroid[i] = if a2 != 0.0 { o[i] + cx / a2 } else { o[i] };
        centroid[j] = if a2 != 0.0 { o[j] + cy / a2 } else { o[j] };
        loops.push(Loop {
            area: a2.abs() / 2.0,
            centroid,
        });
    }
    loops.sort_by(|a, b| {
        (0..3).fold(std::cmp::Ordering::Equal, |o, k| {
            o.then(a.centroid[k].total_cmp(&b.centroid[k]))
        })
    });
    Section {
        open: closes.iter().filter(|c| !**c).count() as u32,
        loops,
    }
}
