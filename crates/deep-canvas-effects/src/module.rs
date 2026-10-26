//! The effects canvas module (technical design: Canvas modules, the module table's effects row),
//! registered through the registry and seal (#305): its manifest and the passes its shipped
//! operators add to the frame, glow into the bloom place and the rest into the effects chain.

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use serde_json::{json, Value};

pub const GRID: &str = "effects.grid";
pub const SHADOW: &str = "effects.shadow";
pub const SPARKS: &str = "effects.particles";
pub const OUTLINE: &str = "effects.outline";
pub const GLOW: &str = "effects.glow";

/// The passes the shipped operators run as, each timed in the frame under its name, and the place
/// each goes into, in frame order: glow's whole chain is one pass in the bloom place.
pub const PASSES: &[(&str, &str)] = &[
    (GRID, "effects"),
    (SHADOW, "effects"),
    (SPARKS, "effects"),
    (OUTLINE, "effects"),
    (GLOW, "bloom"),
];

fn manifest() -> Manifest {
    Manifest {
        name: "effects".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "scene3d".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "effects".into(),
        license: "Apache-2.0".into(),
        implements: "effects@1".into(),
    }
}

/// The effects module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

fn register(r: &mut Registrar) {
    for (name, place) in PASSES {
        r.pass(name, place);
    }
    // Headless, the kit proves the scene the effects draw on reaches the check with no issue;
    // its pixels need the GPU, and the acceptance suite draws them there.
    r.fixture("shadowed-box", shadowed_box(), None)
        .sidecar(json!({"codes": [], "covers": {"kinds": ["light.sun@1"], "fields": ["light.sun@1/params/shadow"]}}));
}

/// The module's fixture: a box on a floor under a sun that casts its shadow.
fn shadowed_box() -> Value {
    json!({
        "format": 1, "profile": "figure", "title": "A box and its shadow",
        "description": "A box on a floor slab, lit by a sun that casts the box's shadow on the floor.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1", "effects": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "perspective", "position": [3, 3.2, 5.5], "target": [0, 0.4, 0], "fov": 40, "near": 0.1}},
            "floor": {"id": "floor", "kind": "mark.box@1", "name": "Floor", "order": "a1",
                      "params": {"size": [12, 0.1, 12], "paint": {"fill": {"role": "muted"}}}, "at": {"pos": [0, -0.05, 0]}},
            "block": {"id": "block", "kind": "mark.box@1", "name": "Block", "order": "a2",
                      "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0.5, 0]}},
            "sun": {"id": "sun", "kind": "light.sun@1", "name": "Sun", "order": "a3",
                    "params": {"illuminance": deep_canvas::ops::PI, "shadow": true}, "at": {"rot": [-55, -40, 0]}}
        }
    })
}
