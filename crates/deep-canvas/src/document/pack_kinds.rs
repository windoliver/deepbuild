//! Pack kinds (canvas primitives: Pack: kinds in any pack; Pack: kind rules and the kind kit;
//! issue #202).
//!
//! Any pack may declare kinds backed by a recipe in `kinds`, each an entry of `kind@1` that
//! resolves per document through the pinned pack and never enters the sealed set. Its params are
//! its recipe's inputs. The pack check reads each kind ([`check_kinds`]) and then runs its kit
//! ([`kit`]): its examples valid at their defaults, expanded twice to the same bytes, its cost
//! at defaults and at each param's extremes within its class and its declaration, its clean
//! examples passing every rule and each rule's planted twin failing with that rule's code. The
//! core's `kind_rules` check ([`kind_rules`]) evaluates a kind's rules, with its recipe's, once
//! per instance at the times each names.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::packs::{At, Expansion, KindRule, Pack, PackId, Packs, Planted, Recipe, Resolved};
use super::{member, Issue};
use crate::budget::Class;
use crate::interval::Iv;
use crate::registry::Sealed;

/// A pack kind as its pack declares it, with its kit's result once the pack check ran it.
#[derive(Clone, Debug, PartialEq)]
pub struct PackKind {
    /// `<pack>.<name>@<major>`.
    pub name: String,
    pub minor: u64,
    /// The recipe's `pack.name`; its inputs are the kind's schema.
    pub recipe: String,
    pub children: Vec<String>,
    pub capabilities: Value,
    pub rules: Vec<KindRule>,
    /// Its examples, each its sha256 and its params, and each one's text by its sha256.
    pub examples: Vec<(String, Map<String, Value>)>,
    pub texts: BTreeMap<String, String>,
    /// Its planted twins, each its example's sha256, its params and the code it must raise.
    pub twins: Vec<(String, Map<String, Value>, String)>,
    /// Its cost class (the budget class table) and its declared cost at defaults.
    pub class: Class,
    pub at_defaults: Value,
    /// Its kit's result, `{verdict, parts}`, and its largest counts over the extremes.
    pub kit: Value,
    pub at_extremes: Value,
    /// The mesh assets its kit's expansions name, by sha256: `geometry.shading` is the loop
    /// module's, so the caller that links it reads them.
    pub meshes: BTreeSet<String>,
}

/// A pack kind's fields (Pack: kinds in any pack).
pub(super) const KIND_KEYS: &[&str] = &[
    "minor",
    "recipe",
    "children",
    "capabilities",
    "rules",
    "twins",
    "migrate",
    "examples",
    "cost",
];
/// What only a kind backed by code declares: a pack kind is refused for each, naming it.
const CODE_ONLY: &[&str] = &[
    "builder",
    "plan",
    "insets",
    "hosts_insets",
    "arrays",
    "operators",
];

/// The pack's `kinds`, each checked: named `<pack>.<name>@<major>`, backed by one of its
/// recipes, with only a recipe-backed kind's fields, its rules compiled, its examples and twins
/// read from the pack's assets by hash, and its cost declared.
pub(super) fn check_kinds(
    id: &PackId,
    kinds: &Value,
    recipes: &BTreeMap<String, Recipe>,
    assets: &[Value],
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
) -> BTreeMap<String, PackKind> {
    let mut out = BTreeMap::new();
    let Some(map) = kinds.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "kinds".into(),
            kinds.clone(),
            "not an object",
        ));
        return out;
    };
    for (name, spec) in map {
        let path = format!("kinds/{name}");
        let bad = |at: &str, actual: Value, what: &str| {
            let p = if at.is_empty() {
                path.clone()
            } else {
                format!("{path}/{at}")
            };
            Issue::envelope("out_of_range", p, actual, what)
        };
        let Some(major) = own_name(&id.name, name) else {
            issues.push(bad(
                "",
                json!({"kind": name}),
                &format!(
                    "`{name}` would take the kind `{name}`; a pack's kind is named `{}.<name>@<major>`",
                    id.name
                ),
            ));
            continue;
        };
        let Some(fields) = spec.as_object() else {
            issues.push(bad("", spec.clone(), "a kind is an object"));
            continue;
        };
        let mut ok = true;
        for (k, v) in fields {
            if CODE_ONLY.contains(&k.as_str()) {
                issues.push(bad(
                    k,
                    json!({"kind": name, "field": k}),
                    &format!("`{name}` is backed by a recipe, and a pack kind can't declare `{k}`"),
                ));
                ok = false;
            } else if !KIND_KEYS.contains(&k.as_str()) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    format!("{path}/{k}"),
                    v.clone(),
                    "not a field of a pack kind",
                ));
                ok = false;
            }
        }
        // An empty `migrate` is a kind at its first major's; migrations as data come later.
        let migrates = fields.get("migrate").is_some_and(|m| match m {
            Value::Object(o) => !o.is_empty(),
            Value::Array(a) => !a.is_empty(),
            _ => true,
        });
        if migrates || major > 1 {
            issues.push(bad(
                "migrate",
                json!({"kind": name, "field": "migrate"}),
                "migrations as data land with the pack versions task: a pack kind is at major 1",
            ));
            ok = false;
        }
        let recipe_name = fields
            .get("recipe")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let recipe_id = recipe_name.split('@').next().unwrap_or_default();
        let Some(recipe) = recipes.get(recipe_id) else {
            issues.push(bad(
                "recipe",
                json!(recipe_name),
                &format!("`{name}` names no recipe of the pack"),
            ));
            continue;
        };
        let rules = match fields.get("rules") {
            None => Vec::new(),
            Some(list) => super::packs::read_rule_list(
                &id.name,
                list,
                &recipe.inputs,
                sealed,
                &format!("{path}/rules"),
                true,
                issues,
            ),
        };
        let mut read = |sha: &str, at: String| -> Option<(Map<String, Value>, String)> {
            let params = example_params(assets, sha, name);
            if params.is_none() {
                issues.push(Issue::envelope(
                    "out_of_range",
                    at,
                    json!({"kind": name, "example": sha}),
                    &format!("`{sha}` is none of the pack's assets, or no document with one `{name}` item"),
                ));
            }
            params
        };
        let mut examples = Vec::new();
        let mut texts = BTreeMap::new();
        for (i, sha) in list(fields.get("examples")).iter().enumerate() {
            let sha = sha.as_str().unwrap_or_default();
            match read(sha, format!("{path}/examples/{i}")) {
                Some((p, text)) => {
                    texts.insert(sha.to_string(), text);
                    examples.push((sha.to_string(), p));
                }
                None => ok = false,
            }
        }
        let mut twins = Vec::new();
        for (i, twin) in list(fields.get("twins")).iter().enumerate() {
            let sha = twin
                .get("example")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let expect = twin
                .get("expect")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match read(sha, format!("{path}/twins/{i}")) {
                Some((p, _)) => twins.push((sha.to_string(), p, expect.to_string())),
                None => ok = false,
            }
        }
        let cost = fields.get("cost");
        let class = cost
            .and_then(|c| c.get("class"))
            .and_then(Value::as_str)
            .and_then(Class::parse);
        let at_defaults = cost.and_then(|c| c.get("at_defaults")).cloned();
        let declared = at_defaults.as_ref().is_some_and(|d| {
            ["cpu_ms", "gpu_ms", "items"]
                .iter()
                .all(|k| d.get(*k).and_then(Value::as_f64).is_some_and(|v| v >= 0.0))
        });
        let (Some(class), true) = (class, declared) else {
            issues.push(bad(
                "cost",
                cost.cloned().unwrap_or(Value::Null),
                "a kind's cost is {class: a budget class, at_defaults: {cpu_ms, gpu_ms, items}}",
            ));
            continue;
        };
        if !ok {
            continue;
        }
        out.insert(
            name.clone(),
            PackKind {
                name: name.clone(),
                minor: fields.get("minor").and_then(Value::as_u64).unwrap_or(0),
                recipe: recipe.id.clone(),
                children: list(fields.get("children"))
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
                capabilities: fields.get("capabilities").cloned().unwrap_or(json!({})),
                rules,
                examples,
                texts,
                twins,
                class,
                at_defaults: at_defaults.unwrap_or(Value::Null),
                kit: Value::Null,
                at_extremes: Value::Null,
                meshes: BTreeSet::new(),
            },
        );
    }
    out
}

/// The major of `name` when it is `<pack>.<name>@<major>` of the pack named `pack`.
fn own_name(pack: &str, name: &str) -> Option<u64> {
    let (full, major) = name.rsplit_once('@')?;
    let major: u64 = major.parse().ok().filter(|m| *m >= 1)?;
    let short = full.strip_prefix(pack)?.strip_prefix('.')?;
    let mut chars = short.chars();
    let ok = matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    ok.then_some(major)
}

fn list(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

/// An example's params and text: the asset of `sha`, as the loader read it, is a document holding
/// one item of the kind, whose `params` are the example's.
fn example_params(assets: &[Value], sha: &str, kind: &str) -> Option<(Map<String, Value>, String)> {
    let asset = assets
        .iter()
        .find(|a| a.get("sha256").and_then(Value::as_str) == Some(sha))?;
    let hex = asset.get("hex").and_then(Value::as_str)?;
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
        .collect::<Option<_>>()?;
    let doc: Value = serde_json::from_slice(&bytes).ok()?;
    let mut items = member(&doc, "items")?.as_object()?.values();
    let item = items.next().filter(|i| super::kind_text(i) == Some(kind))?;
    if items.next().is_some() {
        return None;
    }
    let params = member(item, "params").cloned().unwrap_or(json!({}));
    Some((params.as_object()?.clone(), String::from_utf8(bytes).ok()?))
}

/// What the core's `kind_rules` check found on a document: each failing rule's issue, once per
/// instance and rule, and each rule that ran with the pack it came from.
#[derive(Clone, Debug, Default)]
pub struct RuleRun {
    pub issues: Vec<Issue>,
    /// `(rule code, owner/name@version)`.
    pub ran: BTreeSet<(String, String)>,
}

/// The core's `kind_rules` check over `items`, the lowered items after expansion: every pack
/// instance's recipe rules and its kind's rules, evaluated once each at rest, at each of its
/// times, or bounded over a sweep. A failing rule raises its code naming the instance, the time
/// and the fix; a value the check can't read or bound is refused, never passed.
pub fn kind_rules(
    doc: &Value,
    items: &Map<String, Value>,
    expansions: &[Expansion],
    resolved: &Resolved<'_>,
    planted: super::packs::Planted,
) -> RuleRun {
    let mut run = RuleRun::default();
    if expansions.is_empty() {
        return run;
    }
    // The instance params a channel or a driver moves: only those are read at a time.
    let mut driven: BTreeSet<String> = BTreeSet::new();
    for section in ["channels", "drivers"] {
        for c in member(doc, section)
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|m| m.values())
        {
            if let Some(rest) = member(c, "target")
                .and_then(Value::as_str)
                .and_then(|t| t.strip_prefix("items/"))
            {
                if let Some((id, _)) = rest.split_once("/params") {
                    driven.insert(id.to_string());
                }
            }
        }
    }
    // Each expanded instance, with the instances its recipe nests, their params filled.
    let instances = expansions.iter().flat_map(|e| {
        items
            .get_key_value(&e.instance)
            .into_iter()
            .chain(e.derived.iter())
    });
    for (id, item) in instances {
        let Some(kind) = super::kind_text(item) else {
            continue;
        };
        let Some((pack, recipe)) = resolved.recipe(kind) else {
            continue;
        };
        let Some(params) = member(item, "params").and_then(Value::as_object) else {
            continue;
        };
        let own = resolved.kind(kind);
        let mut rules: Vec<&KindRule> = recipe.rules.iter().collect();
        if planted.rules_twice && own.is_some() {
            // Planted: the kind's pass reads its recipe's rules a second time.
            rules.extend(recipe.rules.iter());
        }
        rules.extend(own.into_iter().flat_map(|k| k.rules.iter()));
        let pack_id = pack.id.text();
        for rule in rules {
            run.ran.insert((rule.code.clone(), pack_id.clone()));
            let moved = driven.contains(id);
            let failed: Result<Option<Option<i64>>, &'static str> = match &rule.at {
                At::Rest => Ok((!rule.holds(params)).then_some(None)),
                // Params nothing moves read the same at every time: one evaluation decides them.
                At::Times(times) if !moved => {
                    Ok((!rule.holds(params)).then(|| times.first().copied()))
                }
                // A param a channel or a driver moves has its value at a time only in a frame,
                // which this check doesn't evaluate: it is never passed.
                At::Times(_) => Err("not_run"),
                At::Sweep if moved => Err("sweep_unbounded"),
                At::Sweep => {
                    let vars: Vec<Iv> = rule
                        .expr
                        .vars
                        .iter()
                        .map(|n| Iv::point(super::packs::rule_number(params.get(n))))
                        .collect();
                    let b = rule.expr.bound_num(&vars);
                    if b.lo > 0.0 || b.hi < 0.0 {
                        Ok(None)
                    } else if b.lo == 0.0 && b.hi == 0.0 {
                        Ok(Some(None))
                    } else {
                        Err("sweep_unbounded")
                    }
                }
            };
            let path = format!("items/{id}/params");
            match failed {
                Ok(None) => {}
                Ok(Some(t)) => {
                    let mut actual =
                        json!({"rule": rule.code, "expr": rule.expr.text, "pack": pack_id});
                    if let Some(t) = t {
                        actual["t"] = json!(t);
                    }
                    let mut issue = Issue::error(
                        super::packs::KIND_RULE,
                        id,
                        path,
                        actual,
                        &format!("the instance breaks {}'s rule `{}`", recipe.id, rule.code),
                    );
                    issue.severity = "warning";
                    issue.fix = rule.fix.clone();
                    run.issues.push(issue);
                }
                Err(code) => {
                    let mut issue = Issue::error(
                        code,
                        id,
                        path,
                        json!({"rule": rule.code, "pack": pack_id}),
                        &format!("rule `{}` reads a value this check can't evaluate or bound, so it is never passed", rule.code),
                    );
                    issue.severity = "warning";
                    run.issues.push(issue);
                }
            }
        }
    }
    run
}

/// The seeds the kit expands each extreme at: three fixed instance IDs, since a derived item's
/// seed comes from `(instance, step, index)`.
const KIT_SEEDS: [&str; 3] = ["kit0", "kit1", "kit2"];

/// A failed part of a kind's kit, refusing the pack: it names the kind and the part.
fn kit_fail(
    kind: &str,
    part: &str,
    code: &'static str,
    mut actual: Value,
    what: &str,
) -> Box<Issue> {
    actual["kind"] = json!(kind);
    actual["part"] = json!(part);
    Box::new(Issue::envelope(
        code,
        format!("kinds/{kind}"),
        actual,
        &format!("kind `{kind}` fails its kit's {part} part: {what}"),
    ))
}

/// The kind kit of each of `pack`'s kinds, run at the pack check: a failing part refuses the
/// pack, naming the kind and the part; a passing kit is kept on the kind with its largest
/// counts over the extremes.
pub(super) fn kit(pack: &mut Pack, sealed: &Sealed, planted: Planted) -> Result<(), Vec<Issue>> {
    let mut alone = Packs::new(planted);
    alone.insert(pack.clone());
    let mut issues = Vec::new();
    let mut results = BTreeMap::new();
    for (name, kind) in &pack.kinds {
        match kit_one(pack, kind, sealed, &alone) {
            Ok(r) => {
                results.insert(name.clone(), r);
            }
            Err(issue) => issues.push(*issue),
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    for (name, (kit, extremes, meshes)) in results {
        if let Some(k) = pack.kinds.get_mut(&name) {
            k.kit = kit;
            k.at_extremes = extremes;
            k.meshes = meshes;
        }
    }
    Ok(())
}

/// A kind's passing kit: its result, its largest counts over the extremes and its meshes.
type KitResult = (Value, Value, BTreeSet<String>);

/// One check of a kit document: one instance of the kind, under its class.
struct Run {
    errors: Vec<Value>,
    rules: Vec<String>,
    over: Option<Value>,
    bytes: Vec<u8>,
    cpu_ms: f64,
    gpu_ms: f64,
    items: f64,
    triangles: f64,
    meshes: Vec<String>,
}

fn kit_doc(
    pack: &Pack,
    kind: &PackKind,
    instance: Option<&str>,
    params: &Map<String, Value>,
) -> Value {
    let mut items = Map::new();
    if let Some(instance) = instance {
        items.insert(
            instance.into(),
            json!({"id": instance, "kind": kind.name, "name": "Kit", "layer": "main", "order": "a0", "params": params}),
        );
    }
    json!({
        "format": 1, "id": "kit", "profile": "board", "title": format!("{}'s kit", kind.name),
        "description": "One instance of a pack kind, as its kind kit checks it.",
        "size": [320, 200], "packs": [pack.id.text()],
        "layers": {"main": {"writer": "kit", "title": "Kit", "order": "a0"}},
        "budget": {"class": kind.class.name()},
        "items": items,
    })
}

/// One instance checked; its cost is the document's less `base`, the same document's without it.
fn kit_check(
    (pack, kind): (&Pack, &PackKind),
    instance: &str,
    params: &Map<String, Value>,
    (sealed, packs): (&Sealed, &Packs),
    base: &crate::cost::Estimate,
) -> Run {
    let checked = super::check_packed(&kit_doc(pack, kind, Some(instance), params), sealed, packs);
    let e = crate::cost::estimate(&checked.lowered, sealed, &sealed.costs);
    let derived: Vec<&Value> = checked
        .lowered
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.iter())
        .filter(|(k, _)| k.as_str() != instance)
        .map(|(_, v)| v)
        .collect();
    Run {
        // Valid means no error but its class: a cost over the class is the cost part's.
        errors: checked
            .issues
            .iter()
            .filter(|i| i.severity == "error" && i.code != "over_budget")
            .map(Issue::to_json)
            .collect(),
        rules: checked
            .issues
            .iter()
            .filter(|i| i.code == super::packs::KIND_RULE)
            .filter_map(|i| {
                i.actual
                    .get("rule")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect(),
        over: checked
            .issues
            .iter()
            .find(|i| i.code == "over_budget")
            .map(Issue::to_json),
        bytes: serde_json::to_vec(&checked.lowered["items"]).unwrap_or_default(),
        cpu_ms: e.cpu_ms - base.cpu_ms,
        gpu_ms: e.gpu_ms - base.gpu_ms,
        items: derived.len() as f64,
        // A quad's two triangles per four vertices, a mesh's as its count gives them.
        triangles: derived
            .iter()
            .map(|v| crate::cost::counts(v).vertices / 2.0)
            .sum(),
        meshes: derived
            .iter()
            .filter(|v| super::kind_text(v).is_some_and(|k| k.starts_with("mesh.asset@")))
            .filter_map(|v| v.pointer("/params/sha256").and_then(Value::as_str))
            .map(str::to_string)
            .collect(),
    }
}

fn kit_one(
    pack: &Pack,
    kind: &PackKind,
    sealed: &Sealed,
    packs: &Packs,
) -> Result<KitResult, Box<Issue>> {
    let name = kind.name.as_str();
    let recipe = &pack.recipes[&kind.recipe];
    let empty = super::check_packed(&kit_doc(pack, kind, None, &Map::new()), sealed, packs);
    let base = crate::cost::estimate(&empty.lowered, sealed, &sealed.costs);
    let check = |instance: &str, params: &Map<String, Value>| {
        kit_check((pack, kind), instance, params, (sealed, packs), &base)
    };
    // defaults: the kind at its defaults, each example and each twin, valid.
    let defaults = check("kit", &Map::new());
    let cases = std::iter::once(("defaults".to_string(), Map::new(), defaults.errors.clone()))
        .chain(
            kind.examples
                .iter()
                .map(|(sha, p)| (sha.clone(), p.clone(), check("kit", p).errors)),
        )
        .chain(
            kind.twins
                .iter()
                .map(|(sha, p, _)| (sha.clone(), p.clone(), check("kit", p).errors)),
        );
    for (example, _, errors) in cases {
        if !errors.is_empty() {
            return Err(kit_fail(
                name,
                "defaults",
                "out_of_range",
                json!({"example": example, "issues": errors}),
                &format!("example `{example}` isn't valid"),
            ));
        }
    }
    // determinism: each example expands to the same bytes twice.
    for (sha, p) in &kind.examples {
        if check("kit", p).bytes != check("kit", p).bytes {
            return Err(kit_fail(
                name,
                "determinism",
                "out_of_range",
                json!({"example": sha}),
                &format!("example `{sha}` expands to other bytes the second time"),
            ));
        }
    }
    // cost: at defaults within its class and within 25% of the check's estimate.
    let declared = |k: &str| {
        kind.at_defaults
            .get(k)
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let estimated = [
        ("cpu_ms", defaults.cpu_ms),
        ("gpu_ms", defaults.gpu_ms),
        ("items", defaults.items),
    ];
    if let Some((k, est)) = estimated.iter().find(|(k, est)| *est > declared(k) * 1.25) {
        return Err(kit_fail(
            name,
            "cost",
            "cost_understated",
            json!({"field": k, "declared": declared(k), "estimated": est}),
            &format!(
                "its estimate {est:.4} {k} is more than 25% over the declared {}",
                declared(k)
            ),
        ));
    }
    if let Some(over) = defaults.over {
        return Err(kit_fail(
            name,
            "cost",
            "over_budget",
            json!({"issue": over}),
            &format!("at its defaults it passes its {} class", kind.class.name()),
        ));
    }
    // cost at the extremes: each param at its hard minimum and maximum, one at a time with the
    // rest at the example's values, at three seeds; each valid, deterministic and in class.
    let (mut items, mut triangles) = (defaults.items, defaults.triangles);
    let mut meshes: BTreeSet<String> = defaults.meshes.iter().cloned().collect();
    let bases: Vec<Map<String, Value>> = if kind.examples.is_empty() {
        vec![Map::new()]
    } else {
        kind.examples.iter().map(|(_, p)| p.clone()).collect()
    };
    if !packs.planted.kit_defaults_only {
        for base in &bases {
            for (param, input) in &recipe.inputs {
                for value in [input.min, input.max].into_iter().flatten() {
                    let mut p = base.clone();
                    p.insert(param.clone(), json!(value));
                    for seed in KIT_SEEDS {
                        let run = check(seed, &p);
                        let cost = json!({"cpu_ms": run.cpu_ms, "gpu_ms": run.gpu_ms, "items": run.items, "triangles": run.triangles});
                        let at =
                            json!({"param": param, "value": value, "seed": seed, "cost": cost});
                        if !run.errors.is_empty() {
                            return Err(kit_fail(
                                name,
                                "cost",
                                "out_of_range",
                                json!({"param": param, "value": value, "issues": run.errors}),
                                &format!("at {param} = {value} it isn't valid"),
                            ));
                        }
                        if run.bytes != check(seed, &p).bytes {
                            return Err(kit_fail(name, "determinism", "out_of_range", at, &format!("at {param} = {value} it expands to other bytes the second time")));
                        }
                        if run.over.is_some() {
                            return Err(kit_fail(
                                name,
                                "cost",
                                "over_budget",
                                at,
                                &format!(
                                    "at {param} = {value} it passes its {} class",
                                    kind.class.name()
                                ),
                            ));
                        }
                        items = items.max(run.items);
                        triangles = triangles.max(run.triangles);
                        meshes.extend(run.meshes);
                    }
                }
            }
        }
    }
    // rules: clean examples pass every rule; each kind rule's planted twin fails with its code.
    // A recipe-level rule's twin is the recipe's own, which its pack check already ran (#490).
    let mut clean = Vec::new();
    for (sha, p) in &kind.examples {
        let raised = check("kit", p).rules;
        if let Some(rule) = raised.first() {
            return Err(kit_fail(
                name,
                "rules",
                "out_of_range",
                json!({"example": sha, "rule": rule}),
                &format!("clean example `{sha}` breaks rule `{rule}`"),
            ));
        }
        clean.push(json!({"example": sha, "raised": raised}));
    }
    for rule in &kind.rules {
        if !kind.twins.iter().any(|(_, _, expect)| *expect == rule.code) {
            return Err(kit_fail(
                name,
                "rules",
                "out_of_range",
                json!({"rule": rule.code}),
                &format!("rule `{}` has no planted twin", rule.code),
            ));
        }
    }
    let mut twins = Vec::new();
    for (sha, p, expect) in &kind.twins {
        let raised = check("kit", p).rules;
        if !raised.contains(expect) {
            return Err(kit_fail(
                name,
                "rules",
                "out_of_range",
                json!({"rule": expect, "example": sha}),
                &format!("the kit admits rule `{expect}`'s planted twin `{sha}`"),
            ));
        }
        twins.push(json!({"example": sha, "expect": expect, "raised": raised}));
    }
    // The registries' one kit shape: each part a rule of the kit.
    let part = |p: &str| json!({"rule": p, "verdict": "PASS"});
    let kit = json!({
        "verdict": "PASS",
        "rules": [part("defaults"), part("determinism"), part("cost"), part("rules"),
                  // A kind at major 1 has nothing to migrate from: the part has no case.
                  {"rule": "migration", "verdict": "NONE", "why": "a kind at major 1 migrates from nothing"}],
        "examples": clean,
        "twins": twins,
    });
    Ok((kit, json!({"items": items, "triangles": triangles}), meshes))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::super::packs::Packs;
    use crate::registry;
    use crate::schedule::sha256_hex;

    /// An asset holding a board of one `row.bars@1` item with `params`, as the loader inlines
    /// one, and its hash.
    fn example(params: Value) -> (String, Value) {
        let doc = json!({"items": {"x1": {"id": "x1", "kind": "row.bars@1", "params": params}}});
        let bytes = serde_json::to_vec(&doc).expect("json");
        let sha = sha256_hex(&bytes);
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        (sha.clone(), json!({"sha256": sha, "hex": hex}))
    }

    /// A pack `test/row` whose kind `row.bars@1` draws `n` rects of width `w`, with `kind` merged
    /// into the kind's fields and `recipe` into the recipe's.
    fn pack(kind: Value, recipe: Value, assets: Vec<Value>) -> Value {
        let mut r = json!({
            "id": "row.bars", "version": "1.0",
            "inputs": {"n": {"type": "integer", "default": 2, "min": 1, "max": 4},
                       "w": {"type": "number", "default": 1.2, "min": 0.4, "max": 3.0}},
            "steps": {"bar": {"op": "mark", "kind": "test.rect@1",
                              "repeat": {"count": "n", "as": "i"},
                              "params": {"w": 10, "h": 10}, "at": {"pos": ["24 * i", 0, 0]}}}
        });
        let mut k = json!({"minor": 0, "recipe": "row.bars",
                           "cost": {"class": "export", "at_defaults": {"cpu_ms": 100, "gpu_ms": 100, "items": 100}}});
        for (into, from) in [(&mut r, recipe), (&mut k, kind)] {
            for (key, v) in from.as_object().cloned().unwrap_or_default() {
                into[key] = v;
            }
        }
        json!({"id": "test/row", "name": "row", "version": "1.0.0", "license": "MIT",
               "description": "rows", "requires": {"core": ">=0.0.0", "modules": {}},
               "recipes": {"row.bars@1": r}, "kinds": {"row.bars@1": k}, "assets": assets})
    }

    fn admit(manifest: &Value) -> Result<Packs, Vec<Value>> {
        let mut packs = Packs::default();
        match packs.admit(manifest, &registry::core()) {
            Ok(_) => Ok(packs),
            Err(issues) => Err(issues.iter().map(|i| i.to_json()).collect()),
        }
    }

    #[test]
    fn a_kind_with_a_migration_or_past_major_1_is_refused_naming_the_field() {
        let refused = admit(&pack(
            json!({"migrate": {"renames": [{"from": "w", "to": "width"}]}}),
            json!({}),
            vec![],
        ))
        .expect_err("migrate");
        assert_eq!(
            refused[0]["path"], "kinds/row.bars@1/migrate",
            "{refused:?}"
        );
        let mut two = pack(json!({}), json!({}), vec![]);
        two["kinds"] = json!({"row.bars@2": two["kinds"]["row.bars@1"].clone()});
        let refused = admit(&two).expect_err("major 2");
        assert_eq!(
            refused[0]["path"], "kinds/row.bars@2/migrate",
            "{refused:?}"
        );
    }

    #[test]
    fn a_clean_example_that_breaks_a_rule_fails_the_kits_rules_part() {
        let (clean, a) = example(json!({"w": 1.0, "n": 2}));
        let (bad, b) = example(json!({"w": 2.0, "n": 2}));
        let rule =
            json!([{"code": "row.span", "expr": "w <= 0.9 * n", "at": "rest", "fix": "add bars"}]);
        let ok = pack(
            json!({"rules": rule, "examples": [clean], "twins": [{"example": b["sha256"], "expect": "row.span"}]}),
            json!({}),
            vec![a.clone(), b.clone()],
        );
        let packs = admit(&ok).expect("a clean example and its twin");
        let kind = &packs.all().next().expect("pack").kinds["row.bars@1"];
        assert_eq!(kind.kit["verdict"], "PASS");
        // The twin listed as an example: a clean example that breaks the rule.
        let wrong = pack(
            json!({"rules": rule, "examples": [bad.clone()], "twins": [{"example": bad, "expect": "row.span"}]}),
            json!({}),
            vec![b],
        );
        let refused = admit(&wrong).expect_err("a clean example breaks its rule");
        assert_eq!(refused[0]["actual"]["part"], "rules", "{refused:?}");
        assert_eq!(refused[0]["actual"]["rule"], "row.span", "{refused:?}");
    }

    #[test]
    fn a_rule_at_times_names_its_first_failing_time_and_a_sweep_at_its_bound_fails() {
        let (twin, t) = example(json!({"w": 2.0, "n": 2}));
        let rules = json!([
            {"code": "row.timed", "expr": "w <= 0.9 * n", "at": [0, "1s"], "fix": "add bars"},
            {"code": "row.swept", "expr": "w <= 0.9 * n", "at": "sweep", "fix": "add bars"},
        ]);
        let manifest = pack(
            json!({"rules": rules, "twins": [{"example": twin, "expect": "row.timed"},
                                             {"example": twin, "expect": "row.swept"}]}),
            json!({}),
            vec![t],
        );
        let packs = admit(&manifest).expect("admitted");
        let doc = json!({"format": 1, "id": "d", "profile": "board", "title": "T", "description": "D",
                         "size": [320, 200], "packs": ["test/row@1.0.0"], "layers": {"main": {"writer": "a", "title": "Main", "order": "a0"}},
                         "items": {"r1": {"id": "r1", "kind": "row.bars@1", "name": "R", "layer": "main", "order": "a0",
                                          "params": {"w": 2.0, "n": 2}}}});
        let checked = super::super::check_packed(&doc, &registry::core(), &packs);
        let issues: Vec<Value> = checked.issues.iter().map(|i| i.to_json()).collect();
        let timed: Vec<&Value> = issues.iter().filter(|i| i["code"] == "row.timed").collect();
        assert_eq!(timed.len(), 1, "{issues:?}");
        assert_eq!(timed[0]["actual"]["t"], 0);
        assert_eq!(
            issues.iter().filter(|i| i["code"] == "row.swept").count(),
            1,
            "{issues:?}"
        );
    }

    #[test]
    fn a_nested_instances_rule_is_raised_once() {
        let (twin, t) = example(json!({"w": 2.0, "n": 2}));
        let rule =
            json!([{"code": "row.span", "expr": "w <= 0.9 * n", "at": "rest", "fix": "add bars"}]);
        let mut manifest = pack(
            json!({"rules": rule, "twins": [{"example": twin, "expect": "row.span"}]}),
            json!({}),
            vec![t],
        );
        manifest["recipes"]["row.shelf@1"] = json!({
            "id": "row.shelf", "version": "1.0",
            "steps": {"inner": {"op": "recipe", "kind": "row.bars@1", "params": {"w": 2.0}}}});
        let packs = admit(&manifest).expect("admitted");
        let doc = json!({"format": 1, "id": "d", "profile": "board", "title": "T", "description": "D",
                         "size": [320, 200], "packs": ["test/row@1.0.0"], "layers": {"main": {"writer": "a", "title": "Main", "order": "a0"}},
                         "items": {"s1": {"id": "s1", "kind": "row.shelf@1", "name": "S", "layer": "main", "order": "a0"}}});
        let checked = super::super::check_packed(&doc, &registry::core(), &packs);
        let spans: Vec<Value> = checked
            .issues
            .iter()
            .map(|i| i.to_json())
            .filter(|i| i["code"] == "row.span")
            .collect();
        assert_eq!(spans.len(), 1, "{spans:?}");
        assert_eq!(spans[0]["ids"], json!(["s1.inner"]));
    }
}
