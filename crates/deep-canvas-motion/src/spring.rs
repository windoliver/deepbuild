//! A damped spring in closed form (canvas primitives: Channel and key's `spring`; Follow's
//! spring model): x'' + 2ζω0·x' + ω0²·(x − target) = 0 solved exactly from a displacement and a
//! rate, in all three damping regimes, with its rate, its running integral and the times of its
//! extremes, so a hard range is checked without a search and nothing integrates frame by frame.

use deep_canvas::ops;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spring {
    /// ω0, rad/s.
    pub w0: f64,
    /// ζ.
    pub zeta: f64,
}

/// Displacement from the target and its rate at one time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motion {
    pub e: f64,
    pub rate: f64,
}

impl Spring {
    /// `{freq_hz, damping_ratio}`: ω0 = 2π · freq_hz.
    pub fn from_freq(freq_hz: f64, damping_ratio: f64) -> Spring {
        Spring {
            w0: ops::TAU * freq_hz,
            zeta: damping_ratio,
        }
    }

    /// `{decay, omega}`: ζ·ω0 = decay and the damped frequency is omega.
    pub fn from_decay(decay: f64, omega: f64) -> Spring {
        let w0 = ops::sqrt(decay * decay + omega * omega);
        Spring {
            w0,
            zeta: if omega == 0.0 { 1.0 } else { decay / w0 },
        }
    }

    /// `{duration, bounce}`: ω0 = 2π ÷ duration and ζ = 1 − bounce.
    pub fn from_duration(duration: f64, bounce: f64) -> Spring {
        Spring {
            w0: ops::TAU / duration,
            zeta: 1.0 - bounce,
        }
    }

    /// `{mass, stiffness, damping}`: ω0 = √(k ÷ m) and ζ = c ÷ (2√(km)).
    pub fn from_mass(mass: f64, stiffness: f64, damping: f64) -> Spring {
        Spring {
            w0: ops::sqrt(stiffness / mass),
            zeta: damping / (2.0 * ops::sqrt(stiffness * mass)),
        }
    }

    fn decay(&self) -> f64 {
        self.zeta * self.w0
    }

    fn damped(&self) -> f64 {
        self.w0 * ops::sqrt(1.0 - self.zeta * self.zeta)
    }

    /// The two rates of an overdamped spring, slow first.
    fn roots(&self) -> (f64, f64) {
        let root = ops::sqrt(self.zeta * self.zeta - 1.0);
        (-self.w0 * (self.zeta - root), -self.w0 * (self.zeta + root))
    }

    /// The overdamped weights of `e0` and `v0` on each root.
    fn weights(&self, e0: f64, v0: f64) -> (f64, f64, f64, f64) {
        let (r1, r2) = self.roots();
        let c2 = (v0 - r1 * e0) / (r2 - r1);
        (r1, r2, e0 - c2, c2)
    }

    /// The displacement and its rate `t` seconds after a start at displacement `e0` and rate `v0`.
    pub fn at(&self, e0: f64, v0: f64, t: f64) -> Motion {
        if self.zeta < 1.0 {
            let (l, wd) = (self.decay(), self.damped());
            let b = (v0 + l * e0) / wd;
            let (c, s, k) = (ops::cos(wd * t), ops::sin(wd * t), ops::exp(-l * t));
            Motion {
                e: k * (e0 * c + b * s),
                rate: k * ((-l * e0 + wd * b) * c + (-l * b - wd * e0) * s),
            }
        } else if self.zeta == 1.0 {
            let w = self.w0;
            let c = v0 + w * e0;
            let k = ops::exp(-w * t);
            Motion {
                e: k * (e0 + c * t),
                rate: k * (c - w * (e0 + c * t)),
            }
        } else {
            let (r1, r2, c1, c2) = self.weights(e0, v0);
            let (k1, k2) = (ops::exp(r1 * t), ops::exp(r2 * t));
            Motion {
                e: c1 * k1 + c2 * k2,
                rate: c1 * r1 * k1 + c2 * r2 * k2,
            }
        }
    }

    /// The displacement's integral over [0, t].
    pub fn integral(&self, e0: f64, v0: f64, t: f64) -> f64 {
        if self.zeta < 1.0 {
            let (l, wd) = (self.decay(), self.damped());
            let b = (v0 + l * e0) / wd;
            let (c, s, k) = (ops::cos(wd * t), ops::sin(wd * t), ops::exp(-l * t));
            let n = l * l + wd * wd;
            let ic = (k * (wd * s - l * c) + l) / n;
            let is = (k * (-l * s - wd * c) + wd) / n;
            e0 * ic + b * is
        } else if self.zeta == 1.0 {
            let w = self.w0;
            let c = v0 + w * e0;
            let k = ops::exp(-w * t);
            e0 * (1.0 - k) / w + c * (1.0 - k * (1.0 + w * t)) / (w * w)
        } else {
            let (r1, r2, c1, c2) = self.weights(e0, v0);
            c1 * (ops::exp(r1 * t) - 1.0) / r1 + c2 * (ops::exp(r2 * t) - 1.0) / r2
        }
    }

    /// The times in (0, `span`) where the displacement has an extreme: an underdamped spring's
    /// first two (every later one is smaller, its envelope decaying), the one an overdamped or
    /// critically damped spring may have, in closed form.
    pub fn extremes(&self, e0: f64, v0: f64, span: f64) -> [Option<f64>; 2] {
        let inside = |t: f64| (t > 0.0 && t < span && t.is_finite()).then_some(t);
        if self.zeta < 1.0 {
            let (l, wd) = (self.decay(), self.damped());
            let b = (v0 + l * e0) / wd;
            // rate ∝ v0·cos(ωd t) + q·sin(ωd t), zero where the angle is atan2(−v0, q) mod π.
            let q = -l * b - wd * e0;
            if v0 == 0.0 && q == 0.0 {
                return [None, None];
            }
            let r = ops::atan2(-v0, q).rem_euclid(ops::PI);
            let first = if r == 0.0 { ops::PI } else { r };
            [inside(first / wd), inside((first + ops::PI) / wd)]
        } else if self.zeta == 1.0 {
            let w = self.w0;
            let c = v0 + w * e0;
            [(c != 0.0).then(|| v0 / (w * c)).and_then(inside), None]
        } else {
            let (r1, r2, c1, c2) = self.weights(e0, v0);
            let ratio = -(c2 * r2) / (c1 * r1);
            [
                (c1 != 0.0 && ratio > 0.0)
                    .then(|| ops::log(ratio) / (r1 - r2))
                    .and_then(inside),
                None,
            ]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_decay_form_peaks_where_the_issue_says() {
        // #489: 0 → 1 with {decay: 6.5, omega: 15} and velocity 6.5 peaks at 1.2808, 0.1822 s in.
        let s = Spring::from_decay(6.5, 15.0);
        let [first, _] = s.extremes(-1.0, 6.5, 10.0);
        let t = first.unwrap();
        assert!((t - 0.1822).abs() < 5e-5, "{t}");
        assert!((1.0 + s.at(-1.0, 6.5, t).e - 1.2808).abs() < 5e-5);
        // From rest it reads 0.7374 at 0.1 s.
        assert!((1.0 + s.at(-1.0, 0.0, 0.1).e - 0.7374).abs() < 5e-5);
    }

    #[test]
    fn the_rate_and_the_integral_agree_with_the_value() {
        for zeta in [0.3, 1.0, 2.5] {
            let s = Spring::from_freq(1.5, zeta);
            let (e0, v0, t, h) = (0.7, -2.0, 0.4, 1e-6);
            let m = s.at(e0, v0, t);
            let slope = (s.at(e0, v0, t + h).e - s.at(e0, v0, t - h).e) / (2.0 * h);
            assert!((m.rate - slope).abs() < 1e-6, "ζ {zeta}");
            let area = (s.integral(e0, v0, t + h) - s.integral(e0, v0, t - h)) / (2.0 * h);
            assert!((m.e - area).abs() < 1e-6, "ζ {zeta}");
        }
    }
}
