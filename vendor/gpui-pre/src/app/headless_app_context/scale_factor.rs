use super::HeadlessAppContext;
use crate::AnyWindowHandle;

impl HeadlessAppContext {
    /// DeepBuild patch (windoliver/deepbuild#390): moves a window to a display of another scale
    /// factor, as `TestApp::simulate_scale_factor_change` does, so a headless render can be read
    /// at scale 1.
    pub fn simulate_scale_factor_change(&mut self, window: AnyWindowHandle, scale_factor: f32) {
        let test_window = {
            let mut app = self.app.borrow_mut();
            app.windows
                .get_mut(window.window_id())
                .and_then(|window| window.as_mut())
                .and_then(|window| window.platform_window.as_test())
                .cloned()
        };
        if let Some(mut test_window) = test_window {
            test_window.simulate_scale_factor_change(scale_factor);
        }
        self.background_executor.run_until_parked();
    }
}
