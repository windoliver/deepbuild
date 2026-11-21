//! Issue #1561: `frames` draws a 2D document under a drawn look through the look's page, and a
//! paper's tooth read from an image is read from the evidence store by its hash, as the look
//! itself is. Drives `deep-show run` as the acceptance tests do; the frame draws on the GPU.
#![cfg(target_os = "macos")]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DOC: &str = "01JB1561D00000000000000003";

/// `bytes` kept in the evidence store at `root`; their SHA-256.
fn put(root: &Path, bytes: &[u8]) -> String {
    let sha: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let dir = root.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("the store's folder");
    std::fs::write(dir.join(&sha[2..]), bytes).expect("the file is kept");
    sha
}

/// The first frame's `pixel_hash` of a 160 × 90 figure, a bank over a pond, under the shipped
/// `clean` look on a paper ground with `tooth`.
fn frame(evidence: &Path, tooth: Value) -> Value {
    let mut look = deep_canvas_marks::look::shipped("clean").expect("the clean look");
    look["id"] = json!("toothed");
    look["ground"] =
        json!({"kind": "paper", "params": {"role": "ground", "seed": "document", "tooth": tooth}});
    let look = put(evidence, look.to_string().as_bytes());
    let license = json!({"id": "Apache-2.0", "terms": "Apache License, version 2.0.", "shareable": true,
                         "credit": "Made by deep-show's tests."});
    let document = json!({
        "format": 1, "profile": "figure", "title": "A bank over a pond",
        "description": "A #1561 fixture: a line and a fill on a toothed paper.",
        "size": [160, 90], "seed": 7, "transport": {"span": "1s"},
        "look": {"asset": "toothed@1", "theme": "light"},
        "assets": {"toothed": {"sha256": look, "license": license}},
        "items": {
            "pond": {"id": "pond", "kind": "rect@1", "name": "pond", "order": "b0",
                "params": {"box": [20, 50, 120, 30], "paint": {"fill": {"role": "accent"}}}},
            "bank": {"id": "bank", "kind": "path@1", "name": "bank", "order": "b1",
                "params": {"d": "M 10 44 C 50 34 110 52 150 40", "paint": {"stroke": {"role": "ink"}}}},
        },
    });
    let scenario = json!({
        "evidence": evidence, "sessions": {},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 3000, "ppid": 1, "start": 100},
                      {"pid": 3001, "ppid": 3000, "start": 110}, {"pid": 3002, "ppid": 3001, "start": 3000}],
        "panels": {"main": {"rect": [0, 0, 160, 90]}}, "docs": {DOC: {"panel": "main"}},
        "calls": [{"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": DOC, "document": document},
                  {"call": "frames", "doc": DOC, "count": 1, "step": "15f", "pixels": true}],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("the scenario is written");
    let out = child.wait_with_output().expect("deep-show exits");
    let text = String::from_utf8_lossy(&out.stdout);
    let answer: Value = serde_json::from_str(text.lines().last().expect("an answer"))
        .unwrap_or_else(|e| panic!("the answer is JSON ({e}): {text}"));
    let replies = &answer["replies"];
    assert_eq!(
        replies[0]["outcome"], "presented",
        "the document is presented: {answer}"
    );
    replies[1]["frames"][0]["pixel_hash"].clone()
}

#[test]
fn a_paper_tooth_read_from_an_image_draws_in_a_frame() {
    let evidence = std::env::temp_dir().join(format!("deep-1561-frames-{}", std::process::id()));
    std::fs::create_dir_all(&evidence).expect("the evidence store");
    // A gray checkerboard of 8 px squares, as the look's tooth.
    let board = image::GrayImage::from_fn(64, 64, |x, y| {
        image::Luma([if (x / 8 + y / 8) % 2 == 0 { 40 } else { 230 }])
    });
    let mut png = std::io::Cursor::new(Vec::new());
    board
        .write_to(&mut png, image::ImageFormat::Png)
        .expect("the tooth's image is encoded");
    let sha = put(&evidence, png.get_ref());
    let from_image =
        json!({"kind": "cold_press", "from": sha, "scale": 4, "depth": 0.8, "seed": 3});
    let built_in = json!({"kind": "cold_press", "scale": 4, "depth": 0.8, "seed": 3});
    let toothed = frame(&evidence, from_image);
    let plain = frame(&evidence, built_in);
    let _ = std::fs::remove_dir_all(&evidence);
    assert!(
        plain.is_string(),
        "a frame on the built-in tooth is kept: {plain}"
    );
    assert!(
        toothed.is_string(),
        "a frame on the image's tooth is kept: {toothed}"
    );
    assert_ne!(toothed, plain, "the image is in the frame");
}
