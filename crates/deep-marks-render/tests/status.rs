//! Status marks on every paint slot and the look's treatment of them (#392 Fields: Status binding
//! `fill | stroke | badge`; Look `status_treatment`), and the honest-numbers rule that a bound
//! number never draws cut short. Each reads the drawn pixels or the refusal, so a renderer that
//! skipped a slot, the outline or the fit check would fail.

#![cfg(target_os = "macos")]

mod common;

use std::path::Path;

use common::{run, scratch};
use serde_json::{json, Value};

fn pixel(path: &Path, x: f64, y: f64) -> [u8; 3] {
    let p = image::open(path)
        .unwrap()
        .to_rgb8()
        .get_pixel(x as u32, y as u32)
        .0;
    [p[0], p[1], p[2]]
}

fn hex(look: &Value, path: &[&str]) -> [u8; 3] {
    let mut v = look;
    for k in path {
        v = &v[*k];
    }
    let s = v.as_str().unwrap().trim_start_matches('#');
    let b = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).unwrap();
    [b(0), b(2), b(4)]
}

fn clean() -> Value {
    run("look", &json!({"look": "clean"}))["look"].clone()
}

fn board(items: Value, bindings: Value) -> Value {
    json!({
        "format": 1, "id": "slots-392", "profile": "board", "title": "Slots",
        "description": "Status on each paint slot.", "size": [320, 160],
        "layers": {"main": {"writer": "deep", "title": "Main", "order": "a0"}},
        "items": items, "status_bindings": bindings,
    })
}

const V1: &str = "verdict:01JB4000000000000000000001";
const V2: &str = "verdict:01JB4000000000000000000002";
const R3: &str = "run:01JB4000000000000000000003";

#[test]
fn a_stroke_rings_its_item_a_badge_marks_its_corner_and_a_fill_colors_a_circle() {
    let dir = scratch("deep-392-status", "slots");
    let out = dir.join("slots.png");
    let doc = board(
        json!({
            "panel": {"id": "panel", "kind": "rect@1", "layer": "main", "name": "Panel", "order": "a0",
                "params": {"box": [40, 40, 120, 40], "paint": {"fill": {"role": "muted"}}}},
            "title": {"id": "title", "kind": "text@1", "layer": "main", "name": "Title", "order": "a1",
                "params": {"text": "Deploy", "font": "body", "size": 13, "box": {"w": 80, "h": 20}}, "at": {"pos": [200, 40, 0]}},
            "dot": {"id": "dot", "kind": "circle@1", "layer": "main", "name": "Dot", "order": "a2",
                "params": {"center": [240, 120], "r": 16}},
        }),
        json!({
            "s-panel": {"target": "items/panel/params/paint/stroke", "source": R3},
            "s-title": {"target": "items/title/params/paint/badge", "source": V2},
            "s-dot": {"target": "items/dot/params/paint/fill", "source": V1},
        }),
    );
    let states = json!({V1: "pass", V2: "fail", R3: "running"});
    let report = run(
        "render",
        &json!({"out": out, "doc": doc, "look": "clean", "states": states}),
    );
    assert_eq!(report["ok"], true, "{report}");
    let look = clean();
    let color = |s: &str| hex(&look, &["status", s]);
    let ground = hex(&look, &["palette", "white"]);
    // The stroke: a 4 px ring outside the panel's box, the ground beyond it.
    assert_eq!(
        pixel(&out, 38.0, 60.0),
        color("running"),
        "the ring's left side"
    );
    assert_eq!(pixel(&out, 100.0, 37.0), color("running"), "the ring's top");
    assert_eq!(pixel(&out, 34.0, 60.0), ground, "outside the ring");
    // The badge: a chip in the status color at the text's top right corner, with its glyph.
    let marks = report["marks"].as_array().unwrap();
    let mark = |item: &str| marks.iter().find(|m| m["item"] == item).unwrap().clone();
    let badge = mark("title");
    assert_eq!(
        (&badge["slot"], &badge["glyph"]),
        (&json!("badge"), &json!("✗"))
    );
    let chip: Vec<f64> = serde_json::from_value(badge["chip"].clone()).unwrap();
    assert_eq!(
        pixel(&out, chip[0] + chip[2] / 2.0, chip[1] + 1.5),
        color("fail"),
        "the chip's top edge"
    );
    assert!(
        (chip[0] + chip[2] / 2.0 - 280.0).abs() < 0.01
            && (chip[1] + chip[3] / 2.0 - 40.0).abs() < 0.01,
        "the chip centers on the text's top right corner: {chip:?}"
    );
    // A stroke carries its glyph in a chip too.
    assert_eq!(mark("panel")["glyph"], "↻");
    assert!(mark("panel")["chip"].is_array());
    // The legend takes a corner that covers no item and no status mark.
    let boxes: Vec<Vec<f64>> = marks
        .iter()
        .flat_map(|m| [m["bounds"].clone(), m["chip"].clone()])
        .filter(Value::is_array)
        .map(|b| serde_json::from_value(b).unwrap())
        .chain([
            vec![200.0, 40.0, 80.0, 20.0],
            vec![224.0, 104.0, 32.0, 32.0],
        ])
        .collect();
    for entry in report["legend"].as_array().unwrap() {
        let s: Vec<f64> = serde_json::from_value(entry["swatch"].clone()).unwrap();
        for b in &boxes {
            let overlaps = s[0] < b[0] + b[2]
                && b[0] < s[0] + s[2]
                && s[1] < b[1] + b[3]
                && b[1] < s[1] + s[3];
            assert!(!overlaps, "the legend's swatch {s:?} covers {b:?}");
        }
    }
    // The fill on a circle: its disc in the status color.
    assert_eq!(pixel(&out, 240.0, 106.5), color("pass"), "the disc's top");
    assert_eq!(pixel(&out, 240.0, 101.0), ground, "above the disc");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_look_s_outline_rings_every_status_mark_and_its_core_has_a_least_size() {
    let dir = scratch("deep-392-status", "outline");
    let out = dir.join("outline.png");
    let doc = board(
        json!({"gate": {"id": "gate", "kind": "rect@1", "layer": "main", "name": "Gate", "order": "a0",
            "params": {"box": [40, 40, 96, 24]}}}),
        json!({"s-gate": {"target": "items/gate/params/paint/fill", "source": V1}}),
    );
    let states = json!({V1: "pass"});
    let mut look = clean();
    look["status_treatment"]["outline"] = json!({"px": 2, "role": "ink"});
    let report = run(
        "render",
        &json!({"out": out, "doc": doc, "look": look, "states": states}),
    );
    assert_eq!(report["ok"], true, "{report}");
    let ink = hex(&look, &["palette", "graphite"]);
    assert_eq!(pixel(&out, 39.0, 52.0), ink, "the outline left of the mark");
    assert_eq!(
        pixel(&out, 41.0, 52.0),
        hex(&look, &["status", "pass"]),
        "the mark inside it"
    );
    // A filled status mark smaller than the look's core is refused, naming the item.
    let mut small = doc.clone();
    small["items"]["gate"]["params"]["box"] = json!([40, 40, 3, 24]);
    let refused = run(
        "render",
        &json!({"out": out, "doc": small, "look": "clean", "states": states}),
    );
    assert_eq!(
        (&refused["code"], &refused["path"]),
        (&json!("status_too_small"), &json!("items/gate"))
    );
    // A text's fill is its ink and can't take a status color.
    let mut text = board(
        json!({"t": {"id": "t", "kind": "text@1", "layer": "main", "name": "T", "order": "a0",
            "params": {"text": "Gate", "font": "body", "size": 13, "box": {"w": 80, "h": 20}}}}),
        json!({"s": {"target": "items/t/params/paint/fill", "source": V1}}),
    );
    text["id"] = json!("text-fill");
    let refused = run(
        "render",
        &json!({"out": out, "doc": text, "look": "clean", "states": states}),
    );
    assert_eq!(refused["code"], "status_slot_kind");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_bound_number_that_does_not_fit_its_box_fails_rather_than_draws_cut_short() {
    let dir = scratch("deep-392-status", "fit");
    let out = dir.join("fit.png");
    let doc = |w: f64| {
        json!({
            "format": 1, "id": "fit-392", "profile": "board", "title": "Fit",
            "description": "A bound number in a box.", "size": [320, 60],
            "layers": {"main": {"writer": "deep", "title": "Main", "order": "a0"}},
            "items": {"n": {"id": "n", "kind": "text@1", "layer": "main", "name": "N", "order": "a0",
                "params": {"text": "", "font": "body", "size": 13, "box": {"w": w, "h": 20}}, "at": {"pos": [16, 16, 0]}}},
            "bound_values": {"v": {"target": "items/n/params/text", "source": "reading:01JB4000000000000000000004"}},
        })
    };
    let frames = |w: f64| {
        run(
            "frames",
            &json!({"doc": doc(w), "look": "clean", "vsyncs": 1,
            "readings": {"reading:01JB4000000000000000000004": 1_234_567}}),
        )
    };
    let narrow = frames(30.0);
    assert_eq!(
        (&narrow["code"], &narrow["path"]),
        (&json!("number_unfit"), &json!("items/n/params/box")),
        "{narrow}"
    );
    let wide = frames(200.0);
    assert_eq!(wide["ok"], true, "{wide}");
    assert_eq!(wide["vsyncs"][0]["bound"]["v"]["text"], "1,234,567");
    let _ = (out, std::fs::remove_dir_all(dir));
}
