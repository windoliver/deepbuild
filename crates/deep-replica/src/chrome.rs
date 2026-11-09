//! Issue #1434: `deep-replica --chrome <fixture> --out <dir> [--omit-effect <id>]...`, in a `chrome-fixture` build
//! only: a `chrome@1` fixture drawn headless with GPUI's offscreen Metal renderer at its window and scale, the same
//! chrome primitives the app draws, written as `screens/chrome.png` and `chrome.json` (its refusals).
//!
//! Issue #1436 (tests/acceptance/1436/README.md) adds `--appearance <light|dark>`, `--reduce-motion`, `--at <s>`...
//! (each a frame of the effect clock, `screens/chrome-<i>.png`) and `--omit-text <id>`...; `chrome.json` gains each
//! bound param as the last frame showed it and its particles. Two more modes: `--chrome-fx-check <pack dir> --out
//! <dir>`, the pack check (`check.json`, exit 0 when the pack passes, 1 when it's refused), and `--chrome-fx-gallery
//! --appearance <light|dark> --out <dir>`, the gallery panel (`screens/gallery.png`, `gallery.json`).

use std::path::{Path, PathBuf};

use deep_app::chrome_fixture::{self, ChromeView, Fixture};
use gpui_kit::{test::TestWindowExt, AppContext as _, *};
use serde_json::{json, Value};

pub fn run() -> i32 {
    let mut args = std::env::args().skip(2);
    let (mut out, mut omit, mut omit_text, mut times) = (None, Vec::new(), Vec::new(), Vec::new());
    let (mut dark, mut reduce_motion) = (false, false);
    let path = args.next().map(PathBuf::from);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => out = args.next().map(PathBuf::from),
            "--omit-effect" => omit.extend(args.next()),
            "--omit-text" => omit_text.extend(args.next()),
            "--appearance" => dark = args.next().as_deref() == Some("dark"),
            "--reduce-motion" => reduce_motion = true,
            "--at" => match args.next().and_then(|t| t.parse::<f64>().ok()) {
                Some(t) => times.push(t),
                None => {
                    eprintln!("deep-replica --chrome: --at takes seconds");
                    return 2;
                }
            },
            other => {
                eprintln!("deep-replica --chrome: unknown argument {other}");
                return 2;
            }
        }
    }
    let (Some(path), Some(out)) = (path, out) else {
        eprintln!("usage: deep-replica --chrome <fixture> --out <dir> [--appearance <light|dark>] [--reduce-motion] [--at <s>]... [--omit-effect <id>]... [--omit-text <id>]...");
        return 2;
    };
    let fixture = match Fixture::read(&path) {
        Ok(f) => f,
        Err(why) => {
            eprintln!("deep-replica --chrome: {why}");
            return 2;
        }
    };
    deep_app::chrome::force_dark(Some(dark));
    chrome_fixture::apply_plants();
    chrome_fixture::omit(omit);
    chrome_fixture::omit_text(omit_text);
    let mut cx = crate::headless_context();
    cx.update(|cx| cx.set_reduce_motion(reduce_motion));
    let [w, h] = fixture.window;
    let scale = fixture.scale;
    let view = fixture.clone();
    let handle = open(&mut cx, [w, h], scale, move |cx| {
        cx.new(|_| ChromeView { fixture: view })
    });
    cx.update_window(handle, |_, window, cx| fixture.present_card(window, cx))
        .expect("the card is presented");
    std::fs::create_dir_all(out.join("screens")).expect("the output directory");
    let frames: Vec<(f64, String)> = if times.is_empty() {
        vec![(0.0, "chrome.png".into())]
    } else {
        times
            .iter()
            .enumerate()
            .map(|(i, t)| (*t, format!("chrome-{i}.png")))
            .collect()
    };
    let mut refusals = Value::Array(Vec::new());
    for (t, name) in frames {
        deep_app::chrome_fx::set_clock(t);
        let image = draw(&mut cx, handle);
        refusals = chrome_fixture::refusals_json();
        image
            .save(out.join("screens").join(name))
            .expect("the screenshot is written");
    }
    let report = json!({
        "chrome": 1436, "refusals": refusals, "scale": scale,
        "bound": deep_app::chrome_fx::bound(), "particles": deep_app::chrome_fx::particles(),
    });
    std::fs::write(out.join("chrome.json"), report.to_string()).expect("chrome.json is written");
    0
}

/// Opens a headless window of `size` points at `scale` with the view `make` builds.
fn open<V: Render + 'static>(
    cx: &mut HeadlessAppContext,
    [w, h]: [f32; 2],
    scale: f32,
    make: impl FnOnce(&mut App) -> Entity<V> + 'static,
) -> AnyWindowHandle {
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
    let (handle, _) = cx
        .update(|cx| gpui_kit::open_window(options, cx, move |_, cx| make(cx)))
        .expect("the window opens");
    cx.simulate_scale_factor_change(handle, scale);
    handle
}

/// Draws the window warm and reads it back: the first frame lays out and uploads the glyph pages,
/// the second draws warm, and the refusals are the shown frame's.
fn draw(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> image::RgbaImage {
    for _ in 0..2 {
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
    }
    cx.run_until_parked();
    deep_app::chrome_fx::take_refusals();
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .expect("the window draws");
    cx.capture_screenshot(handle)
        .expect("offscreen rendering is available")
}

/// `--chrome-fx-check <pack dir> --out <dir>`: the pack check on that folder's `pack.json`, under the plant
/// `DEEP_CHROME_PLANT` names (`twin:<operator>`, `flashes_4hz`).
pub fn check() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    let (Some(dir), Some(out)) = (
        args.first(),
        args.iter()
            .position(|a| a == "--out")
            .and_then(|i| args.get(i + 1)),
    ) else {
        eprintln!("usage: deep-replica --chrome-fx-check <pack dir> --out <dir>");
        return 2;
    };
    let pack = match std::fs::read_to_string(Path::new(dir).join("pack.json"))
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()))
    {
        Ok(pack) => pack,
        Err(why) => {
            eprintln!("deep-replica --chrome-fx-check: {dir}/pack.json: {why}");
            return 2;
        }
    };
    let report = chrome_fixture::check_pack(pack);
    std::fs::create_dir_all(out).expect("the output directory");
    std::fs::write(Path::new(out).join("check.json"), format!("{report:#}"))
        .expect("check.json is written");
    i32::from(report["pass"] != true)
}

/// `--chrome-fx-gallery --appearance <light|dark> --out <dir>`: the gallery panel drawn headless.
pub fn gallery() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    let after = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let (Some(out), appearance) = (
        after("--out"),
        after("--appearance").unwrap_or_else(|| "light".into()),
    ) else {
        eprintln!("usage: deep-replica --chrome-fx-gallery --appearance <light|dark> --out <dir>");
        return 2;
    };
    deep_app::chrome::force_dark(Some(appearance == "dark"));
    let mut cx = crate::headless_context();
    let layout = deep_app::chrome_gallery::Gallery::layout();
    let scale = deep_app::chrome_gallery::SCALE;
    let handle = open(&mut cx, layout.window, scale, |cx| {
        cx.new(|_| deep_app::chrome_gallery::Gallery)
    });
    let image = draw(&mut cx, handle);
    let out = PathBuf::from(out);
    std::fs::create_dir_all(out.join("screens")).expect("the output directory");
    image
        .save(out.join("screens").join("gallery.png"))
        .expect("the gallery is written");
    let operators: Vec<Value> = layout
        .tiles
        .iter()
        .map(|t| {
            let [x, y, w, h] = t.rect.map(|v| (v * scale).round() as i64);
            json!({"operator": t.operator, "class": t.class, "cost_ms": t.cost_ms, "still": true, "rect": [x, y, w, h]})
        })
        .collect();
    let report = json!({"appearance": appearance, "operators": operators, "refusals": chrome_fixture::refusals_json()});
    std::fs::write(out.join("gallery.json"), format!("{report:#}"))
        .expect("gallery.json is written");
    0
}
