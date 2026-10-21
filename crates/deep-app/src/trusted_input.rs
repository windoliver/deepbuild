//! Issue #339, input the card can trust: one screen frame, taken only while ⌥Space is held on
//! the keyboard, shown in a small window that follows the cursor, and a count of every press
//! the gate refused.
//!
//! The gate is held exactly while the HID system state table reads the chord down, Space by
//! `CGEventSourceKeyState` and Option by `CGEventSourceFlagsState`, re-read on every tick.
//! No event moves it. Events are judged for the record by what macOS attaches to them: an
//! `NSEvent` carries its `CGEvent`, whose field 45 (`kCGEventSourceStateID`) names the state
//! table the event's source writes and whose field 41 (`kCGEventSourceUnixProcessID`) names
//! the process that posted it (CoreGraphics' CGEventTypes.h); hardware carries the HID table
//! (1) and no posting process (0). What the spike measured: nothing this process builds and
//! queues, and nothing an untrusted process posted at the HID event tap with `CGEventPost`,
//! arrived or wrote the table (docs/spikes/339/record.json). What it didn't: a poster with
//! Accessibility permission, or a virtual HID device, both of which Apple's CGEventSource.h
//! routes through that table, and the other untrusted posting paths the record lists.
//!
//! The pure part, [`Gate`], runs on every platform and is what the unit tests cover. The
//! macOS part installs the monitor, reads the fields, captures the frame and moves the window.

/// ⌥Space: Space is virtual key 49 (`kVK_Space`), Option the modifier.
pub const SHORTCUT_KEY_CODE: u16 = 49;
/// `kCGEventSourceStateHIDSystemState`: the table hardware event sources write.
pub const HID_SYSTEM_STATE: i64 = 1;
/// The source pid of an event no process posted.
pub const NO_POSTING_PROCESS: i64 = 0;

/// What macOS says about where a key event came from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Provenance {
    /// Field 45, `kCGEventSourceStateID`; `None` when the event carries no `CGEvent`.
    pub source_state: Option<i64>,
    /// Field 41, `kCGEventSourceUnixProcessID`; `None` when the event carries no `CGEvent`.
    pub source_pid: Option<i64>,
    /// Whether the HID system state table reports the whole chord down right now: Space in
    /// its key state and Option in its modifier flags. A synthetic event's own Option flag
    /// is never read for this, so a forged Option+Space while a person holds bare Space
    /// doesn't arm the gate.
    pub hid_chord_down: bool,
}

impl Provenance {
    /// Hardware: from the HID state table, posted by no process, and the chord down in that
    /// table.
    pub fn is_hardware(&self) -> bool {
        self.source_state == Some(HID_SYSTEM_STATE)
            && self.source_pid == Some(NO_POSTING_PROCESS)
            && self.hid_chord_down
    }
}

/// A key event, reduced to what the gate reads: the key and whether it's a repeat. An
/// event's modifier flags are never read, since a synthetic event may carry any; Option's
/// state comes from the HID table in [`Provenance::hid_chord_down`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Down { key_code: u16, repeat: bool },
    Up { key_code: u16 },
}

/// What the gate made of one event. No verdict changes the held state: the HID table does,
/// on each tick, in [`Gate::may_capture`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// A press of the shortcut whose provenance is hardware.
    Hardware,
    /// The shortcut's key repeat while held; nothing changes.
    Repeat,
    /// A press of the shortcut whose provenance isn't hardware.
    Refused,
    /// Another key, or any key-up: letting go is read from the table, never from an event,
    /// since a synthetic key-up must not let go of a chord a person holds.
    Ignored,
}

/// Counts the record keeps. A frame is counted only when a capture returned pixels.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    /// Presses of the shortcut delivered to this app as key events: judged hardware (the
    /// two fields and the chord down in the table) or refused (anything else, a real key
    /// whose Option the table hadn't yet read included).
    pub presses: u64,
    pub hardware_presses: u64,
    pub refused_presses: u64,
    /// Ticks on which the HID table armed the gate, and on which it released it.
    pub holds: u64,
    pub releases: u64,
    /// Ticks on which the gate was held and a capture was tried.
    pub capture_attempts: u64,
    /// Captures that returned a frame.
    pub frames: u64,
    /// Ticks on which the gate was held but Screen Recording access was missing.
    pub ticks_without_access: u64,
    /// Ticks on which the HID table read any key down, and Option down, chord or not.
    pub ticks_with_hid_key: u64,
    pub ticks_with_hid_option: u64,
}

/// The shortcut's held state, held by the HID table alone.
#[derive(Debug, Default)]
pub struct Gate {
    held: bool,
    pub counts: Counts,
}

impl Gate {
    /// Judges one key event for the record. The held state doesn't move.
    pub fn on_key(&mut self, key: Key, provenance: Provenance) -> Verdict {
        match key {
            Key::Down { key_code, repeat } if key_code == SHORTCUT_KEY_CODE => {
                if repeat && self.held {
                    return Verdict::Repeat;
                }
                self.counts.presses += 1;
                if provenance.is_hardware() {
                    self.counts.hardware_presses += 1;
                    Verdict::Hardware
                } else {
                    self.counts.refused_presses += 1;
                    Verdict::Refused
                }
            }
            _ => Verdict::Ignored,
        }
    }

    pub fn held(&self) -> bool {
        self.held
    }

    /// Whether a capture may happen on this tick: whether the HID system state table reports
    /// the chord down. The table is the hold's one source, read every tick: it arms the gate
    /// when it reads down, whether or not any event reached this app (the shortcut is global,
    /// and keys go to whichever app is key), and releases it when it reads up, whatever
    /// events said. Events only add their provenance to the record.
    pub fn may_capture(&mut self, hid_chord_down: bool) -> bool {
        if hid_chord_down && !self.held {
            self.counts.holds += 1;
            self.held = true;
        } else if self.held && !hid_chord_down {
            self.counts.releases += 1;
            self.held = false;
        }
        self.held
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use std::{cell::RefCell, ptr::NonNull, rc::Rc, sync::Arc};

    use block2::RcBlock;
    use gpui_kit::{
        div, img, prelude::*, px, rgb, Context, Pixels, Render, RenderImage, Size, Window,
    };
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSView,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    #[allow(deprecated)]
    use objc2_core_graphics::CGDisplayCreateImageForRect;
    use objc2_core_graphics::{
        CGDirectDisplayID, CGDisplayBounds, CGError, CGEvent, CGEventField, CGEventFlags,
        CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGGetDisplaysWithPoint, CGImage,
        CGMainDisplayID, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
        CGWarpMouseCursorPosition,
    };
    use objc2_foundation::NSPoint;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    use super::{Gate, Key, Provenance, SHORTCUT_KEY_CODE};

    /// One event the monitor saw, for the record.
    #[derive(Clone, Debug)]
    pub struct Seen {
        pub kind: &'static str,
        pub key_code: u16,
        pub option: bool,
        pub repeat: bool,
        pub has_cg_event: bool,
        pub source_state: Option<i64>,
        pub source_pid: Option<i64>,
        pub hid_chord_down: bool,
        pub verdict: String,
    }

    /// The whole chord's state in the HID system table, read fresh: Space's key state and
    /// Option in the table's modifier flags. Neither comes from any event.
    pub fn hid_shortcut_down() -> bool {
        let hid = CGEventSourceStateID::HIDSystemState;
        CGEventSource::key_state(hid, SHORTCUT_KEY_CODE)
            && CGEventSource::flags_state(hid).contains(CGEventFlags::MaskAlternate)
    }

    /// What else the HID system table reads right now: any key at all down, and Option
    /// down. The record keeps these so a held run with no chord says whether the table
    /// reads hardware in this process at all, or only nothing was held.
    pub fn hid_any_key_down() -> (bool, bool) {
        let hid = CGEventSourceStateID::HIDSystemState;
        let any = (0u16..128).any(|key_code| CGEventSource::key_state(hid, key_code));
        let option = CGEventSource::flags_state(hid).contains(CGEventFlags::MaskAlternate);
        (any, option)
    }

    /// Reads the event's provenance fields through its `CGEvent`.
    pub fn provenance(event: &NSEvent) -> (bool, Provenance) {
        let cg = event.CGEvent();
        let field = |field| {
            cg.as_deref()
                .map(|cg| CGEvent::integer_value_field(Some(cg), field))
        };
        (
            cg.is_some(),
            Provenance {
                source_state: field(CGEventField::EventSourceStateID),
                source_pid: field(CGEventField::EventSourceUnixProcessID),
                hid_chord_down: hid_shortcut_down(),
            },
        )
    }

    fn key_of(event: &NSEvent) -> Option<Key> {
        match event.r#type() {
            NSEventType::KeyDown => Some(Key::Down {
                key_code: event.keyCode(),
                repeat: event.isARepeat(),
            }),
            NSEventType::KeyUp => Some(Key::Up {
                key_code: event.keyCode(),
            }),
            _ => None,
        }
    }

    /// The local event monitor: every key event this process receives passes the gate first.
    pub struct Monitor {
        token: Retained<AnyObject>,
    }

    impl Drop for Monitor {
        fn drop(&mut self) {
            // SAFETY: the token came from addLocalMonitorForEventsMatchingMask:handler:.
            unsafe { NSEvent::removeMonitor(&self.token) };
        }
    }

    /// Installs the monitor. Every key event is judged, logged to `seen` and passed on.
    pub fn install_monitor(gate: Rc<RefCell<Gate>>, seen: Rc<RefCell<Vec<Seen>>>) -> Monitor {
        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit hands the monitor a live event for the duration of the call.
            let event_ref = unsafe { event.as_ref() };
            if let Some(key) = key_of(event_ref) {
                let (has_cg_event, provenance) = provenance(event_ref);
                let verdict = gate.borrow_mut().on_key(key, provenance);
                let (kind, key_code, repeat) = match key {
                    Key::Down { key_code, repeat } => ("down", key_code, repeat),
                    Key::Up { key_code } => ("up", key_code, false),
                };
                seen.borrow_mut().push(Seen {
                    kind,
                    key_code,
                    // The event's own flag, kept for the record only; the gate never reads it.
                    option: event_ref
                        .modifierFlags()
                        .contains(NSEventModifierFlags::Option),
                    repeat,
                    has_cg_event,
                    source_state: provenance.source_state,
                    source_pid: provenance.source_pid,
                    hid_chord_down: provenance.hid_chord_down,
                    verdict: format!("{verdict:?}"),
                });
            }
            event.as_ptr()
        });
        let mask = NSEventMask::KeyDown | NSEventMask::KeyUp;
        // SAFETY: the block returns the event it was given, a valid pointer.
        let token = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) }
            .expect("a local event monitor");
        Monitor { token }
    }

    /// Whether this process may capture the screen, as the OS reports it: the first call of
    /// `request` shows the Screen Recording prompt once and returns false until it's granted.
    pub fn capture_access() -> bool {
        CGPreflightScreenCaptureAccess()
    }

    pub fn request_capture_access() -> bool {
        CGRequestScreenCaptureAccess()
    }

    /// The main display's bounds in CG coordinates (origin top-left, points).
    pub fn main_display_bounds() -> CGRect {
        CGDisplayBounds(CGMainDisplayID())
    }

    /// The cursor in CG global coordinates (origin at the main display's top-left, points).
    /// AppKit's global space shares the main display's origin with its y axis flipped, so
    /// the main display's height converts a point on any display.
    pub fn cursor_position() -> CGPoint {
        let location: NSPoint = NSEvent::mouseLocation();
        let bounds = main_display_bounds();
        CGPoint::new(location.x, bounds.size.height - location.y)
    }

    /// The display under a point in CG global coordinates, with its bounds in that space;
    /// None when no display holds the point.
    pub fn display_at(point: CGPoint) -> Option<(CGDirectDisplayID, CGRect)> {
        let mut display: CGDirectDisplayID = 0;
        let mut count: u32 = 0;
        // SAFETY: one slot is passed with its capacity, and both pointers outlive the call.
        let error = unsafe { CGGetDisplaysWithPoint(point, 1, &mut display, &mut count) };
        (error == CGError::Success && count > 0).then(|| (display, CGDisplayBounds(display)))
    }

    /// Moves the cursor, for the recording of the cursor window. CG coordinates.
    pub fn warp_cursor(to: CGPoint) {
        let _ = CGWarpMouseCursorPosition(to);
    }

    /// One captured frame: BGRA pixels, as CoreGraphics and gpui both lay them out.
    pub struct Frame {
        pub width: u32,
        pub height: u32,
        pub bgra: Vec<u8>,
    }

    impl Frame {
        /// The frame as gpui's own image, which takes BGRA as given.
        pub fn render_image(&self) -> Option<Arc<RenderImage>> {
            let buffer = image::RgbaImage::from_raw(self.width, self.height, self.bgra.clone())?;
            Some(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
        }

        /// Writes the frame as a PNG, swapping to RGBA on the way.
        pub fn write_png(&self, path: &std::path::Path) -> Result<(), String> {
            let mut rgba = self.bgra.clone();
            for pixel in rgba.as_chunks_mut::<4>().0 {
                pixel.swap(0, 2);
            }
            let buffer = image::RgbaImage::from_raw(self.width, self.height, rgba)
                .ok_or_else(|| "the frame's size and bytes disagree".to_owned())?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            buffer.save(path).map_err(|error| error.to_string())
        }
    }

    /// One frame around `center` (CG global coordinates) from the display under it, kept
    /// inside that display, or None when the capture returned nothing. Call only with
    /// capture access: without it, macOS 10.15 and later hand back the desktop with no
    /// other app's windows, which would count as a frame.
    pub fn capture_around(center: CGPoint, size: Size<Pixels>) -> Option<Frame> {
        let (width, height) = (f64::from(size.width), f64::from(size.height));
        let (display, bounds) = display_at(center)?;
        let (left, top) = (bounds.origin.x, bounds.origin.y);
        let x = (center.x - width / 2.0).clamp(left, left + (bounds.size.width - width).max(0.0));
        let y = (center.y - height / 2.0).clamp(top, top + (bounds.size.height - height).max(0.0));
        let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(width, height));
        // Deprecated in macOS 15 for ScreenCaptureKit, which streams; one frame of one rect is
        // what the spike needs, and gpui's own capture (gpui_platform's screen_capture) is a
        // stream too. The rect is in display space, the same global space as CGDisplayBounds.
        #[allow(deprecated)]
        let image = CGDisplayCreateImageForRect(display, rect)?;
        copy_pixels(&image)
    }

    /// Copies a 32-bit CGImage's rows, dropping each row's padding.
    fn copy_pixels(image: &CGImage) -> Option<Frame> {
        let width = CGImage::width(Some(image));
        let height = CGImage::height(Some(image));
        let bytes_per_row = CGImage::bytes_per_row(Some(image));
        if CGImage::bits_per_pixel(Some(image)) != 32 || width == 0 || height == 0 {
            return None;
        }
        let provider = CGImage::data_provider(Some(image));
        let data = objc2_core_graphics::CGDataProvider::data(provider.as_deref())?;
        let bytes = data.to_vec();
        let mut bgra = Vec::with_capacity(width * height * 4);
        for row in 0..height {
            let start = row * bytes_per_row;
            bgra.extend_from_slice(bytes.get(start..start + width * 4)?);
        }
        Some(Frame {
            width: width as u32,
            height: height as u32,
            bgra,
        })
    }

    /// Moves the window whose view gpui gave us. gpui has no window-move call of its own, so
    /// this reaches the NSWindow through the raw window handle. `origin` is in CG coordinates.
    pub fn move_window(window: &Window, origin: CGPoint, size: Size<Pixels>) {
        let Ok(handle) = HasWindowHandle::window_handle(window) else {
            return;
        };
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            return;
        };
        // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
        let view: &NSView = unsafe { handle.ns_view.cast::<NSView>().as_ref() };
        if let Some(native) = view.window() {
            let bounds = main_display_bounds();
            let ns_y = bounds.size.height - origin.y - f64::from(size.height);
            native.setFrameOrigin(NSPoint::new(origin.x, ns_y));
        }
    }

    /// The small window that follows the cursor and shows the last frame.
    pub struct CursorWindow {
        pub gate: Rc<RefCell<Gate>>,
        pub size: Size<Pixels>,
        frame: Option<(Frame, Arc<RenderImage>)>,
        access: bool,
        requested: bool,
        /// What the window asks of the person while nothing is held.
        hint: &'static str,
    }

    impl CursorWindow {
        pub fn new(gate: Rc<RefCell<Gate>>, size: Size<Pixels>, hint: &'static str) -> Self {
            Self {
                gate,
                size,
                frame: None,
                access: capture_access(),
                requested: false,
                hint,
            }
        }

        /// Whether the Screen Recording prompt was asked for in this run.
        pub fn requested(&self) -> bool {
            self.requested
        }

        /// Asks for Screen Recording access now, unless it's granted: the system shows its
        /// prompt once per app, and the answer is read back on every later tick.
        pub fn request(&mut self) {
            self.access = capture_access();
            if !self.access && !self.requested {
                self.requested = true;
                self.access = request_capture_access();
            }
        }

        pub fn has_frame(&self) -> bool {
            self.frame.is_some()
        }

        /// Writes the last frame as a PNG; an error when there is none or the write fails.
        pub fn write_frame(&self, path: &std::path::Path) -> Result<(), String> {
            match &self.frame {
                Some((frame, _)) => frame.write_png(path),
                None => Err("no frame has been captured".to_owned()),
            }
        }

        /// One tick: follow the cursor, and capture if the gate is held.
        pub fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
            self.access = capture_access();
            let cursor = cursor_position();
            move_window(
                window,
                CGPoint::new(cursor.x + 24.0, cursor.y + 24.0),
                self.size,
            );
            let (any_key, option) = hid_any_key_down();
            {
                let mut gate = self.gate.borrow_mut();
                gate.counts.ticks_with_hid_key += u64::from(any_key);
                gate.counts.ticks_with_hid_option += u64::from(option);
            }
            let may_capture = self.gate.borrow_mut().may_capture(hid_shortcut_down());
            if may_capture {
                self.request();
                let mut gate = self.gate.borrow_mut();
                if self.access {
                    gate.counts.capture_attempts += 1;
                    if let Some(frame) = capture_around(cursor, self.size) {
                        if let Some(image) = frame.render_image() {
                            gate.counts.frames += 1;
                            self.frame = Some((frame, image));
                        }
                    }
                } else {
                    gate.counts.ticks_without_access += 1;
                }
            }
            cx.notify();
        }
    }

    impl Render for CursorWindow {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let counts = self.gate.borrow().counts.clone();
            let held = self.gate.borrow().held();
            let status = if held {
                "held".to_owned()
            } else if !self.access {
                "Screen Recording not granted".to_owned()
            } else {
                self.hint.to_owned()
            };
            div()
                .id("cursor-window")
                .size_full()
                .flex()
                .flex_col()
                .bg(rgb(0x111111))
                .text_color(rgb(0xf5f5f5))
                .text_xs()
                .border_1()
                .border_color(if held { rgb(0xfacc15) } else { rgb(0x444444) })
                .child(div().flex_1().flex().items_center().justify_center().child(
                    match &self.frame {
                        Some((_, image)) => img(image.clone()).size_full().into_any_element(),
                        None => div().child(status).into_any_element(),
                    },
                ))
                .child(div().px_1().h(px(16.)).child(format!(
                    "presses {} · refused {} · frames {}",
                    counts.presses, counts.refused_presses, counts.frames
                )))
        }
    }

    /// How a synthetic press is made. Each is a way a program in this process, or one that
    /// may post events, would press the shortcut without a keyboard.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum SyntheticForm {
        /// `NSEvent.keyEvent(...)`, delivered through `NSApplication.sendEvent`.
        NsSend,
        /// `NSEvent.keyEvent(...)`, queued through `NSApplication.postEvent:atStart:`.
        NsPost,
        /// A `CGEvent` from `CGEventCreateKeyboardEvent` with no source, wrapped in an
        /// `NSEvent` and queued through `postEvent:atStart:`.
        CgPost,
        /// A `CGEvent` whose source claims the HID system state table and whose posting
        /// pid was set to 0 before it was wrapped and queued: the forged form.
        CgForgedHid,
    }

    pub const SYNTHETIC_FORMS: [SyntheticForm; 4] = [
        SyntheticForm::NsSend,
        SyntheticForm::NsPost,
        SyntheticForm::CgPost,
        SyntheticForm::CgForgedHid,
    ];

    fn ns_key_event(down: bool) -> Retained<NSEvent> {
        let space = objc2_foundation::NSString::from_str(" ");
        NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            if down { NSEventType::KeyDown } else { NSEventType::KeyUp },
            NSPoint::new(0.0, 0.0),
            NSEventModifierFlags::Option,
            0.0,
            0,
            None,
            &space,
            &space,
            false,
            SHORTCUT_KEY_CODE,
        )
        .expect("a key event")
    }

    fn cg_key_event(forged: bool, down: bool) -> Retained<NSEvent> {
        let source = forged.then(|| {
            CGEventSource::new(CGEventSourceStateID::HIDSystemState).expect("an event source")
        });
        let event = CGEvent::new_keyboard_event(source.as_deref(), SHORTCUT_KEY_CODE, down)
            .expect("a keyboard event");
        CGEvent::set_flags(Some(&event), CGEventFlags::MaskAlternate);
        if forged {
            CGEvent::set_integer_value_field(
                Some(&event),
                CGEventField::EventSourceUnixProcessID,
                super::NO_POSTING_PROCESS,
            );
        }
        NSEvent::eventWithCGEvent(&event).expect("an NSEvent from the CGEvent")
    }

    /// Presses the shortcut once without a keyboard, in the given form: a key down and a key up.
    pub fn press_synthetically(mtm: MainThreadMarker, form: SyntheticForm) {
        let app = NSApplication::sharedApplication(mtm);
        match form {
            SyntheticForm::NsSend => {
                app.sendEvent(&ns_key_event(true));
                app.sendEvent(&ns_key_event(false));
            }
            SyntheticForm::NsPost => {
                app.postEvent_atStart(&ns_key_event(true), false);
                app.postEvent_atStart(&ns_key_event(false), false);
            }
            SyntheticForm::CgPost => {
                app.postEvent_atStart(&cg_key_event(false, true), false);
                app.postEvent_atStart(&cg_key_event(false, false), false);
            }
            SyntheticForm::CgForgedHid => {
                app.postEvent_atStart(&cg_key_event(true, true), false);
                app.postEvent_atStart(&cg_key_event(true, false), false);
            }
        }
    }

    pub fn main_thread() -> MainThreadMarker {
        MainThreadMarker::new().expect("the trusted-input layer runs on the main thread")
    }

    /// Whether this app is the active one, the only one whose keys a local monitor sees.
    pub fn app_is_active(mtm: MainThreadMarker) -> bool {
        NSApplication::sharedApplication(mtm).isActive()
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    /// Whether this process holds the Accessibility permission, which `CGEventPost` needs.
    pub fn accessibility_trusted() -> bool {
        // SAFETY: a plain call with no arguments.
        unsafe { AXIsProcessTrusted() }
    }

    /// What a poster run reports: how many chords it posted and whether it was trusted.
    #[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
    pub struct Posted {
        pub pid: u32,
        pub posted: u64,
        pub accessibility_trusted: bool,
    }

    /// The forged form from another process: `count` chords posted at the HID event tap, each
    /// Option down, Space down, held 100 ms, Space up, Option up, from a `CGEventSource` that
    /// claims the HID system state table with the posting pid set to 0. Without the
    /// Accessibility permission macOS delivers none of them. What arrives, and whether such
    /// a post writes the HID state table the gate reads, is what the probe's ticks read
    /// while this runs.
    pub fn post_forged_chords(count: u64) -> Posted {
        let source =
            CGEventSource::new(CGEventSourceStateID::HIDSystemState).expect("an event source");
        let key = |key_code: u16, down: bool, flags: CGEventFlags| {
            let event = CGEvent::new_keyboard_event(Some(&source), key_code, down)
                .expect("a keyboard event");
            CGEvent::set_flags(Some(&event), flags);
            CGEvent::set_integer_value_field(
                Some(&event),
                CGEventField::EventSourceUnixProcessID,
                super::NO_POSTING_PROCESS,
            );
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&event));
        };
        const OPTION: u16 = 58; // kVK_Option
        for _ in 0..count {
            // Held across several 16 ms ticks, so the probe's table readings cover it.
            key(OPTION, true, CGEventFlags::MaskAlternate);
            key(SHORTCUT_KEY_CODE, true, CGEventFlags::MaskAlternate);
            std::thread::sleep(std::time::Duration::from_millis(100));
            key(SHORTCUT_KEY_CODE, false, CGEventFlags::MaskAlternate);
            key(OPTION, false, CGEventFlags::empty());
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        Posted {
            pid: std::process::id(),
            posted: count,
            accessibility_trusted: accessibility_trusted(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hardware() -> Provenance {
        Provenance {
            source_state: Some(HID_SYSTEM_STATE),
            source_pid: Some(NO_POSTING_PROCESS),
            hid_chord_down: true,
        }
    }

    fn down(repeat: bool) -> Key {
        Key::Down {
            key_code: SHORTCUT_KEY_CODE,
            repeat,
        }
    }

    #[test]
    fn a_hardware_press_is_counted_and_only_the_table_holds_the_gate() {
        let mut gate = Gate::default();
        assert_eq!(gate.on_key(down(false), hardware()), Verdict::Hardware);
        assert!(
            !gate.held(),
            "an event never holds; the next tick's table does"
        );
        assert!(gate.may_capture(true));
        assert_eq!(gate.on_key(down(true), hardware()), Verdict::Repeat);
        assert_eq!(gate.counts.presses, 1);
        assert_eq!(gate.counts.hardware_presses, 1);
        assert_eq!(gate.counts.holds, 1);
    }

    #[test]
    fn a_key_up_event_never_lets_go_of_a_chord_the_table_reads_down() {
        // A synthetic key-up while a person holds the chord would otherwise close the gate,
        // which the next tick would reopen as a second hold.
        let mut gate = Gate::default();
        assert!(gate.may_capture(true));
        let synthetic = Provenance {
            source_state: Some(0),
            source_pid: Some(1),
            hid_chord_down: true,
        };
        assert_eq!(
            gate.on_key(
                Key::Up {
                    key_code: SHORTCUT_KEY_CODE
                },
                synthetic
            ),
            Verdict::Ignored
        );
        assert!(gate.held());
        assert!(gate.may_capture(true));
        assert_eq!(gate.counts.holds, 1);
        assert_eq!(gate.counts.releases, 0);
    }

    #[test]
    fn letting_option_go_disarms_on_the_next_tick() {
        // Option's release reaches the gate only through the HID table, read each tick.
        let mut gate = Gate::default();
        gate.on_key(down(false), hardware());
        assert!(gate.may_capture(true));
        assert!(!gate.may_capture(false));
        assert!(!gate.held());
        assert_eq!(gate.counts.releases, 1);
    }

    #[test]
    fn a_press_whose_fields_pass_but_whose_chord_the_hid_table_reads_up_is_refused() {
        // The forged form: hardware's two fields on a built event, Space held on the keyboard
        // or not, but Option not down in the HID table. The event's own flags never count.
        let mut gate = Gate::default();
        let forged = Provenance {
            hid_chord_down: false,
            ..hardware()
        };
        assert_eq!(gate.on_key(down(false), forged), Verdict::Refused);
        assert!(!gate.may_capture(false));
        assert_eq!(gate.counts.frames, 0);
    }

    #[test]
    fn every_synthetic_provenance_is_refused() {
        let own_pid = 4242;
        let synthetic = [
            // Built in the process: the combined session state, this pid.
            Provenance {
                source_state: Some(0),
                source_pid: Some(own_pid),
                hid_chord_down: false,
            },
            // A HID-state source, but posted by a process.
            Provenance {
                source_state: Some(HID_SYSTEM_STATE),
                source_pid: Some(own_pid),
                hid_chord_down: false,
            },
            // Forged fields, but the HID table says the key is up.
            Provenance {
                source_state: Some(HID_SYSTEM_STATE),
                source_pid: Some(NO_POSTING_PROCESS),
                hid_chord_down: false,
            },
            // A private source state.
            Provenance {
                source_state: Some(-1),
                source_pid: Some(NO_POSTING_PROCESS),
                hid_chord_down: true,
            },
            // No CGEvent at all.
            Provenance::default(),
        ];
        for provenance in synthetic {
            let mut gate = Gate::default();
            assert_eq!(
                gate.on_key(down(false), provenance),
                Verdict::Refused,
                "{provenance:?}"
            );
            assert!(!gate.held(), "{provenance:?}");
            assert_eq!(gate.counts.refused_presses, 1);
            assert_eq!(gate.counts.hardware_presses, 0);
            // The tick arms only from the HID table: the event's fields never do, and a
            // table that reads the chord down is a chord on the keyboard whatever arrived.
            assert_eq!(
                gate.may_capture(provenance.hid_chord_down),
                provenance.hid_chord_down,
                "{provenance:?}"
            );
        }
    }

    #[test]
    fn two_hundred_synthetic_presses_never_hold() {
        let mut gate = Gate::default();
        let synthetic = Provenance {
            source_state: Some(0),
            source_pid: Some(1),
            hid_chord_down: false,
        };
        for _ in 0..200 {
            gate.on_key(down(false), synthetic);
            assert!(!gate.may_capture(false));
            gate.on_key(
                Key::Up {
                    key_code: SHORTCUT_KEY_CODE,
                },
                synthetic,
            );
        }
        assert_eq!(gate.counts.presses, 200);
        assert_eq!(gate.counts.refused_presses, 200);
        assert_eq!(gate.counts.capture_attempts, 0);
        assert_eq!(gate.counts.frames, 0);
    }

    #[test]
    fn a_chord_the_hid_table_reads_down_arms_without_any_event() {
        // The shortcut is global: when another app is key no event reaches this one, and
        // the HID table is the only reading. It alone arms the gate.
        let mut gate = Gate::default();
        assert!(gate.may_capture(true));
        assert!(gate.held());
        assert_eq!(gate.counts.holds, 1);
        assert_eq!(gate.counts.presses, 0, "no event arrived");
        assert!(gate.may_capture(true));
        assert_eq!(gate.counts.holds, 1, "a held chord is one hold");
        assert!(!gate.may_capture(false));
        assert_eq!(gate.counts.releases, 1);
    }

    #[test]
    fn a_held_gate_releases_when_the_hid_table_says_up() {
        let mut gate = Gate::default();
        gate.on_key(down(false), hardware());
        assert!(gate.may_capture(true));
        assert!(!gate.may_capture(false));
        assert!(!gate.held());
    }

    #[test]
    fn other_keys_are_ignored() {
        let mut gate = Gate::default();
        for key_code in [0, 36, 58, 61] {
            assert_eq!(
                gate.on_key(
                    Key::Down {
                        key_code,
                        repeat: false
                    },
                    hardware()
                ),
                Verdict::Ignored
            );
            assert_eq!(
                gate.on_key(Key::Up { key_code }, hardware()),
                Verdict::Ignored
            );
        }
        assert_eq!(gate.counts.presses, 0);
        assert!(!gate.held());
    }
}
