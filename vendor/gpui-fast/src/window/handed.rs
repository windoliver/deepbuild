//! DeepBuild patch (windoliver/deepbuild#1482): a view that hands a cached child view what it draws, while it draws,
//! redraws that child in the same frame. A notify then lands after the frame read its dirty views, so the child would
//! draw what it held the frame before until something else drew the window.

use crate::{EntityId, Window};

impl Window {
    /// Draws `view` again in this frame: a cached view below the one drawing now, whose state just changed.
    pub fn redraw_in_frame(&mut self, view: EntityId) {
        self.dirty_views.insert(view);
    }

    /// The window's root view, whatever its type: what a planted wrong program notifies.
    pub fn root_entity_id(&self) -> Option<EntityId> {
        self.root.as_ref().map(|root| root.entity_id())
    }
}
