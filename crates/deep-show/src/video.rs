//! Issue #499 (canvas primitives: Image `image@1`: video frames): the frame an image item whose
//! asset is a video shows at t, in canonical renders. The asset is probed once in the decode
//! worker; the frame is the one whose presentation interval holds the source time
//! in + (t − start) × rate, looked up in the stream's own time base; it is decoded in the worker
//! from the source asset (never its proxy), and named by the SHA-256 of its decoded planes. The
//! picture drawn is the planes converted to RGB by the probe's matrix and range.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_media::{doc as media_doc, frames};
use deep_codecs::DECODE_WORKER;
use serde_json::{json, Map, Value};
use vello_cpu::Pixmap;

use crate::hub::{Hub, Planted};
use deep_canvas::budget::{self, Class};
use deep_canvas::document::Issue;

/// A video stream as its probe gives it.
#[derive(Clone)]
pub struct Stream {
    /// Each frame's presentation time in ticks, in presentation order.
    pts: Vec<i64>,
    timescale: i64,
    matrix: String,
    range: String,
    /// Width and height in px.
    size: [u64; 2],
}

impl Stream {
    /// The nominal frame rate, from the first two frames' times.
    fn nominal(&self) -> (i64, i64) {
        match self.pts.as_slice() {
            [a, b, ..] if b > a => (self.timescale, b - a),
            _ => (30, 1),
        }
    }
}

/// One decoded frame: its planes' SHA-256 and its picture.
#[derive(Clone)]
pub struct Frame {
    pub planes: String,
    pub picture: Arc<Pixmap>,
}

/// The run's probes and decoded frames, by asset.
#[derive(Default)]
pub struct Cache {
    streams: BTreeMap<String, Option<Stream>>,
    frames: BTreeMap<(String, usize), Option<Frame>>,
    made: usize,
}

/// The proxy a document's assets list for `sha`, if any.
fn proxy_of(doc: &Value, sha: &str) -> Option<String> {
    let assets = doc.get("assets")?.as_object()?;
    let entry = assets.values().find(|a| a["sha256"] == sha)?;
    Some(entry["proxies"].get(0)?["sha256"].as_str()?.to_string())
}

impl Hub<'_> {
    fn evidence_path(&self, sha: &str) -> Option<PathBuf> {
        let p = self
            .scenario
            .evidence
            .join(sha.get(..2)?)
            .join(sha.get(2..)?);
        p.exists().then_some(p)
    }

    /// The asset's video stream, probed once in the decode worker; `None` for anything else.
    fn stream(&mut self, sha: &str) -> Option<Stream> {
        if let Some(s) = self.media.video.streams.get(sha) {
            return s.clone();
        }
        let s = (|| {
            let path = self.evidence_path(sha)?;
            let (reply, _) = self.media_job(
                DECODE_WORKER,
                json!({"op": "probe", "path": path.to_string_lossy()}),
            );
            let streams = reply["asset"]["probe"]["streams"].as_array()?;
            let v = streams.iter().find(|s| s["type"] == "video")?;
            let pts: Vec<i64> = v["pts"]
                .as_array()?
                .iter()
                .filter_map(|p| p[0].as_i64())
                .collect();
            let timescale = v["pts"][0][1]
                .as_i64()
                .or_else(|| v["time_base"][1].as_i64())?;
            Some(Stream {
                pts,
                timescale,
                matrix: v["color"]["matrix"].as_str().unwrap_or("bt709").to_string(),
                range: v["color"]["range"]
                    .as_str()
                    .unwrap_or("limited")
                    .to_string(),
                size: [
                    v["size"][0].as_u64().unwrap_or(0),
                    v["size"][1].as_u64().unwrap_or(0),
                ],
            })
        })();
        self.media.video.streams.insert(sha.to_string(), s.clone());
        s
    }

    /// Frame `k` of `sha` decoded in the decode worker, converted by `color` (the source's).
    fn frame(&mut self, sha: &str, k: usize, color: &Stream) -> Option<Frame> {
        let key = (sha.to_string(), k);
        if let Some(f) = self.media.video.frames.get(&key) {
            return f.clone();
        }
        let n = self.media.video.made;
        self.media.video.made += 1;
        let out = std::env::temp_dir().join(format!("deep-video-{}-{n}", std::process::id()));
        let f = (|| {
            let path = self.evidence_path(sha)?;
            let job = json!({"op": "decode", "path": path.to_string_lossy(),
                "out": out.to_string_lossy(), "frames": [k]});
            let (reply, _) = self.media_job(DECODE_WORKER, job);
            let streams = reply["decoded"]["streams"].as_array()?;
            let v = streams.iter().find(|s| s["type"] == "video")?;
            let shown = v["frames"].get(0)?;
            let (w, h) = (
                v["size"][0].as_u64()? as usize,
                v["size"][1].as_u64()? as usize,
            );
            let planes = std::fs::read(out.join(shown["file"].as_str()?)).ok()?;
            let mut rgba =
                deep_codecs::color::i420_to_bgra(&planes, w, h, &color.matrix, &color.range);
            for p in rgba.as_chunks_mut::<4>().0 {
                p.swap(0, 2);
            }
            Some(Frame {
                planes: shown["planes"].as_str()?.to_string(),
                picture: crate::snapshot::pixmap_of(
                    rgba,
                    u16::try_from(w).ok()?,
                    u16::try_from(h).ok()?,
                ),
            })
        })();
        let _ = std::fs::remove_dir_all(&out);
        self.media.video.frames.insert(key, f.clone());
        f
    }

    /// Every video image item of `doc` at `t`: the `video` block (each item's source frame and
    /// planes) and the pictures to draw, by asset. `seek` marks a canonical seek, which the
    /// planted `seek_reads_proxy` reads from the asset's proxy.
    pub(crate) fn videos_at(
        &mut self,
        doc: &Value,
        t: i64,
        seek: bool,
    ) -> (Map<String, Value>, BTreeMap<String, Arc<Pixmap>>) {
        let mut block = Map::new();
        let mut pictures = BTreeMap::new();
        let items: Vec<(String, Value)> = (doc["items"].as_object().into_iter().flatten())
            .filter(|(_, i)| i["kind"] == "image@1" && i["params"].get("frames").is_some())
            .map(|(id, i)| (id.clone(), i["params"].clone()))
            .collect();
        for (id, params) in items {
            let Some(sha) = params["asset"].as_str().map(str::to_ascii_lowercase) else {
                continue;
            };
            let Some(stream) = self.stream(&sha) else {
                continue;
            };
            let src = media_doc::source_time(doc, &params["frames"], t);
            let k = match self.scenario.planted {
                Some(Planted::LookupFloorsFrameRate) => {
                    frames::frame_by_rate(src, stream.nominal(), stream.pts.len())
                }
                _ => frames::frame_at(&stream.pts, stream.timescale, src),
            };
            let from = match (seek, self.scenario.planted, proxy_of(doc, &sha)) {
                (true, Some(Planted::SeekReadsProxy), Some(proxy)) => proxy,
                _ => sha.clone(),
            };
            let Some(frame) = self.frame(&from, k, &stream) else {
                continue;
            };
            block.insert(id, json!({"frame": k, "planes": frame.planes}));
            pictures.insert(sha, frame.picture);
        }
        (block, pictures)
    }

    /// #503 (Marks in 3D): each point set `from: video` whose video the store holds, at check. It
    /// draws (w ÷ step) × (h ÷ step) points, at most 1,048,576, the compute elements of a showpiece
    /// or an export, the only classes that draw them; more, or another class, is refused, naming
    /// the item.
    pub(crate) fn point_sets_checked(&mut self, doc: &Value) -> Vec<Issue> {
        const ELEMENTS: u64 = 1 << 20;
        let class = budget::of(doc).map(|(c, _)| c);
        let sets: Vec<(String, String, u64)> = (doc["items"].as_object().into_iter().flatten())
            .filter(|(_, i)| i["kind"] == "mark.point@1")
            .filter_map(|(id, i)| {
                let v = i.pointer("/params/from/video")?;
                Some((
                    id.clone(),
                    v["asset"].as_str()?.to_string(),
                    v["step"].as_u64().unwrap_or(1).max(1),
                ))
            })
            .collect();
        let mut issues = Vec::new();
        for (id, sha, step) in sets {
            let Some([w, h]) = self.stream(&sha).map(|s| s.size) else {
                continue;
            };
            let points = (w / step) * (h / step);
            if matches!(class, Some(Class::Showpiece | Class::Export)) && points <= ELEMENTS {
                continue;
            }
            let actual = json!({"points": points, "size": [w, h], "step": step, "elements": ELEMENTS, "class": doc.pointer("/budget/class")});
            let what = "a point set from a video draws (w ÷ step) × (h ÷ step) points, at most the 1,048,576 compute elements of a showpiece or an export";
            issues.push(Issue::error(
                "over_budget",
                &id,
                format!("items/{id}/params/from/video"),
                actual,
                what,
            ));
        }
        issues
    }
}
