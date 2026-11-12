//! Landing on a height map baked at check (Particles `particles@1`: bounce and kill, `land`). The
//! core bakes, on the CPU in f64, the highest point of a collection's static items' meshes in
//! each cell of a grid over their bounds in x and z. A particle lands at the first time its arc
//! meets the map, read bilinearly between cell centres (and stepping at the midpoint across a
//! cliff, so a wall's edge stays sharp): a fixed march of 16 steps along the arc,
//! from where it falls below the map's highest point (or its start) to where it would pass the
//! map's lowest, brackets the first crossing those samples see, and eight Newton steps refine it.
//! It never lands outside the map's bounds.

use super::solve::{plane_root, Arc, Ground, NEWTON};
use super::spec::{Plane, Refusal};
use super::{len, scale, V3};

/// At most this many cells along each side of a map.
pub const MAX_SIDE: usize = 2048;
/// The march's fixed samples.
pub const MARCH: usize = 16;

/// A height map: `nx × nz` cells of `cell` metres from `(x0, z0)`, each the highest point met in
/// it, or none where no mesh reaches.
#[derive(Clone, Debug, PartialEq)]
pub struct Map {
    pub x0: f64,
    pub z0: f64,
    pub cell: f64,
    pub nx: usize,
    pub nz: usize,
    pub heights: Vec<Option<f64>>,
    pub top: f64,
    pub bottom: f64,
}

/// The map of `triangles` (world metres) at `cell`, or a refusal naming the cells the
/// collection needs when they pass 2,048 a side. `path` is the field a refusal names.
pub fn bake(triangles: &[[V3; 3]], cell: f64, path: &str, id: &str) -> Result<Map, Refusal> {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for t in triangles {
        for p in t {
            lo = [lo[0].min(p[0]), lo[1].min(p[2])];
            hi = [hi[0].max(p[0]), hi[1].max(p[2])];
        }
    }
    if triangles.is_empty() {
        return Err(Refusal::new(
            "ref_unresolved",
            path,
            format!("{id}: land.on holds no mesh to land on"),
        ));
    }
    let side = |a: f64, b: f64| (((b - a) / cell).ceil() as usize).max(1);
    let (nx, nz) = (side(lo[0], hi[0]), side(lo[1], hi[1]));
    if nx > MAX_SIDE || nz > MAX_SIDE {
        return Err(Refusal::new(
            "out_of_range",
            path,
            format!(
                "{id}: land needs {nx} × {nz} = {} cells at {cell} m, past {MAX_SIDE} × {MAX_SIDE}",
                nx * nz
            ),
        ));
    }
    let mut heights: Vec<Option<f64>> = vec![None; nx * nz];
    let raise = |h: &mut Option<f64>, y: f64| {
        if h.is_none_or(|v| y > v) {
            *h = Some(y);
        }
    };
    for t in triangles {
        let (tx0, tx1) = (
            t[0][0].min(t[1][0]).min(t[2][0]),
            t[0][0].max(t[1][0]).max(t[2][0]),
        );
        let (tz0, tz1) = (
            t[0][2].min(t[1][2]).min(t[2][2]),
            t[0][2].max(t[1][2]).max(t[2][2]),
        );
        let cell_of =
            |v: f64, o: f64, n: usize| (((v - o) / cell).floor().max(0.0) as usize).min(n - 1);
        let (i0, i1) = (cell_of(tx0, lo[0], nx), cell_of(tx1, lo[0], nx));
        let (j0, j1) = (cell_of(tz0, lo[1], nz), cell_of(tz1, lo[1], nz));
        for j in j0..=j1 {
            for i in i0..=i1 {
                // The cell's inside: a face that only touches its border (a wall standing on the
                // line between two cells) belongs to neither.
                let e = cell * 1e-9;
                let cx = [
                    lo[0] + i as f64 * cell + e,
                    lo[0] + (i + 1) as f64 * cell - e,
                ];
                let cz = [
                    lo[1] + j as f64 * cell + e,
                    lo[1] + (j + 1) as f64 * cell - e,
                ];
                if let Some(y) = highest_in(t, cx, cz) {
                    raise(&mut heights[j * nx + i], y);
                }
            }
        }
    }
    let known = heights.iter().flatten();
    let top = known.clone().fold(f64::NEG_INFINITY, |a, b| a.max(*b));
    let bottom = known.fold(f64::INFINITY, |a, b| a.min(*b));
    Ok(Map {
        x0: lo[0],
        z0: lo[1],
        cell,
        nx,
        nz,
        heights,
        top,
        bottom,
    })
}

/// The highest point of triangle `t` over the cell `[cx] × [cz]`: the triangle clipped to
/// the cell is a polygon whose highest point is a vertex, a triangle corner inside the cell, a
/// cell corner inside the triangle, or an edge's crossing of the cell's border.
fn highest_in(t: &[V3; 3], cx: [f64; 2], cz: [f64; 2]) -> Option<f64> {
    let inside = |p: &V3| p[0] >= cx[0] && p[0] <= cx[1] && p[2] >= cz[0] && p[2] <= cz[1];
    let mut best: Option<f64> = None;
    let mut take = |y: f64| {
        if best.is_none_or(|b| y > b) {
            best = Some(y);
        }
    };
    for p in t.iter().filter(|p| inside(p)) {
        take(p[1]);
    }
    // Each edge's crossings of the cell's four border lines, where they lie on the border.
    for k in 0..3 {
        let (a, b) = (t[k], t[(k + 1) % 3]);
        for (axis, value) in [(0, cx[0]), (0, cx[1]), (2, cz[0]), (2, cz[1])] {
            let d = b[axis] - a[axis];
            if d == 0.0 {
                continue;
            }
            let s = (value - a[axis]) / d;
            if (0.0..=1.0).contains(&s) {
                let p = [
                    a[0] + (b[0] - a[0]) * s,
                    a[1] + (b[1] - a[1]) * s,
                    a[2] + (b[2] - a[2]) * s,
                ];
                let eps = 1e-12 * (1.0 + value.abs());
                if p[0] >= cx[0] - eps
                    && p[0] <= cx[1] + eps
                    && p[2] >= cz[0] - eps
                    && p[2] <= cz[1] + eps
                {
                    take(p[1]);
                }
            }
        }
    }
    // The cell's corners inside the triangle's projection, at the triangle's plane.
    let (ax, az) = (t[1][0] - t[0][0], t[1][2] - t[0][2]);
    let (bx, bz) = (t[2][0] - t[0][0], t[2][2] - t[0][2]);
    let det = ax * bz - az * bx;
    if det != 0.0 {
        for x in cx {
            for z in cz {
                let (px, pz) = (x - t[0][0], z - t[0][2]);
                let u = (px * bz - pz * bx) / det;
                let v = (ax * pz - az * px) / det;
                if u >= 0.0 && v >= 0.0 && u + v <= 1.0 {
                    take(t[0][1] + u * (t[1][1] - t[0][1]) + v * (t[2][1] - t[0][1]));
                }
            }
        }
    }
    best
}

impl Map {
    fn cell_height(&self, i: usize, j: usize) -> Option<f64> {
        self.heights[j * self.nx + i]
    }

    /// The map's height at (x, z), bilinear between cell centres (stepping across a cliff), and
    /// its slope (∂h/∂x, ∂h/∂z); none outside the map's bounds or where a cell it reads holds no
    /// mesh.
    pub fn height(&self, x: f64, z: f64) -> Option<(f64, [f64; 2])> {
        let (w, d) = (self.nx as f64 * self.cell, self.nz as f64 * self.cell);
        if !(x >= self.x0 && x <= self.x0 + w && z >= self.z0 && z <= self.z0 + d) {
            return None;
        }
        let axis = |v: f64, o: f64, n: usize| -> (usize, usize, f64) {
            let g = ((v - o) / self.cell - 0.5).clamp(0.0, (n - 1) as f64);
            let i0 = (g.floor() as usize).min(n.saturating_sub(2));
            let i1 = (i0 + 1).min(n - 1);
            (i0, i1, g - i0 as f64)
        };
        let (i0, i1, fx) = axis(x, self.x0, self.nx);
        let (j0, j1, fz) = axis(z, self.z0, self.nz);
        let h00 = self.cell_height(i0, j0)?;
        let h10 = self.cell_height(i1, j0)?;
        let h01 = self.cell_height(i0, j1)?;
        let h11 = self.cell_height(i1, j1)?;
        // Across a cliff, corners further apart in height than two cells, the read steps at the
        // midpoint between the centres instead of ramping, so nothing rests in the air beside a
        // wall: it lands on the wall's top or at its foot.
        let low = h00.min(h10).min(h01).min(h11);
        let high = h00.max(h10).max(h01).max(h11);
        if high - low > 2.0 * self.cell {
            let h = match (fx < 0.5, fz < 0.5) {
                (true, true) => h00,
                (false, true) => h10,
                (true, false) => h01,
                (false, false) => h11,
            };
            return Some((h, [0.0, 0.0]));
        }
        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let h = lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
        let span_x = if i1 > i0 { self.cell } else { f64::INFINITY };
        let span_z = if j1 > j0 { self.cell } else { f64::INFINITY };
        let dx = lerp(h10 - h00, h11 - h01, fz) / span_x;
        let dz = lerp(h01 - h00, h11 - h10, fx) / span_z;
        Some((h, [dx, dz]))
    }

    /// The arc's height above the map at age `a`, and its rate; above everything outside.
    fn above(&self, arc: &Arc, a: f64) -> Option<(f64, f64)> {
        let p = arc.at(a);
        let v = arc.vel(a);
        let (h, [dx, dz]) = self.height(p[0], p[2])?;
        Some((p[1] - h, v[1] - dx * v[0] - dz * v[2]))
    }

    fn flat(&self, y: f64) -> Plane {
        Plane {
            normal: [0.0, 1.0, 0.0],
            offset: y,
        }
    }
}

impl Ground for Map {
    fn first_hit(&self, arc: &Arc, hi: f64, on: bool) -> Option<(f64, V3)> {
        // From its start, or from where it falls below the map's highest point.
        let y0 = arc.x0[1];
        let start = if y0 > self.top {
            plane_root(arc, &self.flat(self.top), false, hi)?
        } else {
            0.0
        };
        // To where it would pass the map's lowest point, a little past, or its life's end.
        let floor = self.bottom - 1e-6 * (1.0 + self.bottom.abs());
        let end = plane_root(arc, &self.flat(floor), false, hi).unwrap_or(hi);
        if end <= start {
            return None;
        }
        let step = (end - start) / MARCH as f64;
        let mut prev = start;
        // A particle that starts on the map, having just bounced off it, leaves it first.
        let first = if on && start == 0.0 { 1 } else { 0 };
        for k in first..=MARCH {
            let a = start + step * k as f64;
            let below = self.above(arc, a).is_some_and(|(f, _)| f <= 0.0);
            if !below {
                prev = a;
                continue;
            }
            if k == first {
                return Some((a, self.normal(arc.at(a))));
            }
            let (lo, up) = (prev, a);
            let mut x = up;
            for _ in 0..NEWTON {
                let Some((f, df)) = self.above(arc, x) else {
                    break;
                };
                if f == 0.0 || df == 0.0 {
                    break;
                }
                x = (x - f / df).clamp(lo, up);
            }
            return Some((x, self.normal(arc.at(x))));
        }
        None
    }
}

impl Map {
    /// The map's unit normal at a point over it.
    pub fn normal(&self, p: V3) -> V3 {
        let [dx, dz] = self.height(p[0], p[2]).map_or([0.0; 2], |(_, d)| d);
        let n = [-dx, 1.0, -dz];
        scale(n, 1.0 / len(n))
    }
}
