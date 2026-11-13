//! Where a particle is born on its emit region (Particles `particles@1`: emit regions): hash(seed,
//! i) mapped in closed form to a uniform point in the region or on its surface, square roots for
//! disks and rings, cube roots for balls, and area- or volume-weighted choices among a box's
//! faces and a capsule's or a cylinder's parts. Each draw is the particle's own, so adding a
//! particle moves no other. The point, disk, ball and curve maps are the shipped graph's.

use deep_canvas::ops::{self, PI, TAU};

use super::spec::Shape;
use super::V3;

/// A particle's uniform draws in [0, 1) the region reads: the shipped graph's keys 5, 6 and 7, and
/// key 12 for a choice among parts.
#[derive(Clone, Copy, Debug)]
pub struct Draws {
    pub r5: f64,
    pub r6: f64,
    pub r7: f64,
    pub r12: f64,
}

fn rim(r: f64, th: f64, y: f64) -> V3 {
    [r * ops::cos(th), y, r * ops::sin(th)]
}

/// A unit direction: z uniform in [−1, 1], azimuth uniform.
fn direction(u: f64, v: f64) -> V3 {
    let zz = 2.0 * u - 1.0;
    let ss = ops::sqrt((1.0 - zz * zz).max(0.0));
    let ph = TAU * v;
    [ss * ops::cos(ph), zz, ss * ops::sin(ph)]
}

/// The birth point's offset from the emitter's origin, for every shape but a curve or a mesh
/// surface, which their own tables place.
pub fn offset(shape: &Shape, surface: bool, d: Draws) -> V3 {
    let Draws { r5, r6, r7, r12 } = d;
    match *shape {
        Shape::Point | Shape::Along(_) | Shape::Surface(_) => [0.0; 3],
        Shape::Disk(r) => {
            let rr = if surface { r } else { ops::sqrt(r5) * r };
            rim(rr, TAU * r6, 0.0)
        }
        Shape::Sphere(r) => {
            if surface {
                let [x, y, z] = direction(r6, r7);
                [x * r, y * r, z * r]
            } else {
                let [x, y, z] = direction(r6, r7);
                let br = ops::pow(r5, 1.0 / 3.0) * r;
                [x * br, y * br, z * br]
            }
        }
        Shape::Box(s) => {
            if !surface {
                return [(r5 - 0.5) * s[0], (r6 - 0.5) * s[1], (r7 - 0.5) * s[2]];
            }
            // Six faces by area: ±x, ±y, ±z, each pair the same area.
            let areas = [s[1] * s[2], s[0] * s[2], s[0] * s[1]];
            let total = 2.0 * (areas[0] + areas[1] + areas[2]);
            let mut pick = r12 * total;
            let mut face = 5;
            for f in 0..6 {
                if pick < areas[f / 2] {
                    face = f;
                    break;
                }
                pick -= areas[f / 2];
            }
            let axis = face / 2;
            let sign = if face % 2 == 0 { 0.5 } else { -0.5 };
            let (u, v) = ((r5 - 0.5), (r6 - 0.5));
            match axis {
                0 => [sign * s[0], u * s[1], v * s[2]],
                1 => [u * s[0], sign * s[1], v * s[2]],
                _ => [u * s[0], v * s[1], sign * s[2]],
            }
        }
        Shape::Ring { r, inner } => {
            let rr = if surface {
                if r12 * (r + inner) < r {
                    r
                } else {
                    inner
                }
            } else {
                ops::sqrt(inner * inner + r5 * (r * r - inner * inner))
            };
            rim(rr, TAU * r6, 0.0)
        }
        Shape::Cylinder { r, h } => {
            if !surface {
                return rim(ops::sqrt(r5) * r, TAU * r6, (r7 - 0.5) * h);
            }
            let (side, cap) = (TAU * r * h, PI * r * r);
            let pick = r12 * (side + 2.0 * cap);
            if pick < side {
                rim(r, TAU * r6, (r7 - 0.5) * h)
            } else {
                let y = if pick < side + cap { 0.5 * h } else { -0.5 * h };
                rim(ops::sqrt(r5) * r, TAU * r6, y)
            }
        }
        Shape::Capsule { r, h } => {
            let (tube, ball) = if surface {
                (TAU * r * h, 4.0 * PI * r * r)
            } else {
                (PI * r * r * h, 4.0 / 3.0 * PI * r * r * r)
            };
            if r12 * (tube + ball) < tube {
                let rr = if surface { r } else { ops::sqrt(r5) * r };
                return rim(rr, TAU * r6, (r7 - 0.5) * h);
            }
            let [x, y, z] = direction(r6, r7);
            let br = if surface {
                r
            } else {
                ops::pow(r5, 1.0 / 3.0) * r
            };
            let end = if y >= 0.0 { 0.5 * h } else { -0.5 * h };
            [x * br, y * br + end, z * br]
        }
    }
}

/// The region's box about the emitter's origin, as `[min, max]`: every point [`offset`] returns
/// lies in it.
pub fn extent(shape: &Shape) -> [V3; 2] {
    let half = |v: V3| [[-v[0], -v[1], -v[2]], v];
    match *shape {
        Shape::Point | Shape::Along(_) | Shape::Surface(_) => [[0.0; 3]; 2],
        Shape::Disk(r) | Shape::Ring { r, .. } => half([r, 0.0, r]),
        Shape::Sphere(r) => half([r, r, r]),
        Shape::Box(s) => half([0.5 * s[0], 0.5 * s[1], 0.5 * s[2]]),
        Shape::Cylinder { r, h } => half([r, 0.5 * h, r]),
        Shape::Capsule { r, h } => half([r, 0.5 * h + r, r]),
    }
}
