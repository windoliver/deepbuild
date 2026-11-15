//! Flows along many curves (#451; canvas primitives: Particles `particles@1`: space and paths).
//!
//! Each particle picks a curve by hash (or by weights), moves along it by arc length at a seeded
//! speed from its start, and keeps a seeded sideways offset, so a crowd of simple agents moves
//! without simulating it. A curve is its points as laid out: a path item's, a graph's routed
//! edge's or a vector field's stream sub-path, read exactly by arc length along those points, so a
//! particle with no sideways offset lies on the polyline itself, never on a resampled chord.

use super::eval::draw;
use super::{add, len, scale, sub, V3};

/// How a particle picks its curve.
#[derive(Clone, Debug, PartialEq)]
pub enum Pick {
    Hash,
    /// One weight a curve, in the curves' order.
    Weights(Vec<f64>),
}

/// A curve read by arc length: its points and the length up to each.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Curve {
    pub points: Vec<V3>,
    cum: Vec<f64>,
}

impl Curve {
    pub fn new(points: Vec<V3>) -> Self {
        let mut cum = Vec::with_capacity(points.len());
        let mut s = 0.0;
        for (k, p) in points.iter().enumerate() {
            if k > 0 {
                s += len(sub(*p, points[k - 1]));
            }
            cum.push(s);
        }
        Self { points, cum }
    }

    pub fn len(&self) -> f64 {
        self.cum.last().copied().unwrap_or(0.0)
    }

    /// The length up to each point.
    pub fn lengths(&self) -> &[f64] {
        &self.cum
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// The point `s` along it (clamped to its ends) and its unit tangent there.
    pub fn at(&self, s: f64) -> (V3, V3) {
        let n = self.points.len();
        if n < 2 {
            return (self.points.first().copied().unwrap_or([0.0; 3]), [0.0; 3]);
        }
        let s = s.clamp(0.0, self.len());
        // The last segment that starts at or before s, skipping zero-length ones.
        let k = self.cum.partition_point(|c| *c <= s).clamp(1, n - 1) - 1;
        let (mut a, mut b) = (k, k + 1);
        while self.cum[b] - self.cum[a] <= 0.0 && a > 0 {
            a -= 1;
            b -= 1;
        }
        let (p0, p1) = (self.points[a], self.points[b]);
        let d = sub(p1, p0);
        let l = self.cum[b] - self.cum[a];
        if l <= 0.0 {
            return (p0, [0.0; 3]);
        }
        let f = ((s - self.cum[a]) / l).clamp(0.0, 1.0);
        (add(p0, scale(d, f)), scale(d, 1.0 / l))
    }
}

/// The curve a particle whose key is `h` picks among `n`: by hash, or by its weights' running
/// sum (a weight below zero counts as none).
pub fn pick(pick: &Pick, n: usize, h: u32) -> usize {
    if n == 0 {
        return 0;
    }
    let u = draw(h, 12);
    match pick {
        Pick::Hash => ((u * n as f64) as usize).min(n - 1),
        Pick::Weights(w) => {
            let ws: Vec<f64> = (0..n)
                .map(|k| w.get(k).copied().unwrap_or(0.0).max(0.0))
                .collect();
            let total: f64 = ws.iter().sum();
            if total <= 0.0 {
                return ((u * n as f64) as usize).min(n - 1);
            }
            let mut acc = 0.0;
            for (k, x) in ws.iter().enumerate() {
                acc += x / total;
                if u < acc {
                    return k;
                }
            }
            n - 1
        }
    }
}

/// A particle's speed in the range and its sideways offset in [−lateral, lateral].
pub fn seeded(speed: [f64; 2], lateral: f64, h: u32) -> (f64, f64) {
    let s = speed[0] + (speed[1] - speed[0]) * draw(h, 13);
    (s, lateral * (2.0 * draw(h, 14) - 1.0))
}

/// The point `s` along `curve` moved `off` sideways: in the plane, a quarter turn of the tangent
/// (x, y) → (−y, x); in space, across the tangent within the horizontal plane, or along +x where
/// the tangent is vertical. Its velocity is the tangent times `speed`.
pub fn place(curve: &Curve, s: f64, off: f64, speed: f64) -> (V3, V3) {
    let (p, tan) = curve.at(s);
    if off == 0.0 {
        return (p, scale(tan, speed));
    }
    let side = {
        let h = [-tan[2], 0.0, tan[0]];
        let hl = len(h);
        if tan[2] == 0.0 {
            [-tan[1], tan[0], 0.0]
        } else if hl > 0.0 {
            scale(h, 1.0 / hl)
        } else {
            [1.0, 0.0, 0.0]
        }
    };
    (add(p, scale(side, off)), scale(tan, speed))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::eval::{self, Baked, Lane};
    use super::super::spec;
    use super::Curve;

    /// `per_edge` (#451): each edge's emitter is its own, so by 10 s an edge at 2 a second has
    /// emitted 20 particles along its own curve and one at 6 a second 60, none on the other's.
    #[test]
    fn per_edge_emits_each_edge_at_its_rate() {
        let doc = json!({"items": {}});
        let p = json!({"dimensions": 2, "count": 80, "life": 20, "per_edge": "traffic",
                       "motion": {"along": {"curves": ["g#a", "g#b"], "speed": [1, 1]}}});
        let s = spec::read(&doc, "flow", &p).expect("read");
        let mut b = Baked::new("flow", s, 451, [0.0; 3]);
        b.flows = vec![
            Curve::new(vec![[0.0, 0.0, 0.0], [100.0, 0.0, 0.0]]),
            Curve::new(vec![[0.0, 50.0, 0.0], [100.0, 50.0, 0.0]]),
        ];
        b.lanes = vec![
            Lane {
                first: 0,
                slots: 20,
                rate: 2.0,
            },
            Lane {
                first: 20,
                slots: 60,
                rate: 6.0,
            },
        ];
        let records = eval::records(&b, 9.999);
        let on = |c: usize| records.iter().filter(|r| r.curve == Some(c)).count();
        assert_eq!((on(0), on(1)), (20, 60));
        // Each live particle sits on its own lane's curve.
        for e in 0..80 {
            let st = eval::state(&b, e, 9.999).expect("live");
            assert_eq!(st.pos[1], if e < 20 { 0.0 } else { 50.0 }, "row {e}");
        }
    }
}
