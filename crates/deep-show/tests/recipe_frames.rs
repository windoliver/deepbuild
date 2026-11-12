//! A recipe instance's derived items draw wherever the hub draws a film's frames: an export of a
//! film whose one rect comes from a pack recipe is the export of the film with that rect written
//! by hand, never the empty frame; and craft@1's caption_band, which reads the frames it plays,
//! sees that rect in the band. Drives `deep-show run` as the acceptance tests do; exports draw on
//! the GPU.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOCS: [&str; 3] = [
    "01JB409E0000000000000000001",
    "01JB409E0000000000000000002",
    "01JB409E0000000000000000003",
];

/// A fresh folder holding the pack `acme/reel@1.0.0`, whose one recipe, `reel.block@1`, is a 60 u
/// accent rect at the instance's position.
fn root_with_pack(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("deep-show-{name}-{}", std::process::id()));
    let dir = root.join("reel-1.0.0");
    std::fs::create_dir_all(&dir).expect("the pack's folder");
    let recipe = json!({
        "id": "reel.block", "version": "1.0", "title": "reel.block", "license": "MIT",
        "author": "deep-show's tests", "description": "One rect, 60 u square.", "inputs": {},
        "steps": {"block": {"op": "mark", "kind": "rect@1", "at": {"pos": [0, 0, 0]},
            "params": {"box": [0, 0, 60, 60], "paint": {"fill": {"role": "accent"}}}}},
        "outputs": {"parts": ["block"]},
    });
    std::fs::write(dir.join("reel.block@1.json"), recipe.to_string()).expect("the recipe");
    let pack = json!({
        "name": "reel", "version": "1.0.0", "license": "MIT", "description": "A test pack of one recipe.",
        "requires": {"core": ">=0.0.0", "modules": {"marks2d": ">=0.0.0"}},
        "recipes": {"reel.block@1": "reel.block@1.json"},
    });
    std::fs::write(dir.join("pack.json"), pack.to_string()).expect("the manifest");
    root
}

/// A recipe instance at `y` (its rect from `y` to `y` + 60 u).
fn instance(y: f64) -> (&'static str, Value) {
    (
        "r1",
        json!({"id": "r1", "kind": "reel.block@1", "name": "Instance", "order": "b1",
        "params": {}, "at": {"pos": [120, y, 0]}}),
    )
}

/// A 320 × 180 film of one 0.1 s shot holding `item`, naming the pack.
fn film(id: &str, item: Option<(&str, Value)>) -> Value {
    let mut items = json!({"cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
        "params": {"projection": "orthographic", "target": [160, 90, 0], "view_width": 320}}});
    if let Some((k, v)) = item {
        items[k] = v;
    }
    json!({"format": 1, "id": id, "profile": "film", "title": "A recipe's rect",
        "description": "A film for deep-show's recipe frames tests.", "size": [320, 180], "camera": "cam",
        "transport": {"frame_rate": "10/1", "span": "0.1s"}, "items": items, "packs": ["acme/reel@1.0.0"],
        "shots": {"shot-1": {"start": "0s", "end": "0.1s", "camera": "cam", "move": "hold"}}})
}

/// `deep-show run` on `docs`, each presented by the agent, then `calls`, with `claims`: the
/// replies to `calls`, after asserting every document is presented.
fn run(root: &Path, docs: &[Value], calls: Vec<Value>, claims: Value) -> Vec<Value> {
    let mut all: Vec<Value> = DOCS
        .iter()
        .zip(docs)
        .map(|(id, d)| json!({"call": "deep_show", "session": "sess-alpha", "doc": id, "document": d}))
        .collect();
    all.extend(calls);
    let panels: Value = (0..docs.len())
        .map(|k| (format!("p{k}"), json!({"rect": [0, 0, 640, 360]})))
        .collect();
    let placed: Value = DOCS
        .iter()
        .take(docs.len())
        .enumerate()
        .map(|(k, id)| (id.to_string(), json!({"panel": format!("p{k}")})))
        .collect();
    let scenario = json!({
        "evidence": root.join("evidence"),
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "panels": panels, "docs": placed, "claims": claims,
        "packs": [{"id": "acme/reel", "dir": root.join("reel-1.0.0")}],
        "calls": all,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(root);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    let replies = answer["replies"].as_array().expect("replies");
    for r in &replies[..docs.len()] {
        assert_eq!(r["outcome"], json!("presented"), "{r}");
    }
    replies[docs.len()..].to_vec()
}

#[test]
fn an_export_draws_a_recipe_instance_like_the_items_it_derives() {
    let root = root_with_pack("recipe-export");
    let block = json!({"id": "block", "kind": "rect@1", "name": "Block", "order": "b1",
        "params": {"box": [0, 0, 60, 60], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [120, 50, 0]}});
    let docs = [
        film(DOCS[0], Some(instance(50.0))),
        film(DOCS[1], Some(("block", block))),
        film(DOCS[2], None),
    ];
    let calls = DOCS
        .iter()
        .map(|id| json!({"call": "export", "doc": id, "out": root.join(id), "video": {"codec": "png_seq"}}))
        .collect();
    let replies = run(&root, &docs, calls, json!({}));
    let frame = |r: &Value| -> String {
        assert_eq!(r["outcome"], json!("exported"), "{r}");
        r["receipt"]["frame_hashes"][0]
            .as_str()
            .expect("a frame hash")
            .to_string()
    };
    let (recipe, written, empty) = (frame(&replies[0]), frame(&replies[1]), frame(&replies[2]));
    assert_ne!(written, empty, "the written rect draws in its export");
    assert_eq!(
        recipe, written,
        "the recipe's rect draws in its export as the written one does"
    );
}

#[test]
fn caption_band_sees_a_recipe_rect_in_the_band() {
    let root = root_with_pack("recipe-band");
    // In the band: the rect starts at y 160, under the top of the bottom 15% (153). Above it: y 40.
    let docs = [
        film(DOCS[0], Some(instance(160.0))),
        film(DOCS[1], Some(instance(40.0))),
    ];
    let brief = json!({"goal": "A film whose rect stays out of the captions", "craft": [{"check": "caption_band"}]});
    let claims = json!({
        "claim:01JB409F0000000000000000001": {"session": "sess-alpha", "deliverables": [DOCS[0]], "requirements": [], "brief": brief},
        "claim:01JB409F0000000000000000002": {"session": "sess-alpha", "deliverables": [DOCS[1]], "requirements": [], "brief": brief},
    });
    let calls = vec![
        json!({"call": "verdict", "claim": "claim:01JB409F0000000000000000001"}),
        json!({"call": "verdict", "claim": "claim:01JB409F0000000000000000002"}),
    ];
    let replies = run(&root, &docs, calls, claims);
    let row = |r: &Value| -> Value {
        r["requirements"]
            .as_array()
            .and_then(|rows| {
                rows.iter()
                    .find(|x| x["from"]["craft"] == json!("caption_band"))
                    .cloned()
            })
            .unwrap_or_else(|| panic!("a caption_band row: {r}"))
    };
    let (inside, above) = (row(&replies[0]), row(&replies[1]));
    assert_eq!(inside["result"], json!("FAIL"), "{inside}");
    assert!(
        inside["issues"].as_array().is_some_and(|i| i
            .iter()
            .any(|x| x["code"] == json!("craft.caption_band") && x["item"] == json!("r1.block"))),
        "the band's issue names the recipe's rect: {inside}"
    );
    assert_eq!(above["result"], json!("PASS"), "{above}");
}
