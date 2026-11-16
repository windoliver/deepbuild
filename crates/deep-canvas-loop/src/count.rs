//! geometry.shading's counts on one mesh (canvas primitives: Check input: loop kinds: shading
//! defects; …: quad ratio; issue #453): its positions welded within `weld`, then each defect
//! counted per face or edge, and its triangles paired back into quads, best first.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use deep_canvas::ops::{acos, cos, deg, sqrt};

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
/// The angle between `a` and `b`, whose lengths multiply to `l`, in degrees; 180 when either is
/// zero.
fn angle(a: V3, b: V3, l: f64) -> f64 {
    if l == 0.0 {
        return 180.0;
    }
    deg(acos(cosine(a, b, l)))
}
/// The cosine `angle` takes the arccosine of.
fn cosine(a: V3, b: V3, l: f64) -> f64 {
    (dot(a, b) / l).clamp(-1.0, 1.0)
}

/// How far apart two cosines must be for their angles to be told apart with no arccosine: an
/// angle in degrees moves at least 57° per unit of its cosine, so cosines 1e-9 apart are over
/// 5e-8° apart, and the arccosine rounds by under 1e-12°.
const CLEAR: f64 = 1e-9;

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
    /// #1935: each position's welded vertex, across the primitives.
    pub vertices: Vec<u32>,
    /// Each face's area, m².
    pub areas: Vec<f64>,
    /// The welded vertices no triangle uses, each by its first member's index across the
    /// primitives: primitives that share one vertex list use each other's vertices.
    pub unused: Vec<usize>,
    /// The islands (faces that share a welded vertex are one), and the smallest by area: its
    /// share of the mesh's area and its faces.
    pub islands: usize,
    pub smallest_share: f64,
    pub smallest_island: Vec<usize>,
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
    let cells: Vec<[i64; 3]> = points.iter().map(|p| cell(*p)).collect();
    // The grid holds blocks of four cells a side, so a cell's 27 neighbours lie in one to eight
    // blocks; each block lists its positions through `next`, newest first.
    let mut grid: HashMap<(i64, i64, i64), usize, BuildHasherDefault<CellHash>> =
        HashMap::default();
    let mut next: Vec<Option<usize>> = vec![None; points.len()];
    for (i, p) in points.iter().enumerate() {
        let c = cells[i];
        // Along each axis, the blocks that hold c − 1 to c + 1.
        let lo = c.map(|x| x.saturating_sub(1).div_euclid(4));
        let hi = c.map(|x| x.saturating_add(1).div_euclid(4));
        for bx in lo[0]..=hi[0] {
            for by in lo[1]..=hi[1] {
                for bz in lo[2]..=hi[2] {
                    let mut at = grid.get(&(bx, by, bz)).copied();
                    while let Some(j) = at {
                        let near = (0..3).all(|k| cells[j][k].abs_diff(c[k]) <= 1);
                        if near && len(sub(*p, points[j])) <= weld {
                            let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                            parent[a.max(b)] = a.min(b);
                        }
                        at = next[j];
                    }
                }
            }
        }
        let block = c.map(|x| x.div_euclid(4));
        next[i] = grid.insert((block[0], block[1], block[2]), i);
    }
    let mut number: Vec<Option<u32>> = vec![None; points.len()];
    let mut n = 0u32;
    let mut out = Vec::with_capacity(points.len());
    for i in 0..points.len() {
        let r = root(&mut parent, i);
        out.push(*number[r].get_or_insert_with(|| {
            n += 1;
            n - 1
        }));
    }
    (out, n as usize)
}

/// FxHash's rotate and multiply, for the weld grid's blocks: the grid is only looked up, never
/// iterated, so no order of it shows.
#[derive(Default)]
struct CellHash(u64);

impl Hasher for CellHash {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.write_u64(u64::from(*b));
        }
    }
    fn write_u64(&mut self, x: u64) {
        self.0 = (self.0.rotate_left(5) ^ x).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
    fn write_i64(&mut self, x: i64) {
        self.write_u64(x as u64);
    }
}

/// One face: its welded corners, its positions and its corner normals.
struct Face {
    v: [u32; 3],
    p: [V3; 3],
    n: Option<[V3; 3]>,
    /// Its vector area's direction times twice its area.
    area2: V3,
    /// Twice its area: `area2`'s length.
    size: f64,
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
    let mut faces: Vec<Face> = Vec::with_capacity(prims.iter().map(|p| p.indices.len() / 3).sum());
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
            let size = len(area2);
            let area = size / 2.0;
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
            c.areas.push(area);
            faces.push(Face {
                v,
                p,
                n: prim.normals.as_ref().map(|n| i.map(|i| n[i])),
                area2,
                size,
            });
        }
        base += prim.positions.len();
    }
    // Each face's welded corners, apart from the rest of it for the passes that read only them.
    let corners: Vec<[u32; 3]> = faces.iter().map(|f| f.v).collect();
    let mut used = vec![false; nwelded];
    for v in &corners {
        for w in v {
            used[*w as usize] = true;
        }
    }
    c.unused = (0..nwelded)
        .filter(|w| !used[*w])
        .map(|w| c.first[w])
        .collect();
    c.unused.sort_unstable();
    c.vertices = welded;
    c.triangles = faces.len();
    islands(&corners, nwelded, &mut c);
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
    let edges = Edges::of(&corners, nwelded);
    for (e, fs) in edges.iter() {
        match fs.len() {
            1 => c.boundary_edges.push(e),
            2 if fs[0].1 == fs[1].1 => c.inconsistent_edges.push(e),
            2 => {}
            _ => c.non_manifold_edges.push(e),
        }
    }
    if !o.plants("vertex_fans_skipped") {
        c.non_manifold_vertices = fans(&corners, &edges, nwelded);
    }
    if c.boundary_edges.is_empty() && c.non_manifold_edges.is_empty() && !edges.ends.is_empty() {
        c.volume = Some(sum / 6.0);
    }
    pair(&faces, &edges, o, &mut c);
    c
}

/// The mesh's islands: faces that share a welded vertex are one, so a vertex no face uses is
/// none. The smallest is the one of least area, ties to its lowest face.
fn islands(corners: &[[u32; 3]], n: usize, c: &mut Counts) {
    let mut parent: Vec<usize> = (0..n).collect();
    fn root(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    for v in corners {
        for k in 1..3 {
            let (a, b) = (
                root(&mut parent, v[0] as usize),
                root(&mut parent, v[k] as usize),
            );
            parent[a.max(b)] = a.min(b);
        }
    }
    // Each island, numbered as its first face comes: its area, summed in face order, and its
    // first face; and each face's island.
    let mut number: Vec<Option<usize>> = vec![None; n];
    let mut found: Vec<(f64, usize)> = Vec::new();
    let mut of = Vec::with_capacity(corners.len());
    let mut total = 0.0;
    for (f, v) in corners.iter().enumerate() {
        let a = c.areas[f];
        total += a;
        let r = root(&mut parent, v[0] as usize);
        let island = *number[r].get_or_insert_with(|| {
            found.push((0.0, f));
            found.len() - 1
        });
        found[island].0 += a;
        of.push(island);
    }
    c.islands = found.len();
    if let Some((i, (a, _))) = found
        .iter()
        .enumerate()
        .min_by(|(_, x), (_, y)| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)))
    {
        c.smallest_share = if total > 0.0 { a / total } else { 0.0 };
        c.smallest_island = (0..corners.len()).filter(|f| of[*f] == i).collect();
    }
}

/// Each welded edge's faces, with whether each runs it from the lower vertex up: the edges in
/// ascending order, each one's faces in face order. A face whose corners weld together has no
/// edges.
struct Edges {
    /// Each edge, and where its faces end in `faces`: they start where the edge before's end.
    ends: Vec<(Edge, usize)>,
    faces: Vec<(usize, bool)>,
}

/// Whether a face's corners weld together.
fn collapsed(v: [u32; 3]) -> bool {
    v[0] == v[1] || v[1] == v[2] || v[0] == v[2]
}

impl Edges {
    /// The edges of faces with welded `corners`, on `n` welded vertices.
    fn of(corners: &[[u32; 3]], n: usize) -> Edges {
        let sides = |v: [u32; 3]| {
            let k = if collapsed(v) { 0 } else { 3 };
            (0..k).map(move |k| (v[k], v[(k + 1) % 3]))
        };
        // Each face's sides, bucketed by their lower vertex in face order.
        let mut start = vec![0usize; n + 1];
        for v in corners {
            for (a, b) in sides(*v) {
                start[a.min(b) as usize + 1] += 1;
            }
        }
        for w in 0..n {
            start[w + 1] += start[w];
        }
        let mut at = start.clone();
        let mut bucketed = vec![(0u32, 0usize, false); start[n]];
        for (f, v) in corners.iter().enumerate() {
            for (a, b) in sides(*v) {
                let lo = a.min(b) as usize;
                bucketed[at[lo]] = (a.max(b), f, a < b);
                at[lo] += 1;
            }
        }
        let mut out = Edges {
            ends: Vec::new(),
            faces: Vec::with_capacity(bucketed.len()),
        };
        for lo in 0..n {
            let bucket = &mut bucketed[start[lo]..start[lo + 1]];
            // Stable, so each edge's faces stay in face order.
            bucket.sort_by_key(|s| s.0);
            for (k, &(hi, f, up)) in bucket.iter().enumerate() {
                if k > 0 && bucket[k - 1].0 != hi {
                    out.ends
                        .push(([lo as u32, bucket[k - 1].0], out.faces.len()));
                }
                out.faces.push((f, up));
            }
            if let Some(last) = bucket.last() {
                out.ends.push(([lo as u32, last.0], out.faces.len()));
            }
        }
        out
    }

    fn iter(&self) -> impl Iterator<Item = (Edge, &[(usize, bool)])> {
        let mut start = 0;
        self.ends.iter().map(move |&(e, end)| {
            let fs = &self.faces[start..end];
            start = end;
            (e, fs)
        })
    }
}

/// The welded vertices whose faces make more than one fan: faces around a vertex join when they
/// share an edge from it with exactly two faces.
fn fans(corners: &[[u32; 3]], edges: &Edges, n: usize) -> Vec<u32> {
    // Each vertex's faces, in face order.
    let mut start = vec![0usize; n + 1];
    for v in corners.iter().filter(|v| !collapsed(**v)) {
        for w in v {
            start[*w as usize + 1] += 1;
        }
    }
    for w in 0..n {
        start[w + 1] += start[w];
    }
    let mut at = start.clone();
    let mut around = vec![0usize; start[n]];
    for (f, v) in corners.iter().enumerate().filter(|(_, v)| !collapsed(**v)) {
        for w in v {
            around[at[*w as usize]] = f;
            at[*w as usize] += 1;
        }
    }
    // Each face around a vertex starts a fan of its own, by its place in `around`.
    let mut group: Vec<usize> = (0..around.len()).collect();
    fn root(g: &mut [usize], mut i: usize) -> usize {
        while g[i] != i {
            i = g[i];
        }
        i
    }
    for (e, fs) in edges.iter() {
        if let [a, b] = fs[..] {
            for v in e.map(|v| v as usize) {
                let place = |f: usize| {
                    around[start[v]..start[v + 1]]
                        .iter()
                        .position(|x| *x == f)
                        .map(|i| start[v] + i)
                };
                if let (Some(a), Some(b)) = (place(a.0), place(b.0)) {
                    let (ra, rb) = (root(&mut group, a), root(&mut group, b));
                    group[ra.max(rb)] = ra.min(rb);
                }
            }
        }
    }
    let mut out = Vec::new();
    for v in 0..n {
        let mut fans = 0;
        for i in start[v]..start[v + 1] {
            if root(&mut group, i) == i {
                fans += 1;
            }
        }
        if fans > 1 {
            out.push(v as u32);
        }
    }
    out
}

/// Pairs triangles across shared edges into quads, best first by their worst corner, ties to the
/// lower triangle indices; each triangle joins one pair at most.
fn pair(faces: &[Face], edges: &Edges, o: &Opts, c: &mut Counts) {
    // Normals whose cosine is CLEAR above normal_max's are within it, with no arccosine; from 1°
    // to 179° that cosine is known far closer than CLEAR.
    let within = (1.0..=179.0)
        .contains(&o.normal_max)
        .then(|| cos(o.normal_max.to_radians()) + CLEAR);
    // Each candidate's worst corner as a key that orders as `total_cmp` does, and its faces.
    let mut candidates: Vec<(i64, usize, usize)> = Vec::with_capacity(edges.ends.len());
    for (e, fs) in edges.iter() {
        if fs.len() != 2 {
            continue;
        }
        let (f, g) = (fs[0].0.min(fs[1].0), fs[0].0.max(fs[1].0));
        let (a, b) = (faces[f].area2, faces[g].area2);
        let l = faces[f].size * faces[g].size;
        let close = within.is_some_and(|w| l != 0.0 && cosine(a, b, l) >= w);
        if !close && angle(a, b, l) > o.normal_max {
            continue;
        }
        let worst = if o.plants("pair_ignores_corners") {
            0.0
        } else if let Some(w) = quad(&faces[f], &faces[g], e) {
            w
        } else {
            continue;
        };
        if worst <= o.corner_max {
            let bits = worst.to_bits() as i64;
            candidates.push((bits ^ (((bits >> 63) as u64) >> 1) as i64, f, g));
        }
    }
    // Candidates that compare equal are equal, so an unstable sort orders them as a stable one.
    candidates.sort_unstable();
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
    let mut sign = 0.0;
    for k in 0..4 {
        let (prev, here, next) = (ring[(k + 3) % 4], ring[k], ring[(k + 1) % 4]);
        let turn = dot(cross(sub(here, prev), sub(next, here)), normal);
        if turn == 0.0 || (sign != 0.0 && turn.signum() != sign) {
            return None;
        }
        sign = turn.signum();
    }
    // Each side's length, from corner k to the next, and each corner's cosine as `angle` takes
    // it, none where a side has no length (the corner reads 180°).
    let side: [f64; 4] = std::array::from_fn(|k| len(sub(ring[(k + 1) % 4], ring[k])));
    let cosines: [Option<f64>; 4] = std::array::from_fn(|k| {
        let (prev, here, next) = (ring[(k + 3) % 4], ring[k], ring[(k + 1) % 4]);
        let l = side[(k + 3) % 4] * side[k];
        (l != 0.0).then(|| cosine(sub(prev, here), sub(next, here), l))
    });
    // A corner's distance from a right angle grows with its cosine's size, so only corners whose
    // cosine is within CLEAR of the largest can be the worst.
    let top = cosines
        .iter()
        .flatten()
        .fold(0.0, |m: f64, x| m.max(x.abs()));
    let mut worst: f64 = 0.0;
    for x in cosines {
        let angle = match x {
            None => 180.0,
            Some(x) if x.abs() >= top - CLEAR => deg(acos(x)),
            Some(_) => continue,
        };
        worst = worst.max((angle - 90.0).abs());
    }
    Some(worst)
}
