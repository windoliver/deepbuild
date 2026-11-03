//! The schemas of scene3d's and the building module's kinds (Item and kind: `schema`; issue
//! #420): every param with its type, unit, default, range, whether a channel may drive it, its
//! cost class and its dirty class, the paths a node of each class keys on, and for each kind a
//! fixture and two valid values per path, so a sweep can hold every path's incremental frame to
//! a clean rebuild.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use serde_json::{json, Map, Value};

/// One param: its schema and the two values a sweep sets it to.
pub struct P {
    pub name: &'static str,
    /// What its value is, as the `kinds` call names it.
    pub ty: &'static str,
    pub unit: &'static str,
    pub default: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Its dirty class (Dirty classes): `geometry` rebuilds, the rest reshade.
    pub class: &'static str,
    pub sweep: (Value, Value),
}

/// A kind's schema, with the reads a building kind declares and the fixture its sweep runs on.
pub struct Spec {
    pub kind: &'static str,
    pub module: &'static str,
    pub params: Vec<P>,
    pub reads: Option<&'static [&'static str]>,
    /// The fixture's other items, beside its camera, and the item itself.
    pub fixture: Value,
}

fn p(
    name: &'static str,
    ty: &'static str,
    unit: &'static str,
    default: Value,
    class: &'static str,
    from: Value,
    to: Value,
) -> P {
    P {
        name,
        ty,
        unit,
        default,
        min: None,
        max: None,
        class,
        sweep: (from, to),
    }
}

fn ranged(mut p: P, min: f64, max: f64) -> P {
    p.min = Some(min);
    p.max = Some(max);
    p
}

const G: &str = "geometry";
const S: &str = "shading";

fn paint() -> P {
    p(
        "paint",
        "paint",
        "",
        Value::Null,
        S,
        json!({"fill": {"role": "accent"}}),
        json!({"fill": {"role": "muted"}}),
    )
}

fn shade() -> P {
    p(
        "shade",
        "smooth | flat",
        "",
        json!("smooth"),
        G,
        json!("smooth"),
        json!("flat"),
    )
}

/// Every mark in 3D's common fields (Marks in 3D: common fields).
fn common(mut params: Vec<P>) -> Vec<P> {
    params.push(p(
        "size_space",
        "screen | world",
        "",
        json!("screen"),
        G,
        json!("screen"),
        json!("world"),
    ));
    params.push(paint());
    params.push(p(
        "status",
        "status binding",
        "",
        Value::Null,
        S,
        json!({"binding": "build"}),
        json!({"binding": "ship"}),
    ));
    params.push(p(
        "open",
        "level of detail",
        "",
        Value::Null,
        S,
        json!({"at_px": 600, "doc": "01JB420D0000000000000000090"}),
        json!({"at_px": 400, "doc": "01JB420D0000000000000000090"}),
    ));
    params
}

fn item(kind: &str, params: Value) -> Value {
    json!({"kind": kind, "params": params})
}

/// One of scene3d's kinds: the marks in 3D, the key light, the builders and the curve; each
/// built alone, so a key or a node reads one kind's schema without making the rest.
fn of_scene3d(kind: &str) -> Option<Spec> {
    if kind == "mesh.asset@1" {
        return Some(mesh_asset());
    }
    let mut spec = base_scene3d(kind)?;
    spec.params.extend(extras(kind));
    if crate::builders::KINDS.contains(&kind) {
        spec.params.push(p(
            "scatter",
            "{count, part?}",
            "",
            Value::Null,
            G,
            json!({"count": 8}),
            json!({"count": 16}),
        ));
    }
    Some(spec)
}

/// The builder params beyond each kind's first ones (Builder: the ten trusted builders).
fn extras(kind: &str) -> Vec<P> {
    match kind {
        "slab@1" => vec![
            ranged(
                p("bevel", "m", "m", json!(0), G, json!(0), json!(0.05)),
                0.0,
                100.0,
            ),
            p(
                "groove",
                "{depth, width}",
                "m",
                Value::Null,
                G,
                json!({"depth": 0.05, "width": 0.2}),
                json!({"depth": 0.08, "width": 0.3}),
            ),
            p(
                "along",
                "{path, from, to}",
                "",
                Value::Null,
                G,
                json!({"path": [[0, 0, 0], [2, 0, 0]]}),
                json!({"path": [[0, 0, 0], [2, 0, 1]], "from": 0.25}),
            ),
        ],
        "lathe@1" => vec![
            p(
                "ribs",
                "{count, depth, span}",
                "m",
                Value::Null,
                G,
                json!({"count": 8, "depth": 0.02, "span": 0.5}),
                json!({"count": 6, "depth": 0.03, "span": 0.25}),
            ),
            p(
                "bands",
                "[{y0, y1, material}]",
                "m",
                json!([]),
                G,
                json!([]),
                json!([{"y0": 0, "y1": 0.5, "material": "wood"}]),
            ),
            p(
                "thread",
                "{pitch, depth}",
                "m",
                Value::Null,
                G,
                json!({"pitch": 0.1, "depth": 0.01}),
                json!({"pitch": 0.2, "depth": 0.02}),
            ),
            p(
                "rim",
                "polygon",
                "",
                Value::Null,
                G,
                json!([[1, 0], [0, 1], [-1, 0], [0, -1]]),
                json!([[1, 0], [0.3, 0.95], [-0.8, 0.6], [-0.8, -0.6], [0.3, -0.95]]),
            ),
        ],
        "extrude@1" => vec![ranged(
            p("bevel", "m", "m", json!(0), G, json!(0), json!(0.05)),
            0.0,
            100.0,
        )],
        "tube@1" => vec![ranged(
            p("bend", "m", "m", json!(0), G, json!(0), json!(0.2)),
            0.0,
            100.0,
        )],
        "plate@1" => vec![p(
            "height",
            "field, m",
            "m",
            Value::Null,
            G,
            json!(0),
            json!({"wave": {"amplitude": 0.1, "wavelength": 1}}),
        )],
        _ => Vec::new(),
    }
}

/// `mesh.asset@1 {sha256 (glTF), node}`: a glTF node's mesh from the asset store, one mesh for
/// every item naming the same asset and node.
fn mesh_asset() -> Spec {
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    Spec {
        kind: "mesh.asset@1",
        module: "scene3d",
        params: vec![
            p("sha256", "sha256", "", Value::Null, G, json!(a), json!(b)),
            p("node", "index | name", "", json!(0), G, json!(0), json!(1)),
            shade(),
            paint(),
        ],
        reads: None,
        fixture: json!({"it": item("mesh.asset@1", json!({"sha256": a, "node": 0, "paint": {"fill": {"role": "accent"}}}))}),
    }
}

/// One of scene3d's kinds as its schema first lists it.
fn base_scene3d(kind: &str) -> Option<Spec> {
    let solid = |kind: &'static str| Spec {
        kind,
        module: "scene3d",
        params: common(vec![p(
            "size",
            "vec3",
            "m",
            json!([1, 1, 1]),
            G,
            json!([1, 1, 1]),
            json!([1, 2, 1]),
        )]),
        reads: None,
        fixture: json!({"it": item(kind, json!({"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}))}),
    };
    let line = || Spec {
        kind: "mark.line@1",
        module: "scene3d",
        params: common(vec![
            p(
                "points",
                "points | item IDs",
                "m",
                Value::Null,
                G,
                json!([[0, 0, 0], [1, 1, 0]]),
                json!([[0, 0, 0], [1, 2, 0]]),
            ),
            p(
                "edges",
                "{of, kind}",
                "",
                Value::Null,
                G,
                json!(null),
                json!(null),
            ),
            p(
                "mode",
                "strip | segments | loop",
                "",
                json!("strip"),
                G,
                json!("strip"),
                json!("segments"),
            ),
            p("width", "px | [px]", "px", json!(1), S, json!(2), json!(3)),
            p(
                "dash",
                "[px]",
                "px",
                Value::Null,
                S,
                json!([4, 2]),
                json!([6, 2]),
            ),
            p(
                "ends",
                "{start, end}",
                "",
                Value::Null,
                S,
                json!({"end": "arrow"}),
                json!({"start": "arrow"}),
            ),
            p(
                "cap",
                "butt | round | square",
                "",
                json!("butt"),
                S,
                json!("butt"),
                json!("round"),
            ),
            p(
                "join",
                "miter | round | bevel",
                "",
                json!("miter"),
                S,
                json!("miter"),
                json!("round"),
            ),
        ]),
        reads: None,
        fixture: json!({"it": item("mark.line@1", json!({"points": [[0, 0, 0], [1, 1, 0]], "width": 2, "paint": {"fill": {"role": "ink"}}}))}),
    };
    let edged = || {
        let mut line = line();
        // A line drawing its mesh's edges reads the solid it names.
        line.params[1].sweep = (
            json!({"of": "cube", "kind": "quads"}),
            json!({"of": "cube", "kind": "all"}),
        );
        line.fixture = json!({
            "cube": item("slab@1", json!({"size": [1, 1, 1], "paint": {"fill": {"role": "muted"}}})),
            "it": item("mark.line@1", json!({"points": [[0, 0, 0], [1, 1, 0]], "width": 2, "paint": {"fill": {"role": "ink"}}})),
        });
        line
    };
    let point = || Spec {
        kind: "mark.point@1",
        module: "scene3d",
        params: common(vec![
            p("size", "px", "px", json!(4), G, json!(4), json!(6)),
            p(
                "shape",
                "dot | square | diamond",
                "",
                json!("dot"),
                S,
                json!("dot"),
                json!("square"),
            ),
        ]),
        reads: None,
        fixture: json!({"it": item("mark.point@1", json!({"size": 4, "paint": {"fill": {"role": "ink"}}}))}),
    };
    let text = || Spec {
        kind: "mark.text@1",
        module: "scene3d",
        params: common(vec![
            p(
                "text",
                "text",
                "",
                json!(""),
                "text",
                json!("Block"),
                json!("Drum"),
            ),
            p(
                "font",
                "role",
                "",
                json!("body"),
                "text",
                json!("body"),
                json!("title"),
            ),
            p("size", "px | m", "px", Value::Null, G, json!(13), json!(15)),
            p(
                "facing",
                "camera | upright | fixed",
                "",
                json!("camera"),
                G,
                json!("camera"),
                json!("upright"),
            ),
        ]),
        reads: None,
        fixture: json!({"it": item("mark.text@1", json!({"text": "Block", "size": 13, "paint": {"fill": {"role": "ink"}}}))}),
    };
    let sun = || Spec {
        kind: "light.sun@1",
        module: "scene3d",
        params: vec![
            p(
                "illuminance",
                "lux",
                "lx",
                json!(10_000),
                S,
                json!(10_000),
                json!(20_000),
            ),
            p(
                "shadow",
                "bool",
                "",
                json!(false),
                S,
                json!(false),
                json!(true),
            ),
            p(
                "angle",
                "deg",
                "deg",
                json!(0.53),
                S,
                json!(0.53),
                json!(1.0),
            ),
            p(
                "color",
                "color",
                "",
                Value::Null,
                S,
                json!([255, 244, 230]),
                json!([230, 240, 255]),
            ),
            p("priority", "integer", "", json!(0), S, json!(0), json!(1)),
        ],
        reads: None,
        fixture: json!({"it": item("light.sun@1", json!({"illuminance": 10_000}))}),
    };
    let rect = json!([[0, 0], [2, 0], [2, 1], [0, 1]]);
    Some(match kind {
        "mark.box@1" | "mark.cylinder@1" | "mark.sphere@1" => {
            solid(SCENE3D.iter().find(|k| **k == kind)?)
        }
        "mark.line@1" => edged(),
        "mark.point@1" => point(),
        "mark.text@1" => text(),
        "light.sun@1" => sun(),
        "slab@1" => Spec {
            kind: "slab@1",
            module: "scene3d",
            params: vec![
                p(
                    "size",
                    "vec3",
                    "m",
                    Value::Null,
                    G,
                    json!([1, 1, 1]),
                    json!([2, 1, 1]),
                ),
                p(
                    "outline",
                    "polygon",
                    "m",
                    Value::Null,
                    G,
                    rect.clone(),
                    json!([[0, 0], [3, 0], [3, 1], [0, 1]]),
                ),
                ranged(
                    p("thickness", "m", "m", json!(0.2), G, json!(0.2), json!(0.3)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("radius", "m", "m", json!(0), G, json!(0), json!(0.1)),
                    0.0,
                    100.0,
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("slab@1", json!({"size": [2, 0.2, 1], "paint": {"fill": {"role": "accent"}}}))}),
        },
        "lathe@1" => Spec {
            kind: "lathe@1",
            module: "scene3d",
            params: vec![
                p(
                    "outline",
                    "[[r, y, smooth]]",
                    "m",
                    Value::Null,
                    G,
                    json!([[0.4, 0, false], [0.5, 0.5, true], [0.3, 1, false]]),
                    json!([[0.4, 0, false], [0.6, 0.5, true], [0.3, 1, false]]),
                ),
                p(
                    "axis",
                    "x | y | z",
                    "",
                    json!("y"),
                    G,
                    json!("y"),
                    json!("x"),
                ),
                ranged(
                    p("segments", "u16", "", json!(32), G, json!(16), json!(12)),
                    3.0,
                    1024.0,
                ),
                ranged(
                    p("sweep", "deg", "deg", json!(360), G, json!(360), json!(180)),
                    0.0,
                    360.0,
                ),
                p(
                    "caps",
                    "none | flat | cut",
                    "",
                    json!("flat"),
                    G,
                    json!("flat"),
                    json!("none"),
                ),
                p(
                    "closed",
                    "bool",
                    "",
                    json!(false),
                    G,
                    json!(false),
                    json!(true),
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("lathe@1", json!({"outline": [[0.4, 0, false], [0.5, 0.5, true], [0.3, 1, false]], "segments": 16, "paint": {"fill": {"role": "accent"}}}))}),
        },
        "extrude@1" => Spec {
            kind: "extrude@1",
            module: "scene3d",
            params: vec![
                p(
                    "outline",
                    "polygon",
                    "m",
                    Value::Null,
                    G,
                    rect.clone(),
                    json!([[0, 0], [3, 0], [3, 1], [0, 1]]),
                ),
                p(
                    "holes",
                    "[polygon]",
                    "m",
                    json!([]),
                    G,
                    json!([]),
                    json!([[[0.5, 0.25], [1.5, 0.25], [1.5, 0.75], [0.5, 0.75]]]),
                ),
                ranged(
                    p("depth", "m", "m", json!(0.1), G, json!(0.5), json!(0.6)),
                    0.0,
                    1000.0,
                ),
                p("twist", "deg", "deg", json!(0), G, json!(0), json!(30)),
                p(
                    "along",
                    "{curve: ID, range, scale, rings}",
                    "",
                    Value::Null,
                    G,
                    json!({"curve": "rail", "rings": 4}),
                    json!({"curve": "rail", "rings": 6}),
                ),
                p(
                    "caps",
                    "none | flat",
                    "",
                    json!("flat"),
                    G,
                    json!("flat"),
                    json!("none"),
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({
                "rail": item("curve@1", json!({"points": [[0, 0, 0], [1, 0, 0], [1, 0, 1]], "mode": "linear"})),
                "it": item("extrude@1", json!({"outline": rect, "depth": 0.5, "paint": {"fill": {"role": "accent"}}}))
            }),
        },
        "tube@1" => Spec {
            kind: "tube@1",
            module: "scene3d",
            params: vec![
                p(
                    "path",
                    "points | curve ID",
                    "m",
                    Value::Null,
                    G,
                    json!([[0, 0, 0], [0, 1, 0]]),
                    json!("rail"),
                ),
                ranged(
                    p("radius", "m", "m", json!(0.05), G, json!(0.05), json!(0.08)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("segments", "u16", "", json!(16), G, json!(16), json!(8)),
                    3.0,
                    512.0,
                ),
                p(
                    "twist",
                    "minimum | z_up",
                    "",
                    json!("minimum"),
                    G,
                    json!("minimum"),
                    json!("z_up"),
                ),
                p(
                    "caps",
                    "none | flat | round",
                    "",
                    json!("flat"),
                    G,
                    json!("flat"),
                    json!("round"),
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({
                "rail": item("curve@1", json!({"points": [[0, 0, 0], [0.5, 1, 0], [1, 1, 0.5]], "mode": "catmull_rom"})),
                "it": item("tube@1", json!({"path": [[0, 0, 0], [0, 1, 0]], "radius": 0.05, "paint": {"fill": {"role": "accent"}}})),
            }),
        },
        "ball@1" => Spec {
            kind: "ball@1",
            module: "scene3d",
            params: vec![
                ranged(
                    p("radius", "m", "m", json!(0.5), G, json!(0.5), json!(0.6)),
                    0.0,
                    1000.0,
                ),
                ranged(
                    p("segments", "u16", "", json!(32), G, json!(16), json!(12)),
                    4.0,
                    1024.0,
                ),
                p(
                    "tessellation",
                    "uv | geodesic",
                    "",
                    json!("uv"),
                    G,
                    json!("uv"),
                    json!("geodesic"),
                ),
                p(
                    "base",
                    "octa | icosa",
                    "",
                    json!("icosa"),
                    G,
                    json!("icosa"),
                    json!("octa"),
                ),
                ranged(
                    p("detail", "u8", "", json!(1), G, json!(1), json!(2)),
                    0.0,
                    6.0,
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("ball@1", json!({"radius": 0.5, "segments": 16, "paint": {"fill": {"role": "accent"}}}))}),
        },
        "coil@1" => Spec {
            kind: "coil@1",
            module: "scene3d",
            params: vec![
                ranged(
                    p("radius", "m", "m", json!(0.2), G, json!(0.2), json!(0.3)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("pitch", "m", "m", json!(0.05), G, json!(0.05), json!(0.08)),
                    0.0,
                    100.0,
                ),
                ranged(
                    p("wire", "m", "m", json!(0.01), G, json!(0.01), json!(0.02)),
                    0.0,
                    10.0,
                ),
                ranged(
                    p("turns", "f32", "", json!(5), G, json!(3), json!(4)),
                    0.0,
                    1000.0,
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("coil@1", json!({"radius": 0.2, "pitch": 0.05, "wire": 0.01, "turns": 3, "paint": {"fill": {"role": "accent"}}}))}),
        },
        "plate@1" => Spec {
            kind: "plate@1",
            module: "scene3d",
            params: vec![
                p(
                    "outline",
                    "polygon",
                    "m",
                    Value::Null,
                    G,
                    rect.clone(),
                    json!([[0, 0], [3, 0], [3, 1], [0, 1]]),
                ),
                p(
                    "grid",
                    "[u16, u16]",
                    "",
                    Value::Null,
                    G,
                    json!([4, 3]),
                    json!([2, 2]),
                ),
                p(
                    "size",
                    "[m, m]",
                    "m",
                    Value::Null,
                    G,
                    json!([2, 1.5]),
                    json!([3, 1.5]),
                ),
                p(
                    "two_sided",
                    "bool",
                    "",
                    json!(false),
                    G,
                    json!(false),
                    json!(true),
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("plate@1", json!({"grid": [4, 3], "size": [2, 1.5], "paint": {"fill": {"role": "accent"}}}))}),
        },
        "display@1" => Spec {
            kind: "display@1",
            module: "scene3d",
            params: vec![
                p(
                    "size",
                    "[m, m]",
                    "m",
                    Value::Null,
                    G,
                    json!([0.6, 0.4]),
                    json!([0.8, 0.5]),
                ),
                ranged(
                    p("bezel", "m", "m", json!(0.01), G, json!(0.02), json!(0.03)),
                    0.0,
                    10.0,
                ),
                p(
                    "screen",
                    "inset ID",
                    "",
                    Value::Null,
                    S,
                    json!("feed"),
                    json!("feed2"),
                ),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("display@1", json!({"size": [0.6, 0.4], "bezel": 0.02, "screen": "feed", "paint": {"fill": {"role": "ink"}}}))}),
        },
        "curve@1" => Spec {
            kind: "curve@1",
            module: "scene3d",
            params: vec![
                p(
                    "points",
                    "points",
                    "m",
                    Value::Null,
                    G,
                    json!([[0, 0, 0], [1, 1, 0], [2, 0, 0]]),
                    json!([[0, 0, 0], [1, 2, 0], [2, 0, 0]]),
                ),
                p(
                    "ids",
                    "u32 column",
                    "",
                    Value::Null,
                    G,
                    json!([0, 1, 2]),
                    json!([5, 6, 7]),
                ),
                p(
                    "mode",
                    "linear | bezier | catmull_rom | auto | bspline",
                    "",
                    json!("auto"),
                    G,
                    json!("linear"),
                    json!("bspline"),
                ),
                p(
                    "handles",
                    "{in, out: vec3 column}",
                    "m",
                    Value::Null,
                    G,
                    json!({"in": [[0, 0, 0], [-0.2, 0, 0], [0, 0, 0]], "out": [[0.2, 0, 0], [0.2, 0, 0], [0, 0, 0]]}),
                    json!({"in": [[0, 0, 0], [-0.4, 0, 0], [0, 0, 0]], "out": [[0.4, 0, 0], [0.4, 0, 0], [0, 0, 0]]}),
                ),
                ranged(
                    p("alpha", "f32", "", json!(0.5), G, json!(0.5), json!(0.25)),
                    0.0,
                    1.0,
                ),
                p(
                    "closed",
                    "bool",
                    "",
                    json!(false),
                    G,
                    json!(false),
                    json!(true),
                ),
                p(
                    "roll",
                    "f32 column",
                    "deg",
                    json!(0),
                    G,
                    json!(0),
                    json!([0, 10, 0]),
                ),
                p(
                    "frames",
                    "rmf | up",
                    "",
                    json!("rmf"),
                    G,
                    json!("rmf"),
                    json!("up"),
                ),
                p(
                    "up",
                    "vec3",
                    "",
                    json!([0, 1, 0]),
                    G,
                    json!([0, 1, 0]),
                    json!([0, 0, 1]),
                ),
                ranged(
                    p("samples", "u16", "", json!(16), G, json!(16), json!(8)),
                    1.0,
                    1024.0,
                ),
            ],
            reads: None,
            fixture: json!({"it": item("curve@1", json!({"points": [[0, 0, 0], [1, 1, 0], [2, 0, 0]]}))}),
        },
        _ => return None,
    })
}

/// scene3d's kinds, in the order the `kinds` call lists them.
pub const SCENE3D: [&str; 17] = [
    "mark.box@1",
    "mark.cylinder@1",
    "mark.sphere@1",
    "mark.line@1",
    "mark.point@1",
    "mark.text@1",
    "light.sun@1",
    "slab@1",
    "lathe@1",
    "extrude@1",
    "tube@1",
    "ball@1",
    "coil@1",
    "plate@1",
    "display@1",
    "curve@1",
    "mesh.asset@1",
];

/// scene3d's kinds' schemas.
pub fn scene3d() -> Vec<Spec> {
    SCENE3D.iter().filter_map(|k| of_scene3d(k)).collect()
}

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
                    ty: ParamType::Json,
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

/// A kind's dirty map: each param's path to its class. The planted `slab_size_as_shading` maps
/// slab@1's rebuild-class size to shading (AC8's wrong program).
pub fn dirty(spec: &Spec, planted: Option<&str>) -> Vec<(String, &'static str)> {
    spec.params
        .iter()
        .map(|q| {
            let class = if spec.kind == "slab@1"
                && q.name == "size"
                && planted == Some("slab_size_as_shading")
            {
                S
            } else {
                q.class
            };
            (format!("params/{}", q.name), class)
        })
        .collect()
}

/// The params of `item` whose dirty class is (`geometry: true`) or isn't geometry.
pub fn params_of(item: &Value, kind: &str, geometry: bool, planted: Option<&str>) -> Value {
    let Some(spec) = of(kind) else {
        return item.get("params").cloned().unwrap_or(Value::Null);
    };
    let params = item.get("params").and_then(Value::as_object);
    let mut out = Map::new();
    for (path, class) in dirty(&spec, planted) {
        let name = &path["params/".len()..];
        if (class == G) == geometry {
            if let Some(v) = params.and_then(|p| p.get(name)) {
                out.insert(name.to_string(), v.clone());
            }
        }
    }
    Value::Object(out)
}

/// The params resolved: each one the item gives, the schema's default for the rest.
pub fn resolved(spec: &Spec, params: &Value, geometry: bool, planted: Option<&str>) -> Value {
    let mut out = Map::new();
    for ((path, class), q) in dirty(spec, planted).into_iter().zip(&spec.params) {
        if (class == G) != geometry {
            continue;
        }
        let v = params
            .get(&path["params/".len()..])
            .cloned()
            .unwrap_or_else(|| q.default.clone());
        out.insert(q.name.to_string(), v);
    }
    Value::Object(out)
}

/// The `kinds` call's row of a spec.
pub fn row(spec: &Spec, planted: Option<&str>) -> Value {
    let params: Map<String, Value> = spec
        .params
        .iter()
        .map(|q| {
            let mut v = json!({"type": q.ty, "unit": q.unit, "default": q.default,
                               "live": q.ty == "m" || q.ty == "deg" || q.ty == "f32",
                               "cost": if q.class == G { "rebuild" } else { "transform" }});
            if let (Some(min), Some(max)) = (q.min, q.max) {
                v["min"] = json!(min);
                v["max"] = json!(max);
            }
            (q.name.to_string(), v)
        })
        .collect();
    let dirty: Map<String, Value> = dirty(spec, planted)
        .into_iter()
        .map(|(k, c)| (k, json!(c)))
        .collect();
    let sweep: Map<String, Value> = spec
        .params
        .iter()
        .map(|q| (format!("params/{}", q.name), json!([q.sweep.0, q.sweep.1])))
        .collect();
    let mut items = Map::new();
    items.insert(
        "cam".into(),
        json!({"kind": "camera@1", "params": {"projection": "perspective", "position": [6, 5, 8], "target": [0, 0.5, 0], "fov": 40}}),
    );
    if let Some(fx) = spec.fixture.as_object() {
        items.extend(fx.clone());
    }
    for (k, (id, v)) in items.iter_mut().enumerate() {
        v["id"] = json!(id);
        v["name"] = json!(id);
        v["order"] = json!(format!("a{k:03}"));
    }
    let modules = if spec.module == "building" {
        json!({"scene3d": "^1", "building": "^1"})
    } else {
        json!({"scene3d": "^1"})
    };
    let document = json!({
        "format": 1, "profile": "scene", "title": format!("The {} fixture", spec.kind),
        "description": format!("One {} for the sweep of its paths.", spec.kind),
        "size": [480, 360], "camera": "cam", "requires": {"modules": modules}, "items": items,
    });
    let mut out = json!({"kind": spec.kind, "module": spec.module, "params": params, "dirty": dirty,
                         "fixture": {"document": document, "item": "it"}, "sweep": sweep});
    if let Some(reads) = spec.reads {
        out["reads"] = json!(reads);
    }
    out
}
