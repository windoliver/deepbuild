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
}
