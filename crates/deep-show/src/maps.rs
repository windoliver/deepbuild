//! Issue #1729: a 3D revision evaluated as every draw of it here draws it (canvas primitives:
//! Render-back; Material: texture maps): its assets read from the evidence store by the hash the
//! document names, and every map its solids sample made ready for the GPU as deep-gpu's view makes
//! them, in the run's decode worker, once per run by the image's hash and its role, within the
//! document's 64 MiB decoded-image cap. A map a glTF file holds is read from that file; a
//! material's map whose image isn't in the store is answered `asset_missing` at its field.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_scene3d::light::{map_field, map_role, map_uses, Texels, DECODED_CAP};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_codecs::DECODE_WORKER;
use serde_json::{json, Value};

use crate::hub::Hub;
use crate::snapshot::Unfit;

fn unfit(code: &'static str, path: impl Into<String>) -> Unfit {
    Unfit {
        code,
        path: path.into(),
    }
}

impl Hub<'_> {
    /// `doc` at `t` on a frame of `size`, evaluated with its assets and its maps' texels, and the
    /// look it draws in.
    pub(crate) fn evaluate3d(
        &mut self,
        doc: &Value,
        t: i64,
        size: [u16; 2],
    ) -> Result<(Scene, Look3), Unfit> {
        let evidence = self.scenario.evidence.clone();
        let skips = self.scenario.planted == Some(crate::hub::Planted::SkipsMissingMeshAsset);
        let skipped = skips.then(|| skip_missing_meshes(doc, &evidence));
        let doc = skipped.as_ref().unwrap_or(doc);
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let palette = self.look.light.clone();
        let gpu = self
            .gpu3()
            .ok_or_else(|| unfit("unsupported_platform", ""))?;
        let (mut scene, look) = gpu.evaluate(doc, t, &palette, size, &read)?;
        scene.texels = self.texels(doc, &scene)?;
        Ok((scene, look))
    }

    /// The texels of every map `scene` samples, by the image's hash.
    fn texels(
        &mut self,
        doc: &Value,
        scene: &Scene,
    ) -> Result<BTreeMap<String, Arc<Texels>>, Unfit> {
        let mut out = BTreeMap::new();
        let mut decoded = 0u64;
        for (sha, uses) in map_uses(scene) {
            let role = map_role(&uses);
            let key = format!("{sha}:{role}");
            if !self.media.maps.contains_key(&key) {
                let Some(t) = self.transcode(doc, &sha, role)? else {
                    continue;
                };
                self.media.maps.insert(key.clone(), Arc::new(t));
            }
            let t = self.media.maps[&key].clone();
            decoded += t.data.len() as u64;
            out.insert(sha, t);
        }
        if decoded > DECODED_CAP {
            return Err(unfit("over_budget", "maps"));
        }
        Ok(out)
    }

    /// Map `sha` made ready for `role` in the decode worker; `None` for an image that is neither
    /// in the store nor a material's map, which draws without it.
    fn transcode(&mut self, doc: &Value, sha: &str, role: &str) -> Result<Option<Texels>, Unfit> {
        let root = self.scenario.evidence.clone();
        let field = map_field(doc, sha);
        if crate::evidence::read(&root, sha).is_none() && !embedded(doc, sha, &root) {
            return match field {
                Some(f) => Err(unfit("asset_missing", f)),
                None => Ok(None),
            };
        }
        let at = field.unwrap_or_else(|| "maps".into());
        let path = root.join(&sha[..2]).join(&sha[2..]);
        let out =
            std::env::temp_dir().join(format!("deep-show-map-{}-{sha}-{role}", std::process::id()));
        let job = json!({"op": "transcode", "path": path, "role": role,
                         "bc": cfg!(target_os = "macos"), "out": out});
        let (reply, _) = self.media_job(DECODE_WORKER, job);
        let side = |k: usize| u32::try_from(reply["size"][k].as_u64()?).ok();
        let (Some(format), Some(w), Some(h), Some(mips)) = (
            reply["format"].as_str(),
            side(0),
            side(1),
            reply["mips"].as_u64(),
        ) else {
            return Err(unfit("unreadable_image", at));
        };
        let data = std::fs::read(&out).map_err(|_| unfit("unreadable_image", at))?;
        let _ = std::fs::remove_file(&out);
        Ok(Some(Texels {
            format: format.to_string(),
            size: [w, h],
            mips: mips as u32,
            data: Arc::new(data),
        }))
    }
}

/// #1729's planted render-back: `doc` without each `mesh.asset@1` whose file isn't in the store,
/// as the base skipped every one.
fn skip_missing_meshes(doc: &Value, root: &std::path::Path) -> Value {
    let mut out = doc.clone();
    if let Some(items) = out.get_mut("items").and_then(Value::as_object_mut) {
        items.retain(|_, i| {
            let sha = i.pointer("/params/sha256").and_then(Value::as_str);
            i["kind"] != "mesh.asset@1"
                || sha.is_some_and(|s| crate::evidence::read(root, s).is_some())
        });
    }
    out
}

/// Whether a glTF file the document names by hash holds image `sha`: kept in the store by its
/// hash if so, where the decode worker reads it.
fn embedded(doc: &Value, sha: &str, root: &std::path::Path) -> bool {
    let read = |s: &str| crate::evidence::read(root, s);
    let assets = doc["items"].as_object().into_iter().flatten();
    for (_, item) in assets.filter(|(_, i)| i["kind"] == "mesh.asset@1") {
        let Some(file) = item.pointer("/params/sha256").and_then(Value::as_str) else {
            continue;
        };
        let Some(bytes) = read(file) else { continue };
        let scene = item.pointer("/params/node/scene").and_then(Value::as_u64);
        let scene = scene.unwrap_or(0) as usize;
        let Ok(im) = deep_canvas_scene3d::gltf::import(&bytes, file, scene, &read) else {
            continue;
        };
        if let Some((_, b)) = im.images.iter().find(|(s, _)| s == sha) {
            return crate::evidence::put(root, b).is_ok_and(|s| s == sha);
        }
    }
    false
}
