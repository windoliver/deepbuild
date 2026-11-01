//! The rest of R1's marks through GPUI (#391 Scope): an image read from the store by its hash and
//! checked, a rect mask that clips it as a scissor, and the dirty classes a session stamps. Each
//! reads pixels or the session's own report, so a mask that clipped nothing, an image drawn from
//! the wrong bytes, or a tracker that stamped nothing would fail.

#![cfg(target_os = "macos")]

mod common;

use std::path::Path;

use common::{run, scratch};
use deep_canvas_marks::key::sha256_hex;
use serde_json::{json, Value};

/// A 40 × 40 red PNG in the store, named by its hash.
fn red_asset(dir: &Path) -> String {
    let png = dir.join("red.png");
    image::RgbaImage::from_pixel(40, 40, image::Rgba([255, 0, 0, 255]))
        .save(&png)
        .unwrap();
    let bytes = std::fs::read(&png).unwrap();
    let hash = sha256_hex(&bytes);
    std::fs::write(dir.join("store").join(&hash), bytes).unwrap();
    hash
}

fn look() -> Value {
    json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0]}})
}

fn masked_image(hash: &str, opacity: f64) -> Value {
    json!({
        "format": 1, "id": "image-391", "size": [120, 60], "layers": {"main": {"order": "a0"}},
        "items": {
            "m": {"id": "m", "kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 60, 60]}},
            "shot": {"id": "shot", "kind": "image@1", "layer": "main", "parent": "m",
                "params": {"asset": hash, "box": [0, 0, 120, 60], "fit": "fill", "opacity": opacity, "alt": "red"}},
        },
    })
}

fn pixel(path: &Path, x: u32, y: u32) -> [u8; 3] {
    let p = image::open(path).unwrap().to_rgb8().get_pixel(x, y).0;
    [p[0], p[1], p[2]]
}

#[test]
fn an_image_from_the_store_draws_inside_its_mask_and_nowhere_else() {
    let dir = scratch("deep-marks-render", "mask");
    let hash = red_asset(&dir);
    let out = dir.join("masked.png");
    let answer = run(
        "render",
        &json!({"out": out, "doc": masked_image(&hash, 1.0), "look": look(), "store": dir.join("store")}),
    );
    assert_eq!(answer["ok"], true, "{answer}");
    assert_eq!(
        pixel(&out, 30, 30),
        [255, 0, 0],
        "inside the mask the image shows"
    );
    assert_eq!(
        pixel(&out, 90, 30),
        [255, 255, 255],
        "outside the mask the ground shows, though the image's box reaches there"
    );
    // Half opacity mixes the red with the ground.
    let half = dir.join("half.png");
    run(
        "render",
        &json!({"out": half, "doc": masked_image(&hash, 0.5), "look": look(), "store": dir.join("store")}),
    );
    let [r, g, b] = pixel(&half, 30, 30);
    assert!(
        r == 255 && (120..=136).contains(&g) && g == b,
        "half-opaque red over white, got {:?}",
        [r, g, b]
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_image_is_refused_when_its_bytes_are_missing_or_are_not_the_hash_it_names() {
    let dir = scratch("deep-marks-render", "refused");
    let hash = red_asset(&dir);
    let out = dir.join("x.png");
    let missing = run(
        "render",
        &json!({"out": out, "doc": masked_image(&hash, 1.0), "look": look()}),
    );
    assert_eq!(missing["code"], "asset_missing", "{missing}");
    std::fs::write(dir.join("store").join(&hash), b"not the image").unwrap();
    let wrong = run(
        "render",
        &json!({"out": out, "doc": masked_image(&hash, 1.0), "look": look(), "store": dir.join("store")}),
    );
    assert_eq!(wrong["code"], "asset_mismatch", "{wrong}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_session_reports_each_change_s_dirty_class() {
    let card = |x: f64, role: &str| {
        json!({
            "format": 1, "id": "dirty-391", "size": [100, 60], "layers": {"main": {"order": "a0"}},
            "items": {"r": {"id": "r", "kind": "rect@1", "layer": "main", "at": {"pos": [x, 0, 0]},
                "params": {"box": [0, 0, 20, 20], "paint": {"fill": {"role": role}}}}},
        })
    };
    let look =
        json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0], "accent": [0, 0, 255]}});
    let answer = run(
        "session",
        &json!({"look": look, "steps": [
            {"doc": card(0.0, "ink"), "t": 0, "frames": 1},
            {"doc": card(10.0, "ink"), "t": 705_600_000, "frames": 1},
            {"doc": card(10.0, "accent"), "t": 1_411_200_000, "frames": 1},
        ]}),
    );
    assert_eq!(answer["ok"], true, "{answer}");
    let classes = |k: usize| -> Vec<(String, String)> {
        answer["steps"][k]["dirty"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| {
                (
                    d["item"].as_str().unwrap().to_string(),
                    d["class"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    };
    assert_eq!(classes(0), vec![("r".to_string(), "presence".to_string())]);
    assert_eq!(classes(1), vec![("r".to_string(), "transform".to_string())]);
    assert_eq!(classes(2), vec![("r".to_string(), "shading".to_string())]);
}
