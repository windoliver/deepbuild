//! #2662.7a6f9cf9 (AC6, the goldens): every logic golden hashes the same as on the merge base.
//! The criterion's suites and budgets are run as they stand (README: Run them); this file adds
//! the one thing they can't show, since each records its golden and verifies it in one run: a
//! golden recorded on the merge base, kept as a fixture, that the change's own bake must match
//! step for step and checkpoint for checkpoint.
//!
//! The piece: `a` (60 Hz) reads the control `wind` and the step's seed; `b` (60 Hz) reads `a.x`
//! and writes a linear array; `c` (60 Hz) reads `a.x` and `b.y` (a golden needs every item at one
//! step rate). `a`, `b` and `c` run in that order at one time, so `b` and `c` read arrays another
//! item of their own group has just written over: what each reads must be what the steps before
//! left. 240 steps, a checkpoint every 30,
//! with four entries of `wind`. `golden` records it and `golden_verify` judges the fixture's
//! golden against this build's bake. The second test runs the same comparison on a wrong program
//! the base already has, `Planted::replay_changes_step_37`, which must fail it naming step 37.

mod common;

use common::*;
use deep_logic::{Logic, Planted};
use serde_json::{json, Value};

const ID: &str = "#2662.7a6f9cf9";
const STEPS: i64 = 240;

/// Each step folds the first `reads` bytes of its read region and k into a mutable global, and
/// writes `count` f64s from it: element j is the global's low 20 bits plus j.
fn mixer(reads: u32, count: u32) -> Vec<u8> {
    program(&format!(
        r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096))
  (global $g (mut i64) (i64.const 7))
  (func (export "init") (param $seed i64) (global.set $g (i64.and (local.get $seed) (i64.const 1023))))
  (func (export "step") (param $k i64) (local $j i32)
    (loop $read
      (global.set $g (i64.add (i64.mul (global.get $g) (i64.const 1099511628211)) (i64.load (local.get $j))))
      (local.set $j (i32.add (local.get $j) (i32.const 8)))
      (br_if $read (i32.lt_u (local.get $j) (i32.const {reads}))))
    (global.set $g (i64.xor (global.get $g) (local.get $k)))
    (local.set $j (i32.const 0))
    (loop $write
      (f64.store (i32.add (i32.const 4096) (i32.mul (local.get $j) (i32.const 8)))
        (f64.convert_i64_u (i64.add (i64.and (global.get $g) (i64.const 1048575)) (i64.extend_i32_u (local.get $j)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $write (i32.lt_u (local.get $j) (i32.const {count}))))))"#
    ))
}

fn line(call: &str) -> Value {
    let (a, b, c) = (mixer(512, 8), mixer(128, 8), mixer(256, 4));
    let items: [(&str, &[u8], Value); 3] = [
        ("a", &a, json!({"reads": ["wind"], "writes": {"x": {"type": "f64", "count": 8}}, "checkpoint": {"every": 30}})),
        ("b", &b, json!({"reads": ["a.x"], "writes": {"y": {"type": "f64", "count": 8, "interpolate": "linear"}}, "checkpoint": {"every": 30}})),
        ("c", &c, json!({"reads": ["a.x", "b.y"], "writes": {"z": {"type": "f64", "count": 4}}, "checkpoint": {"every": 30}})),
    ];
    let piece = document(2662, json!({"wind": {"kind": "slider"}}), &items);
    let entry = |step: i64, value: f64| json!({"t": step * SECOND / 60, "seq": 0, "control": "wind", "value": value, "writer": "you", "player": 1});
    json!({"call": call, "piece": piece, "steps": STEPS, "track": [entry(3, 0.25), entry(37, -1.5), entry(38, 4.0), entry(200, 0.125)]})
}

/// The golden this build records for the piece, or the logic module's refusal.
fn golden(planted: Planted) -> Value {
    let reply = Logic::new(planted).handle(&line("golden"));
    assert_eq!(reply["ok"], json!(true), "{ID}: the golden is recorded: {}", reply.to_string().chars().take(400).collect::<String>());
    reply["golden"].clone()
}

/// Where this build's golden differs from the merge base's: each item's first step whose hash
/// differs and first checkpoint that differs.
fn problems(golden: &Value, base: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for id in ["a", "b", "c"] {
        let list = |g: &Value, field: &str| g[field][id].as_array().cloned().unwrap_or_default();
        let (now, then) = (list(golden, "step_hashes"), list(base, "step_hashes"));
        if then.is_empty() {
            out.push(format!("the fixture holds no step hashes of {id}"));
        }
        if let Some(k) = first_difference(&now, &then) {
            out.push(format!("{id}'s step {k} hashes {}, not the merge base's {}", now.get(k).unwrap_or(&Value::Null), then.get(k).unwrap_or(&Value::Null)));
        }
        let (now, then) = (list(&untimed(golden), "checkpoint_hashes"), list(&untimed(base), "checkpoint_hashes"));
        if let Some(n) = first_difference(&now, &then) {
            out.push(format!("{id}'s checkpoint {n} is {}, not the merge base's {}", now.get(n).unwrap_or(&Value::Null), then.get(n).unwrap_or(&Value::Null)));
        }
    }
    if golden["occurrences_hash"] != base["occurrences_hash"] {
        out.push("the occurrences hash differs from the merge base's".to_string());
    }
    out
}

#[test]
fn ac6_a_golden_recorded_on_the_merge_base_matches_step_for_step() {
    let base = fixture("golden.json");
    let now = golden(Planted::default());
    if std::env::var_os("DEEP_2662_PRINT").is_some() {
        println!("FIXTURE golden.json {now}");
    }
    let found = problems(&now, &base["golden"]);
    assert!(found.is_empty(), "{ID}: every logic golden hashes as on the merge base ({}): {found:?}", base["base"]);
    let mut verify = line("golden_verify");
    verify["golden"] = base["golden"].clone();
    let verdict = Logic::new(Planted::default()).handle(&verify);
    assert_eq!(
        verdict["verdict"],
        json!("PASS"),
        "{ID}: the merge base's golden verifies against this build's bake: {}",
        verdict.to_string().chars().take(600).collect::<String>()
    );
}

#[test]
fn ac6_planted_replay_changes_step_37_fails_the_merge_bases_golden_naming_step_37() {
    let base = fixture("golden.json");
    let planted = Planted { replay_changes_step_37: true, ..Planted::default() };
    let found = problems(&golden(planted), &base["golden"]);
    eprintln!("{ID}: planted replay_changes_step_37 fails with: {found:?}");
    assert!(
        found.iter().any(|p| p.starts_with("a's step 37 hashes ")),
        "{ID}: a logic module whose step 37 changes one value fails the merge base's golden, naming a's step 37; its problems: {found:?}"
    );
}
