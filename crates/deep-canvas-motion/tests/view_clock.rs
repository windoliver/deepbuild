//! #1487: an item out of view stops the clock only when nothing in view can change by it. An item
//! a channel moves, an off-view parent whose turn swings a child in, and an off-view item an
//! in-view driver reads keep the clock armed, or the frames it skips would show the view
//! something other than the document at `t`.

use deep_canvas_motion::clock::{meets, run, Mode, View};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

const S: i64 = 705_600_000;
const VSYNC: i64 = S / 60;

/// The vsyncs at which an armed run over `rect` presents, from 0 to 1 s.
fn presented(doc: Value, rect: [f64; 4]) -> Vec<i64> {
    presented_with(doc, rect, json!({}))
}

fn presented_with(mut doc: Value, rect: [f64; 4], drivers: Value) -> Vec<i64> {
    doc["drivers"] = drivers;
    let doc: Map<String, Value> = doc.as_object().expect("an object").clone();
    let program = Program::compile(&doc).expect("the document reads");
    let view = View {
        rect,
        pans: &[],
        meets,
        stale_return: false,
    };
    let mut out = Vec::new();
    run(
        &doc,
        &program,
        S,
        VSYNC,
        Mode::Armed,
        Validity::Full,
        Some(&view),
        |v| {
            if v.presented {
                out.push(v.t);
            }
        },
    );
    out
}

fn board(items: Value, channels: Value) -> Value {
    json!({"format": 1, "id": "view-clock", "size": [2000, 1000],
           "layers": {"main": {"order": "a0"}}, "items": items, "channels": channels})
}

fn rect(id: &str, extra: Value) -> Value {
    let mut item = json!({"id": id, "kind": "rect@1", "layer": "main",
                          "params": {"box": [-10, -10, 20, 20]}});
    if let (Some(item), Value::Object(extra)) = (item.as_object_mut(), extra) {
        item.extend(extra);
    }
    item
}

#[test]
fn an_item_sliding_in_from_out_of_view_keeps_the_clock_armed() {
    // The slider starts 1,000 u right of the view and crosses into it within the second.
    let doc = board(
        json!({"slider": rect("slider", json!({"at": {"pos": [1500, 100, 0]}}))}),
        json!({"slide": {"target": "items/slider/at/pos/0", "type": "f32",
                         "keys": {"k0": {"t": "0s", "value": 1500, "interp": "linear"},
                                  "k1": {"t": "1s", "value": 100, "interp": "linear"}}}}),
    );
    let shown = presented(doc, [0.0, 0.0, 500.0, 500.0]);
    assert_eq!(
        shown.len(),
        61,
        "a frame at every vsync while it slides: {shown:?}"
    );
}

#[test]
fn an_off_view_parent_that_swings_a_child_in_view_keeps_the_clock_armed() {
    // The hub sits outside the view and turns; its child, 600 u along its arm and out of view
    // too at first, swings into the view's corner within the second.
    let doc = board(
        json!({
            "hub": rect("hub", json!({"at": {"pos": [800, 700, 0]}})),
            "tip": rect("tip", json!({"parent": "hub", "at": {"pos": [-600, 0, 0]}})),
        }),
        json!({"turn": {"target": "items/hub/at/rot/2", "type": "f32",
                        "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"},
                                 "k1": {"t": "1s", "value": 60, "interp": "linear"}}}}),
    );
    let shown = presented(doc, [0.0, 0.0, 500.0, 500.0]);
    assert_eq!(
        shown.len(),
        61,
        "a frame at every vsync while the child swings: {shown:?}"
    );
}

#[test]
fn an_off_view_item_an_in_view_driver_reads_keeps_the_clock_armed() {
    // The dial is in view and turns by a driver reading the off-view spinner's turn.
    let doc = board(
        json!({
            "spinner": rect("spinner", json!({"at": {"pos": [1500, 100, 0]}})),
            "dial": rect("dial", json!({"at": {"pos": [100, 100, 0]}})),
        }),
        json!({"spin": {"target": "items/spinner/at/rot/2", "type": "f32",
                        "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"},
                                 "k1": {"t": "1s", "value": 360, "interp": "linear"}}}}),
    );
    let drivers = json!({"follow": {"target": "items/dial/at/rot/2", "expr": "r * 0.5",
                                    "vars": {"r": "items/spinner/at/rot/2"}}});
    let shown = presented_with(doc, [0.0, 0.0, 500.0, 500.0], drivers);
    assert_eq!(
        shown.len(),
        61,
        "a frame at every vsync while the dial follows: {shown:?}"
    );
}

#[test]
fn a_turning_item_out_of_view_stops_the_clock() {
    // The twin of the two above: a turn about its own origin can't bring an item into view.
    let doc = board(
        json!({"spinner": rect("spinner", json!({"at": {"pos": [1500, 100, 0]}}))}),
        json!({"spin": {"target": "items/spinner/at/rot/2", "type": "f32",
                        "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"},
                                 "k1": {"t": "1s", "value": 360, "interp": "linear"}}}}),
    );
    assert_eq!(presented(doc, [0.0, 0.0, 500.0, 500.0]), vec![0]);
}

#[test]
fn a_wrapping_transport_with_its_motion_out_of_view_stops_the_clock() {
    // Each wrap changes only what moved; nothing in view moves, so no wrap arms a frame.
    let mut doc = board(
        json!({"spinner": rect("spinner", json!({"at": {"pos": [1500, 100, 0]}}))}),
        json!({"spin": {"target": "items/spinner/at/rot/2", "type": "f32",
                        "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"},
                                 "k1": {"t": "0.25s", "value": 90, "interp": "linear"}}}}),
    );
    doc["transport"] = json!({"span": "0.25s", "loop": "wrap"});
    assert_eq!(presented(doc, [0.0, 0.0, 500.0, 500.0]), vec![0]);
}
