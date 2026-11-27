//! DeepBuild patch (windoliver/deepbuild#542): a scroll event's momentum phase. GPUI's
//! `ScrollWheelEvent` carries the touch's phase and no momentum phase, so a tail that runs on
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

/// `native_event`'s momentum phase: `None` when it isn't part of a tail.
///
/// # Safety
///
/// `native_event` is an `NSEvent` of type scroll wheel.
pub unsafe fn phase(native_event: *mut AnyObject) -> Option<TouchPhase> {
    // SAFETY: the caller hands an `NSEvent`.
    let event = unsafe { native_event.cast::<NSEvent>().as_ref() }?;
    of(event)
}

fn of(event: &NSEvent) -> Option<TouchPhase> {
    let p = event.momentumPhase();
    if p.contains(NSEventPhase::Began) {
        Some(TouchPhase::Started)
    } else if p.intersects(NSEventPhase::Changed | NSEventPhase::Stationary) {
        Some(TouchPhase::Moved)
    } else if p.contains(NSEventPhase::Ended) {
        Some(TouchPhase::Ended)
    } else if p.contains(NSEventPhase::Cancelled) {
        Some(TouchPhase::Cancelled)
    } else {
        None
    }
}

/// The momentum phase of the last scroll event this thread read from AppKit.
pub fn last() -> Option<TouchPhase> {
    LAST.with(Cell::get)
}

pub(crate) fn note(native_event: &NSEvent) {
    LAST.with(|l| l.set(of(native_event)));
}
