//! A bool channel (#373: an item's `adjust.invert` is a bool channel; Channel and key: "enum, bool
//! and string: hold only"): it writes `true` or `false` into its field, holding each key until
//! the next, and refuses a key that would mix.

use deep_canvas_motion::eval::{frame, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

const S: i64 = 705_600_000;

fn doc(interp: Option<&str>) -> Value {
    let mut on = json!({"t": "1s", "value": true});
    if let Some(i) = interp {
        on["interp"] = json!(i);
    }
    json!({"format": 1, "id": "invert", "size": [100, 100], "layers": {"main": {"order": "a0"}},
        "items": {"swatch": {"id": "swatch", "kind": "rect@1", "layer": "main", "adjust": {"invert": false},
            "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}}},
        "channels": {"flip": {"target": "items/swatch/adjust/invert", "type": "bool", "keys": {
            "off": {"t": "0s", "value": false}, "on": on}}}})
}

fn invert_at(d: &Value, t: i64) -> Value {
    let program = Program::compile(d).expect("the document reads");
    let f = frame(
        d.as_object().expect("an object"),
        &program,
        t,
        Validity::Full,
    );
    f.items["swatch"]["adjust"]["invert"].clone()
}

#[test]
fn a_bool_channel_holds_each_key_and_writes_a_bool() {
    let d = doc(None);
    assert_eq!(invert_at(&d, 0), json!(false));
    assert_eq!(invert_at(&d, S - 1), json!(false), "held, never mixed");
    assert_eq!(invert_at(&d, S), json!(true));
    assert_eq!(invert_at(&d, 2 * S), json!(true));
}

#[test]
fn a_bool_key_that_would_mix_is_refused() {
    let r = Program::compile(&doc(Some("linear"))).expect_err("a bool channel holds only");
    assert_eq!(
        (r.code, r.path.as_str()),
        ("bad_interp", "channels/flip/keys/on/interp")
    );
}
