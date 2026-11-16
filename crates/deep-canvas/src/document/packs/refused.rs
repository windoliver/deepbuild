//! #233: a familiar-names recipe's `refuses: {word → fix}`, each a parameter its reference takes
//! that no primitive behind the recipe can honor (Pack: "an input a recipe can't honor is refused
//! by name, never dropped"). An instance that writes one is refused at
//! `items/<id>/params/<word>`, naming the word, with the pack's own fix.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::Input;
use crate::document::Issue;

/// A recipe's `refuses`, checked at the pack check: each word maps to a fix as text, and a word
/// that is also one of its inputs is refused, since an input is honored.
pub(super) fn read(
    fields: &Map<String, Value>,
    inputs: &BTreeMap<String, Input>,
    path: &str,
    issues: &mut Vec<Issue>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(words) = fields.get("refuses") else {
        return out;
    };
    let Some(words) = words.as_object() else {
        let what = "refuses maps each parameter it can't honor to a fix";
        issues.push(Issue::envelope(
            "out_of_range",
            format!("{path}/refuses"),
            words.clone(),
            what,
        ));
        return out;
    };
    for (word, fix) in words {
        match fix.as_str() {
            Some(fix) if !fix.trim().is_empty() && !inputs.contains_key(word) => {
                out.insert(word.clone(), fix.to_string());
            }
            _ => issues.push(Issue::envelope(
                "out_of_range",
                format!("{path}/refuses/{word}"),
                fix.clone(),
                "a refused parameter is no input, and states its fix as text",
            )),
        }
    }
    out
}

/// The refusal of `word`, a parameter recipe `recipe` can't honor, written on instance `id`.
pub(super) fn refusal(id: &str, recipe: &str, word: &str, value: &Value, fix: &str) -> Issue {
    let what = format!("`{word}`: no primitive behind {recipe} honors it: refused, never dropped");
    let mut issue = Issue::error(
        "unknown_field",
        id,
        format!("items/{id}/params/{word}"),
        value.clone(),
        &what,
    );
    issue.fix = fix.to_string();
    issue
}
