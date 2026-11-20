//! The build's first-party packs (#416, #953; canvas primitives: Logic: library interfaces):
//! `packs/interfaces-1.0.0`, which declares physics2d.lib@1, fsm@1 and nn.mlp@1, and
//! `packs/modslib-1.0.0`, which declares mods.lib@1 with its reference library mods.tree, held in
//! the binary so every piece's links resolve against them, as the release's packs are installed for
//! every document.

use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};

use crate::links::Pack;

macro_rules! pack_file {
    ($dir:literal, $path:literal) => {
        (
            $path,
            include_bytes!(concat!("../../../packs/", $dir, "/", $path)) as &[u8],
        )
    };
}

/// A pack's assets, each by its path.
type Files = &'static [(&'static str, &'static [u8])];

/// Each first-party pack's `pack.json`, and each asset it lists by its path.
const PACKS: &[(&str, Files)] = &[
    (
        include_str!("../../../packs/interfaces-1.0.0/pack.json"),
        &[
            pack_file!("interfaces-1.0.0", "objects/slide.wasm"),
            pack_file!("interfaces-1.0.0", "fixtures/slide.json"),
            pack_file!("interfaces-1.0.0", "objects/fall.wasm"),
            pack_file!("interfaces-1.0.0", "fixtures/fall.json"),
            pack_file!("interfaces-1.0.0", "objects/physics2d_average.wasm"),
            pack_file!("interfaces-1.0.0", "objects/door.wasm"),
            pack_file!("interfaces-1.0.0", "fixtures/door.json"),
            pack_file!("interfaces-1.0.0", "objects/fsm_lazy.wasm"),
            pack_file!("interfaces-1.0.0", "data/net-4-8-2.bin"),
            pack_file!("interfaces-1.0.0", "data/input-4.bin"),
            pack_file!("interfaces-1.0.0", "objects/net.wasm"),
            pack_file!("interfaces-1.0.0", "fixtures/4-8-2.json"),
            pack_file!("interfaces-1.0.0", "objects/mlp_fused.wasm"),
        ],
    ),
    (
        include_str!("../../../packs/modslib-1.0.0/pack.json"),
        &[
            pack_file!("modslib-1.0.0", "objects/mods_tree.wasm"),
            pack_file!("modslib-1.0.0", "objects/mods_stale.wasm"),
            pack_file!("modslib-1.0.0", "data/units.bin"),
            pack_file!("modslib-1.0.0", "objects/stack.wasm"),
            pack_file!("modslib-1.0.0", "data/stack.bin"),
            pack_file!("modslib-1.0.0", "fixtures/stack.json"),
            pack_file!("modslib-1.0.0", "objects/edits.wasm"),
            pack_file!("modslib-1.0.0", "data/edits.bin"),
            pack_file!("modslib-1.0.0", "fixtures/edits.json"),
            pack_file!("modslib-1.0.0", "objects/archer_own.wasm"),
            pack_file!("modslib-1.0.0", "data/archer_own.bin"),
            pack_file!("modslib-1.0.0", "fixtures/archer_own.json"),
        ],
    ),
];

/// The first-party packs as a piece's `packs` hold them: name, version, origin `first_party`, and
/// the interfaces each declares.
pub fn packs() -> &'static [Value] {
    static LISTED: OnceLock<Vec<Value>> = OnceLock::new();
    LISTED.get_or_init(|| {
        PACKS
            .iter()
            .map(|(manifest, _)| {
                let m: Value = serde_json::from_str(manifest).expect("a first-party pack's manifest");
                json!({"name": m["name"], "version": m["version"], "origin": "first_party",
                    "libs": m.get("libs").cloned().unwrap_or(json!({})), "interfaces": m["interfaces"]})
            })
            .collect()
    })
}

/// The first-party packs, parsed.
pub fn parsed() -> &'static [Pack] {
    static PARSED: OnceLock<Vec<Pack>> = OnceLock::new();
    PARSED.get_or_init(|| {
        packs()
            .iter()
            .map(|p| Pack::parse(p).expect("a first-party pack parses"))
            .collect()
    })
}

/// Every asset the first-party packs carry, by sha256, in base64.
pub fn assets() -> &'static Map<String, Value> {
    static ASSETS: OnceLock<Map<String, Value>> = OnceLock::new();
    ASSETS.get_or_init(|| {
        PACKS
            .iter()
            .flat_map(|(_, files)| files.iter())
            .map(|(_, b)| (deep_canvas_sandbox::rewrite::hash(b), json!(B64.encode(b))))
            .collect()
    })
}

/// `{"call": "first_party"}`: the build's first-party packs and their assets.
pub fn reply() -> Value {
    json!({"ok": true, "packs": packs(), "assets": assets()})
}

#[cfg(test)]
mod tests {
    /// Each asset a first-party pack's manifest lists is held here, at its sha256, and nothing else is.
    #[test]
    fn the_binary_holds_every_asset_the_first_party_packs_list() {
        for (manifest, files) in super::PACKS {
            let m: serde_json::Value = serde_json::from_str(manifest).unwrap();
            let listed: Vec<(String, String)> = m["assets"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| {
                    (
                        a["path"].as_str().unwrap().into(),
                        a["sha256"].as_str().unwrap().into(),
                    )
                })
                .collect();
            let held: Vec<(String, String)> = files
                .iter()
                .map(|(p, b)| (p.to_string(), deep_canvas_sandbox::rewrite::hash(b)))
                .collect();
            assert_eq!(held, listed, "{}", m["name"]);
        }
    }
}
