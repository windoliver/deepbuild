//! One session's live view (issue #379; canvas primitives: GPU surface, Meter and degrade
//! ladder): its document drawn by the canvas core into the GPU surface's slots, each frame at the
//! rung its ladder holds, every pass timed by timestamp writes where the device has them and by
//! its CPU encode time where it doesn't. Below internal scale 1 the frame renders smaller and
//! the upscale's two passes bring it to the slot, then thin lines and outlines draw at full size
//! (#386); frame history, when the look asks for it,
//! resolves the window's frames into the linear target. What the view allocates is counted at
//! the sizes the device reports. Once warm, a frame allocates nothing on the core's side.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Depth, Labels, Refused};
use deep_effects_render::docops::{item_of_mark, DocOps, Fusing, Pool, Rec, Row, Times};
use deep_scene3d_render::created::Created;
use deep_effects_render::runner::Frame;
use deep_gpu::alloc::outside;
use deep_gpu::device::Device;
use deep_gpu::memory;
use deep_gpu::meter::{Rung, MAX_PASSES};
use deep_gpu::surface::{allocate, Handoff, Path};
use deep_scene3d_render::surface::{Filter, Surface, LABEL_PASS, OUTLINE_PASS};
pub use deep_scene3d_render::surface::{Upscale, SHARPEN_PASS as SHARPEN, UPSCALE_PASS as UPSCALE};
use deep_scene3d_render::{Planted as Planted3, Renderer, LINEAR};
use serde_json::Value;

pub const SLOTS: u32 = 3;
pub const HISTORY: &str = "look.history";
pub const PLACEHOLDER: &str = "surface.placeholder";

/// The placeholder a view shows while its device is lost (#1413), drawn on the CPU since no
/// device can: BGRA, two greys in diagonal stripes, so it is never blank or flat.
pub fn placeholder_picture(size: [u32; 2]) -> Vec<u8> {
    let (w, h) = (size[0] as usize, size[1] as usize);
    let mut bgra = vec![0; w * h * 4];
    for (i, px) in bgra.chunks_exact_mut(4).enumerate() {
        let (x, y) = (i % w, i / w);
        let grey = if (x + y) / 16 % 2 == 0 { 96 } else { 148 };
        px.copy_from_slice(&[grey, grey, grey, 255]);
    }
    bgra
}

const SHADER: &str = include_str!("effects.wgsl");

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
    /// The upscale's pipelines, which a rung below scale 1 adds: compiled off-screen before it
    /// takes effect.
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

/// The upscale's pipelines, as the compile thread builds them.
pub fn compile_upscale(device: &Device) -> Upscale {
    Upscale::new(device)
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

    /// A pass's two writes split across two passes: the first writes its beginning, the
    /// second its end, so the passes between them time as one (#397).
    pub fn bracket(
        &self,
        i: Option<usize>,
    ) -> (
        Option<wgpu::RenderPassTimestampWrites<'_>>,
        Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let Some(w) = self.writes(i) else {
            return (None, None);
        };
        (
            Some(wgpu::RenderPassTimestampWrites {
                end_of_pass_write_index: None,
                ..w.clone()
            }),
            Some(wgpu::RenderPassTimestampWrites {
                beginning_of_pass_write_index: None,
                ..w
            }),
        )
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

/// A view's `surface` field (#386): `{internal_scale: 0.5 to 1 = 1, upscale: edge_adaptive |
/// bilinear = edge_adaptive, sharpen: 0 to 1 = 0.2}`; absent, the default.
pub fn surface_of(v: Option<&Value>) -> Result<Surface, String> {
    let mut s = Surface::default();
    let Some(v) = v.filter(|v| !v.is_null()) else {
        return Ok(s);
    };
    let o = v.as_object().ok_or("surface is an object")?;
    if let Some(k) = o.get("internal_scale") {
        s.scale = k
            .as_f64()
            .filter(|k| (0.5..=1.0).contains(k))
            .ok_or("surface.internal_scale is 0.5 to 1")?;
    }
    if let Some(u) = o.get("upscale") {
        s.upscale = u
            .as_str()
            .and_then(Filter::parse)
            .ok_or("surface.upscale is edge_adaptive or bilinear")?;
    }
    if let Some(k) = o.get("sharpen") {
        s.sharpen = k
            .as_f64()
            .filter(|k| (0.0..=1.0).contains(k))
            .ok_or("surface.sharpen is 0 to 1")?;
    }
    Ok(s)
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
    /// Whether a still scene may settle: not while a frame it drew is still in flight, whose
    /// completion releases what it read (#421).
    pub settles: bool,
}

/// What a view draws: a 3D scene's frames, or a 2D document's (#397).
pub enum Content {
    Scene(Box<Frames>),
    Flat(Box<crate::flat::Flat>),
}

pub struct View {
    pub size: [u32; 2],
    slots: Vec<Box<dyn Handoff>>,
    next: usize,
    /// The slot the last drawn frame is in.
    pub shown: Option<usize>,
    renderer: Renderer,
    frames: Content,
    /// Whether the renderer last prepared a scene of `frames`, so a frame need only write what
    /// moved.
    prepared: bool,
    /// The internal scale and history window that fit, at the class's base rung.
    pub scale: f64,
    pub window: u32,
    /// How it returns to full size below scale 1, and its sharpen (#386).
    pub surface: Surface,
    /// The internal scale and the upscale its last frame drew through.
    pub drew: (f64, &'static str),
    history: Option<History>,
    /// What the view allocated beyond `low` and `history`, as the device reports it.
    base_bytes: Option<u64>,
    /// How the last frame drew (its rung and internal scale) and how many frames it has drawn
    /// since its scene last changed: a still scene settles once its history is full (#421).
    still: Option<(Rung, f64, u32)>,
    /// The document's composed pass and compute operators (#429), each at the resolution its
    /// writer's meter gives it, and what each drew last frame.
    pub ops: DocOps,
    /// The session's operator pipelines, kept across its revisions and variant switches, and how
    /// its chain fuses (#432).
    pub pool: Pool,
    pub fusing: Fusing,
    pub op_resolution: BTreeMap<String, f64>,
    pub op_rows: Vec<Row>,
    /// #429's planted render-back, which draws live-only operators as the live view does.
    pub canonical_draws_live_only: bool,
    #[cfg(feature = "test-meter")]
    pub test: crate::testgpu::Items,
}

/// The live meter's timer as the operators' [`Times`], each pass charged to `session`.
struct LiveTimes<'a> {
    timer: &'a mut Timer,
    session: usize,
}

impl Times for LiveTimes<'_> {
    fn start(&mut self, mark: &'static str, _: &mut wgpu::CommandEncoder) -> Option<usize> {
        self.timer.start(mark, self.session)
    }
    fn render(&self, i: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        self.timer.writes(i)
    }
    fn compute(&self, i: Option<usize>) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        self.timer
            .writes(i)
            .map(|w| wgpu::ComputePassTimestampWrites {
                query_set: w.query_set,
                beginning_of_pass_write_index: w.beginning_of_pass_write_index,
                end_of_pass_write_index: w.end_of_pass_write_index,
            })
    }
    fn end(&mut self, i: Option<usize>, _: &mut wgpu::CommandEncoder) {
        self.timer.end(i);
    }
}

impl View {
    /// A view of `size` with `slots` slots, drawing `frames`, its fit's scale and window.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &Device,
        path: Path,
        size: [u32; 2],
        slots: u32,
        frames: Content,
        scale: f64,
        window: u32,
        look: &Look3,
        labels: &mut Labels,
        planted: Planted3,
        warm_shadows: bool,
    ) -> Result<View, String> {
        let ((slots, renderer, frames, prepared), base_bytes) = memory::across(device, || {
            let slots: Result<Vec<_>, String> =
                (0..slots).map(|_| allocate(device, path, size)).collect();
            let mut renderer = Renderer::new(device, planted);
            renderer.warm_shadows = warm_shadows;
            // The view opens at check: what its first scene compiles is the warm-up's (#432).
            renderer.log.warming = true;
            let mut frames = frames;
            let prepared = match &mut frames {
                Content::Scene(frames) => match frames.at(0, size, &Offsets::default(), labels) {
                    Ok(scene) => {
                        renderer.prepare(device, scene, look);
                        true
                    }
                    Err(_) => false,
                },
                Content::Flat(_) => false,
            };
            renderer.log.warming = false;
            (slots, renderer, frames, prepared)
        });
        Ok(View {
            size,
            slots: slots?,
            next: 0,
            shown: None,
            renderer,
            frames,
            prepared,
            scale,
            window,
            surface: Surface::default(),
            drew: (1.0, "none"),
            history: None,
            base_bytes,
            still: None,
            ops: DocOps::empty(),
            pool: Pool::default(),
            fusing: Fusing::default(),
            op_resolution: BTreeMap::new(),
            op_rows: Vec::new(),
            canonical_draws_live_only: false,
            #[cfg(feature = "test-meter")]
            test: crate::testgpu::Items::default(),
        })
    }

    /// The warm-up at check (#432): prepares each scene a revision can reach, so every pipeline
    /// they draw with is compiled before its first frame; none of them is a frame's.
    pub fn warm(&mut self, device: &Device, look: &Look3, scenes: &[deep_canvas_scene3d::scene::Scene]) {
        self.renderer.log.warming = true;
        for scene in scenes {
            self.renderer.prepare(device, scene, look);
        }
        self.renderer.log.warming = false;
        self.prepared = false;
    }

    /// Starts a frame's list of pipelines made.
    pub fn begin_frame(&mut self) {
        self.renderer.log.begin_frame();
        self.pool.log.begin_frame();
    }

    /// Every pipeline made since the frame began that the warm-up didn't make (#432).
    pub fn created(&self) -> Vec<Created> {
        self.renderer
            .log
            .this_frame()
            .chain(self.pool.log.this_frame())
            .cloned()
            .collect()
    }

    /// The operator pipelines the session holds: its pass and compute operators' and its
    /// material operators'.
    pub fn operator_pipelines(&self) -> usize {
        self.pool.len() + self.renderer.material_ops()
    }

    /// Draws `frames` from the next frame on: a revision's document.
    pub fn set_frames(&mut self, frames: Content) {
        self.frames = frames;
        self.prepared = false;
        self.still = None;
    }

    /// The core targets its frames build (#431): those its operators read, or both under the
    /// planted core.
    pub fn want_targets(&mut self, doc: &Value, all: bool) {
        self.renderer.core.want = deep_scene3d_render::targets::Want {
            velocity: all || deep_canvas_effects::module::reads_core(doc, "velocity"),
            emission: all || deep_canvas_effects::module::reads_core(doc, "emission"),
        };
    }

    /// Each core target the view holds (#431): its name, the bytes the meter counts for it
    /// (width × height × its texel's bytes) and the size the device reports for it.
    pub fn targets(&self, device: &Device) -> Vec<(&'static str, u64, Option<u64>)> {
        self.renderer
            .target_rows()
            .into_iter()
            .map(|(name, texture, bytes)| (name, bytes, memory::texture(device, texture)))
            .collect()
    }

    /// What the view itself holds on the device, as the device reports it; the core's velocity
    /// and emission targets, made after it opened and only while read, as the meter counts them.
    pub fn own_bytes(&self) -> Option<u64> {
        let low = Some(self.renderer.low_bytes());
        let core: u64 = self.renderer.core.held().iter().map(|(_, _, b)| b).sum();
        let history = self.history.as_ref().map_or(Some(0), |h| h.bytes);
        #[cfg(feature = "test-meter")]
        let test = self.test.bytes();
        #[cfg(not(feature = "test-meter"))]
        let test = Some(0);
        Some(self.base_bytes? + low? + history? + test? + core)
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

    /// The renderer it draws through.
    pub fn renderer(&self) -> &Renderer {
        &self.renderer
    }

    /// Plants the upscale's wrong programs (#386).
    pub fn plant(&mut self, planted: deep_scene3d_render::surface::Planted) {
        self.renderer.plant_upscale(planted);
    }

    /// The history window it draws with now, 0 without history.
    pub fn history_frames(&self, drawing: &Drawing) -> u32 {
        if drawing.canonical {
            0
        } else {
            self.window
        }
    }

    /// Hands the shown slot its finished frame: a copy slot reads its frame back here, so its
    /// pixels are the frame's only after this.
    pub fn finish(&self, device: &Device) -> Result<(), String> {
        match self.shown {
            Some(s) => self.slots[s].finish(device),
            None => Ok(()),
        }
    }

    /// The slot's pixels, BGRA rows top-down, after its frame finished.
    pub fn pixels(&self) -> Option<Vec<u8>> {
        Some(self.slots[self.shown?].read())
    }

    /// Records the frame at `t` into `encoder`, each pass timed by `timer` as `session`'s, and
    /// says whether it drew: a scene that hasn't changed since a frame drawn the same way, once
    /// its history is full, records nothing (#421). Fails only when the document can't be
    /// evaluated.
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
    ) -> Result<bool, Refused> {
        let scale = if drawing.canonical {
            1.0
        } else {
            drawing.rung.scale(self.scale)
        };
        let evaluated = match &mut self.frames {
            Content::Scene(frames) if !drawing.canonical && drawing.rung != Rung::Placeholder => {
                frames.at(t, self.size, &drawing.offsets, labels)?;
                let still = match self.still {
                    Some((rung, s, n)) if drawing.settles && self.prepared && !frames.changed() => {
                        (rung == drawing.rung && s == scale).then_some(n)
                    }
                    _ => None,
                };
                #[cfg(feature = "test-meter")]
                let still = still.filter(|_| self.test.bound.is_empty());
                if still.is_some_and(|n| n >= self.window) {
                    return Ok(false);
                }
                self.still = Some((drawing.rung, scale, still.map_or(0, |n| n + 1)));
                true
            }
            // #467: a 2D frame that draws what the view last drew records nothing.
            Content::Flat(flat) if !drawing.canonical && drawing.rung != Rung::Placeholder => {
                let still = flat.still(t).map_err(|(code, path)| Refused { code, path })?;
                if still && self.shown.is_some() {
                    return Ok(false);
                }
                false
            }
            _ => {
                self.still = None;
                false
            }
        };
        // The scene is evaluated at the view's size; the renderer draws it at the internal size
        // and returns it to full size through the upscale, once its pipelines are compiled.
        self.renderer.upscale = kit.upscale.clone();
        // The climb's top rung draws the key sun's cascades at twice their size (#425).
        self.renderer.shadow_scale = if !drawing.canonical && drawing.rung <= Rung::Shadows2x {
            2
        } else {
            1
        };
        // Above scale 1 (the climb's 4-samples rung, #425) the bilinear pass at full size averages
        // each pixel's four samples, a box filter, and nothing sharpens them.
        self.renderer.surface = if scale > 1.0 {
            Surface {
                scale,
                upscale: Filter::Bilinear,
                sharpen: 0.0,
            }
        } else {
            Surface {
                scale,
                ..self.surface
            }
        };
        let internal = self.renderer.internal_size(self.size);
        self.drew = if internal == self.size {
            (1.0, "none")
        } else {
            (scale, self.renderer.surface.upscale.name())
        };
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
            return Ok(true);
        }
        let frames = match &mut self.frames {
            Content::Scene(frames) => frames,
            Content::Flat(flat) => {
                self.drew = (1.0, "none");
                flat.draw(device, t, self.size, &slot_view, encoder, timer, session)
                    .map_err(|(code, path)| Refused { code, path })?;
                self.after(encoder, slot);
                return Ok(true);
            }
        };
        if !evaluated {
            frames.at(t, self.size, &drawing.offsets, labels)?;
        }
        let scene = frames.scene();
        let clip = scene.camera.clip(Depth::Reversed);
        // The instances outputs the frame's instancers draw from (#484).
        self.renderer.feed(self.ops.sources());
        match frames.moved().filter(|_| self.prepared) {
            Some(moved) => self.renderer.prepare_moved(device, scene, look, moved),
            None => self.renderer.prepare(device, scene, look),
        }
        self.prepared = true;
        let Some((linear_texture, linear)) = self.renderer.linear() else {
            return Ok(true);
        };
        let (linear_texture, linear) = (linear_texture.clone(), linear.clone());
        // Operators are bound before the frame draws, so what feeds an instances output can
        // record first; the rest record where the effects chain runs.
        let planned = (!self.ops.ops.is_empty()).then(|| {
            // Column-major, as the operators' frame holds it.
            let flat: [f64; 16] = std::array::from_fn(|i| clip[i % 4][i / 4]);
            let frame = Frame {
                clip: flat.map(|x| x as f32),
                inverse_clip: deep_effects_render::reference::inverse(&flat).map(|x| x as f32),
                eye: [0.0; 4],
                t: (t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64) as f32,
                seed: 0,
            };
            let roles: BTreeMap<String, [f64; 3]> = look
                .roles
                .iter()
                .map(|(k, c)| (k.clone(), crate::effects::linear_of(*c)))
                .collect();
            let res = &self.op_resolution;
            let canonical = drawing.canonical && !self.canonical_draws_live_only;
            self.ops.core = ["velocity", "emission"]
                .into_iter()
                .filter_map(|n| Some((n, self.renderer.core_target(n)?.clone())))
                .collect();
            // Stepped operators count fixed steps from the exact time, not its f32 (#252).
            self.ops.clock = Some(t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64);
            self.ops.plan(
                device,
                &linear,
                None,
                None,
                internal,
                &frame,
                &roles,
                &|i| res.get(i).copied().unwrap_or(1.0),
                canonical,
            )
        });
        let early = |r: &Rec| item_of_mark(r.mark).is_some_and(|i| self.ops.early.contains(i));
        if let Some((_, recs, _)) = &planned {
            let mut times = LiveTimes { timer, session };
            for r in recs.iter().filter(|r| early(r)) {
                outside(|| r.record(encoder, &mut times));
            }
        }
        let i = timer.start(GEOMETRY_PASS, session);
        self.renderer.record_geometry(encoder, timer.writes(i));
        timer.end(i);
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
        let _ = drawing.effects_resolution;
        if let Some((rows, recs, out)) = planned {
            let mut times = LiveTimes { timer, session };
            for r in recs.iter().filter(|r| !early(r)) {
                outside(|| r.record(encoder, &mut times));
            }
            if let Some(o) = out {
                outside(|| self.ops.blit_into(device, encoder, &o, &linear, internal));
            }
            self.op_rows = rows;
        }
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
        let i = timer.start(OUTPUT_PASS, session);
        match self.renderer.low_view(device) {
            Some(low) => {
                self.renderer.record_output(encoder, &low, timer.writes(i));
                timer.end(i);
                for step in self
                    .renderer
                    .surface_steps(device, &slot_view)
                    .into_iter()
                    .flatten()
                {
                    let i = timer.start(step.name(), session);
                    step.record(encoder, timer.writes(i));
                    timer.end(i);
                }
            }
            None => {
                self.renderer
                    .record_output(encoder, &slot_view, timer.writes(i));
                timer.end(i);
            }
        }
        for (name, draw) in [
            (OUTLINE_PASS, self.renderer.outline_draw(false)),
            (LABEL_PASS, self.renderer.label_draw()),
        ] {
            if let Some(draw) = draw {
                let i = timer.start(name, session);
                draw.record(encoder, &slot_view, timer.writes(i));
                timer.end(i);
            }
        }
        self.after(encoder, slot);
        Ok(true)
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
