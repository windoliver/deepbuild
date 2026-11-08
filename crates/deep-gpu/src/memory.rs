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
    match raw(device, &desc) {
        Some((buffer, bytes)) => (buffer, Some(bytes)),
        None => (device.device.create_buffer(&desc), None),
    }
}

/// A GPU-only buffer asked of the device itself, past wgpu's own size limit (#1413): `None` when
/// the device refuses it, or off Metal, where the device can't be asked directly.
pub fn device_buffer(device: &Device, desc: &wgpu::BufferDescriptor) -> Option<wgpu::Buffer> {
    raw(device, desc).map(|(buffer, _)| buffer)
}

/// The raw Metal buffer for `desc` handed to wgpu, and its `allocatedSize`.
fn raw(device: &Device, desc: &wgpu::BufferDescriptor) -> Option<(wgpu::Buffer, u64)> {
    #[cfg(target_os = "macos")]
    if device.backend == Backend::Gpu
        && !desc
            .usage
            .intersects(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::MAP_WRITE)
    {
        use objc2_metal::{MTLDevice as _, MTLResource as _, MTLResourceOptions};
        let size = desc.size;
        // SAFETY: the raw buffer is a private GPU buffer of `size` bytes, as wgpu would make it,
        // and wgpu owns it from here on.
        return unsafe {
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
                            .create_buffer_from_hal::<wgpu::hal::api::Metal>(hal, desc),
                        bytes,
                    )
                })
        };
    }
    let _ = (device, desc);
    None
}

/// A `desc` texture laid out by rows in a private buffer of its own, and the size the device reports
/// for it: where a target must cost what its declaration says, a device's tiled layout pads it past
/// that, and a linear one doesn't. `None` off Metal, for a mipped texture, or past a row's alignment.
pub fn linear_texture(
    device: &Device,
    desc: &wgpu::TextureDescriptor<'_>,
) -> Option<(wgpu::Texture, u64)> {
    if device.backend != Backend::Gpu
        || desc.mip_level_count != 1
        || desc.format != wgpu::TextureFormat::Rgba16Float
    {
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_metal::{
            MTLBuffer as _, MTLDevice as _, MTLPixelFormat, MTLResource as _, MTLResourceOptions,
            MTLStorageMode, MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
        };
        let (w, h) = (desc.size.width as usize, desc.size.height as usize);
        let row = w * 8;
        let hal = unsafe { device.device.as_hal::<wgpu::hal::api::Metal>() }?;
        let raw_device = hal.raw_device();
        let align = raw_device.minimumLinearTextureAlignmentForPixelFormat(MTLPixelFormat::RGBA16Float);
        if row % align != 0 {
            return None;
        }
        let buffer = raw_device
            .newBufferWithLength_options(row * h, MTLResourceOptions::StorageModePrivate)?;
        let bytes = buffer.allocatedSize() as u64;
        // SAFETY: the descriptor fits the buffer: `h` rows of `row` bytes, at the row alignment
        // the device asked for, and the texture keeps the buffer alive.
        let raw = unsafe {
            let d = MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                MTLPixelFormat::RGBA16Float,
                w,
                h,
                false,
            );
            d.setStorageMode(MTLStorageMode::Private);
            d.setUsage(MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget);
            buffer.newTextureWithDescriptor_offset_bytesPerRow(&d, 0, row)?
        };
        let extent = wgpu::hal::CopyExtent {
            width: desc.size.width,
            height: desc.size.height,
            depth: 1,
        };
        // SAFETY: `raw` is the texture `desc` describes, and wgpu owns it from here on.
        let hal = unsafe {
            wgpu::hal::metal::Device::texture_from_raw(
                raw,
                desc.format,
                MTLTextureType::Type2D,
                1,
                1,
                extent,
                None,
            )
        };
        let texture = unsafe {
            device
                .device
                .create_texture_from_hal::<wgpu::hal::api::Metal>(
                    hal,
                    desc,
                    wgpu::TextureUses::UNINITIALIZED,
                )
        };
        Some((texture, bytes))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = desc;
        None
    }
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
