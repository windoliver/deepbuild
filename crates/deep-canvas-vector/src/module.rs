//! The vector canvas module's manifest and register call (Registry and seal, #305): it
//! implements `vector@1` on marks2d.

use std::collections::BTreeMap;

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Range, Registrar, Semver,
};
use deep_canvas::schedule::core_ops::Fields;
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::lower;
use crate::svg::Color;

/// The vector module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: manifest("vector"),
        register: |r| register(r, paint),
    }
}

/// A planted implementation of vector@1 (#399's `test-vector-currentcolor-ink`): declared bit
/// and canonical, under its own name, that draws `currentColor` in ink whatever `colors` maps it
/// to, so the kit's bit part fails it and a release build refuses it.
pub fn currentcolor_ink() -> Module {
    Module {
        manifest: manifest("vector.currentcolor_ink"),
        register: |r| register(r, paint_current_in_ink),
    }
}

fn manifest(implementation: &str) -> Manifest {
    Manifest {
        name: "vector".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "marks2d".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "vector".into(),
        license: "Apache-2.0".into(),
        implements: "vector@1".into(),
        implementation: Implementation::reference(
            implementation,
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

fn register(r: &mut Registrar, paint: fn(&mut View<'_>) -> Result<(), OpError>) {
    // #443: an SVG's or a formula's parts as outlines, vector's entry in the core's
    // `outline.source@1`.
    r.outline_source(
        "vector",
        json!({"form": "vector", "fixture": crate::outline_source::fixture()}),
        crate::outline_source::vector_fill,
    );
    // The kind (Vector and formula `vector@1`), with its fields as the design lists them, drawn
    // in a frame as its imported outline (#1162).
    let field = |name: &'static str| Param {
        name,
        ty: ParamType::Json,
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(
        Entry {
            family: "",
            name: "vector",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: ["src", "size", "colors", "lines", "hotspot", "alt", "numbers", "write_on", "parts"]
                    .into_iter()
                    .map(field)
                    .collect(),
            }],
            migrations: Vec::new(),
        },
        &[],
        "path@1",
    )
    .drawn(drawn)
    .draws(&["glyphs"]);
    // #408: each part's box in the item's own units, the formula's glyph boxes, contributed to
    // the core's glyph-box array, which film.layout reads its text from.
    r.contribution(
        "vector.glyphs",
        "list",
        "item",
        "geometry",
        "items",
        "core.glyphs",
    );
    r.operator("glyphs", "items", &["core.fields"], &["vector.glyphs"])
        .applies(is_vector)
        .run(glyphs);
    // #399: each vector item's paint mapping, the role `currentColor` and each `colors` key
    // draws in, resolved as the lowering resolves it.
    r.array("vector.paint", "paint", "item", "shading", "items");
    r.operator("paint", "items", &["core.fields"], &["vector.paint"])
        .applies(is_vector)
        .run(paint);
    // The import's codes (svg_*) join the catalog with their planted fixtures when the kit seals
    // vector@1 (#399). The hub draws a vector from the SVG its evidence store holds (#1162); the
    // fixture names one no store holds, which its codes name.
    r.fixture("formula", formula(), None).sidecar(json!({
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["asset_missing", "unknown_kind"],
    }));
    // #399: a vector whose `colors` maps `currentColor` to the accent, beside a mapped sRGB color.
    r.fixture("paint", paint_board(), None).sidecar(json!({
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["asset_missing", "unknown_kind"],
    }));
}

/// What a vector item draws as in a frame (#1162): one `path@1` of its imported outline, which
/// whoever holds the evidence store inlines as `params.outline` (`{d, role}`, in the item's own
/// units, `lower::outline`), in the role its colors map to, beside the params as written, which
/// its own operators read. One not inlined draws nothing: its SVG's absence is the import's
/// `asset_missing`.
fn drawn(params: &Value) -> Value {
    let outline = &params["outline"];
    let mut out = params.as_object().cloned().unwrap_or_default();
    out.insert("d".into(), json!(outline["d"].as_str().unwrap_or("M0 0")));
    out.insert(
        "paint".into(),
        json!({"fill": {"role": outline["role"].as_str().unwrap_or("ink")}}),
    );
    Value::Object(out)
}

/// Each part's box `[x, y, w, h]` in the item's own units, from its inlined outline; the whole
/// outline's when it has no parts, and none when it isn't inlined.
fn glyphs(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?
        .to_json();
    let outline = &fields["params"]["outline"];
    let box_of = |d: &Value| {
        d.as_str()
            .and_then(deep_canvas_marks::path::parse)
            .and_then(|verbs| deep_canvas_marks::relations::tight(&verbs))
    };
    let mut boxes: Vec<[f64; 4]> = outline["parts"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, d)| box_of(d))
        .collect();
    if boxes.is_empty() {
        boxes.extend(box_of(&outline["d"]));
    }
    v.write("vector.glyphs", Val::typed(boxes))
}

fn is_vector(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("vector@1")
}

/// The item's paint mapping: `currentColor`, then each `colors` key, to the role it draws in.
fn mapping(
    v: &mut View<'_>,
    resolve: for<'a> fn(&'a BTreeMap<Color, String>, Color) -> &'a str,
) -> Result<(), OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?
        .to_json();
    let id = v.id().unwrap_or_default().to_string();
    let params = fields["params"].as_object().cloned().unwrap_or_default();
    let colors = lower::colors(&id, &params).map_err(|u| OpError::new("bad_doc", u.path))?;
    let mut out: Vec<(String, String)> = vec![(
        "currentColor".into(),
        resolve(&colors, Color::Current).into(),
    )];
    if let Some(Value::Object(keys)) = params.get("colors") {
        for key in keys.keys().filter(|k| *k != "currentColor") {
            let color = crate::svg::color(key).unwrap_or(Color::Current);
            out.push((key.clone(), resolve(&colors, color).into()));
        }
    }
    v.write("vector.paint", Val::typed(out))
}

fn paint(v: &mut View<'_>) -> Result<(), OpError> {
    mapping(v, lower::role_of)
}

/// The planted resolution: `currentColor` in ink.
fn paint_current_in_ink(v: &mut View<'_>) -> Result<(), OpError> {
    mapping(v, ink_for_current)
}

fn ink_for_current(colors: &BTreeMap<Color, String>, color: Color) -> &str {
    match color {
        Color::Current => "ink",
        c => lower::role_of(colors, c),
    }
}

fn formula() -> serde_json::Value {
    json!({
        "format": 1, "id": "vector-formula", "profile": "figure", "title": "A formula",
        "description": "A formula from the typeset job, its colors mapped to roles, over its caption.",
        "size": [320, 140],
        "requires": {"modules": {"vector": "^1"}},
        "items": {"caption": {
            "id": "caption", "kind": "text@1", "name": "Caption", "order": "a1",
            "params": {"font": "body", "size": 13, "box": {"w": 300, "h": 20}, "text": "The formula"},
            "at": {"pos": [10, 112, 0]},
        }, "eq": {
            "id": "eq", "kind": "vector@1", "name": "eq", "order": "a0",
            "params": {
                "src": "0000000000000000000000000000000000000000000000000000000000000000",
                "size": [300, 100], "colors": {"currentColor": "ink"}, "alt": "x = 1",
            },
        }},
    })
}

fn paint_board() -> serde_json::Value {
    json!({
        "format": 1, "id": "vector-paint", "profile": "figure", "title": "A mark in the accent",
        "description": "A mark whose currentColor maps to the accent and whose red maps to muted, over its caption.",
        "size": [320, 140],
        "requires": {"modules": {"vector": "^1"}},
        "items": {"caption": {
            "id": "caption", "kind": "text@1", "name": "Caption", "order": "a1",
            "params": {"font": "body", "size": 13, "box": {"w": 300, "h": 20}, "text": "The mark"},
            "at": {"pos": [10, 112, 0]},
        }, "mark": {
            "id": "mark", "kind": "vector@1", "name": "mark", "order": "a0",
            "params": {
                "src": "0000000000000000000000000000000000000000000000000000000000000000",
                "size": [300, 100], "colors": {"currentColor": "accent", "#ff0000": "muted"},
                "alt": "a mark",
            },
        }},
    })
}
