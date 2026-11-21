//! The app's window in gpui-kit's test window (README: The window), as the app opens it: `views::Shell` on
//! `Layout::app(false)` (the list, and the pages Home, a session's page and Agents, each built when the window opens),
//! with the window's reader, `record::RecordReader::open_folded`, on the stand-in hub. Pages are shown the way the app
//! shows them, by address (`open::arrive`), and time passes on GPUI's virtual clock, a frame drawn each step, as a
//! window draws.
#![allow(dead_code)]

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use deep_app::record::{self, RecordReader};
use deep_app::views::{Layout, Shell};
use gpui_kit::base::test_support::snapshots;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    point, px, size, AnyWindowHandle, AppContext as _, Bounds, TestAppContext, WindowBounds, WindowOptions,
};

use crate::hub::StandIn;

/// The views' clock, fixed: no age moves while the test runs.
pub const NOW: u64 = 1_800_000_000_000;

/// One window's hub at a time: the test's home names it as the hub's address.
static HOME_HUB: Mutex<()> = Mutex::new(());

/// Opens the app's window on the stand-in hub's record. The test's home names the stand-in as the hub's address
/// (`hub.address` in config.json, and its control token), so a call the app makes on a connection of its own reaches it
/// too; the guard keeps it so until the test ends.
pub fn open(cx: &mut TestAppContext, hub: &StandIn) -> (AnyWindowHandle, MutexGuard<'static, ()>) {
    crate::quiet_home();
    let guard = HOME_HUB.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = deep_app::hub::root();
    std::fs::create_dir_all(&root).expect("the test home's .deepbuild");
    let config = serde_json::json!({ "hub": { "address": format!("unix:{}", hub.socket.display()) } });
    std::fs::write(root.join("config.json"), config.to_string()).expect("the test home's config");
    std::fs::copy(&hub.token_file, root.join("control.token")).expect("the test home's control token");
    let reader = RecordReader::open_folded(&deep_app::hub::address(), &root.join("control.token"))
        .unwrap_or_else(|error| panic!("BLOCKED: the window's reader can't open on the stand-in hub: {error:?}"));
    record::install(reader);
    // A machine that's set up, so the window opens on its pages, not the first-launch page; the clock held still.
    deep_app::setup::assume_finished();
    deep_app::views::set_clock(NOW);
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    let (window, _) = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: point(px(0.), px(0.)),
                    size: size(px(1512.), px(982.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Shell::new(&Layout::app(false), window, cx)),
        )
        .expect("the app's window opens")
    });
    frame(cx, window);
    (window, guard)
}

/// The window draws a frame, once what is runnable has run.
pub fn frame(cx: &mut TestAppContext, window: AnyWindowHandle) {
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| window.render_frame(cx))
        .expect("the window draws");
    cx.run_until_parked();
}

/// Shows the page at `address`, as the app does for a link, `deep open` or a click in the list, and draws.
pub fn show(cx: &mut TestAppContext, window: AnyWindowHandle, address: &str) {
    cx.update(|cx| deep_app::open::arrive(address, cx))
        .unwrap_or_else(|said| panic!("the window can't show {address}: {said}"));
    frame(cx, window);
}

/// Lets `total` pass on the virtual clock in steps of `step`, a frame drawn after each.
pub fn pass(cx: &mut TestAppContext, window: AnyWindowHandle, total: Duration, step: Duration) {
    let mut passed = Duration::ZERO;
    while passed < total {
        let step = step.min(total - passed);
        cx.executor().advance_clock(step);
        frame(cx, window);
        passed += step;
    }
}

/// The accessibility labels the window drew, top to bottom, of the elements whose ID is `id`.
pub fn labels(cx: &mut TestAppContext, window: AnyWindowHandle, id: &gpui_kit::ElementId) -> Vec<String> {
    cx.update_window(window, |_, window, _| {
        snapshots(window)
            .into_iter()
            .filter(|element| element.visible() && element.path().last() == Some(id))
            .filter_map(|element| element.label().map(str::to_owned))
            .collect()
    })
    .expect("the window draws")
}

/// Every accessibility label the window drew.
pub fn every_label(cx: &mut TestAppContext, window: AnyWindowHandle) -> Vec<String> {
    cx.update_window(window, |_, window, _| {
        snapshots(window)
            .into_iter()
            .filter(|element| element.visible())
            .filter_map(|element| element.label().map(str::to_owned))
            .collect()
    })
    .expect("the window draws")
}
