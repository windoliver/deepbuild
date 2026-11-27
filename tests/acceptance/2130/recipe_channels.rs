use deep_canvas::document::{check_packed, CheckResult, Packs};
use deep_canvas::registry;
use serde_json::{json, Value};

const ID: &str = "#2130.96087f96";
const OWN_TARGET: &str = "items/n1/at/pos/0";

fn pack_of_two_bars() -> Value {
    json!({
        "id": "test/nest", "name": "nest", "version": "1.0.0", "license": "MIT",
        "description": "recipes in recipes",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "recipes": {"nest.grow@1": {
            "id": "nest.grow", "version": "1.0",
            "steps": {"bars": {"op": "mark", "kind": "test.rect@1",
                               "repeat": {"count": 2, "as": "i"},
                               "params": {"w": 4, "h": 4}}},
            "channels": {"rise": {"target": "step:bars/params/h", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 4, "interp": "linear"},
                         "k1": {"t": "1s", "value": 8}}}}
        }}
    })
}

fn pack_of_one_bar() -> Value {
    json!({
        "id": "test/nest", "name": "nest", "version": "1.0.0", "license": "MIT",
        "description": "recipes in recipes",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "recipes": {"nest.grow@1": {
            "id": "nest.grow", "version": "1.0",
            "steps": {"bars": {"op": "mark", "kind": "test.rect@1",
                               "params": {"w": 4, "h": 4}}},
            "channels": {"rise": {"target": "step:bars/params/h", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 4, "interp": "linear"},
                         "k1": {"t": "1s", "value": 8}}}}
        }}
    })
}

fn own_channel() -> Value {
    json!({"target": OWN_TARGET, "type": "f32",
        "keys": {"k0": {"t": "0s", "value": 10, "interp": "linear"},
                 "k1": {"t": "1s", "value": 20}}})
}

fn checked(pack: &Value, id: &str) -> CheckResult {
    let sealed = registry::core();
    let mut packs = Packs::default();
    let admitted = packs.admit(pack, &sealed).map(|p| p.id.text());
    assert!(
        admitted.is_ok(),
        "{ID} precondition: the test's pack is admitted: {admitted:?}"
    );
    let mut doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [640, 360], "packs": ["test/nest@1.0.0"],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"n1": {"id": "n1", "kind": "nest.grow@1", "layer": "main", "name": "n1",
                         "order": "a0", "at": {"pos": [10, 0, 0]}}},
        "channels": {}
    });
    doc["channels"][id] = own_channel();
    check_packed(&doc, &sealed, &packs)
}

fn listed(result: &CheckResult) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for issue in &result.issues {
        out.push(format!("{} at {}", issue.code, issue.path));
    }
    out
}

fn lowered_target(result: &CheckResult, id: &str) -> Option<String> {
    result.lowered["channels"][id]["target"]
        .as_str()
        .map(str::to_string)
}

fn collision_problems(result: &CheckResult, id: &str) -> Vec<String> {
    let path = format!("channels/{id}");
    let mut problems: Vec<String> = Vec::new();
    let mut severities: Vec<&str> = Vec::new();
    for issue in &result.issues {
        if issue.code == "bad_id" && issue.path == path {
            severities.push(issue.severity);
        }
    }
    if severities.is_empty() {
        problems.push(format!(
            "no bad_id is raised at {path}; the check raised {:?}",
            listed(result)
        ));
    } else if !severities.contains(&"error") {
        problems.push(format!(
            "the bad_id at {path} is no error, so the document is not refused: {severities:?}"
        ));
    }
    let held = lowered_target(result, id);
    if held.as_deref() != Some(OWN_TARGET) {
        problems.push(format!(
            "the lowered document's channel {id} targets {held:?}, not the document's own \
             {OWN_TARGET}: the recipe's channel took its place"
        ));
    }
    problems
}

#[test]
fn ac5_a_document_channel_where_the_tests_recipe_channel_expands_to_is_refused_bad_id() {
    let free = checked(&pack_of_two_bars(), "mine");
    let raised = listed(&free);
    assert!(
        !raised.iter().any(|r| r.starts_with("bad_id ")),
        "{ID} precondition: a document channel at an ID no recipe channel expands to raises no \
         bad_id: {raised:?}"
    );
    assert_eq!(
        lowered_target(&free, "mine").as_deref(),
        Some(OWN_TARGET),
        "{ID} precondition: the lowered document keeps the document's channel `mine`"
    );
    assert_eq!(
        lowered_target(&free, "n1.rise.0").as_deref(),
        Some("items/n1.bars.0/params/h"),
        "{ID} precondition: the recipe's channel joins the document as n1.rise.0"
    );
    assert_eq!(
        lowered_target(&free, "n1.rise.1").as_deref(),
        Some("items/n1.bars.1/params/h"),
        "{ID} precondition: the recipe's channel joins the document as n1.rise.1"
    );

    let mut problems: Vec<String> = Vec::new();
    for id in ["n1.rise.0", "n1.rise.1"] {
        let result = checked(&pack_of_two_bars(), id);
        problems.extend(collision_problems(&result, id));
    }
    assert!(
        problems.is_empty(),
        "{ID}: the test's document holds a channel of its own at an ID its recipe's channel \
         `rise` expands to, and its check: {problems:?}"
    );
}

#[test]
fn ac5_a_document_channel_at_n1_rise_is_refused_bad_id() {
    let free = checked(&pack_of_one_bar(), "mine");
    let raised = listed(&free);
    assert!(
        !raised.iter().any(|r| r.starts_with("bad_id ")),
        "{ID} precondition: a document channel at an ID no recipe channel expands to raises no \
         bad_id: {raised:?}"
    );
    assert_eq!(
        lowered_target(&free, "mine").as_deref(),
        Some(OWN_TARGET),
        "{ID} precondition: the lowered document keeps the document's channel `mine`"
    );
    assert_eq!(
        lowered_target(&free, "n1.rise").as_deref(),
        Some("items/n1.bars/params/h"),
        "{ID} precondition: the recipe's channel joins the document as n1.rise"
    );

    let result = checked(&pack_of_one_bar(), "n1.rise");
    let problems = collision_problems(&result, "n1.rise");
    assert!(
        problems.is_empty(),
        "{ID}: the document holds a channel of its own at n1.rise, the ID the recipe's channel \
         `rise` expands to for the instance n1, and its check: {problems:?}"
    );
}
