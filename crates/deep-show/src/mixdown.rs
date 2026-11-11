//! Issue #499: the media module's mix as `deep-show run` calls (the #499 mix acceptance README):
//! `media_mix` renders a media document's sound as the export does, one transport playing and
//! seeking through its segments; `handed` reads what a panel's live transport handed the device
//! gate. Both render through the same player (deep-canvas-media's `Player`), so the live mix is
//! the export's. Assets are decoded in the decode worker, as every asset is.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_media::emitter::{Cone, Distance, Model};
use deep_canvas_media::delay::{DelaySpec, PitchSpec};
use deep_canvas_media::dynamics::{CompressorSpec, LimiterSpec, Makeup};
use deep_canvas_media::mix::{
    Bus, BusSend, Curve, Emit, Gain, Mix, Place, Planted as MixPlanted, Player, Proc, ProcKind,
    Source, Strip,
};
use deep_canvas_media::{doc, eq, reverb, FLICKS};
use deep_codecs::DECODE_WORKER;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::evidence;
use crate::hub::{Hub, Planted};
use crate::refused;
use crate::spawn;

/// An open span's end: far past any play, with room for sums of flicks.
const OPEN: i64 = i64::MAX / 8;

pub enum MixCall {
    Mix {
        doc: Value,
        segments: Vec<(i64, i64, bool)>,
        /// #544: the input track the document's logic items read.
        track: Vec<Value>,
    },
    Handed {
        panel: String,
        from: i64,
        to: i64,
    },
    /// #500: one analysis bake of one asset.
    Bake(Value),
    /// #501: a media document played live on the default output for `seconds` of real time.
    Soak {
        media: Value,
        seconds: u64,
    },
}

/// One of this issue's mix calls, or `None` for a line that lacks a field it needs.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<MixCall> {
    let t = |k: &str| c.get(k)?.as_i64();
    Some(match name {
        "media_mix" => MixCall::Mix {
            doc: c.get("doc").filter(|d| d.is_object())?.clone(),
            segments: c
                .get("segments")?
                .as_array()?
                .iter()
                .map(|s| {
                    let write = s.get("write").map_or(Some(false), Value::as_bool)?;
                    Some((s.get("from")?.as_i64()?, s.get("to")?.as_i64()?, write))
                })
                .collect::<Option<_>>()?,
            track: c.get("track").map_or(Some(Vec::new()), |t| t.as_array().cloned())?,
        },
        "media_bake" => MixCall::Bake(c.get("bake").filter(|b| b.is_object())?.clone()),
        "handed" => MixCall::Handed {
            panel: c.get("panel")?.as_str()?.to_string(),
            from: t("from")?,
            to: t("to")?,
        },
        "soak" => MixCall::Soak {
            media: c.get("media").filter(|d| d.is_object())?.clone(),
            seconds: c.get("seconds")?.as_u64().filter(|s| *s > 0)?,
        },
        _ => return None,
    })
}

/// The first sample at or after `t` at `rate`.
pub fn sample_at(t: i64, rate: i64) -> i64 {
    (t as i128 * rate as i128).div_euclid(FLICKS as i128) as i64
        + i64::from((t as i128 * rate as i128).rem_euclid(FLICKS as i128) != 0)
}

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// Interleaved stereo f32 as an IEEE float WAV at `rate`.
pub fn float_wav(samples: &[f32], channels: u16, rate: i64) -> Vec<u8> {
    let data = (samples.len() * 4) as u32;
    let mut b = Vec::with_capacity(44 + data as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&(rate as u32).to_le_bytes());
    b.extend_from_slice(&(rate as u32 * 4 * channels as u32).to_le_bytes());
    b.extend_from_slice(&(4 * channels).to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

/// The mix's planted wrong programs, from the scenario's; `live` plants the live mixer's too.
pub fn planted_of(p: Option<Planted>, live: bool) -> MixPlanted {
    MixPlanted {
        restores_without_tail: p == Some(Planted::ReverbRestoresWithoutTail),
        ring_drops_oldest: p == Some(Planted::RingDropsOldest),
        holds_gain_per_block: live && p == Some(Planted::MixerHoldsGainPerBlock),
        inverse_only: p == Some(Planted::EmitterAlwaysInverse),
        cone_reversed: p == Some(Planted::ConeSignReversed),
        // #1818's live in the media module's list, planted for the whole run.
        limiter_sample_peaks: deep_canvas_media::planted("limiter_holds_sample_peaks"),
        hard_knee: deep_canvas_media::planted("compressor_hard_knee"),
        no_latency_compensation: deep_canvas_media::planted("mix_without_latency_compensation"),
        pitch_ignores_semitones: deep_canvas_media::planted("pitch_ignores_semitones"),
        sends_tap_post: deep_canvas_media::planted("send_always_post"),
        delay_empties_at_seek: deep_canvas_media::planted("delay_empties_line_at_seek"),
    }
}

/// A time field: flicks, or a time literal.
fn time(d: &Value, v: Option<&Value>) -> Result<i64, String> {
    doc::time(d, v).ok_or_else(|| format!("not a time: {}", v.cloned().unwrap_or_default()))
}

/// Keys of a channel: `[(t, value)]` and whether each is linear to the next.
fn keys(v: &Value) -> Option<Vec<(i64, &Value, bool)>> {
    let mut out: Vec<(i64, &Value, bool)> = v
        .get("keys")?
        .as_array()?
        .iter()
        .map(|k| {
            let linear = k.get("interp").and_then(Value::as_str) != Some("hold");
            Some((k.get("t")?.as_i64()?, k.get("value")?, linear))
        })
        .collect::<Option<_>>()?;
    out.sort_by_key(|k| k.0);
    Some(out)
}

fn db(v: &Value) -> Option<f64> {
    match v {
        Value::String(s) if s == "-inf" => Some(f64::NEG_INFINITY),
        v => v.as_f64(),
    }
}

/// A channel's value at t: keys linear or held, held before the first and after the last.
fn at_keys(k: &[(i64, f64, bool)], t: i64) -> f64 {
    let i = k.partition_point(|x| x.0 <= t);
    match (i.checked_sub(1).map(|j| k[j]), k.get(i)) {
        (None, Some(b)) => b.1,
        (Some(a), Some(b)) if a.2 => a.1 + (b.1 - a.1) * (t - a.0) as f64 / (b.0 - a.0).max(1) as f64,
        (Some(a), _) => a.1,
        (None, None) => 0.0,
    }
}

fn vec3(v: Option<&Value>) -> Option<[f64; 3]> {
    let a = v?.as_array()?;
    Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?, a.get(2)?.as_f64()?])
}

impl Hub<'_> {
    /// An asset from the evidence store, decoded in the decode worker, for the mix: interleaved
    /// f32 frames of its first two channels' worth.
    pub(crate) fn source(&mut self, sha: &str) -> Result<Arc<Source>, Value> {
        if let Some(s) = self.gate.sources.get(sha) {
            return Ok(s.clone());
        }
        let (rate, channels, samples) = self.pcm(sha)?;
        let s = Arc::new(Source {
            rate,
            channels: channels.clamp(1, 2),
            samples,
            loop_region: None,
        });
        self.gate.sources.insert(sha.to_string(), s.clone());
        Ok(s)
    }

    /// An asset from the evidence store, decoded in the decode worker: its rate, its channel
    /// count and its interleaved f32 frames, every channel kept.
    pub(crate) fn pcm(&mut self, sha: &str) -> Result<(i64, usize, Vec<f32>), Value> {
        if sha.len() < 3 || evidence::read(&self.scenario.evidence, sha).is_none() {
            return Err(json!({"code": "unknown_asset", "asset": sha}));
        }
        let path = self.scenario.evidence.join(&sha[..2]).join(&sha[2..]);
        self.pcm_at(&path, sha)
    }

    /// The sound of the file at `path`, decoded in the decode worker, as [`Hub::pcm`] gives an
    /// asset's; `sha` names it in a refusal.
    pub(crate) fn pcm_at(&mut self, path: &std::path::Path, sha: &str) -> Result<(i64, usize, Vec<f32>), Value> {
        let out = std::env::temp_dir().join(format!("deep-mix-{}-{}", std::process::id(), &sha[..sha.len().min(16)]));
        let (reply, _) = self.media_job(DECODE_WORKER, json!({"op": "decode", "path": path, "out": out, "video_frames": 0}));
        let stream = reply["decoded"]["streams"]
            .as_array()
            .and_then(|s| s.iter().find(|s| s["type"] == "audio"))
            .cloned();
        let result = (|| {
            let s = stream.ok_or_else(|| json!({"code": "not_audio", "asset": sha}))?;
            let bytes = std::fs::read(out.join(s["file"].as_str().unwrap_or_default()))
                .map_err(|_| refused("unreadable"))?;
            let samples = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
            Ok((
                s["sample_rate"].as_i64().unwrap_or(48_000).max(1),
                s["channels"].as_u64().unwrap_or(1).max(1) as usize,
                samples,
            ))
        })();
        let _ = std::fs::remove_dir_all(&out);
        result
    }

    /// A media document's mix: its strips, buses, processors and emitters.
    pub(crate) fn mix_of(&mut self, d: &Value) -> Result<Mix, Value> {
        self.mix_with(d).map(|(m, _)| m)
    }

    /// A media document's mix, and what #500 adds to the reply: its spawns' `voices` and its
    /// sound `cues`.
    fn mix_with(&mut self, d: &Value) -> Result<(Mix, Map<String, Value>), Value> {
        let bad = |what: String| json!({"code": "bad_media", "what": what});
        let rate = d.pointer("/transport/sample_rate").and_then(Value::as_i64).unwrap_or(48_000);
        if rate <= 0 || FLICKS % rate != 0 {
            return Err(json!({"code": "bad_rate", "sample_rate": rate}));
        }
        let span = match d.pointer("/transport/span") {
            // An open span has no end: the mix plays on as with no span (Transport).
            None => None,
            Some(Value::String(s)) if s == "open" => None,
            v => Some(time(d, v).map_err(bad)?),
        };
        let empty = Map::new();
        let obj = |k: &str| d.get(k).and_then(Value::as_object).unwrap_or(&empty);
        // #502: a script's lines with recordings play on the bus `narration`.
        let script = self.script_of(d);
        if let Some(problem) = script.as_ref().and_then(|s| s.problem.clone()) {
            return Err(problem);
        }
        // Buses, the master last unless the document names it.
        let mut ids: Vec<String> = obj("buses").keys().cloned().collect();
        if script.as_ref().is_some_and(|s| s.lines.iter().any(|l| l.take.is_some())) && !ids.iter().any(|i| i == "narration") {
            ids.push("narration".into());
        }
        if !ids.iter().any(|i| i == "master") {
            ids.push("master".into());
        }
        let index = |id: &str| ids.iter().position(|b| b == id);
        let procs = obj("processors");
        let mut buses = Vec::new();
        for id in &ids {
            let b = obj("buses").get(id).cloned().unwrap_or(json!({}));
            let out = match b.get("out").and_then(Value::as_str) {
                _ if id == "master" => None,
                None | Some("master") => index("master"),
                Some(o) => Some(index(o).ok_or_else(|| bad(format!("bus {id} feeds {o}, which isn't a bus")))?),
            };
            let mut processors = Vec::new();
            for p in b.get("processors").and_then(Value::as_array).into_iter().flatten() {
                let pid = p.as_str().ok_or_else(|| bad(format!("bus {id}: a processor ID")))?;
                let pv = procs.get(pid).ok_or_else(|| bad(format!("bus {id}: no processor {pid}")))?;
                processors.push(processor(pid, pv, &index).map_err(bad)?);
            }
            // #1818: sends, each tapped pre or post (post by default).
            let mut sends = Vec::new();
            for (j, sv) in b.get("sends").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let to = sv.get("to").and_then(Value::as_str).ok_or_else(|| bad(format!("bus {id}: send {j}'s to")))?;
                let pre = match sv.get("tap").and_then(Value::as_str) {
                    None | Some("post") => false,
                    Some("pre") => true,
                    Some(t) => return Err(bad(format!("bus {id}: send {j}'s tap {t} isn't pre or post"))),
                };
                sends.push(BusSend {
                    id: format!("{id}/sends/{j}"),
                    to: index(to).ok_or_else(|| bad(format!("bus {id} sends to {to}, which isn't a bus")))?,
                    gain_db: sv.get("gain").and_then(Value::as_f64).unwrap_or(0.0),
                    pre,
                });
            }
            buses.push(Bus {
                id: id.clone(),
                gain_db: b.get("gain").and_then(Value::as_f64).unwrap_or(0.0),
                pan: b.get("pan").and_then(Value::as_f64).unwrap_or(0.0),
                mute: b.get("mute").and_then(Value::as_bool).unwrap_or(false),
                processors,
                out,
                sends,
                duck: None,
            });
        }
        // #502: each ducking entry's law on its target bus, keyed by the narration's speech
        // spans or by spans the document carries.
        let mut ducked: BTreeMap<usize, &String> = BTreeMap::new();
        for (did, e) in obj("ducking") {
            let target = e.get("target").and_then(Value::as_str).unwrap_or_default();
            let Some(b) = index(target) else {
                return Err(json!({"code": "ducking.no_bus", "ducking": did, "target": target,
                    "what": format!("ducking `{did}` targets `{target}`, which isn't a bus")}));
            };
            if let Some(first) = ducked.insert(b, did) {
                return Err(json!({"code": "ducking.target_twice", "ducking": [first, did], "target": target,
                    "what": format!("ducking `{first}` and `{did}` both target the bus `{target}`")}));
            }
            let spans: Vec<(i64, i64)> = match e.get("key") {
                Some(Value::String(k)) if k == "narration" => script.as_ref().map(|s| s.spans()).unwrap_or_default(),
                key => key
                    .and_then(|k| k.get("spans"))
                    .and_then(Value::as_array)
                    .and_then(|a| a.iter().map(|s| Some((time(d, s.get("start")).ok()?, time(d, s.get("end")).ok()?))).collect())
                    .ok_or_else(|| bad(format!("ducking {did}: key is `narration` or {{spans: [{{start, end}}]}}")))?,
            };
            let seconds = |k: &str, default: f64| (e.get(k).and_then(Value::as_f64).unwrap_or(default) * FLICKS as f64).round() as i64;
            buses[b].duck = Some(deep_canvas_media::duck::Duck::new(
                &spans,
                e.get("depth").and_then(Value::as_f64).unwrap_or(-12.0),
                seconds("attack", 0.2),
                seconds("hold", 0.3),
                seconds("release", 0.8),
                seconds("merge_gap", 0.8),
            ));
        }
        // Emitters, by the strip they play.
        let mut emits: BTreeMap<String, Emit> = BTreeMap::new();
        for (eid, e) in obj("emitters") {
            let strip = e.pointer("/src/strip").and_then(Value::as_str).ok_or_else(|| bad(format!("emitter {eid}: src.strip")))?;
            emits.insert(strip.to_string(), emitter(d, eid, e).map_err(bad)?);
        }
        let mut strips = Vec::new();
        for (sid, s) in obj("strips") {
            let Some(sha) = doc::strip_asset(s) else {
                return Err(bad(format!("strip {sid}: src.asset")));
            };
            let source = self.source(sha)?;
            let start = time(d, s.get("start")).map_err(bad)?;
            let r#in = time(d, s.get("in")).map_err(bad)?;
            let out = match s.get("out") {
                None => source.duration(),
                v => time(d, v).map_err(bad)?,
            };
            let rate_v = doc::rate(s.get("rate")).ok_or_else(|| bad(format!("strip {sid}: rate")))?;
            let looped = s.get("loop").and_then(Value::as_bool).unwrap_or(false);
            // With no transport span a looping strip plays on for as long as the play lasts.
            let end = span.unwrap_or(if looped { OPEN } else { start + (out - r#in).max(0) });
            let span_v = match s.get("span") {
                None => Strip::auto_span(start, r#in, out, rate_v, looped, end),
                v => time(d, v).map_err(bad)?,
            };
            let gain = match s.get("gain") {
                None => Gain::Db(0.0),
                Some(g @ Value::Object(_)) => Gain::Keys(
                    keys(g)
                        .ok_or_else(|| bad(format!("strip {sid}: gain keys")))?
                        .into_iter()
                        .map(|(t, v, l)| Some((t, db(v)?, l)))
                        .collect::<Option<_>>()
                        .ok_or_else(|| bad(format!("strip {sid}: a gain key's dB")))?,
                ),
                Some(v) => Gain::Db(db(v).ok_or_else(|| bad(format!("strip {sid}: gain")))?),
            };
            let disabled = match s.get("enabled") {
                None | Some(Value::Bool(true)) => Vec::new(),
                Some(Value::Bool(false)) => vec![(i64::MIN, i64::MAX)],
                Some(k) => {
                    let k = keys(k).ok_or_else(|| bad(format!("strip {sid}: enabled keys")))?;
                    let mut spans = Vec::new();
                    let mut off: Option<i64> = None;
                    for (i, (t, v, _)) in k.iter().enumerate() {
                        let on = v.as_bool().ok_or_else(|| bad(format!("strip {sid}: enabled")))?;
                        let at = if i == 0 { i64::MIN } else { *t };
                        match (on, off) {
                            (false, None) => off = Some(at),
                            (true, Some(a)) => {
                                spans.push((a, at));
                                off = None;
                            }
                            _ => {}
                        }
                    }
                    if let Some(a) = off {
                        spans.push((a, i64::MAX));
                    }
                    spans
                }
            };
            let fade = |k: &str| -> Option<deep_canvas_media::mix::Fade> {
                let f = s.get(k)?;
                Some(deep_canvas_media::mix::Fade {
                    length: f.get("length")?.as_i64()?,
                    curve: match f.get("curve").and_then(Value::as_str) {
                        Some("linear") => Curve::Linear,
                        Some("exp") => Curve::Exp,
                        _ => Curve::EqualPower,
                    },
                })
            };
            let bus = match s.get("bus").and_then(Value::as_str) {
                None => index("master").unwrap_or(0),
                Some(b) => index(b).ok_or_else(|| bad(format!("strip {sid}: no bus {b}")))?,
            };
            let mut strip = Strip {
                id: sid.clone(),
                source,
                start,
                r#in,
                out,
                rate: rate_v,
                gain,
                pan: s.get("pan").and_then(Value::as_f64).unwrap_or(0.0),
                fade_in: fade("fade_in"),
                fade_out: fade("fade_out"),
                looped,
                span: span_v,
                bus,
                disabled,
                emitter: emits.remove(sid),
            };
            if let Some(at) = spawn::aligned_start(d, sid, s, &strip).map_err(bad)? {
                strip.start = at;
            }
            strips.push(strip);
        }
        if let Some(s) = &script {
            strips.extend(self.narration_strips(s, index("narration").or(index("master")).unwrap_or(0))?);
        }
        let mut extra = Map::new();
        if d.get("cues").is_some() {
            extra.insert("cues".into(), Value::Object(spawn::cues(d, &mut strips)));
        }
        if d.get("spawns").is_some() {
            let (voices, report) = self.spawned(d, index("master").unwrap_or(0))?;
            strips.extend(voices);
            extra.insert("voices".into(), Value::Array(report));
        }
        let mix = Mix::new(rate, strips, buses).map_err(|b| json!({"code": "bus_cycle", "bus": b}))?;
        Ok((mix, extra))
    }

    pub fn mix_call(&mut self, call: &MixCall) -> Value {
        match call {
            MixCall::Mix { doc, segments, track } => {
                let mut doc = doc.clone();
                if let Err(i) = self.inline_occurrences(&mut doc, track) {
                    return json!({"code": i.code, "issues": [i.to_json()]});
                }
                let (mix, extra) = match self.mix_with(&doc) {
                    Ok((m, extra)) => (Arc::new(m), extra),
                    Err(e) => return e,
                };
                let rate = mix.rate;
                let mut player = Player::new(mix, planted_of(self.scenario.planted, false));
                let mut at = 0i64;
                let mut out = Vec::new();
                for (from, to, write) in segments {
                    let (first, last) = (sample_at(*from, rate), sample_at(*to, rate));
                    let seek = if first != at {
                        let s = player.seek(first);
                        let m: Map<String, Value> = s
                            .into_iter()
                            .map(|(id, s)| (id, json!({"restored": s.restored, "rendered_from": s.rendered_from})))
                            .collect();
                        Value::Object(m)
                    } else {
                        Value::Null
                    };
                    player.take_taps();
                    // #501: the planted mixer whose Linux build is one 16-bit step off.
                    let step = if cfg!(target_os = "linux") && self.scenario.planted == Some(Planted::MixerLinuxOneStep) {
                        1.0 / 32_768.0
                    } else {
                        0.0
                    };
                    let (sha, pcm) = read(&mut player, (last - first).max(0), *write, step);
                    let mut seg = json!({"from": from, "to": to, "first": first, "frames": (last - first).max(0),
                        "channels": 2, "sha256": sha, "seek": seek,
                        "taps": player.take_taps().into_iter().map(|(k, v)| (k, json!(v))).collect::<Map<String, Value>>()});
                    if let Some(pcm) = pcm {
                        match evidence::put(&self.scenario.evidence, &float_wav(&pcm, 2, rate)) {
                            Ok(w) => seg["wav"] = json!(w),
                            Err(_) => return refused("store_failed"),
                        }
                    }
                    out.push(seg);
                    at = last;
                }
                let processors: Map<String, Value> = player
                    .reports()
                    .into_iter()
                    .map(|r| {
                        (r.id.clone(), json!({"kind": r.kind, "tail": r.tail, "latency": r.latency,
                            "ring": {"budget": r.budget, "bytes": r.bytes, "peak_bytes": r.peak, "spacing": r.spacing,
                                     "checkpoints": r.checkpoints.iter().map(|(t, b)| json!({"t": t, "bytes": b})).collect::<Vec<_>>()}}))
                    })
                    .collect();
                let mut reply = json!({"sample_rate": rate, "channels": 2, "segments": out, "processors": processors});
                reply.as_object_mut().into_iter().for_each(|r| r.extend(extra.clone()));
                json!({"mix": reply})
            }
            MixCall::Bake(b) => self.bake_call(b),
            MixCall::Handed { panel, from, to } => {
                let now = self.now;
                let Some(live) = self.gate.live_of(panel, now) else {
                    return refused("not_playing");
                };
                let rate = live.rate;
                let (first, last) = (sample_at(*from, rate), sample_at(*to, rate));
                if first < 0 || last > live.handed_frames() {
                    return json!({"code": "not_handed", "handed_to": live.handed_frames()});
                }
                let pcm = live.handed[2 * first as usize..2 * last as usize].to_vec();
                let sha = hex(Sha256::digest(pcm.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>()));
                let Ok(w) = evidence::put(&self.scenario.evidence, &float_wav(&pcm, 2, rate)) else {
                    return refused("store_failed");
                };
                json!({"handed": {"sample_rate": rate, "channels": 2, "first": first, "frames": last - first,
                    "sha256": sha, "wav": w}})
            }
            MixCall::Soak { media, seconds } => match self.mix_of(media) {
                Ok(m) => crate::device::soak(Player::new(Arc::new(m), planted_of(self.scenario.planted, true)), *seconds),
                Err(e) => e,
            },
        }
    }
}

/// Reads `frames` from `player`, each sample `step` higher: the SHA-256 of the interleaved f32le
/// samples, and the samples themselves when `keep`.
fn read(player: &mut Player, frames: i64, keep: bool, step: f32) -> (String, Option<Vec<f32>>) {
    let mut h = Sha256::new();
    let mut kept = keep.then(Vec::new);
    let mut buf = vec![0f32; 2 * 4096];
    let mut left = frames as usize;
    while left > 0 {
        let n = left.min(4096);
        player.read(&mut buf[..2 * n]);
        for x in &mut buf[..2 * n] {
            *x += step;
        }
        for x in &buf[..2 * n] {
            h.update(x.to_le_bytes());
        }
        if let Some(k) = &mut kept {
            k.extend_from_slice(&buf[..2 * n]);
        }
        left -= n;
    }
    (hex(h.finalize()), kept)
}

fn processor(id: &str, p: &Value, bus: &dyn Fn(&str) -> Option<usize>) -> Result<Proc, String> {
    let n = |k: &str| p.get(k).and_then(Value::as_f64);
    let kind = match p.get("kind").and_then(Value::as_str) {
        Some("eq") => ProcKind::Eq(
            p.get("bands")
                .and_then(Value::as_array)
                .ok_or(format!("processor {id}: bands"))?
                .iter()
                .map(|b| {
                    Some(eq::Band {
                        kind: eq::Type::read(b.get("type")?.as_str()?)?,
                        freq: b.get("freq").and_then(Value::as_f64).unwrap_or(350.0),
                        q: b.get("q").and_then(Value::as_f64).unwrap_or(1.0),
                        gain: b.get("gain").and_then(Value::as_f64).unwrap_or(0.0),
                    })
                })
                .collect::<Option<_>>()
                .ok_or(format!("processor {id}: a band"))?,
        ),
        Some("reverb") => {
            let ir = p.get("ir").ok_or(format!("processor {id}: ir"))?;
            let n = |k: &str, d: f64| ir.get(k).and_then(Value::as_f64).unwrap_or(d);
            ProcKind::Reverb(reverb::Spec {
                decay: n("decay", 2.0),
                size: n("size", 0.5),
                damping: n("damping", 0.5),
                mix: p.get("mix").and_then(Value::as_f64).unwrap_or(0.3),
            })
        }
        // #1818: the compressor, limiter, delay and pitch, at the Processor row's defaults.
        Some("compressor") => {
            let d = CompressorSpec::default();
            let makeup = match p.get("makeup") {
                None => d.makeup,
                Some(Value::String(a)) if a == "auto" => Makeup::Auto,
                Some(v) => Makeup::Db(v.as_f64().ok_or(format!("processor {id}: makeup is dB or auto"))?),
            };
            let key = match p.get("key").and_then(Value::as_str) {
                None => None,
                Some(k) => Some(bus(k).ok_or(format!("processor {id}: key {k} isn't a bus"))?),
            };
            ProcKind::Compressor(
                CompressorSpec {
                    threshold: n("threshold").unwrap_or(d.threshold),
                    knee: n("knee").unwrap_or(d.knee).max(0.0),
                    ratio: n("ratio").unwrap_or(d.ratio).max(1.0),
                    attack: n("attack").unwrap_or(d.attack).max(0.0),
                    release: n("release").unwrap_or(d.release).max(0.0),
                    makeup,
                },
                key,
            )
        }
        Some("limiter") => {
            let d = LimiterSpec::default();
            let oversample = match p.get("oversample").and_then(Value::as_u64) {
                None => d.oversample,
                Some(o @ (4 | 8)) => o as u32,
                Some(o) => return Err(format!("processor {id}: oversample {o} isn't 4 or 8")),
            };
            ProcKind::Limiter(LimiterSpec {
                ceiling: n("ceiling").unwrap_or(d.ceiling),
                lookahead: n("lookahead").unwrap_or(d.lookahead).max(0.0),
                release: n("release").unwrap_or(d.release).max(0.0),
                oversample,
            })
        }
        Some("delay") => {
            let time = n("time").ok_or(format!("processor {id}: time"))?;
            let feedback = n("feedback").unwrap_or(0.0);
            if !(0.0..=2.0).contains(&time) || !(0.0..1.0).contains(&feedback) {
                return Err(format!("processor {id}: time is 0 to 2 s and feedback in [0, 1)"));
            }
            ProcKind::Delay(DelaySpec { time, feedback, mix: n("mix").unwrap_or(1.0).clamp(0.0, 1.0) })
        }
        Some("pitch") => ProcKind::Pitch(PitchSpec {
            semitones: n("semitones").unwrap_or(0.0),
            window: n("window").unwrap_or(0.1),
        }),
        k => return Err(format!("processor {id}: kind {k:?} isn't built")),
    };
    Ok(Proc {
        id: id.to_string(),
        kind,
        every: p.get("checkpoint_every").and_then(Value::as_f64).map_or(1, |s| (s.round() as i64).max(1)),
        budget: p.get("byte_budget").and_then(Value::as_u64).map(|b| b as usize),
    })
}

/// The listener (the camera) and its right, forward × up.
pub(crate) fn listener(d: &Value) -> ([f64; 3], [f64; 3]) {
    let cam = vec3(d.pointer("/scene/camera/position")).unwrap_or([0.0; 3]);
    let fwd = vec3(d.pointer("/scene/camera/forward")).unwrap_or([0.0, 0.0, -1.0]);
    let r = [-fwd[2], 0.0, fwd[0]];
    let rl = deep_canvas::ops::sqrt(r[0] * r[0] + r[2] * r[2]);
    (cam, if rl > 0.0 { [r[0] / rl, 0.0, r[2] / rl] } else { [1.0, 0.0, 0.0] })
}

/// An emitter: its item's place in the document's scene at t, heard by the camera.
fn emitter(d: &Value, id: &str, e: &Value) -> Result<Emit, String> {
    let item = e.get("item").and_then(Value::as_str).ok_or(format!("emitter {id}: item"))?;
    let it = d.pointer(&format!("/scene/items/{item}")).ok_or(format!("emitter {id}: no scene item {item}"))?;
    let pos = vec3(it.get("position")).ok_or(format!("emitter {id}: position"))?;
    let yaw: Vec<(i64, f64, bool)> = match it.get("yaw") {
        None => vec![(0, 0.0, false)],
        Some(Value::Number(n)) => vec![(0, n.as_f64().unwrap_or(0.0), false)],
        Some(k) => keys(k)
            .ok_or(format!("emitter {id}: yaw keys"))?
            .into_iter()
            .map(|(t, v, l)| Some((t, v.as_f64()?, l)))
            .collect::<Option<_>>()
            .ok_or(format!("emitter {id}: a yaw key"))?,
    };
    let (cam, right) = listener(d);
    let dist = e.get("distance");
    let f = |o: Option<&Value>, k: &str, dflt: f64| o.and_then(|o| o.get(k)).and_then(Value::as_f64).unwrap_or(dflt);
    let model = match dist.and_then(|o| o.get("model")).and_then(Value::as_str) {
        None | Some("inverse") => Model::Inverse,
        Some("linear") => Model::Linear,
        Some("exponential") => Model::Exponential,
        Some(m) => return Err(format!("emitter {id}: model {m}")),
    };
    let cone = e.get("cone");
    Ok(Emit {
        id: id.to_string(),
        distance: Distance {
            model,
            reference: f(dist, "ref", 1.0),
            max: f(dist, "max", 10_000.0),
            rolloff: f(dist, "rolloff", 1.0),
        },
        cone: Cone {
            inner: f(cone, "inner", 360.0),
            outer: f(cone, "outer", 360.0),
            outer_gain: f(cone, "outer_gain", 0.0),
        },
        place: Arc::new(move |t| {
            let a = deep_canvas::ops::rad(at_keys(&yaw, t));
            Place {
                source: pos,
                forward: [deep_canvas::ops::sin(a), 0.0, deep_canvas::ops::cos(a)],
                listener: cam,
                right,
            }
        }),
    })
}
