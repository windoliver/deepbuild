//! The GPU surface below internal scale 1 (issue #386; canvas primitives: GPU surface): the frame
//! renders at its internal size, then returns to full size through two passes that read only
//! this frame, an edge-adaptive upscale (or the bilinear stretch it is measured against) and a
//! contrast-adaptive sharpen. Line marks 1 device px or thinner, objects' outlines and status
//! outlines then draw at full size, depth-tested against the core's depth target.

use deep_gpu::alloc::outside;
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;

use crate::{bind_group, buffer_entry, pipeline, target};

pub const UPSCALE_PASS: &str = "surface.upscale";
pub const SHARPEN_PASS: &str = "surface.sharpen";
/// The pass that draws thin lines and outlines at full size.
pub const OUTLINE_PASS: &str = "scene3d.outlines";
/// Screen-size labels at full size after the upscale (#1174).
pub const LABEL_PASS: &str = "scene3d.labels";

const SHADER: &str = include_str!("upscale.wgsl");
/// The upscaled frame's format: the compute upscale at half size writes it as storage.
const UPSCALED: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// How a view returns to full size below scale 1 (frame history's `temporal` lands in R6).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Filter {
    #[default]
    EdgeAdaptive,
    Bilinear,
}

impl Filter {
    pub fn parse(name: &str) -> Option<Filter> {
        match name {
            "edge_adaptive" => Some(Filter::EdgeAdaptive),
            "bilinear" => Some(Filter::Bilinear),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Filter::EdgeAdaptive => "edge_adaptive",
            Filter::Bilinear => "bilinear",
        }
    }
}

/// The GPU surface's fields a view draws through.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface {
    /// 0.5 to 1.
    pub scale: f64,
    pub upscale: Filter,
    /// 0 to 1.
    pub sharpen: f64,
}

impl Default for Surface {
    fn default() -> Self {
        Surface {
            scale: 1.0,
            upscale: Filter::EdgeAdaptive,
            sharpen: 0.2,
        }
    }
}

/// The frame's internal size at `scale`.
pub fn scaled(size: [u32; 2], scale: f64) -> [u32; 2] {
    [
        (f64::from(size[0]) * scale).round().max(1.0) as u32,
        (f64::from(size[1]) * scale).round().max(1.0) as u32,
    ]
}

/// The wrong programs the upscale reaches.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The edge-adaptive upscale draws a bilinear stretch, with no sharpen.
    pub bilinear_only: bool,
    /// The upscale blends in the view's previous frame.
    pub reads_previous_frame: bool,
    /// The upscale's passes draw forty times over.
    pub slow: bool,
}

/// The upscale's pipelines, compiled before a view first draws below scale 1.
pub struct Upscale {
    source: wgpu::BindGroupLayout,
    amount: wgpu::BindGroupLayout,
    out: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    edge: wgpu::RenderPipeline,
    /// The edge-adaptive upscale at exactly half size, four pixels an invocation.
    half: wgpu::ComputePipeline,
    bilinear: wgpu::RenderPipeline,
    /// The planted upscale that blends into the previous frame.
    blended: wgpu::RenderPipeline,
    sharpen: wgpu::RenderPipeline,
}

impl Upscale {
    pub fn new(device: &Device) -> Upscale {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("surface upscale"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let source = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("surface source"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT | wgpu::ShaderStages::COMPUTE,
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
        let amount = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("surface sharpen"),
            entries: &[buffer_entry(
                0,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            )],
        });
        let out = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("surface upscaled"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: UPSCALED,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            }],
        });
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("surface upscale"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let srgb = UPSCALED.add_srgb_suffix();
        let make = |entry: &str, groups: &[Option<&wgpu::BindGroupLayout>], format, blend| {
            let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(entry),
                bind_group_layouts: groups,
                immediate_size: 0,
            });
            pipeline(
                d,
                entry,
                Some(&layout),
                &module,
                ("full", &[]),
                Some((entry, &[target(format, blend)])),
                None,
            )
        };
        let half = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::Constant,
            dst_factor: wgpu::BlendFactor::OneMinusConstant,
            operation: wgpu::BlendOperation::Add,
        };
        Upscale {
            // The edge-adaptive upscale works in linear light and writes the upscaled frame
            // through its sRGB view, which encodes (at exactly half size, as storage, encoding
            // itself); the bilinear stretch stays in sRGB values.
            edge: make("upscale", &[Some(&source)], srgb, None),
            half: d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("upscale_half"),
                layout: Some(&d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("upscale_half"),
                    bind_group_layouts: &[Some(&source), Some(&out)],
                    immediate_size: 0,
                })),
                module: &module,
                entry_point: Some("upscale_half"),
                compilation_options: Default::default(),
                cache: None,
            }),
            bilinear: make("bilinear", &[Some(&source)], UPSCALED, None),
            blended: make(
                "upscale",
                &[Some(&source)],
                srgb,
                Some(wgpu::BlendState {
                    color: half,
                    alpha: half,
                }),
            ),
            sharpen: make("sharpen", &[Some(&source), Some(&amount)], FORMAT, None),
            source,
            amount,
            out,
            sampler,
        }
    }
}

/// A view's targets below scale 1: the frame at its internal size, the upscale's output at full
/// size, and the sharpen's amount.
pub struct Low {
    pub internal: [u32; 2],
    pub size: [u32; 2],
    pub view: wgpu::TextureView,
    up_view: wgpu::TextureView,
    /// The upscaled frame's sRGB view, which the edge-adaptive upscale writes.
    up_srgb: wgpu::TextureView,
    low_bind: wgpu::BindGroup,
    /// The internal frame through its sRGB view, which the edge-adaptive upscale reads in
    /// linear light.
    linear_bind: wgpu::BindGroup,
    up_bind: wgpu::BindGroup,
    amount: wgpu::Buffer,
    amount_bind: wgpu::BindGroup,
    /// At exactly half size, the upscaled frame as the compute upscale's storage.
    half_bind: Option<wgpu::BindGroup>,
    held: f64,
    /// Whether the upscale's output holds a frame yet (the planted blend reads it).
    filled: bool,
}

impl Low {
    pub fn new(device: &Device, up: &Upscale, internal: [u32; 2], size: [u32; 2]) -> Low {
        let d = &device.device;
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let texture = |label, size: [u32; 2], format: wgpu::TextureFormat, usage| {
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
                view_formats: &[format.add_srgb_suffix()],
            })
        };
        let low = texture("surface low", internal, FORMAT, usage);
        let half = internal.map(|n| n * 2) == size;
        let storage = if half {
            wgpu::TextureUsages::STORAGE_BINDING
        } else {
            wgpu::TextureUsages::empty()
        };
        let upscaled = texture("surface upscaled", size, UPSCALED, usage | storage);
        // An sRGB view can't be storage.
        let up_srgb = upscaled.create_view(&wgpu::TextureViewDescriptor {
            format: Some(UPSCALED.add_srgb_suffix()),
            usage: Some(usage),
            ..Default::default()
        });
        let view = low.create_view(&Default::default());
        let linear = low.create_view(&wgpu::TextureViewDescriptor {
            format: Some(FORMAT.add_srgb_suffix()),
            ..Default::default()
        });
        let up_view = upscaled.create_view(&Default::default());
        let source = |v: &wgpu::TextureView| {
            bind_group(
                d,
                "surface source",
                &up.source,
                [
                    wgpu::BindingResource::TextureView(v),
                    wgpu::BindingResource::Sampler(&up.sampler),
                ],
            )
        };
        let amount = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("surface sharpen"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Low {
            internal,
            size,
            low_bind: source(&view),
            linear_bind: source(&linear),
            up_bind: source(&up_view),
            amount_bind: bind_group(
                d,
                "surface sharpen",
                &up.amount,
                [amount.as_entire_binding()],
            ),
            amount,
            half_bind: half.then(|| {
                bind_group(
                    d,
                    "surface upscaled",
                    &up.out,
                    [wgpu::BindingResource::TextureView(&up_view)],
                )
            }),
            held: f64::NAN,
            filled: false,
            view,
            up_view,
            up_srgb,
        }
    }

    /// Writes the sharpen's amount when it changed; call before recording the passes.
    pub fn hold(&mut self, device: &Device, sharpen: f64) {
        if self.held != sharpen {
            self.held = sharpen;
            outside(|| {
                device.queue.write_buffer(
                    &self.amount,
                    0,
                    bytemuck::bytes_of(&[sharpen as f32, 0.0, 0.0, 0.0]),
                )
            });
        }
    }

    /// One of the upscale's two passes (`UPSCALE_PASS` or `SHARPEN_PASS`), ready to record: the
    /// upscale from the internal frame to full size, the sharpen from there into `slot`.
    pub fn step(
        &mut self,
        up: &Upscale,
        surface: &Surface,
        planted: Planted,
        name: &str,
        slot: &wgpu::TextureView,
    ) -> Step {
        let reps = if planted.slow { 40 } else { 1 };
        if name == UPSCALE_PASS {
            let blend = planted.reads_previous_frame && self.filled;
            self.filled = true;
            let bilinear = surface.upscale == Filter::Bilinear || planted.bilinear_only;
            let draw = if blend {
                Draw::Render(up.blended.clone())
            } else if bilinear {
                Draw::Render(up.bilinear.clone())
            } else if let Some(out) = &self.half_bind {
                // One invocation per texel from -1, each writing the four pixels past it.
                let groups = self.internal.map(|n| (n + 1).div_ceil(8));
                Draw::Compute(up.half.clone(), out.clone(), groups)
            } else {
                Draw::Render(up.edge.clone())
            };
            let source = if bilinear && !blend {
                &self.low_bind
            } else {
                &self.linear_bind
            };
            Step {
                name: UPSCALE_PASS,
                target: if bilinear && !blend {
                    self.up_view.clone()
                } else {
                    self.up_srgb.clone()
                },
                draw,
                groups: [Some(source.clone()), None],
                blend,
                reps,
            }
        } else {
            Step {
                name: SHARPEN_PASS,
                target: slot.clone(),
                draw: Draw::Render(up.sharpen.clone()),
                groups: [Some(self.up_bind.clone()), Some(self.amount_bind.clone())],
                blend: false,
                reps,
            }
        }
    }
}

/// A pass's pipeline: a draw into its target, or the half-size upscale's dispatch over that many
/// workgroups, with the storage it writes.
enum Draw {
    Render(wgpu::RenderPipeline),
    Compute(wgpu::ComputePipeline, wgpu::BindGroup, [u32; 2]),
}

/// One of the upscale's passes, holding what it binds.
pub struct Step {
    name: &'static str,
    target: wgpu::TextureView,
    draw: Draw,
    /// Its bind groups in order; the upscale binds one.
    groups: [Option<wgpu::BindGroup>; 2],
    /// The planted blend into the previous frame.
    blend: bool,
    reps: u32,
}

impl Step {
    pub fn name(&self) -> &'static str {
        self.name
    }

    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let pipeline = match &self.draw {
            Draw::Render(p) => p,
            Draw::Compute(p, out, groups) => {
                return outside(|| {
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some(self.name),
                        timestamp_writes: timestamps.map(|t| wgpu::ComputePassTimestampWrites {
                            query_set: t.query_set,
                            beginning_of_pass_write_index: t.beginning_of_pass_write_index,
                            end_of_pass_write_index: t.end_of_pass_write_index,
                        }),
                    });
                    pass.set_pipeline(p);
                    pass.set_bind_group(0, self.groups[0].as_ref(), &[]);
                    pass.set_bind_group(1, out, &[]);
                    for _ in 0..self.reps {
                        pass.dispatch_workgroups(groups[0], groups[1], 1);
                    }
                });
            }
        };
        outside(|| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(self.name),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: if self.blend {
                            wgpu::LoadOp::Load
                        } else {
                            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                timestamp_writes: timestamps,
                ..Default::default()
            });
            pass.set_pipeline(pipeline);
            if self.blend {
                pass.set_blend_constant(wgpu::Color {
                    r: 0.5,
                    g: 0.5,
                    b: 0.5,
                    a: 0.5,
                });
            }
            for (i, g) in self.groups.iter().flatten().enumerate() {
                pass.set_bind_group(i as u32, g, &[]);
            }
            pass.draw(0..3, 0..self.reps);
        });
    }
}
