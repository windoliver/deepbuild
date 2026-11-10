//! #467: the GPU layer's paint built from a mark's coverage (canvas primitives: Paint: drop;
//! Paint: shade, `kind: inner`; Paint: glow, bevel and satin). The group compositor draws an
//! item's own marks as coverage into a target; this runs the part's steps on it, each the step
//! of deep-canvas-marks' `fx` (the CPU reference) in the same f32 arithmetic, over the crop the
//! part reaches, and writes the part's premultiplied color into a target to composite.

use std::collections::BTreeMap;

use deep_canvas_marks::fx::{self, Part, Shape};
use deep_gpu::device::Device;
use wgpu::util::DeviceExt as _;

const ENTRIES: [&str; 13] = [
    "cov", "shift", "blur", "dilate", "lin", "outside_moved", "mul", "glow", "distance", "height",
    "lit", "satin", "paint",
];

/// The pipelines, made once per device.
pub struct PaintFx {
    layout: wgpu::BindGroupLayout,
    pipelines: BTreeMap<&'static str, wgpu::ComputePipeline>,
}

/// One step's inputs and output: buffer indices, or `None` for an unused input.
#[derive(Clone, Copy, Default)]
struct Step {
    f: [f32; 4],
    g: [f32; 4],
    k: [u32; 4],
}

/// The steps of one part over a crop, recorded on one encoder.
struct Plan<'a> {
    fx: &'a PaintFx,
    device: &'a Device,
    encoder: wgpu::CommandEncoder,
    size: [u32; 2],
    origin: [u32; 2],
    coverage: &'a wgpu::TextureView,
    buffers: Vec<wgpu::Buffer>,
    rgba: wgpu::Buffer,
    stride: u32,
}

impl<'a> Plan<'a> {
    fn buffer(&mut self) -> usize {
        let bytes = u64::from(self.size[0]) * u64::from(self.size[1]) * 4;
        self.buffers.push(self.device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("paint fx"),
            size: bytes.max(4),
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        }));
        self.buffers.len() - 1
    }

    /// Runs `entry` on inputs `ins` into a new buffer, whose index it returns.
    fn run(&mut self, entry: &'static str, ins: [Option<usize>; 3], s: Step) -> usize {
        let out = self.buffer();
        let d = &self.device.device;
        let mut words: Vec<u8> = Vec::with_capacity(64);
        for v in [self.size[0], self.size[1], self.origin[0], self.origin[1]] {
            words.extend_from_slice(&v.to_le_bytes());
        }
        for v in s.f.iter().chain(&s.g) {
            words.extend_from_slice(&v.to_le_bytes());
        }
        for v in s.k {
            words.extend_from_slice(&v.to_le_bytes());
        }
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("paint fx"),
            contents: &words,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        // An unused input reads the output's own buffer's neighbor: any buffer bound read-only.
        let spare = self.buffer();
        let input = |i: Option<usize>| &self.buffers[i.unwrap_or(spare)];
        let group = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("paint fx"),
            layout: &self.fx.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: input(ins[0]).as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: input(ins[1]).as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: input(ins[2]).as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: self.buffers[out].as_entire_binding() },
                wgpu::BindGroupEntry { binding: 5, resource: self.rgba.as_entire_binding() },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::TextureView(self.coverage),
                },
            ],
        });
        {
            let mut pass = self.encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.fx.pipelines[entry]);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);
        }
        out
    }

    fn one(&mut self, entry: &'static str, a: usize, s: Step) -> usize {
        self.run(entry, [Some(a), None, None], s)
    }

    /// The shipped blur of `radius` px: x, then y; nothing below a px's width of 0.
    fn blur(&mut self, a: usize, radius: f32) -> usize {
        if radius <= 0.0 {
            return a;
        }
        let x = self.one("blur", a, Step { f: [radius, 0.0, 0.0, 0.0], k: [1, 0, 0, 0], ..Step::default() });
        self.one("blur", x, Step { f: [radius, 0.0, 0.0, 0.0], ..Step::default() })
    }

    fn dilate(&mut self, a: usize, r: f32) -> usize {
        if r <= 0.0 {
            return a;
        }
        self.one("dilate", a, Step { f: [r, 0.0, 0.0, 0.0], ..Step::default() })
    }

    fn shift(&mut self, a: usize, d: [f32; 2]) -> usize {
        self.one("shift", a, Step { f: [d[0], d[1], 0.0, 0.0], ..Step::default() })
    }
}

impl PaintFx {
    pub fn new(device: &Device) -> PaintFx {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("paint fx"),
            source: wgpu::ShaderSource::Wgsl(include_str!("paintfx.wgsl").into()),
        });
        let storage = |binding, read_only| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("paint fx"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                storage(1, true),
                storage(2, true),
                storage(3, true),
                storage(4, false),
                storage(5, false),
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipelines_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("paint fx"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipelines = ENTRIES
            .iter()
            .map(|entry| {
                let p = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: Some(&pipelines_layout),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    cache: None,
                });
                (*entry, p)
            })
            .collect();
        PaintFx { layout, pipelines }
    }

    /// `part` from the coverage in `coverage`'s alpha over the crop `rect` (px `[x, y, w, h]`) at
    /// `scale` px a u, in `color` (premultiplied in the layer's space), written into `into` at
    /// the crop. `opposite`: `--planted bevel_lit_opposite`, a bevel lit from the other side.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &Device,
        part: &Part,
        scale: f32,
        coverage: &wgpu::TextureView,
        rect: [u32; 4],
        color: [f32; 3],
        opposite: bool,
        into: &wgpu::Texture,
    ) {
        let [x0, y0, w, h] = rect;
        if w == 0 || h == 0 {
            return;
        }
        // A copy's rows land on 256-byte boundaries: 16 px of four f32.
        let stride = w.div_ceil(16) * 16;
        let rgba = device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("paint fx rgba"),
            size: u64::from(stride) * u64::from(h) * 16,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let mut p = Plan {
            fx: self,
            device,
            encoder: device.device.create_command_encoder(&Default::default()),
            size: [w, h],
            origin: [x0, y0],
            coverage,
            buffers: Vec::new(),
            rgba,
            stride,
        };
        let a = p.run("cov", [None, None, None], Step::default());
        let alpha = match part {
            Part::Drop(d) => {
                let m = p.shift(a, [d.offset[0] as f32 * scale, d.offset[1] as f32 * scale]);
                let b = p.blur(m, d.blur as f32 * scale);
                p.one("lin", b, Step { f: [d.opacity as f32, 0.0, 0.0, 0.0], ..Step::default() })
            }
            Part::Halo(h) => {
                let grown = p.dilate(a, h.width as f32 * scale);
                let m = p.shift(grown, [h.offset[0] as f32 * scale, h.offset[1] as f32 * scale]);
                let b = p.blur(m, h.blur as f32 * scale);
                p.one("lin", b, Step { f: [h.opacity as f32, 0.0, 0.0, 0.0], ..Step::default() })
            }
            Part::Inner(s) => {
                let l = fx::toward(s.light);
                let off = s.offset as f32 * scale;
                let m = p.one("outside_moved", a, Step { f: [l[0] * off, l[1] * off, 0.0, 0.0], ..Step::default() });
                let radius = s.blur as f32 * scale;
                let grown = p.dilate(m, radius * s.choke as f32);
                let soft = p.blur(grown, radius * (1.0 - s.choke as f32));
                p.run("mul", [Some(soft), Some(a), None], Step { f: [s.opacity as f32, 0.0, 0.0, 0.0], ..Step::default() })
            }
            Part::Glow(g) => {
                let size = g.size as f32 * scale;
                let spread = g.spread as f32;
                let source = if g.inner {
                    p.one("lin", a, Step { f: [-1.0, 1.0, 0.0, 0.0], ..Step::default() })
                } else {
                    a
                };
                let grown = p.dilate(source, size * spread);
                let soft = p.blur(grown, size * (1.0 - spread));
                let kind = match (g.inner, g.center) {
                    (false, _) => 0,
                    (true, false) => 1,
                    (true, true) => 2,
                };
                p.run("glow", [Some(soft), Some(a), None], Step { f: [g.opacity as f32, 0.0, 0.0, 0.0], k: [kind, 0, 0, 0], ..Step::default() })
            }
            Part::Satin(s) => {
                let l = fx::toward(s.angle);
                let off = s.offset as f32 * scale;
                let one = p.shift(a, [l[0] * off, l[1] * off]);
                let one = p.blur(one, s.size as f32 * scale);
                let two = p.shift(a, [-l[0] * off, -l[1] * off]);
                let two = p.blur(two, s.size as f32 * scale);
                p.run("satin", [Some(one), Some(two), Some(a)], Step { f: [s.opacity as f32, 0.0, 0.0, 0.0], k: [u32::from(s.invert), 0, 0, 0], ..Step::default() })
            }
            Part::Bevel(b, high) => {
                let size = (b.size as f32 * scale).max(0.5);
                let shape = match b.shape {
                    Shape::Inner => 0,
                    Shape::Outer => 1,
                    Shape::Emboss => 2,
                    Shape::Pillow => 3,
                };
                let d = p.one("distance", a, Step { f: [size, 0.0, 0.0, 0.0], ..Step::default() });
                let hgt = p.one("height", d, Step { f: [size, 0.0, 0.0, 0.0], k: [shape, u32::from(b.chisel), 0, 0], ..Step::default() });
                let hgt = p.blur(hgt, b.soften as f32 * scale);
                let angle = if opposite { b.angle + 180.0 } else { b.angle };
                let l = fx::toward(angle);
                let alt = deep_canvas::ops::rad(b.altitude);
                let (lc, lz) = (deep_canvas::ops::cos(alt) as f32, deep_canvas::ops::sin(alt) as f32);
                let k = 2.0 * b.depth as f32 * size;
                let opacity = if *high { b.highlight.1 } else { b.shadow.1 } as f32;
                p.run("lit", [Some(hgt), Some(a), None], Step {
                    f: [l[0] * lc, l[1] * lc, lz, k],
                    g: [opacity, 0.0, 0.0, 0.0],
                    k: [shape, 0, u32::from(*high), 0],
                })
            }
        };
        p.one("paint", alpha, Step { f: [color[0], color[1], color[2], 0.0], k: [0, 0, 0, stride], ..Step::default() });
        let mut encoder = p.encoder;
        encoder.copy_buffer_to_texture(
            wgpu::TexelCopyBufferInfo {
                buffer: &p.rgba,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(p.stride * 16),
                    rows_per_image: Some(h),
                },
            },
            into.as_image_copy_at(x0, y0),
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        device.queue.submit([encoder.finish()]);
    }
}

trait AtOrigin {
    fn as_image_copy_at(&self, x: u32, y: u32) -> wgpu::TexelCopyTextureInfo<'_>;
}

impl AtOrigin for wgpu::Texture {
    fn as_image_copy_at(&self, x: u32, y: u32) -> wgpu::TexelCopyTextureInfo<'_> {
        wgpu::TexelCopyTextureInfo {
            texture: self,
            mip_level: 0,
            origin: wgpu::Origin3d { x, y, z: 0 },
            aspect: wgpu::TextureAspect::All,
        }
    }
}
