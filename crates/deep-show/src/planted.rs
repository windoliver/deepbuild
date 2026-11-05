//! Issue #387's planted operator, compiled in only under the `test-accent` feature: the test
//! canvas module `test.accent`, whose operator `test.accent.tint` declares only its item and its
//! base array but also reads the look's accent role from a static the scheduler's look hook
//! leaves holding the evaluated look. Read-set perturbation of its declared reads passes it;
//! perturbing the look's accent moves its result under one key, which the criterion's check
//! fails. The canvas lint keeps statics out of every deep-canvas* crate, so it lives here.

use std::sync::Mutex;

use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::{Tokens, Val};
use serde_json::Value;

use crate::twins::{area, boxed_kind, of_kind, test_manifest};

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
    boxed_kind(r, "accent");
    r.array("test.accent.base", "f64", "item", "geometry", "items");
    r.array("test.accent.tint", "rgb", "item", "shading", "items");
    r.operator("base", "items", &["self"], &["test.accent.base"])
        .applies(|_, _, item| of_kind(item, "test.accent@1"))
        .run(|v| {
            let a = area(v)?;
            v.write("test.accent.base", Val::typed(a))
        });
    r.operator(
        "tint",
        "items",
        &["self", "test.accent.base"],
        &["test.accent.tint"],
    )
    .applies(|_, _, item| of_kind(item, "test.accent@1"))
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
        manifest: test_manifest("test.accent", "test-accent"),
        register,
    }
}
