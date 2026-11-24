//! Cached local shadow maps and the IES atlas (#446; canvas primitives: Light policy: local
//! shadows, Light: IES distribution): a spot's map, a point light's six faces and an area light's
//! five, each keyed by everything it reads, so a still interior draws no shadow pass and a cached
//! map always equals a clean render.

use std::collections::{BTreeMap, BTreeSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use deep_canvas_scene3d::ies::{Distribution, HEIGHT, MOST, WIDTH};
use deep_canvas_scene3d::light::{Light, SHADED};
use deep_canvas_scene3d::scene::{Scene, Solid, SolidOp};
use deep_canvas_scene3d::tiles::{self, ATLAS};
use deep_gpu::device::Device;

use crate::shadow::{self, LocalMap, FORMAT};

pub use deep_canvas_scene3d::module::LOCAL_SHADOW_PASS as PASS;
/// The most shadowed local lights a frame holds under the fixed rule: four cubes and eight spots.
pub const SLOTS: usize = 12;
/// The most a frame's lights uniform holds: every shaded key light, under tiles (#2034).
pub const MAPS: usize = SHADED;
/// The side a tile's filter is sized by, in world units as a map this many texels across sizes it
/// (`local_map`'s default), whatever the tile's own side (#2034).
pub const FILTER_SIDE: u32 = 512;
/// A tile's depth cleared to 1 before its faces draw (#2034): a triangle over the viewport.
const CLEAR: &str =
    "@vertex fn clear(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 1.0, 1.0);
}";

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A map's key is its light's alone, so what enters its range keeps the map.
    pub stale: bool,
    /// A caster's t isn't in a map's key.
    pub ignores_t: bool,
    /// Any operator that reads t joins a map's key, even for color alone.
    pub any_t: bool,
    /// A cut's planes aren't in a map's key.
    pub ignores_cut: bool,
    /// A distribution's table scaled to its peak, not to its integral.
    pub ies_peak: bool,
    /// A cascade's projection follows the camera with no texel snapping.
    pub unsnapped: bool,
    /// A cascade's box isn't grown by the penumbra's reach.
    pub no_reach: bool,
    /// The soft filter's disk rotation also hashes the frame number.
    pub noise_from_frame: bool,
    /// The filter disk is sized in the cascade's own texels.
    pub filter_in_texels: bool,
    /// #2034: slots fill in the order the scene holds its lights.
    pub tile_arrival_order: bool,
    /// #2034: every shaded light keeps the fixed rule's 2 spots, past them dropped, tiles or not.
    pub tile_keeps_fixed_caps: bool,
    /// #2034: a light keeps the tile size it last had until its diameter passes the threshold.
    pub tile_hysteresis: bool,
    /// #2034: a tile's filter is sized in its own texels.
    pub tile_filter_in_texels: bool,
    /// #2034: a tile's key leaves out its size and place.
    pub tile_key_without_size: bool,
}

/// One shadowed local light this frame.
pub struct Map {
    /// Its index in the scene's lights.
    pub light: usize,
    pub map: LocalMap,
    /// The first of its layers, or under tiles its first slot.
    pub first: u32,
    /// Under tiles, each tile's side (0 for a map in layers).
    pub size: u32,
    /// The first of its faces' light frames.
    pub frame: u32,
    /// The share of its shadow the policy keeps.
    pub share: f64,
    pub casters: BTreeSet<String>,
    pub key: u64,
}

/// One local map as a frame reports it.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub light: String,
    pub key: u64,
    pub faces: u32,
    pub drawn: bool,
    pub casters: Vec<String>,
    /// Under tiles (#2034), each tile's side and the slots it holds, one a face; none in layers.
    pub size: u32,
    pub slots: Vec<u32>,
}

/// What one shadow map draws: a mesh, a run of instances, and for a material operator that cuts
/// its coverage its depth pipeline and group.
pub struct Draw {
    pub vertices: wgpu::Buffer,
    pub indices: wgpu::Buffer,
    pub count: u32,
    pub instances: wgpu::Buffer,
    pub range: std::ops::Range<u32>,
    pub cuts: Option<(wgpu::RenderPipeline, wgpu::BindGroup)>,
    /// A mask-alpha caster, drawn through the mask caster's pipeline (#432).
    pub mask: bool,
}

#[derive(Default)]
pub struct Locals {
    /// The layers' array view and one view per layer.
    pub texture: Option<(wgpu::TextureView, Vec<wgpu::TextureView>)>,
    /// Each layer's side in texels, and how many layers the texture holds.
    pub size: u32,
    pub layers: u32,
    /// Each layer's light frame, which the shadow pipeline's vertex stage reads.
    pub frames: Vec<(wgpu::Buffer, wgpu::BindGroup)>,
    /// What each slot's layers were made from.
    keys: [Option<u64>; SLOTS],
    /// Under tiles, what each tile at a texel of the atlas was made from (#2034).
    tiled: Option<BTreeMap<[u32; 2], u64>>,
    /// Each light's tile size last frame, which only the planted hysteresis reads.
    last: BTreeMap<String, u32>,
    /// The tile clear's pipeline, made at the first tiled frame.
    clear: Option<wgpu::RenderPipeline>,
    /// How many light frames this frame's tiles hold.
    frames_wanted: usize,
    pub list: Vec<Map>,
    pub stale: Vec<usize>,
    labels: Vec<String>,
}

/// The radius a light's shadow is sized by: an area's half diagonal stands for its size.
pub fn radius(l: &Light) -> f64 {
    l.area.map_or(l.radius, |a| {
        let n = |v: [f64; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        n(a.right).max(n(a.up))
    })
}

/// What a caster adds to a map's key: its content, its place and its material's feature key, plus
/// t while its material moves its coverage (Light policy: local shadows).
pub fn hash_caster(s: &Solid, h: &mut impl Hasher) {
    s.id.hash(h);
    crate::shape_code(s.shape).hash(h);
    for v in s.model.iter().flatten() {
        v.to_bits().hash(h);
    }
    s.mask.map(|m| (m.level, m.lower)).hash(h);
    if let Some(m) = &s.material {
        (m.alpha_mode as u8, m.lobes.transmission > 0.0, m.casts).hash(h);
    }
    if let Some(o) = &s.op {
        crate::op::key(o).hash(h);
    }
}

/// `t` when `s` is a caster whose coverage reads it, or one that sways.
pub fn hash_time(s: &Solid, planted: Planted, h: &mut impl Hasher) {
    let moves = |o: &&SolidOp| !planted.ignores_t && crate::op::coverage_moves(o, planted.any_t);
    if let Some(o) = s.op.as_ref().filter(moves) {
        o.t.to_bits().hash(h);
    }
    // A swaying caster's shape moves with t on the GPU (#2016).
    if let Some(w) = s.sway {
        w.t.to_bits().hash(h);
    }
}

/// The cut's planes, when they reach the shadow maps.
pub fn hash_cut(scene: &Scene, h: &mut impl Hasher) {
    if let Some(cut) = scene.cutaway.as_ref().filter(|c| !c.shadows_whole) {
        for (n, o) in &cut.planes {
            for v in n.iter().chain([o]) {
                v.to_bits().hash(h);
            }
        }
        cut.intersect.hash(h);
    }
}

/// What a light's map reads, into its key: the light's place, range, cone and frame, and each
/// caster meeting its range; the casters it holds.
fn hash_reads(
    scene: &Scene,
    l: &Light,
    casters: &[shadow::Caster],
    planted: Planted,
    h: &mut impl Hasher,
) -> BTreeSet<String> {
    for v in l.pos.iter().chain(&l.dir).chain(&[l.range, l.cone[0]]) {
        v.to_bits().hash(h);
    }
    for v in l.axes.iter().flatten() {
        v.to_bits().hash(h);
    }
    l.caster_bit.hash(h);
    let mut held = BTreeSet::new();
    for (s, corners) in shadow::casters(scene, casters) {
        if !shadow::meets(corners, l.pos, l.range)
            || (l.caster_bit != 0 && s.caster_sets & l.caster_bit == 0)
        {
            continue;
        }
        if !planted.stale {
            hash_caster(s, h);
            hash_time(s, planted, h);
        }
        held.insert(s.id.clone());
    }
    if !planted.ignores_cut && !planted.stale {
        hash_cut(scene, h);
    }
    held
}

/// The runs of `owners` that `only` holds; all of them with no filter.
pub fn runs(owners: &[String], only: Option<&BTreeSet<String>>) -> Vec<std::ops::Range<u32>> {
    let Some(only) = only else {
        let all = (!owners.is_empty()).then_some(0..owners.len() as u32);
        return all.into_iter().collect();
    };
    let mut out: Vec<std::ops::Range<u32>> = Vec::new();
    for (i, o) in owners.iter().enumerate() {
        let i = i as u32;
        if only.contains(o) {
            match out.last_mut() {
                Some(r) if r.end == i => r.end = i + 1,
                _ => out.push(i..i + 1),
            }
        }
    }
    out
}

/// What [`Locals::ensure`] makes for `scene`'s first frame (#2189): a layer of the scene's map
/// side for each face of the shadows its light policy keeps, six for a cube and one for a spot.
pub fn bytes(scene: &Scene) -> u64 {
    use deep_canvas_scene3d::light::{self, LightKind};
    let policy = scene
        .light_cut
        .clone()
        .unwrap_or_else(|| light::policy(&scene.lights, &scene.camera));
    let scores = light::scores(&scene.lights, &scene.camera);
    let kept = light::shadowed(&scene.lights, &policy, &scene.shadowing, &scores).kept;
    let texel = u64::from(FORMAT.block_copy_size(None).unwrap_or(4));
    let local = |&&(i, _): &&(usize, f64)| scene.lights[i].kind != LightKind::Sun;
    // Shadow tiles hold one atlas, whatever they hold (#2034).
    if scene.shadowing.tiles {
        let any = kept.iter().any(|k| local(&k));
        return if any {
            u64::from(ATLAS).pow(2) * texel
        } else {
            0
        };
    }
    let layers: u64 = kept
        .iter()
        .filter(|&&(i, _)| scene.lights[i].kind != LightKind::Sun)
        .take(SLOTS)
        .map(|&(i, _)| {
            if shadow::local_map(&scene.lights[i]).cube {
                6
            } else {
                1
            }
        })
        .sum();
    u64::from(scene.shadowing.local_map).pow(2) * layers * texel
}

impl Locals {
    /// This frame's maps from the policy's `kept` local lights, with each one's key; true when the
    /// texture must be made again for them. `tiled`: they're shadow tiles (#2034).
    pub fn prepare(
        &mut self,
        scene: &Scene,
        kept: &[(usize, f64)],
        casters: &[shadow::Caster],
        planted: Planted,
        tiled: bool,
    ) -> bool {
        self.list.clear();
        self.stale.clear();
        if kept.is_empty() {
            return false;
        }
        if tiled {
            return self.prepare_tiles(scene, kept, casters, planted);
        }
        if self.tiled.take().is_some() {
            self.keys = [None; SLOTS];
        }
        let side = scene.shadowing.local_map;
        let mut first = 0;
        for &(i, share) in kept.iter().take(SLOTS) {
            let l = &scene.lights[i];
            let map = shadow::local_map(l);
            let mut h = std::collections::hash_map::DefaultHasher::new();
            l.id.hash(&mut h);
            (l.kind as u8, side, first).hash(&mut h);
            let held = hash_reads(scene, l, casters, planted, &mut h);
            let count = if map.cube { 6 } else { 1 };
            self.list.push(Map {
                light: i,
                map,
                first,
                size: 0,
                frame: first,
                share,
                casters: held,
                key: h.finish(),
            });
            first += count;
        }
        let fresh = first > self.layers || side != self.size;
        if fresh {
            self.keys = [None; SLOTS];
        }
        for (slot, m) in self.list.iter().enumerate() {
            let hit = scene.shadowing.cache && self.keys[slot] == Some(m.key);
            if !hit {
                self.keys[slot] = Some(m.key);
                self.stale.push(slot);
            }
        }
        self.labels = self
            .list
            .iter()
            .map(|m| scene.lights[m.light].id.clone())
            .collect();
        if fresh {
            self.size = side;
            self.layers = first.max(self.layers);
        }
        fresh
    }

    /// [`Locals::prepare`] under shadow tiles (#2034): the tile table at the view, each light's
    /// tiles keyed by their size and place as well as what they read, and a tile drawn when the
    /// key at its place changed since last frame.
    fn prepare_tiles(
        &mut self,
        scene: &Scene,
        kept: &[(usize, f64)],
        casters: &[shadow::Caster],
        planted: Planted,
    ) -> bool {
        let lights = &scene.lights;
        let index: Vec<usize> = kept.iter().map(|&(i, _)| i).collect();
        let mut sizes: Vec<u32> = (index.iter())
            .map(|&i| tiles::asked(&lights[i], &scene.camera))
            .collect();
        if planted.tile_hysteresis {
            // The last size holds until the diameter passes the threshold between it and the
            // asked size by more than half a percent (the suite's walk swings 0.8% either side).
            for (s, &i) in sizes.iter_mut().zip(&index) {
                let Some(&last) = self.last.get(&lights[i].id) else {
                    continue;
                };
                let px = tiles::diameter(&lights[i], &scene.camera).unwrap_or(f64::INFINITY);
                let past = match *s < last {
                    true => px < f64::from(*s) * 0.995,
                    false => px > f64::from(last) * 1.005,
                };
                if !past {
                    *s = last;
                }
            }
        }
        let rule = tiles::Planted {
            arrival_order: planted.tile_arrival_order,
        };
        let table = tiles::fit(lights, &index, sizes, rule);
        self.last = (table.iter())
            .map(|t| (lights[t.light].id.clone(), t.size))
            .collect();
        let mut frame = 0;
        for t in &table {
            let l = &lights[t.light];
            let mut h = std::collections::hash_map::DefaultHasher::new();
            l.id.hash(&mut h);
            (l.kind as u8).hash(&mut h);
            if !planted.tile_key_without_size {
                (t.size, tiles::origin(t.size, t.first)).hash(&mut h);
            }
            let held = hash_reads(scene, l, casters, planted, &mut h);
            let share = kept.iter().find(|k| k.0 == t.light).map_or(1.0, |k| k.1);
            self.list.push(Map {
                light: t.light,
                map: shadow::local_map(l),
                first: t.first,
                size: t.size,
                frame,
                share,
                casters: held,
                key: h.finish(),
            });
            frame += t.count;
        }
        self.frames_wanted = frame as usize;
        let fresh = self.tiled.is_none() || self.size != ATLAS || self.layers == 0;
        let before = self.tiled.take().unwrap_or_default();
        let mut now = BTreeMap::new();
        for (slot, m) in self.list.iter().enumerate() {
            let at = tiles::origin(m.size, m.first);
            let hit = !fresh && scene.shadowing.cache && before.get(&at) == Some(&m.key);
            if !hit {
                self.stale.push(slot);
            }
            now.insert(at, m.key);
        }
        self.tiled = Some(now);
        self.labels = (self.list.iter())
            .map(|m| lights[m.light].id.clone())
            .collect();
        if fresh {
            self.size = ATLAS;
            self.layers = 1;
        }
        fresh
    }

    /// Where face `offset` of `m` draws: its layer's view, and under tiles its tile's place and
    /// side in the atlas.
    pub fn target(&self, m: &Map, offset: u32) -> Option<(wgpu::TextureView, Option<[u32; 3]>)> {
        let (_, views) = self.texture.as_ref()?;
        if m.size == 0 {
            return Some((views.get((m.first + offset) as usize)?.clone(), None));
        }
        let [x, y] = tiles::origin(m.size, m.first + offset);
        Some((views.first()?.clone(), Some([x, y, m.size])))
    }

    /// The tile clear's pipeline, when a tiled frame made it.
    pub fn clearing(&self) -> Option<wgpu::RenderPipeline> {
        self.clear.clone()
    }

    /// Makes the tile clear's pipeline (#2034), once.
    pub fn clear(&mut self, d: &deep_gpu::counted::Wgpu) {
        self.clear.get_or_insert_with(|| {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(PASS),
                source: wgpu::ShaderSource::Wgsl(CLEAR.into()),
            });
            let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(PASS),
                bind_group_layouts: &[],
                immediate_size: 0,
            });
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(PASS),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("clear"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: Default::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: FORMAT,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                fragment: None,
                multiview_mask: None,
                cache: None,
            })
        });
    }

    /// The light frames' buffers, one a face, grown to what this frame's tiles hold.
    pub fn grow_frames(&mut self, device: &Device, frame: &wgpu::BindGroupLayout) {
        let d = &device.device;
        while self.frames.len() < self.frames_wanted {
            let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(PASS),
                size: std::mem::size_of::<crate::FrameUniform>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind = crate::bind_group(d, PASS, frame, [buffer.as_entire_binding()]);
            self.frames.push((buffer, bind));
        }
    }

    /// The texture and each layer's frame for `(side, layers)`.
    pub fn ensure(
        &mut self,
        device: &Device,
        (side, layers): (u32, u32),
        frame: &wgpu::BindGroupLayout,
    ) {
        let d = &device.device;
        let t = d.create_texture(&wgpu::TextureDescriptor {
            label: Some(PASS),
            size: wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: layers.max(1),
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let array = t.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let views = (0..layers.max(1))
            .map(|z| {
                t.create_view(&wgpu::TextureViewDescriptor {
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: z,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        self.texture = Some((array, views));
        while self.frames.len() < layers as usize {
            let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(PASS),
                size: std::mem::size_of::<crate::FrameUniform>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind = crate::bind_group(d, PASS, frame, [buffer.as_entire_binding()]);
            self.frames.push((buffer, bind));
        }
    }

    /// Each map as the frame reports it; under tiles, each light's slots count its tiles in the
    /// order they fill, from 0 (#2034).
    pub fn reports(&self) -> Vec<Report> {
        let mut next = 0;
        self.list
            .iter()
            .enumerate()
            .map(|(slot, m)| {
                let count = if m.map.cube { 6 } else { 1 };
                let slots = if m.size == 0 {
                    Vec::new()
                } else {
                    next += count;
                    (next - count..next).collect()
                };
                Report {
                    light: self.labels[slot].clone(),
                    key: m.key,
                    faces: m.map.faces.len() as u32,
                    drawn: self.stale.contains(&slot),
                    casters: m.casters.iter().cloned().collect(),
                    size: m.size,
                    slots,
                }
            })
            .collect()
    }

    /// Each tiled light's texels as the frame's shading reads them (#2034): its faces' tiles in
    /// slot order, each tile's rows top-down, each texel's bytes as stored; none outside tiles or
    /// on a backend with no pixels. Depth copies take the whole atlas, so it is read once.
    pub fn texels(&self, device: &Device) -> Vec<(String, Vec<u8>)> {
        let Some((_, views)) = self.texture.as_ref().filter(|_| self.tiled.is_some()) else {
            return Vec::new();
        };
        let texel = FORMAT.block_copy_size(None).unwrap_or(4) as usize;
        let Some(atlas) = views
            .first()
            .and_then(|v| crate::read_texture(device, v.texture(), [ATLAS, ATLAS], texel as u32))
        else {
            return Vec::new();
        };
        let row = ATLAS as usize * texel;
        (self.list.iter().zip(&self.labels))
            .map(|(m, id)| {
                let side = m.size as usize;
                let mut out = Vec::with_capacity(m.map.faces.len() * side * side * texel);
                for &(offset, _) in &m.map.faces {
                    let [x, y] = tiles::origin(m.size, m.first + offset).map(|v| v as usize);
                    for r in y..y + side {
                        out.extend_from_slice(&atlas[r * row + x * texel..][..side * texel]);
                    }
                }
                (id.clone(), out)
            })
            .collect()
    }

    /// Forgets what each slot's layers were made from, so the next frame draws every map.
    pub fn forget(&mut self) {
        self.keys = [None; SLOTS];
        if let Some(t) = &mut self.tiled {
            t.clear();
        }
    }

    /// Lets go of the maps, so the next frame that casts makes them again; whether it held any.
    pub fn rest(&mut self) -> bool {
        self.forget();
        self.tiled = None;
        self.layers = 0;
        self.texture.take().is_some()
    }

    /// The map a slot's layer holds, for a test against a clean render.
    pub fn view_of(&self, layer: usize) -> Option<&wgpu::TextureView> {
        self.texture.as_ref().and_then(|(_, v)| v.get(layer))
    }
}

impl crate::Renderer {
    /// [`Locals::texels`] for the frame just drawn, by light ID (#2034).
    pub fn tile_texels(&self, device: &Device) -> Vec<(String, Vec<u8>)> {
        self.locals.texels(device)
    }
}

/// The IES tables' atlas: one layer per distribution, keyed by their hashes.
pub struct Tables {
    pub view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    texture: Option<wgpu::Texture>,
    held: Vec<String>,
}

/// `v` as a half float, rounding toward zero's nearest step.
fn half(v: f32) -> u16 {
    let bits = v.max(0.0).to_bits();
    let exp = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let frac = bits & 0x7f_ffff;
    if exp >= 31 {
        0x7bff
    } else if exp <= 0 {
        if exp < -10 {
            0
        } else {
            ((((frac | 0x80_0000) >> (13 - exp)) + 1) >> 1) as u16
        }
    } else {
        // Rounded at the bit below the mantissa's, which may carry into the exponent, and no
        // further than the largest finite value.
        let m = (exp as u32) << 10 | frac >> 13;
        (m + (frac >> 12 & 1)).min(0x7bff) as u16
    }
}

impl Tables {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Tables {
        let stub = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d ies stub"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        Tables {
            view: stub.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            }),
            sampler: d.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("scene3d ies"),
                address_mode_u: wgpu::AddressMode::Repeat,
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            texture: None,
            held: Vec::new(),
        }
    }

    /// The atlas holding `tables`; true when its view changed.
    pub fn upload(&mut self, device: &Device, tables: &[Arc<Distribution>]) -> bool {
        if tables.is_empty() || tables.iter().map(|t| &t.sha).eq(&self.held) {
            return false;
        }
        let d = &device.device;
        if self.texture.is_none() {
            let t = d.create_texture(&wgpu::TextureDescriptor {
                label: Some("scene3d ies"),
                size: wgpu::Extent3d {
                    width: WIDTH as u32,
                    height: HEIGHT as u32,
                    depth_or_array_layers: MOST as u32,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R16Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.view = t.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::D2Array),
                ..Default::default()
            });
            self.texture = Some(t);
        }
        let texture = self.texture.as_ref().expect("made above");
        for (layer, t) in tables.iter().enumerate() {
            let texels: Vec<u8> = t
                .table
                .iter()
                .flat_map(|v| half(*v).to_le_bytes())
                .collect();
            device.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: layer as u32,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &texels,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(WIDTH as u32 * 2),
                    rows_per_image: Some(HEIGHT as u32),
                },
                wgpu::Extent3d {
                    width: WIDTH as u32,
                    height: HEIGHT as u32,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.held = tables.iter().map(|t| t.sha.clone()).collect();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_floats_keep_what_a_table_holds() {
        assert_eq!(half(1.0), 0x3c00);
        assert_eq!(half(0.0), 0);
        assert_eq!(half(2.0), 0x4000);
        assert_eq!(half(0.5), 0x3800);
        assert_eq!(half(1e9), 0x7bff);
    }

    #[test]
    fn half_floats_keep_values_under_the_smallest_exponent_and_stop_at_the_largest() {
        let got = [half(2f32.powi(-15)), half(1e-5), half(65530.0)];
        assert_eq!(got, [0x0200, 0x00a8, 0x7bff]);
    }

    #[test]
    fn runs_keep_the_instances_a_map_holds() {
        let owners: Vec<String> = ["a", "b", "c", "d"].map(String::from).to_vec();
        assert_eq!(runs(&owners, None), vec![0..4]);
        let only = BTreeSet::from(["a".to_string(), "c".into(), "d".into()]);
        assert_eq!(runs(&owners, Some(&only)), vec![0..1, 2..4]);
    }
}
