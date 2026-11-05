//! The gallery deep_kinds serves (#412): every example an agent is shown presents through deep_show
//! with no error, so copying one never starts from a refusal. Drives `deep-show run` as the
//! acceptance tests do.
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB412G0000000000000000001";

fn gallery() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("gallery")
}

fn show(document: Value) -> Value {
    let evidence = std::env::temp_dir().join(format!("deep-show-gallery-{}", std::process::id()));
    let scenario = json!({
        "evidence": evidence,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "panels": {"p1": {"rect": [0, 0, 1280, 800]}},
        "docs": {DOC: {"panel": "p1"}},
        "calls": [{"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": document, "include": ["issues"]}],
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(&evidence);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    answer["replies"][0].clone()
}

#[test]
fn every_gallery_example_presents_with_no_error() {
    let index: Value = serde_json::from_slice(
        &std::fs::read(gallery().join("gallery.json")).expect("the gallery index"),
    )
    .expect("JSON");
    let examples = index["examples"].as_array().expect("examples");
    assert!(!examples.is_empty());
    for example in examples {
        let file = example["file"].as_str().expect("a file");
        let document: Value =
            serde_json::from_slice(&std::fs::read(gallery().join(file)).expect("the example"))
                .expect("JSON");
        let shown = show(document);
        let errors: Vec<&Value> = shown["issues"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i["severity"] == json!("error"))
            .collect();
        assert!(errors.is_empty(), "{file} has no error: {errors:?}");
        assert_eq!(shown["outcome"], json!("presented"), "{file}: {shown}");
    }
}
