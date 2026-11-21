//! Issue #1518: the host side of `cut.words@1` (canvas primitives: Strip and track, its As built
//! (#1518)). The media module places a recording's cuts at check through the reader the run's
//! packs carry: the recording's sound decoded in a decode worker of its own, kept by the asset's
//! hash, and records read from, and bytes kept in, the evidence store. On a verdict, the default
//! row `cut.heard` holds each recipe's cut result to the transcript the pinned transcriber
//! recorded of it; no model runs here, so a missing transcript is BLOCKED, naming the job.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use deep_canvas::document::expands::{Reader, Reads, Sound};
use deep_canvas_media::cut;
use deep_canvas_media::mix::Player;
use deep_codecs::{Caps, Helper, DECODE_WORKER};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Claim, Hub};
use crate::mixdown::{decode_job, decoded_from, planted_of, sample_at};
use crate::narration::heard_back::{row, Judged};

/// The reader the media module calls at check.
struct HostReader {
    evidence: PathBuf,
    caps: Caps,
    planted: Option<&'static str>,
    worker: Mutex<Option<Helper>>,
    sounds: Mutex<BTreeMap<String, Arc<Sound>>>,
}

impl Reads for HostReader {
    fn sound(&self, asset: &str) -> Result<Arc<Sound>, Value> {
        let mut sounds = self.sounds.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(p) = sounds.get(asset) {
            return Ok(p.clone());
        }
        if evidence::read(&self.evidence, asset).is_none() {
            return Err(json!({"code": "unknown_asset", "asset": asset}));
        }
        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        if worker.is_none() {
            let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
            let started = Helper::start(&exe, DECODE_WORKER, &self.caps, self.planted);
            *worker = Some(started.map_err(|e| {
                json!({"code": "decoder_unstarted", "why": format!("the decode worker didn't start: {e}")})
            })?);
        }
        let path = self.evidence.join(&asset[..2]).join(&asset[2..]);
        let out =
            std::env::temp_dir().join(format!("deep-cut-{}-{}", std::process::id(), &asset[..16]));
        let reply = worker
            .as_mut()
            .expect("started above")
            .ask(&decode_job(&path, &out));
        let video = reply["decoded"]["streams"]
            .as_array()
            .is_some_and(|s| s.iter().any(|s| s["type"] == "video"));
        let (rate, channels, samples, _) = decoded_from(&reply, &out, asset)?;
        let mut pcm = Sound {
            rate,
            channels,
            samples,
            sha256: String::new(),
            video,
        };
        pcm.sha256 = evidence::sha256_hex(&cut::bytes(&pcm));
        let pcm = Arc::new(pcm);
        sounds.insert(asset.to_string(), pcm.clone());
        Ok(pcm)
    }

    fn record(&self, sha: &str) -> Option<Value> {
        serde_json::from_slice(&evidence::read(&self.evidence, sha)?).ok()
    }

    fn keep(&self, bytes: &[u8]) -> Option<String> {
        evidence::put(&self.evidence, bytes).ok()
    }
}

/// The run's media plant, and the reader its packs carry, over the scenario's evidence store and
/// decode caps.
pub(crate) fn begin(hub: &mut Hub<'_>) {
    let scenario = hub.scenario;
    deep_canvas_media::plant(scenario.module_planted.as_deref());
    hub.packs.reads = Some(Reader(Arc::new(HostReader {
        evidence: scenario.evidence.clone(),
        caps: scenario.decode_caps,
        planted: crate::media::worker_planted(scenario.planted),
        worker: Mutex::new(None),
        sounds: Mutex::new(BTreeMap::new()),
    })));
}

impl Hub<'_> {
    /// The default row `cut.heard` of a claim whose deliverables hold a `cut.words@1` item.
    pub(crate) fn cut_rows(&mut self, claim: &str, c: &Claim) -> Vec<Value> {
        let mut j = Judged::default();
        let mut any = false;
        for doc in &c.deliverables {
            let Some(r) = self.query_revision(doc, None) else {
                continue;
            };
            let items: Vec<(String, Value)> = (r.doc["items"].as_object().into_iter().flatten())
                .filter(|(_, item)| item["kind"] == "cut.words@1")
                .map(|(id, item)| (id.clone(), item.clone()))
                .collect();
            for (id, item) in items {
                any = true;
                self.cut_heard(doc, (&r.doc, &r.drawn), &id, &item, &mut j);
            }
        }
        if !any {
            return Vec::new();
        }
        vec![row(claim, "cut.heard", "cut.heard", j)]
    }

    /// One recipe's cut result held to its transcript: every kept word there in order, no removed
    /// word heard.
    fn cut_heard(
        &mut self,
        doc: &str,
        (d, drawn): (&Value, &Value),
        id: &str,
        item: &Value,
        j: &mut Judged,
    ) {
        let reads = self.packs.reads.clone();
        let plan = match cut::plan(d, id, item, reads.as_ref().map(|r| r.0.as_ref())) {
            Ok(p) => p,
            Err(refusals) => {
                for r in refusals {
                    j.blocked.push(json!({"code": r.code, "doc": doc, "item": id, "actual": *r.actual, "why": r.what}));
                }
                return;
            }
        };
        // The cut result: the recipe's strips mixed alone, from 0 to its last strip's end.
        let strips: Map<String, Value> = (drawn["strips"].as_object().into_iter().flatten())
            .filter(|(sid, _)| {
                sid.strip_prefix(id)
                    .and_then(|k| k.strip_prefix(".s"))
                    .is_some_and(|k| !k.is_empty() && k.bytes().all(|b| b.is_ascii_digit()))
            })
            .map(|(sid, s)| (sid.clone(), s.clone()))
            .collect();
        let rate = drawn
            .pointer("/transport/sample_rate")
            .and_then(Value::as_i64)
            .unwrap_or(48_000);
        let locale = d.get("locale").and_then(Value::as_str).unwrap_or("en");
        let alone = json!({"transport": {"sample_rate": rate}, "strips": strips});
        let mix = match self.mix_of(&alone) {
            Ok(m) => Arc::new(m),
            Err(why) => {
                j.blocked
                    .push(json!({"code": "cut.heard_unrun", "doc": doc, "item": id, "why": why}));
                return;
            }
        };
        let end = plan.flicks(plan.runs.last().map_or(0, cut::Run::end));
        let mut player = Player::new(mix, planted_of(self.scenario.planted, false));
        let mut pcm = vec![0f32; 2 * sample_at(end, rate).max(0) as usize];
        for chunk in pcm.chunks_mut(2 * 4096) {
            player.read(chunk);
        }
        let bytes: Vec<u8> = pcm.iter().flat_map(|x| x.to_le_bytes()).collect();
        let sha = evidence::sha256_hex(&bytes);
        let record = plan.records.iter().find(|r| {
            r["kind"] == cut::TRANSCRIPT
                && r["analyzer"] == cut::TRANSCRIBER
                && r["pcm_sha256"] == sha.as_str()
        });
        let planted = deep_canvas_media::planted("cut_heard_passes_empty");
        let said = match record {
            Some(r) => r["text"].as_str().unwrap_or_default().to_string(),
            None if planted => String::new(),
            None => {
                let _ = evidence::put(&self.scenario.evidence, &bytes);
                j.blocked.push(json!({"code": "cut.heard_unrun", "doc": doc, "item": id, "job": cut::TRANSCRIPT,
                    "analyzer": cut::TRANSCRIBER, "pcm_sha256": sha, "sample_rate": rate, "channels": 2, "locale": locale}));
                return;
            }
        };
        let heard = cut::heard(&plan, &said);
        j.measure.push(
            json!({"doc": doc, "item": id, "pcm_sha256": sha, "heard": said,
            "lost": heard.lost.len(), "left": heard.left.len()}),
        );
        let issue = |code: &str, (word, text, t): (usize, String, i64), what: String, fix: &str| {
            json!({"check": "cut.heard", "code": code, "severity": "error", "doc": doc, "item": id, "ids": [id],
                "word": word, "text": text, "t": t, "what": what, "fix": fix})
        };
        if !planted {
            for w in heard.lost {
                let what = format!("`{id}`'s cut result doesn't say word {} `{}`", w.0, w.1);
                j.issues.push(issue("cut.word_lost", w, what,
                    "move the cuts around the word off it: widen `search`, or keep the word beside it"));
            }
        }
        for w in heard.left {
            let what = format!(
                "`{id}`'s cut result still says the removed word {} `{}`",
                w.0, w.1
            );
            j.issues.push(issue(
                "cut.word_left",
                w,
                what,
                "move the cut over the word: widen `search`, or remove the word beside it",
            ));
        }
    }
}
