//! Issue #498: the device gate (canvas primitives: Device gate), the trusted ring's, which every
//! sound a panel plays passes through to the device:
//!
//! - a panel's sound starts only after your gesture in that panel: Play carrying the serial of
//!   your input there since it last opened a document. Its own request, an agent's, or a serial
//!   from another panel is refused, so the gate stays `suspended` and the device silent;
//! - the gesture covers that panel's document until it closes or opens another, when every voice
//!   it started stops within one audio block (128 samples), and playing again needs a new one;
//! - reserved sounds (the question chime and the notice) come only from the app: an asset too
//!   similar to one is refused at load, naming it. Too similar is measured: its log-mel
//!   spectrogram, loudness-matched, correlates with the reserved sound's at 0.9 or more at some
//!   offset within ±50 ms and some pitch shift within ±2 semitones.
//!
//! What reaches the device is rendered on its own sample clock, 48 kHz from flick 0, and an
//! `output` call writes it into the evidence store as a WAV. Strip assets are decoded in the
//! decode worker, as every asset is.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_codecs::DECODE_WORKER;
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Hub, Planted};
use crate::refused;
use crate::shared::FLICKS;

/// The device's rate: a second's flicks divide by it, so every sample has an exact time.
const RATE: i64 = 48_000;
/// One audio block (canvas primitives: Blocks).
const BLOCK: i64 = 128;
/// A stop's fade, inside one block, so it doesn't click.
const STOP_FADE: i64 = BLOCK / 2;
/// The planted close's fade: 5 ms, longer than a block.
const PLANTED_FADE: i64 = 240;

pub struct Strip {
    source: Rc<Vec<f32>>,
    rate: i64,
    start: i64,
    from: i64,
    to: i64,
    looped: bool,
}

pub enum GateCall {
    Open {
        panel: String,
        strips: Vec<(u32, String, i64, i64, i64, bool)>,
    },
    Close(String),
    Play {
        panel: String,
        serial: Option<u64>,
        session: Option<String>,
    },
    Gate(String),
    Output {
        from: i64,
        to: i64,
    },
    Reserved,
}

/// One of this issue's gate calls, or `None` for a line that lacks a field it needs. `play`
/// with a `panel` is the gate's; without one it is #488's.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<GateCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    let t = |k: &str| c.get(k)?.as_i64();
    Some(match name {
        "open" if s("doc").is_some() => GateCall::Open {
            panel: s("panel")?,
            strips: c
                .get("strips")?
                .as_array()?
                .iter()
                .map(|x| {
                    let n = |k: &str| x.get(k)?.as_i64();
                    Some((
                        u32::try_from(x.get("track")?.as_u64()?).ok()?,
                        x.get("src")?.get("asset")?.as_str()?.to_string(),
                        n("start")?,
                        n("in")?,
                        n("out")?,
                        x.get("loop").map_or(Some(false), Value::as_bool)?,
                    ))
                })
                .collect::<Option<_>>()?,
        },
        "close" => GateCall::Close(s("panel")?),
        "play" if c.contains_key("panel") => GateCall::Play {
            panel: s("panel")?,
            serial: match c.get("serial") {
                None => None,
                Some(v) => Some(v.as_u64()?),
            },
            session: match c.get("session") {
                None => None,
                Some(_) => Some(s("session")?),
            },
        },
        "gate" => GateCall::Gate(s("panel")?),
        "output" => GateCall::Output {
            from: t("from")?,
            to: t("to")?,
        },
        "reserved" => GateCall::Reserved,
        _ => return None,
    })
}

/// A run of a document's strips from `start` (a device sample) until `stop` with its fade.
struct Voices {
    start: i64,
    strips: Rc<Vec<Strip>>,
    stop: Option<(i64, i64)>,
}

#[derive(Default)]
struct Owner {
    strips: Option<Rc<Vec<Strip>>>,
    /// When it last opened a document or closed: a gesture before then grants nothing.
    since: i64,
    granted_by: Option<u64>,
    voices: Vec<Voices>,
}

/// The gate's owners by panel ID, and the reserved sounds once made.
#[derive(Default)]
pub struct Gate {
    owners: BTreeMap<String, Owner>,
}

/// The first device sample at or after `t`.
fn sample_at(t: i64) -> i64 {
    (t * RATE + FLICKS - 1).div_euclid(FLICKS)
}

/// The app's reserved sounds: (ID, what it is for, mono samples at 48 kHz). The question chime
/// is a rising fifth on a bell (A5 then E6), the notice one soft tone.
pub fn reserved() -> Vec<(&'static str, &'static str, Vec<f32>)> {
    let bell = |hz: f64, at: f64, len: f64, out: &mut [f32]| {
        let partials: [(f64, f64, f64); 3] = [(1.0, 0.6, 3.0), (2.76, 0.25, 6.0), (5.4, 0.1, 10.0)];
        let from = (at * RATE as f64) as usize;
        for i in 0..(len * RATE as f64) as usize {
            let t = i as f64 / RATE as f64;
            let attack = (t / 0.004).min(1.0);
            let v: f64 = partials
                .iter()
                .map(|(m, a, d)| a * (-d * t).exp() * (std::f64::consts::TAU * hz * m * t).sin())
                .sum();
            if let Some(o) = out.get_mut(from + i) {
                *o += (0.5 * attack * v) as f32;
            }
        }
    };
    let mut chime = vec![0f32; (0.7 * RATE as f64) as usize];
    bell(880.0, 0.0, 0.7, &mut chime);
    bell(1318.51, 0.12, 0.58, &mut chime);
    let mut notice = vec![0f32; (0.3 * RATE as f64) as usize];
    bell(659.26, 0.0, 0.3, &mut notice);
    vec![
        ("question-chime", "question", chime),
        ("notice", "notice", notice),
    ]
}

/// Mono PCM as a 16-bit WAV, or as 32-bit float (`float`) with `channels` copies of it.
fn wav(samples: &[f32], channels: u16, float: bool) -> Vec<u8> {
    let width: u16 = if float { 4 } else { 2 };
    let data = samples.len() as u32 * width as u32 * channels as u32;
    let mut b = Vec::with_capacity(44 + data as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&(if float { 3u16 } else { 1 }).to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&(RATE as u32).to_le_bytes());
    b.extend_from_slice(&(RATE as u32 * (width * channels) as u32).to_le_bytes());
    b.extend_from_slice(&(width * channels).to_le_bytes());
    b.extend_from_slice(&(width * 8).to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        for _ in 0..channels {
            match float {
                true => b.extend_from_slice(&s.to_le_bytes()),
                false => b.extend_from_slice(
                    &((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes(),
                ),
            }
        }
    }
    b
}

/// A radix-2 FFT in place; `re.len()` is a power of two.
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -std::f64::consts::TAU / len as f64;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (wr, wi) = ((ang * k as f64).cos(), (ang * k as f64).sin());
                let (a, b) = (start + k, start + k + len / 2);
                let (xr, xi) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
            }
        }
        len <<= 1;
    }
}

const FFT: usize = 1024;
/// 5 ms, so ±50 ms is ±10 frames.
const HOP: usize = 240;
const MELS: usize = 40;

/// The log-mel spectrogram (dB, floored 80 dB under its loudest cell) of the first `frames`
/// frames of `x` at 48 kHz.
fn log_mel(x: &[f32], frames: usize) -> Vec<[f64; MELS]> {
    let mel = |hz: f64| 2595.0 * (1.0 + hz / 700.0).log10();
    let hz = |m: f64| 700.0 * (10f64.powf(m / 2595.0) - 1.0);
    let (lo, hi) = (mel(50.0), mel(16_000.0));
    let edges: Vec<f64> = (0..MELS + 2)
        .map(|i| hz(lo + (hi - lo) * i as f64 / (MELS + 1) as f64))
        .collect();
    let bin_hz = RATE as f64 / FFT as f64;
    let window: Vec<f64> = (0..FFT)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FFT as f64).cos())
        .collect();
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut re: Vec<f64> = (0..FFT)
            .map(|i| x.get(f * HOP + i).map_or(0.0, |v| *v as f64) * window[i])
            .collect();
        let mut im = vec![0.0; FFT];
        fft(&mut re, &mut im);
        let mut bands = [0f64; MELS];
        for (m, band) in bands.iter_mut().enumerate() {
            let (a, c, b) = (edges[m], edges[m + 1], edges[m + 2]);
            for k in (a / bin_hz).floor() as usize..=(b / bin_hz).ceil() as usize {
                let f = k as f64 * bin_hz;
                let w = if f < c {
                    (f - a) / (c - a)
                } else {
                    (b - f) / (b - c)
                };
                if w > 0.0 && k <= FFT / 2 {
                    *band += w * (re[k] * re[k] + im[k] * im[k]);
                }
            }
        }
        out.push(bands.map(|p| 10.0 * (p + 1e-20).log10()));
    }
    let top = out.iter().flatten().cloned().fold(f64::MIN, f64::max);
    for f in &mut out {
        f.iter_mut().for_each(|v| *v = v.max(top - 80.0));
    }
    out
}

/// `x` played `ratio` times as fast (tape style), by linear interpolation.
fn speed(x: &[f32], ratio: f64, len: usize) -> Vec<f32> {
    (0..len)
        .map(|i| {
            let p = i as f64 * ratio;
            let k = p.floor() as usize;
            let (a, b) = (
                x.get(k).copied().unwrap_or(0.0),
                x.get(k + 1).copied().unwrap_or(0.0),
            );
            a + (b - a) * (p - k as f64) as f32
        })
        .collect()
}

fn rms(x: &[f32]) -> f64 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt()
}

/// How like `reserved` the start of `candidate` is: the best correlation of their log-mel
/// spectrograms, loudness-matched, over offsets within ±50 ms and pitch shifts within ±2
/// semitones (quarter-semitone steps).
pub fn likeness(reserved: &[f32], candidate: &[f32]) -> f64 {
    let frames = reserved.len().saturating_sub(FFT) / HOP + 1;
    let r = log_mel(reserved, frames);
    let rms_r = rms(reserved);
    let mut best = f64::MIN;
    for q in -8i32..=8 {
        let ratio = 2f64.powf(q as f64 / 48.0);
        let len = (frames + 20) * HOP + FFT;
        let mut c = speed(candidate, ratio, len);
        let rc = rms(&c[..reserved.len().min(c.len())]);
        if rc > 0.0 {
            let g = (rms_r / rc) as f32;
            c.iter_mut().for_each(|v| *v *= g);
        }
        let cm = log_mel(&c, frames + 20);
        for off in -10i64..=10 {
            let pick = |t: usize| cm.get((t as i64 + off).max(-1) as usize).copied();
            let mut xs = Vec::with_capacity(frames * MELS);
            let mut ys = Vec::with_capacity(frames * MELS);
            let floor = cm.iter().flatten().cloned().fold(f64::MAX, f64::min);
            for (t, row) in r.iter().enumerate() {
                let other = if t as i64 + off < 0 { None } else { pick(t) };
                for m in 0..MELS {
                    xs.push(row[m]);
                    ys.push(other.map_or(floor, |o| o[m]));
                }
            }
            best = best.max(pearson(&xs, &ys));
        }
    }
    best
}

fn pearson(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    let (mx, my) = (x.iter().sum::<f64>() / n, y.iter().sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx).powi(2);
        syy += (b - my).powi(2);
    }
    if sxx == 0.0 || syy == 0.0 {
        return 0.0;
    }
    sxy / (sxx * syy).sqrt()
}

impl Hub<'_> {
    /// The gate's owner of `panel`'s sound: its shipped panel's ID, else the panel's.
    fn owner_of(&self, panel: &str) -> String {
        (self.scenario.panels.get(panel))
            .and_then(|p| p.shipped.clone())
            .unwrap_or_else(|| panel.to_string())
    }

    /// An asset from the evidence store, decoded in the decode worker to mono f32 and its rate.
    fn load(&mut self, sha: &str) -> Result<(Vec<f32>, i64), Value> {
        if evidence::read(&self.scenario.evidence, sha).is_none() {
            return Err(refused("unknown_asset"));
        }
        let path = self.scenario.evidence.join(&sha[..2]).join(&sha[2..]);
        let out =
            std::env::temp_dir().join(format!("deep-gate-{}-{}", std::process::id(), &sha[..16]));
        let job = json!({"op": "decode", "path": path, "out": out});
        let (reply, _) = self.media_job(DECODE_WORKER, job);
        let stream = reply["decoded"]["streams"]
            .as_array()
            .and_then(|s| s.iter().find(|s| s["type"] == "audio"))
            .cloned();
        let result = (|| {
            let s = stream.ok_or_else(|| json!({"code": "not_audio", "asset": sha}))?;
            let bytes = std::fs::read(out.join(s["file"].as_str().unwrap_or_default()))
                .map_err(|_| refused("unreadable"))?;
            let ch = s["channels"].as_u64().unwrap_or(1).max(1) as usize;
            let all: Vec<f32> = bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            let mono = all
                .chunks(ch)
                .map(|f| f.iter().sum::<f32>() / ch as f32)
                .collect();
            Ok((mono, s["sample_rate"].as_i64().unwrap_or(RATE)))
        })();
        let _ = std::fs::remove_dir_all(&out);
        result
    }

    /// Every voice `panel` started stops at `now`, within one block.
    fn stop(&mut self, panel: &str, fade: i64) {
        let at = sample_at(self.now);
        if let Some(o) = self.gate.owners.get_mut(panel) {
            for v in &mut o.voices {
                v.stop.get_or_insert((at, fade));
            }
            o.granted_by = None;
        }
    }

    pub fn gate_call(&mut self, call: &GateCall) -> Value {
        let planted = self.scenario.planted;
        let now = self.now;
        match call {
            GateCall::Open { panel, strips, .. } => {
                if !self.scenario.panels.contains_key(panel) {
                    return refused("unknown_panel");
                }
                let reserved: Vec<_> = reserved();
                let mut loaded = Vec::new();
                for (_track, sha, start, from, to, looped) in strips {
                    let (source, rate) = match self.load(sha) {
                        Ok(s) => s,
                        Err(e) => return e,
                    };
                    // Reserved sounds come only from the app.
                    for (id, _, sound) in &reserved {
                        let same = match planted {
                            Some(Planted::ComparerMatchesHash) => {
                                evidence::sha256_hex(&wav(sound, 1, false)) == *sha
                            }
                            _ => likeness(sound, &source) >= 0.9,
                        };
                        if same {
                            return json!({"code": "reserved_sound", "reserved": id, "asset": sha});
                        }
                    }
                    loaded.push(Strip {
                        source: Rc::new(source),
                        rate,
                        start: *start,
                        from: *from,
                        to: *to,
                        looped: *looped,
                    });
                }
                // Another document stops every voice of the one before; the planted gate keeps them.
                if planted != Some(Planted::KeepsVoicesOnSwitch) {
                    self.stop(panel, STOP_FADE);
                }
                let o = self.gate.owners.entry(panel.clone()).or_default();
                o.granted_by = None;
                o.strips = Some(Rc::new(loaded));
                o.since = now;
                json!({"opened": true})
            }
            GateCall::Close(panel) => {
                let fade = match planted {
                    Some(Planted::FadesOnClose) => PLANTED_FADE,
                    _ => STOP_FADE,
                };
                self.stop(panel, fade);
                let o = self.gate.owners.entry(panel.clone()).or_default();
                o.strips = None;
                o.since = now;
                json!({"closed": true})
            }
            GateCall::Play {
                panel,
                serial,
                session,
            } => {
                if session.is_some() {
                    return refused("agent_cannot_grant");
                }
                let shipped = self
                    .scenario
                    .panels
                    .get(panel)
                    .is_some_and(|p| p.shipped.is_some());
                let ungated = planted == Some(Planted::ShippedPanelsUngated) && shipped;
                let since = self.gate.owners.get(panel).map_or(0, |o| o.since);
                let granted = match serial {
                    Some(s) => self.placement.gesture_of(*s).is_some_and(|(p, when)| {
                        p == panel
                            && when >= since
                            && self.placement.serial_fresh_in(*s, panel, now)
                    }),
                    None => ungated,
                };
                let Some(o) = self
                    .gate
                    .owners
                    .get_mut(panel)
                    .filter(|o| o.strips.is_some())
                else {
                    return refused("no_document");
                };
                if !granted {
                    return refused(if serial.is_some() {
                        "serial_not_granting"
                    } else {
                        "no_gesture"
                    });
                }
                let strips = o.strips.clone().expect("open");
                for v in &mut o.voices {
                    v.stop.get_or_insert((sample_at(now), STOP_FADE));
                }
                o.voices.push(Voices {
                    start: sample_at(now),
                    strips,
                    stop: None,
                });
                o.granted_by = *serial;
                json!({"playing": true})
            }
            GateCall::Gate(panel) => {
                let o = self.gate.owners.get(panel);
                let running = o.is_some_and(|o| o.voices.iter().any(|v| v.stop.is_none()));
                json!({"gate": {
                    "owner": self.owner_of(panel),
                    "granted_by": o.and_then(|o| o.granted_by),
                    "state": if running { "running" } else { "suspended" },
                    "reserved": reserved().iter().map(|r| r.0).collect::<Vec<_>>(),
                }})
            }
            GateCall::Output { from, to } => {
                let (first, last) = (sample_at(*from), sample_at(*to));
                let mut mix = vec![0f32; (last - first).max(0) as usize];
                for o in self.gate.owners.values() {
                    for v in &o.voices {
                        render(v, first, &mut mix);
                    }
                }
                let Ok(sha) = evidence::put(&self.scenario.evidence, &wav(&mix, 2, true)) else {
                    return refused("store_failed");
                };
                json!({"output": {"sample_rate": RATE, "channels": 2, "first": first, "frames": mix.len(), "sha256": sha}})
            }
            GateCall::Reserved => {
                let list: Vec<Value> = reserved()
                    .into_iter()
                    .map(|(id, what, sound)| {
                        let sha = evidence::put(&self.scenario.evidence, &wav(&sound, 1, false))
                            .unwrap_or_default();
                        json!({"sound": id, "for": what, "sha256": sha})
                    })
                    .collect();
                json!({"reserved": list})
            }
        }
    }
}

/// Adds what `v` plays to `mix`, whose first sample is device sample `first`.
fn render(v: &Voices, first: i64, mix: &mut [f32]) {
    let step = FLICKS / RATE;
    for (i, out) in mix.iter_mut().enumerate() {
        let n = first + i as i64;
        if n < v.start {
            continue;
        }
        let gain = match v.stop {
            Some((at, _)) if n < at => 1.0,
            Some((at, fade)) if n < at + fade => 1.0 - (n - at + 1) as f32 / (fade + 1) as f32,
            Some(_) => break,
            None => 1.0,
        };
        let t = (n - v.start) * step;
        for s in v.strips.iter() {
            let rel = t - s.start;
            let span = s.to - s.from;
            if rel < 0 || span <= 0 || (!s.looped && rel >= span) {
                continue;
            }
            let src = s.from + if s.looped { rel % span } else { rel };
            let k = (src as i128 * s.rate as i128 / FLICKS as i128) as usize;
            if let Some(x) = s.source.get(k) {
                *out += gain * x;
            }
        }
    }
}
