//! A GPU-layer view (canvas primitives: GPU surface; Render worker): one render module drawing
//! into a GPU surface's slots off the UI thread. The render side begins a frame in a free slot,
//! has the encode workers record its writer layers, submits them in frame order and learns from a
//! GPU callback, never a wait, that the slot is done. The UI side only latches the newest ready
//! slot and reports which GPUI command buffers sample it; that's all the UI thread spends on the
//! GPU layer.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::device::{Device, Gpu};
use crate::encode::{Encode, Pool};
use crate::render::{self, PassQuery, RenderModule, Target};
use crate::ring::{Mark, Ring, SlotState};
use crate::surface::{allocate, Handoff, Path, Shown};
use crate::upload::Uploads;

const MAX_TIMED_PASSES: u32 = 16;

#[derive(Clone, Debug)]
pub struct Config {
    pub path: Path,
    /// 2 or 3.
    pub slots: usize,
    pub size: [u32; 2],
    pub upload_bytes_per_frame: usize,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Per slot, what GPUI paints for it and the identity GPUI reports it by.
struct Table(Mutex<Vec<Option<(u64, Shown)>>>);

// SAFETY: `Shown` is a CoreVideo pixel buffer, whose retain, release and reads are thread-safe, or
// plain bytes; the lock guards the table itself.
unsafe impl Send for Table {}
unsafe impl Sync for Table {}

/// What the UI side holds: the ring and, per slot, the pixel buffer GPUI paints for it.
#[derive(Clone)]
pub struct Ui {
    ring: Arc<Mutex<Ring>>,
    shown: Arc<Table>,
    /// Time GPUI's commits spent here, on the UI thread, since it was last taken.
    committed_ns: Arc<AtomicU64>,
}

/// The identity GPUI's frame report gives a pixel buffer: its address.
#[cfg(target_os = "macos")]
pub fn identity(shown: &Shown) -> u64 {
    std::ptr::from_ref::<objc2_core_video::CVPixelBuffer>(shown) as usize as u64
}
#[cfg(not(target_os = "macos"))]
pub fn identity(shown: &Shown) -> u64 {
    Arc::as_ptr(shown) as usize as u64
}

impl Ui {
    /// The UI thread's latch: the slot to show this frame and the frame it holds.
    pub fn latch(&self) -> Option<(Shown, u64)> {
        let (slot, frame) = lock(&self.ring).latch()?;
        let shown = lock(&self.shown.0)[slot].as_ref().map(|(_, s)| s.clone())?;
        Some((shown, frame))
    }

    /// GPUI committed `buffer`, which samples these pixel buffers.
    pub fn committed(&self, buffer: u64, surfaces: &[u64]) {
        let started = Instant::now();
        {
            let table = lock(&self.shown.0);
            let mut ring = lock(&self.ring);
            for (slot, entry) in table.iter().enumerate() {
                if entry.as_ref().is_some_and(|(id, _)| surfaces.contains(id)) {
                    ring.sampled(slot, buffer);
                }
            }
        }
        let ns = started.elapsed().as_nanos() as u64;
        self.committed_ns.fetch_add(ns, Ordering::Relaxed);
    }

    /// The UI-thread time GPUI's commits spent here since this was last called.
    pub fn take_committed(&self) -> Duration {
        Duration::from_nanos(self.committed_ns.swap(0, Ordering::Relaxed))
    }

    /// Whether this is the same view's side as `other`.
    pub fn is(&self, other: &Ui) -> bool {
        Arc::ptr_eq(&self.ring, &other.ring)
    }

    /// Takes the newest frame off the ring with nothing to show it on (an offscreen render).
    pub fn retire(&self) {
        let mut ring = lock(&self.ring);
        ring.latch();
        ring.hide();
    }

    /// GPUI's `buffer` completed, after `gpu_ns` on the GPU.
    pub fn completed(&self, buffer: u64, gpu_ns: u64) {
        lock(&self.ring).completed(buffer, gpu_ns);
    }

    pub fn record(&self, on: bool) {
        lock(&self.ring).record(on);
    }

    pub fn take_record(&self) -> Vec<Mark> {
        lock(&self.ring).take_record()
    }

    /// The frame the view shows now, if any.
    pub fn shown_frame(&self) -> Option<u64> {
        lock(&self.ring).on_screen()
    }

    pub fn states(&self) -> Vec<SlotState> {
        let ring = lock(&self.ring);
        (0..ring.len()).map(|s| ring.state(s)).collect()
    }

    pub fn plant_early_release(&self) {
        lock(&self.ring).plant_early_release();
    }
}

/// One frame the render side drew.
#[derive(Clone, Debug)]
pub struct Drawn {
    pub frame: u64,
    pub slot: usize,
    pub size: [u32; 2],
    /// Uploads were still pending when it drew.
    pub settling: bool,
    pub encodes: Vec<Encode>,
}

/// When the GPU finished a slot's passes and when the slot was ready to show: the render side's
/// part of the handoff is the time between.
#[derive(Clone, Copy, Debug)]
pub struct Times {
    pub render_done: Instant,
    pub ready: Instant,
}

impl Times {
    pub fn handoff(&self) -> Duration {
        self.ready.saturating_duration_since(self.render_done)
    }
}

/// The draw-and-finish time of a frame and its four disjoint parts (#3617): from the start of
/// `View::render` to the slot being ready to show.
#[derive(Clone, Copy, Debug, Default)]
pub struct DrawParts {
    pub encode: Duration,
    pub submit: Duration,
    pub gpu: Duration,
    pub wait: Duration,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DrawTimes {
    pub total: Duration,
    pub parts: DrawParts,
}

struct PendingDraw {
    start: Instant,
    encode: Duration,
    submit: Duration,
    submit_end: Instant,
    query: Option<PassQuery>,
}

struct SlotQuery {
    set: Arc<wgpu::QuerySet>,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    period_ns: f64,
}

impl SlotQuery {
    fn new(device: &Device, period_ns: f32) -> Self {
        let d = &device.device;
        let count = 2 * MAX_TIMED_PASSES;
        let bytes = u64::from(count) * 8;
        let set = Arc::new(d.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("deep-gpu view passes"),
            ty: wgpu::QueryType::Timestamp,
            count,
        }));
        let resolve = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("deep-gpu view pass times"),
            size: bytes,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let read = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("deep-gpu view pass times read"),
            size: bytes,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Self {
            set,
            resolve,
            read,
            period_ns: f64::from(period_ns),
        }
    }

    fn resolve_duration(&self, device: &Device, passes: u32) -> Option<Duration> {
        if passes == 0 {
            return Some(Duration::ZERO);
        }
        let count = 2 * passes;
        let bytes = u64::from(count) * 8;
        let mut encoder = device.device.create_command_encoder(&Default::default());
        encoder.resolve_query_set(&self.set, 0..count, &self.resolve, 0);
        encoder.copy_buffer_to_buffer(&self.resolve, 0, &self.read, 0, bytes);
        device.queue.submit([encoder.finish()]);
        let slice = self.read.slice(..bytes);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
        let mut spans: Vec<[f64; 2]> = match slice.get_mapped_range() {
            Ok(data) => data
                .as_chunks::<16>()
                .0
                .iter()
                .filter_map(|t| {
                    let begin = u64::from_le_bytes(t[..8].try_into().ok()?);
                    let end = u64::from_le_bytes(t[8..].try_into().ok()?);
                    (end >= begin)
                        .then_some([begin as f64 * self.period_ns, end as f64 * self.period_ns])
                })
                .collect(),
            Err(_) => {
                self.read.unmap();
                return None;
            }
        };
        self.read.unmap();
        spans.sort_unstable_by(|a, b| a[0].total_cmp(&b[0]));
        let (mut total_ns, mut reach) = (0.0f64, f64::NEG_INFINITY);
        for [a, b] in spans {
            total_ns += (b - a.max(reach)).max(0.0);
            reach = reach.max(b);
        }
        Some(Duration::from_nanos(total_ns.round().max(0.0) as u64))
    }
}

enum Done {
    /// The layers' passes finished.
    Render,
    /// Everything submitted for the slot finished (the copy path's read-back included).
    All,
}

pub struct View {
    config: Config,
    gpu: Arc<Gpu>,
    device: Arc<Device>,
    ui: Ui,
    storage: Vec<Option<Box<dyn Handoff>>>,
    module: Box<dyn RenderModule>,
    /// The module's passes in frame order.
    plan: Vec<String>,
    pool: Pool,
    uploads: Uploads,
    done_tx: mpsc::Sender<(u64, usize, Done, Instant)>,
    done_rx: mpsc::Receiver<(u64, usize, Done, Instant)>,
    /// Per slot: the device epoch its frame was submitted on, while in flight.
    in_flight: Vec<Option<u64>>,
    render_done: Vec<Option<Instant>>,
    times: Vec<Option<Times>>,
    record_timings: bool,
    slot_queries: Vec<Option<SlotQuery>>,
    pending_draw: Vec<Option<PendingDraw>>,
    draw_queries: Vec<Option<PassQuery>>,
    draw_times: Vec<Option<DrawTimes>>,
    rebuilds: u64,
    /// The latency fault fixture: the next render's slot is held, and per slot whether it's held
    /// and whether its `gpu_done` came while it was.
    hold_next: bool,
    held: Vec<bool>,
    done_while_held: Vec<bool>,
    /// The planted allocator (#1413): resizes still to fail; and the merge base's render, which
    /// leaves a slot whose resize failed rendering.
    failing_resizes: u32,
    resize_leaves_rendering: bool,
}

impl View {
    pub fn new(
        gpu: Arc<Gpu>,
        config: Config,
        mut module: Box<dyn RenderModule>,
        pool: Pool,
    ) -> Result<Self, String> {
        let plan = render::plan(&module.passes())?;
        let device = gpu.recover()?;
        module.build(&device)?;
        let mut uploads = Uploads::new(config.upload_bytes_per_frame);
        for (buffer, data) in module.take_uploads() {
            uploads.queue(buffer, data);
        }
        let (done_tx, done_rx) = mpsc::channel();
        let n = config.slots;
        Ok(Self {
            ui: Ui {
                ring: Arc::new(Mutex::new(Ring::new(n, config.size))),
                shown: Arc::new(Table(Mutex::new(vec![None; n]))),
                committed_ns: Arc::new(AtomicU64::new(0)),
            },
            storage: (0..n).map(|_| None).collect(),
            in_flight: vec![None; n],
            render_done: vec![None; n],
            times: vec![None; n],
            record_timings: false,
            slot_queries: (0..n).map(|_| None).collect(),
            pending_draw: (0..n).map(|_| None).collect(),
            draw_queries: (0..n).map(|_| None).collect(),
            draw_times: vec![None; n],
            uploads,
            gpu,
            device,
            module,
            plan,
            pool,
            done_tx,
            done_rx,
            rebuilds: 0,
            hold_next: false,
            held: vec![false; n],
            done_while_held: vec![false; n],
            failing_resizes: 0,
            resize_leaves_rendering: false,
            config,
        })
    }

    pub fn ui(&self) -> Ui {
        self.ui.clone()
    }

    pub fn device(&self) -> &Arc<Device> {
        &self.device
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn module(&self) -> &dyn RenderModule {
        self.module.as_ref()
    }

    pub fn pool_mut(&mut self) -> &mut Pool {
        &mut self.pool
    }

    /// Enables or disables per-pass timestamp queries on rendered frames (#3617).
    pub fn record_timings(&mut self, on: bool) {
        self.record_timings = on;
    }

    fn pass_query(&mut self, slot: usize) -> Option<PassQuery> {
        let period = self.device.timestamps.period_ns?;
        let q = self.slot_queries[slot].get_or_insert_with(|| SlotQuery::new(&self.device, period));
        Some(PassQuery::new(q.set.clone(), MAX_TIMED_PASSES))
    }

    /// Whether each slot has storage on the current device.
    pub fn slots_built(&self) -> Vec<bool> {
        self.storage.iter().map(Option::is_some).collect()
    }

    /// How many times a lost device was rebuilt.
    pub fn rebuilds(&self) -> u64 {
        self.rebuilds
    }

    pub fn resize(&mut self, size: [u32; 2]) {
        if self.config.size != size {
            self.config.size = size;
            lock(&self.ui.ring).resize(size);
        }
    }

    /// Loses the device on purpose (the forced device-loss tests).
    pub fn lose_device(&self) {
        self.device.force_loss();
    }

    /// Rebuilds on the app's current device if the view's was lost or replaced.
    pub fn recover(&mut self) -> Result<(), String> {
        if self.device.is_lost() || self.gpu.epoch() != self.device.epoch {
            self.rebuild()?;
        }
        Ok(())
    }

    /// After a loss: the app's new device and every declared resource built again on it, the
    /// slots' storage included. What's on screen stays until a new frame is ready.
    fn rebuild(&mut self) -> Result<(), String> {
        let device = self.gpu.recover()?;
        self.module.build(&device)?;
        self.uploads.clear();
        for (buffer, data) in self.module.take_uploads() {
            self.uploads.queue(buffer, data);
        }
        {
            let mut ring = lock(&self.ui.ring);
            for (slot, f) in self.in_flight.iter_mut().enumerate() {
                if f.take().is_some() {
                    ring.abandon(slot);
                }
            }
        }
        self.device = device;
        for q in &mut self.slot_queries {
            *q = None;
        }
        for p in &mut self.pending_draw {
            *p = None;
        }
        for q in &mut self.draw_queries {
            *q = None;
        }
        self.draw_times.fill(None);
        let states = self.ui.states();
        for (slot, state) in states.into_iter().enumerate() {
            // A slot on screen keeps its old pixel buffer in GPUI's hands until it's released,
            // and is reallocated when it's next drawn.
            self.storage[slot] = None;
            if state == SlotState::Free {
                self.reallocate(slot)?;
            }
        }
        self.rebuilds += 1;
        Ok(())
    }

    /// The planted allocator fails the next `n` allocations of a slot's storage at a new size.
    pub fn fail_resizes(&mut self, n: u32) {
        self.failing_resizes = n;
    }

    /// The merge base's resize: a failed allocation leaves its slot rendering.
    pub fn plant_resize_leaves_rendering(&mut self) {
        self.resize_leaves_rendering = true;
    }

    /// Makes a free slot's storage at the current size, outside every lock the UI thread takes.
    fn reallocate(&mut self, slot: usize) -> Result<(), String> {
        let resize = self.storage[slot]
            .as_ref()
            .is_some_and(|s| s.size() != self.config.size);
        if resize && self.failing_resizes > 0 {
            self.failing_resizes -= 1;
            return Err(format!(
                "the planted allocator failed slot {slot}'s storage at {:?}",
                self.config.size
            ));
        }
        let storage = allocate(&self.device, self.config.path, self.config.size)?;
        let shown = storage.shown();
        let entry = (identity(&shown), shown);
        self.storage[slot] = Some(storage);
        lock(&self.ui.shown.0)[slot] = Some(entry);
        Ok(())
    }

    /// Begins `frame` in a free slot, encodes and submits it; `None` when no slot is free. Never
    /// waits on the GPU.
    pub fn render(&mut self, frame: u64) -> Result<Option<Drawn>, String> {
        let start = Instant::now();
        self.recover()?;
        if self.in_flight.iter().any(Option::is_some) {
            let _ = self.device.device.poll(wgpu::PollType::Poll);
        }
        self.collect();
        let Some((slot, stale)) = lock(&self.ui.ring).begin(frame) else {
            return Ok(None);
        };
        self.held[slot] = std::mem::take(&mut self.hold_next);
        self.done_while_held[slot] = false;
        let size = self.config.size;
        if stale || self.storage[slot].as_ref().is_none_or(|s| s.size() != size) {
            // A failed allocation gives its slot back (#1413): on a healthy device the next
            // frame tries again, and a lost device takes the reopen path at the next `recover`.
            if let Err(e) = self.reallocate(slot) {
                if !self.resize_leaves_rendering {
                    lock(&self.ui.ring).abandon(slot);
                }
                return Err(e);
            }
        }
        let pass_query = if self.record_timings {
            self.pass_query(slot)
        } else {
            None
        };
        let storage = self.storage[slot].as_ref().expect("allocated above");
        let target = Target {
            frame,
            size,
            view: storage.target().clone(),
            pass_query: pass_query.clone(),
        };
        let settling = self.uploads.flush(&self.device.queue);
        let mut raw_layers = self.module.layers(&self.device, &target);
        let jobs = if raw_layers.len() == 1 && self.plan.len() == 1 {
            let (name, job) = raw_layers.pop().expect("one layer");
            if name != self.plan[0] {
                lock(&self.ui.ring).abandon(slot);
                return Err(format!(
                    "undeclared_pass: `{name}` isn't one of {}'s passes",
                    self.module.name()
                ));
            }
            vec![job]
        } else {
            let mut keyed = Vec::with_capacity(raw_layers.len());
            for (name, job) in raw_layers {
                let Some(at) = self.plan.iter().position(|n| *n == name) else {
                    lock(&self.ui.ring).abandon(slot);
                    return Err(format!(
                        "undeclared_pass: `{name}` isn't one of {}'s passes",
                        self.module.name()
                    ));
                };
                keyed.push((at, job));
            }
            keyed.sort_by_key(|(at, _)| *at);
            keyed.into_iter().map(|(_, job)| job).collect()
        };
        let before_pool = Instant::now();
        let (encodes, pool_encode, pool_submit) =
            self.pool
                .run_timed(&self.device.device, &self.device.queue, jobs);
        let after_pool = Instant::now();
        let epoch = self.device.epoch;
        let (encode, submit, submit_end) = if storage.needs_after_render() {
            let tx = self.done_tx.clone();
            self.device.queue.on_submitted_work_done(move || {
                let _ = tx.send((epoch, slot, Done::Render, Instant::now()));
            });
            let after_enc_start = Instant::now();
            let mut encoder = self
                .device
                .device
                .create_command_encoder(&Default::default());
            storage.after_render(&mut encoder);
            let after_buf = encoder.finish();
            let after_submit_start = Instant::now();
            self.device.queue.submit([after_buf]);
            let tx = self.done_tx.clone();
            self.device.queue.on_submitted_work_done(move || {
                let _ = tx.send((epoch, slot, Done::All, Instant::now()));
            });
            let submit_end = Instant::now();
            let encode = before_pool.saturating_duration_since(start)
                + pool_encode
                + after_submit_start.saturating_duration_since(after_enc_start);
            let submit = pool_submit
                + after_enc_start.saturating_duration_since(after_pool)
                + submit_end.saturating_duration_since(after_submit_start);
            (encode, submit, submit_end)
        } else {
            // Zero copy needs no read-back command buffer (#3617): one submission and one
            // completion signal per frame.
            let tx = self.done_tx.clone();
            self.device.queue.on_submitted_work_done(move || {
                let _ = tx.send((epoch, slot, Done::All, Instant::now()));
            });
            let submit_end = Instant::now();
            let encode = before_pool.saturating_duration_since(start) + pool_encode;
            let submit = pool_submit + submit_end.saturating_duration_since(after_pool);
            (encode, submit, submit_end)
        };
        self.in_flight[slot] = Some(epoch);
        self.render_done[slot] = None;
        self.times[slot] = None;
        self.draw_times[slot] = None;
        self.draw_queries[slot] = None;
        self.pending_draw[slot] = Some(PendingDraw {
            start,
            encode,
            submit,
            submit_end,
            query: pass_query,
        });
        Ok(Some(Drawn {
            frame,
            slot,
            size,
            settling,
            encodes,
        }))
    }

    /// Turns slots the GPU finished into ready ones; the copy path reads its slot back here.
    pub fn collect(&mut self) {
        while let Ok((epoch, slot, done, at)) = self.done_rx.try_recv() {
            if self.in_flight[slot] != Some(epoch) || epoch != self.device.epoch {
                continue;
            }
            match done {
                Done::Render => self.render_done[slot] = Some(at),
                Done::All => {
                    self.in_flight[slot] = None;
                    let render_done = self.render_done[slot].unwrap_or(at);
                    if let Some(storage) = self.storage[slot].as_ref() {
                        if storage.finish(&self.device).is_err() {
                            self.pending_draw[slot] = None;
                            lock(&self.ui.ring).abandon(slot);
                            continue;
                        }
                    }
                    let ready = Instant::now();
                    self.times[slot] = Some(Times { render_done, ready });
                    if let Some(pending) = self.pending_draw[slot].take() {
                        let total = ready.saturating_duration_since(pending.start);
                        let post_submit = ready.saturating_duration_since(pending.submit_end);
                        self.draw_queries[slot] = pending.query;
                        self.draw_times[slot] = Some(DrawTimes {
                            total,
                            parts: DrawParts {
                                encode: pending.encode,
                                submit: pending.submit,
                                gpu: Duration::ZERO,
                                wait: post_submit,
                            },
                        });
                    }
                    if self.held[slot] {
                        self.done_while_held[slot] = true;
                    } else {
                        lock(&self.ui.ring).gpu_done(slot);
                    }
                }
            }
        }
    }

    /// Off the UI thread: waits until `slot`'s frame is done (the virtual clock's wait for the
    /// GPU, never the UI thread's). False if the device was lost before it finished.
    pub fn wait_done(&mut self, slot: usize) -> bool {
        // On Metal, `PollType::Poll` reads `MTLCommandBuffer::status()` directly in this thread,
        // avoiding the background GCD completion-queue hop that `wait_indefinitely()` pays on
        // sub-millisecond frames (#3617); longer frames fall back to a blocking wait.
        let spin_until = Instant::now() + Duration::from_micros(500);
        while self.in_flight[slot].is_some() {
            if self.device.is_lost() {
                return false;
            }
            if Instant::now() < spin_until {
                let _ = self.device.device.poll(wgpu::PollType::Poll);
                self.collect();
                if self.in_flight[slot].is_some() {
                    std::hint::spin_loop();
                }
            } else {
                let _ = self.device.device.poll(wgpu::PollType::wait_indefinitely());
                self.collect();
            }
        }
        true
    }

    /// Off the UI thread: waits until a slot is free for the next frame, as GPUI completes the
    /// command buffers that read the others.
    pub fn wait_free(&mut self) {
        let start = Instant::now();
        while !self.ui.states().contains(&SlotState::Free)
            && start.elapsed() < Duration::from_secs(10)
        {
            std::thread::sleep(Duration::from_micros(50));
        }
    }

    /// A fault fixture (#378's `latency`): the next frame's slot is held not ready, its
    /// `gpu_done` withheld from the ring, until [`View::release`].
    pub fn hold_next(&mut self) {
        self.hold_next = true;
    }

    /// Ends a hold: a slot whose GPU work already finished turns ready now.
    pub fn release(&mut self, slot: usize) {
        self.held[slot] = false;
        if std::mem::take(&mut self.done_while_held[slot]) {
            lock(&self.ui.ring).gpu_done(slot);
        }
    }

    pub fn times(&self, slot: usize) -> Option<Times> {
        self.times[slot]
    }

    /// Resolves pass timestamps for `slot` once the slot's frame has finished, splitting the
    /// post-submit time into `gpu` and `wait` without adding query resolution to `draw_times`.
    pub fn resolve_gpu_time(&mut self, slot: usize) {
        let Some(pass_query) = self.draw_queries[slot].take() else {
            return;
        };
        let Some(slot_query) = self.slot_queries[slot].as_ref() else {
            return;
        };
        let Some(gpu_dur) = slot_query.resolve_duration(&self.device, pass_query.count()) else {
            return;
        };
        if let Some(dt) = self.draw_times[slot].as_mut() {
            let post = dt.parts.gpu + dt.parts.wait;
            dt.parts.gpu = gpu_dur.min(post);
            dt.parts.wait = post.saturating_sub(dt.parts.gpu);
        }
    }

    pub fn draw_times(&self, slot: usize) -> Option<DrawTimes> {
        self.draw_times[slot]
    }

    /// The bytes a slot holds now, as GPUI samples them.
    pub fn read(&self, slot: usize) -> Option<Vec<u8>> {
        self.storage[slot].as_ref().map(|s| s.read())
    }
}
