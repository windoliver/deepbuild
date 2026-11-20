//! Render-back sets text in the look's type, its fallback faces too (Text `text@1`: `fallback` is
//! the look's fallback list): a family emoji, which the body face (Inter) lacks, draws in the
//! clean look's emoji face, as the frame `deep_show` draws it, and not as the `.notdef` boxes the
//! same text draws in that look with no fallback faces. A render-back that set text in the bundled
//! type would draw the boxes in both looks.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CLEAN: &str = "01JB0FA11BAC0000000000000A";
const LATIN: &str = "01JB0FA11BAC0000000000000B";
const SIZE: [u32; 2] = [96, 48];
const FAMILY: &str = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";

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

/// The clean look with no fallback faces, so its text is set in the body face alone.
fn latin_look() -> Vec<u8> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../deep-canvas-marks/looks/clean.json");
    let mut look: Value = serde_json::from_slice(&std::fs::read(path).expect("the clean look"))
        .expect("the clean look is JSON");
    look["id"] = json!("latin");
    look["description"] = json!("The clean look with no fallback faces.");
    look["fallback"] = json!([]);
    serde_json::to_vec(&look).expect("encoded")
}

/// One text in the body face whose only grapheme is the family emoji, in `look` by asset if any.
fn document(look: Option<&str>) -> Value {
    let mut doc = json!({"format": 1, "profile": "board", "title": "Family",
        "description": "A text whose one grapheme is a family emoji.", "size": SIZE,
        "items": {"family": {"id": "family", "kind": "text@1", "name": "family", "order": "a0",
            "at": {"pos": [8, 4, 0]},
            "params": {"text": FAMILY, "font": "body", "size": 32, "box": {"w": 80, "h": 40}}}}});
    if let Some(sha) = look {
        doc["look"] = json!({"asset": "latin@1", "theme": "light"});
        doc["assets"] = json!({"latin": {"sha256": sha, "license": {"id": "Apache-2.0",
            "terms": "The repository's own look, renamed.", "shareable": true,
            "credit": "The clean look, with no fallback faces."}}});
    }
    doc
}

#[test]
fn render_back_draws_a_family_emoji_in_the_looks_fallback_face() {
    let root = std::env::temp_dir().join(format!("deep-show-fallback-{}", std::process::id()));
    let latin = put(&root, &latin_look());
    let show = |doc: &str, document: Value| {
        json!({"call": "deep_show", "session": "sess-alpha", "doc": doc, "document": document,
            "size": SIZE, "include": ["issues", "pixels"]})
    };
    let back = |doc: &str| json!({"call": "render_back", "session": "sess-alpha", "doc": doc, "t": 0, "rev": 1, "size": SIZE});
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "panels": {"main": {"rect": [0, 0, 800, 600]}, "side": {"rect": [0, 0, 800, 600]}},
        "docs": {CLEAN: {"panel": "main"}, LATIN: {"panel": "side"}},
        "calls": [show(CLEAN, document(None)), back(CLEAN), show(LATIN, document(Some(&latin))), back(LATIN)],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(&root);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    let replies = &answer["replies"];
    let sha = |i: usize| {
        assert_eq!(
            replies[i]["outcome"], "presented",
            "reply {i} is presented: {}",
            replies[i]
        );
        replies[i]["snapshots"][0]["sha256"]
            .as_str()
            .unwrap_or_else(|| panic!("reply {i} draws a frame: {}", replies[i]))
            .to_string()
    };
    let (shown, back, latin_shown, latin_back) = (sha(0), sha(1), sha(2), sha(3));
    assert_ne!(
        back, latin_back,
        "render-back draws the family emoji as it draws .notdef boxes in the look with no fallback"
    );
    assert_eq!(
        back, shown,
        "render-back draws the family emoji as the frame deep_show draws it, in the look's emoji face"
    );
    assert_eq!(
        latin_back, latin_shown,
        "with no fallback faces, render-back draws the frame deep_show draws"
    );
}
