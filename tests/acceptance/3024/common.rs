//! What #3024's acceptance tests share: the documents they evaluate, the look, the time unit, a
//! frame as the GPU layer's view takes one on the noop lane (a whole prepare, its jobs recorded
//! into a slot, one submit), and the suite's fixtures. Nothing here stands in for the renderer.
//! Written blind from the issue, the design and the base (README.md).
#![allow(dead_code)]

use std::sync::Arc;

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene, Solid};
use deep_gpu::device::{Backend, Device, Gpu};
use deep_scene3d_render::{Planted, Renderer};
use serde_json::{json, Map, Value};

/// Flicks a second (Units and axes: time).
pub const SECOND: i64 = 705_600_000;

/// The look every test draws with.
pub fn look() -> Look3 {
    Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).expect("the look reads")
}

/// A scene document of `items` in one layer `main`, each stamped with its ID, name, order and
/// layer (the render crate's own tests' `stamped`), drawn by `cam` at `size`.
pub fn doc(items: Vec<(String, Value)>, channels: Value, size: [u32; 2]) -> Value {
    let mut map = Map::new();
    for (k, (id, mut item)) in items.into_iter().enumerate() {
        item["id"] = json!(id);
        item["name"] = json!(id);
        item["order"] = json!(format!("a{k:06}"));
        item["layer"] = json!("main");
        map.insert(id, item);
    }
    json!({
        "format": 1, "profile": "scene", "title": "T", "size": size, "camera": "cam",
        "transport": {"span": "60s"}, "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": map, "channels": channels,
    })
}

/// A still perspective camera orbiting `target` at `[azimuth, elevation, distance]` (deg, deg, m),
/// its 45° field of view across the frame's wider side.
pub fn camera(target: [f64; 3], orbit: [f64; 3]) -> Value {
    json!({"kind": "camera@1", "params": {"projection": "perspective", "target": target, "orbit": {"azimuth": orbit[0], "elevation": orbit[1], "distance": orbit[2]}, "fov": 45, "near": 0.1, "far": 2000}})
}

/// A lake's material, `water` given, or the same material plain with `water` `None`.
pub fn lake_material(water: Option<Value>) -> Value {
    let mut m = json!({"kind": "material@1", "params": {"base_color": [0.1, 0.3, 0.4, 1], "roughness": 0.05}});
    if let Some(w) = water {
        m["params"]["water"] = w;
    }
    m
}

/// A lake's plate: a flat 16 × 16 grid `size` m across at `pos`, wearing `lake_mat`.
pub fn plate(size: [f64; 2], pos: [f64; 3]) -> Value {
    json!({"kind": "plate@1", "params": {"grid": [16, 16], "size": size}, "at": {"pos": pos}, "material": "lake_mat"})
}

/// `doc` evaluated at `t`.
pub fn scene(doc: &Value, t: i64) -> Scene {
    evaluate(doc, t, &look(), &mut Labels::new()).expect("the scene evaluates")
}

pub fn solids(scene: &Scene) -> impl Iterator<Item = &Solid> {
    scene.layers.iter().flat_map(|l| &l.solids)
}

pub fn solid<'a>(scene: &'a Scene, id: &str) -> &'a Solid {
    solids(scene).find(|s| s.id == id).unwrap_or_else(|| panic!("the scene draws {id}"))
}

/// Whether `scene`'s water is the solid `part` and nothing else.
pub fn water_is(scene: &Scene, part: &str) -> bool {
    scene.water.as_ref().is_some_and(|w| w.parts.len() == 1 && w.parts.contains(part))
}

/// Whether `scene` draws a mirror in `part`'s plane over `part` (the water's own, scene3d's
/// `mirror::own`).
pub fn mirrored_in(scene: &Scene, part: &str) -> bool {
    scene.mirror.as_ref().is_some_and(|m| m.plane == part && m.parts.contains(part))
}

/// The noop backend's device (the noop lane's: wgpu's noop backend, no GPU).
pub fn noop() -> Arc<Device> {
    Gpu::open(Backend::Noop).expect("the noop backend gives a device").device()
}

/// A renderer, planted or not.
pub fn renderer(device: &Device, planted: Planted) -> Renderer {
    Renderer::new(device, planted)
}

/// One frame as the GPU layer's view takes it: a whole prepare of `scene`, its jobs recorded into
/// a slot of the scene's size, one submit.
pub fn frame(device: &Device, renderer: &mut Renderer, scene: &Scene) {
    let slot = slot(device, scene.size);
    renderer.prepare(device, scene, &look());
    record(device, renderer, &slot);
}

/// A slot texture's view at `size`.
pub fn slot(device: &Device, size: [u32; 2]) -> wgpu::TextureView {
    device
        .device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("acceptance 3024 slot"),
            size: wgpu::Extent3d { width: size[0], height: size[1], depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: deep_gpu::surface::FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

/// The renderer's jobs for the frame it prepared, recorded into `slot` and submitted once.
pub fn record(device: &Device, renderer: &mut Renderer, slot: &wgpu::TextureView) {
    let mut encoder = device.device.create_command_encoder(&Default::default());
    for (_, job) in renderer.jobs(device, slot, None, None) {
        job(&mut encoder);
    }
    device.queue.submit([encoder.finish()]);
}

/// This suite's fixture `name` (fixtures/), read when the test runs.
pub fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/acceptance/3024/fixtures")
        .join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is JSON: {e}", path.display()))
}

/// Fails if the device raised an error.
pub fn no_errors(device: &Device) {
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}
