//! Issue #501: an export's jobs in the encode tool. `export.part` encodes one shard's raw frames
//! into a video-only part, `export.join` lays the parts end to end without encoding again and
//! adds the sound (the PCM, or AAC encoded from it) and the timecode, and `export.png` writes the frames as PNGs. Frames are BGRA8
//! files, rows top-down without padding, alpha straight. Each output is written under a temporary
//! sibling name and renamed when it is whole.
//!
//! #157: `export.part` and `export.png` also take `frames: N`, the frames then coming over the
//! pipe one at a time (NV12 for a 4:2:0 codec, BGRA otherwise), and a part's coded samples go to
//! its file as the encoder gives them, so the tool holds one frame. A join reads each part's
//! `moov` alone and copies its samples across, never holding a part.

use std::cell::RefCell;
use std::fs::File;
use std::io::{BufRead, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::pipe::Pipe;
use crate::{mov, mp4, refused, Job, Planted};

fn error(e: impl ToString) -> Value {
    json!({"error": e.to_string()})
}

/// Runs the export job `op`: its reply, or the error or refusal to answer with.
pub(crate) fn run(op: &str, job: &Job, planted: &Planted) -> Result<Value, Value> {
    match op {
        "export.part" => part(job, planted),
        "export.join" => join(job, planted),
        "export.png" => png(job, planted),
        _ => Err(error(format!("no job {op}"))),
    }
}

/// `out` beside its temporary name: `make` fills the temporary one, which takes the output's name
/// only when `make` succeeds and is removed when it doesn't.
fn whole(out: &str, make: impl FnOnce(&Path) -> Result<(), Value>) -> Result<(), Value> {
    let tmp = format!("{out}.part");
    let tmp = Path::new(&tmp);
    let done = make(tmp).and_then(|()| std::fs::rename(tmp, out).map_err(error));
    if done.is_err() {
        let _ = std::fs::remove_dir_all(tmp).or_else(|_| std::fs::remove_file(tmp));
    }
    done
}

fn text<'a>(job: &'a Job, key: &str) -> Result<&'a str, Value> {
    job.s(key)
        .ok_or_else(|| error(format!("an export names its {key}")))
}

fn pair(job: &Job, key: &str) -> Result<[u32; 2], Value> {
    let n = |i: usize| {
        (job.v.get(key).and_then(|v| v[i].as_u64())).filter(|n| (1..=u32::MAX as u64).contains(n))
    };
    match [n(0), n(1)] {
        [Some(a), Some(b)] => Ok([a as u32, b as u32]),
        _ => Err(error(format!("an export names its {key}"))),
    }
}

/// The job's frames, each `size[0] × size[1]` BGRA8 pixels.
fn frames(job: &Job, size: [u32; 2]) -> Result<Vec<Vec<u8>>, Value> {
    let paths = (job.v.get("frames").and_then(Value::as_array))
        .ok_or_else(|| error("an export names its frames"))?;
    let bytes = size[0] as usize * size[1] as usize * 4;
    (paths.iter().enumerate())
        .map(|(k, p)| {
            let frame = std::fs::read(p.as_str().unwrap_or_default()).map_err(error)?;
            match frame.len() == bytes {
                true => Ok(frame),
                false => Err(error(format!(
                    "frame {k} holds {} bytes, not {bytes}",
                    frame.len()
                ))),
            }
        })
        .collect()
}

/// #157: the planted feeds' frame k: none for the dropped frame 700, frame 701's pixels again
/// for frame 702; else the frame itself.
#[derive(Default)]
struct Feed {
    held: Option<Vec<u8>>,
}

impl Feed {
    fn frame<'a>(&'a mut self, k: u64, frame: &'a [u8], planted: &Planted) -> Option<&'a [u8]> {
        if planted.is("writer_drops_frame_700") && k == 700 {
            return None;
        }
        if planted.is("writer_repeats_frame_701") {
            match k {
                701 => self.held = Some(frame.to_vec()),
                702 => return self.held.as_deref().or(Some(frame)),
                _ => {}
            }
        }
        Some(frame)
    }
}

/// #157: the encoder's Quality for a tier, its floor 35, 40 or 45 dB of luma PSNR, raised for a
/// look with grain. Spike 1, 1080p60, H.264 and HEVC alike: frames with ±12 grain clear each
/// floor from 0.70, 0.80 and 0.90 (least PSNR 36.2, 41.5, 49.2 dB); clean gradients clear 43 dB
/// at 0.30 and 46 at 0.50, so the plain tiers keep a margin for detail.
fn quality(tier: &str, grain: bool) -> Result<f64, Value> {
    let tiers = [("draft", 0.50, 0.70), ("standard", 0.65, 0.80), ("master", 0.80, 0.90)];
    match tiers.iter().find(|t| t.0 == tier) {
        Some((_, plain, grained)) => Ok(if grain { *grained } else { *plain }),
        None => Err(error(format!("no export quality {tier}"))),
    }
}

/// #157: the planted starved encoder's bit rate, asked for whatever the look, size or quality.
/// Spike 1: from 1 Mb/s down the encoder gives about 3.8 Mb/s (H.264) or 1.6 (HEVC) at 1080p60,
/// 29 to 30 dB of luma PSNR with grain and 32 to 34 without.
const STARVED: u32 = 64_000;

/// A part being written under its temporary name: `ftyp` and a 64-bit `mdat` header, then each
/// coded sample as the encoder gives it, then `moov` once they are all in.
#[cfg(target_os = "macos")]
struct Samples {
    file: BufWriter<File>,
    sizes: Vec<u32>,
    keys: Vec<bool>,
    /// H.264's SEI units are left out: they carry a per-session value, and the same frames must
    /// give the same file (no picture data is in them).
    strip: bool,
}

/// #157: one shard's part: its frames through the platform's encoder into a video-only part, an
/// MP4 of H.264 or HEVC or a QuickTime movie of ProRes 4444. Dropped unfinished, it removes its
/// file.
#[cfg(target_os = "macos")]
struct Part {
    settings: crate::apple::Settings,
    /// The Quality its tier asks for, reported even when the planted encoder starves instead.
    floor: Option<f64>,
    ticks: u32,
    shift: u32,
    first: u64,
    out: String,
    tmp: PathBuf,
    samples: Rc<RefCell<Samples>>,
    encoder: Option<crate::apple::Encoder<'static>>,
    feed: Feed,
    planted: Planted,
    pushed: usize,
    /// The planted encoder's samples whose key frame was asked for and is not kept.
    unkeyed: Vec<usize>,
    done: bool,
}

#[cfg(target_os = "macos")]
impl Part {
    fn open(job: &Job, planted: &Planted, first: u64) -> Result<Part, Value> {
        use crate::apple::{Codec, Encoder, Settings};
        let (size, [p, q]) = (pair(job, "size")?, pair(job, "rate")?);
        let name = text(job, "codec")?;
        let codec = match name {
            "h264" => Codec::H264,
            "hevc" => Codec::Hevc,
            "prores_4444" => Codec::ProRes4444,
            other => return Err(error(format!("no export codec {other}"))),
        };
        let yuv = codec != Codec::ProRes4444;
        let grain = job.v.get("grain").and_then(Value::as_bool) == Some(true);
        let quality = match (yuv, job.s("quality")) {
            (true, Some(tier)) => Some(quality(tier, grain)?),
            _ => None,
        };
        let starved = yuv && planted.is("encoder_starves_bitrate");
        let (timescale, ticks) = mov::planted_timescale(p, q, planted);
        let settings = Settings {
            codec,
            size,
            rate: [p, q],
            timescale,
            quality: quality.filter(|_| !starved),
            bitrate: starved.then_some(STARVED),
            key_interval: (job.v.get("keyframe_interval").and_then(Value::as_u64))
                .map(|n| n as u32),
            colr: match yuv && planted.is("encode_full_range_bt601") {
                true => mp4::Colr {
                    primaries: 6,
                    transfer: 6,
                    matrix: 6,
                    full_range: Some(true),
                    ..mov::BT709
                },
                false => mov::BT709,
            },
        };
        let out = text(job, "out")?.to_string();
        let tmp = PathBuf::from(format!("{out}.part"));
        let brand = if yuv { mov::Brand::Mp4 } else { mov::Brand::Mov };
        let mut file = BufWriter::with_capacity(1 << 20, File::create(&tmp).map_err(error)?);
        let written = file
            .write_all(&mov::ftyp(brand))
            .and_then(|()| file.write_all(&[0, 0, 0, 1, b'm', b'd', b'a', b't', 0, 0, 0, 0, 0, 0, 0, 0]));
        let samples = Rc::new(RefCell::new(Samples {
            file,
            sizes: Vec::new(),
            keys: Vec::new(),
            strip: codec == Codec::H264,
        }));
        let mut part = Part {
            floor: quality,
            ticks,
            shift: if planted.is("muxer_drops_video_edit_list") { ticks } else { 0 },
            first,
            out,
            tmp,
            samples: samples.clone(),
            encoder: None,
            feed: Feed::default(),
            planted: planted.clone(),
            pushed: 0,
            unkeyed: Vec::new(),
            done: false,
            settings,
        };
        written.map_err(error)?;
        let sink = move |c: crate::apple::Coded| {
            let mut s = samples.borrow_mut();
            // The platform's encoder writes each NAL unit after a 4-byte length.
            let bytes = if s.strip { without_sei(&c.bytes, 4) } else { c.bytes };
            s.file.write_all(&bytes).map_err(|e| e.to_string())?;
            s.sizes.push(bytes.len() as u32);
            s.keys.push(c.key);
            Ok(())
        };
        part.encoder = Some(Encoder::open(&part.settings, sink).map_err(error)?);
        Ok(part)
    }

    /// The frames it takes: their format and bytes.
    fn format(&self) -> (&'static str, usize) {
        let bgra = self.settings.codec == crate::apple::Codec::ProRes4444;
        (if bgra { "bgra" } else { "nv12" }, self.settings.frame_bytes())
    }

    /// Frame k, a key frame when `key`, through the planted feeds.
    fn push(&mut self, k: u64, frame: &[u8], key: bool) -> Result<(), Value> {
        let Some(frame) = self.feed.frame(k, frame, &self.planted) else {
            return Ok(());
        };
        // The planted video writer leaves out each part's third frame.
        if self.planted.is("video_writer_drops_frame") && k == self.first + 2 {
            return Ok(());
        }
        let key = match self.planted.is("encoder_ignores_chapters") {
            true => {
                if key && self.pushed > 0 {
                    self.unkeyed.push(self.pushed);
                }
                self.pushed == 0
            }
            false => key,
        };
        let planted = Part::planted_pixels(&self.settings, &self.planted, frame);
        let frame = planted.as_deref().unwrap_or(frame);
        let pts = (k - self.first) as i64 * self.ticks as i64;
        let encoder = self.encoder.as_mut().ok_or_else(|| error("no encoder"))?;
        encoder.push(frame, pts, key).map_err(error)?;
        self.pushed += 1;
        Ok(())
    }

    /// The planted feeds' pixels: NV12 stretched to full range under limited-range tags, or
    /// ProRes fed full-range colour, or colour multiplied by alpha for a session told it is
    /// straight.
    fn planted_pixels(
        settings: &crate::apple::Settings,
        planted: &Planted,
        frame: &[u8],
    ) -> Option<Vec<u8>> {
        let is = |name| planted.is(name);
        // (v − lo) × 255 ÷ span, rounded and held to a byte.
        let stretch = |v: u8, lo: i32, span: i32| {
            ((v as i32 - lo) * 255 + span / 2).div_euclid(span).clamp(0, 255) as u8
        };
        let luma = (settings.size[0] * settings.size[1]) as usize;
        match settings.codec {
            crate::apple::Codec::ProRes4444 if is("prores_fed_full_range") => Some(
                (frame.as_chunks::<4>().0.iter())
                    .flat_map(|p| {
                        let c = |i: usize| stretch(p[i], 16, 219);
                        [c(0), c(1), c(2), p[3]]
                    })
                    .collect(),
            ),
            crate::apple::Codec::ProRes4444 if is("prores_premultiplies_straight") => Some(
                (frame.as_chunks::<4>().0.iter())
                    .flat_map(|p| {
                        let by = |c: u8| ((c as u32 * p[3] as u32 + 127) / 255) as u8;
                        [by(p[0]), by(p[1]), by(p[2]), p[3]]
                    })
                    .collect(),
            ),
            crate::apple::Codec::H264 | crate::apple::Codec::Hevc
                if is("h264_full_range_under_limited_tags") =>
            {
                Some(
                    (frame.iter().enumerate())
                        .map(|(i, v)| match i < luma {
                            true => stretch(*v, 16, 219),
                            false => stretch(*v, 128 - 112, 224),
                        })
                        .collect(),
                )
            }
            // The encoder keeps a floor of bits per frame that leaves a small frame almost whole
            // at any asked bit rate, so the starved encoder also loses what starving loses: each
            // 8 × 8 block of luma, and 4 × 4 of each chroma plane, flattened to its mean.
            crate::apple::Codec::H264 | crate::apple::Codec::Hevc if is("encoder_starves_bitrate") => {
                let [w, h] = settings.size.map(|n| n as usize);
                let mut out = frame.to_vec();
                flatten(&mut out[..luma], w, h, 1, 8);
                flatten(&mut out[luma..], w / 2, h / 2, 2, 4);
                Some(out)
            }
            _ => None,
        }
    }

    /// Waits for the encoder, writes `moov` after the samples and gives the part its name: the
    /// reply naming the encoder, the frames, the sync samples' frame numbers and the file's hash.
    fn finish(mut self) -> Result<Value, Value> {
        let encoder = self.encoder.take().ok_or_else(|| error("no encoder"))?;
        let finished = encoder.finish().map_err(error)?;
        let codec = self.settings.codec;
        let config = finished.config.filter(|_| codec != crate::apple::Codec::ProRes4444);
        let mut s = self.samples.borrow_mut();
        if s.strip && config.as_ref().and_then(|c| c.get(4)).map(|b| b & 3) != Some(3) {
            return Err(error("the encoder's NAL units aren't 4-byte lengths"));
        }
        if s.sizes.len() != self.pushed {
            let given = s.sizes.len();
            return Err(error(format!("the encoder gave {given} frames of {}", self.pushed)));
        }
        for i in &self.unkeyed {
            s.keys[*i] = false;
        }
        let brand = match codec {
            crate::apple::Codec::ProRes4444 => mov::Brand::Mov,
            _ => mov::Brand::Mp4,
        };
        let layout = mov::Layout {
            fourcc: codec.fourcc(),
            config: config.as_deref(),
            size: self.settings.size,
            timescale: self.settings.timescale,
            ticks: self.ticks,
            sizes: s.sizes.clone(),
            keys: (codec != crate::apple::Codec::ProRes4444).then(|| s.keys.clone()),
            colr: self.settings.colr,
            shift: self.shift,
        };
        let at = mov::ftyp(brand).len() as u64;
        let payload: u64 = s.sizes.iter().map(|n| *n as u64).sum();
        let tail = mov::moov(brand, &layout, None, None, at + 16);
        let file = &mut s.file;
        file.write_all(&tail)
            .and_then(|()| file.seek(SeekFrom::Start(at + 8)))
            .and_then(|_| file.write_all(&(payload + 16).to_be_bytes()))
            .and_then(|()| file.flush())
            .map_err(error)?;
        let keys: Vec<u64> = (s.keys.iter().enumerate())
            .filter(|(_, key)| **key)
            .map(|(i, _)| self.first + i as u64)
            .collect();
        let frames = s.sizes.len();
        drop(s);
        std::fs::rename(&self.tmp, &self.out).map_err(error)?;
        self.done = true;
        let sha = hash_file(Path::new(&self.out)).map_err(error)?;
        Ok(json!({"encoder": {"name": codec.name(), "version": crate::apple::os_version(),
            "hardware": finished.hardware, "quality_floor": self.floor},
            "frames": frames, "keys": keys, "sha256": sha}))
    }
}

#[cfg(target_os = "macos")]
impl Drop for Part {
    fn drop(&mut self) {
        if !self.done {
            self.encoder.take();
            let _ = std::fs::remove_file(&self.tmp);
        }
    }
}

/// A file's SHA-256, read a megabyte at a time.
fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut sha = Hashed(std::io::sink(), Sha256::new());
    std::io::copy(&mut File::open(path)?, &mut BufWriter::with_capacity(1 << 20, &mut sha))?;
    Ok(hex(sha.1))
}

fn hex(sha: Sha256) -> String {
    sha.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// A writer that hashes what passes through it.
struct Hashed<W>(W, Sha256);

impl<W: Write> Write for Hashed<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.0.write(buf)?;
        self.1.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// One shard's frames from their files (`frames: [paths]`): BGRA8, converted to NV12 here for a
/// 4:2:0 codec, the first one a key frame.
#[cfg(target_os = "macos")]
fn part(job: &Job, planted: &Planted) -> Result<Value, Value> {
    let size = pair(job, "size")?;
    let frames = frames(job, size)?;
    let mut part = Part::open(job, planted, 0)?;
    let nv12 = part.format().0 == "nv12";
    for (k, frame) in frames.iter().enumerate() {
        let (w, h) = (size[0] as usize, size[1] as usize);
        let frame = match nv12 {
            true => crate::color::nv12(frame, w, h),
            false => frame.clone(),
        };
        part.push(k as u64, &frame, k == 0)?;
    }
    part.finish()
}

#[cfg(not(target_os = "macos"))]
fn part(_: &Job, _: &Planted) -> Result<Value, Value> {
    Err(error("no encoder on this platform"))
}

/// #157: a PNG sequence whose frames come over the pipe, each written as it comes.
struct Pngs {
    size: [u32; 2],
    out: String,
    tmp: PathBuf,
    feed: Feed,
    planted: Planted,
    keys: Vec<u64>,
    done: bool,
}

impl Pngs {
    fn open(job: &Job, planted: &Planted) -> Result<Pngs, Value> {
        let out = text(job, "out")?.to_string();
        let tmp = PathBuf::from(format!("{out}.part"));
        std::fs::create_dir_all(&tmp).map_err(error)?;
        Ok(Pngs {
            size: pair(job, "size")?,
            out,
            tmp,
            feed: Feed::default(),
            planted: planted.clone(),
            keys: Vec::new(),
            done: false,
        })
    }

    fn push(&mut self, k: u64, frame: &[u8]) -> Result<(), Value> {
        if let Some(frame) = self.feed.frame(k, frame, &self.planted) {
            png_frame(&self.tmp, k, frame, self.size, &self.planted)?;
            self.keys.push(k);
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Value, Value> {
        std::fs::rename(&self.tmp, &self.out).map_err(error)?;
        self.done = true;
        Ok(json!({"encoder": {"name": "image png", "version": "0.25", "hardware": false},
            "frames": self.keys.len(), "keys": self.keys, "sha256": null}))
    }
}

impl Drop for Pngs {
    fn drop(&mut self) {
        if !self.done {
            let _ = std::fs::remove_dir_all(&self.tmp);
        }
    }
}

/// What a piped job writes into.
enum Sink {
    #[cfg(target_os = "macos")]
    Part(Box<Part>),
    Pngs(Pngs),
}

/// #157: `export.part` or `export.png` with `frames: N`: the frames `first..first + N` come over
/// the pipe in order, each answered once it is in, then `{"end": true}`; the last reply is the
/// part's. Stdin closing before the end removes what was written and answers nothing.
pub(crate) fn stream<R: BufRead, W: Write>(
    op: &str,
    job: &Job,
    planted: &Planted,
    pipe: &mut Pipe<R, W>,
) {
    let reply = match streamed(op, job, planted, pipe) {
        Ok(v) => v,
        Err(Some(e)) => e,
        Err(None) => return,
    };
    let sha = reply["sha256"].as_str().map(str::to_string);
    pipe.reply(&reply, sha.as_deref());
}

/// The piped job's last reply; `Err(None)` when stdin closed first.
fn streamed<R: BufRead, W: Write>(
    op: &str,
    job: &Job,
    planted: &Planted,
    pipe: &mut Pipe<R, W>,
) -> Result<Value, Option<Value>> {
    let n = job.v.get("frames").and_then(Value::as_u64).unwrap_or(0);
    let first = job.v.get("first").and_then(Value::as_u64).unwrap_or(0);
    let mut sink = match op {
        #[cfg(target_os = "macos")]
        "export.part" => Sink::Part(Box::new(Part::open(job, planted, first).map_err(Some)?)),
        "export.png" => Sink::Pngs(Pngs::open(job, planted).map_err(Some)?),
        _ => return Err(Some(error(format!("no piped job {op} here")))),
    };
    let (format, bytes) = match &sink {
        #[cfg(target_os = "macos")]
        Sink::Part(p) => p.format(),
        Sink::Pngs(p) => ("bgra", p.size[0] as usize * p.size[1] as usize * 4),
    };
    if job.s("format") != Some(format) {
        return Err(Some(error(format!("this export takes {format} frames"))));
    }
    pipe.reply(&json!({"ready": {"format": format, "bytes": bytes}}), None);
    let mut buf = Vec::new();
    for k in first..first + n {
        let head = pipe.next(&mut buf).ok_or(None)?;
        if head["frame"].as_u64() != Some(k) {
            return Err(Some(error(format!("frame {k} is next, not {}", head["frame"]))));
        }
        if buf.len() != bytes {
            return Err(Some(error(format!("frame {k} holds {} bytes, not {bytes}", buf.len()))));
        }
        let key = head["key"].as_bool() == Some(true);
        match &mut sink {
            #[cfg(target_os = "macos")]
            Sink::Part(p) => p.push(k, &buf, key),
            Sink::Pngs(p) => p.push(k, &buf),
        }
        .map_err(Some)?;
        pipe.reply(&json!({"frame": k}), None);
    }
    if pipe.next(&mut buf).ok_or(None)?["end"] != true {
        return Err(Some(error(format!("{n} frames, then the end"))));
    }
    match sink {
        #[cfg(target_os = "macos")]
        Sink::Part(p) => p.finish(),
        Sink::Pngs(p) => p.finish(),
    }
    .map_err(Some)
}

/// The parts in order as one file: every part's coded samples as they are, then the job's PCM
/// (`audio.codec` `pcm`, the default) or AAC encoded from it (`aac`), and its timecode. Parts that differ in codec, size, timescale or codec configuration are refused,
/// naming the first that differs and what in. #157: each part's `moov` alone is read, and its
/// samples copied across from the file.
fn join(job: &Job, planted: &Planted) -> Result<Value, Value> {
    let out = text(job, "out")?;
    let paths = (job.v.get("parts").and_then(Value::as_array))
        .filter(|p| !p.is_empty())
        .ok_or_else(|| error("an export names its parts"))?;
    let mut files = Vec::new();
    let mut tracks = Vec::new();
    for (k, p) in paths.iter().enumerate() {
        let mut file = File::open(p.as_str().unwrap_or_default()).map_err(error)?;
        let head = mp4::Head::read(&mut file).map_err(error)?;
        let video = head.movie.and_then(|m| {
            (m.tracks.into_iter()).find(|t| t.kind == mp4::Kind::Video && !t.samples.is_empty())
        });
        tracks.push(video.ok_or_else(|| error(format!("part {k} holds no video")))?);
        files.push(file);
    }
    let ticks = |t: &mp4::Track| t.duration / t.samples.len() as u64;
    let first = &tracks[0];
    for (k, t) in tracks.iter().enumerate() {
        let differs = [
            ("codec", t.entry.fourcc != first.entry.fourcc),
            (
                "size",
                (t.entry.width, t.entry.height) != (first.entry.width, first.entry.height),
            ),
            (
                "timescale",
                (t.timescale, ticks(t)) != (first.timescale, ticks(first)),
            ),
            ("config", t.entry.config != first.entry.config),
        ];
        if let Some((what, _)) = differs.iter().find(|d| d.1) {
            return Err(refused("parts_differ", json!({"part": k, "what": what})));
        }
    }
    let keys: Vec<bool> = tracks.iter().flat_map(|t| t.samples.iter().map(|s| s.key)).collect();
    let video = mov::Layout {
        fourcc: first.entry.fourcc,
        config: first.entry.config.as_ref().map(|c| &c.1[..]),
        size: [first.entry.width as u32, first.entry.height as u32],
        timescale: first.timescale,
        ticks: ticks(first) as u32,
        sizes: (tracks.iter())
            .flat_map(|t| t.samples.iter().map(|s| s.size))
            .collect(),
        keys: keys.contains(&false).then_some(keys),
        colr: first.entry.colr.unwrap_or(mov::BT709),
        shift: match planted.is("muxer_drops_video_edit_list") {
            true => ticks(first) as u32,
            false => 0,
        },
    };
    let given = |key: &str| job.v.get(key).filter(|v| !v.is_null());
    let n = |v: &Value, key: &str, max: u64| v[key].as_u64().filter(|n| (1..=max).contains(n));
    let pcm = match given("audio") {
        None => None,
        Some(a) => {
            let (Some(path), Some(rate), Some(channels)) = (
                a["path"].as_str(),
                n(a, "sample_rate", u32::MAX as u64),
                n(a, "channels", u16::MAX as u64),
            ) else {
                return Err(error(
                    "an export's audio names its path, sample_rate and channels",
                ));
            };
            // The PCM as it is, or encoded to AAC here.
            let aac = match a["codec"].as_str().unwrap_or("pcm") {
                "pcm" => false,
                "aac" => true,
                other => return Err(error(format!("no export audio codec {other}"))),
            };
            let mut f32le = std::fs::read(path).map_err(error)?;
            // #157: the planted mix's left and right change places.
            if planted.is("muxer_swaps_channels") && channels >= 2 {
                for frame in f32le.chunks_exact_mut(4 * channels as usize) {
                    let (l, r) = frame.split_at_mut(4);
                    l.swap_with_slice(&mut r[..4]);
                }
            }
            Some((rate as u32, channels as u16, aac, f32le))
        }
    };
    let aac: Option<(Vec<Vec<u8>>, Vec<u8>, u32)> = match &pcm {
        #[cfg(target_os = "macos")]
        Some((rate, channels, true, f32le)) => {
            Some(crate::apple::encode_aac(f32le, *rate, *channels as u32).map_err(error)?)
        }
        #[cfg(not(target_os = "macos"))]
        Some((_, _, true, _)) => return Err(error("no AAC encoder on this platform")),
        _ => None,
    };
    // #157: the PCM's N samples, presented exactly after the encoder's priming; the planted
    // muxers' edits.
    let mut summary = None;
    let audio = (pcm.as_ref()).map(|(rate, channels, _, f32le)| match &aac {
        None => mov::Audio::Pcm(mov::Pcm {
            rate: *rate,
            channels: *channels,
            f32le,
        }),
        Some((packets, cookie, priming)) => {
            let n = (f32le.len() / (4 * *channels as usize)) as u64;
            let coded = packets.len() as u64 * 1024;
            summary = Some(json!({"priming": priming, "packets": packets.len(),
                "padding": coded - *priming as u64 - n}));
            let edit = match () {
                _ if planted.is("muxer_strips_audio_edit_list") => None,
                _ if planted.is("muxer_edit_list_1024") => Some((1024, n)),
                _ if planted.is("muxer_keeps_end_padding") => Some((*priming, coded - *priming as u64)),
                _ => Some((*priming, n)),
            };
            mov::Audio::Aac(mov::Aac {
                rate: *rate,
                channels: *channels,
                descriptor: cookie,
                packets: packets.iter().map(|p| &p[..]).collect(),
                edit,
            })
        }
    });
    let timecode = match given("timecode") {
        None => None,
        Some(t) => {
            let (Some(start), Some(rate)) = (
                t["start_frame"].as_u64().filter(|s| *s <= u32::MAX as u64),
                n(t, "rate", u8::MAX as u64),
            ) else {
                return Err(error("an export's timecode names its start_frame and rate"));
            };
            Some(mov::Tmcd {
                // The planted writer leaves the track at zero.
                start: if planted.is("timecode_track_zero") {
                    0
                } else {
                    start as u32
                },
                nominal: rate as u8,
                drop: t["drop_frame"].as_bool().unwrap_or(false),
            })
        }
    };
    let brand = match &video.fourcc {
        b"ap4h" => mov::Brand::Mov,
        _ => mov::Brand::Mp4,
    };
    // The planted muxer writes `ftyp`, `mdat`, then `moov`.
    let last = planted.is("muxer_writes_moov_last");
    let (audio, timecode) = (audio.as_ref(), timecode.as_ref());
    let mut sha = String::new();
    whole(out, |tmp| {
        let file = File::create(tmp).map_err(error)?;
        let mut w = BufWriter::with_capacity(1 << 20, Hashed(file, Sha256::new()));
        let start = match last {
            true => [mov::ftyp(brand), moov_last_mdat(&video, audio, timecode.is_some())].concat(),
            false => mov::head(brand, &video, audio, timecode),
        };
        w.write_all(&start).map_err(error)?;
        for (k, (t, file)) in tracks.iter().zip(&mut files).enumerate() {
            copy_samples(t, file, &mut w).map_err(|e| error(format!("part {k}: {e}")))?;
        }
        for s in audio.map(mov::Audio::payload).unwrap_or_default() {
            w.write_all(s).map_err(error)?;
        }
        if let Some(t) = timecode {
            w.write_all(&t.start.to_be_bytes()).map_err(error)?;
        }
        if last {
            let at = mov::ftyp(brand).len() as u64 + 16;
            w.write_all(&mov::moov(brand, &video, audio, timecode, at))
                .map_err(error)?;
        }
        let hashed = w.into_inner().map_err(|e| error(e.error()))?;
        sha = hex(hashed.1);
        Ok(())
    })?;
    let mut reply = json!({"frames": video.sizes.len(), "sha256": sha});
    if let Some(s) = summary {
        reply["audio"] = s;
    }
    Ok(reply)
}

/// The planted muxer's 64-bit `mdat` header over the video samples, the sound and the timecode
/// sample, before `moov`.
fn moov_last_mdat(video: &mov::Layout, audio: Option<&mov::Audio>, timecode: bool) -> Vec<u8> {
    let sound: u64 = (audio.map(mov::Audio::payload).unwrap_or_default().iter())
        .map(|s| s.len() as u64)
        .sum();
    let video: u64 = video.sizes.iter().map(|s| *s as u64).sum();
    let size = 16 + video + sound + if timecode { 4 } else { 0 };
    [&[0, 0, 0, 1][..], b"mdat", &size.to_be_bytes()].concat()
}

/// Copies `t`'s samples, in order, from its part to `to`: each run of samples that lie end to
/// end at once, never the whole part.
fn copy_samples(t: &mp4::Track, from: &mut File, to: &mut impl Write) -> std::io::Result<()> {
    use std::io::Read;
    let mut i = 0;
    while i < t.samples.len() {
        let at = t.samples[i].offset;
        let mut end = at + t.samples[i].size as u64;
        i += 1;
        while i < t.samples.len() && t.samples[i].offset == end {
            end += t.samples[i].size as u64;
            i += 1;
        }
        from.seek(SeekFrom::Start(at))?;
        let copied = std::io::copy(&mut (&mut *from).take(end - at), to)?;
        if copied != end - at {
            return Err(std::io::Error::other("it is cut short"));
        }
    }
    Ok(())
}

/// The frames as PNGs with straight alpha in the folder `out`, named `000000.png` onward.
fn png(job: &Job, planted: &Planted) -> Result<Value, Value> {
    let size = pair(job, "size")?;
    let out = text(job, "out")?;
    let frames = frames(job, size)?;
    whole(out, |tmp| {
        std::fs::create_dir_all(tmp).map_err(error)?;
        for (k, frame) in frames.iter().enumerate() {
            png_frame(tmp, k as u64, frame, size, planted)?;
        }
        Ok(())
    })?;
    Ok(json!({"frames": frames.len()}))
}
/// The planted starved encoder's loss: each `n` × `n` block of each of the plane's `parts`
/// interleaved components (a `w` × `h` plane) set to the block's rounded mean.
fn flatten(plane: &mut [u8], w: usize, h: usize, parts: usize, n: usize) {
    for by in (0..h).step_by(n) {
        for bx in (0..w).step_by(n) {
            for c in 0..parts {
                let at = |x: usize, y: usize| (y * w + x) * parts + c;
                let cells: Vec<usize> = (by..(by + n).min(h)).flat_map(|y| (bx..(bx + n).min(w)).map(move |x| (x, y))).map(|(x, y)| at(x, y)).collect();
                let mean = (cells.iter().map(|&i| u32::from(plane[i])).sum::<u32>() + cells.len() as u32 / 2) / cells.len() as u32;
                cells.iter().for_each(|&i| plane[i] = mean as u8);
            }
        }
    }
}


/// Frame k (BGRA8) as `{k:06}.png` in `dir`, straight alpha.
fn png_frame(dir: &Path, k: u64, frame: &[u8], size: [u32; 2], planted: &Planted) -> Result<(), Value> {
    let mut rgba = frame.to_vec();
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
        // The planted writer stores color already multiplied by alpha.
        if planted.is("png_premultiplies_straight") {
            let by = |c: u8| ((c as u32 * p[3] as u32 + 127) / 255) as u8;
            *p = [by(p[0]), by(p[1]), by(p[2]), p[3]];
        }
    }
    image::RgbaImage::from_raw(size[0], size[1], rgba)
        .ok_or_else(|| error(format!("frame {k} isn't its size")))?
        .save(dir.join(format!("{k:06}.png")))
        .map_err(error)
}
/// An AVC sample's NAL units with its SEI units (type 6) left out; `length` is the size of each
/// unit's length prefix.
fn without_sei(sample: &[u8], length: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(sample.len());
    let mut o = 0;
    while o + length <= sample.len() {
        let n = sample[o..o + length].iter().fold(0usize, |n, b| n << 8 | usize::from(*b));
        let end = (o + length + n).min(sample.len());
        if sample.get(o + length).is_some_and(|h| h & 0x1f != 6) {
            out.extend_from_slice(&sample[o..end]);
        }
        o = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Caps;
    use std::path::PathBuf;

    /// A fresh folder for one test's files.
    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deep-codecs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn ask(job: Value, planted: &str) -> Value {
        crate::run(
            job.as_object().unwrap(),
            &Caps::default(),
            &Planted::one(planted),
        )
        .0
    }

    fn path(dir: &Path, name: &str) -> String {
        dir.join(name).to_str().unwrap().to_string()
    }

    #[test]
    fn a_png_frame_decodes_to_its_raw_frame() {
        let dir = folder("png");
        // Two pixels at half alpha, as BGRA.
        let raw = [50u8, 100, 200, 128, 255, 255, 255, 128];
        std::fs::write(dir.join("0.bgra"), raw).unwrap();
        let decoded = |planted: &str| {
            let job = json!({"op": "export.png", "frames": [path(&dir, "0.bgra")], "size": [2, 1],
                "out": path(&dir, planted)});
            assert_eq!(ask(job, planted), json!({"frames": 1}));
            assert!(!dir.join(format!("{planted}.part")).exists());
            let file = dir.join(planted).join("000000.png");
            image::open(file).unwrap().to_rgba8().into_raw()
        };
        assert_eq!(decoded("none"), [200, 100, 50, 128, 255, 255, 255, 128]);
        assert_eq!(
            decoded("png_premultiplies_straight"),
            [100, 50, 25, 128, 128, 128, 128, 128]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A part of `n` made-up samples at 24 frames a second.
    fn made_part(dir: &Path, name: &str, size: u32, n: u8) -> String {
        let samples: Vec<Vec<u8>> = (0..n).map(|k| vec![k; 3]).collect();
        let (timescale, ticks) = mov::timescale(24, 1);
        let video = mov::Video {
            fourcc: *b"ap4h",
            config: None,
            size: [size, size],
            timescale,
            ticks,
            samples: samples.iter().map(|s| &s[..]).collect(),
            keys: None,
        };
        let bytes = mov::write(mov::Brand::Mov, &video, None, None);
        std::fs::write(dir.join(name), bytes).unwrap();
        path(dir, name)
    }

    #[test]
    fn a_join_keeps_the_samples_and_writes_the_timecode() {
        let dir = folder("join");
        let parts = [made_part(&dir, "a", 64, 2), made_part(&dir, "b", 64, 3)];
        let joined = |planted: &str| {
            let out = path(&dir, "out.mov");
            let job = json!({"op": "export.join", "parts": parts, "out": out,
                "timecode": {"start_frame": 86_400, "drop_frame": false, "rate": 24}});
            assert_eq!(ask(job, planted)["frames"], 5);
            let bytes = std::fs::read(&out).unwrap();
            let v = &mp4::parse(&bytes).unwrap().tracks[0];
            let last = v.samples[4];
            assert_eq!((v.duration, last.dts), (5000, 4000));
            assert_eq!(bytes[last.offset as usize..][..3], [2, 2, 2]);
            let probe = ask(json!({"op": "probe", "path": out}), "none");
            let streams = probe["asset"]["probe"]["streams"]
                .as_array()
                .unwrap()
                .clone();
            streams
                .into_iter()
                .find(|s| s["type"] == "timecode")
                .unwrap()
        };
        assert_eq!(
            joined("none"),
            json!({"index": 1, "type": "timecode", "start_frame": 86_400, "drop_frame": false,
                "rate": 24, "time_base": [1, 24_000]})
        );
        assert_eq!(joined("timecode_track_zero")["start_frame"], 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parts_of_two_sizes_are_refused() {
        let dir = folder("differ");
        let parts = [made_part(&dir, "a", 64, 2), made_part(&dir, "b", 32, 2)];
        let out = path(&dir, "out.mov");
        let reply = ask(
            json!({"op": "export.join", "parts": parts, "out": out}),
            "none",
        );
        assert_eq!(
            reply,
            json!({"refused": {"code": "parts_differ", "part": 1, "what": "size"}})
        );
        assert!(!Path::new(&out).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A 64 x 64 frame whose color and alpha change across it and with `k`.
    #[cfg(target_os = "macos")]
    fn drawn(k: u8) -> Vec<u8> {
        (0..64 * 64)
            .flat_map(|i| {
                [i % 64 * 4, i / 64 * 4, 30 * k as usize, 255 - i % 64 * 2].map(|c| c as u8)
            })
            .collect()
    }

    /// #501: the same frames give the same H.264 part, byte for byte, in two encoder sessions.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_same_frames_give_the_same_h264_part() {
        let dir = folder("same");
        let frames: Vec<String> = (0..4u8)
            .map(|k| {
                std::fs::write(dir.join(format!("{k}.bgra")), drawn(k)).unwrap();
                path(&dir, &format!("{k}.bgra"))
            })
            .collect();
        let part = |name: &str| {
            let out = path(&dir, name);
            let job = json!({"op": "export.part", "codec": "h264", "frames": frames, "size": [64, 64],
                "rate": [24, 1], "out": out});
            assert_eq!(ask(job, "none")["frames"], 4);
            std::fs::read(&out).unwrap()
        };
        assert!(part("a.mp4") == part("b.mp4"), "two encodes of the same frames differ");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn two_shards_join_into_a_movie_with_sound_and_timecode() {
        let dir = folder("shards");
        let frames: Vec<String> = (0..8u8)
            .map(|k| {
                std::fs::write(dir.join(format!("{k}.bgra")), drawn(k)).unwrap();
                path(&dir, &format!("{k}.bgra"))
            })
            .collect();
        let pcm: Vec<u8> = (0..48_000 * 2)
            .flat_map(|i| (i as f32 / 96_000.0).to_le_bytes())
            .collect();
        std::fs::write(dir.join("pcm.f32"), pcm).unwrap();
        for (codec, name, read_as) in [
            ("h264", "film.mp4", "h264"),
            ("prores_4444", "film.mov", "ap4h"),
        ] {
            let parts: Vec<String> = (frames.chunks(4).enumerate())
                .map(|(k, shard)| {
                    let out = path(&dir, &format!("{codec}-{k}"));
                    let job = json!({"op": "export.part", "codec": codec, "frames": shard,
                        "size": [64, 64], "rate": [24, 1], "out": out});
                    assert_eq!(ask(job, "none")["frames"], 4, "{codec}");
                    out
                })
                .collect();
            let out = path(&dir, name);
            let job = json!({"op": "export.join", "parts": parts, "out": out,
                "audio": {"path": path(&dir, "pcm.f32"), "sample_rate": 48_000, "channels": 2},
                "timecode": {"start_frame": 86_400, "drop_frame": false, "rate": 24}});
            assert_eq!(ask(job, "none")["frames"], 8, "{codec}");
            let probe = ask(json!({"op": "probe", "path": out}), "none")["asset"]["probe"].clone();
            let streams = probe["streams"].as_array().unwrap();
            assert_eq!(streams.len(), 3, "{codec}");
            assert_eq!(streams[0]["codec"], read_as);
            assert_eq!(streams[0]["size"], json!([64, 64]));
            assert_eq!(streams[0]["frame_rate"], json!([24, 1]));
            assert_eq!(streams[0]["pts"].as_array().unwrap().len(), 8, "{codec}");
            assert_eq!(streams[1]["type"], "audio");
            assert_eq!(streams[1]["sample_rate"], 48_000);
            assert_eq!(streams[1]["channels"], 2);
            assert_eq!(streams[1]["duration"], json!([48_000, 48_000]));
            assert_eq!(streams[2]["type"], "timecode");
            assert_eq!(streams[2]["start_frame"], 86_400, "{codec}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_join_encodes_its_pcm_to_aac() {
        let dir = folder("aac");
        let frames: Vec<String> = (0..4u8)
            .map(|k| {
                std::fs::write(dir.join(format!("{k}.bgra")), drawn(k)).unwrap();
                path(&dir, &format!("{k}.bgra"))
            })
            .collect();
        let part = path(&dir, "part");
        let job = json!({"op": "export.part", "codec": "h264", "frames": frames,
            "size": [64, 64], "rate": [24, 1], "out": part});
        assert_eq!(ask(job, "none")["frames"], 4);
        // One second of a 440 Hz tone at half scale, the same in both channels.
        let pcm: Vec<u8> = (0..48_000)
            .flat_map(|i| {
                let v = 0.5 * (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin();
                [v, v]
            })
            .flat_map(f32::to_le_bytes)
            .collect();
        std::fs::write(dir.join("pcm.f32"), pcm).unwrap();
        let out = path(&dir, "film.mp4");
        let job = json!({"op": "export.join", "parts": [part], "out": out,
            "audio": {"path": path(&dir, "pcm.f32"), "sample_rate": 48_000, "channels": 2,
                "codec": "aac"}});
        assert_eq!(ask(job, "none")["frames"], 4);
        let probe = ask(json!({"op": "probe", "path": out}), "none");
        let streams = probe["asset"]["probe"]["streams"].as_array().unwrap();
        let a = streams.iter().find(|s| s["type"] == "audio").unwrap();
        assert_eq!(
            [&a["codec"], &a["sample_rate"], &a["channels"]],
            [&json!("aac"), &json!(48_000), &json!(2)]
        );
        let [n, d] = [0, 1].map(|k| a["duration"][k].as_i64().unwrap());
        assert!((n * 48_000 / d - 48_000).abs() <= 1024, "{}", a["duration"]);
        // The packets decode back to the tone, priming trimmed.
        let decoded = path(&dir, "decoded");
        let job = json!({"op": "decode", "path": out, "out": decoded});
        let streams = ask(job, "none")["decoded"]["streams"].clone();
        let a = (streams.as_array().unwrap().iter())
            .find(|s| s["type"] == "audio")
            .unwrap()
            .clone();
        assert!((a["samples"].as_i64().unwrap() - 48_000).abs() <= 1024);
        let bytes = std::fs::read(Path::new(&decoded).join(a["file"].as_str().unwrap())).unwrap();
        let samples: Vec<f32> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        let rms = (samples.iter().map(|v| v * v).sum::<f32>() / samples.len() as f32).sqrt();
        assert!((rms - 0.5 / 2f32.sqrt()).abs() < 0.03, "rms {rms}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    use crate::pipe::tests::piped_job;

    #[cfg(target_os = "macos")]
    fn nv12_drawn(k: u8) -> Vec<u8> {
        crate::color::nv12(&drawn(k), 64, 64)
    }

    /// #157: a piped part's video track, and its last reply.
    #[cfg(target_os = "macos")]
    fn piped_part(job: &Value, frames: &[(Vec<u8>, bool)], planted: &str) -> (mp4::Track, Value) {
        let replies = crate::pipe::tests::piped(job, frames, true, planted);
        let last = replies.last().unwrap().0.clone();
        assert_eq!(last["frames"], frames.len(), "{planted}: {last}");
        let bytes = std::fs::read(job["out"].as_str().unwrap()).unwrap();
        (mp4::parse(&bytes).unwrap().tracks.remove(0), last)
    }

    /// #157: an H.264 part says BT.709 limited range in its SPS and its `colr`, and the planted
    /// BT.601 full-range encoder doesn't; a key frame asked for is a sync sample, and the planted
    /// encoder that ignores it leaves it none; an HEVC part carries `hvcC`.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_part_tags_its_colour_and_keys_the_frames_asked() {
        use crate::color;
        let dir = folder("tags");
        let frames: Vec<(Vec<u8>, bool)> =
            (0..8u8).map(|k| (nv12_drawn(k), k == 0 || k == 5)).collect();
        let part = |codec: &str, planted: &str| {
            let out = path(&dir, &format!("{codec}-{planted}"));
            piped_part(&piped_job(codec, &out, 64, 0, 8), &frames, planted)
        };
        let signal = |t: &mp4::Track| {
            let (_, avcc) = t.entry.config.as_ref().unwrap();
            let s = color::h264_signal(color::avc_sps(avcc).unwrap()).unwrap();
            let c = t.entry.colr.unwrap();
            (s.description, s.full_range, (c.primaries, c.transfer, c.matrix, c.full_range))
        };
        let bt709 = (Some((1, 1, 1)), Some(false), (1, 1, 1, Some(false)));
        let (t, reply) = part("h264", "none");
        assert_eq!(signal(&t), bt709);
        assert!(t.samples[5].key && !t.samples[4].key);
        assert_eq!(reply["keys"], json!([0, 5]));
        // The standard tier's Quality, reported even by the planted encoder that starves.
        assert_eq!(reply["encoder"]["quality_floor"], 0.65);
        let (_, reply) = part("h264", "encoder_starves_bitrate");
        assert_eq!(reply["encoder"]["quality_floor"], 0.65);
        let (t, _) = part("h264", "encode_full_range_bt601");
        assert_ne!(signal(&t), bt709);
        assert_eq!(signal(&t).2, (6, 6, 6, Some(true)));
        let (t, reply) = part("h264", "encoder_ignores_chapters");
        assert!(!t.samples[5].key);
        assert_eq!(reply["keys"], json!([0]));
        let (t, reply) = part("hevc", "none");
        let config = t.entry.config.as_ref().map(|c| c.0);
        assert_eq!((t.entry.fourcc, config), (*b"hvc1", Some(*b"hvcC")));
        assert_eq!(reply["keys"], json!([0, 5]));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// #157: frames over the pipe give the part their files give, byte for byte; stdin closing
    /// mid-part leaves no file; the planted feeds drop frame 700, and repeat 701 at 702.
    #[cfg(target_os = "macos")]
    #[test]
    fn piped_frames_give_the_part_file_frames_give() {
        use crate::pipe::tests::piped;
        let dir = folder("piped");
        let files: Vec<String> = (0..4u8)
            .map(|k| {
                std::fs::write(dir.join(format!("{k}.bgra")), drawn(k)).unwrap();
                path(&dir, &format!("{k}.bgra"))
            })
            .collect();
        let out = path(&dir, "files.mp4");
        let job = json!({"op": "export.part", "codec": "h264", "frames": files, "size": [64, 64],
            "rate": [24, 1], "out": out, "quality": "standard"});
        assert_eq!(ask(job, "none")["frames"], 4);
        let frames: Vec<(Vec<u8>, bool)> = (0..4u8).map(|k| (nv12_drawn(k), k == 0)).collect();
        let fed = path(&dir, "piped.mp4");
        let replies = piped(&piped_job("h264", &fed, 64, 0, 4), &frames, true, "none");
        let ready = json!({"ready": {"format": "nv12", "bytes": 64 * 64 * 3 / 2}});
        assert_eq!([&replies[0].0, &replies[1].0], [&ready, &json!({"frame": 0})]);
        assert!(std::fs::read(&out).unwrap() == std::fs::read(&fed).unwrap());
        // Stdin closes after two frames of four: nothing more is said, and no file is left.
        let cut = path(&dir, "cut.mp4");
        let replies = piped(&piped_job("h264", &cut, 64, 0, 4), &frames[..2], false, "none");
        assert_eq!(replies.len(), 3);
        assert!(!Path::new(&cut).exists() && !Path::new(&format!("{cut}.part")).exists());
        // Frames 699 to 702: a part one short without 700; a PNG of 702 that is 701's.
        let count = |planted: &str| {
            let out = path(&dir, &format!("{planted}.mp4"));
            let replies = piped(&piped_job("h264", &out, 64, 699, 4), &frames, true, planted);
            replies.last().unwrap().0["frames"].clone()
        };
        assert_eq!([count("none"), count("writer_drops_frame_700")], [4, 3]);
        let bgra: Vec<(Vec<u8>, bool)> = (0..4u8).map(|k| (drawn(k), false)).collect();
        let pngs = |planted: &str| {
            let out = path(&dir, &format!("{planted}-png"));
            piped(&piped_job("png", &out, 64, 699, 4), &bgra, true, planted);
            let read = |k: u32| std::fs::read(Path::new(&out).join(format!("{k:06}.png"))).ok();
            (read(700).is_some(), read(701) == read(702))
        };
        assert_eq!(pngs("none"), (true, false));
        assert_eq!(pngs("writer_drops_frame_700"), (false, false));
        assert_eq!(pngs("writer_repeats_frame_701"), (true, true));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
