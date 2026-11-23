//! #2662.bce5379f (AC1): a step of a world of 100 items with 64 KB of arrays each, in which one
//! item steps and writes, allocates under 256 KB, counted by the test. On the merge base it
//! allocates at least 6.4 MB (a copy of every item's arrays), and the test fails, naming the bytes.
//!
//! The world: 99 items `a00`..`a98` at 30 Hz and one item `z` at 120 Hz, each with 65,536 bytes of
//! arrays (`small`, one f64, and `big`, 8,191 f64s). Every item's step writes `small`; `z` reads
//! `a00.small`, copies it to its own `small` and writes one element of `big`. `z`'s steps 1, 2, 3
//! and 5 fall between the others' steps, so in them one item steps and writes. The world is built
//! as a live view builds one and stepped by time (`World::run_through`) on one record, as the
//! view's worker steps it; the step read is `z`'s step 5. Before it, a call that runs no step
//! lets the record take each item's arrays where it stands (the bake's whole arrays, which are the
//! record's, not the step's). The heap is this thread's: the bytes each allocation and
//! reallocation asks for.
//!
//! What `z` read at each step is the criterion's other half: the published arrays, as earlier
//! steps left them. `z` is last in the piece's order, so at steps 0 and 4, which `a00` runs at the
//! same time before it, it still reads what `a00`'s step before left.

mod common;

use common::*;
use deep_logic::world::Record;
use deep_logic::Planted;
use serde_json::{json, Value};

#[global_allocator]
static ALLOCATOR: Counting = Counting;

const ID: &str = "#2662.bce5379f";
const ITEMS: usize = 100;
const ARRAYS: usize = 65_536;
const LIMIT: u64 = 256 * 1024;
/// `z`'s step, in flicks: 120 Hz.
const STEP: i64 = SECOND / 120;

/// One of the 99: each step writes `small` = k + 7.
const SLOW: &str = r#"(module (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 65536))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64)
    (f64.store (i32.const 65536) (f64.add (f64.convert_i64_s (local.get $k)) (f64.const 7)))))"#;

/// `z`: each step copies `a00.small` as it read it (the read region's first entry) to its own
/// `small`, and writes k + 1 to element k of `big`.
const FAST: &str = r#"(module (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 65536))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64)
    (f64.store (i32.const 65536) (f64.load (i32.const 0)))
    (f64.store (i32.add (i32.const 65544) (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 8)))
      (f64.add (f64.convert_i64_s (local.get $k)) (f64.const 1)))))"#;

fn writes() -> Value {
    json!({"small": {"type": "f64", "count": 1}, "big": {"type": "f64", "count": 8191}})
}

#[test]
fn ac1_a_step_of_one_item_among_100_allocates_no_copy_of_every_items_arrays() {
    let (slow, fast) = (program(SLOW), program(FAST));
    let ids: Vec<String> = (0..ITEMS - 1).map(|i| format!("a{i:02}")).collect();
    let mut items: Vec<(&str, &[u8], Value)> =
        ids.iter().map(|id| (id.as_str(), &slow[..], json!({"step_rate": 30, "writes": writes()}))).collect();
    items.push(("z", &fast[..], json!({"step_rate": 120, "reads": ["a00.small"], "writes": writes()})));
    let piece = checked(&document(2662, json!({}), &items));

    // The world the criterion names, and where `z` reads and writes.
    assert_eq!(piece.items.len(), ITEMS, "{ID}: the world has {ITEMS} items");
    for item in &piece.items {
        assert_eq!(item.layout.size("writes") as usize, ARRAYS, "{ID}: {} has 64 KB of arrays", item.id);
    }
    let z = ITEMS - 1;
    assert_eq!(piece.items[z].id, "z", "{ID}: z is last in the piece's order");
    assert_eq!(piece.items[z].step, STEP, "{ID}: z steps at 120 Hz");
    let read = piece.items[z].layout.entries.iter().find(|e| e.region == "reads" && e.name == "a00.small");
    assert_eq!(read.map(|e| (e.offset, e.size)), Some((0, 8)), "{ID}: z's read region starts with a00.small");
    assert_eq!(piece.items[z].write("small").map(|e| e.offset), Some(0), "{ID}: small starts the write region");

    let mut rec = Record::default();
    let mut world = world(&piece, &[], Planted::default(), &mut rec);
    let small = |world: &deep_logic::world::World| world.array(z, "small").map(|v| v[0].clone());
    // Steps 0 to 4 of z; the others run steps 0 and 1 at z's steps 0 and 4.
    let mut read_at = Vec::new();
    for k in 0..5 {
        world.run_through(k * STEP, &mut rec);
        read_at.push(small(&world));
    }
    // No step: the record takes each item's arrays where it stands.
    world.run_through(4 * STEP, &mut rec);
    let steps_before = rec.rows().len();

    let (bytes, allocations) = heap(|| world.run_through(5 * STEP, &mut rec));

    read_at.push(small(&world));
    assert_eq!(rec.rows().len(), steps_before + 1, "{ID}: the call read ran one step");
    let ran: Vec<&String> = rec.rows().get(&5).map(|(items, _)| items.keys().collect()).unwrap_or_default();
    assert_eq!(ran, ["z"], "{ID}: in step 5 one item steps");
    assert_eq!(world.array(z, "big").map(|v| v[5].clone()), Some(json!(6.0)), "{ID}: z's step 5 writes its arrays");
    assert!(world.failed().is_empty(), "{ID}: no item traps: {:?}", world.failed());
    // a00.small is 0 before a00's step 0, 7 after it and 8 after its step 1.
    let wanted: Vec<Option<Value>> = [0.0, 7.0, 7.0, 7.0, 7.0, 8.0].iter().map(|v| Some(json!(v))).collect();
    assert_eq!(
        read_at, wanted,
        "{ID}: z's steps 0 to 5 read a00.small as earlier steps left it (a00 runs steps 0 and 1 at the times of z's steps 0 and 4, before z)"
    );
    eprintln!("{ID}: z's step 5 among {ITEMS} items of {ARRAYS} bytes of arrays each asked the heap for {bytes} bytes in {allocations} allocations");
    assert!(
        bytes < LIMIT,
        "{ID}: a step of a world of {ITEMS} items with {ARRAYS} bytes of arrays each, in which one item steps and writes, asked the heap for {bytes} bytes in {allocations} allocations ({:.2} copies of every item's arrays), not under {LIMIT} (256 KB)",
        bytes as f64 / (ITEMS * ARRAYS) as f64
    );
}
