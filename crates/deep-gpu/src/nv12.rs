//! The export's 4:2:0 conversion on the GPU (issue #518): a frame's BGRA8 bytes, the ones
//! [`crate::blake3::Frames`] hashes, become the two planes every encode tool reads (NV12) by
//! [`crate::frame_checks::nv12`]'s fixed-point BT.709 formula, in integers, so every GPU and the
//! CPU give the same bytes. A frame's hash and [`VERSION`] name its planes on any machine. The
//! planes go into a GPU surface slot's two textures, or back through memory one frame late for a
//! tool that takes no surface. A lost device is [`Lost`], never a panic. The WGSL is `nv12.wgsl`.

use crate::blake3::Frames;
use crate::counted::{Queue, Wgpu};
use crate::frame_checks::{read_back, Lost};

const SOURCE: &str = include_str!("nv12.wgsl");
/// Invocations a workgroup covers.
const GROUP: u32 = 256;
/// The conversion's version, part of an encode job's key: it changes whenever a plane's bytes
/// would.
pub const VERSION: u32 = 1;

/// The wrong conversion a test must catch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A block's chroma is rounded down, not to nearest.
    pub chroma_rounds_down: bool,
}

/// The pipelines, built once per device.
pub struct Nv12 {
    luma: wgpu::ComputePipeline,
    chroma: wgpu::ComputePipeline,
}

/// One plane's dispatch: a workgroup row per plane row.
struct Pass {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    rows: u32,
}

/// The planes of one size of frame, in push order.
pub struct Planes {
    device: Wgpu,
    queue: Queue,
    size: [u32; 2],
    /// Bytes in a row of either plane in `out`: the width up to wgpu's copy alignment.
    stride: u32,
    passes: [Pass; 2],
    /// The Y rows, then the CbCr rows.
    out: wgpu::Buffer,
    /// Where planes are read back, in turn.
    ring: [wgpu::Buffer; 2],
    slot: usize,
    /// The last converted frame's ring slot and submission, until its planes are read.
    pending: Option<(usize, wgpu::SubmissionIndex)>,
}

impl Nv12 {
    pub fn new(device: &Wgpu, planted: Planted) -> Nv12 {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nv12"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipe = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("chroma_rounds_down", f64::from(planted.chroma_rounds_down))],
                    ..Default::default()
                },
                cache: None,
            })
        };
        Nv12 {
            luma: pipe("luma"),
            chroma: pipe("chroma"),
        }
    }

    /// The planes of each frame `frames` hashes, bound to its input buffer; `size` is the frames'
    /// own, both sides even.
    pub fn planes(&self, device: &Wgpu, queue: &Queue, frames: &Frames, size: [u32; 2]) -> Planes {
        use wgpu::BufferUsages as U;
        let [w, h] = size;
        assert!(
            w > 0 && h > 0 && w.is_multiple_of(2) && h.is_multiple_of(2),
            "NV12 takes an even width and height"
        );
        let input = frames.input();
        assert_eq!(
            input.size(),
            u64::from(w) * u64::from(h) * 4,
            "the hashed frames are width*height*4 bytes"
        );
        let stride = w.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let bytes = u64::from(stride) * u64::from(h + h / 2);
        let buffer = |label: &str, usage: U| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: bytes,
                usage,
                mapped_at_creation: false,
            })
        };
        let out = buffer("nv12 planes", U::STORAGE | U::COPY_SRC);
        let layout = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("nv12 layout"),
            size: 16,
            usage: U::UNIFORM | U::COPY_DST,
            mapped_at_creation: false,
        });
        // Written through the queue: wgpu's own init maps the new buffer and panics on a lost device.
        let words: Vec<u8> = [w, h, stride / 4, 0]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        queue.write_buffer(&layout, 0, &words);
        let pass = |pipeline: &wgpu::ComputePipeline, rows: u32| {
            let entries: Vec<_> = (0u32..)
                .zip([&layout, input, &out])
                .map(|(binding, b)| wgpu::BindGroupEntry {
                    binding,
                    resource: b.as_entire_binding(),
                })
                .collect();
            Pass {
                pipeline: pipeline.clone(),
                group: device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("nv12"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &entries,
                }),
                rows,
            }
        };
        Planes {
            device: device.clone(),
            queue: queue.clone(),
            size,
            stride,
            passes: [pass(&self.luma, h), pass(&self.chroma, h / 2)],
            ring: [(); 2].map(|()| buffer("nv12 read back", U::COPY_DST | U::MAP_READ)),
            out,
            slot: 0,
            pending: None,
        }
    }
}

impl Planes {
    /// The conversion of the frame `Frames::push` just took, into `out`.
    fn encode(&self, encoder: &mut wgpu::CommandEncoder) {
        for p in &self.passes {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&p.pipeline);
            pass.set_bind_group(0, &p.group, &[]);
            pass.dispatch_workgroups((self.stride / 4).div_ceil(GROUP), p.rows, 1);
        }
    }

    /// Call right after `Frames::push`: converts this frame and returns the NV12 bytes of the
    /// frame converted before it (`None` on the first), the Y plane then CbCr, rows unpadded,
    /// read back through memory one frame late like its digest.
    pub fn after_push(&mut self) -> Result<Option<Vec<u8>>, Lost> {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.encode(&mut encoder);
        let back = &self.ring[self.slot];
        encoder.copy_buffer_to_buffer(&self.out, 0, back, 0, back.size());
        let sent = self.queue.submit([encoder.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let before = self.pending.replace((self.slot, sent));
        self.slot ^= 1;
        before.map(|frame| self.read(frame)).transpose()
    }

    /// The last converted frame's NV12 bytes.
    pub fn finish(&mut self) -> Result<Option<Vec<u8>>, Lost> {
        self.pending
            .take()
            .map(|frame| self.read(frame))
            .transpose()
    }

    /// Call right after `Frames::push`: converts this frame into a GPU surface slot's planes,
    /// `luma` (R8, the frame's size) and `chroma` (RG8, half each side), by copies of whole
    /// bytes. The slot holds the frame's planes once the returned submission is done.
    pub fn into_slot(&self, luma: &wgpu::Texture, chroma: &wgpu::Texture) -> wgpu::SubmissionIndex {
        let [w, h] = self.size;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.encode(&mut encoder);
        let rows = [(luma, 0, [w, h]), (chroma, h, [w / 2, h / 2])];
        for (texture, first, [width, height]) in rows {
            encoder.copy_buffer_to_texture(
                wgpu::TexelCopyBufferInfo {
                    buffer: &self.out,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: u64::from(first) * u64::from(self.stride),
                        bytes_per_row: Some(self.stride),
                        rows_per_image: Some(height),
                    },
                },
                texture.as_image_copy(),
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.queue.submit([encoder.finish()])
    }

    /// Waits for one frame's work, never a later frame's, and takes its planes without the rows'
    /// padding.
    fn read(&self, (slot, sent): (usize, wgpu::SubmissionIndex)) -> Result<Vec<u8>, Lost> {
        let padded = read_back(&self.device, &self.ring[slot], sent)?;
        let w = self.size[0] as usize;
        Ok(padded
            .chunks_exact(self.stride as usize)
            .flat_map(|row| &row[..w])
            .copied()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blake3::Blake3;
    use crate::device::{Backend, Device, Gpu};
    use crate::frame_checks::nv12;

    fn noise(seed: u32, len: usize) -> Vec<u8> {
        let mut x = seed;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    /// The planes the GPU gives for each of `frames` in turn, read back through memory.
    fn converted(
        dev: &Device,
        size: [u32; 2],
        frames: &[Vec<u8>],
        planted: Planted,
    ) -> Vec<Vec<u8>> {
        let hash = Blake3::new(&dev.device, Default::default());
        let mut hashed = hash.frames(&dev.device, &dev.queue, size);
        let mut planes =
            Nv12::new(&dev.device, planted).planes(&dev.device, &dev.queue, &hashed, size);
        let mut out = Vec::new();
        for frame in frames {
            hashed.push(frame).unwrap();
            out.extend(planes.after_push().unwrap());
        }
        out.extend(planes.finish().unwrap());
        out
    }

    /// Every size's planes are the CPU reference's byte for byte, each frame its own: a width
    /// that fills its last word, one that half fills it, and one past the copy alignment.
    #[test]
    fn planes_equal_the_cpu_reference() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        for size in [[4, 4], [6, 2], [258, 6], [1920, 1080]] {
            let bytes = (size[0] * size[1] * 4) as usize;
            let frames: Vec<Vec<u8>> = (1..4).map(|seed| noise(seed, bytes)).collect();
            let got = converted(&dev, size, &frames, Planted::default());
            assert_eq!(got.len(), frames.len(), "{size:?}");
            for (k, (frame, planes)) in frames.iter().zip(&got).enumerate() {
                assert!(
                    *planes == nv12(frame, size[0], size[1]),
                    "frame {k} of {size:?} differs from the CPU reference"
                );
            }
        }
    }

    /// The planted pass rounds chroma down: a block whose chroma sits at a half differs from the
    /// reference in its CbCr plane and nowhere in its Y plane.
    #[test]
    fn chroma_rounded_down_differs_from_the_reference() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        // One 2×2 block of blue 9, SB = 36: Cb's 112 × 36 = 4,032 is 3.94 of 1,024, 4 to nearest
        // and 3 down; Cr's −10 × 36 = −360 is 0 to nearest and −1 down.
        let frame = [9, 0, 0, 255].repeat(4);
        let reference = nv12(&frame, 2, 2);
        assert_eq!(&reference[4..], [132, 128]);
        let planted = Planted {
            chroma_rounds_down: true,
        };
        let wrong = converted(&dev, [2, 2], std::slice::from_ref(&frame), planted);
        assert_eq!(wrong[0][..4], reference[..4]);
        assert_eq!(&wrong[0][4..], [131, 127]);
        let right = converted(&dev, [2, 2], &[frame], Planted::default());
        assert_eq!(right[0], reference);
    }

    /// The copies into a slot's two textures carry the same bytes as the read back through memory.
    #[test]
    fn a_slot_holds_the_planes() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let size = [258u32, 6];
        let frame = noise(7, (size[0] * size[1] * 4) as usize);
        let hash = Blake3::new(&dev.device, Default::default());
        let mut hashed = hash.frames(&dev.device, &dev.queue, size);
        let planes = Nv12::new(&dev.device, Planted::default()).planes(
            &dev.device,
            &dev.queue,
            &hashed,
            size,
        );
        let texture = |format, [width, height]: [u32; 2]| {
            dev.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("nv12 test slot"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            })
        };
        let luma = texture(wgpu::TextureFormat::R8Unorm, size);
        let chroma = texture(wgpu::TextureFormat::Rg8Unorm, size.map(|n| n / 2));
        hashed.push(&frame).unwrap();
        planes.into_slot(&luma, &chroma);
        let read = |texture: &wgpu::Texture, row: u32| {
            let stride = row.next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
            let back = dev.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("nv12 test read back"),
                size: u64::from(stride) * u64::from(texture.height()),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut encoder = dev.device.create_command_encoder(&Default::default());
            encoder.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &back,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(stride),
                        rows_per_image: Some(texture.height()),
                    },
                },
                texture.size(),
            );
            let sent = dev.queue.submit([encoder.finish()]);
            back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
            let padded = read_back(&dev.device, &back, sent).unwrap();
            padded
                .chunks_exact(stride as usize)
                .flat_map(|r| &r[..row as usize])
                .copied()
                .collect::<Vec<u8>>()
        };
        let got = [read(&luma, size[0]), read(&chroma, size[0])].concat();
        assert!(got == nv12(&frame, size[0], size[1]));
    }
}
