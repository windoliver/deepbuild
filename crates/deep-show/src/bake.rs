//! Issue #500: the `media_bake` call (the #500 bake acceptance README): one analysis bake of one
//! asset in the evidence store, decoded in the decode worker with every channel kept. Signal kinds
//! (loudness, onsets, envelope) run on deep-canvas-media's pinned math, so the same asset and
//! analyzer re-check to an exact match: the reply's `sha256` is the readings' hash.

use deep_canvas_media::analysis::{envelope, loudness, onsets};
use deep_canvas_media::FLICKS;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::hub::Hub;

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// A reading in the reply: a finite number, or null for −∞ (a silent window).
fn reading(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        Value::Null
    }
}

/// Each channel's BS.1770 weight: from `channels` (`{azimuth, elevation}` or `"lfe"`), or, with
/// none given, by count (5: L R C Ls Rs; 6: L R C LFE Ls Rs; otherwise 1 each).
fn weights(b: &Value, channels: usize) -> Result<Vec<f64>, String> {
    let Some(list) = b.get("channels") else {
        return Ok(match channels {
            5 => vec![1.0, 1.0, 1.0, 1.41, 1.41],
            6 => vec![1.0, 1.0, 1.0, 0.0, 1.41, 1.41],
            n => vec![1.0; n],
        });
    };
    let list = list.as_array().ok_or("channels")?;
    if list.len() != channels {
        return Err(format!("channels: {} places for {channels} channels", list.len()));
    }
    list.iter()
        .map(|c| match c {
            Value::String(s) if s == "lfe" => Ok(0.0),
            Value::Object(_) => {
                let az = c.get("azimuth").and_then(Value::as_f64).ok_or("channels: azimuth")?;
                Ok(loudness::weight(az, c.get("elevation").and_then(Value::as_f64).unwrap_or(0.0)))
            }
            _ => Err("channels: a place or \"lfe\"".to_string()),
        })
        .collect()
}

impl Hub<'_> {
    pub(crate) fn bake_call(&mut self, b: &Value) -> Value {
        let bad = |what: String| json!({"code": "bad_bake", "what": what});
        let Some(asset) = b.get("asset").and_then(Value::as_str) else {
            return bad("asset".into());
        };
        let Some(kind) = b.get("kind").and_then(Value::as_str) else {
            return bad("kind".into());
        };
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
                let true_peak = if planted("sample_peak_meter") { l.sample_peak } else { l.true_peak };
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
                let hz = b.get("rate").map_or(Some(24), Value::as_i64).filter(|r| *r > 0 && FLICKS % r == 0);
                let Some(hz) = hz else {
                    return bad("rate (a whole number of Hz that divides a second's flicks)".into());
                };
                let outputs: Vec<String> = match b.get("outputs") {
                    None => vec!["rms".into(), "centroid".into()],
                    Some(o) => match o.as_array().and_then(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect()) {
                        Some(o) => o,
                        None => return bad("outputs".into()),
                    },
                };
                if let Some(o) = outputs.iter().find(|o| !["rms", "centroid"].contains(&o.as_str())) {
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
                out.extend([("rate".into(), json!(hz)), ("rows".into(), Value::Array(rows))]);
            }
            "onsets" => {
                let method = match b.get("method").and_then(Value::as_str).unwrap_or("transient") {
                    "transient" => onsets::Method::Transient,
                    "spectral_flux" => onsets::Method::SpectralFlux,
                    m => return bad(format!("method {m}")),
                };
                let threshold = b.get("threshold").and_then(Value::as_f64).unwrap_or(method.default_threshold());
                let at = |s: i64| (s as i128 * FLICKS as i128 / rate as i128) as i64;
                let found: Vec<Value> = onsets::onsets(&pcm, channels, rate, method, threshold)
                    .iter()
                    .map(|o| json!({"t": at(o.sample), "sample": o.sample, "peak": o.peak, "strength": o.strength}))
                    .collect();
                out.insert("onsets".into(), Value::Array(found));
            }
            k => return json!({"code": "unknown_bake_kind", "kind": k}),
        }
        let readings = Value::Object(out.clone()).to_string();
        let pcm_sha = hex(Sha256::digest(pcm.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>()));
        out.extend([
            ("asset".into(), json!(asset)),
            ("kind".into(), json!(kind)),
            ("analyzer".into(), json!(analyzer)),
            ("pcm_sha256".into(), json!(pcm_sha)),
            ("sample_rate".into(), json!(rate)),
            ("channels".into(), json!(channels)),
            ("sha256".into(), json!(hex(Sha256::digest(readings.as_bytes())))),
        ]);
        json!({"bake": out})
    }
}
