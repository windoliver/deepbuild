//! Modifier: bevel and Modifier: normals (canvas primitives; issue #440) on the polygon view.
//!
//! Bevel rounds the edges its limit picks: each face's corners move in off the beveled edges, a
//! strip of `segments` quads runs along each beveled edge on a superellipse profile (shape 0.5 a
//! quarter circle, 1 the square corner), and a patch closes each vertex the strips meet at, so a
//! closed mesh stays closed. A corner on one beveled edge slides along its other edge, shared by
//! both faces on that edge, and a face whose corner doesn't move takes the slide point into its
//! own outline, so no edge is ever split on one side only. Each new face takes its part and face
//! attributes from the nearer source face, ties to the lower index. harden gives the large faces
//! flat corner normals and the bevel faces normals that run from one side to the other.
//!
//! Normals writes corner normals: weighted, by area, corner angle or both, from the strongest
//! faces at each point (a bevel's own faces are weak, so the large faces beside them stay flat);
//! by_angle, smooth within each fan of faces no edge sharper than the angle splits.
//!
//! Both read the polygon view's flat half-edge table ([`Halves`]; #2017), not maps keyed by edge
//! or by point.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::BTreeMap;

use deep_canvas::ops::{acos, cos, pow, rad, sin};

use crate::geom::{add, cross, dot, length, scale, sub, unit, V2, V3};
use crate::poly::{counted, Halves, Poly};

/// Which edges a bevel takes.
#[derive(Clone, Debug, PartialEq)]
pub enum Limit {
    Angle(f64),
    Parts(Vec<u32>),
    All,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bevel {
    pub width: f64,
    pub segments: usize,
    pub shape: f64,
    pub limit: Limit,
    pub clamp: bool,
    pub harden: bool,
}

/// What a bevel leaves: the polygon view, each face's corner normals (when hardened), and which
/// faces are weak (its own).
pub struct Beveled {
    pub poly: Poly,
    pub normals: Option<Vec<Vec<V3>>>,
    pub weak: Vec<bool>,
}

/// Where the points a bevel's faces name sit in one numbering: each old point; each corner's
/// inset point (both of the face's edges at the corner beveled), by its face's first corner at
/// its point; the slide point on an unbeveled edge at each end; and a beveled edge's profile
/// points 1..segments − 1 at each end, by the edge's place among the beveled ones.
struct Slots {
    inset: u32,
    slide: u32,
    profile: u32,
    s: u32,
}

impl Slots {
    fn inset(&self, corner: u32) -> u32 {
        self.inset + corner
    }
    fn slide(&self, edge: u32, end: u32) -> u32 {
        self.slide + 2 * edge + end
    }
    fn profile(&self, rank: u32, end: u32, k: u32) -> u32 {
        self.profile + (2 * rank + end) * (self.s - 1) + k - 1
    }
}

/// The bevel's new faces, flat: each one's points (as slots) from its `start`, its source face,
/// whether it is the bevel's own, and its corner normals (when hardened).
struct NewFaces {
    start: Vec<u32>,
    points: Vec<u32>,
    src: Vec<u32>,
    weak: Vec<bool>,
    normals: Vec<V3>,
}

impl NewFaces {
    fn with_capacity(faces: usize, points: usize, normals: bool) -> NewFaces {
        NewFaces {
            start: Vec::with_capacity(faces),
            points: Vec::with_capacity(points),
            src: Vec::with_capacity(faces),
            weak: Vec::with_capacity(faces),
            normals: Vec::with_capacity(if normals { points } else { 0 }),
        }
    }
    fn open(&mut self, src: u32, weak: bool) {
        self.start.push(self.points.len() as u32);
        self.src.push(src);
        self.weak.push(weak);
    }
    fn face(&self, k: usize) -> &[u32] {
        let end = self
            .start
            .get(k + 1)
            .map_or(self.points.len(), |e| *e as usize);
        &self.points[self.start[k] as usize..end]
    }
}

/// Points in (x, y, z) order.
fn order3(a: &V3, b: &V3) -> Ordering {
    a[0].total_cmp(&b[0])
        .then(a[1].total_cmp(&b[1]))
        .then(a[2].total_cmp(&b[2]))
}

/// The mean of `pts`, summed in (x, y, z) order so it never depends on theirs (equal points are
/// equal bits, so an unstable sort orders them as a stable one would).
fn centroid(pts: &mut [V3]) -> V3 {
    pts.sort_unstable_by(order3);
    let n = pts.len().max(1) as f64;
    scale(pts.iter().fold([0.0; 3], |s, q| add(s, *q)), 1.0 / n)
}

/// The angle in degrees between two unit vectors.
fn angle(a: V3, b: V3) -> f64 {
    deep_canvas::ops::deg(acos(dot(a, b).clamp(-1.0, 1.0)))
}

/// The mean of two numbers, the same whichever comes first.
fn mean2(a: f64, b: f64) -> f64 {
    (a + b) / 2.0
}

/// Which edges the limit bevels: each edge with two faces that it picks.
fn beveled(h: &Halves, normal: &[V3], b: &Bevel, part_of: &[Option<u32>]) -> Vec<bool> {
    (0..h.ends.len())
        .map(|e| {
            let on = h.on(e);
            if on.len() != 2 {
                return false;
            }
            let fs = [on[0], on[1]].map(|c| h.face[c as usize] as usize);
            match &b.limit {
                Limit::All => true,
                Limit::Angle(a) => angle(normal[fs[0]], normal[fs[1]]) > *a,
                Limit::Parts(parts) => fs
                    .iter()
                    .any(|&f| part_of[f].is_some_and(|q| parts.contains(&q))),
            }
        })
        .collect()
}

/// The profile's (x, y) weights of its two arms at each step 0..=s, mirrored so a profile read
/// from either side gives the same points.
fn profile_weights(s: usize, shape: f64) -> (Vec<V2>, bool) {
    let r = if shape >= 1.0 {
        f64::INFINITY
    } else {
        2.0 * shape.max(1e-6) / (1.0 - shape)
    };
    let w: Vec<V2> = (0..=s)
        .map(|k| {
            let k = k.min(s - k);
            let phi = rad(90.0) * k as f64 / s as f64;
            let e = 2.0 / r;
            [pow(cos(phi), e), pow(sin(phi), e)]
        })
        .collect();
    let weights = (0..=s)
        .map(|k| if 2 * k <= s { w[k] } else { [w[k][1], w[k][0]] })
        .collect();
    (weights, r.is_infinite())
}

pub fn bevel(p: &Poly, b: &Bevel, part_of: &[Option<u32>]) -> Beveled {
    let h = Halves::of(p);
    let (faces, corners, edges) = (p.faces.len(), h.from.len(), h.ends.len());
    let normal: Vec<V3> = (0..faces).map(|f| unit(p.normal(f))).collect();
    let bev = beveled(&h, &normal, b, part_of);
    let bev_in = |c: usize| bev[h.edge[h.prev(c)] as usize];
    let bev_out = |c: usize| bev[h.edge[c] as usize];
    let pt = |i: u32| p.points[i as usize];
    let dir = |from: u32, to: u32| unit(sub(pt(to), pt(from)));
    // Each corner's point before it, and the sine between its two edges.
    let before: Vec<u32> = (0..corners).map(|c| h.from[h.prev(c)]).collect();
    let sin_at: Vec<f64> = (0..corners)
        .map(|c| {
            let v = h.from[c];
            length(cross(dir(v, before[c]), dir(v, h.to[c])))
        })
        .collect();
    // The width, clamped so no corner moves past the middle of an edge it slides along.
    let mut width = b.width;
    if b.clamp {
        for c in 0..corners {
            let (bi, bo) = (bev_in(c), bev_out(c));
            if !(bi || bo) {
                continue;
            }
            let s = sin_at[c].max(1e-9);
            let v = h.from[c];
            for (q, moved) in [(before[c], bo), (h.to[c], bi)] {
                if moved {
                    width = width.min(0.5 * length(sub(pt(q), pt(v))) * s);
                }
            }
        }
    }
    // Which end of edge `e` point `v` is.
    let end = |e: u32, v: u32| u32::from(h.ends[e as usize].1 == v);
    // Slide distances per (unbeveled edge, end), from each face that slides along it: how many,
    // and the first two.
    let mut slid: Vec<(u32, f64, f64)> = vec![(0, 0.0, 0.0); 2 * edges];
    for c in 0..corners {
        let e = match (bev_in(c), bev_out(c)) {
            (true, false) => h.edge[c],
            (false, true) => h.edge[h.prev(c)],
            _ => continue,
        };
        let d = width / sin_at[c].max(1e-9);
        let row = &mut slid[(2 * e + end(e, h.from[c])) as usize];
        row.0 += 1;
        match row.0 {
            1 => row.1 = d,
            2 => row.2 = d,
            _ => {}
        }
    }
    let ranked: Vec<u32> = (0..edges as u32).filter(|&e| bev[e as usize]).collect();
    let mut rank = vec![0u32; edges];
    for (r, &e) in ranked.iter().enumerate() {
        rank[e as usize] = r as u32;
    }
    let s = b.segments.max(1);
    let slots = Slots {
        inset: p.points.len() as u32,
        slide: (p.points.len() + corners) as u32,
        profile: (p.points.len() + corners + 2 * edges) as u32,
        s: s as u32,
    };
    let total = slots.profile as usize + 2 * ranked.len() * (s - 1);
    // Each slot's position and the old point it carries attributes from.
    let mut pos: Vec<V3> = vec![[0.0; 3]; total];
    let mut from: Vec<u32> = vec![0; total];
    for (v, q) in p.points.iter().enumerate() {
        pos[v] = *q;
        from[v] = v as u32;
    }
    for (e, &(lo, hi)) in h.ends.iter().enumerate() {
        for (k, v) in [lo, hi].into_iter().enumerate() {
            let d = slid[2 * e + k];
            if d.0 == 0 {
                continue;
            }
            let dist = if d.0 == 2 { mean2(d.1, d.2) } else { d.1 };
            let other = if lo == v { hi } else { lo };
            let q = slots.slide(e as u32, k as u32) as usize;
            pos[q] = add(pt(v), scale(dir(v, other), dist));
            from[q] = v;
        }
    }
    // The point a corner moves to.
    let point_of = |c: usize| -> u32 {
        let v = h.from[c];
        match (bev_in(c), bev_out(c)) {
            (true, true) => slots.inset(h.first[c]),
            (true, false) => slots.slide(h.edge[c], end(h.edge[c], v)),
            (false, true) => {
                let e = h.edge[h.prev(c)];
                slots.slide(e, end(e, v))
            }
            (false, false) => v,
        }
    };
    let has_slide = |e: u32, v: u32| slid[(2 * e + end(e, v)) as usize].0 > 0;
    // Each face's new outline.
    let mut out = NewFaces::with_capacity(2 * faces, 2 * corners, b.harden);
    for (f, &n_f) in normal.iter().enumerate() {
        out.open(f as u32, false);
        for c in h.start[f] as usize..h.start[f + 1] as usize {
            let (v, q) = (h.from[c], point_of(c));
            if bev_in(c) && bev_out(c) {
                let s = sin_at[c].max(1e-9);
                let at = add(
                    pt(v),
                    scale(add(dir(v, before[c]), dir(v, h.to[c])), width / s),
                );
                pos[q as usize] = at;
                from[q as usize] = v;
            }
            let old = q == v;
            let (incoming, outgoing) = (h.edge[h.prev(c)], h.edge[c]);
            if old && has_slide(incoming, v) {
                out.points.push(slots.slide(incoming, end(incoming, v)));
            }
            out.points.push(q);
            if old && has_slide(outgoing, v) {
                out.points.push(slots.slide(outgoing, end(outgoing, v)));
            }
        }
        if b.harden {
            let n = out.points.len() - out.start[f] as usize;
            out.normals.extend(std::iter::repeat_n(n_f, n));
        }
    }
    let (w, square) = profile_weights(s, b.shape);
    // Each beveled edge's sides: the corners on its half-edges lo → hi (face f) and hi → lo
    // (face g), from which each side's point at either end is found.
    let sides: Vec<(usize, usize)> = ranked
        .iter()
        .map(|&e| {
            let (lo, hi) = h.ends[e as usize];
            let x = h
                .across(e as usize, lo, hi)
                .expect("a beveled edge has two half-edges");
            let y = h
                .across(e as usize, hi, lo)
                .expect("a beveled edge has two half-edges");
            (x, y)
        })
        .collect();
    // The corner of side x (or y) at point v: its face's first corner there.
    let at_end = |x: usize, v: u32| -> usize {
        if h.from[x] == v {
            h.first[x] as usize
        } else {
            h.first[h.next(x)] as usize
        }
    };
    // Each beveled edge's profile at each end, from face f's side to g's.
    for (r, &e) in ranked.iter().enumerate() {
        let (lo, hi) = h.ends[e as usize];
        let (x, y) = sides[r];
        for v in [lo, hi] {
            let other = if v == lo { hi } else { lo };
            let (pf, pg) = (
                pos[point_of(at_end(x, v)) as usize],
                pos[point_of(at_end(y, v)) as usize],
            );
            let d = dir(v, other);
            let along = mean2(dot(sub(pf, pt(v)), d), dot(sub(pg, pt(v)), d));
            let corner_pt = add(pt(v), scale(d, along));
            let centre = sub(add(pf, pg), corner_pt);
            let (arm_f, arm_g) = (sub(pf, centre), sub(pg, centre));
            for (k, &[wx, wy]) in w.iter().enumerate().take(s).skip(1) {
                let q = slots.profile(r as u32, end(e, v), k as u32) as usize;
                pos[q] = if square {
                    corner_pt
                } else {
                    add(centre, add(scale(arm_f, wx), scale(arm_g, wy)))
                };
                from[q] = v;
            }
        }
    }
    // Point k of the profile at end v of the beveled edge ranked r, from face `from_face`'s side.
    let profile = |r: usize, v: u32, from_face: u32, k: usize| -> u32 {
        let (x, y) = sides[r];
        let k = if from_face == h.face[x] { k } else { s - k };
        match k {
            0 => point_of(at_end(x, v)),
            k if k == s => point_of(at_end(y, v)),
            k => slots.profile(r as u32, end(ranked[r], v), k as u32),
        }
    };
    // Each face's corners sorted and its centroid, for the nearer source face.
    let mut sorted: Vec<V3> = h.from.iter().map(|&v| pt(v)).collect();
    let centres: Vec<V3> = (0..faces)
        .map(|f| centroid(&mut sorted[h.start[f] as usize..h.start[f + 1] as usize]))
        .collect();
    let corners_of =
        |f: u32| &sorted[h.start[f as usize] as usize..h.start[f as usize + 1] as usize];
    // The nearer source face; a tie goes to the face whose corners, sorted, sort first, so a tie
    // never depends on the faces' order.
    let nearer = |cands: &mut [u32], at: V3| -> u32 {
        cands.sort_by(|&a, &b| {
            let (ca, cb) = (corners_of(a), corners_of(b));
            ca.iter()
                .zip(cb)
                .map(|(x, y)| order3(x, y))
                .find(|o| o.is_ne())
                .unwrap_or(ca.len().cmp(&cb.len()))
        });
        let mut best = cands[0];
        let mut dist = f64::INFINITY;
        for &c in cands.iter() {
            let d = dot(sub(at, centres[c as usize]), normal[c as usize]).abs();
            if d < dist - 1e-12 * (1.0 + d.abs()) {
                dist = d;
                best = c;
            }
        }
        best
    };
    // Strips: row k between profile points k and k + 1, wound so its first row twins face f's
    // edge.
    let mut point_normal: Vec<Option<V3>> = vec![None; if b.harden { total } else { 0 }];
    let mut scratch: Vec<V3> = Vec::new();
    for (r, &e) in ranked.iter().enumerate() {
        let (lo, hi) = h.ends[e as usize];
        let (f, g) = (h.face[sides[r].0], h.face[sides[r].1]);
        let ra = |k: usize| profile(r, lo, f, k);
        let rb = |k: usize| profile(r, hi, f, k);
        let normal_at = |k: usize| -> V3 {
            let [x, y] = w[k];
            unit(add(
                scale(normal[f as usize], x),
                scale(normal[g as usize], y),
            ))
        };
        if b.harden {
            for k in 0..=s {
                point_normal[ra(k) as usize] = Some(normal_at(k));
                point_normal[rb(k) as usize] = Some(normal_at(k));
            }
        }
        for k in 0..s {
            let quad = [ra(k), ra(k + 1), rb(k + 1), rb(k)];
            let src = if 2 * k + 1 < s {
                f
            } else if 2 * k + 1 > s {
                g
            } else {
                scratch.clear();
                scratch.extend(quad.iter().map(|&q| pos[q as usize]));
                nearer(&mut [f, g], centroid(&mut scratch))
            };
            out.open(src, true);
            out.points.extend(quad);
            if b.harden {
                let (n0, n1) = (normal_at(k), normal_at(k + 1));
                out.normals.extend([n0, n1, n1, n0]);
            }
        }
    }
    // Patches: around each vertex a strip ends at, the faces in turn across their incoming
    // edges, each one's corner point and, across a beveled edge, that edge's profile.
    let by_point = counted(corners, p.points.len(), |c| h.from[c as usize] as usize);
    let (mut ring, mut cands): (Vec<u32>, Vec<u32>) = (Vec::new(), Vec::new());
    for at_v in by_point.chunk_by(|a, b| h.from[*a as usize] == h.from[*b as usize]) {
        let v = h.from[at_v[0] as usize];
        // Each face's first corner at v, in corner order.
        let firsts = || at_v.iter().map(|&c| h.first[c as usize] as usize);
        if !firsts().any(|c| bev_in(c) || bev_out(c)) {
            continue;
        }
        // The face before (and after) one round v, by its corner at v.
        let pred = |c: usize| -> Option<usize> {
            h.across(h.edge[c] as usize, h.to[c], v)
                .map(|x| h.first[h.next(x)] as usize)
        };
        let succ = |c: usize| -> Option<usize> {
            h.across(h.edge[h.prev(c)] as usize, v, before[c])
                .map(|x| h.first[x] as usize)
        };
        // A start: a face no face precedes (an open fan) or the lowest.
        let start = firsts()
            .find(|&c| pred(c).is_none())
            .unwrap_or(h.first[at_v[0] as usize] as usize);
        ring.clear();
        if pred(start).is_none() {
            ring.push(v);
        }
        let mut c = start;
        for _ in 0..at_v.len() {
            ring.push(point_of(c));
            let Some(next) = succ(c) else { break };
            if bev_in(c) {
                let r = rank[h.edge[h.prev(c)] as usize] as usize;
                ring.extend((1..s).map(|k| profile(r, v, h.face[c], k)));
            }
            if next == start {
                break;
            }
            c = next;
        }
        ring.dedup();
        while ring.len() > 1 && ring.first() == ring.last() {
            ring.pop();
        }
        if ring.len() < 3 {
            continue;
        }
        scratch.clear();
        scratch.extend(ring.iter().map(|&q| pos[q as usize]));
        let centre = centroid(&mut scratch);
        cands.clear();
        cands.extend(at_v.iter().map(|&c| h.face[c as usize]));
        let src = nearer(&mut cands, centre);
        out.open(src, true);
        out.points.extend_from_slice(&ring);
        if b.harden {
            let fallback = unit(at_v.iter().fold([0.0; 3], |acc, &c| {
                add(acc, normal[h.face[c as usize] as usize])
            }));
            out.normals.extend(
                ring.iter()
                    .map(|&q| point_normal[q as usize].unwrap_or(fallback)),
            );
        }
    }
    assemble(p, out, &pos, &from, b.harden)
}

/// The bevel's polygon view from its new faces: points numbered in order of first appearance,
/// so the numbering never depends on the slots, each carrying its old point's attributes.
fn assemble(p: &Poly, faces: NewFaces, pos: &[V3], from: &[u32], harden: bool) -> Beveled {
    let mut ids = vec![u32::MAX; pos.len()];
    let mut order: Vec<u32> = Vec::new();
    for &q in &faces.points {
        if ids[q as usize] == u32::MAX {
            ids[q as usize] = order.len() as u32;
            order.push(q);
        }
    }
    let mut out = Poly {
        points: order.iter().map(|&q| pos[q as usize]).collect(),
        attrs: p
            .attrs
            .iter()
            .map(|(k, values)| {
                let v = order.iter().map(|&q| values[from[q as usize] as usize]);
                (k.clone(), v.collect())
            })
            .collect(),
        faces: Vec::with_capacity(faces.src.len()),
        origin: Vec::with_capacity(faces.src.len()),
        uv: p.uv.as_ref().map(|_| Vec::with_capacity(faces.src.len())),
        ..Poly::default()
    };
    let maps: Vec<Option<UvMap>> = (0..p.faces.len()).map(|f| UvMap::of(p, f)).collect();
    let mut normals = Vec::with_capacity(if harden { faces.src.len() } else { 0 });
    for k in 0..faces.src.len() {
        let face = faces.face(k);
        let src = faces.src[k] as usize;
        out.faces
            .push(face.iter().map(|&q| ids[q as usize]).collect());
        out.origin.push(p.origin[src]);
        if let Some(uv) = &mut out.uv {
            let map = maps[src].as_ref();
            uv.push(
                face.iter()
                    .map(|&q| map.map_or([0.0; 2], |m| m.at(pos[q as usize])))
                    .collect(),
            );
        }
        if harden {
            let at = faces.start[k] as usize;
            normals.push(faces.normals[at..at + face.len()].to_vec());
        }
    }
    Beveled {
        poly: out,
        normals: harden.then_some(normals),
        weak: faces.weak,
    }
}

/// A face's uv as an affine map of its plane, fitted at its three corners that sort first (so it
/// never depends on where its list starts).
pub struct UvMap {
    o: V3,
    u: V3,
    v: V3,
    uv: [V2; 3],
}

impl UvMap {
    pub fn of(p: &Poly, f: usize) -> Option<UvMap> {
        let uv = p.uv.as_ref()?;
        let corners = p.faces[f]
            .iter()
            .zip(&uv[f])
            .map(|(&i, t)| (p.points[i as usize], *t));
        // A small face's corners stay on the stack.
        let n = p.faces[f].len().min(uv[f].len());
        let (mut small, mut large) = ([([0.0; 3], [0.0; 2]); 8], Vec::new());
        let cs: &mut [(V3, V2)] = if n <= small.len() {
            for (s, c) in small.iter_mut().zip(corners) {
                *s = c;
            }
            &mut small[..n]
        } else {
            large.extend(corners);
            &mut large
        };
        cs.sort_by(|a, b| order3(&a.0, &b.0));
        let o = cs[0];
        let a = cs.get(1)?;
        let c = cs
            .iter()
            .skip(2)
            .find(|c| length(cross(sub(a.0, o.0), sub(c.0, o.0))) > 1e-12)?;
        Some(UvMap {
            o: o.0,
            u: sub(a.0, o.0),
            v: sub(c.0, o.0),
            uv: [o.1, a.1, c.1],
        })
    }

    /// The uv at `q`, projected onto the plane.
    pub fn at(&self, q: V3) -> V2 {
        let d = sub(q, self.o);
        let (uu, uv, vv) = (
            dot(self.u, self.u),
            dot(self.u, self.v),
            dot(self.v, self.v),
        );
        let (du, dv) = (dot(d, self.u), dot(d, self.v));
        let det = uu * vv - uv * uv;
        let s = (du * vv - dv * uv) / det;
        let t = (dv * uu - du * uv) / det;
        let [a, b, c] = self.uv;
        [
            a[0] + s * (b[0] - a[0]) + t * (c[0] - a[0]),
            a[1] + s * (b[1] - a[1]) + t * (c[1] - a[1]),
        ]
    }
}

/// How corner normals are written.
#[derive(Clone, Debug, PartialEq)]
pub struct Normals {
    pub by_angle: bool,
    pub angle: f64,
    /// Area, corner angle, or both, for weighted.
    pub area: bool,
    pub corner_angle: bool,
    pub keep_sharp: bool,
}

/// Each face's corner normals. `weak` marks faces that count only where no strong face meets
/// the point; `sharp` (when keep_sharp) marks the edges the mesh already shades sharp.
pub fn normals(
    p: &Poly,
    opts: &Normals,
    weak: &[bool],
    sharp: &BTreeMap<(u32, u32), bool>,
    blocks: usize,
) -> Vec<Vec<V3>> {
    let sharp: Vec<((u32, u32), bool)> = sharp.iter().map(|(e, s)| (*e, *s)).collect();
    let mut flat = normals_sorted(p, opts, weak, &sharp, blocks).into_iter();
    p.faces
        .iter()
        .map(|c| flat.by_ref().take(c.len()).collect())
        .collect()
}

/// The most faces a fan walks to on each side of its corner.
const WALK: usize = 64;

/// [`normals`] with `sharp` as edges by their sorted ends, in that order, and the normals in one
/// list, face after face.
pub(crate) fn normals_sorted(
    p: &Poly,
    opts: &Normals,
    weak: &[bool],
    sharp: &[((u32, u32), bool)],
    blocks: usize,
) -> Vec<V3> {
    let h = Halves::of(p);
    let newell: Vec<V3> = (0..p.faces.len()).map(|f| p.normal(f)).collect();
    // The edges split: open or shared by more than two faces, sharper than the angle (by_angle),
    // or shaded sharp (keep_sharp).
    let marked = sharp_edges(&h.ends, sharp);
    let split: Vec<bool> = (0..h.ends.len())
        .map(|e| {
            let on = h.on(e);
            if on.len() != 2 {
                return true;
            }
            if opts.by_angle {
                let [a, b] = [on[0], on[1]].map(|c| unit(newell[h.face[c as usize] as usize]));
                return angle(a, b) > opts.angle;
            }
            opts.keep_sharp && marked[e]
        })
        .collect();
    let mut fan = Fans {
        steps: steps(&h, &split),
        n: newell.iter().map(|&q| unit(q)).collect(),
        area: newell.iter().map(|&q| 0.5 * length(q)).collect(),
        corner_angle: if opts.corner_angle && !opts.by_angle {
            corner_angles(p, &h)
        } else {
            Vec::new()
        },
        h,
        opts,
        weak,
        rank: Vec::new(),
        ranked: Vec::new(),
    };
    fan.rank_crowded(p.points.len());
    // A fan's lists, kept between corners (they never carry a result from one to the next).
    let lists = RefCell::new(Fan {
        members: Vec::new(),
        terms: Vec::new(),
        ranks: Vec::new(),
        bits: Vec::new(),
        mark: vec![u32::MAX; p.faces.len()],
    });
    crate::poly::blocked(fan.h.from.len(), blocks, |c| {
        fan.normal(c, &mut lists.borrow_mut())
    })
}

/// One corner's fan: its corners, their weighted normals or ranks, and each face's mark (the
/// corner whose fan last took it).
struct Fan {
    members: Vec<u32>,
    terms: Vec<V3>,
    ranks: Vec<u32>,
    bits: Vec<u64>,
    mark: Vec<u32>,
}

/// Each edge's mark in `sharp` (edges by sorted ends, in that order), or false.
fn sharp_edges(ends: &[(u32, u32)], sharp: &[((u32, u32), bool)]) -> Vec<bool> {
    let mut k = 0;
    ends.iter()
        .map(|e| {
            while k < sharp.len() && sharp[k].0 < *e {
                k += 1;
            }
            k < sharp.len() && sharp[k].0 == *e && sharp[k].1
        })
        .collect()
}

/// Each corner's step round its point to the next face's first corner there (with that face):
/// forward across its incoming edge, back across its outgoing one; none where that edge splits or
/// has no twin.
fn steps(h: &Halves, split: &[bool]) -> [Vec<(u32, u32)>; 2] {
    let n = h.from.len();
    let to = |x: u32| (x, h.face[x as usize]);
    let forward = (0..n)
        .map(|c| {
            let b = h.prev(c);
            let e = h.edge[b] as usize;
            if split[e] {
                return NONE;
            }
            h.across(e, h.from[c], h.from[b])
                .map_or(NONE, |x| to(h.first[x]))
        })
        .collect();
    let back = (0..n)
        .map(|c| {
            let e = h.edge[c] as usize;
            if split[e] {
                return NONE;
            }
            h.across(e, h.to[c], h.from[c])
                .map_or(NONE, |x| to(h.first[h.next(x)]))
        })
        .collect();
    [forward, back]
}

/// No step.
const NONE: (u32, u32) = (u32::MAX, u32::MAX);

/// Each corner's angle between its two edges, in radians.
fn corner_angles(p: &Poly, h: &Halves) -> Vec<f64> {
    let q = |i: u32| p.points[i as usize];
    (0..h.from.len())
        .map(|c| {
            let (a, v, b) = (q(h.from[h.prev(c)]), q(h.from[c]), q(h.to[c]));
            rad(angle(unit(sub(a, v)), unit(sub(b, v))))
        })
        .collect()
}

/// What a corner's fan reads: the steps round each point, and each face's unit normal, area and
/// weakness, each corner's angle (weighted by angle).
struct Fans<'a> {
    h: Halves,
    steps: [Vec<(u32, u32)>; 2],
    n: Vec<V3>,
    area: Vec<f64>,
    corner_angle: Vec<f64>,
    opts: &'a Normals,
    weak: &'a [bool],
    /// Each corner's place in `ranked` at a crowded point (none elsewhere), and the terms of each
    /// crowded point's corners in sorted order.
    rank: Vec<u32>,
    ranked: Vec<V3>,
}

/// A point with more corners than this sorts its corners' terms once, and a fan there sorts by
/// their ranks (the top of a lathe holds every segment's face).
const CROWDED: usize = 32;

impl Fans<'_> {
    /// Corner `x`'s weighted normal, as a fan sums it.
    fn term(&self, x: usize) -> V3 {
        let g = self.h.face[x] as usize;
        let wgt = if self.opts.by_angle {
            self.area[g]
        } else {
            match (self.opts.area, self.opts.corner_angle) {
                (true, true) => self.area[g] * self.corner_angle[x],
                (false, true) => self.corner_angle[x],
                _ => self.area[g],
            }
        };
        scale(self.n[g], wgt)
    }

    /// Ranks the corners at each crowded point (of `points`) by their terms.
    fn rank_crowded(&mut self, points: usize) {
        let mut count = vec![0u32; points];
        for &v in &self.h.from {
            count[v as usize] += 1;
        }
        let mut group = vec![u32::MAX; points];
        let mut lists: Vec<Vec<usize>> = Vec::new();
        for (v, &k) in count.iter().enumerate() {
            if k as usize > CROWDED {
                group[v] = lists.len() as u32;
                lists.push(Vec::new());
            }
        }
        if lists.is_empty() {
            return;
        }
        for (c, &v) in self.h.from.iter().enumerate() {
            if let Some(list) = lists.get_mut(group[v as usize] as usize) {
                list.push(c);
            }
        }
        self.rank = vec![u32::MAX; self.h.from.len()];
        for mut list in lists {
            list.sort_unstable_by(|&a, &b| order3(&self.term(a), &self.term(b)));
            for c in list {
                self.rank[c] = self.ranked.len() as u32;
                let t = self.term(c);
                self.ranked.push(t);
            }
        }
    }

    /// Corner `c`'s normal: its fan, the faces round its point reachable without crossing a split
    /// edge (walked both ways, at most [`WALK`] each), weighted and summed in sorted order.
    fn normal(&self, c: usize, lists: &mut Fan) -> V3 {
        let face = &self.h.face;
        let Fan {
            members: fan,
            terms,
            ranks,
            bits,
            mark,
        } = lists;
        fan.clear();
        fan.push(c as u32);
        mark[face[c] as usize] = c as u32;
        for step in &self.steps {
            let mut at = c;
            for _ in 0..WALK {
                let (next, g) = step[at];
                // No step, or a face the fan already holds, ends the walk.
                if next == u32::MAX || mark[g as usize] == c as u32 {
                    break;
                }
                mark[g as usize] = c as u32;
                fan.push(next);
                at = next as usize;
            }
        }
        // A lone face always counts, and needs no sort.
        if fan.len() == 1 {
            return unit(add([0.0; 3], self.term(c)));
        }
        let weak = |g: usize| self.weak.get(g).copied().unwrap_or(false);
        let strong = fan.iter().any(|&x| !weak(face[x as usize] as usize));
        // Every corner of a fan is at c's point, so a crowded one's are all ranked.
        let by_rank = fan.len() > CROWDED && self.rank.get(c).is_some_and(|&r| r != u32::MAX);
        terms.clear();
        ranks.clear();
        for &x in fan.iter() {
            if !(self.opts.by_angle || !strong || !weak(face[x as usize] as usize)) {
                continue;
            }
            if by_rank {
                ranks.push(self.rank[x as usize]);
            } else {
                terms.push(self.term(x as usize));
            }
        }
        if by_rank {
            // The ranks are distinct and lie in one point's range: set them as bits, read in order.
            let low = ranks.iter().min().map_or(0, |&r| r as usize);
            let high = ranks.iter().max().map_or(0, |&r| r as usize);
            bits.clear();
            bits.resize((high - low) / 64 + 1, 0);
            for &r in ranks.iter() {
                let r = r as usize - low;
                bits[r / 64] |= 1 << (r % 64);
            }
            for (k, &word) in bits.iter().enumerate() {
                let mut word = word;
                while word != 0 {
                    terms.push(self.ranked[low + 64 * k + word.trailing_zeros() as usize]);
                    word &= word - 1;
                }
            }
        } else {
            // Equal terms are equal bits, so an unstable sort orders them as a stable one would.
            terms.sort_unstable_by(order3);
        }
        unit(terms.iter().fold([0.0; 3], |s, t| add(s, *t)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Mesh;

    fn cube() -> Poly {
        let mut m = Mesh::default();
        let c = |x: f64, y: f64, z: f64| [x, y, z];
        let quads = [
            [c(0., 0., 1.), c(1., 0., 1.), c(1., 1., 1.), c(0., 1., 1.)],
            [c(1., 0., 0.), c(0., 0., 0.), c(0., 1., 0.), c(1., 1., 0.)],
            [c(1., 0., 1.), c(1., 0., 0.), c(1., 1., 0.), c(1., 1., 1.)],
            [c(0., 0., 0.), c(0., 0., 1.), c(0., 1., 1.), c(0., 1., 0.)],
            [c(0., 1., 1.), c(1., 1., 1.), c(1., 1., 0.), c(0., 1., 0.)],
            [c(0., 0., 0.), c(1., 0., 0.), c(1., 0., 1.), c(0., 0., 1.)],
        ];
        for (f, q) in quads.iter().enumerate() {
            let b = m.positions.len() as u32;
            for p in q {
                m.vertex(*p, [0.0; 3]);
            }
            m.quad(b, b + 1, b + 2, b + 3, f as u32);
        }
        Poly::of(&m)
    }

    fn closed(p: &Poly) -> bool {
        let mut half = BTreeMap::new();
        for c in &p.faces {
            for k in 0..c.len() {
                *half.entry((c[k], c[(k + 1) % c.len()])).or_insert(0) += 1;
            }
        }
        half.iter()
            .all(|(&(a, b), &n)| n == 1 && half.get(&(b, a)) == Some(&1))
    }

    #[test]
    fn a_beveled_cube_stays_closed_with_the_counts_its_segments_give() {
        for s in 1..=3 {
            let p = cube();
            let b = Bevel {
                width: 0.1,
                segments: s,
                shape: 0.5,
                limit: Limit::Angle(30.0),
                clamp: true,
                harden: true,
            };
            let out = bevel(&p, &b, &[None; 6]).poly;
            assert!(closed(&out), "segments {s}");
            assert_eq!(out.points.len(), 24 * s);
            assert_eq!(out.corners(), 24 + 72 * s);
        }
    }
}
