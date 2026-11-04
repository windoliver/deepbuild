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

/// Every mark set column of `doc` that reads a table (`{from: table asset ID, column: name}`,
/// Mark set and columns; Asset: tables), read from the hub's `evidence` store as `table_import`
/// kept it: the table's bytes by the document asset's hash and its record beside them. Written in
/// place as the column's display values (a number column's as f64, a text column's cells NFC)
/// with its `trace`, as `deep-canvas-render` inlines them (#397), so the hub's own frame draws a
/// chart from the agent's table (#1162). Each column it can't read is an issue at its path.
pub fn inline_tables(doc: &mut Value, evidence: &std::path::Path) -> Vec<deep_canvas::document::Issue> {
    use deep_canvas::document::Issue;
    let mut issues = Vec::new();
    let assets = doc.get("assets").cloned().unwrap_or(Value::Null);
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return issues;
    };
    for (id, item) in items.iter_mut() {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let Some(Value::Object(columns)) = item.pointer_mut("/params/columns") else {
            continue;
        };
        for (name, column) in columns.iter_mut() {
            let (Some(asset), Some(field)) = (
                column.get("from").and_then(Value::as_str).map(str::to_string),
                column.get("column").and_then(Value::as_str).map(str::to_string),
            ) else {
                continue;
            };
            let path = format!("items/{id}/params/columns/{name}");
            let mut missing = |code: &'static str, at: String, what: &str| {
                issues.push(Issue::error(code, id, at, json!(asset), what));
            };
            let Some(hash) = assets[&asset]["sha256"].as_str().filter(|h| h.len() == 64) else {
                missing("ref_unresolved", format!("{path}/from"), "the document names no table asset by this ID");
                continue;
            };
            let file = std::fs::read(evidence.join(&hash[..2]).join(&hash[2..])).ok();
            let record = std::fs::read(evidence.join("tables").join(format!("{hash}.json")))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
            let (Some(file), Some(record)) = (file, record) else {
                missing("asset_missing", format!("{path}/from"), "no table with this hash was imported");
                continue;
            };
            if deep_canvas_marks::key::sha256_hex(&file) != hash {
                missing("asset_mismatch", format!("{path}/from"), "the stored bytes don't hash to the asset");
                continue;
            }
            let dtype = record["probe"]["table"]["columns"]
                .as_array()
                .and_then(|c| c.iter().find(|c| c["name"] == field.as_str()))
                .and_then(|c| c["dtype"].as_str())
                .map(str::to_string);
            let Some(dtype) = dtype else {
                missing("ref_unresolved", format!("{path}/column"), "the table has no such column");
                continue;
            };
            let cells = record["cells"][&field].as_array().cloned().unwrap_or_default();
            let mut traced = Vec::with_capacity(cells.len());
            for cell in &cells {
                let at = cell["bytes"][0].as_u64().zip(cell["bytes"][1].as_u64());
                let bytes = at.and_then(|(s, e)| file.get(s as usize..e as usize)).unwrap_or(&[]);
                let raw = cell["raw"].as_str().unwrap_or("");
                traced.push(json!({
                    "bytes": cell["bytes"], "text": deep_canvas::canon::nfc(raw),
                    "raw": deep_canvas::base64::encode(raw.as_bytes()),
                    "file": deep_canvas::base64::encode(bytes),
                }));
            }
            let texts = traced.iter().map(|c| c["text"].as_str().unwrap_or(""));
            let data = if dtype == "str" {
                json!(texts.collect::<Vec<_>>())
            } else {
                let mut out = Vec::with_capacity(cells.len() * 8);
                for t in texts {
                    out.extend_from_slice(&t.parse::<f64>().unwrap_or(f64::NAN).to_le_bytes());
                }
                json!(deep_canvas::base64::encode(&out))
            };
            *column = json!({
                "dtype": if dtype == "str" { "str" } else { "f64" }, "len": cells.len(), "data": data,
                "trace": {"table": asset, "column": field, "source": record["source"], "cells": traced},
            });
        }
    }
    issues
}
