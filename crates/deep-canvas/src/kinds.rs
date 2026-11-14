//! The kind registry (canvas primitives: Item and kind): each kind's versions, one per major, with
//! its param schema, and the migrations between majors as data, one major a step.
//!
//! This slice registers `test.slab` at major 3 minor 1 with its two earlier majors, exactly as
//! the #389 acceptance README's table says; the core's `camera` (#372, canvas primitives:
//! Camera `camera@1`), whose structured params the camera module reads; and the two flat test
//! kinds the #372 acceptance README draws, `test.rect` and `test.dot`. A kind's text in a
//! document is `family.name@major` (a core kind has no family: `camera@1`); `requires.kinds`
//! names `family.name@major.minor`.

use serde_json::{json, Map, Value};

/// A param's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParamType {
    /// An `f32` number in the param's unit, or a unit literal converted into it.
    F32,
    /// A string.
    Str,
    /// A structured value (a vector, an object, a choice), declared by the forms its reader
    /// takes in the form language (`crate::form`, #1973): the listing prints them and the
    /// document check refuses a value none of them takes. The reader checks the rest when it
    /// evaluates the item.
    Json(&'static str),
}

impl ParamType {
    /// A structured param's declared forms; `None` for a number or a string.
    pub fn form(self) -> Option<&'static str> {
        match self {
            ParamType::Json(form) => Some(form),
            _ => None,
        }
    }
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
    /// The operator of that module that evaluates it, or empty: when the seal left the operator
    /// out, for an optional dependency the build lacks, setting the field is `module_missing`
    /// naming that dependency (Registry and seal).
    pub operator: &'static str,
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
    /// The params the next major retires, each dropped from the params it migrates (#412: the
    /// retirement record `deep kinds --diff` reads).
    pub retires: Vec<&'static str>,
    /// A canvas module's kind may also migrate by a pure function over the params, run after the
    /// renames (Migration: `kind.migrate`).
    pub map: Option<MigrateFn>,
}

/// A pure function over an item's params, from one major to the next.
pub type MigrateFn = fn(&mut Map<String, Value>);

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

    /// Whether this is the kind `full_name` names, compared in place: lookups run per item, so
    /// nothing is allocated.
    pub(crate) fn is(&self, full_name: &str) -> bool {
        if self.family.is_empty() {
            return self.name == full_name;
        }
        full_name
            .strip_prefix(self.family)
            .and_then(|rest| rest.strip_prefix('.'))
            == Some(self.name)
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

/// Runs one migration step on an item's params: its renames, then its function.
pub fn migrate_step(step: &Migration, params: &mut Map<String, Value>) {
    for rename in &step.renames {
        if params.contains_key(rename.to) {
            continue;
        }
        if let Some(value) = params.shift_remove(rename.from) {
            params.insert(rename.to.to_string(), value);
        }
    }
    for retired in &step.retires {
        params.shift_remove(*retired);
    }
    if let Some(map) = step.map {
        map(params);
    }
}

/// Every kind this build registers.
#[derive(Clone, Debug)]
pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    /// Every entry, in the order the build registered them.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// The entry named `family.name`, if any.
    pub fn entry(&self, full_name: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.is(full_name))
    }

    /// This registry as an earlier build had it: each `family.name@major.minor` in `pins` at
    /// that minor, with only the params its minor has. `None` when a pin names a kind or a major
    /// this build lacks, or a minor above the build's.
    pub fn pinned(&self, pins: &[String]) -> Option<Registry> {
        let mut out = self.clone();
        for pin in pins {
            let (name, major, minor) = parse_required(pin)?;
            let entry = out.entries.iter_mut().find(|e| e.is(&name))?;
            let version = entry.versions.iter_mut().find(|v| v.major == major)?;
            if minor > version.minor {
                return None;
            }
            version.minor = minor;
            version.params.retain(|p| p.minor <= minor);
        }
        Some(out)
    }

    /// Adds the kinds the sealed canvas modules register (Registry and seal).
    pub(crate) fn extend(&mut self, entries: impl IntoIterator<Item = Entry>) {
        self.entries.extend(entries);
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
        operator: "",
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
        operator: "",
    }
}

/// A structured param, with the forms its reader takes (`crate::form`, #1973).
fn json_param(name: &'static str, form: &'static str, default: Value) -> Param {
    Param {
        name,
        ty: ParamType::Json(form),
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

/// A field another canvas module evaluates into the kind's array (Array and table).
fn module_param(
    name: &'static str,
    module: &'static str,
    form: &'static str,
    default: Value,
) -> Param {
    Param {
        module,
        ..json_param(name, form, default)
    }
}

/// A score (#154; Score `score.music@1`): music as data. The core holds the kind so a document
/// names no module to use it; every field is the motion module's, which resolves its times through
/// the tempo map and checks it, so a build without motion refuses a score with `module_missing`.
fn score() -> Entry {
    let params = [
        (
            "instruments",
            "{ID → {source: sampled {library, preset} | pluck {preset, overrides} | synth {preset} | {type, preset}, stem?: name, bass?: bool}}",
        ),
        (
            "events",
            "{ID → {at: time | flick, inst: ID, pitch: name | f32, dur: f32 | text, vel?: 0..1, pan?, gain?: dB, attack?, release?, bend?, vib?, strum?: s}}",
        ),
        ("loop", "{from: text, to: text} (each a bar:beat)"),
        ("stems", "{name → sha256}"),
    ];
    Entry {
        family: "score",
        name: "music",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: params
                .into_iter()
                .map(|(name, form)| module_param(name, "motion", form, Value::Null))
                .collect(),
        }],
        migrations: vec![],
    }
}

/// A camera's point, as `Spec::read` reads `target` and `position` (m; u in a 2D document).
const POINT: &str = "[x: m, y: m, z: m]";

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
                json_param(
                    "projection",
                    "perspective | orthographic | isometric",
                    json!("perspective"),
                ),
                json_param("target", POINT, json!([0, 0, 0])),
                json_param("position", POINT, Value::Null),
                json_param(
                    "orbit",
                    "{azimuth?: deg, elevation?: deg, distance?: m}",
                    Value::Null,
                ),
                f32_param("roll", "deg", 0.0, -360.0, 360.0, 0),
                json_param("view_width", "m", Value::Null),
                f32_param("fov", "deg", 40.0, 0.0, 179.0, 0),
                json_param("shift", "[x, y] (fractions of the view)", json!([0, 0])),
                json_param(
                    "user",
                    "{turn | tilt | zoom_rate: f32, pitch | yaw: [min: deg, max: deg], zoom?: [min, max], pivot?: target | eye, pan?: {bounds | margin | edge}, zoom_at?: pointer | center}",
                    json!({}),
                ),
                json_param(
                    "fit",
                    "{keep: [ID], pad?: f32, avoid?: overlay | none, place?: [x, y] | thirds_left | thirds_right, fill?: 0..1}",
                    Value::Null,
                ),
                json_param(
                    "yield",
                    "{resume_after?: s, ease_back?: s, ease?: in_out_cubic}",
                    Value::Null,
                ),
                json_param("reduced_motion", "hold", json!("hold")),
                module_param("near", "scene3d", "m | auto", json!("auto")),
                module_param("far", "scene3d", "m | auto", json!("auto")),
                module_param(
                    "dof",
                    "scene3d",
                    "{focus?: ID | m, f_stop?: f32, blades?: u8}",
                    Value::Null,
                ),
                module_param("exposure", "scene3d", "EV100 | from_lens", Value::Null),
                module_param(
                    "lens",
                    "scene3d",
                    "{focal_length: mm, sensor?: [w: mm, h: mm], fit?: horizontal | vertical | wider}",
                    Value::Null,
                ),
                module_param(
                    "aperture",
                    "scene3d",
                    "{f_stop?: f32, blades?: u8}",
                    Value::Null,
                ),
                module_param("shutter", "scene3d", "{angle?: deg}", Value::Null),
                module_param("iso", "scene3d", "f32", Value::Null),
            ],
        }],
        migrations: vec![],
    }
}

/// R1's circle (Circle `circle@1`): a dot or a ring, its radius never below 0. Its paint, status,
/// arc and path ops are read by the marks it draws as.
fn circle() -> Entry {
    Entry {
        family: "",
        name: "circle",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                json_param("center", "[x: u, y: u]", json!([0, 0])),
                f32_param("r", "u", 0.0, 0.0, 100_000.0, 0),
                f32_param("inner_r", "u", 0.0, 0.0, 100_000.0, 0),
                json_param("arc", "{from: deg, to: deg}", Value::Null),
                json_param(
                    "paint",
                    "{fill?: {role | gradient | hatch | steps | fill | opacity}, stroke?: {role | width | dash | line | opacity}, opacity?: 0..1, shade?: {kind | role}, drop?, glow?, bevel?, satin?}",
                    Value::Null,
                ),
                json_param("status", "{source: text, as_of?, legend?}", Value::Null),
                json_param(
                    "ops",
                    "[{trim | round_corners | offset_path | zigzag | pucker | twist | repeater}] ≤ 8 (one op each)",
                    Value::Null,
                ),
                // #160: its place in the draw order (Frame and group: draw order).
                json_param("z", "f32", json!(0)),
                json_param("draw_order", "back | body | front | auto", json!("auto")),
            ],
        }],
        migrations: vec![],
    }
}

/// R2's series (Series and decimation `series@1`, #397): rows in typed columns, drawn decimated
/// per pixel column of its `box`. Its columns and view are read by the marks it draws as.
fn series() -> Entry {
    // A value column, as `data::column_of` reads one.
    const VALUES: &str = "{dtype, len: u32, data} (an f32 column)";
    let params = [
        (
            "source",
            "text (a reading or stream handle, or a physics output ID)",
        ),
        ("t", "{dtype, len: u32, data} (an i64 column, in flicks)"),
        ("v", VALUES),
        ("o", VALUES),
        ("h", VALUES),
        ("l", VALUES),
        ("c", VALUES),
        ("append", "{source, rule}"),
        ("chunk", "u32 (rows)"),
        ("capacity", "u32 (rows)"),
        ("gap", "span | flick"),
        ("calendar", "{tz, sessions}"),
        ("window", "[t0, t1] | {last: count}"),
        ("decimate", "m4 | ohlc | minmax | none"),
        ("bucket", "text (1px, or a duration)"),
        (
            "columns",
            "{name → {mean | std | min | max | sum | ema, length}}",
        ),
        (
            "marks",
            "[name] (each line, area, candle, band, bar, rule or tag)",
        ),
        ("candle", "{up: role, down: role}"),
        ("crosshair", "{snap, readout}"),
        ("box", "[x, y, w, h]"),
        ("role", "role"),
    ];
    Entry {
        family: "",
        name: "series",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: params
                .into_iter()
                .map(|(p, form)| json_param(p, form, Value::Null))
                .collect(),
        }],
        migrations: vec![],
    }
}

/// The two flat test kinds of the #372 acceptance README: a 2D rectangle from its top-left
/// corner and a 3D disc about its position, each with an sRGB fill.
fn test_shapes() -> [Entry; 2] {
    // Three sRGB bytes, as `draw::fill_of` reads them; or a role, which the status-color rule
    // reads (the kit's `status_color_unbound` fixture paints one).
    const FILL: &str = "[r: u8, g: u8, b: u8] | {role}";
    let rect = Entry {
        family: "test",
        name: "rect",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                f32_param("w", "u", 100.0, 0.0, 100_000.0, 0),
                f32_param("h", "u", 100.0, 0.0, 100_000.0, 0),
                json_param("fill", FILL, json!([255, 255, 255])),
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
                json_param("fill", FILL, json!([255, 255, 255])),
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
                retires: vec![],
                map: None,
            },
            Migration {
                from: 2,
                to: 3,
                renames: vec![Rename {
                    from: "h",
                    to: "height",
                }],
                retires: vec![],
                map: None,
            },
        ],
    };
    Registry {
        entries: vec![
            slab,
            camera(),
            circle(),
            series(),
            rect,
            dot,
            score(),
            test_defaults(),
        ],
    }
}

/// #1974's fixture kind: one field defaulting to each shape a default takes (a number, a choice, a
/// list of 3 numbers and an object), so the defaults run compares each shape.
fn test_defaults() -> Entry {
    Entry {
        family: "test",
        name: "defaults",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                f32_param("count", "u", 1.0, 0.0, 100.0, 0),
                json_param("pace", "slow | fast", json!("slow")),
                json_param("reach", "[x: u, y: u, z: u]", json!([1, 2, 3])),
                json_param(
                    "tint",
                    "{r: 0..1, g: 0..1, b: 0..1}",
                    json!({"r": 1, "g": 0.5, "b": 0}),
                ),
            ],
        }],
        migrations: vec![],
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
    crate::grammar::id_fault(name)
        .is_none()
        .then(|| name.to_string())
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
