//! The status guard and the status colors (issue #382; canvas primitives: Status guard, The
//! status-color rule): the two passes after the finish, wherever status can show. The guard runs
//! over the finished frame (display-referred, sRGB-encoded, f32), moving every pixel within the
//! look's distance of a status color to the nearest allowed color and counting what it moved
//! (the `status_guard {pixels_moved}` notice); the status colors then composite the status layer,
//! the marks and the legend the driver rasterized, over the slot, so their pixels are exact and
//! nothing the frame drew covers them. Neither runs in a document where status can't show: the
//! driver attaches the stage only there.

use std::sync::{mpsc, Arc, Mutex};

use bytemuck::{Pod, Zeroable};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, Resolution};
use deep_gpu::surface::FORMAT;

use crate::{read_texture, timed, After, AfterFrame, Profiler};

const SHADER: &str = include_str!("status.wgsl");
/// The pass that moves operator pixels off the status colors, in the frame's status_guard place.
pub const GUARD_PASS: &str = "status.guard";
/// The pass that draws the status marks and the legend, in the frame's status_colors place.
pub const COLORS_PASS: &str = "status.colors";
/// The finished frame's format: display-referred, sRGB-encoded, in f32 so the guard's move is
/// exact before the slot quantizes it.
pub const FINISHED: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

/// How the guard moves a clashing pixel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Along the OKLab line from the nearest status color through the pixel to the distance.
    Line,
    /// The planted guard: every clashing pixel to grey OKLab (0.80, 0, 0).
    Grey,
}

/// The look's status map as the guard reads it: each status color in OKLab, and the distance.
#[derive(Clone, Debug, PartialEq)]
pub struct Guard {
    pub colors: Vec<[f64; 3]>,
    pub min_distance: f64,
    pub mode: Mode,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GuardUniform {
    colors: [[f32; 4]; 9],
    count: u32,
    min_distance: f32,
    mode: u32,
    quantize: u32,
}

impl Guard {
    /// The uniform; `quantize` when the run's target is an 8-bit slot.
    fn uniform(&self, quantize: bool) -> GuardUniform {
        let mut colors = [[0f32; 4]; 9];
        for (slot, c) in colors.iter_mut().zip(&self.colors) {
            *slot = [c[0] as f32, c[1] as f32, c[2] as f32, 0.0];
        }
        GuardUniform {
            colors,
            count: self.colors.len().min(9) as u32,
            min_distance: self.min_distance as f32,
            mode: match self.mode {
                Mode::Line => 0,
                Mode::Grey => 1,
            },
            quantize: u32::from(quantize),
        }
    }
}

/// The status layer the driver rasterized: premultiplied RGBA, rows top-down, at the frame's size.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub size: [u32; 2],
    pub rgba: Arc<[u8]>,
}

/// The stage's GPU side: the two pipelines, the guard's uniform and its counter, and the layer.
pub struct Stage {
    guard_layout: wgpu::BindGroupLayout,
    guard_slot: wgpu::RenderPipeline,
    guard_f32: wgpu::RenderPipeline,
    uniform: wgpu::Buffer,
    counter: wgpu::Buffer,
    colors_layout: wgpu::BindGroupLayout,
    colors_pipeline: wgpu::RenderPipeline,
    layer_texture: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    pub guard: Option<Guard>,
    pub layer: Option<Layer>,
    pub profiler: Option<Profiler>,
}

/// The stage shared between the GPU-layer view (which runs its passes) and the driver (which sets
/// the guard and the layer each frame and reads the count after it).
pub type SharedStage = Arc<Mutex<Stage>>;

/// A lock that outlives a panic on the other side.
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn texture_layout() -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding: 0,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn buffer_layout(binding: u32, ty: wgpu::BufferBindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl Stage {
    pub fn new(device: &Device) -> Stage {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("status"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let guard_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(GUARD_PASS),
            entries: &[
                texture_layout(),
                buffer_layout(1, wgpu::BufferBindingType::Uniform),
                buffer_layout(2, wgpu::BufferBindingType::Storage { read_only: false }),
            ],
        });
        let colors_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(COLORS_PASS),
            entries: &[texture_layout()],
        });
        let pipeline = |label: &str,
                        layout: &wgpu::BindGroupLayout,
                        entry: &str,
                        format: wgpu::TextureFormat,
                        blend: Option<wgpu::BlendState>| {
            let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: &[Some(layout)],
                immediate_size: 0,
            });
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pl),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("full_vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let guard_slot = pipeline(GUARD_PASS, &guard_layout, "guard_fs", FORMAT, None);
        let guard_f32 = pipeline(GUARD_PASS, &guard_layout, "guard_fs", FINISHED, None);
        let colors_pipeline = pipeline(
            COLORS_PASS,
            &colors_layout,
            "colors_fs",
            FORMAT,
            Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
        );
        let uniform = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("status guard"),
            size: std::mem::size_of::<GuardUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let counter = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("status guard moved"),
            size: 4,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        Stage {
            guard_layout,
            guard_slot,
            guard_f32,
            uniform,
            counter,
            colors_layout,
            colors_pipeline,
            layer_texture: None,
            guard: None,
            layer: None,
            profiler: None,
        }
    }

    /// Writes the guard's uniform and clears its counter for one run; `quantize` when the run's
    /// target is an 8-bit slot.
    fn arm(&self, device: &Device, guard: &Guard, quantize: bool) {
        deep_gpu::alloc::outside(|| {
            device.queue.write_buffer(
                &self.uniform,
                0,
                bytemuck::bytes_of(&guard.uniform(quantize)),
            );
            device.queue.write_buffer(&self.counter, 0, &[0, 0, 0, 0]);
        });
    }

    fn guard_bind(&self, device: &Device, input: &wgpu::TextureView) -> wgpu::BindGroup {
        deep_gpu::alloc::outside(|| {
            device.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(GUARD_PASS),
                layout: &self.guard_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(input),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: self.uniform.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: self.counter.as_entire_binding(),
                    },
                ],
            })
        })
    }

    /// The layer's texture at its size, written from the layer's bytes.
    fn upload_layer(&mut self, device: &Device, layer: &Layer) -> wgpu::TextureView {
        let d = &device.device;
        if self
            .layer_texture
            .as_ref()
            .is_none_or(|(_, _, s)| *s != layer.size)
        {
            let texture = deep_gpu::alloc::outside(|| {
                d.create_texture(&wgpu::TextureDescriptor {
                    label: Some("status layer"),
                    size: wgpu::Extent3d {
                        width: layer.size[0],
                        height: layer.size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                })
            });
            let view = texture.create_view(&Default::default());
            self.layer_texture = Some((texture, view, layer.size));
        }
        let (texture, view, _) = self.layer_texture.as_ref().expect("made above");
        deep_gpu::alloc::outside(|| {
            device.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &layer.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(layer.size[0] * 4),
                    rows_per_image: Some(layer.size[1]),
                },
                wgpu::Extent3d {
                    width: layer.size[0],
                    height: layer.size[1],
                    depth_or_array_layers: 1,
                },
            );
        });
        view.clone()
    }

    /// How many pixels the last run's guard moved: the counter, read back once the run is done.
    pub fn moved(&self, device: &Device) -> Option<u32> {
        let d = &device.device;
        let staging = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("status guard moved read back"),
            size: 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = d.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(&self.counter, 0, &staging, 0, 4);
        device.queue.submit([encoder.finish()]);
        let (tx, rx) = mpsc::channel();
        staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        if !matches!(rx.recv(), Ok(Ok(()))) {
            return None;
        }
        let data = staging.slice(..).get_mapped_range().ok()?;
        Some(u32::from_le_bytes(data[..4].try_into().ok()?))
    }

    /// Runs the guard alone over `input` (f32 RGBA, rows top-down, `size`): the guarded image in
    /// the same shape and how many pixels moved (the `guard` call).
    pub fn guard_image(
        &mut self,
        device: &Device,
        guard: &Guard,
        input: &[u8],
        size: [u32; 2],
    ) -> Option<(Vec<u8>, u32)> {
        let d = &device.device;
        let texture = |label, usage| {
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
                format: FINISHED,
                usage,
                view_formats: &[],
            })
        };
        let source = texture(
            "status guard input",
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        device.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &source,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            input,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size[0] * 16),
                rows_per_image: Some(size[1]),
            },
            wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
        );
        let target = texture(
            "status guard output",
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        );
        self.arm(device, guard, false);
        let bind = self.guard_bind(device, &source.create_view(&Default::default()));
        let mut encoder = d.create_command_encoder(&Default::default());
        full_pass(
            &mut encoder,
            GUARD_PASS,
            &target.create_view(&Default::default()),
            wgpu::LoadOp::Clear(wgpu::Color::BLACK),
            &self.guard_f32,
            &bind,
            None,
        );
        device.queue.submit([encoder.finish()]);
        let out = read_texture(device, &target, size, 16)?;
        let moved = self.moved(device)?;
        Some((out, moved))
    }
}

/// One full-screen triangle into `target` with `pipeline` and its bind group.
fn full_pass(
    encoder: &mut wgpu::CommandEncoder,
    label: &'static str,
    target: &wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
    pipeline: &wgpu::RenderPipeline,
    bind: &wgpu::BindGroup,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    deep_gpu::alloc::outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: timestamps,
            ..Default::default()
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..3, 0..1);
    });
}

/// The stage as the frame's passes after the finish.
pub struct Shared(pub SharedStage);

impl After for Shared {
    fn passes(&self) -> Vec<Pass> {
        let pass = |name: &str, place, ns_per_px| Pass {
            name: name.into(),
            place,
            order: 0,
            reads: vec!["slot"],
            writes: vec!["slot"],
            resolution: Resolution::Full,
            ns_per_px,
            determinism: Determinism::SameMachine,
        };
        vec![
            pass(GUARD_PASS, "status_guard", 0.08),
            pass(COLORS_PASS, "status_colors", 0.02),
        ]
    }

    fn jobs(&mut self, device: &Device, frame: &AfterFrame<'_>) -> Vec<(String, Job)> {
        let mut s = lock(&self.0);
        let mut jobs: Vec<(String, Job)> = Vec::new();
        let profiler = s.profiler.clone();
        // The guard: the finished frame into the slot, every clashing pixel moved. Without a
        // guard (status can't show) the stage isn't attached, so this always runs here.
        let guard = s.guard.clone().unwrap_or(Guard {
            colors: Vec::new(),
            min_distance: 0.0,
            mode: Mode::Line,
        });
        s.arm(device, &guard, true);
        let bind = s.guard_bind(device, frame.finished);
        let (slot, pipeline, p) = (frame.slot.clone(), s.guard_slot.clone(), profiler.clone());
        jobs.push((
            GUARD_PASS.into(),
            Box::new(move |encoder| {
                timed(&p, GUARD_PASS, encoder, |encoder, timestamps| {
                    full_pass(
                        encoder,
                        GUARD_PASS,
                        &slot,
                        wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        &pipeline,
                        &bind,
                        timestamps,
                    )
                })
            }),
        ));
        // The status colors: the layer over the slot, exact.
        if let Some(layer) = s.layer.clone() {
            let view = s.upload_layer(device, &layer);
            let bind = deep_gpu::alloc::outside(|| {
                device.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(COLORS_PASS),
                    layout: &s.colors_layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&view),
                    }],
                })
            });
            let (slot, pipeline) = (frame.slot.clone(), s.colors_pipeline.clone());
            jobs.push((
                COLORS_PASS.into(),
                Box::new(move |encoder| {
                    timed(&profiler, COLORS_PASS, encoder, |encoder, timestamps| {
                        full_pass(
                            encoder,
                            COLORS_PASS,
                            &slot,
                            wgpu::LoadOp::Load,
                            &pipeline,
                            &bind,
                            timestamps,
                        )
                    })
                }),
            ));
        }
        jobs
    }
}
