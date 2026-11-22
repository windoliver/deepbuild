//! #3024.d3ad772d (AC1): on the noop lane, the third whole prepare of a 10,000-solid scene with a
//! lake (a planar plate whose material is water, so its water draws a mirror of its own)
//! allocates under 1 MiB more heap than the same scene whose plate has a plain material, read as
//! `tests/acceptance/2657/copies.rs` reads it. On the merge base it allocates at least one copy of
//! the scene more, and the test fails, naming the excess in copies of the scene.
//!
//! The scene: 9,999 boxes on a grid and a 40 × 40 m plate beside them, 10,000 solids. With the
//! lake, the plate's material is water (`water: {}`, a lake in a light breeze), so scene3d gives
//! the water a mirror of its own in the plate's plane (`mirror::own`) and the frame draws a
//! mirrored view of the scene. Its twin is the same document whose plate wears the same material
//! with no `water`: no water and no mirror. Each scene is evaluated once and has its own renderer
//! on the noop lane, warmed up by two whole prepares, each recorded and submitted; the third whole
//! prepare is read. Heap is read as copies.rs reads it: a counting global allocator that sums the
//! bytes each allocation and reallocation asks of the heap on this thread while the prepare runs.
//! A copy of the scene is read the same way, as the bytes one clone of the lake scene asks for.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::*;
use deep_scene3d_render::mirror::half;
use deep_scene3d_render::Planted;
use serde_json::{json, Value};

const ID: &str = "#3024.d3ad772d";
const SOLIDS: usize = 10_000;
const MIB: u64 = 1 << 20;
/// The size every noop frame draws at.
const SIZE: [u32; 2] = [128, 96];

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

/// The 10,000-solid scene, its plate a lake or plain.
fn crowd(lake: bool) -> Value {
    let mut items = vec![
        ("cam".to_string(), camera([0.0, 0.0, 0.0], [30.0, 25.0, 220.0])),
        ("sun".to_string(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}})),
        ("clay".to_string(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
        ("lake_mat".to_string(), lake_material(lake.then(|| json!({})))),
        ("lake".to_string(), plate([40.0, 40.0], [0.0, 0.0, -130.0])),
    ];
    for i in 0..SOLIDS - 1 {
        let (x, z) = ((i % 100) as f64 * 2.0 - 99.0, (i / 100) as f64 * 2.0 - 99.0);
        items.push((
            format!("box-{i:05}"),
            json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "material": "clay", "at": {"pos": [x, 0.5, z]}}),
        ));
    }
    doc(items, json!({}), SIZE)
}

/// The heap the third whole prepare of `doc` asks for, after two, and the size the frame's
/// mirror drew its view at (`None` with no mirror drawn).
fn third_prepare(doc: &Value) -> (u64, Option<[u32; 2]>) {
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
    (cost, r.mirror_px())
}

#[test]
fn ac1_a_lakes_mirror_costs_a_held_prepare_no_copy_of_the_scene() {
    let (with, without) = (crowd(true), crowd(false));
    let lake = scene(&with, 0);
    assert_eq!(solids(&lake).count(), SOLIDS, "{ID}: the lake scene has {SOLIDS} solids");
    assert!(water_is(&lake, "lake"), "{ID}: the lake scene's water is the plate: {:?}", lake.water.as_ref().map(|w| &w.parts));
    assert!(mirrored_in(&lake, "lake"), "{ID}: the lake's water draws a mirror of its own in the plate's plane: {:?}", lake.mirror);
    let plain = scene(&without, 0);
    assert_eq!(solids(&plain).count(), SOLIDS, "{ID}: the plain scene has {SOLIDS} solids");
    assert!(plain.water.is_none(), "{ID}: the plain plate isn't water");
    assert!(plain.mirror.is_none(), "{ID}: the plain plate draws no mirror");
    let copy = bytes(|| drop(lake.clone()));
    let ((a, drawn), (b, none)) = (third_prepare(&with), third_prepare(&without));
    assert_eq!(drawn, Some(half(SIZE)), "{ID}: the lake's third frame draws its mirrored view at half the frame's size");
    assert_eq!(none, None, "{ID}: the plain plate's third frame draws no mirrored view");
    let more = a.saturating_sub(b);
    eprintln!("{ID}: the third whole prepare asks the heap for {a} bytes with the lake and {b} with the plain plate, {more} more; a copy of the scene is {copy} bytes");
    assert!(
        more < MIB,
        "{ID}: the third whole prepare of {SOLIDS} solids with a lake asks the heap for {a} bytes, {more} more than with a plain plate ({b}): {:.2} copies of the scene at {copy} bytes a copy, over 1 MiB ({MIB} bytes)",
        more as f64 / copy.max(1) as f64
    );
}
