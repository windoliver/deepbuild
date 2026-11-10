//! BLAKE3 of each exported frame on the GPU (issue #501): a frame's BGRA8 rows, top-down and
//! unpadded, hashed by compute passes, the 32-byte digest read back one frame late. The WGSL is
//! `blake3.wgsl`.

use wgpu::util::DeviceExt as _;

const SOURCE: &str = include_str!("blake3.wgsl");
/// Invocations a workgroup covers.
const GROUP: u32 = 64;
/// Message words (pixels) in a 1,024-byte chunk.
const CHUNK_WORDS: u32 = 256;

/// The wrong hash a test must catch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A parent node compresses (right, left).
    pub joins_right_left: bool,
}

/// The pipelines, built once per device.
pub struct Blake3 {
    chunk: wgpu::ComputePipeline,
    parent: wgpu::ComputePipeline,
}

/// One dispatch of a frame's hash.
struct Pass {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    groups: u32,
}

/// The hashes of one size of frame, in push order.
pub struct Frames {
    device: wgpu::Device,
    queue: wgpu::Queue,
    input: wgpu::Buffer,
    /// The chunk pass, then a parent pass per tree level.
    passes: Vec<Pass>,
    /// The node buffer the last pass writes: its first 8 words are the digest.
    root: wgpu::Buffer,
    /// Where digests are read back, in turn.
    ring: [wgpu::Buffer; 2],
    slot: usize,
    /// The last pushed frame's ring slot and submission, until its digest is read.
    pending: Option<(usize, wgpu::SubmissionIndex)>,
}

impl Blake3 {
    pub fn new(device: &wgpu::Device, planted: Planted) -> Blake3 {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("blake3"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipe = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("joins_right_left", f64::from(planted.joins_right_left))],
                    ..Default::default()
                },
                cache: None,
            })
        };
        Blake3 {
            chunk: pipe("chunk"),
            parent: pipe("parent"),
        }
    }

    /// The hashes of frames of `size` pixels (at least one), with buffers made once for it.
    pub fn frames(&self, device: &wgpu::Device, queue: &wgpu::Queue, size: [u32; 2]) -> Frames {
        let words = size[0] * size[1];
        let chunks = words.div_ceil(CHUNK_WORDS);
        let buffer = |label: &str, bytes: u64, usage: wgpu::BufferUsages| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: bytes,
                usage,
                mapped_at_creation: false,
            })
        };
        let storage = wgpu::BufferUsages::STORAGE;
        let input = buffer(
            "blake3 frame",
            u64::from(words) * 4,
            storage | wgpu::BufferUsages::COPY_DST,
        );
        // A level's nodes, 8 words each: the chunks' in the first, then each level in the other.
        let nodes = [chunks, chunks.div_ceil(2)].map(|n| {
            buffer(
                "blake3 nodes",
                u64::from(n) * 32,
                storage | wgpu::BufferUsages::COPY_SRC,
            )
        });
        let pass = |pipeline: &wgpu::ComputePipeline,
                    count: u32,
                    src: &wgpu::Buffer,
                    dst: &wgpu::Buffer,
                    invocations: u32| {
            let count = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("blake3 count"),
                contents: &count.to_le_bytes(),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let entries = [&count, src, dst].map(wgpu::Buffer::as_entire_binding);
            let entries: Vec<_> = (0u32..)
                .zip(entries)
                .map(|(binding, resource)| wgpu::BindGroupEntry { binding, resource })
                .collect();
            Pass {
                pipeline: pipeline.clone(),
                group: device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("blake3"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &entries,
                }),
                groups: invocations.div_ceil(GROUP),
            }
        };
        let mut passes = vec![pass(&self.chunk, words, &input, &nodes[0], chunks)];
        let (mut count, mut at) = (chunks, 0);
        while count > 1 {
            let above = count.div_ceil(2);
            passes.push(pass(&self.parent, count, &nodes[at], &nodes[1 - at], above));
            (count, at) = (above, 1 - at);
        }
        let back = wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ;
        Frames {
            device: device.clone(),
            queue: queue.clone(),
            input,
            passes,
            root: nodes[at].clone(),
            ring: [(); 2].map(|()| buffer("blake3 digest", 32, back)),
            slot: 0,
            pending: None,
        }
    }
}

impl Frames {
    /// Hashes this frame on the GPU and returns the digest of the frame pushed before it (`None`
    /// on the first push).
    pub fn push(&mut self, bgra: &[u8]) -> Option<[u8; 32]> {
        assert_eq!(
            bgra.len() as u64,
            self.input.size(),
            "a frame is width*height*4 bytes"
        );
        self.queue.write_buffer(&self.input, 0, bgra);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        for p in &self.passes {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&p.pipeline);
            pass.set_bind_group(0, &p.group, &[]);
            pass.dispatch_workgroups(p.groups, 1, 1);
        }
        let back = &self.ring[self.slot];
        encoder.copy_buffer_to_buffer(&self.root, 0, back, 0, 32);
        let sent = self.queue.submit([encoder.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let before = self.pending.replace((self.slot, sent));
        self.slot ^= 1;
        before.map(|frame| self.read(frame))
    }

    /// The last pushed frame's digest.
    pub fn finish(&mut self) -> Option<[u8; 32]> {
        self.pending.take().map(|frame| self.read(frame))
    }

    /// Waits for one frame's work, never a later frame's, and takes its digest.
    fn read(&self, (slot, sent): (usize, wgpu::SubmissionIndex)) -> [u8; 32] {
        let _ = self.device.poll(wgpu::PollType::Wait {
            submission_index: Some(sent),
            timeout: None,
        });
        let back = &self.ring[slot];
        let view = back
            .slice(..)
            .get_mapped_range()
            .expect("the digest maps once its frame's work is done");
        let digest = view[..].try_into().expect("the digest is 32 bytes");
        drop(view);
        back.unmap();
        digest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{Backend, Device, Gpu};

    /// The official test vectors' input: byte i is i % 251.
    fn vector(len: u32) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    fn noise(seed: u32, len: u32) -> Vec<u8> {
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

    fn hex(digest: [u8; 32]) -> String {
        digest.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn cpu(bytes: &[u8]) -> String {
        blake3::hash(bytes).to_hex().to_string()
    }

    fn gpu(dev: &Device, hash: &Blake3, size: [u32; 2], bytes: &[u8]) -> String {
        let mut frames = hash.frames(&dev.device, &dev.queue, size);
        assert_eq!(frames.push(bytes), None);
        hex(frames.finish().unwrap())
    }

    #[test]
    fn published_vectors_match() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let hash = Blake3::new(&dev.device, Planted::default());
        // BLAKE3's test_vectors.json, the `hash` of input_len 1024, 4096 and 102400.
        for (side, published) in [
            (
                16,
                "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7",
            ),
            (
                32,
                "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969",
            ),
            (
                160,
                "bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085",
            ),
        ] {
            let input = vector(side * side * 4);
            assert_eq!(gpu(&dev, &hash, [side; 2], &input), published, "{side}");
            assert_eq!(cpu(&input), published, "{side}");
        }
    }

    #[test]
    fn ragged_frames_match_the_cpu() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let hash = Blake3::new(&dev.device, Planted::default());
        // 1, 1, 2, 9 and 8,100 chunks, then 3, 5, 6 and 7.
        for size in [
            [1, 1],
            [17, 1],
            [257, 1],
            [300, 7],
            [1920, 1080],
            [600, 1],
            [1280, 1],
            [1500, 1],
            [1700, 1],
        ] {
            let input = noise(size[0], size[0] * size[1] * 4);
            assert_eq!(gpu(&dev, &hash, size, &input), cpu(&input), "{size:?}");
        }
    }

    #[test]
    fn a_digest_comes_one_frame_late() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let hash = Blake3::new(&dev.device, Planted::default());
        let mut frames = hash.frames(&dev.device, &dev.queue, [32, 32]);
        let [a, b, c] = [1, 2, 3].map(|seed| noise(seed, 4096));
        assert_eq!(frames.push(&a), None);
        assert_eq!(frames.push(&b).map(hex), Some(cpu(&a)));
        assert_eq!(frames.push(&c).map(hex), Some(cpu(&b)));
        assert_eq!(frames.finish().map(hex), Some(cpu(&c)));
    }

    #[test]
    fn a_wrong_order_join_changes_the_digest() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let planted = Blake3::new(
            &dev.device,
            Planted {
                joins_right_left: true,
            },
        );
        // One chunk has no join; four have three.
        let (one, four) = (vector(1024), vector(4096));
        assert_eq!(gpu(&dev, &planted, [16, 16], &one), cpu(&one));
        assert_ne!(gpu(&dev, &planted, [32, 32], &four), cpu(&four));
    }
}
