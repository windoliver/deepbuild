//! #450: a trail on a 2D `path@1` (Marks in 3D: trail, on `path@1` in a 2D writer layer), the
//! check's refusal of a whole window past its `max_points`, and a trail's cost per frame.

use deep_canvas_motion::eval::{items, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

const S: i64 = 705_600_000;

/// A dot keyed from x = 0 at 0 s to x = 200 u at 2 s, inside a group at (10, 20) turned 90°,
/// and a path drawing its trail with `trail`.
fn doc(trail: Value) -> Value {
    json!({"format": 1, "id": "trails", "size": [400, 300], "layers": {"main": {"order": "a0"}},
        "transport": {"span": "2s"},
        "items": {
            "g": {"kind": "group@1", "layer": "main", "at": {"pos": [10, 20], "rot": 90}},
            "dot": {"kind": "circle@1", "layer": "main", "parent": "g", "params": {"center": [0, 0], "r": 4}},
            "tr": {"kind": "path@1", "layer": "main",
                   "params": {"d": "", "trail": trail, "paint": {"stroke": {"role": "ink", "width": 1}}}}},
        "channels": {"x": {"target": "items/dot/at/pos/0", "type": "f32", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"},
            "b": {"t": "2s", "value": 200, "interp": "linear"}}}}})
}

fn evaluated(d: &Value, t: i64) -> serde_json::Map<String, Value> {
    let map = d.as_object().unwrap();
    let program = Program::compile(map).expect("the document reads");
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    items(map, &program, &state)
}

/// The points of an `M x y L x y …` path.
fn points(d: &str) -> Vec<[f64; 2]> {
    let n: Vec<f64> = d
        .split(|c: char| c == 'M' || c == 'L' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap())
        .collect();
    n.chunks(2).map(|p| [p[0], p[1]]).collect()
}

#[test]
fn a_path_draws_its_sources_place_at_earlier_times_turned_with_its_parent() {
    let d = doc(json!({"of": "dot", "span": 0.5, "segments": 4, "width": 3}));
    let tr = &evaluated(&d, S)["tr"]["params"];
    // At 1 s the dot is at x = 100 in the group, so at (10, 20 + 100) once turned; 0.5 s back at
    // x = 50. Points every 0.125 s, oldest first.
    let got = points(tr["d"].as_str().unwrap());
    let want: Vec<[f64; 2]> = (0..=4)
        .map(|i| [10.0, 20.0 + 50.0 + 12.5 * f64::from(i)])
        .collect();
    assert_eq!(got.len(), want.len(), "{tr}");
    for (g, w) in got.iter().zip(&want) {
        assert!(
            (g[0] - w[0]).abs() < 1e-9 && (g[1] - w[1]).abs() < 1e-9,
            "{got:?} vs {want:?}"
        );
    }
    // Tapered and faded toward the oldest point, full at the newest.
    let width: Vec<f64> = serde_json::from_value(tr["width"].clone()).unwrap();
    let opacity: Vec<f64> = serde_json::from_value(tr["opacity"].clone()).unwrap();
    assert_eq!(width, vec![0.0, 0.75, 1.5, 2.25, 3.0]);
    assert_eq!(opacity, vec![0.0, 0.25, 0.5, 0.75, 1.0]);
    // Seeking equals playing: the same time evaluated again draws the same path.
    assert_eq!(evaluated(&d, S)["tr"], evaluated(&d, S)["tr"]);
}

#[test]
fn a_whole_window_past_its_max_points_is_refused_at_check_naming_the_trail() {
    let trail = json!({"of": "dot", "window": {"whole": {}}, "rate": 60, "max_points": 100});
    let d = doc(trail);
    let raised = deep_canvas_motion::trail::rule(&d, "tr", &d["items"]["tr"]);
    assert_eq!(raised.len(), 1, "121 samples over 2 s at 60 Hz pass 100");
    assert_eq!(raised[0].path, "items/tr/params/trail/max_points");
    assert_eq!(raised[0].severity, "error");
    let fits = doc(json!({"of": "dot", "window": {"whole": {}}, "rate": 60, "max_points": 121}));
    assert!(deep_canvas_motion::trail::rule(&fits, "tr", &fits["items"]["tr"]).is_empty());
}

#[test]
fn a_trails_frame_counts_each_evaluation_of_its_sources_chain() {
    let ms = |trail: Value| deep_canvas_motion::trail::cost(&json!({"params": {"trail": trail}}));
    let each = deep_canvas_motion::trail::CHAIN_MS;
    // 16 segments: 17 points and the source at t; three kept traces of them; a whole window's
    // bake is taken at check, so a frame reads only the point and the source at t.
    assert_eq!(ms(json!({"of": "a"})), 18.0 * each);
    assert_eq!(
        ms(json!({"of": "a", "window": {"since": {"on": "markers.cue"}}})),
        52.0 * each
    );
    assert_eq!(ms(json!({"of": "a", "window": {"whole": {}}})), 2.0 * each);
    assert_eq!(ms(json!(null)), 0.0);
}

#[test]
fn a_trail_whose_source_a_logic_array_moves_is_refused_at_check_naming_it() {
    let mut d = doc(json!({"of": "dot"}));
    d["items"]["brain"] = json!({"kind": "logic@1", "layer": "main", "params": {}});
    d["drivers"] = json!({"y": {"target": "items/g/at/pos/1", "expr": "v", "vars": {"v": "brain.y"}, "fallback": 0}});
    let raised = deep_canvas_motion::trail::rule(&d, "tr", &d["items"]["tr"]);
    assert_eq!(raised.len(), 1, "the dot's parent g reads a logic array");
    assert_eq!(raised[0].path, "items/g");
    // A driver that reads no logic item leaves the trail alone.
    d["drivers"]["y"]["vars"] = json!({"v": "time"});
    assert!(deep_canvas_motion::trail::rule(&d, "tr", &d["items"]["tr"]).is_empty());
}
