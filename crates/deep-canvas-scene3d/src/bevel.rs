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

use std::collections::BTreeMap;

use deep_canvas::ops::{acos, cos, pow, rad, sin};

use crate::geom::{add, cross, dot, length, scale, sub, unit, V2, V3};
use crate::poly::{key, Poly};

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

/// A new face: its points, its source face, whether it is the bevel's own, its corner normals.
type NewFace = (Vec<Pt>, usize, bool, Vec<V3>);

/// The point a corner of a face moves to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Pt {
    Old(u32),
    /// Both of the face's edges at the corner are beveled: its own point.
    Inset(usize, u32),
    /// The slide point on an unbeveled edge (by its ends) at its end `.1`.
    Slide((u32, u32), u32),
    /// A beveled edge's profile point `k` (1..segments − 1) at its end `.1`.
    Profile((u32, u32), u32, usize),
}

/// Points in (x, y, z) order.
fn order3(a: &V3, b: &V3) -> std::cmp::Ordering {
    (0..3)
        .map(|k| a[k].total_cmp(&b[k]))
        .find(|o| o.is_ne())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// The mean of `pts`, summed in (x, y, z) order so it never depends on theirs.
fn centroid(mut pts: Vec<V3>) -> V3 {
    pts.sort_by(order3);
    let n = pts.len().max(1) as f64;
    scale(pts.into_iter().fold([0.0; 3], add), 1.0 / n)
}

/// The angle in degrees between two unit vectors.
fn angle(a: V3, b: V3) -> f64 {
    deep_canvas::ops::deg(acos(dot(a, b).clamp(-1.0, 1.0)))
}

/// The mean of two numbers, the same whichever comes first.
fn mean2(a: f64, b: f64) -> f64 {
    (a + b) / 2.0
}

pub fn bevel(p: &Poly, b: &Bevel, part_of: &[Option<u32>]) -> Beveled {
    let edges = p.edges();
    let normal: Vec<V3> = (0..p.faces.len()).map(|f| unit(p.normal(f))).collect();
    let beveled = |e: &(u32, u32)| -> bool {
        let fs = &edges[e];
        if fs.len() != 2 {
            return false;
        }
        match &b.limit {
            Limit::All => true,
            Limit::Angle(a) => angle(normal[fs[0]], normal[fs[1]]) > *a,
            Limit::Parts(parts) => fs
                .iter()
                .any(|&f| part_of[f].is_some_and(|q| parts.contains(&q))),
        }
    };
    let bev: BTreeMap<(u32, u32), bool> = edges.keys().map(|e| (*e, beveled(e))).collect();
    let pt = |i: u32| p.points[i as usize];
    let dir = |from: u32, to: u32| unit(sub(pt(to), pt(from)));
    // Each corner: its face, its place, its point and the two neighbours.
    let corner = |f: usize, k: usize| {
        let c = &p.faces[f];
        let n = c.len();
        (c[(k + n - 1) % n], c[k], c[(k + 1) % n])
    };
    let sin_at = |prev: u32, v: u32, next: u32| length(cross(dir(v, prev), dir(v, next)));
    // The width, clamped so no corner moves past the middle of an edge it slides along.
    let mut width = b.width;
    if b.clamp {
        for f in 0..p.faces.len() {
            for k in 0..p.faces[f].len() {
                let (prev, v, next) = corner(f, k);
                let (bi, bo) = (bev[&key(prev, v)], bev[&key(v, next)]);
                if !(bi || bo) {
                    continue;
                }
                let s = sin_at(prev, v, next).max(1e-9);
                for (q, moved) in [(prev, bo), (next, bi)] {
                    if moved {
                        width = width.min(0.5 * length(sub(pt(q), pt(v))) * s);
                    }
                }
            }
        }
    }
    // Slide distances per (unbeveled edge, end), from each face that slides along it.
    let mut slides: BTreeMap<((u32, u32), u32), Vec<f64>> = BTreeMap::new();
    for f in 0..p.faces.len() {
        for k in 0..p.faces[f].len() {
            let (prev, v, next) = corner(f, k);
            let (bi, bo) = (bev[&key(prev, v)], bev[&key(v, next)]);
            let s = sin_at(prev, v, next).max(1e-9);
            if bi && !bo {
                slides.entry((key(v, next), v)).or_default().push(width / s);
            } else if bo && !bi {
                slides.entry((key(prev, v), v)).or_default().push(width / s);
            }
        }
    }
    let mut points: BTreeMap<Pt, V3> = BTreeMap::new();
    for (&(e, v), d) in &slides {
        let dist = if d.len() == 2 {
            mean2(d[0], d[1])
        } else {
            d[0]
        };
        let other = if e.0 == v { e.1 } else { e.0 };
        points.insert(Pt::Slide(e, v), add(pt(v), scale(dir(v, other), dist)));
    }
    let point_of = |f: usize, prev: u32, v: u32, next: u32| -> Pt {
        match (bev[&key(prev, v)], bev[&key(v, next)]) {
            (true, true) => Pt::Inset(f, v),
            (true, false) => Pt::Slide(key(v, next), v),
            (false, true) => Pt::Slide(key(prev, v), v),
            (false, false) => Pt::Old(v),
        }
    };
    // Each face's new outline.
    let mut outlines: Vec<Vec<Pt>> = Vec::new();
    for f in 0..p.faces.len() {
        let mut out = Vec::new();
        for k in 0..p.faces[f].len() {
            let (prev, v, next) = corner(f, k);
            let q = point_of(f, prev, v, next);
            if let Pt::Inset(..) = q {
                let s = sin_at(prev, v, next).max(1e-9);
                let at = add(pt(v), scale(add(dir(v, prev), dir(v, next)), width / s));
                points.insert(q, at);
            }
            let incoming = Pt::Slide(key(prev, v), v);
            let outgoing = Pt::Slide(key(v, next), v);
            if q == Pt::Old(v) && slides.contains_key(&(key(prev, v), v)) {
                out.push(incoming);
            }
            out.push(q);
            if q == Pt::Old(v) && slides.contains_key(&(key(v, next), v)) {
                out.push(outgoing);
            }
        }
        outlines.push(out);
    }
    // The face across each half-edge.
    let mut across: BTreeMap<(u32, u32), usize> = BTreeMap::new();
    for (f, c) in p.faces.iter().enumerate() {
        for k in 0..c.len() {
            across.insert((c[k], c[(k + 1) % c.len()]), f);
        }
    }
    let find = |f: usize, v: u32| -> usize { p.faces[f].iter().position(|&x| x == v).unwrap_or(0) };
    let s = b.segments.max(1);
    let lookup = |f: usize, v: u32| -> Pt {
        let k = find(f, v);
        let (a, x, c) = corner(f, k);
        point_of(f, a, x, c)
    };
    // The profile: (x, y) weights of its two arms at each step, mirrored so a profile read from
    // either side gives the same points.
    let r = if b.shape >= 1.0 {
        f64::INFINITY
    } else {
        2.0 * b.shape.max(1e-6) / (1.0 - b.shape)
    };
    let w: Vec<V2> = (0..=s)
        .map(|k| {
            let k = k.min(s - k);
            let phi = rad(90.0) * k as f64 / s as f64;
            let e = 2.0 / r;
            [pow(cos(phi), e), pow(sin(phi), e)]
        })
        .collect();
    let weights = |k: usize| -> V2 {
        if 2 * k <= s {
            w[k]
        } else {
            [w[k][1], w[k][0]]
        }
    };
    // Each beveled edge's profile at each end, from the face on its half-edge a→b to the other.
    let mut strip_sides: BTreeMap<(u32, u32), (usize, usize)> = BTreeMap::new();
    for (e, is) in &bev {
        if !is {
            continue;
        }
        let (f, g) = (across[&(e.0, e.1)], across[&(e.1, e.0)]);
        strip_sides.insert(*e, (f, g));
        for v in [e.0, e.1] {
            let other = if v == e.0 { e.1 } else { e.0 };
            let (pf, pg) = (points[&lookup(f, v)], points[&lookup(g, v)]);
            let d = dir(v, other);
            let along = mean2(dot(sub(pf, pt(v)), d), dot(sub(pg, pt(v)), d));
            let corner_pt = add(pt(v), scale(d, along));
            let centre = sub(add(pf, pg), corner_pt);
            let (arm_f, arm_g) = (sub(pf, centre), sub(pg, centre));
            for k in 1..s {
                let [x, y] = weights(k);
                let q = if r.is_infinite() {
                    corner_pt
                } else {
                    add(centre, add(scale(arm_f, x), scale(arm_g, y)))
                };
                points.insert(Pt::Profile(*e, v, k), q);
            }
        }
    }
    // Old points are their own.
    for (i, q) in p.points.iter().enumerate() {
        points.insert(Pt::Old(i as u32), *q);
    }
    // The profile at end v of beveled edge e, from face `from`'s side to the other's.
    let profile = |e: (u32, u32), v: u32, from: usize| -> Vec<Pt> {
        let (f, g) = strip_sides[&e];
        let mut row: Vec<Pt> = (0..=s)
            .map(|k| match k {
                0 => lookup(f, v),
                k if k == s => lookup(g, v),
                k => Pt::Profile(e, v, k),
            })
            .collect();
        if from != f {
            row.reverse();
        }
        row
    };
    let mut faces: Vec<NewFace> = Vec::new();
    for (f, out) in outlines.into_iter().enumerate() {
        let n = vec![normal[f]; out.len()];
        faces.push((out, f, false, n));
    }
    // The nearer source face; a tie goes to the face whose corners, sorted, sort first, so a tie
    // never depends on the faces' order.
    let corners_of = |f: usize| -> Vec<V3> {
        let mut c: Vec<V3> = p.faces[f].iter().map(|&i| p.points[i as usize]).collect();
        c.sort_by(order3);
        c
    };
    let by_corners = |a: usize, b: usize| -> std::cmp::Ordering {
        let (ca, cb) = (corners_of(a), corners_of(b));
        ca.iter()
            .zip(&cb)
            .map(|(x, y)| order3(x, y))
            .find(|o| o.is_ne())
            .unwrap_or(ca.len().cmp(&cb.len()))
    };
    let nearer = |cands: &[usize], at: V3| -> usize {
        let mut sorted = cands.to_vec();
        sorted.sort_by(|&a, &b| by_corners(a, b));
        let mut best = sorted[0];
        let mut dist = f64::INFINITY;
        for &c in &sorted {
            let q = centroid(p.faces[c].iter().map(|&i| pt(i)).collect());
            let d = dot(sub(at, q), normal[c]).abs();
            if d < dist - 1e-12 * (1.0 + d.abs()) {
                dist = d;
                best = c;
            }
        }
        best
    };
    // Strips: row k between profile points k and k + 1, wound so its first row twins face f's
    // edge.
    let mut point_normal: BTreeMap<Pt, V3> = BTreeMap::new();
    for (e, (f, g)) in &strip_sides {
        let (ra, rb) = (profile(*e, e.0, *f), profile(*e, e.1, *f));
        let normal_at = |k: usize| -> V3 {
            let [x, y] = weights(k);
            unit(add(scale(normal[*f], x), scale(normal[*g], y)))
        };
        for k in 0..=s {
            point_normal.insert(ra[k], normal_at(k));
            point_normal.insert(rb[k], normal_at(k));
        }
        for k in 0..s {
            let quad = vec![ra[k], ra[k + 1], rb[k + 1], rb[k]];
            let mid = centroid(quad.iter().map(|q| points[q]).collect());
            let src = if 2 * k + 1 < s {
                *f
            } else if 2 * k + 1 > s {
                *g
            } else {
                nearer(&[*f, *g], mid)
            };
            let n = vec![
                normal_at(k),
                normal_at(k + 1),
                normal_at(k + 1),
                normal_at(k),
            ];
            faces.push((quad, src, true, n));
        }
    }
    // Patches: around each vertex a strip ends at, the faces in turn across their incoming
    // edges, each one's corner point and, across a beveled edge, that edge's profile.
    let mut at_vertex: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for (f, c) in p.faces.iter().enumerate() {
        for &v in c {
            at_vertex.entry(v).or_default().push(f);
        }
    }
    for (&v, fs) in &at_vertex {
        let touches = fs.iter().any(|&f| {
            let (a, _, c) = corner(f, find(f, v));
            bev[&key(a, v)] || bev[&key(v, c)]
        });
        if !touches {
            continue;
        }
        // A start: a face no face precedes (an open fan) or the lowest.
        let pred = |f: usize| -> Option<usize> {
            let (_, _, c) = corner(f, find(f, v));
            across.get(&(c, v)).copied()
        };
        let succ = |f: usize| -> Option<usize> {
            let (a, _, _) = corner(f, find(f, v));
            across.get(&(v, a)).copied()
        };
        let start = fs
            .iter()
            .copied()
            .find(|&f| pred(f).is_none())
            .unwrap_or(fs[0]);
        let open = pred(start).is_none();
        let mut ring: Vec<Pt> = Vec::new();
        if open {
            ring.push(Pt::Old(v));
        }
        let mut f = start;
        for _ in 0..fs.len() {
            ring.push(lookup(f, v));
            let (a, _, _) = corner(f, find(f, v));
            let Some(g) = succ(f) else { break };
            if bev[&key(a, v)] {
                let row = profile(key(a, v), v, f);
                ring.extend(&row[1..s]);
            }
            if g == start {
                break;
            }
            f = g;
        }
        ring.dedup();
        while ring.len() > 1 && ring.first() == ring.last() {
            ring.pop();
        }
        if ring.len() < 3 {
            continue;
        }
        let centre = centroid(ring.iter().map(|q| points[q]).collect());
        let src = nearer(fs, centre);
        let n: Vec<V3> = ring
            .iter()
            .map(|q| match point_normal.get(q) {
                Some(n) => *n,
                None => unit(fs.iter().fold([0.0; 3], |acc, &f| add(acc, normal[f]))),
            })
            .collect();
        faces.push((ring, src, true, n));
    }
    // Number the points in order of their keys, so the numbering never depends on face order.
    let mut ids: BTreeMap<Pt, u32> = BTreeMap::new();
    for (face, ..) in &faces {
        for q in face {
            let next = ids.len() as u32;
            ids.entry(*q).or_insert(next);
        }
    }
    let mut out = Poly {
        points: vec![[0.0; 3]; ids.len()],
        attrs: p
            .attrs
            .keys()
            .map(|k| (k.clone(), vec![0.0; ids.len()]))
            .collect(),
        uv: p.uv.as_ref().map(|_| Vec::new()),
        ..Poly::default()
    };
    for (q, &i) in &ids {
        out.points[i as usize] = points[q];
        let from = match q {
            Pt::Old(v) | Pt::Inset(_, v) | Pt::Slide(_, v) | Pt::Profile(_, v, _) => *v,
        };
        for (name, values) in &p.attrs {
            out.attrs.get_mut(name).expect("made above")[i as usize] = values[from as usize];
        }
    }
    let maps: Vec<Option<UvMap>> = (0..p.faces.len()).map(|f| UvMap::of(p, f)).collect();
    let mut normals = Vec::new();
    let mut weak = Vec::new();
    for (face, src, is_weak, n) in faces {
        out.faces.push(face.iter().map(|q| ids[q]).collect());
        out.origin.push(p.origin[src]);
        if let Some(uv) = &mut out.uv {
            let map = maps[src].as_ref();
            uv.push(
                face.iter()
                    .map(|q| map.map_or([0.0; 2], |m| m.at(points[q])))
                    .collect(),
            );
        }
        normals.push(n);
        weak.push(is_weak);
    }
    Beveled {
        poly: out,
        normals: b.harden.then_some(normals),
        weak,
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
        let mut cs: Vec<(V3, V2)> = p.faces[f]
            .iter()
            .zip(&uv[f])
            .map(|(&i, t)| (p.points[i as usize], *t))
            .collect();
        cs.sort_by(|a, b| {
            (0..3)
                .map(|k| a.0[k].total_cmp(&b.0[k]))
                .find(|o| o.is_ne())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
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
    let edges = p.edges();
    let n: Vec<V3> = (0..p.faces.len()).map(|f| unit(p.normal(f))).collect();
    let area: Vec<f64> = (0..p.faces.len())
        .map(|f| 0.5 * length(p.normal(f)))
        .collect();
    let split = |e: &(u32, u32)| -> bool {
        let fs = &edges[e];
        if fs.len() != 2 {
            return true;
        }
        if opts.by_angle {
            return angle(n[fs[0]], n[fs[1]]) > opts.angle;
        }
        opts.keep_sharp && sharp.get(e).copied().unwrap_or(false)
    };
    // The fan of each corner: the faces around its point reachable without crossing a split edge.
    let mut across: BTreeMap<(u32, u32), usize> = BTreeMap::new();
    for (f, c) in p.faces.iter().enumerate() {
        for k in 0..c.len() {
            across.insert((c[k], c[(k + 1) % c.len()]), f);
        }
    }
    let corner_angle = |f: usize, k: usize| -> f64 {
        let c = &p.faces[f];
        let m = c.len();
        let q = |i: u32| p.points[i as usize];
        let (a, v, b) = (q(c[(k + m - 1) % m]), q(c[k]), q(c[(k + 1) % m]));
        rad(angle(unit(sub(a, v)), unit(sub(b, v))))
    };
    crate::poly::blocked(p.faces.len(), blocks, |f| {
        let c = &p.faces[f];
        let m = c.len();
        let mut row = Vec::with_capacity(m);
        for (k, &v) in c.iter().enumerate() {
            let mut fan: Vec<(usize, usize)> = vec![(f, k)];
            // Walk both ways round v.
            for forward in [true, false] {
                let (mut g, mut j) = (f, k);
                for _ in 0..64 {
                    let cg = &p.faces[g];
                    let mg = cg.len();
                    let other = if forward {
                        cg[(j + mg - 1) % mg]
                    } else {
                        cg[(j + 1) % mg]
                    };
                    if split(&key(other, v)) {
                        break;
                    }
                    let next = if forward {
                        across.get(&(v, other))
                    } else {
                        across.get(&(other, v))
                    };
                    let Some(&h) = next else { break };
                    if h == f || fan.iter().any(|x| x.0 == h) {
                        break;
                    }
                    j = p.faces[h].iter().position(|&x| x == v).unwrap_or(0);
                    g = h;
                    fan.push((g, j));
                }
            }
            let strong = fan
                .iter()
                .any(|(g, _)| !weak.get(*g).copied().unwrap_or(false));
            let mut terms: Vec<V3> = fan
                .iter()
                .filter(|(g, _)| {
                    opts.by_angle || !strong || !weak.get(*g).copied().unwrap_or(false)
                })
                .map(|&(g, j)| {
                    let wgt = if opts.by_angle {
                        area[g]
                    } else {
                        match (opts.area, opts.corner_angle) {
                            (true, true) => area[g] * corner_angle(g, j),
                            (false, true) => corner_angle(g, j),
                            _ => area[g],
                        }
                    };
                    scale(n[g], wgt)
                })
                .collect();
            terms.sort_by(|a, b| {
                (0..3)
                    .map(|i| a[i].total_cmp(&b[i]))
                    .find(|o| o.is_ne())
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            row.push(unit(terms.into_iter().fold([0.0; 3], add)));
        }
        row
    })
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
