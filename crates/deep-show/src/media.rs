//! Issue #498: the media module's asks of the decode worker, and an export's encode, as
//! `deep-show run` calls (the #498 decode acceptance README). Every probe, decode and proxy is a
//! job for the run's decode worker, a copy of this binary started as `decode-worker`, which
//! sandboxes itself before it reads a file; an export's frames are decoded there and encoded by
//! the encode tool, another copy started as `encode-tool`, whose process the export's record
//! names. `workers` lists both with every job each ran.

use std::path::PathBuf;

use deep_codecs::{Caps, Helper, DECODE_WORKER, ENCODE_TOOL};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Hub, Planted};
use crate::refused;

pub enum MediaCall {
    Import(String),
    Decode(Map<String, Value>),
    Proxy(Map<String, Value>),
    Export { source: String, out: String },
    Workers,
}

/// One of this issue's media calls, or `None` for a line that lacks a field it needs.
pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<MediaCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        "media_import" => MediaCall::Import(s("path")?),
        "media_decode" => {
            s("path")?;
            s("out")?;
            MediaCall::Decode(c.clone())
        }
        "media_proxy" => {
            s("path")?;
            MediaCall::Proxy(c.clone())
        }
        "media_export" => {
            if c.get("video")?.get("codec")?.as_str()? != "h264" {
                return None;
            }
            MediaCall::Export {
                source: s("source")?,
                out: s("out")?,
            }
        }
        "workers" => MediaCall::Workers,
        _ => return None,
    })
}

/// The scenario's `decode_caps`: each one left out keeps the worker's default.
pub fn caps(input: &Map<String, Value>) -> Option<Caps> {
    let mut caps = Caps::default();
    if let Some(c) = input.get("decode_caps") {
        let c = c.as_object()?;
        let n = |k: &str, or: u64| c.get(k).map_or(Some(or), Value::as_u64);
        caps.max_bytes = n("max_bytes", caps.max_bytes)?;
        caps.max_duration = n("max_duration", caps.max_duration)?;
        caps.max_pixels = n("max_pixels", caps.max_pixels)?;
    }
    Some(caps)
}

/// The run's helper processes: started on first use, ended with the run.
#[derive(Default)]
pub struct Media {
    decoder: Option<Helper>,
    encoder: Option<Helper>,
    /// Proxies and exports so far, which name their scratch files.
    exports: usize,
}

/// The worker-side name of a planted wrong program, if it is one the decode worker runs.
fn worker_planted(p: Option<Planted>) -> Option<&'static str> {
    Some(match p? {
        Planted::SkipsCaps => "skips_caps",
        Planted::FollowsUrls => "follows_urls",
        Planted::IgnoresEditLists => "ignores_edit_lists",
        Planted::KeepsPriming => "keeps_priming",
        Planted::EncodesInDecodeWorker => "encodes_in_decode_worker",
        Planted::ProbeRoundsToFlicks => "probe_rounds_to_flicks",
        Planted::AssumesBt601 => "assumes_bt601",
        _ => return None,
    })
}

impl Hub<'_> {
    /// A job for the decode worker, or for the encode tool; with the planted `decodes_in_app`, a
    /// probe or decode runs here, in this process. Returns the reply and the pid that ran it.
    pub(crate) fn media_job(&mut self, role: &'static str, job: Value) -> (Value, u32) {
        let planted = self.scenario.planted;
        if role == DECODE_WORKER && planted == Some(Planted::DecodesInApp) {
            let caps = self.scenario.decode_caps;
            let (reply, _) =
                deep_codecs::run(job.as_object().expect("a job"), &caps, &Default::default());
            return (reply, std::process::id());
        }
        let slot = match role {
            ENCODE_TOOL => &mut self.media.encoder,
            _ => &mut self.media.decoder,
        };
        if slot.is_none() {
            let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
            match Helper::start(
                &exe,
                role,
                &self.scenario.decode_caps,
                worker_planted(planted),
            ) {
                Ok(h) => {
                    *slot = Some(h);
                }
                Err(e) => return (json!({"error": format!("the {role} didn't start: {e}")}), 0),
            }
        }
        let h = slot.as_mut().expect("started");
        (h.ask(&job), h.pid)
    }

    pub fn media_call(&mut self, call: &MediaCall) -> Value {
        match call {
            MediaCall::Import(path) => {
                let (mut reply, pid) =
                    self.media_job(DECODE_WORKER, json!({"op": "probe", "path": path}));
                reply["worker"] = json!({"pid": pid});
                reply
            }
            MediaCall::Decode(c) => {
                let mut job = c.clone();
                job.insert("op".into(), json!("decode"));
                let (mut reply, pid) = self.media_job(DECODE_WORKER, Value::Object(job));
                match reply.get_mut("decoded") {
                    Some(d) => d["worker"] = json!({"pid": pid}),
                    None => reply["worker"] = json!({"pid": pid}),
                }
                reply
            }
            MediaCall::Proxy(c) => {
                let tmp = std::env::temp_dir().join(format!(
                    "deep-proxy-{}-{}",
                    std::process::id(),
                    self.media.exports
                ));
                self.media.exports += 1;
                let mut job = c.clone();
                job.insert("op".into(), json!("proxy"));
                job.insert("out".into(), json!(tmp.to_string_lossy()));
                let (mut reply, pid) = self.media_job(DECODE_WORKER, Value::Object(job));
                reply["worker"] = json!({"pid": pid});
                // The proxy is kept by its hash beside the asset.
                if let Ok(bytes) = std::fs::read(&tmp) {
                    let _ = evidence::put(&self.scenario.evidence, &bytes);
                    let _ = std::fs::remove_file(&tmp);
                    if let Some(p) = reply.get_mut("proxy").and_then(Value::as_object_mut) {
                        p.remove("path");
                    }
                }
                reply
            }
            MediaCall::Export { source, out } => self.export(source, out),
            MediaCall::Workers => {
                let list: Vec<Value> = [&self.media.decoder, &self.media.encoder]
                    .into_iter()
                    .flatten()
                    .map(Helper::json)
                    .collect();
                json!({"workers": list})
            }
        }
    }

    /// An export of a film whose one strip is `source`: its frames decoded in the decode worker,
    /// encoded by the encode tool into an MP4 at `out`, and the record naming the encoder's
    /// process. With the planted `encodes_in_decode_worker` the decode worker encodes.
    fn export(&mut self, source: &str, out: &str) -> Value {
        let n = self.media.exports;
        self.media.exports += 1;
        let frames_dir =
            std::env::temp_dir().join(format!("deep-export-{}-{n}", std::process::id()));
        let job = json!({"op": "decode", "path": source, "out": frames_dir.to_string_lossy()});
        let (decoded, _) = self.media_job(DECODE_WORKER, job);
        let result = (|| {
            let streams = decoded["decoded"]["streams"]
                .as_array()
                .ok_or_else(|| decoded.clone())?;
            let video = streams
                .iter()
                .find(|s| s["type"] == "video")
                .ok_or_else(|| refused("no_video"))?;
            let frames = video["frames"]
                .as_array()
                .ok_or_else(|| refused("no_video"))?;
            let paths: Vec<String> = frames
                .iter()
                .map(|f| {
                    frames_dir
                        .join(f["file"].as_str().unwrap_or_default())
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            let pts: Vec<i64> = frames.iter().filter_map(|f| f["pts"][0].as_i64()).collect();
            let timescale = frames
                .first()
                .and_then(|f| f["pts"][1].as_i64())
                .unwrap_or(1);
            let role = match self.scenario.planted {
                Some(Planted::EncodesInDecodeWorker) => DECODE_WORKER,
                _ => ENCODE_TOOL,
            };
            let job = json!({"op": "encode", "frames": paths, "pts": pts, "timescale": timescale,
                "size": video["size"], "out": out});
            let (coded, pid) = self.media_job(role, job);
            let sha = coded["sha256"]
                .as_str()
                .ok_or_else(|| coded.clone())?
                .to_string();
            let mut encoder = coded["encoder"].clone();
            encoder["process"] = json!({"pid": pid, "role": role});
            Ok::<_, Value>(json!({"export": {"file": {"path": out, "sha256": sha},
                "receipt": {"encoder": encoder, "frames": frames.len()}}}))
        })();
        let _ = std::fs::remove_dir_all(&frames_dir);
        result.unwrap_or_else(|e| e)
    }
}
