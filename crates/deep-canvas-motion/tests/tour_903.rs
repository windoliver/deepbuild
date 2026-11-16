//! Issue #903: a tour's linear key on a played form's track. Its entry carries the two ends of its
//! segment, and a driver that reads the control moves with it, so a frame draws a slider's thumb
//! where the tour's pointer rides it.

use deep_canvas::interval::Iv;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const S: i64 = 705_600_000;

fn board(track: Value) -> Map<String, Value> {
    let Value::Object(doc) = json!({
        "transport": {"span": "10s"},
        "items": {"knob": {"id": "knob", "kind": "mark.box@1", "params": {"size": 1}, "at": {"pos": [0, 0, 0]}}},
        "controls": {"gain": {"kind": "slider", "class": "document", "range": [0, 1], "default": 0.5}},
        "drivers": {"x": {"target": "items/knob/at/pos/0", "expr": "100 * v", "vars": {"v": "controls/gain/value"}}},
        "track": track,
    }) else {
        unreachable!()
    };
    doc
}

#[test]
fn a_tours_linear_key_moves_its_control_from_its_entry_to_its_segments_end() {
    let samples = json!([{"t": 4 * S, "value": 0}, {"t": 6 * S, "value": 1.0}]);
    let ramp = json!({"t": 4 * S, "seq": 0, "control": "gain", "value": 0, "samples": samples, "writer": "tour"});
    let held = json!({"t": 6 * S, "seq": 0, "control": "gain", "value": 1, "writer": "tour"});
    let p = Program::compile(&board(json!([ramp, held]))).expect("compiles");
    let slot = p
        .slot_of("knob", &["at".into(), "pos".into(), "0".into()])
        .expect("the driver's slot");
    let frame = |t: i64| {
        let mut s = p.state();
        p.evaluate(t, Validity::Full, &mut s);
        (s.slots[slot], s.valid_until)
    };
    // Its default until the key, then half way and still moving.
    assert_eq!(frame(2 * S), (50.0, Some(4 * S)));
    assert_eq!(frame(4 * S).0, 0.0);
    assert_eq!(frame(5 * S), (50.0, Some(5 * S + 1)));
    assert_eq!(frame(11 * S / 2).0, 75.0);
    assert_eq!(frame(7 * S), (100.0, None), "at rest once the value stops");
    let riding = p.slot_bound_over(slot, Iv::new(4.5, 5.5)).expect("a bound");
    assert!(riding.lo <= 25.0 && riding.hi >= 75.0, "{riding:?}");

    // Your own drag keeps its polyline as a record: its entry's value holds from its flick.
    let yours = json!({"t": 4 * S, "seq": 0, "control": "gain", "value": 1, "samples": samples, "writer": "you"});
    let p = Program::compile(&board(json!([yours]))).expect("compiles");
    let mut s = p.state();
    p.evaluate(5 * S, Validity::Full, &mut s);
    assert_eq!((s.slots[slot], s.valid_until), (100.0, None));
}
