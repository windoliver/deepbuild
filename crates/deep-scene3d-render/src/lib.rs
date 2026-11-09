//! scene3d's render module (issue #378): see the crate manifest.
//!
//! A frame: the scene's camera and look go into two small uniform buffers; each 3D writer layer's
//! batch writes the instance records that changed and keeps its render bundle while its draw key
//! holds, so a move or a recolor writes one record and encodes nothing, and a presence change (an
//! item added or removed) encodes that batch alone again. The geometry pass clears the linear,
//! object-ID and depth targets and replays every batch's bundle; the output pass reads the linear
//! target and writes the slot.

pub mod ao;
pub mod cull;
pub mod created;
mod diag;
pub mod env;
pub mod flare;
mod glass;
pub mod local;
pub mod maps;
mod mesh;
pub mod mirror;
mod motion;
mod oit;
mod op;
pub mod print;
pub mod shadow;
pub mod sss;
pub mod status;
pub mod surface;
pub mod targets;
pub mod water;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::label::{half_fraction, AtlasPage, PAGE, PAGES};
use deep_canvas_scene3d::light::{self, AlphaMode, LightKind, SHADED};
use deep_canvas_scene3d::look::{Look3, ToneMap};
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Adjust3, Depth, Facing, Layer3, PointShape, Scene, Shape, Solid};
use deep_canvas_scene3d::sky::{Curve, Fog};
use deep_canvas_scene3d::{clusters, cut};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;

pub use crate::diag::{draw_offscreen_diag, Diag, DiagCounts};
use crate::mesh::Mesh;
use crate::surface::{Low, Surface, Upscale, LABEL_PASS, OUTLINE_PASS, SHARPEN_PASS, UPSCALE_PASS};

/// The 3D writer layers' linear target: what the output pass reads.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// The object-ID target: each pixel the pick ID of the item drawn there, 0 for none.
pub const IDS: wgpu::TextureFormat = wgpu::TextureFormat::R32Uint;
pub const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// The geometry pass's sample count (#1173), which the GPU surface reports as its `msaa`.
pub const MSAA: u32 = 4;
/// The multisampled object-ID target's format: each ID as two 16-bit halves, since a 32-bit
/// integer format needn't multisample.
const IDS_MS: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Uint;
/// The planted forward-Z twin's far plane.
pub const FORWARD_FAR: f64 = 10_000.0;

const SHADER: &str = include_str!("scene3d.wgsl");
const MASK_DUMP: &str = include_str!("mask_dump.wgsl");
/// The line that plants #425's per-band mask keys.
const MASKS_SHARED: &str = "const MASKS_INDEPENDENT: bool = false;";
/// The line that plants #484's object IDs by a row's place in the compacted list.
const IDS_BY_ROW: &str = "const IDS_BY_PLACE: bool = false;";

/// The scene shader, with #425's planted masks when asked.
fn shader(planted: &Planted) -> String {
    let mut source = SHADER.to_string();
    if planted.band_masks_independent {
        source = source.replace(MASKS_SHARED, "const MASKS_INDEPENDENT: bool = true;");
    }
    if planted.ids_by_compacted_place {
        source = source.replace(IDS_BY_ROW, "const IDS_BY_PLACE: bool = true;");
    }
    source
}

/// A pass whose band masks [`Renderer::mask_dump`] reports (#425).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaskPass {
    Color,
    Depth,
    Shadow,
    Ids,
}
const OUTPUT: &str = include_str!("output.wgsl");
const OUTLINE: &str = include_str!("outline.wgsl");
const BUSY: &str = include_str!("busy.wgsl");
const LABEL: &str = include_str!("label.wgsl");
const RESOLVE: &str = include_str!("resolve.wgsl");
/// The pass that draws the key light's shadow map, in the frame's shadows place.
pub const SHADOW_PASS: &str = "scene3d.shadow";
/// The sky's pipeline, drawn first in the geometry pass behind everything (#422).
pub const SKY_PASS: &str = "scene3d.sky";
/// The puffs' pipeline (#422).
pub const PUFF_PASS: &str = "scene3d.puff";
/// The pass resolving the geometry pass's object IDs and depth (#1173).
pub const RESOLVE_PASS: &str = "scene3d.sample_resolve";
pub use deep_canvas_scene3d::module::{
    CASCADE_PASS, CULL_PASS, FLARE_PASS, MIRROR_PASS, WATER_PASS,
};

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Depth cleared to 1, compared less, with a finite far plane at 10 km.
    pub forward_z: bool,
    /// #431: the emission target is the color target's excess over 1, never the emitted radiance.
    pub emission_thresholds_color: bool,
    /// #431: a material operator's `sample_grad` takes implicit derivatives.
    pub sample_grad_implicit: bool,
    /// #431: the opaque scene's copy is taken after the see-through parts draw.
    pub backdrop_after_see_through: bool,
    /// The output pass encodes its result twice.
    pub encodes_twice: bool,
    /// The output pass writes the tone-mapped linear value unencoded.
    pub skips_encode: bool,
    /// Every batch encodes again every frame; nothing replays.
    pub encodes_every_frame: bool,
    /// A batch keeps replaying its old encoding after its draw key changed.
    pub replays_after_add: bool,
    /// #383: every frame adds a pass that keeps the GPU busy for at least 10 ms.
    pub slow_gpu_frame: bool,
    /// #854: the renderer and its pipelines are compiled in the first frame, not when the view
    /// opens.
    pub builds_on_first_frame: bool,
    /// #386: the upscale's wrong programs.
    pub upscale: surface::Planted,
    /// #386: outlines draw at the internal size, before the upscale.
    pub outlines_before_upscale: bool,
    /// #386: status outlines draw at the internal size, before the upscale.
    pub status_before_upscale: bool,
    /// #386: status outlines draw with no depth test.
    pub status_without_depth: bool,
    /// #421: a solid's front faces chosen without its world determinant's sign.
    pub winding_ignores_determinant: bool,
    /// #465: the flare's wrong programs.
    pub flare: flare::Planted,
    /// #166: the water's wrong program.
    pub water: water::Planted,
    /// #421: opaque solids submitted in an order that turns over each frame, ties left to the
    /// depth test.
    pub ties_by_submission: bool,
    /// #421: a spot's lumens spread over its cone, cd = lm ÷ 2π(1 − cos outer).
    pub spot_counts_cone: bool,
    /// #421: status outlines drawn through the tone map.
    pub status_before_tone_map: bool,
    /// #423: every mipmapped map sampled at anisotropy 1, so the mip follows the footprint's
    /// long axis.
    pub anisotropy_one: bool,
    /// #422: the shading core mixes metallic into one F0 before shading.
    pub premixed_metallic: bool,
    /// #422: the specular lobes lose single scattering's missing energy.
    pub uncompensated_lobe: bool,
    /// #422: only environment light is compensated.
    pub compensates_environment_only: bool,
    /// #422: every final target black.
    pub draws_black: bool,
    /// #422: the puffs aren't drawn.
    pub drops_clouds: bool,
    /// #422: a cascade's map reused while the scene's solid count holds.
    pub cascade_cache_keeps_stale: bool,
    /// #422: the environment prefiltered one roughness mip per frame from the session's first.
    pub prefilter_over_frames: bool,
    /// #1174: screen-size labels draw in the geometry pass at the internal size, before the
    /// upscale, as the base drew them.
    pub labels_before_upscale: bool,
    /// #425: each band of an item inside its margin keeps pixels by its own hash.
    pub band_masks_independent: bool,
    /// #424: an additive part writes depth; one draws without the depth test.
    pub add_writes_depth: bool,
    pub add_without_depth_test: bool,
    /// #424: the object-ID pass writes an element's place in its draw, not its stable ID; it
    /// writes a mask part's ID through the holes its cutoff leaves.
    pub ids_by_draw_position: bool,
    pub ids_ignore_mask: bool,
    /// #424: a cutaway clips the color pass alone, never the shadow passes.
    pub cuts_color_only: bool,
    /// #1173: the geometry pass draws one sample a pixel, as the base drew it.
    pub single_sample: bool,
    /// #1173: each frame's resolve blends in half of the previous frame's.
    pub resolve_accumulates: bool,
    /// #428's and #481's shading plants as the shader's bits (scene3d.wgsl: `P_*`), 0 for none.
    pub lobes: u32,
    /// #446: the local maps' wrong programs.
    pub local: local::Planted,
    /// #484: the cull's wrong programs.
    pub cull: cull::Plants,
    /// #484: the object-ID pass writes a row's place in the compacted list.
    pub ids_by_compacted_place: bool,
    /// #484: a batch draws the count its last frame's cull read back to the CPU.
    pub count_read_back: bool,
}

/// What one frame's preparation did (Render worker; Object; Dirty classes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Counts {
    /// Each batch encoded this frame, with every item it draws.
    pub encoded: Vec<(String, Vec<String>)>,
    /// Batches replayed from an earlier encoding.
    pub replayed: u32,
    pub instances_written: u32,
    /// Compute culls run this frame: one per batch and view that changed (#484).
    pub culls: u32,
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
}

/// The key light's direction, toward the light: what the solids are shaded by and what casts the
/// shadow map.
pub const LIGHT: [f64; 3] = [0.35, 0.8, 0.5];

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
}

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

/// The outline pass's draws, ready to record into a target: thin lines and strokes, and the
/// status outlines, which draw as the status colors.
pub struct OutlineDraw {
    pipeline: wgpu::RenderPipeline,
    output: wgpu::BindGroup,
    frame: wgpu::BindGroup,
    /// The glyph atlas, for the label pass's draw (#1174).
    atlas: Option<wgpu::BindGroup>,
    sets: Vec<(wgpu::Buffer, u32)>,
    statuses: Vec<(wgpu::Buffer, u32)>,
}

impl OutlineDraw {
    /// The strokes' and lines' draw, and the status outlines' apart, when there are any.
    pub fn split(mut self) -> (OutlineDraw, Option<OutlineDraw>) {
        let statuses = std::mem::take(&mut self.statuses);
        let apart = (!statuses.is_empty()).then(|| OutlineDraw {
            pipeline: self.pipeline.clone(),
            output: self.output.clone(),
            frame: self.frame.clone(),
            atlas: None,
            sets: statuses,
            statuses: Vec::new(),
        });
        (self, apart)
    }

    /// Records the draws (the status outlines too, unless split off) over `target`.
    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        deep_gpu::alloc::outside(|| {
            let label = if self.atlas.is_some() {
                LABEL_PASS
            } else {
                OUTLINE_PASS
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                timestamp_writes: timestamps,
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.output, &[]);
            pass.set_bind_group(1, &self.frame, &[]);
            if let Some(atlas) = &self.atlas {
                pass.set_bind_group(2, atlas, &[]);
            }
            for (buffer, n) in self.sets.iter().chain(&self.statuses) {
                pass.set_vertex_buffer(0, buffer.slice(..));
                pass.draw(0..6, 0..*n);
            }
        });
    }
}

/// Passes after the finish: with one attached, the output pass writes the finished frame instead
/// of the slot, and these passes write the slot from it.
pub trait After: Send {
    /// The passes it adds to the frame, each into its place, for the frame's plan.
    fn passes(&self) -> Vec<Pass>;
    /// The passes' encodes, in frame order.
    fn jobs(&mut self, device: &Device, frame: &AfterFrame<'_>) -> Vec<(String, Job)>;
    /// What it draws over the finished frame this frame, premultiplied RGBA at the frame's size:
    /// the finish leaves those pixels undithered (#418: deband never touches status colors or
    /// legends).
    fn covers(&self) -> Option<status::Layer> {
        None
    }
}

/// Passes between geometry and output, with the targets they read.
pub trait Post: Send {
    /// The document's instances outputs, each drawn from the frame's own compute (#484).
    fn sources(&mut self, _: &Device) -> Vec<cull::Source> {
        Vec::new()
    }
    /// The passes it may add to the frame, each into its place, for the frame's plan.
    fn passes(&self) -> Vec<Pass> {
        Vec::new()
    }
    /// Whether this frame draws the key light's shadow map.
    fn shadows(&self) -> bool;
    /// The passes' encodes, in frame order, and the linear target the output pass reads in place
    /// of the geometry's.
    fn jobs(
        &mut self,
        device: &Device,
        frame: &PostFrame<'_>,
    ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>);
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct FrameUniform {
    /// Column-major.
    clip: [[f32; 4]; 4],
    right: [f32; 4],
    up: [f32; 4],
    viewport: [f32; 4],
    light: [f32; 4],
    /// This target's px per device px, which lines it draws, the depth target's px per px of
    /// this target, and 1 for the planted forward Z (scene3d.wgsl's `px`).
    px: [f32; 4],
    /// The sky's ambient light from above and below, linear RGB, w 1 with a sky (#418).
    sky_top: [f32; 4],
    sky_low: [f32; 4],
    /// Clip to world (column-major), and the eye with the near plane in w (#429).
    inverse_clip: [[f32; 4]; 4],
    eye: [f32; 4],
    /// The cutaway's planes, each its normal and offset (#424), and how many, whether it
    /// intersects, its cap (bit 0: drawn, bit 1: lit) and 0; the cap's role, linear RGB.
    cut: [[f32; 4]; cut::MAX_PLANES],
    cut_info: [u32; 4],
    cap: [f32; 4],
}

/// The most distinct adjusts a frame shades with (#424): its adjust table's entries.
const ADJUSTS: usize = 256;

/// scene3d.wgsl's `Adjust`: exposure, contrast, gamma and hue; saturation, brightness, invert and
/// whether it tints; the tint, linear RGB.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct AdjustEntry {
    a: [f32; 4],
    b: [f32; 4],
    tint: [f32; 4],
}

impl AdjustEntry {
    fn of(a: &Adjust3) -> AdjustEntry {
        let tint = a
            .tint
            .map_or([1.0; 4], |t| [t[0] as f32, t[1] as f32, t[2] as f32, 1.0]);
        AdjustEntry {
            a: [
                a.exposure as f32,
                a.contrast as f32,
                a.gamma as f32,
                a.hue as f32,
            ],
            b: [
                a.saturation as f32,
                a.brightness as f32,
                if a.invert { 1.0 } else { 0.0 },
                tint[3],
            ],
            tint: [tint[0], tint[1], tint[2], 0.0],
        }
    }
}

/// scene3d.wgsl's `P_SSS_ACROSS` (#481): the planted spread that takes every tap.
const PLANT_SSS_ACROSS: u32 = 8192;

/// The most distinct lobe sets a frame shades with (#428): its lobe table's entries.
const LOBE_ENTRIES: usize = 512;

/// scene3d.wgsl's `LobeEntry` (#428): a material's extra lobes, as [`lobe_entry`] packs them.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LobeEntry {
    v: [[f32; 4]; 8],
}

/// A material's lobes as the shader reads them; `seed` its flake seed, the pattern seed's hash.
fn lobe_entry(l: &light::Lobes, seed: u32, scale: f64) -> LobeEntry {
    let c = |v: [f64; 3], w: f64| [v[0] as f32, v[1] as f32, v[2] as f32, w as f32];
    LobeEntry {
        v: [
            c(l.sheen, l.sheen_roughness),
            [
                l.anisotropy as f32,
                l.anisotropy_rotation as f32,
                l.diffuse_roughness as f32,
                l.retroreflection as f32,
            ],
            c(l.translucency, l.wrap.unwrap_or(-1.0)),
            [
                l.transmission as f32,
                l.ior as f32,
                l.dispersion as f32,
                (l.thickness * scale) as f32,
            ],
            c(l.attenuation, l.iridescence),
            [
                l.film_ior as f32,
                l.film_nm as f32,
                l.flake_weight as f32,
                l.flake_size as f32,
            ],
            c(l.flakes, l.flake_cos_tilt),
            [
                f32::from_bits(seed),
                l.amount as f32,
                l.subsurface as f32,
                0.0,
            ],
        ],
    }
}

/// A subsurface part's second entry (#481), right after its [`lobe_entry`]: the lobe's color
/// (w 1 when set, 0 for the base color), its mean free paths in m and whether it's thin.
fn subsurface_entry(l: &light::Lobes) -> Option<LobeEntry> {
    let c = |v: [f64; 3], w: f32| [v[0] as f32, v[1] as f32, v[2] as f32, w];
    (l.subsurface > 0.0).then(|| {
        let mut v = [[0.0; 4]; 8];
        v[0] = c(
            l.subsurface_color.unwrap_or([0.0; 3]),
            f32::from(u8::from(l.subsurface_color.is_some())),
        );
        v[1] = c(l.subsurface_radius, f32::from(u8::from(l.subsurface_thin)));
        LobeEntry { v }
    })
}

/// Where a material's entries sit in the lobe table: its [`lobe_entry`], with its
/// [`subsurface_entry`] right after it when it has one.
fn lobes_at(table: &[LobeEntry], e: &LobeEntry, sub: Option<&LobeEntry>) -> Option<usize> {
    let same = |a: &LobeEntry, b: &LobeEntry| bytemuck::bytes_of(a) == bytemuck::bytes_of(b);
    (0..table.len()).find(|&k| {
        same(&table[k], e) && sub.is_none_or(|s| table.get(k + 1).is_some_and(|t| same(t, s)))
    })
}

/// scene3d.wgsl's `Lights`: the view, the light count and the lights the policy shades (#421).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LightsUniform {
    view: [f32; 4],
    count: [u32; 4],
    /// Each cascade's far end along the view's forward axis, and its texel in m (#422).
    splits: [f32; 4],
    texels: [f32; 4],
    forward: [f32; 4],
    cascades: [[[f32; 4]; 4]; 4],
    /// Each cascade's depth range in m (#446).
    depths: [f32; 4],
    /// Soft shadows' mode, blocker taps, filter taps and most texels of penumbra (#446).
    soft: [f32; 4],
    /// tan of half the key sun's angle; 1 with a contact shadow; the sample's turn and its flag.
    key: [f32; 4],
    local_size: [f32; 4],
    /// x: 1 with a light grid; y: its far plane (#446).
    grid: [f32; 4],
    locals: [LocalUniform; local::SLOTS],
    items: [[[f32; 4]; 6]; SHADED],
}

/// scene3d.wgsl's `Local` (#446).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LocalUniform {
    clip: [[f32; 4]; 4],
    pos: [f32; 4],
    info: [f32; 4],
    size: [f32; 4],
}

/// scene3d.wgsl's `Env` (#422): the environment's irradiance coefficients, its mix's, and how to
/// read its cubes.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct EnvUniform {
    sh: [[f32; 4]; 9],
    sh_to: [[f32; 4]; 9],
    k: [f32; 4],
    m: [f32; 4],
    inv: [[f32; 4]; 4],
    eye: [f32; 4],
    top: [f32; 4],
    low: [f32; 4],
    moon: [f32; 4],
    fog: [f32; 4],
    fog_color: [f32; 4],
    bg: [f32; 4],
    /// The sun the sky follows: toward it, the cosine of its disk's radius (w 2 with none); its
    /// disk's radiance.
    sun: [f32; 4],
    sun_color: [f32; 4],
}

/// Our DFG table (#421): for 32 cosines of the view angle across and 32 roughnesses down, the
/// GGX lobe's directional albedo split as F0·A + F90·B, by Hammersley importance sampling in
/// f64, two entries to a vec4. Its samples include both ends, so roughness 1 and a view along the
/// normal are read exactly (#422's white furnace).
fn dfg_table() -> Vec<[f32; 4]> {
    const N: u32 = 1024;
    let mut out = vec![[0f32; 4]; 512];
    for j in 0..32u32 {
        let rough = f64::from(j) / 31.0;
        let a = (rough * rough).max(1e-4);
        let a2 = a * a;
        for i in 0..32u32 {
            let nv = (f64::from(i) / 31.0).max(1.0 / 64.0);
            let v = [(1.0 - nv * nv).sqrt(), 0.0, nv];
            let (mut sa, mut sb) = (0.0, 0.0);
            for k in 0..N {
                let u = (f64::from(k) + 0.5) / f64::from(N);
                let w = f64::from(k.reverse_bits()) / 4_294_967_296.0;
                let phi = std::f64::consts::TAU * u;
                let cos_t = ((1.0 - w) / (1.0 + (a2 - 1.0) * w)).sqrt();
                let sin_t = (1.0 - cos_t * cos_t).sqrt();
                let h = [sin_t * phi.cos(), sin_t * phi.sin(), cos_t];
                let vh = v[0] * h[0] + v[1] * h[1] + v[2] * h[2];
                let nl = 2.0 * vh * h[2] - v[2];
                if nl <= 0.0 || vh <= 0.0 {
                    continue;
                }
                let gv = nl * (nv * nv * (1.0 - a2) + a2).sqrt();
                let gl = nv * (nl * nl * (1.0 - a2) + a2).sqrt();
                // V × 4 n·l v·h ÷ n·h: the sample's weight under GGX importance sampling.
                let g = 0.5 / (gv + gl) * 4.0 * nl * vh / h[2];
                let fc = (1.0 - vh).powi(5);
                sa += (1.0 - fc) * g;
                sb += fc * g;
            }
            let e = (j * 32 + i) as usize;
            let at = &mut out[e / 2][(e % 2) * 2..(e % 2) * 2 + 2];
            at[0] = (sa / f64::from(N)) as f32;
            at[1] = (sb / f64::from(N)) as f32;
        }
    }
    // The sheen table's entries, written the first time a scene shades sheen (#428).
    out.resize(1024, [0.0; 4]);
    out
}

/// The sheen lobe's directional albedo (#428): ∫ D V (n·l) dω of Charlie's distribution and
/// Estevez and Kulla's visibility (KHR_materials_sheen) at α = max(roughness, 10⁻³)², on the
/// grid of 64 cos views by 32 sheen roughnesses, packed four to an entry after the DFG table.
fn sheen_table() -> Vec<[f32; 4]> {
    use std::f64::consts::PI;
    let l = |x: f64, a: f64| {
        let t = (1.0 - a) * (1.0 - a);
        let m = |p: f64, q: f64| p + (q - p) * t;
        m(21.5473, 25.3245) / (1.0 + m(3.82987, 3.32435) * x.powf(m(0.19823, 0.16801)))
            + m(-1.97760, -1.27393) * x
            + m(-4.32054, -4.85967)
    };
    let lambda = |c: f64, a: f64| {
        if c < 0.5 {
            l(c, a).exp()
        } else {
            (2.0 * l(0.5, a) - l(1.0 - c, a)).exp()
        }
    };
    const T: u32 = 128;
    const P: u32 = 64;
    let mut flat = vec![0f32; 2048];
    for j in 0..32u32 {
        let r = f64::from(j) / 31.0;
        let a = r.max(1e-3).powi(2);
        for i in 0..64u32 {
            let nv = (f64::from(i) / 63.0).max(1.0 / 128.0);
            let v = [(1.0 - nv * nv).sqrt(), 0.0, nv];
            let mut e = 0.0;
            for ti in 0..T {
                let th = (f64::from(ti) + 0.5) * PI / 2.0 / f64::from(T);
                let (st, ct) = th.sin_cos();
                for pi in 0..P {
                    let ph = (f64::from(pi) + 0.5) * 2.0 * PI / f64::from(P);
                    let lv = [st * ph.cos(), st * ph.sin(), ct];
                    let h = [v[0] + lv[0], v[1] + lv[1], v[2] + lv[2]];
                    let hl = (h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).sqrt();
                    let nh = h[2] / hl;
                    let sin2 = (1.0 - nh * nh).max(1e-7);
                    let d = (2.0 + 1.0 / a) * sin2.powf(0.5 / a) / (2.0 * PI);
                    let vis = (1.0 / ((1.0 + lambda(nv, a) + lambda(ct, a)) * 4.0 * nv * ct))
                        .clamp(0.0, 1.0);
                    e += d * vis * ct * st;
                }
            }
            let dw = (PI / 2.0 / f64::from(T)) * (2.0 * PI / f64::from(P));
            flat[(j * 64 + i) as usize] = (e * dw).min(1.0) as f32;
        }
    }
    flat.chunks(4).map(|c| [c[0], c[1], c[2], c[3]]).collect()
}

/// A text record's flag: the label pass draws its color after the upscale (scene3d.wgsl).
const LATER: u32 = 256;
/// A segment record's flags in the outline pass (outline.wgsl).
const EXACT: u32 = 2;
const UNTESTED: u32 = 4;
const OUTLINED: u32 = 8;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ToneUniform {
    exposure: f32,
    map: u32,
    white: f32,
    contrast: f32,
    encode: u32,
    deband: f32,
    saturation: f32,
    graded: u32,
    wb: [[f32; 4]; 3],
    slope: [f32; 4],
    offset: [f32; 4],
    power: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SolidRecord {
    rows: [[f32; 4]; 3],
    color: u32,
    pick: u32,
    /// Object's shadow flags: [`NO_CAST`] and [`NO_RECEIVE`] (#420); its material's (#421).
    flags: u32,
    /// Its rank among the frame's solids by ID, which breaks coplanar depth ties (#421).
    tie: u32,
    /// Its material's emission, linear RGB, and its coverage in w (#418).
    emission: [f32; 4],
    /// Its material's base color (linear) and its pattern's scale (a catcher's strength);
    /// metallic, roughness, specular level and coat; specular color and coat roughness (#421).
    base: [f32; 4],
    surface: [f32; 4],
    specular: [f32; 4],
    /// Its material operator's time in seconds (f32 bits), its seed, and the item's opacity (f32
    /// bits), which the operator's alpha multiplies (#429).
    op: [u32; 4],
}

/// #446's planted wrong program's bit in the shader's planted word (scene3d.wgsl).
const FILTER_IN_TEXELS: u32 = 1 << 30;
/// A solid the shadow pass leaves out (`cast_shadow: false`).
const NO_CAST: u32 = 1;
/// A solid no shadow falls on (`receive_shadow: false`), for the passes that shade one.
const NO_RECEIVE: u32 = 2;
/// A solid its material shades under the lights; whose world determinant is negative; unlit;
/// seen from both sides (scene3d.wgsl).
const MATERIAL: u32 = 4;
const MIRRORED: u32 = 8;
const UNLIT: u32 = 16;
const DOUBLE_SIDED: u32 = 32;
/// A shadow catcher; its alpha mode from bit 7; its pattern from bit 9 and its seed from bit 16
/// (scene3d.wgsl).
const CATCH: u32 = 64;
/// Its material samples texture maps (#423), its group 3.
const MAPS: u32 = 8192;
/// The cutaway reaches it (#424).
const CUT: u32 = 16384;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SegmentRecord {
    a: [f32; 4],
    b: [f32; 4],
    color: u32,
    pick: u32,
    flags: u32,
    /// A mesh-edge line's dash and gap in its size space, as two f16 (#1640), or 0.
    dash: u32,
}

/// `x` ≥ 0 as an IEEE half's bits, its mantissa cut toward zero and capped at the largest half;
/// 0 below the smallest normal half, which `unpack2x16float` reads back.
fn half_bits(x: f64) -> u32 {
    let x = x as f32;
    if !(x >= 6.103_515_6e-5) {
        return 0;
    }
    let b = x.min(65504.0).to_bits();
    (((b >> 23) - 112) << 10) | ((b >> 13) & 0x3ff)
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PointRecord {
    p: [f32; 4],
    color: u32,
    pick: u32,
    flags: u32,
    pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
/// One glyph of a label: the label's anchor and em, the glyph's quad from the label's centre in
/// ems (x right, y down), its texels on its atlas page, the label's axes (each `w` the fraction
/// of half its box on that axis, for the label pass), and `flags`: world size, facing, the page,
/// and [`LATER`].
struct TextRecord {
    p: [f32; 4],
    rect: [f32; 4],
    uv: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    color: u32,
    pick: u32,
    flags: u32,
    pad: u32,
}

/// A solid's instance record: `tie` its rank by ID, `winding` false for the planted program that
/// ignores its determinant.
fn solid_record(
    s: &Solid,
    pick: u32,
    tie: u32,
    winding: bool,
    maps: bool,
    adjust: u32,
) -> SolidRecord {
    let m = &s.model;
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let mut flags = if s.cast_shadow { 0 } else { NO_CAST }
        | if s.receive_shadow { 0 } else { NO_RECEIVE }
        | if s.cut { CUT } else { 0 };
    let f = |v: [f64; 3], w: f64| [v[0] as f32, v[1] as f32, v[2] as f32, w as f32];
    let (mut base, mut surface, mut specular) = ([0.0; 4], [0.0; 4], [0.0; 4]);
    if let Some(mat) = &s.material {
        let mode = match mat.alpha_mode {
            // An opaque part at an adjust opacity below 1 blends (#424).
            AlphaMode::Opaque if faded(s) => 2,
            AlphaMode::Opaque => 0,
            AlphaMode::Mask => 1,
            AlphaMode::Blend => 2,
            AlphaMode::Add => 3,
        };
        flags |= MATERIAL
            | if winding && det < 0.0 { MIRRORED } else { 0 }
            | if mat.unlit { UNLIT } else { 0 }
            | if mat.double_sided { DOUBLE_SIDED } else { 0 }
            | if mat.catch.is_some() { CATCH } else { 0 }
            | if maps { MAPS } else { 0 }
            | mode << 7
            | mat.pattern << 9
            | (mat.pattern_seed & 0xffff) << 16;
        // Its coverage is the record's emission.w (#418); its base's w carries the pattern's
        // scale, or a catcher's strength.
        let b = [mat.base[0], mat.base[1], mat.base[2]];
        base = f(b, mat.catch.unwrap_or(mat.pattern_scale));
        surface = f([mat.metallic, mat.roughness, mat.specular_level], mat.coat);
        specular = f(mat.specular_color, mat.coat_roughness);
    }
    // A cast-only level never shades: its surface's w carries its inset (#425).
    if s.cast_only {
        flags |= INSET;
        surface[3] = s.inset as f32;
    }
    let mut op = s.op.as_ref().map_or([0; 4], |o| {
        let alpha = s.material.map_or(1.0, |m| m.base[3]);
        let opacity = if alpha > 0.0 {
            (s.alpha / alpha).min(1.0)
        } else {
            1.0
        };
        [
            (o.t as f32).to_bits(),
            op::seed(o.doc_seed, &s.id),
            (opacity as f32).to_bits(),
            0,
        ]
    });
    // Its adjust's entry in the frame's adjust table, 0 for none (#424; Object: adjust).
    op[3] = adjust;
    SolidRecord {
        rows: m.map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32]),
        // A material's color word holds the receiver sets it belongs to (#446): its own color is
        // its base, and the lights are what reads the word.
        color: if s.material.is_some() {
            s.receiver_sets
        } else {
            pack(s.color)
        },
        pick,
        flags,
        tie: tie | mask_code(s.mask) << 20,
        emission: v4(s.emission, s.alpha),
        base,
        surface,
        specular,
        op,
    }
}

/// Each solid's tie rank (#421, #428): only solids whose bounds overlap can share a face, so
/// each takes, in ID order, the least rank no overlapping solid of an earlier ID holds. Two
/// solids that could tie always differ and keep their order every frame, while the depth push
/// stays a few ranks deep, so a thin part just in front of another is never pushed behind it.
fn tie_ranks<'a>(solids: impl Iterator<Item = &'a Solid>) -> BTreeMap<String, u32> {
    const TOUCH: f64 = 1e-5;
    let mut list: Vec<(&str, [f64; 3], [f64; 3])> = solids
        .map(|s| {
            let corners = match &s.mesh {
                Some(m) => {
                    let [lo, hi] = m.bounds();
                    (0..8)
                        .map(|c| {
                            let p = [0, 1, 2].map(|k| if c >> k & 1 == 0 { lo[k] } else { hi[k] });
                            [0, 1, 2].map(|r| {
                                let m = &s.model[r];
                                m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3]
                            })
                        })
                        .collect::<Vec<_>>()
                }
                None => deep_canvas_scene3d::scene::corners(&s.model),
            };
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            for c in corners {
                for k in 0..3 {
                    lo[k] = lo[k].min(c[k] - TOUCH);
                    hi[k] = hi[k].max(c[k] + TOUCH);
                }
            }
            (s.id.as_str(), lo, hi)
        })
        .collect();
    list.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let n = list.len();
    let mut by_x: Vec<usize> = (0..n).collect();
    by_x.sort_unstable_by(|a, b| list[*a].1[0].total_cmp(&list[*b].1[0]));
    let mut earlier: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut active: Vec<usize> = Vec::new();
    for &i in &by_x {
        active.retain(|&j| list[j].2[0] >= list[i].1[0]);
        for &j in &active {
            if (1..3).all(|k| list[i].1[k] <= list[j].2[k] && list[j].1[k] <= list[i].2[k]) {
                earlier[i.max(j)].push(i.min(j));
            }
        }
        active.push(i);
    }
    let mut ranks = vec![0u32; n];
    let mut used = Vec::new();
    for i in 0..n {
        used.clear();
        used.extend(earlier[i].iter().map(|&j| ranks[j]));
        used.sort_unstable();
        let mut r = 0;
        for &u in &used {
            if u == r {
                r += 1;
            } else if u > r {
                break;
            }
        }
        ranks[i] = r;
    }
    list.iter()
        .zip(ranks)
        .map(|((id, ..), r)| (id.to_string(), r))
        .collect()
}

/// A record's flag: a cast-only level drawn inside its surface by its inset (#425).
const INSET: u32 = 1 << 15;

/// A world matrix's determinant: negative for a mirror.
fn det(m: &[[f64; 4]; 3]) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

/// The key sun's shadow map texels per m at a world point (#425): the cascade that holds the
/// point's view depth, none where the scene's sun casts no cascaded shadow or none holds it.
pub fn shadow_texels(scene: &Scene, size: u32) -> impl Fn([f64; 3]) -> Option<f64> {
    let cascades = scene
        .sun
        .as_ref()
        .filter(|_| scene.cascaded() && scene.camera.perspective)
        .map(|sun| shadow::cascades(scene, sun.toward, &sun.cascades, size, None, true))
        .unwrap_or_default();
    let camera = scene.camera.clone();
    move |p| {
        let depth = camera.to_view(p)[2];
        cascades
            .iter()
            .find(|c| depth >= c.near && depth <= c.far)
            .map(|c| f64::from(size) / (2.0 * c.radius.max(1e-9)))
    }
}

/// Whether a scene's solids still carry a level of detail to resolve (#425).
fn leveled(scene: &Scene) -> bool {
    scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .any(|s| s.lod.is_some())
}

/// A band's mask as the shader reads it above the record's rank (#425): bit 8 masked, bit 7 the
/// less detailed band, bits 0 to 6 the blend level.
fn mask_code(mask: Option<deep_canvas_scene3d::lod::Mask>) -> u32 {
    mask.map_or(0, |m| {
        256 | if m.lower { 128 } else { 0 } | m.level.min(127)
    })
}
/// Whether a solid draws see-through after a depth pass of its own: its item's adjust opacity is
/// below 1 (#424; Object: adjust).
fn faded(s: &Solid) -> bool {
    s.adjust.as_ref().is_some_and(|a| a.opacity < 1.0)
        && s.material.is_none_or(|m| m.alpha_mode != AlphaMode::Add)
}

/// What kind of see-through draw a solid takes, as `clear_pipelines` holds them: blend, add,
/// or a fade's depth pass then its blend.
const BLEND: u8 = 0;
const ADD: u8 = 1;
const FADE: u8 = 2;
/// A per-pixel item's fragments into the lists (#424); index 4, after the fade's two.
const PER_PIXEL: u8 = 4;
/// A blend or add part drawn after the glass, with its pipeline (#428).
/// A culled batch's draw into one view: its mesh's vertices and indices, its records' group, and
/// the row list and indirect arguments its cull wrote (#484).
type RowDraw = (
    wgpu::Buffer,
    wgpu::Buffer,
    wgpu::BindGroup,
    wgpu::Buffer,
    wgpu::Buffer,
);

type LateDraw = (
    wgpu::RenderPipeline,
    (
        wgpu::Buffer,
        wgpu::Buffer,
        u32,
        wgpu::Buffer,
        u32,
        wgpu::BindGroup,
    ),
);

/// A transmissive part (#428): drawn after the geometry pass over the opaque scene's copy.
const GLASS: u8 = 5;

/// Whether a solid transmits light (#428; Material: transmission).
fn transmits(s: &Solid) -> bool {
    s.material.is_some_and(|m| {
        m.lobes.transmission > 0.0 && !m.alpha_mode.see_through() && m.catch.is_none()
    })
}

/// Whether a solid's subsurface lobe spreads (#481): an opaque or masked lit part drawn in the
/// geometry pass by the scene shader, which the share pass draws again. Any other keeps its
/// diffuse whole.
fn spreads(s: &Solid) -> bool {
    s.material.is_some_and(|m| {
        m.lobes.subsurface > 0.0 && !m.unlit && m.catch.is_none() && !m.alpha_mode.see_through()
    }) && !s.per_pixel
        && !faded(s)
        && !transmits(s)
        && s.op.is_none()
        && s.batch == 0
}

/// A solid's lobes as its draw shades them: its subsurface off where it doesn't spread.
fn drawn_lobes(s: &Solid, l: &light::Lobes) -> light::Lobes {
    let mut l = *l;
    if !spreads(s) {
        l.subsurface = 0.0;
    }
    l
}

fn pack(c: [u8; 3]) -> u32 {
    u32::from_le_bytes([c[0], c[1], c[2], 255])
}

fn v4(v: [f64; 3], w: f64) -> [f32; 4] {
    [v[0] as f32, v[1] as f32, v[2] as f32, w as f32]
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn extent([width, height]: [u32; 2]) -> wgpu::Extent3d {
    wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    }
}

/// A 2D texture of `size`: one layer, one mip, one sample.
/// #464: one frame's print pass, recorded after the output into where the output would write.
struct PrintStage {
    device: wgpu::Device,
    printer: Arc<Mutex<print::Printer>>,
    params: print::Params,
    source: wgpu::TextureView,
    ids: wgpu::TextureView,
    masks: Vec<u32>,
    format: wgpu::TextureFormat,
}

impl PrintStage {
    fn record(&self, encoder: &mut wgpu::CommandEncoder, into: &wgpu::TextureView) {
        let coverage = print::Coverage::Ids(&self.ids, self.masks.clone());
        self.printer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .record(
                &self.device,
                encoder,
                &self.params,
                &self.source,
                &coverage,
                into,
                self.format,
                None,
            );
    }
}

pub(crate) fn texture2d(
    d: &wgpu::Device,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    multisampled(d, 1, label, size, format, usage)
}

/// `texture2d` with `samples` samples a pixel (#1173).
fn multisampled(
    d: &wgpu::Device,
    samples: u32,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    d.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: extent(size),
        mip_level_count: 1,
        sample_count: samples,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

/// Writes `bytes`, `row` bytes a row, over layer `z` of `texture`, `size` texels.
pub(crate) fn write_texture(
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    z: u32,
    bytes: &[u8],
    row: u32,
    size: [u32; 2],
) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d { x: 0, y: 0, z },
            aspect: wgpu::TextureAspect::All,
        },
        bytes,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(row),
            rows_per_image: Some(size[1]),
        },
        extent(size),
    );
}

/// A bind group binding `resources` at 0, 1, 2… in order.
pub(crate) fn bind_group<const N: usize>(
    d: &wgpu::Device,
    label: &str,
    layout: &wgpu::BindGroupLayout,
    resources: [wgpu::BindingResource<'_>; N],
) -> wgpu::BindGroup {
    let mut binding = 0;
    let entries = resources.map(|resource| {
        binding += 1;
        wgpu::BindGroupEntry {
            binding: binding - 1,
            resource,
        }
    });
    d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &entries,
    })
}

/// A fragment-stage layout entry for a non-filterable 2D texture at binding 0.
pub(crate) fn texture_entry() -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding: 0,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

pub(crate) fn buffer_entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BufferBindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

/// One color target, every channel written.
pub(crate) fn target(
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
) -> Option<wgpu::ColorTargetState> {
    Some(wgpu::ColorTargetState {
        format,
        blend,
        write_mask: wgpu::ColorWrites::ALL,
    })
}

/// A shadow map's pipeline: the solids' vertex stage under a light's clip matrix, depth only,
/// nearest the light kept, with what lies past its near and far planes clamped where the device
/// can (`fs`, its fragment stage, only discards).
pub(crate) fn shadow_pipeline(
    d: &wgpu::Device,
    label: &str,
    layout: &wgpu::PipelineLayout,
    module: &wgpu::ShaderModule,
    (vs, buffers): (&str, &[Option<wgpu::VertexBufferLayout>]),
    fs: &str,
) -> wgpu::RenderPipeline {
    d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vs),
            compilation_options: Default::default(),
            buffers,
        },
        primitive: wgpu::PrimitiveState {
            unclipped_depth: d.features().contains(wgpu::Features::DEPTH_CLIP_CONTROL),
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: shadow::FORMAT,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fs),
            compilation_options: Default::default(),
            targets: &[],
        }),
        multiview_mask: None,
        cache: None,
    })
}

/// A render pipeline over `module`: its vertex stage `vs` reading `buffers`, and its fragment
/// stage, when given, into `targets`.
pub(crate) fn pipeline(
    d: &wgpu::Device,
    label: &str,
    layout: Option<&wgpu::PipelineLayout>,
    module: &wgpu::ShaderModule,
    vertex: (&str, &[Option<wgpu::VertexBufferLayout<'_>>]),
    fragment: Option<(&str, &[Option<wgpu::ColorTargetState>])>,
    depth_stencil: Option<wgpu::DepthStencilState>,
) -> wgpu::RenderPipeline {
    culled(
        d,
        1,
        label,
        layout,
        module,
        vertex,
        fragment,
        depth_stencil,
        None,
    )
}

/// [`pipeline`] drawing `samples` samples a pixel (the geometry pass's, #1173) and culling
/// `cull`'s faces.
#[allow(clippy::too_many_arguments)]
fn culled(
    d: &wgpu::Device,
    samples: u32,
    label: &str,
    layout: Option<&wgpu::PipelineLayout>,
    module: &wgpu::ShaderModule,
    (vs, buffers): (&str, &[Option<wgpu::VertexBufferLayout<'_>>]),
    fragment: Option<(&str, &[Option<wgpu::ColorTargetState>])>,
    depth_stencil: Option<wgpu::DepthStencilState>,
    cull: Option<wgpu::Face>,
) -> wgpu::RenderPipeline {
    specialized(d, samples, label, layout, module, (vs, buffers), fragment, depth_stencil, cull, &[])
}

/// [`culled`] with the module's pipeline-overridable `constants` set (#432: a feature set's
/// pipeline).
#[allow(clippy::too_many_arguments)]
fn specialized(
    d: &wgpu::Device,
    samples: u32,
    label: &str,
    layout: Option<&wgpu::PipelineLayout>,
    module: &wgpu::ShaderModule,
    (vs, buffers): (&str, &[Option<wgpu::VertexBufferLayout<'_>>]),
    fragment: Option<(&str, &[Option<wgpu::ColorTargetState>])>,
    depth_stencil: Option<wgpu::DepthStencilState>,
    cull: Option<wgpu::Face>,
    constants: &[(&str, f64)],
) -> wgpu::RenderPipeline {
    let options = wgpu::PipelineCompilationOptions {
        constants,
        ..Default::default()
    };
    d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout,
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vs),
            compilation_options: options.clone(),
            buffers,
        },
        primitive: wgpu::PrimitiveState {
            cull_mode: cull,
            ..Default::default()
        },
        depth_stencil,
        multisample: wgpu::MultisampleState {
            count: samples,
            ..Default::default()
        },
        fragment: fragment.map(|(fs, targets)| wgpu::FragmentState {
            module,
            entry_point: Some(fs),
            compilation_options: options.clone(),
            targets,
        }),
        multiview_mask: None,
        cache: None,
    })
}

/// Records `copy` into a fresh encoder copying into a `size`-byte staging buffer, submits it, and
/// maps the buffer once the GPU is done; `None` when it can't be mapped.
pub(crate) fn read_back(
    device: &Device,
    label: &str,
    size: u64,
    copy: impl FnOnce(&mut wgpu::CommandEncoder, &wgpu::Buffer),
) -> Option<wgpu::BufferView> {
    let d = &device.device;
    let staging = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = d.create_command_encoder(&Default::default());
    copy(&mut encoder, &staging);
    device.queue.submit([encoder.finish()]);
    let (tx, rx) = mpsc::channel();
    staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return None;
    }
    staging.slice(..).get_mapped_range().ok()
}

/// One family's instance records in a batch, in a buffer of their own. A frame gathers its
/// records into `next` with [`Set::push`], kept from frame to frame, so a frame whose members
/// hold allocates nothing; [`Set::finish`] writes what changed.
#[derive(Default)]
struct Set {
    buffer: Option<wgpu::Buffer>,
    /// Which allocation the buffer is: a new one is a new resource in the draw key.
    generation: u64,
    capacity: usize,
    owners: Vec<String>,
    /// The records, each `stride` bytes, end to end.
    records: Vec<u8>,
    stride: usize,
    /// This frame's records and how many, and its owners once they differ from `owners`.
    next: Vec<u8>,
    count: usize,
    new_owners: Option<Vec<String>>,
    /// It holds a less detailed band's draw inside a margin (#425), which draws last.
    lower: bool,
    /// It holds a part whose subsurface spreads (#481), which the share pass draws again.
    subsurface: bool,
    /// Bumped whenever a record changes, which culls every view again (#484).
    revision: u64,
    /// An instancer's batch: its prototype's bounds, each record's row in the instancer, its
    /// records' f64 models while the renderer draws from the CPU's cull, and its cull (#484).
    bounds: [[f64; 3]; 2],
    elements: Vec<u32>,
    models: Vec<[[f64; 4]; 3]>,
    cull: Option<cull::Culled>,
}

impl Set {
    fn begin(&mut self) {
        self.next.clear();
        self.count = 0;
        self.new_owners = None;
        self.lower = false;
        self.subsurface = false;
        self.elements.clear();
        self.models.clear();
    }

    fn push(&mut self, owner: &str, record: &[u8]) {
        self.stride = record.len();
        if self.new_owners.is_none() && self.owners.get(self.count).is_none_or(|o| o != owner) {
            self.new_owners = Some(self.owners[..self.count].to_vec());
        }
        if let Some(owners) = self.new_owners.as_mut() {
            owners.push(owner.to_string());
        }
        self.next.extend_from_slice(record);
        self.count += 1;
    }

    /// Writes the records that changed, or all of them when the set's members changed. True when
    /// the members changed.
    fn finish(&mut self, device: &Device, next_generation: &mut u64, written: &mut u32) -> bool {
        if self.count != self.owners.len() && self.new_owners.is_none() {
            self.new_owners = Some(self.owners[..self.count].to_vec());
        }
        let stride = self.stride.max(16);
        let members_changed = self.new_owners.is_some() || self.buffer.is_none();
        if members_changed {
            if self.buffer.is_none() || self.capacity < self.count {
                self.capacity = self.count.max(1);
                *next_generation += 1;
                self.generation = *next_generation;
                self.buffer = Some(device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("scene3d instances"),
                    size: (stride * self.capacity) as u64,
                    // A culled batch's vertex stage reads its records from storage (#484).
                    usage: wgpu::BufferUsages::VERTEX
                        | wgpu::BufferUsages::STORAGE
                        | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let buffer = self.buffer.as_ref().expect("allocated above");
            if self.count > 0 {
                deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, 0, &self.next));
            }
            *written += self.count as u32;
            self.revision += 1;
            if let Some(owners) = self.new_owners.take() {
                self.owners = owners;
            }
        } else {
            let buffer = self
                .buffer
                .as_ref()
                .expect("a set with members has a buffer");
            // Each run of adjacent changed records goes in one write: a write per record made
            // a staging buffer per record, and a set that moves moves whole.
            let n = (self.next.len() / stride).min(self.records.len() / stride);
            let mut run: Option<usize> = None;
            for i in 0..=n {
                let at = i * stride..(i + 1) * stride;
                if i < n && self.next[at.clone()] != self.records[at] {
                    *written += 1;
                    self.revision += 1;
                    run.get_or_insert(i);
                } else if let Some(first) = run.take() {
                    let bytes = &self.next[first * stride..i * stride];
                    deep_gpu::alloc::outside(|| {
                        device
                            .queue
                            .write_buffer(buffer, (first * stride) as u64, bytes)
                    });
                }
            }
        }
        std::mem::swap(&mut self.records, &mut self.next);
        members_changed
    }

    /// Writes record `i` alone when it changed, the set's members as they were.
    fn write(&mut self, device: &Device, i: usize, record: &[u8], written: &mut u32) {
        let at = i * self.stride;
        let Some(old) = self.records.get_mut(at..at + record.len()) else {
            return;
        };
        if old != record {
            old.copy_from_slice(record);
            if let Some(buffer) = &self.buffer {
                deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, at as u64, record));
            }
            *written += 1;
            self.revision += 1;
        }
    }

    fn len(&self) -> u32 {
        self.owners.len() as u32
    }
}

/// A solid's set key (shape, maps (0: none; #423), material operator (0: none; #429) and its
/// instancer's (prototype, material) batch (0: none; #484)).
type SetKey = (Shape, u32, u64, u32);
/// A solid's set key, its record's place in that set, its pick ID and its tie rank.
type Slot = (SetKey, u32, u32, u32);

/// The bits of a slot's maps word above its maps' group index: which faces its opaque draw culls
/// (0 none, 1 back, 2 front).
const CULL_SHIFT: u32 = 30;
/// A set's bit for a part that shades extra lobes (#432: its feature set's pipeline), and for a
/// mask-alpha part (its caster kind in a shadow map).
const LOBES_BIT: u32 = 1 << 29;
const MASK_BIT: u32 = 1 << 28;
const MAPS_INDEX: u32 = MASK_BIT - 1;

/// A 3D writer layer's batch: its instance sets and its encoding.
#[derive(Default)]
struct Batch {
    /// The opaque solids by shape, material maps (0: none; #423; the faces their draw culls in
    /// the bits above, #425) and material operator ([`op::key`]; 0 for none; #429).
    solids: BTreeMap<SetKey, Set>,
    /// Solids only the shadow passes draw: a level the light's projection chose (#425).
    casters: BTreeMap<SetKey, Set>,
    lines: Set,
    points: Set,
    /// One record per inked glyph of its labels.
    labels: Set,
    bundle: Option<wgpu::RenderBundle>,
    /// Each solid's set, its record's place in that set, its pick ID and its tie rank, in the
    /// layer's solid order.
    solid_slots: Vec<Slot>,
    /// The see-through solids' records back to front, and each one's shape and whether it adds
    /// (#421: Object: see-through order).
    clear: Set,
    clear_draws: Vec<((Shape, u32), u8)>,
    /// Each see-through draw's material operator key (#431), 0 for none, as `clear_draws`.
    clear_ops: Vec<u64>,
    /// The resources and draws the bundle binds and records, as it was encoded, and this
    /// frame's, gathered in a buffer kept from frame to frame.
    key: Vec<u64>,
    next_key: Vec<u64>,
}

/// The core's glyph atlas on the GPU: one layer per page, each uploaded once per generation.
struct AtlasTexture {
    texture: wgpu::Texture,
    bind: wgpu::BindGroup,
    generations: Vec<Option<u32>>,
}

struct Targets {
    size: [u32; 2],
    linear: wgpu::Texture,
    linear_view: wgpu::TextureView,
    ids: wgpu::Texture,
    ids_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    output_bind: wgpu::BindGroup,
    drawn: Drawn,
}

/// What the geometry pass draws into and resolves into the targets everything after it reads
/// (#1173).
#[derive(Clone)]
struct Drawn {
    /// The multisampled color, transient, and the linear target it resolves into; the linear
    /// target alone at one sample.
    color: (wgpu::TextureView, Option<wgpu::TextureView>),
    ids_ms: wgpu::TextureView,
    depth_ms: wgpu::TextureView,
    ids: wgpu::TextureView,
    depth: wgpu::TextureView,
    resolve: (wgpu::RenderPipeline, wgpu::BindGroup),
    /// The planted resolve_accumulates_frames: its blend, the previous frame's copy, and whether
    /// one was drawn yet.
    accumulates: Option<(
        wgpu::RenderPipeline,
        wgpu::BindGroup,
        wgpu::Texture,
        Arc<AtomicBool>,
    )>,
}

/// The key light's shadow map and what draws it.
struct Shadow {
    /// The opaque casters' depth pipeline, and the mask-alpha casters', each made the first time
    /// a frame draws that caster kind into a shadow map (#432).
    pipeline: Option<wgpu::RenderPipeline>,
    mask: Option<wgpu::RenderPipeline>,
    buffer: wgpu::Buffer,
    bind: wgpu::BindGroup,
    view: Option<wgpu::TextureView>,
    /// This frame's light clip matrix, column-major.
    clip: Option<[f64; 16]>,
}

/// One culled list as its cull last wrote it (#484): its instancer, view and batch, and the kept
/// elements' stable IDs in compacted order.
pub struct KeptRow {
    pub item: String,
    pub view: String,
    pub batch: String,
    pub ids: Vec<u32>,
}

fn view_name(k: usize) -> String {
    match k {
        cull::CAMERA => "view".to_string(),
        cull::KEY_MAP => "key".to_string(),
        k => format!("cascade{}", k - cull::CASCADES),
    }
}

/// A batch's name: its (prototype mesh key, material).
fn batch_name(key: &SetKey) -> String {
    format!("{:x}.{}", shape_code(key.0), key.3)
}

/// A buffer's first word, to the CPU: only ever a report's, or the planted path's.
fn read_back_u32(device: &Device, buffer: &wgpu::Buffer) -> u32 {
    read_back(device, "scene3d cull count", 4, |e, staging| {
        e.copy_buffer_to_buffer(buffer, 0, staging, 0, 4)
    })
    .map_or(0, |b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// What a culled batch draws with (#484): the pipelines for each of the opaque solids', whose
/// vertex stage reads a row's record from storage.
struct Rows {
    kernels: cull::Kernels,
    layout: wgpu::PipelineLayout,
    opaque: wgpu::RenderPipeline,
    culled: [wgpu::RenderPipeline; 2],
    shadow: wgpu::RenderPipeline,
    cut: Option<wgpu::RenderPipeline>,
}

/// The key sun's cascades (#422): one depth layer each, drawn only when its key changes.
struct Cascaded {
    texture: Option<(wgpu::TextureView, Vec<wgpu::TextureView>)>,
    /// Each cascade's light frame, which the shadow pipeline's vertex stage reads.
    frames: Vec<(wgpu::Buffer, wgpu::BindGroup)>,
    /// What each cascade's drawn layer was made from: the sun's direction, its snapped
    /// projection, and every caster inside it.
    keys: [Option<u64>; 4],
    /// This frame's cascades, and the ones to draw.
    list: Vec<shadow::Cascade>,
    stale: Vec<usize>,
    fade: bool,
    /// The casters a sun that names its own draws (#446).
    casters: Option<BTreeSet<String>>,
    /// Each layer's side in texels: shadow::SIZE times the renderer's shadow scale.
    size: u32,
}

/// The environment's prefilter and what it made (#422).
struct EnvState {
    prefilter: env::Prefilter,
    buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// The cascades' comparison sampler (#422), kept here beside the lights' other sampler.
    compare: wgpu::Sampler,
    stub: wgpu::TextureView,
    cube: Option<env::Cube>,
    to: Option<env::Cube>,
    /// The blurred background's cubes (#426), from and to: one mip at the blur's roughness.
    bg: [Option<env::Cube>; 2],
}

/// A camera as the effects read it: world to clip (column-major), the eye and the near plane.
pub type Camera = ([f64; 16], [f64; 3], f64);

pub struct Renderer {
    planted: Planted,
    /// The diagnostic views' pipelines (#427), made on first use.
    diag: Option<Box<diag::Pipes>>,
    /// Motion blur by velocity (#419): its pipelines, and this frame's pass when it blurs.
    motion: motion::MotionPass,
    motion_frame: Option<motion::Frame>,
    /// The core's velocity and emission targets (#431), built only while read, and this frame's
    /// draws of them.
    pub core: targets::Core,
    velocity_frame: Option<motion::TargetFrame>,
    emission_frame: Option<targets::EmissionFrame>,
    epoch: u64,
    /// The material maps' textures and bind groups (#423), and the look's default taps.
    maps: maps::Store,
    filter_taps: u8,
    frame_buffer: wgpu::Buffer,
    frame_bind: wgpu::BindGroup,
    frame_layout: wgpu::BindGroupLayout,
    /// Each material operator's pipeline, by [`op::key`], compiled the first time a prepared
    /// scene holds it, or why it can't draw (#429).
    materials: BTreeMap<u64, Result<op::MatOp, String>>,
    /// Each material operator's group with one solid's maps, by (operator, maps) key.
    op_binds: BTreeMap<(u64, u32), wgpu::BindGroup>,
    /// The lights this frame's policy shades and the DFG table, for the solids' shading (#421).
    lights_buffer: wgpu::Buffer,
    lights_bind: wgpu::BindGroup,
    lights_layout: wgpu::BindGroupLayout,
    dfg_buffer: wgpu::Buffer,
    /// Bumped whenever the lights' bind group is made again (the cascades' texture, the
    /// environment's cubes): a new bind group is a new resource in the draw key.
    lights_generation: u64,
    /// The key sun's cascades (#422).
    cascaded: Cascaded,
    /// The local lights' shadow maps (#446).
    locals: local::Locals,
    /// What a shadow frame's `light.w` holds: −1, or −2 to pancake its near plane.
    shadow_mark: f32,
    /// The IES tables' atlas (#446).
    ies: local::Tables,
    /// The light grid this frame, and the buffer its cells are in (#446).
    clusters: Option<clusters::Grid>,
    cluster_buffer: wgpu::Buffer,
    /// The environment's prefilter and cubes (#422).
    env: EnvState,
    /// Whether this frame has a sky, which draws first; its pipeline once compiled (#422).
    sky: bool,
    sky_pipeline: Option<wgpu::RenderPipeline>,
    /// This frame's puffs, back to front, and their pipeline once compiled (#422).
    puffs: Option<(wgpu::Buffer, u32)>,
    puff_pipeline: Option<wgpu::RenderPipeline>,
    /// The see-through solids' pipelines, blend and add, each compiled the first time a batch
    /// draws one.
    solid_layout: wgpu::PipelineLayout,
    clear_pipelines: [Option<wgpu::RenderPipeline>; 6],
    /// Blend and add over the glass, which draws after the resolve (#428, #1173).
    late_pipelines: [Option<wgpu::RenderPipeline>; 2],
    /// This frame's adjust table (#424), each distinct adjust once, entry k + 1 at k.
    adjust_buffer: wgpu::Buffer,
    adjusts: Vec<AdjustEntry>,
    /// This frame's lobe table (#428), each distinct lobe set once, entry k + 1 at k.
    lobe_buffer: wgpu::Buffer,
    lobe_table: Vec<LobeEntry>,
    /// The opaque scene's copy with mips while a scene holds a transmissive part (#428), and the
    /// texel that stands in for it.
    glass: Option<glass::Glass>,
    glass_stub: wgpu::TextureView,
    /// The subsurface share and spread while a scene holds a part whose subsurface spreads
    /// (#481).
    subsurface: Option<sss::Subsurface>,
    /// Whether the DFG buffer holds the sheen table yet (#428).
    sheen_written: bool,
    /// The per-pixel resolve's lists (#424), and its resolve and sorted-fallback pipelines once
    /// a frame draws a per-pixel item.
    oit: oit::Oit,
    oit_pipelines: Option<[wgpu::RenderPipeline; 2]>,
    /// Each solid's rank by ID; and which way the planted ties_by_submission submits this frame.
    ties: BTreeMap<String, u32>,
    flip: bool,
    tone_buffer: wgpu::Buffer,
    output_layout: wgpu::BindGroupLayout,
    /// What the passes after the finish cover this frame (their layer, which the view holds), as
    /// the output pass's undithered mask; one clear texel with none (#418).
    covered: (Option<std::sync::Arc<[u8]>>, wgpu::TextureView),
    mesh_pipeline: wgpu::RenderPipeline,
    /// The opaque material solids' pipelines culling back faces, and front faces (mirrored).
    mesh_culled: [wgpu::RenderPipeline; 2],
    /// The solids' pipeline in a frame with a capped cutaway, its caps at their plane's depth,
    /// compiled the first time one draws; and whether this frame has one (#424).
    cut_pipeline: Option<wgpu::RenderPipeline>,
    /// The GPU cull's kernels and the pipelines that read a row list, compiled the first time a
    /// batch needs them (#484); the groups those pipelines lay out; this frame's stale views.
    rows: Option<Rows>,
    row_groups: [wgpu::BindGroupLayout; 4],
    cull_runs: Vec<cull::Run>,
    /// The document's instances outputs (#484), which their instancers draw from.
    sources: Vec<cull::Source>,
    /// Draws every batch from the CPU's f64 cull, the reference a GPU frame is judged against.
    cpu_cull: bool,
    capped: bool,
    /// Ambient occlusion's prepass, passes and the solids' group 2 (#418).
    ao: ao::Passes,
    /// The scene3d shader module and the solids' vertex layouts, which the ao prepass shares.
    scene_module: wgpu::ShaderModule,
    families: Families,
    output_pipeline: wgpu::RenderPipeline,
    /// The output pass into the finished frame, for the passes after the finish (#382).
    output_f32: wgpu::RenderPipeline,
    /// The finished frame (status::FINISHED), made when a frame has passes after the finish.
    finished: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// #464: the look's print finish for the frame being drawn (its fields, the frame's values,
    /// the ground, each item's color for its separations), the pass, and the frame it reads.
    print: Option<(
        Arc<deep_canvas_marks::print::Print>,
        deep_canvas_marks::print::Frame,
        [u8; 3],
    )>,
    print_colors: BTreeMap<String, [u8; 3]>,
    printer: Option<Arc<Mutex<print::Printer>>>,
    print_source: Option<(wgpu::TextureView, [u32; 2], wgpu::TextureFormat)>,
    /// #465: the mirror's pass, made when a frame first has a mirror, and whether this frame has.
    mirrorer: Option<Box<mirror::Mirrorer>>,
    mirroring: bool,
    /// #465: the flare's passes, made when a frame first has a flare, and whether this frame has.
    flarer: Option<Box<flare::Flarer>>,
    flaring: bool,
    /// #166: the water's pass, made when a frame first has water, and whether this frame has.
    waterer: Option<Box<water::Waterer>>,
    watering: bool,
    /// #166: view3d's `reflection` target while a frame asks for it: each mirror part's lookup.
    reflection: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// The pass resolving the geometry pass's object IDs and depth (#1173), and the planted
    /// resolve_accumulates_frames' blend of the previous frame.
    resolve: wgpu::RenderPipeline,
    accumulate: Option<wgpu::RenderPipeline>,
    /// Render pipelines this renderer compiled, so a patch's new ones can be counted (#379).
    compiled: u32,
    /// Each pipeline it compiled, by name, in the order it compiled them (#854).
    names: Vec<&'static str>,
    /// Each pipeline made, with its items, feature set and target (#432); how many of `names`
    /// it has logged; and what the next new names were made for, by name.
    pub log: created::Log,
    logged: usize,
    made_for: BTreeMap<&'static str, (Vec<String>, String, String)>,
    /// Whether the warm-up makes the shadow maps' pipelines: not under the planted
    /// warms_view_only, which leaves them to the first frame (#432).
    pub warm_shadows: bool,
    /// The opaque solids' pipelines that shade extra lobes, by cull: none, back, front (#432).
    lobed: [Option<wgpu::RenderPipeline>; 3],
    /// The glass copy's mip pass, kept once made (#432).
    glass_kit: Option<glass::Kit>,
    /// Whether a mask-alpha part casts this frame: its sets draw into shadow maps only then.
    mask_casts: bool,
    meshes: BTreeMap<Shape, Mesh>,
    batches: BTreeMap<String, Batch>,
    atlas: AtlasTexture,
    picks: BTreeMap<String, u32>,
    next_generation: u64,
    targets: Option<Targets>,
    /// The batches this frame draws, in layer order.
    order: Vec<String>,
    ground: [f64; 4],
    counts: Counts,
    /// The planted slow_gpu_frame twin's pipeline.
    busy: Option<wgpu::RenderPipeline>,
    shadow: Shadow,
    /// This frame's camera: world to clip (column-major), the eye and the near plane.
    camera: Camera,
    /// The camera's view axis this frame (#166's `depth` target reads along it).
    forward: [f64; 3],
    pub profiler: Option<Profiler>,
    /// The GPU surface it draws through, and the upscale's pipelines once compiled (#386).
    pub surface: Surface,
    pub upscale: Option<Arc<Upscale>>,
    /// The key sun's cascade maps at this many times their size: 2 at the climb's top rung
    /// (#425), else 1.
    pub shadow_scale: u32,
    /// The frame's full size, and its targets below scale 1.
    size: [u32; 2],
    low: Option<Low>,
    low_bytes: Option<u64>,
    outlines: Outlines,
    /// The linear image this frame's output pass reads when passes between geometry and output
    /// wrote one (#418's `pre_tone`); `None`, the linear target.
    pre_tone: Option<wgpu::TextureView>,
}

/// The pass that draws thin lines and outlines at full size after the upscale (#386).
struct Outlines {
    pipeline: wgpu::RenderPipeline,
    /// The screen-size labels' pass after the upscale, over the same frame and depth (#1174).
    labels: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    /// The camera over the full-size slot, and over the internal size (the planted programs').
    display: wgpu::Buffer,
    internal: wgpu::Buffer,
    /// Each with the core's depth target, made with the targets.
    binds: Option<[wgpu::BindGroup; 2]>,
    /// The solids' strokes, and the status outlines.
    strokes: Set,
    statuses: Set,
}

/// A box's silhouette from `cam`: each edge between a face turned toward the camera and one
/// turned away, in world space. `model` maps the unit box (rows of a 3×4 matrix).
fn silhouette(
    model: &[[f64; 4]; 3],
    cam: &deep_canvas_scene3d::scene::Camera,
) -> Vec<[[f64; 3]; 2]> {
    let col = |c: usize| [model[0][c], model[1][c], model[2][c]];
    let at = |l: [f64; 3]| {
        let mut p = [0.0; 3];
        for (r, v) in p.iter_mut().enumerate() {
            *v = model[r][0] * l[0] + model[r][1] * l[1] + model[r][2] * l[2] + model[r][3];
        }
        p
    };
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let det = dot(col(0), cross(col(1), col(2)));
    // Whether face `axis` on side `t` (0: −, 1: +) faces the camera. Its normal is the inverse
    // transpose's column, from the other two columns' cross product.
    let facing = |axis: usize, t: usize| {
        let n = cross(col((axis + 1) % 3), col((axis + 2) % 3));
        let sign = if t == 1 { 1.0 } else { -1.0 } * det.signum();
        let mut centre = [0.0; 3];
        centre[axis] = t as f64 - 0.5;
        let toward = if cam.perspective {
            let c = at(centre);
            [cam.eye[0] - c[0], cam.eye[1] - c[1], cam.eye[2] - c[2]]
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2]]
        };
        dot(n, toward) * sign > 0.0
    };
    let mut out = Vec::new();
    for axis in 0..3 {
        let (b, c) = ((axis + 1) % 3, (axis + 2) % 3);
        for tb in 0..2 {
            for tc in 0..2 {
                if facing(b, tb) == facing(c, tc) {
                    continue;
                }
                let mut p = [0.0; 3];
                p[b] = tb as f64 - 0.5;
                p[c] = tc as f64 - 0.5;
                p[axis] = -0.5;
                let start = at(p);
                p[axis] = 0.5;
                out.push([start, at(p)]);
            }
        }
    }
    out
}

/// A builder's mesh's contour as seen from `cam` (#1162): in world space, each edge between a
/// triangle that faces the camera and one that doesn't, and each edge only one triangle holds
/// when that one faces it. Vertices at one position are one, so a mesh with split normals has
/// the same edges as its welded form.
fn contour(
    mesh: &deep_canvas_scene3d::geom::Mesh,
    model: &[[f64; 4]; 3],
    cam: &deep_canvas_scene3d::scene::Camera,
) -> Vec<[[f64; 3]; 2]> {
    use std::collections::BTreeMap;
    let at = |l: [f64; 3]| {
        let mut p = [0.0; 3];
        for (r, v) in p.iter_mut().enumerate() {
            *v = model[r][0] * l[0] + model[r][1] * l[1] + model[r][2] * l[2] + model[r][3];
        }
        p
    };
    let world: Vec<[f64; 3]> = mesh.positions.iter().map(|p| at(*p)).collect();
    // One index per distinct position, by its bits.
    let mut weld: BTreeMap<[u64; 3], u32> = BTreeMap::new();
    let ids: Vec<u32> = world
        .iter()
        .enumerate()
        .map(|(i, p)| *weld.entry(p.map(f64::to_bits)).or_insert(i as u32))
        .collect();
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let mut faces_by_edge: BTreeMap<(u32, u32), Vec<bool>> = BTreeMap::new();
    for t in mesh.indices.chunks_exact(3) {
        let [a, b, c] = [t[0], t[1], t[2]].map(|i| ids[i as usize]);
        let [pa, pb, pc] = [a, b, c].map(|i| world[i as usize]);
        let (u, v) = (sub(pb, pa), sub(pc, pa));
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        let toward = if cam.perspective {
            sub(cam.eye, pa)
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2]]
        };
        let front = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] > 0.0;
        for (x, y) in [(a, b), (b, c), (c, a)] {
            if x != y {
                faces_by_edge
                    .entry((x.min(y), x.max(y)))
                    .or_default()
                    .push(front);
            }
        }
    }
    // In screen px about the eye: an edge whose both sides the mesh covers all along it is a
    // fold inside the outline (a mitre seen across a corner), never the outline itself.
    let proj = |p: [f64; 3]| {
        let d = sub(p, cam.eye);
        let dot = |a: [f64; 3]| d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
        let k = if cam.perspective {
            cam.scale / dot(cam.forward).max(1e-9)
        } else {
            cam.scale
        };
        [dot(cam.right) * k, dot(cam.up) * k]
    };
    let flat: Vec<[[f64; 2]; 3]> = mesh
        .indices
        .chunks_exact(3)
        .map(|t| [t[0], t[1], t[2]].map(|i| proj(world[ids[i as usize] as usize])))
        .collect();
    let covered = |q: [f64; 2]| {
        flat.iter().any(|[a, b, c]| {
            let side = |p: [f64; 2], r: [f64; 2]| {
                (r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])
            };
            let (x, y, z) = (side(*a, *b), side(*b, *c), side(*c, *a));
            (x >= 0.0 && y >= 0.0 && z >= 0.0) || (x <= 0.0 && y <= 0.0 && z <= 0.0)
        })
    };
    let outer = |a: [f64; 3], b: [f64; 3]| {
        let (pa, pb) = (proj(a), proj(b));
        let (dx, dy) = (pb[0] - pa[0], pb[1] - pa[1]);
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-9 {
            return false;
        }
        let n = [-dy / len * 1.5, dx / len * 1.5];
        [0.125, 0.375, 0.625, 0.875].iter().any(|s| {
            let m = [pa[0] + dx * s, pa[1] + dy * s];
            !covered([m[0] + n[0], m[1] + n[1]]) || !covered([m[0] - n[0], m[1] - n[1]])
        })
    };
    faces_by_edge
        .into_iter()
        .filter(|(_, f)| match f.as_slice() {
            [one] => *one,
            many => many.iter().any(|x| *x) && many.iter().any(|x| !*x),
        })
        .map(|((a, b), _)| [world[a as usize], world[b as usize]])
        .filter(|[a, b]| outer(*a, *b))
        .collect()
}

fn rgb4(v: [f64; 3]) -> [f32; 4] {
    [v[0] as f32, v[1] as f32, v[2] as f32, 0.0]
}

fn decode(c: u8) -> f64 {
    let v = f64::from(c) / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub(crate) fn shape_code(s: Shape) -> u64 {
    match s {
        Shape::Box => 1,
        Shape::Cylinder => 2,
        Shape::Sphere => 3,
        Shape::Built(h) => 4 | (h << 3),
    }
}

// Position and normal, then (#423) uv0 and uv1 as one attribute and the tangent at 13 and 14,
// after the records'.
const MESH_VERTEX: [wgpu::VertexAttribute; 4] = wgpu::vertex_attr_array![
    0 => Float32x3, 1 => Float32x3, 13 => Float32x4, 14 => Float32x4
];
// Location 8 is the solid's tie rank, which the vertex stage reads (#421); 15 its material
// operator's time, seed and opacity (#429).
const SOLID: [wgpu::VertexAttribute; 12] = wgpu::vertex_attr_array![
    2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Uint32, 6 => Uint32, 7 => Uint32,
    8 => Uint32, 9 => Float32x4, 10 => Float32x4, 11 => Float32x4, 12 => Float32x4,
    15 => Uint32x4
];
// A culled batch's instance step is its row in the batch's records (#484).
const ROW: [wgpu::VertexAttribute; 1] = wgpu::vertex_attr_array![2 => Uint32];
const SEGMENT: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Uint32, 3 => Uint32, 4 => Uint32
];
/// A line's segment records, with its dash (#1640).
const LINE: [wgpu::VertexAttribute; 6] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Uint32, 3 => Uint32, 4 => Uint32, 5 => Uint32
];
const POINT: [wgpu::VertexAttribute; 4] =
    wgpu::vertex_attr_array![0 => Float32x4, 1 => Uint32, 2 => Uint32, 3 => Uint32];
const TEXT: [wgpu::VertexAttribute; 8] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4, 4 => Float32x4,
    5 => Uint32, 6 => Uint32, 7 => Uint32
];

/// A solid's vertex layouts: the mesh's vertices, then its instance records.
fn mesh_buffers() -> [Option<wgpu::VertexBufferLayout<'static>>; 2] {
    [
        Some(wgpu::VertexBufferLayout {
            array_stride: (mesh::FLOATS * 4) as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &MESH_VERTEX,
        }),
        Some(instance(std::mem::size_of::<SolidRecord>() as u64, &SOLID)),
    ]
}

/// A culled solid's vertex layouts: the mesh's vertices, then its row list (#484).
fn row_buffers() -> [Option<wgpu::VertexBufferLayout<'static>>; 2] {
    let [mesh, _] = mesh_buffers();
    [mesh, Some(instance(4, &ROW))]
}

fn instance(
    stride: u64,
    attributes: &'static [wgpu::VertexAttribute],
) -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: stride,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes,
    }
}

/// A draw pipeline into the linear and object-ID targets with reversed-Z depth (or the planted
/// forward Z).
/// The lights' bind group: the lights, the DFG table, the key sun's cascades and the
/// environment's cubes.
fn lights_bind(
    d: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    [lights, dfg, adjusts, lobes]: [&wgpu::Buffer; 4],
    oit: &oit::Oit,
    cascades: &wgpu::TextureView,
    env: &EnvState,
    glass: &wgpu::TextureView,
    locals: &wgpu::TextureView,
    ies: &local::Tables,
    grid: &wgpu::Buffer,
) -> wgpu::BindGroup {
    let cube = env.cube.as_ref().map_or(&env.stub, |c| &c.view);
    let to = env.to.as_ref().map_or(&env.stub, |c| &c.view);
    bind_group(
        d,
        "scene3d lights",
        layout,
        [
            lights.as_entire_binding(),
            dfg.as_entire_binding(),
            wgpu::BindingResource::TextureView(cascades),
            wgpu::BindingResource::TextureView(cube),
            wgpu::BindingResource::Sampler(&env.sampler),
            env.buffer.as_entire_binding(),
            wgpu::BindingResource::TextureView(to),
            wgpu::BindingResource::Sampler(&env.compare),
            adjusts.as_entire_binding(),
            oit.heads.as_entire_binding(),
            oit.nodes.as_entire_binding(),
            oit.info.as_entire_binding(),
            lobes.as_entire_binding(),
            wgpu::BindingResource::TextureView(glass),
            wgpu::BindingResource::TextureView(locals),
            wgpu::BindingResource::TextureView(&ies.view),
            wgpu::BindingResource::Sampler(&ies.sampler),
            grid.as_entire_binding(),
            wgpu::BindingResource::TextureView(env.bg[0].as_ref().map_or(&env.stub, |c| &c.view)),
            wgpu::BindingResource::TextureView(env.bg[1].as_ref().map_or(&env.stub, |c| &c.view)),
        ],
    )
}

/// A fragment-stage layout entry for a filterable cube texture.
fn cube_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::Cube,
            multisampled: false,
        },
        count: None,
    }
}

/// One texel of one cascade layer: the stand-in before the key sun's cascades are drawn.
fn cascade_stub(d: &wgpu::Device) -> wgpu::TextureView {
    texture2d(
        d,
        "scene3d cascade stub",
        [1, 1],
        shadow::FORMAT,
        wgpu::TextureUsages::TEXTURE_BINDING,
    )
    .create_view(&wgpu::TextureViewDescriptor {
        dimension: Some(wgpu::TextureViewDimension::D2Array),
        ..Default::default()
    })
}

/// A see-through solid's pipeline: depth-tested with no depth write and no object ID, blending
/// premultiplied over what's behind it, or adding to it.
fn clear_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    planted: &Planted,
    kind: usize,
    after_resolve: bool,
) -> wgpu::RenderPipeline {
    shaded_clear_pipeline(d, samples, module, layout, planted, kind, after_resolve, "mesh_fs")
}

/// A fade's two pipelines through a material operator's fragment stage (#432): its depth pass,
/// then its color where that depth is equal, both from the solids' one @invariant vertex stage.
pub(crate) fn fade_pipelines(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
    fs: &str,
) -> [wgpu::RenderPipeline; 2] {
    let planted = Planted {
        forward_z,
        ..Planted::default()
    };
    [usize::from(FADE), usize::from(FADE) + 1]
        .map(|k| shaded_clear_pipeline(d, samples, module, layout, &planted, k, false, fs))
}

/// [`clear_pipeline`] with `fs` as the color kinds' fragment stage.
#[allow(clippy::too_many_arguments)]
fn shaded_clear_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    planted: &Planted,
    kind: usize,
    after_resolve: bool,
    fs: &str,
) -> wgpu::RenderPipeline {
    // A pass after the resolve draws into the one-sample targets, the IDs whole (#1173).
    let (samples, ids) = if after_resolve {
        (1, IDS)
    } else {
        (samples, IDS_MS)
    };
    let add = kind == usize::from(ADD);
    // A fade (#424): first a depth pass of its own triangles, writing depth and no color; then
    // its color where that depth is equal, so only its nearest surface shows.
    let depth_pass = kind == usize::from(FADE) || kind == usize::from(PER_PIXEL);
    let fade_color = kind == usize::from(FADE) + 1;
    let per_pixel = kind == usize::from(PER_PIXEL);
    // A transmissive part writes its depth and ID and replaces what's behind it: its shading
    // holds the light it lets through (#428).
    let glass = kind == usize::from(GLASS);
    let compare = if fade_color {
        wgpu::CompareFunction::Equal
    } else if add && planted.add_without_depth_test {
        wgpu::CompareFunction::Always
    } else if planted.forward_z {
        wgpu::CompareFunction::Less
    } else {
        wgpu::CompareFunction::GreaterEqual
    };
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(
            (depth_pass && !per_pixel) || (add && planted.add_writes_depth) || glass,
        ),
        depth_compare: Some(compare),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let blend = if add {
        wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::Zero,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
        }
    } else {
        wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING
    };
    let targets = [
        Some(wgpu::ColorTargetState {
            format: LINEAR,
            blend: (!glass).then_some(blend),
            write_mask: if depth_pass {
                wgpu::ColorWrites::empty()
            } else {
                wgpu::ColorWrites::ALL
            },
        }),
        Some(wgpu::ColorTargetState {
            format: ids,
            blend: None,
            write_mask: if glass {
                wgpu::ColorWrites::ALL
            } else {
                wgpu::ColorWrites::empty()
            },
        }),
    ];
    let buffers = mesh_buffers();
    let label = CLEAR_NAMES[kind];
    culled(
        d,
        samples,
        label,
        Some(layout),
        module,
        ("mesh_vs", &buffers),
        Some((
            if per_pixel {
                "oit_fs"
            } else if glass {
                "glass_fs"
            } else {
                fs
            },
            &targets,
        )),
        Some(depth),
        None,
    )
}

/// The per-pixel resolve's pipelines (#424): the full-screen composite over the linear target,
/// and the per-pixel items drawn sorted, for a frame whose fragments ran out of room.
fn oit_pipelines(
    d: &wgpu::Device,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
) -> [wgpu::RenderPipeline; 2] {
    let targets = [
        target(LINEAR, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
        Some(wgpu::ColorTargetState {
            format: IDS,
            blend: None,
            write_mask: wgpu::ColorWrites::empty(),
        }),
    ];
    let depth = |compare| wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(false),
        depth_compare: Some(compare),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let resolve = pipeline(
        d,
        "scene3d.resolve",
        Some(layout),
        module,
        ("sky_vs", &[]),
        Some(("oit_resolve_fs", &targets)),
        Some(depth(wgpu::CompareFunction::Always)),
    );
    let buffers = mesh_buffers();
    let fallback = pipeline(
        d,
        "scene3d.per_pixel_sorted",
        Some(layout),
        module,
        ("mesh_vs", &buffers),
        Some(("oit_fallback_fs", &targets)),
        Some(depth(if forward_z {
            wgpu::CompareFunction::Less
        } else {
            wgpu::CompareFunction::GreaterEqual
        })),
    );
    [resolve, fallback]
}

/// The see-through pipelines' names, by kind: blend, add, a fade's depth pass and its color.
const CLEAR_NAMES: [&str; 6] = [
    "scene3d.blend",
    "scene3d.add",
    "scene3d.fade_depth",
    "scene3d.fade",
    "scene3d.per_pixel",
    "scene3d.transmission",
];

/// Blend's and add's pipelines over the glass, by kind.
const LATE_NAMES: [&str; 2] = ["scene3d.blend_over_glass", "scene3d.add_over_glass"];

#[allow(clippy::too_many_arguments)]
fn draw_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
    cull: Option<wgpu::Face>,
    vs: &str,
    fs: &str,
    buffers: &[Option<wgpu::VertexBufferLayout<'_>>],
) -> wgpu::RenderPipeline {
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(true),
        depth_compare: Some(if forward_z {
            wgpu::CompareFunction::Less
        } else {
            wgpu::CompareFunction::GreaterEqual
        }),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let targets = [
        target(LINEAR, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
        target(IDS_MS, None),
    ];
    culled(
        d,
        samples,
        vs,
        Some(layout),
        module,
        (vs, buffers),
        Some((fs, &targets)),
        Some(depth),
        cull,
    )
}

/// An opaque solid's pipeline for its feature set (#432): with `lobes` off its extra lobes'
/// code folds away; a part with lobes draws through the one with it on.
#[allow(clippy::too_many_arguments)]
fn opaque_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
    cull: Option<wgpu::Face>,
    buffers: &[Option<wgpu::VertexBufferLayout<'_>>],
    lobes: bool,
) -> wgpu::RenderPipeline {
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(true),
        depth_compare: Some(if forward_z {
            wgpu::CompareFunction::Less
        } else {
            wgpu::CompareFunction::GreaterEqual
        }),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let targets = [
        target(LINEAR, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
        target(IDS_MS, None),
    ];
    specialized(
        d,
        samples,
        if lobes { "scene3d.opaque_lobes" } else { "scene3d.opaque" },
        Some(layout),
        module,
        ("mesh_vs", buffers),
        Some(("mesh_fs", &targets)),
        Some(depth),
        cull,
        &[("LOBES", if lobes { 1.0 } else { 0.0 })],
    )
}

/// A see-through part's material operator pipeline (#431): as a blend part draws, its
/// premultiplied color over what's behind, depth-tested, writing no depth and no object ID.
pub(crate) fn op_blend_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
    after_resolve: bool,
) -> wgpu::RenderPipeline {
    // After the resolve it draws into the one-sample targets, as the late parts do (#1173).
    let (samples, ids) = if after_resolve {
        (1, IDS)
    } else {
        (samples, IDS_MS)
    };
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(false),
        depth_compare: Some(if forward_z {
            wgpu::CompareFunction::Less
        } else {
            wgpu::CompareFunction::GreaterEqual
        }),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let targets = [
        target(LINEAR, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
        Some(wgpu::ColorTargetState {
            format: ids,
            blend: None,
            write_mask: wgpu::ColorWrites::empty(),
        }),
    ];
    culled(
        d,
        samples,
        "scene3d material operator see-through",
        Some(layout),
        module,
        ("mesh_vs", &mesh_buffers()),
        Some(("op_mesh_fs", &targets)),
        Some(depth),
        None,
    )
}

/// The sky's pipeline: a full-screen triangle at the far plane, behind everything, writing no
/// depth and no object ID.
fn sky_pipeline(
    d: &wgpu::Device,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
) -> wgpu::RenderPipeline {
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(false),
        depth_compare: Some(if forward_z {
            wgpu::CompareFunction::LessEqual
        } else {
            wgpu::CompareFunction::GreaterEqual
        }),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let targets = [target(LINEAR, None), target(IDS_MS, None)];
    culled(
        d,
        samples,
        SKY_PASS,
        Some(layout),
        module,
        ("sky_vs", &[]),
        Some(("sky_fs", &targets)),
        Some(depth),
        None,
    )
}

/// The line, point and text pipelines, each compiled the first time a batch draws its family, so
/// a patch that adds a family compiles a new pipeline and one that changes only values doesn't.
struct Families {
    module: wgpu::ShaderModule,
    draw_layout: wgpu::PipelineLayout,
    text_layout: wgpu::PipelineLayout,
    forward_z: bool,
    samples: u32,
    line: Option<wgpu::RenderPipeline>,
    point: Option<wgpu::RenderPipeline>,
    text: Option<wgpu::RenderPipeline>,
}

impl Families {
    /// Compiles the pipelines `layer` draws with that aren't yet, naming each in `names`; how
    /// many it compiled.
    fn ensure(&mut self, d: &wgpu::Device, layer: &Layer3, names: &mut Vec<&'static str>) -> u32 {
        let mut made = 0;
        let (module, draw, text, fz, samples) = (
            &self.module,
            &self.draw_layout,
            &self.text_layout,
            self.forward_z,
            self.samples,
        );
        for (name, wanted, slot, layout, vs, fs, buffer) in [
            (
                "scene3d.line",
                !layer.lines.is_empty(),
                &mut self.line,
                draw,
                "line_vs",
                "line_fs",
                instance(std::mem::size_of::<SegmentRecord>() as u64, &LINE),
            ),
            (
                "scene3d.point",
                !layer.points.is_empty(),
                &mut self.point,
                draw,
                "point_vs",
                "point_fs",
                instance(std::mem::size_of::<PointRecord>() as u64, &POINT),
            ),
            (
                "scene3d.text",
                !layer.labels.is_empty(),
                &mut self.text,
                text,
                "text_vs",
                "text_fs",
                instance(std::mem::size_of::<TextRecord>() as u64, &TEXT),
            ),
        ] {
            if wanted && slot.is_none() {
                *slot = Some(draw_pipeline(
                    d,
                    samples,
                    module,
                    layout,
                    fz,
                    None,
                    vs,
                    fs,
                    &[Some(buffer)],
                ));
                names.push(name);
                made += 1;
            }
        }
        made
    }
}

impl Renderer {
    /// Render pipelines it compiled so far.
    pub fn pipelines(&self) -> u32 {
        self.compiled
    }

    /// The material operators' pipelines it holds (#432).
    pub fn material_ops(&self) -> usize {
        self.materials.values().filter(|m| m.is_ok()).count()
    }

    /// Each pipeline it compiled so far, by name (#854).
    pub fn compiled_names(&self) -> &[&'static str] {
        &self.names
    }

    /// Every target the geometry pass draws into, by name, with the sample count it's made with
    /// (#1173).
    pub fn render_targets(&self) -> [(&'static str, u32); 3] {
        let n = self.families.samples;
        [("color", n), ("ids", n), ("depth", n)]
    }

    pub fn new(device: &Device, planted: Planted) -> Renderer {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d"),
            source: wgpu::ShaderSource::Wgsl(shader(&planted).into()),
        });
        let output = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d output"),
            source: wgpu::ShaderSource::Wgsl(OUTPUT.into()),
        });
        let uniform = |binding, visibility| {
            buffer_entry(binding, visibility, wgpu::BufferBindingType::Uniform)
        };
        let frame_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d frame"),
            entries: &[uniform(0, wgpu::ShaderStages::VERTEX_FRAGMENT)],
        });
        let mask_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d label"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let mut covered = texture_entry();
        covered.binding = 2;
        let output_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d output"),
            entries: &[
                texture_entry(),
                uniform(1, wgpu::ShaderStages::FRAGMENT),
                covered,
            ],
        });
        // Nothing covered: one clear texel.
        let uncovered = texture2d(
            d,
            "scene3d uncovered",
            [1, 1],
            wgpu::TextureFormat::R8Unorm,
            wgpu::TextureUsages::TEXTURE_BINDING,
        )
        .create_view(&Default::default());
        let uniform_buffer = |label, size| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: size as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let frame_buffer = uniform_buffer("scene3d frame", std::mem::size_of::<FrameUniform>());
        let tone_buffer = uniform_buffer("scene3d tone", std::mem::size_of::<ToneUniform>());
        let frame_bind = bind_group(
            d,
            "scene3d frame",
            &frame_layout,
            [frame_buffer.as_entire_binding()],
        );
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("scene3d label"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let layout = |groups: &[Option<&wgpu::BindGroupLayout>]| {
            d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("scene3d"),
                bind_group_layouts: groups,
                immediate_size: 0,
            })
        };
        let draw_layout = layout(&[Some(&frame_layout)]);
        let lights_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d lights"),
            entries: &[
                uniform(0, wgpu::ShaderStages::FRAGMENT),
                uniform(1, wgpu::ShaderStages::FRAGMENT),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                cube_entry(3),
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                uniform(5, wgpu::ShaderStages::FRAGMENT),
                cube_entry(6),
                // The blurred background's own cubes (#426), from and to.
                cube_entry(18),
                cube_entry(19),
                wgpu::BindGroupLayoutEntry {
                    binding: 7,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
                // The frame's adjust table (#424).
                uniform(8, wgpu::ShaderStages::FRAGMENT),
                // The per-pixel lists (#424).
                buffer_entry(
                    9,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: false },
                ),
                wgpu::BindGroupLayoutEntry {
                    binding: 14,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 15,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2Array,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 16,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                buffer_entry(
                    17,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
                buffer_entry(
                    10,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: false },
                ),
                buffer_entry(
                    11,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: false },
                ),
                // The frame's lobe table (#428).
                uniform(12, wgpu::ShaderStages::FRAGMENT),
                // The opaque scene's copy with mips, which transmission samples (#428).
                wgpu::BindGroupLayoutEntry {
                    binding: 13,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let oit = oit::Oit::new(d);
        let glass_stub = texture2d(
            d,
            glass::PASS,
            [1, 1],
            LINEAR,
            wgpu::TextureUsages::TEXTURE_BINDING,
        )
        .create_view(&Default::default());
        let adjust_buffer = uniform_buffer(
            "scene3d adjusts",
            ADJUSTS * std::mem::size_of::<AdjustEntry>(),
        );
        let lobe_buffer = uniform_buffer(
            "scene3d lobes",
            LOBE_ENTRIES * std::mem::size_of::<LobeEntry>(),
        );
        let lights_buffer = uniform_buffer("scene3d lights", std::mem::size_of::<LightsUniform>());
        let dfg_buffer = wgpu::util::DeviceExt::create_buffer_init(
            d,
            &wgpu::util::BufferInitDescriptor {
                label: Some("scene3d dfg"),
                contents: bytemuck::cast_slice(&dfg_table()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            },
        );
        let env = EnvState {
            prefilter: env::Prefilter::new(d),
            buffer: uniform_buffer("scene3d env", std::mem::size_of::<EnvUniform>()),
            sampler: d.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("scene3d env"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                mipmap_filter: wgpu::MipmapFilterMode::Linear,
                ..Default::default()
            }),
            compare: d.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("scene3d cascades"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                compare: Some(wgpu::CompareFunction::LessEqual),
                ..Default::default()
            }),
            stub: env::Prefilter::stub(d),
            cube: None,
            to: None,
            bg: [None, None],
        };
        let ies = local::Tables::new(d);
        let cluster_buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d light grid"),
            size: (clusters::CELLS * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let lights_bind = lights_bind(
            d,
            &lights_layout,
            [&lights_buffer, &dfg_buffer, &adjust_buffer, &lobe_buffer],
            &oit,
            &cascade_stub(d),
            &env,
            &glass_stub,
            &cascade_stub(d),
            &ies,
            &cluster_buffer,
        );
        let ao = ao::Passes::new(device);
        let maps = maps::Store::new(d, &device.queue);
        let mesh_layout = layout(&[
            Some(&frame_layout),
            Some(&lights_layout),
            Some(&ao.shade_layout),
            Some(&maps.layout),
        ]);
        let row_groups = [
            frame_layout.clone(),
            lights_layout.clone(),
            ao.shade_layout.clone(),
            maps.layout.clone(),
        ];
        let text_layout = layout(&[Some(&frame_layout), Some(&mask_layout)]);
        let output_pipeline_layout = layout(&[Some(&output_layout)]);
        let mesh_buffers = mesh_buffers();
        let samples = if planted.single_sample { 1 } else { MSAA };
        let mesh = |cull| {
            opaque_pipeline(
                d,
                samples,
                &module,
                &mesh_layout,
                planted.forward_z,
                cull,
                &mesh_buffers,
                false,
            )
        };
        // Opaque material solids have their back faces culled before they shade (front faces for
        // a mirrored one), so no discarded back face shares a pixel quad with a front face's
        // silhouette and moves its derivatives (#425: one view, one picture).
        let mesh_pipeline = mesh(None);
        let mesh_culled = [mesh(Some(wgpu::Face::Back)), mesh(Some(wgpu::Face::Front))];
        // The shadow map: the solids' vertex stage under the light's clip matrix, depth only,
        // nearest the light kept.
        // Its fragment stage only discards what a cutaway removes (#424), and a band's texels
        // outside its mask (#425).
        // Depth clamps through wgpu's unclipped depth; without it the vertex stage pancakes what
        // lies before the near plane onto it (Light policy: cascades).
        let shadow_mark = if d.features().contains(wgpu::Features::DEPTH_CLIP_CONTROL) {
            -1.0
        } else {
            -2.0
        };
        let light_buffer = uniform_buffer("scene3d light", std::mem::size_of::<FrameUniform>());
        let light_bind = bind_group(
            d,
            "scene3d light",
            &frame_layout,
            [light_buffer.as_entire_binding()],
        );
        let output_into = |format| {
            pipeline(
                d,
                OUTPUT_PASS,
                Some(&output_pipeline_layout),
                &output,
                ("out_vs", &[]),
                Some(("out_fs", &[target(format, None)])),
                None,
            )
        };
        let output_pipeline = output_into(FORMAT);
        let output_f32 = output_into(status::FINISHED);
        // The object IDs and depth from their first covered sample, which reads its targets as
        // plain textures at one sample (#1173).
        let resolve_source = if samples == 1 {
            RESOLVE
                .replace("multisampled_2d", "2d")
                .replace("SAMPLES: i32 = 4", "SAMPLES: i32 = 1")
        } else {
            RESOLVE.to_string()
        };
        let resolve_module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(RESOLVE_PASS),
            source: wgpu::ShaderSource::Wgsl(resolve_source.into()),
        });
        let accumulate = planted.resolve_accumulates.then(|| {
            let half = wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::Constant,
                dst_factor: wgpu::BlendFactor::OneMinusConstant,
                operation: wgpu::BlendOperation::Add,
            };
            let blend = wgpu::BlendState {
                color: half,
                alpha: half,
            };
            pipeline(
                d,
                RESOLVE_PASS,
                None,
                &resolve_module,
                ("resolve_vs", &[]),
                Some(("previous_fs", &[target(LINEAR, Some(blend))])),
                None,
            )
        });
        let resolve = pipeline(
            d,
            RESOLVE_PASS,
            None,
            &resolve_module,
            ("resolve_vs", &[]),
            Some(("resolve_fs", &[target(IDS, None)])),
            Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
        );
        // Thin lines and outlines at full size: output.wgsl's `finish` for their color, the
        // core's depth target to test against (#386).
        let outline_module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(OUTLINE_PASS),
            source: wgpu::ShaderSource::Wgsl(format!("{OUTPUT}\n{OUTLINE}\n{LABEL}").into()),
        });
        let outline_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(OUTLINE_PASS),
            entries: &[
                uniform(0, wgpu::ShaderStages::VERTEX_FRAGMENT),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let outline_pipeline = pipeline(
            d,
            OUTLINE_PASS,
            Some(&layout(&[Some(&output_layout), Some(&outline_layout)])),
            &outline_module,
            (
                "outline_vs",
                &[Some(instance(
                    std::mem::size_of::<SegmentRecord>() as u64,
                    &SEGMENT,
                ))],
            ),
            Some((
                "outline_fs",
                &[target(
                    FORMAT,
                    Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                )],
            )),
            None,
        );
        let label_pipeline = pipeline(
            d,
            LABEL_PASS,
            Some(&layout(&[
                Some(&output_layout),
                Some(&outline_layout),
                Some(&mask_layout),
            ])),
            &outline_module,
            (
                "label_vs",
                &[Some(instance(
                    std::mem::size_of::<TextRecord>() as u64,
                    &TEXT,
                ))],
            ),
            Some((
                "label_fs",
                &[target(
                    FORMAT,
                    Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                )],
            )),
            None,
        );
        let outlines = Outlines {
            pipeline: outline_pipeline,
            labels: label_pipeline,
            layout: outline_layout,
            display: uniform_buffer("scene3d outlines", std::mem::size_of::<FrameUniform>()),
            internal: uniform_buffer(
                "scene3d outlines internal",
                std::mem::size_of::<FrameUniform>(),
            ),
            binds: None,
            strokes: Set::default(),
            statuses: Set::default(),
        };
        let busy = planted.slow_gpu_frame.then(|| {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("scene3d busy"),
                source: wgpu::ShaderSource::Wgsl(BUSY.into()),
            });
            pipeline(
                d,
                "scene3d busy",
                None,
                &module,
                ("busy_vs", &[]),
                Some(("busy_fs", &[target(FORMAT, None)])),
                None,
            )
        });
        let atlas = {
            let texture = d.create_texture(&wgpu::TextureDescriptor {
                label: Some("scene3d glyph atlas"),
                size: wgpu::Extent3d {
                    width: PAGE,
                    height: PAGE,
                    depth_or_array_layers: PAGES as u32,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
            let bind = bind_group(
                d,
                "scene3d glyph atlas",
                &mask_layout,
                [
                    wgpu::BindingResource::TextureView(&view),
                    wgpu::BindingResource::Sampler(&sampler),
                ],
            );
            AtlasTexture {
                texture,
                bind,
                generations: vec![None; PAGES],
            }
        };
        Renderer {
            planted,
            diag: None,
            epoch: device.epoch,
            frame_buffer,
            frame_bind,
            frame_layout: frame_layout.clone(),
            materials: BTreeMap::new(),
            op_binds: BTreeMap::new(),
            lights_buffer,
            lights_bind,
            lights_layout,
            dfg_buffer,
            lights_generation: 0,
            cascaded: Cascaded {
                texture: None,
                frames: (0..4)
                    .map(|_| {
                        let b =
                            uniform_buffer("scene3d cascade", std::mem::size_of::<FrameUniform>());
                        let g = bind_group(
                            d,
                            "scene3d cascade",
                            &frame_layout,
                            [b.as_entire_binding()],
                        );
                        (b, g)
                    })
                    .collect(),
                keys: [None; 4],
                list: Vec::new(),
                stale: Vec::new(),
                fade: true,
                casters: None,
                size: shadow::SIZE,
            },
            locals: local::Locals::default(),
            shadow_mark,
            ies,
            clusters: None,
            cluster_buffer,
            env,
            sky: false,
            sky_pipeline: None,
            puffs: None,
            puff_pipeline: None,
            solid_layout: mesh_layout.clone(),
            maps,
            filter_taps: 8,
            clear_pipelines: [None, None, None, None, None, None],
            late_pipelines: [None, None],
            adjust_buffer,
            adjusts: Vec::new(),
            lobe_buffer,
            lobe_table: Vec::new(),
            glass: None,
            glass_stub,
            subsurface: None,
            sheen_written: false,
            oit,
            oit_pipelines: None,
            ties: BTreeMap::new(),
            flip: false,
            tone_buffer,
            output_layout,
            covered: (None, uncovered),
            mesh_pipeline,
            mesh_culled,
            cut_pipeline: None,
            rows: None,
            row_groups,
            cull_runs: Vec::new(),
            sources: Vec::new(),
            cpu_cull: false,
            capped: false,
            ao,
            scene_module: module.clone(),
            families: Families {
                module,
                draw_layout,
                text_layout,
                forward_z: planted.forward_z,
                samples,
                line: None,
                point: None,
                text: None,
            },
            output_pipeline,
            output_f32,
            finished: None,
            print: None,
            print_colors: BTreeMap::new(),
            printer: None,
            print_source: None,
            mirrorer: None,
            mirroring: false,
            flarer: None,
            flaring: false,
            waterer: None,
            watering: false,
            reflection: None,
            resolve,
            accumulate,
            compiled: 2,
            log: created::Log::default(),
            logged: 0,
            made_for: BTreeMap::new(),
            warm_shadows: true,
            lobed: [None, None, None],
            glass_kit: None,
            mask_casts: false,
            names: vec![
                "scene3d.mesh",
                "scene3d.output",
                "scene3d.output_f32",
                OUTLINE_PASS,
                LABEL_PASS,
                RESOLVE_PASS,
            ],
            meshes: BTreeMap::new(),
            motion: motion::MotionPass::default(),
            motion_frame: None,
            core: targets::Core::default(),
            velocity_frame: None,
            emission_frame: None,
            batches: BTreeMap::new(),
            atlas,
            picks: BTreeMap::new(),
            next_generation: 0,
            targets: None,
            order: Vec::new(),
            ground: [0.0, 0.0, 0.0, 1.0],
            counts: Counts::default(),
            busy,
            shadow: Shadow {
                pipeline: None,
                buffer: light_buffer,
                bind: light_bind,
                mask: None,
                view: None,
                clip: None,
            },
            camera: ([0.0; 16], [0.0; 3], 0.1),
            forward: [0.0, 0.0, -1.0],
            profiler: None,
            surface: Surface::default(),
            upscale: None,
            shadow_scale: 1,
            size: [0, 0],
            low: None,
            low_bytes: None,
            outlines,
            pre_tone: None,
        }
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// Each pick ID with the item it stands for.
    pub fn picks(&self) -> &BTreeMap<String, u32> {
        &self.picks
    }

    fn pick(&mut self, id: &str) -> u32 {
        if let Some(&p) = self.picks.get(id) {
            return p;
        }
        let p = self.picks.len() as u32 + 1;
        self.picks.insert(id.to_string(), p);
        p
    }

    fn ensure_targets(&mut self, device: &Device, size: [u32; 2]) {
        if self.targets.as_ref().is_some_and(|t| t.size == size) {
            return;
        }
        let d = &device.device;
        let texture = |label, format, usage| texture2d(d, label, size, format, usage);
        let attach = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC;
        let linear = texture(
            "scene3d linear",
            LINEAR,
            // Motion blur's resolve copies the frame back in (#419).
            attach | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        // Effects read the object-ID and depth targets after geometry.
        let ids = texture(
            "scene3d ids",
            IDS,
            attach | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let depth = texture(
            "scene3d depth",
            DEPTH,
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
        );
        let linear_view = linear.create_view(&Default::default());
        let output_bind = self.output_bind(d, &linear_view);
        let depth_view = depth.create_view(&Default::default());
        let ids_view = ids.create_view(&Default::default());
        // The geometry pass's targets at its sample count (#1173): the color resolves in the
        // pass, so it's never stored; the IDs and depth the resolve pass reads.
        let samples = self.families.samples;
        let ms = |label, format, usage| {
            multisampled(d, samples, label, size, format, usage).create_view(&Default::default())
        };
        let read = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let color = if samples > 1 {
            let transient =
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TRANSIENT_ATTACHMENT;
            let ms = ms("scene3d linear ms", LINEAR, transient);
            (ms, Some(linear_view.clone()))
        } else {
            (linear_view.clone(), None)
        };
        let ids_ms = ms("scene3d ids ms", IDS_MS, read);
        let depth_ms = ms("scene3d depth ms", DEPTH, read);
        let resolve_bind = bind_group(
            d,
            RESOLVE_PASS,
            &self.resolve.get_bind_group_layout(0),
            [
                wgpu::BindingResource::TextureView(&ids_ms),
                wgpu::BindingResource::TextureView(&depth_ms),
            ],
        );
        let accumulates = self.accumulate.is_some().then(|| {
            let previous = texture2d(
                d,
                "scene3d previous",
                size,
                LINEAR,
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            let p = self.accumulate.clone().expect("made with the plant");
            let view = previous.create_view(&Default::default());
            let entry = wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(&view),
            };
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(RESOLVE_PASS),
                layout: &p.get_bind_group_layout(0),
                entries: &[entry],
            });
            (p, bind, previous, Arc::new(AtomicBool::new(false)))
        });
        let drawn = Drawn {
            color,
            ids_ms,
            depth_ms,
            ids: ids_view.clone(),
            depth: depth_view.clone(),
            resolve: (self.resolve.clone(), resolve_bind),
            accumulates,
        };
        let o = &self.outlines;
        self.outlines.binds = Some([&o.display, &o.internal].map(|buffer| {
            bind_group(
                d,
                OUTLINE_PASS,
                &o.layout,
                [
                    buffer.as_entire_binding(),
                    wgpu::BindingResource::TextureView(&depth_view),
                ],
            )
        }));
        self.targets = Some(Targets {
            size,
            ids_view,
            depth_view,
            linear,
            linear_view,
            ids,
            output_bind,
            drawn,
        });
    }

    /// The output pass's bind group: `linear` and the tone uniform.
    fn output_bind(&self, d: &wgpu::Device, linear: &wgpu::TextureView) -> wgpu::BindGroup {
        bind_group(
            d,
            "scene3d output",
            &self.output_layout,
            [
                wgpu::BindingResource::TextureView(linear),
                self.tone_buffer.as_entire_binding(),
                wgpu::BindingResource::TextureView(&self.covered.1),
            ],
        )
    }

    /// The mask of what `layer` covers, uploaded when the layer changed; the clear texel with
    /// none. Whether it changed.
    fn cover(&mut self, device: &Device, layer: Option<status::Layer>) -> bool {
        let same = match (&self.covered.0, &layer) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, &b.rgba),
            _ => false,
        };
        if same {
            return false;
        }
        let view = match &layer {
            Some(l) => {
                // Every pixel the layer draws over or one of its boxes owns, grown a pixel.
                let mut alpha: Vec<u8> = l.rgba.chunks_exact(4).map(|p| p[3]).collect();
                let [w, h] = l.size.map(f64::from);
                for b in &l.covers {
                    let x0 = (b[0] - 1.0).floor().clamp(0.0, w) as usize;
                    let y0 = (b[1] - 1.0).floor().clamp(0.0, h) as usize;
                    let x1 = (b[0] + b[2] + 1.0).ceil().clamp(0.0, w) as usize;
                    let y1 = (b[1] + b[3] + 1.0).ceil().clamp(0.0, h) as usize;
                    for y in y0..y1 {
                        alpha[y * l.size[0] as usize + x0..y * l.size[0] as usize + x1].fill(255);
                    }
                }
                let texture = texture2d(
                    &device.device,
                    "scene3d covered",
                    l.size,
                    wgpu::TextureFormat::R8Unorm,
                    wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                );
                write_texture(&device.queue, &texture, 0, &alpha, l.size[0], l.size);
                texture.create_view(&Default::default())
            }
            None => texture2d(
                &device.device,
                "scene3d uncovered",
                [1, 1],
                wgpu::TextureFormat::R8Unorm,
                wgpu::TextureUsages::TEXTURE_BINDING,
            )
            .create_view(&Default::default()),
        };
        self.covered = (layer.map(|l| l.rgba), view);
        if let Some(t) = &self.targets {
            let bind = self.output_bind(&device.device, &t.linear_view);
            self.targets.as_mut().expect("checked above").output_bind = bind;
        }
        true
    }

    /// Plants the upscale's wrong programs (#386).
    pub fn plant_upscale(&mut self, planted: surface::Planted) {
        self.planted.upscale = planted;
    }

    /// The frame's internal size: its full size at the surface's scale, once the upscale's
    /// pipelines are there to return it to full size.
    fn internal(&self) -> [u32; 2] {
        self.internal_size(self.size)
    }

    /// The internal size a frame of `size` draws at.
    pub fn internal_size(&self, size: [u32; 2]) -> [u32; 2] {
        if self.surface.scale != 1.0 && self.upscale.is_some() {
            surface::scaled(size, self.surface.scale)
        } else {
            size
        }
    }

    /// What the targets below scale 1 hold on the device, as it reported them; 0 at scale 1.
    pub fn low_bytes(&self) -> u64 {
        self.low.as_ref().map_or(0, |_| self.low_bytes.unwrap_or(0))
    }

    /// The key sun's cascades at this frame's view (#422): each fitted in closed form, keyed by
    /// everything it reads, and marked to draw when its key changed since its layer was drawn.
    fn prepare_cascades(&mut self, device: &Device, scene: &Scene, frame: &FrameUniform) {
        self.counts.cascades_drawn.clear();
        self.counts.cascade_splits.clear();
        let size = shadow::SIZE * self.shadow_scale.max(1);
        let c = &mut self.cascaded;
        c.list.clear();
        c.stale.clear();
        if c.size != size {
            // A new size draws every layer again into a new texture.
            c.size = size;
            c.texture = None;
            c.keys = [None; 4];
        }
        let Some(sun) = scene.sun.as_ref().filter(|_| scene.cascaded()) else {
            return;
        };
        if !scene.camera.perspective {
            // An orthographic view has one depth range: one cascade over it.
            c.list = shadow::light_clip(scene, sun.toward, 0.0)
                .map(|clip| shadow::Cascade {
                    near: 0.0,
                    far: f64::MAX,
                    center: [0.0; 3],
                    radius: 1.0
                        / (clip[0] * clip[0] + clip[4] * clip[4] + clip[8] * clip[8]).sqrt(),
                    clip,
                    depth: 1.0
                        / (clip[2] * clip[2] + clip[6] * clip[6] + clip[10] * clip[10]).sqrt(),
                })
                .into_iter()
                .collect();
        } else {
            let angle = scene
                .lights
                .iter()
                .find(|l| l.id == sun.id)
                .map_or(0.53, |l| l.angle);
            let reach = scene
                .shadowing
                .soft
                .filter(|_| !self.planted.local.no_reach)
                .map(|s| shadow::Reach {
                    angle,
                    max_penumbra: s.max_penumbra,
                });
            let snap = !self.planted.local.unsnapped;
            c.list = shadow::cascades(scene, sun.toward, &sun.cascades, size, reach, snap);
        }
        c.fade = sun.cascades.fade;
        if let Some(first) = c.list.first() {
            self.counts.cascade_splits = std::iter::once(first.near)
                .chain(c.list.iter().map(|k| k.far))
                .collect();
        }
        let stale_plant = self.planted.cascade_cache_keeps_stale;
        let solid_count = scene.layers.iter().map(|l| l.solids.len()).sum::<usize>();
        // A culled element's map follows the batch's cull: the key hashes every element, in or
        // out, so the CPU tests none against a cascade (#484).
        let elements: Vec<&Solid> = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| s.batch != 0 && s.cast_shadow)
            .collect();
        let casters = shadow::caster_corners(scene);
        let sun_caster = scene
            .lights
            .iter()
            .find(|l| l.id == sun.id)
            .map_or(0, |l| l.caster_bit);
        let solids: BTreeMap<&str, &Solid> = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .map(|s| (s.id.as_str(), s))
            .collect();
        for (i, cascade) in c.list.iter().enumerate() {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            for v in sun.toward.iter().chain(&cascade.clip) {
                v.to_bits().hash(&mut h);
            }
            for s in &elements {
                s.id.hash(&mut h);
                shape_code(s.shape).hash(&mut h);
                for v in s.model.iter().flatten() {
                    v.to_bits().hash(&mut h);
                }
                local::hash_caster(s, &mut h);
                local::hash_time(s, self.planted.local, &mut h);
            }
            for (id, corners) in &casters {
                let drawn = sun_caster == 0 || solids[id.as_str()].caster_sets & sun_caster != 0;
                if !drawn || !shadow::inside(&cascade.clip, corners) {
                    continue;
                }
                local::hash_caster(solids[id.as_str()], &mut h);
                local::hash_time(solids[id.as_str()], self.planted.local, &mut h);
            }
            // A level only the shadow passes draw is part of what the cascade reads (#425).
            for s in scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .filter(|s| s.cast_only)
            {
                s.id.hash(&mut h);
                shape_code(s.shape).hash(&mut h);
                for v in s.model.iter().flatten() {
                    v.to_bits().hash(&mut h);
                }
                s.mask.map(|m| (m.level, m.lower)).hash(&mut h);
            }
            sun_caster.hash(&mut h);
            // The planes that cut its casters (#424): moving one draws the map again.
            if !self.planted.cuts_color_only && !self.planted.local.ignores_cut {
                local::hash_cut(scene, &mut h);
            }
            // The planted wrong program keys a map by the scene's solid count alone.
            let key = if stale_plant {
                solid_count as u64
            } else {
                h.finish()
            };
            let texel = 2.0 * cascade.radius / f64::from(size);
            self.counts.shadow_maps.push((key, texel, cascade.clip));
            if c.keys[i] != Some(key) {
                c.keys[i] = Some(key);
                c.stale.push(i);
            }
        }
        if c.stale.is_empty() {
            return;
        }
        if c.texture.is_none() {
            let t = device.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(CASCADE_PASS),
                size: wgpu::Extent3d {
                    width: size,
                    height: size,
                    depth_or_array_layers: 4,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: shadow::FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let array = t.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
            let layers = (0..4)
                .map(|z| {
                    t.create_view(&wgpu::TextureViewDescriptor {
                        dimension: Some(wgpu::TextureViewDimension::D2),
                        base_array_layer: z,
                        array_layer_count: Some(1),
                        ..Default::default()
                    })
                })
                .collect();
            c.texture = Some((array, layers));
            self.rebind_lights(device);
        }
        let c = &self.cascaded;
        for &i in &c.stale {
            let m = c.list[i].clip;
            let mut f = *frame;
            for col in 0..4 {
                for r in 0..4 {
                    f.clip[col][r] = m[col * 4 + r] as f32;
                }
            }
            // The shadow pass's mark (scene3d.wgsl's `mesh_vs`): it leaves out what casts none.
            f.light[3] = self.shadow_mark;
            Self::cut_casts(&self.planted, scene, &mut f);
            deep_gpu::alloc::outside(|| {
                device
                    .queue
                    .write_buffer(&c.frames[i].0, 0, bytemuck::bytes_of(&f))
            });
        }
        self.counts.cascades_drawn = c.stale.iter().map(|&i| i as u32).collect();
        // A sun that names its casters draws only them (Light: casters).
        self.cascaded.casters = (sun_caster != 0).then(|| {
            scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .filter(|s| s.caster_sets & sun_caster != 0)
                .map(|s| s.id.clone())
                .collect()
        });
    }

    /// The shadowed local lights' maps at this view (#446; Light policy: local shadows): each
    /// keyed by everything it reads and marked to draw when that changed since it was drawn; a
    /// dirty map is never deferred. `kept` is the policy's shadows.
    fn prepare_locals(
        &mut self,
        device: &Device,
        scene: &Scene,
        frame: &FrameUniform,
        kept: &[(usize, f64)],
    ) {
        let wanted: Vec<(usize, f64)> = kept
            .iter()
            .copied()
            .filter(|&(i, _)| scene.lights[i].kind != LightKind::Sun)
            .collect();
        let casters = if wanted.is_empty() {
            Vec::new()
        } else {
            shadow::local_caster_corners(scene)
        };
        let planted = self.planted.local;
        let fresh = self.locals.prepare(scene, &wanted, &casters, planted);
        if fresh {
            let device_size = (self.locals.size, self.locals.layers);
            self.locals.ensure(device, device_size, &self.frame_layout);
            self.rebind_lights(device);
        }
        for slot in self.locals.stale.clone() {
            let (first, faces) = {
                let m = &self.locals.list[slot];
                (m.first, m.map.faces.clone())
            };
            for (offset, clip) in faces {
                let mut f = *frame;
                for col in 0..4 {
                    for r in 0..4 {
                        f.clip[col][r] = clip[col * 4 + r] as f32;
                    }
                }
                f.light[3] = self.shadow_mark;
                Self::cut_casts(&self.planted, scene, &mut f);
                let buffer = &self.locals.frames[(first + offset) as usize].0;
                deep_gpu::alloc::outside(|| {
                    device.queue.write_buffer(buffer, 0, bytemuck::bytes_of(&f))
                });
            }
        }
        self.counts.local_maps = self.locals.reports();
    }

    /// A light frame's cut (#424): the view's, unless removed geometry still casts
    /// (`shadows: whole`) or the planted program clips the color pass alone.
    fn cut_casts(planted: &Planted, scene: &Scene, f: &mut FrameUniform) {
        let whole = scene.cutaway.as_ref().is_some_and(|c| c.shadows_whole);
        if whole || planted.cuts_color_only {
            f.cut_info[0] = 0;
        }
    }

    /// The lights' bind group again, after a texture it binds changed.
    fn rebind_lights(&mut self, device: &Device) {
        let stub;
        let cascades = match &self.cascaded.texture {
            Some((array, _)) => array,
            None => {
                stub = cascade_stub(&device.device);
                &stub
            }
        };
        let local_stub;
        let locals = match &self.locals.texture {
            Some((array, _)) => array,
            None => {
                local_stub = cascade_stub(&device.device);
                &local_stub
            }
        };
        self.lights_bind = lights_bind(
            &device.device,
            &self.lights_layout,
            [
                &self.lights_buffer,
                &self.dfg_buffer,
                &self.adjust_buffer,
                &self.lobe_buffer,
            ],
            &self.oit,
            cascades,
            &self.env,
            self.glass.as_ref().map_or(&self.glass_stub, |g| &g.view),
            locals,
            &self.ies,
            &self.cluster_buffer,
        );
        self.lights_generation += 1;
    }

    /// The environment's cubes (#422): prefiltered again only when its key changes, never per
    /// frame or from a moving camera; and the uniform the sky pass, the fog and the solids read.
    fn prepare_env(&mut self, device: &Device, scene: &Scene, camera: &[f64; 16]) {
        let mut u = EnvUniform::zeroed();
        u.moon[3] = 2.0;
        let wanted = scene.sky.as_ref().and_then(|s| {
            let e = s.environment.as_ref()?;
            Some((env::key(s, &e.from, e.size), e))
        });
        let mut rebuilt = false;
        match wanted {
            None => {
                rebuilt = self.env.cube.take().is_some() | self.env.to.take().is_some();
                for slot in &mut self.env.bg {
                    rebuilt |= slot.take().is_some();
                }
            }
            Some((key, e)) => {
                let sky = scene.sky.as_ref().expect("an environment is a sky's");
                // #422's planted prefilter_over_frames fills one more roughness mip each frame.
                let partial = self.planted.prefilter_over_frames;
                let behind = self.env.cube.as_ref().is_some_and(|c| c.filled < c.mips);
                if self.env.cube.as_ref().map(|c| c.key) != Some(key) || (partial && behind) {
                    let source = env::source(sky, &e.from);
                    let filled = match (&self.env.cube, partial) {
                        (Some(c), true) if c.key == key => Some(c.filled + 1),
                        (_, true) => Some(1),
                        _ => None,
                    };
                    self.env.cube = Some(
                        self.env
                            .prefilter
                            .build(device, key, &source, e.size, filled, None),
                    );
                    rebuilt = true;
                }
                let to_key = e.mix.as_ref().map(|(to, _)| env::key(sky, to, e.size));
                if self.env.to.as_ref().map(|c| c.key) != to_key {
                    self.env.to = e.mix.as_ref().zip(to_key).map(|((to, _), k)| {
                        let source = env::source(sky, to);
                        self.env
                            .prefilter
                            .build(device, k, &source, e.size, None, None)
                    });
                    rebuilt = true;
                }
                // The blurred background's own cubes (#426): the lobe at exactly the blur's
                // roughness, keyed by the environment's key and the blur, never lighting's.
                let blur = sky.background_blur as f32;
                let bg_keys = [Some(key), to_key].map(|k| {
                    k.filter(|_| blur > 0.0)
                        .map(|k| k ^ u64::from(blur.to_bits()).wrapping_mul(0x9e37_79b9_7f4a_7c15))
                });
                let froms = [Some(&e.from), e.mix.as_ref().map(|(to, _)| to)];
                for ((slot, k), from) in self.env.bg.iter_mut().zip(bg_keys).zip(froms) {
                    if slot.as_ref().map(|c| c.key) != k {
                        *slot = k.zip(from).map(|(k, from)| {
                            let source = env::source(sky, from);
                            self.env
                                .prefilter
                                .build(device, k, &source, e.size, None, Some(blur))
                        });
                        rebuilt = true;
                    }
                }
                let cube = self.env.cube.as_ref().expect("built above");
                u.sh = cube.sh;
                if let Some(to) = &self.env.to {
                    u.sh_to = to.sh;
                    u.m[0] = e.mix.as_ref().map_or(0.0, |m| m.1) as f32;
                }
                let last = (cube.mips - 1) as f32;
                u.k = [
                    1.0,
                    last,
                    e.intensity as f32,
                    e.rotation.to_radians() as f32,
                ];
                u.bg[1] = blur;
            }
        }
        if rebuilt {
            self.rebind_lights(device);
        }
        self.counts.env_builds = self.env.prefilter.builds;
        if let Some(sky) = &scene.sky {
            let inv = ao::invert(camera);
            for c in 0..4 {
                for r in 0..4 {
                    u.inv[c][r] = inv[c * 4 + r] as f32;
                }
            }
            let cam = &scene.camera;
            u.eye = v4(cam.eye, if cam.perspective { 1.0 } else { 0.0 });
            u.top = v4(sky.top, sky.stars);
            u.low = v4(sky.low, 1.0);
            if let Some([az, el, radius]) = sky.moon {
                u.moon = v4(env::direction(az, el), radius.to_radians().cos());
            }
            let (h_top, h_density) = sky.fog_height.unwrap_or((0.0, 0.0));
            let curve = match sky.fog_curve {
                Curve::Exp => 0.0,
                Curve::Exp2 => 1.0,
            };
            u.fog = [
                sky.fog_density as f32,
                curve,
                h_top as f32,
                h_density as f32,
            ];
            u.fog_color = match sky.fog {
                Fog::Color(c) => v4(c, 0.0),
                Fog::Background => [0.0, 0.0, 0.0, 1.0],
            };
            u.bg[0] = if sky.shows_environment() { 1.0 } else { 0.0 };
            if let Some((h, r)) = sky.background_ground {
                u.bg[2] = h as f32;
                u.bg[3] = r as f32;
            }
            // The sun it follows draws its disk in the sky's own fields, 0.53° across: its
            // illuminance over the disk's solid angle (never in the environment, which the light
            // itself already lights).
            u.sun[3] = 2.0;
            if let Some(l) = sky.sun.as_ref().and_then(|id| {
                scene
                    .lights
                    .iter()
                    .find(|l| &l.id == id && l.kind == LightKind::Sun)
            }) {
                let radius = (0.53f64 / 2.0).to_radians();
                let omega = std::f64::consts::TAU * (1.0 - radius.cos());
                u.sun = v4([-l.dir[0], -l.dir[1], -l.dir[2]], radius.cos());
                u.sun_color = v4(l.color.map(|c| c * l.intensity / omega), 0.0);
            }
        }
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.env.buffer, 0, bytemuck::bytes_of(&u))
        });
    }

    /// The lights the light policy shades at this frame's view, each with its weight (#421).
    fn prepare_lights(
        &mut self,
        device: &Device,
        scene: &Scene,
        policy: light::Policy,
        dropped: Vec<String>,
    ) {
        let cam = &scene.camera;
        let view = if cam.perspective {
            [cam.eye[0], cam.eye[1], cam.eye[2], 1.0]
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2], 0.0]
        };
        let planted = if self.planted.premixed_metallic { 1 } else { 0 }
            | if self.planted.uncompensated_lobe {
                2
            } else {
                0
            }
            | if self.planted.compensates_environment_only {
                4
            } else {
                0
            }
            | if self.planted.ids_ignore_mask { 8 } else { 0 }
            | if self.planted.local.filter_in_texels {
                FILTER_IN_TEXELS
            } else {
                0
            }
            | self.planted.lobes;
        let mut u = LightsUniform {
            view: view.map(|v| v as f32),
            count: [policy.shaded.len() as u32, 0, planted, 0],
            splits: [0.0; 4],
            texels: [0.0; 4],
            forward: v4(cam.forward, if self.cascaded.fade { 1.0 } else { 0.0 }),
            cascades: [[[0.0; 4]; 4]; 4],
            depths: [0.0; 4],
            soft: scene.shadowing.soft.map_or([0.0; 4], |s| {
                [
                    if s.pcss { 2.0 } else { 1.0 },
                    s.blocker_taps as f32,
                    s.filter_taps as f32,
                    s.max_penumbra as f32,
                ]
            }),
            key: [
                scene
                    .sun
                    .as_ref()
                    .and_then(|sun| scene.lights.iter().find(|l| l.id == sun.id))
                    .map_or(0.0, |l| (l.angle.to_radians() * 0.5).tan() as f32),
                f32::from(scene.shadowing.contact.is_some()),
                f32::from(scene.sample_turn.is_some()),
                scene.sample_turn.unwrap_or(0.0) as f32,
            ],
            local_size: [self.locals.size as f32; 4],
            grid: [0.0; 4],
            locals: [LocalUniform::zeroed(); local::SLOTS],
            items: [[[0.0; 4]; 6]; SHADED],
        };
        // Each light's local map (#446).
        let mut local_of = BTreeMap::new();
        for (slot, m) in self.locals.list.iter().enumerate() {
            let l = &scene.lights[m.light];
            let mut clip = [[0.0; 4]; 4];
            let spot = m.map.faces[0].1;
            for (col, out) in clip.iter_mut().enumerate() {
                for (r, v) in out.iter_mut().enumerate() {
                    *v = if m.map.cube {
                        // A cube's rotation, world to its frame: scene3d.wgsl's `cube_tap`.
                        m.map
                            .axes
                            .get(col)
                            .and_then(|a| a.get(r))
                            .map_or(0.0, |x| *x as f32)
                    } else {
                        spot[col * 4 + r] as f32
                    };
                }
            }
            u.locals[slot] = LocalUniform {
                clip,
                pos: v4(l.pos, m.map.far),
                info: [
                    m.map.near as f32,
                    m.first as f32,
                    m.map.tan as f32,
                    f32::from(m.map.cube),
                ],
                size: [local::radius(l) as f32, m.share as f32, 0.0, 0.0],
            };
            local_of.insert(m.light, slot as u32 + 1);
        }
        // The key sun's cascades, which every receiving material reads (#422).
        if let (Some(sun), false) = (&scene.sun, self.cascaded.list.is_empty()) {
            if let Some(k) = policy
                .shaded
                .iter()
                .position(|&(i, _)| scene.lights[i].id == sun.id)
            {
                u.count[1] = k as u32 + 1;
                u.count[3] = self.cascaded.list.len() as u32;
                for (i, c) in self.cascaded.list.iter().enumerate() {
                    u.splits[i] = c.far.min(f64::from(f32::MAX)) as f32;
                    u.texels[i] = (2.0 * c.radius / f64::from(self.cascaded.size)) as f32;
                    u.depths[i] = c.depth as f32;
                    for col in 0..4 {
                        for r in 0..4 {
                            u.cascades[i][col][r] = c.clip[col * 4 + r] as f32;
                        }
                    }
                }
            }
        }
        for (slot, &(i, weight)) in u.items.iter_mut().zip(&policy.shaded) {
            let l = &scene.lights[i];
            let kind = match l.kind {
                LightKind::Sun => 0.0,
                LightKind::Point => 1.0,
                LightKind::Spot => 2.0,
                LightKind::Area => 3.0,
            };
            let mut intensity = l.intensity * weight;
            let table = l.distribution.as_ref();
            intensity *= table.map_or(1.0, |t| t.scale);
            if let (Some(t), true) = (table, self.planted.local.ies_peak) {
                // The planted wrong program: a table scaled to its peak, not to its integral.
                let d = &scene.distributions[t.layer as usize];
                intensity /= d.table.iter().copied().fold(0.0, f32::max) as f64;
            }
            if l.kind == LightKind::Spot && self.planted.spot_counts_cone {
                // The planted wrong program: lm ÷ 2π(1 − cos outer) in place of lm ÷ 4π.
                intensity *= 2.0 / (1.0 - l.cone[0]).max(1e-6);
            }
            let range = if l.range.is_finite() { l.range } else { 0.0 };
            *slot = [
                [l.pos[0] as f32, l.pos[1] as f32, l.pos[2] as f32, kind],
                [
                    l.dir[0] as f32,
                    l.dir[1] as f32,
                    l.dir[2] as f32,
                    range as f32,
                ],
                [
                    (l.color[0] * intensity) as f32,
                    (l.color[1] * intensity) as f32,
                    (l.color[2] * intensity) as f32,
                    l.radius as f32,
                ],
                [
                    l.cone[0] as f32,
                    l.cone[1] as f32,
                    local_of.get(&i).copied().unwrap_or(0) as f32,
                    f32::from_bits(l.receiver_bit),
                ],
                l.area.map_or(v4(l.axes[0], 0.0), |a| {
                    v4(a.right, if a.disk { 1.0 } else { 0.0 })
                }),
                {
                    let up = l.area.map_or(l.axes[1], |a| a.up);
                    v4(up, table.map_or(0.0, |t| f64::from(t.layer) + 1.0))
                },
            ];
        }
        self.counts.shadows_dropped = dropped;
        // Above eight lights, each tile and slice lists the lights that reach it, by the policy's
        // order: scene3d.wgsl's `cluster_at` (#446).
        let grid = clusters::grid(&scene.lights, &policy, cam, scene.size);
        if let Some(g) = &grid {
            u.grid = [1.0, g.far as f32, cam.near.max(1e-3) as f32, 0.0];
            if self.clusters.as_ref() != Some(g) {
                deep_gpu::alloc::outside(|| {
                    device.queue.write_buffer(
                        &self.cluster_buffer,
                        0,
                        bytemuck::cast_slice(&g.cells),
                    )
                });
            }
        }
        self.clusters = grid;
        self.counts.lights_left_out = policy.left_out;
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.lights_buffer, 0, bytemuck::bytes_of(&u))
        });
    }

    /// The outline of each solid with a stroke: its silhouette's edges, as seen from this
    /// frame's camera, the stroke's ones and the status outlines' apart (#386).
    fn prepare_outlines(&mut self, device: &Device, scene: &Scene) {
        let cam = &scene.camera;
        let o = &mut self.outlines;
        o.strokes.begin();
        o.statuses.begin();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            let Some(stroke) = s.stroke else { continue };
            let untested = stroke.exact && self.planted.status_without_depth;
            let exact = stroke.exact && !self.planted.status_before_tone_map;
            let flags =
                OUTLINED | if exact { EXACT } else { 0 } | if untested { UNTESTED } else { 0 };
            let set = if stroke.exact {
                &mut o.statuses
            } else {
                &mut o.strokes
            };
            let edges = match &s.mesh {
                Some(m) => contour(m, &s.model, cam),
                None => silhouette(&s.model, cam),
            };
            for [a, b] in edges {
                let record = SegmentRecord {
                    a: v4(a, stroke.width),
                    b: v4(b, stroke.width),
                    color: pack(stroke.color),
                    pick: 0,
                    flags,
                    dash: 0,
                };
                set.push(&s.id, bytemuck::bytes_of(&record));
            }
        }
        let (mut next, mut written) = (self.next_generation, 0);
        o.strokes.finish(device, &mut next, &mut written);
        o.statuses.finish(device, &mut next, &mut written);
        self.next_generation = next;
    }

    /// Builds `shape`'s unit mesh the first time a batch draws one.
    fn mesh(&mut self, device: &Device, shape: Shape) {
        if let std::collections::btree_map::Entry::Vacant(e) = self.meshes.entry(shape) {
            e.insert(Mesh::build(device, shape));
            self.counts.meshes_built += 1;
        }
    }

    /// Uploads a builder's mesh the first time a batch draws one of its hash (#420).
    fn built_mesh(&mut self, device: &Device, shape: Shape, m: &deep_canvas_scene3d::geom::Mesh) {
        if let std::collections::btree_map::Entry::Vacant(e) = self.meshes.entry(shape) {
            e.insert(Mesh::of(device, m));
            self.counts.meshes_built += 1;
        }
    }

    /// The set a solid's material operator draws it in (#429), the operator's pipeline compiled
    /// the first time a prepared scene holds it: 0, its material's own values, with none, or with
    /// one that can't draw, which this frame's counts name.
    fn material_op(&mut self, device: &Device, s: &Solid, see_through: bool) -> u64 {
        let Some(o) = &s.op else { return 0 };
        let key = op::key(o);
        if !self.materials.contains_key(&key) {
            let layouts = [
                &self.frame_layout,
                &self.lights_layout,
                &self.ao.shade_layout,
            ];
            let options = deep_canvas_effects::emit::Options {
                sample_grad_implicit: self.planted.sample_grad_implicit,
                ..Default::default()
            };
            let made = op::compile(
                &device.device,
                SHADER,
                layouts,
                self.planted.forward_z,
                options,
                self.families.samples,
                o,
            );
            if made.is_ok() {
                self.compiled += 1;
                self.names.push("scene3d.material_op");
            }
            self.materials.insert(key, made);
        }
        let why = match &self.materials[&key] {
            Err(e) => e.clone(),
            Ok(_) if see_through => {
                "a see-through part's operator lands with see-through materials".into()
            }
            Ok(_) => return key,
        };
        if !self
            .counts
            .operators_refused
            .iter()
            .any(|(id, _)| *id == o.id)
        {
            self.counts.operators_refused.push((o.id.clone(), why));
        }
        0
    }

    /// Uploads each atlas page whose generation the GPU doesn't hold.
    fn upload_pages(&mut self, device: &Device, pages: &[AtlasPage]) {
        for (i, page) in pages.iter().enumerate().take(PAGES) {
            if self.atlas.generations[i] == Some(page.generation) {
                continue;
            }
            write_texture(
                &device.queue,
                &self.atlas.texture,
                i as u32,
                &page.bytes,
                PAGE,
                [PAGE, PAGE],
            );
            self.atlas.generations[i] = Some(page.generation);
        }
    }

    /// Takes the frame's scene: the uniforms, each batch's changed records, and the batches
    /// whose draw key changed encoded again. What it did is in [`Renderer::counts`].
    pub fn prepare(&mut self, device: &Device, scene: &Scene, look: &Look3) {
        // Level of detail at this view (#425): a scene whose solids still carry bands or mesh
        // levels draws what scene3d's pure choice resolves them to.
        if leveled(scene) {
            let mut chosen = scene.clone();
            let mut choices = deep_canvas_scene3d::lod::select(&chosen);
            let side = shadow::SIZE * self.shadow_scale.max(1);
            deep_canvas_scene3d::lod::shadow_levels(
                &chosen,
                &mut choices,
                shadow_texels(&chosen, side),
            );
            deep_canvas_scene3d::lod::resolve(&mut chosen, &choices);
            return self.prepare(device, &chosen, look);
        }
        // #166: the water's parts draw in a pass of their own, after the mirror's view.
        if let Some(w) = scene.water.clone() {
            let wet = |s: &Solid| w.parts.contains(&s.id);
            if scene.layers.iter().flat_map(|l| &l.solids).any(wet) {
                let mut dry = scene.clone();
                for layer in &mut dry.layers {
                    layer.solids.retain(|s| !wet(s));
                }
                self.prepare(device, &dry, look);
                self.prepare_water(device, scene, &w);
                return;
            }
        }
        self.watering = false;
        self.prepare_frame(device, scene, look);
        // #166: view3d's `reflection` target, made while a frame asks for it.
        let internal = self.internal();
        self.reflection = match self.reflection.take() {
            Some(r) if scene.read_reflection && r.2 == internal => Some(r),
            _ if scene.read_reflection => {
                let texture = texture2d(
                    &device.device,
                    "scene3d reflection",
                    internal,
                    water::REFLECTION,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                );
                let view = texture.create_view(&Default::default());
                Some((texture, view, internal))
            }
            _ => None,
        };
        // The per-pixel lists' room for this frame (#424).
        let per_pixel = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .any(|s| s.per_pixel);
        let internal = self.internal();
        if self
            .oit
            .prepare(device, per_pixel, internal, scene.fragments)
        {
            self.rebind_lights(device);
        }
        if per_pixel && self.oit_pipelines.is_none() {
            self.oit_pipelines = Some(oit_pipelines(
                &device.device,
                &self.scene_module,
                &self.solid_layout,
                self.planted.forward_z,
            ));
            self.compiled += 2;
            self.names
                .extend(["scene3d.resolve", "scene3d.per_pixel_sorted"]);
        }
        // Each solid's rank by ID across the frame: coplanar opaque ties go to the first (#421).
        // Ranked again only when the frame's solids change, so a frame that moves them allocates
        // nothing.
        // A culled batch's elements tie by index order alone, the later on top (#484).
        let solids = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| s.batch == 0);
        let same = solids.clone().count() == self.ties.len()
            && solids.clone().all(|s| self.ties.contains_key(&s.id));
        // Under a drawn look a rank reads the frame alone, so seeking equals playing (#149).
        if (!same || look.drawn.is_some()) && !self.planted.ties_by_submission {
            self.ties = tie_ranks(solids);
        }
        self.flip = !self.flip;
        self.adjusts.clear();
        self.lobe_table.clear();
        // A capped cutaway draws the solids through the pipeline that writes a cap's depth.
        self.capped = scene
            .cutaway
            .as_ref()
            .is_some_and(|c| c.cap.is_some() && !c.planes.is_empty());
        if self.capped && self.cut_pipeline.is_none() {
            self.cut_pipeline = Some(draw_pipeline(
                &device.device,
                self.families.samples,
                &self.scene_module,
                &self.solid_layout,
                self.planted.forward_z,
                // Its caps draw from back faces: nothing culls.
                None,
                "mesh_vs",
                "mesh_cut_fs",
                &mesh_buffers(),
            ));
            self.compiled += 1;
            self.names.push("scene3d.cut");
        }
        for layer in &scene.layers {
            self.prepare_batch(device, layer, &scene.camera);
        }
        if !self.adjusts.is_empty() {
            deep_gpu::alloc::outside(|| {
                device.queue.write_buffer(
                    &self.adjust_buffer,
                    0,
                    bytemuck::cast_slice(&self.adjusts),
                )
            });
        }
        if !self.lobe_table.is_empty() {
            deep_gpu::alloc::outside(|| {
                device.queue.write_buffer(
                    &self.lobe_buffer,
                    0,
                    bytemuck::cast_slice(&self.lobe_table),
                )
            });
        }
        let same = self.order.len() == scene.layers.len()
            && self
                .order
                .iter()
                .zip(&scene.layers)
                .all(|(o, l)| *o == l.id);
        if !same {
            self.order = scene.layers.iter().map(|l| l.id.clone()).collect();
            let order = &self.order;
            self.batches.retain(|id, _| order.contains(id));
        }
        self.update_culls(device);
        self.ensure_casters(device, scene);
        self.motion_frame = match (&scene.motion, self.targets.as_ref()) {
            (Some(m), Some(t)) => {
                self.motion
                    .prepare(device, scene, m, &self.meshes, &t.linear_view, t.size)
            }
            _ => None,
        };
        self.prepare_core(device, scene);
        // #465: the mirror's view at t, drawn whole each frame.
        self.mirroring = match &scene.mirror {
            Some(m) => {
                let planted = self.planted.clone();
                let mirrorer = self
                    .mirrorer
                    .get_or_insert_with(|| Box::new(mirror::Mirrorer::new(device, planted)));
                // A water's own mirror lays its picture in the water's pass, not over its parts.
                let overlay = scene
                    .water
                    .as_ref()
                    .is_none_or(|w| w.material != m.material);
                mirrorer.prepare(device, scene, m, look, &self.picks, overlay);
                true
            }
            None => false,
        };
        // #465: the flare's sources at t, at the internal size the targets draw.
        self.flaring = match &scene.flare {
            Some(f) => {
                let internal = self.internal();
                let k = [
                    f64::from(internal[0]) / f64::from(scene.size[0]),
                    f64::from(internal[1]) / f64::from(scene.size[1]),
                ];
                let mut sources = deep_canvas_scene3d::flare::sources(scene, f, look);
                for s in &mut sources {
                    s.at = [s.at[0] * k[0], s.at[1] * k[1]];
                    s.radius *= k[0];
                }
                let clip = self.camera.0;
                let depth = |p: [f64; 3]| {
                    let row = |r: usize| {
                        clip[r] * p[0] + clip[4 + r] * p[1] + clip[8 + r] * p[2] + clip[12 + r]
                    };
                    row(2) / row(3)
                };
                let grows = self.depth_grows_nearer();
                let planted = self.planted.flare;
                let flarer = self
                    .flarer
                    .get_or_insert_with(|| Box::new(flare::Flarer::new(device)));
                flarer.prepare(
                    device,
                    f,
                    &sources,
                    internal,
                    depth,
                    grows,
                    planted,
                    look.exposure,
                );
                true
            }
            None => false,
        };
        self.log_new();
    }

    /// The shadow maps' pipelines for each caster kind the frame draws into them (#432): the
    /// opaque casters' and the mask-alpha casters', each made the first time a frame casts that
    /// kind, named by its casters and the maps it draws into. The planted warms_view_only's
    /// warm-up leaves them to the first frame.
    fn ensure_casters(&mut self, device: &Device, scene: &Scene) {
        let mask = |s: &Solid| {
            s.material
                .as_ref()
                .is_some_and(|m| m.alpha_mode == AlphaMode::Mask)
        };
        let casting = || scene.layers.iter().flat_map(|l| &l.solids).filter(|s| s.cast_shadow);
        self.mask_casts = casting().any(mask);
        let mut maps: Vec<String> = Vec::new();
        if let Some(sun) = scene.sun.as_ref().filter(|s| s.shadow) {
            if !self.cascaded.list.is_empty() {
                maps.push(format!("{}/cascades", sun.id));
            } else if self.shadow.clip.is_some() {
                maps.push(format!("{}/shadow", sun.id));
            }
        }
        for m in &self.locals.list {
            if let Some(l) = scene.lights.get(m.light) {
                if !maps.contains(&l.id) {
                    maps.push(l.id.clone());
                }
            }
        }
        if maps.is_empty() || (self.log.warming && !self.warm_shadows) {
            return;
        }
        let target = maps.join(", ");
        for kind_mask in [false, true] {
            let made = if kind_mask { self.shadow.mask.is_some() } else { self.shadow.pipeline.is_some() };
            let casters: Vec<&Solid> = casting().filter(|s| mask(s) == kind_mask).collect();
            if made || casters.is_empty() {
                continue;
            }
            let (name, fs) = if kind_mask {
                ("scene3d.shadow_mask", "shadow_mask_fs")
            } else {
                (SHADOW_PASS, "shadow_fs")
            };
            let p = shadow_pipeline(
                &device.device,
                name,
                &self.families.draw_layout,
                &self.scene_module,
                ("mesh_vs", &mesh_buffers()),
                fs,
            );
            if kind_mask {
                self.shadow.mask = Some(p);
            } else {
                self.shadow.pipeline = Some(p);
            }
            let mut sets: Vec<&str> = casters.iter().map(|s| created::caster_set(s)).collect();
            sets.sort_unstable();
            sets.dedup();
            let items = casters.iter().map(|s| created::item_of(&s.id).to_string()).collect();
            self.made_for.insert(name, (items, sets.join(","), target.clone()));
            self.compiled += 1;
            self.names.push(name);
        }
    }

    /// Logs each pipeline compiled since the last call, with what it was made for (#432).
    fn log_new(&mut self) {
        while self.logged < self.names.len() {
            let name = self.names[self.logged];
            let (mut items, set, target) = self.made_for.remove(name).unwrap_or_else(|| {
                (Vec::new(), name.trim_start_matches("scene3d.").to_string(), "view".into())
            });
            let mut seen = BTreeSet::new();
            items.retain(|i| seen.insert(i.clone()));
            let samples = self.families.samples.to_le_bytes();
            self.log.push(created::Created {
                key: created::key128(&[name.as_bytes(), set.as_bytes(), target.as_bytes(), &samples]),
                items,
                feature_set: set,
                target,
            });
            self.logged += 1;
        }
    }

    /// The core targets this frame reads (#431), made at the internal size, and their draws:
    /// velocity from the scene's evaluations at t ± s/2 (no travel where it has none), emission
    /// from every opaque solid's set.
    fn prepare_core(&mut self, device: &Device, scene: &Scene) {
        let Some((size, linear)) = self
            .targets
            .as_ref()
            .map(|t| (t.size, t.linear_view.clone()))
        else {
            return;
        };
        self.core.ensure(&device.device, size);
        self.velocity_frame = self.core.velocity.is_some().then(|| {
            let still;
            let motion = match &scene.velocity {
                Some(m) => m.as_ref(),
                None => {
                    still = still_motion(scene);
                    &still
                }
            };
            self.motion
                .target_frame(device, scene, motion, &self.meshes, size)
        });
        let draws: Vec<targets::EmissionDraw> = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id))
            .flat_map(|b| &b.solids)
            .filter(|(_, set)| set.cull.is_none())
            .filter_map(|((shape, maps, ..), set)| {
                let (buffer, mesh) = (set.buffer.as_ref()?, self.meshes.get(shape)?);
                Some((
                    mesh.vertices.clone(),
                    mesh.indices.clone(),
                    mesh.count,
                    buffer.clone(),
                    set.len(),
                    self.maps.by_index(*maps & MAPS_INDEX).clone(),
                ))
            })
            .collect();
        let binds = [
            self.frame_bind.clone(),
            self.lights_bind.clone(),
            self.ao.shade().clone(),
        ];
        let threshold = self.planted.emission_thresholds_color.then_some(&linear);
        self.emission_frame = self.core.emission_frame(
            device,
            &self.scene_module,
            &self.solid_layout,
            binds,
            draws,
            threshold,
        );
    }

    /// The core targets' draws, after the frame's geometry.
    fn core_draws(&self) -> Option<CoreDraws> {
        let t = self.targets.as_ref()?;
        let velocity = self
            .velocity_frame
            .as_ref()
            .zip(self.core.velocity.as_ref())
            .map(|(f, v)| (f.clone(), v.view.clone()));
        let emission = self
            .emission_frame
            .as_ref()
            .zip(self.core.emission.as_ref())
            .map(|(f, e)| (f.clone(), e.view.clone()));
        (velocity.is_some() || emission.is_some()).then(|| CoreDraws {
            velocity,
            emission,
            depth: t.depth_view.clone(),
        })
    }

    /// #166: the water's parts at t, with their pick IDs, the mirror's picture and the light.
    fn prepare_water(
        &mut self,
        device: &Device,
        scene: &Scene,
        w: &deep_canvas_scene3d::water::Water,
    ) {
        for id in &w.parts {
            self.pick(id);
        }
        let mirror = match (&scene.mirror, &self.mirrorer) {
            (Some(m), Some(r)) if self.mirroring && m.material == w.material => {
                r.picture().map(|p| (p, m.strength))
            }
            _ => None,
        };
        let lighting = water::Lighting {
            toward: scene.sun.as_ref().map_or([0.0, 1.0, 0.0], |s| s.toward),
            sun: scene
                .sun
                .as_ref()
                .map_or(0.0, |s| s.illuminance / std::f64::consts::PI),
            ambient: scene.sky.as_ref().map_or([0.3; 3], |s| s.ambient[0]),
        };
        let reversed = self.depth_grows_nearer();
        let samples = self.families.samples;
        let Some(t) = self.targets.as_ref() else {
            return;
        };
        let (ids, depth) = (t.ids_view.clone(), t.depth_view.clone());
        let (ids_ms, depth_ms) = (t.drawn.ids_ms.clone(), t.drawn.depth_ms.clone());
        let frame = water::Frame {
            camera: &self.camera.0,
            reversed,
            size: self.internal(),
            mirror: mirror.as_ref().map(|(p, s)| (p, *s)),
            picks: &self.picks,
            lighting,
            planted: self.planted.water,
        };
        self.waterer
            .get_or_insert_with(|| Box::new(water::Waterer::new(device, reversed, samples)))
            .prepare(device, scene, w, &frame, &ids, &depth, [&ids_ms, &depth_ms]);
        self.watering = true;
    }

    /// The copy of the opaque scene that transmission and `backdrop` read (#431), as the last
    /// frame took it: each mip's size and its texels as f32 RGBA, level 0 first; `None` while the
    /// frame holds no copy.
    pub fn read_backdrop(&self, device: &Device) -> Option<Vec<([u32; 2], Vec<u8>)>> {
        let g = self.glass.as_ref()?;
        (0..glass::levels(g.size))
            .map(|k| {
                let size = [(g.size[0] >> k).max(1), (g.size[1] >> k).max(1)];
                let half = read_level(device, &g.texture, k, size, 8)?;
                let floats = half
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .flat_map(|h| f16_to_f32(u16::from_le_bytes(*h)).to_le_bytes())
                    .collect();
                Some((size, floats))
            })
            .collect()
    }

    /// Every core target the renderer holds (#431): color and object ID, and velocity and emission
    /// while read, each with its texture and its bytes (width × height × its texel's bytes).
    pub fn target_rows(&self) -> Vec<(&'static str, &wgpu::Texture, u64)> {
        let mut rows = Vec::new();
        if let Some(t) = self.targets.as_ref() {
            let px = u64::from(t.size[0]) * u64::from(t.size[1]);
            rows.push(("color", &t.linear, px * 8));
            rows.push(("object_id", &t.ids, px * 4));
        }
        for (name, target, bytes) in self.core.held() {
            rows.push((name, &target.texture, bytes));
        }
        rows
    }

    /// A core target's view this frame, by its output's name (#431).
    pub fn core_target(&self, name: &str) -> Option<&wgpu::TextureView> {
        match name {
            "velocity" => self.core.velocity.as_ref().map(|t| &t.view),
            "emission" => self.core.emission.as_ref().map(|t| &t.view),
            _ => None,
        }
    }

    /// A solid's lobe table index above the adjust's, 0 without lobes, or `None` when its lobes
    /// aren't in this frame's table (#428).
    fn lobe_slot(&self, s: &Solid) -> Option<u32> {
        let lobes = s.material.as_ref().map(|m| drawn_lobes(s, &m.lobes));
        let (Some(m), Some(lobes)) = (s.material.as_ref(), lobes.filter(|l| l.on())) else {
            return Some(0);
        };
        let scale = if s.mesh.is_some() {
            det(&s.model).abs().cbrt()
        } else {
            1.0
        };
        let e = lobe_entry(&lobes, m.pattern_seed, scale);
        let k = lobes_at(&self.lobe_table, &e, subsurface_entry(&lobes).as_ref())?;
        Some((k as u32 + 1) << 16)
    }

    /// [`Renderer::prepare`] for a scene that differs from the last one it prepared only in its
    /// size, its camera and the solids `moved` lists (layer, index): it writes those solids'
    /// records alone, so a frame costs what moved, and replays every batch.
    pub fn prepare_moved(
        &mut self,
        device: &Device,
        scene: &Scene,
        look: &Look3,
        moved: &[(usize, usize)],
    ) {
        // See-through parts reorder as the camera moves, so a frame holding one prepares whole;
        // so does one whose level of detail the view chooses (#425).
        if self.planted.encodes_every_frame
            || self.core.want.velocity
            || self.core.want.emission
            || leveled(scene)
            || self.order.len() != scene.layers.len()
            || self.batches.values().any(|b| !b.clear_draws.is_empty())
            || !self.adjusts.is_empty()
            || scene.mirror.is_some()
            || scene.water.is_some()
        {
            return self.prepare(device, scene, look);
        }
        // Under a drawn look a tie rank is a function of the frame, so a part the move changed
        // rewrites too, and a frame draws the same however it was reached (#149).
        let mut moved = moved.to_vec();
        let ties = look.drawn.as_ref().map(|_| {
            tie_ranks(
                scene
                    .layers
                    .iter()
                    .flat_map(|l| &l.solids)
                    .filter(|s| s.batch == 0),
            )
        });
        if let Some(ties) = ties.filter(|t| *t != self.ties) {
            for (l, layer) in scene.layers.iter().enumerate() {
                for (i, s) in layer.solids.iter().enumerate() {
                    if ties.get(&s.id) != self.ties.get(&s.id) && !moved.contains(&(l, i)) {
                        moved.push((l, i));
                    }
                }
            }
            self.ties = ties;
        }
        let moved = moved.as_slice();
        // A moved part keeps its lobes' entry in the frame's lobe table (#428); one whose lobes
        // aren't there prepares whole.
        let mut lobes = Vec::with_capacity(moved.len());
        for &(l, i) in moved {
            let index = match scene.layers.get(l).and_then(|layer| layer.solids.get(i)) {
                Some(s) => self.lobe_slot(s),
                None => Some(0),
            };
            match index {
                Some(k) => lobes.push(k),
                None => return self.prepare(device, scene, look),
            }
        }
        let generation = self.ao.generation;
        self.prepare_frame(device, scene, look);
        if self.ao.generation != generation {
            // The solids' ao bind group changed: every batch with solids encodes again.
            for layer in &scene.layers {
                self.prepare_batch(device, layer, &scene.camera);
            }
            self.update_culls(device);
            return;
        }
        let mut written = 0;
        for (&(l, i), &lobe) in moved.iter().zip(&lobes) {
            let layer = &scene.layers[l];
            let Some(batch) = self.batches.get_mut(&layer.id) else {
                continue;
            };
            let (Some(s), Some(&(set_key, at, pick, _))) =
                (layer.solids.get(i), batch.solid_slots.get(i))
            else {
                continue;
            };
            let tie = self.ties.get(&s.id).copied().unwrap_or(0);
            if let Some(set) = batch.solids.get_mut(&set_key) {
                let record = solid_record(
                    s,
                    pick,
                    tie,
                    !self.planted.winding_ignores_determinant,
                    set_key.1 & MAPS_INDEX != 0,
                    lobe,
                );
                set.write(
                    device,
                    at as usize,
                    bytemuck::bytes_of(&record),
                    &mut written,
                );
            }
        }
        self.counts.instances_written += written;
        self.counts.replayed += scene.layers.len() as u32;
        self.update_culls(device);
    }

    /// The instances outputs this document's instancers draw from (#484).
    pub fn feed(&mut self, sources: Vec<cull::Source>) {
        self.sources = sources;
    }

    /// Draws every culled batch from the CPU's f64 cull, the reference a GPU frame is judged
    /// against (#484): never a mode a document can ask for.
    pub fn cull_on_cpu(&mut self) {
        self.cpu_cull = true;
    }

    /// The pipelines a culled batch draws with, compiled the first time one is drawn (#484).
    fn ensure_rows(&mut self, device: &Device) {
        let d = &device.device;
        if self.rows.is_none() {
            let kernels = cull::Kernels::new(d);
            let [frame, lights, ao, maps] = &self.row_groups;
            let group = |groups: &[Option<&wgpu::BindGroupLayout>]| {
                d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("scene3d rows"),
                    bind_group_layouts: groups,
                    immediate_size: 0,
                })
            };
            let layout = group(&[
                Some(frame),
                Some(lights),
                Some(ao),
                Some(maps),
                Some(&kernels.records),
            ]);
            let shadow_layout = group(&[Some(frame), None, None, None, Some(&kernels.records)]);
            let module = &self.scene_module;
            let buffers = row_buffers();
            let samples = self.families.samples;
            let mesh = |cull| {
                draw_pipeline(
                    d,
                    samples,
                    module,
                    &layout,
                    self.planted.forward_z,
                    cull,
                    "mesh_row_vs",
                    "mesh_fs",
                    &buffers,
                )
            };
            let opaque = mesh(None);
            let culled = [mesh(Some(wgpu::Face::Back)), mesh(Some(wgpu::Face::Front))];
            let shadow = shadow_pipeline(
                d,
                SHADOW_PASS,
                &shadow_layout,
                module,
                ("mesh_row_vs", &buffers),
                "shadow_fs",
            );
            self.rows = Some(Rows {
                kernels,
                layout,
                opaque,
                culled,
                shadow,
                cut: None,
            });
            self.compiled += 4;
            self.names.extend([
                "scene3d.rows",
                "scene3d.rows_back",
                "scene3d.rows_front",
                "scene3d.rows_shadow",
            ]);
        }
        let capped = self.capped;
        let Some(rows) = self.rows.as_mut() else {
            return;
        };
        if capped && rows.cut.is_none() {
            rows.cut = Some(draw_pipeline(
                d,
                self.families.samples,
                &self.scene_module,
                &rows.layout,
                self.planted.forward_z,
                None,
                "mesh_row_vs",
                "mesh_cut_fs",
                &row_buffers(),
            ));
            self.compiled += 1;
            self.names.push("scene3d.rows_cut");
        }
    }

    /// Each culled batch's lists, for every view this frame draws it into: the stale views'
    /// culls for the frame's first pass, or the CPU's f64 cull when the frame is its reference.
    fn update_culls(&mut self, device: &Device) {
        let Some(rows) = self.rows.as_ref() else {
            return;
        };
        let mut views: [Option<[f64; 16]>; cull::VIEWS] = [None; cull::VIEWS];
        views[cull::CAMERA] = Some(self.camera.0);
        views[cull::KEY_MAP] = self.shadow.clip;
        for (i, c) in self.cascaded.list.iter().enumerate() {
            views[cull::CASCADES + i] = Some(c.clip);
        }
        let plants = self.planted.cull;
        let read_back = self.planted.count_read_back;
        let stale = &self.cascaded.stale;
        for id in &self.order {
            let Some(batch) = self.batches.get_mut(id) else {
                continue;
            };
            for (key, set) in batch.solids.iter_mut().chain(batch.casters.iter_mut()) {
                let (Some(c), Some(records)) = (set.cull.as_mut(), set.buffer.as_ref()) else {
                    continue;
                };
                let item = set.owners.first().and_then(|o| o.split('#').next());
                let item = item.unwrap_or_default().to_string();
                for (k, clip) in views.iter().enumerate() {
                    let Some(clip) = clip else { continue };
                    // The planted path: this frame draws the count the last one wrote.
                    if read_back {
                        if let Some(view) = &c.views[k] {
                            let last = read_back_u32(device, &view.count);
                            let bytes = bytemuck::bytes_of(&last);
                            deep_gpu::alloc::outside(|| {
                                device.queue.write_buffer(&view.args, 4, bytes)
                            });
                            self.counts.counts_read_back += 1;
                        }
                    }
                    // A cascade the frame doesn't redraw keeps its list and draws nothing.
                    if k < cull::CASCADES || stale.contains(&(k - cull::CASCADES)) {
                        self.counts
                            .indirect
                            .push((item.clone(), view_name(k), batch_name(key)));
                    }
                    if self.cpu_cull {
                        let planes = cull::planes(clip);
                        let kept: Vec<u32> = (0..set.models.len() as u32)
                            .filter(|i| {
                                cull::reaches(&planes, &set.models[*i as usize], &set.bounds)
                            })
                            .collect();
                        self.counts.cpu_culled += set.models.len() as u32;
                        c.write_kept(device, &rows.kernels, records, k, &kept);
                    } else if let Some(run) = c.cull(
                        device,
                        &rows.kernels,
                        records,
                        k,
                        clip,
                        set.revision,
                        &set.bounds,
                        plants,
                        read_back,
                    ) {
                        self.counts.culls += 1;
                        self.cull_runs.push(run);
                    }
                }
            }
        }
    }

    /// The frame's uniforms, outlines and shadow, and its atlas pages.
    fn prepare_frame(&mut self, device: &Device, scene: &Scene, look: &Look3) {
        self.counts = Counts::default();
        // #464: the print finish this frame draws, and each solid's color its separations read.
        self.print =
            (!look.print.is_identity()).then(|| (look.print.clone(), scene.print, scene.ground));
        self.print_colors = if look.print.separations.is_empty() {
            BTreeMap::new()
        } else {
            scene
                .layers
                .iter()
                .flat_map(|l| l.solids.iter().map(|s| (s.id.clone(), s.color)))
                .collect()
        };
        // Below internal scale 1 the targets are the internal size; px-sized marks shrink with
        // them, and the upscale returns the frame to `scene.size` (#386).
        self.size = scene.size;
        let internal = self.internal();
        self.ensure_targets(device, internal);
        let sheen = |s: &Solid| {
            s.material
                .is_some_and(|m| m.lobes.sheen.iter().any(|c| *c > 0.0))
        };
        if !self.sheen_written && scene.layers.iter().flat_map(|l| &l.solids).any(sheen) {
            let table = sheen_table();
            deep_gpu::alloc::outside(|| {
                device
                    .queue
                    .write_buffer(&self.dfg_buffer, 512 * 16, bytemuck::cast_slice(&table))
            });
            self.sheen_written = true;
        }
        // The opaque scene's copy, made while the scene holds a transmissive part (#428).
        // A see-through part whose material operator reads the copy needs it too (#431).
        let glass = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .any(|s| transmits(s) || s.op.as_ref().is_some_and(op::reads_backdrop));
        if glass != self.glass.as_ref().is_some_and(|g| g.size == internal) {
            if glass && self.glass_kit.is_none() {
                self.glass_kit = Some(glass::Kit::new(&device.device));
                let items = scene
                    .layers
                    .iter()
                    .flat_map(|l| &l.solids)
                    .filter(|s| transmits(s) || s.op.as_ref().is_some_and(op::reads_backdrop))
                    .map(|s| created::item_of(&s.id).to_string())
                    .collect();
                self.made_for.insert(glass::PASS, (items, "transmission".into(), "view".into()));
                self.compiled += 1;
                self.names.push(glass::PASS);
            }
            let kit = self.glass_kit.as_ref();
            self.glass = glass
                .then(|| kit.map(|k| glass::Glass::new(&device.device, internal, k)))
                .flatten();
            self.rebind_lights(device);
            // A material operator that reads the copy binds the new one.
            self.op_binds.clear();
        }
        let k = f64::from(internal[0]) / f64::from(scene.size[0].max(1));
        self.prepare_subsurface(device, scene, internal, k);
        self.upload_pages(device, &scene.pages);
        let cam = &scene.camera;
        let depth = if self.planted.forward_z {
            Depth::Forward { far: FORWARD_FAR }
        } else {
            Depth::Reversed
        };
        let mut rows = cam.clip(depth);
        // Look: samples (#423): a sub-sample's offset moves the projection by a fraction of a
        // pixel, right and down.
        let [jx, jy] = [
            2.0 * scene.jitter[0] / f64::from(scene.size[0].max(1)),
            -2.0 * scene.jitter[1] / f64::from(scene.size[1].max(1)),
        ];
        let w = rows[3];
        for (c, wc) in w.iter().enumerate() {
            rows[0][c] += jx * wc;
            rows[1][c] += jy * wc;
        }
        self.maps.texels.clone_from(&scene.texels);
        self.filter_taps = look.filter_taps;
        let mut clip = [[0f32; 4]; 4];
        let mut camera = [0.0; 16];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                clip[c][r] = *v as f32;
                camera[c * 4 + r] = *v;
            }
        }
        self.camera = (camera, cam.eye, cam.near);
        self.forward = cam.forward;
        self.compiled += self.ao.prepare(
            device,
            &self.scene_module,
            &self.families.draw_layout,
            &mesh_buffers(),
            &mut self.names,
            look.ao,
            internal,
            &camera,
            scene
                .shadowing
                .contact
                .zip(scene.sun.as_ref().filter(|s| s.shadow).map(|s| s.toward)),
        );
        // A sun shades the solids by its direction and illuminance (w: E ÷ π, the radiance a white
        // surface facing it reflects); with none, the view's own key light, w 0.
        let (toward, w) = match &scene.sun {
            Some(s) => (s.toward, s.illuminance / std::f64::consts::PI),
            None => (LIGHT, 0.0),
        };
        let light = {
            let l = toward;
            let n = (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt();
            [
                (l[0] / n) as f32,
                (l[1] / n) as f32,
                (l[2] / n) as f32,
                w as f32,
            ]
        };
        let below = internal != scene.size;
        let forward = if self.planted.forward_z { 1.0 } else { 0.0 };
        let perspective = if cam.perspective { 1.0 } else { 0.0 };
        let frame = FrameUniform {
            clip,
            right: v4(cam.right, 0.0),
            up: v4(cam.up, 0.0),
            viewport: [
                internal[0] as f32,
                internal[1] as f32,
                (cam.scale * k) as f32,
                perspective,
            ],
            light,
            px: [k as f32, if below { 1.0 } else { 0.0 }, 1.0, forward],
            sky_top: scene
                .sky
                .as_ref()
                .map_or([0.0; 4], |s| v4(s.ambient[0], 1.0)),
            sky_low: scene
                .sky
                .as_ref()
                .map_or([0.0; 4], |s| v4(s.ambient[1], 1.0)),
            inverse_clip: {
                let inv = op::invert(&rows);
                std::array::from_fn(|c| std::array::from_fn(|r| inv[r][c] as f32))
            },
            eye: v4(cam.eye, cam.near),
            cut: [[0.0; 4]; cut::MAX_PLANES],
            cut_info: [0; 4],
            cap: [0.0; 4],
        };
        let mut frame = frame;
        if let Some(c) = &scene.cutaway {
            for (k, (n, o)) in c.planes.iter().enumerate() {
                frame.cut[k] = v4(*n, *o);
            }
            frame.cut_info = [
                c.planes.len() as u32,
                u32::from(c.intersect),
                if c.cap.is_some() { 1 } else { 0 } | if c.cap_lit { 2 } else { 0 },
                0,
            ];
            frame.cap = v4(c.cap.unwrap_or([0.0; 3]), 1.0);
        }
        // The outline pass over the full-size slot, and over the internal size for the planted
        // programs that draw there.
        let display = FrameUniform {
            viewport: [
                scene.size[0] as f32,
                scene.size[1] as f32,
                cam.scale as f32,
                perspective,
            ],
            px: [1.0, 2.0, k as f32, forward],
            ..frame
        };
        let inside = FrameUniform {
            px: [1.0, 2.0, 1.0, forward],
            ..frame
        };
        deep_gpu::alloc::outside(|| {
            let q = &device.queue;
            q.write_buffer(&self.frame_buffer, 0, bytemuck::bytes_of(&frame));
            q.write_buffer(&self.outlines.display, 0, bytemuck::bytes_of(&display));
            q.write_buffer(&self.outlines.internal, 0, bytemuck::bytes_of(&inside));
        });
        self.prepare_outlines(device, scene);
        // A scene of materials shades the key sun's shadow through its cascades (#422); one of
        // painted solids alone keeps the single fitted map the effects' shadow reads.
        let cascaded = scene.cascaded();
        self.shadow.clip = scene
            .sun
            .as_ref()
            .filter(|s| s.shadow && !cascaded)
            .and_then(|s| shadow::light_clip(scene, s.toward, 0.0));
        self.prepare_cascades(device, scene, &frame);
        let policy = scene
            .light_cut
            .clone()
            .unwrap_or_else(|| light::policy(&scene.lights, &scene.camera));
        let scores = light::scores(&scene.lights, &scene.camera);
        let shadowed = light::shadowed(&scene.lights, &policy, &scene.shadowing, &scores);
        self.prepare_locals(device, scene, &frame, &shadowed.kept);
        let mut dropped = shadowed.dropped;
        dropped.sort();
        if self.ies.upload(device, &scene.distributions) {
            self.rebind_lights(device);
        }
        self.prepare_env(device, scene, &camera);
        self.sky = scene.sky.as_ref().is_some_and(|s| s.draws_background());
        self.prepare_puffs(device, scene);
        if self.sky && self.sky_pipeline.is_none() {
            self.sky_pipeline = Some(sky_pipeline(
                &device.device,
                self.families.samples,
                &self.scene_module,
                &self.solid_layout,
                self.planted.forward_z,
            ));
            self.compiled += 1;
            self.names.push(SKY_PASS);
        }
        self.prepare_lights(device, scene, policy, dropped);
        if let Some(m) = self.shadow.clip {
            let mut light_frame = frame;
            for c in 0..4 {
                for r in 0..4 {
                    light_frame.clip[c][r] = m[c * 4 + r] as f32;
                }
            }
            // The shadow pass's mark (scene3d.wgsl's `mesh_vs`): it leaves out what casts none.
            light_frame.light[3] = -1.0;
            Self::cut_casts(&self.planted, scene, &mut light_frame);
            deep_gpu::alloc::outside(|| {
                device
                    .queue
                    .write_buffer(&self.shadow.buffer, 0, bytemuck::bytes_of(&light_frame))
            });
        }
        let (map, white, contrast) = match look.tone_map {
            ToneMap::Agx { white, contrast } => (2, white, contrast),
            other => (other.code(), 16.29, 1.25),
        };
        let tone = ToneUniform {
            // #422's planted draws_black: nothing reaches the final target.
            exposure: if self.planted.draws_black {
                0.0
            } else {
                look.exposure as f32
            },
            map,
            white: white as f32,
            contrast: contrast as f32,
            encode: if self.planted.encodes_twice {
                1
            } else if self.planted.skips_encode {
                2
            } else {
                0
            },
            deband: look.deband.unwrap_or(0.0) as f32,
            saturation: look.grade.saturation as f32,
            graded: u32::from(!look.grade.is_identity()),
            wb: look
                .grade
                .white_balance()
                .map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, 0.0]),
            slope: rgb4(look.grade.slope),
            offset: rgb4(look.grade.offset),
            power: rgb4(look.grade.power),
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.tone_buffer, 0, bytemuck::bytes_of(&tone))
        });
        self.ground = [
            decode(scene.ground[0]),
            decode(scene.ground[1]),
            decode(scene.ground[2]),
            1.0,
        ];
    }

    /// The subsurface share and spread while a part's subsurface spreads (#481), made at the
    /// internal size from the geometry's targets.
    fn prepare_subsurface(&mut self, device: &Device, scene: &Scene, internal: [u32; 2], k: f64) {
        let spreading: Vec<&Solid> = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| spreads(s))
            .collect();
        let made = self.subsurface.as_ref().is_some_and(|s| s.size == internal);
        if made == spreading.is_empty() {
            self.subsurface = match (spreading.is_empty(), &self.targets) {
                (false, Some(t)) => Some(sss::Subsurface::new(
                    &device.device,
                    internal,
                    sss::Inputs {
                        ids: &t.ids_view,
                        samples: self.families.samples,
                        ids_ms: &t.drawn.ids_ms,
                        depth_ms: &t.drawn.depth_ms,
                        module: &self.scene_module,
                        layout: &self.solid_layout,
                    },
                )),
                _ => None,
            };
        }
        let Some(sub) = &self.subsurface else {
            return;
        };
        // The planted pass that takes every tap spreads at the widest mean free path of the
        // scene's parts, at the pixel size of the nearest one's centre.
        let across = (self.planted.lobes & PLANT_SSS_ACROSS != 0).then(|| {
            let cam = &scene.camera;
            let widest = spreading
                .iter()
                .filter_map(|s| s.material)
                .flat_map(|m| m.lobes.subsurface_radius)
                .fold(0.0, f64::max);
            let near = spreading
                .iter()
                .map(|s| {
                    let c = [s.model[0][3], s.model[1][3], s.model[2][3]];
                    (0..3)
                        .map(|i| (c[i] - cam.eye[i]) * cam.forward[i])
                        .sum::<f64>()
                })
                .fold(f64::INFINITY, f64::min);
            let px = if cam.perspective {
                near / (cam.scale * k)
            } else {
                1.0 / (cam.scale * k)
            };
            (widest * 1000.0, px * 1000.0)
        });
        sub.write(&device.queue, across);
    }

    fn prepare_batch(
        &mut self,
        device: &Device,
        layer: &Layer3,
        cam: &deep_canvas_scene3d::scene::Camera,
    ) {
        self.compiled += self.families.ensure(&device.device, layer, &mut self.names);
        let clear = |s: &Solid| {
            s.per_pixel
                || faded(s)
                || transmits(s)
                || s.material
                    .is_some_and(|m| m.alpha_mode.see_through() || m.catch.is_some())
        };
        let kind_of = |s: &Solid| {
            if s.per_pixel {
                PER_PIXEL
            } else if faded(s) {
                FADE
            } else if transmits(s) {
                GLASS
            } else if s.material.is_some_and(|m| m.alpha_mode == AlphaMode::Add) {
                ADD
            } else {
                BLEND
            }
        };
        for k in 0..6 {
            let of_kind = |s: &&Solid| {
                clear(s) && usize::from(kind_of(s)) == if k == 3 { usize::from(FADE) } else { k }
            };
            let wanted = layer.solids.iter().any(|s| of_kind(&s));
            if wanted && self.clear_pipelines[k].is_none() {
                let items: Vec<String> = layer.solids.iter().filter(of_kind).map(|s| created::item_of(&s.id).to_string()).collect();
                let set = layer.solids.iter().find(of_kind).map(created::feature_set).unwrap_or_default();
                self.made_for.insert(CLEAR_NAMES[k], (items, set, "view".into()));
                self.clear_pipelines[k] = Some(clear_pipeline(
                    &device.device,
                    self.families.samples,
                    &self.families.module,
                    &self.solid_layout,
                    &self.planted,
                    k,
                    k == usize::from(GLASS) || k == usize::from(PER_PIXEL),
                ));
                self.compiled += 1;
                self.names.push(CLEAR_NAMES[k]);
            }
        }
        // Blend and add parts draw after the opaque copy whenever there is one: for glass, or
        // for a see-through part's material operator that reads it (#431).
        let glass = self.clear_pipelines[usize::from(GLASS)].is_some() || self.glass.is_some();
        for k in [BLEND, ADD].map(usize::from) {
            if glass && self.clear_pipelines[k].is_some() && self.late_pipelines[k].is_none() {
                let items: Vec<String> = layer.solids.iter().filter(|s| clear(s) && usize::from(kind_of(s)) == k).map(|s| created::item_of(&s.id).to_string()).collect();
                let set = if k == usize::from(ADD) { "add+over_glass" } else { "blend+over_glass" };
                self.made_for.insert(LATE_NAMES[k], (items, set.into(), "view".into()));
                self.late_pipelines[k] = Some(clear_pipeline(
                    &device.device,
                    self.families.samples,
                    &self.families.module,
                    &self.solid_layout,
                    &self.planted,
                    k,
                    true,
                ));
                self.compiled += 1;
                self.names.push(LATE_NAMES[k]);
            }
        }
        let mut written = 0u32;
        let mut next = self.next_generation;
        if !self.batches.contains_key(&layer.id) {
            self.batches.insert(layer.id.clone(), Batch::default());
        }
        let mut slots = std::mem::take(
            &mut self
                .batches
                .get_mut(&layer.id)
                .expect("made above")
                .solid_slots,
        );
        slots.clear();
        let taps = if self.planted.anisotropy_one {
            1
        } else {
            self.filter_taps
        };
        // A batch above the line needs its pipelines before it encodes (#484).
        if layer.solids.iter().any(|s| s.batch != 0 && !clear(s)) {
            self.ensure_rows(device);
        }
        for s in &layer.solids {
            match &s.mesh {
                Some(m) => self.built_mesh(device, s.shape, m),
                None => self.mesh(device, s.shape),
            }
            let tie = self.ties.get(&s.id).copied().unwrap_or(0);
            // A see-through part blends through its material operator (#431); the other
            // see-through kinds still refuse one.
            let op = self.material_op(device, s, clear(s) && !matches!(kind_of(s), BLEND | FADE));
            let maps = match (&s.maps, &s.material) {
                (Some(m), Some(_)) => self.maps.group(&device.device, &device.queue, m, taps),
                _ => 0,
            };
            // A material operator binds its inputs with the solid's maps, once per pair.
            if let (Some(Ok(m)), false) = (
                self.materials.get(&op),
                self.op_binds.contains_key(&(op, maps)),
            ) {
                let none = light::Maps::default();
                let source = s.maps.as_deref().filter(|_| maps != 0).unwrap_or(&none);
                // Its texture inputs (#431): images by hash, and the opaque scene's copy.
                let views: Vec<wgpu::TextureView> = m
                    .textures
                    .iter()
                    .map(|t| match t {
                        op::TexIn::Asset(sha) => {
                            self.maps.view_of(&device.device, &device.queue, sha)
                        }
                        op::TexIn::Backdrop => self
                            .glass
                            .as_ref()
                            .map_or(self.glass_stub.clone(), |g| g.view.clone()),
                    })
                    .collect();
                let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                let g = self.maps.bind_with(
                    &device.device,
                    &device.queue,
                    source,
                    taps,
                    &m.layout,
                    m.entries(&refs),
                );
                self.op_binds.insert((op, maps), g);
            }
            // Its opaque draw culls back faces, front faces when mirrored, unless its material is
            // double-sided or it draws see-through (#425).
            let cull = match &s.material {
                Some(m) if !m.double_sided && !clear(s) => {
                    if !self.planted.winding_ignores_determinant && det(&s.model) < 0.0 {
                        2
                    } else {
                        1
                    }
                }
                _ => 0,
            };
            // Its feature set's bits (#432): an opaque part that shades extra lobes draws through
            // the lobes pipeline, and a mask-alpha part casts through the mask caster's.
            let lobed = !clear(s)
                && op == 0
                && s.batch == 0
                && s.material.as_ref().is_some_and(|m| m.lobes.on());
            let mask = s
                .material
                .as_ref()
                .is_some_and(|m| m.alpha_mode == AlphaMode::Mask);
            if lobed && self.lobed[cull as usize].is_none() {
                self.lobed[cull as usize] = Some(opaque_pipeline(
                    &device.device,
                    self.families.samples,
                    &self.scene_module,
                    &self.solid_layout,
                    self.planted.forward_z,
                    [None, Some(wgpu::Face::Back), Some(wgpu::Face::Front)][cull as usize],
                    &mesh_buffers(),
                    true,
                ));
                let name = ["scene3d.opaque_lobes", "scene3d.opaque_lobes_back", "scene3d.opaque_lobes_front"][cull as usize];
                let items: Vec<String> = layer
                    .solids
                    .iter()
                    .filter(|x| !clear(x) && x.material.as_ref().is_some_and(|m| m.lobes.on()))
                    .map(|x| created::item_of(&x.id).to_string())
                    .collect();
                self.made_for.insert(name, (items, created::feature_set(s), "view".into()));
                self.compiled += 1;
                self.names.push(name);
            }
            let bits = if lobed { LOBES_BIT } else { 0 } | if mask { MASK_BIT } else { 0 };
            slots.push((
                (s.shape, maps | bits | cull << CULL_SHIFT, op, s.batch),
                0,
                self.pick(&s.id),
                tie,
            ));
        }
        for l in &layer.lines {
            self.pick(&l.id);
        }
        for p in &layer.points {
            self.pick(&p.id);
        }
        for l in &layer.labels {
            self.pick(&l.id);
        }
        let picks = &self.picks;
        let batch = self.batches.get_mut(&layer.id).expect("made above");
        for set in batch.solids.values_mut().chain(batch.casters.values_mut()) {
            set.begin();
        }
        let winding = !self.planted.winding_ignores_determinant;
        let by_position = self.planted.ids_by_draw_position;
        let adjusts = &mut self.adjusts;
        let mut adjust_of = |s: &Solid| -> u32 {
            let Some(a) = s.adjust.filter(Adjust3::colors) else {
                return 0;
            };
            let e = AdjustEntry::of(&a);
            let bytes = bytemuck::bytes_of(&e);
            let k = match adjusts.iter().position(|x| bytemuck::bytes_of(x) == bytes) {
                Some(k) => k,
                None if adjusts.len() < ADJUSTS => {
                    adjusts.push(e);
                    adjusts.len() - 1
                }
                None => return 0,
            };
            k as u32 + 1
        };
        // Its lobes' entry in the frame's lobe table, 0 for none (#428), above the adjust's.
        let lobe_table = &mut self.lobe_table;
        let mut lobes_of = |s: &Solid| -> u32 {
            let lobes = s.material.as_ref().map(|m| drawn_lobes(s, &m.lobes));
            let (Some(m), Some(lobes)) = (s.material.as_ref(), lobes.filter(|l| l.on())) else {
                return 0;
            };
            // The flakes hash the material's pattern seed with the cell.
            // Thickness scales with the part as glTF's does: a mesh's model, never a primitive
            // mark's size.
            let scale = if s.mesh.is_some() {
                det(&s.model).abs().cbrt()
            } else {
                1.0
            };
            let e = lobe_entry(&lobes, m.pattern_seed, scale);
            let sub = subsurface_entry(&lobes);
            let k = match lobes_at(lobe_table, &e, sub.as_ref()) {
                Some(k) => k,
                None if lobe_table.len() + usize::from(sub.is_some()) < LOBE_ENTRIES => {
                    lobe_table.push(e);
                    lobe_table.extend(sub);
                    lobe_table.len() - 1 - usize::from(sub.is_some())
                }
                None => return 0,
            };
            (k as u32 + 1) << 16
        };
        let mut order: Vec<(&Solid, &mut Slot)> = layer.solids.iter().zip(&mut slots).collect();
        // The planted ties_by_submission: the opaque draws' order turns over each frame.
        if self.planted.ties_by_submission && self.flip {
            order.reverse();
        }
        // See-through parts and shadow catchers draw after the opaque ones, back to front by
        // view depth plus their sort_bias, ties by ID.
        let mut see_through = Vec::new();
        for (s, slot) in order {
            let adjust = adjust_of(s) | lobes_of(s);
            let mut record = solid_record(
                s,
                slot.2,
                slot.3,
                winding,
                slot.0 .1 & MAPS_INDEX != 0,
                adjust,
            );
            if clear(s) {
                let c = [s.model[0][3], s.model[1][3], s.model[2][3]];
                let depth = (0..3)
                    .map(|k| (c[k] - cam.eye[k]) * cam.forward[k])
                    .sum::<f64>();
                see_through.push((
                    depth + s.sort_bias,
                    s,
                    record,
                    (slot.0 .0, slot.0 .1),
                    slot.0 .2,
                ));
                slot.1 = u32::MAX;
                continue;
            }
            let sets = if s.cast_only {
                &mut batch.casters
            } else {
                &mut batch.solids
            };
            let set = sets.entry(slot.0).or_default();
            set.lower |= s.mask.is_some_and(|m| m.lower);
            set.subsurface |= spreads(s);
            slot.1 = set.count as u32;
            if slot.0 .3 != 0 {
                // One box per set: its elements share the set's shape, so its mesh's bounds.
                if set.count == 0 {
                    set.bounds = s.mesh.as_ref().map_or([[-0.5; 3], [0.5; 3]], |m| {
                        let b = m.bounds();
                        [b[0].map(f64::from), b[1].map(f64::from)]
                    });
                }
                set.elements.push(s.row);
                if self.cpu_cull {
                    set.models.push(s.model);
                }
            }
            // The planted wrong program writes an element's place in its draw as its ID.
            if by_position {
                record.pick = slot.1 + 1;
            }
            set.push(&s.id, bytemuck::bytes_of(&record));
        }
        see_through.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
        batch.clear.begin();
        batch.clear_draws.clear();
        batch.clear_ops.clear();
        for (_, s, record, key, op) in &see_through {
            batch.clear.push(&s.id, bytemuck::bytes_of(record));
            batch.clear_draws.push((*key, kind_of(s)));
            batch.clear_ops.push(*op);
        }
        batch.clear.finish(device, &mut next, &mut written);
        batch.solid_slots = slots;
        batch.solids.retain(|_, set| set.count > 0);
        batch.casters.retain(|_, set| set.count > 0);
        for (key, set) in batch.solids.iter_mut().chain(batch.casters.iter_mut()) {
            set.finish(device, &mut next, &mut written);
            // A batch's cull is made once for its records and how many it holds (#484).
            let made_for = (set.generation, set.count as u32);
            let source = set.owners.first().and_then(|o| {
                let item = o.split('#').next()?;
                self.sources.iter().find(|s| s.instancer == item)
            });
            match (&self.rows, self.meshes.get(&key.0), &set.buffer) {
                (Some(rows), Some(mesh), Some(records))
                    if key.3 != 0
                        && set.cull.as_ref().is_none_or(|c| {
                            c.made_for != made_for || c.from_output() != source.is_some()
                        }) =>
                {
                    let kept = source.map(|s| (s.clone(), &set.elements[..]));
                    set.cull = deep_gpu::alloc::outside(|| {
                        let mut c = cull::Culled::new(
                            &device.device,
                            &rows.kernels,
                            records,
                            made_for,
                            mesh.count,
                            self.planted.cull.reversed,
                            kept,
                        );
                        // The bundle draws from the camera's list and arguments.
                        c.view(&device.device, &rows.kernels, records, cull::CAMERA);
                        Some(c)
                    });
                }
                _ => {}
            }
        }
        batch.lines.begin();
        for l in &layer.lines {
            for seg in &l.segments {
                let record = SegmentRecord {
                    a: v4(seg.a, seg.wa),
                    b: v4(seg.b, seg.wb),
                    color: pack(l.color),
                    pick: picks[&l.id],
                    // A mesh-edge line sits a hair toward the camera, so the faces whose
                    // edges it draws don't hide it; one drawn over everything skips depth.
                    flags: u32::from(l.world)
                        | (u32::from(l.edges.is_some()) << 1)
                        | (u32::from(l.over) << 2)
                        | (u32::from(l.joined) << 3)
                        | (u32::from(l.dash_world) << 4),
                    dash: half_bits(l.dash[0]) | (half_bits(l.dash[1]) << 16),
                };
                batch.lines.push(&l.id, bytemuck::bytes_of(&record));
            }
        }
        batch.lines.finish(device, &mut next, &mut written);
        batch.points.begin();
        for p in &layer.points {
            let shape = match p.shape {
                PointShape::Dot => 0,
                PointShape::Square => 1,
                PointShape::Diamond => 2,
            };
            let record = PointRecord {
                p: v4(p.pos, p.size),
                color: pack(p.color),
                pick: picks[&p.id],
                flags: u32::from(p.world) | (shape << 1),
                pad: 0,
            };
            batch.points.push(&p.id, bytemuck::bytes_of(&record));
        }
        batch.points.finish(device, &mut next, &mut written);
        batch.labels.begin();
        for l in &layer.labels {
            let facing = match l.facing {
                Facing::Camera => 0,
                Facing::Upright => 1,
                Facing::Fixed => 2,
            };
            let half = half_fraction(l.bounds).map(f64::from);
            for g in &l.glyphs {
                let Some(a) = g.atlas else { continue };
                let texel = |v: u32| v as f32 / PAGE as f32;
                let record = TextRecord {
                    p: v4(l.pos, l.em),
                    rect: g.rect,
                    uv: [texel(a.x), texel(a.y), texel(a.x + a.w), texel(a.y + a.h)],
                    right: v4(l.axes[0], half[0]),
                    up: v4(l.axes[1], half[1]),
                    color: pack(l.color),
                    pick: picks[&l.id],
                    flags: u32::from(l.world)
                        | (facing << 1)
                        | (a.page << 3)
                        | if l.world || self.planted.labels_before_upscale {
                            0
                        } else {
                            LATER
                        },
                    pad: 0,
                };
                batch.labels.push(&l.id, bytemuck::bytes_of(&record));
            }
        }
        batch.labels.finish(device, &mut next, &mut written);
        self.next_generation = next;
        self.counts.instances_written += written;

        // The draw key: each draw's pipeline, the buffers and bind groups it binds by resource,
        // and its counts. The values written into those buffers never enter it.
        batch.next_key.clear();
        if !batch.solids.is_empty() {
            batch.next_key.extend([20, self.ao.generation]);
        }
        for ((shape, maps, op, _), set) in &batch.solids {
            batch.next_key.extend([
                shape_code(*shape),
                u64::from(set.lower),
                u64::from(*maps),
                *op,
                set.generation,
                u64::from(set.len()),
                u64::from(set.cull.as_ref().is_some_and(cull::Culled::from_output)),
            ]);
        }
        for (family, set) in [(10, &batch.lines), (11, &batch.points), (12, &batch.labels)] {
            if set.len() > 0 {
                batch
                    .next_key
                    .extend([family, set.generation, u64::from(set.len())]);
            }
        }
        if !batch.clear_draws.is_empty() {
            batch.next_key.extend([13, batch.clear.generation]);
            for ((shape, maps), kind) in &batch.clear_draws {
                batch
                    .next_key
                    .extend([shape_code(*shape), u64::from(*maps), u64::from(*kind)]);
            }
        }
        // The lights' bind group, once it reads the drawn shadow map; the capped cutaway's
        // pipeline (#424).
        batch.next_key.push(self.lights_generation);
        batch.next_key.push(u64::from(self.capped));
        let unchanged = batch.bundle.is_some() && batch.key == batch.next_key;
        let keeps_stale = self.planted.replays_after_add && batch.bundle.is_some();
        if (unchanged || keeps_stale) && !self.planted.encodes_every_frame {
            self.counts.replayed += 1;
            return;
        }
        std::mem::swap(&mut batch.key, &mut batch.next_key);
        let bundle = self.encode(device, &layer.id);
        let batch = self.batches.get_mut(&layer.id).expect("made above");
        batch.bundle = Some(bundle);
        self.counts.encoded.push((layer.id.clone(), layer.items()));
    }

    /// After a frame that drew per-pixel items (#424): how many fragments it wrote, and whether
    /// they ran out of room at the class's cap. Below the cap it makes more room and answers
    /// true: the caller draws the frame again.
    pub fn check_fragments(&mut self, device: &Device) -> bool {
        let Some((count, capped, remade)) = self.oit.check(device) else {
            return false;
        };
        self.counts.fragments = count;
        self.counts.fragments_capped = capped;
        if remade {
            self.rebind_lights(device);
        }
        remade
    }

    /// The opaque sets holding a part whose subsurface spreads, for the share pass (#481).
    fn share_draws(&self) -> Vec<sss::ShareDraw> {
        let mut draws = Vec::new();
        for id in &self.order {
            for ((shape, maps, _, _), set) in &self.batches[id].solids {
                let (true, None, Some(buffer), Some(mesh)) = (
                    set.subsurface,
                    &set.cull,
                    &set.buffer,
                    self.meshes.get(shape),
                ) else {
                    continue;
                };
                draws.push((
                    mesh.vertices.clone(),
                    mesh.indices.clone(),
                    mesh.count,
                    buffer.clone(),
                    set.len(),
                    self.maps.by_index(*maps & MAPS_INDEX).clone(),
                ));
            }
        }
        draws
    }

    /// The per-pixel items' draws in see-through order, for the sorted fallback (#424).
    #[allow(clippy::type_complexity)]
    fn per_pixel_draws(
        &self,
    ) -> Vec<(
        wgpu::Buffer,
        wgpu::Buffer,
        u32,
        wgpu::Buffer,
        u32,
        wgpu::BindGroup,
    )> {
        self.clear_kind_draws(PER_PIXEL)
    }

    /// With glass in the frame, its blend and add parts' draws with their pipelines, in layer
    /// order then back to front (#428); a blend part with a material operator draws through it
    /// (#431). Each says whether it reads the opaque scene's copy.
    fn late_draws(&self) -> Vec<(LateDraw, bool)> {
        let mut draws = Vec::new();
        for id in &self.order {
            let batch = &self.batches[id];
            let Some(buffer) = &batch.clear.buffer else {
                continue;
            };
            for (k, ((shape, maps), kind)) in batch.clear_draws.iter().enumerate() {
                if *kind != BLEND && *kind != ADD {
                    continue;
                }
                let Some(mesh) = self.meshes.get(shape) else {
                    continue;
                };
                let op = batch.clear_ops.get(k).copied().unwrap_or(0);
                let (pipeline, group, reads) = match self.see_through_op(op, *maps) {
                    Some((m, g)) if *kind == BLEND => {
                        (m.blend_late.clone(), g.clone(), m.reads_backdrop())
                    }
                    _ => match &self.late_pipelines[usize::from(*kind)] {
                        Some(p) => (p.clone(), self.maps.by_index(*maps).clone(), false),
                        None => continue,
                    },
                };
                draws.push((
                    (
                        pipeline,
                        (
                            mesh.vertices.clone(),
                            mesh.indices.clone(),
                            mesh.count,
                            buffer.clone(),
                            k as u32,
                            group,
                        ),
                    ),
                    reads,
                ));
            }
        }
        draws
    }

    /// A see-through part's material operator and its bind group, where it draws through one.
    fn see_through_op(&self, op: u64, maps: u32) -> Option<(&op::MatOp, &wgpu::BindGroup)> {
        if op == 0 {
            return None;
        }
        match (
            self.materials.get(&op),
            self.op_binds.get(&(op, maps & MAPS_INDEX)),
        ) {
            (Some(Ok(m)), Some(g)) => Some((m, g)),
            _ => None,
        }
    }

    /// Every see-through draw of `kind` across the batches, in layer order then back to front.
    #[allow(clippy::type_complexity)]
    fn clear_kind_draws(
        &self,
        of: u8,
    ) -> Vec<(
        wgpu::Buffer,
        wgpu::Buffer,
        u32,
        wgpu::Buffer,
        u32,
        wgpu::BindGroup,
    )> {
        let mut draws = Vec::new();
        for id in &self.order {
            let batch = &self.batches[id];
            let Some(buffer) = &batch.clear.buffer else {
                continue;
            };
            for (k, ((shape, maps), kind)) in batch.clear_draws.iter().enumerate() {
                if let (true, Some(mesh)) = (*kind == of, self.meshes.get(shape)) {
                    draws.push((
                        mesh.vertices.clone(),
                        mesh.indices.clone(),
                        mesh.count,
                        buffer.clone(),
                        k as u32,
                        self.maps.by_index(*maps).clone(),
                    ));
                }
            }
        }
        draws
    }

    /// Records a batch's draws into a render bundle.
    fn encode(&self, device: &Device, id: &str) -> wgpu::RenderBundle {
        let batch = &self.batches[id];
        let mut enc =
            device
                .device
                .create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor {
                    label: Some(id),
                    color_formats: &[Some(LINEAR), Some(IDS_MS)],
                    depth_stencil: Some(wgpu::RenderBundleDepthStencil {
                        format: DEPTH,
                        depth_read_only: false,
                        stencil_read_only: true,
                    }),
                    sample_count: self.families.samples,
                    multiview: None,
                });
        enc.set_bind_group(0, &self.frame_bind, &[]);
        enc.set_bind_group(1, &self.lights_bind, &[]);
        enc.set_bind_group(2, self.ao.shade(), &[]);
        // Inside a band margin an item's less detailed band (its box, enclosing the full mesh)
        // draws after its more detailed one (#425): drawn first, its nearer depth would cut the
        // detailed band's pixel quads and move their shading's derivatives with GPU timing.
        let (detailed, lower): (Vec<_>, Vec<_>) =
            batch.solids.iter().partition(|(_, set)| !set.lower);
        for ((shape, maps, op, _), set) in detailed.into_iter().chain(lower) {
            let (Some(buffer), Some(mesh)) = (&set.buffer, self.meshes.get(shape)) else {
                continue;
            };
            let index = *maps & MAPS_INDEX;
            // An instancer's batch draws the rows its cull kept for the camera, by the count the
            // GPU wrote (#484).
            let culled = set.cull.as_ref().and_then(|c| {
                let rows = self.rows.as_ref()?;
                Some((c, c.views[cull::CAMERA].as_ref()?, rows))
            });
            if let Some((c, view, rows)) = culled {
                enc.set_pipeline(match (&rows.cut, self.capped, *maps >> CULL_SHIFT) {
                    (Some(cut), true, _) => cut,
                    (_, _, 1) => &rows.culled[0],
                    (_, _, 2) => &rows.culled[1],
                    _ => &rows.opaque,
                });
                enc.set_bind_group(3, self.maps.by_index(index), &[]);
                enc.set_bind_group(4, &c.records, &[]);
                enc.set_vertex_buffer(0, mesh.vertices.slice(..));
                enc.set_vertex_buffer(1, view.rows.slice(..));
                enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                enc.draw_indexed_indirect(&view.args, 0);
                continue;
            }
            match (self.materials.get(op), self.op_binds.get(&(*op, index))) {
                (Some(Ok(m)), Some(g)) => {
                    enc.set_pipeline(&m.pipeline);
                    enc.set_bind_group(3, g, &[]);
                }
                _ => {
                    // A capped cutaway draws its caps from back faces, so nothing culls then.
                    let cull = (*maps >> CULL_SHIFT) as usize;
                    let lobed = self.lobed[cull].as_ref().filter(|_| *maps & LOBES_BIT != 0);
                    enc.set_pipeline(match (&self.cut_pipeline, self.capped, lobed, cull) {
                        (Some(cut), true, _, _) => cut,
                        (_, _, Some(p), _) => p,
                        (_, _, _, 1) => &self.mesh_culled[0],
                        (_, _, _, 2) => &self.mesh_culled[1],
                        _ => &self.mesh_pipeline,
                    });
                    enc.set_bind_group(3, self.maps.by_index(index), &[]);
                }
            }
            enc.set_vertex_buffer(0, mesh.vertices.slice(..));
            enc.set_vertex_buffer(1, buffer.slice(..));
            enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
            enc.draw_indexed(0..mesh.count, 0, 0..set.len());
        }
        if let Some(buffer) = &batch.clear.buffer {
            for (k, ((shape, maps), kind)) in batch.clear_draws.iter().enumerate() {
                let Some(mesh) = self.meshes.get(shape) else {
                    continue;
                };
                // Transmissive parts draw after the opaque scene's copy, and with them in the
                // frame, blend and add parts after them, so the copy holds the opaque scene alone
                // and a see-through part in front of glass shows over it (#428).
                if *kind == GLASS || (self.glass.is_some() && (*kind == BLEND || *kind == ADD)) {
                    continue;
                }
                // A per-pixel item adds its fragments after the resolve, at one sample, so one
                // triangle adds each pixel's (#1173): at 4 samples a pixel runs for each
                // triangle that covers any of its samples, twice along a shared edge.
                if *kind == PER_PIXEL {
                    continue;
                }
                let k = k as u32;
                // A fade draws its depth pass, then its color where that depth holds (#424).
                let kinds = if *kind == FADE {
                    &[usize::from(FADE), usize::from(FADE) + 1][..]
                } else {
                    &[usize::from(*kind)][..]
                };
                // A blend part with a material operator draws through it (#431); a fade's two
                // passes through its fade pipelines (#432).
                let op = batch.clear_ops.get(k as usize).copied().unwrap_or(0);
                if let (Some((m, g)), FADE) = (self.see_through_op(op, *maps), *kind) {
                    enc.set_bind_group(3, g, &[]);
                    for pipeline in &m.fade {
                        enc.set_pipeline(pipeline);
                        enc.set_vertex_buffer(0, mesh.vertices.slice(..));
                        enc.set_vertex_buffer(1, buffer.slice(..));
                        enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                        enc.draw_indexed(0..mesh.count, 0, k..k + 1);
                    }
                    continue;
                }
                if let (Some((m, g)), BLEND) = (self.see_through_op(op, *maps), *kind) {
                    enc.set_bind_group(3, g, &[]);
                    enc.set_pipeline(&m.blend);
                    enc.set_vertex_buffer(0, mesh.vertices.slice(..));
                    enc.set_vertex_buffer(1, buffer.slice(..));
                    enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    enc.draw_indexed(0..mesh.count, 0, k..k + 1);
                    continue;
                }
                for &p in kinds {
                    let Some(pipeline) = &self.clear_pipelines[p] else {
                        continue;
                    };
                    enc.set_bind_group(3, self.maps.by_index(*maps), &[]);
                    enc.set_pipeline(pipeline);
                    enc.set_vertex_buffer(0, mesh.vertices.slice(..));
                    enc.set_vertex_buffer(1, buffer.slice(..));
                    enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                    enc.draw_indexed(0..mesh.count, 0, k..k + 1);
                }
            }
        }
        for (pipeline, set) in [
            (&self.families.line, &batch.lines),
            (&self.families.point, &batch.points),
        ] {
            if let (Some(buffer), Some(pipeline), true) = (&set.buffer, pipeline, set.len() > 0) {
                enc.set_pipeline(pipeline);
                enc.set_vertex_buffer(0, buffer.slice(..));
                enc.draw(0..6, 0..set.len());
            }
        }
        if let (Some(buffer), Some(pipeline), true) = (
            &batch.labels.buffer,
            &self.families.text,
            batch.labels.len() > 0,
        ) {
            enc.set_pipeline(pipeline);
            enc.set_vertex_buffer(0, buffer.slice(..));
            enc.set_bind_group(1, &self.atlas.bind, &[]);
            enc.draw(0..6, 0..batch.labels.len());
        }
        enc.finish(&wgpu::RenderBundleDescriptor { label: Some(id) })
    }

    /// This frame's ao passes over every batch's solids, in layer order; `None` with ao off.
    fn ao_frame(&self) -> Option<ao::Frame> {
        if !self.ao.is_on() {
            return None;
        }
        let solids = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id))
            .flat_map(|b| &b.solids)
            .filter_map(|((shape, ..), set)| {
                let (buffer, mesh) = (set.buffer.as_ref()?, self.meshes.get(shape)?);
                Some((
                    mesh.vertices.clone(),
                    mesh.indices.clone(),
                    mesh.count,
                    buffer.clone(),
                    set.len(),
                ))
            })
            .collect();
        self.ao.frame(&self.frame_bind, solids)
    }

    /// Every culled list as its cull last wrote it, read once the frame has drawn (#484). Nothing
    /// a frame draws reads this.
    pub fn read_kept(&self, device: &Device) -> Vec<KeptRow> {
        let mut rows = Vec::new();
        for id in &self.order {
            let Some(batch) = self.batches.get(id) else {
                continue;
            };
            for (key, set) in batch.solids.iter().chain(&batch.casters) {
                let Some(c) = &set.cull else { continue };
                let stable: Vec<u32> = set
                    .owners
                    .iter()
                    .map(|o| {
                        o.split('#')
                            .nth(1)
                            .and_then(|i| i.parse().ok())
                            .unwrap_or(u32::MAX)
                    })
                    .collect();
                let item = set.owners.first().and_then(|o| o.split('#').next());
                for (k, view) in c.views.iter().enumerate() {
                    let Some(view) = view else { continue };
                    let count = read_back(device, "scene3d kept", cull::ARGS, |e, staging| {
                        e.copy_buffer_to_buffer(&view.args, 0, staging, 0, cull::ARGS)
                    })
                    .map_or(0, |b| u32::from_le_bytes([b[4], b[5], b[6], b[7]]));
                    let size = u64::from(count.max(1)) * 4;
                    let kept = read_back(device, "scene3d kept", size, |e, staging| {
                        e.copy_buffer_to_buffer(&view.rows, 0, staging, 0, size)
                    });
                    let words = kept
                        .as_deref()
                        .map_or(&[][..], bytemuck::cast_slice::<u8, u32>);
                    rows.push(KeptRow {
                        item: item.unwrap_or_default().to_string(),
                        view: view_name(k),
                        batch: batch_name(key),
                        ids: words
                            .iter()
                            .take(count as usize)
                            .map(|r| stable.get(*r as usize).copied().unwrap_or(u32::MAX))
                            .collect(),
                    });
                }
            }
        }
        rows
    }

    pub fn counts(&self) -> &Counts {
        &self.counts
    }

    /// The key light's shadow map: the solids of every batch drawn depth-only from the light.
    /// The key light's shadow map, made the first time a frame draws it.
    fn shadow_view(&mut self, device: &Device) -> wgpu::TextureView {
        self.shadow
            .view
            .get_or_insert_with(|| {
                texture2d(
                    &device.device,
                    SHADOW_PASS,
                    [shadow::SIZE; 2],
                    shadow::FORMAT,
                    wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::COPY_SRC,
                )
                .create_view(&Default::default())
            })
            .clone()
    }

    /// Every caster's draw: its mesh, its instances and their range, in batch order.
    #[allow(clippy::type_complexity)]
    /// What a shadow map draws: `only`, when set, culls to those casters on the CPU (Light:
    /// casters; Light policy: local shadows), by runs of their instances. With `rows`, the map
    /// draws the culled batches from their rows, so they're left out here.
    fn caster_draws(&self, only: Option<&BTreeSet<String>>, rows: bool) -> Vec<local::Draw> {
        let mut draws = Vec::new();
        for id in &self.order {
            let batch = &self.batches[id];
            for ((shape, maps, op, _), set) in batch.solids.iter().chain(&batch.casters) {
                let (Some(buffer), Some(mesh)) = (&set.buffer, self.meshes.get(shape)) else {
                    continue;
                };
                // A material operator that cuts its coverage casts through its own pipeline.
                let cuts = self.shadow_cut(*op, *maps);
                // The rows draw this batch.
                if rows && set.cull.is_some() && cuts.is_none() {
                    continue;
                }
                // A mask-alpha set draws through the mask caster's pipeline, and only while one
                // of its parts casts.
                let mask = *maps & MASK_BIT != 0;
                if mask && !self.mask_casts && cuts.is_none() {
                    continue;
                }
                for range in local::runs(&set.owners, only) {
                    draws.push(local::Draw {
                        vertices: mesh.vertices.clone(),
                        indices: mesh.indices.clone(),
                        count: mesh.count,
                        instances: buffer.clone(),
                        range,
                        cuts: cuts.clone(),
                        mask,
                    });
                }
            }
            // See-through parts cast as their `shadow` says (the record's no-cast flag).
            if let Some(buffer) = &batch.clear.buffer {
                for (k, ((shape, _), _)) in batch.clear_draws.iter().enumerate() {
                    if let Some(mesh) = self.meshes.get(shape) {
                        let k = k as u32;
                        let owner = batch.clear.owners.get(k as usize);
                        if only.is_some_and(|o| owner.is_none_or(|i| !o.contains(i))) {
                            continue;
                        }
                        draws.push(local::Draw {
                            vertices: mesh.vertices.clone(),
                            indices: mesh.indices.clone(),
                            count: mesh.count,
                            instances: buffer.clone(),
                            range: k..k + 1,
                            cuts: None,
                            mask: false,
                        });
                    }
                }
            }
        }
        draws
    }

    /// The pipeline and maps a material operator casts through when it cuts its coverage (#446).
    fn shadow_cut(&self, op: u64, maps: u32) -> Option<(wgpu::RenderPipeline, wgpu::BindGroup)> {
        if op == 0 {
            return None;
        }
        let m = self.materials.get(&op)?.as_ref().ok()?;
        let bind = self.op_binds.get(&(op, maps & MAPS_INDEX))?;
        Some((m.shadow.clone()?, bind.clone()))
    }

    /// Every culled batch's draw into shadow view `k`: its mesh, its records and the row list and
    /// indirect arguments its cull wrote (#484). A batch that cuts its coverage isn't one of them:
    /// the rows' one pipeline can't cut, so it draws from its instances.
    fn row_draws(&self, k: usize) -> Vec<RowDraw> {
        let mut draws = Vec::new();
        for id in &self.order {
            let batch = &self.batches[id];
            for ((shape, maps, op, _), set) in batch.solids.iter().chain(&batch.casters) {
                let Some(c) = &set.cull else { continue };
                if self.shadow_cut(*op, *maps).is_some() {
                    continue;
                }
                if let (Some(view), Some(mesh)) = (&c.views[k], self.meshes.get(shape)) {
                    draws.push((
                        mesh.vertices.clone(),
                        mesh.indices.clone(),
                        c.records.clone(),
                        view.rows.clone(),
                        view.args.clone(),
                    ));
                }
            }
        }
        draws
    }

    fn shadow_job(&mut self, device: &Device) -> Option<Job> {
        self.shadow.clip?;
        let view = self.shadow_view(device);
        let bind = self.shadow.bind.clone();
        Some(self.depth_job(SHADOW_PASS, view, bind, None, Some(cull::KEY_MAP)))
    }

    /// The casters drawn depth-only into `view` under the light frame `bind` holds.
    fn depth_job(
        &self,
        label: &'static str,
        view: wgpu::TextureView,
        bind: wgpu::BindGroup,
        only: Option<&BTreeSet<String>>,
        cull_view: Option<usize>,
    ) -> Job {
        // A cull's list holds no owners, so a caster set picks its elements from the instances;
        // a local map has no cull of its own and draws all it holds.
        let culled = cull_view.filter(|_| only.is_none());
        let draws = self.caster_draws(only, culled.is_some());
        let rows = culled.map_or_else(Vec::new, |k| self.row_draws(k));
        let row_pipeline = self.rows.as_ref().map(|r| r.shadow.clone());
        let pipeline = self.shadow.pipeline.clone();
        let mask_pipeline = self.shadow.mask.clone();
        let profiler = self.profiler.clone();
        Box::new(move |encoder| {
            timed(&profiler, label, encoder, |encoder, timestamp_writes| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(label),
                    color_attachments: &[],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(1.0),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes,
                    ..Default::default()
                });
                pass.set_bind_group(0, &bind, &[]);
                for d in &draws {
                    match (&d.cuts, &pipeline, &mask_pipeline, d.mask) {
                        (Some((cut, group)), _, _, _) => {
                            pass.set_pipeline(cut);
                            pass.set_bind_group(3, group, &[]);
                        }
                        (None, _, Some(p), true) | (None, Some(p), _, false) => pass.set_pipeline(p),
                        // Its caster kind's pipeline isn't made: the prepare that would make it
                        // didn't run for this frame.
                        _ => continue,
                    }
                    pass.set_vertex_buffer(0, d.vertices.slice(..));
                    pass.set_vertex_buffer(1, d.instances.slice(..));
                    pass.set_index_buffer(d.indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..d.count, 0, d.range.clone());
                }
                if let Some(pipeline) = &row_pipeline {
                    pass.set_pipeline(pipeline);
                    for (vertices, indices, records, rows, args) in &rows {
                        pass.set_bind_group(4, records, &[]);
                        pass.set_vertex_buffer(0, vertices.slice(..));
                        pass.set_vertex_buffer(1, rows.slice(..));
                        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed_indirect(args, 0);
                    }
                }
            });
        })
    }

    /// One depth pass per stale cascade, each into its own layer (#422).
    fn cascade_jobs(&self) -> Vec<(String, Job)> {
        let c = &self.cascaded;
        let mut jobs: Vec<(String, Job)> = Vec::new();
        if let Some((_, layers)) = &c.texture {
            jobs.extend(c.stale.iter().map(|&i| {
                let job = self.depth_job(
                    CASCADE_PASS,
                    layers[i].clone(),
                    c.frames[i].1.clone(),
                    c.casters.as_ref(),
                    Some(cull::CASCADES + i),
                );
                (CASCADE_PASS.to_string(), job)
            }));
        }
        // One depth pass per face of each stale local map (#446).
        if let Some((_, layers)) = &self.locals.texture {
            for &slot in &self.locals.stale {
                let m = &self.locals.list[slot];
                for &(offset, _) in &m.map.faces {
                    let layer = (m.first + offset) as usize;
                    let job = self.depth_job(
                        local::PASS,
                        layers[layer].clone(),
                        self.locals.frames[layer].1.clone(),
                        Some(&m.casters),
                        None,
                    );
                    jobs.push((local::PASS.to_string(), job));
                }
            }
        }
        jobs
    }

    /// The frame's passes, each one encode: the geometry pass replays every batch into the
    /// targets, `post`'s passes (with the shadow map before geometry when it asks) read them, and
    /// the output pass writes `slot` from the linear target `post` hands it, else geometry's.
    pub fn jobs(
        &mut self,
        device: &Device,
        slot: &wgpu::TextureView,
        post: Option<&mut dyn Post>,
        after: Option<&mut dyn After>,
    ) -> Vec<(String, Job)> {
        let shadow = match post.as_deref() {
            Some(p) if p.shadows() => self.shadow_job(device),
            _ => None,
        };
        let cascades = self.cascade_jobs();
        let Some(t) = self.targets.as_ref() else {
            return Vec::new();
        };
        let bundles: Vec<wgpu::RenderBundle> = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id)?.bundle.clone())
            .collect();
        let drawn = t.drawn.clone();
        let (linear, ids, depth) = (
            t.linear_view.clone(),
            drawn.ids.clone(),
            drawn.depth.clone(),
        );
        let (ground, clear_depth) = (self.ground, self.clear_depth());
        let sky = self.sky_draw();
        let puffs = self.puff_draw();
        let profiler = self.profiler.clone();
        // The per-pixel resolve after the geometry pass (#424): its lists cleared first, then
        // composited, or the items drawn sorted where they ran out of room.
        let resolve = match (
            &self.oit_pipelines,
            &self.clear_pipelines[usize::from(PER_PIXEL)],
            self.oit.active,
        ) {
            (Some([resolve, fallback]), Some(append), true) => Some((
                append.clone(),
                self.oit.heads.clone(),
                self.oit.info.clone(),
                resolve.clone(),
                fallback.clone(),
                [
                    self.frame_bind.clone(),
                    self.lights_bind.clone(),
                    self.ao.shade().clone(),
                    self.maps.by_index(0).clone(),
                ],
                self.per_pixel_draws(),
            )),
            _ => None,
        };
        let staging = resolve.as_ref().map(|_| self.oit.staging.clone());
        // Transmissive parts over the opaque scene's copy (#428), and the see-through parts whose
        // material operators read it (#431).
        let glass_draws = self.clear_kind_draws(GLASS);
        let late = self.late_draws();
        let readers = late.iter().any(|(_, reads)| *reads);
        let glass = match (&self.glass, &self.clear_pipelines[usize::from(GLASS)]) {
            (Some(_), pipeline) if !glass_draws.is_empty() || readers => Some((
                late,
                pipeline.clone(),
                [
                    self.frame_bind.clone(),
                    self.lights_bind.clone(),
                    self.ao.shade().clone(),
                ],
                glass_draws,
            )),
            _ => None,
        };
        let copy_late = self.planted.backdrop_after_see_through;
        let glass_copy = glass.as_ref().and(self.glass.clone());
        // The subsurface share and spread after the resolve (#481).
        let subsurface = self.subsurface.clone().map(|sub| {
            let binds = [
                self.frame_bind.clone(),
                self.lights_bind.clone(),
                self.ao.shade().clone(),
            ];
            (sub, binds, self.share_draws())
        });
        let core = self.core_draws();
        let linear_texture = t.linear.clone();
        let motion = self.motion_frame.take().map(|m| (m, t.linear.clone()));
        let reflection = self.reflection.as_ref().map(|r| r.1.clone());
        let geometry: Job = Box::new(move |encoder| {
            // #166: the `reflection` target starts each frame at 0.
            if let Some(view) = &reflection {
                drop(encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(GEOMETRY_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                }));
            }
            if let Some((_, heads, ..)) = &resolve {
                encoder.clear_buffer(heads, 0, None);
            }
            timed(&profiler, GEOMETRY_PASS, encoder, |encoder, timestamps| {
                geometry_pass(
                    encoder,
                    &drawn,
                    ground,
                    clear_depth,
                    sky.as_ref(),
                    bundles.iter(),
                    puffs.as_ref(),
                    timestamps,
                )
            });
            if let Some((append, _, info, pipeline, fallback, binds, draws)) = &resolve {
                per_pixel_pass(encoder, [&linear, &ids, &depth], append, binds, draws);
                timed(
                    &profiler,
                    "scene3d.resolve",
                    encoder,
                    |encoder, timestamps| {
                        let load = wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        };
                        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                            label: Some("scene3d.resolve"),
                            color_attachments: &[
                                Some(wgpu::RenderPassColorAttachment {
                                    view: &linear,
                                    resolve_target: None,
                                    depth_slice: None,
                                    ops: load,
                                }),
                                Some(wgpu::RenderPassColorAttachment {
                                    view: &ids,
                                    resolve_target: None,
                                    depth_slice: None,
                                    ops: load,
                                }),
                            ],
                            depth_stencil_attachment: Some(
                                wgpu::RenderPassDepthStencilAttachment {
                                    view: &depth,
                                    depth_ops: Some(wgpu::Operations {
                                        load: wgpu::LoadOp::Load,
                                        store: wgpu::StoreOp::Store,
                                    }),
                                    stencil_ops: None,
                                },
                            ),
                            timestamp_writes: timestamps,
                            ..Default::default()
                        });
                        for (i, b) in binds.iter().enumerate() {
                            pass.set_bind_group(i as u32, b, &[]);
                        }
                        pass.set_pipeline(pipeline);
                        pass.draw(0..3, 0..1);
                        pass.set_pipeline(fallback);
                        for (vertices, indices, count, instances, k, maps) in draws {
                            pass.set_bind_group(3, maps, &[]);
                            pass.set_vertex_buffer(0, vertices.slice(..));
                            pass.set_vertex_buffer(1, instances.slice(..));
                            pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                            pass.draw_indexed(0..*count, 0, *k..*k + 1);
                        }
                    },
                );
                // The frame's count, which `check_fragments` reads once the frame is done.
                if let Some(staging) = &staging {
                    encoder.copy_buffer_to_buffer(info, 0, staging, 0, 16);
                }
            }
            if let Some((sub, binds, draws)) = &subsurface {
                sub.record(encoder, &linear, binds, draws, &profiler);
            }
            // The core's targets an effect or operator reads, from what the geometry left (#431).
            if let Some(core) = &core {
                core.record(encoder);
            }
            if let (Some((late, pipeline, binds, draws)), Some(copy)) = (&glass, &glass_copy) {
                timed(&profiler, glass::PASS, encoder, |encoder, timestamps| {
                    // The planted copy is taken after the see-through parts that don't read it.
                    if copy_late {
                        let (readers, others): (Vec<_>, Vec<_>) =
                            late.iter().cloned().partition(|(_, reads)| *reads);
                        let others: Vec<LateDraw> = others.into_iter().map(|(d, _)| d).collect();
                        let readers: Vec<LateDraw> = readers.into_iter().map(|(d, _)| d).collect();
                        glass_pass(
                            encoder,
                            [&linear, &ids, &depth],
                            pipeline.as_ref(),
                            binds,
                            draws,
                            &others,
                            timestamps,
                        );
                        copy.record(encoder, &linear_texture);
                        glass_pass(
                            encoder,
                            [&linear, &ids, &depth],
                            None,
                            binds,
                            &[],
                            &readers,
                            None,
                        );
                        return;
                    }
                    copy.record(encoder, &linear_texture);
                    let late: Vec<LateDraw> = late.iter().map(|(d, _)| d.clone()).collect();
                    glass_pass(
                        encoder,
                        [&linear, &ids, &depth],
                        pipeline.as_ref(),
                        binds,
                        draws,
                        &late,
                        timestamps,
                    );
                });
            }
            // Motion blur by velocity resolves the finished geometry, glass included, before the
            // effects (#419).
            if let Some((m, linear)) = &motion {
                m.record(encoder, linear, &profiler);
            }
        });
        let mut jobs: Vec<(String, Job)> = Vec::new();
        // The stale views' culls, before anything draws from their counts (#484).
        if !self.cull_runs.is_empty() {
            let runs = std::mem::take(&mut self.cull_runs);
            let profiler = self.profiler.clone();
            jobs.push((
                CULL_PASS.into(),
                Box::new(move |encoder| {
                    timed(&profiler, CULL_PASS, encoder, |encoder, _| {
                        for run in &runs {
                            run.record(encoder);
                        }
                    })
                }),
            ));
        }
        if let Some(s) = shadow {
            jobs.push((SHADOW_PASS.into(), s));
        }
        jobs.extend(cascades);
        if let Some(ao) = self.ao_frame() {
            let profiler = self.profiler.clone();
            jobs.push((
                ao::OCCLUSION.into(),
                Box::new(move |encoder| ao.record(&profiler, encoder)),
            ));
        }
        jobs.push((GEOMETRY_PASS.into(), geometry));
        // #465: the mirror's view and its picture over the mirror's parts, before the effects.
        if let (true, Some(m), Some(t)) = (
            self.mirroring,
            self.mirrorer.as_mut(),
            self.targets.as_ref(),
        ) {
            let (linear, ids) = (t.linear_view.clone(), t.ids_view.clone());
            let reflection = self.reflection.as_ref().map(|r| r.1.clone());
            jobs.extend(m.jobs(device, slot, &linear, &ids, reflection, &self.profiler));
        }
        // #166: the water over the bed the geometry left, under the mirror's picture.
        if let (true, Some(w), Some(t)) =
            (self.watering, self.waterer.as_ref(), self.targets.as_ref())
        {
            let (drawn, clear, rect) = (t.drawn.clone(), self.clear_depth(), w.rect());
            let targets = water::Targets {
                linear: (t.linear.clone(), t.linear_view.clone()),
                ids_ms: t.drawn.ids_ms.clone(),
                depth_ms: t.drawn.depth_ms.clone(),
                reflection: self.reflection.as_ref().map(|r| r.1.clone()),
                resolve: Box::new(move |encoder, timestamps| {
                    resolve_ids(encoder, &drawn, clear, Some(rect), timestamps)
                }),
            };
            if let Some(job) = w.job(targets, &self.profiler) {
                jobs.push((WATER_PASS.into(), job));
            }
        }
        let covers = after.as_deref().and_then(|a| a.covers());
        deep_gpu::alloc::outside(|| self.cover(device, covers));
        let Some(t) = self.targets.as_ref() else {
            return Vec::new();
        };
        let mut bind = t.output_bind.clone();
        if let Some(post) = post {
            let frame = PostFrame {
                size: t.size,
                linear: &t.linear_view,
                depth: &t.depth_view,
                ids: &t.ids_view,
                shadow: self.shadow.view.as_ref().filter(|_| post.shadows()),
                clip: self.camera.0,
                eye: self.camera.1,
                near: self.camera.2,
                light_clip: self.shadow.clip,
                picks: &self.picks,
                core: ["velocity", "emission"]
                    .into_iter()
                    .filter_map(|n| Some((n, self.core_target(n)?)))
                    .collect(),
            };
            let (more, source) = post.jobs(device, &frame);
            jobs.extend(more);
            if let Some(view) = &source {
                bind = self.output_bind(&device.device, view);
            }
            self.pre_tone = source;
        } else {
            self.pre_tone = None;
        }
        // #465: the flare, added into the linear image the output reads.
        if let (true, Some(f), Some(t)) =
            (self.flaring, self.flarer.as_ref(), self.targets.as_ref())
        {
            let into = self
                .pre_tone
                .clone()
                .unwrap_or_else(|| t.linear_view.clone());
            if let Some(job) = f.job(device, &t.depth_view, &into, &self.profiler) {
                jobs.push((FLARE_PASS.into(), job));
            }
        }
        // With passes after the finish, the output writes the finished frame, and they write
        // the slot from it (#382). Below scale 1 the output and the guard write the internal
        // frame, which the upscale and sharpen return to the slot's size (#386).
        let size = t.size;
        let below = self.ensure_low(device);
        let low_view = self.low.as_ref().filter(|_| below).map(|l| l.view.clone());
        let framed = low_view.clone().unwrap_or_else(|| slot.clone());
        let finished = after.is_some().then(|| self.finished(device, size));
        let (target, pipeline) = match &finished {
            Some(f) => (f.clone(), self.output_f32.clone()),
            None => (framed.clone(), self.output_pipeline.clone()),
        };
        // #464: with a print finish, the output writes a frame of its own that the print pass
        // reads, and the print pass writes where the output would have.
        let printing = self.print_stage(device, size, finished.is_some());
        let (target, printed_into) = match &printing {
            Some(p) => (p.source.clone(), Some(target)),
            None => (target, None),
        };
        let profiler = self.profiler.clone();
        let (busy, busy_slot) = (self.busy.clone(), slot.clone());
        let output: Job = Box::new(move |encoder| {
            // The planted slow frame's pass, inside the frame's span of timed passes; it writes
            // the slot, which the output or the passes after it write again.
            if let Some(busy) = &busy {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene3d busy"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &busy_slot,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(busy);
                pass.draw(0..3, 0..1);
            }
            timed(&profiler, OUTPUT_PASS, encoder, |encoder, timestamps| {
                let black = wgpu::LoadOp::Clear(wgpu::Color::BLACK);
                full_pass(
                    encoder,
                    OUTPUT_PASS,
                    &target,
                    black,
                    &pipeline,
                    &bind,
                    timestamps,
                )
            });
            if let (Some(p), Some(into)) = (&printing, &printed_into) {
                p.record(encoder, into);
            }
        });
        jobs.push((OUTPUT_PASS.into(), output));
        let mut after_jobs = match (after, finished) {
            (Some(after), Some(finished)) => after.jobs(
                device,
                &AfterFrame {
                    size,
                    finished: &finished,
                    guarded: &framed,
                    slot,
                },
            ),
            _ => Vec::new(),
        };
        // The guard first; the status colors after the upscale and the outlines.
        let colors_at = after_jobs
            .iter()
            .position(|(n, _)| n == status::COLORS_PASS)
            .unwrap_or(after_jobs.len());
        let colors = after_jobs.split_off(colors_at);
        jobs.extend(after_jobs);
        if let Some(low) = low_view {
            let early = self.outline_draw(true);
            let [upscale, sharpen] = self.surface_steps(device, slot).expect("below scale 1");
            let profiler = self.profiler.clone();
            jobs.push((
                UPSCALE_PASS.into(),
                Box::new(move |encoder| {
                    // The planted programs draw their outlines into the internal frame.
                    if let Some(early) = &early {
                        early.record(encoder, &low, None);
                    }
                    timed(&profiler, UPSCALE_PASS, encoder, |e, ts| {
                        upscale.record(e, ts)
                    })
                }),
            ));
            let profiler = self.profiler.clone();
            jobs.push((
                SHARPEN_PASS.into(),
                Box::new(move |encoder| {
                    timed(&profiler, SHARPEN_PASS, encoder, |e, ts| {
                        sharpen.record(e, ts)
                    })
                }),
            ));
        }
        // Status outlines draw as the status colors, where the frame has them, over the labels.
        let (outlines, statuses) = match self.outline_draw(false) {
            Some(draw) if !colors.is_empty() => {
                let (draw, statuses) = draw.split();
                (Some(draw), statuses)
            }
            draw => (draw, None),
        };
        for (name, draw) in [(OUTLINE_PASS, outlines), (LABEL_PASS, self.label_draw())] {
            let Some(draw) = draw else { continue };
            let (profiler, target) = (self.profiler.clone(), slot.clone());
            jobs.push((
                name.into(),
                Box::new(move |encoder| {
                    timed(&profiler, name, encoder, |e, ts| {
                        draw.record(e, &target, ts)
                    })
                }),
            ));
        }
        if let Some(statuses) = statuses {
            let (profiler, slot) = (self.profiler.clone(), slot.clone());
            jobs.push((
                status::COLORS_PASS.into(),
                Box::new(move |encoder| {
                    timed(&profiler, status::COLORS_PASS, encoder, |e, ts| {
                        statuses.record(e, &slot, ts)
                    })
                }),
            ));
        }
        jobs.extend(colors);
        jobs
    }

    /// Makes or remakes the targets below scale 1 when the surface needs them: whether the
    /// frame draws through the upscale.
    fn ensure_low(&mut self, device: &Device) -> bool {
        let internal = self.internal();
        let Some(up) = self.upscale.as_ref().filter(|_| internal != self.size) else {
            self.low = None;
            return false;
        };
        if self
            .low
            .as_ref()
            .is_none_or(|l| l.internal != internal || l.size != self.size)
        {
            let (low, bytes) = deep_gpu::alloc::outside(|| {
                deep_gpu::memory::across(device, || Low::new(device, up, internal, self.size))
            });
            self.low = Some(low);
            self.low_bytes = bytes;
        }
        true
    }

    /// Below scale 1, the upscale's two passes into `slot`, ready to record; `None` at scale 1.
    pub fn surface_steps(
        &mut self,
        device: &Device,
        slot: &wgpu::TextureView,
    ) -> Option<[surface::Step; 2]> {
        if !self.ensure_low(device) {
            return None;
        }
        let up = self.upscale.clone()?;
        let low = self.low.as_mut()?;
        low.hold(device, self.surface.sharpen);
        let planted = self.planted.upscale;
        Some(
            [UPSCALE_PASS, SHARPEN_PASS]
                .map(|name| low.step(&up, &self.surface, planted, name, slot)),
        )
    }

    /// The internal frame the output (and the guard) write below scale 1.
    pub fn low_view(&mut self, device: &Device) -> Option<wgpu::TextureView> {
        self.ensure_low(device)
            .then(|| self.low.as_ref().map(|l| l.view.clone()))
            .flatten()
    }

    /// The outline pass: the solids' strokes, the status outlines and, below scale 1, the
    /// layers' lines 1 device px or thinner, at full size; with `early`, what the planted
    /// programs draw into the internal frame instead. `None` with nothing to draw.
    pub fn outline_draw(&self, early: bool) -> Option<OutlineDraw> {
        let o = &self.outlines;
        let t = self.targets.as_ref()?;
        let binds = o.binds.as_ref()?;
        let below = self.internal() != self.size && self.upscale.is_some();
        let p = self.planted;
        let strokes_early = below && p.outlines_before_upscale;
        let statuses_early = below && p.status_before_upscale;
        let mut sets = Vec::new();
        let mut statuses = Vec::new();
        let take = |set: &Set, into: &mut Vec<(wgpu::Buffer, u32)>| {
            if let (Some(b), true) = (&set.buffer, set.len() > 0) {
                into.push((b.clone(), set.len()));
            }
        };
        if early {
            if strokes_early {
                take(&o.strokes, &mut sets);
            }
            if statuses_early {
                take(&o.statuses, &mut sets);
            }
        } else {
            if !strokes_early {
                take(&o.strokes, &mut sets);
            }
            if below {
                for id in &self.order {
                    if let Some(batch) = self.batches.get(id) {
                        take(&batch.lines, &mut sets);
                    }
                }
            }
            if !statuses_early {
                take(&o.statuses, &mut statuses);
            }
        }
        if sets.is_empty() && statuses.is_empty() {
            return None;
        }
        Some(OutlineDraw {
            pipeline: self.outlines.pipeline.clone(),
            output: t.output_bind.clone(),
            frame: binds[usize::from(early)].clone(),
            atlas: None,
            sets,
            statuses,
        })
    }

    /// The label pass: every layer's screen-size labels at full size, after the upscale (#1174);
    /// `None` with no labels, or when the planted program drew them in the geometry pass.
    pub fn label_draw(&self) -> Option<OutlineDraw> {
        if self.planted.labels_before_upscale {
            return None;
        }
        let t = self.targets.as_ref()?;
        let binds = self.outlines.binds.as_ref()?;
        let sets: Vec<(wgpu::Buffer, u32)> = self
            .order
            .iter()
            .filter_map(|id| {
                let set = &self.batches.get(id)?.labels;
                Some((set.buffer.clone()?, set.len())).filter(|(_, n)| *n > 0)
            })
            .collect();
        if sets.is_empty() {
            return None;
        }
        Some(OutlineDraw {
            pipeline: self.outlines.labels.clone(),
            output: t.output_bind.clone(),
            frame: binds[0].clone(),
            atlas: Some(self.atlas.bind.clone()),
            sets,
            statuses: Vec::new(),
        })
    }

    /// The finished frame's view at `size`, made or remade when the size changed.
    /// #464: the print pass for this frame, when the look prints anything: the frame the output
    /// writes for it at `size`, in the format the output would have written.
    fn print_stage(
        &mut self,
        device: &Device,
        size: [u32; 2],
        finished: bool,
    ) -> Option<PrintStage> {
        let (print, frame, ground) = self.print.clone()?;
        let format = if finished { status::FINISHED } else { FORMAT };
        if self
            .print_source
            .as_ref()
            .is_none_or(|(_, s, f)| *s != size || *f != format)
        {
            let texture = deep_gpu::alloc::outside(|| {
                texture2d(
                    &device.device,
                    "scene3d print source",
                    size,
                    format,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                )
            });
            self.print_source = Some((texture.create_view(&Default::default()), size, format));
        }
        let printer = self
            .printer
            .get_or_insert_with(|| Arc::new(Mutex::new(print::Printer::new(&device.device))))
            .clone();
        // Each object ID's separations: the bits of those whose ink is its surface's role color.
        let top = self.picks.values().copied().max().unwrap_or(0) as usize;
        let mut masks = vec![0u32; top + 1];
        for (id, pick) in &self.picks {
            if let Some(c) = self.print_colors.get(id) {
                for (k, sep) in print.separations.iter().enumerate() {
                    if sep.color == *c {
                        masks[*pick as usize] |= 1 << k;
                    }
                }
            }
        }
        let params = print::params(
            &print,
            &frame,
            size,
            print::Placed::default(),
            ground,
            true,
            print::Planted::default(),
        );
        Some(PrintStage {
            device: device.device.clone(),
            printer,
            params,
            source: self.print_source.as_ref().expect("made above").0.clone(),
            ids: self.targets.as_ref()?.ids_view.clone(),
            masks,
            format,
        })
    }

    fn finished(&mut self, device: &Device, size: [u32; 2]) -> wgpu::TextureView {
        if self.finished.as_ref().is_none_or(|(_, _, s)| *s != size) {
            let texture = deep_gpu::alloc::outside(|| {
                texture2d(
                    &device.device,
                    "scene3d finished",
                    size,
                    status::FINISHED,
                    wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                )
            });
            let view = texture.create_view(&Default::default());
            self.finished = Some((texture, view, size));
        }
        self.finished.as_ref().expect("made above").1.clone()
    }

    /// The last frame's depth target and, when one was drawn, the key light's shadow map, as
    /// passes between geometry and output read them.
    pub fn depth_and_shadow(&self) -> Option<(&wgpu::Texture, Option<&wgpu::Texture>)> {
        let t = self.targets.as_ref()?;
        Some((
            t.depth_view.texture(),
            self.shadow.view.as_ref().map(|v| v.texture()),
        ))
    }

    /// Which of an item's two bands keep each pixel of `pass`'s target, as that pass's draws
    /// evaluate their masks (#425): the item's pick ID `key` and its blend `level`, one byte a
    /// pixel (bit 0 the more detailed band, bit 1 the less), rows top-down, with the target's
    /// size; the shadow pass's at its map's size.
    pub fn mask_dump(
        &self,
        device: &Device,
        pass: MaskPass,
        key: u32,
        level: u32,
    ) -> Option<([u32; 2], Vec<u8>)> {
        let size = match pass {
            MaskPass::Shadow => [self.cascaded.size; 2],
            _ => self.internal(),
        };
        let d = &device.device;
        let scene = shader(&self.planted);
        let start = scene.find("// Issue #425: a band's mask")?;
        let end = scene.find("// End of #425's band masks.")?;
        let source = format!("{}\n{MASK_DUMP}", &scene[start..end]);
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d mask dump"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d mask dump"),
            entries: &[buffer_entry(
                0,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            )],
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d mask dump"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let format = wgpu::TextureFormat::R8Uint;
        let pipe = pipeline(
            d,
            "scene3d mask dump",
            Some(&pl),
            &module,
            ("dump_vs", &[]),
            Some(("dump_fs", &[target(format, None)])),
            None,
        );
        let uniform = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d mask dump"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let code = mask_code(Some(deep_canvas_scene3d::lod::Mask {
            level,
            lower: false,
        }));
        device
            .queue
            .write_buffer(&uniform, 0, bytemuck::cast_slice(&[key, code, 0, 0]));
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d mask dump"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let texture = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d mask dump"),
            size: extent(size),
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        {
            let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d mask dump"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            rp.set_pipeline(&pipe);
            rp.set_bind_group(0, &bind, &[]);
            rp.draw(0..3, 0..1);
        }
        device.queue.submit([encoder.finish()]);
        Some((size, read_texture(device, &texture, size, 1)?))
    }

    /// The last frame's camera (world to clip, column-major; the eye; the near plane) and its
    /// light clip matrix.
    pub fn camera(&self) -> (Camera, Option<[f64; 16]>) {
        (self.camera, self.shadow.clip)
    }

    fn clear_depth(&self) -> f64 {
        if self.planted.forward_z {
            1.0
        } else {
            0.0
        }
    }

    /// The geometry pass recorded into `encoder` on the calling thread (the live path, issue
    /// #379), with its timestamp writes when given.
    pub fn record_geometry(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        for run in std::mem::take(&mut self.cull_runs) {
            run.record(encoder);
        }
        let Some(t) = self.targets.as_ref() else {
            return;
        };
        for (_, job) in self.cascade_jobs() {
            job(encoder);
        }
        if let Some(ao) = self.ao_frame() {
            ao.record(&None, encoder);
        }
        let bundles = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id)?.bundle.as_ref());
        geometry_pass(
            encoder,
            &t.drawn,
            self.ground,
            self.clear_depth(),
            self.sky_draw().as_ref(),
            bundles,
            self.puff_draw().as_ref(),
            timestamps,
        );
        if let Some(core) = self.core_draws() {
            core.record(encoder);
        }
    }

    /// The puffs' draw this frame, when it has any (#422).
    fn puff_draw(&self) -> Option<PuffDraw> {
        let (buffer, count) = self.puffs.clone().filter(|p| p.1 > 0)?;
        let p = self.puff_pipeline.clone()?;
        Some((
            p,
            [
                self.frame_bind.clone(),
                self.lights_bind.clone(),
                self.ao.shade().clone(),
                // The solids' layout holds the maps' group 3 since #423.
                self.maps.by_index(0).clone(),
            ],
            buffer,
            count,
        ))
    }

    /// Every puff's record, sorted back to front from this frame's eye, then by ID.
    fn prepare_puffs(&mut self, device: &Device, scene: &Scene) {
        let eye = scene.camera.eye;
        let mut all: Vec<&deep_canvas_scene3d::scene::Puff> =
            scene.layers.iter().flat_map(|l| &l.puffs).collect();
        if all.is_empty() || self.planted.drops_clouds {
            self.puffs = None;
            return;
        }
        let d2 = |p: &deep_canvas_scene3d::scene::Puff| {
            (0..3).map(|i| (p.pos[i] - eye[i]).powi(2)).sum::<f64>()
        };
        all.sort_by(|a, b| d2(b).total_cmp(&d2(a)).then_with(|| a.id.cmp(&b.id)));
        let records: Vec<PuffRecord> = all
            .iter()
            .map(|p| PuffRecord {
                center: v4(p.pos, p.radius),
                shape: [
                    p.aspect as f32,
                    p.density as f32,
                    p.bright as f32,
                    (p.seed % 65_536) as f32,
                ],
                light: [
                    p.phase as f32,
                    p.shade as f32,
                    p.near_fade as f32,
                    (u32::from(p.sun) | u32::from(p.ambient) << 1) as f32,
                ],
            })
            .collect();
        let buffer = wgpu::util::DeviceExt::create_buffer_init(
            &device.device,
            &wgpu::util::BufferInitDescriptor {
                label: Some("scene3d puffs"),
                contents: bytemuck::cast_slice(&records),
                usage: wgpu::BufferUsages::VERTEX,
            },
        );
        if self.puff_pipeline.is_none() {
            let blend = wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING;
            let targets = [
                target(LINEAR, Some(blend)),
                Some(wgpu::ColorTargetState {
                    format: IDS_MS,
                    blend: None,
                    write_mask: wgpu::ColorWrites::empty(),
                }),
            ];
            let layout = [Some(wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<PuffRecord>() as u64,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes: &PUFF,
            })];
            self.puff_pipeline = Some(culled(
                &device.device,
                self.families.samples,
                PUFF_PASS,
                Some(&self.solid_layout),
                &self.scene_module,
                ("puff_vs", &layout),
                Some(("puff_fs", &targets)),
                Some(wgpu::DepthStencilState {
                    format: DEPTH,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(if self.planted.forward_z {
                        wgpu::CompareFunction::Less
                    } else {
                        wgpu::CompareFunction::GreaterEqual
                    }),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                None,
            ));
            self.compiled += 1;
            self.names.push(PUFF_PASS);
        }
        self.puffs = Some((buffer, records.len() as u32));
    }

    /// The sky's draw this frame, when it has one (#422).
    fn sky_draw(&self) -> Option<SkyDraw> {
        let p = self.sky_pipeline.clone().filter(|_| self.sky)?;
        Some((
            p,
            [
                self.frame_bind.clone(),
                self.lights_bind.clone(),
                self.ao.shade().clone(),
                // The solids' layout holds the maps' group 3 since #423.
                self.maps.by_index(0).clone(),
            ],
        ))
    }

    /// The output pass, tone-mapping the linear target into `target`.
    pub fn record_output(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        if let Some(t) = self.targets.as_ref() {
            full_pass(
                encoder,
                OUTPUT_PASS,
                target,
                wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                &self.output_pipeline,
                &t.output_bind,
                timestamps,
            );
        }
    }

    /// The linear target the geometry pass draws, for passes between it and the output.
    pub fn linear(&self) -> Option<(&wgpu::Texture, &wgpu::TextureView)> {
        self.targets.as_ref().map(|t| (&t.linear, &t.linear_view))
    }

    /// The linear image the frame's output pass read (after the effects and bloom, before
    /// exposure) as little-endian f32 RGBA, rows top-down (#418).
    pub fn read_pre_tone(&self, device: &Device) -> Option<Vec<u8>> {
        let t = self.targets.as_ref()?;
        let texture = self.pre_tone.as_ref().map_or(&t.linear, |v| v.texture());
        let half = read_texture(device, texture, t.size, 8)?;
        Some(
            half.as_chunks::<2>()
                .0
                .iter()
                .flat_map(|h| f16_to_f32(u16::from_le_bytes(*h)).to_le_bytes())
                .collect(),
        )
    }

    /// The frame's linear target as little-endian f32 RGBA and its object-ID target as each
    /// pixel's u32 in little-endian bytes, rows top-down; `None` on a backend with no pixels.
    pub fn read_targets(&self, device: &Device) -> Option<(Vec<u8>, Vec<u8>)> {
        let t = self.targets.as_ref()?;
        let linear = read_texture(device, &t.linear, t.size, 8)?;
        let ids = read_texture(device, &t.ids, t.size, 4)?;
        let floats: Vec<u8> = linear
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|h| f16_to_f32(u16::from_le_bytes(*h)).to_le_bytes())
            .collect();
        Some((floats, ids))
    }

    /// The depth target, f32 per pixel (reversed Z: larger is nearer), which a 3D pick's ties
    /// read (#424).
    pub fn read_depth(&self, device: &Device) -> Option<Vec<u8>> {
        let t = self.targets.as_ref()?;
        read_texture(device, t.depth_view.texture(), t.size, 4)
    }

    /// #166: view3d's `reflection` target, f32 RGBA, rows top-down: each mirror part's lookup.
    pub fn read_reflection(&self, device: &Device) -> Option<Vec<u8>> {
        let r = self.reflection.as_ref()?;
        read_texture(device, &r.0, r.2, 16)
    }

    /// #166: view3d's `depth` target, f32 a pixel, rows top-down: at each pixel's centre, the
    /// distance in m along the view axis from the eye to what the depth target holds there;
    /// infinite where nothing is drawn.
    pub fn read_view_depth(&self, device: &Device) -> Option<Vec<u8>> {
        let t = self.targets.as_ref()?;
        let raw = read_texture(device, t.depth_view.texture(), t.size, 4)?;
        let unclip = water::inverse(&self.camera.0);
        let (eye, forward) = (self.camera.1, self.forward);
        let empty = self.clear_depth() as f32;
        let [w, h] = t.size.map(f64::from);
        let mut out = Vec::with_capacity(raw.len());
        for (k, z) in raw.chunks_exact(4).enumerate() {
            let z = f32::from_le_bytes([z[0], z[1], z[2], z[3]]);
            let d = if z == empty {
                f32::INFINITY
            } else {
                let (i, j) = (
                    (k % t.size[0] as usize) as f64,
                    (k / t.size[0] as usize) as f64,
                );
                let ndc = [
                    (i + 0.5) / w * 2.0 - 1.0,
                    1.0 - (j + 0.5) / h * 2.0,
                    f64::from(z),
                    1.0,
                ];
                let p: [f64; 4] =
                    std::array::from_fn(|r| (0..4).map(|c| unclip[c * 4 + r] * ndc[c]).sum());
                (0..3)
                    .map(|a| (p[a] / p[3] - eye[a]) * forward[a])
                    .sum::<f64>() as f32
            };
            out.extend(d.to_le_bytes());
        }
        Some(out)
    }

    /// Whether depth reads nearer as it grows: reversed Z, unless the planted forward Z.
    pub fn depth_grows_nearer(&self) -> bool {
        !self.planted.forward_z
    }
}

/// The look's tone map alone (#418's `tone` call), as the output pass runs it, over `input` (f32
/// RGBA, rows top-down, `size` px) on `device`, with no exposure and no encode; the output in the
/// same layout, or `None` on a backend with no pixels.
pub fn tone(
    device: &Device,
    map: ToneMap,
    grade: &deep_canvas_marks::finish::Grade,
    input: &[f32],
    size: [u32; 2],
) -> Option<Vec<u8>> {
    let d = &device.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("scene3d tone"),
        source: wgpu::ShaderSource::Wgsl(OUTPUT.into()),
    });
    let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene3d tone"),
        entries: &[
            texture_entry(),
            buffer_entry(
                1,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            ),
        ],
    });
    let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("scene3d tone"),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let format = wgpu::TextureFormat::Rgba32Float;
    let pipe = pipeline(
        d,
        "scene3d.tone",
        Some(&pipeline_layout),
        &module,
        ("out_vs", &[]),
        Some(("tone_fs", &[target(format, None)])),
        None,
    );
    let source = texture2d(
        d,
        "scene3d tone input",
        size,
        format,
        wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
    );
    let bytes: Vec<u8> = input.iter().flat_map(|v| v.to_le_bytes()).collect();
    write_texture(&device.queue, &source, 0, &bytes, size[0] * 16, size);
    let out = texture2d(
        d,
        "scene3d tone output",
        size,
        format,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    let (code, white, contrast) = match map {
        ToneMap::Agx { white, contrast } => (2, white, contrast),
        other => (other.code(), 16.29, 1.25),
    };
    // #464: the grade inside the pass, as the output runs it: the white balance before the curve
    // and the CDL after it.
    let uniform = ToneUniform {
        exposure: 1.0,
        map: code,
        white: white as f32,
        contrast: contrast as f32,
        encode: 0,
        deband: 0.0,
        saturation: grade.saturation as f32,
        graded: u32::from(!grade.is_identity()),
        wb: grade
            .white_balance()
            .map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, 0.0]),
        slope: rgb4(grade.slope),
        offset: rgb4(grade.offset),
        power: rgb4(grade.power),
    };
    let buffer = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d tone"),
        size: std::mem::size_of::<ToneUniform>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    device
        .queue
        .write_buffer(&buffer, 0, bytemuck::bytes_of(&uniform));
    let view = source.create_view(&Default::default());
    let bind = bind_group(
        d,
        "scene3d tone",
        &layout,
        [
            wgpu::BindingResource::TextureView(&view),
            buffer.as_entire_binding(),
        ],
    );
    let mut encoder = d.create_command_encoder(&Default::default());
    full_pass(
        &mut encoder,
        "scene3d.tone",
        &out.create_view(&Default::default()),
        wgpu::LoadOp::Clear(wgpu::Color::BLACK),
        &pipe,
        &bind,
        None,
    );
    device.queue.submit([encoder.finish()]);
    read_texture(device, &out, size, 16)
}

/// An IEEE 754 half as the f32 it is exactly.
fn f16_to_f32(h: u16) -> f32 {
    let sign = u32::from(h >> 15) << 31;
    let exp = u32::from((h >> 10) & 0x1f);
    let frac = u32::from(h & 0x3ff);
    let bits = match (exp, frac) {
        (0, 0) => sign,
        (0, f) => {
            // Subnormal: normalize.
            let mut e = 127 - 15 + 1;
            let mut f = f;
            while f & 0x400 == 0 {
                f <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((f & 0x3ff) << 13)
        }
        (31, 0) => sign | 0x7f80_0000,
        (31, f) => sign | 0x7f80_0000 | (f << 13),
        (e, f) => sign | ((e + 127 - 15) << 23) | (f << 13),
    };
    f32::from_bits(bits)
}

/// A texture's bytes, `texel` bytes a pixel, rows top-down with no padding.
pub(crate) fn read_texture(
    device: &Device,
    texture: &wgpu::Texture,
    size: [u32; 2],
    texel: u32,
) -> Option<Vec<u8>> {
    read_level(device, texture, 0, size, texel)
}

/// Mip `level` of `texture`, `size` at that level, read back as tightly packed rows.
pub(crate) fn read_level(
    device: &Device,
    texture: &wgpu::Texture,
    level: u32,
    size: [u32; 2],
    texel: u32,
) -> Option<Vec<u8>> {
    let row = size[0] * texel;
    let padded =
        row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let bytes = u64::from(padded) * u64::from(size[1]);
    let data = read_back(device, "scene3d read back", bytes, |encoder, staging| {
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: level,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: staging,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(size[1]),
                },
            },
            extent(size),
        );
    })?;
    let mut out = Vec::with_capacity((row * size[1]) as usize);
    for y in 0..size[1] as usize {
        let start = y * padded as usize;
        out.extend_from_slice(&data[start..start + row as usize]);
    }
    Some(out)
}

/// The sky's draw: its pipeline and the solids' four bind groups.
type SkyDraw = (wgpu::RenderPipeline, [wgpu::BindGroup; 4]);
/// The puffs' draw: their pipeline, the solids' bind groups, and their instances back to front.
type PuffDraw = (
    wgpu::RenderPipeline,
    [wgpu::BindGroup; 4],
    wgpu::Buffer,
    u32,
);

/// A puff's instance record (scene3d.wgsl's `puff_vs`).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PuffRecord {
    center: [f32; 4],
    shape: [f32; 4],
    light: [f32; 4],
}

const PUFF: [wgpu::VertexAttribute; 3] =
    wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4];

/// The geometry pass into `drawn`'s multisampled targets, then the pass resolving their object
/// IDs and depth (#1173); `timestamps` time the first, since Metal fails a pass's timestamps split
/// over two passes.
/// The geometry pass's object IDs and depth resolved into the targets everything after it reads
/// (#1173); #166's water runs it again once its parts are in.
fn resolve_ids(
    encoder: &mut wgpu::CommandEncoder,
    drawn: &Drawn,
    clear_depth: f64,
    rect: Option<[u32; 4]>,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(RESOLVE_PASS),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: &drawn.ids,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations {
                load: match rect {
                    Some(_) => wgpu::LoadOp::Load,
                    None => wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                },
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: &drawn.depth,
            depth_ops: Some(wgpu::Operations {
                load: match rect {
                    Some(_) => wgpu::LoadOp::Load,
                    None => wgpu::LoadOp::Clear(clear_depth as f32),
                },
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        timestamp_writes: timestamps,
        ..Default::default()
    });
    // Again inside a rectangle (#166's water): what lies outside it is as the first resolve left
    // it.
    if let Some([x, y, w, h]) = rect {
        pass.set_scissor_rect(x, y, w, h);
    }
    pass.set_pipeline(&drawn.resolve.0);
    pass.set_bind_group(0, &drawn.resolve.1, &[]);
    pass.draw(0..3, 0..1);
}

#[allow(clippy::too_many_arguments)]
fn geometry_pass<'a>(
    encoder: &mut wgpu::CommandEncoder,
    drawn: &Drawn,
    [r, g, b, a]: [f64; 4],
    clear_depth: f64,
    sky: Option<&SkyDraw>,
    bundles: impl Iterator<Item = &'a wgpu::RenderBundle>,
    puffs: Option<&PuffDraw>,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    let (color, resolve_target) = &drawn.color;
    // A resolved color is all that's kept of the multisampled one.
    let color_store = match resolve_target {
        Some(_) => wgpu::StoreOp::Discard,
        None => wgpu::StoreOp::Store,
    };
    deep_gpu::alloc::outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(GEOMETRY_PASS),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: color,
                    resolve_target: resolve_target.as_ref(),
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                        store: color_store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &drawn.ids_ms,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &drawn.depth_ms,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_depth as f32),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: timestamps,
            ..Default::default()
        });
        // The sky first, behind everything (#422).
        if let Some((pipeline, binds)) = sky {
            pass.set_pipeline(pipeline);
            for (i, b) in binds.iter().enumerate() {
                pass.set_bind_group(i as u32, b, &[]);
            }
            pass.draw(0..3, 0..1);
        }
        pass.execute_bundles(bundles);
        // The puffs last, back to front over everything they're in front of (#422).
        if let Some((pipeline, binds, buffer, count)) = puffs {
            pass.set_pipeline(pipeline);
            for (i, b) in binds.iter().enumerate() {
                pass.set_bind_group(i as u32, b, &[]);
            }
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..6, 0..*count);
        }
        drop(pass);
        resolve_ids(encoder, drawn, clear_depth, None, None);
        if let Some((pipeline, bind, previous, drew)) = &drawn.accumulates {
            let linear = drawn.color.1.as_ref().unwrap_or(&drawn.color.0);
            if drew.swap(true, Ordering::SeqCst) {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(RESOLVE_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: linear,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, bind, &[]);
                pass.set_blend_constant(wgpu::Color {
                    r: 0.5,
                    g: 0.5,
                    b: 0.5,
                    a: 0.5,
                });
                pass.draw(0..3, 0..1);
            }
            encoder.copy_texture_to_texture(
                linear.texture().as_image_copy(),
                previous.as_image_copy(),
                previous.size(),
            );
        }
    });
}

/// The per-pixel items' fragments into their lists (#424), after the resolve (#1173).
#[allow(clippy::type_complexity)]
fn per_pixel_pass(
    encoder: &mut wgpu::CommandEncoder,
    [linear, ids, depth]: [&wgpu::TextureView; 3],
    pipeline: &wgpu::RenderPipeline,
    binds: &[wgpu::BindGroup; 4],
    draws: &[(
        wgpu::Buffer,
        wgpu::Buffer,
        u32,
        wgpu::Buffer,
        u32,
        wgpu::BindGroup,
    )],
) {
    let load = wgpu::Operations {
        load: wgpu::LoadOp::Load,
        store: wgpu::StoreOp::Store,
    };
    let attach = |view| {
        Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: load,
        })
    };
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("scene3d.per_pixel"),
        color_attachments: &[attach(linear), attach(ids)],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: depth,
            depth_ops: Some(wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        ..Default::default()
    });
    for (i, b) in binds.iter().take(3).enumerate() {
        pass.set_bind_group(i as u32, b, &[]);
    }
    pass.set_pipeline(pipeline);
    for (vertices, indices, count, instances, k, maps) in draws {
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
}

/// The transmissive parts' pass (#428): each drawn over the targets the geometry pass wrote,
/// reading the opaque scene's copy.
#[allow(clippy::type_complexity)]
/// A frame's draws of the core targets it reads (#431), each into its own view.
struct CoreDraws {
    velocity: Option<(motion::TargetFrame, wgpu::TextureView)>,
    emission: Option<(targets::EmissionFrame, wgpu::TextureView)>,
    depth: wgpu::TextureView,
}

impl CoreDraws {
    fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        if let Some((f, view)) = &self.velocity {
            f.record(encoder, view, &self.depth);
        }
        if let Some((f, view)) = &self.emission {
            f.record(encoder, view, &self.depth);
        }
    }
}

/// A scene's evaluations with nothing moving: every solid and the camera where they are at t.
fn still_motion(scene: &Scene) -> deep_canvas_scene3d::scene::Motion {
    deep_canvas_scene3d::scene::Motion {
        open: scene.camera.clone(),
        close: scene.camera.clone(),
        solids: scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .map(|s| {
                (
                    s.id.clone(),
                    deep_canvas_scene3d::scene::MotionSolid {
                        open: s.model,
                        close: s.model,
                        meshes: None,
                    },
                )
            })
            .collect(),
        taps: 2,
        max_px: f64::MAX,
        tile_px: 1,
    }
}

fn glass_pass(
    encoder: &mut wgpu::CommandEncoder,
    [linear, ids, depth]: [&wgpu::TextureView; 3],
    pipeline: Option<&wgpu::RenderPipeline>,
    binds: &[wgpu::BindGroup; 3],
    draws: &[(
        wgpu::Buffer,
        wgpu::Buffer,
        u32,
        wgpu::Buffer,
        u32,
        wgpu::BindGroup,
    )],
    late: &[LateDraw],
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    let load = wgpu::Operations {
        load: wgpu::LoadOp::Load,
        store: wgpu::StoreOp::Store,
    };
    let color = |view| {
        Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: load,
        })
    };
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(glass::PASS),
        color_attachments: &[color(linear), color(ids)],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: depth,
            depth_ops: Some(wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        timestamp_writes: timestamps,
        ..Default::default()
    });
    for (i, b) in binds.iter().enumerate() {
        pass.set_bind_group(i as u32, b, &[]);
    }
    if let Some(pipeline) = pipeline {
        pass.set_pipeline(pipeline);
    }
    for (vertices, indices, count, instances, k, maps) in
        draws.iter().filter(|_| pipeline.is_some())
    {
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
    // Blend and add parts, back to front, over the glass (#428).
    for (pipeline, (vertices, indices, count, instances, k, maps)) in late {
        pass.set_pipeline(pipeline);
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
}

/// One full-screen triangle into `target` with `pipeline` and its bind group.
pub(crate) fn full_pass(
    encoder: &mut wgpu::CommandEncoder,
    label: &'static str,
    target: &wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
    pipeline: &wgpu::RenderPipeline,
    bind: &wgpu::BindGroup,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    deep_gpu::alloc::outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: timestamps,
            ..Default::default()
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..3, 0..1);
    });
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
            s.renderer = Some(Renderer::new(device, planted));
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
            s.renderer = Some(Renderer::new(device, s.planted));
        }
        let Shared {
            renderer,
            post,
            after,
            ..
        } = &mut *s;
        let Some(renderer) = renderer.as_mut() else {
            return Vec::new();
        };
        // The instances outputs the frame's instancers draw from (#484).
        if let Some(p) = post.as_deref_mut() {
            renderer.feed(p.sources(device));
        }
        renderer.prepare(device, &scene, &look);
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
            // Ambient occlusion (#418), drawn only while the look has it on: its cost counts the
            // depth and normal prepass with the occlusion and the blur.
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
            // Ambient occlusion (#418), drawn only while the look has it on: its cost counts the
            // depth and normal prepass with the occlusion and the blur.
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

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_scene3d::frames::Frames;
    use deep_canvas_scene3d::scene::Labels;
    use deep_gpu::device::{Backend, Gpu};
    use serde_json::json;

    /// Records by shape, in each batch.
    fn records(r: &Renderer) -> Vec<(String, Shape, Vec<u8>)> {
        let mut out = Vec::new();
        for (id, b) in &r.batches {
            for ((shape, ..), set) in &b.solids {
                out.push((id.clone(), *shape, set.records.clone()));
            }
        }
        out
    }

    #[test]
    fn a_frame_that_writes_what_moved_leaves_the_records_a_whole_prepare_writes() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let look =
            Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
        let boxes = |id: &str, order: &str, pos: [f64; 3]| json!({"id": id, "kind": "mark.box@1", "name": id, "order": order, "layer": "main", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": pos}});
        // Boxes in one layer; `b` slides, `c` rides it, `a` and `d` stay.
        let mut items = serde_json::Map::new();
        items.insert("cam".into(), json!({"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 14}, "fov": 40}}));
        for (id, order, pos) in [
            ("a", "b0", [-3.0, 0.5, 0.0]),
            ("b", "b1", [0.0, 0.5, 0.0]),
            ("c", "b2", [0.0, 1.0, 0.0]),
            ("d", "b3", [3.0, 0.5, 0.0]),
        ] {
            items.insert(id.into(), boxes(id, order, pos));
        }
        items["c"]["parent"] = json!("b");
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
            "transport": {"span": "60s"}, "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": items,
            "channels": {
                "slide": {"target": "items/b/at/pos/0", "type": "f32", "keys": {"k0": {"t": "0s", "value": -3, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}},
                "orbit": {"target": "items/cam/params/orbit/azimuth", "type": "f32", "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "60s", "value": 90, "interp": "linear"}}}
            }
        });
        let mut labels = Labels::new();
        let mut frames = Frames::new(&doc, &look, &mut labels).unwrap();
        let moved = frames
            .moved()
            .expect("transforms and the orbit stay on the fast path")
            .to_vec();
        assert_eq!(moved.len(), 2, "the sliding box and its child: {moved:?}");
        let mut playing = Renderer::new(&device, Planted::default());
        frames
            .at(0, [128, 96], &Default::default(), &mut labels)
            .unwrap();
        playing.prepare(&device, frames.scene(), &look);
        for n in [1i64, 17, 600] {
            frames
                .at(
                    n * 705_600_000 / 60,
                    [128, 96],
                    &Default::default(),
                    &mut labels,
                )
                .unwrap();
            playing.prepare_moved(&device, frames.scene(), &look, &moved);
            assert_eq!(
                playing.counts().instances_written,
                2,
                "frame {n}: the two moved records alone"
            );
            let mut whole = Renderer::new(&device, Planted::default());
            whole.prepare(&device, frames.scene(), &look);
            assert_eq!(records(&playing), records(&whole), "frame {n}");
        }
    }

    /// Glass (#428) and per-pixel items (#424) draw after the geometry pass resolves (#1173), so
    /// their pipelines take the resolved targets' sample count and ID format, not the geometry
    /// pass's.
    #[test]
    fn glass_blend_and_per_pixel_parts_draw_with_no_validation_error() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let look =
            Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
        let part = |id: &str, order: &str, x: f64, material: &str| json!({"id": id, "kind": "mark.box@1", "name": id, "order": order, "layer": "main", "material": material, "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [x, 0.5, 0.0]}});
        let mut items = serde_json::Map::new();
        items.insert("cam".into(), json!({"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 8}, "fov": 40}}));
        items.insert("glass".into(), json!({"id": "glass", "kind": "material@1", "name": "Glass", "order": "a1", "layer": "main", "params": {"base_color": [1, 1, 1, 1], "metallic": 0, "roughness": 0.2, "transmission": 1, "ior": 1.5}}));
        items.insert("tint".into(), json!({"id": "tint", "kind": "material@1", "name": "Tint", "order": "a2", "layer": "main", "params": {"base_color": [1, 0.5, 0.2, 0.5], "alpha_mode": "blend"}}));
        items.insert("a".into(), part("a", "b0", -0.6, "glass"));
        items.insert("b".into(), part("b", "b1", 0.6, "tint"));
        items.insert("c".into(), part("c", "b2", 0.0, "tint"));
        items["c"]["resolve"] = json!("per_pixel");
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [96, 64], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": items,
        });
        let mut labels = Labels::new();
        let mut frames = Frames::new(&doc, &look, &mut labels).unwrap();
        frames
            .at(0, [96, 64], &Default::default(), &mut labels)
            .unwrap();
        let mut renderer = Renderer::new(&device, Planted::default());
        draw_offscreen(&device, &mut renderer, frames.scene(), &look, None);
        assert!(
            renderer.clear_pipelines[usize::from(GLASS)].is_some(),
            "the glass part is drawn as glass"
        );
        assert!(
            renderer.clear_pipelines[usize::from(PER_PIXEL)].is_some(),
            "the per-pixel part is drawn per pixel"
        );
        let raised = device.take_raised();
        assert!(raised.is_empty(), "the device raised: {raised:?}");
    }
}
