//! The motion canvas module (technical design: Canvas modules, the module table's `motion` row;
//! issue #387 lays R1's canvas out as canvas modules). A revision's motion compiles once, at
//! check, into a program; each item a channel or a placement writes then has one node per frame
//! that evaluates the program at t and contributes its own transform to the core's
//! `core.transform` and every other field it writes to `core.fields`. The core composes a
//! child's transform with its parent's, so motion's values stay the item's own.

use std::sync::Arc;

use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::eval::Validity;
use crate::program::Program;

/// The motion module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: deep_canvas::registry::Manifest {
            name: "motion".into(),
            version: deep_canvas::registry::Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: deep_canvas::registry::Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "motion".into(),
            license: "Apache-2.0".into(),
            implements: "motion@1".into(),
        },
        register,
    }
}

fn register(r: &mut Registrar) {
    r.array("motion.program", "program", "document", "geometry", "plan");
    r.contribution(
        "motion.at",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.contribution(
        "motion.fields",
        "fields",
        "item",
        "geometry",
        "items",
        "core.fields",
    );
    r.operator("compile", "plan", &["refs"], &["motion.program"])
        .document()
        .applies(has_motion)
        .run(compile);
    r.operator(
        "channels",
        "items",
        &["motion.program", "t"],
        &["motion.at", "motion.fields"],
    )
    .applies(is_target)
    .run(channels);
    r.fixture("slide", slide(), None);
}

const SECTIONS: [&str; 4] = ["channels", "clips", "placements", "markers"];

/// A document with any channel, clip, placement or marker.
fn has_motion(doc: &Value, _: &str, _: &Value) -> bool {
    SECTIONS.iter().any(|s| {
        doc.get(*s)
            .and_then(Value::as_object)
            .is_some_and(|m| !m.is_empty())
    })
}

/// An item a document channel targets or a placement binds.
fn is_target(doc: &Value, id: &str, _: &Value) -> bool {
    let prefix = format!("items/{id}/");
    let channel = doc
        .get("channels")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .any(|(_, c)| {
            c.get("target")
                .and_then(Value::as_str)
                .is_some_and(|t| t.starts_with(&prefix))
        });
    let bound = doc
        .get("placements")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .flat_map(|(_, p)| {
            p.get("slots")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
        })
        .any(|(_, items)| match items {
            Value::String(s) => s == id,
            Value::Array(list) => list.iter().any(|v| v.as_str() == Some(id)),
            _ => false,
        });
    channel || bound
}

/// The revision's motion, compiled once at check.
fn compile(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let program = Program::compile(doc).map_err(|r| OpError::new(r.code, r.path))?;
    let bytes = format!("{program:?}").into_bytes();
    v.write("motion.program", Val::typed(Arc::new(program), bytes))
}

/// The item's own transform and fields at t, as the core's contributions.
fn channels(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let id = v.id().unwrap_or_default().to_string();
    let Some(program) = v.typed::<Arc<Program>>("motion.program")? else {
        return Err(OpError::new("input_missing", format!("items/{id}")));
    };
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    let Some((transform, fields)) = program.item_values(&state, &id) else {
        return Ok(());
    };
    let at = json!([
        {"op": "set", "path": ["pos"], "value": &transform[0..3]},
        {"op": "set", "path": ["rot"], "value": &transform[3..6]},
        {"op": "set", "path": ["scale"], "value": &transform[6..9]},
    ]);
    let edits: Vec<Value> = fields
        .into_iter()
        .map(|(path, value)| json!({"op": "set", "path": path, "value": value}))
        .collect();
    v.write("motion.at", Val::json(at))?;
    v.write("motion.fields", Val::json(Value::Array(edits)))
}

/// The motion module's fixture: a box a clip slides, a child riding it, and a caption.
fn slide() -> Value {
    json!({
        "format": 1, "profile": "board", "seed": 387, "title": "Motion slide",
        "description": "A box a clip slides across, its child riding along, and a caption: the motion module's fixture.",
        "size": [320, 200],
        "items": {
            "ground": {"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0",
                       "params": {"box": [0, 0, 320, 200], "paint": {"fill": {"role": "ground"}}}},
            "mover": {"id": "mover", "kind": "rect@1", "name": "Sliding box", "order": "a1",
                      "params": {"box": [0, 0, 40, 30], "paint": {"fill": {"role": "ink"}}},
                      "at": {"pos": [16, 80, 0]}},
            "rider": {"id": "rider", "kind": "rect@1", "name": "Rider", "order": "a2", "parent": "mover",
                      "params": {"box": [0, 0, 12, 10], "paint": {"fill": {"role": "muted"}}},
                      "at": {"pos": [10, -14, 0]}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a3",
                    "params": {"text": "Sliding", "font": "body", "size": 13, "box": {"w": 120, "h": 20}},
                    "at": {"pos": [16, 20, 0]}}
        },
        "clips": {"slide": {"slots": {"target": {"type": "rect@1", "required": true}}, "span": "auto",
            "channels": {"x": {"target": "slot:target/at/pos/0", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 16, "interp": "linear"}, "k1": {"t": "2s", "value": 260, "interp": "linear"}}}}}},
        "placements": {"p": {"clip": "slide", "slots": {"target": "mover"}, "start": "0s"}}
    })
}
