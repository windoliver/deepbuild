//! One checked operator on wgpu: its pipeline, built from the core's WGSL once per key with the
//! runtime checks on, and its bind groups, laid out as the emitter fixed them (group 0 the frame,
//! group 1 its inputs: the uniform, the core's one sampler, each texture, then each storage input
//! and output, in order).

use std::collections::BTreeMap;

use deep_canvas_effects::graph::{From, Kind, Sc, Tex, Ty};
use deep_canvas_effects::interp::Val;

use crate::compile::Compiled;

/// Every effects-chain and bloom target: linear, before tone mapping.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// What the frame uniform holds (`emit::FRAME`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Frame {
    /// Column-major.
    pub clip: [f32; 16],
    pub inverse_clip: [f32; 16],
    pub eye: [f32; 4],
    pub t: f32,
    pub seed: u32,
}

impl Frame {
    fn bytes(&self, size: [u32; 2]) -> Vec<u8> {
        let mut b = Vec::with_capacity(192);
        for v in self.clip.iter().chain(&self.inverse_clip).chain(&self.eye) {
            b.extend_from_slice(&v.to_le_bytes());
        }
        let (w, h) = (size[0] as f32, size[1] as f32);
        for v in [w, h, 1.0 / w, 1.0 / h, self.t, 0.0, 0.0, 0.0] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        for v in [self.seed, 0, 0, 0] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        b
    }
}

/// The inputs' uniform as the emitter laid it out: a leading unused vec4, then each value input
/// in name order in whole vec4 slots (an array a slot per element, a matrix four).
pub fn input_bytes(c: &Compiled, values: &BTreeMap<String, Val>) -> Vec<u8> {
    let mut b = vec![0u8; 16];
    let word = |sc: Sc, x: f64| -> [u8; 4] {
        match sc {
            Sc::F32 => (x as f32).to_le_bytes(),
            Sc::I32 => (x as i32).to_le_bytes(),
            Sc::U32 | Sc::Bool => (x as u32).to_le_bytes(),
        }
    };
    for (name, input) in &c.checked.op.inputs {
        if matches!(input.ty, Ty::Tex(_) | Ty::Storage(..))
            || matches!(input.from, From::Time | From::Seed)
        {
            continue;
        }
        let v = values.get(name);
        match &input.ty {
            Ty::V(sc, _) => {
                let lanes = match v {
                    Some(Val::N(_, l)) => l.clone(),
                    _ => Vec::new(),
                };
                for i in 0..4 {
                    b.extend_from_slice(&word(*sc, lanes.get(i).copied().unwrap_or(0.0)));
                }
            }
            Ty::Arr(sc, _, n) => {
                let items = match v {
                    Some(Val::A(_, items)) => items.clone(),
                    _ => Vec::new(),
                };
                for k in 0..*n as usize {
                    for i in 0..4 {
                        let x = items.get(k).and_then(|e| e.get(i)).copied().unwrap_or(0.0);
                        b.extend_from_slice(&word(*sc, x));
                    }
                }
            }
            Ty::Mat(n) => {
                let m = match v {
                    Some(Val::M(_, m)) => m.clone(),
                    _ => Vec::new(),
                };
                let n = *n as usize;
                for c in 0..4 {
                    for r in 0..4 {
                        let x = if c < n && r < n {
                            m.get(c * n + r).copied().unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        b.extend_from_slice(&(x as f32).to_le_bytes());
                    }
                }
            }
            _ => {}
        }
    }
    b
}

enum Pipeline {
    Render(wgpu::RenderPipeline),
    Compute(wgpu::ComputePipeline),
}

/// A checked operator's pipeline and layouts on one device: a pass's render pipeline, or a
/// compute operator's.
pub struct Runner {
    pub compiled: Compiled,
    pipeline: Pipeline,
    frame_layout: wgpu::BindGroupLayout,
    input_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

fn entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty,
        count: None,
    }
}

fn uniform() -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Uniform,
        has_dynamic_offset: false,
        min_binding_size: None,
    }
}

impl Runner {
    pub fn new(device: &wgpu::Device, compiled: Compiled, format: wgpu::TextureFormat) -> Runner {
        let c = &compiled.checked;
        let stage = match compiled.kind() {
            Kind::Compute => wgpu::ShaderStages::COMPUTE,
            _ => wgpu::ShaderStages::FRAGMENT,
        };
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(&c.op.id),
            source: wgpu::ShaderSource::Wgsl(compiled.wgsl.clone().into()),
        });
        let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("operator frame"),
            entries: &[entry(0, stage, uniform())],
        });
        let mut entries = vec![
            entry(0, stage, uniform()),
            entry(
                1,
                stage,
                wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            ),
        ];
        let textures = c.textures.iter().map(|name| {
            let sample_type = match c.op.inputs[name].ty {
                Ty::Tex(Tex::Uint) => wgpu::TextureSampleType::Uint,
                Ty::Tex(Tex::Depth) => wgpu::TextureSampleType::Depth,
                _ => wgpu::TextureSampleType::Float { filterable: true },
            };
            wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            }
        });
        let storage = |read_only| wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let buffers = (c.storage_inputs.iter().map(|_| storage(true)))
            .chain(c.op.storage.iter().map(|_| storage(false)));
        entries.extend(
            textures
                .chain(buffers)
                .zip(2..)
                .map(|(ty, b)| entry(b, stage, ty)),
        );
        let input_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("operator inputs"),
            entries: &entries,
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(&c.op.id),
            bind_group_layouts: &[Some(&frame_layout), Some(&input_layout)],
            immediate_size: 0,
        });
        // wgpu's runtime checks stay on: bounds checks, forced loop bounding and integer-division
        // guards.
        let pipeline = match compiled.kind() {
            Kind::Compute => Pipeline::Compute(device.create_compute_pipeline(
                &wgpu::ComputePipelineDescriptor {
                    label: Some(&c.op.id),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some("cs"),
                    compilation_options: Default::default(),
                    cache: None,
                },
            )),
            _ => Pipeline::Render(
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(&c.op.id),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState {
                        module: &module,
                        entry_point: Some("vs"),
                        compilation_options: Default::default(),
                        buffers: &[],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &module,
                        entry_point: Some("fs"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                }),
            ),
        };
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("operator sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Runner {
            compiled,
            pipeline,
            frame_layout,
            input_layout,
            sampler,
        }
    }

    /// The bind groups for one run: the frame at the output's `size`, the inputs' values, a view
    /// for each texture input and a buffer for each storage input and output, in binding order.
    pub fn bind(
        &self,
        device: &wgpu::Device,
        frame: &Frame,
        size: [u32; 2],
        values: &BTreeMap<String, Val>,
        textures: &[&wgpu::TextureView],
        storage: &[&wgpu::Buffer],
    ) -> (wgpu::BindGroup, wgpu::BindGroup, [wgpu::Buffer; 2]) {
        use wgpu::util::DeviceExt as _;
        let fb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("operator frame"),
            contents: &frame.bytes(size),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let ib = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("operator inputs"),
            contents: &input_bytes(&self.compiled, values),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let g0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("operator frame"),
            layout: &self.frame_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: fb.as_entire_binding(),
            }],
        });
        let mut entries = vec![
            wgpu::BindGroupEntry {
                binding: 0,
                resource: ib.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            },
        ];
        let resources = (textures
            .iter()
            .map(|v| wgpu::BindingResource::TextureView(v)))
        .chain(storage.iter().map(|b| b.as_entire_binding()));
        entries.extend(
            resources
                .zip(2..)
                .map(|(resource, binding)| wgpu::BindGroupEntry { binding, resource }),
        );
        let g1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("operator inputs"),
            layout: &self.input_layout,
            entries: &entries,
        });
        (g0, g1, [fb, ib])
    }

    /// Records the pass into `target`.
    pub fn encode(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        groups: &(wgpu::BindGroup, wgpu::BindGroup),
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let Pipeline::Render(pipeline) = &self.pipeline else {
            unreachable!("a pass operator encodes a render pass")
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(&self.compiled.checked.op.id),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: timestamps,
            ..Default::default()
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &groups.0, &[]);
        pass.set_bind_group(1, &groups.1, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Records the compute operator's dispatch over `elements`.
    pub fn dispatch(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        elements: u32,
        groups: &(wgpu::BindGroup, wgpu::BindGroup),
        timestamps: Option<wgpu::ComputePassTimestampWrites<'_>>,
    ) {
        let Pipeline::Compute(pipeline) = &self.pipeline else {
            unreachable!("a compute operator dispatches")
        };
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some(&self.compiled.checked.op.id),
            timestamp_writes: timestamps,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &groups.0, &[]);
        pass.set_bind_group(1, &groups.1, &[]);
        pass.dispatch_workgroups(
            elements.div_ceil(self.compiled.checked.op.workgroup).max(1),
            1,
            1,
        );
    }
}
