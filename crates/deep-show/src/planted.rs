//! Issue #387's planted operator, compiled in only under the `test-accent` feature: the test
//! canvas module `test.accent`, whose operator `test.accent.tint` declares only its item and its
//! base array but also reads the look's accent role from a static the scheduler's look hook
//! leaves holding the evaluated look. Read-set perturbation of its declared reads passes it;
//! perturbing the look's accent moves its result under one key, which the criterion's check
//! fails. The canvas lint keeps statics out of every deep-canvas* crate, so it lives here.

use std::sync::Mutex;

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::{Tokens, Val};
use serde_json::Value;

/// The look the scheduler evaluated last: the static the planted operator reads.
static LOOK: Mutex<Option<Tokens>> = Mutex::new(None);

/// The scheduler's look hook: leaves the evaluated look's tokens in the static.
pub fn look_hook(tokens: &Tokens) {
    if let Ok(mut look) = LOOK.lock() {
        *look = Some(tokens.clone());
    }
}

fn accent_role() -> Value {
    LOOK.lock()
        .ok()
        .and_then(|l| l.as_ref().and_then(|t| t.get("accent").cloned()))
        .unwrap_or(Value::Null)
}

fn register(r: &mut Registrar) {
    let box_param = Param {
        name: "box",
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
            family: "test",
            name: "accent",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: vec![box_param],
            }],
            migrations: vec![],
        },
        &[],
        "rect@1",
    );
    r.array("test.accent.base", "f64", "item", "geometry", "items");
    r.array("test.accent.tint", "rgb", "item", "shading", "items");
    r.operator("base", "items", &["self"], &["test.accent.base"])
        .applies(|_, _, item| item.get("kind").and_then(Value::as_str) == Some("test.accent@1"))
        .run(|v| {
            let area = v
                .item()?
                .pointer("/params/box")
                .and_then(Value::as_array)
                .map(|b| {
                    b.get(2).and_then(Value::as_f64).unwrap_or(0.0)
                        * b.get(3).and_then(Value::as_f64).unwrap_or(0.0)
                })
                .unwrap_or(0.0);
            v.write("test.accent.base", Val::typed(area))
        });
    r.operator(
        "tint",
        "items",
        &["self", "test.accent.base"],
        &["test.accent.tint"],
    )
    .applies(|_, _, item| item.get("kind").and_then(Value::as_str) == Some("test.accent@1"))
    .run(|v| {
        let _ = v.item()?;
        let base = v.typed::<f64>("test.accent.base")?.map(|b| *b);
        // The planted read: the look's accent role, from a static, outside the read set.
        let accent = accent_role().to_string();
        v.write("test.accent.tint", Val::typed((base, accent)))
    });
}

/// `test.accent`: the planted static accent reader.
pub fn accent() -> Module {
    Module {
        manifest: Manifest {
            name: "test.accent".into(),
            version: Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "test-accent".into(),
            license: "Apache-2.0".into(),
            implements: "test.accent@1".into(),
        },
        register,
    }
}
