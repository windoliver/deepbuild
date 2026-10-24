//! The parts that hold a module's operators to their declarations (issue #138; canvas
//! primitives: Operator and read set, Array and table): `read_set`, where changing, one at a
//! time, every input a fixture's session holds leaves every node whose declared reads don't reach
//! it byte-identical; `order`, where 8 shuffled legal orders give every key and result the plan's
//! order gives; `schedule`, where the module's slice of the published schedule equals its
//! committed snapshot; and `contribution`, where a kind that draws glyphs, strokes or solids, or
//! places shots, cuts and holds, reaches the core's array for them through `contributes_to`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{core_ops, Scheduler, Target};
use serde_json::{json, Value};

use super::instance::{self, Evaluated, How};
use super::manifest::Entry;
use super::{derive, failure, Case, Ctx, PartRun, Verdict, SHUFFLED_ORDERS};
use crate::hub::{Hub, Planted};

/// The fixtures a module's evaluation parts run: its documents the check accepts.
fn documents<'m>(sealed: &Sealed, ctx: &'m Ctx<'_>) -> Vec<&'m Entry> {
    ctx.manifest
        .of_module(ctx.module)
        .into_iter()
        .filter(|f| super::catalog::accepted(sealed, f))
        .collect()
}

/// Every read term an operator's result can depend on: its own reads, and, through each array it
/// reads, its writer's and each contributor's, to the end.
fn closure(sealed: &Sealed, op: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut stack = vec![op.to_string()];
    let mut seen = BTreeSet::new();
    while let Some(key) = stack.pop() {
        if !seen.insert(key.clone()) {
            continue;
        }
        let Some(sop) = sealed.ops.iter().find(|o| o.key == key) else {
            continue;
        };
        for r in &sop.op.reads {
            let read = r
                .strip_prefix("earlier(")
                .and_then(|x| x.strip_suffix(')'))
                .unwrap_or(r);
            out.insert(read.to_string());
            let mut arrays = vec![read.to_string()];
            arrays.extend(sealed.contributions.get(read).cloned().unwrap_or_default());
            for a in arrays {
                out.insert(a.clone());
                for w in sealed.ops.iter().filter(|o| o.op.writes.contains(&a)) {
                    stack.push(w.key.clone());
                }
            }
        }
    }
    out
}

/// The targets a fixture's session may change: its own, and each array at its source.
fn targets(sealed: &Sealed, doc: &Value, look: &deep_canvas::schedule::Tokens) -> Vec<Target> {
    instance::fresh(|| {
        let mut s = Scheduler::new(sealed, How::default().options());
        let session = instance::session(&mut s, doc, look, &BTreeMap::new());
        let mut out = session.targets(&s);
        let arrays: Vec<String> = out
            .iter()
            .filter_map(|t| match t {
                Target::Array(a) => Some(a.clone()),
                _ => None,
            })
            .collect();
        out.extend(arrays.into_iter().map(Target::Source));
        out
    })
}

/// `read_set`: each target of each fixture, changed alone in a clean evaluation, against the
/// module's nodes that don't reach it, which must keep their keys and results; and every read
/// the access log refused.
pub fn read_set(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let module = ctx.module;
    let mut cases = Vec::new();
    let mut failures = Vec::new();
    for f in documents(sealed, ctx) {
        let doc = super::catalog::stamped(&f.document);
        let readings = instance::readings(f.record.as_ref());
        let how = How::default();
        let base = instance::clean_at(sealed, &how, &doc, &look, &readings, &[0], None).remove(0);
        let mut logged = BTreeSet::new();
        for i in base
            .issues
            .iter()
            .filter(|i| i.code == "undeclared_read" && i.module == module)
        {
            let read = i.read.clone().unwrap_or_default();
            if logged.insert((i.operator.clone(), read.clone())) {
                failures.push(failure(
                    "undeclared_read",
                    module,
                    "read_set",
                    json!({"operator": i.operator, "array": read, "fixture": f.name}),
                ));
            }
        }
        let closures: BTreeMap<String, BTreeSet<String>> = sealed
            .ops
            .iter()
            .filter(|o| o.module == module)
            .map(|o| (o.key.clone(), closure(sealed, &o.key)))
            .collect();
        for target in targets(sealed, &doc, &look) {
            let term = target.term();
            let name = target.name();
            let perturbed = instance::clean_at(
                sealed,
                &how,
                &doc,
                &look,
                &readings,
                &[0],
                Some(target.clone()),
            )
            .remove(0);
            let mut case = Case::new(format!("{}#{name}", f.name), Verdict::Pass)
                .with("fixture", json!(f.name))
                .with("target", json!(name));
            for (place, n) in &base.nodes {
                let Some(reach) = closures.get(&n.operator) else {
                    continue;
                };
                // An operator's own writes move with it.
                let writes = sealed
                    .ops
                    .iter()
                    .find(|o| o.key == n.operator)
                    .is_some_and(|o| o.op.writes.contains(&term));
                if reach.contains(&term) || writes {
                    continue;
                }
                let moved = perturbed
                    .nodes
                    .get(place)
                    .is_none_or(|m| m.result != n.result || m.key != n.key);
                if moved {
                    let array = match &target {
                        Target::Array(a) | Target::Source(a) => a.clone(),
                        other => other.name(),
                    };
                    let fl = failure(
                        "undeclared_read",
                        module,
                        "read_set",
                        json!({"operator": n.operator, "array": array, "item": n.item, "fixture": f.name}),
                    );
                    case.fail(Verdict::Fail, fl.clone());
                    if logged.insert((n.operator.clone(), array)) {
                        failures.push(fl);
                    }
                }
            }
            cases.push(case);
        }
    }
    let mut run = PartRun::new(cases.len() as u64);
    run.cases = cases;
    run.failures = failures;
    Some(run)
}

/// The 8 shuffle seeds of a module's order part, distinct.
pub fn order_seeds(seed: u64, module: &str) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    let mut k = 0;
    while out.len() < SHUFFLED_ORDERS {
        let s = (derive(seed, &format!("{module}/order"), k) % u64::from(u32::MAX)) as u32;
        if !out.contains(&s) {
            out.push(s);
        }
        k += 1;
    }
    out
}

/// The first node of `module` whose key or result an order changed.
fn first_moved(a: &Evaluated, b: &Evaluated, module: &str) -> Option<String> {
    instance::first_difference(a, b, &|n| n.module != module).and_then(|place| {
        a.nodes
            .get(&place)
            .or_else(|| b.nodes.get(&place))
            .map(|n| n.operator.clone())
    })
}

/// `order`: 8 shuffled legal orders per fixture, each on its own instance, against the plan's.
pub fn order(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let module = ctx.module;
    let seeds = order_seeds(ctx.call.seed, module);
    let mut cases = Vec::new();
    let mut failures = Vec::new();
    for f in documents(sealed, ctx) {
        let doc = super::catalog::stamped(&f.document);
        let readings = instance::readings(f.record.as_ref());
        let plan = instance::clean_at(sealed, &How::default(), &doc, &look, &readings, &[0], None)
            .remove(0);
        for &seed in &seeds {
            let how = How {
                shuffle: Some(seed),
                ..How::default()
            };
            let shuffled =
                instance::clean_at(sealed, &how, &doc, &look, &readings, &[0], None).remove(0);
            let mut case = Case::new(format!("{}#order{seed}", f.name), Verdict::Pass)
                .with("fixture", json!(f.name))
                .with("seed", json!(seed));
            if let Some(operator) = first_moved(&plan, &shuffled, module) {
                let fl = failure(
                    "order",
                    module,
                    "order",
                    json!({"operator": operator, "seed": seed, "fixture": f.name}),
                );
                case.fail(Verdict::Fail, fl.clone());
                failures.push(fl);
            }
            cases.push(case);
        }
    }
    let mut run = PartRun::new(cases.len() as u64);
    run.cases = cases;
    run.failures = failures;
    run.extra.insert("seeds".into(), json!(seeds));
    Some(run)
}

/// Where a module's committed schedule slice lives.
fn snapshot_path(module: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("schedule")
        .join("modules")
        .join(format!("{module}.json"))
}

/// A module's slice of the published schedule: its operators phase by phase, as the plan orders
/// them, and the contributions it makes or receives.
pub fn slice(sealed: &Sealed, module: &str) -> Value {
    let schedule = sealed.schedule();
    let mut phases = serde_json::Map::new();
    for (phase, list) in schedule["phases"].as_object().into_iter().flatten() {
        let own: Vec<Value> = list
            .as_array()
            .into_iter()
            .flatten()
            .filter(|o| o["module"] == module)
            .cloned()
            .collect();
        if !own.is_empty() {
            phases.insert(phase.clone(), json!(own));
        }
    }
    // The contributions it makes: its own arrays that fold into another module's.
    let contributions: serde_json::Map<String, Value> = sealed
        .contributions
        .iter()
        .filter_map(|(to, from)| {
            let own: Vec<&String> = from
                .iter()
                .filter(|a| sealed.arrays.get(*a).is_some_and(|x| x.owner == module))
                .collect();
            (!own.is_empty()).then(|| (to.clone(), json!(own)))
        })
        .collect();
    json!({"module": module, "phases": phases, "contributions": contributions})
}

/// `schedule`: the module's slice of the published schedule against its committed snapshot.
pub fn schedule(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let module = ctx.module;
    let published = slice(sealed, module);
    let path = snapshot_path(module);
    if std::env::var_os("DEEP_KIT_WRITE_SCHEDULE").is_some() && !path.exists() {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(
            &path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&published).unwrap_or_default()
            ),
        );
    }
    let committed: Option<Value> = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let mut cases = Vec::new();
    let mut case = Case::new(format!("schedule:{module}"), Verdict::Pass).with(
        "snapshot",
        json!(path
            .strip_prefix(env!("CARGO_MANIFEST_DIR"))
            .unwrap_or(&path)
            .to_string_lossy()),
    );
    match committed {
        Some(c) if c == published => {}
        Some(_) => case.fail(
            Verdict::Fail,
            failure(
                "mismatch",
                module,
                "schedule",
                json!({"what": "key", "name": "schedule", "seed": 0}),
            ),
        ),
        None => case.fail(
            Verdict::Fail,
            failure(
                "mismatch",
                module,
                "schedule",
                json!({"what": "key", "name": "no committed snapshot", "seed": 0}),
            ),
        ),
    }
    cases.push(case);
    // The planted part: a case compared against a snapshot one operator short, failing, while
    // the part still exits 0.
    if hub.planted(Planted::ExitZeroWithFailedCase) {
        let mut wrong = Case::new(format!("schedule:{module}:short"), Verdict::Pass);
        wrong.fail(
            Verdict::Fail,
            failure(
                "mismatch",
                module,
                "schedule",
                json!({"what": "key", "name": "schedule", "seed": 0}),
            ),
        );
        cases.push(wrong);
    }
    let mut run = PartRun::new(1);
    if cases.len() > 1 {
        run.declared = cases.len() as u64;
    }
    run.cases = cases;
    Some(run)
}

/// `contribution`: each kind that draws or places what the core's checks read reaches the
/// core's array for it through `contributes_to`.
pub fn contribution(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let m = sealed.modules.iter().find(|m| m.name == ctx.module)?;
    let drawing: Vec<_> = m
        .shapes
        .kinds
        .iter()
        .filter(|k| !k.draws.is_empty())
        .collect();
    if drawing.is_empty() {
        return None;
    }
    let mut run = PartRun::new(drawing.len() as u64);
    for k in drawing {
        let kind = format!("{}@{}", k.entry.full_name(), k.entry.current().major);
        let mut case =
            Case::new(format!("contribution:{kind}"), Verdict::Pass).with("kind", json!(kind));
        for what in &k.draws {
            let Some(array) = core_ops::checked_array(what) else {
                continue;
            };
            let reaches = m
                .shapes
                .arrays
                .iter()
                .any(|a| a.contributes_to.as_deref() == Some(array));
            if !reaches {
                let fl = failure(
                    "contribution",
                    ctx.module,
                    "contribution",
                    json!({"kind": kind, "array": array}),
                );
                case.fail(Verdict::Fail, fl.clone());
                run.failures.push(fl);
            }
        }
        run.cases.push(case);
    }
    Some(run)
}
