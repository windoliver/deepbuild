//! #491 review regressions: an occurrence list that names nothing, and a layout glide no layout
//! reads, are refused rather than read as empty or held; a glide with no keys doesn't panic.

use deep_canvas_motion::program::{Boxes, Layout, Options, Program};
use serde_json::{json, Value};

fn rect(id: &str) -> Value {
    json!({"id": id, "kind": "rect@1", "name": id, "order": "b", "parent": "box", "params": {"box": [0, 0, 40, 30], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}})
}

fn doc(rest: Value) -> Value {
    let mut d = json!({
        "format": 1, "id": "g", "profile": "film", "size": [640, 360], "transport": {"span": "4s"},
        "items": {
            "box": {"id": "box", "kind": "frame@1", "name": "Box", "order": "a", "params": {"box": [20, 10, 300, 200], "layout": "row", "gap": 10, "grid": {"cols": [40, 40]}}, "at": {"pos": [0, 0, 0]}},
            "t0": rect("t0"),
        },
        "controls": {"knob": {"kind": "slider", "class": "document", "label": "K", "range": [0, 1], "default": 0}},
    });
    if let (Some(d), Value::Object(rest)) = (d.as_object_mut(), rest) {
        d.extend(rest);
    }
    d
}

fn compile(d: &Value, layout: Option<Layout>) -> Result<Program, String> {
    let options = Options {
        layout,
        ..Options::default()
    };
    Program::compile_with(d.as_object().unwrap(), options).map_err(|r| r.code.to_string())
}

fn solve(_: &Value) -> Result<Boxes, (String, String)> {
    Ok(Boxes::from([("t0".to_string(), [0.0; 4])]))
}

#[test]
fn a_list_of_no_marker_kind_or_control_is_refused() {
    let counting = |list: &str| {
        doc(
            json!({"drivers": {"g": {"target": "items/t0/at/pos/1", "expr": "count(k)", "vars": {"k": {"list": list}}, "fallback": 0}}}),
        )
    };
    assert_eq!(compile(&counting("markers.beat"), None).map(|_| ()), Ok(()));
    assert_eq!(compile(&counting("input.knob"), None).map(|_| ()), Ok(()));
    for list in ["markers.kick", "input.nosuch"] {
        assert_eq!(
            compile(&counting(list), None).map(|_| ()),
            Err("ref_unresolved".into()),
            "{list}"
        );
    }
}

#[test]
fn a_glide_no_layout_reads_is_refused() {
    let glide = |target: &str| {
        doc(
            json!({"channels": {"lay": {"target": target, "type": "enum", "keys": {"r": {"t": "0s", "value": "row", "interp": "linear"}, "g": {"t": "1s", "value": "grid"}}}}}),
        )
    };
    let on_frame = glide("items/box/params/layout");
    assert_eq!(compile(&on_frame, Some(Layout(solve))).map(|_| ()), Ok(()));
    // A host without a layout solve would hold the layout and drop the glide.
    assert_eq!(
        compile(&on_frame, None).map(|_| ()),
        Err("layout_refused".into())
    );
    // A rect isn't laid out, so a glide on its layout moves nothing.
    assert_eq!(
        compile(&glide("items/t0/params/layout"), Some(Layout(solve))).map(|_| ()),
        Err("layout_refused".into())
    );
}

#[test]
fn a_glide_with_no_keys_lays_out_still() {
    let d = doc(
        json!({"channels": {"lay": {"target": "items/box/params/layout", "type": "enum", "keys": {}}}}),
    );
    let program = compile(&d, Some(Layout(solve))).expect("a channel with no keys reads");
    assert_eq!(
        program.boxes(0),
        Some(Boxes::from([("t0".to_string(), [0.0; 4])]))
    );
}
