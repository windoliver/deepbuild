//! Packs and recipe expansion (canvas primitives: Pack; Recipe; Pack: retired and missing;
//! issue #306).
//!
//! A pack is data a caller admits once per version through [`Packs::admit`], which runs the
//! pack check: its envelope, its `requires.modules` against the sealed build, and each recipe's
//! shape. A document names `owner/name@version` in `packs`, and the check resolves each entry
//! through [`resolve`]: a version the build lacks refuses the document whole with
//! `pack_missing`, two packs of one name are refused naming both IDs, and a pack whose module
//! the build lacks is `module_missing`. An item whose kind is `<pack>.<recipe>@<major>` is an
//! instance: [`expand`] checks its params against the recipe's inputs and writes its derived
//! items `<instance>.<step>[.<index>]` into the lowered document, keyed by
//! `hash(recipe@version, inputs, broken_out)` so equal expansions share a key, and seeded by
//! `(instance, step, index)`. Nothing here runs per frame: expansion is part of the check.
//!
//! The planted wrong programs the acceptance suite names are runtime variants on
//! [`Planted`], never features: this crate has none.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::{member, Issue};
use crate::registry::{self, Range, Sealed, Semver};
use crate::schedule::{canonical, Hasher};

/// The most derived items one repeat makes (Recipe: cost).
pub const MAX_REPEAT: u64 = 1024;

/// The planted wrong programs of #306's acceptance criteria, each off by default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Seeds derived items by expansion order, not by `(instance, step, index)`.
    pub seed_by_order: bool,
    /// A re-expansion writes over a broken-out item.
    pub overwrite_broken_out: bool,
    /// The pack check admits a pack without reading `requires.modules`.
    pub skip_requires_modules: bool,
    /// Packs resolve by name alone, so the first pack listed wins a name.
    pub key_by_name: bool,
}

/// `owner/name@major.minor.patch`, as a document's `packs` entry names a pack version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackId {
    /// `owner/name`.
    pub id: String,
    /// The name half: what `<pack>` in a kind's name is.
    pub name: String,
    pub version: Semver,
}

impl PackId {
    /// Parses `owner/name@version`; the version is written whole (`1.0.0`).
    pub fn parse(text: &str) -> Option<PackId> {
        let (id, version) = text.rsplit_once('@')?;
        let version = exact_version(version)?;
        let (owner, name) = id.split_once('/')?;
        if !well_named(owner) || !well_named(name) {
            return None;
        }
        Some(PackId {
            id: id.to_string(),
            name: name.to_string(),
            version,
        })
    }

    /// `owner/name@version`.
    pub fn text(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }
}

/// `[a-z0-9][a-z0-9_-]*` (the package envelope's ID halves).
fn well_named(part: &str) -> bool {
    let mut chars = part.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// A version written with all three parts, so one version has one spelling.
fn exact_version(text: &str) -> Option<Semver> {
    if text.split('.').count() != 3 {
        return None;
    }
    Semver::parse(text)
}

/// One input of a recipe (Recipe: `inputs`).
#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub ty: String,
    pub default: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub options: Vec<String>,
}

/// One step of a recipe (Recipe: `steps`).
#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    pub id: String,
    pub op: String,
    pub kind: String,
    /// Each param a literal or an expression, in the recipe's order.
    pub params: Vec<(String, Template)>,
    pub at: Option<Template>,
    pub lets: Vec<(String, Template)>,
    /// `{count, as}`; `None` makes one item.
    pub repeat: Option<(Template, String)>,
}

/// A recipe as its pack ships it.
#[derive(Clone, Debug, PartialEq)]
pub struct Recipe {
    /// `pack.name`.
    pub id: String,
    pub major: u64,
    pub minor: u64,
    pub inputs: BTreeMap<String, Input>,
    pub lets: Vec<(String, Template)>,
    pub steps: Vec<Step>,
}

/// An admitted pack version.
#[derive(Clone, Debug, PartialEq)]
pub struct Pack {
    pub id: PackId,
    pub requires_modules: BTreeMap<String, String>,
    /// By `pack.name`.
    pub recipes: BTreeMap<String, Recipe>,
    /// `d1:` SHA-256 of the manifest's canonical form: a version's bytes, frozen.
    pub digest: String,
}

/// The step ops this slice expands: a mark or an item of a kind the build registers.
const STEP_OPS: &[&str] = &["mark", "item"];
/// The input types this slice reads.
const INPUT_TYPES: &[&str] = &[
    "number", "integer", "bool", "choice", "vec3", "range", "text", "ID",
];

/// The pack check (Pack: checked once per version). Refuses with the issues at the manifest's
/// paths; a module the build lacks is `module_missing` naming it.
pub fn check_pack(manifest: &Value, sealed: &Sealed, planted: Planted) -> Result<Pack, Vec<Issue>> {
    let mut issues = Vec::new();
    let bad = |path: &str, actual: Value, what: &str| {
        Issue::envelope("out_of_range", path.to_string(), actual, what)
    };
    let Some(fields) = manifest.as_object() else {
        return Err(vec![bad("", manifest.clone(), "a pack is an object")]);
    };
    let text = |key: &str| member(manifest, key).and_then(Value::as_str);
    let name = text("name").unwrap_or_default();
    let id = text("id").unwrap_or_default();
    let version = text("version").unwrap_or_default();
    let id = match PackId::parse(&format!("{id}@{version}")) {
        Some(id) if id.name == name => id,
        _ => {
            issues.push(bad(
                "name",
                json!({"id": id, "name": name, "version": version}),
                "a pack names `owner/name`, with `name` its name half, and a whole `version`",
            ));
            return Err(issues);
        }
    };
    if text("license").is_none() {
        issues.push(bad(
            "license",
            fields.get("license").cloned().unwrap_or(Value::Null),
            "not an SPDX string",
        ));
    }
    if text("description").is_none() {
        issues.push(bad(
            "description",
            fields.get("description").cloned().unwrap_or(Value::Null),
            "not a string",
        ));
    }
    // A pack's name is a kind family of its own: one a canvas module registers, or a module's
    // name, would capture that module's kinds.
    if sealed.module(&id.name).is_some()
        || sealed.kinds().entries().iter().any(|e| e.family == id.name)
    {
        issues.push(bad(
            "name",
            json!(id.name),
            "a canvas module's name or kind family; a pack names its own",
        ));
    }
    let mut requires_modules = BTreeMap::new();
    if let Some(requires) = fields.get("requires") {
        match requires.as_object() {
            None => issues.push(bad("requires", requires.clone(), "not an object")),
            Some(req) => {
                for (key, value) in req {
                    match key.as_str() {
                        "core" => {
                            if value
                                .as_str()
                                .filter(|r| Range::parse(r).is_some())
                                .is_none()
                            {
                                issues.push(bad(
                                    "requires/core",
                                    value.clone(),
                                    "not a version range",
                                ));
                            }
                        }
                        "modules" => match value.as_object() {
                            None => {
                                issues.push(bad("requires/modules", value.clone(), "not an object"))
                            }
                            Some(modules) => {
                                for (module, range) in modules {
                                    let path = format!("requires/modules/{module}");
                                    let Some(parsed) = range.as_str().and_then(Range::parse) else {
                                        issues.push(bad(
                                            &path,
                                            range.clone(),
                                            "not a version range",
                                        ));
                                        continue;
                                    };
                                    if !registry::well_named(module) {
                                        issues.push(bad(&path, range.clone(), "not a module name"));
                                        continue;
                                    }
                                    requires_modules.insert(
                                        module.clone(),
                                        range.as_str().unwrap_or_default().to_string(),
                                    );
                                    if planted.skip_requires_modules {
                                        continue;
                                    }
                                    if !sealed.satisfies(module, &parsed) {
                                        let (code, what) = match sealed.module(module) {
                                            None => (
                                                "module_missing",
                                                format!("pack `{}` requires the {module} module, which this build lacks", id.text()),
                                            ),
                                            Some(m) => (
                                                "out_of_range",
                                                format!("pack `{}` requires the {module} module at {parsed}; this build has {}", id.text(), m.version),
                                            ),
                                        };
                                        issues.push(Issue::envelope(
                                            code,
                                            path,
                                            range.clone(),
                                            &what,
                                        ));
                                    }
                                }
                            }
                        },
                        "packs" => issues.push(bad(
                            "requires/packs",
                            value.clone(),
                            "pack dependencies land with the pack versions task",
                        )),
                        other => issues.push(Issue::envelope(
                            "unknown_field",
                            format!("requires/{other}"),
                            value.clone(),
                            "not a field of requires",
                        )),
                    }
                }
            }
        }
    }
    let mut recipes = BTreeMap::new();
    match fields.get("recipes") {
        None => {}
        Some(Value::Object(map)) => {
            for (key, recipe) in map {
                let path = format!("recipes/{key}");
                match check_recipe(&id.name, key, recipe, sealed, &path) {
                    Ok(r) => {
                        let recipe_id = r.id.clone();
                        if recipes.insert(recipe_id.clone(), r).is_some() {
                            issues.push(bad(
                                &path,
                                json!(key),
                                &format!("a second entry for `{recipe_id}`"),
                            ));
                        }
                    }
                    Err(more) => issues.extend(more),
                }
            }
        }
        Some(other) => issues.push(bad("recipes", other.clone(), "not an object")),
    }
    for key in fields.keys() {
        if !PACK_KEYS.contains(&key.as_str()) {
            issues.push(Issue::envelope(
                "unknown_field",
                key.clone(),
                fields[key].clone(),
                "not a field of a pack in this slice",
            ));
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Pack {
        id,
        requires_modules,
        recipes,
        digest: digest(manifest),
    })
}

/// `d1:` SHA-256 of a manifest's canonical form: a version's bytes, frozen.
fn digest(manifest: &Value) -> String {
    format!("d1:{}", crate::schedule::sha256_hex(&canonical(manifest)))
}

/// A pack's keys in this slice (Pack: fields; the rest land with their features).
const PACK_KEYS: &[&str] = &[
    "id",
    "owner",
    "name",
    "version",
    "license",
    "description",
    "requires",
    "recipes",
];

/// The recipe's keys.
const RECIPE_KEYS: &[&str] = &[
    "id",
    "version",
    "title",
    "catalog",
    "tags",
    "license",
    "author",
    "description",
    "preview",
    "inputs",
    "let",
    "steps",
    "outputs",
];
/// A step's keys in this slice.
const STEP_KEYS: &[&str] = &["op", "kind", "params", "at", "repeat", "let"];

fn check_recipe(
    pack: &str,
    key: &str,
    recipe: &Value,
    sealed: &Sealed,
    path: &str,
) -> Result<Recipe, Vec<Issue>> {
    let mut issues = Vec::new();
    let bad = |at: &str, actual: Value, what: &str| {
        Issue::envelope("out_of_range", format!("{path}/{at}"), actual, what)
    };
    let Some(fields) = recipe.as_object() else {
        return Err(vec![Issue::envelope(
            "out_of_range",
            path.to_string(),
            recipe.clone(),
            "a recipe is an object",
        )]);
    };
    for k in fields.keys() {
        if !RECIPE_KEYS.contains(&k.as_str()) {
            issues.push(Issue::envelope(
                "unknown_field",
                format!("{path}/{k}"),
                fields[k].clone(),
                "not a field of a recipe",
            ));
        }
    }
    let id = fields.get("id").and_then(Value::as_str).unwrap_or(key);
    let version = fields
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let parsed = version
        .split_once('.')
        .and_then(|(a, b)| Some((a.parse::<u64>().ok()?, b.parse::<u64>().ok()?)));
    let (major, minor) = match parsed {
        Some(pair) => pair,
        None => {
            issues.push(bad("version", json!(version), "not major.minor"));
            (0, 0)
        }
    };
    // The recipe's id is `<pack>.<name>`; its key in `recipes` is that id, the kind it makes
    // (`<pack>.<name>@<major>`) or the bare name.
    let expected = format!("{pack}.");
    let short = id.strip_prefix(&expected).filter(|s| well_named(s));
    let keyed = [
        id.to_string(),
        format!("{id}@{major}"),
        short.unwrap_or_default().to_string(),
    ];
    if short.is_none() || !keyed.iter().any(|k| k == key) {
        issues.push(bad(
            "id",
            json!(id),
            &format!("a recipe's id is `{pack}.<name>`, and its key that id, its kind or its name"),
        ));
    }
    let mut inputs = BTreeMap::new();
    match fields.get("inputs") {
        None => {}
        Some(Value::Object(map)) => {
            for (name, spec) in map {
                let at = format!("inputs/{name}");
                let Some(spec) = spec.as_object() else {
                    issues.push(bad(&at, map[name].clone(), "not an object"));
                    continue;
                };
                let ty = spec.get("type").and_then(Value::as_str).unwrap_or_default();
                if !INPUT_TYPES.contains(&ty) {
                    issues.push(bad(
                        &format!("{at}/type"),
                        json!(ty),
                        "not an input type of this slice",
                    ));
                    continue;
                }
                let num = |k: &str| spec.get(k).and_then(Value::as_f64);
                let options = spec
                    .get("options")
                    .and_then(Value::as_array)
                    .map(|o| {
                        o.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let input = Input {
                    ty: ty.to_string(),
                    default: spec.get("default").cloned().unwrap_or(Value::Null),
                    min: num("min"),
                    max: num("max"),
                    options,
                };
                if let Some(what) = input_fault(&input, &input.default) {
                    if !input.default.is_null() {
                        issues.push(bad(&format!("{at}/default"), input.default.clone(), &what));
                    }
                }
                inputs.insert(name.clone(), input);
            }
        }
        Some(other) => issues.push(bad("inputs", other.clone(), "not an object")),
    }
    let lets = read_lets(fields.get("let"), &format!("{path}/let"), &mut issues);
    let mut steps = Vec::new();
    match fields.get("steps") {
        None => issues.push(bad("steps", Value::Null, "required, and absent")),
        Some(Value::Object(map)) => {
            for (step_id, step) in map {
                let at = format!("steps/{step_id}");
                if !well_named(step_id) {
                    issues.push(bad(&at, json!(step_id), "not a step ID"));
                    continue;
                }
                let Some(s) = step.as_object() else {
                    issues.push(bad(&at, step.clone(), "not an object"));
                    continue;
                };
                for k in s.keys() {
                    if !STEP_KEYS.contains(&k.as_str()) {
                        let what = match k.as_str() {
                            "when" | "channels" | "modifiers" | "material" | "steps" => {
                                "lands with 3D scenes, not this slice"
                            }
                            _ => "not a field of a step",
                        };
                        issues.push(Issue::envelope(
                            "unknown_field",
                            format!("{path}/{at}/{k}"),
                            s[k].clone(),
                            what,
                        ));
                    }
                }
                let op = s.get("op").and_then(Value::as_str).unwrap_or_default();
                if !STEP_OPS.contains(&op) {
                    let what = if op == "recipe" {
                        "a recipe step nests, which lands with 3D scenes; nothing recurses here"
                    } else {
                        "not a step op of this slice (mark, item)"
                    };
                    issues.push(bad(&format!("{at}/op"), json!(op), what));
                    continue;
                }
                let kind = s.get("kind").and_then(Value::as_str).unwrap_or_default();
                let Some((kind_name, _)) = crate::kinds::parse_kind(kind) else {
                    issues.push(bad(
                        &format!("{at}/kind"),
                        json!(kind),
                        "not family.name@major",
                    ));
                    continue;
                };
                // A kind of a module the build lacks: the pack can't check here.
                if let Some(module) = sealed.missing_for_kind(&kind_name) {
                    issues.push(Issue::envelope(
                        "module_missing",
                        format!("{path}/{at}/kind"),
                        json!(kind),
                        &format!("step `{step_id}` makes a `{kind}`, evaluated by the {module} module, which this build lacks"),
                    ));
                    continue;
                }
                let params = match s.get("params") {
                    None => Vec::new(),
                    Some(Value::Object(p)) => p
                        .iter()
                        .map(|(k, v)| (k.clone(), Template::of(v)))
                        .collect(),
                    Some(other) => {
                        issues.push(bad(&format!("{at}/params"), other.clone(), "not an object"));
                        continue;
                    }
                };
                let repeat = match s.get("repeat") {
                    None => None,
                    Some(r) => {
                        let count = member(r, "count").cloned();
                        let as_ = member(r, "as").and_then(Value::as_str);
                        let keys: Vec<&String> = r
                            .as_object()
                            .map(|o| o.keys().collect())
                            .unwrap_or_default();
                        if keys.iter().any(|k| !["count", "as"].contains(&k.as_str())) {
                            issues.push(bad(&format!("{at}/repeat"), r.clone(), "only `{count, as}` repeats in this slice; over, on, along and pack land with 3D scenes"));
                            continue;
                        }
                        match (count, as_) {
                            (Some(c), Some(a)) if well_named(a) => {
                                Some((Template::of(&c), a.to_string()))
                            }
                            _ => {
                                issues.push(bad(
                                    &format!("{at}/repeat"),
                                    r.clone(),
                                    "a repeat is `{count, as}`",
                                ));
                                continue;
                            }
                        }
                    }
                };
                let step_lets = read_lets(s.get("let"), &format!("{path}/{at}/let"), &mut issues);
                steps.push(Step {
                    id: step_id.clone(),
                    op: op.to_string(),
                    kind: kind.to_string(),
                    params,
                    at: s.get("at").map(Template::of),
                    lets: step_lets,
                    repeat,
                });
            }
        }
        Some(other) => issues.push(bad("steps", other.clone(), "not an object")),
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Recipe {
        id: id.to_string(),
        major,
        minor,
        inputs,
        lets,
        steps,
    })
}

fn read_lets(
    value: Option<&Value>,
    path: &str,
    issues: &mut Vec<Issue>,
) -> Vec<(String, Template)> {
    match value {
        None => Vec::new(),
        Some(Value::Object(map)) => map
            .iter()
            .filter(|(name, _)| {
                if well_named(name) {
                    true
                } else {
                    issues.push(Issue::envelope(
                        "out_of_range",
                        format!("{path}/{name}"),
                        json!(name),
                        "not a name",
                    ));
                    false
                }
            })
            .map(|(k, v)| (k.clone(), Template::of(v)))
            .collect(),
        Some(other) => {
            issues.push(Issue::envelope(
                "out_of_range",
                path.to_string(),
                other.clone(),
                "not an object",
            ));
            Vec::new()
        }
    }
}

/// Why `value` is no value of `input`, if it isn't.
fn input_fault(input: &Input, value: &Value) -> Option<String> {
    let range = |n: f64| -> Option<String> {
        let below = input.min.is_some_and(|min| n < min);
        let above = input.max.is_some_and(|max| n > max);
        (below || above || !n.is_finite()).then(|| {
            format!(
                "outside {} to {}",
                input.min.unwrap_or(f64::NEG_INFINITY),
                input.max.unwrap_or(f64::INFINITY)
            )
        })
    };
    match input.ty.as_str() {
        "number" => match value.as_f64() {
            Some(n) => range(n),
            None => Some("not a number".into()),
        },
        "integer" => match value.as_f64() {
            Some(n) if n.fract() == 0.0 => range(n),
            _ => Some("not an integer".into()),
        },
        "bool" => (!value.is_boolean()).then(|| "not a bool".to_string()),
        "choice" => match value.as_str() {
            Some(s) if input.options.iter().any(|o| o == s) => None,
            _ => Some(format!("not one of {}", input.options.join(", "))),
        },
        "vec3" | "range" => {
            let (len, what) = match input.ty.as_str() {
                "vec3" => (3, "not three numbers"),
                _ => (2, "not two numbers"),
            };
            let ok = value.as_array().is_some_and(|a| {
                a.len() == len && a.iter().all(|v| v.as_f64().is_some_and(f64::is_finite))
            });
            (!ok).then(|| what.to_string())
        }
        "text" | "ID" => (!value.is_string()).then(|| "not a string".to_string()),
        _ => None,
    }
}

/// The pack versions a build admitted, keyed `owner/name@version`.
#[derive(Clone, Debug, Default)]
pub struct Packs {
    by_id: BTreeMap<String, Pack>,
    /// The versions the pack check refused for a canvas module this build lacks, with those
    /// issues: a document that names one is refused with the same `module_missing`.
    refused: BTreeMap<String, Vec<Issue>>,
    /// How often the pack check ran per `owner/name@version`: once, as a version is checked once.
    checks: BTreeMap<String, u32>,
    pub planted: Planted,
}

impl Packs {
    pub fn new(planted: Planted) -> Packs {
        Packs {
            planted,
            ..Packs::default()
        }
    }

    /// Runs the pack check and admits the version. A version already admitted with other
    /// contents is refused: a published version never changes.
    pub fn admit(&mut self, manifest: &Value, sealed: &Sealed) -> Result<&Pack, Vec<Issue>> {
        let key = manifest_id(manifest);
        // A version already published: the same bytes are admitted as checked, other bytes are
        // refused; neither runs the check again.
        if let Some(k) = key.as_ref().filter(|k| self.by_id.contains_key(*k)) {
            let have = &self.by_id[k];
            let offered = digest(manifest);
            if have.digest != offered {
                return Err(vec![Issue::envelope(
                    "out_of_range",
                    "version".into(),
                    json!({"pack": have.id.text(), "published": have.digest, "offered": offered}),
                    &format!(
                        "pack `{}` is published with other contents; a version never changes",
                        have.id.text()
                    ),
                )]);
            }
            return Ok(have);
        }
        if let Some(key) = &key {
            *self.checks.entry(key.clone()).or_default() += 1;
        }
        let pack = match check_pack(manifest, sealed, self.planted) {
            Ok(pack) => pack,
            Err(issues) => {
                let missing: Vec<Issue> = issues
                    .iter()
                    .filter(|i| i.code == "module_missing")
                    .cloned()
                    .collect();
                if !missing.is_empty() {
                    if let Some(key) = key {
                        self.refused.entry(key).or_insert(missing);
                    }
                }
                return Err(issues);
            }
        };
        Ok(self.by_id.entry(pack.id.text()).or_insert(pack))
    }

    /// How often the pack check has run for `owner/name@version`.
    pub fn checks(&self, id: &str) -> u32 {
        self.checks.get(id).copied().unwrap_or(0)
    }

    /// The admitted pack at `owner/name@version`.
    pub fn get(&self, id: &str) -> Option<&Pack> {
        self.by_id.get(id)
    }
}

/// `owner/name@version` of a manifest, as its envelope writes it.
fn manifest_id(manifest: &Value) -> Option<String> {
    let text = |key: &str| member(manifest, key).and_then(Value::as_str);
    PackId::parse(&format!("{}@{}", text("id")?, text("version")?)).map(|p| p.text())
}

/// The packs a document resolved: by name, for a kind's `<pack>` half.
#[derive(Clone, Debug, Default)]
pub struct Resolved<'a> {
    by_name: BTreeMap<String, &'a Pack>,
}

impl<'a> Resolved<'a> {
    /// The canvas modules the resolved packs require: declared for their derived items.
    pub fn modules(&self) -> impl Iterator<Item = &String> + '_ {
        self.by_name
            .values()
            .flat_map(|pack| pack.requires_modules.keys())
    }

    /// The recipe a kind `family.name@major` names, with its pack, if it is a pack kind.
    pub fn recipe(&self, kind: &str) -> Option<(&'a Pack, &'a Recipe)> {
        let (full, major) = kind.rsplit_once('@')?;
        let major: u64 = major.parse().ok()?;
        let (family, _) = full.split_once('.')?;
        let pack = *self.by_name.get(family)?;
        let recipe = pack.recipes.get(full)?;
        (recipe.major == major).then_some((pack, recipe))
    }

    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }
}

/// Resolves a document's `packs` (Document envelope: `packs: [name@version]`). An entry the
/// build lacks is `pack_missing`, naming the pack and the version; two entries of one name are
/// refused naming both IDs; a pack whose module this build lacks is `module_missing`.
pub fn resolve<'a>(
    doc: &Value,
    packs: &'a Packs,
    sealed: Option<&Sealed>,
    issues: &mut Vec<Issue>,
) -> Resolved<'a> {
    let mut out = Resolved::default();
    let Some(list) = member(doc, "packs") else {
        return out;
    };
    let Some(entries) = list.as_array() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "packs".into(),
            list.clone(),
            "not a list",
        ));
        return out;
    };
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for (i, entry) in entries.iter().enumerate() {
        let path = format!("packs/{i}");
        let Some((text, id)) = entry
            .as_str()
            .and_then(|text| Some((text, PackId::parse(text)?)))
        else {
            issues.push(Issue::envelope(
                "out_of_range",
                path,
                entry.clone(),
                "not `owner/name@version`",
            ));
            continue;
        };
        if let Some(first) = seen.get(&id.name) {
            if !packs.planted.key_by_name {
                issues.push(Issue::envelope(
                    "out_of_range",
                    path,
                    json!([first, text]),
                    &format!("a document names at most one pack of a name: `{first}` and `{text}` are both `{}`", id.name),
                ));
            }
            continue;
        }
        seen.insert(id.name.clone(), text.to_string());
        let found = if packs.planted.key_by_name {
            // Planted: a store keyed by name alone hands back the first pack of that name,
            // whoever owns it and whatever version the document names.
            packs.by_id.values().find(|p| p.id.name == id.name)
        } else {
            packs.get(&id.text())
        };
        let Some(pack) = found else {
            // A version the pack check refused for a module this build lacks: the document
            // that names it is refused the same way, naming the module.
            if let Some(missing) = packs.refused.get(&id.text()) {
                for m in missing {
                    issues.push(Issue::envelope(
                        "module_missing",
                        format!("{path}/{}", m.path),
                        m.actual.clone(),
                        &m.what,
                    ));
                }
                continue;
            }
            let mut issue = Issue::envelope(
                "pack_missing",
                path,
                json!({"pack": id.id, "version": id.version.to_string()}),
                &format!("pack `{}` at version {} is not in this build; the document is refused whole, and never drawn with another version", id.id, id.version),
            );
            // The instances that need it.
            issue.ids = member(doc, "items")
                .and_then(Value::as_object)
                .map(|items| {
                    items
                        .iter()
                        .filter(|(_, item)| {
                            super::kind_text(item)
                                .and_then(|k| k.split_once('.'))
                                .is_some_and(|(family, _)| family == id.name)
                        })
                        .map(|(item_id, _)| item_id.clone())
                        .collect()
                })
                .unwrap_or_default();
            issues.push(issue);
            continue;
        };
        for (module, range) in &pack.requires_modules {
            let Some(sealed) = sealed else { break };
            let Some(parsed) = Range::parse(range) else {
                continue;
            };
            if sealed.module(module).is_none() {
                issues.push(Issue::envelope(
                    "module_missing",
                    format!("{path}/requires/modules/{module}"),
                    json!(range),
                    &format!("pack `{text}` requires the {module} module, which this build lacks"),
                ));
            } else if !sealed.satisfies(module, &parsed) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("{path}/requires/modules/{module}"),
                    json!(range),
                    &format!("pack `{text}` requires the {module} module at {range}; this build has another"),
                ));
            }
        }
        out.by_name.insert(id.name.clone(), pack);
    }
    out
}

/// One derived item of an expansion.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Derived {
    pub id: String,
    /// The seed, from `(instance, step, index)`.
    pub seed: u64,
}

/// One instance's expansion.
#[derive(Clone, Debug, PartialEq)]
pub struct Expansion {
    pub instance: String,
    /// The instance's kind, `<pack>.<name>@<major>`.
    pub kind: String,
    /// The pack it resolved through, `owner/name@version`.
    pub pack: String,
    /// `hash(recipe@version, inputs, broken_out)`, 32 hex digits; equal expansions share it.
    pub key: String,
    pub items: Vec<Derived>,
    /// The derived items the instance writes now, as expanded, by ID.
    pub derived: Map<String, Value>,
    /// The derived IDs a patch broke out, which the instance no longer writes.
    pub broken_out: Vec<String>,
}

impl Expansion {
    pub fn to_json(&self) -> Value {
        let seeds: Map<String, Value> = self
            .items
            .iter()
            .map(|d| (d.id.clone(), json!(format!("{:016x}", d.seed))))
            .collect();
        json!({
            "instance": self.instance,
            "kind": self.kind,
            "pack": self.pack,
            "key": self.key,
            "derived": self.derived,
            "seeds": seeds,
            "broken_out": self.broken_out,
        })
    }
}

/// Expands every recipe instance of `items` in place: its params are checked against the
/// recipe's inputs and filled with defaults, and its derived items are written after it, each
/// in the instance's layer. An instance with an issue writes nothing.
pub fn expand(
    items: &mut Map<String, Value>,
    resolved: &Resolved<'_>,
    planted: Planted,
    issues: &mut Vec<Issue>,
) -> Vec<Expansion> {
    let mut out = Vec::new();
    if resolved.is_empty() {
        return out;
    }
    let instances: Vec<String> = items
        .iter()
        .filter(|(_, item)| {
            super::kind_text(item)
                .and_then(|k| resolved.recipe(k))
                .is_some()
        })
        .map(|(id, _)| id.clone())
        .collect();
    let mut order = 0u64;
    for id in instances {
        let Some(item) = items.get(&id) else { continue };
        let kind = super::kind_text(item).unwrap_or_default().to_string();
        let Some((pack, recipe)) = resolved.recipe(&kind) else {
            continue;
        };
        let Some(expansion) = expand_one(
            items,
            &id,
            item.clone(),
            pack,
            recipe,
            planted,
            &mut order,
            issues,
        ) else {
            continue;
        };
        out.push(expansion);
    }
    out
}

/// The derived items one instance expands to, without writing them: what a break-out copies.
pub fn derived_of(
    items: &Map<String, Value>,
    instance: &str,
    resolved: &Resolved<'_>,
) -> Option<Map<String, Value>> {
    let item = items.get(instance)?;
    let kind = super::kind_text(item)?;
    let (pack, recipe) = resolved.recipe(kind)?;
    let mut scratch = Map::new();
    scratch.insert(instance.to_string(), item.clone());
    // The items it broke out before, which its `broken_out` must find.
    for broken in member(item, "broken_out")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if let Some(held) = items.get(broken) {
            scratch.insert(broken.to_string(), held.clone());
        }
    }
    let mut issues = Vec::new();
    let mut order = 0;
    expand_one(
        &mut scratch,
        instance,
        item.clone(),
        pack,
        recipe,
        Planted::default(),
        &mut order,
        &mut issues,
    )?;
    scratch.shift_remove(instance);
    Some(scratch)
}

/// True when `id` is `<instance>.<step>[.<index>]` of a recipe instance in `items`: a derived
/// item, which no patch targets while the instance writes it.
pub fn is_derived(items: &Map<String, Value>, id: &str, resolved: &Resolved<'_>) -> Option<String> {
    // An item the document holds is a writer's own (a broken-out one among them): derived items
    // live only in the lowered form.
    if items.contains_key(id) {
        return None;
    }
    let mut prefix = id;
    while let Some((head, _)) = prefix.rsplit_once('.') {
        if let Some(item) = items.get(head) {
            let kind = super::kind_text(item)?;
            let (_, recipe) = resolved.recipe(kind)?;
            let broken = member(item, "broken_out")
                .and_then(Value::as_array)
                .is_some_and(|b| b.iter().any(|v| v.as_str() == Some(id)));
            return (derives(recipe, head, id) && !broken).then(|| head.to_string());
        }
        prefix = head;
    }
    None
}

/// True when `id` is `<instance>.<step>[.<index>]` for a step of `recipe`, indexed exactly
/// when the step repeats.
fn derives(recipe: &Recipe, instance: &str, id: &str) -> bool {
    let Some(rest) = id.strip_prefix(instance).and_then(|r| r.strip_prefix('.')) else {
        return false;
    };
    let (step, index) = match rest.split_once('.') {
        Some((s, i)) => (s, i.parse::<u64>().ok()),
        None => (rest, None),
    };
    recipe
        .steps
        .iter()
        .any(|s| s.id == step && matches!((&s.repeat, index), (Some(_), Some(_)) | (None, None)))
}

#[allow(clippy::too_many_arguments)]
fn expand_one(
    items: &mut Map<String, Value>,
    id: &str,
    item: Value,
    pack: &Pack,
    recipe: &Recipe,
    planted: Planted,
    order: &mut u64,
    issues: &mut Vec<Issue>,
) -> Option<Expansion> {
    let at = |field: &str| format!("items/{id}/{field}");
    let layer = member(&item, "layer").cloned().unwrap_or(Value::Null);
    // A derived item sits in the instance's layer at its order, and its position is from the
    // instance's origin.
    let order_key = member(&item, "order").cloned().unwrap_or(Value::Null);
    let origin: Option<Vec<f64>> = member(&item, "at")
        .and_then(|a| member(a, "pos"))
        .and_then(Value::as_array)
        .map(|p| p.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect());
    // The inputs: each param checked against its input, defaults filled.
    let mut inputs: Map<String, Value> = Map::new();
    let params = match member(&item, "params") {
        None => Map::new(),
        Some(Value::Object(p)) => p.clone(),
        Some(other) => {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at("params"),
                other.clone(),
                "not an object",
            ));
            return None;
        }
    };
    let mut ok = true;
    for (name, value) in &params {
        let Some(input) = recipe.inputs.get(name) else {
            issues.push(Issue::error(
                "unknown_field",
                id,
                at(&format!("params/{name}")),
                value.clone(),
                &format!("not an input of {}", recipe.id),
            ));
            ok = false;
            continue;
        };
        if let Some(what) = input_fault(input, value) {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at(&format!("params/{name}")),
                value.clone(),
                &what,
            ));
            ok = false;
        }
    }
    for (name, input) in &recipe.inputs {
        let value = params
            .get(name)
            .cloned()
            .unwrap_or_else(|| input.default.clone());
        if value.is_null() {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at(&format!("params/{name}")),
                Value::Null,
                "required, and absent",
            ));
            ok = false;
        }
        inputs.insert(name.clone(), value);
    }
    let broken_out: Vec<String> = match member(&item, "broken_out") {
        None => Vec::new(),
        Some(Value::Array(list)) => {
            let mut out = Vec::new();
            for (i, v) in list.iter().enumerate() {
                match v.as_str() {
                    Some(s) if derives(recipe, id, s) => {
                        // Broken out, so the writer holds it: a list entry with no item behind
                        // it would make the recipe's output vanish.
                        if items.contains_key(s) {
                            out.push(s.to_string());
                        } else {
                            issues.push(Issue::error(
                                "ref_unresolved",
                                id,
                                at(&format!("broken_out/{i}")),
                                v.clone(),
                                "broken out, but no item of the document holds it",
                            ));
                            ok = false;
                        }
                    }
                    _ => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("broken_out/{i}")),
                            v.clone(),
                            "not a derived ID of this instance",
                        ));
                        ok = false;
                    }
                }
            }
            out.sort();
            out
        }
        Some(other) => {
            issues.push(Issue::error(
                "out_of_range",
                id,
                at("broken_out"),
                other.clone(),
                "not a list",
            ));
            ok = false;
            Vec::new()
        }
    };
    if !ok {
        return None;
    }
    if let Some(fields) = items.get_mut(id).and_then(Value::as_object_mut) {
        fields.insert("params".into(), Value::Object(inputs.clone()));
    }
    let key = Hasher::v1("recipe.key")
        .text(&pack.id.text())
        .text(&format!("{}@{}.{}", recipe.id, recipe.major, recipe.minor))
        .bytes(&canonical(&Value::Object(inputs.clone())))
        .bytes(&canonical(&json!(broken_out)))
        .finish()
        .hex();
    let mut env: Vec<(String, Value)> =
        inputs.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (name, expr) in &recipe.lets {
        match expr.eval(&env) {
            Ok(v) => env.push((name.clone(), v)),
            Err(what) => {
                issues.push(Issue::error(
                    "out_of_range",
                    id,
                    at(&format!("params/{name}")),
                    expr.source().clone(),
                    &format!("let `{name}`: {what}"),
                ));
                return None;
            }
        }
    }
    let mut derived = Vec::new();
    let mut derived_items = Map::new();
    // One scope for every derived item: the inputs and lets, then each item's own names.
    let base = env.len();
    let mut scope = env;
    for step in &recipe.steps {
        let count: Option<u64> = match &step.repeat {
            None => None,
            Some((count, _)) => match count.eval(&scope[..base]) {
                Ok(v) => match v.as_f64() {
                    Some(n) if n.fract() == 0.0 && (0.0..=MAX_REPEAT as f64).contains(&n) => {
                        Some(n as u64)
                    }
                    _ => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/repeat", step.id)),
                            v,
                            &format!("a repeat count is a whole number from 0 to {MAX_REPEAT}"),
                        ));
                        return None;
                    }
                },
                Err(what) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat", step.id)),
                        count.source().clone(),
                        &what,
                    ));
                    return None;
                }
            },
        };
        let n = count.unwrap_or(1);
        for index in 0..n {
            let derived_id = match count {
                None => format!("{id}.{}", step.id),
                Some(_) => format!("{id}.{}.{index}", step.id),
            };
            if let Some(why) = crate::grammar::id_fault(&derived_id) {
                issues.push(Issue::error(
                    "bad_id",
                    id,
                    format!("items/{derived_id}"),
                    json!(derived_id),
                    &format!("`{derived_id}`: {why}"),
                ));
                return None;
            }
            let seed = if planted.seed_by_order {
                *order += 1;
                *order
            } else {
                seed_of(id, &step.id, count.map(|_| index))
            };
            derived.push(Derived {
                id: derived_id.clone(),
                seed,
            });
            if broken_out.contains(&derived_id) && !planted.overwrite_broken_out {
                continue;
            }
            scope.truncate(base);
            if let Some((_, as_)) = &step.repeat {
                scope.push((as_.clone(), json!(index)));
            }
            scope.push(("seed".into(), json!(seed)));
            for (name, expr) in &step.lets {
                match expr.eval(&scope) {
                    Ok(v) => scope.push((name.clone(), v)),
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/let/{name}", step.id)),
                            expr.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            let mut params = Map::new();
            for (k, v) in &step.params {
                match v.eval(&scope) {
                    Ok(v) => {
                        params.insert(k.clone(), v);
                    }
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/params/{k}", step.id)),
                            v.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            if items.contains_key(&derived_id) && !broken_out.contains(&derived_id) {
                issues.push(Issue::error(
                    "bad_id",
                    id,
                    format!("items/{derived_id}"),
                    json!(derived_id),
                    &format!(
                        "the document holds an item at the ID `{}` expands to",
                        recipe.id
                    ),
                ));
                return None;
            }
            let mut fields = Map::new();
            fields.insert("id".into(), json!(derived_id));
            fields.insert("kind".into(), json!(step.kind));
            fields.insert("layer".into(), layer.clone());
            fields.insert("name".into(), json!(derived_id));
            fields.insert("order".into(), order_key.clone());
            // A derived item hides, picks and hangs as its instance does.
            for key in ["visible", "pickable", "parent", "adjust"] {
                if let Some(v) = member(&item, key) {
                    fields.insert(key.into(), v.clone());
                }
            }
            fields.insert("params".into(), Value::Object(params));
            if let Some(at) = &step.at {
                match at.eval(&scope) {
                    Ok(mut v) => {
                        if let (Some(origin), Some(pos)) = (
                            &origin,
                            v.as_object_mut()
                                .and_then(|a| a.get_mut("pos"))
                                .and_then(Value::as_array_mut),
                        ) {
                            for (p, o) in pos.iter_mut().zip(origin) {
                                if let Some(n) = p.as_f64() {
                                    *p = number(n + o);
                                }
                            }
                        }
                        fields.insert("at".into(), v);
                    }
                    Err(what) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at_path(id, &step.id),
                            at.source().clone(),
                            &what,
                        ));
                        return None;
                    }
                }
            }
            derived_items.insert(derived_id, Value::Object(fields));
        }
    }
    // Written only once the whole expansion went through: a refused instance writes nothing.
    for (derived_id, fields) in &derived_items {
        items.insert(derived_id.clone(), fields.clone());
    }
    Some(Expansion {
        instance: id.to_string(),
        kind: super::kind_text(&item).unwrap_or_default().to_string(),
        pack: pack.id.text(),
        key,
        items: derived,
        derived: derived_items,
        broken_out,
    })
}

fn at_path(id: &str, step: &str) -> String {
    format!("items/{id}/steps/{step}/at")
}

/// The seed of a derived item: `(instance, step, index)`, so adding an item never reseeds the
/// others.
pub fn seed_of(instance: &str, step: &str, index: Option<u64>) -> u64 {
    let mut h = Hasher::v1("recipe.seed");
    h.text(instance).text(step);
    match index {
        Some(i) => h.int(i as i64),
        None => h.int(-1),
    };
    let key = h.finish();
    u64::from_le_bytes(key.0[..8].try_into().unwrap_or([0; 8]))
}

// ---- expressions ---------------------------------------------------------------------------

/// A recipe value with its expressions parsed once, at the pack check, so expansion evaluates
/// it per derived item without reading the text again (Recipe: cost).
#[derive(Clone, Debug, PartialEq)]
pub struct Template {
    source: Value,
    form: Form,
}

#[derive(Clone, Debug, PartialEq)]
enum Form {
    /// Text the grammar reads: an expression, which must evaluate, unless it is a bare name
    /// nothing binds, which is a literal such as a paint role.
    Expr(Expr),
    /// A number, a bool, null, or text the grammar doesn't read (`"a b"`, `"#fff"`).
    Literal,
    List(Vec<Template>),
    Map(Vec<(String, Template)>),
}

impl Template {
    pub fn of(value: &Value) -> Template {
        let form = match value {
            Value::String(text) => match Expr::parse(text) {
                Ok(expr) => Form::Expr(expr),
                Err(_) => Form::Literal,
            },
            Value::Array(list) => Form::List(list.iter().map(Template::of).collect()),
            Value::Object(map) => Form::Map(
                map.iter()
                    .map(|(k, v)| (k.clone(), Template::of(v)))
                    .collect(),
            ),
            _ => Form::Literal,
        };
        Template {
            source: value.clone(),
            form,
        }
    }

    /// The value as the recipe wrote it.
    pub fn source(&self) -> &Value {
        &self.source
    }

    pub fn eval(&self, scope: &[(String, Value)]) -> Result<Value, String> {
        match &self.form {
            Form::Expr(Expr::Name(name)) if !scope.iter().any(|(k, _)| k == name) => {
                Ok(self.source.clone())
            }
            Form::Expr(expr) => expr.eval(scope).map(number),
            Form::Literal => Ok(self.source.clone()),
            Form::List(list) => list
                .iter()
                .map(|t| t.eval(scope))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Form::Map(map) => {
                let mut out = Map::new();
                for (k, t) in map {
                    out.insert(k.clone(), t.eval(scope)?);
                }
                Ok(Value::Object(out))
            }
        }
    }
}

/// A whole number as an integer, so `20 * 2` is `40`, never `40.0`.
fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// An expression: numbers, names, `+ - * / %`, unary minus, parentheses and the functions
/// `min`, `max`, `floor`, `ceil`, `round` and `abs`.
#[derive(Clone, Debug, PartialEq)]
enum Expr {
    Num(f64),
    Name(String),
    Neg(Box<Expr>),
    Bin(char, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

impl Expr {
    fn parse(text: &str) -> Result<Expr, String> {
        let tokens = tokenize(text)?;
        let mut p = Parser { tokens, at: 0 };
        let e = p.sum()?;
        if p.at != p.tokens.len() {
            return Err(format!("unexpected `{}`", p.tokens[p.at]));
        }
        Ok(e)
    }

    fn eval(&self, scope: &[(String, Value)]) -> Result<f64, String> {
        Ok(match self {
            Expr::Num(n) => *n,
            Expr::Name(name) => {
                let v = scope.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v);
                match v {
                    Some(v) => match v {
                        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
                        Value::Bool(b) => f64::from(u8::from(*b)),
                        _ => return Err(format!("`{name}` is not a number")),
                    },
                    None => return Err(format!("`{name}` is not in scope")),
                }
            }
            Expr::Neg(e) => -e.eval(scope)?,
            Expr::Bin(op, a, b) => {
                let (a, b) = (a.eval(scope)?, b.eval(scope)?);
                match op {
                    '+' => a + b,
                    '-' => a - b,
                    '*' => a * b,
                    _ if b == 0.0 => return Err("division by zero".into()),
                    '/' => a / b,
                    _ => a % b,
                }
            }
            Expr::Call(name, args) => {
                let vals = args
                    .iter()
                    .map(|a| a.eval(scope))
                    .collect::<Result<Vec<_>, _>>()?;
                match (name.as_str(), vals.as_slice()) {
                    ("min", [a, b]) => a.min(*b),
                    ("max", [a, b]) => a.max(*b),
                    ("floor", [a]) => a.floor(),
                    ("ceil", [a]) => a.ceil(),
                    ("round", [a]) => a.round(),
                    ("abs", [a]) => a.abs(),
                    _ => return Err(format!("no function `{name}` of {} arguments", vals.len())),
                }
            }
        })
    }
}

fn tokenize(text: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit()
            || (c == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit))
        {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            out.push(chars[start..i].iter().collect());
        } else if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            out.push(chars[start..i].iter().collect());
        } else if "+-*/%(),".contains(c) {
            out.push(c.to_string());
            i += 1;
        } else {
            return Err(format!("unexpected `{c}`"));
        }
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<String>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.at).map(String::as_str)
    }

    fn take(&mut self) -> Option<String> {
        let t = self.tokens.get(self.at).cloned();
        self.at += 1;
        t
    }

    fn sum(&mut self) -> Result<Expr, String> {
        let mut left = self.product()?;
        while let Some(op @ ("+" | "-")) = self.peek() {
            let op = op.chars().next().unwrap_or('+');
            self.at += 1;
            let right = self.product()?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn product(&mut self) -> Result<Expr, String> {
        let mut left = self.unary()?;
        while let Some(op @ ("*" | "/" | "%")) = self.peek() {
            let op = op.chars().next().unwrap_or('*');
            self.at += 1;
            let right = self.unary()?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Expr, String> {
        if self.peek() == Some("-") {
            self.at += 1;
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Expr, String> {
        let Some(t) = self.take() else {
            return Err("expression ends early".into());
        };
        if t == "(" {
            let e = self.sum()?;
            if self.take().as_deref() != Some(")") {
                return Err("missing `)`".into());
            }
            return Ok(e);
        }
        if let Ok(n) = t.parse::<f64>() {
            return Ok(Expr::Num(n));
        }
        if t.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        {
            if self.peek() == Some("(") {
                self.at += 1;
                let mut args = Vec::new();
                if self.peek() != Some(")") {
                    loop {
                        args.push(self.sum()?);
                        match self.take().as_deref() {
                            Some(",") => continue,
                            Some(")") => break,
                            _ => return Err("missing `)`".into()),
                        }
                    }
                } else {
                    self.at += 1;
                }
                return Ok(Expr::Call(t, args));
            }
            return Ok(Expr::Name(t));
        }
        Err(format!("unexpected `{t}`"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> Vec<(String, Value)> {
        vec![("n".into(), json!(5)), ("i".into(), json!(2))]
    }

    #[test]
    fn expressions_evaluate_over_scope() {
        let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
        assert_eq!(e("i * 20 + 4"), 44.0);
        assert_eq!(e("(n - i) / 3"), 1.0);
        assert_eq!(e("-i"), -2.0);
        assert_eq!(e("max(i, n)"), 5.0);
        assert_eq!(e("7 % 3"), 1.0);
        assert!(Expr::parse("i +").is_err());
        assert!(Expr::parse("x").unwrap().eval(&scope()).is_err());
        let eval = |v: &Value, s: &[(String, Value)]| Template::of(v).eval(s);
        assert_eq!(eval(&json!("i * 2"), &scope()).unwrap(), json!(4));
        assert_eq!(
            eval(&json!(["i", 1.5, "ink", {"role": "muted"}]), &scope()).unwrap(),
            json!([2, 1.5, "ink", {"role": "muted"}])
        );
    }

    #[test]
    fn pack_ids_parse_whole_versions_only() {
        let id = PackId::parse("alice/foley@1.0.0").unwrap();
        assert_eq!((id.id.as_str(), id.name.as_str()), ("alice/foley", "foley"));
        assert_eq!(id.text(), "alice/foley@1.0.0");
        assert!(PackId::parse("alice/foley@1.0").is_none());
        assert!(PackId::parse("Alice/foley@1.0.0").is_none());
        assert!(PackId::parse("chart@1.0.0").is_none());
    }

    #[test]
    fn seeds_come_from_instance_step_and_index() {
        assert_eq!(
            seed_of("c1", "bars", Some(2)),
            seed_of("c1", "bars", Some(2))
        );
        assert_ne!(
            seed_of("c1", "bars", Some(2)),
            seed_of("c2", "bars", Some(2))
        );
        assert_ne!(
            seed_of("c1", "bars", Some(2)),
            seed_of("c1", "bars", Some(3))
        );
        assert_ne!(seed_of("c1", "bars", None), seed_of("c1", "bars", Some(0)));
    }

    fn chart_pack(wide: u32) -> Value {
        json!({
            "id": "test/chart", "name": "chart", "version": "1.0.0", "license": "MIT",
            "description": "bars",
            "requires": {"core": ">=0.0.0", "modules": {}},
            "recipes": {"chart.bars@1": {
                "id": "chart.bars", "version": "1.0",
                "inputs": {"n": {"type": "integer", "default": 3, "min": 1, "max": 12}},
                "steps": {"bars": {
                    "op": "mark", "kind": "test.rect@1",
                    "repeat": {"count": "n", "as": "i"},
                    "params": {"w": wide, "h": "40 + 8 * i"},
                    "at": {"pos": ["24 * i", 0, 0]}
                }}
            }}
        })
    }

    fn packs_with(manifest: &Value) -> Packs {
        let mut packs = Packs::default();
        packs
            .admit(manifest, &registry::core())
            .expect("the chart pack checks");
        packs
    }

    fn board(items: Value) -> Value {
        json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [640, 360], "packs": ["test/chart@1.0.0"],
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": items
        })
    }

    fn instance(id: &str, n: u32) -> Value {
        json!({"id": id, "kind": "chart.bars@1", "layer": "main", "name": id, "order": "a0",
            "params": {"n": n}, "at": {"pos": [40, 40, 0]}})
    }

    #[test]
    fn instances_expand_at_check_with_shared_keys_and_derived_items_that_draw() {
        let packs = packs_with(&chart_pack(16));
        let doc = board(json!({"c1": instance("c1", 5), "c2": instance("c2", 5)}));
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        assert!(result.ok, "{:?}", result.issues);
        let ids: Vec<String> = (0..5).map(|i| format!("c1.bars.{i}")).collect();
        let [c1, c2] = result.expansions.as_slice() else {
            panic!("two expansions, got {}", result.expansions.len())
        };
        assert_eq!(c1.derived.keys().cloned().collect::<Vec<_>>(), ids);
        assert_eq!(c1.key, c2.key, "equal inputs share the key");
        assert_eq!(c1.derived["c1.bars.2"]["params"], json!({"w": 16, "h": 56}));
        assert_eq!(c1.derived["c1.bars.2"]["at"], json!({"pos": [88, 40, 0]}));
        assert!(result.draws.contains(&"c1.bars.4".to_string()));
        assert!(
            !result.draws.contains(&"c1".to_string()),
            "the instance draws nothing itself"
        );
        // Rebuilt with the same inputs: the same IDs, bytes and seeds.
        let again = super::super::check_packed(&doc, &registry::core(), &packs);
        assert_eq!(again.expansions, result.expansions);
        // Out of range, naming n at the instance's params.
        let bad = board(json!({"c3": instance("c3", 20)}));
        let result = super::super::check_packed(&bad, &registry::core(), &packs);
        let range: Vec<_> = result
            .issues
            .iter()
            .filter(|i| i.code == "out_of_range")
            .collect();
        assert_eq!(range[0].path, "items/c3/params/n");
        assert_eq!(range[0].ids, vec!["c3"]);
        assert!(
            result.expansions.is_empty(),
            "an instance with an issue writes nothing"
        );
    }

    #[test]
    fn a_missing_pack_version_refuses_the_document_whole_and_two_of_a_name_are_refused() {
        let packs = packs_with(&chart_pack(16));
        let mut doc = board(json!({"c1": instance("c1", 5)}));
        doc["packs"] = json!(["test/chart@2.0.0"]);
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        let missing = result
            .issues
            .iter()
            .find(|i| i.code == "pack_missing")
            .expect("pack_missing");
        assert_eq!(
            missing.actual,
            json!({"pack": "test/chart", "version": "2.0.0"})
        );
        assert!(result.expansions.is_empty() && result.draws.is_empty());
        doc["packs"] = json!(["test/chart@1.0.0", "other/chart@1.0.0"]);
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        let both = result
            .issues
            .iter()
            .find(|i| i.path == "packs/1")
            .expect("refused");
        assert!(both.what.contains("test/chart@1.0.0") && both.what.contains("other/chart@1.0.0"));
        // The same version published again with other contents is refused.
        let mut packs = packs;
        let err = packs
            .admit(&chart_pack(18), &registry::core())
            .expect_err("refused");
        assert!(err[0].what.contains("never changes"));
        assert!(packs.admit(&chart_pack(16), &registry::core()).is_ok());
    }

    #[test]
    fn a_derived_item_is_no_patch_target_until_broken_out_and_undo_hands_it_back() {
        let packs = packs_with(&chart_pack(16));
        let mut doc = board(json!({"c1": instance("c1", 5), "c2": instance("c2", 5)}));
        let knows = |k: &str| {
            !matches!(
                crate::kinds::lookup(&crate::kinds::registry(), k),
                crate::kinds::Lookup::UnknownKind
            )
        };
        let writing = super::super::Writing {
            layer: "main",
            writer: "agent-a",
            you: false,
            base: None,
            knows: &knows,
            packs: Some(&packs),
        };
        let patch = |ops: Value| json!({"patch": "01J9Z00000000000000000AC96", "doc": "doc-1", "base": 0, "reason": "r", "ops": ops});
        let set = patch(
            json!([{"op": "set", "id": "c1.bars.1", "path": "items/c1.bars.1/params/w", "value": 3}]),
        );
        let err = super::super::apply_ops(&mut doc, &set, "patch", "doc-1", &writing)
            .expect_err("refused");
        assert_eq!(
            (err.code, err.ids.clone()),
            ("derived_item", vec!["c1.bars.1".to_string()])
        );
        let before = doc.clone();
        let out = patch(json!([{"op": "break_out", "instance": "c1", "item": "c1.bars.2"}]));
        let done =
            super::super::apply_ops(&mut doc, &out, "patch", "doc-1", &writing).expect("applies");
        let undo = patch(json!(done.undo(&doc)));
        let broken = doc.clone();
        assert_eq!(doc["items"]["c1"]["broken_out"], json!(["c1.bars.2"]));
        assert_eq!(
            doc["items"]["c1.bars.2"]["params"],
            json!({"w": 16, "h": 56})
        );
        assert_eq!(doc["items"]["c1.bars.2"]["layer"], json!("main"));
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        assert!(result.ok, "{:?}", result.issues);
        let c1 = &result.expansions[0];
        assert_eq!(c1.broken_out, vec!["c1.bars.2"]);
        assert!(
            !c1.derived.contains_key("c1.bars.2"),
            "the instance stops writing it"
        );
        assert_ne!(c1.key, result.expansions[1].key, "broken_out joins the key");
        // Now the writer's own: a set applies, and a change of n re-expands the others around it.
        let own = patch(
            json!([{"op": "set", "id": "c1.bars.2", "path": "items/c1.bars.2/params/w", "value": 3},
            {"op": "set", "id": "c1", "path": "items/c1/params/n", "value": 6}]),
        );
        super::super::apply_ops(&mut doc, &own, "patch", "doc-1", &writing).expect("applies");
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        assert!(result.ok, "{:?}", result.issues);
        assert_eq!(
            result.lowered["items"]["c1.bars.2"]["params"]["w"],
            json!(3)
        );
        assert!(result.expansions[0].derived.contains_key("c1.bars.5"));
        // The planted re-expansion writes over it.
        let planted = Packs {
            planted: Planted {
                overwrite_broken_out: true,
                ..Planted::default()
            },
            ..packs_with(&chart_pack(16))
        };
        let result = super::super::check_packed(&doc, &registry::core(), &planted);
        assert_eq!(
            result.lowered["items"]["c1.bars.2"]["params"]["w"],
            json!(16)
        );
        // The undo of the break-out, from `Patched::undo`, hands the item back as expanded.
        let mut doc = broken;
        super::super::apply_ops(&mut doc, &undo, "patch", "doc-1", &writing).expect("undo applies");
        assert_eq!(doc, before);
    }

    #[test]
    fn a_pack_whose_module_the_build_lacks_is_refused_naming_it_unless_planted() {
        let mut manifest = chart_pack(16);
        manifest["requires"]["modules"] = json!({"scene3d": ">=0.0.0"});
        let err =
            check_pack(&manifest, &registry::core(), Planted::default()).expect_err("refused");
        assert_eq!(err[0].code, "module_missing");
        assert!(err[0].what.contains("scene3d"));
        let planted = Planted {
            skip_requires_modules: true,
            ..Planted::default()
        };
        assert!(check_pack(&manifest, &registry::core(), planted).is_ok());
    }
}
