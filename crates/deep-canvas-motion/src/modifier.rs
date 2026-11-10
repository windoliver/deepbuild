//! Channel modifiers (canvas primitives: Channel and key: `modifiers`): each adds to the keyed
//! value, scaled by its influence, as a pure function of the document's time, so seeking equals
//! playing. A wave or a noise with `per_loop` takes that many whole cycles across the transport's
//! span, its phase formed from exact flicks, so a looping document's waves and noise end where
//! they start.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops;

use deep_canvas::ease::Named;

use crate::curve::Jump;

/// How a wave or a noise counts its cycles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rate {
    /// Cycles per second.
    Hz(f64),
    /// Whole cycles across the transport's span, in flicks.
    PerLoop { n: u16, span: i64 },
    /// One cycle every so many flicks: the planted `per_loop` that rounds its period first.
    Period(i64),
}

/// A pulse's shape over its span (Channel and key: pulse).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    ThereAndBack,
    Pause(f64),
    Wiggle(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Wave {
        amplitude: f64,
        rate: Rate,
        /// In cycles.
        phase: f64,
        offset: f64,
    },
    Noise {
        amplitude: f64,
        rate: Rate,
        seed: u64,
    },
    Pulse {
        at: i64,
        span: i64,
        amount: f64,
        shape: Shape,
        ease: Named,
    },
    Limits {
        min: f64,
        max: f64,
    },
    /// Steps the channel's time, not its value (Channel and key: quantize jump), so it applies
    /// before the keys are read.
    Quantize {
        hz: f64,
        jump: Jump,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Modifier {
    pub kind: Kind,
    pub influence: f64,
}

impl Rate {
    /// Cycles at `t` flicks: whole cycles and the fraction of the current one, the fraction exact
    /// to an f64's rounding however long the document runs.
    fn cycles(&self, t: i64) -> (i64, f64) {
        match *self {
            Rate::Hz(hz) => {
                let x = hz * t as f64 / FLICKS_PER_SECOND as f64;
                let whole = x.floor();
                (whole as i64, x - whole)
            }
            Rate::Period(p) => (t.div_euclid(p), t.rem_euclid(p) as f64 / p as f64),
            Rate::PerLoop { n, span } => {
                let num = i128::from(n) * i128::from(t);
                let span = i128::from(span);
                let whole = num.div_euclid(span);
                let rest = num.rem_euclid(span);
                (whole as i64, rest as f64 / span as f64)
            }
        }
    }
}

impl Modifier {
    /// The planted `per_loop`: its period rounded to a whole flick before the phase is formed.
    pub fn round_period(&mut self) {
        if let Kind::Wave { rate, .. } | Kind::Noise { rate, .. } = &mut self.kind {
            if let Rate::PerLoop { n, span } = *rate {
                *rate = Rate::Period((span as f64 / f64::from(n)).round() as i64);
            }
        }
    }

    /// The keyed value at `t` flicks with this modifier applied.
    pub fn apply(&self, value: f64, t: i64) -> f64 {
        let k = self.influence;
        match &self.kind {
            Kind::Wave {
                amplitude,
                rate,
                phase,
                offset,
            } => {
                let (_, frac) = rate.cycles(t);
                let turn = (frac + phase).rem_euclid(1.0);
                value + k * (amplitude * ops::sin(ops::TAU * turn) + offset)
            }
            Kind::Noise {
                amplitude,
                rate,
                seed,
            } => {
                let (cell, frac) = rate.cycles(t);
                let period = match rate {
                    Rate::PerLoop { n, .. } => Some(i64::from(*n)),
                    Rate::Period(_) | Rate::Hz(_) => None,
                };
                value + k * amplitude * lattice(*seed, cell, frac, period)
            }
            Kind::Pulse {
                at,
                span,
                amount,
                shape,
                ease,
            } => {
                if t <= *at || t >= at + span {
                    return value;
                }
                let u = (t - at) as f64 / *span as f64;
                value + k * amount * shape_at(*shape, ease, u)
            }
            Kind::Limits { min, max } => {
                let held = value.clamp(*min, *max);
                value + k * (held - value)
            }
            Kind::Quantize { .. } => value,
        }
    }
}

impl Modifier {
    /// The range a value in `[lo, hi]` keeps once this modifier applies, from its amplitude, its
    /// pulse's shape (its ease's extremes) or its limits, by its influence, which may be negative.
    pub fn bound(&self, lo: f64, hi: f64) -> (f64, f64) {
        let k = self.influence;
        // `k · s` for s in [a, b], either sign of k.
        let scaled = |a: f64, b: f64| {
            let (p, q) = (k * a, k * b);
            (p.min(q), p.max(q))
        };
        match &self.kind {
            Kind::Wave {
                amplitude, offset, ..
            } => {
                let (a, b) = scaled(offset - amplitude.abs(), offset + amplitude.abs());
                (lo + a, hi + b)
            }
            Kind::Noise { amplitude, .. } => {
                let (a, b) = scaled(-amplitude.abs(), amplitude.abs());
                (lo + a, hi + b)
            }
            Kind::Pulse {
                amount,
                shape,
                ease,
                ..
            } => {
                // The shape reads the ease up and back, so it keeps the ease's extremes, with 0.
                let (e0, e1) = ease.extremes();
                let (s0, s1) = match shape {
                    Shape::Wiggle(_) => {
                        let m = e0.abs().max(e1.abs());
                        (-m, m)
                    }
                    _ => (e0.min(0.0), e1.max(1.0)),
                };
                let (a, b) = scaled(amount * s0, amount * s1);
                (lo + a.min(0.0), hi + b.max(0.0))
            }
            Kind::Quantize { .. } => (lo, hi),
            Kind::Limits { min, max } => {
                // value + k(clamp(value) − value): the clamp's move, mixed by k, from each end.
                let at = |v: f64| v + k * (v.clamp(*min, *max) - v);
                let ends = [at(lo), at(hi), at(min.clamp(lo, hi)), at(max.clamp(lo, hi))];
                ends.iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| {
                        (a.min(*v), b.max(*v))
                    })
            }
        }
    }
}

/// A pulse's shape at u in (0, 1): 0 at both ends, 1 at its height.
fn shape_at(shape: Shape, ease: &Named, u: f64) -> f64 {
    let there_and_back = |u: f64| {
        let x = if u < 0.5 { 2.0 * u } else { 2.0 - 2.0 * u };
        ease.at(x)
    };
    match shape {
        Shape::ThereAndBack => there_and_back(u),
        Shape::Pause(share) => {
            // Up across the first (1 − share)/2, held across share, down across the rest.
            let rise = 0.5 * (1.0 - share);
            if u < rise {
                ease.at(u / rise)
            } else if u <= 1.0 - rise {
                1.0
            } else {
                ease.at((1.0 - u) / rise)
            }
        }
        // math@1's wiggle: sin(count · π · u), count half-turns over the span.
        Shape::Wiggle(count) => there_and_back(u) * ops::sin(ops::PI * count * u),
    }
}

/// One 1D gradient-noise cell's gradient in [−1, 1], from the seed and the cell's index.
fn gradient(seed: u64, cell: i64) -> f64 {
    let mut z = seed ^ (cell as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

/// Lattice (gradient) noise at `frac` into cell `cell`, its lattice wrapping every `period`
/// cells when it has one, so its value and slope at the period's end are its start's.
fn lattice(seed: u64, cell: i64, frac: f64, period: Option<i64>) -> f64 {
    let at = |c: i64| period.map_or(c, |p| c.rem_euclid(p));
    let (g0, g1) = (gradient(seed, at(cell)), gradient(seed, at(cell + 1)));
    let fade = frac * frac * frac * (frac * (frac * 6.0 - 15.0) + 10.0);
    let (a, b) = (g0 * frac, g1 * (frac - 1.0));
    a + (b - a) * fade
}
