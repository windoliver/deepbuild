//! One wgpu device for the app (canvas primitives: GPU surface, `device: one per app`). Every GPU
//! view, slot and render module shares it; device loss opens a new one and bumps the epoch, and
//! every declared resource rebuilds against it (`resources`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

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

/// The app's GPU: its one live device, reopened after a loss.
pub struct Gpu {
    backend: Backend,
    /// The GPU seam's adapter and device features (issue #140); `None` on the noop backend.
    choice: Option<Choice>,
    current: Mutex<Arc<Device>>,
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

    /// The live device: a new one if the current one was lost.
    pub fn recover(&self) -> Result<Arc<Device>, String> {
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if current.is_lost() {
            *current = Device::open(self.backend, self.choice.as_ref())?;
        }
        Ok(current.clone())
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
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
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
}

impl Device {
    fn open(backend: Backend, choice: Option<&Choice>) -> Result<Arc<Device>, String> {
        let mut features = wgpu::Features::empty();
        let mut name = String::from("noop");
        let mut info = None;
        let (device, queue) = match backend {
            Backend::Noop => wgpu::Device::noop(&wgpu::DeviceDescriptor::default()),
            Backend::Gpu => {
                let choice = choice.ok_or("no GPU adapter")?;
                let adapter = &choice.raw;
                features = choice.request;
                name = adapter.get_info().name;
                info = Some(adapter.get_info());
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("deep-gpu"),
                    required_features: features,
                    ..Default::default()
                }))
                .map_err(|e| format!("no GPU device: {e}"))?
            }
        };
        let lost = Arc::new(AtomicBool::new(false));
        let flag = lost.clone();
        device.set_device_lost_callback(move |_, _| flag.store(true, Ordering::SeqCst));
        let raised = Arc::new(Mutex::new(Vec::new()));
        let sink = raised.clone();
        device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
            let kind = match e {
                wgpu::Error::Validation { .. } => "validation",
                wgpu::Error::OutOfMemory { .. } => "out_of_memory",
                wgpu::Error::Internal { .. } => "internal",
            };
            eprintln!("deep-gpu: the device raised a {kind} error: {e}");
            let mut list = sink.lock().unwrap_or_else(|e| e.into_inner());
            list.push(Raised {
                kind,
                error: e.to_string(),
            });
        }));
        let epoch = OPENED.fetch_add(1, Ordering::SeqCst) + 1;
        let query = features.contains(wgpu::Features::TIMESTAMP_QUERY);
        let timestamps = Timestamps {
            query,
            inside_encoders: features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
            inside_passes: features.contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
            period_ns: query.then(|| queue.get_timestamp_period()),
        };
        Ok(Arc::new(Device {
            device,
            queue,
            backend,
            adapter: info,
            epoch,
            name,
            timestamps,
            lost,
            raised,
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

    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst)
    }
}
