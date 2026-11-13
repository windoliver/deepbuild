//! geometry.shading's counts on one mesh (canvas primitives: Check input: loop kinds: shading
//! defects; …: quad ratio; issue #453): its positions welded within `weld`, then each defect
//! counted per face or edge, and its triangles paired back into quads, best first.

use std::collections::BTreeMap;

use deep_canvas::ops::{acos, deg, sqrt};

pub type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
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
fn len(a: V3) -> f64 {
    sqrt(dot(a, a))
}
/// The angle between `a` and `b` in degrees; 180 when either is zero.
fn angle(a: V3, b: V3) -> f64 {
    let l = len(a) * len(b);
    if l == 0.0 {
        return 180.0;
    }
    deg(acos((dot(a, b) / l).clamp(-1.0, 1.0)))
}

/// One triangle primitive as the file holds it: its positions, its corner normals where it has
/// them, and its triangles' corners.
pub struct Prim {
    pub positions: Vec<V3>,
    pub normals: Option<Vec<V3>>,
    pub indices: Vec<u32>,
}

/// The check input's numbers, and the wrong program a proof surface planted, if any.
#[derive(Clone, Copy)]
pub struct Opts<'a> {
    pub weld: f64,
    pub degenerate_area: f64,
    pub normal_max: f64,
    pub corner_max: f64,
    pub planted: Option<&'a str>,
}

impl Opts<'_> {
    fn plants(&self, p: &str) -> bool {
        self.planted == Some(p)
    }
}

/// An edge between two welded vertices, the lower first.
pub type Edge = [u32; 2];

/// What the check counted, every list in ascending order: faces by their index across the mesh's
/// primitives in file order, vertices and edges by welded vertex.
#[derive(Debug, Default)]
pub struct Counts {
    pub welded: usize,
    /// Each welded vertex's first member, as its index across the primitives' positions.
    pub first: Vec<usize>,
    pub triangles: usize,
    pub non_manifold_edges: Vec<Edge>,
    pub non_manifold_vertices: Vec<u32>,
    pub inconsistent_edges: Vec<Edge>,
    pub flipped_faces: Vec<usize>,
    pub degenerate_faces: Vec<usize>,
    pub boundary_edges: Vec<Edge>,
    /// The mesh's signed volume, when it is closed: every welded edge has exactly two faces.
    pub volume: Option<f64>,
    pub pairs: usize,
    pub unpaired: Vec<usize>,
}

impl Counts {
    pub fn quad_ratio(&self) -> f64 {
        if self.triangles == 0 {
            return 0.0;
        }
        2.0 * self.pairs as f64 / self.triangles as f64
    }
}

/// Each position's welded vertex: positions within `weld` of each other join one vertex,
/// numbered in the order each first appears.
pub fn weld(points: &[V3], weld: f64) -> (Vec<u32>, usize) {
    let mut parent: Vec<usize> = (0..points.len()).collect();
    fn root(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    let cell = |p: V3| -> [i64; 3] {
        let s = if weld > 0.0 { weld } else { 1.0 };
        p.map(|c| (c / s).floor() as i64)
    };
    let mut grid: BTreeMap<[i64; 3], Vec<usize>> = BTreeMap::new();
    for (i, p) in points.iter().enumerate() {
        let c = cell(*p);
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let Some(near) = grid.get(&[c[0] + dx, c[1] + dy, c[2] + dz]) else {
                        continue;
                    };
                    for &j in near {
                        if len(sub(*p, points[j])) <= weld {
                            let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                            parent[a.max(b)] = a.min(b);
                        }
                    }
                }
            }
        }
        grid.entry(c).or_default().push(i);
    }
    let mut number: BTreeMap<usize, u32> = BTreeMap::new();
    let mut out = Vec::with_capacity(points.len());
    for i in 0..points.len() {
        let r = root(&mut parent, i);
        let n = number.len() as u32;
        out.push(*number.entry(r).or_insert(n));
    }
    let n = number.len();
    (out, n)
}

/// One face: its welded corners, its positions and its corner normals.
struct Face {
    v: [u32; 3],
    p: [V3; 3],
    n: Option<[V3; 3]>,
    /// Its vector area's direction times twice its area.
    area2: V3,
}

/// Counts every defect of the mesh made of `prims` and pairs its triangles.
pub fn count(prims: &[&Prim], o: &Opts) -> Counts {
    let points: Vec<V3> = prims
        .iter()
        .flat_map(|p| p.positions.iter().copied())
        .collect();
    let (welded, nwelded) = if o.plants("no_weld") {
        ((0..points.len() as u32).collect(), points.len())
    } else {
        weld(&points, o.weld)
    };
    let mut faces: Vec<Face> = Vec::new();
    let mut c = Counts {
        welded: nwelded,
        first: vec![0; nwelded],
        ..Counts::default()
    };
    // Every welded vertex has a member, and the last write, walking down, is its first.
    for (i, w) in welded.iter().enumerate().rev() {
        c.first[*w as usize] = i;
    }
    let mut base = 0usize;
    for prim in prims {
        // The part's bounds diagonal, squared: a face under degenerate_area of it is degenerate.
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in &prim.positions {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let diag2 = if prim.positions.is_empty() {
            0.0
        } else {
            dot(sub(hi, lo), sub(hi, lo))
        };
        for t in prim.indices.as_chunks::<3>().0 {
            let i = [t[0], t[1], t[2]].map(|i| i as usize);
            let p = i.map(|i| prim.positions[i]);
            let area2 = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            let f = faces.len();
            let area = len(area2) / 2.0;
            let v = i.map(|i| welded[base + i]);
            // A face whose corners weld together is degenerate whatever its area.
            let degenerate = if o.plants("degenerate_exact_zero") {
                area == 0.0
            } else {
                area < o.degenerate_area * diag2 || v[0] == v[1] || v[1] == v[2] || v[0] == v[2]
            };
            if degenerate {
                c.degenerate_faces.push(f);
            }
            faces.push(Face {
                v,
                p,
                n: prim.normals.as_ref().map(|n| i.map(|i| n[i])),
                area2,
            });
        }
        base += prim.positions.len();
    }
    c.triangles = faces.len();
    // A face is flipped when its corner normals point against its own vector area.
    let sum: f64 = faces
        .iter()
        .map(|f| dot(f.p[0], cross(f.p[1], f.p[2])))
        .sum();
    for (f, face) in faces.iter().enumerate() {
        if o.plants("one_winding_sum") {
            // The wrong program: one winding sum judges every face.
            if sum < 0.0 {
                c.flipped_faces.push(f);
            }
            continue;
        }
        if let Some(n) = face.n {
            if dot(add(add(n[0], n[1]), n[2]), face.area2) < 0.0 {
                c.flipped_faces.push(f);
            }
        }
    }
    // Each welded edge's faces, with whether each runs it from the lower vertex up. A face whose
    // corners weld together has no edges.
    let mut edges: BTreeMap<Edge, Vec<(usize, bool)>> = BTreeMap::new();
    for (f, face) in faces.iter().enumerate() {
        let v = face.v;
        if v[0] == v[1] || v[1] == v[2] || v[0] == v[2] {
            continue;
        }
        for k in 0..3 {
            let (a, b) = (v[k], v[(k + 1) % 3]);
            edges
                .entry([a.min(b), a.max(b)])
                .or_default()
                .push((f, a < b));
        }
    }
    for (e, fs) in &edges {
        match fs.len() {
            1 => c.boundary_edges.push(*e),
            2 if fs[0].1 == fs[1].1 => c.inconsistent_edges.push(*e),
            2 => {}
            _ => c.non_manifold_edges.push(*e),
        }
    }
    if !o.plants("vertex_fans_skipped") {
        c.non_manifold_vertices = fans(&faces, &edges);
    }
    if c.boundary_edges.is_empty() && c.non_manifold_edges.is_empty() && !edges.is_empty() {
        c.volume = Some(sum / 6.0);
    }
    pair(&faces, &edges, o, &mut c);
    c
}

/// The welded vertices whose faces make more than one fan: faces around a vertex join when they
/// share an edge from it with exactly two faces.
fn fans(faces: &[Face], edges: &BTreeMap<Edge, Vec<(usize, bool)>>) -> Vec<u32> {
    // Each vertex's faces, and the pairs of them its two-faced edges join.
    let mut around: BTreeMap<u32, (Vec<usize>, Vec<[usize; 2]>)> = BTreeMap::new();
    for (e, fs) in edges {
        for (f, _) in fs {
            for v in faces[*f].v {
                let list = &mut around.entry(v).or_default().0;
                if !list.contains(f) {
                    list.push(*f);
                }
            }
        }
        if let [a, b] = fs[..] {
            for v in e {
                around.entry(*v).or_default().1.push([a.0, b.0]);
            }
        }
    }
    fn root(g: &mut [usize], mut i: usize) -> usize {
        while g[i] != i {
            i = g[i];
        }
        i
    }
    let mut out = Vec::new();
    for (v, (fs, joins)) in around {
        let mut group: Vec<usize> = (0..fs.len()).collect();
        for [a, b] in joins {
            let at = |f: usize| fs.iter().position(|x| *x == f);
            if let (Some(a), Some(b)) = (at(a), at(b)) {
                let (ra, rb) = (root(&mut group, a), root(&mut group, b));
                group[ra.max(rb)] = ra.min(rb);
            }
        }
        if (0..fs.len()).filter(|i| root(&mut group, *i) == *i).count() > 1 {
            out.push(v);
        }
    }
    out
}

/// Pairs triangles across shared edges into quads, best first by their worst corner, ties to the
/// lower triangle indices; each triangle joins one pair at most.
fn pair(faces: &[Face], edges: &BTreeMap<Edge, Vec<(usize, bool)>>, o: &Opts, c: &mut Counts) {
    let mut candidates: Vec<(f64, usize, usize)> = Vec::new();
    for (e, fs) in edges {
        if fs.len() != 2 {
            continue;
        }
        let (f, g) = (fs[0].0.min(fs[1].0), fs[0].0.max(fs[1].0));
        if angle(faces[f].area2, faces[g].area2) > o.normal_max {
            continue;
        }
        let worst = if o.plants("pair_ignores_corners") {
            0.0
        } else if let Some(w) = quad(&faces[f], &faces[g], *e) {
            w
        } else {
            continue;
        };
        if worst <= o.corner_max {
            candidates.push((worst, f, g));
        }
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut taken = vec![false; faces.len()];
    for (_, f, g) in candidates {
        if !taken[f] && !taken[g] {
            taken[f] = true;
            taken[g] = true;
            c.pairs += 1;
        }
    }
    c.unpaired = (0..faces.len()).filter(|f| !taken[*f]).collect();
}

/// The quad two faces sharing edge `e` make, as its worst corner's distance from a right angle
/// in degrees; none when it isn't convex.
fn quad(f: &Face, g: &Face, e: Edge) -> Option<f64> {
    let apex = |x: &Face| -> Option<V3> {
        (0..3)
            .find(|k| x.v[*k] != e[0] && x.v[*k] != e[1])
            .map(|k| x.p[k])
    };
    let at = |x: &Face, v: u32| -> Option<V3> { (0..3).find(|k| x.v[*k] == v).map(|k| x.p[k]) };
    let (c, d) = (apex(f)?, apex(g)?);
    let (a, b) = (at(f, e[0])?, at(f, e[1])?);
    // Around the quad: a, c, b, d (the shared edge is its diagonal a–b).
    let ring = [a, c, b, d];
    let normal = add(f.area2, g.area2);
    let mut worst: f64 = 0.0;
    let mut sign = 0.0;
    for k in 0..4 {
        let (prev, here, next) = (ring[(k + 3) % 4], ring[k], ring[(k + 1) % 4]);
        let turn = dot(cross(sub(here, prev), sub(next, here)), normal);
        if turn == 0.0 || (sign != 0.0 && turn.signum() != sign) {
            return None;
        }
        sign = turn.signum();
        worst = worst.max((angle(sub(prev, here), sub(next, here)) - 90.0).abs());
    }
    Some(worst)
}
