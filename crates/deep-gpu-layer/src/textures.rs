//! Issue #423: a view3d call's texture maps and glTF imports (canvas primitives: Material:
//! texture maps; Asset: meshes). Every map a document's solids sample is made ready for the GPU
//! once per run in the decode worker, a process of its own (deep-codecs), kept by the image's hash
//! and its format, so a second document naming the same hashes transcodes nothing; the receipt
//! names each map's source and format, and the document's decoded-image cap counts the bytes the
//! device holds. A `mesh.asset@1` that names a file's scene reports what its import made of the
//! file's materials and textures, and keeps each texture in the evidence store by hash with the
//! asset's license.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use deep_codecs::{Caps, Helper, DECODE_WORKER};
use serde_json::{json, Value};

use crate::{refused, App, Planted};

/// A document's decoded-image cap, bytes (Image `image@1`: at most 64 MB decoded per document).
pub const CAP: u64 = 64 << 20;

/// What the run's decode worker made, by `<sha>:<role>`.
#[derive(Default)]
pub struct Made {
    pub decoder: Option<Helper>,
    pub ready: BTreeMap<String, (Arc<Texels>, String)>,
}

/// The decode worker's planted program, from deep-gpu's.
fn worker_planted(p: Option<Planted>) -> Option<&'static str> {
    (p == Some(Planted::AppliesImageGamma)).then_some("applies_image_gamma")
}

/// The job role a map's hash is made for: the color fields' sRGB, a normal map's two channels, an
/// occlusion map alone's one channel, else linear data. The planted programs read a
/// metallic-roughness or a normal map as sRGB color (#423 AC4, AC6).
fn role(roles: &BTreeSet<&str>, planted: Option<Planted>) -> &'static str {
    if roles.contains("base_color") || roles.contains("emission") {
        "base_color"
    } else if roles.contains("normal_map") {
        match planted {
            Some(Planted::NormalMapAsSrgb) => "base_color",
            _ => "normal",
        }
    } else if roles.contains("metallic_roughness") && planted == Some(Planted::MrFromSrgb) {
        "base_color"
    } else if roles.len() == 1 && roles.contains("occlusion") {
        "occlusion"
    } else {
        "data"
    }
}

/// Every map hash the scene's solids sample, with the fields that name it; a material
/// operator's texture input by hash (#431) is linear data, its mips made from its texels' codes.
fn usages(scene: &Scene) -> BTreeMap<String, BTreeSet<&'static str>> {
    let mut out: BTreeMap<String, BTreeSet<&'static str>> = BTreeMap::new();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        let inputs =
            s.op.as_ref()
                .and_then(|o| o.item["params"]["inputs"].as_object());
        for (_, i) in inputs.into_iter().flatten() {
            if let Some(sha) = i["from"]["texture"].as_str() {
                out.entry(sha.to_ascii_lowercase())
                    .or_default()
                    .insert("operator");
            }
        }
        let Some(m) = &s.maps else { continue };
        for (field, slot) in m.slots() {
            if let Some(slot) = slot {
                let name = field.rsplit('/').next().unwrap_or(field);
                out.entry(slot.sha.clone()).or_default().insert(name);
            }
        }
    }
    out
}

/// The scene's maps made ready: its texels by hash and the receipt, or the cap's refusal.
pub fn prepare(
    app: &mut App,
    scene: &Scene,
    paths: &BTreeMap<String, PathBuf>,
) -> Result<(BTreeMap<String, Arc<Texels>>, Value), Value> {
    let planted = app.planted;
    let mut texels = BTreeMap::new();
    let mut receipt = Vec::new();
    let mut decoded = 0u64;
    for (sha, roles) in usages(scene) {
        let role = role(&roles, planted);
        let key = format!("{sha}:{role}");
        let transcoded = !app.made.ready.contains_key(&key);
        if transcoded {
            let Some(path) = paths.get(&sha) else {
                continue;
            };
            let out =
                std::env::temp_dir().join(format!("deep-gpu-map-{}-{key}", std::process::id()));
            let job = json!({"op": "transcode", "path": path, "role": role, "bc": cfg!(target_os = "macos"), "out": out});
            if app.made.decoder.is_none() {
                let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-gpu"));
                let h = Helper::start(
                    &exe,
                    DECODE_WORKER,
                    &Caps::default(),
                    worker_planted(planted),
                )
                .map_err(|e| {
                    refused("no_decoder", format!("the decode worker didn't start: {e}"))
                })?;
                app.made.decoder = Some(h);
            }
            let reply = app.made.decoder.as_mut().expect("started").ask(&job);
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
            app.made.ready.insert(key.clone(), (Arc::new(t), source));
        }
        let (t, source) = &app.made.ready[&key];
        decoded += t.data.len() as u64;
        receipt.push(json!({"sha256": sha, "source": source, "format": t.format, "roles": roles, "transcoded": transcoded}));
        texels.insert(sha, t.clone());
    }
    if decoded > CAP {
        let mut r = refused(
            "over_budget",
            format!("the document's maps take {decoded} B on the device, over its 64 MiB decoded-image cap"),
        );
        r["decoded_bytes"] = json!(decoded);
        return Err(r);
    }
    Ok((texels, json!({"decoded_bytes": decoded, "maps": receipt})))
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
        let im = match deep_canvas_scene3d::gltf::import(&bytes, sha, scene, read) {
            Ok(im) => im,
            Err(p) if whole => return Err(refused("out_of_range", format!("items/{id}/{p}"))),
            Err(_) => continue,
        };
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
