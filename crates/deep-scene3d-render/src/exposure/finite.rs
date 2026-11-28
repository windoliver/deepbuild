
use deep_gpu::device::Device;

use crate::read_back;

const SOURCE: &str = include_str!("finite.wgsl");
pub const FINITE_PASS: &str = "scene3d.finite";
const GROUP: u32 = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Found {
    pub count: u32,
    pub pick: Option<u32>,
    pub gpu_ms: Option<f64>,
}

pub struct Counter {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
}

impl Counter {
    pub fn new(device: &Device) -> Counter {
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
            label: Some(FINITE_PASS),
            entries: &[
                texture(0, wgpu::TextureSampleType::Float { filterable: false }),
                texture(1, wgpu::TextureSampleType::Uint),
                buffer(2, wgpu::BufferBindingType::Uniform),
                buffer(3, wgpu::BufferBindingType::Storage { read_only: false }),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(FINITE_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(FINITE_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(FINITE_PASS),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("count"),
            compilation_options: Default::default(),
            cache: None,
        });
        Counter { layout, pipeline }
    }

    pub fn count(
        &self,
        device: &Device,
        image: &wgpu::TextureView,
        ids: &wgpu::TextureView,
        size: [u32; 2],
        last_writer: Option<u32>,
    ) -> Option<Found> {
        let d = &device.device;
        let init = |contents: &[u8], usage| {
            d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(FINITE_PASS),
                contents,
                usage,
            })
        };
        let params: [u32; 4] = [
            size[0],
            size[1],
            u32::from(last_writer.is_some()),
            last_writer.unwrap_or(0) % size[0].max(1),
        ];
        let uniform = init(bytemuck::cast_slice(&params), wgpu::BufferUsages::UNIFORM);
        let found = init(
            bytemuck::cast_slice(&[0u32, u32::MAX]),
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        );
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(FINITE_PASS),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(image),
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
                    resource: found.as_entire_binding(),
                },
            ],
        });
        let period = device
            .timestamps
            .period_ns
            .filter(|_| device.timestamps.query);
        let stamps = period.map(|_| {
            let set = d.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some(FINITE_PASS),
                ty: wgpu::QueryType::Timestamp,
                count: 2,
            });
            let resolve = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(FINITE_PASS),
                size: 16,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            (set, resolve)
        });
        let total = 8 + if stamps.is_some() { 16 } else { 0 };
        let out = read_back(device, FINITE_PASS, total, |encoder, staging| {
            {
                deep_gpu::counted::compute_pass();
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(FINITE_PASS),
                    timestamp_writes: stamps.as_ref().map(|(set, _)| {
                        wgpu::ComputePassTimestampWrites {
                            query_set: set,
                            beginning_of_pass_write_index: Some(0),
                            end_of_pass_write_index: Some(1),
                        }
                    }),
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.dispatch_workgroups(size[0].div_ceil(GROUP), size[1].div_ceil(GROUP), 1);
            }
            encoder.copy_buffer_to_buffer(&found, 0, staging, 0, 8);
            if let Some((set, resolve)) = &stamps {
                encoder.resolve_query_set(set, 0..2, resolve, 0);
                encoder.copy_buffer_to_buffer(resolve, 0, staging, 8, 16);
            }
        })?;
        let word = |k: usize| u32::from_le_bytes(std::array::from_fn(|j| out[4 * k + j]));
        let tick = |k: usize| u64::from_le_bytes(std::array::from_fn(|j| out[8 + 8 * k + j]));
        let count = word(0);
        let pick = word(1);
        Some(Found {
            count,
            pick: (count > 0 && pick != u32::MAX).then_some(pick),
            gpu_ms: period.map(|ns| tick(1).saturating_sub(tick(0)) as f64 * f64::from(ns) / 1e6),
        })
    }
}
