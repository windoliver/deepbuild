//! Issue #494: keys that travel on arcs and spirals (canvas primitives: Channel and key, `travel`).
//! A key's `travel` moves each point of its segment, a vec2's or vec3's value or each of a path's
//! matched points, on its own arc or spiral instead of the straight line between its two values.
//!
//! Screen space is y-down, so a turn counterclockwise as seen on screen by `a` is
//! `R(a)(x, y) = (x cos a + y sin a, −x sin a + y cos a)`. A positive arc turns that way; a spiral
//! puts a point at `start + u × R((u − 1) × angle)(end − start)`. An arc or a spiral under 0.57°
//! (0.01 rad) is straight, bit for bit.

use deep_canvas::ops::{cos, rad, sin, sqrt};

/// Below this many radians a turn is straight (Channel and key: travel).
pub const STRAIGHT_BELOW: f64 = 0.01;

/// Where a point turns about while it travels (`centers`).
#[derive(Clone, Debug, PartialEq)]
pub enum Centers {
    /// Each point on its own circular arc between its two values.
    None,
    /// Every point turns about one centre, in u, as it moves.
    At([f64; 2]),
    /// Each sub-path's points turn about that sub-path's own centroid as it moves.
    PerPoint,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Travel {
    /// `arc {angle, axis, centers}`, the angle in radians and the axis of unit length.
    Arc { angle: f64, axis: [f64; 3], centers: Centers },
    /// `spiral {angle}`, in radians.
    Spiral { angle: f64 },
}

impl Travel {
    /// The travel a key's `travel` field names; `Err` with the field that is wrong.
    pub fn of(v: &serde_json::Value) -> Result<Option<Travel>, &'static str> {
        use serde_json::Value;
        let (kind, body) = match v {
            Value::String(s) => (s.as_str(), None),
            Value::Object(o) if o.len() == 1 => {
                let (k, b) = o.iter().next().expect("one entry");
                (k.as_str(), Some(b))
            }
            _ => return Err(""),
        };
        let field = |name: &str| body.and_then(|b| b.get(name));
        let angle = || -> Result<f64, &'static str> {
            let a = field("angle").and_then(Value::as_f64).filter(|a| a.is_finite()).ok_or("angle")?;
            // A whole turn has no arc between two points.
            if a.abs() >= 360.0 {
                return Err("angle");
            }
            Ok(rad(a))
        };
        match kind {
            "straight" => Ok(None),
            "spiral" => Ok(Some(Travel::Spiral { angle: angle()? })),
            "arc" => {
                let angle = angle()?;
                let axis = match field("axis") {
                    None => [0.0, 0.0, 1.0],
                    Some(Value::Array(a)) if a.len() == 3 => {
                        let a: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
                        let n = sqrt(a.iter().map(|c| c * c).sum());
                        if a.len() != 3 || !n.is_finite() || n == 0.0 {
                            return Err("axis");
                        }
                        [a[0] / n, a[1] / n, a[2] / n]
                    }
                    Some(_) => return Err("axis"),
                };
                let centers = match field("centers") {
                    None => Centers::None,
                    Some(Value::String(s)) if s == "none" => Centers::None,
                    Some(Value::String(s)) if s == "per_point" => Centers::PerPoint,
                    Some(Value::Array(c)) if c.len() == 2 => match (c[0].as_f64(), c[1].as_f64()) {
                        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Centers::At([x, y]),
                        _ => return Err("centers"),
                    },
                    Some(_) => return Err("centers"),
                };
                Ok(Some(Travel::Arc { angle, axis, centers }))
            }
            _ => Err(""),
        }
    }

    fn angle(&self) -> f64 {
        match self {
            Travel::Arc { angle, .. } | Travel::Spiral { angle } => *angle,
        }
    }

    /// `out` at progress `w` from `a` to `b`, each point `dim` components wide (2 or 3), with
    /// `subs` the point count of each sub-path (a vec is one sub-path of one point). Straight when
    /// the turn is under 0.01 rad.
    pub fn mix(&self, a: &[f64], b: &[f64], w: f64, dim: usize, subs: &[usize], out: &mut [f64]) {
        if self.angle().abs() < STRAIGHT_BELOW || !(2..=3).contains(&dim) {
            for ((o, &va), &vb) in out.iter_mut().zip(a).zip(b) {
                *o = va + (vb - va) * w;
            }
            return;
        }
        let mut start = 0;
        for &n in subs {
            let span = start * dim..(start + n) * dim;
            let centre = match self {
                Travel::Arc { centers: Centers::PerPoint, .. } => {
                    Some((centroid(&a[span.clone()], dim), centroid(&b[span.clone()], dim)))
                }
                Travel::Arc { centers: Centers::At(c), .. } => Some(([c[0], c[1], 0.0], [c[0], c[1], 0.0])),
                _ => None,
            };
            for p in start..start + n {
                let r = p * dim..(p + 1) * dim;
                self.point(&a[r.clone()], &b[r.clone()], w, centre, &mut out[r]);
            }
            start += n;
        }
    }

    /// One point's place at progress `w`.
    fn point(&self, a: &[f64], b: &[f64], w: f64, centre: Option<([f64; 3], [f64; 3])>, out: &mut [f64]) {
        let axis = match self {
            Travel::Arc { axis, .. } => *axis,
            Travel::Spiral { .. } => [0.0, 0.0, 1.0],
        };
        let (pa, sa) = Plane::new(axis).split(a);
        let (pb, sb) = Plane::new(axis).split(b);
        let theta = self.angle();
        let q = match (self, centre) {
            (Travel::Spiral { .. }, _) => {
                let d = [pb[0] - pa[0], pb[1] - pa[1]];
                let r = turn(d, (w - 1.0) * theta);
                [pa[0] + w * r[0], pa[1] + w * r[1]]
            }
            (_, None) => {
                // The centre c with R(θ)(a − c) = b − c: c = (I − R)⁻¹ (b − R a).
                let ra = turn(pa, theta);
                let (cs, sn) = (cos(theta), sin(theta));
                let det = 2.0 * (1.0 - cs);
                let v = [pb[0] - ra[0], pb[1] - ra[1]];
                let c = [((1.0 - cs) * v[0] + sn * v[1]) / det, (-sn * v[0] + (1.0 - cs) * v[1]) / det];
                let r = turn([pa[0] - c[0], pa[1] - c[1]], w * theta);
                [c[0] + r[0], c[1] + r[1]]
            }
            (_, Some((ca, cb))) => {
                // About a centre that moves from `ca` to `cb`: the offsets mixed in the turning frame.
                let plane = Plane::new(axis);
                let (ca, _) = plane.split(&ca[..a.len()]);
                let (cb, _) = plane.split(&cb[..a.len()]);
                let oa = [pa[0] - ca[0], pa[1] - ca[1]];
                let ob = turn([pb[0] - cb[0], pb[1] - cb[1]], -theta);
                let o = turn([oa[0] + (ob[0] - oa[0]) * w, oa[1] + (ob[1] - oa[1]) * w], w * theta);
                [ca[0] + (cb[0] - ca[0]) * w + o[0], ca[1] + (cb[1] - ca[1]) * w + o[1]]
            }
        };
        Plane::new(axis).join(q, sa + (sb - sa) * w, out);
    }
}

/// `R(a)(v)`: a turn counterclockwise as seen on a y-down screen.
fn turn(v: [f64; 2], a: f64) -> [f64; 2] {
    let (c, s) = (cos(a), sin(a));
    [v[0] * c + v[1] * s, -v[0] * s + v[1] * c]
}

fn centroid(points: &[f64], dim: usize) -> [f64; 3] {
    let n = (points.len() / dim).max(1) as f64;
    let mut c = [0.0; 3];
    for p in points.chunks(dim) {
        for (k, v) in p.iter().enumerate() {
            c[k] += v / n;
        }
    }
    c
}

/// The plane a turn happens in: across the axis, with `e1 × e2 = axis`, so a positive turn about
/// the axis reads as counterclockwise on screen for the default axis (0, 0, 1).
struct Plane {
    e1: [f64; 3],
    e2: [f64; 3],
    axis: [f64; 3],
    flat: bool,
}

impl Plane {
    fn new(axis: [f64; 3]) -> Plane {
        if axis == [0.0, 0.0, 1.0] {
            return Plane { e1: [1.0, 0.0, 0.0], e2: [0.0, 1.0, 0.0], axis, flat: true };
        }
        // Any unit vector across the axis, then the one that completes the right-handed frame.
        let seed = if axis[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
        let along = dot(seed, axis);
        let e1 = [seed[0] - along * axis[0], seed[1] - along * axis[1], seed[2] - along * axis[2]];
        let n = sqrt(dot(e1, e1));
        let e1 = [e1[0] / n, e1[1] / n, e1[2] / n];
        let e2 = cross(axis, e1);
        Plane { e1, e2, axis, flat: false }
    }

    /// A point's coordinates in the plane and along the axis.
    fn split(&self, p: &[f64]) -> ([f64; 2], f64) {
        if self.flat {
            return ([p[0], p[1]], p.get(2).copied().unwrap_or(0.0));
        }
        let v = [p[0], p[1], p.get(2).copied().unwrap_or(0.0)];
        ([dot(v, self.e1), dot(v, self.e2)], dot(v, self.axis))
    }

    fn join(&self, q: [f64; 2], s: f64, out: &mut [f64]) {
        if self.flat {
            out[0] = q[0];
            out[1] = q[1];
            if let Some(z) = out.get_mut(2) {
                *z = s;
            }
            return;
        }
        for (k, o) in out.iter_mut().enumerate().take(3) {
            *o = q[0] * self.e1[k] + q[1] * self.e2[k] + s * self.axis[k];
        }
    }
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(t: &Travel, a: &[f64], b: &[f64], w: f64) -> Vec<f64> {
        let mut out = vec![0.0; a.len()];
        t.mix(a, b, w, a.len(), &[1], &mut out);
        out
    }

    #[test]
    fn arcs_turn_counterclockwise_on_a_y_down_screen() {
        let half = Travel::Arc { angle: rad(180.0), axis: [0.0, 0.0, 1.0], centers: Centers::None };
        let p = at(&half, &[-2.0, 0.0], &[2.0, 0.0], 0.5);
        assert!((p[0]).abs() < 1e-9 && (p[1] - 2.0).abs() < 1e-9, "{p:?}");
        let back = Travel::Arc { angle: rad(-180.0), axis: [0.0, 0.0, 1.0], centers: Centers::None };
        let p = at(&back, &[-2.0, 0.0], &[2.0, 0.0], 0.5);
        assert!((p[0]).abs() < 1e-9 && (p[1] + 2.0).abs() < 1e-9, "{p:?}");
        let ends = at(&half, &[-2.0, 0.0], &[2.0, 0.0], 1.0);
        assert!((ends[0] - 2.0).abs() < 1e-12 && ends[1].abs() < 1e-12);
    }

    #[test]
    fn a_spiral_is_scaled_and_turned_back() {
        let s = Travel::Spiral { angle: rad(90.0) };
        let p = at(&s, &[0.0, 0.0], &[100.0, 0.0], 0.5);
        let e = turn([100.0, 0.0], rad(-45.0));
        assert!((p[0] - 0.5 * e[0]).abs() < 1e-9 && (p[1] - 0.5 * e[1]).abs() < 1e-9, "{p:?} vs {e:?}");
    }

    #[test]
    fn under_a_hundredth_of_a_radian_is_straight_bit_for_bit() {
        let s = Travel::Arc { angle: rad(0.5), axis: [0.0, 0.0, 1.0], centers: Centers::None };
        let (a, b) = ([-2.0, 0.3], [2.0, 0.7]);
        for w in [0.1, 0.37, 0.5, 0.9] {
            let p = at(&s, &a, &b, w);
            assert_eq!(p, vec![a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
        }
    }

    #[test]
    fn a_tilted_axis_keeps_the_arc_in_its_plane() {
        let t = Travel::Arc { angle: rad(180.0), axis: [1.0, 0.0, 0.0], centers: Centers::None };
        let p = at(&t, &[0.0, -2.0, 0.0], &[0.0, 2.0, 0.0], 0.5);
        assert!(p[0].abs() < 1e-9 && p[1].abs() < 1e-9 && (p[2].abs() - 2.0).abs() < 1e-9, "{p:?}");
    }
}
