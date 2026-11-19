//! Box and mesh deforms (canvas primitives: Modifier; issue #1929): a mesh reshaped by a grid of
//! points over a box, blended by Bernstein polynomials (Sederberg and Parry's free-form
//! deformation), or by a closed control mesh around it, blended by mean value coordinates (Ju,
//! Schaefer and Warren 2005). Each binds at build: every vertex's weight for every control point
//! comes from the mesh the step takes and from the box or the control mesh, and is kept by a
//! content key over those alone, so `moves` change no weight and a frame sums weights times moves.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas::ops::{asin, atan2, powi, sin, sqrt, PI, TAU};
use deep_canvas::schedule::{canonical, Canonical, Hasher, Key};
use serde_json::{json, Value};

use crate::geom::{add, cross, dot, length, scale, sub, Mesh, V3};
use crate::stack::vec3;

pub const BOX: &str = "mod.box_deform@1";
pub const MESH: &str = "mod.mesh_deform@1";

/// The wrong programs #1929's criteria plant, each reachable only through a proof surface.
pub const PLANTS: [&str; 8] = [
    "box_deform_own_bounds",
    "box_deform_trilinear_cells",
    "box_deform_drops_last_weight",
    "box_deform_clamps_outside",
    "mesh_deform_inverse_distance",
    "mesh_deform_binds_every_frame",
    "mesh_deform_key_without_mesh",
    "mesh_deform_extrapolates_outside",
];

/// The codes a deform refuses its item with at check.
pub const CODES: [&str; 4] = [
    "box_deform.outside",
    "box_deform.params",
    "mesh_deform.outside",
    "mesh_deform.mesh",
];

/// A vertex nearer the control mesh than this, in m, is refused as one outside it.
const NEAR: f64 = 1e-6;
/// Under this, an angle of the mean value coordinates counts as 0.
const EPS: f64 = 1e-9;

/// A deform's bind: each vertex's weight for each control point, vertex by vertex (0 off the
/// part `on` names), under the content key of the mesh and the box or control mesh it came from.
#[derive(Clone, Debug, PartialEq)]
pub struct Bind {
    pub key: Key,
    pub weights: Arc<Vec<f64>>,
    /// Whether this run computed the weights; false where it read the ones its last run kept.
    pub computed: bool,
}

/// A refusal at check: its code, and what its issue carries beside the item.
pub type Refused = (&'static str, Value);

/// What a deform binds to: a grid of `n` points over the box, or a closed control mesh.
enum Control {
    Grid {
        from: V3,
        to: V3,
        n: [usize; 3],
    },
    Cage {
        points: Vec<V3>,
        triangles: Vec<[usize; 3]>,
    },
}

fn list<T>(v: Option<&Value>, f: impl Fn(&Value) -> Option<T>) -> Option<Vec<T>> {
    v?.as_array()?.iter().map(f).collect()
}

/// A `box_deform`'s box and grid; a side of 0 m or `points` outside 2 to 4 is refused.
fn grid(p: &Value) -> Result<Control, Refused> {
    let no = |reason: &str| (CODES[1], json!({"reason": reason}));
    let from = vec3(p.get("from")).ok_or_else(|| no("from"))?;
    let to = vec3(p.get("to")).ok_or_else(|| no("to"))?;
    if (0..3).any(|a| from[a] == to[a]) {
        return Err(no("side"));
    }
    let count = |c: &Value| {
        c.as_u64()
            .filter(|c| (2..=4).contains(c))
            .map(|c| c as usize)
    };
    let n = list(p.get("points"), count)
        .filter(|n| n.len() == 3)
        .ok_or_else(|| no("points"))?;
    let n = [n[0], n[1], n[2]];
    Ok(Control::Grid { from, to, n })
}

/// A `mesh_deform`'s control mesh: 4 to 64 points, closed, manifold and wound outward, or refused.
fn cage(p: &Value) -> Result<Control, Refused> {
    let no = |reason: &str| (CODES[3], json!({"reason": reason}));
    let mesh = p.get("mesh");
    let points = list(mesh.and_then(|m| m.get("points")), |v| vec3(Some(v)))
        .filter(|p| (4..=64).contains(&p.len()))
        .ok_or_else(|| no("points"))?;
    let corner = |i: &Value| i.as_u64().map(|i| i as usize).filter(|i| *i < points.len());
    let triangles = list(mesh.and_then(|m| m.get("triangles")), |t| {
        let t = list(Some(t), corner).filter(|t| t.len() == 3)?;
        (t[0] != t[1] && t[1] != t[2] && t[2] != t[0]).then_some([t[0], t[1], t[2]])
    })
    .filter(|t| !t.is_empty())
    .ok_or_else(|| no("triangles"))?;
    // Closed and manifold: every edge in two triangles, once each way.
    let mut ways: BTreeMap<[usize; 2], [u32; 2]> = BTreeMap::new();
    for t in &triangles {
        for i in 0..3 {
            let (a, b) = (t[i], t[(i + 1) % 3]);
            ways.entry([a.min(b), a.max(b)]).or_default()[usize::from(a > b)] += 1;
        }
    }
    let open: Vec<&[usize; 2]> = ways
        .iter()
        .filter(|e| e.1[0] + e.1[1] == 1)
        .map(|e| e.0)
        .collect();
    if !open.is_empty() {
        return Err((CODES[3], json!({"reason": "open", "edges": open})));
    }
    if ways.values().any(|w| *w != [1, 1]) {
        return Err(no("non_manifold"));
    }
    // Wound outward: the volume it holds is positive.
    let six = |t: &[usize; 3]| dot(points[t[0]], cross(points[t[1]], points[t[2]]));
    if triangles.iter().map(six).sum::<f64>() <= 0.0 {
        return Err(no("inward"));
    }
    Ok(Control::Cage { points, triangles })
}

/// B_i of degree n at s: C(n, i) s^i (1 − s)^(n − i).
fn bernstein(n: usize, i: usize, s: f64) -> f64 {
    let c = (0..i).fold(1.0, |c, k| c * (n - k) as f64 / (k + 1) as f64);
    c * powi(s, i as i32) * powi(1.0 - s, (n - i) as i32)
}

/// The distance from the origin to the triangle.
fn reach([a, b, c]: [V3; 3]) -> f64 {
    let n = cross(sub(b, a), sub(c, a));
    let edges = [(a, b), (b, c), (c, a)];
    // Over the triangle, the distance to its plane; else to its nearest edge.
    if edges.iter().all(|(p, q)| dot(cross(*p, *q), n) >= 0.0) {
        return dot(a, n).abs() / length(n);
    }
    let to = |(p, q): &(V3, V3)| {
        let e = sub(*q, *p);
        length(add(*p, scale(e, (-dot(*p, e) / dot(e, e)).clamp(0.0, 1.0))))
    };
    edges.iter().map(to).fold(f64::INFINITY, f64::min)
}

/// Whether x lies inside the control mesh, `NEAR` or more from it: the solid angle the mesh
/// fills around x is the whole sphere inside it and nothing outside.
fn within(x: V3, points: &[V3], triangles: &[[usize; 3]]) -> bool {
    let mut filled = 0.0;
    for t in triangles {
        let [a, b, c] = t.map(|i| sub(points[i], x));
        // A triangle of no area gives no distance, and refuses the vertex too.
        let near = reach([a, b, c]);
        if near.is_nan() || near < NEAR {
            return false;
        }
        let [la, lb, lc] = [a, b, c].map(length);
        let under = la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb;
        filled += 2.0 * atan2(dot(a, cross(b, c)), under);
    }
    filled > TAU
}

/// x's mean value coordinates in a closed triangle mesh, before they are divided by their sum
/// (Ju, Schaefer and Warren 2005, Figure 4).
fn mean_value(x: V3, points: &[V3], triangles: &[[usize; 3]]) -> Vec<f64> {
    let d: Vec<f64> = points.iter().map(|p| length(sub(*p, x))).collect();
    let u = |j: usize| scale(sub(points[j], x), 1.0 / d[j]);
    let mut w = vec![0.0; d.len()];
    for t in triangles {
        let [i, j, k] = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
        let theta = i.map(|n| 2.0 * asin((length(sub(u(t[j[n]]), u(t[k[n]]))) / 2.0).min(1.0)));
        let h = (theta[0] + theta[1] + theta[2]) / 2.0;
        if PI - h < EPS {
            // x lies on this triangle: its barycentric coordinates there.
            w.fill(0.0);
            for n in i {
                w[t[n]] = sin(theta[n]) * d[t[j[n]]] * d[t[k[n]]];
            }
            break;
        }
        let c = i.map(|n| {
            2.0 * sin(h) * sin(h - theta[n]) / (sin(theta[j[n]]) * sin(theta[k[n]])) - 1.0
        });
        let flip = dot(u(t[0]), cross(u(t[1]), u(t[2]))) < 0.0;
        let s = c.map(|c| sqrt((1.0 - c * c).max(0.0)) * if flip { -1.0 } else { 1.0 });
        // x in the triangle's plane and outside it: the triangle adds nothing.
        if s.iter().any(|s| s.abs() <= EPS) {
            continue;
        }
        for n in i {
            w[t[n]] += (theta[n] - c[j[n]] * theta[k[n]] - c[k[n]] * theta[j[n]])
                / (d[t[n]] * sin(theta[j[n]]) * s[k[n]]);
        }
    }
    w
}

impl Control {
    fn points(&self) -> usize {
        match self {
            Control::Grid { n, .. } => n[0] * n[1] * n[2],
            Control::Cage { points, .. } => points.len(),
        }
    }

    /// Every vertex's weights, vertex by vertex; a vertex `on` names that lies outside the box,
    /// or outside the control mesh or within `NEAR` of it, refuses the item, naming one vertex of
    /// each such welded point, up to 64.
    fn weights(&self, m: &Mesh, on: &[bool], planted: Option<&str>) -> Result<Vec<f64>, Refused> {
        let plant = |name: &str| planted == Some(name);
        let (count, bounds, welded) = (self.points(), m.bounds(), m.welded());
        let (mut out, mut seen) = (Vec::new(), BTreeSet::new());
        let mut weights = vec![0.0; m.positions.len() * count];
        for (v, p) in m.positions.iter().enumerate().filter(|(v, _)| on[*v]) {
            let row = &mut weights[v * count..(v + 1) * count];
            let inside = match self {
                Control::Grid { from, to, n } => {
                    let [lo, hi] = if plant("box_deform_own_bounds") {
                        bounds
                    } else {
                        [*from, *to]
                    };
                    let basis = [0, 1, 2].map(|a| {
                        let s = ((p[a] - lo[a]) / (hi[a] - lo[a])).clamp(0.0, 1.0);
                        let hat =
                            |i: usize| (1.0 - (s * (n[a] - 1) as f64 - i as f64).abs()).max(0.0);
                        let of = |i: usize| match plant("box_deform_trilinear_cells") {
                            true => hat(i),
                            false => bernstein(n[a] - 1, i, s),
                        };
                        (0..n[a]).map(of).collect::<Vec<f64>>()
                    });
                    // x fastest, then y, then z.
                    for (j, w) in row.iter_mut().enumerate() {
                        *w = basis[0][j % n[0]]
                            * basis[1][j / n[0] % n[1]]
                            * basis[2][j / (n[0] * n[1])];
                    }
                    if plant("box_deform_drops_last_weight") {
                        row[count - 1] = 0.0;
                    }
                    let within =
                        |a: usize| p[a] >= from[a].min(to[a]) && p[a] <= from[a].max(to[a]);
                    plant("box_deform_clamps_outside") || (0..3).all(within)
                }
                Control::Cage { points, triangles } => {
                    let w = match plant("mesh_deform_inverse_distance") {
                        true => points.iter().map(|q| 1.0 / length(sub(*q, *p))).collect(),
                        false => mean_value(*p, points, triangles),
                    };
                    let total: f64 = w.iter().sum();
                    for (r, w) in row.iter_mut().zip(w) {
                        *r = w / total;
                    }
                    plant("mesh_deform_extrapolates_outside") || within(*p, points, triangles)
                }
            };
            if !inside && seen.insert(welded[v]) && out.len() < 64 {
                out.push(v);
            }
        }
        match (out.is_empty(), self) {
            (true, _) => Ok(weights),
            (_, Control::Grid { .. }) => Err((CODES[0], json!({"vertices": out}))),
            (_, Control::Cage { .. }) => Err((CODES[2], json!({"vertices": out}))),
        }
    }
}

/// The mesh with the vertices `on` moved by their weights times `params.moves` (one per control
/// point, 0 when left out), and the step's bind: `kept`'s weights where its key still holds, else
/// computed.
pub fn deform(
    m: &Mesh,
    on: &[bool],
    kind: &str,
    params: &Value,
    kept: Option<&Bind>,
    planted: Option<&str>,
) -> Result<(Mesh, Bind), Refused> {
    let (control, code) = match kind {
        BOX => (grid(params)?, CODES[1]),
        _ => (cage(params)?, CODES[3]),
    };
    let count = control.points();
    let moves = match params.get("moves") {
        None => vec![[0.0; 3]; count],
        v => list(v, |m| vec3(Some(m)))
            .filter(|m| m.len() == count)
            .ok_or_else(|| (code, json!({"reason": "moves"})))?,
    };
    // The key: the mesh the step takes, the part it moves and the box or the control mesh.
    let mut held = params.clone();
    if let Some(o) = held.as_object_mut() {
        o.remove("moves");
        if planted == Some("mesh_deform_key_without_mesh") {
            o.remove("mesh");
        }
    }
    let key = Hasher::new("scene3d.bind")
        .text(kind)
        .bytes(&m.positions.canonical_bytes())
        .bytes(&on.canonical_bytes())
        .bytes(&canonical(&held))
        .finish();
    let kept = kept.filter(|b| b.key == key && planted != Some("mesh_deform_binds_every_frame"));
    let bind = match kept {
        Some(b) => Bind {
            computed: false,
            ..b.clone()
        },
        None => Bind {
            key,
            weights: Arc::new(control.weights(m, on, planted)?),
            computed: true,
        },
    };
    let mut out = m.clone();
    for (v, row) in bind.weights.chunks(count).enumerate() {
        let by = (0..count).fold([0.0; 3], |by, j| add(by, scale(moves[j], row[j])));
        // A coordinate that doesn't move keeps its bits, −0 among them.
        for a in (0..3).filter(|a| by[*a] != 0.0) {
            out.positions[v][a] += by[a];
        }
    }
    Ok((out, bind))
}

#[cfg(test)]
mod tests;
