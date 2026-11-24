//! #2662.a74c0d37 (AC2, the count): a seek across 100 restores of one item compiles its module
//! once, counted by the test. On the merge base it compiles 100 times (once more for the world).
//!
//! One item, a checkpoint every 4 steps, stepped to step 400 as a live view steps it; then 100
//! seeks back (`World::seek`, the call a live view's scrub makes), to the checkpoints at steps
//! 396, 392, ... 0, each followed by two steps. The compiles are read from
//! `deep_sandbox_wasmtime::compiles()` (README: Surfaces) across the world's whole life: its
//! start and the 100 restores. This file holds one test, so no other thread compiles in its count.
//!
//! Each restore is also checked to be the state it restores: the full-state hash right after the
//! seek is the one the straight run recorded at that checkpoint, and the two steps after it leave
//! the rows (hash, fuel, pages) the straight run's steps left.

mod common;

use common::*;
use deep_logic::world::Record;
use deep_logic::Planted;
use serde_json::{json, Value};

const ID: &str = "#2662.a74c0d37";
const EVERY: i64 = 4;
const RESTORES: i64 = 100;

/// Each step adds k to a mutable global and to `n`, and writes the global at 8 x (k mod 64) from 2048.
const PROGRAM: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (global $g (mut i64) (i64.const 1))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64)
    (global.set $g (i64.add (i64.mul (global.get $g) (i64.const 31)) (local.get $k)))
    (i64.store (i32.add (i32.const 2048) (i32.mul (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 64))) (i32.const 8))) (global.get $g))
    (f64.store (i32.const 1024) (f64.convert_i64_s (global.get $g)))
    (i32.store (i32.const 1032) (i32.add (i32.load (i32.const 1032)) (i32.wrap_i64 (local.get $k))))))"#;

#[test]
fn ac2_a_seek_across_100_restores_of_one_item_compiles_its_module_once() {
    let bytes = program(PROGRAM);
    let params = json!({"writes": {"g": {"type": "f64"}, "n": {"type": "i32"}}, "checkpoint": {"every": EVERY}});
    let piece = checked(&document(2662, json!({}), &[("e", &bytes, params)]));

    let before = deep_sandbox_wasmtime::compiles();
    let mut straight = Record::default();
    let mut world = world(&piece, &[], Planted::default(), &mut straight);
    world.run(RESTORES * EVERY + 2, &mut straight, &mut |_, _| {});
    let started = deep_sandbox_wasmtime::compiles();
    let deep: std::collections::BTreeMap<i64, String> = straight.deep("e").into_iter().collect();
    let held = world.checkpoint_steps();
    assert!(
        (0..RESTORES).all(|j| held.contains(&(j * EVERY)) && deep.contains_key(&(j * EVERY))),
        "{ID}: the ring holds a checkpoint every {EVERY} steps to step {}: {held:?}",
        RESTORES * EVERY
    );

    let mut problems = Vec::new();
    for j in (0..RESTORES).rev() {
        let c = j * EVERY;
        world.seek(c).unwrap_or_else(|e| panic!("{ID}: the seek to step {c} restores: {e}"));
        let now = world.deep_hashes().get("e").cloned().unwrap_or(Value::Null);
        if now != json!(deep[&c]) {
            problems.push(format!("the restore at step {c} holds the full-state hash {now}, not the straight run's {}", deep[&c]));
        }
        let mut again = Record::default();
        world.run(c + 2, &mut again, &mut |_, _| {});
        for k in [c, c + 1] {
            let (a, b) = (row(&again, k, "e"), row(&straight, k, "e"));
            if a != b || a.get("hash").is_none_or(Value::is_null) {
                problems.push(format!("step {k} after the restore at step {c} left {a}, not the straight run's {b}"));
            }
        }
    }
    assert!(problems.is_empty(), "{ID}: a seek restores the state the straight run had: {problems:?}");
    assert!(world.failed().is_empty(), "{ID}: the item never traps");

    let ended = deep_sandbox_wasmtime::compiles();
    let (all, in_restores) = (ended - before, ended - started);
    eprintln!("{ID}: one item's world and {RESTORES} restores compiled {all} modules, {in_restores} of them in the restores");
    assert_eq!(
        all, 1,
        "{ID}: a seek across {RESTORES} restores of one item compiled its module {in_restores} times in the restores, {all} times with the world's own start, not once"
    );
}
