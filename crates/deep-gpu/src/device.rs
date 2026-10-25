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

/// The app's GPU: its one live device, reopened after a loss.
pub struct Gpu {
    backend: Backend,
    current: Mutex<Arc<Device>>,
}

impl Gpu {
    pub fn open(backend: Backend) -> Result<Arc<Gpu>, String> {
        let device = Device::open(backend)?;
        LIVE.fetch_add(1, Ordering::SeqCst);
        Ok(Arc::new(Gpu {
            backend,
            current: Mutex::new(device),
        }))
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
            *current = Device::open(self.backend)?;
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
    /// Bumped on every device the app opens; a resource built at an older epoch is gone.
    pub epoch: u64,
    lost: Arc<AtomicBool>,
}

impl Device {
    fn open(backend: Backend) -> Result<Arc<Device>, String> {
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
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("deep-gpu"),
                    ..Default::default()
                }))
                .map_err(|e| format!("no GPU device: {e}"))?
            }
        };
        let lost = Arc::new(AtomicBool::new(false));
        let flag = lost.clone();
        device.set_device_lost_callback(move |_, _| flag.store(true, Ordering::SeqCst));
        let epoch = OPENED.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(Arc::new(Device {
            device,
            queue,
            backend,
            epoch,
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
