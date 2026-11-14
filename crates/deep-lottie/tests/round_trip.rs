//! The round trip with our own export: a title with a trim, a repeater, a mask and Bézier keys,
//! written as Lottie by the export's convention, imports back to a document that passes the
//! document check and whose drawn items evaluate to the title's own values at 100 seeded times
//! within 1e-4, its mask back as a rect mask of the same box over the layer it sits on; its
//! markers come back with their names at the same flicks.

use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const FLICKS: f64 = 705_600_000.0;

/// The title as the document an agent wrote.
fn title() -> Value {
    let bez = json!({"bezier": {"x1": 0.42, "y1": 0.0, "x2": 0.58, "y2": 1.0}});
    json!({"format": 1, "id": "title", "profile": "figure", "title": "Title", "description": "A title.", "size": [320, 180],
    "transport": {"span": "2.8s"},
    "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
    "items": {
        "ground": {"id": "ground", "kind": "rect@1", "layer": "main", "name": "ground", "order": "a0",
            "params": {"box": [0, 0, 320, 180], "paint": {"fill": {"role": "ground"}}}},
        "cut": {"id": "cut", "kind": "mask@1", "layer": "main", "name": "cut", "order": "a1",
            "params": {"shape": "rect", "box": [40, 30, 240, 120], "applies_to": "children"}},
        "bar": {"id": "bar", "kind": "rect@1", "layer": "main", "name": "bar", "order": "a2", "parent": "cut",
            "params": {"box": [0, 60, 120, 40], "paint": {"fill": {"role": "accent"}}}},
        "ring": {"id": "ring", "kind": "circle@1", "layer": "main", "name": "ring", "order": "a3",
            "params": {"center": [160, 90], "r": 40, "ops": [{"trim": {"start": 0, "end": 0.2, "offset": 0, "each": true}}],
                "paint": {"stroke": {"role": "ink", "width": 6}}}},
        "dots": {"id": "dots", "kind": "rect@1", "layer": "main", "name": "dots", "order": "a4",
            "params": {"box": [20, 140, 12, 12], "ops": [{"repeater": {"copies": 3.5, "at": {"pos": [24, 0]}}}],
                "paint": {"fill": {"role": "ink"}}}}
    },
    "channels": {
        "slide": {"target": "items/bar/at/pos", "type": "vec2", "keys": {
            "k0": {"t": "0s", "value": [0, 0], "interp": bez}, "k1": {"t": "1.5s", "value": [200, 0]}}},
        "draw": {"target": "items/ring/params/ops/0/trim/end", "type": "f32", "keys": {
            "k0": {"t": "0s", "value": 0.2, "interp": bez}, "k1": {"t": "2s", "value": 1.0}}}
    },
    "markers": {
        "shrink": {"t": "0.85s", "kind": "section", "name": "shrink"},
        "wait": {"t": "1.15s", "kind": "section", "name": "wait"},
        "done": {"t": "2.25s", "kind": "section", "name": "done"}
    }})
}

fn still(k: Value) -> Value {
    json!({"a": 0, "k": k})
}

fn tr() -> Value {
    json!({"ty": "tr", "nm": "transform", "p": still(json!([0, 0])), "a": still(json!([0, 0])), "s": still(json!([100, 100])), "r": still(json!(0)), "o": still(json!(100)), "sk": still(json!(0)), "sa": still(json!(0))})
}

fn ks(p: Value) -> Value {
    json!({"a": still(json!([0, 0])), "p": p, "s": still(json!([100, 100])), "r": still(json!(0)), "o": still(json!(100))})
}

fn layer(nm: &str, ind: u32, p: Value, shapes: Vec<Value>) -> Value {
    json!({"ty": 4, "nm": nm, "ind": ind, "ip": 0, "op": 168, "st": 0, "sr": 1, "ddd": 0, "ks": ks(p), "shapes": shapes})
}

fn fill(c: [f64; 3]) -> Value {
    json!({"ty": "fl", "nm": "fill", "c": still(json!([c[0], c[1], c[2], 1])), "o": still(json!(100)), "r": 1})
}

const INK: [f64; 3] = [27.0 / 255.0, 29.0 / 255.0, 34.0 / 255.0];
const ACCENT: [f64; 3] = [26.0 / 255.0, 163.0 / 255.0, 200.0 / 255.0];

/// The title as the export writes it (its convention: one layer an item, its `nm` the item's
/// name, here its ID; a repeater as `<name>.copy.<k>` groups; a mask over its children as
/// `masksProperties` on each child's own layer).
fn lottie() -> Value {
    let rc = |p: [f64; 2], s: [f64; 2]| json!({"ty": "rc", "nm": "rc", "d": 1, "p": still(json!(p)), "s": still(json!(s)), "r": still(json!(0))});
    let copy = |k: usize, x: f64, o: f64| {
        let mut t = tr();
        t["p"] = still(json!([x, 0]));
        t["o"] = still(json!(o));
        json!({"ty": "gr", "nm": format!("dots.copy.{k}"), "it": [rc([26.0, 146.0], [12.0, 12.0]), fill(INK), t]})
    };
    let bar_p = json!({"a": 1, "k": [
        {"t": 0, "s": [0, 0], "o": {"x": [0.42, 0.42], "y": [0, 0]}, "i": {"x": [0.58, 0.58], "y": [1, 1]}},
        {"t": 90, "s": [200, 0]}]});
    let trim_e = json!({"a": 1, "k": [
        {"t": 0, "s": [20], "o": {"x": [0.42], "y": [0]}, "i": {"x": [0.58], "y": [1]}},
        {"t": 120, "s": [100]}]});
    let none = still(json!([0, 0]));
    let zero = json!([[0, 0], [0, 0], [0, 0], [0, 0]]);
    let rect = json!({"c": true, "v": [[40, 30], [280, 30], [280, 150], [40, 150]], "i": zero.clone(), "o": zero});
    let mask = json!({"nm": "cut", "mode": "a", "inv": false, "pt": still(rect), "o": still(json!(100)), "x": still(json!(0))});
    let mut bar = layer(
        "bar",
        3,
        bar_p,
        vec![
            json!({"ty": "gr", "nm": "bar", "it": [rc([60.0, 80.0], [120.0, 40.0]), fill(ACCENT), tr()]}),
        ],
    );
    bar["hasMask"] = json!(true);
    bar["masksProperties"] = json!([mask]);
    json!({"v": "5.12.2", "nm": "title", "fr": 60, "ip": 0, "op": 168, "w": 320, "h": 180, "ddd": 0,
        "layers": [
            layer("dots", 1, none.clone(), vec![json!({"ty": "gr", "nm": "dots", "it": [copy(0, 0.0, 100.0), copy(1, 24.0, 100.0), copy(2, 48.0, 100.0), copy(3, 72.0, 50.0), tr()]})]),
            layer("ring", 2, none.clone(), vec![json!({"ty": "gr", "nm": "ring", "it": [
                {"ty": "el", "nm": "ring", "d": 1, "p": still(json!([160, 90])), "s": still(json!([80, 80]))},
                {"ty": "tm", "nm": "ring.trim.0", "s": still(json!(0)), "e": trim_e, "o": still(json!(0)), "m": 1},
                {"ty": "st", "nm": "stroke", "c": still(json!([INK[0], INK[1], INK[2], 1])), "o": still(json!(100)), "w": still(json!(6)), "lc": 1, "lj": 1, "ml": 4},
                tr()]})]),
            bar,
            layer("ground", 5, none, vec![json!({"ty": "gr", "nm": "ground", "it": [rc([160.0, 90.0], [320.0, 180.0]), fill([1.0, 1.0, 1.0]), tr()]})])
        ],
        "markers": [{"cm": "shrink", "tm": 51, "dr": 18}, {"cm": "wait", "tm": 69, "dr": 66}, {"cm": "done", "tm": 135, "dr": 33}]})
}

fn imported() -> (Map<String, Value>, Vec<u8>) {
    let file = serde_json::to_vec(&lottie()).unwrap();
    let out = deep_lottie::import(&file, &json!({"from": "lottie", "look": "clean@1"}), None)
        .expect("imported");
    let doc: Value = serde_json::from_slice(&out.document).unwrap();
    (doc.as_object().cloned().unwrap(), out.look)
}

/// Where `a` and `b` differ past 1e-4, by path: numbers by value, everything else exactly.
fn differ(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            if (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() > 1e-4 {
                out.push(format!("{path}: {x} vs {y}"));
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys().filter(|k| !x.contains_key(*k))) {
                differ(
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                    &format!("{path}/{k}"),
                    out,
                );
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (i, (p, q)) in x.iter().zip(y).enumerate() {
                differ(p, q, &format!("{path}/{i}"), out);
            }
        }
        _ if a != b => out.push(format!("{path}: {a} vs {b}")),
        _ => {}
    }
}

#[test]
fn the_title_imports_back_to_the_same_item_values_at_100_times() {
    let source = title();
    let source = source.as_object().unwrap();
    let (doc, look) = imported();
    let errors = deep_lottie::check::document(&Value::Object(doc.clone()), &look);
    assert!(
        errors.is_empty(),
        "the imported title fails the document check: {errors:?}"
    );
    let (a, b) = (
        Program::compile(source).unwrap(),
        Program::compile(&doc).unwrap(),
    );
    let mut seed: u64 = 162;
    let mut failures = Vec::new();
    for _ in 0..100 {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let t = ((seed >> 11) as f64 / (1u64 << 53) as f64 * 2.8 * FLICKS) as i64;
        let (fa, fb) = (
            frame(source, &a, t, Validity::Full),
            frame(&doc, &b, t, Validity::Full),
        );
        for (id, item) in &fa.items {
            let Some(got) = fb.items.get(id) else {
                failures.push(format!("{id}: not imported"));
                continue;
            };
            // The mask sits on its child's layer: its shape and box come back, over that layer.
            if item["kind"] == json!("mask@1") {
                differ(
                    &item["params"]["box"],
                    &got["params"]["box"],
                    &format!("{t} {id}/box"),
                    &mut failures,
                );
                let over = got["params"]["applies_to"].as_str().unwrap_or("");
                if doc["collections"][over]["members"] != json!(["bar"]) {
                    failures.push(format!("{id}: applies to {over}, not a collection of bar"));
                }
                continue;
            }
            for field in ["kind", "params", "at", "adjust", "visible"] {
                differ(
                    item.get(field).unwrap_or(&Value::Null),
                    got.get(field).unwrap_or(&Value::Null),
                    &format!("{t} {id}/{field}"),
                    &mut failures,
                );
            }
        }
    }
    failures.dedup();
    assert!(
        failures.is_empty(),
        "{} differences, first: {:?}",
        failures.len(),
        &failures[..failures.len().min(8)]
    );
}

#[test]
fn the_markers_come_back_with_their_names_at_the_same_flicks() {
    let (doc, _) = imported();
    let markers = doc["markers"].as_object().unwrap();
    for (name, s) in [("shrink", 0.85), ("wait", 1.15), ("done", 2.25)] {
        let m = markers
            .values()
            .find(|m| m["name"] == json!(name))
            .unwrap_or_else(|| panic!("no marker {name}: {markers:?}"));
        assert_eq!(m["t"], json!((s * FLICKS).round() as i64), "{name}");
        // A span that runs to the next marker is the export's for a marker of none.
        assert!(m.get("span").is_none(), "{name}: {m}");
    }
}
