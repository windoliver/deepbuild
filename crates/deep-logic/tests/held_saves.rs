//! #1041: a save held for a host with no saves folder, as the web player's page keeps the
//! browser's (canvas primitives: Logic: saves; Export: web player). The piece is the #190
//! acceptance suite's `turns` (tests/acceptance/190/libs.ts), whose array `v` asks for a slot at
//! the end of each step. A held save's bytes open into fresh instances and play on as the run
//! that never stopped; bytes that don't hash to their name are refused as damaged, and whole
//! bytes whose state doesn't decode are refused, naming the state.

use std::rc::Rc;

use deep_logic::piece::{check, History, Piece};
use deep_logic::saves::{open_held, Held};
use deep_logic::world::{track_of, Record, World};
use deep_logic::Planted;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const STEPS: i64 = 6;

fn piece() -> Rc<Piece> {
    let mut p: Value =
        serde_json::from_str(include_str!("fixtures/turns-piece.json")).expect("the piece");
    p["items"]["turns"]["params"]["saves"] = json!({"request": "v", "slots": 8});
    let checked = check(&p, &Planted::default(), &mut History::new());
    Rc::new(checked.map_err(|r| r.0).expect("the piece is admitted"))
}

/// The run that never stopped, to `STEPS`, and the saves its steps asked for.
fn never_stopped(piece: &Rc<Piece>) -> (World, Vec<Held>) {
    let mut rec = Record::default();
    let none = track_of(&[]);
    let mut w = World::new(
        piece.clone(),
        none,
        false,
        Planted::default(),
        &mut rec,
        None,
    )
    .expect("the piece starts");
    w.held = Some(Vec::new());
    w.run(STEPS, &mut rec, &mut |_, _| {});
    let held = w.held.take().expect("its saves are held");
    (w, held)
}

fn name_of(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A held save as `(slot, step, full-state hashes)`.
fn told(s: &Held) -> (i32, i64, Value) {
    (s.slot, s.step, Value::Object(s.deep_hash.clone()))
}

#[test]
fn a_held_save_opens_from_its_bytes_and_plays_on_as_the_run_that_never_stopped() {
    let piece = piece();
    let (mut whole, held) = never_stopped(&piece);
    assert!(
        held.len() >= 2 && held[0].step < STEPS,
        "the steps ask for saves: {:?}",
        held.iter().map(told).collect::<Vec<_>>()
    );
    let save = &held[0];
    let bytes = save.bytes(1);

    let mut rec = Record::default();
    let (mut opened, via) = open_held(&piece, &name_of(&bytes), &bytes, &[], "", &mut rec)
        .unwrap_or_else(|e| panic!("the held save opens: {e}"));
    assert_eq!(
        (&via["step"], &via["via"]),
        (&json!(save.step), &json!("straight"))
    );
    assert_eq!(
        Value::Object(opened.deep_hashes()),
        Value::Object(save.deep_hash.clone()),
        "it opens at the full-state hashes recorded when it was written"
    );
    opened.run(STEPS, &mut rec, &mut |_, _| {});
    assert_eq!(
        Value::Object(opened.deep_hashes()),
        Value::Object(whole.deep_hashes()),
        "played on, it ends where the run that never stopped ends"
    );
    let after = |saves: &[Held]| -> Vec<(i32, i64, Value)> {
        let later = saves.iter().filter(|s| s.step > save.step);
        later.map(told).collect()
    };
    assert_eq!(
        after(&opened.held.take().expect("its later saves are held too")),
        after(&held),
        "and its later steps ask for the saves that run asked for"
    );
}

#[test]
fn held_bytes_that_fail_their_name_are_damaged_and_a_state_that_does_not_decode_is_refused() {
    let piece = piece();
    let (_, held) = never_stopped(&piece);
    let bytes = held[0].bytes(1);
    let name = name_of(&bytes);
    let refusal = |name: &str, bytes: &[u8]| {
        let mut rec = Record::default();
        open_held(&piece, name, bytes, &[], "", &mut rec)
            .err()
            .expect("the save is refused")
    };

    let mut changed = bytes.clone();
    *changed.last_mut().expect("a byte") ^= 1;
    let damaged = refusal(&name, &changed);
    assert_eq!(
        (&damaged["code"], &damaged["damaged"][0]["hash"]),
        (&json!("save_damaged"), &json!(name)),
        "{damaged}"
    );

    // Whole by its own name, but one byte short of its state.
    let short = &bytes[..bytes.len() - 1];
    let refused = refusal(&name_of(short), short);
    assert_eq!(
        (&refused["code"], &refused["differs"][0]["what"]),
        (&json!("save_refused"), &json!("state")),
        "{refused}"
    );
}
