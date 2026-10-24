//! Time order (issue #138): one warm instance plays a module's own fixtures straight, then
//! stepped back one frame at a time, then at 100 seeded times in shuffled order, and must equal a
//! cold instance at each time in every evaluated array and key outside declared carried state.
//! A module that keeps something between evaluations, such as its last key index, passes a
//! straight play and fails here at the first time it is stepped back.

use serde_json::{json, Value};

use super::instance::{self, How};
use super::{derive, failure, Case, Ctx, PartRun, Rng, Verdict, SEEDED_TIMES};
use crate::hub::{flicks, Hub};

/// One frame at 60 fps, in flicks.
const FRAME: i64 = 705_600_000 / 60;

/// A fixture's times, played straight: its sidecar's `at_times` (a list, or `{from, to, every}`),
/// else 0 to 1 s every frame.
pub fn straight(sidecar: &Value) -> Vec<i64> {
    match sidecar.get("at_times") {
        Some(Value::Array(list)) => {
            let mut out: Vec<i64> = list
                .iter()
                .filter_map(|t| t.as_str().and_then(flicks).or_else(|| t.as_i64()))
                .collect();
            out.sort();
            out.dedup();
            if !out.is_empty() {
                return out;
            }
        }
        Some(Value::Object(span)) => {
            let at = |k: &str, d: i64| {
                span.get(k)
                    .and_then(Value::as_str)
                    .and_then(flicks)
                    .unwrap_or(d)
            };
            let (from, to, every) = (
                at("from", 0),
                at("to", 705_600_000),
                at("every", FRAME).max(1),
            );
            let mut out = Vec::new();
            let mut t = from;
            while t <= to {
                out.push(t);
                t += every;
            }
            return out;
        }
        _ => {}
    }
    (0..=60).map(|k| k * FRAME).collect()
}

/// `time_order`: one case per fixture.
pub fn run(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let module = ctx.module;
    let fixtures: Vec<_> = ctx
        .manifest
        .of_module(module)
        .into_iter()
        .filter(|f| super::catalog::accepted(sealed, f))
        .cloned()
        .collect();
    if fixtures.is_empty() {
        return None;
    }
    // Carried state is declared: a stepping operator's arrays are left out.
    let carried: Vec<String> = sealed
        .ops
        .iter()
        .filter(|o| o.op.step.is_some())
        .map(|o| o.key.clone())
        .collect();
    let mut run = PartRun::new(fixtures.len() as u64);
    for f in fixtures {
        let doc = super::catalog::stamped(&f.document);
        let readings = instance::readings(f.record.as_ref());
        let straight = straight(&f.sidecar);
        let end = *straight.last().unwrap_or(&0);
        let back: Vec<i64> = straight.iter().rev().skip(1).copied().collect();
        let mut rng = Rng::new(derive(
            ctx.call.seed,
            &format!("{module}/time_order/{}", f.name),
            0,
        ));
        let mut shuffled: Vec<i64> = Vec::new();
        while shuffled.len() < SEEDED_TIMES {
            let t = (rng.range(0.0, end.max(1) as f64)).round() as i64;
            if !shuffled.contains(&t) {
                shuffled.push(t);
            }
        }
        let mut all = straight.clone();
        all.extend(&back);
        all.extend(&shuffled);
        let how = How::default();
        let warm = instance::warm_at(sealed, &how, &doc, &look, &readings, &all);
        let cold = instance::spread(
            all.len(),
            || (),
            |_, k| {
                instance::clean_at(sealed, &how, &doc, &look, &readings, &[all[k]], None).remove(0)
            },
        );
        let mut case = Case::new(format!("{}#time_order", f.name), Verdict::Pass)
            .with("fixture", json!(f.name))
            .with(
                "times",
                json!({"straight": straight, "back": back, "shuffled": shuffled}),
            );
        let skip = |n: &instance::Node| carried.contains(&n.operator);
        for (k, t) in all.iter().enumerate() {
            if let Some(place) = instance::first_difference(&warm[k], &cold[k], &skip) {
                let during = if k < straight.len() {
                    "straight"
                } else if k < straight.len() + back.len() {
                    "back"
                } else {
                    "shuffled"
                };
                let fl = failure(
                    "time_order",
                    module,
                    "time_order",
                    json!({"t": t, "during": during, "node": place, "fixture": f.name}),
                );
                case.fail(Verdict::Fail, fl.clone());
                run.failures.push(fl);
                break;
            }
        }
        // The twin: a cold instance of the document with one param moved must not match.
        let mut twin_doc = doc.clone();
        if let Some(item) = twin_doc["items"]
            .as_object_mut()
            .and_then(|i| i.values_mut().next())
        {
            item["name"] = json!("Twin");
            item["at"]["pos"] = json!([3, 5, 0]);
        }
        let twin = instance::clean_at(sealed, &how, &twin_doc, &look, &readings, &[all[0]], None)
            .remove(0);
        let twin_failed = instance::first_difference(&warm[0], &twin, &skip).is_some();
        case.set(
            "twin",
            json!({"verdict": if twin_failed { "FAIL" } else { "PASS" }}),
        );
        if !twin_failed {
            let fl = failure(
                "twin_passed",
                module,
                "time_order",
                json!({"case": case.name()}),
            );
            case.fail(Verdict::Invalid, fl.clone());
            run.failures.push(fl);
        }
        run.cases.push(case);
    }
    Some(run)
}
