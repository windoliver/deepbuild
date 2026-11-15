//! Issue #223's test canvas module `test.swirl` (the #223 acceptance README: The test canvas
//! module): one kind, `test.swirl@1`, that draws nothing and builds at check a stream table in
//! data layout `streams@1` for the field (−y, x) at its `step`, so a group's flow can read a table
//! by its layout in a build that holds no vector field and no data module.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::{Module, Registrar};
use deep_canvas::streams;
use serde_json::{json, Value};

use super::{kind, manifest};

fn step() -> Param {
    Param {
        name: "step",
        ty: ParamType::F32,
        unit: "",
        default: json!(0.01),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

/// A filled path of no area, which draws nothing, carrying the table in its params.
fn draw(params: &Value) -> Value {
    let step = params
        .get("step")
        .and_then(Value::as_f64)
        .filter(|s| s.is_finite() && *s > 0.0)
        .unwrap_or(0.01);
    let table = streams::Table {
        fn_x: "-y".into(),
        fn_y: "x".into(),
        vars: Vec::new(),
        step,
        streams: Vec::new(),
    };
    json!({"d": "M 0 0", "paint": {"fill": {"role": "ink"}}, "streams": streams::to_json(&table)})
}

fn register(r: &mut Registrar) {
    r.kind(kind("test", "swirl", vec![step()]), &[], "path@1")
        .drawn(draw);
}

/// `test-swirl`: `test.swirl@1`, a stream table for (−y, x).
pub fn module() -> Module {
    Module {
        manifest: manifest("test.swirl", &[]),
        register,
    }
}
