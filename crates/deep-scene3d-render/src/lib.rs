//! scene3d's render module (issue #378): see the crate manifest.
//!
//! A frame: the scene's camera and look go into two small uniform buffers; each 3D writer layer's
//! batch writes the instance records that changed and keeps its render bundle while its draw key
//! holds, so a move or a recolor writes one record and encodes nothing, and a presence change (an
//! item added or removed) encodes that batch alone again. The geometry pass clears the linear,
//! object-ID and depth targets and replays every batch's bundle; the output pass reads the linear
//! target and writes the slot.

mod mesh;

use std::collections::BTreeMap;
use std::sync::{mpsc, Arc, Mutex, MutexGuard};

use bytemuck::{Pod, Zeroable};
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
struct TextRecord {
    p: [f32; 4],
    quad: [f32; 4],
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

/// One family's instance records in a batch, in a buffer of their own.
#[derive(Default)]
struct Set {
    buffer: Option<wgpu::Buffer>,
    /// Which allocation the buffer is: a new one is a new resource in the draw key.
    generation: u64,
    capacity: usize,
    owners: Vec<String>,
    records: Vec<Vec<u8>>,
}

impl Set {
    /// Writes the records that changed, or all of them when the set's members changed. True when
    /// the members changed.
    fn update(
        &mut self,
        device: &Device,
        owners: Vec<String>,
        records: Vec<Vec<u8>>,
        next_generation: &mut u64,
        written: &mut u32,
    ) -> bool {
        let size = records.first().map_or(16, Vec::len) as u64;
        let members_changed = owners != self.owners || self.buffer.is_none();
        if members_changed {
            if self.buffer.is_none() || self.capacity < records.len() {
                self.capacity = records.len().max(1);
                *next_generation += 1;
                self.generation = *next_generation;
                self.buffer = Some(device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("scene3d instances"),
                    size: size * self.capacity as u64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let buffer = self.buffer.as_ref().expect("allocated above");
            if !records.is_empty() {
                device.queue.write_buffer(buffer, 0, &records.concat());
            }
            *written += records.len() as u32;
        } else {
            let buffer = self
                .buffer
                .as_ref()
                .expect("a set with members has a buffer");
            for (i, (new, old)) in records.iter().zip(&self.records).enumerate() {
                if new != old {
                    device.queue.write_buffer(buffer, i as u64 * size, new);
                    *written += 1;
                }
            }
        }
        self.owners = owners;
        self.records = records;
        members_changed
    }

    fn len(&self) -> u32 {
        self.records.len() as u32
    }
}

/// A 3D writer layer's batch: its instance sets, its labels' masks and its encoding.
#[derive(Default)]
struct Batch {
    solids: BTreeMap<Shape, Set>,
    lines: Set,
    points: Set,
    labels: Set,
    /// Each label's mask, in the labels' order.
    masks: Vec<(String, String)>,
    bundle: Option<wgpu::RenderBundle>,
    /// The resources and draws the bundle binds and records, as it was encoded.
    key: Vec<u64>,
}

struct MaskTexture {
    generation: u64,
    bind: wgpu::BindGroup,
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

pub struct Renderer {
    planted: Planted,
    epoch: u64,
    frame_buffer: wgpu::Buffer,
    frame_bind: wgpu::BindGroup,
    tone_buffer: wgpu::Buffer,
    mask_layout: wgpu::BindGroupLayout,
    output_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    mesh_pipeline: wgpu::RenderPipeline,
    line_pipeline: wgpu::RenderPipeline,
    point_pipeline: wgpu::RenderPipeline,
    text_pipeline: wgpu::RenderPipeline,
    output_pipeline: wgpu::RenderPipeline,
    meshes: BTreeMap<Shape, Mesh>,
    batches: BTreeMap<String, Batch>,
    masks: BTreeMap<(String, String), MaskTexture>,
    picks: BTreeMap<String, u32>,
    next_generation: u64,
    targets: Option<Targets>,
    /// The batches this frame draws, in layer order.
    order: Vec<String>,
    ground: [f64; 4],
    counts: Counts,
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

impl Renderer {
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
        let uniform = |binding, visibility| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
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
                        view_dimension: wgpu::TextureViewDimension::D2,
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
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                uniform(1, wgpu::ShaderStages::FRAGMENT),
            ],
        });
        let frame_buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d frame"),
            size: std::mem::size_of::<FrameUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let tone_buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d tone"),
            size: std::mem::size_of::<ToneUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let frame_bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d frame"),
            layout: &frame_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: frame_buffer.as_entire_binding(),
            }],
        });
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
        let depth = wgpu::DepthStencilState {
            format: DEPTH,
            depth_write_enabled: Some(true),
            depth_compare: Some(if planted.forward_z {
                wgpu::CompareFunction::Less
            } else {
                wgpu::CompareFunction::GreaterEqual
            }),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let targets = [
            Some(wgpu::ColorTargetState {
                format: LINEAR,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            }),
            Some(wgpu::ColorTargetState {
                format: IDS,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            }),
        ];
        let pipeline = |layout: &wgpu::PipelineLayout,
                        vs: &str,
                        fs: &str,
                        buffers: &[Option<wgpu::VertexBufferLayout<'_>>]| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(vs),
                layout: Some(layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers,
                },
                primitive: Default::default(),
                depth_stencil: Some(depth.clone()),
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &targets,
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let instance =
            |stride: u64, attributes: &'static [wgpu::VertexAttribute]| wgpu::VertexBufferLayout {
                array_stride: stride,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes,
            };
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
        const TEXT: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
            0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4,
            4 => Uint32, 5 => Uint32, 6 => Uint32
        ];
        let mesh_pipeline = pipeline(
            &draw_layout,
            "mesh_vs",
            "mesh_fs",
            &[
                Some(wgpu::VertexBufferLayout {
                    array_stride: 24,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &MESH_VERTEX,
                }),
                Some(instance(std::mem::size_of::<SolidRecord>() as u64, &SOLID)),
            ],
        );
        let line_pipeline = pipeline(
            &draw_layout,
            "line_vs",
            "line_fs",
            &[Some(instance(
                std::mem::size_of::<SegmentRecord>() as u64,
                &SEGMENT,
            ))],
        );
        let point_pipeline = pipeline(
            &draw_layout,
            "point_vs",
            "point_fs",
            &[Some(instance(
                std::mem::size_of::<PointRecord>() as u64,
                &POINT,
            ))],
        );
        let text_pipeline = pipeline(
            &text_layout,
            "text_vs",
            "text_fs",
            &[Some(instance(
                std::mem::size_of::<TextRecord>() as u64,
                &TEXT,
            ))],
        );
        let output_pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(OUTPUT_PASS),
            layout: Some(&output_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &output,
                entry_point: Some("out_vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &output,
                entry_point: Some("out_fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Renderer {
            planted,
            epoch: device.epoch,
            frame_buffer,
            frame_bind,
            tone_buffer,
            mask_layout,
            output_layout,
            sampler,
            mesh_pipeline,
            line_pipeline,
            point_pipeline,
            text_pipeline,
            output_pipeline,
            meshes: BTreeMap::new(),
            batches: BTreeMap::new(),
            masks: BTreeMap::new(),
            picks: BTreeMap::new(),
            next_generation: 0,
            targets: None,
            order: Vec::new(),
            ground: [0.0, 0.0, 0.0, 1.0],
            counts: Counts::default(),
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
        let texture = |label, format, usage| {
            d.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let attach = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC;
        let linear = texture(
            "scene3d linear",
            LINEAR,
            attach | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let ids = texture("scene3d ids", IDS, attach);
        let depth = texture(
            "scene3d depth",
            DEPTH,
            wgpu::TextureUsages::RENDER_ATTACHMENT,
        );
        let linear_view = linear.create_view(&Default::default());
        let output_bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d output"),
            layout: &self.output_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&linear_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.tone_buffer.as_entire_binding(),
                },
            ],
        });
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

    /// Builds `shape`'s unit mesh the first time a batch draws one.
    fn mesh(&mut self, device: &Device, shape: Shape) {
        if let std::collections::btree_map::Entry::Vacant(e) = self.meshes.entry(shape) {
            e.insert(Mesh::build(device, shape));
            self.counts.meshes_built += 1;
        }
    }

    fn mask(
        &mut self,
        device: &Device,
        key: &(String, String),
        mask: &deep_canvas_scene3d::label::Mask,
    ) -> u64 {
        if let Some(m) = self.masks.get(key) {
            return m.generation;
        }
        let d = &device.device;
        let size = wgpu::Extent3d {
            width: mask.width,
            height: mask.height,
            depth_or_array_layers: 1,
        };
        let texture = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d label mask"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        device.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &mask.alpha,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(mask.width),
                rows_per_image: Some(mask.height),
            },
            size,
        );
        let view = texture.create_view(&Default::default());
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d label"),
            layout: &self.mask_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        self.next_generation += 1;
        let generation = self.next_generation;
        self.masks
            .insert(key.clone(), MaskTexture { generation, bind });
        generation
    }

    /// Takes the frame's scene: the uniforms, each batch's changed records, and the batches
    /// whose draw key changed encoded again. What it did is in [`Renderer::counts`].
    pub fn prepare(&mut self, device: &Device, scene: &Scene, look: &Look3) {
        self.counts = Counts::default();
        self.ensure_targets(device, scene.size);
        let cam = &scene.camera;
        let depth = if self.planted.forward_z {
            Depth::Forward { far: FORWARD_FAR }
        } else {
            Depth::Reversed
        };
        let rows = cam.clip(depth);
        let mut clip = [[0f32; 4]; 4];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                clip[c][r] = *v as f32;
            }
        }
        let light = {
            let l = [0.35f64, 0.8, 0.5];
            let n = (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt();
            [(l[0] / n) as f32, (l[1] / n) as f32, (l[2] / n) as f32, 0.0]
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
        device
            .queue
            .write_buffer(&self.frame_buffer, 0, bytemuck::bytes_of(&frame));
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
        device
            .queue
            .write_buffer(&self.tone_buffer, 0, bytemuck::bytes_of(&tone));
        self.ground = [
            decode(scene.ground[0]),
            decode(scene.ground[1]),
            decode(scene.ground[2]),
            1.0,
        ];
        let mut order = Vec::with_capacity(scene.layers.len());
        for layer in &scene.layers {
            self.prepare_batch(device, layer);
            order.push(layer.id.clone());
        }
        self.batches.retain(|id, _| order.contains(id));
        self.order = order;
    }

    fn prepare_batch(&mut self, device: &Device, layer: &Layer3) {
        let mut written = 0u32;
        let mut next = self.next_generation;
        let mut shapes: BTreeMap<Shape, (Vec<String>, Vec<Vec<u8>>)> = BTreeMap::new();
        for s in &layer.solids {
            let pick = self.pick(&s.id);
            let rows = s
                .model
                .map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, r[3] as f32]);
            let record = SolidRecord {
                rows,
                color: pack(s.color),
                pick,
                pad: [0; 2],
            };
            let entry = shapes.entry(s.shape).or_default();
            entry.0.push(s.id.clone());
            entry.1.push(bytemuck::bytes_of(&record).to_vec());
        }
        for shape in shapes.keys() {
            self.mesh(device, *shape);
        }
        let (mut line_owners, mut line_records) = (Vec::new(), Vec::new());
        for l in &layer.lines {
            let pick = self.pick(&l.id);
            for seg in &l.segments {
                let record = SegmentRecord {
                    a: v4(seg.a, seg.wa),
                    b: v4(seg.b, seg.wb),
                    color: pack(l.color),
                    pick,
                    flags: u32::from(l.world),
                    pad: 0,
                };
                line_owners.push(l.id.clone());
                line_records.push(bytemuck::bytes_of(&record).to_vec());
            }
        }
        let (mut point_owners, mut point_records) = (Vec::new(), Vec::new());
        for p in &layer.points {
            let pick = self.pick(&p.id);
            let shape = match p.shape {
                PointShape::Dot => 0,
                PointShape::Square => 1,
                PointShape::Diamond => 2,
            };
            let record = PointRecord {
                p: v4(p.pos, p.size),
                color: pack(p.color),
                pick,
                flags: u32::from(p.world) | (shape << 1),
                pad: 0,
            };
            point_owners.push(p.id.clone());
            point_records.push(bytemuck::bytes_of(&record).to_vec());
        }
        let (mut label_owners, mut label_records, mut masks, mut mask_generations) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for l in &layer.labels {
            let pick = self.pick(&l.id);
            mask_generations.push(self.mask(device, &l.key, &l.mask));
            masks.push(l.key.clone());
            let facing = match l.facing {
                Facing::Camera => 0,
                Facing::Upright => 1,
                Facing::Fixed => 2,
            };
            let record = TextRecord {
                p: v4(l.pos, 0.0),
                quad: [l.quad[0] as f32, l.quad[1] as f32, 0.0, 0.0],
                right: v4(l.axes[0], 0.0),
                up: v4(l.axes[1], 0.0),
                color: pack(l.color),
                pick,
                flags: u32::from(l.world) | (facing << 1),
                pad: 0,
            };
            label_owners.push(l.id.clone());
            label_records.push(bytemuck::bytes_of(&record).to_vec());
        }
        let batch = self.batches.entry(layer.id.clone()).or_default();
        batch.solids.retain(|s, _| shapes.contains_key(s));
        for (shape, (owners, records)) in shapes {
            batch.solids.entry(shape).or_default().update(
                device,
                owners,
                records,
                &mut next,
                &mut written,
            );
        }
        batch
            .lines
            .update(device, line_owners, line_records, &mut next, &mut written);
        batch
            .points
            .update(device, point_owners, point_records, &mut next, &mut written);
        batch
            .labels
            .update(device, label_owners, label_records, &mut next, &mut written);
        batch.masks = masks;
        self.next_generation = next;
        self.counts.instances_written += written;

        // The draw key: each draw's pipeline, the buffers and bind groups it binds by resource,
        // and its counts. The values written into those buffers never enter it.
        let mut key = Vec::new();
        for (shape, set) in &batch.solids {
            key.extend([shape_code(*shape), set.generation, u64::from(set.len())]);
        }
        for (family, set) in [(10, &batch.lines), (11, &batch.points), (12, &batch.labels)] {
            if set.len() > 0 {
                key.extend([family, set.generation, u64::from(set.len())]);
            }
        }
        key.extend(mask_generations);
        let unchanged = batch.bundle.is_some() && batch.key == key;
        let keeps_stale = self.planted.replays_after_add && batch.bundle.is_some();
        if (unchanged || keeps_stale) && !self.planted.encodes_every_frame {
            self.counts.replayed += 1;
            return;
        }
        let bundle = self.encode(device, &layer.id);
        let batch = self.batches.get_mut(&layer.id).expect("made above");
        batch.bundle = Some(bundle);
        batch.key = key;
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
            (&self.line_pipeline, &batch.lines),
            (&self.point_pipeline, &batch.points),
        ] {
            if let (Some(buffer), true) = (&set.buffer, set.len() > 0) {
                enc.set_pipeline(pipeline);
                enc.set_vertex_buffer(0, buffer.slice(..));
                enc.draw(0..6, 0..set.len());
            }
        }
        if let (Some(buffer), true) = (&batch.labels.buffer, batch.labels.len() > 0) {
            enc.set_pipeline(&self.text_pipeline);
            enc.set_vertex_buffer(0, buffer.slice(..));
            for (i, key) in batch.masks.iter().enumerate() {
                if let Some(mask) = self.masks.get(key) {
                    enc.set_bind_group(1, &mask.bind, &[]);
                    enc.draw(0..6, i as u32..i as u32 + 1);
                }
            }
        }
        enc.finish(&wgpu::RenderBundleDescriptor { label: Some(id) })
    }

    pub fn counts(&self) -> &Counts {
        &self.counts
    }

    /// The frame's two passes, each one encode: the geometry pass replays every batch into the
    /// targets, and the output pass writes `slot`.
    pub fn jobs(&self, slot: &wgpu::TextureView) -> Vec<(String, Job)> {
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
        let [r, g, b, a] = self.ground;
        let clear_depth = if self.planted.forward_z { 1.0 } else { 0.0 };
        let geometry: Job = Box::new(move |encoder| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(GEOMETRY_PASS),
                color_attachments: &[
                    Some(wgpu::RenderPassColorAttachment {
                        view: &linear,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                    Some(wgpu::RenderPassColorAttachment {
                        view: &ids,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    }),
                ],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear_depth),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.execute_bundles(bundles.iter());
        });
        let (slot, pipeline, bind) = (
            slot.clone(),
            self.output_pipeline.clone(),
            t.output_bind.clone(),
        );
        let output: Job = Box::new(move |encoder| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(OUTPUT_PASS),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &slot,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind, &[]);
            pass.draw(0..3, 0..1);
        });
        vec![
            (GEOMETRY_PASS.into(), geometry),
            (OUTPUT_PASS.into(), output),
        ]
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
fn read_texture(
    device: &Device,
    texture: &wgpu::Texture,
    size: [u32; 2],
    texel: u32,
) -> Option<Vec<u8>> {
    let row = size[0] * texel;
    let padded =
        row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let d = &device.device;
    let staging = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d read back"),
        size: u64::from(padded) * u64::from(size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = d.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &staging,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(size[1]),
            },
        },
        wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
    );
    device.queue.submit([encoder.finish()]);
    let (tx, rx) = mpsc::channel();
    staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return None;
    }
    let data = staging.slice(..).get_mapped_range().ok()?;
    let mut out = Vec::with_capacity((row * size[1]) as usize);
    for y in 0..size[1] as usize {
        let start = y * padded as usize;
        out.extend_from_slice(&data[start..start + row as usize]);
    }
    Some(out)
}

/// What the GPU-layer view and the driver share: the next frame's scene and look, and the
/// renderer, which the render module builds on the view's device.
pub struct Shared {
    pub next: Option<(Arc<Scene>, Look3)>,
    pub renderer: Option<Renderer>,
    pub planted: Planted,
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
            "label masks:texture",
            "linear:texture",
            "ids:texture",
            "depth:texture",
            "shader:shader_module",
            "draws:render_pipeline",
            "output:render_pipeline",
            "batches:render_bundle",
        ]
    }

    fn passes(&self) -> Vec<Pass> {
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
        let Some(renderer) = s.renderer.as_mut() else {
            return Vec::new();
        };
        renderer.prepare(device, &scene, &look);
        renderer.jobs(&target.view)
    }
}

/// Draws one frame offscreen on `device` (a snapshot): BGRA8 bytes, rows top-down; `None` on a
/// backend with no pixels.
pub fn draw_offscreen(
    device: &Device,
    renderer: &mut Renderer,
    scene: &Scene,
    look: &Look3,
) -> Option<Vec<u8>> {
    let size = scene.size;
    let texture = device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("scene3d snapshot"),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    renderer.prepare(device, scene, look);
    let mut encoder = device.device.create_command_encoder(&Default::default());
    for (_, job) in renderer.jobs(&texture.create_view(&Default::default())) {
        job(&mut encoder);
    }
    device.queue.submit([encoder.finish()]);
    read_texture(device, &texture, size, 4)
}
