//! What a renderer drawing a scene holds on the device (#2189), for the check's memory estimate:
//! each part from the formats and sizes the renderer makes it in, so a view's estimate counts
//! what the view allocates.

use deep_canvas_scene3d::label::{PAGE, PAGES};
use deep_canvas_scene3d::scene::Scene;

use crate::{
    env, local, mirror, shadow, SolidRecord, CULLED_ITEMS, DEPTH, IDS, IDS_MS, LINEAR, MSAA,
};

/// wgpu's two buffers that validate indirect draws, made at a device's first: 1 MiB each.
const INDIRECT_VALIDATION: u64 = 2 << 20;

/// A renderer's bytes: `per_px` for each pixel of its internal size, `fixed` whatever that size.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Held {
    pub per_px: f64,
    pub fixed: u64,
}

fn texel(f: wgpu::TextureFormat) -> u64 {
    u64::from(f.block_copy_size(None).expect("a one-aspect format"))
}

/// What a renderer drawing `scene` holds beside the view's slots and upscale:
/// - each internal pixel: the linear, ID and depth targets, the geometry pass's stored samples
///   of the IDs and depth (its color's are memoryless), and, while a list is culled on the GPU,
///   the cull's prepass depth at those samples and its pyramid, a third more for its mips;
/// - whatever that size: each solid's record, the glyph atlas, the key sun's cascades or its
///   single map (counted whether or not a post reads it), the local lights' maps, the
///   environment's cubes, wgpu's buffers that validate a culled list's indirect draws, and a
///   mirror's own renderer at half the frame's size.
pub fn of(scene: &Scene) -> Held {
    let own = renderer(scene);
    Held {
        // The device makes them once, whichever renderer draws indirectly first.
        fixed: own.fixed + if culls(scene) { INDIRECT_VALIDATION } else { 0 },
        ..own
    }
}

fn renderer(scene: &Scene) -> Held {
    let samples = u64::from(MSAA);
    let mut per_px =
        (texel(LINEAR) + texel(IDS) + texel(DEPTH) + samples * (texel(IDS_MS) + texel(DEPTH)))
            as f64;
    let culls = culls(scene);
    if culls {
        per_px += (samples * texel(DEPTH)) as f64
            + texel(wgpu::TextureFormat::R32Float) as f64 * 4.0 / 3.0;
    }
    let solids = scene
        .layers
        .iter()
        .map(|l| l.solids.len() as u64)
        .sum::<u64>();
    let records = solids * std::mem::size_of::<SolidRecord>() as u64;
    let map = u64::from(shadow::SIZE).pow(2) * texel(shadow::FORMAT);
    let shadows = if scene.cascaded() {
        4 * map
    } else if scene.sun.as_ref().is_some_and(|s| s.shadow) {
        map
    } else {
        0
    };
    let atlas = u64::from(PAGE).pow(2) * PAGES as u64 * texel(wgpu::TextureFormat::R8Unorm);
    let mut fixed =
        records + atlas + shadows + local::bytes(scene) + scene.sky.as_ref().map_or(0, env::bytes);
    if let Some(m) = &scene.mirror {
        let size = mirror::half(scene.size);
        let own = renderer(&deep_canvas_scene3d::mirror::view(scene, m, size));
        fixed += (own.per_px * f64::from(size[0]) * f64::from(size[1])).round() as u64 + own.fixed;
    }
    Held { per_px, fixed }
}

/// Whether a list is culled on the GPU: a layer of more items than the line, or an instancer's
/// batch.
fn culls(scene: &Scene) -> bool {
    scene
        .layers
        .iter()
        .any(|l| l.solids.len() > CULLED_ITEMS || l.solids.iter().any(|s| s.batch != 0))
}
