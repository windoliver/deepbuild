//! `--contact-sheet` (#1592): one window drawing every status mark and every icon the chrome draws, in the appearance
//! DEEP_APP_APPEARANCE forces, with no hub and no record. In a contact-sheet build only.

use gpui_kit::*;

pub fn run() {
    // macOS has no outside switch for one process's appearance, so a check forces it here, as for the app's window.
    match std::env::var("DEEP_APP_APPEARANCE").as_deref() {
        Ok("dark") => deep_app::chrome::force_dark(Some(true)),
        Ok("light") => deep_app::chrome::force_dark(Some(false)),
        _ => {}
    }
    application().run(|cx| {
        gpui_kit::init(cx);
        deep_app::contact_sheet::open(cx);
        cx.activate(true);
    });
}
