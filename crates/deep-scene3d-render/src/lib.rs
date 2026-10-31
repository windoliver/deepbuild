//! scene3d's render module (issue #378): see the crate manifest.
//!
//! A frame: the scene's camera and look go into two small uniform buffers; each 3D writer layer's
//! batch writes the instance records that changed and keeps its render bundle while its draw key
//! holds, so a move or a recolor writes one record and encodes nothing, and a presence change (an
//! item added or removed) encodes that batch alone again. The geometry pass clears the linear,
//! object-ID and depth targets and replays every batch's bundle; the output pass reads the linear
//! target and writes the slot.

mod mesh;
pub mod shadow;
pub mod status;

use std::collections::BTreeMap;
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::label::{AtlasPage, PAGE, PAGES};
use deep_canvas_scene3d::look::{Look3, ToneMap};
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Depth, Facing, Layer3, PointShape, Scene, Shape};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;

use crate::mesh::Mesh;

/// The 3D writer layers' linear target: what the output pass reads.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// The object-ID target: each pixel the pick ID of the item drawn there, 0 for none.
pub const IDS: wgpu::TextureFormat = wgpu::TextureFormat::R32Uint;
pub const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// The planted forward-Z twin's far plane.
pub const FORWARD_FAR: f64 = 10_000.0;

const SHADER: &str = include_str!("scene3d.wgsl");
const OUTPUT: &str = include_str!("output.wgsl");
const BUSY: &str = include_str!("busy.wgsl");
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
    pub slot: &'a wgpu::TextureView,
}

/// Passes after the finish: with one attached, the output pass writes the finished frame instead
/// of the slot, and these passes write the slot from it.
pub trait After: Send {
    /// The passes it adds to the frame, each into its place, for the frame's plan.
    fn passes(&self) -> Vec<Pass>;
    /// The passes' encodes, in frame order.
    fn jobs(&mut self, device: &Device, frame: &AfterFrame<'_>) -> Vec<(String, Job)>;
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
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ToneUniform {
    exposure: f32,
    map: u32,
    white: f32,
    contrast: f32,
    encode: u32,
    pad: [u32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SolidRecord {
    rows: [[f32; 4]; 3],
    color: u32,
    pick: u32,
    pad: [u32; 2],
}

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
/// ems (x right, y down), its texels on its atlas page, the label's axes, and `flags`: world
/// size, facing, and the page.
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
    tone_buffer: wgpu::Buffer,
    output_layout: wgpu::BindGroupLayout,
    mesh_pipeline: wgpu::RenderPipeline,
    families: Families,
    output_pipeline: wgpu::RenderPipeline,
    /// The output pass into the finished frame, for the passes after the finish (#382).
    output_f32: wgpu::RenderPipeline,
    /// The finished frame (status::FINISHED), made when a frame has passes after the finish.
    finished: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// Render pipelines this renderer compiled, so a patch's new ones can be counted (#379).
    compiled: u32,
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
    }
}

const MESH_VERTEX: [wgpu::VertexAttribute; 2] =
    wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
const SOLID: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Uint32, 6 => Uint32
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
    /// Compiles the pipelines `layer` draws with that aren't yet; how many it compiled.
    fn ensure(&mut self, d: &wgpu::Device, layer: &Layer3) -> u32 {
        let mut made = 0;
        let (module, draw, text, fz) = (
            &self.module,
            &self.draw_layout,
            &self.text_layout,
            self.forward_z,
        );
        for (wanted, slot, layout, vs, fs, buffer) in [
            (
                !layer.lines.is_empty(),
                &mut self.line,
                draw,
                "line_vs",
                "line_fs",
                instance(std::mem::size_of::<SegmentRecord>() as u64, &SEGMENT),
            ),
            (
                !layer.points.is_empty(),
                &mut self.point,
                draw,
                "point_vs",
                "point_fs",
                instance(std::mem::size_of::<PointRecord>() as u64, &POINT),
            ),
            (
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
        let output_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d output"),
            entries: &[texture_entry(), uniform(1, wgpu::ShaderStages::FRAGMENT)],
        });
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
        let text_layout = layout(&[Some(&frame_layout), Some(&mask_layout)]);
        let output_pipeline_layout = layout(&[Some(&output_layout)]);
        let mesh_buffers = [
            Some(wgpu::VertexBufferLayout {
                array_stride: 24,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &MESH_VERTEX,
            }),
            Some(instance(std::mem::size_of::<SolidRecord>() as u64, &SOLID)),
        ];
        let mesh_pipeline = draw_pipeline(
            d,
            &module,
            &draw_layout,
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
            tone_buffer,
            output_layout,
            mesh_pipeline,
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
            compiled: 2,
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
        self.targets = Some(Targets {
            size,
            ids_view: ids.create_view(&Default::default()),
            depth_view: depth.create_view(&Default::default()),
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
            ],
        )
    }

    /// Builds `shape`'s unit mesh the first time a batch draws one.
    fn mesh(&mut self, device: &Device, shape: Shape) {
        if let std::collections::btree_map::Entry::Vacant(e) = self.meshes.entry(shape) {
            e.insert(Mesh::build(device, shape));
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
        self.counts = Counts::default();
        self.ensure_targets(device, scene.size);
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
        let frame = FrameUniform {
            clip,
            right: v4(cam.right, 0.0),
            up: v4(cam.up, 0.0),
            viewport: [
                scene.size[0] as f32,
                scene.size[1] as f32,
                cam.scale as f32,
                if cam.perspective { 1.0 } else { 0.0 },
            ],
            light,
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.frame_buffer, 0, bytemuck::bytes_of(&frame))
        });
        self.shadow.clip = scene
            .sun
            .as_ref()
            .filter(|s| s.shadow)
            .and_then(|s| shadow::light_clip(scene, s.toward, 0.0));
        if let Some(m) = self.shadow.clip {
            let mut light_frame = frame;
            for c in 0..4 {
                for r in 0..4 {
                    light_frame.clip[c][r] = m[c * 4 + r] as f32;
                }
            }
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
            pad: [0; 3],
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
        for layer in &scene.layers {
            self.prepare_batch(device, layer);
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

    fn prepare_batch(&mut self, device: &Device, layer: &Layer3) {
        self.compiled += self.families.ensure(&device.device, layer);
        let mut written = 0u32;
        let mut next = self.next_generation;
        for s in &layer.solids {
            self.mesh(device, s.shape);
            self.pick(&s.id);
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
        if !self.batches.contains_key(&layer.id) {
            self.batches.insert(layer.id.clone(), Batch::default());
        }
        let picks = &self.picks;
        let batch = self.batches.get_mut(&layer.id).expect("made above");
        for set in batch.solids.values_mut() {
            set.begin();
        }
        for s in &layer.solids {
            let rows = s
                .model
                .map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32]);
            let record = SolidRecord {
                rows,
                color: pack(s.color),
                pick: picks[&s.id],
                pad: [0; 2],
            };
            let set = batch.solids.entry(s.shape).or_default();
            set.push(&s.id, bytemuck::bytes_of(&record));
        }
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
                    flags: u32::from(l.world),
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
            for g in &l.glyphs {
                let Some(a) = g.atlas else { continue };
                let texel = |v: u32| v as f32 / PAGE as f32;
                let record = TextRecord {
                    p: v4(l.pos, l.em),
                    rect: g.rect,
                    uv: [texel(a.x), texel(a.y), texel(a.x + a.w), texel(a.y + a.h)],
                    right: v4(l.axes[0], 0.0),
                    up: v4(l.axes[1], 0.0),
                    color: pack(l.color),
                    pick: picks[&l.id],
                    flags: u32::from(l.world) | (facing << 1) | (a.page << 3),
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

    pub fn counts(&self) -> &Counts {
        &self.counts
    }

    /// The key light's shadow map: the solids of every batch drawn depth-only from the light.
    fn shadow_job(&mut self, device: &Device) -> Option<Job> {
        self.shadow.clip?;
        let view = self
            .shadow
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
            .clone();
        let pipeline = self.shadow.pipeline.clone();
        let bind = self.shadow.bind.clone();
        let mut draws = Vec::new();
        for id in &self.order {
            for (shape, set) in &self.batches[id].solids {
                if let (Some(buffer), Some(mesh)) = (&set.buffer, self.meshes.get(shape)) {
                    draws.push((
                        mesh.vertices.clone(),
                        mesh.indices.clone(),
                        mesh.count,
                        buffer.clone(),
                        set.len(),
                    ));
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
                    for (vertices, indices, count, instances, n) in &draws {
                        pass.set_vertex_buffer(0, vertices.slice(..));
                        pass.set_vertex_buffer(1, instances.slice(..));
                        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(0..*count, 0, 0..*n);
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
        jobs.push((GEOMETRY_PASS.into(), geometry));
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
            if let Some(view) = source {
                bind = self.output_bind(&device.device, &view);
            }
        }
        // With passes after the finish, the output writes the finished frame, and they write
        // the slot from it (#382).
        let size = t.size;
        let finished = after.is_some().then(|| self.finished(device, size));
        let (target, pipeline) = match &finished {
            Some(f) => (f.clone(), self.output_f32.clone()),
            None => (slot.clone(), self.output_pipeline.clone()),
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
        if let (Some(after), Some(finished)) = (after, finished) {
            jobs.extend(after.jobs(
                device,
                &AfterFrame {
                    size,
                    finished: &finished,
                    slot,
                },
            ));
        }
        jobs
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
        s.renderer = Some(Renderer::new(device, planted));
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
