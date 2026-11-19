//! What each path does with an entry that draws in 3D (issue #2776; canvas primitives: Paths,
//! Registry and seal: registries; technical design: Rules every primitive follows). Three paths
//! draw a 3D document besides the real-time frame: real-time rays, a path-traced final and the
//! web player. Every kind a canvas module seals that draws in 3D answers each of them with one of
//! four words, and a field that turns a behavior on may carry answers of its own:
//!
//! - `same`: the path draws what the real-time frame draws, held by the check or fixture it names;
//! - `stand_in`: it draws something else, says what, and its receipt lists the item;
//! - `refused`: a document that asks for the path and uses the entry is refused at check with the
//!   answer's code, before anything renders; `path_undefined` where the design is silent, naming
//!   the open task that decides the cell where there is one;
//! - `not_applicable`: with why.
//!
//! A kind draws in 3D when its module marks it so (scene3d's and building's kinds) or draws it as
//! marks in 3D through the core's fills (`Registrar::marks3d`). The seal refuses one with no
//! answer for a path, naming the kind and the path. The answers stay out of every digest, as a
//! kind's description does: a task that decides a cell changes an answer, never a kind.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::{Registrar, RegistryRefusal, SealError};

/// The paths, in the order every listing gives them.
pub const PATHS: [&str; 3] = ["rays", "final", "web"];

/// The four answers, in the order the lane counts them.
pub const ANSWERS: [&str; 4] = ["same", "stand_in", "refused", "not_applicable"];

/// The code of a refusal where the design is silent, until a task decides the cell.
pub const UNDEFINED: &str = "path_undefined";

/// The seal's reason for a 3D entry, or a field that carries answers, with no answer for a path.
pub const UNANSWERED: &str = "path_unanswered";

/// The seal's reason for paths data it can't admit: unreadable, for a kind or field the module
/// doesn't draw in 3D, or a `same` held by nothing the sealed set holds.
pub const INVALID: &str = "paths_invalid";

/// What one path does with an entry or one of its fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    /// Drawn as the real-time frame draws it, held by the check or fixture named.
    Same {
        held_by: String,
    },
    /// Drawn as something else, which `draws` says; the receipt lists the item with `receipt`.
    StandIn {
        draws: String,
        receipt: String,
    },
    /// Refused at check with `code`; `task` is the open task that decides a `path_undefined`
    /// cell, where its row names one.
    Refused {
        code: String,
        task: Option<String>,
    },
    NotApplicable {
        why: String,
    },
}

impl Answer {
    /// Its word.
    pub fn word(&self) -> &'static str {
        match self {
            Answer::Same { .. } => "same",
            Answer::StandIn { .. } => "stand_in",
            Answer::Refused { .. } => "refused",
            Answer::NotApplicable { .. } => "not_applicable",
        }
    }

    /// Reads one answer: `{"answer": <word>, …its fields}`.
    pub fn parse(v: &Value) -> Result<Answer, String> {
        let text = |k: &str| -> Result<String, String> {
            match v.get(k).and_then(Value::as_str) {
                Some(s) if !s.trim().is_empty() => Ok(s.to_string()),
                _ => Err(format!("an answer {} names its {k}", v["answer"])),
            }
        };
        let answer = match v.get("answer").and_then(Value::as_str) {
            Some("same") => Answer::Same {
                held_by: text("held_by")?,
            },
            Some("stand_in") => Answer::StandIn {
                draws: text("draws")?,
                receipt: text("receipt")?,
            },
            Some("refused") => Answer::Refused {
                code: text("code")?,
                task: v.get("task").and_then(Value::as_str).map(str::to_string),
            },
            Some("not_applicable") => Answer::NotApplicable { why: text("why")? },
            other => {
                return Err(format!(
                    "an answer is one of {}, not {other:?}",
                    ANSWERS.join(", ")
                ))
            }
        };
        let known: &[&str] = match &answer {
            Answer::Same { .. } => &["answer", "held_by"],
            Answer::StandIn { .. } => &["answer", "draws", "receipt"],
            Answer::Refused { .. } => &["answer", "code", "task"],
            Answer::NotApplicable { .. } => &["answer", "why"],
        };
        if let Some(k) = v
            .as_object()
            .and_then(|o| o.keys().find(|k| !known.contains(&k.as_str())))
        {
            return Err(format!("a {} answer has no field {k}", answer.word()));
        }
        Ok(answer)
    }

    pub fn to_json(&self) -> Value {
        match self {
            Answer::Same { held_by } => json!({"answer": "same", "held_by": held_by}),
            Answer::StandIn { draws, receipt } => {
                json!({"answer": "stand_in", "draws": draws, "receipt": receipt})
            }
            Answer::Refused { code, task } => {
                let mut v = json!({"answer": "refused", "code": code});
                if let Some(t) = task {
                    v["task"] = json!(t);
                }
                v
            }
            Answer::NotApplicable { why } => json!({"answer": "not_applicable", "why": why}),
        }
    }

    /// The refusal a document that asks for `path` and uses `entry` meets, or none: its code and
    /// a message naming the entry, the path and, for `path_undefined`, the open task.
    pub fn refusal(&self, entry: &str, path: &str) -> Option<(String, String)> {
        let Answer::Refused { code, task } = self else {
            return None;
        };
        let what = match path {
            "rays" => "real-time rays",
            "final" => "a path-traced final",
            _ => "the web player",
        };
        let message = match (code.as_str(), task) {
            (UNDEFINED, Some(t)) => format!(
                "{entry} has no answer for {what} ({path}) yet: path_undefined until {t} decides it"
            ),
            (UNDEFINED, None) => format!(
                "{entry} has no answer for {what} ({path}) yet: path_undefined until a task decides it"
            ),
            _ => format!("{what} ({path}) refuses {entry}: {code}"),
        };
        Some((code.clone(), message))
    }
}

/// The three answers of an entry, or of a field that carries its own, with the reference section
/// whose Paths row says them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Paths {
    pub section: String,
    /// By path; a path with none is absent, which the seal refuses.
    pub answers: BTreeMap<String, Answer>,
}

impl Paths {
    /// Reads `{section, rays, final, web}`, each path an answer.
    pub fn parse(v: &Value) -> Result<Paths, String> {
        let o = v
            .as_object()
            .ok_or("paths are {section, rays, final, web}")?;
        let mut out = Paths::default();
        for (k, answer) in o {
            match k.as_str() {
                "section" => {
                    out.section = answer
                        .as_str()
                        .filter(|s| !s.trim().is_empty())
                        .ok_or("section names the reference section whose Paths row says them")?
                        .to_string()
                }
                p if PATHS.contains(&p) => {
                    out.answers.insert(p.to_string(), Answer::parse(answer)?);
                }
                other => {
                    return Err(format!(
                        "{other} is not a path: the paths are {}",
                        PATHS.join(", ")
                    ))
                }
            }
        }
        if out.section.is_empty() {
            return Err("section names the reference section whose Paths row says them".into());
        }
        Ok(out)
    }

    pub fn get(&self, path: &str) -> Option<&Answer> {
        self.answers.get(path)
    }

    /// The first path with no answer.
    pub fn missing(&self) -> Option<&'static str> {
        PATHS.into_iter().find(|p| !self.answers.contains_key(*p))
    }

    /// `{rays, final, web}`, in path order.
    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        for p in PATHS {
            if let Some(a) = self.answers.get(p) {
                o.insert(p.into(), a.to_json());
            }
        }
        Value::Object(o)
    }
}

/// A kind's answers: its own, and those of the fields that turn a behavior on and carry their own.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KindPaths {
    pub own: Paths,
    pub fields: BTreeMap<String, Paths>,
}

impl KindPaths {
    /// Reads `{section, rays, final, web, fields: {<field>: {section, rays, final, web}}}`.
    pub fn parse(v: &Value) -> Result<KindPaths, String> {
        let mut own = v.clone();
        let fields = match own.as_object_mut().and_then(|o| o.remove("fields")) {
            None => BTreeMap::new(),
            Some(Value::Object(f)) => f
                .iter()
                .map(|(name, p)| {
                    Paths::parse(p)
                        .map(|p| (name.clone(), p))
                        .map_err(|e| format!("field {name}: {e}"))
                })
                .collect::<Result<_, _>>()?,
            Some(_) => return Err("fields are {<field>: {section, rays, final, web}}".into()),
        };
        Ok(KindPaths {
            own: Paths::parse(&own)?,
            fields,
        })
    }

    /// The answers for `path` an item of the kind meets, given its params: those of each field the
    /// item turns on (set, and not `false` or `none`), in place of the kind's own; else the kind's
    /// own. Each with the field it came from, if any.
    pub fn for_item<'a>(
        &'a self,
        path: &str,
        params: &Value,
    ) -> Vec<(Option<&'a str>, &'a Answer)> {
        let on = |f: &str| {
            params
                .get(f)
                .is_some_and(|v| !v.is_null() && *v != json!(false) && *v != json!("none"))
        };
        let fields: Vec<(Option<&str>, &Answer)> = self
            .fields
            .iter()
            .filter(|(f, _)| on(f))
            .filter_map(|(f, p)| p.get(path).map(|a| (Some(f.as_str()), a)))
            .collect();
        if fields.is_empty() {
            self.own.get(path).map(|a| (None, a)).into_iter().collect()
        } else {
            fields
        }
    }
}

impl Registrar {
    /// Marks every kind this module has registered so far as drawing in 3D (scene3d's, building's
    /// and the GPU operators' kinds), with the answers `data` gives by kind (`family.name@major` →
    /// `{section, rays, final, web, fields}`); a kind the data leaves out is refused at the seal.
    pub fn in_3d(&mut self, data: &str) -> &mut Self {
        for k in self.kinds.iter_mut() {
            k.in_3d = true;
        }
        self.paths(data)
    }

    /// The answers `data` gives for the kinds this module draws in 3D, by kind; data that doesn't
    /// read, or names a kind or field the module doesn't draw in 3D, is refused at the seal.
    pub fn paths(&mut self, data: &str) -> &mut Self {
        let parsed: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        match parsed.as_object() {
            Some(o) => {
                for (kind, v) in o {
                    self.paths_data.push((kind.clone(), KindPaths::parse(v)));
                }
            }
            None => self.paths_data.push((
                String::new(),
                Err("paths data is a JSON object by kind".into()),
            )),
        }
        self
    }
}

impl super::Sealed {
    /// The answers of the kind `kind` (`family.name@major` or `family.name`), with the module
    /// that draws it; none for a kind that draws nothing in 3D.
    pub fn paths_of(&self, kind: &str) -> Option<(&str, &KindPaths)> {
        let bare = kind.split('@').next().unwrap_or(kind);
        self.modules.iter().find_map(|m| {
            m.shapes
                .paths
                .iter()
                .find(|(k, _)| k.as_str() == kind || k.split('@').next() == Some(bare))
                .map(|(_, p)| (m.name.as_str(), p))
        })
    }

    /// Every kind that draws in 3D, as `family.name@major`, with its module and answers, sorted
    /// by kind.
    pub fn paths(&self) -> Vec<(&str, &str, &KindPaths)> {
        let mut out: Vec<(&str, &str, &KindPaths)> = self
            .modules
            .iter()
            .flat_map(|m| {
                m.shapes
                    .paths
                    .iter()
                    .map(move |(k, p)| (k.as_str(), m.name.as_str(), p))
            })
            .collect();
        out.sort_by(|a, b| a.0.cmp(b.0));
        out
    }
}

/// A refusal for `reason`, naming the module, the entry (a kind of `kind@1`, or `<kind>.<field>`)
/// and the path, as the seal's refusal line carries them.
fn refusal(
    reason: &'static str,
    module: &str,
    entry: &str,
    path: Option<&str>,
    what: String,
) -> Box<SealError> {
    let mut report = Map::new();
    report.insert("entry".into(), json!(entry));
    if let Some(p) = path {
        report.insert("path".into(), json!(p));
    }
    let mut e = SealError::new(reason, &[module], &[], what);
    e.registry = Some(Box::new(RegistryRefusal {
        name: "kind@1".into(),
        entries: vec![json!(entry)],
        report,
        ..RegistryRefusal::default()
    }));
    e
}

/// The seal's check: every kind a module draws in 3D (marked so, or drawn as marks in 3D through
/// the core's fills) answers each path, so does each field that carries answers, the data reads,
/// and every `same` names a check kind or a fixture (`<module>/<fixture>`) of the set. Leaves
/// each module's admitted answers in its `paths`.
pub(super) fn check(shapes: &mut [(String, Registrar)]) -> Result<(), Box<SealError>> {
    let held: BTreeSet<String> = shapes
        .iter()
        .flat_map(|(m, r)| {
            let checks = r.checks.iter().map(|c| c.kind.clone());
            checks.chain(r.fixtures.iter().map(move |f| format!("{m}/{}", f.name)))
        })
        .chain(super::CORE_CHECK_KINDS.map(String::from))
        .collect();
    let holders = |h: &str| held.contains(h);
    for (module, r) in shapes.iter_mut() {
        // A kind with no version is the kind checks' to refuse, after this.
        fn current(k: &super::Kind) -> Option<(&super::Kind, &crate::kinds::Version)> {
            k.entry.versions.last().map(|v| (k, v))
        }
        let fields_of: BTreeMap<String, BTreeSet<String>> = (r.kinds.iter().filter_map(current))
            .map(|(k, v)| {
                let names = v.params.iter().map(|p| p.name.to_string());
                (
                    format!("{}@{}", k.entry.full_name(), v.major),
                    names.collect(),
                )
            })
            .collect();
        let mut drawn: BTreeSet<String> = (r.kinds.iter().filter(|k| k.in_3d))
            .filter_map(current)
            .map(|(k, v)| format!("{}@{}", k.entry.full_name(), v.major))
            .collect();
        drawn.extend(
            r.fills
                .iter()
                .filter(|(_, f)| matches!(f, crate::contributed::Fill::Marks(_)))
                .map(|(k, _)| k.clone()),
        );
        for (named, parsed) in std::mem::take(&mut r.paths_data) {
            let answers = parsed.map_err(|e| {
                let what = format!("the paths `{module}` gives `{named}` don't read: {e}");
                refusal(INVALID, module, &named, None, what)
            })?;
            if !drawn.contains(&named) {
                let why = if fields_of.contains_key(&named) {
                    "draws nothing in 3D"
                } else {
                    "is a kind it neither registers nor draws"
                };
                let what = format!("`{module}` gives paths for `{named}`, which {why}");
                return Err(refusal(INVALID, module, &named, None, what));
            }
            let has = |f: &String| fields_of.get(&named).is_some_and(|s| s.contains(f));
            if let Some(f) = answers.fields.keys().find(|f| !has(f)) {
                let what = format!(
                    "`{module}` gives paths for `{named}.{f}`, a field `{named}` doesn't have"
                );
                return Err(refusal(
                    INVALID,
                    module,
                    &format!("{named}.{f}"),
                    None,
                    what,
                ));
            }
            r.paths.insert(named, answers);
        }
        for name in &drawn {
            let no_answer = |entry: &str, path: &str| {
                let what = format!(
                    "`{entry}` of `{module}` draws in 3D and gives no answer for {path}: each of rays, final and web is same, stand_in, refused or not_applicable"
                );
                refusal(UNANSWERED, module, entry, Some(path), what)
            };
            let Some(answers) = r.paths.get(name) else {
                return Err(no_answer(name, PATHS[0]));
            };
            let every = std::iter::once((name.clone(), &answers.own)).chain(
                answers
                    .fields
                    .iter()
                    .map(|(f, p)| (format!("{name}.{f}"), p)),
            );
            for (entry, p) in every {
                if let Some(path) = p.missing() {
                    return Err(no_answer(&entry, path));
                }
                for (path, a) in &p.answers {
                    let Answer::Same { held_by } = a else {
                        continue;
                    };
                    if !holders(held_by) {
                        let what = format!(
                            "`{entry}` calls {path} same, held by `{held_by}`, which is no check kind or fixture of the sealed set"
                        );
                        return Err(refusal(INVALID, module, &entry, Some(path), what));
                    }
                }
            }
        }
    }
    Ok(())
}
