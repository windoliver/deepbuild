//! The mapper on small Lottie files: what each Lottie field becomes, and what comes back as an
//! issue naming its layer.

use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const FLICKS: f64 = 705_600_000.0;

fn still(k: Value) -> Value {
    json!({"a": 0, "k": k})
}

fn ks() -> Value {
    json!({"a": still(json!([0, 0])), "p": still(json!([0, 0])), "s": still(json!([100, 100])), "r": still(json!(0)), "o": still(json!(100))})
}

fn shape_layer(nm: &str, ind: u32, shapes: Vec<Value>) -> Value {
    json!({"ty": 4, "nm": nm, "ind": ind, "ip": 0, "op": 60, "st": 0, "ks": ks(), "shapes": shapes})
}

fn rect(fill: [f64; 4]) -> Vec<Value> {
    vec![
        json!({"ty": "rc", "nm": "r", "p": still(json!([50, 50])), "s": still(json!([20, 10])), "r": still(json!(0))}),
        json!({"ty": "fl", "nm": "f", "c": still(json!(fill)), "o": still(json!(100))}),
    ]
}

fn file(layers: Vec<Value>) -> Value {
    json!({"v": "5.7.0", "nm": "t", "fr": 60, "ip": 0, "op": 60, "w": 200, "h": 200, "layers": layers})
}

struct Got {
    doc: Map<String, Value>,
    look: Vec<u8>,
    issues: Value,
}

fn import(f: &Value, look: &str) -> Got {
    let out = deep_lottie::import(
        &serde_json::to_vec(f).unwrap(),
        &json!({"from": "lottie", "look": look}),
        None,
    )
    .expect("imported");
    let doc: Value = serde_json::from_slice(&out.document).unwrap();
    Got {
        doc: doc.as_object().cloned().unwrap(),
        look: out.look,
        issues: serde_json::from_slice(&out.report).unwrap(),
    }
}

fn passes(g: &Got) {
    let errors = deep_lottie::check::document(&Value::Object(g.doc.clone()), &g.look);
    assert!(errors.is_empty(), "the document check: {errors:?}");
    assert_eq!(
        deep_lottie::check::colors_mapped(&Value::Object(g.doc.clone())),
        None
    );
    assert_eq!(
        deep_lottie::check::no_expression(&Value::Object(g.doc.clone())),
        None
    );
}

fn issue<'a>(g: &'a Got, code: &str) -> Vec<&'a Value> {
    g.issues["issues"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["code"] == json!(code))
        .collect()
}

/// A cubic Bézier ease's progress at `x`, by bisection on its x.
fn ease(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    let b = |a: f64, c: f64, u: f64| {
        3.0 * (1.0 - u) * (1.0 - u) * u * a + 3.0 * (1.0 - u) * u * u * c + u * u * u
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if b(x1, x2, mid) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    b(y1, y2, (lo + hi) / 2.0)
}

#[test]
fn a_position_keyed_with_spatial_tangents_follows_its_curve_by_arc_length() {
    // Two segments, each a curve: at 0, 30 and 60 frames, eased in and out.
    let keys = json!([
        {"t": 0, "s": [20, 150], "to": [40, -120], "ti": [-30, 0], "o": {"x": 0.3, "y": 0}, "i": {"x": 0.7, "y": 1}},
        {"t": 30, "s": [120, 40], "to": [30, 0], "ti": [10, -80], "o": {"x": 0.5, "y": 0.2}, "i": {"x": 0.5, "y": 0.8}},
        {"t": 60, "s": [180, 160]}
    ]);
    let mut layer = shape_layer("mover", 1, rect([0.2, 0.4, 0.6, 1.0]));
    layer["ks"]["p"] = json!({"a": 1, "k": keys});
    let g = import(&file(vec![layer]), "generated");
    passes(&g);
    let c = g.doc["constraints"]
        .as_object()
        .unwrap()
        .values()
        .find(|c| c["kind"] == json!("follow_path"))
        .expect("a follow_path");
    assert_eq!(c["owner"], json!("mover"));
    let program = Program::compile(&g.doc).unwrap();
    // The reference: each segment's curve sampled densely, the point at the eased share of its
    // length.
    let seg = |p: [[f64; 2]; 4], share: f64| -> [f64; 2] {
        let n = 20_000;
        let at = |u: f64| {
            let w = [
                (1.0 - u).powi(3),
                3.0 * (1.0 - u).powi(2) * u,
                3.0 * (1.0 - u) * u * u,
                u.powi(3),
            ];
            [
                (0..4).map(|k| w[k] * p[k][0]).sum::<f64>(),
                (0..4).map(|k| w[k] * p[k][1]).sum::<f64>(),
            ]
        };
        let pts: Vec<[f64; 2]> = (0..=n).map(|k| at(k as f64 / n as f64)).collect();
        let lens: Vec<f64> = std::iter::once(0.0)
            .chain(pts.windows(2).scan(0.0, |s, w| {
                *s += ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt();
                Some(*s)
            }))
            .collect();
        let want = share * lens[n];
        let i = lens.partition_point(|l| *l < want).clamp(1, n);
        let u = if lens[i] > lens[i - 1] {
            (want - lens[i - 1]) / (lens[i] - lens[i - 1])
        } else {
            0.0
        };
        [
            pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u,
            pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u,
        ]
    };
    let segs = [
        (
            [[20.0, 150.0], [60.0, 30.0], [90.0, 40.0], [120.0, 40.0]],
            (0.3, 0.0, 0.7, 1.0),
            0.0,
        ),
        (
            [[120.0, 40.0], [150.0, 40.0], [190.0, 80.0], [180.0, 160.0]],
            (0.5, 0.2, 0.5, 0.8),
            30.0,
        ),
    ];
    let mut seed: u64 = 7;
    let mut worst: f64 = 0.0;
    for _ in 0..100 {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let frames = (seed >> 11) as f64 / (1u64 << 53) as f64 * 60.0;
        let flicks = (frames * FLICKS / 60.0).round() as i64;
        let f = frames.min(60.0);
        let (p, e, start) = segs[if f < 30.0 { 0 } else { 1 }];
        let x = ((flicks as f64 / FLICKS * 60.0) - start) / 30.0;
        let want = seg(p, ease(e.0, e.1, e.2, e.3, x.clamp(0.0, 1.0)));
        let got =
            frame(&g.doc, &program, flicks, Validity::Full).items["mover"]["at"]["pos"].clone();
        let d = ((got[0].as_f64().unwrap() - want[0]).powi(2)
            + (got[1].as_f64().unwrap() - want[1]).powi(2))
        .sqrt();
        worst = worst.max(d);
    }
    assert!(worst <= 0.1, "{worst} u from the arc-length position");
}

#[test]
fn a_trim_with_no_m_trims_each_shape_and_m_2_all_as_one() {
    let trim = |m: Option<u32>| {
        let mut t = json!({"ty": "tm", "nm": "t", "s": still(json!(0)), "e": still(json!(50)), "o": still(json!(0))});
        if let Some(m) = m {
            t["m"] = json!(m);
        }
        let mut shapes = rect([0.0, 0.0, 0.0, 1.0]);
        shapes.insert(1, t);
        let g = import(&file(vec![shape_layer("bar", 1, shapes)]), "generated");
        passes(&g);
        g.doc["items"]["bar"]["params"]["ops"][0]["trim"]["each"].clone()
    };
    assert_eq!(trim(None), json!(true));
    assert_eq!(trim(Some(1)), json!(true));
    assert_eq!(trim(Some(2)), json!(false));
}

#[test]
fn merge_paths_text_layers_effects_and_expressions_come_back_as_issues_naming_their_layer() {
    let mut merged = rect([0.0, 0.0, 0.0, 1.0]);
    merged.insert(1, json!({"ty": "mm", "nm": "Merge Paths 1", "mm": 1}));
    let mut wiggled = shape_layer("Wiggler", 2, rect([0.0, 0.0, 0.0, 1.0]));
    let script = "wiggle(2, 30) + thisComp.layer('x').transform.position";
    wiggled["ks"]["p"] = json!({"a": 0, "k": [10, 20], "x": script});
    wiggled["ef"] = json!([{"ty": 5, "nm": "Slider Control", "ef": []}]);
    let text = json!({"ty": 5, "nm": "Headline", "ind": 3, "ip": 0, "op": 60, "st": 0, "ks": ks(), "t": {"d": {"k": [{"t": 0, "s": {"t": "Hello"}}]}}});
    let g = import(
        &file(vec![shape_layer("Merger", 1, merged), wiggled, text]),
        "generated",
    );
    passes(&g);
    assert_eq!(issue(&g, "merge_paths")[0]["layer"], json!("Merger"));
    assert_eq!(issue(&g, "text_layer")[0]["layer"], json!("Headline"));
    assert_eq!(issue(&g, "layer_effect")[0]["layer"], json!("Wiggler"));
    let expr = issue(&g, "expression");
    assert_eq!(
        (expr.len(), &expr[0]["layer"], &expr[0]["property"]),
        (1, &json!("Wiggler"), &json!("ks/p"))
    );
    // The property keeps its own value; the script is nowhere in the outputs.
    assert_eq!(g.doc["items"]["wiggler"]["at"]["pos"], json!([10, 20, 0]));
    let all = [serde_json::to_string(&g.doc).unwrap(), g.issues.to_string()].concat();
    assert!(
        !all.contains("wiggle(") && !all.contains("thisComp"),
        "the expression's text is in an output"
    );
}

#[test]
fn a_luma_matte_takes_luma_encoded_and_its_source_is_hidden() {
    let mut source = shape_layer("Matte", 1, rect([1.0, 1.0, 1.0, 1.0]));
    source["td"] = json!(1);
    let mut target = shape_layer("Art", 2, rect([0.9, 0.1, 0.1, 1.0]));
    target["tt"] = json!(3);
    let g = import(&file(vec![source, target]), "generated");
    passes(&g);
    let matte = g.doc["items"]
        .as_object()
        .unwrap()
        .values()
        .find(|i| i["kind"] == json!("matte@1"))
        .expect("a matte");
    assert_eq!(
        matte["params"],
        json!({"source": "matte", "mode": "luma", "luma": "encoded", "applies_to": "art"})
    );
    assert_eq!(g.doc["items"]["matte"]["visible"], json!(false));
}

#[test]
fn an_ease_given_per_dimension_splits_the_position_into_one_channel_a_dimension() {
    let mut layer = shape_layer("Mover", 1, rect([0.0, 0.0, 0.0, 1.0]));
    layer["ks"]["p"] = json!({"a": 1, "k": [
        {"t": 0, "s": [0, 0], "o": {"x": [0.1, 0.9], "y": [0, 0]}, "i": {"x": [0.2, 0.8], "y": [1, 1]}},
        {"t": 60, "s": [100, 50]}]});
    let g = import(&file(vec![layer]), "generated");
    passes(&g);
    let targets: Vec<&str> = g.doc["channels"]
        .as_object()
        .unwrap()
        .values()
        .filter_map(|c| c["target"].as_str())
        .collect();
    assert!(
        targets.contains(&"items/mover/at/pos/0") && targets.contains(&"items/mover/at/pos/1"),
        "{targets:?}"
    );
    let x = g.doc["channels"]
        .as_object()
        .unwrap()
        .values()
        .find(|c| c["target"] == json!("items/mover/at/pos/1"))
        .unwrap();
    assert_eq!(x["keys"]["k0000"]["interp"]["bezier"]["x1"], json!(0.9));
}

#[test]
fn literal_colors_become_one_generated_role_each_alpha_into_opacity() {
    let a = shape_layer("A", 1, rect([1.0, 0.0, 0.0, 0.5]));
    let b = shape_layer("B", 2, rect([1.0, 0.0, 0.0, 1.0]));
    let c = shape_layer("C", 3, rect([0.0, 0.5, 1.0, 1.0]));
    // The clean look's fail color itself.
    let d = shape_layer(
        "D",
        4,
        rect([191.0 / 255.0, 35.0 / 255.0, 43.0 / 255.0, 1.0]),
    );
    let g = import(&file(vec![a, b, c, d]), "generated");
    passes(&g);
    let fill = |id: &str| g.doc["items"][id]["params"]["paint"]["fill"].clone();
    assert_eq!(fill("a"), json!({"role": "lottie_ff0000", "opacity": 0.5}));
    assert_eq!(fill("b"), json!({"role": "lottie_ff0000"}));
    assert_eq!(fill("c"), json!({"role": "lottie_0080ff"}));
    let look: Value = serde_json::from_slice(&g.look).unwrap();
    assert_eq!(look["palette"]["lottie_0080ff"], json!("#0080ff"));
    assert_eq!(g.issues["colors"].as_array().unwrap().len(), 3);
    // A role on a status color is reported, naming the layer that used it, and no other is.
    let near = issue(&g, "color_near_status");
    assert_eq!(
        (near.len(), &near[0]["layer"]),
        (1, &json!("D")),
        "{}",
        g.issues
    );
}

#[test]
fn a_named_look_takes_each_colors_nearest_role_and_names_the_mapping() {
    let g = import(
        &file(vec![shape_layer("A", 1, rect([0.1, 0.64, 0.79, 1.0]))]),
        "clean@1",
    );
    passes(&g);
    assert_eq!(
        g.doc["items"]["a"]["params"]["paint"]["fill"]["role"],
        json!("accent")
    );
    assert_eq!(g.doc["look"], json!({"asset": "clean@1", "theme": "light"}));
    let colors = g.issues["colors"].as_array().unwrap();
    assert_eq!(
        (colors[0]["role"].clone(), colors[0]["color"].clone()),
        (json!("accent"), json!("#1aa3c9"))
    );
    assert!(colors[0]["distance"].as_f64().unwrap() > 0.0);
}

#[test]
fn ids_come_from_layer_names_sanitised_and_numbered_in_layer_order() {
    let g = import(
        &file(vec![
            shape_layer("dot", 1, rect([0.0, 0.0, 0.0, 1.0])),
            shape_layer("dot", 2, rect([0.0, 0.0, 0.0, 1.0])),
            shape_layer("Big Dot!", 3, rect([0.0, 0.0, 0.0, 1.0])),
        ]),
        "generated",
    );
    passes(&g);
    let ids: Vec<&String> = g.doc["items"].as_object().unwrap().keys().collect();
    assert_eq!(ids, ["big_dot_", "dot", "dot.2"]);
    // The first layer draws on top.
    assert!(g.doc["items"]["dot"]["order"].as_str() > g.doc["items"]["dot.2"]["order"].as_str());
}

#[test]
fn a_masked_layers_group_transform_is_the_items_own_and_its_mask_stays_in_the_layer() {
    // The export's masked item: the layer's own transform the identity, the item's on the one
    // group around its shapes (its y keyed 0 → −10), the mask in the layer's space.
    let tr = json!({"ty": "tr", "a": still(json!([0, 0])), "s": still(json!([100, 100])), "r": still(json!(0)), "o": still(json!(100)),
        "p": {"a": 1, "k": [{"t": 0, "s": [20, 0], "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}}, {"t": 60, "s": [20, -10]}]}});
    let mut shapes = rect([0.0, 0.0, 0.0, 1.0]);
    shapes.push(tr);
    let mut layer = shape_layer(
        "Line",
        1,
        vec![json!({"ty": "gr", "nm": "Line", "it": shapes})],
    );
    let zero = json!([[0, 0], [0, 0], [0, 0], [0, 0]]);
    let pt = json!({"c": true, "v": [[0, 0], [100, 0], [100, 80], [0, 80]], "i": zero.clone(), "o": zero});
    layer["masksProperties"] =
        json!([{"nm": "Veil", "mode": "a", "pt": still(pt), "o": still(json!(100))}]);
    let g = import(&file(vec![layer]), "generated");
    passes(&g);
    let program = Program::compile(&g.doc).unwrap();
    let at = |s: f64| {
        let f = frame(&g.doc, &program, (s * FLICKS) as i64, Validity::Full);
        (
            f.items["line"]["at"]["pos"].clone(),
            f.items["veil"]["at"]["pos"].clone(),
        )
    };
    let (line, veil) = at(0.5);
    assert_eq!(
        (&line[0], &line[1], &veil[0], &veil[1]),
        (&json!(20.0), &json!(-5.0), &json!(0.0), &json!(0.0))
    );
    assert_eq!(
        g.doc["items"]["veil"]["params"]["box"],
        json!([0, 0, 100, 80])
    );
}

#[test]
fn the_same_file_gives_the_same_bytes() {
    let f = file(vec![
        shape_layer("a", 1, rect([0.3, 0.2, 0.1, 1.0])),
        shape_layer("b", 2, rect([0.1, 0.2, 0.3, 1.0])),
    ]);
    let bytes = serde_json::to_vec(&f).unwrap();
    let one = deep_lottie::import(&bytes, &json!({"look": "generated"}), None).unwrap();
    let two = deep_lottie::import(&bytes, &json!({"look": "generated"}), None).unwrap();
    assert_eq!(
        (one.document, one.look, one.report),
        (two.document, two.look, two.report)
    );
}
