//! Evaluating a scene reads the document it is given: what it allocates doesn't grow with text
//! no item reads. It lives beside the renderer that draws what `evaluate` returns, since a
//! counting allocator needs `unsafe`, which the canvas crates' lint refuses.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels};
use serde_json::json;

struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static BYTES: Cell<u64> = const { Cell::new(0) };
}

fn note(size: usize) {
    if COUNTING.with(Cell::get) {
        BYTES.with(|b| b.set(b.get() + size as u64));
    }
}

// SAFETY: every call goes straight to the system allocator; the count is a const thread-local.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// The bytes `f` asks the heap for on this thread.
fn bytes(f: impl FnOnce()) -> u64 {
    BYTES.with(|b| b.set(0));
    COUNTING.with(|c| c.set(true));
    f();
    COUNTING.with(|c| c.set(false));
    BYTES.with(Cell::get)
}

/// A built mesh reads the document for the curves it may name. The document it reads is the one
/// `evaluate` was given: 4 MiB of description in it costs the evaluation nothing.
#[test]
fn evaluating_a_built_mesh_allocates_no_copy_of_the_document() {
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let evaluated = |description: String| {
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": description,
            "size": [128, 96], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "cam", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0.8, 0], "orbit": {"azimuth": 30, "elevation": 20, "distance": 14}, "fov": 45, "near": 0.1, "far": 500}},
                "mat": {"id": "mat", "kind": "material@1", "name": "mat", "order": "a1", "layer": "main", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}},
                "floor": {"id": "floor", "kind": "plate@1", "name": "floor", "order": "a2", "layer": "main", "params": {"grid": [1, 1], "size": [40, 40]}, "at": {"pos": [0, 0, 0]}, "material": "mat"},
            },
        });
        let mut labels = Labels::new();
        let mut solids = 0;
        let cost = bytes(|| {
            let scene = evaluate(&doc, 0, &look, &mut labels).expect("the scene evaluates");
            solids = scene.layers.iter().map(|l| l.solids.len()).sum();
        });
        assert_eq!(solids, 1, "the plate is built and drawn");
        cost
    };
    let (short, long) = (evaluated(String::new()), evaluated("x".repeat(4 << 20)));
    assert!(
        long < short + (1 << 20),
        "4 MiB of description cost the evaluation {} bytes more ({long} against {short})",
        long.saturating_sub(short)
    );
}

/// A document off the fast path is evaluated whole every frame, from the document its frames
/// keep: a frame copies none of it.
#[test]
fn a_whole_frame_allocates_no_copy_of_the_document() {
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let frame = |description: String| {
        // A size that moves keeps the document off the fast path.
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": description,
            "size": [128, 96], "camera": "cam", "transport": {"span": "60s"},
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "cam", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0.8, 0], "orbit": {"azimuth": 30, "elevation": 20, "distance": 14}, "fov": 45, "near": 0.1, "far": 500}},
                "box": {"id": "box", "kind": "mark.box@1", "name": "box", "order": "a1", "layer": "main", "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}},
            },
            "channels": {"grow": {"target": "items/box/params/size/1", "type": "f32", "keys": {"k0": {"t": "0s", "value": 1, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}}},
        });
        let mut labels = Labels::new();
        let mut frames = Frames::new(&doc, &look, &mut labels).expect("the scene evaluates");
        assert!(!frames.is_fast(), "the growing box is evaluated whole");
        let t = 600 * 705_600_000 / 60;
        let whole = evaluate(&doc, t, &look, &mut labels).expect("the scene evaluates");
        let cost = bytes(|| {
            frames
                .at(t, [128, 96], &Default::default(), &mut labels)
                .expect("a frame");
        });
        assert!(*frames.scene() == whole, "the frame is the document's at t");
        // Another size is the frame's own: the kept document takes it.
        let mut small = doc.clone();
        small["size"] = json!([64, 48]);
        let at_small = evaluate(&small, t, &look, &mut labels).expect("the scene evaluates");
        frames
            .at(t, [64, 48], &Default::default(), &mut labels)
            .expect("a frame");
        assert!(
            *frames.scene() == at_small,
            "the frame at 64 × 48 is the document's at that size"
        );
        cost
    };
    let (short, long) = (frame(String::new()), frame("x".repeat(4 << 20)));
    assert!(
        long < short + (1 << 20),
        "4 MiB of description cost the frame {} bytes more ({long} against {short})",
        long.saturating_sub(short)
    );
}
