//! A channel's keys and how a segment between two of them mixes (canvas primitives: Channel and
//! key). The left key owns its segment; time is exact flicks and progress is computed in f64;
//! values mix per component, which for a color channel is in its OKLab space.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops;

/// The Bézier timing solver's step count: Newton steps, each replaced by a bisection step where
/// |dx/ds| < 1e-6 or Newton would leave the bracket, with no early exit.
pub const BEZIER_STEPS: u32 = 12;

/// How a key's segment, to the next key, mixes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Interp {
    Hold,
    Linear,
    /// Handles normalized over the segment: x over its span, clamped to [0, 1]; y over its value
    /// change, free.
    Bezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    /// The follow spring toward the next key's value, from rest at this key's, in closed form; the
    /// next key's value shows from its time on.
    Spring {
        freq_hz: f64,
        damping_ratio: f64,
    },
}

/// One key: its time in flicks, its value's components and the interpolation it owns.
#[derive(Clone, Debug, PartialEq)]
pub struct Key {
    pub id: String,
    pub t: i64,
    pub value: Vec<f64>,
    pub interp: Interp,
}

/// A channel's value at a time, with the Bézier solver's step count for that sample.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub value: Vec<f64>,
    pub iterations: u32,
}

/// The keys of one channel, sorted by time, then by ID, so two keys on one flick make a
/// right-continuous jump.
#[derive(Clone, Debug, PartialEq)]
pub struct Curve {
    pub keys: Vec<Key>,
}

impl Curve {
    pub fn new(mut keys: Vec<Key>) -> Curve {
        keys.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.id.cmp(&b.id)));
        Curve { keys }
    }

    /// The index of the key that owns `t`: the last at or before it, or `None` before the first.
    fn owner(&self, t: i64) -> Option<usize> {
        let after = self.keys.partition_point(|k| k.t <= t);
        after.checked_sub(1)
    }

    /// The value at `t`. Before the first key and after the last it holds (`extrapolate` hold).
    pub fn sample(&self, t: i64) -> Sample {
        let held = |k: &Key| Sample {
            value: k.value.clone(),
            iterations: 0,
        };
        let Some(i) = self.owner(t) else {
            return self.keys.first().map(held).unwrap_or(Sample {
                value: Vec::new(),
                iterations: 0,
            });
        };
        let a = &self.keys[i];
        let Some(b) = self.keys.get(i + 1) else {
            return held(a);
        };
        segment(a, b, t)
    }

    /// The earliest time after `t` at which the value may differ from its value at `t`: the next
    /// flick inside a segment that moves, the next key's time otherwise, `None` once nothing
    /// changes again.
    pub fn next_change(&self, t: i64) -> Option<i64> {
        let Some(i) = self.owner(t) else {
            return self.keys.first().map(|k| k.t);
        };
        let a = &self.keys[i];
        let b = self.keys.get(i + 1)?;
        if moves(a, b) {
            Some(t + 1)
        } else {
            Some(b.t)
        }
    }
}

/// Whether a segment's value changes across its span (it may still jump at its end).
fn moves(a: &Key, b: &Key) -> bool {
    match a.interp {
        Interp::Hold => false,
        _ => a.value != b.value,
    }
}

/// The value inside the segment `a → b` at `t`, with `a.t <= t < b.t`.
pub fn segment(a: &Key, b: &Key, t: i64) -> Sample {
    // At its own time a key shows its own value, bit for bit, whatever it interpolates by.
    if t == a.t {
        return Sample {
            value: a.value.clone(),
            iterations: 0,
        };
    }
    let u = (t - a.t) as f64 / (b.t - a.t) as f64;
    let mix = |w: f64| -> Vec<f64> {
        a.value
            .iter()
            .zip(&b.value)
            .map(|(&va, &vb)| va + (vb - va) * w)
            .collect()
    };
    match a.interp {
        Interp::Hold => Sample {
            value: a.value.clone(),
            iterations: 0,
        },
        Interp::Linear => Sample {
            value: mix(u),
            iterations: 0,
        },
        Interp::Bezier { x1, y1, x2, y2 } => {
            let solved = Bezier::new(x1, y1, x2, y2).solve(u);
            Sample {
                value: mix(solved.y),
                iterations: solved.steps,
            }
        }
        Interp::Spring {
            freq_hz,
            damping_ratio,
        } => {
            let seconds = (t - a.t) as f64 / FLICKS_PER_SECOND as f64;
            let e = spring_from_rest(freq_hz, damping_ratio, seconds);
            Sample {
                value: a
                    .value
                    .iter()
                    .zip(&b.value)
                    .map(|(&va, &vb)| vb + (va - vb) * e)
                    .collect(),
                iterations: 0,
            }
        }
    }
}

/// A damped spring's displacement from its target, released from rest at 1, after `seconds`, in
/// closed form in all three damping regimes (ω0 = 2π · `freq_hz`, ζ = `damping_ratio`).
pub fn spring_from_rest(freq_hz: f64, damping_ratio: f64, seconds: f64) -> f64 {
    let w = ops::TAU * freq_hz;
    let z = damping_ratio;
    if z < 1.0 {
        let wd = w * ops::sqrt(1.0 - z * z);
        ops::exp(-z * w * seconds)
            * (ops::cos(wd * seconds) + (z * w / wd) * ops::sin(wd * seconds))
    } else if z == 1.0 {
        ops::exp(-w * seconds) * (1.0 + w * seconds)
    } else {
        let root = ops::sqrt(z * z - 1.0);
        let r1 = -w * (z - root);
        let r2 = -w * (z + root);
        let c2 = -r1 / (r2 - r1);
        let c1 = 1.0 - c2;
        c1 * ops::exp(r1 * seconds) + c2 * ops::exp(r2 * seconds)
    }
}

/// A cubic Bézier timing curve from (0, 0) to (1, 1) through its two handles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bezier {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

/// A solved sample: the curve parameter, its y, and the steps the solver ran.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Solved {
    pub s: f64,
    pub y: f64,
    pub steps: u32,
}

/// The cubic `3(1−s)²s·p1 + 3(1−s)s²·p2 + s³` and its derivative, in f64.
fn cubic(p1: f64, p2: f64, s: f64) -> f64 {
    let c = 3.0 * p1;
    let b = 3.0 * (p2 - p1) - c;
    let a = 1.0 - c - b;
    ((a * s + b) * s + c) * s
}

fn cubic_slope(p1: f64, p2: f64, s: f64) -> f64 {
    let c = 3.0 * p1;
    let b = 3.0 * (p2 - p1) - c;
    let a = 1.0 - c - b;
    (3.0 * a * s + 2.0 * b) * s + c
}

impl Bezier {
    /// Handles with x clamped to [0, 1], so x never runs backwards in s.
    pub fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Bezier {
        Bezier {
            x1: x1.clamp(0.0, 1.0),
            y1,
            x2: x2.clamp(0.0, 1.0),
            y2,
        }
    }

    pub fn x(&self, s: f64) -> f64 {
        cubic(self.x1, self.x2, s)
    }

    pub fn y(&self, s: f64) -> f64 {
        cubic(self.y1, self.y2, s)
    }

    /// Solves x(s) = `u` for u in [0, 1]: an 11-sample table brackets s, then exactly
    /// [`BEZIER_STEPS`] steps, each Newton's unless the slope is under 1e-6 or Newton leaves the
    /// bracket, when it bisects; the bracket narrows at every step, so the result stays inside it.
    pub fn solve(&self, u: f64) -> Solved {
        let u = u.clamp(0.0, 1.0);
        let mut lo = 0.0;
        let mut hi = 1.0;
        for k in 1..=10 {
            let s = f64::from(k) / 10.0;
            if self.x(s) <= u {
                lo = s;
            } else {
                hi = s;
                break;
            }
        }
        let (x_lo, x_hi) = (self.x(lo), self.x(hi));
        let mut s = if x_hi > x_lo {
            lo + (u - x_lo) / (x_hi - x_lo) * (hi - lo)
        } else {
            0.5 * (lo + hi)
        };
        for _ in 0..BEZIER_STEPS {
            let f = self.x(s) - u;
            if f < 0.0 {
                lo = s;
            } else if f > 0.0 {
                hi = s;
            }
            let slope = cubic_slope(self.x1, self.x2, s);
            let newton = s - f / slope;
            // A converged Newton step lands on the bracket's end it just set: that stays.
            s = if f == 0.0 {
                s
            } else if slope.abs() < 1e-6 || !(newton >= lo && newton <= hi) {
                0.5 * (lo + hi)
            } else {
                newton
            };
        }
        Solved {
            s,
            y: self.y(s),
            steps: BEZIER_STEPS,
        }
    }

    /// The handles of each half when the curve is cut at parameter `s` (de Casteljau), each
    /// renormalized to its own part: the left over (0, 0)–(x(s), y(s)), the right over (x(s),
    /// y(s))–(1, 1). A part with no value change keeps its y handles as they are.
    pub fn split(&self, s: f64) -> (Bezier, Bezier) {
        let lerp = |a: (f64, f64), b: (f64, f64)| (a.0 + (b.0 - a.0) * s, a.1 + (b.1 - a.1) * s);
        let p0 = (0.0, 0.0);
        let p1 = (self.x1, self.y1);
        let p2 = (self.x2, self.y2);
        let p3 = (1.0, 1.0);
        let l1 = lerp(p0, p1);
        let m = lerp(p1, p2);
        let r2 = lerp(p2, p3);
        let l2 = lerp(l1, m);
        let r1 = lerp(m, r2);
        let cut = lerp(l2, r1);
        let over = |p: (f64, f64), from: (f64, f64), to: (f64, f64)| {
            let x = (p.0 - from.0) / (to.0 - from.0);
            let dy = to.1 - from.1;
            let y = if dy == 0.0 {
                p.1 - from.1
            } else {
                (p.1 - from.1) / dy
            };
            (x, y)
        };
        let (a1, a2) = (over(l1, p0, cut), over(l2, p0, cut));
        let (b1, b2) = (over(r1, cut, p3), over(r2, cut, p3));
        (
            Bezier::new(a1.0, a1.1, a2.0, a2.1),
            Bezier::new(b1.0, b1.1, b2.0, b2.1),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_spring_from_rest_starts_at_one_with_no_speed_and_decays() {
        for z in [0.5, 1.0, 2.0] {
            assert!((spring_from_rest(2.0, z, 0.0) - 1.0).abs() < 1e-15);
            let a = spring_from_rest(2.0, z, 1e-6);
            assert!((1.0 - a).abs() < 1e-6, "ζ {z}: starts at rest, {a}");
            assert!(spring_from_rest(2.0, z, 3.0).abs() < 1e-3, "ζ {z}: settles");
        }
    }

    #[test]
    fn a_solved_bezier_lands_on_its_x() {
        let b = Bezier::new(0.42, 0.0, 0.58, 1.0);
        for k in 0..=100 {
            let u = f64::from(k) / 100.0;
            let solved = b.solve(u);
            assert!(
                (b.x(solved.s) - u).abs() < 1e-14,
                "u {u}: x {}",
                b.x(solved.s)
            );
        }
    }

    #[test]
    fn a_newton_step_that_converges_on_the_bracket_end_is_kept() {
        // Blender's subdivision curve at 3.3 s: Newton lands exactly on the end it just set.
        let b = Bezier::new(1.0 / 12.0, 2.0, 1.0, -1.0);
        let u = 1_622_880_000.0 / 8_467_200_000.0;
        let solved = b.solve(u);
        assert!((b.x(solved.s) - u).abs() < 1e-15, "x {}", b.x(solved.s) - u);
    }
}
