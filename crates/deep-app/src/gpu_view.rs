//! Issue #377: a GPU-layer view in the window. GPUI paints the view's shown slot in place, in
//! scene order, so whatever paints after it (the question card among them) draws over it; the
//! GPUI patch reports which command buffers sample each slot, and this hands those reports to
//! every live view's ring, which releases a slot only once GPUI is done reading it.
//!
//! The UI thread spends only the latch and one paint call here; rendering, encoding and the copy
//! path's read-back run on the render thread.

use std::sync::{Mutex, Once};

use deep_gpu::view::Ui;
use gpui_kit::*;

static VIEWS: Mutex<Vec<Ui>> = Mutex::new(Vec::new());
static HOOK: Once = Once::new();

/// Starts routing GPUI's surface reports to `ui`.
pub fn watch(ui: &Ui) {
    HOOK.call_once(install);
    VIEWS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(ui.clone());
}

/// Stops routing reports to `ui`, whose view is gone.
pub fn unwatch(ui: &Ui) {
    VIEWS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|v| !v.is(ui));
}

#[cfg(target_os = "macos")]
fn install() {
    use gpui_apple::metal_renderer::gpu_surfaces::{set_hook, Event};
    set_hook(Some(std::sync::Arc::new(|event| {
        let views = VIEWS.lock().unwrap_or_else(|e| e.into_inner());
        for ui in views.iter() {
            match &event {
                Event::Encoded { frame, surfaces } => ui.committed(*frame, surfaces),
                Event::Completed { frame, gpu_ns } => ui.completed(*frame, *gpu_ns),
            }
        }
    })));
}

#[cfg(not(target_os = "macos"))]
fn install() {}

/// Paints the view's newest ready slot over `bounds`; returns the frame it shows.
#[cfg(target_os = "macos")]
pub fn paint(ui: &Ui, bounds: Bounds<Pixels>, window: &mut Window) -> Option<u64> {
    let (shown, frame) = ui.latch()?;
    window.paint_surface(bounds, shown);
    Some(frame)
}

/// #177: latches the view's newest slot as [`paint`] does, but paints the clear region in its
/// place, so the window leaves `bounds` clear over a live view's HDR surface beneath it; whatever
/// paints after it (the question card, overlays) draws over that as usual. The slot isn't sampled,
/// so it frees on the next latch. Returns the frame it shows.
#[cfg(target_os = "macos")]
pub fn paint_clear(ui: &Ui, bounds: Bounds<Pixels>, window: &mut Window) -> Option<u64> {
    let (_, frame) = ui.latch()?;
    window.paint_surface(bounds, CLEAR.with(Clone::clone)?);
    Some(frame)
}

#[cfg(target_os = "macos")]
thread_local! {
    /// The clear region's pixel buffer, registered with the GPUI patch once per UI thread.
    static CLEAR: Option<deep_gpu::surface::Shown> =
        deep_gpu::surface::clear_region().ok().inspect(|b| {
            gpui_apple::metal_renderer::clear_surface::register(deep_gpu::view::identity(b));
        });
}
