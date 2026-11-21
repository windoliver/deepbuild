//! #2657.88046eaf (AC1): on the noop lane, a frame of one deforming solid under motion blur with
//! the core velocity target on makes no index buffer and derives no tangent for a side mesh, read
//! from the counted device and counted by the test. On the merge base it makes four index buffers
//! a frame, and the test fails, naming the count.
//!
//! A built pot (a lathe) under a still camera, its scene given the evaluations at t ∓ s/2 as the
//! GPU layer's view hands them over, to blur (`Scene::motion`) and to the core velocity target
//! (`Scene::velocity`) alike: its pre-skins at t − s/2 and t + s/2, vertex
//! for vertex with its mesh at t, scaled about its origin by 1 ∓ 0.01 n in frame n, so every side
//! vertex moves each frame. Its rigid twin is the same frame with the pot's pre-skins left out
//! (`meshes: None`), so the twin's counts are what everything but the side meshes makes. Both draw
//! with the core velocity target on. Frames 2 and 3 are read (frame 1 builds the pot's own mesh).
//! Surfaces: the counted device's `index_buffers` and the renderer's `tangents_derived()`
//! (README: Surfaces).

mod common;

use std::collections::BTreeMap;
use std::sync::Arc;

use common::*;
use deep_canvas_scene3d::scene::{Motion, MotionSolid, Scene};
use deep_gpu::counted::Reading;
use deep_scene3d_render::Planted;
use serde_json::json;

const ID: &str = "#2657.88046eaf";

fn pot() -> serde_json::Value {
    doc(
        vec![
            ("cam".into(), camera([0.0, 1.0, 0.0], 8.0)),
            ("clay".into(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
            ("pot".into(), json!({"kind": "lathe@1", "params": {"outline": [[0.3, 0, false], [0.6, 0.8, false], [0.4, 1.6, false], [0.5, 2, false]], "segments": 24}, "material": "clay", "at": {"pos": [0, 0, 0]}})),
        ],
        json!({}),
        SIZE,
    )
}

/// The scene with motion blur's evaluations for frame `n`: every solid where it stands, and the
/// pot's pre-skins when `deforms`.
fn blurred(base: &Scene, n: u32, deforms: bool) -> Scene {
    let mut scene = base.clone();
    let mesh = solid(&scene, "pot").mesh.clone().expect("the pot is a built mesh");
    let side = |k: f64| {
        let mut m = (*mesh).clone();
        for p in &mut m.positions {
            *p = p.map(|x| x * k);
        }
        Arc::new(m)
    };
    let mut moving = BTreeMap::new();
    for s in solids(&scene) {
        let meshes = (deforms && s.id == "pot").then(|| (side(1.0 - 0.01 * f64::from(n)), side(1.0 + 0.01 * f64::from(n))));
        moving.insert(s.id.clone(), MotionSolid { open: s.model, close: s.model, meshes });
    }
    let motion = Arc::new(Motion {
        open: scene.camera.clone(),
        close: scene.camera.clone(),
        solids: moving,
        taps: 16,
        max_px: 32.0,
        tile_px: 20,
    });
    // Blur reads `motion`; the core velocity target reads `velocity`, the same evaluations.
    scene.motion = Some(motion.clone());
    scene.velocity = Some(motion);
    scene
}

/// Frames 1 to 3 of the pot under blur with the velocity target on: each frame's reading and the
/// tangents the renderer derived in it.
fn frames(base: &Scene, deforms: bool) -> Vec<(Reading, u64)> {
    let device = noop();
    let mut r = renderer(&device, Planted::default());
    let mut out = Vec::new();
    for n in 1..=3 {
        let scene = blurred(base, n, deforms);
        r.core.want.velocity = true;
        let tangents = deep_scene3d_render::tangents_derived();
        let made = frame(&device, &mut r, &scene);
        out.push((made, deep_scene3d_render::tangents_derived() - tangents));
    }
    no_errors(&device);
    out
}

#[test]
fn ac1_a_deforming_solid_s_side_meshes_make_no_index_buffer_and_derive_no_tangent() {
    let base = scene(&pot(), 0);
    let vertices = solid(&base, "pot").mesh.as_ref().map_or(0, |m| m.positions.len()) as u64;
    assert!(vertices > 0, "{ID}: the pot has vertices");
    let deforming = frames(&base, true);
    let rigid = frames(&base, false);
    let mut problems = Vec::new();
    for n in [2usize, 3] {
        let ((d, dt), (r, rt)) = (deforming[n - 1], rigid[n - 1]);
        if d.index_buffers != r.index_buffers {
            problems.push(format!(
                "frame {n} makes {} index buffers, {} more than its rigid twin's {}: the side meshes' (expected none)",
                d.index_buffers,
                d.index_buffers.saturating_sub(r.index_buffers),
                r.index_buffers
            ));
        }
        if dt != rt {
            problems.push(format!(
                "frame {n} derives {dt} tangents, {} more than its rigid twin's {rt}: the side meshes' (expected none)",
                dt.saturating_sub(rt)
            ));
        }
        // Guard: the side meshes reach the GPU. Their positions alone, f32 x, y, z, are 12 bytes a
        // vertex; at least one side's worth must go up in a frame where every side vertex moved.
        let more = d.uploaded.saturating_sub(r.uploaded);
        if more < 12 * vertices {
            problems.push(format!(
                "frame {n} uploads {} bytes against its rigid twin's {}: {more} more, under one side's positions ({} bytes for {vertices} vertices), so the side meshes aren't drawn",
                d.uploaded,
                r.uploaded,
                12 * vertices
            ));
        }
    }
    assert!(problems.is_empty(), "{ID}: a deforming pot of {vertices} vertices under motion blur with the core velocity target on:\n{}", problems.join("\n"));
}
