//! A noise selector's defaults and its amount: smooth value noise over the hashed lattice.

use super::*;

impl Default for Noise {
    fn default() -> Self {
        Noise {
            min: -1.0,
            max: 1.0,
            frequency: 2.0,
            correlation: 0.5,
            phase: 0.0,
            spatial_phase: 0.0,
            lock: false,
            seed: 0,
        }
    }
}

/// Smooth value noise along time for one lattice row: cosine-free smoothstep between steps.
fn row(seed: u64, unit: i64, x: f64) -> f64 {
    let k = x.floor();
    let f = x - k;
    let w = f * f * (3.0 - 2.0 * f);
    let k = k as i64;
    lattice(seed, unit, k) * (1.0 - w) + lattice(seed, unit, k + 1) * w
}

impl Noise {
    /// The amount for unit `i` at `t` seconds: a value shared by every unit, mixed by correlation
    /// with each unit's own, mapped from −1..1 onto min..max. Pure in (i, t, seed).
    pub fn amount(&self, i: usize, t: f64) -> f64 {
        let x = t * self.frequency + self.phase + self.spatial_phase / 360.0 * i as f64;
        let shared = row(self.seed, -1, x);
        let own = row(self.seed, i as i64, x);
        let c = self.correlation.clamp(0.0, 1.0);
        let v = (c * shared + (1.0 - c) * own).clamp(-1.0, 1.0);
        let v = if self.lock { shared } else { v };
        self.min + (v + 1.0) / 2.0 * (self.max - self.min)
    }
}
