//! DeepBuild patch (windoliver/deepbuild#1551): a still window stops its display link. Upstream
//! keeps a shown window's link running and runs the request-frame callback every vsync, a wakeup
//! of the main thread each refresh while nothing changes. Here a tick that neither drew nor was
//! asked for another frame stops the link, and `schedule_frame` or the frame waker (which GPUI's
//! invalidator calls when a view is notified, a next-frame callback is queued or the window is
//! refreshed) starts it again. Starting it keeps upstream's rules: never while the window is
//! occluded or has no screen.
//!
//! The planted twins exist for the acceptance tests that must catch them: a link that never
//! stops (upstream's behavior), a waker that ignores `schedule_frame`, and a link that sits out
//! one full refresh after it restarts before it runs a callback.

use super::MacWindowState;
use dispatch2::DispatchQueue;
use parking_lot::Mutex;
use std::rc::Rc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, RwLock};

/// A planted wrong frame link, for the tests that must catch it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Planted {
    None = 0,
    /// The link keeps running while the window is still, as upstream's does.
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

/// A window's link between ticks: whether the tick running drew or was asked for another frame,
/// whether the link is stopped for being still, and ticks a planted restart sits out.
#[derive(Default)]
pub(super) struct Link {
    asked: bool,
    drew: bool,
    stopped: bool,
    skip: u32,
}

impl Link {
    /// The link started: it isn't stopped for being still any more.
    pub(super) fn started(&mut self) {
        self.stopped = false;
    }
}

impl MacWindowState {
    /// Before a display-link tick: whether it runs the request-frame callback.
    pub(super) fn tick_begins(&mut self) -> bool {
        if self.frame_link.skip > 0 {
            self.frame_link.skip -= 1;
            return false;
        }
        self.frame_link.asked = false;
        self.frame_link.drew = false;
        note_callback();
        true
    }

    /// After a tick's callback: a tick that neither drew nor was asked again stops the link.
    pub(super) fn tick_ends(&mut self) {
        let link = &self.frame_link;
        if link.asked || link.drew || planted() == Planted::NeverStops {
            return;
        }
        self.stop_display_link();
        self.frame_link.stopped = true;
    }

    pub(super) fn note_drawn(&mut self) {
        self.frame_link.drew = true;
    }

    fn wake(&mut self) {
        self.frame_link.asked = true;
        if !self.frame_link.stopped {
            return;
        }
        self.frame_link.stopped = false;
        if planted() == Planted::RestartsAfterRefresh {
            self.frame_link.skip = 1;
        }
        self.start_display_link();
    }
}

/// Wakes the window's link. On the main thread with the window's state unlocked it starts the
/// link at once; a call made while the state is locked (from inside one of the window's own
/// handlers) is queued on the main queue rather than waiting on the lock it holds.
fn wake(state: &Arc<Mutex<MacWindowState>>) {
    if let Some(mut lock) = state.try_lock() {
        lock.wake();
        return;
    }
    let state = Arc::downgrade(state);
    DispatchQueue::main().exec_async(move || {
        if let Some(state) = state.upgrade() {
            state.lock().wake();
        }
    });
}

pub(super) fn schedule_frame(state: &Arc<Mutex<MacWindowState>>) {
    if planted() != Planted::IgnoresScheduleFrame {
        wake(state);
    }
}

/// The waker GPUI's invalidator holds. It holds the window weakly: the invalidator lives in the
/// window's request-frame callback, which the window's state owns.
pub(super) fn waker(state: &Arc<Mutex<MacWindowState>>) -> Option<Rc<dyn Fn()>> {
    let state = Arc::downgrade(state);
    Some(Rc::new(move || {
        if let Some(state) = state.upgrade() {
            wake(&state);
        }
    }))
}
