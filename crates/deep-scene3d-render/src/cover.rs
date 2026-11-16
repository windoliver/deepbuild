//! #1383: the terrain plates' cover on the GPU (canvas primitives: Builder plate: terrain). Every
//! covered plate of a frame lives in one storage buffer in the lights' group (cover.wgsl): a table
//! of each plate's pick, grid, sample stride and entries (each entry's material factors,
//! projection, map, map transform, modifies, blend and span), a table of the cover maps, then each
//! plate's distances per sample (a byte each, the samples' runs padded to whole words), then each map's
//! RGBA8 texels with their mips. A storage buffer, not textures: the solids' fragment stage
//! already binds 14 of the 16 sampled textures a device need hold (tint.rs), so the cover filters
//! its maps itself. The buffer is made again when the set of plates, their sizes or the maps
//! change; otherwise a frame writes the table and the weights that changed.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_scene3d::cover::{Cover, Kind, Projection, MAX_ENTRIES, MAX_MODIFY};
use deep_canvas_scene3d::light::{cover_texels, Texels};
use deep_gpu::counted::Written;
use deep_gpu::device::Device;

/// Its binding in the lights' group (cover.wgsl).
const BINDING: u32 = 22;
/// Words before the plates' table: the plates' count and the maps' count.
const HEAD: usize = 2;
/// A plate's words (cover.wgsl: `COVER_PLATE`): its pick, cols, rows, stride in bytes, the word
/// its weights start at, its size along X and Z (f32), its entries' count, then its entries.
const PLATE: usize = 8 + MAX_ENTRIES * ENTRY;
/// An entry's words (cover.wgsl: `COVER_ENTRY`): base color (3 f32), roughness, metallic, its
/// projection (0 uv, 1 triplanar, 2 auto), its map's index (u32::MAX for none), the map's
/// transform (6 f32), and two modifies of three words each: kind (0 none, 1 wet, 2 dust), amount
/// (f32) and the byte of its own distance (255 for none); then its blend and span (f32, m).
const ENTRY: usize = 21;
/// A map's words (cover.wgsl: `COVER_MAP`): its width, height, mips and the word its texels start
/// at.
const MAP: usize = 4;
/// No map, no pick.
const NONE: u32 = u32::MAX;
/// A modify with no `where` of its own.
const NO_SLOT: u32 = 255;

/// The lights group's layout entry for the cover's buffer.
pub(crate) fn entry() -> wgpu::BindGroupLayoutEntry {
    crate::buffer_entry(
        BINDING,
        wgpu::ShaderStages::FRAGMENT,
        wgpu::BufferBindingType::Storage { read_only: true },
    )
}

/// Words a plate's distances take: each sample's bytes padded to whole words.
fn words_per_sample(c: &Cover) -> usize {
    c.stride.div_ceil(4)
}

/// One RGBA8 map's words, its mips one after another, each texel a word.
fn texel_words(t: &Texels) -> usize {
    t.data.len() / 4
}

/// What the buffer was made for: each plate's ID, size and stride, and each map's hash.
#[derive(Clone, Debug, Default, PartialEq)]
struct Shape {
    plates: Vec<(String, usize, usize, usize)>,
    maps: Vec<String>,
}

fn shape_of(covers: &[Cover]) -> Shape {
    let mut maps = Vec::new();
    for e in covers.iter().flat_map(|c| &c.entries) {
        if let Some(m) = &e.map {
            if !maps.contains(&m.sha) {
                maps.push(m.sha.clone());
            }
        }
    }
    Shape {
        plates: covers
            .iter()
            .map(|c| (c.plate.clone(), c.cols, c.rows, c.stride))
            .collect(),
        maps,
    }
}

/// Every covered plate on the GPU.
pub struct Store {
    pub buffer: wgpu::Buffer,
    shape: Shape,
    /// Where each plate's weights start, in words, and the weights it last wrote.
    held: Vec<(usize, Vec<u8>)>,
    /// Where each map's texels start, in words.
    maps: Vec<usize>,
    table: Written,
}

fn buffer(d: &deep_gpu::counted::Wgpu, words: usize) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d cover"),
        size: (words.max(4) * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

fn write(device: &Device, buffer: &wgpu::Buffer, word: usize, bytes: &[u8]) {
    deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, (word * 4) as u64, bytes));
}

impl Store {
    /// No covered plate: counts of 0.
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Store {
        Store {
            buffer: buffer(d, 4),
            shape: Shape::default(),
            held: Vec::new(),
            maps: Vec::new(),
            table: Written::default(),
        }
    }

    /// Writes the weights of `covers` that changed since the last frame: on a new set of
    /// plates, sizes or maps, a new buffer with every plate's weights and every map's texels,
    /// and then true (the lights' group binds the new buffer). A map whose RGBA8 texels
    /// `texels` lacks draws as white.
    pub fn upload(
        &mut self,
        device: &Device,
        covers: &[Cover],
        texels: &BTreeMap<String, Arc<Texels>>,
    ) -> bool {
        let shape = shape_of(covers);
        let made = shape != self.shape;
        if made {
            let mut at = HEAD + covers.len() * PLATE + shape.maps.len() * MAP;
            self.held = covers
                .iter()
                .map(|c| {
                    let start = at;
                    at += words_per_sample(c) * c.cols * c.rows;
                    (start, Vec::new())
                })
                .collect();
            self.maps = shape
                .maps
                .iter()
                .map(|sha| {
                    let start = at;
                    at += texels.get(&cover_texels(sha)).map_or(1, |t| texel_words(t));
                    start
                })
                .collect();
            self.buffer = buffer(&device.device, at);
            for (sha, &start) in shape.maps.iter().zip(&self.maps) {
                match texels.get(&cover_texels(sha)) {
                    Some(t) => write(device, &self.buffer, start, &t.data),
                    None => write(device, &self.buffer, start, &[255; 4]),
                }
            }
            self.table = Written::default();
            self.shape = shape;
        }
        for (c, (start, last)) in covers.iter().zip(&mut self.held) {
            if *last == c.bytes {
                continue;
            }
            let wps = words_per_sample(c);
            let mut bytes = vec![0u8; wps * 4 * c.cols * c.rows];
            for (s, run) in c.bytes.chunks(c.stride).enumerate() {
                bytes[s * wps * 4..s * wps * 4 + c.stride].copy_from_slice(run);
            }
            write(device, &self.buffer, *start, &bytes);
            last.clone_from(&c.bytes);
        }
        made
    }

    /// Writes the table of `covers` (as [`Store::upload`] last took them), each plate by its
    /// solid's pick ID in `picks`, and each map's size as `texels` holds it.
    pub fn table(
        &mut self,
        device: &Device,
        covers: &[Cover],
        picks: &BTreeMap<String, u32>,
        texels: &BTreeMap<String, Arc<Texels>>,
    ) {
        let f = |x: f64| (x as f32).to_bits();
        let mut words = vec![covers.len() as u32, self.shape.maps.len() as u32];
        for (c, (start, _)) in covers.iter().zip(&self.held) {
            let mut plate = vec![
                picks.get(&c.plate).copied().unwrap_or(NONE),
                c.cols as u32,
                c.rows as u32,
                c.stride as u32,
                *start as u32,
                f(c.size[0]),
                f(c.size[1]),
                c.entries.len() as u32,
            ];
            for e in &c.entries {
                let s = e.shading;
                plate.extend([
                    f(s.base[0]),
                    f(s.base[1]),
                    f(s.base[2]),
                    f(s.roughness),
                    f(s.metallic),
                ]);
                plate.push(match e.projection {
                    Projection::Uv => 0,
                    Projection::Triplanar => 1,
                    Projection::Auto => 2,
                });
                let (index, transform) = match &e.map {
                    Some(m) => (
                        self.shape
                            .maps
                            .iter()
                            .position(|s| *s == m.sha)
                            .map_or(NONE, |i| i as u32),
                        m.transform,
                    ),
                    None => (NONE, [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]),
                };
                plate.push(index);
                plate.extend(transform.iter().flatten().map(|&x| f(x)));
                for j in 0..MAX_MODIFY {
                    match e.modify.get(j) {
                        Some(m) => plate.extend([
                            match m.kind {
                                Kind::Wet => 1,
                                Kind::Dust => 2,
                            },
                            f(m.amount),
                            m.slot.map_or(NO_SLOT, |b| b as u32),
                        ]),
                        None => plate.extend([0, 0, NO_SLOT]),
                    }
                }
                plate.extend([f(e.blend), f(e.span)]);
            }
            plate.resize(PLATE, 0);
            words.extend(plate);
        }
        for (sha, &start) in self.shape.maps.iter().zip(&self.maps) {
            match texels.get(&cover_texels(sha)) {
                Some(t) => words.extend([t.size[0], t.size[1], t.mips.max(1), start as u32]),
                None => words.extend([1, 1, 1, start as u32]),
            }
        }
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_changed(&self.buffer, &self.table, bytemuck::cast_slice(&words))
        });
    }
}
