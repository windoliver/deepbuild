//! The parity scenes under `tests/acceptance/377/fixtures/parity/gpu` and the test render module
//! that draws them, `test.scene@1`. A scene's regions paint in order over its background, each
//! replacing what's under it; a scene's layers are independent writer layers, each composited over
//! the ones before it (premultiplied over) and encoded by an encode worker of its own.

use std::sync::{Arc, Mutex};

use bytemuck::{Pod, Zeroable};
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::surface::FORMAT;
use serde_json::Value;
use sha2::{Digest, Sha256};

const SHADER: &str = include_str!("scene.wgsl");

#[derive(Clone, Debug)]
pub enum Fill {
    Color([u8; 4]),
    Ramp {
        step: u32,
        bgra: bool,
        alpha: u8,
    },
    Stamp {
        bits: u32,
        cell: u32,
        one: [u8; 4],
        zero: [u8; 4],
    },
    Texture {
        w: u32,
        h: u32,
    },
}

#[derive(Clone, Debug)]
pub struct Region {
    pub name: String,
    /// x, y, w, h; a missing w or h runs to the frame's edge.
    pub rect: [i64; 2],
    pub extent: [Option<u32>; 2],
    pub fill: Fill,
    /// The pipeline it draws with, in a scene of pipelines.
    pub pipeline: Option<u32>,
    pub moves: Option<(i64, i64, u64)>,
}

impl Region {
    /// Its rect at frame `n` in a frame of `size`, unclipped.
    pub fn rect_at(&self, n: u64, size: [u32; 2]) -> [i64; 4] {
        let k = self.moves.map_or(0, |(_, _, period)| (n % period) as i64);
        let (dx, dy) = self.moves.map_or((0, 0), |(dx, dy, _)| (dx, dy));
        let x = self.rect[0] + dx * k;
        let y = self.rect[1] + dy * k;
        let w = self.extent[0].map_or(i64::from(size[0]) - x, i64::from);
        let h = self.extent[1].map_or(i64::from(size[1]) - y, i64::from);
        [x, y, w, h]
    }
}

#[derive(Clone, Debug)]
pub struct Scene {
    pub name: String,
    pub size: [u32; 2],
    pub frames: u64,
    pub fence_frames: Option<u64>,
    pub stale_frames: Option<u64>,
    pub device_loss_at: Option<u64>,
    pub resize: Option<(u64, Vec<[u32; 2]>)>,
    pub window: [u32; 2],
    pub view: [u32; 2],
    pub page: (u32, Vec<[u8; 3]>),
    pub background: [u8; 4],
    pub regions: Vec<Region>,
    pub layers: Vec<Region>,
    pub upload_bytes_per_frame: Option<usize>,
}

fn u32s<const N: usize>(v: &Value) -> Option<[u32; N]> {
    let a = v.as_array()?;
    if a.len() != N {
        return None;
    }
    let mut out = [0; N];
    for (o, x) in out.iter_mut().zip(a) {
        *o = u32::try_from(x.as_u64()?).ok()?;
    }
    Some(out)
}

fn bytes4(v: &Value) -> Option<[u8; 4]> {
    let [a, b, c, d] = u32s::<4>(v)?;
    Some([
        u8::try_from(a).ok()?,
        u8::try_from(b).ok()?,
        u8::try_from(c).ok()?,
        u8::try_from(d).ok()?,
    ])
}

fn region(v: &Value) -> Result<Region, String> {
    let name = v["name"]
        .as_str()
        .ok_or("a region has no name")?
        .to_string();
    let rect = v["rect"]
        .as_array()
        .filter(|r| r.len() == 4)
        .ok_or(format!("{name}: rect"))?;
    let fill = &v["fill"];
    let pipeline = fill["pipeline"].as_u64().map(|p| p as u32);
    let kind = if let Some(c) = fill.get("color") {
        Fill::Color(bytes4(c).ok_or(format!("{name}: color"))?)
    } else if let Some(r) = fill.get("ramp") {
        Fill::Ramp {
            step: r["step"]
                .as_u64()
                .filter(|&s| s > 0)
                .ok_or(format!("{name}: ramp step"))? as u32,
            bgra: r["channels"].as_str() == Some("bgra"),
            alpha: r["alpha"].as_u64().unwrap_or(255).min(255) as u8,
        }
    } else if let Some(s) = fill.get("stamp") {
        Fill::Stamp {
            bits: s["bits"]
                .as_u64()
                .filter(|b| (1..=31).contains(b))
                .ok_or(format!("{name}: stamp bits"))? as u32,
            cell: s["cell"]
                .as_u64()
                .filter(|&c| c > 0)
                .ok_or(format!("{name}: stamp cell"))? as u32,
            one: bytes4(&s["one"]).ok_or(format!("{name}: stamp one"))?,
            zero: bytes4(&s["zero"]).ok_or(format!("{name}: stamp zero"))?,
        }
    } else if let Some(t) = fill.get("texture") {
        Fill::Texture {
            w: t["w"].as_u64().ok_or(format!("{name}: texture w"))? as u32,
            h: t["h"].as_u64().ok_or(format!("{name}: texture h"))? as u32,
        }
    } else {
        return Err(format!("{name}: a fill this module can't draw"));
    };
    let moves = v.get("moves").map(|m| {
        (
            m["dx"].as_i64().unwrap_or(0),
            m["dy"].as_i64().unwrap_or(0),
            m["period"].as_u64().unwrap_or(1).max(1),
        )
    });
    Ok(Region {
        name,
        rect: [rect[0].as_i64().unwrap_or(0), rect[1].as_i64().unwrap_or(0)],
        extent: [
            rect[2].as_u64().map(|w| w as u32),
            rect[3].as_u64().map(|h| h as u32),
        ],
        fill: kind,
        pipeline,
        moves,
    })
}

impl Scene {
    pub fn load(path: &str) -> Result<Scene, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let v: Value = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
        let list = |key: &str| -> Result<Vec<Region>, String> {
            v[key]
                .as_array()
                .map_or(Ok(Vec::new()), |a| a.iter().map(region).collect())
        };
        let page = &v["page"];
        Ok(Scene {
            name: v["scene"].as_str().unwrap_or("scene").to_string(),
            size: u32s::<2>(&v["size"]).ok_or("scene size")?,
            frames: v["frames"].as_u64().unwrap_or(1),
            fence_frames: v["fence_frames"].as_u64(),
            stale_frames: v["stale_frames"].as_u64(),
            device_loss_at: v["device_loss_at"].as_u64(),
            resize: v["resize"].as_object().map(|r| {
                (
                    r["every"].as_u64().unwrap_or(1).max(1),
                    r["sizes"]
                        .as_array()
                        .map(|s| s.iter().filter_map(u32s::<2>).collect())
                        .unwrap_or_default(),
                )
            }),
            window: u32s::<2>(&v["window"]).ok_or("scene window")?,
            view: u32s::<2>(&v["view"]).ok_or("scene view")?,
            page: (
                page["cell"].as_u64().unwrap_or(32).max(1) as u32,
                page["colors"]
                    .as_array()
                    .map(|c| {
                        c.iter()
                            .filter_map(|x| {
                                u32s::<3>(x).map(|[r, g, b]| [r as u8, g as u8, b as u8])
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            background: bytes4(&v["background"]).ok_or("scene background")?,
            regions: list("regions")?,
            layers: list("layers")?,
            upload_bytes_per_frame: v["budget_class"]["upload_bytes_per_frame"]
                .as_u64()
                .map(|b| b as usize),
        })
    }

    /// The size frame `n` draws at: the scene's, or with the resize schedule on, the schedule's.
    pub fn size_at(&self, n: u64, resize: bool) -> [u32; 2] {
        match (&self.resize, resize) {
            (Some((every, sizes)), true) if !sizes.is_empty() => {
                sizes[((n / every) % sizes.len() as u64) as usize]
            }
            _ => self.size,
        }
    }

    fn texture(&self) -> Option<(u32, u32)> {
        self.regions
            .iter()
            .chain(&self.layers)
            .find_map(|r| match r.fill {
                Fill::Texture { w, h } => Some((w, h)),
                _ => None,
            })
    }

    /// The pipelines the scene names, each with the color it draws, in order.
    pub fn pipelines(&self) -> Vec<(u32, [u8; 4])> {
        let mut p: Vec<(u32, [u8; 4])> = self
            .regions
            .iter()
            .filter_map(|r| match (r.pipeline, &r.fill) {
                (Some(k), Fill::Color(c)) => Some((k, *c)),
                _ => None,
            })
            .collect();
        p.sort_unstable();
        p.dedup_by_key(|(k, _)| *k);
        p
    }
}

/// The texture fill's texels: BGRA `[x, y, x ^ y, 255]`, each as a little-endian u32.
fn xor_texels(w: u32, h: u32) -> Arc<[u8]> {
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            out.extend_from_slice(&[(x & 255) as u8, (y & 255) as u8, ((x ^ y) & 255) as u8, 255]);
        }
    }
    out.into()
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Default)]
struct Gpu {
    origin: [i32; 2],
    kind: u32,
    a: u32,
    b: u32,
    c: u32,
    _pad: [u32; 2],
    one: [u32; 4],
    zero: [u32; 4],
}

fn record(region: &Region, origin: [i64; 2], frame: u64) -> Gpu {
    let px = |c: [u8; 4]| c.map(u32::from);
    let mut g = Gpu {
        origin: [origin[0] as i32, origin[1] as i32],
        ..Default::default()
    };
    match region.fill {
        Fill::Color(c) => g.one = px(c),
        Fill::Ramp { step, bgra, alpha } => {
            g.kind = 1;
            g.a = step;
            g.b = u32::from(bgra);
            g.c = u32::from(alpha);
        }
        Fill::Stamp {
            bits,
            cell,
            one,
            zero,
        } => {
            g.kind = 2;
            g.a = bits;
            g.b = cell;
            g.c = (frame % (1u64 << bits)) as u32;
            g.one = px(one);
            g.zero = px(zero);
        }
        Fill::Texture { w, .. } => {
            g.kind = 3;
            g.a = w;
        }
    }
    g
}

/// The WGSL of a scene's pipeline `k`: a module of its own, its index and color constants.
pub fn pipeline_source(k: u32, color: [u8; 4]) -> String {
    let [b, g, r, a] = color;
    format!(
        "// test.scene@1 pipeline {k}\n\
         const PIPELINE: u32 = {k}u;\n\
         const COLOR: vec4<f32> = vec4<f32>({r}.0, {g}.0, {b}.0, {a}.0) / 255.0;\n\
         @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {{\n\
         let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));\n\
         return vec4(uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);\n\
         }}\n\
         @fragment fn fragment() -> @location(0) vec4<f32> {{ return COLOR; }}\n"
    )
}

/// A pipeline's key: what it compiles from, hashed, so it's the same on every backend.
pub fn pipeline_key(source: &str, samples: u32, blend: bool) -> String {
    let mut h = Sha256::new();
    h.update(source.as_bytes());
    h.update(format!(
        "/bgra8unorm/{samples}/{}",
        if blend { "over" } else { "replace" }
    ));
    h.finalize()
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The samples the regions' pass draws with, into a transient (memoryless) target resolved into
/// the slot. Every region covers whole pixels, so the resolve is exact.
pub const MSAA: u32 = 4;

/// Compiles one pipeline; `fragment` names the entry point (`region_fragment`, or `fragment` in a
/// pipeline's own module).
pub fn compile(
    device: &wgpu::Device,
    layout: Option<&wgpu::PipelineLayout>,
    module: &wgpu::ShaderModule,
    (vertex, fragment): (&str, &str),
    samples: u32,
    blend: bool,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(MODULE),
        layout,
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vertex),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: Default::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState {
            count: samples,
            ..Default::default()
        },
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fragment),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: FORMAT,
                blend: blend.then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

/// One of a scene's pipelines, compiled from its own module.
pub fn compile_named(
    device: &wgpu::Device,
    k: u32,
    color: [u8; 4],
) -> (String, wgpu::RenderPipeline) {
    let source = pipeline_source(k, color);
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(MODULE),
        source: wgpu::ShaderSource::Wgsl(source.as_str().into()),
    });
    let key = pipeline_key(&source, MSAA, false);
    (
        key,
        compile(device, None, &module, ("vertex", "fragment"), MSAA, false),
    )
}

struct Built {
    epoch: u64,
    regions: wgpu::Buffer,
    bind: wgpu::BindGroup,
    replace: wgpu::RenderPipeline,
    over: wgpu::RenderPipeline,
    /// The regions pass's transient MSAA target, at the size it was made for.
    msaa: Option<([u32; 2], wgpu::TextureView)>,
}

/// One of a scene's own pipelines: its index, key, the device epoch it was compiled on, and itself.
pub type Named = (u32, String, u64, wgpu::RenderPipeline);

/// A scene's own pipelines as the view installed them, and the ones the last frame drew with the
/// epochs they were compiled on (issue #140, criterion 20: a compile-thread job's pipelines reach
/// the view here, or are dropped).
#[derive(Default)]
pub struct Installed {
    pub pipelines: Vec<Named>,
    pub drawn: Vec<(String, u64)>,
}

/// The test render module `test.scene@1`.
pub struct SceneModule {
    pub scene: Arc<Scene>,
    built: Option<Built>,
    installed: Arc<Mutex<Installed>>,
    /// The texture fill's bytes, uploaded again after every build.
    texture: Option<Arc<[u8]>>,
    pending_upload: Option<(wgpu::Buffer, Arc<[u8]>)>,
}

pub const MODULE: &str = "test.scene@1";
const MAX_REGIONS: u64 = 64;

impl SceneModule {
    pub fn new(scene: Arc<Scene>) -> Self {
        let texture = scene.texture().map(|(w, h)| xor_texels(w, h));
        Self {
            scene,
            built: None,
            installed: Arc::default(),
            texture,
            pending_upload: None,
        }
    }

    /// What the view installs its compile-thread jobs' pipelines into.
    pub fn installed(&self) -> Arc<Mutex<Installed>> {
        self.installed.clone()
    }
}

impl RenderModule for SceneModule {
    fn name(&self) -> &'static str {
        MODULE
    }

    fn declared(&self) -> Vec<&'static str> {
        let mut d = vec![
            "regions:buffer",
            "texels:buffer",
            "bind group:bind_group",
            "shader:shader_module",
            "replace:render_pipeline",
            "over:render_pipeline",
        ];
        if !self.scene.regions.is_empty() {
            d.push("msaa:texture");
        }
        if !self.scene.pipelines().is_empty() {
            d.push("pipelines:render_pipeline");
        }
        d
    }

    /// The regions, then each layer composited over everything before it, all in `geometry`.
    fn passes(&self) -> Vec<Pass> {
        let pass = |name: String, order: u32, reads: Vec<&'static str>| Pass {
            name,
            place: "geometry",
            order,
            reads,
            writes: vec!["slot"],
            resolution: Resolution::Full,
            ns_per_px: 0.02,
            determinism: Determinism::SameMachine,
        };
        let mut passes = Vec::new();
        if !self.scene.regions.is_empty() {
            passes.push(pass("regions".into(), 0, Vec::new()));
        }
        for k in 0..self.scene.layers.len() {
            // A scene of layers alone clears in its first, which reads nothing.
            let reads = if passes.is_empty() {
                Vec::new()
            } else {
                vec!["slot"]
            };
            passes.push(pass(format!("layer{k}"), 1 + k as u32, reads));
        }
        passes
    }

    fn build(&mut self, device: &Device) -> Result<(), String> {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(MODULE),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let regions = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("test.scene regions"),
            size: MAX_REGIONS * std::mem::size_of::<Gpu>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let texel_bytes = self.texture.as_ref().map_or(16, |t| t.len() as u64);
        let texels = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("test.scene texels"),
            size: texel_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let bind_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[entry(0), entry(1)],
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &bind_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: regions.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: texels.as_entire_binding(),
                },
            ],
        });
        let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let entries = ("region_vertex", "region_fragment");
        let replace = compile(d, Some(&layout), &module, entries, MSAA, false);
        let over = compile(d, Some(&layout), &module, entries, 1, true);
        let named: Vec<Named> = self
            .scene
            .pipelines()
            .into_iter()
            .map(|(k, color)| {
                let (key, p) = compile_named(d, k, color);
                (k, key, device.epoch, p)
            })
            .collect();
        self.installed
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pipelines = named;
        if let Some(t) = &self.texture {
            self.pending_upload = Some((texels, t.clone()));
        }
        self.built = Some(Built {
            epoch: device.epoch,
            regions,
            bind,
            replace,
            over,
            msaa: None,
        });
        Ok(())
    }

    fn built_on(&self) -> Option<u64> {
        self.built.as_ref().map(|b| b.epoch)
    }

    fn take_uploads(&mut self) -> Vec<(wgpu::Buffer, Arc<[u8]>)> {
        self.pending_upload.take().into_iter().collect()
    }

    fn layers(&mut self, device: &Device, target: &Target) -> Vec<(String, Job)> {
        let Some(b) = self.built.as_mut() else {
            return Vec::new();
        };
        let scene = &self.scene;
        let size = target.size;
        if !scene.regions.is_empty() && b.msaa.as_ref().is_none_or(|(s, _)| *s != size) {
            let view = device
                .device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("test.scene msaa"),
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: MSAA,
                    dimension: wgpu::TextureDimension::D2,
                    format: FORMAT,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TRANSIENT_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&Default::default());
            b.msaa = Some((size, view));
        }
        // One record per region, then one per layer; each draw reads its own by instance index.
        let mut records = Vec::new();
        let mut draws: Vec<(u32, [u32; 4], Option<u32>)> = Vec::new();
        for r in scene.regions.iter().chain(&scene.layers) {
            let [x, y, w, h] = r.rect_at(target.frame, size);
            let (x0, y0) = (x.max(0), y.max(0));
            let x1 = (x + w).min(i64::from(size[0]));
            let y1 = (y + h).min(i64::from(size[1]));
            records.push(record(r, [x, y], target.frame));
            let scissor = if x1 > x0 && y1 > y0 {
                [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32]
            } else {
                [0; 4]
            };
            draws.push(((records.len() - 1) as u32, scissor, r.pipeline));
        }
        device
            .queue
            .write_buffer(&b.regions, 0, bytemuck::cast_slice(&records));
        let clear = {
            let [bl, g, r, a] = scene.background.map(|c| f64::from(c) / 255.0);
            wgpu::Color { r, g, b: bl, a }
        };
        let regions = scene.regions.len();
        let mut jobs: Vec<(String, Job)> = Vec::new();
        // The regions are one writer layer, drawn over the cleared background into the transient
        // MSAA target and resolved into the slot. A scene of layers alone clears in its first.
        if regions > 0 {
            let (slot, msaa) = (
                target.view.clone(),
                b.msaa.as_ref().expect("made above").1.clone(),
            );
            let bind = b.bind.clone();
            let mut installed = self.installed.lock().unwrap_or_else(|e| e.into_inner());
            let mut drawn = Vec::new();
            let list: Vec<_> = draws[..regions]
                .iter()
                .map(|&(i, s, p)| {
                    let named = p.and_then(|p| installed.pipelines.iter().find(|n| n.0 == p));
                    if let Some((_, key, epoch, _)) = named.filter(|_| s[2] > 0) {
                        if !drawn.iter().any(|(k, _)| k == key) {
                            drawn.push((key.clone(), *epoch));
                        }
                    }
                    let pipeline = named.map_or_else(|| b.replace.clone(), |n| n.3.clone());
                    (i, s, pipeline)
                })
                .collect();
            installed.drawn = drawn;
            drop(installed);
            jobs.push((
                "regions".into(),
                Box::new(move |encoder| {
                    let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(MODULE),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &msaa,
                            resolve_target: Some(&slot),
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(clear),
                                store: wgpu::StoreOp::Discard,
                            },
                        })],
                        ..Default::default()
                    });
                    rp.set_bind_group(0, &bind, &[]);
                    for (i, s, pipeline) in &list {
                        if s[2] == 0 {
                            continue;
                        }
                        rp.set_pipeline(pipeline);
                        rp.set_scissor_rect(s[0], s[1], s[2], s[3]);
                        rp.draw(0..3, *i..*i + 1);
                    }
                }),
            ));
        }
        // Each layer is a writer layer of its own, composited over everything before it.
        for (k, &(i, s, _)) in draws[regions..].iter().enumerate() {
            let load = if regions == 0 && k == 0 {
                wgpu::LoadOp::Clear(clear)
            } else {
                wgpu::LoadOp::Load
            };
            let view = target.view.clone();
            let bind = b.bind.clone();
            let over = b.over.clone();
            jobs.push((
                format!("layer{k}"),
                Box::new(move |encoder| {
                    let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(MODULE),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        ..Default::default()
                    });
                    if s[2] == 0 {
                        return;
                    }
                    rp.set_bind_group(0, &bind, &[]);
                    rp.set_pipeline(&over);
                    rp.set_scissor_rect(s[0], s[1], s[2], s[3]);
                    rp.draw(0..3, i..i + 1);
                }),
            ));
        }
        jobs
    }
}
