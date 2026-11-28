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
        units: Map<String, Value>,
    },
    /// #194: a catalog's table files, each by its path, packed under its schema in the decode
    /// worker into table.layout@1.
    Catalog {
        tables: Vec<(String, String)>,
        schema: Value,
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
            units: match c.get("units") {
                None => Map::new(),
                Some(Value::Object(u)) if u.values().all(Value::is_string) => u.clone(),
                Some(_) => return None,
            },
        },
        "catalog_import" => MediaCall::Catalog {
            tables: c
                .get("tables")?
                .as_object()?
                .iter()
                .map(|(name, t)| Some((name.clone(), t.get("path")?.as_str()?.to_string())))
                .collect::<Option<_>>()?,
            schema: c.get("schema")?.clone(),
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
    /// #518: set when an encode job the tool was asked to open is dropped unfinished: the tool
    /// still waits for that job's frames, so its process is ended before anything else is asked.
    pub(crate) encoder_stale: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Proxies and exports so far, which name their scratch files.
    pub(crate) exports: usize,
    /// #499: video assets' probes and decoded frames.
    pub video: crate::video::Cache,
    /// #502: each script compiled, by its lines and the document's assets; the export that is
    /// running, which says how captions are laid out and drawn; and each caption as drawn.
    pub(crate) scripts:
        std::collections::BTreeMap<String, std::sync::Arc<crate::narration::Script>>,
    pub(crate) captions: Option<crate::narration::View>,
    pub(crate) captions_drawn:
        std::collections::BTreeMap<String, std::sync::Arc<crate::snapshot::Drawn>>,
    /// #509: whether the state folder's narration exception asks were read back.
    pub(crate) heard_restored: bool,
    /// #1967: each terminal recording a cell grid plays, by SHA-256, as the decode worker
    /// converted it: its keyframes and row patches, which sessions read as `terminal:<sha256>`.
    pub recordings: std::collections::BTreeMap<String, Value>,
    /// #1729: each 3D map the decode worker made ready, by `<sha256>:<role>`.
    pub(crate) maps:
        std::collections::BTreeMap<String, std::sync::Arc<deep_canvas_scene3d::light::Texels>>,
    /// #1801: each asset's size as its file gave it, by SHA-256; `None` for one with none.
    pub(crate) sizes: std::collections::BTreeMap<String, Option<deep_canvas::cost::AssetSize>>,
    /// #231: each asset the decode worker decoded for this process, in order: the asset and the
    /// seconds its decode took; and their sum.
    pub(crate) decodes: Vec<(String, f64)>,
    pub(crate) decoding: std::time::Duration,
    /// #231: the export that is running's `readings`: the record's changes on the film's clock,
    /// each `{t, handle, value?, state?, as_of?}`; and, planted, the time past which its frames
    /// read none of them.
    pub(crate) readings: Vec<Value>,
    pub(crate) readings_until: Option<i64>,
    /// #231: whether this process has begun an export: its first one's `wall` counts from the
    /// process's start.
    pub(crate) exported: bool,
}

/// #231: the asset a decode worker's job reads: its SHA-256 when its path is the evidence
/// store's (`<2 hex>/<62 hex>`), else the path.
fn asset_of(job: &Value) -> String {
    let path = job["path"].as_str().unwrap_or_default();
    let mut parts = path.rsplit('/');
    match (parts.next(), parts.next()) {
        (Some(rest), Some(head)) if head.len() == 2 && rest.len() == 62 => format!("{head}{rest}"),
        _ => path.to_string(),
    }
}

/// #503: a worker's refusal answers with its `code` and what it names at the reply's top level
/// too, beside `refused` (#498's place for it).
fn hoist(mut reply: Value) -> Value {
    if let Some(r) = reply.get("refused").and_then(Value::as_object).cloned() {
        if let Some(o) = reply.as_object_mut() {
            o.extend(r);
        }
    }
    reply
}

/// The worker-side name of a planted wrong program, if it is one the decode worker runs.
pub(crate) fn worker_planted(p: Option<Planted>) -> Option<&'static str> {
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
        Planted::Export(crate::export::Guard::Codec(name)) => name,
        Planted::VideoDropsFrame300 => "video_drops_frame_300",
        _ => return None,
    })
}

/// #1488: the run's image service, which every snapshot draws a still through, runs the planted
/// decoder that ignores a photo's EXIF orientation when the run plants it in the worker too.
pub(crate) fn plant_images(planted: Option<Planted>) {
    if worker_planted(planted) == Some("decoder_ignores_orientation") {
        let plant = deep_images::Plant::IgnoresOrientation;
        deep_images::shared().configure(deep_images::BUDGET, deep_images::ENTRIES, plant);
    }
}

impl Hub<'_> {
    /// #499: each item whose kind reads an asset's probe has the decode worker probe it, the
    /// trusted ring's, through the core: a module needs no media module to read an asset. The
    /// param names the document's asset (or holds its SHA-256); its probe is kept on that asset
    /// in `assets`. An asset the store lacks or the worker refuses is an issue on the item.
    pub(crate) fn probe_assets(&mut self, doc: &mut Value) -> Vec<deep_canvas::document::Issue> {
        let mut out = Vec::new();
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for (id, item) in &items {
            let Some(kind) = item.get("kind").and_then(Value::as_str) else {
                continue;
            };
            let Some(param) = self.startup.sealed.probed_param(kind).map(str::to_string) else {
                continue;
            };
            let path = format!("items/{id}/params/{param}");
            // #538: an item that names no asset there (a cell grid with a frame or a logic grid,
            // not a recording) has nothing to probe.
            let Some(named) = item.pointer(&format!("/params/{param}")) else {
                continue;
            };
            let named = named.as_str().unwrap_or("").to_string();
            let sha = doc
                .pointer(&format!("/assets/{named}/sha256"))
                .and_then(Value::as_str)
                .unwrap_or(&named)
                .to_string();
            let issue = |code: &'static str, what: &str| {
                deep_canvas::document::Issue::error(code, id, path.clone(), json!(named), what)
            };
            if sha.len() != 64 || crate::evidence::read(&self.scenario.evidence, &sha).is_none() {
                out.push(issue(
                    "unknown_asset",
                    "the asset isn't in the evidence store",
                ));
                continue;
            }
            let file = self.scenario.evidence.join(&sha[..2]).join(&sha[2..]);
            let (reply, _) = self.media_job(DECODE_WORKER, json!({"op": "probe", "path": file}));
            match reply.pointer("/asset/probe") {
                Some(probe) => {
                    if let Some(a) = doc
                        .pointer_mut(&format!("/assets/{named}"))
                        .and_then(Value::as_object_mut)
                    {
                        a.insert("probe".into(), probe.clone());
                    }
                }
                None => out.push(issue(
                    "unreadable_asset",
                    "the decode worker couldn't probe the asset",
                )),
            }
            // #1967: a terminal recording is converted once, in the worker, and kept by its hash.
            let terminal = reply.pointer("/asset/kind").and_then(Value::as_str) == Some("terminal");
            if terminal && !self.media.recordings.contains_key(&sha) {
                let (mut reply, _) =
                    self.media_job(DECODE_WORKER, json!({"op": "decode", "path": file}));
                match reply.get_mut("decoded").map(Value::take) {
                    Some(converted) => {
                        self.media.recordings.insert(sha, converted);
                    }
                    None => out.push(issue(
                        "unreadable_asset",
                        "the decode worker couldn't convert the recording",
                    )),
                }
            }
        }
        // #509: a document that names a narration line's time gets the script's spoken times.
        out.extend(self.stamp_spoken(doc));
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
        self.end_stale_encoder();
        let slot = match role {
            ENCODE_TOOL => &mut self.media.encoder,
            _ => &mut self.media.decoder,
        };
        if slot.is_none() {
            let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
            // #1967's planted import lives in the cells module's conversion, in the worker, and
            // #194's planted packers in its catalog job.
            let module = self.scenario.module_planted.as_deref();
            let import = module.filter(|p| {
                *p == "cells_patch_times_whole_seconds" || deep_codecs::catalog::PLANTED.contains(p)
            });
            match Helper::start(
                &exe,
                role,
                &self.scenario.decode_caps,
                worker_planted(planted).or(import),
            ) {
                Ok(h) => {
                    *slot = Some(h);
                }
                Err(e) => return (json!({"error": format!("the {role} didn't start: {e}")}), 0),
            }
        }
        let h = slot.as_mut().expect("started");
        let at = std::time::Instant::now();
        let answered = (h.ask(&job), h.pid);
        // #231: an asset's decode is reported, with the time it took.
        if role == DECODE_WORKER && matches!(job["op"].as_str(), Some("decode" | "transcode")) {
            let took = at.elapsed();
            self.media
                .decodes
                .push((asset_of(&job), took.as_secs_f64()));
            self.media.decoding += took;
        }
        answered
    }

    /// #1488: the still at `path` converted at intake by the decode worker: the PNG it wrote and
    /// the source are put in the evidence store, and the reply is the PNG's asset.
    fn convert(&mut self, path: &str) -> Result<Value, String> {
        let n = self.media.exports;
        self.media.exports += 1;
        let out = std::env::temp_dir().join(format!("deep-still-{}-{n}.png", std::process::id()));
        let job = json!({"op": "convert", "path": path, "out": out.to_string_lossy()});
        let (reply, _) = self.media_job(DECODE_WORKER, job);
        let png = std::fs::read(&out);
        let _ = std::fs::remove_file(&out);
        let Some(sha) = reply.pointer("/asset/sha256").and_then(Value::as_str) else {
            return Ok(reply);
        };
        let png = png.map_err(|e| e.to_string())?;
        let source = std::fs::read(path).map_err(|e| e.to_string())?;
        let evidence = &self.scenario.evidence;
        let kept = evidence::put(evidence, &png).map_err(|e| e.to_string())?;
        let input = evidence::put(evidence, &source).map_err(|e| e.to_string())?;
        if kept != sha || reply.pointer("/asset/made_by/input") != Some(&json!(input)) {
            return Err("the converted picture or its source changed on the way".into());
        }
        Ok(reply)
    }

    /// #518: ends the encode tool's process when a job it was asked to open was dropped
    /// unfinished: its stdin closes, it removes what it wrote, and it is waited for.
    pub(crate) fn end_stale_encoder(&mut self) {
        use std::sync::atomic::Ordering;
        if self.media.encoder_stale.swap(false, Ordering::Relaxed) {
            self.media.encoder = None;
        }
    }

    /// #157: the run's encode tool, started on first use, for a job that streams its frames.
    pub(crate) fn encode_tool(&mut self) -> Result<&mut Helper, Value> {
        self.end_stale_encoder();
        if self.media.encoder.is_none() {
            let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
            let h = Helper::start(&exe, ENCODE_TOOL, &self.scenario.decode_caps, worker_planted(self.scenario.planted))
                .map_err(|e| json!({"code": "encoder_unstarted", "why": format!("the encode tool didn't start: {e}")}))?;
            self.media.encoder = Some(h);
        }
        Ok(self.media.encoder.as_mut().expect("started"))
    }

    /// #157: a fresh decode worker, apart from the run's and from the encode tool, for reading one
    /// delivery under caps that fit it; ended when dropped.
    pub(crate) fn fresh_decoder(&self, caps: &Caps) -> Result<Helper, Value> {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
        Helper::start(&exe, DECODE_WORKER, caps, worker_planted(self.scenario.planted))
            .map_err(|e| json!({"code": "decoder_unstarted", "why": format!("the decode worker didn't start: {e}")}))
    }

    pub fn media_call(&mut self, call: &MediaCall) -> Value {
        match call {
            MediaCall::Import(path) => {
                let (mut reply, pid) =
                    self.media_job(DECODE_WORKER, json!({"op": "probe", "path": path}));
                // #1488: a still in a format draw code doesn't read converts to a PNG in the
                // worker; the PNG and its source are kept by their hashes, the PNG the asset.
                if reply.pointer("/asset/probe/streams/0/convert") == Some(&json!("png")) {
                    reply = self.convert(path).unwrap_or_else(|e| json!({"error": e}));
                }
                reply["worker"] = json!({"pid": pid});
                hoist(reply)
            }
            MediaCall::Decode(c) => {
                let mut job = c.clone();
                job.insert("op".into(), json!("decode"));
                let (mut reply, pid) = self.media_job(DECODE_WORKER, Value::Object(job));
                match reply.get_mut("decoded") {
                    Some(d) => d["worker"] = json!({"pid": pid}),
                    None => reply["worker"] = json!({"pid": pid}),
                }
                hoist(reply)
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
            MediaCall::Table { from, key, units } => self.table_import(from, key, units),
            MediaCall::Catalog { tables, schema } => self.catalog_import(tables, schema),
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
    fn table_import(&mut self, from: &TableFrom, key: &str, units: &Map<String, Value>) -> Value {
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
        let mut table = probe["table"].clone();
        for (column, unit) in units {
            let named = table["columns"]
                .as_array_mut()
                .and_then(|cs| cs.iter_mut().find(|c| c["name"] == column.as_str()));
            let Some(named) = named else {
                return json!({"code": "ref_unresolved", "path": format!("units/{column}")});
            };
            named["unit"] = unit.clone();
        }
        let asset =
            json!({"sha256": sha, "kind": "table", "probe": {"table": table}, "source": source});
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

    /// #194 (canvas primitives: Asset: tables: catalogs `table.layout@1`): each table file kept
    /// in the evidence store by hash, the catalog packed from those copies in the decode worker,
    /// its bytes kept by their hash and its record beside them as `catalogs/<sha256>.json`, which
    /// the catalog checks and logic.tuning read. A file's format is its path's extension's.
    fn catalog_import(&mut self, tables: &[(String, String)], schema: &Value) -> Value {
        let root = self.scenario.evidence.clone();
        let mut files = Map::new();
        let mut job_tables = Map::new();
        for (name, path) in tables {
            let Some(format) = [".csv", ".jsonl"]
                .into_iter()
                .find(|e| path.to_ascii_lowercase().ends_with(e))
            else {
                return json!({"code": "bad_input", "path": path, "what": "a catalog file is .csv or .jsonl"});
            };
            let Ok(bytes) = std::fs::read(path) else {
                return json!({"code": "unreadable", "path": path});
            };
            let Ok(sha) = evidence::put(&root, &bytes) else {
                return json!({"code": "evidence_unwritable", "path": "evidence"});
            };
            let file = root.join(&sha[..2]).join(&sha[2..]);
            job_tables.insert(
                name.clone(),
                json!({"path": file.to_string_lossy(), "format": &format[1..]}),
            );
            files.insert(name.clone(), json!(sha));
        }
        let n = self.media.exports;
        self.media.exports += 1;
        let out = std::env::temp_dir().join(format!("deep-catalog-{}-{n}", std::process::id()));
        let job = json!({"op": "catalog", "tables": job_tables, "schema": schema,
                         "out": out.to_string_lossy()});
        let (reply, _) = self.media_job(DECODE_WORKER, job);
        let packed = std::fs::read(&out);
        let _ = std::fs::remove_file(&out);
        let Some(catalog) = reply.get("catalog") else {
            return reply;
        };
        let Ok(bytes) = packed else {
            return json!({"code": "unreadable", "path": "the packed catalog"});
        };
        let sha = match evidence::put(&root, &bytes) {
            Ok(sha) if Some(sha.as_str()) == catalog["sha256"].as_str() => sha,
            _ => return json!({"code": "evidence_unwritable", "path": "evidence"}),
        };
        let record = catalog["record"].clone();
        let dir = root.join("catalogs");
        let written = std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(dir.join(format!("{sha}.json")), record.to_string()));
        if written.is_err() {
            return json!({"code": "evidence_unwritable", "path": "catalogs"});
        }
        json!({"asset": {"sha256": sha, "kind": "catalog", "layout": "table.layout@1",
                          "catalog": {"tables": files, "schema": schema}},
               "record": record})
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
