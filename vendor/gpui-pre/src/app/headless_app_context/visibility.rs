use super::HeadlessAppContext;
use crate::{AnyWindowHandle, WindowVisibility};

impl HeadlessAppContext {
    /// DeepBuild patch (windoliver/deepbuild#3232): hides a window or shows it again, as the platform reports one that
    /// is covered, minimized or on a sleeping display.
    pub fn simulate_visibility_change(
        &mut self,
        window: AnyWindowHandle,
        visibility: WindowVisibility,
    ) {
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| window.platform_window.as_test())
                .cloned()
        };
        if let Some(test_window) = test_window {
            test_window.simulate_visibility_change(visibility);
        }
    }
}
