//! #2657.2d901bbb (AC4): a whole prepare of a 10,000-solid scene with one level-of-detail band and
//! one water part allocates under 1 MiB more heap than the same scene with neither, read as
//! `crates/deep-scene3d-render/tests/evaluate_alloc.rs` reads it. On the merge base it allocates
//! two copies of the scene.
//!
//! The scene: 9,998 boxes on a grid, a ball and a pool, 10,000 solids. With both: the ball carries
//! one proxy band (`lod`) and the pool's material is water. With neither: the same ball with no
//! band and the same pool with a plain material. The pool is a 20 × 6 × 20 m box, not planar, so
//! its water has no mirror of its own (scene3d's `mirror::own`) and the frame draws no mirrored
//! view of the scene beside it (README: Readings). Each scene has its own renderer on the
//! noop lane, warmed up by two whole prepares; the third whole prepare is read. Heap is read as
//! evaluate_alloc.rs reads it: a counting global allocator that sums the bytes each allocation and
//! reallocation asks of the heap on this thread while the prepare runs.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::*;
use deep_scene3d_render::Planted;
use serde_json::{json, Value};

const ID: &str = "#2657.2d901bbb";
const SOLIDS: usize = 10_000;
const MIB: u64 = 1 << 20;

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

/// The 10,000-solid scene, with a level-of-detail band and a water part or with neither.
fn crowd(both: bool) -> Value {
    let mut items = vec![
        ("cam".to_string(), camera([0.0, 0.0, 0.0], 220.0)),
        ("sun".to_string(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}})),
        ("clay".to_string(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
        ("pool_mat".to_string(), if both {
            json!({"kind": "material@1", "params": {"base_color": [0.1, 0.3, 0.4, 1], "roughness": 0.05, "water": {}}})
        } else {
            json!({"kind": "material@1", "params": {"base_color": [0.1, 0.3, 0.4, 1], "roughness": 0.05}})
        }),
        ("pool".to_string(), json!({"kind": "mark.box@1", "params": {"size": [20, 6, 20]}, "at": {"pos": [0, 3, -120]}, "material": "pool_mat"})),
    ];
    let mut ball = json!({"kind": "ball@1", "params": {"radius": 1, "segments": 64}, "material": "clay", "at": {"pos": [0, 1, 120]}});
    if both {
        ball["lod"] = json!({"bands": [{"below_px": 1000, "show": "proxy", "params": {"ratio": 0.25}}]});
    }
    items.push(("ball".to_string(), ball));
    for i in 0..SOLIDS - 2 {
        let (x, z) = ((i % 100) as f64 * 2.0 - 99.0, (i / 100) as f64 * 2.0 - 99.0);
        items.push((
            format!("box-{i:05}"),
            json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "material": "clay", "at": {"pos": [x, 0.5, z]}}),
        ));
    }
    doc(items, json!({}), SIZE)
}

/// The heap the third whole prepare of `doc` asks for, after two.
fn third_prepare(doc: &Value) -> u64 {
    let scene = scene(doc, 0);
    let device = noop();
    let mut r = renderer(&device, Planted::default());
    let look = look();
    for _ in 0..2 {
        frame(&device, &mut r, &scene);
    }
    let slot = slot(&device, scene.size);
    let cost = bytes(|| r.prepare(&device, &scene, &look));
    record(&device, &mut r, &slot);
    no_errors(&device);
    cost
}

#[test]
fn ac4_a_level_of_detail_band_and_a_water_part_cost_a_prepare_no_copy_of_the_scene() {
    let (with, without) = (crowd(true), crowd(false));
    let scene_with = scene(&with, 0);
    assert_eq!(solids(&scene_with).count(), SOLIDS, "{ID}: the scene has {SOLIDS} solids");
    assert!(scene_with.water.as_ref().is_some_and(|w| w.parts.iter().any(|p| p == "pool")), "{ID}: the pool is water");
    assert!(scene_with.mirror.is_none(), "{ID}: the pool's water draws no mirror of its own");
    assert!(
        deep_canvas_scene3d::lod::select(&scene_with).iter().any(|c| c.item == "ball"),
        "{ID}: the ball has a level-of-detail band"
    );
    let scene_without = scene(&without, 0);
    assert!(scene_without.water.is_none(), "{ID}: the plain pool isn't water");
    assert!(
        !deep_canvas_scene3d::lod::select(&scene_without).iter().any(|c| c.item == "ball"),
        "{ID}: the plain ball has no band"
    );
    let copy = bytes(|| drop(scene_with.clone()));
    let (a, b) = (third_prepare(&with), third_prepare(&without));
    let more = a.saturating_sub(b);
    assert!(
        more < MIB,
        "{ID}: a whole prepare of {SOLIDS} solids with a level-of-detail band and a water part asks the heap for {a} bytes, {more} more than with neither ({b}): {:.2} copies of the scene at {copy} bytes a copy, over 1 MiB ({MIB} bytes)",
        more as f64 / copy.max(1) as f64
    );
}
