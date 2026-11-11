//! Issue #935: audio.gen (canvas primitives: Check input: asset kinds: generated sound). A
//! document's `sounds` declares each generated or imported result: a `music` bed with its tempo,
//! meter, loop region, beats record, stems and bus, or a `sound` with its takes per level. The
//! `media_gen` call holds one to its rules on its decoded PCM, read through deep-canvas-media's
//! pinned analysis and never from what a model reported; at check, a strip or spawn template that
//! names an asset of an entry whose audio.gen doesn't read PASS is refused, naming the asset.

use std::collections::btree_map::{BTreeMap, Entry};

use deep_canvas::document::Issue;
use deep_canvas_media::analysis::{generated as measure, loudness};
use deep_canvas_media::doc;
use serde_json::{json, Map, Value};

use crate::bake::{reading, weights};
use crate::hub::Hub;

/// The pinned beat tracker whose `bake.beats` record a bed's tempo is read from.
const TRACKER: &str = "beat-this@1.1.0";
/// The design's numbers: proposals to calibrate, which a brief may only tighten, never a document.
const TEMPO_BPM: f64 = 0.5;
const LEVEL_LU: f64 = 1.0;
const CEILING_DBTP: f64 = -1.0;
const RESIDUAL_DBFS: f64 = -60.0;
const DURATION_SPREAD: f64 = 0.2;
const SAME_DB: f64 = 0.5;
const ONSET_LIMIT_S: f64 = 0.010;

/// One sound's audio.gen as it runs: its readings, the rules it fails and the inputs it lacks.
#[derive(Default)]
struct Run {
    readings: Map<String, Value>,
    issues: Vec<Value>,
    blocked: Vec<Value>,
}

impl Run {
    fn fail(&mut self, code: &str, path: String, actual: Value, what: String) {
        self.issues
            .push(json!({"code": code, "path": path, "actual": actual, "what": what}));
    }

    /// A file's loudness and leading silence, held to `target` (LUFS) and the ceiling; its readings.
    fn levels(
        &mut self,
        path: &str,
        pcm: &[f32],
        rate: i64,
        channels: usize,
        target: Option<f64>,
    ) -> Map<String, Value> {
        let l = loudness::measure(
            pcm,
            &weights(&Value::Null, channels).unwrap_or_default(),
            rate,
            8,
        );
        let level = measure::level(&l, rate);
        let lead = measure::lead(pcm, channels);
        let lead_s = lead as f64 / rate as f64;
        if let Some(t) = target {
            // Silence reads −∞, never within the tolerance.
            let within = (level - t).abs() <= LEVEL_LU;
            if !within {
                self.fail(
                    "audio.gen.level",
                    path.into(),
                    json!({"integrated": reading(level), "target": t, "tolerance": LEVEL_LU}),
                    format!(
                        "{path} reads {} LUFS, outside ±{LEVEL_LU} LU of its target {t} LUFS",
                        show(level)
                    ),
                );
            }
        }
        if l.true_peak > CEILING_DBTP {
            self.fail(
                "audio.gen.peak",
                path.into(),
                json!({"true_peak": reading(l.true_peak), "ceiling": CEILING_DBTP}),
                format!(
                    "{path} peaks at {} dBTP, over the {CEILING_DBTP} dBTP ceiling",
                    show(l.true_peak)
                ),
            );
        }
        if lead_s > ONSET_LIMIT_S {
            self.fail("audio.gen.onset", path.into(), json!({"lead": lead_s, "sample": lead, "limit": ONSET_LIMIT_S}),
                format!("{path} is silent for its first {:.1} ms (its first sample at −60 dBFS is {lead}), past the {} ms onset limit", lead_s * 1000.0, ONSET_LIMIT_S * 1000.0));
        }
        let mut out = Map::new();
        out.insert("integrated".into(), reading(level));
        out.insert("target".into(), json!(target));
        out.insert("true_peak".into(), reading(l.true_peak));
        out.insert("lead".into(), json!(lead_s));
        out.insert(
            "duration".into(),
            json!((pcm.len() / channels.max(1)) as f64 / rate as f64),
        );
        out
    }
}

/// A reading in a message: a number to two places, or −∞.
fn show(x: f64) -> String {
    if x.is_finite() {
        format!("{x:.2}")
    } else {
        "−∞".into()
    }
}

fn bad(sound: &str, what: impl Into<String>) -> Value {
    json!({"code": "bad_sound", "sound": sound, "what": what.into()})
}

/// The assets an entry of `sounds` declares: a bed and its stems, or every take.
fn declared(s: &Value) -> Vec<&str> {
    let mut out: Vec<&str> = s.get("asset").and_then(Value::as_str).into_iter().collect();
    out.extend(
        s.get("stems")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(_, a)| a.as_str()),
    );
    for level in s
        .get("variants")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        out.extend(
            level
                .get("takes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        );
    }
    out
}

/// The places in a document that name an asset to play: each strip, each `media.strip@1` item
/// and each spawn template, as (the ID an issue names, the path of its `src`, the asset).
fn named(d: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let empty = Map::new();
    let obj = |k: &str| d.get(k).and_then(Value::as_object).unwrap_or(&empty);
    for (sid, s) in obj("strips") {
        out.extend(
            doc::strip_asset(s).map(|a| (sid.clone(), format!("strips/{sid}/src"), a.to_string())),
        );
    }
    for (iid, item) in obj("items") {
        if item["kind"] == "media.strip@1" {
            out.extend(doc::strip_asset(&item["params"]).map(|a| {
                (
                    iid.clone(),
                    format!("items/{iid}/params/src"),
                    a.to_string(),
                )
            }));
        }
    }
    for (pid, sp) in obj("spawns") {
        let templates: Vec<(String, &Value)> = match sp.get("play") {
            Some(Value::Array(a)) => a
                .iter()
                .enumerate()
                .map(|(k, e)| {
                    (
                        format!("spawns/{pid}/play/{k}/template/src"),
                        &e["template"],
                    )
                })
                .collect(),
            Some(t) => vec![(format!("spawns/{pid}/play/src"), t)],
            None => Vec::new(),
        };
        for (path, t) in templates {
            out.extend(doc::strip_asset(t).map(|a| (pid.clone(), path, a.to_string())));
        }
    }
    out
}

impl Hub<'_> {
    /// `media_gen {doc, sound}`: the sound's audio.gen, `{gen: {sound, state, readings, issues, blocked}}`.
    pub(crate) fn gen_call(&mut self, d: &Value, sound: &str) -> Value {
        match self.audio_gen(d, sound) {
            Ok(g) => json!({"gen": g}),
            Err(e) => e,
        }
    }

    /// The entry `id` of the document's `sounds` held to audio.gen: FAIL when a rule fails, with
    /// every issue; otherwise BLOCKED when an input is missing; otherwise PASS. A declaration it
    /// can't read, or an asset or record it can't open, is refused.
    pub(crate) fn audio_gen(&mut self, d: &Value, id: &str) -> Result<Value, Value> {
        let Some(s) = d.get("sounds").and_then(|m| m.get(id)) else {
            return Err(json!({"code": "unknown_sound", "sound": id}));
        };
        let mut run = Run::default();
        match s.get("kind").and_then(Value::as_str) {
            Some("music") => self.music(d, id, s, &mut run)?,
            Some("sound") => self.takes(id, s, &mut run)?,
            _ => return Err(bad(id, "kind (music or sound)")),
        }
        let state = if !run.issues.is_empty() {
            "FAIL"
        } else if !run.blocked.is_empty() {
            "BLOCKED"
        } else {
            "PASS"
        };
        Ok(
            json!({"sound": id, "state": state, "readings": run.readings, "issues": run.issues, "blocked": run.blocked}),
        )
    }

    fn music(&mut self, d: &Value, id: &str, s: &Value, run: &mut Run) -> Result<(), Value> {
        let base = format!("sounds/{id}");
        let asset = s
            .get("asset")
            .and_then(Value::as_str)
            .ok_or_else(|| bad(id, "asset"))?;
        let tempo = s
            .get("tempo")
            .and_then(Value::as_f64)
            .filter(|t| *t > 0.0)
            .ok_or_else(|| bad(id, "tempo (BPM)"))?;
        let beats = s
            .get("meter")
            .and_then(Value::as_str)
            .and_then(|m| m.split_once('/'))
            .and_then(|(n, d)| Some((n.trim().parse::<u32>().ok()?, d.trim().parse::<u32>().ok()?)))
            .filter(|(n, d)| *n > 0 && *d > 0)
            .map(|(n, _)| n)
            .ok_or_else(|| bad(id, "meter (\"n/d\")"))?;
        let at = |k: &str| {
            s.pointer(&format!("/loop/{k}"))
                .and_then(Value::as_u64)
                .map(|v| v as usize)
        };
        let (start, end) = at("start")
            .zip(at("end"))
            .filter(|(a, b)| a < b)
            .ok_or_else(|| bad(id, "loop ({start, end} in samples, start before end)"))?;
        let bus = s.get("bus").and_then(Value::as_str).unwrap_or("master");
        let (rate, channels, pcm) = self.pcm(asset)?;
        let frames = pcm.len() / channels;
        if end > frames {
            return Err(bad(
                id,
                format!("loop: end {end} is past the asset's {frames} samples"),
            ));
        }

        // Tempo, from the pinned tracker's record of this PCM, read as media_bake reads one.
        let mut ask = json!({"asset": asset, "kind": "beats", "analyzer": TRACKER});
        match s.get("beats") {
            None => {
                let blocked = self.bake_call(&ask);
                run.blocked.push(json!({"input": "beats", "path": format!("{base}/beats"), "analyzer": TRACKER,
                    "pcm_sha256": blocked.get("pcm_sha256"), "job": "bake.beats", "reason": blocked.get("reason").cloned().unwrap_or_else(|| blocked.clone())}));
            }
            Some(record) => {
                ask["record"] = record.clone();
                let reply = self.bake_call(&ask);
                let Some(bake) = reply.get("bake") else {
                    return Err(reply);
                };
                let measured = bake.get("tempo").and_then(Value::as_f64);
                run.readings.insert("tempo".into(), json!(measured));
                if measured.is_none_or(|m| (m - tempo).abs() > TEMPO_BPM) {
                    let said = measured.map_or("no tempo".to_string(), |m| format!("{m:.2} BPM"));
                    run.fail("audio.gen.tempo", format!("{base}/tempo"), json!({"measured": measured, "declared": tempo, "tolerance": TEMPO_BPM}),
                        format!("the pinned beat tracker reads {said}, and the bed declares {tempo} BPM (±{TEMPO_BPM})"));
                }
            }
        }

        // Bars: the loop region against whole bars of the declared tempo and meter.
        let b = measure::bars((end - start) as i64, rate, tempo, beats);
        run.readings.insert(
            "loop".into(),
            json!({"start": start, "end": end, "seconds": b.seconds, "bar": b.bar, "bars": b.bars}),
        );
        if !b.whole {
            run.fail("audio.gen.bars", format!("{base}/loop"), json!({"bars": b.bars, "seconds": b.seconds, "bar": b.bar}),
                format!("the loop region is {:.3} s, {:.2} bars of {} s at {tempo} BPM, not within 1 ms of a whole number of bars", b.seconds, b.bars, b.bar));
        }

        // Seam: the join against the region's own 99th percentiles.
        let seam = measure::seam(&pcm, channels, start, end);
        let measures = json!({"at": end, "to": start, "step": seam.step, "step_p99": seam.step_p99, "flux": seam.flux, "flux_p99": seam.flux_p99});
        run.readings.insert("seam".into(), measures.clone());
        if !seam.clean() {
            run.fail("audio.gen.seam", format!("{base}/loop"), measures,
                format!("the seam at sample {end} (back to {start}) steps {:.4} against the bed's 99th percentile {:.4}, with flux {:.4} against {:.4}", seam.step, seam.step_p99, seam.flux, seam.flux_p99));
        }

        // Stems: summed sample by sample, against the mix.
        if let Some(stems) = s.get("stems").and_then(Value::as_object) {
            let mut decoded = Vec::new();
            for (name, a) in stems {
                let a = a.as_str().ok_or_else(|| bad(id, format!("stems/{name}")))?;
                let (r, c, x) = self.pcm(a)?;
                if (r, c) != (rate, channels) {
                    run.fail("audio.gen.stems", format!("{base}/stems/{name}"), json!({"stem": name, "sample_rate": r, "channels": c}),
                        format!("stem {name} is {r} Hz in {c} channels, and the mix {rate} Hz in {channels}"));
                }
                decoded.push((name.clone(), x));
            }
            if run.issues.iter().all(|i| i["code"] != "audio.gen.stems") {
                let r = measure::residual(
                    &pcm,
                    &decoded
                        .iter()
                        .map(|(_, x)| x.as_slice())
                        .collect::<Vec<_>>(),
                );
                run.readings.insert("residual".into(), reading(r.dbfs));
                if r.dbfs > RESIDUAL_DBFS {
                    let stem = r.nearest().map_or(String::new(), |k| decoded[k].0.clone());
                    run.fail("audio.gen.stems", format!("{base}/stems/{stem}"), json!({"stem": stem, "residual": r.dbfs, "limit": RESIDUAL_DBFS}),
                        format!("the stems sum to the mix with a residual of {:.2} dBFS RMS, over {RESIDUAL_DBFS}; stem {stem} correlates most with it", r.dbfs));
                }
            }
        }

        // Loudness on its bus's target, true peak under the ceiling, and no leading silence.
        let target = d
            .pointer(&format!("/buses/{bus}/loudness_target"))
            .and_then(Value::as_f64);
        if target.is_none() {
            run.blocked.push(json!({"input": "loudness_target", "path": format!("buses/{bus}/loudness_target"), "bus": bus,
                "reason": format!("bus {bus} has no loudness_target to hold the bed to")}));
        }
        let levels = run.levels(&format!("{base}/asset"), &pcm, rate, channels, target);
        run.readings.extend(levels);
        Ok(())
    }

    fn takes(&mut self, id: &str, s: &Value, run: &mut Run) -> Result<(), Value> {
        let base = format!("sounds/{id}");
        let levels = s
            .get("variants")
            .and_then(Value::as_array)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| bad(id, "variants ([{target, takes}])"))?;
        // Each take: its path, its asset, its duration and its spectra.
        let mut takes: Vec<(String, String, f64, Vec<Vec<f64>>)> = Vec::new();
        let mut readings = Vec::new();
        for (i, level) in levels.iter().enumerate() {
            let target = level
                .get("target")
                .and_then(Value::as_f64)
                .ok_or_else(|| bad(id, format!("variants/{i}/target (LUFS)")))?;
            let list = level
                .get("takes")
                .and_then(Value::as_array)
                .filter(|t| !t.is_empty())
                .ok_or_else(|| bad(id, format!("variants/{i}/takes")))?;
            for (j, a) in list.iter().enumerate() {
                let path = format!("{base}/variants/{i}/takes/{j}");
                let a = a
                    .as_str()
                    .ok_or_else(|| bad(id, format!("variants/{i}/takes/{j}")))?;
                let (rate, channels, pcm) = self.pcm(a)?;
                let mut r = run.levels(&path, &pcm, rate, channels, Some(target));
                let duration = r["duration"].as_f64().unwrap_or(0.0);
                r.insert("path".into(), json!(path.as_str()));
                r.insert("asset".into(), json!(a));
                readings.push(Value::Object(r));
                takes.push((
                    path,
                    a.to_string(),
                    duration,
                    measure::spectra(&pcm, channels),
                ));
            }
        }
        let median = measure::median(&takes.iter().map(|t| t.2).collect::<Vec<_>>());
        for (path, _, duration, _) in &takes {
            if (duration - median).abs() > DURATION_SPREAD * median {
                run.fail("audio.gen.duration", path.clone(), json!({"duration": duration, "median": median, "spread": DURATION_SPREAD}),
                    format!("{path} lasts {duration:.3} s, outside ±20% of the takes' median {median:.3} s"));
            }
        }
        let mut closest: Option<(f64, [&str; 2])> = None;
        for (k, (pa, aa, _, sa)) in takes.iter().enumerate() {
            for (pb, ab, _, sb) in &takes[k + 1..] {
                let by_hash = aa == ab;
                let dist = if by_hash {
                    0.0
                } else {
                    measure::distance(sa, sb)
                };
                if closest.is_none_or(|(c, _)| dist < c) {
                    closest = Some((dist, [pa.as_str(), pb.as_str()]));
                }
                if by_hash || dist <= SAME_DB {
                    let by = if by_hash { "hash" } else { "spectrum" };
                    run.fail("audio.gen.same", pa.clone(), json!({"pair": [pa, pb], "assets": [aa, ab], "by": by, "distance": dist, "limit": SAME_DB}),
                        format!("{pa} and {pb} are the same take: {}", if by_hash { format!("one file, {aa}") } else { format!("{dist:.3} dB apart, within {SAME_DB} dB") }));
                }
            }
        }
        run.readings.insert("takes".into(), Value::Array(readings));
        run.readings.insert("median_duration".into(), json!(median));
        run.readings.insert(
            "closest".into(),
            closest.map_or(Value::Null, |(d, p)| json!({"pair": p, "distance": d})),
        );
        Ok(())
    }

    /// At check (#935): each strip, `media.strip@1` item and spawn template that names an asset of
    /// an entry in `sounds` whose audio.gen doesn't read PASS is the error `audio.gen.unpassed` at
    /// its `src`, naming the asset, the sound and why.
    pub(crate) fn unpassed_sounds(&mut self, d: &Value) -> Vec<Issue> {
        let Some(sounds) = d.get("sounds").and_then(Value::as_object) else {
            return Vec::new();
        };
        // Each asset's entries: an asset several entries declare may be named once one of them passes.
        let mut owners: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for (id, s) in sounds {
            for a in declared(s) {
                owners.entry(a).or_default().push(id.as_str());
            }
        }
        let fail_only = self.scenario.module_planted.as_deref() == Some("unpassed_on_fail_only");
        // The planted check: only a FAIL refuses, so a BLOCKED sound plays.
        let passes = |r: &Result<Value, Value>| matches!(r, Ok(g) if g["state"] == "PASS" || (fail_only && g["state"] == "BLOCKED"));
        let mut held: BTreeMap<String, Result<Value, Value>> = BTreeMap::new();
        let mut out = Vec::new();
        for (who, path, asset) in named(d) {
            let Some(ids) = owners.get(asset.as_str()) else {
                continue;
            };
            for id in ids {
                if let Entry::Vacant(e) = held.entry(id.to_string()) {
                    e.insert(self.audio_gen(d, id));
                }
            }
            if ids.iter().any(|id| passes(&held[*id])) {
                continue;
            }
            let sound = ids[0];
            let why = match &held[sound] {
                Ok(g) => {
                    let said = g["issues"]
                        .get(0)
                        .map(|i| &i["what"])
                        .or_else(|| g["blocked"].get(0).map(|b| &b["reason"]));
                    format!(
                        "{}: {}",
                        g["state"].as_str().unwrap_or("BLOCKED"),
                        said.and_then(Value::as_str).unwrap_or("")
                    )
                }
                Err(e) => format!("refused: {e}"),
            };
            let what = format!("{who} names asset {asset} of the sound {sound}, whose audio.gen doesn't pass ({why})");
            out.push(Issue::error(
                "audio.gen.unpassed",
                &who,
                path,
                json!(asset),
                &what,
            ));
        }
        out
    }
}
