//! The kind registry (canvas primitives: Item and kind): each kind's versions, one per major, with
//! its param schema, and the migrations between majors as data, one major a step.
//!
//! This slice registers `test.slab` at major 3 minor 1 with its two earlier majors, exactly as
//! the #389 acceptance README's table says; the core's `camera` (#372, canvas primitives:
//! Camera `camera@1`), whose structured params the camera module reads; and the two flat test
//! kinds the #372 acceptance README draws, `test.rect` and `test.dot`. A kind's text in a
//! document is `family.name@major` (a core kind has no family: `camera@1`); `requires.kinds`
//! names `family.name@major.minor`.

use crate::grammar::Id;
use serde_json::{json, Map, Value};

/// A param's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParamType {
    /// An `f32` number in the param's unit, or a unit literal converted into it.
    F32,
    /// A string.
    Str,
    /// A structured value (a vector, an object, a choice) the kind's own reader checks when it
    /// evaluates the item; the document check reads only its presence.
    Json,
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
    /// The canvas module that evaluates the param through `contributes_to`, or empty for the
    /// kind's own; a document that sets a field of a module this build lacks is refused with
    /// `module_missing` (technical design: Canvas modules).
    pub module: &'static str,
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
    /// `family.name`, or the bare name of a core kind, which has no family.
    pub fn full_name(&self) -> String {
        if self.family.is_empty() {
            self.name.to_string()
        } else {
            format!("{}.{}", self.family, self.name)
        }
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
#[derive(Clone, Debug)]
pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    /// The entry named `family.name`, if any.
    pub fn entry(&self, full_name: &str) -> Option<&Entry> {
        // `family.name` compared in place: lookups run per item, so nothing is allocated.
        let named = |e: &&Entry| {
            if e.family.is_empty() {
                return e.name == full_name;
            }
            full_name
                .strip_prefix(e.family)
                .and_then(|rest| rest.strip_prefix('.'))
                == Some(e.name)
        };
        self.entries.iter().find(named)
    }

    /// This registry as an earlier build had it: each `family.name@major.minor` in `pins` at
    /// that minor, with only the params its minor has. `None` when a pin names a kind or a major
    /// this build lacks, or a minor above the build's.
    pub fn pinned(&self, pins: &[String]) -> Option<Registry> {
        let mut out = self.clone();
        for pin in pins {
            let (name, major, minor) = parse_required(pin)?;
            let entry = out.entries.iter_mut().find(|e| e.full_name() == name)?;
            let version = entry.versions.iter_mut().find(|v| v.major == major)?;
            if minor > version.minor {
                return None;
            }
            version.minor = minor;
            version.params.retain(|p| p.minor <= minor);
        }
        Some(out)
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
        module: "",
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
        module: "",
    }
}

fn json_param(name: &'static str, default: Value) -> Param {
    Param {
        name,
        ty: ParamType::Json,
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
    }
}

/// A field another canvas module evaluates into the kind's array (Array and table).
fn module_param(name: &'static str, module: &'static str, default: Value) -> Param {
    Param {
        module,
        ..json_param(name, default)
    }
}

/// The core's camera (Camera `camera@1`), every field at the design's default. The pose, the
/// projection and the camera you move are evaluated here. `yield` eases back on a stage change
/// or `camera.reset` and `reduced_motion` holds a move: no input of this slice's session
/// (drag, pinch, hover, control) starts either, so they are read and kept. `fit` would frame
/// every still, and the camera module refuses it set until framing is evaluated. The lens,
/// exposure, depth of field, near and far are scene3d's contribution, which this build lacks,
/// so setting one is `module_missing`.
fn camera() -> Entry {
    Entry {
        family: "",
        name: "camera",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                json_param("projection", json!("perspective")),
                json_param("target", json!([0, 0, 0])),
                json_param("position", Value::Null),
                json_param("orbit", Value::Null),
                f32_param("roll", "deg", 0.0, -360.0, 360.0, 0),
                json_param("view_width", Value::Null),
                f32_param("fov", "deg", 40.0, 0.0, 179.0, 0),
                json_param("shift", json!([0, 0])),
                json_param("user", json!({})),
                json_param("fit", Value::Null),
                json_param("yield", Value::Null),
                json_param("reduced_motion", json!("hold")),
                module_param("near", "scene3d", json!("auto")),
                module_param("far", "scene3d", json!("auto")),
                module_param("dof", "scene3d", Value::Null),
                module_param("exposure", "scene3d", Value::Null),
                module_param("lens", "scene3d", Value::Null),
                module_param("aperture", "scene3d", Value::Null),
                module_param("shutter", "scene3d", Value::Null),
                module_param("iso", "scene3d", Value::Null),
            ],
        }],
        migrations: vec![],
    }
}

/// The two flat test kinds of the #372 acceptance README: a 2D rectangle from its top-left
/// corner and a 3D disc about its position, each with an sRGB fill.
fn test_shapes() -> [Entry; 2] {
    let rect = Entry {
        family: "test",
        name: "rect",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                f32_param("w", "u", 100.0, 0.0, 100_000.0, 0),
                f32_param("h", "u", 100.0, 0.0, 100_000.0, 0),
                json_param("fill", json!([255, 255, 255])),
            ],
        }],
        migrations: vec![],
    };
    let dot = Entry {
        family: "test",
        name: "dot",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                f32_param("radius", "m", 0.1, 0.0, 1000.0, 0),
                json_param("fill", json!([255, 255, 255])),
            ],
        }],
        migrations: vec![],
    };
    [rect, dot]
}

fn build() -> Registry {
    let [rect, dot] = test_shapes();
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
        entries: vec![slab, camera(), rect, dot],
    }
}

/// The build's registry, built on each call: a static would be an address a check could carry
/// state between runs through, and the lint refuses every one.
pub fn registry() -> Registry {
    build()
}

/// The params with the kind's registry defaults filled in where a field is absent, so a
/// reader has one source of defaults; an unregistered kind's params pass through as they are.
pub fn with_defaults(kind_text: &str, params: &Map<String, Value>) -> Map<String, Value> {
    let mut out = params.clone();
    let registry = registry();
    if let Lookup::Known { entry, saved } = lookup(&registry, kind_text) {
        if let Some(version) = entry.version(saved) {
            for param in &version.params {
                out.entry(param.name.to_string())
                    .or_insert_with(|| param.default.clone());
            }
        }
    }
    out
}

/// A whole number with no leading zero, as a version part is written.
fn parse_part(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0'))
    {
        return None;
    }
    s.parse().ok()
}

/// `family.name`, or a core kind's bare `name`: an ID (canvas primitives: Item and kind, whose
/// examples are `slab@1` and `village.house@1`), so every build writes the same grammar and
/// text outside it is no build's kind.
fn kind_name(name: &str) -> Option<String> {
    Id::parse(name).ok().map(|_| name.to_string())
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
        assert!(matches!(lookup(&registry, "slab@1"), Lookup::UnknownKind));
        assert!(matches!(
            lookup(&registry, "camera@1"),
            Lookup::Known { .. }
        ));
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
