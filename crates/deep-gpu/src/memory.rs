//! GPU memory as the device reports it (issue #379; canvas primitives: Meter and degrade ladder,
//! "each at its allocation's size as the device reports it: every mip, array layer, cube face and
//! sample, with padding, and 0 for a memoryless target, never a formula over its descriptor").
//! On Metal each resource's size is its `allocatedSize` and the device's total its
//! `currentAllocatedSize`; elsewhere neither can be read, and a count that needs one is BLOCKED.

use crate::device::{Backend, Device};

/// The device's allocated size now: Metal's `currentAllocatedSize`, or `None` where the device
/// doesn't report one.
pub fn allocated(device: &Device) -> Option<u64> {
    if device.backend != Backend::Gpu {
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_metal::MTLDevice as _;
        // SAFETY: only reads the raw device's allocated size.
        let hal = unsafe { device.device.as_hal::<wgpu::hal::api::Metal>() }?;
        Some(hal.raw_device().currentAllocatedSize() as u64)
    }
    #[cfg(not(target_os = "macos"))]
    None
}

/// The size the device reports for `texture`'s allocation.
pub fn texture(device: &Device, texture: &wgpu::Texture) -> Option<u64> {
    if device.backend != Backend::Gpu {
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_metal::MTLResource as _;
        // SAFETY: only reads the raw texture's allocated size.
        let hal = unsafe { texture.as_hal::<wgpu::hal::api::Metal>() }?;
        Some(hal.raw_handle().allocatedSize() as u64)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = texture;
        None
    }
}

/// A GPU-only buffer of `size` bytes and the size the device reports for it. On Metal it's made
/// as a raw buffer, so its `allocatedSize` can be read, and handed to wgpu.
pub fn buffer(
    device: &Device,
    label: &'static str,
    size: u64,
    usage: wgpu::BufferUsages,
) -> (wgpu::Buffer, Option<u64>) {
    let desc = wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: false,
    };
    #[cfg(target_os = "macos")]
    if device.backend == Backend::Gpu
        && !usage.intersects(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::MAP_WRITE)
    {
        use objc2_metal::{MTLDevice as _, MTLResource as _, MTLResourceOptions};
        // SAFETY: the raw buffer is a private GPU buffer of `size` bytes, as wgpu would make it,
        // and wgpu owns it from here on.
        let made = unsafe {
            device
                .device
                .as_hal::<wgpu::hal::api::Metal>()
                .and_then(|hal| {
                    hal.raw_device().newBufferWithLength_options(
                        size as usize,
                        MTLResourceOptions::StorageModePrivate,
                    )
                })
                .map(|raw| {
                    let bytes = raw.allocatedSize() as u64;
                    let hal = wgpu::hal::metal::Device::buffer_from_raw(raw, size);
                    (
                        device
                            .device
                            .create_buffer_from_hal::<wgpu::hal::api::Metal>(hal, &desc),
                        bytes,
                    )
                })
        };
        if let Some((buffer, bytes)) = made {
            return (buffer, Some(bytes));
        }
    }
    (device.device.create_buffer(&desc), None)
}

/// Runs `f`, which allocates on `device`, and the growth of the device's allocated size across it:
/// what the device reports for the allocations `f` made, when nothing else allocates meanwhile.
pub fn across<T>(device: &Device, f: impl FnOnce() -> T) -> (T, Option<u64>) {
    let before = allocated(device);
    let out = f();
    let after = allocated(device);
    (out, before.zip(after).map(|(b, a)| a.saturating_sub(b)))
}

/// Waits until the device has finished everything submitted, so what was released is freed.
pub fn drain(device: &Device) {
    crate::alloc::outside(|| {
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
    });
}
