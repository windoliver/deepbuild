use super::*;

const MS: i64 = 705_600;

/// A 3D scene looking down −z from 10 m at the origin, in an 800 × 600 panel: a 2 m box at
/// the origin and a 1 m box 3 m nearer the eye, both on the line of sight.
fn scene() -> Value {
    let solid = |id: &str, size: f64, z: f64, order: &str| {
        json!({"id": id, "kind": "mark.box@1", "name": id, "order": order,
                "params": {"size": [size, size, size]}, "at": {"pos": [0, 0, z]}})
    };
    json!({
        "format": 1, "profile": "scene", "size": [800, 600], "camera": "cam",
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0",
                "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 10], "fov": 40}},
            "near": solid("near", 1.0, 3.0, "a1"),
            "far": solid("far", 2.0, 0.0, "a2"),
        }
    })
}

fn scope(doc: &Value) -> Scope {
    Scope::new(
        doc,
        [0.0, 0.0, 800.0, 600.0],
        [1600.0, 900.0],
        Planted::default(),
    )
    .expect("the scene's camera reads")
}

fn click(s: &mut Scope, doc: &Value, t: i64, p: [f64; 2]) {
    s.input(
        doc,
        t,
        1,
        &Event::Down {
            pos: p,
            toggle: false,
        },
    );
    s.input(doc, t + 60 * MS, 2, &Event::Up(p));
}

#[test]
fn a_click_in_3d_selects_the_nearest_box_under_the_pointer() {
    let doc = scene();
    let mut s = scope(&doc);
    // The centre: both boxes are under it; the near one wins on depth though it stacks first.
    click(&mut s, &doc, 0, [400.0, 300.0]);
    assert_eq!(s.selection, ["near"]);
    // 95 px right: past the near box's edge (about 78 px), inside the far one's (about 110 px).
    click(&mut s, &doc, 2000 * MS, [495.0, 300.0]);
    assert_eq!(s.selection, ["far"]);
    click(&mut s, &doc, 4000 * MS, [700.0, 300.0]);
    assert!(s.selection.is_empty(), "nothing is under the pointer there");
}

#[test]
fn a_click_on_a_target_picks_its_stage_and_never_selects_and_tab_then_enter_picks_the_next() {
    let mut doc = scene();
    doc["controls"] = json!({"steps": {"kind": "stages", "role": "tablist",
            "stages": {"a": {"label": "Near"}, "b": {"label": "Far"}},
            "targets": {"a": "near", "b": "far"}}});
    let mut s = scope(&doc);
    s.input(
        &doc,
        0,
        1,
        &Event::Down {
            pos: [400.0, 300.0],
            toggle: false,
        },
    );
    let done = s.input(&doc, 60 * MS, 2, &Event::Up([400.0, 300.0]));
    assert_eq!(
        done.pick.map(|p| (p.option, p.label)),
        Some(("a".into(), "Near".into()))
    );
    assert!(
        s.selection.is_empty() && s.details.is_none(),
        "a pick never selects or opens a panel"
    );
    let key = |k: &str| Event::Key {
        key: k.into(),
        cmd: false,
        alt: false,
    };
    s.input(&doc, 120 * MS, 3, &key("Tab"));
    let done = s.input(&doc, 180 * MS, 4, &key("Enter"));
    assert_eq!(done.pick.map(|p| p.item), Some("far".into()));
    // An item that doesn't draw is never a target.
    doc["items"]["far"]["visible"] = json!(false);
    assert_eq!(pick_targets(&doc, &[]).len(), 1);
    // The planted wrong program selects the target too.
    let mut planted = Scope::new(
        &doc,
        [0.0, 0.0, 800.0, 600.0],
        [1600.0, 900.0],
        Planted {
            pick_selects: true,
            ..Planted::default()
        },
    )
    .expect("reads");
    click(&mut planted, &doc, 0, [400.0, 300.0]);
    assert_eq!(planted.selection, ["near"]);
}

#[test]
fn a_double_click_in_3d_flies_to_the_box_and_esc_backs_out() {
    let doc = scene();
    let mut s = scope(&doc);
    let before = s.pose();
    click(&mut s, &doc, 0, [400.0, 300.0]);
    assert_eq!(s.pose(), before, "a click never moves the camera");
    click(&mut s, &doc, 120 * MS, [400.0, 300.0]);
    let flown = s.pose();
    let levels: Vec<&str> = s.levels.iter().map(|l| l.id.as_str()).collect();
    assert_eq!(levels, ["near"]);
    assert_eq!(flown.target, [0.0, 0.0, 3.0], "the view centres on the box");
    assert!(flown.distance < before.distance, "and comes closer");
    // The box's bounding sphere fits the narrower side: its corners stay in the panel.
    let view = Projector::new(&flown, [800.0, 600.0], [800.0, 600.0]);
    for bits in 0..8 {
        let s = |axis: usize| if bits >> axis & 1 == 1 { 0.5 } else { -0.5 };
        let p = view.project([s(0), s(1), 3.0 + s(2)]).expect("in front");
        assert!((0.0..=800.0).contains(&p.x) && (0.0..=600.0).contains(&p.y));
    }
    let esc = Event::Key {
        key: "Escape".into(),
        cmd: false,
        alt: false,
    };
    s.input(&doc, 2000 * MS, 5, &esc);
    assert_eq!(
        s.pose(),
        before,
        "Esc gives back the camera before the flight"
    );
    assert!(s.levels.is_empty());
}

#[test]
fn a_drag_in_3d_turns_about_the_target() {
    let doc = scene();
    let mut s = scope(&doc);
    let before = s.pose();
    s.input(
        &doc,
        0,
        1,
        &Event::Down {
            pos: [700.0, 300.0],
            toggle: false,
        },
    );
    s.input(&doc, 16 * MS, 2, &Event::Move([760.0, 300.0]));
    let done = s.input(&doc, 32 * MS, 3, &Event::Up([760.0, 300.0]));
    let after = s.pose();
    assert_ne!(after.azimuth, before.azimuth, "the drag turns");
    assert_eq!(after.target, before.target, "about the target, which stays");
    assert_eq!(done.commits, [3], "one commit, on the release");
}

/// A flat board, page = panel (800 × 450): you wrote `note`; alpha wrote `region`, which
/// holds `box`, and `line`.
fn board() -> Value {
    let item = |id: &str, kind: &str, layer: &str, x: f64, parent: Option<&str>| {
        let mut i = json!({"id": id, "kind": kind, "layer": layer, "name": id, "order": "a1",
                "params": {"box": [x, 100.0, 100.0, 100.0]}});
        if let Some(p) = parent {
            i["parent"] = json!(p);
        }
        i
    };
    json!({
        "format": 1, "profile": "board", "size": [800, 450],
        "layers": {"you-main": {"writer": "you:you"}, "alpha-main": {"writer": "agent:alpha"}},
        "items": {
            "note": item("note", "text@1", "you-main", 0.0, None),
            "region": item("region", "frame@1", "alpha-main", 200.0, None),
            "box": item("box", "rect@1", "alpha-main", 210.0, Some("region")),
            "line": item("line", "rect@1", "alpha-main", 500.0, None),
        }
    })
}

fn board_scope(doc: &Value) -> Scope {
    Scope::new(
        doc,
        [0.0, 0.0, 800.0, 450.0],
        [1600.0, 900.0],
        Planted::default(),
    )
    .expect("the board reads")
}

fn set(s: &mut Scope, doc: &Value, control: &str, value: Value) -> Done {
    let event = Event::Control {
        control: control.into(),
        value,
    };
    s.input(doc, 0, 9, &event)
}

#[test]
fn a_filter_hides_by_kind_or_writer_and_what_it_hides_cant_be_picked() {
    let doc = board();
    let mut s = board_scope(&doc);
    click(&mut s, &doc, 0, [550.0, 150.0]);
    assert_eq!(s.selection, ["line"], "shown, it's picked");
    let done = set(&mut s, &doc, "filter", json!({"writers": ["agent:alpha"]}));
    assert_eq!(done.commits, [9], "a control entry commits once");
    assert_eq!(s.hidden(&doc), ["box", "line", "region"]);
    click(&mut s, &doc, 2000 * MS, [550.0, 150.0]);
    assert!(s.selection.is_empty(), "hidden, it isn't");
    set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
    assert_eq!(s.hidden(&doc), ["note"]);
    set(&mut s, &doc, "filter", Value::Null);
    assert!(s.hidden(&doc).is_empty());
    let refused = set(&mut s, &doc, "lens", json!("taste"));
    assert!(
        refused.commits.is_empty(),
        "a value the control doesn't take commits nothing"
    );
}

#[test]
fn isolation_keeps_an_item_with_its_parents_and_children_and_esc_ends_it_first() {
    let doc = board();
    let mut s = board_scope(&doc);
    set(&mut s, &doc, "isolate", json!("region"));
    assert_eq!(
        s.hidden(&doc),
        ["line", "note"],
        "region and the box it holds stay"
    );
    set(&mut s, &doc, "isolate", json!("box"));
    assert_eq!(
        s.hidden(&doc),
        ["line", "note"],
        "isolating the child keeps its parent"
    );
    s.full_screen = true;
    let esc = Event::Key {
        key: "Escape".into(),
        cmd: false,
        alt: false,
    };
    s.input(&doc, 0, 10, &esc);
    assert!(s.hidden(&doc).is_empty(), "the first Esc ends isolation");
    assert!(s.full_screen, "and only that");
    s.input(&doc, 0, 11, &esc);
    assert!(!s.full_screen, "the next leaves full screen");
}

#[test]
fn the_writer_lens_keys_each_shown_item_by_its_layers_writer() {
    let doc = board();
    let mut s = board_scope(&doc);
    set(&mut s, &doc, "lens", json!("writer"));
    set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
    let state = s.to_json(&doc, None, &Map::new());
    assert_eq!(state["lens"]["by"], json!("writer"));
    assert_eq!(
        state["lens"]["key"],
        json!({"region": "agent:alpha", "box": "agent:alpha", "line": "agent:alpha"}),
        "a hidden item has no key"
    );
    let mut later = doc.clone();
    later["items"]["line"]["params"]["box"][0] = json!(520.0);
    later["items"]
        .as_object_mut()
        .expect("items")
        .remove("note");
    set(&mut s, &doc, "lens", json!("changed"));
    let state = s.to_json(&later, Some(&doc), &Map::new());
    assert_eq!(
        state["changed"],
        json!({"line": "changed", "note": "removed"})
    );
    assert_eq!(state["lens"]["key"]["line"], json!("changed"));
    assert_eq!(state["lens"]["key"]["box"], json!("same"));
}

#[test]
fn a_click_in_3d_hits_a_point_or_a_line_within_a_few_px_of_it() {
    // The scene's camera, with a point 2 m right of the target and a rail 2 m below it.
    let mut doc = scene();
    let items = doc["items"].as_object_mut().expect("items");
    items.remove("near");
    items.remove("far");
    items.insert(
            "dot".into(),
            json!({"id": "dot", "kind": "mark.point@1", "name": "Dot", "order": "a1", "at": {"pos": [2, 0, 0]}}),
        );
    items.insert(
        "rail".into(),
        json!({"id": "rail", "kind": "mark.line@1", "name": "Rail", "order": "a2",
                "params": {"points": [[-3, -2, 0], [3, -2, 0]]}}),
    );
    let mut s = scope(&doc);
    // 2 m at 10 m is 2 × focal ÷ 10 px from the centre, focal = 400 ÷ tan 20°.
    let px = 2.0 * 400.0 / crate::ops::tan(crate::ops::rad(20.0)) / 10.0;
    click(&mut s, &doc, 0, [400.0 + px + 5.0, 300.0]);
    assert_eq!(s.selection, ["dot"], "5 px from the point");
    click(&mut s, &doc, 2000 * MS, [450.0, 300.0 + px - 4.0]);
    assert_eq!(s.selection, ["rail"], "4 px from the rail");
    click(&mut s, &doc, 4000 * MS, [450.0, 300.0 + px - 20.0]);
    assert!(s.selection.is_empty(), "20 px from both");
}

#[test]
fn selecting_a_bound_value_lights_the_verdicts_that_read_its_state() {
    let mut doc = board();
    doc["bound_values"] = json!({
        "b1": {"target": "items/note/params/text", "source": "reading:rd-latency"},
        "b2": {"target": "items/line/params/text", "source": "reading:rd-errors"},
    });
    let verdicts: Map<String, Value> = serde_json::from_value(json!({
            "vd-1": {"outcome": "PASS", "key": {"state_digests": {"reading:rd-latency": "sha-a"}}},
            "vd-2": {"outcome": "PASS", "key": {"state_digests": {"reading:rd-errors": "sha-b"}}},
            "vd-3": {"outcome": "FAIL", "key": {"state_digests": {"reading:rd-latency": "sha-a", "reading:rd-cpu": "sha-c"}}},
        }))
        .expect("verdicts");
    let mut s = board_scope(&doc);
    click(&mut s, &doc, 0, [50.0, 150.0]);
    assert_eq!(s.selection, ["note"]);
    assert_eq!(
        s.to_json(&doc, None, &verdicts)["stale_if_changed"],
        json!(["vd-1", "vd-3"])
    );
    click(&mut s, &doc, 2000 * MS, [250.0, 150.0]);
    assert_eq!(s.selection, ["region"], "a region shows no bound value");
    assert_eq!(s.stale_if_changed(&doc, &verdicts), Vec::<String>::new());
}

#[test]
fn the_view_document_hides_what_the_view_hides_and_paints_the_lens_and_saves_nothing() {
    let doc = board();
    let mut s = board_scope(&doc);
    set(&mut s, &doc, "filter", json!({"kinds": ["text@1"]}));
    set(&mut s, &doc, "lens", json!("writer"));
    let view = s.view_document(&doc, None);
    assert_eq!(view["items"]["note"]["visible"], json!(false));
    assert_eq!(
        view["items"]["line"]["params"]["paint"]["fill"]["role"],
        json!("accent")
    );
    assert_eq!(
        view["items"]["note"]["params"]["paint"]["fill"]["role"],
        json!("ink")
    );
    assert_eq!(doc, board(), "the document itself is unchanged");
}
