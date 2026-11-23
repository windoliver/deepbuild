//! The probe of #2700.dad8fae2 (REVISE-ITEMS.md): `acceptance-2700-reached-probe` loads a board in
//! a session, then hands `revise_items` a revision that changes one item's value and, besides it,
//! one member outside `items` (`data`, then `assets`) that the patch does not name in `reached`.
//! It prints one JSON line of what each call answered; it judges nothing, reached.test.mjs does.
//!
//! A control per member hands the same revision with that member named in `reached`, so the report
//! also says the member's difference is one `revise_items` can see.

use std::collections::BTreeMap;

use deep_canvas::registry::{BuildSet, Registry};
use deep_canvas::schedule::{Options, Scheduler, Session};
use serde_json::{json, Value};

fn board() -> Value {
    json!({"format": 1, "size": [100, 100],
        "data": {"goal": 7, "note": "before"},
        "assets": {"logo": {"type": "image/png", "sha256": "0000000000000000000000000000000000000000000000000000000000000000"}},
        "items": {
            "a": {"id": "a", "kind": "rect@1", "params": {"box": [0, 0, 10, 10]}},
            "b": {"id": "b", "kind": "rect@1", "params": {"box": [20, 0, 10, 10]}},
        }})
}

/// What one `revise_items` call answered, on a fresh session that loaded `first`.
fn revise(sealed: &deep_canvas::registry::Sealed, first: &Value, next: &Value, reached: &[&str]) -> Value {
    let mut s = Scheduler::new(sealed, Options::default());
    let mut session = Session::new(0, BTreeMap::new());
    session.load(&mut s, first);
    match session.revise_items(&mut s, next, &["a"], reached) {
        Some(issues) => json!({"revised": true, "issues": issues.iter().map(|i| json!({"code": i.code, "path": i.path})).collect::<Vec<_>>()}),
        None => json!({"revised": false}),
    }
}

fn main() {
    let sealed = match Registry::new(BuildSet::Core).seal() {
        Ok(sealed) => sealed,
        Err(e) => {
            println!("{}", json!({"blocked": format!("the core's sealed set does not seal: {e:?}")}));
            return;
        }
    };
    let first = board();
    let mut cases = Vec::new();
    for member in ["data", "assets"] {
        let mut next = first.clone();
        next["items"]["a"]["params"]["box"] = json!([3, 0, 12, 10]);
        match member {
            "data" => next["data"]["note"] = json!("after"),
            _ => next["assets"]["logo"]["type"] = json!("image/jpeg"),
        }
        cases.push(json!({
            "member": member,
            "member_differs": first.get(member) != next.get(member),
            "only_item_and_member_differ": first.as_object().unwrap().keys()
                .filter(|k| first.get(k.as_str()) != next.get(k.as_str()))
                .cloned().collect::<Vec<_>>(),
            "not_reached": revise(&sealed, &first, &next, &[]),
            "reached": revise(&sealed, &first, &next, &[member]),
        }));
    }
    println!("{}", json!({"debug_assertions": cfg!(debug_assertions), "cases": cases}));
}
