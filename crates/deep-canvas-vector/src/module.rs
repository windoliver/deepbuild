//! The vector canvas module's manifest and register call (Registry and seal, #305): it
//! implements `vector@1` on marks2d.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Range, Registrar, Semver,
};
use serde_json::json;

/// The vector module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
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
                "vector",
                Semver::parse("1.0.0").expect("a version"),
            ),
        },
        register,
    }
}

fn register(r: &mut Registrar) {
    // The kind (Vector and formula `vector@1`), with its fields as the design lists them.
    let field = |name: &'static str| Param {
        name,
        ty: ParamType::Json,
        unit: "",
        default: serde_json::Value::Null,
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
        "",
    );
    // The import's codes (svg_*) are deep-canvas-render's check's, which reads an SVG's bytes from
    // its store; this build's hub reads none, so they join the catalog with their planted
    // fixtures when the kit seals vector@1 (#399). The hub's frame can't draw a vector yet, which
    // the fixture's codes name.
    r.fixture("formula", formula(), None).sidecar(json!({
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["module_missing", "unknown_kind"],
    }));
}

fn formula() -> serde_json::Value {
    json!({
        "format": 1, "id": "vector-formula", "profile": "figure", "title": "A formula",
        "description": "A formula from the typeset job, its colors mapped to roles, over its caption.",
        "size": [320, 140],
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
