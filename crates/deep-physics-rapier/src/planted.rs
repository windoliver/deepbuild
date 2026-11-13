//! Issue #522's planted restores: what a restore loads in place of the whole-world checkpoint, so
//! the checks that hold a seek, a late input and the kit to a straight run are seen to fail.

use deep_canvas_physics::backend::Checkpoint;
use rapier3d::prelude::*;

use crate::Rapier;

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
                        j.data.user_data = 0;
                    }
                }
            }
        }
    }
}
