//! Material: water (#166): the water's parts drawn after the geometry and the mirror's view, in
//! two steps. Each part's rest mesh, moved by its waves in the vertex stage, draws into the
//! geometry pass's multisampled object-ID and depth targets as any solid does (its depth the
//! surface's at the pixel's centre), and those resolve again; then one pass over the pixels whose
//! ID is a water part shades them: the bed behind (copies of the opaque scene's color and depth)
//! tinted by its distance below, under the mirror's picture moved along the bent normal, with foam
//! where the waves grow steep and along the wake. It keeps nothing from frame to frame, so seeking
//! equals playing.

use std::collections::BTreeMap;

use deep_canvas_scene3d::scene::{Scene, Shape};
use deep_canvas_scene3d::water::{Water, MAX_WAKE, MAX_WAVES};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;

use crate::{DEPTH, IDS_MS, LINEAR, WATER_PASS};

const SOURCE: &str = include_str!("water.wgsl");
/// The most water parts one view shades.
pub const MAX_PARTS: usize = 8;
/// The `reflection` target's format: the mirror's lookup, linear, f32 RGBA.
pub const REFLECTION: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
/// #268: the `foam` target's format: the water's foam share, f32.
pub const FOAM: wgpu::TextureFormat = wgpu::TextureFormat::R32Float;

/// The water's wrong program, reachable only through `deep-gpu --planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Foam that keeps a running value from frame to frame, as a simulation would.
    pub foam_keeps_state: bool,
    /// #268: waves that ignore the shore's field, at full amplitude by the shore.
    pub calm_ignores_shore: bool,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    clip: [[f32; 4]; 4],
    unclip: [[f32; 4]; 4],
    model: [[f32; 4]; 3],
    eye: [f32; 4],
    dirs: [[f32; 4]; MAX_WAVES],
    amps: [[f32; 4]; MAX_WAVES],
    counts: [f32; 4],
    drift: [f32; 4],
    absorption: [f32; 4],
    look: [f32; 4],
    sun: [f32; 4],
    ambient: [f32; 4],
    wake: [f32; 4],
    pick: [u32; 4],
    parts: [[u32; 4]; 2],
    // #268: the shore's field: its origin, 1 ÷ cell and reach; foam's width, strength and
    // breakup, and shade; calm's near and far, the footprint's reach and whether it's on; its
    // cells along x and z and the planted calm.
    shore: [[f32; 4]; 3],
    shore_dims: [u32; 4],
}

/// The light the water's foam and its fill read.
#[derive(Clone, Copy, Debug, Default)]
pub struct Lighting {
    /// Toward the sun, and its radiance off a white surface facing it.
    pub toward: [f64; 3],
    pub sun: f64,
    /// The sky's ambient radiance, linear.
    pub ambient: [f64; 3],
}

/// What a frame's water reads from the frame around it.
pub struct Frame<'a> {
    /// The frame's clip (column-major), its eye, and whether depth grows nearer.
    pub camera: &'a [f64; 16],
    pub reversed: bool,
    /// The targets' size.
    pub size: [u32; 2],
    /// The mirror's picture and strength, when the water reflects through one.
    pub mirror: Option<(&'a wgpu::TextureView, f64)>,
    pub picks: &'a BTreeMap<String, u32>,
    pub lighting: Lighting,
    pub planted: Planted,
}

/// The geometry pass's object IDs and depth resolved again, with the pass's timestamps.
pub type Resolve = Box<
    dyn for<'a> FnOnce(&mut wgpu::CommandEncoder, Option<wgpu::RenderPassTimestampWrites<'a>>)
        + Send,
>;

/// The targets a frame's water job draws into, and the resolve it runs again.
pub struct Targets {
    pub linear: (wgpu::Texture, wgpu::TextureView),
    pub ids_ms: wgpu::TextureView,
    pub depth_ms: wgpu::TextureView,
    pub reflection: Option<wgpu::TextureView>,
    pub foam: Option<wgpu::TextureView>,
    pub resolve: Resolve,
}

pub struct Waterer {
    layout: wgpu::BindGroupLayout,
    ids: wgpu::RenderPipeline,
    /// The shading pass by which of the `reflection` (1) and `foam` (2) targets it writes.
    shade: [wgpu::RenderPipeline; 4],
    /// The pass copying the depth target into the bed's depth, and its layout.
    bed_copy: wgpu::RenderPipeline,
    bed_layout: wgpu::BindGroupLayout,
    /// Each sample's IDs and depth, for the shading pass, and this frame's bind group of them.
    samples_layout: wgpu::BindGroupLayout,
    samples: Option<wgpu::BindGroup>,
    sampler: wgpu::Sampler,
    /// The bed: copies of the opaque scene's color and depth at the targets' size.
    bed: Option<Bed>,
    /// A 1 × 1 stand-in for the mirror's picture when the water has none.
    stub: wgpu::TextureView,
    /// #268: the shore's field uploaded, by its key, and a 1 × 1 stand-in with none.
    field: Option<(String, wgpu::TextureView)>,
    no_field: wgpu::TextureView,
    /// The rest meshes uploaded, by their shape's hash.
    meshes: BTreeMap<u64, (wgpu::Buffer, wgpu::Buffer, u32)>,
    /// The planted foam's running values.
    kept: wgpu::Buffer,
    /// This frame's parts: each one's bind group and rest mesh.
    draws: Vec<(wgpu::BindGroup, wgpu::Buffer, wgpu::Buffer, u32)>,
    /// Where on the targets the parts can draw this frame: [x, y, width, height] in px.
    rect: [u32; 4],
}

/// The px rectangle [x, y, width, height] of `size` that holds the world box `[lo, hi]` under
/// `clip` (column-major), padded by 2 px; the whole of `size` when a corner is behind the eye.
fn screen_rect(clip: &[f64; 16], [lo, hi]: [[f64; 3]; 2], size: [u32; 2]) -> [u32; 4] {
    let [w, h] = size.map(f64::from);
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0.0f64, 0.0f64);
    for c in 0..8 {
        let p = [
            if c & 1 == 0 { lo[0] } else { hi[0] },
            if c & 2 == 0 { lo[1] } else { hi[1] },
            if c & 4 == 0 { lo[2] } else { hi[2] },
            1.0,
        ];
        let q: [f64; 4] = std::array::from_fn(|r| (0..4).map(|k| clip[k * 4 + r] * p[k]).sum());
        if q[3] <= 1e-6 {
            return [0, 0, size[0], size[1]];
        }
        let (x, y) = ((q[0] / q[3] + 1.0) * 0.5 * w, (1.0 - q[1] / q[3]) * 0.5 * h);
        (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
    }
    let clamp = |v: f64, m: f64| v.clamp(0.0, m) as u32;
    let (a, b) = (clamp(x0.floor() - 2.0, w), clamp(y0.floor() - 2.0, h));
    let (c, d) = (clamp(x1.ceil() + 2.0, w), clamp(y1.ceil() + 2.0, h));
    [a, b, c.saturating_sub(a), d.saturating_sub(b)]
}

#[derive(Clone)]
struct Bed {
    size: [u32; 2],
    color: wgpu::Texture,
    color_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    /// The depth target as `bed_fs` reads it.
    source: wgpu::BindGroup,
}

/// #268: the shore's field, a cell a texel: two 16-bit values packed (shore.rs's `Field`).
const FIELD: wgpu::TextureFormat = wgpu::TextureFormat::R32Uint;

/// The bed's depth: f32 a pixel, as the depth target held it.
const BED_DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::R32Float;

/// 4 × 4 column-major f64 to f32 columns.
fn columns(m: &[f64; 16]) -> [[f32; 4]; 4] {
    std::array::from_fn(|c| std::array::from_fn(|r| m[c * 4 + r] as f32))
}

/// The inverse of a 4 × 4 column-major matrix, by cofactors in f64.
pub fn inverse(m: &[f64; 16]) -> [f64; 16] {
    let a = |r: usize, c: usize| m[c * 4 + r];
    let minor = |r: usize, c: usize| {
        let rows: Vec<usize> = (0..4).filter(|&i| i != r).collect();
        let cols: Vec<usize> = (0..4).filter(|&j| j != c).collect();
        let e = |i: usize, j: usize| a(rows[i], cols[j]);
        e(0, 0) * (e(1, 1) * e(2, 2) - e(1, 2) * e(2, 1))
            - e(0, 1) * (e(1, 0) * e(2, 2) - e(1, 2) * e(2, 0))
            + e(0, 2) * (e(1, 0) * e(2, 1) - e(1, 1) * e(2, 0))
    };
    let sign = |k: usize| if k.is_multiple_of(2) { 1.0 } else { -1.0 };
    let det: f64 = (0..4).map(|c| a(0, c) * sign(c) * minor(0, c)).sum();
    let mut inv = [0.0; 16];
    for r in 0..4 {
        for c in 0..4 {
            // inv[r][c] = cofactor[c][r] ÷ det, stored column-major.
            inv[c * 4 + r] = sign(r + c) * minor(c, r) / det;
        }
    }
    inv
}

impl Waterer {
    pub fn new(device: &Device, reversed: bool, samples: u32) -> Self {
        let d = &device.device;
        let both = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let frag = wgpu::ShaderStages::FRAGMENT;
        let entry = |binding, visibility, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty,
            count: None,
        };
        let buffer = |ty| wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let tex = |sample_type| wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        // The geometry pass's own targets, read a sample at a time (plain textures at one sample).
        let sampled = |sample_type| wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: samples > 1,
        };
        let unfiltered = wgpu::TextureSampleType::Float { filterable: false };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(WATER_PASS),
            entries: &[
                entry(0, both, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, frag, tex(unfiltered)),
                entry(2, frag, tex(unfiltered)),
                entry(
                    3,
                    frag,
                    tex(wgpu::TextureSampleType::Float { filterable: true }),
                ),
                entry(
                    4,
                    frag,
                    wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                ),
                entry(
                    5,
                    frag,
                    buffer(wgpu::BufferBindingType::Storage { read_only: true }),
                ),
                entry(
                    6,
                    frag,
                    buffer(wgpu::BufferBindingType::Storage { read_only: false }),
                ),
                entry(7, frag, tex(wgpu::TextureSampleType::Uint)),
                entry(8, frag, tex(wgpu::TextureSampleType::Depth)),
                entry(9, both, tex(wgpu::TextureSampleType::Uint)),
            ],
        });
        // Group 2, the shading pass's alone: the mesh pass writes these targets.
        let samples_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(WATER_PASS),
            entries: &[
                entry(0, frag, sampled(wgpu::TextureSampleType::Uint)),
                entry(1, frag, sampled(wgpu::TextureSampleType::Depth)),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(WATER_PASS),
            source: wgpu::ShaderSource::Wgsl(if samples == 1 {
                SOURCE
                    .replace("multisampled_2d", "2d")
                    .replace("SAMPLES: i32 = 4", "SAMPLES: i32 = 1")
                    .into()
            } else {
                SOURCE.into()
            }),
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(WATER_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let ids = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(WATER_PASS),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("mesh_vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 12,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3],
                })],
            },
            // Both faces: a wave's far slope seen from a low eye still draws.
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: Some(true),
                depth_compare: Some(if reversed {
                    wgpu::CompareFunction::GreaterEqual
                } else {
                    wgpu::CompareFunction::LessEqual
                }),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: samples,
                ..Default::default()
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("ids_fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: IDS_MS,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let shade_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(WATER_PASS),
            bind_group_layouts: &[Some(&layout), None, Some(&samples_layout)],
            immediate_size: 0,
        });
        let shade = |reflection: bool, foam: bool| {
            let target = |format| wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            };
            let targets = [
                Some(target(LINEAR)),
                reflection.then(|| target(REFLECTION)),
                foam.then(|| target(FOAM)),
            ];
            let used = if foam { 3 } else { 1 + usize::from(reflection) };
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(WATER_PASS),
                layout: Some(&shade_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("full_vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("shade_fs"),
                    compilation_options: Default::default(),
                    targets: &targets[..used],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let shade = [
            shade(false, false),
            shade(true, false),
            shade(false, true),
            shade(true, true),
        ];
        let bed_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(WATER_PASS),
            entries: &[entry(0, frag, tex(wgpu::TextureSampleType::Depth))],
        });
        let bed_copy = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(WATER_PASS),
            layout: Some(&d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(WATER_PASS),
                bind_group_layouts: &[None, Some(&bed_layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("full_vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("bed_fs"),
                compilation_options: Default::default(),
                targets: &[Some(BED_DEPTH.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some(WATER_PASS),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let stub = crate::texture2d(
            d,
            WATER_PASS,
            [1, 1],
            LINEAR,
            wgpu::TextureUsages::TEXTURE_BINDING,
        )
        .create_view(&Default::default());
        let no_field = crate::texture2d(
            d,
            WATER_PASS,
            [1, 1],
            FIELD,
            wgpu::TextureUsages::TEXTURE_BINDING,
        )
        .create_view(&Default::default());
        let kept = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(WATER_PASS),
            size: 1024 * 4,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });
        Waterer {
            layout,
            ids,
            shade,
            bed_copy,
            bed_layout,
            samples_layout,
            samples: None,
            sampler,
            bed: None,
            stub,
            field: None,
            no_field,
            meshes: BTreeMap::new(),
            kept,
            draws: Vec::new(),
            rect: [0; 4],
        }
    }

    /// This frame's draws: each water part of `scene` with its waves at t, reading the resolved
    /// `ids` and `depth` the job resolves again.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        water: &Water,
        frame: &Frame<'_>,
        ids: &wgpu::TextureView,
        depth: &wgpu::TextureView,
        [ids_ms, depth_ms]: [&wgpu::TextureView; 2],
    ) {
        let d = &device.device;
        let size = frame.size;
        if self.bed.as_ref().is_none_or(|b| b.size != size) {
            let color = crate::texture2d(
                d,
                "scene3d.water bed",
                size,
                LINEAR,
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            let bed_depth = crate::texture2d(
                d,
                "scene3d.water bed depth",
                size,
                BED_DEPTH,
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
            );
            let source = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(WATER_PASS),
                layout: &self.bed_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(depth),
                }],
            });
            self.bed = Some(Bed {
                size,
                color_view: color.create_view(&Default::default()),
                depth_view: bed_depth.create_view(&Default::default()),
                color,
                source,
            });
        }
        let Some(bed) = self.bed.clone() else {
            return;
        };
        self.samples = Some(d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(WATER_PASS),
            layout: &self.samples_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(ids_ms),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(depth_ms),
                },
            ],
        }));
        let mut dirs = [[0f32; 4]; MAX_WAVES];
        let mut amps = [[0f32; 4]; MAX_WAVES];
        for (i, w) in water.waves.iter().take(MAX_WAVES).enumerate() {
            dirs[i] = [
                w.dir[0] as f32,
                w.dir[1] as f32,
                w.k() as f32,
                w.omega() as f32,
            ];
            amps[i] = [w.amplitude as f32, w.steepness as f32, 0.0, 0.0];
        }
        let wake = water.wake.as_ref().filter(|w| w.path.len() >= 2);
        let path: Vec<[f32; 2]> = match wake {
            Some(w) => w
                .path
                .iter()
                .take(MAX_WAKE)
                .map(|p| [p[0] as f32, p[1] as f32])
                .collect(),
            None => vec![[0.0; 2]; 2],
        };
        let path_buffer = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(WATER_PASS),
            contents: bytemuck::cast_slice(&path),
            usage: wgpu::BufferUsages::STORAGE,
        });
        let (cell, slot, back) = water.rain_grid();
        let flip = 2.0 * scene.camera.centre[0] / f64::from(scene.size[0]);
        let unclip = inverse(frame.camera);
        let mut parts = [[0u32; 4]; 2];
        let ids_of: Vec<u32> = water
            .parts
            .iter()
            .filter_map(|p| frame.picks.get(p).copied())
            .take(MAX_PARTS)
            .collect();
        for (k, id) in ids_of.iter().enumerate() {
            parts[k / 4][k % 4] = *id;
        }
        let l = frame.lighting;
        // #268: the shore's field, uploaded once per key.
        let shore = water
            .shore
            .as_ref()
            .and_then(|s| Some((s, s.field.as_ref()?)));
        if let Some((_, f)) = shore {
            if self.field.as_ref().is_none_or(|(k, _)| *k != f.key) {
                let texture = d.create_texture_with_data(
                    &device.queue,
                    &wgpu::TextureDescriptor {
                        label: Some("scene3d.water shore"),
                        size: crate::extent(f.dims),
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: FIELD,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING,
                        view_formats: &[],
                    },
                    wgpu::util::TextureDataOrder::LayerMajor,
                    bytemuck::cast_slice(&f.cells),
                );
                self.field = Some((f.key.clone(), texture.create_view(&Default::default())));
            }
        }
        let field_view = match (shore, &self.field) {
            (Some(_), Some((_, v))) => v.clone(),
            _ => self.no_field.clone(),
        };
        let shore_params = shore.map_or([[0f32; 4]; 3], |(s, f)| {
            [
                [
                    f.origin[0] as f32,
                    f.origin[1] as f32,
                    (1.0 / f.cell) as f32,
                    f.reach as f32,
                ],
                [
                    s.width as f32,
                    s.strength as f32,
                    s.breakup as f32,
                    s.shade as f32,
                ],
                [s.near as f32, s.far as f32, f.cover_reach() as f32, 1.0],
            ]
        });
        let shore_dims = shore.map_or([0u32; 4], |(_, f)| {
            [
                f.dims[0],
                f.dims[1],
                u32::from(frame.planted.calm_ignores_shore),
                0,
            ]
        });
        self.draws.clear();
        // The parts' world box at rest, grown by the waves' summed amplitude: no vertex moves
        // further.
        let reach: f64 = water.waves.iter().map(|w| w.amplitude).sum();
        let mut bounds = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for solid in scene.layers.iter().flat_map(|l| &l.solids) {
            if !water.parts.contains(&solid.id) {
                continue;
            }
            let (Shape::Built(hash), Some(mesh)) = (solid.shape, &solid.mesh) else {
                continue;
            };
            let (vertices, indices, count) = self
                .meshes
                .entry(hash)
                .or_insert_with(|| {
                    let p: Vec<[f32; 3]> =
                        mesh.positions.iter().map(|q| q.map(|v| v as f32)).collect();
                    let v = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some(WATER_PASS),
                        contents: bytemuck::cast_slice(&p),
                        usage: wgpu::BufferUsages::VERTEX,
                    });
                    let i = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some(WATER_PASS),
                        contents: bytemuck::cast_slice(&mesh.indices),
                        usage: wgpu::BufferUsages::INDEX,
                    });
                    (v, i, mesh.indices.len() as u32)
                })
                .clone();
            let [lo, hi] = mesh.bounds();
            for c in 0..8 {
                let p = [
                    if c & 1 == 0 { lo[0] } else { hi[0] },
                    if c & 2 == 0 { lo[1] } else { hi[1] },
                    if c & 4 == 0 { lo[2] } else { hi[2] },
                ];
                let m = &solid.model;
                for r in 0..3 {
                    let v = m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3];
                    bounds[0][r] = bounds[0][r].min(v - reach);
                    bounds[1][r] = bounds[1][r].max(v + reach);
                }
            }
            let params = Params {
                clip: columns(frame.camera),
                unclip: columns(&unclip),
                model: solid.model.map(|r| r.map(|v| v as f32)),
                eye: [
                    scene.camera.eye[0] as f32,
                    scene.camera.eye[1] as f32,
                    scene.camera.eye[2] as f32,
                    water.t as f32,
                ],
                dirs,
                amps,
                counts: [
                    water.waves.len().min(MAX_WAVES) as f32,
                    water.ripple_scale as f32,
                    water.ripple_strength as f32,
                    back as f32,
                ],
                drift: [
                    water.drift[0] as f32,
                    water.drift[1] as f32,
                    water.rain as f32,
                    cell as f32,
                ],
                absorption: [
                    water.absorption[0] as f32,
                    water.absorption[1] as f32,
                    water.absorption[2] as f32,
                    water.depth as f32,
                ],
                look: [
                    // The frame's px at the targets' size.
                    (water.distort * f64::from(size[0]) / f64::from(scene.size[0])) as f32,
                    water.foam as f32,
                    flip as f32,
                    frame.mirror.map_or(0.0, |(_, s)| s) as f32,
                ],
                sun: [
                    l.toward[0] as f32,
                    l.toward[1] as f32,
                    l.toward[2] as f32,
                    l.sun as f32,
                ],
                ambient: [
                    l.ambient[0] as f32,
                    l.ambient[1] as f32,
                    l.ambient[2] as f32,
                    slot as f32,
                ],
                wake: [
                    wake.map_or(0.0, |_| path.len() as f32),
                    wake.map_or(0.0, |w| w.step) as f32,
                    wake.map_or(1.0, |w| w.span) as f32,
                    if frame.planted.foam_keeps_state {
                        1.0
                    } else {
                        0.0
                    },
                ],
                pick: [
                    frame.picks.get(&solid.id).copied().unwrap_or(0),
                    u32::from(frame.reversed),
                    water.seed,
                    ids_of.len() as u32,
                ],
                parts,
                shore: shore_params,
                shore_dims,
            };
            let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(WATER_PASS),
                contents: bytemuck::bytes_of(&params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let picture = frame.mirror.map_or(&self.stub, |(p, _)| p);
            let views = [
                (1, &bed.color_view),
                (2, &bed.depth_view),
                (3, picture),
                (7, ids),
                (8, depth),
                (9, &field_view),
            ];
            let mut entries: Vec<wgpu::BindGroupEntry<'_>> = views
                .iter()
                .map(|(binding, view)| wgpu::BindGroupEntry {
                    binding: *binding,
                    resource: wgpu::BindingResource::TextureView(view),
                })
                .collect();
            entries.extend([
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: path_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: self.kept.as_entire_binding(),
                },
            ]);
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(WATER_PASS),
                layout: &self.layout,
                entries: &entries,
            });
            self.draws.push((bind, vertices, indices, count));
        }
        self.rect = screen_rect(frame.camera, bounds, size);
    }

    /// Where on the targets the parts can draw this frame: [x, y, width, height] in px.
    pub fn rect(&self) -> [u32; 4] {
        self.rect
    }

    /// The bed's copies, each part into the multisampled IDs and depth, their resolve, and the
    /// shading of the water's pixels.
    pub fn job(&self, t: Targets, profiler: &Option<crate::Profiler>) -> Option<Job> {
        let bed = self.bed.clone()?;
        if self.draws.is_empty() || self.rect[2] == 0 || self.rect[3] == 0 {
            return None;
        }
        let [x, y, w, h] = self.rect;
        let draws = self.draws.clone();
        let (ids_pipeline, bed_copy, profiler) =
            (self.ids.clone(), self.bed_copy.clone(), profiler.clone());
        let shade = self.shade
            [usize::from(t.reflection.is_some()) | (2 * usize::from(t.foam.is_some()))]
        .clone();
        let samples = self.samples.clone()?;
        let extent = crate::extent([w, h]);
        let origin = wgpu::Origin3d { x, y, z: 0 };

        Some(Box::new(move |encoder| {
            let Targets {
                linear,
                ids_ms,
                depth_ms,
                reflection,
                foam,
                resolve,
            } = t;
            // The bed under the rectangle the water can cover: its color copied, its depth drawn.
            let at = |texture| wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin,
                aspect: wgpu::TextureAspect::All,
            };
            encoder.copy_texture_to_texture(at(&linear.0), at(&bed.color), extent);
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(WATER_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &bed.depth_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_scissor_rect(x, y, w, h);
                pass.set_pipeline(&bed_copy);
                pass.set_bind_group(1, &bed.source, &[]);
                pass.draw(0..3, 0..1);
            }
            let load = || wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            };
            crate::timed(&profiler, WATER_PASS, encoder, |encoder, timestamps| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(WATER_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &ids_ms,
                        resolve_target: None,
                        depth_slice: None,
                        ops: load(),
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &depth_ms,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: timestamps,
                    ..Default::default()
                });
                pass.set_pipeline(&ids_pipeline);
                for (bind, vertices, indices, count) in &draws {
                    pass.set_bind_group(0, bind, &[]);
                    pass.set_vertex_buffer(0, vertices.slice(..));
                    pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..*count, 0, 0..1);
                }
            });
            crate::timed(&profiler, WATER_PASS, encoder, resolve);
            let attach = |view| {
                Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: load(),
                })
            };
            let mut colors = vec![attach(&linear.1), reflection.as_ref().and_then(attach)];
            if let Some(f) = &foam {
                colors.push(attach(f));
            } else if reflection.is_none() {
                colors.pop();
            }
            crate::timed(&profiler, WATER_PASS, encoder, |encoder, timestamps| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(WATER_PASS),
                    color_attachments: &colors,
                    timestamp_writes: timestamps,
                    ..Default::default()
                });
                pass.set_scissor_rect(x, y, w, h);
                pass.set_pipeline(&shade);
                pass.set_bind_group(0, &draws[0].0, &[]);
                pass.set_bind_group(2, &samples, &[]);
                pass.draw(0..3, 0..1);
            });
        }))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::tests::{orbiting_camera, played, stamped};

    /// Canvas primitives, Frame budget: the water's parts bind what the first frame made. Its
    /// uniform, its path and its bind groups hold while the targets they bind do.
    #[test]
    fn a_frame_after_the_first_makes_no_buffer_and_no_bind_group() {
        let (cam, channels) = orbiting_camera();
        let doc = stamped(
            &[
                ("cam", cam),
                (
                    "sky",
                    json!({"kind": "sky@1", "params": {"top": [0.15, 0.3, 0.75, 1], "low": [0.45, 0.6, 0.85, 1], "ambient_top": [0.25, 0.25, 0.25], "ambient_low": [0.1, 0.1, 0.1]}}),
                ),
                (
                    "sun",
                    json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}}),
                ),
                (
                    "lake_mat",
                    json!({"kind": "material@1", "params": {"base_color": [0.1, 0.3, 0.4, 1], "roughness": 0.05, "water": {}}}),
                ),
                (
                    "box_mat",
                    json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}}),
                ),
                (
                    "lake",
                    json!({"kind": "plate@1", "params": {"grid": [16, 16], "size": [40, 40]}, "at": {"pos": [0, 0, 0]}, "material": "lake_mat"}),
                ),
                (
                    "box",
                    json!({"kind": "mark.box@1", "params": {"size": [0.7, 0.7, 0.7]}, "at": {"pos": [3, 0.35, 0]}, "material": "box_mat"}),
                ),
            ],
            channels,
        );
        let frames = played(&doc, None, |_, scene| {
            assert!(scene.water.is_some(), "the lake is water");
        });
        for (n, made) in frames.iter().enumerate() {
            assert_eq!(
                (made.buffers, made.bind_groups),
                (0, 0),
                "frame {}: buffers and bind groups made",
                n + 1
            );
        }
    }
}
