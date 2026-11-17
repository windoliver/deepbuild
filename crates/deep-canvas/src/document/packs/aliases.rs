//! A familiar-names pack's `aliases` (Pack: math@1's `aliases`): each word another tool's users
//! know, with what it maps to and the conversion the pack states as text, and an older spelling
//! it replaces (`renamed_from`). `deep_kinds` answers a word from this field alone.
//!
//! A target is a kind as `name@major` (#412) or, since #233, an `ease@1` entry with its params
//! (`{ease: {name: "sigmoid", params: 10}}`, the form a key's interp takes). A kind in the pack's own
//! family must be one of its recipes or kinds, and one in another pack's family a pack it requires
//! or a kind the build holds; an ease must be one this build holds with params it takes. A word
//! with no closed form states `no_match` in place of a target: the routes to take instead. Anything
//! else is refused at `aliases/<word>`, naming the word, so no mapping is inferred.

use std::collections::BTreeMap;

use serde_json::Value;

use super::{deps::Dep, Recipe};
use crate::document::Issue;
use crate::registry::Sealed;

/// What a pack holds that its aliases may name.
pub(super) struct Holds<'a> {
    pub pack: &'a str,
    pub recipes: &'a BTreeMap<String, Recipe>,
    pub kinds: &'a BTreeMap<String, crate::document::pack_kinds::PackKind>,
    pub requires: &'a [Dep],
    pub sealed: &'a Sealed,
}

impl Holds<'_> {
    /// Why kind `target` names nothing this pack can map to, if it doesn't.
    fn kind_fault(&self, target: &str) -> Option<String> {
        let Some((name, major)) = crate::kinds::parse_kind(target) else {
            return Some(format!("`{target}` is not a kind written name@major"));
        };
        let Some((family, _)) = name.split_once('.') else {
            // A bare kind is a core or module kind, another build's when this one lacks it.
            return None;
        };
        if family == self.pack {
            let recipe = self
                .recipes
                .get(&name)
                .is_some_and(|r| r.major == u64::from(major));
            return (!(recipe || self.kinds.contains_key(target)))
                .then(|| format!("`{target}` is no recipe or kind of pack `{}`", self.pack));
        }
        if self.requires.iter().any(|d| d.name == family) {
            return None;
        }
        let built = matches!(
            crate::kinds::lookup(self.sealed.kinds_ref(), target),
            crate::kinds::Lookup::Known { .. }
        );
        (!built).then(|| {
            format!(
                "`{target}` is no kind of this build or of a pack `{}` requires",
                self.pack
            )
        })
    }
}

/// Why an `ease@1` target, `{ease: {name, params}}` as a key's interp writes one, names no ease this
/// build holds, if it doesn't.
fn ease_fault(target: &serde_json::Map<String, Value>) -> Option<String> {
    let Some(Value::Object(ease)) = target.get("ease").filter(|_| target.len() == 1) else {
        return Some("an ease target is {ease: {name, params}}".into());
    };
    if ease.keys().any(|k| k != "name" && k != "params") {
        return Some("an ease target is {ease: {name, params}}".into());
    }
    let Some(name) = ease.get("name").and_then(Value::as_str) else {
        return Some("an ease target names its ease@1 entry".into());
    };
    match crate::ease::parse(name, ease.get("params")) {
        Ok(Some(_)) => None,
        Ok(None) => Some(format!("`{name}` is no ease@1 entry of this build")),
        Err(bad) => Some(format!("ease `{name}`: `{}` {}", bad.param, bad.why)),
    }
}

/// A pack's `aliases`, checked: the words that map, each as written.
pub(super) fn check(
    aliases: &Value,
    holds: &Holds<'_>,
    issues: &mut Vec<Issue>,
) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let Some(words) = aliases.as_object() else {
        let what = "not an object";
        issues.push(Issue::envelope(
            "out_of_range",
            "aliases".into(),
            aliases.clone(),
            what,
        ));
        return out;
    };
    for (word, alias) in words {
        let text = |k: &str| {
            alias
                .get(k)
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
        };
        let keys_ok = alias.as_object().is_some_and(|a| {
            a.keys().all(|k| {
                matches!(
                    k.as_str(),
                    "target" | "conversion" | "renamed_from" | "no_match"
                )
            })
        });
        let fault = match (alias.get("target"), text("no_match")) {
            _ if !keys_ok => Some("an alias is {target, conversion, renamed_from?}".to_string()),
            (Some(Value::String(kind)), None) => holds.kind_fault(kind),
            (Some(Value::Object(ease)), None) => ease_fault(ease),
            (None, Some(_)) => None,
            _ => Some("an alias states a target, or no_match with the routes to take".into()),
        };
        let fault = fault.or_else(|| {
            let renamed = alias.get("renamed_from").is_none_or(|r| r.is_string());
            match (text("conversion"), renamed) {
                (Some(_), true) => None,
                (None, _) => Some("an alias states its conversion as text".into()),
                (_, false) => Some("renamed_from is the older spelling, as text".into()),
            }
        });
        match fault {
            None => {
                out.insert(word.clone(), alias.clone());
            }
            Some(why) => issues.push(Issue::envelope(
                "out_of_range",
                format!("aliases/{word}"),
                alias.clone(),
                &format!("alias `{word}`: {why}"),
            )),
        }
    }
    out
}
