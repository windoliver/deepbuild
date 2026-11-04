//! Render-back draws the same bytes in any build (#674 AC3: "an image without sampling draws byte
//! for byte as it does on the base commit"): a build of several packages, such as
//! `cargo build --workspace`, turns on vello_cpu's u8 pipeline beside the f32 one, and render-back
//! must still draw on the f32 pipeline. Draws #674's sprite through `deep-show run` as its
//! acceptance tests do and compares it with the base commit's draw in its fixtures.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Keeps `bytes` in the evidence store at `root` by their sha256, as `packages/evidence` does.
fn put(root: &Path, bytes: &[u8]) -> String {
    let sha = hex(bytes);
    let dir = root.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("the store's folder");
    std::fs::write(dir.join(&sha[2..]), bytes).expect("the asset");
    sha
}

/// #674's 5 × 3 sprite of smooth colors, its right column half transparent.
fn sprite() -> Vec<u8> {
    let mut rgba = Vec::new();
    for y in 0..3u8 {
        for x in 0..5u8 {
            rgba.extend([
                40 + 50 * x,
                30 + 90 * y,
                200 - 30 * x - 20 * y,
                if x == 4 { 160 } else { 255 },
            ]);
        }
    }
    let mut png = Vec::new();
    image::RgbaImage::from_raw(5, 3, rgba)
        .expect("5 × 3")
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("encoded");
    png
}

#[test]
fn render_back_draws_the_sprite_as_the_base_commit_did() {
    let root = std::env::temp_dir().join(format!("deep-show-render-back-{}", std::process::id()));
    let asset = put(&root, &sprite());
    let document = json!({"format": 1, "profile": "board", "title": "Sampling",
        "description": "Images drawn with the sampler their sampling field names.", "size": [32, 24],
        "items": {"sprite": {"id": "sprite", "kind": "image@1", "name": "sprite", "order": "a0",
            "params": {"asset": asset, "box": [3.5, 2.25, 17, 11.5], "fit": "contain",
                "alt": "A picture for the sampling test", "opacity": 0.6, "crop": [0, 0, 4, 3]}}},
        "assets": {"picture": {"sha256": asset, "license": "CC0-1.0"}}});
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "panels": {"main": {"rect": [0, 0, 800, 600]}},
        "docs": {"01JB7D00000000000000000001": {"panel": "main"}},
        "calls": [{"call": "deep_show", "session": "sess-alpha", "doc": "01JB7D00000000000000000001",
            "document": document, "t": "0s", "size": [32, 24], "include": ["issues", "pixels"]}],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    let sha = answer["replies"][0]["snapshots"][0]["sha256"]
        .as_str()
        .map(str::to_string);
    let shot = sha.and_then(|s| std::fs::read(root.join(&s[..2]).join(&s[2..])).ok());
    let _ = std::fs::remove_dir_all(&root);
    let shot = image::load_from_memory(&shot.unwrap_or_else(|| panic!("a snapshot: {answer}")))
        .expect("a PNG")
        .to_rgba8();
    let base = image::open(repo().join("tests/acceptance/674/fixtures/base/sprite-back.png"))
        .expect("the base commit's draw")
        .to_rgba8();
    assert_eq!(shot.dimensions(), base.dimensions());
    let off: Vec<_> = shot
        .enumerate_pixels()
        .filter(|(x, y, p)| base.get_pixel(*x, *y) != *p)
        .map(|(x, y, p)| ((x, y), p.0, base.get_pixel(x, y).0))
        .collect();
    assert!(
        off.is_empty(),
        "{} pixels off the base commit's draw, first (pixel, drawn, base): {:?}",
        off.len(),
        off.first()
    );
}
