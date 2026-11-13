//! Issue #504: assemblies that compose and take apart, stage shots that glide from the pose
//! shown, stages that set values, the input track a played form carries, a replayed control
//! bounded between its entries, and framing that keeps a take-apart in frame. Each test names
//! the planted program it fails.

use deep_canvas::interval::Iv;
use deep_canvas_motion::doc::Feel;
use deep_canvas_motion::eval::{shown_values, Validity};
use deep_canvas_motion::input::{Entry, Inputs};
use deep_canvas_motion::program::{Options, Planted, Program, State, TRANSFORM};
use deep_canvas_motion::shots::{bounds_at, At, Pose};
use serde_json::{json, Map, Value};

const S: i64 = 705_600_000;

fn obj(v: Value) -> Map<String, Value> {
    let Value::Object(m) = v else { unreachable!() };
    m
}

fn compile(d: &Map<String, Value>, planted: Planted) -> Program {
    Program::compile_with(d, Options { planted, ..Default::default() }).expect("compiles")
}

fn at(p: &Program, t: i64) -> State {
    let mut s = p.state();
    p.evaluate(t, Validity::Full, &mut s);
    s
}

fn pos(p: &Program, s: &State, id: &str) -> [f64; 3] {
    let i = p.items.iter().position(|x| x == id).unwrap();
    [0, 1, 2].map(|k| s.slots[i * TRANSFORM + k])
}

fn share(p: &Program, s: &State, id: &str) -> f64 {
    let a = p.assemblies.iter().find(|a| a.id == id).unwrap();
    s.slots[a.slot + 1]
}

fn close(a: [f64; 3], b: [f64; 3], e: f64) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() <= e)
}

fn part(id: &str, parent: &str, pos: [f64; 3]) -> Value {
    json!({"id": id, "kind": "mark.box@1", "parent": parent, "params": {"size": [1, 1, 1]}, "at": {"pos": pos}})
}

#[test]
fn assemblies_compose_four_deep_and_refuse_a_fifth() {
    let assemblies = json!({
        "a": {"at": {"pos": [1, 0, 0]}, "motion": {"kind": "slide", "axis": [2, 0, 0], "range": [0, 5]}, "value": 1},
        "b": {"parent": "a", "at": {"pos": [0, 2, 0]}, "motion": {"kind": "turn", "axis": [0, 0, 1]}, "value": 90},
        "c": {"parent": "b", "motion": {"kind": "slide", "axis": [0, 1, 0]}, "value": 3},
        "d": {"parent": "c", "at": {"pos": [0, 0, 4]}},
    });
    let d = obj(json!({"assemblies": assemblies, "items": {"p": part("p", "d", [1.0, 0.0, 0.0])}}));
    let p = compile(&d, Planted::None);
    let s = at(&p, 0);
    // d: (1, 0, 4); c slides 3 along y: (1, 3, 4); b turns 90° about z: (−3, 1, 4), then moves
    // up 2: (−3, 3, 4); a slides 1 along x from x = 1: (−1, 3, 4).
    assert!(close(pos(&p, &s, "p"), [-1.0, 3.0, 4.0], 1e-12), "{:?}", pos(&p, &s, "p"));
    let i = p.items.iter().position(|x| x == "p").unwrap();
    assert!((s.slots[i * TRANSFORM + 5] - 90.0).abs() < 1e-9, "the part turns with b");
    assert_eq!(p.member("p"), p.assemblies.iter().position(|a| a.id == "d"));

    let mut five = d.clone();
    five["assemblies"]["e"] = json!({"parent": "d"});
    let r = Program::compile(&five).expect_err("a fifth level");
    assert_eq!((r.code, r.path.as_str()), ("out_of_range", "assemblies/e/parent"));
    let mut cycle = d.clone();
    cycle["assemblies"]["a"]["parent"] = json!("d");
    assert_eq!(Program::compile(&cycle).expect_err("a cycle").code, "cycle");
}

/// Three assemblies a toggle takes apart, staggered 0.2 s, the list out of `order`.
fn take_apart(track: Value) -> Map<String, Value> {
    obj(json!({
        "transport": {"span": "10s"},
        "assemblies": {
            "lid": {"apart": [0, 0, 1], "order": 0},
            "body": {"apart": [0, 0, 2], "order": 1},
            "base": {"apart": [0, 0, 3], "order": 2},
        },
        "items": {"part-lid": part("part-lid", "lid", [0.0; 3]), "part-body": part("part-body", "body", [0.0; 3]), "part-base": part("part-base", "base", [0.0; 3])},
        "controls": {"apart": {"kind": "toggle", "class": "document", "default": false}},
        "channels": {"take": {"mode": "follow", "follow": {
            "source": "controls/apart/value", "model": {"transition": {"span": "0.4s"}},
            "stagger": {"targets": ["base", "lid", "body"], "lag": "0.2s", "reverse_on_close": true}}}},
        "track": track,
    }))
}

#[test]
fn a_take_apart_starts_in_order_stays_in_0_1_and_comes_back_reversed() {
    let d = take_apart(json!([{"t": S, "control": "apart", "value": true}, {"t": 3 * S, "control": "apart", "value": false}]));
    let p = compile(&d, Planted::None);
    let ms = |m: i64| S * m / 1000;
    // Opening: lid (order 0) moves first, body 0.2 s later, base 0.4 s later.
    let s = at(&p, ms(1100));
    assert!(share(&p, &s, "lid") > 0.0 && share(&p, &s, "body") == 0.0 && share(&p, &s, "base") == 0.0);
    let s = at(&p, ms(1300));
    assert!(share(&p, &s, "body") > 0.0 && share(&p, &s, "base") == 0.0);
    let s = at(&p, ms(2000));
    for id in ["lid", "body", "base"] {
        assert_eq!(share(&p, &s, id), 1.0);
    }
    // The parts ride their assemblies: apart × share.
    assert_eq!(pos(&p, &s, "part-base"), [0.0, 0.0, 3.0]);
    // Closing, reversed: base first, lid last.
    let s = at(&p, ms(3100));
    assert!(share(&p, &s, "base") < 1.0 && share(&p, &s, "lid") == 1.0);
    let s = at(&p, ms(5000));
    for id in ["lid", "body", "base"] {
        assert_eq!(share(&p, &s, id), 0.0, "{id} comes back");
    }
    for k in 0..500 {
        let s = at(&p, ms(10 * k));
        for id in ["lid", "body", "base"] {
            let x = share(&p, &s, id);
            assert!((0.0..=1.0).contains(&x), "{id} at {} ms: {x}", 10 * k);
        }
    }
    // The planted take-apart moves body with lid.
    let flat = compile(&d, Planted::TakeApartAllAtOnce);
    assert!(share(&flat, &at(&flat, ms(1100)), "body") > 0.0, "the plant drops the stagger");
}

#[test]
fn a_take_apart_reversed_mid_move_turns_back_from_where_it_is() {
    // Closed 0.3 s after opening: body (rank 1) opened at 1.2 s and turns back at 1.5 s
    // (rank 1 of 3 closes 0.2 s late), base (rank 2) never starts.
    let ms = |m: i64| S * m / 1000;
    let d = take_apart(json!([{"t": S, "control": "apart", "value": true}, {"t": ms(1300), "control": "apart", "value": false}]));
    let p = compile(&d, Planted::None);
    let before = share(&p, &at(&p, ms(1500) - 1), "body");
    let turn = share(&p, &at(&p, ms(1500)), "body");
    assert!(before > 0.0 && before < 1.0, "body is mid move: {before}");
    assert!((turn - before).abs() < 1e-6, "body turns back from {before}, not from its target: {turn}");
    for k in 0..300 {
        assert_eq!(share(&p, &at(&p, ms(10 * k)), "base"), 0.0, "base never starts");
    }
    assert_eq!(share(&p, &at(&p, ms(3000)), "body"), 0.0);
    let jumpy = compile(&d, Planted::TransitionRestarts);
    assert!((share(&jumpy, &at(&jumpy, ms(1500)), "body") - before).abs() > 1e-3, "the plant restarts from the target");
}

/// A perspective camera, a stages control with a gliding stage and a cut stage, and a track
/// entering `close` at 4 s and `snap` at 6 s.
fn stages() -> Map<String, Value> {
    obj(json!({
        "transport": {"span": "10s"},
        "items": {"cam": {"id": "cam", "kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 0, "elevation": 10, "distance": 10}, "fov": 40}}},
        "controls": {"view": {"kind": "stages", "class": "document", "default": "wide", "stages": {
            "wide": {"label": "Wide", "shot": "wide"}, "close": {"label": "Close", "shot": "close"}, "snap": {"label": "Snap", "shot": "snap"}}}},
        "shots": {
            "wide": {"camera": "cam", "move": "hold", "target": [0, 0, 0], "orbit": {"azimuth": 0, "elevation": 10, "distance": 10}},
            "close": {"camera": "cam", "move": "hold", "target": [1, 0, 0], "orbit": {"azimuth": 30, "elevation": 20, "distance": 4}},
            "snap": {"camera": "cam", "move": "hold", "target": [0, 1, 0], "orbit": {"distance": 6}, "join": "cut"},
        },
        "track": [{"t": 4 * S, "control": "view", "value": "close"}, {"t": 6 * S, "control": "view", "value": "snap"}],
    }))
}

fn shown(p: &Program, t: i64) -> Pose {
    let plan = p.shots.as_ref().expect("a plan");
    let keyed = |_: usize| None;
    let at = At { reduced: false, planted: p.options.planted, indexed: None, keyed: &keyed };
    plan.shown(plan.camera("cam").unwrap(), t, &at).pose
}

fn framed(p: &Program, id: &str) -> Pose {
    p.shots.as_ref().unwrap().stage.iter().flatten().find(|s| s.id == id).unwrap().framed
}

#[test]
fn a_stage_glides_from_the_pose_shown_to_its_framed_pose_and_a_cut_lands_at_once() {
    let p = compile(&stages(), Planted::None);
    let (wide, close_, snap) = (framed(&p, "wide"), framed(&p, "close"), framed(&p, "snap"));
    assert_eq!(shown(&p, 2 * S), wide, "the default stage's framed pose holds");
    // At the entry the glide starts on the pose shown, and lands on the framed pose 0.8 s on.
    let entry = shown(&p, 4 * S);
    let just_before = shown(&p, 4 * S - 1);
    assert!(close(entry.position, just_before.position, 1e-6) && close(entry.target, just_before.target, 1e-6));
    let mid = shown(&p, 4 * S + 2 * S / 5);
    assert!(!close(mid.position, wide.position, 0.1) && !close(mid.position, close_.position, 0.1), "mid glide is between");
    assert_eq!(shown(&p, 4 * S + 4 * S / 5), close_, "the glide ends on the framed pose");
    // join: cut shows the framed pose on the entry's own flick.
    assert_eq!(shown(&p, 6 * S), snap);
    assert_eq!(shown(&p, 6 * S - 1), close_);
    // The planted glide eases the target only, its eye on the framed position from the entry.
    let target_only = compile(&stages(), Planted::StageGlideMovesTargetOnly);
    assert!(!close(shown(&target_only, 4 * S).position, just_before.position, 1e-6), "the plant's eye jumps at the entry");
}

#[test]
fn a_stage_set_jumps_at_its_entry() {
    let d = obj(json!({
        "transport": {"span": "10s"},
        "data": {"h": {"value": 1}},
        "items": {"ball": {"id": "ball", "kind": "mark.box@1", "params": {"size": 1}, "at": {"pos": [0, 3, 0]}}},
        "controls": {"steps": {"kind": "stages", "class": "document", "default": "a", "stages": {
            "a": {"label": "A", "set": {"items/ball/at/pos/1": 10}},
            "b": {"label": "B", "set": {"items/ball/at/pos/1": 50, "data/h": 7}}}}},
        "track": [{"t": 2 * S, "control": "steps", "value": "b"}],
    }));
    let p = compile(&d, Planted::None);
    assert_eq!(pos(&p, &at(&p, S), "ball")[1], 10.0);
    assert_eq!(pos(&p, &at(&p, 2 * S - 1), "ball")[1], 10.0);
    let s = at(&p, 2 * S);
    assert_eq!(pos(&p, &s, "ball")[1], 50.0, "the set lands on the entry's flick");
    let shown = shown_values(&d, &p, &s);
    assert_eq!((shown["data"]["h"].clone(), shown["controls"]["steps"].clone()), (json!(7.0), json!("b")));
    assert_eq!(shown_values(&d, &p, &at(&p, S))["data"]["h"], json!(1.0), "a stage that sets no value leaves the document's");
    let ignored = compile(&d, Planted::StageSetIgnored);
    assert_eq!(pos(&ignored, &at(&ignored, 2 * S), "ball")[1], 3.0, "the plant sets nothing");
}

#[test]
fn a_track_entry_on_a_slider_moves_nothing_and_refuses_nothing() {
    let d = obj(json!({
        "controls": {
            "speed": {"kind": "slider", "class": "document", "range": [0, 10], "default": 5},
            "power": {"kind": "toggle", "class": "document", "default": false},
        },
        "track": [{"t": S, "control": "speed", "value": 8}, {"t": 2 * S, "control": "power", "value": true}],
    }));
    let p = Program::compile(&d).expect("a slider's entry on the track is no refusal");
    assert_eq!(p.options.input.len(), 2, "the inline track is the program's");
    let slider = Entry { t: S, seq: 0, control: "speed".into(), value: json!(8), player: 1 };
    assert!(Inputs::new(&p.motion, Feel::default(), &[slider]).is_some());
    assert_eq!(shown_values(&d, &p, &at(&p, S + 1))["controls"], json!({"power": false, "speed": 8}));
}

#[test]
fn a_replayed_control_between_two_entries_is_bounded_by_one_value() {
    let d = obj(json!({
        "transport": {"span": "10s"},
        "items": {"a": {"id": "a", "kind": "mark.box@1", "params": {"size": 1}, "at": {"pos": [0, 0, 0]}}},
        "controls": {"setting": {"kind": "slider", "class": "document", "range": [0, 20], "default": 16}},
        "drivers": {"d": {"target": "items/a/at/pos/0", "expr": "s * 2", "vars": {"s": "controls/setting/value"}}},
        "track": [{"t": S, "control": "setting", "value": 16}, {"t": 5 * S, "control": "setting", "value": 4}, {"t": 8 * S, "control": "setting", "value": 16}],
    }));
    let p = compile(&d, Planted::None);
    let slot = p.slot_of("a", &["at".into(), "pos".into(), "0".into()]).unwrap();
    let near = |b: Iv, lo: f64, hi: f64| (b.lo - lo).abs() < 1e-9 && (b.hi - hi).abs() < 1e-9;
    let between = p.slot_bound_over(slot, Iv::new(2.0, 4.0)).unwrap();
    assert!(near(between, 32.0, 32.0), "between 16 at 1 s and 4 at 5 s the driver reads 32 alone: {between:?}");
    let across = p.slot_bound_over(slot, Iv::new(4.0, 6.0)).unwrap();
    assert!(near(across, 8.0, 32.0), "across the entry at 5 s: {across:?}");
    let whole = compile(&d, Planted::ReplayBoundsWholeRange);
    let planted = whole.slot_bound_over(slot, Iv::new(2.0, 4.0)).unwrap();
    assert!(!near(planted, 32.0, 32.0), "the plant bounds by the range: {planted:?}");
}

/// A lid that lifts and an arm that turns, taken apart and put back inside a shot that keeps both.
fn kept() -> Map<String, Value> {
    obj(json!({
        "transport": {"span": "6s"},
        "size": [640, 360],
        "camera": "cam",
        "assemblies": {
            "lid": {"apart": [0, 2, 0], "order": 0},
            "arm": {"motion": {"kind": "turn", "axis": [0, 0, 1], "pivot": [0, 0, 0], "range": [0, 90]}, "apart": [1, 0, 0], "order": 1},
        },
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 20, "elevation": 20, "distance": 12}, "fov": 40}},
            "lid-box": {"id": "lid-box", "kind": "mark.box@1", "parent": "lid", "params": {"size": [1, 0.2, 1]}, "at": {"pos": [0, 0.5, 0]}},
            "arm-ball": {"id": "arm-ball", "kind": "mark.sphere@1", "parent": "arm", "params": {"size": [0.5, 0.5, 0.5]}, "at": {"pos": [2, 0, 0]}},
        },
        "controls": {"apart": {"kind": "toggle", "class": "document", "default": false}},
        "channels": {
            "swing": {"target": "assemblies/arm/value", "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "4s", "value": 90}}},
            "take": {"mode": "follow", "follow": {"source": "controls/apart/value", "model": {"transition": {"span": "0.5s"}},
                     "stagger": {"targets": ["lid", "arm"], "lag": "0.25s", "reverse_on_close": true}}},
        },
        "shots": {"show": {"camera": "cam", "start": "0s", "end": "6s", "frame": {"keep": ["lid-box", "arm-ball"]}}},
        "track": [{"t": S, "control": "apart", "value": true}, {"t": 7 * S / 2, "control": "apart", "value": false}],
    }))
}

fn inside(b: [[f64; 3]; 2], u: [[f64; 3]; 2]) -> bool {
    (0..3).all(|k| b[0][k] >= u[0][k] - 1e-9 && b[1][k] <= u[1][k] + 1e-9)
}

#[test]
fn a_take_apart_shot_bounds_every_part_through_open_and_close() {
    let d = kept();
    let p = compile(&d, Planted::None);
    let union = p.shots.as_ref().unwrap().shots[0].union.expect("a framed union");
    let lifted = pos(&p, &at(&p, 2 * S), "lid-box");
    assert!(close(lifted, [0.0, 2.5, 0.0], 1e-12), "the lid lifts by its apart: {lifted:?}");
    for k in 0..=180 {
        let t = 6 * S * k / 180;
        let s = at(&p, t);
        for id in ["lid-box", "arm-ball"] {
            let b = bounds_at(&p, &d, &s, id).unwrap();
            assert!(inside(b, union), "{id} at frame {k}: {b:?} leaves {union:?}");
        }
    }
    let ignoring = compile(&d, Planted::FramerIgnoresApart);
    let u = ignoring.shots.as_ref().unwrap().shots[0].union.unwrap();
    let s = at(&ignoring, 2 * S);
    assert!(!inside(bounds_at(&ignoring, &d, &s, "lid-box").unwrap(), u), "the plant frames the parts together only");
}
