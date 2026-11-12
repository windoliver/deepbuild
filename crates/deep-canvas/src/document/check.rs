//! The document check: migrations first, then every rule of the document contract over the
//! lowered form, which is returned with the issues, the notices and the draw list.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::pack_kinds::kind_rules;
use super::packs::{self, Expansion, Packs, Resolved};
use super::{
    kind_text, member, sort_issues, sort_notices, Issue, Notice, ADJUST_FIELDS, AT_RELATIONS,
    AT_VECTORS, BOX_POINTS, ENVELOPE_KEYS, ID_MAPS, ITEM_KEYS, ITEM_OWN_FIELDS, MAX_DESCRIPTION,
};
use crate::cost::Coefficients;
use crate::grammar::{
    forms_for, lower_frame_literals, Handle, Id, Path, Refusal, Section, Time, TimeContext,
    UnitContext, UnitLiteral,
};
use crate::kinds::{
    lookup, parse_kind, parse_required, Entry, Lookup, ParamType, Registry, Version,
};
use crate::registry::{self, core_name, Cost, Range, Rule, Sealed, SealedModule};

/// The closed list of item roles.
const ROLES: &[&str] = &["part", "control", "label", "data", "decoration"];
/// The closed list of layer roles (canvas primitives: Layer).
const LAYER_ROLES: &[&str] = &["content", "annotation"];
/// The closed list of document profiles (canvas primitives: Document).
const PROFILES: &[&str] = &[
    "figure", "film", "scene", "world", "view", "board", "sheet", "chart", "cells",
];
/// A layer's keys.
const LAYER_KEYS: &[&str] = &["writer", "title", "order", "role", "locked"];

/// What a check returns.
#[derive(Clone, Debug)]
pub struct CheckResult {
    /// True when no issue of severity `error` was raised.
    pub ok: bool,
    pub issues: Vec<Issue>,
    pub notices: Vec<Notice>,
    /// The IDs of the items that would draw, sorted.
    pub draws: Vec<String>,
    /// The document as the check read it: migrated, skipped fields dropped, literals converted.
    pub lowered: Value,
    /// `core@<version>` of the build that checked (Registry and seal).
    pub core: String,
    /// The module-set digest of that build.
    pub set_digest: String,
    /// Each recipe instance's expansion (Recipe): its key and its derived items, which
    /// `lowered` holds after the instance.
    pub expansions: Vec<Expansion>,
    /// Each pack rule the `kind_rules` check ran, with the pack it came from (#202).
    pub rules_ran: BTreeSet<(String, String)>,
}

impl CheckResult {
    pub fn to_json(&self) -> Value {
        json!({
            "core": self.core,
            "set_digest": self.set_digest,
            "ok": self.ok,
            "issues": self.issues.iter().map(Issue::to_json).collect::<Vec<_>>(),
            "notices": self.notices.iter().map(Notice::to_json).collect::<Vec<_>>(),
            "draws": self.draws,
            "lowered": self.lowered,
            "expansions": self.expansions.iter().map(Expansion::to_json).collect::<Vec<_>>(),
        })
    }
}

/// Checks `doc` in the core's own build.
pub fn check(doc: &Value) -> CheckResult {
    check_in(doc, &registry::core())
}

/// Checks `doc` in the build `sealed` describes: a document that needs a canvas module the
/// build lacks, through `requires.modules`, a kind or a field an absent module evaluates, is
/// refused with `module_missing` naming the module.
pub fn check_in(doc: &Value, sealed: &Sealed) -> CheckResult {
    check_by(doc, sealed, sealed.kinds_ref(), None, &Packs::default())
}

/// [`check_in`] in a build that admitted `packs` (Pack): a document's `packs` resolve through
/// them, and each recipe instance expands at check into its derived items.
pub fn check_packed(doc: &Value, sealed: &Sealed, packs: &Packs) -> CheckResult {
    check_by(doc, sealed, sealed.kinds_ref(), None, packs)
}

/// [`check_in`], estimating a document's cost from `coefficients` rather than the reference
/// Mac's (`deep-show`'s planted check that estimates on its own machine).
pub fn check_costed(doc: &Value, sealed: &Sealed, coefficients: &Coefficients) -> CheckResult {
    check_by(
        doc,
        sealed,
        sealed.kinds_ref(),
        Some(coefficients),
        &Packs::default(),
    )
}

/// Checks `doc` as a build whose kinds are `kinds`, as an earlier release with an older minor
/// of some kind reads it (Document envelope: `requires`); the core's own canvas modules.
pub fn check_with(doc: &Value, kinds: &Registry) -> CheckResult {
    check_by(doc, &registry::core(), kinds, None, &Packs::default())
}

/// Checks `doc` in the build `sealed` describes, reading kinds by `kinds`, estimating its cost
/// from `coefficients` (the sealed set's when `None`).
fn check_by(
    doc: &Value,
    sealed: &Sealed,
    kinds: &Registry,
    coefficients: Option<&Coefficients>,
    packs: &Packs,
) -> CheckResult {
    let mut issues = Vec::new();
    let mut notices = Vec::new();
    let mut draws = Vec::new();
    let mut lowered = copy_of(doc);
    // `fw` and `fh` read the document's design size (Units and axes).
    if let (Some(size), Some(Value::Object(items))) = (frame_of(doc), lowered.get_mut("items")) {
        for item in items.values_mut() {
            if let Some(params) = item.get_mut("params") {
                lower_frame_literals(params, size);
            }
        }
    }

    check_envelope(doc, &mut issues);
    check_transport(doc, &mut issues);
    let required = required_minors(doc, sealed, &mut issues);
    let resolved = packs::resolve(doc, packs, Some(sealed), &mut issues);
    notices.extend(resolved.missing.iter().map(packs::retired::Missing::notice));
    let mut expansions = Vec::new();
    let mut rules_ran = BTreeSet::new();
    // The canvas modules the document declares, which every module kind it uses must be among.
    let declared: BTreeSet<String> = member(doc, "requires")
        .and_then(|r| member(r, "modules"))
        .and_then(Value::as_object)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    // A pack declares the modules its recipes' kinds need, for the items they derive (#306).
    let pack_declared: BTreeSet<String> = resolved.modules().cloned().collect();
    let layer_ids = check_layers(doc, &mut issues);

    match lowered.get_mut("items") {
        None => {}
        Some(Value::Object(items)) => {
            // Whether a kind text migrates is looked up once per text, not once per item.
            let mut migrates: BTreeMap<String, bool> = BTreeMap::new();
            for (key, item) in items.iter_mut() {
                let Some(text) = kind_text(item) else {
                    continue;
                };
                let needed = match migrates.get(text) {
                    Some(needed) => *needed,
                    None => {
                        let needed = matches!(lookup(kinds, text), Lookup::Known { entry, saved }
                            if entry.steps_from(saved).is_some_and(|s| !s.is_empty()));
                        migrates.insert(text.to_string(), needed);
                        needed
                    }
                };
                if needed {
                    migrate_item(key, item, &mut notices, kinds);
                }
            }
            super::pack_kinds::migrate::at_load(items, &resolved, &mut notices);
            // Expansion at check, never per frame (Recipe): the derived items join the lowered
            // items before any item is checked, so they meet the item contract, the module
            // checks and the budget as any item does.
            issues.extend(packs::driven_counts(doc, items, &resolved));
            expansions = packs::expand(items, &resolved, packs.planted, &mut issues);
            // A broken-out item its instance's version no longer derives stays the writer's
            // own, and the load says so (Pack: migrations as data; #1961).
            for e in &expansions {
                for (i, orphan) in &e.orphaned {
                    notices.push(Notice {
                        code: "derived_orphan",
                        ids: vec![orphan.clone(), e.instance.clone()],
                        path: format!("items/{}/broken_out/{i}", e.instance),
                        actual: json!(orphan),
                        what: format!(
                            "{} no longer derives `{orphan}`, broken out of `{}`: it stays the writer's own",
                            e.pack, e.instance
                        ),
                        migration: None,
                        replaced_by: None,
                        close: Vec::new(),
                    });
                }
            }
            // The core's `kind_rules` check: each instance's rules once, after its expansion (#202).
            let rules = kind_rules(doc, items, &expansions, &resolved, packs.planted);
            issues.extend(rules.issues);
            rules_ran = rules.ran;
            let derived: BTreeSet<&str> = expansions
                .iter()
                .flat_map(|e| e.derived.keys().map(String::as_str))
                .collect();
            // The parents as written, for the cycle walk.
            let parents: BTreeMap<String, String> = items
                .iter()
                .filter_map(|(k, v)| {
                    member(v, "parent")
                        .and_then(Value::as_str)
                        .map(|p| (k.clone(), p.to_string()))
                })
                .collect();
            // The lowered items' IDs: the document's, and those expansion wrote. Only a parent
            // that is a string is looked up in them.
            let item_ids: BTreeSet<&str> = if parents.is_empty() {
                BTreeSet::new()
            } else {
                member(doc, "items")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flat_map(|m| m.keys().map(String::as_str))
                    .chain(derived.iter().copied())
                    .collect()
            };
            let mut facts: BTreeMap<String, KindFacts<'_>> = BTreeMap::new();
            for item in items.values() {
                if let Some(text) = kind_text(item) {
                    if !facts.contains_key(text) {
                        let f = KindFacts::of(text, sealed, kinds, &resolved);
                        facts.insert(text.to_string(), f);
                    }
                }
            }
            // #504: an item joins an assembly by naming it as its parent (Assembly).
            let assembly_ids: BTreeSet<&str> = member(doc, "assemblies")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|m| m.keys().map(String::as_str))
                .collect();
            let ctx = ItemContext {
                layer_ids: &layer_ids,
                item_ids: &item_ids,
                assembly_ids: &assembly_ids,
                parents: &parents,
                required: &required,
                declared: &declared,
                pack_declared: &pack_declared,
                derived: &derived,
                sealed,
                kinds,
                facts: &facts,
            };
            // Each item checks on its own, so a big document's items check in chunks across the
            // cores, and the chunks' findings join in item order, as one pass would list them.
            let mut entries: Vec<(&String, &mut Value)> = items.iter_mut().collect();
            let checked = in_chunks(&mut entries, |chunk| {
                let (mut issues, mut notices, mut draws) = (Vec::new(), Vec::new(), Vec::new());
                for (key, item) in chunk.iter_mut() {
                    if check_item(key, item, &ctx, &mut issues, &mut notices) {
                        draws.push((*key).clone());
                    }
                }
                (issues, notices, draws)
            });
            for (i, n, d) in checked {
                issues.extend(i);
                notices.extend(n);
                draws.extend(d);
            }
        }
        Some(other) => issues.push(Issue::envelope(
            "out_of_range",
            "items".into(),
            other.clone(),
            "not an object",
        )),
    }

    // A recipe's channels join the document's, targeting the items it derived (#420).
    let recipe_channels: Map<String, Value> =
        expansions.iter().flat_map(|e| e.channels.clone()).collect();
    if !recipe_channels.is_empty() {
        if let Some(doc) = lowered.as_object_mut() {
            let channels = doc
                .entry("channels")
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(map) = channels.as_object_mut() {
                map.extend(recipe_channels);
            }
        }
    }

    // The module checks, the budget estimate and the document checks read the lowered document
    // alone: a big document's estimate runs on its own thread, beside the others, and the
    // findings join in this order.
    let big = member(&lowered, "items")
        .and_then(Value::as_object)
        .is_some_and(|items| items.len() >= SPLIT_FROM);
    let mut tail = [Tail::Modules, Tail::Budget, Tail::Document];
    let threads = if big { tail.len() } else { 1 };
    let found = in_threads(&mut tail, threads, |part| {
        let (mut issues, mut notices) = (Vec::new(), Vec::new());
        for step in part.iter() {
            match step {
                Tail::Modules => module_checks(&lowered, sealed, &mut issues, &mut notices),
                Tail::Budget => budget_check(&lowered, sealed, coefficients, &mut issues),
                Tail::Document => {
                    check_id_maps(&lowered, &mut issues);
                    check_controls(&lowered, sealed, &mut issues);
                    check_assemblies(&lowered, &mut issues);
                    check_card(&lowered, &mut issues);
                    super::variants::check(&lowered, &mut issues);
                    check_time_remaps(&lowered, &expansions, &mut issues);
                    check_targets(&lowered, "channels", false, kinds, sealed, &mut issues);
                    check_targets(&lowered, "bound_values", true, kinds, sealed, &mut issues);
                    super::rules::check(&lowered, &mut issues, |entries, work| {
                        in_chunks(entries, work)
                    });
                }
            }
        }
        (issues, notices)
    });
    for (i, n) in found {
        issues.extend(i);
        notices.extend(n);
    }

    sort_issues(&mut issues);
    sort_notices(&mut notices);
    draws.sort();
    let ok = !issues.iter().any(|i| i.severity == "error");
    CheckResult {
        ok,
        issues,
        notices,
        draws,
        lowered,
        core: core_name(),
        set_digest: sealed.set_digest.clone(),
        expansions,
        rules_ran,
    }
}

/// The items a document holds before its per-item work splits across threads (AC8 of #306: a
/// 10,000-item document checks in under 50 ms); below it, threads cost more than they save.
const SPLIT_FROM: usize = 2048;

/// Runs `work` over `entries` in one chunk per core, on scoped threads once there are
/// [`SPLIT_FROM`] or more, and returns each chunk's result in order.
fn in_chunks<T: Send, R: Send>(entries: &mut [T], work: impl Fn(&mut [T]) -> R + Sync) -> Vec<R> {
    let threads = if entries.len() < SPLIT_FROM {
        1
    } else {
        std::thread::available_parallelism().map_or(1, |n| n.get().min(8))
    };
    in_threads(entries, threads, work)
}

/// The steps of a check after its items, in their order.
#[derive(Clone, Copy)]
enum Tail {
    Modules,
    Budget,
    Document,
}

/// Runs `work` over `entries` in `threads` chunks, each on a scoped thread when there are two or
/// more, and returns each chunk's result in order.
fn in_threads<T: Send, R: Send>(
    entries: &mut [T],
    threads: usize,
    work: impl Fn(&mut [T]) -> R + Sync,
) -> Vec<R> {
    if threads <= 1 {
        return vec![work(entries)];
    }
    let size = entries.len().div_ceil(threads);
    let work = &work;
    std::thread::scope(|s| {
        let handles: Vec<_> = entries
            .chunks_mut(size)
            .map(|chunk| s.spawn(move || work(chunk)))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
            .collect()
    })
}

/// A copy of `doc` to lower: its items copied in chunks across the cores, in their order.
fn copy_of(doc: &Value) -> Value {
    let Some(Value::Object(items)) = member(doc, "items") else {
        return doc.clone();
    };
    let Some(fields) = doc.as_object() else {
        return doc.clone();
    };
    let mut entries: Vec<(&String, &Value)> = items.iter().collect();
    let parts = in_chunks(&mut entries, |chunk| {
        chunk
            .iter()
            .map(|(k, v)| ((*k).clone(), (*v).clone()))
            .collect::<Vec<_>>()
    });
    let mut copied = Map::with_capacity(items.len());
    for part in parts {
        copied.extend(part);
    }
    let mut out = Map::with_capacity(fields.len());
    for (k, v) in fields {
        let v = if k == "items" {
            Value::Object(std::mem::take(&mut copied))
        } else {
            v.clone()
        };
        out.insert(k.clone(), v);
    }
    Value::Object(out)
}

/// The frame CPU the budget estimate allows a document, in ms (`document.budget`).
pub const FRAME_CPU_MS: f64 = 16.0;

/// The checks canvas modules register over their kinds' items, and the budget estimate over
/// the costs they register: a module's code carries its catalog's fix, and the estimate past
/// the frame's CPU is `over_budget`, naming the items that cost.
fn module_checks(
    lowered: &Value,
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) {
    let Some(items) = member(lowered, "items").and_then(Value::as_object) else {
        return;
    };
    let mut cost = 0.0;
    let mut costly = Vec::new();
    // A document holds few kinds and many items: each kind text's rules and costs are looked up once.
    type Registered<'s> = Option<(Vec<(&'s SealedModule, Rule)>, Vec<Cost>)>;
    let mut by_kind: BTreeMap<&str, Registered<'_>> = BTreeMap::new();
    for (id, item) in items {
        let Some(text) = kind_text(item) else {
            continue;
        };
        let registered = by_kind.entry(text).or_insert_with(|| {
            crate::kinds::parse_kind(text)
                .map(|(full, _)| (sealed.rules_for(&full), sealed.costs_for(&full)))
        });
        let Some((rules, costs)) = registered else {
            continue;
        };
        for &(module, rule) in rules.iter() {
            for r in rule(lowered, id, item) {
                // The value refused at the issue's path, as the document holds it.
                let actual = lowered
                    .pointer(&format!("/{}", r.path))
                    .cloned()
                    .unwrap_or(Value::Null);
                if r.severity == "notice" {
                    notices.push(Notice {
                        code: r.code,
                        ids: vec![id.clone()],
                        path: r.path,
                        actual,
                        what: r.what,
                        migration: None,
                        replaced_by: None,
                        close: Vec::new(),
                    });
                    continue;
                }
                let fix = module
                    .shapes
                    .catalog
                    .iter()
                    .find(|c| c.code == r.code)
                    .map(|c| c.fix.clone());
                // An issue at another item's or a strip's field names it too (#499's av_unlinked).
                let other = ["strips/", "items/"]
                    .iter()
                    .find_map(|p| r.path.strip_prefix(p))
                    .and_then(|p| p.split('/').next())
                    .filter(|o| *o != id)
                    .map(str::to_string);
                let mut issue = Issue::error(r.code, id, r.path, actual, &r.what);
                issue.ids.extend(other);
                issue.severity = if r.severity == "warning" {
                    "warning"
                } else {
                    "error"
                };
                if let Some(fix) = fix {
                    issue.fix = fix;
                }
                issue.fix_ops = r.fix_ops;
                issues.push(issue);
            }
        }
        for c in costs.iter() {
            let ms = c(item);
            if ms > 0.0 {
                cost += ms;
                costly.push(id.clone());
            }
        }
    }
    if cost > FRAME_CPU_MS {
        let mut issue = Issue::envelope(
            "over_budget",
            "items".into(),
            json!(cost),
            &format!("the items cost {cost} ms of CPU a frame, past the {FRAME_CPU_MS} ms budget"),
        );
        issue.severity = "warning";
        issue.ids = costly;
        issues.push(issue);
    }
}

/// The document's `budget.lights` cap (Document envelope: `budget`): every `light.*` item counts,
/// those a recipe derived among them (Recipe: lights count in the budget; #420), and a
/// document with more is refused, naming them.
fn lights_check(lowered: &Value, issues: &mut Vec<Issue>) {
    let Some(given) = member(lowered, "budget").and_then(|b| member(b, "lights")) else {
        return;
    };
    let Some(cap) = given.as_u64() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "budget/lights".into(),
            given.clone(),
            "not a whole number at or above 0",
        ));
        return;
    };
    let lights: Vec<String> = member(lowered, "items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        // A probe (#427) is no light: it captures light and gives none.
        .filter(|(_, item)| {
            kind_text(item)
                .is_some_and(|k| k.starts_with("light.") && !k.starts_with("light.probe@"))
        })
        .map(|(id, _)| id.clone())
        .collect();
    if lights.len() as u64 > cap {
        let mut issue = Issue::envelope(
            "over_budget",
            "budget/lights".into(),
            json!(lights.len()),
            &format!("{} lights, past the document's cap of {cap}", lights.len()),
        );
        issue.ids = lights;
        issues.push(issue);
    }
}

/// The budget estimate (issue #379; canvas primitives: The cost model, "Before it shows"): a
/// document that names its budget class and whose estimated CPU time, GPU time or GPU memory
/// per frame passes one of its caps is refused, naming its top three contributors, with the
/// estimate and the fingerprint of the machine its coefficients were measured on.
fn budget_check(
    lowered: &Value,
    sealed: &Sealed,
    coefficients: Option<&Coefficients>,
    issues: &mut Vec<Issue>,
) {
    lights_check(lowered, issues);
    let Some((class, limits)) = crate::budget::of(lowered) else {
        return;
    };
    let coefficients = coefficients.unwrap_or(&sealed.costs);
    let e = crate::cost::estimate_by(lowered, sealed, coefficients, |entries, work| {
        in_chunks(entries, work)
    });
    let over: Vec<String> = [
        ("CPU", e.cpu_ms, limits.cpu_ms, "ms"),
        ("GPU", e.gpu_ms, limits.gpu_ms, "ms"),
        (
            "GPU memory",
            e.gpu_mb,
            Some(limits.gpu_bytes as f64 / 1e6),
            "MB",
        ),
    ]
    .iter()
    .filter_map(|(what, est, cap, unit)| {
        cap.filter(|c| est > c)
            .map(|c| format!("{what} {est:.3} {unit} past {c} {unit}"))
    })
    .collect();
    if over.is_empty() {
        return;
    }
    let mut issue = Issue::envelope(
        "over_budget",
        "budget".into(),
        json!({
            "cpu_ms": e.cpu_ms, "gpu_ms": e.gpu_ms, "gpu_mb": e.gpu_mb,
            "fingerprint": coefficients.fingerprint,
        }),
        &format!(
            "the document's estimate per frame passes its {} class: {}",
            class.name(),
            over.join(", ")
        ),
    );
    issue.ids = e.top(3);
    issues.push(issue);
}

/// The issues of `doc`, a patch's result that changed only the items `changed`, re-checked
/// incrementally from `prev_issues`, the issues of the revision it was applied to (Patch: "re-checked incrementally"; the patch fuzzer's fifth
/// law: the same issues, by code, IDs and path, as a full check). The items the patch changed are
/// checked again, with those hanging from them and those whose params name one of them, in a
/// document of only them and what they read (their ancestors, the items their params name and the
/// camera); every other item keeps its issues. `None` when a full check is needed: the document
/// holds entries of other maps keyed by ID, which read items by path. A patch that reached
/// beyond items (a layer added) takes a full check, which the caller runs. Checked in the build
/// `sealed` describes, as [`check_in`] checks.
pub fn recheck(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
) -> Option<Vec<Issue>> {
    recheck_by(doc, prev_issues, changed, sealed, Reach::Scan)
}

/// [`recheck`], finding the items that hang from the changed ones or name one by `referrers`
/// rather than by passes over every item (#896: "the patch path checks and records only what the
/// patch touches"). `referrers` describes the document the patch was applied to, or the result:
/// an item the patch left alone names and hangs from the same items in both, and every item it
/// changed is checked again whatever names it.
pub fn recheck_with(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
    referrers: &Referrers,
) -> Option<Vec<Issue>> {
    recheck_by(doc, prev_issues, changed, sealed, Reach::Index(referrers))
}

/// Each string an item's params hold, at any depth, with the items that hold it, and each
/// item's children: what a recheck reads to find the items a change reaches (#896).
#[derive(Clone, Debug, Default)]
pub struct Referrers {
    named_by: BTreeMap<String, BTreeSet<String>>,
    children: BTreeMap<String, BTreeSet<String>>,
}

impl Referrers {
    pub fn of(doc: &Value) -> Referrers {
        let mut out = Referrers::default();
        for (id, item) in member(doc, "items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            out.update(id, None, Some(item));
        }
        out
    }

    /// Moves `id`'s entries from the item it was to the item it is.
    pub fn update(&mut self, id: &str, was: Option<&Value>, now: Option<&Value>) {
        for (item, add) in [(was, false), (now, true)] {
            let Some(item) = item else { continue };
            let entry = |map: &mut BTreeMap<String, BTreeSet<String>>, key: &str| {
                if add {
                    map.entry(key.to_string())
                        .or_default()
                        .insert(id.to_string());
                } else if let Some(set) = map.get_mut(key) {
                    set.remove(id);
                }
            };
            if let Some(params) = member(item, "params") {
                strings_in(params, &mut |s| entry(&mut self.named_by, s));
            }
            if let Some(parent) = member(item, "parent").and_then(Value::as_str) {
                entry(&mut self.children, parent);
            }
        }
    }
}

/// How a recheck finds the items a change reaches beyond those it changed.
#[derive(Clone, Copy)]
enum Reach<'a> {
    /// Passes over every item.
    Scan,
    Index(&'a Referrers),
    /// The planted recheck: none.
    ChangedOnly,
}

/// [`recheck`]'s planted wrong program (the conformance kit's fifth law): the items the patch
/// changed are checked again, and those that hang from them or name them are not.
pub fn recheck_skipping_referrers(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
) -> Option<Vec<Issue>> {
    recheck_by(doc, prev_issues, changed, sealed, Reach::ChangedOnly)
}

fn recheck_by(
    doc: &Value,
    prev_issues: &[Issue],
    changed: &BTreeSet<String>,
    sealed: &Sealed,
    reach: Reach<'_>,
) -> Option<Vec<Issue>> {
    let after = doc.as_object()?;
    let maps_empty = ID_MAPS.iter().all(|m| {
        member(doc, m)
            .and_then(Value::as_object)
            .is_none_or(Map::is_empty)
    });
    // The budget estimate sums the whole document, so a build whose modules cost needs it whole;
    // a document that names packs expands at check, so a patch to it re-expands whole.
    let packed = member(doc, "packs")
        .and_then(Value::as_array)
        .is_some_and(|p| !p.is_empty());
    if !maps_empty || sealed.has_costs() || packed {
        return None;
    }
    let items = member(doc, "items")?.as_object()?;
    // The items to check again: those changed, those whose params name one, and below them, in
    // passes over the items until a pass adds none. The planted wrong program checks the changed
    // items alone.
    let mut affected: BTreeSet<String> = changed.clone();
    if let Reach::Index(refs) = reach {
        affected.extend(
            changed
                .iter()
                .filter_map(|id| refs.named_by.get(id))
                .flatten()
                .cloned(),
        );
        let mut below: Vec<String> = affected.iter().cloned().collect();
        while let Some(id) = below.pop() {
            for child in refs.children.get(&id).into_iter().flatten() {
                if affected.insert(child.clone()) {
                    below.push(child.clone());
                }
            }
        }
    } else if let Reach::Scan = reach {
        affected.extend(
            items
                .iter()
                .filter(|(_, item)| member(item, "params").is_some_and(|p| names_any(p, changed)))
                .map(|(id, _)| id.clone()),
        );
        loop {
            let more: Vec<&String> = items
                .iter()
                .filter(|(id, item)| {
                    !affected.contains(*id)
                        && member(item, "parent")
                            .and_then(Value::as_str)
                            .is_some_and(|p| affected.contains(p))
                })
                .map(|(id, _)| id)
                .collect();
            if more.is_empty() {
                break;
            }
            affected.extend(more.into_iter().cloned());
        }
    }
    // What they read: their ancestors, the items their params name, and the camera.
    let mut context: BTreeSet<String> = affected.clone();
    if let Some(camera) = member(doc, "camera").and_then(Value::as_str) {
        context.insert(camera.to_string());
    }
    for id in &affected {
        let Some(item) = items.get(id) else { continue };
        if let Some(params) = member(item, "params") {
            strings_in(params, &mut |s| {
                if items.contains_key(s) {
                    context.insert(s.to_string());
                }
            });
        }
        let mut at = member(item, "parent").and_then(Value::as_str);
        while let Some(p) = at.filter(|p| context.insert(p.to_string())) {
            at = items
                .get(p)
                .and_then(|i| member(i, "parent"))
                .and_then(Value::as_str);
        }
    }
    // #499: the items that play an asset an affected item plays (a video's picture and its
    // sound strip, by the asset's hash), which a check links them by.
    let mut assets: BTreeSet<String> = BTreeSet::new();
    for id in &affected {
        if let Some(params) = items.get(id).and_then(|i| member(i, "params")) {
            strings_in(params, &mut |s| {
                if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
                    assets.insert(s.to_string());
                }
            });
        }
    }
    if !assets.is_empty() {
        for (id, item) in items {
            if member(item, "params").is_some_and(|p| names_any(p, &assets)) {
                context.insert(id.clone());
            }
        }
    }
    let mut reduced = Map::new();
    for (k, v) in after {
        if k != "items" {
            reduced.insert(k.clone(), v.clone());
        }
    }
    let subset: Map<String, Value> = context
        .iter()
        .filter_map(|id| Some((id.clone(), items.get(id)?.clone())))
        .collect();
    reduced.insert("items".into(), Value::Object(subset));
    let fresh = check_in(&Value::Object(reduced), sealed).issues;
    let touches = |i: &Issue| i.ids.iter().any(|id| affected.contains(id));
    let mut out: Vec<Issue> = prev_issues
        .iter()
        .filter(|i| !touches(i))
        .cloned()
        .chain(fresh.into_iter().filter(|i| touches(i)))
        .collect();
    sort_issues(&mut out);
    Some(out)
}

/// Calls `f` with each string `value` holds, at any depth.
fn strings_in(value: &Value, f: &mut dyn FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(list) => list.iter().for_each(|v| strings_in(v, f)),
        Value::Object(map) => map.values().for_each(|v| strings_in(v, f)),
        _ => {}
    }
}

/// Whether `value` holds, at any depth, a string in `ids`.
fn names_any(value: &Value, ids: &BTreeSet<String>) -> bool {
    match value {
        Value::String(s) => ids.contains(s),
        Value::Array(list) => list.iter().any(|v| names_any(v, ids)),
        Value::Object(map) => map.values().any(|v| names_any(v, ids)),
        _ => false,
    }
}

fn check_envelope(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(envelope) = doc.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            String::new(),
            doc.clone(),
            "a document is an object",
        ));
        return;
    };
    // The envelope's fields without a default (Document envelope, and the shape, which writes
    // `layers` and `items` in every canonical form): absent is out of range, since a document
    // with no profile or size has nothing to check against, and one with no `layers` or `items`
    // would differ in bytes and hash from one with them empty. The other maps keyed by ID
    // default to empty.
    for key in [
        "format",
        "id",
        "profile",
        "title",
        "description",
        "size",
        "layers",
        "items",
    ] {
        if !envelope.contains_key(key) {
            issues.push(Issue::envelope(
                "out_of_range",
                key.into(),
                Value::Null,
                "required, and absent",
            ));
        }
    }
    for (key, value) in envelope {
        if !ENVELOPE_KEYS.contains(&key.as_str()) {
            issues.push(Issue::envelope(
                "unknown_field",
                key.clone(),
                value.clone(),
                "not a field of the document envelope",
            ));
        }
    }
    if let Some(format) = envelope.get("format") {
        if format.as_f64() != Some(1.0) {
            issues.push(Issue::envelope(
                "out_of_range",
                "format".into(),
                format.clone(),
                "format is 1",
            ));
        }
    }
    if let Some(description) = envelope.get("description") {
        match description.as_str() {
            Some(s) if s.chars().count() <= MAX_DESCRIPTION => {}
            Some(_) => issues.push(Issue::envelope(
                "out_of_range",
                "description".into(),
                description.clone(),
                "longer than 400 characters",
            )),
            // The closed code list has no type code: a value of the wrong type is out of the
            // field's range.
            None => issues.push(Issue::envelope(
                "out_of_range",
                "description".into(),
                description.clone(),
                "not a string",
            )),
        }
    }
    for key in ["id", "profile", "title"] {
        if let Some(value) = envelope.get(key) {
            if !value.is_string() {
                issues.push(Issue::envelope(
                    "out_of_range",
                    key.into(),
                    value.clone(),
                    "not a string",
                ));
            }
        }
    }
    // `id: ID`: the one ID grammar, as every key keyed by ID.
    if let Some(Value::String(id)) = envelope.get("id") {
        if let Err(r) = Id::parse(id) {
            issues.push(Issue::envelope("bad_id", "id".into(), json!(id), &r.what));
        }
    }
    if let Some(Value::String(profile)) = envelope.get("profile") {
        if !PROFILES.contains(&profile.as_str()) {
            issues.push(Issue::envelope(
                "out_of_range",
                "profile".into(),
                json!(profile),
                &format!("not a profile; one of {}", PROFILES.join(", ")),
            ));
        }
    }
    if let Some(size) = envelope.get("size") {
        if !is_vector(size, 2) {
            issues.push(Issue::envelope(
                "out_of_range",
                "size".into(),
                size.clone(),
                "not two numbers finite at f32",
            ));
        }
    }
}

/// `requires` (Document envelope: `{core: semver, kinds: [family.name@major.minor], modules:
/// {canvas module → semver range}, preview: [name@major]}`) checked as a closed object, and
/// `requires.kinds` read: the highest minor the document requires of each kind at each major,
/// keyed `family.name@major`; a minor is a schema of one major, so it says nothing about another.
fn required_minors(doc: &Value, sealed: &Sealed, issues: &mut Vec<Issue>) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    let Some(requires) = member(doc, "requires") else {
        return out;
    };
    let Some(fields) = requires.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "requires".into(),
            requires.clone(),
            "not an object",
        ));
        return out;
    };
    for (field, value) in fields {
        let path = format!("requires/{field}");
        let wrong = |what: &str| Issue::envelope("out_of_range", path.clone(), value.clone(), what);
        match field.as_str() {
            "kinds" => {}
            "core" => {
                if !value.is_string() {
                    issues.push(wrong("not a version"));
                }
            }
            "modules" => match value.as_object() {
                Some(modules) => {
                    for (module, range) in modules {
                        // A key that is no module name is the document's fault, not a
                        // module this build lacks.
                        if !registry::well_named(module) {
                            // An empty key has no path segment of its own.
                            let (at, what) = if module.is_empty() {
                                (path.clone(), "has an empty module name")
                            } else {
                                (format!("{path}/{module}"), "not a module name")
                            };
                            issues.push(Issue::envelope("out_of_range", at, range.clone(), what));
                            continue;
                        }
                        let parsed = range.as_str().and_then(Range::parse);
                        let Some(parsed) = parsed else {
                            issues.push(Issue::envelope(
                                "out_of_range",
                                format!("{path}/{module}"),
                                range.clone(),
                                "not a version range",
                            ));
                            continue;
                        };
                        // An absent module is `module_missing` (the check is BLOCKED); a
                        // present one at a version outside the range is the document's
                        // fault, `out_of_range`.
                        if !sealed.satisfies(module, &parsed) {
                            let (code, what) = match sealed.module(module) {
                                None => (
                                    "module_missing",
                                    format!(
                                        "the document requires the {module} module, which this build lacks"
                                    ),
                                ),
                                Some(m) => (
                                    "out_of_range",
                                    format!(
                                        "the document requires the {module} module at {parsed}; this build has {}",
                                        m.version
                                    ),
                                ),
                            };
                            issues.push(Issue::envelope(
                                code,
                                format!("{path}/{module}"),
                                range.clone(),
                                &what,
                            ));
                        }
                    }
                }
                None => issues.push(wrong("not an object")),
            },
            "preview" => match value.as_array() {
                Some(names) => {
                    for (i, name) in names.iter().enumerate() {
                        if !name.is_string() {
                            issues.push(Issue::envelope(
                                "out_of_range",
                                format!("{path}/{i}"),
                                name.clone(),
                                "not a name@major",
                            ));
                        }
                    }
                }
                None => issues.push(wrong("not a list")),
            },
            _ => issues.push(Issue::envelope(
                "unknown_field",
                path.clone(),
                value.clone(),
                "not a field of requires",
            )),
        }
    }
    let Some(kinds) = member(requires, "kinds") else {
        return out;
    };
    let Some(list) = kinds.as_array() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "requires/kinds".into(),
            kinds.clone(),
            "not a list",
        ));
        return out;
    };
    for (i, entry) in list.iter().enumerate() {
        match entry.as_str().and_then(parse_required) {
            Some((name, major, minor)) => {
                let slot = out.entry(format!("{name}@{major}")).or_insert(0);
                *slot = (*slot).max(minor);
            }
            None => issues.push(Issue::envelope(
                "out_of_range",
                format!("requires/kinds/{i}"),
                entry.clone(),
                "not `family.name@major.minor`",
            )),
        }
    }
    out
}

fn check_layers(doc: &Value, issues: &mut Vec<Issue>) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let Some(layers) = member(doc, "layers") else {
        return ids;
    };
    let Some(layers) = layers.as_object() else {
        issues.push(Issue::envelope(
            "out_of_range",
            "layers".into(),
            layers.clone(),
            "not an object",
        ));
        return ids;
    };
    for (key, layer) in layers {
        ids.insert(key.clone());
        check_key("layers", key, issues);
        let Some(fields) = layer.as_object() else {
            issues.push(Issue::envelope(
                "out_of_range",
                format!("layers/{key}"),
                layer.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !LAYER_KEYS.contains(&field.as_str()) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    format!("layers/{key}/{field}"),
                    value.clone(),
                    "not a field of a layer",
                ));
            }
        }
        for field in ["writer", "title", "order"] {
            if !fields.get(field).is_some_and(Value::is_string) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/{field}"),
                    fields.get(field).cloned().unwrap_or(Value::Null),
                    "not a string",
                ));
            }
        }
        if let Some(role) = fields.get("role") {
            if !role.as_str().is_some_and(|r| LAYER_ROLES.contains(&r)) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/role"),
                    role.clone(),
                    "not a layer role",
                ));
            }
        }
        if let Some(locked) = fields.get("locked") {
            if !locked.is_boolean() {
                issues.push(Issue::envelope(
                    "out_of_range",
                    format!("layers/{key}/locked"),
                    locked.clone(),
                    "not a boolean",
                ));
            }
        }
    }
    // One writer, one layer: apply stamps the writer's layer, so two layers with one writer
    // would make a patch's outcome depend on the layers' order.
    // The layer first by ID keeps the writer, whatever order the file lists them in.
    let mut writers: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (key, layer) in layers {
        if let Some(writer) = member(layer, "writer").and_then(Value::as_str) {
            writers.entry(writer).or_default().insert(key);
        }
    }
    for (writer, keys) in &writers {
        let mut keys = keys.iter();
        let Some(first) = keys.next() else {
            continue;
        };
        for key in keys {
            issues.push(Issue::envelope(
                "out_of_range",
                format!("layers/{key}/writer"),
                json!(writer),
                &format!("layer `{first}` has this writer too"),
            ));
        }
    }
    ids
}

/// Runs an item's migrations in place, one major a step, with a notice per step. The check runs
/// it on its lowered copy at load; `apply` runs it on the stored document for the writer's own
/// items once a patch of theirs goes through.
pub(super) fn migrate_item(
    key: &str,
    item: &mut Value,
    notices: &mut Vec<Notice>,
    registry: &Registry,
) {
    let Some(Lookup::Known { entry, saved }) = kind_text(item).map(|t| lookup(registry, t)) else {
        return;
    };
    let Some(steps) = entry.steps_from(saved).filter(|s| !s.is_empty()) else {
        return;
    };
    let text = kind_text(item).unwrap_or_default().to_string();
    let Some(fields) = item.as_object_mut() else {
        return;
    };
    for step in steps {
        if let Some(Value::Object(params)) = fields.get_mut("params") {
            crate::kinds::migrate_step(step, params);
        }
        fields.insert(
            "kind".into(),
            json!(format!("{}@{}", entry.full_name(), step.to)),
        );
        notices.push(Notice {
            code: "migrated",
            ids: vec![key.to_string()],
            path: format!("items/{key}/kind"),
            actual: json!(text),
            what: format!(
                "migrated {} from major {} to {}",
                entry.full_name(),
                step.from,
                step.to
            ),
            migration: Some((entry.full_name(), step.from, step.to)),
            replaced_by: None,
            close: Vec::new(),
        });
    }
}

struct ItemContext<'a> {
    layer_ids: &'a BTreeSet<String>,
    item_ids: &'a BTreeSet<&'a str>,
    assembly_ids: &'a BTreeSet<&'a str>,
    parents: &'a BTreeMap<String, String>,
    required: &'a BTreeMap<String, u32>,
    declared: &'a BTreeSet<String>,
    /// The modules the document's packs declare, which cover the items they derive.
    pack_declared: &'a BTreeSet<String>,
    /// The IDs expansion wrote.
    derived: &'a BTreeSet<&'a str>,
    sealed: &'a Sealed,
    kinds: &'a Registry,
    /// What the build says about each kind text the lowered items write.
    facts: &'a BTreeMap<String, KindFacts<'a>>,
}

/// The canvas modules whose kinds a document uses without naming the module in
/// `requires.modules`.
const UNDECLARED_MODULES: &[&str] = &["logic"];

/// What the build says about one kind text, worked out once per check: a document holds few
/// kinds and many items.
struct KindFacts<'a> {
    /// A recipe instance's kind (Recipe): expansion checked it, and it draws nothing itself.
    instance: bool,
    /// The canvas module this build lacks that evaluates the kind, outside instances.
    missing: Option<String>,
    /// The sealed module that registered the kind, outside instances.
    module: Option<&'a str>,
    lookup: Lookup<'a>,
    /// `(deprecated_since, replaced_by)` when a module deprecated the kind.
    deprecation: Option<&'a (String, String)>,
    /// The close names an unknown kind's notice names (#412).
    close: Vec<Value>,
    /// Of a pack the document names and this build lacks: kept as written, skipped (#1958).
    pack_missing: bool,
}

impl<'a> KindFacts<'a> {
    fn of(text: &str, sealed: &'a Sealed, kinds: &'a Registry, resolved: &Resolved<'_>) -> Self {
        let instance = resolved.recipe(text).is_some();
        let name = parse_kind(text).filter(|_| !instance).map(|(name, _)| name);
        let lookup = lookup(kinds, text);
        KindFacts {
            instance,
            missing: name.as_deref().and_then(|n| sealed.missing_for_kind(n)),
            module: name.as_deref().and_then(|n| sealed.module_of_kind(n)),
            lookup,
            deprecation: match lookup {
                Lookup::Known { entry, .. } => sealed.deprecation_of(&entry.full_name()),
                _ => None,
            },
            close: match lookup {
                Lookup::UnknownKind if !instance => {
                    super::close::kind_names(text, kinds, sealed.close_fault)
                }
                _ => Vec::new(),
            },
            pack_missing: packs::retired::skipped(text, resolved),
        }
    }
}

/// Checks one lowered item in place; true when it draws.
fn check_item(
    key: &str,
    item: &mut Value,
    ctx: &ItemContext<'_>,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) -> bool {
    let at = |field: &str| format!("items/{key}/{field}");
    let Some(fields) = item.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}"),
            item.clone(),
            "not an object",
        ));
        return false;
    };
    if let Some(why) = crate::grammar::id_fault(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            format!("items/{key}"),
            json!(key),
            &format!("`{key}`: {why}"),
        ));
    }
    let Some(text) = kind_text(item) else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            at("kind"),
            fields.get("kind").cloned().unwrap_or(Value::Null),
            "not a string",
        ));
        return false;
    };
    // A recipe instance (Recipe): expansion checked its params against the recipe's inputs and
    // wrote its derived items, which draw in its place; the instance itself draws nothing.
    let Some(facts) = ctx.facts.get(text) else {
        return false;
    };
    // An instance of a pack this build lacks: its pack's notice names it, and nothing of it is
    // read past its kind (#1958).
    if facts.pack_missing {
        return false;
    }
    let instance = facts.instance;
    if let Some(value) = fields.get("broken_out").filter(|_| !instance) {
        issues.push(Issue::error(
            "unknown_field",
            key,
            at("broken_out"),
            value.clone(),
            "only a recipe instance lists the derived items a patch broke out",
        ));
    }
    // A kind of a canvas module this build lacks is refused, naming the module, and nothing of
    // the item is read past its kind: a logic program's bytes, for one, are never opened. Text
    // outside the kind grammar is no module's kind; the lookup below refuses it.
    if let Some(module) = &facts.missing {
        issues.push(Issue::error(
            "module_missing",
            key,
            at("kind"),
            json!(text),
            &format!("kind `{text}` is evaluated by the {module} module, which this build lacks"),
        ));
        return false;
    }
    // A document declares the canvas modules its kinds need (Document envelope), so a
    // build without the module has the name to refuse with. Logic `logic@1` items need no
    // declaration (Document envelope: `requires`); one the build lacks is refused above.
    if let Some(module) = facts.module.filter(|m| !UNDECLARED_MODULES.contains(m)) {
        let by_pack = ctx.derived.contains(key) && ctx.pack_declared.contains(module);
        if !ctx.declared.contains(module) && !by_pack {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at("kind"),
                json!(text),
                &format!(
                    "kind `{text}` is the `{module}` module's, and `requires.modules` does not name it"
                ),
            ));
            return false;
        }
    }
    // The kind decides the params alone: an item of a kind this build does not know, or knows
    // only at a lower major, still meets the item contract core defines (its keys, its id, its
    // layer and parent, its common fields), and is kept byte for byte, its params unread.
    let known = match facts.lookup {
        Lookup::UnknownKind if instance => None,
        Lookup::UnknownKind => {
            notices.push(Notice {
                code: "unknown_kind",
                ids: vec![key.to_string()],
                path: at("kind"),
                actual: json!(text),
                what: format!("kind `{text}` is not registered in this build; the item is skipped"),
                migration: None,
                replaced_by: None,
                close: facts.close.clone(),
            });
            None
        }
        Lookup::Malformed => {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at("kind"),
                json!(text),
                "not family.name@major",
            ));
            None
        }
        Lookup::TooNew { entry, saved } => {
            issues.push(Issue::error(
                "kind_too_new",
                key,
                at("kind"),
                json!(text),
                &format!(
                    "{} is at major {} in this build, below {saved}",
                    entry.full_name(),
                    entry.current().major
                ),
            ));
            None
        }
        Lookup::Known { entry, saved } => Some((entry, saved)),
    };
    // A deprecated kind still loads, and says so, naming what replaces it.
    if known.is_some() {
        if let Some((since, replaced_by)) = facts.deprecation {
            notices.push(Notice {
                code: "deprecated",
                ids: vec![key.to_string()],
                path: at("kind"),
                actual: json!(text),
                what: format!("kind `{text}` is deprecated since {since}; use {replaced_by}"),
                migration: None,
                replaced_by: Some((replaced_by.clone(), since.clone())),
                close: Vec::new(),
            });
        }
    }

    for (field, value) in fields {
        if !ITEM_KEYS.contains(&field.as_str()) {
            issues.push(Issue::error(
                "unknown_field",
                key,
                at(field),
                value.clone(),
                "not a field of an item",
            ));
        }
    }
    if fields.get("id").and_then(Value::as_str) != Some(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            at("id"),
            fields.get("id").cloned().unwrap_or(Value::Null),
            "an item's id equals its key",
        ));
    }
    match fields.get("layer").and_then(Value::as_str) {
        Some(layer) if ctx.layer_ids.contains(layer) => {}
        _ => issues.push(Issue::error(
            "ref_unresolved",
            key,
            at("layer"),
            fields.get("layer").cloned().unwrap_or(Value::Null),
            "names no layer of the document",
        )),
    }
    match fields.get("parent") {
        None | Some(Value::Null) => {}
        Some(Value::String(parent)) if ctx.item_ids.contains(parent.as_str()) => {
            if has_cycle(key, ctx.parents) {
                issues.push(Issue::error(
                    "cycle",
                    key,
                    at("parent"),
                    json!(parent),
                    "the parents lead back to the item",
                ));
            }
        }
        Some(Value::String(parent)) if ctx.assembly_ids.contains(parent.as_str()) => {}
        Some(parent) => issues.push(Issue::error(
            "ref_unresolved",
            key,
            at("parent"),
            parent.clone(),
            "names no item or assembly of the document",
        )),
    }
    for field in ["name", "order"] {
        if !fields.get(field).is_some_and(Value::is_string) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at(field),
                fields.get(field).cloned().unwrap_or(Value::Null),
                "not a string",
            ));
        }
    }
    if let Some(role) = fields.get("role") {
        if !role.as_str().is_some_and(|r| ROLES.contains(&r)) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                at("role"),
                role.clone(),
                "not one of part, control, label, data, decoration",
            ));
        }
    }
    for field in ["visible", "pickable"] {
        if let Some(value) = fields.get(field) {
            if !value.is_boolean() {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    at(field),
                    value.clone(),
                    "not a boolean",
                ));
            }
        }
    }
    if let Some(at_value) = fields.get("at") {
        check_at(key, at_value, issues);
    }
    if let Some(adjust) = fields.get("adjust") {
        check_adjust(key, adjust, issues);
    }

    // `params` is always written, even `{}`, whatever the kind; only its members wait for one.
    if !fields.get("params").is_some_and(Value::is_object) {
        issues.push(Issue::error(
            "out_of_range",
            key,
            at("params"),
            fields.get("params").cloned().unwrap_or(Value::Null),
            "not an object",
        ));
    }
    let Some((entry, major)) = known else {
        return false;
    };
    // After migration the lowered kind is the build's major; a kind no step reaches stays at
    // its saved schema.
    let version = entry.version(major).unwrap_or(entry.current());

    // Params: the schema decides each one; the lowered form gets converted literals and loses
    // the fields a required newer minor skips.
    let required_minor = if ctx.required.is_empty() {
        None
    } else {
        ctx.required
            .get(&format!("{}@{}", entry.full_name(), version.major))
            .copied()
    };
    let Some(fields) = item.as_object_mut() else {
        return false;
    };
    if let Some(Value::Object(params)) = fields.get_mut("params") {
        check_params(
            key,
            params,
            entry,
            version,
            required_minor,
            ctx.sealed,
            ctx.kinds,
            issues,
            notices,
        );
    }
    true
}

/// True when following parents from `start` returns to it.
fn has_cycle(start: &str, parents: &BTreeMap<String, String>) -> bool {
    let mut at = start;
    for _ in 0..=parents.len() {
        match parents.get(at) {
            Some(next) if next == start => return true,
            Some(next) => at = next,
            None => return false,
        }
    }
    false
}

fn check_at(key: &str, at_value: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = at_value.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/at"),
            at_value.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/at/{name}");
        if name == "pivot" && value.is_string() {
            if !value.as_str().is_some_and(|p| BOX_POINTS.contains(&p)) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not a box point (n ne e se s sw w nw c)",
                ));
            }
        } else if name == "place" {
            check_place(key, value, issues);
        } else if name == "align" {
            check_align(key, value, issues);
        } else if AT_VECTORS.contains(&name.as_str()) {
            if !is_vector(value, 3) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not three numbers finite at f32",
                ));
            }
        } else if name == "shear" {
            if !fits_f32(value) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not a number finite at f32",
                ));
            }
        } else if name == "anchor" {
            // `ID#anchor`: a mark set's `#head`, drawn at the revealed end (Item and kind).
            if !value.as_str().is_some_and(|a| a.contains('#')) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not `ID#anchor`",
                ));
            }
        } else {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a member of at in this slice",
            ));
        }
    }
}

/// A relation's target: an item ID with an optional `#part`, or a point `[u, u]`; `frame` too
/// where `frame` is allowed.
fn relation_target(value: &Value, frame: bool) -> bool {
    match value {
        Value::String(s) => (frame && s == "frame") || !s.is_empty(),
        v => is_vector(v, 2),
    }
}

/// `at.place` (Item and kind: relations): exactly one of `beside`, `edge` and `onto`, with the
/// members its form takes, sides and points from the box points.
fn check_place(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    let base = format!("items/{key}/at/place");
    let mut fault = |path: String, v: &Value, why: &str, code: &'static str| {
        issues.push(Issue::error(code, key, path, v.clone(), why));
    };
    let Some(place) = value.as_object() else {
        return fault(base, value, "not an object", "out_of_range");
    };
    let forms: Vec<&str> = ["beside", "edge", "onto"]
        .into_iter()
        .filter(|f| place.contains_key(*f))
        .collect();
    let members: &[&str] = match forms.as_slice() {
        ["beside"] => &["beside", "side", "gap", "align", "own"],
        ["edge"] => &["edge", "margin"],
        ["onto"] => &["onto", "point"],
        _ => {
            return fault(
                base,
                value,
                "not exactly one of beside, edge and onto",
                "out_of_range",
            )
        }
    };
    let side = |v: &Value| {
        v.as_str()
            .is_some_and(|s| s != "c" && BOX_POINTS.contains(&s))
    };
    for (name, v) in place {
        let path = format!("{base}/{name}");
        let ok = match name.as_str() {
            n if !members.contains(&n) => {
                fault(path, v, "not a member of this placement", "unknown_field");
                continue;
            }
            "beside" | "onto" => relation_target(v, false),
            "edge" | "side" => side(v),
            "point" => v.as_str().is_some_and(|s| BOX_POINTS.contains(&s)),
            "gap" | "margin" => fits_f32(v),
            "align" => v
                .as_str()
                .is_some_and(|s| ["start", "center", "end", "baseline"].contains(&s)),
            _ => v.as_str().is_some_and(|s| !s.is_empty()),
        };
        if !ok {
            fault(path, v, "not a value this member takes", "out_of_range");
        }
    }
}

/// `at.align`: at most two `{to, side}`, each moving the item along one axis.
fn check_align(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    let base = format!("items/{key}/at/align");
    let list = match value.as_array() {
        Some(list) if list.len() <= 2 => list,
        _ => {
            issues.push(Issue::error(
                "out_of_range",
                key,
                base,
                value.clone(),
                "not a list of at most two",
            ));
            return;
        }
    };
    for (i, a) in list.iter().enumerate() {
        let to = a.get("to").is_some_and(|t| relation_target(t, true));
        let side = a
            .get("side")
            .and_then(Value::as_str)
            .is_some_and(|s| ["n", "s", "e", "w", "cx", "cy"].contains(&s));
        let only = a
            .as_object()
            .is_some_and(|o| o.keys().all(|k| k == "to" || k == "side"));
        if !(to && side && only) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{base}/{i}"),
                a.clone(),
                "not {to, side}",
            ));
        }
    }
}

/// An item's `adjust`: its known channels, each a number in range (`tint` a look role, `invert` a
/// bool); opacity in 0..1, gamma above 0 and the rest that scale never below 0.
fn check_adjust(key: &str, adjust: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = adjust.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/adjust"),
            adjust.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/adjust/{name}");
        if !ADJUST_FIELDS.contains(&name.as_str()) {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a channel of adjust",
            ));
            continue;
        }
        let (fits, what) = match name.as_str() {
            "invert" => (value.is_boolean(), "not a boolean"),
            "tint" => (value.is_string(), "not a look role"),
            "opacity" => (
                value.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v)),
                "not a number in 0..1",
            ),
            "gamma" => (
                fits_f32(value) && value.as_f64().is_some_and(|v| v > 0.0),
                "not a number above 0",
            ),
            "hue" | "exposure" => (fits_f32(value), "not a number finite at f32"),
            _ => (
                fits_f32(value) && value.as_f64().is_some_and(|v| v >= 0.0),
                "not a number at or above 0",
            ),
        };
        if !fits {
            issues.push(Issue::error("out_of_range", key, path, value.clone(), what));
        }
    }
}

/// A number an f32 field holds: finite at that width, as the canonical form requires, so a
/// document the check passes always has a revision hash.
fn fits_f32(value: &Value) -> bool {
    value.as_f64().is_some_and(|f| (f as f32).is_finite())
}

/// `n` numbers of an f32 vector (`size`, the `at` vectors).
fn is_vector(value: &Value, n: usize) -> bool {
    value
        .as_array()
        .is_some_and(|a| a.len() == n && a.iter().all(fits_f32))
}

#[allow(clippy::too_many_arguments)]
fn check_params(
    key: &str,
    params: &mut Map<String, Value>,
    entry: &Entry,
    version: &Version,
    required_minor: Option<u32>,
    sealed: &Sealed,
    kinds: &Registry,
    issues: &mut Vec<Issue>,
    notices: &mut Vec<Notice>,
) {
    let mut dropped = Vec::new();
    let mut converted = Vec::new();
    for (name, value) in params.iter() {
        let path = || format!("items/{key}/params/{name}");
        let Some(param) = version.param(name) else {
            if required_minor.is_some_and(|m| m > version.minor) {
                notices.push(Notice {
                    code: "unknown_field",
                    ids: vec![key.to_string()],
                    path: path(),
                    actual: value.clone(),
                    what: format!(
                        "{}@{}.{} does not define `{name}`; the document requires a newer minor, so it is skipped",
                        entry.full_name(),
                        version.major,
                        version.minor
                    ),
                    migration: None,
                    replaced_by: None,
                    close: Vec::new(),
                });
                dropped.push(name.clone());
            } else {
                // A field another kind defines names that kind after any rename, in the close
                // names, and first in the fix when no rename comes before it (#1970).
                let owners = super::close::owners(name, entry, kinds, sealed.close_fault);
                let close =
                    super::close::field_names(name, entry, version, &owners, sealed.close_fault);
                let fix = if close.first().is_some_and(|c| c.get("defines").is_some()) {
                    format!(
                        "`{name}` is a field of {}: give the item that kind, or remove the field.",
                        owners.join(" or ")
                    )
                } else {
                    super::fix_for("unknown_field")
                };
                issues.push(Issue {
                    close,
                    fix,
                    ..Issue::error(
                        "unknown_field",
                        key,
                        path(),
                        value.clone(),
                        &format!(
                            "{}@{}.{} does not define `{name}`",
                            entry.full_name(),
                            version.major,
                            version.minor
                        ),
                    )
                });
            }
            continue;
        };
        if !param.module.is_empty() && !value.is_null() {
            if let Some(missing) = sealed.missing_for(param.module, param.operator) {
                issues.push(Issue::error(
                    "module_missing",
                    key,
                    path(),
                    value.clone(),
                    &lacks(name, param.module, &missing),
                ));
                continue;
            }
        }
        match param.ty {
            // The kind's own reader checks the value's shape when it evaluates the item.
            ParamType::Json => {}
            ParamType::Str => {
                if !value.is_string() {
                    // The closed code list has no type code; a value of another type is out of
                    // the field's range.
                    issues.push(Issue::error(
                        "out_of_range",
                        key,
                        path(),
                        value.clone(),
                        "not a string",
                    ));
                }
            }
            ParamType::F32 => {
                let number = match value {
                    Value::Number(_) => value.as_f64(),
                    Value::String(text) => match convert_literal(text, param.unit) {
                        Ok(n) => {
                            converted.push((name.clone(), n));
                            Some(n)
                        }
                        Err(r) => {
                            issues.push(Issue {
                                forms: literal_forms(param.unit),
                                ..Issue::error("bad_unit", key, path(), value.clone(), &r.what)
                            });
                            None
                        }
                    },
                    _ => {
                        issues.push(Issue {
                            forms: literal_forms(param.unit),
                            ..Issue::error(
                                "bad_unit",
                                key,
                                path(),
                                value.clone(),
                                "neither a number nor a unit literal",
                            )
                        });
                        None
                    }
                };
                if let Some(n) = number {
                    let below = param.min.is_some_and(|min| n < min);
                    let above = param.max.is_some_and(|max| n > max);
                    if below || above || !(n as f32).is_finite() {
                        issues.push(Issue::error(
                            "out_of_range",
                            key,
                            path(),
                            json!(n),
                            &format!(
                                "outside {} to {}",
                                param.min.unwrap_or(f64::NEG_INFINITY),
                                param.max.unwrap_or(f64::INFINITY)
                            ),
                        ));
                    } else if param.unit == "Hz" {
                        // A step rate (issue #497): valid only with a whole-flick step.
                        if let Err(why) = crate::time::step_length(n) {
                            issues.push(Issue::error("bad_rate", key, path(), json!(n), &why));
                        }
                    }
                }
            }
        }
    }
    for name in dropped {
        params.shift_remove(&name);
    }
    for (name, n) in converted {
        params.insert(name, json!(n));
    }
}

/// A document's design size, as `fw` and `fh` read it.
pub fn frame_of(doc: &Value) -> Option<(u32, u32)> {
    let size = member(doc, "size")?.as_array()?;
    let side = |i: usize| size.get(i)?.as_f64().map(|v| v as u32);
    Some((side(0)?, side(1)?))
}

/// A unit literal's value in a field declared in `unit`, as an f64.
fn convert_literal(text: &str, unit: &str) -> Result<f64, Refusal> {
    let literal = UnitLiteral::parse(text)?;
    let value = literal.convert(unit, &UnitContext::default())?;
    Ok(value.to_f64())
}

/// The forms a field in `unit` takes, each a literal the unit printer wrote (`1m`, `1cm`, …);
/// the bare form is left out.
pub fn literal_forms(unit: &str) -> Vec<String> {
    forms_for(unit)
        .into_iter()
        .filter(|form| form.bytes().any(|c| c.is_ascii_lowercase()))
        .collect()
}

/// Every map keyed by ID takes keys in the ID grammar; a key a path can't name is `bad_id`.
fn check_key(section: &str, key: &str, issues: &mut Vec<Issue>) {
    if let Err(r) = Id::parse(key) {
        issues.push(Issue::error(
            "bad_id",
            key,
            format!("{section}/{key}"),
            json!(key),
            &r.what,
        ));
    }
}

/// Every map keyed by ID besides `layers` and `items`: an object whose keys follow the one ID
/// grammar, whatever its entries hold (their shapes belong to the issues that give them behavior).
fn check_id_maps(doc: &Value, issues: &mut Vec<Issue>) {
    for section in ID_MAPS {
        let Some(entries) = member(doc, section) else {
            continue;
        };
        let Some(entries) = entries.as_object() else {
            issues.push(Issue::envelope(
                "out_of_range",
                (*section).into(),
                entries.clone(),
                "not an object",
            ));
            continue;
        };
        for key in entries.keys() {
            check_key(section, key, issues);
        }
    }
}

/// Every control carries a role, so a screen reader can say what it is (Rules every primitive
/// follows: Accessible; Control: `role`, an ARIA role). A control without one is refused, naming
/// the control and the field; the section and its keys are [`check_id_maps`]'s.
/// A control `kind` is an entry of the input module's `control@1` (#308), so a build whose set
/// holds the input module and that left it out refuses one with `module_missing`, naming it.
fn check_controls(doc: &Value, sealed: &Sealed, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "controls").and_then(Value::as_object) else {
        return;
    };
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("controls/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        if let Some(kind) = fields.get("kind").and_then(Value::as_str) {
            if sealed.lacks("input") {
                issues.push(Issue::error(
                    "module_missing",
                    key,
                    format!("controls/{key}/kind"),
                    json!(kind),
                    &format!("control kind `{kind}` is the input module's, which this build lacks"),
                ));
            }
        }
        let what = match fields.get("role") {
            None => "required, and absent",
            Some(Value::String(role)) if !role.is_empty() => continue,
            Some(Value::String(_)) => "required, and empty",
            Some(_) => "not a string",
        };
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("controls/{key}/role"),
            fields.get("role").cloned().unwrap_or(Value::Null),
            what,
        ));
    }
}

/// A figure's card (Overlay: a figure's card is a fixed overlay set, #504): its fields, each text
/// line a template whose slots resolve, so every number the card shows is a value the document
/// computes, and its legend a list of `{tone, label, role}`.
fn check_card(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(card) = member(doc, "card") else {
        return;
    };
    let Some(fields) = card.as_object() else {
        issues.push(Issue::envelope("out_of_range", "card".into(), card.clone(), "not an object"));
        return;
    };
    for (field, v) in fields {
        let path = format!("card/{field}");
        if field == "legend" {
            let ok = v.as_array().is_some_and(|l| {
                l.iter().all(|e| e.as_object().is_some_and(|e| e.keys().all(|k| ["tone", "label", "role"].contains(&k.as_str()))))
            });
            if !ok {
                issues.push(Issue::envelope("out_of_range", path, v.clone(), "not a list of {tone, label, role}"));
            }
            continue;
        }
        if !crate::template::CARD_LINES.contains(&field.as_str()) {
            issues.push(Issue::envelope("unknown_field", path, v.clone(), "not a field of a card"));
            continue;
        }
        let Some(text) = v.as_str() else {
            issues.push(Issue::envelope("out_of_range", path, v.clone(), "not a string"));
            continue;
        };
        match crate::template::parts(text) {
            Err(_) => issues.push(Issue::envelope("out_of_range", path, v.clone(), "a brace that opens no slot or closes none")),
            Ok(parts) => {
                for part in parts {
                    if let crate::template::Part::Slot(slot) = part {
                        if crate::template::value(doc, slot).is_none() {
                            let what = "the slot's path names no value this build shows";
                            issues.push(Issue::envelope("ref_unresolved", path.clone(), json!(slot), what));
                        }
                    }
                }
            }
        }
    }
}

/// The deepest chain of assemblies (Assembly: it can never nest more than 4 deep).
const ASSEMBLY_DEPTH: usize = 4;

/// Each assembly (Assembly, #504): its fields, its one parent another assembly with no cycle and
/// no chain deeper than four, a slide or a turn with an axis, a pivot and an ordered range, its
/// apart offset and its place in the take-apart. A `repeat` or a motion along a path isn't in
/// this build, so both are refused, named.
fn check_assemblies(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "assemblies").and_then(Value::as_object) else {
        return;
    };
    let items = member(doc, "items").and_then(Value::as_object);
    let parent_of = |id: &str| entries.get(id).and_then(|a| member(a, "parent")).and_then(Value::as_str);
    let vec3 = |v: &Value| v.as_array().is_some_and(|a| a.len() == 3 && a.iter().all(Value::is_number));
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            let path = format!("assemblies/{key}");
            issues.push(Issue::error("out_of_range", key, path, entry.clone(), "not an object"));
            continue;
        };
        if items.is_some_and(|i| i.contains_key(key)) {
            let what = "an item of the document has the same ID";
            issues.push(Issue::error("out_of_range", key, format!("assemblies/{key}"), entry.clone(), what));
        }
        let mut bad = |code, field: &str, actual: Value, what: &str| {
            let path = format!("assemblies/{key}/{field}");
            issues.push(Issue::error(code, key, path, actual, what));
        };
        for field in fields.keys() {
            match field.as_str() {
                "parent" | "at" | "motion" | "value" | "apart" | "order" | "shown_at" => {}
                "repeat" => bad("out_of_range", field, fields[field].clone(), "not in this build"),
                _ => bad("unknown_field", field, fields[field].clone(), "not a field of an assembly"),
            }
        }
        match fields.get("parent") {
            None | Some(Value::Null) => {}
            Some(Value::String(p)) if entries.contains_key(p) => {
                // Up the chain from this assembly: back to it is a cycle, past four is too deep.
                let (mut at, mut depth) = (p.as_str(), 1);
                loop {
                    if at == key {
                        bad("cycle", "parent", json!(p), "the parents lead back to the assembly");
                        break;
                    }
                    depth += 1;
                    if depth > ASSEMBLY_DEPTH {
                        bad("out_of_range", "parent", json!(p), "nests more than 4 deep");
                        break;
                    }
                    match parent_of(at) {
                        Some(next) if entries.contains_key(next) => at = next,
                        _ => break,
                    }
                }
            }
            Some(Value::String(p)) => bad("ref_unresolved", "parent", json!(p), "names no assembly of the document"),
            Some(other) => bad("out_of_range", "parent", other.clone(), "not one assembly ID or null"),
        }
        if fields.get("at").is_some_and(|a| !a.is_object()) {
            bad("out_of_range", "at", fields["at"].clone(), "not a transform");
        }
        if fields.get("value").is_some_and(|v| !v.is_number()) {
            bad("out_of_range", "value", fields["value"].clone(), "not a number");
        }
        if fields.get("apart").is_some_and(|v| !vec3(v)) {
            bad("out_of_range", "apart", fields["apart"].clone(), "not three numbers, in m");
        }
        if fields.get("order").is_some_and(|v| !v.as_u64().is_some_and(|n| n <= u64::from(u16::MAX))) {
            bad("out_of_range", "order", fields["order"].clone(), "not a u16");
        }
        let Some(motion) = fields.get("motion") else {
            continue;
        };
        let Some(m) = motion.as_object() else {
            bad("out_of_range", "motion", motion.clone(), "not an object");
            continue;
        };
        for field in m.keys() {
            if !["kind", "axis", "pivot", "range", "path"].contains(&field.as_str()) {
                bad("unknown_field", &format!("motion/{field}"), m[field].clone(), "not a field of a motion");
            }
        }
        match m.get("kind").and_then(Value::as_str) {
            Some("slide" | "turn") => {}
            Some("path") => bad("out_of_range", "motion/kind", json!("path"), "not in this build"),
            _ => bad(
                "out_of_range",
                "motion/kind",
                m.get("kind").cloned().unwrap_or(Value::Null),
                "one of slide or turn",
            ),
        }
        let axis = m.get("axis");
        let zero = axis
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().all(|x| x.as_f64() == Some(0.0)));
        if !axis.is_some_and(vec3) || zero {
            bad(
                "out_of_range",
                "motion/axis",
                axis.cloned().unwrap_or(Value::Null),
                "three numbers, not all zero",
            );
        }
        if m.get("pivot").is_some_and(|p| !vec3(p)) {
            bad("out_of_range", "motion/pivot", m["pivot"].clone(), "not three numbers, in m");
        }
        if let Some(range) = m.get("range") {
            let ends = range.as_array().filter(|r| r.len() == 2).and_then(|r| Some((r[0].as_f64()?, r[1].as_f64()?)));
            if !ends.is_some_and(|(lo, hi)| lo <= hi) {
                bad("out_of_range", "motion/range", range.clone(), "not [min, max] with min ≤ max");
            }
        }
    }
}

/// Each time remap (Time remap): its target a recipe instance the check expanded, a placement or
/// the document, and its map `reverse`, a preset or a channel of keys, whose fields the motion
/// module reads. A reverse over anything but a placement runs over the document's span.
fn check_time_remaps(doc: &Value, expansions: &[Expansion], issues: &mut Vec<Issue>) {
    let Some(entries) = member(doc, "time_remaps").and_then(Value::as_object) else {
        return;
    };
    let span = member(doc, "transport").and_then(|t| member(t, "span"));
    let placements = member(doc, "placements").and_then(Value::as_object);
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("time_remaps/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        let mut bad = |code, field: &str, what: &str| {
            let actual = fields.get(field).cloned().unwrap_or(Value::Null);
            let path = format!("time_remaps/{key}/{field}");
            issues.push(Issue::error(code, key, path, actual, what));
        };
        for field in fields.keys() {
            if !["target", "map", "clamp"].contains(&field.as_str()) {
                bad("unknown_field", field, "not a field of a time remap");
            }
        }
        let target = fields.get("target").and_then(Value::as_str);
        let placed = target.is_some_and(|t| placements.is_some_and(|p| p.contains_key(t)));
        let known = target.is_some_and(|t| t == "document" || expansions.iter().any(|e| e.instance == t));
        if !known && !placed {
            bad(
                "ref_unresolved",
                "target",
                "names no recipe instance or placement of the document",
            );
        }
        let map = fields.get("map");
        if !map.is_some_and(|m| m.as_str() == Some("reverse") || m.is_object()) {
            bad(
                "out_of_range",
                "map",
                "a time remap's map is `reverse`, a preset or a channel of keys",
            );
        }
        let reverses = map.and_then(Value::as_str) == Some("reverse");
        if reverses && !placed && span.is_none_or(|s| s == "auto" || s == "open") {
            bad(
                "out_of_range",
                "map",
                "a reverse map runs over the document's span, which it doesn't give",
            );
        }
    }
}

/// The entries of `channels` or `bound_values`; the section and its keys are [`check_id_maps`]'s.
fn check_targets(
    doc: &Value,
    section: &str,
    with_source: bool,
    kinds: &crate::kinds::Registry,
    sealed: &Sealed,
    issues: &mut Vec<Issue>,
) {
    let Some(entries) = member(doc, section).and_then(Value::as_object) else {
        return;
    };
    // A channel has the fields of Channel and key, whose values the motion module reads; a bound
    // value has the fields of Bound value; nothing else.
    let allowed: &[&str] = if with_source {
        BOUND_VALUE_FIELDS
    } else {
        CHANNEL_FIELDS
    };
    for (key, entry) in entries {
        let Some(fields) = entry.as_object() else {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{section}/{key}"),
                entry.clone(),
                "not an object",
            ));
            continue;
        };
        for (field, value) in fields {
            if !allowed.contains(&field.as_str()) {
                issues.push(Issue::error(
                    "unknown_field",
                    key,
                    format!("{section}/{key}/{field}"),
                    value.clone(),
                    &format!("not a field of a {section} entry"),
                ));
            }
        }
        let target_path = format!("{section}/{key}/target");
        match member(entry, "target") {
            // #504: a take-apart's target: the share of each target assembly's `apart` its
            // follow's stagger writes (Assembly: "timed by the follow's stagger").
            Some(Value::String(text))
                if text == "assemblies/apart" && entry.pointer("/follow/stagger/targets").is_some() => {}
            Some(Value::String(text)) => match Path::parse(text) {
                Ok(path) => {
                    if let Err(what) = resolve(doc, &path, kinds) {
                        issues.push(Issue::error(
                            "ref_unresolved",
                            key,
                            target_path,
                            json!(text),
                            &what,
                        ));
                    } else if moves_a_dither(doc, &path) {
                        // Paint: dither fill: it can never vary with time or frame.
                        issues.push(Issue::error(
                            "out_of_range",
                            key,
                            target_path,
                            json!(text),
                            "a dither fill never varies with time, so nothing drives it",
                        ));
                    } else if let Some((module, missing)) =
                        left_out_param(doc, &path, kinds, sealed)
                    {
                        // A channel or bound value drives the param, so the document uses the
                        // feature its evaluator reads, as a written value would.
                        issues.push(Issue::error(
                            "module_missing",
                            key,
                            target_path,
                            json!(text),
                            &lacks(&path.fields()[1], module, &missing),
                        ));
                    }
                }
                Err(r) => {
                    let code = if r.code == "bad_id" {
                        "bad_id"
                    } else {
                        "bad_path"
                    };
                    issues.push(Issue::error(code, key, target_path, json!(text), &r.what));
                }
            },
            other => issues.push(Issue::error(
                "out_of_range",
                key,
                target_path,
                other.cloned().unwrap_or(Value::Null),
                "not a path",
            )),
        }
        if let Some(stale_after) = member(entry, "stale_after") {
            if let Err(what) = duration(doc, stale_after) {
                issues.push(Issue::error(
                    "bad_time",
                    key,
                    format!("{section}/{key}/stale_after"),
                    stale_after.clone(),
                    &what,
                ));
            }
        }
        if with_source {
            let source_path = format!("{section}/{key}/source");
            let refused = match member(entry, "source") {
                Some(Value::String(text)) => Handle::parse_source(text)
                    .err()
                    .map(|r| Issue::error("bad_handle", key, source_path, json!(text), &r.what)),
                other => Some(Issue::error(
                    "out_of_range",
                    key,
                    source_path,
                    other.cloned().unwrap_or(Value::Null),
                    "not a handle",
                )),
            };
            if let Some(mut issue) = refused {
                // The source is what the number on screen rests on, so its issue also names the
                // item, or the mark set's row, the value fills (picking's `<id>#<key>`).
                if let Some(path) = member(entry, "target")
                    .and_then(Value::as_str)
                    .and_then(|t| Path::parse(t).ok())
                    .filter(|p| p.section() == Section::Items)
                {
                    issue.ids.push(match path.sub() {
                        Some(sub) => format!("{}#{sub}", path.id().as_str()),
                        None => path.id().as_str().to_string(),
                    });
                }
                issues.push(issue);
            }
        }
    }
}

/// A channel's fields (Channel and key).
const CHANNEL_FIELDS: &[&str] = &[
    "target",
    "type",
    "space",
    "mode",
    "keys",
    "extrapolate",
    "modifiers",
    "range",
    "morph",
    // Follow: a `mode: follow` channel's source, model, outputs and stagger.
    "follow",
    "exaggerate", // #1183: a measured length mapped at another ratio than its `shown_at`.
];

/// A bound value's fields (Bound value).
const BOUND_VALUE_FIELDS: &[&str] = &[
    "target",
    "source",
    "select",
    "format",
    "as_of",
    "show",
    "stale_after",
    "missing",
];

/// The transport's `frame_rate` as `[p, q]`, as `p/q` text, or as a whole number `p` (p/1),
/// when it is one.
pub fn frame_rate_of(transport: &Value) -> Option<(u32, u32)> {
    let whole = |v: &Value| u32::try_from(v.as_u64()?).ok();
    match member(transport, "frame_rate")? {
        Value::Array(pq) if pq.len() == 2 => Some((whole(&pq[0])?, whole(&pq[1])?)),
        n @ Value::Number(_) => Some((whole(n)?, 1)),
        Value::String(s) => {
            let (p, q) = s.split_once('/').unwrap_or((s, "1"));
            Some((p.trim().parse().ok()?, q.trim().parse().ok()?))
        }
        _ => None,
    }
}

/// The transport's rates (issue #488; Time and the flick: the valid-rates rule): a frame rate
/// whose frame, or a sample rate whose sample, isn't a whole number of flicks is refused with
/// `bad_rate` naming the rate. A rate that isn't a rate at all is refused the same way.
fn check_transport(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(transport) = member(doc, "transport").filter(|t| t.is_object()) else {
        return;
    };
    if let Some(rate) = member(transport, "frame_rate") {
        let parsed = frame_rate_of(transport);
        let outcome = match parsed {
            Some((p, q)) => crate::time::frame_length(p, q).map(|_| ()),
            None => Err(format!(
                "frame rate {rate} is not two whole numbers above zero"
            )),
        };
        if let Err(why) = outcome {
            let named = parsed
                .map(|(p, q)| crate::time::Rate::Frame { p, q }.text())
                .unwrap_or_else(|| rate.to_string());
            issues.push(Issue::envelope(
                "bad_rate",
                "transport/frame_rate".into(),
                json!(named),
                &why,
            ));
        }
    }
    if let Some(rate) = member(transport, "sample_rate") {
        let outcome = match rate.as_u64().and_then(|hz| u32::try_from(hz).ok()) {
            Some(hz) => crate::time::sample_length(hz).map(|_| ()),
            None => Err(format!("sample rate {rate} is not a whole number of hertz")),
        };
        if let Err(why) = outcome {
            issues.push(Issue::envelope(
                "bad_rate",
                "transport/sample_rate".into(),
                rate.clone(),
                &why,
            ));
        }
    }
}

/// A duration field's flicks: a time span (`"2s"`, `"120f"` at the transport's rate), above 0.
pub fn duration(doc: &Value, value: &Value) -> Result<i64, String> {
    let Value::String(text) = value else {
        return Err("not a time literal".into());
    };
    let rate = member(doc, "transport")
        .and_then(frame_rate_of)
        .unwrap_or((60, 1));
    let ctx = TimeContext {
        frame_rate: rate,
        ..TimeContext::default()
    };
    match Time::parse(text) {
        Ok(Time::Span(span)) => match span.resolve(&ctx) {
            Ok(flicks) if flicks > 0 => Ok(flicks),
            Ok(_) => Err("a duration is above 0".into()),
            Err(r) => Err(r.what),
        },
        Ok(_) => Err("a duration is a span, such as 2s or 120f".into()),
        Err(r) => Err(r.what),
    }
}

/// Why a param is not evaluated in this build: the module that evaluates it is the one the
/// build lacks, or its operator reads a missing optional dependency.
fn lacks(name: &str, module: &str, missing: &str) -> String {
    if module == missing {
        format!("`{name}` is evaluated by the {missing} module, which this build lacks")
    } else {
        format!("`{name}` reads the {missing} module, which this build lacks")
    }
}

/// Whether an item target reaches a dither fill or holds one (Paint: dither fill).
fn moves_a_dither(doc: &Value, path: &Path) -> bool {
    fn holds(v: &Value) -> bool {
        match v {
            Value::Object(map) => {
                map.get("fill").is_some_and(|f| f.get("dither").is_some())
                    || map.values().any(holds)
            }
            Value::Array(list) => list.iter().any(holds),
            _ => false,
        }
    }
    if path.section() != Section::Items {
        return false;
    }
    let fields = path.fields();
    if fields
        .windows(2)
        .any(|w| w[0] == "fill" && w[1] == "dither")
    {
        return true;
    }
    let mut reached = member(doc, "items").and_then(|m| member(m, path.id().as_str()));
    for field in fields {
        reached = reached.and_then(|v| v.get(field.as_str()));
    }
    match (fields.last().map(String::as_str), reached) {
        (Some("fill"), Some(v)) => v.get("dither").is_some(),
        (_, Some(v)) => holds(v),
        _ => false,
    }
}

/// A target param's evaluating module and the missing module that keeps its operator out of
/// this build, when the target is `items/<id>/params/<name>` of such a kind.
fn left_out_param(
    doc: &Value,
    path: &Path,
    kinds: &crate::kinds::Registry,
    sealed: &Sealed,
) -> Option<(&'static str, String)> {
    if path.section() != Section::Items {
        return None;
    }
    let [field, name] = path.fields() else {
        return None;
    };
    if field != "params" {
        return None;
    }
    let item = member(doc, "items").and_then(|m| member(m, path.id().as_str()))?;
    let Lookup::Known { entry, saved } = lookup(kinds, kind_text(item)?) else {
        return None;
    };
    let param = entry
        .version(saved)
        .unwrap_or(entry.current())
        .param(name)?;
    if param.module.is_empty() {
        return None;
    }
    sealed
        .missing_for(param.module, param.operator)
        .map(|missing| (param.module, missing))
}

/// Resolves a path against the (lowered) document: the item exists and each field step reaches
/// something. An item's fields resolve against its kind's schema; in this slice no kind gives
/// another section a schema, so a field step there must reach a value the document holds: a
/// key of an object or an index of a list.
pub(crate) fn resolve(
    doc: &Value,
    path: &Path,
    kinds: &crate::kinds::Registry,
) -> Result<(), String> {
    let id = path.id().as_str();
    let section = path.section().as_str();
    let Some(target) = member(doc, section).and_then(|m| member(m, id)) else {
        return Err(format!("{section}/{id} is not in the document"));
    };
    if let Some(sub) = path.sub() {
        // A mark set's row key is the one part this build names: `items/<set>#<key>/<column>`.
        let params = member(target, "params").and_then(Value::as_object);
        return match (path.section(), path.fields(), params) {
            (Section::Items, [column], Some(params)) if params.contains_key("columns") => {
                super::rows::row_column(params, sub, column)
                    .map_err(|what| format!("`#{sub}` names no row of {section}/{id}: {what}"))
            }
            _ => Err(format!(
                "`#{sub}` names a part of {section}/{id}, and only a mark set's row key, \
                 followed by one of its columns, names a part in this build"
            )),
        };
    }
    let fields: Vec<&str> = path.fields().iter().map(String::as_str).collect();
    let unreachable = || {
        Err(format!(
            "{section}/{id}/{} reaches nothing",
            fields.join("/")
        ))
    };
    // #504: an assembly's `value` is what a driver or a channel moves it by, 0 when unwritten,
    // and the only field anything may write (Assembly: it moves only through value, apart or a
    // constraint).
    if path.section() == Section::Assemblies {
        return match fields.as_slice() {
            ["value"] => Ok(()),
            _ => unreachable(),
        };
    }
    if path.section() != Section::Items {
        let mut cursor = target;
        for field in &fields {
            cursor = match cursor {
                Value::Object(map) => map.get(*field),
                Value::Array(list) => field.parse::<usize>().ok().and_then(|i| list.get(i)),
                _ => None,
            }
            .ok_or_else(|| unreachable().unwrap_err())?;
        }
        return Ok(());
    }
    match fields.as_slice() {
        [] | ["params"] | ["at"] => Ok(()),
        // #494: what a path or a vector import draws is a path channel's target (Channel and
        // key: path).
        ["path"] if matches!(kind_text(target), Some("path@1" | "vector@1")) => Ok(()),
        // A step inside a param, such as a camera's `orbit/azimuth`, must reach a value the item
        // holds: no kind gives a param's parts a schema in this slice.
        ["params", name, rest @ ..] if !rest.is_empty() => {
            let mut cursor = member(target, "params").and_then(|p| member(p, name));
            for field in rest {
                cursor = match cursor {
                    // A path op is an object with one key, its kind (Path `path@1`: ops), so a
                    // step that names one of its fields reaches through that key.
                    Some(Value::Object(map)) => map.get(*field).or_else(|| {
                        let (only, inner) = (map.len() == 1).then(|| map.iter().next())??;
                        (*name == "ops" && !only.is_empty())
                            .then(|| inner.get(*field))
                            .flatten()
                    }),
                    Some(Value::Array(list)) => {
                        field.parse::<usize>().ok().and_then(|i| list.get(i))
                    }
                    _ => None,
                };
            }
            if cursor.is_some() {
                Ok(())
            } else {
                unreachable()
            }
        }
        ["params", name] => {
            let known = match kind_text(target).map(|text| lookup(kinds, text)) {
                Some(Lookup::Known { entry, saved }) => entry
                    .version(saved)
                    .unwrap_or(entry.current())
                    .param(name)
                    .is_some(),
                _ => member(target, "params")
                    .and_then(Value::as_object)
                    .is_some_and(|p| p.contains_key(*name)),
            };
            if known {
                Ok(())
            } else {
                unreachable()
            }
        }
        // A param of one of the item's modifiers (Modifier; #420): it must reach a value the
        // modifier holds, as a param's parts do.
        ["modifiers", k, "params", rest @ ..] if !rest.is_empty() => {
            let mut cursor = member(target, "modifiers")
                .and_then(Value::as_array)
                .and_then(|list| k.parse::<usize>().ok().and_then(|i| list.get(i)))
                .and_then(|m| member(m, "params"));
            for field in rest {
                cursor = match cursor {
                    Some(Value::Object(map)) => map.get(*field),
                    Some(Value::Array(list)) => {
                        field.parse::<usize>().ok().and_then(|i| list.get(i))
                    }
                    _ => None,
                };
            }
            if cursor.is_some() {
                Ok(())
            } else {
                unreachable()
            }
        }
        ["at", name] if AT_VECTORS.contains(name) || *name == "shear" => Ok(()),
        ["at", name, index] if AT_VECTORS.contains(name) && ["0", "1", "2"].contains(index) => {
            Ok(())
        }
        // Every relation field is a channel target (Item and kind: relations), on a relation
        // the item holds.
        ["at", name, rest @ ..] if AT_RELATIONS.contains(name) && !rest.is_empty() => {
            let mut cursor = member(target, "at").and_then(|a| member(a, name));
            for field in rest {
                cursor = match cursor {
                    Some(Value::Object(map)) => map.get(*field),
                    Some(Value::Array(list)) => {
                        field.parse::<usize>().ok().and_then(|i| list.get(i))
                    }
                    _ => None,
                };
            }
            if cursor.is_some() {
                Ok(())
            } else {
                unreachable()
            }
        }
        ["adjust", name] if ADJUST_FIELDS.contains(name) => Ok(()),
        [field] if ITEM_OWN_FIELDS.contains(field) => Ok(()),
        // A part of a module's kind, such as a vector's SVG ids (#398): its role, opacity and
        // offset. The parts come from the module's import, so the module resolves the part.
        ["parts", _, "role" | "opacity" | "at", ..]
            if !matches!(
                kind_text(target).map(|text| lookup(kinds, text)),
                Some(Lookup::Known { .. })
            ) =>
        {
            Ok(())
        }
        _ => unreachable(),
    }
}
