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
use crate::reference::{inverse, Camera};
use crate::runner::{Frame, Runner, LINEAR};

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
    /// Linear colors at birth and at death.
    pub from: [f64; 3],
    pub to: [f64; 3],
}

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
    /// Each role the effects read, linear.
    pub roles: BTreeMap<String, [f64; 3]>,
    /// The frame's time, s.
    pub t: f64,
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
    sparks: Option<SparkDraw>,
}

struct SparkDraw {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    instances: wgpu::Buffer,
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
    device
        .device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("effects chain"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: LINEAR,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
        .create_view(&Default::default())
}

fn frame_of(c: &Camera) -> Frame {
    Frame {
        clip: c.clip.map(|x| x as f32),
        inverse_clip: inverse(&c.clip).map(|x| x as f32),
        eye: [
            c.eye[0] as f32,
            c.eye[1] as f32,
            c.eye[2] as f32,
            c.near as f32,
        ],
        t: c.t as f32,
        seed: c.seed,
    }
}

impl Effects {
    pub fn new(settings: Settings, planted: Planted) -> Effects {
        Effects {
            settings,
            planted,
            profiler: None,
            runners: BTreeMap::new(),
            targets: Vec::new(),
            sparks: None,
        }
    }

    fn runner(&mut self, device: &Device, id: &str) -> Arc<Runner> {
        let karis = !self.planted.without_karis;
        let options = Options {
            off_by_two: self.planted.off_by_two,
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
        let (g0, g1, buffers) =
            runner.bind(&device.device, &frame_of(camera), size, &values, &refs, &[]);
        let profiler = self.profiler.clone();
        Box::new(move |encoder| {
            let _keep = buffers;
            timed(&profiler, label, encoder, |e, ts| {
                runner.encode(e, &out, &(g0, g1), ts)
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
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(SPARKS),
            layout: None,
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
                    format: LINEAR,
                    blend: Some(additive),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let layout = pipeline.get_bind_group_layout(0);
        let instances = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles instances"),
            size: u64::from(shipped::MAX_PARTICLES * PARTICLE_FLOATS) * 4,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });
        self.sparks = Some(SparkDraw {
            pipeline,
            layout,
            instances,
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
        use wgpu::util::DeviceExt as _;
        let d = &device.device;
        let compute = self.runner(device, "particles.sparks@1");
        self.spark_draw(device);
        let draw = self.sparks.as_ref().expect("made above");
        let mut c = *camera;
        c.seed = s.seed;
        let values = interp::inputs(&compute.compiled.checked, &s.params, &self.settings.roles);
        let (g0, g1, buffers) =
            compute.bind(d, &frame_of(&c), [1, 1], &values, &[], &[&draw.instances]);
        let mut uni: Vec<u8> = Vec::with_capacity(112);
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
            .chain(
                [
                    s.from[0], s.from[1], s.from[2], 0.0, s.to[0], s.to[1], s.to[2], 0.0,
                ]
                .map(|x| x as f32),
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
        let pipeline = draw.pipeline.clone();
        let profiler = self.profiler.clone();
        let count = s.count;
        Box::new(move |encoder| {
            let _keep = (buffers, ub);
            match &profiler {
                Some(p) => {
                    let p = p.lock().unwrap_or_else(|e| e.into_inner());
                    let q = p.begin_pass_query(SPARKS, encoder);
                    compute.dispatch(encoder, count, &(g0, g1), q.compute_pass_timestamp_writes());
                    p.end_query(encoder, q);
                }
                None => compute.dispatch(encoder, count, &(g0, g1), None),
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

impl Post for Effects {
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
        if let Some(bloom) = &s.bloom {
            let radius = bloom
                .get("bloom.radius")
                .and_then(Value::as_f64)
                .unwrap_or(0.85);
            let runs = glow::plan(size, radius);
            let mut params = bloom.clone();
            params.insert(
                "bloom.levels".into(),
                Value::from(glow::levels(size, radius).len() as u64),
            );
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
        vec![
            pass(GRID, "effects", 0, vec!["linear", "depth"], 0.12),
            pass(
                SHADOW,
                "effects",
                1,
                vec!["linear", "depth", "shadow"],
                0.15,
            ),
            pass(SPARKS, "effects", 2, vec!["linear", "depth"], 0.05),
            pass(OUTLINE, "effects", 3, vec!["linear", "ids"], 0.06),
            pass(GLOW, "bloom", 0, vec!["linear"], 0.25),
        ]
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
