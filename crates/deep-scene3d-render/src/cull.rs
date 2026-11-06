//! Instancers above 256 elements culled on the GPU (issue #484; canvas primitives: Instance
//! `instance@1`). Each (prototype, material) batch keeps its records in one buffer. For each view
//! it draws into, a compute pass flags the rows whose bounds reach the view, `compact` keeps them
//! in index order as that view's row list and the count lands in the view's indirect arguments.
//! The vertex stage reads each row's record from storage, so a view costs 4 B a survivor. A view
//! runs again only when its clip or the batch's records change, and nothing reads a count back.

use std::sync::Arc;

use deep_gpu::device::Device;
use deep_gpu::structural::{Plan, Structural};
use wgpu::util::DeviceExt as _;

const SOURCE: &str = include_str!("cull.wgsl");
/// Rows a dispatch's workgroup covers.
const WORKGROUP: u32 = 256;
/// A batch's views: the camera, the key light's fitted map and the sun's four cascades.
pub const VIEWS: usize = 6;
pub const CAMERA: usize = 0;
pub const KEY_MAP: usize = 1;
pub const CASCADES: usize = 2;
/// An indexed indirect draw's arguments, in bytes: index count, instance count, first index,
/// base vertex, first instance.
pub const ARGS: u64 = 20;
const INSTANCE_COUNT: u64 = 4;

/// The planted wrong programs: each reachable only from a test.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// Tests each element's center, never its bounds.
    pub centers: bool,
    /// Compacts in reverse index order.
    pub reversed: bool,
    /// An instances output's draw takes row r as element r, not the element at the step's r.
    pub row_as_element: bool,
}

/// An instances output with a count (#484): the instancer it draws, the rows its compact step
/// keeps and their count, all written earlier in the frame.
#[derive(Clone)]
pub struct Source {
    pub instancer: String,
    pub rows: wgpu::Buffer,
    pub count: wgpu::Buffer,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    planes: [[f32; 4]; 6],
    lo: [f32; 4],
    hi: [f32; 4],
    n: u32,
    centers: u32,
    reversed: u32,
    row_as_element: u32,
}

/// The six planes a clip matrix (column-major) holds, each `q` with `q · (x, y, z, 1) ≥ 0` inside:
/// −w ≤ x ≤ w, −w ≤ y ≤ w, 0 ≤ z ≤ w.
pub fn planes(clip: &[f64; 16]) -> [[f64; 4]; 6] {
    let row = |r: usize| [clip[r], clip[4 + r], clip[8 + r], clip[12 + r]];
    let (x, y, z, w) = (row(0), row(1), row(2), row(3));
    let add = |a: [f64; 4], b: [f64; 4], k: f64| std::array::from_fn(|i| a[i] + k * b[i]);
    [
        add(w, x, 1.0),
        add(w, x, -1.0),
        add(w, y, 1.0),
        add(w, y, -1.0),
        z,
        add(w, z, -1.0),
    ]
}

/// The f64 test the GPU's kept set always contains: whether bounds `lo..hi`, placed by `m`, reach
/// the inside of every plane.
pub fn reaches(planes: &[[f64; 4]; 6], m: &[[f64; 4]; 3], [lo, hi]: &[[f64; 3]; 2]) -> bool {
    let c: [f64; 3] = std::array::from_fn(|k| (lo[k] + hi[k]) * 0.5);
    let h: [f64; 3] = std::array::from_fn(|k| (hi[k] - lo[k]) * 0.5);
    let at: [f64; 3] =
        std::array::from_fn(|r| m[r][0] * c[0] + m[r][1] * c[1] + m[r][2] * c[2] + m[r][3]);
    let reach: [f64; 3] =
        std::array::from_fn(|r| m[r][0].abs() * h[0] + m[r][1].abs() * h[1] + m[r][2].abs() * h[2]);
    planes.iter().all(|q| {
        (0..3)
            .map(|k| q[k] * at[k] + q[k].abs() * reach[k])
            .sum::<f64>()
            + q[3]
            >= 0.0
    })
}

/// The pipelines, built once per device.
pub struct Kernels {
    pipeline: wgpu::ComputePipeline,
    kept: wgpu::ComputePipeline,
    structural: Structural,
    /// The vertex stage's group of a batch's records.
    pub records: wgpu::BindGroupLayout,
}

impl Kernels {
    pub fn new(d: &wgpu::Device) -> Kernels {
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d cull"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipe = |entry: &str| {
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let records = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d element records"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        Kernels {
            pipeline: pipe("cull"),
            kept: pipe("cull_kept"),
            structural: Structural::new(d),
            records,
        }
    }
}

/// One view's list, arguments and the pass that writes them.
pub struct View {
    pub rows: wgpu::Buffer,
    pub args: wgpu::Buffer,
    pub count: wgpu::Buffer,
    params: wgpu::Buffer,
    bind: wgpu::BindGroup,
    plan: Arc<Plan>,
    /// What its list was culled from.
    key: Option<u64>,
}

/// A batch's GPU cull, made once for its records buffer.
pub struct Culled {
    /// The records' allocation and how many this was made for.
    pub made_for: (u64, u32),
    pub records: wgpu::BindGroup,
    flags: wgpu::Buffer,
    /// What `compact` keeps from: every row in index order, or, drawn from an instances output,
    /// each kept place's row.
    identity: wgpu::Buffer,
    index_count: u32,
    /// How many flags a cull writes: the batch's rows, or the step's kept places.
    flagged: u32,
    /// The instances output it draws from: its source and each element's row in this batch.
    kept: Option<(Source, wgpu::Buffer)>,
    pub views: [Option<View>; VIEWS],
}

/// One view's cull, recorded into the frame's first encoder.
pub struct Run {
    pipeline: wgpu::ComputePipeline,
    bind: wgpu::BindGroup,
    plan: Arc<Plan>,
    groups: u32,
    count: wgpu::Buffer,
    /// `None` on the planted path, whose arguments come from the CPU.
    args: Option<wgpu::Buffer>,
}

impl Run {
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        self.plan.clear(encoder);
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("scene3d cull"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.dispatch_workgroups(self.groups, 1, 1);
        }
        self.plan.dispatch(encoder, None);
        if let Some(args) = &self.args {
            encoder.copy_buffer_to_buffer(&self.count, 0, args, INSTANCE_COUNT, 4);
        }
    }
}

fn storage(d: &wgpu::Device, label: &str, n: u32, usage: wgpu::BufferUsages) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: u64::from(n.max(1)) * 4,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | usage,
        mapped_at_creation: false,
    })
}

/// A draw's indirect arguments, its instance count 0 until a cull writes it.
pub fn indirect_args(d: &wgpu::Device, index_count: u32) -> wgpu::Buffer {
    d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("scene3d indirect draw"),
        contents: bytemuck::cast_slice(&[index_count, 0, 0, 0, 0]),
        usage: wgpu::BufferUsages::INDIRECT
            | wgpu::BufferUsages::COPY_DST
            | wgpu::BufferUsages::COPY_SRC,
    })
}

impl Culled {
    pub fn new(
        d: &wgpu::Device,
        kernels: &Kernels,
        records: &wgpu::Buffer,
        made_for: (u64, u32),
        index_count: u32,
        reversed: bool,
        kept: Option<(Source, &[u32])>,
    ) -> Culled {
        let n = made_for.1;
        let order: Vec<u32> = if reversed {
            (0..n).rev().collect()
        } else {
            (0..n).collect()
        };
        // Each element's row in this batch, by its row in the instancer.
        let kept = kept.map(|(source, elements)| {
            let mut row_of = vec![u32::MAX; elements.iter().max().map_or(1, |e| *e as usize + 1)];
            for (row, element) in elements.iter().enumerate() {
                row_of[*element as usize] = row as u32;
            }
            let map = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d element rows"),
                contents: bytemuck::cast_slice(&row_of),
                usage: wgpu::BufferUsages::STORAGE,
            });
            (source, map)
        });
        let flagged = kept.as_ref().map_or(n, |(s, _)| (s.rows.size() / 4) as u32);
        Culled {
            made_for,
            records: d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d element records"),
                layout: &kernels.records,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: records.as_entire_binding(),
                }],
            }),
            flags: storage(
                d,
                "scene3d cull flags",
                flagged,
                wgpu::BufferUsages::empty(),
            ),
            identity: match &kept {
                Some(_) => storage(
                    d,
                    "scene3d kept places",
                    flagged,
                    wgpu::BufferUsages::empty(),
                ),
                None => d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("scene3d cull rows"),
                    contents: bytemuck::cast_slice(&order),
                    usage: wgpu::BufferUsages::STORAGE,
                }),
            },
            index_count,
            flagged,
            kept,
            views: Default::default(),
        }
    }

    /// Whether it draws from an instances output.
    pub fn from_output(&self) -> bool {
        self.kept.is_some()
    }

    /// Makes view `k`'s list and arguments, which stay its own while this cull lasts.
    pub fn view(&mut self, d: &wgpu::Device, kernels: &Kernels, records: &wgpu::Buffer, k: usize) {
        if self.views[k].is_some() {
            return;
        }
        let n = self.made_for.1;
        let rows = storage(
            d,
            "scene3d culled rows",
            n,
            wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_SRC,
        );
        let count = storage(d, "scene3d culled count", 1, wgpu::BufferUsages::COPY_SRC);
        let params = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d cull params"),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        fn entry(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: buffer.as_entire_binding(),
            }
        }
        let mut entries = vec![entry(0, &params), entry(1, records), entry(2, &self.flags)];
        if let Some((source, row_of)) = &self.kept {
            entries.extend([
                entry(3, &source.rows),
                entry(4, &source.count),
                entry(5, row_of),
                entry(6, &self.identity),
            ]);
        }
        let pipeline = match self.kept {
            Some(_) => &kernels.kept,
            None => &kernels.pipeline,
        };
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d cull"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        let plan =
            kernels
                .structural
                .compact(d, &self.identity, &self.flags, &rows, &count, self.flagged);
        self.views[k] = Some(View {
            args: indirect_args(d, self.index_count),
            rows,
            count,
            params,
            bind,
            plan: Arc::new(plan),
            key: None,
        });
    }

    /// Makes view `k`'s list current for `clip` and the records at `revision`: the run that
    /// culls it when it's stale.
    #[allow(clippy::too_many_arguments)]
    pub fn cull(
        &mut self,
        device: &Device,
        kernels: &Kernels,
        records: &wgpu::Buffer,
        k: usize,
        clip: &[f64; 16],
        revision: u64,
        bounds: &[[f64; 3]; 2],
        plants: Plants,
        count_read_back: bool,
    ) -> Option<Run> {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        clip.map(f64::to_bits).hash(&mut h);
        revision.hash(&mut h);
        let key = h.finish();
        let d = &device.device;
        deep_gpu::alloc::outside(|| self.view(d, kernels, records, k));
        let n = self.flagged;
        let view = self.views[k].as_mut()?;
        // What an operator kept can change with no change the CPU sees.
        if view.key == Some(key) && self.kept.is_none() {
            return None;
        }
        view.key = Some(key);
        let [lo, hi] = bounds;
        let params = Params {
            planes: planes(clip).map(|q| q.map(|v| v as f32)),
            lo: [lo[0] as f32, lo[1] as f32, lo[2] as f32, 0.0],
            hi: [hi[0] as f32, hi[1] as f32, hi[2] as f32, 0.0],
            n,
            centers: u32::from(plants.centers),
            reversed: u32::from(plants.reversed),
            row_as_element: u32::from(plants.row_as_element),
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&view.params, 0, bytemuck::bytes_of(&params))
        });
        Some(Run {
            pipeline: match self.kept {
                Some(_) => kernels.kept.clone(),
                None => kernels.pipeline.clone(),
            },
            bind: view.bind.clone(),
            plan: view.plan.clone(),
            groups: n.div_ceil(WORKGROUP),
            count: view.count.clone(),
            args: (!count_read_back).then(|| view.args.clone()),
        })
    }

    /// View `k`'s list from the CPU's f64 cull: the reference a GPU frame is judged against.
    pub fn write_kept(
        &mut self,
        device: &Device,
        kernels: &Kernels,
        records: &wgpu::Buffer,
        k: usize,
        kept: &[u32],
    ) {
        deep_gpu::alloc::outside(|| {
            self.view(&device.device, kernels, records, k);
            if let Some(view) = &self.views[k] {
                device
                    .queue
                    .write_buffer(&view.rows, 0, bytemuck::cast_slice(kept));
                device.queue.write_buffer(
                    &view.args,
                    INSTANCE_COUNT,
                    bytemuck::bytes_of(&(kept.len() as u32)),
                );
            }
        });
    }
}
