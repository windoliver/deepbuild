//! scene3d's render module (issue #378): see the crate manifest.
//!
//! A frame: the scene's camera and look go into two small uniform buffers; each 3D writer layer's
//! batch writes the instance records that changed and keeps its render bundle while its draw key
//! holds, so a move or a recolor writes one record and encodes nothing, and a presence change (an
//! item added or removed) encodes that batch alone again. The geometry pass clears the linear,
//! object-ID and depth targets and replays every batch's bundle; the output pass reads the linear
//! target and writes the slot.

pub mod ao;
mod mesh;
pub mod shadow;
pub mod status;
pub mod surface;

use std::collections::BTreeMap;
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::label::{half_fraction, AtlasPage, PAGE, PAGES};
use deep_canvas_scene3d::light::{self, AlphaMode, LightKind, SHADED};
use deep_canvas_scene3d::look::{Look3, ToneMap};
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Depth, Facing, Layer3, PointShape, Scene, Shape, Solid};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;

use crate::mesh::Mesh;
use crate::surface::{Low, Surface, Upscale, LABEL_PASS, OUTLINE_PASS, SHARPEN_PASS, UPSCALE_PASS};

/// The 3D writer layers' linear target: what the output pass reads.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// The object-ID target: each pixel the pick ID of the item drawn there, 0 for none.
pub const IDS: wgpu::TextureFormat = wgpu::TextureFormat::R32Uint;
pub const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// The planted forward-Z twin's far plane.
pub const FORWARD_FAR: f64 = 10_000.0;

const SHADER: &str = include_str!("scene3d.wgsl");
const OUTPUT: &str = include_str!("output.wgsl");
const OUTLINE: &str = include_str!("outline.wgsl");
const BUSY: &str = include_str!("busy.wgsl");
const LABEL: &str = include_str!("label.wgsl");
/// The pass that draws the key light's shadow map, in the frame's shadows place.
pub const SHADOW_PASS: &str = "scene3d.shadow";

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Depth cleared to 1, compared less, with a finite far plane at 10 km.
    pub forward_z: bool,
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
    /// #421: opaque solids submitted in an order that turns over each frame, ties left to the
    /// depth test.
    pub ties_by_submission: bool,
    /// #421: a spot's lumens spread over its cone, cd = lm ÷ 2π(1 − cos outer).
    pub spot_counts_cone: bool,
    /// #421: status outlines drawn through the tone map.
    pub status_before_tone_map: bool,
    /// #1174: screen-size labels draw in the geometry pass at the internal size, before the
    /// upscale, as the base drew them.
    pub labels_before_upscale: bool,
}

/// What one frame's preparation did (Render worker; Object; Dirty classes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Counts {
    /// Each batch encoded this frame, with every item it draws.
    pub encoded: Vec<(String, Vec<String>)>,
    /// Batches replayed from an earlier encoding.
    pub replayed: u32,
    pub instances_written: u32,
    pub meshes_built: u32,
    /// The lights the light policy left out of this frame's view, by ID (#421).
    pub lights_left_out: Vec<String>,
    /// The lights asking for a shadow that the shadow budget left without one, by ID (#421).
    pub shadows_dropped: Vec<String>,
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
struct FrameUniform {
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
}

/// scene3d.wgsl's `Lights`: the view, the light count and the lights the policy shades (#421).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LightsUniform {
    view: [f32; 4],
    count: [u32; 4],
    shadow: [[f32; 4]; 4],
    items: [[[f32; 4]; 6]; SHADED],
}

/// Our DFG table (#421): for 32 cosines of the view angle across and 32 roughnesses down, the
/// GGX lobe's directional albedo split as F0·A + F90·B, by Hammersley importance sampling in
/// f64, two entries to a vec4.
fn dfg_table() -> Vec<[f32; 4]> {
    const N: u32 = 512;
    let mut out = vec![[0f32; 4]; 512];
    for j in 0..32u32 {
        let rough = (f64::from(j) + 0.5) / 32.0;
        let a = (rough * rough).max(1e-4);
        let a2 = a * a;
        for i in 0..32u32 {
            let nv = (f64::from(i) + 0.5) / 32.0;
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
    out
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
}

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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SegmentRecord {
    a: [f32; 4],
    b: [f32; 4],
    color: u32,
    pick: u32,
    flags: u32,
    pad: u32,
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
fn solid_record(s: &Solid, pick: u32, tie: u32, winding: bool) -> SolidRecord {
    let m = &s.model;
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let mut flags =
        if s.cast_shadow { 0 } else { NO_CAST } | if s.receive_shadow { 0 } else { NO_RECEIVE };
    let f = |v: [f64; 3], w: f64| [v[0] as f32, v[1] as f32, v[2] as f32, w as f32];
    let (mut base, mut surface, mut specular) = ([0.0; 4], [0.0; 4], [0.0; 4]);
    if let Some(mat) = &s.material {
        let mode = match mat.alpha_mode {
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
    SolidRecord {
        rows: m.map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32]),
        color: pack(s.color),
        pick,
        flags,
        tie,
        emission: v4(s.emission, s.alpha),
        base,
        surface,
        specular,
    }
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

fn extent([width, height]: [u32; 2]) -> wgpu::Extent3d {
    wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    }
}

/// A 2D texture of `size`: one layer, one mip, one sample.
pub(crate) fn texture2d(
    d: &wgpu::Device,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    d.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: extent(size),
        mip_level_count: 1,
        sample_count: 1,
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

/// A render pipeline over `module`: its vertex stage `vs` reading `buffers`, and its fragment
/// stage, when given, into `targets`.
pub(crate) fn pipeline(
    d: &wgpu::Device,
    label: &str,
    layout: Option<&wgpu::PipelineLayout>,
    module: &wgpu::ShaderModule,
    (vs, buffers): (&str, &[Option<wgpu::VertexBufferLayout<'_>>]),
    fragment: Option<(&str, &[Option<wgpu::ColorTargetState>])>,
    depth_stencil: Option<wgpu::DepthStencilState>,
) -> wgpu::RenderPipeline {
    d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout,
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vs),
            compilation_options: Default::default(),
            buffers,
        },
        primitive: Default::default(),
        depth_stencil,
        multisample: Default::default(),
        fragment: fragment.map(|(fs, targets)| wgpu::FragmentState {
            module,
            entry_point: Some(fs),
            compilation_options: Default::default(),
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
}

impl Set {
    fn begin(&mut self) {
        self.next.clear();
        self.count = 0;
        self.new_owners = None;
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
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let buffer = self.buffer.as_ref().expect("allocated above");
            if self.count > 0 {
                deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, 0, &self.next));
            }
            *written += self.count as u32;
            if let Some(owners) = self.new_owners.take() {
                self.owners = owners;
            }
        } else {
            let buffer = self
                .buffer
                .as_ref()
                .expect("a set with members has a buffer");
            for (i, (new, old)) in self
                .next
                .chunks_exact(stride)
                .zip(self.records.chunks_exact(stride))
                .enumerate()
            {
                if new != old {
                    deep_gpu::alloc::outside(|| {
                        device.queue.write_buffer(buffer, (i * stride) as u64, new)
                    });
                    *written += 1;
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
        }
    }

    fn len(&self) -> u32 {
        self.owners.len() as u32
    }
}

/// A 3D writer layer's batch: its instance sets and its encoding.
#[derive(Default)]
struct Batch {
    solids: BTreeMap<Shape, Set>,
    lines: Set,
    points: Set,
    /// One record per inked glyph of its labels.
    labels: Set,
    bundle: Option<wgpu::RenderBundle>,
    /// Each solid's shape, its record's place in that shape's set, its pick ID and its tie
    /// rank, in the layer's solid order.
    solid_slots: Vec<(Shape, u32, u32, u32)>,
    /// The see-through solids' records back to front, and each one's shape and whether it adds
    /// (#421: Object: see-through order).
    clear: Set,
    clear_draws: Vec<(Shape, bool)>,
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
}

/// The key light's shadow map and what draws it.
struct Shadow {
    pipeline: wgpu::RenderPipeline,
    buffer: wgpu::Buffer,
    bind: wgpu::BindGroup,
    view: Option<wgpu::TextureView>,
    /// This frame's light clip matrix, column-major.
    clip: Option<[f64; 16]>,
}

/// A camera as the effects read it: world to clip (column-major), the eye and the near plane.
pub type Camera = ([f64; 16], [f64; 3], f64);

pub struct Renderer {
    planted: Planted,
    epoch: u64,
    frame_buffer: wgpu::Buffer,
    frame_bind: wgpu::BindGroup,
    /// The lights this frame's policy shades and the DFG table, for the solids' shading (#421).
    lights_buffer: wgpu::Buffer,
    lights_bind: wgpu::BindGroup,
    lights_layout: wgpu::BindGroupLayout,
    dfg_buffer: wgpu::Buffer,
    /// Whether the lights' bind group reads the drawn shadow map rather than its one-texel
    /// stand-in: a new bind group is a new resource in the draw key.
    lights_read_shadow: bool,
    /// Whether this frame holds a shadow catcher, which reads the key light's shadow map.
    catches: bool,
    /// The see-through solids' pipelines, blend and add, each compiled the first time a batch
    /// draws one.
    solid_layout: wgpu::PipelineLayout,
    clear_pipelines: [Option<wgpu::RenderPipeline>; 2],
    /// Each solid's rank by ID; and which way the planted ties_by_submission submits this frame.
    ties: BTreeMap<String, u32>,
    flip: bool,
    tone_buffer: wgpu::Buffer,
    output_layout: wgpu::BindGroupLayout,
    /// What the passes after the finish cover this frame (their layer, which the view holds), as
    /// the output pass's undithered mask; one clear texel with none (#418).
    covered: (Option<std::sync::Arc<[u8]>>, wgpu::TextureView),
    mesh_pipeline: wgpu::RenderPipeline,
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
    /// Render pipelines this renderer compiled, so a patch's new ones can be counted (#379).
    compiled: u32,
    /// Each pipeline it compiled, by name, in the order it compiled them (#854).
    names: Vec<&'static str>,
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
    pub profiler: Option<Profiler>,
    /// The GPU surface it draws through, and the upscale's pipelines once compiled (#386).
    pub surface: Surface,
    pub upscale: Option<Arc<Upscale>>,
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
            let side = |p: [f64; 2], r: [f64; 2]| (r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0]);
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

fn shape_code(s: Shape) -> u64 {
    match s {
        Shape::Box => 1,
        Shape::Cylinder => 2,
        Shape::Sphere => 3,
        Shape::Built(h) => 4 | (h << 3),
    }
}

const MESH_VERTEX: [wgpu::VertexAttribute; 2] =
    wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
// Location 8 is the solid's tie rank, which the vertex stage reads (#421).
const SOLID: [wgpu::VertexAttribute; 11] = wgpu::vertex_attr_array![
    2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Uint32, 6 => Uint32, 7 => Uint32,
    8 => Uint32, 9 => Float32x4, 10 => Float32x4, 11 => Float32x4, 12 => Float32x4
];
const SEGMENT: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Uint32, 3 => Uint32, 4 => Uint32
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
            array_stride: 24,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &MESH_VERTEX,
        }),
        Some(instance(std::mem::size_of::<SolidRecord>() as u64, &SOLID)),
    ]
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
/// The lights' bind group: the lights, the DFG table and the shadow map a catcher reads.
fn lights_bind(
    d: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    lights: &wgpu::Buffer,
    dfg: &wgpu::Buffer,
    shadow: &wgpu::TextureView,
) -> wgpu::BindGroup {
    bind_group(
        d,
        "scene3d lights",
        layout,
        [
            lights.as_entire_binding(),
            dfg.as_entire_binding(),
            wgpu::BindingResource::TextureView(shadow),
        ],
    )
}

/// A see-through solid's pipeline: depth-tested with no depth write and no object ID, blending
/// premultiplied over what's behind it, or adding to it.
fn clear_pipeline(
    d: &wgpu::Device,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
    add: bool,
) -> wgpu::RenderPipeline {
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
        target(LINEAR, Some(blend)),
        Some(wgpu::ColorTargetState {
            format: IDS,
            blend: None,
            write_mask: wgpu::ColorWrites::empty(),
        }),
    ];
    let buffers = mesh_buffers();
    let label = if add { "scene3d.add" } else { "scene3d.blend" };
    pipeline(
        d,
        label,
        Some(layout),
        module,
        ("mesh_vs", &buffers),
        Some(("mesh_fs", &targets)),
        Some(depth),
    )
}

fn draw_pipeline(
    d: &wgpu::Device,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
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
        target(IDS, None),
    ];
    pipeline(
        d,
        vs,
        Some(layout),
        module,
        (vs, buffers),
        Some((fs, &targets)),
        Some(depth),
    )
}

/// The line, point and text pipelines, each compiled the first time a batch draws its family, so
/// a patch that adds a family compiles a new pipeline and one that changes only values doesn't.
struct Families {
    module: wgpu::ShaderModule,
    draw_layout: wgpu::PipelineLayout,
    text_layout: wgpu::PipelineLayout,
    forward_z: bool,
    line: Option<wgpu::RenderPipeline>,
    point: Option<wgpu::RenderPipeline>,
    text: Option<wgpu::RenderPipeline>,
}

impl Families {
    /// Compiles the pipelines `layer` draws with that aren't yet, naming each in `names`; how
    /// many it compiled.
    fn ensure(&mut self, d: &wgpu::Device, layer: &Layer3, names: &mut Vec<&'static str>) -> u32 {
        let mut made = 0;
        let (module, draw, text, fz) = (
            &self.module,
            &self.draw_layout,
            &self.text_layout,
            self.forward_z,
        );
        for (name, wanted, slot, layout, vs, fs, buffer) in [
            (
                "scene3d.line",
                !layer.lines.is_empty(),
                &mut self.line,
                draw,
                "line_vs",
                "line_fs",
                instance(std::mem::size_of::<SegmentRecord>() as u64, &SEGMENT),
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
                    module,
                    layout,
                    fz,
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

    /// Each pipeline it compiled so far, by name (#854).
    pub fn compiled_names(&self) -> &[&'static str] {
        &self.names
    }

    pub fn new(device: &Device, planted: Planted) -> Renderer {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
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
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let lights_buffer = uniform_buffer("scene3d lights", std::mem::size_of::<LightsUniform>());
        let dfg_buffer = wgpu::util::DeviceExt::create_buffer_init(
            d,
            &wgpu::util::BufferInitDescriptor {
                label: Some("scene3d dfg"),
                contents: bytemuck::cast_slice(&dfg_table()),
                usage: wgpu::BufferUsages::UNIFORM,
            },
        );
        let shadow_stub = texture2d(
            d,
            "scene3d shadow stub",
            [1, 1],
            shadow::FORMAT,
            wgpu::TextureUsages::TEXTURE_BINDING,
        )
        .create_view(&Default::default());
        let lights_bind = lights_bind(d, &lights_layout, &lights_buffer, &dfg_buffer, &shadow_stub);
        let ao = ao::Passes::new(device);
        let mesh_layout = layout(&[Some(&frame_layout), Some(&lights_layout), Some(&ao.shade_layout)]);
        let text_layout = layout(&[Some(&frame_layout), Some(&mask_layout)]);
        let output_pipeline_layout = layout(&[Some(&output_layout)]);
        let mesh_buffers = mesh_buffers();
        let mesh_pipeline = draw_pipeline(
            d,
            &module,
            &mesh_layout,
            planted.forward_z,
            "mesh_vs",
            "mesh_fs",
            &mesh_buffers,
        );
        // The shadow map: the solids' vertex stage under the light's clip matrix, depth only,
        // nearest the light kept.
        let shadow_pipeline = pipeline(
            d,
            SHADOW_PASS,
            Some(&draw_layout),
            &module,
            ("mesh_vs", &mesh_buffers),
            None,
            Some(wgpu::DepthStencilState {
                format: shadow::FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
        );
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
            epoch: device.epoch,
            frame_buffer,
            frame_bind,
            lights_buffer,
            lights_bind,
            lights_layout,
            dfg_buffer,
            lights_read_shadow: false,
            catches: false,
            solid_layout: mesh_layout.clone(),
            clear_pipelines: [None, None],
            ties: BTreeMap::new(),
            flip: false,
            tone_buffer,
            output_layout,
            covered: (None, uncovered),
            mesh_pipeline,
            ao,
            scene_module: module.clone(),
            families: Families {
                module,
                draw_layout,
                text_layout,
                forward_z: planted.forward_z,
                line: None,
                point: None,
                text: None,
            },
            output_pipeline,
            output_f32,
            finished: None,
            compiled: 3,
            names: vec![
                "scene3d.mesh",
                "scene3d.shadow",
                "scene3d.output",
                "scene3d.output_f32",
                OUTLINE_PASS,
                LABEL_PASS,
            ],
            meshes: BTreeMap::new(),
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
                pipeline: shadow_pipeline,
                buffer: light_buffer,
                bind: light_bind,
                view: None,
                clip: None,
            },
            camera: ([0.0; 16], [0.0; 3], 0.1),
            profiler: None,
            surface: Surface::default(),
            upscale: None,
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
            attach | wgpu::TextureUsages::TEXTURE_BINDING,
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
            ids_view: ids.create_view(&Default::default()),
            depth_view,
            linear,
            linear_view,
            ids,
            output_bind,
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
        if self.surface.scale < 1.0 && self.upscale.is_some() {
            surface::scaled(size, self.surface.scale)
        } else {
            size
        }
    }

    /// What the targets below scale 1 hold on the device, as it reported them; 0 at scale 1.
    pub fn low_bytes(&self) -> u64 {
        self.low.as_ref().map_or(0, |_| self.low_bytes.unwrap_or(0))
    }

    /// The lights the light policy shades at this frame's view, each with its weight (#421).
    fn prepare_lights(&mut self, device: &Device, scene: &Scene) {
        let policy = light::policy(&scene.lights, &scene.camera);
        let cam = &scene.camera;
        let view = if cam.perspective {
            [cam.eye[0], cam.eye[1], cam.eye[2], 1.0]
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2], 0.0]
        };
        let mut u = LightsUniform {
            view: view.map(|v| v as f32),
            count: [policy.shaded.len() as u32, 0, 0, 0],
            shadow: [[0.0; 4]; 4],
            items: [[[0.0; 4]; 6]; SHADED],
        };
        // The key light's shadow map, which the shadow catchers read: the scene's key sun's,
        // when the frame draws it.
        if let (Some(m), Some(sun), true) = (self.shadow.clip, &scene.sun, self.lights_read_shadow) {
            for c in 0..4 {
                for r in 0..4 {
                    u.shadow[c][r] = m[c * 4 + r] as f32;
                }
            }
            if let Some(k) = policy.shaded.iter().position(|&(i, _)| scene.lights[i].id == sun.id) {
                u.count[1] = k as u32 + 1;
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
                [l.cone[0] as f32, l.cone[1] as f32, 0.0, 0.0],
                l.area.map_or([0.0; 4], |a| v4(a.right, if a.disk { 1.0 } else { 0.0 })),
                l.area.map_or([0.0; 4], |a| v4(a.up, 0.0)),
            ];
        }
        // Only the key sun has a shadow map yet; the spot maps the budget would keep land with
        // local shadows (#446), so every other light asking is reported as dropped.
        let (_, mut dropped) = light::shadowed(&scene.lights, &policy);
        for &(i, _) in &policy.shaded {
            let l = &scene.lights[i];
            if l.shadow && l.kind == LightKind::Spot && !dropped.contains(&l.id) {
                dropped.push(l.id.clone());
            }
        }
        dropped.sort();
        self.counts.shadows_dropped = dropped;
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
                    pad: 0,
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
        self.prepare_frame(device, scene, look);
        // Each solid's rank by ID across the frame: coplanar opaque ties go to the first (#421).
        // Ranked again only when the frame's solids change, so a frame that moves them allocates
        // nothing.
        let solids = scene.layers.iter().flat_map(|l| &l.solids);
        let same = solids.clone().count() == self.ties.len()
            && solids.clone().all(|s| self.ties.contains_key(&s.id));
        if !same && !self.planted.ties_by_submission {
            let mut ids: Vec<&str> = solids.map(|s| s.id.as_str()).collect();
            ids.sort_unstable();
            self.ties.clear();
            for (rank, id) in ids.into_iter().enumerate() {
                self.ties.insert(id.to_string(), rank as u32);
            }
        }
        self.flip = !self.flip;
        for layer in &scene.layers {
            self.prepare_batch(device, layer, &scene.camera);
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
        // See-through parts reorder as the camera moves, so a frame holding one prepares whole.
        if self.planted.encodes_every_frame
            || self.order.len() != scene.layers.len()
            || self.batches.values().any(|b| !b.clear_draws.is_empty())
        {
            return self.prepare(device, scene, look);
        }
        let generation = self.ao.generation;
        self.prepare_frame(device, scene, look);
        if self.ao.generation != generation {
            // The solids' ao bind group changed: every batch with solids encodes again.
            for layer in &scene.layers {
                self.prepare_batch(device, layer, &scene.camera);
            }
            return;
        }
        let mut written = 0;
        for &(l, i) in moved {
            let layer = &scene.layers[l];
            let Some(batch) = self.batches.get_mut(&layer.id) else {
                continue;
            };
            let (Some(s), Some(&(shape, at, pick, tie))) =
                (layer.solids.get(i), batch.solid_slots.get(i))
            else {
                continue;
            };
            if let Some(set) = batch.solids.get_mut(&shape) {
                let record = solid_record(s, pick, tie, !self.planted.winding_ignores_determinant);
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
    }

    /// The frame's uniforms, outlines and shadow, and its atlas pages.
    fn prepare_frame(&mut self, device: &Device, scene: &Scene, look: &Look3) {
        self.counts = Counts::default();
        // Below internal scale 1 the targets are the internal size; px-sized marks shrink with
        // them, and the upscale returns the frame to `scene.size` (#386).
        self.size = scene.size;
        let internal = self.internal();
        self.ensure_targets(device, internal);
        let k = f64::from(internal[0]) / f64::from(scene.size[0].max(1));
        self.upload_pages(device, &scene.pages);
        let cam = &scene.camera;
        let depth = if self.planted.forward_z {
            Depth::Forward { far: FORWARD_FAR }
        } else {
            Depth::Reversed
        };
        let rows = cam.clip(depth);
        let mut clip = [[0f32; 4]; 4];
        let mut camera = [0.0; 16];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                clip[c][r] = *v as f32;
                camera[c * 4 + r] = *v;
            }
        }
        self.camera = (camera, cam.eye, cam.near);
        self.compiled += self.ao.prepare(
            device,
            &self.scene_module,
            &self.families.draw_layout,
            &mesh_buffers(),
            &mut self.names,
            look.ao,
            internal,
            &camera,
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
            sky_top: scene.sky.map_or([0.0; 4], |s| v4(s[0], 1.0)),
            sky_low: scene.sky.map_or([0.0; 4], |s| v4(s[1], 1.0)),
        };
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
        self.shadow.clip = scene
            .sun
            .as_ref()
            .filter(|s| s.shadow)
            .and_then(|s| shadow::light_clip(scene, s.toward, 0.0));
        // A shadow catcher reads the key light's map, so a frame holding one draws it.
        self.catches = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .any(|s| s.material.is_some_and(|m| m.catch.is_some()));
        if self.catches && self.shadow.clip.is_some() && !self.lights_read_shadow {
            let view = self.shadow_view(device);
            self.lights_bind = lights_bind(
                &device.device,
                &self.lights_layout,
                &self.lights_buffer,
                &self.dfg_buffer,
                &view,
            );
            self.lights_read_shadow = true;
        }
        self.prepare_lights(device, scene);
        if let Some(m) = self.shadow.clip {
            let mut light_frame = frame;
            for c in 0..4 {
                for r in 0..4 {
                    light_frame.clip[c][r] = m[c * 4 + r] as f32;
                }
            }
            // The shadow pass's mark (scene3d.wgsl's `mesh_vs`): it leaves out what casts none.
            light_frame.light[3] = -1.0;
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
            exposure: look.exposure as f32,
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

    fn prepare_batch(
        &mut self,
        device: &Device,
        layer: &Layer3,
        cam: &deep_canvas_scene3d::scene::Camera,
    ) {
        self.compiled += self.families.ensure(&device.device, layer, &mut self.names);
        let clear = |s: &Solid| {
            s.material
                .is_some_and(|m| m.alpha_mode.see_through() || m.catch.is_some())
        };
        for (k, add) in [(0, false), (1, true)] {
            let wanted = layer.solids.iter().any(|s| {
                clear(s) && s.material.is_some_and(|m| (m.alpha_mode == AlphaMode::Add) == add)
            });
            if wanted && self.clear_pipelines[k].is_none() {
                self.clear_pipelines[k] = Some(clear_pipeline(
                    &device.device,
                    &self.families.module,
                    &self.solid_layout,
                    self.planted.forward_z,
                    add,
                ));
                self.compiled += 1;
                self.names.push(if add { "scene3d.add" } else { "scene3d.blend" });
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
        for s in &layer.solids {
            match &s.mesh {
                Some(m) => self.built_mesh(device, s.shape, m),
                None => self.mesh(device, s.shape),
            }
            let tie = self.ties.get(&s.id).copied().unwrap_or(0);
            slots.push((s.shape, 0, self.pick(&s.id), tie));
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
        for set in batch.solids.values_mut() {
            set.begin();
        }
        let winding = !self.planted.winding_ignores_determinant;
        let mut order: Vec<(&Solid, &mut (Shape, u32, u32, u32))> =
            layer.solids.iter().zip(&mut slots).collect();
        // The planted ties_by_submission: the opaque draws' order turns over each frame.
        if self.planted.ties_by_submission && self.flip {
            order.reverse();
        }
        // See-through parts and shadow catchers draw after the opaque ones, back to front by
        // view depth plus their sort_bias, ties by ID.
        let mut see_through = Vec::new();
        for (s, slot) in order {
            let record = solid_record(s, slot.2, slot.3, winding);
            if clear(s) {
                let c = [s.model[0][3], s.model[1][3], s.model[2][3]];
                let depth = (0..3).map(|k| (c[k] - cam.eye[k]) * cam.forward[k]).sum::<f64>();
                see_through.push((depth + s.sort_bias, s, record));
                slot.1 = u32::MAX;
                continue;
            }
            let set = batch.solids.entry(s.shape).or_default();
            slot.1 = set.count as u32;
            set.push(&s.id, bytemuck::bytes_of(&record));
        }
        see_through.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
        batch.clear.begin();
        batch.clear_draws.clear();
        for (_, s, record) in &see_through {
            batch.clear.push(&s.id, bytemuck::bytes_of(record));
            let add = s.material.is_some_and(|m| m.alpha_mode == AlphaMode::Add);
            batch.clear_draws.push((s.shape, add));
        }
        batch.clear.finish(device, &mut next, &mut written);
        batch.solid_slots = slots;
        batch.solids.retain(|_, set| set.count > 0);
        for set in batch.solids.values_mut() {
            set.finish(device, &mut next, &mut written);
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
                        | (u32::from(l.over) << 2),
                    pad: 0,
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
        for (shape, set) in &batch.solids {
            batch
                .next_key
                .extend([shape_code(*shape), set.generation, u64::from(set.len())]);
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
            for (shape, add) in &batch.clear_draws {
                batch.next_key.extend([shape_code(*shape), u64::from(*add)]);
            }
        }
        // The lights' bind group, once it reads the drawn shadow map.
        batch.next_key.push(u64::from(self.lights_read_shadow));
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

    /// Records a batch's draws into a render bundle.
    fn encode(&self, device: &Device, id: &str) -> wgpu::RenderBundle {
        let batch = &self.batches[id];
        let mut enc =
            device
                .device
                .create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor {
                    label: Some(id),
                    color_formats: &[Some(LINEAR), Some(IDS)],
                    depth_stencil: Some(wgpu::RenderBundleDepthStencil {
                        format: DEPTH,
                        depth_read_only: false,
                        stencil_read_only: true,
                    }),
                    sample_count: 1,
                    multiview: None,
                });
        enc.set_bind_group(0, &self.frame_bind, &[]);
        enc.set_bind_group(1, &self.lights_bind, &[]);
        enc.set_bind_group(2, self.ao.shade(), &[]);
        for (shape, set) in &batch.solids {
            let (Some(buffer), Some(mesh)) = (&set.buffer, self.meshes.get(shape)) else {
                continue;
            };
            enc.set_pipeline(&self.mesh_pipeline);
            enc.set_vertex_buffer(0, mesh.vertices.slice(..));
            enc.set_vertex_buffer(1, buffer.slice(..));
            enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
            enc.draw_indexed(0..mesh.count, 0, 0..set.len());
        }
        if let Some(buffer) = &batch.clear.buffer {
            for (k, (shape, add)) in batch.clear_draws.iter().enumerate() {
                let (Some(mesh), Some(pipeline)) =
                    (self.meshes.get(shape), &self.clear_pipelines[usize::from(*add)])
                else {
                    continue;
                };
                let k = k as u32;
                enc.set_pipeline(pipeline);
                enc.set_vertex_buffer(0, mesh.vertices.slice(..));
                enc.set_vertex_buffer(1, buffer.slice(..));
                enc.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                enc.draw_indexed(0..mesh.count, 0, k..k + 1);
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
            .filter_map(|(shape, set)| {
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

    fn shadow_job(&mut self, device: &Device) -> Option<Job> {
        self.shadow.clip?;
        let view = self.shadow_view(device);
        let pipeline = self.shadow.pipeline.clone();
        let bind = self.shadow.bind.clone();
        let mut draws = Vec::new();
        for id in &self.order {
            let batch = &self.batches[id];
            for (shape, set) in &batch.solids {
                if let (Some(buffer), Some(mesh)) = (&set.buffer, self.meshes.get(shape)) {
                    draws.push((
                        mesh.vertices.clone(),
                        mesh.indices.clone(),
                        mesh.count,
                        buffer.clone(),
                        0..set.len(),
                    ));
                }
            }
            // See-through parts cast as their `shadow` says (the record's no-cast flag).
            if let Some(buffer) = &batch.clear.buffer {
                for (k, (shape, _)) in batch.clear_draws.iter().enumerate() {
                    if let Some(mesh) = self.meshes.get(shape) {
                        let k = k as u32;
                        draws.push((
                            mesh.vertices.clone(),
                            mesh.indices.clone(),
                            mesh.count,
                            buffer.clone(),
                            k..k + 1,
                        ));
                    }
                }
            }
        }
        let profiler = self.profiler.clone();
        Some(Box::new(move |encoder| {
            timed(
                &profiler,
                SHADOW_PASS,
                encoder,
                |encoder, timestamp_writes| {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(SHADOW_PASS),
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
                    pass.set_pipeline(&pipeline);
                    pass.set_bind_group(0, &bind, &[]);
                    for (vertices, indices, count, instances, range) in &draws {
                        pass.set_vertex_buffer(0, vertices.slice(..));
                        pass.set_vertex_buffer(1, instances.slice(..));
                        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..*count, 0, range.clone());
                    }
                },
            );
        }))
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
            _ if self.catches => self.shadow_job(device),
            _ => None,
        };
        let Some(t) = self.targets.as_ref() else {
            return Vec::new();
        };
        let bundles: Vec<wgpu::RenderBundle> = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id)?.bundle.clone())
            .collect();
        let (linear, ids, depth) = (
            t.linear_view.clone(),
            t.ids_view.clone(),
            t.depth_view.clone(),
        );
        let (ground, clear_depth) = (self.ground, self.clear_depth());
        let profiler = self.profiler.clone();
        let geometry: Job = Box::new(move |encoder| {
            timed(&profiler, GEOMETRY_PASS, encoder, |encoder, timestamps| {
                geometry_pass(
                    encoder,
                    [&linear, &ids, &depth],
                    ground,
                    clear_depth,
                    bundles.iter(),
                    timestamps,
                )
            })
        });
        let mut jobs: Vec<(String, Job)> = Vec::new();
        if let Some(s) = shadow {
            jobs.push((SHADOW_PASS.into(), s));
        }
        if let Some(ao) = self.ao_frame() {
            let profiler = self.profiler.clone();
            jobs.push((
                ao::OCCLUSION.into(),
                Box::new(move |encoder| {
                    timed(&profiler, ao::OCCLUSION, encoder, |e, _| ao.record(e))
                }),
            ));
        }
        jobs.push((GEOMETRY_PASS.into(), geometry));
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
            })
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
        &self,
        encoder: &mut wgpu::CommandEncoder,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let Some(t) = self.targets.as_ref() else {
            return;
        };
        if let Some(ao) = self.ao_frame() {
            ao.record(encoder);
        }
        let bundles = self
            .order
            .iter()
            .filter_map(|id| self.batches.get(id)?.bundle.as_ref());
        geometry_pass(
            encoder,
            [&t.linear_view, &t.ids_view, &t.depth_view],
            self.ground,
            self.clear_depth(),
            bundles,
            timestamps,
        );
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
}

/// The look's tone map alone (#418's `tone` call), as the output pass runs it, over `input` (f32
/// RGBA, rows top-down, `size` px) on `device`, with no exposure and no encode; the output in the
/// same layout, or `None` on a backend with no pixels.
pub fn tone(device: &Device, map: ToneMap, input: &[f32], size: [u32; 2]) -> Option<Vec<u8>> {
    let d = &device.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("scene3d tone"),
        source: wgpu::ShaderSource::Wgsl(OUTPUT.into()),
    });
    let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene3d tone"),
        entries: &[
            texture_entry(),
            buffer_entry(1, wgpu::ShaderStages::FRAGMENT, wgpu::BufferBindingType::Uniform),
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
    let uniform = ToneUniform {
        exposure: 1.0,
        map: code,
        white: white as f32,
        contrast: contrast as f32,
        encode: 0,
        deband: 0.0,
        saturation: 1.0,
        graded: 0,
        wb: [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]],
        slope: [1.0; 4],
        offset: [0.0; 4],
        power: [1.0; 4],
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
    let row = size[0] * texel;
    let padded =
        row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let bytes = u64::from(padded) * u64::from(size[1]);
    let data = read_back(device, "scene3d read back", bytes, |encoder, staging| {
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
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

fn geometry_pass<'a>(
    encoder: &mut wgpu::CommandEncoder,
    [linear, ids, depth]: [&wgpu::TextureView; 3],
    [r, g, b, a]: [f64; 4],
    clear_depth: f64,
    bundles: impl Iterator<Item = &'a wgpu::RenderBundle>,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    deep_gpu::alloc::outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(GEOMETRY_PASS),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: linear,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                        store: wgpu::StoreOp::Store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: ids,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_depth as f32),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: timestamps,
            ..Default::default()
        });
        pass.execute_bundles(bundles);
    });
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
            for (shape, set) in &b.solids {
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
}
