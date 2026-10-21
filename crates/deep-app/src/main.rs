//! `deep-app [--panel DIR]`: the spike's window, with the count in the menu bar.
//!
//! With `DEEP_APP_EXIT_AFTER_FIRST_FRAME` set it prints `first-frame-ms N` once the window
//! has drawn and quits, which is how the spike measures cold start.

use std::{path::PathBuf, time::Instant};

use deep_app::{init, menu_bar_title, mount_panel, sessions, Spike};
use gpui_kit::*;

fn main() {
    let started = Instant::now();
    let panel_dir = panel_arg();
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        menu_bar::show_title(&menu_bar_title(&sessions()));

        let runtime = deep_app::new_runtime().expect("panel runtime");
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(960.), px(640.)), cx)),
            ..Default::default()
        };
        open_window(options, cx, move |window, cx| {
            let panel = panel_dir.as_ref().map(|dir| {
                let view = mount_panel(&runtime, dir, window, cx)
                    .unwrap_or_else(|error| panic!("panel {}: {error:#}", dir.display()));
                (dir.display().to_string(), view)
            });
            window.on_next_frame(move |_, cx| {
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                eprintln!("first-frame-ms {ms:.1}");
                if std::env::var_os("DEEP_APP_EXIT_AFTER_FIRST_FRAME").is_some() {
                    cx.quit();
                }
            });
            cx.new(|_| Spike::new(panel))
        })
        .expect("open window");
        cx.activate(true);
    });
}

fn panel_arg() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--panel" {
            return Some(PathBuf::from(
                args.next().expect("--panel takes a directory"),
            ));
        }
    }
    None
}

#[cfg(target_os = "macos")]
mod menu_bar {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSStatusBar, NSVariableStatusItemLength};
    use objc2_foundation::NSString;

    /// gpui-kit has no menu-bar item, so the count is one `NSStatusItem`, kept for the life
    /// of the process.
    pub fn show_title(title: &str) {
        let mtm = MainThreadMarker::new().expect("the menu bar is set from the main thread");
        let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
        if let Some(button) = item.button(mtm) {
            button.setTitle(&NSString::from_str(title));
        }
        std::mem::forget(item);
    }
}

#[cfg(not(target_os = "macos"))]
mod menu_bar {
    pub fn show_title(_: &str) {}
}
