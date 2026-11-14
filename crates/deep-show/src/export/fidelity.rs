//! Issue #157: the colour probe (export.color) and the delivery read back (export.color's written
//! tags, the header-first layout, chapter key frames, export.fidelity and the sync rule), each
//! from the written file's own bytes in a decode worker apart from the encode tool (Check input:
//! export kinds). No raw frame is kept for it: each frame the film drew is drawn again in a fresh
//! session and used only if its hash equals the receipt's, then compared on the GPU with the
//! decoded planes; the sound is trimmed by the edit list the check reads itself.

use std::path::Path;
use std::time::{Duration, Instant};

use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_media::export_checks as rules;
use deep_codecs::{Caps, Helper};
use deep_gpu::frame_checks::{Compare, FrameChecks, Plane};
use serde_json::{json, Value};

use super::feed::Part;
use super::{hex, Job};
use crate::hub::Hub;

/// How long the decode worker may take to answer one read.
const READ: Duration = Duration::from_secs(300);
/// The widest offset the sound is searched over, in samples.
const MAX_LAG: usize = 8192;

/// What a delivery is held to: what the export drew and heard.
pub(crate) struct Delivery<'a> {
    pub path: &'a Path,
    pub doc: &'a Value,
    pub job: &'a Job,
    /// The frames the export drew, absolute, and each one's length in flicks.
    pub frames: std::ops::Range<i64>,
    pub frame: i64,
    pub rate: (u32, u32),
    pub size: [u16; 2],
    pub hashes: &'a [[u8; 32]],
    /// The raw PCM, interleaved, its channels and rate.
    pub pcm: Option<(&'a [f32], usize, u32)>,
    /// Each chapter: its marker, its name and its first frame.
    pub chapters: &'a [(String, String, i64)],
    /// Planted: the first pass's frames, compared instead of frames drawn again.
    pub kept: Option<&'a [Vec<u8>]>,
    /// The priming the encode tool says it wrote, only to name an offset that equals it.
    pub priming: Option<i64>,
    /// What the GPU read of each frame as the export drew it: export.sync finds its white frames.
    pub reads: &'a [deep_gpu::frame_checks::Reading],
}

/// What the delivery read: the receipt's `fidelity`, the measured offset and the sound's edit-list
/// start, and its decoded sound, trimmed by its edit list, for its loudness.
pub(crate) struct Read {
    pub fidelity: Value,
    pub av_offset: Option<i64>,
    pub edit_list: Option<i64>,
    pub pcm: Option<(u32, usize, Vec<f32>)>,
}

/// Whether a frame passes at `floor` dB: PSNR-Y at or over it, or, at the standard 40 dB floor,
/// SSIM at least 0.98 with the plane's level kept (Check input: export kinds).
fn meets(psnr: f64, ssim: f64, floor: f64, level_kept: impl FnOnce() -> bool) -> bool {
    psnr >= floor || (floor == 40.0 && ssim >= 0.98 && level_kept())
}

/// Whether a decoded plane keeps its reference's level: their means within one code value. SSIM
/// reads a frame's structure, and a level moved as a whole (full-range values under limited-range
/// tags, colour premultiplied under straight alpha) leaves it high; PSNR alone judges such a frame.
fn level_kept(decoded: &[u8], reference: u64) -> bool {
    let sum: u64 = decoded.iter().map(|&v| u64::from(v)).sum();
    (sum as f64 - reference as f64).abs() <= decoded.len() as f64
}

/// An export.fidelity or export.color failure: nothing is delivered.
fn failed(code: &str, issues: Vec<Value>) -> Value {
    json!({"outcome": "failed", "code": code, "issues": issues})
}

fn issue(check: &str, frame: Option<i64>, what: String) -> Value {
    json!({"check": check, "code": check, "severity": "error", "frame": frame, "what": what})
}

/// Asks the worker to stream `path` (frames `range` only, when given): its header.
fn stream(
    worker: &mut Helper,
    path: &Path,
    planes: &str,
    range: Option<[i64; 2]>,
) -> Result<Value, Value> {
    let mut ask = json!({"op": "stream", "path": path, "planes": planes});
    if let Some(r) = range {
        ask["range"] = json!(r);
    }
    match worker.feed(&ask, &[], READ) {
        Some(r) if r.get("stream").is_some() => Ok(r["stream"].clone()),
        Some(r) => Err(
            json!({"outcome": "failed", "code": "delivery_unread", "reply": r,
            "what": format!("the decode worker couldn't read {}", path.display())}),
        ),
        None => Err(json!({"outcome": "failed", "code": "delivery_unread",
            "what": format!("the decode worker gave no answer for {}", path.display())})),
    }
}

/// The worker's next frame: its index and bytes, or the error it gave.
fn next_frame(worker: &mut Helper, buf: &mut Vec<u8>) -> Result<i64, String> {
    let r = worker.hear().ok_or("the decode worker ended")?;
    if let Some(e) = r.get("error") {
        return Err(e.to_string());
    }
    let n = r["bytes"]
        .as_u64()
        .ok_or_else(|| format!("no frame in {r}"))? as usize;
    buf.resize(n, 0);
    if !worker.take(buf) {
        return Err("the decode worker ended mid-frame".into());
    }
    Ok(r["frame"].as_i64().unwrap_or(-1))
}

/// A codec's written tags against what it must carry: BT.709 limited range for H.264 and HEVC
/// (nclx 1-1-1, range tv), ProRes 4444's limited-range colour (nclc 1-1-1); a page's clip
/// (#169) carries its pixels' sRGB transfer (nclx 1-13-1).
fn tags_issues(codec: &str, v: &Value, srgb: bool) -> Vec<Value> {
    let colr = &v["colr"];
    let tagged = [&colr["primaries"], &colr["transfer"], &colr["matrix"]].map(|x| x.as_i64());
    let mut out = Vec::new();
    let want_type = if codec == "prores_4444" {
        "nclc"
    } else {
        "nclx"
    };
    let transfer = if srgb { 13 } else { 1 };
    if colr["type"] != want_type || tagged != [Some(1), Some(transfer), Some(1)] {
        out.push(issue(
            "export.color",
            None,
            format!("{codec}'s colour tags read {colr}: not {want_type} 1-{transfer}-1"),
        ));
    }
    if codec != "prores_4444" && colr["full_range"] != json!(false) {
        out.push(issue(
            "export.color",
            None,
            format!("{codec}'s range tag reads full range: not tv (limited)"),
        ));
    }
    if v["decoded_range"] != "limited" {
        out.push(issue(
            "export.color",
            None,
            format!(
                "{codec} decodes as {} range: not limited",
                v["decoded_range"]
            ),
        ));
    }
    out
}

impl Hub<'_> {
    /// export.color's probe: one frame of 75% bars and a grey ramp (with an alpha ramp for
    /// ProRes 4444), encoded with the delivery's settings and decoded through its own tags in a
    /// decode worker, within ±2 code values; its tags and largest error.
    pub(crate) fn color_probe(
        &mut self,
        job: &Job,
        size: [u16; 2],
        (p, q): (u32, u32),
        scratch: &Path,
    ) -> Result<Value, Value> {
        let started = Instant::now();
        let alpha = job.codec == "prores_4444";
        let px = size.map(u32::from);
        let bgra = deep_codecs::color::probe(px, alpha);
        let path = scratch.join(if alpha { "probe.mov" } else { "probe.mp4" });
        // The delivery's codec, colour properties and source format, at the encoder's highest
        // quality, so what the probe reads is the colour path and not the bitrate.
        let ask = super::frames::transfer(json!({"op": "export.part", "codec": job.codec, "rate": [p, q], "size": size, "quality": "master",
            "keyframe_interval": job.keyframe_interval}), job);
        let mut part = Part::open(self.encode_tool()?, ask, path.clone(), 0, 1, !alpha)?;
        part.push(self.encode_tool()?, 0, &bgra, px, true)?;
        part.finish(self.encode_tool()?)?;
        let mut worker = self.fresh_decoder(&Caps::default())?;
        let head = stream(&mut worker, &path, "bgra", None)?;
        let mut buf = Vec::new();
        next_frame(&mut worker, &mut buf).map_err(|e| {
            failed(
                "export.color",
                vec![issue(
                    "export.color",
                    None,
                    format!("the probe doesn't decode: {e}"),
                )],
            )
        })?;
        let _ = worker.hear();
        let max = if buf.len() == bgra.len() {
            patch_error(&bgra, &buf, px, if alpha { 4 } else { 3 })
        } else {
            255.0
        };
        let colr = &head["video"]["colr"];
        let tags = match alpha {
            true => {
                json!({"range": if head["video"]["decoded_range"] == "limited" { "tv" } else { "pc" }, "alpha": "full", "nclc": [&colr["primaries"], &colr["transfer"], &colr["matrix"]]})
            }
            false => {
                json!({"nclx": [&colr["primaries"], &colr["transfer"], &colr["matrix"]], "range": if colr["full_range"] == json!(false) { "tv" } else { "pc" }})
            }
        };
        let mut issues = tags_issues(&job.codec, &head["video"], job.srgb);
        if buf.len() != bgra.len() || max > 2.0 {
            issues.push(issue(
                "export.color",
                None,
                format!(
                    "the probe decodes up to {max} code values from what was encoded, more than 2"
                ),
            ));
        }
        let seconds = started.elapsed().as_secs_f64();
        if !issues.is_empty() {
            return Err(failed("export.color", issues));
        }
        Ok(json!({"tags": tags, "max_error": max, "seconds": seconds}))
    }

    /// The delivery at `d.path` read back from its own bytes in a fresh decode worker and held to
    /// what the export drew and heard; any failure stops the export, naming what it found.
    pub(crate) fn read_delivery(&mut self, d: &Delivery) -> Result<Read, Value> {
        let bytes = std::fs::metadata(d.path).map(|m| m.len()).unwrap_or(0);
        let caps = Caps {
            max_bytes: bytes.max(Caps::default().max_bytes),
            ..Caps::default()
        };
        let mut worker = self.fresh_decoder(&caps)?;
        if d.job.target() == "png" {
            return self.read_pngs(d, &mut worker);
        }
        // The delivery's head and every sound sample, from a stream of no frames.
        let s = stream(&mut worker, d.path, "luma", Some([0, 0]))?;
        let a = &s["audio"];
        let mut raw_bytes = vec![0u8; a["bytes"].as_u64().unwrap_or(0) as usize];
        if !raw_bytes.is_empty() && !worker.take(&mut raw_bytes) {
            return Err(
                json!({"outcome": "failed", "code": "delivery_unread", "what": "the decode worker ended in the sound"}),
            );
        }
        let _ = worker.hear();
        let mut issues = Vec::new();
        // The header first: the moov box before the first mdat byte.
        let at = |kind: &str| {
            s["boxes"]
                .as_array()
                .and_then(|b| b.iter().find(|b| b["type"] == kind))
                .and_then(|b| b["at"].as_u64())
        };
        if !matches!((at("moov"), at("mdat")), (Some(m), Some(d)) if m < d) {
            issues.push(issue(
                "export.layout",
                None,
                "the delivery's moov box doesn't come before its first mdat byte".into(),
            ));
        }
        let v = &s["video"];
        // Each chapter's first frame a sync sample.
        let sync: Vec<i64> = v["sync"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .collect();
        let all_sync = v.get("sync").is_none_or(Value::is_null);
        for (marker, _, c) in d.chapters {
            if !all_sync && !sync.contains(&(c - d.frames.start)) {
                let mut i = issue(
                    "export.chapters",
                    None,
                    format!("chapter `{marker}` starts at frame {c}, which isn't a sync sample"),
                );
                i["chapter"] = json!(marker);
                i["at"] = json!(c);
                issues.push(i);
            }
        }
        // Each frame at exactly its own time, k × q/p.
        let (p, q) = (i128::from(d.rate.0), i128::from(d.rate.1));
        let pts = v["pts"].as_array().cloned().unwrap_or_default();
        if let Some(i) = pts.iter().enumerate().position(|(i, t)| {
            let (ticks, scale) = (
                t[0].as_i64().unwrap_or(-1) as i128,
                t[1].as_i64().unwrap_or(1) as i128,
            );
            ticks * p != i as i128 * q * scale
        }) {
            let k = d.frames.start + i as i64;
            issues.push(issue(
                "export.fidelity",
                Some(k),
                format!(
                    "frame {k} is presented at {}, not at exactly {} × {q}/{p} s",
                    pts[i], i
                ),
            ));
        }
        // The sound: every sample, untrimmed, then the edit list applied by the check itself.
        let (mut sound, mut av_offset, mut edit_list) = (None, None, None);
        if let Some((raw, channels, hz)) = d.pcm {
            let decoded: Vec<f32> = raw_bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            let movie = s["movie"]["timescale"].as_i64();
            let (got, offset, start) =
                self.read_sound(d, a, movie, &decoded, raw, channels, &mut issues);
            (av_offset, edit_list) = (offset, Some(start));
            if let Some(g) = &got {
                issues.extend(sync_issues(d, g, channels, hz, a["codec"] == "aac"));
            }
            sound = got.map(|g| (hz, channels, g));
        }
        // The frames, decoded by two workers at once split at the sync frame nearest the middle
        // (one decoder alone falls short of 8x real time at 1080p60), each skipping the sound.
        let n = v["frames"].as_i64().unwrap_or(0);
        let split = sync
            .iter()
            .copied()
            .filter(|&k| k > 0 && k < n)
            .min_by_key(|&k| (k - n / 2).abs())
            .unwrap_or(n);
        let mut readers = vec![(worker, 0, split.min(n))];
        if split < n {
            readers.push((self.fresh_decoder(&caps)?, split, n));
        }
        for (i, (w, from, to)) in readers.iter_mut().enumerate() {
            let head = stream(w, d.path, "luma", Some([*from, *to]))?;
            let mut skip = vec![0u8; head["audio"]["bytes"].as_u64().unwrap_or(0) as usize];
            if !skip.is_empty() && !w.take(&mut skip) {
                return Err(
                    json!({"outcome": "failed", "code": "delivery_unread", "what": "the decode worker ended in the sound"}),
                );
            }
            // export.color: the written tags and the range the decoder gives the first frame.
            if i == 0 {
                issues.extend(tags_issues(&d.job.codec, &head["video"], d.job.srgb));
            }
        }
        let mut fidelity = self.read_frames(d, &mut readers, n, v, &mut issues)?;
        if !issues.is_empty() {
            return Err(failed("export.fidelity", issues));
        }
        fidelity["samples"] = sound
            .as_ref()
            .map_or(Value::Null, |(_, ch, g)| json!(g.len() / ch));
        Ok(Read {
            fidelity,
            av_offset,
            edit_list,
            pcm: sound,
        })
    }

    /// The decoded sound held to the raw PCM: trimmed by its own edit list, exactly the raw
    /// sample frames per channel, each channel best matched at lag 0 with a normalized
    /// correlation of at least 0.99. The trimmed sound, the measured lag and the edit list's
    /// start.
    #[allow(clippy::too_many_arguments)]
    fn read_sound(
        &self,
        d: &Delivery,
        a: &Value,
        movie: Option<i64>,
        decoded: &[f32],
        raw: &[f32],
        channels: usize,
        issues: &mut Vec<Value>,
    ) -> (Option<Vec<f32>>, Option<i64>, i64) {
        let ch = a["channels"].as_u64().unwrap_or(channels as u64).max(1) as usize;
        let rate = a["sample_rate"].as_i64().unwrap_or(1).max(1);
        let movie = movie.unwrap_or(rate).max(1);
        let edit = a["edits"]
            .as_array()
            .and_then(|e| e.iter().find(|e| e["media_time"].as_i64() != Some(-1)));
        let (media_time, duration) = match edit {
            Some(e) => (
                e["media_time"].as_i64().unwrap_or(0),
                (i128::from(e["duration"].as_i64().unwrap_or(0)) * i128::from(rate)
                    / i128::from(movie)) as i64,
            ),
            None => (0, (decoded.len() / ch) as i64),
        };
        let Some(trimmed) = rules::trim(decoded, ch, media_time, duration) else {
            issues.push(issue("export.fidelity", None, format!("the sound's edit list (start {media_time}, {duration} samples) lies outside its {} decoded samples", decoded.len() / ch)));
            return (None, None, media_time);
        };
        let (want, got) = (raw.len() / channels, trimmed.len() / ch);
        if ch != channels || want != got {
            let mut i = issue("export.fidelity", None, format!("the delivery holds {got} sample frames per channel in {ch} channels, not {want} in {channels}"));
            i["samples"] = json!({"expected": want, "got": got});
            issues.push(i);
        }
        if ch != channels {
            return (Some(trimmed.to_vec()), None, media_time);
        }
        // A silent film delivers silence: nothing to align, and no correlation to read.
        let quiet = |x: &[f32]| x.iter().all(|v| v.abs() < 1e-6);
        if quiet(raw) && quiet(trimmed) {
            return (Some(trimmed.to_vec()), Some(0), media_time);
        }
        let priming = d.priming.unwrap_or(0);
        // A coded sound is held to its source in the band its codec keeps: AAC at 256 kb/s keeps
        // white noise to a correlation of 0.954 over the whole band, 0.987 under 16 kHz and 0.992
        // under 10 kHz, so its sound is compared under 10 kHz.
        let band = |x: &[f32]| match a["codec"] == "aac" {
            true => rules::low_pass(x, channels, rate as u32, 10_000.0),
            false => x.to_vec(),
        };
        let (heard, raw) = (band(trimmed), band(raw));
        let matched = rules::pcm_match(&heard, &raw, channels, MAX_LAG);
        let lag = matched.first().map(|m| m.lag);
        if rules::swapped(&heard, &raw, channels) {
            let mut i = issue("export.fidelity", None, "the delivery's channels are swapped: channel 0 holds the raw channel 1 and channel 1 the raw channel 0".into());
            i["channels"] = json!([0, 1]);
            issues.push(i);
        } else if let Some((c, m)) = matched
            .iter()
            .enumerate()
            .find(|(_, m)| m.lag != 0 || m.correlation < 0.99)
        {
            let why = if m.lag == priming && priming != 0 {
                format!(": the encoder's priming, {priming} samples, isn't removed")
            } else {
                String::new()
            };
            let mut i =
                issue(
                    "export.fidelity",
                    None,
                    format!(
                "channel {c} best matches the raw PCM {} samples {}, at correlation {:.4}{why}",
                m.lag.abs(), if m.lag >= 0 { "late" } else { "early" }, m.correlation),
                );
            i["lag"] = json!(m.lag);
            i["priming"] = json!(priming);
            i["correlation"] = json!(m.correlation);
            issues.push(i);
        }
        (Some(trimmed.to_vec()), lag, media_time)
    }

    /// Every decoded frame held to its own frame drawn again: exactly the receipt's frames, each
    /// closer to its own than to a neighbour that differs, luma (and alpha) above the floor.
    /// `readers` are the decode workers streaming the delivery's frames, each from its first frame
    /// up to the next one's.
    fn read_frames(
        &mut self,
        d: &Delivery,
        readers: &mut [(Helper, i64, i64)],
        n: i64,
        v: &Value,
        issues: &mut Vec<Value>,
    ) -> Result<Value, Value> {
        let want = d.frames.end - d.frames.start;
        if n != want {
            issues.push(issue(
                "export.fidelity",
                None,
                format!("the delivery holds {n} frames, not the receipt's {want}"),
            ));
        }
        let px = d.size.map(u32::from);
        let plane = (px[0] * px[1]) as usize;
        let gpu = self
            .gpu3()
            .map(|g| g.device().clone())
            .ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
        let mut cmp = FrameChecks::new(&gpu.device).compare(&gpu.device, &gpu.queue, px);
        let mut hasher = deep_gpu::blake3::Blake3::new(&gpu.device, Default::default()).frames(
            &gpu.device,
            &gpu.queue,
            px,
        );
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, d.doc);
        let floor = rules::quality_floor(&d.job.quality).unwrap_or(40.0);
        let lost = |_| json!({"outcome": "stopped", "code": "device_lost", "what": "the GPU device was lost reading the delivery"});
        let (mut drawn, mut scores, mut first_bad, mut closer) = (0i64, Vec::new(), None, None);
        let mut alpha: Option<(f64, f64)> = None;
        // Each kept redrawn frame's luma and alpha sums, for the level SSIM leaves to PSNR.
        let mut levels: std::collections::BTreeMap<i64, [u64; 2]> = Default::default();
        let mut buf = Vec::new();
        let mut decode_seconds: Option<f64> = None;
        for i in 0..n {
            let r = readers
                .iter()
                .position(|(_, from, to)| *from <= i && i < *to)
                .unwrap_or(0);
            if i > 0 && i == readers[r].1 {
                // The worker before has sent its last frame: its decode time.
                let took = readers[r - 1]
                    .0
                    .hear()
                    .and_then(|e| e["decode_seconds"].as_f64());
                decode_seconds = longer(decode_seconds, took);
            }
            if let Err(e) = next_frame(&mut readers[r].0, &mut buf) {
                issues.push(issue(
                    "export.fidelity",
                    Some(d.frames.start + i),
                    format!("frame {} doesn't decode: {e}", d.frames.start + i),
                ));
                return Ok(Value::Null);
            }
            if i >= want {
                continue;
            }
            while drawn <= (i + 1).min(want - 1) {
                levels.insert(
                    drawn,
                    self.redraw(d, &mut sched, &mut session, drawn, &mut hasher, &mut cmp)?,
                );
                levels.retain(|j, _| *j + 2 > i);
                drawn += 1;
            }
            let k = d.frames.start + i;
            let got = cmp
                .compare(Plane::Luma, &buf[..plane.min(buf.len())], i)
                .map_err(lost)?;
            let own = got[0].1;
            let luma = (rules::psnr(own.sse, own.samples), own.ssim);
            let sums = levels.get(&i).copied().unwrap_or_default();
            let mut ok = meets(luma.0, luma.1, floor, || {
                level_kept(&buf[..plane.min(buf.len())], sums[0])
            });
            // A neighbour that differs is one the floor tells apart: a frame within the floor of
            // its own is true to it, however close a neighbour within the floor too may read.
            if !ok {
                for (j, s) in &got[1..] {
                    if d.hashes[*j as usize] != d.hashes[i as usize] && s.sse < own.sse {
                        closer.get_or_insert((k, d.frames.start + j));
                    }
                }
            }
            if v["alpha"] == json!(true) && buf.len() >= 2 * plane {
                let a = cmp
                    .compare(Plane::Alpha, &buf[plane..2 * plane], i)
                    .map_err(lost)?[0]
                    .1;
                let a = (rules::psnr(a.sse, a.samples), a.ssim);
                ok &= meets(a.0, a.1, floor, || {
                    level_kept(&buf[plane..2 * plane], sums[1])
                });
                alpha = Some(alpha.map_or(a, |(p, s): (f64, f64)| (p.min(a.0), s.min(a.1))));
            }
            if !ok {
                first_bad.get_or_insert(k);
            }
            scores.push((k, luma.0, luma.1));
        }
        // The workers decode at once: the delivery's decode takes the longer of their times.
        if let Some((last, _, _)) = readers.last_mut() {
            decode_seconds = longer(
                decode_seconds,
                last.hear().and_then(|e| e["decode_seconds"].as_f64()),
            );
        }
        let worker = &mut readers[0].0;
        if let Some((k, j)) = closer {
            issues.push(issue(
                "export.fidelity",
                Some(k),
                format!("decoded frame {k} is closer to raw frame {j} than to its own"),
            ));
        }
        let mut sorted = scores.clone();
        sorted.sort_by(|a, b| a.1.total_cmp(&b.1));
        let worst: Vec<Value> = sorted
            .iter()
            .take(sorted.len().div_ceil(100))
            .map(|(k, p, s)| json!({"frame": k, "psnr_y": finite(*p), "ssim": s}))
            .collect();
        if let Some(k) = first_bad {
            let mut i = issue(
                "export.fidelity",
                Some(k),
                format!(
                    "frame {k} is the first under the {floor} dB floor; the worst frames: {}",
                    worst
                        .iter()
                        .map(|w| format!(
                            "frame {} at {:.2} dB",
                            w["frame"],
                            w["psnr_y"].as_f64().unwrap_or(f64::INFINITY)
                        ))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            );
            i["floor"] = json!(floor);
            i["frames"] = json!(worst.iter().map(|w| w["frame"].clone()).collect::<Vec<_>>());
            i["worst_1pct"] = json!(worst);
            // The worst frame as the delivery's own bytes decode, kept as evidence.
            let at = sorted.first().map_or(0, |s| s.0 - d.frames.start);
            i["picture"] = json!(self.picture(worker, d.path, at, d.size));
            issues.push(i);
        }
        let min_p = scores.iter().map(|s| s.1).fold(f64::INFINITY, f64::min);
        let min_s = scores.iter().map(|s| s.2).fold(1.0, f64::min);
        let alpha = alpha.map_or(Value::Null, |(p, s)| json!({"psnr": finite(p), "ssim": s}));
        Ok(
            json!({"frames": n, "floor": {"psnr_y": floor}, "psnr_y": finite(min_p), "ssim": min_s, "alpha": alpha, "worst_1pct": worst,
            "decode_seconds": decode_seconds}),
        )
    }

    /// The delivery's frame `i` (in presentation order) decoded through its own tags, as a PNG in
    /// the evidence store: its SHA-256.
    fn picture(&self, worker: &mut Helper, path: &Path, i: i64, size: [u16; 2]) -> Option<String> {
        let out = std::env::temp_dir().join(format!("deep-157-picture-{}-{i}", std::process::id()));
        let reply = worker.ask(
            &json!({"op": "decode", "path": path, "out": out, "frames": [i], "format": "bgra"}),
        );
        let streams = reply
            .pointer("/decoded/streams")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let file = streams
            .iter()
            .find(|s| s["type"] == "video")
            .and_then(|s| s["frames"][0]["file"].as_str())
            .map(|f| out.join(f));
        let png = file
            .and_then(|f| std::fs::read(f).ok())
            .filter(|b| b.len() == usize::from(size[0]) * usize::from(size[1]) * 4)
            .map(|mut b| {
                for p in b.as_chunks_mut::<4>().0 {
                    p.swap(0, 2);
                }
                crate::snapshot::png(b, size)
            });
        let _ = std::fs::remove_dir_all(&out);
        crate::evidence::put(&self.scenario.evidence, &png?).ok()
    }

    /// Frame `j` of the delivery drawn again in the check's own session (or, planted, the first
    /// pass's copy), used only if its hash equals the receipt's, then kept on the GPU for the
    /// comparison. A frame that draws differently stops the export, naming it.
    fn redraw(
        &mut self,
        d: &Delivery,
        sched: &mut Scheduler<'_>,
        session: &mut DocSession,
        j: i64,
        hasher: &mut deep_gpu::blake3::Frames,
        cmp: &mut Compare,
    ) -> Result<[u64; 2], Value> {
        let k = d.frames.start + j;
        let bgra = match d.kept {
            Some(kept) => kept[j as usize].clone(),
            None => {
                let (mut px, _) = self
                    .export_frame(sched, session, d.doc, k * d.frame, d.job.size, !d.job.alpha)
                    .map_err(|u| {
                        super::stopped(
                            k,
                            u.code,
                            &format!("frame {k} can't be drawn again: {}", u.code),
                        )
                    })?;
                for p in px.as_chunks_mut::<4>().0 {
                    p.swap(0, 2);
                }
                px
            }
        };
        let lost = |_| {
            super::stopped(
                k,
                "device_lost",
                &format!("the GPU device was lost at frame {k}"),
            )
        };
        let mut digest = hasher.push(&bgra).map_err(lost)?;
        if digest.is_none() {
            digest = hasher.finish().map_err(lost)?;
        }
        if digest.as_ref() != d.hashes.get(j as usize) {
            return Err(
                json!({"outcome": "stopped", "code": "export.fidelity", "frame": k, "issues": [{"check": "export.fidelity",
                "code": "export.fidelity", "frame": k, "what": format!("frame {k} draws differently the second time: its hash {} isn't the receipt's {}",
                    digest.map(hex).unwrap_or_default(), d.hashes.get(j as usize).map(hex).unwrap_or_default())}]}),
            );
        }
        cmp.reference(j, &bgra, d.job.premultiplied).map_err(lost)?;
        Ok(deep_gpu::frame_checks::plane_sums(
            &bgra,
            d.job.premultiplied,
        ))
    }

    /// A PNG sequence's fidelity is exact: each decoded frame's BGRA8 bytes hash equal to its raw
    /// frame's.
    fn read_pngs(&mut self, d: &Delivery, worker: &mut Helper) -> Result<Read, Value> {
        let s = stream(worker, d.path, "bgra", None)?;
        let n = s["video"]["frames"].as_i64().unwrap_or(0);
        let mut issues = Vec::new();
        let want = d.frames.end - d.frames.start;
        if n != want {
            issues.push(issue(
                "export.fidelity",
                None,
                format!("the delivery holds {n} frames, not the receipt's {want}"),
            ));
        }
        let gpu = self
            .gpu3()
            .map(|g| g.device().clone())
            .ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
        let mut hasher = deep_gpu::blake3::Blake3::new(&gpu.device, Default::default()).frames(
            &gpu.device,
            &gpu.queue,
            d.size.map(u32::from),
        );
        let mut buf = Vec::new();
        for i in 0..n.min(want) {
            let k = d.frames.start + i;
            let digest = match next_frame(worker, &mut buf) {
                Ok(_) if buf.len() as u64 == u64::from(d.size[0]) * u64::from(d.size[1]) * 4 => {
                    let lost = |_| {
                        super::stopped(
                            k,
                            "device_lost",
                            "the GPU device was lost reading the delivery",
                        )
                    };
                    match hasher.push(&buf).map_err(lost)? {
                        Some(h) => Some(h),
                        None => hasher.finish().map_err(lost)?,
                    }
                }
                _ => None,
            };
            if digest.as_ref() != d.hashes.get(i as usize) {
                issues.push(issue(
                    "export.fidelity",
                    Some(k),
                    format!("frame {k}: its decoded PNG isn't its raw frame by hash"),
                ));
                break;
            }
        }
        if !issues.is_empty() {
            return Err(failed("export.fidelity", issues));
        }
        Ok(Read {
            fidelity: json!({"frames": n, "exact": true}),
            av_offset: None,
            edit_list: None,
            pcm: None,
        })
    }
}

/// export.sync on the decoded sound, trimmed by its edit list: at each frame that shows a whole
/// second and draws white (the sync fixture's mark), the 2 ms 4 kHz burst on channel 0 is found at
/// that frame's first sample, 0 samples late for PCM and within one sample for AAC.
fn sync_issues(d: &Delivery, pcm: &[f32], channels: usize, hz: u32, aac: bool) -> Vec<Value> {
    let flicks = deep_canvas::grammar::FLICKS_PER_SECOND;
    let first = d.frames.start;
    let start = super::span_at(first, d.frame, hz);
    let left: Vec<f32> = pcm.iter().step_by(channels.max(1)).copied().collect();
    let burst = rules::burst(hz);
    let mut out = Vec::new();
    for (i, r) in d.reads.iter().enumerate() {
        let k = first + i as i64;
        let white: u64 = r.histogram[250..].iter().map(|&n| u64::from(n)).sum();
        // The frame that shows whole second s: ⌊s ÷ Δ⌋ = k.
        let s = (k * d.frame + flicks - 1) / flicks;
        if r.pixels == 0
            || (white as f64) < 0.98 * r.pixels as f64
            || s < 1
            || (s * flicks) / d.frame != k
        {
            continue;
        }
        let at = super::span_at(k, d.frame, hz) - start;
        let Some(lag) = rules::burst_lag(&left, &burst, at, MAX_LAG) else {
            continue;
        };
        // A white frame with no burst near it is no sync mark: the burst must be there, its shape
        // matching the analytic burst's (normalized correlation at least 0.9).
        let from = usize::try_from(at + lag).unwrap_or(usize::MAX);
        let Some(window) = left.get(from..from.saturating_add(burst.len())) else {
            continue;
        };
        let dot = |a: &[f32], b: &[f32]| {
            a.iter()
                .zip(b)
                .map(|(x, y)| f64::from(*x) * f64::from(*y))
                .sum::<f64>()
        };
        let shape = dot(window, &burst)
            / (dot(window, window) * dot(&burst, &burst))
                .sqrt()
                .max(f64::MIN_POSITIVE);
        if shape < 0.9 {
            continue;
        }
        if lag.abs() > i64::from(aac) {
            let mut i = issue(
                "export.sync",
                Some(k),
                format!(
                    "second {s}: the burst is {lag} samples late against frame {k}, which shows it"
                ),
            );
            i["second"] = json!(s);
            i["lag"] = json!(lag);
            out.push(i);
        }
    }
    out
}

/// The probe's error: over each 16 × 16 block, inside one of its flat patches, the largest
/// difference of a channel's mean between what was encoded and what decoded, in code values.
fn patch_error(sent: &[u8], got: &[u8], [w, h]: [u32; 2], channels: usize) -> f64 {
    let (w, h) = (w as usize, h as usize);
    let mut worst = 0.0f64;
    for by in (0..h).step_by(16) {
        for bx in (0..w).step_by(16) {
            let mut sums = [[0u64; 4]; 2];
            let mut n = 0u64;
            for y in by..(by + 16).min(h) {
                for x in bx..(bx + 16).min(w) {
                    let at = 4 * (y * w + x);
                    for c in 0..channels {
                        sums[0][c] += u64::from(sent[at + c]);
                        sums[1][c] += u64::from(got[at + c]);
                    }
                    n += 1;
                }
            }
            for (a, b) in sums[0].iter().zip(&sums[1]).take(channels) {
                worst = worst.max((*a as f64 - *b as f64).abs() / n as f64);
            }
        }
    }
    (worst * 100.0).round() / 100.0
}

/// The longer of two times, either missing.
fn longer(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

/// A PSNR as JSON: infinite (identical) as null.
fn finite(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        Value::Null
    }
}
