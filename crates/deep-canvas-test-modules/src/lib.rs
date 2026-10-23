//! The test canvas modules of the #305 acceptance README (The surface under test: Build sets and
//! the test canvas modules): `test.a` and `test.b` (b reads a's array through one operator, a
//! optional or required), and the fault modules whose set the seal must refuse: two writers of
//! one array, a read of a later phase, a cycle and a missing dependency. Each is one manifest and
//! one register call; `deep-show` puts each in a build under its own Cargo feature.

use std::collections::BTreeMap;

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use serde_json::{json, Value};

fn manifest(name: &str, deps: &[(&str, bool)]) -> Manifest {
    let one = Semver {
        major: 1,
        minor: 0,
        patch: 0,
    };
    let any = Range::parse("*").expect("`*` is a range");
    let mut depends_on = BTreeMap::new();
    for (dep, optional) in deps {
        depends_on.insert(
            dep.to_string(),
            Dependency {
                range: Range::parse("^1").expect("`^1` is a range"),
                optional: *optional,
            },
        );
    }
    Manifest {
        name: name.into(),
        version: one,
        core: any,
        depends_on,
        feature: name.replace('.', "-"),
        license: "Apache-2.0".into(),
        implements: format!("{name}@1"),
    }
}

/// `rect@1`'s box: `[x, y, w, h]` in u.
fn box_param() -> Param {
    Param {
        name: "box",
        ty: ParamType::Json,
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn kind(family: &'static str, name: &'static str, params: Vec<Param>) -> Entry {
    Entry {
        family,
        name,
        versions: vec![Version {
            major: 1,
            minor: 0,
            params,
        }],
        migrations: vec![],
    }
}

fn register_a(r: &mut Registrar) {
    let value = Param {
        name: "value",
        ty: ParamType::F32,
        unit: "u",
        default: json!(0),
        min: Some(-1.0e6),
        max: Some(1.0e6),
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(
        kind("test", "a", vec![box_param(), value]),
        &["test.a.value"],
        "rect@1",
    );
    r.array("test.a.value", "f32", "item", "params", "items");
    r.operator("value", "items", &["self"], &["test.a.value"]);
}

/// `test.a`: a kind `test.a@1` with a `box` and a `value` its array `test.a.value` carries.
pub fn a() -> Module {
    Module {
        manifest: manifest("test.a", &[]),
        register: register_a,
    }
}

fn register_b(r: &mut Registrar) {
    // `echo` is what the operator `test.b.echo` evaluates, reading `test.a.value`: the one
    // feature of b that reads a.
    let echo = Param {
        name: "echo",
        ty: ParamType::Json,
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "test.b",
        operator: "echo",
    };
    r.kind(
        kind("test", "b", vec![box_param(), echo]),
        &["test.b.echoed"],
        "rect@1",
    );
    r.array("test.b.echoed", "f32", "item", "params", "items");
    r.operator(
        "echo",
        "items",
        &["self", "test.a.value"],
        &["test.b.echoed"],
    );
}

/// `test.b`, with `test.a` optional: without a, the seal leaves `test.b.echo` out.
pub fn b() -> Module {
    Module {
        manifest: manifest("test.b", &[("test.a", true)]),
        register: register_b,
    }
}

/// The same `test.b` with `test.a` required: a build without a refuses to start.
pub fn b_requires_a() -> Module {
    Module {
        manifest: manifest("test.b", &[("test.a", false)]),
        register: register_b,
    }
}

fn register_shared(r: &mut Registrar) {
    r.array("test.shared", "f32", "item", "params", "items");
}

/// `test.w1` and `test.w2`, each the writer of `test.shared`: two writers of one array.
pub fn two_writers() -> [Module; 2] {
    [
        Module {
            manifest: manifest("test.w1", &[]),
            register: register_shared,
        },
        Module {
            manifest: manifest("test.w2", &[]),
            register: register_shared,
        },
    ]
}

fn register_late(r: &mut Registrar) {
    r.array("test.late.after", "f32", "item", "params", "render");
    r.operator("after", "render", &["self"], &["test.late.after"]);
    r.operator("early", "items", &["test.late.after"], &[]);
}

/// `test.late`: an operator in `items` reads an array written in `render`, a later phase.
pub fn later_phase() -> Module {
    Module {
        manifest: manifest("test.late", &[]),
        register: register_late,
    }
}

fn register_c1(r: &mut Registrar) {
    r.array("test.c1.out", "f32", "item", "params", "items");
    r.operator("out", "items", &["test.c2.out"], &["test.c1.out"]);
}

fn register_c2(r: &mut Registrar) {
    r.array("test.c2.out", "f32", "item", "params", "items");
    r.operator("out", "items", &["test.c1.out"], &["test.c2.out"]);
}

/// `test.c1` and `test.c2`, each reading the other's array in `items`: a cycle.
pub fn cycle() -> [Module; 2] {
    [
        Module {
            manifest: manifest("test.c1", &[("test.c2", false)]),
            register: register_c1,
        },
        Module {
            manifest: manifest("test.c2", &[("test.c1", false)]),
            register: register_c2,
        },
    ]
}

/// `test.orphan`, which requires `test.absent`, a module no build holds.
pub fn missing_dep() -> Module {
    Module {
        manifest: manifest("test.orphan", &[("test.absent", false)]),
        register: |_| {},
    }
}
