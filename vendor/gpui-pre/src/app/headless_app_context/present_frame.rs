use super::HeadlessAppContext;
use crate::AnyWindowHandle;

impl HeadlessAppContext {
    /// DeepBuild patch (windoliver/deepbuild#391): delivers one frame request to a window that
    /// must draw and present, as a display link would at a vsync, so a headless canvas presents
    /// through GPUI's own frame path (draw, then the renderer's submission) only when its frame
    /// clock arms a frame.
    pub fn present_frame(&mut self, window: AnyWindowHandle) {
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| window.platform_window.as_test())
                .cloned()
        };
        if let Some(test_window) = test_window {
            test_window.simulate_frame_request(crate::RequestFrameOptions {
                require_presentation: true,
                force_render: true,
                ..Default::default()
            });
        }
    }

    /// DeepBuild patch (windoliver/deepbuild#499): presents the window's last frame again without
    /// drawing it, as a display link does for a window that isn't dirty: a video surface it
    /// samples shows its new contents, and nothing is laid out or painted.
    pub fn present_again(&mut self, window: AnyWindowHandle) {
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| window.platform_window.as_test())
                .cloned()
        };
        if let Some(test_window) = test_window {
            test_window.simulate_frame_request(crate::RequestFrameOptions {
                require_presentation: true,
                force_render: false,
                ..Default::default()
            });
        }
    }
}
