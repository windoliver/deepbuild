//! Render-back of 3D axes whose x title names a vector item draws that vector at the axis's end
//! (#2450), in every frame deep-show draws: `render_back`'s frame is the one `deep_show` draws,
//! and the title adds its ink to the same axes drawn with no x title. A host that left the
//! title's picture out would draw its quad's stand-in, which is no ink.
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const TITLED: &str = "01JB2450F0000000000000000A";
const BARE: &str = "01JB2450F0000000000000000B";
const SIZE: [u32; 2] = [640, 360];

/// Keeps `bytes` in the evidence store at `root` by their sha256, as `packages/evidence` does.
fn put(root: &Path, bytes: &[u8]) -> String {
    let sha: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let dir = root.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("the store's folder");
    std::fs::write(dir.join(&sha[2..]), bytes).expect("the asset");
    sha
}

/// The axes seen close at the x axis's end, their x title the vector item `xt` or none.
fn scene(src: &str, titled: bool) -> Value {
    let item = |id: &str, order: &str, kind: &str, params: Value| json!({"id": id, "name": id, "order": order, "kind": kind, "params": params});
    let scale = |id: &str, order: &str| {
        item(
            id,
            order,
            "scale@1",
            json!({"type": "linear", "domain": [-4, 4], "range": &id[..1], "nice": false}),
        )
    };
    let titles = if titled {
        json!({"x": "xt"})
    } else {
        json!({})
    };
    let mut xt = item(
        "xt",
        "a5",
        "vector@1",
        json!({"src": src, "size": [200, 100], "colors": {"#000000": "ink"}, "alt": "x prime"}),
    );
    xt["visible"] = json!(false);
    json!({"format": 1, "profile": "scene", "title": "Titled axes", "description": "3D axes whose x title is a vector.",
           "size": SIZE, "camera": "cam", "requires": {"modules": {"scene3d": "^1", "vector": "^1"}},
           "items": {
               "cam": item("cam", "a0", "camera@1", json!({"projection": "perspective", "target": [4.5, 0, 0], "fov": 45,
                           "orbit": {"azimuth": 30, "elevation": 20, "distance": 6}, "near": 0.1, "far": 200})),
               "sky": item("sky", "a1", "sky@1", json!({"top": [0.15, 0.3, 0.75, 1], "low": [0.6, 0.7, 0.85, 1],
                           "ambient_top": [0.35, 0.35, 0.35], "ambient_low": [0.15, 0.15, 0.15]})),
               "xs": scale("xs", "a2"), "ys": scale("ys", "a3"), "zs": scale("zs", "a4"),
               "xt": xt,
               "axes": item("axes", "a6", "axes3d@1", json!({"x": "xs", "y": "ys", "z": "zs", "lengths": [8, 8, 8],
                            "ticks": {"size": 0.15}, "titles": titles}))}})
}

#[test]
fn render_back_draws_a_vector_title_as_deep_show_does() {
    let root = std::env::temp_dir().join(format!("deep-show-vector-title-{}", std::process::id()));
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path fill="#000000" d="M10 10H30L90 90H70Z"/><path fill="#000000" d="M70 10H90L30 90H10Z"/><path fill="#000000" d="M140 10H175L160 45H125Z"/></svg>"##;
    let src = put(&root, svg.as_bytes());
    let show = |doc: &str, titled: bool| {
        json!({"call": "deep_show", "session": "sess-alpha", "doc": doc,
        "document": scene(&src, titled), "size": SIZE, "include": ["issues", "pixels"]})
    };
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "panels": {"main": {"rect": [0, 0, 800, 600]}, "side": {"rect": [0, 0, 800, 600]}},
        "docs": {TITLED: {"panel": "main"}, BARE: {"panel": "side"}},
        "calls": [
            show(TITLED, true),
            {"call": "render_back", "session": "sess-alpha", "doc": TITLED, "t": 0, "rev": 1, "size": SIZE},
            show(BARE, false),
        ],
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
    let replies = &answer["replies"];
    let frame = |i: usize| {
        assert_eq!(
            replies[i]["outcome"], "presented",
            "reply {i} is presented: {}",
            replies[i]
        );
        let sha = replies[i]["snapshots"][0]["sha256"]
            .as_str()
            .unwrap_or_else(|| panic!("reply {i} draws a frame: {}", replies[i]));
        let png = std::fs::read(root.join(&sha[..2]).join(&sha[2..])).expect("the snapshot");
        let ink = image::load_from_memory(&png)
            .expect("a PNG")
            .to_rgb8()
            .pixels()
            .filter(|p| p.0.iter().all(|c| *c < 80))
            .count();
        (sha.to_string(), ink)
    };
    let (shown, back, bare) = (frame(0), frame(1), frame(2));
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(
        back.0, shown.0,
        "render-back draws the frame deep_show draws, the title's picture in it"
    );
    assert!(
        shown.1 >= bare.1 + 150,
        "the vector title adds its ink at the x axis's end: {} ink pixels with it, {} without",
        shown.1,
        bare.1
    );
}
