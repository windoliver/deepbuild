//! #1721: a document the hub minted, one its world stores no document for, is a shared document
//! from its first revision on the hub's canvas side: what #96 defines for patches, whole revisions,
//! undo, `read` and history holds on it, and the hub's record opens it again.
use std::io::{BufRead, BufReader, Lines, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB1721000000000000000001";
const PATCHES: [&str; 3] = [
    "01JB1721000000000000000011",
    "01JB1721000000000000000012",
    "01JB1721000000000000000013",
];

/// One canvas side on an evidence folder, its world naming DOC with what the record holds of it.
struct Side {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

impl Side {
    fn open(evidence: &Path, recorded: Value) -> Side {
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
            .arg("canvas")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("deep-show starts");
        let stdin = child.stdin.take().expect("stdin");
        let lines = BufReader::new(child.stdout.take().expect("stdout")).lines();
        let mut side = Side {
            child,
            stdin,
            lines,
        };
        let session = |n: &str| json!({"thread": format!("thread-{n}"), "name": n, "process": {"pid": 0, "start": 0}});
        let world = json!({"world": {"evidence": evidence, "record": {},
            "sessions": {"alpha": session("alpha"), "beta": session("beta")},
            "panels": {"main": {"rect": [0, 0, 800, 600]}},
            "docs": {DOC: {"panel": "main", "recorded": recorded}}}});
        assert_eq!(side.line(world)["ok"], json!(true), "the world is taken");
        side
    }
    fn line(&mut self, line: Value) -> Value {
        writeln!(self.stdin, "{line}").expect("written");
        serde_json::from_str(&self.lines.next().expect("an answer").expect("a line")).expect("JSON")
    }
    /// The call's reply, and the revision it presented as the hub would record it.
    fn call(&mut self, call: Value) -> (Value, Value) {
        let mut answer = self.line(json!({"call": call}));
        (answer["reply"].take(), answer["presented"].take())
    }
    fn show(&mut self, session: &str, items: Value) -> (Value, Value) {
        self.call(
            json!({"call": "deep_show", "session": session, "doc": DOC, "document": board(items)}),
        )
    }
    fn patch(&mut self, session: &str, id: &str, base: u64, ops: Value) -> (Value, Value) {
        let patch = json!({"patch": id, "doc": DOC, "base": base, "reason": "a test", "ops": ops});
        self.call(json!({"call": "deep_show", "session": session, "doc": DOC, "patch": patch}))
    }
    fn read(&mut self) -> Value {
        self.call(json!({"call": "read", "doc": DOC})).0
    }
}

impl Drop for Side {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn folder(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("deep-show-1721-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder");
    dir
}

fn board(items: Value) -> Value {
    json!({"format": 1, "profile": "board", "title": "Probe", "description": "A probe.", "size": [320, 200], "items": items})
}

fn rect(id: &str, x: u64) -> Value {
    json!({"id": id, "kind": "rect@1", "name": id, "order": "a0", "params": {"box": [x, 0, 40, 40], "paint": {"fill": {"role": "ink"}}}})
}

/// A presented revision as the hub's record holds it.
fn recorded(presented: &Value) -> Value {
    let w = &presented["writer"];
    let writer = format!(
        "{}:{}",
        w["kind"].as_str().unwrap(),
        w["id"].as_str().unwrap()
    );
    json!({"rev": presented["rev"], "writer": writer, "patch": presented["patch"], "hash": presented["hash"]})
}

/// `id`'s box's left edge as `read` gives it.
fn left(read: &Value, id: &str) -> Value {
    read["document"]["items"][id]["params"]["box"][0].clone()
}

#[test]
fn every_writers_layer_holds_and_the_record_opens_it_again() {
    let evidence = folder("layers");
    let mut side = Side::open(&evidence, json!([]));
    let (first, r1) = side.show("alpha", json!({"one": rect("one", 0)}));
    assert_eq!(first["rev"], json!(1), "{first}");

    // A refused whole revision takes the number 2: the patch on the last good one is revision 3.
    let (refused, _) = side.show("alpha", json!({"two": rect("two", 0)}));
    assert_eq!(
        refused["issues"][0]["code"],
        json!("unintended_removal"),
        "{refused}"
    );
    let moved = json!([{"op": "set", "id": "one", "path": "items/one/params/box", "value": [60, 0, 40, 40]}]);
    let (applied, r3) = side.patch("alpha", PATCHES[0], 1, moved);
    assert_eq!(
        (&applied["outcome"], &applied["rev"]),
        (&json!("applied"), &json!(3)),
        "{applied}"
    );
    assert_eq!(r3["patch"], json!(PATCHES[0]), "{r3}");

    // Another session's whole revision fills its own layer and leaves the first one's alone.
    let (theirs, r4) = side.show("beta", json!({"three": rect("three", 100)}));
    assert_eq!(
        (&theirs["outcome"], &theirs["created"]),
        (&json!("presented"), &json!(["three"])),
        "{theirs}"
    );
    let read = side.read();
    assert_eq!(read["draws"], json!(["one", "three"]), "{read}");
    assert_eq!(
        read["document"]["layers"].as_object().map(|l| l.len()),
        Some(2),
        "{read}"
    );

    // Neither session writes the other's item.
    let theirs =
        json!([{"op": "set", "id": "one", "path": "items/one/params/box", "value": [0, 0, 1, 1]}]);
    let (refused, kept) = side.patch("beta", PATCHES[1], 4, theirs);
    assert_eq!(
        refused["issues"][0]["code"],
        json!("not_your_layer"),
        "{refused}"
    );
    assert_eq!(kept, Value::Null, "a refused patch presents nothing");

    // A fresh canvas side opens it from the record, and undoes and patches it there.
    drop(side);
    let record = json!([recorded(&r1), recorded(&r3), recorded(&r4)]);
    let mut side = Side::open(&evidence, record.clone());
    let undo = json!({"patch": PATCHES[1], "of": PATCHES[0]});
    let (undone, r5) =
        side.call(json!({"call": "deep_show", "session": "alpha", "doc": DOC, "undo": undo}));
    assert_eq!(
        (&undone["outcome"], &undone["rev"]),
        (&json!("applied"), &json!(5)),
        "{undone}"
    );
    assert_eq!(left(&side.read(), "one"), json!(0));
    assert_eq!(left(&side.read(), "three"), json!(100));
    let history = side
        .call(json!({"call": "history", "doc": DOC, "item": "one"}))
        .0;
    let revs: Vec<Value> = history["history"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| r["rev"].clone())
        .collect();
    assert_eq!(revs, [json!(1), json!(3), json!(5)], "{history}");
    let stale = json!([{"op": "set", "id": "one", "path": "items/one/params/box", "value": [9, 0, 40, 40]}]);
    let (conflict, _) = side.patch("alpha", PATCHES[2], 3, stale);
    assert_eq!(conflict["outcome"], json!("conflict"), "{conflict}");

    // With its newest bytes gone the document stays shut, saying which.
    drop(side);
    let hash = r5["hash"].as_str().expect("a hash").to_string();
    std::fs::remove_file(evidence.join(&hash[..2]).join(&hash[2..])).expect("removed");
    let mut all = record.as_array().cloned().unwrap_or_default();
    all.push(recorded(&r5));
    let mut side = Side::open(&evidence, json!(all));
    for (reply, _) in [
        side.show("alpha", json!({"one": rect("one", 0)})),
        side.patch("alpha", PATCHES[2], 4, json!([])),
    ] {
        assert_eq!(
            (
                &reply["outcome"],
                &reply["issues"][0]["code"],
                &reply["issues"][0]["actual"]
            ),
            (&json!("refused"), &json!("asset_missing"), &json!(hash)),
            "{reply}"
        );
    }
    let _ = std::fs::remove_dir_all(&evidence);
}
