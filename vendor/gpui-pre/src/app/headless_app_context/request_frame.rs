use std::{cell::Cell, rc::Rc};

use super::HeadlessAppContext;
use crate::{AnyWindowHandle, Pixels, RequestFrameOptions, Size, app::GpuiMode};

impl HeadlessAppContext {
    /// DeepBuild patch (windoliver/deepbuild#1546): from now on a dirty window draws only when a frame request asks,
    /// as a real window does, not at the end of every update as the test mode draws it. GPUI's own frame-path tests
    /// run in the same mode.
    pub fn draw_on_request(&mut self) {
        self.app.borrow_mut().mode = GpuiMode::Production;
    }

    /// DeepBuild patch (windoliver/deepbuild#1546): delivers one frame request with no forced render, as a display
    /// link does once a window asked for a frame, so GPUI draws only if its invalidator says the window is dirty.
    /// Answers whether it drew. A callback queued last for the frame reads what the frame path decides on, after the
    /// window's own next-frame callbacks ran; the window is drawn unthrottled only when opened with no
    /// `inactive_frame_interval`.
    pub fn request_frame(&mut self, window: AnyWindowHandle) -> bool {
        let drew = Rc::new(Cell::new(false));
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| {
                    let seen = drew.clone();
                    window.on_next_frame(move |window, _| seen.set(window.invalidator.is_dirty()));
                    window.platform_window.as_test().cloned()
                })
        };
        if let Some(test_window) = test_window {
            test_window.simulate_frame_request(RequestFrameOptions::default());
        }
        drew.get()
    }

    /// DeepBuild patch (windoliver/deepbuild#1546): resizes a window's content as the platform does, through its
    /// resize callback, so the window marks itself dirty as a real one would.
    pub fn simulate_resize(&mut self, window: AnyWindowHandle, size: Size<Pixels>) {
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| window.platform_window.as_test())
                .cloned()
        };
        if let Some(mut test_window) = test_window {
            test_window.simulate_resize(size);
        }
    }
}
