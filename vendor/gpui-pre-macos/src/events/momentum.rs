//! DeepBuild patch (windoliver/deepbuild#542): a scroll event's momentum phase. GPUI's
//! scroll event carries the touch's phase and no momentum phase, so a tail that runs on
//! after the fingers lift reads as more of the touch. AppKit gives it as `momentumPhase`: this
//! reads it as a `TouchPhase`, `None` outside a tail, and keeps the last scroll event's on the
//! thread that read it, so a scroll handler can tell a tail from the gesture while it runs.

use std::cell::Cell;

use gpui::TouchPhase;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventPhase};

thread_local! {
    static LAST: Cell<Option<TouchPhase>> = const { Cell::new(None) };
}

fn of(event: &NSEvent) -> Option<TouchPhase> {
    let p = event.momentumPhase();
    let has = |phase: NSEventPhase| p.0 & phase.0 != 0;
    if has(NSEventPhase::Began) {
        Some(TouchPhase::Started)
    } else if has(NSEventPhase::Changed) || has(NSEventPhase::Stationary) {
        Some(TouchPhase::Moved)
    } else if has(NSEventPhase::Ended) {
        Some(TouchPhase::Ended)
    } else if has(NSEventPhase::Cancelled) {
        Some(TouchPhase::Cancelled)
    } else {
        None
    }
}

/// `native_event`'s momentum phase: `None` when it isn't part of a tail.
///
/// # Safety
///
/// `native_event` is an `NSEvent` of type scroll wheel.
pub unsafe fn phase(native_event: *mut AnyObject) -> Option<TouchPhase> {
    of(unsafe { &*native_event.cast::<NSEvent>() })
}

/// The momentum phase of the last scroll event this thread read from AppKit.
pub fn last() -> Option<TouchPhase> {
    LAST.with(Cell::get)
}

pub(crate) fn note(native_event: &NSEvent) {
    LAST.with(|l| l.set(of(native_event)));
}
