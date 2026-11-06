//! Builder `hull` (canvas primitives: Builder `hull`: convex hulls; issue #440): the convex hull
//! of up to 4,096 points, found with exact orientation predicates, so which side of a plane a
//! point lies on is never a rounding error. The points are sorted and deduplicated first, so
//! nothing depends on their order; a point inside the hull, on a face or on an edge is left out;
//! each flat face is fanned from its corner that sorts first by (x, y, z).

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::geom::{add, cross, sub, unit, Mesh, V3};

/// The most positions a hull takes.
pub const MAX_POINTS: usize = 4_096;

/// The wrong programs #440's hull criterion plants.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// Points on a face are kept as vertices.
    pub keeps_face_points: bool,
    /// Each face is fanned from its corner that comes first in the input, not by (x, y, z).
    pub fan_input_order: bool,
}

// Exact arithmetic on f64 expansions (Shewchuk, "Adaptive precision floating-point arithmetic
// and fast robust geometric predicates", 1997): each value is a sum of non-overlapping f64
// components in increasing magnitude, and its sign is its largest component's.

fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let x = a + b;
    let bv = x - a;
    let av = x - bv;
    (x, (a - av) + (b - bv))
}

fn fast_two_sum(a: f64, b: f64) -> (f64, f64) {
    let x = a + b;
    (x, b - (x - a))
}

fn split(a: f64) -> (f64, f64) {
    let c = 134_217_729.0 * a;
    let hi = c - (c - a);
    (hi, a - hi)
}

fn two_product(a: f64, b: f64) -> (f64, f64) {
    let x = a * b;
    let (ah, al) = split(a);
    let (bh, bl) = split(b);
    let err = x - ah * bh - al * bh - ah * bl;
    (x, al * bl - err)
}

fn grow(e: &[f64], b: f64) -> Vec<f64> {
    let mut q = b;
    let mut h = Vec::with_capacity(e.len() + 1);
    for &x in e {
        let (s, r) = two_sum(q, x);
        q = s;
        if r != 0.0 {
            h.push(r);
        }
    }
    if q != 0.0 || h.is_empty() {
        h.push(q);
    }
    h
}

fn sum(e: &[f64], f: &[f64]) -> Vec<f64> {
    f.iter().fold(e.to_vec(), |acc, &x| grow(&acc, x))
}

fn times(e: &[f64], b: f64) -> Vec<f64> {
    let mut h = Vec::with_capacity(2 * e.len());
    let (mut q, r) = two_product(e[0], b);
    if r != 0.0 {
        h.push(r);
    }
    for &x in &e[1..] {
        let (p1, p0) = two_product(x, b);
        let (s, r) = two_sum(q, p0);
        if r != 0.0 {
            h.push(r);
        }
        let (s, r) = fast_two_sum(p1, s);
        q = s;
        if r != 0.0 {
            h.push(r);
        }
    }
    if q != 0.0 || h.is_empty() {
        h.push(q);
    }
    h
}

fn mul(e: &[f64], f: &[f64]) -> Vec<f64> {
    f.iter().fold(vec![0.0], |acc, &x| sum(&acc, &times(e, x)))
}

fn neg(e: &[f64]) -> Vec<f64> {
    e.iter().map(|x| -x).collect()
}

fn diff(a: f64, b: f64) -> Vec<f64> {
    let x = a - b;
    let bv = a - x;
    let av = x + bv;
    let r = (a - av) + (bv - b);
    if r == 0.0 {
        vec![x]
    } else {
        vec![r, x]
    }
}

fn sign(e: &[f64]) -> Ordering {
    e.last()
        .copied()
        .unwrap_or(0.0)
        .partial_cmp(&0.0)
        .unwrap_or(Ordering::Equal)
}

/// The sign of u.x v.y − u.y v.x, exactly, from the differences' expansions.
fn det2(ux: &[f64], uy: &[f64], vx: &[f64], vy: &[f64]) -> Vec<f64> {
    sum(&mul(ux, vy), &neg(&mul(uy, vx)))
}

/// Which side of the plane through a, b, c (counter-clockwise seen from its positive side) `p`
/// lies on: the sign of ((b − a) × (c − a)) · (p − a), exactly.
pub fn side(a: V3, b: V3, c: V3, p: V3) -> Ordering {
    let (u, v, w) = (sub(b, a), sub(c, a), sub(p, a));
    let n = cross(u, v);
    let d = n[0] * w[0] + n[1] * w[1] + n[2] * w[2];
    let permanent = w[0].abs() * ((u[1] * v[2]).abs() + (u[2] * v[1]).abs())
        + w[1].abs() * ((u[2] * v[0]).abs() + (u[0] * v[2]).abs())
        + w[2].abs() * ((u[0] * v[1]).abs() + (u[1] * v[0]).abs());
    if d.abs() > 1e-12 * permanent {
        return d.partial_cmp(&0.0).unwrap_or(Ordering::Equal);
    }
    let [u, v, w] = [(b, a), (c, a), (p, a)].map(|(x, y)| [0, 1, 2].map(|k| diff(x[k], y[k])));
    let nx = det2(&u[1], &u[2], &v[1], &v[2]);
    let ny = det2(&u[2], &u[0], &v[2], &v[0]);
    let nz = det2(&u[0], &u[1], &v[0], &v[1]);
    sign(&sum(
        &sum(&mul(&nx, &w[0]), &mul(&ny, &w[1])),
        &mul(&nz, &w[2]),
    ))
}

/// The sign of (b − a) × (c − a) on the plane of axes `i`, `j`, exactly.
fn turn(a: V3, b: V3, c: V3, i: usize, j: usize) -> Ordering {
    let d = (b[i] - a[i]) * (c[j] - a[j]) - (b[j] - a[j]) * (c[i] - a[i]);
    let permanent = ((b[i] - a[i]) * (c[j] - a[j])).abs() + ((b[j] - a[j]) * (c[i] - a[i])).abs();
    if d.abs() > 1e-12 * permanent {
        return d.partial_cmp(&0.0).unwrap_or(Ordering::Equal);
    }
    sign(&det2(
        &diff(b[i], a[i]),
        &diff(b[j], a[j]),
        &diff(c[i], a[i]),
        &diff(c[j], a[j]),
    ))
}

fn collinear(a: V3, b: V3, c: V3) -> bool {
    [(0, 1), (1, 2), (2, 0)]
        .iter()
        .all(|&(i, j)| turn(a, b, c, i, j) == Ordering::Equal)
}

fn order(a: &V3, b: &V3) -> Ordering {
    (0..3)
        .map(|k| a[k].total_cmp(&b[k]))
        .find(|o| *o != Ordering::Equal)
        .unwrap_or(Ordering::Equal)
}

/// Why a hull can't build: fewer than four distinct points, or points that span no volume.
pub const FLAT: &str = "hull.flat";

/// The hull of `input`: one closed part `hull`, its corners numbered in (x, y, z) order, each
/// flat face fanned from its first corner. Err(FLAT) when the points span no volume.
pub fn hull(input: &[V3], plants: Plants) -> Result<Mesh, &'static str> {
    // Each distinct point with the first place it takes in the input.
    let mut pts: Vec<(V3, usize)> = input.iter().copied().zip(0..).collect();
    pts.sort_by(|a, b| order(&a.0, &b.0).then(a.1.cmp(&b.1)));
    pts.dedup_by(|b, a| order(&a.0, &b.0) == Ordering::Equal);
    let p: Vec<V3> = pts.iter().map(|x| x.0).collect();
    let n = p.len();
    // A first tetrahedron: the first point, the next distinct one, the first off their line, and
    // the first off their plane.
    let i2 = (2..n).find(|&k| !collinear(p[0], p[1], p[k]));
    let i3 =
        i2.and_then(|i2| (i2 + 1..n).find(|&k| side(p[0], p[1], p[i2], p[k]) != Ordering::Equal));
    let (Some(i2), Some(i3)) = (i2, i3) else {
        return Err(FLAT);
    };
    let mut tris: Vec<[usize; 3]> = Vec::new();
    let mut alive: Vec<bool> = Vec::new();
    let mut edge: Edges = BTreeMap::new();
    let (a, b, c, d) = (0, 1, i2, i3);
    let first = if side(p[a], p[b], p[c], p[d]) == Ordering::Less {
        [[a, b, c], [a, d, b], [b, d, c], [c, d, a]]
    } else {
        [[a, c, b], [a, b, d], [b, c, d], [c, a, d]]
    };
    for t in first {
        add_tri(&mut tris, &mut alive, &mut edge, t)?;
    }
    let seen = |t: &[usize; 3], q: usize| side(p[t[0]], p[t[1]], p[t[2]], p[q]);
    for q in 0..n {
        if [a, b, c, d].contains(&q) {
            continue;
        }
        let live: Vec<usize> = (0..tris.len()).filter(|&t| alive[t]).collect();
        let sides: Vec<Ordering> = live.iter().map(|&t| seen(&tris[t], q)).collect();
        if !sides.contains(&Ordering::Greater) {
            continue;
        }
        // Every face that sees q, or has it on its plane, goes; the horizon is the edge loop
        // between them and the rest, and q is joined to it.
        let mut visible = vec![false; tris.len()];
        for (k, &t) in live.iter().enumerate() {
            visible[t] = sides[k] != Ordering::Less;
        }
        let mut horizon = Vec::new();
        for &t in &live {
            if !visible[t] {
                continue;
            }
            for j in 0..3 {
                let (x, y) = (tris[t][j], tris[t][(j + 1) % 3]);
                if !edge.get(&(y, x)).is_some_and(|&o| visible[o]) {
                    horizon.push((x, y));
                }
            }
        }
        for &t in &live {
            if visible[t] {
                alive[t] = false;
                for j in 0..3 {
                    edge.remove(&(tris[t][j], tris[t][(j + 1) % 3]));
                }
            }
        }
        for (x, y) in horizon {
            add_tri(&mut tris, &mut alive, &mut edge, [x, y, q])?;
        }
    }
    let live: Vec<[usize; 3]> = (0..tris.len())
        .filter(|&t| alive[t])
        .map(|t| tris[t])
        .collect();
    let faces = facets(&p, &live);
    // Corners in (x, y, z) order, each face from its first corner (or, planted, its first in
    // the input), and the faces in order of their corner lists.
    let mut used: Vec<usize> = faces.iter().flatten().copied().collect();
    used.sort_unstable();
    used.dedup();
    let at: BTreeMap<usize, u32> = used
        .iter()
        .enumerate()
        .map(|(k, &i)| (i, k as u32))
        .collect();
    let mut polys: Vec<Vec<u32>> = faces
        .iter()
        .map(|f| {
            let key = |i: &usize| {
                if plants.fan_input_order {
                    pts[*i].1
                } else {
                    *i
                }
            };
            let start = (0..f.len()).min_by_key(|&k| key(&f[k])).unwrap_or(0);
            (0..f.len())
                .map(|k| at[&f[(start + k) % f.len()]])
                .collect()
        })
        .collect();
    polys.sort();
    let mut m = Mesh::default();
    let corner: Vec<V3> = used.iter().map(|&i| p[i]).collect();
    let mut normal = vec![[0.0; 3]; corner.len()];
    let mut face_normals = Vec::new();
    for f in &polys {
        let [o, x, y] = [f[0], f[1], f[2]].map(|i| corner[i as usize]);
        let fnorm = unit(cross(sub(x, o), sub(y, o)));
        face_normals.push(fnorm);
        for &i in f {
            normal[i as usize] = add(normal[i as usize], fnorm);
        }
    }
    for (k, q) in corner.iter().enumerate() {
        m.vertex(*q, unit(normal[k]));
    }
    for (face, f) in polys.iter().enumerate() {
        // Planted: a face's points that lie on it stay, the face fanned from the first of them.
        let on: Vec<V3> = if plants.keeps_face_points {
            let [a, b, c] = [f[0], f[1], f[2]].map(|i| corner[i as usize]);
            p.iter()
                .copied()
                .filter(|q| side(a, b, c, *q) == Ordering::Equal && !corner.contains(q))
                .collect()
        } else {
            Vec::new()
        };
        if let Some(q) = on.first() {
            let hub = m.vertex(*q, face_normals[face]);
            for k in 0..f.len() {
                m.indices.extend([hub, f[k], f[(k + 1) % f.len()]]);
                m.faces.push(face as u32);
            }
            for q in &on[1..] {
                m.vertex(*q, face_normals[face]);
            }
            continue;
        }
        for k in 1..f.len() - 1 {
            m.indices.extend([f[0], f[k], f[k + 1]]);
            m.faces.push(face as u32);
        }
    }
    m.close("hull", 0, 0);
    m.part("hull", 0);
    m.true_shape = vec![serde_json::json!({"convex": corner})];
    Ok(m)
}

type Edges = BTreeMap<(usize, usize), usize>;

/// A triangle, its three directed edges claimed; two claims on one edge mean the hull isn't one
/// closed surface.
fn add_tri(
    tris: &mut Vec<[usize; 3]>,
    alive: &mut Vec<bool>,
    edge: &mut Edges,
    t: [usize; 3],
) -> Result<(), &'static str> {
    for j in 0..3 {
        if edge.insert((t[j], t[(j + 1) % 3]), tris.len()).is_some() {
            return Err(FLAT);
        }
    }
    tris.push(t);
    alive.push(true);
    Ok(())
}

/// The flat faces of a closed triangulated hull: coplanar neighbours merged, each face's corners
/// the strict corners of their convex polygon, counter-clockwise from outside.
fn facets(p: &[V3], tris: &[[usize; 3]]) -> Vec<Vec<usize>> {
    let mut by_edge: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (k, t) in tris.iter().enumerate() {
        for j in 0..3 {
            by_edge.insert((t[j], t[(j + 1) % 3]), k);
        }
    }
    let mut done = vec![false; tris.len()];
    let mut out = Vec::new();
    for seed in 0..tris.len() {
        if done[seed] {
            continue;
        }
        let s = tris[seed];
        let mut stack = vec![seed];
        done[seed] = true;
        let mut points: Vec<usize> = Vec::new();
        while let Some(t) = stack.pop() {
            points.extend(tris[t]);
            for j in 0..3 {
                let (x, y) = (tris[t][j], tris[t][(j + 1) % 3]);
                if let Some(&o) = by_edge.get(&(y, x)) {
                    if !done[o]
                        && tris[o]
                            .iter()
                            .all(|&v| side(p[s[0]], p[s[1]], p[s[2]], p[v]) == Ordering::Equal)
                    {
                        done[o] = true;
                        stack.push(o);
                    }
                }
            }
        }
        points.sort_unstable();
        points.dedup();
        // In-plane: drop the normal's main axis, keeping the other two in cyclic order, so a
        // counter-clockwise turn there is one seen from that axis's positive side.
        let nrm = cross(sub(p[s[1]], p[s[0]]), sub(p[s[2]], p[s[0]]));
        let k = (0..3)
            .max_by(|&a, &b| nrm[a].abs().total_cmp(&nrm[b].abs()))
            .unwrap_or(0);
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        let mut ring = chain(p, &points, i, j);
        if nrm[k] < 0.0 {
            ring.reverse();
        }
        out.push(ring);
    }
    out
}

/// The strict corners of the convex hull of `points` (sorted by (x, y, z)) on the plane of axes
/// `i`, `j`, counter-clockwise there: Andrew's monotone chain with exact turns.
fn chain(p: &[V3], points: &[usize], i: usize, j: usize) -> Vec<usize> {
    let mut s = points.to_vec();
    s.sort_by(|&a, &b| {
        p[a][i]
            .total_cmp(&p[b][i])
            .then(p[a][j].total_cmp(&p[b][j]))
    });
    let mut lower: Vec<usize> = Vec::new();
    for &q in &s {
        while lower.len() >= 2
            && turn(
                p[lower[lower.len() - 2]],
                p[lower[lower.len() - 1]],
                p[q],
                i,
                j,
            ) != Ordering::Greater
        {
            lower.pop();
        }
        lower.push(q);
    }
    let mut upper: Vec<usize> = Vec::new();
    for &q in s.iter().rev() {
        while upper.len() >= 2
            && turn(
                p[upper[upper.len() - 2]],
                p[upper[upper.len() - 1]],
                p[q],
                i,
                j,
            ) != Ordering::Greater
        {
            upper.pop();
        }
        upper.push(q);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}
