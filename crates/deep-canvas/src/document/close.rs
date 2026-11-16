//! Close names (#412): an `unknown_kind` or `unknown_field` names at most three names the writer
//! may have meant. A name a migration's rename record gives comes first, with the kind version
//! that renamed it (`renamed_in`), ahead of any name close by spelling; spelling ranks the rest by
//! edit distance, then by name. A kind that defines the field (#1970) and an installed pack whose
//! census maps or refuses the name (#1493) come between them.

use serde_json::{json, Map, Value};

use super::packs::{Packs, Resolved};
use crate::kinds::{Entry, Registry, Version};
use crate::registry::Fault;

/// At most this many close names.
const MOST: usize = 3;

/// The edit distance between `a` and `b` counting a swap of two neighbours as one edit.
fn distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = best;
        }
    }
    d[a.len()][b.len()]
}

/// The candidates within reach of `wrong` by spelling, nearest first, then by name.
fn by_spelling<'n>(wrong: &str, candidates: impl Iterator<Item = &'n str>) -> Vec<&'n str> {
    let reach = (wrong.chars().count() / 3).max(1);
    let mut near: Vec<(usize, &str)> = candidates
        .filter(|c| *c != wrong)
        .map(|c| (distance(wrong, c), c))
        .filter(|(d, _)| *d <= reach)
        .collect();
    near.sort();
    near.into_iter().map(|(_, c)| c).collect()
}

/// The names among `candidates` a writer may have meant by `wrong`, by spelling: at most three,
/// nearest first.
fn close_names<'n>(wrong: &str, candidates: impl Iterator<Item = &'n str>) -> Vec<&'n str> {
    let mut near = by_spelling(wrong, candidates);
    near.truncate(MOST);
    near
}

/// The first name a reader of an occurrence list names that the list doesn't declare, and the
/// declared names close to it: a kind outside `declared` (each kind's `{fields: {name: type}}`,
/// as a logic item's `emits` gives them), or a field none of the kinds it reads declares. A row's
/// own columns (step, t, kind, a, b) are always declared (#544).
pub fn undeclared(
    declared: &Map<String, Value>,
    kinds: Option<&[String]>,
    fields: &[&str],
) -> Option<(String, Vec<String>)> {
    let close = |name: &str, candidates: Vec<&str>| {
        Some((
            name.to_string(),
            close_names(name, candidates.into_iter())
                .into_iter()
                .map(str::to_string)
                .collect(),
        ))
    };
    let kinds: Vec<&str> = match kinds {
        Some(kinds) => {
            if let Some(k) = kinds.iter().find(|k| !declared.contains_key(k.as_str())) {
                return close(k, declared.keys().map(String::as_str).collect());
            }
            kinds.iter().map(String::as_str).collect()
        }
        None => declared.keys().map(String::as_str).collect(),
    };
    let names: Vec<&str> = kinds
        .iter()
        .filter_map(|k| declared.get(*k)?.get("fields")?.as_object())
        .flat_map(|f| f.keys().map(String::as_str))
        .collect();
    let f = fields
        .iter()
        .find(|f| !names.contains(f) && !["step", "t", "kind", "a", "b"].contains(f))?;
    close(f, names)
}

/// The close names for a kind text no registry in this build holds: the installed packs whose
/// census holds it (#1493), then every kind at its build major, by spelling.
pub fn kind_names(
    text: &str,
    kinds: &Registry,
    census: &[Value],
    fault: Option<Fault>,
) -> Vec<Value> {
    if fault == Some(Fault::NoCloseNames) {
        return Vec::new();
    }
    let names: Vec<String> = kinds
        .entries()
        .iter()
        .map(|e| format!("{}@{}", e.full_name(), e.current().major))
        .collect();
    census
        .iter()
        .cloned()
        .chain(
            by_spelling(text, names.iter().map(String::as_str))
                .into_iter()
                .map(|n| json!({"name": n})),
        )
        .take(MOST)
        .collect()
}

/// What each installed pack's census says of `word` (#1493), one entry a pack: a pack whose
/// census maps it gives `{name: pack, maps, target, conversion}`, with `kind` for a parameter of
/// a name it maps; one that refuses it gives `{name: pack, refuses, reason}`, with `target` when
/// the row says what to write instead. An open row says nothing, and nothing is accepted.
pub fn census(word: &str, packs: &Packs, fault: Option<Fault>) -> Vec<Value> {
    if matches!(
        fault,
        Some(Fault::NoCloseNames | Fault::CloseBySpelling | Fault::CensusSkipped)
    ) {
        return Vec::new();
    }
    let mut out = Vec::new();
    for pack in packs.all() {
        let rows = || pack.census.iter().filter(|r| r.word == word);
        let Some(row) = rows()
            .find(|r| r.state == "mapped")
            .or_else(|| rows().find(|r| r.state == "refused"))
        else {
            continue;
        };
        let alias = pack.aliases.get(row.of.as_deref().unwrap_or(word));
        let mut entry = json!({"name": pack.id.text()});
        if row.state == "mapped" {
            entry["maps"] = json!(word);
            entry["target"] = json!(row.target.as_deref().unwrap_or(word));
            entry["conversion"] = alias.map_or(Value::Null, |a| a["conversion"].clone());
        } else {
            entry["refuses"] = json!(word);
            entry["reason"] = json!(row.reason);
            if let Some(instead) = &row.target {
                entry["target"] = json!(instead);
            }
        }
        if row.of.is_some() {
            entry["kind"] = alias.map_or(Value::Null, |a| a["target"].clone());
        }
        out.push(entry);
    }
    out
}

/// The fix's sentences for the census entries in `close`, in its order (#1493): a pack that maps
/// the word names its target and conversion, and, when the document doesn't name the pack, says
/// to; one that refuses it names its reason.
pub fn census_fix(close: &[Value], resolved: &Resolved<'_>) -> Vec<String> {
    close
        .iter()
        .filter_map(|c| {
            let pack = c["name"].as_str()?;
            if let Some(word) = c["maps"].as_str() {
                let field = c["target"].as_str().unwrap_or(word);
                let target = match c["kind"].as_str() {
                    Some(kind) => format!("{kind}'s `{field}`"),
                    None => field.to_string(),
                };
                let named = resolved.by_name.values().any(|p| p.id.text() == pack);
                let add = if named {
                    String::new()
                } else {
                    format!(", with {pack} in the document's packs")
                };
                let conversion = c["conversion"].as_str().unwrap_or("no conversion stated");
                Some(format!(
                    "{pack} maps `{word}` to {target} ({conversion}): write {target}{add}, or remove it."
                ))
            } else {
                let word = c["refuses"].as_str()?;
                let instead = c["target"]
                    .as_str()
                    .map(|t| format!("; write {t} instead"))
                    .unwrap_or_default();
                Some(format!(
                    "{pack} refuses `{word}`: {}{instead}.",
                    c["reason"].as_str().unwrap_or_default()
                ))
            }
        })
        .collect()
}

/// Every other kind whose build major defines a field of exactly `name`, as `family.name@major`,
/// by name (#1970).
pub fn owners(name: &str, entry: &Entry, kinds: &Registry, fault: Option<Fault>) -> Vec<String> {
    if matches!(fault, Some(Fault::NoCloseNames | Fault::CloseBySpelling)) {
        return Vec::new();
    }
    let own = entry.full_name();
    let mut out: Vec<String> = kinds
        .entries()
        .iter()
        .filter(|e| e.current().param(name).is_some() && e.full_name() != own)
        .map(|e| format!("{}@{}", e.full_name(), e.current().major))
        .collect();
    out.sort();
    out
}

/// The close names for a field `name` the kind's `version` doesn't define: the name a rename
/// record up to that version gives it, then each kind in `owners` that defines it, then each
/// pack whose census holds it (#1493), then its params by spelling.
pub fn field_names(
    name: &str,
    entry: &Entry,
    version: &Version,
    owners: &[String],
    census: &[Value],
    fault: Option<Fault>,
) -> Vec<Value> {
    if fault == Some(Fault::NoCloseNames) {
        return Vec::new();
    }
    let mut out: Vec<Value> = Vec::new();
    if fault != Some(Fault::CloseBySpelling) {
        for m in entry.migrations.iter().filter(|m| m.to <= version.major) {
            for r in m.renames.iter().filter(|r| r.from == name) {
                if version.param(r.to).is_some() && !out.iter().any(|c| c["name"] == r.to) {
                    out.push(json!({"name": r.to, "renamed_in": format!("{}@{}", entry.full_name(), m.to)}));
                }
            }
        }
    }
    let pack_first = fault == Some(Fault::CensusPackFirst);
    if pack_first {
        out.extend(census.iter().cloned());
    }
    out.extend(owners.iter().map(|k| json!({"name": k, "defines": name})));
    if !pack_first {
        out.extend(census.iter().cloned());
    }
    for n in by_spelling(name, version.params.iter().map(|p| p.name)) {
        if !out.iter().any(|c| c["name"] == n) {
            out.push(json!({"name": n}));
        }
    }
    out.truncate(MOST);
    out
}

#[cfg(test)]
mod tests {
    use super::distance;

    #[test]
    fn a_swap_of_neighbours_is_one_edit() {
        assert_eq!(distance("circel", "circle"), 1);
        assert_eq!(distance("centre", "center"), 1);
        assert!(distance("thick", "stroke_width") > 3);
    }
}
