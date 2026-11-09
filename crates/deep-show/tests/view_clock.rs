//! #1487 in a panel: the frames a flat view presents count only the items whose bounds meet the
//! view, so a spinner outside the camera's view stops the clock, and a drag that brings it in
//! starts it again. Each drives `deep-show run` with `input` and `presented` calls as #383's
//! acceptance tests do.
use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB1487D00000000000000001";
const S: i64 = 705_600_000;
const MS: i64 = S / 1000;
const VSYNC: i64 = S / 120;

/// The camera shows [0, 0, 800, 450]; the spinner turns at x = 1200, out of that view.
fn board() -> Value {
    json!({
        "format": 1, "profile": "board", "title": "Spinner", "description": "One spinner off to the side.",
        "size": [2400, 450], "camera": "cam",
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                "params": {"projection": "orthographic", "target": [400, 225, 0], "view_width": 800,
                           "user": {"zoom": [0.25, 8], "pan": {"bounds": "none"}}}},
            "card": {"id": "card", "kind": "rect@1", "name": "Card", "order": "a1",
                "params": {"box": [0, 0, 100, 50], "paint": {"fill": {"role": "muted"}}}, "at": {"pos": [40, 40, 0]}},
            "spinner": {"id": "spinner", "kind": "rect@1", "name": "Spinner", "order": "a2",
                "params": {"box": [-50, -50, 100, 100], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [1200, 225, 0]}}
        },
        "channels": {
            "spin": {"target": "items/spinner/at/rot/2", "type": "f32", "extrapolate": "cycle",
                     "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"},
                              "k1": {"t": "2s", "value": 360, "interp": "linear"}}}
        }
    })
}

/// The vsyncs of the frames the panel presented by 1 s, after `calls`.
fn presented(calls: Vec<Value>) -> Vec<i64> {
    let evidence =
        std::env::temp_dir().join(format!("deep-show-view-clock-{}", std::process::id()));
    let mut all = vec![
        json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": board(), "at": 1}),
    ];
    all.extend(calls);
    all.push(json!({"call": "presented", "at": S, "panel": "main"}));
    let scenario = json!({
        "evidence": evidence,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "clock": {"refresh_hz": 120, "lead": 2 * MS, "check": MS / 2},
        "display": [1600, 900],
        "panels": {"main": {"rect": [0, 0, 800, 450]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": all,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(&evidence);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    let replies = answer["replies"].as_array().expect("replies");
    assert_eq!(replies[0]["outcome"], json!("presented"), "{}", replies[0]);
    let frames = replies.last().expect("a reply")["frames"]
        .as_array()
        .expect("frames");
    frames
        .iter()
        .map(|f| f["vsync"].as_i64().expect("a vsync"))
        .collect()
}

fn input(at: i64, kind: &str, x: f64) -> Value {
    json!({"call": "input", "at": at, "panel": "main", "event": {"type": kind, "pos": [x, 225.0]}})
}

#[test]
fn a_spinner_out_of_the_camera_s_view_presents_no_frame_after_the_first() {
    let shown = presented(Vec::new());
    assert_eq!(
        shown.len(),
        1,
        "one frame, then nothing while the spinner turns out of view: {shown:?}"
    );
}

#[test]
fn a_drag_that_brings_the_spinner_into_view_presents_a_frame_at_every_vsync_after_it() {
    // A 700 px drag to the left pans the view to [700, 1500], over the spinner, by 0.52 s.
    let t = S / 2;
    let shown = presented(vec![
        input(t, "down", 750.0),
        input(t + 5 * MS, "move", 400.0),
        input(t + 10 * MS, "move", 50.0),
        input(t + 20 * MS, "up", 50.0),
    ]);
    let before: Vec<i64> = shown.iter().copied().filter(|v| *v < t).collect();
    assert_eq!(
        before.len(),
        1,
        "nothing before the drag but the first frame: {before:?}"
    );
    let from = (t + 40 * MS) / VSYNC * VSYNC + VSYNC;
    let after = shown.iter().filter(|v| **v >= from).count() as i64;
    assert_eq!(
        after,
        (S - from) / VSYNC + 1,
        "a frame at every vsync once it turns in view: {shown:?}"
    );
}
