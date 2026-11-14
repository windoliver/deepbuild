//! #538's Scope: `deep_kinds` lists the forms the live-game-state tasks added (#186): the mark
//! set's array and copy columns, the hex grid and its rules, copy tables, the logic grid, the
//! flip by array and the terrain overlays, each with its default. Drives `deep-show kinds --dump`
//! as #412's suite does.
use std::process::Command;

use serde_json::{json, Value};

#[test]
fn the_dump_lists_every_live_game_state_form_with_its_default() {
    let dir = std::env::temp_dir().join(format!("deep-show-live-forms-{}", std::process::id()));
    let status = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .args(["kinds", "--dump"])
        .arg(&dir)
        .status()
        .expect("deep-show starts");
    assert!(status.success());
    let file = std::fs::read_dir(&dir).expect("the dump folder").next().expect("one dump").expect("an entry").path();
    let dump: Value = serde_json::from_slice(&std::fs::read(file).expect("the dump")).expect("JSON");
    let _ = std::fs::remove_dir_all(&dir);
    let kind = |name: &str| -> Vec<Value> {
        let kinds = dump["registries"].as_array().into_iter().flatten().filter(|r| r["name"] == "kind@1");
        let entries = kinds.flat_map(|r| r["entries"].as_array().into_iter().flatten());
        let found: Vec<&Value> = entries.filter(|e| e["name"] == name).collect();
        assert_eq!(found.len(), 1, "one entry {name}");
        found[0]["fields"].as_array().expect("fields").clone()
    };
    let default_of = |name: &str, field: &str| -> Value {
        let fields = kind(name);
        let f = fields.iter().find(|f| f["name"] == field);
        f.unwrap_or_else(|| panic!("{name} lists {field}: {fields:?}"))["default"].clone()
    };
    let listed = [
        ("cells@1", "grid.array", Value::Null),
        ("cells@1", "grid.glyphs", Value::Null),
        ("cells@1", "grid.roles", Value::Null),
        ("marks@1", "columns.<name>.array", Value::Null),
        ("marks@1", "columns.<name>.copy", Value::Null),
        ("marks@1", "columns.<name>.key", Value::Null),
        ("marks@1", "grid.shape", json!("square")),
        ("marks@1", "grid.hex.orient", json!("pointy")),
        ("marks@1", "grid.hex.offset", json!("odd")),
        ("marks@1", "recipe.precedence", Value::Null),
        ("text@1", "text.copy", Value::Null),
        ("text@1", "data.copy.<locale>.<table>.missing", json!("")),
        ("group@1", "flip.array", Value::Null),
        ("group@1", "flip.map", Value::Null),
        ("plate@1", "overlays[].grid", Value::Null),
        ("plate@1", "overlays[].opacity", json!(1)),
        ("instance@1", "live.array", Value::Null),
    ];
    for (name, field, default) in listed {
        assert_eq!(default_of(name, field), default, "{name} {field}'s default");
    }
}
