//! Ambient occlusion (issue #418; canvas primitives: Look `look@1`: ao): a depth and normal
//! prepass of the opaque solids, drawn only while the look has ao on, then the occlusion and one
//! edge-aware blur at half or full size (ao.wgsl). The mesh shader reads the result through its
//! group 2 and scales only its ambient term. Nothing here keeps history: every frame draws all
//! three passes again from that frame's depth alone.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::light::Contact;
use deep_canvas_scene3d::look::Ao;
use deep_gpu::device::Device;

use crate::{bind_group, buffer_entry, pipeline, target, texture2d, DEPTH};

pub const PREPASS: &str = "scene3d.ao_prepass";
pub const OCCLUSION: &str = deep_canvas_scene3d::module::AO_PASS;
pub const BLUR: &str = "scene3d.ao_blur";

const SHADER: &str = include_str!("ao.wgsl");
const NORMAL: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// Occlusion in r; the key light's contact shadow in g (#446).
const VISIBILITY: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Float;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct AoUniform {
    clip: [[f32; 4]; 4],
    inv: [[f32; 4]; 4],
    size: [f32; 4],
    opts: [u32; 4],
    scale: [f32; 4],
    /// Toward the key light and the contact shadow's length in m, and its samples in `steps`.
    contact: [f32; 4],
    steps: [u32; 4],
}

struct Pipes {
    prepass: wgpu::RenderPipeline,
    occlusion: wgpu::RenderPipeline,
    blur: wgpu::RenderPipeline,
}

struct Targets {
    size: [u32; 2],
    depth: wgpu::TextureView,
    normal: wgpu::TextureView,
    raw: wgpu::TextureView,
    blurred: wgpu::TextureView,
    occlusion_bind: wgpu::BindGroup,
    blur_bind: wgpu::BindGroup,
    shade: wgpu::BindGroup,
}

pub struct Passes {
    /// The mesh shader's group 2: the blurred visibility and the uniform.
    pub shade_layout: wgpu::BindGroupLayout,
    layout: wgpu::BindGroupLayout,
    uniform: wgpu::Buffer,
    white: wgpu::TextureView,
    off: wgpu::BindGroup,
    pipes: Option<Pipes>,
    targets: Option<Targets>,
    /// The look's ao this frame, with its targets' size.
    on: Option<(Ao, [u32; 2])>,
    /// Changes whenever the bind group the solids draw with changes, so their batches encode
    /// again.
    pub generation: u64,
}

fn tex(binding: u32, sample_type: wgpu::TextureSampleType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

pub(crate) fn invert(m: &[f64; 16]) -> [f64; 16] {
    // Column-major 4 × 4; cofactor expansion.
    let a = |c: usize, r: usize| m[c * 4 + r];
    let mut out = [0.0; 16];
    let minor = |skip_c: usize, skip_r: usize| {
        let pick = |skip: usize| {
            let mut out = [0usize; 3];
            for (n, i) in (0..4).filter(|i| *i != skip).enumerate() {
                out[n] = i;
            }
            out
        };
        let (cs, rs) = (pick(skip_c), pick(skip_r));
        let e = |i: usize, j: usize| a(cs[i], rs[j]);
        e(0, 0) * (e(1, 1) * e(2, 2) - e(2, 1) * e(1, 2))
            - e(1, 0) * (e(0, 1) * e(2, 2) - e(2, 1) * e(0, 2))
            + e(2, 0) * (e(0, 1) * e(1, 2) - e(1, 1) * e(0, 2))
    };
    let mut det = 0.0;
    for c in 0..4 {
        let sign = if c % 2 == 0 { 1.0 } else { -1.0 };
        det += sign * a(c, 0) * minor(c, 0);
    }
    for c in 0..4 {
        for r in 0..4 {
            let sign = if (c + r) % 2 == 0 { 1.0 } else { -1.0 };
            // The inverse's (row c, column r) is the cofactor of (row r, column c) over det.
            out[r * 4 + c] = sign * minor(c, r) / det;
        }
    }
    out
}

fn mat(m: &[f64; 16]) -> [[f32; 4]; 4] {
    let mut out = [[0f32; 4]; 4];
    for c in 0..4 {
        for r in 0..4 {
            out[c][r] = m[c * 4 + r] as f32;
        }
    }
    out
}

impl Passes {
    pub fn new(device: &Device) -> Passes {
        let d = &device.device;
        let float = wgpu::TextureSampleType::Float { filterable: false };
        let uniform = |binding| {
            buffer_entry(
                binding,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            )
        };
        let shade_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d ao shade"),
            entries: &[tex(0, float), uniform(1)],
        });
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(OCCLUSION),
            entries: &[
                tex(0, wgpu::TextureSampleType::Depth),
                tex(1, float),
                uniform(2),
                tex(3, float),
            ],
        });
        let buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(OCCLUSION),
            size: std::mem::size_of::<AoUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let white = texture2d(
            d,
            "scene3d ao white",
            [1, 1],
            VISIBILITY,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        // 1.0 as an f16, twice.
        let one = [0x00, 0x3c, 0x00, 0x3c];
        crate::write_texture(&device.queue, &white, 0, &one, 4, [1, 1]);
        let white = white.create_view(&Default::default());
        let off = bind_group(
            d,
            "scene3d ao off",
            &shade_layout,
            [
                wgpu::BindingResource::TextureView(&white),
                buffer.as_entire_binding(),
            ],
        );
        Passes {
            shade_layout,
            layout,
            uniform: buffer,
            white,
            off,
            pipes: None,
            targets: None,
            on: None,
            generation: 0,
        }
    }

    pub fn is_on(&self) -> bool {
        self.on.is_some()
    }

    /// The bind group the solids draw with this frame.
    pub fn shade(&self) -> &wgpu::BindGroup {
        match (&self.on, &self.targets) {
            (Some(_), Some(t)) => &t.shade,
            _ => &self.off,
        }
    }

    /// Readies this frame's ao for a frame of `size` (the targets' size) under `clip`
    /// (column-major), compiling its pipelines the first time a look turns it on.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        device: &Device,
        scene_module: &wgpu::ShaderModule,
        draw_layout: &wgpu::PipelineLayout,
        mesh_buffers: &[Option<wgpu::VertexBufferLayout<'_>>],
        names: &mut Vec<&'static str>,
        ao: Option<Ao>,
        size: [u32; 2],
        clip: &[f64; 16],
        contact: Option<(Contact, [f64; 3])>,
    ) -> u32 {
        let was = self.on.map(|(_, s)| s);
        let mut compiled = 0;
        // A contact shadow marches the prepass's depth at full size; without ao it reads the
        // prepass alone, an occlusion of strength 0.
        let ao = match (ao, contact) {
            (Some(a), Some(_)) => Some(Ao { half: false, ..a }),
            (None, Some(_)) => Some(Ao {
                strength: 0.0,
                half: false,
                ..Ao::default()
            }),
            (a, None) => a,
        };
        let Some(ao) = ao else {
            if was.is_some() {
                self.generation += 1;
            }
            self.on = None;
            deep_gpu::alloc::outside(|| {
                device.queue.write_buffer(
                    &self.uniform,
                    0,
                    bytemuck::bytes_of(&AoUniform::zeroed()),
                )
            });
            return 0;
        };
        let d = &device.device;
        if self.pipes.is_none() {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(OCCLUSION),
                source: wgpu::ShaderSource::Wgsl(SHADER.into()),
            });
            let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(OCCLUSION),
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
            let prepass = pipeline(
                d,
                PREPASS,
                Some(draw_layout),
                scene_module,
                ("mesh_vs", mesh_buffers),
                Some(("ao_normal_fs", &[target(NORMAL, None)])),
                Some(wgpu::DepthStencilState {
                    format: DEPTH,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
            );
            let full = |label, fs| {
                pipeline(
                    d,
                    label,
                    Some(&layout),
                    &module,
                    ("ao_vs", &[]),
                    Some((fs, &[target(VISIBILITY, None)])),
                    None,
                )
            };
            self.pipes = Some(Pipes {
                prepass,
                occlusion: full(OCCLUSION, "ao_fs"),
                blur: full(BLUR, "blur_fs"),
            });
            names.extend([PREPASS, OCCLUSION, BLUR]);
            compiled = 3;
        }
        let ao_size = if ao.half {
            [size[0].div_ceil(2), size[1].div_ceil(2)]
        } else {
            size
        };
        if self.targets.as_ref().is_none_or(|t| t.size != ao_size) {
            self.targets = Some(deep_gpu::alloc::outside(|| self.targets_at(d, ao_size)));
            self.generation += 1;
        } else if was.is_none() {
            self.generation += 1;
        }
        self.on = Some((ao, ao_size));
        let u = AoUniform {
            clip: mat(clip),
            inv: mat(&invert(clip)),
            size: [
                ao_size[0] as f32,
                ao_size[1] as f32,
                ao.radius as f32,
                ao.strength as f32,
            ],
            opts: [
                ao.samples,
                u32::from(ao.multi_bounce),
                u32::from(ao.specular),
                1,
            ],
            scale: [
                ao_size[0] as f32 / size[0].max(1) as f32,
                ao_size[1] as f32 / size[1].max(1) as f32,
                0.0,
                0.0,
            ],
            contact: contact.map_or([0.0; 4], |(c, l)| {
                [l[0] as f32, l[1] as f32, l[2] as f32, c.length as f32]
            }),
            steps: [contact.map_or(0, |(c, _)| c.samples); 4],
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.uniform, 0, bytemuck::bytes_of(&u))
        });
        compiled
    }

    fn targets_at(&self, d: &wgpu::Device, size: [u32; 2]) -> Targets {
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let view = |label, format| {
            texture2d(d, label, size, format, usage).create_view(&Default::default())
        };
        let depth = view(PREPASS, DEPTH);
        let normal = view("scene3d ao normal", NORMAL);
        let raw = view("scene3d ao raw", VISIBILITY);
        let blurred = view("scene3d ao blurred", VISIBILITY);
        let group = |label, last: &wgpu::TextureView| {
            bind_group(
                d,
                label,
                &self.layout,
                [
                    wgpu::BindingResource::TextureView(&depth),
                    wgpu::BindingResource::TextureView(&normal),
                    self.uniform.as_entire_binding(),
                    wgpu::BindingResource::TextureView(last),
                ],
            )
        };
        let occlusion_bind = group(OCCLUSION, &self.white);
        let blur_bind = group(BLUR, &raw);
        let shade = bind_group(
            d,
            "scene3d ao shade",
            &self.shade_layout,
            [
                wgpu::BindingResource::TextureView(&blurred),
                self.uniform.as_entire_binding(),
            ],
        );
        Targets {
            size,
            depth,
            normal,
            raw,
            blurred,
            occlusion_bind,
            blur_bind,
            shade,
        }
    }

    /// This frame's passes, ready to record on any thread; `None` with ao off.
    pub fn frame(&self, frame: &wgpu::BindGroup, solids: Vec<Solids>) -> Option<Frame> {
        let (Some(_), Some(t), Some(p)) = (&self.on, &self.targets, &self.pipes) else {
            return None;
        };
        Some(Frame {
            prepass: p.prepass.clone(),
            occlusion: p.occlusion.clone(),
            blur: p.blur.clone(),
            depth: t.depth.clone(),
            normal: t.normal.clone(),
            raw: t.raw.clone(),
            blurred: t.blurred.clone(),
            occlusion_bind: t.occlusion_bind.clone(),
            blur_bind: t.blur_bind.clone(),
            frame: frame.clone(),
            solids,
        })
    }
}

/// One opaque solid set the prepass draws: its mesh's vertices, indices and index count, and the
/// set's instance buffer and count.
pub type Solids = (wgpu::Buffer, wgpu::Buffer, u32, wgpu::Buffer, u32);

/// One frame's ao passes.
pub struct Frame {
    prepass: wgpu::RenderPipeline,
    occlusion: wgpu::RenderPipeline,
    blur: wgpu::RenderPipeline,
    depth: wgpu::TextureView,
    normal: wgpu::TextureView,
    raw: wgpu::TextureView,
    blurred: wgpu::TextureView,
    occlusion_bind: wgpu::BindGroup,
    blur_bind: wgpu::BindGroup,
    frame: wgpu::BindGroup,
    solids: Vec<Solids>,
}

impl Frame {
    /// Records the prepass (the opaque solids' depth and normals), the occlusion and the blur,
    /// each timed under the occlusion's name, which sums them.
    pub fn record(&self, profiler: &Option<crate::Profiler>, encoder: &mut wgpu::CommandEncoder) {
        crate::timed(profiler, OCCLUSION, encoder, |encoder, timestamp_writes| {
            deep_gpu::alloc::outside(|| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(PREPASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.normal,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.0,
                                g: 1.0,
                                b: 0.0,
                                a: 0.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.depth,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(0.0),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes,
                    ..Default::default()
                });
                pass.set_pipeline(&self.prepass);
                pass.set_bind_group(0, &self.frame, &[]);
                for (vertices, indices, count, instances, n) in &self.solids {
                    pass.set_vertex_buffer(0, vertices.slice(..));
                    pass.set_vertex_buffer(1, instances.slice(..));
                    pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..*count, 0, 0..*n);
                }
            })
        });
        let white = wgpu::LoadOp::Clear(wgpu::Color::WHITE);
        crate::timed(profiler, OCCLUSION, encoder, |encoder, timestamp_writes| {
            crate::full_pass(
                encoder,
                OCCLUSION,
                &self.raw,
                white,
                &self.occlusion,
                &self.occlusion_bind,
                timestamp_writes,
            );
        });
        crate::timed(profiler, OCCLUSION, encoder, |encoder, timestamp_writes| {
            crate::full_pass(
                encoder,
                BLUR,
                &self.blurred,
                white,
                &self.blur,
                &self.blur_bind,
                timestamp_writes,
            );
        });
    }
}
