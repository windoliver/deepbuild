//! The light policy's clusters (#446; Light and the light policy): above eight lights, each
//! screen tile and depth slice lists the shaded lights that can reach it, as bits of their place
//! in the policy's order, so a pixel walks its list by score bucket, then light ID. The grid is a
//! pure function of this frame's lights and view: nothing is carried from an earlier frame.

use deep_canvas::camera::Vec3;
use deep_canvas::ops;

use crate::light::{Light, LightKind, Policy};
use crate::scene::Camera;

pub const TILES: [usize; 2] = [16, 9];
pub const SLICES: usize = 24;
pub const CELLS: usize = TILES[0] * TILES[1] * SLICES;
/// Lights a frame walks without a grid.
pub const FLAT: usize = 8;

/// The grid: its far plane, and each cell's lights as bits of their index in the policy's list.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    pub far: f64,
    pub cells: Vec<u32>,
}

/// A slice's near depth: slices grow by a fixed ratio from the near plane to the far one.
fn slice_near(s: usize, near: f64, far: f64) -> f64 {
    near * ops::pow(far / near, s as f64 / SLICES as f64)
}

/// Whether a light reaches every pixel however far it is: a sun, or an area light, which doesn't
/// end at its range.
fn everywhere(l: &Light) -> bool {
    !l.range.is_finite() || matches!(l.kind, LightKind::Sun | LightKind::Area)
}

/// The grid at a perspective view, `None` at eight lights or fewer or in an orthographic view.
pub fn grid(lights: &[Light], policy: &Policy, cam: &Camera, size: [u32; 2]) -> Option<Grid> {
    if policy.shaded.len() <= FLAT || !cam.perspective {
        return None;
    }
    let near = cam.near.max(1e-3);
    // The far plane: the farthest any shaded light's range reaches ahead of the eye.
    let reach = |l: &Light| cam.to_view(l.pos)[2] + l.range;
    let far = policy
        .shaded
        .iter()
        .map(|&(i, _)| &lights[i])
        .filter(|l| !everywhere(l))
        .map(reach)
        .fold(near * 2.0, f64::max);
    let mut cells = vec![0u32; CELLS];
    let tile = [
        f64::from(size[0]) / TILES[0] as f64,
        f64::from(size[1]) / TILES[1] as f64,
    ];
    for (bit, &(i, _)) in policy.shaded.iter().enumerate() {
        let l = &lights[i];
        let mark = 1u32 << bit;
        if everywhere(l) {
            cells.iter_mut().for_each(|c| *c |= mark);
            continue;
        }
        let v = cam.to_view(l.pos);
        for s in 0..SLICES {
            let (z0, z1) = (slice_near(s, near, far), slice_near(s + 1, near, far));
            let dz = (z0 - v[2]).max(v[2] - z1).max(0.0);
            if dz > l.range && s + 1 < SLICES {
                continue;
            }
            for y in 0..TILES[1] {
                for x in 0..TILES[0] {
                    // The tile's box at this slice, around the light's nearest point in it.
                    let corner = |px: [f64; 2], z: f64| -> Vec3 {
                        cam.to_view(cam.unproject(px[0], px[1], z))
                    };
                    let (lo_px, hi_px) = (
                        [x as f64 * tile[0], y as f64 * tile[1]],
                        [(x + 1) as f64 * tile[0], (y + 1) as f64 * tile[1]],
                    );
                    let mut lo = [f64::MAX; 2];
                    let mut hi = [f64::MIN; 2];
                    for (px, z) in [
                        (lo_px, z0),
                        (lo_px, z1),
                        (hi_px, z0),
                        (hi_px, z1),
                        ([lo_px[0], hi_px[1]], z0),
                        ([lo_px[0], hi_px[1]], z1),
                        ([hi_px[0], lo_px[1]], z0),
                        ([hi_px[0], lo_px[1]], z1),
                    ] {
                        let c = corner(px, z);
                        for a in 0..2 {
                            lo[a] = lo[a].min(c[a]);
                            hi[a] = hi[a].max(c[a]);
                        }
                    }
                    let dx = (lo[0] - v[0]).max(v[0] - hi[0]).max(0.0);
                    let dy = (lo[1] - v[1]).max(v[1] - hi[1]).max(0.0);
                    if dx * dx + dy * dy + dz * dz <= l.range * l.range {
                        cells[(s * TILES[1] + y) * TILES[0] + x] |= mark;
                    }
                }
            }
        }
    }
    Some(Grid { far, cells })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::light::light;
    use serde_json::json;

    fn camera() -> Camera {
        Camera {
            eye: [0.0, 0.0, 0.0],
            right: [1.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
            size: [160.0, 90.0],
            perspective: true,
            scale: 80.0,
            centre: [80.0, 45.0],
            roll: [1.0, 0.0],
            near: 0.1,
            far: 100.0,
        }
    }

    fn lamp(id: &str, pos: Vec3, range: f64) -> Light {
        let axes = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        light(
            id,
            "light.point@1",
            &json!({"power": 800, "range": range}),
            pos,
            [0.0, -1.0, 0.0],
            axes,
            1.0,
        )
        .unwrap()
    }

    #[test]
    fn a_cell_lists_the_lamps_that_reach_it_and_no_more() {
        let lights: Vec<Light> = (0..9)
            .map(|i| lamp(&format!("l{i}"), [i as f64 * 4.0 - 16.0, 0.0, -10.0], 1.0))
            .collect();
        let policy = Policy {
            shaded: (0..9).map(|i| (i, 1.0)).collect(),
            left_out: Vec::new(),
        };
        let g = grid(&lights, &policy, &camera(), [160, 90]).unwrap();
        assert!(
            (g.far - 11.0).abs() < 1e-9,
            "the far plane is this frame's: {}",
            g.far
        );
        // At every pixel of a lamp's sphere the lamp's bit is set.
        for (bit, l) in lights.iter().enumerate() {
            let [x, y, z] = camera().project(l.pos).unwrap();
            let s = (ops::log(z / 0.1) / ops::log(g.far / 0.1) * SLICES as f64) as usize;
            if (0.0..160.0).contains(&x) {
                let (tx, ty) = (x as usize * TILES[0] / 160, y as usize * TILES[1] / 90);
                assert_ne!(g.cells[(s * TILES[1] + ty) * TILES[0] + tx] & (1 << bit), 0);
            }
        }
        // Most cells hold no lamp at all.
        let empty = g.cells.iter().filter(|c| **c == 0).count();
        assert!(empty > CELLS / 2, "only {empty} of {CELLS} cells are empty");
    }

    #[test]
    fn eight_lights_walk_flat() {
        let lights: Vec<Light> = (0..8)
            .map(|i| lamp(&format!("l{i}"), [0.0; 3], 1.0))
            .collect();
        let policy = Policy {
            shaded: (0..8).map(|i| (i, 1.0)).collect(),
            left_out: Vec::new(),
        };
        assert_eq!(grid(&lights, &policy, &camera(), [160, 90]), None);
    }
}
