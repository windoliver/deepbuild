//! A texture read back from the device as f32 texels, for a compositor's kept targets and
//! `deep-gpu`'s operator frames (#483).

use deep_gpu::device::Device;

fn f16(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = i32::from((bits >> 10) & 0x1f);
    let frac = f32::from(bits & 0x3ff);
    sign * match exp {
        0 => frac * 2f32.powi(-24),
        31 if frac == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + frac / 1024.0) * 2f32.powi(e - 15),
    }
}

/// Level `level` of `tex` read back as f32 RGBA, rows top-down, slices in z order.
pub fn read_texture(device: &Device, tex: &wgpu::Texture, level: u32) -> ([u32; 3], Vec<f32>) {
    let d = &device.device;
    let w = (tex.width() >> level).max(1);
    let h = (tex.height() >> level).max(1);
    let depth = if tex.dimension() == wgpu::TextureDimension::D3 {
        (tex.depth_or_array_layers() >> level).max(1)
    } else {
        1
    };
    let texel = match tex.format() {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba32Float => 16,
        _ => 4,
    };
    let row = (w * texel).div_ceil(256) * 256;
    let size = u64::from(row) * u64::from(h) * u64::from(depth);
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("check_operator read back"),
        size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = d.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: level,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &back,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: depth,
        },
    );
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let bytes = back
        .slice(..)
        .get_mapped_range()
        .map(|v| v.to_vec())
        .unwrap_or_default();
    let mut out = Vec::with_capacity((w * h * depth * 4) as usize);
    for z in 0..depth {
        for y in 0..h {
            let at = ((z * h + y) * row) as usize;
            let line = &bytes[at..at + (w * texel) as usize];
            for x in 0..w as usize {
                let t = &line[x * texel as usize..(x + 1) * texel as usize];
                let px: [f32; 4] = match tex.format() {
                    wgpu::TextureFormat::Rgba16Float => {
                        let h16 = |k: usize| f16(u16::from_le_bytes([t[2 * k], t[2 * k + 1]]));
                        [h16(0), h16(1), h16(2), h16(3)]
                    }
                    wgpu::TextureFormat::Rgba8Unorm => {
                        [0, 1, 2, 3].map(|k| f32::from(t[k]) / 255.0)
                    }
                    wgpu::TextureFormat::Rgba32Float => [0, 1, 2, 3].map(|k| {
                        f32::from_le_bytes([t[4 * k], t[4 * k + 1], t[4 * k + 2], t[4 * k + 3]])
                    }),
                    wgpu::TextureFormat::R32Float => {
                        [f32::from_le_bytes([t[0], t[1], t[2], t[3]]), 0.0, 0.0, 1.0]
                    }
                    _ => [
                        u32::from_le_bytes([t[0], t[1], t[2], t[3]]) as f32,
                        0.0,
                        0.0,
                        1.0,
                    ],
                };
                out.extend_from_slice(&px);
            }
        }
    }
    back.unmap();
    ([w, h, depth], out)
}

/// f32 texels as little-endian bytes.
pub fn f32_bytes(px: &[f32]) -> Vec<u8> {
    px.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// An 8-bit, four-channel texture's bytes as the device holds them, rows top-down.
pub fn read_bytes(device: &Device, tex: &wgpu::Texture) -> Vec<u8> {
    let d = &device.device;
    let (w, h) = (tex.width(), tex.height());
    let row = (w * 4).div_ceil(256) * 256;
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("frame read back"),
        size: u64::from(row) * u64::from(h),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = d.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        tex.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &back,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let bytes = back
        .slice(..)
        .get_mapped_range()
        .map(|v| v.to_vec())
        .unwrap_or_default();
    back.unmap();
    bytes
        .chunks(row as usize)
        .flat_map(|line| line[..(w * 4) as usize].iter().copied())
        .collect()
}

/// A mapped buffer's rows, each `width` bytes of a `row`-byte stride.
pub fn map_rows(
    device: &deep_gpu::counted::Wgpu,
    buffer: &wgpu::Buffer,
    row: usize,
    width: usize,
    rows: usize,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return Err("the read back didn't map".into());
    }
    let data = buffer
        .slice(..)
        .get_mapped_range()
        .map_err(|_| "the read back didn't map".to_string())?;
    let mut out = Vec::with_capacity(width * rows);
    for y in 0..rows {
        out.extend_from_slice(&data[y * row..y * row + width]);
    }
    Ok(out)
}
