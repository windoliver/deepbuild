//! `--hdr <scenario.json>` (#177): a scene document in a live 3D view in the app's real window,
//! its HDR surface beneath GPUI's layer, one report line, then quit. In an hdr-fixture build only.

use deep_app::init;
use gpui_kit::*;

pub fn run(path: Option<String>) {
    let path = path.expect("usage: deep-app --hdr <scenario.json>");
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        deep_app::hdr_fixture::run(&path, cx);
    });
}
