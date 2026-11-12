//! Issue #339, input the card can trust: what macOS says about where a press came from. The ⌥Space gate's reading of
//! the HID system state table (`hid_shortcut_down`) feeds the capture modes that stay, and `delivered` names the
//! source of the mouse press the question card judges (#1454). The cursor window and its probes are gone (#1457).
//!
//! An event's `CGEvent` carries field 45 (`kCGEventSourceStateID`), the state table its source writes, and field 41
//! (`kCGEventSourceUnixProcessID`), the process that posted it (CoreGraphics' CGEventTypes.h); hardware carries the HID
//! table (1) and no posting process (0). What the spike measured is in docs/spikes/339/record.json.

/// ⌥Space: Space is virtual key 49 (`kVK_Space`), Option the modifier.
pub const SHORTCUT_KEY_CODE: u16 = 49;

/// Which edge of a mouse press is being delivered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PressEdge {
    Down,
    Up,
}

#[cfg(target_os = "macos")]
pub use macos::*;

/// No platform here names a press's source yet.
#[cfg(not(target_os = "macos"))]
pub fn delivered(_: PressEdge) -> Option<(f64, bool)> {
    None
}

/// No platform here names a key's source yet: every key is one the OS must confirm.
#[cfg(not(target_os = "macos"))]
pub fn key_from_hardware() -> bool {
    false
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSEventType};
    use objc2_core_graphics::{
        CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID,
        CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
    };

    use super::{PressEdge, SHORTCUT_KEY_CODE};

    /// The whole chord's state in the HID system table, read fresh: Space's key state and
    /// Option in the table's modifier flags. Neither comes from any event.
    pub fn hid_shortcut_down() -> bool {
        let hid = CGEventSourceStateID::HIDSystemState;
        CGEventSource::key_state(hid, SHORTCUT_KEY_CODE)
            && CGEventSource::flags_state(hid).contains(CGEventFlags::MaskAlternate)
    }

    /// The left-button event AppKit is delivering, as the question card judges a press on it (#1454): its age in ms and
    /// whether the HID system says the button did this, in the state `kind` names. GPUI delivers a press a screen reader
    /// sends as a mouse down and up with no AppKit event of their own, and the current event is then whatever came last,
    /// so a click counts as hardware only when its down and its up each find their own event here.
    pub fn delivered(kind: PressEdge) -> Option<(f64, bool)> {
        let event = NSApplication::sharedApplication(main_thread()).currentEvent()?;
        let (wanted, down) = match kind {
            PressEdge::Down => (NSEventType::LeftMouseDown, true),
            PressEdge::Up => (NSEventType::LeftMouseUp, false),
        };
        if event.r#type() != wanted {
            return None;
        }
        let cg = event.CGEvent();
        let field = |field| {
            cg.as_deref()
                .map(|cg| CGEvent::integer_value_field(Some(cg), field))
        };
        let hid = CGEventSourceStateID::HIDSystemState;
        let button =
            CGEventSource::button_state(hid, objc2_core_graphics::CGMouseButton::Left) == down;
        let age = objc2_foundation::NSProcessInfo::processInfo().systemUptime() - event.timestamp();
        Some((
            (age * 1000.).max(0.),
            button
                && field(CGEventField::EventSourceStateID) == Some(hid.0 as i64)
                && field(CGEventField::EventSourceUnixProcessID) == Some(0),
        ))
    }

    /// Whether the key AppKit is delivering came from the keyboard, as the HID system says (#1462): a key another process
    /// posts, or one a screen reader or Switch Control sends, is not.
    pub fn key_from_hardware() -> bool {
        let Some(event) = NSApplication::sharedApplication(main_thread()).currentEvent() else {
            return false;
        };
        if event.r#type() != NSEventType::KeyDown {
            return false;
        }
        let Some(cg) = event.CGEvent() else {
            return false;
        };
        let field = |field| CGEvent::integer_value_field(Some(&cg), field);
        field(CGEventField::EventSourceStateID) == CGEventSourceStateID::HIDSystemState.0 as i64
            && field(CGEventField::EventSourceUnixProcessID) == 0
    }

    /// Whether this process may capture the screen, as the OS reports it: the first call of
    /// `request` shows the Screen Recording prompt once and returns false until it's granted.
    pub fn capture_access() -> bool {
        CGPreflightScreenCaptureAccess()
    }

    pub fn request_capture_access() -> bool {
        CGRequestScreenCaptureAccess()
    }

    pub fn main_thread() -> MainThreadMarker {
        MainThreadMarker::new().expect("the trusted-input layer runs on the main thread")
    }
}
