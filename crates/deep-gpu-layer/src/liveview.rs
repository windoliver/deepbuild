//! One session's live view (issue #379; canvas primitives: GPU surface, Meter and degrade
//! ladder): its document drawn by the canvas core into the GPU surface's slots, each frame at the
//! rung its ladder holds, every pass timed by timestamp writes where the device has them and by
//! its CPU encode time where it doesn't. Below internal scale 1 the frame renders smaller and
//! the upscale's two passes bring it to the slot; frame history, when the look asks for it,
//! resolves the window's frames into the linear target. What the view allocates is counted at
//! the sizes the device reports. Once warm, a frame allocates nothing on the core's side.

use std::sync::Arc;
use std::time::Instant;

use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Depth, Labels, Refused};
use deep_gpu::alloc::outside;
use deep_gpu::device::Device;
use deep_gpu::memory;
use deep_gpu::meter::{Rung, MAX_PASSES};
use deep_gpu::surface::{allocate, Handoff, Path, FORMAT};
use deep_scene3d_render::{Planted as Planted3, Renderer, LINEAR};

pub const SLOTS: u32 = 3;
pub const UPSCALE: &str = "surface.upscale";
pub const SHARPEN: &str = "surface.sharpen";
pub const HISTORY: &str = "look.history";
pub const PLACEHOLDER: &str = "surface.placeholder";

const SHADER: &str = include_str!("effects.wgsl");

/// The upscale's pipelines, which a rung below scale 1 adds: compiled off-screen before it
/// takes effect.
pub struct Upscale {
    pub upscale: wgpu::RenderPipeline,
    pub sharpen: wgpu::RenderPipeline,
}

/// What every live view on the device shares: the effect shader's layouts and sampler, and the
/// pipelines every rung has.
pub struct Kit {
    pub source: wgpu::BindGroupLayout,
    history: wgpu::BindGroupLayout,
    pub sampler: wgpu::Sampler,
    resolve: wgpu::RenderPipeline,
    /// Adds an effect target into the linear target.
    #[cfg(feature = "test-meter")]
    pub composite: wgpu::RenderPipeline,
    pub upscale: Option<Arc<Upscale>>,
    #[cfg(feature = "test-meter")]
    pub test: crate::testgpu::Pipes,
}

fn pipeline(
    device: &Device,
    layout: &wgpu::BindGroupLayout,
    module: &wgpu::ShaderModule,
    entry: &str,
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
) -> wgpu::RenderPipeline {
    let d = &device.device;
    let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(entry),
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(entry),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some("full"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module,
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
}

fn shader(device: &Device) -> wgpu::ShaderModule {
    device
        .device
        .create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("live effects"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        })
}

/// The upscale's two pipelines, as the compile thread builds them.
pub fn compile_upscale(device: &Device, source: &wgpu::BindGroupLayout) -> Upscale {
    let module = shader(device);
    Upscale {
        upscale: pipeline(device, source, &module, "upscale", FORMAT, None),
        sharpen: pipeline(device, source, &module, "sharpen", FORMAT, None),
    }
}

impl Kit {
    pub fn new(device: &Device) -> Kit {
        let d = &device.device;
        let texture = |dimension| wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: dimension,
                multisampled: false,
            },
            count: None,
        };
        let source = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("live source"),
            entries: &[
                texture(wgpu::TextureViewDimension::D2),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let history = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("live history"),
            entries: &[
                texture(wgpu::TextureViewDimension::D2Array),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("live"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let module = shader(device);
        Kit {
            resolve: pipeline(device, &history, &module, "resolve", LINEAR, None),
            #[cfg(feature = "test-meter")]
            composite: pipeline(
                device,
                &source,
                &module,
                "composite",
                LINEAR,
                Some(wgpu::BlendState {
                    color: wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::One,
                        dst_factor: wgpu::BlendFactor::One,
                        operation: wgpu::BlendOperation::Add,
                    },
                    alpha: wgpu::BlendComponent::OVER,
                }),
            ),
            source,
            history,
            sampler,
            upscale: None,
            #[cfg(feature = "test-meter")]
            test: crate::testgpu::Pipes::new(device),
        }
    }

    pub fn bind_source(&self, device: &Device, view: &wgpu::TextureView) -> wgpu::BindGroup {
        device.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("live source"),
            layout: &self.source,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }
}

/// One pass as the frame's meter reads it: its name, its view, and its interval in timestamp
/// ticks or, without timestamps, in CPU encode time.
#[derive(Clone, Copy, Debug, Default)]
pub struct Mark {
    pub name: &'static str,
    pub session: usize,
    /// CPU encode time, in ns from the frame's start.
    pub cpu: [u64; 2],
    pub ticks: [u64; 2],
}

/// A frame's pass timer: two timestamp writes per pass into one query set, resolved once per
/// frame; with no timestamps, each pass's CPU encode time.
pub struct Timer {
    query: Option<(wgpu::QuerySet, wgpu::Buffer, wgpu::Buffer, f64)>,
    pub marks: [Mark; MAX_PASSES],
    pub n: usize,
    origin: Instant,
}

impl Timer {
    pub fn new(device: &Device) -> Timer {
        let query = device.timestamps.period_ns.map(|period| {
            let d = &device.device;
            let count = 2 * MAX_PASSES as u32;
            let set = d.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("live passes"),
                ty: wgpu::QueryType::Timestamp,
                count,
            });
            let size = u64::from(count) * 8;
            let resolve = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("live pass times"),
                size,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            let read = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("live pass times read"),
                size,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            (set, resolve, read, f64::from(period))
        });
        Timer {
            query,
            marks: [Mark::default(); MAX_PASSES],
            n: 0,
            origin: Instant::now(),
        }
    }

    pub fn timed(&self) -> bool {
        self.query.is_some()
    }

    pub fn period_ns(&self) -> Option<f64> {
        self.query.as_ref().map(|q| q.3)
    }

    pub fn begin_frame(&mut self) {
        self.n = 0;
        self.origin = Instant::now();
    }

    fn since(&self) -> u64 {
        self.origin.elapsed().as_nanos() as u64
    }

    /// Starts timing a pass; `None` once a frame has more passes than the set holds.
    pub fn start(&mut self, name: &'static str, session: usize) -> Option<usize> {
        if self.n >= MAX_PASSES {
            return None;
        }
        let i = self.n;
        self.marks[i] = Mark {
            name,
            session,
            cpu: [self.since(), 0],
            ticks: [0, 0],
        };
        self.n += 1;
        Some(i)
    }

    pub fn writes(&self, i: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        let (set, ..) = self.query.as_ref()?;
        let i = i? as u32;
        Some(wgpu::RenderPassTimestampWrites {
            query_set: set,
            beginning_of_pass_write_index: Some(2 * i),
            end_of_pass_write_index: Some(2 * i + 1),
        })
    }

    pub fn end(&mut self, i: Option<usize>) {
        if let Some(i) = i {
            self.marks[i].cpu[1] = self.since();
        }
    }

    /// Resolves the frame's timestamps into the read-back buffer, at the end of its encoder.
    pub fn resolve(&self, encoder: &mut wgpu::CommandEncoder) {
        if let (Some((set, resolve, read, _)), true) = (&self.query, self.n > 0) {
            let n = 2 * self.n as u32;
            outside(|| {
                encoder.resolve_query_set(set, 0..n, resolve, 0);
                encoder.copy_buffer_to_buffer(resolve, 0, read, 0, u64::from(n) * 8);
            });
        }
    }

    /// After the frame's work is done: each pass's ticks.
    pub fn read(&mut self, device: &Device) {
        let Some((_, _, read, _)) = &self.query else {
            return;
        };
        if self.n == 0 {
            return;
        }
        let size = 16 * self.n as u64;
        let ok = outside(|| {
            let slice = read.slice(..size);
            slice.map_async(wgpu::MapMode::Read, |_| {});
            let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
            match slice.get_mapped_range() {
                Ok(data) => {
                    for (i, ticks) in data.as_chunks::<16>().0.iter().enumerate() {
                        let begin = u64::from_le_bytes(ticks[..8].try_into().expect("8 bytes"));
                        let end = u64::from_le_bytes(ticks[8..].try_into().expect("8 bytes"));
                        self.marks[i].ticks = [begin, end];
                    }
                    true
                }
                Err(_) => false,
            }
        });
        if ok {
            outside(|| read.unmap());
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

fn texture(
    device: &Device,
    label: &'static str,
    size: [u32; 2],
    layers: u32,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: layers,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

/// Below scale 1: the frame's output at its internal size and the full-size target between the
/// upscale's two passes.
struct Low {
    size: [u32; 2],
    view: wgpu::TextureView,
    up_view: wgpu::TextureView,
    low_bind: wgpu::BindGroup,
    up_bind: wgpu::BindGroup,
    bytes: Option<u64>,
}

impl Low {
    fn new(device: &Device, kit: &Kit, internal: [u32; 2], size: [u32; 2]) -> Low {
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let ((low, up), bytes) = memory::across(device, || {
            (
                texture(device, "live low", internal, 1, FORMAT, usage),
                texture(device, "live upscaled", size, 1, FORMAT, usage),
            )
        });
        let view = low.create_view(&Default::default());
        let up_view = up.create_view(&Default::default());
        Low {
            size: internal,
            low_bind: kit.bind_source(device, &view),
            up_bind: kit.bind_source(device, &up_view),
            view,
            up_view,
            bytes,
        }
    }
}

/// Frame history: the window's frames at the internal size, one array layer each.
struct History {
    size: [u32; 2],
    window: u32,
    texture: wgpu::Texture,
    uniform: wgpu::Buffer,
    bind: wgpu::BindGroup,
    frames: u64,
    bytes: Option<u64>,
}

impl History {
    fn new(device: &Device, kit: &Kit, internal: [u32; 2], window: u32) -> History {
        let ((texture, uniform), bytes) = memory::across(device, || {
            (
                texture(
                    device,
                    "live history",
                    internal,
                    window,
                    LINEAR,
                    wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                ),
                device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("live history count"),
                    size: 16,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
            )
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let bind = device.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("live history"),
            layout: &kit.history,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        History {
            size: internal,
            window,
            texture,
            uniform,
            bind,
            frames: 0,
            bytes,
        }
    }
}

/// What a frame draws a view with beyond its document: its rung, the view's turn, its
/// effects' resolution, and whether this is a canonical render (no history, ever).
#[derive(Clone, Copy, Debug)]
pub struct Drawing {
    pub rung: Rung,
    pub offsets: Offsets,
    pub effects_resolution: f64,
    pub canonical: bool,
}

pub struct View {
    pub size: [u32; 2],
    slots: Vec<Box<dyn Handoff>>,
    next: usize,
    /// The slot the last drawn frame is in.
    pub shown: Option<usize>,
    renderer: Renderer,
    pub frames: Frames,
    /// The internal scale and history window that fit, at the class's base rung.
    pub scale: f64,
    pub window: u32,
    low: Option<Low>,
    history: Option<History>,
    /// What the view allocated beyond `low` and `history`, as the device reports it.
    base_bytes: Option<u64>,
    #[cfg(feature = "test-meter")]
    pub test: crate::testgpu::Items,
}

impl View {
    /// A view of `size` with `slots` slots, drawing `frames`, its fit's scale and window.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &Device,
        path: Path,
        size: [u32; 2],
        slots: u32,
        frames: Frames,
        scale: f64,
        window: u32,
        look: &Look3,
        labels: &mut Labels,
    ) -> Result<View, String> {
        let ((slots, renderer, frames), base_bytes) = memory::across(device, || {
            let slots: Result<Vec<_>, String> =
                (0..slots).map(|_| allocate(device, path, size)).collect();
            let mut renderer = Renderer::new(device, Planted3::default());
            let mut frames = frames;
            if let Ok(scene) = frames.at(0, scaled(size, scale), &Offsets::default(), labels) {
                renderer.prepare(device, scene, look);
            }
            (slots, renderer, frames)
        });
        Ok(View {
            size,
            slots: slots?,
            next: 0,
            shown: None,
            renderer,
            frames,
            scale,
            window,
            low: None,
            history: None,
            base_bytes,
            #[cfg(feature = "test-meter")]
            test: crate::testgpu::Items::default(),
        })
    }

    /// What the view itself holds on the device, as the device reports it.
    pub fn own_bytes(&self) -> Option<u64> {
        let low = self.low.as_ref().map_or(Some(0), |l| l.bytes);
        let history = self.history.as_ref().map_or(Some(0), |h| h.bytes);
        #[cfg(feature = "test-meter")]
        let test = self.test.bytes();
        #[cfg(not(feature = "test-meter"))]
        let test = Some(0);
        Some(self.base_bytes? + low? + history? + test?)
    }

    /// The pixels its effect pass shades, while it has one.
    #[cfg(feature = "test-meter")]
    pub fn effect_px(&self) -> Option<u64> {
        self.test.effect_px()
    }

    /// Render pipelines its document has needed so far.
    pub fn pipelines(&self) -> u32 {
        self.renderer.pipelines()
    }

    /// The history window it draws with now, 0 without history.
    pub fn history_frames(&self, drawing: &Drawing) -> u32 {
        if drawing.canonical {
            0
        } else {
            self.window
        }
    }

    /// The slot's pixels, BGRA rows top-down, after its frame finished.
    pub fn pixels(&self) -> Option<Vec<u8>> {
        Some(self.slots[self.shown?].read())
    }

    /// Records the frame at `t` into `encoder`, each pass timed by `timer` as `session`'s. Fails
    /// only when the document can't be evaluated.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        device: &Device,
        kit: &Kit,
        look: &Look3,
        t: i64,
        drawing: &Drawing,
        labels: &mut Labels,
        encoder: &mut wgpu::CommandEncoder,
        timer: &mut Timer,
        session: usize,
    ) -> Result<(), Refused> {
        let scale = if drawing.canonical {
            1.0
        } else {
            drawing.rung.scale(self.scale)
        };
        let internal = scaled(self.size, scale);
        let slot = self.next;
        self.next = (self.next + 1) % self.slots.len();
        self.shown = Some(slot);
        let slot_view = self.slots[slot].target().clone();
        if drawing.rung == Rung::Placeholder && !drawing.canonical {
            let i = timer.start(PLACEHOLDER, session);
            outside(|| {
                let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(PLACEHOLDER),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &slot_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    timestamp_writes: timer.writes(i),
                    ..Default::default()
                });
            });
            timer.end(i);
            self.after(encoder, slot);
            return Ok(());
        }
        let scene = self.frames.at(t, internal, &drawing.offsets, labels)?;
        let clip = scene.camera.clip(Depth::Reversed);
        self.renderer.prepare(device, scene, look);
        let i = timer.start(GEOMETRY_PASS, session);
        self.renderer.record_geometry(encoder, timer.writes(i));
        timer.end(i);
        let Some((linear_texture, linear)) = self.renderer.linear() else {
            return Ok(());
        };
        let (linear_texture, linear) = (linear_texture.clone(), linear.clone());
        #[cfg(feature = "test-meter")]
        self.test.record(
            device,
            kit,
            &crate::testgpu::Frame {
                clip,
                internal,
                lod_down: !drawing.canonical && drawing.rung.lod_down(),
                effects: drawing.canonical || drawing.rung.effects(),
                resolution: if drawing.canonical {
                    1.0
                } else {
                    drawing.effects_resolution
                },
            },
            encoder,
            &linear,
            timer,
            session,
        );
        #[cfg(not(feature = "test-meter"))]
        let _ = (clip, &linear, drawing.effects_resolution);
        if self.window > 0 && !drawing.canonical {
            self.resolve_history(
                device,
                kit,
                internal,
                encoder,
                &linear_texture,
                &linear,
                timer,
                session,
            );
        }
        if scale < 1.0 {
            if self.low.as_ref().is_none_or(|l| l.size != internal) {
                self.low = Some(Low::new(device, kit, internal, self.size));
            }
            let low = self.low.as_ref().expect("made above");
            let i = timer.start(OUTPUT_PASS, session);
            self.renderer
                .record_output(encoder, &low.view, timer.writes(i));
            timer.end(i);
            if let Some(up) = kit.upscale.as_ref() {
                for (name, pipeline, bind, target) in [
                    (UPSCALE, &up.upscale, &low.low_bind, &low.up_view),
                    (SHARPEN, &up.sharpen, &low.up_bind, &slot_view),
                ] {
                    let i = timer.start(name, session);
                    full_pass(
                        encoder,
                        name,
                        target,
                        pipeline,
                        bind,
                        false,
                        timer.writes(i),
                    );
                    timer.end(i);
                }
            }
        } else {
            self.low = None;
            let i = timer.start(OUTPUT_PASS, session);
            self.renderer
                .record_output(encoder, &slot_view, timer.writes(i));
            timer.end(i);
        }
        self.after(encoder, slot);
        Ok(())
    }

    fn after(&self, encoder: &mut wgpu::CommandEncoder, slot: usize) {
        outside(|| self.slots[slot].after_render(encoder));
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve_history(
        &mut self,
        device: &Device,
        kit: &Kit,
        internal: [u32; 2],
        encoder: &mut wgpu::CommandEncoder,
        linear_texture: &wgpu::Texture,
        linear: &wgpu::TextureView,
        timer: &mut Timer,
        session: usize,
    ) {
        if self
            .history
            .as_ref()
            .is_none_or(|h| h.size != internal || h.window != self.window)
        {
            self.history = Some(History::new(device, kit, internal, self.window));
        }
        let h = self.history.as_mut().expect("made above");
        let layer = (h.frames % u64::from(h.window)) as u32;
        h.frames += 1;
        let filled = h.frames.min(u64::from(h.window)) as u32;
        outside(|| {
            device
                .queue
                .write_buffer(&h.uniform, 0, bytemuck::bytes_of(&[filled, 0, 0, 0]));
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: linear_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &h.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: layer,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: internal[0],
                    height: internal[1],
                    depth_or_array_layers: 1,
                },
            );
        });
        let i = timer.start(HISTORY, session);
        full_pass(
            encoder,
            HISTORY,
            linear,
            &kit.resolve,
            &h.bind,
            false,
            timer.writes(i),
        );
        timer.end(i);
    }
}

/// One full-screen pass of `pipeline` reading `bind` into `target`, cleared first unless `load`.
pub fn full_pass(
    encoder: &mut wgpu::CommandEncoder,
    label: &'static str,
    target: &wgpu::TextureView,
    pipeline: &wgpu::RenderPipeline,
    bind: &wgpu::BindGroup,
    load: bool,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: if load {
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
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..3, 0..1);
    });
}
