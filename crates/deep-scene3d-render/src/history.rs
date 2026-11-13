//! Frame history on the GPU (#173; canvas primitives: Look `look@1`: frame history): the live
//! view's window of its own frames, one array layer each for color and depth at the render size,
//! and the resolve that rebuilds the frame at t from them at display size. What each window frame
//! was drawn from (its jittered camera and its parts' poses) is held beside its layer, so the
//! resolve carries a pixel into it through poses the core evaluated, never through vectors kept
//! from an earlier frame. Nothing here reaches a canonical render: only a live view makes one.

use deep_canvas_scene3d::history::{self as rules, Appearance, History, Reactive};
use deep_canvas_scene3d::scene::{Depth, Scene};
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;

use crate::{bind_group, buffer_entry, pipeline, target, Renderer};

/// The resolve's pass, live only.
pub const RESOLVE_PASS: &str = "look.history";

const SHADER: &str = include_str!("history.wgsl");
/// The most frames a resolve reads: a window of 16 and a planted twin's one past it.
const MOST: usize = 17;
const COLOR: wgpu::TextureFormat = FORMAT;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct EntryUniform {
    clip: [[f32; 4]; 4],
    back: [[f32; 4]; 4],
    info: [f32; 4],
    jitter: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniform {
    inverse: [[f32; 4]; 4],
    sizes: [f32; 4],
    flags: [f32; 4],
    entries: [EntryUniform; MOST],
}

/// The resolve's pipeline, compiled once a device.
pub struct Kit {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    /// Gathers a window frame's 2 × 2 texels, clamped at its edge.
    taps: wgpu::Sampler,
}

impl Kit {
    pub fn new(device: &Device) -> Kit {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(RESOLVE_PASS),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let frag = wgpu::ShaderStages::FRAGMENT;
        let texture = |binding, sample_type, view_dimension| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: frag,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension,
                multisampled: false,
            },
            count: None,
        };
        let storage = wgpu::BufferBindingType::Storage { read_only: true };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(RESOLVE_PASS),
            entries: &[
                buffer_entry(0, frag, wgpu::BufferBindingType::Uniform),
                texture(
                    1,
                    wgpu::TextureSampleType::Float { filterable: false },
                    wgpu::TextureViewDimension::D2Array,
                ),
                texture(
                    2,
                    wgpu::TextureSampleType::Depth,
                    wgpu::TextureViewDimension::D2Array,
                ),
                texture(
                    3,
                    wgpu::TextureSampleType::Uint,
                    wgpu::TextureViewDimension::D2Array,
                ),
                buffer_entry(4, frag, storage),
                buffer_entry(5, frag, storage),
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: frag,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
                    count: None,
                },
            ],
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(RESOLVE_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = pipeline(
            d,
            RESOLVE_PASS,
            Some(&pl),
            &module,
            ("resolve_vs", &[]),
            Some(("resolve_fs", &[target(FORMAT, None)])),
            Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
        );
        let taps = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some(RESOLVE_PASS),
            ..Default::default()
        });
        Kit {
            layout,
            pipeline,
            taps,
        }
    }
}

/// What a window frame was drawn from.
#[derive(Clone, Debug, Default)]
struct Held {
    /// World to clip at its own time, rows, jittered as it rendered.
    clip: [[f64; 4]; 4],
    near: f64,
    perspective: bool,
    /// Its jitter in render px.
    jitter: [f64; 2],
    /// Each solid's pick, model and appearance, by pick.
    solids: Vec<(u32, rules::Affine, Appearance)>,
}

/// The window: its layers at the render size and what each frame in them was drawn from.
pub struct Window {
    pub size: [u32; 2],
    pub layers: u32,
    /// Each layer's color as a render target.
    targets: Vec<wgpu::TextureView>,
    depth: wgpu::Texture,
    /// Each layer's pick IDs, so each of its samples is carried through its own part's poses.
    ids: wgpu::Texture,
    color_array: wgpu::TextureView,
    depth_array: wgpu::TextureView,
    ids_array: wgpu::TextureView,
    uniform: wgpu::Buffer,
    picks: wgpu::Buffer,
    carried: wgpu::Buffer,
    bind: Option<wgpu::BindGroup>,
    /// The display's depth the resolve writes, at its size, and the line passes' bind group over
    /// it: what line marks drawn after the resolve are tested against.
    lines: Option<([u32; 2], wgpu::TextureView, wgpu::BindGroup)>,
    held: Vec<Held>,
    /// Reused each frame: each pick's slot and flag, and each moving part's carries.
    pick_words: Vec<u32>,
    carried_words: Vec<[[f32; 4]; 4]>,
    /// What the layers hold on the device, as it reports them.
    pub bytes: Option<u64>,
}

fn texture(
    d: &deep_gpu::counted::Wgpu,
    size: [u32; 2],
    layers: u32,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    d.create_texture(&wgpu::TextureDescriptor {
        label: Some(RESOLVE_PASS),
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
        // The output pass writes encoded bytes; the resolve reads them decoded, in linear light.
        view_formats: &[format.add_srgb_suffix()],
    })
}

fn storage(d: &deep_gpu::counted::Wgpu, size: u64) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some(RESOLVE_PASS),
        size: size.max(64),
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl Window {
    /// A window of `layers` frames at the render `size`.
    pub fn new(device: &Device, size: [u32; 2], layers: u32) -> Window {
        let d = &device.device;
        let ((color, depth, ids, uniform, picks, carried), bytes) =
            deep_gpu::alloc::outside(|| {
                deep_gpu::memory::across(device, || {
                    let usage = wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING;
                    let copied =
                        wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST;
                    (
                        texture(d, size, layers, COLOR, usage),
                        texture(
                            d,
                            size,
                            layers,
                            DEPTH,
                            usage | wgpu::TextureUsages::COPY_DST,
                        ),
                        texture(d, size, layers, crate::IDS, copied),
                        d.create_buffer(&wgpu::BufferDescriptor {
                            label: Some(RESOLVE_PASS),
                            size: std::mem::size_of::<Uniform>() as u64,
                            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                            mapped_at_creation: false,
                        }),
                        storage(d, 4096),
                        storage(d, 64 * 64),
                    )
                })
            });
        let targets = (0..layers)
            .map(|l| {
                color.create_view(&wgpu::TextureViewDescriptor {
                    format: Some(COLOR),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: l,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let array = |t: &wgpu::Texture, format| {
            t.create_view(&wgpu::TextureViewDescriptor {
                format,
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            })
        };
        Window {
            size,
            layers,
            targets,
            color_array: array(&color, Some(COLOR.add_srgb_suffix())),
            depth_array: array(&depth, None),
            ids_array: array(&ids, None),
            depth,
            ids,
            uniform,
            picks,
            carried,
            bind: None,
            lines: None,
            held: vec![Held::default(); layers as usize],
            pick_words: Vec::new(),
            carried_words: Vec::new(),
            bytes,
        }
    }

    /// The bytes its layers hold by their formats: color, depth and pick IDs, 4 B each a pixel.
    pub fn estimate(&self) -> u64 {
        u64::from(self.size[0]) * u64::from(self.size[1]) * 12 * u64::from(self.layers)
    }

    /// Where the output pass writes layer `layer`'s frame.
    pub fn target(&self, layer: u32) -> &wgpu::TextureView {
        &self.targets[layer as usize]
    }

    /// Keeps the frame the renderer just drew in `layer`: the output pass wrote its color there
    /// already; its depth and pick IDs are copied in, and what it was drawn from held beside it.
    pub fn store(
        &mut self,
        renderer: &Renderer,
        scene: &Scene,
        jitter: [f64; 2],
        layer: u32,
        encoder: &mut wgpu::CommandEncoder,
    ) {
        if let Some(copy) = self.hold(renderer, scene, jitter, layer) {
            copy.record(encoder);
        }
    }

    /// What `store` does on the CPU, with the copies to record where the frame's passes are.
    pub fn hold(
        &mut self,
        renderer: &Renderer,
        scene: &Scene,
        jitter: [f64; 2],
        layer: u32,
    ) -> Option<LayerCopy> {
        let t = renderer.targets.as_ref()?;
        let copy = LayerCopy {
            pairs: [
                (t.depth_view.texture().clone(), self.depth.clone()),
                (t.ids_view.texture().clone(), self.ids.clone()),
            ],
            layer,
            size: t.size,
        };
        let (clip, _, near) = renderer.camera;
        let h = &mut self.held[layer as usize];
        h.clip = std::array::from_fn(|r| std::array::from_fn(|c| clip[c * 4 + r]));
        h.near = near;
        h.perspective = scene.camera.perspective;
        h.jitter = jitter;
        h.solids.clear();
        let picks = renderer.picks();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            if let Some(&p) = picks.get(&s.id) {
                h.solids.push((p, s.model, Appearance::of(s)));
            }
        }
        h.solids.sort_by_key(|s| s.0);
        Some(copy)
    }

    /// The resolve of `entries` (oldest first; the last is the frame at t, whose scene is `now`)
    /// at `display` size, its uniforms written, ready to record.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        device: &Device,
        kit: &Kit,
        renderer: &Renderer,
        history: &History,
        now: &Scene,
        entries: &[rules::Entry],
        display: [u32; 2],
    ) -> Option<Resolve> {
        let t = renderer.targets.as_ref()?;
        let entries = &entries[entries.len().saturating_sub(MOST)..];
        let n = entries.len();
        let last = entries.last()?;
        let current = &self.held[last.layer as usize];
        // Each pick's flag and slot: reactive parts take the frame at t alone, and parts whose pose
        // differs inside the window are carried through theirs.
        let max_pick = renderer.picks().values().copied().max().unwrap_or(0) as usize;
        self.pick_words.clear();
        self.pick_words.resize(max_pick + 1, 0);
        self.carried_words.clear();
        let listed = |id: &str| match &history.reject.reactive {
            Reactive::Ids(ids) => ids
                .iter()
                .any(|i| i.as_str() == id || crate::created::item_of(id) == i.as_str()),
            Reactive::Auto => false,
        };
        let auto = history.reject.reactive == Reactive::Auto;
        // The camera at t, unjittered, takes a pixel back to the world, and a window frame's texel
        // back to where its surface is at t.
        let unjittered = now.camera.clip(Depth::Reversed);
        let mut slots = 0u32;
        for s in now.layers.iter().flat_map(|l| &l.solids) {
            let Some(&p) = renderer.picks().get(&s.id) else {
                continue;
            };
            let Ok(at) = current.solids.binary_search_by_key(&p, |x| x.0) else {
                continue;
            };
            let (_, model, look) = &current.solids[at];
            let mut reactive = listed(&s.id) || (auto && rules::own_frame_only(s));
            let mut moved = false;
            for e in &entries[..n - 1] {
                let then = &self.held[e.layer as usize];
                match then.solids.binary_search_by_key(&p, |x| x.0) {
                    Ok(j) => {
                        let (_, m, l) = &then.solids[j];
                        moved |= m != model;
                        reactive |= auto && l != look;
                    }
                    // A part the frame didn't draw: the frame at t alone counts for it.
                    Err(_) => reactive |= auto,
                }
            }
            let mut word = u32::from(reactive);
            if moved && !reactive {
                slots += 1;
                word |= slots << 1;
                for e in entries {
                    let then = &self.held[e.layer as usize];
                    // Forth, a point of the part at t to the frame's clip; back, a texel of the
                    // frame to the clip at t, unjittered, through the part's move.
                    let (forth, back) = match then.solids.binary_search_by_key(&p, |x| x.0) {
                        Ok(j) => {
                            let to_then = rules::carry(model, &then.solids[j].1);
                            let to_now = rules::carry(&then.solids[j].1, model);
                            match (to_then, to_now) {
                                (Some(f), Some(b)) => (
                                    product(&then.clip, &f),
                                    times(
                                        &product(&unjittered, &b),
                                        &crate::op::invert(&then.clip),
                                    ),
                                ),
                                _ => (
                                    then.clip,
                                    times(&unjittered, &crate::op::invert(&then.clip)),
                                ),
                            }
                        }
                        Err(_) => (
                            then.clip,
                            times(&unjittered, &crate::op::invert(&then.clip)),
                        ),
                    };
                    self.carried_words.push(columns(&forth));
                    self.carried_words.push(columns(&back));
                }
            }
            self.pick_words[p as usize] = word;
        }
        let d = &device.device;
        let need = |words: u64| words.max(16);
        let picks_bytes = need(self.pick_words.len() as u64 * 4);
        let carried_bytes = need(self.carried_words.len() as u64 * 64);
        if picks_bytes > self.picks.size() {
            self.picks = storage(d, picks_bytes.next_power_of_two());
            self.bind = None;
        }
        if carried_bytes > self.carried.size() {
            self.carried = storage(d, carried_bytes.next_power_of_two());
            self.bind = None;
        }
        let inverse = crate::op::invert(&unjittered);
        let mut u = Uniform {
            inverse: columns(&inverse),
            sizes: [
                t.size[0] as f32,
                t.size[1] as f32,
                display[0] as f32,
                display[1] as f32,
            ],
            flags: [
                n as f32,
                if history.reject.depth { 1.0 } else { 0.0 },
                if history.reject.clamp { 1.0 } else { 0.0 },
                // The reconstruction's width in display px where the window rebuilds the display
                // from a lower scale: narrow, so 1 px detail keeps its contrast.
                2.0,
            ],
            entries: [bytemuck::Zeroable::zeroed(); MOST],
        };
        for (i, e) in entries.iter().enumerate() {
            let h = &self.held[e.layer as usize];
            u.entries[i] = EntryUniform {
                clip: columns(&h.clip),
                back: columns(&times(&unjittered, &crate::op::invert(&h.clip))),
                info: [
                    e.layer as f32,
                    h.near as f32,
                    if h.perspective { 1.0 } else { 0.0 },
                    0.0,
                ],
                jitter: [h.jitter[0] as f32, h.jitter[1] as f32, 0.0, 0.0],
            };
        }
        deep_gpu::alloc::outside(|| {
            let q = &device.queue;
            q.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&u));
            q.write_buffer(&self.picks, 0, bytemuck::cast_slice(&self.pick_words));
            if !self.carried_words.is_empty() {
                q.write_buffer(&self.carried, 0, bytemuck::cast_slice(&self.carried_words));
            }
        });
        if self.bind.is_none() {
            self.bind = Some(bind_group(
                d,
                RESOLVE_PASS,
                &kit.layout,
                [
                    self.uniform.as_entire_binding(),
                    wgpu::BindingResource::TextureView(&self.color_array),
                    wgpu::BindingResource::TextureView(&self.depth_array),
                    wgpu::BindingResource::TextureView(&self.ids_array),
                    self.picks.as_entire_binding(),
                    self.carried.as_entire_binding(),
                    wgpu::BindingResource::Sampler(&kit.taps),
                ],
            ));
        }
        if self.lines.as_ref().is_none_or(|l| l.0 != display) {
            let texture = texture(
                d,
                display,
                1,
                DEPTH,
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            );
            let view = texture.create_view(&wgpu::TextureViewDescriptor {
                format: Some(DEPTH),
                dimension: Some(wgpu::TextureViewDimension::D2),
                ..Default::default()
            });
            let o = &renderer.outlines;
            let bind = bind_group(
                d,
                crate::surface::OUTLINE_PASS,
                &o.layout,
                [
                    o.display.as_entire_binding(),
                    wgpu::BindingResource::TextureView(&view),
                ],
            );
            self.lines = Some((display, view, bind));
        }
        let lines = self.lines.as_ref().expect("made above");
        Some(Resolve {
            pipeline: kit.pipeline.clone(),
            bind: self.bind.clone().expect("made above"),
            depth: lines.1.clone(),
            lines: lines.2.clone(),
        })
    }
}

/// What a frame of the window does beyond an ordinary frame, as a view's driver asks it: the
/// layer it draws into, the window's layers, its jitter in render px, and, for the frame at t,
/// the look's history and the window's frames to resolve (oldest first, the frame at t last).
#[derive(Clone, Debug)]
pub struct Frame {
    pub layer: u32,
    pub layers: u32,
    pub jitter: [f64; 2],
    pub resolve: Option<(History, Vec<rules::Entry>)>,
}

/// A view's frame history on its renderer: the resolve's pipeline, the window, what the next
/// frame does with it, and the work that frame stages for its passes.
#[derive(Default)]
pub struct State {
    kit: Option<Kit>,
    pub window: Option<Window>,
    pub frame: Option<Frame>,
    pub(crate) jobs: Option<Jobs>,
}

/// A window frame's work in the frame's passes: the layer its output writes, its depth's and IDs'
/// copies, and the resolve into the slot when it is the frame at t.
pub(crate) struct Jobs {
    pub layer: wgpu::TextureView,
    pub copy: LayerCopy,
    pub resolve: Option<Resolve>,
}

impl Renderer {
    /// After `prepare`, the work a frame of the window stages: its layer, what it drew `scene`
    /// from held beside it, and, for the frame at t, the resolve's uniforms written.
    pub(crate) fn stage_window(&mut self, device: &Device, scene: &Scene) {
        let Some(f) = self.frame_history.frame.take() else {
            return;
        };
        let Some(size) = self.targets.as_ref().map(|t| t.size) else {
            return;
        };
        if self.frame_history.kit.is_none() {
            self.frame_history.kit = Some(Kit::new(device));
        }
        let mut window = match self.frame_history.window.take() {
            Some(w) if w.size == size && w.layers == f.layers => w,
            _ => Window::new(device, size, f.layers),
        };
        let layer = window.target(f.layer).clone();
        let copy = window.hold(self, scene, f.jitter, f.layer);
        let resolve = f.resolve.as_ref().and_then(|(history, entries)| {
            let kit = self.frame_history.kit.as_ref()?;
            window.prepare(device, kit, self, history, scene, entries, scene.size)
        });
        self.frame_history.window = Some(window);
        self.frame_history.jobs = copy.map(|copy| Jobs {
            layer,
            copy,
            resolve,
        });
    }
}

/// A window frame's depth and pick IDs, each copied from its target into the frame's layer.
pub struct LayerCopy {
    pairs: [(wgpu::Texture, wgpu::Texture); 2],
    layer: u32,
    size: [u32; 2],
}

impl LayerCopy {
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        deep_gpu::alloc::outside(|| {
            for (from, into) in &self.pairs {
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: from,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: into,
                        mip_level: 0,
                        origin: wgpu::Origin3d {
                            x: 0,
                            y: 0,
                            z: self.layer,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    crate::extent(self.size),
                );
            }
        });
    }
}

/// The resolve, ready to record into the display-size frame and its depth, and the bind group
/// line marks drawn after it test that depth through.
#[derive(Clone)]
pub struct Resolve {
    pipeline: wgpu::RenderPipeline,
    bind: wgpu::BindGroup,
    depth: wgpu::TextureView,
    lines: wgpu::BindGroup,
}

impl Resolve {
    /// `draw` (the outlines' or the labels') tested against the display's depth this resolve
    /// writes, in place of the core's at the render size.
    pub fn lines(&self, draw: crate::OutlineDraw) -> crate::OutlineDraw {
        crate::OutlineDraw {
            frame: self.lines.clone(),
            ..draw
        }
    }

    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        out: &wgpu::TextureView,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        deep_gpu::alloc::outside(|| {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(RESOLVE_PASS),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: out,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: timestamps,
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.draw(0..3, 0..1);
        });
    }
}

/// Rows `a · b` for a 4×4 and an affine.
fn product(a: &[[f64; 4]; 4], b: &rules::Affine) -> [[f64; 4]; 4] {
    std::array::from_fn(|r| {
        std::array::from_fn(|c| {
            let t = if c == 3 { a[r][3] } else { 0.0 };
            a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c] + t
        })
    })
}

/// Rows `a · b` for two 4×4s.
fn times(a: &[[f64; 4]; 4], b: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    std::array::from_fn(|r| std::array::from_fn(|c| (0..4).map(|k| a[r][k] * b[k][c]).sum()))
}

/// A rows matrix as WGSL's columns.
fn columns(m: &[[f64; 4]; 4]) -> [[f32; 4]; 4] {
    std::array::from_fn(|c| std::array::from_fn(|r| m[r][c] as f32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clip_times_a_carry_is_the_clip_of_the_carried_point() {
        let clip = [
            [1.0, 0.0, 0.5, 2.0],
            [0.0, 2.0, 0.0, -1.0],
            [0.0, 0.0, 0.0, 0.1],
            [0.0, 0.0, 1.0, 0.0],
        ];
        let carry: rules::Affine = [
            [0.0, -1.0, 0.0, 3.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, -2.0],
        ];
        let p = [0.3, -0.7, 4.0];
        let carried: [f64; 3] = std::array::from_fn(|r| {
            carry[r][0] * p[0] + carry[r][1] * p[1] + carry[r][2] * p[2] + carry[r][3]
        });
        let apply = |m: &[[f64; 4]; 4], v: [f64; 3]| -> [f64; 4] {
            std::array::from_fn(|r| m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + m[r][3])
        };
        let a = apply(&product(&clip, &carry), p);
        let b = apply(&clip, carried);
        for i in 0..4 {
            assert!((a[i] - b[i]).abs() < 1e-12, "{a:?} {b:?}");
        }
    }
}
