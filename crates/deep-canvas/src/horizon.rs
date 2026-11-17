//! Issue #1381: the horizon trace over a height grid (canvas primitives: Builder plate: terrain,
//! `horizon`), in f64: from each texel of a coarser table, along each azimuth, the elevation of
//! the highest ground it sees on the surface the samples make, each cell split along its
//! (c, r + 1)–(c + 1, r) diagonal as [`crate::heights`] splits it. The ray visits the places it
//! crosses a cell's edge or diagonal, where the surface's slope along it can turn, and skips each
//! node of a pyramid of the cells' highest corners that can't rise above the best angle so far.
//! It builds at release speed in the dev binaries, as the kernel does.

use crate::ops::{atan, cos, sin, TAU};

/// The surface of `cols` × `rows` samples `h` (row by row) at place (u, v) of its grid, in cell
/// (c, r), each cell split along its (c, r + 1)–(c + 1, r) diagonal as the plate is.
fn surface(h: &[f64], cols: usize, c: usize, r: usize, u: f64, v: f64) -> f64 {
    let at = |c: usize, r: usize| h[r * cols + c];
    let (fu, fv) = ((u - c as f64).clamp(0.0, 1.0), (v - r as f64).clamp(0.0, 1.0));
    let (h00, h10, h01, h11) = (at(c, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
    if fu + fv <= 1.0 {
        h00 + fu * (h10 - h00) + fv * (h01 - h00)
    } else {
        h11 + (1.0 - fu) * (h01 - h11) + (1.0 - fv) * (h10 - h11)
    }
}

/// A max pyramid over the cells: level 0 each cell's highest corner, level k + 1 the highest of
/// level k's 2 × 2.
struct Pyramid {
    levels: Vec<(usize, usize, Vec<f64>)>,
}

impl Pyramid {
    fn new(h: &[f64], cols: usize, rows: usize) -> Pyramid {
        let (w, d) = (cols - 1, rows - 1);
        let at = |c: usize, r: usize| h[r * cols + c];
        let base: Vec<f64> = (0..d)
            .flat_map(|r| (0..w).map(move |c| (c, r)))
            .map(|(c, r)| {
                at(c, r)
                    .max(at(c + 1, r))
                    .max(at(c, r + 1))
                    .max(at(c + 1, r + 1))
            })
            .collect();
        let mut levels = vec![(w, d, base)];
        while levels.last().is_some_and(|(w, d, _)| *w > 1 || *d > 1) {
            let (w, d, m) = levels.last().expect("a level");
            let (nw, nd) = (w.div_ceil(2), d.div_ceil(2));
            let mut next = vec![f64::NEG_INFINITY; nw * nd];
            for r in 0..*d {
                for c in 0..*w {
                    let n = &mut next[(r / 2) * nw + c / 2];
                    *n = n.max(m[r * w + c]);
                }
            }
            levels.push((nw, nd, next));
        }
        Pyramid { levels }
    }
}

/// The highest ground's elevation (rad, at least 0) seen from (u0, v0) on the grid at height
/// `h0`, along (du, dv) grid units a metre: the largest rise over distance across every place
/// the ray crosses a cell's edge or diagonal, where the surface's slope along the ray can turn,
/// skipping each node of the pyramid whose highest corner can't rise above the best so far.
#[allow(clippy::too_many_arguments)]
fn trace(
    h: &[f64],
    cols: usize,
    rows: usize,
    p: &Pyramid,
    [u0, v0]: [f64; 2],
    h0: f64,
    [du, dv]: [f64; 2],
    nudge: f64,
) -> f64 {
    let (w, d) = ((cols - 1) as f64, (rows - 1) as f64);
    let top = p.levels.len() - 1;
    let mut best = 0.0f64;
    let mut t = 0.0f64;
    let mut k = 0usize;
    let exit = |t: f64, [x0, x1, y0, y1]: [f64; 4]| -> f64 {
        let (u, v) = (u0 + t * du, v0 + t * dv);
        let tx = if du > 0.0 {
            (x1 - u) / du
        } else if du < 0.0 {
            (x0 - u) / du
        } else {
            f64::INFINITY
        };
        let ty = if dv > 0.0 {
            (y1 - v) / dv
        } else if dv < 0.0 {
            (y0 - v) / dv
        } else {
            f64::INFINITY
        };
        t + tx.min(ty).max(0.0)
    };
    loop {
        // The cell ahead: the place a nudge further on.
        let (u, v) = (u0 + (t + nudge) * du, v0 + (t + nudge) * dv);
        if !(0.0..=w).contains(&u) || !(0.0..=d).contains(&v) {
            return atan(best);
        }
        let (c, r) = ((u as usize).min(cols - 2), (v as usize).min(rows - 2));
        let (lw, _, m) = &p.levels[k];
        let (nc, nr) = (c >> k, r >> k);
        if m[nr * lw + nc] - h0 <= best * t {
            let s = (1usize << k) as f64;
            let b = [
                nc as f64 * s,
                ((nc + 1) as f64 * s).min(w),
                nr as f64 * s,
                ((nr + 1) as f64 * s).min(d),
            ];
            t = exit(t, b) + nudge;
            k = (k + 1).min(top);
            continue;
        }
        if k > 0 {
            k -= 1;
            continue;
        }
        let b = [c as f64, c as f64 + 1.0, r as f64, r as f64 + 1.0];
        let out = exit(t, b);
        let mut see = |tq: f64| {
            if tq > 0.0 {
                let hq = surface(h, cols, c, r, u0 + tq * du, v0 + tq * dv);
                best = best.max((hq - h0) / tq);
            }
        };
        see(t);
        let along = du + dv;
        if along != 0.0 {
            let td = ((c + r + 1) as f64 - (u0 + v0)) / along;
            if td > t && td < out {
                see(td);
            }
        }
        see(out);
        t = out + nudge;
    }
}

/// Each texel's horizon angles (rad, at least 0, below the texel's own level read 0): a grid
/// `size` m across of `cols` × `rows` samples `h` row by row (+X along a row, rows along +Z),
/// traced from `tc` × `tr` texels spread corner to corner over it, `azimuths` a texel turning from
/// +X toward +Z; texel by texel row by row, each texel's azimuths in turn.
pub fn angles(
    size: [f64; 2],
    cols: usize,
    rows: usize,
    h: &[f64],
    [tc, tr]: [usize; 2],
    azimuths: usize,
) -> Vec<f64> {
    let p = Pyramid::new(h, cols, rows);
    let (dx, dz) = (size[0] / (cols - 1) as f64, size[1] / (rows - 1) as f64);
    let nudge = 1e-9 * dx.min(dz);
    // An axis's residue, cos 90° = 6e-17, moves no place it's added to: as 0, the ray runs along
    // a grid line and leaves by the other axis, rather than creeping from a plate's edge by nudges.
    let snap = |x: f64| if x.abs() < 1e-9 { 0.0 } else { x };
    let dirs: Vec<[f64; 2]> = (0..azimuths)
        .map(|k| {
            let a = TAU * k as f64 / azimuths as f64;
            [snap(cos(a)) / dx, snap(sin(a)) / dz]
        })
        .collect();
    let mut out = Vec::with_capacity(tc * tr * azimuths);
    for j in 0..tr {
        for i in 0..tc {
            let u = i as f64 * (cols - 1) as f64 / (tc - 1) as f64;
            let v = j as f64 * (rows - 1) as f64 / (tr - 1) as f64;
            let (c, r) = ((u as usize).min(cols - 2), (v as usize).min(rows - 2));
            let h0 = surface(h, cols, c, r, u, v);
            out.extend(dirs.iter().map(|d| trace(h, cols, rows, &p, [u, v], h0, *d, nudge)));
        }
    }
    out
}
