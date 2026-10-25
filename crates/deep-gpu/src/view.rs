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
use crate::render::{self, RenderModule, Target};
use crate::ring::{Mark, Ring, SlotState};
use crate::surface::{allocate, Handoff, Path, Shown};
use crate::upload::Uploads;

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
    rebuilds: u64,
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
            uploads,
            gpu,
            device,
            module,
            plan,
            pool,
            done_tx,
            done_rx,
            rebuilds: 0,
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

    /// Makes a free slot's storage at the current size, outside every lock the UI thread takes.
    fn reallocate(&mut self, slot: usize) -> Result<(), String> {
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
        if self.device.is_lost() || self.gpu.device().epoch != self.device.epoch {
            self.rebuild()?;
        }
        self.collect();
        let Some((slot, stale)) = lock(&self.ui.ring).begin(frame) else {
            return Ok(None);
        };
        let size = self.config.size;
        if stale || self.storage[slot].as_ref().is_none_or(|s| s.size() != size) {
            self.reallocate(slot)?;
        }
        let storage = self.storage[slot].as_ref().expect("allocated above");
        let target = Target {
            frame,
            size,
            view: storage.target().clone(),
        };
        let settling = self.uploads.flush(&self.device.queue);
        let mut keyed = Vec::new();
        for (name, job) in self.module.layers(&self.device, &target) {
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
        let jobs = keyed.into_iter().map(|(_, job)| job).collect();
        let encodes = self.pool.run(&self.device.device, &self.device.queue, jobs);
        let epoch = self.device.epoch;
        let tx = self.done_tx.clone();
        self.device.queue.on_submitted_work_done(move || {
            let _ = tx.send((epoch, slot, Done::Render, Instant::now()));
        });
        let mut encoder = self
            .device
            .device
            .create_command_encoder(&Default::default());
        storage.after_render(&mut encoder);
        self.device.queue.submit([encoder.finish()]);
        let tx = self.done_tx.clone();
        self.device.queue.on_submitted_work_done(move || {
            let _ = tx.send((epoch, slot, Done::All, Instant::now()));
        });
        self.in_flight[slot] = Some(epoch);
        self.render_done[slot] = None;
        self.times[slot] = None;
        // Lets wgpu run the callbacks for work the GPU already finished, without waiting.
        let _ = self.device.device.poll(wgpu::PollType::Poll);
        self.collect();
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
                            lock(&self.ui.ring).abandon(slot);
                            continue;
                        }
                    }
                    self.times[slot] = Some(Times {
                        render_done,
                        ready: Instant::now(),
                    });
                    lock(&self.ui.ring).gpu_done(slot);
                }
            }
        }
    }

    /// Off the UI thread: waits until `slot`'s frame is done (the virtual clock's wait for the
    /// GPU, never the UI thread's). False if the device was lost before it finished.
    pub fn wait_done(&mut self, slot: usize) -> bool {
        while self.in_flight[slot].is_some() {
            if self.device.is_lost() {
                return false;
            }
            let _ = self.device.device.poll(wgpu::PollType::wait_indefinitely());
            self.collect();
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

    pub fn times(&self, slot: usize) -> Option<Times> {
        self.times[slot]
    }

    /// The bytes a slot holds now, as GPUI samples them.
    pub fn read(&self, slot: usize) -> Option<Vec<u8>> {
        self.storage[slot].as_ref().map(|s| s.read())
    }
}
