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

/// #2031: a lit group below full opacity draws its lit and unlit children as one unit, then takes
/// its opacity once (Frame and group: "children then composite as today"), so where an unlit child
/// covers a lit one only the unlit child shows through the group's opacity.
#[test]
fn a_lit_group_below_full_opacity_composites_its_children_as_one_unit() {
    let dir = scratch("deep-raster", "lit-opacity");
    let rect = |id: &str, order: &str, x: f64, role: &str, extra: Value| {
        let mut params = json!({"box": [x, 0, 20, 20], "paint": {"fill": {"role": role}}});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        json!({"id": id, "kind": "rect@1", "layer": "main", "name": id, "order": order,
            "params": params, "parent": "g"})
    };
    let doc = figure(json!({
        "back": {"id": "back", "kind": "rect@1", "layer": "main", "name": "back", "order": "a0",
            "params": {"box": [0, 0, 40, 20], "paint": {"fill": {"role": "blue"}}}},
        "g": {"id": "g", "kind": "group@1", "layer": "main", "name": "g", "order": "a1",
            "params": {"opacity": 0.5, "light": {}}},
        "lit": rect("lit", "a2", 0.0, "ground", json!({})),
        "unlit": rect("unlit", "a3", 10.0, "ink", json!({"unlit": true})),
    }));
    let look = json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0], "blue": [0, 0, 255]}});
    let out = dir.join("lit-opacity.png");
    let answer = run("raster", &json!({"out": out, "doc": doc, "look": look}));
    assert_eq!(answer["ok"], json!(true), "the lit group draws: {answer}");
    let image = image::open(&out).unwrap().to_rgb8();
    // Black over blue at half opacity; lit white (ambient 0.25: code 137) at half where it shows.
    assert_eq!(
        image.get_pixel(15, 10).0,
        [0, 0, 128],
        "where the unlit child covers the lit one"
    );
    assert_eq!(
        image.get_pixel(5, 10).0,
        [69, 69, 196],
        "the lit child alone"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// #2031's documents for the review's regressions: `items` on one writer layer at `size`.
fn lit_doc(size: [u32; 2], items: Value, extra: Value) -> Value {
    let mut doc = json!({"format": 1, "id": "lights", "profile": "figure", "title": "Lights",
        "description": "A lights test.", "size": size,
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}}, "items": items});
    doc.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    doc
}

fn item(id: &str, kind: &str, order: &str, params: Value, parent: Option<&str>) -> Value {
    let mut i = json!({"id": id, "kind": kind, "layer": "main", "name": id, "order": order,
        "params": params});
    if let Some(p) = parent {
        i["parent"] = json!(p);
    }
    i
}

fn drawn_at(name: &str, doc: &Value, look: &Value, t: i64, at: [u32; 2]) -> [u8; 3] {
    let dir = scratch("deep-raster", name);
    let out = dir.join(format!("{name}.png"));
    let answer = run(
        "raster",
        &json!({"out": out, "doc": doc, "look": look, "t": t}),
    );
    assert_eq!(answer["ok"], json!(true), "{name} draws: {answer}");
    let image = image::open(&out).unwrap().to_rgb8();
    std::fs::remove_dir_all(&dir).ok();
    image.get_pixel(at[0], at[1]).0
}

fn near(got: [u8; 3], want: [u8; 3]) -> bool {
    got.iter().zip(want).all(|(a, b)| a.abs_diff(b) <= 1)
}

/// #2031: a lit group's blended child still blends with what lies under the group, its color lit
/// first (here by ambient 1, which lights nothing).
#[test]
fn a_blended_child_of_a_lit_group_blends_with_what_is_under_it() {
    let look = json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0],
        "sky": [100, 200, 255], "red": [255, 128, 0]}});
    let items = json!({
        "back": item("back", "rect@1", "a0", json!({"box": [0, 0, 40, 20], "paint": {"fill": {"role": "sky"}}}), None),
        "g": item("g", "group@1", "a1", json!({"light": {"ambient": 1, "lights": []}}), None),
        "m": item("m", "group@1", "a2", json!({"blend": "multiply"}), Some("g")),
        "r": item("r", "rect@1", "a3", json!({"box": [10, 0, 20, 20], "paint": {"fill": {"role": "red"}}}), Some("m")),
    });
    let got = drawn_at(
        "lit-multiply",
        &lit_doc([40, 20], items, json!({})),
        &look,
        0,
        [20, 10],
    );
    assert!(near(got, [100, 100, 0]), "red multiplied over sky: {got:?}");
}

/// #2031: an item's paint (#467) inside a lit group draws as it does with no light, when the
/// light (ambient 1) lights nothing.
#[test]
fn paint_inside_a_lit_group_draws() {
    let look = json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0],
        "focus": [79, 70, 229], "accent": [26, 163, 200]}});
    let doc = |light: Value| {
        let disc = json!({"center": [100.5, 100.5], "r": 50, "paint": {"fill": {"role": "focus"},
            "glow": {"where": "inner", "role": "accent", "size": 8}}});
        lit_doc(
            [200, 200],
            json!({
                "g": item("g", "group@1", "a1", json!({"light": light}), None),
                "disc": item("disc", "circle@1", "a2", disc, Some("g")),
            }),
            json!({}),
        )
    };
    let lit = drawn_at(
        "lit-paint",
        &doc(json!({"ambient": 1})),
        &look,
        0,
        [100, 100],
    );
    let plain = drawn_at("plain-paint", &doc(Value::Null), &look, 0, [100, 100]);
    assert!(
        near(lit, plain),
        "the disc's centre: {lit:?} lit, {plain:?} with no light"
    );
}

/// #2031: a lit group's lights travel with its parallax, as its children do.
#[test]
fn a_lit_groups_lights_move_with_its_parallax() {
    let look = json!({"light": {"ground": [255, 255, 255], "ink": [0, 0, 0]}});
    let light = json!({"ambient": 0, "lights": [{"at": [50, 50], "color": "ground", "range": 40}]});
    let items = json!({
        "g": item("g", "group@1", "a1", json!({"parallax": {"drift": [100, 0]}, "light": light}), None),
        "r": item("r", "rect@1", "a2", json!({"box": [0, 0, 100, 100], "paint": {"fill": {"role": "ground"}}}), Some("g")),
    });
    let doc = lit_doc([300, 100], items, json!({"transport": {"span": "2s"}}));
    // At 1 s the rect and its light have drifted 100 u right: the light's centre is lit full.
    let got = drawn_at("lit-parallax", &doc, &look, 705_600_000, [150, 50]);
    assert!(near(got, [255, 255, 255]), "under the moved light: {got:?}");
}

/// #2031: a channel that carries a lit group's ambient past 1 is refused at check, naming the key.
#[test]
fn a_channel_that_carries_ambient_past_one_is_refused() {
    let items = json!({
        "g": item("g", "group@1", "a1", json!({"light": {"ambient": 0.5}}), None),
        "r": item("r", "rect@1", "a2", json!({"box": [0, 0, 40, 20], "paint": {"fill": {"role": "ground"}}}), Some("g")),
    });
    let keys = json!({"k0": {"t": "0s", "value": 0.5, "interp": "linear"}, "k1": {"t": "2s", "value": 2, "interp": "linear"}});
    let channels = json!({"channels": {"amb": {"target": "items/g/params/light/ambient", "type": "f32", "keys": keys}}});
    let doc = lit_doc([40, 20], items, channels);
    let answer = run("check", &json!({"doc": doc, "look": look()}));
    assert_eq!(answer["ok"], json!(false), "refused: {answer}");
    let named = answer["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["severity"] == "error" && i["path"] == "channels/amb/keys/k1/value");
    assert!(named, "an error names the key: {answer}");
}
