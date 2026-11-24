//! What #2662's two fork files share: one item whose step can be sent to each of its limits by an
//! entry of its control, two forks of it, and the two checks: that a fork's memory changes only
//! when that fork steps (#2662.a74c0d37), and that a fork run to a limit traps while the other
//! steps on as a straight run does (#2662.393785f9). Each check returns its problems, each naming
//! the fork it is about; none on a logic module that keeps each fork's state its own.
#![allow(dead_code)]

use std::rc::Rc;

use deep_logic::piece::Piece;
use deep_logic::world::{Record, World};
use deep_logic::Planted;
use serde_json::{json, Value};

use crate::common::*;

/// The item's step, in flicks: 60 Hz.
pub const STEP: i64 = SECOND / 60;
/// The step the forks are made at, the step the entry that sends a fork to its limit is read at,
/// and the step the other fork is stepped to.
pub const FORKED: i64 = 10;
pub const LIMIT_AT: i64 = 12;
pub const UNTIL: i64 = 20;
const MEMORY: usize = 65_536;

/// Each step reads the control `mode`'s entries: with one of value 1 it loops until its fuel is
/// spent, with 2 it grows its memory past its limit, with 3 it reaches `unreachable`. Otherwise it
/// adds k to a mutable global and to `n`, and writes the global into its memory.
const PROGRAM: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (global $g (mut i64) (i64.const 1))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64)
    (if (i32.load (i32.const 0)) (then
      (if (f64.eq (f64.load (i32.const 16)) (f64.const 1)) (then (loop $spin (br $spin))))
      (if (f64.eq (f64.load (i32.const 16)) (f64.const 2)) (then (drop (memory.grow (i32.const 1)))))
      (if (f64.eq (f64.load (i32.const 16)) (f64.const 3)) (then (unreachable)))))
    (global.set $g (i64.add (i64.mul (global.get $g) (i64.const 31)) (local.get $k)))
    (i64.store (i32.add (i32.const 2048) (i32.mul (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 64))) (i32.const 8))) (global.get $g))
    (f64.store (i32.const 1024) (f64.convert_i64_s (global.get $g)))
    (i32.store (i32.const 1032) (i32.add (i32.load (i32.const 1032)) (i32.const 1)))))"#;

/// The one item `f`, reading the control `mode`.
pub fn piece() -> Rc<Piece> {
    let bytes = program(PROGRAM);
    let params = json!({"reads": ["mode"], "writes": {"g": {"type": "f64"}, "n": {"type": "i32"}}});
    let piece = checked(&document(2662, json!({"mode": {"kind": "slider"}}), &[("f", &bytes, params)]));
    let slot = piece.items[0].layout.entries.iter().find(|e| e.region == "reads" && e.name == "mode");
    assert_eq!(slot.map(|e| e.offset), Some(0), "the control's entries start the read region");
    piece
}

/// The item's whole memory, in hex.
fn memory(world: &mut World) -> String {
    world.peek("f", 0, MEMORY).expect("the item's memory")
}

/// Where two memories first differ, by byte.
fn differs(a: &str, b: &str) -> Option<usize> {
    a.bytes().zip(b.bytes()).position(|(x, y)| x != y).map(|at| at / 2)
}

/// A world of the item at step `FORKED` and two forks of it, A then B, on the same track.
fn forked(piece: &Rc<Piece>, planted: Planted, limit: Option<f64>) -> (World, World, World) {
    let mut rec = Record::default();
    let mut world = world(piece, &[], planted, &mut rec);
    world.run(FORKED, &mut rec, &mut |_, _| {});
    let to_limit: Vec<_> = limit.map(|v| entry("mode", LIMIT_AT * STEP, v)).into_iter().collect();
    let a = world.fork(&to_limit).unwrap_or_else(|e| panic!("fork A is made: {e}"));
    let b = world.fork(&[]).unwrap_or_else(|e| panic!("fork B is made: {e}"));
    (world, a, b)
}

/// #2662.a74c0d37: two forks of one item, stepped in turn; each one's memory changes only when it
/// steps. A problem names the fork whose memory changed while another stepped.
pub fn memories(planted: Planted) -> Vec<String> {
    let piece = piece();
    let (mut world, mut a, mut b) = forked(&piece, planted, None);
    let mut problems = Vec::new();
    let (from, a0, b0) = (memory(&mut world), memory(&mut a), memory(&mut b));
    if a0 != from || b0 != from {
        problems.push("a fork starts with another memory than the world it forked".to_string());
    }
    a.run(FORKED + 5, &mut Record::default(), &mut |_, _| {});
    let a1 = memory(&mut a);
    if a1 == a0 {
        problems.push("fork A's memory didn't change in its own five steps".to_string());
    }
    if let Some(at) = differs(&memory(&mut b), &b0) {
        problems.push(format!("fork B's memory changed while fork A stepped: byte {at} first"));
    }
    let b_before = memory(&mut b);
    b.run(FORKED + 3, &mut Record::default(), &mut |_, _| {});
    if memory(&mut b) == b_before {
        problems.push("fork B's memory didn't change in its own three steps".to_string());
    }
    if let Some(at) = differs(&memory(&mut a), &a1) {
        problems.push(format!("fork A's memory changed while fork B stepped: byte {at} first"));
    }
    if let Some(at) = differs(&memory(&mut world), &from) {
        problems.push(format!("the forked world's memory changed while its forks stepped: byte {at} first"));
    }
    problems
}

/// #2662.393785f9: fork A reads an entry at step `LIMIT_AT` that sends it to a limit (`value`),
/// where it traps with `kind`; fork B reads none and steps on to step `UNTIL`. Stepped in turn:
/// each fork's steps leave the rows (hash, fuel, pages) a straight run of the same track leaves,
/// A's to its trap and B's throughout, A stays failed and B never fails.
pub fn limits(planted: Planted, value: f64, kind: &str) -> Vec<String> {
    let piece = piece();
    let mut straight = Record::default();
    world(&piece, &[], Planted::default(), &mut straight).run(UNTIL, &mut straight, &mut |_, _| {});
    let (_, mut a, mut b) = forked(&piece, planted, Some(value));
    let (mut ra, mut rb) = (Record::default(), Record::default());
    let mut problems = Vec::new();
    // In turn: A to its limit's step, B beside it, A into its limit, B on.
    a.run(LIMIT_AT, &mut ra, &mut |_, _| {});
    b.run(LIMIT_AT, &mut rb, &mut |_, _| {});
    a.run(LIMIT_AT + 3, &mut ra, &mut |_, _| {});
    b.run(UNTIL, &mut rb, &mut |_, _| {});
    a.run(LIMIT_AT + 5, &mut ra, &mut |_, _| {});

    let traps: Vec<Value> =
        ra.traps.iter().map(|t| json!({"item": t["item"], "step": t["step"], "kind": t["kind"]})).collect();
    if traps != [json!({"item": "f", "step": LIMIT_AT, "kind": kind})] {
        problems.push(format!("fork A, run to its limit at step {LIMIT_AT}, traps {traps:?}, not once there with kind {kind}"));
    }
    if a.failed() != ["f"] {
        problems.push(format!("fork A isn't failed after its trap: {:?}", a.failed()));
    }
    for k in FORKED..LIMIT_AT + 5 {
        let got = row(&ra, k, "f");
        if k < LIMIT_AT && got != row(&straight, k, "f") {
            problems.push(format!("fork A's step {k}, before its limit, left {got}, not the straight run's {}", row(&straight, k, "f")));
        }
        if k >= LIMIT_AT && (got["failed"] != json!(true) || !got["hash"].is_null()) {
            problems.push(format!("fork A's step {k}, at or after its trap, left {got}, not a failed item's row"));
        }
    }
    if !rb.traps.is_empty() || !b.failed().is_empty() {
        problems.push(format!("fork B trapped, though only fork A ran to a limit: {:?}", rb.traps));
    }
    for k in FORKED..UNTIL {
        let (got, wanted) = (row(&rb, k, "f"), row(&straight, k, "f"));
        if got != wanted || got["hash"].is_null() {
            problems.push(format!("fork B's step {k} left {got}, not the straight run's {wanted}"));
        }
    }
    problems
}
