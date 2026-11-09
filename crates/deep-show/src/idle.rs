//! What `deep-show live` reads of a still window (#1551; the #1551 acceptance README, "The surface
//! under test"): the requests that wake it from idle (`wake`), whether the window was shown
//! while it was watched, and what the process spent meanwhile. The frame clock itself is
//! `watch.rs`'s; the display link that runs its callbacks is the vendored `gpui-pre-macos`'s.

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSPoint;
use serde_json::{json, Map, Value};

use crate::hub::Call;

/// How a request wakes the still window.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum By {
    /// A call played through the hub that makes a new revision current.
    HubEvent,
    /// A thread other than the main thread notifies the view.
    ThreadNotify,
    /// The last drawn frame presented again without a redraw.
    PresentOnly,
    /// A pointer move posted into AppKit's event queue for the window.
    Input,
}

impl By {
    pub fn name(self) -> &'static str {
        match self {
            By::HubEvent => "hub_event",
            By::ThreadNotify => "thread_notify",
            By::PresentOnly => "present_only",
            By::Input => "input",
        }
    }
}

/// One asked wake: `after_ms` after the window settled.
pub struct Wake {
    pub after_ms: u64,
    pub by: By,
    pub call: Option<(Call, i64)>,
}

/// Reads the `wake` list; `None` for one the README doesn't allow.
pub fn parse(
    list: &Value,
    call: impl Fn(&Map<String, Value>) -> Option<Call>,
) -> Option<Vec<Wake>> {
    list.as_array()?
        .iter()
        .map(|w| {
            let by = match w.get("by")?.as_str()? {
                "hub_event" => By::HubEvent,
                "thread_notify" => By::ThreadNotify,
                "present_only" => By::PresentOnly,
                "input" => By::Input,
                _ => return None,
            };
            let played = match (by, w.get("call")) {
                (By::HubEvent, Some(c)) => {
                    let c = c.as_object()?;
                    let at = match c.get("at") {
                        None => 0,
                        Some(t) => t.as_i64().filter(|t| *t >= 0)?,
                    };
                    Some((call(c)?, at))
                }
                (By::HubEvent, None) | (_, Some(_)) => return None,
                (_, None) => None,
            };
            Some(Wake {
                after_ms: w.get("after_ms")?.as_u64()?,
                by,
                call: played,
            })
        })
        .collect()
}

/// What a wake did: when it was asked, and the frame that answers it, if one is known up front.
pub struct Asked {
    pub after_ms: u64,
    pub by: By,
    pub requested_ns: i64,
    pub frame_seq: Option<u64>,
}

/// The window from the moment it settled to the end of the run: the first state other than
/// shown it entered, and how long it was shown.
pub struct Track {
    at: i64,
    shown: bool,
    shown_ns: i64,
    first_other: Option<&'static str>,
}

impl Track {
    pub fn new(at: i64, state: &'static str) -> Self {
        let mut track = Track {
            at,
            shown: false,
            shown_ns: 0,
            first_other: None,
        };
        track.note(at, state);
        track
    }

    /// The window's state at `at`, read when AppKit reports a change and at the run's end.
    pub fn note(&mut self, at: i64, state: &'static str) {
        if self.shown {
            self.shown_ns += at - self.at;
        }
        self.at = at;
        self.shown = state == "shown";
        if !self.shown && self.first_other.is_none() {
            self.first_other = Some(state);
        }
    }

    pub fn json(&self) -> Value {
        json!({
            "state": self.first_other.unwrap_or("shown"),
            "shown_ms": self.shown_ns as f64 / 1e6,
        })
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGDisplayIsAsleep(display: u32) -> i32;
}

/// What AppKit shows of the window now: `hidden` (ordered out or minimized), `display_asleep`,
/// `covered` (ordered in but occluded) or `shown`.
///
/// SAFETY: `ns_window` is null or a live NSWindow; this runs on the main thread.
pub unsafe fn window_state(ns_window: *mut AnyObject) -> &'static str {
    if ns_window.is_null() {
        return "hidden";
    }
    let visible: bool = msg_send![&*ns_window, isVisible];
    let minimized: bool = msg_send![&*ns_window, isMiniaturized];
    if !visible || minimized {
        return "hidden";
    }
    let screen: *mut AnyObject = msg_send![&*ns_window, screen];
    if screen.is_null() {
        return "hidden";
    }
    let description: *mut AnyObject = msg_send![&*screen, deviceDescription];
    let key: *mut AnyObject =
        msg_send![class!(NSString), stringWithUTF8String: c"NSScreenNumber".as_ptr()];
    let number: *mut AnyObject = msg_send![&*description, objectForKey: key];
    if !number.is_null() {
        let display: u32 = msg_send![&*number, unsignedIntValue];
        if CGDisplayIsAsleep(display) != 0 {
            return "display_asleep";
        }
    }
    let occlusion: usize = msg_send![&*ns_window, occlusionState];
    if occlusion & (1 << 1) == 0 {
        return "covered";
    }
    "shown"
}

/// Posts a pointer move over `point` (window coordinates, origin at the bottom left) into
/// AppKit's event queue for the window, as `NSApplication.postEvent:atStart:` queues any event.
///
/// SAFETY: `ns_window` is a live NSWindow; this runs on the main thread.
pub unsafe fn post_pointer_move(ns_window: *mut AnyObject, point: NSPoint, uptime_s: f64) {
    let number: isize = msg_send![&*ns_window, windowNumber];
    let nil: *mut AnyObject = std::ptr::null_mut();
    // NSEventTypeMouseMoved is 5.
    let event: *mut AnyObject = msg_send![
        class!(NSEvent),
        mouseEventWithType: 5usize,
        location: point,
        modifierFlags: 0usize,
        timestamp: uptime_s,
        windowNumber: number,
        context: nil,
        eventNumber: 0isize,
        clickCount: 0isize,
        pressure: 0f32
    ];
    if event.is_null() {
        return;
    }
    let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
    let _: () = msg_send![&*app, postEvent: event, atStart: false];
}

/// Has the window take pointer moves queued for it. GPUI's normal window hears the real cursor
/// through a tracking area and turns this off, so AppKit would drop a queued move; on, the window
/// hands it to GPUI's view as it does real input.
///
/// SAFETY: `ns_window` is null or a live NSWindow; this runs on the main thread.
pub unsafe fn accept_posted_moves(ns_window: *mut AnyObject) {
    if !ns_window.is_null() {
        let _: () = msg_send![&*ns_window, setAcceptsMouseMovedEvents: true];
    }
}

/// The process's package-idle and interrupt wakeups, its CPU, every thread's, in ns, and its
/// energy in nJ (#1492: a reading only).
#[derive(Clone, Copy)]
pub struct Usage {
    pub wakeups: u64,
    pub interrupts: u64,
    pub cpu_ns: u64,
    pub energy_nj: u64,
}

/// The counter `Usage::energy_nj` comes from.
pub const ENERGY_COUNTER: &str = "ri_energy_nj";

/// The kernel's `rusage_info_v6`: libc stops at v4, and v6 is where Apple Silicon's energy counter is.
#[repr(C)]
struct RusageV6 {
    v4: libc::rusage_info_v4,
    ri_flags: u64,
    ri_user_ptime: u64,
    ri_system_ptime: u64,
    ri_pinstructions: u64,
    ri_pcycles: u64,
    ri_energy_nj: u64,
    ri_penergy_nj: u64,
    reserved: [u64; 14],
}

/// What the process spent from `t0` to `t1` (host ns), as `live.process` reports it.
pub fn spent(t0: i64, u0: Usage, t1: i64, u1: Usage) -> Value {
    json!({
        "from_ns": t0, "seconds": (t1 - t0) as f64 / 1e9, "wakeups": u1.wakeups - u0.wakeups,
        "interrupt_wakeups": u1.interrupts - u0.interrupts,
        "cpu_ms": (u1.cpu_ns - u0.cpu_ns) as f64 / 1e6,
        "energy": { "counter": ENERGY_COUNTER, "nj": u1.energy_nj.saturating_sub(u0.energy_nj) },
    })
}

pub fn usage() -> Usage {
    // SAFETY: an all-zero RusageV6 and rusage are valid for the calls to fill.
    let mut info: RusageV6 = unsafe { std::mem::zeroed() };
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is laid out as rusage_info_v6, the flavor asked for (6); `ru` is a rusage.
    let status = unsafe {
        let status =
            libc::proc_pid_rusage(libc::getpid(), 6, (&raw mut info).cast::<libc::rusage_info_t>());
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
        status
    };
    let ns = |t: libc::timeval| t.tv_sec as u64 * 1_000_000_000 + t.tv_usec as u64 * 1_000;
    Usage {
        wakeups: info.v4.ri_pkg_idle_wkups,
        interrupts: info.v4.ri_interrupt_wkups,
        cpu_ns: ns(ru.ru_utime) + ns(ru.ru_stime),
        energy_nj: if status == 0 { info.ri_energy_nj } else { 0 },
    }
}
