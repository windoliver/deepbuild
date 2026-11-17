use super::*;

fn doc(modifiers: Value) -> Value {
    serde_json::json!({
        "format": 1, "size": [320, 240], "camera": "cam",
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                    "params": {"projection": "perspective", "position": [0, 0, 5], "target": [0, 0, 0], "fov": 40}},
            "l": {"id": "l", "kind": "mark.line@1", "order": "a1",
                  "params": {"points": [[0, 0, 0], [2, 0, 0]], "width": 2, "paint": {"fill": {"role": "ink"}}},
                  "modifiers": modifiers}
        }
    })
}

fn lines(modifiers: Value, t: i64) -> Vec<Line> {
    let look = crate::look::Look3::from_roles(
        [
            ("ink".to_string(), [0, 0, 0]),
            ("ground".to_string(), [255, 255, 255]),
        ]
        .into_iter()
        .collect(),
    );
    let mut labels = Labels::new();
    let scene = evaluate(&doc(modifiers), t, &look, &mut labels).unwrap();
    scene.layers.into_iter().flat_map(|l| l.lines).collect()
}

#[test]
fn dash_cuts_a_two_metre_stroke_into_its_dashes() {
    let ls = lines(
        serde_json::json!([{"kind": "mod.dash@1", "params": {"dash": 0.3, "gap": 0.2}}]),
        0,
    );
    assert_eq!(ls.len(), 1);
    // 0–0.3, 0.5–0.8, 1.0–1.3, 1.5–1.8.
    assert_eq!(ls[0].segments.len(), 4);
    assert!((stroke_length(&ls[0].segments) - 1.2).abs() < 1e-9);
}

#[test]
fn outline_draws_a_wider_line_under_it() {
    let ls = lines(
        serde_json::json!([{"kind": "mod.outline@1", "params": {"width": 1}}]),
        0,
    );
    assert_eq!(ls.len(), 2);
    assert_eq!(ls[0].segments[0].wa, 4.0);
    assert_eq!(ls[1].segments[0].wa, 2.0);
}

#[test]
fn boil_steps_at_its_rate_and_while_drawing_waits_for_a_build() {
    let fl = deep_canvas::camera::FLICKS_PER_SECOND;
    let boil = serde_json::json!([{"kind": "mod.boil@1", "params": {"amount": 0.05, "hz": 2}}]);
    let at = |t: i64| lines(boil.clone(), t)[0].segments[0].a;
    assert_eq!(at(fl / 10), at(fl / 5), "one step holds for half a second");
    assert_ne!(at(fl / 10), at(fl), "the next step draws again");
    let waiting = serde_json::json!([
        {"kind": "mod.build@1", "params": {"to": 1}},
        {"kind": "mod.boil@1", "while": "drawing", "params": {"amount": 0.05, "hz": 2}}
    ]);
    assert_eq!(lines(waiting, fl / 10)[0].segments[0].a, [0.0, 0.0, 0.0]);
    let mid = serde_json::json!([
        {"kind": "mod.build@1", "params": {"to": 0.5}},
        {"kind": "mod.boil@1", "while": "drawing", "params": {"amount": 0.05, "hz": 2}}
    ]);
    let ls = lines(mid, fl / 10);
    assert_ne!(ls[0].segments[0].a, [0.0, 0.0, 0.0]);
    assert!(stroke_length(&ls[0].segments) < 1.2);
}
