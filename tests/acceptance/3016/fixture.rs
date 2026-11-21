//! #3016's fixtures, shared by the suite's Rust files (README: Fixtures). Every mesh and map is made here, at test time:
//! nothing large is committed.
//!
//! The heavy scene: four `mesh.asset@1` items, each a different 100,000-triangle grid (a GLB of 50,451 vertices and
//! 300,000 indices), each under a material whose `maps.base_color` is a 2,048 px map (RGBA8 sRGB, all 12 mips, as the
//! decode worker hands a PNG's texels to the renderer through `Scene::texels`), on a 40 m floor plate, under a shadowed
//! sun (so its cascades draw) and a sky whose environment is filtered from the sky. It opens as [`Views::Plain`], with
//! the floor a mirror ([`Views::Mirror`]), with the mirror and two view insets that keep every item
//! ([`Views::MirrorInsets`]), or with an eye inset that keeps every item ([`Views::EyeInset`]).
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use deep_canvas_scene3d::frames::{Frames, Reader};
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Labels, Scene, Shape};
use deep_gpu::device::Device;
use deep_scene3d_render::{draw_offscreen, Renderer};
use serde_json::{json, Map, Value};

/// The frame every scene draws at.
pub const SIZE: [u32; 2] = [320, 240];
/// The heavy meshes' grid: 250 × 200 quads, two triangles each.
pub const GRID: [u32; 2] = [250, 200];
pub const TRIANGLES: u64 = 2 * GRID[0] as u64 * GRID[1] as u64;
/// The heavy maps' side and mip count.
pub const MAP_PX: u32 = 2048;
pub const MAP_MIPS: u32 = 12;
pub const MIB: u64 = 1 << 20;

pub fn look() -> Look3 {
    Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).expect("the look reads")
}

/// A hash-shaped key: `tag` (one hex digit) and `k`. Neither the scene nor the renderer checks an asset's hash
/// against its bytes, so a key needn't be one.
pub fn key(tag: u8, k: usize) -> String {
    format!("{:x}{:063x}", tag & 0xf, k)
}
pub fn mesh_sha(k: usize) -> String {
    key(0xa, k)
}
pub fn map_sha(k: usize) -> String {
    key(0xb, k)
}

/// A GLB of one node whose mesh is a `cols` × `rows` grid of quads, 1 m across in x and z, rippled in y by `k` so each
/// `k` is another mesh: positions, normals, uv0 and u32 indices.
pub fn glb(k: usize, [cols, rows]: [u32; 2]) -> Vec<u8> {
    let (nx, ny) = (cols + 1, rows + 1);
    let n = (nx * ny) as usize;
    let (mut pos, mut nor, mut uv) = (Vec::with_capacity(n * 3), Vec::with_capacity(n * 3), Vec::with_capacity(n * 2));
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for j in 0..ny {
        for i in 0..nx {
            let (u, v) = (i as f32 / cols as f32, j as f32 / rows as f32);
            let p = [u - 0.5, 0.02 * ((u * 7.0 + k as f32).sin() * (v * 5.0 + 0.3 * k as f32).cos()), v - 0.5];
            for c in 0..3 {
                lo[c] = lo[c].min(p[c]);
                hi[c] = hi[c].max(p[c]);
            }
            pos.extend_from_slice(&p);
            nor.extend_from_slice(&[0.0f32, 1.0, 0.0]);
            uv.extend_from_slice(&[u, v]);
        }
    }
    let mut idx: Vec<u32> = Vec::with_capacity((cols * rows * 6) as usize);
    for j in 0..rows {
        for i in 0..cols {
            let a = j * nx + i;
            let (b, c) = (a + 1, a + nx);
            idx.extend_from_slice(&[a, c, b, b, c, c + 1]);
        }
    }
    let mut bin: Vec<u8> = Vec::new();
    let mut views = Vec::new();
    for part in [bytemuck_f32(&pos), bytemuck_f32(&nor), bytemuck_f32(&uv), bytemuck_u32(&idx)] {
        views.push(json!({"buffer": 0, "byteOffset": bin.len(), "byteLength": part.len()}));
        bin.extend_from_slice(&part);
    }
    let doc = json!({
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": bin.len()}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3", "min": lo, "max": hi},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": n, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": idx.len(), "type": "SCALAR"},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3}]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    });
    let mut json = serde_json::to_vec(&doc).expect("JSON");
    while json.len() % 4 != 0 {
        json.push(b' ');
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let total = 12 + 8 + json.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&json);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend_from_slice(&bin);
    out
}

fn bytemuck_f32(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}
fn bytemuck_u32(v: &[u32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// A map's texels as the decode worker hands a PNG's to the renderer: RGBA8 sRGB, every mip end to end.
pub fn texels(px: u32, mips: u32) -> Arc<Texels> {
    let bytes: usize = (0..mips).map(|l| ((px >> l).max(1) as usize).pow(2) * 4).sum();
    Arc::new(Texels { format: "rgba8unorm-srgb".into(), size: [px, px], mips, data: Arc::new(vec![170u8; bytes]) })
}

/// The bytes a map of `px` with `mips` mips takes on the device in RGBA8.
pub fn map_bytes(px: u32, mips: u32) -> u64 {
    (0..mips).map(|l| u64::from((px >> l).max(1)).pow(2) * 4).sum()
}

/// The asset store the scenes read their meshes from: every heavy mesh, and the small ones [`small_glb`] names.
fn store() -> &'static BTreeMap<String, Vec<u8>> {
    static STORE: OnceLock<BTreeMap<String, Vec<u8>>> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut m = BTreeMap::new();
        for k in 0..4 {
            m.insert(mesh_sha(k), glb(k, GRID));
        }
        // The small meshes: 12 × 12 quads, each its own ripple.
        for k in 0..80 {
            m.insert(key(0xc, k), glb(100 + k, [12, 12]));
        }
        m
    })
}
/// A small mesh's key (288 triangles), `k` below 80.
pub fn small_sha(k: usize) -> String {
    key(0xc, k)
}

pub fn reader() -> Reader {
    Arc::new(|sha: &str| store().get(sha).cloned())
}

/// The documents' items, by ID, given ids, names, orders and the layer.
pub fn doc(items: Vec<(String, Value)>, extra: Value) -> Value {
    let items: Map<String, Value> = items
        .into_iter()
        .enumerate()
        .map(|(k, (id, mut item))| {
            item["id"] = json!(id);
            item["name"] = json!(id);
            item["order"] = json!(format!("a{k:04}"));
            item["layer"] = json!("main");
            (id, item)
        })
        .collect();
    let mut d = json!({
        "format": 1, "profile": "scene", "title": "T", "size": SIZE, "camera": "cam",
        "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": items,
    });
    if let (Some(d), Some(e)) = (d.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            d.insert(k.clone(), v.clone());
        }
    }
    d
}

/// A perspective camera at `position` looking at `target`, fov 45°.
pub fn camera(position: [f64; 3], target: [f64; 3]) -> Value {
    json!({"kind": "camera@1", "params": {"projection": "perspective", "position": position, "target": target, "fov": 45, "near": 0.1, "far": 500}})
}

/// The views a heavy scene opens with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Views {
    Plain,
    Mirror,
    MirrorInsets,
    EyeInset,
}

/// The view insets' IDs in [`Views::MirrorInsets`], and the eye inset's in [`Views::EyeInset`].
pub const INSETS: [&str; 2] = ["pip_a", "pip_b"];
pub const EYE: &str = "portal";

/// The scene, its sun, sky and floor, with `views`; `more` items beside them.
pub fn base_items(views: Views) -> Vec<(String, Value)> {
    let mut floor = json!({"base_color": [0.05, 0.05, 0.06, 1], "metallic": 1, "roughness": 0.1});
    if matches!(views, Views::Mirror | Views::MirrorInsets) {
        floor["mirror"] = json!({"strength": 1, "blur": 0, "plane": "floor"});
    }
    let mut items: Vec<(String, Value)> = vec![
        ("cam".into(), camera([0.0, 4.0, 9.0], [0.0, 0.4, 0.0])),
        ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": true}, "at": {"rot": [-45, 30, 0]}})),
        ("sky".into(), json!({"kind": "sky@1", "params": {"top": [0.15, 0.3, 0.75, 1], "low": [0.45, 0.6, 0.85, 1], "ambient_top": [0.25, 0.25, 0.25], "ambient_low": [0.1, 0.1, 0.1], "environment": {"from": "sky", "size": 256}}})),
        ("floor_mat".into(), json!({"kind": "material@1", "params": floor})),
        ("floor".into(), json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [40, 40]}, "at": {"pos": [0, 0, 0]}, "material": "floor_mat"})),
        ("screen_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.2, 0.2, 0.2, 1], "roughness": 0.6}})),
    ];
    match views {
        Views::MirrorInsets => {
            for (n, id) in INSETS.iter().enumerate() {
                let x = if n == 0 { -2.5 } else { 2.5 };
                let (display, cam) = (format!("{id}_display"), format!("{id}_cam"));
                items.push((cam.clone(), camera([if n == 0 { -8.0 } else { 8.0 }, 3.0, 4.0], [0.0, 0.4, 0.0])));
                items.push((display.clone(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [x, 1.6, -3]}, "material": "screen_mat"})));
                items.push((id.to_string(), json!({"kind": "inset@1", "params": {"face": format!("{display}#screen"), "size": [0.76, 0.46], "px_per_unit": 400, "view": {"camera": cam}}})));
            }
        }
        Views::EyeInset => {
            items.push(("portal_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.6, -3]}, "material": "screen_mat"})));
            items.push((EYE.into(), json!({"kind": "inset@1", "params": {"face": "portal_display#screen", "size": [0.76, 0.46], "px_per_unit": 400, "view": {"map": "eye", "depth": 1}}})));
        }
        Views::Plain | Views::Mirror => {}
    }
    items
}

/// The heavy scene's four meshes and their materials.
pub fn heavy_items() -> Vec<(String, Value)> {
    let mut items = Vec::new();
    for k in 0..4 {
        items.push((format!("mat{k}"), json!({"kind": "material@1", "params": {"base_color": [1, 1, 1, 1], "roughness": 0.5, "maps": {"base_color": map_sha(k)}}})));
        let x = -3.0 + 2.0 * k as f64;
        items.push((format!("mesh{k}"), json!({"kind": "mesh.asset@1", "params": {"sha256": mesh_sha(k), "node": 0}, "at": {"pos": [x, 0.4, 0], "scale": [1.6, 1.6, 1.6]}, "material": format!("mat{k}")})));
    }
    items
}

/// The heavy scene opened with `views`, its maps' texels as the host hands them over.
pub fn heavy(views: Views) -> Scene {
    let mut items = base_items(views);
    items.extend(heavy_items());
    let mut s = scene(&doc(items, json!({})));
    let t = texels(MAP_PX, MAP_MIPS);
    for k in 0..4 {
        s.texels.insert(map_sha(k), t.clone());
    }
    s
}

/// `doc` evaluated at t = 0 on [`SIZE`], its meshes read from the store.
pub fn scene(doc: &Value) -> Scene {
    let mut labels = Labels::new();
    let program = Frames::compile(doc).unwrap_or_else(|e| panic!("the fixture compiles: {e:?}"));
    let mut frames = Frames::with_program(doc, program, &look(), &mut labels, Some(reader()))
        .unwrap_or_else(|e| panic!("the fixture evaluates: {e:?}"));
    frames.at(0, SIZE, &Default::default(), &mut labels).unwrap_or_else(|e| panic!("the fixture's frame: {e:?}"));
    frames.scene().clone()
}

/// One frame of `scene` on `device` by `renderer`, submitted.
pub fn draw(device: &Device, renderer: &mut Renderer, scene: &Scene) {
    let _ = draw_offscreen(device, renderer, scene, &look(), None);
}

/// Criterion 5's mirror scene: 300 small boxes near the target (so the layer is culled on the GPU, past 256 items)
/// on a mirror floor, seen from (0, 5.7, 8.2) looking at the origin, and, with `odd`, a 1 m box `odd` at (0, 3, −11.8):
/// above the top of the camera's frustum, so the view culls it, while its reflection in the floor lies inside it. The
/// sun casts no shadow, so nothing of `odd` shows but through the mirror.
pub fn mirror_cull(odd: bool) -> Scene {
    let mut items: Vec<(String, Value)> = vec![
        ("cam".into(), camera([0.0, 5.7, 8.2], [0.0, 0.0, 0.0])),
        ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}})),
        ("floor_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.05, 0.05, 0.06, 1], "metallic": 1, "roughness": 0, "mirror": {"strength": 1, "blur": 0, "plane": "floor"}}})),
        ("floor".into(), json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [80, 80]}, "at": {"pos": [0, 0, 0]}, "material": "floor_mat"})),
        ("box_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.2, 0.5, 0.8, 1], "roughness": 0.6}})),
        ("odd_mat".into(), json!({"kind": "material@1", "params": {"base_color": [1, 0.2, 0.1, 1], "roughness": 0.4}})),
    ];
    for k in 0..300 {
        let (x, z) = ((k % 20) as f64 * 0.3 - 2.85, (k / 20) as f64 * 0.3 - 2.1);
        items.push((format!("b{k:03}"), json!({"kind": "mark.box@1", "params": {"size": [0.1, 0.1, 0.1]}, "at": {"pos": [x, 0.05, z]}, "material": "box_mat"})));
    }
    if odd {
        items.push(("odd".into(), json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "at": {"pos": [0, 3, -11.8]}, "material": "odd_mat"})));
    }
    scene(&doc(items, json!({})))
}

/// Criterion 5's inset scene: the camera close on a display whose view inset `pip` looks, from its own camera, at a
/// row of boxes 40 m away that a shadowed sun casts onto the floor: outside the view's frustum, so only the inset's own
/// cascades cover them. `far` false leaves the boxes out.
pub fn inset_cascades(far: bool) -> Scene {
    let mut items: Vec<(String, Value)> = vec![
        ("cam".into(), camera([0.0, 1.5, 3.0], [0.0, 1.2, -1.5])),
        ("pip_cam".into(), camera([40.0, 6.0, 12.0], [40.0, 0.5, 0.0])),
        ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": true}, "at": {"rot": [-40, 60, 0]}})),
        ("floor_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.8, 0.8, 0.8, 1], "roughness": 0.8}})),
        ("floor".into(), json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [120, 120]}, "at": {"pos": [20, 0, 0]}, "material": "floor_mat"})),
        ("box_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
        ("screen_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.2, 0.2, 0.2, 1], "roughness": 0.6}})),
        ("near".into(), json!({"kind": "mark.box@1", "params": {"size": [0.3, 0.3, 0.3]}, "at": {"pos": [0.8, 0.15, -1]}, "material": "box_mat"})),
        ("pip_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.2, -1.5]}, "material": "screen_mat"})),
        ("pip".into(), json!({"kind": "inset@1", "params": {"face": "pip_display#screen", "size": [0.76, 0.46], "px_per_unit": 400, "view": {"camera": "pip_cam"}}})),
    ];
    if far {
        for k in 0..5 {
            let x = 36.0 + 2.0 * k as f64;
            items.push((format!("far{k}"), json!({"kind": "mark.box@1", "params": {"size": [0.8, 2.0, 0.8]}, "at": {"pos": [x, 1.0, 0]}, "material": "box_mat"})));
        }
    }
    scene(&doc(items, json!({})))
}

/// FNV-1a over 64 bits: a frame's hash.
pub fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// This machine's model (`hw.model`), which a same-machine hash is read on.
pub fn model() -> String {
    std::process::Command::new("sysctl")
        .args(["-n", "hw.model"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// The merge base's hash of [`inset_cascades`]'s first frame, and the model it was read on
/// (`fixtures/inset-cascades.json`).
pub fn base_inset_hash() -> (String, String) {
    let text = include_str!("fixtures/inset-cascades.json");
    let v: Value = serde_json::from_str(text).expect("the fixture is JSON");
    (v["model"].as_str().unwrap_or("").to_string(), v["hash"].as_str().unwrap_or("").to_string())
}

/// Criterion 5's inset frame: [`inset_cascades`]'s first frame drawn on `device` by a renderer with `planted`,
/// against the merge base's hash. A failure names the frame.
pub fn inset_frame_failures(device: &Device, planted: deep_scene3d_render::Planted) -> Vec<String> {
    let (base_model, base_hash) = base_inset_hash();
    let here = model();
    assert_eq!(here, base_model, "BLOCKED: the merge base's hash was read on a {base_model}, this machine is a {here}: a same-machine hash can't be compared");
    let scene = inset_cascades(true);
    assert_eq!(scene.views.len(), 1, "the inset scene has its view inset");
    let mut renderer = Renderer::new(device, planted);
    let frame = draw_offscreen(device, &mut renderer, &scene, &look(), None).expect("Metal draws pixels");
    let got = fnv(&frame);
    if got == base_hash {
        Vec::new()
    } else {
        vec![format!("frame 0 of the inset-cascades scene (view inset `pip`, whose camera looks at boxes 40 m from the view's) hashes {got}; on the merge base {base_hash}")]
    }
}

/// What a fresh renderer with `planted` holds on the device once it has drawn `frames` frames of `scene`, read as
/// `crates/deep-scene3d-render/tests/held_memory.rs` reads it: the device's allocated size after each frame, drained,
/// less before the renderer was made; the most of those is its peak. Metal only.
pub fn held_on(device: &Device, scene: &Scene, frames: usize, planted: deep_scene3d_render::Planted) -> (u64, Renderer) {
    let size = || {
        deep_gpu::memory::drain(device);
        deep_gpu::memory::allocated(device).expect("Metal reports what it holds")
    };
    let before = size();
    let mut renderer = Renderer::new(device, planted);
    let mut peak = 0;
    for _ in 0..frames {
        draw(device, &mut renderer, scene);
        peak = peak.max(size().saturating_sub(before));
    }
    (peak, renderer)
}

/// A renderer estimate's bytes at `scene`'s size (the live view's `Shape` adds the slots and the upscale, which no
/// renderer holds).
pub fn estimate_bytes(h: deep_scene3d_render::held::Held, scene: &Scene) -> u64 {
    (h.per_px * f64::from(scene.size[0]) * f64::from(scene.size[1])) as u64 + h.fixed
}

/// The distinct meshes a scene's solids draw, by shape.
pub fn shapes(scene: &Scene) -> Vec<Shape> {
    let mut out: Vec<Shape> = Vec::new();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        if !out.contains(&s.shape) {
            out.push(s.shape);
        }
    }
    out
}

/// A gauge's entries and bytes now, by its name (`Renderer::meshes`, `Store::textures`); 0 before any holder used it.
pub fn gauge(name: &str) -> (u64, u64) {
    deep_canvas::gauge::all().into_iter().find(|g| g.name == name).map_or((0, 0), |g| g.read())
}

pub fn mib(b: u64) -> f64 {
    b as f64 / MIB as f64
}
