//! #3379: a logic item's control reads are declared references. So `refs::undeclared`, which the
//! kit's `references` part reads, leaves them out, and a fixture whose logic item reads a control
//! passes that part. `refs_to` lists them, and `unresolved_controls` names a read whose control
//! the document no longer holds.

use deep_canvas::refs::{self, Name};
use deep_canvas::registry::{BuildSet, Registry, Sealed};
use serde_json::{json, Value};

fn sealed() -> Sealed {
    Registry::new(BuildSet::Full)
        .with(deep_logic::module::module())
        .with(deep_canvas_sandbox::module::module())
        .seal()
        .expect("the logic and sandbox modules seal together")
}

/// A board whose logic item `counter` reads `controls` among a reading and another item's array.
fn board(controls: Value) -> Value {
    json!({
        "format": 1, "profile": "board", "controls": controls,
        "items": {
            "counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a0",
                "params": {"reads": ["press", "reading:pad", "other.score"],
                           "preview": {"reads": ["aim"]},
                           "writes": {"presses": {"type": "i32"}}}},
            "other": {"id": "other", "kind": "logic@1", "name": "Other", "order": "a1",
                "params": {"writes": {"score": {"type": "i32"}}}}
        }
    })
}

#[test]
fn a_logic_items_control_reads_are_declared_so_the_kit_finds_no_undeclared_field() {
    let doc = board(json!({"press": {"kind": "slider"}, "aim": {"kind": "slider"}}));
    assert_eq!(
        refs::undeclared(&doc, &sealed()),
        Vec::<(String, String)>::new()
    );
}

#[test]
fn refs_to_a_control_lists_each_read_of_it_and_no_other_read() {
    let doc = board(json!({"press": {"kind": "slider"}, "aim": {"kind": "slider"}}));
    let sealed = sealed();
    let rows = |id: &str| -> Vec<(String, &'static str)> {
        refs::refs_to(&doc, &sealed, &Name::Control(id.into()))
            .into_iter()
            .map(|r| (r.path, r.kind))
            .collect()
    };
    assert_eq!(
        rows("press"),
        [("items/counter/params/reads/0".to_string(), "control")]
    );
    assert_eq!(
        rows("aim"),
        [(
            "items/counter/params/preview/reads/0".to_string(),
            "control"
        )]
    );
    let controls = refs::refs(&doc, &sealed)
        .into_iter()
        .filter(|r| r.kind == refs::kind::CONTROL)
        .count();
    assert_eq!(
        controls, 2,
        "the reading and the array read name no control"
    );
}

#[test]
fn a_read_of_a_control_the_document_no_longer_holds_is_unresolved() {
    let doc = board(json!({"aim": {"kind": "slider"}}));
    assert_eq!(
        refs::unresolved_controls(&doc, &sealed()),
        [(
            "counter".to_string(),
            "items/counter/params/reads/0".to_string(),
            "press".to_string()
        )]
    );
}

#[test]
fn a_control_and_an_item_of_one_id_keep_their_rows_apart() {
    let mut doc = board(json!({"press": {"kind": "slider"}, "aim": {"kind": "slider"}}));
    doc["items"]["press"] =
        json!({"id": "press", "kind": "group@1", "name": "Press", "order": "a2"});
    doc["items"]["dot"] =
        json!({"id": "dot", "kind": "circle@1", "name": "Dot", "order": "a3", "parent": "press"});
    let sealed = sealed();
    let paths = |name: Name| -> Vec<String> {
        refs::refs_to(&doc, &sealed, &name)
            .into_iter()
            .map(|r| r.path)
            .collect()
    };
    assert_eq!(
        paths(Name::Control("press".into())),
        ["items/counter/params/reads/0"]
    );
    assert_eq!(paths(Name::Item("press".into())), ["items/dot/parent"]);
}
