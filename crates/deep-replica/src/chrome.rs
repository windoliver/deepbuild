//! Issue #1434: `deep-replica --chrome <fixture> --out <dir> [--omit-effect <id>]...`, in a `chrome-fixture` build
//! only: a `chrome@1` fixture drawn headless with GPUI's offscreen Metal renderer at its window and scale, the same
//! chrome primitives the app draws, written as `screens/chrome.png` and `chrome.json` (its refusals).

use std::path::PathBuf;

use deep_app::chrome_fixture::{self, ChromeView, Fixture};
use gpui_kit::{test::TestWindowExt, AppContext as _, *};

pub fn run() -> i32 {
    let mut args = std::env::args().skip(2);
    let (mut fixture, mut out, mut omit) = (None, None, Vec::new());
    let mut path = args.next().map(PathBuf::from);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => out = args.next().map(PathBuf::from),
            "--omit-effect" => omit.extend(args.next()),
            other => {
                eprintln!("deep-replica --chrome: unknown argument {other}");
                return 2;
            }
        }
    }
    if let Some(p) = path.take() {
        match Fixture::read(&p) {
            Ok(f) => fixture = Some(f),
            Err(why) => {
                eprintln!("deep-replica --chrome: {why}");
                return 2;
            }
        }
    }
    let (Some(fixture), Some(out)) = (fixture, out) else {
        eprintln!("usage: deep-replica --chrome <fixture> --out <dir> [--omit-effect <id>]...");
        return 2;
    };
    chrome_fixture::apply_plants();
    chrome_fixture::omit(omit);
    let mut cx = crate::headless_context();
    let [w, h] = fixture.window;
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(w), px(h)),
        })),
        titlebar: None,
        focus: false,
        show: false,
        ..Default::default()
    };
    let scale = fixture.scale;
    let view = fixture.clone();
    let (handle, _) = cx
        .update(|cx| {
            gpui_kit::open_window(options, cx, move |_, cx| {
                cx.new(|_| ChromeView { fixture: view })
            })
        })
        .expect("the window opens");
    cx.simulate_scale_factor_change(handle, scale);
    cx.update_window(handle, |_, window, cx| fixture.present_card(window, cx))
        .expect("the card is presented");
    // Two frames: the first lays out and uploads the glyph pages, the second draws warm.
    for _ in 0..2 {
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
    }
    cx.run_until_parked();
    // The refusals of the frame the screenshot shows.
    deep_app::chrome_fx::take_refusals();
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .expect("the window draws");
    let refusals = chrome_fixture::refusals_json();
    let image = cx
        .capture_screenshot(handle)
        .expect("offscreen rendering is available");
    std::fs::create_dir_all(out.join("screens")).expect("the output directory");
    image
        .save(out.join("screens").join("chrome.png"))
        .expect("the screenshot is written");
    let report = serde_json::json!({"chrome": 1434, "refusals": refusals, "scale": scale});
    std::fs::write(out.join("chrome.json"), report.to_string()).expect("chrome.json is written");
    println!("{report}");
    0
}
