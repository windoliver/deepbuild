//! The export's per-frame GPU checks (issue #157): integer reductions every GPU gives the same
//! answer to, a few bytes read back. [`Stats`] reads each frame [`crate::blake3::Frames`] hashes,
//! one frame late like its digest: the dark pixels by the blank guard's rule, a luma histogram and
//! the byte difference from the frame before, and at the end the film's wrap change. [`finite`]
//! counts a float render target's non-finite texels by their bits. [`nv12`] is the conversion the
//! encode tool receives, and [`Compare`] scores a decoded plane against redrawn frames' planes by
//! that conversion's luma (export.fidelity). [`cpu`] is a [`Stats`] reading on the CPU. A lost
//! device is [`Lost`], never a panic. The WGSL is `frame_checks.wgsl`.

use crate::blake3::Frames;
use crate::counted::{Queue, Wgpu, Written};

const SOURCE: &str = include_str!("frame_checks.wgsl");
/// Invocations a workgroup covers.
const GROUP: u32 = 256;
/// The most workgroups one dispatch takes along x.
const MOST_GROUPS: u32 = 65_535;
/// Pixels each invocation of the stats pass walks, so few workgroup sums reach the totals.
const PER_INVOCATION: u32 = 16;
/// Words the stats pass writes: the dark count, the difference sum's two words, a pad, 256 bins.
const SUMS_WORDS: u64 = 260;
/// A pixel is dark when its luma sum (10,000 times the luma, in 8-bit steps) is below this: the
/// blank guard's f64 rule reads both colours whose sum is exactly 153,000, (R, G, B) = (19, 11,
/// 47) and (36, 1, 96), as 0.060000000000000005, above 0.06.
const DARK_BELOW: u32 = 153_000;
/// A block's SSIM s adds round((s + 1) · 2^20) to the compare pass's sum.
const SSIM_ONE: f64 = 1_048_576.0;

/// The device was lost, or a reading failed to map back: the check has no reading.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lost;

/// Waits for submission `sent` and takes `back`'s bytes, whose map its caller asked for after
/// submitting; a map that failed, as on a lost device, is [`Lost`].
pub(crate) fn read_back(
    device: &Wgpu,
    back: &wgpu::Buffer,
    sent: wgpu::SubmissionIndex,
) -> Result<Vec<u8>, Lost> {
    let _ = device.poll(wgpu::PollType::Wait {
        submission_index: Some(sent),
        timeout: None,
    });
    let view = back.slice(..).get_mapped_range().map_err(|_| Lost)?;
    let out = view.to_vec();
    drop(view);
    back.unmap();
    Ok(out)
}

/// Submits `encoder`, whose last command copies into `back`, and reads `back` once it's done.
fn run(
    device: &Wgpu,
    queue: &Queue,
    encoder: wgpu::CommandEncoder,
    back: &wgpu::Buffer,
) -> Result<Vec<u32>, Lost> {
    let sent = queue.submit([encoder.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    Ok(words(&read_back(device, back, sent)?))
}

fn words(bytes: &[u8]) -> Vec<u32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_le_bytes(*w))
        .collect()
}

fn bytes(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// A 64-bit sum from its two words.
fn wide(low: u32, high: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

/// Workgroups for `count` items, `per` to an invocation.
fn groups(count: u32, per: u32) -> u32 {
    count.div_ceil(GROUP * per).clamp(1, MOST_GROUPS)
}

fn buffer(device: &Wgpu, label: &str, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: false,
    })
}

/// A uniform of `words`, written through the queue: wgpu's own init maps the new buffer and
/// panics when the device is lost.
fn uniform(device: &Wgpu, queue: &Queue, label: &str, words: &[u32]) -> wgpu::Buffer {
    let usage = wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST;
    let b = buffer(device, label, words.len() as u64 * 4, usage);
    queue.write_buffer(&b, 0, &bytes(words));
    b
}

fn pipeline(device: &Wgpu, entry: &str, carry_dropped: bool) -> wgpu::ComputePipeline {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("frame checks"),
        source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
    });
    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(entry),
        layout: None,
        module: &module,
        entry_point: Some(entry),
        compilation_options: wgpu::PipelineCompilationOptions {
            constants: &[("carry_dropped", f64::from(carry_dropped))],
            ..Default::default()
        },
        cache: None,
    })
}

/// One dispatch: its pipeline, what it binds from binding 0 on, and its workgroups.
struct Pass {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    groups: u32,
}

impl Pass {
    fn new(
        device: &Wgpu,
        pipeline: &wgpu::ComputePipeline,
        buffers: &[&wgpu::Buffer],
        groups: u32,
    ) -> Pass {
        let entries: Vec<_> = (0u32..)
            .zip(buffers)
            .map(|(binding, b)| wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            })
            .collect();
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("frame checks"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        });
        Pass {
            pipeline: pipeline.clone(),
            group,
            groups,
        }
    }

    fn encode(&self, encoder: &mut wgpu::CommandEncoder) {
        let mut pass = encoder.begin_compute_pass(&Default::default());
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        pass.dispatch_workgroups(self.groups, 1, 1);
    }
}

/// What [`Stats`] reads of one frame of straight BGRA8 pixels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    /// Pixels whose luma, as the pixel shows over black, is at or under 0.06 as the blank guard
    /// reads it: exactly 2126·R' + 7152·G' + 722·B' < 153,000, with R' = (R·A + 127) / 255
    /// (integer) etc. (`<`, since the guard's f64 sum puts the two colours at exactly 153,000
    /// above 0.06).
    pub dark: u64,
    pub pixels: u64,
    /// 256 bins of L = (2126·R' + 7152·G' + 722·B' + 5,000) / 10,000 (integer division).
    pub histogram: [u32; 256],
    /// Sum over all bytes of |this − previous| of the BGRA8 bytes; None for the first frame.
    pub diff: Option<u64>,
}

/// 10,000 times the Rec. 709 luma of a straight BGRA8 pixel as it shows over black.
fn luma_sum([b, g, r, a]: [u8; 4]) -> u32 {
    let over_black = |c: u8| (u32::from(c) * u32::from(a) + 127) / 255;
    2126 * over_black(r) + 7152 * over_black(g) + 722 * over_black(b)
}

/// The reading of `bgra` on the CPU, after `prev` when there is one: what the GPU gives.
pub fn cpu(bgra: &[u8], prev: Option<&[u8]>) -> Reading {
    let mut reading = Reading {
        dark: 0,
        pixels: (bgra.len() / 4) as u64,
        histogram: [0; 256],
        diff: None,
    };
    for px in bgra.as_chunks::<4>().0 {
        let s = luma_sum(*px);
        reading.dark += u64::from(s < DARK_BELOW);
        reading.histogram[((s + 5_000) / 10_000) as usize] += 1;
    }
    reading.diff = prev.map(|prev| {
        assert_eq!(prev.len(), bgra.len(), "frames of one size");
        bgra.iter()
            .zip(prev)
            .map(|(a, b)| u64::from(a.abs_diff(*b)))
            .sum()
    });
    reading
}

/// NV12's Y of a straight 8-bit colour.
fn luma(r: u8, g: u8, b: u8) -> u8 {
    (16 + ((47 * u32::from(r) + 157 * u32::from(g) + 16 * u32::from(b) + 128) >> 8)) as u8
}

/// The NV12 bytes of a straight BGRA8 frame of even width and height, as the encode tool receives
/// them: the Y plane, w×h, then CbCr interleaved, (w/2)×(h/2)×2. Y = 16 + ((47·R + 157·G + 16·B +
/// 128) >> 8); each 2×2 block, with SR, SG, SB the sums of its four pixels, gives
/// Cb = 128 + ((−26·SR − 86·SG + 112·SB + 512) >> 10) and Cr = 128 + ((112·SR − 102·SG − 10·SB +
/// 512) >> 10), the shift a floor. Alpha is not read.
pub fn nv12(bgra: &[u8], w: u32, h: u32) -> Vec<u8> {
    assert!(
        w.is_multiple_of(2) && h.is_multiple_of(2),
        "NV12 takes an even width and height"
    );
    let (w, h) = (w as usize, h as usize);
    assert_eq!(bgra.len(), w * h * 4, "a frame is width*height*4 bytes");
    let mut out = vec![0; w * h * 3 / 2];
    let (ys, chroma) = out.split_at_mut(w * h);
    for (y, p) in ys.iter_mut().zip(bgra.as_chunks::<4>().0) {
        *y = luma(p[2], p[1], p[0]);
    }
    for (row, pair) in chroma.chunks_exact_mut(w).zip(bgra.chunks_exact(w * 8)) {
        let (top, bottom) = pair.split_at(w * 4);
        let blocks = top.as_chunks::<8>().0.iter().zip(bottom.as_chunks::<8>().0);
        for (c, (t, b)) in row.as_chunks_mut::<2>().0.iter_mut().zip(blocks) {
            let sum = |i: usize| {
                i32::from(t[i]) + i32::from(t[i + 4]) + i32::from(b[i]) + i32::from(b[i + 4])
            };
            let (sb, sg, sr) = (sum(0), sum(1), sum(2));
            c[0] = (128 + ((-26 * sr - 86 * sg + 112 * sb + 512) >> 10)) as u8;
            c[1] = (128 + ((112 * sr - 102 * sg - 10 * sb + 512) >> 10)) as u8;
        }
    }
    out
}

/// The sums of the luma plane [`Compare::reference`] derives from a straight BGRA8 frame (its
/// colour premultiplied first when `premultiplied`) and of its alpha: a plane's level, which
/// export.fidelity holds a decoded plane to when SSIM speaks for a frame PSNR doesn't.
pub fn plane_sums(bgra: &[u8], premultiplied: bool) -> [u64; 2] {
    let by = |c: u8, a: u8| {
        if premultiplied {
            ((u32::from(c) * u32::from(a) + 127) / 255) as u8
        } else {
            c
        }
    };
    bgra.as_chunks::<4>().0.iter().fold([0, 0], |[y, a], p| {
        [
            y + u64::from(luma(by(p[2], p[3]), by(p[1], p[3]), by(p[0], p[3]))),
            a + u64::from(p[3]),
        ]
    })
}

/// The checks' pipelines, built once per device.
pub struct FrameChecks {
    stats: wgpu::ComputePipeline,
    derive: wgpu::ComputePipeline,
    compare: wgpu::ComputePipeline,
}

impl FrameChecks {
    pub fn new(device: &Wgpu) -> FrameChecks {
        FrameChecks::built(device, false)
    }

    /// The checks, the stats pass's difference sum dropping its carry when `carry_dropped`: the
    /// planted wrong reduction a test must catch.
    fn built(device: &Wgpu, carry_dropped: bool) -> FrameChecks {
        FrameChecks {
            stats: pipeline(device, "stats", carry_dropped),
            derive: pipeline(device, "derive", carry_dropped),
            compare: pipeline(device, "compare", carry_dropped),
        }
    }

    /// Readings of each frame `frames` hashes, bound to its input buffer.
    pub fn stats(&self, device: &Wgpu, queue: &Queue, frames: &Frames) -> Stats {
        use wgpu::BufferUsages as U;
        let input = frames.input().clone();
        let size = input.size();
        let count = (size / 4) as u32;
        let copy = |label| buffer(device, label, size, U::STORAGE | U::COPY_DST);
        let (before, kept) = (copy("frame checks before"), copy("frame checks kept"));
        let sums = buffer(
            device,
            "frame checks sums",
            SUMS_WORDS * 4,
            U::STORAGE | U::COPY_SRC | U::COPY_DST,
        );
        let groups = groups(count, PER_INVOCATION);
        let params = uniform(
            device,
            queue,
            "frame checks stats",
            &[count, groups * GROUP, 0, 0],
        );
        let pass = |other| {
            Pass::new(
                device,
                &self.stats,
                &[&params, &input, other, &sums],
                groups,
            )
        };
        let (frame, wrap) = (pass(&before), pass(&kept));
        let back = |label, size| buffer(device, label, size, U::COPY_DST | U::MAP_READ);
        Stats {
            device: device.clone(),
            queue: queue.clone(),
            pixels: u64::from(count),
            frame,
            wrap,
            input,
            before,
            kept,
            sums,
            ring: [(); 2].map(|()| back("frame checks reading", SUMS_WORDS * 4)),
            wrap_back: back("frame checks wrap", 16),
            slot: 0,
            pending: None,
            pushed: false,
            has_kept: false,
        }
    }

    /// Fidelity scores of decoded frames of `size` (even sides), with buffers made once for it.
    pub fn compare(&self, device: &Wgpu, queue: &Queue, size: [u32; 2]) -> Compare {
        use wgpu::BufferUsages as U;
        let [w, h] = size;
        assert!(
            w > 0 && h > 0 && w.is_multiple_of(2) && h.is_multiple_of(2),
            "a frame NV12 takes has even sides"
        );
        let pixels = u64::from(w) * u64::from(h);
        let quads = (pixels / 4) as u32;
        let blocks = w.div_ceil(8) * h.div_ceil(8);
        let raw = buffer(
            device,
            "compare frame",
            pixels * 4,
            U::STORAGE | U::COPY_DST,
        );
        // Three references, each its luma plane then its alpha plane.
        let planes = buffer(device, "compare references", pixels * 6, U::STORAGE);
        let decoded = buffer(device, "compare decoded", pixels, U::STORAGE | U::COPY_DST);
        let scores = buffer(
            device,
            "compare scores",
            48,
            U::STORAGE | U::COPY_SRC | U::COPY_DST,
        );
        // The compare pass takes 32 blocks to a workgroup.
        let (derive_groups, compare_groups) = (groups(quads, 1), blocks.div_ceil(32));
        assert!(compare_groups <= MOST_GROUPS, "a frame up to 8192×8192");
        let params = |label, words: u64| buffer(device, label, words * 4, U::UNIFORM | U::COPY_DST);
        let (derive_params, block_params) =
            (params("compare derive", 8), params("compare blocks", 12));
        Compare {
            device: device.clone(),
            queue: queue.clone(),
            size,
            derive: Pass::new(
                device,
                &self.derive,
                &[&derive_params, &raw, &planes],
                derive_groups,
            ),
            compare: Pass::new(
                device,
                &self.compare,
                &[&block_params, &decoded, &planes, &scores],
                compare_groups,
            ),
            raw,
            // Mapped whenever no compare runs: a decoded plane is copied in, never staged anew.
            staging: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("compare staging"),
                size: pixels,
                usage: U::MAP_WRITE | U::COPY_SRC,
                mapped_at_creation: true,
            }),
            decoded,
            derive_params,
            block_params,
            written: Written::default(),
            scores,
            back: buffer(device, "compare back", 48, U::COPY_DST | U::MAP_READ),
            kept: [None; 3],
            uploads: 0,
        }
    }
}

/// The readings of one size of frame, in push order.
pub struct Stats {
    device: Wgpu,
    queue: Queue,
    pixels: u64,
    /// The pushed frame against the one before it, and against the kept one.
    frame: Pass,
    wrap: Pass,
    /// [`Frames`]' input, then copies of the frame before and of the kept frame.
    input: wgpu::Buffer,
    before: wgpu::Buffer,
    kept: wgpu::Buffer,
    sums: wgpu::Buffer,
    /// Where readings are read back, in turn.
    ring: [wgpu::Buffer; 2],
    wrap_back: wgpu::Buffer,
    slot: usize,
    /// The last frame's ring slot and submission, and whether a frame came before it.
    pending: Option<(usize, wgpu::SubmissionIndex, bool)>,
    pushed: bool,
    has_kept: bool,
}

impl Stats {
    /// Call right after `Frames::push`: encodes this frame's reductions and returns the reading of
    /// the frame pushed before it (one frame late, like the digest).
    pub fn after_push(&mut self) -> Result<Option<Reading>, Lost> {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.clear_buffer(&self.sums, 0, None);
        self.frame.encode(&mut encoder);
        encoder.copy_buffer_to_buffer(&self.input, 0, &self.before, 0, self.input.size());
        let back = &self.ring[self.slot];
        encoder.copy_buffer_to_buffer(&self.sums, 0, back, 0, back.size());
        let sent = self.queue.submit([encoder.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let follows = std::mem::replace(&mut self.pushed, true);
        let before = self.pending.replace((self.slot, sent, follows));
        self.slot ^= 1;
        before.map(|frame| self.read(frame)).transpose()
    }

    /// The last frame's reading.
    pub fn finish(&mut self) -> Result<Option<Reading>, Lost> {
        self.pending
            .take()
            .map(|frame| self.read(frame))
            .transpose()
    }

    /// Keeps the frame just pushed as the one `wrap` compares the last frame with (the caller
    /// calls it after the film's first frame).
    pub fn keep(&mut self) {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(&self.input, 0, &self.kept, 0, self.input.size());
        self.queue.submit([encoder.finish()]);
        self.has_kept = true;
    }

    /// Sum over all bytes of |last − kept| of the BGRA8 bytes (film.wrap's change, before the
    /// mean). A frame was kept first.
    pub fn wrap(&mut self) -> Result<u64, Lost> {
        assert!(
            self.has_kept,
            "the wrap compares the last frame with a kept one"
        );
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.clear_buffer(&self.sums, 0, None);
        self.wrap.encode(&mut encoder);
        encoder.copy_buffer_to_buffer(&self.sums, 0, &self.wrap_back, 0, 16);
        let w = run(&self.device, &self.queue, encoder, &self.wrap_back)?;
        Ok(wide(w[1], w[2]))
    }

    /// Waits for one frame's work, never a later frame's, and takes its reading.
    fn read(
        &self,
        (slot, sent, follows): (usize, wgpu::SubmissionIndex, bool),
    ) -> Result<Reading, Lost> {
        let w = words(&read_back(&self.device, &self.ring[slot], sent)?);
        let mut histogram = [0; 256];
        histogram.copy_from_slice(&w[4..]);
        Ok(Reading {
            dark: u64::from(w[0]),
            pixels: self.pixels,
            histogram,
            diff: follows.then(|| wide(w[1], w[2])),
        })
    }
}

/// A float render target's non-finite texels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Finite {
    pub count: u64,
    /// The lowest-index such texel, `[x, y]`.
    pub first: Option<[u32; 2]>,
}

/// Copies `texture` (rgba16float, rgba32float or r32float) into a buffer and counts texels with a
/// non-finite component by an integer bit test on the raw bits (exponent all ones), exact on
/// every GPU; `first` is the lowest-index such texel.
pub fn finite(device: &Wgpu, queue: &Queue, texture: &wgpu::Texture) -> Result<Finite, Lost> {
    use wgpu::BufferUsages as U;
    let (words, halves) = match texture.format() {
        wgpu::TextureFormat::Rgba16Float => (2, true),
        wgpu::TextureFormat::Rgba32Float => (4, false),
        wgpu::TextureFormat::R32Float => (1, false),
        other => panic!("finite reads rgba16float, rgba32float or r32float, not {other:?}"),
    };
    let [w, h] = [texture.width(), texture.height()];
    let padded = (w * words * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let copy = buffer(
        device,
        "finite copy",
        u64::from(padded) * u64::from(h),
        U::STORAGE | U::COPY_DST,
    );
    let found = buffer(device, "finite found", 8, U::STORAGE | U::COPY_SRC);
    let back = buffer(device, "finite back", 8, U::COPY_DST | U::MAP_READ);
    let count = w * h;
    let groups = groups(count, PER_INVOCATION);
    let params = uniform(
        device,
        queue,
        "finite",
        &[
            count,
            w,
            padded / 4,
            words,
            u32::from(halves),
            groups * GROUP,
            0,
            0,
        ],
    );
    let pass = Pass::new(
        device,
        &pipeline(device, "nonfinite", false),
        &[&params, &copy, &found],
        groups,
    );
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &copy,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    pass.encode(&mut encoder);
    encoder.copy_buffer_to_buffer(&found, 0, &back, 0, 8);
    let out = run(device, queue, encoder, &back)?;
    Ok(Finite {
        count: u64::from(out[0]),
        first: (out[1] != 0).then(|| {
            let i = !out[1];
            [i % w, i / w]
        }),
    })
}

/// A plane of a decoded frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plane {
    Luma,
    Alpha,
}

/// A decoded plane against a reference plane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Score {
    /// Sum of squared differences, exact.
    pub sse: u64,
    pub samples: u64,
    /// The mean SSIM of the 8×8 blocks, the last in a row or column narrower when a side isn't a
    /// multiple of 8.
    pub ssim: f64,
}

/// Fidelity scores of one size of frame against the last three redrawn references.
pub struct Compare {
    device: Wgpu,
    queue: Queue,
    size: [u32; 2],
    derive: Pass,
    compare: Pass,
    raw: wgpu::Buffer,
    staging: wgpu::Buffer,
    decoded: wgpu::Buffer,
    derive_params: wgpu::Buffer,
    block_params: wgpu::Buffer,
    /// What the compare pass's parameters were last written as.
    written: Written,
    scores: wgpu::Buffer,
    back: wgpu::Buffer,
    /// Each reference slot's frame and upload count.
    kept: [Option<(i64, u64)>; 3],
    uploads: u64,
}

impl Compare {
    fn pixels(&self) -> u64 {
        u64::from(self.size[0]) * u64::from(self.size[1])
    }

    /// Uploads a redrawn raw frame k (straight BGRA8) as a reference; derives on the GPU its luma
    /// plane by [`nv12`]'s Y (premultiplied first when `premultiplied` is true: c·a/255 rounded)
    /// and its alpha plane. Keeps the last three references (k−1, k, k+1). It waits for nothing:
    /// a loss shows at the next [`Compare::compare`].
    pub fn reference(&mut self, k: i64, bgra: &[u8], premultiplied: bool) -> Result<(), Lost> {
        let pixels = self.pixels();
        assert_eq!(
            bgra.len() as u64,
            pixels * 4,
            "a reference is width*height*4 bytes"
        );
        // Frame k's own slot, else an empty one, else the oldest upload's.
        let slot = self
            .kept
            .iter()
            .position(|s| s.is_some_and(|(j, _)| j == k))
            .or_else(|| (0..3).min_by_key(|&s| self.kept[s].map(|(_, at)| at)))
            .unwrap_or_default();
        self.uploads += 1;
        self.kept[slot] = Some((k, self.uploads));
        let plane = (pixels / 4) as u32;
        let base = slot as u32 * 2 * plane;
        let threads = self.derive.groups * GROUP;
        let params = [
            plane,
            threads,
            base,
            base + plane,
            u32::from(premultiplied),
            0,
            0,
            0,
        ];
        self.queue.write_buffer(&self.raw, 0, bgra);
        self.queue
            .write_buffer(&self.derive_params, 0, &bytes(&params));
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.derive.encode(&mut encoder);
        self.queue.submit([encoder.finish()]);
        Ok(())
    }

    /// A decoded plane (8-bit, w×h) against reference k and against each other kept reference:
    /// (k, Score) per kept reference, own first, the others by frame. SSE is exact; SSIM is the
    /// mean over 8×8 blocks (C1 = (0.01·255)², C2 = (0.03·255)²), computed on the GPU in f32 per
    /// block from exact integer sums and reduced in fixed point without reading blocks back.
    pub fn compare(
        &mut self,
        plane: Plane,
        decoded: &[u8],
        k: i64,
    ) -> Result<Vec<(i64, Score)>, Lost> {
        let pixels = self.pixels();
        assert_eq!(
            decoded.len() as u64,
            pixels,
            "a decoded plane is width*height bytes"
        );
        let mut order: Vec<(i64, u32)> = (0u32..)
            .zip(self.kept)
            .filter_map(|(slot, s)| s.map(|(j, _)| (j, slot)))
            .collect();
        order.sort_by_key(|&(j, _)| (j != k, j));
        assert!(
            order.first().is_some_and(|&(j, _)| j == k),
            "reference {k} is kept"
        );
        let plane_words = (pixels / 4) as u32;
        let offset = match plane {
            Plane::Luma => 0,
            Plane::Alpha => plane_words,
        };
        let mut bases = [0; 4];
        for (b, &(_, slot)) in bases.iter_mut().zip(&order) {
            *b = slot * 2 * plane_words + offset;
        }
        let [w, h] = self.size;
        let blocks = w.div_ceil(8) * h.div_ceil(8);
        let refs = order.len() as u32;
        let mut params = vec![w, h, w.div_ceil(8), blocks, refs, 0, 0, 0];
        params.extend(bases);
        self.queue
            .write_changed(&self.block_params, &self.written, &bytes(&params));
        self.staging
            .slice(..)
            .get_mapped_range_mut()
            .map_err(|_| Lost)?
            .copy_from_slice(decoded);
        self.staging.unmap();
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(&self.staging, 0, &self.decoded, 0, pixels);
        encoder.clear_buffer(&self.scores, 0, None);
        self.compare.encode(&mut encoder);
        encoder.copy_buffer_to_buffer(&self.scores, 0, &self.back, 0, 48);
        let sent = self.queue.submit([encoder.finish()]);
        self.back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        // Mapped again by the time the scores are read.
        self.staging
            .slice(..)
            .map_async(wgpu::MapMode::Write, |_| {});
        let out = words(&read_back(&self.device, &self.back, sent)?);
        Ok(order
            .iter()
            .zip(out.as_chunks::<4>().0)
            .map(|(&(j, _), s)| {
                let ssim = wide(s[2], s[3]) as f64 / (SSIM_ONE * f64::from(blocks)) - 1.0;
                (
                    j,
                    Score {
                        sse: wide(s[0], s[1]),
                        samples: pixels,
                        ssim,
                    },
                )
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;
    use crate::blake3::{Blake3, Planted};
    use crate::device::{Backend, Device, Gpu};

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
    fn the_dark_rule_is_the_blank_guards_on_every_opaque_colour() {
        for i in 0u32..1 << 24 {
            let px = [i as u8, (i >> 8) as u8, (i >> 16) as u8, 255];
            assert_eq!(
                cpu(&px, None).dark == 1,
                crate::guard::is_blank(&px),
                "BGRA {px:?}"
            );
        }
    }

    #[test]
    fn known_pixels_read_as_their_luma() {
        // BGRA: black, white, opaque red, white at alpha 128, and (R, G, B) = (19, 11, 47), whose
        // luma sum is exactly 153,000.
        let frame = [
            0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 128, 47, 11, 19, 255,
        ];
        let reading = cpu(&frame, Some(&[0; 20]));
        let mut histogram = [0; 256];
        for bin in [0, 255, 54, 128, 15] {
            histogram[bin] += 1;
        }
        assert_eq!(
            reading,
            Reading {
                dark: 1,
                pixels: 5,
                histogram,
                diff: Some(3010),
            }
        );
    }

    #[test]
    fn stats_are_the_cpu_twins_one_frame_late() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let hash = Blake3::new(&dev.device, Planted::default());
        let checks = FrameChecks::new(&dev.device);
        for size in [[1, 1], [3, 5], [257, 3], [1920, 1080]] {
            let len = (size[0] * size[1] * 4) as usize;
            let [a, b, c] = [1, 2, 3].map(|s| noise(size[0] * 7 + s, len));
            let mut frames = hash.frames(&dev.device, &dev.queue, size);
            let mut stats = checks.stats(&dev.device, &dev.queue, &frames);
            assert_eq!(frames.push(&a), Ok(None));
            assert_eq!(stats.after_push(), Ok(None), "{size:?}");
            stats.keep();
            frames.push(&b).unwrap();
            assert_eq!(stats.after_push(), Ok(Some(cpu(&a, None))), "{size:?}");
            frames.push(&c).unwrap();
            assert_eq!(stats.after_push(), Ok(Some(cpu(&b, Some(&a)))), "{size:?}");
            assert_eq!(stats.finish(), Ok(Some(cpu(&c, Some(&b)))), "{size:?}");
            assert_eq!(
                stats.wrap(),
                Ok(cpu(&c, Some(&a)).diff.unwrap()),
                "{size:?}"
            );
        }
    }

    #[test]
    fn every_opaque_colour_and_a_difference_past_32_bits() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        // Each opaque colour once, then each channel flipped: every byte moves by |2x − 255|.
        let all: Vec<u8> = (0u32..1 << 24)
            .flat_map(|i| [i as u8, (i >> 8) as u8, (i >> 16) as u8, 255])
            .collect();
        let flipped: Vec<u8> = all
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [255 - p[0], 255 - p[1], 255 - p[2], 255])
            .collect();
        let honest = FrameChecks::new(&dev.device);
        let planted = FrameChecks::built(&dev.device, true);
        let mut frames = Blake3::new(&dev.device, Planted::default()).frames(
            &dev.device,
            &dev.queue,
            [4096, 4096],
        );
        let mut stats = [&honest, &planted].map(|c| c.stats(&dev.device, &dev.queue, &frames));
        frames.push(&all).unwrap();
        for s in &mut stats {
            assert_eq!(s.after_push(), Ok(None));
        }
        frames.push(&flipped).unwrap();
        let first = cpu(&all, None);
        for s in &mut stats {
            assert_eq!(s.after_push(), Ok(Some(first.clone())));
        }
        let second = cpu(&flipped, Some(&all));
        assert_eq!(second.diff, Some(3 << 31));
        assert_eq!(stats[0].finish(), Ok(Some(second.clone())));
        let wrong = stats[1].finish().unwrap().unwrap();
        assert_ne!(wrong, second, "the comparison catches a dropped carry");
        assert_eq!(wrong.diff, Some(1 << 31));
    }

    fn float_texture(
        dev: &Device,
        format: wgpu::TextureFormat,
        size: [u32; 2],
        bytes: &[u8],
    ) -> wgpu::Texture {
        let desc = wgpu::TextureDescriptor {
            label: Some("finite test"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        };
        let order = wgpu::util::TextureDataOrder::LayerMajor;
        dev.device
            .create_texture_with_data(&dev.queue, &desc, order, bytes)
    }

    #[test]
    fn non_finite_texels_are_counted_by_their_bits() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        // Rows pad to 256 bytes, and the two marked texels fall to different workgroups.
        let size = [300u32, 40];
        let at = |[x, y]: [u32; 2]| (y * size[0] + x) as usize;
        use wgpu::TextureFormat as F;
        for (format, components) in [(F::Rgba16Float, 4), (F::Rgba32Float, 4), (F::R32Float, 1)] {
            // The largest finite value, a NaN and +Inf, in the format's bits.
            let [big, nan, inf]: [Vec<u8>; 3] = if format == F::Rgba16Float {
                [0x7BFFu16, 0x7E00, 0x7C00].map(|h| h.to_le_bytes().to_vec())
            } else {
                [f32::MAX, f32::NAN, f32::INFINITY].map(|f| f.to_le_bytes().to_vec())
            };
            let mut texels = vec![vec![big.clone(); components]; at([0, size[1]])];
            let texture = |texels: &[Vec<Vec<u8>>]| {
                let bytes: Vec<u8> = texels.iter().flatten().flatten().copied().collect();
                let t = float_texture(&dev, format, size, &bytes);
                finite(&dev.device, &dev.queue, &t)
            };
            assert_eq!(
                texture(&texels),
                Ok(Finite {
                    count: 0,
                    first: None
                }),
                "{format:?}"
            );
            texels[at([5, 3])][2.min(components - 1)] = nan;
            assert_eq!(
                texture(&texels),
                Ok(Finite {
                    count: 1,
                    first: Some([5, 3])
                }),
                "{format:?}"
            );
            texels[at([2, 1])][1.min(components - 1)] = inf;
            assert_eq!(
                texture(&texels),
                Ok(Finite {
                    count: 2,
                    first: Some([2, 1])
                }),
                "{format:?}"
            );
        }
    }

    #[test]
    fn nv12_of_known_colours() {
        // A 4×4 frame of 2×2 blocks: red, blue on top; green, white below.
        let row = |l: [u8; 3], r: [u8; 3]| {
            let px = |[r, g, b]: [u8; 3]| [b, g, r, 255];
            [px(l), px(l), px(r), px(r)].concat()
        };
        let (red, green, blue, white) = ([255, 0, 0], [0, 255, 0], [0, 0, 255], [255; 3]);
        let top = row(red, blue);
        let bottom = row(green, white);
        let frame = [&top[..], &top, &bottom, &bottom].concat();
        let y = [63, 63, 32, 32];
        let y_below = [172, 172, 235, 235];
        let ys = [y, y, y_below, y_below].concat();
        let cbcr = [102, 240, 240, 118, 42, 26, 128, 128];
        assert_eq!(nv12(&frame, 4, 4), [&ys[..], &cbcr].concat());
        let black = nv12(&[0, 0, 0, 255].repeat(4), 2, 2);
        assert_eq!(black, [16, 16, 16, 16, 128, 128]);
    }

    /// Byte-exact NV12 Y plane of a frame.
    fn luma_plane(bgra: &[u8], [w, h]: [u32; 2]) -> Vec<u8> {
        nv12(bgra, w, h)[..(w * h) as usize].to_vec()
    }

    fn premultiply(bgra: &[u8]) -> Vec<u8> {
        bgra.as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| {
                let pre = |c: u8| ((u32::from(c) * u32::from(p[3]) + 127) / 255) as u8;
                [pre(p[0]), pre(p[1]), pre(p[2]), p[3]]
            })
            .collect()
    }

    /// A smooth frame with some grain, moved `shift` pixels to the right.
    fn scene([w, h]: [u32; 2], shift: u32, seed: u32) -> Vec<u8> {
        let grain = noise(seed, (w * h) as usize);
        (0..h)
            .flat_map(|y| (0..w).map(move |x| (x + shift, y)))
            .zip(grain)
            .flat_map(|((x, y), g)| {
                let g = g % 16;
                [(x * 3) as u8 ^ g, (y * 2) as u8 ^ g, (x + y) as u8 ^ g, 255]
            })
            .collect()
    }

    /// The SSIM [`Compare::compare`] gives, in f64 on the CPU.
    fn ssim_cpu(a: &[u8], b: &[u8], [w, h]: [u32; 2]) -> f64 {
        let (w, h) = (w as usize, h as usize);
        let (c1, c2) = ((0.01f64 * 255.0).powi(2), (0.03f64 * 255.0).powi(2));
        let (mut total, mut blocks) = (0.0, 0.0);
        for y0 in (0..h).step_by(8) {
            for x0 in (0..w).step_by(8) {
                let at: Vec<usize> = (y0..(y0 + 8).min(h))
                    .flat_map(|y| (x0..(x0 + 8).min(w)).map(move |x| y * w + x))
                    .collect();
                let n = at.len() as f64;
                let mean = |p: &[u8]| at.iter().map(|&i| f64::from(p[i])).sum::<f64>() / n;
                let (mx, my) = (mean(a), mean(b));
                let co = |p: &[u8], mp: f64, q: &[u8], mq: f64| {
                    at.iter()
                        .map(|&i| (f64::from(p[i]) - mp) * (f64::from(q[i]) - mq))
                        .sum::<f64>()
                        / n
                };
                let (vx, vy, cxy) = (co(a, mx, a, mx), co(b, my, b, my), co(a, mx, b, my));
                total += ((2.0 * mx * my + c1) * (2.0 * cxy + c2))
                    / ((mx * mx + my * my + c1) * (vx + vy + c2));
                blocks += 1.0;
            }
        }
        total / blocks
    }

    fn sse(a: &[u8], b: &[u8]) -> u64 {
        a.iter()
            .zip(b)
            .map(|(x, y)| u64::from(x.abs_diff(*y)).pow(2))
            .sum()
    }

    #[test]
    fn reference_planes_are_nv12s_luma_and_the_alpha() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let checks = FrameChecks::new(&dev.device);
        for size in [[1920, 1080], [102, 38]] {
            let frame = noise(size[0] + 11, (size[0] * size[1] * 4) as usize);
            let samples = u64::from(size[0] * size[1]);
            let same = Score {
                sse: 0,
                samples,
                ssim: 1.0,
            };
            let mut compare = checks.compare(&dev.device, &dev.queue, size);
            compare.reference(0, &frame, false).unwrap();
            compare.reference(1, &frame, true).unwrap();
            let straight = compare
                .compare(Plane::Luma, &luma_plane(&frame, size), 0)
                .unwrap();
            assert_eq!(straight[0], (0, same), "{size:?}");
            assert_eq!(straight[1].0, 1);
            assert!(
                straight[1].1.sse > 0,
                "{size:?}: alpha changes the premultiplied luma"
            );
            let pre = luma_plane(&premultiply(&frame), size);
            assert_eq!(
                compare.compare(Plane::Luma, &pre, 1).unwrap()[0],
                (1, same),
                "{size:?}"
            );
            let alpha: Vec<u8> = frame.iter().skip(3).step_by(4).copied().collect();
            for k in [0, 1] {
                assert_eq!(
                    compare.compare(Plane::Alpha, &alpha, k).unwrap()[0],
                    (k, same)
                );
            }
        }
    }

    #[test]
    fn scores_are_the_cpus() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let checks = FrameChecks::new(&dev.device);
        for size in [[1920, 1080], [102, 38]] {
            let frame = scene(size, 0, 5);
            let y = luma_plane(&frame, size);
            let jitter = noise(9, y.len());
            let noisy: Vec<u8> = y
                .iter()
                .zip(&jitter)
                .map(|(&v, &j)| (i32::from(v) + i32::from(j % 17) - 8).clamp(0, 255) as u8)
                .collect();
            let inverted: Vec<u8> = y.iter().map(|v| 255 - v).collect();
            let mut compare = checks.compare(&dev.device, &dev.queue, size);
            compare.reference(5, &frame, false).unwrap();
            for decoded in [&noisy, &inverted] {
                let [(5, got)] = compare.compare(Plane::Luma, decoded, 5).unwrap()[..] else {
                    panic!("one reference is kept");
                };
                assert_eq!(got.sse, sse(decoded, &y), "{size:?}");
                assert_eq!(got.samples, y.len() as u64);
                let want = ssim_cpu(decoded, &y, size);
                assert!(
                    (got.ssim - want).abs() < 1e-4,
                    "{size:?}: {} vs {want}",
                    got.ssim
                );
            }
            if size[0] == 1920 {
                assert!(sse(&inverted, &y) > u64::from(u32::MAX), "the SSE carries");
            }
        }
    }

    #[test]
    fn a_decoded_frame_is_closest_to_its_own_reference() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let size = [320, 240];
        let frames: Vec<Vec<u8>> = (0..4).map(|k| scene(size, 3 * k, 1)).collect();
        let mut compare = FrameChecks::new(&dev.device).compare(&dev.device, &dev.queue, size);
        for (k, frame) in (9..12).zip(&frames) {
            compare.reference(k, frame, false).unwrap();
        }
        let jitter = noise(4, (size[0] * size[1]) as usize);
        let decoded: Vec<u8> = luma_plane(&frames[2], size)
            .iter()
            .zip(&jitter)
            .map(|(&v, &j)| v.saturating_add(j % 4))
            .collect();
        let scores = compare.compare(Plane::Luma, &decoded, 10).unwrap();
        let ks: Vec<i64> = scores.iter().map(|s| s.0).collect();
        assert_eq!(ks, [10, 9, 11]);
        let (own, next) = (scores[0].1, scores[2].1);
        assert!(
            next.sse < own.sse && next.ssim > own.ssim,
            "{next:?} {own:?}"
        );
        // A fourth reference replaces the oldest.
        compare.reference(12, &frames[3], false).unwrap();
        let ks: Vec<i64> = compare
            .compare(Plane::Luma, &decoded, 10)
            .unwrap()
            .iter()
            .map(|s| s.0)
            .collect();
        assert_eq!(ks, [10, 11, 12]);
    }

    #[test]
    fn a_lost_device_is_an_error() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let size = [16, 16];
        let [a, b] = [1, 2].map(|s| noise(s, 1024));
        let checks = FrameChecks::new(&dev.device);
        let mut frames =
            Blake3::new(&dev.device, Planted::default()).frames(&dev.device, &dev.queue, size);
        let mut stats = checks.stats(&dev.device, &dev.queue, &frames);
        let mut compare = checks.compare(&dev.device, &dev.queue, size);
        let texture = float_texture(&dev, wgpu::TextureFormat::R32Float, size, &[0; 1024]);
        frames.push(&a).unwrap();
        assert_eq!(stats.after_push(), Ok(None));
        stats.keep();
        compare.reference(0, &a, false).unwrap();
        let none = Finite {
            count: 0,
            first: None,
        };
        assert_eq!(finite(&dev.device, &dev.queue, &texture), Ok(none));
        dev.force_loss();
        assert_eq!(frames.push(&b), Err(Lost));
        assert_eq!(stats.after_push(), Err(Lost));
        assert_eq!(stats.finish(), Err(Lost));
        assert_eq!(stats.wrap(), Err(Lost));
        let y = luma_plane(&a, size);
        assert_eq!(compare.compare(Plane::Luma, &y, 0), Err(Lost));
        assert_eq!(finite(&dev.device, &dev.queue, &texture), Err(Lost));
    }

    #[test]
    fn plane_sums_are_the_derived_luma_and_the_alpha() {
        // White at full alpha, white at half: luma 235 and 235 straight, 235 and 126 premultiplied.
        let frame = [255, 255, 255, 255, 255, 255, 255, 128];
        assert_eq!(plane_sums(&frame, false), [470, 383]);
        assert_eq!(plane_sums(&frame, true), [235 + 126, 383]);
    }

    #[test]
    fn nv12_takes_well_under_10_ms_at_1080p() {
        let frame = noise(3, 1920 * 1080 * 4);
        let best = (0..20)
            .map(|_| {
                let t = Instant::now();
                std::hint::black_box(nv12(&frame, 1920, 1080));
                t.elapsed()
            })
            .min()
            .unwrap();
        eprintln!("nv12 at 1920x1080: {best:?}, the best of 20");
        assert!(best < Duration::from_millis(10), "{best:?}");
    }

    /// The best and the median of `n` timed runs of `f`, a machine others load in between.
    fn timed(n: usize, mut f: impl FnMut()) -> (Duration, Duration) {
        let mut runs: Vec<Duration> = (0..n)
            .map(|_| {
                let t = Instant::now();
                f();
                t.elapsed()
            })
            .collect();
        runs.sort();
        (runs[0], runs[n / 2])
    }

    #[test]
    fn a_1080p_compare_against_three_references_runs_over_480_a_second() {
        let Ok(opened) = Gpu::open(Backend::Gpu) else {
            return;
        };
        let dev = opened.device();
        let size = [1920, 1080];
        let checks = FrameChecks::new(&dev.device);
        let frames: Vec<Vec<u8>> = (0..3).map(|k| scene(size, k, 2)).collect();
        let mut compare = checks.compare(&dev.device, &dev.queue, size);
        for (k, frame) in (0..).zip(&frames) {
            compare.reference(k, frame, false).unwrap();
        }
        let decoded = luma_plane(&frames[1], size);
        let (best, median) = timed(300, || {
            assert_eq!(compare.compare(Plane::Luma, &decoded, 1).unwrap().len(), 3);
        });
        let rate = |d: Duration| 1.0 / d.as_secs_f64();
        eprintln!(
            "compare at 1920x1080, luma against 3 references, upload included: best {best:?} ({:.0} a second), median {median:?} ({:.0} a second)",
            rate(best),
            rate(median)
        );
        assert!(rate(best) > 480.0, "{best:?}");
        // The reference upload and the stats pass, for the report: no bound is set on them.
        let (best, median) = timed(100, || compare.reference(1, &frames[1], false).unwrap());
        eprintln!("reference at 1920x1080: best {best:?}, median {median:?}");
        let mut hashed =
            Blake3::new(&dev.device, Planted::default()).frames(&dev.device, &dev.queue, size);
        let mut stats = checks.stats(&dev.device, &dev.queue, &hashed);
        hashed.push(&frames[0]).unwrap();
        stats.after_push().unwrap();
        let (best, median) = timed(100, || {
            stats.after_push().unwrap();
        });
        eprintln!("stats at 1920x1080, one frame late: best {best:?}, median {median:?}");
    }
}
