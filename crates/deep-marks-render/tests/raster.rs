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

/// Whether any pixel of `image` in `x0..x1` × `y0..y1` holds ink (anything but white).
fn inked(image: &image::RgbImage, (x0, x1): (u32, u32), (y0, y1): (u32, u32)) -> bool {
    (y0..y1).any(|y| (x0..x1).any(|x| image.get_pixel(x, y).0 != [255, 255, 255]))
}

/// #390: a text over its line limit draws what the fit check shows (the shaper's cut with an
/// ellipsis, on its one line), and a masked one is clipped to its box: neither spills below it.
#[test]
fn a_text_draws_within_its_line_limit_and_box_as_the_fit_shows() {
    let dir = scratch("deep-raster", "fit");
    const TEXT: &str = "All checks passed on the branch";
    let fit = deep_text::Shaper::new().shape(&deep_text::Spec {
        width: Some(120.),
        max_lines: Some(1),
        ..deep_text::Spec::label(TEXT)
    });
    for overflow in ["ellipsis", "mask"] {
        let out = dir.join(format!("{overflow}.png"));
        let doc = json!({"format": 1, "id": "fit", "profile": "figure", "title": "Fit", "description": "A text in a box.",
            "size": [200, 80], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"long": {"id": "long", "kind": "text@1", "layer": "main", "name": "Long", "order": "a0",
                "at": {"pos": [16, 16, 0]}, "params": {"text": TEXT, "font": "body", "size": 13,
                "box": {"w": 120, "h": 20}, "overflow": overflow, "max_lines": 1}}}});
        let answer = run("raster", &json!({"out": out, "doc": doc, "look": look()}));
        assert_eq!(answer["ok"], json!(true), "{answer}");
        let image = image::open(&out).unwrap().to_rgb8();
        assert!(
            inked(&image, (16, 136), (16, 36)),
            "{overflow}: the text draws in its box"
        );
        assert!(
            !inked(&image, (0, 200), (36, 80)),
            "{overflow}: nothing draws below the 120 x 20 box"
        );
        if overflow == "ellipsis" {
            assert_eq!(fit.shown, "All checks passe…", "the fit's cut");
            assert_eq!(
                answer["texts"]["long"]["shown"],
                json!(fit.shown),
                "the raster shows what the fit shows"
            );
            let glyphs = answer["texts"]["long"]["glyphs"].as_array().unwrap();
            assert_eq!(glyphs.len(), fit.glyphs.len(), "the fit's glyphs, no more");
        }
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// #1965: a code item whose raw is an asset, the form bytes that aren't UTF-8 take, reads them
/// from the store: it shows a byte that isn't UTF-8 as U+FFFD, quotes its source by those bytes,
/// holds the code's cap as an inline raw does, and is refused when the store lacks it.
#[test]
fn a_code_item_s_raw_as_an_asset_is_read_from_the_store_and_held_to_its_cap() {
    let dir = scratch("deep-raster", "raw-asset");
    let store = dir.join("store");
    let put = |bytes: &[u8]| {
        let hash = sha256_hex(bytes);
        std::fs::write(store.join(&hash), bytes).unwrap();
        hash
    };
    let code = |hash: &str, quoted: bool| {
        let mut params = json!({"font": "mono", "size": 13, "code": {"language": "python"},
            "raw": {"asset": hash}});
        if quoted {
            params["quote"] = json!({"source": hash, "path": "name.py", "lines": [1, 1]});
        }
        let mut doc = figure(json!({"c": {"id": "c", "kind": "text@1", "layer": "main",
            "name": "Code", "order": "a0", "params": params}}));
        doc["assets"] = json!({"file": {"sha256": hash, "license": {"id": "CC0-1.0",
            "terms": "Public domain dedication.", "shareable": true, "credit": "Test fixture."}}});
        doc
    };
    let errors = |answer: &Value| -> Vec<Value> {
        let issues = answer["issues"].as_array().cloned().unwrap_or_default();
        issues
            .into_iter()
            .filter(|i| i["severity"] == "error")
            .collect()
    };
    // Latin-1: é is the one byte E9, which no UTF-8 string holds.
    let latin = put(b"name = \"caf\xe9\"\r\n");
    for quoted in [false, true] {
        let line = json!({"out": dir.join("latin.png"), "doc": code(&latin, quoted), "look": look(), "store": store});
        let checked = run("check", &line);
        assert_eq!(errors(&checked), Vec::<Value>::new(), "quoted {quoted}");
        let drawn = run("raster", &line);
        assert_eq!(
            drawn["texts"]["c"]["shown"],
            json!("name = \"caf\u{fffd}\""),
            "{drawn}"
        );
    }
    let over = put(&vec![b'a'; 262_145]);
    let refused = errors(&run(
        "check",
        &json!({"doc": code(&over, false), "look": look(), "store": store}),
    ));
    assert_eq!(refused.len(), 1, "{refused:?}");
    assert_eq!(refused[0]["ids"], json!(["c"]));
    assert_eq!(
        refused[0]["actual"],
        json!({"bytes": 262_145, "cap": 262_144})
    );
    let missing = run(
        "check",
        &json!({"doc": code(&"ab".repeat(32), false), "look": look(), "store": store}),
    );
    assert_eq!(missing["code"], json!("asset_missing"), "{missing}");
    std::fs::remove_dir_all(&dir).ok();
}

/// #375: a row frame draws its children where its layout puts them, padding and gap apart, with
/// its own stroke; with its box given, or with none, hugging them.
#[test]
fn a_layout_frame_draws_its_children_where_its_layout_puts_them() {
    let dir = scratch("deep-raster", "layout");
    let tile = |id: &str, order: &str, role: &str| {
        json!({"id": id, "kind": "frame@1", "layer": "main", "name": id, "parent": "row", "order": order,
            "params": {"box": [0, 0, 20, 20], "width": "fixed", "height": "fixed", "paint": {"fill": {"role": role}}}})
    };
    let look = json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0], "bg": [230, 230, 240],
        "c1": [40, 90, 160], "c2": [180, 60, 20]}});
    // The row is 5 + 20 + 10 + 20 + 5 wide and 5 + 20 + 5 tall, from (10, 10).
    for (name, frame_box) in [("boxed", json!([0, 0, 60, 30])), ("hugging", Value::Null)] {
        let mut row = json!({"layout": "row", "gap": 10, "padding": 5,
            "paint": {"fill": {"role": "bg"}, "stroke": {"role": "ink", "width": 2}}});
        if !frame_box.is_null() {
            row["box"] = frame_box;
        }
        let doc = json!({"format": 1, "id": "row", "profile": "figure", "title": "Row", "description": "Two tiles in a row.",
        "size": [120, 60], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {
            "row": {"id": "row", "kind": "frame@1", "layer": "main", "name": "Row", "order": "a0",
                "at": {"pos": [10, 10, 0]}, "params": row},
            "b": tile("b", "a2", "c2"),
            "a": tile("a", "a1", "c1"),
        }});
        let out = dir.join(format!("{name}.png"));
        let answer = run("raster", &json!({"out": out, "doc": doc, "look": look}));
        assert_eq!(answer["ok"], json!(true), "{name}: the row draws: {answer}");
        let image = image::open(&out).unwrap().to_rgb8();
        let at = |x: u32, y: u32| image.get_pixel(x, y).0;
        assert_eq!(
            at(25, 25),
            [40, 90, 160],
            "{name}: the first tile at (15, 15)"
        );
        assert_eq!(
            at(40, 25),
            [230, 230, 240],
            "{name}: the gap between the tiles"
        );
        assert_eq!(
            at(55, 25),
            [180, 60, 20],
            "{name}: the second tile at (45, 15)"
        );
        assert_eq!(at(90, 25), [255, 255, 255], "{name}: nothing past the row");
        assert!(
            at(10, 25)[0] < 100,
            "{name}: the row's stroke on its west edge: {:?}",
            at(10, 25)
        );
    }
    std::fs::remove_dir_all(&dir).ok();
}
