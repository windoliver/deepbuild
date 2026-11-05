//! Builder: uv (canvas primitives; issue #440): uv0 in metres on every builder, by the builder's
//! own layout or a box, planar, cylinder or sphere projection, over `uv_scale`; and uv1 for bakes
//! from the builder's own charts, with no unwrap job: each piece of the mesh its vertices join is
//! one chart, laid flat in its plane, along the builder's own layout or around its axis, and the
//! charts are packed in rows into the unit square so none overlaps another.

use deep_canvas::ops::{atan2, sqrt};
use serde_json::Value;

use crate::geom::{basis, cross, dot, length, newell, sub, unit, Mesh, V2, V3};

/// A uv0 projection.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Projection {
    Natural,
    Box(f64),
    Planar(usize),
    Cylinder(usize),
    Sphere,
}

fn axis(v: Option<&Value>) -> Option<usize> {
    match v.and_then(Value::as_str).unwrap_or("y") {
        "x" => Some(0),
        "y" => Some(1),
        "z" => Some(2),
        _ => None,
    }
}

/// `uv0` and `uv_scale` from a builder's params, or the param at fault.
pub fn read(p: &Value) -> Result<(Projection, f64), String> {
    let bad = |n: &str| format!("params/{n}");
    let scale = match p.get("uv_scale") {
        None => 1.0,
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad("uv_scale"))?,
    };
    let proj = match p.get("uv0") {
        None => Projection::Natural,
        Some(Value::String(s)) => match s.as_str() {
            "natural" => Projection::Natural,
            "box" => Projection::Box(1.0),
            "sphere" => Projection::Sphere,
            "planar" => Projection::Planar(1),
            "cylinder" => Projection::Cylinder(1),
            _ => return Err(bad("uv0")),
        },
        Some(Value::Object(o)) if o.len() == 1 => {
            let (name, args) = o.iter().next().expect("one entry");
            match name.as_str() {
                "box" => {
                    let size = match args.get("size") {
                        None => 1.0,
                        Some(v) => v
                            .as_f64()
                            .filter(|x| x.is_finite() && *x > 0.0)
                            .ok_or_else(|| bad("uv0"))?,
                    };
                    Projection::Box(size)
                }
                "planar" => Projection::Planar(axis(args.get("axis")).ok_or_else(|| bad("uv0"))?),
                "cylinder" => {
                    Projection::Cylinder(axis(args.get("axis")).ok_or_else(|| bad("uv0"))?)
                }
                "sphere" => Projection::Sphere,
                "natural" => Projection::Natural,
                _ => return Err(bad("uv0")),
            }
        }
        Some(_) => return Err(bad("uv0")),
    };
    Ok((proj, scale))
}

/// The two axes after `k`, in cyclic order.
fn across(k: usize) -> (usize, usize) {
    ((k + 1) % 3, (k + 2) % 3)
}

/// The box projection: each vertex's two coordinates across its normal's main axis.
fn boxed(q: V3, n: V3) -> V2 {
    let (ax, ay, az) = (n[0].abs(), n[1].abs(), n[2].abs());
    if ay >= ax && ay >= az {
        [q[0], q[2]]
    } else if ax >= az {
        [q[2], q[1]]
    } else {
        [q[0], q[1]]
    }
}

/// Angles round axis `k` (through `centre`) with each point's distance from it, unwrapped along
/// the mesh's edges from each piece's first point (each neighbour takes the turn of its angle
/// nearest its neighbour's), so a piece whose seam is split never wraps; a point on the axis
/// takes its neighbours' mean angle.
fn angles(m: &Mesh, k: usize, centre: V3) -> Vec<(f64, f64)> {
    let (i, j) = across(k);
    let tau = 2.0 * core::f64::consts::PI;
    let polar: Vec<(f64, f64)> = m
        .positions
        .iter()
        .map(|q| {
            let (a, b) = (q[i] - centre[i], q[j] - centre[j]);
            (atan2(a, b), sqrt(a * a + b * b))
        })
        .collect();
    let rmax = polar.iter().map(|p| p.1).fold(0.0, f64::max);
    let on_axis = |v: usize| polar[v].1 <= 1e-9 * (1.0 + rmax);
    let n = polar.len();
    let mut next: Vec<Vec<usize>> = vec![Vec::new(); n];
    for t in 0..m.triangles() {
        let ids = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        for a in 0..3 {
            for b in 0..3 {
                if a != b {
                    next[ids[a]].push(ids[b]);
                }
            }
        }
    }
    let mut theta: Vec<Option<f64>> = vec![None; n];
    for start in 0..n {
        if theta[start].is_some() || on_axis(start) || next[start].is_empty() {
            continue;
        }
        theta[start] = Some(polar[start].0);
        let mut queue = std::collections::VecDeque::from([start]);
        while let Some(v) = queue.pop_front() {
            let at = theta[v].expect("set before queued");
            for &u in &next[v] {
                if theta[u].is_some() || on_axis(u) {
                    continue;
                }
                let turns = ((at - polar[u].0) / tau).round();
                theta[u] = Some(polar[u].0 + turns * tau);
                queue.push_back(u);
            }
        }
    }
    (0..n)
        .map(|v| {
            let th = theta[v].unwrap_or_else(|| {
                let near: Vec<f64> = next[v].iter().filter_map(|&u| theta[u]).collect();
                if near.is_empty() {
                    0.0
                } else {
                    near.iter().sum::<f64>() / near.len() as f64
                }
            });
            (th, polar[v].1)
        })
        .collect()
}

/// uv0 by `proj` over `scale` metres a unit; `natural` is the builder's own layout on the
/// vertices it gave one, and `fallback` on the rest.
pub fn uv0(
    m: &Mesh,
    proj: Projection,
    scale: f64,
    natural: Option<&[V2]>,
    fallback: Projection,
) -> Vec<V2> {
    if proj == Projection::Natural {
        let mut out = uv0(m, fallback, scale, None, Projection::Box(1.0));
        for (q, n) in out.iter_mut().zip(natural.into_iter().flatten()) {
            if n[0].is_finite() {
                *q = [n[0] / scale, n[1] / scale];
            }
        }
        return out;
    }
    let uv: Vec<V2> = match proj {
        Projection::Natural | Projection::Box(_) => {
            let size = if let Projection::Box(s) = proj {
                s
            } else {
                1.0
            };
            m.positions
                .iter()
                .zip(&m.normals)
                .map(|(q, n)| {
                    let b = boxed(*q, *n);
                    [b[0] / size, b[1] / size]
                })
                .collect()
        }
        Projection::Planar(k) => {
            let (i, j) = across(k);
            m.positions.iter().map(|q| [q[i], q[j]]).collect()
        }
        Projection::Cylinder(k) => angles(m, k, [0.0; 3])
            .into_iter()
            .zip(&m.positions)
            .map(|((th, r), q)| [th * r, q[k]])
            .collect(),
        Projection::Sphere => angles(m, 1, [0.0; 3])
            .into_iter()
            .zip(&m.positions)
            .map(|((th, _), q)| {
                let r = length(*q);
                let lat = atan2(q[1], sqrt(q[0] * q[0] + q[2] * q[2]));
                [th * r, lat * r]
            })
            .collect(),
    };
    uv.into_iter()
        .map(|q| [q[0] / scale, q[1] / scale])
        .collect()
}

/// uv1: each piece of the mesh its triangles' shared vertices join is a chart, laid out in
/// metres (flat in its plane; else as a height field over its mean plane; else along `natural`;
/// else round the vertical axis through it), and the charts are packed in rows, tallest first,
/// into the unit square with a gap between them, at one scale for all.
pub fn uv1(m: &Mesh, natural: Option<&[V2]>) -> Vec<V2> {
    let n = m.positions.len();
    if n == 0 {
        return Vec::new();
    }
    // Pieces by shared vertices.
    let mut root: Vec<usize> = (0..n).collect();
    fn find(root: &mut [usize], mut x: usize) -> usize {
        while root[x] != x {
            root[x] = root[root[x]];
            x = root[x];
        }
        x
    }
    for t in 0..m.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        for (x, y) in [(a, b), (b, c)] {
            let (rx, ry) = (find(&mut root, x), find(&mut root, y));
            if rx != ry {
                root[rx.max(ry)] = rx.min(ry);
            }
        }
    }
    let piece: Vec<usize> = (0..n).map(|v| find(&mut root, v)).collect();
    let mut tris_of: std::collections::BTreeMap<usize, Vec<usize>> =
        std::collections::BTreeMap::new();
    for t in 0..m.triangles() {
        tris_of
            .entry(piece[m.indices[3 * t] as usize])
            .or_default()
            .push(t);
    }
    let mut flat = vec![[0.0; 2]; n];
    let mut charts: Vec<(usize, [f64; 4])> = Vec::new();
    for (&p, tris) in &tris_of {
        let normals: Vec<V3> = tris
            .iter()
            .map(|&t| {
                let [a, b, c] = [0, 1, 2].map(|j| m.positions[m.indices[3 * t + j] as usize]);
                cross(sub(b, a), sub(c, a))
            })
            .collect();
        let mean = unit(
            normals
                .iter()
                .fold([0.0; 3], |s, q| crate::geom::add(s, *q)),
        );
        let verts: Vec<usize> = (0..n).filter(|&v| piece[v] == p).collect();
        let is_flat = normals
            .iter()
            .all(|q| length(cross(unit(*q), mean)) < 1e-9 && dot(*q, mean) > 0.0);
        let graph = normals.iter().all(|q| dot(unit(*q), mean) > 0.2);
        let own = natural.filter(|nat| verts.iter().all(|&v| nat[v][0].is_finite()));
        if is_flat || (graph && own.is_none()) {
            let (u, w) = basis(if is_flat {
                unit(newell(
                    &verts.iter().map(|&v| m.positions[v]).collect::<Vec<_>>(),
                ))
            } else {
                mean
            });
            let (u, w) = if is_flat && dot(cross(u, w), mean) < 0.0 {
                (w, u)
            } else {
                (u, w)
            };
            for &v in &verts {
                flat[v] = [dot(m.positions[v], u), dot(m.positions[v], w)];
            }
        } else if let Some(nat) = own {
            for &v in &verts {
                flat[v] = nat[v];
            }
        } else {
            let mut sub_mesh = Mesh {
                positions: m.positions.clone(),
                ..Mesh::default()
            };
            for &t in tris {
                sub_mesh.indices.extend(&m.indices[3 * t..3 * t + 3]);
            }
            // The axis through the middle of the piece's bounds, so a seam's repeated points
            // don't pull it off a round piece's own axis.
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            for &v in &verts {
                for k in 0..3 {
                    lo[k] = lo[k].min(m.positions[v][k]);
                    hi[k] = hi[k].max(m.positions[v][k]);
                }
            }
            let c = crate::geom::scale(crate::geom::add(lo, hi), 0.5);
            let a = angles(&sub_mesh, 1, c);
            let r = verts.iter().map(|&v| a[v].1).sum::<f64>() / verts.len() as f64;
            for &v in &verts {
                flat[v] = [a[v].0 * r.max(1e-9), m.positions[v][1]];
            }
        }
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for &v in &verts {
            b[0] = b[0].min(flat[v][0]);
            b[1] = b[1].min(flat[v][1]);
            b[2] = b[2].max(flat[v][0]);
            b[3] = b[3].max(flat[v][1]);
        }
        charts.push((p, b));
    }
    // Rows, tallest first, about as wide as the charts' total area is square.
    let area: f64 = charts
        .iter()
        .map(|(_, b)| (b[2] - b[0]) * (b[3] - b[1]))
        .sum();
    let widest = charts.iter().map(|(_, b)| b[2] - b[0]).fold(0.0, f64::max);
    let gap = 0.02 * sqrt(area.max(1e-18)).max(widest * 1e-3);
    let width = (1.2 * sqrt(area)).max(widest) + gap;
    let mut order: Vec<usize> = (0..charts.len()).collect();
    order.sort_by(|&x, &y| {
        let (bx, by) = (charts[x].1, charts[y].1);
        (by[3] - by[1]).total_cmp(&(bx[3] - bx[1])).then(x.cmp(&y))
    });
    let mut place: Vec<V2> = vec![[0.0; 2]; charts.len()];
    let (mut x, mut y, mut row) = (gap, gap, 0.0f64);
    for &k in &order {
        let b = charts[k].1;
        let (w, h) = (b[2] - b[0], b[3] - b[1]);
        if x + w + gap > width && x > gap {
            x = gap;
            y += row + gap;
            row = 0.0;
        }
        place[k] = [x - b[0], y - b[1]];
        x += w + gap;
        row = row.max(h);
    }
    let total = (y + row + gap).max(width);
    let at: std::collections::BTreeMap<usize, usize> = charts
        .iter()
        .enumerate()
        .map(|(k, (p, _))| (*p, k))
        .collect();
    (0..n)
        .map(|v| match at.get(&piece[v]) {
            Some(&k) => [
                (flat[v][0] + place[k][0]) / total,
                (flat[v][1] + place[k][1]) / total,
            ],
            None => [0.0, 0.0],
        })
        .collect()
}
