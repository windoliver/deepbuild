//! What the renderers drawing a scene hold on the device (#2189), for the check's memory
//! estimate: each part from the formats and sizes the renderer makes it in, so a view's estimate
//! counts what the view allocates, and what a scene's views share once (#3016).

use std::collections::BTreeSet;

use deep_canvas_scene3d::label::{PAGE, PAGES};
use deep_canvas_scene3d::scene::Scene;

use crate::mesh::FLOATS;
use crate::{
    env, local, shadow, Planted, SolidRecord, CULLED_ITEMS, DEPTH, IDS, IDS_MS, LINEAR, MSAA,
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

/// What the renderers drawing `scene` hold beside the view's slots and upscale:
/// - each internal pixel: the linear, ID and depth targets, the geometry pass's stored samples
///   of the IDs and depth (its color's are memoryless), and, while a list is culled on the GPU,
///   the cull's prepass depth at those samples and its pyramid, a third more for its mips; and
///   a quarter of the same for a mirror's own view, which draws at half the internal size
///   (#2691);
/// - whatever that size: each view's own (each solid's record, the glyph atlas where a label
///   draws, the key sun's cascades or its single map, counted whether or not a post reads it,
///   and the local lights' maps), for the view, its mirror's view, and each view inset's view
///   and its mirror's at the inset's own size (#3016); and, once for every view of the scene,
///   what they share: the meshes and material maps they draw, the environment's cubes, and
///   wgpu's buffers that validate a culled list's indirect draws.
pub fn of(scene: &Scene) -> Held {
    of_planted(scene, &Planted::default())
}

/// [`of`] under `planted`'s wrong estimate, if any.
pub fn of_planted(scene: &Scene, planted: &Planted) -> Held {
    let own = view(scene, planted);
    // The device makes them once, whichever renderer draws indirectly first.
    let indirect = if culls(scene) { INDIRECT_VALIDATION } else { 0 };
    let cubes = scene.sky.as_ref().map_or(0, env::bytes);
    let (meshes, maps) = assets(scene);
    Held {
        fixed: own.fixed + indirect + cubes + meshes + maps,
        ..own
    }
}

/// What one view of `scene` holds of its own, with its mirror's view and its view insets'; the
/// planted estimate_maps_per_view counts the maps again in each other view.
fn view(scene: &Scene, planted: &Planted) -> Held {
    let samples = u64::from(MSAA);
    let mut per_px =
        (texel(LINEAR) + texel(IDS) + texel(DEPTH) + samples * (texel(IDS_MS) + texel(DEPTH)))
            as f64;
    if culls(scene) {
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
    let labelled = scene.layers.iter().any(|l| !l.labels.is_empty());
    let atlas = u64::from(labelled)
        * (u64::from(PAGE).pow(2) * PAGES as u64 * texel(wgpu::TextureFormat::R8Unorm));
    let mut fixed = records + atlas + shadows + local::bytes(scene);
    let again = |s: &Scene| u64::from(planted.estimate_maps_per_view) * assets(s).1;
    if let Some(m) = &scene.mirror {
        let seen = deep_canvas_scene3d::mirror::view(scene, m, scene.size);
        let own = view(&seen, planted);
        per_px += own.per_px / 4.0;
        fixed += own.fixed + again(&seen);
    }
    // A view inset draws at its own size (an eye inset at the frame's), whatever the view's
    // internal scale, with its own mirror at half that.
    for v in &scene.views {
        let seen = deep_canvas_scene3d::views::seen(scene, v);
        let own = view(&seen, planted);
        let px = f64::from(seen.size[0]) * f64::from(seen.size[1]);
        fixed += (own.per_px * px) as u64 + own.fixed + again(&seen);
    }
    Held { per_px, fixed }
}

/// The bytes the device holds for the meshes and for the material maps `scene` draws, each once
/// however many solids and views draw it (#3016; Material: texture maps, Cost).
fn assets(scene: &Scene) -> (u64, u64) {
    let (mut meshes, mut maps) = (BTreeSet::new(), BTreeSet::new());
    let (mut mesh_bytes, mut map_bytes) = (0, 0);
    let layers = scene.sources.as_deref().into_iter().flatten();
    for s in scene.layers.iter().chain(layers).flat_map(|l| &l.solids) {
        if meshes.insert(s.shape) {
            mesh_bytes += match &s.mesh {
                Some(m) => (m.positions.len() * FLOATS * 4 + m.indices.len() * 4) as u64,
                None => {
                    let (v, i) = crate::mesh::geometry(s.shape);
                    ((v.len() + i.len()) * 4) as u64
                }
            };
        }
        for (_, slot) in s.maps.iter().flat_map(|m| m.slots()) {
            let Some(t) = slot.as_ref().and_then(|x| scene.texels.get(x.key())) else {
                continue;
            };
            if maps.insert((slot.as_ref().map(|x| x.key()), &t.format)) {
                map_bytes += t.data.len() as u64;
            }
        }
    }
    (mesh_bytes, map_bytes)
}

/// Whether a list is culled on the GPU: a layer of more items than the line, or an instancer's
/// batch.
fn culls(scene: &Scene) -> bool {
    scene
        .layers
        .iter()
        .any(|l| l.solids.len() > CULLED_ITEMS || l.solids.iter().any(|s| s.batch != 0))
}
