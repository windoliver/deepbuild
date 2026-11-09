//! DeepBuild patch (windoliver/deepbuild#1551): a present-only request from outside the crate.
//! The window presents its last drawn frame again without a redraw: `needs_present` set, which
//! asks the platform for a frame through `schedule_frame` alone, never the frame waker. The
//! test of a still window's display link asks for one to prove `schedule_frame` restarts it.

use super::Window;

impl Window {
    /// Presents the last drawn frame again on the next frame, without drawing it anew.
    pub fn request_present(&self) {
        self.needs_present.set(true);
    }
}
