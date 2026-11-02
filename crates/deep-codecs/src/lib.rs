//! Issue #498: the decode worker and the encode tool (canvas primitives: Decode worker; Export:
//! encode job). The decode worker is the trusted ring's host for the codecs seam: every probe,
//! decode and proxy runs in it, a process of its own that enters a sandbox with no network and no
//! devices before it reads a byte, holds files to its caps, and refuses a file that points
//! anywhere else without opening it. It never encodes: an export's frames go to the encode tool,
//! another process, which runs the platform's encoder and names itself in the export's record.
//!
//! Probes keep every presentation time as a rational in the stream's own ticks, never rounded to
//! flicks, and name each color field they assumed (`color`).

#[cfg(target_os = "macos")]
mod apple;
pub mod color;
pub mod mp4;
mod wav;

use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// One second in flicks.
const FLICKS: i64 = 705_600_000;

/// The worker's caps (the Decode worker's `caps`); a file over any one is refused, naming it.
#[derive(Clone, Copy)]
pub struct Caps {
    pub max_bytes: u64,
    pub max_duration: u64,
    pub max_pixels: u64,
}

impl Default for Caps {
    /// 4 GiB, three hours and an 8K frame.
    fn default() -> Self {
        Caps {
            max_bytes: 4 << 30,
            max_duration: 3 * 3600,
            max_pixels: 7680 * 4320,
        }
    }
}

impl Caps {
    pub fn json(&self) -> Value {
        json!({"max_bytes": self.max_bytes, "max_duration": self.max_duration, "max_pixels": self.max_pixels})
    }

    fn from_json(v: &Value) -> Caps {
        let d = Caps::default();
        let n = |k: &str, or: u64| v.get(k).and_then(Value::as_u64).unwrap_or(or);
        Caps {
            max_bytes: n("max_bytes", d.max_bytes),
            max_duration: n("max_duration", d.max_duration),
            max_pixels: n("max_pixels", d.max_pixels),
        }
    }
}

/// The wrong programs a worker can be started as, only to prove a test fails on one.
#[derive(Clone, Default)]
pub struct Planted(BTreeSet<String>);

impl Planted {
    pub fn one(name: &str) -> Planted {
        Planted(BTreeSet::from([name.to_string()]))
    }
    fn is(&self, name: &str) -> bool {
        self.0.contains(name)
    }
}

fn refused(code: &str, extra: Value) -> Value {
    let mut r = json!({"code": code});
    if let (Value::Object(r), Value::Object(e)) = (&mut r, extra) {
        r.extend(e);
    }
    json!({"refused": r})
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn reduce(n: i64, d: i64) -> [i64; 2] {
    fn gcd(a: i64, b: i64) -> i64 {
        if b == 0 {
            a.abs()
        } else {
            gcd(b, a % b)
        }
    }
    let g = gcd(n, d).max(1);
    [n / g, d / g]
}

/// What a file is, by its first bytes.
enum Format<'a> {
    Wav(wav::Wav),
    Png(u32, u32, bool),
    Playlist(&'a str),
    Movie(mp4::Movie),
}

fn format(data: &[u8]) -> Result<Format<'_>, Value> {
    if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WAVE") {
        return wav::parse(data).map(Format::Wav).ok_or_else(|| {
            refused(
                "unreadable",
                json!({"why": "a WAVE file without fmt and data"}),
            )
        });
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") && data.len() >= 24 {
        let srgb = data.windows(4).take(4096).any(|w| w == b"sRGB");
        return Ok(Format::Png(
            mp4::be32(&data[16..]),
            mp4::be32(&data[20..]),
            srgb,
        ));
    }
    if let Ok(text) = std::str::from_utf8(data) {
        if text.trim_start().starts_with("#EXTM3U") {
            return Ok(Format::Playlist(text));
        }
    }
    mp4::parse(data).map(Format::Movie).ok_or_else(|| {
        refused(
            "unreadable",
            json!({"why": "not a format the worker reads"}),
        )
    })
}

/// The planted worker that follows what a file points at: one request to it.
fn follow(url: &str) {
    let Some(rest) = url.strip_prefix("http://") else {
        return;
    };
    let host = rest.split('/').next().unwrap_or_default();
    if let Ok(mut s) = std::net::TcpStream::connect(host) {
        let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(2)));
        let _ = write!(
            s,
            "GET /{} HTTP/1.0\r\nHost: {host}\r\n\r\n",
            rest.split_once('/').map_or("", |r| r.1)
        );
        let _ = s.read_to_end(&mut Vec::new());
    }
}

/// A file read and held to the caps: its bytes, its hash and what it is, or a refusal.
struct Opened {
    data: Vec<u8>,
    sha: String,
}

fn open(path: &str, caps: &Caps, planted: &Planted) -> Result<Opened, (Value, Option<String>)> {
    let len = std::fs::metadata(path)
        .map_err(|e| (refused("unreadable", json!({"why": e.to_string()})), None))?
        .len();
    if len > caps.max_bytes && !planted.is("skips_caps") {
        return Err((
            refused(
                "over_cap",
                json!({"cap": "max_bytes", "limit": caps.max_bytes}),
            ),
            None,
        ));
    }
    let data = std::fs::read(path)
        .map_err(|e| (refused("unreadable", json!({"why": e.to_string()})), None))?;
    let sha = sha256(&data);
    Ok(Opened { data, sha })
}

/// The first place a file points at, if any: a playlist's first entry or a movie's external data
/// reference. A file that points anywhere is refused without opening it.
fn points_at(f: &Format) -> Option<String> {
    match f {
        Format::Playlist(text) => Some(
            text.lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with('#'))
                .unwrap_or("(an entry the playlist names)")
                .to_string(),
        ),
        Format::Movie(m) => m.urls.first().cloned(),
        _ => None,
    }
}

/// A movie track's duration in whole and partial seconds, as (ticks, timescale).
fn seconds_over(ticks: i64, timescale: u32, cap: u64) -> bool {
    ticks as i128 > cap as i128 * timescale as i128
}

/// Each cap the file is over, as a refusal: duration, then pixels.
fn over_caps(f: &Format, caps: &Caps) -> Option<Value> {
    let (duration_over, pixels) = match f {
        Format::Wav(w) => (
            seconds_over(w.frames as i64, w.rate, caps.max_duration),
            0u64,
        ),
        Format::Png(w, h, _) => (false, *w as u64 * *h as u64),
        Format::Movie(m) => (
            m.tracks
                .iter()
                .any(|t| seconds_over(t.span(m.timescale), t.timescale, caps.max_duration)),
            m.tracks
                .iter()
                .filter(|t| t.kind == mp4::Kind::Video)
                .map(|t| t.entry.width as u64 * t.entry.height as u64)
                .max()
                .unwrap_or(0),
        ),
        Format::Playlist(_) => (false, 0),
    };
    if duration_over {
        return Some(refused(
            "over_cap",
            json!({"cap": "max_duration", "limit": caps.max_duration}),
        ));
    }
    (pixels > caps.max_pixels).then(|| {
        refused(
            "over_cap",
            json!({"cap": "max_pixels", "limit": caps.max_pixels}),
        )
    })
}

fn codec(fourcc: &[u8; 4]) -> String {
    match fourcc {
        b"avc1" | b"avc3" => "h264".into(),
        b"hvc1" | b"hev1" => "hevc".into(),
        b"mp4v" => "mpeg4".into(),
        b"mp4a" => "aac".into(),
        other => String::from_utf8_lossy(other).trim().to_string(),
    }
}

/// A video track's color: its `colr` box, else its SPS, each field it leaves out assumed.
fn track_color(t: &mp4::Track, planted: &Planted) -> Value {
    let mut tags = (None, None, None);
    let mut range = None;
    if let Some(c) = t.entry.colr {
        let some = |v: u16| (v != 2).then_some(v);
        tags = (some(c.primaries), some(c.transfer), some(c.matrix));
        range = c.full_range;
    }
    if let Some((b"avcC", avcc)) = t.entry.config.as_ref().map(|(k, v)| (k, v)) {
        if let Some(s) = color::avc_sps(avcc).and_then(color::h264_signal) {
            if let Some((p, tr, m)) = s.description {
                let some = |v: u8| (v != 2).then_some(v as u16);
                tags = (tags.0.or(some(p)), tags.1.or(some(tr)), tags.2.or(some(m)));
            }
            range = range.or(s.full_range);
        }
    }
    color::describe(
        tags,
        range,
        t.entry.height as u32,
        planted.is("assumes_bt601"),
    )
}

/// A presentation time in ticks of `timescale` as the probe writes it: `[ticks, timescale]`, or
/// the planted probe's nearest flick.
fn time(ticks: i64, timescale: u32, planted: &Planted) -> Value {
    if planted.is("probe_rounds_to_flicks") {
        let f = (ticks as i128 * FLICKS as i128 * 2 + timescale as i128) / (2 * timescale as i128);
        return json!([f as i64, FLICKS]);
    }
    json!([ticks, timescale])
}

fn probe(f: &Format, sha: &str, planted: &Planted) -> Value {
    let (kind, streams, decoder) = match f {
        Format::Wav(w) => (
            "audio",
            vec![
                json!({"index": 0, "type": "audio", "codec": w.codec(), "time_base": [1, w.rate],
                "sample_rate": w.rate, "channels": w.channels, "duration": [w.frames, w.rate]}),
            ],
            json!({"name": "deep-codecs wav", "version": env!("CARGO_PKG_VERSION")}),
        ),
        Format::Png(w, h, srgb) => {
            let mut c = json!({"primaries": "bt709", "transfer": "srgb", "matrix": "rgb", "range": "full",
                "assumed": ["primaries", "transfer"]});
            if *srgb {
                c["assumed"] = json!([]);
            }
            (
                "image",
                vec![
                    json!({"index": 0, "type": "image", "codec": "png", "time_base": [1, 1],
                    "size": [w, h], "color": c}),
                ],
                json!({"name": "image png", "version": "0.25"}),
            )
        }
        Format::Movie(m) => {
            let edits = !planted.is("ignores_edit_lists");
            let streams = (m.tracks.iter().enumerate())
                .filter(|(_, t)| t.kind != mp4::Kind::Other)
                .map(|(i, t)| {
                    let mut s = json!({"index": i, "codec": codec(&t.entry.fourcc),
                        "time_base": [1, t.timescale], "duration": [t.span(m.timescale), t.timescale]});
                    if t.kind == mp4::Kind::Audio {
                        s["type"] = json!("audio");
                        s["sample_rate"] = json!(t.entry.sample_rate);
                        s["channels"] = json!(t.entry.channels);
                        return s;
                    }
                    let shown = t.presented(m.timescale, edits);
                    let steps: BTreeSet<i64> = shown.windows(2).map(|w| w[1].1 - w[0].1).collect();
                    let rate = match steps.len() {
                        0 => json!(null),
                        1 => json!(reduce(t.timescale as i64, *steps.first().unwrap_or(&1))),
                        _ => json!("variable"),
                    };
                    s["type"] = json!("video");
                    s["frame_rate"] = rate;
                    s["size"] = json!([t.entry.width, t.entry.height]);
                    s["color"] = track_color(t, planted);
                    s["pts"] = shown.iter().map(|(_, p)| time(*p, t.timescale, planted)).collect();
                    s
                })
                .collect::<Vec<_>>();
            let kind = if m.tracks.iter().any(|t| t.kind == mp4::Kind::Video) {
                "video"
            } else {
                "audio"
            };
            (kind, streams, platform_decoder())
        }
        Format::Playlist(_) => ("video", vec![], platform_decoder()),
    };
    json!({"asset": {"sha256": sha, "kind": kind, "probe": {"streams": streams}, "decoder": decoder}})
}

fn platform_decoder() -> Value {
    #[cfg(target_os = "macos")]
    return json!({"name": "VideoToolbox and AudioToolbox", "version": apple::os_version()});
    #[cfg(not(target_os = "macos"))]
    json!({"name": "none", "version": "0"})
}

/// One job's options, from its JSON.
struct Job<'a> {
    v: &'a Map<String, Value>,
}

impl Job<'_> {
    fn s(&self, k: &str) -> Option<&str> {
        self.v.get(k).and_then(Value::as_str)
    }
}

/// The video samples of `t` a decode needs for the first `want` presented frames: each frame's
/// sample and time, and the samples to feed, from a sync sample two before the first needed.
fn video_plan(
    t: &mp4::Track,
    timescale: u32,
    edits: bool,
    want: Option<usize>,
) -> (Vec<(usize, i64)>, Vec<usize>) {
    let shown = t.presented(timescale, edits);
    let chosen: Vec<(usize, i64)> = shown.into_iter().take(want.unwrap_or(usize::MAX)).collect();
    let (Some(lo), Some(hi)) = (
        chosen.iter().map(|c| c.0).min(),
        chosen.iter().map(|c| c.0).max(),
    ) else {
        return (chosen, Vec::new());
    };
    let syncs: Vec<usize> = (0..=lo).filter(|i| t.samples[*i].key).collect();
    let start = match syncs.len() {
        0 => 0,
        1 => syncs[0],
        n => syncs[n - 2],
    };
    (chosen, (start..=hi).collect())
}

/// Decodes `f` into `out`: video frames as I420 planes or BGRA, audio as f32, images as their
/// own pixels.
fn decode(
    f: &Format,
    data: &[u8],
    job: &Job,
    planted: &Planted,
    probe_v: &Value,
) -> Result<Value, String> {
    let out = PathBuf::from(job.s("out").ok_or("a decode names its out folder")?);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let bgra = job.s("format") == Some("bgra");
    let want = job
        .v
        .get("video_frames")
        .and_then(Value::as_u64)
        .map(|n| n as usize);
    let write =
        |name: &str, bytes: &[u8]| std::fs::write(out.join(name), bytes).map_err(|e| e.to_string());
    let mut streams = Vec::new();
    match f {
        Format::Wav(w) => {
            let samples = w.f32(data);
            write("0.f32", &f32_bytes(&samples))?;
            streams.push(
                json!({"index": 0, "type": "audio", "sample_rate": w.rate, "channels": w.channels,
                "first": [0, w.rate], "samples": w.frames, "file": "0.f32"}),
            );
        }
        Format::Png(..) => {
            let img = image::load_from_memory(data)
                .map_err(|e| e.to_string())?
                .to_rgba8();
            let (w, h) = img.dimensions();
            let mut px = img.into_raw();
            if bgra {
                px.as_chunks_mut::<4>()
                    .0
                    .iter_mut()
                    .for_each(|p| p.swap(0, 2));
            }
            let frames = if want == Some(0) {
                vec![]
            } else {
                write("0-0.raw", &px)?;
                vec![json!({"pts": [0, 1], "file": "0-0.raw"})]
            };
            streams.push(json!({"index": 0, "type": "image", "size": [w, h], "frames": frames}));
        }
        Format::Movie(m) => {
            let edits = !planted.is("ignores_edit_lists");
            for (i, t) in m.tracks.iter().enumerate() {
                match t.kind {
                    mp4::Kind::Video => {
                        let color = &probe_v["asset"]["probe"]["streams"]
                            .as_array()
                            .and_then(|s| s.iter().find(|s| s["index"] == i))
                            .map(|s| s["color"].clone())
                            .unwrap_or_default();
                        let (chosen, feed) = video_plan(t, m.timescale, edits, want);
                        let mut frames = Vec::new();
                        let mut size = [t.entry.width as usize, t.entry.height as usize];
                        if !chosen.is_empty() {
                            let pictures = video_frames(t, data, &feed)?;
                            for (k, (sample, pts)) in chosen.iter().enumerate() {
                                let p = pictures
                                    .iter()
                                    .find(|p| p.sample == *sample)
                                    .ok_or_else(|| format!("sample {sample} didn't decode"))?;
                                size = [p.width, p.height];
                                let name = format!("{i}-{k}.{}", if bgra { "bgra" } else { "yuv" });
                                let bytes = match bgra {
                                    true => color::i420_to_bgra(
                                        &p.planes,
                                        p.width,
                                        p.height,
                                        color["matrix"].as_str().unwrap_or("bt709"),
                                        color["range"].as_str().unwrap_or("limited"),
                                    ),
                                    false => p.planes.clone(),
                                };
                                write(&name, &bytes)?;
                                frames.push(
                                    json!({"pts": time(*pts, t.timescale, planted), "file": name}),
                                );
                            }
                        }
                        streams.push(
                            json!({"index": i, "type": "video", "size": size, "frames": frames}),
                        );
                    }
                    mp4::Kind::Audio => {
                        let (samples, first, rate, channels) =
                            audio(t, m.timescale, data, planted)?;
                        let name = format!("{i}.f32");
                        write(&name, &f32_bytes(&samples))?;
                        streams.push(json!({"index": i, "type": "audio", "sample_rate": rate,
                            "channels": channels, "first": first,
                            "samples": samples.len() / channels.max(1) as usize, "file": name}));
                    }
                    mp4::Kind::Other => {}
                }
            }
        }
        Format::Playlist(_) => {}
    }
    Ok(json!({"streams": streams}))
}

fn f32_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

#[cfg(target_os = "macos")]
fn video_frames(
    t: &mp4::Track,
    data: &[u8],
    feed: &[usize],
) -> Result<Vec<apple::Picture>, String> {
    let config = t
        .entry
        .config
        .as_ref()
        .ok_or("a video track without its codec configuration")?;
    let samples: Vec<(usize, Vec<u8>)> = feed
        .iter()
        .map(|i| {
            let s = &t.samples[*i];
            let range = s.offset as usize..s.offset as usize + s.size as usize;
            (*i, data.get(range).unwrap_or_default().to_vec())
        })
        .collect();
    apple::decode_video(
        t.entry.fourcc,
        config,
        (t.entry.width, t.entry.height),
        &samples,
    )
}

#[cfg(not(target_os = "macos"))]
fn video_frames(_: &mp4::Track, _: &[u8], _: &[usize]) -> Result<Vec<Picture>, String> {
    Err("no video decoder on this platform".into())
}

#[cfg(not(target_os = "macos"))]
struct Picture {
    sample: usize,
    width: usize,
    height: usize,
    planes: Vec<u8>,
}

/// A track's audio, decoded and trimmed by its edit list: the samples, the first kept sample's
/// presentation time, the rate and the channel count. The encoder's priming lies before the
/// edit's media time, so trimming to the edit removes it, as FATE's references do.
fn audio(
    t: &mp4::Track,
    timescale: u32,
    data: &[u8],
    planted: &Planted,
) -> Result<(Vec<f32>, Value, u32, u32), String> {
    let (rate, channels) = (t.entry.sample_rate.max(1), t.entry.channels.max(1) as u32);
    let packets: Vec<Vec<u8>> = (t.samples.iter())
        .map(|s| {
            data.get(s.offset as usize..(s.offset + s.size as u64) as usize)
                .unwrap_or_default()
                .to_vec()
        })
        .collect();
    let mut samples = match &t.entry.config {
        #[cfg(target_os = "macos")]
        Some((k, esds)) if k == b"esds" => apple::decode_aac(esds, rate, channels, &packets)?,
        _ => return Err(format!("no decoder for {}", codec(&t.entry.fourcc))),
    };
    let first_cts = t.samples.first().map_or(0, |s| s.cts);
    let (media, at) = t.first_edit(timescale);
    // Ticks of the track's timescale in samples at the stream's rate.
    let to_samples = |ticks: i64| ticks * rate as i64 / t.timescale.max(1) as i64;
    if planted.is("keeps_priming") || t.edits.is_empty() {
        let first = first_cts - if t.edits.is_empty() { 0 } else { media - at };
        return Ok((samples, json!([to_samples(first), rate]), rate, channels));
    }
    let skip = to_samples((media - first_cts).max(0)) as usize * channels as usize;
    samples.drain(..skip.min(samples.len()));
    let span = to_samples(t.span(timescale)) as usize * channels as usize;
    samples.truncate(span);
    let first = at + (first_cts - media).max(0);
    Ok((samples, json!([to_samples(first), rate]), rate, channels))
}

/// A proxy: every frame decoded, scaled by `scale`, kept as raw I420 frames after a one-line
/// header. Every frame of it is whole, so it seeks as a GOP of 1 does; nothing is encoded.
fn proxy(f: &Format, data: &[u8], job: &Job) -> Result<Value, String> {
    let Format::Movie(m) = f else {
        return Err("a proxy is of a video".into());
    };
    let t = m
        .tracks
        .iter()
        .find(|t| t.kind == mp4::Kind::Video)
        .ok_or("no video track")?;
    let scale = job
        .v
        .get("scale")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.01, 1.0);
    let gop = job.v.get("gop").and_then(Value::as_u64).unwrap_or(1);
    let (chosen, feed) = video_plan(t, m.timescale, true, None);
    let pictures = video_frames(t, data, &feed)?;
    let mut body = Vec::new();
    let mut size = [0usize; 2];
    for (sample, _) in &chosen {
        let Some(p) = pictures.iter().find(|p| p.sample == *sample) else {
            continue;
        };
        let (w, h) = (
            ((p.width as f64 * scale) as usize).max(2) & !1,
            ((p.height as f64 * scale) as usize).max(2) & !1,
        );
        size = [w, h];
        let planes = [
            (p.width, p.height, w, h),
            (p.width.div_ceil(2), p.height.div_ceil(2), w / 2, h / 2),
        ];
        let mut at = 0;
        for (sw, sh, dw, dh) in [planes[0], planes[1], planes[1]] {
            for y in 0..dh {
                for x in 0..dw {
                    body.push(p.planes[at + (y * sh / dh) * sw + x * sw / dw]);
                }
            }
            at += sw * sh;
        }
    }
    let head = json!({"proxy": 1, "gop": gop, "scale": scale, "size": size,
        "pts": chosen.iter().map(|c| [c.1, t.timescale as i64]).collect::<Vec<_>>()});
    let mut bytes = format!("{head}\n").into_bytes();
    bytes.extend_from_slice(&body);
    let path = job.s("out").ok_or("a proxy names its out file")?;
    std::fs::write(path, &bytes).map_err(|e| e.to_string())?;
    Ok(json!({"proxy": {"path": path, "sha256": sha256(&bytes), "gop": gop, "scale": scale}}))
}

/// The encode job: I420 frames (one file each) through the platform's H.264 encoder into an MP4.
fn encode(job: &Job) -> Result<Value, String> {
    let frames: Vec<Vec<u8>> = (job
        .v
        .get("frames")
        .and_then(Value::as_array)
        .ok_or("an encode names its frames")?)
    .iter()
    .map(|p| std::fs::read(p.as_str().unwrap_or_default()).map_err(|e| e.to_string()))
    .collect::<Result<_, _>>()?;
    let pts: Vec<i64> = (job
        .v
        .get("pts")
        .and_then(Value::as_array)
        .ok_or("an encode names its times")?)
    .iter()
    .filter_map(Value::as_i64)
    .collect();
    let timescale = job
        .v
        .get("timescale")
        .and_then(Value::as_u64)
        .ok_or("an encode names its timescale")? as u32;
    let size = job
        .v
        .get("size")
        .and_then(Value::as_array)
        .ok_or("an encode names its size")?;
    let (w, h) = (
        size[0].as_u64().unwrap_or(0) as usize,
        size[1].as_u64().unwrap_or(0) as usize,
    );
    let out = job.s("out").ok_or("an encode names its out file")?;
    #[cfg(target_os = "macos")]
    {
        let (coded, avcc, hardware) = apple::encode_h264(&frames, w, h, &pts, timescale as i32)?;
        let bytes = mux_h264(&coded, &avcc, w, h, &pts, timescale);
        std::fs::write(out, &bytes).map_err(|e| e.to_string())?;
        Ok(
            json!({"encoder": {"name": "VideoToolbox H.264", "version": apple::os_version(), "hardware": hardware},
            "sha256": sha256(&bytes)}),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (frames, pts, timescale, w, h, out);
        Err("no encoder on this platform".into())
    }
}

/// One box: its size, type and body.
fn mp4_box(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    b.extend_from_slice(kind);
    b.extend_from_slice(body);
    b
}

fn full_box(kind: &[u8; 4], version_flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = version_flags.to_be_bytes().to_vec();
    b.extend_from_slice(body);
    mp4_box(kind, &b)
}

/// An MP4 of one H.264 track: `ftyp`, the samples in `mdat`, then `moov` with each sample's
/// duration from the next one's time.
#[cfg(target_os = "macos")]
fn mux_h264(
    coded: &[apple::Coded],
    avcc: &[u8],
    w: usize,
    h: usize,
    pts: &[i64],
    timescale: u32,
) -> Vec<u8> {
    let be32 = |v: u32| v.to_be_bytes();
    let mut out = mp4_box(
        b"ftyp",
        &[
            b"isom".as_slice(),
            &be32(512),
            b"isom",
            b"iso2",
            b"avc1",
            b"mp41",
        ]
        .concat(),
    );
    let mdat_body: Vec<u8> = coded.iter().flat_map(|c| c.bytes.iter().copied()).collect();
    let data_at = out.len() as u32 + 8;
    out.extend(mp4_box(b"mdat", &mdat_body));
    let n = coded.len();
    let step = pts.windows(2).last().map_or(1, |w| (w[1] - w[0]).max(1));
    let durations: Vec<u32> = (0..n)
        .map(|i| pts.get(i + 1).map_or(step, |p| p - pts[i]) as u32)
        .collect();
    let total: u64 = durations.iter().map(|d| *d as u64).sum();
    let matrix: Vec<u8> = [0x10000u32, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000]
        .iter()
        .flat_map(|v| be32(*v))
        .collect();
    let mvhd = full_box(
        b"mvhd",
        0,
        &[
            &be32(0)[..],
            &be32(0),
            &be32(timescale),
            &be32(total as u32),
            &be32(0x10000),
            &[1, 0],
            &[0; 10],
            &matrix,
            &[0; 24],
            &be32(2),
        ]
        .concat(),
    );
    let tkhd = full_box(
        b"tkhd",
        3,
        &[
            &be32(0)[..],
            &be32(0),
            &be32(1),
            &be32(0),
            &be32(total as u32),
            &[0; 8],
            &[0; 4],
            &[0; 4],
            &matrix,
            &be32((w as u32) << 16),
            &be32((h as u32) << 16),
        ]
        .concat(),
    );
    let mdhd = full_box(
        b"mdhd",
        0,
        &[
            &be32(0)[..],
            &be32(0),
            &be32(timescale),
            &be32(total as u32),
            &[0x55, 0xc4, 0, 0],
        ]
        .concat(),
    );
    let hdlr = full_box(
        b"hdlr",
        0,
        &[&be32(0)[..], b"vide", &[0; 12], b"VideoHandler\0"].concat(),
    );
    let vmhd = full_box(b"vmhd", 1, &[0; 8]);
    let dref = full_box(
        b"dref",
        0,
        &[&be32(1)[..], &full_box(b"url ", 1, &[])].concat(),
    );
    let mut entry = vec![0u8; 6];
    entry.extend_from_slice(&[0, 1]);
    entry.extend_from_slice(&[0; 16]);
    entry.extend_from_slice(&(w as u16).to_be_bytes());
    entry.extend_from_slice(&(h as u16).to_be_bytes());
    entry.extend_from_slice(&[0, 0x48, 0, 0, 0, 0x48, 0, 0, 0, 0, 0, 0, 0, 1]);
    entry.extend_from_slice(&[0; 32]);
    entry.extend_from_slice(&[0, 0x18, 0xff, 0xff]);
    entry.extend(mp4_box(b"avcC", avcc));
    let stsd = full_box(
        b"stsd",
        0,
        &[&be32(1)[..], &mp4_box(b"avc1", &entry)].concat(),
    );
    let mut stts = be32(n as u32).to_vec();
    for d in &durations {
        stts.extend_from_slice(&be32(1));
        stts.extend_from_slice(&be32(*d));
    }
    let stts = full_box(b"stts", 0, &stts);
    let keys: Vec<u32> = (0..n)
        .filter(|i| coded[*i].key)
        .map(|i| i as u32 + 1)
        .collect();
    let stss = full_box(
        b"stss",
        0,
        &[
            be32(keys.len() as u32).to_vec(),
            keys.iter().flat_map(|k| be32(*k)).collect(),
        ]
        .concat(),
    );
    let stsz = full_box(
        b"stsz",
        0,
        &[
            be32(0).to_vec(),
            be32(n as u32).to_vec(),
            coded
                .iter()
                .flat_map(|c| be32(c.bytes.len() as u32))
                .collect(),
        ]
        .concat(),
    );
    let stsc = full_box(
        b"stsc",
        0,
        &[&be32(1)[..], &be32(1), &be32(n as u32), &be32(1)].concat(),
    );
    let stco = full_box(b"stco", 0, &[&be32(1)[..], &be32(data_at)].concat());
    let stbl = mp4_box(b"stbl", &[stsd, stts, stss, stsz, stsc, stco].concat());
    let minf = mp4_box(b"minf", &[vmhd, mp4_box(b"dinf", &dref), stbl].concat());
    let mdia = mp4_box(b"mdia", &[mdhd, hdlr, minf].concat());
    let trak = mp4_box(b"trak", &[tkhd, mdia].concat());
    out.extend(mp4_box(b"moov", &[mvhd, trak].concat()));
    out
}

/// Runs one job in this process: a probe, decode or proxy of `path`, or an encode. Returns the
/// reply and the hash of the file the job read or wrote.
pub fn run(job: &Map<String, Value>, caps: &Caps, planted: &Planted) -> (Value, Option<String>) {
    let job = Job { v: job };
    let op = job.s("op").unwrap_or_default();
    if op == "encode" {
        return match encode(&job) {
            Ok(v) => {
                let sha = v["sha256"].as_str().map(str::to_string);
                (v, sha)
            }
            Err(e) => (json!({"error": e}), None),
        };
    }
    let Some(path) = job.s("path") else {
        return (json!({"error": "a job names its path"}), None);
    };
    let opened = match open(path, caps, planted) {
        Ok(o) => o,
        Err((r, sha)) => return (r, sha),
    };
    let sha = Some(opened.sha.clone());
    let f = match format(&opened.data) {
        Ok(f) => f,
        Err(r) => return (r, sha),
    };
    if let Some(url) = points_at(&f) {
        if planted.is("follows_urls") {
            follow(&url);
        }
        return (refused("external_reference", json!({"url": url})), sha);
    }
    if !planted.is("skips_caps") {
        if let Some(r) = over_caps(&f, caps) {
            return (r, sha);
        }
    }
    let probed = probe(&f, &opened.sha, planted);
    let reply = match op {
        "probe" => Ok(probed),
        "decode" => decode(&f, &opened.data, &job, planted, &probed).map(|d| json!({"decoded": d})),
        "proxy" => proxy(&f, &opened.data, &job),
        _ => Err(format!("no job {op}")),
    };
    (reply.unwrap_or_else(|e| json!({"error": e})), sha)
}

/// The roles a helper process runs as.
pub const DECODE_WORKER: &str = "decode_worker";
pub const ENCODE_TOOL: &str = "encode_tool";

/// A helper process's whole life: `args` are what follows its role on its command line
/// (`--caps <json>`, `--planted <name>`). A decode worker enters its sandbox first, unless it is
/// the planted one that follows URLs; it answers jobs one JSON line at a time and refuses an
/// encode. The encode tool runs only encodes.
pub fn serve(role: &str, args: &[String]) -> i32 {
    let mut caps = Caps::default();
    let mut planted = Planted::default();
    for pair in args.chunks(2) {
        match (pair[0].as_str(), pair.get(1)) {
            ("--caps", Some(v)) => {
                caps = Caps::from_json(&serde_json::from_str(v).unwrap_or_default())
            }
            ("--planted", Some(v)) => planted = Planted::one(v),
            _ => {}
        }
    }
    if role == DECODE_WORKER && !planted.is("follows_urls") {
        #[cfg(target_os = "macos")]
        if let Err(e) = apple::sandbox() {
            eprintln!("decode worker: {e}");
            return 1;
        }
    }
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(Value::Object(job)) = serde_json::from_str::<Value>(&line) else {
            let _ = writeln!(stdout, "{}", json!({"error": "unreadable job"}));
            continue;
        };
        let op = job.get("op").and_then(Value::as_str).unwrap_or_default();
        let allowed = match role {
            ENCODE_TOOL => op == "encode",
            _ => op != "encode" || planted.is("encodes_in_decode_worker"),
        };
        let (reply, sha) = if allowed {
            run(&job, &caps, &planted)
        } else {
            (json!({"error": format!("a {role} never runs {op}")}), None)
        };
        let _ = writeln!(stdout, "{}", json!({"reply": reply, "file": sha}));
        let _ = stdout.flush();
    }
    0
}

/// A helper process this side started, and every job it ran.
pub struct Helper {
    pub pid: u32,
    pub role: &'static str,
    pub jobs: Vec<(String, Option<String>)>,
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl Helper {
    /// Starts `exe` as a helper in `role`, with the run's caps and planted program.
    pub fn start(
        exe: &Path,
        role: &'static str,
        caps: &Caps,
        planted: Option<&str>,
    ) -> std::io::Result<Helper> {
        let arg = if role == ENCODE_TOOL {
            "encode-tool"
        } else {
            "decode-worker"
        };
        let mut cmd = Command::new(exe);
        cmd.arg(arg).arg("--caps").arg(caps.json().to_string());
        if let Some(p) = planted {
            cmd.arg("--planted").arg(p);
        }
        let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
        let stdin = child.stdin.take();
        let stdout = BufReader::new(child.stdout.take().expect("piped"));
        Ok(Helper {
            pid: child.id(),
            role,
            jobs: Vec::new(),
            child,
            stdin,
            stdout,
        })
    }

    /// One job, answered; it joins this helper's jobs with the file it read or wrote.
    pub fn ask(&mut self, job: &Value) -> Value {
        let op = job["op"].as_str().unwrap_or_default().to_string();
        let mut line = String::new();
        let answered = self
            .stdin
            .as_mut()
            .is_some_and(|s| writeln!(s, "{job}").is_ok() && s.flush().is_ok())
            && self.stdout.read_line(&mut line).is_ok_and(|n| n > 0);
        let v: Value = match answered {
            true => serde_json::from_str(&line).unwrap_or_default(),
            false => {
                json!({"reply": {"error": format!("the {} process {} ended", self.role, self.pid)}})
            }
        };
        self.jobs.push((op, v["file"].as_str().map(str::to_string)));
        v["reply"].clone()
    }

    pub fn json(&self) -> Value {
        json!({"pid": self.pid, "role": self.role,
            "jobs": self.jobs.iter().map(|(op, file)| json!({"op": op, "file": file})).collect::<Vec<_>>()})
    }
}

impl Drop for Helper {
    /// Its stdin closes, so it ends, and it is waited for; nothing signals it.
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}
