//! #269: grid images rebuilt on the GPU, for Vello GPU to paint as external textures. Each grid
//! image keeps its grid on the device as one byte a cell. A frame of the step the device holds,
//! or of the step after it, uploads only the rows whose cells differ from what the device holds:
//! the rows that step changed. Any other frame (a new reader, a seek) uploads the whole grid. One
//! compute pass writes the uploaded rows into the grid and rebuilds the image from it
//! (`grid.wgsl`), so the pixels come from the shares the GPU rebuilt, as the CPU's do. With timing
//! on, the pass's start and end timestamps hold its uploads and its rebuild, read once the frame
//! is done.

use std::collections::BTreeMap;

use deep_canvas_marks::grid_image::{Drawn, Sample, MAX_ROLES};
use vello_cpu::ImageSource;
use vello_gpu::{RectU16, TextureBindings, TextureId};
use wgpu::util::DeviceExt;

const SOURCE: &str = include_str!("grid.wgsl");

/// Most grid images a drawing times.
const TIMED: u32 = 64;

/// One grid image's grid and image on the device.
struct Kept {
    size: [usize; 2],
    /// The grid the last frame drew, and the one the device holds (the same, but under the plant
    /// that keeps the step before).
    classes: Vec<u8>,
    shown: Vec<u8>,
    step: i64,
    /// The grid, a byte a cell, four to a word, each row `stride` words.
    cells: wgpu::Buffer,
    image: Option<([u16; 2], wgpu::Texture)>,
    id: TextureId,
}

/// Each timed grid image's two timestamps, and where they resolve to.
struct Timing {
    set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    period_ns: f64,
    items: Vec<String>,
}

/// What a drawing's grid images did: the rows each uploaded, and, timed, where the times land.
#[derive(Default)]
pub struct GridFrame {
    pub rows: BTreeMap<String, Vec<usize>>,
    times: Option<(wgpu::Buffer, f64, Vec<String>)>,
}

impl GridFrame {
    /// Once the drawing's work is done: each timed grid image's uploads and rebuild, in ms.
    pub fn draw_ms(&self, device: &wgpu::Device) -> BTreeMap<String, f64> {
        let Some((read, period_ns, items)) = &self.times else {
            return BTreeMap::new();
        };
        let bytes = 16 * items.len() as u64;
        let slice = read.slice(..bytes);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        let ms: Vec<f64> = match slice.get_mapped_range() {
            Ok(data) => data
                .as_chunks::<16>()
                .0
                .iter()
                .map(|t| {
                    let tick = |b: &[u8]| u64::from_le_bytes(b.try_into().expect("8 bytes"));
                    tick(&t[8..]).saturating_sub(tick(&t[..8])) as f64 * period_ns / 1e6
                })
                .collect(),
            Err(_) => Vec::new(),
        };
        read.unmap();
        items.iter().cloned().zip(ms).collect()
    }
}

/// The pass's pipelines: the rows' scatter and the rebuild, over one layout.
struct Pipelines {
    layout: wgpu::BindGroupLayout,
    scatter: wgpu::ComputePipeline,
    rebuild: wgpu::ComputePipeline,
}

/// The grid images a device holds, by item.
#[derive(Default)]
pub struct Grids {
    pipelines: Option<Pipelines>,
    kept: BTreeMap<String, Kept>,
    /// The textures this drawing's grid images painted, bound when it renders.
    pub bindings: TextureBindings,
    next: u64,
    /// The rows this drawing's grid images uploaded.
    rows: BTreeMap<String, Vec<usize>>,
    timing: Option<Timing>,
    /// #269 AC5's wrong program: each pixel takes its cell's role before the rebuild.
    pub picks_first: bool,
    /// #269 AC3's wrong program: a played frame holds the step before its own on the device.
    pub keeps_previous: bool,
}

impl Grids {
    /// Times each grid image's uploads and rebuild from the next drawing on, where the device
    /// takes timestamps in passes; off, none.
    pub fn time(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, on: bool) {
        let can = device.features().contains(wgpu::Features::TIMESTAMP_QUERY);
        if !(on && can) {
            self.timing = None;
            return;
        }
        if self.timing.is_some() {
            return;
        }
        let bytes = 16 * u64::from(TIMED);
        let buffer = |label, usage| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: bytes,
                usage,
                mapped_at_creation: false,
            })
        };
        use wgpu::BufferUsages as B;
        self.timing = Some(Timing {
            set: device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("grid image times"),
                ty: wgpu::QueryType::Timestamp,
                count: 2 * TIMED,
            }),
            resolve: buffer("grid image times", B::QUERY_RESOLVE | B::COPY_SRC),
            read: buffer("grid image times read", B::COPY_DST | B::MAP_READ),
            period_ns: f64::from(queue.get_timestamp_period()),
            items: Vec::new(),
        });
    }

    /// Grid image `item`'s image at `size` px, its grid uploaded as far as it changed and its
    /// image rebuilt on `encoder`, bound for this drawing to render.
    pub fn source(
        &mut self,
        (device, encoder): (&wgpu::Device, &mut wgpu::CommandEncoder),
        item: &str,
        g: &Drawn,
        size: [u16; 2],
    ) -> ImageSource {
        let stride = g.cols.div_ceil(4);
        let fresh = |next: &mut u64| {
            *next += 1;
            Kept {
                size: [g.cols, g.rows],
                classes: Vec::new(),
                shown: Vec::new(),
                step: i64::MIN,
                cells: device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("grid image cells"),
                    size: (4 * stride * g.rows) as u64,
                    usage: wgpu::BufferUsages::STORAGE,
                    mapped_at_creation: false,
                }),
                image: None,
                id: TextureId(*next),
            }
        };
        let kept = self
            .kept
            .entry(item.to_string())
            .or_insert_with(|| fresh(&mut self.next));
        if kept.size != [g.cols, g.rows] {
            *kept = fresh(&mut self.next);
        }
        let played = kept.step != i64::MIN && g.step == kept.step + 1;
        let whole = kept.shown.len() != g.classes.len() || !(played || g.step == kept.step);
        // The planted path holds the step before a played frame's: the last frame's grid.
        let target = match self.keeps_previous && played && !whole {
            true => std::mem::take(&mut kept.classes),
            false => g.classes.clone(),
        };
        let rows: Vec<usize> = (0..g.rows)
            .filter(|&r| {
                let row = r * g.cols..(r + 1) * g.cols;
                whole || kept.shown.get(row.clone()) != target.get(row)
            })
            .collect();
        // The rows staged as the grid holds them, and their places.
        let mut staged = vec![0u8; 4 * stride * rows.len().max(1)];
        for (j, &r) in rows.iter().enumerate() {
            let at = 4 * stride * j;
            staged[at..at + g.cols].copy_from_slice(&target[r * g.cols..(r + 1) * g.cols]);
        }
        let places: Vec<u8> = (rows.iter().map(|&r| r as u32))
            .chain([0])
            .flat_map(u32::to_le_bytes)
            .collect();
        if !rows.is_empty() {
            self.rows.entry(item.to_string()).or_default().extend(&rows);
        }
        kept.shown = target;
        kept.classes.clone_from(&g.classes);
        kept.step = g.step;
        if kept.image.as_ref().is_none_or(|(s, _)| *s != size) {
            let image = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("grid image"),
                size: wgpu::Extent3d {
                    width: u32::from(size[0]),
                    height: u32::from(size[1]),
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            kept.image = Some((size, image));
        }
        let (_, image) = kept.image.as_ref().expect("made above");
        let image_view = image.create_view(&Default::default());
        let p = self.pipelines.get_or_insert_with(|| pipelines(device));
        let init = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        use wgpu::BufferUsages as B;
        let uniforms = uniforms(g, size, self.picks_first, (stride, rows.len()));
        let uniforms = init("grid image", &uniforms, B::UNIFORM);
        let staged = init("grid image rows", &staged, B::STORAGE);
        let places = init("grid image row places", &places, B::STORAGE);
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("grid image"),
            layout: &p.layout,
            entries: &[
                buffer(0, &uniforms),
                buffer(1, &kept.cells),
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&image_view),
                },
                buffer(3, &staged),
                buffer(4, &places),
            ],
        });
        let timed = self
            .timing
            .as_mut()
            .filter(|t| t.items.len() < TIMED as usize)
            .map(|t| {
                t.items.push(item.to_string());
                let at = 2 * (t.items.len() as u32 - 1);
                wgpu::ComputePassTimestampWrites {
                    query_set: &t.set,
                    beginning_of_pass_write_index: Some(at),
                    end_of_pass_write_index: Some(at + 1),
                }
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("grid image"),
                timestamp_writes: timed,
            });
            pass.set_bind_group(0, &group, &[]);
            if !rows.is_empty() {
                pass.set_pipeline(&p.scatter);
                pass.dispatch_workgroups((stride as u32).div_ceil(64), rows.len() as u32, 1);
            }
            pass.set_pipeline(&p.rebuild);
            let groups = |n: u16| u32::from(n).div_ceil(8);
            pass.dispatch_workgroups(groups(size[0]), groups(size[1]), 1);
        }
        self.bindings.insert(kept.id, image_view);
        let region = RectU16 {
            x0: 0,
            y0: 0,
            x1: size[0],
            y1: size[1],
        };
        ImageSource::external_texture(kept.id, region, true)
    }

    /// The drawing is encoded: its bindings are let go, its times resolve on `encoder`, and what
    /// its grid images did is handed over.
    pub fn rendered(&mut self, encoder: &mut wgpu::CommandEncoder) -> GridFrame {
        self.bindings = TextureBindings::new();
        let times = self
            .timing
            .as_mut()
            .filter(|t| !t.items.is_empty())
            .map(|t| {
                let n = t.items.len() as u32;
                encoder.resolve_query_set(&t.set, 0..2 * n, &t.resolve, 0);
                encoder.copy_buffer_to_buffer(&t.resolve, 0, &t.read, 0, 16 * u64::from(n));
                (t.read.clone(), t.period_ns, std::mem::take(&mut t.items))
            });
        GridFrame {
            rows: std::mem::take(&mut self.rows),
            times,
        }
    }
}

/// `b` bound whole at `binding`.
fn buffer(binding: u32, b: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding,
        resource: b.as_entire_binding(),
    }
}

/// The scatter and the rebuild over one layout: the uniforms, the grid, the image, the staged
/// rows and their places.
fn pipelines(device: &wgpu::Device) -> Pipelines {
    let storage = |binding, read_only| wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    };
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("grid image"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            storage(1, false),
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            },
            storage(3, true),
            storage(4, true),
        ],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("grid image"),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("grid image"),
        source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
    });
    let pipeline = |entry| {
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("grid image"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            cache: None,
        })
    };
    Pipelines {
        scatter: pipeline("scatter"),
        rebuild: pipeline("main"),
        layout,
    }
}

/// The pass's uniforms, laid out as `grid.wgsl`'s `U`: with the grid's row stride in words and
/// the rows staged this frame.
fn uniforms(
    g: &Drawn,
    size: [u16; 2],
    picks_first: bool,
    (stride, staged): (usize, usize),
) -> Vec<u8> {
    let mut b = Vec::with_capacity(48 + 16 * (MAX_ROLES + 1));
    for w in [
        g.cols as u32,
        g.rows as u32,
        u32::from(size[0]),
        u32::from(size[1]),
    ] {
        b.extend(w.to_le_bytes());
    }
    let px = [
        f32::from(size[0]) / g.cols as f32,
        f32::from(size[1]) / g.rows as f32,
    ];
    for f in [px[0], px[1], g.edge] {
        b.extend(f.to_le_bytes());
    }
    let sample = u32::from(g.sample == Sample::Smooth);
    for w in [
        sample,
        u32::from(picks_first),
        stride as u32,
        staged as u32,
        0,
    ] {
        b.extend(w.to_le_bytes());
    }
    for c in g.colors.iter().flatten() {
        b.extend(c.to_le_bytes());
    }
    b
}
