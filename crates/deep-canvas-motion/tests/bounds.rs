//! Issue #490: a hard range checks every driver against its bound, and a channel's bound holds
//! every value its keys and modifiers give, or is left unsettled.

use deep_canvas_motion::program::{channel_bound, Program};
use serde_json::{json, Map, Value};

fn doc(extra: Value) -> Map<String, Value> {
    let mut d = json!({
        "transport": {"span": "1s"},
        "items": {"a": {"id": "a", "kind": "rect@1", "params": {"box": [0, 0, 4, 4]}, "at": {"pos": [0, 0, 0]}}},
    });
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    let Value::Object(d) = d else { unreachable!() };
    d
}

#[test]
fn a_driver_of_the_six_functions_is_held_to_its_range() {
    let d = doc(json!({
        "channels": {"x": {"target": "items/a/at/pos/1", "keys": {"k0": {"t": "0s", "value": 0}, "k1": {"t": "1s", "value": 1}}}},
        "drivers": {"d": {"target": "items/a/at/pos/0", "expr": "x * 1000", "vars": {"x": "items/a/at/pos/1"}, "range": [0, 1]}},
    }));
    let r = Program::compile(&d).expect_err("x * 1000 reaches 1000, outside [0, 1]");
    assert_eq!(r.code, "out_of_range");
    assert!(r.path.contains("drivers/d"), "{}", r.path);
}

#[test]
fn a_catmull_rom_channel_has_no_settled_bound() {
    let keys = json!({"k0": {"t": "0s", "value": 0, "interp": "catmull_rom"}, "k1": {"t": "0.3s", "value": 1, "interp": "catmull_rom"},
                      "k2": {"t": "0.6s", "value": 1, "interp": "catmull_rom"}, "k3": {"t": "1s", "value": 0}});
    let p = Program::compile(&doc(
        json!({"channels": {"c": {"target": "items/a/at/pos/0", "keys": keys}}}),
    ))
    .unwrap();
    assert_eq!(channel_bound(&p.motion.channels[0]), None);
}

#[test]
fn a_pulse_with_a_negative_influence_reaches_below() {
    let c = json!({"c": {"target": "items/a/at/pos/0", "keys": {"k0": {"t": "0s", "value": 0, "interp": "hold"}},
        "modifiers": [{"pulse": {"at": "0s", "span": "1s", "amount": 10, "shape": "there_and_back"}, "influence": -1}]}});
    let p = Program::compile(&doc(json!({"channels": c}))).unwrap();
    let (lo, hi) = channel_bound(&p.motion.channels[0]).unwrap();
    assert!(lo <= -10.0 && hi >= 0.0, "[{lo}, {hi}]");
}

#[test]
fn time_past_the_span_reads_the_span() {
    let d = doc(
        json!({"drivers": {"d": {"target": "items/a/at/pos/0", "expr": "t * 10", "vars": {"t": "time"}, "range": [0, 10]}}}),
    );
    let p = Program::compile(&d).unwrap();
    let mut s = p.state();
    p.evaluate(
        2 * 705_600_000,
        deep_canvas_motion::eval::Validity::Full,
        &mut s,
    );
    let (pos, _) = p.item_values(&s, "a").unwrap();
    assert_eq!(pos[0], 10.0);
}

#[test]
fn limits_written_max_below_min_are_refused() {
    let c = json!({"c": {"target": "items/a/at/pos/0", "keys": {"k0": {"t": "0s", "value": 0, "interp": "hold"}},
        "modifiers": [{"limits": {"min": 1, "max": 0}}]}});
    let r = Program::compile(&doc(json!({"channels": c}))).expect_err("min 1 is above max 0");
    assert_eq!(r.code, "out_of_range");
    assert_eq!(r.path, "channels/c/modifiers/0/limits/min");
}

#[test]
fn a_control_range_written_high_to_low_is_refused() {
    let d = doc(json!({
        "controls": {"k": {"kind": "slider", "class": "document", "label": "K", "range": [10, 0], "default": 0}},
        "drivers": {"d": {"target": "items/a/at/pos/0", "expr": "k", "vars": {"k": "controls/k/value"}}},
    }));
    let r = Program::compile(&d).expect_err("range [10, 0] has its low end above its high end");
    assert_eq!(r.code, "out_of_range");
    assert_eq!(r.path, "controls/k/range");
}
