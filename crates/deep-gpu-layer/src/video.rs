//! Issue #503: the video frames a view3d call's 3D items show at t (canvas primitives: Sky
//! `sky@1`: environment, a video background; Marks in 3D, a point set `from: video`). Each video
//! asset is probed once per run in the decode worker; an item's frame at t is the one its `frames`
//! choose, as an image's video frames are (#499: the frame whose presentation interval holds the
//! source time, in the stream's own time base); it's decoded there as BGRA by the stream's tagged
//! matrix and range and put in the scene's texels as `video:<item id>`, RGBA8 as decoded
//! (sRGB-encoded). The frame is a function of t alone, so a seek carries nothing over.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::budget::Class;
use deep_canvas_media::{doc as media_doc, frames};
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use deep_canvas_scene3d::sky::Background;
use serde_json::{json, Value};

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
/// export, and the planted `video_frame_kept_over_seek`'s clock: the last frame drawn and the
/// frame its point sets are chosen at.
pub struct Session {
    paths: BTreeMap<String, PathBuf>,
    fps: u64,
    export: bool,
    kept: Option<(u64, u64)>,
}

impl Session {
    pub fn new(paths: BTreeMap<String, PathBuf>, fps: u64, export: bool) -> Session {
        Session {
            paths,
            fps,
            export,
            kept: None,
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
        let named = named(doc, scene)?;
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
        let kept = app.planted == Some(Planted::VideoFrameKeptOverSeek);
        for (v, (path, s)) in named.iter().zip(streams) {
            let shown = if kept && v.step.is_some() { played } else { n };
            let t = (shown * FLICKS_PER_SECOND / self.fps) as i64;
            let k = index(doc, &v.frames, t, &s.pts, s.timescale);
            texels.insert(format!("video:{}", v.id), frame(app, v, &path, k)?);
        }
        Ok(texels)
    }

    fn path(&self, v: &Named) -> Result<PathBuf, Value> {
        (self.paths.get(&v.sha).cloned()).ok_or_else(|| refused("asset_missing", v.at.clone()))
    }
}

/// The scene's video background and the document's point sets `from: video`.
fn named(doc: &Value, scene: &Scene) -> Result<Vec<Named>, Value> {
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
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        let Some(v) = (item["kind"] == "mark.point@1")
            .then(|| item.pointer("/params/from/video"))
            .flatten()
        else {
            continue;
        };
        let Some(sha) = v["asset"].as_str() else {
            continue;
        };
        let step = match v.get("step") {
            None => 1,
            Some(s) => s.as_u64().filter(|s| (1..=8).contains(s)).ok_or_else(|| {
                refused("out_of_range", format!("items/{id}/params/from/video/step"))
            })?,
        };
        out.push(Named {
            id: id.clone(),
            sha: sha.to_string(),
            at: format!("items/{id}/params/from/video/asset"),
            frames: v.get("frames").cloned().unwrap_or_default(),
            step: Some(step),
        });
    }
    Ok(out)
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
