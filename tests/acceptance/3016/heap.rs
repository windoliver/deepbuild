//! #3016 criterion 4: a whole prepare of a 10,000-solid scene with a mirror and one view inset allocates under 1 MiB
//! more heap than the same scene with neither, read as `crates/deep-scene3d-render/tests/evaluate_alloc.rs` reads it:
//! a counting global allocator, the bytes this thread asks the heap for while the call runs. Written blind from the
//! issue, the design and the base (README). On the noop lane: the heap reading needs no GPU.

#[path = "fixture.rs"]
mod fixture;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::{Planted, Renderer};
use fixture::*;
use serde_json::json;

const AC4: &str = "AC4 #3016.151aa36c";

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

const SOLIDS: usize = 10_000;

/// 10,000 boxes in a 100 × 100 grid on the floor, under a sun; with `views`, the floor a mirror and one view inset
/// that keeps every item.
fn boxes(views: bool) -> deep_canvas_scene3d::scene::Scene {
    let mut floor = json!({"base_color": [0.05, 0.05, 0.06, 1], "metallic": 1, "roughness": 0.1});
    if views {
        floor["mirror"] = json!({"strength": 1, "blur": 0, "plane": "floor"});
    }
    let mut items = vec![
        ("cam".to_string(), camera([0.0, 30.0, 50.0], [0.0, 0.0, 0.0])),
        ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": true}, "at": {"rot": [-45, 30, 0]}})),
        ("floor_mat".into(), json!({"kind": "material@1", "params": floor})),
        ("floor".into(), json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [80, 80]}, "at": {"pos": [0, 0, 0]}, "material": "floor_mat"})),
        ("box_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
        ("screen_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.2, 0.2, 0.2, 1], "roughness": 0.6}})),
        ("pip_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.6, -42]}, "material": "screen_mat"})),
    ];
    if views {
        items.push(("pip_cam".into(), camera([40.0, 20.0, 20.0], [0.0, 0.0, 0.0])));
        items.push(("pip".into(), json!({"kind": "inset@1", "params": {"face": "pip_display#screen", "size": [0.76, 0.46], "px_per_unit": 400, "view": {"camera": "pip_cam"}}})));
    }
    for k in 0..SOLIDS - 2 {
        let (x, z) = ((k % 100) as f64 * 0.7 - 35.0, (k / 100) as f64 * 0.7 - 35.0);
        items.push((format!("b{k:05}"), json!({"kind": "mark.box@1", "params": {"size": [0.4, 0.4, 0.4]}, "at": {"pos": [x, 0.2, z]}, "material": "box_mat"})));
    }
    fixture::scene(&doc(items, json!({})))
}

/// A whole prepare of each scene, after two that warm the renderer, on a fresh noop device: its heap bytes.
fn third_prepare(scene: &deep_canvas_scene3d::scene::Scene) -> (u64, Renderer, std::sync::Arc<Gpu>) {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
    let device = gpu.device();
    let mut renderer = Renderer::new(&device, Planted::default());
    for _ in 0..2 {
        draw(&device, &mut renderer, scene);
    }
    let cost = bytes(|| renderer.prepare(&device, scene, &look()));
    (cost, renderer, gpu)
}

#[test]
fn ac4_a_mirror_and_a_view_inset_copy_no_scene() {
    let (with, without) = (boxes(true), boxes(false));
    let solids = |s: &deep_canvas_scene3d::scene::Scene| s.layers.iter().map(|l| l.solids.len()).sum::<usize>();
    // The display's screen and frame are solids too: the scene holds at least 10,000.
    assert!(solids(&without) >= SOLIDS && solids(&with) >= SOLIDS, "{AC4}: the scenes hold {} and {} solids", solids(&with), solids(&without));
    assert!(with.mirror.is_some() && with.views.len() == 1 && without.mirror.is_none() && without.views.is_empty(), "{AC4}: one scene has a mirror and one view inset, the other neither");
    let (plain, _r0, _g0) = third_prepare(&without);
    let (viewed, renderer, _g1) = third_prepare(&with);
    assert!(renderer.mirror_px().is_some(), "{AC4}: the mirror's picture is drawn");
    // Guard: the reading reads a whole prepare.
    assert!(plain > 0, "{AC4}: a whole prepare of the plain scene allocates nothing: the reading reads nothing");
    let more = viewed.saturating_sub(plain);
    assert!(
        more < MIB,
        "{AC4}: a whole prepare with a mirror and a view inset allocates {viewed} B, {more} B ({:.2} MiB) more than the scene with neither ({plain} B); the limit is 1 MiB",
        mib(more)
    );
}
