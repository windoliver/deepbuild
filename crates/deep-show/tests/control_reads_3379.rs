//! #3379: removing a control a logic item still reads is refused with `ref_unresolved` at the
//! read, the refusal's `actual` the rows `refs_to` gives. The blind suite covers a shared
//! document's whole revision. These cover the other two ways a control goes: a sole writer's
//! whole revision, and a patch that deletes it from a shared document. Drives `deep-show run` as
//! the acceptance tests do.
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DOC: &str = "01JC3379D00000000000000001";
const PATCH: &str = "01JC3379P00000000000000001";
const WRITER: &str = "agent:thread-alpha";

/// crates/deep-logic/src/fixture.wat, as crates/deep-show/tests/logic_canvas.rs holds it.
const COUNTER: &str = "0061736d0100000001050160017e0003030200000504010101010617047f004180080b7f004180100b7f0141000b7f0141000b072f05066d656d6f727902000872656164735f61740300097772697465735f6174030104696e69740000047374657000010a290202000b2400230241016a240223034180082802006a2403418010230236020041881023033602000b0028046e616d65020e020001000473656564010100016b07110202057374657073030770726573736573";

/// A fresh evidence store holding the counter's program; its SHA-256.
fn store(name: &str) -> (PathBuf, String) {
    let root = std::env::temp_dir().join(format!("deep-show-3379-{name}-{}", std::process::id()));
    let bytes: Vec<u8> = (0..COUNTER.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&COUNTER[i..i + 2], 16).expect("hex"))
        .collect();
    let sha = format!("{:x}", Sha256::digest(&bytes));
    std::fs::create_dir_all(root.join(&sha[..2])).expect("the store");
    std::fs::write(root.join(&sha[..2]).join(&sha[2..]), &bytes).expect("the program");
    (root, sha)
}

/// A board with `controls` whose logic item `counter` reads `press`.
fn board(sha: &str, controls: Value) -> Value {
    json!({"format": 1, "profile": "board", "title": "Counter", "description": "A counter that reads a press.",
        "size": [320, 200], "requires": {"modules": {"logic": "^1"}}, "controls": controls,
        "items": {"counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a0",
            "params": {"program": sha, "step_rate": 60, "reads": ["press"], "writes": {"presses": {"type": "i32"}}}}}})
}

fn press() -> Value {
    json!({"press": {"kind": "slider", "class": "document", "label": "Press", "role": "slider",
        "range": [0, 1], "default": 0, "increment": 1}})
}

/// `deep-show run` with the document `doc` (`{document}` for a shared one) and `calls`: replies.
fn run(name: &str, doc: Value, calls: impl Fn(&str) -> Vec<Value>) -> Vec<Value> {
    let (root, sha) = store(name);
    let mut entry = json!({"panel": "main"});
    if let Some(seed) = doc.get("document") {
        entry["document"] = seed.clone();
    }
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 3000, "ppid": 1, "start": 100}, {"pid": 4100, "ppid": 3000, "start": 1000}],
        "panels": {"main": {"rect": [0, 0, 1200, 800]}},
        "docs": {DOC: entry},
        "calls": calls(&sha),
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show runs");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show answers");
    std::fs::remove_dir_all(&root).ok();
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON answer");
    answer["replies"].as_array().expect("replies").clone()
}

fn show(document: Value) -> Value {
    json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": document, "include": ["issues"]})
}

fn refs_to(target: &str) -> Value {
    json!({"call": "deep_query", "session": "sess-alpha", "doc": DOC, "what": "refs_to", "target": target})
}

/// The reply is refused with a `ref_unresolved` at the read whose `actual` is `rows`.
fn refused_at_the_read(reply: &Value, rows: &Value) {
    assert_eq!(reply["outcome"], "refused", "{reply}");
    let at = reply["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|i| i["code"] == "ref_unresolved" && i["path"] == "items/counter/params/reads/0")
        .unwrap_or_else(|| panic!("a ref_unresolved at the read: {reply}"));
    assert_eq!(
        &at["actual"], rows,
        "the refusal lists the rows refs_to gave: {reply}"
    );
}

#[test]
fn a_sole_writers_revision_removing_a_read_control_is_refused_listing_its_readers() {
    let replies = run("sole", json!({}), |sha| {
        vec![
            show(board(sha, press())),
            refs_to("press"),
            json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": board(sha, json!({})),
                "removes": ["press"], "include": ["issues"]}),
        ]
    });
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    let rows = &replies[1]["rows"];
    assert_eq!(
        rows,
        &json!([{"row": "items/counter", "path": "items/counter/params/reads/0", "kind": "control"}])
    );
    refused_at_the_read(&replies[2], rows);
}

#[test]
fn a_patch_deleting_a_read_control_from_a_shared_document_is_refused_listing_its_readers() {
    let seed = json!({"format": 1, "profile": "board", "title": "Counter", "description": "A counter that reads a press.",
        "size": [320, 200], "requires": {"modules": {"logic": "^1"}},
        "layers": {"alpha-main": {"writer": WRITER, "title": "Alpha", "order": "a0"}}, "items": {}});
    let replies = run("shared", json!({"document": seed}), |sha| {
        vec![
            show(board(sha, press())),
            refs_to("press"),
            json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "patch": {"patch": PATCH, "doc": DOC,
                "base": 1, "reason": "remove the press", "ops": [{"op": "delete", "id": "press"}]}}),
        ]
    });
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    let rows = &replies[1]["rows"];
    assert_eq!(rows.as_array().map(Vec::len), Some(1), "{}", replies[1]);
    refused_at_the_read(&replies[2], rows);
}

#[test]
fn removing_a_read_control_lists_its_readers_and_not_an_items_of_the_same_id() {
    let with_group = |sha: &str, controls: Value| {
        let mut doc = board(sha, controls);
        doc["items"]["press"] =
            json!({"id": "press", "kind": "group@1", "name": "Press", "order": "a1", "params": {}});
        doc["items"]["dot"] = json!({"id": "dot", "kind": "circle@1", "name": "Dot", "order": "a2", "parent": "press",
            "params": {"center": [40, 60], "r": 8, "paint": {"fill": {"role": "accent"}}}});
        doc
    };
    let replies = run("shared-id", json!({}), |sha| {
        vec![
            show(with_group(sha, press())),
            refs_to("press"),
            json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": with_group(sha, json!({})),
                "removes": ["press"], "include": ["issues"]}),
        ]
    });
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    let paths: Vec<&Value> = replies[1]["rows"]
        .as_array()
        .expect("rows")
        .iter()
        .map(|r| &r["path"])
        .collect();
    assert_eq!(
        paths,
        [
            &json!("items/counter/params/reads/0"),
            &json!("items/dot/parent")
        ],
        "refs_to a bare ID gives both"
    );
    refused_at_the_read(
        &replies[2],
        &json!([{"row": "items/counter", "path": "items/counter/params/reads/0", "kind": "control"}]),
    );
}

#[test]
fn a_shared_revision_removing_an_item_lists_its_readers_and_not_a_controls_of_the_same_id() {
    let seed = json!({"format": 1, "profile": "board", "title": "Counter", "description": "A counter that reads a press.",
        "size": [320, 200], "requires": {"modules": {"logic": "^1"}},
        "layers": {"alpha-main": {"writer": WRITER, "title": "Alpha", "order": "a0"}}, "items": {}});
    let with_group = |sha: &str, group: bool| {
        let mut doc = board(sha, press());
        if group {
            doc["items"]["press"] = json!({"id": "press", "kind": "group@1", "name": "Press", "order": "a1", "params": {}});
        }
        doc["items"]["dot"] = json!({"id": "dot", "kind": "circle@1", "name": "Dot", "order": "a2", "parent": "press",
            "params": {"center": [40, 60], "r": 8, "paint": {"fill": {"role": "accent"}}}});
        doc
    };
    let replies = run("shared-item", json!({"document": seed}), |sha| {
        vec![
            show(with_group(sha, true)),
            json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": with_group(sha, false),
                "removes": ["press"], "include": ["issues"]}),
        ]
    });
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    let reply = &replies[1];
    assert_eq!(reply["outcome"], "refused", "{reply}");
    let at = reply["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|i| i["code"] == "ref_unresolved" && i["path"] == "items/dot/parent")
        .unwrap_or_else(|| panic!("a ref_unresolved at the dot's parent: {reply}"));
    assert_eq!(
        at["actual"],
        json!([{"row": "items/dot", "path": "items/dot/parent", "kind": "parent"}]),
        "the item's refusal lists the item's rows, not the control's read: {reply}"
    );
}
