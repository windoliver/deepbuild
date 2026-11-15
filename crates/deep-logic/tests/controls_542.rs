//! #542 (Control: text; Control: scroll): what a logic item finds in its read region for a text
//! control, whose one commit a step comes with its length and a second waits for the next step,
//! and for a scroll control, each entry's `i32 position, i32 delta`.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::rewrite;
use deep_logic::Logic;
use serde_json::{json, Value};

/// The read region's first `n` i32 words at each step, as a program that copies them out reads
/// them, on `track`, for a piece whose one control `c` is `control`.
fn words(control: Value, track: Value, n: usize, steps: i64) -> Vec<Vec<i64>> {
    let copy: String = (0..n)
        .map(|i| {
            format!(
                "(i32.store (i32.const {}) (i32.load (i32.const {})))",
                4096 + 4 * i,
                4 * i
            )
        })
        .collect();
    let program = wat::parse_str(format!(
        r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) {copy}))"#
    ))
    .expect("a program");
    let sha = rewrite::hash(&program);
    let params = json!({"program": sha, "step_rate": 60, "reads": ["c"], "writes": {"w": {"type": "i32", "count": n}}});
    let piece = json!({"seed": 0, "controls": {"c": control}, "assets": {&sha: B64.encode(&program)},
        "items": {"e": {"kind": "logic@1", "params": params}}});
    let reply = Logic::default()
        .handle(&json!({"call": "bake", "piece": piece, "track": track, "steps": steps}));
    let list = reply["steps"]
        .as_array()
        .unwrap_or_else(|| panic!("a bake: {reply}"));
    list.iter()
        .map(|s| {
            let w = s["arrays"]["e.w"]
                .as_array()
                .unwrap_or_else(|| panic!("e.w at a step: {s}"));
            w.iter().map(|v| v.as_i64().expect("an i32")).collect()
        })
        .collect()
}

fn entry(t: i64, value: Value) -> Value {
    json!({"t": t, "seq": 0, "control": "c", "value": value, "writer": "you", "player": 1})
}

#[test]
fn two_text_commits_in_one_step_reach_logic_one_a_step_each_with_its_length() {
    let text =
        json!({"kind": "text", "class": "document", "text": {"max_bytes": 16, "lines": "one"}});
    let track = json!([entry(1, json!("ab")), entry(2, json!("cde"))]);
    let w = words(text, track, 2, 4);
    let le = |b: &[u8]| b.iter().rev().fold(0i64, |a, x| a * 256 + i64::from(*x));
    // Step 0 reads nothing; step 1 the first commit, u32 2 then "ab"; step 2 the second, which
    // waited; step 3 nothing again.
    assert_eq!(w[0], [0, 0]);
    assert_eq!(w[1], [2, le(b"ab\0\0")]);
    assert_eq!(w[2], [3, le(b"cde\0")]);
    assert_eq!(w[3], [0, 0]);
}

#[test]
fn a_scroll_entry_reads_as_its_position_and_the_delta_from_the_one_before() {
    let scroll = json!({"kind": "scroll", "class": "document", "default": 5,
        "scroll": {"axis": "y", "step": 24, "range": [0, 190], "area": "list"}});
    let track = json!([
        entry(1, json!(6)),
        entry(2, json!(9)),
        entry(705_600_000 / 60 + 1, json!(0))
    ]);
    let w = words(scroll, track, 12, 3);
    // u32 count, 4 zero bytes, then each entry: u32 player, 4 zero bytes, i32 position, i32 delta.
    assert_eq!(w[1], [2, 0, 1, 0, 6, 1, 1, 0, 9, 3, 0, 0]);
    assert_eq!(w[2], [1, 0, 1, 0, 0, -9, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn a_track_entry_past_its_controls_cap_line_rule_or_range_is_refused() {
    let bake = |control: Value, value: Value| {
        let piece = json!({"seed": 0, "controls": {"c": control}, "items": {}});
        let track = json!([entry(1, value)]);
        Logic::default()
            .handle(&json!({"call": "bake", "piece": piece, "track": track, "steps": 1}))
    };
    let text = json!({"kind": "text", "text": {"max_bytes": 3, "lines": "one"}});
    let scroll = json!({"kind": "scroll", "scroll": {"range": [0, 190], "area": "list"}});
    assert_eq!(bake(text.clone(), json!("abc"))["ok"], true);
    for (c, v) in [
        (&text, json!("abcd")),
        (&text, json!("a\nb")),
        (&text, json!("a\rb")),
        (&scroll, json!(191)),
        (&scroll, json!(1.5)),
    ] {
        let r = bake(c.clone(), v.clone());
        assert_eq!(
            (r["ok"].clone(), r["what"].clone()),
            (json!(false), json!("track")),
            "{v}: {r}"
        );
    }
}
