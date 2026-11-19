//! Issue #1561: the live window hands a 2D document the look's drawn fields and its page as
//! `film2d` does, in the two places the acceptance fixture doesn't reach. A size written against
//! the frame (`fw`, `fh`) converts at the document's size, and a paper's tooth read from an image
//! is read from the call's assets. Each drives `deep-gpu run` on the GPU, as the acceptance tests
//! do, and compares the live window's frame with `film2d`'s by pixel hash.
#![cfg(target_os = "macos")]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// A 160 × 90 figure: a bank drawn in the look's line `nib`, over a pond.
fn doc() -> Value {
    json!({
        "format": 1, "id": "drawn-live", "profile": "figure", "title": "A bank over a pond",
        "description": "A #1561 fixture: a line and a fill under a drawn look.",
        "size": [160, 90], "seed": 7, "transport": {"span": "1s"},
        "requires": {"modules": {"effects": "^1"}}, "budget": {"class": "figure"},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a1"}},
        "items": {
            "pond": {"id": "pond", "kind": "rect@1", "layer": "main", "name": "pond", "order": "b0",
                "params": {"box": [20, 50, 120, 30], "paint": {"fill": {"role": "accent"}}}},
            "bank": {"id": "bank", "kind": "path@1", "layer": "main", "name": "bank", "order": "b1",
                "params": {"d": "M 10 44 C 50 34 110 52 150 40",
                           "paint": {"stroke": {"line": "nib", "role": "ink"}}}},
        },
    })
}

/// The document as a writer sends it: no `id`, no `layers`, no item's `layer`.
fn payload() -> Value {
    let mut doc = doc();
    let map = doc.as_object_mut().expect("a document");
    map.remove("id");
    map.remove("layers");
    for item in map["items"].as_object_mut().expect("items").values_mut() {
        item.as_object_mut().expect("an item").remove("layer");
    }
    doc
}

/// The shipped `clean` look with a line `nib` of `width` and, with `ground`, that ground.
fn look(width: Value, ground: Option<Value>) -> Value {
    let mut look = deep_canvas_marks::look::shipped("clean").expect("the clean look");
    look["lines"]["nib"] = json!({"kind": "exact", "width": width});
    if let Some(ground) = ground {
        look["ground"] = ground;
    }
    look
}

/// A fresh folder for one test's files.
fn folder(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("deep-1561-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("the test's folder");
    dir
}

/// One scenario of `calls` in a fresh `deep-gpu run`; its replies.
fn run(dir: &Path, calls: Value) -> Vec<Value> {
    let line = json!({"out": dir, "calls": calls}).to_string();
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-gpu"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-gpu runs");
    writeln!(child.stdin.take().expect("stdin"), "{line}").expect("the scenario is written");
    let out = child.wait_with_output().expect("deep-gpu exits");
    let text = String::from_utf8_lossy(&out.stdout);
    let answer: Value = serde_json::from_str(text.lines().last().expect("an answer"))
        .unwrap_or_else(|e| panic!("the answer is JSON ({e}): {text}"));
    assert_eq!(
        answer["ok"], true,
        "deep-gpu accepted the scenario: {answer}"
    );
    answer["replies"].as_array().expect("replies").clone()
}

/// `film2d`'s first frame of the document under `look`: its pixel hash.
fn film2d(dir: &Path, look: &Value, assets: &Value) -> String {
    let call = json!({"call": "film2d", "doc": doc(), "look": look, "fps": 4, "frames": 1,
                      "hash": true, "assets": assets});
    let reply = &run(dir, json!([call]))[0];
    let hash = reply["frames"][0]["pixel_hash"].as_str();
    hash.unwrap_or_else(|| panic!("film2d drew a frame: {reply}"))
        .to_string()
}

/// The live window's first frame of the document under `look`: its pixel hash, the session's
/// document admitted.
fn live(dir: &Path, look: &Value, assets: &Value) -> String {
    let path = dir.join("payload.json");
    std::fs::write(&path, payload().to_string()).expect("the payload is written");
    let call = json!({"call": "live", "look": look, "fps": 4, "frames": 1, "report": ["hashes"],
                      "assets": assets,
                      "sessions": [{"session": "view", "writer": "agent:a", "doc": path}]});
    let reply = &run(dir, json!([call]))[0];
    let session = &reply["sessions"][0];
    assert_ne!(
        session["state"], "refused",
        "the live window admitted the document: {session}"
    );
    let hash = reply["frames"][0]["views"][0]["pixel_hash"].as_str();
    hash.unwrap_or_else(|| panic!("the live window drew a frame: {reply}"))
        .to_string()
}

#[test]
fn a_size_written_against_the_frame_converts_at_the_documents_size_in_the_live_window() {
    let dir = folder("frame-size");
    let none = json!({});
    // 1/80 of a 160 u frame is 2 u; of the 1920 u a look read alone assumes, 24 u.
    let relative = look(json!("1/80fw"), None);
    let wanted = film2d(&dir, &relative, &none);
    assert_eq!(
        wanted,
        film2d(&dir, &look(json!(2), None), &none),
        "film2d draws 1/80fw as 2 u"
    );
    assert_ne!(
        wanted,
        film2d(&dir, &look(json!(24), None), &none),
        "a 24 u line is another picture"
    );
    let got = live(&dir, &relative, &none);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(got, wanted, "the live window's frame is film2d's");
}

#[test]
fn a_paper_tooth_read_from_an_image_draws_in_the_live_window_as_film2d_draws_it() {
    let dir = folder("tooth-image");
    // A gray checkerboard of 8 px squares, as the look's tooth.
    let board = image::GrayImage::from_fn(64, 64, |x, y| {
        image::Luma([if (x / 8 + y / 8) % 2 == 0 { 40 } else { 230 }])
    });
    let file = dir.join("tooth.png");
    board.save(&file).expect("the tooth's image is written");
    let sha: String = Sha256::digest(std::fs::read(&file).expect("the image"))
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let paper = |tooth: Value| json!({"kind": "paper", "params": {"role": "ground", "seed": "document", "tooth": tooth}});
    let from_image =
        json!({"kind": "cold_press", "from": sha, "scale": 4, "depth": 0.8, "seed": 3});
    let built_in = json!({"kind": "cold_press", "scale": 4, "depth": 0.8, "seed": 3});
    let toothed = look(json!(2), Some(paper(from_image)));
    let assets = json!({sha: file});
    let wanted = film2d(&dir, &toothed, &assets);
    let plain = film2d(&dir, &look(json!(2), Some(paper(built_in))), &json!({}));
    assert_ne!(wanted, plain, "the image is in film2d's frame");
    let got = live(&dir, &toothed, &assets);
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(got, wanted, "the live window's frame is film2d's");
}
