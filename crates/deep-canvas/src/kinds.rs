//! The kind registry (canvas primitives: Item and kind): each kind's versions, one per major, with
//! its param schema, and the migrations between majors as data, one major a step.
//!
//! This slice registers one kind, `test.slab`, at major 3 minor 1 with its two earlier majors,
//! exactly as the #389 acceptance README's table says. A kind's text in a document is
//! `family.name@major`; `requires.kinds` names `family.name@major.minor`.

use crate::grammar::Id;
use serde_json::{json, Value};

/// A param's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParamType {
    /// An `f32` number in the param's unit, or a unit literal converted into it.
    F32,
    /// A string.
    Str,
}

/// One param of a kind's schema.
#[derive(Clone, Debug)]
pub struct Param {
    pub name: &'static str,
    pub ty: ParamType,
    /// The field's declared unit (`m`, `u`, `deg`); empty for a string.
    pub unit: &'static str,
    pub default: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// The minor this param was added in.
    pub minor: u32,
}

/// One major of a kind: its minor and its params.
#[derive(Clone, Debug)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub params: Vec<Param>,
}

impl Version {
    /// The param named `name`, if this version defines it.
    pub fn param(&self, name: &str) -> Option<&Param> {
        self.params.iter().find(|p| p.name == name)
    }
}

/// One rename step of a migration.
#[derive(Clone, Debug)]
pub struct Rename {
    pub from: &'static str,
    pub to: &'static str,
}

/// The migration from one major to the next, as data.
#[derive(Clone, Debug)]
pub struct Migration {
    pub from: u32,
    pub to: u32,
    pub renames: Vec<Rename>,
}

/// A registry entry: a kind with every major this build knows.
#[derive(Clone, Debug)]
pub struct Entry {
    pub family: &'static str,
    pub name: &'static str,
    /// One per major, ascending; the last is the build's.
    pub versions: Vec<Version>,
    pub migrations: Vec<Migration>,
}

impl Entry {
    /// `family.name`.
    pub fn full_name(&self) -> String {
        format!("{}.{}", self.family, self.name)
    }

    /// The build's version of the kind (its highest major).
    pub fn current(&self) -> &Version {
        // An entry always has at least one version: the registry below builds it so.
        self.versions.last().unwrap_or(&self.versions[0])
    }

    /// The version at `major`, if this build knows it.
    pub fn version(&self, major: u32) -> Option<&Version> {
        self.versions.iter().find(|v| v.major == major)
    }

    /// The migration steps from `from` up to the build's major, one major each, or `None`
    /// when a step is missing.
    pub fn steps_from(&self, from: u32) -> Option<Vec<&Migration>> {
        let mut steps = Vec::new();
        let mut at = from;
        while at < self.current().major {
            let step = self
                .migrations
                .iter()
                .find(|m| m.from == at && m.to == at + 1)?;
            steps.push(step);
            at += 1;
        }
        Some(steps)
    }
}

/// Every kind this build registers.
#[derive(Debug)]
pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    /// The entry named `family.name`, if any.
    pub fn entry(&self, full_name: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.full_name() == full_name)
    }
}

fn f32_param(
    name: &'static str,
    unit: &'static str,
    default: f64,
    min: f64,
    max: f64,
    minor: u32,
) -> Param {
    Param {
        name,
        ty: ParamType::F32,
        unit,
        default: json!(default),
        min: Some(min),
        max: Some(max),
        minor,
    }
}

fn str_param(name: &'static str, default: &str) -> Param {
    Param {
        name,
        ty: ParamType::Str,
        unit: "",
        default: json!(default),
        min: None,
        max: None,
        minor: 0,
    }
}

fn build() -> Registry {
    let slab = Entry {
        family: "test",
        name: "slab",
        versions: vec![
            Version {
                major: 1,
                minor: 0,
                params: vec![
                    f32_param("w", "m", 10.0, 0.0, 1000.0, 0),
                    f32_param("h", "m", 10.0, 0.0, 1000.0, 0),
                    str_param("label", ""),
                ],
            },
            Version {
                major: 2,
                minor: 0,
                params: vec![
                    f32_param("width", "m", 10.0, 0.0, 1000.0, 0),
                    f32_param("h", "m", 10.0, 0.0, 1000.0, 0),
                    str_param("label", ""),
                ],
            },
            Version {
                major: 3,
                minor: 1,
                params: vec![
                    f32_param("width", "m", 10.0, 0.0, 1000.0, 0),
                    f32_param("height", "m", 10.0, 0.0, 1000.0, 0),
                    str_param("label", ""),
                    f32_param("corner", "m", 0.0, 0.0, 100.0, 1),
                ],
            },
        ],
        migrations: vec![
            Migration {
                from: 1,
                to: 2,
                renames: vec![Rename {
                    from: "w",
                    to: "width",
                }],
            },
            Migration {
                from: 2,
                to: 3,
                renames: vec![Rename {
                    from: "h",
                    to: "height",
                }],
            },
        ],
    };
    Registry {
        entries: vec![slab],
    }
}

/// The build's registry, built on each call: a static would be an address a check could carry
/// state between runs through, and the lint refuses every one.
pub fn registry() -> Registry {
    build()
}

/// A whole number with no leading zero, as a version part is written.
fn parse_part(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0'))
    {
        return None;
    }
    s.parse().ok()
}

/// `family.name`: an ID of two or more segments (canvas primitives: Item and kind), so every
/// build writes the same grammar and text outside it is no build's kind.
fn kind_name(name: &str) -> Option<String> {
    (name.contains('.') && Id::parse(name).is_ok()).then(|| name.to_string())
}

/// `family.name@major` → (`family.name`, major).
pub fn parse_kind(text: &str) -> Option<(String, u32)> {
    let (name, major) = text.split_once('@')?;
    Some((kind_name(name)?, parse_part(major)?))
}

/// `family.name@major.minor` → (`family.name`, major, minor), as `requires.kinds` names a kind.
pub fn parse_required(text: &str) -> Option<(String, u32, u32)> {
    let (name, version) = text.split_once('@')?;
    let (major, minor) = version.split_once('.')?;
    Some((kind_name(name)?, parse_part(major)?, parse_part(minor)?))
}

/// What the registry says about a document's kind text.
#[derive(Clone, Copy, Debug)]
pub enum Lookup<'a> {
    /// A kind this build knows at `saved` (the build's major or an earlier one).
    Known { entry: &'a Entry, saved: u32 },
    /// No kind of that family and name at a major this build carries: another build's.
    UnknownKind,
    /// Text that is not `family.name@major` at all: not a kind of any build.
    Malformed,
    /// A known kind at a major above the build's.
    TooNew { entry: &'a Entry, saved: u32 },
}

/// Looks a kind text up in `registry`. An unknown kind is kept byte for byte, as another
/// build's kind; text outside the grammar is malformed, since every build writes the grammar.
pub fn lookup<'a>(registry: &'a Registry, text: &str) -> Lookup<'a> {
    let Some((name, saved)) = parse_kind(text) else {
        return Lookup::Malformed;
    };
    let Some(entry) = registry.entry(&name) else {
        return Lookup::UnknownKind;
    };
    if saved > entry.current().major {
        Lookup::TooNew { entry, saved }
    } else if entry.version(saved).is_some() {
        Lookup::Known { entry, saved }
    } else {
        // A major below the earliest this build carries: nothing migrates it.
        Lookup::UnknownKind
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_slab_is_registered_at_three_one_with_two_migration_steps() {
        let registry = registry();
        let Lookup::Known { entry, saved } = lookup(&registry, "test.slab@1") else {
            panic!("test.slab@1 is known");
        };
        assert_eq!(saved, 1);
        assert_eq!(entry.current().major, 3);
        assert_eq!(entry.current().minor, 1);
        let steps = entry.steps_from(1).unwrap();
        assert_eq!(
            steps.iter().map(|s| (s.from, s.to)).collect::<Vec<_>>(),
            vec![(1, 2), (2, 3)]
        );
        assert_eq!(entry.current().param("corner").unwrap().minor, 1);
        assert!(matches!(
            lookup(&registry, "test.slab@4"),
            Lookup::TooNew { .. }
        ));
        assert!(matches!(
            lookup(&registry, "test.cube@1"),
            Lookup::UnknownKind
        ));
        assert!(matches!(lookup(&registry, "slab"), Lookup::Malformed));
        assert!(matches!(
            lookup(&registry, "test.slab@01"),
            Lookup::Malformed
        ));
    }

    #[test]
    fn required_kinds_parse_with_a_minor() {
        assert_eq!(
            parse_required("test.slab@3.2"),
            Some(("test.slab".to_string(), 3, 2))
        );
        assert_eq!(parse_required("test.slab@3"), None);
        assert_eq!(
            parse_kind("test.slab@3"),
            Some(("test.slab".to_string(), 3))
        );
    }
}
