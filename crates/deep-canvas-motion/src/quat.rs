//! Unit quaternions `[x, y, z, w]` for rotation channels and placement blends (canvas primitives:
//! Channel and key: quat; Placement). q and −q are one rotation, so every blend aligns signs first
//! and takes the shorter arc.

use deep_canvas::ops;

pub type Quat = [f64; 4];

pub const IDENTITY: Quat = [0.0, 0.0, 0.0, 1.0];

/// The Hamilton product `a · b`.
pub fn mul(a: Quat, b: Quat) -> Quat {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

/// The inverse of a unit quaternion.
pub fn inverse(q: Quat) -> Quat {
    [-q[0], -q[1], -q[2], q[3]]
}

pub fn dot(a: Quat, b: Quat) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

/// `q` at unit length; the identity for a zero quaternion.
pub fn normalized(q: Quat) -> Quat {
    let n = ops::sqrt(dot(q, q));
    if n == 0.0 {
        return IDENTITY;
    }
    q.map(|c| c / n)
}

/// `q` or `−q`, whichever lies on `to`'s side.
pub fn aligned(q: Quat, to: Quat) -> Quat {
    if dot(q, to) < 0.0 {
        q.map(|c| -c)
    } else {
        q
    }
}

/// The shorter arc from `a` to `b` at `w`, exact at both ends' weights.
pub fn slerp(a: Quat, b: Quat, w: f64) -> Quat {
    if w == 0.0 {
        return a;
    }
    let b = aligned(b, a);
    if w == 1.0 {
        return b;
    }
    let cos = dot(a, b).clamp(-1.0, 1.0);
    // Nearly one rotation: the arc is its chord.
    if cos > 1.0 - 1e-12 {
        return normalized(std::array::from_fn(|k| a[k] + (b[k] - a[k]) * w));
    }
    let theta = ops::acos(cos);
    let (sa, sb) = (ops::sin((1.0 - w) * theta), ops::sin(w * theta));
    let s = ops::sin(theta);
    normalized(std::array::from_fn(|k| (a[k] * sa + b[k] * sb) / s))
}

/// How a rotation blends: `Short` is the program; the others are #492's planted twins.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Arc {
    #[default]
    Short,
    /// The arc the other way round.
    Long,
    /// Per component, unaligned.
    Chord,
}

/// `a` to `b` at `w` along `arc`.
pub fn blend(arc: Arc, a: Quat, b: Quat, w: f64) -> Quat {
    match arc {
        Arc::Short => slerp(a, b, w),
        Arc::Long => {
            let away = if dot(a, b) > 0.0 { b.map(|c| -c) } else { b };
            let theta = ops::acos(dot(a, away).clamp(-1.0, 1.0));
            let (sa, sb) = (ops::sin((1.0 - w) * theta), ops::sin(w * theta));
            let s = ops::sin(theta);
            std::array::from_fn(|k| (a[k] * sa + away[k] * sb) / s)
        }
        Arc::Chord => std::array::from_fn(|k| a[k] + (b[k] - a[k]) * w),
    }
}

/// The slot run `run` as a quaternion.
pub fn of(run: &[f64]) -> Quat {
    std::array::from_fn(|k| run[k])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn q_and_minus_q_are_one_rotation_and_an_arc_stays_short() {
        let half = ops::rad(30.0);
        let q = [0.0, 0.0, ops::sin(half), ops::cos(half)];
        let minus = q.map(|c| -c);
        assert_eq!(slerp(q, minus, 0.5), q);
        let mid = slerp(IDENTITY, minus, 0.5);
        let quarter = ops::rad(15.0);
        assert!((mid[2] - ops::sin(quarter)).abs() < 1e-12, "{mid:?}");
        assert!((mid[3] - ops::cos(quarter)).abs() < 1e-12, "{mid:?}");
    }
}
