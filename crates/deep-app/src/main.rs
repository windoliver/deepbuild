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
        menu_bar::set_dock_icon();
        menu_bar::show_title(&menu_bar_title(&sessions()));

        let runtime = gpui_shell::components::new_isolated_runtime().expect("panel runtime");
        // The window draws its own title bar, with the mark, so it owns the bar's drag.
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(960.), px(640.)), cx)),
            ..gpui_kit::component::TitleBar::window_options()
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
    use deep_app::brand;
    use objc2::{rc::Retained, AllocAnyThread as _, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSBitmapImageRep, NSCellImagePosition, NSImage, NSStatusBar,
        NSVariableStatusItemLength,
    };
    use objc2_foundation::{NSData, NSSize, NSString};

    /// The kit's menu-bar template as one image with both scales, 16 pt, marked as a template
    /// so macOS tints it for the light and the dark menu bar.
    fn template() -> Option<Retained<NSImage>> {
        let size = NSSize::new(brand::MENU_BAR_PT, brand::MENU_BAR_PT);
        let image = NSImage::initWithData(
            NSImage::alloc(),
            &NSData::with_bytes(brand::MENU_BAR_TEMPLATE),
        )?;
        if let Some(rep) =
            NSBitmapImageRep::imageRepWithData(&NSData::with_bytes(brand::MENU_BAR_TEMPLATE_2X))
        {
            rep.setSize(size);
            image.addRepresentation(&rep);
        }
        image.setSize(size);
        image.setTemplate(true);
        Some(image)
    }

    /// There is no `.app` bundle yet, so the dock shows the kit's `.icns` set on the running app.
    pub fn set_dock_icon() {
        let mtm = MainThreadMarker::new().expect("the dock icon is set from the main thread");
        let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(brand::APP_ICON));
        // SAFETY: called on the main thread with an image this process owns.
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };
    }

    /// gpui-kit has no menu-bar item, so the count is one `NSStatusItem`, kept for the life
    /// of the process, with the template mark before the count.
    pub fn show_title(title: &str) {
        let mtm = MainThreadMarker::new().expect("the menu bar is set from the main thread");
        let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
        if let Some(button) = item.button(mtm) {
            if let Some(image) = template() {
                button.setImage(Some(&image));
                button.setImagePosition(NSCellImagePosition::ImageLeading);
            }
            button.setTitle(&NSString::from_str(title));
        }
        std::mem::forget(item);
    }
}

#[cfg(not(target_os = "macos"))]
mod menu_bar {
    pub fn set_dock_icon() {}
    pub fn show_title(_: &str) {}
}
