use super::HeadlessAppContext;
use crate::{AnyWindowHandle, DisplayId, Pixels, Point, TestWindow};

impl HeadlessAppContext {
    fn test_window(&self, window: AnyWindowHandle) -> Option<TestWindow> {
        let mut app = self.app.borrow_mut();
        let window = app.windows.get_mut(window.window_id())?.as_mut()?;
        window.platform_window.as_test().cloned()
    }

    /// DeepBuild patch (windoliver/deepbuild#1843): moves a window, as the platform reports one moved.
    pub fn simulate_move(&mut self, window: AnyWindowHandle, origin: Point<Pixels>) {
        let Some(TestWindow(state)) = self.test_window(window) else {
            return;
        };
        state.lock().bounds.origin = origin;
        let callback = state.lock().moved_callback.take();
        if let Some(mut callback) = callback {
            callback();
            state.lock().moved_callback = Some(callback);
        }
    }

    /// DeepBuild patch (windoliver/deepbuild#1843): puts a window on another display.
    pub fn simulate_move_to_display(&mut self, window: AnyWindowHandle, display: DisplayId) {
        if let Some(test_window) = self.test_window(window) {
            test_window.simulate_move_to_display(display);
        }
    }

    /// DeepBuild patch (windoliver/deepbuild#1843): makes a window the key one, or another.
    pub fn simulate_active_status_change(&mut self, window: AnyWindowHandle, active: bool) {
        if let Some(test_window) = self.test_window(window) {
            test_window.simulate_active_status_change(active);
        }
    }
}
