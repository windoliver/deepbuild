//! Issue #500: the `media_bake` call (the #500 bake acceptance README): one analysis bake of one
//! asset in the evidence store, decoded in the decode worker with every channel kept. Signal kinds
//! (loudness, onsets, envelope) run on deep-canvas-media's pinned math, so the same asset and
//! analyzer re-check to an exact match: the reply's `sha256` is the readings' hash.

use deep_canvas_media::analysis::{envelope, loudness, model, onsets};
use deep_canvas_media::FLICKS;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::evidence;
use crate::hub::Hub;

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// A reading in the reply: a finite number, or null for −∞ (a silent window).
pub(crate) fn reading(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        Value::Null
    }
}

/// Each channel's BS.1770 weight: from `channels` (`{azimuth, elevation}` or `"lfe"`), or, with
/// none given, by count (5: L R C Ls Rs; 6: L R C LFE Ls Rs; otherwise 1 each).
pub(crate) fn weights(b: &Value, channels: usize) -> Result<Vec<f64>, String> {
    let Some(list) = b.get("channels") else {
        return Ok(match channels {
            5 => vec![1.0, 1.0, 1.0, 1.41, 1.41],
            6 => vec![1.0, 1.0, 1.0, 0.0, 1.41, 1.41],
            n => vec![1.0; n],
        });
    };
    let list = list.as_array().ok_or("channels")?;
    if list.len() != channels {
        return Err(format!(
            "channels: {} places for {channels} channels",
            list.len()
        ));
    }
    list.iter()
        .map(|c| match c {
            Value::String(s) if s == "lfe" => Ok(0.0),
            Value::Object(_) => {
                let az = c
                    .get("azimuth")
                    .and_then(Value::as_f64)
                    .ok_or("channels: azimuth")?;
                Ok(loudness::weight(
                    az,
                    c.get("elevation").and_then(Value::as_f64).unwrap_or(0.0),
                ))
            }
            _ => Err("channels: a place or \"lfe\"".to_string()),
        })
        .collect()
}

/// The model kinds (#1819): each one's job kind, whose pinned tool is its analyzer.
const MODEL_KINDS: [(&str, &str); 3] = [
    ("words", "bake.words"),
    ("beats", "bake.beats"),
    ("activity", "bake.activity"),
];

impl Hub<'_> {
    pub(crate) fn bake_call(&mut self, b: &Value) -> Value {
        let bad = |what: String| json!({"code": "bad_bake", "what": what});
        let Some(kind) = b.get("kind").and_then(Value::as_str) else {
            return bad("kind".into());
        };
        if kind == "visemes" {
            return self.visemes_call(b);
        }
        let Some(asset) = b.get("asset").and_then(Value::as_str) else {
            return bad("asset".into());
        };
        if let Some((_, job)) = MODEL_KINDS.iter().find(|(k, _)| *k == kind) {
            return self.model_call(b, asset, kind, job);
        }
        let analyzer = format!("{kind}@1");
        if let Some(a) = b.get("analyzer").and_then(Value::as_str) {
            if a != analyzer {
                return json!({"code": "unknown_analyzer", "analyzer": a, "have": analyzer});
            }
        }
        let (rate, channels, pcm) = match self.pcm(asset) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let planted = self.scenario.module_planted.clone();
        let planted = |p: &str| planted.as_deref() == Some(p);
        let mut out = Map::new();
        match kind {
            "loudness" => {
                let oversample = match b.get("tp_oversample").map_or(Some(4), Value::as_u64) {
                    Some(n @ (4 | 8)) => n as u32,
                    _ => return bad("tp_oversample (4 or 8)".into()),
                };
                let w = match weights(b, channels) {
                    Ok(w) => w,
                    Err(e) => return bad(e),
                };
                let l = loudness::measure(&pcm, &w, rate, oversample);
                let true_peak = if planted("sample_peak_meter") {
                    l.sample_peak
                } else {
                    l.true_peak
                };
                let series = |v: &[f64]| Value::Array(v.iter().map(|x| reading(*x)).collect());
                out.extend([
                    ("tp_oversample".into(), json!(oversample)),
                    ("integrated".into(), reading(l.integrated)),
                    ("range".into(), reading(l.range)),
                    ("true_peak".into(), reading(true_peak)),
                    ("sample_peak".into(), reading(l.sample_peak)),
                    ("momentary_max".into(), reading(l.momentary_max)),
                    ("short_term_max".into(), reading(l.short_term_max)),
                    ("momentary".into(), series(&l.momentary)),
                    ("short_term".into(), series(&l.short_term)),
                ]);
            }
            "envelope" => {
                let hz = b
                    .get("rate")
                    .map_or(Some(24), Value::as_i64)
                    .filter(|r| *r > 0 && FLICKS % r == 0);
                let Some(hz) = hz else {
                    return bad("rate (a whole number of Hz that divides a second's flicks)".into());
                };
                let outputs: Vec<String> = match b.get("outputs") {
                    None => vec!["rms".into(), "centroid".into()],
                    Some(o) => match o
                        .as_array()
                        .and_then(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect())
                    {
                        Some(o) => o,
                        None => return bad("outputs".into()),
                    },
                };
                if let Some(o) = outputs
                    .iter()
                    .find(|o| !["rms", "centroid"].contains(&o.as_str()))
                {
                    return bad(format!("outputs: {o}"));
                }
                let rows: Vec<Value> = envelope::envelope(&pcm, channels, rate, hz)
                    .iter()
                    .enumerate()
                    .map(|(r, row)| {
                        let mut v = json!({"t": r as i64 * FLICKS / hz});
                        for o in &outputs {
                            v[o] = json!(match o.as_str() {
                                "rms" if planted("envelope_reads_peak") => row.peak,
                                "rms" => row.rms,
                                _ => row.centroid,
                            });
                        }
                        v
                    })
                    .collect();
                out.extend([
                    ("rate".into(), json!(hz)),
                    ("rows".into(), Value::Array(rows)),
                ]);
            }
            "onsets" => {
                let method = match b
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or("transient")
                {
                    "transient" => onsets::Method::Transient,
                    "spectral_flux" => onsets::Method::SpectralFlux,
                    m => return bad(format!("method {m}")),
                };
                let threshold = b
                    .get("threshold")
                    .and_then(Value::as_f64)
                    .unwrap_or(method.default_threshold());
                let at = |s: i64| (s as i128 * FLICKS as i128 / rate as i128) as i64;
                let found: Vec<Value> = onsets::onsets(&pcm, channels, rate, method, threshold)
                    .iter()
                    .map(|o| json!({"t": at(o.sample), "sample": o.sample, "peak": o.peak, "strength": o.strength}))
                    .collect();
                out.insert("onsets".into(), Value::Array(found));
            }
            k => return json!({"code": "unknown_bake_kind", "kind": k}),
        }
        let pcm_sha = hex(Sha256::digest(pcm_bytes(&pcm)));
        sealed(out, asset, kind, &analyzer, &pcm_sha, rate, channels)
    }

    /// A model kind's bake (#1819): read from the record its analyzer's job made of this asset's
    /// PCM, never by running a model here. With no record it is BLOCKED, naming the analyzer, and
    /// the PCM is kept by its hash for the job; a record of another kind, analyzer or PCM is refused.
    fn model_call(&mut self, b: &Value, asset: &str, kind: &str, job: &str) -> Value {
        let bad = |what: String| json!({"code": "bad_bake", "what": what});
        let Some(analyzer) = b.get("analyzer").and_then(Value::as_str) else {
            return bad(format!(
                "analyzer (the pinned tool of {job} that made the record, name@version)"
            ));
        };
        let (rate, channels, pcm) = match self.pcm(asset) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let pcm_sha = hex(Sha256::digest(pcm_bytes(&pcm)));
        let Some(record) = b.get("record").and_then(Value::as_str) else {
            if evidence::put(&self.scenario.evidence, &pcm_bytes(&pcm)).is_err() {
                return json!({"code": "store_failed", "what": "pcm"});
            }
            return json!({
                "state": "BLOCKED", "analyzer": analyzer, "pcm_sha256": pcm_sha, "job": job,
                "reason": format!("no record of {analyzer} for the PCM {pcm_sha}: run {job} on {analyzer} with the input pcm {pcm_sha}, sample_rate {rate} and channels {channels}"),
            });
        };
        let Some(r) = evidence::read(&self.scenario.evidence, record)
            .and_then(|x| serde_json::from_slice::<Value>(&x).ok())
        else {
            return json!({"code": "unknown_record", "record": record});
        };
        let have = r.get("analyzer").and_then(Value::as_str).unwrap_or("none");
        if have != analyzer {
            return json!({"code": "unknown_analyzer", "analyzer": analyzer, "have": have, "record": record});
        }
        if r.get("kind").and_then(Value::as_str) != Some(job) {
            return json!({"code": "record_of_another_kind", "kind": kind, "have": r.get("kind"), "record": record});
        }
        if r.get("pcm_sha256").and_then(Value::as_str) != Some(pcm_sha.as_str()) {
            return json!({"code": "record_of_another_pcm", "pcm_sha256": pcm_sha, "have": r.get("pcm_sha256"), "record": record});
        }
        let Some(frame) = r.get("frame").and_then(Value::as_i64).filter(|f| *f > 0) else {
            return json!({"code": "bad_record", "what": "frame", "record": record});
        };
        let planted = self.scenario.module_planted.clone();
        let planted = |p: &str| planted.as_deref() == Some(p);
        let mut out = Map::new();
        match kind {
            "words" => {
                let at = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64);
                let words: Option<Vec<Value>> = r.get("words").and_then(Value::as_array).and_then(|ws| {
                    ws.iter()
                        .map(|w| {
                            let phonemes: Option<Vec<Value>> = w.get("phonemes")?.as_array()?.iter()
                                .map(|p| Some(json!({"p": p.get("p")?.as_str()?, "start": at(p, "start")?, "end": at(p, "end")?})))
                                .collect();
                            Some(json!({"text": w.get("text")?.as_str()?, "start": at(w, "start")?, "end": at(w, "end")?, "phonemes": phonemes?}))
                        })
                        .collect()
                });
                let Some(words) = words else {
                    return json!({"code": "bad_record", "what": "words", "record": record});
                };
                out.insert("words".into(), Value::Array(words));
            }
            "beats" => {
                let range = match b.get("tempo_range") {
                    None => (55.0, 215.0),
                    Some(v) => match v
                        .as_array()
                        .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
                        .as_deref()
                    {
                        Some([lo, hi]) if *lo > 0.0 && lo * 2.0 <= *hi => (*lo, *hi),
                        _ => {
                            return bad(
                                "tempo_range ([low, high] BPM, high at least twice low)".into()
                            )
                        }
                    },
                };
                let Some(beats) = r
                    .get("beats")
                    .and_then(Value::as_array)
                    .and_then(|a| a.iter().map(Value::as_i64).collect::<Option<Vec<i64>>>())
                else {
                    return json!({"code": "bad_record", "what": "beats", "record": record});
                };
                let (beats, tempo) = if planted("beats_fixed_120") {
                    // The planted tracker: a beat every 0.5 s to the asset's end, whatever the record holds.
                    let end = (pcm.len() / channels) as i64 * FLICKS / rate;
                    (
                        (0..=end / (FLICKS / 2)).map(|k| k * FLICKS / 2).collect(),
                        Some(120.0),
                    )
                } else {
                    let tempo = model::tempo(&beats, FLICKS, range);
                    (beats, tempo)
                };
                out.extend([
                    ("tempo_range".into(), json!([range.0, range.1])),
                    ("tempo".into(), json!(tempo)),
                    ("beats".into(), json!(beats)),
                ]);
            }
            _ => {
                let threshold = b
                    .get("threshold")
                    .map_or(Some(0.5), Value::as_f64)
                    .filter(|t| (0.0..=1.0).contains(t));
                let Some(threshold) = threshold else {
                    return bad("threshold (a speech probability, 0 to 1)".into());
                };
                let read = |k: &str| {
                    r.get(k)
                        .and_then(Value::as_array)
                        .and_then(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<f64>>>())
                };
                let (Some(forward), Some(backward)) = (read("speech"), read("speech_reversed"))
                else {
                    return json!({"code": "bad_record", "what": "speech", "record": record});
                };
                if forward.len() != backward.len() {
                    return json!({"code": "bad_record", "what": "speech_reversed", "record": record});
                }
                let speech: Vec<f64> = if planted("activity_level_threshold") {
                    // The planted bake: a frame is speech when its RMS over every channel is at least −50 dBFS.
                    let per = ((frame as i128 * rate as i128 / FLICKS as i128) as usize).max(1)
                        * channels;
                    pcm.chunks(per)
                        .map(|c| {
                            let ms = c.iter().map(|x| f64::from(*x) * f64::from(*x)).sum::<f64>()
                                / c.len() as f64;
                            if ms >= 1e-5 {
                                1.0
                            } else {
                                0.0
                            }
                        })
                        .collect()
                } else {
                    forward
                        .iter()
                        .zip(&backward)
                        .map(|(f, b)| (f + b) / 2.0)
                        .collect()
                };
                let spans = model::spans(&speech, frame, threshold);
                out.extend([
                    ("threshold".into(), json!(threshold)),
                    (
                        "spans".into(),
                        Value::Array(
                            spans
                                .iter()
                                .map(|(s, e)| json!({"start": s, "end": e}))
                                .collect(),
                        ),
                    ),
                ]);
            }
        }
        out.insert("record".into(), json!(record));
        sealed(out, asset, kind, analyzer, &pcm_sha, rate, channels)
    }

    /// A visemes bake (#1819): each line's phonemes, from its words record, through the pinned
    /// table, each shape `lead` before its phoneme and X at each line's end.
    fn visemes_call(&mut self, b: &Value) -> Value {
        let bad = |what: String| json!({"code": "bad_bake", "what": what});
        let Some(analyzer) = b.get("analyzer").and_then(Value::as_str) else {
            return bad(
                "analyzer (the aligner that made the lines' words records, name@version)".into(),
            );
        };
        if b.get("map").is_some_and(|m| m.as_str() != Some(model::MAP)) {
            return json!({"code": "unknown_map", "map": b.get("map"), "have": model::MAP});
        }
        let Some(hz) = b
            .get("rate")
            .map_or(Some(24), Value::as_i64)
            .filter(|r| *r > 0 && FLICKS % r == 0)
        else {
            return bad(
                "rate (frames per second, a whole number that divides a second's flicks)".into(),
            );
        };
        let lead = match b.get("lead") {
            None => FLICKS / hz,
            Some(Value::String(s)) => match s.strip_suffix('f').and_then(|n| n.parse::<i64>().ok())
            {
                Some(n) => n * FLICKS / hz,
                None => return bad("lead (flicks, or frames as \"<n>f\")".into()),
            },
            Some(v) => match v.as_i64() {
                Some(n) => n,
                None => return bad("lead (flicks, or frames as \"<n>f\")".into()),
            },
        };
        let Some(lines) = b.get("lines").and_then(Value::as_array) else {
            return bad("lines ([{line, at, words: record}])".into());
        };
        let mut records = Vec::new();
        for l in lines {
            let (Some(id), Some(at), Some(rec)) = (
                l.get("line").and_then(Value::as_str),
                l.get("at").and_then(Value::as_i64),
                l.get("words").and_then(Value::as_str),
            ) else {
                return bad("lines ([{line, at, words: record}])".into());
            };
            let Some(r) = evidence::read(&self.scenario.evidence, rec)
                .and_then(|x| serde_json::from_slice::<Value>(&x).ok())
            else {
                return json!({"code": "unknown_record", "record": rec});
            };
            if r.get("kind").and_then(Value::as_str) != Some("bake.words") {
                return json!({"code": "record_of_another_kind", "kind": "words", "have": r.get("kind"), "record": rec});
            }
            let have = r.get("analyzer").and_then(Value::as_str).unwrap_or("none");
            if have != analyzer {
                return json!({"code": "unknown_analyzer", "analyzer": analyzer, "have": have, "record": rec});
            }
            records.push((id.to_string(), at, r));
        }
        let mut parsed = Vec::new();
        for (id, at, r) in &records {
            let phonemes = r.get("words").and_then(Value::as_array).and_then(|ws| {
                ws.iter()
                    .flat_map(|w| {
                        w.get("phonemes")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                    })
                    .map(|p| {
                        Some((
                            p.get("p")?.as_str()?,
                            p.get("start")?.as_i64()?,
                            p.get("end")?.as_i64()?,
                        ))
                    })
                    .collect::<Option<Vec<_>>>()
            });
            let Some(phonemes) = phonemes else {
                return json!({"code": "bad_record", "what": "words", "line": id});
            };
            parsed.push(model::Line {
                line: id,
                at: *at,
                phonemes,
            });
        }
        let lead = if self.scenario.module_planted.as_deref() == Some("visemes_no_lead") {
            0
        } else {
            lead
        };
        match model::visemes(&parsed, lead) {
            Ok(v) => json!({"bake": {
                "asset": b.get("asset"), "kind": "visemes", "analyzer": analyzer, "map": model::MAP, "rate": hz, "lead": lead,
                "visemes": v.iter().map(|v| json!({"t": v.t, "shape": v.shape.to_string(), "line": v.line})).collect::<Vec<_>>(),
            }}),
            Err(e) => json!({"code": "unknown_phoneme", "what": e}),
        }
    }
}

/// Interleaved f32 PCM as the little-endian bytes its hash is of, and a model job's `pcm` input.
fn pcm_bytes(pcm: &[f32]) -> Vec<u8> {
    pcm.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// A bake's reply: its readings, the readings' hash, and what they were read from.
fn sealed(
    mut out: Map<String, Value>,
    asset: &str,
    kind: &str,
    analyzer: &str,
    pcm_sha: &str,
    rate: i64,
    channels: usize,
) -> Value {
    let readings = Value::Object(out.clone()).to_string();
    out.extend([
        ("asset".into(), json!(asset)),
        ("kind".into(), json!(kind)),
        ("analyzer".into(), json!(analyzer)),
        ("pcm_sha256".into(), json!(pcm_sha)),
        ("sample_rate".into(), json!(rate)),
        ("channels".into(), json!(channels)),
        (
            "sha256".into(),
            json!(hex(Sha256::digest(readings.as_bytes()))),
        ),
    ]);
    json!({"bake": out})
}
