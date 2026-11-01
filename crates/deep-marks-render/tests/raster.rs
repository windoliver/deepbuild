//! What #373's blind suite leaves to the crate, through `raster` on every platform: a mark set's
//! column data from a sidecar in the store draws as its inline base64 does, and is refused when the
//! store lacks it or holds other bytes; and a stroke under 1 device px draws at 1 px with its
//! alpha scaled by its width (Paint: stroke gradients, "It can never").

mod common;

use common::{run, scratch};
use deep_canvas_marks::key::sha256_hex;
use serde_json::{json, Value};

fn look() -> Value {
    json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0]}})
}

fn figure(items: Value) -> Value {
    json!({"format": 1, "id": "raster", "profile": "figure", "title": "Raster", "description": "A raster test.",
        "size": [40, 20], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}}, "items": items})
}

fn f32_base64(values: &[f32]) -> String {
    let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    bytes
        .chunks(3)
        .flat_map(|c| {
            let n = c
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
            (0..4).map(move |k| {
                if k <= c.len() {
                    char::from(ALPHABET[(n >> (18 - 6 * k)) as usize & 63])
                } else {
                    '='
                }
            })
        })
        .collect()
}

fn points(x_data: Value) -> Value {
    figure(
        json!({"dots": {"id": "dots", "kind": "marks@1", "layer": "main", "name": "Dots", "order": "a0",
        "params": {"mark": "point", "n": 3, "columns": {
            "x": {"dtype": "f32", "len": 3, "data": x_data},
            "y": {"const": 10}, "size": {"const": 6}},
            "encode": {"x": {"column": "x"}, "y": {"column": "y"}, "size": {"column": "size"}},
            "paint": {"fill": {"role": "ink"}}}}}),
    )
}

#[test]
fn a_sidecar_column_draws_as_its_inline_data_and_is_refused_missing_or_changed() {
    let dir = scratch("deep-raster", "sidecar");
    let xs = [8.0f32, 20.0, 32.0];
    let bytes: Vec<u8> = xs.iter().flat_map(|v| v.to_le_bytes()).collect();
    let hash = sha256_hex(&bytes);
    std::fs::write(dir.join("store").join(&hash), &bytes).unwrap();
    let store = dir.join("store");
    let draw = |doc: Value, out: &str| {
        let out = dir.join(out);
        let answer = run(
            "raster",
            &json!({"out": out, "doc": doc, "look": look(), "store": store}),
        );
        (answer, std::fs::read(&out).ok())
    };
    let (inline, inline_png) = draw(points(json!(f32_base64(&xs))), "inline.png");
    let (sidecar, sidecar_png) = draw(points(json!({"sidecar": hash})), "sidecar.png");
    assert_eq!(inline["ok"], json!(true), "{inline}");
    assert_eq!(sidecar["ok"], json!(true), "{sidecar}");
    assert!(
        inline_png.is_some() && inline_png == sidecar_png,
        "the same pixels"
    );

    // Other bytes under the hash, and a store that lacks it.
    std::fs::write(dir.join("store").join(&hash), [0u8; 12]).unwrap();
    let (changed, _) = draw(points(json!({"sidecar": hash})), "changed.png");
    assert_eq!(changed["code"], json!("asset_mismatch"), "{changed}");
    let missing = run(
        "raster",
        &json!({"out": dir.join("missing.png"), "doc": points(json!({"sidecar": "ab".repeat(32)})), "look": look()}),
    );
    assert_eq!(missing["code"], json!("asset_missing"), "{missing}");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_stroke_under_one_device_px_draws_at_one_px_with_its_alpha_scaled_by_its_width() {
    let dir = scratch("deep-raster", "hairline");
    let out = dir.join("hairline.png");
    let doc = figure(
        json!({"hair": {"id": "hair", "kind": "path@1", "layer": "main", "name": "Hairline", "order": "a0",
        "params": {"d": "M 0 10.5 L 40 10.5", "paint": {"stroke": {"role": "ink", "width": 0.25}}}}}),
    );
    let answer = run("raster", &json!({"out": out, "doc": doc, "look": look()}));
    assert_eq!(answer["ok"], json!(true), "{answer}");
    let image = image::open(&out).unwrap().to_rgb8();
    for x in 2..38 {
        // Ink at alpha 0.25 over white, composited in encoded sRGB: 191.25.
        let row = image.get_pixel(x, 10)[0];
        assert!(
            (190..=192).contains(&row),
            "column {x} of row 10 reads {row}"
        );
        assert_eq!(image.get_pixel(x, 9)[0], 255, "nothing above the 1 px row");
        assert_eq!(image.get_pixel(x, 11)[0], 255, "nothing below it");
    }
    std::fs::remove_dir_all(&dir).ok();
}
