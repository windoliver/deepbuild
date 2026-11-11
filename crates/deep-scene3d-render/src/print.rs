//! Issue #464: the look's print finish on the GPU (print.wgsl), one pass a frame reads after the
//! output's encode and before status colors, for 2D writer layers (the film's and render-back's
//! GPU snapshot) and 3D ones alike. A 2D frame hands it each separation's coverage (its role's
//! marks drawn alone); a 3D frame, its object IDs and which separations each ID's surface is.

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use deep_canvas_marks::print::{Anchor, Frame, Mask, Print, Spot, MAX_SEPARATIONS};

/// The pass's name in a frame's pass list.
pub const PRINT_PASS: &str = "look.print";
/// The linear target it writes beside the frame when asked: the frame in linear light after the
/// finish and before its 8-bit encode.
pub const LINEAR: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

const SOURCE: &str = include_str!("print.wgsl");

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Sep {
    ink: [f32; 4],
    screen: [f32; 4],
    offset: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Params {
    size: [f32; 4],
    world: [f32; 4],
    flags: [u32; 4],
    steps: [u32; 4],
    grain: [f32; 4],
    vignette: [f32; 4],
    vcolor: [f32; 4],
    wear: [f32; 4],
    wear2: [f32; 4],
    wear3: [f32; 4],
    tone: [f32; 4],
    black: [f32; 4],
    screen: [f32; 4],
    screen2: [f32; 4],
    ground: [f32; 4],
    seps: [Sep; MAX_SEPARATIONS],
}

const FLAG_SEPS: u32 = 1;
const FLAG_GRAIN: u32 = 2;
const FLAG_VIGNETTE: u32 = 4;
const FLAG_WEAR: u32 = 8;
const FLAG_TONE: u32 = 16;
const FLAG_SCREEN: u32 = 32;
const FLAG_IDS: u32 = 64;

fn enc(c: [u8; 3]) -> [f32; 4] {
    let v = |i: usize| f32::from(c[i]) / 255.0;
    [v(0), v(1), v(2), 0.0]
}

/// Where the frame's pixels sit in the world, for halftones anchored to the plate: a pixel `p`
/// lies at `p × scale + offset`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub scale: f64,
    pub offset: [f64; 2],
}

impl Default for Placed {
    fn default() -> Self {
        Placed {
            scale: 1.0,
            offset: [0.0, 0.0],
        }
    }
}

/// How the planted programs this pass serves go wrong (#464's twins).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The vignette's radius in px from the centre over the short half-axis.
    pub vignette_pixels: bool,
}

/// The pass's uniforms for one frame of `print` at `size`.
pub fn params(
    print: &Print,
    frame: &Frame,
    size: [u32; 2],
    placed: Placed,
    ground: [u8; 3],
    from_ids: bool,
    planted: Planted,
) -> Params {
    let mut p = Params::zeroed();
    let (w, h) = (size[0] as f32, size[1] as f32);
    p.size = [w, h, placed.scale as f32, 0.0];
    p.world = [placed.offset[0] as f32, placed.offset[1] as f32, 0.0, 0.0];
    let mut flags = 0;
    p.flags[1] = frame.seed;
    p.steps = [frame.grain_step, frame.wear_step, frame.screen_step, 0];
    if !print.separations.is_empty() {
        flags |= FLAG_SEPS;
        p.flags[2] = print.separations.len() as u32;
        for (i, s) in print.separations.iter().enumerate() {
            let mut ink = enc(s.color);
            ink[3] = if s.multiply { 1.0 } else { 0.0 };
            let (angle, pitch, spot) = match s.halftone {
                None => (0.0, 1.0, 0.0),
                Some((a, pitch, spot)) => (
                    a.to_radians(),
                    pitch,
                    match spot {
                        Spot::Round => 1.0,
                        Spot::Line => 2.0,
                        Spot::Square => 3.0,
                    },
                ),
            };
            let anchor = match s.anchor {
                Anchor::Frame => 0.0,
                Anchor::Sheet => 1.0,
                Anchor::Plate => 2.0,
            };
            p.seps[i] = Sep {
                ink,
                screen: [angle as f32, pitch as f32, spot, anchor],
                offset: [
                    frame.offsets[i][0] as f32,
                    frame.offsets[i][1] as f32,
                    0.0,
                    0.0,
                ],
            };
        }
        if from_ids {
            flags |= FLAG_IDS;
        }
    }
    p.ground = enc(ground);
    if let Some(g) = print.grain {
        flags |= FLAG_GRAIN;
        p.grain = [
            g.amount as f32,
            g.size as f32,
            if g.midtones { 1.0 } else { 0.0 },
            0.0,
        ];
    }
    if let Some(v) = print.vignette {
        flags |= FLAG_VIGNETTE;
        p.vignette = [
            v.inner as f32,
            v.outer as f32,
            v.amount as f32,
            if v.hood { 1.0 } else { 0.0 },
        ];
        p.vcolor = enc(v.color);
        if v.round || planted.vignette_pixels {
            p.vcolor[3] = 0.5 * w.min(h);
        }
    }
    if let Some(wr) = print.wear {
        flags |= FLAG_WEAR;
        p.wear = [
            frame.flicker as f32,
            frame.weave[0] as f32,
            frame.weave[1] as f32,
            wr.hair as f32,
        ];
        p.wear2 = [
            wr.scratches.0[0] as f32,
            wr.scratches.0[1] as f32,
            wr.scratches.1 as f32,
            wr.scratches.2 as f32,
        ];
        p.wear3 = [
            wr.dust.0 as f32,
            wr.dust.1 as f32,
            wr.gate.0 as f32,
            wr.gate.1 as f32,
        ];
    }
    if let Some(t) = print.tone {
        flags |= FLAG_TONE;
        p.tone = [
            t.white as f32,
            t.contrast as f32,
            t.toe as f32,
            t.shoulder as f32,
        ];
        p.black = [t.black[0] as f32, t.black[1] as f32, t.black[2] as f32, 0.0];
    }
    if let Some(s) = print.screen {
        flags |= FLAG_SCREEN;
        let mask = match s.mask {
            Mask::None => 0.0,
            Mask::Aperture => 1.0,
            Mask::Shadow => 2.0,
            Mask::Slot => 3.0,
        };
        p.screen = [
            s.scanlines as f32,
            mask,
            s.curvature as f32,
            s.convergence as f32,
        ];
        p.screen2 = [s.bleed as f32, s.noise as f32, 0.0, 0.0];
    }
    p.flags[0] = flags;
    p
}

/// What the pass reads besides the frame.
pub enum Coverage<'a> {
    /// A 2D frame: each separation's coverage in its alpha, in the separations' order.
    Textures(Vec<&'a wgpu::TextureView>),
    /// A 3D frame: its object IDs and, by ID, a bit for each separation its surface is.
    Ids(&'a wgpu::TextureView, Vec<u32>),
    None,
}

/// The pass's pipelines, by the format it writes and whether it writes the linear target too.
pub struct Printer {
    layout: wgpu::BindGroupLayout,
    module: wgpu::ShaderModule,
    pipeline_layout: wgpu::PipelineLayout,
    pipelines: HashMap<(wgpu::TextureFormat, bool), wgpu::RenderPipeline>,
    blank: wgpu::TextureView,
    blank_ids: wgpu::TextureView,
}

impl Printer {
    pub fn new(device: &deep_gpu::counted::Wgpu) -> Self {
        let tex = |binding, sample_type| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let float = wgpu::TextureSampleType::Float { filterable: false };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(PRINT_PASS),
            entries: &[
                tex(0, float),
                tex(1, float),
                tex(2, float),
                tex(3, float),
                tex(4, float),
                tex(5, wgpu::TextureSampleType::Uint),
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 7,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(PRINT_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(PRINT_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let small = |format, label| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        Printer {
            layout,
            module,
            pipeline_layout,
            pipelines: HashMap::new(),
            blank: small(wgpu::TextureFormat::Rgba8Unorm, "print blank"),
            blank_ids: small(wgpu::TextureFormat::R32Uint, "print blank ids"),
        }
    }

    fn pipeline(
        &mut self,
        device: &deep_gpu::counted::Wgpu,
        format: wgpu::TextureFormat,
        linear: bool,
    ) -> wgpu::RenderPipeline {
        let (module, layout) = (&self.module, &self.pipeline_layout);
        self.pipelines
            .entry((format, linear))
            .or_insert_with(|| {
                let targets: Vec<Option<wgpu::ColorTargetState>> = std::iter::once(format)
                    .chain(linear.then_some(LINEAR))
                    .map(|format| Some(format.into()))
                    .collect();
                device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(PRINT_PASS),
                    layout: Some(layout),
                    vertex: wgpu::VertexState {
                        module,
                        entry_point: Some("vs"),
                        compilation_options: Default::default(),
                        buffers: &[],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module,
                        entry_point: Some(if linear { "fs_linear" } else { "fs" }),
                        compilation_options: Default::default(),
                        targets: &targets,
                    }),
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    multiview_mask: None,
                    cache: None,
                })
            })
            .clone()
    }

    /// Records the pass from `source` (the frame as the output encoded it) into `target` of
    /// `format`, and into `linear` when given.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        device: &deep_gpu::counted::Wgpu,
        encoder: &mut wgpu::CommandEncoder,
        params: &Params,
        source: &wgpu::TextureView,
        coverage: &Coverage<'_>,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        linear: Option<&wgpu::TextureView>,
    ) {
        let pipeline = self.pipeline(device, format, linear.is_some());
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(PRINT_PASS),
            contents: bytemuck::bytes_of(params),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let (covs, ids, masks): (Vec<&wgpu::TextureView>, &wgpu::TextureView, Vec<u32>) =
            match coverage {
                Coverage::Textures(t) => (t.clone(), &self.blank_ids, vec![0]),
                Coverage::Ids(ids, masks) => (Vec::new(), ids, masks.clone()),
                Coverage::None => (Vec::new(), &self.blank_ids, vec![0]),
            };
        let masks = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(PRINT_PASS),
            contents: bytemuck::cast_slice(if masks.is_empty() { &[0u32] } else { &masks }),
            usage: wgpu::BufferUsages::STORAGE,
        });
        let cov = |i: usize| covs.get(i).copied().unwrap_or(&self.blank);
        fn view(binding: u32, v: &wgpu::TextureView) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: wgpu::BindingResource::TextureView(v),
            }
        }
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(PRINT_PASS),
            layout: &self.layout,
            entries: &[
                view(0, source),
                view(1, cov(0)),
                view(2, cov(1)),
                view(3, cov(2)),
                view(4, cov(3)),
                view(5, ids),
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: masks.as_entire_binding(),
                },
            ],
        });
        let attach = |view| {
            Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })
        };
        let attachments: Vec<_> = std::iter::once(attach(target))
            .chain(linear.map(attach))
            .collect();
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(PRINT_PASS),
            color_attachments: &attachments,
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_print_shader_validates() {
        let module = naga::front::wgsl::parse_str(super::SOURCE)
            .unwrap_or_else(|e| panic!("{}", e.emit_to_string(super::SOURCE)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{}", e.emit_to_string(super::SOURCE)));
    }
}
