//! A slot's storage on each handoff path (canvas primitives: GPU surface, `path: zero_copy |
//! copy`). Both hold premultiplied BGRA8, tagged sRGB, and hand GPUI the same bytes: zero copy
//! renders straight into an IOSurface GPUI samples in place; the copy path renders into a texture
//! of its own, reads it back through memory and writes the bytes into the pixel buffer GPUI shows.

use crate::device::Device;

/// The format every slot holds: BGRA8, premultiplied, its values sRGB-encoded.
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    ZeroCopy,
    Copy,
}

impl Path {
    pub fn name(self) -> &'static str {
        match self {
            Path::ZeroCopy => "zero_copy",
            Path::Copy => "copy",
        }
    }
}

/// What GPUI shows for a slot: on macOS the pixel buffer it composites.
#[cfg(target_os = "macos")]
pub type Shown = objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>;
#[cfg(not(target_os = "macos"))]
pub type Shown = std::sync::Arc<Vec<u8>>;

/// One slot's storage on one path: the surface seam each platform fills (#140).
pub trait Handoff: Send {
    fn size(&self) -> [u32; 2];
    /// The view a frame renders into.
    fn target(&self) -> &wgpu::TextureView;
    /// Encoded after the frame's passes: the copy path's read back.
    fn after_render(&self, encoder: &mut wgpu::CommandEncoder);
    /// Once the GPU signalled the frame done, before the slot is ready: the copy path maps its
    /// read-back and writes the bytes GPUI will show. Runs on the render thread.
    fn finish(&self, device: &Device) -> Result<(), String>;
    /// What GPUI composites.
    fn shown(&self) -> Shown;
    /// The slot's bytes, tightly packed BGRA, as GPUI would sample them.
    fn read(&self) -> Vec<u8>;
}

pub fn allocate(device: &Device, path: Path, size: [u32; 2]) -> Result<Box<dyn Handoff>, String> {
    match path {
        #[cfg(target_os = "macos")]
        Path::ZeroCopy => macos::ZeroCopy::new(device, size).map(|s| Box::new(s) as _),
        #[cfg(not(target_os = "macos"))]
        Path::ZeroCopy => Err("no zero-copy handoff on this platform".into()),
        Path::Copy => Copy::new(device, size).map(|s| Box::new(s) as _),
    }
}

/// Rows of a read-back buffer are padded to wgpu's copy alignment.
fn padded_row(width: u32) -> u32 {
    let row = width * 4;
    row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT
}

fn texture(device: &Device, size: [u32; 2], usage: wgpu::TextureUsages) -> wgpu::Texture {
    device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("deep-gpu slot"),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage,
        view_formats: &[],
    })
}

/// The copy through memory, which every platform has.
pub struct Copy {
    size: [u32; 2],
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    readback: wgpu::Buffer,
    shown: Shown,
}

impl Copy {
    fn new(device: &Device, size: [u32; 2]) -> Result<Self, String> {
        let texture = texture(
            device,
            size,
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        );
        let view = texture.create_view(&Default::default());
        let readback = device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("deep-gpu read back"),
            size: u64::from(padded_row(size[0])) * u64::from(size[1]),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        #[cfg(target_os = "macos")]
        let shown = macos::pixel_buffer(size)?;
        #[cfg(not(target_os = "macos"))]
        let shown = std::sync::Arc::new(vec![0; (size[0] * size[1] * 4) as usize]);
        Ok(Self {
            size,
            texture,
            view,
            readback,
            shown,
        })
    }
}

// SAFETY: as for zero copy, the pixel buffer is only written on the render thread and handed to
// GPUI, both thread-safe CoreVideo calls.
unsafe impl Send for Copy {}

impl Handoff for Copy {
    fn size(&self) -> [u32; 2] {
        self.size
    }

    fn target(&self) -> &wgpu::TextureView {
        &self.view
    }

    fn after_render(&self, encoder: &mut wgpu::CommandEncoder) {
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &self.readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_row(self.size[0])),
                    rows_per_image: Some(self.size[1]),
                },
            },
            wgpu::Extent3d {
                width: self.size[0],
                height: self.size[1],
                depth_or_array_layers: 1,
            },
        );
    }

    fn finish(&self, device: &Device) -> Result<(), String> {
        let slice = self.readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| format!("read back: {e}"))?;
        rx.recv()
            .map_err(|_| "read back: no reply".to_string())?
            .map_err(|e| format!("read back: {e}"))?;
        {
            let data = slice
                .get_mapped_range()
                .map_err(|e| format!("read back: {e}"))?;
            let row = (self.size[0] * 4) as usize;
            let padded = padded_row(self.size[0]) as usize;
            #[cfg(target_os = "macos")]
            macos::write(&self.shown, |dst, stride| {
                for (y, src) in data
                    .chunks_exact(padded)
                    .take(self.size[1] as usize)
                    .enumerate()
                {
                    dst[y * stride..y * stride + row].copy_from_slice(&src[..row]);
                }
            });
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (row, padded, &data);
            }
        }
        self.readback.unmap();
        Ok(())
    }

    fn shown(&self) -> Shown {
        self.shown.clone()
    }

    fn read(&self) -> Vec<u8> {
        #[cfg(target_os = "macos")]
        return macos::read(&self.shown, self.size);
        #[cfg(not(target_os = "macos"))]
        return self.shown.to_vec();
    }
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use super::{Device, Handoff, Shown, FORMAT};
    use objc2_core_foundation::{CFDictionary, CFRetained, CFString, CFType};
    use objc2_core_video::{
        kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey,
        kCVPixelFormatType_32BGRA, kCVReturnSuccess, CVPixelBuffer, CVPixelBufferCreate,
        CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetIOSurface,
        CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
    };
    use objc2_metal::{
        MTLDevice as _, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
        MTLTextureUsage,
    };
    use std::ptr::NonNull;

    /// A BGRA pixel buffer backed by an IOSurface, which GPUI's Metal renderer can sample.
    pub fn pixel_buffer(size: [u32; 2]) -> Result<Shown, String> {
        let empty = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
        let yes = objc2_core_foundation::CFBoolean::new(true);
        // SAFETY: the keys are CoreVideo's own statics.
        let (surface_key, metal_key) = unsafe {
            (
                kCVPixelBufferIOSurfacePropertiesKey,
                kCVPixelBufferMetalCompatibilityKey,
            )
        };
        let attrs = CFDictionary::<CFString, CFType>::from_slices(
            &[surface_key, metal_key],
            &[empty.as_ref(), yes.as_ref()],
        );
        let mut out = std::ptr::null_mut();
        // SAFETY: the attributes are a CFString-keyed dictionary and `out` is a valid pointer.
        let status = unsafe {
            CVPixelBufferCreate(
                None,
                size[0] as usize,
                size[1] as usize,
                kCVPixelFormatType_32BGRA,
                Some(attrs.as_opaque()),
                NonNull::from(&mut out),
            )
        };
        if status != kCVReturnSuccess {
            return Err(format!("CVPixelBufferCreate failed: {status}"));
        }
        let out = NonNull::new(out).ok_or("CVPixelBufferCreate returned null")?;
        // SAFETY: a Create function hands over one reference.
        Ok(unsafe { CFRetained::from_raw(out) })
    }

    /// Runs `f` on the pixel buffer's bytes and its row stride, locked for writing.
    pub fn write(buffer: &CVPixelBuffer, f: impl FnOnce(&mut [u8], usize)) {
        // SAFETY: locked while the slice lives; the length is rows × stride.
        unsafe {
            CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(0));
            let base = CVPixelBufferGetBaseAddress(buffer) as *mut u8;
            let stride = CVPixelBufferGetBytesPerRow(buffer);
            let rows = objc2_core_video::CVPixelBufferGetHeight(buffer);
            f(std::slice::from_raw_parts_mut(base, stride * rows), stride);
            CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(0));
        }
    }

    pub fn read(buffer: &CVPixelBuffer, size: [u32; 2]) -> Vec<u8> {
        let row = (size[0] * 4) as usize;
        let mut out = Vec::with_capacity(row * size[1] as usize);
        // SAFETY: as in `write`, read-only.
        unsafe {
            CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly);
            let base = CVPixelBufferGetBaseAddress(buffer) as *const u8;
            let stride = CVPixelBufferGetBytesPerRow(buffer);
            let data = std::slice::from_raw_parts(base, stride * size[1] as usize);
            for y in 0..size[1] as usize {
                out.extend_from_slice(&data[y * stride..y * stride + row]);
            }
            CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags::ReadOnly);
        }
        out
    }

    /// Zero copy: the slot's texture is the IOSurface GPUI samples.
    pub struct ZeroCopy {
        size: [u32; 2],
        buffer: Shown,
        _texture: wgpu::Texture,
        view: wgpu::TextureView,
    }

    // SAFETY: the pixel buffer is only read or handed to GPUI, both thread-safe CoreVideo calls.
    unsafe impl Send for ZeroCopy {}

    impl ZeroCopy {
        pub fn new(device: &Device, size: [u32; 2]) -> Result<Self, String> {
            let buffer = pixel_buffer(size)?;
            let surface =
                CVPixelBufferGetIOSurface(Some(&buffer)).ok_or("pixel buffer has no IOSurface")?;
            // SAFETY: the Metal texture aliases the IOSurface, which `buffer` keeps alive as long
            // as the texture lives; wgpu takes it as an initialized render target.
            let texture = unsafe {
                let hal = device
                    .device
                    .as_hal::<wgpu::hal::api::Metal>()
                    .ok_or("not a Metal device")?;
                let desc =
                    MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                        MTLPixelFormat::BGRA8Unorm,
                        size[0] as usize,
                        size[1] as usize,
                        false,
                    );
                desc.setUsage(MTLTextureUsage::RenderTarget | MTLTextureUsage::ShaderRead);
                desc.setStorageMode(MTLStorageMode::Shared);
                let raw = hal
                    .raw_device()
                    .newTextureWithDescriptor_iosurface_plane(&desc, &surface, 0)
                    .ok_or("Metal refused the IOSurface texture")?;
                let hal_texture = wgpu::hal::metal::Device::texture_from_raw(
                    raw,
                    FORMAT,
                    MTLTextureType::Type2D,
                    1,
                    1,
                    wgpu::hal::CopyExtent {
                        width: size[0],
                        height: size[1],
                        depth: 1,
                    },
                    None,
                );
                device
                    .device
                    .create_texture_from_hal::<wgpu::hal::api::Metal>(
                        hal_texture,
                        &wgpu::TextureDescriptor {
                            label: Some("deep-gpu IOSurface slot"),
                            size: wgpu::Extent3d {
                                width: size[0],
                                height: size[1],
                                depth_or_array_layers: 1,
                            },
                            mip_level_count: 1,
                            sample_count: 1,
                            dimension: wgpu::TextureDimension::D2,
                            format: FORMAT,
                            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                            view_formats: &[],
                        },
                        wgpu::TextureUses::UNINITIALIZED,
                    )
            };
            let view = texture.create_view(&Default::default());
            Ok(Self {
                size,
                buffer,
                _texture: texture,
                view,
            })
        }
    }

    impl Handoff for ZeroCopy {
        fn size(&self) -> [u32; 2] {
            self.size
        }

        fn target(&self) -> &wgpu::TextureView {
            &self.view
        }

        fn after_render(&self, _: &mut wgpu::CommandEncoder) {}

        fn finish(&self, _: &Device) -> Result<(), String> {
            Ok(())
        }

        fn shown(&self) -> Shown {
            self.buffer.clone()
        }

        fn read(&self) -> Vec<u8> {
            read(&self.buffer, self.size)
        }
    }
}
