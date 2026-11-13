//! Turbulence from a curl-noise path table built at check (Particles `particles@1`: turbulence).
//! Each path starts at a hashed point and is integrated through the curl of three seeded
//! gradient-noise fields with a fixed-step fourth-order integrator in pinned math, so every
//! machine builds the same table. The table holds each path's offset from its start at every
//! step, scaled so the largest offset is 1: a particle adds its path's offset at its age times
//! the strength, so the strength is the farthest it wanders, in metres, and a doubled strength
//! doubles every offset.

use deep_canvas::expr::noise::noise;

use super::spec::Turbulence;
use super::{len, scale, V3};
use crate::interp::{hash, hash1};

/// A built table: `paths` paths of `steps + 1` offsets each, over `travel` seconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub paths: u32,
    pub steps: u32,
    pub travel: f64,
    /// Path p's offset at step k is `offsets[p × (steps + 1) + k]`.
    pub offsets: Vec<V3>,
}

/// The step a curl's central differences take, in noise cells.
const EPS: f64 = 1e-3;

fn curl(q: V3, seeds: [u32; 3]) -> V3 {
    let psi = |k: usize, p: V3| noise(&p, seeds[k]);
    let d = |k: usize, axis: usize| {
        let (mut a, mut b) = (q, q);
        a[axis] += EPS;
        b[axis] -= EPS;
        (psi(k, a) - psi(k, b)) / (2.0 * EPS)
    };
    [d(2, 1) - d(1, 2), d(0, 2) - d(2, 0), d(1, 0) - d(0, 1)]
}

/// The table for `t`, seeded by its own seed or else the item's: `steps` offsets a path, the
/// first at age 0 and the last at its travel.
pub fn build(t: &Turbulence, item_seed: u32, zero: bool) -> Table {
    let seed = t.seed.unwrap_or(item_seed);
    let seeds = [0u32, 1, 2].map(|k| hash(&[seed, 0x7475_7262, k]));
    let n = t.steps.max(1) as usize;
    let dt = t.travel / f64::from(t.steps.max(2) - 1);
    let f = t.frequency;
    // dx/da = curl ψ(f x): the field varies over 1 ÷ f metres.
    let field = |x: V3| curl(scale(x, f), seeds);
    let mut offsets = Vec::with_capacity(t.paths as usize * n);
    for p in 0..t.paths {
        let start: V3 = [0u32, 1, 2].map(|k| {
            f64::from(hash1(hash(&[seed, p, 3 + k])) >> 8) / f64::from(1u32 << 24) * 256.0 / f
        });
        let mut x = start;
        offsets.push([0.0; 3]);
        for _ in 1..n {
            let k1 = field(x);
            let k2 = field(add_scaled(x, k1, 0.5 * dt));
            let k3 = field(add_scaled(x, k2, 0.5 * dt));
            let k4 = field(add_scaled(x, k3, dt));
            for i in 0..3 {
                x[i] += dt / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
            }
            offsets.push([x[0] - start[0], x[1] - start[1], x[2] - start[2]]);
        }
    }
    let largest = offsets.iter().map(|o| len(*o)).fold(0.0, f64::max);
    if zero || largest == 0.0 {
        offsets.iter_mut().for_each(|o| *o = [0.0; 3]);
    } else {
        offsets
            .iter_mut()
            .for_each(|o| *o = scale(*o, 1.0 / largest));
    }
    Table {
        paths: t.paths,
        steps: n as u32,
        travel: t.travel,
        offsets,
    }
}

fn add_scaled(x: V3, v: V3, k: f64) -> V3 {
    [x[0] + v[0] * k, x[1] + v[1] * k, x[2] + v[2] * k]
}

impl Table {
    /// The path a particle of key `h` follows.
    pub fn path(&self, h: u32) -> u32 {
        hash1(hash(&[h, 11])) % self.paths.max(1)
    }

    /// Path `p`'s unit offset at `age`, read linearly between steps and held past its travel.
    pub fn at(&self, p: u32, age: f64) -> V3 {
        self.at_with_rate(p, age).0
    }

    /// Path `p`'s unit offset at `age` and its rate of change per second (0 past its travel).
    pub fn at_with_rate(&self, p: u32, age: f64) -> (V3, V3) {
        let n = self.steps as usize;
        let row = &self.offsets[p as usize * n..(p as usize + 1) * n];
        if n < 2 {
            return (row[0], [0.0; 3]);
        }
        let last = (n - 1) as f64;
        let raw = age / self.travel * last;
        let s = raw.clamp(0.0, last);
        let k = (s.floor() as usize).min(n - 2);
        let f = s - k as f64;
        let (a, b) = (row[k], row[k + 1]);
        let per = if raw >= 0.0 && raw < last {
            last / self.travel
        } else {
            0.0
        };
        (
            [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * f),
            [0, 1, 2].map(|i| (b[i] - a[i]) * per),
        )
    }

    /// The table as the kernel and a file hold it: each path's offsets in order, x, y and z as
    /// f32 little-endian.
    pub fn bytes(&self) -> Vec<u8> {
        self.offsets
            .iter()
            .flat_map(|o| o.iter().flat_map(|x| (*x as f32).to_le_bytes()))
            .collect()
    }

    /// The largest unit offset any path reaches: 1, or 0 for a table of zeros.
    pub fn reach(&self) -> f64 {
        self.offsets.iter().map(|o| len(*o)).fold(0.0, f64::max)
    }
}
