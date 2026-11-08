//! The placement fields #492 lands that no acceptance criterion reads (Placement; `start_on` and
//! `switch`): each case reads an evaluated item, so a program that ignored the field would show the
//! clip's plain time or the item's authored value.

use deep_canvas_motion::doc::Feel;
use deep_canvas_motion::eval::{frame_with, Validity};
use deep_canvas_motion::input::Entry;
use deep_canvas_motion::program::{Options, Program};
use serde_json::{json, Value};

const S: i64 = 705_600_000;

/// The item `dot`'s x at each time, one state across the frames.
fn xs(doc: &Value, input: Vec<Entry>, times: &[i64]) -> Vec<f64> {
    let doc = doc.as_object().expect("an object");
    let program = Program::compile_with(doc, Options { input, ..Options::default() }).expect("the document reads");
    let mut state = program.state();
    times
        .iter()
        .map(|&t| {
            let f = frame_with(doc, &program, t, Validity::Full, &mut state);
            f.items["dot"]["at"]["pos"][0].as_f64().expect("a number")
        })
        .collect()
}

/// A film with a 1 s ruler clip, x reading clip time × 10, and the given placement on `dot` at x = 500.
fn film(placement: Value, rest: Value) -> Value {
    let mut d = json!({
        "format": 1, "id": "p492", "profile": "film", "size": [100, 100], "layers": {"main": {"order": "a0"}},
        "transport": {"span": "10s"},
        "items": {"dot": {"id": "dot", "kind": "rect@1", "layer": "main", "at": {"pos": [500, 0, 0]}, "params": {"box": [0, 0, 1, 1]}}},
        "clips": {"ruler": {"channels": {"x": {"target": "slot:s/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "1s", "value": 10, "interp": "linear"}}}}}},
        "placements": {"p": placement},
    });
    if let (Some(d), Value::Object(rest)) = (d.as_object_mut(), rest) {
        d.extend(rest);
    }
    d
}

fn base(extra: Value) -> Value {
    let mut p = json!({"clip": "ruler", "slots": {"s": "dot"}});
    if let (Some(p), Value::Object(extra)) = (p.as_object_mut(), extra) {
        p.extend(extra);
    }
    p
}

fn entry(t: i64, seq: i64, value: Value) -> Entry {
    Entry { t, seq, control: "go".into(), value, player: 1 }
}

fn close(got: &[f64], want: &[f64]) {
    assert_eq!(got.len(), want.len());
    for (g, w) in got.iter().zip(want) {
        assert!((g - w).abs() < 1e-9, "{got:?} against {want:?}");
    }
}

const GO: &str = r#"{"go": {"kind": "slider", "range": [0, 9], "default": 0}}"#;

fn controls() -> Value {
    json!({"controls": serde_json::from_str::<Value>(GO).expect("json")})
}

#[test]
fn start_on_restarts_at_each_entry_and_shows_nothing_before_the_first() {
    let doc = film(base(json!({"start_on": {"control": "go", "policy": "restart"}})), controls());
    let track = vec![entry(S, 0, json!(1)), entry(S + S / 2, 1, json!(2))];
    close(&xs(&doc, track, &[S / 2, S + S / 4, S + S / 2 + S / 4, 3 * S]), &[500.0, 2.5, 2.5, 500.0]);
}

#[test]
fn start_on_ignore_keeps_the_running_pass_and_each_change_skips_a_repeat() {
    let ignore = film(base(json!({"start_on": {"control": "go", "policy": "ignore"}})), controls());
    let track = vec![entry(S, 0, json!(1)), entry(S + S / 2, 1, json!(2))];
    close(&xs(&ignore, track, &[S + S * 3 / 4]), &[7.5]);
    let change = film(base(json!({"start_on": {"control": "go", "each": "change", "policy": "restart"}})), controls());
    let same = vec![entry(S, 0, json!(1)), entry(S + S / 2, 1, json!(1))];
    close(&xs(&change, same, &[S + S * 3 / 4]), &[7.5]);
}

#[test]
fn start_on_overlap_runs_each_start_as_a_write_of_its_own() {
    // An add placement, so two runs at once sum: 0.75 s in plus 0.25 s in over the base of 500.
    let doc = film(base(json!({"start_on": {"control": "go", "policy": "overlap"}, "blend": "add"})), controls());
    let track = vec![entry(S, 0, json!(1)), entry(S + S / 2, 1, json!(2))];
    close(&xs(&doc, track, &[S + S * 3 / 4]), &[500.0 + 7.5 + 2.5]);
}

#[test]
fn reverse_on_close_turns_the_stagger_around_for_a_run_a_close_started() {
    let mut doc = film(base(json!({"start_on": {"control": "go", "policy": "restart"}, "stagger": {"lag": "0.5s", "reverse_on_close": true}})), controls());
    doc["placements"]["p"]["slots"]["s"] = json!(["dot", "dash"]);
    doc["items"]["dash"] = json!({"id": "dash", "kind": "rect@1", "layer": "main", "at": {"pos": [500, 0, 0]}, "params": {"box": [0, 0, 1, 1]}});
    // An opening run starts dot at once and dash 0.5 s on; a close starts dash at once.
    let open = vec![entry(S, 0, json!(1))];
    close(&xs(&doc, open, &[S + S / 4]), &[2.5]);
    let shut = vec![entry(S, 0, json!(0))];
    close(&xs(&doc, shut, &[S + S / 4, S + S * 3 / 4]), &[500.0, 2.5]);
}

#[test]
fn a_switch_takes_a_spring_and_waits_for_the_next_pass_when_synced() {
    let keyed = |s: Value| {
        let mut p = base(json!({"start": "0s", "blend": "mix", "repeat": {"count": 9, "mode": "wrap"}}));
        p["switch"] = s;
        film(p, json!({"controls": {"go": {"kind": "choice", "options": ["a", "b"], "default": "a"}}}))
    };
    let sync = keyed(json!({"control": "go", "case": "b", "span": "0.5s", "sync": "next_loop_phase"}));
    let track = vec![entry(S + S / 4, 0, json!("b"))];
    // Asked for at 1.25 s, the fade waits for the pass at 2 s, so nothing has mixed at 1.75 s.
    close(&xs(&sync, track.clone(), &[S + S * 3 / 4]), &[500.0]);
    let spring = keyed(json!({"control": "go", "case": "b", "span": "1s", "spring": {"freq_hz": 4, "damping_ratio": 1}}));
    let got = xs(&spring, track, &[S + S / 4, S + S * 3 / 8, 2 * S + S / 4]);
    assert_eq!(got[0], 500.0, "a spring starts at rest");
    assert!(got[1] < 500.0 && got[1] > 2.5, "under way: {got:?}");
    assert_eq!(got[2], 2.5, "its span's end shows the case alone: {got:?}");
}

#[test]
fn a_document_class_entry_ends_a_running_replay() {
    let doc = film(base(json!({"start": "0s", "repeat": {"count": 9, "mode": "wrap"}})), json!({
        "markers": {"hit": {"kind": "cue", "t": "4s"}},
        "controls": {"go": {"kind": "slider", "class": "document", "range": [0, 9], "default": 0}},
        "time_remaps": {"r": {"target": "p", "map": {"replay": {"on": "markers.cue", "before": "0.5s", "after": "0s", "rate": "1/2"}}}},
    }));
    // Inside the replay at 4.25 s child time is 3.625 s; the entry there ends it, so 4.5 s reads itself.
    close(&xs(&doc, vec![], &[4 * S + S / 2]), &[7.5]);
    close(&xs(&doc, vec![entry(4 * S + S / 4, 0, json!(1))], &[4 * S + S / 2]), &[5.0]);
}

#[test]
fn a_quat_on_a_transforms_euler_rot_is_refused() {
    let doc = film(base(json!({"start": "0s"})), json!({"channels": {"q": {"target": "items/dot/at/rot", "type": "quat", "keys": {
        "a": {"t": "0s", "value": [0, 0, 0, 1]}}}}}));
    let refused = Program::compile(doc.as_object().expect("an object")).expect_err("refused");
    assert_eq!(refused.code, "bad_type");
}

#[test]
fn fade_out_and_multiply_and_add_from_weigh_as_placement_says() {
    let fade = film(base(json!({"start": "0s", "fade_out": "0.5s"})), json!({}));
    // 0.75 s in: 7.5 over 500 at a quarter of the fade left.
    close(&xs(&fade, vec![], &[S * 3 / 4]), &[500.0 + 0.5 * (7.5 - 500.0)]);
    let times = film(base(json!({"start": "0s", "blend": "multiply"})), json!({}));
    close(&xs(&times, vec![], &[S / 2]), &[2500.0]);
    let bind = film(base(json!({"start": "0s", "blend": "add", "add_from": "bind"})), json!({}));
    close(&xs(&bind, vec![], &[S / 2]), &[5.0]);
    let at = film(base(json!({"start": "0s", "blend": "add", "add_from": {"t": "0.5s"}})), json!({}));
    close(&xs(&at, vec![], &[S * 3 / 4]), &[502.5]);
}

#[test]
fn a_scrub_shows_the_controls_value_and_a_document_replay_moves_every_read() {
    let scrub = film(base(json!({"start": "0s"})), json!({
        "controls": {"go": {"kind": "slider", "range": [0, 1], "default": 0.25}},
        "time_remaps": {"s": {"target": "p", "map": {"scrub": {"control": "go"}}}},
    }));
    close(&xs(&scrub, vec![entry(S / 2, 0, json!(0.75))], &[0, S / 2]), &[2.5, 7.5]);
    let replay = film(base(json!({"start": "0s", "repeat": {"count": 9, "mode": "wrap"}})), json!({
        "markers": {"hit": {"kind": "cue", "t": "4s"}},
        "time_remaps": {"r": {"target": "document", "map": {"replay": {"on": "markers.cue", "before": "0.5s", "after": "0s", "rate": "1/2"}}}},
    }));
    // At 4.5 s the document shows child time 3.75 s; the clip's 0.75 s reads 7.5.
    close(&xs(&replay, vec![], &[4 * S + S / 2]), &[7.5]);
}

#[test]
fn a_slowed_placement_moves_at_every_flick() {
    let doc = film(base(json!({"start": "0s", "rate": "1/2"})), json!({}));
    let map = doc.as_object().expect("an object");
    let program = Program::compile(map).expect("the document reads");
    let mut state = program.state();
    program.evaluate(S / 2, Validity::Full, &mut state);
    assert_eq!(state.valid_until, Some(S / 2 + 1));
}

#[test]
fn under_the_looks_steps_a_held_key_stays_valid_only_to_the_step_that_shows_it() {
    let doc = film(base(json!({"start": "20s"})), json!({"channels": {"c": {"target": "items/dot/at/pos/1", "type": "f32", "keys": {
        "a": {"t": "0s", "value": 0, "interp": "hold"}, "b": {"t": "0.1s", "value": 1, "interp": "hold"}}}}}));
    let map = doc.as_object().expect("an object");
    let feel = Feel { quantize: Some((12, 1)), ..Feel::default() };
    let program = Program::compile(map).expect("the document reads").with_inputs(feel, &[]).expect("no track");
    let mut state = program.state();
    // At 0.1 s the key has passed, but the look still shows 1/12 s: it shows the key at 1/6 s.
    program.evaluate(S / 10, Validity::Full, &mut state);
    assert_eq!(state.slots[1], 0.0);
    assert_eq!(state.valid_until, Some(S / 6));
}
