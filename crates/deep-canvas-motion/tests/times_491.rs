//! #491 review regressions: an occurrence read keeps the driver's clock, time from the
//! transport's start held to its span, so its bound holds what it writes; and a literal time in
//! a film with a tempo map raises its notice wherever a time is written, not only on markers
//! and keys.

use deep_canvas_motion::doc::read;
use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const S: i64 = 705_600_000;

fn dot(id: &str) -> Value {
    json!({"id": id, "kind": "circle@1", "layer": "main", "params": {"center": [0, 0], "r": 4}})
}

fn doc(rest: Value) -> Value {
    let mut d = json!({"format": 1, "id": "times", "size": [100, 100], "layers": {"main": {"order": "a0"}},
        "items": {"a": dot("a"), "b": dot("b")}});
    if let (Some(d), Value::Object(rest)) = (d.as_object_mut(), rest) {
        d.extend(rest);
    }
    d
}

/// A transport from 5 s for 6 s, a cue marker at `kick`, and `expr` driving a's x.
fn driven(kick: &str, expr: &str, range: Option<[f64; 2]>) -> Value {
    let mut driver = json!({"target": "items/a/at/pos/0", "expr": expr, "vars": {"k": {"list": "markers.cue"}, "t": "time"}, "fallback": 0});
    if let Some(r) = range {
        driver["range"] = json!(r);
    }
    doc(
        json!({"transport": {"start": "5s", "span": "6s"}, "markers": {"kick": {"kind": "cue", "t": kick}}, "drivers": {"g": driver}}),
    )
}

fn x_at(d: &Value, t: i64) -> (i64, f64) {
    let program = Program::compile(d.as_object().unwrap()).expect("the document reads");
    let f = frame(d.as_object().unwrap(), &program, t, Validity::Full);
    (
        f.doc_t,
        f.items["a"]["at"]["pos"][0].as_f64().expect("a number"),
    )
}

#[test]
fn a_since_past_its_range_from_before_the_start_is_refused() {
    // A kick at 0 s, before the 5 s start: since reads up to 11 s by the transport's end.
    let d = driven("0s", "since(k)", Some([0.0, 6.0]));
    let r = Program::compile(d.as_object().unwrap())
        .map(|_| ())
        .unwrap_err();
    assert_eq!(r.code, "out_of_range");
    // Inside the transport it is within its range, and accepted.
    assert!(Program::compile(
        driven("7s", "since(k)", Some([0.0, 6.0]))
            .as_object()
            .unwrap()
    )
    .is_ok());
}

#[test]
fn last_and_next_read_on_the_drivers_clock() {
    // The kick at 7 s is 2 s into a transport that starts at 5 s, as `time` reads it: at 8 s,
    // 3 s in, last reads 2; at 6 s, 1 s in, next reads 2.
    for expr in ["last(k)", "t - since(k)"] {
        let (doc_t, x) = x_at(&driven("7s", expr, None), 8 * S);
        assert_eq!((doc_t, x), (8 * S, 2.0), "{expr}");
    }
    let (_, x) = x_at(&driven("7s", "next(k)", None), 6 * S);
    assert_eq!(x, 2.0);
}

#[test]
fn a_literal_placement_start_or_pulse_with_a_tempo_map_raises_its_notice() {
    let slide = json!({"slots": {"target": {"type": "circle@1", "required": true}}, "span": "auto", "channels": {
        "x": {"target": "slot:target/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "1s", "value": 100, "interp": "linear"}}}}});
    let d = doc(json!({
        "tempo_map": {"segments": [{"at": "0s", "bpm": 120, "meter": [4, 4], "span": 16}]},
        "clips": {"slide": slide},
        "placements": {"p": {"clip": "slide", "slots": {"target": "a"}, "start": "1.5s"}},
        "channels": {"c": {"target": "items/b/at/pos/0", "keys": {"k0": {"t": "1:1b", "value": 0, "interp": "hold"}},
            "modifiers": [{"pulse": {"at": "2.2s", "span": "1s", "amount": 10, "shape": "there_and_back"}}]}},
    }));
    let m = read(d.as_object().unwrap()).expect("the document reads");
    let notices: Map<String, Value> = m
        .notices
        .iter()
        .filter(|n| n["code"] == "literal_time_with_tempo_map")
        .map(|n| {
            (
                n["path"].as_str().unwrap_or_default().to_string(),
                n.clone(),
            )
        })
        .collect();
    // 1.5 s is the 120 BPM 1:4b; 2.2 s is on no beat, after 2:1b.
    let offered = |path: &str, k: &str| notices.get(path).map(|n| n[k].clone());
    assert_eq!(
        (
            offered("placements/p/start", "fix"),
            offered("channels/c/modifiers/0/pulse/at", "nearest")
        ),
        (Some(json!(["1:4b"])), Some(json!("2:1b")))
    );
}
