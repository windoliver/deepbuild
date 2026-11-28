mod common;

use std::collections::BTreeSet;

use common::{civil_today, none};
use deep_canvas_effects::shipped;
use deep_canvas_effects::values::{ledger, release_run, verdict, Verdict};
use serde_json::{Map, Value};

const GUARD_SHAPED: &[&str] = &["max@1", "min@1", "clamp@1"];

fn step_maps(v: &Value, out: &mut Vec<Vec<String>>, path: &mut Vec<String>) {
    if let Value::Object(o) = v {
        let holds_steps = path.last().is_some_and(|k| k == "steps" || k == "body");
        if holds_steps && o.values().any(|s| s.get("op").and_then(Value::as_str).is_some()) {
            out.push(path.clone());
        }
        for (k, x) in o {
            path.push(k.clone());
            step_maps(x, out, path);
            path.pop();
        }
    } else if let Value::Array(a) = v {
        for (i, x) in a.iter().enumerate() {
            path.push(i.to_string());
            step_maps(x, out, path);
            path.pop();
        }
    }
}

fn at<'a>(v: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter().try_fold(v, |v, k| match v {
        Value::Array(a) => a.get(k.parse::<usize>().ok()?),
        _ => v.get(k),
    })
}

fn at_mut<'a>(v: &'a mut Value, path: &[String]) -> Option<&'a mut Value> {
    path.iter().try_fold(v, |v, k| match v {
        Value::Array(a) => a.get_mut(k.parse::<usize>().ok()?),
        _ => v.get_mut(k),
    })
}

fn steps_of(op: &Value) -> Vec<(Vec<String>, String, Value)> {
    let mut maps = Vec::new();
    step_maps(op, &mut maps, &mut Vec::new());
    let mut out = Vec::new();
    for path in maps {
        if let Some(Value::Object(m)) = at(op, &path) {
            for (id, s) in m {
                if s.get("op").and_then(Value::as_str).is_some() {
                    out.push((path.clone(), id.clone(), s.clone()));
                }
            }
        }
    }
    out
}

fn constant(op: &Value, arg: &Value) -> bool {
    match arg {
        Value::String(name) => steps_of(op)
            .iter()
            .any(|(_, id, s)| id == name && s["op"] == "const@1"),
        _ => true,
    }
}

fn kept_values(op: &Value, step: &Value) -> Vec<String> {
    let args = step.get("args").and_then(Value::as_object).cloned().unwrap_or_default();
    let ports: Vec<&str> = if step["op"] == "clamp@1" { vec!["x"] } else { args.keys().map(String::as_str).collect() };
    ports
        .iter()
        .filter_map(|p| args.get(*p))
        .filter(|a| !constant(op, a))
        .filter_map(|a| a.as_str().map(str::to_string))
        .collect()
}

fn rewired(v: &Value, from: &str, to: &str) -> Value {
    match v {
        Value::String(s) if s == from || s.starts_with(&format!("{from}.")) => Value::String(to.to_string()),
        Value::Array(a) => Value::Array(a.iter().map(|x| rewired(x, from, to)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), rewired(x, from, to))).collect::<Map<_, _>>()),
        other => other.clone(),
    }
}

fn without(op: &Value, map: &[String], guard: &str, keep: &str) -> Option<Value> {
    let mut out = op.clone();
    at_mut(&mut out, map)?.as_object_mut()?.remove(guard)?;
    Some(rewired(&out, guard, keep))
}

fn ablated_verdicts(op: &Value, guard: &str) -> Result<Vec<(String, bool)>, String> {
    let found = steps_of(op).into_iter().find(|(_, id, _)| id == guard);
    let Some((map, _, step)) = found else {
        return Err(format!("{guard} is no step of it"));
    };
    let kept = kept_values(op, &step);
    if kept.is_empty() {
        return Err(format!("{guard} ({}) guards no value a step computes", step["op"]));
    }
    let mut out = Vec::new();
    for keep in kept {
        let Some(ablated) = without(op, &map, guard, &keep) else {
            return Err(format!("{guard} can't be taken out"));
        };
        match verdict(&ablated) {
            Ok(Verdict::Proven) => out.push((keep, false)),
            Ok(Verdict::Unproven(_)) => out.push((keep, true)),
            Err(issues) => return Err(format!(
                "with {guard} taken out (its value {keep} read in its place) it doesn't reach the values stage: {:?}",
                issues.iter().map(|i| i.code).collect::<Vec<_>>()
            )),
        }
    }
    Ok(out)
}

fn id_of(op: &Value) -> String {
    op["id"].as_str().unwrap_or("(no id)").to_string()
}

#[test]
fn ac6_01ec943d_removing_each_guard_of_a_shipped_operator_turns_it_unproven_and_the_release_run_reports_it() {
    let all = shipped::all();
    let run = release_run(&all, &ledger(), &civil_today());
    let rows: Vec<Value> = run["ablations"].as_array().cloned().unwrap_or_default();
    let mut failures = Vec::new();
    if !run["ablations"].is_array() {
        failures.push(format!("the release run reports no ablations list: {}", run.to_string().chars().take(1500).collect::<String>()));
    }
    let mut listed = BTreeSet::new();
    for r in &rows {
        let (Some(operator), Some(guard)) = (r["operator"].as_str(), r["guard"].as_str()) else {
            failures.push(format!("an ablation row names no operator and guard step: {r}"));
            continue;
        };
        listed.insert((operator.to_string(), guard.to_string()));
        if r["verdict"] != "unproven" {
            failures.push(format!("the release run reports {operator} without {guard} as {}, not unproven", r["verdict"]));
        }
        let Some(op) = all.iter().find(|o| id_of(o) == operator) else {
            failures.push(format!("the ablation row's operator {operator} is no shipped operator"));
            continue;
        };
        match ablated_verdicts(op, guard) {
            Err(e) => failures.push(format!("{operator}: {e}")),
            Ok(v) if v.iter().any(|(_, unproven)| *unproven) => {}
            Ok(v) => failures.push(format!(
                "{operator} with its guard {guard} taken out is still proven (each value read in its place: {:?})",
                v.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>()
            )),
        }
    }
    for op in &all {
        let id = id_of(op);
        if !matches!(verdict(op), Ok(Verdict::Proven)) {
            continue;
        }
        for (_, guard, step) in steps_of(op) {
            let shaped = step["op"].as_str().is_some_and(|o| GUARD_SHAPED.contains(&o));
            if !shaped || kept_values(op, &step).len() != 1 {
                continue;
            }
            let turns = matches!(ablated_verdicts(op, &guard), Ok(v) if v.iter().all(|(_, u)| *u));
            if turns && !listed.contains(&(id.clone(), guard.clone())) {
                failures.push(format!(
                    "{id} is proven, and unproven with its {} step {guard} taken out, but the release run's ablations don't list it",
                    step["op"]
                ));
            }
        }
    }
    none(&failures, "#1397.01ec943d");
}
