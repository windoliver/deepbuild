//! Issue #522's test canvas module `test.launch` (tests/acceptance/522/README.md: deep-show): one
//! undrawn kind, `test.launch@1 {step, linear}`, each item of which fires one `launch` entry
//! `{linear}` for its step, a derived entry on the core's input track that reaches each world
//! input whose `on` names the item. It stands in for a logic item that fires a world's inputs
//! (#1834), so the physics module is seen to read another module's entries without naming it.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::{Module, Registrar};
use serde_json::{json, Value};

use super::{kind, manifest};

fn param(name: &'static str, ty: ParamType, default: Value) -> Param {
    Param {
        name,
        ty,
        unit: "",
        default,
        min: Some(0.0),
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn register(r: &mut Registrar) {
    let params = vec![
        param("step", ParamType::F32, json!(0)),
        Param {
            min: None,
            ..param("linear", ParamType::Json, json!([0, 0, 0]))
        },
    ];
    r.kind(kind("test", "launch", params), &[], "");
}

/// `test-launch-module`: `test.launch@1`, an item that fires a launch.
pub fn module() -> Module {
    Module {
        manifest: manifest("test.launch", &[]),
        register,
    }
}

/// The entries each `test.launch@1` item of `form` fires, in item ID order: `{item, step, kind:
/// "launch", data: {linear}}`.
pub fn fired(form: &Value) -> Vec<Value> {
    let items = form["items"].as_object().into_iter().flatten();
    let mine = items.filter(|(_, i)| i["kind"] == "test.launch@1");
    let mut out: Vec<(String, Value)> = mine
        .filter_map(|(id, i)| {
            let p = &i["params"];
            let step = p["step"].as_f64()? as u64;
            let e = json!({"item": id, "step": step, "kind": "launch", "data": {"linear": p["linear"]}});
            Some((id.clone(), e))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.into_iter().map(|(_, e)| e).collect()
}
