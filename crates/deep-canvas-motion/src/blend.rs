//! How one placement's clip value lands on a path (canvas primitives: Placement; Placement:
//! order-free mix). A rotation always takes the shorter arc, so q and −q are one rotation, and a
//! weight of 1 or a clip at its reference changes nothing it shouldn't, bit for bit.

use crate::doc::{Blend, ValueType};
use crate::quat::{self, Arc};

/// `clip` over `slots` under `blend` at `weight`; `reference` is an add's reference pose.
pub fn over(blend: Blend, ty: ValueType, arc: Arc, weight: f64, clip: &[f64], reference: &[f64], slots: &mut [f64]) {
    if ty == ValueType::Quat {
        return turn(blend, arc, weight, clip, reference, slots);
    }
    let held = matches!(ty, ValueType::Bool | ValueType::Enum);
    match blend {
        _ if held => {
            if weight >= 0.5 {
                slots.copy_from_slice(clip);
            }
        }
        Blend::Replace | Blend::Mix if weight == 1.0 => slots.copy_from_slice(clip),
        Blend::Replace | Blend::Mix => {
            for (s, c) in slots.iter_mut().zip(clip) {
                let change = if ty == ValueType::Angle { shortest(*c - *s) } else { c - *s };
                *s += weight * change;
            }
        }
        Blend::Add => {
            for ((s, c), r) in slots.iter_mut().zip(clip).zip(reference) {
                *s += weight * (c - r);
            }
        }
        Blend::Multiply => {
            for (s, c) in slots.iter_mut().zip(clip) {
                *s *= 1.0 + weight * (c - 1.0);
            }
        }
    }
}

fn turn(blend: Blend, arc: Arc, weight: f64, clip: &[f64], reference: &[f64], slots: &mut [f64]) {
    let (now, q) = (quat::of(slots), quat::of(clip));
    let out = match blend {
        Blend::Replace | Blend::Mix => quat::blend(arc, now, q, weight),
        Blend::Add => {
            let reference = quat::of(reference);
            if q == reference {
                return;
            }
            quat::mul(now, quat::slerp(quat::IDENTITY, quat::mul(quat::inverse(reference), q), weight))
        }
        Blend::Multiply => quat::mul(now, quat::slerp(quat::IDENTITY, q, weight)),
    };
    slots.copy_from_slice(&out);
}

/// A mix placement's weighted difference from the base, added to `sum`; a quaternion joins aligned
/// to the base.
pub fn mix_in(turns: bool, weight: f64, clip: &[f64], base: &[f64], sum: &mut [f64]) {
    if turns {
        let q = quat::aligned(quat::of(clip), quat::of(base));
        for (k, s) in sum.iter_mut().enumerate() {
            *s += weight * (q[k] - base[k]);
        }
        return;
    }
    for ((s, c), b) in sum.iter_mut().zip(clip).zip(base) {
        *s += weight * (c - b);
    }
}

/// The turn in (−180, 180] that reaches a change of `degrees`.
fn shortest(degrees: f64) -> f64 {
    (degrees + 180.0).rem_euclid(360.0) - 180.0
}
