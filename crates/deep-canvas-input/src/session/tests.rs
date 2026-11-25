use super::*;

#[test]
fn a_range_written_high_to_low_is_refused() {
    let doc = json!({"controls": {"gain": {"kind": "slider", "range": [1, 0]}}});
    let key = json!({"op": "key", "control": "gain", "key": "ArrowRight", "t": 0});
    let refusal = Session::new(
        &doc,
        [640.0, 360.0],
        (60, 1),
        false,
        Planted::default(),
        &[],
    )
    .and_then(|mut s| s.op(key.as_object().expect("an op")))
    .err();
    assert_eq!(
        refusal,
        Some(refused("out_of_range", "controls/gain/range"))
    );
}

#[test]
fn holders_names_the_controls_a_key_reaches_and_no_other() {
    let doc = json!({"controls": {
        "speed": {"kind": "slider"},
        "sound": {"kind": "toggle", "keys": {"m": "toggle"}},
        "go": {"kind": "press"},
    }});
    let s = Session::new(
        &doc,
        [640.0, 360.0],
        (60, 1),
        false,
        Planted::default(),
        &[],
    )
    .unwrap();
    assert_eq!(s.holders("m", &[]), ["sound"]);
    assert_eq!(s.holders("ArrowRight", &["alt"]), ["speed"]);
    assert_eq!(s.holders(" ", &[]), ["sound", "go"]);
    assert_eq!(s.holders("j", &[]), [] as [&str; 0]);
}
