//! A familiar-names pack's census (#1493): each public name of its reference, and each
//! parameter of a name it maps, in one state: mapped, refused with a reason from a closed list,
//! or open. `scripts/census.mjs` writes it from the reference and checks it against the pack; the
//! pack check reads its rows, so a refused row with no reason, or a mapped row the aliases
//! don't hold, refuses the pack.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::document::Issue;

/// The reasons a census row refuses a word for.
pub const REASONS: &[&str] = &["imperative", "renderer", "superseded", "no_counterpart"];

/// One row: a name of the reference, or a parameter `word` of the mapped name `of`.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub word: String,
    pub of: Option<String>,
    /// `mapped`, `refused` or `open`.
    pub state: String,
    /// What a mapped row maps to, or what a refused row says to write instead.
    pub target: Option<String>,
    pub reason: Option<String>,
}

/// A census's rows, each checked: its state one of the three, a refused row's reason from
/// [`REASONS`], and its mapped names exactly the pack's `aliases`, each to the alias's target.
/// A fault is an issue at `census/<name>`.
pub(crate) fn read(
    census: &Value,
    aliases: &BTreeMap<String, Value>,
    issues: &mut Vec<Issue>,
) -> Vec<Row> {
    let bad = |path: String, actual: Value, what: &str| {
        Issue::envelope("out_of_range", format!("census/{path}"), actual, what)
    };
    let table = |key: &str| census.get(key).and_then(Value::as_array);
    let Some(names) = table("names").filter(|_| census.get("params").is_none_or(Value::is_array))
    else {
        issues.push(Issue::envelope(
            "out_of_range",
            "census".into(),
            json!("census"),
            "a census is {reference, scope, names: [rows], params: [rows], totals}",
        ));
        return Vec::new();
    };
    let params = table("params").map(Vec::as_slice).unwrap_or_default();
    let text = |row: &Value, key: &str| row.get(key).and_then(Value::as_str).map(str::to_string);
    let mut rows = Vec::new();
    for (row, param) in names
        .iter()
        .map(|r| (r, false))
        .chain(params.iter().map(|r| (r, true)))
    {
        let Some(name) = text(row, "name") else {
            issues.push(bad("names".into(), row.clone(), "a row names its word"));
            continue;
        };
        let Some(word) = (if param {
            text(row, "param")
        } else {
            Some(name.clone())
        }) else {
            issues.push(bad(
                name,
                row.clone(),
                "a parameter row names its parameter",
            ));
            continue;
        };
        let path = if param {
            format!("{name}/{word}")
        } else {
            name.clone()
        };
        let state = text(row, "state").unwrap_or_default();
        let reason = text(row, "reason");
        match state.as_str() {
            "mapped" | "open" => {}
            "refused" if reason.as_deref().is_some_and(|r| REASONS.contains(&r)) => {}
            "refused" => issues.push(bad(
                path.clone(),
                row.clone(),
                &format!(
                    "`{word}` is refused with no reason from {}",
                    REASONS.join(", ")
                ),
            )),
            _ => issues.push(bad(
                path.clone(),
                row.clone(),
                "a row's state is mapped, refused or open",
            )),
        }
        let alias = aliases.get(&name);
        let target = text(row, "target");
        if state == "mapped"
            && !param
            && alias.and_then(|a| a["target"].as_str()) != target.as_deref()
        {
            issues.push(bad(
                path.clone(),
                row.clone(),
                &format!("`{word}` is mapped, and no alias maps it to that target"),
            ));
        }
        if state == "mapped" && param && alias.is_none() {
            issues.push(bad(
                path.clone(),
                row.clone(),
                &format!("`{word}` is a parameter of `{name}`, which no alias maps"),
            ));
        }
        rows.push(Row {
            word,
            of: param.then_some(name),
            state,
            target,
            reason,
        });
    }
    for word in aliases.keys() {
        if !rows
            .iter()
            .any(|r| r.of.is_none() && &r.word == word && r.state == "mapped")
        {
            issues.push(bad(
                word.clone(),
                json!(word),
                &format!("the alias `{word}` has no mapped row"),
            ));
        }
    }
    rows
}
