//! Carried state (issue #138; canvas primitives: Carried state, Net: rollback). For each canvas
//! module that declares checkpoints, `carried_state` seeks from each checkpoint and plays on, and
//! needs the step hashes a straight run gives; `late_entry` adds each declared input entry up to
//! the default rollback window after its step, restores every checkpoint at the nearest
//! checkpoint step at or before it and steps forward, as a match does, and needs the step hashes,
//! checkpoints and occurrences of the run where the entry came on time.

use std::collections::BTreeMap;

use deep_canvas::registry::{StepInput, Stepper};
use deep_canvas::schedule::{canonical, sha256_hex};
use serde_json::{json, Value};

use super::manifest::Entry;
use super::{failure, Case, Ctx, PartRun, Verdict, ROLLBACK_WINDOW};
use crate::hub::Hub;

/// What a run left at each step: the hash of the state after it, the checkpoint the module took
/// before it (at a checkpoint step), and the occurrences the state held after it.
#[derive(Clone, Debug, Default)]
struct Trace {
    hashes: BTreeMap<i64, String>,
    checkpoints: BTreeMap<i64, String>,
    occurrences: BTreeMap<i64, String>,
    /// Each checkpoint the run took, by step: what a seek or a rollback restores.
    ring: BTreeMap<i64, Value>,
}

/// The input entries stamped at each step.
fn entries_of(sidecar: &Value) -> BTreeMap<i64, Vec<Value>> {
    let mut out: BTreeMap<i64, Vec<Value>> = BTreeMap::new();
    for e in sidecar["inputs"].as_array().into_iter().flatten() {
        if let Some(step) = e["step"].as_i64() {
            out.entry(step).or_default().push(e.clone());
        }
    }
    out
}

/// How many steps a fixture runs: its last `at_times` at the stepper's rate, else 1 s.
fn steps_of(stepper: &Stepper, f: &Entry) -> i64 {
    let end = super::time_order::straight(&f.sidecar)
        .last()
        .copied()
        .unwrap_or(705_600_000);
    (end * stepper.hz / 705_600_000).max(1)
}

fn digest(v: &Value) -> String {
    sha256_hex(&canonical(v))
}

/// Steps `state` from `from` through `to`, recording each step; `restored` is the step a
/// rollback restored to, for a replay.
fn play(
    stepper: &Stepper,
    state: &mut Value,
    from: i64,
    to: i64,
    entries: &BTreeMap<i64, Vec<Value>>,
    restored: Option<i64>,
    trace: &mut Trace,
) {
    for step in from..=to {
        if stepper.checkpoints.contains(&step) {
            let cp = (stepper.checkpoint)(state);
            trace.checkpoints.insert(step, digest(&cp));
            trace.ring.insert(step, cp);
        }
        let none = Vec::new();
        let input = StepInput {
            step,
            entries: entries.get(&step).unwrap_or(&none),
            restored,
        };
        (stepper.step)(state, &input);
        trace.hashes.insert(step, digest(state));
        trace
            .occurrences
            .insert(step, digest(&json!((stepper.occurrences)(state))));
    }
}

/// A straight run from step 1 through `n`.
fn straight(stepper: &Stepper, n: i64, entries: &BTreeMap<i64, Vec<Value>>) -> Trace {
    let mut state = (stepper.init)();
    let mut trace = Trace::default();
    play(stepper, &mut state, 1, n, entries, None, &mut trace);
    trace
}

/// The first step at or after `from` where two traces differ.
fn first_differing(a: &Trace, b: &Trace, from: i64) -> Option<i64> {
    let steps = a.hashes.keys().filter(|s| **s >= from);
    for s in steps {
        if a.hashes.get(s) != b.hashes.get(s)
            || a.occurrences.get(s) != b.occurrences.get(s)
            || a.checkpoints.get(s) != b.checkpoints.get(s)
        {
            return Some(*s);
        }
    }
    None
}

/// The module's steppers and its fixtures with carried state: every document fixture of a module
/// that declares checkpoints.
fn subjects(hub: &Hub<'_>, ctx: &Ctx<'_>) -> Vec<(Stepper, Entry)> {
    let Some(m) = hub
        .startup
        .sealed
        .modules
        .iter()
        .find(|m| m.name == ctx.module)
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for stepper in &m.shapes.steppers {
        for f in ctx.manifest.of_module(ctx.module) {
            if !f.is_scene() {
                out.push((stepper.clone(), f.clone()));
            }
        }
    }
    out
}

/// `carried_state`: a seek from each checkpoint, played on, against a straight run.
pub fn carried_state(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let subjects = subjects(hub, ctx);
    if subjects.is_empty() {
        return None;
    }
    let module = ctx.module;
    let mut run = PartRun::new(0);
    for (stepper, f) in &subjects {
        let n = steps_of(stepper, f);
        let entries = entries_of(&f.sidecar);
        let truth = straight(stepper, n, &entries);
        // A seek is held to the step hashes and occurrences, not the checkpoints.
        let mut want = truth.clone();
        want.checkpoints.clear();
        for c in stepper.checkpoints.iter().filter(|c| **c <= n) {
            run.declared += 1;
            let mut case = Case::new(format!("{}#seek{c}", f.name), Verdict::Pass)
                .with("fixture", json!(f.name))
                .with("checkpoint", json!(c));
            let Some(cp) = truth.ring.get(c) else {
                continue;
            };
            let mut state = (stepper.restore)(cp);
            let mut seek = Trace::default();
            play(stepper, &mut state, *c, n, &entries, None, &mut seek);
            seek.checkpoints.clear();
            if let Some(step) = first_differing(&want, &seek, *c) {
                let fl = failure(
                    "step_hash",
                    module,
                    "carried_state",
                    json!({"step": step, "checkpoint": c, "fixture": f.name}),
                );
                case.fail(Verdict::Fail, fl.clone());
                run.failures.push(fl);
            }
            // The twin: the checkpoint played on from one step later, a step short, must not
            // match.
            let mut twin_state = (stepper.restore)(cp);
            let mut twin = Trace::default();
            play(
                stepper,
                &mut twin_state,
                c + 1,
                n,
                &entries,
                None,
                &mut twin,
            );
            let twin_failed = first_differing(&want, &twin, c + 1).is_some();
            case.set(
                "twin",
                json!({"verdict": if twin_failed { "FAIL" } else { "PASS" }}),
            );
            if !twin_failed {
                let fl = failure(
                    "twin_passed",
                    module,
                    "carried_state",
                    json!({"case": case.name()}),
                );
                case.fail(Verdict::Invalid, fl.clone());
                run.failures.push(fl);
            }
            run.cases.push(case);
        }
    }
    Some(run)
}

/// `late_entry`: each declared input entry arriving 1 to the default rollback window's steps
/// late, against the run where it came on time.
pub fn late_entry(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let subjects = subjects(hub, ctx);
    if subjects.is_empty() || ctx.module == "media" {
        return None;
    }
    let module = ctx.module;
    let mut run = PartRun::new(0);
    for (stepper, f) in &subjects {
        let n = steps_of(stepper, f);
        let mut entries = entries_of(&f.sidecar);
        // A fixture that declares no input entry gets the kit's own, planted at a checkpoint step.
        if entries.is_empty() {
            let at = stepper
                .checkpoints
                .iter()
                .copied()
                .find(|c| *c < n)
                .unwrap_or(1);
            entries.insert(
                at,
                vec![json!({"step": at, "kind": "kit.planted", "value": 1})],
            );
        }
        let on_time = straight(stepper, n, &entries);
        for (&at, list) in &entries {
            for k in 0..list.len() {
                for lag in 1..=ROLLBACK_WINDOW {
                    let arrived = at + lag;
                    if arrived > n {
                        continue;
                    }
                    run.declared += 1;
                    let mut case =
                        Case::new(format!("{}#entry{at}.{k}+{lag}", f.name), Verdict::Pass)
                            .with("fixture", json!(f.name))
                            .with("entry", json!({"step": at, "arrived": arrived}));
                    // Until it arrives, the copy runs without it.
                    let mut without = entries.clone();
                    if let Some(l) = without.get_mut(&at) {
                        l.remove(k);
                    }
                    let mut state = (stepper.init)();
                    let mut late = Trace::default();
                    play(stepper, &mut state, 1, arrived, &without, None, &mut late);
                    // It arrives: added at its step, every checkpoint at the nearest checkpoint
                    // step at or before it restored, and stepped forward to now, then on.
                    let Some((&from, cp)) = late.ring.range(..=at).next_back() else {
                        continue;
                    };
                    let mut state = (stepper.rollback)(&state, cp);
                    for s in from..=arrived {
                        late.hashes.remove(&s);
                        late.occurrences.remove(&s);
                        late.checkpoints.remove(&s);
                    }
                    play(
                        stepper,
                        &mut state,
                        from,
                        n,
                        &entries,
                        Some(from),
                        &mut late,
                    );
                    if let Some(step) = first_differing(&on_time, &late, 1) {
                        let fl = failure(
                            "late_entry",
                            module,
                            "late_entry",
                            json!({"step": step, "arrived": arrived, "fixture": f.name}),
                        );
                        case.fail(Verdict::Fail, fl.clone());
                        run.failures.push(fl);
                    }
                    run.cases.push(case);
                }
            }
        }
    }
    Some(run)
}
