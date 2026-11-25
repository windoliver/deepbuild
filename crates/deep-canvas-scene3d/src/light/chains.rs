//! Issue #3257: what a host makes of each map a scene or a document samples, by its texels' key:
//! one chain a role, and one a cutoff where a mask samples it.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

/// The mips a mask's or a blend's base color map samples: its texels' key, and a mask's cutoff, at
/// which each level keeps level 0's coverage.
#[derive(Clone, Debug, PartialEq)]
pub struct Chain {
    pub key: String,
    pub cutoff: Option<f32>,
}

impl Chain {
    /// The chain of image `sha` in the base color of the `material@1` whose params are `p`, in
    /// `mode` where they name none; `None` where its alpha isn't drawn. A mask tests the image's
    /// alpha times the material's own, so the image's cutoff is the material's over that alpha.
    pub(super) fn of(sha: &str, p: &Value, mode: AlphaMode) -> Option<Chain> {
        let own = p["alpha_mode"].as_str().and_then(AlphaMode::read);
        let cutoff = match own.unwrap_or(mode) {
            AlphaMode::Mask => {
                let own = num(p["base_color"].get(3)).unwrap_or(1.0);
                let alpha = own * num(p.get("alpha")).unwrap_or(1.0);
                Some((num(p.get("alpha_cutoff")).unwrap_or(0.5) / alpha) as f32)
            }
            AlphaMode::Blend => None,
            AlphaMode::Opaque | AlphaMode::Add => return None,
        };
        let key = cutoff.map_or(format!("{sha}:blend"), |c| format!("{sha}:{c}"));
        Some(Chain { key, cutoff })
    }
}

impl MapSlot {
    /// Its texels' key in the scene's.
    pub fn key(&self) -> &str {
        self.chain.as_ref().map_or(&self.sha, |c| &c.key)
    }
}

/// What a host makes ready under one key of a scene's texels: the image, the fields that name it
/// and the mask's cutoff, where one samples it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MapUse {
    pub sha: String,
    pub fields: BTreeSet<&'static str>,
    /// Whether a mask or a blend draws its alpha.
    drawn: bool,
    pub cutoff: Option<f32>,
}

impl MapUse {
    /// The decode worker's job role: base color whose alpha is drawn, the other color fields'
    /// sRGB, a normal map's two channels, an occlusion map alone's one channel, else linear data
    /// (Material: texture maps: the format follows the map's role).
    pub fn role(&self) -> &'static str {
        let has = |f: &str| self.fields.contains(f);
        if self.drawn {
            "base_color"
        } else if has("base_color") || has("emission") {
            "color"
        } else if has("normal_map") {
            "normal"
        } else if self.fields.len() == 1 && has("occlusion") {
            "occlusion"
        } else {
            "data"
        }
    }
}

/// Every map a scene or a document samples, by its texels' key.
pub type MapUses = BTreeMap<String, MapUse>;

pub(super) fn map_use(out: &mut MapUses, sha: &str, field: &'static str, chain: Option<&Chain>) {
    let key = chain.map_or(sha, |c| c.key.as_str());
    let u = out.entry(key.to_string()).or_default();
    u.sha = sha.to_string();
    u.fields.insert(field);
    u.drawn = chain.is_some();
    u.cutoff = chain.and_then(|c| c.cutoff);
}
