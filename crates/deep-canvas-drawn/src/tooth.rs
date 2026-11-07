//! A paper's tooth as a tile (Look `look@1`: paper): a height in 0..1 per texel, repeating on both
//! axes, built once per (kind, seed) from the public `noise@1` and `fbm@1` steps' functions in
//! pinned math, so a run's paper never depends on the frame it was first drawn in. The field pass
//! reads it at world positions, so an octave is a fixed pattern on the page.

use deep_canvas::ops;
use deep_canvas::steps::{fbm2, noise2};

/// The tile's side in texels, and how many texels one `scale` px of tooth spans at design size.
pub const TILE: usize = 512;
pub const TEXELS_PER_SCALE: f64 = 8.0;

/// The tile's side in teeth: every pattern below repeats within it.
const TEETH: u32 = (TILE as f64 / TEXELS_PER_SCALE) as u32;

const TAU: f64 = std::f64::consts::TAU;

/// The distance to the nearest of a jittered point per cell, on a `period` lattice, about 0..1.
pub fn cells(p: [f64; 2], seed: u32, period: u32) -> f64 {
    let (ix, iy) = (p[0].floor(), p[1].floor());
    let mut nearest = f64::MAX;
    let wrap = |v: i64| -> u32 { v.rem_euclid(i64::from(period.max(1))) as u32 };
    for dy in -1..=1i64 {
        for dx in -1..=1i64 {
            let (cx, cy) = (ix as i64 + dx, iy as i64 + dy);
            let h = lattice(wrap(cx), wrap(cy), seed);
            let (jx, jy) = (
                f64::from(h & 0xffff) / 65536.0,
                f64::from(h >> 16) / 65536.0,
            );
            let d = ops::hypot(cx as f64 + jx - p[0], cy as f64 + jy - p[1]);
            nearest = nearest.min(d);
        }
    }
    nearest.min(1.0)
}

fn lattice(x: u32, y: u32, seed: u32) -> u32 {
    let mix = |mut v: u32| {
        v = v.wrapping_mul(0x9e37_79b1);
        v ^ (v >> 15)
    };
    mix(mix(mix(seed ^ 0x5bd1_e995) ^ x) ^ y)
}

/// The height of tooth `kind` (an index in [`crate::spec::TEETH`]) at `p`, in teeth, before the
/// tile is normalized.
fn height(kind: u32, p: [f64; 2], seed: u32) -> f64 {
    let [x, y] = p;
    match kind {
        // Cold press: round pits over a soft swell.
        0 => {
            fbm2(p, seed, 3, 2.0, 0.55, TEETH)
                + 0.4 * (1.0 - 2.0 * cells([x * 0.5, y * 0.5], seed, TEETH / 2))
        }
        // Laid: close ribs crossed by wide chain lines.
        1 => {
            let ribs = ops::sin(TAU * y);
            let chain = ops::cos(TAU * x / 16.0);
            ribs + 0.6 * chain * chain * chain * chain + 0.5 * noise2(p, seed, TEETH)
        }
        // Wove: fine and even.
        2 => fbm2([x * 2.0, y * 2.0], seed, 2, 2.0, 0.5, TEETH * 2),
        // Canvas: an over-under weave.
        3 => weave(x, y, 0.0),
        // Linen: a weave whose threads wander.
        4 => {
            let wander = 0.35 * noise2([x / 4.0, y / 4.0], seed, TEETH / 4);
            weave(x + wander, y - wander, 0.4 * noise2(p, seed ^ 1, TEETH))
        }
        // Silk: long fine slubs along the warp.
        5 => {
            let slub = noise2([x / 8.0, y / 8.0], seed, TEETH / 8);
            ops::sin(TAU * (2.0 * y + 2.0 * slub))
                + 0.5 * noise2([x / 4.0, y / 4.0], seed, TEETH / 4)
        }
        // Stone: grains in cells.
        6 => {
            0.8 * (1.0 - 2.0 * cells([x / 2.0, y / 2.0], seed, TEETH / 2))
                + 0.6 * fbm2(p, seed ^ 2, 3, 2.0, 0.5, TEETH)
        }
        // Wood: rings that bend along the grain.
        _ => {
            let bend = 1.6 * noise2([x / 16.0, y / 16.0], seed, TEETH / 16);
            ops::sin(TAU * (x / 8.0 + bend)) + 0.35 * noise2(p, seed ^ 3, TEETH)
        }
    }
}

fn weave(x: f64, y: f64, grain: f64) -> f64 {
    let (a, b) = (
        ops::sin(std::f64::consts::PI * x),
        ops::sin(std::f64::consts::PI * y),
    );
    let thread = if a * b >= 0.0 { a.abs() } else { b.abs() };
    2.0 * thread - 1.0 + grain
}

/// Tooth `kind` as `TILE`² texels in rows from the top, stretched to 0..1.
pub fn tile(kind: u32, seed: u32) -> Vec<f32> {
    stretched(|p| height(kind, p, seed))
}

/// Four channels a pass reads per texel: the tooth, then a slow noise, cells and a fine noise that
/// fills read (starving, pinholes, granulation), all repeating with the tile.
pub fn channels(kind: u32, seed: u32) -> Vec<[f32; 4]> {
    let tooth = tile(kind, seed);
    let slow = stretched(|p| fbm2([p[0] / 4.0, p[1] / 4.0], seed ^ 5, 4, 2.0, 0.5, TEETH / 4));
    let holes = stretched(|p| cells(p, seed ^ 6, TEETH));
    let fine = stretched(|p| fbm2(p, seed ^ 7, 3, 2.0, 0.6, TEETH));
    (0..TILE * TILE)
        .map(|i| [tooth[i], slow[i], holes[i], fine[i]])
        .collect()
}

/// One box-filtered mip of a `side`² tile, each texel the mean of its four, wrapping nothing since
/// a tile's side is even.
pub fn halved(tile: &[[f32; 4]], side: usize) -> Vec<[f32; 4]> {
    let half = side / 2;
    let mut out = Vec::with_capacity(half * half);
    for row in 0..half {
        for col in 0..half {
            let mut sum = [0.0f32; 4];
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let t = tile[(row * 2 + dy) * side + col * 2 + dx];
                (0..4).for_each(|k| sum[k] += t[k] / 4.0);
            }
            out.push(sum);
        }
    }
    out
}

fn stretched(field: impl Fn([f64; 2]) -> f64) -> Vec<f32> {
    let mut out = Vec::with_capacity(TILE * TILE);
    for row in 0..TILE {
        for col in 0..TILE {
            let p = [
                (col as f64 + 0.5) / TEXELS_PER_SCALE,
                (row as f64 + 0.5) / TEXELS_PER_SCALE,
            ];
            out.push(field(p));
        }
    }
    let (lo, hi) = out
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
    let span = (hi - lo).max(1e-9);
    out.iter().map(|v| ((v - lo) / span) as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tooth_repeats_and_fills_its_range() {
        for kind in 0..8 {
            let t = tile(kind, 7);
            // The wrap is no sharper than the sharpest step inside the tile.
            let across = |a: usize, b: usize| {
                (0..TILE)
                    .map(|c| f64::from((t[a * TILE + c] - t[b * TILE + c]).abs()))
                    .fold(0.0, f64::max)
            };
            let inside = (0..TILE - 1).map(|r| across(r, r + 1)).fold(0.0, f64::max);
            let wrap = across(0, TILE - 1);
            assert!(
                wrap <= inside * 1.25,
                "tooth {kind} seam: {wrap} against {inside}"
            );
            let mean = t.iter().map(|v| f64::from(*v)).sum::<f64>() / t.len() as f64;
            assert!(mean > 0.15 && mean < 0.85, "tooth {kind} mean {mean}");
        }
    }

    #[test]
    fn a_seed_changes_a_noisy_tooth_and_only_a_seed_does() {
        assert_eq!(tile(0, 3), tile(0, 3));
        assert_ne!(tile(0, 3), tile(0, 4));
    }
}
