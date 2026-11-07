//! Motion's constraint kinds (canvas primitives: Constraint), each an entry of the core's
//! `constraint@1`: child_of, follow_path, look_at, copy, limit, reach2, follow_tip, distance,
//! spring_chain and rest_on. Each solve is closed form with a fixed op count: it runs after the
//! reads it declares, never iterates and never reads an earlier frame, so seeking equals playing.

use deep_canvas::ops;

use crate::spring::Spring;

pub type Vec3 = [f64; 3];

/// An item's transform: position, Euler rotation in degrees (R = Rz·Ry·Rx) and scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub pos: Vec3,
    pub rot: Vec3,
    pub scale: Vec3,
}

impl Default for Pose {
    fn default() -> Pose {
        Pose {
            pos: [0.0; 3],
            rot: [0.0; 3],
            scale: [1.0; 3],
        }
    }
}

/// Counts a solve's arithmetic, so the kit can see an op count that varies with its input.
#[derive(Clone, Copy, Debug, Default)]
pub struct Ops(pub u64);

impl Ops {
    fn n(&mut self, k: u64) {
        self.0 += k;
    }
}

/// Which transform group a copy or a limit acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum What {
    Location,
    Rotation,
    Scale,
}

impl What {
    pub fn parse(s: &str) -> Option<What> {
        Some(match s {
            "location" => What::Location,
            "rotation" => What::Rotation,
            "scale" => What::Scale,
            _ => return None,
        })
    }

    /// The group's index among pos, rot and scale.
    pub fn group(self) -> usize {
        self as usize
    }
}

fn group(p: &mut Pose, what: What) -> &mut Vec3 {
    match what {
        What::Location => &mut p.pos,
        What::Rotation => &mut p.rot,
        What::Scale => &mut p.scale,
    }
}

/// `R = Rz·Ry·Rx` applied to `v`, angles in degrees.
pub fn rotate(rot: Vec3, v: Vec3, ops_: &mut Ops) -> Vec3 {
    let (sx, cx) = (ops::sin(ops::rad(rot[0])), ops::cos(ops::rad(rot[0])));
    let (sy, cy) = (ops::sin(ops::rad(rot[1])), ops::cos(ops::rad(rot[1])));
    let (sz, cz) = (ops::sin(ops::rad(rot[2])), ops::cos(ops::rad(rot[2])));
    let a = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
    let b = [cy * a[0] + sy * a[2], a[1], -sy * a[0] + cy * a[2]];
    ops_.n(24);
    [cz * b[0] - sz * b[1], sz * b[0] + cz * b[1], b[2]]
}

/// A child's world pose under `parent`: scale, rotate, then add the parent's position.
pub fn child_of(parent: &Pose, own: &Pose, ops_: &mut Ops) -> Pose {
    let scaled = [
        own.pos[0] * parent.scale[0],
        own.pos[1] * parent.scale[1],
        own.pos[2] * parent.scale[2],
    ];
    let r = rotate(parent.rot, scaled, ops_);
    ops_.n(12);
    Pose {
        pos: [
            parent.pos[0] + r[0],
            parent.pos[1] + r[1],
            parent.pos[2] + r[2],
        ],
        rot: [
            parent.rot[0] + own.rot[0],
            parent.rot[1] + own.rot[1],
            parent.rot[2] + own.rot[2],
        ],
        scale: [
            parent.scale[0] * own.scale[0],
            parent.scale[1] * own.scale[1],
            parent.scale[2] * own.scale[2],
        ],
    }
}

/// Whether an aim at `target` has no heading: zero, or parallel to the up axis.
pub fn aimless(own: &Pose, target: Vec3) -> bool {
    let d = [target[0] - own.pos[0], target[1] - own.pos[1], target[2] - own.pos[2]];
    let flat = ops::hypot(d[0], d[1]);
    flat <= 1e-9 * (flat + d[2].abs()) || flat == 0.0
}

/// Turns `own` so its +X axis points at `target`: yaw about Z and pitch about Y, in degrees. An
/// aim with no heading takes the fixed basis, yaw and pitch 0 (`look_at_degenerate`).
pub fn look_at(own: &Pose, target: Vec3, ops_: &mut Ops) -> Pose {
    let d = [
        target[0] - own.pos[0],
        target[1] - own.pos[1],
        target[2] - own.pos[2],
    ];
    let flat = ops::hypot(d[0], d[1]);
    ops_.n(10);
    if aimless(own, target) {
        return Pose { rot: [own.rot[0], 0.0, 0.0], ..*own };
    }
    Pose {
        rot: [
            own.rot[0],
            ops::deg(ops::atan2(-d[2], flat)),
            ops::deg(ops::atan2(d[1], d[0])),
        ],
        ..*own
    }
}

/// Copies one transform group from `target`.
pub fn copy(own: &Pose, what: What, target: &Pose, ops_: &mut Ops) -> Pose {
    let mut out = *own;
    let mut from = *target;
    *group(&mut out, what) = *group(&mut from, what);
    ops_.n(3);
    out
}

/// Holds one group within per-axis bounds.
pub fn limit(own: &Pose, what: What, bounds: &[Option<(f64, f64)>; 3], ops_: &mut Ops) -> Pose {
    let mut out = *own;
    let g = group(&mut out, what);
    for (k, b) in bounds.iter().enumerate() {
        if let Some((lo, hi)) = b {
            g[k] = g[k].clamp(*lo, *hi);
        }
    }
    ops_.n(6);
    out
}

/// Keeps `own` between `min` and `max` from `target`, moving it along the line between them.
pub fn distance(own: &Pose, target: Vec3, min: f64, max: f64, ops_: &mut Ops) -> Pose {
    let d = [
        own.pos[0] - target[0],
        own.pos[1] - target[1],
        own.pos[2] - target[2],
    ];
    let len = ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    ops_.n(16);
    let want = len.clamp(min, max);
    // At the target itself there is no line: it stays.
    let k = if len > 0.0 { want / len } else { 1.0 };
    Pose {
        pos: [
            target[0] + d[0] * k,
            target[1] + d[1] * k,
            target[2] + d[2] * k,
        ],
        ..*own
    }
}

/// A path's arc-length table, built once per path: each point's distance from the first.
#[derive(Clone, Debug, PartialEq)]
pub struct ArcTable {
    pub points: Vec<[f64; 2]>,
    pub lengths: Vec<f64>,
}

impl ArcTable {
    pub fn new(points: Vec<[f64; 2]>) -> ArcTable {
        let mut lengths = Vec::with_capacity(points.len());
        let mut run = 0.0;
        for (i, p) in points.iter().enumerate() {
            if i > 0 {
                let q = points[i - 1];
                run += ops::hypot(p[0] - q[0], p[1] - q[1]);
            }
            lengths.push(run);
        }
        ArcTable { points, lengths }
    }

    /// The point at `fraction` of the length and the heading there in degrees, by one binary
    /// search over the table: O(log S), the same count for every fraction.
    pub fn at(&self, fraction: f64, ops_: &mut Ops) -> ([f64; 2], f64) {
        let n = self.points.len();
        if n < 2 {
            return (self.points.first().copied().unwrap_or([0.0; 2]), 0.0);
        }
        let total = self.lengths[n - 1];
        let want = fraction.clamp(0.0, 1.0) * total;
        let i = self
            .lengths
            .partition_point(|l| *l <= want)
            .clamp(1, n - 1);
        // A binary search over n points takes ⌈log2 n⌉ comparisons whatever it looks for.
        ops_.n(u64::from(u64::BITS - (n as u64).leading_zeros()) + 12);
        let (a, b) = (self.points[i - 1], self.points[i]);
        let span = self.lengths[i] - self.lengths[i - 1];
        let u = if span > 0.0 {
            (want - self.lengths[i - 1]) / span
        } else {
            0.0
        };
        (
            [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
            ops::deg(ops::atan2(b[1] - a[1], b[0] - a[0])),
        )
    }
}

/// Puts `own` at `fraction` along the path, plus `offset`, turned to its heading when `orient`.
pub fn follow_path(
    own: &Pose,
    table: &ArcTable,
    fraction: f64,
    orient: bool,
    offset: [f64; 2],
    ops_: &mut Ops,
) -> Pose {
    let (p, heading) = table.at(fraction, ops_);
    let mut out = *own;
    out.pos[0] = p[0] + offset[0];
    out.pos[1] = p[1] + offset[1];
    if orient {
        out.rot[2] = heading;
    }
    out
}

/// A pen's tip: `own` rides the point of `tip` (where the pen draws at this time), plus
/// `offset`, turned to the stroke's heading when `rotate`.
pub fn follow_tip(own: &Pose, tip: [f64; 2], heading: f64, offset: [f64; 2], rotate: bool, ops_: &mut Ops) -> Pose {
    let mut out = *own;
    out.pos[0] = tip[0] + offset[0];
    out.pos[1] = tip[1] + offset[1];
    if rotate {
        out.rot[2] = heading;
    }
    ops_.n(4);
    out
}

/// A solved two-bone chain in 2D: each bone's world angle in degrees, the elbow, the end and the
/// scale both bones take.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reach {
    pub upper: f64,
    pub lower: f64,
    pub elbow: [f64; 2],
    pub end: [f64; 2],
    pub stretch: f64,
    /// The target is past the chain's length and it doesn't stretch: it points straight at it.
    pub short: bool,
}

/// Two-bone reach from `root` toward `target`, analytically by the law of cosines, its bend side
/// fixed by `bend` (1 or −1) at every frame; with `cartoon`, both bones scale by
/// max(1, d ÷ (l1 + l2)) instead of falling short.
pub fn reach2(root: [f64; 2], lengths: [f64; 2], target: [f64; 2], bend: f64, cartoon: bool, ops_: &mut Ops) -> Reach {
    let [l1, l2] = lengths;
    let (dx, dy) = (target[0] - root[0], target[1] - root[1]);
    let d = ops::hypot(dx, dy);
    let aim = ops::atan2(dy, dx);
    let reach = l1 + l2;
    let stretch = if cartoon { (d / reach).max(1.0) } else { 1.0 };
    let (a, b) = (l1 * stretch, l2 * stretch);
    // The distance the chain can span, between |a − b| and a + b.
    let span = d.clamp((a - b).abs(), a + b);
    let cos_root = if span > 0.0 {
        ((a * a + span * span - b * b) / (2.0 * a * span)).clamp(-1.0, 1.0)
    } else {
        1.0
    };
    let side = if bend < 0.0 { -1.0 } else { 1.0 };
    let upper = aim + side * ops::acos(cos_root);
    let elbow = [root[0] + a * ops::cos(upper), root[1] + a * ops::sin(upper)];
    let end_aim = [root[0] + span * ops::cos(aim), root[1] + span * ops::sin(aim)];
    let lower = ops::atan2(end_aim[1] - elbow[1], end_aim[0] - elbow[0]);
    ops_.n(40);
    Reach {
        upper: ops::deg(upper),
        lower: ops::deg(lower),
        elbow,
        end: [elbow[0] + b * ops::cos(lower), elbow[1] + b * ops::sin(lower)],
        stretch,
        short: !cartoon && d > reach,
    }
}

/// Rests `own` on the ground plane `ground` along −Y: its lowest point, `bottom` below its
/// position, touches the plane, unless that drop is more than `max_drop`.
pub fn rest_on(own: &Pose, bottom: f64, ground: f64, offset: f64, max_drop: f64, ops_: &mut Ops) -> Option<Pose> {
    let low = own.pos[1] - bottom;
    let drop = low - ground;
    ops_.n(4);
    if drop.abs() > max_drop {
        return None;
    }
    let mut out = *own;
    out.pos[1] = ground + bottom + offset;
    Some(out)
}

/// A spring chain's bake: each bone's swing away from its animated angle, solved exactly over
/// each 120 Hz step from its parent's angular acceleration, stored per step. A frame reads it at
/// t by interpolating between stored steps: nothing integrates while a frame draws.
#[derive(Clone, Debug, PartialEq)]
pub struct SpringBake {
    pub step: f64,
    pub swings: Vec<f64>,
    pub max_swing: f64,
}

impl SpringBake {
    /// Bakes one bone swinging behind `drive` (its parent's angle in degrees at a time in
    /// seconds) over `[0, seconds]`, a damped spring of `hz` and `damping_ratio`.
    pub fn bake(drive: impl Fn(f64) -> f64, seconds: f64, hz: f64, damping_ratio: f64, max_swing: f64) -> SpringBake {
        let step = 1.0 / 120.0;
        let n = (seconds / step).ceil() as usize + 1;
        let spring = Spring::from_freq(hz, damping_ratio);
        let mut swings = Vec::with_capacity(n);
        let (mut e, mut v) = (0.0_f64, 0.0_f64);
        for k in 0..n {
            swings.push(e.clamp(-max_swing, max_swing));
            let t = k as f64 * step;
            // The parent's angular acceleration over the step, by its second difference: the
            // swing feels it as a constant force, so the step's solve is exact.
            let accel = (drive(t + step) - 2.0 * drive(t) + drive((t - step).max(0.0))) / (step * step);
            let shift = -accel / (spring.w0 * spring.w0);
            let m = spring.at(e - shift, v, step);
            e = shift + m.e;
            v = m.rate;
        }
        SpringBake {
            step,
            swings,
            max_swing,
        }
    }

    /// The swing at `seconds`, between its two stored steps.
    pub fn at(&self, seconds: f64, ops_: &mut Ops) -> f64 {
        ops_.n(6);
        let x = (seconds / self.step).max(0.0);
        let k = x.floor() as usize;
        let last = self.swings.len().saturating_sub(1);
        let (a, b) = (self.swings[k.min(last)], self.swings[(k + 1).min(last)]);
        a + (b - a) * (x - x.floor())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cartoon_reach_past_its_length_stretches_both_bones_by_the_same_share() {
        let mut o = Ops::default();
        let r = reach2([0.0, 0.0], [3.0, 2.0], [8.0, 6.0], 1.0, true, &mut o);
        assert_eq!(r.stretch, 2.0);
        assert!((r.end[0] - 8.0).abs() < 1e-12 && (r.end[1] - 6.0).abs() < 1e-12);
        let within = reach2([0.0, 0.0], [3.0, 2.0], [3.0, 1.0], -1.0, true, &mut o);
        assert_eq!(within.stretch, 1.0);
        assert!((within.end[0] - 3.0).abs() < 1e-12 && (within.end[1] - 1.0).abs() < 1e-12);
    }
}
