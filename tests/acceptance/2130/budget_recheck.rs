use std::collections::BTreeSet;

use deep_canvas::budget::Class;
use deep_canvas::document::{check_in, recheck, Issue};
use deep_canvas::registry;
use serde_json::{json, Value};

const ID: &str = "#2130.766a56f0";
const LIGHTS: &str = "budget/lights";
const FILL: &str = "budget/fill_shaded";

fn document(lights: &[&str]) -> Value {
    let mut doc = json!({
        "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
        "size": [640, 360],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {}
    });
    for &id in lights {
        doc["items"][id] = json!({
            "id": id, "kind": "light.sun@1", "layer": "main", "name": id, "order": "a0",
            "params": {}
        });
    }
    doc
}

fn over_budget_at(issues: &[Issue], path: &str) -> bool {
    issues
        .iter()
        .any(|issue| issue.code == "over_budget" && issue.path == path)
}

fn listed(issues: &[Issue]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for issue in issues {
        out.push(format!("{} {:?} {}", issue.code, issue.ids, issue.path));
    }
    out.sort();
    out
}

#[test]
fn ac1_a_second_light_past_budget_lights_1_is_checked_against_the_whole_document() {
    let sealed = registry::core();
    let changed = BTreeSet::from(["sun2".to_string()]);

    let before = document(&["sun"]);
    let mut after = document(&["sun", "sun2"]);
    let previous = check_in(&before, &sealed).issues;
    let whole = check_in(&after, &sealed).issues;
    let answer = recheck(&mut after, &previous, &changed, &sealed);
    match &answer {
        Some(issues) => assert_eq!(
            listed(issues),
            listed(&whole),
            "{ID} precondition: a second light created in a document with no budget member is \
             rechecked to the full check's issues"
        ),
        None => panic!(
            "{ID} precondition: a second light created in a document with no budget member is \
             answered by the recheck, which returned None"
        ),
    }

    let mut before = document(&["sun"]);
    before["budget"] = json!({"lights": 1});
    let mut after = document(&["sun", "sun2"]);
    after["budget"] = json!({"lights": 1});
    let previous = check_in(&before, &sealed).issues;
    assert!(
        !over_budget_at(&previous, LIGHTS),
        "{ID} precondition: one light fits budget.lights 1: {:?}",
        listed(&previous)
    );
    let whole = check_in(&after, &sealed).issues;
    assert!(
        over_budget_at(&whole, LIGHTS),
        "{ID} precondition: check of the document with the second light raises over_budget at \
         {LIGHTS}: {:?}",
        listed(&whole)
    );
    let answer = recheck(&mut after, &previous, &changed, &sealed);
    if let Some(issues) = &answer {
        assert!(
            over_budget_at(issues, LIGHTS),
            "{ID}: a second light is created in a document with budget.lights 1 and one light; \
             recheck, with the new item as changed, returned issues without over_budget at \
             {LIGHTS}, which check of the same document raises, so the patch is accepted: the \
             reduced document it checked holds only the new light. It returned {:?}",
            listed(issues)
        );
    }
}

#[test]
fn ac1_a_patch_to_one_of_three_lights_past_budget_lights_2_keeps_the_over_budget() {
    let sealed = registry::core();
    let mut before = document(&["sun", "sun2", "sun3"]);
    before["budget"] = json!({"lights": 2});
    let mut after = before.clone();
    after["items"]["sun3"]["name"] = json!("Sun three");
    let previous = check_in(&before, &sealed).issues;
    assert!(
        over_budget_at(&previous, LIGHTS),
        "{ID} precondition: three lights are past budget.lights 2: {:?}",
        listed(&previous)
    );
    let whole = check_in(&after, &sealed).issues;
    assert!(
        over_budget_at(&whole, LIGHTS),
        "{ID} precondition: check of the document with one light renamed still raises \
         over_budget at {LIGHTS}: {:?}",
        listed(&whole)
    );
    let changed = BTreeSet::from(["sun3".to_string()]);
    let answer = recheck(&mut after, &previous, &changed, &sealed);
    if let Some(issues) = &answer {
        assert!(
            over_budget_at(issues, LIGHTS),
            "{ID}: one of three lights is patched in a document with budget.lights 2; recheck, \
             with that light as changed, returned issues without over_budget at {LIGHTS}, which \
             check of the same document raises: the old over_budget was dropped and the reduced \
             document, holding one light, raised none. It returned {:?}",
            listed(issues)
        );
    }
}

#[test]
fn ac1_a_document_whose_budget_names_only_a_class_is_checked_whole_too() {
    let sealed = registry::core();
    let class = Class::Figure;
    let cap = class.fill_shaded();
    let ids: Vec<String> = (0..=cap).map(|n| format!("fill{n}")).collect();
    let names: Vec<&str> = ids.iter().map(String::as_str).collect();
    let created = names[cap];
    let mut before = document(&names[..cap]);
    let mut after = document(&names);
    before["budget"] = json!({"class": class.name()});
    after["budget"] = json!({"class": class.name()});
    for &id in &names[..cap] {
        before["items"][id]["params"]["fill"] = json!(true);
    }
    for &id in &names {
        after["items"][id]["params"]["fill"] = json!(true);
    }
    let previous = check_in(&before, &sealed).issues;
    assert!(
        !over_budget_at(&previous, FILL),
        "{ID} precondition: {cap} fill lights fit the {} class: {:?}",
        class.name(),
        listed(&previous)
    );
    let whole = check_in(&after, &sealed).issues;
    assert!(
        over_budget_at(&whole, FILL),
        "{ID} precondition: check of the document with one fill light more than the {} class \
         holds raises over_budget at {FILL}: {:?}",
        class.name(),
        listed(&whole)
    );
    let changed = BTreeSet::from([created.to_string()]);
    let answer = recheck(&mut after, &previous, &changed, &sealed);
    if let Some(issues) = &answer {
        assert!(
            over_budget_at(issues, FILL),
            "{ID}: a fill light past the {} class's {cap} is created in a document whose budget \
             names the class; recheck, with the new item as changed, returned issues without \
             over_budget at {FILL}, which check of the same document raises: the class's checks \
             ran on a reduced document holding one light. It returned {:?}",
            class.name(),
            listed(issues)
        );
    }
}
