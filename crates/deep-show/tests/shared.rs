//! Shared documents' behavior past #96's acceptance tests (the issue's Patch and Writer connection
//! fields): an undo puts back only the paths its patch wrote, the marks module checks a patch as
//! it checks a whole revision, a result's issues stop at the read cap, a coalesce key keeps only
//! the latest patch, the writer's other quotas, and a view of the record is never patched.
//! Each drives `deep-show run` as the acceptance tests do.
use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB96D0000000000000000001";

fn patch_id(n: u32) -> String {
    format!("01JB96P{n:019}")
}

fn board() -> Value {
    json!({
        "format": 1, "profile": "board", "title": "Board", "description": "Shared.", "size": [640, 360],
        "layers": {
            "you-main": {"writer": "you:you", "title": "You", "order": "a0"},
            "alpha-main": {"writer": "agent:thread-alpha", "title": "Alpha", "order": "a1"}
        },
        "items": {
            "you.n1": {"id": "you.n1", "kind": "rect@1", "layer": "you-main", "name": "N1", "order": "a0",
                "params": {"box": [0, 0, 120, 48], "paint": {"fill": {"role": "muted"}}}, "at": {"pos": [40, 40, 0]}}
        }
    })
}

/// Plays `calls` (and `extra` scenario fields) on the board; one reply per call.
fn run(calls: Vec<Value>, extra: Value) -> Vec<Value> {
    run_on(board(), calls, extra)
}

fn run_on(document: Value, calls: Vec<Value>, extra: Value) -> Vec<Value> {
    let evidence = std::env::temp_dir().join(format!("deep-show-shared-{}", std::process::id()));
    let mut scenario = json!({
        "evidence": evidence,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 3002, "ppid": 1, "start": 3000}],
        "panels": {"main": {"rect": [0, 0, 640, 360]}},
        "docs": {DOC: {"panel": "main", "document": document}},
        "calls": calls,
    });
    for (k, v) in extra.as_object().expect("an object") {
        scenario[k] = v.clone();
    }
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
    answer["replies"].as_array().expect("replies").clone()
}

fn alpha(n: u32, base: u64, ops: Value) -> Value {
    json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC,
           "patch": {"patch": patch_id(n), "doc": DOC, "base": base, "reason": "test", "ops": ops}})
}

fn you(n: u32, base: u64, ops: Value) -> Value {
    json!({"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": DOC,
           "patch": {"patch": patch_id(n), "doc": DOC, "base": base, "reason": "test", "ops": ops}})
}

fn read() -> Value {
    json!({"call": "read", "doc": DOC})
}

fn codes(reply: &Value) -> Vec<String> {
    reply["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|i| i["code"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn an_undo_puts_back_only_the_paths_its_patch_wrote() {
    let recolor = you(
        1,
        0,
        json!([{"op": "set", "id": "you.n1", "path": "items/you.n1/params/paint", "value": {"fill": {"role": "ink"}}}]),
    );
    let moved = you(
        2,
        1,
        json!([{"op": "set", "id": "you.n1", "path": "items/you.n1/at/pos", "value": [300, 40, 0]}]),
    );
    let undo = json!({"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": DOC,
                      "undo": {"patch": patch_id(3), "of": patch_id(1)}});
    let r = run(vec![recolor, moved, undo, read()], json!({}));
    assert_eq!(r[2]["outcome"], json!("applied"), "{}", r[2]);
    let n1 = &r[3]["document"]["items"]["you.n1"];
    assert_eq!(
        n1["params"]["paint"]["fill"]["role"],
        json!("muted"),
        "the recolor is undone"
    );
    assert_eq!(
        n1["at"]["pos"],
        json!([300, 40, 0]),
        "and the later move stays"
    );
}

#[test]
fn an_undo_hands_back_an_item_your_patch_took() {
    let made = alpha(
        1,
        0,
        json!([{"op": "create", "item": {"id": "alpha.tag", "kind": "rect@1", "name": "Tag", "order": "a2",
        "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}}}]),
    );
    let took = you(
        2,
        1,
        json!([{"op": "set", "id": "alpha.tag", "path": "items/alpha.tag/params/paint", "value": {"fill": {"role": "muted"}}}]),
    );
    let undo = json!({"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": DOC,
                      "undo": {"patch": patch_id(3), "of": patch_id(2)}});
    let r = run(vec![made, took, read(), undo, read()], json!({}));
    assert_eq!(
        r[2]["document"]["items"]["alpha.tag"]["layer"],
        json!("you-main")
    );
    assert_eq!(r[3]["outcome"], json!("applied"), "{}", r[3]);
    let tag = &r[4]["document"]["items"]["alpha.tag"];
    assert_eq!(
        (
            tag["layer"].clone(),
            tag["params"]["paint"]["fill"]["role"].clone()
        ),
        (json!("alpha-main"), json!("ink"))
    );
}

#[test]
fn the_marks_module_refuses_a_patch_it_cannot_draw_and_counts_what_one_costs() {
    let bad = alpha(
        1,
        0,
        json!([{"op": "create", "item": {"id": "alpha.box", "kind": "rect@1", "name": "Box", "order": "a2",
        "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "no-such-role"}}}}}]),
    );
    let good = alpha(
        2,
        0,
        json!([{"op": "create", "item": {"id": "alpha.box", "kind": "rect@1", "name": "Box", "order": "a2",
        "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}}}]),
    );
    let r = run(vec![bad, good], json!({}));
    assert_eq!(r[0]["outcome"], json!("refused"), "{}", r[0]);
    assert!(r[0]["issues"][0]["ids"]
        .as_array()
        .unwrap()
        .contains(&json!("alpha.box")));
    assert_eq!(r[1]["outcome"], json!("applied"));
    assert_eq!(
        r[1]["cost_delta"]["vertices"],
        json!(4),
        "one rect is one quad"
    );
}

#[test]
fn a_results_issues_stop_at_the_read_cap_with_truncated() {
    let orphans: Vec<Value> = (0..300)
        .map(|i| json!({"op": "create", "item": {"id": format!("alpha.o{i}"), "kind": "rect@1", "name": "O", "order": "a2",
            "parent": "alpha.gone", "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}}}))
        .collect();
    let r = run(vec![alpha(1, 0, json!(orphans))], json!({}));
    assert_eq!(r[0]["outcome"], json!("refused"));
    let shown = r[0]["issues"].as_array().unwrap().len();
    assert_eq!(
        r[0]["truncated"]["total"],
        json!(300),
        "{}",
        r[0]["truncated"]
    );
    assert_eq!(r[0]["truncated"]["shown"], json!(shown));
    assert!(
        shown < 300
            && serde_json::to_string(&r[0]["issues"])
                .unwrap()
                .chars()
                .count()
                <= 8192
    );
}

#[test]
fn a_coalesce_key_keeps_only_the_latest_waiting_patch() {
    let drag = |n: u32, x: i64| {
        let mut call = alpha(
            n,
            0,
            json!([{"op": "create", "item": {"id": format!("alpha.d{n}"), "kind": "rect@1", "name": "D", "order": "a2",
            "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [x, 0, 0]}}}]),
        );
        call["patch"]["coalesce_key"] = json!("drag");
        call["at"] = json!(0);
        call
    };
    let clock = json!({"clock": {"refresh_hz": 60, "lead": 1_411_200, "check": 352_800}});
    let r = run(vec![drag(1, 1), drag(2, 2), drag(3, 3)], clock);
    let outcomes: Vec<&Value> = r.iter().map(|x| &x["outcome"]).collect();
    assert_eq!(
        outcomes,
        [
            &json!("superseded"),
            &json!("superseded"),
            &json!("applied")
        ]
    );
    assert_eq!(r[0]["superseded_by"], json!(patch_id(2)));
    assert_eq!(r[1]["superseded_by"], json!(patch_id(3)));
    assert_eq!(r[0]["current"], Value::Null);
}

#[test]
fn a_writers_quota_caps_its_message_bytes_items_and_documents() {
    let item = |id: &str| {
        json!({"op": "create", "item": {"id": id, "kind": "rect@1", "name": "I", "order": "a2",
        "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}}})
    };
    let quota = |q: Value| json!({"quotas": {"sess-alpha": q}});
    let r = run(
        vec![alpha(1, 0, json!([item("alpha.a")]))],
        quota(json!({"msg_bytes": 64})),
    );
    assert_eq!(codes(&r[0]), ["too_large"]);
    let r = run(
        vec![
            alpha(1, 0, json!([item("alpha.a")])),
            alpha(2, 1, json!([item("alpha.b")])),
        ],
        quota(json!({"items": 1})),
    );
    assert_eq!(
        (r[0]["outcome"].clone(), codes(&r[1])),
        (json!("applied"), vec!["over_quota".to_string()])
    );
    let r = run(
        vec![alpha(1, 0, json!([item("alpha.a")]))],
        quota(json!({"docs": 0})),
    );
    assert_eq!(codes(&r[0]), ["over_quota"]);
}

#[test]
fn a_view_of_the_record_is_never_patched() {
    let mut view = board();
    view["source"] = json!({"projections": ["tasks"], "append": "none"});
    let r = run_on(
        view,
        vec![you(
            1,
            0,
            json!([{"op": "set", "id": "you.n1", "path": "items/you.n1/at/pos", "value": [0, 0, 0]}]),
        )],
        json!({}),
    );
    assert_eq!(codes(&r[0]), ["record_view"]);
}
