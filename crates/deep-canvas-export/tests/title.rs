//! The writer on a title with a trim, a repeater, a mask and Bézier keys: Lottie types only, no
//! warnings, Bézier keys written as Lottie's own, and Lottie's evaluation of every transform key
//! equal to the document's at each export frame.

use deep_canvas_export::lottie::keys::{eval, Ease, LKey};
use deep_canvas_export::lottie::{self, Frames, Plant};
use deep_canvas_marks::scene::Type;
use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

const FLICKS: i64 = 705_600_000;

fn title() -> Value {
    let bez = json!({"bezier": {"x1": 0.42, "y1": 0.0, "x2": 0.58, "y2": 1.0}});
    json!({"format": 1, "id": "title", "profile": "figure", "size": [320, 180], "transport": {"span": "2s"},
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
    }})
}

fn palette() -> deep_canvas_marks::scene::Palette {
    let def = deep_canvas_marks::look::shipped("clean").unwrap();
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    deep_canvas_marks::look::resolve(&def, &bundled)
        .unwrap()
        .light
}

fn write(doc: &Value, plant: Plant) -> lottie::Written {
    let frames = Frames {
        rate: (60, 1),
        frame: FLICKS / 60,
        first: 0,
        n: 120,
    };
    lottie::write(
        doc.as_object().unwrap(),
        (&palette(), &Type::default()),
        frames,
        (true, Vec::new()),
        plant,
    )
    .expect("written")
}

fn types(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            if let Some(Value::String(t)) = m.get("ty") {
                out.push(t.clone());
            }
            if let Some(Value::Number(n)) = m.get("ty") {
                out.push(n.to_string());
            }
            m.values().for_each(|x| types(x, out));
        }
        Value::Array(a) => a.iter().for_each(|x| types(x, out)),
        _ => {}
    }
}

fn layer<'a>(l: &'a Value, nm: &str) -> &'a Value {
    let mut stack = vec![l];
    while let Some(v) = stack.pop() {
        if v.get("nm") == Some(&json!(nm)) && v.get("ks").is_some() {
            return v;
        }
        match v {
            Value::Object(m) => stack.extend(m.values()),
            Value::Array(a) => stack.extend(a.iter()),
            _ => {}
        }
    }
    panic!("no layer {nm}")
}

fn keys_of(p: &Value) -> Vec<LKey> {
    p["k"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| {
            let s: Vec<f64> = k["s"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_f64().unwrap())
                .collect();
            let ease = if k.get("h").is_some() {
                Ease::Hold
            } else if let (Some(o), Some(i)) = (k.get("o"), k.get("i")) {
                Ease::Bezier([
                    o["x"][0].as_f64().unwrap(),
                    o["y"][0].as_f64().unwrap(),
                    i["x"][0].as_f64().unwrap(),
                    i["y"][0].as_f64().unwrap(),
                ])
            } else {
                Ease::Linear
            };
            LKey {
                t: k["t"].as_f64().unwrap(),
                s,
                ease,
            }
        })
        .collect()
}

#[test]
fn the_title_writes_lottie_types_only_and_no_warnings() {
    let w = write(&title(), Plant::None);
    assert!(w.warnings.is_empty(), "warnings: {:?}", w.warnings);
    let mut ty = Vec::new();
    types(&w.lottie, &mut ty);
    let known = [
        "0", "1", "2", "3", "4", "gr", "rc", "el", "sh", "sr", "fl", "st", "gf", "gs", "tr", "tm",
        "rd", "pb",
    ];
    for t in &ty {
        assert!(
            known.contains(&t.as_str()),
            "type {t} isn't one Lottie 1.0.1 defines"
        );
    }
    // The mask is on the layer it clips, whose own transform stays the identity.
    let bar = layer(&w.lottie, "bar");
    assert_eq!(bar["masksProperties"][0]["mode"], json!("a"));
    assert_eq!(bar["masksProperties"][0]["nm"], json!("cut"));
    // Four copies, the last at half opacity.
    let dots = layer(&w.lottie, "dots");
    let copies = dots["shapes"][0]["it"].as_array().unwrap();
    let groups: Vec<&Value> = copies.iter().filter(|c| c["ty"] == "gr").collect();
    assert_eq!(groups.len(), 4);
    let last_tr = groups[3]["it"].as_array().unwrap().last().unwrap();
    assert_eq!(last_tr["o"]["k"], json!(50));
}

#[test]
fn bezier_keys_stay_lotties_own_and_match_every_frame() {
    let doc = title();
    let w = write(&doc, Plant::None);
    // The masked bar's transform is on the group around its shapes.
    let bar = layer(&w.lottie, "bar");
    let tr = bar["shapes"][0]["it"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(tr["ty"], json!("tr"));
    let p = &tr["p"];
    assert_eq!(p["a"], json!(1), "the bar's position is keyed: {p}");
    let keys = keys_of(p);
    assert_eq!(keys.len(), 2, "its two keys, not one a frame");
    assert!(matches!(keys[0].ease, Ease::Bezier(_)));
    let program = Program::compile(doc.as_object().unwrap()).unwrap();
    for j in 0..120 {
        let f = frame(
            doc.as_object().unwrap(),
            &program,
            j * FLICKS / 60,
            Validity::Full,
        );
        let x = f.items["bar"]["at"]["pos"][0].as_f64().unwrap();
        let got = eval(&keys, j as f64)[0];
        assert!((got - x).abs() < 1e-6, "frame {j}: {got} vs {x}");
    }
}

#[test]
fn the_same_document_writes_the_same_bytes() {
    let a = serde_json::to_vec(&write(&title(), Plant::None).lottie).unwrap();
    let b = serde_json::to_vec(&write(&title(), Plant::None).lottie).unwrap();
    assert_eq!(a, b);
}

#[test]
fn markers_carry_their_name_start_and_span() {
    let mut doc = title();
    doc["transport"] = json!({"span": "2.8s"});
    doc["markers"] = json!({
        "shrink": {"t": "0.85s", "kind": "section", "name": "shrink"},
        "wait": {"t": "1.15s", "kind": "section", "name": "wait"},
        "done": {"t": "2.25s", "kind": "section", "name": "done"}});
    let frames = Frames {
        rate: (60, 1),
        frame: FLICKS / 60,
        first: 0,
        n: 168,
    };
    let w = lottie::write(
        doc.as_object().unwrap(),
        (&palette(), &Type::default()),
        frames,
        (true, Vec::new()),
        Plant::None,
    )
    .unwrap();
    assert_eq!(
        w.lottie["markers"],
        json!([{"cm": "shrink", "tm": 51, "dr": 18}, {"cm": "wait", "tm": 69, "dr": 66}, {"cm": "done", "tm": 135, "dr": 33}])
    );
}

#[test]
fn a_status_binding_is_refused() {
    let mut doc = title();
    doc["items"]["bar"]["params"]["status"] = json!({"source": "build"});
    let frames = Frames {
        rate: (60, 1),
        frame: FLICKS / 60,
        first: 0,
        n: 10,
    };
    let r = lottie::write(
        doc.as_object().unwrap(),
        (&palette(), &Type::default()),
        frames,
        (true, Vec::new()),
        Plant::None,
    )
    .err()
    .unwrap();
    assert_eq!(r.code, "lottie.status_binding");
}
