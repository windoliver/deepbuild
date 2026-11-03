//! Lens dirt (canvas primitives: Look `look@1`: bloom, #418): the image the bloom's mix
//! multiplies its blurred light by, `1 + intensity × d`, stretched over the frame. `seeded` makes
//! it at check from a seed alone: soft spots and specks at hashed places and sizes, with no
//! asset, so one seed is always one image.

use deep_canvas::ops;

use crate::interp::{hash, Image};

/// A seeded image's size, stretched over whatever frame it lies on.
pub const SIZE: u32 = 256;
const SPOTS: u32 = 24;
const SPECKS: u32 = 64;

/// A hashed value in [0, 1) for `seed`, a mark and one of its lanes.
fn unit(seed: u32, mark: u32, lane: u32) -> f64 {
    f64::from(hash(&[seed, mark, lane]) >> 8) / 16_777_216.0
}

/// The seeded dirt image: each pixel's value from 0 to 1 in every lane.
pub fn seeded(seed: u32) -> Image {
    let n = SIZE as usize;
    let mut v = vec![0.0f64; n * n];
    let mut stamp = |mark: u32, r: [f64; 2], strength: [f64; 2]| {
        let cx = unit(seed, mark, 0) * f64::from(SIZE);
        let cy = unit(seed, mark, 1) * f64::from(SIZE);
        let radius = r[0] + (r[1] - r[0]) * unit(seed, mark, 2);
        let peak = strength[0] + (strength[1] - strength[0]) * unit(seed, mark, 3);
        let reach = radius.ceil() as i64 + 1;
        for y in (cy as i64 - reach).max(0)..(cy as i64 + reach).min(n as i64) {
            for x in (cx as i64 - reach).max(0)..(cx as i64 + reach).min(n as i64) {
                let dx = x as f64 + 0.5 - cx;
                let dy = y as f64 + 0.5 - cy;
                let t = ops::sqrt(dx * dx + dy * dy) / radius;
                if t < 1.0 {
                    // A smooth falloff: 1 at the centre, 0 at the edge.
                    let s = 1.0 - t * t;
                    let at = &mut v[y as usize * n + x as usize];
                    *at = (*at + peak * s * s).min(1.0);
                }
            }
        }
    };
    for k in 0..SPOTS {
        stamp(k, [10.0, 40.0], [0.15, 0.45]);
    }
    for k in 0..SPECKS {
        stamp(SPOTS + k, [0.8, 2.5], [0.5, 1.0]);
    }
    let mut img = Image::new(SIZE, SIZE);
    for (p, d) in img.px.iter_mut().zip(v) {
        *p = [d, d, d, 1.0];
    }
    img
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_seed_one_image() {
        assert_eq!(seeded(7), seeded(7));
        assert_ne!(seeded(7), seeded(8));
        let img = seeded(7);
        assert!(img.px.iter().all(|p| (0.0..=1.0).contains(&p[0])));
        assert!(img.px.iter().any(|p| p[0] > 0.1));
    }
}
