//! One wgpu device for the app (canvas primitives: GPU surface, `device: one per app`). Every GPU
//! view, slot and render module shares it; device loss opens a new one and bumps the epoch, and
//! every declared resource rebuilds against it (`resources`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::counted::{Counts, Queue, Wgpu};
use crate::seam::{self, Choice, Refusal, Startup};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    /// The platform's own GPU: Metal on macOS.
    Gpu,
    /// wgpu's noop backend: no GPU, for render logic (the noop lane).
    Noop,
}

/// How many devices this process opened, a lost one's replacement included.
static OPENED: AtomicU64 = AtomicU64::new(0);
/// How many app GPUs are open now.
static LIVE: AtomicU64 = AtomicU64::new(0);

/// An error the device raised through its uncaptured-error callback (issue #140): a channel every
/// check that renders reads, never a panic.
#[derive(Clone, Debug)]
pub struct Raised {
    /// `validation`, `out_of_memory` or `internal`.
    pub kind: &'static str,
    pub error: String,
}

/// The device's pass timestamps, as the meter reads them (issue #379).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Timestamps {
    /// Timestamp writes at the start and end of a pass.
    pub query: bool,
    pub inside_encoders: bool,
    pub inside_passes: bool,
    /// Nanoseconds per tick, with timestamps.
    pub period_ns: Option<f32>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Errors every device of the process passed to its uncaptured-error callback.
static RAISED: AtomicU64 = AtomicU64::new(0);

/// How many device errors print at once before the rest are counted (#1413).
pub const BURST: u32 = 10;
/// Seconds per printed line the limit gives back after its burst.
const REFILL_S: f64 = 1.0;

/// The device-error print's limit: a burst, then one line per refill, and one line that counts
/// what it suppressed when the next line may print or at the latest by [`flush_suppressed`].
struct Limit {
    tokens: f64,
    at: Option<Instant>,
    suppressed: u64,
}

static LIMIT: Mutex<Limit> = Mutex::new(Limit {
    tokens: BURST as f64,
    at: None,
    suppressed: 0,
});

fn print(kind: &str, error: &str) {
    let mut l = lock(&LIMIT);
    let now = Instant::now();
    if let Some(at) = l.at {
        l.tokens = (l.tokens + now.duration_since(at).as_secs_f64() / REFILL_S).min(BURST as f64);
    }
    l.at = Some(now);
    if l.tokens < 1.0 {
        l.suppressed += 1;
        return;
    }
    l.tokens -= 1.0;
    if l.suppressed > 0 {
        // The line the refill gives back counts what came before it; this error is counted next.
        eprintln!("deep-gpu: {} device errors suppressed", l.suppressed);
        l.suppressed = 1;
        return;
    }
    eprintln!("deep-gpu: the device raised a {kind} error: {error}");
}

/// Prints the count of device errors suppressed since the last line, if any.
pub fn flush_suppressed() {
    let mut l = lock(&LIMIT);
    if l.suppressed > 0 {
        eprintln!("deep-gpu: {} device errors suppressed", l.suppressed);
        l.suppressed = 0;
    }
}

/// Errors passed to every device's uncaptured-error callback in this process.
pub fn raised_total() -> u64 {
    RAISED.load(Ordering::SeqCst)
}

thread_local! {
    static SCOPES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Pushes an error scope, counted on this thread (#1413: a build within memory opens no scope
/// per frame).
pub fn push_scope(device: &wgpu::Device, filter: wgpu::ErrorFilter) -> wgpu::ErrorScopeGuard {
    SCOPES.with(|n| n.set(n.get() + 1));
    device.push_error_scope(filter)
}

/// Error scopes this thread pushed through [`push_scope`].
pub fn scopes_pushed() -> u64 {
    SCOPES.with(std::cell::Cell::get)
}

/// A resource that failed to build, as its writer is told (#1413): the first failure is the
/// cause, with the resource's label and requested bytes; the validation errors its later uses
/// raise are counted, and a device loss after it is appended.
#[derive(Clone, Debug)]
pub struct Failure {
    /// `out_of_memory`, `device_lost`, `validation` or `internal`.
    pub code: &'static str,
    pub label: Option<String>,
    pub bytes: Option<u64>,
    pub later_validation: u64,
    pub appended: Vec<&'static str>,
    /// The latest error that named the resource: what a reporter that keeps the latest tells.
    pub latest: &'static str,
}

type Failures = Arc<Mutex<Vec<Arc<Mutex<Failure>>>>>;

/// The app's GPU: its one live device, reopened after a loss.
pub struct Gpu {
    backend: Backend,
    /// The GPU seam's adapter and device features (issue #140); `None` on the noop backend.
    choice: Option<Choice>,
    current: Mutex<Arc<Device>>,
    /// Reopens still to fail, from a test's planted reopen (`u64::MAX`: every one).
    failing_reopens: AtomicU64,
}

impl Gpu {
    pub fn open(backend: Backend) -> Result<Arc<Gpu>, String> {
        Gpu::start(backend, &Startup::default()).map_err(|r| r.reason)
    }

    /// The app's GPU on the adapter the GPU seam picks, its device created without what the
    /// startup withholds; a device without a required feature of the tier is refused, naming it.
    pub fn start(backend: Backend, startup: &Startup) -> Result<Arc<Gpu>, Refusal> {
        let choice = match backend {
            Backend::Gpu => Some(seam::pick(startup)?),
            Backend::Noop => None,
        };
        let device = Device::open(backend, choice.as_ref()).map_err(Refusal::no_device)?;
        if let Some(c) = &choice {
            let missing = seam::missing(&device.device);
            if !missing.is_empty() {
                return Err(Refusal {
                    code: "missing_feature",
                    adapter: Some(c.adapter.name.clone()),
                    reason: format!(
                        "the {} tier requires {}, which the device on {} wasn't created with",
                        seam::TIER,
                        missing.join(", "),
                        c.adapter.name
                    ),
                    missing,
                });
            }
        }
        LIVE.fetch_add(1, Ordering::SeqCst);
        Ok(Arc::new(Gpu {
            backend,
            choice,
            current: Mutex::new(device),
            failing_reopens: AtomicU64::new(0),
        }))
    }

    /// The adapter the GPU seam picked and what its devices are created with.
    pub fn seam(&self) -> Option<&Choice> {
        self.choice.as_ref()
    }

    pub fn device(&self) -> Arc<Device> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The live device: a new one if the current one was lost; each call on a lost device is one
    /// reopen attempt, which its caller paces (#1413).
    pub fn recover(&self) -> Result<Arc<Device>, String> {
        let mut current = lock(&self.current);
        if current.is_lost() {
            *current = self.open_again()?;
        }
        Ok(current.clone())
    }

    fn open_again(&self) -> Result<Arc<Device>, String> {
        let left = self.failing_reopens.load(Ordering::SeqCst);
        if left > 0 {
            if left != u64::MAX {
                self.failing_reopens.fetch_sub(1, Ordering::SeqCst);
            }
            return Err("no device came back (a planted reopen failure)".into());
        }
        Device::open(self.backend, self.choice.as_ref())
    }

    /// The planted reopen (#1413): the next `n` reopens fail, or every one with `None`.
    pub fn fail_reopens(&self, n: Option<u64>) {
        self.failing_reopens
            .store(n.unwrap_or(u64::MAX), Ordering::SeqCst);
    }

    /// Devices open in this process: one per open app GPU, since a lost device is replaced.
    pub fn count() -> u64 {
        LIVE.load(Ordering::SeqCst)
    }
}

impl Drop for Gpu {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

pub struct Device {
    /// wgpu's device and queue, counting what they create and upload (#1903).
    pub device: Wgpu,
    pub queue: Queue,
    pub backend: Backend,
    /// The adapter's name and driver, for a run's environment fingerprint (#380); `None` on the
    /// noop backend.
    pub adapter: Option<wgpu::AdapterInfo>,
    /// Bumped on every device the app opens; a resource built at an older epoch is gone.
    pub epoch: u64,
    /// The adapter's name, as the platform gives it.
    pub name: String,
    pub timestamps: Timestamps,
    lost: Arc<AtomicBool>,
    raised: Arc<Mutex<Vec<Raised>>>,
    failures: Failures,
}

/// wgpu's noop device, as `wgpu::Device::noop` opens it but with indirect-call validation off:
/// that validation is a compute pass, nothing on a device that runs none, and on the noop
/// adapter's limits its setup asserts as soon as a pass draws indirect (#1903's 4,000 items).
fn noop(desc: &wgpu::DeviceDescriptor<'_>) -> (wgpu::Device, wgpu::Queue) {
    let mut instance = wgpu::InstanceDescriptor::new_without_display_handle();
    instance.backends = wgpu::Backends::NOOP;
    instance.backend_options.noop = wgpu::NoopBackendOptions::enabled();
    instance.flags.remove(wgpu::InstanceFlags::VALIDATION_INDIRECT_CALL);
    let instance = wgpu::Instance::new(instance);
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
        .expect("the noop backend has an adapter");
    pollster::block_on(adapter.request_device(desc)).expect("the noop adapter opens a device")
}

impl Device {
    fn open(backend: Backend, choice: Option<&Choice>) -> Result<Arc<Device>, String> {
        let mut features = wgpu::Features::empty();
        let mut name = String::from("noop");
        let mut info = None;
        let (device, queue) = match backend {
            Backend::Noop => noop(&wgpu::DeviceDescriptor {
                required_limits: wgpu::Limits {
                    max_bind_groups: 5,
                    ..Default::default()
                },
                ..Default::default()
            }),
            Backend::Gpu => {
                let choice = choice.ok_or("no GPU adapter")?;
                let adapter = &choice.raw;
                features = choice.request;
                name = adapter.get_info().name;
                info = Some(adapter.get_info());
                // A storage binding as large as the adapter holds: the per-pixel resolve's lists
                // grow up to the class's GPU memory (#424).
                let limits = adapter.limits();
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("deep-gpu"),
                    required_features: features,
                    required_limits: wgpu::Limits {
                        max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
                        max_buffer_size: limits.max_buffer_size,
                        // A culled element's vertex stage reads its record from a group of its
                        // own, the fifth (#484).
                        max_bind_groups: limits.max_bind_groups,
                        ..Default::default()
                    },
                    ..Default::default()
                }))
                .map_err(|e| format!("no GPU device: {e}"))?
            }
        };
        let lost = Arc::new(AtomicBool::new(false));
        let failures: Failures = Arc::new(Mutex::new(Vec::new()));
        let (flag, failed) = (lost.clone(), failures.clone());
        device.set_device_lost_callback(move |_, _| {
            flag.store(true, Ordering::SeqCst);
            // A loss after a resource failed is appended to its error, never its cause.
            for f in lock(&failed).iter() {
                lock(f).appended.push("device_lost");
            }
        });
        let raised = Arc::new(Mutex::new(Vec::new()));
        let (sink, failed) = (raised.clone(), failures.clone());
        device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
            let kind = match e {
                wgpu::Error::Validation { .. } => "validation",
                wgpu::Error::OutOfMemory { .. } => "out_of_memory",
                wgpu::Error::Internal { .. } => "internal",
            };
            RAISED.fetch_add(1, Ordering::SeqCst);
            let error = e.to_string();
            // A failed resource makes every later use of it an error: counted against the
            // failure it follows, never reported as the cause.
            for f in lock(&failed).iter() {
                let mut f = lock(f);
                if f.label
                    .as_ref()
                    .is_some_and(|l| error.contains(&format!("'{l}'")))
                {
                    f.latest = kind;
                    if kind == "validation" {
                        f.later_validation += 1;
                    }
                }
            }
            print(kind, &error);
            lock(&sink).push(Raised { kind, error });
        }));
        let epoch = OPENED.fetch_add(1, Ordering::SeqCst) + 1;
        let query = features.contains(wgpu::Features::TIMESTAMP_QUERY);
        let timestamps = Timestamps {
            query,
            inside_encoders: features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
            inside_passes: features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
            period_ns: query.then(|| queue.get_timestamp_period()),
        };
        let counts = Arc::new(Counts::default());
        Ok(Arc::new(Device {
            device: Wgpu::new(device, counts.clone()),
            queue: Queue::new(queue, counts),
            backend,
            adapter: info,
            epoch,
            name,
            timestamps,
            lost,
            raised,
            failures,
        }))
    }

    /// Loses the device on purpose, as the forced device-loss tests do.
    pub fn force_loss(&self) {
        self.device.destroy();
        self.lost.store(true, Ordering::SeqCst);
    }

    /// What the device raised through its uncaptured-error callback since this was last called.
    pub fn take_raised(&self) -> Vec<Raised> {
        std::mem::take(&mut *self.raised.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// Records a resource that failed to build on this device; the device's callbacks count what
    /// follows it.
    pub fn failed(
        &self,
        code: &'static str,
        label: Option<&str>,
        bytes: Option<u64>,
    ) -> Arc<Mutex<Failure>> {
        let f = Arc::new(Mutex::new(Failure {
            code,
            label: label.map(str::to_string),
            bytes,
            later_validation: 0,
            appended: Vec::new(),
            latest: code,
        }));
        lock(&self.failures).push(f.clone());
        f
    }

    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst)
    }
}
