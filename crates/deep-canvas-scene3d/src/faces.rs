//! Modifier: `offset_faces` and `dissolve` (canvas primitives: Modifier; issue #1928), on the
//! polygon view.
//!
//! An offset gives each picked face, on its own, an inner face whose edges are its edges moved
//! `by` into the face: a corner goes to where its two moved edges meet, so one over 180° moves
//! into the face as one under 180° does. One ring face joins each edge to its moved copy, and
//! `depth` then moves the inner face along the face's normal. A new corner takes its uv from the
//! face's own uv map at its place before `depth` moves it, and its point's attributes from the
//! corner it moved from. A face of n corners adds n points, 2n edges and n faces.
//!
//! A dissolve merges two faces across an edge they share where they are of one class (one part
//! and equal face attributes), have equal uv on both sides of it and meet at under the angle.
//! Each connected set of such faces merges whole or not at all: one whose union isn't one simple
//! loop stays as it was and is reported. A point then left on two edges that turn by under the
//! angle is removed.
//!
//! Every point an offset makes comes from one corner and the two edges at it, its face's normal
//! is summed in a sorted order, its uv map is fitted at the corners that sort first and its new
//! points are numbered from the corner that sorts first, so nothing either leaves depends on
//! where a face's corner list starts.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas::ops::{atan2, deg};
use serde_json::{json, Value};

use crate::bevel::UvMap;
use crate::builders::{coded, CODED};
use crate::geom::{add, cross, dot, length, scale, sub, unit, Mesh, V2, V3};
use crate::poly::{blocked, Halves, Poly};
use crate::stack::{enabled, keep_annotations, number, Run};

const NONE: u32 = u32::MAX;

/// The angle between two vectors, in degrees.
fn turn(a: V3, b: V3) -> f64 {
    deg(atan2(length(cross(a, b)), dot(a, b)))
}

/// The wrong programs #1928's criteria plant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// An offset moves each corner `by` along its bisector, not to where its moved edges meet.
    pub bisector: bool,
    /// An offset moves each corner `by` times the sum of its two edges' unit directions, each
    /// away from the corner, so a corner over 180° leaves the face.
    pub along_edges: bool,
    /// An offset moves every inner face along the item's +y, not along its face's normal.
    pub along_y: bool,
    /// An offset numbers its new points from each face's first corner, while their places and
    /// uv stay in the order that starts at the corner that sorts first.
    pub first_corner: bool,
    /// A dissolve keeps the points between two straight edges.
    pub keeps_straight: bool,
    /// A dissolve merges two faces at a time, in index order, where the pair's union is a loop.
    pub pairwise: bool,
}

/// An offset's params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Offset {
    pub by: f64,
    pub depth: f64,
    pub plants: Plants,
}

/// What an offset made of a face.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// A face it left alone, corner for corner.
    Kept,
    Ring,
    Inner,
}

/// What an offset leaves: the polygon view, and for each of its faces what it is and the face of
/// the view the offset took that it came from.
pub struct Offsetted {
    pub poly: Poly,
    pub role: Vec<Role>,
    pub from: Vec<u32>,
}

/// A face's outline as an offset reads it: its unit normal, and at each corner its point, the
/// unit direction and length of the edge to the next corner, that edge's unit normal into the
/// face, and how far the corner moves per metre of offset.
struct Outline {
    normal: V3,
    at: Vec<V3>,
    dir: Vec<V3>,
    len: Vec<f64>,
    side: Vec<V3>,
    rate: Vec<V3>,
}

impl Outline {
    /// None for a face of no area, with an edge of no length or with two edges that fold back
    /// on each other: it has no inner outline.
    fn of(p: &Poly, f: usize, plants: Plants) -> Option<Outline> {
        let c = &p.faces[f];
        let n = c.len();
        let raw = p.normal(f);
        if n < 3 || length(raw) < 1e-18 {
            return None;
        }
        let normal = unit(raw);
        let at: Vec<V3> = c.iter().map(|&i| p.points[i as usize]).collect();
        let (mut dir, mut len) = (Vec::with_capacity(n), Vec::with_capacity(n));
        for k in 0..n {
            let e = sub(at[(k + 1) % n], at[k]);
            let l = length(e);
            if l < 1e-12 {
                return None;
            }
            len.push(l);
            dir.push(scale(e, 1.0 / l));
        }
        let side: Vec<V3> = dir.iter().map(|d| cross(normal, *d)).collect();
        let mut rate = Vec::with_capacity(n);
        for k in 0..n {
            let j = (k + n - 1) % n;
            let (a, b) = (side[j], side[k]);
            rate.push(if plants.bisector {
                unit(add(a, b))
            } else if plants.along_edges {
                sub(dir[k], dir[j])
            } else {
                // Where the two moved edges meet: 1 m into the face from each.
                let meet = 1.0 + dot(a, b);
                if meet < 1e-9 {
                    return None;
                }
                scale(add(a, b), 1.0 / meet)
            });
        }
        Some(Outline {
            normal,
            at,
            dir,
            len,
            side,
            rate,
        })
    }

    /// The largest offset that leaves every inner edge longer than 0 m and the inner outline
    /// simple: the first at which an inner edge's length falls to 0, or a corner reaches an
    /// inner edge that isn't one of its own two.
    fn widest(&self) -> f64 {
        let n = self.at.len();
        // How fast each inner edge's length changes, per metre of offset.
        let grows: Vec<f64> = (0..n)
            .map(|k| dot(sub(self.rate[(k + 1) % n], self.rate[k]), self.dir[k]))
            .collect();
        let mut best = f64::INFINITY;
        for (len, grow) in self.len.iter().zip(&grows) {
            if *grow < 0.0 {
                best = best.min(len / -grow);
            }
        }
        for (j, grow) in grows.iter().enumerate() {
            for c in (0..n).filter(|&c| c != j && c != (j + 1) % n) {
                // The corner's distance into the face from the moved edge, and how fast it closes.
                let gap = dot(sub(self.at[c], self.at[j]), self.side[j]);
                let closes = 1.0 - dot(self.rate[c], self.side[j]);
                let d = gap / closes;
                if closes.abs() < 1e-12 || d <= 0.0 || d >= best {
                    continue;
                }
                let l = self.len[j] + d * grow;
                let from = add(self.at[j], scale(self.rate[j], d));
                let along = dot(
                    sub(add(self.at[c], scale(self.rate[c], d)), from),
                    self.dir[j],
                );
                if l > 0.0 && along >= -1e-9 * l && along <= l * (1.0 + 1e-9) {
                    best = d;
                }
            }
        }
        best
    }
}

/// The first picked face an offset of `by` is too wide for, with the largest offset that face
/// takes: `by` at or past it has no inner outline.
pub fn too_wide(p: &Poly, picked: &[bool], by: f64) -> Option<(usize, f64)> {
    (0..p.faces.len()).filter(|&f| picked[f]).find_map(|f| {
        let max = Outline::of(p, f, Plants::default()).map_or(0.0, |outline| outline.widest());
        (by >= max * (1.0 - 1e-9)).then_some((f, max))
    })
}

/// The corner whose point sorts first by (x, y, z): where the numbering of a face's new points
/// starts.
fn lowest(at: &[V3]) -> usize {
    let order = |a: &usize, b: &usize| {
        (0..3)
            .map(|k| at[*a][k].total_cmp(&at[*b][k]))
            .find(|o| o.is_ne())
            .unwrap_or(Ordering::Equal)
    };
    (0..at.len()).min_by(order).unwrap_or(0)
}

/// Modifier: offset_faces on the faces `picked`, each face's inset made alone in one of `blocks`
/// ranges; a picked face with no inner outline is left alone.
pub fn offset(p: &Poly, picked: &[bool], o: &Offset, blocks: usize) -> Offsetted {
    // Each picked face's normal and its corners moved `by`, before `depth`.
    let made: Vec<Option<(V3, Vec<V3>)>> = blocked(p.faces.len(), blocks, |f| {
        let outline = picked[f].then(|| Outline::of(p, f, o.plants)).flatten()?;
        let moved = (outline.at.iter().zip(&outline.rate))
            .map(|(q, r)| add(*q, scale(*r, o.by)))
            .collect();
        Some((outline.normal, moved))
    });
    let faces = p.faces.len() + made.iter().flatten().map(|m| m.1.len()).sum::<usize>();
    let mut out = Poly {
        points: p.points.clone(),
        attrs: p.attrs.clone(),
        faces: Vec::with_capacity(faces),
        origin: Vec::with_capacity(faces),
        uv: p.uv.as_ref().map(|_| Vec::with_capacity(faces)),
        ..Poly::default()
    };
    let (mut role, mut from) = (Vec::with_capacity(faces), Vec::with_capacity(faces));
    for (f, c) in p.faces.iter().enumerate() {
        let n = c.len();
        let uv = p.uv.as_ref().map(|uv| &uv[f]);
        let mut face = |out: &mut Poly, corners: Vec<u32>, uv: Option<Vec<V2>>, r: Role| {
            out.faces.push(corners);
            out.origin.push(p.origin[f]);
            if let (Some(all), Some(uv)) = (&mut out.uv, uv) {
                all.push(uv);
            }
            if !p.weak.is_empty() {
                out.weak.push(p.weak[f]);
            }
            role.push(r);
            from.push(f as u32);
        };
        let Some((normal, moved)) = &made[f] else {
            face(&mut out, c.clone(), uv.cloned(), Role::Kept);
            continue;
        };
        let along = if o.plants.along_y {
            [0.0, 1.0, 0.0]
        } else {
            *normal
        };
        let lift = scale(along, o.depth);
        let corners: Vec<V3> = c.iter().map(|&i| p.points[i as usize]).collect();
        let first = lowest(&corners);
        let base = out.points.len();
        for j in 0..n {
            let k = (first + j) % n;
            out.points.push(add(moved[k], lift));
            for (name, values) in &mut out.attrs {
                values.push(p.attrs[name][c[k] as usize]);
            }
        }
        let id = |k: usize| {
            let j = if o.plants.first_corner {
                k
            } else {
                (k + n - first) % n
            };
            (base + j) as u32
        };
        let map = UvMap::of(p, f);
        let uv_at = |k: usize| map.as_ref().map_or([0.0; 2], |m| m.at(moved[k]));
        for k in 0..n {
            let j = (k + 1) % n;
            let ring = uv.map(|t| vec![t[k], t[j], uv_at(j), uv_at(k)]);
            face(&mut out, vec![c[k], c[j], id(j), id(k)], ring, Role::Ring);
        }
        let inner = uv.map(|_| (0..n).map(uv_at).collect());
        face(&mut out, (0..n).map(id).collect(), inner, Role::Inner);
    }
    Offsetted {
        poly: out,
        role,
        from,
    }
}

/// What a dissolve leaves: the polygon view, each corner still naming its vertex in the mesh the
/// view was made from, and the sets it left as they were, each by its faces in that view.
pub struct Dissolved {
    pub poly: Poly,
    pub held: Vec<Vec<u32>>,
}

/// The one simple loop round the union of the faces `members`, as the corners whose half-edges
/// bound it, in turn (`inner` passes a corner whose edge lies inside the union): none where the
/// union has a hole, meets itself at a point or has no boundary. `start` is scratch, one `NONE`
/// per point, left as it was.
fn outline(
    h: &Halves,
    members: &[u32],
    inner: impl Fn(usize) -> bool,
    start: &mut [u32],
) -> Option<Vec<u32>> {
    let bound: Vec<u32> = members
        .iter()
        .flat_map(|&f| h.start[f as usize]..h.start[f as usize + 1])
        .filter(|&c| !inner(c as usize))
        .collect();
    // In a simple loop each point starts one boundary half-edge.
    let mut simple = bound.len() >= 3;
    for &c in &bound {
        let s = &mut start[h.from[c as usize] as usize];
        simple &= *s == NONE;
        *s = c;
    }
    let mut ring = Vec::with_capacity(bound.len());
    let mut c = bound.first().copied().unwrap_or(NONE);
    while simple && c != NONE && ring.len() < bound.len() {
        ring.push(c);
        c = start[h.to[c as usize] as usize];
        if Some(&c) == bound.first() {
            break;
        }
    }
    simple &= ring.len() == bound.len() && Some(&c) == bound.first();
    for &c in &bound {
        start[h.from[c as usize] as usize] = NONE;
    }
    simple.then_some(ring)
}

/// Modifier: dissolve: faces merged across the edges two faces of one `class` share with equal
/// uv on both sides, where they meet at under `angle` degrees.
pub fn dissolve(p: &Poly, angle: f64, class: &[u32], plants: Plants) -> Dissolved {
    let h = Halves::of(p);
    let (faces, corners) = (p.faces.len(), h.from.len());
    let normal: Vec<V3> = (0..faces).map(|f| p.normal(f)).collect();
    let face = |c: usize| h.face[c] as usize;
    let place = |c: usize| c - h.start[face(c)] as usize;
    let uv_at = |c: usize| p.uv.as_ref().map(|uv| uv[face(c)][place(c)]);
    let same = |a: Option<V2>, b: Option<V2>| match (a, b) {
        (Some(a), Some(b)) => (a[0] - b[0]).abs() <= 1e-9 && (a[1] - b[1]).abs() <= 1e-9,
        _ => true,
    };
    // Each corner's twin across its edge, where its face merges with the twin's there.
    let mut across = vec![NONE; corners];
    for e in 0..h.ends.len() {
        let &[x, y] = h.on(e) else { continue };
        let (x, y) = (x as usize, y as usize);
        let (f, g) = (face(x), face(y));
        if f != g
            && h.from[x] == h.to[y]
            && class[f] == class[g]
            && same(uv_at(x), uv_at(h.next(y)))
            && same(uv_at(h.next(x)), uv_at(y))
            && turn(normal[f], normal[g]) < angle
        {
            (across[x], across[y]) = (y as u32, x as u32);
        }
    }
    // The connected sets, each named by its lowest face.
    fn find(set: &mut [u32], mut x: u32) -> u32 {
        while set[x as usize] != x {
            set[x as usize] = set[set[x as usize] as usize];
            x = set[x as usize];
        }
        x
    }
    let mut set: Vec<u32> = (0..faces as u32).collect();
    let mut start = vec![NONE; p.points.len()];
    for x in (0..corners).filter(|&x| across[x] != NONE && (x as u32) < across[x]) {
        let (a, b) = (
            find(&mut set, h.face[x]),
            find(&mut set, h.face[across[x] as usize]),
        );
        if a == b {
            continue;
        }
        if plants.pairwise {
            let roots: Vec<u32> = (0..faces as u32).map(|f| find(&mut set, f)).collect();
            let both = |f: usize| roots[f] == a || roots[f] == b;
            let members: Vec<u32> = (0..faces as u32).filter(|&f| both(f as usize)).collect();
            let inner = |c: usize| across[c] != NONE && both(face(across[c] as usize));
            if outline(&h, &members, inner, &mut start).is_none() {
                continue;
            }
        }
        set[a.max(b) as usize] = a.min(b);
    }
    let root: Vec<usize> = (0..faces as u32)
        .map(|f| find(&mut set, f) as usize)
        .collect();
    let mut members: Vec<Vec<u32>> = vec![Vec::new(); faces];
    for f in 0..faces {
        members[root[f]].push(f as u32);
    }
    let inner = |c: usize| across[c] != NONE && root[face(c)] == root[face(across[c] as usize)];
    // Each face the dissolve leaves, as the corners it keeps of the view it took, with the face
    // its part, attributes and origin come from: a merged set stands where its lowest face
    // stood, and a set left as it was keeps its faces in their places.
    let (mut rings, mut source, mut held): (Vec<Vec<u32>>, Vec<usize>, Vec<Vec<u32>>) =
        (Vec::new(), Vec::new(), Vec::new());
    let (mut merged, mut held_at) = (vec![false; faces], vec![NONE; faces]);
    for (f, &r) in root.iter().enumerate() {
        if members[r].len() > 1 && r == f {
            match outline(&h, &members[r], inner, &mut start) {
                Some(ring) => {
                    merged[r] = true;
                    rings.push(ring);
                    source.push(f);
                }
                None => {
                    held_at[r] = held.len() as u32;
                    held.push(Vec::new());
                }
            }
        }
        if merged[r] {
            continue;
        }
        if held_at[r] != NONE {
            held[held_at[r] as usize].push(rings.len() as u32);
        }
        rings.push((h.start[f]..h.start[f + 1]).collect());
        source.push(f);
    }
    // The two points each point's edges run to, and whether it has more.
    let points = p.points.len();
    let (mut ends, mut more) = (vec![[NONE; 2]; points], vec![false; points]);
    let mut edge = |v: u32, w: u32| {
        let e = &mut ends[v as usize];
        if e[0] == NONE || e[0] == w {
            e[0] = w;
        } else if e[1] == NONE || e[1] == w {
            e[1] = w;
        } else {
            more[v as usize] = true;
        }
    };
    for ring in &rings {
        for k in 0..ring.len() {
            let (a, b) = (
                h.from[ring[k] as usize],
                h.from[ring[(k + 1) % ring.len()] as usize],
            );
            edge(a, b);
            edge(b, a);
        }
    }
    // A point stays unless its two edges turn by under the angle; and a face that would keep
    // fewer than three corners keeps all of its own.
    let mut keep: Vec<bool> = (0..points)
        .map(|v| {
            let [a, b] = ends[v];
            if plants.keeps_straight || more[v] || b == NONE {
                return true;
            }
            let (a, b, at) = (p.points[a as usize], p.points[b as usize], p.points[v]);
            turn(sub(at, a), sub(b, at)) >= angle
        })
        .collect();
    let kept = |keep: &[bool], c: u32| keep[h.from[c as usize] as usize];
    for ring in &rings {
        if ring.iter().filter(|&&c| kept(&keep, c)).count() < 3 {
            for &c in ring {
                keep[h.from[c as usize] as usize] = true;
            }
        }
    }
    // The points still on a face, numbered in their order.
    let mut id = vec![NONE; points];
    for ring in &rings {
        for &c in ring.iter().filter(|&&c| kept(&keep, c)) {
            id[h.from[c as usize] as usize] = 0;
        }
    }
    for (count, v) in id.iter_mut().filter(|v| **v != NONE).enumerate() {
        *v = count as u32;
    }
    let left = |values: &[f64]| -> Vec<f64> {
        (0..points)
            .filter(|&v| id[v] != NONE)
            .map(|v| values[v])
            .collect()
    };
    let carried = p.vertex.len() == faces;
    let mut out = Poly {
        points: (0..points)
            .filter(|&v| id[v] != NONE)
            .map(|v| p.points[v])
            .collect(),
        attrs: (p.attrs.iter())
            .map(|(name, values)| (name.clone(), left(values)))
            .collect(),
        faces: Vec::with_capacity(rings.len()),
        origin: Vec::with_capacity(rings.len()),
        uv: p.uv.as_ref().map(|_| Vec::with_capacity(rings.len())),
        ..Poly::default()
    };
    for (ring, &src) in rings.iter().zip(&source) {
        let ring: Vec<usize> = (ring.iter().filter(|&&c| kept(&keep, c)))
            .map(|&c| c as usize)
            .collect();
        out.faces
            .push(ring.iter().map(|&c| id[h.from[c] as usize]).collect());
        out.origin.push(p.origin[src]);
        if let (Some(all), Some(uv)) = (&mut out.uv, &p.uv) {
            all.push(ring.iter().map(|&c| uv[face(c)][place(c)]).collect());
        }
        if !p.weak.is_empty() {
            out.weak.push(p.weak[src]);
        }
        if carried {
            out.vertex
                .push(ring.iter().map(|&c| p.vertex[face(c)][place(c)]).collect());
        }
    }
    Dissolved { poly: out, held }
}

// ---- the stack's steps

/// What an offset as wide as a face is refused with: `{item, face, by, max}`.
pub const TOO_WIDE: &str = "offset_faces.too_wide";
/// The output a dissolve leaves the sets it couldn't merge in, each by its faces, and the
/// warning that names them: `{item, faces}`.
pub const HOLE: &str = "dissolve.hole";

/// #1928's planted wrong programs, by the names a proof surface's `planted` takes.
pub const BISECTOR: &str = "offset_along_bisector";
pub const ALONG_Y: &str = "offset_depth_along_y";
pub const ALONG_EDGES: &str = "offset_corner_along_edges";
/// The check lets an offset at or past a face's largest through, and it is built.
pub const UNCHECKED: &str = "offset_too_wide_unchecked";
pub const FIRST_CORNER: &str = "offset_first_corner";
/// An offset drops the face attributes of the faces it makes.
pub const DROPS_WEAR: &str = "offset_drops_wear";
/// An offset with `inner` leaves its inner faces outside every part.
pub const UNPARTED: &str = "offset_inner_unparted";
pub const KEEPS_STRAIGHT: &str = "dissolve_keeps_straight_points";
pub const PAIRS: &str = "dissolve_merges_pairs";
pub const PLANTED: [&str; 9] = [
    BISECTOR,
    ALONG_Y,
    ALONG_EDGES,
    UNCHECKED,
    FIRST_CORNER,
    DROPS_WEAR,
    UNPARTED,
    KEEPS_STRAIGHT,
    PAIRS,
];

fn plants(run: &Run) -> Plants {
    let on = |name: &str| run.planted.as_deref() == Some(name);
    Plants {
        bisector: on(BISECTOR),
        along_y: on(ALONG_Y),
        along_edges: on(ALONG_EDGES),
        first_corner: on(FIRST_CORNER),
        keeps_straight: on(KEEPS_STRAIGHT),
        pairwise: on(PAIRS),
    }
}

/// The faces of `poly` an offset's `parts` name: every face when it names none.
fn picked(m: &Mesh, poly: &Poly, p: &Value) -> Result<Vec<bool>, String> {
    let names: Vec<&str> = match p.get("parts") {
        None => Vec::new(),
        Some(v) => v
            .as_array()
            .and_then(|a| a.iter().map(Value::as_str).collect())
            .ok_or("params/parts")?,
    };
    if names.is_empty() {
        return Ok(vec![true; poly.faces.len()]);
    }
    let mut named = vec![false; m.triangles()];
    for name in names {
        let part = m
            .parts
            .get(name)
            .or_else(|| m.closed.get(name).map(|c| &c.0));
        for &t in part.ok_or("params/parts")? {
            named[t as usize] = true;
        }
    }
    Ok(poly.origin.iter().map(|&o| named[o as usize]).collect())
}

/// What an offset adds to the welded points, edges, faces and corners of the mesh it takes,
/// from its params: a face of n corners adds n points, 2n edges, n faces and 4n corners.
pub(crate) fn counts(m: &Mesh, p: &Value) -> Result<(u64, u64, u64, u64), String> {
    let poly = Poly::of(m);
    let picked = picked(m, &poly, p)?;
    let n: u64 = (poly.faces.iter().zip(&picked))
        .filter(|(_, on)| **on)
        .map(|(c, _)| c.len() as u64)
        .sum();
    Ok((
        poly.points.len() as u64 + n,
        poly.edges().len() as u64 + 2 * n,
        poly.faces.len() as u64 + n,
        poly.corners() as u64 + 4 * n,
    ))
}

/// Modifier: offset_faces. A face it makes is flat-shaded; one it leaves alone keeps its
/// corners' normals. An offset at or past a face's largest is refused with [`TOO_WIDE`], its
/// path `params/by` and what it found after it.
pub(crate) fn offset_faces(m: Mesh, p: &Value, run: &Run) -> Result<Mesh, String> {
    let by = (p.get("by").and_then(Value::as_f64))
        .filter(|by| by.is_finite() && *by > 0.0)
        .ok_or("params/by")?;
    let o = Offset {
        by,
        depth: number(p, "depth", 0.0, |_| true)?,
        plants: plants(run),
    };
    let inner = match p.get("inner") {
        None => None,
        Some(v) => Some(v.as_str().filter(|s| !s.is_empty()).ok_or("params/inner")?),
    };
    let planted = |name: &str| run.planted.as_deref() == Some(name);
    let poly = Poly::of(&m);
    let picked = picked(&m, &poly, p)?;
    if let Some((f, max)) = too_wide(&poly, &picked, by).filter(|_| !planted(UNCHECKED)) {
        let found = json!({"face": m.faces[poly.origin[f] as usize], "by": by, "max": max});
        return Err(coded(TOO_WIDE, &format!("params/by{CODED}{found}")));
    }
    let made = offset(&poly, &picked, &o, run.blocks());
    let normals: Vec<Vec<V3>> = (made.poly.faces.iter().enumerate())
        .map(|(g, c)| match made.role[g] {
            Role::Kept => (poly.vertex[made.from[g] as usize].iter())
                .map(|&v| m.normals[v as usize])
                .collect(),
            _ => vec![unit(made.poly.normal(g)); c.len()],
        })
        .collect();
    let mut out = made.poly.mesh(&m, Some(&normals));
    keep_annotations(&m, &mut out);
    if planted(UNCHECKED) {
        whole(&mut out, &m, &made.poly);
    }
    let role: Vec<Role> = out.faces.iter().map(|&f| made.role[f as usize]).collect();
    // The inner faces take `inner` in place of their source face's parts.
    if inner.is_some() || planted(UNPARTED) {
        for tris in out.parts.values_mut() {
            tris.retain(|&t| role[t as usize] != Role::Inner);
        }
        out.parts.retain(|_, tris| !tris.is_empty());
    }
    if let Some(name) = inner.filter(|_| !planted(UNPARTED)) {
        let tris = out.parts.entry(name.to_string()).or_default();
        tris.extend((0..role.len() as u32).filter(|&t| role[t as usize] == Role::Inner));
        tris.sort_unstable();
    }
    if planted(DROPS_WEAR) {
        for values in out.face_attributes.values_mut() {
            for (t, v) in values.iter_mut().enumerate() {
                if role[t] != Role::Kept {
                    *v = f64::NAN;
                }
            }
        }
    }
    Ok(out)
}

/// Planted ([`UNCHECKED`]): a too-wide offset's faces of three or four corners keep the triangles
/// `Mesh::tri` left out for want of area, each with its face's parts and attributes in `src`, so
/// a face whose corners coincide shows its zero-length edges.
fn whole(out: &mut Mesh, src: &Mesh, poly: &Poly) {
    let mut have = vec![0; poly.faces.len()];
    for &f in &out.faces {
        have[f as usize] += 1;
    }
    let mut base = 0;
    for (g, c) in poly.faces.iter().enumerate() {
        let n = c.len() as u32;
        for k in (1..n - 1).filter(|_| n <= 4 && have[g] + 2 < n) {
            let (tri, t) = ([base, base + k, base + k + 1], out.triangles() as u32);
            if (0..t as usize).any(|x| out.faces[x] == g as u32 && out.indices[3 * x..][..3] == tri)
            {
                continue;
            }
            let origin = poly.origin[g];
            out.indices.extend(tri);
            out.faces.push(g as u32);
            if !out.weak.is_empty() {
                out.weak.push(false);
            }
            for (name, values) in &mut out.face_attributes {
                values.push(src.face_attributes[name][origin as usize]);
            }
            for (name, _) in src.parts.iter().filter(|p| p.1.contains(&origin)) {
                out.parts.entry(name.clone()).or_default().push(t);
            }
            for (name, (_, genus)) in src.closed.iter().filter(|p| p.1 .0.contains(&origin)) {
                let closed = out.closed.entry(name.clone());
                closed.or_insert((Vec::new(), *genus)).0.push(t);
            }
        }
        base += n;
    }
}

/// Each face's class: faces of one class are in the same parts and have equal face attributes.
fn classes(m: &Mesh, poly: &Poly) -> Vec<u32> {
    let mut parts: Vec<Vec<u32>> = vec![Vec::new(); m.triangles()];
    for (k, tris) in m.parts.values().enumerate() {
        for &t in tris {
            parts[t as usize].push(k as u32);
        }
    }
    let mut ids: BTreeMap<(Vec<u32>, Vec<u64>), u32> = BTreeMap::new();
    (poly.origin.iter())
        .map(|&o| {
            // +0.0, so a 0 of either sign is one value.
            let attrs = (m.face_attributes.values())
                .map(|v| (v[o as usize] + 0.0).to_bits())
                .collect();
            let next = ids.len() as u32;
            *ids.entry((parts[o as usize].clone(), attrs))
                .or_insert(next)
        })
        .collect()
}

/// Modifier: dissolve. Every corner it keeps keeps its normal; the sets it leaves as they were
/// are the output [`HOLE`], each by its faces.
pub(crate) fn dissolved(m: Mesh, p: &Value, run: &Run) -> Result<Mesh, String> {
    let angle = number(p, "angle", 1.0, |a| (0.0..=180.0).contains(&a))?;
    let poly = Poly::of(&m);
    let done = dissolve(&poly, angle, &classes(&m, &poly), plants(run));
    let normals: Vec<Vec<V3>> = (done.poly.vertex.iter())
        .map(|c| c.iter().map(|&v| m.normals[v as usize]).collect())
        .collect();
    let mut out = done.poly.mesh(&m, Some(&normals));
    keep_annotations(&m, &mut out);
    out.outputs.remove(HOLE);
    if !done.held.is_empty() {
        out.outputs.insert(HOLE.into(), json!(done.held));
    }
    Ok(out)
}

/// At check: what the offsets and dissolves in `doc`'s builders' stacks raise, each read from
/// its item's mesh and stack at the start, made through the build's outline sources and module
/// deforms with no build node run: an offset at or past a face's largest, refused with
/// [`TOO_WIDE`] `{item, face, by, max}`, and for each set a dissolve left as it was the warning
/// [`HOLE`] `{item, faces}`. Any other fault is the build's to report.
pub fn raised(
    doc: &Value,
    outlines: &[deep_canvas::registry::SealedOutline],
    fills: &[deep_canvas::contributed::Sealed],
    planted: Option<&str>,
) -> Vec<Issue> {
    let kind = |v: &Value| {
        v.get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    // A builder's enabled steps of one kind, by their places in its stack.
    let steps = |item: &Value, name: &str| -> Vec<usize> {
        let list = item.get("modifiers").and_then(Value::as_array);
        let at = list.into_iter().flatten().enumerate();
        at.filter(|(_, m)| enabled(m) && kind(m) == name)
            .filter(|_| crate::builders::KINDS.contains(&kind(item).as_str()))
            .map(|(k, _)| k)
            .collect()
    };
    let reads = |item: &Value| {
        !steps(item, "mod.dissolve@1").is_empty() || !steps(item, "mod.offset_faces@1").is_empty()
    };
    let items = |doc: &Value| -> Vec<(String, Value)> {
        let all = doc.get("items").and_then(Value::as_object);
        let read = all.into_iter().flatten().filter(|(_, item)| reads(item));
        read.map(|(id, item)| (id.clone(), item.clone())).collect()
    };
    // A document with neither step is read no further.
    if items(doc).is_empty() {
        return Vec::new();
    }
    let lowered = crate::vars::at(doc, 0, planted).ok().flatten();
    let doc = lowered.as_ref().unwrap_or(doc);
    let run = Run {
        planted: planted.map(str::to_string),
        outlines: outlines.to_vec(),
        fills: fills.to_vec(),
        ..Run::default()
    };
    let mut out = Vec::new();
    for (id, item) in &items(doc) {
        let ctx = crate::builders::Ctx {
            doc,
            id,
            plants: planted
                .and_then(crate::builders::Plants::named)
                .unwrap_or_default(),
            outlines,
            planted,
            pool: None,
        };
        let params = item.get("params").cloned().unwrap_or(json!({}));
        let made = crate::builders::build(&kind(item), &params, &ctx)
            .and_then(|mesh| crate::stack::apply(mesh, item, doc, id, 0.0, &run));
        match made {
            Err(fault) => {
                let e = crate::build::fault(id, fault);
                if let (TOO_WIDE, Some(found)) = (e.code, e.actual) {
                    let what = "the offset is as wide as this face, so it leaves no inner face";
                    let mut issue = Issue::error(TOO_WIDE, id, e.path, *found, what);
                    issue.fix = "Give `by` a value under `max`, or leave the face out.".into();
                    out.push(issue);
                }
            }
            Ok((mesh, _)) => {
                let held = mesh.outputs.get(HOLE).and_then(Value::as_array);
                for faces in held.into_iter().flatten() {
                    let step = steps(item, "mod.dissolve@1").last().copied().unwrap_or(0);
                    let path = format!("items/{id}/modifiers/{step}");
                    let what = "these faces would merge into a face with a hole, so they stay";
                    let found = json!({"item": id, "faces": faces});
                    let mut issue = Issue::error(HOLE, id, path, found, what);
                    issue.severity = "warning";
                    issue.fix = "Leave them, or give the face they surround their part.".into();
                    out.push(issue);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builders::{self, Ctx};
    use crate::stack::{apply, estimate, prefix, welded};

    fn built(kind: &str, params: Value) -> Mesh {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            id: "it",
            doc: &doc,
            plants: Default::default(),
            outlines: &[],
            planted: None,
            pool: None,
        };
        builders::build(kind, &params, &ctx).unwrap()
    }

    fn run(m: &Mesh, modifiers: Value, planted: Option<&str>) -> Result<Mesh, String> {
        let run = Run {
            planted: planted.map(str::to_string),
            ..Run::default()
        };
        let item = json!({"modifiers": modifiers});
        apply(m.clone(), &item, &json!({"items": {}}), "it", 0.0, &run).map(|r| r.0)
    }

    fn declared(m: &Mesh, modifiers: Value) -> [u64; 3] {
        let item = json!({"modifiers": modifiers});
        let before = |k: usize| run(m, prefix(&item, k)["modifiers"].clone(), None);
        let counts = (m.positions.len() as u64, m.triangles() as u64);
        estimate(counts, &item, &before).unwrap().welded.unwrap()
    }

    /// A flat face on the outline `xy`, as a polygon view.
    fn flat(xy: &[[f64; 2]]) -> Poly {
        Poly {
            points: xy.iter().map(|q| [q[0], 0.0, -q[1]]).collect(),
            faces: vec![(0..xy.len() as u32).collect()],
            origin: vec![0],
            ..Poly::default()
        }
    }

    fn cube() -> Mesh {
        built("slab@1", json!({"size": [1, 1, 1], "uv0": "box"}))
    }

    const OFFSET: &str = "mod.offset_faces@1";
    const DISSOLVE: &str = "mod.dissolve@1";

    #[test]
    fn an_offset_with_no_parts_takes_every_face_and_declares_what_it_builds() {
        // Six faces of four corners: 24 points, 48 edges and 24 faces more.
        let every = json!([{"kind": OFFSET, "params": {"by": 0.1, "depth": 0.1}}]);
        let m = run(&cube(), every.clone(), None).unwrap();
        assert_eq!(welded(&m), [32, 60, 30]);
        assert_eq!(declared(&cube(), every), [32, 60, 30]);
        // A part the mesh doesn't have is refused, not skipped.
        let lid = json!([{"kind": OFFSET, "params": {"parts": ["lid"], "by": 0.1}}]);
        assert_eq!(
            run(&cube(), lid, None).unwrap_err(),
            "modifiers/0/params/parts"
        );
    }

    #[test]
    fn a_dissolve_keeps_other_wear_apart_and_a_step_after_it_counts_anew() {
        // A 3 × 3 plate whose faces keep their x as `wear`: three strips of one wear each.
        let plate = built("plate@1", json!({"grid": [3, 3], "size": [3, 3]}));
        let wear = json!({"kind": "mod.store@1", "params": {"name": "wear", "domain": "face", "field": "x"}});
        let strips = json!([wear, {"kind": DISSOLVE}]);
        assert_eq!(welded(&run(&plate, strips, None).unwrap()), [8, 10, 3]);
        // The dissolve declares its input's counts; the subdivision after it its own, exactly.
        let merged = json!([{"kind": DISSOLVE}]);
        assert_eq!(declared(&plate, merged.clone()), [16, 24, 9]);
        let split = json!([{"kind": DISSOLVE}, {"kind": "mod.subdivide@1", "params": {"scheme": "simple"}}]);
        assert_eq!(welded(&run(&plate, merged, None).unwrap()), [4, 4, 1]);
        assert_eq!(declared(&plate, split.clone()), [9, 12, 4]);
        assert_eq!(welded(&run(&plate, split, None).unwrap()), [9, 12, 4]);
    }

    #[test]
    fn the_widest_offset_is_where_an_edge_ends_or_two_edges_meet() {
        let widest = |xy: &[[f64; 2]]| {
            Outline::of(&flat(xy), 0, Plants::default())
                .unwrap()
                .widest()
        };
        // A square's inner edges end together, at half its side.
        assert_eq!(
            widest(&[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]),
            0.5
        );
        // Two rooms joined by a passage 0.2 m wide: its walls meet before any edge ends.
        let rooms = [
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 0.9],
            [3.0, 0.9],
            [3.0, 0.0],
            [5.0, 0.0],
            [5.0, 2.0],
            [3.0, 2.0],
            [3.0, 1.1],
            [2.0, 1.1],
            [2.0, 2.0],
            [0.0, 2.0],
        ];
        assert!((widest(&rooms) - 0.1).abs() < 1e-12, "{}", widest(&rooms));
    }
}
