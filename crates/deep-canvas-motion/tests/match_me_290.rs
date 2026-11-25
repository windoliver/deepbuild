//! #290: a driver's var written `match.me` reads this copy's player, a view value the frame's
//! document carries (canvas primitives: Net: this copy's player; Object: hidden view).

use deep_canvas_motion::eval::{self, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

/// A piece whose hero's hidden view shows at 0.4 to the player `owner` names, with `me` as the
/// document's `match.me` when given.
fn piece(owner: f64, me: Option<Value>) -> Map<String, Value> {
    let mut doc = json!({
        "format": 1, "id": "heroes", "size": [640, 360], "layers": {"main": {"order": "a0"}},
        "items": {"hero": {"id": "hero", "kind": "mark.box@1", "layer": "main",
                           "params": {"size": [1, 1, 1], "owner": owner},
                           "hidden_view": {"opacity": 0}}},
        "drivers": {"view": {"target": "items/hero/hidden_view/opacity",
                             "expr": "0.4 * max(0, 1 - abs(who - me))",
                             "vars": {"who": "items/hero/params/owner", "me": "match.me"}}},
    });
    if let Some(me) = me {
        doc["match.me"] = me;
    }
    doc.as_object().expect("a document").clone()
}

/// The hero's hidden view's opacity as the document's motion writes it at t = 0.
fn opacity(doc: &Map<String, Value>) -> f64 {
    let program = Program::compile(doc).expect("the piece compiles");
    let mut state = program.state();
    program.evaluate_local(0, Validity::Full, &mut state);
    let written = eval::written(doc, &program, &state);
    written["hero"]["hidden_view"]["opacity"]
        .as_f64()
        .expect("a number")
}

#[test]
fn a_driver_var_written_match_me_reads_this_copys_player() {
    // Each copy's own player; a piece played alone reads 1; none names no player.
    assert_eq!(opacity(&piece(1.0, Some(json!(1)))), 0.4);
    assert_eq!(opacity(&piece(1.0, Some(json!(2)))), 0.0);
    assert_eq!(opacity(&piece(2.0, Some(json!(2)))), 0.4);
    assert_eq!(opacity(&piece(1.0, None)), 0.4);
    assert_eq!(opacity(&piece(2.0, None)), 0.0);
    assert_eq!(opacity(&piece(1.0, Some(json!("none")))), 0.0);
}

#[test]
fn each_players_program_keys_apart_and_a_piece_that_reads_no_player_keys_alike() {
    use deep_canvas::schedule::Canonical;
    let bytes = |doc: &Map<String, Value>| {
        let mut out = Vec::new();
        Program::compile(doc).expect("compiles").encode(&mut out);
        out
    };
    assert_ne!(
        bytes(&piece(1.0, Some(json!(1)))),
        bytes(&piece(1.0, Some(json!(2))))
    );
    let mut plain = piece(1.0, Some(json!(1)));
    plain.remove("drivers");
    let mut other = plain.clone();
    other.insert("match.me".into(), json!(2));
    assert_eq!(bytes(&plain), bytes(&other));
}
