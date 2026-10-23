//! The rest of the line's slice of motion (#391 Scope): child-of parenting, markers, placements in
//! series and staggered across targets. Each case reads an evaluated item, so a program that
//! ignored the field would show the item where it sits unparented, unstaggered or at time 0.

use deep_canvas_motion::doc::read;
use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const S: i64 = 705_600_000;

fn x_at(doc: &Value, item: &str, t: i64) -> f64 {
    let program = Program::compile(doc.as_object().unwrap()).expect("the document reads");
    let doc = doc.as_object().expect("an object");
    let f = frame(doc, &program, t, Validity::Full);
    f.items[item]["at"]["pos"][0].as_f64().expect("a number")
}

fn y_at(doc: &Value, item: &str, t: i64) -> f64 {
    let program = Program::compile(doc.as_object().unwrap()).expect("the document reads");
    let f = frame(
        doc.as_object().expect("an object"),
        &program,
        t,
        Validity::Full,
    );
    f.items[item]["at"]["pos"][1].as_f64().expect("a number")
}

fn dot(id: &str, extra: Value) -> (String, Value) {
    let mut item = json!({"id": id, "kind": "circle@1", "layer": "main", "params": {"center": [0, 0], "r": 4}});
    if let (Some(item), Value::Object(extra)) = (item.as_object_mut(), extra) {
        item.extend(extra);
    }
    (id.to_string(), item)
}

fn doc(items: Vec<(String, Value)>, rest: Value) -> Value {
    let mut d = json!({"format": 1, "id": "scope", "size": [100, 100], "layers": {"main": {"order": "a0"}}});
    d["items"] = Value::Object(items.into_iter().collect::<Map<_, _>>());
    if let (Some(d), Value::Object(rest)) = (d.as_object_mut(), rest) {
        d.extend(rest);
    }
    d
}

fn slide() -> Value {
    json!({"slots": {"target": {"type": "circle@1", "required": true}}, "span": "auto", "channels": {
        "x": {"target": "slot:target/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "1s", "value": 100, "interp": "linear"}}}}})
}

#[test]
fn a_child_rides_its_parent_turned_and_moved_by_it() {
    let d = doc(
        vec![
            dot(
                "arm",
                json!({"at": {"pos": [100, 0, 0], "rot": [0, 0, 90]}}),
            ),
            dot("hand", json!({"parent": "arm", "at": {"pos": [10, 0, 0]}})),
        ],
        json!({}),
    );
    assert!(
        (x_at(&d, "hand", 0) - 100.0).abs() < 1e-12,
        "turned 90°, the hand's x is the arm's"
    );
    assert!(
        (y_at(&d, "hand", 0) - 10.0).abs() < 1e-12,
        "and its offset turns onto y"
    );
}

#[test]
fn a_child_follows_its_parent_s_channel() {
    let d = doc(
        vec![
            dot("arm", json!({})),
            dot("hand", json!({"parent": "arm", "at": {"pos": [5, 0, 0]}})),
        ],
        json!({"channels": {"x": {"target": "items/arm/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "2s", "value": 40, "interp": "linear"}}}}}),
    );
    assert_eq!(x_at(&d, "hand", S), 25.0);
}

#[test]
fn a_parent_cycle_is_refused_naming_an_item() {
    let d = doc(
        vec![
            dot("a", json!({"parent": "b"})),
            dot("b", json!({"parent": "a"})),
        ],
        json!({}),
    );
    let refused = read(d.as_object().unwrap()).expect_err("a cycle never resolves");
    assert_eq!(refused.code, "parent_cycle");
    assert!(refused.path.starts_with("items/"), "{}", refused.path);
}

#[test]
fn a_key_written_relative_to_a_marker_keeps_its_offset_when_the_marker_moves() {
    let at = |cue: &str| {
        doc(
            vec![dot("d", json!({}))],
            json!({
                "markers": {"intro": {"t": cue, "kind": "section"}, "beat": {"t": "@intro+1s", "kind": "cue"}},
                "channels": {"x": {"target": "items/d/at/pos/0", "type": "f32", "keys": {
                    "a": {"t": "@beat", "value": 0, "interp": "linear"}, "b": {"t": "@beat+1s", "value": 10, "interp": "linear"}}}},
            }),
        )
    };
    // intro at 1 s puts beat at 2 s; the ramp runs 2 s → 3 s.
    assert_eq!(x_at(&at("1s"), "d", 2 * S + S / 2), 5.0);
    // Moving intro to 2 s moves beat, and the ramp with it.
    assert_eq!(x_at(&at("2s"), "d", 2 * S + S / 2), 0.0);
    assert_eq!(x_at(&at("2s"), "d", 3 * S + S / 2), 5.0);
}

#[test]
fn markers_that_name_each_other_are_refused() {
    let d = doc(
        vec![dot("d", json!({}))],
        json!({"markers": {"a": {"t": "@b"}, "b": {"t": "@a"}}}),
    );
    assert_eq!(
        read(d.as_object().unwrap())
            .expect_err("never resolves")
            .code,
        "time_unresolved"
    );
}

#[test]
fn a_placement_after_another_starts_at_its_end_plus_its_offset() {
    let d = doc(
        vec![dot("p", json!({})), dot("q", json!({}))],
        json!({"clips": {"slide": slide()}, "placements": {
            "first": {"clip": "slide", "slots": {"target": "p"}, "start": "1s", "repeat": {"count": 2}},
            "then": {"clip": "slide", "slots": {"target": "q"}, "after": "first", "offset": "0.5s"}}}),
    );
    // first runs 1 s → 3 s, so then starts at 3.5 s and is halfway at 4 s.
    assert_eq!(x_at(&d, "q", 3 * S + S / 2 - 1), 0.0);
    assert_eq!(x_at(&d, "q", 4 * S), 50.0);
}

#[test]
fn a_series_that_loops_back_on_itself_is_refused() {
    let d = doc(
        vec![dot("p", json!({}))],
        json!({"clips": {"slide": slide()}, "placements": {
            "a": {"clip": "slide", "slots": {"target": "p"}, "after": "b"},
            "b": {"clip": "slide", "slots": {"target": "p"}, "after": "a"}}}),
    );
    assert_eq!(
        read(d.as_object().unwrap())
            .expect_err("never resolves")
            .code,
        "placement_cycle"
    );
}

#[test]
fn a_stagger_starts_each_target_a_lag_later_in_its_order() {
    let staggered = |order: &str| {
        doc(
            vec![
                dot("a", json!({})),
                dot("b", json!({})),
                dot("c", json!({})),
            ],
            json!({"clips": {"slide": slide()}, "placements": {"p": {
                "clip": "slide", "slots": {"target": ["a", "b", "c"]}, "start": "0s",
                "stagger": {"lag": 0.5, "order": order}, "extend": {"after": "hold"}}}}),
        )
    };
    // Lag 0.5 of the 1 s span: a starts at 0, b at 0.5 s, c at 1 s.
    let d = staggered("index");
    let xs: Vec<f64> = ["a", "b", "c"].iter().map(|i| x_at(&d, i, S)).collect();
    assert_eq!(xs, vec![100.0, 50.0, 0.0]);
    let d = staggered("reverse");
    let xs: Vec<f64> = ["a", "b", "c"].iter().map(|i| x_at(&d, i, S)).collect();
    assert_eq!(xs, vec![0.0, 50.0, 100.0]);
}

fn seeded(seed: u64) -> Value {
    let ids = ["a", "b", "c", "d", "e", "f"];
    let mut d = doc(
        ids.iter().map(|i| dot(i, json!({}))).collect(),
        json!({"clips": {"slide": slide()}, "placements": {"p": {
            "clip": "slide", "slots": {"target": ids}, "start": "0s",
            "stagger": {"lag": "0.1s", "order": "seeded"}}}}),
    );
    d["seed"] = json!(seed);
    d
}

/// Each target's start, read back from where it is 0.9 s in, while every one still moves:
/// x = 100 × (0.9 s − delay) ÷ 1 s.
fn delays(d: &Value) -> Vec<i64> {
    let t = S / 10 * 9;
    ["a", "b", "c", "d", "e", "f"]
        .iter()
        .map(|i| t - (x_at(d, i, t) / 100.0 * S as f64).round() as i64)
        .collect()
}

#[test]
fn a_seeded_stagger_is_a_permutation_fixed_by_the_document_seed() {
    let one = delays(&seeded(7));
    let mut sorted = one.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        (0..6).map(|i| i * S / 10).collect::<Vec<_>>(),
        "every rank once"
    );
    assert_eq!(
        one,
        delays(&seeded(7)),
        "the same seed gives the same order"
    );
    assert_ne!(
        one, sorted,
        "seed 7 doesn't leave the targets in index order"
    );
    assert_ne!(one, delays(&seeded(8)), "another seed gives another order");
}

#[test]
fn a_cut_switches_placements_with_no_hold_across_it() {
    let d = doc(
        vec![dot("p", json!({}))],
        json!({"clips": {"slide": slide(), "back": {"slots": {"target": {"type": "circle@1", "required": true}}, "span": "auto",
            "channels": {"x": {"target": "slot:target/at/pos/0", "type": "f32", "keys": {
                "a": {"t": "0s", "value": 500, "interp": "linear"}, "b": {"t": "1s", "value": 600, "interp": "linear"}}}}}},
            "placements": {
                "one": {"clip": "slide", "slots": {"target": "p"}, "start": "0s", "extend": {"after": "hold"}},
                "two": {"clip": "back", "slots": {"target": "p"}, "start": "1s", "extend": {"before": "hold"}}},
            "transitions": {"cut": {"from": "one", "to": "two", "kind": "cut"}}}),
    );
    // Before the cut the outgoing clip shows, not the incoming one's held start pose.
    assert_eq!(x_at(&d, "p", S / 2), 50.0);
    // At the cut the incoming clip starts at once.
    assert_eq!(x_at(&d, "p", S), 500.0);
    // The frame before the cut knows the cut is coming.
    let program = Program::compile(d.as_object().unwrap()).unwrap();
    let f = frame(d.as_object().unwrap(), &program, S - 1, Validity::Full);
    assert!(f.valid_until.is_some_and(|v| v <= S));
    assert_eq!(program.motion.cuts[0].at, S);
}

#[test]
fn a_cut_between_placements_that_do_not_meet_is_refused() {
    let d = doc(
        vec![dot("p", json!({}))],
        json!({"clips": {"slide": slide()}, "placements": {
            "one": {"clip": "slide", "slots": {"target": "p"}, "start": "0s"},
            "two": {"clip": "slide", "slots": {"target": "p"}, "start": "2s"}},
            "transitions": {"t": {"from": "one", "to": "two", "kind": "cut"}}}),
    );
    assert_eq!(
        read(d.as_object().unwrap()).expect_err("a gap").code,
        "transition_gap"
    );
    let mut d = d;
    d["placements"]["two"]["start"] = json!("1s");
    d["transitions"]["t"]["kind"] = json!("cross_fade");
    assert_eq!(
        read(d.as_object().unwrap()).expect_err("R6").code,
        "transition_kind"
    );
}
