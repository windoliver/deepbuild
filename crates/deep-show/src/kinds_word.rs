//! `deep_kinds {op: word}`: a word from a familiar-names pack installed here, answered from the
//! pack's `aliases` alone, never by spelling (Pack: math@1's `aliases`). A word's row gives what
//! it maps to (a kind, or since #233 an `ease@1` entry with its params), the conversion the pack
//! states, and the older spelling it replaces; a word with no closed form answers `no_match` with
//! the routes its row names, and a word no row holds answers `no_match`.

use serde_json::{json, Value};

use deep_canvas::document::Pack;

/// The answer for `word` from `packs`, in the order they're installed.
pub fn answer(packs: &[&Pack], word: &str) -> Value {
    for &p in packs {
        let Some(alias) = p.aliases.get(word) else {
            continue;
        };
        let (pack, conversion) = (p.id.text(), &alias["conversion"]);
        if let Some(routes) = alias.get("no_match") {
            return json!({"word": word, "code": "no_match", "routes": routes,
                          "conversion": conversion, "pack": pack});
        }
        let mut out = json!({"word": word, "target": alias["target"], "conversion": conversion,
                             "pack": pack});
        if let Some(old) = alias.get("renamed_from") {
            out["renamed_from"] = old.clone();
        }
        return out;
    }
    json!({"word": word, "code": "no_match"})
}
