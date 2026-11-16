//! DeepBuild patch (windoliver/deepbuild#542): a scroll event's momentum phase. GPUI's
//! `ScrollWheelEvent` carries the touch's phase and no momentum phase, so a tail that runs on
//! after the fingers lift reads as more of the touch. AppKit gives it as `momentumPhase`: this
//! reads it as a `TouchPhase`, `None` outside a tail, and keeps the last scroll event's on the
//! thread that read it, so a scroll handler can tell a tail from the gesture while it runs.

use std::cell::Cell;

use cocoa::appkit::{NSEvent, NSEventPhase};
use cocoa::base::id;
use gpui::TouchPhase;

thread_local! {
    static LAST: Cell<Option<TouchPhase>> = const { Cell::new(None) };
}

/// `native_event`'s momentum phase: `None` when it isn't part of a tail.
///
/// # Safety
///
/// `native_event` is an `NSEvent` of type scroll wheel.
pub unsafe fn phase(native_event: id) -> Option<TouchPhase> {
    let p = unsafe { native_event.momentumPhase() };
    if p.contains(NSEventPhase::NSEventPhaseBegan) {
        Some(TouchPhase::Started)
    } else if p.intersects(NSEventPhase::NSEventPhaseChanged | NSEventPhase::NSEventPhaseStationary) {
        Some(TouchPhase::Moved)
    } else if p.contains(NSEventPhase::NSEventPhaseEnded) {
        Some(TouchPhase::Ended)
    } else if p.contains(NSEventPhase::NSEventPhaseCancelled) {
        Some(TouchPhase::Cancelled)
    } else {
        None
    }
}

/// The momentum phase of the last scroll event this thread read from AppKit.
pub fn last() -> Option<TouchPhase> {
    LAST.with(Cell::get)
}

pub(crate) unsafe fn note(native_event: id) {
    let p = unsafe { phase(native_event) };
    LAST.with(|l| l.set(p));
}
