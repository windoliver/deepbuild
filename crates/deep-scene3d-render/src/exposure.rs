//! #2513: render.exposure's measure (canvas primitives: Check input: loop kinds) as one reduction
//! on the GPU that drew the frame, over its pre-tone image and object-ID pass: the subject's px
//! stay on the GPU, and a few KB of sums cross to the CPU.

use deep_canvas::registry::{LightQuery, LightSums};
use deep_gpu::device::Device;

use crate::{read_back, IDS, LINEAR};

const SOURCE: &str = include_str!("exposure.wgsl");
pub const EXPOSURE_PASS: &str = "scene3d.exposure";
/// Threads in a workgroup, and the most workgroups a reduction runs: each writes 20 bytes, so a
/// reduction reads back at most 2.5 KB.
const GROUP: u32 = 256;
const GROUPS: u32 = 128;
/// The sum of log2 is counted in steps of 2^-24.
const STEPS: f64 = 16_777_216.0;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    size: [u32; 2],
    every: u32,
    words: u32,
    exposure: f32,
    white: f32,
    black: f32,
    floor: f32,
    weights: [f32; 4],
}

/// The reduction's pipeline, built once per device.
pub struct Reducer {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
}

impl Reducer {
    pub fn new(device: &Device) -> Reducer {
        let d = &device.device;
        let compute = wgpu::ShaderStages::COMPUTE;
        let texture = |binding, sample_type| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: compute,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let buffer = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: compute,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(EXPOSURE_PASS),
            entries: &[
                texture(0, wgpu::TextureSampleType::Float { filterable: false }),
                texture(1, wgpu::TextureSampleType::Uint),
                buffer(2, wgpu::BufferBindingType::Uniform),
                buffer(3, wgpu::BufferBindingType::Storage { read_only: true }),
                buffer(4, wgpu::BufferBindingType::Storage { read_only: false }),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(EXPOSURE_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(EXPOSURE_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(EXPOSURE_PASS),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("reduce"),
            compilation_options: Default::default(),
            cache: None,
        });
        Reducer { layout, pipeline }
    }

    /// `q` over the first `size` px of `pre_tone` (linear RGBA before exposure) and `ids` (each
    /// px's pick), rows top-down, in f32 with the log2 summed exactly; `None` where the device
    /// reads nothing back.
    pub fn reduce(
        &self,
        device: &Device,
        pre_tone: &wgpu::TextureView,
        ids: &wgpu::TextureView,
        size: [u32; 2],
        q: &LightQuery,
    ) -> Option<LightSums> {
        let d = &device.device;
        let mut bits = vec![
            0u32;
            q.picks
                .as_ref()
                .and_then(|p| p.last())
                .map_or(1, |m| m / 32 + 1) as usize
        ];
        for p in q.picks.iter().flatten() {
            bits[(p / 32) as usize] |= 1 << (p % 32);
        }
        let w = |v: f64| v as f32;
        let params = Params {
            size,
            every: u32::from(q.picks.is_none()),
            words: bits.len() as u32,
            exposure: w(q.exposure),
            white: w(q.white),
            black: w(q.black),
            floor: w(q.floor),
            weights: [w(q.weights[0]), w(q.weights[1]), w(q.weights[2]), 0.0],
        };
        let init = |contents: &[u8], usage| {
            d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(EXPOSURE_PASS),
                contents,
                usage,
            })
        };
        let uniform = init(bytemuck::bytes_of(&params), wgpu::BufferUsages::UNIFORM);
        let picks = init(bytemuck::cast_slice(&bits), wgpu::BufferUsages::STORAGE);
        let groups = (size[0] * size[1]).div_ceil(GROUP).clamp(1, GROUPS);
        let bytes = u64::from(groups) * 20;
        let partials = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(EXPOSURE_PASS),
            size: bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(EXPOSURE_PASS),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(pre_tone),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(ids),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: picks.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: partials.as_entire_binding(),
                },
            ],
        });
        let out = read_back(device, EXPOSURE_PASS, bytes, |encoder, staging| {
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(EXPOSURE_PASS),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.dispatch_workgroups(groups, 1, 1);
            }
            encoder.copy_buffer_to_buffer(&partials, 0, staging, 0, bytes);
        })?;
        let mut s = LightSums::default();
        let mut steps = 0i64;
        for p in out.as_chunks::<20>().0 {
            let word = |k: usize| u32::from_le_bytes([p[k], p[k + 1], p[k + 2], p[k + 3]]);
            s.px += u64::from(word(0));
            s.over += u64::from(word(4));
            s.under += u64::from(word(8));
            steps += (i64::from(word(16) as i32) << 32) + i64::from(word(12));
        }
        s.log2 = steps as f64 / STEPS;
        Some(s)
    }
}

/// A frame's pre-tone image and object-ID pass copied on the GPU, so it can be reduced after
/// later frames draw over the targets.
pub struct Kept {
    pre_tone: wgpu::TextureView,
    ids: wgpu::TextureView,
    pub size: [u32; 2],
}

impl Kept {
    /// Copies of `pre_tone` and `ids`, each `size` px.
    pub fn copy(
        device: &Device,
        pre_tone: &wgpu::TextureView,
        ids: &wgpu::TextureView,
        size: [u32; 2],
    ) -> Kept {
        let d = &device.device;
        let mut encoder = d.create_command_encoder(&Default::default());
        let mut copy = |from: &wgpu::TextureView, format| {
            let to = crate::texture2d(
                d,
                EXPOSURE_PASS,
                size,
                format,
                wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            );
            encoder.copy_texture_to_texture(
                from.texture().as_image_copy(),
                to.as_image_copy(),
                crate::extent(size),
            );
            to.create_view(&Default::default())
        };
        let (pre_tone, ids) = (copy(pre_tone, LINEAR), copy(ids, IDS));
        device.queue.submit([encoder.finish()]);
        Kept {
            pre_tone,
            ids,
            size,
        }
    }

    /// `q` over the first `size` px of the copies, as [`Reducer::reduce`] reads them.
    pub fn reduce(
        &self,
        device: &Device,
        reducer: &Reducer,
        size: [u32; 2],
        q: &LightQuery,
    ) -> Option<LightSums> {
        reducer.reduce(device, &self.pre_tone, &self.ids, size, q)
    }
}
