//! #1732: an arrangement's solved places are what the 3D frame draws ("The result writes each
//! item's transform as a derived value"). A lamp standing on the floor, arranged `on` the table,
//! draws exactly as the same scene with the lamp written where the solve put it. Drives
//! `deep-show screen` as the acceptance tests do; macOS only (GPUI's Metal renderer).
#![cfg(target_os = "macos")]

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB1732S00000000000000001";

fn scene(lamp: Value, arranged: bool) -> Value {
    let item = |id: &str, order: &str, size: [f64; 3], pos: Value, role: &str| {
        json!({"id": id, "kind": "mark.box@1", "name": id, "order": order,
               "params": {"size": size, "paint": {"fill": {"role": role}}}, "at": {"pos": pos}})
    };
    let mut items = json!({
        "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                "params": {"projection": "orthographic", "target": [0, 0, 0],
                           "orbit": {"azimuth": 0, "elevation": 90, "distance": 10}, "view_width": 4}},
        "floor": item("floor", "a1", [3.0, 0.1, 2.0], json!([0, -0.05, 0]), "muted"),
        "table": item("table", "a2", [1.2, 0.75, 0.8], json!([-0.6, 0.375, 0]), "ink"),
        "lamp": item("lamp", "a3", [0.2, 0.45, 0.2], lamp, "accent"),
    });
    if arranged {
        items["arrangement"] = json!({"id": "arrangement", "kind": "arrange@1", "name": "Arrangement",
            "order": "a4", "params": {"items": ["table", "lamp"],
                "relations": [{"a": "lamp", "rel": "on", "b": "table"}]}});
    }
    json!({"format": 1, "profile": "scene", "title": "A lamp on a table",
           "description": "A lamp arranged on a table.", "size": [400, 300], "camera": "cam",
           "requires": {"modules": {"scene3d": "^1", "motion": "^1"}}, "items": items})
}

/// The window the document leaves, and the lamp's evaluated position.
fn screen(name: &str, document: Value) -> (image::RgbaImage, Value) {
    let dir =
        std::env::temp_dir().join(format!("deep-show-arranged-{name}-{}", std::process::id()));
    let out = dir.join("screen.png");
    let scenario = json!({
        "evidence": dir.join("evidence"),
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "window": [400, 300],
        "panels": {"main": {"rect": [0, 0, 400, 300]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": [
            {"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": document},
            {"call": "deep_query", "session": "sess-alpha", "doc": DOC, "paths": ["items/lamp/at/pos"], "at": ["0s"]},
        ],
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
    assert_eq!(
        answer["replies"][0]["outcome"],
        json!("presented"),
        "{answer}"
    );
    let picture = image::open(&out).expect("the window's PNG").to_rgba8();
    let _ = std::fs::remove_dir_all(&dir);
    (
        picture,
        answer["replies"][1]["values"]["items/lamp/at/pos"][0].clone(),
    )
}

#[test]
fn the_frame_draws_the_arranged_places() {
    let (arranged, solved) = screen("arranged", scene(json!([1.0, 0.225, 0]), true));
    assert!(
        solved[1].as_f64().is_some_and(|y| y > 0.9),
        "the solve lifted the lamp onto the table: {solved}"
    );
    let (written, _) = screen("written", scene(solved.clone(), false));
    let differ = arranged
        .pixels()
        .zip(written.pixels())
        .filter(|(a, b)| a != b)
        .count();
    assert_eq!(
        differ, 0,
        "the arranged scene draws as the scene with the lamp written at {solved}"
    );
}
