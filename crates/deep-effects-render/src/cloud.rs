//! A depth video's point set on the GPU (#503; canvas primitives: Marks in 3D): the shipped
//! compute operator `points.video@1` over the frame at t, writing the 3D point pipeline's
//! records into a buffer that pipeline can draw from. A set dispatches once per new source frame:
//! with its frame and numbers unchanged it uploads and dispatches nothing.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_effects::check::MAX_ELEMENTS;
use deep_canvas_effects::interp;
use deep_canvas_effects::shipped::POINT_WORDS;
use deep_gpu::device::Device;
use serde_json::{json, Value};
use wgpu::BufferUsages as U;

use crate::frame::Effects;
use crate::runner::Frame;

/// The shipped operator a set runs.
pub const POINTS_VIDEO: &str = "points.video@1";

/// One `mark.point {from: video}` set's dispatch: the frame at t as decoded, and its numbers.
#[derive(Clone, Debug)]
pub struct CloudJob {
    pub item: String,
    /// The frame's RGBA8 bytes as the decode worker made them, `size` px, rows top-down.
    pub frame: Arc<Vec<u8>>,
    pub size: [u32; 2],
    /// Where a white pixel and a black one sit, in m from the item's origin along its −Z.
    pub near: f64,
    pub far: f64,
    /// tan of half the field of view across, then up.
    pub tan: [f64; 2],
    pub step: u32,
    /// The depth value is the red code ÷ 255; otherwise the luma's.
    pub red: bool,
    /// The item's world transform, rows.
    pub model: [[f64; 4]; 3],
    /// Each point's size, in px or m as `flags` says, and its flags as the point pipeline reads
    /// them (bit 0 a size in m, bits 1–2 the shape).
    pub point_size: f64,
    pub flags: u32,
    /// The paint's color, sRGB codes; otherwise each point takes its pixel's.
    pub paint: Option<[u8; 3]>,
}

/// A set's points on the GPU: `count` records of [`POINT_WORDS`] words from the buffer's start,
/// laid out as the 3D point pipeline's records, in a buffer usable as storage, as a vertex
/// buffer and as a copy source.
#[derive(Clone, Debug)]
pub struct CloudOut {
    pub buffer: wgpu::Buffer,
    pub count: u32,
}

/// A set's last dispatch: its frame, its numbers and its buffers.
pub(crate) struct Held {
    frame: Arc<Vec<u8>>,
    params: BTreeMap<String, Value>,
    pixels: wgpu::Buffer,
    out: CloudOut,
}

impl CloudJob {
    /// Its points: (w ÷ step) × (h ÷ step), at most the operator's elements.
    pub fn count(&self) -> u32 {
        let step = self.step.max(1);
        let n = u64::from(self.size[0] / step) * u64::from(self.size[1] / step);
        n.min(u64::from(MAX_ELEMENTS)) as u32
    }

    /// The operator's params, by path.
    fn params(&self) -> BTreeMap<String, Value> {
        let paint = self
            .paint
            .map_or(0, |[r, g, b]| u32::from_le_bytes([r, g, b, 255]));
        let mut params: BTreeMap<String, Value> = [
            ("width", json!(self.size[0])),
            ("height", json!(self.size[1])),
            ("step", json!(self.step)),
            ("near", json!(self.near)),
            ("far", json!(self.far)),
            ("tan", json!(self.tan)),
            ("red", json!(u32::from(self.red))),
            ("size", json!(self.point_size)),
            ("flags", json!(self.flags)),
            ("paint", json!(paint)),
        ]
        .into_iter()
        .map(|(k, v)| (format!("points.{k}"), v))
        .collect();
        for (i, row) in self.model.iter().enumerate() {
            params.insert(format!("points.row{i}"), json!(row));
        }
        params
    }
}

/// `held` when it holds at least `bytes`, else a new buffer.
fn sized(device: &Device, held: Option<wgpu::Buffer>, bytes: u64, usage: U) -> wgpu::Buffer {
    let bytes = bytes.max(4);
    held.filter(|b| b.size() >= bytes).unwrap_or_else(|| {
        device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(POINTS_VIDEO),
            size: bytes,
            usage,
            mapped_at_creation: false,
        })
    })
}

impl Effects {
    /// The set's points for `job`: its frame uploaded as words and `points.video@1` dispatched
    /// over its count, submitted before this returns. With the frame (the same `Arc`) and the
    /// numbers it last ran on, it returns the last records and uploads and dispatches nothing.
    pub fn cloud(&mut self, device: &Device, job: &CloudJob) -> CloudOut {
        let params = job.params();
        if let Some(h) = self.clouds.get(&job.item) {
            if Arc::ptr_eq(&h.frame, &job.frame) && h.params == params {
                return h.out.clone();
            }
        }
        let runner = self.runner(device, POINTS_VIDEO);
        let count = job.count();
        let held = self.clouds.remove(&job.item);
        let words = &job.frame[..job.frame.len() / 4 * 4];
        let pixels = sized(
            device,
            held.as_ref().map(|h| h.pixels.clone()),
            words.len() as u64,
            U::STORAGE | U::COPY_DST,
        );
        let records = u64::from(count) * u64::from(POINT_WORDS) * 4;
        let points = sized(
            device,
            held.map(|h| h.out.buffer),
            records,
            U::STORAGE | U::VERTEX | U::COPY_SRC,
        );
        device.queue.write_buffer(&pixels, 0, words);
        let values = interp::inputs(&runner.compiled.checked, &params, &BTreeMap::new());
        let (g0, g1, _uniforms) = runner.bind(
            &device.device,
            &Frame::default(),
            [1, 1],
            &values,
            &[],
            &[&pixels, &points],
        );
        let mut encoder = device.device.create_command_encoder(&Default::default());
        runner.dispatch(&mut encoder, count, &(g0, g1), None);
        device.queue.submit([encoder.finish()]);
        let out = CloudOut {
            buffer: points,
            count,
        };
        self.clouds.insert(
            job.item.clone(),
            Held {
                frame: job.frame.clone(),
                params,
                pixels,
                out: out.clone(),
            },
        );
        out
    }

    /// A set's records as its last dispatch wrote them.
    pub fn cloud_out(&self, item: &str) -> Option<&CloudOut> {
        self.clouds.get(item).map(|h| &h.out)
    }

    /// Drops the buffers of every set `kept` doesn't keep: a set gone from the scene holds none.
    pub fn keep_clouds(&mut self, kept: impl Fn(&str) -> bool) {
        self.clouds.retain(|item, _| kept(item));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{Planted, Settings};
    use deep_gpu::counted::Reading;
    use deep_gpu::device::{Backend, Gpu};

    fn read(device: &Device, out: &CloudOut) -> Vec<u32> {
        let d = &device.device;
        let bytes = u64::from(out.count) * u64::from(POINT_WORDS) * 4;
        let back = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("points read back"),
            size: bytes,
            usage: U::COPY_DST | U::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = d.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(&out.buffer, 0, &back, 0, bytes);
        device.queue.submit([enc.finish()]);
        back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let words = back
            .slice(..)
            .get_mapped_range()
            .map(|v| {
                v.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|b| u32::from_le_bytes(*b))
                    .collect()
            })
            .unwrap_or_default();
        back.unmap();
        words
    }

    /// A 4 × 2 frame of grays with these codes.
    fn grays(codes: [u8; 8]) -> Arc<Vec<u8>> {
        Arc::new(codes.iter().flat_map(|c| [*c, *c, *c, 255]).collect())
    }

    /// On this machine's GPU each point is its pixel's unprojection under the item's world rows,
    /// in the point pipeline's record; the same frame and numbers again upload, bind and make
    /// nothing; a new frame dispatches again and places its own depths.
    #[test]
    fn a_set_dispatches_once_per_frame_and_writes_each_pixels_point() {
        let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
        let device = gpu.device();
        let mut fx = Effects::new(Settings::default(), Planted::default());
        let codes = [0, 51, 102, 153, 204, 255, 17, 34];
        let job = CloudJob {
            item: "pts".into(),
            frame: grays(codes),
            size: [4, 2],
            near: 1.0,
            far: 5.0,
            tan: [0.5, 0.25],
            step: 1,
            red: false,
            model: [
                [1.0, 0.0, 0.0, 2.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, -3.0],
            ],
            point_size: 2.0,
            flags: 1,
            paint: None,
        };
        let out = fx.cloud(&device, &job);
        assert_eq!(out.count, 8);
        let words = read(&device, &out);
        for (e, code) in codes.iter().enumerate() {
            let (u, v) = (e as f64 % 4.0, (e / 4) as f64);
            let z = 5.0 - 4.0 * f64::from(*code) / 255.0;
            let x = ((u + 0.5) / 4.0 - 0.5) * 2.0 * z * 0.5 + 2.0;
            let y = (0.5 - (v + 0.5) / 2.0) * 2.0 * z * 0.25;
            let at = &words[e * 8..e * 8 + 8];
            for (lane, want) in [x, y, -z - 3.0].into_iter().enumerate() {
                let got = f64::from(f32::from_bits(at[lane]));
                assert!(
                    (got - want).abs() < 1e-5,
                    "point {e} lane {lane}: {got} for {want}"
                );
            }
            let color = u32::from_le_bytes([*code, *code, *code, 255]);
            assert_eq!(
                at[3..],
                [2f32.to_bits(), color, 0, 1, 0],
                "point {e}'s record"
            );
        }
        let before = device.device.counts().read();
        let again = fx.cloud(&device, &job);
        assert_eq!(again.count, 8);
        let since = device.device.counts().read().since(before);
        assert_eq!(
            since,
            Reading::default(),
            "the same frame dispatches nothing"
        );
        let white = CloudJob {
            frame: grays([255; 8]),
            ..job.clone()
        };
        let out = fx.cloud(&device, &white);
        let since = device.device.counts().read().since(before);
        assert!(since.uploaded >= 32, "a new frame is uploaded: {since:?}");
        let words = read(&device, &out);
        for e in 0..8 {
            let z = f64::from(f32::from_bits(words[e * 8 + 2]));
            assert!(
                (z - (-1.0 - 3.0)).abs() < 1e-5,
                "point {e} sits at the near plane: {z}"
            );
        }
    }
}
