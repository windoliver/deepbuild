//! What #2657's acceptance tests share: the documents they evaluate, the look, the time unit, a
//! frame as the GPU layer's view takes one (a whole prepare, its jobs recorded into a slot, one
//! submit), and the counted device's readings. Nothing here stands in for the renderer. Written
//! blind from the issue, the design and the base (README.md).
#![allow(dead_code)]

use std::sync::Arc;

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene, Solid};
use deep_gpu::counted::Reading;
use deep_gpu::device::{Backend, Device, Gpu};
use deep_scene3d_render::{Planted, Renderer};
use serde_json::{json, Map, Value};

/// Flicks a second (Units and axes: time).
pub const SECOND: i64 = 705_600_000;
/// The size every noop frame draws at.
pub const SIZE: [u32; 2] = [128, 96];

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

/// A still perspective camera at `distance` m looking at `target`.
pub fn camera(target: [f64; 3], distance: f64) -> Value {
    json!({"kind": "camera@1", "params": {"projection": "perspective", "target": target, "orbit": {"azimuth": 30, "elevation": 25, "distance": distance}, "fov": 45, "near": 0.1, "far": 2000}})
}

/// A channel turning `cam` once around over the 60 s span.
pub fn orbit() -> Value {
    json!({"orbit": {"target": "items/cam/params/orbit/azimuth", "type": "f32", "keys": {"k0": {"t": "0s", "value": 30, "interp": "linear"}, "k1": {"t": "60s", "value": 390, "interp": "linear"}}}})
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

/// The noop backend's device (the noop lane's: wgpu's noop backend, no GPU).
pub fn noop() -> Arc<Device> {
    Gpu::open(Backend::Noop).expect("the noop backend gives a device").device()
}

/// A renderer, planted or not.
pub fn renderer(device: &Device, planted: Planted) -> Renderer {
    Renderer::new(device, planted)
}

/// One frame as the GPU layer's view takes it: a whole prepare of `scene`, its jobs recorded into
/// a slot of the scene's size, one submit. What the counted device made and wrote meanwhile.
pub fn frame(device: &Device, renderer: &mut Renderer, scene: &Scene) -> Reading {
    let slot = slot(device, scene.size);
    let before = device.device.counts().read();
    renderer.prepare(device, scene, &look());
    record(device, renderer, &slot);
    device.device.counts().read().since(before)
}

/// A slot texture's view at `size`.
pub fn slot(device: &Device, size: [u32; 2]) -> wgpu::TextureView {
    device
        .device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("acceptance 2657 slot"),
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
        .join("../../tests/acceptance/2657/fixtures")
        .join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is JSON: {e}", path.display()))
}

/// Fails if the device raised an error.
pub fn no_errors(device: &Device) {
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}
