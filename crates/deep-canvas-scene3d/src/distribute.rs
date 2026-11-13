//! Issue #2013: `distribute` (canvas primitives: Attribute and field: distribute), the points an
//! instancer's `from` lays out over a part's faces. A seeded Poisson-disk or sample-elimination
//! sampler keeps them `min_distance` apart, the density field thins them, each is projected onto
//! the surfaces `project` names, and `prune` drops the elements whose prototype bounds would
//! overlap. Every draw is a hash of the seed and a counter or an element's ID, in f64 through
//! the ops module, and elements are taken in ID order, so the points are the same on every
//! machine and however the document lists its items. It runs when a revision is read, never per
//! element per frame.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashMap};
use std::sync::Arc;

use deep_canvas::expr::{Expr, Nothing, V};
use deep_canvas::geometry_audit::{depth, Shape, V3};
use deep_canvas::ops::{cos, powi, rad, sin, sqrt, TAU};
use deep_canvas::registry::Registrar;
use deep_canvas::schedule::{Canonical, HashVersion, Hasher, OpError, Val, View};
use serde_json::{json, Value};

use crate::builders::mix64;
use crate::geom::{add, cross, dot, length, scale, sub};
use crate::rest::turn_onto;
use crate::scene::{apply, Affine3, Refused};

/// #2013's wrong program (a proof surface's `planted`): the sampler stops after 10 points.
pub const STOPS_AFTER_10: &str = "distribute_stops_after_10_points";
/// The fields a `distribute` takes.
const FIELDS: [&str; 14] = [
    "on",
    "mode",
    "spacing",
    "min_distance",
    "margin",
    "density",
    "prune",
    "avoid",
    "project",
    "scale",
    "yaw",
    "tilt",
    "max",
    "seed",
];
/// Darts thrown per disc the area could hold, before the gaps are filled.
const DARTS: f64 = 24.0;
/// The gap fill's lattice step, as a share of the minimum distance: every point of the area then
/// lies within 1.28 minimum distances of an element.
const FILL: f64 = 0.25;
/// The most candidates a sampler tries.
const MOST: u64 = 8_000_000;
const UP: V3 = [0.0, 1.0, 0.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Grid,
    Random,
    Poisson,
    Elimination,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Prune {
    None,
    LargerFirst,
    SmallerFirst,
    Equal,
}

/// One triangle of the part the points lie on, in the world, with its unit normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tri {
    pub p: [V3; 3],
    pub n: V3,
}

impl Tri {
    pub fn new(p: [V3; 3]) -> Option<Tri> {
        let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
        let l = length(n);
        (l > 1e-18).then(|| Tri {
            p,
            n: scale(n, 1.0 / l),
        })
    }

    fn area(&self) -> f64 {
        length(cross(sub(self.p[1], self.p[0]), sub(self.p[2], self.p[0]))) / 2.0
    }
}

/// What a scatter reads of its document, resolved to the world: the faces of `on`, the true
/// shapes it avoids and projects onto, each prototype's bounds in its own space, the instancer's
/// world transform, its ID and the planted program, if any.
pub struct Scene<'a> {
    pub on: Vec<Tri>,
    pub avoid: Vec<Shape>,
    pub project: Vec<Shape>,
    pub protos: Vec<[V3; 2]>,
    pub world: Affine3,
    pub id: &'a str,
    pub planted: Option<&'a str>,
}

/// One element: its stable ID, its prototype's index in `of`, its point in the instancer's
/// space, its turn about +Y in degrees, its whole rotation (rows) where it also tilts or aligns,
/// and its scale.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: u32,
    pub proto: usize,
    pub pos: V3,
    pub yaw: f64,
    pub turn: Option<[V3; 3]>,
    pub scale: f64,
}

impl Row {
    /// Its rotation, rows.
    fn rotation(&self) -> [V3; 3] {
        self.turn.unwrap_or_else(|| about_y(self.yaw))
    }

    /// Its transform in the instancer's space: T · R · S.
    pub fn at(&self) -> Affine3 {
        let r = self.rotation();
        let mut m = [[0.0; 4]; 3];
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] = r[i][j] * self.scale;
            }
            m[i][3] = self.pos[i];
        }
        m
    }

    /// The instancer's columns for this element: `{id, proto, pos, yaw, scale}`, with `rot`, a
    /// quaternion `[x, y, z, w]`, where it tilts or aligns.
    pub fn to_json(&self) -> Value {
        let mut out = json!({"id": self.id, "proto": self.proto, "pos": self.pos, "yaw": self.yaw, "scale": self.scale});
        if let Some(r) = &self.turn {
            out["rot"] = json!(quat_of(r));
        }
        out
    }
}

/// A turn of `deg` about +Y, rows, as an instancer's `yaw` column turns an element.
fn about_y(deg: f64) -> [V3; 3] {
    let (c, s) = (cos(rad(deg)), sin(rad(deg)));
    [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]
}

fn times(a: &[V3; 3], b: &[V3; 3]) -> [V3; 3] {
    let mut out = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

/// A rotation (rows) as a unit quaternion `[x, y, z, w]`.
fn quat_of(r: &[V3; 3]) -> [f64; 4] {
    let trace = r[0][0] + r[1][1] + r[2][2];
    if trace > 0.0 {
        let s = sqrt(trace + 1.0) * 2.0;
        return [
            (r[2][1] - r[1][2]) / s,
            (r[0][2] - r[2][0]) / s,
            (r[1][0] - r[0][1]) / s,
            s / 4.0,
        ];
    }
    let i = if r[0][0] >= r[1][1] && r[0][0] >= r[2][2] {
        0
    } else if r[1][1] >= r[2][2] {
        1
    } else {
        2
    };
    let (j, k) = ((i + 1) % 3, (i + 2) % 3);
    let s = sqrt(1.0 + r[i][i] - r[j][j] - r[k][k]) * 2.0;
    let mut q = [0.0; 4];
    q[i] = s / 4.0;
    q[j] = (r[j][i] + r[i][j]) / s;
    q[k] = (r[k][i] + r[i][k]) / s;
    q[3] = (r[k][j] - r[j][k]) / s;
    q
}

// ---- seeded draws: each a hash of the stream's key and a counter, so none depends on how many
// came before it

/// The scatter's key: hash@1 of its `seed`, or of the instancer's ID where it names none.
fn key_of(seed: Option<u64>, id: &str) -> u64 {
    let mut h = Hasher::of(HashVersion::V1, "scene3d.distribute");
    match seed {
        Some(s) => h.bytes(&s.to_le_bytes()),
        None => h.text(id),
    };
    let k = h.finish().0;
    u64::from_le_bytes([k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7]])
}

/// Draw `n` of stream `stream`, in [0, 1).
fn draw(key: u64, stream: u64, n: u64) -> f64 {
    let x = mix64(mix64(key ^ mix64(stream)) ^ n);
    (x >> 11) as f64 / (1u64 << 53) as f64
}

const CANDIDATES: u64 = 1;
const DENSITY: u64 = 2;
const PROTO: u64 = 3;
const SCALE: u64 = 4;
const YAW: u64 = 5;
const TILT: u64 = 6;
const TILT_WAY: u64 = 7;

// ---- the area

/// The faces with their running areas, so a draw picks a face by its area, and the box they lie
/// in.
struct Area<'a> {
    tris: &'a [Tri],
    run: Vec<f64>,
    total: f64,
    bounds: [V3; 2],
}

impl<'a> Area<'a> {
    fn of(tris: &'a [Tri]) -> Area<'a> {
        let mut run = Vec::with_capacity(tris.len());
        let mut total = 0.0;
        for t in tris {
            total += t.area();
            run.push(total);
        }
        let bounds = bounds(tris.iter().flat_map(|t| t.p));
        Area {
            tris,
            run,
            total,
            bounds,
        }
    }

    /// Candidate `n`: a point drawn uniformly over the area, with its face.
    fn candidate(&self, key: u64, n: u64) -> (V3, u32) {
        let r = draw(key, CANDIDATES, 3 * n) * self.total;
        let i = self
            .run
            .partition_point(|x| *x < r)
            .min(self.tris.len() - 1);
        let [a, b, c] = self.tris[i].p;
        let (u, v) = (
            sqrt(draw(key, CANDIDATES, 3 * n + 1)),
            draw(key, CANDIDATES, 3 * n + 2),
        );
        (
            add(
                add(scale(a, 1.0 - u), scale(b, u * (1.0 - v))),
                scale(c, u * v),
            ),
            i as u32,
        )
    }
}

/// The most cells [`Cells`] lays out as a grid; past it, each cell is kept by its key.
const GRID: usize = 1 << 22;

/// The accepted points in cells one minimum distance wide: a point's neighbours within that
/// distance lie in its cell and the 26 around it. The cells over the bounds the points lie in
/// are a flat grid, each a list through `next` that carries each point with its position, and a
/// look round starts at the point's own cell (#2017: a scatter's 3.4 million darts each look
/// round); a point past the bounds, or every point where the grid would pass [`GRID`] cells, is
/// kept by its cell's key.
struct Cells {
    cell: f64,
    /// The grid's least cell and its cells along each axis.
    lo: [i64; 3],
    size: [i64; 3],
    /// Each grid cell's last point, plus 1 (0 for none), and each point's one before it in its
    /// cell, plus 1, with its position.
    head: Vec<u32>,
    next: Vec<(u32, V3)>,
    map: HashMap<[i64; 3], Vec<(u32, V3)>>,
}

impl Cells {
    /// Cells `cell` wide, laid out as a grid over the box `[lo, hi]`.
    fn new(cell: f64, [lo, hi]: [V3; 2]) -> Cells {
        let at = |p: V3| p.map(|x| (x / cell).floor() as i64);
        let (a, b) = (at(lo), at(hi));
        let size: [i64; 3] =
            std::array::from_fn(|k| b[k].checked_sub(a[k]).map_or(0, |d| d.saturating_add(1)));
        let count = size.iter().try_fold(1usize, |n, s| {
            usize::try_from(*s).ok().and_then(|s| n.checked_mul(s))
        });
        Cells {
            cell,
            lo: a,
            size,
            head: match count {
                Some(n) if n <= GRID => vec![0; n],
                _ => Vec::new(),
            },
            next: Vec::new(),
            map: HashMap::new(),
        }
    }

    fn at(&self, p: V3) -> [i64; 3] {
        p.map(|x| (x / self.cell).floor() as i64)
    }

    /// The grid's index of cell `c`; none past the grid.
    fn slot(&self, c: [i64; 3]) -> Option<usize> {
        if self.head.is_empty() {
            return None;
        }
        let mut k = 0;
        for a in 0..3 {
            let d = c[a]
                .checked_sub(self.lo[a])
                .filter(|d| (0..self.size[a]).contains(d))?;
            k = k * self.size[a] + d;
        }
        usize::try_from(k).ok()
    }

    fn insert(&mut self, i: u32, p: V3) {
        let c = self.at(p);
        match self.slot(c) {
            Some(k) => {
                let at = i as usize;
                if self.next.len() <= at {
                    self.next.resize(at + 1, (0, [0.0; 3]));
                }
                self.next[at] = (self.head[k], p);
                self.head[k] = i + 1;
            }
            None => self.map.entry(c).or_default().push((i, p)),
        }
    }

    /// Whether `hit` holds for a point of grid cell `k`, with its position.
    fn walk(&self, k: usize, hit: &mut impl FnMut(u32, V3) -> bool) -> bool {
        let mut at = self.head[k];
        while at != 0 {
            let (before, q) = self.next[at as usize - 1];
            if hit(at - 1, q) {
                return true;
            }
            at = before;
        }
        false
    }

    /// Whether `hit` holds for a point in the cells around `p`, with its position: it stops at
    /// the first that does.
    fn any(&self, p: V3, mut hit: impl FnMut(u32, V3) -> bool) -> bool {
        let c = self.at(p);
        if !self.head.is_empty() {
            let own = self.slot(c);
            if own.is_some_and(|k| self.walk(k, &mut hit)) {
                return true;
            }
            // The grid's other cells among the 27, by their offsets from its least cell.
            let span = |a: usize| {
                let from = c[a].saturating_sub(1).saturating_sub(self.lo[a]).max(0);
                let to = c[a]
                    .saturating_add(1)
                    .saturating_sub(self.lo[a])
                    .min(self.size[a] - 1);
                from..=to
            };
            for x in span(0) {
                for y in span(1) {
                    let row = (x * self.size[1] + y) * self.size[2];
                    for z in span(2) {
                        let k = (row + z) as usize;
                        if own != Some(k) && self.walk(k, &mut hit) {
                            return true;
                        }
                    }
                }
            }
        }
        if self.map.is_empty() {
            return false;
        }
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let n = [c[0] + dx, c[1] + dy, c[2] + dz];
                    if self.slot(n).is_none() {
                        if let Some(list) = self.map.get(&n) {
                            if list.iter().any(|(i, q)| hit(*i, *q)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        false
    }

    /// Each point in the cells around `p`, with its position.
    fn around(&self, p: V3, mut visit: impl FnMut(u32, V3)) {
        self.any(p, |i, q| {
            visit(i, q);
            false
        });
    }

    /// Whether a point lies closer to `p` than the distance whose square is `r2`.
    fn crowded(&self, p: V3, r2: f64) -> bool {
        self.any(p, |_, q| {
            let d = sub(q, p);
            dot(d, d) < r2
        })
    }
}

/// The most cubes [`Covered`] keeps a bit for; past it, it holds none.
const COVERED: usize = 1 << 26;

/// Cubes a quarter of `r` wide over the bounds the points lie in, each marked once every corner
/// of it lies within `r` of a kept point, its square short of `r²` by a millionth: a point in a
/// marked cube is closer than `r` to a kept one, so it is crowded without a look round (#2017:
/// nine darts in ten of a 100,000-point scatter). The margin leaves no rounding that could mark
/// a cube a look round would find room in.
struct Covered {
    r: f64,
    side: f64,
    lo: [i64; 3],
    size: [i64; 3],
    bits: Vec<u64>,
}

impl Covered {
    fn new(r: f64, [lo, hi]: [V3; 2]) -> Covered {
        let side = r / 4.0;
        let at = |p: V3| p.map(|x| (x / side).floor() as i64);
        let (a, b) = (at(lo), at(hi));
        let size: [i64; 3] =
            std::array::from_fn(|k| b[k].checked_sub(a[k]).map_or(0, |d| d.saturating_add(1)));
        let count = size.iter().try_fold(1usize, |n, s| {
            usize::try_from(*s).ok().and_then(|s| n.checked_mul(s))
        });
        let bits = match count {
            Some(n) if r > 0.0 && n <= COVERED => vec![0; n.div_ceil(64)],
            _ => Vec::new(),
        };
        Covered {
            r,
            side,
            lo: a,
            size,
            bits,
        }
    }

    /// The bit of the cube at index `c`; none past the bounds.
    fn bit(&self, c: [i64; 3]) -> Option<usize> {
        let mut k = 0;
        for a in 0..3 {
            let d = c[a]
                .checked_sub(self.lo[a])
                .filter(|d| (0..self.size[a]).contains(d))?;
            k = k * self.size[a] + d;
        }
        usize::try_from(k).ok()
    }

    /// Whether `p` lies in a marked cube.
    fn holds(&self, p: V3) -> bool {
        if self.bits.is_empty() {
            return false;
        }
        let c = p.map(|x| (x / self.side).floor() as i64);
        self.bit(c)
            .is_some_and(|k| (self.bits[k / 64] >> (k % 64)) & 1 == 1)
    }

    /// Marks each cube `q` now covers.
    fn add(&mut self, q: V3) {
        if self.bits.is_empty() {
            return;
        }
        let reach = self.r * self.r * (1.0 - 1e-6);
        // The cubes the ball's box meets, within the bounds.
        let span = |a: usize| {
            let from = ((q[a] - self.r) / self.side).floor() as i64;
            let to = ((q[a] + self.r) / self.side).floor() as i64;
            from.max(self.lo[a])..=to.min(self.lo[a].saturating_add(self.size[a] - 1))
        };
        for x in span(0) {
            for y in span(1) {
                for z in span(2) {
                    let Some(k) = self.bit([x, y, z]) else {
                        continue;
                    };
                    // The cube's corner furthest from q, axis by axis.
                    let least = [x, y, z].map(|i| i as f64 * self.side);
                    let mut d2 = 0.0;
                    for a in 0..3 {
                        let (low, high) = (least[a] - q[a], least[a] + self.side - q[a]);
                        let d = low.abs().max(high.abs());
                        d2 += d * d;
                    }
                    if d2 < reach {
                        self.bits[k / 64] |= 1 << (k % 64);
                    }
                }
            }
        }
    }
}

/// The box that holds every point of `pts`.
fn bounds(pts: impl IntoIterator<Item = V3>) -> [V3; 2] {
    let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for p in pts {
        for k in 0..3 {
            b[0][k] = b[0][k].min(p[k]);
            b[1][k] = b[1][k].max(p[k]);
        }
    }
    b
}

/// An edge by its two ends' bits, the lesser first.
type Ends = ([u64; 3], [u64; 3]);

/// The open edges of the faces: each edge only one face holds, where the area ends.
fn border(tris: &[Tri]) -> Vec<[V3; 2]> {
    let bits = |p: V3| p.map(f64::to_bits);
    let mut count: BTreeMap<Ends, (u32, [V3; 2])> = BTreeMap::new();
    for t in tris {
        for k in 0..3 {
            let (a, b) = (t.p[k], t.p[(k + 1) % 3]);
            let key = if bits(a) <= bits(b) {
                (bits(a), bits(b))
            } else {
                (bits(b), bits(a))
            };
            count.entry(key).or_insert((0, [a, b])).0 += 1;
        }
    }
    count
        .into_values()
        .filter(|(n, _)| *n == 1)
        .map(|(_, e)| e)
        .collect()
}

fn to_segment(p: V3, [a, b]: [V3; 2]) -> f64 {
    let ab = sub(b, a);
    let l = dot(ab, ab);
    let t = if l > 0.0 {
        (dot(sub(p, a), ab) / l).clamp(0.0, 1.0)
    } else {
        0.0
    };
    length(sub(p, add(a, scale(ab, t))))
}

// ---- the samplers: each gives points with their faces, in the order of their IDs

struct Sampler<'a> {
    area: Area<'a>,
    key: u64,
    /// The distance no two points come closer than; 0 for none.
    min: f64,
    max: usize,
    keep: &'a dyn Fn(V3) -> bool,
}

impl Sampler<'_> {
    /// Uniform darts, each kept where it is allowed and crowds no earlier one: `count` of them, or
    /// as many as `tries` darts leave.
    fn darts(
        &self,
        count: usize,
        tries: u64,
        out: &mut Vec<(V3, u32)>,
        cells: &mut Cells,
        covered: &mut Covered,
    ) {
        let r2 = self.min * self.min;
        for n in 0..tries {
            if out.len() >= count {
                break;
            }
            let (p, t) = self.area.candidate(self.key, n);
            if (self.keep)(p) && !(self.min > 0.0 && (covered.holds(p) || cells.crowded(p, r2))) {
                cells.insert(out.len() as u32, p);
                covered.add(p);
                out.push((p, t));
            }
        }
    }

    /// Poisson-disk: darts, then every point of a lattice a quarter of the minimum distance
    /// apart over each face that is still further than that distance from every point, so no
    /// room for another point is left.
    fn poisson(&self) -> Vec<(V3, u32)> {
        let r = self.min;
        let mut out = Vec::new();
        let mut cells = Cells::new(r, self.area.bounds);
        let mut covered = Covered::new(r, self.area.bounds);
        let tries = ((DARTS * self.area.total / (r * r)).ceil() as u64).min(MOST);
        self.darts(self.max, tries, &mut out, &mut cells, &mut covered);
        let h = r * FILL;
        let mut budget = MOST;
        for (t, tri) in self.area.tris.iter().enumerate() {
            lattice(tri, h, &mut |p| {
                if out.len() >= self.max || budget == 0 {
                    return false;
                }
                budget -= 1;
                if (self.keep)(p) && !(covered.holds(p) || cells.crowded(p, r * r)) {
                    cells.insert(out.len() as u32, p);
                    covered.add(p);
                    out.push((p, t as u32));
                }
                true
            });
        }
        out
    }

    /// Uniform points, one per `spacing` squared of area.
    fn random(&self, spacing: f64) -> Vec<(V3, u32)> {
        let count = ((self.area.total / (spacing * spacing)).floor() as usize).min(self.max);
        let mut out = Vec::new();
        let mut cells = Cells::new(self.min.max(spacing), self.area.bounds);
        let mut covered = Covered::new(self.min, self.area.bounds);
        self.darts(
            count,
            (count as u64).saturating_mul(4).min(MOST),
            &mut out,
            &mut cells,
            &mut covered,
        );
        out
    }

    /// Sample elimination: five candidates for each point the area can hold at the minimum
    /// distance, the most crowded removed one by one until that many are left and no two are
    /// closer than the minimum distance.
    fn elimination(&self) -> Vec<(u32, V3, u32)> {
        let d = self.min;
        let target = ((0.65 * self.area.total / (d * d)).floor() as usize).clamp(1, self.max);
        let wanted = (target as u64).saturating_mul(5).min(MOST);
        let mut pts = Vec::new();
        for n in 0..wanted {
            let (p, t) = self.area.candidate(self.key, n);
            if (self.keep)(p) {
                pts.push((n as u32, p, t));
            }
        }
        let alive = eliminate(
            &pts.iter().map(|x| x.1).collect::<Vec<_>>(),
            target,
            d,
            self.area.total,
        );
        pts.into_iter()
            .zip(alive)
            .filter(|(_, a)| *a)
            .map(|(p, _)| p)
            .collect()
    }

    /// A square lattice `spacing` apart, laid on the plane the faces face and dropped onto them.
    fn grid(&self, spacing: f64) -> Result<Vec<(V3, u32)>, ()> {
        let tris = self.area.tris;
        let mean = tris
            .iter()
            .fold([0.0; 3], |m, t| add(m, scale(t.n, t.area())));
        let n = if length(mean) > 1e-9 * self.area.total {
            scale(mean, 1.0 / length(mean))
        } else {
            UP
        };
        let side = if n[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        };
        let flat = sub(side, scale(n, dot(side, n)));
        let u = scale(flat, 1.0 / length(flat));
        let v = cross(u, n);
        let mut found: BTreeMap<(i64, i64), (f64, V3, u32)> = BTreeMap::new();
        let mut budget = MOST;
        for (t, tri) in tris.iter().enumerate().filter(|(_, t)| dot(t.n, n) > 1e-9) {
            let q = tri.p.map(|p| [dot(p, u) / spacing, dot(p, v) / spacing]);
            let lo = |k: usize| q.iter().map(|x| x[k]).fold(f64::INFINITY, f64::min).ceil() as i64;
            let hi = |k: usize| {
                q.iter()
                    .map(|x| x[k])
                    .fold(f64::NEG_INFINITY, f64::max)
                    .floor() as i64
            };
            let den = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0])
                + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
            if den.abs() < 1e-18 {
                continue;
            }
            for j in lo(1)..=hi(1) {
                for i in lo(0)..=hi(0) {
                    budget = budget.checked_sub(1).ok_or(())?;
                    let (x, y) = (i as f64, j as f64);
                    let a = ((q[1][1] - q[2][1]) * (x - q[2][0])
                        + (q[2][0] - q[1][0]) * (y - q[2][1]))
                        / den;
                    let b = ((q[2][1] - q[0][1]) * (x - q[2][0])
                        + (q[0][0] - q[2][0]) * (y - q[2][1]))
                        / den;
                    let c = 1.0 - a - b;
                    if a < -1e-9 || b < -1e-9 || c < -1e-9 {
                        continue;
                    }
                    // The lattice point itself in the plane, at the face's height over it.
                    let height = a * dot(tri.p[0], n) + b * dot(tri.p[1], n) + c * dot(tri.p[2], n);
                    let p = add(
                        add(scale(u, x * spacing), scale(v, y * spacing)),
                        scale(n, height),
                    );
                    let entry = found
                        .entry((j, i))
                        .or_insert((f64::NEG_INFINITY, p, t as u32));
                    if height > entry.0 {
                        *entry = (height, p, t as u32);
                    }
                }
            }
        }
        let mut out = Vec::new();
        let mut cells = Cells::new(self.min.max(spacing), bounds(found.values().map(|f| f.1)));
        for (_, p, t) in found.into_values() {
            if out.len() >= self.max {
                break;
            }
            if (self.keep)(p) && !(self.min > 0.0 && cells.crowded(p, self.min * self.min)) {
                cells.insert(out.len() as u32, p);
                out.push((p, t));
            }
        }
        Ok(out)
    }
}

/// Every point of a lattice `h` apart over `tri`, rows along its longest edge with each row's
/// ends on the face's edges, so no point of the face is further than 1.12 `h` from one of them.
/// `visit` stops the walk by answering false.
fn lattice(tri: &Tri, h: f64, visit: &mut dyn FnMut(V3) -> bool) {
    let longest = (0..3)
        .max_by(|a, b| {
            let len = |k: usize| length(sub(tri.p[(k + 1) % 3], tri.p[k]));
            len(*a).total_cmp(&len(*b)).then(b.cmp(a))
        })
        .unwrap_or(0);
    let (a, b, c) = (
        tri.p[longest],
        tri.p[(longest + 1) % 3],
        tri.p[(longest + 2) % 3],
    );
    let base = length(sub(b, a));
    if base <= 0.0 {
        return;
    }
    let u = scale(sub(b, a), 1.0 / base);
    let along = dot(sub(c, a), u);
    let up = sub(sub(c, a), scale(u, along));
    let height = length(up);
    if height <= 0.0 {
        return;
    }
    let v = scale(up, 1.0 / height);
    let rows = (height / h).floor() as u64;
    for k in 0..=rows + 1 {
        let y = if k > rows { height } else { k as f64 * h };
        let (left, right) = (along * y / height, base + (along - base) * y / height);
        let steps = ((right - left) / h).floor().max(0.0) as u64;
        for j in 0..=steps + 1 {
            let x = if j > steps {
                right
            } else {
                left + j as f64 * h
            };
            if !visit(add(a, add(scale(u, x), scale(v, y)))) {
                return;
            }
        }
    }
}

/// A weight ordered as a number, with its point.
#[derive(PartialEq)]
struct Heavy(f64, u32);
impl Eq for Heavy {}
impl PartialOrd for Heavy {
    fn partial_cmp(&self, other: &Heavy) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Heavy {
    fn cmp(&self, other: &Heavy) -> Ordering {
        self.0.total_cmp(&other.0).then(other.1.cmp(&self.1))
    }
}

/// Weighted sample elimination over `pts`: which are left once the heaviest have gone, down to
/// `target` and until no two are closer than `d`. A point's weight is the sum over its
/// neighbours within twice the packing radius of (1 − distance ÷ that)⁸, the distance held
/// between the limits the method sets, so the points left are spread evenly.
fn eliminate(pts: &[V3], target: usize, d: f64, area: f64) -> Vec<bool> {
    let m = pts.len();
    let mut alive = vec![true; m];
    if m == 0 {
        return alive;
    }
    let reach = 2.0 * sqrt(area / (2.0 * sqrt(3.0) * target.max(1) as f64));
    let ratio = (target as f64 / m as f64).min(1.0);
    let floor = reach * (1.0 - ratio * sqrt(ratio)) * 0.65;
    let search = reach.max(d);
    let mut cells = Cells::new(search, bounds(pts.iter().copied()));
    for (i, p) in pts.iter().enumerate() {
        cells.insert(i as u32, *p);
    }
    let weight = |dist: f64| powi(1.0 - dist.clamp(floor, reach) / reach, 8);
    // Each point's neighbours with the weight they add and whether they are too close.
    let mut near: Vec<Vec<(u32, f64, bool)>> = vec![Vec::new(); m];
    for (i, p) in pts.iter().enumerate() {
        cells.around(*p, |j, q| {
            let dist = length(sub(q, *p));
            if j as usize != i && dist < search {
                near[i].push((j, if dist < reach { weight(dist) } else { 0.0 }, dist < d));
            }
        });
        near[i].sort_by_key(|n| n.0);
    }
    let mut weights: Vec<f64> = near.iter().map(|n| n.iter().map(|x| x.1).sum()).collect();
    let mut close: Vec<u32> = near
        .iter()
        .map(|n| n.iter().filter(|x| x.2).count() as u32)
        .collect();
    let mut heap: BinaryHeap<Heavy> = weights
        .iter()
        .enumerate()
        .map(|(i, w)| Heavy(*w, i as u32))
        .collect();
    let mut left = m;
    let mut crowded: u64 = close.iter().map(|c| u64::from(*c)).sum();
    while left > target || crowded > 0 {
        let Some(Heavy(w, i)) = heap.pop() else { break };
        let i = i as usize;
        // A stale entry, or past the target a point nothing is too close to: it stays.
        if !alive[i] || w != weights[i] || (left <= target && close[i] == 0) {
            continue;
        }
        alive[i] = false;
        left -= 1;
        crowded -= 2 * u64::from(close[i]);
        for &(j, wj, too_close) in &near[i] {
            let j = j as usize;
            if !alive[j] {
                continue;
            }
            weights[j] -= wj;
            if too_close {
                close[j] -= 1;
            }
            heap.push(Heavy(weights[j], j as u32));
        }
    }
    alive
}

// ---- projection: a ray onto true shapes

/// Where the ray from `o` along the unit `d` first meets `shape`: how far, and the unit normal
/// there.
fn ray(shape: &Shape, o: V3, d: V3) -> Option<(f64, V3)> {
    let ball = |c: V3, r: f64| -> Option<(f64, V3)> {
        let oc = sub(o, c);
        let b = dot(oc, d);
        let h = b * b - (dot(oc, oc) - r * r);
        if h < 0.0 {
            return None;
        }
        let t = -b - sqrt(h);
        (t >= 0.0).then(|| (t, scale(add(oc, scale(d, t)), 1.0 / r.max(1e-300))))
    };
    match shape {
        Shape::Ball { c, r } => ball(*c, *r),
        Shape::Obb { c, axes, half } => {
            let (mut near, mut far, mut normal) = (f64::NEG_INFINITY, f64::INFINITY, [0.0; 3]);
            for k in 0..3 {
                let (ok, dk) = (dot(sub(o, *c), axes[k]), dot(d, axes[k]));
                if dk.abs() < 1e-12 {
                    if ok.abs() > half[k] {
                        return None;
                    }
                    continue;
                }
                let (t1, t2) = ((-half[k] - ok) / dk, (half[k] - ok) / dk);
                let (enter, leave) = if t1 <= t2 { (t1, t2) } else { (t2, t1) };
                if enter > near {
                    near = enter;
                    normal = scale(axes[k], if dk > 0.0 { -1.0 } else { 1.0 });
                }
                far = far.min(leave);
            }
            (near <= far && near >= 0.0).then_some((near, normal))
        }
        Shape::Capsule { a, b, r } => {
            let (ba, oa) = (sub(*b, *a), sub(o, *a));
            let (baba, bard, baoa) = (dot(ba, ba), dot(ba, d), dot(ba, oa));
            if baba <= 0.0 {
                return ball(*a, *r);
            }
            let (qa, qb) = (baba - bard * bard, baba * dot(d, oa) - baoa * bard);
            let h = qb * qb - qa * (baba * dot(oa, oa) - baoa * baoa - r * r * baba);
            if h >= 0.0 && qa > 1e-18 {
                let t = (-qb - sqrt(h)) / qa;
                let y = baoa + t * bard;
                if y > 0.0 && y < baba {
                    return (t >= 0.0).then(|| {
                        (
                            t,
                            scale(
                                sub(add(oa, scale(d, t)), scale(ba, y / baba)),
                                1.0 / r.max(1e-300),
                            ),
                        )
                    });
                }
            }
            [ball(*a, *r), ball(*b, *r)]
                .into_iter()
                .flatten()
                .min_by(|x, y| x.0.total_cmp(&y.0))
        }
        Shape::Heights(h) => h.ray(o, d),
    }
}

/// `p` dropped along the unit `axis` onto the first of `shapes` it meets from beyond them all:
/// the point and the surface's normal there.
fn projected(p: V3, axis: V3, shapes: &[Shape]) -> Option<(V3, V3)> {
    // From behind everything: the furthest any shape reaches against the axis.
    let back = shapes
        .iter()
        .flat_map(|s| {
            let [lo, hi] = s.aabb();
            (0..8).map(move |c| [0, 1, 2].map(|k| if c >> k & 1 == 0 { lo[k] } else { hi[k] }))
        })
        .map(|corner| -dot(sub(corner, p), axis))
        .fold(0.0, f64::max)
        + 1.0;
    let o = sub(p, scale(axis, back));
    shapes
        .iter()
        .filter_map(|s| ray(s, o, axis))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(t, n)| (add(o, scale(axis, t)), n))
}

// ---- the fields

fn bad<T>(path: &str, field: &str) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path: format!("{path}/{field}"),
    })
}

fn number(d: &Value, path: &str, field: &str, default: f64) -> Result<f64, Refused> {
    match d.get(field) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= 0.0)
            .map_or_else(|| bad(path, field), Ok),
    }
}

fn range(d: &Value, path: &str, field: &str, default: [f64; 2]) -> Result<[f64; 2], Refused> {
    match d.get(field) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Array(a)) if a.len() == 2 => match (a[0].as_f64(), a[1].as_f64()) {
            (Some(lo), Some(hi)) if lo.is_finite() && hi.is_finite() && lo <= hi => Ok([lo, hi]),
            _ => bad(path, field),
        },
        Some(_) => bad(path, field),
    }
}

/// A density: a share from 0 to 1, or a field over `position`, `normal`, `index` and `id`.
enum Density {
    Share(f64),
    Field(Box<Expr>),
}

impl Density {
    fn of(d: &Value, path: &str) -> Result<Density, Refused> {
        match d.get("density") {
            None | Some(Value::Null) => Ok(Density::Share(1.0)),
            Some(Value::String(text)) => {
                let e = Expr::compile(text, &Nothing, 256).or_else(|_| bad(path, "density"))?;
                if e.vars
                    .iter()
                    .any(|v| !["position", "normal", "index", "id"].contains(&v.as_str()))
                {
                    return bad(path, "density");
                }
                Ok(Density::Field(Box::new(e)))
            }
            Some(v) => v
                .as_f64()
                .filter(|x| (0.0..=1.0).contains(x))
                .map_or_else(|| bad(path, "density"), |x| Ok(Density::Share(x))),
        }
    }

    /// The share of points kept at `pos`: a value that isn't a number keeps none.
    fn at(&self, pos: V3, normal: V3, index: u32, id: u32) -> f64 {
        match self {
            Density::Share(x) => *x,
            Density::Field(e) => {
                let vars: Vec<V> = e
                    .vars
                    .iter()
                    .map(|name| match name.as_str() {
                        "position" => V::V(3, [pos[0], pos[1], pos[2], 0.0]),
                        "normal" => V::V(3, [normal[0], normal[1], normal[2], 0.0]),
                        "index" => V::S(f64::from(index)),
                        _ => V::S(f64::from(id)),
                    })
                    .collect();
                let x = e.eval(&vars).num();
                if x.is_finite() {
                    x.clamp(0.0, 1.0)
                } else {
                    0.0
                }
            }
        }
    }
}

/// A scatter's rows as a check keeps them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scattered(pub Arc<Vec<Row>>);

impl Canonical for Scattered {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.0.len() as u64).encode(out);
        for r in self.0.iter() {
            (r.id, r.proto as u64, r.pos, (r.yaw, r.scale)).encode(out);
            r.turn.encode(out);
        }
    }
}

/// The elements a `distribute` lays out, in ID order, from its fields `d` (at `path`, for a
/// refusal) and what it reads of the document.
pub fn rows(d: &Value, path: &str, scene: &Scene<'_>) -> Result<Vec<Row>, Refused> {
    let Some(fields) = d.as_object() else {
        return Err(Refused {
            code: "out_of_range",
            path: path.to_string(),
        });
    };
    if let Some(unknown) = fields.keys().find(|k| !FIELDS.contains(&k.as_str())) {
        return Err(Refused {
            code: "unknown_field",
            path: format!("{path}/{unknown}"),
        });
    }
    let mode = match d.get("mode").and_then(Value::as_str) {
        Some("grid") => Mode::Grid,
        Some("random") => Mode::Random,
        Some("poisson") => Mode::Poisson,
        Some("elimination") => Mode::Elimination,
        _ => return bad(path, "mode"),
    };
    let spacing = number(d, path, "spacing", 0.0)?;
    let min_distance = number(d, path, "min_distance", 0.0)?;
    let margin = number(d, path, "margin", 0.0)?;
    let density = Density::of(d, path)?;
    let prune = match d.get("prune").map(Value::as_str) {
        None | Some(Some("none")) => Prune::None,
        Some(Some("larger_first")) => Prune::LargerFirst,
        Some(Some("smaller_first")) => Prune::SmallerFirst,
        Some(Some("equal")) => Prune::Equal,
        Some(_) => return bad(path, "prune"),
    };
    let sizes = range(d, path, "scale", [1.0, 1.0])?;
    if sizes[0] <= 0.0 {
        return bad(path, "scale");
    }
    let yaws = range(d, path, "yaw", [0.0, 360.0])?;
    let tilt = number(d, path, "tilt", 0.0)?;
    let cap = crate::cut::MAX_ELEMENTS;
    let max = match d.get("max") {
        None | Some(Value::Null) => cap,
        Some(v) => v
            .as_u64()
            .filter(|m| *m <= cap as u64)
            .map_or_else(|| bad(path, "max"), |m| Ok(m as usize))?,
    };
    let max = if scene.planted == Some(STOPS_AFTER_10) {
        max.min(10)
    } else {
        max
    };
    let seed = match d.get("seed") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_u64().map_or_else(|| bad(path, "seed"), Ok)?),
    };
    let project = match d.get("project") {
        None | Some(Value::Null) => None,
        Some(p) => {
            let axis = match p.get("axis") {
                None | Some(Value::Null) => [0.0, -1.0, 0.0],
                Some(Value::Array(a)) if a.len() == 3 => {
                    let v = [a[0].as_f64(), a[1].as_f64(), a[2].as_f64()];
                    let [Some(x), Some(y), Some(z)] = v else {
                        return bad(path, "project/axis");
                    };
                    let l = length([x, y, z]);
                    if l.is_nan() || l <= 1e-9 {
                        return bad(path, "project/axis");
                    }
                    scale([x, y, z], 1.0 / l)
                }
                Some(_) => return bad(path, "project/axis"),
            };
            let align = match p.get("align").map(Value::as_str) {
                None | Some(Some("none")) => false,
                Some(Some("normal")) => true,
                Some(_) => return bad(path, "project/align"),
            };
            Some((axis, align))
        }
    };
    // The distance two points keep: `min_distance`, which Poisson and elimination can't do
    // without; with none they keep `spacing`.
    let apart = match mode {
        Mode::Poisson | Mode::Elimination if min_distance > 0.0 => min_distance,
        Mode::Poisson | Mode::Elimination if spacing > 0.0 => spacing,
        Mode::Poisson | Mode::Elimination => return bad(path, "min_distance"),
        Mode::Grid | Mode::Random if spacing > 0.0 => min_distance,
        Mode::Grid | Mode::Random => return bad(path, "spacing"),
    };
    if scene.on.is_empty() || max == 0 {
        return Ok(Vec::new());
    }
    let edges = if margin > 0.0 {
        border(&scene.on)
    } else {
        Vec::new()
    };
    let keep = |p: V3| {
        edges.iter().all(|e| to_segment(p, *e) >= margin)
            && scene
                .avoid
                .iter()
                .all(|s| depth(&Shape::Ball { c: p, r: 0.0 }, s) < 0.0)
    };
    let key = key_of(seed, scene.id);
    let sampler = Sampler {
        area: Area::of(&scene.on),
        key,
        min: apart,
        max,
        keep: &keep,
    };
    if sampler.area.total.is_nan() || sampler.area.total <= 0.0 {
        return Ok(Vec::new());
    }
    // Each point with its ID and its face.
    let points: Vec<(u32, V3, u32)> = match mode {
        Mode::Poisson => sampler
            .poisson()
            .into_iter()
            .enumerate()
            .map(|(i, (p, t))| (i as u32, p, t))
            .collect(),
        Mode::Random => sampler
            .random(spacing)
            .into_iter()
            .enumerate()
            .map(|(i, (p, t))| (i as u32, p, t))
            .collect(),
        Mode::Grid => {
            let laid = sampler.grid(spacing).or_else(|()| bad(path, "spacing"))?;
            laid.into_iter()
                .enumerate()
                .map(|(i, (p, t))| (i as u32, p, t))
                .collect()
        }
        Mode::Elimination => sampler.elimination(),
    };
    let inverse = crate::cut::inverse(&scene.world);
    let local = |n: V3| {
        let v =
            [0, 1, 2].map(|i| inverse[i][0] * n[0] + inverse[i][1] * n[1] + inverse[i][2] * n[2]);
        if length(v) > 0.0 {
            scale(v, 1.0 / length(v))
        } else {
            UP
        }
    };
    let protos = scene.protos.len().max(1);
    let mut out = Vec::with_capacity(points.len());
    for (index, (id, p, t)) in points.into_iter().enumerate() {
        let mut normal = scene.on[t as usize].n;
        let mut world = p;
        let mut up = None;
        if let Some((axis, align)) = project {
            let Some((hit, n)) = projected(p, axis, &scene.project) else {
                continue;
            };
            world = hit;
            normal = n;
            if align {
                up = Some(local(n));
            }
        }
        let pos = apply(&inverse, world);
        let n = u64::from(id);
        if draw(key, DENSITY, n) >= density.at(pos, local(normal), index as u32, id) {
            continue;
        }
        let yaw = yaws[0] + (yaws[1] - yaws[0]) * draw(key, YAW, n);
        let mut turn = None;
        if tilt > 0.0 || up.is_some() {
            let (lean, way) = (rad(tilt * draw(key, TILT, n)), TAU * draw(key, TILT_WAY, n));
            let leaned = turn_onto(UP, [sin(lean) * cos(way), cos(lean), sin(lean) * sin(way)]);
            let onto = turn_onto(UP, up.unwrap_or(UP));
            turn = Some(times(&onto, &times(&leaned, &about_y(yaw))));
        }
        out.push(Row {
            id,
            proto: ((draw(key, PROTO, n) * protos as f64) as usize).min(protos - 1),
            pos,
            yaw,
            turn,
            scale: sizes[0] + (sizes[1] - sizes[0]) * draw(key, SCALE, n),
        });
    }
    Ok(pruned(out, prune, &scene.protos))
}

/// An element's bounds in the instancer's space: its prototype's, scaled, turned and moved.
fn bounds_of(row: &Row, protos: &[[V3; 2]]) -> [V3; 2] {
    let [lo, hi] = protos.get(row.proto).copied().unwrap_or([[0.0; 3]; 2]);
    let at = row.at();
    let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for c in 0..8 {
        let p = apply(
            &at,
            [0, 1, 2].map(|k| if c >> k & 1 == 0 { lo[k] } else { hi[k] }),
        );
        for k in 0..3 {
            out[0][k] = out[0][k].min(p[k]);
            out[1][k] = out[1][k].max(p[k]);
        }
    }
    out
}

/// The elements left once none's bounds pass into another's: taken larger first, smaller first or
/// by ID, each kept unless its bounds pass into the bounds of one kept before it.
fn pruned(rows: Vec<Row>, prune: Prune, protos: &[[V3; 2]]) -> Vec<Row> {
    if prune == Prune::None || rows.len() < 2 {
        return rows;
    }
    let boxes: Vec<[V3; 2]> = rows.iter().map(|r| bounds_of(r, protos)).collect();
    let size = |i: usize| {
        (0..3)
            .map(|k| boxes[i][1][k] - boxes[i][0][k])
            .product::<f64>()
    };
    let mut order: Vec<usize> = (0..rows.len()).collect();
    match prune {
        Prune::LargerFirst => order.sort_by(|a, b| {
            size(*b)
                .total_cmp(&size(*a))
                .then(rows[*a].id.cmp(&rows[*b].id))
        }),
        Prune::SmallerFirst => order.sort_by(|a, b| {
            size(*a)
                .total_cmp(&size(*b))
                .then(rows[*a].id.cmp(&rows[*b].id))
        }),
        _ => {}
    }
    let widest = boxes
        .iter()
        .flat_map(|b| (0..3).map(|k| b[1][k] - b[0][k]))
        .fold(1e-9, f64::max);
    let centre = |i: usize| scale(add(boxes[i][0], boxes[i][1]), 0.5);
    let mut cells = Cells::new(widest, bounds((0..rows.len()).map(centre)));
    let mut kept = vec![false; rows.len()];
    for i in order {
        let clear = !cells.any(centre(i), |j, _| {
            let j = j as usize;
            (0..3).all(|k| boxes[i][0][k] < boxes[j][1][k] && boxes[j][0][k] < boxes[i][1][k])
        });
        if clear {
            kept[i] = true;
            cells.insert(i as u32, centre(i));
        }
    }
    rows.into_iter()
        .zip(kept)
        .filter(|(_, k)| *k)
        .map(|(r, _)| r)
        .collect()
}

// ---- the operator: a scatter laid out when its revision is checked. Its node reads the whole
// document, since what it names reaches further than it says: a parent's transform, a rest that
// moves a part, a collection's members.

/// An instancer fed by a scatter.
fn is_scatter(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("instance@1")
        && item.pointer("/params/from").is_some_and(|f| !f.is_null())
}

fn scatter_op(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let planted = v.planted();
    let doc = v.document()?;
    let rows = crate::scene::elements_at(doc, 0, &id, planted)
        .map_err(|r| OpError::new(r.code, r.path))?;
    v.write(
        "scene3d.scattered",
        Val::typed(Scattered(Arc::new(rows.unwrap_or_default()))),
    )
}

/// Registers the scatter: an instancer's `from: {distribute}` laid out at check.
pub fn register(r: &mut Registrar) {
    r.array("scene3d.scattered", "rows", "item", "geometry", "build");
    r.operator(
        "scatter",
        "build",
        &["self", "refs"],
        &["scene3d.scattered"],
    )
    .applies(is_scatter)
    .run(scatter_op);
}

#[cfg(test)]
mod tests {
    use super::*;

    const I: Affine3 = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];

    /// A flat plate `x` × `z` m at y 0, centred on the origin, facing +Y.
    fn plate(x: f64, z: f64) -> Vec<Tri> {
        let c = [
            [-x / 2.0, 0.0, -z / 2.0],
            [x / 2.0, 0.0, -z / 2.0],
            [-x / 2.0, 0.0, z / 2.0],
            [x / 2.0, 0.0, z / 2.0],
        ];
        [[c[0], c[3], c[1]], [c[0], c[2], c[3]]]
            .into_iter()
            .filter_map(Tri::new)
            .collect()
    }

    fn scene(on: Vec<Tri>) -> Scene<'static> {
        Scene {
            on,
            avoid: Vec::new(),
            project: Vec::new(),
            protos: vec![[[-0.05; 3], [0.05; 3]]],
            world: I,
            id: "stones",
            planted: None,
        }
    }

    fn least(rows: &[Row]) -> f64 {
        let mut d = f64::INFINITY;
        for (i, a) in rows.iter().enumerate() {
            for b in &rows[i + 1..] {
                d = d.min(length(sub(a.pos, b.pos)));
            }
        }
        d
    }

    /// The furthest any point of a 0.05 m lattice over the plate's inner square lies from a row.
    fn widest_gap(rows: &[Row], half: f64) -> f64 {
        let n = (2.0 * half / 0.05) as i64;
        let mut worst: f64 = 0.0;
        for i in 0..=n {
            for j in 0..=n {
                let (x, z) = (-half + i as f64 * 0.05, -half + j as f64 * 0.05);
                let near = rows
                    .iter()
                    .map(|r| length(sub(r.pos, [x, 0.0, z])))
                    .fold(f64::INFINITY, f64::min);
                worst = worst.max(near);
            }
        }
        worst
    }

    #[test]
    fn poisson_keeps_its_distance_and_leaves_no_room_and_is_the_same_twice() {
        let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013});
        let rows_a = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
        assert!(least(&rows_a) >= 0.5, "{}", least(&rows_a));
        // Maximal to within the fill lattice: no point of the plate is 0.64 m from every element.
        assert!(
            widest_gap(&rows_a, 4.5) < 0.5 * 1.28,
            "{}",
            widest_gap(&rows_a, 4.5)
        );
        assert!(rows_a.len() > 250, "{}", rows_a.len());
        assert_eq!(rows_a, rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap());
        // The seed is the scatter's: another instancer with it lays out the same points.
        let mut other = scene(plate(10.0, 10.0));
        other.id = "pebbles";
        assert_eq!(rows_a, rows(&d, "p", &other).unwrap());
        // The planted sampler stops after 10 points, which leave most of the plate empty.
        let mut planted = scene(plate(10.0, 10.0));
        planted.planted = Some(STOPS_AFTER_10);
        let few = rows(&d, "p", &planted).unwrap();
        assert_eq!(few.len(), 10);
        assert!(least(&few) >= 0.5 && widest_gap(&few, 4.5) > 1.0);
    }

    #[test]
    fn a_density_field_thins_and_a_max_caps() {
        let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "density": "max(sign(position.x), 0)"});
        let right = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
        assert!(right.len() > 100 && right.iter().all(|r| r.pos[0] > 0.0));
        let half = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "density": 0.5});
        let all = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013});
        let (thinned, full) = (
            rows(&half, "p", &scene(plate(10.0, 10.0))).unwrap(),
            rows(&all, "p", &scene(plate(10.0, 10.0))).unwrap(),
        );
        // A thinned scatter is some of the same elements, by ID.
        assert!(
            thinned.len() * 10 > full.len() * 3 && thinned.len() * 10 < full.len() * 7,
            "{} of {}",
            thinned.len(),
            full.len()
        );
        assert!(thinned
            .iter()
            .all(|t| full.iter().any(|f| f.id == t.id && f.pos == t.pos)));
        let capped = json!({"on": "plate", "mode": "poisson", "min_distance": 0.08, "seed": 2013, "max": 50});
        assert_eq!(
            rows(&capped, "p", &scene(plate(1.0, 1.0))).unwrap().len(),
            50
        );
    }

    #[test]
    fn elimination_spreads_its_points_at_least_the_minimum_distance_apart() {
        let d = json!({"on": "plate", "mode": "elimination", "min_distance": 0.5, "seed": 7});
        let got = rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap();
        assert!(least(&got) >= 0.5, "{}", least(&got));
        // 0.65 × area ÷ distance², less what the distance rule took.
        assert!(got.len() <= 260 && got.len() > 200, "{}", got.len());
        assert_eq!(got, rows(&d, "p", &scene(plate(10.0, 10.0))).unwrap());
        let ids: Vec<u32> = got.iter().map(|r| r.id).collect();
        assert!(ids.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn a_grid_and_a_random_scatter_fill_by_spacing_inside_the_margin() {
        let grid = json!({"on": "plate", "mode": "grid", "spacing": 1.0, "margin": 0.75});
        let got = rows(&grid, "p", &scene(plate(10.0, 10.0))).unwrap();
        // Lattice points from −4 to 4 on both axes: the rows at ±5 lie inside the margin.
        assert_eq!(got.len(), 81);
        assert!(got
            .iter()
            .all(|r| r.pos[0].abs() <= 4.0 && r.pos[2].abs() <= 4.0 && r.pos[0].fract() == 0.0));
        let random = json!({"on": "plate", "mode": "random", "spacing": 1.0, "seed": 3});
        assert_eq!(
            rows(&random, "p", &scene(plate(10.0, 10.0))).unwrap().len(),
            100
        );
    }

    #[test]
    fn pruning_leaves_no_two_bounds_passing_into_each_other() {
        let mut s = scene(plate(10.0, 10.0));
        s.protos = vec![[[-0.6; 3], [0.6; 3]], [[-0.15; 3], [0.15; 3]]];
        let field = |prune: &str| json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 2013, "prune": prune});
        let overlaps = |rows: &[Row]| {
            let b: Vec<[V3; 2]> = rows.iter().map(|r| bounds_of(r, &s.protos)).collect();
            let mut n = 0;
            for i in 0..b.len() {
                for j in i + 1..b.len() {
                    n += usize::from(
                        (0..3).all(|k| b[i][0][k] < b[j][1][k] && b[j][0][k] < b[i][1][k]),
                    );
                }
            }
            n
        };
        let loose = rows(&field("none"), "p", &s).unwrap();
        assert!(overlaps(&loose) > 0);
        let count = |rows: &[Row], proto: usize| rows.iter().filter(|r| r.proto == proto).count();
        let larger = rows(&field("larger_first"), "p", &s).unwrap();
        let smaller = rows(&field("smaller_first"), "p", &s).unwrap();
        let equal = rows(&field("equal"), "p", &s).unwrap();
        for kept in [&larger, &smaller, &equal] {
            assert_eq!(overlaps(kept), 0);
            assert!(kept.len() > 20 && kept.iter().all(|k| loose.contains(k)));
        }
        // Larger first keeps more of the large prototype, smaller first more of the small.
        assert!(count(&larger, 0) > count(&smaller, 0) && count(&smaller, 1) > count(&larger, 1));
    }

    #[test]
    fn avoid_keeps_points_off_a_shape_and_project_drops_them_onto_one() {
        let mut s = scene(plate(10.0, 10.0));
        s.avoid = vec![Shape::Obb {
            c: [2.0, 0.0, 0.0],
            axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            half: [1.0, 0.1, 5.0],
        }];
        // A ramp under the plate: its top falls from y −1 at x −5 to y −3 at x 5.
        let (c, sn) = (cos(rad(-11.309932474020215)), sin(rad(-11.309932474020215)));
        s.project = vec![Shape::Obb {
            c: [0.0, -2.0, 0.0],
            axes: [[c, sn, 0.0], [-sn, c, 0.0], [0.0, 0.0, 1.0]],
            half: [20.0, 0.0, 20.0],
        }];
        let d = json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "seed": 1, "avoid": ["path"], "project": {"to": "ramp", "align": "normal"}});
        let got = rows(&d, "p", &s).unwrap();
        assert!(got.len() > 100);
        for r in &got {
            assert!(!(1.0..=3.0).contains(&r.pos[0]), "{:?}", r.pos);
            assert!(
                (r.pos[1] - (-2.0 - 0.2 * r.pos[0])).abs() < 1e-9,
                "{:?}",
                r.pos
            );
            // Its up is the ramp's normal.
            let up = r.turn.map(|m| [m[0][1], m[1][1], m[2][1]]).unwrap();
            assert!(length(sub(up, [-sn, c, 0.0])) < 1e-9, "{up:?}");
        }
    }

    #[test]
    fn a_field_out_of_range_or_unknown_is_refused_by_its_path() {
        let s = scene(plate(1.0, 1.0));
        for (d, code, at) in [
            (
                json!({"on": "plate", "mode": "spiral", "min_distance": 0.5}),
                "out_of_range",
                "p/mode",
            ),
            (
                json!({"on": "plate", "mode": "poisson"}),
                "out_of_range",
                "p/min_distance",
            ),
            (
                json!({"on": "plate", "mode": "grid"}),
                "out_of_range",
                "p/spacing",
            ),
            (
                json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "max": 100_001}),
                "out_of_range",
                "p/max",
            ),
            (
                json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "density": "position.x + t"}),
                "out_of_range",
                "p/density",
            ),
            (
                json!({"on": "plate", "mode": "poisson", "min_distance": 0.5, "rows": 3}),
                "unknown_field",
                "p/rows",
            ),
        ] {
            let r = rows(&d, "p", &s).unwrap_err();
            assert_eq!((r.code, r.path.as_str()), (code, at));
        }
    }
}
