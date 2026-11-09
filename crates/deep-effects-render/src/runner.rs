//! One checked operator on wgpu: its pipeline, built from the core's WGSL once per key with the
//! runtime checks on, and its bind groups, laid out as the emitter fixed them (group 0 the frame,
//! group 1 its inputs: the uniform, the core's one sampler, each texture, then each storage input
//! and output, in order).

use std::collections::BTreeMap;

use deep_canvas_effects::graph::{Kind, Tex, Ty};
use deep_canvas_effects::interp::Val;

use crate::compile::Compiled;

/// Every effects-chain and bloom target: linear, before tone mapping.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// A compute texture output's format (Operator output: `texture`).
pub fn texture_format(name: &str) -> wgpu::TextureFormat {
    match name {
        "r32uint" => wgpu::TextureFormat::R32Uint,
        "r32float" => wgpu::TextureFormat::R32Float,
        "rgba16float" => wgpu::TextureFormat::Rgba16Float,
        _ => wgpu::TextureFormat::Rgba8Unorm,
    }
}

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

/// The inputs' uniform as the emitter laid it out ([`deep_canvas_effects::emit::input_bytes`]).
pub fn input_bytes(c: &Compiled, values: &BTreeMap<String, Val>) -> Vec<u8> {
    deep_canvas_effects::emit::input_bytes(&c.checked, values)
}

/// Whether every step that reads the texture input `name`, in any body, loads it at a texel and
/// none samples it (#432).
pub fn only_loaded(c: &deep_canvas_effects::check::Checked, name: &str) -> bool {
    use deep_canvas_effects::graph::{Arg, Step};
    fn reads(steps: &BTreeMap<String, Step>, name: &str) -> bool {
        steps.values().all(|s| {
            let names = s.args.values().any(|a| matches!(a, Arg::Ref(r, _) if r == name))
                || s.fields.get("tex").and_then(|v| v.as_str()) == Some(name);
            (!names || s.op == "load@1") && s.body.as_ref().is_none_or(|b| reads(&b.steps, name))
        })
    }
    reads(&c.op.steps, name)
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
            let ty = &c.op.inputs[name].ty;
            let sample_type = match ty {
                Ty::Tex(Tex::Uint) | Ty::Tex3(Tex::Uint) => wgpu::TextureSampleType::Uint,
                Ty::Tex(Tex::Depth) => wgpu::TextureSampleType::Depth,
                // A 3D texture is read by its texels' loads (sample3d), so r32float binds too.
                Ty::Tex3(_) => wgpu::TextureSampleType::Float { filterable: false },
                // An input the operator only loads, never samples, binds unfiltered, so a
                // full-precision intermediate can feed it (#432).
                _ => wgpu::TextureSampleType::Float { filterable: !only_loaded(c, name) },
            };
            wgpu::BindingType::Texture {
                sample_type,
                view_dimension: if matches!(ty, Ty::Tex3(_)) {
                    wgpu::TextureViewDimension::D3
                } else {
                    wgpu::TextureViewDimension::D2
                },
                multisampled: false,
            }
        });
        let storage = |read_only| wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let buffers = (c.storage_inputs.iter().map(|_| storage(true)))
            .chain(c.op.storage.iter().map(|_| storage(false)))
            .chain(c.op.textures.values().map(|t| wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format: texture_format(&t.format),
                view_dimension: if t.dim3 {
                    wgpu::TextureViewDimension::D3
                } else {
                    wgpu::TextureViewDimension::D2
                },
            }));
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
            // Trilinear between a compute texture's mips (#483); one level reads as before.
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
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
        self.bind_with(device, frame, size, values, textures, storage, &[])
    }

    /// [`Runner::bind`] with a view for each texture output after the storage, in order.
    #[allow(clippy::too_many_arguments)]
    pub fn bind_with(
        &self,
        device: &wgpu::Device,
        frame: &Frame,
        size: [u32; 2],
        values: &BTreeMap<String, Val>,
        textures: &[&wgpu::TextureView],
        storage: &[&wgpu::Buffer],
        outs: &[&wgpu::TextureView],
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
        .chain(storage.iter().map(|b| b.as_entire_binding()))
        .chain(outs.iter().map(|v| wgpu::BindingResource::TextureView(v)));
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
        self.encode_within(encoder, target, groups, timestamps, None);
    }

    /// [`Runner::encode`] within `scissor`, `[x, y, w, h]` in the target's px.
    pub fn encode_within(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        groups: &(wgpu::BindGroup, wgpu::BindGroup),
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
        scissor: Option<[u32; 4]>,
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
        if let Some([x, y, w, h]) = scissor {
            pass.set_scissor_rect(x, y, w, h);
        }
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

    /// An indirect dispatch (#484): the workgroups come from `args`, which the GPU wrote.
    pub fn dispatch_indirect(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        args: &wgpu::Buffer,
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
        pass.dispatch_workgroups_indirect(args, 0);
    }
}

/// Runs a checked compute operator on the GPU over `inputs` (one buffer of words each, in its
/// storage inputs' order) and reads back its first storage output.
pub fn dispatch(device: &deep_gpu::device::Device, c: &Compiled, inputs: &[Vec<u32>]) -> Vec<u32> {
    use wgpu::util::DeviceExt as _;
    let d = &device.device;
    let runner = Runner::new(d, c.clone(), LINEAR);
    let ins: Vec<wgpu::Buffer> = inputs
        .iter()
        .map(|w| {
            let bytes: Vec<u8> = w.iter().flat_map(|x| x.to_le_bytes()).collect();
            d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("op input"),
                contents: &bytes,
                usage: wgpu::BufferUsages::STORAGE,
            })
        })
        .collect();
    let n = c
        .checked
        .op
        .storage
        .values()
        .next()
        .map_or(1, |s| s.count.max(1));
    let out = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("op output"),
        size: u64::from(n) * 4,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("op read back"),
        size: u64::from(n) * 4,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut bufs: Vec<&wgpu::Buffer> = ins.iter().collect();
    bufs.push(&out);
    let values =
        deep_canvas_effects::interp::inputs(&c.checked, &BTreeMap::new(), &BTreeMap::new());
    let (g0, g1, _b) = runner.bind(d, &Frame::default(), [1, 1], &values, &[], &bufs);
    let mut enc = d.create_command_encoder(&Default::default());
    runner.dispatch(&mut enc, c.checked.op.elements, &(g0, g1), None);
    enc.copy_buffer_to_buffer(&out, 0, &back, 0, u64::from(n) * 4);
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let words = back
        .slice(..)
        .get_mapped_range()
        .map(|v| {
            v.as_chunks::<4>()
                .0
                .iter()
                .map(|b| u32::from_le_bytes(*b))
                .collect()
        })
        .unwrap_or_default();
    back.unmap();
    words
}
