//! Render-back of a 3D scene draws each item where its world's output puts it at the frame's time,
//! as `deep_show` draws it (#2293's outputs, read back at a time): a ball kicked across a floor,
//! its pose an output to the scene's ball, is drawn at 0.5 s three metres on, not at its kick spot.
use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB0522F0000000000000000B";

fn scene() -> Value {
    let world = json!({
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4, "gravity": [0, -9.81, 0],
        "mode": "dynamic", "capacity": {"bodies": 2, "shapes": 2, "joints": 0, "contacts": 16, "particles": 0},
        "contact_materials": {"ground": {"friction": 0.6, "restitution": 0, "density": 1000},
                              "leather": {"friction": 0.5, "restitution": 0.4, "density": 80}},
        "shapes": {"floor": {"kind": "box", "half": [30, 0.1, 30]}, "ball": {"kind": "sphere", "radius": 0.11}},
        "bodies": {
            "floor": {"kind": "static", "shapes": [{"shape": "floor", "contact_material": "ground"}], "pose": {"pos": [0, -0.1, 0]}},
            "ball": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "leather"}], "pose": {"pos": [0, 0.11, 0]},
                     "mass": 0.43, "velocity": {"linear": [6, 3, 0.4]}}},
        "outputs": {"ball": {"from": "ball", "read": "pose", "to": "items/ball/at"}}});
    let item = |id: &str, order: &str, kind: &str, params: Value, at: Value| json!({"id": id, "name": id, "order": order, "kind": kind, "params": params, "at": at});
    json!({"format": 1, "profile": "scene", "title": "Kicked", "description": "A ball kicked across a floor.",
           "size": [320, 180], "camera": "cam", "transport": {"span": "1s", "frame_rate": [60, 1]},
           "requires": {"modules": {"scene3d": "^1"}}, "worlds": {"lab": world},
           "items": {
               "cam": {"id": "cam", "name": "cam", "order": "a0", "kind": "camera@1",
                       "params": {"projection": "perspective", "position": [4, 3, 14], "target": [4, 0.5, 0], "fov": 40}},
               "ground": item("ground", "a1", "mark.box@1", json!({"size": [18, 0.2, 7], "paint": {"fill": {"role": "muted"}}}), json!({"pos": [4, -0.1, 0]})),
               "ball": item("ball", "a2", "mark.sphere@1", json!({"size": [0.6, 0.6, 0.6], "paint": {"fill": {"role": "ink"}}}), json!({"pos": [0, 0.11, 0]}))}})
}

#[test]
fn render_back_draws_a_body_where_its_world_puts_it() {
    let root = std::env::temp_dir().join(format!(
        "deep-show-render-back-world-{}",
        std::process::id()
    ));
    let half = 705_600_000 / 2;
    let back = |t: i64| json!({"call": "render_back", "session": "sess-alpha", "doc": DOC, "t": t, "rev": 1, "size": [320, 180]});
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "panels": {"main": {"rect": [0, 0, 800, 600]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": [
            {"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": scene(), "include": ["issues"]},
            back(0),
            back(half),
            // The same document again, drawn at 0.5 s: deep_show's own 3D frame, outputs applied.
            {"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": scene(), "t": "0.5s",
             "size": [320, 180], "include": ["pixels"]},
        ],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(&root);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    let replies = &answer["replies"];
    assert_eq!(
        replies[0]["outcome"], "presented",
        "the scene is presented: {}",
        replies[0]
    );
    let sha = |i: usize| {
        replies[i]["snapshots"][0]["sha256"]
            .as_str()
            .unwrap_or_else(|| panic!("reply {i} draws a frame: {}", replies[i]))
            .to_string()
    };
    let (start, moved, shown) = (sha(1), sha(2), sha(3));
    assert_ne!(start, moved, "at 0.5 s the ball has moved three metres from its kick spot, so the frame differs from 0 s");
    assert_eq!(moved, shown, "render-back at 0.5 s draws the frame deep_show draws at 0.5 s, the ball where its world puts it");
}
