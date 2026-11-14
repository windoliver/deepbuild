//! Issue #1732: `arrange@1`, placement by relation in 3D. A set of items and a list of relations
//! among them and fixed items (`on`, `inside`, `next_to`, `against`, `facing`, `near`, `apart`)
//! solved once at check: each item is its oriented bounds turned only about the up axis, the
//! search starts from where the items stand, keeps each that already fits, tries places and turns
//! seeded from the document, and builds every contact exact. A set it can't satisfy is refused,
//! naming the relations still missed, by how much, and the pair that overlaps.
//!
//! Y is up, angles are degrees in and out, an item's front is its local +Z. All math is f64
//! through the ops module, in a fixed order, so a document solves to the same bits everywhere.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops;
use serde_json::{json, Value};

/// How far a held relation may miss, in metres and in degrees (the issue's 1 mm and 1°).
pub const TOL_M: f64 = 0.001;
pub const TOL_DEG: f64 = 1.0;
/// `facing`: the front axis meets b, or points within this many degrees of b's centre.
pub const FACING_DEG: f64 = 20.0;
/// What the search itself allows: contacts it builds are exact to rounding.
const EPS: f64 = 1e-6;
/// The most poses the search tries before it refuses.
const BUDGET: usize = 60_000;

pub type V3 = [f64; 3];

/// One item as the solve sees it: its bounds in its own frame and its pose.
#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub id: String,
    /// The bounds' centre in the item's own frame, after its scale.
    pub center: V3,
    /// The bounds' half extents in the item's own frame, after its scale.
    pub half: V3,
    pub pos: V3,
    /// Turn about +Y, in degrees.
    pub yaw: f64,
    /// A volume, such as a room, that holds items rather than displacing them.
    pub hollow: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Rel {
    On,
    Inside,
    NextTo,
    Against,
    Facing,
    Near,
    Apart,
}

impl Rel {
    pub fn parse(s: &str) -> Option<Rel> {
        Some(match s {
            "on" => Rel::On,
            "inside" => Rel::Inside,
            "next_to" => Rel::NextTo,
            "against" => Rel::Against,
            "facing" => Rel::Facing,
            "near" => Rel::Near,
            "apart" => Rel::Apart,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Rel::On => "on",
            Rel::Inside => "inside",
            Rel::NextTo => "next_to",
            Rel::Against => "against",
            Rel::Facing => "facing",
            Rel::Near => "near",
            Rel::Apart => "apart",
        }
    }
    /// A relation that puts a in touch with b: the search builds a's place from it.
    fn contact(self) -> bool {
        matches!(self, Rel::On | Rel::NextTo | Rel::Against)
    }
}

/// `{a, rel, b, d?}`, with a and b indices into the bodies.
#[derive(Clone, Debug, PartialEq)]
pub struct Relation {
    pub a: usize,
    pub rel: Rel,
    pub b: usize,
    pub d: f64,
}

/// How far one relation misses: metres for places, degrees for turns.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Miss {
    pub m: f64,
    pub deg: f64,
}

impl Miss {
    pub fn held(&self) -> bool {
        self.m <= TOL_M && self.deg <= TOL_DEG
    }
    fn exact(&self) -> bool {
        self.m <= EPS && self.deg <= EPS
    }
    fn size(&self) -> f64 {
        self.m + self.deg * 0.01
    }
}

/// A pair that passes into each other, and how deep.
#[derive(Clone, Debug, PartialEq)]
pub struct Overlap {
    pub a: usize,
    pub b: usize,
    pub depth: f64,
}

/// Why a set is refused: the relations still missed with their misses, and the pairs that
/// overlap, at the best place the search reached for the first item it couldn't place.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub item: usize,
    pub missed: Vec<(usize, Miss)>,
    pub overlaps: Vec<Overlap>,
}

// ---- the footprint: a turned rectangle in the XZ plane, and the Y interval

#[derive(Clone, Copy, Debug)]
struct Rect {
    c: [f64; 2],
    u: [f64; 2],
    w: [f64; 2],
    h: [f64; 2],
}

fn dot(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn sub(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

/// The turn of +X and +Z by `yaw` degrees about +Y (R = Ry), as XZ vectors.
fn axes(yaw: f64) -> ([f64; 2], [f64; 2]) {
    let r = ops::rad(yaw);
    let (s, c) = (ops::sin(r), ops::cos(r));
    ([c, -s], [s, c])
}

impl Body {
    /// The world centre of the bounds.
    pub fn world_center(&self) -> V3 {
        let (u, w) = axes(self.yaw);
        [
            self.pos[0] + u[0] * self.center[0] + w[0] * self.center[2],
            self.pos[1] + self.center[1],
            self.pos[2] + u[1] * self.center[0] + w[1] * self.center[2],
        ]
    }
    fn rect(&self) -> Rect {
        let (u, w) = axes(self.yaw);
        let c = self.world_center();
        Rect {
            c: [c[0], c[2]],
            u,
            w,
            h: [self.half[0], self.half[2]],
        }
    }
    pub fn bottom(&self) -> f64 {
        self.pos[1] + self.center[1] - self.half[1]
    }
    pub fn top(&self) -> f64 {
        self.pos[1] + self.center[1] + self.half[1]
    }
    /// The front axis in XZ: local +Z turned.
    fn front(&self) -> [f64; 2] {
        axes(self.yaw).1
    }
}

impl Rect {
    fn corners(&self) -> [[f64; 2]; 4] {
        let (u, w, h) = (self.u, self.w, self.h);
        let at = |a: f64, b: f64| {
            [
                self.c[0] + u[0] * h[0] * a + w[0] * h[1] * b,
                self.c[1] + u[1] * h[0] * a + w[1] * h[1] * b,
            ]
        };
        [at(-1.0, -1.0), at(1.0, -1.0), at(1.0, 1.0), at(-1.0, 1.0)]
    }
    /// Half its width along unit n.
    fn support(&self, n: [f64; 2]) -> f64 {
        self.h[0] * dot(self.u, n).abs() + self.h[1] * dot(self.w, n).abs()
    }
    /// A world point in this rectangle's own frame.
    fn local(&self, p: [f64; 2]) -> [f64; 2] {
        let d = sub(p, self.c);
        [dot(d, self.u), dot(d, self.w)]
    }
}

/// How deep two footprints overlap along their least axis; ≤ 0 when apart.
fn depth2(a: &Rect, b: &Rect) -> f64 {
    let d = sub(b.c, a.c);
    let mut least = f64::INFINITY;
    for n in [a.u, a.w, b.u, b.w] {
        let o = a.support(n) + b.support(n) - dot(d, n).abs();
        least = least.min(o);
    }
    least
}

fn point_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let ab = sub(b, a);
    let len = dot(ab, ab);
    let t = if len > 0.0 {
        (dot(sub(p, a), ab) / len).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    let e = sub(p, q);
    ops::sqrt(dot(e, e))
}

/// The gap between two footprints, 0 when they touch or overlap.
fn gap2(a: &Rect, b: &Rect) -> f64 {
    if depth2(a, b) >= 0.0 {
        return 0.0;
    }
    let (ca, cb) = (a.corners(), b.corners());
    let mut least = f64::INFINITY;
    for (p, q) in [(&ca, &cb), (&cb, &ca)] {
        for v in p {
            for i in 0..4 {
                least = least.min(point_segment(*v, q[i], q[(i + 1) % 4]));
            }
        }
    }
    least
}

fn y_overlap(a: &Body, b: &Body) -> f64 {
    a.top().min(b.top()) - a.bottom().max(b.bottom())
}

/// How deep two items pass into each other: the least move that parts them; 0 when apart or
/// only touching.
pub fn depth(a: &Body, b: &Body) -> f64 {
    if a.hollow || b.hollow {
        return 0.0;
    }
    let (ra, rb) = (a.rect(), b.rect());
    depth2(&ra, &rb).min(y_overlap(a, b)).max(0.0)
}

/// The distance between two items' bounds, 0 when they touch or overlap.
pub fn distance(a: &Body, b: &Body) -> f64 {
    let g = gap2(&a.rect(), &b.rect());
    let dy = (-y_overlap(a, b)).max(0.0);
    ops::hypot(g, dy)
}

fn angle_between(a: [f64; 2], b: [f64; 2]) -> f64 {
    let c = a[0] * b[1] - a[1] * b[0];
    ops::deg(ops::atan2(c.abs(), dot(a, b)))
}

/// How far a footprint's corners stand outside another's, in metres.
fn outside2(a: &Rect, b: &Rect) -> f64 {
    let mut worst = 0.0f64;
    for p in a.corners() {
        let l = b.local(p);
        worst = worst.max(l[0].abs() - b.h[0]).max(l[1].abs() - b.h[1]);
    }
    worst.max(0.0)
}

/// A vertical side face: its centre in XZ, outward normal, the tangent along it, its half
/// width, and its Y range.
struct Face {
    c: [f64; 2],
    n: [f64; 2],
    t: [f64; 2],
    w: f64,
    y: [f64; 2],
}

/// A body's four side faces: +X, −X, +Z (its front), −Z (its back).
fn faces(b: &Body) -> [Face; 4] {
    let r = b.rect();
    let y = [b.bottom(), b.top()];
    let at = |n: [f64; 2], half: f64, t: [f64; 2], w: f64| Face {
        c: [r.c[0] + n[0] * half, r.c[1] + n[1] * half],
        n,
        t,
        w,
        y,
    };
    let neg = |v: [f64; 2]| [-v[0], -v[1]];
    [
        at(r.u, r.h[0], r.w, r.h[1]),
        at(neg(r.u), r.h[0], r.w, r.h[1]),
        at(r.w, r.h[1], r.u, r.h[0]),
        at(neg(r.w), r.h[1], r.u, r.h[0]),
    ]
}

/// How far face f misses lying flat on face g along g's width: the larger of its distance off
/// g's plane, how far it runs past g's ends and the gap between their heights, in metres; and
/// its turn off facing g, in degrees.
fn face_miss(f: &Face, g: &Face) -> Miss {
    let d = sub(f.c, g.c);
    let plane = dot(d, g.n).abs();
    let along = dot(d, g.t).abs() + f.w * dot(f.t, g.t).abs() - g.w;
    let vertical = (f.y[0].max(g.y[0]) - f.y[1].min(g.y[1])).max(0.0);
    Miss {
        m: plane.max(along).max(vertical),
        deg: angle_between(f.n, [-g.n[0], -g.n[1]]),
    }
}

/// How far relation `r` misses with the bodies where they stand.
pub fn miss(bodies: &[Body], r: &Relation) -> Miss {
    let (a, b) = (&bodies[r.a], &bodies[r.b]);
    let (ra, rb) = (a.rect(), b.rect());
    match r.rel {
        Rel::On => {
            // a's centre over b's top.
            let l = rb.local(ra.c);
            let off = (l[0].abs() - rb.h[0]).max(l[1].abs() - rb.h[1]).max(0.0);
            Miss {
                m: (a.bottom() - b.top()).abs() + off,
                deg: 0.0,
            }
        }
        Rel::Inside => Miss {
            m: outside2(&ra, &rb)
                .max(b.bottom() - a.bottom())
                .max(a.top() - b.top())
                .max(0.0),
            deg: 0.0,
        },
        Rel::NextTo | Rel::Against => {
            // A side face of a (for `against`, its back) flat on a side face of b, along it,
            // and the two touching.
            let own = faces(a);
            let own = if r.rel == Rel::Against {
                &own[3..4]
            } else {
                &own[..]
            };
            let theirs = faces(b);
            let mut best = Miss {
                m: f64::INFINITY,
                deg: f64::INFINITY,
            };
            for f in own {
                for g in &theirs {
                    let m = face_miss(f, g);
                    if m.m / TOL_M + m.deg / TOL_DEG < best.m / TOL_M + best.deg / TOL_DEG {
                        best = m;
                    }
                }
            }
            Miss {
                m: best.m + gap2(&ra, &rb) + depth(a, b),
                deg: best.deg,
            }
        }
        Rel::Facing => {
            let f = a.front();
            if ray_hits(ra.c, f, &rb) {
                return Miss::default();
            }
            let to = sub(rb.c, ra.c);
            Miss {
                m: 0.0,
                deg: (angle_between(f, to) - FACING_DEG).max(0.0),
            }
        }
        Rel::Near => Miss {
            m: (distance(a, b) - r.d).max(0.0),
            deg: 0.0,
        },
        Rel::Apart => Miss {
            m: (r.d - distance(a, b)).max(0.0),
            deg: 0.0,
        },
    }
}

/// Whether the ray from p along unit f meets rectangle b (a slab test in b's frame).
fn ray_hits(p: [f64; 2], f: [f64; 2], b: &Rect) -> bool {
    let o = b.local(p);
    let d = [dot(f, b.u), dot(f, b.w)];
    let (mut lo, mut hi) = (0.0f64, f64::INFINITY);
    for k in 0..2 {
        if d[k].abs() < 1e-12 {
            if o[k].abs() > b.h[k] {
                return false;
            }
        } else {
            let t1 = (-b.h[k] - o[k]) / d[k];
            let t2 = (b.h[k] - o[k]) / d[k];
            lo = lo.max(t1.min(t2));
            hi = hi.min(t1.max(t2));
        }
    }
    lo <= hi
}

/// Pairs exempt from the overlap rule: an item and what it is declared inside.
fn exempt(relations: &[Relation], i: usize, j: usize) -> bool {
    relations
        .iter()
        .any(|r| r.rel == Rel::Inside && ((r.a == i && r.b == j) || (r.a == j && r.b == i)))
}

/// Every pair among `bodies` that passes into each other deeper than `tol`, in index order.
pub fn overlaps(bodies: &[Body], relations: &[Relation], tol: f64) -> Vec<Overlap> {
    let mut out = Vec::new();
    for i in 0..bodies.len() {
        for j in i + 1..bodies.len() {
            if exempt(relations, i, j) {
                continue;
            }
            let d = depth(&bodies[i], &bodies[j]);
            if d > tol {
                out.push(Overlap {
                    a: i,
                    b: j,
                    depth: d,
                });
            }
        }
    }
    out
}

/// What holds item `i` up: the highest top under its footprint at or below its bottom, within
/// `tol`; `None` when nothing does.
pub fn support(bodies: &[Body], i: usize, tol: f64) -> Option<usize> {
    let a = &bodies[i];
    let ra = a.rect();
    let mut best: Option<(f64, usize)> = None;
    for (j, b) in bodies.iter().enumerate() {
        if j == i || b.hollow {
            continue;
        }
        if depth2(&ra, &b.rect()) <= 0.0 {
            continue;
        }
        let gap = a.bottom() - b.top();
        if gap.abs() <= tol && best.is_none_or(|(g, _)| gap.abs() < g) {
            best = Some((gap.abs(), j));
        }
    }
    best.map(|(_, j)| j)
}

// ---- the solve

/// The poses the solve wrote for the moving items, in their order.
#[derive(Clone, Debug, PartialEq)]
pub struct Solved {
    pub bodies: Vec<Body>,
}

struct Search<'a> {
    bodies: Vec<Body>,
    start: Vec<Body>,
    relations: &'a [Relation],
    order: Vec<usize>,
    placed: Vec<bool>,
    tried: usize,
    /// The deepest failure: its depth in the order, and its best pose's refusal.
    worst: Option<(usize, f64, Refusal)>,
    moving: Vec<bool>,
    /// Whether placed items are kept out of each other; the planted solve that ignores pair
    /// overlap keeps them out of the fixed items alone.
    pairs: bool,
}

/// Solve the set: `moving[i]` says whether body i is arranged (the rest stand fixed).
pub fn solve(
    bodies: &[Body],
    moving: &[bool],
    relations: &[Relation],
    pairs: bool,
) -> Result<Solved, Refusal> {
    let order = order(bodies, moving, relations);
    let mut s = Search {
        bodies: bodies.to_vec(),
        start: bodies.to_vec(),
        relations,
        order,
        placed: moving.iter().map(|m| !m).collect(),
        tried: 0,
        worst: None,
        moving: moving.to_vec(),
        pairs,
    };
    if s.place(0) {
        return Ok(Solved { bodies: s.bodies });
    }
    Err(s.worst.map(|w| w.2).unwrap_or(Refusal {
        item: 0,
        missed: Vec::new(),
        overlaps: Vec::new(),
    }))
}

/// Moving items in the order they place: each after every item its contacts and turns name,
/// items that rest on something first, then larger footprints first, then as declared.
fn order(bodies: &[Body], moving: &[bool], relations: &[Relation]) -> Vec<usize> {
    let mut done: Vec<bool> = moving.iter().map(|m| !m).collect();
    let mut out = Vec::new();
    let rank = |i: usize| {
        let on = relations.iter().any(|r| r.a == i && r.rel == Rel::On);
        let area = bodies[i].half[0] * bodies[i].half[2];
        (if on { 0 } else { 1 }, -area)
    };
    while out.len() < moving.iter().filter(|m| **m).count() {
        let ready = |i: usize| {
            relations.iter().all(|r| {
                r.a != i || r.b == i || done[r.b] || !(r.rel.contact() || r.rel == Rel::Facing)
            })
        };
        let pick = (0..bodies.len())
            .filter(|&i| !done[i] && ready(i))
            .min_by(|&x, &y| {
                let (rx, ry) = (rank(x), rank(y));
                rx.0.cmp(&ry.0).then(rx.1.total_cmp(&ry.1)).then(x.cmp(&y))
            })
            // A cycle of contacts: take the first left, as declared.
            .or_else(|| (0..bodies.len()).find(|&i| !done[i]));
        let Some(i) = pick else { break };
        done[i] = true;
        out.push(i);
    }
    out
}

/// A candidate pose: position and yaw, with what moving there costs.
#[derive(Clone, Copy, Debug)]
struct Cand {
    pos: V3,
    yaw: f64,
    cost: f64,
}

fn norm_yaw(y: f64) -> f64 {
    let mut y = y % 360.0;
    if y <= -180.0 {
        y += 360.0;
    }
    if y > 180.0 {
        y -= 360.0;
    }
    if y.abs() < 1e-9 {
        0.0
    } else {
        y
    }
}

impl Search<'_> {
    fn place(&mut self, k: usize) -> bool {
        if k == self.order.len() {
            return true;
        }
        let i = self.order[k];
        let cands = self.candidates(i);
        let mut best: Option<(f64, Refusal)> = None;
        for c in &cands {
            if self.tried >= BUDGET {
                break;
            }
            self.tried += 1;
            self.bodies[i].pos = c.pos;
            self.bodies[i].yaw = c.yaw;
            let (missed, over) = self.violations(i);
            if missed.is_empty() && over.is_empty() {
                self.placed[i] = true;
                if self.place(k + 1) {
                    return true;
                }
                self.placed[i] = false;
                continue;
            }
            // Overlap is never allowed, so a pose that overlaps ranks behind every one that
            // only misses a relation.
            let score = over.iter().map(|o| 1e3 + o.depth).sum::<f64>()
                + missed.iter().map(|(_, m)| m.size()).sum::<f64>();
            if best.as_ref().is_none_or(|(s, _)| score < *s) {
                best = Some((
                    score,
                    Refusal {
                        item: i,
                        missed,
                        overlaps: over,
                    },
                ));
            }
        }
        self.bodies[i] = self.start[i].clone();
        if let Some((score, refusal)) = best {
            let deeper = match &self.worst {
                None => true,
                Some((wk, ws, _)) => k > *wk || (k == *wk && score < *ws),
            };
            if deeper {
                self.worst = Some((k, score, refusal));
            }
        }
        false
    }

    /// What item i, where it now stands, misses among relations whose ends are both placed (or
    /// i), and what placed item it passes into.
    fn violations(&self, i: usize) -> (Vec<(usize, Miss)>, Vec<Overlap>) {
        let on = |j: usize| j == i || self.placed[j];
        let missed = self
            .relations
            .iter()
            .enumerate()
            .filter(|(_, r)| (r.a == i || r.b == i) && r.a != r.b && on(r.a) && on(r.b))
            .map(|(k, r)| (k, miss(&self.bodies, r)))
            .filter(|(_, m)| !m.exact())
            .collect();
        let over = (0..self.bodies.len())
            .filter(|&j| j != i && self.placed[j] && !exempt(self.relations, i, j))
            .filter(|&j| self.pairs || !self.moving[j])
            .filter_map(|j| {
                let d = depth(&self.bodies[i], &self.bodies[j]);
                (d > EPS).then(|| {
                    let (a, b) = if i < j { (i, j) } else { (j, i) };
                    Overlap { a, b, depth: d }
                })
            })
            .collect();
        (missed, over)
    }

    /// The poses to try for item i, cheapest move first: where it stands, then each contact's
    /// places at each turn its relations suggest.
    fn candidates(&self, i: usize) -> Vec<Cand> {
        let start = &self.start[i];
        let mut yaws = vec![norm_yaw(start.yaw)];
        let mine: Vec<&Relation> = self
            .relations
            .iter()
            .filter(|r| r.a == i && r.b != i && self.placed[r.b])
            .collect();
        for r in &mine {
            let by = self.bodies[r.b].yaw;
            for q in 0..4 {
                yaws.push(norm_yaw(by + 90.0 * q as f64));
            }
        }
        // Turns that face what the relations name, seeded from where the item stands.
        for r in mine.iter().filter(|r| r.rel == Rel::Facing) {
            let to = sub(
                {
                    let c = self.bodies[r.b].world_center();
                    [c[0], c[2]]
                },
                [start.pos[0], start.pos[2]],
            );
            if dot(to, to) > 1e-12 {
                yaws.push(norm_yaw(ops::deg(ops::atan2(to[0], to[1]))));
            }
        }
        let mut seen: Vec<f64> = Vec::new();
        yaws.retain(|y| {
            let new = !seen.iter().any(|s| (s - y).abs() < 1e-9);
            if new {
                seen.push(*y);
            }
            new
        });
        let anchor = mine.iter().find(|r| r.rel.contact()).copied();
        // With no contact, a distance relation offers places off each side of its other item.
        let apart = mine
            .iter()
            .find(|r| matches!(r.rel, Rel::Near | Rel::Apart))
            .copied();
        let mut out = vec![Cand {
            pos: start.pos,
            yaw: norm_yaw(start.yaw),
            cost: 0.0,
        }];
        for &yaw in &yaws {
            let mut body = start.clone();
            body.yaw = yaw;
            let places = match (anchor, apart) {
                (Some(r), _) => self.contact_places(&body, r),
                (None, Some(r)) => self.gap_places(&body, r),
                (None, None) => vec![[start.pos[0], start.pos[1], start.pos[2], yaw]],
            };
            for mut pos in places {
                // Against forces its own turn; other contacts keep this one.
                let yaw = match anchor {
                    Some(r) if r.rel == Rel::Against => pos[3],
                    _ => yaw,
                };
                let mut b = body.clone();
                b.yaw = yaw;
                let p = [pos[0], pos[1], pos[2]];
                b.pos = p;
                if anchor.is_none_or(|r| r.rel != Rel::On) {
                    b.pos[1] = self.drop_y(i, &b);
                }
                pos = [b.pos[0], b.pos[1], b.pos[2], yaw];
                let d = [
                    pos[0] - start.pos[0],
                    pos[1] - start.pos[1],
                    pos[2] - start.pos[2],
                ];
                let mv = ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
                let turn = (norm_yaw(yaw - start.yaw)).abs();
                out.push(Cand {
                    pos: [pos[0], pos[1], pos[2]],
                    yaw,
                    cost: mv + turn * 1e-4,
                });
            }
        }
        // Stable: equal costs keep the order they were made in.
        let first = out.remove(0);
        out.sort_by(|x, y| x.cost.total_cmp(&y.cost));
        out.insert(0, first);
        out
    }

    /// Where item `body` rests when dropped onto what is placed under it: the highest top
    /// beneath its footprint that it doesn't already stand below.
    fn drop_y(&self, i: usize, body: &Body) -> f64 {
        let ra = body.rect();
        let mut top: Option<f64> = None;
        for (j, b) in self.bodies.iter().enumerate() {
            if j == i || !self.placed[j] || b.hollow || exempt(self.relations, i, j) {
                continue;
            }
            if !self.pairs && self.moving[j] {
                continue;
            }
            if depth2(&ra, &b.rect()) <= EPS {
                continue;
            }
            top = Some(top.map_or(b.top(), |t: f64| t.max(b.top())));
        }
        match top {
            Some(t) => t - body.center[1] + body.half[1],
            None => body.pos[1],
        }
    }

    /// The places `near` or `apart` offers item `body` off each side of placed `r.b`, squarely
    /// facing it at a gap that holds: touching, half of d and d for `near`, d for `apart`; along
    /// the side where it stands or centred.
    fn gap_places(&self, body: &Body, r: &Relation) -> Vec<[f64; 4]> {
        let rb = self.bodies[r.b].rect();
        let ra = body.rect();
        let gaps = if r.rel == Rel::Near {
            vec![0.0, r.d / 2.0, r.d]
        } else {
            vec![r.d]
        };
        let mut out = Vec::new();
        for (n, t, half, off) in sides(&rb) {
            let (s, here) = (ra.support(n), dot(sub(ra.c, rb.c), t).clamp(-half, half));
            for &g in &gaps {
                for tau in [here, 0.0] {
                    let c = [
                        rb.c[0] + n[0] * (off + s + g) + t[0] * tau,
                        rb.c[1] + n[1] * (off + s + g) + t[1] * tau,
                    ];
                    let d = sub(c, ra.c);
                    out.push([
                        body.pos[0] + d[0],
                        body.pos[1],
                        body.pos[2] + d[1],
                        body.yaw,
                    ]);
                }
            }
        }
        out
    }

    /// The places a contact relation offers item `body` against placed `r.b`: x, y, z and, for
    /// `against`, the yaw that turns a's back to the face.
    fn contact_places(&self, body: &Body, r: &Relation) -> Vec<[f64; 4]> {
        let b = &self.bodies[r.b];
        let rb = b.rect();
        let mut out = Vec::new();
        let sides = sides(&rb);
        match r.rel {
            Rel::On => {
                let ra = body.rect();
                let reach = [rb.h[0] - ra.support(rb.u), rb.h[1] - ra.support(rb.w)];
                let here = rb.local(ra.c);
                let mut spots = vec![
                    [
                        here[0].clamp(-reach[0].max(0.0), reach[0].max(0.0)),
                        here[1].clamp(-reach[1].max(0.0), reach[1].max(0.0)),
                    ],
                    [0.0, 0.0],
                ];
                for gx in [-1.0, -0.5, 0.5, 1.0] {
                    for gz in [-1.0, -0.5, 0.0, 0.5, 1.0] {
                        spots.push([gx * reach[0].max(0.0), gz * reach[1].max(0.0)]);
                    }
                }
                for s in spots {
                    let c = [
                        rb.c[0] + rb.u[0] * s[0] + rb.w[0] * s[1],
                        rb.c[1] + rb.u[1] * s[0] + rb.w[1] * s[1],
                    ];
                    let off = sub(c, ra.c);
                    let y = b.top() - body.center[1] + body.half[1];
                    out.push([body.pos[0] + off[0], y, body.pos[2] + off[1], body.yaw]);
                }
            }
            Rel::NextTo | Rel::Against => {
                for (n, t, half, off) in sides {
                    let mut a = body.clone();
                    if r.rel == Rel::Against {
                        // Front along the face's normal, so the back meets the face.
                        a.yaw = norm_yaw(ops::deg(ops::atan2(n[0], n[1])));
                    }
                    let ra = a.rect();
                    let s = ra.support(n);
                    let e = ra.support(t);
                    let mut taus = vec![
                        dot(sub(ra.c, rb.c), t).clamp(-(half - e).max(0.0), (half - e).max(0.0)),
                        0.0,
                        half - e,
                        -(half - e),
                        half,
                        -half,
                        half + e,
                        -(half + e),
                    ];
                    // Flush beside each placed item along this face.
                    for (j, o) in self.bodies.iter().enumerate() {
                        if j == r.b || !self.placed[j] || o.hollow {
                            continue;
                        }
                        let ro = o.rect();
                        let mid = dot(sub(ro.c, rb.c), t);
                        let ext = ro.support(t);
                        taus.push(mid + ext + e);
                        taus.push(mid - ext - e);
                    }
                    for tau in taus {
                        let c = [
                            rb.c[0] + n[0] * (off + s) + t[0] * tau,
                            rb.c[1] + n[1] * (off + s) + t[1] * tau,
                        ];
                        let d = sub(c, ra.c);
                        out.push([a.pos[0] + d[0], a.pos[1], a.pos[2] + d[1], a.yaw]);
                    }
                }
            }
            _ => {}
        }
        out
    }
}

/// A footprint's four side faces: the outward normal, the direction along the face, the half
/// length along it and the half depth to it.
fn sides(rb: &Rect) -> [([f64; 2], [f64; 2], f64, f64); 4] {
    [
        (rb.u, rb.w, rb.h[1], rb.h[0]),
        ([-rb.u[0], -rb.u[1]], rb.w, rb.h[1], rb.h[0]),
        (rb.w, rb.u, rb.h[0], rb.h[1]),
        ([-rb.w[0], -rb.w[1]], rb.u, rb.h[0], rb.h[1]),
    ]
}

// ---- the document: arrange@1 items, their solve as an operator runs it, break-outs and the audit

pub const KIND: &str = "arrange@1";
/// The refusal of a set the solve can't satisfy.
pub const UNSATISFIED: &str = "arrange_unsatisfied";
/// The wrong programs the criteria plant (scenario `planted`).
pub const IGNORES_PAIR_OVERLAP: &str = "arrange_ignores_pair_overlap";
pub const SOLVES_PER_FRAME: &str = "arrange_solves_per_frame";
pub const PLANTED: [&str; 2] = [IGNORES_PAIR_OVERLAP, SOLVES_PER_FRAME];

/// An item's transform as the solve and the audit read it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct At {
    pub pos: V3,
    pub rot: V3,
    pub scale: V3,
}

impl At {
    pub fn of(at: Option<&Value>) -> At {
        let three = |name: &str, fill: f64| {
            let mut out = [fill; 3];
            if let Some(Value::Array(a)) = at.and_then(|a| a.get(name)) {
                for (o, x) in out.iter_mut().zip(a) {
                    *o = x.as_f64().unwrap_or(fill);
                }
            }
            out
        };
        At {
            pos: three("pos", 0.0),
            rot: three("rot", 0.0),
            scale: three("scale", 1.0),
        }
    }
}

pub fn is_arrangement(item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some(KIND)
}

fn ids(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect()
}

/// The items an arrangement places: its `items` less those a patch broke out.
pub fn placed_ids(item: &Value) -> Vec<String> {
    let out = ids(item.pointer("/params/broken_out"));
    ids(item.pointer("/params/items"))
        .into_iter()
        .filter(|i| !out.contains(i))
        .collect()
}

/// A solid an arrangement reads: an item with a three-number `params.size`.
pub fn is_solid(item: &Value) -> bool {
    !is_arrangement(item) && dims_of(item).is_some()
}

/// A solid: an item with a three-number `params.size`, its bounds centred on its position. A
/// light's `size` is what it lights (a probe's box), never a body, written or at its default.
fn dims_of(item: &Value) -> Option<V3> {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
    if kind.starts_with("light.") {
        return None;
    }
    let a = item.pointer("/params/size")?.as_array()?;
    if a.len() != 3 {
        return None;
    }
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

fn body(id: &str, size: V3, at: &At) -> Body {
    Body {
        id: id.to_string(),
        center: [0.0; 3],
        half: [
            size[0] * at.scale[0].abs() / 2.0,
            size[1] * at.scale[1].abs() / 2.0,
            size[2] * at.scale[2].abs() / 2.0,
        ],
        pos: at.pos,
        yaw: at.rot[1],
        hollow: false,
    }
}

/// Every solid in the document, in document order, with the transform `at_of` gives it.
fn solids(doc: &Value, at_of: &dyn Fn(&str, &Value) -> At) -> Vec<Body> {
    doc.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, item)| !is_arrangement(item))
        .filter_map(|(id, item)| Some(body(id, dims_of(item)?, &at_of(id, item))))
        .collect()
}

/// A collection as one hollow body: the box around its members' bounds.
fn collection(id: &str, members: &[String], bodies: &[Body]) -> Option<Body> {
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for b in bodies.iter().filter(|b| members.contains(&b.id)) {
        let y = [b.bottom(), b.top()];
        for p in b.rect().corners() {
            for (k, v) in [(0, p[0]), (2, p[1])] {
                lo[k] = lo[k].min(v);
                hi[k] = hi[k].max(v);
            }
        }
        lo[1] = lo[1].min(y[0]);
        hi[1] = hi[1].max(y[1]);
    }
    if lo[0] > hi[0] {
        return None;
    }
    let half = [
        (hi[0] - lo[0]) / 2.0,
        (hi[1] - lo[1]) / 2.0,
        (hi[2] - lo[2]) / 2.0,
    ];
    Some(Body {
        id: id.to_string(),
        center: [0.0; 3],
        half,
        pos: [lo[0] + half[0], lo[1] + half[1], lo[2] + half[2]],
        yaw: 0.0,
        hollow: true,
    })
}

/// One arrangement over the document's solids: the bodies (solids, then the collections its
/// relations name), which of them it moves, and its relations by index.
struct Set {
    bodies: Vec<Body>,
    moving: Vec<bool>,
    relations: Vec<Relation>,
}

/// The arrangement `id` read from the document, every solid where `at_of` puts it; with
/// `broken`, its broken-out items' relations too (the audit holds them, the solve doesn't).
fn set_of(
    doc: &Value,
    id: &str,
    at_of: &dyn Fn(&str, &Value) -> At,
    broken: bool,
) -> Result<Set, (&'static str, String)> {
    let item = doc
        .pointer(&format!("/items/{id}"))
        .cloned()
        .unwrap_or(Value::Null);
    let mut bodies = solids(doc, at_of);
    let placed = placed_ids(&item);
    let out = ids(item.pointer("/params/broken_out"));
    let mut relations = Vec::new();
    let list = item.pointer("/params/relations").and_then(Value::as_array);
    for (k, r) in list.into_iter().flatten().enumerate() {
        let path = format!("items/{id}/params/relations/{k}");
        let rel = r.get("rel").and_then(Value::as_str).and_then(Rel::parse);
        let (Some(a), Some(rel), Some(b)) = (
            r.get("a").and_then(Value::as_str),
            rel,
            r.get("b").and_then(Value::as_str),
        ) else {
            return Err(("bad_doc", path));
        };
        if !broken && (out.iter().any(|o| o == a) || out.iter().any(|o| o == b)) {
            continue;
        }
        let mut find = |name: &str| -> Option<usize> {
            if let Some(i) = bodies.iter().position(|x| x.id == name) {
                return Some(i);
            }
            let members = ids(doc.pointer(&format!("/collections/{name}/members")));
            let c = collection(name, &members, &bodies)?;
            bodies.push(c);
            Some(bodies.len() - 1)
        };
        let (Some(a), Some(b)) = (find(a), find(b)) else {
            return Err(("bad_doc", path));
        };
        let d = r.get("d").and_then(Value::as_f64).unwrap_or(0.0);
        relations.push(Relation { a, rel, b, d });
    }
    let moving = bodies.iter().map(|b| placed.contains(&b.id)).collect();
    Ok(Set {
        bodies,
        moving,
        relations,
    })
}

/// Each arranged item's solved transform: position and rotation, by ID.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Arranged(pub BTreeMap<String, (V3, V3)>);

impl deep_canvas::schedule::Canonical for Arranged {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&self.0, out);
    }
}

impl Arranged {
    /// `doc` as a frame draws it: each arranged item's `at` at its solved place. A draw path that
    /// reads the document rather than `core.transform` takes the solve this way, never solving.
    pub fn apply(&self, doc: &mut Value) {
        let Some(items) = doc.get_mut("items").and_then(Value::as_object_mut) else {
            return;
        };
        for (id, (pos, rot)) in &self.0 {
            let Some(item) = items.get_mut(id).and_then(Value::as_object_mut) else {
                continue;
            };
            let at = item
                .entry("at")
                .or_insert_with(|| Value::Object(Default::default()));
            if let Some(at) = at.as_object_mut() {
                at.insert("pos".into(), serde_json::json!(pos));
                at.insert("rot".into(), serde_json::json!(rot));
            }
        }
    }
}

/// Solves arrangement `id` from where the document stands its items. A set that can't be
/// satisfied is the refusal's JSON: the relations still missed with `by` in m, and the pairs
/// that overlap with their depth.
pub fn solve_doc(
    doc: &Value,
    id: &str,
    planted: Option<&str>,
) -> Result<Arranged, (&'static str, String, Value)> {
    let at_of = |_: &str, item: &Value| At::of(item.get("at"));
    let set = set_of(doc, id, &at_of, false).map_err(|(c, p)| (c, p, Value::Null))?;
    let pairs = planted != Some(IGNORES_PAIR_OVERLAP);
    match solve(&set.bodies, &set.moving, &set.relations, pairs) {
        Ok(solved) => {
            let mut out = BTreeMap::new();
            for (i, b) in solved.bodies.iter().enumerate() {
                if !set.moving[i] {
                    continue;
                }
                let item = doc.pointer(&format!("/items/{}", b.id));
                let rot = At::of(item.and_then(|i| i.get("at"))).rot;
                out.insert(b.id.clone(), (b.pos, [rot[0], b.yaw, rot[2]]));
            }
            Ok(Arranged(out))
        }
        Err(r) => {
            let name = |i: usize| set.bodies[i].id.clone();
            let missed: Vec<Value> = r
                .missed
                .iter()
                .map(|(k, m)| {
                    let rel = &set.relations[*k];
                    json!({"a": name(rel.a), "rel": rel.rel.name(), "b": name(rel.b), "by": m.m, "deg": m.deg})
                })
                .collect();
            let overlaps: Vec<Value> = r
                .overlaps
                .iter()
                .map(|o| json!({"a": name(o.a), "b": name(o.b), "depth": o.depth}))
                .collect();
            Err((
                UNSATISFIED,
                format!("items/{id}/params/relations"),
                json!({"item": name(r.item), "missed": missed, "overlaps": overlaps}),
            ))
        }
    }
}

/// A whole revision that moves an arranged item from where the last one had it breaks the item
/// out of its arrangement, as a recipe instance's derived item breaks out: it joins the
/// arrangement's `broken_out` and keeps the place the revision gives it. Earlier break-outs carry.
pub fn carry_break_outs(previous: Option<&Value>, doc: &mut Value) {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return;
    };
    let mut updates = Vec::new();
    for (id, item) in items.iter().filter(|(_, i)| is_arrangement(i)) {
        let before = previous.and_then(|p| p.pointer(&format!("/items/{id}")));
        let mut out: BTreeSet<String> = ids(item.pointer("/params/broken_out"))
            .into_iter()
            .collect();
        out.extend(ids(before.and_then(|b| b.pointer("/params/broken_out"))));
        if let Some(prev) = previous {
            for m in ids(item.pointer("/params/items")) {
                let was = prev.pointer(&format!("/items/{m}/at"));
                let now = items.get(&m).and_then(|i| i.get("at"));
                if was.is_some() && was != now {
                    out.insert(m);
                }
            }
        }
        let listed = ids(item.pointer("/params/items"));
        out.retain(|m| listed.contains(m));
        if !out.is_empty() {
            updates.push((id.clone(), out));
        }
    }
    for (id, out) in updates {
        if let Some(params) = doc
            .pointer_mut(&format!("/items/{id}/params"))
            .and_then(Value::as_object_mut)
        {
            params.insert("broken_out".into(), json!(out));
        }
    }
}

/// Every corner of a's bounds within 0.1 mm of the same corner of b's.
fn coincident(a: &Body, b: &Body) -> bool {
    let close = |x: f64, y: f64| (x - y).abs() <= 1e-4;
    close(a.bottom(), b.bottom())
        && close(a.top(), b.top())
        && a.rect()
            .corners()
            .iter()
            .zip(b.rect().corners().iter())
            .all(|(p, q)| close(p[0], q[0]) && close(p[1], q[1]))
}

/// The geometry audit of a scene (Geometry audit: scenes) on every solid where `at_of` puts it:
/// pairs of one geometry placed as one, pairs that pass into each other past the document's
/// tolerance, items nothing holds up that aren't declared floating, and every arrangement's
/// relations the scene misses.
pub fn audit(doc: &Value, at_of: &dyn Fn(&str, &Value) -> At) -> Vec<Value> {
    let bodies = solids(doc, at_of);
    let tol = doc
        .pointer("/audit/overlap/tolerance")
        .and_then(Value::as_f64)
        .unwrap_or(0.002);
    let support_tol = doc
        .pointer("/audit/support/tolerance")
        .and_then(Value::as_f64)
        .unwrap_or(0.005);
    let floating = ids(doc.pointer("/audit/support/floating"));
    let mut out = Vec::new();
    // Before the overlap pass: two items of one geometry with every corner of their bounds
    // within 0.1 mm of the same corner are one item placed twice; the fix removes one.
    let items = doc.get("items").and_then(Value::as_object);
    let shape = |id: &str| {
        let item = items?.get(id)?;
        let mut params = item.get("params")?.clone();
        params.as_object_mut()?.remove("paint");
        Some((
            item.get("kind")?.clone(),
            params,
            item.pointer("/at/scale").cloned(),
        ))
    };
    let mut twins = Vec::new();
    for i in 0..bodies.len() {
        for j in i + 1..bodies.len() {
            let (a, b) = (&bodies[i], &bodies[j]);
            if coincident(a, b) && shape(&a.id).is_some_and(|s| Some(s) == shape(&b.id)) {
                twins.push((i, j));
                out.push(json!({"check": "coincident", "ids": [a.id, b.id],
                                "fix": format!("remove {} or {}", a.id, b.id)}));
            }
        }
    }
    for o in overlaps(&bodies, &[], tol) {
        let (a, b) = (&bodies[o.a].id, &bodies[o.b].id);
        // A coincident pair still passes into itself, but its fix is never a move.
        let fix = if twins.contains(&(o.a, o.b)) {
            format!("remove {a} or {b}")
        } else {
            format!("move {a} or {b} apart by {:.4} m", o.depth)
        };
        out.push(json!({"check": "overlap", "ids": [a, b], "depth": o.depth, "fix": fix}));
    }
    for (i, b) in bodies.iter().enumerate() {
        if floating.contains(&b.id) || support(&bodies, i, support_tol).is_some() {
            continue;
        }
        out.push(json!({"check": "support", "ids": [b.id], "fix": format!("rest {} on something, or declare it floating", b.id)}));
    }
    for (id, _) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| is_arrangement(i))
    {
        let Ok(set) = set_of(doc, id, at_of, true) else {
            continue;
        };
        for r in &set.relations {
            let m = miss(&set.bodies, r);
            if m.held() {
                continue;
            }
            let (a, b) = (&set.bodies[r.a].id, &set.bodies[r.b].id);
            out.push(
                json!({"check": "relation", "ids": [a, b], "arrangement": id,
                            "a": a, "rel": r.rel.name(), "b": b, "by": m.m, "deg": m.deg}),
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A floor, a 1 m table at the origin and a 0.4 m stool at `stool`, the stool arranged by `rel`.
    fn room(stool: [f64; 3], rel: Value) -> Value {
        let item = |size: [f64; 3], pos: [f64; 3]| json!({"kind": "mark.box@1", "params": {"size": size}, "at": {"pos": pos}});
        json!({"items": {
            "floor": item([10.0, 0.1, 10.0], [0.0, -0.05, 0.0]),
            "table": item([1.0, 0.75, 1.0], [0.0, 0.375, 0.0]),
            "stool": item([0.4, 0.5, 0.4], stool),
            "set": {"kind": "arrange@1", "params": {"items": ["stool"], "relations": [rel]}},
        }})
    }

    /// The gap between the solved stool's bounds and the table's, both axis-aligned here
    /// (negative when they pass into each other).
    fn gap(doc: &Value) -> f64 {
        let solved = solve_doc(doc, "set", None).expect("the set solves");
        let (pos, rot) = solved.0["stool"];
        assert_eq!(rot[1] % 90.0, 0.0, "the stool stays square to the table");
        let dx = pos[0].abs() - 0.7;
        let dz = pos[2].abs() - 0.7;
        if dx > 0.0 && dz > 0.0 {
            (dx * dx + dz * dz).sqrt()
        } else {
            dx.max(dz)
        }
    }

    #[test]
    fn near_brings_a_far_item_within_its_distance() {
        let doc = room(
            [3.0, 0.25, 0.0],
            json!({"a": "stool", "rel": "near", "b": "table", "d": 0.5}),
        );
        let g = gap(&doc);
        assert!(
            (-0.001..=0.501).contains(&g),
            "the stool stands within 0.5 m of the table, not in it: {g}"
        );
    }

    #[test]
    fn apart_moves_a_touching_item_at_least_its_distance_away() {
        let doc = room(
            [0.7, 0.25, 0.0],
            json!({"a": "stool", "rel": "apart", "b": "table", "d": 1.0}),
        );
        let g = gap(&doc);
        assert!(
            g >= 0.999,
            "the stool stands at least 1 m from the table: {g}"
        );
    }

    #[test]
    fn the_audit_names_one_geometry_placed_twice_as_coincident_and_never_fixes_it_by_a_move() {
        let chair = |paint: &str| {
            json!({"kind": "mark.box@1", "params": {"size": [0.5, 0.9, 0.5], "paint": {"fill": {"role": paint}}},
                   "at": {"pos": [1.0, 0.45, 1.0]}})
        };
        let doc = json!({"audit": {"support": {"floating": ["chair_a", "chair_b", "stool"]}}, "items": {
            "chair_a": chair("accent"),
            "chair_b": chair("ink"),
            "stool": {"kind": "mark.box@1", "params": {"size": [0.5, 0.5, 0.5]}, "at": {"pos": [1.0, 0.45, 1.0]}},
        }});
        let failures = audit(&doc, &|_, item| At::of(item.get("at")));
        let named = |check: &str| -> Vec<Value> {
            failures
                .iter()
                .filter(|f| f["check"] == check)
                .map(|f| f["ids"].clone())
                .collect()
        };
        assert_eq!(
            named("coincident"),
            vec![json!(["chair_a", "chair_b"])],
            "{failures:?}"
        );
        let fixes: Vec<_> = failures
            .iter()
            .filter(|f| f["check"] == "overlap")
            .map(|f| {
                (
                    f["ids"].clone(),
                    f["fix"]
                        .as_str()
                        .unwrap_or("")
                        .split(' ')
                        .next()
                        .unwrap_or("")
                        .to_owned(),
                )
            })
            .collect();
        assert_eq!(
            fixes,
            vec![
                (json!(["chair_a", "chair_b"]), "remove".to_owned()),
                (json!(["chair_a", "stool"]), "move".to_owned()),
                (json!(["chair_b", "stool"]), "move".to_owned()),
            ],
            "the coincident pair's overlap removes one; a different geometry in the same place moves: {failures:?}"
        );
    }
}
