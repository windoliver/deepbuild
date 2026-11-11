//! The core's outline sources (issue #443; canvas primitives: Builder `extrude`: outlines from
//! text, paths and SVG): the registry `outline.source@1`, which text, marks2d and vector fill at the
//! seal, so `extrude` reads outlines without depending on any of them. An entry takes one form of
//! `outline` (`{text}`, `{path}` or `{vector}`) with its `size` and `flatten` and returns closed
//! contours in meters with their fill rule; [`shells`] resolves them by that rule into the regions
//! a prism is built from, each outer ring with the holes it holds.

use serde_json::Value;

use crate::ops::sqrt;

/// The registry the core declares for outline sources.
pub const REGISTRY: &str = "outline.source@1";

/// Each form of `outline` an entry fills, with the canvas module that fills it: in a build
/// without that module the form is refused `module_missing`, naming it.
pub const FORMS: [(&str, &str); 3] = [("text", "text"), ("path", "marks2d"), ("vector", "vector")];

/// The form an `outline` value takes: the first of [`FORMS`] it holds as a key.
pub fn form_of(outline: &Value) -> Option<&'static str> {
    FORMS
        .iter()
        .map(|(f, _)| *f)
        .find(|f| outline.get(*f).is_some())
}

/// The module that fills `form`.
pub fn module_of(form: &str) -> Option<&'static str> {
    FORMS.iter().find(|(f, _)| *f == form).map(|(_, m)| *m)
}

/// How contours resolve to a filled area.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

impl FillRule {
    pub fn name(self) -> &'static str {
        match self {
            FillRule::NonZero => "nonzero",
            FillRule::EvenOdd => "evenodd",
        }
    }

    pub fn filled(self, winding: i64) -> bool {
        match self {
            FillRule::NonZero => winding != 0,
            FillRule::EvenOdd => winding % 2 != 0,
        }
    }
}

/// One closed contour, in meters, what it came from (a glyph, an element), for refusals, and the
/// fill it belongs to: one per element, each by its own rule; overlapping fills merge.
#[derive(Clone, Debug, PartialEq)]
pub struct Contour {
    pub points: Vec<[f64; 2]>,
    pub of: String,
    pub fill: usize,
}

/// What an entry returns: its contours with each fill's rule (`rules[fill]`).
#[derive(Clone, Debug, PartialEq)]
pub struct Outlines {
    pub contours: Vec<Contour>,
    pub rules: Vec<FillRule>,
}

impl Outlines {
    /// Whether `p` is covered: by any fill, each by its own rule.
    pub fn covers(&self, p: [f64; 2]) -> bool {
        let mut w = vec![0i64; self.rules.len()];
        for c in &self.contours {
            if let Some(slot) = w.get_mut(c.fill) {
                *slot += winding(&c.points, p);
            }
        }
        w.iter().zip(&self.rules).any(|(w, r)| r.filled(*w))
    }
}

/// What an entry is asked: the outline form as written, its size and flatten, and the document
/// (for the items a form names).
pub struct Request<'a> {
    pub outline: &'a Value,
    pub size: f64,
    pub flatten: f64,
    pub doc: &'a Value,
    /// Reads an asset's bytes by sha256, where the caller holds a store.
    pub bytes: &'a dyn Fn(&str) -> Option<Vec<u8>>,
    /// A wrong program a test build plants by name, or none (#443's `extrude_own_advance`).
    pub planted: Option<&'a str>,
}

/// Why an entry refused: a code and the field or element it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub what: String,
}

/// An entry's Rust: its outlines, or why not.
pub type Fill = fn(&Request<'_>) -> Result<Outlines, Refusal>;

impl crate::registry::Registrar {
    /// Fills an entry of the core's `outline.source@1` (#443): its value, which the registry's kit
    /// holds to its item's 2D fill, and its own Rust, which `extrude` reads outlines through.
    pub fn outline_source(&mut self, name: &str, value: Value, fill: Fill) -> &mut Self {
        self.entry(REGISTRY, name, value, "R6");
        self.outline_fills.push((name.into(), fill));
        self
    }
}

/// One filled region: its outer ring (counter-clockwise), its holes (clockwise) and what the
/// outer ring came from.
#[derive(Clone, Debug, PartialEq)]
pub struct Shell {
    pub outer: Vec<[f64; 2]>,
    pub holes: Vec<Vec<[f64; 2]>>,
    pub of: String,
}

/// Twice a ring's signed area, positive counter-clockwise.
pub fn area2(ring: &[[f64; 2]]) -> f64 {
    let n = ring.len();
    let mut terms: Vec<f64> = (0..n)
        .map(|k| {
            let (a, b) = (ring[k], ring[(k + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .collect();
    terms.sort_by(f64::total_cmp);
    terms.iter().sum()
}

/// The winding number of `ring` around `p`.
pub fn winding(ring: &[[f64; 2]], p: [f64; 2]) -> i64 {
    let n = ring.len();
    let mut w = 0;
    for k in 0..n {
        let (a, b) = (ring[k], ring[(k + 1) % n]);
        let side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
        if a[1] <= p[1] {
            if b[1] > p[1] && side > 0.0 {
                w += 1;
            }
        } else if b[1] <= p[1] && side < 0.0 {
            w -= 1;
        }
    }
    w
}

/// A point just to the left of the middle of `ring`'s longest edge: inside a counter-clockwise
/// ring, outside a clockwise one, nearer the edge than any other part of the ring.
fn probe(ring: &[[f64; 2]]) -> ([f64; 2], [f64; 2]) {
    let n = ring.len();
    let (mut best, mut len) = (0, -1.0);
    for k in 0..n {
        let (a, b) = (ring[k], ring[(k + 1) % n]);
        let l = crate::ops::hypot(b[0] - a[0], b[1] - a[1]);
        if l > len {
            (best, len) = (k, l);
        }
    }
    let (a, b) = (ring[best], ring[(best + 1) % n]);
    let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let scale = ring
        .iter()
        .fold(0.0f64, |m, p| m.max(p[0].abs()).max(p[1].abs()))
        .max(1e-9);
    let e = (len * 1e-4).min(scale * 1e-7).max(1e-12);
    let left = [-(b[1] - a[1]) / len * e, (b[0] - a[0]) / len * e];
    (
        [mid[0] + left[0], mid[1] + left[1]],
        [mid[0] - left[0], mid[1] - left[1]],
    )
}

/// The contours resolved by their fill rule into shells: a contour bounds the fill where the
/// area on one side of it is filled and on the other isn't. One whose inside is filled is an
/// outer ring; one whose outside is filled is a hole, held by the smallest outer ring around it.
/// A contour with fill on both sides or neither bounds nothing and is left out. With
/// `ignore_rule` (#443's planted reader) every contour is an outer ring and no hole is made.
pub fn shells(o: &Outlines, ignore_rule: bool) -> Vec<Shell> {
    let rings: Vec<&Contour> = o
        .contours
        .iter()
        .filter(|c| c.points.len() >= 3 && area2(&c.points) != 0.0)
        .collect();
    if ignore_rule {
        // Each contour filled on its own: the outermost of each nest is the shell, holes lost.
        let mut out: Vec<Shell> = Vec::new();
        for (i, c) in rings.iter().enumerate() {
            let inside_other = rings.iter().enumerate().any(|(j, d)| {
                j != i
                    && area2(&d.points).abs() > area2(&c.points).abs()
                    && winding(&d.points, c.points[0]) != 0
            });
            if !inside_other {
                out.push(Shell {
                    outer: ccw(&c.points),
                    holes: Vec::new(),
                    of: c.of.clone(),
                });
            }
        }
        return out;
    }
    let mut outers: Vec<(&Contour, f64)> = Vec::new();
    let mut holes: Vec<&Contour> = Vec::new();
    for c in &rings {
        let (left, right) = probe(&c.points);
        let (l, r) = (o.covers(left), o.covers(right));
        // Which side is the ring's inside depends on its direction.
        let ccw_ring = area2(&c.points) > 0.0;
        let (inside, outside) = if ccw_ring { (l, r) } else { (r, l) };
        match (inside, outside) {
            (true, false) => outers.push((c, area2(&c.points).abs())),
            (false, true) => holes.push(c),
            _ => {}
        }
    }
    let mut out: Vec<Shell> = outers
        .iter()
        .map(|(c, _)| Shell {
            outer: ccw(&c.points),
            holes: Vec::new(),
            of: c.of.clone(),
        })
        .collect();
    for h in holes {
        let held = outers
            .iter()
            .enumerate()
            .filter(|(_, (c, _))| winding(&c.points, h.points[0]) != 0)
            .min_by(|a, b| a.1 .1.total_cmp(&b.1 .1))
            .map(|(k, _)| k);
        if let Some(k) = held {
            let mut ring = h.points.clone();
            if area2(&ring) > 0.0 {
                ring.reverse();
            }
            out[k].holes.push(ring);
        }
    }
    out
}

fn ccw(ring: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut r = ring.to_vec();
    if area2(&r) < 0.0 {
        r.reverse();
    }
    r
}

/// Flattens curves into closed contours, each curve within `tolerance` of its outline.
pub struct Flattener {
    pub tolerance: f64,
    pub contours: Vec<Vec<[f64; 2]>>,
    current: Vec<[f64; 2]>,
}

impl Flattener {
    pub fn new(tolerance: f64) -> Flattener {
        Flattener {
            tolerance: tolerance.max(1e-12),
            contours: Vec::new(),
            current: Vec::new(),
        }
    }

    fn last(&self) -> [f64; 2] {
        self.current.last().copied().unwrap_or([0.0, 0.0])
    }

    pub fn move_to(&mut self, p: [f64; 2]) {
        self.close();
        self.current.push(p);
    }

    pub fn line_to(&mut self, p: [f64; 2]) {
        if self.current.last() != Some(&p) {
            self.current.push(p);
        }
    }

    /// A quadratic, split into n segments with n from its second difference: the chord of a
    /// quadratic strays at most |P0 − 2P1 + P2| / (4 n²).
    pub fn quad_to(&mut self, c: [f64; 2], p: [f64; 2]) {
        let a = self.last();
        let d = [a[0] - 2.0 * c[0] + p[0], a[1] - 2.0 * c[1] + p[1]];
        let dd = sqrt(d[0] * d[0] + d[1] * d[1]);
        let n = (sqrt(dd / (4.0 * self.tolerance)).ceil() as usize).clamp(1, 1024);
        for k in 1..=n {
            let t = k as f64 / n as f64;
            let u = 1.0 - t;
            self.line_to([
                u * u * a[0] + 2.0 * u * t * c[0] + t * t * p[0],
                u * u * a[1] + 2.0 * u * t * c[1] + t * t * p[1],
            ]);
        }
    }

    /// A cubic, split into n segments with n from its largest second difference: the chord
    /// strays at most 3 max|ΔΔ| / (4 n²) (Wang's bound).
    pub fn cubic_to(&mut self, c1: [f64; 2], c2: [f64; 2], p: [f64; 2]) {
        let a = self.last();
        let dd = |x: [f64; 2], y: [f64; 2], z: [f64; 2]| {
            let d = [x[0] - 2.0 * y[0] + z[0], x[1] - 2.0 * y[1] + z[1]];
            sqrt(d[0] * d[0] + d[1] * d[1])
        };
        let m = dd(a, c1, c2).max(dd(c1, c2, p));
        let n = (sqrt(3.0 * m / (4.0 * self.tolerance)).ceil() as usize).clamp(1, 1024);
        for k in 1..=n {
            let t = k as f64 / n as f64;
            let u = 1.0 - t;
            let (b0, b1, b2, b3) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            self.line_to([
                b0 * a[0] + b1 * c1[0] + b2 * c2[0] + b3 * p[0],
                b0 * a[1] + b1 * c1[1] + b2 * c2[1] + b3 * p[1],
            ]);
        }
    }

    /// Ends the contour; a closing point equal to its first is dropped.
    pub fn close(&mut self) {
        let mut c = std::mem::take(&mut self.current);
        if c.len() > 1 && c.first() == c.last() {
            c.pop();
        }
        if c.len() >= 3 {
            self.contours.push(c);
        }
    }

    pub fn finish(mut self) -> Vec<Vec<[f64; 2]>> {
        self.close();
        self.contours
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Vec<[f64; 2]> {
        vec![[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
    }

    fn outlines(rings: Vec<Vec<[f64; 2]>>, rule: FillRule) -> Outlines {
        Outlines {
            contours: rings
                .into_iter()
                .enumerate()
                .map(|(k, points)| Contour {
                    points,
                    of: format!("c{k}"),
                    fill: 0,
                })
                .collect(),
            rules: vec![rule],
        }
    }

    #[test]
    fn nonzero_counter_is_a_hole_only_when_it_turns_the_other_way() {
        let mut inner = square(1.0, 1.0, 1.0);
        inner.reverse();
        let s = shells(
            &outlines(vec![square(0.0, 0.0, 3.0), inner], FillRule::NonZero),
            false,
        );
        assert_eq!((s.len(), s[0].holes.len()), (1, 1));
        // The same way round under nonzero: the inner square is filled, so no hole.
        let s = shells(
            &outlines(
                vec![square(0.0, 0.0, 3.0), square(1.0, 1.0, 1.0)],
                FillRule::NonZero,
            ),
            false,
        );
        assert_eq!((s.len(), s[0].holes.len()), (1, 0));
        // Under evenodd it is a hole either way.
        let s = shells(
            &outlines(
                vec![square(0.0, 0.0, 3.0), square(1.0, 1.0, 1.0)],
                FillRule::EvenOdd,
            ),
            false,
        );
        assert_eq!((s.len(), s[0].holes.len()), (1, 1));
        let s = shells(
            &outlines(
                vec![square(0.0, 0.0, 3.0), square(1.0, 1.0, 1.0)],
                FillRule::EvenOdd,
            ),
            true,
        );
        assert_eq!((s.len(), s[0].holes.len()), (1, 0));
    }

    #[test]
    fn a_cubic_flattens_within_tolerance() {
        let mut f = Flattener::new(1e-3);
        f.move_to([0.0, 0.0]);
        f.cubic_to([0.0, 0.5523], [0.4477, 1.0], [1.0, 1.0]);
        f.line_to([1.0, 0.0]);
        let c = f.finish();
        for p in &c[0][1..c[0].len() - 1] {
            let r = sqrt((p[0] - 1.0) * (p[0] - 1.0) + p[1] * p[1]);
            assert!((r - 1.0).abs() < 2e-3, "{p:?} at {r}");
        }
    }
}
