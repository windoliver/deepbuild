//! #190 "A trap in library code names the library and its function in logic.trap", on every reply
//! that reports traps: a bake, a save opened and played on (`open_save`, #534) and a live frame.
//! The piece is built with the #190 acceptance suite's own builders (tests/acceptance/190/libs.ts):
//! `turns` writes v = lib:turns.next_turn(k, 3), linked from turns@1 in pack turnkit@1.0.0. With 8
//! units of fuel a step runs out inside next_turn.

use deep_logic::{Logic, Planted};
use serde_json::{json, Value};

fn piece(fuel: Option<u64>) -> Value {
    let mut p: Value =
        serde_json::from_str(include_str!("fixtures/turns-piece.json")).expect("the piece");
    let params = &mut p["items"]["turns"]["params"];
    params["saves"] = json!({"request": "v", "slots": 8});
    if let Some(fuel) = fuel {
        params["budget"] = json!({"fuel": fuel});
    }
    p
}

fn trap(reply: &Value, what: &str) -> Value {
    assert_eq!(reply["ok"], true, "{what}: {reply}");
    let traps = reply["traps"]
        .as_array()
        .unwrap_or_else(|| panic!("{what} reports traps: {reply}"));
    assert!(!traps.is_empty(), "{what} reports the fuel trap: {reply}");
    assert_eq!(traps[0]["kind"], "fuel", "{what}: {}", traps[0]);
    traps[0].clone()
}

#[test]
fn a_trap_in_library_code_names_its_library_from_a_bake_an_opened_save_and_a_live_frame() {
    let mut logic = Logic::new(Planted::default());
    let named = json!({"name": "turns@1", "function": "next_turn"});
    let library =
        |t: &Value| json!({"name": t["library"]["name"], "function": t["library"]["function"]});

    let baked =
        logic.handle(&json!({"call": "bake", "piece": piece(Some(8)), "track": [], "steps": 1}));
    let from_bake = trap(&baked, "the bake");
    assert_eq!(library(&from_bake), named, "the bake's trap: {from_bake}");

    // v = 1 at step 0 asks for slot 1's save; opened under 8 units of fuel, the next step traps.
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("library-trap-saves");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a saves folder");
    let saving = logic.handle(
        &json!({"call": "bake", "piece": piece(None), "track": [], "steps": 1, "saves_dir": dir}),
    );
    assert_eq!(
        saving["saves"][0]["slot"], 1,
        "the bake saves slot 1: {saving}"
    );
    let opened = logic.handle(&json!({"call": "open_save", "piece": piece(Some(8)), "saves_dir": dir, "slot": 1, "track": [], "steps": 3}));
    let from_save = trap(&opened, "the opened save");
    assert_eq!(
        library(&from_save),
        named,
        "the opened save's trap: {from_save}"
    );
    assert_eq!(from_save["library"]["hash"], from_bake["library"]["hash"]);

    let view = logic.handle(&json!({"call": "view", "piece": piece(Some(8)), "span": 1.0}));
    assert_eq!(view["ok"], true, "{view}");
    let frame = logic.handle(&json!({"call": "frame", "session": view["session"], "play": 0.1}));
    let from_frame = trap(&frame, "the live frame");
    assert_eq!(
        library(&from_frame),
        named,
        "the live frame's trap: {from_frame}"
    );
    assert_eq!(from_frame["library"]["hash"], from_bake["library"]["hash"]);
}
