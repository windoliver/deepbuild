//! #542: the carried GPUI patch's momentum phase (vendor/gpui-pre-macos's `events::momentum`),
//! read from a scroll event AppKit makes from a Core Graphics one, as a trackpad's tail would
//! arrive: the patch's row in the carried-patch table names this test.

#[cfg(test)]
mod tests {
    use std::ffi::c_void;

    use gpui_kit::TouchPhase;
    use objc2::encode::{Encoding, RefEncode};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    /// A Core Graphics event, opaque, with the type encoding AppKit's `eventWithCGEvent:` checks.
    #[repr(C)]
    struct CGEvent([u8; 0]);
    unsafe impl RefEncode for CGEvent {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__CGEvent", &[]));
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateScrollWheelEvent2(
            source: *const c_void,
            units: u32,
            wheel_count: u32,
            w1: i32,
            w2: i32,
            w3: i32,
        ) -> *mut CGEvent;
        fn CGEventSetIntegerValueField(event: *mut CGEvent, field: u32, value: i64);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    /// `kCGScrollEventUnitPixel`, `kCGScrollWheelEventScrollPhase` and
    /// `kCGScrollWheelEventMomentumPhase`.
    const PIXEL: u32 = 0;
    const SCROLL_PHASE: u32 = 99;
    const MOMENTUM_PHASE: u32 = 123;

    /// A pixel scroll of 12 px down with Core Graphics' scroll phase and momentum phase, as
    /// AppKit hands it to GPUI.
    fn phase_of(scroll: i64, momentum: i64) -> Option<TouchPhase> {
        unsafe {
            let cg = CGEventCreateScrollWheelEvent2(std::ptr::null(), PIXEL, 1, -12, 0, 0);
            assert!(!cg.is_null(), "Core Graphics made no scroll event");
            CGEventSetIntegerValueField(cg, SCROLL_PHASE, scroll);
            CGEventSetIntegerValueField(cg, MOMENTUM_PHASE, momentum);
            let ns: *mut AnyObject = msg_send![class!(NSEvent), eventWithCGEvent: cg];
            assert!(!ns.is_null(), "AppKit made no event");
            let read = gpui_macos::momentum::phase(ns.cast());
            CFRelease(cg.cast());
            read
        }
    }

    #[test]
    fn a_scroll_tail_reads_its_momentum_phase_and_the_touch_none() {
        // The touch's own events (scroll phase began, changed, ended) carry no momentum.
        assert_eq!(phase_of(1, 0), None);
        assert_eq!(phase_of(2, 0), None);
        assert_eq!(phase_of(4, 0), None);
        // The tail after the fingers lift: momentum begin, continue and end.
        assert_eq!(phase_of(0, 1), Some(TouchPhase::Started));
        assert_eq!(phase_of(0, 2), Some(TouchPhase::Moved));
        assert_eq!(phase_of(0, 3), Some(TouchPhase::Ended));
    }
}
