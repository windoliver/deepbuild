//! The GPU-layer adapter and its declared pass costs. Public entry remains the crate root.

use crate::{
    ao, clouds, cull, history, local, lock, read_texture, texture2d, After, Planted, Post,
    Renderer, CASCADE_PASS, CULL_PASS, FLARE_PASS, GEOMETRY_PASS, LABEL_PASS, MIRROR_PASS, MSAA,
    OUTLINE_PASS, OUTPUT_PASS, PYRAMID_NS_PER_PX, SHADOW_PASS, SHARPEN_PASS, UPSCALE_PASS,
    WATER_PASS,
};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;
use std::sync::{Arc, Mutex};

/// What the GPU-layer view and the driver share: the next frame's scene and look, and the
/// renderer, which the render module builds on the view's device.
pub struct Shared {
    pub next: Option<(Arc<Scene>, Look3)>,
    pub renderer: Option<Renderer>,
    pub planted: Planted,
    /// Passes another render module adds between geometry and output.
    pub post: Option<Box<dyn Post>>,
    /// Passes after the finish: the status guard and the status colors, where status can show.
    pub after: Option<Box<dyn After>>,
    /// The next frame's point sets from a depth video, as the driver's effects wrote them (#503).
    pub clouds: clouds::Clouds,
    /// Samples a pixel its renderer's geometry pass draws (#173: one under temporal upscaling).
    pub samples: u32,
}

/// scene3d as the GPU layer's render module: one view's renderer.
pub struct Module3 {
    shared: Arc<Mutex<Shared>>,
}

impl Module3 {
    pub fn new(planted: Planted) -> (Module3, Arc<Mutex<Shared>>) {
        let shared = Arc::new(Mutex::new(Shared {
            next: None,
            renderer: None,
            planted,
            post: None,
            after: None,
            clouds: Default::default(),
            samples: if planted.single_sample { 1 } else { MSAA },
        }));
        (
            Module3 {
                shared: shared.clone(),
            },
            shared,
        )
    }
}

impl RenderModule for Module3 {
    fn name(&self) -> &'static str {
        "scene3d@1"
    }

    fn declared(&self) -> Vec<&'static str> {
        vec![
            "frame:buffer",
            "tone:buffer",
            "instances:buffer",
            "meshes:buffer",
            "glyph atlas:texture",
            "linear:texture",
            "ids:texture",
            "depth:texture",
            "shader:shader_module",
            "draws:render_pipeline",
            "output:render_pipeline",
            "finished:texture",
            "batches:render_bundle",
        ]
    }

    fn passes(&self) -> Vec<Pass> {
        let s = lock(&self.shared);
        let mut passes = self.own_passes();
        // Below internal scale 1, the upscale's two passes; then thin lines and outlines at
        // full size (#386).
        let pass = |name: &str, order, reads, writes, ns_per_px, determinism| Pass {
            name: name.into(),
            place: "upscale",
            order,
            reads,
            writes,
            resolution: Resolution::Full,
            ns_per_px,
            determinism,
        };
        passes.push(pass(
            UPSCALE_PASS,
            0,
            vec!["slot"],
            vec!["upscaled"],
            0.08,
            Determinism::LiveOnly,
        ));
        passes.push(pass(
            SHARPEN_PASS,
            1,
            vec!["upscaled"],
            vec!["slot"],
            0.04,
            Determinism::LiveOnly,
        ));
        // Or frame history's resolve, from the window into the slot (#173).
        passes.push(pass(
            history::RESOLVE_PASS,
            1,
            vec!["depth"],
            vec!["slot"],
            0.4,
            Determinism::LiveOnly,
        ));
        passes.push(pass(
            OUTLINE_PASS,
            2,
            vec!["depth"],
            vec!["slot"],
            0.01,
            Determinism::SameMachine,
        ));
        passes.push(pass(
            LABEL_PASS,
            3,
            vec!["depth"],
            vec!["slot"],
            0.01,
            Determinism::SameMachine,
        ));
        if let Some(after) = s.after.as_ref() {
            passes.extend(after.passes());
        }
        let Some(post) = s.post.as_ref() else {
            return passes;
        };
        passes.push(Pass {
            name: SHADOW_PASS.into(),
            place: "shadows",
            order: 0,
            reads: Vec::new(),
            writes: vec!["shadow"],
            resolution: Resolution::Full,
            ns_per_px: 0.05,
            determinism: Determinism::SameMachine,
        });
        passes.extend(post.passes());
        passes
    }

    fn build(&mut self, device: &Device) -> Result<(), String> {
        let mut s = lock(&self.shared);
        let planted = s.planted;
        if !planted.builds_on_first_frame {
            s.renderer = Some(Renderer::sampled(device, planted, s.samples));
        }
        Ok(())
    }

    fn built_on(&self) -> Option<u64> {
        lock(&self.shared).renderer.as_ref().map(Renderer::epoch)
    }

    fn layers(&mut self, device: &Device, target: &Target) -> Vec<(String, Job)> {
        let mut s = lock(&self.shared);
        let Some((scene, look)) = s.next.clone() else {
            return Vec::new();
        };
        // The planted renderer compiles everything it draws with here, in the frame.
        if s.renderer.is_none() && s.planted.builds_on_first_frame {
            s.renderer = Some(Renderer::sampled(device, s.planted, s.samples));
        }
        let Shared {
            renderer,
            post,
            after,
            clouds,
            ..
        } = &mut *s;
        let Some(renderer) = renderer.as_mut() else {
            return Vec::new();
        };
        renderer.clouds.clone_from(clouds);
        // The instances outputs the frame's instancers draw from (#484).
        if let Some(p) = post.as_deref_mut() {
            renderer.feed(p.sources(device));
        }
        renderer.prepare(device, &scene, &look);
        renderer.stage_window(device, &scene);
        renderer.jobs(
            device,
            &target.view,
            post.as_deref_mut().map(|p| p as &mut dyn Post),
            after.as_deref_mut().map(|a| a as &mut dyn After),
        )
    }
}

impl Module3 {
    /// scene3d's own passes: geometry and the output.
    fn own_passes(&self) -> Vec<Pass> {
        vec![
            // Instancers above 256 elements, culled per view (#484): a batch's cost is its
            // elements', never its pixels'.
            Pass {
                name: CULL_PASS.into(),
                place: "compute",
                // After the document's own compute, whose kept rows it reads.
                order: u32::MAX,
                reads: Vec::new(),
                writes: vec!["rows"],
                resolution: Resolution::Full,
                ns_per_px: 0.0,
                determinism: Determinism::SameMachine,
            },
            // The camera's occluders and the depth pyramid built from them (#1637): its cost is the
            // pyramid's, a read of every sample and the levels above.
            Pass {
                name: cull::PYRAMID_PASS.into(),
                place: "compute",
                order: u32::MAX,
                reads: vec!["rows"],
                writes: vec!["rows"],
                resolution: Resolution::Full,
                ns_per_px: PYRAMID_NS_PER_PX,
                determinism: Determinism::SameMachine,
            },
            // The key sun's cascades (#422), each drawn only when its key changed.
            Pass {
                name: CASCADE_PASS.into(),
                place: "shadows",
                order: 1,
                reads: Vec::new(),
                writes: vec!["cascades"],
                resolution: Resolution::Full,
                ns_per_px: 0.05,
                determinism: Determinism::SameMachine,
            },
            // Local-light shadow maps (#446).
            Pass {
                name: local::PASS.into(),
                place: "shadows",
                order: 2,
                reads: Vec::new(),
                writes: vec!["local_maps"],
                resolution: Resolution::Full,
                ns_per_px: 0.05,
                determinism: Determinism::SameMachine,
            },
            // One scheduled AO job records prepass, occlusion and blur. This declaration is
            // their aggregate estimate, not the occlusion-only timestamp scope (#2516).
            Pass {
                name: ao::OCCLUSION.into(),
                place: "geometry",
                order: 0,
                reads: Vec::new(),
                writes: vec!["ao"],
                resolution: Resolution::Full,
                ns_per_px: 0.6,
                determinism: Determinism::SameMachine,
            },
            Pass {
                name: GEOMETRY_PASS.into(),
                place: "geometry",
                order: 0,
                reads: Vec::new(),
                writes: vec!["linear", "ids", "depth"],
                resolution: Resolution::Full,
                ns_per_px: 0.5,
                determinism: Determinism::SameMachine,
            },
            // #465: the mirror's view and its picture, drawn only while a frame has a mirror.
            Pass {
                name: MIRROR_PASS.into(),
                place: "geometry",
                order: 1,
                reads: vec!["ids"],
                writes: vec!["linear"],
                resolution: Resolution::Half,
                ns_per_px: 0.5,
                determinism: Determinism::SameMachine,
            },
            // #166: the water's parts, after the mirror's view, drawn only while a frame has water.
            Pass {
                name: WATER_PASS.into(),
                place: "geometry",
                order: 2,
                reads: vec!["linear", "depth"],
                writes: vec!["linear", "ids", "depth"],
                resolution: Resolution::Full,
                ns_per_px: 0.3,
                determinism: Determinism::SameMachine,
            },
            // #465: the flare, after the effects' bloom, drawn only while a frame has one.
            Pass {
                name: FLARE_PASS.into(),
                place: "bloom",
                order: u32::MAX,
                reads: vec!["depth"],
                writes: vec!["linear"],
                resolution: Resolution::Full,
                ns_per_px: 0.1,
                determinism: Determinism::SameMachine,
            },
            Pass {
                name: OUTPUT_PASS.into(),
                place: "tone_mapping",
                order: 0,
                reads: vec!["linear"],
                writes: vec!["slot"],
                resolution: Resolution::Full,
                ns_per_px: 0.1,
                determinism: Determinism::SameMachine,
            },
        ]
    }
}

/// Draws one frame offscreen on `device` (a snapshot): BGRA8 bytes, rows top-down; `None` on a
/// backend with no pixels.
pub fn draw_offscreen(
    device: &Device,
    renderer: &mut Renderer,
    scene: &Scene,
    look: &Look3,
    post: Option<&mut dyn Post>,
) -> Option<Vec<u8>> {
    let size = scene.size;
    let texture = texture2d(
        &device.device,
        "scene3d snapshot",
        size,
        FORMAT,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    renderer.prepare(device, scene, look);
    let mut encoder = device.device.create_command_encoder(&Default::default());
    for (_, job) in renderer.jobs(
        device,
        &texture.create_view(&Default::default()),
        post,
        None,
    ) {
        job(&mut encoder);
    }
    device.queue.submit([encoder.finish()]);
    read_texture(device, &texture, size, 4)
}
