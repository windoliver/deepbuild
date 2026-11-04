//! The full-screen button in the drawn window (#383: "Every canvas has a full-screen button"):
//! `deep-show screen` draws the button the scope reports at the panel's top right, and after a
//! click on it the canvas fills the display the scope says it fills. Drives `deep-show screen` as
//! the acceptance tests do; macOS only, since the window draws through GPUI's Metal renderer.
#![cfg(target_os = "macos")]

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB383F000000000000000001";

/// The window `calls` leave, drawn on a 1600 × 900 display with the document in an 800 × 450
/// panel: the RGBA pixels and the last reply.
fn screen(name: &str, calls: Vec<Value>) -> (image::RgbaImage, Value) {
    let dir = std::env::temp_dir().join(format!(
        "deep-show-full-screen-{name}-{}",
        std::process::id()
    ));
    let out = dir.join("screen.png");
    let document = json!({"format": 1, "profile": "board", "title": "Full screen",
        "description": "One rect filling the page.", "size": [800, 450],
        "items": {"page": {"id": "page", "kind": "rect@1", "name": "Page", "order": "a0",
            "params": {"box": [0, 0, 800, 450], "paint": {"fill": {"role": "accent"}}}}}});
    let mut all = vec![
        json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": document, "at": 1}),
    ];
    all.extend(calls);
    all.push(json!({"call": "scope", "at": 3_000_000_000_i64, "panel": "main"}));
    let scenario = json!({
        "evidence": dir.join("evidence"),
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "clock": {"refresh_hz": 120, "lead": 1_411_200, "check": 352_800},
        "display": [1600, 900],
        "window": [1600, 900],
        "panels": {"main": {"rect": [0, 0, 800, 450]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": all,
        "out": out,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("screen")
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let answer = child.wait_with_output().expect("deep-show exits");
    let answer: Value = serde_json::from_slice(&answer.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    let picture = image::open(&out).expect("the window's PNG").to_rgba8();
    let _ = std::fs::remove_dir_all(&dir);
    let last = answer["replies"]
        .as_array()
        .and_then(|r| r.last())
        .cloned()
        .expect("replies");
    (picture, last)
}

/// The button's rect the scope reports, in window px.
fn button(reply: &Value) -> [u32; 4] {
    let r = &reply["state"]["buttons"][0];
    assert_eq!(r["verb"], json!("canvas.full_screen"), "{reply}");
    let n = |i: usize| r["rect"][i].as_f64().expect("a number") as u32;
    [n(0), n(1), n(2), n(3)]
}

/// How many of the rect's pixels differ from the canvas's own fill around it.
fn marked(picture: &image::RgbaImage, b: [u32; 4]) -> usize {
    let fill = picture.get_pixel(b[0] - 16, b[1] + b[3] + 16);
    (b[1]..b[1] + b[3])
        .flat_map(|y| (b[0]..b[0] + b[2]).map(move |x| (x, y)))
        .filter(|&(x, y)| picture.get_pixel(x, y) != fill)
        .count()
}

#[test]
fn the_full_screen_button_is_drawn_and_full_screen_fills_the_window() {
    let (panel, reply) = screen("panel", vec![]);
    let b = button(&reply);
    assert_eq!(
        b,
        [760, 8, 32, 32],
        "the button sits at the panel's top right"
    );
    assert!(
        marked(&panel, b) > 0,
        "the button is drawn over the canvas at {b:?}"
    );

    let click = |kind: &str, at: i64| {
        json!({"call": "input", "at": at, "panel": "main",
        "event": {"type": kind, "pos": [776, 24]}})
    };
    let (full, reply) = screen(
        "full",
        vec![click("down", 2_000_000_000), click("up", 2_050_000_000)],
    );
    assert_eq!(reply["state"]["full_screen"], json!(true), "{reply}");
    assert_eq!(
        reply["state"]["rect"],
        json!([0.0, 0.0, 1600.0, 900.0]),
        "{reply}"
    );
    let page = *panel.get_pixel(400, 225);
    assert_eq!(
        *full.get_pixel(1200, 700),
        page,
        "the canvas fills the display in full screen"
    );
    let b = button(&reply);
    assert!(
        marked(&full, b) > 0,
        "the button is drawn at the display's top right, {b:?}"
    );
}
