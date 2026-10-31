//! Issue #857's test canvas modules, compiled in only under the `test-threads` feature:
//! `test.serial`, whose operator declares itself not thread-safe, and `test.racy`, whose operator
//! reads and bumps a process-wide counter outside its read set without declaring it: the planted
//! operator the shuffle test at 8 threads catches. The canvas lint keeps statics out of every
//! deep-canvas* crate, so both live here, beside #387's `test.accent`.

use std::sync::atomic::{AtomicU64, Ordering};

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

/// The shared state the planted operator touches.
static COUNT: AtomicU64 = AtomicU64::new(0);

/// Registers kind `<module>@1` with a `box`, drawn as a rect, and its array `<module>.out`.
fn kind(r: &mut Registrar, name: &'static str) {
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
            name,
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
}

/// The item's box's area.
fn area(v: &mut View<'_>) -> Result<f64, OpError> {
    Ok(v.item()?
        .pointer("/params/box")
        .and_then(Value::as_array)
        .map(|b| {
            b.get(2).and_then(Value::as_f64).unwrap_or(0.0)
                * b.get(3).and_then(Value::as_f64).unwrap_or(0.0)
        })
        .unwrap_or(0.0))
}

fn register_serial(r: &mut Registrar) {
    kind(r, "serial");
    r.array("test.serial.out", "f64", "item", "geometry", "items");
    r.operator("out", "items", &["self"], &["test.serial.out"])
        .applies(|_, _, item| item.get("kind").and_then(Value::as_str) == Some("test.serial@1"))
        .serial()
        .run(|v| {
            let a = area(v)?;
            v.write("test.serial.out", Val::json(json!(a)))
        });
}

fn register_racy(r: &mut Registrar) {
    kind(r, "racy");
    r.array("test.racy.out", "json", "item", "geometry", "items");
    r.operator("out", "items", &["self"], &["test.racy.out"])
        .applies(|_, _, item| item.get("kind").and_then(Value::as_str) == Some("test.racy@1"))
        .run(|v| {
            let a = area(v)?;
            // The planted read: shared state outside the read set, undeclared.
            let count = COUNT.fetch_add(1, Ordering::Relaxed);
            v.write(
                "test.racy.out",
                Val::json(json!({"area": a, "count": count})),
            )
        });
}

fn module(name: &str, register: fn(&mut Registrar)) -> Module {
    Module {
        manifest: Manifest {
            name: name.into(),
            version: Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "test-threads".into(),
            license: "Apache-2.0".into(),
            implements: format!("{name}@1"),
        },
        register,
    }
}

/// `test.serial` and `test.racy`.
pub fn modules() -> Vec<Module> {
    vec![
        module("test.serial", register_serial),
        module("test.racy", register_racy),
    ]
}
