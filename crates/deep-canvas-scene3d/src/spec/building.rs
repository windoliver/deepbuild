use super::*;

/// One of the building module's kinds (Building module), built alone.
fn of_building(kind: &str) -> Option<Spec> {
    let wall = |a: [f64; 2], b: [f64; 2]| {
        item(
            "arch.wall@1",
            json!({"a": a, "b": b, "thickness": 0.2, "height": 2.7, "justify": "center", "outside": "left", "cut_height": 1.2}),
        )
    };
    let walls = json!({"w": wall([0.0, 0.0], [4.0, 0.0]), "w2": wall([4.0, 0.0], [4.0, 3.0])});
    let with = |extra: Value| {
        let mut m: Map<String, Value> = walls.as_object().cloned().unwrap_or_default();
        m.extend(extra.as_object().cloned().unwrap_or_default());
        Value::Object(m)
    };
    let rect = json!([[-1, -1], [9, -1], [9, 7], [-1, 7]]);
    Some(match kind {
        "arch.wall@1" => Spec {
            kind: "arch.wall@1",
            module: "building",
            params: vec![
                p(
                    "a",
                    "[m, m]",
                    "m",
                    Value::Null,
                    G,
                    json!([0, 0]),
                    json!([0, 0.5]),
                ),
                p(
                    "b",
                    "[m, m]",
                    "m",
                    Value::Null,
                    G,
                    json!([4, 0]),
                    json!([4, 1]),
                ),
                ranged(
                    p("thickness", "m", "m", json!(0.2), G, json!(0.2), json!(0.3)),
                    0.0,
                    10.0,
                ),
                ranged(
                    p("height", "m", "m", json!(2.7), G, json!(2.7), json!(3)),
                    0.0,
                    1000.0,
                ),
                p(
                    "justify",
                    "center | left | right",
                    "",
                    json!("center"),
                    G,
                    json!("center"),
                    json!("left"),
                ),
                p(
                    "outside",
                    "left | right | none",
                    "",
                    json!("none"),
                    G,
                    json!("left"),
                    json!("right"),
                ),
                ranged(
                    p("cut_height", "m", "m", json!(1.2), G, json!(1.2), json!(1)),
                    0.0,
                    1000.0,
                ),
                paint(),
            ],
            reads: Some(&["siblings", "children"]),
            fixture: json!({"it": wall([0.0, 0.0], [4.0, 0.0]), "w2": wall([4.0, 0.0], [4.0, 3.0])}),
        },
        "arch.opening@1" => Spec {
            kind: "arch.opening@1",
            module: "building",
            params: vec![
                p(
                    "wall",
                    "wall ID",
                    "",
                    Value::Null,
                    G,
                    json!("w"),
                    json!("w2"),
                ),
                p(
                    "type",
                    "door | window",
                    "",
                    json!("door"),
                    G,
                    json!("door"),
                    json!("window"),
                ),
                ranged(
                    p("at_along", "m", "m", json!(0), G, json!(1), json!(1.5)),
                    0.0,
                    1000.0,
                ),
                ranged(
                    p("width", "m", "m", json!(0.9), G, json!(0.9), json!(1)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("height", "m", "m", json!(2.1), G, json!(2.1), json!(1.5)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("sill", "m", "m", json!(0), G, json!(0), json!(0.5)),
                    0.0,
                    100.0,
                ),
                p(
                    "swing",
                    "in | out",
                    "",
                    json!("in"),
                    G,
                    json!("in"),
                    json!("out"),
                ),
                p(
                    "hinge",
                    "left | right",
                    "",
                    json!("left"),
                    G,
                    json!("left"),
                    json!("right"),
                ),
                ranged(
                    p("open", "0..1", "", json!(0), G, json!(0), json!(0.5)),
                    0.0,
                    1.0,
                ),
                paint(),
            ],
            reads: Some(&["refs"]),
            fixture: with(
                json!({"it": {"kind": "arch.opening@1", "parent": "w", "params": {"wall": "w", "type": "door", "at_along": 1, "width": 0.9, "height": 2.1, "sill": 0}}}),
            ),
        },
        "arch.slab@1" => Spec {
            kind: "arch.slab@1",
            module: "building",
            params: vec![
                p(
                    "outline",
                    "polygon",
                    "m",
                    Value::Null,
                    G,
                    rect.clone(),
                    json!([[-1, -1], [8, -1], [8, 7], [-1, 7]]),
                ),
                p(
                    "holes",
                    "[polygon | item ID]",
                    "m",
                    json!([]),
                    G,
                    json!([]),
                    json!([[[1, 1], [2, 1], [2, 2], [1, 2]]]),
                ),
                ranged(
                    p(
                        "thickness",
                        "m",
                        "m",
                        json!(0.2),
                        G,
                        json!(0.2),
                        json!(0.25),
                    ),
                    0.0,
                    100.0,
                ),
                paint(),
            ],
            reads: Some(&["refs"]),
            fixture: json!({"it": item("arch.slab@1", json!({"outline": rect, "thickness": 0.2}))}),
        },
        "arch.roof@1" => Spec {
            kind: "arch.roof@1",
            module: "building",
            params: vec![
                p(
                    "type",
                    "gable | hip | shed | flat | mansard | gambrel | dutch | conical",
                    "",
                    json!("gable"),
                    G,
                    json!("gable"),
                    json!("hip"),
                ),
                p(
                    "size",
                    "[m, m]",
                    "m",
                    Value::Null,
                    G,
                    json!([4.4, 3.4]),
                    json!([5, 3]),
                ),
                ranged(
                    p("pitch", "deg", "deg", json!(30), G, json!(30), json!(40)),
                    0.0,
                    89.0,
                ),
                ranged(
                    p("overhang", "m", "m", json!(0), G, json!(0.2), json!(0.3)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("parapet", "m", "m", json!(0), G, json!(0), json!(0.3)),
                    0.0,
                    100.0,
                ),
                paint(),
            ],
            reads: Some(&[]),
            fixture: json!({"it": item("arch.roof@1", json!({"type": "gable", "size": [4.4, 3.4], "pitch": 30, "overhang": 0.2}))}),
        },
        "arch.stair@1" => Spec {
            kind: "arch.stair@1",
            module: "building",
            params: vec![
                p(
                    "type",
                    "straight | l | u | spiral",
                    "",
                    json!("straight"),
                    G,
                    json!("straight"),
                    json!("l"),
                ),
                ranged(
                    p("rise", "m", "m", json!(2.7), G, json!(2.6), json!(3)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("width", "m", "m", json!(0.9), G, json!(0.9), json!(1)),
                    0.0,
                    100.0,
                ),
                p(
                    "turn",
                    "left | right",
                    "",
                    json!("left"),
                    G,
                    json!("left"),
                    json!("right"),
                ),
                ranged(
                    p("split", "u16", "", json!(0), G, json!(0), json!(6)),
                    0.0,
                    1000.0,
                ),
                p(
                    "rails",
                    "none | left | right | both",
                    "",
                    json!("none"),
                    G,
                    json!("none"),
                    json!("both"),
                ),
                paint(),
            ],
            reads: Some(&[]),
            fixture: json!({"it": item("arch.stair@1", json!({"type": "straight", "rise": 2.6, "width": 0.9}))}),
        },
        "arch.zone@1" => Spec {
            kind: "arch.zone@1",
            module: "building",
            params: vec![
                p(
                    "outline",
                    "polygon",
                    "m",
                    Value::Null,
                    G,
                    rect.clone(),
                    json!([[-1, -1], [8, -1], [8, 7], [-1, 7]]),
                ),
                p(
                    "holes",
                    "[polygon | item ID]",
                    "m",
                    json!([]),
                    G,
                    json!([]),
                    json!([[[1, 1], [2, 1], [2, 2], [1, 2]]]),
                ),
                p(
                    "name",
                    "text",
                    "",
                    json!(""),
                    "text",
                    json!("Room"),
                    json!("Hall"),
                ),
                p(
                    "floor",
                    "level ID",
                    "",
                    Value::Null,
                    G,
                    json!("l1"),
                    json!("l2"),
                ),
            ],
            reads: Some(&["refs"]),
            fixture: json!({
                "l1": item("arch.level@1", json!({"elevation": 0, "height": 2.7})),
                "l2": item("arch.level@1", json!({"elevation": 3, "height": 2.7})),
                "it": item("arch.zone@1", json!({"outline": rect, "name": "Room", "floor": "l1"})),
            }),
        },
        "arch.level@1" => Spec {
            kind: "arch.level@1",
            module: "building",
            params: vec![
                p("elevation", "m", "m", json!(0), G, json!(0), json!(3)),
                ranged(
                    p("height", "m", "m", json!(2.7), G, json!(2.7), json!(3)),
                    0.0,
                    1000.0,
                ),
            ],
            reads: Some(&[]),
            fixture: json!({"it": item("arch.level@1", json!({"elevation": 0, "height": 2.7}))}),
        },
        "arch.guard_rail@1" => Spec {
            kind: "arch.guard_rail@1",
            module: "building",
            params: vec![
                p(
                    "around",
                    "item ID",
                    "",
                    Value::Null,
                    G,
                    json!("deck"),
                    json!("deck2"),
                ),
                p(
                    "except",
                    "[edge index]",
                    "",
                    json!([]),
                    G,
                    json!([]),
                    json!([0]),
                ),
                p(
                    "skip_along_walls",
                    "bool",
                    "",
                    json!(false),
                    G,
                    json!(false),
                    json!(true),
                ),
                paint(),
            ],
            reads: Some(&["refs", "siblings"]),
            fixture: with(json!({
                "deck": item("arch.slab@1", json!({"outline": [[0, 0], [4, 0], [4, 3], [0, 3]], "thickness": 0.2})),
                "deck2": item("arch.slab@1", json!({"outline": [[0, 0], [5, 0], [5, 3], [0, 3]], "thickness": 0.2})),
                "it": item("arch.guard_rail@1", json!({"around": "deck"})),
            })),
        },
        _ => return None,
    })
}

/// The building module's kinds' schemas.
pub fn building() -> Vec<Spec> {
    crate::building::KINDS
        .iter()
        .filter_map(|k| of_building(k))
        .collect()
}

/// A spec's entry for the registry: every param of JSON type, which the kind's reader checks.
pub fn entry(spec: &Spec, family: &'static str, name: &'static str) -> Entry {
    Entry {
        family,
        name,
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: spec
                .params
                .iter()
                .map(|q| Param {
                    name: q.name,
                    ty: ParamType::Json(q.declared()),
                    unit: q.unit,
                    default: q.default.clone(),
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                })
                .collect(),
        }],
        migrations: Vec::new(),
    }
}

/// Every spec, scene3d's then the building module's.
pub fn all() -> Vec<Spec> {
    let mut out = scene3d();
    out.extend(building());
    out
}

/// The spec of `kind`.
pub fn of(kind: &str) -> Option<Spec> {
    of_scene3d(kind).or_else(|| of_building(kind))
}
