//! Issue #503: the video frames a view3d call's 3D items show at t (canvas primitives: Sky
//! `sky@1`: environment, a video background; Marks in 3D, a point set `from: video`). Each video
//! asset is probed once per run in the decode worker; an item's frame at t is the one its `frames`
//! choose, as an image's video frames are (#499: the frame whose presentation interval holds the
//! source time, in the stream's own time base); it's decoded there as BGRA by the stream's tagged
//! matrix and range and put in the scene's texels as `video:<item id>`, RGBA8 as decoded
//! (sRGB-encoded). The frame is a function of t alone, so a seek carries nothing over.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use deep_canvas::budget::Class;
use deep_canvas_media::{doc as media_doc, frames};
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::{Point, PointShape, Scene};
use deep_canvas_scene3d::sky::Background;
use deep_effects_render::cloud::CloudJob;
use deep_effects_render::frame::Effects;
use serde_json::{json, Value};

use crate::session3::lock;
use crate::view3d::FLICKS_PER_SECOND;
use crate::{refused, textures, App, Planted};

/// The most points a set `from: video` draws: the compute elements of a showpiece or an export,
/// the only classes that draw them (Operator budgets by class).
pub const MAX_POINTS: u64 = 1_048_576;
/// Decoded frames kept, the newest last (Image `image@1`: video frames: a ring of 8).
const RING: usize = 8;

/// A video stream as the decode worker's probe gives it.
#[derive(Clone)]
struct Stream {
    /// Each frame's presentation time in ticks, in presentation order.
    pts: Vec<i64>,
    timescale: i64,
    size: [u64; 2],
}

/// The run's probes by asset, and its latest decoded frames by asset and frame.
#[derive(Default)]
pub struct Cache {
    streams: BTreeMap<String, Stream>,
    frames: VecDeque<((String, usize), Arc<Texels>)>,
    made: usize,
}

/// An item that names a video: its ID, the asset, where the asset is named, its `frames`, and a
/// point set's step (`None` for a background).
struct Named {
    id: String,
    sha: String,
    at: String,
    frames: Value,
    step: Option<u64>,
}

/// One view3d call's videos: the assets' files by hash, its frame rate and whether it's an
/// export, the planted `point_video_keeps_frame_before_seek`'s clock (the last frame drawn and
/// the frame its point sets are chosen at), and whether the renderer holds point sets.
pub struct Session {
    paths: BTreeMap<String, PathBuf>,
    fps: u64,
    export: bool,
    kept: Option<(u64, u64)>,
    fed: bool,
}

impl Session {
    pub fn new(paths: BTreeMap<String, PathBuf>, fps: u64, export: bool) -> Session {
        Session {
            paths,
            fps,
            export,
            kept: None,
            fed: false,
        }
    }

    /// `texels` with frame `n`'s video frames added for `scene`, evaluated from `doc`. A point
    /// set of more points than a showpiece's compute elements, or in a class that draws none, is
    /// refused naming the item, after the probe and before any decode.
    pub fn at(
        &mut self,
        app: &mut App,
        doc: &Value,
        n: u64,
        scene: &Scene,
        mut texels: BTreeMap<String, Arc<Texels>>,
    ) -> Result<BTreeMap<String, Arc<Texels>>, Value> {
        let named = named(scene);
        let class = deep_canvas::budget::of(doc).map(|(c, _)| c);
        let mut streams = Vec::with_capacity(named.len());
        for v in &named {
            let path = self.path(v)?;
            let s = probe(app, v, &path)?;
            if let Some(step) = v.step {
                if refuses(class, self.export, points(s.size, step)) {
                    return Err(refused("out_of_range", format!("items/{}", v.id)));
                }
            }
            streams.push((path, s));
        }
        // The planted clock steps only when frame n follows the last one drawn.
        let played = match self.kept {
            Some((last, k)) if n == last + 1 => k + 1,
            Some((_, k)) => k,
            None => 0,
        };
        self.kept = Some((n, played));
        let kept = app.planted == Some(Planted::PointVideoKeepsFrameBeforeSeek);
        for (v, (path, s)) in named.iter().zip(streams) {
            let shown = if kept && v.step.is_some() { played } else { n };
            let t = (shown * FLICKS_PER_SECOND / self.fps) as i64;
            let k = index(doc, &v.frames, t, &s.pts, s.timescale);
            texels.insert(format!("video:{}", v.id), frame(app, v, &path, k)?);
        }
        Ok(texels)
    }

    /// The scene's point sets from a depth video (#503): each dispatched by the effects'
    /// `points.video@1` over its frame in the scene's texels, on the session's device, and handed
    /// to the renderer for the frame it draws next, which draws their records with the point
    /// pipeline; a set gone from the scene drops its buffers.
    pub fn clouds(
        &mut self,
        app: &App,
        fx: &Arc<Mutex<Effects>>,
        scene: &Scene,
    ) -> Result<(), Value> {
        let jobs: Vec<CloudJob> = (scene.layers.iter().flat_map(|l| &l.points))
            .filter_map(|p| cloud_job(p, scene.texels.get(&format!("video:{}", p.id))?))
            .collect();
        if jobs.is_empty() && !self.fed {
            return Ok(());
        }
        self.fed = !jobs.is_empty();
        let fx = fx.clone();
        let fed = app.worker.call(move |state| -> Result<(), String> {
            let device = state.gpu.device();
            let mut fx = lock(&fx);
            let mut out = deep_scene3d_render::clouds::Clouds::new();
            for job in &jobs {
                let o = fx.cloud(&device, job);
                out.insert(job.item.clone(), (o.buffer, o.count));
            }
            fx.keep_clouds(|item| out.contains_key(item));
            let s = state.scene3d.as_ref().ok_or("no session")?;
            lock(&s.shared).clouds = out;
            Ok(())
        });
        fed.map_err(|e| refused("render_failed", e))
    }

    fn path(&self, v: &Named) -> Result<PathBuf, Value> {
        (self.paths.get(&v.sha).cloned()).ok_or_else(|| refused("asset_missing", v.at.clone()))
    }
}

/// A point set's dispatch over its `frame` (#503): its numbers and its point's size and shape.
fn cloud_job(p: &Point, frame: &Arc<Texels>) -> Option<CloudJob> {
    let c = p.cloud.as_ref()?;
    let shape = match p.shape {
        PointShape::Dot => 0,
        PointShape::Square => 1,
        PointShape::Diamond => 2,
    };
    Some(CloudJob {
        item: p.id.clone(),
        frame: frame.data.clone(),
        size: frame.size,
        near: c.near,
        far: c.far,
        tan: c.tan,
        step: c.step,
        red: c.red,
        model: c.model,
        point_size: p.size,
        flags: u32::from(p.world) | (shape << 1),
        paint: c.painted,
    })
}

/// The scene's video background and its point sets `from: video`.
fn named(scene: &Scene) -> Vec<Named> {
    let mut out = Vec::new();
    if let Some(sky) = &scene.sky {
        if let Background::Video { asset, frames } = &sky.background {
            out.push(Named {
                id: sky.id.clone(),
                sha: asset.clone(),
                at: format!("items/{}/params/background/video/asset", sky.id),
                frames: frames.clone(),
                step: None,
            });
        }
    }
    for p in scene.layers.iter().flat_map(|l| &l.points) {
        if let Some(c) = &p.cloud {
            out.push(Named {
                id: p.id.clone(),
                sha: c.asset.clone(),
                at: format!("items/{}/params/from/video/asset", p.id),
                frames: c.frames.clone(),
                step: Some(u64::from(c.step)),
            });
        }
    }
    out
}

/// Each point set's world transform by item, which its points are read back through (#503).
pub fn models(scene: &Scene) -> BTreeMap<String, [[f64; 4]; 3]> {
    let points = scene.layers.iter().flat_map(|l| &l.points);
    (points.filter_map(|p| Some((p.id.clone(), p.cloud.as_ref()?.model)))).collect()
}

/// `read`'s `<item>.points` (#503) when the item is a point set the frame drew: its records read
/// back from the GPU, each point's x, y and z put back in the item's space through the inverse of
/// `models`' transform, written to `dir` as f32 named by their SHA-256.
pub fn read_points(
    device: &deep_gpu::device::Device,
    fx: &deep_effects_render::frame::Effects,
    key: &str,
    models: &BTreeMap<String, [[f64; 4]; 3]>,
    dir: &str,
) -> Option<Result<Value, Value>> {
    let item = key.strip_suffix(".points")?;
    let (out, m) = (fx.cloud_out(item)?, models.get(item)?);
    let words = read_words(device, &out.buffer, u64::from(out.count) * 8);
    let inv = invert(m);
    let mut bytes = Vec::with_capacity(out.count as usize * 12);
    for r in words.chunks_exact(8) {
        let w = [0, 1, 2].map(|k| f64::from(f32::from_bits(r[k])) - m[k][3]);
        for row in &inv {
            let c = row[0] * w[0] + row[1] * w[1] + row[2] * w[2];
            bytes.extend((c as f32).to_le_bytes());
        }
    }
    let file = crate::view3d::write_named(dir, &bytes, "f32");
    Some(file.map(|f| json!({"type": "f32", "count": out.count, "components": 3, "file": f})))
}

/// `n` words of `buffer`, copied to a mapped buffer and read on the CPU.
fn read_words(device: &deep_gpu::device::Device, buffer: &wgpu::Buffer, n: u64) -> Vec<u32> {
    let d = &device.device;
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("points read back"),
        size: (n * 4).max(4),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = d.create_command_encoder(&Default::default());
    enc.copy_buffer_to_buffer(buffer, 0, &back, 0, n * 4);
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let words = (back.slice(..).get_mapped_range())
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

/// The inverse of an affine transform's 3 × 3 part, rows.
fn invert(m: &[[f64; 4]; 3]) -> [[f64; 3]; 3] {
    let a = |r: usize, c: usize| m[r][c];
    let cof = |r: usize, c: usize| {
        let (r0, r1) = ((r + 1) % 3, (r + 2) % 3);
        let (c0, c1) = ((c + 1) % 3, (c + 2) % 3);
        a(r0, c0) * a(r1, c1) - a(r0, c1) * a(r1, c0)
    };
    let det = a(0, 0) * cof(0, 0) + a(0, 1) * cof(0, 1) + a(0, 2) * cof(0, 2);
    std::array::from_fn(|r| std::array::from_fn(|c| cof(c, r) / det))
}

/// The points a w × h video draws at `step`: one per step-th pixel each way.
fn points([w, h]: [u64; 2], step: u64) -> u64 {
    (w / step) * (h / step)
}

/// Whether a point set of `points` is refused: past a showpiece's compute elements, or in a
/// document whose class is neither a showpiece nor an export, outside an export.
fn refuses(class: Option<Class>, export: bool, points: u64) -> bool {
    let draws = export || matches!(class, Some(Class::Showpiece | Class::Export));
    points > MAX_POINTS || !draws
}

/// The frame `frames` shows at `t` (flicks), of a stream whose frames present at `pts` ticks.
fn index(doc: &Value, frames_v: &Value, t: i64, pts: &[i64], timescale: i64) -> usize {
    frames::frame_at(pts, timescale, media_doc::source_time(doc, frames_v, t))
}

/// A worker's reply as a refusal naming `at`: its own refusal's code, else `unreadable`.
fn unreadable(at: &str, reply: &Value) -> Value {
    let code = reply["refused"]["code"].as_str().unwrap_or("unreadable");
    refused(code, format!("{at}: {reply}"))
}

/// The asset's video stream, probed once per run in the decode worker.
fn probe(app: &mut App, v: &Named, path: &Path) -> Result<Stream, Value> {
    if let Some(s) = app.made.videos.streams.get(&v.sha) {
        return Ok(s.clone());
    }
    let reply = textures::decoder(app)?.ask(&json!({"op": "probe", "path": path}));
    let read = || {
        let streams = reply["asset"]["probe"]["streams"].as_array()?;
        let s = streams.iter().find(|s| s["type"] == "video")?;
        let pts: Vec<i64> = (s["pts"].as_array()?.iter())
            .filter_map(|p| p[0].as_i64())
            .collect();
        let timescale = s["pts"][0][1]
            .as_i64()
            .or_else(|| s["time_base"][1].as_i64())?;
        let size = [s["size"][0].as_u64()?, s["size"][1].as_u64()?];
        (!pts.is_empty()).then_some(Stream {
            pts,
            timescale,
            size,
        })
    };
    let s = read().ok_or_else(|| unreadable(&v.at, &reply))?;
    app.made.videos.streams.insert(v.sha.clone(), s.clone());
    Ok(s)
}

/// Frame `k` of the asset decoded in the decode worker, as RGBA8, kept in the run's ring.
fn frame(app: &mut App, v: &Named, path: &Path, k: usize) -> Result<Arc<Texels>, Value> {
    let key = (v.sha.clone(), k);
    let ring = &app.made.videos.frames;
    if let Some((_, t)) = ring.iter().find(|(f, _)| *f == key) {
        return Ok(t.clone());
    }
    let made = app.made.videos.made;
    app.made.videos.made += 1;
    let out = std::env::temp_dir().join(format!("deep-gpu-video-{}-{made}", std::process::id()));
    let job = json!({"op": "decode", "path": path, "out": out, "frames": [k], "format": "bgra"});
    let reply = textures::decoder(app)?.ask(&job);
    let read = || {
        let streams = reply["decoded"]["streams"].as_array()?;
        let s = streams.iter().find(|s| s["type"] == "video")?;
        let size = [
            u32::try_from(s["size"][0].as_u64()?).ok()?,
            u32::try_from(s["size"][1].as_u64()?).ok()?,
        ];
        let mut data = std::fs::read(out.join(s["frames"].get(0)?["file"].as_str()?)).ok()?;
        if data.len() != size[0] as usize * size[1] as usize * 4 {
            return None;
        }
        for p in data.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        Some(Texels {
            format: "rgba8".into(),
            size,
            mips: 1,
            data: Arc::new(data),
        })
    };
    let texels = read();
    let _ = std::fs::remove_dir_all(&out);
    let t = Arc::new(texels.ok_or_else(|| unreadable(&format!("{} frame {k}", v.at), &reply))?);
    let ring = &mut app.made.videos.frames;
    if ring.len() == RING {
        ring.pop_front();
    }
    ring.push_back((key, t.clone()));
    Ok(t)
}

/// The frames a call draws, in order: `frames` of them from `from`, each seek jumping once.
pub fn frame_order(from: u64, frames: u64, seeks: &[(u64, u64)]) -> Vec<u64> {
    let mut left: Vec<(u64, u64)> = seeks.to_vec();
    let mut n = from;
    let mut order = Vec::with_capacity(frames as usize);
    for _ in 0..frames {
        order.push(n);
        n = match left.iter().position(|(after, _)| *after == n) {
            Some(k) => left.remove(k).1,
            None => n + 1,
        };
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 30 fps stream at ffmpeg's MP4 time base: frame k at k × 512 ticks of 15,360.
    fn thirty() -> Vec<i64> {
        (0..90).map(|k| k * 512).collect()
    }

    #[test]
    fn a_video_played_from_start_0_shows_frame_75_at_two_and_a_half_seconds() {
        let doc = json!({});
        let at = |s: f64| (s * FLICKS_PER_SECOND as f64).round() as i64;
        let pts = thirty();
        let frames = json!({"start": 0});
        assert_eq!(index(&doc, &frames, at(2.5), &pts, 15_360), 75);
        assert_eq!(index(&doc, &frames, at(2.5) - 1, &pts, 15_360), 74);
        // Started at 1 s, it shows its first frame before then and frame 45 at 2.5 s.
        let later = json!({"start": "1s"});
        assert_eq!(index(&doc, &later, at(0.5), &pts, 15_360), 0);
        assert_eq!(index(&doc, &later, at(2.5), &pts, 15_360), 45);
    }

    #[test]
    fn a_1080p_depth_video_is_refused_at_step_1_and_draws_at_step_2_in_a_showpiece() {
        let hd = [1920, 1080];
        assert_eq!(points(hd, 1), 2_073_600);
        assert_eq!(points(hd, 2), 518_400);
        let showpiece = Some(Class::Showpiece);
        assert!(refuses(showpiece, false, points(hd, 1)));
        assert!(!refuses(showpiece, false, points(hd, 2)));
        assert!(!refuses(Some(Class::Export), false, MAX_POINTS));
        // Another class draws no points unless the call is an export.
        assert!(refuses(Some(Class::Figure), false, points(hd, 2)));
        assert!(refuses(None, false, points(hd, 2)));
        assert!(!refuses(Some(Class::Figure), true, points(hd, 2)));
    }
}
