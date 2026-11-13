//! Issue #2014: a terrain plate's surface as the geometry audit, `rest_on`, a scatter's projection
//! and height queries read it (canvas primitives: Builder plate: terrain). Heights on a grid, each
//! cell split along the diagonal from its (column, row + 1) corner to its (column + 1, row) one,
//! the split the drawn plate and the physics height field use, so all of them agree everywhere on
//! a cell and not only at its samples; everything under the surface, within the plate's
//! rectangle, is solid. All math is f64 on the CPU.

use crate::geometry_audit::{Shape, V3};
use crate::ops::sqrt;

/// A plate's heights placed in the world.
#[derive(Clone, Debug, PartialEq)]
pub struct Heights {
    /// Where the plate's centre at height 0 lies.
    pub centre: V3,
    /// Its extent along X and Z, metres.
    pub size: [f64; 2],
    /// Samples along X and along Z, each at least 2.
    pub cols: usize,
    pub rows: usize,
    /// Row by row, a row along +X and rows along +Z, metres above `centre`.
    pub h: Vec<f64>,
    low: f64,
    high: f64,
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
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
fn unit(a: V3) -> Option<V3> {
    let l = len(a);
    (l > 1e-300).then(|| [a[0] / l, a[1] / l, a[2] / l])
}
fn lerp(a: V3, b: V3, t: f64) -> V3 {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// The point of triangle `t` closest to `p` (Ericson, Real-Time Collision Detection 5.1.5).
fn closest_on_triangle(p: V3, t: &[V3; 3]) -> V3 {
    let [a, b, c] = *t;
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let (d3, d4) = (dot(ab, bp), dot(ac, bp));
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return lerp(a, b, d1 / (d1 - d3));
    }
    let cp = sub(p, c);
    let (d5, d6) = (dot(ab, cp), dot(ac, cp));
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return lerp(a, c, d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return lerp(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let den = 1.0 / (va + vb + vc);
    let (v, w) = (vb * den, vc * den);
    [
        a[0] + ab[0] * v + ac[0] * w,
        a[1] + ab[1] * v + ac[1] * w,
        a[2] + ab[2] * v + ac[2] * w,
    ]
}

/// The height of triangle `t`'s plane at (x, z), and whether (x, z) lies in its footprint.
fn over(t: &[V3; 3], x: f64, z: f64) -> (f64, bool) {
    let [a, b, c] = *t;
    let det = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    let u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / det;
    let v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / det;
    let y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
    (y, u >= 0.0 && v >= 0.0 && u + v <= 1.0)
}

/// The signed distance from `p` to the solid under triangle `t` (its prism down to −∞): negative
/// inside. The boundary is the triangle and the three walls under its edges; a wall's point
/// nearest `p` lies level with `p`, under the edge, when `p` is no higher than the edge there.
fn prism_sdf(p: V3, t: &[V3; 3]) -> f64 {
    let mut d = len(sub(p, closest_on_triangle(p, t)));
    for k in 0..3 {
        let (a, b) = (t[k], t[(k + 1) % 3]);
        let (ex, ez) = (b[0] - a[0], b[2] - a[2]);
        let l = ex * ex + ez * ez;
        let s = if l > 0.0 {
            (((p[0] - a[0]) * ex + (p[2] - a[2]) * ez) / l).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let q = lerp(a, b, s);
        if p[1] <= q[1] {
            d = d.min(sqrt(
                (p[0] - q[0]) * (p[0] - q[0]) + (p[2] - q[2]) * (p[2] - q[2]),
            ));
        }
    }
    let (y, inside) = over(t, p[0], p[2]);
    if inside && p[1] < y {
        -d
    } else {
        d
    }
}

/// The least of `f` over [0, 1], where `f` is convex: a golden-section search.
fn least(f: impl Fn(f64) -> f64) -> f64 {
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for _ in 0..80 {
        let m1 = lo + (hi - lo) * 0.381_966_011_250_105;
        let m2 = hi - (hi - lo) * 0.381_966_011_250_105;
        if f(m1) <= f(m2) {
            hi = m2;
        } else {
            lo = m1;
        }
    }
    f(0.0).min(f(1.0)).min(f((lo + hi) / 2.0))
}

/// How far `x` passes into the solid under triangle `t`, down to `floor`: exact for a ball and a
/// capsule; for a box the least overlap over the separating axes, whose negative bounds the gap
/// from below.
fn prism_depth(x: &Shape, t: &[V3; 3], floor: f64) -> f64 {
    match x {
        Shape::Ball { c, r } => r - prism_sdf(*c, t),
        Shape::Capsule { a, b, r } => r - least(|s| prism_sdf(lerp(*a, *b, s), t)),
        Shape::Obb { c, axes, half } => {
            let mut boxed = Vec::with_capacity(8);
            for k in 0..8 {
                let s = |j: usize| if k >> j & 1 == 1 { half[j] } else { -half[j] };
                boxed.push(
                    [0, 1, 2]
                        .map(|i| c[i] + axes[0][i] * s(0) + axes[1][i] * s(1) + axes[2][i] * s(2)),
                );
            }
            let mut prism: Vec<V3> = t.to_vec();
            prism.extend(t.iter().map(|q| [q[0], floor, q[2]]));
            let up = [0.0, 1.0, 0.0];
            let edges = [sub(t[1], t[0]), sub(t[2], t[1]), sub(t[0], t[2]), up];
            let mut normals: Vec<V3> = axes.to_vec();
            normals.extend(unit(cross(edges[0], edges[1])));
            normals.extend(edges[..3].iter().filter_map(|e| unit(cross(*e, up))));
            normals.push(up);
            for a in axes {
                normals.extend(edges.iter().filter_map(|e| unit(cross(*a, *e))));
            }
            let span = |pts: &[V3], l: V3| {
                pts.iter()
                    .map(|q| dot(*q, l))
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
                        (lo.min(x), hi.max(x))
                    })
            };
            normals
                .iter()
                .map(|l| {
                    let ((alo, ahi), (blo, bhi)) = (span(&boxed, *l), span(&prism, *l));
                    (ahi - blo).min(bhi - alo)
                })
                .fold(f64::INFINITY, f64::min)
        }
        Shape::Heights(_) => f64::NEG_INFINITY,
    }
}

impl Heights {
    /// Heights `h` (row by row) of a plate `size` m across with `cols` × `rows` samples, its
    /// centre at `centre`; `None` unless there are at least 2 × 2 samples, `h` holds them all and
    /// every one is finite.
    pub fn new(
        centre: V3,
        size: [f64; 2],
        cols: usize,
        rows: usize,
        h: Vec<f64>,
    ) -> Option<Heights> {
        if cols < 2 || rows < 2 || h.len() != cols * rows || h.iter().any(|x| !x.is_finite()) {
            return None;
        }
        let low = h.iter().copied().fold(f64::INFINITY, f64::min);
        let high = h.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        Some(Heights {
            centre,
            size,
            cols,
            rows,
            h,
            low,
            high,
        })
    }

    /// Sample (`c`, `r`) in the plate's own space: a builder's vertex, before its placement.
    pub fn local(size: [f64; 2], cols: usize, rows: usize, c: usize, r: usize, h: f64) -> V3 {
        [
            size[0] * (c as f64 / (cols - 1) as f64 - 0.5),
            h,
            size[1] * (r as f64 / (rows - 1) as f64 - 0.5),
        ]
    }

    /// Sample (`c`, `r`) in the world.
    pub fn at(&self, c: usize, r: usize) -> V3 {
        let q = Heights::local(
            self.size,
            self.cols,
            self.rows,
            c,
            r,
            self.h[r * self.cols + c],
        );
        [
            q[0] + self.centre[0],
            q[1] + self.centre[1],
            q[2] + self.centre[2],
        ]
    }

    /// Cell (`c`, `r`)'s two triangles, split along the diagonal from its (c, r + 1) corner to
    /// its (c + 1, r) one, each wound to face +Y; `other_diagonal` splits it from (c, r) to
    /// (c + 1, r + 1) instead (#2014's planted builder).
    pub fn cell(&self, c: usize, r: usize, other_diagonal: bool) -> [[V3; 3]; 2] {
        let (p00, p01, p10, p11) = (
            self.at(c, r),
            self.at(c, r + 1),
            self.at(c + 1, r),
            self.at(c + 1, r + 1),
        );
        if other_diagonal {
            [[p00, p01, p11], [p00, p11, p10]]
        } else {
            [[p00, p01, p10], [p01, p11, p10]]
        }
    }

    /// The cell whose rectangle holds (x, z), a point on a shared edge in the lower cell; `None`
    /// outside the plate.
    pub fn cell_at(&self, x: f64, z: f64) -> Option<(usize, usize)> {
        let (u, v) = self.grid(x, z);
        let (nc, nr) = ((self.cols - 1) as f64, (self.rows - 1) as f64);
        if !(0.0..=nc).contains(&u) || !(0.0..=nr).contains(&v) {
            return None;
        }
        Some((
            (u.floor() as usize).min(self.cols - 2),
            (v.floor() as usize).min(self.rows - 2),
        ))
    }

    /// (x, z) in cell units from the plate's −X, −Z corner.
    fn grid(&self, x: f64, z: f64) -> (f64, f64) {
        let (nc, nr) = ((self.cols - 1) as f64, (self.rows - 1) as f64);
        (
            ((x - self.centre[0]) / self.size[0] + 0.5) * nc,
            ((z - self.centre[2]) / self.size[1] + 0.5) * nr,
        )
    }

    /// The surface's height at (x, z) in the world, on the cell's triangle that holds it; `None`
    /// outside the plate.
    pub fn height(&self, x: f64, z: f64) -> Option<f64> {
        let (c, r) = self.cell_at(x, z)?;
        let tris = self.cell(c, r, false);
        let (y0, in0) = over(&tris[0], x, z);
        Some(if in0 { y0 } else { over(&tris[1], x, z).0 })
    }

    /// Its world bounds: the plate's rectangle from its lowest sample to its highest.
    pub fn aabb(&self) -> [V3; 2] {
        let (hx, hz) = (self.size[0] / 2.0, self.size[1] / 2.0);
        let c = self.centre;
        [
            [c[0] - hx, c[1] + self.low, c[2] - hz],
            [c[0] + hx, c[1] + self.high, c[2] + hz],
        ]
    }

    /// The same surface moved by `d`.
    pub fn moved(&self, d: V3) -> Heights {
        let mut out = self.clone();
        out.centre = [
            self.centre[0] + d[0],
            self.centre[1] + d[1],
            self.centre[2] + d[2],
        ];
        out
    }

    /// The cells whose rectangles come within `m` of [`lo`, `hi`] in X and Z: the ranges of
    /// columns and rows, `None` when none does.
    fn near(&self, lo: V3, hi: V3, m: f64) -> Option<([usize; 2], [usize; 2])> {
        let (u0, v0) = self.grid(lo[0] - m, lo[2] - m);
        let (u1, v1) = self.grid(hi[0] + m, hi[2] + m);
        let (nc, nr) = ((self.cols - 1) as f64, (self.rows - 1) as f64);
        if u1 < 0.0 || v1 < 0.0 || u0 > nc || v0 > nr {
            return None;
        }
        let c = [
            u0.max(0.0).floor() as usize,
            (u1.min(nc).floor() as usize).min(self.cols - 2),
        ];
        let r = [
            v0.max(0.0).floor() as usize,
            (v1.min(nr).floor() as usize).min(self.rows - 2),
        ];
        Some((c, r))
    }

    /// The deepest `x` passes into the solid under the cells within `m` of its bounds.
    fn near_depth(&self, x: &Shape, m: f64) -> Option<f64> {
        let [lo, hi] = x.aabb();
        let (cs, rs) = self.near(lo, hi, m)?;
        let floor = self.centre[1] + self.low.min(lo[1] - self.centre[1]) - 1.0;
        let mut deepest = f64::NEG_INFINITY;
        for r in rs[0]..=rs[1] {
            for c in cs[0]..=cs[1] {
                for t in self.cell(c, r, false) {
                    deepest = deepest.max(prism_depth(x, &t, floor));
                }
            }
        }
        Some(deepest)
    }

    /// How far `x` passes into the solid under the surface: positive is the depth, negative a
    /// gap no wider than the true one. Only cells near `x` are read: those further than `m` lie
    /// at least `m` away, so where the nearest is further, the window widens to it once.
    pub fn depth(&self, x: &Shape) -> f64 {
        let m = (self.size[0] / (self.cols - 1) as f64).max(self.size[1] / (self.rows - 1) as f64);
        match self.near_depth(x, m) {
            Some(d) if d >= -m => d,
            Some(d) => self.near_depth(x, -d).map_or(d, |w| w.max(d)),
            None => {
                let ([lo, hi], [plo, phi]) = (x.aabb(), self.aabb());
                let gx = (plo[0] - hi[0]).max(lo[0] - phi[0]).max(0.0);
                let gz = (plo[2] - hi[2]).max(lo[2] - phi[2]).max(0.0);
                -m.max(sqrt(gx * gx + gz * gz))
            }
        }
    }

    /// Where the ray from `o` along the unit `d` first meets the surface from above or below:
    /// how far, and the surface's unit normal there, facing +Y.
    pub fn ray(&self, o: V3, d: V3) -> Option<(f64, V3)> {
        let [lo, hi] = self.aabb();
        // The ray's span within the plate's box.
        let (mut t0, mut t1) = (0.0f64, f64::INFINITY);
        for k in 0..3 {
            if d[k].abs() < 1e-300 {
                if o[k] < lo[k] || o[k] > hi[k] {
                    return None;
                }
                continue;
            }
            let (a, b) = ((lo[k] - o[k]) / d[k], (hi[k] - o[k]) / d[k]);
            t0 = t0.max(a.min(b));
            t1 = t1.min(a.max(b));
        }
        if t0 > t1 {
            return None;
        }
        let at = |t: f64| [o[0] + d[0] * t, o[2] + d[2] * t];
        let ([ax, az], [bx, bz]) = (at(t0), at(t1));
        let (ga, gb) = (self.grid(ax, az), self.grid(bx, bz));
        // The cells under the span's footprint in X and Z: a ray over a few cells reads only
        // those.
        let (nc, nr) = ((self.cols - 2) as f64, (self.rows - 2) as f64);
        let cs = [
            ga.0.min(gb.0).floor().clamp(0.0, nc) as usize,
            ga.0.max(gb.0).floor().clamp(0.0, nc) as usize,
        ];
        let rs = [
            ga.1.min(gb.1).floor().clamp(0.0, nr) as usize,
            ga.1.max(gb.1).floor().clamp(0.0, nr) as usize,
        ];
        let mut best: Option<(f64, V3)> = None;
        for r in rs[0]..=rs[1] {
            for c in cs[0]..=cs[1] {
                for t in self.cell(c, r, false) {
                    let Some(k) = meet(o, d, &t) else { continue };
                    if best.is_none_or(|(b, _)| k < b) {
                        best = unit(cross(sub(t[1], t[0]), sub(t[2], t[0])))
                            .map(|n| (k, if n[1] < 0.0 { n.map(|x| -x) } else { n }));
                    }
                }
            }
        }
        best
    }
}

/// How far along `d` the ray from `o` meets triangle `t`, either face, from `o` on
/// (Möller–Trumbore).
pub fn meet(o: V3, d: V3, t: &[V3; 3]) -> Option<f64> {
    let (e1, e2) = (sub(t[1], t[0]), sub(t[2], t[0]));
    let p = cross(d, e2);
    let det = dot(e1, p);
    if det == 0.0 {
        return None;
    }
    let s = sub(o, t[0]);
    let u = dot(s, p) / det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(d, q) / det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let k = dot(e2, q) / det;
    (k >= 0.0).then_some(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One 1 × 1 m cell centred on the origin, corner heights `h` row by row.
    fn cell(h: [f64; 4]) -> Heights {
        Heights::new([0.0; 3], [1.0, 1.0], 2, 2, h.to_vec()).unwrap()
    }

    #[test]
    fn a_cell_splits_along_one_diagonal_and_its_centre_lies_on_it() {
        // (c, r): (0, 0) 0, (1, 0) 0, (0, 1) 0, (1, 1) 1. The diagonal runs (0, 1)–(1, 0), so
        // the centre sits at 0, and the other split would put it at 0.5.
        let s = cell([0.0, 0.0, 0.0, 1.0]);
        assert_eq!(s.height(0.0, 0.0), Some(0.0));
        assert_eq!(s.height(0.5, 0.5), Some(1.0));
        assert_eq!(s.height(0.25, 0.25), Some(0.5));
        let other = s.cell(0, 0, true);
        assert_eq!(over(&other[0], 0.0, 0.0).0, 0.5);
        // The (0, 0) corner raised instead: the centre is on neither raised corner's diagonal.
        let s = cell([1.0, 0.0, 0.0, 0.0]);
        assert_eq!(s.height(0.0, 0.0), Some(0.0));
        assert_eq!(s.height(5.0, 0.0), None);
    }

    #[test]
    fn a_ball_rests_on_the_surface_and_a_sunk_one_is_deep() {
        let s = cell([0.0, 0.0, 0.0, 0.0]);
        let ball = |y: f64| Shape::Ball {
            c: [0.1, y, 0.2],
            r: 0.25,
        };
        assert!((s.depth(&ball(0.25))).abs() < 1e-12);
        assert!((s.depth(&ball(1.25)) + 1.0).abs() < 1e-12);
        assert!((s.depth(&ball(0.0)) - 0.25).abs() < 1e-12);
        // A box resting flat across the diagonal touches, and one 0.1 m down is 0.1 m deep.
        let boxed = |y: f64| Shape::Obb {
            c: [0.0, y, 0.0],
            axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            half: [0.2; 3],
        };
        assert!(s.depth(&boxed(0.2)).abs() < 1e-12);
        assert!((s.depth(&boxed(0.1)) - 0.1).abs() < 1e-12);
        // Far above, the gap read is never wider than the true one.
        assert!(s.depth(&boxed(50.2)) >= -50.0 - 1e-9);
    }

    #[test]
    fn a_ray_down_meets_the_surface_on_the_split() {
        let s = cell([0.0, 0.0, 0.0, 1.0]);
        let (k, n) = s.ray([0.0, 10.0, 0.0], [0.0, -1.0, 0.0]).unwrap();
        assert!((k - 10.0).abs() < 1e-12);
        assert!(n[1] > 0.0);
        assert_eq!(s.ray([3.0, 10.0, 0.0], [0.0, -1.0, 0.0]), None);
    }
}
