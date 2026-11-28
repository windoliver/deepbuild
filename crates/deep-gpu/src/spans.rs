//! The GPU time of work a frame submits outside its own encode, read from timestamps (issue #2742;
//! canvas primitives: Meter and degrade ladder). While a [`Spans`] is armed on a thread, the first
//! submission that thread makes through [`crate::counted::Queue::submit`] while no span is open
//! begins one: a one-thread compute pass submitted just before its command buffers writes the
//! span's start. The span ends at [`done_with`], which names what all its work writes or feeds: a
//! one-thread pass reads a texel of it and writes the span's end ([`done_alone`] for a clear, which
//! ends only a span it began). A pass with no data dependency on the work runs beside it, not after
//! it, on a GPU whose passes overlap (Apple's do), so no end is written without one. The frame's
//! reading is the time its spans cover (their union, never their sum): the CPU's time between a
//! span's end and the next one's start counts in none, and a span left open over CPU work counts
//! it, which keeps the reading an upper bound. Past [`MAX_SPANS`] spans the last one stays open to
//! each later end. A span still open when the frame is read, or no pass timestamps, leaves no
//! reading, only the instant of the frame's first submission, from which the caller times the rest
//! on the CPU's clock.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::counted::Wgpu;
use crate::device::Device;

/// The spans a frame can time apart.
pub const MAX_SPANS: usize = 512;

thread_local! {
    static ARMED: RefCell<Option<Spans>> = const { RefCell::new(None) };
}

/// The spans armed on this thread, if any.
pub(crate) fn armed() -> Option<Spans> {
    ARMED.with(|a| a.borrow().clone())
}

/// Ends the span open on this thread once the GPU has written `view`, which all of its work
/// writes or feeds; with none open or none armed, nothing.
pub fn done_with(view: &wgpu::TextureView) {
    if let Some(spans) = armed() {
        spans.end(view, false);
    }
}

/// [`done_with`] for work that depends on nothing before it, such as a clear: it ends the open
/// span only when the submission just made began it, since `view` says nothing of other work.
pub fn done_alone(view: &wgpu::TextureView) {
    if let Some(spans) = armed() {
        spans.end(view, true);
    }
}

/// A frame's spans: shared, so the side that submits and the side that reads once the frame is
/// done hold the same ones.
#[derive(Clone)]
pub struct Spans(Arc<Mutex<Inner>>);

struct Inner {
    query: Option<Query>,
    /// Spans begun this frame, and the submissions the last one holds while it's open.
    n: usize,
    held: usize,
    /// When the frame's first submission was made.
    first: Option<Instant>,
}

struct Query {
    device: Wgpu,
    queue: wgpu::Queue,
    set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
    /// Where a mark writes the texel it read, so the read stays.
    sink: wgpu::Buffer,
    /// What a span's start reads: a texel of its own, which no work writes.
    own: wgpu::BindGroup,
    period_ns: f64,
}

/// What [`Spans::arm`] replaced on this thread, armed again when it drops.
pub struct Armed(Option<Spans>);

impl Drop for Armed {
    fn drop(&mut self) {
        let before = self.0.take();
        ARMED.with(|a| *a.borrow_mut() = before);
    }
}

pub const MARK: &str = "
    @group(0) @binding(0) var read: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read_write> sink: vec4f;
    @compute @workgroup_size(1) fn mark() { sink = textureLoad(read, vec2u(0u), 0); }";

impl Query {
    fn new(device: &Device, period_ns: f32) -> Query {
        let d = &device.device;
        let count = 2 * MAX_SPANS as u32;
        let buffer = |label, size, usage| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage,
                mapped_at_creation: false,
            })
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("span mark"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("span mark"),
            source: wgpu::ShaderSource::Wgsl(MARK.into()),
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("span mark"),
            layout: Some(&d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("span mark"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            })),
            module: &module,
            entry_point: Some("mark"),
            compilation_options: Default::default(),
            cache: None,
        });
        let own = d
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("span start"),
                size: wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let sink = buffer("span mark sink", 16, wgpu::BufferUsages::STORAGE);
        Query {
            own: bind(d, &layout, &sink, &own),
            device: d.clone(),
            queue: (*device.queue).clone(),
            set: d.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("spans"),
                ty: wgpu::QueryType::Timestamp,
                count,
            }),
            resolve: buffer(
                "span times",
                u64::from(count) * 8,
                wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            ),
            read: buffer(
                "span times read",
                u64::from(count) * 8,
                wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            ),
            layout,
            pipeline,
            sink,
            period_ns: f64::from(period_ns),
        }
    }

    /// A one-thread pass reading the texel `group` binds, writing its start or end at `index`.
    fn mark(&self, group: &wgpu::BindGroup, index: u32, start: bool) -> wgpu::CommandBuffer {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("span mark"),
                timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                    query_set: &self.set,
                    beginning_of_pass_write_index: start.then_some(index),
                    end_of_pass_write_index: (!start).then_some(index),
                }),
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, group, &[]);
            pass.dispatch_workgroups(1, 1, 1);
        }
        encoder.finish()
    }
}

impl Spans {
    pub fn new(device: &Device) -> Spans {
        Spans(Arc::new(Mutex::new(Inner {
            query: device.timestamps.period_ns.map(|p| Query::new(device, p)),
            n: 0,
            held: 0,
            first: None,
        })))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts a frame's spans and times this thread's submissions into them until the guard drops.
    pub fn arm(&self) -> Armed {
        let mut inner = self.lock();
        inner.n = 0;
        inner.held = 0;
        inner.first = None;
        drop(inner);
        Armed(ARMED.with(|a| a.borrow_mut().replace(self.clone())))
    }

    /// `buffers` submitted, after the start of a span if none is open.
    pub(crate) fn submit<I: IntoIterator<Item = wgpu::CommandBuffer>>(
        &self,
        queue: &wgpu::Queue,
        buffers: I,
    ) -> wgpu::SubmissionIndex {
        let mut inner = self.lock();
        inner.first.get_or_insert_with(Instant::now);
        let begins = inner.held == 0 && inner.n < MAX_SPANS;
        let start = match &inner.query {
            Some(q) if begins => Some(q.mark(&q.own, 2 * inner.n as u32, true)),
            _ => None,
        };
        if begins {
            inner.n += 1;
        }
        inner.held += 1;
        queue.submit(start.into_iter().chain(buffers))
    }

    /// The open span's end, once the GPU has written `view`; `alone`, only if it holds one
    /// submission.
    fn end(&self, view: &wgpu::TextureView, alone: bool) {
        let mut inner = self.lock();
        if inner.held == 0 || (alone && inner.held > 1) {
            return;
        }
        inner.held = 0;
        if let Some(q) = &inner.query {
            let group = bind(&q.device, &q.layout, &q.sink, view);
            let end = q.mark(&group, 2 * inner.n as u32 - 1, false);
            q.queue.submit([end]);
        }
    }

    /// When the frame's first submission was made, if it made one.
    pub fn first(&self) -> Option<Instant> {
        self.lock().first
    }

    /// Once the frame's work is done: the time its spans cover, in ms, resolved in a submission of
    /// its own (#239); `Some(0.0)` with no span, `None` without timestamps, with a span still open,
    /// or when the times didn't map or a span ends before it begins.
    pub fn covered_ms(&self) -> Option<f64> {
        self.spans_ms().map(|mut spans| union(&mut spans))
    }

    /// [`Spans::covered_ms`]'s spans, each its start and end in ms, in the order they began.
    fn spans_ms(&self) -> Option<Vec<[f64; 2]>> {
        let inner = self.lock();
        let q = inner.query.as_ref().filter(|_| inner.held == 0)?;
        if inner.n == 0 {
            return Some(Vec::new());
        }
        let count = 2 * inner.n as u32;
        let bytes = u64::from(count) * 8;
        let mut encoder = q.device.create_command_encoder(&Default::default());
        encoder.resolve_query_set(&q.set, 0..count, &q.resolve, 0);
        encoder.copy_buffer_to_buffer(&q.resolve, 0, &q.read, 0, bytes);
        q.queue.submit([encoder.finish()]);
        let slice = q.read.slice(..bytes);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = q.device.poll(wgpu::PollType::wait_indefinitely());
        let spans: Option<Vec<[f64; 2]>> = slice.get_mapped_range().ok().map(|data| {
            data.as_chunks::<16>()
                .0
                .iter()
                .map(|t| {
                    let tick = |b: &[u8]| u64::from_le_bytes(b.try_into().expect("8 bytes"));
                    [tick(&t[..8]), tick(&t[8..])].map(|k| k as f64 * q.period_ns / 1e6)
                })
                .collect()
        });
        q.read.unmap();
        let spans = spans?;
        if spans.iter().any(|[a, b]| b < a) {
            return None;
        }
        Some(spans)
    }
}

/// What a mark reads: a texel of `view`, written to `sink`.
fn bind(
    d: &Wgpu,
    layout: &wgpu::BindGroupLayout,
    sink: &wgpu::Buffer,
    view: &wgpu::TextureView,
) -> wgpu::BindGroup {
    d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("span mark"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: sink.as_entire_binding(),
            },
        ],
    })
}

/// The length of the union of `spans`.
fn union(spans: &mut [[f64; 2]]) -> f64 {
    spans.sort_unstable_by(|a, b| a[0].total_cmp(&b[0]));
    let (mut total, mut reach) = (0.0, f64::NEG_INFINITY);
    for &[a, b] in spans.iter() {
        total += (b - a.max(reach)).max(0.0);
        reach = reach.max(b);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::{done_with, union, Spans};
    use crate::device::{Backend, Device, Gpu};

    /// Spans that overlap count once, and a gap between two counts in neither.
    #[test]
    fn spans_cover_their_union() {
        let mut spans = [[4.0, 6.0], [0.0, 2.0], [1.0, 3.0], [5.0, 5.5]];
        assert_eq!(union(&mut spans), 5.0);
    }

    const SPIN: &str = "
        @vertex fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
            let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
            return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
        }
        @fragment fn spin(@builtin(position) p: vec4f) -> @location(0) vec4f {
            var x = fract(p.x * 0.001 + p.y * 0.002);
            for (var i = 0u; i < LOOPS; i++) { x = fract(x * 3.7 + 0.1234); }
            return vec4f(x, x, x, 1.0);
        }";

    /// One submission of a full-screen pass looping `loops` times a pixel, its own begin and end
    /// written into `query` at 0 and 1: the view it draws into.
    fn spin(dev: &Device, loops: u32, query: &wgpu::QuerySet) -> wgpu::TextureView {
        let (pass, view) = pass(dev, loops, query);
        dev.queue.submit([pass]);
        view
    }

    /// [`spin`]'s pass, not yet submitted.
    fn pass(
        dev: &Device,
        loops: u32,
        query: &wgpu::QuerySet,
    ) -> (wgpu::CommandBuffer, wgpu::TextureView) {
        let d = &dev.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(SPIN.replace("LOOPS", &format!("{loops}u")).into()),
        });
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("full"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("spin"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let target = d.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 1024,
                height: 1024,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = target.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                timestamp_writes: Some(wgpu::RenderPassTimestampWrites {
                    query_set: query,
                    beginning_of_pass_write_index: Some(0),
                    end_of_pass_write_index: Some(1),
                }),
                ..Default::default()
            });
            pass.set_pipeline(&pipeline);
            pass.draw(0..3, 0..1);
        }
        (encoder.finish(), view)
    }

    /// A pass's own two timestamps in ms, read once its work is done.
    fn own(dev: &Device, query: &wgpu::QuerySet) -> [f64; 2] {
        let d = &dev.device;
        let buffer = |usage| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 16,
                usage,
                mapped_at_creation: false,
            })
        };
        let resolve = buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC);
        let read = buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST);
        let mut encoder = d.create_command_encoder(&Default::default());
        encoder.resolve_query_set(query, 0..2, &resolve, 0);
        encoder.copy_buffer_to_buffer(&resolve, 0, &read, 0, 16);
        dev.queue.submit([encoder.finish()]);
        read.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let data = read.slice(..).get_mapped_range().expect("mapped");
        let tick = |b: &[u8]| u64::from_le_bytes(b.try_into().expect("8 bytes")) as f64;
        let period = f64::from(dev.timestamps.period_ns.expect("timestamps"));
        [tick(&data[..8]), tick(&data[8..])].map(|t| t * period / 1e6)
    }

    /// Two passes, the second submitted 200 ms after the first's work is done, while the spans are
    /// armed, each span ended by what its pass drew, in four trials: the spans cover the heavy
    /// pass's own timestamps to within 0.1 ms (a span's start trails its work's by the GPU's
    /// sampling grain at most, at rest), which a span end with no dependency on its pass misses by
    /// milliseconds (on this GPU it lands beside the pass in about half of trials); and the CPU's
    /// 200 ms between them counts in neither: the spans add less than half the gap to the passes'
    /// own time. Each trial states its readings.
    ///
    /// A span's end is a submission of its own, so on a GPU other processes share it can wait
    /// behind their work, and the span holds that wait (#3171: on the Spark, a second process's
    /// passes ran between the heavy pass and its span's end, and the span held each one whole).
    /// So right after each span's end, a one-pass witness of its own timestamps is submitted past
    /// the spans: it runs after that end, and it begins later than its pass ended only by the time
    /// the GPU spent on work this test didn't submit. A span's start goes in its pass's own
    /// submission, so any time from it to the pass's begin is others' work too. When the spans add
    /// half the gap, but no more than these waits (and 1 ms for the marks' own time, a fraction of a
    /// millisecond each at rest), the GPU was shared and the trial says nothing either way:
    /// INCONCLUSIVE. Any more than they waited is time the GPU wasn't running anyone's work, the
    /// gap: FAIL. The 200 ms start once the heavy pass's work is done, so others' work holding
    /// that pass back can't fill the gap and hide a span that counts it.
    #[test]
    fn a_span_holds_its_submission_and_not_the_gap_after_it() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        if dev.timestamps.period_ns.is_none() {
            return;
        }
        let query = || {
            dev.device.create_query_set(&wgpu::QuerySetDescriptor {
                label: None,
                ty: wgpu::QueryType::Timestamp,
                count: 2,
            })
        };
        let (heavy, light) = (query(), query());
        let witnesses = [query(), query()];
        // Past the spans: the device's own queue, which no span times.
        let witness = |query| (*dev.queue).submit([pass(&dev, 1, query).0]);
        let spans = Spans::new(&dev);
        let mut shared = None;
        for trial in 0..4 {
            {
                let _armed = spans.arm();
                done_with(&spin(&dev, 16384, &heavy));
                witness(&witnesses[0]);
                let _ = dev.device.poll(wgpu::PollType::wait_indefinitely());
                std::thread::sleep(std::time::Duration::from_millis(200));
                done_with(&spin(&dev, 1, &light));
                witness(&witnesses[1]);
            }
            let _ = dev.device.poll(wgpu::PollType::wait_indefinitely());
            let covered = spans.covered_ms().expect("the spans resolve");
            let (heavy, light) = (own(&dev, &heavy), own(&dev, &light));
            let took = heavy[1] - heavy[0];
            let own_time = union(&mut [heavy, light]);
            // Others' work the GPU ran while this test's work waited: after a pass, until the witness
            // submitted behind its span's end began; and before it, from its span's start, submitted
            // with it, to its own begin.
            let ends: f64 = [(heavy, &witnesses[0]), (light, &witnesses[1])]
                .into_iter()
                .map(|(pass, witness)| (own(&dev, witness)[0] - pass[1]).max(0.0))
                .sum();
            let starts: f64 = spans
                .spans_ms()
                .expect("the spans resolve")
                .iter()
                .zip([heavy, light])
                .map(|(span, pass)| (pass[0] - span[0]).max(0.0))
                .sum();
            let waited = ends + starts;
            println!(
                "trial {trial}: {covered} ms covered, the passes' own {own_time}; the heavy pass's \
                 own {took}; this test's work waited behind others' for {waited}"
            );
            assert!(took > 1.0, "the heavy pass takes {took} ms");
            assert!(
                covered >= took - 0.1,
                "trial {trial}: {covered} ms covered, the heavy pass's own timestamps span {took}"
            );
            if covered < own_time + 100.0 {
                continue;
            }
            assert!(
                covered - own_time <= waited + 1.0,
                "trial {trial}: {covered} ms covered, the passes' own {own_time}: the gap \
                 counted ({waited} ms of it was the GPU's on other work)"
            );
            shared.get_or_insert(format!(
                "trial {trial}: {covered} ms covered, the passes' own {own_time}; the GPU ran \
                 others' work for {waited} ms while this test's passes and their span ends waited"
            ));
        }
        if let Some(trial) = shared {
            panic!("INCONCLUSIVE: the GPU was shared, so the gap can't be told apart: {trial}");
        }
    }
}
