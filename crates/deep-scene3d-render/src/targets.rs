//! The core's velocity and emission targets (#431; canvas primitives: Operator input: `target
//! {op: core, output: velocity | emission}`). Each is built only while an effect or operator of the
//! document reads it, at the frame's internal size, and drawn after the geometry against the
//! frame's own depth, so only what shows writes it: velocity, each pixel's travel over the shutter
//! in px from the evaluations at t ± s/2 (4 B a pixel), and emission, the emitted radiance of what
//! shows, before bloom (8 B a pixel). Both are same machine.

use deep_gpu::device::Device;

use crate::{pipeline, target, texture2d, DEPTH};

/// The emission target's format: linear radiance, half floats.
pub const EMISSION: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// #431's planted emission target: the color target's excess over 1, as a bloom threshold would
/// make it, never the emitted radiance.
const THRESHOLD: &str = "
@group(0) @binding(0) var color: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(color, vec2<i32>(pos.xy), 0);
    return vec4<f32>(max(c.rgb - vec3<f32>(1.0), vec3<f32>(0.0)), 1.0);
}
";

/// One core target on the device.
#[derive(Clone)]
pub struct Target {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
}

/// Which core targets a frame builds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Want {
    pub velocity: bool,
    pub emission: bool,
}

/// The core targets the renderer holds, with the pipelines that draw them.
#[derive(Default)]
pub struct Core {
    pub want: Want,
    size: [u32; 2],
    pub velocity: Option<Target>,
    pub emission: Option<Target>,
    emission_pipe: Option<wgpu::RenderPipeline>,
    threshold_pipe: Option<wgpu::RenderPipeline>,
}

/// One solid set's emission draw: its vertices, indices, index count, instances, instance count
/// and its maps' bind group.
pub type EmissionDraw = (
    wgpu::Buffer,
    wgpu::Buffer,
    u32,
    wgpu::Buffer,
    u32,
    wgpu::BindGroup,
);

/// What a frame records into the emission target.
#[derive(Clone)]
pub enum EmissionFrame {
    /// Every opaque solid's emission where its depth shows, under the frame's bind groups.
    Draws {
        pipe: wgpu::RenderPipeline,
        binds: [wgpu::BindGroup; 3],
        draws: Vec<EmissionDraw>,
    },
    /// The planted threshold of the color target.
    Threshold {
        pipe: wgpu::RenderPipeline,
        bind: wgpu::BindGroup,
    },
}

fn made(d: &deep_gpu::counted::Wgpu, label: &str, size: [u32; 2], format: wgpu::TextureFormat) -> Target {
    let texture = texture2d(
        d,
        label,
        size,
        format,
        wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
    );
    let view = texture.create_view(&Default::default());
    Target { texture, view }
}

impl Core {
    /// Makes the wanted targets at `size` and drops the others, so an unread target holds no
    /// memory.
    pub fn ensure(&mut self, d: &deep_gpu::counted::Wgpu, size: [u32; 2]) {
        if size != self.size {
            self.velocity = None;
            self.emission = None;
            self.size = size;
        }
        if !self.want.velocity {
            self.velocity = None;
        } else if self.velocity.is_none() {
            self.velocity = Some(deep_gpu::alloc::outside(|| {
                made(d, "scene3d.velocity", size, crate::motion::TARGET)
            }));
        }
        if !self.want.emission {
            self.emission = None;
        } else if self.emission.is_none() {
            self.emission = Some(deep_gpu::alloc::outside(|| {
                made(d, "scene3d.emission", size, EMISSION)
            }));
        }
    }

    /// Each target held, by its output's name, with the bytes it takes: width × height × its
    /// texel's bytes.
    pub fn held(&self) -> Vec<(&'static str, &Target, u64)> {
        let px = u64::from(self.size[0]) * u64::from(self.size[1]);
        [
            ("velocity", self.velocity.as_ref(), 4),
            ("emission", self.emission.as_ref(), 8),
        ]
        .into_iter()
        .filter_map(|(name, t, b)| Some((name, t?, px * b)))
        .collect()
    }

    /// The emission target's frame: the solids' draws, or the planted threshold of `linear`.
    pub fn emission_frame(
        &mut self,
        device: &Device,
        module: &wgpu::ShaderModule,
        layout: &wgpu::PipelineLayout,
        binds: [wgpu::BindGroup; 3],
        draws: Vec<EmissionDraw>,
        threshold_of: Option<&wgpu::TextureView>,
    ) -> Option<EmissionFrame> {
        self.emission.as_ref()?;
        let d = &device.device;
        if let Some(linear) = threshold_of {
            let pipe = self
                .threshold_pipe
                .get_or_insert_with(|| {
                    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some("scene3d.emission threshold"),
                        source: wgpu::ShaderSource::Wgsl(THRESHOLD.into()),
                    });
                    pipeline(
                        d,
                        "scene3d.emission threshold",
                        None,
                        &module,
                        ("vs", &[]),
                        Some(("fs", &[target(EMISSION, None)])),
                        None,
                    )
                })
                .clone();
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d.emission threshold"),
                layout: &pipe.get_bind_group_layout(0),
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(linear),
                }],
            });
            return Some(EmissionFrame::Threshold { pipe, bind });
        }
        let pipe = self
            .emission_pipe
            .get_or_insert_with(|| {
                pipeline(
                    d,
                    "scene3d.emission",
                    Some(layout),
                    module,
                    ("mesh_vs", &crate::mesh_buffers()),
                    Some(("emission_fs", &[target(EMISSION, None)])),
                    // The frame's resolved depth, read only (#1173: from a pixel's first covered
                    // sample, not its centre): a few units of bias toward the eye (reversed Z:
                    // greater is nearer) keep its own surface's ties, while what lies behind it
                    // fails.
                    Some(wgpu::DepthStencilState {
                        format: DEPTH,
                        depth_write_enabled: Some(false),
                        depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                        stencil: Default::default(),
                        bias: wgpu::DepthBiasState {
                            constant: 64,
                            slope_scale: 1.0,
                            clamp: 0.0,
                        },
                    }),
                )
            })
            .clone();
        Some(EmissionFrame::Draws { pipe, binds, draws })
    }
}

impl EmissionFrame {
    /// Records the emission target `view`, cleared to no emission first, against `depth`.
    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        depth: &wgpu::TextureView,
    ) {
        let color = wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                store: wgpu::StoreOp::Store,
            },
        };
        match self {
            EmissionFrame::Threshold { pipe, bind } => {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene3d.emission threshold"),
                    color_attachments: &[Some(color)],
                    ..Default::default()
                });
                pass.set_pipeline(pipe);
                pass.set_bind_group(0, bind, &[]);
                pass.draw(0..3, 0..1);
            }
            EmissionFrame::Draws { pipe, binds, draws } => {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene3d.emission"),
                    color_attachments: &[Some(color)],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: depth,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    ..Default::default()
                });
                pass.set_pipeline(pipe);
                for (i, b) in binds.iter().enumerate() {
                    pass.set_bind_group(i as u32, b, &[]);
                }
                for (vertices, indices, count, instances, len, maps) in draws {
                    pass.set_bind_group(3, maps, &[]);
                    pass.set_vertex_buffer(0, vertices.slice(..));
                    pass.set_vertex_buffer(1, instances.slice(..));
                    pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..*count, 0, 0..*len);
                }
            }
        }
    }
}
