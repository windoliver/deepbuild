//! The fill lights (issue #1634; canvas primitives: Light and the light policy): the point and
//! spot lights a view shades beside its key lights, up to its class's `fill_shaded`. A compute
//! pass lists them cell by cell in the policy's grid, each list in the policy's order (score
//! bucket, then ID), and the solids' shading walks its cell's list. Past a cluster's cap the pass
//! keeps the first of them and reports the cell, which a frame reads back once per change. The
//! pass runs again only when a light or the view changes, and its pipeline is made with the
//! renderer, so a light switched on compiles nothing.
//!
//! The lights and their lists follow the key lights' cells in the light grid's one buffer: the
//! solids' fragment stage already binds as many storage buffers as a device has to give.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::clusters::{CELLS, SLICES, TILES};
use deep_canvas_scene3d::light::{MARGIN, MOST_FILL};
use deep_canvas_scene3d::scene::{Camera, Scene};
use deep_gpu::counted::Written;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;

use crate::{lock, read_back, Profiler};

/// A cluster's cell and the fill lights its list holds, by ID with their weights (#1634).
pub type Cluster = ([u32; 3], Vec<(String, f32)>);

const SOURCE: &str = include_str!("fill.wgsl");
/// The planted pass, in place of fill.wgsl's own from its `// ASSIGN` line on.
const ARRIVAL: &str = include_str!("fill_arrival.wgsl");
/// The pass, timed and priced under this name.
pub use deep_canvas_scene3d::module::FILL_PASS as PASS;
/// A cell's report past its cap: a bit per light, in words.
const WORDS: usize = MOST_FILL / 32;
/// Where the lights' records and the cells' lists start in the light grid's buffer, in bytes
/// (scene3d.wgsl's `FILL_LIGHTS` and `FILL_LISTS`): after the key lights' cells.
const LIGHTS_AT: u64 = (CELLS * 4) as u64;
const LISTS_AT: u64 = LIGHTS_AT + (MOST_FILL * std::mem::size_of::<Record>()) as u64;

/// The lights the cells' own lists have room for at first, over all of them; a frame that lists
/// more takes room for the next power of two.
const LISTED: usize = CELLS * 64;

/// The bytes of every light's span, each cell's start among the lights listed and room for
/// `listed` of those, at two bytes each.
fn spans_size(listed: usize) -> usize {
    (MOST_FILL + CELLS + 1) * 4 + listed.max(LISTED).next_power_of_two() * 2
}

deep_gpu::paired! { params: "fill.wgsl", Params;
/// fill.wgsl's `Params`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    lens: [f32; 4],
    roll: [f32; 4],
    depth: [f32; 4],
    count: [u32; 4],
}
}

deep_gpu::paired! { reach: "fill.wgsl", Reach;
/// fill.wgsl's `Reach`: a light in view space with its range, and its score.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Reach {
    at: [f32; 4],
    score: [u32; 4],
}
}

/// A fill light as scene3d.wgsl reads one from the light grid's buffer: a key light's record,
/// then a hash of its ID (u32 bits), which a light response takes.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Record {
    pub light: [[f32; 4]; 6],
    pub more: [f32; 4],
}

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Fill lights under the key lights' cut: the first 32 by the policy's order, dimmed within
    /// its margin, and no more.
    pub top_32: bool,
    /// The pass appends each light to a cell where an atomic counter puts it.
    pub arrival_order: bool,
    /// The lights are listed in the document's order, so a cluster's cap keeps the first of those.
    pub cap_by_list_order: bool,
}

/// A cluster past its cap: its tile, its slice, and the lights it dropped, by ID in the policy's
/// order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Over {
    pub cluster: [u32; 3],
    pub dropped: Vec<String>,
}

/// The cost model's terms for a frame that shades fill lights (The cost model: a pass's time per
/// pixel is multiplied by the lights in the pixel's cluster), each fitted to the night city's
/// orbit at 1920 × 1080 on an M5 Max (Mac17,10) at rest, release, medians: a frame's passes per
/// pixel (1.08 ms for the city with no lamp), a pixel per light its cluster lists (2.1 ms more
/// where a pixel's cluster lists 11 at the frame's mean), and the policy's scoring per light
/// (0.33 ms for 2,048).
const FRAME_NS_PER_PX: f64 = 0.52;
const LIGHT_NS_PER_PX: f64 = 0.09;
const SCORING_NS_PER_LIGHT: f64 = 160.0;

/// The lights' own pass's terms: a cell, and a light a cell lists. The night city's cells list
/// 6,200 lights and its pass takes 0.073 ms; with its ranges 8 times as long they list 257,000
/// and it takes 0.84 ms.
const CELL_NS: f64 = 16.0;
const LISTED_NS: f64 = 3.0;

/// What the lights' pass's declared cost prices a run that lists `walked` lights at, ms.
pub fn pass_ms(walked: usize) -> f64 {
    (CELL_NS * CELLS as f64 + LISTED_NS * walked as f64) / 1e6
}

/// The cost model's estimate of a frame that shades fill lights, drawn at `px` pixels, whose
/// cells list `walked` lights, `listed` of them in a pixel's cluster at the frame's mean: its
/// GPU time in ms (its passes, each pixel over its cluster's lights, and the lights' own pass),
/// the policy's scoring in ms, and the bytes the lights and their lists hold.
pub fn estimate(scene: &Scene, px: f64, walked: usize, listed: f64) -> [f64; 3] {
    let held = scene.lights.iter().any(|l| l.fill);
    [
        (FRAME_NS_PER_PX * px + LIGHT_NS_PER_PX * px * listed) / 1e6 + pass_ms(walked),
        SCORING_NS_PER_LIGHT * scene.lights.len() as f64 / 1e6,
        if held {
            (LISTS_AT + lists_size(scene.shadowing.per_cluster)) as f64
                + (MOST_FILL * std::mem::size_of::<Reach>() + CELLS * (1 + WORDS) * 4) as f64
                + spans_size(walked) as f64
        } else {
            0.0
        },
    ]
}

/// A score as fill.wgsl's `weight` reads it: m × 2^e, with m's 32 bits in [2^31, 2^32) and e
/// biased as an f64's is.
fn split(score: f64) -> [u32; 2] {
    let bits = score.to_bits();
    let m = (bits & ((1 << 52) - 1)) | (1 << 52);
    [(m >> 21) as u32, ((bits >> 52) & 0x7ff) as u32]
}

/// The tiles and slices a light at `v` in view space can reach with `range`, as fill.wgsl's
/// `within` reads them: the box around its range, between the grid's planes, in the frame's px.
/// A little more than its own test keeps, so the pass skips every other cell without running it.
fn span(v: [f64; 3], range: f64, cam: &Camera, [near, far]: [f64; 2], tile: [f64; 2]) -> u32 {
    let r = range * (1.0 + 1e-4) + 1e-6;
    let (z0, z1) = ((v[2] - r).max(near), (v[2] + r).min(far));
    // No tile's column 15 comes before its column 0: a range short of the near plane holds no cell.
    if z1 < z0 {
        return 15;
    }
    let slice = |z: f64| match cam.perspective {
        true => (z / near).ln() / (far / near).ln() * SLICES as f64,
        false => (z - near) / (far - near) * SLICES as f64,
    };
    let [c, sn] = cam.roll;
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for k in 0..8 {
        let z = if k & 4 == 0 { z0 } else { z1 };
        let s = if cam.perspective {
            cam.scale / z
        } else {
            cam.scale
        };
        let x = (v[0] + if k & 1 == 0 { -r } else { r }) * s;
        let y = -(v[1] + if k & 2 == 0 { -r } else { r }) * s;
        let px = [
            cam.centre[0] + x * c - y * sn,
            cam.centre[1] + x * sn + y * c,
        ];
        for a in 0..2 {
            lo[a] = lo[a].min(px[a]);
            hi[a] = hi[a].max(px[a]);
        }
    }
    let within = |x: f64, most: usize| (x.floor().max(0.0) as u32).min(most as u32 - 1);
    let tiles = |a: usize| {
        [
            within(lo[a] / tile[a] - 1e-4, TILES[a]),
            within(hi[a] / tile[a] + 1e-4, TILES[a]),
        ]
    };
    let ([x0, x1], [y0, y1]) = (tiles(0), tiles(1));
    let (s0, s1) = (
        within(slice(z0) - 1e-4, SLICES),
        within(slice(z1) + 1e-4, SLICES),
    );
    x0 | x1 << 4 | y0 << 8 | y1 << 12 | s0 << 16 | s1 << 21
}

/// Every cell's list at a cap, in bytes: how many it holds and how many reached it, then that
/// many lights and that many weights.
fn lists_size(cap: usize) -> u64 {
    (CELLS * (2 + 2 * cap) * 4) as u64
}

pub struct Fill {
    planted: Planted,
    pipeline: wgpu::ComputePipeline,
    params: wgpu::Buffer,
    reach: wgpu::Buffer,
    spans: wgpu::Buffer,
    /// The pass's report and its group, once a scene holds a fill light, and the cap its lists
    /// are sized for.
    report: Option<wgpu::Buffer>,
    bind: Option<wgpu::BindGroup>,
    cap: usize,
    written: [Written; 3],
    /// The records the grid's buffer holds.
    records: Vec<u8>,
    /// What the pass last read, and what this frame's would when that differs.
    read: Vec<u8>,
    pending: Option<Vec<u8>>,
    /// Whether this frame ran the pass, so its report is new.
    ran: bool,
    /// This view's fill lights by ID, in the pass's order.
    ids: Vec<String>,
    /// The clusters past their cap at this view.
    over: Vec<Over>,
    /// The lights this view's cells list, over all of them, and in a pixel's cluster at the
    /// frame's mean: each tile's, over its cells that list any, none past the cap.
    pub walked: usize,
    pub listed: f64,
    /// The planted pass: this run's seed for the order it takes its lights in, and the lists
    /// it clears before it appends.
    start: u32,
    lists: Option<(wgpu::Buffer, u64)>,
}

impl Fill {
    pub fn new(d: &deep_gpu::counted::Wgpu, planted: Planted) -> Fill {
        let (source, entry) = if planted.arrival_order {
            let shared = SOURCE.split("// ASSIGN").next().unwrap_or(SOURCE);
            let atomic = shared
                .replace(
                    "read_write> lists: array<u32>",
                    "read_write> lists: array<atomic<u32>>",
                )
                .replace(
                    "read_write> report: array<u32>",
                    "read_write> report: array<atomic<u32>>",
                );
            (format!("{atomic}{ARRIVAL}"), "arrive")
        } else {
            (SOURCE.to_string(), "assign")
        };
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(PASS),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(PASS),
            layout: None,
            module: &module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            cache: None,
        });
        let buffer = |label, size: usize, usage| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: size as u64,
                usage: usage | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        Fill {
            planted,
            pipeline,
            params: buffer(
                "scene3d fill params",
                std::mem::size_of::<Params>(),
                wgpu::BufferUsages::UNIFORM,
            ),
            // #3016: a word each until a scene holds a fill light, so a view with none, and each
            // other view of its scene, holds nothing for them.
            reach: buffer("scene3d fill reach", 4, wgpu::BufferUsages::STORAGE),
            spans: buffer("scene3d fill spans", 4, wgpu::BufferUsages::STORAGE),
            report: None,
            bind: None,
            cap: 0,
            written: Default::default(),
            records: Vec::new(),
            read: Vec::new(),
            pending: None,
            ran: false,
            ids: Vec::new(),
            over: Vec::new(),
            walked: 0,
            listed: 0.0,
            start: if planted.arrival_order {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |t| t.subsec_nanos())
                    ^ std::process::id()
            } else {
                0
            },
            lists: None,
        }
    }

    /// The pass's group: its own buffers, and `grid`'s lists at the cap they are sized for.
    fn group(&self, device: &Device, grid: &wgpu::Buffer) -> Option<wgpu::BindGroup> {
        let report = self.report.as_ref()?;
        let lists = wgpu::BindingResource::Buffer(wgpu::BufferBinding {
            buffer: grid,
            offset: LISTS_AT,
            size: std::num::NonZeroU64::new(lists_size(self.cap)),
        });
        Some(
            device.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(PASS),
                layout: &self.pipeline.get_bind_group_layout(0),
                entries: &[
                    self.params.as_entire_binding(),
                    self.reach.as_entire_binding(),
                    lists,
                    report.as_entire_binding(),
                    self.spans.as_entire_binding(),
                ]
                .into_iter()
                .enumerate()
                .map(|(binding, resource)| wgpu::BindGroupEntry {
                    binding: binding as u32,
                    resource,
                })
                .collect::<Vec<_>>(),
            }),
        )
    }

    /// This frame's fill lights: `order` is the policy's, each light's index and score, and
    /// `records` their shading records in that order, which go into `grid`, the light grid's
    /// buffer. Answers scene3d.wgsl's `Lights.fill` and `fill_view`, and whether it made `grid`
    /// again with room for the lights and their lists, which the lights' group then binds.
    pub fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        order: &[(usize, f64)],
        records: &[Record],
        grid: &mut wgpu::Buffer,
    ) -> ([[f32; 4]; 2], bool) {
        self.ran = false;
        self.pending = None;
        self.ids = order
            .iter()
            .map(|&(i, _)| scene.lights[i].id.clone())
            .collect();
        // The lists take their room the first time a scene holds a fill light, lit or not, and
        // again only when the policy's `per_cluster` changes.
        let cap = scene.shadowing.per_cluster;
        let remade = cap != self.cap && scene.lights.iter().any(|l| l.fill);
        if remade {
            let d = &device.device;
            *grid = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("scene3d light grid"),
                size: LISTS_AT + lists_size(cap),
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_DST
                    | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            let room = |label, size: usize| {
                d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(label),
                    size: size as u64,
                    usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            };
            let reach = MOST_FILL * std::mem::size_of::<Reach>();
            if (self.reach.size() as usize) < reach {
                self.reach = room("scene3d fill reach", reach);
            }
            if (self.spans.size() as usize) < spans_size(0) {
                self.spans = room("scene3d fill spans", spans_size(0));
            }
            self.report.get_or_insert_with(|| {
                d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("scene3d fill report"),
                    size: (CELLS * (1 + WORDS) * 4) as u64,
                    usage: wgpu::BufferUsages::STORAGE
                        | wgpu::BufferUsages::COPY_SRC
                        | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            });
            self.cap = cap;
            self.bind = self.group(device, grid);
            self.records.clear();
            self.read.clear();
            self.lists = Some((grid.clone(), lists_size(cap)));
        }
        (self.walked, self.listed) = (0, 0.0);
        if order.is_empty() || self.cap == 0 {
            self.over.clear();
            self.read.clear();
            return ([[0.0; 4]; 2], remade);
        }
        let cam = &scene.camera;
        let near = cam.near.max(1e-3);
        let views: Vec<[f64; 3]> = order
            .iter()
            .map(|&(i, _)| cam.to_view(scene.lights[i].pos))
            .collect();
        // The far plane: the farthest any of this frame's lights reaches ahead of the eye.
        let far = order
            .iter()
            .zip(&views)
            .map(|(&(i, _), v)| v[2] + scene.lights[i].range)
            .fold(near * 2.0, f64::max);
        let tile = [
            f64::from(scene.size[0]) / TILES[0] as f64,
            f64::from(scene.size[1]) / TILES[1] as f64,
        ];
        let mut lights: Vec<(Reach, u32)> = order
            .iter()
            .zip(&views)
            .enumerate()
            .map(|(place, (&(i, score), v))| {
                let [m, e] = split(score);
                let range = scene.lights[i].range;
                let reach = Reach {
                    at: [v[0] as f32, v[1] as f32, v[2] as f32, range as f32],
                    score: [m, e, place as u32, 0],
                };
                (reach, span(*v, range, cam, [near, far], tile))
            })
            .collect();
        // The planted pass takes its lights in an order of this run's own.
        if self.planted.arrival_order {
            let mut x = self.start;
            for k in (1..lights.len()).rev() {
                x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                lights.swap(k, ((u64::from(x) * (k as u64 + 1)) >> 32) as usize);
            }
        }
        let (reach, mut spans): (Vec<Reach>, Vec<u32>) = lights.into_iter().unzip();
        // Each cell's lights, in the policy's order, after every light's span (fill.wgsl's
        // `BY_CELL`), two to a word: a cell walks the lights whose span holds it, never the view's.
        let cells = |span: u32| {
            let rows = (span >> 8 & 15)..=(span >> 12 & 15);
            ((span >> 16 & 31)..=(span >> 21 & 31)).flat_map(move |s| {
                rows.clone().flat_map(move |y| {
                    ((span & 15)..=(span >> 4 & 15))
                        .map(move |x| ((s * TILES[1] as u32 + y) * TILES[0] as u32 + x) as usize)
                })
            })
        };
        let mut starts = vec![0u32; CELLS + 1];
        for &span in &spans {
            for c in cells(span) {
                starts[c + 1] += 1;
            }
        }
        for c in 0..CELLS {
            starts[c + 1] += starts[c];
        }
        let mut next = starts.clone();
        let mut listed = vec![0u16; starts[CELLS] as usize];
        for (i, &span) in spans.iter().enumerate() {
            for c in cells(span) {
                listed[next[c] as usize] = i as u16;
                next[c] += 1;
            }
        }
        self.walked = listed.len();
        let tiles = TILES[0] * TILES[1];
        self.listed = (0..tiles)
            .map(|t| {
                let held: Vec<u32> = (0..SLICES)
                    .map(|s| starts[s * tiles + t + 1] - starts[s * tiles + t])
                    .filter(|&n| n > 0)
                    .collect();
                let most = self.cap as u32;
                held.iter().map(|&n| f64::from(n.min(most))).sum::<f64>() / held.len().max(1) as f64
            })
            .sum::<f64>()
            / tiles as f64;
        if spans_size(listed.len()) as u64 > self.spans.size() {
            self.spans = device.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("scene3d fill spans"),
                size: spans_size(listed.len()) as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.bind = self.group(device, grid);
        }
        spans.resize(MOST_FILL, 0);
        spans.extend(&starts);
        spans.extend(
            listed
                .chunks(2)
                .map(|c| u32::from(c[0]) | u32::from(c.get(1).copied().unwrap_or(0)) << 16),
        );
        let params = Params {
            lens: [
                cam.centre[0] as f32,
                cam.centre[1] as f32,
                cam.scale as f32,
                f32::from(u8::from(cam.perspective)),
            ],
            roll: [
                cam.roll[0] as f32,
                cam.roll[1] as f32,
                tile[0] as f32,
                tile[1] as f32,
            ],
            depth: [near as f32, far as f32, MARGIN as f32, 0.0],
            count: [
                order.len() as u32,
                self.cap as u32,
                u32::from(self.planted.cap_by_list_order),
                0,
            ],
        };
        let mut read = bytemuck::bytes_of(&params).to_vec();
        read.extend_from_slice(bytemuck::cast_slice(&reach));
        let records: &[u8] = bytemuck::cast_slice(records);
        deep_gpu::alloc::outside(|| {
            let q = &device.queue;
            let [p, r, s] = &self.written;
            q.write_changed(&self.params, p, bytemuck::bytes_of(&params));
            q.write_changed(&self.reach, r, bytemuck::cast_slice(&reach));
            q.write_changed(&self.spans, s, bytemuck::cast_slice(&spans));
            if self.records != records {
                q.write_buffer(grid, LIGHTS_AT, records);
            }
        });
        if self.records != records {
            self.records = records.to_vec();
        }
        if read != self.read {
            self.pending = Some(read);
        }
        let eye = -(cam.eye[0] * cam.forward[0]
            + cam.eye[1] * cam.forward[1]
            + cam.eye[2] * cam.forward[2]);
        (
            [
                [1.0, far as f32, near as f32, self.cap as f32],
                [eye as f32, 0.0, 0.0, 0.0],
            ],
            remade,
        )
    }

    /// The bytes the fill lights hold on the device: `grid`, where their records and lists
    /// follow the key lights' cells, and the pass's own buffers. Nothing before a scene holds one.
    pub fn bytes(&self, grid: &wgpu::Buffer) -> u64 {
        let own = self.reach.size() + self.spans.size();
        (self.report.as_ref()).map_or(0, |r| grid.size() + own + r.size())
    }

    /// The pass, when this frame's lights or view differ from the ones it last ran for.
    pub fn job(&mut self, profiler: &Option<Profiler>) -> Option<Job> {
        let bind = self.bind.clone()?;
        self.read = self.pending.take()?;
        self.ran = true;
        let (pipeline, profiler) = (self.pipeline.clone(), profiler.clone());
        // The planted pass runs a light to an invocation, over lists and counts it cleared.
        let arriving = (self.planted.arrival_order).then(|| {
            (
                self.lists.clone(),
                self.report.clone(),
                self.ids.len() as u32,
            )
        });
        let record =
            move |encoder: &mut wgpu::CommandEncoder,
                  timestamp_writes: Option<wgpu::ComputePassTimestampWrites<'_>>| {
                let mut groups = (CELLS as u32).div_ceil(64);
                if let Some((lists, report, lights)) = &arriving {
                    if let Some((grid, size)) = lists {
                        encoder.clear_buffer(grid, LISTS_AT, Some(*size));
                    }
                    if let Some(report) = report {
                        encoder.clear_buffer(report, 0, Some((CELLS * 4) as u64));
                    }
                    groups = lights.div_ceil(64);
                }
                deep_gpu::counted::compute_pass();
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(PASS),
                    timestamp_writes,
                });
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.dispatch_workgroups(groups, 1, 1);
            };
        Some(Box::new(move |encoder| match &profiler {
            Some(p) => {
                let p = lock(p);
                let q = p.begin_pass_query(PASS, encoder);
                record(encoder, q.compute_pass_timestamp_writes());
                p.end_query(encoder, q);
            }
            None => record(encoder, None),
        }))
    }

    /// After a frame: the clusters past their cap at this view, each with the lights it
    /// dropped. Read back from the pass's report when the frame ran it and more lights are in
    /// view than a cluster holds; otherwise as the last frame that ran it found them.
    pub fn check(&mut self, device: &Device) -> &[Over] {
        if !std::mem::take(&mut self.ran) {
            return &self.over;
        }
        self.over.clear();
        // The planted pass reports no light by name.
        let reported = self.ids.len() > self.cap && !self.planted.arrival_order;
        let Some(report) = self.report.as_ref().filter(|_| reported) else {
            return &self.over;
        };
        let words = |bytes: &[u8]| -> Vec<u32> {
            bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|&w| u32::from_le_bytes(w))
                .collect()
        };
        let totals = read_back(device, PASS, (CELLS * 4) as u64, |e, staging| {
            e.copy_buffer_to_buffer(report, 0, staging, 0, (CELLS * 4) as u64);
        })
        .map(|b| words(&b))
        .unwrap_or_default();
        let cells: Vec<usize> = (0..totals.len())
            .filter(|&c| totals[c] as usize > self.cap)
            .collect();
        if cells.is_empty() {
            return &self.over;
        }
        let row = (WORDS * 4) as u64;
        let bits = read_back(device, PASS, cells.len() as u64 * row, |e, staging| {
            for (k, &c) in cells.iter().enumerate() {
                let from = ((CELLS + c * WORDS) * 4) as u64;
                e.copy_buffer_to_buffer(report, from, staging, k as u64 * row, row);
            }
        })
        .map(|b| words(&b))
        .unwrap_or_default();
        for (&c, reached) in cells.iter().zip(bits.chunks(WORDS)) {
            // The lights that reached the cell, in the policy's order: the first `cap` are kept.
            let dropped = (0..self.ids.len())
                .filter(|&i| reached[i / 32] & (1 << (i % 32)) != 0)
                .skip(self.cap)
                .map(|i| self.ids[i].clone())
                .collect();
            let tile = c % (TILES[0] * TILES[1]);
            self.over.push(Over {
                cluster: [
                    (tile % TILES[0]) as u32,
                    (tile / TILES[0]) as u32,
                    (c / (TILES[0] * TILES[1])) as u32,
                ],
                dropped,
            });
        }
        &self.over
    }

    /// Each cell's list as the solids' shading walks it, read back from `grid`: its cluster, and
    /// the lights it holds by ID, each with its weight. Nothing while no fill light is in view.
    pub fn read(&self, device: &Device, grid: &wgpu::Buffer) -> Vec<Cluster> {
        if self.ids.is_empty() || self.cap == 0 {
            return Vec::new();
        }
        let size = lists_size(self.cap);
        let Some(bytes) = read_back(device, PASS, size, |e, staging| {
            e.copy_buffer_to_buffer(grid, LISTS_AT, staging, 0, size);
        }) else {
            return Vec::new();
        };
        let word = |i: usize| {
            u32::from_le_bytes([
                bytes[i * 4],
                bytes[i * 4 + 1],
                bytes[i * 4 + 2],
                bytes[i * 4 + 3],
            ])
        };
        let stride = 2 + 2 * self.cap;
        (0..CELLS)
            .filter_map(|c| {
                let base = c * stride;
                let held = (word(base) as usize).min(self.cap);
                let lights: Vec<(String, f32)> = (0..held)
                    .filter_map(|k| {
                        let id = self.ids.get(word(base + 2 + k) as usize)?;
                        Some((id.clone(), f32::from_bits(word(base + 2 + self.cap + k))))
                    })
                    .collect();
                let tile = c % (TILES[0] * TILES[1]);
                let cluster = [
                    (tile % TILES[0]) as u32,
                    (tile / TILES[0]) as u32,
                    (c / (TILES[0] * TILES[1])) as u32,
                ];
                (!lights.is_empty()).then_some((cluster, lights))
            })
            .collect()
    }
}
