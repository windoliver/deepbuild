//! Pack dependencies (canvas primitives: Pack: dependencies; issue #1957). A pack names the packs
//! its recipes and kinds use in `requires.packs`, each `name@version` by exact version, and a step
//! that names a kind or a recipe of a pack outside that list is refused at the pack check, naming
//! the pack. The pack graph joins the composition graph: a version whose requirements lead back to
//! it is refused, naming the cycle; and a document that names a pack resolves the packs it requires
//! as if it listed them, so two versions of one pack in its packs are refused, naming both.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{exact_version, well_named, Pack, PackId, Packs, Resolved};
use crate::document::{member, Issue};
use crate::registry::{Range, Sealed, Semver};

/// One entry of `requires.packs`: a pack's name half and its exact version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dep {
    pub name: String,
    pub version: Semver,
}

impl Dep {
    /// `name@version`.
    pub fn text(&self) -> String {
        format!("{}@{}", self.name, self.version)
    }
}

/// `name@version` of an admitted version, as `requires.packs` names it.
fn short(id: &PackId) -> String {
    format!("{}@{}", id.name, id.version)
}

/// Reads `requires.packs`: a list of `name@version`, each version whole and exact (no range), no
/// name twice and never the pack's own.
pub(super) fn read(value: &Value, own: &PackId, issues: &mut Vec<Issue>) -> Vec<Dep> {
    let bad = |path: String, actual: Value, what: &str| {
        Issue::envelope("out_of_range", path, actual, what)
    };
    let Some(list) = value.as_array() else {
        issues.push(bad(
            "requires/packs".into(),
            value.clone(),
            "not a list of `name@version`",
        ));
        return Vec::new();
    };
    let mut out: Vec<Dep> = Vec::new();
    for (i, entry) in list.iter().enumerate() {
        let path = format!("requires/packs/{i}");
        let parsed = entry
            .as_str()
            .and_then(|t| t.rsplit_once('@'))
            .and_then(|(name, v)| {
                Some(Dep {
                    name: well_named(name).then(|| name.to_string())?,
                    version: exact_version(v)?,
                })
            });
        let Some(dep) = parsed else {
            let what = "not `name@version` with the version written whole: a pack requires each pack at an exact version, never a range";
            issues.push(bad(path, entry.clone(), what));
            continue;
        };
        if dep.name == own.name {
            let what = format!(
                "pack `{}` requires itself, as `{}`: a cycle",
                short(own),
                dep.text()
            );
            issues.push(cycle_issue(path, vec![short(own), dep.text()], &what));
        } else if let Some(first) = out.iter().find(|d| d.name == dep.name) {
            let both = json!([first.text(), dep.text()]);
            let what = format!("`requires.packs` names `{}` twice: `{}` and `{}`; a pack requires one version of a pack", dep.name, first.text(), dep.text());
            issues.push(bad(path, both, &what));
        } else {
            out.push(dep);
        }
    }
    out
}

/// A pack graph's cycle, refused at `path`, naming each version on it in order.
fn cycle_issue(path: String, cycle: Vec<String>, what: &str) -> Issue {
    let mut issue = Issue::envelope("cycle", path, json!({"cycle": cycle}), what);
    issue.fix = "Take one of these packs out of the other's `requires.packs`, so no pack requires itself through others.".into();
    issue
}

/// Each recipe step of the manifest's recipes that nests a recipe or a kind of another pack, which
/// `requires.packs` doesn't list: refused at `recipes/<key>/steps/<step>/kind`, naming that pack.
/// A recipe step's kind is always a pack's, its recipe or its kind; an item step makes a kind a
/// canvas module registers, which may be of a module this build lacks, so it names no pack.
pub(super) fn undeclared(manifest: &Value, own: &PackId, deps: &[Dep], issues: &mut Vec<Issue>) {
    let recipes = member(manifest, "recipes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    for (key, recipe) in recipes {
        let steps = member(recipe, "steps")
            .and_then(Value::as_object)
            .into_iter()
            .flatten();
        for (step, s) in steps {
            let op = member(s, "op").and_then(Value::as_str).unwrap_or_default();
            let kind = member(s, "kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some((family, _)) = kind.split_once('.') else {
                continue;
            };
            if op != "recipe" || family == own.name {
                continue;
            }
            if deps.iter().any(|d| d.name == family) {
                continue;
            }
            let mut issue = Issue::envelope(
                "ref_unresolved",
                format!("recipes/{key}/steps/{step}/kind"),
                json!({"kind": kind, "pack": family}),
                &format!("step `{step}` names `{kind}` of the pack `{family}`, which pack `{}`'s `requires.packs` doesn't list", short(own)),
            );
            issue.fix = format!("List `{family}@<version>` in `requires.packs`, at an exact version, or name a kind of a pack it lists.");
            issues.push(issue);
        }
    }
}

/// The admitted version `name@version` names, whoever owns it: the first by ID.
fn find<'a>(packs: &'a Packs, dep: &Dep) -> Option<&'a Pack> {
    packs
        .by_id
        .values()
        .find(|p| p.id.name == dep.name && p.id.version == dep.version)
}

/// Refuses `pack` when its requirements lead back to it through the versions `packs` admitted,
/// naming the cycle: each version on it, from `pack` back to `pack`.
pub(super) fn cycle(packs: &Packs, pack: &Pack) -> Result<(), Vec<Issue>> {
    fn walk(
        packs: &Packs,
        from: &Pack,
        own: &PackId,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        for dep in &from.requires_packs {
            if dep.name == own.name && dep.version == own.version {
                return Some([path.as_slice(), &[dep.text()]].concat());
            }
            if path.contains(&dep.text()) {
                continue;
            }
            let Some(next) = find(packs, dep) else {
                continue;
            };
            path.push(dep.text());
            if let Some(found) = walk(packs, next, own, path) {
                return Some(found);
            }
            path.pop();
        }
        None
    }
    let Some(found) = walk(packs, pack, &pack.id, &mut vec![short(&pack.id)]) else {
        return Ok(());
    };
    let what = format!(
        "the pack graph has a cycle: {}; a pack never requires itself through others",
        found.join(" → ")
    );
    Err(vec![cycle_issue("requires/packs".into(), found, &what)])
}

/// The store a pack's kind kit checks its documents in: the pack and every version it requires,
/// through other packs, as the versions `packs` admitted.
pub(super) fn store(packs: &Packs, pack: &Pack) -> Packs {
    let mut out = Packs::new(packs.planted);
    let mut next: Vec<&Dep> = pack.requires_packs.iter().collect();
    while let Some(dep) = next.pop() {
        if let Some(p) = find(packs, dep).filter(|p| out.get(&p.id.text()).is_none()) {
            next.extend(&p.requires_packs);
            out.insert(p.clone());
        }
    }
    out.insert(pack.clone());
    out
}

/// A resolved pack's modules against the build: one this build lacks is `module_missing`, one
/// at another version `out_of_range`, each at `<path>/requires/modules/<module>`.
pub(super) fn modules(
    pack: &Pack,
    text: &str,
    path: &str,
    sealed: Option<&Sealed>,
    issues: &mut Vec<Issue>,
) {
    let Some(sealed) = sealed else { return };
    for (module, range) in &pack.requires_modules {
        let Some(parsed) = Range::parse(range) else {
            continue;
        };
        let at = format!("{path}/requires/modules/{module}");
        if sealed.module(module).is_none() {
            let what =
                format!("pack `{text}` requires the {module} module, which this build lacks");
            issues.push(Issue::envelope("module_missing", at, json!(range), &what));
        } else if !sealed.satisfies(module, &parsed) {
            let what = format!(
                "pack `{text}` requires the {module} module at {range}; this build has another"
            );
            issues.push(Issue::envelope("out_of_range", at, json!(range), &what));
        }
    }
}

/// Resolves what the document's listed packs require, as if it listed them (Pack: dependencies):
/// each required version joins `out`, a version the build lacks is `pack_missing`, and a second
/// version of a pack the document already has, listed or required, is refused, naming both.
/// `listed` holds each listed pack's `packs/<i>` path by name.
pub(super) fn close<'a>(
    out: &mut Resolved<'a>,
    listed: &BTreeMap<String, String>,
    doc: &Value,
    packs: &'a Packs,
    sealed: Option<&Sealed>,
    issues: &mut Vec<Issue>,
) {
    let mut next: Vec<(&'a Pack, String)> = out
        .by_name
        .values()
        .map(|p| (*p, listed.get(&p.id.name).cloned().unwrap_or_default()))
        .collect();
    while let Some((pack, at)) = next.pop() {
        for (j, dep) in pack.requires_packs.iter().enumerate() {
            let path = format!("{at}/requires/packs/{j}");
            if let Some(have) = out.by_name.get(&dep.name) {
                if have.id.version != dep.version {
                    let both = [short(&have.id), dep.text()];
                    let what = format!("two versions of `{}` in one document's packs: `{}`, and `{}` that `{}` requires; a document loads one version of a pack", dep.name, both[0], both[1], short(&pack.id));
                    issues.push(Issue::envelope("out_of_range", path, json!(both), &what));
                }
                continue;
            }
            let Some(found) = find(packs, dep) else {
                let what = format!("pack `{}` at version {}, which `{}` requires, is not in this build; the document is refused whole, and never drawn with another version", dep.name, dep.version, short(&pack.id));
                let mut issue = Issue::envelope(
                    "pack_missing",
                    path,
                    json!({"pack": dep.name, "version": dep.version.to_string(), "required_by": short(&pack.id)}),
                    &what,
                );
                issue.ids = instances(doc, &dep.name);
                issues.push(issue);
                continue;
            };
            modules(found, &found.id.text(), &path, sealed, issues);
            out.by_name.insert(dep.name.clone(), found);
            next.push((found, path));
        }
    }
}

/// The document's items whose kind is of the pack `name`: the instances that need it.
pub(super) fn instances(doc: &Value, name: &str) -> Vec<String> {
    member(doc, "items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, item)| {
            super::super::kind_text(item)
                .and_then(|k| k.split_once('.'))
                .is_some_and(|(f, _)| f == name)
        })
        .map(|(id, _)| id.clone())
        .collect()
}
