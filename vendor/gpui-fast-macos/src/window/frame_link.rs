//! DeepBuild patch (windoliver/deepbuild#1551): what the tests of a still window's display link read and plant.
//! gpui-fast-macos stops a still window's link itself (`MetalFrames::end_frame` pauses a `CAMetalDisplayLink` after an
//! update that neither drew nor was asked for another frame, and `schedule_frame` and the frame waker wake it), so the
//! stopping this patch carried on gpui-pre-macos 0.3.9 is retired here. What stays is a hook that hears each
//! request-frame callback as it runs, and the planted twins the acceptance tests must catch, set on upstream's link:
//! a link that never stops, a `schedule_frame` that doesn't wake it, and a link that sits out one refresh after it
//! restarts before it runs a callback.

use std::cell::Cell;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, RwLock};

/// A planted wrong frame link, for the tests that must catch it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Planted {
    None = 0,
    /// The link keeps running while the window is still.
    NeverStops = 1,
    /// `schedule_frame` doesn't restart a stopped link; only the frame waker does.
    IgnoresScheduleFrame = 2,
    /// A restarted link lets one full refresh pass before it runs a callback.
    RestartsAfterRefresh = 3,
}

/// What receives each request-frame callback, as it runs: a window's display-link tick, or
/// AppKit asking its layer to display or making it key.
pub type Hook = Arc<dyn Fn() + Send + Sync>;

static PLANTED: AtomicU8 = AtomicU8::new(Planted::None as u8);
static HOOK: RwLock<Option<Hook>> = RwLock::new(None);

thread_local! {
    /// Whether a window's link paused at the end of its last update, on the main thread its updates run on.
    static PAUSED: Cell<bool> = const { Cell::new(false) };
}

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

/// Whether an update counts as used, so upstream's link doesn't pause after it: always, planted `NeverStops`.
pub(super) fn keeps_running(used_drawable: bool) -> bool {
    used_drawable || planted() == Planted::NeverStops
}

/// Notes whether upstream's link paused at the end of an update.
pub(super) fn ended(paused: bool) {
    PAUSED.with(|p| p.set(paused));
}

/// Whether `schedule_frame` wakes the link: not, planted `IgnoresScheduleFrame`.
pub(super) fn schedule_frame_wakes() -> bool {
    planted() != Planted::IgnoresScheduleFrame
}

/// Whether an update runs its callback: planted `RestartsAfterRefresh`, the first update after a pause is sat out.
pub(super) fn tick_begins() -> bool {
    let restarted = PAUSED.with(|p| p.replace(false));
    !(restarted && planted() == Planted::RestartsAfterRefresh)
}
