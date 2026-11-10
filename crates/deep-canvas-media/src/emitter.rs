//! Emitter gain (canvas primitives: Emitter): distance gain × cone gain by the W3C Web Audio
//! formulas, with the cone's sign fixed as listener minus source, then an equal-power pan from the
//! direction to the listener.

use deep_canvas::ops;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Model {
    Inverse,
    Linear,
    Exponential,
}

#[derive(Clone, Copy, Debug)]
pub struct Distance {
    pub model: Model,
    pub reference: f64,
    pub max: f64,
    pub rolloff: f64,
}

impl Default for Distance {
    fn default() -> Self {
        Distance {
            model: Model::Inverse,
            reference: 1.0,
            max: 10_000.0,
            rolloff: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Cone {
    pub inner: f64,
    pub outer: f64,
    pub outer_gain: f64,
}

impl Default for Cone {
    fn default() -> Self {
        Cone {
            inner: 360.0,
            outer: 360.0,
            outer_gain: 0.0,
        }
    }
}

/// The distance gain at `d` metres (W3C Web Audio, PannerNode distance models).
pub fn distance_gain(m: &Distance, d: f64, model: Model) -> f64 {
    let r = m.reference;
    // W3C: with a reference distance of 0 the inverse and exponential models give 0.
    if r == 0.0 && model != Model::Linear {
        return 0.0;
    }
    match model {
        Model::Linear => {
            if m.max <= r {
                return 1.0;
            }
            let d = d.clamp(r, m.max);
            1.0 - m.rolloff.clamp(0.0, 1.0) * (d - r) / (m.max - r)
        }
        Model::Inverse => {
            let d = d.max(r);
            r / (r + m.rolloff.max(0.0) * (d - r))
        }
        Model::Exponential => {
            let d = d.max(r);
            ops::pow(d / r, -m.rolloff.max(0.0))
        }
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn norm(a: [f64; 3]) -> f64 {
    ops::sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

/// The cone gain of a source at `source` facing `forward`, heard at `listener`. `reversed` is the
/// planted cone that takes the angle from source minus listener.
pub fn cone_gain(c: &Cone, forward: [f64; 3], source: [f64; 3], listener: [f64; 3], reversed: bool) -> f64 {
    if c.inner >= 360.0 && c.outer >= 360.0 {
        return 1.0;
    }
    let to = if reversed { sub(source, listener) } else { sub(listener, source) };
    let (nf, nt) = (norm(forward), norm(to));
    if nf == 0.0 || nt == 0.0 {
        return 1.0;
    }
    let cos = ((forward[0] * to[0] + forward[1] * to[1] + forward[2] * to[2]) / (nf * nt)).clamp(-1.0, 1.0);
    let angle = ops::deg(ops::acos(cos));
    let (inner, outer) = (c.inner / 2.0, c.outer / 2.0);
    if angle <= inner {
        1.0
    } else if angle >= outer {
        c.outer_gain
    } else {
        1.0 + (c.outer_gain - 1.0) * (angle - inner) / (outer - inner)
    }
}

/// Equal-power pan gains (left, right) for `pan` in −1..1 on a mono input.
pub fn pan_gains(pan: f64) -> (f64, f64) {
    let x = (pan.clamp(-1.0, 1.0) + 1.0) / 2.0;
    (ops::cos(x * ops::PI / 2.0), ops::sin(x * ops::PI / 2.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_distance_of_zero_is_silent_on_the_inverse_and_exponential_models() {
        for rolloff in [0.0, 1.0] {
            let m = Distance {
                reference: 0.0,
                rolloff,
                ..Default::default()
            };
            for model in [Model::Inverse, Model::Exponential] {
                for d in [0.0, 3.0] {
                    let gain = distance_gain(&m, d, model);
                    assert_eq!(gain, 0.0, "{model:?}, rolloff {rolloff}, at {d} m");
                }
            }
        }
    }
}
