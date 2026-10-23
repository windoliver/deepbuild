//! The line's motion runs on the canvas core's low-level operators (#391 Scope): flat, typed
//! arrays and no heap allocation per frame after warm-up. A document compiles once into slots, and
//! each frame evaluates into a state sized up front; this counts the heap allocations the
//! evaluating thread makes over 600 frames. It lives beside the frame loop that calls it, since a
//! counting allocator needs `unsafe`, which the canvas crates' lint refuses.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<u64> = const { Cell::new(0) };
}

fn note() {
    if COUNTING.with(Cell::get) {
        COUNT.with(|c| c.set(c.get() + 1));
    }
}

// SAFETY: every call goes straight to the system allocator; the count is a const thread-local.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note();
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note();
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// The heap allocations `f` makes on this thread.
fn allocations(f: impl FnOnce()) -> u64 {
    COUNT.with(|c| c.set(0));
    COUNTING.with(|c| c.set(true));
    f();
    COUNTING.with(|c| c.set(false));
    COUNT.with(Cell::get)
}

fn fixture(path: &str) -> Value {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/acceptance/391/fixtures")
        .join(path);
    serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
}

/// Every motion feature at once: a spring and Bézier keys, an OKLab channel, a parent, a marker,
/// placements in series and staggered, and a cut between them.
fn everything() -> Value {
    let dot = |id: &str, extra: Value| {
        let mut d = json!({"id": id, "kind": "circle@1", "layer": "main", "params": {"center": [0, 0], "r": 4}});
        d.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        d
    };
    let slide = json!({"slots": {"target": {"type": "circle@1", "required": true}}, "span": "auto", "channels": {
        "x": {"target": "slot:target/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": {"spring": {"freq_hz": 2, "damping_ratio": 0.4}}},
            "b": {"t": "1s", "value": 100, "interp": "linear"}}}}});
    json!({
        "format": 1, "id": "alloc", "size": [200, 100], "seed": 3, "layers": {"main": {"order": "a0"}},
        "items": {"a": dot("a", json!({})), "b": dot("b", json!({})), "c": dot("c", json!({"parent": "a", "at": {"pos": [5, 5, 0]}}))},
        "markers": {"go": {"t": "0.5s", "kind": "cue"}},
        "channels": {
            "spin": {"target": "items/a/at/rot/2", "type": "f32", "keys": {
                "k0": {"t": "@go", "value": 0, "interp": {"bezier": {"x1": 0.4, "y1": 0, "x2": 0.2, "y2": 1}}},
                "k1": {"t": "@go+2s", "value": 90, "interp": "linear"}}},
            "tint": {"target": "items/b/adjust/tint", "type": "color", "space": "oklab", "keys": {
                "k0": {"t": "0s", "value": [0.2, 0, 0], "interp": "linear"}, "k1": {"t": "3s", "value": [0.9, 0.1, -0.1], "interp": "linear"}}}},
        "clips": {"slide": slide},
        "placements": {
            "one": {"clip": "slide", "slots": {"target": ["a", "b"]}, "start": "0s", "stagger": {"lag": 0.25, "order": "seeded"}},
            "two": {"clip": "slide", "slots": {"target": "b"}, "after": "one"}},
        "transitions": {"cut": {"from": "one", "to": "two", "kind": "cut"}},
    })
}

#[test]
fn a_frame_after_warm_up_allocates_nothing_while_the_json_path_does() {
    let docs = [
        fixture("still-figure.json"),
        fixture("parity/2d/patch-equals-rebuild.board"),
        fixture("parity/animation/subdivision-stable.film"),
        everything(),
    ];
    for doc in &docs {
        let program = Program::compile(doc.as_object().unwrap()).unwrap();
        let mut state = program.state();
        // Warm-up: the first frame.
        program.evaluate(0, Validity::Full, &mut state);
        let mut moved = 0.0;
        let count = allocations(|| {
            for k in 1..=600 {
                program.evaluate(k * 11_760_000, Validity::Full, &mut state);
                moved += state.slots.iter().sum::<f64>();
            }
        });
        assert_eq!(
            count, 0,
            "{}: frames after warm-up allocated {count} times",
            doc["id"]
        );
        assert!(
            moved.is_finite() && moved != 0.0,
            "{}: the frames evaluated something",
            doc["id"]
        );
    }
    // The counter sees allocations: the JSON frame, which builds maps, makes some per frame.
    let doc = everything();
    let program = Program::compile(doc.as_object().unwrap()).unwrap();
    let per_frame = allocations(|| {
        frame(
            doc.as_object().unwrap(),
            &program,
            11_760_000,
            Validity::Full,
        );
    });
    assert!(per_frame > 0, "the counter counts");
}
