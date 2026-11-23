use super::*;

/// #2013's garden: the vase rests on the table's top, the scatter keeps its distance and its
/// margin and stays off the table, no two elements' bounds pass into each other, and the
/// same garden with its items listed the other way round scatters the same.
#[test]
fn the_scattered_garden_rests_its_vase_and_prunes_its_shrubs() {
    let doc = crate::module::garden();
    let placed = placed_at(&doc, 0).unwrap();
    let vase = placed.iter().find(|(id, _, _)| id == "vase").unwrap();
    assert!(
        (vase.2[1][3] - 0.75).abs() < 1e-8 && vase.2[0][3] == 0.2,
        "{:?}",
        vase.2
    );
    let rows = elements_at(&doc, 0, "shrubs", None).unwrap().unwrap();
    assert!(rows.len() > 40, "{}", rows.len());
    // An element's bounds on the ground: its prototype's square, turned by its yaw.
    let half = |r: &crate::distribute::Row| {
        let (c, s) = (cos(rad(r.yaw)).abs(), sin(rad(r.yaw)).abs());
        (if r.proto == 0 { 0.45 } else { 0.1 }) * (c + s)
    };
    assert!(rows.iter().any(|r| r.proto == 0) && rows.iter().any(|r| r.proto == 1));
    for (i, a) in rows.iter().enumerate() {
        assert!(
            a.pos[0].abs() <= 4.5 && a.pos[2].abs() <= 4.5 && a.pos[1] == 0.0,
            "{:?}",
            a.pos
        );
        assert!(
            a.pos[0].abs() > 0.6 || a.pos[2].abs() > 0.4,
            "in the table: {:?}",
            a.pos
        );
        for b in &rows[i + 1..] {
            let d = [(a.pos[0] - b.pos[0]).abs(), (a.pos[2] - b.pos[2]).abs()];
            assert!(d[0] * d[0] + d[1] * d[1] >= 0.25);
            let clear = half(a) + half(b) - 1e-9;
            assert!(
                d[0] >= clear || d[1] >= clear,
                "{} and {} pass into each other",
                a.id,
                b.id
            );
        }
    }
    let mut reversed = doc.clone();
    let items: Vec<(String, Value)> = doc["items"]
        .as_object()
        .unwrap()
        .iter()
        .rev()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    reversed["items"] = Value::Object(items.into_iter().collect());
    assert_eq!(
        elements_at(&reversed, 0, "shrubs", None).unwrap().unwrap(),
        rows
    );
    // A rest with nothing under it reports no support and leaves its owner where it was.
    let mut lost = doc.clone();
    lost["items"]["vase"]["at"]["pos"] = serde_json::json!([4.0, 2.0, 4.0]);
    let (rested, problems) = rested_at(&lost, 0, Rests::All).unwrap();
    assert!(rested.is_empty());
    assert_eq!(
        problems,
        vec![Refused {
            code: "no_support",
            path: "constraints/rest".into()
        }]
    );
    // On a collection it rests on the first surface of any member; on the ground, on y 0.
    lost["collections"] = serde_json::json!({"floor": {"members": ["ground", "table"]}});
    lost["constraints"]["rest"]["on"] = serde_json::json!("floor");
    assert_eq!(
        rested_at(&lost, 0, Rests::All).unwrap().0["vase"].0,
        [4.0, 0.0, 4.0]
    );
    lost["constraints"]["rest"]["on"] = serde_json::json!("ground");
    lost["constraints"]["rest"]["offset"] = serde_json::json!(0.25);
    assert_eq!(
        rested_at(&lost, 0, Rests::All).unwrap().0["vase"].0,
        [4.0, 0.25, 4.0]
    );
    // In an assembly turned a quarter about +Z (#504), down is the owner's own −x: a box
    // written at the world's (0.2, 2, 0.1) rests on the table's top, 0.1 m under its centre.
    let mut turned = doc.clone();
    turned["assemblies"] = serde_json::json!({"tray": {"at": {"rot": [0, 0, 90]}}});
    turned["items"]["vase"] = serde_json::json!({"id": "vase", "kind": "mark.box@1", "name": "Vase", "order": "a3",
        "parent": "tray", "params": {"size": [0.2, 0.3, 0.2]}, "at": {"pos": [2.0, -0.2, 0.1]}});
    let at = rested_at(&turned, 0, Rests::All).unwrap().0["vase"].0;
    assert!(
        (at[0] - 0.85).abs() < 1e-6 && (at[1] + 0.2).abs() < 1e-6 && (at[2] - 0.1).abs() < 1e-6,
        "{at:?}"
    );
    // A channel on the owner's position is refused as a second writer, naming both.
    lost["channels"] = serde_json::json!({"lift": {"target": "items/vase/at/pos/1", "type": "f32",
        "keys": {"k0": {"t": "0s", "value": 2, "interp": "linear"}, "k1": {"t": "1s", "value": 3, "interp": "linear"}}}});
    let refusal = rested_at(&lost, 0, Rests::All).unwrap_err();
    assert_eq!(
        (refusal.code, refusal.path.as_str()),
        ("second_writer", "channels/lift and constraints/rest")
    );
}
use serde_json::json;

/// #1653: a 2D paint's bevel or shade on a 3D item is refused, naming the field; the
/// builders' own `bevel` and `shade` params are not paint and draw.
#[test]
fn a_bevel_or_a_shade_on_a_3d_item_is_refused() {
    let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
        .expect("the look reads");
    let doc = |paint: Value| {
        json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64],
            "camera": "cam", "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 20], "fov": 40}},
                "b": {"id": "b", "kind": "mark.box@1", "layer": "main", "name": "B", "order": "a1",
                    "params": {"size": [1, 1, 1], "paint": paint}},
            }
        })
    };
    let fill = json!({"role": "block"});
    for field in ["bevel", "shade"] {
        let mut paint = json!({"fill": fill});
        paint[field] = json!({"size": 4});
        let refused = evaluate(&doc(paint), 0, &look, &mut Labels::new()).expect_err("refused");
        assert_eq!(
            (refused.code, refused.path.as_str()),
            (
                "paint_2d_only",
                format!("items/b/params/paint/{field}").as_str()
            )
        );
    }
    assert!(evaluate(&doc(json!({"fill": fill})), 0, &look, &mut Labels::new()).is_ok());
}

#[test]
fn a_child_box_rides_its_parent_once() {
    let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
        .expect("the look reads");
    let solid = |id: &str, pos: [f64; 3]| {
        json!({"id": id, "kind": "mark.box@1", "layer": "main", "name": id, "order": "a1",
            "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "block"}}}, "at": {"pos": pos}})
    };
    let mut child = solid("child", [1.0, 0.0, 0.0]);
    child["parent"] = json!("parent");
    let doc = json!({
        "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64],
        "camera": "cam", "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 20], "fov": 40}},
            "parent": solid("parent", [5.0, 0.0, 0.0]),
            "child": child,
        }
    });
    let child_at = |doc: &Value| {
        let scene = evaluate(doc, 0, &look, &mut Labels::new()).expect("the scene evaluates");
        let placed = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .find(|s| s.id == "child")
            .expect("the child is drawn")
            .model;
        origin(&placed)
    };
    // Adding the parent twice puts the child at x = 11.
    assert_eq!(child_at(&doc), [6.0, 0.0, 0.0]);
    // A parent turned a quarter about y carries the child's offset round with it, in 3D:
    // the child is 1 m from the parent along z, not along x as a turn about z alone leaves it.
    let mut turned = doc.clone();
    turned["items"]["parent"]["at"]["rot"] = json!([0, 90, 0]);
    let [x, y, z] = child_at(&turned);
    assert!(
        (x - 5.0).abs() < 1e-9 && y.abs() < 1e-9 && (z.abs() - 1.0).abs() < 1e-9,
        "the child at {:?}",
        [x, y, z]
    );
}
