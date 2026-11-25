//! Shadow tiles (#2034; canvas primitives: Light policy: local shadows): past the fixed counts,
//! every shaded key light with a shadow keeps one, as tiles in one local atlas sized by what the
//! view sees. A pure function of the view at t: no hysteresis, no history.

use crate::light::{Light, LightKind};
use crate::scene::Camera;

/// The local atlas's side in texels.
pub const ATLAS: u32 = 4096;
/// The tile sizes, largest first.
pub const SIZES: [u32; 4] = [1024, 512, 256, 128];
const LARGEST: u32 = SIZES[0];
const SMALLEST: u32 = SIZES[3];

/// One shadowed light's tiles: its index in the scene's lights, their side, and the slot of the
/// first of `count` (1 for a spot, 6 for a point or an area light), each slot counted at its size
/// in the atlas's Z order, so slot `s` at size `z` sits at [`origin`]`(z, s)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tile {
    pub light: usize,
    pub size: u32,
    pub first: u32,
    pub count: u32,
}

/// The wrong programs the tile table can be asked for, each a planted twin of the rule.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Slots fill in the order the scene holds its lights, not largest first with ties by ID.
    pub arrival_order: bool,
}

/// The tiles a light holds.
pub fn count(l: &Light) -> u32 {
    if l.kind == LightKind::Spot {
        1
    } else {
        6
    }
}

/// The diameter in pixels of `l`'s range sphere on `camera`'s frame, or `None` when the eye is
/// inside the sphere.
pub fn diameter(l: &Light, camera: &Camera) -> Option<f64> {
    let r = l.range;
    if !camera.perspective {
        return Some(2.0 * r * camera.scale);
    }
    let d = l
        .pos
        .iter()
        .zip(camera.eye)
        .map(|(a, b)| (a - b) * (a - b))
        .sum::<f64>();
    if d <= r * r {
        return None;
    }
    // The silhouette's half angle is asin(r ÷ d); on the axis it lands at scale × tan of it.
    Some(2.0 * camera.scale * r / (d - r * r).sqrt())
}

/// The tile size `l` asks for at `camera`: the smallest at least its range sphere's diameter in
/// pixels, the largest when none is or the eye is inside the sphere.
pub fn asked(l: &Light, camera: &Camera) -> u32 {
    match diameter(l, camera) {
        Some(px) if px.is_finite() => SIZES
            .iter()
            .rev()
            .copied()
            .find(|&s| f64::from(s) >= px)
            .unwrap_or(LARGEST),
        _ => LARGEST,
    }
}

/// The tile table at `camera` for the shadowed local lights `kept` (indices into `lights`): each
/// light's asked size; while the tiles cover more than the atlas, every light at the largest size
/// in use steps down one size; then slots fill largest first, ties by ID.
pub fn table(lights: &[Light], kept: &[usize], camera: &Camera, planted: Planted) -> Vec<Tile> {
    let sizes = kept.iter().map(|&i| asked(&lights[i], camera)).collect();
    fit(lights, kept, sizes, planted)
}

/// [`table`] from the sizes `kept` ask for, in its order.
pub fn fit(lights: &[Light], kept: &[usize], mut sizes: Vec<u32>, planted: Planted) -> Vec<Tile> {
    let area = |sizes: &[u32]| -> u64 {
        kept.iter()
            .zip(sizes)
            .map(|(&i, &s)| u64::from(count(&lights[i])) * u64::from(s) * u64::from(s))
            .sum()
    };
    while area(&sizes) > u64::from(ATLAS) * u64::from(ATLAS) {
        let top = sizes.iter().copied().max().unwrap_or(SMALLEST);
        if top <= SMALLEST {
            break;
        }
        for s in sizes.iter_mut().filter(|s| **s == top) {
            *s = top / 2;
        }
    }
    let mut order: Vec<usize> = (0..kept.len()).collect();
    if planted.arrival_order {
        order.sort_by_key(|&k| kept[k]);
    } else {
        order.sort_by(|&a, &b| {
            (sizes[b], &lights[kept[a]].id).cmp(&(sizes[a], &lights[kept[b]].id))
        });
    }
    // Filled largest first, each tile lands at a multiple of its own size in the Z order.
    let mut at = 0u64;
    let mut out = Vec::with_capacity(kept.len());
    for k in order {
        let (size, n) = (sizes[k], count(&lights[kept[k]]));
        let unit = u64::from(size / SMALLEST).pow(2);
        let first = at.div_ceil(unit);
        out.push(Tile {
            light: kept[k],
            size,
            first: first as u32,
            count: n,
        });
        at = (first + u64::from(n)) * unit;
    }
    out
}

/// Slot `slot`'s top-left texel at tile size `size`: its Z-order index split into x and y.
pub fn origin(size: u32, slot: u32) -> [u32; 2] {
    let half = |mut v: u32| {
        let mut out = 0;
        for bit in 0..16 {
            out |= (v & 1) << bit;
            v >>= 2;
        }
        out
    };
    [half(slot) * size, half(slot >> 1) * size]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lamp(id: &str, kind: &str, pos: [f64; 3], range: f64) -> Light {
        let params = serde_json::json!({"range": range, "shadow": true});
        let x = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        crate::light::light(id, kind, &params, pos, [0.0, -1.0, 0.0], x, 1.0).expect("a light")
    }

    fn camera(eye: [f64; 3]) -> Camera {
        Camera {
            size: [1920.0, 1080.0],
            eye,
            target: [0.0; 3],
            right: [1.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
            perspective: true,
            scale: 1000.0,
            centre: [960.0, 540.0],
            roll: [1.0, 0.0],
            near: 0.1,
            far: 0.0,
        }
    }

    #[test]
    fn a_light_asks_the_smallest_size_its_sphere_fits_and_the_largest_from_inside() {
        let l = lamp("a", "light.spot@1", [0.0; 3], 1.0);
        // 2 × 1000 × 1 ÷ √(d² − 1): 200 px at d ≈ 10.05 m.
        assert_eq!(asked(&l, &camera([0.0, 0.0, 10.05])), 256);
        assert_eq!(asked(&l, &camera([0.0, 0.0, 30.0])), 128);
        assert_eq!(asked(&l, &camera([0.0, 0.0, 3.0])), 1024);
        assert_eq!(asked(&l, &camera([0.0, 0.0, 0.5])), 1024);
    }

    #[test]
    fn thirty_two_points_step_down_to_256_and_fill_by_size_then_id() {
        let lights: Vec<Light> = (0..32)
            .map(|k| lamp(&format!("p{k:02}"), "light.point@1", [0.0; 3], 1.0))
            .collect();
        let kept: Vec<usize> = (0..32).rev().collect();
        let got = table(&lights, &kept, &camera([0.0, 0.0, 2.0]), Planted::default());
        assert!(got.iter().all(|t| t.size == 256 && t.count == 6));
        assert_eq!(got[0].light, 0);
        assert_eq!((got[31].light, got[31].first), (31, 186));
    }

    #[test]
    fn mixed_sizes_land_on_their_own_grid() {
        let lights = vec![
            lamp("b", "light.spot@1", [0.0; 3], 1.0),
            lamp("a", "light.spot@1", [0.0, 0.0, 40.0], 1.0),
            lamp("c", "light.spot@1", [0.0; 3], 1.0),
        ];
        let got = table(
            &lights,
            &[0, 1, 2],
            &camera([0.0, 0.0, 10.05]),
            Planted::default(),
        );
        // b and c ask 256 (slots 0 and 1), a sits in a 128 slot after them: 2 × 4 units in.
        let t: Vec<(usize, u32, u32)> = got.iter().map(|t| (t.light, t.size, t.first)).collect();
        assert_eq!(t, vec![(0, 256, 0), (2, 256, 1), (1, 128, 8)]);
        assert_eq!(origin(256, 1), [256, 0]);
        assert_eq!(origin(256, 2), [0, 256]);
        assert_eq!(origin(128, 9), [128, 256]);
    }
}
