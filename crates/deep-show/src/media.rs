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
    Export {
        source: String,
        out: String,
    },
    Workers,
    /// #397: a table asset, fetched by URL (the hub writes its source) or written by a session's
    /// agent (`agent`), probed in the decode worker.
    Table {
        from: TableFrom,
        key: String,
    },
}

pub enum TableFrom {
    Url(String),
    Agent { path: String, session: String },
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
        "table_import" => MediaCall::Table {
            from: match (s("url"), s("path"), s("session")) {
                (Some(url), None, None) => TableFrom::Url(url),
                (None, Some(path), Some(session)) => TableFrom::Agent { path, session },
                _ => return None,
            },
            key: s("key")?,
        },
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
    pub(crate) exports: usize,
    /// #499: video assets' probes and decoded frames.
    pub video: crate::video::Cache,
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
        Planted::TimecodeTrackZero => "timecode_track_zero",
        Planted::PngPremultipliesStraight => "png_premultiplies_straight",
        _ => return None,
    })
}

impl Hub<'_> {
    /// #499: each item whose kind reads an asset's probe has the decode worker probe it, the
    /// trusted ring's, through the core: a module needs no media module to read an asset. The
    /// param names the document's asset (or holds its SHA-256); its probe is kept on that asset
    /// in `assets`. An asset the store lacks or the worker refuses is an issue on the item.
    pub(crate) fn probe_assets(&mut self, doc: &mut Value) -> Vec<deep_canvas::document::Issue> {
        let mut out = Vec::new();
        let items = doc.get("items").and_then(Value::as_object).cloned().unwrap_or_default();
        for (id, item) in &items {
            let Some(kind) = item.get("kind").and_then(Value::as_str) else {
                continue;
            };
            let Some(param) = self.startup.sealed.probed_param(kind).map(str::to_string) else {
                continue;
            };
            let path = format!("items/{id}/params/{param}");
            let named = item.pointer(&format!("/params/{param}")).and_then(Value::as_str).unwrap_or("").to_string();
            let sha = doc
                .pointer(&format!("/assets/{named}/sha256"))
                .and_then(Value::as_str)
                .unwrap_or(&named)
                .to_string();
            let issue = |code: &'static str, what: &str| {
                deep_canvas::document::Issue::error(code, id, path.clone(), json!(named), what)
            };
            if sha.len() != 64 || crate::evidence::read(&self.scenario.evidence, &sha).is_none() {
                out.push(issue("unknown_asset", "the asset isn't in the evidence store"));
                continue;
            }
            let file = self.scenario.evidence.join(&sha[..2]).join(&sha[2..]);
            let (reply, _) = self.media_job(DECODE_WORKER, json!({"op": "probe", "path": file}));
            match reply.pointer("/asset/probe") {
                Some(probe) => {
                    if let Some(a) = doc.pointer_mut(&format!("/assets/{named}")).and_then(Value::as_object_mut) {
                        a.insert("probe".into(), probe.clone());
                    }
                }
                None => out.push(issue("unreadable_asset", "the decode worker couldn't probe the asset")),
            }
        }
        out
    }

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
                // #499: the worker's scaled frames encoded by the encode tool into a short-GOP
                // H.264 file (the worker never encodes), kept by its hash beside the asset.
                if let Ok(raw) = std::fs::read(&tmp) {
                    let _ = std::fs::remove_file(&tmp);
                    match self.encode_proxy(&raw, &tmp) {
                        Ok(bytes) => {
                            let sha = evidence::put(&self.scenario.evidence, &bytes).ok();
                            if let Some(p) = reply.get_mut("proxy").and_then(Value::as_object_mut) {
                                p.remove("path");
                                p.insert("sha256".into(), json!(sha));
                            }
                        }
                        Err(e) => return e,
                    }
                }
                reply
            }
            MediaCall::Export { source, out } => self.export(source, out),
            MediaCall::Table { from, key } => self.table_import(from, key),
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

    /// #499: a proxy's raw frames (the worker's header line, then I420 frames) through the encode
    /// tool at the proxy's GOP; the MP4's bytes.
    fn encode_proxy(&mut self, raw: &[u8], tmp: &std::path::Path) -> Result<Vec<u8>, Value> {
        let end = raw
            .iter()
            .position(|b| *b == b'\n')
            .ok_or_else(|| refused("bad_proxy"))?;
        let head: Value = serde_json::from_slice(&raw[..end]).map_err(|_| refused("bad_proxy"))?;
        let (w, h) = (
            head["size"][0].as_u64().unwrap_or(0) as usize,
            head["size"][1].as_u64().unwrap_or(0) as usize,
        );
        let frame = w * h * 3 / 2;
        let pts: Vec<i64> = (head["pts"].as_array().into_iter().flatten())
            .filter_map(|p| p[0].as_i64())
            .collect();
        let timescale = head["pts"][0][1].as_i64().unwrap_or(1);
        let dir = tmp.with_extension("frames");
        std::fs::create_dir_all(&dir).map_err(|_| refused("proxy_unwritable"))?;
        let mut paths = Vec::new();
        for (k, f) in raw[end + 1..].chunks_exact(frame.max(1)).enumerate() {
            let p = dir.join(format!("{k}.yuv"));
            std::fs::write(&p, f).map_err(|_| refused("proxy_unwritable"))?;
            paths.push(p.to_string_lossy().into_owned());
        }
        let out = tmp.with_extension("mp4");
        let job = json!({"op": "encode", "frames": paths, "pts": pts, "timescale": timescale,
            "size": [w, h], "gop": head["gop"], "out": out.to_string_lossy()});
        let (coded, _) = self.media_job(ENCODE_TOOL, job);
        let _ = std::fs::remove_dir_all(&dir);
        let bytes = std::fs::read(&out).map_err(|_| coded.clone())?;
        let _ = std::fs::remove_file(&out);
        Ok(bytes)
    }

    /// #397 (canvas primitives: Asset: tables): the table's bytes kept in the evidence store by
    /// hash and probed once in the decode worker; its record (the probe, every cell's raw bytes and
    /// range, and the source the hub writes: the URL and fetch time, or `agent`) kept beside it as
    /// `tables/<sha256>.json`, which a document's `{from: asset, column}` reads.
    fn table_import(&mut self, from: &TableFrom, key: &str) -> Value {
        let (bytes, source) = match from {
            TableFrom::Url(url) => {
                let fetched = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u64);
                let response = crate::capture::http(url, None);
                let body = response.as_deref().and_then(|r| {
                    let end = r.windows(4).position(|w| w == b"\r\n\r\n")?;
                    let ok = std::str::from_utf8(&r[..end]).ok()?.split(' ').nth(1) == Some("200");
                    ok.then(|| r[end + 4..].to_vec())
                });
                match body {
                    Some(b) => (b, json!({"url": url, "fetched": fetched})),
                    None => return json!({"code": "fetch_failed", "path": url}),
                }
            }
            TableFrom::Agent { path, session } => {
                if !self.scenario.sessions.contains_key(session) {
                    return json!({"code": "ref_unresolved", "path": session});
                }
                match std::fs::read(path) {
                    Ok(b) => (b, json!("agent")),
                    Err(_) => return json!({"code": "unreadable", "path": path}),
                }
            }
        };
        let root = self.scenario.evidence.clone();
        let Ok(sha) = evidence::put(&root, &bytes) else {
            return json!({"code": "evidence_unwritable", "path": "evidence"});
        };
        let file = root.join(&sha[..2]).join(&sha[2..]);
        let job = json!({"op": "table", "path": file.to_string_lossy(), "key": key});
        let (reply, _) = self.media_job(DECODE_WORKER, job);
        let Some(probe) = reply.get("probe") else {
            return reply;
        };
        let asset = json!({"sha256": sha, "kind": "table", "probe": {"table": probe["table"]}, "source": source});
        let mut record = asset.clone();
        record["cells"] = probe["cells"].clone();
        // #397's wrong program: the probe's cells kept NFC instead of their raw bytes.
        if self.scenario.planted == Some(Planted::ProbeStoresNormalized) {
            for cell in record["cells"]
                .as_object_mut()
                .into_iter()
                .flat_map(|c| c.values_mut())
            {
                for c in cell.as_array_mut().into_iter().flatten() {
                    c["raw"] = json!(deep_canvas::canon::nfc(c["raw"].as_str().unwrap_or("")));
                }
            }
        }
        let tables = root.join("tables");
        let written = std::fs::create_dir_all(&tables)
            .and_then(|_| std::fs::write(tables.join(format!("{sha}.json")), record.to_string()));
        if written.is_err() {
            return json!({"code": "evidence_unwritable", "path": "tables"});
        }
        json!({"asset": asset})
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
