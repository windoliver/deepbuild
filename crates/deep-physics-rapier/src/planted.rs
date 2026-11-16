//! The runner's planted wrong programs by name, and issue #522's planted restores: what a restore
//! loads in place of the whole-world checkpoint, so the checks that hold a seek, a late input and
//! the kit to a straight run are seen to fail.

use deep_canvas_physics::backend::Checkpoint;
use rapier3d::prelude::*;

use crate::Rapier;

/// The planted wrong programs, by name.
pub const PLANTED: [&str; 25] = [
    "caps_allow_restitution_threshold",
    "caps_allow_rolling_resistance",
    "caps_allow_tangent_speed",
    "caps_allow_dynamic_gear",
    "restore_ignores_version",
    "hash_rounds_1e6",
    "key_omits_frame_rate",
    "role_table_pickup_solid",
    "occurrences_in_engine_order",
    "query_bypasses_backend",
    "query_machines_any",
    "checkpoint_poses_only",
    "fork_on_scrub",
    "restore_keeps_replaced_occurrences",
    "late_entry_forks",
    "ring_drops_oldest",
    "restore_without_warm_start",
    "simulate_runs_all_steps",
    "hinge_coordinate_wraps",
    "checkpoint_drops_turns",
    "speed_cap_silent",
    "joint_force_per_step",
    "solve_cap_reports_success",
    "mass_ratio_declared_only",
    "volume_without_constraint",
];

/// What a planted restore leaves out of the checkpoint it loads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Restore {
    #[default]
    Whole,
    /// Each body's pose and velocity only, into the world as built: the contact graph, islands,
    /// joint state and warm-start impulses are lost.
    PosesOnly,
    /// The whole world but the contacts' and joints' warm-start impulses: the step after it
    /// applies none of them (Rapier's `warmstart_coefficient` at 0 for that step).
    NoWarmStart,
    /// The whole world but each breakable joint's steps past `breaks_at`, set to zero.
    NoBreakCount,
}

impl Rapier {
    /// After a whole restore, takes back what `how` leaves out; `built` is this world's
    /// checkpoint as built from its document, before any step.
    pub fn plant(&mut self, how: Restore, built: &Checkpoint) {
        match how {
            Restore::Whole => {}
            Restore::PosesOnly => {
                let mut fresh: PhysicsWorld =
                    bincode::deserialize(&built.state).expect("the built world loads back");
                for (_, h) in &self.bodies {
                    let (from, to) = (&self.world.bodies[*h], &mut fresh.bodies[*h]);
                    to.set_position(*from.position(), true);
                    to.set_linvel(from.linvel(), true);
                    to.set_angvel(from.angvel(), true);
                }
                self.world = fresh;
                self.grabs.clear();
            }
            // The warm-start impulses the step after the restore would apply, scaled by 0.
            Restore::NoWarmStart => self.cold = true,
            Restore::NoBreakCount => {
                for (_, h, _) in &self.breakable {
                    if let Some(j) = self.world.impulse_joints.get_mut(*h, false) {
                        // #523: the steps past breaks_at only; the joint's turns stay.
                        j.data.user_data =
                            crate::joints::packed(0, crate::joints::turns(j.data.user_data));
                    }
                }
            }
        }
    }
}
