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

pub(crate) fn p(
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

pub(crate) const G: &str = "geometry";
pub(crate) const S: &str = "shading";

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

/// A light's color as a blackbody temperature, in place of `color` (#421).
fn temperature() -> P {
    ranged(
        p(
            "temperature",
            "K",
            "K",
            Value::Null,
            S,
            json!(6500),
            json!(2700),
        ),
        1000.0,
        40000.0,
    )
}

/// What scales a light's power at t (#421): a gain, or the channel whose value is one.
fn flicker() -> P {
    p(
        "flicker",
        "f32 | channel",
        "",
        json!(1),
        S,
        json!(1),
        json!(0.5),
    )
}

fn shade() -> P {
    p(
        "shade",
        "smooth | flat | by_angle {angle}",
        "",
        json!("smooth"),
        G,
        json!("smooth"),
        json!("flat"),
    )
}

/// Every mark in 3D's common fields (Marks in 3D: common fields).
pub(crate) fn common(mut params: Vec<P>) -> Vec<P> {
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

pub(crate) fn item(kind: &str, params: Value) -> Value {
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
        // Builder: uv, on every builder.
        spec.params.push(p(
            "uv0",
            "natural | box {size} | planar {axis} | cylinder {axis} | sphere",
            "",
            json!("natural"),
            G,
            json!("natural"),
            json!("box"),
        ));
        spec.params.push(ranged(
            p("uv_scale", "m", "m", json!(1), G, json!(1), json!(0.5)),
            0.0,
            1000.0,
        ));
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
        "tube@1" => vec![
            ranged(
                p("bend", "m", "m", json!(0), G, json!(0), json!(0.2)),
                0.0,
                100.0,
            ),
            p(
                "normal",
                "vec3",
                "",
                Value::Null,
                G,
                json!([1, 0, 0]),
                json!([0, 0, 1]),
            ),
        ],
        "plate@1" => vec![
            p(
                "height",
                "field, m",
                "m",
                Value::Null,
                G,
                json!(0),
                json!({"wave": {"amplitude": 0.1, "wavelength": 1}}),
            ),
            // #2014: a terrain plate's height field, size and spacing (Builder plate: terrain).
            p(
                "terrain",
                "terrain",
                "m",
                Value::Null,
                G,
                json!({"height": 0, "size": [4, 4]}),
                json!({"height": "position.x * 0.25", "size": [4, 4], "spacing": 0.5}),
            ),
            // #537: a terrain plate's overlays tint its cover and rebuild nothing (Builder plate: terrain overlays).
            p(
                "overlays",
                "[overlay] ≤ 2",
                "",
                Value::Null,
                S,
                Value::Null,
                json!([]),
            ),
        ],
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
        params: crate::points::params(common(vec![
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
        ])),
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
                "linear RGB",
                "",
                json!([1, 1, 1]),
                S,
                json!([1, 0.95, 0.9]),
                json!([0.9, 0.95, 1]),
            ),
            temperature(),
            p("priority", "integer", "", json!(0), S, json!(0), json!(1)),
            flicker(),
            // Its shadow's cascades (#422; Light policy: cascades).
            p("cascades", "1 to 4", "", json!(3), S, json!(3), json!(4)),
            p("split", "f32", "", json!(0.5), S, json!(0.5), json!(0.75)),
            p(
                "shadow_far",
                "m | auto",
                "m",
                json!("auto"),
                S,
                json!(50),
                json!(80),
            ),
            p(
                "fade",
                "bool",
                "",
                json!(true),
                S,
                json!(true),
                json!(false),
            ),
            // What it lights and what shadows it (#446; Light: receivers, casters).
            p(
                "receivers",
                "collection | [collection] | all",
                "",
                json!("all"),
                S,
                json!("all"),
                json!("all"),
            ),
            p(
                "casters",
                "collection | [collection] | all",
                "",
                json!("all"),
                S,
                json!("all"),
                json!("all"),
            ),
        ],
        reads: None,
        fixture: json!({"it": item("light.sun@1", json!({"illuminance": 10_000}))}),
    };
    // A point, spot or area light (#421): its lumens counted over the whole sphere.
    let local = |kind: &'static str, spot: bool| {
        let mut params = vec![
            p(
                "power",
                "lumens | from_file",
                "lm",
                json!(800),
                S,
                json!(800),
                json!(1600),
            ),
            p("range", "m", "m", json!("auto"), S, json!(10), json!(20)),
            p("radius", "m", "m", json!(0.05), S, json!(0.05), json!(0.2)),
            p(
                "color",
                "color",
                "",
                json!([1, 1, 1]),
                S,
                json!([1, 0.9, 0.8]),
                json!([0.8, 0.9, 1]),
            ),
            temperature(),
            p("priority", "integer", "", json!(0), S, json!(0), json!(1)),
            p(
                "shadow",
                "bool",
                "",
                json!(false),
                S,
                json!(false),
                json!(true),
            ),
            flicker(),
            // #446: Light: receivers, casters, IES distribution.
            p(
                "receivers",
                "collection | [collection] | all",
                "",
                json!("all"),
                S,
                json!("all"),
                json!("all"),
            ),
            p(
                "casters",
                "collection | [collection] | all",
                "",
                json!("all"),
                S,
                json!("all"),
                json!("all"),
            ),
            p(
                "distribution",
                "sha256",
                "",
                Value::Null,
                S,
                Value::Null,
                Value::Null,
            ),
            p(
                "distribution_rotation",
                "deg",
                "deg",
                json!(0),
                S,
                json!(0),
                json!(90),
            ),
        ];
        if kind == "light.area@1" {
            params.push(p(
                "shape",
                "rect | disk",
                "",
                json!("rect"),
                S,
                json!("rect"),
                json!("disk"),
            ));
            params.push(p(
                "size",
                "[m, m]",
                "m",
                json!([0.5, 0.5]),
                S,
                json!([0.5, 0.5]),
                json!([1, 0.25]),
            ));
        }
        if spot {
            params.push(ranged(
                p("inner", "deg", "deg", json!(0), S, json!(0), json!(20)),
                0.0,
                90.0,
            ));
            params.push(ranged(
                p("outer", "deg", "deg", json!(45), S, json!(45), json!(60)),
                0.0,
                90.0,
            ));
        }
        Spec {
            kind,
            module: "scene3d",
            params,
            reads: None,
            fixture: json!({"it": item(kind, json!({"power": 800}))}),
        }
    };
    let unit = |name, default: f64, a: f64, b: f64| {
        ranged(
            p(name, "f32", "", json!(default), S, json!(a), json!(b)),
            0.0,
            1.0,
        )
    };
    let flag = |name| p(name, "bool", "", json!(false), S, json!(false), json!(true));
    let material = || {
        Spec {
        kind: "material@1",
        module: "scene3d",
        params: vec![
            p(
                "base_color",
                "color | role",
                "",
                json!([0.8, 0.8, 0.8, 1]),
                S,
                json!([0.8, 0.8, 0.8, 1]),
                json!([0.6, 0.3, 0.2, 1]),
            ),
            unit("metallic", 0.0, 0.0, 1.0),
            unit("roughness", 0.5, 0.5, 0.2),
            p(
                "specular_level",
                "f32",
                "",
                json!(0.5),
                S,
                json!(0.5),
                json!(0.25),
            ),
            p(
                "specular_color",
                "linear RGB",
                "",
                json!([1, 1, 1]),
                S,
                json!([1, 1, 1]),
                json!([1, 0.8, 0.6]),
            ),
            p(
                "emission",
                "color",
                "",
                json!([0, 0, 0]),
                S,
                json!([0, 0, 0]),
                json!([1, 0.5, 0]),
            ),
            p(
                "emission_strength",
                "f32",
                "",
                json!(1),
                S,
                json!(1),
                json!(2),
            ),
            p("from", "material name", "", Value::Null, S, json!("steel"), json!("glass")),
            unit("alpha", 1.0, 1.0, 0.5),
            p(
                "alpha_mode",
                "opaque | mask | blend | add",
                "",
                json!("opaque"),
                S,
                json!("opaque"),
                json!("blend"),
            ),
            // The alpha a mask part draws from (Material: texture maps, `alpha_cutoff`), which the
            // material already reads; the sweep leaves it unset, since its fixture is opaque.
            p("alpha_cutoff", "f32", "", json!(0.5), S, Value::Null, Value::Null),
            unit("coat", 0.0, 0.0, 1.0),
            unit("coat_roughness", 0.03, 0.03, 0.2),
            // The extra lobes (#428), each off at its zero.
            p("sheen", "{weight, color | base, roughness}", "", Value::Null, S, Value::Null, json!({"weight": 1, "color": [1, 1, 1], "roughness": 0.5})),
            p("anisotropy", "{strength, rotation}", "deg", Value::Null, S, Value::Null, json!({"strength": 0.8, "rotation": 30})),
            p("translucency", "{kind: thin | wrap, amount, color | base, wrap}", "", Value::Null, S, Value::Null, json!({"kind": "wrap", "amount": 1, "wrap": 0.5})),
            unit("transmission", 0.0, 0.0, 1.0),
            p("ior", "f32", "", json!(1.5), S, json!(1.5), json!(1.33)),
            p("absorption", "{thickness, attenuation: {color, distance}}", "m", Value::Null, S, Value::Null, json!({"thickness": 0.02, "attenuation": {"color": [0.5, 0.8, 1], "distance": 0.02}})),
            p("dispersion", "f32", "", json!(0), S, json!(0), json!(1)),
            p("iridescence", "{weight, ior, thickness: nm}", "nm", Value::Null, S, Value::Null, json!({"weight": 1, "ior": 1.3, "thickness": 400})),
            unit("diffuse_roughness", 0.0, 0.0, 1.0),
            unit("retroreflection", 0.0, 0.0, 1.0),
            p("flakes", "{weight, size, tilt, color | base}", "m", Value::Null, S, Value::Null, json!({"weight": 1, "size": 0.001, "tilt": 15})),
            p("subsurface", "{weight, color | base, radius: [m, m, m], thin}", "m", Value::Null, S, Value::Null, json!({"weight": 1, "radius": [0.0036, 0.0014, 0.0007], "thin": true})),
            // #465: the planar part it mirrors in; the sweep leaves it unset, since the fixture
            // holds no planar part.
            p("mirror", "{strength, blur: px, plane: named part}", "px", Value::Null, S, Value::Null, Value::Null),
            // #166: water on a plate's part; the sweep leaves it unset, as it does the mirror.
            p("water", "{waves: wind {speed, direction} | [{direction, length, amplitude, steepness}], ripples: {scale, strength}, rain, absorption: {color, depth}, distort: px, foam: {threshold}, wake: {item, span} | none}", "m", Value::Null, S, Value::Null, Value::Null),
            p(
                "pattern",
                "none | plaster | stone_courses | roof_tiles | wood | rock | grass | cobbles | glass_curtain | concrete | asphalt",
                "",
                json!("none"),
                S,
                json!("none"),
                json!("plaster"),
            ),
            p("pattern_scale", "m", "m", json!(1), S, json!(1), json!(2)),
            p("pattern_seed", "seed", "", Value::Null, S, json!(1), json!(2)),
            p(
                "ink",
                "{role, weight: px}",
                "",
                Value::Null,
                S,
                json!({"role": "accent", "weight": 1}),
                json!({"role": "muted", "weight": 2}),
            ),
            p(
                "shadow",
                "auto | cast | none",
                "",
                json!("auto"),
                S,
                json!("auto"),
                json!("none"),
            ),
            p(
                "catch",
                "none | shadow",
                "",
                json!("none"),
                S,
                json!("none"),
                json!("shadow"),
            ),
            unit("catch_strength", 1.0, 1.0, 0.5),
            flag("unlit"),
            flag("double_sided"),
            // A `gpu.material@1` item whose outputs lay over these per pixel (#429); the sweep
            // leaves it unset, since the fixture holds no operator.
            p("op", "ID", "", Value::Null, S, Value::Null, Value::Null),
        ],
        reads: None,
        fixture: json!({"it": item("material@1", json!({"roughness": 0.4}))}),
    }
    };
    let rect = json!([[0, 0], [2, 0], [2, 1], [0, 1]]);
    Some(match kind {
        "mark.box@1" | "mark.cylinder@1" | "mark.sphere@1" => {
            solid(SCENE3D.iter().find(|k| **k == kind)?)
        }
        "mark.line@1" => edged(),
        "mark.point@1" => crate::cloud::spec(),
        "mark.text@1" => text(),
        "light.sun@1" => sun(),
        "light.point@1" => local("light.point@1", false),
        "light.spot@1" => local("light.spot@1", true),
        "light.area@1" => local("light.area@1", false),
        // #427: a light probe, captured or baked from what it sees; it draws nothing itself.
        "light.probe@1" => Spec {
            kind: "light.probe@1",
            module: "scene3d",
            params: vec![
                p(
                    "type",
                    "reflection | irradiance",
                    "",
                    json!("reflection"),
                    S,
                    json!("reflection"),
                    json!("irradiance"),
                ),
                p(
                    "size",
                    "vec3",
                    "m",
                    json!([4, 3, 4]),
                    S,
                    json!([4, 3, 4]),
                    json!([2, 2, 2]),
                ),
                p(
                    "shape",
                    "box | ellipsoid",
                    "",
                    json!("box"),
                    S,
                    json!("box"),
                    json!("ellipsoid"),
                ),
                ranged(
                    p("falloff", "f32", "", json!(0.2), S, json!(0.2), json!(0.5)),
                    0.0,
                    1.0,
                ),
                p("priority", "i8", "", json!(0), S, json!(0), json!(1)),
            ],
            reads: None,
            fixture: json!({"it": item("light.probe@1", json!({"type": "irradiance"})),
                            "key": item("light.sun@1", json!({"illuminance": 10_000}))}),
        },
        "material@1" => material(),
        // The sky and the soft cloud sprite (#422).
        "sky@1" => Spec {
            kind: "sky@1",
            module: "scene3d",
            params: vec![
                p(
                    "top",
                    "color",
                    "",
                    json!([0, 0, 0, 1]),
                    S,
                    json!([0.2, 0.4, 0.8, 1]),
                    json!([0.1, 0.2, 0.5, 1]),
                ),
                p(
                    "low",
                    "color",
                    "",
                    json!([0, 0, 0, 1]),
                    S,
                    json!([0.8, 0.8, 0.7, 1]),
                    json!([0.9, 0.6, 0.3, 1]),
                ),
                p(
                    "ambient_top",
                    "linear RGB",
                    "",
                    json!([0, 0, 0]),
                    S,
                    json!([0.3, 0.3, 0.4]),
                    json!([0.2, 0.2, 0.3]),
                ),
                p(
                    "ambient_low",
                    "linear RGB",
                    "",
                    json!([0, 0, 0]),
                    S,
                    json!([0.1, 0.1, 0.1]),
                    json!([0.2, 0.1, 0.1]),
                ),
                p(
                    "fog",
                    "color | background",
                    "",
                    json!([0, 0, 0, 1]),
                    S,
                    json!([0.8, 0.8, 0.8, 1]),
                    json!("background"),
                ),
                p(
                    "fog_density",
                    "1/m",
                    "1/m",
                    json!(0),
                    S,
                    json!(0),
                    json!(0.02),
                ),
                p(
                    "fog_curve",
                    "exp | exp2",
                    "",
                    json!("exp2"),
                    S,
                    json!("exp2"),
                    json!("exp"),
                ),
                p(
                    "fog_height",
                    "{top, density}",
                    "",
                    Value::Null,
                    S,
                    json!({"top": 1, "density": 0}),
                    json!({"top": 1, "density": 0.2}),
                ),
                ranged(
                    p("stars", "f32", "", json!(0), S, json!(0), json!(0.5)),
                    0.0,
                    1.0,
                ),
                p(
                    "moon",
                    "{azimuth, elevation, radius}",
                    "deg",
                    Value::Null,
                    S,
                    Value::Null,
                    json!({"azimuth": 30, "elevation": 20, "radius": 1}),
                ),
                p(
                    "sun",
                    "light ID",
                    "",
                    Value::Null,
                    S,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "exposure",
                    "EV100",
                    "",
                    Value::Null,
                    S,
                    Value::Null,
                    json!(12),
                ),
                p(
                    "environment",
                    "{from, intensity, rotation, size, mix}",
                    "",
                    Value::Null,
                    S,
                    Value::Null,
                    json!({"from": "studio"}),
                ),
                p(
                    "background",
                    "auto | sky | environment | video",
                    "",
                    json!("auto"),
                    S,
                    json!("auto"),
                    json!("sky"),
                ),
                ranged(
                    p(
                        "background_blur",
                        "f32",
                        "",
                        json!(0),
                        S,
                        json!(0),
                        json!(0.5),
                    ),
                    0.0,
                    1.0,
                ),
                p(
                    "background_ground",
                    "{height, radius} | none",
                    "m",
                    json!("none"),
                    S,
                    json!("none"),
                    json!("none"),
                ),
            ],
            reads: None,
            fixture: json!({"it": item("sky@1", json!({"top": [0.2, 0.4, 0.8, 1], "low": [0.8, 0.8, 0.7, 1]}))}),
        },
        // #465: an Effect item; scene3d draws `kind: flare` (Effect: flare).
        "effect@1" => Spec {
            kind: "effect@1",
            module: "scene3d",
            params: vec![
                p("kind", "flare", "", json!("flare"), S, json!("flare"), json!("flare")),
                p(
                    "flare",
                    "{from: lights | {emissive: EV100}, ghosts: u8 <= 8, streak: {count: 0 | 2 | 4 | 6, length: ratio, anamorphic}, halo: ratio, starburst: {blades: u8}, intensity, tint: role}",
                    "",
                    Value::Null,
                    S,
                    json!({"from": "lights", "ghosts": 4}),
                    json!({"from": "lights", "ghosts": 6, "halo": 0.05}),
                ),
            ],
            reads: None,
            fixture: json!({"it": item("effect@1", json!({"kind": "flare", "flare": {"from": "lights", "ghosts": 4}}))}),
        },
        // #424: the cutaway and the instancer.
        "cutaway@1" => Spec {
            kind: "cutaway@1",
            module: "scene3d",
            params: vec![
                p(
                    "planes",
                    "[{normal, offset}] ≤ 4",
                    "m",
                    json!([]),
                    S,
                    json!([{"normal": [1, 0, 0], "offset": 0}]),
                    json!([{"normal": [1, 0, 0], "offset": 0.5}]),
                ),
                p(
                    "mode",
                    "union | intersect",
                    "",
                    json!("union"),
                    S,
                    json!("union"),
                    json!("intersect"),
                ),
                p(
                    "applies_to",
                    "collection | all",
                    "",
                    json!("all"),
                    S,
                    json!("all"),
                    json!("all"),
                ),
                p(
                    "cap",
                    "none | role",
                    "",
                    json!("none"),
                    S,
                    json!("none"),
                    json!("muted"),
                ),
                p(
                    "class",
                    "view | document",
                    "",
                    json!("view"),
                    S,
                    json!("view"),
                    json!("document"),
                ),
                p(
                    "shadows",
                    "cut | whole",
                    "",
                    json!("cut"),
                    S,
                    json!("cut"),
                    json!("whole"),
                ),
                p(
                    "cap_light",
                    "auto | lit | flat",
                    "",
                    json!("auto"),
                    S,
                    json!("auto"),
                    json!("flat"),
                ),
            ],
            reads: None,
            fixture: json!({"it": item("cutaway@1", json!({"planes": [{"normal": [1, 0, 0], "offset": 0}]}))}),
        },
        "instance@1" => Spec {
            kind: "instance@1",
            module: "scene3d",
            params: crate::slots::params(vec![
                p(
                    "of",
                    "[ID] ≤ 64",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "proto",
                    "u16 column",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "ids",
                    "u32 column",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "pos",
                    "vec3 column",
                    "m",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "rot",
                    "quat column",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "yaw",
                    "f32 column",
                    "deg",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "scale",
                    "vec3 | f32 column",
                    "",
                    json!(1),
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "attrs",
                    "{name → column}",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                p(
                    "hidden",
                    "u32 column",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                // #2013: its rows from a scatter, in place of written columns.
                p(
                    "from",
                    "{distribute}",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
            ]),
            reads: None,
            fixture: json!({}),
        },
        "puff@1" => Spec {
            kind: "puff@1",
            module: "scene3d",
            params: vec![
                p("radius", "m", "m", json!(1), G, json!(1), json!(2)),
                p("aspect", "f32", "", json!(1.6), G, json!(1.6), json!(2)),
                ranged(
                    p("density", "f32", "", json!(0.5), S, json!(0.5), json!(0.8)),
                    0.0,
                    1.0,
                ),
                p("bright", "f32", "", json!(1), S, json!(1), json!(1.5)),
                p("seed", "integer", "", json!(0), S, json!(0), json!(1)),
                p(
                    "light",
                    "{sun, ambient, phase, shade}",
                    "",
                    Value::Null,
                    S,
                    Value::Null,
                    json!({"phase": 0.7}),
                ),
                p(
                    "near_fade",
                    "m | auto",
                    "m",
                    json!("auto"),
                    S,
                    json!("auto"),
                    json!(2),
                ),
            ],
            reads: None,
            fixture: json!({"it": item("puff@1", json!({"radius": 2, "density": 0.6}))}),
        },
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
                p("from", "deg", "deg", json!(0), G, json!(0), json!(90)),
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
                    "levels",
                    "[[z, polygon]]",
                    "m",
                    Value::Null,
                    G,
                    json!([
                        [0, [[0, 0], [1, 0], [0, 1]]],
                        [0.5, [[0, 0], [1, 0], [0, 1]]]
                    ]),
                    json!([
                        [0, [[0, 0], [1, 0], [0, 1]]],
                        [0.3, [[-0.1, -0.1], [1.2, -0.1], [-0.1, 1.2]]],
                        [0.6, [[0, 0], [1, 0], [0, 1]]]
                    ]),
                ),
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
                    "tetra | octa | icosa | dodeca",
                    "",
                    json!("icosa"),
                    G,
                    json!("icosa"),
                    json!("octa"),
                ),
                ranged(
                    p("detail", "u8", "", json!(0), G, json!(1), json!(2)),
                    0.0,
                    5.0,
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
        "hull@1" => Spec {
            kind: "hull@1",
            module: "scene3d",
            params: vec![
                p(
                    "points",
                    "vec3 column",
                    "m",
                    Value::Null,
                    G,
                    json!([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]),
                    json!([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]]),
                ),
                p(
                    "of",
                    "ID[#part]",
                    "",
                    Value::Null,
                    G,
                    Value::Null,
                    Value::Null,
                ),
                shade(),
                paint(),
            ],
            reads: None,
            fixture: json!({"it": item("hull@1", json!({"points": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], "paint": {"fill": {"role": "accent"}}}))}),
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
pub const SCENE3D: [&str; 25] = [
    "mark.box@1",
    "mark.cylinder@1",
    "mark.sphere@1",
    "mark.line@1",
    "mark.point@1",
    "mark.text@1",
    "light.sun@1",
    "light.point@1",
    "light.spot@1",
    "light.area@1",
    "light.probe@1",
    "material@1",
    "sky@1",
    "puff@1",
    "slab@1",
    "lathe@1",
    "extrude@1",
    "tube@1",
    "ball@1",
    "coil@1",
    "plate@1",
    "display@1",
    "hull@1",
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
