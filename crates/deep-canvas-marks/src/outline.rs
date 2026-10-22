//! The outlines R2 adds to marks2d (canvas primitives: Star `star@1`; Circle `circle@1`): stars and
//! regular polygons as closed paths, and arcs as sectors, ring sectors or open strokes.
//!
//! Angles are in degrees, clockwise on screen from +x (y runs down), so −90° is straight up.

use deep_canvas::ops;

use crate::path::Verb;
use crate::scene::Refused;

/// The most vertices a star has (Star: "exceed 200 vertices" it can never).
pub const MAX_STAR_VERTICES: usize = 200;

fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

fn at(center: [f64; 2], r: f64, degrees: f64) -> [f64; 2] {
    let a = ops::rad(degrees);
    [center[0] + r * ops::cos(a), center[1] + r * ops::sin(a)]
}

fn lerp(a: [f64; 2], b: [f64; 2], s: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]
}

/// A star's params, read from `star@1`.
#[derive(Clone, Debug, PartialEq)]
pub struct Star {
    pub center: [f64; 2],
    pub points: f64,
    pub outer_r: f64,
    pub inner_r: f64,
    pub outer_round: f64,
    pub inner_round: f64,
    pub polygon: bool,
}

impl Star {
    /// The closed path: ⌈points⌉ × 2 vertices 180° ÷ points apart, outer and inner in turn, or
    /// ⌈points⌉ corners 360° ÷ points apart for a polygon, starting straight up from the center, so
    /// a fractional count closes on a partial spike. A rounded vertex becomes a cubic whose handles
    /// reach `round` of the way along its edges.
    pub fn verbs(&self, path: &str) -> Result<Vec<Verb>, Refused> {
        if !(3.0..=100.0).contains(&self.points) {
            return refuse("out_of_range", format!("{path}/points"));
        }
        if self.polygon && (self.inner_r != 0.0 || self.inner_round != 0.0) {
            let field = if self.inner_r != 0.0 {
                "inner_r"
            } else {
                "inner_round"
            };
            return refuse("out_of_range", format!("{path}/{field}"));
        }
        for (v, field) in [
            (self.outer_round, "outer_round"),
            (self.inner_round, "inner_round"),
        ] {
            if !(0.0..=1.0).contains(&v) {
                return refuse("out_of_range", format!("{path}/{field}"));
            }
        }
        let whole = self.points.ceil() as usize;
        let (count, step) = if self.polygon {
            (whole, 360.0 / self.points)
        } else {
            (whole * 2, 180.0 / self.points)
        };
        if count > MAX_STAR_VERTICES {
            return refuse("out_of_range", format!("{path}/points"));
        }
        let outer = |k: usize| self.polygon || k.is_multiple_of(2);
        let vertices: Vec<[f64; 2]> = (0..count)
            .map(|k| {
                let r = if outer(k) { self.outer_r } else { self.inner_r };
                at(self.center, r, -90.0 + step * k as f64)
            })
            .collect();
        let mut verbs = Vec::with_capacity(count * 2 + 1);
        for (k, v) in vertices.iter().enumerate() {
            let round = if outer(k) {
                self.outer_round
            } else {
                self.inner_round
            };
            let prev = vertices[(k + count - 1) % count];
            let next = vertices[(k + 1) % count];
            if round == 0.0 {
                verbs.push(if k == 0 {
                    Verb::Move(*v)
                } else {
                    Verb::Line(*v)
                });
                continue;
            }
            let (a, b) = (lerp(*v, prev, round / 2.0), lerp(*v, next, round / 2.0));
            verbs.push(if k == 0 { Verb::Move(a) } else { Verb::Line(a) });
            // The quarter-circle constant, so a full roundness on a square reads as a circle.
            let kappa = 0.552_284_749_830_793_4;
            verbs.push(Verb::Cubic(lerp(a, *v, kappa), lerp(b, *v, kappa), b));
        }
        verbs.push(Verb::Close);
        Ok(verbs)
    }
}

/// Cubics along the circle of `r` around `center` from `from` to `to` degrees, at most 90° each.
fn arc_cubics(center: [f64; 2], r: f64, from: f64, to: f64, verbs: &mut Vec<Verb>) {
    let sweep = to - from;
    let parts = (sweep.abs() / 90.0).ceil().max(1.0) as usize;
    let each = sweep / parts as f64;
    // The handle length of a circular arc of angle θ: 4/3 · tan(θ/4) · r.
    let k = 4.0 / 3.0 * ops::tan(ops::rad(each) / 4.0) * r;
    for i in 0..parts {
        let (a0, a1) = (from + each * i as f64, from + each * (i + 1) as f64);
        let (p0, p1) = (at(center, r, a0), at(center, r, a1));
        let (t0, t1) = (ops::rad(a0), ops::rad(a1));
        let c0 = [p0[0] - k * ops::sin(t0), p0[1] + k * ops::cos(t0)];
        let c1 = [p1[0] + k * ops::sin(t1), p1[1] - k * ops::cos(t1)];
        verbs.push(Verb::Cubic(c0, c1, p1));
    }
}

/// How an arc closes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Close {
    /// A filled arc: through the center (a sector), or along `inner_r` (a ring sector).
    Filled,
    /// The stroke runs along the arc alone.
    Open,
    /// The planted twin of #373 AC5: a filled arc closed along its chord.
    Chord,
}

/// The path of `circle@1` with `arc {from, to}`.
pub fn arc(center: [f64; 2], r: f64, inner_r: f64, from: f64, to: f64, close: Close) -> Vec<Verb> {
    let to = from + (to - from).clamp(-360.0, 360.0);
    let mut verbs = Vec::new();
    match close {
        Close::Open | Close::Chord => {
            verbs.push(Verb::Move(at(center, r, from)));
            arc_cubics(center, r, from, to, &mut verbs);
            if close == Close::Chord {
                verbs.push(Verb::Close);
            }
        }
        Close::Filled if inner_r > 0.0 => {
            verbs.push(Verb::Move(at(center, r, from)));
            arc_cubics(center, r, from, to, &mut verbs);
            verbs.push(Verb::Line(at(center, inner_r, to)));
            arc_cubics(center, inner_r, to, from, &mut verbs);
            verbs.push(Verb::Close);
        }
        Close::Filled => {
            verbs.push(Verb::Move(center));
            verbs.push(Verb::Line(at(center, r, from)));
            arc_cubics(center, r, from, to, &mut verbs);
            verbs.push(Verb::Close);
        }
    }
    verbs
}

/// A whole circle as an outline from 0°, closed; with `inner_r` above 0 a ring, its inner circle
/// running the other way.
pub fn circle(center: [f64; 2], r: f64, inner_r: f64) -> Vec<Verb> {
    let mut verbs = vec![Verb::Move(at(center, r, 0.0))];
    arc_cubics(center, r, 0.0, 360.0, &mut verbs);
    verbs.push(Verb::Close);
    if inner_r > 0.0 {
        verbs.push(Verb::Move(at(center, inner_r, 360.0)));
        arc_cubics(center, inner_r, 360.0, 0.0, &mut verbs);
        verbs.push(Verb::Close);
    }
    verbs
}

/// `rect@1`'s box `[x, y, w, h]` as an outline from its top left corner, clockwise on screen, its
/// corners rounded by `radius`.
pub fn rect([x, y, w, h]: [f64; 4], radius: f64) -> Vec<Verb> {
    let r = radius.clamp(0.0, w.min(h) / 2.0);
    if r == 0.0 {
        return vec![
            Verb::Move([x, y]),
            Verb::Line([x + w, y]),
            Verb::Line([x + w, y + h]),
            Verb::Line([x, y + h]),
            Verb::Close,
        ];
    }
    let mut verbs = vec![Verb::Move([x + r, y])];
    for (corner, from) in [
        ([x + w - r, y + r], -90.0),
        ([x + w - r, y + h - r], 0.0),
        ([x + r, y + h - r], 90.0),
        ([x + r, y + r], 180.0),
    ] {
        verbs.push(Verb::Line(at(corner, r, from)));
        arc_cubics(corner, r, from, from + 90.0, &mut verbs);
    }
    verbs.push(Verb::Close);
    verbs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn star(points: f64, polygon: bool) -> Star {
        Star {
            center: [0.0, 0.0],
            points,
            outer_r: 100.0,
            inner_r: if polygon { 0.0 } else { 40.0 },
            outer_round: 0.0,
            inner_round: 0.0,
            polygon,
        }
    }

    #[test]
    fn a_polygon_refuses_an_inner_radius() {
        let mut s = star(6.0, true);
        s.inner_r = 10.0;
        assert_eq!(s.verbs("p").unwrap_err().path, "p/inner_r");
    }

    #[test]
    fn a_rounded_star_turns_each_vertex_into_a_cubic() {
        let mut s = star(5.0, false);
        s.outer_round = 0.5;
        let verbs = s.verbs("p").unwrap();
        let cubics = verbs
            .iter()
            .filter(|v| matches!(v, Verb::Cubic(..)))
            .count();
        assert_eq!(cubics, 5, "one cubic per outer vertex");
    }
}
