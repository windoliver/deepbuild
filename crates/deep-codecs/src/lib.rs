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
mod audio;
mod chunks;
pub mod color;
mod export;
mod flac;
pub mod maps;
mod mkv;
pub mod mov;
pub mod mp4;
mod ogg;
mod pipe;
mod stream;
pub mod table;
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
    /// #154: a score's stem, decoded whole, with its loop points.
    Flac(flac::Flac),
    Png(u32, u32, bool),
    Playlist(&'a str),
    Movie(mp4::Movie),
    /// #503: an audio file in another container (audio.rs).
    Audio(audio::Track),
}

fn format(data: &[u8]) -> Result<Format<'_>, Value> {
    if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WAVE") {
        return wav::parse(data)
            .map(Format::Wav)
            .ok_or_else(|| match wav::tag(data) {
                Some(t) if t != 1 && t != 3 => audio::unsupported(&wav::tag_name(t)),
                _ => refused(
                    "unreadable",
                    json!({"why": "a WAVE file without fmt and data"}),
                ),
            });
    }
    if data.starts_with(b"fLaC") {
        return flac::parse(data).map(Format::Flac).ok_or_else(|| {
            refused(
                "unreadable",
                json!({"why": "a FLAC stream that doesn't decode"}),
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
    if let Some(read) = audio::read(data) {
        return read.map(Format::Audio);
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
        Format::Flac(f) => (
            seconds_over(f.frames as i64, f.rate, caps.max_duration),
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
        Format::Audio(t) => (
            seconds_over(
                t.frames.unwrap_or(0) as i64,
                t.rate.max(1),
                caps.max_duration,
            ),
            0,
        ),
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

fn probe(f: &Format, data: &[u8], sha: &str, planted: &Planted) -> Value {
    let (kind, streams, decoder) = match f {
        Format::Wav(w) => (
            "audio",
            vec![
                json!({"index": 0, "type": "audio", "codec": w.codec(), "time_base": [1, w.rate],
                "sample_rate": w.rate, "channels": w.channels, "duration": [w.frames, w.rate]}),
            ],
            json!({"name": "deep-codecs wav", "version": env!("CARGO_PKG_VERSION")}),
        ),
        Format::Flac(f) => (
            "audio",
            vec![
                json!({"index": 0, "type": "audio", "codec": "flac", "time_base": [1, f.rate],
                "sample_rate": f.rate, "channels": f.channels, "duration": [f.frames, f.rate],
                "loop": f.loop_region.map(|(s, e)| json!([s, e]))}),
            ],
            json!({"name": "deep-codecs flac", "version": env!("CARGO_PKG_VERSION")}),
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
            let mut streams = (m.tracks.iter().enumerate())
                .filter(|(_, t)| matches!(t.kind, mp4::Kind::Video | mp4::Kind::Audio))
                .map(|(i, t)| {
                    let mut s = json!({"index": i, "codec": codec(&t.entry.fourcc),
                        "time_base": [1, t.timescale], "duration": [t.span(m.timescale), t.timescale]});
                    if t.kind == mp4::Kind::Audio {
                        // #503: the codec as ffprobe names it, an AAC stream's rate and channels
                        // as its decoder gives them, and a codec the list doesn't hold refused.
                        let (c, config) = audio::mp4_codec(&t.entry.fourcc, t.entry.config.as_ref());
                        let mut shape = (t.entry.sample_rate, u32::from(t.entry.channels));
                        if let Ok(audio::Codec::Aac) = c {
                            let first = audio::mp4_packets(t, data, 8);
                            shape = audio::aac_shape(&config, &first).map_or(shape, |a| (a.0, a.1));
                        }
                        s["type"] = json!("audio");
                        s["codec"] = json!(c.as_ref().map_or_else(String::clone, audio::Codec::name));
                        s["sample_rate"] = json!(shape.0);
                        s["channels"] = json!(shape.1);
                        if let Err(name) = c {
                            s["refused"] = audio::unsupported(&name)["refused"].take();
                        }
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
                    // #157: ProRes 4444's alpha is full range, its colour limited.
                    if &t.entry.fourcc == b"ap4h" {
                        s["alpha"] = json!({"range": "full"});
                    }
                    s["pts"] = shown.iter().map(|(_, p)| time(*p, t.timescale, planted)).collect();
                    s
                })
                .collect::<Vec<_>>();
            // #501: the timecode track, its first frame read from its sample.
            let at = m.tracks.iter().position(|t| t.kind == mp4::Kind::Timecode);
            if let (Some(i), Some(t)) = (at, m.timecode(data)) {
                // #157: its track's time base, as every stream lists one.
                streams.push(
                    json!({"index": i, "type": "timecode", "start_frame": t.start_frame,
                    "drop_frame": t.drop_frame, "rate": t.rate, "time_base": [1, m.tracks[i].timescale]}),
                );
            }
            if m.tracks.iter().any(|t| t.kind == mp4::Kind::Video) {
                ("video", streams, platform_decoder())
            } else {
                ("audio", streams, our_audio())
            }
        }
        Format::Playlist(_) => ("video", vec![], platform_decoder()),
        Format::Audio(t) => ("audio", vec![audio::probe(t)], our_audio()),
    };
    json!({"asset": {"sha256": sha, "kind": kind, "probe": {"streams": streams}, "decoder": decoder}})
}

/// #503: our own audio decoders, which read every listed audio format.
fn our_audio() -> Value {
    json!({"name": "deep-codecs audio", "version": env!("CARGO_PKG_VERSION")})
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
    pick: Option<&[usize]>,
) -> (Vec<(usize, i64)>, Vec<usize>) {
    let shown = t.presented(timescale, edits);
    let chosen: Vec<(usize, i64)> = match pick {
        // #499: the frames named by their index in presentation order.
        Some(pick) => pick.iter().filter_map(|k| shown.get(*k).copied()).collect(),
        None => shown.into_iter().take(want.unwrap_or(usize::MAX)).collect(),
    };
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
    // #499: `frames: [k]` decodes only those frames (in presentation order), each from the sync
    // sample before it, and names each frame's planes by their SHA-256.
    let pick: Option<Vec<usize>> = job.v.get("frames").and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(|k| k.as_u64().map(|k| k as usize))
            .collect()
    });
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
        Format::Flac(fl) => {
            write("0.f32", &f32_bytes(&fl.samples))?;
            streams.push(
                json!({"index": 0, "type": "audio", "sample_rate": fl.rate, "channels": fl.channels,
                "first": [0, fl.rate], "samples": fl.frames, "file": "0.f32",
                "loop": fl.loop_region.map(|(s, e)| json!([s, e]))}),
            );
        }
        Format::Png(..) => {
            let img = image::load_from_memory(data)
                .map_err(|e| e.to_string())?
                .into_rgba8();
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
                        let (chosen, feed) =
                            video_plan(t, m.timescale, edits, want, pick.as_deref());
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
                                let matrix = color["matrix"].as_str().unwrap_or("bt709");
                                let bytes = match bgra {
                                    // #157: ProRes 4444's 12-bit planes, its alpha straight.
                                    true if &t.entry.fourcc == b"ap4h" => {
                                        color::yuva12_to_bgra(&p.planes, p.width, p.height, matrix)
                                    }
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
                                let mut frame =
                                    json!({"pts": time(*pts, t.timescale, planted), "file": name});
                                if pick.is_some() {
                                    frame["planes"] = json!(sha256(&p.planes));
                                }
                                frames.push(frame);
                            }
                        }
                        streams.push(
                            json!({"index": i, "type": "video", "size": size, "frames": frames}),
                        );
                    }
                    mp4::Kind::Audio => {
                        // #503: a stream in a codec the list doesn't hold is refused, naming it.
                        if let (Err(name), _) =
                            audio::mp4_codec(&t.entry.fourcc, t.entry.config.as_ref())
                        {
                            let mut s = audio::unsupported(&name);
                            s["index"] = json!(i);
                            s["type"] = json!("audio");
                            streams.push(s);
                            continue;
                        }
                        let (samples, first, rate, channels) =
                            audio::mp4_track(t, m.timescale, data, planted)?;
                        let name = format!("{i}.f32");
                        write(&name, &f32_bytes(&samples))?;
                        streams.push(json!({"index": i, "type": "audio", "sample_rate": rate,
                            "channels": channels, "first": first,
                            "samples": samples.len() / channels.max(1) as usize, "file": name}));
                    }
                    mp4::Kind::Timecode | mp4::Kind::Other => {}
                }
            }
        }
        Format::Playlist(_) => {}
        Format::Audio(t) => {
            let (samples, rate, channels) = audio::decode_trimmed(t)?;
            write("0.f32", &f32_bytes(&samples))?;
            streams.push(
                json!({"index": 0, "type": "audio", "sample_rate": rate, "channels": channels,
                "first": [0, rate], "samples": samples.len() / channels.max(1) as usize, "file": "0.f32"}),
            );
        }
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
    // #157: ProRes has no configuration box.
    let config = t.entry.config.as_ref();
    if config.is_none() && &t.entry.fourcc != b"ap4h" {
        return Err("a video track without its codec configuration".into());
    }
    let samples: Vec<(usize, Vec<u8>)> = feed
        .iter()
        .map(|i| {
            let s = &t.samples[*i];
            let range = s.offset as usize..(s.offset as usize).saturating_add(s.size as usize);
            (*i, data.get(range).unwrap_or_default().to_vec())
        })
        .collect();
    let full = track_color(t, &Planted::default())["range"] == "full";
    apple::decode_video(
        t.entry.fourcc,
        config,
        (t.entry.width, t.entry.height),
        &samples,
        full,
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
    let (chosen, feed) = video_plan(t, m.timescale, true, None, None);
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
        // #499: a proxy's encode names its GOP.
        let gop = job.v.get("gop").and_then(Value::as_u64).map(|g| g as u32);
        let (coded, avcc, hardware) =
            apple::encode_h264(&frames, w, h, &pts, timescale as i32, gop)?;
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
    // #501: an export's parts, their join and its PNG frames (export.rs).
    if op.starts_with("export.") {
        let v = export::run(op, &job, planted).unwrap_or_else(|e| e);
        let sha = v["sha256"].as_str().map(str::to_string);
        return (v, sha);
    }
    let Some(path) = job.s("path") else {
        return (json!({"error": "a job names its path"}), None);
    };
    let opened = match open(path, caps, planted) {
        Ok(o) => o,
        Err((r, sha)) => return (r, sha),
    };
    let sha = Some(opened.sha.clone());
    // #423: a material's map made ready for the GPU, its texels written to `out` (maps.rs).
    if op == "transcode" {
        return (map_job(&opened.data, &job, planted), sha);
    }
    if op == "table" {
        let key = job.s("key").unwrap_or_default();
        let probed = table::probe(&opened.data, key);
        return (
            probed.map(|p| json!({"probe": p})).unwrap_or_else(|r| r),
            sha,
        );
    }
    // #1967: a terminal recording, converted here by the cells module's pinned emulator into a
    // keyframe every second and row patches in flicks. A probe answers the asset; a decode the
    // conversion too.
    if let Some(rec) = deep_canvas_cells::recording::Recording::parse(&opened.data) {
        let rec = match planted.is("cells_patch_times_whole_seconds") {
            true => rec.whole_seconds(),
            false => rec,
        };
        let converted = deep_canvas_cells::recording::convert(&rec);
        let asset = json!({"sha256": opened.sha, "kind": "terminal",
            "probe": converted["probe"], "decoder": converted["decoder"]});
        let reply = match op {
            "probe" => json!({"asset": asset}),
            "decode" => json!({"asset": asset, "decoded": converted}),
            _ => json!({"error": format!("no job {op} for a terminal recording")}),
        };
        return (reply, sha);
    }
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
    // #503: a movie whose only sound is in a codec the list doesn't hold is refused, naming it.
    if let Format::Movie(m) = &f {
        let sound = m.tracks.iter().find(|t| t.kind == mp4::Kind::Audio);
        if let (false, Some(t)) = (m.tracks.iter().any(|t| t.kind == mp4::Kind::Video), sound) {
            if let (Err(name), _) = audio::mp4_codec(&t.entry.fourcc, t.entry.config.as_ref()) {
                return (audio::unsupported(&name), sha);
            }
        }
    }
    let probed = probe(&f, &opened.data, &opened.sha, planted);
    let reply = match op {
        "probe" => Ok(probed),
        "decode" => decode(&f, &opened.data, &job, planted, &probed).map(|d| json!({"decoded": d})),
        "proxy" => proxy(&f, &opened.data, &job),
        _ => Err(format!("no job {op}")),
    };
    (reply.unwrap_or_else(|e| json!({"error": e})), sha)
}

/// A `transcode` job: `role` (base_color, emission, normal, occlusion or data) and `bc` (the
/// adapter samples BC) choose the format; the texels go to `out` (a file path).
fn map_job(data: &[u8], job: &Job, planted: &Planted) -> Value {
    let Some(role) = job.s("role").and_then(maps::Role::read) else {
        return json!({"error": "a transcode names its role"});
    };
    let Some(out) = job.s("out") else {
        return json!({"error": "a transcode names its out file"});
    };
    let bc = job.v.get("bc").and_then(Value::as_bool).unwrap_or(true);
    let source = if maps::is_ktx2(data) {
        "ktx2"
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "jpeg"
    } else {
        "png"
    };
    match maps::ready(data, role, bc, planted.is("applies_image_gamma")) {
        Ok(r) => match std::fs::write(out, &r.data) {
            Ok(()) => {
                let mut v = r.json();
                v["source"] = json!(source);
                v["transcoder"] = json!(maps::TRANSCODER);
                v
            }
            Err(e) => json!({"error": e.to_string()}),
        },
        Err(e) => refused("unreadable_image", json!({"why": e})),
    }
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
    // #157: messages framed by `pipe`; a piped export and the decode worker's `stream` answer
    // more than once.
    let mut pipe = pipe::Pipe {
        r: std::io::stdin().lock(),
        w: std::io::BufWriter::with_capacity(1 << 20, std::io::stdout().lock()),
    };
    let mut bytes = Vec::new();
    while let Some(head) = pipe.next(&mut bytes) {
        let Value::Object(job) = head else {
            let _ = writeln!(pipe.w, "{}", json!({"error": "unreadable job"}));
            let _ = pipe.w.flush();
            continue;
        };
        let op = job.get("op").and_then(Value::as_str).unwrap_or_default();
        // #501: an export's jobs are the encode tool's too.
        let encodes = op == "encode" || op.starts_with("export.");
        let allowed = match role {
            ENCODE_TOOL => encodes,
            _ => !encodes || planted.is("encodes_in_decode_worker"),
        };
        let piped = job.get("frames").is_some_and(Value::is_u64);
        if allowed && piped && matches!(op, "export.part" | "export.png") {
            export::stream(op, &Job { v: &job }, &planted, &mut pipe);
            continue;
        }
        if allowed && op == "stream" {
            stream::run(&Job { v: &job }, &caps, &planted, &mut pipe);
            continue;
        }
        let (reply, sha) = if allowed {
            // #503: a decoder that panics on a file answers an error for that job alone.
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&job, &caps, &planted)))
                .unwrap_or_else(|_| (json!({"error": "the decoder failed on the file"}), None))
        } else {
            (json!({"error": format!("a {role} never runs {op}")}), None)
        };
        pipe.reply(&reply, sha.as_deref());
    }
    0
}

/// The live decode worker's header magic (#499).
pub const LIVE_MAGIC: &[u8; 4] = b"DVL1";

/// #499: the live view's decode worker for one video: sandboxed, it opens `path` and decodes the
/// frames the view asks for, one session kept open so playing forward decodes each frame once, as
/// NV12 at `out_w × out_h` (0 for the source's size) in the range the stream is tagged with.
///
/// On start it writes `DVL1`, then u32 LE source width, height, output width, height, matrix
/// (0 BT.709, 1 BT.601, 2 BT.2020), full range (0 or 1), i64 timescale, u32 frame count and
/// each frame's presentation time (i64 ticks, presentation order). Each request is a u32 frame
/// index (u32::MAX ends it); each answer is u32 index, u32 ok, then the Y plane and the CbCr
/// plane, rows top-down without padding.
pub fn serve_live(args: &[String]) -> i32 {
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
    let (path, out_w, out_h) = (
        arg(0),
        arg(1).parse().unwrap_or(0usize),
        arg(2).parse().unwrap_or(0usize),
    );
    #[cfg(target_os = "macos")]
    if let Err(e) = apple::sandbox() {
        eprintln!("decode worker: {e}");
        return 1;
    }
    let Ok(data) = std::fs::read(&path) else {
        return 1;
    };
    let Some(m) = mp4::parse(&data) else { return 1 };
    let Some(t) = m.tracks.iter().find(|t| t.kind == mp4::Kind::Video) else {
        return 1;
    };
    let shown = t.presented(m.timescale, true);
    let color = track_color(t, &Planted::default());
    let matrix: u32 = match color["matrix"].as_str() {
        Some(m) if m.contains("601") || m.contains("470") || m.contains("smpte170") => 1,
        Some(m) if m.contains("2020") => 2,
        _ => 0,
    };
    let full = color["range"] == "full";
    let (sw, sh) = (t.entry.width as usize, t.entry.height as usize);
    let (ow, oh) = if out_w == 0 || out_h == 0 {
        (sw, sh)
    } else {
        (out_w & !1, out_h & !1)
    };
    let mut out = std::io::stdout().lock();
    let mut head = LIVE_MAGIC.to_vec();
    for v in [
        sw as u32,
        sh as u32,
        ow as u32,
        oh as u32,
        matrix,
        u32::from(full),
    ] {
        head.extend(v.to_le_bytes());
    }
    head.extend(i64::from(t.timescale).to_le_bytes());
    head.extend((shown.len() as u32).to_le_bytes());
    for (_, p) in &shown {
        head.extend(p.to_le_bytes());
    }
    if out.write_all(&head).and_then(|()| out.flush()).is_err() {
        return 1;
    }
    #[cfg(target_os = "macos")]
    {
        let Some(config) = t.entry.config.as_ref() else {
            return 1;
        };
        let Ok(mut dec) = apple::LiveDecoder::new(
            t.entry.fourcc,
            config,
            (t.entry.width, t.entry.height),
            (ow, oh),
            full,
        ) else {
            return 1;
        };
        let size = ow * oh * 3 / 2;
        let blank = vec![0u8; size];
        let mut last: Option<usize> = None;
        let mut stdin = std::io::stdin().lock();
        let mut req = [0u8; 4];
        while stdin.read_exact(&mut req).is_ok() {
            let k = u32::from_le_bytes(req);
            if k == u32::MAX {
                break;
            }
            let picture = (|| {
                let s = shown.get(k as usize)?.0;
                let from = match last {
                    Some(l) if l < s => l + 1,
                    _ => (0..=s).rev().find(|i| t.samples[*i].key).unwrap_or(0),
                };
                let mut got = None;
                for i in from..=s {
                    let smp = &t.samples[i];
                    let bytes =
                        data.get(smp.offset as usize..smp.offset as usize + smp.size as usize)?;
                    for p in dec.decode(i, bytes).ok()? {
                        if p.sample == s {
                            got = Some(p.planes);
                        }
                    }
                    last = Some(i);
                }
                got.filter(|p| p.len() == size)
            })();
            let ok = picture.is_some();
            let mut reply = k.to_le_bytes().to_vec();
            reply.extend(u32::from(ok).to_le_bytes());
            if out
                .write_all(&reply)
                .and_then(|()| out.write_all(picture.as_deref().unwrap_or(&blank)))
                .and_then(|()| out.flush())
                .is_err()
            {
                break;
            }
        }
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
    stdout: Option<BufReader<ChildStdout>>,
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
        let stdout = Some(BufReader::with_capacity(
            1 << 20,
            child.stdout.take().expect("piped"),
        ));
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
            && (self.stdout.as_mut()).is_some_and(|o| o.read_line(&mut line).is_ok_and(|n| n > 0));
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
    /// Its stdin closes, so it ends, and it is waited for; nothing signals it. #157: its stdout's
    /// read end closes first, so a helper still writing a stream ends too instead of waiting on a
    /// reader that has gone.
    fn drop(&mut self) {
        drop(self.stdin.take());
        drop(self.stdout.take());
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `f` returns, or `None` when it has not returned after ten seconds.
    pub(crate) fn finished<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || tx.send(f()));
        rx.recv_timeout(std::time::Duration::from_secs(10)).ok()
    }

    /// A track whose one sample ends past the last byte a file can have.
    fn track_past_the_end() -> mp4::Track {
        mp4::Track {
            kind: mp4::Kind::Audio,
            timescale: 1,
            duration: 0,
            edits: Vec::new(),
            entry: mp4::Entry {
                config: Some((*b"none", Vec::new())),
                ..Default::default()
            },
            samples: vec![mp4::Sample {
                offset: u64::MAX - 1,
                size: 4,
                dts: 0,
                cts: 0,
                key: true,
            }],
        }
    }

    /// #157: QuickTime's uncompressed sound sizes each sample as one byte, its chunk holding the
    /// frames back to back; `sowt` is little-endian and `twos` big-endian.
    #[test]
    fn integer_pcm_reads_whole_frames_from_a_chunk_of_one_byte_samples() {
        let values: [i16; 6] = [1, -1, 16_384, -16_384, 32_767, -32_768];
        let want: Vec<f32> = values.iter().map(|&v| f32::from(v) / 32_768.0).collect();
        for (fourcc, big) in [(*b"sowt", false), (*b"twos", true)] {
            let data: Vec<u8> = values
                .iter()
                .flat_map(|v| {
                    if big {
                        v.to_be_bytes()
                    } else {
                        v.to_le_bytes()
                    }
                })
                .collect();
            let track = mp4::Track {
                kind: mp4::Kind::Audio,
                timescale: 48_000,
                duration: 3,
                edits: Vec::new(),
                entry: mp4::Entry {
                    fourcc,
                    channels: 2,
                    bits: 16,
                    sample_rate: 48_000,
                    ..Default::default()
                },
                samples: (0..3)
                    .map(|k| mp4::Sample {
                        offset: k,
                        size: 1,
                        dts: k as i64,
                        cts: k as i64,
                        key: true,
                    })
                    .collect(),
            };
            let (got, _, rate, channels) =
                audio(&track, 48_000, &data, &Planted::default()).unwrap();
            assert_eq!(
                (got, rate, channels),
                (want.clone(), 48_000, 2),
                "{}",
                String::from_utf8_lossy(&fourcc)
            );
        }
    }

    #[test]
    fn an_audio_sample_past_the_end_of_the_file_reads_as_empty() {
        let got = audio(&track_past_the_end(), 1, &[], &Planted::default());
        assert!(got.is_err_and(|e| e.starts_with("no decoder for")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_video_sample_past_the_end_of_the_file_reads_as_empty() {
        let got = video_frames(&track_past_the_end(), &[], &[0]);
        assert!(got.is_err_and(|e| e.starts_with("no decoder for")));
    }

    /// #157: read from its boxes alone, a delivery's `moov` ends before its `mdat` begins; the
    /// legacy encode op's file puts it after.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_delivery_has_its_moov_before_its_mdat() {
        let moov_first = |bytes: Vec<u8>| {
            let head = mp4::Head::read(&mut std::io::Cursor::new(bytes)).unwrap();
            let at = |k: &[u8; 4]| *head.boxes.iter().find(|b| &b.0 == k).unwrap();
            assert!(head.movie.is_some_and(|m| m.tracks[0].samples.len() == 3));
            let (moov, mdat) = (at(b"moov"), at(b"mdat"));
            moov.1 + moov.2 <= mdat.1
        };
        let sample = [0u8, 0, 0, 1, 0x65];
        let video = mov::Video {
            fourcc: *b"avc1",
            config: Some(&[1, 2, 3]),
            size: [64, 64],
            timescale: 24000,
            ticks: 1000,
            samples: vec![&sample[..]; 3],
            keys: None,
            held: None,
        };
        assert!(moov_first(mov::write(mov::Brand::Mp4, &video, None, None)));
        let coded: Vec<apple::Coded> = (0..3)
            .map(|_| apple::Coded {
                bytes: sample.to_vec(),
                key: true,
            })
            .collect();
        let legacy = mux_h264(&coded, &[1, 2, 3], 64, 64, &[0, 1000, 2000], 24000);
        assert!(!moov_first(legacy));
    }
}
