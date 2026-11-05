//! Motion blur's helpers for `view3d` (#419; canvas primitives: Motion blur, Motion blur:
//! velocity): whether two evaluations draw the same, how far anything travels between two
//! sample times, the velocity target read from the evaluation at t ± half the shutter (never
//! from an earlier frame), and the tile-max and neighbor-max reconstruction filter with fixed
//! taps offset by a pixel hash.

use std::collections::HashMap;

use deep_canvas_scene3d::cut::inverse;
use deep_canvas_scene3d::samples::Blur;
use deep_canvas_scene3d::scene::{Affine3, Scene, Shape, Solid};

type V3 = [f64; 3];

fn apply(m: &Affine3, p: V3) -> V3 {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

/// Whether two evaluations draw the same picture: their marks, camera and light. Readouts and
/// atlas pages are left out: a readout draws over the frame, never in it.
pub fn draws_same(a: &Scene, b: &Scene) -> bool {
    a.layers == b.layers
        && a.camera == b.camera
        && a.sun == b.sun
        && a.lights == b.lights
        && a.sky == b.sky
        && a.cutaway == b.cutaway
}

/// The points a solid's travel is measured at, in its own space: its mesh's vertices, or its
/// unit shape's corners.
fn points(s: &Solid) -> Vec<V3> {
    match (&s.mesh, s.shape) {
        (Some(m), _) => m.positions.clone(),
        (None, Shape::Built(_)) => Vec::new(),
        (None, _) => (0..8)
            .map(|c| [c & 1, c & 2, c & 4].map(|b| if b == 0 { -0.5 } else { 0.5 }))
            .collect(),
    }
}

/// The most any solid's points move on screen between evaluations `a` and `b`, px, each seen
/// through its own camera: a camera's move moves everything it shows.
pub fn travel(a: &Scene, b: &Scene) -> f64 {
    let bs: HashMap<&str, &Solid> = b
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .map(|s| (s.id.as_str(), s))
        .collect();
    let mut most: f64 = 0.0;
    for sa in a.layers.iter().flat_map(|l| &l.solids) {
        let Some(sb) = bs.get(sa.id.as_str()) else {
            continue;
        };
        let (pa, pb) = (points(sa), points(sb));
        if pa.len() != pb.len() {
            // A topology change: the whole item counts as moving.
            return f64::INFINITY;
        }
        for (p, q) in pa.iter().zip(&pb) {
            let (Some(x), Some(y)) = (
                a.camera.project(apply(&sa.model, *p)),
                b.camera.project(apply(&sb.model, *q)),
            ) else {
                continue;
            };
            most = most.max((x[0] - y[0]).hypot(x[1] - y[1]));
        }
    }
    most
}

/// The velocity target: each pixel's travel over the shutter in px, and its view depth (sky
/// far away), with the items whose topology changed inside the shutter.
pub struct Velocity {
    pub v: Vec<[f64; 2]>,
    pub z: Vec<f64>,
    pub topology: Vec<String>,
}

/// The closest point of triangle abc to p, as barycentric weights (Ericson, Real-Time Collision
/// Detection, 5.1.5).
fn closest(p: V3, a: V3, b: V3, c: V3) -> (f64, [f64; 3]) {
    let sub = |x: V3, y: V3| [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
    let dot = |x: V3, y: V3| x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    let w = if d1 <= 0.0 && d2 <= 0.0 {
        [1.0, 0.0, 0.0]
    } else {
        let bp = sub(p, b);
        let (d3, d4) = (dot(ab, bp), dot(ac, bp));
        let cp = sub(p, c);
        let (d5, d6) = (dot(ab, cp), dot(ac, cp));
        let vc = d1 * d4 - d3 * d2;
        let vb = d5 * d2 - d1 * d6;
        let va = d3 * d6 - d5 * d4;
        if d3 >= 0.0 && d4 <= d3 {
            [0.0, 1.0, 0.0]
        } else if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
            let v = d1 / (d1 - d3);
            [1.0 - v, v, 0.0]
        } else if d6 >= 0.0 && d5 <= d6 {
            [0.0, 0.0, 1.0]
        } else if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
            let w = d2 / (d2 - d6);
            [1.0 - w, 0.0, w]
        } else if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
            let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            [0.0, 1.0 - w, w]
        } else {
            let den = 1.0 / (va + vb + vc);
            let (v, w) = (vb * den, vc * den);
            [1.0 - v - w, v, w]
        }
    };
    let q = [0, 1, 2].map(|k| w[0] * a[k] + w[1] * b[k] + w[2] * c[k]);
    let d = sub(p, q);
    (dot(d, d), w)
}

/// How a velocity pairs a solid's surface across the shutter.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Pairing {
    /// The solid's pre-skins at t ± s/2 where its topology holds, its transform alone where not.
    Shipped,
    /// #419 AC4's wrong program: the transform alone, always.
    TransformOnly,
    /// #419 AC6's wrong program: vertex i with vertex i, across a topology change too.
    ByIndex,
}

/// The velocity target of the frame drawn from `at`, from the evaluations at t − s/2 (`open`)
/// and t + s/2 (`close`): each pixel's surface point (by the object-ID and depth targets) taken
/// into its item's own space at t and out again at both times, clamped to `max` px.
#[allow(clippy::too_many_arguments)]
pub fn velocity(
    at: &Scene,
    open: &Scene,
    close: &Scene,
    ids: &[u8],
    picks: &[(String, u32)],
    depth: &(Vec<u8>, bool),
    size: [u32; 2],
    max: f64,
    pairing: Pairing,
) -> Velocity {
    let by_id = |s: &Scene| -> HashMap<String, Solid> {
        s.layers
            .iter()
            .flat_map(|l| &l.solids)
            .map(|x| (x.id.clone(), x.clone()))
            .collect()
    };
    let (o, c) = (by_id(open), by_id(close));
    let named: HashMap<u32, &str> = picks.iter().map(|(id, p)| (*p, id.as_str())).collect();
    let solids: HashMap<&str, &Solid> = at
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .map(|s| (s.id.as_str(), s))
        .collect();
    let mut topology = Vec::new();
    // Each solid's way of pairing: rigid, or its triangles at t with both times' vertices.
    enum Pair {
        Rigid,
        Skinned,
    }
    let mut how: HashMap<&str, Pair> = HashMap::new();
    for (id, s) in &solids {
        let (Some(so), Some(sc)) = (o.get(*id), c.get(*id)) else {
            continue;
        };
        let p = match (&s.mesh, &so.mesh, &sc.mesh) {
            (Some(m), Some(mo), Some(mc)) if pairing != Pairing::TransformOnly => {
                let same = |a: &deep_canvas_scene3d::geom::Mesh,
                            b: &deep_canvas_scene3d::geom::Mesh| {
                    a.positions.len() == b.positions.len() && a.indices == b.indices
                };
                if !(same(m, mo) && same(m, mc)) && pairing != Pairing::ByIndex {
                    topology.push(id.to_string());
                    Pair::Rigid
                } else if m.positions == mo.positions && m.positions == mc.positions {
                    Pair::Rigid
                } else {
                    Pair::Skinned
                }
            }
            _ => Pair::Rigid,
        };
        how.insert(id, p);
    }
    topology.sort();
    topology.dedup();
    let [w, h] = [size[0] as usize, size[1] as usize];
    let mut v = vec![[0.0; 2]; w * h];
    let mut z = vec![1e9; w * h];
    let cam = &at.camera;
    let read = |b: &[u8], i: usize| b.get(i * 4..i * 4 + 4).map(|x| [x[0], x[1], x[2], x[3]]);
    for i in 0..w * h {
        let Some(p) = read(ids, i).map(u32::from_le_bytes).filter(|p| *p != 0) else {
            continue;
        };
        let Some(id) = named.get(&p) else { continue };
        let Some(d) = read(&depth.0, i)
            .map(f32::from_le_bytes)
            .map(f64::from)
            .filter(|d| *d > 0.0)
        else {
            continue;
        };
        // Reversed Z: depth = near ÷ vz in perspective, (far − vz) ÷ (far − near) in orthographic.
        if !depth.1 {
            continue;
        }
        let vz = if cam.perspective {
            cam.near / d
        } else {
            cam.far - d * (cam.far - cam.near)
        };
        z[i] = vz;
        let (Some(s), Some(so), Some(sc)) = (solids.get(id), o.get(*id), c.get(*id)) else {
            continue;
        };
        let (x, y) = (
            (i % w) as f64 + 0.5 - at.jitter[0],
            (i / w) as f64 + 0.5 - at.jitter[1],
        );
        let world = cam.unproject(x, y, vz);
        let local = apply(&inverse(&s.model), world);
        let (lo, lc) = match how.get(id) {
            Some(Pair::Skinned) => {
                let (m, mo, mc) = (
                    s.mesh.as_ref().unwrap(),
                    so.mesh.as_ref().unwrap(),
                    sc.mesh.as_ref().unwrap(),
                );
                let mut best = (f64::INFINITY, [0u32; 3], [0.0; 3]);
                for t in m.indices.chunks_exact(3) {
                    let (d2, wts) = closest(
                        local,
                        m.positions[t[0] as usize],
                        m.positions[t[1] as usize],
                        m.positions[t[2] as usize],
                    );
                    if d2 < best.0 {
                        best = (d2, [t[0], t[1], t[2]], wts);
                    }
                }
                let at_time = |mm: &deep_canvas_scene3d::geom::Mesh| -> V3 {
                    let k = |j: u32| mm.positions[(j as usize).min(mm.positions.len() - 1)];
                    let [a, b, cc] = best.1.map(k);
                    [0, 1, 2].map(|q| best.2[0] * a[q] + best.2[1] * b[q] + best.2[2] * cc[q])
                };
                // The point's offset from its triangle stays with it (a sub-pixel off the
                // surface the depth target holds).
                let off = {
                    let q = at_time(m);
                    [local[0] - q[0], local[1] - q[1], local[2] - q[2]]
                };
                let shift = |q: V3| [q[0] + off[0], q[1] + off[1], q[2] + off[2]];
                (shift(at_time(mo)), shift(at_time(mc)))
            }
            _ => (local, local),
        };
        let (Some(a), Some(b)) = (
            open.camera.project(apply(&so.model, lo)),
            close.camera.project(apply(&sc.model, lc)),
        ) else {
            continue;
        };
        let mut d = [b[0] - a[0], b[1] - a[1]];
        let len = d[0].hypot(d[1]);
        if len > max {
            d = [d[0] * max / len, d[1] * max / len];
        }
        v[i] = d;
    }
    Velocity { v, z, topology }
}

/// A fixed hash of a pixel in [−½, ½): the taps' offset, never the frame number.
fn hash(x: usize, y: usize) -> f64 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd816_3841);
    h ^= h >> 13;
    h = h.wrapping_mul(0x5bd1_e995);
    h ^= h >> 15;
    f64::from(h) / 4_294_967_296.0 - 0.5
}

/// The reconstruction filter: tile-max and neighbor-max velocities (McGuire et al. 2012) bound
/// where each pixel looks, and `taps` fixed taps along its neighborhood's largest velocity,
/// offset by a pixel hash, are its candidates. At each of `taps` shutter times the pixel shows the
/// nearest candidate whose own travel covers it then, or, where none does, what lies behind: the
/// pixel itself if it stays, else the farthest candidate. `colors` are the frame's channels as
/// linear f64, 4 per pixel; alpha is kept.
pub fn reconstruct(colors: &mut [Vec<f64>], vel: &Velocity, size: [u32; 2], blur: &Blur) {
    let [w, h] = [size[0] as usize, size[1] as usize];
    let len = |v: [f64; 2]| v[0].hypot(v[1]);
    // Half the travel: the shutter is centred on the frame's time.
    let half = |i: usize| [vel.v[i][0] / 2.0, vel.v[i][1] / 2.0];
    let tile = blur.tile_px.max(1) as usize;
    let (tw, th) = (w.div_ceil(tile), h.div_ceil(tile));
    let mut tmax = vec![[0.0; 2]; tw * th];
    for y in 0..h {
        for x in 0..w {
            let t = (y / tile) * tw + x / tile;
            if len(half(y * w + x)) > len(tmax[t]) {
                tmax[t] = half(y * w + x);
            }
        }
    }
    let mut nmax = vec![[0.0; 2]; tw * th];
    for ty in 0..th {
        for tx in 0..tw {
            let mut best = [0.0; 2];
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let (x, y) = (tx as i64 + dx, ty as i64 + dy);
                    if x < 0 || y < 0 || x >= tw as i64 || y >= th as i64 {
                        continue;
                    }
                    let m = tmax[y as usize * tw + x as usize];
                    if len(m) > len(best) {
                        best = m;
                    }
                }
            }
            nmax[ty * tw + tx] = best;
        }
    }
    let taps = blur.taps.max(2) as usize;
    let src: Vec<Vec<f64>> = colors.to_vec();
    let mut cand: Vec<usize> = Vec::with_capacity(taps + 1);
    for y in 0..h {
        for x in 0..w {
            let vn = nmax[(y / tile) * tw + x / tile];
            if len(vn) < 0.5 {
                continue;
            }
            let i = y * w + x;
            let j = hash(x, y);
            cand.clear();
            cand.push(i);
            for k in 0..taps {
                let u = -1.0 + 2.0 * (k as f64 + 0.5 + j) / taps as f64;
                let (sx, sy) = (
                    (x as f64 + 0.5 + vn[0] * u).floor(),
                    (y as f64 + 0.5 + vn[1] * u).floor(),
                );
                if sx < 0.0 || sy < 0.0 || sx >= w as f64 || sy >= h as f64 {
                    continue;
                }
                let yi = sy as usize * w + sx as usize;
                if !cand.contains(&yi) {
                    cand.push(yi);
                }
            }
            let stays = len(vel.v[i]) < 0.5;
            let behind = cand
                .iter()
                .copied()
                .filter(|c| len(vel.v[*c]) < 0.5)
                .max_by(|a, b| vel.z[*a].total_cmp(&vel.z[*b]))
                .unwrap_or_else(|| {
                    *cand
                        .iter()
                        .max_by(|a, b| vel.z[**a].total_cmp(&vel.z[**b]))
                        .expect("the pixel itself")
                });
            let mut sum = vec![[0.0f64; 3]; src.len()];
            for s in 0..taps {
                let tau = (s as f64 + 0.5) / taps as f64 - 0.5;
                // Each candidate's motion traced back from the pixel to the frame's time: a hit
                // where the surface found there moves as the candidate does.
                let mut best: Option<usize> = None;
                for &c in &cand {
                    let v = vel.v[c];
                    let (sx, sy) = (
                        (x as f64 + 0.5 - v[0] * tau).floor(),
                        (y as f64 + 0.5 - v[1] * tau).floor(),
                    );
                    if sx < 0.0 || sy < 0.0 || sx >= w as f64 || sy >= h as f64 {
                        continue;
                    }
                    let p = sy as usize * w + sx as usize;
                    let d = [vel.v[p][0] - v[0], vel.v[p][1] - v[1]];
                    if len(d) <= (0.25 * len(v)).max(1.0)
                        && best.is_none_or(|b| vel.z[p] < vel.z[b])
                    {
                        best = Some(p);
                    }
                }
                let shown = best.unwrap_or(if stays { i } else { behind });
                for (acc, c) in sum.iter_mut().zip(&src) {
                    for q in 0..3 {
                        acc[q] += c[shown * 4 + q];
                    }
                }
            }
            for (out, acc) in colors.iter_mut().zip(&sum) {
                for q in 0..3 {
                    out[i * 4 + q] = acc[q] / taps as f64;
                }
            }
        }
    }
}
