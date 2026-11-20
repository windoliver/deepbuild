//! Issue #2777's test canvas module `test.tone` (the #2777 acceptance README: Test canvas module
//! and features of `deep-show`): the kind `test.tint@1`, whose field `tone` takes one of three
//! words, drawn as a rect. `test-tone-unclosed` gives that list no closure, so the seal refuses
//! the set; `test-tone-closed` closes it for determinism, with nothing in its place.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::fields::{Closure, NOTHING};
use deep_canvas::registry::{Module, Registrar};
use serde_json::{json, Value};

use super::{box_param, kind, manifest};

fn tone() -> Param {
    Param {
        name: "tone",
        ty: ParamType::Json("warm | cool | neutral"),
        unit: "",
        default: json!("warm"),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn tint(r: &mut Registrar) -> &mut Registrar {
    r.kind(
        kind("test", "tint", vec![box_param(), tone()]),
        &[],
        "rect@1",
    )
    .drawn(|p| {
        json!({"box": p.get("box").cloned().unwrap_or(Value::Null),
                   "paint": {"fill": {"role": "accent"}}})
    })
}

/// `test-tone-unclosed`: `test.tint@1.tone` with no closure.
pub fn unclosed() -> Module {
    Module {
        manifest: manifest("test.tone", &[]),
        register: |r| {
            tint(r);
        },
    }
}

/// `test-tone-closed`: the same list, closed.
pub fn closed() -> Module {
    Module {
        manifest: manifest("test.tone", &[]),
        register: |r| {
            tint(r).closes(
                "tone",
                Closure::closed(
                    "determinism",
                    "a tint needs a tone the three can't give",
                    NOTHING,
                ),
            );
        },
    }
}
