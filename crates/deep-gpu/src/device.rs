//! One wgpu device for the app (canvas primitives: GPU surface, `device: one per app`). Every GPU
//! view, slot and render module shares it; device loss opens a new one and bumps the epoch, and
//! every declared resource rebuilds against it (`resources`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

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

/// What the app's device is opened without, on the same adapter (the platform seam's feature
/// table: a feature "withheld at device creation"), so its fallback can be tested.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Withheld {
    pub timestamps: bool,
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
    withheld: Withheld,
    current: Mutex<Arc<Device>>,
}

impl Gpu {
    pub fn open(backend: Backend) -> Result<Arc<Gpu>, String> {
        Gpu::open_withholding(backend, Withheld::default())
    }

    /// The app's GPU, its device opened without what `withheld` names.
    pub fn open_withholding(backend: Backend, withheld: Withheld) -> Result<Arc<Gpu>, String> {
        let device = Device::open(backend, withheld)?;
        LIVE.fetch_add(1, Ordering::SeqCst);
        Ok(Arc::new(Gpu {
            backend,
            withheld,
            current: Mutex::new(device),
        }))
    }

    pub fn withheld(&self) -> Withheld {
        self.withheld
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
            *current = Device::open(self.backend, self.withheld)?;
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
}

impl Device {
    fn open(backend: Backend, withheld: Withheld) -> Result<Arc<Device>, String> {
        let wanted = wgpu::Features::TIMESTAMP_QUERY
            | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
            | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES;
        let mut features = wgpu::Features::empty();
        let mut name = String::from("noop");
        let mut info = None;
        let (device, queue) = match backend {
            Backend::Noop => wgpu::Device::noop(&wgpu::DeviceDescriptor::default()),
            Backend::Gpu => {
                let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
                    backends: wgpu::Backends::PRIMARY,
                    ..wgpu::InstanceDescriptor::new_without_display_handle()
                });
                let adapter =
                    pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::HighPerformance,
                        ..Default::default()
                    }))
                    .map_err(|e| format!("no GPU adapter: {e}"))?;
                if !withheld.timestamps {
                    features = adapter.features() & wanted;
                }
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
        }))
    }

    /// Loses the device on purpose, as the forced device-loss tests do.
    pub fn force_loss(&self) {
        self.device.destroy();
        self.lost.store(true, Ordering::SeqCst);
    }

    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst)
    }
}
