//! #2662.671c059c (AC5): a live view stepped 1,000 times with no reader builds no record value,
//! counted by the test, and a bake of the same steps writes the record the merge base writes.
//!
//! The view is `deep_logic::live::View`, as `deep-logic`'s `view` call opens one, of one item at
//! 30 Hz: a pipelined item (Logic: work across steps), whose steps run on the view's logic thread,
//! which keeps no session bake, so nothing can read a record of its steps (README: Readings). The
//! view is given 1,000 frames, one a step, each waiting for its step to end. The record values
//! built meanwhile are read from `deep_logic::world::record_values()` (README: Surfaces); this
//! file holds one test, and the bake runs after the count is read, so nothing else adds to it.
//!
//! The steps ran: the last frame is at step 1,000, not stale, and the full-state hash the view
//! gives after step 899 is the one the bake's checkpoint at step 900 holds. The bake is
//! `deep-logic`'s `bake` call of the same piece and steps; its steps (each step's hash, fuel,
//! failed and pages, and each array's hash), checkpoints, traps and changed ranges, less the
//! times they took, are compared with the merge base's (fixtures/live-bake.json).

mod common;

use common::*;
use deep_logic::live::{Latched, View};
use deep_logic::{Logic, Planted};
use serde_json::{json, Value};

const ID: &str = "#2662.671c059c";
const STEPS: i64 = 1000;
/// The item's step, in flicks: 30 Hz.
const STEP: i64 = SECOND / 30;

/// Each step adds k to a mutable global, writes it to `g`, k + j x the global's low byte to
/// element j of `h` (16 f64s, linear), and adds 1 to `n`.
const PROGRAM: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (global $g (mut i64) (i64.const 1))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) (local $j i32)
    (global.set $g (i64.add (i64.mul (global.get $g) (i64.const 31)) (local.get $k)))
    (f64.store (i32.const 1024) (f64.convert_i64_s (global.get $g)))
    (loop $each
      (f64.store (i32.add (i32.const 1032) (i32.mul (local.get $j) (i32.const 8)))
        (f64.convert_i64_s (i64.add (local.get $k)
          (i64.mul (i64.extend_i32_u (local.get $j)) (i64.and (global.get $g) (i64.const 255))))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $j) (i32.const 16))))
    (i32.store (i32.const 1160) (i32.add (i32.load (i32.const 1160)) (i32.const 1)))))"#;

/// What a bake's reply holds of its record, less the times it took.
fn record_of(bake: &Value) -> Value {
    untimed(&json!({"steps": bake["steps"], "checkpoints": bake["checkpoints"], "traps": bake["traps"], "ranges": bake["ranges"]}))
}

#[test]
fn ac5_a_live_view_stepped_1000_times_with_no_reader_builds_no_record_value() {
    let bytes = program(PROGRAM);
    let writes = json!({"g": {"type": "f64"}, "h": {"type": "f64", "count": 16, "interpolate": "linear"}, "n": {"type": "i32"}});
    let params = json!({"step_rate": 30, "writes": writes, "checkpoint": {"every": 100}});
    let document = document(2662, json!({}), &[("p", &bytes, params)]);
    let piece = checked(&document);
    assert!(deep_logic::budget::pipelined(&piece.items[0]), "{ID}: the item runs pipelined, on the view's logic thread");
    assert_eq!(piece.items[0].write("n").map(|e| e.offset), Some(136), "{ID}: n follows g and h in the write region");

    let before = deep_logic::world::record_values();
    let (mut view, first) = View::open(json!({"piece": document}), None, Planted::default())
        .unwrap_or_else(|e| panic!("{ID}: the view opens: {e}"));
    assert_eq!(first["ok"], json!(true), "{ID}: the view's check passes: {first}");
    let (mut last, mut at_900) = (Value::Null, Value::Null);
    for k in 0..STEPS {
        let frame = Latched { t: k * STEP, set: None, hover: Vec::new(), baked: false };
        last = view.frame(frame).unwrap_or_else(|| panic!("{ID}: the view answers frame {k}"));
        if k == 899 {
            at_900 = last["deep_hash"]["p"].clone();
        }
    }
    let built = deep_logic::world::record_values() - before;
    drop(view);

    assert_eq!((&last["at"], &last["stale"]), (&json!(STEPS), &json!(false)), "{ID}: the view stepped {STEPS} times: {last}");
    assert_eq!(last["traps"], json!([]), "{ID}: the item never traps");

    let bake = Logic::new(Planted::default()).handle(&json!({"call": "bake", "piece": document, "steps": STEPS}));
    assert_eq!(bake["ok"], json!(true), "{ID}: the bake of the same steps runs: {}", bake.to_string().chars().take(400).collect::<String>());
    let record = record_of(&bake);
    if std::env::var_os("DEEP_2662_PRINT").is_some() {
        let hashes: Vec<Value> = record["steps"].as_array().into_iter().flatten().map(|s| s["items"]["p"]["hash"].clone()).collect();
        println!("FIXTURE live-bake.json {}", json!({"record_sha256": sha(&record), "step_hashes": hashes, "checkpoints": record["checkpoints"]}));
    }
    let checkpoint = record["checkpoints"]["p"].as_array().into_iter().flatten().find(|c| c["step"] == json!(900));
    assert_eq!(
        Some(&at_900),
        checkpoint.map(|c| &c["deep_hash"]),
        "{ID}: after step 899 the view holds the full state the bake's checkpoint at step 900 holds"
    );

    let base = fixture("live-bake.json");
    let hashes: Vec<Value> = record["steps"].as_array().into_iter().flatten().map(|s| s["items"]["p"]["hash"].clone()).collect();
    assert_eq!(hashes.len() as i64, STEPS, "{ID}: the bake holds {STEPS} steps");
    let wanted = base["step_hashes"].as_array().cloned().unwrap_or_default();
    assert_eq!(
        first_difference(&hashes, &wanted),
        None,
        "{ID}: a bake of the same steps writes the step hashes the merge base ({}) writes; the first step that differs",
        base["base"]
    );
    assert_eq!(record["checkpoints"], base["checkpoints"], "{ID}: the bake's checkpoints are the merge base's");
    assert_eq!(json!(sha(&record)), base["record_sha256"], "{ID}: the bake's steps, checkpoints, traps and ranges, less their times, are the merge base's");

    eprintln!("{ID}: the view's {STEPS} steps built {built} record values");
    assert_eq!(
        built, 0,
        "{ID}: a live view stepped {STEPS} times with no reader built {built} record values, each dropped unread, not none"
    );
}
