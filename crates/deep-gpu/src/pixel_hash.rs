//! The determinism check's GPU pixel hash (issue #1897): a frame's texture, rgba8 or
//! rgba16float, copied into a buffer and reduced to 128 bits by one compute pass, only the 16
//! bytes read back. `cpu` is the same function on the CPU, bit for bit. The WGSL is
//! `pixel_hash.wgsl`.

use deep_canvas::steps::hash1;

const SOURCE: &str = include_str!("pixel_hash.wgsl");
/// Invocations a workgroup covers.
const GROUP: u32 = 256;
/// The most workgroups one dispatch takes along x.
const MOST_GROUPS: u32 = 65_535;

/// A frame's texel format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Rgba8,
    Rgba16Float,
}

impl Format {
    /// Its name as a request gives it: `rgba8` or `rgba16float`.
    pub fn named(name: &str) -> Option<Format> {
        match name {
            "rgba8" => Some(Format::Rgba8),
            "rgba16float" => Some(Format::Rgba16Float),
            _ => None,
        }
    }

    /// Little-endian u32 words per pixel.
    pub fn words(self) -> u32 {
        match self {
            Format::Rgba8 => 1,
            Format::Rgba16Float => 2,
        }
    }

    fn texture(self) -> wgpu::TextureFormat {
        match self {
            Format::Rgba8 => wgpu::TextureFormat::Rgba8Unorm,
            Format::Rgba16Float => wgpu::TextureFormat::Rgba16Float,
        }
    }
}

/// The wrong hash a test must catch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Each pixel hashed without its index, the lanes XORed: a swap goes unseen.
    pub without_position: bool,
}

/// Each lane's seed: the frame's size and format, so equal bytes of another shape hash apart.
fn seeds(size: [u32; 2], format: Format) -> [u32; 4] {
    [1u32, 2, 3, 4].map(|l| {
        let s = hash1(hash1(l.wrapping_mul(0x9E37_79B9)) ^ format.words());
        hash1(hash1(s ^ size[0]) ^ size[1])
    })
}

/// The four lane sums as 16 little-endian bytes.
fn digest(sums: [u32; 4]) -> [u8; 16] {
    let mut out = [0; 16];
    for (o, s) in out.as_chunks_mut::<4>().0.iter_mut().zip(sums) {
        *o = s.to_le_bytes();
    }
    out
}

/// The hash on the CPU of a frame's bytes, rows top-down without padding: what the GPU pass
/// gives for the same frame.
pub fn cpu(bytes: &[u8], size: [u32; 2], format: Format, planted: Planted) -> [u8; 16] {
    let words: Vec<u32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_le_bytes(*w))
        .collect();
    let per = format.words() as usize;
    let (lanes, mut sums) = (seeds(size, format), [0u32; 4]);
    for (i, px) in (0u32..).zip(words.chunks_exact(per)) {
        for (sum, seed) in sums.iter_mut().zip(lanes) {
            let start = if planted.without_position {
                seed
            } else {
                hash1(seed ^ i)
            };
            let h = px.iter().fold(start, |h, w| hash1(h ^ w));
            *sum = if planted.without_position {
                *sum ^ h
            } else {
                sum.wrapping_add(h)
            };
        }
    }
    digest(sums)
}

/// A frame hashed on the GPU: the 16 bytes read back, and the texture's own bytes copied back
/// to the CPU, rows top-down without padding.
pub struct Hashed {
    pub gpu: [u8; 16],
    pub readback: Vec<u8>,
}

/// The pass, built once per device.
pub struct PixelHash {
    pipeline: wgpu::ComputePipeline,
}

impl PixelHash {
    pub fn new(device: &crate::counted::Wgpu, planted: Planted) -> PixelHash {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pixel hash"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("pixel hash"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions {
                constants: &[("without_position", f64::from(planted.without_position))],
                ..Default::default()
            },
            cache: None,
        });
        PixelHash { pipeline }
    }

    /// One frame: its bytes (`size` pixels of `format`, at least one) written to a texture of
    /// that format, the texture copied into a buffer and reduced there, the sums and the copy
    /// read back.
    pub fn hash(
        &self,
        device: &crate::counted::Wgpu,
        queue: &crate::counted::Queue,
        bytes: &[u8],
        size: [u32; 2],
        format: Format,
    ) -> Hashed {
        let count = size[0] * size[1];
        let row = size[0] * format.words() * 4;
        assert!(count > 0, "a frame has a pixel");
        assert_eq!(
            bytes.len() as u64,
            u64::from(row) * u64::from(size[1]),
            "a frame is width*height pixels of its format"
        );
        let extent = wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("pixel hash frame"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: format.texture(),
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        queue.write_texture(
            texture.as_image_copy(),
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(size[1]),
            },
            extent,
        );
        let padded = row.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let copied = u64::from(padded) * u64::from(size[1]);
        let buffer = |label, size, usage| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage,
                mapped_at_creation: false,
            })
        };
        use wgpu::BufferUsages as U;
        let copy = buffer(
            "pixel hash copy",
            copied,
            U::STORAGE | U::COPY_DST | U::COPY_SRC,
        );
        let copy_back = buffer("pixel hash copy back", copied, U::COPY_DST | U::MAP_READ);
        let sums_back = buffer("pixel hash sums back", 16, U::COPY_DST | U::MAP_READ);
        let groups = count.div_ceil(GROUP).clamp(1, MOST_GROUPS);
        let mut params = vec![
            count,
            format.words(),
            groups * GROUP,
            size[0],
            padded / 4,
            0,
            0,
            0,
        ];
        params.extend(seeds(size, format));
        let init = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let words: Vec<u8> = params.iter().flat_map(|w| w.to_le_bytes()).collect();
        let params = init("pixel hash params", &words, U::UNIFORM);
        let sums = init("pixel hash sums", &[0; 16], U::STORAGE | U::COPY_SRC);
        let entries = [&params, &copy, &sums].map(wgpu::Buffer::as_entire_binding);
        let entries: Vec<_> = (0u32..)
            .zip(entries)
            .map(|(binding, resource)| wgpu::BindGroupEntry { binding, resource })
            .collect();
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("pixel hash"),
            layout: &self.pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &copy,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(size[1]),
                },
            },
            extent,
        );
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(groups, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&sums, 0, &sums_back, 0, 16);
        encoder.copy_buffer_to_buffer(&copy, 0, &copy_back, 0, copied);
        let sent = queue.submit([encoder.finish()]);
        for b in [&sums_back, &copy_back] {
            b.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        }
        let _ = device.poll(wgpu::PollType::Wait {
            submission_index: Some(sent),
            timeout: None,
        });
        let read = |b: &wgpu::Buffer| {
            let view = b
                .slice(..)
                .get_mapped_range()
                .expect("a buffer maps once the pass is done");
            let out = view.to_vec();
            drop(view);
            b.unmap();
            out
        };
        let gpu = read(&sums_back).try_into().expect("the sums are 16 bytes");
        let readback = read(&copy_back)
            .chunks_exact(padded as usize)
            .flat_map(|r| r[..row as usize].to_vec())
            .collect();
        Hashed { gpu, readback }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{Backend, Gpu};

    fn noise(seed: u32, len: usize) -> Vec<u8> {
        let mut x = seed | 1;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    #[test]
    fn the_gpu_gives_the_cpu_bits_and_a_swap_moves_only_the_honest_hash() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let honest = PixelHash::new(&dev.device, Planted::default());
        let planted = Planted {
            without_position: true,
        };
        let xor = PixelHash::new(&dev.device, planted);
        for (k, format) in [Format::Rgba8, Format::Rgba16Float].into_iter().enumerate() {
            for size in [[1, 1], [3, 5], [257, 3], [1920, 1080]] {
                let len = (size[0] * size[1] * format.words() * 4) as usize;
                let frame = noise(size[0] * 31 + k as u32, len);
                let on_gpu = honest.hash(&dev.device, &dev.queue, &frame, size, format);
                assert_eq!(on_gpu.readback, frame, "{size:?} {format:?}");
                assert_eq!(
                    on_gpu.gpu,
                    cpu(&frame, size, format, Planted::default()),
                    "{size:?} {format:?}"
                );
                let xored = xor.hash(&dev.device, &dev.queue, &frame, size, format).gpu;
                assert_eq!(
                    xored,
                    cpu(&frame, size, format, planted),
                    "{size:?} {format:?}"
                );
                if size[0] * size[1] < 2 {
                    continue;
                }
                let px = (format.words() * 4) as usize;
                let mut swapped = frame.clone();
                let (a, b) = swapped.split_at_mut(px);
                a.swap_with_slice(&mut b[..px]);
                assert_ne!(cpu(&swapped, size, format, Planted::default()), on_gpu.gpu);
                assert_eq!(cpu(&swapped, size, format, planted), xored);
            }
        }
    }
}
