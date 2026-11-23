//! Field lists (#2777; canvas primitives: Registries and closed lists, Registry and seal:
//! registries): every list of words a sealed kind's field offers carries a closure: a registry,
//! closed with its reason, what would reopen it and what a document can do instead, or open. The
//! core's fill is `fields.json` beside this file, one line a list; a canvas module may
//! declare the closure of its own kind's list beside the kind. The seal refuses a list with
//! neither, naming the kind and the field.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::kinds::{ParamType, Registry};

/// The reasons a list is closed for (Registry and seal: registries).
pub const REASONS: &[&str] = &[
    "ring",
    "record",
    "determinism",
    "card",
    "budget",
    "interval_forms",
    "draw_path",
];

/// `instead` when nothing a document can write stands in for a value the list lacks.
pub const NOTHING: &str = "nothing";

/// A list's closure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Closure {
    /// `name@major`: the registry whose entries are the list's words.
    Registry(String),
    Closed {
        reason: String,
        reopens_if: String,
        /// What a document can do in the list's place, or [`NOTHING`].
        instead: String,
    },
    /// Declared per `item` or per `pack`.
    Open(String),
}

impl Closure {
    pub fn closed(reason: &str, reopens_if: &str, instead: &str) -> Closure {
        Closure::Closed {
            reason: reason.into(),
            reopens_if: reopens_if.into(),
            instead: instead.into(),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Closure::Registry(r) => json!({"registry": r}),
            Closure::Closed {
                reason,
                reopens_if,
                instead,
            } => json!({"closed": reason, "reopens_if": reopens_if, "instead": instead}),
            Closure::Open(by) => json!({"open": by}),
        }
    }

    /// A closure from its JSON, or why it breaks the rule.
    pub fn from_json(v: &Value) -> Result<Closure, String> {
        let text = |key: &str| v.get(key).and_then(Value::as_str).map(str::trim);
        if let Some(r) = text("registry") {
            let well_named = r
                .split_once('@')
                .is_some_and(|(n, m)| !n.is_empty() && m.parse::<u32>().is_ok_and(|m| m > 0));
            return match well_named {
                true => Ok(Closure::Registry(r.into())),
                false => Err(format!(
                    "a registry closure names the registry as name@major, not `{r}`"
                )),
            };
        }
        if let Some(by) = text("open") {
            return match by {
                "item" | "pack" => Ok(Closure::Open(by.into())),
                _ => Err(format!(
                    "an open list is declared per item or per pack, not `{by}`"
                )),
            };
        }
        let Some(reason) = text("closed") else {
            return Err("a closure is {registry}, {closed, reopens_if, instead} or {open}".into());
        };
        if !REASONS.contains(&reason) {
            return Err(format!(
                "closed for `{reason}`, which is not one of {}",
                REASONS.join(", ")
            ));
        }
        let reopens_if = text("reopens_if").filter(|s| !s.is_empty());
        let instead = text("instead").filter(|s| !s.is_empty());
        match (reopens_if, instead) {
            (Some(r), Some(i)) => Ok(Closure::closed(reason, r, i)),
            (None, _) => Err("a closed list says what would reopen it (reopens_if)".into()),
            (_, None) => Err(format!(
                "a closed list says what a document can do in its place, or `{NOTHING}` (instead)"
            )),
        }
    }
}

/// One field list of the sealed listing.
#[derive(Clone, Debug, PartialEq)]
pub struct FieldList {
    /// `<kind>@<major>.<field>[.<object field, tag or slot>…]`, or a list a module declares
    /// outside its kinds' params under the name it gives.
    pub list: String,
    /// The kind, `name@major`, or what the module names as the list's owner.
    pub entry: String,
    pub field: String,
    pub words: Vec<String>,
    pub closure: Closure,
}

impl FieldList {
    pub fn to_json(&self) -> Value {
        json!({"list": self.list, "entry": self.entry, "field": self.field,
               "words": self.words, "closure": self.closure.to_json()})
    }
}

/// A list of words a document sets outside a kind's params, which a module reads and declares
/// with the words its reader takes (#2777): an emitter's distance models, a film's foley
/// materials.
#[derive(Clone, Debug, PartialEq)]
pub struct Declared {
    pub list: String,
    pub entry: String,
    pub field: String,
    pub words: Vec<String>,
}

/// The core's fill, by list name: `fields.json`, read once a seal.
pub fn fill() -> BTreeMap<String, Result<Closure, String>> {
    let rows: Vec<Value> = serde_json::from_str(include_str!("fields.json")).unwrap_or_default();
    rows.iter()
        .filter_map(|row| {
            Some((
                row.get("list")?.as_str()?.to_string(),
                Closure::from_json(row),
            ))
        })
        .collect()
}

/// A list the seal refuses: no closure, or one that breaks the rule.
#[derive(Clone, Debug, PartialEq)]
pub struct Unclosed {
    pub list: String,
    pub entry: String,
    pub field: String,
    pub words: Vec<String>,
    /// Why its closure breaks the rule; `None` when it has none.
    pub why: Option<String>,
}

/// Every field list of the kinds' forms and of `declared`, sorted by name, each with its closure:
/// the one its kind's module declares (`closes`, `(list, closure)`), else the core's fill. The
/// first list with neither, or whose closure breaks the rule, is refused.
pub fn seal(
    kinds: &Registry,
    closes: &[(String, Closure)],
    declared: &[Declared],
) -> Result<Vec<FieldList>, Unclosed> {
    let mut found: Vec<Declared> = Vec::new();
    for entry in kinds.entries() {
        for version in &entry.versions {
            let name = format!("{}@{}", entry.full_name(), version.major);
            for p in &version.params {
                let ParamType::Json(declared_form) = p.ty else {
                    continue;
                };
                // A declaration the form language can't read offers no list here; the kit
                // refuses it (#1973).
                let Ok(form) = crate::form::parse(declared_form) else {
                    continue;
                };
                for l in form.word_lists() {
                    let list = match l.path.is_empty() {
                        true => format!("{name}.{}", p.name),
                        false => format!("{name}.{}.{}", p.name, l.path),
                    };
                    found.push(Declared {
                        list,
                        entry: name.clone(),
                        field: p.name.to_string(),
                        words: l.words,
                    });
                }
            }
        }
    }
    found.extend(declared.iter().cloned());
    let fill = fill();
    let mut out = Vec::new();
    for d in found {
        let closure = closes
            .iter()
            .find(|(n, _)| *n == d.list)
            .map(|(_, c)| Ok(c.clone()))
            .or_else(|| fill.get(&d.list).cloned());
        let closure = match closure {
            Some(Ok(c)) => c,
            other => {
                return Err(Unclosed {
                    list: d.list,
                    entry: d.entry,
                    field: d.field,
                    words: d.words,
                    why: other.map(|r| r.err().unwrap_or_default()),
                })
            }
        };
        out.push(FieldList {
            list: d.list,
            entry: d.entry,
            field: d.field,
            words: d.words,
            closure,
        });
    }
    out.sort_by(|a, b| a.list.cmp(&b.list));
    Ok(out)
}

/// Every field list of the sealed kinds and of the lists the sealed modules declare, with its
/// closure (#2777): the one the kind's module declares, else the core's fill. A list with
/// neither, a closure that breaks the rule, or a registry closure naming no sealed registry is
/// refused, naming the entry and the field.
pub(super) fn sealed(
    kinds: &crate::kinds::Registry,
    modules: &[super::SealedModule],
    registries: &[super::lists::SealedRegistry],
    host: &[Declared],
) -> Result<Vec<FieldList>, Box<super::SealError>> {
    let closes: Vec<(String, Closure)> = modules
        .iter()
        .flat_map(|m| &m.shapes.kinds)
        .flat_map(|k| {
            k.entry.versions.iter().flat_map(move |v| {
                k.closes.iter().map(move |(path, c)| {
                    (
                        format!("{}@{}.{path}", k.entry.full_name(), v.major),
                        c.clone(),
                    )
                })
            })
        })
        .collect();
    // The host's lists, and the modules' own.
    let declared: Vec<Declared> = (host.iter().cloned())
        .chain(
            modules
                .iter()
                .flat_map(|m| m.shapes.word_lists.iter().cloned()),
        )
        .collect();
    let owner = |u: &Unclosed| {
        let full = u
            .entry
            .rsplit_once('@')
            .map_or(u.entry.as_str(), |(n, _)| n);
        modules
            .iter()
            .find(|m| {
                m.shapes.kinds.iter().any(|k| k.entry.is(full))
                    || m.shapes.word_lists.iter().any(|d| d.list == u.list)
            })
            .map_or(super::CORE, |m| m.name.as_str())
            .to_string()
    };
    let refuse = |u: Unclosed| {
        let words = u.words.join(", ");
        let what = match &u.why {
            None => format!(
                "`{}` field `{}` offers the words {words} with no closure: give the list `{}` a registry, a closed reason with reopens_if and instead, or open",
                u.entry, u.field, u.list
            ),
            Some(why) => format!(
                "`{}` field `{}`: the closure of the list `{}` ({words}) breaks the rule: {why}",
                u.entry, u.field, u.list
            ),
        };
        let mut e = super::SealError::of("list_unclosed", &owner(&u), what).at(
            "kind@1",
            vec![json!(u.entry)],
            &[],
        );
        if let Some(r) = e.registry.as_mut() {
            r.report.insert("field".into(), json!(u.field));
            r.report.insert("list".into(), json!(u.list));
        }
        e
    };
    let lists = seal(kinds, &closes, &declared).map_err(refuse)?;
    for l in &lists {
        if let Closure::Registry(r) = &l.closure {
            if !registries.iter().any(|s| s.def.name == *r) {
                return Err(refuse(Unclosed {
                    list: l.list.clone(),
                    entry: l.entry.clone(),
                    field: l.field.clone(),
                    words: l.words.clone(),
                    why: Some(format!(
                        "it names the registry {r}, which this build doesn't seal"
                    )),
                }));
            }
        }
    }
    Ok(lists)
}

impl super::Sealed {
    /// The field list named `name`, if this build seals one.
    pub fn field_list(&self, name: &str) -> Option<&FieldList> {
        let i = self
            .lists
            .binary_search_by(|l| l.list.as_str().cmp(name))
            .ok()?;
        Some(&self.lists[i])
    }
}

/// On a structured value refused for a word its list lacks (#2777): the issue names the list,
/// what would reopen it and what a document can do instead, as fields and in its fix. `field`
/// is `<kind>@<major>.<field>`. Planted (`Fault::RefusalBadValueOnly`), it names nothing more.
pub(crate) fn name_list(
    issue: &mut crate::document::Issue,
    sealed: &super::Sealed,
    field: &str,
    form: &crate::form::Form,
    value: &Value,
) {
    if sealed.close_fault == Some(super::Fault::RefusalBadValueOnly) {
        return;
    }
    let Some(path) = form.missed_list(value) else {
        return;
    };
    let name = match path.is_empty() {
        true => field.to_string(),
        false => format!("{field}.{path}"),
    };
    let Some(l) = sealed.field_list(&name) else {
        return;
    };
    let mut named = json!({"list": l.list});
    let said = match &l.closure {
        Closure::Closed {
            reason,
            reopens_if,
            instead,
        } => {
            named["reopens_if"] = json!(reopens_if);
            named["instead"] = json!(instead);
            let instead = match instead.as_str() {
                NOTHING => "nothing stands in for a word it lacks".to_string(),
                text => format!("instead: {text}"),
            };
            format!(
                "The list {} ({}) is closed for {reason}; it reopens if {reopens_if}; {instead}.",
                l.list,
                l.words.join(", ")
            )
        }
        Closure::Registry(r) => format!("The list {} takes the entries of {r}.", l.list),
        Closure::Open(by) => format!("The list {} is open, declared per {by}.", l.list),
    };
    issue.fix = format!("{} {said}", issue.fix);
    issue.list = Some(named);
}
