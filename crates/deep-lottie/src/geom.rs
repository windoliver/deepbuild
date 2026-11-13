//! Lottie's shapes as Bézier sub-paths, by the Lottie spec's rendering algorithms (rectangle,
//! ellipse, polystar), and what the import reads off them: an SVG path string, the box of their
//! points, an axis-aligned rectangle, and a curve flattened for a path followed by arc length.

use deep_canvas::ops;

use crate::read::Bez;

/// The spec's cubic approximation of an elliptical quadrant.
pub const KAPPA: f64 = 0.551_915_024_493_510_6;

/// A number as a path string writes it: the shortest text that reads back to it, never `-0`.
pub fn fmt(x: f64) -> String {
    let x = if x == 0.0 { 0.0 } else { x };
    format!("{x}")
}

impl Bez {
    fn add(&mut self, v: [f64; 2], i: [f64; 2], o: [f64; 2]) {
        self.v.push(v);
        self.i.push(i);
        self.o.push(o);
    }

    /// The sub-path as SVG path verbs: `M`, then `L` for a straight segment and `C` for a curved
    /// one, then `Z` when it closes.
    pub fn d(&self, out: &mut String) {
        let n = self.v.len();
        if n == 0 {
            return;
        }
        let p = |q: [f64; 2]| format!("{} {}", fmt(q[0]), fmt(q[1]));
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&format!("M {}", p(self.v[0])));
        let segments = if self.closed { n } else { n - 1 };
        for s in 0..segments {
            let (a, b) = (s, (s + 1) % n);
            let (c1, c2) = (self.out_point(a), self.in_point(b));
            if c1 == self.v[a] && c2 == self.v[b] {
                // A closing side that is straight is the one `Z` draws.
                if !(self.closed && b == 0) {
                    out.push_str(&format!(" L {}", p(self.v[b])));
                }
            } else {
                out.push_str(&format!(" C {} {} {}", p(c1), p(c2), p(self.v[b])));
            }
        }
        if self.closed {
            out.push_str(" Z");
        }
    }

    pub fn out_point(&self, k: usize) -> [f64; 2] {
        [self.v[k][0] + self.o[k][0], self.v[k][1] + self.o[k][1]]
    }

    pub fn in_point(&self, k: usize) -> [f64; 2] {
        [self.v[k][0] + self.i[k][0], self.v[k][1] + self.i[k][1]]
    }

    /// The box `[x, y, w, h]` of its vertices and control points, as a path's gradient reads it.
    pub fn bounds(&self, b: &mut [f64; 4]) {
        for k in 0..self.v.len() {
            for q in [self.v[k], self.in_point(k), self.out_point(k)] {
                b[0] = b[0].min(q[0]);
                b[1] = b[1].min(q[1]);
                b[2] = b[2].max(q[0]);
                b[3] = b[3].max(q[1]);
            }
        }
    }

    /// The box `[x, y, w, h]` it draws when it is a closed axis-aligned rectangle with straight
    /// sides, as a rect mask holds it.
    pub fn rect(&self) -> Option<[f64; 4]> {
        let straight = self.i.iter().chain(&self.o).all(|t| *t == [0.0, 0.0]);
        if !self.closed || self.v.len() != 4 || !straight {
            return None;
        }
        let xs: Vec<f64> = self.v.iter().map(|v| v[0]).collect();
        let ys: Vec<f64> = self.v.iter().map(|v| v[1]).collect();
        let (x0, x1) = (
            xs.iter().copied().fold(f64::INFINITY, f64::min),
            xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        let (y0, y1) = (
            ys.iter().copied().fold(f64::INFINITY, f64::min),
            ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        );
        // Each side runs along one axis: consecutive vertices share an x or a y.
        let sides = (0..4).all(|k| {
            let (a, b) = (self.v[k], self.v[(k + 1) % 4]);
            (a[0] == b[0] && a[1] != b[1]) || (a[1] == b[1] && a[0] != b[0])
        });
        let corners = self
            .v
            .iter()
            .all(|v| (v[0] == x0 || v[0] == x1) && (v[1] == y0 || v[1] == y1));
        (sides && corners).then_some([x0, y0, x1 - x0, y1 - y0])
    }
}

/// Every sub-path as one SVG path string.
pub fn d_of(subs: &[Bez]) -> String {
    let mut d = String::new();
    for s in subs {
        s.d(&mut d);
    }
    d
}

/// A path key's string: its shape's, or, for a shape whose points all meet (which a path
/// channel can't match), the same point with a segment a thousandth of a unit long.
pub fn key_d(b: &Bez) -> String {
    let d = d_of(std::slice::from_ref(b));
    if deep_canvas_motion::morph::of_d(&d).is_some() {
        return d;
    }
    let p = b.v.first().copied().unwrap_or([0.0, 0.0]);
    format!(
        "M {} {} L {} {}",
        fmt(p[0]),
        fmt(p[1]),
        fmt(p[0] + 1e-3),
        fmt(p[1])
    )
}

/// The box of all sub-paths' points, `[x, y, w, h]`; zero for no points.
pub fn bounds_of(subs: &[Bez]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for s in subs {
        s.bounds(&mut b);
    }
    if b[0] > b[2] {
        return [0.0; 4];
    }
    [b[0], b[1], b[2] - b[0], b[3] - b[1]]
}

/// The spec's rectangle: from the top right, clockwise, its corners rounded by `r`.
pub fn rect(p: [f64; 2], s: [f64; 2], r: f64) -> Bez {
    let (left, right, top, bottom) = (
        p[0] - s[0] / 2.0,
        p[0] + s[0] / 2.0,
        p[1] - s[1] / 2.0,
        p[1] + s[1] / 2.0,
    );
    let mut b = Bez {
        closed: true,
        ..Bez::default()
    };
    let z = [0.0, 0.0];
    if r <= 0.0 {
        for v in [[right, top], [right, bottom], [left, bottom], [left, top]] {
            b.add(v, z, z);
        }
        return b;
    }
    let r = r.min(s[0] / 2.0).min(s[1] / 2.0);
    let t = r * KAPPA;
    b.add([right, top + r], [0.0, -t], z);
    b.add([right, bottom - r], z, [0.0, t]);
    b.add([right - r, bottom], [t, 0.0], z);
    b.add([left + r, bottom], z, [-t, 0.0]);
    b.add([left, bottom - r], [0.0, t], z);
    b.add([left, top + r], z, [0.0, -t]);
    b.add([left + r, top], [-t, 0.0], z);
    b.add([right - r, top], z, [t, 0.0]);
    b
}

/// The spec's ellipse: from its top point, clockwise.
pub fn ellipse(p: [f64; 2], s: [f64; 2]) -> Bez {
    let (rx, ry) = (s[0] / 2.0, s[1] / 2.0);
    let (tx, ty) = (rx * KAPPA, ry * KAPPA);
    let mut b = Bez {
        closed: true,
        ..Bez::default()
    };
    b.add([p[0], p[1] - ry], [-tx, 0.0], [tx, 0.0]);
    b.add([p[0] + rx, p[1]], [0.0, -ty], [0.0, ty]);
    b.add([p[0], p[1] + ry], [tx, 0.0], [-tx, 0.0]);
    b.add([p[0] - rx, p[1]], [0.0, ty], [0.0, -ty]);
    b
}

/// A polystar's fields, as the spec names them.
#[derive(Clone, Copy, Debug)]
pub struct Star {
    pub p: [f64; 2],
    pub points: f64,
    pub r: f64,
    pub or: f64,
    pub os: f64,
    pub ir: f64,
    pub is: f64,
    pub star: bool,
}

/// The spec's polystar.
pub fn star(s: &Star) -> Bez {
    let points = s.points.round().max(1.0) as usize;
    let alpha = -s.r * std::f64::consts::PI / 180.0 - std::f64::consts::PI / 2.0;
    let theta = -std::f64::consts::PI / points as f64;
    let tan_out = (2.0 * std::f64::consts::PI * s.or) / (4.0 * points as f64) * (s.os / 100.0);
    let tan_in = (2.0 * std::f64::consts::PI * s.ir) / (4.0 * points as f64) * (s.is / 100.0);
    let mut b = Bez {
        closed: true,
        ..Bez::default()
    };
    let z = [0.0, 0.0];
    for k in 0..points {
        let beta = alpha + k as f64 * theta * 2.0;
        let v = [s.or * ops::cos(beta), s.or * ops::sin(beta)];
        let (i, o) = if s.os != 0.0 && s.or != 0.0 {
            let t = [v[0] * tan_out / s.or, v[1] * tan_out / s.or];
            ([-t[1], t[0]], [t[1], -t[0]])
        } else {
            (z, z)
        };
        b.add([s.p[0] + v[0], s.p[1] + v[1]], i, o);
        if s.star {
            let w = [s.ir * ops::cos(beta + theta), s.ir * ops::sin(beta + theta)];
            let (i, o) = if s.is != 0.0 && s.ir != 0.0 {
                let t = [w[0] * tan_in / s.ir, w[1] * tan_in / s.ir];
                ([-t[1], t[0]], [t[1], -t[0]])
            } else {
                (z, z)
            };
            b.add([s.p[0] + w[0], s.p[1] + w[1]], i, o);
        }
    }
    b
}

fn lerp(a: [f64; 2], b: [f64; 2], u: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

/// The cubic `p` flattened into points after its first, each chord within `tol` of the curve, by
/// halving at a fixed depth bound, so the same curve always gives the same points.
pub fn flatten(p: [[f64; 2]; 4], tol: f64, out: &mut Vec<[f64; 2]>) {
    fn go(p: [[f64; 2]; 4], tol: f64, depth: u32, out: &mut Vec<[f64; 2]>) {
        let (dx, dy) = (p[3][0] - p[0][0], p[3][1] - p[0][1]);
        let len = ops::hypot(dx, dy);
        let off = |q: [f64; 2]| {
            if len > 0.0 {
                ((q[0] - p[0][0]) * dy - (q[1] - p[0][1]) * dx).abs() / len
            } else {
                ops::hypot(q[0] - p[0][0], q[1] - p[0][1])
            }
        };
        if depth >= 18 || off(p[1]).max(off(p[2])) <= tol {
            out.push(p[3]);
            return;
        }
        let (ab, bc, cd) = (
            lerp(p[0], p[1], 0.5),
            lerp(p[1], p[2], 0.5),
            lerp(p[2], p[3], 0.5),
        );
        let (abc, bcd) = (lerp(ab, bc, 0.5), lerp(bc, cd, 0.5));
        let mid = lerp(abc, bcd, 0.5);
        go([p[0], ab, abc, mid], tol, depth + 1, out);
        go([mid, bcd, cd, p[3]], tol, depth + 1, out);
    }
    go(p, tol, 0, out);
}

/// The length of a polyline.
pub fn length(points: &[[f64; 2]]) -> f64 {
    points
        .windows(2)
        .map(|w| ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_straight_square_reads_as_its_box_and_a_curved_one_does_not() {
        let sq = rect([50.0, 40.0], [20.0, 10.0], 0.0);
        assert_eq!(sq.rect(), Some([40.0, 35.0, 20.0, 10.0]));
        assert_eq!(rect([50.0, 40.0], [20.0, 10.0], 2.0).rect(), None);
        assert_eq!(ellipse([0.0, 0.0], [10.0, 10.0]).rect(), None);
    }

    #[test]
    fn a_path_string_writes_lines_and_curves() {
        let d = d_of(&[rect([5.0, 5.0], [10.0, 10.0], 0.0)]);
        assert_eq!(d, "M 10 0 L 10 10 L 0 10 L 0 0 Z");
        let e = d_of(&[ellipse([0.0, 0.0], [2.0, 2.0])]);
        assert!(e.starts_with("M 0 -1 C ") && e.ends_with(" Z"), "{e}");
    }

    #[test]
    fn a_flattened_quarter_circle_keeps_its_length() {
        let mut pts = vec![[1.0, 0.0]];
        flatten(
            [[1.0, 0.0], [1.0, KAPPA], [KAPPA, 1.0], [0.0, 1.0]],
            1e-4,
            &mut pts,
        );
        let quarter = std::f64::consts::PI / 2.0;
        assert!((length(&pts) - quarter).abs() < 1e-3, "{}", length(&pts));
    }
}
