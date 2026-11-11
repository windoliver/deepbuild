//! Issue #202's test canvas module `test.weight` (the #202 acceptance README: The test canvas
//! module): one item kind, `test.weight@1`, whose only param is the box a kind drawn as a rect
//! needs, 8 × 8 by default so an item sends none. It is drawn with no pass of its own and costed
//! at 0.20 ms of CPU a frame through the registrar's per-kind CPU, so a pack kind that expands
//! into it has an estimate its kind kit compares with its declaration.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::{Module, Registrar};
use serde_json::{json, Value};

use super::{kind, manifest};

/// `box`, `[x, y, w, h]` in u, 8 × 8 unless set.
fn eight_by_eight() -> Param {
    Param {
        name: "box",
        ty: ParamType::Json,
        unit: "",
        default: json!([0, 0, 8, 8]),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn draw(params: &Value) -> Value {
    let b = params.get("box").cloned().unwrap_or(json!([0, 0, 8, 8]));
    json!({"box": b, "paint": {"fill": {"role": "muted"}}})
}

/// 0.20 ms of CPU an item.
fn weight(_item: &Value) -> f64 {
    0.20
}

fn register(r: &mut Registrar) {
    r.kind(
        kind("test", "weight", vec![eight_by_eight()]),
        &[],
        "rect@1",
    )
    .drawn(draw);
    r.cost("test.weight", weight);
}

/// `test-weight`: `test.weight@1`, 0.20 ms of CPU an item.
pub fn module() -> Module {
    Module {
        manifest: manifest("test.weight", &[]),
        register,
    }
}
