//! The logic canvas module's manifest and register call (#535): `logic@1`, whose arrays fill the
//! core's `column.source@1` as `<logic>.<name>` (Mark set: logic columns), so a mark set reads a
//! logic array through the core's column view and no reading module depends on this one. A build
//! without it refuses a document that reads an array with `module_missing`, naming logic. Its
//! items' check, steps and seal are #533's; the host bakes the arrays at check.

use std::collections::BTreeMap;

use deep_canvas::registry::{
    Equivalence, Implementation, Manifest, Module, Range, Registrar, Semver, StateClass,
};
use serde_json::json;

use crate::world::handed;

/// The interface this module implements.
pub const INTERFACE: &str = "logic@1";

/// The shipped module.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
            name: "logic".into(),
            version: Semver::parse("1.0.0").expect("a version"),
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "logic".into(),
            license: "Apache-2.0".into(),
            implements: INTERFACE.into(),
            implementation: Implementation {
                name: "logic".into(),
                version: Semver::parse("1.0.0").expect("a version"),
                pins: BTreeMap::new(),
                equivalence: Equivalence::Bit,
                state: StateClass::Canonical,
            },
        },
        register,
    }
}

/// One entry: each logic item's arrays, by `<logic>.<name>`. Its fixture's changed ranges are
/// the ones the module hands over, so the kit's clean-rebuild rule runs [`handed`] itself.
fn register(r: &mut Registrar) {
    let frames = json!([[0, 0, 0], [0, 5, 0], [0, 5, 7]]);
    let changed = json!([handed(&[]), handed(&[[1, 2]]), handed(&[[2, 3]])]);
    r.entry(
        deep_canvas::columns::REGISTRY,
        "logic.array@1",
        json!({"form": "<logic>.<name>", "types": ["bool", "i32", "f64", "vec2", "vec3", "quat"],
               "fixture": {"frames": frames, "changed": changed,
                           "seeks": [{"from": 2, "to": 1, "rows": [0, 5, 0]}]}}),
        "R6",
    );
}
