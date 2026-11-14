//! #157: the decode worker's `stream` op, how export.fidelity reads a delivery back. One reply
//! describes the file (its top-level boxes, the video's sample entry, colour, edits, times and
//! sync samples, the sound's edits and packets) and is followed by every decoded sound sample,
//! untrimmed: the caller applies the edit list itself. Then each frame in presentation order: the
//! decoder's own 8-bit Y plane (and alpha plane) unconverted, or straight BGRA through the file's
//! own tags. Samples are read where they lie, never the whole file.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::pipe::Pipe;
use crate::{codec, mp4, over_caps, points_at, refused, track_color, Caps, Format, Job, Planted};

fn error(e: impl ToString) -> Value {
    json!({"error": e.to_string()})
}

fn unreadable(e: impl ToString) -> Value {
    refused("unreadable", json!({"why": e.to_string()}))
}

/// Runs one `stream` job, answering on `pipe`.
pub(crate) fn run<R: BufRead, W: Write>(
    job: &Job,
    caps: &Caps,
    planted: &Planted,
    pipe: &mut Pipe<R, W>,
) {
    if let Err(e) = streamed(job, caps, planted, pipe) {
        pipe.reply(&e, None);
    }
}

/// The job's stream, or what to answer instead before anything is sent.
fn streamed<R: BufRead, W: Write>(
    job: &Job,
    caps: &Caps,
    planted: &Planted,
    pipe: &mut Pipe<R, W>,
) -> Result<(), Value> {
    let path = job.s("path").ok_or_else(|| error("a job names its path"))?;
    let bgra = match job.s("planes") {
        Some("luma") => false,
        Some("bgra") => true,
        _ => return Err(error("a stream's planes are luma or bgra")),
    };
    if Path::new(path).is_dir() {
        return pngs(Path::new(path), bgra, caps, pipe);
    }
    let mut file = File::open(path).map_err(unreadable)?;
    let len = file.metadata().map_err(unreadable)?.len();
    let skips = planted.is("skips_caps");
    if len > caps.max_bytes && !skips {
        let cap = json!({"cap": "max_bytes", "limit": caps.max_bytes});
        return Err(refused("over_cap", cap));
    }
    let head = mp4::Head::read(&mut file).map_err(unreadable)?;
    let movie = head
        .movie
        .ok_or_else(|| unreadable("a file without moov"))?;
    let f = Format::Movie(movie);
    if let Some(url) = points_at(&f) {
        return Err(refused("external_reference", json!({"url": url})));
    }
    if let Some(r) = over_caps(&f, caps).filter(|_| !skips) {
        return Err(r);
    }
    let Format::Movie(movie) = f else {
        unreachable!("a movie");
    };
    let boxes: Vec<Value> = (head.boxes.iter())
        .map(|(kind, at, size)| {
            json!({"type": String::from_utf8_lossy(kind), "at": at, "size": size})
        })
        .collect();
    let mut head = json!({"boxes": boxes, "movie": {"timescale": movie.timescale}});
    let mut sound = Vec::new();
    if let Some(t) = movie.tracks.iter().find(|t| t.kind == mp4::Kind::Audio) {
        let (a, bytes) = audio(t, movie.timescale, &file, planted).map_err(error)?;
        head["audio"] = a;
        sound = bytes;
    }
    // Frames `from..to` in presentation order only, so two workers split at a sync frame decode
    // a delivery at once (spike 3: one session alone falls short of 8x real time at 1080p60).
    let range = job.v.get("range").and_then(Value::as_array).map(|r| {
        let at = |i: usize| r.get(i).and_then(Value::as_u64).map(|n| n as usize);
        (at(0).unwrap_or(0), at(1).unwrap_or(usize::MAX))
    });
    let mut out = Out {
        pipe,
        head: Some((head, sound)),
        bgra,
        matrix: String::new(),
        range: String::new(),
        blocked: Duration::ZERO,
    };
    match movie.tracks.iter().find(|t| t.kind == mp4::Kind::Video) {
        Some(t) => video(t, movie.timescale, &file, planted, range, &mut out),
        None => {
            out.start(None);
            out.pipe.reply(&json!({"frames": 0}), None);
        }
    }
    Ok(())
}

/// Edits as the reply gives them: duration in the movie's ticks, media time in the track's, and
/// the rate as its 16.16 fixed-point word.
fn edits(edits: &[mp4::Edit]) -> Value {
    (edits.iter())
        .map(|e| json!({"duration": e.duration, "media_time": e.media_time, "rate": e.rate}))
        .collect()
}

/// A sound track's description and every sample it decodes to, interleaved f32le, untrimmed.
/// The planted reader rounds each edit's end up to a whole 1024-sample packet.
fn audio(
    t: &mp4::Track,
    movie: u32,
    file: &File,
    planted: &Planted,
) -> Result<(Value, Vec<u8>), String> {
    let mut packets = Vec::with_capacity(t.samples.len());
    for (i, s) in t.samples.iter().enumerate() {
        packets.push(read_at(file, s).map_err(|e| format!("sound packet {i}: {e}"))?);
    }
    // #503: by our own decoders, as a whole file's decode reads the track.
    let decoded = crate::audio::mp4_decode(t, packets)?;
    let (rate, channels, samples) = (decoded.rate.max(1), decoded.channels, decoded.samples);
    let mut shown = t.edits.clone();
    if planted.is("reader_pads_last_packet") {
        for e in shown.iter_mut().filter(|e| e.media_time >= 0) {
            let ticks = e.duration as u128 * t.timescale as u128 / movie.max(1) as u128;
            let end = (e.media_time as u128 + ticks).div_ceil(1024) * 1024;
            let padded = end - e.media_time as u128;
            e.duration = (padded * movie as u128 / t.timescale.max(1) as u128) as u64;
        }
    }
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    let a = json!({"codec": codec(&t.entry.fourcc), "sample_rate": rate, "channels": channels,
        "timescale": t.timescale, "edits": edits(&shown), "packets": t.samples.len(),
        "media_duration": t.duration, "decoded": samples.len() / channels as usize,
        "bytes": bytes.len()});
    Ok((a, bytes))
}

/// A sample's bytes, read where they lie.
fn read_at(file: &File, s: &mp4::Sample) -> std::io::Result<Vec<u8>> {
    use std::os::unix::fs::FileExt;
    let mut buf = vec![0u8; s.size as usize];
    file.read_exact_at(&mut buf, s.offset)?;
    Ok(buf)
}

/// The stream's replies: the head (sent with the sound before the first frame, once the
/// decoder's output says the range) and each frame.
struct Out<'p, R, W> {
    pipe: &'p mut Pipe<R, W>,
    head: Option<(Value, Vec<u8>)>,
    bgra: bool,
    /// The file's tagged (or assumed) matrix and range, for BGRA.
    matrix: String,
    range: String,
    /// The time spent handing the head and frames to the pipe: a slow reader's, not decoding.
    blocked: Duration,
}

impl<R: BufRead, W: Write> Out<'_, R, W> {
    /// Sends the head and the sound once, the video's `decoded_range` set; false once the
    /// parent has gone.
    fn start(&mut self, range: Option<&str>) -> bool {
        let Some((mut head, sound)) = self.head.take() else {
            return true;
        };
        if head["video"].is_object() {
            head["video"]["decoded_range"] = json!(range);
        }
        self.pipe.send(&json!({"stream": head}), &sound)
    }

    /// Frame k's bytes; false once the parent has gone.
    fn frame(&mut self, k: usize, bytes: &[u8], range: &str) -> bool {
        let handing = Instant::now();
        let sent = self.start(Some(range))
            && (self.pipe).send(&json!({"frame": k, "bytes": bytes.len()}), bytes);
        self.blocked += handing.elapsed();
        sent
    }

    /// Frame k didn't decode: the stream ends with why.
    fn fail(&mut self, k: usize, why: &str) {
        if self.start(None) {
            self.pipe.reply(&json!({"frame": k, "error": why}), None);
        }
    }
}

/// The video track's description in the head, then its frames (those in `range` when given) in
/// presentation order.
#[cfg(target_os = "macos")]
fn video<R: BufRead, W: Write>(
    t: &mp4::Track,
    movie: u32,
    file: &File,
    planted: &Planted,
    range: Option<(usize, usize)>,
    out: &mut Out<R, W>,
) {
    use crate::apple::{Decoder, Image};
    let shown = t.presented(movie, true);
    let (w, h) = (t.entry.width as usize, t.entry.height as usize);
    let alpha = &t.entry.fourcc == b"ap4h";
    let bytes = match (out.bgra, alpha) {
        (true, _) => w * h * 4,
        (false, true) => w * h * 2,
        (false, false) => w * h,
    };
    let color = track_color(t, planted);
    out.matrix = color["matrix"].as_str().unwrap_or("bt709").to_string();
    out.range = color["range"].as_str().unwrap_or("limited").to_string();
    let colr = t.entry.colr.map(|c| {
        json!({"type": String::from_utf8_lossy(&c.kind), "primaries": c.primaries,
            "transfer": c.transfer, "matrix": c.matrix, "full_range": c.full_range})
    });
    let sync: Vec<usize> = (shown.iter().enumerate())
        .filter(|(_, (s, _))| t.samples[*s].key)
        .map(|(k, _)| k)
        .collect();
    if let Some((head, _)) = out.head.as_mut() {
        head["video"] = json!({"codec": codec(&t.entry.fourcc), "size": [w, h],
            "timescale": t.timescale, "colr": colr, "color": color, "decoded_range": null,
            "edits": edits(&t.edits), "first_cts": t.samples.first().map(|s| s.cts),
            "frames": shown.len(), "sync": sync, "alpha": alpha, "bytes": bytes,
            "pts": shown.iter().map(|(_, p)| json!([p, t.timescale])).collect::<Vec<_>>()});
    }
    // Each wanted sample's place in presentation order; one no edit presents, or outside the
    // range, has none.
    let (from, to) = range.unwrap_or((0, usize::MAX));
    let to = to.min(shown.len());
    let from = from.min(to);
    let mut order = vec![None; t.samples.len()];
    for (k, (s, _)) in shown.iter().enumerate().take(to).skip(from) {
        order[*s] = Some(k);
    }
    // The samples fed: from the sync sample at or before the first wanted to the last wanted.
    let wanted = || (order.iter().enumerate()).filter_map(|(i, k)| k.map(|_| i));
    let feed = match (wanted().min(), wanted().max()) {
        (Some(lo), Some(hi)) => (0..=lo).rev().find(|i| t.samples[*i].key).unwrap_or(0)..hi + 1,
        _ => 0..0,
    };
    // The frame a failure at sample i names: its own, else the next to send.
    let frame_of = |i: usize, next: usize| order.get(i).copied().flatten().unwrap_or(next);
    let size = (w as u16, h as u16);
    let mut decoder = match Decoder::open(t.entry.fourcc, t.entry.config.as_ref(), size) {
        Ok(d) => d,
        Err(e) => return out.fail(from, &e),
    };
    let mut waiting: BTreeMap<usize, Image> = BTreeMap::new();
    let mut next = from;
    // Takes what the decoder gave and sends every frame now due; Err when the stream ends.
    let mut give =
        |got: Vec<crate::apple::Output>, next: &mut usize, out: &mut Out<R, W>| -> Result<(), ()> {
            for (i, picture) in got {
                let k = frame_of(i, *next);
                match picture {
                    Err(e) => {
                        out.fail(k, &e);
                        return Err(());
                    }
                    Ok(image) if order[i].is_some() => {
                        waiting.insert(k, image);
                    }
                    Ok(_) => {}
                }
            }
            while let Some(image) = waiting.remove(next) {
                match planes(&image, w, h, out) {
                    Ok((bytes, range)) if out.frame(*next, &bytes, range) => *next += 1,
                    Ok(_) => return Err(()),
                    Err(e) => {
                        out.fail(*next, &e);
                        return Err(());
                    }
                }
            }
            Ok(())
        };
    let started = Instant::now();
    // A sample that can't be read or decoded ends the stream, naming its frame, once the frames
    // before it are out.
    let mut cut = None;
    for i in feed {
        let sent = read_at(file, &t.samples[i])
            .map_err(|e| format!("sample {i} can't be read: {e}"))
            .and_then(|bytes| decoder.send(i, &bytes));
        if let Err(e) = sent {
            cut = Some((frame_of(i, next), e));
            break;
        }
        if give(decoder.take(), &mut next, out).is_err() {
            return;
        }
    }
    if give(decoder.finish(), &mut next, out).is_err() {
        return;
    }
    if let Some((k, e)) = cut {
        return out.fail(k, &e);
    }
    if next < to {
        return out.fail(next, "it didn't decode");
    }
    // From the first decode call to the last frame out, less the time handing frames over.
    let seconds = started.elapsed().saturating_sub(out.blocked).as_secs_f64();
    out.start(None);
    (out.pipe).reply(
        &json!({"frames": to - from, "decode_seconds": seconds}),
        None,
    );
}

#[cfg(not(target_os = "macos"))]
fn video<R: BufRead, W: Write>(
    _: &mp4::Track,
    _: u32,
    _: &File,
    _: &Planted,
    _: Option<(usize, usize)>,
    out: &mut Out<R, W>,
) {
    out.fail(0, "no video decoder on this platform");
}

/// A picture's bytes as the stream sends them, and the range its pixel format says.
#[cfg(target_os = "macos")]
fn planes<R, W>(
    image: &crate::apple::Image,
    w: usize,
    h: usize,
    out: &Out<R, W>,
) -> Result<(Vec<u8>, &'static str), String> {
    if image.size() != (w, h) {
        return Err(format!(
            "the decoder gave {:?}, not {w} × {h}",
            image.size()
        ));
    }
    let px = image.lock();
    match &image.format() {
        f @ (b"420v" | b"420f") => {
            let range = if f == b"420f" { "full" } else { "limited" };
            let mut planes = Vec::with_capacity(w * h * 3 / 2);
            for y in 0..h {
                planes.extend_from_slice(px.row(0, y, w));
            }
            if out.bgra {
                // I420 from the interleaved chroma, then through the file's tags.
                let (mut cb, mut cr) = (Vec::new(), Vec::new());
                for y in 0..h / 2 {
                    for c in px.row(1, y, w).as_chunks::<2>().0 {
                        cb.push(c[0]);
                        cr.push(c[1]);
                    }
                }
                planes.extend(cb);
                planes.extend(cr);
                let bgra = crate::color::i420_to_bgra(&planes, w, h, &out.matrix, &out.range);
                return Ok((bgra, range));
            }
            Ok((planes, range))
        }
        // ProRes 4444: A, Y', Cb, Cr, 16 bits each, little-endian; colour limited, alpha full.
        b"y416" => {
            let mut luma = Vec::with_capacity(w * h * if out.bgra { 4 } else { 2 });
            let mut alpha = Vec::with_capacity(w * h);
            for y in 0..h {
                for p in px.row(0, y, w * 8).as_chunks::<8>().0 {
                    let v = |i: usize| u16::from_le_bytes([p[2 * i], p[2 * i + 1]]);
                    match out.bgra {
                        true => luma.extend(crate::color::yuva16_to_bgra(
                            [v(1), v(2), v(3), v(0)],
                            &out.matrix,
                        )),
                        false => {
                            luma.push((v(1) >> 8) as u8);
                            alpha.push((v(0) >> 8) as u8);
                        }
                    }
                }
            }
            luma.extend(alpha);
            Ok((luma, "limited"))
        }
        other => Err(format!(
            "the decoder gave {}, which the stream doesn't read",
            String::from_utf8_lossy(other)
        )),
    }
}

/// A PNG sequence folder: each PNG, in name order, one straight BGRA frame.
fn pngs<R: BufRead, W: Write>(
    dir: &Path,
    bgra: bool,
    caps: &Caps,
    pipe: &mut Pipe<R, W>,
) -> Result<(), Value> {
    if !bgra {
        return Err(error("a PNG sequence streams as bgra"));
    }
    let mut files: Vec<_> = (std::fs::read_dir(dir).map_err(unreadable)?)
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "png"))
        .collect();
    files.sort();
    let total: u64 = files
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    if total > caps.max_bytes {
        let cap = json!({"cap": "max_bytes", "limit": caps.max_bytes});
        return Err(refused("over_cap", cap));
    }
    let mut size = None;
    for (k, path) in files.iter().enumerate() {
        let img = match image::open(path) {
            Ok(i) => i.into_rgba8(),
            Err(e) if k == 0 => return Err(unreadable(e)),
            Err(e) => {
                pipe.reply(&json!({"frame": k, "error": e.to_string()}), None);
                return Ok(());
            }
        };
        let (w, h) = img.dimensions();
        if size.is_none() {
            size = Some((w, h));
            let video = json!({"codec": "png", "size": [w, h], "frames": files.len(),
                "alpha": true, "bytes": w as usize * h as usize * 4});
            if !pipe.send(&json!({"stream": {"boxes": [], "video": video}}), &[]) {
                return Ok(());
            }
        }
        if size != Some((w, h)) {
            pipe.reply(
                &json!({"frame": k, "error": format!("{w} × {h}, not the first frame's size")}),
                None,
            );
            return Ok(());
        }
        let mut px = img.into_raw();
        px.as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|p| p.swap(0, 2));
        if !pipe.send(&json!({"frame": k, "bytes": px.len()}), &px) {
            return Ok(());
        }
    }
    if size.is_none() {
        pipe.send(&json!({"stream": {"boxes": [], "video": null}}), &[]);
    }
    pipe.reply(&json!({"frames": files.len()}), None);
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::color;
    use crate::pipe::tests::{piped, piped_job, streamed};
    use std::path::PathBuf;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("deep-codecs-stream-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn path(dir: &Path, name: &str) -> String {
        dir.join(name).to_str().unwrap().to_string()
    }

    /// A `w` × `h` BGRA frame k: a gradient whose blue follows k, and a block that walks with it.
    fn picture(w: usize, h: usize, k: usize) -> Vec<u8> {
        (0..w * h)
            .flat_map(|i| {
                let (x, y) = (i % w, i / w);
                let c = match x / 16 % 8 == k % 8 && y < h / 2 {
                    true => [40, 200, 90],
                    false => [
                        (x * 255 / w) as u8,
                        (y * 255 / h) as u8,
                        (k * 20 % 256) as u8,
                    ],
                };
                [c[2], c[1], c[0], 255]
            })
            .collect()
    }

    /// A delivery: `frames` (BGRA) through `codec` into one part at `rate`, a key frame at each
    /// of `keys`, joined with `audio` when given, the encode tool planted with `planted`. Its
    /// path and the join's reply.
    #[allow(clippy::too_many_arguments)]
    fn delivery(
        dir: &Path,
        name: &str,
        codec: &str,
        frames: &[Vec<u8>],
        (w, h): (usize, usize),
        rate: [u32; 2],
        keys: &[usize],
        audio: Option<Value>,
        planted: &str,
    ) -> (String, Value) {
        let part = path(dir, &format!("{name}-part"));
        let mut job = piped_job(codec, &part, 0, 0, frames.len() as u64);
        job["size"] = json!([w, h]);
        job["rate"] = json!(rate);
        let fed: Vec<(Vec<u8>, bool)> = (frames.iter().enumerate())
            .map(|(k, f)| match codec {
                "prores_4444" => (f.clone(), keys.contains(&k)),
                _ => (color::nv12(f, w, h), keys.contains(&k)),
            })
            .collect();
        let replies = piped(&job, &fed, true, planted);
        let last = &replies.last().unwrap().0;
        assert!(last["sha256"].is_string(), "{last}");
        let out = path(dir, name);
        let mut join = json!({"op": "export.join", "parts": [part], "out": out});
        if let Some(a) = audio {
            join["audio"] = a;
        }
        let job = join.as_object().unwrap();
        let reply = crate::run(job, &Caps::default(), &Planted::one(planted)).0;
        assert!(reply["sha256"].is_string(), "{reply}");
        (out, reply)
    }

    /// What a stream sent: its head, its sound, each frame's number and bytes, its last reply.
    struct Got {
        head: Value,
        sound: Vec<f32>,
        frames: Vec<(u64, Vec<u8>)>,
        last: Value,
    }

    fn read(path: &str, planes: &str, range: Option<[usize; 2]>, planted: &str) -> Got {
        let mut job = json!({"op": "stream", "path": path, "planes": planes});
        if let Some(r) = range {
            job["range"] = json!(r);
        }
        let mut replies = streamed(&job, planted).into_iter();
        let (head, sound) = replies.next().unwrap();
        assert!(head["stream"].is_object(), "{head}");
        let sound = sound.as_chunks::<4>().0.iter();
        let mut got = Got {
            head: head["stream"].clone(),
            sound: sound.map(|b| f32::from_le_bytes(*b)).collect(),
            frames: Vec::new(),
            last: Value::Null,
        };
        for (reply, bytes) in replies {
            match reply.get("bytes") {
                Some(_) => got.frames.push((reply["frame"].as_u64().unwrap(), bytes)),
                None => got.last = reply,
            }
        }
        got
    }

    fn psnr(a: &[u8], b: &[u8]) -> f64 {
        let se: f64 = (a.iter().zip(b))
            .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
            .sum();
        10.0 * (255.0f64.powi(2) * a.len() as f64 / se.max(1e-9)).log10()
    }

    /// The largest difference between two BGRA frames' colour, and their alpha's.
    fn worst(a: &[u8], b: &[u8]) -> (u8, u8) {
        let mut most = (0, 0);
        for (p, q) in a.as_chunks::<4>().0.iter().zip(b.as_chunks::<4>().0) {
            let d = |i: usize| p[i].abs_diff(q[i]);
            most = (most.0.max(d(0)).max(d(1)).max(d(2)), most.1.max(d(3)));
        }
        most
    }

    /// #157: a delivery streams back every frame, at exactly k × 1001/30000 s, its luma within
    /// the standard tier's 40 dB of the Y plane sent and its `moov` first; from sync frame 6 on
    /// the frames come alone and the same; a file cut short in frame 11 names it. The planted
    /// 600 timescale moves frame 1, and the planted writer leaves a frame out.
    #[test]
    fn a_delivery_streams_back_its_frames_at_their_times() {
        let dir = folder("frames");
        let (w, h) = (320, 180);
        let frames: Vec<Vec<u8>> = (0..12).map(|k| picture(w, h, k)).collect();
        let make = |name: &str, planted: &str| {
            let rate = [30000, 1001];
            delivery(
                &dir,
                name,
                "h264",
                &frames,
                (w, h),
                rate,
                &[0, 6],
                None,
                planted,
            )
            .0
        };
        let good = make("good.mp4", "none");
        let got = read(&good, "luma", None, "none");
        let v = &got.head["video"];
        let pts: Vec<Value> = (0..12).map(|k| json!([k * 1001, 30000])).collect();
        assert_eq!(v["pts"], json!(pts));
        assert_eq!((&v["frames"], &v["sync"]), (&json!(12), &json!([0, 6])));
        let starts = (&v["edits"], &v["first_cts"], &v["decoded_range"]);
        assert_eq!(starts, (&json!([]), &json!(0), &json!("limited")));
        let boxes = got.head["boxes"].as_array().unwrap().iter();
        let boxes: Vec<&Value> = boxes.map(|b| &b["type"]).collect();
        assert_eq!(boxes, ["ftyp", "moov", "mdat"]);
        let numbers: Vec<u64> = got.frames.iter().map(|f| f.0).collect();
        assert_eq!(numbers, (0..12).collect::<Vec<_>>());
        for (k, y) in &got.frames {
            let p = psnr(y, &color::nv12(&frames[*k as usize], w, h)[..w * h]);
            assert!(p >= 40.0, "frame {k}: {p:.1} dB");
        }
        assert_eq!(got.last["frames"], 12);
        let seconds = got.last["decode_seconds"].as_f64();
        assert!(seconds.is_some_and(|s| s > 0.0), "{}", got.last);
        let tail = read(&good, "luma", Some([6, 12]), "none");
        assert!(tail.frames == got.frames[6..], "frames 6 on differ alone");
        let bytes = std::fs::read(&good).unwrap();
        let last = mp4::parse(&bytes).unwrap().tracks[0].samples[11];
        let cut = path(&dir, "cut.mp4");
        std::fs::write(
            &cut,
            &bytes[..(last.offset + last.size as u64 / 2) as usize],
        )
        .unwrap();
        let short = read(&cut, "luma", None, "none");
        assert_eq!((short.frames.len(), &short.last["frame"]), (11, &json!(11)));
        assert!(short.last["error"].is_string(), "{}", short.last);
        let moved = read(
            &make("600.mp4", "muxer_timescale_600"),
            "luma",
            None,
            "none",
        );
        assert_ne!(moved.head["video"]["pts"][1], json!([1001, 30000]));
        let dropped = read(
            &make("drop.mp4", "video_writer_drops_frame"),
            "luma",
            None,
            "none",
        );
        assert_eq!(dropped.head["video"]["frames"], 11);
        let last = read(
            &make("last.mp4", "muxer_writes_moov_last"),
            "luma",
            None,
            "none",
        );
        let boxes = last.head["boxes"].as_array().unwrap().iter();
        let boxes: Vec<&Value> = boxes.map(|b| &b["type"]).collect();
        assert_eq!(boxes, ["ftyp", "mdat", "moov"]);
        assert_eq!(last.frames.len(), 12);
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Interleaved stereo f32 of `n` frames: two independent low-passed noises.
    fn noise(n: usize) -> Vec<f32> {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut lp = [0f32; 2];
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed >> 40) as f32 / (1u64 << 24) as f32 - 0.5
        };
        (0..n)
            .flat_map(|_| {
                for c in &mut lp {
                    *c += 0.2 * (next() - *c);
                }
                [lp[0] * 2.0, lp[1] * 2.0]
            })
            .collect()
    }

    /// The lag (got[i + lag] against sent[i]) at which channel `c` of `got` best matches channel
    /// `s` of `sent`, within ±2,500 samples, and that match's correlation.
    fn lag(sent: &[f32], got: &[f32], s: usize, c: usize) -> (i64, f32) {
        let (from, n) = (20_000i64, 8192i64);
        let at = |v: &[f32], i: i64, ch: usize| v.get(i as usize * 2 + ch).copied().unwrap_or(0.0);
        let energy = |v: &[f32], off: i64, ch: usize| {
            (0..n)
                .map(|i| at(v, from + off + i, ch).powi(2))
                .sum::<f32>()
                .sqrt()
        };
        (-2500..=2500)
            .map(|l| {
                let dot: f32 = (0..n)
                    .map(|i| at(sent, from + i, s) * at(got, from + i + l, c))
                    .sum();
                (l, dot / (energy(sent, 0, s) * energy(got, l, c)).max(1e-9))
            })
            .fold((0, f32::MIN), |b, x| if x.1 > b.1 { x } else { b })
    }

    /// A stream's sound with its edit list applied as a player applies it.
    fn presented(got: &Got) -> Vec<f32> {
        let a = &got.head["audio"];
        let Some(e) = a["edits"].as_array().and_then(|e| e.first()) else {
            return got.sound.clone();
        };
        let n = |v: &Value| v.as_u64().unwrap() as usize;
        let skip = n(&e["media_time"]) * 2;
        let take = n(&e["duration"]) * n(&a["timescale"]) / n(&got.head["movie"]["timescale"]);
        let end = (skip + take * 2).min(got.sound.len());
        got.sound[skip.min(end)..end].to_vec()
    }

    /// #157: AAC through the stream with its edit list applied is the PCM, all N samples of it
    /// at lag 0, at 48 kHz and at 44.1 kHz (1,030,029 samples: 700 frames at 30000/1001); the
    /// planted muxers' sound starts 2,112 or 1,088 samples late, runs N + its padding, or has
    /// its channels crossed, and the planted reader's runs on to a whole packet.
    #[test]
    fn aac_through_the_stream_and_its_edit_is_the_pcm_at_lag_0() {
        let dir = folder("aac");
        let frames: Vec<Vec<u8>> = (0..4).map(|k| picture(64, 64, k)).collect();
        let sound = |rate: u32, n: usize, planted: &str, reader: &str| {
            let pcm = noise(n);
            let file = path(&dir, &format!("{rate}-{planted}.f32"));
            let bytes: Vec<u8> = pcm.iter().flat_map(|v| v.to_le_bytes()).collect();
            std::fs::write(&file, bytes).unwrap();
            let audio = json!({"path": file, "sample_rate": rate, "channels": 2, "codec": "aac"});
            let name = format!("{rate}-{planted}.mp4");
            let (out, joined) = delivery(
                &dir,
                &name,
                "h264",
                &frames,
                (64, 64),
                [30000, 1001],
                &[0],
                Some(audio),
                planted,
            );
            let got = presented(&read(&out, "luma", None, reader));
            let (at, own) = lag(&pcm, &got, 0, 0);
            let crossed = lag(&pcm, &got, 0, 1).1;
            (got.len() / 2, at, own > crossed, joined["audio"].clone())
        };
        let (n, at, own, summary) = sound(48_000, 48_000, "none", "none");
        assert_eq!((n, at, own), (48_000, 0, true));
        let packets = summary["packets"].as_u64().unwrap();
        let padding = packets * 1024 - 2112 - 48_000;
        let expected = json!({"priming": 2112, "packets": packets, "padding": padding});
        assert_eq!(summary, expected);
        let (n, at, own, _) = sound(44_100, 1_030_029, "none", "none");
        assert_eq!((n, at, own), (1_030_029, 0, true));
        assert_eq!(
            sound(48_000, 48_000, "muxer_strips_audio_edit_list", "none").1,
            2112
        );
        assert_eq!(
            sound(48_000, 48_000, "muxer_edit_list_1024", "none").1,
            1088
        );
        let padded = sound(48_000, 48_000, "muxer_keeps_end_padding", "none").0;
        assert_eq!(padded as u64, 48_000 + padding);
        assert!(!sound(48_000, 48_000, "muxer_swaps_channels", "none").2);
        let whole = sound(48_000, 48_000, "none", "reader_pads_last_packet").0;
        assert_eq!(whole, (48_000 + 2112usize).div_ceil(1024) * 1024 - 2112);
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// #157: ProRes 4444 reads back black as Y 16 with alpha 0 and white as Y 235 with alpha 255,
    /// and a colour ramp at half alpha within 2 code values, straight, through the stream and the
    /// decode op alike; its probe names its alpha full range and its colour limited. The planted
    /// encoders fed full-range or premultiplied colour don't.
    #[test]
    fn prores_4444_reads_back_limited_colour_and_full_alpha() {
        let dir = folder("prores");
        let (w, h) = (64usize, 64usize);
        let ramp: Vec<u8> = (0..w * h)
            .flat_map(|i| {
                let c = (i % w * 4) as u8;
                [c, c / 2, 255 - c, 128]
            })
            .collect();
        let frames = vec![
            [0u8; 4].repeat(w * h),
            [255u8; 4].repeat(w * h),
            ramp.clone(),
        ];
        let make = |planted: &str| {
            let name = format!("{planted}.mov");
            delivery(
                &dir,
                &name,
                "prores_4444",
                &frames,
                (w, h),
                [24, 1],
                &[],
                None,
                planted,
            )
            .0
        };
        let good = make("none");
        let luma = read(&good, "luma", None, "none");
        assert_eq!(luma.head["video"]["alpha"], true);
        let planes = |k: usize| luma.frames[k].1.split_at(w * h);
        assert!(planes(0).0.iter().all(|y| *y == 16) && planes(0).1.iter().all(|a| *a == 0));
        assert!(planes(1).0.iter().all(|y| *y == 235) && planes(1).1.iter().all(|a| *a == 255));
        let ramp_back = |file: &str| read(file, "bgra", None, "none").frames[2].1.clone();
        let (colour, alpha) = worst(&ramp_back(&good), &ramp);
        assert!(colour <= 2 && alpha == 0, "{colour} {alpha}");
        let out = path(&dir, "decoded");
        let job = json!({"op": "decode", "path": good, "out": out, "format": "bgra"});
        crate::run(
            job.as_object().unwrap(),
            &Caps::default(),
            &Planted::default(),
        );
        let decoded = std::fs::read(Path::new(&out).join("0-2.bgra")).unwrap();
        let (colour, alpha) = worst(&decoded, &ramp);
        assert!(colour <= 2 && alpha <= 1, "decode op: {colour} {alpha}");
        let job = json!({"op": "probe", "path": good});
        let probed = crate::run(
            job.as_object().unwrap(),
            &Caps::default(),
            &Planted::default(),
        );
        let video = &probed.0["asset"]["probe"]["streams"][0];
        let alpha = json!({"range": "full"});
        assert_eq!(
            (&video["color"]["range"], &video["alpha"]),
            (&json!("limited"), &alpha)
        );
        for planted in ["prores_fed_full_range", "prores_premultiplies_straight"] {
            let (colour, _) = worst(&ramp_back(&make(planted)), &ramp);
            assert!(colour > 2, "{planted}: {colour}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// The largest difference, over every channel, between the means of two BGRA frames' 16 × 16
    /// blocks: the probe's patches, each flat.
    fn worst_block(a: &[u8], b: &[u8], w: usize, h: usize) -> f64 {
        let mut most = 0f64;
        for (by, bx, c) in
            (0..h / 16).flat_map(|y| (0..w / 16).flat_map(move |x| (0..4).map(move |c| (y, x, c))))
        {
            let mut d = 0i64;
            for y in by * 16..by * 16 + 16 {
                for x in bx * 16..bx * 16 + 16 {
                    let at = (y * w + x) * 4 + c;
                    d += a[at] as i64 - b[at] as i64;
                }
            }
            most = most.max(d.abs() as f64 / 256.0);
        }
        most
    }

    /// #157: the colour probe at 1080p, through a one-frame master part of each codec and the
    /// stream as BGRA, reads back with every 16 × 16 patch within 2 code values on average, and
    /// ProRes 4444's every pixel within 2 (its time is AC14's budget, judged with the load); the planted encoders that
    /// stretch NV12 to full range, or tag it BT.601 full range, don't. (At standard, H.264's and
    /// HEVC's patches are off by up to 3 and 4: a chroma step is 2 code values of blue.)
    #[test]
    fn the_colour_probe_reads_back_within_2_through_each_codec() {
        let dir = folder("probe");
        let (w, h) = (1920usize, 1080usize);
        for (codec, planted, within) in [
            ("h264", "none", true),
            ("hevc", "none", true),
            ("prores_4444", "none", true),
            ("h264", "h264_full_range_under_limited_tags", false),
            ("h264", "encode_full_range_bt601", false),
        ] {
            let started = Instant::now();
            let probe = color::probe([w as u32, h as u32], codec == "prores_4444");
            let frame = match codec {
                "prores_4444" => probe.clone(),
                _ => color::nv12(&probe, w, h),
            };
            let part = path(&dir, &format!("{codec}-{planted}"));
            let mut job = piped_job(codec, &part, 0, 0, 1);
            job["size"] = json!([w, h]);
            job["quality"] = json!("master");
            piped(&job, &[(frame, true)], true, planted);
            let got = read(&part, "bgra", None, "none");
            let took = started.elapsed();
            let back = &got.frames[0].1;
            let off = worst_block(back, &probe, w, h);
            println!("{codec} {planted}: patches off by {off:.2} in {took:?}");
            assert_eq!(
                off <= 2.0,
                within,
                "{codec} {planted}: patches off by {off:.2}"
            );
            if codec == "prores_4444" {
                let (colour, alpha) = worst(back, &probe);
                assert!(colour <= 2 && alpha <= 2, "{colour} {alpha}");
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
