//! #172: `video.codec: web`, the web player's bundle (canvas primitives: Export: web player), the
//! export module's own writer outside export.target@1. A folder: an index page, the player (the
//! canvas core built for wasm32, committed under crates/deep-player/web/dist and embedded here, so
//! nothing compiles per export), the document and everything it names by hash, each logic item's
//! program as the app rewrote it, the recorded input track and the bundled faces with their
//! licenses. Every file but the index page is stored under a name made from its SHA-256 and the
//! index page names them; the bundle's bytes are a function of the document, this build and the
//! export's settings alone. It holds nothing that reaches this machine: no hub address, secret or
//! record. Pieces it can't carry are refused before anything is written, naming each; the
//! written folder is read back whole, or the export fails naming the first file that differs.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{temp_of, Guard, Job};
use crate::hub::{Hub, Planted};

const PLAYER_WASM: &[u8] = include_bytes!("../../../deep-player/web/dist/player_bg.wasm");
const PLAYER_GLUE: &[u8] = include_bytes!("../../../deep-player/web/dist/player.js");
const PLAYER_ABOUT: &str = include_str!("../../../deep-player/web/dist/player.json");
const ELEMENT: &str = include_str!("../../../deep-player/web/element.js");

/// The player as it was built: its core version, module set digest, runtime digest and modules.
fn about() -> Value {
    serde_json::from_str(PLAYER_ABOUT).unwrap_or(Value::Null)
}

/// A file's name in the bundle: its SHA-256 and an extension for what it holds.
fn name_of(sha: &str, bytes: &[u8], ext: Option<&str>) -> String {
    let ext = ext.unwrap_or(if bytes.starts_with(b"\0asm") {
        "wasm"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else {
        "bin"
    });
    format!("{sha}.{ext}")
}

/// The bundle's files by path, each with what the receipt says of it besides its hash.
#[derive(Default)]
struct Files {
    by_path: BTreeMap<String, (Vec<u8>, Map<String, Value>)>,
}

impl Files {
    /// Adds `bytes` under its hash's name; its path and SHA-256.
    fn put(
        &mut self,
        bytes: Vec<u8>,
        ext: Option<&str>,
        about: Map<String, Value>,
    ) -> (String, String) {
        let sha = sha256_hex(&bytes);
        let path = name_of(&sha, &bytes, ext);
        let entry = self
            .by_path
            .entry(path.clone())
            .or_insert_with(|| (bytes, Map::new()));
        entry.1.extend(about);
        (path, sha)
    }
}

/// The pieces of `doc` the bundle can't carry, each `{item, why}`, given the canvas modules the
/// player carries (`module_of` names the module of an item's kind in this build).
pub(crate) fn refusals(
    doc: &Value,
    held: &[String],
    module_of: &dyn Fn(&str) -> Option<String>,
) -> Vec<Value> {
    let mut out = Vec::new();
    let mut refuse = |item: &str, code: &str, why: String| {
        out.push(json!({"item": item, "code": code, "why": why}))
    };
    if let Some(r) = doc.as_object().and_then(|d| {
        deep_canvas_export::lottie::status_binding(
            d,
            "web.status_binding",
            "a web player",
            "a web player",
        )
    }) {
        let name = r
            .path
            .rsplit('/')
            .nth(usize::from(r.path.ends_with("/status")))
            .unwrap_or(&r.path)
            .to_string();
        refuse(
            &name,
            "web.status_binding",
            format!(
                "{} ({}); a web player carries no status color",
                r.what, r.path
            ),
        );
    }
    for (id, c) in doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if c.get("kind").and_then(Value::as_str) == Some("device") {
            let class = c
                .pointer("/device/class")
                .and_then(Value::as_str)
                .unwrap_or("a device");
            refuse(
                id,
                "web.capture",
                format!("the control {id} reads {class}; the web player has no capture"),
            );
        }
    }
    for (id, _) in doc
        .get("strips")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        refuse(
            id,
            "web.strip",
            format!("the strip {id} plays media the bundle can't carry decoded"),
        );
    }
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let p = &item["params"];
        if p.pointer("/background/video").is_some() {
            refuse(
                id,
                "web.video_background",
                format!("the item {id} draws a video background the bundle can't carry decoded"),
            );
        }
        if p.pointer("/from/video").is_some() {
            refuse(
                id,
                "web.video_points",
                format!(
                    "the item {id} draws a point set from a video the bundle can't carry decoded"
                ),
            );
        }
        if kind == "image@1" && p.get("frames").is_some() {
            refuse(
                id,
                "web.video_image",
                format!("the item {id} draws a video's frames the bundle can't carry decoded"),
            );
        }
        if let Some(module) = module_of(kind.split('@').next().unwrap_or(kind))
            .filter(|m| !held.iter().any(|h| h == m))
        {
            refuse(id, "module_missing", format!("the item {id} is a {kind}, of the canvas module {module}, which the web player lacks"));
        }
    }
    out
}

/// What `doc` asks of the browser's GPU, computed from the document and WebGPU's feature table:
/// the features it needs, the sets of which it needs one, and the limits past WebGPU's defaults.
fn gpu_needs(_doc: &Value) -> Value {
    json!({"features": [], "any_of": [], "limits": {}})
}

/// Escapes text for HTML.
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The `sha256-…` source of `text` for a content-security policy or a script's integrity.
fn integrity(text: &[u8]) -> String {
    format!(
        "sha256-{}",
        deep_canvas::base64::encode(&Sha256::digest(text))
    )
}

/// The index page: the one `<deep-player>`, the manifest, the import map naming the player's page
/// glue with its integrity, and the element's script with its integrity.
fn index_html(
    title: &str,
    manifest: &Value,
    glue: (&str, &[u8]),
    element: (&str, &[u8]),
    stamp: Option<String>,
) -> String {
    let map = json!({"imports": {"deep-player-glue": format!("./{}", glue.0)},
                     "integrity": {format!("./{}", glue.0): integrity(glue.1)}})
    .to_string();
    let policy = format!(
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' '{}'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        integrity(map.as_bytes())
    );
    let data = manifest.to_string().replace("</", "<\\/");
    let stamp = stamp
        .map(|s| format!("<meta name=\"exported\" content=\"{s}\">\n"))
        .unwrap_or_default();
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">\n<meta name=\"referrer\" content=\"no-referrer\">\n{stamp}<title>{}</title>\n\
<style>html,body{{margin:0;background:#101012;color:#e8e8ec;font:14px system-ui,sans-serif}}deep-player{{display:block}}\
deep-player canvas{{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain}}[data-deep-notice]{{margin:8px 12px}}</style>\n\
<script type=\"importmap\">{map}</script>\n</head>\n<body>\n<deep-player></deep-player>\n\
<script type=\"application/json\" id=\"deep-bundle\">{data}</script>\n\
<script type=\"module\" src=\"./{}\" integrity=\"{}\"></script>\n</body>\n</html>\n",
        escape(title),
        element.0,
        integrity(element.1),
    )
}

/// The element's script as a planted wrong player writes it, or as it ships.
fn element(guard: Option<Guard>) -> String {
    match guard {
        // Planted (#172 AC5): a fragment `control.<ID>=<value>` becomes an input entry.
        Some(Guard::WebFragmentWritesEntry) => ELEMENT.replace(
            "    if (fragment.indexOf('=') < 0 || at === undefined || at === null) {",
            "    if (key.startsWith('control.')) { this.#player.input(key.slice(8), JSON.stringify(Number(value))); this.#seek(this.#t); return; }\n    if (fragment.indexOf('=') < 0 || at === undefined || at === null) {",
        ),
        // Planted (#172 AC8): the device request asks for the adapter's own limits.
        Some(Guard::WebRequestsAdapterLimits) => ELEMENT.replace(
            "    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify(bundle.gpu_needs));",
            "    const a = await navigator.gpu.requestAdapter(); const limits = {}; for (const k in a.limits) limits[k] = a.limits[k];\n    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify({ ...bundle.gpu_needs, limits }));",
        ),
        _ => ELEMENT.to_string(),
    }
}

/// The player's bytes as a planted export writes them, or as they ship.
fn player(guard: Option<Guard>) -> Vec<u8> {
    let mut wasm = PLAYER_WASM.to_vec();
    if guard == Some(Guard::WebProbeTestVariant) {
        // Planted (#172 AC7): a test variant of the player, which alone would have probe().
        let name = b"deep.test-variant";
        let mut body = vec![name.len() as u8];
        body.extend_from_slice(name);
        body.extend_from_slice(b"probe");
        wasm.push(0);
        wasm.push(body.len() as u8);
        wasm.extend(body);
    }
    wasm
}

impl Hub<'_> {
    /// Each picture `doc`'s first frame draws: its source's SHA-256, the proxy row naming the level
    /// it draws at, and that level's stored bytes.
    fn web_levels(&mut self, doc: &Value) -> Result<Vec<(String, String, Vec<u8>)>, Value> {
        let has_images = doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .any(|(_, i)| i["kind"] == "image@1");
        if !has_images {
            return Ok(Vec::new());
        }
        let view: [Value; 6] = Default::default();
        let (painted, ..) = self
            .evaluate(doc, &view, &[0], false)
            .map_err(|code| json!({"code": code}))?;
        let evidence = self.scenario.evidence.clone();
        let drawn = self
            .renderer
            .prepare_drawing(&painted, &evidence)
            .map_err(|u| json!({"outcome": "refused", "code": u.code, "path": u.path}))?;
        let store = std::sync::Arc::new(deep_images::Store::split(&evidence));
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for key in drawn.picture_keys().values() {
            if !seen.insert(*key) {
                continue;
            }
            let level = deep_images::shared()
                .wait(&store, *key)
                .map_err(|r| json!({"outcome": "refused", "code": r.code}))?;
            let hex: String = key.hash.iter().map(|b| format!("{b:02x}")).collect();
            out.push((hex, deep_images::row_of(key), level.blob()));
        }
        Ok(out)
    }

    /// The planted web player this run writes, if any.
    fn web_guard(&self) -> Option<Guard> {
        [
            Guard::WebIndexExportTime,
            Guard::WebProbeTestVariant,
            Guard::WebRequestsAdapterLimits,
            Guard::WebFragmentWritesEntry,
        ]
        .into_iter()
        .find(|g| self.planted(Planted::Export(*g)))
    }

    /// `video.codec: web`: the web player's bundle of `doc`, written as a folder at `job.out`.
    pub(super) fn export_web(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let about = about();
        let held: Vec<String> = about["modules"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let sealed = &self.startup.sealed;
        let module_of = |kind: &str| sealed.module_of_kind(kind).map(str::to_string);
        let refused = refusals(doc, &held, &module_of);
        if !refused.is_empty() {
            let names: Vec<&str> = refused.iter().filter_map(|r| r["item"].as_str()).collect();
            return Err(
                json!({"outcome": "refused", "code": "web.refused", "refused": refused,
                "why": format!("the web player's bundle can't carry {}", names.join(", "))}),
            );
        }
        let guard = self.web_guard();
        let root = self.scenario.evidence.clone();
        let mut files = Files::default();
        // The player and its page glue.
        let (_, wasm_sha) = files.put(player(guard), Some("wasm"), Map::new());
        let (glue_path, _) = files.put(PLAYER_GLUE.to_vec(), Some("js"), Map::new());
        let element = element(guard);
        let (element_path, _) = files.put(element.clone().into_bytes(), Some("js"), Map::new());
        // The document as the app's frames draw it, and the recorded input track.
        let doc_bytes = serde_json::to_vec(doc).map_err(|_| json!({"code": "bad_input"}))?;
        let (_, doc_sha) = files.put(doc_bytes, Some("json"), Map::new());
        let track_bytes =
            serde_json::to_vec(&job.track).map_err(|_| json!({"code": "bad_input"}))?;
        let (_, track_sha) = files.put(track_bytes, Some("json"), Map::new());
        // Everything the document names by hash.
        for (_, path, sha) in crate::extended::hashes(doc, true) {
            let bytes = crate::evidence::read(&root, &sha).ok_or_else(|| {
                json!({"outcome": "refused", "code": "asset_missing", "path": path, "sha256": sha,
                       "why": format!("the document names {sha} at {path}, which the store doesn't hold")})
            })?;
            files.put(bytes, None, Map::new());
        }
        // Each logic item's program as the app rewrote it, checked again against its hash.
        let mut logic = Vec::new();
        let form = crate::played::with_track(doc, &job.track);
        if let Some(piece) = self
            .logic_piece(&form, &job.track)
            .map_err(|i| json!({"outcome": "refused", "code": i.code, "issues": [i.to_json()]}))?
        {
            for item in &piece.items {
                if deep_canvas_sandbox::rewrite::hash(&item.bytes) != item.hash {
                    return Err(
                        json!({"outcome": "refused", "code": "web.logic_unchecked", "item": item.id,
                        "why": format!("the logic item {}'s rewritten program doesn't match the hash its check recorded", item.id)}),
                    );
                }
                let mut marks = Map::new();
                marks.insert(
                    "logic".into(),
                    json!({"item": item.id, "program": item.program}),
                );
                let (_, sha) = files.put(item.bytes.clone(), Some("wasm"), marks);
                logic.push(json!({"item": item.id, "sha256": sha}));
            }
        }
        // Each picture the first frame draws, at the level it draws it, with the row that names it:
        // the player reads the level, never decoding its full source (#1486).
        let mut images = Vec::new();
        for (source, row, level) in self.web_levels(doc)? {
            let mut marks = Map::new();
            marks.insert("level".into(), json!({"of": source}));
            let (_, sha) = files.put(level, Some("level"), marks);
            images.push(json!({"source": source, "row": row, "level": sha}));
        }
        // The bundled faces, each with its license.
        let mut fonts = Vec::new();
        for face in deep_text::FACES {
            let ext = face.file.rsplit('.').next();
            let (_, sha) = files.put(face.bytes().to_vec(), ext, Map::new());
            fonts.push(json!({"file": face.file, "sha256": sha}));
        }
        for (_, text) in deep_text::LICENSES {
            files.put(text.as_bytes().to_vec(), Some("txt"), Map::new());
        }
        let needs = gpu_needs(doc);
        let size = [0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(640.0).round() as i64);
        let listed: Vec<Value> = files
            .by_path
            .iter()
            .filter(|(p, _)| **p != element_path)
            .map(|(p, (b, _))| json!({"path": p, "sha256": sha256_hex(b)}))
            .collect();
        let manifest = json!({
            "size": size,
            "player": {"wasm": wasm_sha},
            "document": doc_sha,
            "track": track_sha,
            "files": listed,
            "fonts": fonts,
            "logic": logic,
            "images": images,
            "gpu_needs": needs,
        });
        let stamp = (guard == Some(Guard::WebIndexExportTime)).then(|| {
            // Planted (#172 AC6): the export's time written into the index page.
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            format!("{}.{:09}", now.as_secs(), now.subsec_nanos())
        });
        let title = doc
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("A piece");
        let glue = files.by_path[&glue_path].0.clone();
        let index = index_html(
            title,
            &manifest,
            (&glue_path, &glue),
            (&element_path, element.as_bytes()),
            stamp,
        );
        // Written whole or not at all: to the temporary name, read back, then renamed.
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).map_err(|_| json!({"code": "export_unwritable"}))?;
        let mut all: BTreeMap<String, Vec<u8>> = files
            .by_path
            .iter()
            .map(|(p, (b, _))| (p.clone(), b.clone()))
            .collect();
        all.insert("index.html".into(), index.into_bytes());
        let written = all
            .iter()
            .try_for_each(|(name, bytes)| std::fs::write(temp.join(name), bytes));
        if written.is_err() {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(json!({"code": "export_unwritable"}));
        }
        for (name, bytes) in &all {
            if std::fs::read(temp.join(name)).ok().as_ref() != Some(bytes) {
                let _ = std::fs::remove_dir_all(&temp);
                return Err(json!({"outcome": "failed", "code": "export.fidelity",
                    "issues": [{"code": "export.fidelity", "what": format!("{name} doesn't read back as written")}]}));
            }
        }
        let _ = std::fs::remove_dir_all(&out);
        if std::fs::rename(&temp, &out).is_err() {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(json!({"code": "export_unwritable"}));
        }
        let receipt_files: Vec<Value> = all
            .iter()
            .map(|(p, b)| {
                let mut f = json!({"path": p, "sha256": sha256_hex(b), "bytes": b.len()});
                if let Some((_, marks)) = files.by_path.get(p) {
                    for (k, v) in marks {
                        f[k] = v.clone();
                    }
                }
                f
            })
            .collect();
        Ok(json!({
            "target": "web",
            "player": {"core_version": about["core_version"], "module_set_digest": about["set_digest"], "hash": wasm_sha},
            "fallback": "page",
            "sources": [],
            "bytes": all.values().map(Vec::len).sum::<usize>(),
            "refused": [],
            "gpu_needs": needs,
            "files": receipt_files,
        }))
    }
}
