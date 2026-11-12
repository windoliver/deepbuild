//! The shipped multi-dispatch steps on wgpu (issue #483; canvas primitives: Step and the closed
//! step list: structural steps): `scan(add)`, `compact(flag)` and `sort_by_key`, each a plan of
//! dispatches over buffers made once for its count and recorded into the frame's compute pass.
//! The WGSL is `structural.wgsl`, reviewed with the app; its results depend only on their inputs.


const SOURCE: &str = include_str!("structural.wgsl");
/// Elements a workgroup covers.
pub const TILE: u32 = 1024;
/// The longest a sort, scan or compaction runs (canvas primitives: structural steps).
pub const MAX_COUNT: u32 = 1_048_576;
/// Elements a compaction's workgroup covers.
const COMPACT_TILE: u32 = 2048;
/// Elements a sort's workgroup covers.
const SORT_TILE: u32 = 2048;
/// Bits per radix pass, and passes over a u32 key.
const RADIX: u32 = 8;
const DIGITS: u32 = 1 << RADIX;
const PASSES: u32 = 32 / RADIX;

/// The pipelines, built once per device.
pub struct Structural {
    scan_tile: wgpu::ComputePipeline,
    scan_add: wgpu::ComputePipeline,
    compact_count: wgpu::ComputePipeline,
    compact: wgpu::ComputePipeline,
    hist: wgpu::ComputePipeline,
    offsets: wgpu::ComputePipeline,
    scatter: wgpu::ComputePipeline,
    dispatch_args: wgpu::ComputePipeline,
}

/// One dispatch: its pipeline's bind group and workgroup count, recorded in order.
struct Dispatch {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    groups: u32,
}

/// A step's dispatches over its own buffers, recorded each time its operator runs.
pub struct Plan {
    dispatches: Vec<Dispatch>,
    /// Buffers cleared to 0 before the first dispatch, so nothing a step leaves unwritten reads
    /// as an earlier run's.
    clears: Vec<wgpu::Buffer>,
    _keep: Vec<wgpu::Buffer>,
}

fn storage(d: &crate::counted::Wgpu, label: &str, words: u32) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: u64::from(words.max(1)) * 4,
        usage: wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_SRC
            | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

fn params(d: &crate::counted::Wgpu, n: u32, arg: u32, tiles: u32) -> wgpu::Buffer {
    let bytes: Vec<u8> = [n, arg, tiles, 0]
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .collect();
    d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("structural params"),
        contents: &bytes,
        usage: wgpu::BufferUsages::UNIFORM,
    })
}

impl Structural {
    pub fn new(d: &crate::counted::Wgpu) -> Structural {
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("structural steps"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipe = |entry: &str, zero_initialize_workgroup_memory: bool| {
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: wgpu::PipelineCompilationOptions {
                    zero_initialize_workgroup_memory,
                    ..Default::default()
                },
                cache: None,
            })
        };
        // The compaction's and the sort's entry points write every word of their workgroup
        // memory before reading it, so they skip its zeroing: on Metal one invocation zeroes it
        // all while the rest wait, which cost more than the sort's work.
        Structural {
            scan_tile: pipe("scan_tile", true),
            scan_add: pipe("scan_add", true),
            compact_count: pipe("compact_count", false),
            compact: pipe("compact_scatter", false),
            hist: pipe("sort_hist", false),
            offsets: pipe("sort_offsets", false),
            scatter: pipe("sort_scatter", false),
            dispatch_args: pipe("dispatch_args", true),
        }
    }

    fn dispatch(
        &self,
        d: &crate::counted::Wgpu,
        pipeline: &wgpu::ComputePipeline,
        params: &wgpu::Buffer,
        buffers: &[&wgpu::Buffer],
        groups: u32,
    ) -> Dispatch {
        let mut entries = vec![wgpu::BindGroupEntry {
            binding: 0,
            resource: params.as_entire_binding(),
        }];
        for (k, b) in buffers.iter().enumerate() {
            entries.push(wgpu::BindGroupEntry {
                binding: k as u32 + 1,
                resource: b.as_entire_binding(),
            });
        }
        Dispatch {
            pipeline: pipeline.clone(),
            group: d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("structural step"),
                layout: &pipeline.get_bind_group_layout(0),
                entries: &entries,
            }),
            groups: groups.max(1),
        }
    }

    /// The exclusive scan of `n` words of `src` into `dst`; `flags` reads each word as 0 or 1.
    fn scan_into(
        &self,
        d: &crate::counted::Wgpu,
        plan: &mut Plan,
        src: &wgpu::Buffer,
        dst: &wgpu::Buffer,
        n: u32,
        flags: bool,
    ) {
        let tiles = n.div_ceil(TILE).max(1);
        let sums = storage(d, "scan sums", tiles);
        let p = params(d, n, u32::from(flags), tiles);
        plan.dispatches
            .push(self.dispatch(d, &self.scan_tile, &p, &[src, dst, &sums], tiles));
        if tiles > 1 {
            let scanned = storage(d, "scan sums scanned", tiles);
            self.scan_into(d, plan, &sums, &scanned, tiles, false);
            plan.dispatches
                .push(self.dispatch(d, &self.scan_add, &p, &[&scanned, dst], tiles));
            plan._keep.push(scanned);
        }
        plan._keep.extend([sums, p]);
    }

    /// `scan {in, op: add}` over `n` words (u32 or i32: a wrapping add is the same bits).
    pub fn scan(&self, d: &crate::counted::Wgpu, src: &wgpu::Buffer, dst: &wgpu::Buffer, n: u32) -> Plan {
        let mut plan = Plan::new();
        plan.clears.push(dst.clone());
        self.scan_into(d, &mut plan, src, dst, n, false);
        plan
    }

    /// `compact {in, flag, count}`: the flagged words of `src` in index order into `out`, their
    /// count into `count`'s first word.
    pub fn compact(
        &self,
        d: &crate::counted::Wgpu,
        src: &wgpu::Buffer,
        flag: &wgpu::Buffer,
        out: &wgpu::Buffer,
        count: &wgpu::Buffer,
        n: u32,
    ) -> Plan {
        let mut plan = Plan::new();
        plan.clears.extend([out.clone(), count.clone()]);
        if n > 0 {
            // Each tile's flagged count, scanned into its start; the scatter rescans its tile.
            let tiles = n.div_ceil(COMPACT_TILE);
            let sums = storage(d, "compact counts", tiles);
            let starts = storage(d, "compact starts", tiles);
            let p = params(d, n, 0, tiles);
            plan.dispatches
                .push(self.dispatch(d, &self.compact_count, &p, &[flag, &sums], tiles));
            self.scan_into(d, &mut plan, &sums, &starts, tiles, false);
            plan.dispatches.push(self.dispatch(
                d,
                &self.compact,
                &p,
                &[src, flag, &starts, out, count],
                tiles,
            ));
            plan._keep.extend([sums, starts, p]);
        }
        plan
    }

    /// An indirect dispatch's arguments (#484): the workgroups of `workgroup` invocations that
    /// `count`'s first word needs, capped at `max`, into `args`, on the GPU.
    pub fn dispatch_args(
        &self,
        d: &crate::counted::Wgpu,
        count: &wgpu::Buffer,
        args: &wgpu::Buffer,
        workgroup: u32,
        max: u32,
    ) -> Plan {
        let mut plan = Plan::new();
        let p = params(d, workgroup, max, 0);
        plan.dispatches
            .push(self.dispatch(d, &self.dispatch_args, &p, &[count, args], 1));
        plan._keep.push(p);
        plan
    }

    /// `sort_by_key {keys, values, count}`: `n` (key, value) pairs sorted by key, equal keys in
    /// index order, the values into `values_out` and the keys into `keys_out`.
    pub fn sort_by_key(
        &self,
        d: &crate::counted::Wgpu,
        keys: &wgpu::Buffer,
        values: &wgpu::Buffer,
        keys_out: &wgpu::Buffer,
        values_out: &wgpu::Buffer,
        n: u32,
    ) -> Plan {
        let mut plan = Plan::new();
        let tiles = n.div_ceil(SORT_TILE).max(1);
        // Each tile's start of each digit, of each 4-bit half of it, and each (digit, tile)'s
        // offset less that start.
        let starts = storage(d, "sort starts", tiles * DIGITS);
        let nibs = storage(d, "sort half starts", tiles * 32);
        let offsets = storage(d, "sort offsets", tiles * DIGITS);
        let (ka, va) = (storage(d, "sort keys", n), storage(d, "sort values", n));
        // Pass k reads `from` and writes `to`: the input, then the two scratch pairs in turn, the
        // last pass into the outputs.
        let mut from = (keys.clone(), values.clone());
        for pass in 0..PASSES {
            let to = if pass % 2 == 0 {
                (ka.clone(), va.clone())
            } else {
                (keys_out.clone(), values_out.clone())
            };
            let p = params(d, n, pass * RADIX, tiles);
            plan.dispatches.push(self.dispatch(
                d,
                &self.hist,
                &p,
                &[&from.0, &starts, &nibs],
                tiles,
            ));
            plan.dispatches
                .push(self.dispatch(d, &self.offsets, &p, &[&starts, &offsets], DIGITS));
            plan.dispatches.push(self.dispatch(
                d,
                &self.scatter,
                &p,
                &[&from.0, &from.1, &offsets, &nibs, &to.0, &to.1],
                tiles,
            ));
            plan._keep.push(p);
            from = to;
        }
        plan._keep.extend([starts, nibs, offsets, ka, va]);
        plan
    }
}

impl Plan {
    fn new() -> Plan {
        Plan {
            dispatches: Vec::new(),
            clears: Vec::new(),
            _keep: Vec::new(),
        }
    }

    /// Dispatches this plan makes each time it runs.
    pub fn dispatch_count(&self) -> usize {
        self.dispatches.len()
    }

    /// Records the plan: its clears, then its dispatches in one compute pass.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        self.clear(encoder);
        self.dispatch(encoder, None);
    }

    /// Clears what the plan writes to its declared clear value, 0. A frame records every clear
    /// before its passes: on Metal a pass's timestamps read 0 right after a clear.
    pub fn clear(&self, encoder: &mut wgpu::CommandEncoder) {
        for b in &self.clears {
            encoder.clear_buffer(b, 0, None);
        }
    }

    /// Records the plan's dispatches, a compute pass each. With `stamps` (a query set and its
    /// first free index), each pass writes its own beginning and end, two queries a dispatch
    /// ([`Plan::queries`]): summed, they are the step's GPU time, never another process's work
    /// between its passes on a shared GPU.
    pub fn dispatch(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        stamps: Option<(&wgpu::QuerySet, u32)>,
    ) {
        for (k, d) in self.dispatches.iter().enumerate() {
            let writes = stamps.map(|(set, at)| wgpu::ComputePassTimestampWrites {
                query_set: set,
                beginning_of_pass_write_index: Some(at + 2 * k as u32),
                end_of_pass_write_index: Some(at + 2 * k as u32 + 1),
            });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("structural step"),
                timestamp_writes: writes,
            });
            pass.set_pipeline(&d.pipeline);
            pass.set_bind_group(0, &d.group, &[]);
            pass.dispatch_workgroups(d.groups, 1, 1);
        }
    }

    /// Timestamp queries [`Plan::dispatch`] writes.
    pub fn queries(&self) -> u32 {
        2 * self.dispatches.len() as u32
    }

    /// Records the plan's dispatches timed as one under a meter's `writes` ([`spanned`]).
    pub fn dispatch_spanned(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        writes: Option<wgpu::ComputePassTimestampWrites<'_>>,
    ) {
        let last = self.dispatches.len().saturating_sub(1);
        for (k, d) in self.dispatches.iter().enumerate() {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("structural step"),
                timestamp_writes: spanned(writes.as_ref(), k, last),
            });
            pass.set_pipeline(&d.pipeline);
            pass.set_bind_group(0, &d.group, &[]);
            pass.dispatch_workgroups(d.groups, 1, 1);
        }
    }
}

/// A run of compute passes timed as one under a meter's `writes`: the first pass writes its
/// beginning, the last its end.
pub fn spanned<'a>(
    writes: Option<&wgpu::ComputePassTimestampWrites<'a>>,
    k: usize,
    last: usize,
) -> Option<wgpu::ComputePassTimestampWrites<'a>> {
    let w = writes?;
    let begin = if k == 0 {
        w.beginning_of_pass_write_index
    } else {
        None
    };
    let end = if k == last {
        w.end_of_pass_write_index
    } else {
        None
    };
    (begin.is_some() || end.is_some()).then_some(wgpu::ComputePassTimestampWrites {
        query_set: w.query_set,
        beginning_of_pass_write_index: begin,
        end_of_pass_write_index: end,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{Backend, Gpu};

    fn upload(d: &crate::counted::Wgpu, words: &[u32]) -> wgpu::Buffer {
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("test input"),
            contents: &bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        })
    }

    fn read(dev: &crate::device::Device, b: &wgpu::Buffer, n: u32) -> Vec<u32> {
        let d = &dev.device;
        let back = d.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: u64::from(n.max(1)) * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = d.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(b, 0, &back, 0, u64::from(n.max(1)) * 4);
        dev.queue.submit([enc.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let v = back
            .slice(..)
            .get_mapped_range()
            .unwrap()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect::<Vec<_>>();
        v[..n as usize].to_vec()
    }

    fn run(dev: &crate::device::Device, plan: &Plan) {
        let mut enc = dev.device.create_command_encoder(&Default::default());
        plan.record(&mut enc);
        dev.queue.submit([enc.finish()]);
    }

    fn rng(seed: u32, n: usize) -> Vec<u32> {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x
            })
            .collect()
    }

    #[test]
    fn scan_compact_sort_match_the_cpu() {
        let Ok(gpu) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = gpu.device();
        let d = &dev.device;
        let s = Structural::new(d);
        for n in [1u32, 1000, 1024, 1025, 1_000_003, 1_048_576] {
            let x = rng(n, n as usize);
            let src = upload(d, &x);
            let dst = storage(d, "dst", n);
            run(&dev, &s.scan(d, &src, &dst, n));
            let mut acc = 0u32;
            let want: Vec<u32> = x
                .iter()
                .map(|v| {
                    let o = acc;
                    acc = acc.wrapping_add(*v);
                    o
                })
                .collect();
            assert_eq!(read(&dev, &dst, n), want, "scan {n}");
            let flags: Vec<u32> = x.iter().map(|v| u32::from(v % 10 < 3)).collect();
            let fb = upload(d, &flags);
            let (out, count) = (storage(d, "out", n), storage(d, "count", 1));
            run(&dev, &s.compact(d, &src, &fb, &out, &count, n));
            let kept: Vec<u32> = x
                .iter()
                .zip(&flags)
                .filter(|(_, f)| **f != 0)
                .map(|(v, _)| *v)
                .collect();
            assert_eq!(
                read(&dev, &count, 1)[0] as usize,
                kept.len(),
                "compact count {n}"
            );
            assert_eq!(read(&dev, &out, kept.len() as u32), kept, "compact {n}");
            let keys: Vec<u32> = x.iter().map(|v| v % (n / 10 + 1)).collect();
            let vals: Vec<u32> = (0..n).collect();
            let (kb, vb) = (upload(d, &keys), upload(d, &vals));
            let (ko, vo) = (storage(d, "ko", n), storage(d, "vo", n));
            run(&dev, &s.sort_by_key(d, &kb, &vb, &ko, &vo, n));
            let mut pairs: Vec<(u32, u32)> =
                keys.iter().copied().zip(vals.iter().copied()).collect();
            pairs.sort_by_key(|p| p.0);
            assert_eq!(
                read(&dev, &vo, n),
                pairs.iter().map(|p| p.1).collect::<Vec<_>>(),
                "sort {n}"
            );
        }
    }
}

#[cfg(test)]
mod timing {
    use super::*;
    use crate::device::{Backend, Gpu};

    fn gpu_ms(dev: &crate::device::Device, plan: &Plan) -> f64 {
        let d = &dev.device;
        let q = plan.queries();
        let set = d.create_query_set(&wgpu::QuerySetDescriptor {
            label: None,
            ty: wgpu::QueryType::Timestamp,
            count: q,
        });
        let bytes = u64::from(q) * 8;
        let res = d.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: bytes,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let back = d.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = d.create_command_encoder(&Default::default());
        plan.dispatch(&mut enc, Some((&set, 0)));
        let tail = d.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let tv = tail.create_view(&Default::default());
        drop(enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &tv,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::RED),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        }));
        enc.resolve_query_set(&set, 0..q, &res, 0);
        enc.copy_buffer_to_buffer(&res, 0, &back, 0, bytes);
        dev.queue.submit([enc.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let t: Vec<u64> = back
            .slice(..)
            .get_mapped_range()
            .unwrap()
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| u64::from_le_bytes(*b))
            .collect();
        let bad = t.chunks(2).filter(|w| w[1] < w[0] || w[0] == 0).count();
        if bad > 0 {
            eprintln!("{bad} bad pairs of {}", t.len() / 2);
        }
        t.chunks(2)
            .map(|w| w[1].saturating_sub(w[0]) as f64)
            .sum::<f64>()
            * f64::from(dev.queue.get_timestamp_period())
            / 1e6
    }

    #[test]
    #[ignore]
    fn timings() {
        let gpu = Gpu::open(Backend::Gpu).unwrap();
        let dev = gpu.device();
        let d = &dev.device;
        let s = Structural::new(d);
        let n = MAX_COUNT;
        let a = storage(d, "a", n);
        let b = storage(d, "b", n);
        let c = storage(d, "c", n);
        let e = storage(d, "e", n);
        let one = storage(d, "one", 1);
        let plans = [
            ("scan", s.scan(d, &a, &b, n)),
            ("compact", s.compact(d, &a, &b, &c, &one, n)),
            ("sort", s.sort_by_key(d, &a, &b, &c, &e, n)),
        ];
        for (name, p) in &plans {
            let wall = |reps: usize| {
                let mut enc = d.create_command_encoder(&Default::default());
                for _ in 0..reps {
                    p.record(&mut enc);
                }
                let t0 = std::time::Instant::now();
                dev.queue.submit([enc.finish()]);
                let _ = d.poll(wgpu::PollType::wait_indefinitely());
                t0.elapsed().as_secs_f64() * 1e3
            };
            wall(2);
            let mut per: Vec<f64> = (0..5).map(|_| (wall(21) - wall(1)) / 20.0).collect();
            per.sort_by(f64::total_cmp);
            eprintln!(
                "{name}: per run {:.3} ms (min {:.3}), dispatches {}, ts {:.3}",
                per[2],
                per[0],
                p.dispatch_count(),
                gpu_ms(&dev, p)
            );
        }
    }
}
