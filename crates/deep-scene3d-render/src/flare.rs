//! Effect: flare (#465): the frame's flare added into the linear image the output reads, before
//! tone mapping and before status colors. A reduction measures each source's disc against the
//! frame's depth (the share the frame shows unoccluded), then one pass draws every source's halo,
//! streaks, starburst and ghosts scaled by that share and by its fade disc's share inside the
//! frame. It reads nothing from an earlier frame, so seeking equals playing.

use deep_canvas_scene3d::flare::{Flare, Source, MAX_SOURCES};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use wgpu::util::DeviceExt;

use crate::{FLARE_PASS, LINEAR};

const SOURCE: &str = include_str!("flare.wgsl");
/// The components a source draws as quads: the halo, six arms, 32 spikes and eight ghosts.
const PER_SOURCE: u32 = 47;

/// The flare's wrong programs, each reachable only through `deep-gpu --planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Each ghost at a fixed place in the frame, whatever its light.
    pub fixed_ghosts: bool,
    /// The flare built as if nothing covered its light's disc.
    pub ignores_occlusion: bool,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    frame: [f32; 4],
    streak: [f32; 4],
    halo: [f32; 4],
    emissive: [f32; 4],
    tint: [f32; 4],
    sources: [[f32; 8]; MAX_SOURCES],
}

pub struct Flarer {
    count_layout: wgpu::BindGroupLayout,
    draw_layout: wgpu::BindGroupLayout,
    count: wgpu::ComputePipeline,
    draw: wgpu::RenderPipeline,
    shares: wgpu::Buffer,
    /// From emissive pixels: the reduction's layout, its two steps, each tile's sums, and the
    /// sources it finds.
    emit_layout: wgpu::BindGroupLayout,
    emitted: wgpu::ComputePipeline,
    pick: wgpu::ComputePipeline,
    tiles: wgpu::Buffer,
    found: wgpu::Buffer,
    /// This frame's parameters, how many sources, and whether they're emissive pixels.
    params: Option<(wgpu::Buffer, u32, bool)>,
}

impl Flarer {
    pub fn new(device: &Device) -> Self {
        let d = &device.device;
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
        let storage = |binding, visibility, read_only| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let compute = wgpu::ShaderStages::COMPUTE;
        let count_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(FLARE_PASS),
            entries: &[
                uniform(0, compute),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: compute,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                storage(2, compute, false),
            ],
        });
        let draw_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(FLARE_PASS),
            entries: &[
                uniform(0, wgpu::ShaderStages::VERTEX_FRAGMENT),
                storage(3, wgpu::ShaderStages::VERTEX_FRAGMENT, true),
                storage(7, wgpu::ShaderStages::VERTEX_FRAGMENT, true),
            ],
        });
        let emit_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(FLARE_PASS),
            entries: &[
                uniform(0, compute),
                storage(4, compute, false),
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
                    visibility: compute,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                storage(6, compute, false),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(FLARE_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let layout = |l: &wgpu::BindGroupLayout| {
            d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(FLARE_PASS),
                bind_group_layouts: &[Some(l)],
                immediate_size: 0,
            })
        };
        let count = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(FLARE_PASS),
            layout: Some(&layout(&count_layout)),
            module: &module,
            entry_point: Some("visible"),
            compilation_options: Default::default(),
            cache: None,
        });
        let step = |entry: &str| {
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(FLARE_PASS),
                layout: Some(&layout(&emit_layout)),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let (emitted, pick) = (step("emitted"), step("pick"));
        let buffer = |size: usize| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(FLARE_PASS),
                size: size as u64,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            })
        };
        // 144 tiles of two vec4s; 16 sources of two vec4s.
        let (tiles, found) = (buffer(144 * 32), buffer(MAX_SOURCES * 32));
        let add = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        };
        let draw = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(FLARE_PASS),
            layout: Some(&layout(&draw_layout)),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LINEAR,
                    blend: Some(wgpu::BlendState {
                        color: add,
                        alpha: add,
                    }),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let shares = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(FLARE_PASS),
            size: (2 * MAX_SOURCES * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Flarer {
            count_layout,
            draw_layout,
            count,
            draw,
            shares,
            emit_layout,
            emitted,
            pick,
            tiles,
            found,
            params: None,
        }
    }

    /// This frame's sources: `depth(p)` gives a world point's depth as the depth target stores
    /// it, and `grows_nearer` its sense. With `from: emissive` the GPU finds the sources, and
    /// `exposure` scales their light.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        device: &Device,
        flare: &Flare,
        sources: &[Source],
        size: [u32; 2],
        depth: impl Fn([f64; 3]) -> f64,
        grows_nearer: bool,
        planted: Planted,
        exposure: f64,
    ) {
        let emissive = flare.emissive.is_some();
        let n = if emissive {
            MAX_SOURCES
        } else {
            sources.len().min(MAX_SOURCES)
        };
        if n == 0 {
            self.params = None;
            return;
        }
        let far = if grows_nearer { 0.0 } else { 1.0 };
        let mut rows = [[0f32; 8]; MAX_SOURCES];
        for (row, s) in rows.iter_mut().zip(sources) {
            let z = s.point.map_or(far, &depth);
            *row = [
                s.at[0] as f32,
                s.at[1] as f32,
                s.radius as f32,
                z as f32,
                s.color[0] as f32,
                s.color[1] as f32,
                s.color[2] as f32,
                s.inside as f32,
            ];
        }
        let w = f64::from(size[0]);
        let spikes = if flare.blades.is_multiple_of(2) {
            flare.blades
        } else {
            2 * flare.blades
        };
        let flag = |b: bool| if b { 1.0 } else { 0.0 };
        let params = Params {
            frame: [
                size[0] as f32,
                size[1] as f32,
                n as f32,
                flare.ghosts as f32,
            ],
            streak: [
                flare.streaks as f32,
                (flare.length * w) as f32,
                flag(flare.anamorphic),
                spikes as f32,
            ],
            halo: [
                (flare.halo * w) as f32,
                flag(grows_nearer),
                flag(planted.ignores_occlusion),
                flag(planted.fixed_ghosts),
            ],
            emissive: [
                flare.emissive.unwrap_or(0.0) as f32,
                flag(emissive),
                (exposure * flare.intensity * deep_canvas_scene3d::flare::GAIN) as f32,
                0.0,
            ],
            tint: [
                flare.tint[0] as f32,
                flare.tint[1] as f32,
                flare.tint[2] as f32,
                0.0,
            ],
            sources: rows,
        };
        let buffer = device
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(FLARE_PASS),
                contents: bytemuck::bytes_of(&params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        self.params = Some((buffer, n as u32, emissive));
    }

    /// The reduction over `depth` and the pass adding the flare into `into`.
    pub fn job(
        &self,
        device: &Device,
        depth: &wgpu::TextureView,
        into: &wgpu::TextureView,
        profiler: &Option<crate::Profiler>,
    ) -> Option<Job> {
        let (params, n, emissive) = self.params.as_ref()?;
        let d = &device.device;
        let count_bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(FLARE_PASS),
            layout: &self.count_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(depth),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.shares.as_entire_binding(),
                },
            ],
        });
        let draw_bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(FLARE_PASS),
            layout: &self.draw_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: self.shares.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: self.found.as_entire_binding(),
                },
            ],
        });
        let emit = emissive.then(|| {
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(FLARE_PASS),
                layout: &self.emit_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: params.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: self.found.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 5,
                        resource: wgpu::BindingResource::TextureView(into),
                    },
                    wgpu::BindGroupEntry {
                        binding: 6,
                        resource: self.tiles.as_entire_binding(),
                    },
                ],
            });
            (self.emitted.clone(), self.pick.clone(), bind)
        });
        let (count, draw, shares, into, n) = (
            self.count.clone(),
            self.draw.clone(),
            self.shares.clone(),
            into.clone(),
            *n,
        );
        let profiler = profiler.clone();
        Some(Box::new(move |encoder| {
            encoder.clear_buffer(&shares, 0, None);
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(FLARE_PASS),
                    timestamp_writes: None,
                });
                match &emit {
                    // Emissive pixels show as the frame does, so no share is counted: each is 1.
                    Some((emitted, pick, bind)) => {
                        pass.set_bind_group(0, bind, &[]);
                        pass.set_pipeline(emitted);
                        pass.dispatch_workgroups(16, 9, 1);
                        pass.set_pipeline(pick);
                        pass.dispatch_workgroups(1, 1, 1);
                    }
                    None => {
                        pass.set_pipeline(&count);
                        pass.set_bind_group(0, &count_bind, &[]);
                        pass.dispatch_workgroups(n, 1, 1);
                    }
                }
            }
            crate::timed(&profiler, FLARE_PASS, encoder, |encoder, timestamps| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(FLARE_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &into,
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
                pass.set_pipeline(&draw);
                pass.set_bind_group(0, &draw_bind, &[]);
                // Each source's components, one quad each (flare.wgsl: PER_SOURCE).
                pass.draw(0..6, 0..n * PER_SOURCE);
            });
        }))
    }
}
