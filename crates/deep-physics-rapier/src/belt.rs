//! #2241: belts. A contact material's `tangent_speed` on a static or kinematic body's shape use is
//! the speed its surface carries what rests on it. Rapier's solver takes a surface velocity for
//! each contact through the contact hook a wrapper installs, so this one fills it from the
//! material: the speed rides in the collider's `user_data`, which the world's bytes carry, so a
//! restored world carries as the one that wrote the checkpoint did, and no document holds code.

use rapier3d::prelude::*;

use crate::Twin;

/// A world's contact hook: each belt's surface velocity, on every contact of its shape use.
pub(crate) struct Belts {
    pub twin: Twin,
    /// The world's up, which the planted level belt flattens its direction against.
    pub up: Vector,
}

/// `c` as a belt carrying at `speed` m/s; under the planted wrapper without the hook, `c` as it is.
pub(crate) fn carrying(c: ColliderBuilder, speed: f64, twin: Twin) -> ColliderBuilder {
    let speed = speed as f32;
    if speed == 0.0 || twin == Twin::BeltWithoutHook {
        return c;
    }
    c.active_hooks(ActiveHooks::MODIFY_SOLVER_CONTACTS)
        .user_data(u128::from(speed.to_bits()))
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

    #[test]
    fn a_kinematic_bodys_belt_carries_as_a_static_bodys_does() {
        let mut level = fixtures().remove(0);
        level.world["bodies"]["belt"]["kind"] = json!("kinematic");
        assert_eq!(failed(Twin::None, &[level.clone()]), Vec::<String>::new());
        assert_eq!(failed(Twin::BeltWithoutHook, &[level]), ["belt_level"]);
    }
}
