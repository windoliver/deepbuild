//! A writer layer's groups the GPU layer composites (canvas primitives: Frame and group: blend
//! modes; passes; backdrop): the layer's marks drawn run by run by Vello GPU, each composited
//! group's children into an isolated target, its passes on that target, each on the result of the
//! one before, within its bounds grown by grow, and the result composited at its draw order with
//! its blend and opacity. A backdrop group's passes run on what the layer drew before it, inside
//! its children's coverage. Everything happens in the space the layer composites in:
//! sRGB-encoded in a 2D writer layer, linear light in a 3D one.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas::blend;
use deep_canvas_effects::emit::Options as EmitOptions;
use deep_canvas_effects::fx::Named;
use deep_canvas_effects::module::pass_graph;
use deep_canvas_marks::scene::{Blend, Drawn, Effect, Scope};
use deep_effects_render::compile::compile_with;
use deep_effects_render::docops::{item_seed, DocOps, Profiled};
use deep_effects_render::runner::{Frame, LINEAR};
use deep_gpu::device::Device;
use deep_marks_render::gpu::{Options, Vello2d};
use deep_scene3d_render::status::{Guard, Stage};
use serde_json::{json, Map, Value};
use wgpu::util::DeviceExt as _;

use crate::opframe::{f32_bytes, read_texture};
use crate::{refused, Planted};

/// Flicks a second.
pub const FLICKS: f64 = 705_600_000.0;

/// The space a writer layer composites in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Space {
    Encoded,
    Linear,
}

/// What a frame's groups read of the document and its time.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    pub t: i64,
    pub frame_rate: (u32, u32),
    pub seed: u64,
}

impl Clock {
    pub fn of(doc: &Map<String, Value>, t: i64) -> Clock {
        let rate = doc
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        Clock {
            t,
            frame_rate: rate,
            seed: doc.get("seed").and_then(Value::as_u64).unwrap_or(0),
        }
    }

    /// The video frame index ⌊t × frame_rate⌋.
    fn frame(&self) -> u32 {
        let (n, d) = self.frame_rate;
        (i128::from(self.t) * i128::from(n)).div_euclid(i128::from(d) * FLICKS as i128) as u32
    }
}

/// Whether the group scope `s` needs the GPU layer.
fn wants(s: &Scope) -> bool {
    matches!(s, Scope::Opacity { blend, effect, .. }
        if effect.is_some() || blend.is_some_and(Blend::gpu_only))
}

/// Whether any of `marks` draws inside a group only the GPU layer composites.
pub fn composited<'a>(marks: impl IntoIterator<Item = &'a Drawn>) -> bool {
    marks.into_iter().any(|d| d.scopes.iter().any(wants))
}

/// The groups these marks need composited: each one that wants the GPU layer and every group
/// around one, since a Vello layer can't hold what the GPU layer draws.
fn ids(marks: &[Drawn]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for d in marks {
        let Some(last) = d.scopes.iter().rposition(wants) else {
            continue;
        };
        for s in &d.scopes[..=last] {
            if matches!(s, Scope::Opacity { .. }) {
                out.insert(s.item().to_string());
            }
        }
    }
    out
}

/// The internal mode of a composite that replaces the target: [`blend::MODES`] ends before it.
const REPLACE: u32 = 28;

fn whole(size: [u32; 2]) -> wgpu::Extent3d {
    wgpu::Extent3d {
        width: size[0],
        height: size[1],
        depth_or_array_layers: 1,
    }
}

/// The mark outside the scope at `k`.
fn without(d: &Drawn, k: usize) -> Drawn {
    let mut d = d.clone();
    d.scopes.remove(k);
    d
}

fn backdrop_of(s: &Scope) -> bool {
    matches!(s, Scope::Opacity { effect: Some(e), .. } if e.backdrop)
}

/// `--planted`: whether the group's passes wait for the layer's end.
fn late(planted: Option<Planted>, s: &Scope) -> bool {
    let passes = matches!(s, Scope::Opacity { effect: Some(e), .. } if !e.passes.is_empty());
    match planted {
        Some(Planted::GroupPassAtLayerEnd) => passes && !backdrop_of(s),
        Some(Planted::BackdropReadsLaterItems) => backdrop_of(s),
        _ => false,
    }
}

/// The most groups a frame isolates (Frame and group).
const MAX_ISOLATED: usize = 32;

/// The format a layer and its groups composite in: a half float rounds a blend's result past a
/// 10-bit code, and operators run on [`LINEAR`], so a pass's input is copied there.
const ACC: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

/// The px `r` (u, `[x, y, w, h]`) grown by `grow` covers of a `size` target, `[x, y, w, h]`.
fn px(r: [f64; 4], grow: f64, size: [u32; 2]) -> [u32; 4] {
    let (w, h) = (f64::from(size[0]), f64::from(size[1]));
    let x0 = (r[0] - grow).floor().clamp(0.0, w);
    let y0 = (r[1] - grow).floor().clamp(0.0, h);
    let x1 = (r[0] + r[2] + grow).ceil().clamp(0.0, w);
    let y1 = (r[1] + r[3] + grow).ceil().clamp(0.0, h);
    [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32]
}

fn union(marks: &[Drawn]) -> [f64; 4] {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for [x, y, w, h] in marks.iter().map(Drawn::extent) {
        (x0, y0) = (x0.min(x), y0.min(y));
        (x1, y1) = (x1.max(x + w), y1.max(y + h));
    }
    [x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)]
}

/// The scale a pass's `resolution` runs it at.
fn scale_of(graph: &Value) -> f64 {
    match graph["resolution"].as_str() {
        Some("full") => 1.0,
        Some("quarter") => 0.25,
        _ => 0.5,
    }
}

/// A new target of the compositor.
fn target(device: &wgpu::Device, size: [u32; 2], format: wgpu::TextureFormat) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("group target"),
        size: whole(size),
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

/// The compositor on one device: its pipelines, each group's operators, kept while their graphs
/// stay the same, and its targets, kept from frame to frame.
pub struct Groups {
    layout: wgpu::BindGroupLayout,
    module: wgpu::ShaderModule,
    pipelines: wgpu::PipelineLayout,
    mix: wgpu::RenderPipeline,
    mix_linear: wgpu::RenderPipeline,
    resolves: BTreeMap<String, wgpu::RenderPipeline>,
    ops: BTreeMap<String, (String, DocOps)>,
    /// Targets free to take, and those the frame in hand took.
    free: Vec<wgpu::Texture>,
    taken: Vec<wgpu::Texture>,
    stage: Option<Stage>,
}

fn pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    module: &wgpu::ShaderModule,
    entry: &str,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("group composite"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// The composite's bind group: its uniform and its three textures.
fn bound(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    words: &[u8],
    textures: [&wgpu::TextureView; 3],
) -> wgpu::BindGroup {
    let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("group composite"),
        contents: words,
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let [back, source, cover] = textures.map(wgpu::BindingResource::TextureView);
    let entries: Vec<wgpu::BindGroupEntry> = [uniform.as_entire_binding(), back, source, cover]
        .into_iter()
        .zip(0..)
        .map(|(resource, binding)| wgpu::BindGroupEntry { binding, resource })
        .collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("group composite"),
        layout,
        entries: &entries,
    })
}

/// One composite: `source` over the target (or replacing it inside `cover`'s alpha) within `rect`.
struct Mix<'a> {
    source: &'a wgpu::TextureView,
    cover: Option<&'a wgpu::TextureView>,
    mode: u32,
    alpha: f32,
    decode: bool,
    /// `source` holds straight colors.
    straight: bool,
    dancing: bool,
    seed: u32,
    frame: u32,
    rect: [u32; 4],
}

impl<'a> Mix<'a> {
    /// `source` over the whole of a `size` target.
    fn over(source: &'a wgpu::TextureView, size: [u32; 2]) -> Mix<'a> {
        Mix {
            source,
            cover: None,
            mode: 0,
            alpha: 1.0,
            decode: false,
            straight: false,
            dancing: false,
            seed: 0,
            frame: 0,
            rect: [0, 0, size[0], size[1]],
        }
    }
}

/// One drawing's state: what every run of marks reads.
struct Run<'a> {
    device: &'a Device,
    vello: &'a mut Vello2d,
    size: [u32; 2],
    options: Options,
    space: Space,
    clock: Clock,
    roles: &'a BTreeMap<String, [f64; 3]>,
    packs: &'a [Named],
    canonical: bool,
    planted: Option<Planted>,
    /// The targets around the one being drawn, outermost first: a backdrop reads them all, since
    /// no ancestor group makes another root than the writer layer.
    around: Vec<wgpu::Texture>,
    /// The inputs each blended group composited, when the drawing keeps them.
    inputs: Option<Vec<BlendInputs>>,
    /// The px of each group whose operators wrote pixels, for the status guard.
    written: Vec<[u32; 4]>,
    /// `--planted`: the other writers' pixels, and the groups left for the layer's end.
    other: Option<wgpu::Texture>,
    late: Vec<(Vec<Drawn>, usize)>,
}

/// What a group's blend took: what its writer layer drew before it and its own content, each in
/// the space the layer composites in, premultiplied f32.
#[derive(Clone)]
pub struct BlendInputs {
    pub group: String,
    pub mode: &'static str,
    pub backdrop: Vec<u8>,
    pub source: Vec<u8>,
}

/// A layer read back: straight 8-bit RGBA, and what the GPU layer held when the call kept it.
pub struct Picture {
    pub image: image::RgbaImage,
    pub floats: Option<Vec<u8>>,
    pub inputs: Vec<BlendInputs>,
}

impl Groups {
    pub fn new(device: &wgpu::Device) -> Groups {
        let source = format!("{}\n{}", blend::WGSL, include_str!("groups.wgsl"));
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("groups"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("group composite"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                texture(1),
                texture(2),
                texture(3),
            ],
        });
        let pipelines = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("group composite"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let mix = pipeline(device, &pipelines, &module, "fs", ACC);
        let mix_linear = pipeline(device, &pipelines, &module, "fs", LINEAR);
        Groups {
            layout,
            module,
            pipelines,
            mix,
            mix_linear,
            resolves: BTreeMap::new(),
            ops: BTreeMap::new(),
            free: Vec::new(),
            taken: Vec::new(),
            stage: None,
        }
    }

    /// A target of `size` and `format` for this frame, cleared to transparent.
    fn take(
        &mut self,
        device: &Device,
        size: [u32; 2],
        format: wgpu::TextureFormat,
    ) -> wgpu::Texture {
        let fits = |t: &wgpu::Texture| t.size() == whole(size) && t.format() == format;
        let t = match self.free.iter().position(fits) {
            Some(i) => {
                let t = self.free.swap_remove(i);
                let mut encoder = device.device.create_command_encoder(&Default::default());
                let view = t.create_view(&Default::default());
                let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("group target clear"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                device.queue.submit([encoder.finish()]);
                t
            }
            None => target(&device.device, size, format),
        };
        self.taken.push(t.clone());
        t
    }

    /// Frees `t` for the frame's next take: its work is submitted, and what's next runs after it.
    fn give(&mut self, t: &wgpu::Texture) {
        if let Some(i) = self.taken.iter().position(|k| k == t) {
            self.free.push(self.taken.swap_remove(i));
        }
    }

    /// Draws one composite on its own command buffer.
    fn composite(&mut self, device: &Device, into: &wgpu::Texture, m: Mix<'_>, size: [u32; 2]) {
        let [x, y, w, h] = m.rect;
        if w == 0 || h == 0 {
            return;
        }
        let d = &device.device;
        let mut encoder = d.create_command_encoder(&Default::default());
        let copy = self.take(device, size, into.format());
        encoder.copy_texture_to_texture(into.as_image_copy(), copy.as_image_copy(), whole(size));
        let back = copy.create_view(&Default::default());
        let flags = u32::from(m.decode)
            | (u32::from(m.cover.is_some()) << 1)
            | (u32::from(m.dancing) << 2)
            | (u32::from(m.straight) << 3);
        let mut words = Vec::with_capacity(32);
        words.extend_from_slice(&m.mode.to_le_bytes());
        words.extend_from_slice(&flags.to_le_bytes());
        words.extend_from_slice(&m.alpha.to_le_bytes());
        words.extend_from_slice(&m.seed.to_le_bytes());
        words.extend_from_slice(&m.frame.to_le_bytes());
        words.resize(32, 0);
        let cover = m.cover.unwrap_or(m.source);
        let group = bound(d, &self.layout, &words, [&back, m.source, cover]);
        let view = into.create_view(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("group composite"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(if into.format() == ACC {
                &self.mix
            } else {
                &self.mix_linear
            });
            pass.set_bind_group(0, &group, &[]);
            pass.set_scissor_rect(x, y, w, h);
            pass.draw(0..3, 0..1);
        }
        device.queue.submit([encoder.finish()]);
        self.give(&copy);
    }

    /// `marks` in draw order into `into`: each run outside the composited groups by Vello GPU,
    /// each group through [`Groups::group`].
    fn marks(
        &mut self,
        x: &mut Run<'_>,
        marks: &[Drawn],
        into: &wgpu::Texture,
    ) -> Result<(), Value> {
        let ids = ids(marks);
        let at = |d: &Drawn| d.scopes.iter().position(|s| ids.contains(s.item()));
        let mut i = 0;
        while i < marks.len() {
            let start = marks[i..]
                .iter()
                .position(|d| at(d).is_some())
                .map_or(marks.len(), |k| i + k);
            if start > i {
                self.plain(x, &marks[i..start], into)?;
            }
            let Some(k) = marks.get(start).and_then(at) else {
                break;
            };
            let group = marks[start].scopes[k].item();
            let end = marks[start..]
                .iter()
                .position(|d| !d.scopes.iter().any(|s| s.item() == group))
                .map_or(marks.len(), |n| start + n);
            if late(x.planted, &marks[start].scopes[k]) {
                // Its children draw now; its passes wait for the layer's end.
                let inside: Vec<Drawn> = marks[start..end].iter().map(|d| without(d, k)).collect();
                if !backdrop_of(&marks[start].scopes[k]) {
                    self.plain(x, &inside, into)?;
                }
                x.late.push((marks[start..end].to_vec(), k));
            } else {
                self.group(x, &marks[start..end], k, into)?;
            }
            i = end;
        }
        Ok(())
    }

    /// A run of marks by Vello GPU, laid over `into` source-over.
    fn plain(
        &mut self,
        x: &mut Run<'_>,
        marks: &[Drawn],
        into: &wgpu::Texture,
    ) -> Result<(), Value> {
        let d = &x.device.device;
        let picture = self.take(x.device, x.size, x.vello.format());
        let view = picture.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        x.vello.draw(
            d,
            &x.device.queue,
            &mut encoder,
            marks.iter(),
            x.size,
            &view,
            x.options,
        )?;
        x.device.queue.submit([encoder.finish()]);
        let mix = Mix {
            decode: x.space == Space::Linear,
            ..Mix::over(&view, x.size)
        };
        self.composite(x.device, into, mix, x.size);
        self.give(&picture);
        Ok(())
    }

    /// One group's run of marks, whose scope is at `k`, into `into`.
    fn group(
        &mut self,
        x: &mut Run<'_>,
        run: &[Drawn],
        k: usize,
        into: &wgpu::Texture,
    ) -> Result<(), Value> {
        let Scope::Opacity {
            item,
            alpha,
            blend: mode,
            effect,
        } = &run[0].scopes[k]
        else {
            return Err(refused("bad_input", "a composited scope is a group's"));
        };
        let inside: Vec<Drawn> = run.iter().map(|d| without(d, k)).collect();
        let bounds = union(&inside);
        let d = &x.device.device;
        let children = self.take(x.device, x.size, ACC);
        if x.planted == Some(Planted::GroupPassReadsEarlier) {
            let mut encoder = d.create_command_encoder(&Default::default());
            encoder.copy_texture_to_texture(
                into.as_image_copy(),
                children.as_image_copy(),
                whole(x.size),
            );
            x.device.queue.submit([encoder.finish()]);
        }
        x.around.push(into.clone());
        let drawn = self.marks(x, &inside, &children);
        x.around.pop();
        drawn?;
        let view = children.create_view(&Default::default());
        let (shown, cover, rect) = match effect.as_deref() {
            Some(e) if e.backdrop => {
                let layer = self.flattened(x, into);
                let (passed, grow) = self.passes(x, item, e, bounds, &layer)?;
                let rect = if x.planted == Some(Planted::BackdropPastCoverage) {
                    grow
                } else {
                    0.0
                };
                (passed, true, rect)
            }
            Some(e) if !e.passes.is_empty() => {
                let (passed, grow) = self.passes(x, item, e, bounds, &view)?;
                (passed, false, grow)
            }
            _ => (view.clone(), false, 0.0),
        };
        if let (true, Some(b)) = (x.inputs.is_some(), mode.filter(|b| *b != Blend::Normal)) {
            let backdrop = f32_bytes(&read_texture(x.device, into, 0).1);
            let source = self.floats(x.device, &shown, x.size);
            let group = item.clone();
            let inputs = BlendInputs {
                group,
                mode: b.name(),
                backdrop,
                source,
            };
            x.inputs
                .iter_mut()
                .for_each(|list| list.push(inputs.clone()));
        }
        let number = match mode {
            Some(Blend::VividLight) if x.planted == Some(Planted::VividLightAsLinearLight) => {
                blend::index("linear_light")
            }
            _ => mode.and_then(|b| blend::index(b.name())),
        };
        let mut m = Mix {
            source: &shown,
            cover: cover.then_some(&view),
            mode: number.unwrap_or(0),
            alpha: *alpha as f32,
            decode: false,
            straight: false,
            dancing: effect.as_deref().is_some_and(|e| e.dancing),
            seed: item_seed(x.clock.seed, item),
            frame: x.clock.frame(),
            rect: px(bounds, rect, x.size),
        };
        if cover && x.planted == Some(Planted::BackdropPastCoverage) {
            m.cover = None;
            m.mode = REPLACE;
        }
        if x.planted == Some(Planted::GroupPassPastGrow) {
            m.rect = [0, 0, x.size[0], x.size[1]];
        }
        if wants(&run[0].scopes[k]) {
            x.written.push(m.rect);
        }
        self.composite(x.device, into, m, x.size);
        self.give(&children);
        Ok(())
    }

    /// What the writer layer drew so far: the targets around this one, each over the last, and
    /// the planted other writers under them.
    fn flattened(&mut self, x: &Run<'_>, into: &wgpu::Texture) -> wgpu::TextureView {
        if x.around.is_empty() && x.other.is_none() {
            return into.create_view(&Default::default());
        }
        let flat = self.take(x.device, x.size, ACC);
        for t in x.other.iter().chain(&x.around).chain([into]) {
            let source = t.create_view(&Default::default());
            let mix = Mix::over(&source, x.size);
            self.composite(x.device, &flat, mix, x.size);
        }
        flat.create_view(&Default::default())
    }

    /// `view` read back as f32 bytes.
    fn floats(&mut self, device: &Device, view: &wgpu::TextureView, size: [u32; 2]) -> Vec<u8> {
        let copy = self.take(device, size, ACC);
        let mix = Mix::over(view, size);
        self.composite(device, &copy, mix, size);
        let bytes = f32_bytes(&read_texture(device, &copy, 0).1);
        self.give(&copy);
        bytes
    }

    /// A group's passes on `color`, in the space its layer composites in.
    fn passes(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let other = matches!(
            (x.planted, x.space),
            (Some(Planted::PassLinearIn2d), Space::Encoded)
                | (Some(Planted::PassEncodedIn3d), Space::Linear)
        );
        if other {
            self.in_other_space(x, group, e, bounds, color)
        } else {
            self.run_passes(x, group, e, bounds, color)
        }
    }

    /// A group's passes in order on `color`, each on the last one's result, each within the
    /// group's bounds grown by the grows so far: the result and the whole grow.
    fn run_passes(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let mut items = Map::new();
        let mut scales = BTreeMap::new();
        let mut params = BTreeMap::new();
        let mut within = BTreeMap::new();
        let mut grow = 0.0;
        for (i, p) in e.passes.iter().enumerate() {
            let at = format!("items/{group}/params/passes/{i}/op");
            let graph = pass_graph(&p.op, p.item.as_ref(), &p.params, x.packs)
                .map_err(|code| refused(code, &at))?;
            grow += p.grow.unwrap_or(graph.grow);
            for (j, stage) in graph.stages.iter().enumerate() {
                compile_with(stage, &BTreeMap::new(), EmitOptions::default())
                    .map_err(|issues| refused(issues[0].code, &at))?;
                let id = format!("{group}#pass{i}.{j}");
                scales.insert(id.clone(), scale_of(stage));
                params.insert(id.clone(), p.params.clone().into_iter().collect());
                if x.planted != Some(Planted::GroupPassPastGrow) {
                    within.insert(id.clone(), px(bounds, grow, x.size));
                }
                items.insert(id, json!({"kind": "gpu.pass@1", "params": stage}));
            }
        }
        // Operators read a filterable target.
        let input = self.take(x.device, x.size, LINEAR);
        let mix = Mix {
            mode: REPLACE,
            ..Mix::over(color, x.size)
        };
        self.composite(x.device, &input, mix, x.size);
        let color = &input.create_view(&Default::default());
        let doc = json!({"seed": x.clock.seed, "items": items});
        let key = doc.to_string();
        let device = x.device;
        let stale = self.ops.get(group).is_none_or(|(k, _)| *k != key);
        if stale {
            let ops = DocOps::new(
                device,
                &doc,
                EmitOptions::default(),
                Default::default(),
                &[],
            );
            self.ops.insert(group.to_string(), (key, ops));
        }
        let (_, ops) = self.ops.get_mut(group).expect("built above");
        ops.params = params;
        ops.within = within;
        let frame = Frame {
            t: (x.clock.t as f64 / FLICKS) as f32,
            ..Frame::default()
        };
        let resolution = |item: &str| scales.get(item).copied().unwrap_or(0.5);
        let (_, recs, shown) = ops.plan(
            device,
            color,
            None,
            None,
            x.size,
            &frame,
            x.roles,
            &resolution,
            x.canonical,
        );
        let mut encoder = device.device.create_command_encoder(&Default::default());
        let mut times = Profiled::new(None);
        for r in &recs {
            r.record(&mut encoder, &mut times);
        }
        device.queue.submit([encoder.finish()]);
        Ok((shown.unwrap_or_else(|| color.clone()), grow))
    }

    /// `--planted`: [`Groups::passes`] in the other space, each way by the compositor's own
    /// two conversions.
    fn in_other_space(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let d = &x.device.device;
        let (size, device) = (x.size, x.device);
        let encoded = |this: &mut Groups, from: &wgpu::TextureView| {
            let t = target(d, size, ACC);
            let mut encoder = d.create_command_encoder(&Default::default());
            let v = t.create_view(&Default::default());
            this.resolve(d, &mut encoder, from, &v, ACC, Space::Linear);
            device.queue.submit([encoder.finish()]);
            v
        };
        let decoded = |this: &mut Groups, from: &wgpu::TextureView| {
            let t = target(d, size, ACC);
            let mix = Mix {
                decode: true,
                ..Mix::over(from, size)
            };
            this.composite(device, &t, mix, size);
            t.create_view(&Default::default())
        };
        let linear_in_2d = x.space == Space::Encoded;
        let there = if linear_in_2d {
            decoded(self, color)
        } else {
            encoded(self, color)
        };
        let (passed, grow) = self.run_passes(x, group, e, bounds, &there)?;
        let back = if linear_in_2d {
            encoded(self, &passed)
        } else {
            decoded(self, &passed)
        };
        Ok((back, grow))
    }

    /// Writes the finished layer into `view`, premultiplied and sRGB-encoded.
    fn resolve(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        layer: &wgpu::TextureView,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        space: Space,
    ) {
        self.resolve_as(device, encoder, layer, view, format, space, false);
    }

    /// [`Groups::resolve`], in straight colors when `straight`.
    #[allow(clippy::too_many_arguments)]
    fn resolve_as(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        layer: &wgpu::TextureView,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        space: Space,
        straight: bool,
    ) {
        let (layout, module) = (&self.pipelines, &self.module);
        let pipeline = self
            .resolves
            .entry(format!("{format:?}"))
            .or_insert_with(|| pipeline(device, layout, module, "resolve", format));
        let mut words = [0u8; 32];
        words[4] = u8::from(space == Space::Linear) | (u8::from(straight) << 1);
        let group = bound(device, &self.layout, &words, [layer, layer, layer]);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("group resolve"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// One layer's drawing through the compositor.
pub struct Layer<'a> {
    /// The writer layers in order, each composed alone: no pass reads another writer's pixels.
    pub layers: &'a [&'a [Arc<Drawn>]],
    pub size: [u32; 2],
    pub options: Options,
    pub clock: Clock,
    pub roles: &'a BTreeMap<String, [f64; 3]>,
    /// The named operators of the packs the call installed.
    pub packs: &'a [Named],
    /// A canonical render: a live-only operator draws its fallback.
    pub canonical: bool,
    /// A 3D writer layer's 3D pixels, straight sRGB-encoded RGBA, which puts the layer in linear
    /// light; `None` for a 2D writer layer.
    pub base: Option<&'a image::RgbaImage>,
    /// Keep the float pixels and each blend's inputs.
    pub keep: bool,
    pub planted: Option<Planted>,
    /// Where status can show: the guard every operator's pixels pass.
    pub guard: Option<&'a Guard>,
    /// `--planted`: the other writers' pixels, straight sRGB-encoded RGBA.
    pub other: Option<&'a image::RgbaImage>,
}

/// `image`, straight sRGB-encoded RGBA, as a texture of premultiplied pixels.
fn upload(device: &Device, image: &image::RgbaImage, size: [u32; 2]) -> wgpu::Texture {
    let mut premultiplied = image.clone();
    for p in premultiplied.pixels_mut() {
        let a = u16::from(p[3]);
        for c in &mut p.0[..3] {
            *c = ((u16::from(*c) * a + 127) / 255) as u8;
        }
    }
    device.device.create_texture_with_data(
        &device.queue,
        &wgpu::TextureDescriptor {
            label: Some("layer pixels"),
            size: whole(size),
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        },
        Default::default(),
        premultiplied.as_raw(),
    )
}

impl Groups {
    /// `image` laid over the empty target `into`, in `space`.
    fn laid(
        &mut self,
        device: &Device,
        image: &image::RgbaImage,
        into: &wgpu::Texture,
        size: [u32; 2],
        decode: bool,
    ) {
        let texture = upload(device, image, size);
        let source = texture.create_view(&Default::default());
        let mix = Mix {
            decode,
            ..Mix::over(&source, size)
        };
        self.composite(device, into, mix, size);
    }

    /// `layer` composed: its target, in the space it composites in, and each blend's inputs.
    pub fn compose(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
    ) -> Result<(wgpu::Texture, Vec<BlendInputs>), Value> {
        self.free.append(&mut self.taken);
        // A frame isolates at most 32 groups (Frame and group).
        let drawn = layer
            .layers
            .iter()
            .flat_map(|l| l.iter())
            .flat_map(|m| &m.scopes);
        let mut groups = BTreeSet::new();
        for s in drawn {
            if matches!(s, Scope::Opacity { item, .. } if !item.contains('#')) {
                groups.insert(s.item());
                if groups.len() > MAX_ISOLATED {
                    return Err(refused("operator_limit", format!("items/{}", s.item())));
                }
            }
        }
        let mut stack: Option<wgpu::Texture> = None;
        let mut inputs = Vec::new();
        for marks in layer.layers {
            let (done, kept) = self.one(device, vello, layer, marks)?;
            inputs.extend(kept);
            stack = Some(match stack {
                Some(under) => {
                    let view = done.create_view(&Default::default());
                    self.composite(device, &under, Mix::over(&view, layer.size), layer.size);
                    self.give(&done);
                    under
                }
                None => done,
            });
        }
        let stack = match stack {
            Some(stack) => stack,
            None => self.take(device, layer.size, ACC),
        };
        Ok((stack, inputs))
    }

    /// One writer layer composed alone.
    fn one(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
        marks: &[Arc<Drawn>],
    ) -> Result<(wgpu::Texture, Vec<BlendInputs>), Value> {
        let linear = layer.base.is_some();
        let done = self.take(device, layer.size, ACC);
        if let Some(base) = layer.base {
            self.laid(device, base, &done, layer.size, true);
        }
        let other = layer.other.map(|image| {
            let t = target(&device.device, layer.size, ACC);
            self.laid(device, image, &t, layer.size, linear);
            t
        });
        let marks: Vec<Drawn> = marks.iter().map(|m| (**m).clone()).collect();
        let mut run = Run {
            device,
            vello,
            size: layer.size,
            options: layer.options,
            space: if linear {
                Space::Linear
            } else {
                Space::Encoded
            },
            clock: layer.clock,
            roles: layer.roles,
            packs: layer.packs,
            canonical: layer.canonical,
            planted: layer.planted,
            around: Vec::new(),
            inputs: layer.keep.then(Vec::new),
            written: Vec::new(),
            other,
            late: Vec::new(),
        };
        self.marks(&mut run, &marks, &done)?;
        for (group, k) in std::mem::take(&mut run.late) {
            self.late(&mut run, &group, k, &done)?;
        }
        if let Some(guard) = layer.guard {
            let written = std::mem::take(&mut run.written);
            self.guarded(&run, guard, &written, &done);
        }
        Ok((done, run.inputs.unwrap_or_default()))
    }

    /// Moves what `written` holds of `done` past the status guard, which reads sRGB-encoded pixels.
    fn guarded(&mut self, x: &Run<'_>, guard: &Guard, written: &[[u32; 4]], done: &wgpu::Texture) {
        if written.is_empty() {
            return;
        }
        let d = &x.device.device;
        let view = done.create_view(&Default::default());
        let encoded = self.take(x.device, x.size, ACC);
        let encoded_view = encoded.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.resolve_as(d, &mut encoder, &view, &encoded_view, ACC, x.space, true);
        x.device.queue.submit([encoder.finish()]);
        let moved = self.take(x.device, x.size, ACC);
        let moved_view = moved.create_view(&Default::default());
        self.stage
            .get_or_insert_with(|| Stage::new(x.device))
            .guard_into(x.device, guard, &encoded_view, &moved_view);
        for rect in written {
            let mix = Mix {
                mode: REPLACE,
                decode: x.space == Space::Linear,
                straight: true,
                rect: *rect,
                ..Mix::over(&moved_view, x.size)
            };
            self.composite(x.device, done, mix, x.size);
        }
    }

    /// `--planted`: a group's passes run on the finished layer, over its bounds + grow.
    fn late(
        &mut self,
        x: &mut Run<'_>,
        run: &[Drawn],
        k: usize,
        into: &wgpu::Texture,
    ) -> Result<(), Value> {
        let Scope::Opacity {
            item,
            effect: Some(e),
            ..
        } = &run[0].scopes[k]
        else {
            return Ok(());
        };
        let inside: Vec<Drawn> = run.iter().map(|d| without(d, k)).collect();
        let bounds = union(&inside);
        let view = into.create_view(&Default::default());
        let (passed, grow) = self.passes(x, item, e, bounds, &view)?;
        let mix = Mix {
            mode: REPLACE,
            rect: px(bounds, grow, x.size),
            ..Mix::over(&passed, x.size)
        };
        self.composite(x.device, into, mix, x.size);
        Ok(())
    }

    /// The composed layer into `view`, premultiplied and sRGB-encoded.
    pub fn finish(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        done: &wgpu::Texture,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        linear: bool,
    ) {
        let layer = done.create_view(&Default::default());
        let space = if linear {
            Space::Linear
        } else {
            Space::Encoded
        };
        self.resolve(device, encoder, &layer, view, format, space);
    }

    /// `layer` drawn and read back.
    pub fn picture(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
    ) -> Result<Picture, Value> {
        let d = &device.device;
        let (done, inputs) = self.compose(device, vello, layer)?;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let out = target(d, layer.size, format);
        let view = out.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.finish(d, &mut encoder, &done, &view, format, layer.base.is_some());
        let image =
            deep_marks_render::gpu::read_back(d, &device.queue, encoder, &out, layer.size, format)?;
        let floats = layer
            .keep
            .then(|| f32_bytes(&read_texture(device, &done, 0).1));
        Ok(Picture {
            image,
            floats,
            inputs,
        })
    }
}
