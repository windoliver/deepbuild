//! Logic items in the canvas (#533): the logic module's step reads the played form's input track,
//! a trapped item is marked failed with logic.trap, and a build that holds physics never says it
//! holds none; on a piece that declares rewind, back is a rewind whose frames fold the current
//! branch with what was seen (#860). Drives `deep-show run` as the acceptance tests do.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DOC: &str = "01JB533C000000000000000001";
const F: i64 = 705_600_000;

/// crates/deep-logic/src/fixture.wat: writes `steps` (the steps run) at 0 and `presses` (the sum
/// of each step's entry counts, the u32 at the read region's start) at 8.
const COUNTER: &str = "0061736d0100000001050160017e0003030200000504010101010617047f004180080b7f004180100b7f0141000b7f0141000b072f05066d656d6f727902000872656164735f61740300097772697465735f6174030104696e69740000047374657000010a290202000b2400230241016a240223034180082802006a2403418010230236020041881023033602000b0028046e616d65020e020001000473656564010100016b07110202057374657073030770726573736573";
/// `(func (export "step") (param $k i64) (i32.store (i32.const 2048) (i32.wrap_i64 (local.get $k)))
/// (if (i64.ge_u (local.get $k) (i64.const 2)) (then unreachable)))`, with an empty `init` and the
/// fixture's memory and region exports: it writes `k`, then traps from step 2 on.
const TRAP: &str = "0061736d0100000001050160017e000303020000050401010101060d027f004180080b7f004180100b072f05066d656d6f727902000872656164735f61740300097772697465735f6174030104696e69740000047374657000010a190202000b14004180102000a7360200200042025a0440000b0b0015046e616d65020e020001000473656564010100016b";
/// COUNTER with its step body `steps += 1; i32.store 2048 steps; i32.store 2056 (i32.load 2056 +
/// i32.load 1024)`: `presses` is tallied in memory, as a seen array is kept, so a value put there
/// stays through the steps after it.
const TALLY: &str = "0061736d0100000001050160017e0003030200000504010101010617047f004180080b7f004180100b7f0141000b7f0141000b072f05066d656d6f727902000872656164735f61740300097772697465735f6174030104696e69740000047374657000010a290202000b2400230241016a240241801023023602004188104188102802004180082802006a3602000b0028046e616d65020e020001000473656564010100016b07110202057374657073030770726573736573";

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

/// A fresh evidence store holding `program`; its SHA-256.
fn store(name: &str, program: &str) -> (PathBuf, String) {
    let root = std::env::temp_dir().join(format!("deep-show-logic-{name}-{}", std::process::id()));
    let bytes = unhex(program);
    let sha = format!("{:x}", Sha256::digest(&bytes));
    std::fs::create_dir_all(root.join(&sha[..2])).expect("the store");
    std::fs::write(root.join(&sha[..2]).join(&sha[2..]), &bytes).expect("the program");
    (root, sha)
}

/// A one-second board at 60 fps whose items are `items`, with `controls`.
fn board(items: Value, controls: Value) -> Value {
    json!({"format": 1, "profile": "board", "seed": 533, "title": "Logic", "description": "A logic item in the canvas.",
        "size": [64, 36], "transport": {"span": "1s", "frame_rate": [60, 1]}, "controls": controls, "items": items})
}

/// `deep-show run` over the document presented and then `calls`: the presentation's reply and
/// the calls' replies.
fn run(root: &Path, doc: &Value, calls: Vec<Value>) -> (Value, Vec<Value>) {
    let mut all = vec![
        json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": doc, "include": ["issues"]}),
    ];
    all.extend(calls);
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "panels": {"main": {"rect": [0, 0, 800, 600]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": all,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show runs");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show answers");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON answer");
    let replies = answer["replies"].as_array().expect("replies").clone();
    (replies[0].clone(), replies[1..].to_vec())
}

#[test]
fn a_press_on_the_input_track_reaches_the_logic_item_that_reads_it() {
    let (root, sha) = store("press", COUNTER);
    let doc = board(
        json!({"counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "reads": ["press"], "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}}),
        json!({"press": {"kind": "press", "class": "document", "label": "Press", "role": "button"}}),
    );
    let press = json!({"t": F / 4, "seq": 0, "control": "press", "value": 1, "writer": "you"});
    let (shown, replies) = run(
        &root,
        &doc,
        vec![
            json!({"call": "eval", "doc": DOC, "t": F / 2, "arrays": ["counter.presses"], "track": [press]}),
        ],
    );
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(shown["outcome"], "presented", "{shown}");
    assert_eq!(
        replies[0]["arrays"]["counter.presses"],
        json!(1),
        "the press at 0.25 s is counted by 0.5 s: {}",
        replies[0]
    );
}

#[test]
fn a_logic_item_that_traps_is_marked_failed_with_logic_trap() {
    let (root, sha) = store("trap", TRAP);
    let doc = board(
        json!({"trap": {"id": "trap", "kind": "logic@1", "name": "Trap", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "writes": {"k": {"type": "i32"}}}}}),
        json!({}),
    );
    let (_, replies) = run(
        &root,
        &doc,
        vec![json!({"call": "eval", "doc": DOC, "t": F / 2, "arrays": ["trap.k"]})],
    );
    std::fs::remove_dir_all(&root).ok();
    // A trap stops only that item, its arrays keeping the last step's values, and marks it
    // failed with logic.trap (Logic: Semantics): the frame raises that error on the item.
    let reply = &replies[0];
    let trapped = reply["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|i| i["code"] == "logic.trap" && i["severity"] == "error" && i["path"] == "trap");
    assert!(trapped, "a logic.trap error on the item trap: {reply}");
}

#[test]
fn a_trapped_item_stays_failed_on_frames_between_its_steps() {
    let (root, sha) = store("trap-stays", TRAP);
    let doc = board(
        json!({"trap": {"id": "trap", "kind": "logic@1", "name": "Trap", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "writes": {"k": {"type": "i32"}}}}}),
        json!({}),
    );
    // The second and third frames come one and two flicks after the first: no step is due on
    // either, and the item is as failed as it was.
    let eval = |t: i64| json!({"call": "eval", "doc": DOC, "t": t, "arrays": ["trap.k"]});
    let (_, replies) = run(
        &root,
        &doc,
        vec![eval(F / 2), eval(F / 2 + 1), eval(F / 2 + 2)],
    );
    std::fs::remove_dir_all(&root).ok();
    for (n, reply) in replies.iter().enumerate() {
        let trapped =
            reply["issues"].as_array().into_iter().flatten().any(|i| {
                i["code"] == "logic.trap" && i["severity"] == "error" && i["path"] == "trap"
            });
        assert!(
            trapped,
            "a logic.trap error on the item trap in frame {n}: {reply}"
        );
    }
}

#[test]
fn a_seek_back_onto_a_checkpoint_shows_the_trap_playing_there_shows() {
    let (root, sha) = store("trap-seek", TRAP);
    let doc = board(
        json!({"trap": {"id": "trap", "kind": "logic@1", "name": "Trap", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "writes": {"k": {"type": "i32"}}}}}),
        json!({}),
    );
    // Two steps past the checkpoint at half a second, then back to a flick after it: the seek
    // restores that checkpoint and runs no step, and the item is as failed as when played there.
    // Then back to a flick after the start, where no step is due either: the checkpoint at the
    // start holds no error, and neither does the frame.
    let eval = |t: i64| json!({"call": "eval", "doc": DOC, "t": t, "arrays": ["trap.k"]});
    let times = [F / 2 + 2 * (F / 60), F / 2 + 1, 1];
    let (_, replies) = run(&root, &doc, times.map(eval).to_vec());
    std::fs::remove_dir_all(&root).ok();
    for (reply, wanted) in replies.iter().zip([true, true, false]) {
        let trapped =
            reply["issues"].as_array().into_iter().flatten().any(|i| {
                i["code"] == "logic.trap" && i["severity"] == "error" && i["path"] == "trap"
            });
        assert_eq!(
            trapped, wanted,
            "a logic.trap error on the item trap: {reply}"
        );
    }
}

#[test]
fn a_program_name_that_is_no_hash_is_an_issue_and_no_crash() {
    let (root, _) = store("no-hash", TRAP);
    // 64 bytes with a two-byte letter across the store's folder split.
    let program = format!("a\u{e9}{}", "0".repeat(61));
    let doc = board(
        json!({"odd": {"id": "odd", "kind": "logic@1", "name": "Odd", "order": "a1", "params": {
            "program": program, "writes": {"k": {"type": "i32"}}}}}),
        json!({}),
    );
    let (shown, _) = run(&root, &doc, vec![]);
    std::fs::remove_dir_all(&root).ok();
    let named = shown["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|i| i.to_string().contains("odd"));
    assert!(named, "an issue naming the item odd: {shown}");
}

#[test]
fn a_build_with_physics_never_says_it_holds_none() {
    let (root, sha) = store("physics", COUNTER);
    let doc = board(
        json!({"watcher": {"id": "watcher", "kind": "logic@1", "name": "Watcher", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "reads": ["lab.occurrences"], "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}}),
        json!({}),
    );
    let (shown, _) = run(&root, &doc, Vec::new());
    std::fs::remove_dir_all(&root).ok();
    assert!(
        !shown.to_string().contains("holds no physics module"),
        "the full build holds physics: {shown}"
    );
}

// #860: on a presented piece that declares rewind, back (← or Page Up) is the reader's: a rewind
// to the stop before. The frames after it fold the current branch, with what the closed one saw.

const MS: i64 = F / 1000;
const DISPLAY: &str = "37D8832A-2D66-02CA-B9F7-8F30A301B230";

/// `deep-show run` over `calls`, in time order, in a room with one display (#400) and its clock;
/// each call's reply.
fn run_room(root: &Path, calls: &[Value]) -> Vec<Value> {
    let scenario = json!({
        "evidence": root,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "clock": {"lead": 2 * MS, "check": MS / 2},
        "displays": [{"uuid": DISPLAY, "bounds": [0, 0, 1512, 982], "scale": 2, "refresh_hz": 120, "next_vsync": F / 120, "color_space": "p3"}],
        "window": [1200, 700],
        "panels": {"main": {"rect": [0, 0, 960, 540]}},
        "docs": {DOC: {"panel": "main"}},
        "calls": calls,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show runs");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show answers");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON answer");
    answer["replies"].as_array().expect("replies").clone()
}

fn input(ms: i64, event: Value) -> Value {
    json!({"call": "input", "at": ms * MS, "panel": "main", "event": event})
}

fn press(ms: i64) -> Value {
    input(
        ms,
        json!({"type": "control", "control": "press", "value": 1}),
    )
}

fn key(ms: i64, key: &str) -> Value {
    input(ms, json!({"type": "key", "key": key, "mods": []}))
}

/// The frame at `ms`: the counter's presses as it draws them.
fn presses_at(ms: i64) -> Value {
    json!({"call": "eval", "at": ms * MS, "doc": DOC, "t": ms * MS, "arrays": ["counter.presses"]})
}

/// A counter on a turn clock (a step runs only for a press), every step of which is a stop, with a
/// stage at the start so that full screen presents it; its presses are its seen when `seen`.
fn rewinding(sha: &str, seen: bool) -> Value {
    let mut doc = board(
        json!({"counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a1", "params": {
            "program": sha, "step_rate": 60, "clock": "on_input", "reads": ["press"],
            "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}}),
        json!({"press": {"kind": "press", "class": "document", "label": "Press", "role": "button"}}),
    );
    doc["transport"]["span"] = json!("2s");
    doc["markers"] = json!({"start": {"kind": "stage", "name": "Start", "t": "0s"}});
    doc["rewind"] = json!({"stops": "counter.steps", "depth": 8});
    if seen {
        doc["rewind"]["seen"] = json!("counter.presses");
    }
    doc
}

/// The piece shown, your click in its panel and its pop-out full screen, which presents it (Marker:
/// present mode), then `calls`: their replies.
fn presenting(root: &Path, doc: &Value, calls: &[Value]) -> Vec<Value> {
    let mut all = vec![
        json!({"call": "deep_show", "at": 2 * MS, "session": "sess-alpha", "doc": DOC, "document": doc, "include": ["issues"]}),
        input(100, json!({"type": "down", "pos": [480, 270]})),
        input(160, json!({"type": "up", "pos": [480, 270]})),
    ];
    let serial = run_room(root, &all)[1]["serial"].clone();
    all.push(json!({"call": "pop_out", "at": 200 * MS, "panel": "main", "display": DISPLAY, "serial": serial, "full_screen": true}));
    all.extend(calls.iter().cloned());
    let replies = run_room(root, &all);
    assert_eq!(replies[0]["outcome"], "presented", "{}", replies[0]);
    replies[4..].to_vec()
}

#[test]
fn back_on_a_piece_that_declares_rewind_is_a_rewind_and_its_frames_fold_the_current_branch() {
    let (root, sha) = store("rewind-back", COUNTER);
    // Three presses, back, and one more: the third press is left on a closed branch.
    let r = presenting(
        &root,
        &rewinding(&sha, false),
        &[
            key(300, "ArrowRight"),
            press(400),
            press(600),
            press(800),
            key(1000, "ArrowLeft"),
            press(1200),
            presses_at(1400),
        ],
    );
    std::fs::remove_dir_all(&root).ok();
    let back = &r[4]["appended"];
    assert_eq!(
        back.as_array().map(Vec::len),
        Some(1),
        "back appends one entry: {}",
        r[4]
    );
    assert_eq!(
        back[0]["rewind"],
        json!({"to": {"stop": 1}}),
        "back is a rewind to the stop before: {}",
        r[4]
    );
    // A fresh play of the current branch (the first two presses and the one after back) counts
    // 3; the closed branch's press would make it 4.
    assert_eq!(r[6]["arrays"]["counter.presses"], json!(3), "{}", r[6]);
}

#[test]
fn what_the_closed_branch_saw_is_drawn_after_back() {
    let (root, sha) = store("rewind-seen", TALLY);
    // The presses are the piece's seen: after back, the frame shows the 3 the closed branch
    // counted, where a fresh play of the current branch's two presses shows 2.
    let r = presenting(
        &root,
        &rewinding(&sha, true),
        &[
            key(300, "ArrowRight"),
            press(400),
            press(600),
            press(800),
            key(1000, "ArrowLeft"),
            presses_at(1100),
        ],
    );
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(
        r[4]["appended"][0]["rewind"],
        json!({"to": {"stop": 1}}),
        "back is a rewind to the stop before: {}",
        r[4]
    );
    assert_eq!(r[5]["arrays"]["counter.presses"], json!(3), "{}", r[5]);
}
