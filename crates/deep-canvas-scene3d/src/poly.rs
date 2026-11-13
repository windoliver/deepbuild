//! The polygon view of a built mesh (canvas primitives: Modifier: subdivide, Modifier: bevel;
//! issue #440): welded points, faces as corner loops (a mesh face's triangles merged), each
//! corner's uv, each face's origin (the source triangle its part and face attributes come from),
//! point attributes, and edge sharpness; and uniform refinement by Catmull-Clark, Loop or simple
//! rules with semi-sharp creases. Every point a rule makes is an average taken in a sorted order,
//! so nothing depends on which corner a face's list starts at.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::geom::{basis, cross, dot, first_seen, newell, spread, triangulate, unit, Mesh, V2, V3};

/// A mesh as welded points and polygon faces.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Poly {
    pub points: Vec<V3>,
    pub faces: Vec<Vec<u32>>,
    /// Each face's corners' uv, when the mesh has uv0.
    pub uv: Option<Vec<Vec<V2>>>,
    /// Each face's source triangle in the mesh the view was made from.
    pub origin: Vec<u32>,
    /// Point attributes, one value per point.
    pub attrs: BTreeMap<String, Vec<f64>>,
    /// Each face is one a bevel made, or none are.
    pub weak: Vec<bool>,
    /// Each corner's vertex in the mesh the view was made from (empty once refined).
    pub vertex: Vec<Vec<u32>>,
    /// Edge sharpness by sorted ends, in levels (Pixar's semi-sharp creases): 1 or more is sharp
    /// at the next level.
    pub sharp: BTreeMap<(u32, u32), f64>,
}

pub fn key(a: u32, b: u32) -> (u32, u32) {
    (a.min(b), a.max(b))
}

/// `0..n` stably sorted by `key` (each below `keys`), by counting.
pub(crate) fn counted(n: usize, keys: usize, key: impl Fn(u32) -> usize) -> Vec<u32> {
    let mut place = vec![0u32; keys + 1];
    for i in 0..n as u32 {
        place[key(i) + 1] += 1;
    }
    for k in 0..keys {
        place[k + 1] += place[k];
    }
    let mut out = vec![0; n];
    for i in 0..n as u32 {
        let k = key(i);
        out[place[k] as usize] = i;
        place[k] += 1;
    }
    out
}

/// `0..n` sorted by the sorted `ends` of each (points below `points`), then by place: one edge's
/// items together, the edges in the order a map keyed by [`key`] gives them. Counted by the lower
/// end, then each (short) run of one lower end sorted by the higher and the place, packed in one
/// number so the sort reads nothing else.
pub(crate) fn by_ends(n: usize, points: usize, ends: impl Fn(u32) -> (u32, u32)) -> Vec<u32> {
    let mut place = vec![0u32; points + 1];
    for i in 0..n as u32 {
        let (a, b) = ends(i);
        place[a.min(b) as usize + 1] += 1;
    }
    for k in 0..points {
        place[k + 1] += place[k];
    }
    let mut packed = vec![0u64; n];
    for i in 0..n as u32 {
        let (a, b) = ends(i);
        let k = a.min(b) as usize;
        packed[place[k] as usize] = (u64::from(a.max(b)) << 32) | u64::from(i);
        place[k] += 1;
    }
    // Each lower end's run now ends where `place` stands.
    let mut start = 0;
    for &end in &place[..points] {
        packed[start..end as usize].sort_unstable();
        start = end as usize;
    }
    packed.into_iter().map(|x| x as u32).collect()
}

/// A polygon view's corners and edges as flat arrays (#2017): corner `start[f] + k` is face `f`'s
/// corner `k`, whose half-edge runs to the face's next corner; the edges are numbered in the order
/// of their sorted ends, each listing the corners whose half-edges lie on it in corner order, so
/// its faces come in the order [`Poly::edges`] gives them.
pub(crate) struct Halves {
    /// Each face's first corner, then the corner count.
    pub(crate) start: Vec<u32>,
    /// Each corner's face.
    pub(crate) face: Vec<u32>,
    /// Each corner's point, and the point its half-edge runs to.
    pub(crate) from: Vec<u32>,
    pub(crate) to: Vec<u32>,
    /// Each corner's face's first corner at its point.
    pub(crate) first: Vec<u32>,
    /// Each corner's half-edge's edge.
    pub(crate) edge: Vec<u32>,
    /// Each edge's sorted ends.
    pub(crate) ends: Vec<(u32, u32)>,
    /// Each edge's first place in `list`, then the list's length.
    at: Vec<u32>,
    list: Vec<u32>,
}

impl Halves {
    pub(crate) fn of(p: &Poly) -> Halves {
        let n = p.corners();
        let (mut start, mut face) = (Vec::with_capacity(p.faces.len() + 1), Vec::with_capacity(n));
        let (mut from, mut to, mut first) = (
            Vec::with_capacity(n),
            Vec::with_capacity(n),
            Vec::with_capacity(n),
        );
        // The face each point was last seen in, and its first corner there.
        let mut seen = vec![(u32::MAX, 0u32); p.points.len()];
        for (f, c) in p.faces.iter().enumerate() {
            start.push(from.len() as u32);
            for (k, &v) in c.iter().enumerate() {
                let here = (f as u32, from.len() as u32);
                let s = &mut seen[v as usize];
                if s.0 != here.0 {
                    *s = here;
                }
                first.push(s.1);
                face.push(f as u32);
                from.push(v);
                to.push(c[(k + 1) % c.len()]);
            }
        }
        start.push(n as u32);
        let order = by_ends(n, p.points.len(), |c| (from[c as usize], to[c as usize]));
        let (mut edge, mut ends, mut at) = (vec![0; n], Vec::new(), Vec::new());
        for (place, &c) in order.iter().enumerate() {
            let e = key(from[c as usize], to[c as usize]);
            if ends.last() != Some(&e) {
                ends.push(e);
                at.push(place as u32);
            }
            edge[c as usize] = (ends.len() - 1) as u32;
        }
        at.push(n as u32);
        Halves {
            start,
            face,
            from,
            to,
            first,
            edge,
            ends,
            at,
            list: order,
        }
    }

    /// The corners on edge `e`, in corner order.
    pub(crate) fn on(&self, e: usize) -> &[u32] {
        &self.list[self.at[e] as usize..self.at[e + 1] as usize]
    }

    /// The corner before `c` in its face.
    pub(crate) fn prev(&self, c: usize) -> usize {
        let f = self.face[c] as usize;
        if c == self.start[f] as usize {
            self.start[f + 1] as usize - 1
        } else {
            c - 1
        }
    }

    /// The corner after `c` in its face.
    pub(crate) fn next(&self, c: usize) -> usize {
        let f = self.face[c] as usize;
        if c + 1 == self.start[f + 1] as usize {
            self.start[f] as usize
        } else {
            c + 1
        }
    }

    /// The last corner whose half-edge runs `a` → `b` on edge `e`: a map from half-edges to their
    /// faces, filled in corner order, keeps the last.
    pub(crate) fn across(&self, e: usize, a: u32, b: u32) -> Option<usize> {
        self.on(e)
            .iter()
            .rev()
            .map(|&c| c as usize)
            .find(|&c| self.from[c] == a && self.to[c] == b)
    }
}

/// Lists one face's triangles reuse while [`Poly::of`] finds their boundary.
#[derive(Default)]
struct Scratch {
    /// Each half-edge on welded points, with the mesh vertex at its start.
    half: Vec<((u32, u32), u32)>,
    /// The boundary half-edges.
    bound: Vec<((u32, u32), u32)>,
    /// The boundary loop: each point with the mesh vertex at its start.
    ring: Vec<(u32, usize)>,
}

impl Scratch {
    /// Whether the boundary of triangles `tris` on welded points `w` is one loop, left in `ring`.
    /// As maps keyed by half-edge and by start would, a half-edge met twice keeps its later
    /// triangle's vertex and a point that starts two boundary half-edges the one to the higher
    /// point; the loop starts at the lowest point.
    fn boundary(&mut self, tris: &[u32], m: &Mesh, w: &[u32]) -> bool {
        let (half, bound, ring) = (&mut self.half, &mut self.bound, &mut self.ring);
        if let Some(quad) = quad_loop(tris, m, w) {
            ring.clear();
            ring.extend(quad);
            return true;
        }
        half.clear();
        for &t in tris {
            for j in 0..3 {
                let a = m.indices[3 * t as usize + j];
                let b = m.indices[3 * t as usize + (j + 1) % 3];
                half.push(((w[a as usize], w[b as usize]), a));
            }
        }
        half.sort_by_key(|h| h.0);
        keep_last(half, |h| h.0);
        bound.clear();
        let has = |e: &(u32, u32)| half.binary_search_by_key(e, |h| h.0).is_ok();
        bound.extend(half.iter().filter(|((a, b), _)| a != b && !has(&(*b, *a))));
        let count = bound.len();
        keep_last(bound, |h| h.0 .0);
        ring.clear();
        let Some(&((start, _), _)) = bound.first() else {
            return false;
        };
        let mut at = start;
        while let Ok(i) = bound.binary_search_by_key(&at, |h| h.0 .0) {
            let ((_, next), v) = bound[i];
            ring.push((at, v as usize));
            at = next;
            if at == start || ring.len() > count {
                break;
            }
        }
        ring.len() >= 3 && ring.len() == count
    }
}

/// The loop of the two triangles a quad makes, (a, b, c) then (a, c, d) on four distinct welded
/// points, as [`Scratch::boundary`] walks it: their six half-edges are distinct, the diagonal's two
/// cancel, and each point starts one of the other four, so the loop runs a, b, c, d from the lowest
/// point, each with the vertex its half-edge starts at (c's from the second triangle).
fn quad_loop(tris: &[u32], m: &Mesh, w: &[u32]) -> Option<[(u32, usize); 4]> {
    let &[s, t] = tris else {
        return None;
    };
    let v = |tri: u32, j: usize| m.indices[3 * tri as usize + j] as usize;
    let (a, b, c, d) = (v(s, 0), v(s, 1), v(t, 1), v(t, 2));
    let p = [w[a], w[b], w[c], w[d]];
    let distinct = (0..4).all(|i| (i + 1..4).all(|j| p[i] != p[j]));
    if w[v(t, 0)] != p[0] || w[v(s, 2)] != p[2] || !distinct {
        return None;
    }
    let ring = [(p[0], a), (p[1], b), (p[2], c), (p[3], d)];
    let low = (0..4).min_by_key(|&i| p[i]).unwrap_or(0);
    Some([0, 1, 2, 3].map(|i| ring[(low + i) % 4]))
}

/// `list`, sorted by `key`, with only the last of each run of equal keys.
fn keep_last<T: Copy, K: PartialEq>(list: &mut Vec<T>, key: impl Fn(&T) -> K) {
    let mut kept = 0;
    for i in 0..list.len() {
        if i + 1 < list.len() && key(&list[i + 1]) == key(&list[i]) {
            continue;
        }
        list[kept] = list[i];
        kept += 1;
    }
    list.truncate(kept);
}

/// The lists each of `n` items lies in, by the lists' places, in list order (an item a list
/// names twice is in it twice).
struct Members {
    start: Vec<u32>,
    list: Vec<u32>,
}

impl Members {
    fn of<'a>(n: usize, lists: impl Iterator<Item = &'a Vec<u32>> + Clone) -> Members {
        let mut start = vec![0u32; n + 1];
        for &t in lists.clone().flatten().filter(|&&t| (t as usize) < n) {
            start[t as usize + 1] += 1;
        }
        for k in 0..n {
            start[k + 1] += start[k];
        }
        let (mut fill, mut list) = (start.clone(), vec![0; start[n] as usize]);
        for (k, l) in lists.enumerate() {
            for &t in l.iter().filter(|&&t| (t as usize) < n) {
                list[fill[t as usize] as usize] = k as u32;
                fill[t as usize] += 1;
            }
        }
        Members { start, list }
    }

    /// The places of the lists item `t` lies in.
    fn lists(&self, t: u32) -> &[u32] {
        let t = t as usize;
        if t + 1 >= self.start.len() {
            return &[];
        }
        &self.list[self.start[t] as usize..self.start[t + 1] as usize]
    }
}

impl Poly {
    /// The polygon view of `m`: each face's triangles merged into one loop where their boundary
    /// on welded points is one loop, and kept as triangles otherwise.
    pub fn of(m: &Mesh) -> Poly {
        Poly::of_welded(m, &m.welded())
    }

    /// [`Poly::of`] on `w`, `m`'s welded points.
    pub(crate) fn of_welded(m: &Mesh, w: &[u32]) -> Poly {
        let n = w.iter().max().map_or(0, |x| *x as usize + 1);
        let mut points = vec![[0.0; 3]; n];
        let mut seen = vec![false; n];
        for (k, &id) in w.iter().enumerate() {
            if !seen[id as usize] {
                seen[id as usize] = true;
                points[id as usize] = m.positions[k];
            }
        }
        let mut attrs = BTreeMap::new();
        for (name, values) in &m.attributes {
            let mut a = vec![0.0; n];
            let mut set = vec![false; n];
            for (k, &id) in w.iter().enumerate() {
                if !set[id as usize] {
                    set[id as usize] = true;
                    a[id as usize] = values[k];
                }
            }
            attrs.insert(name.clone(), a);
        }
        let has_uv = m.uv0.len() == m.positions.len() && !m.positions.is_empty();
        // Each face's triangles in order, the faces in the order of their first triangles.
        let tris = m.triangles();
        let group = first_seen(tris, |t| m.faces[t], |f| spread(u64::from(*f)));
        let groups = group.iter().max().map_or(0, |g| *g as usize + 1);
        let order = counted(tris, groups, |t| group[t as usize] as usize);
        let mut out = Poly {
            points,
            attrs,
            faces: Vec::with_capacity(groups),
            vertex: Vec::with_capacity(groups),
            origin: Vec::with_capacity(groups),
            uv: has_uv.then(|| Vec::with_capacity(groups)),
            ..Poly::default()
        };
        let mut scratch = Scratch::default();
        for tris in order.chunk_by(|a, b| group[*a as usize] == group[*b as usize]) {
            if tris.len() > 1 && scratch.boundary(tris, m, w) {
                out.push(&scratch.ring, m, has_uv, tris[0]);
            } else {
                for &t in tris {
                    let ring = [0, 1, 2].map(|j| {
                        let v = m.indices[3 * t as usize + j] as usize;
                        (w[v], v)
                    });
                    out.push(&ring, m, has_uv, t);
                }
            }
        }
        out
    }

    fn push(&mut self, ring: &[(u32, usize)], m: &Mesh, has_uv: bool, origin: u32) {
        self.faces.push(ring.iter().map(|c| c.0).collect());
        self.vertex.push(ring.iter().map(|c| c.1 as u32).collect());
        if let Some(uv) = &mut self.uv {
            uv.push(
                ring.iter()
                    .map(|c| if has_uv { m.uv0[c.1] } else { [0.0; 2] })
                    .collect(),
            );
        }
        self.origin.push(origin);
        if !m.weak.is_empty() {
            self.weak.resize(self.faces.len() - 1, false);
            self.weak.push(m.weak[origin as usize]);
        }
    }

    /// Each edge by its sorted ends, with the faces on it.
    pub fn edges(&self) -> BTreeMap<(u32, u32), Vec<usize>> {
        let mut e: BTreeMap<(u32, u32), Vec<usize>> = BTreeMap::new();
        for (f, c) in self.faces.iter().enumerate() {
            for i in 0..c.len() {
                e.entry(key(c[i], c[(i + 1) % c.len()]))
                    .or_default()
                    .push(f);
            }
        }
        e
    }

    /// The sum of the faces' sizes.
    pub fn corners(&self) -> usize {
        self.faces.iter().map(Vec::len).sum()
    }

    /// A face's normal, by Newell's method on its corners, its terms summed in sorted order so it
    /// never depends on where the face's list starts.
    pub fn normal(&self, f: usize) -> V3 {
        let c = &self.faces[f];
        let term = |k: usize| {
            let (a, b) = (
                self.points[c[k] as usize],
                self.points[c[(k + 1) % c.len()] as usize],
            );
            [
                (a[1] - b[1]) * (a[2] + b[2]),
                (a[2] - b[2]) * (a[0] + b[0]),
                (a[0] - b[0]) * (a[1] + b[1]),
            ]
        };
        // A small face's terms stay on the stack.
        let (mut small, mut large) = ([[0.0; 3]; 8], Vec::new());
        let terms: &mut [V3] = if c.len() <= small.len() {
            for (k, t) in small.iter_mut().enumerate().take(c.len()) {
                *t = term(k);
            }
            &mut small[..c.len()]
        } else {
            large.extend((0..c.len()).map(term));
            &mut large
        };
        // Equal terms are equal bits, so an unstable sort orders them as a stable one would.
        terms.sort_unstable_by(|a, b| {
            (0..3)
                .map(|k| a[k].total_cmp(&b[k]))
                .find(|o| o.is_ne())
                .unwrap_or(Ordering::Equal)
        });
        terms
            .iter()
            .fold([0.0; 3], |s, t| [s[0] + t[0], s[1] + t[1], s[2] + t[2]])
    }

    /// The mesh: one vertex per face corner (so its count is the corner count), each face's
    /// triangles one face, its parts and closed parts and face attributes those of its origin in
    /// `src`, and smooth normals (area-weighted on welded points) unless `normals` gives each
    /// corner's.
    pub fn mesh(&self, src: &Mesh, normals: Option<&[Vec<V3>]>) -> Mesh {
        match normals {
            Some(n) => self.mesh_by(src, |_, f, k| n[f][k]),
            None => {
                let smooth = self.smooth_normals();
                self.mesh_by(src, |_, f, k| smooth[self.faces[f][k] as usize])
            }
        }
    }

    /// [`Poly::mesh`] with every corner's normal in one list, face after face.
    pub(crate) fn mesh_flat(&self, src: &Mesh, normals: &[V3]) -> Mesh {
        self.mesh_by(src, |corner, _, _| normals[corner])
    }

    /// [`Poly::mesh`] with the normal of each corner (its place in all, its face, its place there).
    fn mesh_by(&self, src: &Mesh, normal: impl Fn(usize, usize, usize) -> V3) -> Mesh {
        let carry_uv1 =
            self.vertex.len() == self.faces.len() && src.uv1.len() == src.positions.len();
        // A face of n corners makes n − 2 triangles (fewer where one has no area).
        let (corners, tris) = (
            self.corners(),
            self.corners().saturating_sub(2 * self.faces.len()),
        );
        let mut out = Mesh {
            outputs: src.outputs.clone(),
            positions: Vec::with_capacity(corners),
            normals: Vec::with_capacity(corners),
            indices: Vec::with_capacity(3 * tris),
            faces: Vec::with_capacity(tris),
            uv0: Vec::with_capacity(if self.uv.is_some() { corners } else { 0 }),
            uv1: Vec::with_capacity(if carry_uv1 { corners } else { 0 }),
            ..Mesh::default()
        };
        // Each source triangle's parts and closed parts, by their places in name order.
        let part_of = Members::of(src.triangles(), src.parts.values());
        let closed_of = Members::of(src.triangles(), src.closed.values().map(|c| &c.0));
        let mut parts: Vec<Vec<u32>> = vec![Vec::new(); src.parts.len()];
        let mut closed: Vec<Vec<u32>> = vec![Vec::new(); src.closed.len()];
        // Each vertex's point and each triangle's origin, for the attributes.
        let mut point_of: Vec<u32> = Vec::with_capacity(corners);
        let mut origin_of: Vec<u32> = Vec::with_capacity(tris);
        for (f, c) in self.faces.iter().enumerate() {
            let base = out.positions.len() as u32;
            for (k, &i) in c.iter().enumerate() {
                // The vertex; its attributes are written once all are in.
                out.normals.push(normal(out.positions.len(), f, k));
                out.positions.push(self.points[i as usize]);
                point_of.push(i);
                if let Some(uv) = &self.uv {
                    out.uv0.push(uv[f][k]);
                }
                if carry_uv1 {
                    out.uv1.push(src.uv1[self.vertex[f][k] as usize]);
                }
            }
            let first = out.triangles();
            let face = f as u32;
            match c.len() {
                3 => out.tri(base, base + 1, base + 2, face),
                4 => out.quad(base, base + 1, base + 2, base + 3, face),
                _ => {
                    let pts: Vec<V3> = c.iter().map(|&i| self.points[i as usize]).collect();
                    let (u, v) = basis(unit(newell(&pts)));
                    let flat: Vec<V2> = pts.iter().map(|p| [dot(*p, u), dot(*p, v)]).collect();
                    for [a, b, d] in triangulate(&flat, &[]) {
                        out.tri(base + a, base + b, base + d, face);
                    }
                }
            }
            let origin = self.origin[f];
            for t in first..out.triangles() {
                if !self.weak.is_empty() {
                    out.weak.push(self.weak[f]);
                }
                for &k in part_of.lists(origin) {
                    parts[k as usize].push(t as u32);
                }
                for &k in closed_of.lists(origin) {
                    closed[k as usize].push(t as u32);
                }
                origin_of.push(origin);
            }
        }
        // A part or closed part is kept where a triangle lies in it.
        for (name, tris) in src.parts.keys().zip(parts) {
            if !tris.is_empty() {
                out.parts.insert(name.clone(), tris);
            }
        }
        for ((name, (_, genus)), tris) in src.closed.iter().zip(closed) {
            if !tris.is_empty() {
                out.closed.insert(name.clone(), (tris, *genus));
            }
        }
        for (name, values) in &self.attrs {
            let v = point_of.iter().map(|&i| values[i as usize]).collect();
            out.attributes.insert(name.clone(), v);
        }
        for (name, values) in &src.face_attributes {
            let v = origin_of.iter().map(|&o| values[o as usize]).collect();
            out.face_attributes.insert(name.clone(), v);
        }
        out
    }

    /// Each point's normal: the sum of its faces' Newell normals (so weighted by area), unit.
    pub fn smooth_normals(&self) -> Vec<V3> {
        let mut n = vec![[0.0; 3]; self.points.len()];
        for f in 0..self.faces.len() {
            let fnorm = self.normal(f);
            for &i in &self.faces[f] {
                let s = &mut n[i as usize];
                *s = [s[0] + fnorm[0], s[1] + fnorm[1], s[2] + fnorm[2]];
            }
        }
        n.into_iter().map(unit).collect()
    }

    /// The angle between the normals of the two faces on each interior edge, in degrees.
    pub fn dihedral(&self, faces: &[usize]) -> f64 {
        if faces.len() != 2 {
            return 180.0;
        }
        let (a, b) = (unit(self.normal(faces[0])), unit(self.normal(faces[1])));
        let c = dot(a, b).clamp(-1.0, 1.0);
        let s = crate::geom::length(cross(a, b));
        deep_canvas::ops::deg(deep_canvas::ops::atan2(s, c))
    }
}

/// How a refinement places new points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scheme {
    CatmullClark,
    Loop,
    /// Catmull-Clark's topology with every new point the plain average: nothing moves.
    Simple,
    /// Loop's topology with every new point the plain average (Loop's linear uv).
    Midpoint,
}

/// How a refinement treats a boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Boundary {
    /// Every boundary point follows the boundary curve.
    Smooth,
    /// A boundary point on only two edges stays where it is.
    SharpCorners,
}

/// Rows of `d` numbers, one per point: positions, uvs or attributes.
type Rows = Vec<Vec<f64>>;

/// The mean of `rows`, summed in sorted order so the result never depends on their order.
fn mean(mut rows: Vec<&[f64]>) -> Vec<f64> {
    rows.sort_by(|a, b| {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| x.total_cmp(y))
            .find(|o| *o != Ordering::Equal)
            .unwrap_or(Ordering::Equal)
    });
    let d = rows.first().map_or(0, |r| r.len());
    let mut s = vec![0.0; d];
    for r in &rows {
        for k in 0..d {
            s[k] += r[k];
        }
    }
    let n = rows.len() as f64;
    s.into_iter().map(|x| x / n).collect()
}

fn mix(a: &[f64], b: &[f64], t: f64) -> Vec<f64> {
    a.iter().zip(b).map(|(x, y)| x + (y - x) * t).collect()
}

/// `f` over 0..n in `blocks` ranges, each made alone and joined in block order (Operator:
/// `parallel: fixed_blocks`), so the result never depends on the block count.
pub fn blocked<T>(n: usize, blocks: usize, f: impl Fn(usize) -> T) -> Vec<T> {
    let b = blocks.max(1);
    let mut out = Vec::with_capacity(n);
    for k in 0..b {
        let block: Vec<T> = (k * n / b..(k + 1) * n / b).map(&f).collect();
        out.extend(block);
    }
    out
}

/// The topology of a refinement: faces over point IDs, with edge sharpness.
#[derive(Clone, Debug, Default)]
pub struct Topo {
    pub faces: Vec<Vec<u32>>,
    pub points: usize,
    pub sharp: BTreeMap<(u32, u32), f64>,
}

/// One level of refinement of `t` and its rows: Catmull-Clark and simple make each n-sided face
/// n quads (vertex points, then edge points, then face points); Loop makes each triangle four
/// (vertex points, then edge points). Each new quad starts at its vertex point; each sharp
/// edge's halves are one level less sharp.
pub fn refine(
    t: &Topo,
    rows: &Rows,
    scheme: Scheme,
    boundary: Boundary,
    blocks: usize,
) -> (Topo, Rows) {
    let mut edges: BTreeMap<(u32, u32), Vec<usize>> = BTreeMap::new();
    for (f, c) in t.faces.iter().enumerate() {
        for i in 0..c.len() {
            edges
                .entry(key(c[i], c[(i + 1) % c.len()]))
                .or_default()
                .push(f);
        }
    }
    let n = t.points;
    let index: BTreeMap<(u32, u32), u32> = edges
        .keys()
        .enumerate()
        .map(|(k, e)| (*e, (n + k) as u32))
        .collect();
    let quads = !matches!(scheme, Scheme::Loop | Scheme::Midpoint);
    let linear = matches!(scheme, Scheme::Simple | Scheme::Midpoint);
    let fbase = n + edges.len();
    let face_pts: Rows = if quads {
        blocked(t.faces.len(), blocks, |f| {
            mean(
                t.faces[f]
                    .iter()
                    .map(|&i| rows[i as usize].as_slice())
                    .collect(),
            )
        })
    } else {
        Vec::new()
    };
    let sharp = |e: &(u32, u32), faces: &[usize]| -> f64 {
        if faces.len() != 2 {
            f64::INFINITY
        } else {
            t.sharp.get(e).copied().unwrap_or(0.0)
        }
    };
    // The point opposite an edge in a triangle (Loop).
    let opposite = |f: usize, e: &(u32, u32)| -> u32 {
        *t.faces[f]
            .iter()
            .find(|&&v| v != e.0 && v != e.1)
            .unwrap_or(&e.0)
    };
    let mut out_rows: Rows = Vec::with_capacity(fbase + face_pts.len());
    // Vertex points.
    let mut around: Vec<Vec<(u32, u32)>> = vec![Vec::new(); n];
    for e in edges.keys() {
        around[e.0 as usize].push(*e);
        around[e.1 as usize].push(*e);
    }
    let mut faces_at: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (f, c) in t.faces.iter().enumerate() {
        for &i in c {
            faces_at[i as usize].push(f);
        }
    }
    let vertex_point = |v: usize| -> Vec<f64> {
        let p = rows[v].as_slice();
        let es = &around[v];
        if linear || es.is_empty() {
            return p.to_vec();
        }
        let other = |e: &(u32, u32)| if e.0 as usize == v { e.1 } else { e.0 };
        let crease = |a: u32, b: u32| -> Vec<f64> {
            let (ra, rb) = (&rows[a as usize], &rows[b as usize]);
            p.iter()
                .zip(ra.iter().zip(rb))
                .map(|(x, (y, z))| {
                    if quads {
                        (y + z + 6.0 * x) / 8.0
                    } else {
                        0.75 * x + (y + z) / 8.0
                    }
                })
                .collect()
        };
        let open: Vec<&(u32, u32)> = es.iter().filter(|e| edges[e].len() != 2).collect();
        if !open.is_empty() {
            let corner = boundary == Boundary::SharpCorners && es.len() == 2;
            return if corner || open.len() != 2 {
                p.to_vec()
            } else {
                crease(other(open[0]), other(open[1]))
            };
        }
        let smooth: Vec<f64> = if quads {
            let k = es.len() as f64;
            let q = mean(
                faces_at[v]
                    .iter()
                    .map(|&f| face_pts[f].as_slice())
                    .collect(),
            );
            let mids: Rows = es
                .iter()
                .map(|e| {
                    rows[e.0 as usize]
                        .iter()
                        .zip(&rows[e.1 as usize])
                        .map(|(a, b)| 0.5 * (a + b))
                        .collect()
                })
                .collect();
            let r = mean(mids.iter().map(Vec::as_slice).collect());
            (0..p.len())
                .map(|j| (q[j] + 2.0 * r[j] + (k - 3.0) * p[j]) / k)
                .collect()
        } else {
            let k = es.len();
            let beta = if k == 3 {
                3.0 / 16.0
            } else {
                3.0 / (8.0 * k as f64)
            };
            let ring = mean(
                es.iter()
                    .map(|e| rows[other(e) as usize].as_slice())
                    .collect(),
            );
            (0..p.len())
                .map(|j| (1.0 - k as f64 * beta) * p[j] + k as f64 * beta * ring[j])
                .collect()
        };
        let creased: Vec<&(u32, u32)> = es.iter().filter(|e| sharp(e, &edges[e]) > 0.0).collect();
        if creased.len() < 2 {
            return smooth;
        }
        let s = creased.iter().map(|e| sharp(e, &edges[e])).sum::<f64>() / creased.len() as f64;
        let rule = if creased.len() == 2 {
            crease(other(creased[0]), other(creased[1]))
        } else {
            p.to_vec()
        };
        if s >= 1.0 {
            rule
        } else {
            mix(&smooth, &rule, s)
        }
    };
    // Edge points.
    let edge_list: Vec<(&(u32, u32), &Vec<usize>)> = edges.iter().collect();
    let edge_point = |i: usize| -> Vec<f64> {
        let (e, faces) = edge_list[i];
        let (a, b) = (rows[e.0 as usize].as_slice(), rows[e.1 as usize].as_slice());
        let mid: Vec<f64> = a.iter().zip(b).map(|(x, y)| 0.5 * (x + y)).collect();
        let s = sharp(e, faces);
        if linear || s >= 1.0 {
            return mid;
        }
        let smooth = if quads {
            mean(vec![a, b, &face_pts[faces[0]], &face_pts[faces[1]]])
        } else {
            let (o0, o1) = (opposite(faces[0], e), opposite(faces[1], e));
            let o = mean(vec![&rows[o0 as usize], &rows[o1 as usize]]);
            a.iter()
                .zip(b)
                .zip(&o)
                .map(|((x, y), z)| 0.75 * (0.5 * (x + y)) + 0.25 * z)
                .collect()
        };
        if s > 0.0 {
            mix(&smooth, &mid, s)
        } else {
            smooth
        }
    };
    out_rows.extend(blocked(n, blocks, vertex_point));
    out_rows.extend(blocked(edge_list.len(), blocks, edge_point));
    out_rows.extend(face_pts);
    let mut faces = Vec::new();
    for (f, c) in t.faces.iter().enumerate() {
        let k = c.len();
        let e = |i: usize, j: usize| index[&key(c[i % k], c[j % k])];
        if quads {
            for (i, &v) in c.iter().enumerate() {
                faces.push(vec![v, e(i, i + 1), (fbase + f) as u32, e(i + k - 1, i)]);
            }
        } else {
            let [ab, bc, ca] = [e(0, 1), e(1, 2), e(2, 0)];
            faces.extend([
                vec![c[0], ab, ca],
                vec![ab, c[1], bc],
                vec![ca, bc, c[2]],
                vec![ab, bc, ca],
            ]);
        }
    }
    let mut next = BTreeMap::new();
    for (e, s) in &t.sharp {
        if *s > 1.0 {
            if let Some(&m) = index.get(e) {
                next.insert(key(e.0, m), s - 1.0);
                next.insert(key(m, e.1), s - 1.0);
            }
        }
    }
    let points = out_rows.len();
    (
        Topo {
            faces,
            points,
            sharp: next,
        },
        out_rows,
    )
}

/// The (points, edges, faces, corners) one level of `scheme` gives from (V, E, F, C) on welded
/// points (Modifier: subdivide): Catmull-Clark and simple V + E + F, 2E + C, C, 4C; Loop on
/// triangles V + E, 2E + 3F, 4F, 12F.
pub fn counts(scheme: Scheme, (v, e, f, c): (u64, u64, u64, u64)) -> (u64, u64, u64, u64) {
    match scheme {
        Scheme::Loop | Scheme::Midpoint => (v + e, 2 * e + 3 * f, 4 * f, 12 * f),
        _ => (v + e + f, 2 * e + c, c, 4 * c),
    }
}

/// Points as rows.
pub fn rows_of(points: &[V3]) -> Rows {
    points.iter().map(|p| p.to_vec()).collect()
}

/// A V3 back from a row.
pub fn v3(r: &[f64]) -> V3 {
    [r[0], r[1], r[2]]
}

/// How subdivide treats uv (Modifier: subdivide `uv`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UvRule {
    Linear,
    KeepCorners,
    Smooth,
}

/// The wrong programs #440's subdivision criteria plant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// Each face's edge from its first corner takes the midpoint, as if creased, so the result
    /// depends on where a face's list starts.
    pub first_corner_order: bool,
}

impl Poly {
    /// Every triangle of `m` its own face (Loop's input).
    pub fn triangles_of(m: &Mesh) -> Poly {
        let mut one = m.clone();
        one.faces = (0..m.triangles() as u32).collect();
        Poly::of(&one)
    }

    /// `levels` of uniform refinement: positions by `scheme` with the edge sharpness, uv by
    /// `uv` over the uv seams, point attributes as uv; each child face keeps its parent's origin.
    pub fn subdivided(
        &self,
        levels: u32,
        scheme: Scheme,
        boundary: Boundary,
        uv: UvRule,
        plants: Plants,
        blocks: usize,
    ) -> Poly {
        let mut p = self.clone();
        for _ in 0..levels {
            p = p.refined(scheme, boundary, uv, plants, blocks);
        }
        p
    }

    fn refined(
        &self,
        scheme: Scheme,
        boundary: Boundary,
        uv: UvRule,
        plants: Plants,
        blocks: usize,
    ) -> Poly {
        let mut topo = Topo {
            faces: self.faces.clone(),
            points: self.points.len(),
            sharp: self.sharp.clone(),
        };
        if plants.first_corner_order {
            for c in &self.faces {
                topo.sharp.entry(key(c[0], c[1])).or_insert(1.0);
            }
        }
        let fv_scheme = match (uv, scheme) {
            (UvRule::Linear, Scheme::Loop) => Scheme::Midpoint,
            (UvRule::Linear, _) => Scheme::Simple,
            (_, s) => s,
        };
        let fv_boundary = match uv {
            UvRule::Smooth => Boundary::Smooth,
            _ => Boundary::SharpCorners,
        };
        let (next, rows) = refine(&topo, &rows_of(&self.points), scheme, boundary, blocks);
        let children = if scheme == Scheme::Loop { 4 } else { 0 };
        let origin: Vec<u32> = self
            .faces
            .iter()
            .zip(&self.origin)
            .flat_map(|(c, o)| {
                std::iter::repeat_n(*o, if children > 0 { children } else { c.len() })
            })
            .collect();
        let weak: Vec<bool> = if self.weak.is_empty() {
            Vec::new()
        } else {
            self.faces
                .iter()
                .zip(&self.weak)
                .flat_map(|(c, w)| {
                    std::iter::repeat_n(*w, if children > 0 { children } else { c.len() })
                })
                .collect()
        };
        let mut out = Poly {
            points: rows.iter().map(|r| v3(r)).collect(),
            faces: next.faces.clone(),
            origin,
            weak,
            sharp: next.sharp.clone(),
            ..Poly::default()
        };
        // Point attributes, on the point topology.
        for (name, values) in &self.attrs {
            let rows: Rows = values.iter().map(|v| vec![*v]).collect();
            let topo = Topo {
                sharp: BTreeMap::new(),
                ..topo.clone()
            };
            let (_, r) = refine(&topo, &rows, fv_scheme, fv_boundary, blocks);
            out.attrs
                .insert(name.clone(), r.into_iter().map(|x| x[0]).collect());
        }
        // uv, on its own topology: corners share a uv point where they share a point and a uv.
        if let Some(uv) = &self.uv {
            let mut ids: BTreeMap<(u32, u64, u64), u32> = BTreeMap::new();
            let mut rows: Rows = Vec::new();
            let faces: Vec<Vec<u32>> = self
                .faces
                .iter()
                .zip(uv)
                .map(|(c, t)| {
                    c.iter()
                        .zip(t)
                        .map(|(&i, q)| {
                            let k = (i, q[0].to_bits(), q[1].to_bits());
                            let next = ids.len() as u32;
                            *ids.entry(k).or_insert_with(|| {
                                rows.push(q.to_vec());
                                next
                            })
                        })
                        .collect()
                })
                .collect();
            let t = Topo {
                faces,
                points: rows.len(),
                sharp: BTreeMap::new(),
            };
            let (tn, r) = refine(&t, &rows, fv_scheme, fv_boundary, blocks);
            out.uv = Some(
                tn.faces
                    .iter()
                    .map(|c| {
                        c.iter()
                            .map(|&i| [r[i as usize][0], r[i as usize][1]])
                            .collect()
                    })
                    .collect(),
            );
        }
        out
    }
}
