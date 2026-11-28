mod common;

use common::{civil_today, first_party_pass, names, none, param};
use deep_canvas_effects::shipped;
use deep_canvas_effects::values::{ledger, release_run};
use serde_json::{json, Value};

const UNGUARDED: &str = "test.unguarded_divide@1";
const PROVEN: &str = "test.proven_tint@1";
const TODAY: &str = "2030-06-01";
const LATER: &str = "2030-09-01";
const EARLIER: &str = "2030-05-01";

fn unguarded() -> Value {
    first_party_pass(
        UNGUARDED,
        json!({"b": param("b", "f32", 0.0, 1.0)}),
        json!({
            "q": {"op": "div@1", "args": {"a": 1.0, "b": "b"}},
            "out": {"op": "compose@1", "args": {"x": "q", "y": "q", "z": "q", "w": 1.0}}
        }),
        "out",
    )
}

fn proven() -> Value {
    first_party_pass(
        PROVEN,
        json!({"a": param("a", "f32", 0.0, 1.0)}),
        json!({"out": {"op": "compose@1", "args": {"x": "a", "y": "a", "z": "a", "w": 1.0}}}),
        "out",
    )
}

fn row(operator: &str, ends: &str) -> Value {
    json!({"operator": operator, "reason": "an acceptance fixture of the ledger", "owner": "tests", "ends": ends})
}

fn with_rows(rows: &[Value]) -> Value {
    let mut l = ledger();
    let list = l.as_array_mut().expect("the ledger is a list of rows");
    list.extend(rows.iter().cloned());
    l
}

fn issues_naming(run: &Value, operator: &str) -> Vec<Value> {
    run["issues"]
        .as_array()
        .map(|a| a.iter().filter(|i| names(i, operator)).cloned().collect())
        .unwrap_or_default()
}

fn brief(v: &Value) -> String {
    v.to_string().chars().take(2500).collect()
}

#[test]
fn ac5_dc1a3fa8_every_shipped_operator_is_proven_or_ledgered_and_a_missing_an_expired_or_a_needless_row_fails() {
    let mut failures = Vec::new();
    let all = shipped::all();
    let today = civil_today();

    let run = release_run(&all, &ledger(), &today);
    match run["issues"].as_array() {
        Some(a) if a.is_empty() => {}
        _ => failures.push(format!(
            "the release run on {today} over the shipped operators and the ledger as it stands raises issues: {}",
            brief(&run["issues"])
        )),
    }

    let mut with_unguarded = all.clone();
    with_unguarded.push(unguarded());
    let run = release_run(&with_unguarded, &ledger(), &today);
    if issues_naming(&run, UNGUARDED).is_empty() {
        failures.push(format!(
            "an unproven first-party operator on neither list ({UNGUARDED}) raises no issue naming it: {}",
            brief(&run["issues"])
        ));
    }

    let run = release_run(&with_unguarded, &with_rows(&[row(UNGUARDED, LATER)]), TODAY);
    let named = issues_naming(&run, UNGUARDED);
    if !named.is_empty() {
        failures.push(format!(
            "{UNGUARDED} on a row that ends {LATER} is ledgered on {TODAY}, yet issues name it: {}",
            brief(&Value::Array(named))
        ));
    }
    let run = release_run(&with_unguarded, &with_rows(&[row(UNGUARDED, EARLIER)]), TODAY);
    if issues_naming(&run, UNGUARDED).is_empty() {
        failures.push(format!(
            "{UNGUARDED} on a row that ended {EARLIER} raises no issue naming it on {TODAY}: {}",
            brief(&run["issues"])
        ));
    }

    let mut with_proven = all.clone();
    with_proven.push(proven());
    let run = release_run(&with_proven, &ledger(), TODAY);
    let named = issues_naming(&run, PROVEN);
    if !named.is_empty() {
        failures.push(format!(
            "the proven first-party operator {PROVEN} with no row raises issues naming it: {}",
            brief(&Value::Array(named))
        ));
    }
    let run = release_run(&with_proven, &with_rows(&[row(PROVEN, LATER)]), TODAY);
    if issues_naming(&run, PROVEN).is_empty() {
        failures.push(format!(
            "a ledger row for the proven operator {PROVEN} raises no issue naming it: {}",
            brief(&run["issues"])
        ));
    }

    none(&failures, "#1397.dc1a3fa8");
}
