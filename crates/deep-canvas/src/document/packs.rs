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

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::pack_kinds::check_kinds;
use super::{member, Issue};
use crate::expr::MAX_NEST;
use crate::ops;
use crate::registry::{self, Range, Sealed, Semver};
use crate::schedule::{canonical, Hasher};

pub mod deps;
pub mod module_fields;
pub mod retired;

/// The most derived items one repeat makes (Recipe: cost).
pub const MAX_REPEAT: u64 = 1024;

/// The planted wrong programs of #306's and #202's acceptance criteria, each off by default.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    /// #202: the `kind_rules` check evaluates a pack kind's recipe rules a second time.
    pub rules_twice: bool,
    /// #202: the kind kit tests each kind at its defaults only, never at its params' extremes.
    pub kit_defaults_only: bool,
    /// #202: an expander that walks an instance's inputs in this order, not the recipe's. The
    /// core holds no hash map (canvas lint), so the caller plants one.
    pub walk_inputs: Option<WalkInputs>,
    /// Seeds derived items by expansion order, not by `(instance, step, index)`.
    pub seed_by_order: bool,
    /// A re-expansion writes over a broken-out item.
    pub overwrite_broken_out: bool,
    /// The pack check admits a pack without reading `requires.modules`.
    pub skip_requires_modules: bool,
    /// Packs resolve by name alone, so the first pack listed wins a name.
    pub key_by_name: bool,
    /// #2015: a repeat over elements seeds each item with the part's element count too.
    pub each_by_count: bool,
    /// #2015: a repeat over faces walks the part's triangles (the elements function's plant).
    pub each_per_triangle: bool,
    /// #1956: the pack check of a kind's migration stops at its first fault.
    pub migration_first_fault: bool,
    /// #1961: a load under a version that no longer derives a broken-out ID drops the item.
    pub orphan_drops: bool,
    /// #1961: that load hands the broken-out ID to the new expansion, which writes it.
    pub orphan_hands_id: bool,
}

/// A planted expander's walk over an instance's inputs (#202).
pub type WalkInputs = fn(Map<String, Value>) -> Map<String, Value>;

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
    /// A repeat along a curve (#420): the curve (an input naming a `curve@1` item, or literal
    /// points) and the spacing that counts the copies when no count does.
    pub along: Option<(Template, Option<Template>)>,
    /// A repeat over the elements of a builder's named part (#2015): the `ID` input that holds
    /// the builder item, the part and the domain.
    pub each: Option<Each>,
    /// Its condition, over the recipe's inputs and lets: false leaves the step out (#420).
    pub when: Option<Template>,
    /// The material its items name (Recipe: a step's `material`; #429).
    pub material: Option<Value>,
    /// Its own channels, each targeting a field of its items (`params/size/0`), written into the
    /// document as `<item>.<channel>` as it expands (#429).
    pub channels: Vec<(String, Value)>,
}

/// What a repeat over elements reads (Recipe: repeat over elements): `part` is
/// `<input>#<part>`, the input an `ID` input holding a builder item of the document.
#[derive(Clone, Debug, PartialEq)]
pub struct Each {
    pub input: String,
    pub part: String,
    pub domain: String,
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
    /// Its channels, each targeting a step (`step:<id>/<field>…`), written into the document
    /// with derived targets when it expands (#420).
    pub channels: Vec<(String, Value)>,
    /// Its kind rules (#490), read by the core's `kind_rules` check at rest: each instance
    /// whose params make one read 0 raises the rule's code.
    pub rules: Vec<KindRule>,
}

/// A recipe's kind rule: `<pack>.<rule>`, an expression of the closed function list over the
/// recipe's inputs that holds where it reads anything but 0, and its fix.
#[derive(Clone, Debug, PartialEq)]
pub struct KindRule {
    pub code: String,
    pub expr: crate::expr::Expr,
    pub at: At,
    pub fix: String,
}

/// When a kind rule reads its instance (Pack: kind rules): at rest, at each of its times in
/// flicks, or bounded over a sweep.
#[derive(Clone, Debug, PartialEq)]
pub enum At {
    Rest,
    Times(Vec<i64>),
    Sweep,
}

/// The issue code a failed kind rule raises; its JSON names the rule's own code.
pub const KIND_RULE: &str = "kind_rule";

/// A param's number as a rule reads it: a bool as 0 or 1, anything else NaN.
pub(super) fn rule_number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(v)) => v.as_f64().unwrap_or(f64::NAN),
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        _ => f64::NAN,
    }
}

impl KindRule {
    /// Whether the rule holds for an instance's inputs.
    pub(super) fn holds(&self, inputs: &Map<String, Value>) -> bool {
        let vars: Vec<f64> = self
            .expr
            .vars
            .iter()
            .map(|n| rule_number(inputs.get(n)))
            .collect();
        let v = self.expr.eval_num(&vars);
        v.is_finite() && v != 0.0
    }
}

/// What a kind rule's expression resolves through: the build's `ease@1`, when it has one.
pub(super) struct RuleScope<'a>(pub(super) &'a Sealed);

impl crate::expr::Resolve for RuleScope<'_> {
    fn eases(&self) -> Result<(), String> {
        match self.0.registry("ease@1") {
            Some(_) => Ok(()),
            None => Err(registry::EASES_OUTSIDE_CORE.to_string()),
        }
    }
}

/// How deep recipes nest: a recipe step four recipes down is the last (#420).
pub const MAX_DEPTH: usize = 4;

/// An admitted pack version.
#[derive(Clone, Debug, PartialEq)]
pub struct Pack {
    pub id: PackId,
    pub requires_modules: BTreeMap<String, String>,
    /// `requires.packs`: each pack it builds on, at an exact version (#1957).
    pub requires_packs: Vec<deps::Dep>,
    /// By `pack.name`.
    pub recipes: BTreeMap<String, Recipe>,
    /// `d1:` SHA-256 of the manifest's canonical form: a version's bytes, frozen.
    pub digest: String,
    /// The entries it fills into registries the build declares, each admitted by its registry's
    /// kit at the pack check (#200).
    pub entries: Vec<registry::lists::SealedEntry>,
    /// A familiar-names pack's words (Pack: math@1's `aliases`): each word, the kind it maps to
    /// and the conversion the pack states for it, `{target, conversion, renamed_from?}`, by word.
    pub aliases: BTreeMap<String, Value>,
    /// Its kinds backed by recipes, by `<pack>.<name>@<major>`, each with its kit's result (#202).
    pub kinds: BTreeMap<String, super::pack_kinds::PackKind>,
}

/// The step ops this slice expands: a mark or an item of a kind the build registers.
const STEP_OPS: &[&str] = &["mark", "item", "builder", "recipe"];
/// The input types this slice reads.
const INPUT_TYPES: &[&str] = &[
    "number", "integer", "bool", "choice", "vec3", "range", "text", "ID", "records", "record",
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
        || sealed
            .kinds_ref()
            .entries()
            .iter()
            .any(|e| e.family == id.name)
    {
        issues.push(bad(
            "name",
            json!(id.name),
            "a canvas module's name or kind family; a pack names its own",
        ));
    }
    let (mut requires_modules, mut requires_packs) = (BTreeMap::new(), Vec::new());
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
                        "packs" => requires_packs = deps::read(value, &id, &mut issues),
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
    deps::undeclared(manifest, &id, &requires_packs, &mut issues);
    // Providers, layouts' validators and program entries are programs the sandbox module admits
    // and runs (#238): a build without it refuses them, whatever `requires.modules` says.
    for key in ["providers", "layouts"] {
        if fields.contains_key(key) && sealed.module(SANDBOX).is_none() {
            issues.push(Issue::envelope(
                "module_missing",
                key.into(),
                json!({"module": SANDBOX}),
                &format!("pack `{}`'s {key} are programs the sandbox module runs, which this build lacks", id.text()),
            ));
        }
    }
    let assets = fields
        .get("assets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let entries = match fields.get("entries") {
        None => Vec::new(),
        Some(e) => check_entries(&id, e, &assets, sealed, &mut issues),
    };
    let aliases = match fields.get("aliases") {
        None => BTreeMap::new(),
        Some(a) => check_aliases(a, &mut issues),
    };
    let kinds = check_kinds(
        &id,
        fields,
        &recipes,
        &assets,
        (sealed, planted),
        &mut issues,
    );
    for key in fields.keys().filter(|k| !PACK_KEYS.contains(&k.as_str())) {
        issues.extend(module_fields::check(sealed, manifest, key));
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Pack {
        id,
        requires_modules,
        requires_packs,
        recipes,
        digest: digest(manifest),
        entries,
        aliases,
        kinds,
    })
}

/// A pack's `aliases`: each word maps to a kind as `name@major`, with the conversion the pack
/// states as text; anything else is refused at `aliases/<word>`, so no mapping is inferred.
fn check_aliases(aliases: &Value, issues: &mut Vec<Issue>) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let Some(words) = aliases.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "aliases".into(),
            aliases.clone(),
            "not an object",
        ));
        return out;
    };
    for (word, alias) in words {
        let target = alias.get("target").and_then(Value::as_str);
        let conversion = alias.get("conversion").and_then(Value::as_str);
        let keys_ok = alias.as_object().is_some_and(|a| {
            a.keys()
                .all(|k| matches!(k.as_str(), "target" | "conversion" | "renamed_from"))
        });
        match (target.and_then(crate::kinds::parse_kind), conversion) {
            (Some(_), Some(_)) if keys_ok => {
                out.insert(word.clone(), alias.clone());
            }
            _ => issues.push(Issue::envelope(
                "out_of_range",
                format!("aliases/{word}"),
                alias.clone(),
                "an alias is {target: name@major, conversion: text, renamed_from?}",
            )),
        }
    }
    out
}

/// A pack's registry entries (Registry and seal: registries), each checked at the pack check: in
/// a registry the build declares that packs may fill, named `<pack>.<name>` so it never takes a
/// first-party name, meeting the entry schema and passing the registry's kit. Each refusal is an
/// issue at `entries/<registry>`, naming the registry and the entry.
fn check_entries(
    id: &PackId,
    entries: &Value,
    assets: &[Value],
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
) -> Vec<registry::lists::SealedEntry> {
    let mut out = Vec::new();
    let Some(by_registry) = entries.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "entries".into(),
            entries.clone(),
            "not an object",
        ));
        return out;
    };
    let pack = id.text();
    for (name, list) in by_registry {
        let path = format!("entries/{name}");
        let refuse = |actual: Value, what: String| {
            Issue::envelope("out_of_range", path.clone(), actual, &what)
        };
        let Some(reg) = sealed.registry(name) else {
            issues.push(refuse(
                json!({"registry": name}),
                format!("this build declares no registry `{name}`"),
            ));
            continue;
        };
        if !reg.def.fill.contains(&"pack") {
            issues.push(refuse(
                json!({"registry": name, "fill": reg.def.fill}),
                format!(
                    "`{name}` is filled by {} (fill: {}); a pack adds no entry to it",
                    reg.def.fill.join(", "),
                    reg.def.fill.join(" | ")
                ),
            ));
            continue;
        }
        if reg.def.program.is_some() && sealed.module(SANDBOX).is_none() {
            issues.push(Issue::envelope(
                "module_missing",
                path.clone(),
                json!({"registry": name, "module": SANDBOX}),
                &format!("the entries of `{name}` are programs the sandbox module admits and runs, which this build lacks"),
            ));
            continue;
        }
        let Some(list) = list.as_array() else {
            issues.push(refuse(list.clone(), "not a list of entries".into()));
            continue;
        };
        for value in list {
            let Some(entry) = value.get("name").and_then(Value::as_str) else {
                issues.push(refuse(
                    value.clone(),
                    format!("an entry of `{name}` has no name"),
                ));
                continue;
            };
            let own = format!("{}.", id.name);
            if !entry.starts_with(&own) {
                let what = match reg.entry(entry) {
                    Some(first) => format!(
                        "`{entry}` would take the first-party entry `{entry}` of `{name}` (`{}`'s); a pack's entry is named `{}{entry}`",
                        first.module, own
                    ),
                    None => format!("a pack's entry is named `<pack>.<name>`: `{}{entry}`, not `{entry}`", own),
                };
                issues.push(refuse(json!({"registry": name, "entry": entry}), what));
                continue;
            }
            if out
                .iter()
                .any(|e: &registry::lists::SealedEntry| e.registry == *name && e.name == entry)
            {
                issues.push(refuse(
                    json!({"registry": name, "entry": entry}),
                    format!("`{name}` has two entries named `{entry}`"),
                ));
                continue;
            }
            if let Some(why) = registry::lists::schema_fault(&reg.def.entry, value, "") {
                issues.push(refuse(
                    json!({"registry": name, "entry": entry, "rules": ["entry_schema"]}),
                    format!("`{entry}` doesn't meet `{name}`'s entry schema: {why}"),
                ));
                continue;
            }
            // A program entry's kit reads the program's bytes, from the pack's asset of its hash.
            let judged = match reg.def.program {
                None => value.clone(),
                Some(_) => {
                    let sha = value
                        .get("program")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let Some(hex) = assets
                        .iter()
                        .find(|a| a.get("sha256").and_then(Value::as_str) == Some(sha))
                        .and_then(|a| a.get("hex"))
                    else {
                        issues.push(refuse(
                            json!({"registry": name, "entry": entry, "program": sha}),
                            format!("`{entry}`'s program `{sha}` is none of the pack's assets"),
                        ));
                        continue;
                    };
                    let mut v = value.clone();
                    v["wasm"] = hex.clone();
                    v
                }
            };
            let kit = reg.def.run_kit(entry, &judged);
            if !kit.pass() {
                let why: Vec<String> = kit
                    .rules
                    .iter()
                    .filter(|r| !r.pass)
                    .map(|r| format!("{}: {}", r.rule, r.why))
                    .collect();
                issues.push(refuse(
                    json!({"registry": name, "entry": entry, "rules": kit.failed()}),
                    format!("`{entry}` fails `{name}`'s kit: {}", why.join("; ")),
                ));
                continue;
            }
            out.push(registry::lists::SealedEntry {
                name: entry.to_string(),
                registry: name.clone(),
                origin: "pack",
                module: String::new(),
                pack: pack.clone(),
                value: value.clone(),
                since: id.version.to_string(),
                digest: registry::lists::entry_digest(name, entry, value, &id.version.to_string()),
                twin: reg.def.twin.map(|t| t(entry, value)),
                kit,
            });
        }
    }
    out
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
    "entries",
    "aliases",
    "assets",
    "providers",
    "layouts",
    "kinds",
    "corpus",
];

/// The canvas module that admits and runs a pack's programs (#238).
const SANDBOX: &str = "sandbox";

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
    "channels",
    "rules",
    "twins",
];
/// A step's keys in this slice.
const STEP_KEYS: &[&str] = &[
    "op", "kind", "params", "at", "material", "repeat", "let", "when", "channels",
];

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
                            "modifiers" | "steps" => "lands with 3D scenes, not this slice",
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
                    let what = "not a step op of this slice (mark, item, builder, recipe)";
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
                // What a count, spacing or condition may read: the recipe's inputs and lets,
                // fixed at check, never `t`.
                let unfixed = |v: &Value| {
                    Template::of(v)
                        .reads()
                        .0
                        .iter()
                        .any(|n| !inputs.contains_key(n) && !lets.iter().any(|(l, _)| l == n))
                };
                let mut along = None;
                let mut each = None;
                let repeat = match s.get("repeat") {
                    None => None,
                    Some(r) => {
                        let mut count = member(r, "count").cloned();
                        let as_ = member(r, "as").and_then(Value::as_str);
                        let keys: Vec<&String> = r
                            .as_object()
                            .map(|o| o.keys().collect())
                            .unwrap_or_default();
                        if keys.iter().any(|k| {
                            !["count", "as", "along", "spacing", "each"].contains(&k.as_str())
                        }) {
                            issues.push(bad(&format!("{at}/repeat"), r.clone(), "a repeat is `{count, as}`, `{along, count | spacing, as}` or `{each: {part, domain}, as}`; over, on and pack land later"));
                            continue;
                        }
                        if let Some(e) = member(r, "each") {
                            // The part: `<input>#<part>`, an ID input holding a builder item.
                            let part = member(e, "part").and_then(Value::as_str);
                            let split = part.and_then(|p| p.split_once('#'));
                            let domain = member(e, "domain").and_then(Value::as_str);
                            let input_ok = split.is_some_and(|(n, p)| {
                                !p.is_empty() && inputs.get(n).is_some_and(|i| i.ty == "ID")
                            });
                            let fields_ok = e
                                .as_object()
                                .is_some_and(|o| o.keys().all(|k| k == "part" || k == "domain"));
                            match (split, domain) {
                                (Some((n, p)), Some(d))
                                    if input_ok
                                        && fields_ok
                                        && ["face", "point", "curve"].contains(&d)
                                        && keys.len() == 2 =>
                                {
                                    each = Some(Each {
                                        input: n.to_string(),
                                        part: p.to_string(),
                                        domain: d.to_string(),
                                    });
                                    count = Some(json!(0));
                                }
                                _ => {
                                    issues.push(bad(&format!("{at}/repeat/each"), e.clone(), &format!("step `{step_id}` repeats over `{{part: \"<input>#<part>\", domain: face | point | curve}}`, its input an ID input of the recipe, beside `as` alone")));
                                    continue;
                                }
                            }
                        }
                        if let Some(path) = member(r, "along") {
                            let spacing = member(r, "spacing");
                            // The curve: an input that names a `curve@1` item, or points.
                            let curve_ok = match path {
                                Value::String(n) => inputs.contains_key(n),
                                Value::Array(points) => points.len() >= 2,
                                _ => false,
                            };
                            if !curve_ok {
                                issues.push(bad(&format!("{at}/repeat/along"), path.clone(), &format!("step `{step_id}` repeats along an input that names a curve, or two or more points")));
                                continue;
                            }
                            match (&count, spacing) {
                                (Some(_), None) => {}
                                (None, Some(sp)) if !unfixed(sp) => count = Some(json!(0)),
                                (None, Some(sp)) => {
                                    issues.push(bad(&format!("{at}/repeat/spacing"), sp.clone(), &format!("step `{step_id}` spaces its copies by more than the recipe's inputs and lets, so no check can fix their count")));
                                    continue;
                                }
                                _ => {
                                    issues.push(bad(&format!("{at}/repeat"), r.clone(), &format!("step `{step_id}` repeats along a curve by a count or a spacing, one of them")));
                                    continue;
                                }
                            }
                            along = Some((Template::of(path), spacing.map(Template::of)));
                        }
                        match (count, as_) {
                            // A count is fixed at check (Recipe: "repeats have counts fixed at
                            // check"): it reads only the recipe's inputs and lets, never `t`.
                            (Some(c), Some(_))
                                if Template::of(&c).reads().0.iter().any(|n| {
                                    !inputs.contains_key(n) && !lets.iter().any(|(l, _)| l == n)
                                }) =>
                            {
                                issues.push(bad(
                                    &format!("{at}/repeat/count"),
                                    c.clone(),
                                    &format!("step `{step_id}` repeats by a count that reads more than the recipe's inputs and lets, so no check can fix it"),
                                ));
                                continue;
                            }
                            (Some(c), Some(a)) if well_named(a) => {
                                Some((Template::of(&c), a.to_string()))
                            }
                            _ => {
                                issues.push(bad(
                                    &format!("{at}/repeat"),
                                    r.clone(),
                                    &format!("step `{step_id}`'s repeat is `{{count, as}}`: one without a count has no count fixed at check"),
                                ));
                                continue;
                            }
                        }
                    }
                };
                let when = match s.get("when") {
                    None => None,
                    Some(w) if unfixed(w) => {
                        issues.push(bad(&format!("{at}/when"), w.clone(), &format!("step `{step_id}`'s condition reads more than the recipe's inputs and lets, so no check can fix it")));
                        continue;
                    }
                    Some(w) => Some(Template::of(w)),
                };
                let step_lets = read_lets(s.get("let"), &format!("{path}/{at}/let"), &mut issues);
                let material = match s.get("material") {
                    None => None,
                    Some(m @ Value::String(_)) => Some(m.clone()),
                    Some(other) => {
                        issues.push(bad(&format!("{at}/material"), other.clone(), "not an ID"));
                        continue;
                    }
                };
                // Its own channels target a field of each item it makes.
                let mut own = Vec::new();
                match s.get("channels") {
                    None => {}
                    Some(Value::Object(map)) => {
                        for (name, c) in map {
                            let target = member(c, "target").and_then(Value::as_str);
                            if well_named(name) && target.is_some_and(|t| !t.is_empty()) {
                                own.push((name.clone(), c.clone()));
                            } else {
                                issues.push(bad(
                                    &format!("{at}/channels/{name}/target"),
                                    json!(target),
                                    "a step's channel targets a field of the items it makes",
                                ));
                            }
                        }
                    }
                    Some(other) => {
                        issues.push(bad(
                            &format!("{at}/channels"),
                            other.clone(),
                            "not an object",
                        ));
                    }
                }
                steps.push(Step {
                    id: step_id.clone(),
                    op: op.to_string(),
                    kind: kind.to_string(),
                    params,
                    at: s.get("at").map(Template::of),
                    lets: step_lets,
                    repeat,
                    along,
                    each,
                    when,
                    material,
                    channels: own,
                });
            }
        }
        Some(other) => issues.push(bad("steps", other.clone(), "not an object")),
    }
    // Its channels target its steps; each is written into the document as it expands.
    let mut channels = Vec::new();
    match fields.get("channels") {
        None => {}
        Some(Value::Object(map)) => {
            for (name, c) in map {
                let target = member(c, "target")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let step = target
                    .strip_prefix("step:")
                    .and_then(|t| t.split_once('/'))
                    .map(|(s, _)| s);
                if !well_named(name) || !step.is_some_and(|s| steps.iter().any(|x| x.id == s)) {
                    issues.push(bad(
                        &format!("channels/{name}/target"),
                        json!(target),
                        "a recipe's channel targets one of its steps: `step:<id>/<field>…`",
                    ));
                    continue;
                }
                channels.push((name.clone(), c.clone()));
            }
        }
        Some(other) => issues.push(bad("channels", other.clone(), "not an object")),
    }
    let rules = read_rules(pack, fields, &inputs, sealed, path, &mut issues);
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
        channels,
        rules,
    })
}

/// A recipe's kind rules, each `{code: "<pack>.<rule>", expr, at: "rest", fix}`, and the kind
/// kit's planted twin per rule, `twins: [{params, expect: code}]`: an instance's params that must
/// fail it. A rule whose twin passes it, or with no twin, is refused.
fn read_rules(
    pack: &str,
    fields: &Map<String, Value>,
    inputs: &BTreeMap<String, Input>,
    sealed: &Sealed,
    path: &str,
    issues: &mut Vec<Issue>,
) -> Vec<KindRule> {
    let bad = |at: &str, actual: Value, what: &str| {
        Issue::envelope("out_of_range", format!("{path}/{at}"), actual, what)
    };
    let rules = match fields.get("rules") {
        None => return Vec::new(),
        Some(list) => read_rule_list(
            pack,
            list,
            inputs,
            sealed,
            &format!("{path}/rules"),
            false,
            issues,
        ),
    };
    // The kind kit: each rule's planted twin must fail it.
    let twins = fields
        .get("twins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for rule in &rules {
        let mine: Vec<&Value> = twins
            .iter()
            .filter(|t| t.get("expect").and_then(Value::as_str) == Some(rule.code.as_str()))
            .collect();
        if mine.is_empty() {
            issues.push(bad(
                "twins",
                json!(rule.code),
                &format!("rule `{}` has no planted twin for the kind kit", rule.code),
            ));
        }
        for twin in mine {
            let mut values: Map<String, Value> = inputs
                .iter()
                .map(|(n, i)| (n.clone(), i.default.clone()))
                .collect();
            for (k, v) in twin
                .get("params")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                values.insert(k.clone(), v.clone());
            }
            if rule.holds(&values) {
                issues.push(bad(
                    "twins",
                    twin.clone(),
                    &format!("the kind kit admits rule `{}`'s planted twin", rule.code),
                ));
            }
        }
    }
    rules
}

/// A list of kind rules at `path`, each `{code: "<pack>.<rule>", expr, at, fix}` over `inputs`.
/// A recipe's rules read their instance at rest (#490); a pack kind's also at `[time]` (each a
/// count of flicks or a time literal in seconds) or over a `sweep` (#202).
pub(super) fn read_rule_list(
    pack: &str,
    list: &Value,
    inputs: &BTreeMap<String, Input>,
    sealed: &Sealed,
    path: &str,
    timed: bool,
    issues: &mut Vec<Issue>,
) -> Vec<KindRule> {
    let bad = |at: &str, actual: Value, what: &str| {
        Issue::envelope("out_of_range", format!("{path}/{at}"), actual, what)
    };
    let mut rules = Vec::new();
    let Some(list) = list.as_array() else {
        issues.push(Issue::envelope(
            "out_of_range",
            path.to_string(),
            list.clone(),
            "not a list of rules",
        ));
        return rules;
    };
    for (i, r) in list.iter().enumerate() {
        let at = format!("{i}");
        let code = r.get("code").and_then(Value::as_str).unwrap_or_default();
        if !code
            .strip_prefix(&format!("{pack}."))
            .is_some_and(well_named)
        {
            issues.push(bad(
                &format!("{at}/code"),
                json!(code),
                &format!("a kind rule's code is `{pack}.<rule>`"),
            ));
            continue;
        }
        let when = match r.get("at") {
            Some(Value::String(s)) if s == "rest" => At::Rest,
            Some(Value::String(s)) if timed && s == "sweep" => At::Sweep,
            Some(Value::Array(times)) if timed && !times.is_empty() => {
                match times.iter().map(rule_time).collect::<Option<Vec<i64>>>() {
                    Some(t) => At::Times(t),
                    None => {
                        issues.push(bad(
                            &format!("{at}/at"),
                            json!(times),
                            "a time is a count of flicks or seconds such as `1.5s`",
                        ));
                        continue;
                    }
                }
            }
            other => {
                issues.push(bad(
                    &format!("{at}/at"),
                    other.cloned().unwrap_or(Value::Null),
                    if timed {
                        "a kind rule reads its instance at rest, at a list of times or over a sweep"
                    } else {
                        "a kind rule reads its instance at rest"
                    },
                ));
                continue;
            }
        };
        let Some(text) = r.get("expr").and_then(Value::as_str) else {
            issues.push(bad(
                &format!("{at}/expr"),
                r.get("expr").cloned().unwrap_or(Value::Null),
                "a kind rule's expr is text",
            ));
            continue;
        };
        let expr = match crate::expr::Expr::compile(text, &RuleScope(sealed), 256) {
            Ok(e) => e,
            Err(e) => {
                let actual = json!({"rule": code, "call": e.call, "module": e.missing});
                issues.push(match &e.missing {
                    Some(module) => Issue::envelope(
                        "module_missing",
                        format!("{path}/{at}/expr"),
                        actual,
                        &format!("rule `{code}` reads `{}`, and ease@1 is the `{module}` module's, which this build lacks", e.call),
                    ),
                    None => bad(&format!("{at}/expr"), actual, &e.why),
                });
                continue;
            }
        };
        if let Some(n) = expr.vars.iter().find(|n| !inputs.contains_key(*n)) {
            issues.push(bad(
                &format!("{at}/expr"),
                json!(text),
                &format!("rule `{code}` reads `{n}`, which is no input of the recipe"),
            ));
            continue;
        }
        rules.push(KindRule {
            code: code.to_string(),
            expr,
            at: when,
            fix: r
                .get("fix")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
    }
    rules
}

/// A pack kind's rule time: a count of flicks, or a time literal in seconds.
fn rule_time(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => crate::grammar::Time::parse(s)
            .ok()?
            .resolve(&crate::grammar::TimeContext::default())
            .ok(),
        _ => None,
    }
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
pub(super) fn input_fault(input: &Input, value: &Value) -> Option<String> {
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
        // A list of rows, such as points, and one row, such as another tool's mesh (#433).
        "records" => (!value.is_array()).then(|| "not a list".to_string()),
        "record" => (!value.is_object()).then(|| "not an object".to_string()),
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
    /// The versions uninstalled while something names them: kept, and taking no new instance.
    retired: BTreeSet<String>,
    pub planted: Planted,
}

impl Packs {
    pub fn new(planted: Planted) -> Packs {
        Packs {
            planted,
            ..Packs::default()
        }
    }

    /// Holds `pack` as admitted, unchecked: the kind kit's own store of the pack it checks.
    pub(super) fn insert(&mut self, pack: Pack) {
        self.by_id.insert(pack.id.text(), pack);
    }

    /// Takes back an admitted version a later half of its pack check refused (#238: its programs).
    pub fn withdraw(&mut self, key: &str) {
        self.by_id.remove(key);
        self.retired.remove(key);
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
        // The pack check, its place in the pack graph (#1957), then each kind's kit (#202), which
        // checks documents of the pack beside the versions it requires.
        let checked = check_pack(manifest, sealed, self.planted).and_then(|mut pack| {
            deps::cycle(self, &pack)?;
            if !pack.kinds.is_empty() {
                let alone = deps::store(self, &pack);
                super::pack_kinds::kit(&mut pack, sealed, alone)?;
            }
            Ok(pack)
        });
        let pack = match checked {
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

    /// Admits a version this process's check admitted before, as it was, without checking again.
    pub fn readmit(&mut self, pack: Pack) -> &Pack {
        self.by_id.entry(pack.id.text()).or_insert(pack)
    }

    /// How often the pack check has run for `owner/name@version`.
    pub fn checks(&self, id: &str) -> u32 {
        self.checks.get(id).copied().unwrap_or(0)
    }

    /// The admitted pack at `owner/name@version`.
    pub fn get(&self, id: &str) -> Option<&Pack> {
        self.by_id.get(id)
    }

    /// Every admitted pack, by ID.
    pub fn all(&self) -> impl Iterator<Item = &Pack> {
        self.by_id.values()
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
    pub(super) by_name: BTreeMap<String, &'a Pack>,
    /// The sealed modules' elements functions by builder kind (`family.name`), which a repeat
    /// over elements counts by (#2015).
    elements: BTreeMap<String, registry::Elements>,
    /// The listed versions this build lacks, whose instances are kept and skipped (#1958).
    pub missing: Vec<retired::Missing>,
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
        // A pack kind resolves to the recipe that backs it (#202).
        if let Some(k) = pack.kinds.get(kind) {
            return pack.recipes.get(&k.recipe).map(|r| (pack, r));
        }
        let recipe = pack.recipes.get(full)?;
        (recipe.major == major).then_some((pack, recipe))
    }

    /// The pack kind `<pack>.<name>@<major>` names, if its pack declares one (#202).
    pub fn kind(&self, kind: &str) -> Option<&'a super::pack_kinds::PackKind> {
        let (family, _) = kind.split_once('.')?;
        self.by_name.get(family)?.kinds.get(kind)
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
    if let Some(sealed) = sealed {
        for m in &sealed.modules {
            for (kind, f) in &m.shapes.elements {
                out.elements.entry(kind.clone()).or_insert(*f);
            }
        }
    }
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
    let (mut seen, mut listed) = (BTreeMap::new(), BTreeMap::new());
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
            // The document still opens: the instances that need it are kept and skipped (#1958).
            out.missing.push(retired::Missing {
                pack: id.id.clone(),
                name: id.name.clone(),
                version: id.version.to_string(),
                path,
                ids: deps::instances(doc, &id.name),
            });
            continue;
        };
        deps::modules(pack, text, &path, sealed, issues);
        listed.insert(id.name.clone(), path);
        out.by_name.insert(id.name.clone(), pack);
    }
    // What the listed packs require, as if the document listed it (#1957).
    deps::close(&mut out, &listed, doc, packs, sealed, issues);
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
    /// Each `broken_out` entry, by its index there, that this version no longer derives: the
    /// writer's own item, raised as `derived_orphan` (Pack: migrations as data; #1961).
    pub orphaned: Vec<(usize, String)>,
    /// The recipe's channels, each targeting a derived item, by `<instance>.<channel>[.<k>]`.
    pub channels: Map<String, Value>,
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
            "channels": self.channels,
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
            (pack, recipe),
            resolved,
            std::slice::from_ref(&recipe.id),
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

/// A channel or driver of `doc` on an instance's input that one of its recipe's repeat counts
/// reads: the count would change while playing, so it is no longer fixed at check (Recipe:
/// "repeats have counts fixed at check"; #420).
pub fn driven_counts(
    doc: &Value,
    items: &Map<String, Value>,
    resolved: &Resolved<'_>,
) -> Vec<Issue> {
    let mut out = Vec::new();
    if resolved.is_empty() {
        return out;
    }
    for (id, item) in items {
        let Some((_, recipe)) = super::kind_text(item).and_then(|k| resolved.recipe(k)) else {
            continue;
        };
        let counted: BTreeSet<String> = recipe
            .steps
            .iter()
            .filter_map(|s| s.repeat.as_ref())
            .flat_map(|(count, _)| count.names())
            .filter(|n| recipe.inputs.contains_key(n))
            .collect();
        for section in ["channels", "drivers"] {
            for (cid, c) in member(doc, section)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                let Some(target) = member(c, "target").and_then(Value::as_str) else {
                    continue;
                };
                let hit = counted.iter().find(|n| {
                    let at = format!("items/{id}/params/{n}");
                    target == at || target.starts_with(&format!("{at}/"))
                });
                if let Some(n) = hit {
                    out.push(Issue::error(
                        "out_of_range",
                        id,
                        format!("{section}/{cid}/target"),
                        json!(target),
                        &format!("`{target}` drives `{n}`, which a repeat of `{}` counts by: a count is fixed at check, so no channel or driver may move it", recipe.id),
                    ));
                }
            }
        }
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
        (pack, recipe),
        resolved,
        std::slice::from_ref(&recipe.id),
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

/// Points a curve value gives: literal `[[x, y, z]…]`, or a `curve@1` item's points by ID.
fn curve_points(items: &Map<String, Value>, v: &Value) -> Option<Vec<[f64; 3]>> {
    let list = match v {
        Value::String(id) => member(items.get(id)?, "params")
            .and_then(|p| member(p, "points"))?
            .as_array()?,
        Value::Array(list) => list,
        _ => return None,
    };
    let points: Option<Vec<[f64; 3]>> = list
        .iter()
        .map(|p| {
            let a = p.as_array().filter(|a| a.len() == 3)?;
            Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
        })
        .collect();
    points.filter(|p| p.len() >= 2)
}

/// The point at arc length `s` along a polyline and its yaw (degrees about +Y that turn +X to
/// its direction there).
fn along_at(points: &[[f64; 3]], s: f64) -> ([f64; 3], f64) {
    let mut left = s.max(0.0);
    for (k, w) in points.windows(2).enumerate() {
        let d = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]];
        let len = crate::ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        if left <= len || k + 2 == points.len() {
            let f = if len > 0.0 {
                (left / len).min(1.0)
            } else {
                0.0
            };
            let yaw = crate::ops::deg(crate::ops::atan2(-d[2], d[0]));
            return (
                [w[0][0] + d[0] * f, w[0][1] + d[1] * f, w[0][2] + d[2] * f],
                yaw,
            );
        }
        left -= len;
    }
    (points[0], 0.0)
}

fn polyline_length(points: &[[f64; 3]]) -> f64 {
    points
        .windows(2)
        .map(|w| {
            let d = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]];
            crate::ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
        })
        .sum()
}

/// Truthy: a non-zero number, `true`, or anything but null and `false`.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(false) => false,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        _ => true,
    }
}

#[allow(clippy::too_many_arguments)]
fn expand_one(
    items: &mut Map<String, Value>,
    id: &str,
    item: Value,
    (pack, recipe): (&Pack, &Recipe),
    resolved: &Resolved<'_>,
    chain: &[String],
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
    if let Some(walk) = planted.walk_inputs {
        // Planted (#202): the inputs walked in another order than the recipe's.
        inputs = walk(inputs);
    }
    // Broken-out items this version no longer derives (#1961): each stays the writer's own.
    let mut orphaned = Vec::new();
    // The planted loaders' orphans (#1961): dropped, or handed to the new expansion.
    let mut handed = Vec::new();
    let broken_out: Vec<String> = match member(&item, "broken_out") {
        None => Vec::new(),
        Some(Value::Array(list)) => {
            let mut out = Vec::new();
            for (i, v) in list.iter().enumerate() {
                match v.as_str() {
                    // Broken out under an earlier version that derived it: the writer holds it,
                    // it stays listed so a later version that derives it again never writes it.
                    Some(s)
                        if !derives(recipe, id, s)
                            && items.contains_key(s)
                            && s.strip_prefix(id).is_some_and(|r| r.starts_with('.')) =>
                    {
                        if planted.orphan_drops {
                            items.shift_remove(s);
                        } else if planted.orphan_hands_id {
                            handed.push(s.to_string());
                        } else {
                            out.push(s.to_string());
                            orphaned.push((i, s.to_string()));
                        }
                    }
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
    // Its rules are the core's `kind_rules` check's, once per instance after expansion (#202).
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
    // Each step's derived IDs, which the recipe's channels target, and the channels.
    let mut ids_of: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut channels = Map::new();
    // One scope for every derived item: the inputs and lets, then each item's own names.
    let base = env.len();
    let mut scope = env;
    for step in &recipe.steps {
        // A repeat along a curve: its points, and its count from the spacing when it has one.
        let curve = match &step.along {
            None => None,
            Some((path, _)) => {
                let named = match path.source() {
                    Value::String(n) => inputs.get(n).cloned().unwrap_or(Value::Null),
                    v => v.clone(),
                };
                match curve_points(items, &named) {
                    Some(points) => Some(points),
                    None => {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            id,
                            at(&format!("steps/{}/repeat/along", step.id)),
                            named,
                            "names no curve@1 item with two or more points, nor two or more points",
                        ));
                        return None;
                    }
                }
            }
        };
        let spaced = match (&step.along, &curve) {
            (Some((_, Some(spacing))), Some(points)) => {
                let gap = spacing.eval(&scope[..base]).ok().and_then(|v| v.as_f64());
                match gap.filter(|g| *g > 0.0) {
                    Some(g) => Some((((polyline_length(points) / g).floor() + 1.0).min(1e9), g)),
                    None => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            at(&format!("steps/{}/repeat/spacing", step.id)),
                            spacing.source().clone(),
                            "a repeat's spacing is a length above zero",
                        ));
                        return None;
                    }
                }
            }
            _ => None,
        };
        // A repeat over a builder's part: its elements, counted from the built item at check.
        let elements = match &step.each {
            None => None,
            Some(each) => {
                let held = inputs.get(&each.input).cloned().unwrap_or(Value::Null);
                let path = at(&format!("steps/{}/repeat/each", step.id));
                let builder = held
                    .as_str()
                    .and_then(|b| items.get(b).map(|item| (b, item)));
                let hook = builder
                    .and_then(|(_, item)| super::kind_text(item))
                    .and_then(|k| k.rsplit_once('@'))
                    .and_then(|(full, _)| resolved.elements.get(full));
                let (Some((b, item)), Some(hook)) = (builder, hook) else {
                    issues.push(Issue::error(
                        "ref_unresolved",
                        id,
                        path,
                        held,
                        &format!(
                            "step `{}` repeats over `{}`, which holds no builder item of the document",
                            step.id, each.input
                        ),
                    ));
                    return None;
                };
                let doc = json!({ "items": Value::Object(items.clone()) });
                let plant = planted
                    .each_per_triangle
                    .then_some("each_face_per_triangle");
                match hook(&doc, b, item, &each.part, &each.domain, plant) {
                    Ok(list) if list.len() as u64 <= MAX_REPEAT => Some(list),
                    Ok(list) => {
                        issues.push(Issue::error(
                            "out_of_range",
                            id,
                            path,
                            json!(list.len()),
                            &format!(
                                "step `{}` repeats over at most {MAX_REPEAT} elements",
                                step.id
                            ),
                        ));
                        return None;
                    }
                    Err(why) => {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            id,
                            path,
                            json!(format!("{b}#{}", each.part)),
                            &format!(
                                "step `{}` repeats over the {}s of `{b}#{}`: {why}",
                                step.id, each.domain, each.part
                            ),
                        ));
                        return None;
                    }
                }
            }
        };
        let count: Option<u64> = match &step.repeat {
            None => None,
            Some(_) if elements.is_some() => elements.as_ref().map(|e| e.len() as u64),
            Some(_) if spaced.is_some() => match spaced {
                Some((n, _)) if n <= MAX_REPEAT as f64 => Some(n as u64),
                _ => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/repeat", step.id)),
                        json!(spaced.map(|s| s.0)),
                        &format!("a repeat count is a whole number from 0 to {MAX_REPEAT}"),
                    ));
                    return None;
                }
            },
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
        // A condition false at check leaves the step out: it derives nothing.
        if let Some(when) = &step.when {
            match when.eval(&scope[..base]) {
                Ok(v) if !truthy(&v) => continue,
                Ok(_) => {}
                Err(what) => {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/when", step.id)),
                        when.source().clone(),
                        &what,
                    ));
                    return None;
                }
            }
        }
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
            } else if planted.each_by_count && elements.is_some() {
                seed_of(id, &step.id, Some(index)) ^ n.wrapping_mul(0x9e37_79b9_7f4a_7c15)
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
                // Over elements, the name reads the element: `e.i`, `e.center` and the rest.
                let value = match &elements {
                    Some(list) => list[index as usize].clone(),
                    None => json!(index),
                };
                scope.push((as_.clone(), value));
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
            // A derived item hides, picks and hangs as its instance does, and wears the
            // material it names (#433).
            for key in ["visible", "pickable", "parent", "adjust", "material"] {
                if let Some(v) = member(&item, key) {
                    fields.insert(key.into(), v.clone());
                }
            }
            fields.insert("params".into(), Value::Object(params));
            if let Some(m) = &step.material {
                fields.insert("material".into(), m.clone());
            }
            // Without an `at` of its own, an item stands at the instance's origin.
            if let (None, None, Some(o)) = (&step.at, &curve, &origin) {
                let pos: Vec<Value> = o.iter().map(|v| number(*v)).collect();
                fields.insert("at".into(), json!({ "pos": pos }));
            }
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
            // Along a curve: the copy stands at its arc length, turned to the curve's direction.
            if let Some(points) = &curve {
                let length = polyline_length(points);
                let s = match spaced {
                    Some((_, gap)) => gap * index as f64,
                    None if n > 1 => length * index as f64 / (n - 1) as f64,
                    None => 0.0,
                };
                let (p, yaw) = along_at(points, s);
                let at = fields
                    .entry("at")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .map(std::mem::take)
                    .unwrap_or_default();
                let three = |key: &str, base: [f64; 3]| -> [f64; 3] {
                    let mut out = base;
                    if let Some(list) = at.get(key).and_then(Value::as_array) {
                        for (o, v) in out.iter_mut().zip(list) {
                            *o += v.as_f64().unwrap_or(0.0);
                        }
                    }
                    out
                };
                // Without an `at` of its own, the copy starts at the instance's origin.
                let origin3 = if step.at.is_some() {
                    [0.0; 3]
                } else {
                    let o = origin.clone().unwrap_or_default();
                    [0, 1, 2].map(|k| o.get(k).copied().unwrap_or(0.0))
                };
                let pos = three(
                    "pos",
                    [p[0] + origin3[0], p[1] + origin3[1], p[2] + origin3[2]],
                );
                let rot = three("rot", [0.0, yaw, 0.0]);
                let mut placed = at.clone();
                placed.insert("pos".into(), json!(pos.map(number)));
                placed.insert("rot".into(), json!(rot.map(number)));
                fields.insert("at".into(), Value::Object(placed));
            }
            // A recipe step nests: its item is an instance of the recipe it names, expanded here
            // with its own derived items under its ID, at most MAX_DEPTH recipes down.
            if step.op == "recipe" {
                let Some((child_pack, child)) = resolved.recipe(&step.kind) else {
                    issues.push(Issue::error(
                        "ref_unresolved",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(step.kind),
                        "names no recipe of a pack the document names",
                    ));
                    return None;
                };
                if chain.contains(&child.id) {
                    issues.push(Issue::error(
                        "cycle",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(chain.iter().chain([&child.id]).collect::<Vec<_>>()),
                        &format!("recipe `{}` nests itself", child.id),
                    ));
                    return None;
                }
                if chain.len() >= MAX_DEPTH {
                    issues.push(Issue::error(
                        "out_of_range",
                        id,
                        at(&format!("steps/{}/kind", step.id)),
                        json!(chain.len() + 1),
                        &format!("recipes nest at most {MAX_DEPTH} deep"),
                    ));
                    return None;
                }
                let nested = Value::Object(fields);
                // The document's items, which the nested recipe's curves and IDs are read from.
                let mut scratch = items.clone();
                scratch.insert(derived_id.clone(), nested.clone());
                let mut deeper = chain.to_vec();
                deeper.push(child.id.clone());
                let inner = expand_one(
                    &mut scratch,
                    &derived_id,
                    nested,
                    (child_pack, child),
                    resolved,
                    &deeper,
                    planted,
                    order,
                    issues,
                )?;
                let instance = scratch.remove(&derived_id).unwrap_or(Value::Null);
                derived_items.insert(derived_id.clone(), instance);
                for (k, v) in inner.derived {
                    if items.contains_key(&k) {
                        issues.push(Issue::error(
                            "bad_id",
                            id,
                            format!("items/{k}"),
                            json!(k),
                            &format!(
                                "the document holds an item at the ID `{}` expands to",
                                recipe.id
                            ),
                        ));
                        return None;
                    }
                    derived_items.insert(k, v);
                }
                derived.extend(inner.items);
                channels.extend(inner.channels);
                ids_of.entry(step.id.clone()).or_default().push(derived_id);
                continue;
            }
            ids_of
                .entry(step.id.clone())
                .or_default()
                .push(derived_id.clone());
            // The step's own channels, each on this item's field.
            for (name, c) in &step.channels {
                let field = member(c, "target")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mut out = c.clone();
                out["target"] = json!(format!("items/{derived_id}/{field}"));
                channels.insert(format!("{derived_id}.{name}"), out);
            }
            derived_items.insert(derived_id, Value::Object(fields));
        }
    }
    // The recipe's channels, one per item of the step each targets.
    for (name, c) in &recipe.channels {
        let target = member(c, "target")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some((step, rest)) = target.strip_prefix("step:").and_then(|t| t.split_once('/'))
        else {
            continue;
        };
        let targets = ids_of.get(step).cloned().unwrap_or_default();
        let many = targets.len() > 1;
        for (k, derived_id) in targets.iter().enumerate() {
            let mut out = c.clone();
            out["target"] = json!(format!("items/{derived_id}/{rest}"));
            let cid = if many {
                format!("{id}.{name}.{k}")
            } else {
                format!("{id}.{name}")
            };
            channels.insert(cid, out);
        }
    }
    // Planted (#1961): each orphaned ID goes to the new derived item at its index, in the
    // writer's item's place.
    for orphan in handed {
        let index = orphan.rsplit_once('.').map_or("", |(_, i)| i);
        let heir = derived_items
            .iter()
            .find(|(d, _)| d.rsplit_once('.').is_some_and(|(_, i)| i == index))
            .map(|(_, fields)| fields.clone());
        if let Some(mut fields) = heir {
            fields["id"] = json!(orphan);
            fields["name"] = json!(orphan);
            derived_items.insert(orphan, fields);
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
        orphaned,
        channels,
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
    /// Text the grammar refuses for one of its caps, never a literal: evaluating it fails.
    Refused(String),
    List(Vec<Template>),
    Map(Vec<(String, Template)>),
    /// `{"repeat": {count | over, as, let?, of}}`: a list of `of`, once per index (or element),
    /// its count fixed at check like a step's repeat, at most [`MAX_REPEAT`] (#433).
    Repeat(Box<ListRepeat>),
}

#[derive(Clone, Debug, PartialEq)]
struct ListRepeat {
    /// `count`, an expression, or `over`, an expression giving a list.
    count: Option<Expr>,
    over: Option<Expr>,
    as_: String,
    lets: Vec<(String, Expr)>,
    of: Template,
}

impl ListRepeat {
    fn of(r: &Value) -> Option<ListRepeat> {
        let o = r.as_object()?;
        if o.keys()
            .any(|k| !["count", "over", "as", "let", "of"].contains(&k.as_str()))
        {
            return None;
        }
        let expr = |k: &str| -> Option<Option<Expr>> {
            match o.get(k) {
                None => Some(None),
                Some(Value::String(t)) => Expr::parse(t).ok().map(Some),
                Some(Value::Number(n)) => n.as_f64().map(|n| Some(Expr::Num(n))),
                Some(_) => None,
            }
        };
        let (count, over) = (expr("count")?, expr("over")?);
        if count.is_some() == over.is_some() {
            return None;
        }
        let as_ = o.get("as")?.as_str().filter(|a| well_named(a))?.to_string();
        let mut lets = Vec::new();
        if let Some(l) = o.get("let") {
            for (k, v) in l.as_object()? {
                lets.push((k.clone(), Expr::parse(v.as_str()?).ok()?));
            }
        }
        Some(ListRepeat {
            count,
            over,
            as_,
            lets,
            of: Template::of(o.get("of")?),
        })
    }
}

/// What every refusal for one of the grammar's caps says, so a capped text is never a literal.
const CAPPED: &str = "past the cap of";

/// A cap's refusal of a repeat's `count`, `over` or `let` text, if one has it.
fn capped_in(r: &Value) -> Option<String> {
    let o = r.as_object()?;
    let lets = o
        .get("let")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    o.get("count")
        .into_iter()
        .chain(o.get("over"))
        .chain(lets.map(|(_, v)| v))
        .filter_map(Value::as_str)
        .find_map(|t| Expr::parse(t).err().filter(|e| e.contains(CAPPED)))
}

impl Template {
    pub fn of(value: &Value) -> Template {
        let form = match value {
            Value::String(text) => match Expr::parse(text) {
                Ok(expr) => Form::Expr(expr),
                Err(e) if e.contains(CAPPED) => Form::Refused(e),
                Err(_) => Form::Literal,
            },
            Value::Array(list) => Form::List(list.iter().map(Template::of).collect()),
            Value::Object(map) => match map.get("repeat").filter(|_| map.len() == 1) {
                Some(r) => match ListRepeat::of(r) {
                    Some(r) => Form::Repeat(Box::new(r)),
                    None => match capped_in(r) {
                        Some(e) => Form::Refused(e),
                        None => Form::Literal,
                    },
                },
                None => Form::Map(
                    map.iter()
                        .map(|(k, v)| (k.clone(), Template::of(v)))
                        .collect(),
                ),
            },
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

    /// The names its expressions read and don't bind themselves, words included.
    pub fn names(&self) -> Vec<String> {
        let (mut reads, words) = self.reads();
        reads.extend(words);
        reads
    }

    /// The names its expressions read and don't bind themselves, and apart from them the bare
    /// names that read as their own text when nothing binds them (`type == POINT`).
    pub fn reads(&self) -> (Vec<String>, Vec<String>) {
        let (mut out, mut words) = (Vec::new(), Vec::new());
        self.walk(&mut Vec::new(), &mut out, &mut words);
        (out, words)
    }

    fn walk(&self, bound: &mut Vec<String>, out: &mut Vec<String>, words: &mut Vec<String>) {
        match &self.form {
            Form::Expr(e) => e.free(bound, out, words),
            Form::Literal | Form::Refused(_) => {}
            Form::List(l) => l.iter().for_each(|t| t.walk(bound, out, words)),
            Form::Map(m) => m.iter().for_each(|(_, t)| t.walk(bound, out, words)),
            Form::Repeat(r) => {
                let depth = bound.len();
                for e in r.count.iter().chain(&r.over) {
                    e.free(bound, out, words);
                }
                bound.push(r.as_.clone());
                bound.push("i".into());
                for (name, e) in &r.lets {
                    e.free(bound, out, words);
                    bound.push(name.clone());
                }
                r.of.walk(bound, out, words);
                bound.truncate(depth);
            }
        }
    }

    pub fn eval(&self, scope: &[(String, Value)]) -> Result<Value, String> {
        match &self.form {
            Form::Expr(Expr::Name(name)) if !scope.iter().any(|(k, _)| k == name) => {
                Ok(self.source.clone())
            }
            Form::Expr(expr) => expr.value(scope),
            Form::Literal => Ok(self.source.clone()),
            Form::Refused(e) => Err(e.clone()),
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
            Form::Repeat(r) => {
                let elements: Vec<Value> = match (&r.count, &r.over) {
                    (Some(c), _) => {
                        let n = c.eval(scope)?;
                        if !(0.0..=MAX_REPEAT as f64).contains(&n) || n.fract() != 0.0 {
                            return Err(format!("a repeat counts 0 to {MAX_REPEAT}, not {n}"));
                        }
                        (0..n as u64).map(|i| json!(i)).collect()
                    }
                    (_, Some(o)) => match o.value(scope)? {
                        Value::Array(a) if a.len() as u64 <= MAX_REPEAT => a,
                        other => {
                            return Err(format!(
                                "a repeat is over a list of at most {MAX_REPEAT}, not {other}"
                            ))
                        }
                    },
                    _ => Vec::new(),
                };
                let mut inner = scope.to_vec();
                let base = inner.len();
                let mut out = Vec::with_capacity(elements.len());
                for (i, e) in elements.into_iter().enumerate() {
                    inner.truncate(base);
                    inner.push(("i".into(), json!(i)));
                    inner.push((r.as_.clone(), e));
                    for (name, l) in &r.lets {
                        let v = l.value(&inner)?;
                        inner.push((name.clone(), v));
                    }
                    out.push(r.of.eval(&inner)?);
                }
                Ok(Value::Array(out))
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

/// One step of an expression in postfix order: the form a caller that evaluates it frame after
/// frame without allocating compiles it to, such as a driver's `expr` (Driver).
#[derive(Clone, Debug, PartialEq)]
pub enum ExprStep {
    Num(f64),
    Name(String),
    Neg,
    /// One of `+ - * / %`.
    Bin(char),
    /// A function of the closed list, with its argument count.
    Call(String, usize),
}

/// `text` parsed as a recipe expression, in postfix order. The forms only a recipe reads at
/// check (comparisons, conditions, indexes, members, `len`, `sum`) have no postfix form.
pub fn postfix(text: &str) -> Result<Vec<ExprStep>, String> {
    fn walk(e: &Expr, out: &mut Vec<ExprStep>) -> Result<(), String> {
        match e {
            Expr::Num(n) => out.push(ExprStep::Num(*n)),
            Expr::Name(n) => out.push(ExprStep::Name(n.clone())),
            Expr::Neg(a) => {
                walk(a, out)?;
                out.push(ExprStep::Neg);
            }
            Expr::Bin(op, a, b) => {
                walk(a, out)?;
                walk(b, out)?;
                out.push(ExprStep::Bin(*op));
            }
            Expr::Call(name, args) if !matches!(name.as_str(), "len" | "sum" | "unmapped") => {
                for a in args {
                    walk(a, out)?;
                }
                out.push(ExprStep::Call(name.clone(), args.len()));
            }
            _ => return Err("a comparison, condition, index or member has no postfix form".into()),
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(&Expr::parse(text)?, &mut out)?;
    Ok(out)
}

/// An expression: numbers, names, `+ - * / %`, unary minus, parentheses, the functions `min`,
/// `max`, `floor`, `ceil`, `round` and `abs`, and the closed function list's powers and angles
/// (`sqrt pow sin cos tan asin acos atan atan2 deg rad`, constants `pi tau`) in its pinned math.
/// For a familiar-names pack's stated conversions (#433) a recipe also reads the list's logic,
/// `== != < <= > >= && || !` and `c ? a : b`; `a[i]` and `a.name` into a list or record input;
/// `len(list)`; the bounded sum `sum(k, a, b, term)` (at most 256 terms); and `unmapped()`, which
/// refuses the value it stands for. `==` and `!=` compare text too, a bare name nothing binds
/// being its own text, so `units == Lumens` reads a choice.
#[derive(Clone, Debug, PartialEq)]
enum Expr {
    Num(f64),
    Name(String),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    /// One of `+ - * / %`.
    Bin(char, Box<Expr>, Box<Expr>),
    /// One of `== != < <= > >= && ||`.
    Logic(&'static str, Box<Expr>, Box<Expr>),
    Cond(Box<Expr>, Box<Expr>, Box<Expr>),
    Index(Box<Expr>, Box<Expr>),
    Member(Box<Expr>, String),
    Call(String, Vec<Expr>),
}

/// The most terms a bounded sum adds (The closed function list: bounded sums).
const MAX_SUM: f64 = 256.0;

impl Expr {
    fn parse(text: &str) -> Result<Expr, String> {
        match Expr::parse_capped(text) {
            Err(e) if e.contains(CAPPED) && !could_be_expression(text) => {
                Err("isn't an expression".into())
            }
            parsed => parsed,
        }
    }

    fn parse_capped(text: &str) -> Result<Expr, String> {
        let tokens = tokenize(text)?;
        let mut p = Parser {
            tokens,
            at: 0,
            depth: 0,
        };
        let e = p.cond()?;
        if p.at != p.tokens.len() {
            return Err(format!("unexpected `{}`", p.tokens[p.at]));
        }
        Ok(e)
    }

    /// The names it reads that `bound` doesn't hold, into `out`, and each bare name that is text
    /// when nothing binds it (a side of `==` or `!=`, a branch of a condition) into `words`.
    fn free(&self, bound: &mut Vec<String>, out: &mut Vec<String>, words: &mut Vec<String>) {
        let word =
            |e: &Expr, bound: &mut Vec<String>, out: &mut Vec<String>, words: &mut Vec<String>| {
                match e {
                    Expr::Name(n) if !bound.contains(n) => words.push(n.clone()),
                    _ => e.free(bound, out, words),
                }
            };
        match self {
            Expr::Num(_) => {}
            Expr::Name(n) => {
                if !bound.contains(n) {
                    out.push(n.clone());
                }
            }
            Expr::Neg(a) | Expr::Not(a) | Expr::Member(a, _) => a.free(bound, out, words),
            Expr::Logic("==" | "!=", a, b) => {
                word(a, bound, out, words);
                word(b, bound, out, words);
            }
            Expr::Bin(_, a, b) | Expr::Logic(_, a, b) | Expr::Index(a, b) => {
                a.free(bound, out, words);
                b.free(bound, out, words);
            }
            Expr::Cond(c, a, b) => {
                c.free(bound, out, words);
                word(a, bound, out, words);
                word(b, bound, out, words);
            }
            Expr::Call(name, args) if name == "sum" && args.len() == 4 => {
                args[1].free(bound, out, words);
                args[2].free(bound, out, words);
                if let Expr::Name(k) = &args[0] {
                    bound.push(k.clone());
                    args[3].free(bound, out, words);
                    bound.pop();
                }
            }
            Expr::Call(_, args) => args.iter().for_each(|a| a.free(bound, out, words)),
        }
    }

    /// Its value as a number (a bool reads 1 or 0).
    fn eval(&self, scope: &[(String, Value)]) -> Result<f64, String> {
        match self.value(scope)? {
            Value::Number(n) => Ok(n.as_f64().unwrap_or(f64::NAN)),
            Value::Bool(b) => Ok(f64::from(u8::from(b))),
            other => Err(format!("`{}` is not a number", shown(&other))),
        }
    }

    /// Its value: a number, or what a name, index or member reads.
    fn value(&self, scope: &[(String, Value)]) -> Result<Value, String> {
        let n = |x: f64| -> Result<Value, String> {
            if x.is_finite() {
                Ok(number(x))
            } else {
                Err(format!("the result is {x}, not a finite number"))
            }
        };
        match self {
            Expr::Num(x) => n(*x),
            Expr::Name(name) => scope
                .iter()
                .rev()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
                .ok_or_else(|| format!("`{name}` is not in scope")),
            Expr::Index(a, i) => {
                let list = a.value(scope)?;
                let k = i.eval(scope)?;
                let item = list
                    .as_array()
                    .filter(|_| k >= 0.0 && k.fract() == 0.0)
                    .and_then(|l| l.get(k as usize));
                item.cloned()
                    .ok_or_else(|| format!("no element {k} of `{}`", shown(&list)))
            }
            Expr::Member(a, name) => {
                let record = a.value(scope)?;
                record
                    .get(name)
                    .cloned()
                    .ok_or_else(|| format!("no `{name}` in `{}`", shown(&record)))
            }
            Expr::Neg(e) => n(-e.eval(scope)?),
            Expr::Not(e) => n(f64::from(u8::from(e.eval(scope)? == 0.0))),
            Expr::Cond(c, a, b) => {
                let picked = if c.eval(scope)? != 0.0 { a } else { b };
                match &**picked {
                    // A bare name nothing binds is its own text, such as a choice's word.
                    Expr::Name(w) if !scope.iter().any(|(k, _)| k == w) => Ok(json!(w)),
                    e => e.value(scope),
                }
            }
            Expr::Logic(op @ ("==" | "!="), a, b) => {
                // A bare name nothing binds is its own text, so a choice compares to a word.
                let side = |e: &Expr| -> Result<Value, String> {
                    match e {
                        Expr::Name(w) if !scope.iter().any(|(k, _)| k == w) => Ok(json!(w)),
                        _ => e.value(scope),
                    }
                };
                let (a, b) = (side(a)?, side(b)?);
                let same = match (a.as_f64(), b.as_f64()) {
                    (Some(x), Some(y)) => x == y,
                    _ => a == b,
                };
                n(f64::from(u8::from(same == (*op == "=="))))
            }
            Expr::Logic(op, a, b) => {
                let x = a.eval(scope)?;
                // `&&` and `||` read their right side only when they need it.
                let truth = match *op {
                    "&&" => x != 0.0 && b.eval(scope)? != 0.0,
                    "||" => x != 0.0 || b.eval(scope)? != 0.0,
                    _ => {
                        let y = b.eval(scope)?;
                        match *op {
                            "<" => x < y,
                            "<=" => x <= y,
                            ">" => x > y,
                            _ => x >= y,
                        }
                    }
                };
                n(f64::from(u8::from(truth)))
            }
            Expr::Bin(op, a, b) => {
                let (a, b) = (a.eval(scope)?, b.eval(scope)?);
                n(match op {
                    '+' => a + b,
                    '-' => a - b,
                    '*' => a * b,
                    _ if b == 0.0 => return Err("division by zero".into()),
                    '/' => a / b,
                    _ => a % b,
                })
            }
            Expr::Call(name, args) if name == "unmapped" && args.is_empty() => {
                Err("the pack maps no such value: refused, never guessed".into())
            }
            Expr::Call(name, args) if name == "len" && args.len() == 1 => {
                match args[0].value(scope)? {
                    Value::Array(a) => n(a.len() as f64),
                    other => Err(format!("`{}` is not a list", shown(&other))),
                }
            }
            Expr::Call(name, args) if name == "sum" && args.len() == 4 => {
                let Expr::Name(k) = &args[0] else {
                    return Err("sum(k, a, b, term) binds a name k".into());
                };
                let (a, b) = (args[1].eval(scope)?, args[2].eval(scope)?);
                if a.fract() != 0.0 || b.fract() != 0.0 || b - a + 1.0 > MAX_SUM {
                    return Err(format!("a sum runs over at most {MAX_SUM} whole k"));
                }
                let mut inner = scope.to_vec();
                let mut total = 0.0;
                // Counted, not stepped: past 2^53 `i + 1.0` is `i`, and a stepped loop never ends.
                let terms = (b - a + 1.0).max(0.0) as u64;
                for j in 0..terms {
                    inner.push((k.clone(), number(a + j as f64)));
                    total += args[3].eval(&inner)?;
                    inner.pop();
                }
                n(total)
            }
            Expr::Call(name, args) => {
                let vals = args
                    .iter()
                    .map(|a| a.eval(scope))
                    .collect::<Result<Vec<_>, _>>()?;
                n(match (name.as_str(), vals.as_slice()) {
                    ("min", [a, b]) => a.min(*b),
                    ("max", [a, b]) => a.max(*b),
                    ("floor", [a]) => a.floor(),
                    ("ceil", [a]) => a.ceil(),
                    ("round", [a]) => a.round(),
                    ("abs", [a]) => a.abs(),
                    ("sqrt", [a]) => ops::sqrt(*a),
                    ("pow", [a, b]) => ops::pow(*a, *b),
                    ("sin", [a]) => ops::sin(*a),
                    ("cos", [a]) => ops::cos(*a),
                    ("tan", [a]) => ops::tan(*a),
                    ("asin", [a]) => ops::asin(*a),
                    ("acos", [a]) => ops::acos(*a),
                    ("atan", [a]) => ops::atan(*a),
                    ("atan2", [a, b]) => ops::atan2(*a, *b),
                    ("deg", [a]) => ops::deg(*a),
                    ("rad", [a]) => ops::rad(*a),
                    _ => return Err(format!("no function `{name}` of {} arguments", vals.len())),
                })
            }
        }
    }
}

fn shown(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 80 {
        format!(
            "{}…",
            &s[..s.char_indices().nth(80).map_or(s.len(), |(i, _)| i)]
        )
    } else {
        s
    }
}

/// The most tokens an expression takes. Each node takes one at least, so walking, evaluating and
/// dropping a tree recurse at most this deep; it is twice the most nodes the core compiles an
/// expression to (512, for a path function).
const MAX_TOKENS: usize = 1024;

fn tokenize(text: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for t in Tokens::of(text) {
        if out.len() == MAX_TOKENS {
            return Err(format!("runs past the cap of {MAX_TOKENS} tokens"));
        }
        out.push(t?);
    }
    Ok(out)
}

/// A text's tokens, one at a time.
struct Tokens {
    chars: Vec<char>,
    i: usize,
}

impl Tokens {
    fn of(text: &str) -> Tokens {
        Tokens {
            chars: text.chars().collect(),
            i: 0,
        }
    }
}

impl Iterator for Tokens {
    type Item = Result<String, String>;

    fn next(&mut self) -> Option<Result<String, String>> {
        let chars = &self.chars;
        let mut i = self.i;
        while chars.get(i).is_some_and(|c| c.is_whitespace()) {
            i += 1;
        }
        let c = *chars.get(i)?;
        let next = chars.get(i + 1).copied();
        let start = i;
        let t = if c.is_ascii_digit() || (c == '.' && next.is_some_and(|d| d.is_ascii_digit())) {
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            Ok(chars[start..i].iter().collect())
        } else if c.is_ascii_alphabetic() || c == '_' {
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            Ok(chars[start..i].iter().collect())
        } else if let Some(two) = next
            .map(|d| format!("{c}{d}"))
            .filter(|t| ["==", "!=", "<=", ">=", "&&", "||"].contains(&t.as_str()))
        {
            i += 2;
            Ok(two)
        } else if "+-*/%(),[].?:<>!".contains(c) {
            i += 1;
            Ok(c.to_string())
        } else {
            i = chars.len();
            Err(format!("unexpected `{c}`"))
        };
        self.i = i;
        Some(t)
    }
}

/// Whether `text` could be an expression, read flat in one pass: an operand after each
/// operator, open brackets closed in order, a comma only between a call's arguments, a `:` for
/// each `?`, at most one comparison between them, nothing left over. It reads more than the
/// grammar does, never less, so text a cap stops is refused only when the grammar might read it.
fn could_be_expression(text: &str) -> bool {
    /// One open bracket (or the whole text): its closer, whether it is a call's, its `?`s
    /// waiting for their `:` and whether its current operand has compared already.
    struct Open {
        close: Option<char>,
        call: bool,
        asks: usize,
        compared: bool,
    }
    let open = |close, call| Open {
        close: Some(close),
        call,
        asks: 0,
        compared: false,
    };
    let mut stack = vec![Open {
        close: None,
        call: false,
        asks: 0,
        compared: false,
    }];
    // Whether the next token must be an operand.
    let mut operand = true;
    let mut tokens = Tokens::of(text).peekable();
    while let Some(t) = tokens.next() {
        let Ok(t) = t else { return false };
        let Some(top) = stack.last_mut() else {
            return false;
        };
        operand = match (operand, t.as_str()) {
            (true, "-" | "!") => true,
            (true, "(") => {
                stack.push(open(')', false));
                true
            }
            // A number's name (`pi`, `inf`) is read as the number, as atom reads it.
            (true, _) if t.parse::<f64>().is_ok() || t == "pi" || t == "tau" => false,
            (true, _) if well_named_member(&t) => {
                if matches!(tokens.peek(), Some(Ok(p)) if p == "(") {
                    tokens.next();
                    if matches!(tokens.peek(), Some(Ok(p)) if p == ")") {
                        tokens.next();
                        false
                    } else {
                        stack.push(open(')', true));
                        true
                    }
                } else {
                    false
                }
            }
            (true, _) => return false,
            (false, ")" | "]") => {
                if top.close != t.chars().next() || top.asks > 0 {
                    return false;
                }
                stack.pop();
                false
            }
            (false, "[") => {
                stack.push(open(']', false));
                true
            }
            (false, ".") => match tokens.next() {
                Some(Ok(m)) if well_named_member(&m) => false,
                _ => return false,
            },
            (false, "+" | "-" | "*" | "/" | "%") => true,
            (false, "==" | "!=" | "<" | "<=" | ">" | ">=") => {
                if top.compared {
                    return false;
                }
                top.compared = true;
                true
            }
            (false, "&&" | "||" | "?" | ":" | ",") => {
                match t.as_str() {
                    "?" => top.asks += 1,
                    ":" if top.asks == 0 => return false,
                    ":" => top.asks -= 1,
                    "," if !top.call || top.asks > 0 => return false,
                    _ => {}
                }
                top.compared = false;
                true
            }
            _ => return false,
        };
    }
    !operand && stack.len() == 1 && stack[0].asks == 0
}

struct Parser {
    tokens: Vec<String>,
    at: usize,
    /// How deep the expression being read nests.
    depth: usize,
}

impl Parser {
    /// `f` one level deeper, refused past the closed function list's nesting cap.
    fn nest<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, String>) -> Result<T, String> {
        if self.depth == MAX_NEST {
            return Err(format!("nests past the cap of {MAX_NEST} levels"));
        }
        self.depth += 1;
        let e = f(self);
        self.depth -= 1;
        e
    }

    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.at).map(String::as_str)
    }

    fn take(&mut self) -> Option<String> {
        let t = self.tokens.get(self.at).cloned();
        self.at += 1;
        t
    }

    fn cond(&mut self) -> Result<Expr, String> {
        let c = self.or()?;
        if self.peek() != Some("?") {
            return Ok(c);
        }
        self.at += 1;
        let a = self.nest(Self::cond)?;
        if self.take().as_deref() != Some(":") {
            return Err("missing `:`".into());
        }
        let b = self.nest(Self::cond)?;
        Ok(Expr::Cond(Box::new(c), Box::new(a), Box::new(b)))
    }

    fn or(&mut self) -> Result<Expr, String> {
        let mut left = self.and()?;
        while self.peek() == Some("||") {
            self.at += 1;
            left = Expr::Logic("||", Box::new(left), Box::new(self.and()?));
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr, String> {
        let mut left = self.compare()?;
        while self.peek() == Some("&&") {
            self.at += 1;
            left = Expr::Logic("&&", Box::new(left), Box::new(self.compare()?));
        }
        Ok(left)
    }

    fn compare(&mut self) -> Result<Expr, String> {
        let left = self.sum()?;
        let op = match self.peek() {
            Some("==") => "==",
            Some("!=") => "!=",
            Some("<") => "<",
            Some("<=") => "<=",
            Some(">") => ">",
            Some(">=") => ">=",
            _ => return Ok(left),
        };
        self.at += 1;
        Ok(Expr::Logic(op, Box::new(left), Box::new(self.sum()?)))
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
        match self.peek() {
            Some("-") => {
                self.at += 1;
                Ok(Expr::Neg(Box::new(self.nest(Self::unary)?)))
            }
            Some("!") => {
                self.at += 1;
                Ok(Expr::Not(Box::new(self.nest(Self::unary)?)))
            }
            _ => self.postfix(),
        }
    }

    /// An atom with its indexes and members, `a[i].b`.
    fn postfix(&mut self) -> Result<Expr, String> {
        let mut e = self.atom()?;
        loop {
            match self.peek() {
                Some("[") => {
                    self.at += 1;
                    let i = self.nest(Self::cond)?;
                    if self.take().as_deref() != Some("]") {
                        return Err("missing `]`".into());
                    }
                    e = Expr::Index(Box::new(e), Box::new(i));
                }
                Some(".") => {
                    self.at += 1;
                    match self.take() {
                        Some(name) if well_named_member(&name) => {
                            e = Expr::Member(Box::new(e), name)
                        }
                        _ => return Err("a member is a name".into()),
                    }
                }
                _ => return Ok(e),
            }
        }
    }

    fn atom(&mut self) -> Result<Expr, String> {
        let Some(t) = self.take() else {
            return Err("expression ends early".into());
        };
        if t == "(" {
            let e = self.nest(Self::cond)?;
            if self.take().as_deref() != Some(")") {
                return Err("missing `)`".into());
            }
            return Ok(e);
        }
        if let Ok(n) = t.parse::<f64>() {
            return Ok(Expr::Num(n));
        }
        match t.as_str() {
            "pi" => return Ok(Expr::Num(std::f64::consts::PI)),
            "tau" => return Ok(Expr::Num(std::f64::consts::TAU)),
            _ => {}
        }
        if well_named_member(&t) {
            if self.peek() == Some("(") {
                self.at += 1;
                let args = self.nest(Self::args)?;
                return Ok(Expr::Call(t, args));
            }
            return Ok(Expr::Name(t));
        }
        Err(format!("unexpected `{t}`"))
    }

    /// A call's arguments after its `(`, through its `)`.
    fn args(&mut self) -> Result<Vec<Expr>, String> {
        let mut args = Vec::new();
        if self.peek() == Some(")") {
            self.at += 1;
            return Ok(args);
        }
        loop {
            args.push(self.cond()?);
            match self.take().as_deref() {
                Some(",") => continue,
                Some(")") => return Ok(args),
                _ => return Err("missing `)`".into()),
            }
        }
    }
}

/// A name token: a letter or `_` first.
fn well_named_member(t: &str) -> bool {
    t.chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pack format's contract entry (#200) holds the keys and lists the pack check reads, so
    /// the contract diff sees a change to either.
    #[test]
    fn the_pack_schema_holds_the_checks_keys_and_lists() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/canvas-schemas/pack@1.json"
        ))
        .expect("JSON");
        let keys = |v: &Value| -> Vec<String> {
            let mut k: Vec<String> = v["properties"]
                .as_object()
                .expect("properties")
                .keys()
                .cloned()
                .collect();
            k.sort();
            k
        };
        let sorted = |l: &[&str]| -> Vec<String> {
            let mut k: Vec<String> = l.iter().map(|s| s.to_string()).collect();
            k.sort();
            k
        };
        let list = |v: &Value| -> Vec<String> {
            v["enum"]
                .as_array()
                .expect("enum")
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        };
        let defs = &schema["$defs"];
        assert_eq!(keys(&schema), sorted(PACK_KEYS), "a pack's keys");
        assert_eq!(
            keys(&defs["recipe"]),
            sorted(RECIPE_KEYS),
            "a recipe's keys"
        );
        assert_eq!(keys(&defs["step"]), sorted(STEP_KEYS), "a step's keys");
        assert_eq!(
            keys(&defs["kind"]),
            sorted(super::super::pack_kinds::KIND_KEYS),
            "a pack kind's keys"
        );
        assert_eq!(
            list(&defs["step"]["properties"]["op"]),
            STEP_OPS,
            "step ops"
        );
        assert_eq!(
            list(&defs["input"]["properties"]["type"]),
            INPUT_TYPES,
            "input types"
        );
    }

    fn scope() -> Vec<(String, Value)> {
        vec![("n".into(), json!(5)), ("i".into(), json!(2))]
    }

    #[test]
    fn a_recipe_expression_nests_at_most_64_levels_and_takes_at_most_1024_tokens() {
        // Each opener completes to a valid expression; 64 levels parse, 65 are refused.
        let forms = [
            ("(", ")"),
            ("-", ""),
            ("!", ""),
            ("abs(", ")"),
            ("i ? 1 : ", ""),
            ("i ? ", " : 1"),
            ("a[", "]"),
        ];
        for (open, close) in forms {
            let at = |n: usize| format!("{}1{}", open.repeat(n), close.repeat(n));
            assert!(Expr::parse(&at(64)).is_ok(), "{open}");
            let e = Expr::parse(&at(65)).unwrap_err();
            assert!(e.contains("the cap of 64 levels"), "{open}: {e}");
            let e = Expr::parse(&at(1_000_000)).unwrap_err();
            assert!(e.contains("cap of"), "{open}: {e}");
        }
        // A chain nests no parse but a tree as deep as it is long, which a walk recurses down.
        let chain = |n: usize| format!("{}1", "1+".repeat(n));
        assert!(postfix(&chain(511)).is_ok());
        // 1,024 tokens read and the 1,025th is refused.
        assert!(postfix(&format!("-{}", chain(511))).is_ok());
        let e = postfix(&format!("--{}", chain(511))).unwrap_err();
        assert!(e.contains("the cap of 1024 tokens"), "{e}");
        let e = tokenize(&format!("-{} $", chain(511))).unwrap_err();
        assert_eq!(
            e, "runs past the cap of 1024 tokens",
            "the cap before the 1,025th token"
        );
        let e = postfix(&chain(100_000)).unwrap_err();
        assert!(e.contains("the cap of 1024 tokens"), "{e}");
    }

    #[test]
    fn a_recipe_value_past_a_cap_is_refused_not_read_as_text() {
        // Text the grammar doesn't read is a literal, but text it refuses for a cap never is.
        let deep = format!("{}n{}", "(".repeat(70), ")".repeat(70));
        let long = format!("{}1", "n+".repeat(600));
        for text in [deep.clone(), long.clone()] {
            let e = Template::of(&json!(text)).eval(&scope()).unwrap_err();
            assert!(e.contains("past the cap of"), "{e}");
            let repeat = json!({"repeat": {"count": text, "as": "j", "of": "j"}});
            let e = Template::of(&repeat).eval(&scope()).unwrap_err();
            assert!(e.contains("past the cap of"), "{e}");
            let over = json!({"repeat": {"over": text, "as": "j", "of": "j"}});
            let e = Template::of(&over).eval(&scope()).unwrap_err();
            assert!(e.contains("past the cap of"), "{e}");
            let lets = json!({"repeat": {"count": 2, "as": "j", "let": {"k": text}, "of": "k"}});
            let e = Template::of(&lets).eval(&scope()).unwrap_err();
            assert!(e.contains("past the cap of"), "{e}");
        }
        // A refused text reads no name.
        assert_eq!(Template::of(&json!(deep)).reads(), (vec![], vec![]));
        // A repeat whose count no cap stops is still read as it was: a literal.
        let plain = json!({"repeat": {"count": "a b", "as": "j", "of": "j"}});
        assert_eq!(Template::of(&plain).eval(&scope()), Ok(plain.clone()));
    }

    #[test]
    fn the_recipe_lexer_reads_each_token_form() {
        let value = |t: &str| Expr::parse(t).and_then(|e| e.eval(&scope()));
        assert_eq!(value("(i == 2) + (1 != 2) + (2 >= 1)"), Ok(3.0));
        assert!(Expr::parse("f() + 1").is_ok());
        assert_eq!(value(".5 + 1.5\t+\n1"), Ok(3.0));
        // Names are ASCII letters, digits and `_`, and numbers ASCII digits and dots.
        let (names, _) = Template::of(&json!("_a + a_1 + b2")).reads();
        assert_eq!(names, ["_a", "a_1", "b2"]);
        for (text, bad) in [
            ("aé", "é"),
            ("a١", "١"),
            ("1١", "١"),
            ("١", "١"),
            ("é", "é"),
        ] {
            let want = format!("unexpected `{bad}`");
            assert_eq!(Expr::parse(text).err(), Some(want), "{text}");
        }
        assert_eq!(
            Expr::parse("1 # 2").err().as_deref(),
            Some("unexpected `#`")
        );
        // Text a cap stops that no expression could be says so.
        let e = Expr::parse(&"-".repeat(70)).err();
        assert_eq!(e.as_deref(), Some("isn't an expression"));
    }

    #[test]
    fn the_flat_check_reads_each_rule_of_the_grammar() {
        // Short texts, so each case turns on one rule; past a cap the same rules decide.
        let could = [
            "1 < 2 && 2 < 3",
            "i ? 1 < 2 : 2 > 1",
            "f() + 1",
            "1 % 2 + (1 <= 2) + (0 || 1)",
            "max(1, i ? 2 : 3)",
            "a.b[1] - !c",
            "(a == b) * (a != b) / (a >= b)",
            "pi + tau * inf - nan",
        ];
        for text in could {
            assert!(could_be_expression(text), "{text}");
        }
        let never = [
            "(1 ? 2)",
            "(1]",
            "f(1 ? 2, 3 : 4)",
            "(1",
            "1 + + 2",
            "()",
            "f(1,)",
            "a.+",
            "1 + )",
            "1 # 2",
            "1 : 2",
            "1 2",
            "a[1, 2]",
        ];
        for text in never {
            assert!(!could_be_expression(text), "{text}");
        }
    }

    #[test]
    fn long_text_that_is_no_expression_stays_a_literal() {
        // A cap refuses only text that could be an expression; past it, text is still a literal.
        let texts = [
            format!("M 0 0 {}", "L 10.5 20.25 ".repeat(400)),
            "The quick brown fox jumps over the lazy dog, again. ".repeat(120),
            "-".repeat(70),
            format!("{}see note{}", "(".repeat(70), ")".repeat(70)),
            // Read flat they look like one, but the grammar takes no list in parentheses, no
            // chained comparison and no `?` without its `:`.
            format!("({}(0,0))", "(0, 0), ".repeat(400)),
            format!("{}1", "1 < ".repeat(600)),
            format!("{}1", "1 ? ".repeat(600)),
            // A number's name is read as the number, so no call follows it.
            format!("pi({}1)", "1, ".repeat(600)),
            format!("tau({}1)", "1, ".repeat(600)),
            format!("inf({}1)", "1, ".repeat(600)),
            format!("nan({}1)", "1, ".repeat(600)),
        ];
        for text in texts {
            let got = Template::of(&json!(text)).eval(&scope());
            assert_eq!(got, Ok(json!(text)), "{}", &text[..40]);
        }
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
        // A result that is not a finite number is an error, never a null.
        for t in ["sqrt(0 - 1)", "pow(10, 400)"] {
            let value = Expr::parse(t).unwrap().value(&scope());
            assert!(value.is_err(), "{t}: {value:?}");
        }
        let eval = |v: &Value, s: &[(String, Value)]| Template::of(v).eval(s);
        assert_eq!(eval(&json!("i * 2"), &scope()).unwrap(), json!(4));
        assert_eq!(
            eval(&json!(["i", 1.5, "ink", {"role": "muted"}]), &scope()).unwrap(),
            json!([2, 1.5, "ink", {"role": "muted"}])
        );
    }

    #[test]
    fn a_sum_ends_where_adding_one_changes_nothing() {
        let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
        // Past 2^53 adding one changes nothing, so a sum that only counts up never ends here.
        assert_eq!(e("sum(k, 9007199254740992, 9007199254740992, 1)"), 1.0);
        assert_eq!(e("sum(k, 1, 4, k)"), 10.0);
        assert_eq!(e("sum(k, 4, 1, k)"), 0.0);
    }

    #[test]
    fn an_expression_past_the_parser_bounds_is_refused() {
        assert!(Expr::parse(&"(".repeat(100_000)).is_err());
        assert!(Expr::parse(&"-".repeat(100_000)).is_err());
        assert!(Expr::parse(&vec!["1"; 100_000].join("+")).is_err());
        let nested = |n: usize| format!("{}1{}", "(".repeat(n), ")".repeat(n));
        assert!(Expr::parse(&nested(MAX_NEST + 1)).is_err());
        // The deepest nesting and the longest chain the bounds admit still evaluate.
        let e = |t: &str| Expr::parse(t).unwrap().eval(&scope()).unwrap();
        assert_eq!(e(&nested(MAX_NEST)), 1.0);
        assert_eq!(e(&vec!["1"; MAX_TOKENS / 2].join("+")), 512.0);
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
    fn a_missing_pack_version_keeps_and_skips_its_instances_and_two_of_a_name_are_refused() {
        let packs = packs_with(&chart_pack(16));
        let mut doc = board(json!({"c1": instance("c1", 5)}));
        doc["packs"] = json!(["test/chart@2.0.0"]);
        let result = super::super::check_packed(&doc, &registry::core(), &packs);
        // The document opens (#1958): no error, one notice naming the pack, the version and c1,
        // and c1 neither expands with 1.0.0 nor draws.
        assert!(
            result.issues.iter().all(|i| i.severity != "error"),
            "{:?}",
            result.issues
        );
        let missing = result
            .notices
            .iter()
            .find(|n| n.code == "pack_missing")
            .expect("pack_missing");
        assert_eq!(
            missing.actual,
            json!({"pack": "test/chart", "version": "2.0.0"})
        );
        assert_eq!(missing.ids, vec!["c1"]);
        assert!(result.notices.iter().all(|n| n.code != "unknown_kind"));
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
    // ---- #420: nesting, conditions, repeats along a curve, channels, lights in the budget ----

    fn nest_pack(recipes: Value) -> Value {
        json!({
            "id": "test/nest", "name": "nest", "version": "1.0.0", "license": "MIT",
            "description": "recipes in recipes",
            "requires": {"core": ">=0.0.0", "modules": {}},
            "recipes": recipes
        })
    }

    fn rect_step() -> Value {
        json!({"op": "mark", "kind": "test.rect@1", "params": {"w": 10, "h": 10}})
    }

    fn nested(name: &str, child: &str) -> Value {
        json!({"id": format!("nest.{name}"), "version": "1.0",
               "steps": {"inner": {"op": "recipe", "kind": format!("nest.{child}@1")}}})
    }

    fn nest_doc(kind: &str, extra: Value) -> Value {
        let mut doc = json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [640, 360], "packs": ["test/nest@1.0.0"],
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"n1": {"id": "n1", "kind": kind, "layer": "main", "name": "n1", "order": "a0",
                             "at": {"pos": [10, 0, 0]}}}
        });
        if let (Some(d), Some(e)) = (doc.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                if k == "items" {
                    let items = d
                        .get_mut("items")
                        .and_then(Value::as_object_mut)
                        .expect("items");
                    items.extend(v.as_object().cloned().unwrap_or_default());
                } else {
                    d.insert(k.clone(), v.clone());
                }
            }
        }
        doc
    }

    fn checked(recipes: Value, kind: &str, extra: Value) -> crate::document::CheckResult {
        let packs = packs_with(&nest_pack(recipes));
        super::super::check_packed(&nest_doc(kind, extra), &registry::core(), &packs)
    }

    #[test]
    fn a_recipe_step_nests_its_recipe_under_its_own_derived_id() {
        let result = checked(
            json!({
                "nest.leaf@1": {"id": "nest.leaf", "version": "1.0", "steps": {"r": rect_step()}},
                "nest.box@1": nested("box", "leaf"),
            }),
            "nest.box@1",
            json!({}),
        );
        assert!(result.ok, "{:?}", result.issues);
        let derived: Vec<&String> = result.expansions[0].derived.keys().collect();
        assert_eq!(derived, ["n1.inner", "n1.inner.r"]);
        assert_eq!(
            result.expansions[0].derived["n1.inner"]["kind"],
            json!("nest.leaf@1")
        );
    }

    #[test]
    fn recipes_nest_four_deep_and_a_fifth_is_refused_naming_its_step() {
        let chain = |deep: usize| {
            let mut recipes = Map::new();
            for k in 1..deep {
                recipes.insert(
                    format!("nest.d{k}@1"),
                    nested(&format!("d{k}"), &format!("d{}", k + 1)),
                );
            }
            recipes.insert(
                format!("nest.d{deep}@1"),
                json!({"id": format!("nest.d{deep}"), "version": "1.0", "steps": {"r": rect_step()}}),
            );
            Value::Object(recipes)
        };
        let four = checked(chain(4), "nest.d1@1", json!({}));
        assert!(four.ok, "{:?}", four.issues);
        assert!(four.expansions[0]
            .derived
            .contains_key("n1.inner.inner.inner.r"));
        let five = checked(chain(5), "nest.d1@1", json!({}));
        assert!(!five.ok);
        assert!(
            five.issues.iter().any(|i| i.code == "out_of_range"
                && i.path == "items/n1.inner.inner.inner/steps/inner/kind"),
            "{:?}",
            five.issues
        );
        assert!(
            five.expansions.is_empty(),
            "a refused nesting writes nothing"
        );
    }

    #[test]
    fn a_recipe_that_nests_itself_is_refused_as_a_cycle() {
        let result = checked(
            json!({"nest.a@1": nested("a", "b"), "nest.b@1": nested("b", "a")}),
            "nest.a@1",
            json!({}),
        );
        assert!(
            result.issues.iter().any(|i| i.code == "cycle"),
            "{:?}",
            result.issues
        );
        assert!(result.expansions.is_empty());
    }

    #[test]
    fn a_false_condition_leaves_its_step_out_and_one_reading_t_is_refused_at_the_pack_check() {
        let recipes = |when: &str| {
            json!({"nest.opt@1": {
                "id": "nest.opt", "version": "1.0",
                "inputs": {"lamp": {"type": "bool", "default": false}},
                "steps": {"base": rect_step(),
                          "lamp": {"op": "mark", "kind": "test.rect@1", "when": when, "params": {"w": 2, "h": 2}}}
            }})
        };
        let off = checked(recipes("lamp"), "nest.opt@1", json!({}));
        assert!(off.ok, "{:?}", off.issues);
        assert_eq!(
            off.expansions[0].derived.keys().collect::<Vec<_>>(),
            ["n1.base"]
        );
        let lit = json!({"items": {"n1": {"id": "n1", "kind": "nest.opt@1", "layer": "main", "name": "n1",
                                          "order": "a0", "params": {"lamp": true}}}});
        let on = checked(recipes("lamp"), "nest.opt@1", lit);
        assert_eq!(
            on.expansions[0].derived.keys().collect::<Vec<_>>(),
            ["n1.base", "n1.lamp"]
        );
        let mut packs = Packs::default();
        let refused = packs
            .admit(&nest_pack(recipes("t * 2")), &registry::core())
            .expect_err("a condition reading t is refused");
        assert!(
            refused.iter().any(|i| i.path.ends_with("steps/lamp/when")),
            "{refused:?}"
        );
    }

    #[test]
    fn copies_along_a_curve_stand_at_their_arc_lengths_turned_to_it() {
        let recipes = |repeat: Value| {
            json!({"nest.row@1": {
                "id": "nest.row", "version": "1.0",
                "inputs": {"rail": {"type": "ID", "default": "rail"}},
                "steps": {"post": {"op": "mark", "kind": "test.rect@1", "repeat": repeat, "params": {"w": 1, "h": 1}}}
            }})
        };
        let rail = json!({"items": {"rail": {"id": "rail", "kind": "test.rect@1", "layer": "main",
            "name": "rail", "order": "a1", "params": {"points": [[0, 0, 0], [4, 0, 0], [4, 0, -2]]}}}});
        let counted = checked(
            recipes(json!({"along": "rail", "count": 4, "as": "i"})),
            "nest.row@1",
            rail.clone(),
        );
        let at = |r: &crate::document::CheckResult, k: usize| {
            r.expansions[0].derived[&format!("n1.post.{k}")]["at"].clone()
        };
        // Six metres in four copies: 0, 2, 4 (the corner) and 6, each from the instance's origin.
        assert_eq!(at(&counted, 0)["pos"], json!([10, 0, 0]));
        assert_eq!(at(&counted, 1)["pos"], json!([12, 0, 0]));
        assert_eq!(at(&counted, 3)["pos"], json!([14, 0, -2]));
        assert_eq!(at(&counted, 1)["rot"], json!([0, 0, 0]));
        // Past the corner it runs along −z: a quarter turn about +Y.
        assert_eq!(at(&counted, 3)["rot"], json!([0, 90, 0]));
        let spaced = checked(
            recipes(json!({"along": "rail", "spacing": 1.5, "as": "i"})),
            "nest.row@1",
            rail,
        );
        assert_eq!(
            spaced.expansions[0].derived.len(),
            5,
            "floor(6 / 1.5) + 1 copies"
        );
        assert_eq!(
            spaced.expansions[0].derived["n1.post.3"]["at"]["pos"],
            json!([14, 0, -0.5])
        );
        let mut packs = Packs::default();
        let refused = packs
            .admit(
                &nest_pack(recipes(json!({"along": "rail", "spacing": "t", "as": "i"}))),
                &registry::core(),
            )
            .expect_err("a spacing reading t is refused");
        assert!(
            refused
                .iter()
                .any(|i| i.path.ends_with("steps/post/repeat/spacing")),
            "{refused:?}"
        );
    }

    #[test]
    fn a_recipes_channels_join_the_document_targeting_the_items_it_derived() {
        let result = checked(
            json!({"nest.grow@1": {
                "id": "nest.grow", "version": "1.0",
                "steps": {"bars": {"op": "mark", "kind": "test.rect@1", "repeat": {"count": 2, "as": "i"},
                                   "params": {"w": 4, "h": 4}}},
                "channels": {"rise": {"target": "step:bars/params/h", "type": "f32",
                    "keys": {"k0": {"t": "0s", "value": 4, "interp": "linear"}, "k1": {"t": "1s", "value": 8}}}}
            }}),
            "nest.grow@1",
            json!({}),
        );
        assert!(result.ok, "{:?}", result.issues);
        let channels = &result.lowered["channels"];
        assert_eq!(
            channels["n1.rise.0"]["target"],
            json!("items/n1.bars.0/params/h")
        );
        assert_eq!(
            channels["n1.rise.1"]["target"],
            json!("items/n1.bars.1/params/h")
        );
        let bad = json!({"nest.bad@1": {"id": "nest.bad", "version": "1.0",
            "steps": {"bars": rect_step()},
            "channels": {"rise": {"target": "step:nothing/params/h"}}}});
        let mut packs = Packs::default();
        let refused = packs
            .admit(&nest_pack(bad), &registry::core())
            .expect_err("a channel on no step is refused");
        assert!(
            refused
                .iter()
                .any(|i| i.path.ends_with("channels/rise/target")),
            "{refused:?}"
        );
    }

    #[test]
    fn lights_a_recipe_derives_count_against_the_documents_light_cap() {
        let recipes = json!({"nest.lamps@1": {
            "id": "nest.lamps", "version": "1.0",
            "steps": {"lamp": {"op": "item", "kind": "light.sun@1", "repeat": {"count": 3, "as": "i"}}}
        }});
        let over = checked(
            recipes.clone(),
            "nest.lamps@1",
            json!({"budget": {"lights": 2}}),
        );
        let issue = over.issues.iter().find(|i| i.path == "budget/lights");
        assert!(
            issue.is_some_and(|i| i.code == "over_budget" && i.ids.len() == 3),
            "{:?}",
            over.issues
        );
        // A cap that is no whole number at or above 0 is refused, never read as no cap.
        for cap in [json!(-1), json!(2.5), json!("2")] {
            let budget = json!({"budget": {"lights": cap}});
            let bad = checked(recipes.clone(), "nest.lamps@1", budget);
            let issue = bad.issues.iter().find(|i| i.path == "budget/lights");
            assert!(
                issue.is_some_and(|i| i.code == "out_of_range"),
                "{:?}",
                bad.issues
            );
        }
        let fits = checked(recipes, "nest.lamps@1", json!({"budget": {"lights": 3}}));
        assert!(
            !fits.issues.iter().any(|i| i.path == "budget/lights"),
            "{:?}",
            fits.issues
        );
    }
}
