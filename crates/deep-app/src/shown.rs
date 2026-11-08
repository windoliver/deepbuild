//! Issue #262: the app tells the hub which plug-in views it shows, so a source that runs only while shown is called
//! only while you look. Every 5 s it reports `views.shown` for each view its window draws, with the window's state;
//! the view counts as shown only while the window is visible and not minimized, on an awake display, with your
//! session unlocked. Once a view stops counting, the app reports `views.hidden` for it once. The hub counts a view
//! hidden when no report came in 10 s, so a window that stops drawing, or an app that stops, stops counting too. The
//! app is never a replica: a replica draws views without a hub, and its reports, if any, say so.

use std::path::Path;
use std::time::Duration;

use gpui_kit::{AnyWindowHandle, App, AppContext as _, Window};
use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};

/// How often each shown view is reported again.
pub const EVERY: Duration = Duration::from_secs(5);

/// The window's state as the app reads it from the OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Seen {
    pub visible: bool,
    pub minimized: bool,
    pub display_awake: bool,
    pub session_locked: bool,
}

impl Seen {
    /// Whether a view this window draws counts as shown.
    pub fn shown(&self) -> bool {
        self.visible && !self.minimized && self.display_awake && !self.session_locked
    }
}

/// The views one window draws, and whether they counted as shown at the last report.
pub struct Reporter {
    window: String,
    views: Vec<String>,
    shown: bool,
}

impl Reporter {
    pub fn new(window: &str, views: Vec<String>) -> Self {
        Self {
            window: window.to_owned(),
            views,
            shown: false,
        }
    }

    /// One report's calls, as `(method, params)`: `views.shown` for each view while the window shows it, and
    /// `views.hidden` for each once as it stops, or the window closes (`None`).
    pub fn report(&mut self, seen: Option<Seen>) -> Vec<(&'static str, Value)> {
        let shown = seen.is_some_and(|seen| seen.shown());
        let calls = match seen {
            Some(seen) if shown => self
                .views
                .iter()
                .map(|view| {
                    let params = json!({
                        "view": view,
                        "window": self.window,
                        "visible": seen.visible,
                        "minimized": seen.minimized,
                        "display_awake": seen.display_awake,
                        "session_locked": seen.session_locked,
                        "replica": false,
                    });
                    ("views.shown", params)
                })
                .collect(),
            _ if self.shown => self
                .views
                .iter()
                .map(|view| {
                    (
                        "views.hidden",
                        json!({ "view": view, "window": self.window }),
                    )
                })
                .collect(),
            _ => Vec::new(),
        };
        self.shown = shown;
        calls
    }
}

/// Reports the views `window` draws to the hub every 5 s while the app runs, reconnecting once the hub is back.
pub fn start(
    views: Vec<String>,
    window: AnyWindowHandle,
    socket: &Path,
    token_file: &Path,
    cx: &mut App,
) {
    let (socket, token_file) = (socket.to_owned(), token_file.to_owned());
    let mut reporter = Reporter::new(&format!("{}", window.window_id().as_u64()), views);
    let mut client: Option<HubClient> = None;
    cx.spawn(async move |cx| loop {
        let seen = cx.update_window(window, |_, window, _| seen(window)).ok();
        let calls = reporter.report(seen);
        if !calls.is_empty() {
            if client.is_none() {
                client = connect(&socket, &token_file).ok();
            }
            if let Some(c) = client.as_mut() {
                if let Err(error) = calls
                    .into_iter()
                    .try_for_each(|(method, params)| c.call(method, params).map(drop))
                {
                    eprintln!("deep-app: views/shown didn't reach the hub: {error:?}");
                    client = None;
                }
            }
        }
        if seen.is_none() {
            break;
        }
        cx.background_executor().timer(EVERY).await;
    })
    .detach();
}

fn connect(socket: &Path, token_file: &Path) -> Result<HubClient, HubError> {
    let token = std::fs::read_to_string(token_file)?;
    let mut client = HubClient::connect(socket)?;
    client.covers_app()?;
    client.hello_app(token.trim())?;
    Ok(client)
}

/// The window's state: AppKit's occlusion and miniaturized state, its display's sleep, and the session's lock.
#[cfg(target_os = "macos")]
pub fn seen(window: &Window) -> Seen {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSView, NSWindowOcclusionState};
    use objc2_core_foundation::CFRetained;
    use objc2_core_graphics::{CGDisplayIsAsleep, CGSessionCopyCurrentDictionary};
    use objc2_foundation::{ns_string, NSDictionary, NSNumber, NSString};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let ns_window = HasWindowHandle::window_handle(window)
        .ok()
        .and_then(|handle| match handle.as_raw() {
            // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
            RawWindowHandle::AppKit(handle) => {
                unsafe { handle.ns_view.cast::<NSView>().as_ref() }.window()
            }
            _ => None,
        });
    let Some(ns_window) = ns_window else {
        return Seen {
            visible: false,
            minimized: false,
            display_awake: false,
            session_locked: false,
        };
    };
    let display = ns_window.screen().and_then(|screen| {
        let number = screen
            .deviceDescription()
            .objectForKey(ns_string!("NSScreenNumber"))?;
        Some(number.downcast::<NSNumber>().ok()?.unsignedIntValue())
    });
    let session_locked = CGSessionCopyCurrentDictionary().is_some_and(|session| {
        // SAFETY: a CFDictionary is toll-free bridged to an NSDictionary.
        let session: &NSDictionary<NSString, AnyObject> =
            unsafe { CFRetained::as_ptr(&session).cast().as_ref() };
        session
            .objectForKey(ns_string!("CGSSessionScreenIsLocked"))
            .and_then(|locked| locked.downcast::<NSNumber>().ok())
            .is_some_and(|locked| locked.boolValue())
    });
    Seen {
        visible: ns_window
            .occlusionState()
            .contains(NSWindowOcclusionState::Visible),
        minimized: ns_window.isMiniaturized(),
        display_awake: display.is_some_and(|display| !CGDisplayIsAsleep(display)),
        session_locked,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn seen(_: &Window) -> Seen {
    Seen {
        visible: true,
        minimized: false,
        display_awake: true,
        session_locked: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOWN: Seen = Seen {
        visible: true,
        minimized: false,
        display_awake: true,
        session_locked: false,
    };

    fn methods(calls: &[(&'static str, Value)]) -> Vec<String> {
        calls
            .iter()
            .map(|(method, params)| format!("{method} {}", params["view"].as_str().unwrap()))
            .collect()
    }

    #[test]
    fn a_shown_window_reports_each_view_every_time_and_hidden_once_as_it_stops() {
        let mut reporter = Reporter::new("w1", vec!["orders".into(), "health".into()]);
        assert_eq!(
            methods(&reporter.report(Some(SHOWN))),
            ["views.shown orders", "views.shown health"]
        );
        assert_eq!(
            methods(&reporter.report(Some(SHOWN))),
            ["views.shown orders", "views.shown health"]
        );
        let minimized = Seen {
            minimized: true,
            ..SHOWN
        };
        assert_eq!(
            methods(&reporter.report(Some(minimized))),
            ["views.hidden orders", "views.hidden health"]
        );
        assert!(
            reporter.report(Some(minimized)).is_empty(),
            "a hidden view is reported hidden once"
        );
        assert_eq!(
            methods(&reporter.report(Some(SHOWN))),
            ["views.shown orders", "views.shown health"]
        );
        assert_eq!(
            methods(&reporter.report(None)),
            ["views.hidden orders", "views.hidden health"],
            "a closed window"
        );
    }

    #[test]
    fn a_view_counts_as_shown_only_visible_unminimized_on_an_awake_display_unlocked() {
        let mut reporter = Reporter::new("w1", vec!["orders".into()]);
        for (what, seen) in [
            (
                "occluded",
                Seen {
                    visible: false,
                    ..SHOWN
                },
            ),
            (
                "minimized",
                Seen {
                    minimized: true,
                    ..SHOWN
                },
            ),
            (
                "on a sleeping display",
                Seen {
                    display_awake: false,
                    ..SHOWN
                },
            ),
            (
                "locked",
                Seen {
                    session_locked: true,
                    ..SHOWN
                },
            ),
        ] {
            assert!(
                reporter.report(Some(seen)).is_empty(),
                "a window {what} reports no views.shown"
            );
        }
        let [(method, params)] = &reporter.report(Some(SHOWN))[..] else {
            panic!("one call")
        };
        assert_eq!(*method, "views.shown");
        assert_eq!(
            params,
            &json!({ "view": "orders", "window": "w1", "visible": true, "minimized": false, "display_awake": true, "session_locked": false, "replica": false })
        );
    }
}
