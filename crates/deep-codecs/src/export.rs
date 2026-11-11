//! Issue #501: an export's jobs in the encode tool. `export.part` encodes one shard's raw frames
//! into a video-only part, `export.join` lays the parts end to end without encoding again and
//! adds the sound (the PCM, or AAC encoded from it) and the timecode, and `export.png` writes the frames as PNGs. Frames are BGRA8
//! files, rows top-down without padding, alpha straight. Each output is written under a temporary
//! sibling name and renamed when it is whole.

use std::path::Path;

use serde_json::{json, Value};

use crate::{mov, mp4, refused, sha256, Job, Planted};

fn error(e: impl ToString) -> Value {
    json!({"error": e.to_string()})
}

/// Runs the export job `op`: its reply, or the error or refusal to answer with.
pub(crate) fn run(op: &str, job: &Job, planted: &Planted) -> Result<Value, Value> {
    match op {
        "export.part" => part(job),
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

/// One shard: its frames through the platform's encoder into a video-only part, an MP4 of H.264
/// or a QuickTime movie of ProRes 4444.
#[cfg(target_os = "macos")]
fn part(job: &Job) -> Result<Value, Value> {
    use crate::{apple, color};
    let (size, [p, q]) = (pair(job, "size")?, pair(job, "rate")?);
    let (out, codec) = (text(job, "out")?, text(job, "codec")?);
    let frames = frames(job, size)?;
    let (timescale, ticks) = mov::timescale(p, q);
    let pts: Vec<i64> = (0..frames.len() as i64).map(|k| k * ticks as i64).collect();
    let (w, h) = (size[0] as usize, size[1] as usize);
    let (name, brand, fourcc, coded, config, hardware) = match codec {
        "h264" => {
            let planes: Vec<Vec<u8>> = (frames.iter())
                .map(|f| color::bgra_to_i420(f, w, h))
                .collect();
            let (mut coded, avcc, hardware) =
                apple::encode_h264(&planes, w, h, &pts, timescale as i32, None).map_err(error)?;
            // The encoder's SEI units carry a per-session value; the same frames must give the
            // same file, so they are left out (no picture data is in them).
            let length = usize::from(avcc.get(4).map_or(3, |b| b & 3)) + 1;
            for c in &mut coded {
                c.bytes = without_sei(&c.bytes, length);
            }
            (
                "VideoToolbox H.264",
                mov::Brand::Mp4,
                *b"avc1",
                coded,
                Some(avcc),
                hardware,
            )
        }
        "prores_4444" => {
            let (coded, hardware) =
                apple::encode_prores4444(&frames, w, h, &pts, timescale as i32).map_err(error)?;
            (
                "VideoToolbox ProRes 4444",
                mov::Brand::Mov,
                *b"ap4h",
                coded,
                None,
                hardware,
            )
        }
        other => return Err(error(format!("no export codec {other}"))),
    };
    if coded.len() != frames.len() {
        return Err(error(format!(
            "the encoder gave {} frames of {}",
            coded.len(),
            frames.len()
        )));
    }
    let video = mov::Video {
        fourcc,
        config: config.as_deref(),
        size,
        timescale,
        ticks,
        samples: coded.iter().map(|c| &c.bytes[..]).collect(),
        keys: config
            .is_some()
            .then(|| coded.iter().map(|c| c.key).collect()),
        held: None,
    };
    let bytes = mov::write(brand, &video, None, None);
    whole(out, |tmp| std::fs::write(tmp, &bytes).map_err(error))?;
    Ok(
        json!({"encoder": {"name": name, "version": apple::os_version(), "hardware": hardware},
        "frames": coded.len(), "sha256": sha256(&bytes)}),
    )
}

#[cfg(not(target_os = "macos"))]
fn part(_: &Job) -> Result<Value, Value> {
    Err(error("no encoder on this platform"))
}

/// The parts in order as one file: every part's coded samples as they are, then the job's PCM
/// (`audio.codec` `pcm`, the default) or AAC encoded from it (`aac`), and its timecode. Parts that differ in codec, size, timescale or codec configuration are refused,
/// naming the first that differs and what in.
fn join(job: &Job, planted: &Planted) -> Result<Value, Value> {
    let out = text(job, "out")?;
    let paths = (job.v.get("parts").and_then(Value::as_array))
        .filter(|p| !p.is_empty())
        .ok_or_else(|| error("an export names its parts"))?;
    let files: Vec<Vec<u8>> = (paths.iter())
        .map(|p| std::fs::read(p.as_str().unwrap_or_default()).map_err(error))
        .collect::<Result<_, _>>()?;
    let mut tracks = Vec::new();
    for (k, data) in files.iter().enumerate() {
        let video = mp4::parse(data).and_then(|m| {
            (m.tracks.into_iter()).find(|t| t.kind == mp4::Kind::Video && !t.samples.is_empty())
        });
        tracks.push(video.ok_or_else(|| error(format!("part {k} holds no video")))?);
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
    let mut samples = Vec::new();
    let mut keys = Vec::new();
    for (k, (t, data)) in tracks.iter().zip(&files).enumerate() {
        for s in &t.samples {
            let bytes = data.get(s.offset as usize..(s.offset + s.size as u64) as usize);
            samples.push(bytes.ok_or_else(|| error(format!("part {k} is cut short")))?);
            keys.push(s.key);
        }
    }
    // Planted (#1163): the writer leaves frame 300 out and holds frame 299 over its place.
    let mut held = None;
    if planted.is("video_drops_frame_300") && samples.len() > 300 {
        samples.remove(300);
        keys.remove(300);
        held = Some(299);
    }
    let video = mov::Video {
        fourcc: first.entry.fourcc,
        config: first.entry.config.as_ref().map(|c| &c.1[..]),
        size: [first.entry.width as u32, first.entry.height as u32],
        timescale: first.timescale,
        ticks: ticks(first) as u32,
        samples,
        keys: keys.contains(&false).then_some(keys),
        held,
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
            Some((
                rate as u32,
                channels as u16,
                aac,
                std::fs::read(path).map_err(error)?,
            ))
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
    let audio = (pcm.as_ref()).map(|(rate, channels, _, f32le)| match &aac {
        None => mov::Audio::Pcm(mov::Pcm {
            rate: *rate,
            channels: *channels,
            f32le,
        }),
        Some((packets, cookie, priming)) => mov::Audio::Aac(mov::Aac {
            rate: *rate,
            channels: *channels,
            descriptor: cookie,
            packets: packets.iter().map(|p| &p[..]).collect(),
            priming: *priming,
            frames: (f32le.len() / (4 * *channels as usize)) as u64,
        }),
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
    let bytes = mov::write(brand, &video, audio.as_ref(), timecode.as_ref());
    whole(out, |tmp| std::fs::write(tmp, &bytes).map_err(error))?;
    Ok(json!({"frames": video.samples.len(), "sha256": sha256(&bytes)}))
}

/// The frames as PNGs with straight alpha in the folder `out`, named `000000.png` onward.
fn png(job: &Job, planted: &Planted) -> Result<Value, Value> {
    let size = pair(job, "size")?;
    let out = text(job, "out")?;
    let frames = frames(job, size)?;
    whole(out, |tmp| {
        std::fs::create_dir_all(tmp).map_err(error)?;
        for (k, frame) in frames.iter().enumerate() {
            let mut rgba = frame.clone();
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
                .save(tmp.join(format!("{k:06}.png")))
                .map_err(error)?;
        }
        Ok(())
    })?;
    Ok(json!({"frames": frames.len()}))
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
            held: None,
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
                "rate": 24})
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
}
