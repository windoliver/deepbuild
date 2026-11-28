//! DeepBuild patch (windoliver/deepbuild#1551): what a still window's display link is heard and
//! tested by. From gpui-pre-macos 0.3.11, on macOS 14 and later, a window's frames come from a
//! Metal display link that upstream pauses after an update in which GPUI neither drew, presented
//! nor asked for another frame, and that `schedule_frame` and the frame waker resume
//! (zed-industries/zed#65472): the stopping and starting this file held at 0.3.9 is upstream's now.
//! What stays ours has no upstream twin: the hook that hears each request-frame callback, a
//! screen change that leaves a still window alone, and the planted twins.
//!
//! The planted twins exist for the acceptance tests that must catch them: a link that never
//! pauses, a waker that ignores `schedule_frame`, and a link that sits out one full refresh after
//! it resumes before it runs a callback.

use super::{FrameSource, MacWindowState};
use parking_lot::Mutex;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, RwLock};

/// A planted wrong frame link, for the tests that must catch it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Planted {
    None = 0,
    /// The link keeps running while the window is still.
    NeverStops = 1,
    /// `schedule_frame` doesn't resume a paused link; only the frame waker does.
    IgnoresScheduleFrame = 2,
    /// A resumed link lets one full refresh pass before it runs a callback.
    RestartsAfterRefresh = 3,
}

/// What receives each request-frame callback, as it runs: a window's display-link update, or
/// AppKit asking its layer to display or making it key.
pub type Hook = Arc<dyn Fn() + Send + Sync>;

static PLANTED: AtomicU8 = AtomicU8::new(Planted::None as u8);
static HOOK: RwLock<Option<Hook>> = RwLock::new(None);
/// Whether a link paused since its last update, so the planted late restart sits its next one out.
static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn plant(planted: Planted) {
    PLANTED.store(planted as u8, Ordering::SeqCst);
}

fn planted() -> Planted {
    match PLANTED.load(Ordering::SeqCst) {
        1 => Planted::NeverStops,
        2 => Planted::IgnoresScheduleFrame,
        3 => Planted::RestartsAfterRefresh,
        _ => Planted::None,
    }
}

/// Installs the hook that hears every request-frame callback this process runs, replacing any
/// earlier one, or removes it.
pub fn set_hook(hook: Option<Hook>) {
    let old = std::mem::replace(&mut *HOOK.write().unwrap_or_else(|e| e.into_inner()), hook);
    drop(old);
}

pub(super) fn note_callback() {
    let hook = HOOK.read().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(hook) = hook {
        hook();
    }
}

/// The planted link that never pauses: every update reads as one that used its drawable.
pub(super) fn never_stops() -> bool {
    planted() == Planted::NeverStops
}

/// The planted waker: `schedule_frame` resumes nothing.
pub(super) fn ignores_schedule_frame() -> bool {
    planted() == Planted::IgnoresScheduleFrame
}

/// After an update: whether it paused the link.
pub(super) fn ended(paused: bool) {
    if paused {
        PAUSED.store(true, Ordering::SeqCst);
    }
}

/// Before an update's callback: whether the planted late restart sits this one out, the first
/// since the link paused.
pub(super) fn sits_out() -> bool {
    PAUSED.swap(false, Ordering::SeqCst) && planted() == Planted::RestartsAfterRefresh
}

/// AppKit's screen change: upstream starts the window's link again and resizes the window to the
/// new screen's scale, which redraws it. AppKit also reports one, every few seconds, for a window
/// on the screen it was on, its scale and size as they were; a Metal link follows its layer and
/// the layer's last frame is still right then, so a still window keeps its paused link and
/// nothing is resized or redrawn.
pub(super) fn screen_changed(state: &Rc<Mutex<MacWindowState>>) {
    let mut lock = state.lock();
    let attached = matches!(&lock.frame_source, FrameSource::Metal(frames) if frames.is_attached());
    let unchanged = attached && {
        let scale = lock.scale_factor();
        let size = lock.content_size().to_device_pixels(scale);
        lock.renderer.layer().is_some_and(|layer| {
            let drawable = layer.drawableSize();
            layer.contentsScale() == f64::from(scale)
                && drawable.width == f64::from(size.width.0)
                && drawable.height == f64::from(size.height.0)
        })
    };
    if unchanged {
        return;
    }
    lock.start_display_link(state);
    drop(lock);
    super::update_window_scale_factor(state);
}
