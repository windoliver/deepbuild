//! #2657.1e3f898a (AC5): after warm-up, a whole prepare under a shadowed sun and a casting lamp
//! allocates nothing in `ensure_casters`, and a scene that gains its first caster still gets its
//! pipeline in that frame. A planted renderer that skips the check once any pipeline exists misses
//! the second kind and fails, naming it.
//!
//! On the noop lane. A sun with a shadow and four cascades and a point lamp with a shadow light a
//! receiving plate (`cast_shadow: false`), an opaque box `a` and a box `m` whose material is
//! mask-alpha. What `ensure_casters` allocates is read as evaluate_alloc.rs reads heap (a counting
//! global allocator, this thread, bytes and allocations), across the renderer's own
//! `ensure_casters` called with the frame's scene right after its third whole prepare, the call
//! that prepare made (`Renderer::ensure_casters`, README: Surfaces). The pipelines a frame gets
//! are the names the renderer adds to `compiled_names()` in it: `scene3d.shadow` for opaque
//! casters, `scene3d.shadow_mask` for mask-alpha ones. The planted renderer is
//! `Planted { casters_once_any: true, .. }`.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::*;
use deep_scene3d_render::{Planted, Renderer};
use serde_json::{json, Value};

const ID: &str = "#2657.1e3f898a";
const OPAQUE: &str = "scene3d.shadow";
const MASK: &str = "scene3d.shadow_mask";

struct Counting;

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

/// The allocations and bytes `f` asks the heap for on this thread.
fn heap(f: impl FnOnce()) -> (u64, u64) {
    BYTES.with(|b| b.set(0));
    CALLS.with(|c| c.set(0));
    COUNTING.with(|c| c.set(true));
    f();
    COUNTING.with(|c| c.set(false));
    (CALLS.with(Cell::get), BYTES.with(Cell::get))
}

/// The lit scene, `a` and `m` casting as told.
fn lit(a_casts: bool, m_casts: bool) -> Value {
    doc(
        vec![
            ("cam".into(), camera([0.0, 0.5, 0.0], 12.0)),
            ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": true, "cascades": 4}, "at": {"rot": [-50, 30, 0]}})),
            ("lamp".into(), json!({"kind": "light.point@1", "params": {"power": 400, "radius": 0.05, "color": [1, 0.9, 0.8], "shadow": true}, "at": {"pos": [0.5, 3, 1]}})),
            ("clay".into(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
            ("leaf".into(), json!({"kind": "material@1", "params": {"base_color": [0.2, 0.6, 0.2, 0.8], "roughness": 0.6, "alpha_mode": "mask", "alpha_cutoff": 0.5}})),
            ("ground".into(), json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [20, 20]}, "material": "clay", "cast_shadow": false, "at": {"pos": [0, 0, 0]}})),
            ("a".into(), json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "material": "clay", "cast_shadow": a_casts, "at": {"pos": [-1, 0.5, 0]}})),
            ("m".into(), json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "material": "leaf", "cast_shadow": m_casts, "at": {"pos": [1, 0.5, 0]}})),
        ],
        json!({}),
        SIZE,
    )
}

/// The names the renderer compiled in one frame of `doc`.
fn compiled_in(device: &deep_gpu::device::Device, r: &mut Renderer, doc: &Value) -> Vec<&'static str> {
    let before = r.compiled_names().len();
    frame(device, r, &scene(doc, 0));
    r.compiled_names()[before..].to_vec()
}

/// Frames 1 and 2 cast nothing, frame 3 gains its first opaque caster, frame 4 its first
/// mask-alpha caster: what each frame that gains a kind fails to compile for it.
fn gained(planted: Planted) -> Vec<String> {
    let device = noop();
    let mut r = renderer(&device, planted);
    let mut problems = Vec::new();
    for n in 1..=2 {
        let made = compiled_in(&device, &mut r, &lit(false, false));
        if made.iter().any(|m| *m == OPAQUE || *m == MASK) {
            problems.push(format!("frame {n} casts nothing yet compiles {made:?}"));
        }
    }
    for (n, (a, m), kind) in [(3, (true, false), OPAQUE), (4, (true, true), MASK)] {
        let made = compiled_in(&device, &mut r, &lit(a, m));
        if !made.contains(&kind) {
            problems.push(format!(
                "frame {n} gains its first {} caster and gets no {kind} pipeline in that frame (it compiled {made:?})",
                if kind == MASK { "mask-alpha" } else { "opaque" }
            ));
        }
    }
    no_errors(&device);
    problems
}

#[test]
fn ac5_after_warm_up_ensure_casters_allocates_nothing_under_a_shadowed_sun_and_a_casting_lamp() {
    let doc = lit(true, true);
    let scene = scene(&doc, 0);
    assert!(scene.sun.as_ref().is_some_and(|s| s.shadow), "{ID}: the sun casts a shadow");
    assert!(scene.lights.iter().any(|l| l.id == "lamp"), "{ID}: the lamp lights the scene");
    let device = noop();
    let mut r = renderer(&device, Planted::default());
    for _ in 0..3 {
        frame(&device, &mut r, &scene);
    }
    let names = r.compiled_names();
    assert!(
        names.contains(&OPAQUE) && names.contains(&MASK),
        "{ID}: the warm-up compiled both caster kinds' pipelines: {names:?}"
    );
    let (calls, bytes) = heap(|| r.ensure_casters(&device, &scene));
    no_errors(&device);
    assert_eq!(
        (calls, bytes),
        (0, 0),
        "{ID}: after warm-up, ensure_casters under a shadowed sun and a casting lamp makes {calls} allocations of {bytes} bytes (expected none)"
    );
}

#[test]
fn ac5_a_scene_that_gains_its_first_caster_of_each_kind_gets_its_pipeline_in_that_frame() {
    let problems = gained(Planted::default());
    assert!(problems.is_empty(), "{ID}:\n{}", problems.join("\n"));
}

#[test]
fn ac5_planted_casters_once_any_misses_the_second_kind_and_fails_naming_it() {
    let problems = gained(Planted { casters_once_any: true, ..Planted::default() });
    eprintln!("{ID}: planted casters_once_any fails with: {problems:?}");
    assert!(
        problems.iter().any(|p| p.contains(MASK) && p.starts_with("frame 4 ")),
        "{ID}: the planted renderer that skips the check once any pipeline exists fails, naming the mask-alpha kind's pipeline; its problems: {problems:?}"
    );
}
