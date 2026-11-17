//! The build's first-party packs of library interfaces (#416; canvas primitives: Logic: library
//! interfaces): `packs/interfaces-1.0.0`, which declares physics2d.lib@1, fsm@1 and nn.mlp@1, held in
//! the binary so every piece's links resolve against them, as the release's packs are installed for
//! every document.

use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};

use crate::links::Pack;

macro_rules! pack_file {
    ($path:literal) => {
        (
            $path,
            include_bytes!(concat!("../../../packs/interfaces-1.0.0/", $path)) as &[u8],
        )
    };
}

/// `pack.json`, and each asset it lists by its path.
const MANIFEST: &str = include_str!("../../../packs/interfaces-1.0.0/pack.json");
const FILES: &[(&str, &[u8])] = &[
    pack_file!("objects/slide.wasm"),
    pack_file!("fixtures/slide.json"),
    pack_file!("objects/fall.wasm"),
    pack_file!("fixtures/fall.json"),
    pack_file!("objects/physics2d_average.wasm"),
    pack_file!("objects/door.wasm"),
    pack_file!("fixtures/door.json"),
    pack_file!("objects/fsm_lazy.wasm"),
    pack_file!("data/net-4-8-2.bin"),
    pack_file!("data/input-4.bin"),
    pack_file!("objects/net.wasm"),
    pack_file!("fixtures/4-8-2.json"),
    pack_file!("objects/mlp_fused.wasm"),
];

/// The first-party packs as a piece's `packs` hold them: name, version, origin `first_party`, and
/// the interfaces each declares.
pub fn packs() -> &'static [Value] {
    static PACKS: OnceLock<Vec<Value>> = OnceLock::new();
    PACKS.get_or_init(|| {
        let m: Value = serde_json::from_str(MANIFEST).expect("the first-party pack's manifest");
        vec![json!({"name": m["name"], "version": m["version"], "origin": "first_party",
                    "libs": m.get("libs").cloned().unwrap_or(json!({})), "interfaces": m["interfaces"]})]
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
        FILES
            .iter()
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
    /// Each asset the manifest lists is held here, at its sha256, and nothing else is.
    #[test]
    fn the_binary_holds_every_asset_the_first_party_pack_lists() {
        let m: serde_json::Value = serde_json::from_str(super::MANIFEST).unwrap();
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
        let held: Vec<(String, String)> = super::FILES
            .iter()
            .map(|(p, b)| (p.to_string(), deep_canvas_sandbox::rewrite::hash(b)))
            .collect();
        assert_eq!(held, listed);
    }
}
