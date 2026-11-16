//! The GPU-layer adapter and its declared pass costs. Public entry remains the crate root.

use crate::{
    ao, clouds, cull, dof, hdr, history, inset, local, lock, read_texture, texture2d, After,
    Planted, Post, Renderer, CASCADE_PASS, CULL_PASS, FLARE_PASS, GEOMETRY_PASS, LABEL_PASS,
    MIRROR_PASS, MSAA, OUTLINE_PASS, OUTPUT_PASS, SHADOW_PASS, SHARPEN_PASS, UPSCALE_PASS,
    WATER_PASS,
};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// The key light's direction, toward the light: what shades the solids and casts the shadow map.
pub const LIGHT: [f64; 3] = [0.35, 0.8, 0.5];

/// The depth pyramid's declared cost per pixel (#1637): 0.385 ms at 1920 × 1080 in the city
/// walk, the median of four frames on an M5 Max (Mac17,10).
pub const PYRAMID_NS_PER_PX: f32 = 0.186;

/// The GPU's pass timer (issue #380: frame GPU time, measured with wgpu-profiler).
pub type Profiler = Arc<Mutex<wgpu_profiler::GpuProfiler>>;

/// Runs `f`, which records one render pass, with that pass's timestamps going to `profiler`
/// under `label` when one is set.
pub fn timed(
    profiler: &Option<Profiler>,
    label: &'static str,
    encoder: &mut wgpu::CommandEncoder,
    f: impl FnOnce(&mut wgpu::CommandEncoder, Option<wgpu::RenderPassTimestampWrites<'_>>),
) {
    match profiler {
        Some(p) => {
            let p = lock(p);
            let q = p.begin_pass_query(label, encoder);
            f(encoder, q.render_pass_timestamp_writes());
            p.end_query(encoder, q);
        }
        None => f(encoder, None),
    }
}

/// What one frame's preparation did (Render worker; Object; Dirty classes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Counts {
    /// Each batch encoded this frame, with every item it draws.
    pub encoded: Vec<(String, Vec<String>)>,
    /// Batches replayed from an earlier encoding.
    pub replayed: u32,
    pub instances_written: u32,
    /// #1921: per instancer, the element IDs whose records this frame wrote to the GPU.
    pub element_uploads: BTreeMap<String, Vec<u32>>,
    /// #537: per line, its segments (by place) whose records this frame wrote to the GPU.
    pub segment_uploads: BTreeMap<String, Vec<u32>>,
    /// Compute culls run this frame: one per batch and view that changed (#484).
    pub culls: u32,
    /// Whether this frame built the camera's depth pyramid (#1637).
    pub pyramid: bool,
    /// Indexed indirect draws this frame, one per batch and view drawn (#484).
    pub indirect_draws: u32,
    /// Elements the CPU tested for a view this frame: only ever the reference's (#484).
    pub cpu_culled: u32,
    /// Counts read back to the CPU this frame: only ever the planted program's (#484).
    pub counts_read_back: u32,
    /// Each indirect draw this frame: its instancer, its view and its batch (#484).
    pub indirect: Vec<(String, String, String)>,
    pub meshes_built: u32,
    /// The lights the light policy left out of this frame's view, by ID (#421).
    pub lights_left_out: Vec<String>,
    /// The lights asking for a shadow that the shadow budget left without one, by ID (#421).
    pub shadows_dropped: Vec<String>,
    /// Each material operator this frame couldn't draw, `(operator, why)`: its solids draw with
    /// their material's own values, and a caller refuses the frame (#429).
    pub operators_refused: Vec<(String, String)>,
    /// Each material operator whose light response returned a negative or non-finite value
    /// this frame, with the time it drew at, once per operator and time (#485:
    /// `light_response.range`).
    pub light_response_range: Vec<(String, f64)>,
    /// The key sun's cascades drawn this frame, by index; a cached one isn't (#422).
    pub cascades_drawn: Vec<u32>,
    /// How many environment cubes the renderer has prefiltered (#422).
    pub env_builds: u32,
    /// This frame's cascade split distances along the view axis, from the near plane to the
    /// last cascade's far end (#422).
    pub cascade_splits: Vec<f64>,
    /// The fragments this frame's per-pixel items wrote, and whether they ran out of room at
    /// the class's cap, so they drew sorted (#424: `fragments_capped`).
    pub fragments: u64,
    pub fragments_capped: bool,
    /// Each shadow map the key sun draws from this frame: its key and its texel in m (#424).
    pub shadow_maps: Vec<(u64, f64, [f64; 16])>,
    /// Each shadowed local light's map this frame (#446).
    pub local_maps: Vec<local::Report>,
    /// #537: per terrain overlay (`<plate>/<layer>`), the runs of rows this frame wrote.
    pub overlay_rows: BTreeMap<String, Vec<[u32; 2]>>,
    /// #538: per instancer fed by logic and per plate with overlays, the CPU time in ms from the
    /// start of writing this frame's changed slot records (or overlay cells) to the return of the
    /// queue's write of them: a proof reading of the upload's cost.
    pub upload_ms: BTreeMap<String, f64>,
}

/// What a frame hands the passes another render module adds between scene3d's geometry and its
/// output (issue #380: the effects chain and bloom): the 3D targets, the camera, and the key
/// light's shadow map when that module asked for it.
pub struct PostFrame<'a> {
    pub size: [u32; 2],
    pub linear: &'a wgpu::TextureView,
    pub depth: &'a wgpu::TextureView,
    pub ids: &'a wgpu::TextureView,
    pub shadow: Option<&'a wgpu::TextureView>,
    /// World to clip, column-major (reversed Z, no far plane).
    pub clip: [f64; 16],
    pub eye: [f64; 3],
    pub near: f64,
    /// World to the shadow map's clip space, column-major (depth 0 nearest the light).
    pub light_clip: Option<[f64; 16]>,
    /// Each item's pick ID.
    pub picks: &'a BTreeMap<String, u32>,
    /// The core's velocity and emission targets this frame, where something reads them (#431).
    pub core: Vec<(&'static str, &'a wgpu::TextureView)>,
    /// #463: the rectangle, px at `size`, a look region's other side draws inside (Scene::crop).
    pub crop: Option<[u32; 4]>,
}

/// What a frame hands the passes after the finish (issue #382: the status guard and the status
/// colors): the finished frame, display-referred and sRGB-encoded in f32, and the slot they write.
pub struct AfterFrame<'a> {
    pub size: [u32; 2],
    pub finished: &'a wgpu::TextureView,
    /// What the guard writes: the slot, or below scale 1 the internal frame the upscale reads
    /// (#386).
    pub guarded: &'a wgpu::TextureView,
    pub slot: &'a wgpu::TextureView,
}

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
    /// The next frame's HDR surface, when the view presents one (#177).
    pub hdr: Option<HdrFrame>,
}

/// A live frame's HDR surface (#177): the texture it writes and the display's headroom then.
#[derive(Clone, Debug)]
pub struct HdrFrame {
    pub into: wgpu::TextureView,
    pub headroom: f32,
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
            hdr: None,
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
        // #506: the unlit projected insets, under the outlines and labels.
        passes.push(pass(
            inset::UNLIT_PASS,
            2,
            vec!["depth", "ids"],
            vec!["slot"],
            0.05,
            Determinism::SameMachine,
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
            hdr,
            ..
        } = &mut *s;
        let Some(renderer) = renderer.as_mut() else {
            return Vec::new();
        };
        renderer.clouds.clone_from(clouds);
        renderer.hdr.clone_from(hdr);
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
            // #506: each view inset's own view, drawn before the geometry reads it.
            Pass {
                name: inset::VIEW_PASS.into(),
                place: "shadows",
                order: 3,
                reads: Vec::new(),
                writes: Vec::new(),
                resolution: Resolution::Full,
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
            // #468: depth of field, after geometry and before bloom, only while a frame has one.
            Pass {
                name: dof::DOF_PASS.into(),
                place: "effects",
                order: 0,
                reads: vec!["linear", "depth"],
                writes: vec!["linear"],
                resolution: Resolution::Full,
                ns_per_px: 0.4,
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
            // #177: the HDR surface, live only, after every pass that writes the slot; a frame
            // with no HDR surface doesn't run it.
            Pass {
                name: hdr::HDR_PASS.into(),
                place: "overlays",
                order: u32::MAX,
                reads: vec!["linear", "slot"],
                writes: vec!["hdr surface"],
                resolution: Resolution::Full,
                ns_per_px: 0.02,
                determinism: Determinism::LiveOnly,
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
