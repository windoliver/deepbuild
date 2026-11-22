//! A 3D document's readouts draw in its export as the view draws them (#419; #508): an
//! `overlay.text@1` readout sits in the frame's top-left corner, over the frame, so the still a
//! PNG export writes holds its ink there, and the same document without it doesn't.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB508R0000000000000000001";

fn document(readout: bool) -> Value {
    let mut items = json!({
        "cam": {"id": "cam", "name": "cam", "order": "a0", "kind": "camera@1",
                "params": {"projection": "perspective", "position": [0, 0, 6], "target": [0, 0, 0], "fov": 40}},
        "block": {"id": "block", "name": "block", "order": "a1", "kind": "mark.box@1",
                  "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}}});
    if readout {
        items["spread"] = json!({"id": "spread", "name": "Spread readout", "order": "a2", "kind": "overlay.text@1",
                                 "params": {"template": "Spread 0.5", "size": 15}});
    }
    json!({"format": 1, "profile": "scene", "title": "Readout", "description": "A block and a readout.",
           "size": [320, 180], "camera": "cam", "transport": {"span": "1s", "frame_rate": [30, 1]},
           "requires": {"modules": {"scene3d": "^1"}}, "items": items})
}

/// The still `document` exports to a PNG sequence: its size and straight RGBA.
fn exported(root: &Path, document: Value) -> (u32, u32, Vec<u8>) {
    let out = root.join("still");
    let scenario = json!({
        "evidence": root.join("evidence"),
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "panels": {"main": {"rect": [0, 0, 320, 180]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": [
            {"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": document, "include": ["issues"]},
            {"call": "export", "doc": DOC, "out": out, "range": {"still": {"t": "0s"}}, "video": {"codec": "png_seq"}},
        ],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let answer: Value =
        serde_json::from_slice(&child.wait_with_output().expect("deep-show exits").stdout)
            .expect("one JSON line");
    let replies = &answer["replies"];
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    assert_eq!(replies[1]["outcome"], "exported", "{}", replies[1]);
    let png: PathBuf = walk(&out)
        .into_iter()
        .find(|p| p.extension().is_some_and(|e| e == "png"))
        .unwrap_or_else(|| panic!("the export wrote a PNG: {}", replies[1]));
    let image = image::open(&png).expect("a PNG").to_rgba8();
    (image.width(), image.height(), image.into_raw())
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            found.extend(walk(&p));
        } else {
            found.push(p);
        }
    }
    found
}

/// The px of the readout's corner, x 12..112 and y 12..28, whose colour stands off the ground (the
/// frame's bottom-left px) by more than 48 in a channel.
fn inked(w: u32, h: u32, rgba: &[u8]) -> usize {
    assert_eq!((w, h), (320, 180));
    let px = |x: u32, y: u32| &rgba[((y * w + x) * 4) as usize..][..3];
    let ground = px(0, h - 1).to_vec();
    (12..28)
        .flat_map(|y| (12..112).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            px(x, y)
                .iter()
                .zip(&ground)
                .any(|(a, b)| a.abs_diff(*b) > 48)
        })
        .count()
}

#[test]
fn an_exported_3d_still_draws_its_readout_in_the_top_left_corner() {
    let root = std::env::temp_dir().join(format!("deep-show-readouts-{}", std::process::id()));
    let (w, h, with) = exported(&root.join("with"), document(true));
    let (_, _, without) = exported(&root.join("without"), document(false));
    let _ = std::fs::remove_dir_all(&root);
    let (ink, bare) = (inked(w, h, &with), inked(w, h, &without));
    assert_eq!(bare, 0, "without the readout the corner is the ground");
    assert!(
        ink >= 20,
        "the readout's text inks the top-left corner of the exported still: {ink} px stand off the ground"
    );
}
