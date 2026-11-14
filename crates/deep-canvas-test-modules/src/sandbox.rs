//! The test canvas modules of the #238 acceptance README (deep-show: the sandbox module and the
//! test builds): `test.mesh`, whose kind takes a mesh from a pack's provider at check, and
//! `test.prog`, which declares `test.prog@1`, a registry packs fill with programs in the validator
//! role. Neither depends on the sandbox module; their programs need it in the build all the same.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::lists::RegistryDef;
use deep_canvas::registry::{Module, Registrar};
use serde_json::{json, Value};

use super::{kind, manifest};

/// `test.mesh`: the kind `test.mesh@1`, whose `mesh` is a mesh asset or `{gen, params}`.
pub fn mesh() -> Module {
    Module {
        manifest: manifest("test.mesh", &[]),
        register: register_mesh,
    }
}

fn register_mesh(r: &mut Registrar) {
    let mesh = Param {
        name: "mesh",
        ty: ParamType::Json("asset ID | {gen: <pack>.<provider>, params}"),
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(kind("test", "mesh", vec![mesh]), &[], "");
}

/// `test.prog`: the registry `test.prog@1`, each entry a pack's program by its asset's sha256.
pub fn prog() -> Module {
    Module {
        manifest: manifest("test.prog", &[]),
        register: register_prog,
    }
}

/// A program that imports a function: `(module (import "env" "forbidden_fn" (func)))`.
const IMPORTS: &str = "0061736d0100000001040160000002140103656e760c666f7262696464656e5f666e0000";

fn runs_in_the_sandbox(entry: &Value) -> Result<(), String> {
    deep_canvas_sandbox::admits(entry, "validator")
}

fn register_prog(r: &mut Registrar) {
    let schema = json!({"type": "object", "properties": {
        "name": {"type": "string"}, "program": {"type": "string"}, "wasm": {"type": "string"},
    }, "required": ["name", "program"], "additionalProperties": false});
    let mut def = RegistryDef::new("test.prog@1", schema, &["pack"], "R6")
        .rule(
            "runs_in_the_sandbox",
            "a program that passes sandbox@1's check and rewrite in the validator role",
            runs_in_the_sandbox,
        )
        .planted(
            "test.prog.imports",
            json!({"name": "test.prog.imports", "program": "planted", "wasm": IMPORTS}),
        );
    def.resolve = "check";
    def.program = Some("validator");
    r.registry(def);
}
