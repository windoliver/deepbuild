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
//!
//! #1490: the player ships as a few fixed module sets, each built once per release (figure,
//! game2d, full), and the export takes the smallest that holds every canvas module the document
//! uses, read from the check's registry; a set that lacks one is refused, naming the module.
//!
//! #2892: a bundle weighs the same on any host. Every file but the index page, the two scripts the
//! browser loads itself (the element's script and the page glue) and the files whose format
//! compresses its own data is stored as gzip ([`super::gzip`]), named by the SHA-256 of its stored
//! bytes; the index gives each one's inflated size and the SHA-256 the document names it by, and
//! the page inflates a file only after its stored bytes match its name. The read-back inflates
//! each stored file and matches it, all or nothing.
//!
//! #1042: a piece's data is what the export recorded, the readings its bound values show, by hash
//! with their as-of times, and the public sources it declares ([`super::sources`]), which the
//! player goes on asking; a source that answers only with a key is refused, naming it. Light is
//! today's light in the player, since WebGPU has no ray queries, so a light policy that names
//! ray-traced light falls back to it and the receipt lists the fallback. Each bundled face is
//! subset to the glyphs the piece's text can show ([`super::subset`]).

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas::canon::sha256_hex;
use deep_canvas::registry::Sealed;
use deep_canvas_export::page::write;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::gzip::{gunzip, gzip};
use super::{temp_of, Guard, Job};
use crate::hub::{Hub, Planted};

const ELEMENT: &str = include_str!("../../../deep-player/web/element.js");

/// One of the player's prebuilt module sets: its name, its player's bytes and page glue, the player
/// as the bundle stores it (#2892, deflated once by the build script), and what its build recorded
/// of it (`player.json`: core version, module set digest, runtime digest and the canvas modules it
/// carries).
struct Set {
    name: &'static str,
    wasm: &'static [u8],
    stored: &'static [u8],
    glue: &'static [u8],
    about: &'static str,
}

macro_rules! set {
    ($name:literal) => {
        Set {
            name: $name,
            wasm: include_bytes!(concat!(
                "../../../deep-player/web/dist/",
                $name,
                "/player_bg.wasm"
            )),
            stored: include_bytes!(concat!(env!("OUT_DIR"), "/", $name, ".wasm.gz")),
            glue: include_bytes!(concat!(
                "../../../deep-player/web/dist/",
                $name,
                "/player.js"
            )),
            about: include_str!(concat!(
                "../../../deep-player/web/dist/",
                $name,
                "/player.json"
            )),
        }
    };
}

/// The player's module sets, smallest first (crates/deep-player/web/dist/sets.json), each holding
/// the one before it.
static SETS: [Set; 3] = [set!("figure"), set!("game2d"), set!("full")];

/// #280: the full set's player and its page glue, which net.budget's web part plays a piece in.
pub(crate) fn full_player() -> (&'static [u8], &'static [u8]) {
    let full = &SETS[SETS.len() - 1];
    (full.wasm, full.glue)
}

impl Set {
    /// The set as its build recorded it.
    fn about(&self) -> Value {
        serde_json::from_str(self.about).unwrap_or(Value::Null)
    }

    /// The canvas modules its player carries.
    fn modules(&self) -> Vec<String> {
        self.about()["modules"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    }
}

/// The canvas modules `doc` uses, each with the first place that uses it, read from the check's
/// registry `sealed`: each item's kind by the module that registered it, and each param of it a
/// module evaluates; each control's kind (the input module's); each world (the physics
/// module's); and each module the document requires.
fn modules_used(doc: &Value, sealed: &Sealed) -> BTreeMap<String, String> {
    let mut used: BTreeMap<String, String> = BTreeMap::new();
    let mut add = |module: &str, at: String| {
        used.entry(module.to_string()).or_insert(at);
    };
    let kinds = sealed.kinds();
    let section = |name: &str| {
        doc.get(name)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
    };
    for (id, item) in section("items") {
        let Some((full, major)) = item
            .get("kind")
            .and_then(Value::as_str)
            .and_then(deep_canvas::kinds::parse_kind)
        else {
            continue;
        };
        if let Some(module) = sealed.module_of_kind(&full) {
            add(module, format!("items/{id}/kind"));
        }
        let Some(version) = kinds.entry(&full).and_then(|e| e.version(major)) else {
            continue;
        };
        for (name, value) in item
            .get("params")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some(p) = version.param(name).filter(|p| !p.module.is_empty()) {
                if !value.is_null() {
                    add(p.module, format!("items/{id}/params/{name}"));
                }
            }
        }
    }
    for (id, c) in section("controls") {
        if c.get("kind").is_some() {
            add("input", format!("controls/{id}/kind"));
        }
    }
    for (id, _) in section("worlds") {
        add("physics", format!("worlds/{id}"));
    }
    for (module, _) in doc
        .pointer("/requires/modules")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        add(module, format!("requires/modules/{module}"));
    }
    used
}

/// The ID a place in the document names: an item's, a control's or a world's, or the module a
/// document requires.
fn id_at(at: &str) -> &str {
    at.split('/').nth(1).map_or(at, |id| {
        if at.starts_with("requires/") {
            at.rsplit('/').next().unwrap_or(id)
        } else {
            id
        }
    })
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

    /// #2892: the files as the bundle stores them. Those at `as_is` (the scripts the browser loads
    /// itself) and those whose format compresses its own data, marked `compresses_itself`, keep
    /// their bytes and names; every other is stored as gzip under `<SHA-256 of its stored
    /// bytes>.gz`, marked `inflated` with its size and the SHA-256 the document names it by.
    /// `prebuilt` gives a file's stored form by that SHA-256 where the build already deflated it
    /// (the player's set); `stamp` writes a time into each gzip header (a planted export).
    fn stored(self, as_is: &[&str], prebuilt: Option<(&str, &[u8])>, stamp: Option<u32>) -> Files {
        let mut out = Files::default();
        for (path, (bytes, mut marks)) in self.by_path {
            if as_is.contains(&path.as_str()) {
                out.by_path.insert(path, (bytes, marks));
                continue;
            }
            if compresses_itself(&bytes) {
                marks.insert("compresses_itself".into(), json!(true));
                out.by_path.insert(path, (bytes, marks));
                continue;
            }
            let sha = sha256_hex(&bytes);
            let held = prebuilt
                .filter(|(of, _)| *of == sha)
                .map(|(_, b)| b.to_vec());
            let mut stored = held.unwrap_or_else(|| gzip(&bytes));
            if let Some(t) = stamp {
                // Planted (#2892 AC7): the export's time in the gzip header's MTIME.
                stored[4..8].copy_from_slice(&t.to_le_bytes());
            }
            marks.insert(
                "inflated".into(),
                json!({"bytes": bytes.len(), "sha256": sha}),
            );
            let name = format!("{}.gz", sha256_hex(&stored));
            out.by_path.insert(name, (stored, marks));
        }
        out
    }

    /// The path a file named `sha` in the document is stored at: its own, or its stored form's.
    fn path_of(&self, sha: &str) -> Option<&str> {
        self.by_path.iter().find_map(|(p, (b, marks))| {
            let of = marks.get("inflated").and_then(|i| i["sha256"].as_str());
            (of == Some(sha) || (of.is_none() && sha256_hex(b) == sha)).then_some(p.as_str())
        })
    }
}

/// #2892: whether `bytes` are of a format that compresses its own data, which the bundle stores as
/// it is: PNG, JPEG, GIF and WebP pictures, a KTX2 map under supercompression, FLAC and Ogg sound.
pub(super) fn compresses_itself(bytes: &[u8]) -> bool {
    let at = |o: usize, magic: &[u8]| bytes.get(o..o + magic.len()) == Some(magic);
    let ktx2_super = deep_codecs::maps::is_ktx2(bytes)
        && bytes
            .get(44..48)
            .is_some_and(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) != 0);
    at(0, &[0x89, b'P', b'N', b'G'])
        || at(0, &[0xff, 0xd8, 0xff])
        || at(0, b"GIF8")
        || (at(0, b"RIFF") && at(8, b"WEBP"))
        || at(0, b"fLaC")
        || at(0, b"OggS")
        || ktx2_super
}

/// The pieces of `doc` the bundle can't carry, each `{item, why}`, given the canvas modules it
/// uses that the player's set `set` lacks (`missing`: each with the first place that uses it).
fn refusals(doc: &Value, missing: &BTreeMap<String, String>, set: &str) -> Vec<Value> {
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
    }
    for (module, at) in missing {
        let id = id_at(at);
        out.push(json!({"item": id, "code": "module_missing", "module": module,
            "why": format!("{at} uses the canvas module {module}, which the web player's {set} set lacks")}));
    }
    out
}

/// #1042: what the web path draws where `doc`'s light policy names ray-traced light (Light: ray
/// traced: a `rays` other than `off`, or `effects`), as the receipt's `stand_in` lists it: today's
/// light, for each light that casts a shadow when shadows are among the policy's effects, and
/// for the policy itself when no light is.
fn light_fallbacks(doc: &Value) -> Vec<Value> {
    let policy = &doc["light_policy"];
    let effects = policy.get("effects");
    let named = match policy.get("rays") {
        Some(rays) => rays != "off",
        None => effects.is_some(),
    };
    if !named {
        return Vec::new();
    }
    let shadows = effects
        .and_then(Value::as_array)
        .is_none_or(|e| e.contains(&json!("shadows")));
    let lights = doc["items"].as_object().into_iter().flatten();
    let mut of: Vec<&str> = lights
        .filter(|(_, i)| shadows && i["params"]["shadow"] == true)
        .filter(|(_, i)| i["kind"].as_str().is_some_and(|k| k.starts_with("light.")))
        .map(|(id, _)| id.as_str())
        .collect();
    if of.is_empty() {
        of.push("light_policy");
    }
    of.into_iter()
        .map(|item| {
            json!({"item": item, "entry": "light_policy.rays", "path": "web", "light": "without_history",
                "draws": "today's light, with no rays: WebGPU has no ray queries",
                "receipt": "the fallback from ray-traced light to today's light"})
        })
        .collect()
}

/// What `doc` asks of the browser's GPU, computed from the document and WebGPU's feature table:
/// the features it needs, the sets of which it needs one, and the limits past WebGPU's defaults.
/// A cutaway cuts through WebGPU's clip distances (Cutaway `cutaway@1`), which the table gives no
/// fallback for; maps that fit the document's decoded-image cap only in block bytes need BC or
/// ASTC, either one (Material: texture maps). `read` gives a map's bytes by its hash.
fn gpu_needs(doc: &Value, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Value {
    let items = doc["items"].as_object().into_iter().flatten();
    let cut = items.into_iter().any(|(_, i)| i["kind"] == "cutaway@1");
    let features: Vec<&str> = if cut { vec!["clip-distances"] } else { vec![] };
    let (mut decoded, mut blocks) = (0u64, 0u64);
    for of in deep_canvas_scene3d::light::material_maps(doc).values() {
        let Some((w, h, whole)) = read(&of.sha).as_deref().and_then(map_size) else {
            continue;
        };
        let rgba8 = chain_bytes(w, h, |lw, lh| u64::from(lw) * u64::from(lh) * 4);
        decoded += rgba8;
        // 16 bytes a 4 × 4 block in BC7, BC5 and ASTC 4 × 4 alike (BC4's 8 counted as 16, so
        // the sum fits both block formats).
        blocks += if whole {
            chain_bytes(w, h, |lw, lh| {
                u64::from(lw.div_ceil(4)) * u64::from(lh.div_ceil(4)) * 16
            })
        } else {
            rgba8
        };
    }
    let cap = deep_canvas_scene3d::light::DECODED_CAP;
    let any_of: Vec<[&str; 2]> = if decoded > cap && blocks <= cap {
        vec![["texture-compression-bc", "texture-compression-astc"]]
    } else {
        vec![]
    };
    json!({"features": features, "any_of": any_of, "limits": {}})
}

/// A map's size and whether it can become a block format: a KTX2 map of whole 4 × 4 blocks with
/// its full mip chain, read from its header; a PNG's or a JPEG's size, which decodes to RGBA8.
fn map_size(bytes: &[u8]) -> Option<(u32, u32, bool)> {
    use deep_codecs::maps::{full_chain, is_ktx2};
    if is_ktx2(bytes) {
        let at = |o: usize| Some(u32::from_le_bytes(bytes.get(o..o + 4)?.try_into().ok()?));
        let (w, h, levels) = (at(20)?, at(24)?.max(1), at(40)?);
        return Some((w, h, w % 4 == 0 && h % 4 == 0 && levels == full_chain(w, h)));
    }
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format();
    let (w, h) = reader.ok()?.into_dimensions().ok()?;
    Some((w, h, false))
}

/// The bytes of a `w` × `h` map's full mip chain, each level's by `level`.
fn chain_bytes(w: u32, h: u32, level: impl Fn(u32, u32) -> u64) -> u64 {
    let levels = deep_codecs::maps::full_chain(w, h);
    (0..levels)
        .map(|l| level((w >> l).max(1), (h >> l).max(1)))
        .sum()
}

/// The page `manifest`'s media paths as the bundle names them, by `names`.
fn renamed(manifest: &mut Value, names: &BTreeMap<String, String>) {
    let swap = |v: &mut Value| {
        if let Some(n) = v.as_str().and_then(|p| names.get(p)) {
            *v = json!(n);
        }
    };
    for s in manifest["states"].as_array_mut().into_iter().flatten() {
        swap(&mut s["still"]);
        swap(&mut s["loop"]);
        for list in ["samples", "orbit"] {
            for x in s[list].as_array_mut().into_iter().flatten() {
                swap(&mut x["still"]);
            }
        }
    }
    for e in manifest["edges"].as_array_mut().into_iter().flatten() {
        swap(&mut e["clip"]);
    }
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
    relay: Option<&str>,
    sources: &[Value],
) -> String {
    let map = json!({"imports": {"deep-player-glue": format!("./{}", glue.0)},
                     "integrity": {format!("./{}", glue.0): integrity(glue.1)}})
    .to_string();
    // #549: a piece whose net item declares a relay may reach that one host, and no other.
    let relay = relay
        .map(|host| format!(" wss://{host}"))
        .unwrap_or_default();
    // #1042: and each public source it declares, by its origin.
    let mut origins: Vec<String> = (sources.iter())
        .filter_map(|s| super::sources::origin(s["url"].as_str()?))
        .collect();
    origins.sort();
    origins.dedup();
    let sources: String = origins.iter().map(|o| format!(" {o}")).collect();
    let policy = format!(
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' '{}'; connect-src 'self'{relay}{sources}; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        integrity(map.as_bytes())
    );
    let data = manifest.to_string().replace("</", "<\\/");
    let stamp = stamp
        .map(|s| format!("<meta name=\"exported\" content=\"{s}\">\n"))
        .unwrap_or_default();
    // #2856: a line the player's element removes as its first act, so only a page whose script never ran shows it.
    // The element's script is render-blocking: the page paints nothing until it has arrived, so an untouched page
    // doesn't flash the line while the script loads.
    let fallback = escape(manifest["fallback"]["index"].as_str().unwrap_or_default());
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\">\n<meta name=\"referrer\" content=\"no-referrer\">\n{stamp}<title>{}</title>\n\
<style>html,body{{margin:0;background:#101012;color:#e8e8ec;font:14px system-ui,sans-serif}}deep-player{{display:block;position:relative}}\
deep-player canvas{{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain}}[data-deep-notice],[data-deep-unstarted],[data-deep-reading]{{margin:8px 12px}}\
[data-deep-notice=stopped]{{position:absolute;top:12px;left:12px;max-width:560px;margin:0;padding:8px 12px;background:#1b1b20;border:1px solid #55555f;border-radius:6px}}deep-player a{{color:#9db4ff}}\
[data-deep-saves]{{display:flex;gap:8px;margin:8px 12px}}[data-deep-saves] button,[data-deep-saves] select{{font:inherit;color:inherit;background:#232329;border:1px solid #4a4a55;border-radius:6px;padding:4px 10px}}</style>\n\
<script type=\"importmap\">{map}</script>\n<script type=\"module\" src=\"./{}\" integrity=\"{}\" blocking=\"render\"></script>\n</head>\n<body>\n\
<deep-player><p data-deep-unstarted>The player hasn't started: the host may have changed its script or served it under the wrong type. <a href=\"./{fallback}\">Open the fallback page</a></p></deep-player>\n\
<script type=\"application/json\" id=\"deep-bundle\">{data}</script>\n</body>\n</html>\n",
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
            "    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify(can.request));",
            "    const a = await navigator.gpu.requestAdapter(); const limits = {}; for (const k in a.limits) limits[k] = a.limits[k];\n    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify({ ...can.request, limits }));",
        ),
        // Planted (#1040 AC5): the index page starts the player wherever WebGPU is.
        Some(Guard::WebIndexChecksWebgpuOnly) => ELEMENT.replace(
            "    const can = await gate(bundle.gpu_needs);",
            "    const can = navigator.gpu ? { request: bundle.gpu_needs } : { lacks: 'WebGPU' };",
        ),
        // Planted (#1040 AC6): the index page needs every feature of each any_of set.
        Some(Guard::WebIndexRequiresEveryAnyOf) => ELEMENT.replace(
            "    const can = await gate(bundle.gpu_needs);",
            "    const n = bundle.gpu_needs;\n    const can = await gate({ ...n, features: [...n.features, ...n.any_of.flat()], any_of: [] });",
        ),
        // Planted (#1041 AC2): saves keyed by the page's origin alone, so every piece there shares its slots.
        Some(Guard::WebSavesKeyedByOrigin) => ELEMENT.replace(
            "    this.#piece = piece;",
            "    this.#piece = location.origin;",
        ),
        // Planted (#1041 AC3): the first save never asks the browser to keep the origin's storage persistent.
        Some(Guard::WebSavesNeverAskPersistence) => ELEMENT.replace(
            "      if (!this.#asked) await this.#persist();\n",
            "",
        ),
        // Planted (#189 AC9): Import record takes a record without holding it to the SHA-256 its name gives.
        Some(Guard::WebCarryImportSkipsHash) => ELEMENT.replace(
            r"const hash = /^([0-9a-f]{64})\.carry$/.exec(file.name)?.[1] ?? await sha256(bytes);",
            "const hash = await sha256(bytes);",
        ),
        // Planted (#1045 AC1): no accessibility tree beside the canvas, and no live region.
        Some(Guard::WebNoTree) => ELEMENT.replace("    this.#keepTree();\n", ""),
        // Planted (#1045 AC1): each readout announced on every frame drawn, changed or not.
        Some(Guard::WebAnnouncesEveryFrame) => ELEMENT.replace(
            "      if (was !== undefined && was !== text) said.push(text);",
            "      said.push(text);",
        ),
        // Planted (#2856 AC1): a throw from the core while the piece plays is caught, and the play goes on.
        Some(Guard::WebPlaysOnFailure) => {
            ELEMENT.replace("      this.#stop(e);\n      return;\n", "")
        }
        // Planted (#2892 AC6): each stored file inflated whole as it arrives, then checked against the
        // SHA-256 it inflates to, with no stop at the index's inflated size.
        Some(Guard::WebInflatesBeforeCheck) => ELEMENT.replace(
            "    for (const f of bundle.files) stored.push([f, await this.#fetch(f.path, f.sha256)]);\n",
            "    for (const f of bundle.files) {\n      const raw = new Uint8Array(await (await fetch(f.path, { credentials: 'omit', cache: 'no-store' })).arrayBuffer());\n      const whole = f.inflated ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : raw;\n      const want = f.inflated ? f.inflated.sha256 : f.sha256;\n      if ((await sha256(whole)) !== want) throw Error(`the file ${f.path} doesn't match its SHA-256 ${want}; the player doesn't start`);\n      stored.push([{ path: f.path, sha256: want }, whole]);\n    }\n",
        ),
        // Planted (#2856 AC3): the index page's line that the player hasn't started stays in place.
        Some(Guard::WebElementLeavesLine) => ELEMENT.replace(
            "    this.querySelector('[data-deep-unstarted]')?.remove();\n",
            "",
        ),
        _ => ELEMENT.to_string(),
    }
}

/// The player of `set`, its bytes as a planted export writes them, or as they ship.
fn player(set: &Set, guard: Option<Guard>) -> Vec<u8> {
    let mut wasm = set.wasm.to_vec();
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
    if guard == Some(Guard::WebPlayerOver12mb) {
        // Planted (#2892 AC3): a custom section of 13,000,000 seeded pseudo-random bytes.
        let name = b"deep.padding";
        let mut body = vec![name.len() as u8];
        body.extend_from_slice(name);
        let mut x: u64 = 2892;
        body.extend((0..13_000_000).map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 32) as u8
        }));
        wasm.push(0);
        let mut len = body.len();
        while len >= 0x80 {
            wasm.push((len as u8 & 0x7f) | 0x80);
            len >>= 7;
        }
        wasm.push(len as u8);
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

    /// The bundle's fallback page, its files put in `files` (Export: web player): the full
    /// playable page of `doc` within the page's caps, and past them a page of one pass of the
    /// piece's tour, which the receipt marks `tour_only`. Every file is named by its hash, so the
    /// page's own references are rewritten to those names. What the bundle's manifest says of it:
    /// its index page and every file it names.
    fn web_fallback(
        &mut self,
        job: &Job,
        doc: &Value,
        out: &std::path::Path,
        files: &mut Files,
    ) -> Result<Value, Value> {
        let scratch = temp_of(&out.with_extension("page"));
        let _ = std::fs::remove_dir_all(&scratch);
        let full = self.page_built(job, doc, None, &scratch);
        let past_caps = |r: &Value| r["code"] == "page_states" || r["code"] == "page_edges";
        let pass: Vec<Value> = (doc.get("tour"))
            .and_then(|t| deep_canvas_input::tour::Tour::of(t).ok())
            .map(|t| t.pass().iter().map(|e| e.to_json()).collect())
            .unwrap_or_default();
        let (built, tour_only) = match full {
            Ok(b) => (Ok(b), false),
            Err(r) if past_caps(&r) => {
                let _ = std::fs::remove_dir_all(&scratch);
                (self.page_built(job, doc, Some(&pass[..]), &scratch), true)
            }
            Err(r) => (Err(r), false),
        };
        let _ = std::fs::remove_dir_all(&scratch);
        let mut built = built?;
        if tour_only {
            // A tour page plays by itself, each edge at its key's own time on the tour's clock.
            built.manifest["tour"] = json!(true);
            let edges = built.manifest["edges"].as_array_mut().into_iter().flatten();
            for (edge, entry) in edges.zip(&pass) {
                edge["tour_at"] = entry["t"].clone();
            }
        }
        let mut names: BTreeMap<String, String> = BTreeMap::new();
        let mut named = Vec::new();
        for (path, bytes) in std::mem::take(&mut built.files) {
            let ext = path.rsplit('.').next();
            let (name, sha) = files.put(bytes, ext, Map::new());
            named.push(json!({"path": name, "sha256": sha}));
            names.insert(path, name);
        }
        let (css, css_sha) = files.put(write::PLAYER_CSS.into(), Some("css"), Map::new());
        let (js, js_sha) = files.put(write::PLAYER_JS.into(), Some("js"), Map::new());
        renamed(&mut built.manifest, &names);
        // The receipt marks the page's index page and its manifest.
        let role = |r: &str| Map::from_iter([("fallback".to_string(), json!(r))]);
        let manifest = serde_json::to_vec_pretty(&built.manifest).unwrap_or_default();
        let (manifest, manifest_sha) = files.put(manifest, Some("json"), role("manifest"));
        let page = write::index_html_at(doc, &built.manifest, &css, &js);
        let (index, index_sha) = files.put(page.into_bytes(), Some("html"), role("index"));
        named.extend([
            json!({"path": css, "sha256": css_sha}),
            json!({"path": js, "sha256": js_sha}),
            json!({"path": manifest, "sha256": manifest_sha}),
            json!({"path": index, "sha256": index_sha}),
        ]);
        Ok(json!({"index": index, "tour_only": tour_only, "files": named}))
    }

    /// The planted web player this run writes, if any.
    fn web_guard(&self) -> Option<Guard> {
        [
            Guard::WebIndexExportTime,
            Guard::WebProbeTestVariant,
            Guard::WebRequestsAdapterLimits,
            Guard::WebFragmentWritesEntry,
            Guard::WebSavesKeyedByOrigin,
            Guard::WebSavesNeverAskPersistence,
            Guard::WebCarryImportSkipsHash,
            Guard::WebLeavesOutFont,
            Guard::WebIndexChecksWebgpuOnly,
            Guard::WebIndexRequiresEveryAnyOf,
            Guard::WebNoTree,
            Guard::WebAnnouncesEveryFrame,
            Guard::WebPlaysOnFailure,
            Guard::WebElementLeavesLine,
            Guard::WebStoresPlayerAsIs,
            Guard::WebInflatesBeforeCheck,
            Guard::WebGzipHeaderTime,
            Guard::WebPlayerOver12mb,
        ]
        .into_iter()
        .find(|g| self.planted(Planted::Export(*g)))
    }

    /// `video.codec: web`: the web player's bundle of `doc`, written as a folder at `job.out`.
    pub(super) fn export_web(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        // #2776: each item's web answer, its entry's or that of a field it turns on, read before the
        // set is picked: the player draws a stand-in, not its entry, so a module only stand-in
        // items use (their kinds and params, and `requires.modules` naming it) needn't be in it.
        let (mut by_answer, stand_ins) = super::paths::web(&self.startup.sealed, doc);
        let (mut kept, mut stood) = (doc.clone(), Map::new());
        if let Some(items) = kept.get_mut("items").and_then(Value::as_object_mut) {
            for id in stand_ins.iter().filter_map(|s| s["item"].as_str()) {
                if let Some(item) = items.remove(id) {
                    stood.insert(id.to_string(), item);
                }
            }
        }
        let stand_modules = modules_used(&json!({"items": stood}), &self.startup.sealed);
        // #1490: the smallest set that holds every canvas module the document uses, read from the
        // check's registry; the largest when none does, which the refusal below then names.
        let mut used = modules_used(&kept, &self.startup.sealed);
        used.retain(|m, at| !(stand_modules.contains_key(m) && at.starts_with("requires/")));
        let lacks = |set: &Set| -> BTreeMap<String, String> {
            let held = set.modules();
            used.iter()
                .filter(|(m, _)| !held.contains(m))
                .map(|(m, at)| (m.clone(), at.clone()))
                .collect()
        };
        let set = if self.planted(Planted::Export(Guard::WebPicksSmallestSet)) {
            // Planted (#1490 AC3): the picker takes the smallest set whatever the document uses.
            &SETS[0]
        } else if self.planted(Planted::Export(Guard::WebPicksFullSet)) {
            // Planted (#1490 AC2): the picker takes the full set whatever the document uses.
            &SETS[SETS.len() - 1]
        } else {
            SETS.iter()
                .find(|s| lacks(s).is_empty())
                .unwrap_or(&SETS[SETS.len() - 1])
        };
        let about = set.about();
        let mut refused = refusals(doc, &lacks(set), set.name);
        // #2776: each item whose entry, or a field it turns on, answers the web `refused` is refused
        // with that answer's code, once per item and code; a `stand_in` is listed in the receipt.
        if self.planted(Planted::Export(Guard::WebCarriesRefused)) {
            // Planted (#2776 AC6): the export reads no refused web answer and carries the entry.
            by_answer.clear();
        }
        for r in by_answer {
            if !refused
                .iter()
                .any(|o| o["item"] == r["item"] && o["code"] == r["code"])
            {
                refused.push(r);
            }
        }
        // #211: a logic item whose world could outgrow the web player's store, which keeps it in
        // memory up to web_max, is refused, naming the field.
        let init_only = self.planted(Planted::WebExportChecksInitOnly);
        let root = &self.scenario.evidence;
        for (id, item) in doc["items"].as_object().into_iter().flatten() {
            let Some(pages) = item.pointer("/params/pages") else {
                continue;
            };
            let init = pages["init"]
                .as_str()
                .or_else(|| pages.pointer("/init/asset").and_then(Value::as_str))
                .and_then(|sha| crate::evidence::read(root, sha))
                .map(|b| b.len() as u64);
            if let Some(mut r) = deep_logic::pages::web_refused(pages, init, init_only) {
                r["item"] = json!(id);
                r["code"] = json!("web.pages");
                refused.push(r);
            }
        }
        // #1042: the public sources the export declares, each asked once with no key; one that
        // isn't a source a player may read, or answers only with a key, is refused, naming it.
        let sources = match super::sources::declared(doc, &job.web) {
            Ok(sources) => sources,
            Err(r) => {
                refused.extend(r);
                Vec::new()
            }
        };
        if !sources.is_empty() {
            let ca = match &self.scenario.net.source_ca {
                None => Vec::new(),
                Some(path) => std::fs::read(path).map_err(
                    |e| json!({"code": "bad_input", "path": "source_ca", "why": e.to_string()}),
                )?,
            };
            refused.extend(super::sources::refusals(&sources, &ca));
        }
        if !refused.is_empty() {
            let names: Vec<&str> = refused.iter().filter_map(|r| r["item"].as_str()).collect();
            return Err(
                json!({"outcome": "refused", "code": "web.refused", "refused": refused,
                "why": format!("the web player's bundle can't carry {}", names.join(", "))}),
            );
        }
        // #210: a port is the app's own, never the bundle's: each is named in the receipt's
        // `refused` and left out of the document the player reads.
        let ports: Vec<String> = doc
            .get("ports")
            .and_then(Value::as_object)
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default();
        let mut carried = doc.clone();
        if !self.planted(Planted::WebExportKeepsPort) {
            if let Some(d) = carried.as_object_mut() {
                d.remove("ports");
            }
        }
        let doc = &carried;
        let guard = self.web_guard();
        let root = self.scenario.evidence.clone();
        let mut files = Files::default();
        // The player and its page glue.
        let wasm = player(set, guard);
        let prebuilt = (wasm == set.wasm).then_some(set.stored);
        let (wasm_path, wasm_sha) = files.put(wasm, Some("wasm"), Map::new());
        let (glue_path, _) = files.put(set.glue.to_vec(), Some("js"), Map::new());
        // #277's planted web copy: back in view, it jumps to the confirmed step.
        let element = match self.scenario.module_planted.as_deref() {
            Some("web_catch_up_jumps") => ELEMENT.replace(
                "    const opened = JSON.parse(this.#player.join(",
                "    this.#player.net_plant('web_catch_up_jumps');\n    const opened = JSON.parse(this.#player.join(",
            ),
            _ => element(guard),
        };
        let (element_path, _) = files.put(element.clone().into_bytes(), Some("js"), Map::new());
        // The document as the app's frames draw it, and the recorded input track as the hub holds
        // it (#1164's `track` call), its bytes the ones its hash is of, so it is the app's by hash.
        let doc_bytes = serde_json::to_vec(doc).map_err(|_| json!({"code": "bad_input"}))?;
        let (_, doc_sha) = files.put(doc_bytes, Some("json"), Map::new());
        let held = crate::track_call::held_bytes(&job.track).ok_or_else(
            || json!({"code": "bad_input", "what": "track: each entry is {t, control, value, writer}"}),
        )?;
        let (_, track_sha) = files.put(held, Some("json"), Map::new());
        // Everything the document names by hash, and the characters its text can show (#1042).
        let mut shown = super::subset::Shown::new();
        shown.document(doc);
        shown.document(&json!(job.track));
        for (_, path, sha) in crate::extended::hashes(doc, true) {
            let bytes = crate::evidence::read(&root, &sha).ok_or_else(|| {
                json!({"outcome": "refused", "code": "asset_missing", "path": path, "sha256": sha,
                       "why": format!("the document names {sha} at {path}, which the store doesn't hold")})
            })?;
            shown.asset(&bytes);
            files.put(bytes, None, Map::new());
        }
        // #1042: the readings its bound values show, as the record holds them at the export.
        let mut readings = Map::new();
        for (_, b) in doc["bound_values"].as_object().into_iter().flatten() {
            let handle = b["source"].as_str().unwrap_or_default();
            let held = self.scenario.record.get(handle);
            if let Some((value, o)) = held.and_then(|o| Some((o.value?, o))) {
                readings.insert(handle.into(), json!({"value": value, "as_of": o.as_of}));
            }
        }
        let readings = (!readings.is_empty()).then(|| {
            let bytes = serde_json::to_vec(&readings).unwrap_or_default();
            files.put(bytes, Some("json"), Map::new()).1
        });
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
        // The bundled faces, each subset to what the piece's text can show (#1042), with its license.
        let mut fonts = Vec::new();
        for face in deep_text::FACES {
            let ext = face.file.rsplit('.').next();
            let bytes = shown.face(face.bytes()).map_err(|why| {
                json!({"outcome": "failed", "code": "web.font_subset", "file": face.file, "why": why})
            })?;
            let (_, sha) = files.put(bytes, ext, Map::new());
            fonts.push(json!({"file": face.file, "sha256": sha}));
        }
        for (_, text) in deep_text::LICENSES {
            files.put(text.as_bytes().to_vec(), Some("txt"), Map::new());
        }
        // #2892: each file as the bundle stores it; the index lists each by its stored name with what
        // it inflates to, and the page keys it by the SHA-256 the document names it by.
        // Planted (#2892 AC4): the player stored as it is.
        let as_is = guard == Some(Guard::WebStoresPlayerAsIs);
        let player_kept = if as_is { &wasm_path } else { &glue_path };
        let kept = [
            glue_path.as_str(),
            element_path.as_str(),
            player_kept.as_str(),
        ];
        let header_time = (guard == Some(Guard::WebGzipHeaderTime)).then(|| {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
            now.map(|d| d.as_secs() as u32).unwrap_or(1)
        });
        let prebuilt = prebuilt.map(|b| (wasm_sha.as_str(), b));
        let files = files.stored(&kept, prebuilt, header_time);
        let player_path = files.path_of(&wasm_sha).unwrap_or_default().to_string();
        let player_sha = sha256_hex(&files.by_path[&player_path].0);
        let needs = gpu_needs(doc, &|sha| crate::evidence::read(&root, sha));
        let size = [0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(640.0).round() as i64);
        let listed: Vec<Value> = files
            .by_path
            .iter()
            .filter(|(p, _)| **p != element_path && **p != glue_path)
            .map(|(p, (b, marks))| {
                let mut f = json!({"path": p, "sha256": sha256_hex(b)});
                if let Some(i) = marks.get("inflated") {
                    f["inflated"] = i.clone();
                }
                f
            })
            .collect();
        // The fallback page, whose files the player never fetches.
        let out = PathBuf::from(&job.out);
        let mut page = Files::default();
        let fallback = self.web_fallback(job, doc, &out, &mut page)?;
        let mut manifest = json!({
            "size": size,
            "player": {"wasm": wasm_sha},
            "document": doc_sha,
            "track": track_sha,
            "files": listed,
            "fonts": fonts,
            "logic": logic,
            "images": images,
            "gpu_needs": needs,
            "fallback": fallback,
        });
        // #1042: a piece with neither names neither, so its index page is as it was.
        if !sources.is_empty() {
            manifest["sources"] = json!(sources);
        }
        if let Some(sha) = &readings {
            manifest["readings"] = json!(sha);
        }
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
            deep_net::Config::of(doc)
                .as_ref()
                .map(|c| c.host.as_str())
                .filter(|h| !h.is_empty()),
            &sources,
        );
        // Every file the document, the player and the fallback page name, with what it is.
        let mut named: Vec<(String, String, String)> = Vec::new();
        let mut name = |path: &str, sha: &str, what: String| {
            named.push((path.to_string(), sha.to_string(), what))
        };
        name(
            &element_path,
            &sha256_hex(element.as_bytes()),
            "the player's element".into(),
        );
        let glue_sha = sha256_hex(&files.by_path[&glue_path].0);
        name(&glue_path, &glue_sha, "the player's page glue".into());
        for f in &fonts {
            let (file, sha) = (f["file"].as_str(), f["sha256"].as_str().unwrap_or("-"));
            if let (Some(file), Some(path)) = (file, files.path_of(sha)) {
                let stored = sha256_hex(&files.by_path[path].0);
                name(path, &stored, format!("the font {file}"));
            }
        }
        for f in listed
            .iter()
            .chain(fallback["files"].as_array().into_iter().flatten())
        {
            let (path, sha) = (
                f["path"].as_str().unwrap_or(""),
                f["sha256"].as_str().unwrap_or(""),
            );
            let of = f["inflated"]["sha256"].as_str().unwrap_or(sha);
            let what = if of == track_sha {
                "the input track".to_string()
            } else if fallback["files"].as_array().is_some_and(|a| a.contains(f)) {
                format!("the fallback page's {path}")
            } else {
                format!("the file {path}")
            };
            name(path, sha, what);
        }
        // Written whole or not at all: to the temporary name, read back from its own bytes, then
        // renamed.
        let temp = temp_of(&out);
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).map_err(|_| json!({"code": "export_unwritable"}))?;
        let mut all: BTreeMap<String, Vec<u8>> = (files.by_path.iter())
            .chain(&page.by_path)
            .map(|(p, (b, _))| (p.clone(), b.clone()))
            .collect();
        all.insert("index.html".into(), index.into_bytes());
        if guard == Some(Guard::WebLeavesOutFont) {
            // Planted (#1040 AC3): an export that leaves out one font it names.
            let font = fonts[0]["sha256"].as_str().unwrap_or_default();
            let path = files.path_of(font).unwrap_or_default().to_string();
            all.remove(&path);
        }
        let written = all
            .iter()
            .try_for_each(|(name, bytes)| std::fs::write(temp.join(name), bytes));
        if written.is_err() {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(json!({"code": "export_unwritable"}));
        }
        // A stored file reads back whole when its bytes match its name and inflate to the size and
        // SHA-256 it is listed with.
        let read_back = |path: &str, sha: &str| {
            let Ok(disk) = std::fs::read(temp.join(path)) else {
                return false;
            };
            let inflated = files.by_path.get(path).and_then(|(_, m)| m.get("inflated"));
            sha256_hex(&disk) == sha
                && inflated.is_none_or(|i| {
                    let size = i["bytes"].as_u64().unwrap_or(0) as usize;
                    gunzip(&disk, size).is_some_and(|b| i["sha256"] == sha256_hex(&b))
                })
        };
        if let Some((path, sha, what)) = named.iter().find(|(path, sha, _)| !read_back(path, sha)) {
            let _ = std::fs::remove_dir_all(&temp);
            let why = format!("{what} ({path}, SHA-256 {sha}) isn't in the bundle as written");
            return Err(
                json!({"outcome": "failed", "code": "export.fidelity", "file": path, "why": why,
                "issues": [{"code": "export.fidelity", "what": why}]}),
            );
        }
        // The bundle's document carries no port: one it keeps fails the read-back, naming it.
        let doc_path = files.path_of(&doc_sha).unwrap_or_default();
        let doc_size =
            (files.by_path.get(doc_path)).and_then(|(_, m)| m.get("inflated")?["bytes"].as_u64());
        let kept: Vec<String> = all
            .get(doc_path)
            .and_then(|b| gunzip(b, doc_size? as usize))
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|d| Some(d.get("ports")?.as_object()?.keys().cloned().collect()))
            .unwrap_or_default();
        if !kept.is_empty() {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(json!({"outcome": "failed", "code": "export.fidelity",
                "issues": [{"code": "export.fidelity", "what": format!("the bundle's document keeps the port {}; a web player carries no port", kept.join(", "))}]}));
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
                let held = files.by_path.get(p).into_iter().chain(page.by_path.get(p));
                for (k, v) in held.flat_map(|(_, marks)| marks) {
                    f[k] = v.clone();
                }
                f
            })
            .collect();
        Ok(json!({
            "target": "web",
            "player": {"core_version": about["core_version"], "module_set_digest": about["set_digest"], "hash": player_sha,
                       "module_set": set.name},
            "fallback": if fallback["tour_only"] == true { "tour_only" } else { "page" },
            "sources": sources.iter().map(|s| json!({"reading": s["reading"], "url": s["url"], "every": s["every"], "path": s["path"]})).collect::<Vec<_>>(),
            "bytes": all.values().map(Vec::len).sum::<usize>(),
            "refused": ports.iter().map(|n| json!({"item": n, "code": "web.port",
                "why": format!("the port {n} is the app's own to open; the web player has no plug-in to send to")})).collect::<Vec<_>>(),
            "stand_in": stand_ins.into_iter().chain(light_fallbacks(doc)).collect::<Vec<_>>(),
            "gpu_needs": needs,
            "files": receipt_files,
        }))
    }
}
