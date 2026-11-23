//! What #2662's acceptance tests of `deep-logic` share: a piece from its programs' text, a world
//! as a live view builds one, and a counting allocator. Nothing here stands in for the logic
//! module. Written blind from the issue, the design and the base (README.md).
#![allow(dead_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::rc::Rc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_logic::piece::{self, History, Piece};
use deep_logic::world::{track_of, Entry, Given, Record, World};
use deep_logic::Planted;
use serde_json::{json, Map, Value};

/// Flicks a second (Units and axes: time).
pub const SECOND: i64 = 705_600_000;

/// The heap this thread asks for while counting: the bytes of each allocation and of each
/// reallocation's new size, and how many of either. Other threads never add to a reading.
pub struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static BYTES: Cell<u64> = const { Cell::new(0) };
    static CALLS: Cell<u64> = const { Cell::new(0) };
}

fn note(size: usize) {
    if COUNTING.with(Cell::get) {
        BYTES.with(|b| b.set(b.get() + size as u64));
        CALLS.with(|c| c.set(c.get() + 1));
    }
}

// SAFETY: every call goes straight to the system allocator; the counts are const thread-locals.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

/// What `f` asks the heap for on this thread: `(bytes, allocations)`.
pub fn heap(f: impl FnOnce()) -> (u64, u64) {
    BYTES.with(|b| b.set(0));
    CALLS.with(|c| c.set(0));
    COUNTING.with(|c| c.set(true));
    f();
    COUNTING.with(|c| c.set(false));
    (BYTES.with(Cell::get), CALLS.with(Cell::get))
}

/// A program's bytes from its text.
pub fn program(text: &str) -> Vec<u8> {
    wat::parse_str(text).unwrap_or_else(|e| panic!("the program assembles: {e}"))
}

/// A piece document: `items` in order (each `(id, program bytes, params)`; the program's hash is
/// put in the params), with `controls`.
pub fn document(seed: i64, controls: Value, items: &[(&str, &[u8], Value)]) -> Value {
    let (mut assets, mut list) = (Map::new(), Map::new());
    for (id, bytes, params) in items {
        let sha = deep_canvas_sandbox::rewrite::hash(bytes);
        assets.insert(sha.clone(), json!(B64.encode(bytes)));
        let mut params = params.clone();
        params["program"] = json!(sha);
        list.insert(id.to_string(), json!({"kind": "logic@1", "params": params}));
    }
    json!({"seed": seed, "controls": controls, "assets": assets, "items": list})
}

/// The document checked, as the logic module checks a piece.
pub fn checked(document: &Value) -> Rc<Piece> {
    let piece = piece::check(document, &Planted::default(), &mut History::new())
        .unwrap_or_else(|r| panic!("the piece is checked: {}", r.0));
    Rc::new(piece)
}

/// A world of the piece on `entries`, keeping its checkpoint ring, as a live view builds one.
pub fn world(piece: &Rc<Piece>, entries: &[Entry], planted: Planted, rec: &mut Record) -> World {
    World::new(piece.clone(), track_of(entries), true, planted, rec, None)
        .unwrap_or_else(|e| panic!("the world starts: {e}"))
}

/// An entry of `control` holding the number `value`, stamped at `t`.
pub fn entry(control: &str, t: i64, value: f64) -> Entry {
    Entry {
        t,
        seq: 0,
        control: control.into(),
        value: Given::Number(value),
        writer: "you".into(),
        player: 1,
        as_of: None,
        arrived: 0,
    }
}

/// Item `id`'s row of step `k` in a record, less the times it took (`*_ns`): its hash, fuel,
/// whether it has failed and the pages it marked.
pub fn row(rec: &Record, k: i64, id: &str) -> Value {
    let mut row = rec.rows().get(&k).and_then(|(items, _)| items.get(id)).cloned().unwrap_or(Value::Null);
    if let Some(o) = row.as_object_mut() {
        o.retain(|name, _| !name.ends_with("_ns"));
    }
    row
}

/// `v` with every time a run took removed, at any depth: fields named `ns` or `ms`, or ending
/// `_ns` or `_ms`, and a bake's `compares` and `budgets` readings.
pub fn untimed(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(k, _)| {
                    !(*k == "ns" || *k == "ms" || k.ends_with("_ns") || k.ends_with("_ms") || *k == "compares")
                })
                .map(|(k, v)| (k.clone(), untimed(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(untimed).collect()),
        other => other.clone(),
    }
}

/// The SHA-256 of `v`'s JSON text, in hex.
pub fn sha(v: &Value) -> String {
    use sha2::Digest as _;
    sha2::Sha256::digest(v.to_string().as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// This suite's fixture `name` (fixtures/), read when the test runs.
pub fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/acceptance/2662/fixtures").join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is JSON: {e}", path.display()))
}

/// The first index at which two lists differ, or where the shorter ends.
pub fn first_difference(a: &[Value], b: &[Value]) -> Option<usize> {
    (0..a.len().max(b.len())).find(|&i| a.get(i) != b.get(i))
}
