//! Issue #509: narration heard back (canvas primitives: Check input: `narration.transcript@1`,
//! and Check input: mix kinds). On every verdict of a claim whose deliverable speaks, two default
//! rows: each line's own audio and its window in the mix held to what it says, by the transcripts
//! the job `narration.transcript` recorded; and the narration bus held above the rest of the mix
//! over each line's speech, by the buses' power bakes. A transcript that doesn't match opens one
//! exception ask per (line text, audio), kept in the state folder's record so it is never asked
//! twice. No model runs here: a missing transcript is BLOCKED, naming the job and the PCM.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_media::analysis::{loudness, model};
use deep_canvas_media::heard::{self, Expected};
use deep_canvas_media::mix::Player;
use deep_canvas_media::FLICKS;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::evidence;
use crate::hub::{Claim, Hub};
use crate::mixdown::{planted_of, sample_at};
use crate::narration::{Line, Script};

/// The job kind and the pinned tool whose records hold transcripts.
const TRANSCRIPT: &str = "narration.transcript";
const ANALYZER: &str = "whisper-cpp@1.9.5";
const ACTIVITY: &str = "bake.activity";
const ASKED: &str = "narration.exception.asked";
const ANSWERED: &str = "narration.exception.answered";

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

fn f32_bytes(pcm: &[f32]) -> Vec<u8> {
    pcm.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn seconds(t: i64) -> f64 {
    (t as f64 / FLICKS as f64 * 1000.0).round() / 1000.0
}

/// `{"call": "media_heard", "expected", "heard", "locale", "names"}`: the comparison alone.
pub(crate) fn heard_call(c: &serde_json::Map<String, Value>) -> Value {
    let text = |k: &str| c.get(k).and_then(Value::as_str);
    let (Some(expected), Some(said)) = (text("expected"), text("heard")) else {
        return json!({"code": "bad_input", "what": "expected and heard, as strings"});
    };
    let names: Vec<String> = c
        .get("names")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    // The comparison alone, the same for every locale: a polyphonic character's reading is a
    // script line's say's to give, so here it matches any of its readings.
    let e = Expected::plain(expected, &names);
    let toks = heard::normalize(said);
    let got = heard::compare(&e, &toks, &BTreeMap::new(), &BTreeMap::new(), 0);
    json!({"expected": e.say.iter().map(heard::Tok::shown).collect::<Vec<_>>(), "heard": toks.iter().map(heard::Tok::shown).collect::<Vec<_>>(),
        "match": got.matched, "missing": got.missing, "extra": got.extra, "wrong": got.wrong})
}

/// The power bakes of a document's mix, one pass from its start: per bus its ID, what it feeds,
/// its bake and the program's frames.
pub(crate) struct Bakes {
    pub rate: i64,
    pub routes: Vec<(String, Option<usize>)>,
    pub energy: Vec<Vec<f64>>,
    pub bytes: Vec<Vec<u8>>,
}

/// A line's own PCM and its mix window, with what the job needs to run on each.
struct Scope {
    name: &'static str,
    pcm: Vec<f32>,
    rate: i64,
    channels: usize,
}

impl Scope {
    fn sha(&self) -> String {
        hex(Sha256::digest(f32_bytes(&self.pcm)))
    }
}

/// What one line's transcripts say.
#[derive(Default)]
struct Judged {
    issues: Vec<Value>,
    blocked: Vec<Value>,
    asks: Vec<Value>,
    measure: Vec<Value>,
}

impl Hub<'_> {
    /// The mix's power bakes, from one tapped player read from 0 to the program's end.
    pub(crate) fn power_bakes(&mut self, doc: &Value) -> Result<Bakes, Value> {
        let mix = Arc::new(self.mix_of(doc)?);
        let rate = mix.rate;
        let end = match doc.pointer("/transport/span") {
            Some(v) if v != "open" => deep_canvas_media::doc::time(doc, Some(v)).unwrap_or(0),
            _ => mix
                .strips
                .iter()
                .map(|s| s.start + s.span)
                .max()
                .unwrap_or(0),
        };
        let frames = sample_at(end, rate);
        let mut player = Player::tapped(mix, planted_of(self.scenario.planted, false));
        let mut buf = vec![0f32; 2 * 4096];
        let mut left = frames.max(0) as usize;
        while left > 0 {
            let n = left.min(4096);
            player.read(&mut buf[..2 * n]);
            left -= n;
        }
        let routes = player.routes();
        let power = player.power().unwrap_or_default();
        let energy = power
            .iter()
            .map(|p| p.energy[..p.subblocks(frames) * 2].to_vec())
            .collect();
        let bytes = power.iter().map(|p| p.bytes(frames)).collect();
        Ok(Bakes {
            rate,
            routes,
            energy,
            bytes,
        })
    }

    /// `script.spoken`, written into a document whose times name a narration line or its words:
    /// each line's and word marker's `[start, end]`, from the compiled script.
    pub(crate) fn stamp_spoken(&mut self, doc: &mut Value) {
        let Some(lines) = doc.pointer("/script/lines").and_then(Value::as_object) else {
            return;
        };
        let text = doc.to_string();
        if !lines.keys().any(|id| text.contains(&format!("\"@{id}"))) {
            return;
        }
        let Some(s) = self.script_of(doc) else { return };
        let spoken: serde_json::Map<String, Value> = s
            .spoken
            .iter()
            .map(|(n, (a, b))| (n.clone(), json!([a, b])))
            .collect();
        doc["script"]["spoken"] = Value::Object(spoken);
    }

    /// #509: an export's receipt `bakes`: each bus's power bake of the mix at `hz`, kept by hash,
    /// from one pass over the whole mix.
    pub(crate) fn bakes_listed(&mut self, doc: &Value, hz: u32) -> Result<Value, Value> {
        let mut d = doc.clone();
        d["transport"]["sample_rate"] = json!(hz);
        let bakes = self.power_bakes(&d)?;
        let mut listed = Vec::new();
        for ((bus, _), bytes) in bakes.routes.iter().zip(&bakes.bytes) {
            let sha = evidence::put(&self.scenario.evidence, bytes)
                .map_err(|_| json!({"code": "store_failed"}))?;
            listed.push(json!({"bus": bus, "channels": 2, "subblocks": bytes.len() / 16, "bytes": bytes.len(), "sha256": sha}));
        }
        Ok(Value::Array(listed))
    }

    /// The asks the state folder's record says were asked and answered.
    pub(crate) fn heard_restore(&mut self) {
        if std::mem::replace(&mut self.media.heard_restored, true) {
            return;
        }
        let Some(text) = self
            .scenario
            .state
            .as_ref()
            .and_then(|s| std::fs::read_to_string(s.join("record.jsonl")).ok())
        else {
            return;
        };
        for line in text.lines() {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let (kind, data) = (&entry["event"]["kind"], &entry["event"]["data"]);
            let Some(id) = data["id"].as_str() else {
                continue;
            };
            if kind == ASKED {
                self.audit_asks.entry(id.to_string()).or_insert(None);
            } else if kind == ANSWERED {
                self.audit_asks
                    .insert(id.to_string(), data["answer"].as_bool());
            }
        }
    }

    /// Keeps an exception ask's being asked, or your answer to it, in the state folder's record.
    pub(crate) fn heard_journal(&self, id: &str, answer: Option<bool>) {
        if !id.contains("/narration.transcript:") {
            return;
        }
        let Some(state) = self.scenario.state.as_deref() else {
            return;
        };
        let (kind, data) = match answer {
            None => (ASKED, json!({"id": id})),
            Some(a) => (ANSWERED, json!({"id": id, "answer": a})),
        };
        crate::capture::append(state, "hub", kind, id, data, &[]);
    }

    /// The default rows of a claim whose deliverables speak: `narration.transcript` and
    /// `mix.speech_ratio`.
    pub(crate) fn heard_rows(&mut self, claim: &str, c: &Claim) -> Vec<Value> {
        self.heard_restore();
        let (mut transcript, mut ratio) = (Judged::default(), Judged::default());
        let (mut speaks, mut speech) = (false, false);
        let min = c
            .brief
            .as_ref()
            .and_then(|b| b.pointer("/mix/speech_ratio/min"))
            .and_then(Value::as_f64)
            .unwrap_or(10.0)
            .clamp(6.0, 10.0);
        for doc in &c.deliverables {
            let Some(r) = self.query_revision(doc, None) else {
                continue;
            };
            let d = r.drawn;
            let Some(s) = self.script_of(&d) else {
                continue;
            };
            if !s.lines.iter().any(|l| !l.caption) {
                continue;
            }
            speaks = true;
            speech |= s.lines.iter().any(|l| !l.caption && !l.vocal);
            if let Some(p) = &s.problem {
                let mut p = p.clone();
                p["doc"] = json!(doc);
                if p["outcome"] == "blocked" {
                    transcript.blocked.push(p.clone());
                    ratio.blocked.push(p);
                } else {
                    p["severity"] = json!("error");
                    p["check"] = json!("narration.transcript@1");
                    transcript.issues.push(p);
                }
                continue;
            }
            for line in s.lines.iter().filter(|l| !l.caption) {
                self.heard_line(claim, doc, &d, line, &mut transcript);
            }
            if speech {
                self.speech_ratio(doc, &d, &s, min, &mut ratio);
            }
        }
        if !speaks {
            return Vec::new();
        }
        let mut rows = vec![row(
            claim,
            "narration.transcript",
            "narration.transcript@1",
            transcript,
        )];
        if speech {
            let mut r = row(claim, "mix.speech_ratio", "mix.speech_ratio", ratio);
            r["min"] = json!(min);
            rows.push(r);
        }
        rows
    }

    /// One line's PCM: the asset's decode from `in` to `out`.
    fn take_pcm(&mut self, line: &Line) -> Result<Scope, Value> {
        let Some((sha, a, b)) = &line.take else {
            return Err(json!({"code": "narration.speech_job", "line": line.id}));
        };
        let (rate, channels, pcm) = self.pcm(sha)?;
        let ch = channels.max(1);
        let frames = (pcm.len() / ch) as i64;
        let (first, last) = (
            sample_at(*a, rate).clamp(0, frames),
            sample_at(*b, rate).clamp(0, frames),
        );
        Ok(Scope {
            name: "line",
            pcm: pcm[first as usize * ch..last.max(first) as usize * ch].to_vec(),
            rate,
            channels: ch,
        })
    }

    /// The document's mix from `from` to `to`, before the delivery gain: what `media_mix` answers.
    fn window_pcm(&mut self, d: &Value, from: i64, to: i64) -> Result<Scope, Value> {
        let mix = Arc::new(self.mix_of(d)?);
        let rate = mix.rate;
        let mut player = Player::new(mix, planted_of(self.scenario.planted, false));
        let (first, last) = (sample_at(from, rate), sample_at(to, rate));
        if first != 0 {
            player.seek(first);
        }
        let mut pcm = vec![0f32; 2 * (last - first).max(0) as usize];
        for chunk in pcm.chunks_mut(2 * 4096) {
            player.read(chunk);
        }
        Ok(Scope {
            name: "mix",
            pcm,
            rate,
            channels: 2,
        })
    }

    /// The records a line's audio asset lists, read.
    fn records_of(&self, line: &Line) -> Vec<Value> {
        line.attached
            .iter()
            .filter_map(|r| {
                serde_json::from_slice(&evidence::read(&self.scenario.evidence, r)?).ok()
            })
            .collect()
    }

    fn heard_line(&mut self, claim: &str, doc: &str, d: &Value, line: &Line, j: &mut Judged) {
        let records = self.records_of(line);
        let own = match self.take_pcm(line) {
            Ok(s) => s,
            Err(e) => {
                j.blocked.push(json!({"code": "narration.transcript_unrun", "line": line.id, "doc": doc, "why": e}));
                return;
            }
        };
        let own_sha = own.sha();
        if line.vocal {
            let spans = records
                .iter()
                .find(|r| r["kind"] == ACTIVITY && r["pcm_sha256"] == own_sha.as_str())
                .and_then(|r| {
                    let read = |k: &str| {
                        r[k].as_array()?
                            .iter()
                            .map(Value::as_f64)
                            .collect::<Option<Vec<f64>>>()
                    };
                    let (f, b, frame) = (
                        read("speech")?,
                        read("speech_reversed")?,
                        r["frame"].as_i64()?,
                    );
                    let mean: Vec<f64> = f.iter().zip(&b).map(|(x, y)| (x + y) / 2.0).collect();
                    Some(model::spans(&mean, frame, 0.5))
                });
            match spans {
                None => {
                    let _ = evidence::put(&self.scenario.evidence, &f32_bytes(&own.pcm));
                    j.blocked.push(json!({"code": "narration.activity_unbaked", "line": line.id, "doc": doc, "job": ACTIVITY, "pcm_sha256": own_sha,
                        "sample_rate": own.rate, "channels": own.channels}));
                }
                Some(s) if s.is_empty() => j.issues.push(json!({"check": "narration.transcript@1", "code": "narration.no_activity", "severity": "error",
                    "line": line.id, "doc": doc, "ids": [line.id], "what": format!("the vocalization `{}` holds no speech activity", line.id),
                    "fix": "record or synthesize the vocalization again"})),
                Some(s) => j.measure.push(json!({"line": line.id, "spans": s.len()})),
            }
            return;
        }
        let Ok(expected) = Expected::of(&line.text, line.say.as_deref(), &line.names, &line.locale)
        else {
            return;
        };
        let (_, a, b) = line.take.clone().unwrap_or_default();
        let window = self.window_pcm(
            d,
            (line.t - FLICKS * 15 / 100).max(0),
            line.t + (b - a) + FLICKS / 4,
        );
        let mut failed: Option<Value> = None;
        for scope in [Ok(own), window] {
            let scope = match scope {
                Ok(s) => s,
                Err(e) => {
                    j.blocked.push(json!({"code": "narration.transcript_unrun", "line": line.id, "doc": doc, "scope": "mix", "why": e}));
                    continue;
                }
            };
            let sha = scope.sha();
            let Some(rec) = records.iter().find(|r| {
                r["kind"] == TRANSCRIPT
                    && r["pcm_sha256"] == sha.as_str()
                    && r["analyzer"] == ANALYZER
            }) else {
                let _ = evidence::put(&self.scenario.evidence, &f32_bytes(&scope.pcm));
                j.blocked.push(json!({"code": "narration.transcript_unrun", "line": line.id, "doc": doc, "scope": scope.name, "job": TRANSCRIPT,
                    "analyzer": ANALYZER, "pcm_sha256": sha, "sample_rate": scope.rate, "channels": scope.channels, "locale": line.locale}));
                continue;
            };
            let said = rec["text"].as_str().unwrap_or_default();
            let phonemes = |k: &str| {
                let list: Vec<(&str, Vec<String>)> = rec[k]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|w| {
                        Some((
                            w["text"].as_str()?,
                            w["phonemes"]
                                .as_array()?
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect(),
                        ))
                    })
                    .collect();
                heard::phonemes_by_text(list)
            };
            let got = heard::compare(
                &expected,
                &heard::normalize(said),
                &phonemes("words"),
                &phonemes("names"),
                usize::from(scope.name == "mix"),
            );
            j.measure.push(json!({"line": line.id, "scope": scope.name, "pcm_sha256": sha, "heard": said, "match": got.matched}));
            if !got.matched && failed.is_none() {
                let words: Vec<String> = got
                    .missing
                    .iter()
                    .chain(got.wrong.iter().map(|w| &w.0))
                    .cloned()
                    .collect();
                failed = Some(
                    json!({"check": "narration.transcript@1", "code": "narration.mismatch", "severity": "error", "line": line.id, "doc": doc,
                    "ids": [line.id], "scope": scope.name, "expected": expected.said(), "heard": said, "missing": got.missing, "extra": got.extra,
                    "wrong": got.wrong.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
                    "what": format!("line `{}` heard in its {} scope says `{said}`, not `{}`", line.id, scope.name, expected.said()),
                    "fix": if words.is_empty() { format!("take line `{}` again, or remove what is heard beyond its words", line.id) }
                        else { format!("respell {} in the line's say", words.join(", ")) }}),
                );
            }
        }
        let Some(issue) = failed else { return };
        // One exception ask per (line text, audio), never asked twice.
        let text_sha = hex(Sha256::digest(line.text.as_bytes()));
        let id = format!(
            "{claim}/narration.transcript:{}/{text_sha}.{own_sha}",
            line.id
        );
        match self.audit_asks.get(&id).copied() {
            Some(Some(true)) => return,
            Some(_) => {}
            None => {
                self.audit_asks.insert(id.clone(), None);
                self.heard_journal(&id, None);
                j.asks.push(json!({"kind": "exception", "id": id, "line": line.id, "clip": own_sha, "expected": issue["expected"], "heard": issue["heard"],
                    "ask": format!("line `{}` is heard as `{}`; does it say `{}`?", line.id, issue["heard"].as_str().unwrap_or_default(), expected.said())}));
            }
        }
        j.issues.push(issue);
    }

    /// `mix.speech_ratio` on one document: over each speech line's activity spans, in 3 s windows,
    /// the narration bus against the summed other buses that feed the master.
    fn speech_ratio(&mut self, doc: &str, d: &Value, s: &Script, min: f64, j: &mut Judged) {
        let mut spans: Vec<(String, i64, i64)> = Vec::new();
        for line in s.lines.iter().filter(|l| !l.caption && !l.vocal) {
            let records = self.records_of(line);
            let Ok(own) = self.take_pcm(line) else {
                continue;
            };
            let sha = own.sha();
            let found = records
                .iter()
                .find(|r| r["kind"] == ACTIVITY && r["pcm_sha256"] == sha.as_str())
                .and_then(|r| {
                    let read = |k: &str| {
                        r[k].as_array()?
                            .iter()
                            .map(Value::as_f64)
                            .collect::<Option<Vec<f64>>>()
                    };
                    let (f, b, frame) = (
                        read("speech")?,
                        read("speech_reversed")?,
                        r["frame"].as_i64()?,
                    );
                    Some(model::spans(
                        &f.iter()
                            .zip(&b)
                            .map(|(x, y)| (x + y) / 2.0)
                            .collect::<Vec<_>>(),
                        frame,
                        0.5,
                    ))
                });
            let Some(found) = found else {
                let _ = evidence::put(&self.scenario.evidence, &f32_bytes(&own.pcm));
                j.blocked.push(json!({"code": "narration.activity_unbaked", "line": line.id, "doc": doc, "job": ACTIVITY, "pcm_sha256": sha,
                    "sample_rate": own.rate, "channels": own.channels}));
                continue;
            };
            let (_, a, b) = line.take.clone().unwrap_or_default();
            for (x, y) in found {
                let (x, y) = (x.max(0), y.min(b - a));
                if y > x {
                    spans.push((line.id.clone(), line.t + x, line.t + y));
                }
            }
        }
        if !j.blocked.is_empty() {
            return;
        }
        let bakes = match self.power_bakes(d) {
            Ok(b) => b,
            Err(e) => {
                j.blocked
                    .push(json!({"code": "mix.speech_ratio.unbaked", "doc": doc, "why": e}));
                return;
            }
        };
        let master = bakes.routes.iter().position(|(_, out)| out.is_none());
        let narration = bakes.routes.iter().position(|(id, _)| id == "narration");
        let (Some(master), Some(narration)) = (master, narration) else {
            j.blocked.push(json!({"code": "mix.routing", "doc": doc, "why": "the mix has no narration bus that feeds the master"}));
            return;
        };
        if bakes.routes[narration].1 != Some(master) {
            j.blocked.push(json!({"code": "mix.routing", "doc": doc, "why": "the narration bus doesn't feed the master directly"}));
            return;
        }
        // The other buses that feed the master, and the strips that play on the master itself.
        let others: Vec<&[f64]> = bakes
            .routes
            .iter()
            .enumerate()
            .filter(|(b, (_, out))| *b != narration && *out == Some(master))
            .map(|(b, _)| bakes.energy[b].as_slice())
            .chain(std::iter::once(bakes.energy[bakes.routes.len()].as_slice()))
            .collect();
        let rate = bakes.rate;
        let sub = |t: i64, up: bool| {
            let x = t as i128 * 100;
            let k =
                x.div_euclid(FLICKS as i128) + i128::from(up && x.rem_euclid(FLICKS as i128) != 0);
            k.max(0) as usize
        };
        let short = 3 * FLICKS;
        let total = bakes.energy[narration].len() / 2;
        for (line, a, b) in spans {
            let mut windows = Vec::new();
            let mut w = a;
            while w + short < b {
                windows.push((w, w + short));
                w += short;
            }
            windows.push(((b - short).max(a), b));
            for (wa, wb) in windows {
                let (k0, k1) = (sub(wa, true).min(total), sub(wb, false).min(total));
                if k1 <= k0 {
                    continue;
                }
                let n = loudness::loudness_of(&[&bakes.energy[narration]], 2, rate, k0, k1);
                let o = loudness::loudness_of(&others, 2, rate, k0, k1);
                let r = n - o;
                j.measure.push(json!({"line": line, "window": [wa, wb], "narration": n, "others": if o.is_finite() { json!(o) } else { json!(null) },
                    "ratio": if r.is_finite() { json!(r) } else { json!(null) }}));
                if r < min {
                    j.issues.push(json!({"check": "mix.speech_ratio", "code": "mix.speech_low", "severity": "error", "doc": doc, "ids": [line],
                        "line": line, "span": [a, b], "window": [wa, wb], "narration": n, "others": o, "ratio": r, "min": min,
                        "what": format!("over {}–{} s the narration is {:.1} LU above the rest of the mix, under {min} LU", seconds(wa), seconds(wb), r),
                        "fix": "lower the other buses under the narration, or duck them by its speech"}));
                }
            }
        }
    }
}

/// #509: an export FAILs when a line runs past its section's end (`narration.fit`).
pub(crate) fn fits(doc: &Value, s: &Script) -> Result<(), Value> {
    let fit = fit_issues(doc, s);
    if fit.is_empty() {
        return Ok(());
    }
    Err(json!({"outcome": "failed", "code": "pace", "issues": fit}))
}

/// `narration.fit`: each line whose last word ends after the end of the section marker that holds
/// its start, with the overrun in seconds.
pub(crate) fn fit_issues(doc: &Value, s: &Script) -> Vec<Value> {
    let Some(motion) = doc
        .as_object()
        .and_then(|m| deep_canvas_motion::doc::read(m).ok())
    else {
        return Vec::new();
    };
    let sections: Vec<_> = motion
        .markers
        .iter()
        .filter(|m| m.kind == "section")
        .collect();
    let mut out = Vec::new();
    for line in &s.lines {
        let Some((start, end)) = line.span() else {
            continue;
        };
        let Some(m) = sections.iter().find(|m| m.start <= start && start < m.end) else {
            continue;
        };
        if end > m.end {
            let overrun = seconds(end - m.end);
            out.push(json!({"code": "narration.fit", "line": line.id, "section": m.id, "overrun": overrun,
                "what": format!("line `{}` runs {overrun} s past the end of its section `{}`", line.id, m.id),
                "fix": format!("lengthen section `{}` to its line plus 0.5 s, or shorten the line", m.id)}));
        }
    }
    out
}

/// A default row: FAIL on an error issue, else BLOCKED on anything it couldn't read, else PASS.
fn row(claim: &str, name: &str, check: &str, j: Judged) -> Value {
    let result = if j.issues.iter().any(|i| i["severity"] == "error") {
        "FAIL"
    } else if !j.blocked.is_empty() {
        "BLOCKED"
    } else {
        "PASS"
    };
    let mut r = json!({"id": format!("{claim}#{name}"), "kind": check, "result": result, "machines": "any", "determinism": "exact",
        "issues": j.issues, "from": {"default": check}, "measure": j.measure});
    if !j.blocked.is_empty() {
        r["blocked"] = Value::Array(j.blocked);
    }
    if !j.asks.is_empty() {
        r["asks"] = Value::Array(j.asks);
    }
    r
}
