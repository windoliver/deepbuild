//! #1931: the three closed force laws on Rapier (canvas primitives: Force), each a push computed
//! once per step from the state at t(k), which the step then holds over its substeps, and the
//! planted wrong laws its criteria name.

use deep_canvas_physics::doc::Law;
use rapier3d::prelude::*;

use crate::{v3, Twin};

/// The push `law` at `strength` gives a body of mass `m` at `p` moving at `v`, N, over a step of
/// `dt` s; `others` are where the bodies the force applies to stand, in canonical order.
pub(crate) fn push(
    law: &Law,
    twin: Twin,
    strength: f32,
    (p, v, m): (Vector, Vector, f32),
    others: &[Vector],
    dt: f32,
) -> Vector {
    match *law {
        Law::InverseSquare {
            point,
            k,
            min_distance,
        } => {
            let d = p - v3(point);
            let r = d.length();
            if r == 0.0 {
                return Vector::ZERO;
            }
            // Inside min_distance the size holds at its value there.
            let held = r.max(min_distance as f32);
            let falls = if twin == Twin::LawFallsAsR {
                held
            } else {
                held * held
            };
            d * (strength * k as f32 / (r * falls))
        }
        Law::Magnetic { field, charge } => {
            let q = charge as f32;
            let b = match twin {
                Twin::LawTakesBv => v3(field) * -strength,
                _ => v3(field) * strength,
            };
            if twin == Twin::LawHoldsQvb {
                return v.cross(b) * q;
            }
            // The half-angle rotation: with t = (q·dt ÷ 2m) B and s = 2t ÷ (1 + t²), the velocity
            // after the step is v + (v + v × t) × s, a turn of v about B with no sine or cosine
            // that keeps its length; the push is the force that makes it over the step.
            let t = b * (q * dt / (2.0 * m));
            let s = t * (2.0 / (1.0 + t.length_squared()));
            (v + v.cross(t)).cross(s) * (m / dt)
        }
        Law::LennardJones {
            epsilon,
            sigma,
            cutoff,
        } => {
            let two = if twin == Twin::LawWithoutTwo {
                1.0
            } else {
                2.0
            };
            let pull = others.iter().fold(Vector::ZERO, |sum, o| {
                let d = p - *o;
                let r = d.length();
                // A body is no pair with itself, and a pair at one point has no line between.
                if r == 0.0 || (r >= cutoff as f32 && twin != Twin::LawWithoutCutoff) {
                    return sum;
                }
                let s2 = (sigma as f32 / r) * (sigma as f32 / r);
                let s6 = s2 * s2 * s2;
                sum + d * (24.0 * epsilon as f32 / (r * r) * (two * s6 * s6 - s6))
            });
            pull * strength
        }
    }
}
