//! DeepBuild patch (windoliver/deepbuild#124): the hit test a replica asks before a pointer action.
#![cfg(any(test, feature = "test-support"))]

use crate::{Hitbox, Pixels, Point, Window};

impl Window {
    /// The hitboxes the last frame's own hit test finds at `position`, front to back, as a mouse
    /// event there would. Nothing is dispatched and the mouse doesn't move, so a replica can ask
    /// before it acts.
    pub fn hits_at(&self, position: Point<Pixels>) -> Vec<Hitbox> {
        let frame = &self.rendered_frame;
        let hit_test = frame.hit_test(position);
        hit_test
            .ids
            .iter()
            .filter_map(|id| frame.hitboxes.iter().find(|hitbox| hitbox.id == *id))
            .cloned()
            .collect()
    }
}
