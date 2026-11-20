//! Moved and removed kinds (canvas primitives: Pack: migrations as data; issue #1962). A pack
//! version may move a kind to another pack, or drop it, and no kind disappears silently.
//! `moved: {<old kind>@<major>: <pack>/<kind>@<major>}` names the kind each moved kind became, in
//! the pack itself or in one its `requires.packs` lists; [`follow`] holds each entry to a kind
//! that exists, and refuses a target that is itself moved, a loop, or a target in an undeclared
//! pack, naming the entry and the reason. A kind the version drops from the version before it,
//! with no `moved` entry and no later major, is a removal: [`dropped`] refuses the version unless
//! `removed: {<old kind>@<major>: reason}` lists the kind, and [`removals`] refuses a document
//! that opens instances of a removed kind under the version, naming them.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::deps::Dep;
use super::{well_named, Pack, Packs, Resolved};
use crate::document::{Issue, Notice};

/// The kind `kind` became, when the version of its pack the document resolves moved it.
pub fn moved_to(kind: &str, resolved: &Resolved) -> Option<String> {
    let (family, _) = kind.split_once('.')?;
    resolved.by_name.get(family)?.moved.get(kind).cloned()
}

/// The version of `kind`'s pack the document resolves, with its reason, when it removed `kind`.
fn removal<'a>(kind: &str, resolved: &Resolved<'a>) -> Option<(&'a Pack, &'a str)> {
    let pack: &'a Pack = *resolved.by_name.get(kind.split_once('.')?.0)?;
    Some((pack, pack.removed.get(kind)?.as_str()))
}

/// Whether the version of `kind`'s pack the document resolves removed it: its items are named by
/// [`removals`], and the check reads nothing of them past their kind.
pub fn removed(kind: &str, resolved: &Resolved) -> bool {
    removal(kind, resolved).is_some()
}

/// The load's refusal of the instances of each kind the version their document names removed:
/// one `unknown_kind` error per kind, naming its items, the version and the reason, with a fix
/// that names each item. The items stay as written; a document still opens under the version it
/// named before.
pub fn removals(items: &Map<String, Value>, resolved: &Resolved) -> Vec<Issue> {
    let mut found: BTreeMap<&str, (&Pack, &str, Vec<String>)> = BTreeMap::new();
    for (id, item) in items {
        let Some(kind) = crate::document::kind_text(item) else {
            continue;
        };
        if let Some((pack, why)) = removal(kind, resolved) {
            found
                .entry(kind)
                .or_insert((pack, why, Vec::new()))
                .2
                .push(id.clone());
        }
    }
    let mut issues = Vec::new();
    for (kind, (pack, why, ids)) in found {
        let version = pack.id.text();
        let named = match ids.split_last() {
            Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
            _ => ids.join(""),
        };
        let what = format!("pack `{version}` removed the kind `{kind}` ({why}), and {named} are of it: the document can't take that version");
        let actual = json!({"kind": kind, "pack": version, "reason": why, "items": ids});
        let mut issue = Issue::envelope(
            "unknown_kind",
            format!("items/{}/kind", ids[0]),
            actual,
            &what,
        );
        issue.fix = format!("Delete {named}, or keep the document on a version of {} that has {kind}, which {version} removed ({why}).", pack.id.id);
        issue.ids = ids;
        issues.push(issue);
    }
    issues
}

/// The load's `migrated` notice for an instance its pack moved, as for a preview kind its module
/// removed (#1802): the item, the kind it was saved as and the kind it opens as, one per item.
pub fn moved_notice(key: &str, from: &str, to: &str) -> Notice {
    Notice {
        code: "migrated",
        ids: vec![key.to_string()],
        path: format!("items/{key}/kind"),
        actual: json!(from),
        what: format!("migrated {from}, a kind its pack moved, to {to}"),
        migration: None,
        replaced_by: None,
        close: Vec::new(),
    }
}

/// `<pack>.<name>@<major>`: its pack, its `<pack>.<name>` and its major.
fn split(kind: &str) -> Option<(&str, &str, u64)> {
    let (full, major) = kind.rsplit_once('@')?;
    let major = major.parse::<u64>().ok().filter(|m| *m >= 1)?;
    let (pack, name) = full.split_once('.')?;
    let mut chars = name.chars();
    let named = matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    (well_named(pack) && named).then_some((pack, full, major))
}

/// Every kind an instance of `pack` may name: its kinds, and each recipe at its major.
fn kinds(pack: &Pack) -> impl Iterator<Item = String> + '_ {
    let recipes = pack
        .recipes
        .values()
        .map(|r| format!("{}@{}", r.id, r.major));
    pack.kinds.keys().cloned().chain(recipes)
}

/// Whether `pack` holds the kind `kind`: as a kind of its own or a recipe at that major, or as a
/// kind at a later major that carries every step from that one, which a move then takes.
fn holds(pack: &Pack, kind: &str) -> bool {
    let Some((_, full, major)) = split(kind) else {
        return false;
    };
    kinds(pack).any(|k| k == kind)
        || pack.kinds.iter().any(|(name, k)| {
            let steps = |m: u64| (major..m).all(|s| k.migrate.contains_key(&s));
            split(name).is_some_and(|(_, f, m)| f == full && m > major && steps(m))
        })
}

/// A refused entry of `moved`, at `moved/<entry>`, naming the entry, its target and the reason.
fn refused(code: &'static str, entry: &str, to: &Value, reason: &str, what: String) -> Issue {
    let actual = json!({"entry": entry, "to": to, "reason": reason});
    let mut issue = Issue::envelope(code, format!("moved/{entry}"), actual, &what);
    issue.fix = format!("Point `{entry}` at a kind that exists, in this pack or one `requires.packs` lists, and that moves no further; or list it under `removed` with a reason.");
    issue
}

/// Reads `moved` and `removed`: each key a kind of the pack, each `moved` target
/// `<pack>/<kind>@<major>` of the pack itself or of one `requires.packs` lists, each `removed`
/// value a reason. Returns each move as `<old kind> → <pack>.<kind>@<major>`, and each removal
/// with its reason; an entry that fails is refused, naming it.
pub(super) fn read(
    fields: &Map<String, Value>,
    own: &str,
    deps: &[Dep],
    issues: &mut Vec<Issue>,
) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let mut entries = |field: &str| -> Vec<(String, Value)> {
        match fields.get(field) {
            None => Vec::new(),
            Some(Value::Object(map)) => map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            Some(other) => {
                let what = format!("a pack's `{field}` is {{<pack>.<kind>@<major>: …}}");
                issues.push(Issue::envelope(
                    "out_of_range",
                    field.into(),
                    other.clone(),
                    &what,
                ));
                Vec::new()
            }
        }
    };
    let (moved_entries, removed_entries) = (entries("moved"), entries("removed"));
    let mine = |kind: &str| split(kind).is_some_and(|(pack, _, _)| pack == own);
    let mut moved = BTreeMap::new();
    for (entry, to) in moved_entries {
        let target = to
            .as_str()
            .and_then(|t| t.split_once('/'))
            .map(|(pack, kind)| format!("{pack}.{kind}"))
            .filter(|k| split(k).is_some());
        let Some((target, true)) = target.map(|t| (t, mine(&entry))) else {
            let what = format!(
                "`moved` entry `{entry}` is not `<{own} kind>@<major>: <pack>/<kind>@<major>`"
            );
            issues.push(refused("out_of_range", &entry, &to, "malformed", what));
            continue;
        };
        let pack = split(&target).map_or("", |(p, _, _)| p);
        if pack != own && !deps.iter().any(|d| d.name == pack) {
            let what = format!("`moved` entry `{entry}` moves it to `{target}` of the pack `{pack}`, which `requires.packs` doesn't list: a kind moves within its pack or to a pack it declares");
            issues.push(refused(
                "ref_unresolved",
                &entry,
                &to,
                "undeclared_pack",
                what,
            ));
            continue;
        }
        moved.insert(entry, target);
    }
    let mut removed = BTreeMap::new();
    for (kind, why) in removed_entries {
        match why.as_str().filter(|w| !w.trim().is_empty()) {
            Some(why) if mine(&kind) => {
                removed.insert(kind, why.to_string());
            }
            _ => {
                let what =
                    format!("`removed` entry `{kind}` is not `<{own} kind>@<major>: <reason>`");
                let at = format!("removed/{kind}");
                issues.push(Issue::envelope(
                    "out_of_range",
                    at,
                    json!({"kind": kind, "reason": why}),
                    &what,
                ));
            }
        }
    }
    (moved, removed)
}

/// The pack check's half that needs the store: [`follow`] and [`dropped`], every fault named.
pub(super) fn check(packs: &Packs, pack: &Pack) -> Result<(), Vec<Issue>> {
    let mut issues = follow(packs, pack);
    issues.extend(dropped(packs, pack));
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

/// Follows each `moved` entry of `pack` to a kind that exists: in the pack itself, or in the
/// version `packs` admitted of a pack it requires. An entry whose target is itself moved (a chain
/// longer than one step), one that leads back to its source (a loop), and one whose target no
/// such version holds are refused, naming the entry and the reason.
fn follow(packs: &Packs, pack: &Pack) -> Vec<Issue> {
    // The version that holds a kind of `family`: the pack itself, or the one it requires.
    let holder = |family: &str| -> Option<&Pack> {
        if family == pack.id.name {
            return Some(pack);
        }
        let dep = pack.requires_packs.iter().find(|d| d.name == family)?;
        packs
            .all()
            .find(|p| p.id.name == dep.name && p.id.version == dep.version)
    };
    let next = |kind: &str| holder(split(kind)?.0)?.moved.get(kind).cloned();
    let mut issues = Vec::new();
    for (from, to) in &pack.moved {
        let written = Value::String(to.replacen('.', "/", 1));
        // Where the entries lead from `to`: back to `from` is a loop; on past `to`, a chain.
        let mut trail = vec![to.clone()];
        while let Some(n) = next(trail.last().map_or("", String::as_str)) {
            let stop = n == *from || trail.contains(&n) || trail.len() > pack.moved.len();
            trail.push(n);
            if stop {
                break;
            }
        }
        let shown = trail.join(" → ");
        if trail.contains(from) {
            let what = format!("`moved` entry `{from}` loops back to its source: {from} → {shown}; a move ends at a kind that exists");
            issues.push(refused("cycle", from, &written, "loop", what));
        } else if trail.len() > 1 {
            let what = format!("`moved` entry `{from}` moves it to `{to}`, which is itself moved: {from} → {shown}; a move is one step to a kind that exists");
            issues.push(refused(
                "out_of_range",
                from,
                &written,
                "target_moved",
                what,
            ));
        } else if !split(to)
            .and_then(|(p, _, _)| holder(p))
            .is_some_and(|p| holds(p, to))
        {
            let what = format!("`moved` entry `{from}` moves it to `{to}`, which no version this pack names holds; a move ends at a kind that exists");
            issues.push(refused("ref_unresolved", from, &written, "missing", what));
        }
    }
    issues
}

/// The kinds `pack` drops from the version before it that `packs` admitted: each kind of that
/// version that this one holds at no major from its own up, moves to no kind and doesn't list
/// under `removed` is refused, naming the kind, so no kind disappears silently.
fn dropped(packs: &Packs, pack: &Pack) -> Vec<Issue> {
    let before = packs
        .all()
        .filter(|p| p.id.id == pack.id.id && p.id.version < pack.id.version)
        .max_by_key(|p| p.id.version);
    let Some(before) = before else {
        return Vec::new();
    };
    let mut issues = Vec::new();
    let mut gone: Vec<String> = kinds(before).collect();
    gone.sort();
    gone.dedup();
    for kind in gone {
        let Some((_, full, major)) = split(&kind) else {
            continue;
        };
        let kept = kinds(pack).any(|k| split(&k).is_some_and(|(_, f, m)| f == full && m >= major));
        if kept || pack.moved.contains_key(&kind) || pack.removed.contains_key(&kind) {
            continue;
        }
        let (now, was) = (pack.id.text(), before.id.text());
        let what = format!("pack `{now}` drops the kind `{kind}` that `{was}` has, with no `moved` entry, no later major and no `removed` entry: a kind never disappears silently");
        let at = format!("removed/{kind}");
        let mut issue = Issue::envelope(
            "unintended_removal",
            at,
            json!({"kind": kind, "before": was}),
            &what,
        );
        issue.fix = format!("List `{kind}` under `removed` with a reason, or under `moved` with the kind it became.");
        issues.push(issue);
    }
    issues
}
