//! The parts an interface adds to the kit (issue #185; canvas primitives: Canvas module: interface
//! and implementation). `bit`: an implementation that declares itself bit, and isn't its
//! interface's reference, gives the reference's hashes on every kit fixture, compared in a build
//! that holds the reference in its place. `behavior`: a measured implementation lands within the
//! interface's tolerances on every fixture of its behavior part, and one whose interface has no
//! behavior part fails, since only the reference and bit implementations are admitted then.

use std::collections::BTreeMap;

use deep_canvas::registry::{Equivalence, Sealed};
use deep_canvas::schedule::Scheduler;
use serde_json::json;

use super::instance::{self, How};
use super::{failure, Case, Ctx, PartRun, Verdict};
use crate::hub::Hub;

/// The reference's sealed build: this build's canvas modules with the interface's reference in
/// place of the implementation it holds.
fn reference_build(sealed: &Sealed, interface: &str) -> Option<Sealed> {
    let reference = crate::interfaces()
        .into_iter()
        .find(|i| i.name == interface)?
        .reference;
    let held: Vec<_> = crate::modules(sealed.build_set)
        .into_iter()
        .map(|m| {
            if m.manifest.implements == interface {
                reference.clone()
            } else {
                m
            }
        })
        .collect();
    crate::assemble(sealed.build_set, held).seal().ok()
}

/// `bit`: each of the module's kit fixtures, evaluated here and in the reference's build, gives
/// the same result at every node; a case names the fixture and the first field that differs.
pub fn bit(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let module = ctx.module;
    let iface = sealed.interface_of(module)?;
    if iface.implementation.equivalence != Equivalence::Bit
        || iface.implementation.name == iface.reference
    {
        return None;
    }
    let fixtures: Vec<_> = ctx
        .manifest
        .of_module(module)
        .into_iter()
        .filter(|f| super::catalog::accepted(sealed, f))
        .collect();
    let mut run = PartRun::new(fixtures.len() as u64);
    let Some(reference) = reference_build(sealed, &iface.name) else {
        run.failures.push(failure(
            "no_reference",
            module,
            "bit",
            json!({"interface": iface.name, "reference": iface.reference}),
        ));
        return Some(run);
    };
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let how = How::default();
    for f in fixtures {
        let doc = super::catalog::stamped(&f.document);
        let readings = instance::readings(f.record.as_ref());
        let here = instance::clean_at(sealed, &how, &doc, &look, &readings, &[0], None).remove(0);
        let there =
            instance::clean_at(&reference, &how, &doc, &look, &readings, &[0], None).remove(0);
        let mut case = Case::new(format!("bit:{}", f.name), Verdict::Pass)
            .with("fixture", json!(f.name))
            .with("reference", json!(iface.reference));
        if let Some(place) = instance::first_difference(&there, &here, &|n| n.module != module) {
            let node = here.nodes.get(&place).or_else(|| there.nodes.get(&place));
            let writes = node
                .and_then(|n| sealed.ops.iter().find(|o| o.key == n.operator))
                .map(|o| o.op.writes.join(","))
                .unwrap_or_default();
            let item = node.and_then(|n| n.item.clone()).unwrap_or_default();
            case.fail(
                Verdict::Fail,
                failure(
                    "not_bit",
                    module,
                    "bit",
                    json!({"interface": iface.name, "fixture": f.name, "field": format!("{writes}@{item}"),
                           "operator": place, "reference": iface.reference}),
                ),
            );
        }
        run.cases.push(case);
    }
    Some(run)
}

/// `behavior`: each fixture of the interface's behavior part, evaluated at time 0, holds each
/// analytic answer within its tolerance; a case lists every answer with what the implementation
/// got, and fails on the first outside its tolerance, naming the fixture, the answer and the
/// tolerance.
pub fn behavior(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let module = ctx.module;
    let iface = sealed.interface_of(module)?;
    let measured = iface.implementation.equivalence == Equivalence::Measured;
    let Some(part) = iface.behavior.as_ref().filter(|b| !b.fixtures.is_empty()) else {
        if !measured {
            return None;
        }
        // Without a behavior part an interface admits only its reference and bit ones.
        let mut run = PartRun::new(1);
        let mut case = Case::new("behavior:none", Verdict::Pass);
        case.fail(
            Verdict::Fail,
            failure(
                "no_behavior_part",
                module,
                "behavior",
                json!({"interface": iface.name, "implementation": iface.implementation.name}),
            ),
        );
        run.cases.push(case);
        return Some(run);
    };
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let mut run = PartRun::new(part.fixtures.len() as u64);
    for f in &part.fixtures {
        let doc = super::catalog::stamped(&f.document);
        let got: Vec<Option<f64>> = instance::fresh(|| {
            let mut s = Scheduler::new(sealed, How::default().options());
            let session = instance::session(&mut s, &doc, &look, &BTreeMap::new());
            let nodes = session
                .clean(&mut s, 0, &instance::view(&doc), None)
                .nodes(&s);
            f.answers
                .iter()
                .map(|a| {
                    nodes.iter().find_map(|n| {
                        let op = sealed.ops.iter().find(|o| o.key == n.operator)?;
                        let at = op.op.writes.iter().position(|w| *w == a.array)?;
                        if n.item.as_deref() != Some(a.item.as_str()) {
                            return None;
                        }
                        n.values.get(at)?.as_typed::<f64>().map(|x| *x)
                    })
                })
                .collect()
        });
        let mut case = Case::new(format!("behavior:{}", f.name), Verdict::Pass)
            .with("fixture", json!(f.name));
        let mut listed = Vec::new();
        for (a, got) in f.answers.iter().zip(got) {
            let answer = format!("{} {}", a.item, a.array);
            let within =
                got.is_some_and(|g| (g - a.value).abs() <= a.tolerance * a.value.abs());
            listed.push(json!({"answer": answer, "expected": a.value, "got": got, "tolerance": a.tolerance}));
            if !within {
                case.fail(
                    Verdict::Fail,
                    failure(
                        "outside_tolerance",
                        module,
                        &part.name,
                        json!({"interface": iface.name, "fixture": f.name, "answer": answer,
                               "expected": a.value, "got": got, "tolerance": a.tolerance}),
                    ),
                );
            }
        }
        case.set("answers", json!(listed));
        run.cases.push(case);
    }
    Some(run)
}
