//! #3016's criteria on Metal read through surfaces the merge base has (README): criterion 3 (what the third heavy scene
//! holds on the device beside the plain one, read as `crates/deep-scene3d-render/tests/held_memory.rs` reads it) and
//! criterion 7 (the check's GPU memory estimate, `held::of`, against the device's peak). Without a GPU each reads
//! BLOCKED, never PASS. The device's size counts every renderer the process holds, so the tests take turns.

#[path = "fixture.rs"]
mod fixture;

use std::sync::Mutex;

use deep_canvas_scene3d::scene::Scene;
use deep_gpu::device::{Backend, Device, Gpu};
use deep_scene3d_render::{Planted, Renderer, DEPTH, IDS, LINEAR, MSAA};
use fixture::*;

const AC3: &str = "AC3 #3016.127ccb4d";
const AC5: &str = "AC5 #3016.548510a3";
const AC7: &str = "AC7 #3016.a8b1d957";

static TURN: Mutex<()> = Mutex::new(());

fn gpu(ac: &str) -> std::sync::Arc<Gpu> {
    Gpu::open(Backend::Gpu).unwrap_or_else(|e| panic!("{ac}: BLOCKED: no Metal device: {e}"))
}

fn held(device: &Device, scene: &Scene, frames: usize) -> (u64, Renderer) {
    held_on(device, scene, frames, Planted::default())
}

fn texel(f: wgpu::TextureFormat) -> u64 {
    u64::from(f.block_copy_size(None).expect("a one-aspect format"))
}

/// What an extra view holds of its own at `px`: its linear, ID and depth targets and the geometry pass's stored
/// samples of the IDs (two 16-bit halves) and depth (48 B a pixel), and under a cascaded sun its four cascades. No
/// layer of these scenes is culled on the GPU (none holds more than 256 items or an instancer), so no cull's prepass
/// or pyramid.
fn own(px: [u32; 2], cascaded: bool) -> u64 {
    let per_px = texel(LINEAR) + texel(IDS) + texel(DEPTH) + u64::from(MSAA) * (texel(wgpu::TextureFormat::Rg16Uint) + texel(DEPTH));
    let cascades = if cascaded {
        4 * u64::from(deep_scene3d_render::shadow::SIZE).pow(2) * texel(deep_scene3d_render::shadow::FORMAT)
    } else {
        0
    };
    u64::from(px[0]) * u64::from(px[1]) * per_px + cascades
}

/// Each extra view `scene` draws beside its own, with its size: its mirror at half the frame, each view inset at its
/// own size and each inset's mirror at half that.
fn extra_views(scene: &Scene) -> Vec<(String, [u32; 2])> {
    let mut out = Vec::new();
    if scene.mirror.is_some() {
        out.push(("mirror".to_string(), deep_scene3d_render::mirror::half(scene.size)));
    }
    for v in &scene.views {
        let px = if v.eye.is_some() { scene.size } else { v.size };
        out.push((format!("inset {}", v.id), px));
        if scene.mirror.is_some() {
            out.push((format!("inset {} mirror", v.id), deep_scene3d_render::mirror::half(px)));
        }
    }
    out
}

/// Criterion 3: the third scene holds at most what the plain one holds plus each extra view's own targets, stored
/// samples, cull and cascades, within 4 MiB.
#[test]
fn ac3_the_third_scene_holds_the_scene_once_and_each_views_own_targets() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = gpu(AC3);
    let device = gpu.device();
    let (plain_scene, third_scene) = (heavy(Views::Plain), heavy(Views::MirrorInsets));
    let (plain, r) = held(&device, &plain_scene, 2);
    drop(r);
    let (third, r) = held(&device, &third_scene, 2);
    assert!(r.mirror_px().is_some(), "{AC3}: the third scene's mirror draws");
    drop(r);
    // Guard: the plain scene holds its four maps and meshes.
    let maps = 4 * map_bytes(MAP_PX, MAP_MIPS);
    assert!(plain >= maps, "{AC3}: the plain scene holds {:.1} MiB, under its four maps' {:.1} MiB", mib(plain), mib(maps));
    let views = extra_views(&third_scene);
    assert_eq!(views.len(), 5, "{AC3}: the third scene draws five views beside its own: {views:?}");
    let mut allowed = plain + 4 * MIB;
    let mut parts = Vec::new();
    for (name, px) in &views {
        let b = own(*px, third_scene.cascaded());
        allowed += b;
        parts.push(format!("{name} at {}×{} px: {:.1} MiB", px[0], px[1], mib(b)));
    }
    assert!(
        third <= allowed,
        "{AC3}: the third scene holds {third} B ({:.1} MiB) on the device; the plain one {:.1} MiB, plus each extra view's own {} and 4 MiB, allows {:.1} MiB: {:.1} MiB more, {:.2} times the plain scene's {:.1} MiB of maps",
        mib(third),
        mib(plain),
        parts.join(", "),
        mib(allowed),
        mib(third.saturating_sub(allowed)),
        third.saturating_sub(allowed) as f64 / maps as f64,
        mib(maps)
    );
}

fn estimate(scene: &Scene) -> u64 {
    estimate_bytes(deep_scene3d_render::held::of(scene), scene)
}

/// Criterion 7: the check's GPU memory estimate is within 10% of the device's peak for the scene with a mirror, the
/// scene with an eye inset, and the third scene.
#[test]
fn ac7_the_estimate_counts_what_each_view_holds() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = gpu(AC7);
    let device = gpu.device();
    let plain = heavy(Views::Plain);
    let mut failures = Vec::new();
    let (plain_dev, r) = held(&device, &plain, 2);
    drop(r);
    for views in [Views::Mirror, Views::EyeInset, Views::MirrorInsets] {
        let scene = heavy(views);
        let (dev, r) = held(&device, &scene, 2);
        drop(r);
        let est = estimate(&scene);
        // What the estimate and the device add for the view insets, beside the same scene without them.
        if !scene.views.is_empty() {
            let ids: Vec<&str> = scene.views.iter().map(|v| v.id.as_str()).collect();
            let without = if views == Views::MirrorInsets { heavy(Views::Mirror) } else { plain.clone() };
            let (without_dev, r) = held(&device, &without, 2);
            drop(r);
            let (est_inset, dev_inset) = (est as i64 - estimate(&without) as i64, dev as i64 - without_dev as i64);
            if (est_inset - dev_inset).unsigned_abs() as f64 > 0.1 * dev_inset.max(1) as f64 {
                failures.push(format!(
                    "{views:?}: the estimate holds {:.1} MiB for view inset {}, the device {:.1} MiB",
                    est_inset as f64 / MIB as f64,
                    ids.join(", "),
                    dev_inset as f64 / MIB as f64
                ));
            }
        }
        if est.abs_diff(dev) as f64 > 0.1 * dev as f64 {
            failures.push(format!("{views:?}: the estimate is {est} B ({:.1} MiB), the device's peak {dev} B ({:.1} MiB): off by {:.0}%", mib(est), mib(dev), 100.0 * (est as f64 - dev as f64) / dev as f64));
        }
    }
    // Guard: the device holds the plain scene's maps, so the readings read the scene.
    assert!(plain_dev >= 4 * map_bytes(MAP_PX, MAP_MIPS), "{AC7}: the plain scene holds {:.1} MiB", mib(plain_dev));
    let raised = device.take_raised();
    assert!(raised.is_empty(), "{AC7}: the device raised: {raised:?}");
    assert!(failures.is_empty(), "{AC7}:\n  {}", failures.join("\n  "));
}

/// Criterion 5, beside `frames.test.ts`: a view inset whose camera sees what the view's cascades don't cover draws
/// its first frame with the hash it had on the merge base. The planted `inset_takes_view_cascades` fails it
/// (`views.rs`).
#[test]
fn ac5_a_view_insets_frame_hashes_as_on_the_merge_base() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = gpu(AC5);
    let device = gpu.device();
    // Guard: the inset's picture shows the far boxes and their shadows, so the frame reads the inset's own state.
    let (with, without) = (inset_cascades(true), inset_cascades(false));
    let draw_hash = |s: &Scene| {
        let mut r = Renderer::new(&device, Planted::default());
        fnv(&deep_scene3d_render::draw_offscreen(&device, &mut r, s, &look(), None).expect("Metal draws pixels"))
    };
    let (h_with, h_without) = (draw_hash(&with), draw_hash(&without));
    println!("{AC5}: inset-cascades frame 0 on a {}: {h_with}", model());
    assert_ne!(h_with, h_without, "{AC5}: the view inset's window shows the boxes 40 m away");
    let failures = inset_frame_failures(&device, Planted::default());
    assert!(failures.is_empty(), "{AC5}:\n  {}", failures.join("\n  "));
}
