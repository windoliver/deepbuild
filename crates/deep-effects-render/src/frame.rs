//! The shipped effects in a 3D view's frame (canvas primitives: Place in the frame): scene3d's
//! [`Post`] passes, after its geometry and before its output. The effects chain runs in order (the
//! ground grid, the key light's shadow, sparks, the selection outline), each pass reading the last
//! one's linear target and writing its own (sparks draw into it in place); then the glow's chain
//! in the bloom place, whose result the output pass tone-maps. Each pass is one GPU operator's,
//! and each GPU pass is timed with wgpu-profiler when a profiler is set.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_effects::emit::Options;
use deep_canvas_effects::interp;
use deep_canvas_effects::shipped::{self, PARTICLE_FLOATS};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_scene3d_render::{timed, Post, PostFrame, Profiler};
use serde_json::Value;

use crate::compile::{compile_with, Compiled};
use crate::glow;
use crate::reference::{target, upload, Camera};
use crate::runner::{Bound, Runner, LINEAR};
use deep_canvas_effects::graph::Tex;
use deep_canvas_effects::interp::Image;

/// One particles@1 item: its compute operator's params, its seed and how its dots draw.
#[derive(Clone, Debug, Default)]
pub struct Sparks {
    pub item: String,
    /// `particles.*` params, by path.
    pub params: BTreeMap<String, Value>,
    pub count: u32,
    pub seed: u32,
    pub size_px: f64,
    pub opacity: f64,
    /// Its size in px and its opacity at birth and at death (#420: channels over life).
    pub size: [f64; 2],
    pub fade: [f64; 2],
    /// Its color over life: up to four stops, each its place in life and a linear color, mixed
    /// in OKLab.
    pub stops: Vec<(f64, [f64; 3])>,
    /// `dot`, `spark`, `puff` or `streak`, by its place in that list.
    pub draw: u32,
    /// A puff shaded at half resolution.
    pub half: bool,
    /// #449: an item the closed-form kernel writes (closed.wgsl), its frame's uniform words, one
    /// block a dispatch (a ribbon's rows back along its length, #450), its bake's table words,
    /// and the surface it follows as evaluated this frame; none for the shipped graph.
    pub closed: Option<Closed>,
    /// #450: a ribbon's segments, width in px, taper and fade; its columns hold count rows a
    /// segment end.
    pub ribbon: Option<(u32, f64, f64, f64)>,
}

/// A closed-form item's frame uniform words, bake table words and surface (#449).
type Closed = (Vec<Vec<u32>>, Arc<Vec<u32>>, Vec<f32>);

/// What the look, the document and the session turn on this frame, and each effect's values.
#[derive(Clone, Debug, Default)]
pub struct Settings {
    /// The look's `ground_3d` as `ground_3d.*` params, when its kind is grid.
    pub grid: Option<BTreeMap<String, Value>>,
    /// The key light's shadow, when a sun casts: `shadow.*` params and the sun's seed.
    pub shadow: Option<(BTreeMap<String, Value>, u32)>,
    pub sparks: Vec<Sparks>,
    /// The selected items, by ID, and the outline's width in px.
    pub selection: Vec<String>,
    pub outline_width: u32,
    /// The look's bloom as `bloom.*` params.
    pub bloom: Option<BTreeMap<String, Value>>,
    /// The bloom's lens dirt image, each pixel's value 0 to 1 (#418).
    pub dirt: Option<Arc<Image>>,
    /// Each role the effects read, linear.
    pub roles: BTreeMap<String, [f64; 3]>,
    /// The frame's time, s.
    pub t: f64,
    /// #462: the look's strokes on surfaces this frame, as the CPU laid them.
    pub strokes: Option<Arc<Vec<crate::strokes::Dab>>>,
}

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    /// The glow's first downsample takes a plain average.
    pub without_karis: bool,
    /// Every shipped pass's GPU output is two 10-bit codes higher in red.
    pub off_by_two: bool,
    /// The glow blurs at full resolution 64 more times.
    pub slow_glow: bool,
    /// #418: the lens dirt laid over the frame, `intensity × d` added to every pixel.
    pub dirt_overlay: bool,
    /// #1173: a half-resolution puff shaded once per 2 × 2 px block, that value copied to all
    /// four, as the base drew it.
    pub block_copy: bool,
}

/// A pass of the frame, for the view's reply: its name, the targets it reads and writes, and the
/// GPU operator it runs.
#[derive(Clone, Debug)]
pub struct PassInfo {
    pub name: &'static str,
    pub reads: Vec<&'static str>,
    pub writes: Vec<&'static str>,
    pub operator: Option<&'static str>,
}

pub use deep_canvas_effects::module::{GLOW, GRID, OUTLINE, SHADOW, SPARKS};

pub struct Effects {
    pub settings: Settings,
    pub planted: Planted,
    pub profiler: Option<Profiler>,
    /// Each stage's runner, by its graph's ID.
    runners: BTreeMap<String, Arc<Runner>>,
    /// The chain's targets by index, with their sizes.
    targets: Vec<([u32; 2], wgpu::TextureView)>,
    /// How many of the targets the frame being planned has asked for: the rest are released.
    used: usize,
    /// #463: this frame's crop (PostFrame::crop), the scissor each pass draws inside.
    crop: Option<[u32; 4]>,
    /// What each pass operator's run bound last frame, in the frame's order, with its stage's ID.
    bound: Vec<Option<(String, Bound)>>,
    /// How many of them the frame being planned has bound: the rest are released.
    passes: usize,
    sparks: Option<SparkDraw>,
    /// #462's strokes draw, built the first frame that lays a stroke.
    strokes: Option<crate::strokes::Draw>,
    /// #449's closed-form kernel, built the first frame an item needs it, and each item's bake
    /// tables on the device, uploaded once per bake.
    closed: Option<Arc<crate::closed::Closed>>,
    closed_tables: BTreeMap<String, (Arc<Vec<u32>>, wgpu::Buffer)>,
    /// The half-resolution puffs' half-size target, with the full size it was made for (#1173).
    half: Option<([u32; 2], wgpu::TextureView)>,
    /// The lens dirt on the GPU, with the image it holds; black with none.
    dirt: Option<(Option<Arc<Image>>, wgpu::TextureView)>,
    /// The document whose composed operators the chain runs, with the emitter's and the
    /// check's planted programs: built into `docops` on the device at the next frame.
    pub op_doc: Option<(Value, Options, deep_canvas_effects::check::CheckOptions)>,
    /// The structural steps' planted programs (#483) the document's operators run under.
    pub op_hooks: crate::docops::Hooks,
    /// The document's composed pass and compute operators (#429), run in the effects chain.
    pub docops: Option<crate::docops::DocOps>,
    /// Each operator's resolution this frame, by item; 1 when not given.
    pub op_resolution: BTreeMap<String, f64>,
    /// A canonical render, where live-only operators draw their fallback.
    pub op_canonical: bool,
    /// What each operator drew last frame.
    pub op_rows: Vec<crate::docops::Row>,
    /// Each depth-video point set's last dispatch, by item (#503).
    pub(crate) clouds: BTreeMap<String, crate::cloud::Held>,
}

struct SparkDraw {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    /// The half-resolution puffs' draw into their half-size target, and the filtered upsample
    /// adding that to the linear target, with its sampler (#1173).
    half: wgpu::RenderPipeline,
    upsample: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    instances: wgpu::Buffer,
    /// The particles its instance buffer holds: a showpiece's count grows it (#420).
    capacity: u32,
}

/// An instance buffer for `count` particles.
fn instance_buffer(d: &deep_gpu::counted::Wgpu, count: u32) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("particles instances"),
        size: u64::from(count) * u64::from(PARTICLE_FLOATS) * 4,
        usage: wgpu::BufferUsages::STORAGE,
        mapped_at_creation: false,
    })
}

/// The library's stage graph with this ID, compiled (the GPU's planted pass when asked).
pub fn stage(id: &str, karis: bool, options: Options) -> Compiled {
    let json = shipped::library(karis)
        .into_iter()
        .flat_map(|s| s.stages)
        .find(|o| o["id"] == id)
        .expect("a shipped stage");
    compile_with(&json, &BTreeMap::new(), options).expect("every shipped operator passes its check")
}

fn make(device: &Device, size: [u32; 2]) -> wgpu::TextureView {
    target(device, "effects chain", size).create_view(&Default::default())
}

impl Effects {
    pub fn new(settings: Settings, planted: Planted) -> Effects {
        Effects {
            settings,
            planted,
            profiler: None,
            runners: BTreeMap::new(),
            targets: Vec::new(),
            used: 0,
            crop: None,
            bound: Vec::new(),
            passes: 0,
            sparks: None,
            strokes: None,
            closed: None,
            closed_tables: BTreeMap::new(),
            half: None,
            dirt: None,
            op_doc: None,
            op_hooks: crate::docops::Hooks::default(),
            docops: None,
            op_resolution: BTreeMap::new(),
            op_canonical: false,
            op_rows: Vec::new(),
            clouds: BTreeMap::new(),
        }
    }

    /// The lens dirt's texture: the settings' image, or one black texel with none.
    fn dirt_view(&mut self, device: &Device) -> wgpu::TextureView {
        let want = self.settings.dirt.clone();
        let same = |held: &Option<Arc<Image>>| match (held, &want) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        };
        if !self.dirt.as_ref().is_some_and(|(held, _)| same(held)) {
            let black = Image::new(1, 1);
            let (tex, _) = upload(device, Tex::Float, want.as_deref().unwrap_or(&black));
            self.dirt = Some((want, tex.create_view(&Default::default())));
        }
        self.dirt.as_ref().expect("made above").1.clone()
    }

    pub(crate) fn runner(&mut self, device: &Device, id: &str) -> Arc<Runner> {
        let karis = !self.planted.without_karis;
        let options = Options {
            off_by_two: self.planted.off_by_two,
            ..Options::default()
        };
        self.runners
            .entry(id.to_string())
            .or_insert_with(|| {
                Arc::new(Runner::new(
                    &device.device,
                    stage(id, karis, options),
                    LINEAR,
                ))
            })
            .clone()
    }

    fn target(&mut self, device: &Device, i: usize, size: [u32; 2]) -> wgpu::TextureView {
        self.used = self.used.max(i + 1);
        while self.targets.len() <= i {
            self.targets.push(([0, 0], make(device, [1, 1])));
        }
        if self.targets[i].0 != size {
            self.targets[i] = (size, make(device, size));
        }
        self.targets[i].1.clone()
    }

    /// The frame's passes in order, for the reply.
    pub fn passes(&self) -> Vec<PassInfo> {
        let s = &self.settings;
        let chain = |name, operator, reads: Vec<&'static str>| PassInfo {
            name,
            reads,
            writes: vec!["linear"],
            operator: Some(operator),
        };
        let mut out = Vec::new();
        if s.grid.is_some() {
            out.push(chain(GRID, "grid.ground@1", vec!["linear", "depth"]));
        }
        if s.shadow.is_some() {
            out.push(chain(
                SHADOW,
                "shadow.resolve@1",
                vec!["linear", "depth", "shadow"],
            ));
        }
        if !s.sparks.is_empty() {
            out.push(chain(SPARKS, "particles.sparks@1", vec!["linear", "depth"]));
        }
        if !s.selection.is_empty() {
            out.push(chain(OUTLINE, "outline.select@1", vec!["linear", "ids"]));
        }
        if s.bloom.is_some() {
            out.push(chain(GLOW, "glow@1", vec!["linear"]));
        }
        out
    }

    /// One pass operator's run: its bind groups now, its encode later.
    #[allow(clippy::too_many_arguments)]
    fn pass_job(
        &mut self,
        device: &Device,
        label: &'static str,
        id: &str,
        camera: &Camera,
        params: &BTreeMap<String, Value>,
        textures: &BTreeMap<&str, wgpu::TextureView>,
        out: wgpu::TextureView,
        size: [u32; 2],
    ) -> Job {
        let runner = self.runner(device, id);
        let views: Vec<wgpu::TextureView> = runner
            .compiled
            .checked
            .textures
            .iter()
            .map(|n| {
                textures
                    .get(n.as_str())
                    .cloned()
                    .expect("a planned texture")
            })
            .collect();
        let refs: Vec<&wgpu::TextureView> = views.iter().collect();
        let values = interp::inputs(&runner.compiled.checked, params, &self.settings.roles);
        // The run at this place in the frame binds what it bound last frame, while its stage is
        // the same.
        let place = self.passes;
        self.passes += 1;
        if self.bound.len() <= place {
            self.bound.resize_with(place + 1, || None);
        }
        let (stage, held) = match self.bound[place].take() {
            Some((stage, bound)) if stage == id => (stage, Some(bound)),
            _ => (id.to_string(), None),
        };
        let bound = runner.rebind(device, held, &camera.frame(), size, &values, &refs);
        let groups = bound.groups.clone();
        self.bound[place] = Some((stage, bound));
        let (profiler, crop) = (self.profiler.clone(), self.crop);
        Box::new(move |encoder| {
            timed(&profiler, label, encoder, |e, ts| {
                runner.encode_within(e, &out, &groups, ts, crop)
            });
        })
    }

    fn spark_draw(&mut self, device: &Device) {
        if self.sparks.is_some() {
            return;
        }
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(SPARKS),
            source: wgpu::ShaderSource::Wgsl(include_str!("particles.wgsl").into()),
        });
        let additive = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::Zero,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
        };
        let additive_into = |vs, fs, depth_stencil| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(SPARKS),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: LINEAR,
                        blend: Some(additive),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipeline = additive_into(
            "vs",
            "fs",
            Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
        );
        let layout = pipeline.get_bind_group_layout(0);
        let instances = instance_buffer(d, shipped::MAX_PARTICLES);
        self.sparks = Some(SparkDraw {
            pipeline,
            layout,
            half: additive_into("vs", "half_fs", None),
            upsample: additive_into("upsample_vs", "upsample_fs", None),
            sampler: d.create_sampler(&wgpu::SamplerDescriptor {
                label: Some(SPARKS),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            instances,
            capacity: shipped::MAX_PARTICLES,
        });
    }

    /// Sparks: the compute operator writes the item's instance columns, and the core's instanced
    /// draw adds its dots into `target` where they show in front of the scene.
    fn sparks_job(
        &mut self,
        device: &Device,
        camera: &Camera,
        s: &Sparks,
        target: wgpu::TextureView,
        depth: wgpu::TextureView,
        size: [u32; 2],
    ) -> Job {
        let d = &device.device;
        let compute = self.runner(device, "particles.sparks@1");
        self.spark_draw(device);
        // A half-resolution puff draws into a half-size target, filtered up into `target` (#1173).
        let small = (s.half && !self.planted.block_copy).then(|| {
            if self.half.as_ref().is_none_or(|(k, _)| *k != size) {
                self.half = Some((size, make(device, size.map(|n| n.div_ceil(2)))));
            }
            self.half.as_ref().expect("made above").1.clone()
        });
        let rows = s.count * s.ribbon.map_or(1, |r| r.0 + 1);
        if let Some(draw) = self.sparks.as_mut().filter(|dr| dr.capacity < rows) {
            draw.instances = instance_buffer(d, rows);
            draw.capacity = rows;
        }
        let kernel = s.closed.as_ref().map(|(uniforms, words, now)| {
            let closed = self
                .closed
                .get_or_insert_with(|| Arc::new(crate::closed::Closed::new(device)))
                .clone();
            let held = self
                .closed_tables
                .get(&s.item)
                .filter(|(w, _)| Arc::ptr_eq(w, words));
            let tables = match held {
                Some((_, b)) => b.clone(),
                None => {
                    let b = crate::closed::Closed::tables(device, words);
                    self.closed_tables
                        .insert(s.item.clone(), (words.clone(), b.clone()));
                    b
                }
            };
            let instances = &self.sparks.as_ref().expect("made above").instances;
            let bound: Vec<_> = uniforms
                .iter()
                .map(|u| closed.bind(device, u, &tables, now, instances, s.count))
                .collect();
            (closed, bound)
        });
        let draw = self.sparks.as_ref().expect("made above");
        let mut c = *camera;
        c.seed = s.seed;
        // One dispatch per operator's worth of particles, each from its offset (a showpiece's
        // count runs past one); none when the closed-form kernel writes them.
        let chunk = shipped::MAX_PARTICLES;
        let mut dispatches = Vec::new();
        let chunks = if kernel.is_some() {
            0
        } else {
            s.count.div_ceil(chunk).max(1)
        };
        for k in 0..chunks {
            let mut params = s.params.clone();
            params.insert("particles.offset".into(), Value::from(k * chunk));
            let values = interp::inputs(&compute.compiled.checked, &params, &self.settings.roles);
            let bound = compute.bind(d, &c.frame(), [1, 1], &values, &[], &[&draw.instances]);
            dispatches.push((bound, (s.count - k * chunk).min(chunk)));
        }
        let mut uni: Vec<u8> = Vec::with_capacity(192);
        let mut stops = s.stops.clone();
        stops.truncate(4);
        let n_stops = stops.len().max(1) as f32;
        while stops.len() < 4 {
            stops.push(*stops.last().unwrap_or(&(0.0, [1.0, 1.0, 1.0])));
        }
        let floats = camera
            .clip
            .iter()
            .map(|x| *x as f32)
            .chain([
                size[0] as f32,
                size[1] as f32,
                s.size_px as f32,
                s.opacity as f32,
            ])
            .chain([s.size[0], s.size[1], s.fade[0], s.fade[1]].map(|x| x as f32))
            .chain([
                s.draw as f32,
                f32::from(u8::from(s.half)),
                n_stops,
                f32::from(u8::from(s.half && self.planted.block_copy)),
            ])
            .chain(match s.ribbon {
                Some((n, w, taper, fade)) => [
                    s.count as f32,
                    n as f32,
                    w as f32,
                    taper as f32,
                    fade as f32,
                ],
                None => [0.0; 5],
            })
            .chain([0.0; 3])
            .chain(stops.iter().map(|st| st.0 as f32))
            .chain(
                stops
                    .iter()
                    .flat_map(|st| [st.1[0] as f32, st.1[1] as f32, st.1[2] as f32, 0.0]),
            );
        for v in floats {
            uni.extend_from_slice(&v.to_le_bytes());
        }
        let ub = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("particles draw"),
            contents: &uni,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particles draw"),
            layout: &draw.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: ub.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: draw.instances.as_entire_binding(),
                },
            ],
        });
        let halved = small.map(|small| {
            let drawn = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("particles half"),
                layout: &draw.half.get_bind_group_layout(0),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: ub.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: draw.instances.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(&depth),
                    },
                ],
            });
            let up = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("particles upsample"),
                layout: &draw.upsample.get_bind_group_layout(0),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(&small),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Sampler(&draw.sampler),
                    },
                ],
            });
            let pipelines = (draw.half.clone(), draw.upsample.clone());
            (small, drawn, up, pipelines)
        });
        let pipeline = draw.pipeline.clone();
        let profiler = self.profiler.clone();
        // A ribbon draws a quad a segment of each particle (#450).
        let count = s.count * s.ribbon.map_or(1, |r| r.0);
        Box::new(move |encoder| {
            let _keep = &ub;
            for bound in kernel.iter().flat_map(|(_, b)| b) {
                let closed = &kernel.as_ref().expect("a bound kernel").0;
                match &profiler {
                    Some(p) => {
                        let p = p.lock().unwrap_or_else(|e| e.into_inner());
                        let q = p.begin_pass_query(SPARKS, encoder);
                        closed.dispatch(encoder, bound, q.compute_pass_timestamp_writes());
                        p.end_query(encoder, q);
                    }
                    None => closed.dispatch(encoder, bound, None),
                }
            }
            for ((g0, g1, _buffers), n) in &dispatches {
                let groups = (g0.clone(), g1.clone());
                match &profiler {
                    Some(p) => {
                        let p = p.lock().unwrap_or_else(|e| e.into_inner());
                        let q = p.begin_pass_query(SPARKS, encoder);
                        compute.dispatch(encoder, *n, &groups, q.compute_pass_timestamp_writes());
                        p.end_query(encoder, q);
                    }
                    None => compute.dispatch(encoder, *n, &groups, None),
                }
            }
            if let Some((small, drawn, up, (half, upsample))) = &halved {
                timed(&profiler, SPARKS, encoder, |e, ts| {
                    let mut pass = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(SPARKS),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: small,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        timestamp_writes: ts,
                        ..Default::default()
                    });
                    pass.set_pipeline(half);
                    pass.set_bind_group(0, drawn, &[]);
                    pass.draw(0..6, 0..count);
                    drop(pass);
                    let mut pass = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(SPARKS),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &target,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        ..Default::default()
                    });
                    pass.set_pipeline(upsample);
                    pass.set_bind_group(0, up, &[]);
                    pass.draw(0..3, 0..1);
                });
                return;
            }
            timed(&profiler, SPARKS, encoder, |e, ts| {
                let mut pass = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(SPARKS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &depth,
                        depth_ops: None,
                        stencil_ops: None,
                    }),
                    timestamp_writes: ts,
                    ..Default::default()
                });
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.draw(0..6, 0..count);
            });
        })
    }
}

impl Effects {
    /// Builds the document's operators on the device, the first frame that needs them.
    fn build_docops(&mut self, device: &Device) {
        if let Some((doc, options, planted)) = self.op_doc.take() {
            self.docops = Some(crate::docops::DocOps::with(
                device,
                &doc,
                options,
                planted,
                &[],
                self.op_hooks,
                BTreeMap::new(),
            ));
        }
    }
}

impl Post for Effects {
    fn sources(&mut self, device: &Device) -> Vec<deep_scene3d_render::cull::Source> {
        self.build_docops(device);
        self.docops.as_ref().map_or(Vec::new(), |ops| ops.sources())
    }

    fn shadows(&self) -> bool {
        self.settings.shadow.is_some()
    }

    fn jobs(
        &mut self,
        device: &Device,
        frame: &PostFrame<'_>,
    ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>) {
        let s = self.settings.clone();
        let size = frame.size;
        let camera = Camera {
            clip: frame.clip,
            eye: frame.eye,
            near: frame.near,
            t: s.t,
            seed: 0,
        };
        let mut jobs: Vec<(String, Job)> = Vec::new();
        let mut cur = frame.linear.clone();
        let mut next = 1usize;
        self.used = 0;
        self.crop = frame.crop;
        self.passes = 0;
        if let Some(grid) = &s.grid {
            let out = self.target(device, next, size);
            next += 1;
            let tex = BTreeMap::from([("color", cur.clone()), ("depth", frame.depth.clone())]);
            jobs.push((
                GRID.into(),
                self.pass_job(
                    device,
                    GRID,
                    "grid.ground@1",
                    &camera,
                    grid,
                    &tex,
                    out.clone(),
                    size,
                ),
            ));
            cur = out;
        }
        if let (Some((params, seed)), Some(map), Some(light)) =
            (&s.shadow, frame.shadow, frame.light_clip)
        {
            let out = self.target(device, next, size);
            next += 1;
            let mut params = params.clone();
            params.insert("light.clip".into(), Value::from(light.to_vec()));
            let tex = BTreeMap::from([
                ("color", cur.clone()),
                ("depth", frame.depth.clone()),
                ("shadow_map", map.clone()),
            ]);
            let mut c = camera;
            c.seed = *seed;
            jobs.push((
                SHADOW.into(),
                self.pass_job(
                    device,
                    SHADOW,
                    "shadow.resolve@1",
                    &c,
                    &params,
                    &tex,
                    out.clone(),
                    size,
                ),
            ));
            cur = out;
        }
        if let Some(dabs) = s.strokes.as_ref().filter(|d| !d.is_empty()) {
            let draw = self
                .strokes
                .get_or_insert_with(|| crate::strokes::Draw::new(device));
            let job = draw.job(
                device,
                frame.clip,
                dabs,
                cur.clone(),
                frame.depth.clone(),
                size,
                self.profiler.clone(),
            );
            jobs.push((crate::strokes::STROKES.into(), job));
        }
        for sp in &s.sparks {
            let job = self.sparks_job(device, &camera, sp, cur.clone(), frame.depth.clone(), size);
            jobs.push((SPARKS.into(), job));
        }
        if !s.selection.is_empty() {
            let out = self.target(device, next, size);
            next += 1;
            let mut bits = vec![0u64; 16];
            for id in &s.selection {
                if let Some(&pick) = frame.picks.get(id) {
                    if pick > 0 && pick < 512 {
                        bits[(pick >> 5) as usize] |= 1 << (pick & 31);
                    }
                }
            }
            let params = BTreeMap::from([
                ("selection.bits".to_string(), Value::from(bits)),
                (
                    "selection.width".to_string(),
                    Value::from(s.outline_width.max(1)),
                ),
            ]);
            let tex = BTreeMap::from([("color", cur.clone()), ("ids", frame.ids.clone())]);
            jobs.push((
                OUTLINE.into(),
                self.pass_job(
                    device,
                    OUTLINE,
                    "outline.select@1",
                    &camera,
                    &params,
                    &tex,
                    out.clone(),
                    size,
                ),
            ));
            cur = out;
        }
        self.build_docops(device);
        if let Some(ops) = self.docops.as_mut() {
            ops.core = frame.core.iter().map(|(n, v)| (*n, (*v).clone())).collect();
            let res = self.op_resolution.clone();
            ops.clock = Some(s.t);
            let (rows, recs, out) = ops.plan(
                device,
                &cur,
                Some(frame.ids),
                Some(frame.depth),
                size,
                &camera.frame(),
                &s.roles,
                &|i| res.get(i).copied().unwrap_or(1.0),
                self.op_canonical,
            );
            self.op_rows = rows;
            for r in recs {
                let profiler = self.profiler.clone();
                jobs.push((
                    r.mark.into(),
                    Box::new(move |e| {
                        r.record(e, &mut crate::docops::Profiled::new(profiler));
                    }),
                ));
            }
            if let Some(o) = out {
                cur = o;
            }
        }
        if let Some(bloom) = &s.bloom {
            let (runs, mut params) = glow::chain(size, bloom);
            if self.planted.dirt_overlay {
                params.insert("bloom.overlay".into(), Value::from(1.0));
            }
            let ids = [
                if self.planted.without_karis {
                    "glow.down@1"
                } else {
                    "glow.down_karis@1"
                },
                "glow.down@1",
                "glow.up@1",
                "glow.mix@1",
            ];
            let first = next;
            let scene = cur.clone();
            let dirt = self.dirt_view(device);
            let mut levels: BTreeMap<usize, wgpu::TextureView> = BTreeMap::new();
            let mut parts: Vec<Job> = Vec::new();
            for r in &runs {
                let level = |i: Option<usize>| i.map_or(scene.clone(), |k| levels[&k].clone());
                let tex = BTreeMap::from([
                    ("src", level(r.a)),
                    ("small", level(r.a)),
                    ("bloom", level(r.a)),
                    ("large", level(r.b)),
                    ("scene", scene.clone()),
                    ("dirt", dirt.clone()),
                ]);
                let out = self.target(device, first + r.out.unwrap_or(runs.len()), r.size);
                parts.push(self.pass_job(
                    device,
                    GLOW,
                    ids[r.stage],
                    &camera,
                    &params,
                    &tex,
                    out.clone(),
                    r.size,
                ));
                match r.out {
                    Some(k) => {
                        levels.insert(k, out);
                    }
                    None => cur = out,
                }
            }
            if self.planted.slow_glow {
                // The planted glow: 64 more full-resolution blurs of its result.
                for k in 0..64 {
                    let out = self.target(device, first + runs.len() + 1 + (k % 2), size);
                    let tex = BTreeMap::from([("small", cur.clone()), ("large", cur.clone())]);
                    parts.push(self.pass_job(
                        device,
                        GLOW,
                        "glow.up@1",
                        &camera,
                        &params,
                        &tex,
                        out.clone(),
                        size,
                    ));
                    cur = out;
                }
            }
            jobs.push((
                GLOW.into(),
                Box::new(move |encoder| {
                    for p in parts {
                        p(encoder);
                    }
                }),
            ));
        }
        // A target no pass of this frame asked for is released: a pass switched off no longer
        // holds its full-size targets for the view's life. Each job keeps its own views. What a
        // run that didn't happen had bound goes with it.
        self.targets.truncate(self.used);
        self.bound.truncate(self.passes);
        (jobs, Some(cur))
    }
}

/// A frame's GPU time from its profiler results: the span from the first pass's start to the
/// last's end, and each frame pass's share, the time it extended the frame by (passes overlap on
/// a tiled GPU, so a pass's own interval would count time another pass already counted).
pub fn timings(results: &[wgpu_profiler::GpuTimerQueryResult]) -> (f64, BTreeMap<String, f64>) {
    let mut spans: Vec<(&str, f64, f64)> = results
        .iter()
        .filter_map(|r| r.time.as_ref().map(|t| (r.label.as_str(), t.start, t.end)))
        .collect();
    spans.sort_by(|a, b| a.2.total_cmp(&b.2));
    let mut per = BTreeMap::new();
    let (Some(first), Some(last)) = (
        spans.iter().map(|s| s.1).reduce(f64::min),
        spans.last().map(|s| s.2),
    ) else {
        return (0.0, per);
    };
    let mut reached = first;
    for (label, start, end) in &spans {
        let own = (end - start.max(reached)).max(0.0);
        *per.entry(label.to_string()).or_insert(0.0) += own * 1e3;
        reached = reached.max(*end);
    }
    ((last - first) * 1e3, per)
}

/// The effects as scene3d's [`Post`] while the driver updates their settings between frames.
pub struct Shared(pub Arc<std::sync::Mutex<Effects>>);

impl Post for Shared {
    fn sources(&mut self, device: &Device) -> Vec<deep_scene3d_render::cull::Source> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .sources(device)
    }

    fn passes(&self) -> Vec<deep_gpu::render::Pass> {
        use deep_gpu::render::{Determinism, Pass, Resolution};
        let pass = |name: &str, place, order, reads: Vec<&'static str>, ns_per_px| Pass {
            name: name.into(),
            place,
            order,
            reads,
            writes: vec!["linear"],
            resolution: Resolution::Full,
            ns_per_px,
            determinism: Determinism::SameMachine,
        };
        // The document's composed operators, after the shipped effects in the effects chain.
        let fx = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let marks: Vec<(String, f64, bool)> = match (&fx.docops, &fx.op_doc) {
            (Some(ops), _) => ops
                .ops
                .iter()
                .map(|o| {
                    (
                        o.mark.to_string(),
                        o.declared_ns,
                        ops.early.contains(&o.item),
                    )
                })
                .collect(),
            (None, Some((doc, ..))) => {
                let early = crate::docops::feeders(doc);
                crate::docops::marks(doc)
                    .into_iter()
                    .map(|(mark, ns)| {
                        let item = crate::docops::item_of_mark(&mark).unwrap_or_default();
                        let early = early.contains(item);
                        (mark, ns, early)
                    })
                    .collect()
            }
            (None, None) => Vec::new(),
        };
        drop(fx);
        let mut out = vec![
            pass(GRID, "effects", 0, vec!["linear", "depth"], 0.12),
            pass(
                SHADOW,
                "effects",
                1,
                vec!["linear", "depth", "shadow"],
                0.15,
            ),
            // #462: a look's strokes on surfaces, before the particles (an estimate).
            pass(
                crate::strokes::STROKES,
                "effects",
                2,
                vec!["linear", "depth"],
                0.05,
            ),
            pass(SPARKS, "effects", 3, vec!["linear", "depth"], 0.05),
            pass(OUTLINE, "effects", 4, vec!["linear", "ids"], 0.06),
            pass(GLOW, "bloom", 0, vec!["linear"], 0.25),
        ];
        for (k, (name, ns, early)) in marks.into_iter().enumerate() {
            // What feeds an instances output runs before the frame's draws (#484).
            let (place, reads) = if early {
                ("compute", Vec::new())
            } else {
                ("effects", vec!["linear"])
            };
            out.push(Pass {
                name,
                place,
                order: 5 + k as u32,
                reads,
                writes: if early { Vec::new() } else { vec!["linear"] },
                resolution: Resolution::Full,
                ns_per_px: ns as f32,
                determinism: Determinism::SameMachine,
            });
        }
        out
    }

    fn shadows(&self) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).shadows()
    }

    fn jobs(
        &mut self,
        device: &Device,
        frame: &PostFrame<'_>,
    ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .jobs(device, frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_gpu::device::{Backend, Gpu};
    use serde_json::json;

    /// The grid, the key light's shadow, the selection outline and the glow, on.
    fn settings(glow: f64) -> Settings {
        Settings {
            grid: Some(BTreeMap::new()),
            shadow: Some((BTreeMap::new(), 7)),
            selection: vec!["a".into()],
            outline_width: 2,
            bloom: Some(BTreeMap::from([("bloom.intensity".into(), json!(glow))])),
            roles: ["grid_minor", "grid_major", "grid_axis"]
                .into_iter()
                .map(|role| (role.to_string(), [0.2, 0.4, 0.6]))
                .collect(),
            ..Settings::default()
        }
    }

    /// A view's linear, depth and ID targets as scene3d hands them over: a bright square on a
    /// dim ground, nothing in front of it.
    fn targets(device: &Device, size: [u32; 2]) -> [wgpu::TextureView; 3] {
        use wgpu::TextureUsages as U;
        let make = |format, usage| {
            device.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("test target"),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: U::TEXTURE_BINDING | U::RENDER_ATTACHMENT | usage,
                view_formats: &[],
            })
        };
        let linear = make(LINEAR, U::COPY_DST);
        let texels: Vec<u8> = (0..size[0] * size[1])
            .flat_map(|i| {
                let lit = (i % size[0]) / 8 == 2 && (i / size[0]) / 8 == 2;
                let v = if lit { 8.0 } else { 0.05 };
                [v, v * 0.5, v * 0.25, 1.0]
            })
            .flat_map(|c| crate::reference::f32_to_f16(c).to_le_bytes())
            .collect();
        device.queue.write_texture(
            linear.as_image_copy(),
            &texels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size[0] * 8),
                rows_per_image: None,
            },
            linear.size(),
        );
        [
            linear,
            make(wgpu::TextureFormat::Depth32Float, U::empty()),
            make(wgpu::TextureFormat::R32Uint, U::empty()),
        ]
        .map(|t| t.create_view(&Default::default()))
    }

    /// The frame scene3d hands the effects for a camera `turn` radians round the origin, looking
    /// at it: world to clip with reversed Z and no far plane.
    fn frame<'a>(
        size: [u32; 2],
        [linear, depth, ids]: &'a [wgpu::TextureView; 3],
        picks: &'a BTreeMap<String, u32>,
        turn: f64,
    ) -> PostFrame<'a> {
        let eye = [8.0 * turn.sin(), 3.0, 8.0 * turn.cos()];
        let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let unit = |v: [f64; 3]| v.map(|x| x / dot(v, v).sqrt());
        let forward = unit(eye.map(|x| -x));
        let right = unit([-forward[2], 0.0, forward[0]]);
        let up = [
            right[1] * forward[2] - right[2] * forward[1],
            right[2] * forward[0] - right[0] * forward[2],
            right[0] * forward[1] - right[1] * forward[0],
        ];
        let (near, zoom) = (0.1, 2.4);
        let x = right.map(|v| v * zoom * f64::from(size[1]) / f64::from(size[0]));
        let y = up.map(|v| v * zoom);
        // Each row of the matrix, then its translation.
        let rows = [x, y, [0.0; 3], forward];
        let moved = [-dot(x, eye), -dot(y, eye), near, -dot(forward, eye)];
        let mut clip = [0.0; 16];
        for row in 0..4 {
            for col in 0..3 {
                clip[col * 4 + row] = rows[row][col];
            }
            clip[12 + row] = moved[row];
        }
        let mut light_clip = [0.0; 16];
        for k in 0..4 {
            light_clip[k * 5] = 1.0;
        }
        PostFrame {
            size,
            linear,
            depth,
            ids,
            // Any depth target stands for the key light's map.
            shadow: Some(depth),
            clip,
            eye,
            near,
            light_clip: Some(light_clip),
            picks,
            core: Vec::new(),
        }
    }

    /// Plans the frame's passes, records them and submits: the target the output would read.
    fn run(device: &Device, fx: &mut Effects, frame: &PostFrame<'_>) -> wgpu::TextureView {
        let (jobs, out) = fx.jobs(device, frame);
        let mut encoder = device.device.create_command_encoder(&Default::default());
        for (_, job) in jobs {
            job(&mut encoder);
        }
        device.queue.submit([encoder.finish()]);
        out.expect("the effects hand the output their target")
    }

    /// Canvas primitives, Frame budget: bind groups and buffers created in each frame after the
    /// first are counted. The shipped passes bind what the first frame made, and a frame whose
    /// camera and values hold writes nothing.
    #[test]
    fn a_frame_after_the_first_makes_no_buffer_and_no_bind_group_for_the_shipped_passes() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let size = [128, 96];
        let views = targets(&device, size);
        let picks = BTreeMap::from([("a".to_string(), 3)]);
        let mut fx = Effects::new(settings(0.5), Planted::default());
        let made: Vec<_> = [0.0, 0.1, 0.2, 0.3, 0.3]
            .into_iter()
            .map(|turn| {
                let before = device.device.counts().read();
                run(&device, &mut fx, &frame(size, &views, &picks, turn));
                device.device.counts().read().since(before)
            })
            .collect();
        for (n, made) in made.iter().enumerate().skip(1) {
            assert_eq!(
                (made.buffers, made.bind_groups),
                (0, 0),
                "frame {n}: buffers and bind groups made"
            );
        }
        assert_eq!(
            (made[4].writes, made[4].uploaded),
            (0, 0),
            "frame 4, whose camera holds: queue writes and bytes uploaded"
        );
        let raised = device.take_raised();
        assert!(raised.is_empty(), "the device raised: {raised:?}");
    }

    /// On this machine's GPU the passes draw, from what they bound last frame, the pixels they
    /// draw from binds made for the frame: as the camera turns, as the glow's intensity changes,
    /// and as the view takes another size and its first one again.
    #[test]
    fn the_shipped_passes_draw_from_kept_binds_what_they_draw_from_fresh_ones() {
        let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
        let device = gpu.device();
        let sizes = [[128, 96], [96, 64]];
        let views = sizes.map(|size| targets(&device, size));
        let picks = BTreeMap::from([("a".to_string(), 3)]);
        let pixels = |fx: &mut Effects, (at, turn): (usize, f64)| {
            let out = run(&device, fx, &frame(sizes[at], &views[at], &picks, turn));
            crate::reference::read(&device, out.texture(), wgpu::TextureAspect::All, 8)
        };
        let mut kept = Effects::new(settings(0.5), Planted::default());
        let mut drawn = Vec::new();
        let frames = [
            (0, 0.0, 0.5),
            (0, 0.4, 0.5),
            (0, 0.4, 0.9),
            (1, 0.8, 0.9),
            (0, 0.8, 0.9),
        ];
        for (n, (at, turn, glow)) in frames.into_iter().enumerate() {
            kept.settings = settings(glow);
            let from_kept = pixels(&mut kept, (at, turn));
            let mut fresh = Effects::new(settings(glow), Planted::default());
            assert!(
                from_kept == pixels(&mut fresh, (at, turn)),
                "frame {n}: the kept binds draw other pixels"
            );
            drawn.push(from_kept);
        }
        assert!(
            drawn[0] != drawn[1],
            "the turned camera draws another frame"
        );
        assert!(
            drawn[1] != drawn[2],
            "the brighter glow draws another frame"
        );
        let raised = device.take_raised();
        assert!(raised.is_empty(), "the device raised: {raised:?}");
    }
}
