//! #1719: the look a 3D document draws in (canvas primitives: Look `look@1`; Render-back): the look
//! it names, resolved as the 2D path resolves it and read as `deep-gpu`'s view reads it (basis, tone
//! map, exposure, finish, ground), or the session's roles when it names none. A look it names that
//! can't be resolved is the frame's issue at `look/asset`, never another look drawn in its place.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_effects::interp::Image;
use deep_canvas_marks::look::{self, Look, Refusal};
use deep_canvas_scene3d::look::Look3;
use deep_effects_render::look_ops::{self, Finish};
use serde_json::{json, Value};

use crate::hub::Hub;
use crate::snapshot::Unfit;

/// The wrong program criterion 2 names: the merge base's, which drops the document's look and draws
/// in the session's roles.
pub const DROPS_LOOK: &str = "render_back_drops_look";

/// A look as a 3D frame draws it.
#[derive(Clone)]
pub struct Dressed {
    pub look: Look3,
    /// Its definition, its roles resolved: what its ground grid and its bloom read.
    pub json: Value,
    /// Its operator finish (#463) and the dirt on its lens (#418).
    pub finish: Finish,
    pub dirt: Option<Arc<Image>>,
}

fn unfit(code: &'static str) -> Unfit {
    Unfit {
        code,
        path: "look/asset".into(),
    }
}

impl Hub<'_> {
    /// The look@1 `doc` names by asset, resolved over the bundled faces (#1162).
    pub(crate) fn look_of(&self, doc: &Value) -> Option<Look> {
        resolved(doc, &self.look_def_of(doc)?).ok()
    }

    /// The look `doc` names, where the evidence store holds it.
    pub(crate) fn take_look(&mut self, doc: &Value) {
        if let Some(look) = self.look_of(doc) {
            self.look = look;
            self.look_def = self.look_def_of(doc);
        }
    }

    /// The look@1 a document names by asset, as the evidence store holds it.
    pub(crate) fn look_def_of(&self, doc: &Value) -> Option<Value> {
        serde_json::from_slice(&self.look_file(doc)?.1).ok()
    }

    /// The hash and the bytes of the look a document names by asset, where the store holds it.
    fn look_file(&self, doc: &Value) -> Option<(String, Vec<u8>)> {
        let name = doc.pointer("/look/asset")?.as_str()?;
        let id = name.split('@').next()?;
        let sha = doc.pointer(&format!("/assets/{id}/sha256"))?.as_str()?;
        let root = &self.scenario.evidence;
        let bytes = (sha.len() == 64)
            .then(|| std::fs::read(root.join(&sha[..2]).join(&sha[2..])).ok())
            .flatten()?;
        Some((sha.to_string(), bytes))
    }

    /// The look `doc`'s 3D frame draws in: the one it names, else the session's roles.
    pub(crate) fn look3(&mut self, doc: &Value) -> Result<Dressed, Unfit> {
        let named = doc.pointer("/look/asset").is_some();
        if !named || self.scenario.module_planted.as_deref() == Some(DROPS_LOOK) {
            return Ok(Dressed {
                look: Look3::from_roles(self.look.light.clone()),
                json: Value::Null,
                finish: Finish::default(),
                dirt: None,
            });
        }
        let (sha, bytes) = self.look_file(doc).ok_or_else(|| unfit("asset_missing"))?;
        // A look's bytes never change under its hash; its operators are its document's packs'.
        let key = format!("{sha} {} {}", doc["packs"], binds_status(doc));
        if let Some(d) = self.looks3.get(&key) {
            return Ok(d.clone());
        }
        let dressed = self.dress(doc, &bytes)?;
        self.looks3.insert(key, dressed.clone());
        Ok(dressed)
    }

    fn dress(&self, doc: &Value, bytes: &[u8]) -> Result<Dressed, Unfit> {
        let mut json: Value = serde_json::from_slice(bytes).map_err(|_| unfit("bad_look"))?;
        // Where status can show, its guard holds as the 2D path holds it; a frame that shows none
        // draws in any palette, as `deep-gpu`'s view draws it.
        let roles = if binds_status(doc) {
            resolved(doc, &json).map(|l| l.light)
        } else {
            look::light_roles(&json, &bundled())
        };
        let roles = roles.map_err(|r| match r {
            Refusal::Font(_) => unfit("font_unshippable"),
            _ => unfit("bad_look"),
        })?;
        // Its roles resolved, its theme's and its derived ones among them.
        for (role, [r, g, b]) in &roles {
            json["roles"][role] = json!(format!("#{r:02x}{g:02x}{b:02x}"));
        }
        let look = Look3::read(&json).map_err(|_| unfit("bad_look"))?;
        let colors: BTreeMap<String, [f64; 3]> = (look.roles.iter())
            .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
            .collect();
        let packs = doc["packs"].as_array().into_iter().flatten();
        let packs: Vec<Value> = packs
            .filter_map(|p| crate::packs::manifest_of(p.as_str()?))
            .collect();
        let finish = look_ops::of(&json, &packs, &colors).map_err(|_| unfit("bad_look"))?;
        let dirt = match json["bloom"]["dirt"]["texture"].as_str() {
            Some("seeded") | None => None,
            Some(sha) => Some(Arc::new(self.dirt(sha)?)),
        };
        Ok(Dressed {
            look,
            json,
            finish,
            dirt,
        })
    }

    /// The bloom's lens dirt PNG from the evidence store: each pixel's value its red channel ÷ 255.
    fn dirt(&self, sha: &str) -> Result<Image, Unfit> {
        let bytes = crate::evidence::read(&self.scenario.evidence, sha)
            .ok_or_else(|| unfit("asset_missing"))?;
        let img = image::load_from_memory(&bytes).map_err(|_| unfit("unreadable_image"))?;
        let img = img.to_rgba8();
        let mut out = Image::new(img.width(), img.height());
        for (p, px) in out.px.iter_mut().zip(img.pixels()) {
            let d = f64::from(px.0[0]) / 255.0;
            *p = [d, d, d, 1.0];
        }
        Ok(out)
    }
}

/// Whether status can show in `doc`: it has a status binding (the status-color rule's first case).
fn binds_status(doc: &Value) -> bool {
    doc.get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty())
}

/// The font files the build ships.
fn bundled() -> Vec<&'static str> {
    deep_text::FACES.iter().map(|f| f.file).collect()
}

/// `def` resolved over the bundled faces for `doc`: the status distance holds wherever status can
/// show; any other document may use any palette (#464).
fn resolved(doc: &Value, def: &Value) -> Result<Look, Refusal> {
    let at = if binds_status(doc) {
        look::Distance::Everywhere
    } else {
        look::Distance::WhereStatusShows
    };
    look::resolve_in(def, &bundled(), at)
}
