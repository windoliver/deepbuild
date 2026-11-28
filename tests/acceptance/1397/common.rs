#![allow(dead_code)]

use deep_canvas_effects::check::Checked;
use deep_canvas_effects::graph::Issue;
use serde_json::{json, Value};

pub const CODE: &str = "operator.value";

pub fn param(name: &str, ty: &str, lo: f64, hi: f64) -> Value {
    json!({"type": ty, "from": {"param": format!("params/{name}")}, "range": [lo, hi]})
}

pub fn pass_of(id: &str, origin: &str, inputs: Value, steps: Value, color: &str) -> Value {
    json!({
        "id": id, "kind": "pass", "about": "An acceptance fixture of the values stage.", "origin": origin,
        "inputs": inputs, "steps": steps, "outputs": {"color": color},
        "chain": "effects", "order": "a0", "resolution": "full",
        "cost": {"ns_per_px": 100000}, "fallback": "look"
    })
}

pub fn agent_pass(id: &str, inputs: Value, steps: Value, color: &str) -> Value {
    pass_of(id, "composed", inputs, steps, color)
}

pub fn first_party_pass(id: &str, inputs: Value, steps: Value, color: &str) -> Value {
    pass_of(id, "shipped", inputs, steps, color)
}

pub fn bare_op(op: &Value) -> Option<String> {
    op.as_str()
        .map(|s| s.split('@').next().unwrap_or(s).to_string())
}

pub fn value_refusals(issues: &[Issue]) -> Vec<Value> {
    issues
        .iter()
        .map(Issue::to_json)
        .filter(|j| j["code"] == CODE)
        .collect()
}

pub fn shown(issues: &[Issue]) -> String {
    let all: Vec<Value> = issues.iter().map(Issue::to_json).collect();
    let text = Value::Array(all).to_string();
    text.chars().take(3000).collect()
}

pub fn names(v: &Value, name: &str) -> bool {
    match v {
        Value::String(s) => s == name || s.ends_with(&format!("/{name}")),
        Value::Array(a) => a.iter().any(|x| names(x, name)),
        Value::Object(o) => o
            .iter()
            .any(|(k, x)| k != "message" && names(x, name)),
        _ => false,
    }
}

pub fn refusal_failures(
    what: &str,
    result: &Result<Checked, Vec<Issue>>,
    step: &str,
    op: Option<&str>,
    why: Option<&str>,
) -> Vec<String> {
    let issues = match result {
        Ok(_) => return vec![format!("{what}: the check passes it; it must refuse it with {CODE} at step {step}")],
        Err(issues) => issues,
    };
    let found = value_refusals(issues);
    if found.is_empty() {
        return vec![format!("{what}: refused, but with no {CODE} issue: {}", shown(issues))];
    }
    let at_step: Vec<&Value> = found.iter().filter(|j| j["step"] == step).collect();
    if at_step.is_empty() {
        return vec![format!("{what}: no {CODE} issue names step {step}: {}", shown(issues))];
    }
    let fits = |j: &&Value| {
        op.is_none_or(|o| bare_op(&j["op"]).as_deref() == Some(o))
            && why.is_none_or(|w| j["why"] == w)
            && j.get("input").is_some_and(|i| !i.is_null())
    };
    if at_step.iter().any(fits) {
        return Vec::new();
    }
    vec![format!(
        "{what}: the {CODE} issue at step {step} doesn't carry op {}, why {} and its input range: {}",
        op.unwrap_or("(any)"),
        why.unwrap_or("(any)"),
        shown(issues)
    )]
}

pub fn passes_failures(what: &str, result: &Result<Checked, Vec<Issue>>) -> Vec<String> {
    match result {
        Ok(_) => Vec::new(),
        Err(issues) => vec![format!("{what}: the check refuses it: {}", shown(issues))],
    }
}

pub fn civil_today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the clock reads after 1970")
        .as_secs() as i64;
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn none(failures: &[String], what: &str) {
    assert!(
        failures.is_empty(),
        "{what}:\n  {}",
        failures.iter().take(40).cloned().collect::<Vec<_>>().join("\n  ")
    );
}
