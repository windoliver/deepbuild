//! #2241: belts. A contact material's `tangent_speed` on a static or kinematic body's shape use is
//! the speed its surface carries what rests on it. Rapier's solver takes a surface velocity for
//! each contact through the contact hook a wrapper installs, so this one fills it from the
//! material: the speed rides in the collider's `user_data`, which the world's bytes carry, so a
//! restored world carries as the one that wrote the checkpoint did, and no document holds code.
//!
//! #2317: the same hook keeps a pair's contacts found from its two bodies' poses at every step.
//! Rapier keeps a pair's contact points, fixed in the world, while its bodies have moved less
//! than a twentieth of its length against each other, and never for a pair under a hook. So a
//! body resting on one that turns was held by points the turn had left behind, and slid off.
//! The hook is active, carrying nothing, on every shape use of a kinematic body and of a dynamic
//! body a hinge's motor turns. A dynamic body thinner than that distance, the one the lint
//! `physics.small_body` names of kind `unit`, could slide its whole size on points it has left:
//! it is under the hook for the one step after it has moved the same share of its own thinnest
//! extent from where its contacts were last found, and that place and that length ride in its
//! body's `user_data`, which the world's bytes carry. Every other pair keeps its points, as a
//! stack of small things at rest needs.

use deep_canvas_physics::doc::{Body, BodyKind, JointKind, World};
use rapier3d::prelude::*;

use crate::runner::contact::Small;
use crate::Twin;

/// A world's contact hook: each belt's surface velocity, on every contact of its shape use.
pub(crate) struct Belts {
    pub twin: Twin,
    /// The world's up, which the planted level belt flattens its direction against.
    pub up: Vector,
}

/// `c` as a belt carrying at `speed` m/s; under the planted wrapper without the hook, `c` as it
/// is. #2317: `anew`, `c` under the hook whatever its speed, so no pair it is in keeps its points.
pub(crate) fn carrying(c: ColliderBuilder, speed: f64, anew: bool, twin: Twin) -> ColliderBuilder {
    let speed = speed as f32;
    let belt = speed != 0.0 && twin != Twin::BeltWithoutHook;
    if !belt && !anew {
        return c;
    }
    let c = c.active_hooks(ActiveHooks::MODIFY_SOLVER_CONTACTS);
    if belt {
        c.user_data(u128::from(speed.to_bits()))
    } else {
        c
    }
}

/// #2317: whether body `id` of `w` turns what rests on it: a kinematic body, or a dynamic one a
/// hinge's motor turns. Never under the planted wrapper that leaves the backend's reuse as it is.
pub(crate) fn turns(w: &World, id: &str, twin: Twin) -> bool {
    let motor = || {
        let hinges = w.joints.values().filter(|j| j.kind == JointKind::Hinge);
        let ends = hinges
            .filter(|j| j.motor.is_some())
            .flat_map(|j| [&j.a, &j.b]);
        ends.into_iter().any(|e| e.body.as_deref() == Some(id))
    };
    twin != Twin::Small(Small::ReuseKept)
        && match w.bodies[id].kind {
            BodyKind::Kinematic => true,
            BodyKind::Dynamic => motor(),
            _ => false,
        }
}

/// #2317: the share of its length within which Rapier keeps a pair's contact points: its own,
/// or none under the planted wrapper that turns its reuse off for every world.
pub(crate) fn reused(twin: Twin) -> f32 {
    match twin {
        Twin::Small(Small::ReuseOff) => 0.0,
        _ => IntegrationParameters::default().normalized_contact_recycle_distance,
    }
}

/// A length, m, and a place: a body's `user_data`, the length in its top 32 bits.
fn packed(length: f32, at: Vector) -> u128 {
    let bits = [length, at.x, at.y, at.z].map(|x| u128::from(x.to_bits()));
    bits[0] << 96 | bits[1] << 64 | bits[2] << 32 | bits[3]
}

/// #2317: body `id` of `w`'s `user_data`: for one the lint names of kind `unit`, how far it may
/// move before its contacts are found anew, Rapier's own share of its thinnest extent, m, and
/// the place it is built at, where they are first found. Nothing for any other body, for one
/// already under the hook at every step (`turns`), and for every body under the planted wrapper
/// that leaves the backend's reuse as it is.
pub(crate) fn fitted(w: &World, id: &str, twin: Twin) -> u128 {
    let b: &Body = &w.bodies[id];
    let thin = deep_canvas_physics::small::unit_extent(w, b);
    let share = f64::from(IntegrationParameters::default().normalized_contact_recycle_distance);
    let kept = twin == Twin::Small(Small::ReuseKept) || turns(w, id, twin);
    match thin.filter(|_| !kept) {
        Some(t) => packed((share * t) as f32, crate::v3(b.pose.pos)),
        None => 0,
    }
}

/// #2317: the world's contact hook for one step, with each fitted body (`fitted`) put under it
/// for this step if it has moved past its length from where its contacts were last found, which
/// is then where it is, and taken out from under it otherwise.
pub(crate) fn hook(
    world: &mut PhysicsWorld,
    bodies: &[(String, RigidBodyHandle)],
    twin: Twin,
    up: Vector,
) -> Belts {
    for (_, h) in bodies {
        let rb = &world.bodies[*h];
        let length = f32::from_bits((rb.user_data >> 96) as u32);
        if length == 0.0 {
            continue;
        }
        let word = |shift: u32| f32::from_bits((rb.user_data >> shift) as u32);
        let (at, found) = (rb.translation(), Vector::new(word(64), word(32), word(0)));
        let moved = (at - found).length() > length;
        let hooks = match moved {
            true => ActiveHooks::MODIFY_SOLVER_CONTACTS,
            false => ActiveHooks::empty(),
        };
        let stale: Vec<ColliderHandle> = rb.colliders().to_vec();
        let stale = stale
            .into_iter()
            .filter(|c| world.colliders[*c].active_hooks() != hooks);
        for c in stale.collect::<Vec<_>>() {
            world.colliders[c].set_active_hooks(hooks);
        }
        if moved {
            world.bodies[*h].user_data = packed(length, at);
        }
    }
    Belts { twin, up }
}

impl PhysicsHooks for Belts {
    fn modify_solver_contacts(&self, c: &mut ContactModificationContext) {
        // A side's surface velocity: its speed along its shape use's own +X, as its offset and
        // its body's pose turn it; nothing for a side that is no belt.
        let surface = |h: ColliderHandle| {
            let co = &c.colliders[h];
            let own = co.position().rotation * Vector::X;
            let along = match self.twin {
                Twin::BeltAlongWorldX => Vector::X,
                Twin::BeltAlongLevel => (own - self.up * own.dot(self.up)).normalize_or_zero(),
                _ => own,
            };
            along * f32::from_bits(co.user_data as u32)
        };
        // The solver holds the second side's velocity past the first's to this at each contact,
        // taking its part in the contact's plane.
        let carried = surface(c.collider1) - surface(c.collider2);
        if let Some(m) = c.rigid_mut() {
            for p in m.solver_contacts.iter_mut() {
                p.tangent_velocity = carried;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use deep_canvas_physics::backend::Backend;
    use deep_canvas_physics::kit::{self, Fixture, Planted};
    use serde_json::json;

    use super::Small;
    use crate::{Rapier, Twin};

    /// The interface's belt fixtures, in report order.
    fn fixtures() -> Vec<Fixture> {
        let all = kit::all().into_iter();
        all.filter(|f| f.name.starts_with("belt_")).collect()
    }

    /// The fixtures of `fixtures` Rapier doesn't pass while it runs `twin`.
    fn failed(twin: Twin, fixtures: &[Fixture]) -> Vec<String> {
        let new = || -> Box<dyn Backend> {
            Box::new(Rapier {
                twin,
                ..Rapier::default()
            })
        };
        let rows = kit::run(&new, fixtures, Planted::None).results;
        let off = rows.iter().filter(|r| r["result"] != "pass");
        off.map(|r| r["fixture"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    #[test]
    fn the_kit_holds_a_backend_to_each_belts_own_direction() {
        let belts = fixtures();
        assert_eq!(failed(Twin::None, &belts), Vec::<String>::new());
        let all = ["belt_level", "belt_turned", "belt_reversed", "belt_tilted"];
        assert_eq!(failed(Twin::BeltWithoutHook, &belts), all);
        let turned = ["belt_turned", "belt_tilted"];
        assert_eq!(failed(Twin::BeltAlongWorldX, &belts), turned);
        assert_eq!(failed(Twin::BeltAlongLevel, &belts), ["belt_tilted"]);
    }

    /// #2317: the turntable holds a backend to finding a turning body's contacts anew, and the
    /// stack of small things to keeping those of two dynamic bodies.
    #[test]
    fn the_kit_holds_a_backend_to_which_pairs_keep_their_contacts() {
        let held = |name: &str| -> Vec<Fixture> {
            let all = kit::all().into_iter();
            all.filter(|f| f.name == name).collect()
        };
        let (turntable, stack) = (held("turntable"), held("small_stack"));
        let (kept, off) = (Small::ReuseKept, Small::ReuseOff);
        assert_eq!(failed(Twin::None, &turntable), Vec::<String>::new());
        assert_eq!(failed(Twin::Small(kept), &turntable), ["turntable"]);
        assert_eq!(failed(Twin::Small(off), &turntable), Vec::<String>::new());
        assert_eq!(failed(Twin::None, &stack), Vec::<String>::new());
        assert_eq!(failed(Twin::Small(off), &stack), ["small_stack"]);
    }

    #[test]
    fn a_kinematic_bodys_belt_carries_as_a_static_bodys_does() {
        let mut level = fixtures().remove(0);
        level.world["bodies"]["belt"]["kind"] = json!("kinematic");
        assert_eq!(failed(Twin::None, &[level.clone()]), Vec::<String>::new());
        assert_eq!(failed(Twin::BeltWithoutHook, &[level]), ["belt_level"]);
    }
}
