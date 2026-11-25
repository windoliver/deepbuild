//! Issue #423: a view3d call's texture maps and glTF imports (canvas primitives: Material:
//! texture maps; Asset: meshes). Every map a document's solids sample is made ready for the GPU
//! once per run in the decode worker, a process of its own (deep-codecs), kept by the image's hash,
//! its role and the cutoff a mask samples it at, so a second document naming the same hashes
//! transcodes nothing; the receipt names each map's source and format and, for a mask's, the share
//! of each level it keeps (#3257), and the document's decoded-image cap counts the bytes the device
//! holds. A `mesh.asset@1` that names a file's scene reports what its import made of the
//! file's materials and textures, and keeps each texture in the evidence store by hash with the
//! asset's license.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas::gauge::{Gauge, Kept, Place};
use deep_canvas_scene3d::light::{map_field, map_uses, MapUse, Texels, DECODED_CAP};
use deep_canvas_scene3d::scene::Scene;
use deep_codecs::{Caps, Helper, DECODE_WORKER};
use serde_json::{json, Value};

use crate::{refused, App, Planted};

/// #1431: the maps the decode worker made ready (`Made.ready`), their texels in the heap: past
/// either bound, the maps no document has drawn for longest go first.
pub static READY: Gauge = Gauge::new("Made::ready", Place::Heap, 512, 512_000_000);

/// A map the decode worker made ready: its texels, its source's format, and the share of each
/// level a mask keeps.
type Ready = (Arc<Texels>, String, Value);

/// What the run's decode worker made, by `<map key>:<role>`.
pub struct Made {
    pub decoder: Option<Helper>,
    // cache: entries 512, bytes 512_000_000
    pub ready: Kept<String, Ready>,
    /// The videos' probes and their latest decoded frames (#503).
    pub videos: crate::video::Cache,
}

impl Default for Made {
    fn default() -> Made {
        Made {
            decoder: None,
            ready: Kept::new(&READY),
            videos: Default::default(),
        }
    }
}

/// The decode worker's planted program, from deep-gpu's.
fn worker_planted(p: Option<Planted>) -> Option<&'static str> {
    (p == Some(Planted::AppliesImageGamma)).then_some("applies_image_gamma")
}

/// The job role a map is made for. The planted programs read a metallic-roughness or a normal map
/// as sRGB color (#423 AC4, AC6).
fn role(of: &MapUse, planted: Option<Planted>) -> &'static str {
    match (of.role(), planted) {
        ("normal", Some(Planted::NormalMapAsSrgb)) => "color",
        ("data", Some(Planted::MrFromSrgb)) if of.fields.contains("metallic_roughness") => "color",
        (r, _) => r,
    }
}

/// The run's decode worker, started the first time a job needs it.
pub fn decoder(app: &mut App) -> Result<&mut Helper, Value> {
    if app.made.decoder.is_none() {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-gpu"));
        let planted = worker_planted(app.planted);
        let h = Helper::start(&exe, DECODE_WORKER, &Caps::default(), planted)
            .map_err(|e| refused("no_decoder", format!("the decode worker didn't start: {e}")))?;
        app.made.decoder = Some(h);
    }
    Ok(app.made.decoder.as_mut().expect("started"))
}

/// The scene's maps made ready: its texels by key and the receipt, or the cap's refusal. A
/// `doc` material's map whose image isn't in `paths` is refused at its field (#1729).
pub fn prepare(
    app: &mut App,
    doc: &Value,
    scene: &Scene,
    paths: &BTreeMap<String, PathBuf>,
) -> Result<(BTreeMap<String, Arc<Texels>>, Value), Value> {
    let planted = app.planted;
    let mut texels = BTreeMap::new();
    let mut receipt = Vec::new();
    let mut decoded = 0u64;
    app.made.ready.turn();
    for (map, of) in map_uses(scene) {
        let role = role(&of, planted);
        let key = format!("{map}:{role}");
        let sha = &of.sha;
        let transcoded = !app.made.ready.touch(&key);
        if transcoded {
            let Some(path) = paths.get(sha) else {
                match map_field(doc, sha) {
                    Some(field) => return Err(refused("asset_missing", field)),
                    None => continue,
                }
            };
            let out =
                std::env::temp_dir().join(format!("deep-gpu-map-{}-{key}", std::process::id()));
            let job = json!({"op": "transcode", "path": path, "role": role, "alpha_cutoff": of.cutoff,
                             "bc": cfg!(target_os = "macos"), "out": out});
            let reply = decoder(app)?.ask(&job);
            let (Some(format), Some(size), Some(mips)) = (
                reply["format"].as_str(),
                crate::view3d::pair(&reply["size"]),
                reply["mips"].as_u64(),
            ) else {
                return Err(refused(
                    "unreadable_image",
                    format!("the map {sha}: {}", reply),
                ));
            };
            let data =
                std::fs::read(&out).map_err(|e| refused("unreadable_image", e.to_string()))?;
            let _ = std::fs::remove_file(&out);
            let t = Texels {
                format: format.to_string(),
                size,
                mips: mips as u32,
                data: Arc::new(data),
            };
            let source = reply["source"].as_str().unwrap_or("png").to_string();
            let bytes = t.data.len() as u64;
            let ready = (Arc::new(t), source, reply["kept"].clone());
            app.made.ready.insert(key.clone(), ready, bytes);
        }
        let (t, source, kept) = app.made.ready.peek(&key).expect("made ready above");
        decoded += t.data.len() as u64;
        let mut row = json!({"sha256": sha, "source": source, "format": t.format, "roles": of.fields, "transcoded": transcoded});
        if !kept.is_null() {
            row["alpha_cutoff"] = json!(of.cutoff);
            row["kept"] = kept.clone();
        }
        receipt.push(row);
        texels.insert(map, t.clone());
    }
    app.made.ready.evict();
    if decoded > DECODED_CAP {
        let mut r = refused(
            "over_budget",
            format!("the document's maps take {decoded} B on the device, over its 64 MiB decoded-image cap"),
        );
        r["decoded_bytes"] = json!(decoded);
        return Err(r);
    }
    Ok((texels, json!({"decoded_bytes": decoded, "maps": receipt})))
}

/// #2215: the frame's receipt, with a `warnings` entry for each part that is see-through and
/// anisotropic at once. Raster refracts through the round lobe, which a final stretches as its
/// reflection does, so the frame says so instead of differing silently.
pub fn listed(mut receipt: Value, scene: &Scene, planted: Option<Planted>) -> Value {
    let parts: BTreeSet<&str> = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| {
            s.material
                .as_ref()
                .is_some_and(|m| m.lobes.transmission > 0.0 && m.lobes.anisotropy != 0.0)
        })
        .map(|s| s.id.as_str())
        .collect();
    if !parts.is_empty() && planted != Some(Planted::RasterListsNothing) {
        receipt["warnings"] = parts
            .iter()
            .map(|p| json!({"item": p, "what": "anisotropic_transmission"}))
            .collect();
    }
    receipt
}

/// The run's helper processes and their jobs, as deep-show's `workers` call lists them.
pub fn workers(app: &App) -> Value {
    json!({"workers": app.made.decoder.iter().map(Helper::json).collect::<Vec<_>>()})
}

/// Each `mesh.asset@1`, its file imported: its report, and every image's path by hash
/// (written to `store` when given, else beside the run) so the decode worker reads it.
pub fn imports(
    doc: &Value,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    licenses: &BTreeMap<String, Value>,
    store: Option<&PathBuf>,
    paths: &mut BTreeMap<String, PathBuf>,
    drops_dispersion: bool,
) -> Result<Vec<Value>, Value> {
    let mut out = Vec::new();
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        if item["kind"] != "mesh.asset@1" {
            continue;
        }
        // A scene import is held to its file; an item naming one node imports its file's
        // materials and images where the file has them, and draws as #420's otherwise.
        let whole = item.pointer("/params/node/scene").is_some();
        let Some(sha) = item.pointer("/params/sha256").and_then(Value::as_str) else {
            continue;
        };
        let Some(bytes) = read(sha) else {
            if !whole {
                continue;
            }
            return Err(refused(
                "asset_missing",
                format!("items/{id}/params/sha256"),
            ));
        };
        let scene = item
            .pointer("/params/node/scene")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let mut im = match deep_canvas_scene3d::gltf::import(&bytes, sha, scene, read) {
            Ok(im) => im,
            Err(p) if whole => return Err(refused("out_of_range", format!("items/{id}/{p}"))),
            Err(_) => continue,
        };
        if drops_dispersion {
            deep_canvas_scene3d::gltf::drop_dispersion(&mut im);
        }
        let license = licenses.get(sha).cloned().unwrap_or(Value::Null);
        let mut textures = Vec::new();
        let dir = std::env::temp_dir().join(format!("deep-gpu-images-{}", std::process::id()));
        for (s, b) in &im.images {
            if textures.iter().any(|t: &Value| t["sha256"] == *s) {
                continue;
            }
            let path = match store {
                Some(root) => root.join(&s[..2]).join(&s[2..]),
                None => dir.join(s),
            };
            if !path.exists() {
                std::fs::create_dir_all(path.parent().expect("a folder"))
                    .and_then(|()| std::fs::write(&path, b))
                    .map_err(|e| refused("not_written", e.to_string()))?;
            }
            paths.entry(s.clone()).or_insert(path);
            textures.push(json!({"sha256": s, "license": license}));
        }
        let materials: Vec<Value> = im
            .materials
            .iter()
            .enumerate()
            .map(|(i, m)| json!({"index": i, "name": m.name, "params": m.params}))
            .collect();
        let dropped: Vec<Value> = im
            .dropped
            .iter()
            .map(|(m, input)| json!({"material": m, "input": input}))
            .collect();
        out.push(json!({"item": id, "sha256": sha, "materials": materials, "textures": textures, "dropped": dropped}));
    }
    Ok(out)
}
