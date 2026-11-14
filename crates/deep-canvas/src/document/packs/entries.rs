//! How a pack's registry entries read beside the pack (Registry and seal: registries): a
//! first-party pack's entries keep their bare names, as a reopened list's first entries do, in a
//! registry that takes first-party packs' entries; and an entry that is a pack kind (Pack: kinds
//! in any pack), naming one of the pack's recipes, carries that recipe for its kit and its use
//! (#222's cue verbs, `{name, class, recipe}`).

use serde_json::Value;

use super::PackId;
use crate::registry::lists::SealedRegistry;

/// The owner of DeepBuild's own packs, as the hub reads the release's packs (`deepbuild/<name>`).
pub const OWNER: &str = "deepbuild";

/// Whether `entry` may go by its bare name in `reg`: the pack is DeepBuild's own, the registry
/// takes first-party packs' entries, and the name is one segment no canvas module's entry holds.
pub(super) fn bare(id: &PackId, reg: &SealedRegistry, entry: &str) -> bool {
    id.id.split_once('/').map(|(owner, _)| owner) == Some(OWNER)
        && reg.def.fill.contains(&"first_party_pack")
        && !entry.is_empty()
        && !entry.contains('.')
        && reg.entry(entry).is_none()
}

/// `value` with the recipe its `recipe` names, and the one its planted `twin` names, as
/// `recipe_body` and `twin_body`, each as the pack wrote it.
pub(super) fn with_recipes(value: &Value, recipes: Option<&Value>) -> Value {
    let mut out = value.clone();
    for (field, body) in [("recipe", "recipe_body"), ("twin", "twin_body")] {
        let named = value.get(field).and_then(Value::as_str);
        if let Some(recipe) = named
            .and_then(|k| recipes?.get(k))
            .filter(|r| r.is_object())
        {
            out[body] = recipe.clone();
        }
    }
    out
}
