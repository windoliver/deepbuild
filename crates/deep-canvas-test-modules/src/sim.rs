//! Issue #185: the test interface `test.sim@1` and its implementations (the #185 acceptance README:
//! Names this suite chooses). A (`test.sim.a`, bit and canonical) is the reference; B
//! (`test.sim.b`, measured, with backend_bytes state) lands a hair off A's answers, as another
//! backend would. Both register as the canvas module `test.sim`, so their arrays share names: the
//! public `test.sim.pos`, twice an item's `value`, and the private `test.sim.scratch`. Each of B's
//! variants changes one thing: an array's type or name, a false `bit`, or an answer 2% off.

use std::collections::BTreeMap;

use deep_canvas::registry::{
    Answer, Behavior, BehaviorFixture, Equivalence, Implementation, Interface, Manifest, Module,
    Pin, Registrar, Run, Semver, StateClass,
};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

/// The interface's name.
pub const SIM: &str = "test.sim@1";

fn implementation(name: &str, equivalence: Equivalence, state: StateClass) -> Manifest {
    let mut m = super::manifest("test.sim", &[]);
    m.implements = SIM.into();
    m.feature = name.replace('.', "-");
    let mut pins = BTreeMap::new();
    if state == StateClass::BackendBytes {
        // B's backend is its own crate, at a pinned version.
        pins.insert(
            "test-sim-backend".to_string(),
            Pin {
                version: "1.0.0".into(),
                features: vec!["f32".into()],
            },
        );
    }
    m.implementation = Implementation {
        name: name.into(),
        version: Semver::parse("1.0.0").expect("a version"),
        pins,
        equivalence,
        state,
    };
    m
}

fn value_of(v: &mut View<'_>) -> Result<f64, OpError> {
    Ok(v.item()?
        .pointer("/params/value")
        .and_then(Value::as_f64)
        .unwrap_or(0.0))
}

/// A's answer: exactly twice the value.
fn exact(v: &mut View<'_>) -> Result<(), OpError> {
    let x = value_of(v)?;
    v.write("test.sim.pos", Val::typed(2.0 * x))
}

/// B's: twice the value, one part in 100,000 off, as another backend's arithmetic lands.
fn near(v: &mut View<'_>) -> Result<(), OpError> {
    let x = value_of(v)?;
    v.write("test.sim.pos", Val::typed(2.0 * x * (1.0 + 1e-5)))
}

/// The planted B's: 2% off.
fn off(v: &mut View<'_>) -> Result<(), OpError> {
    let x = value_of(v)?;
    v.write("test.sim.pos", Val::typed(2.0 * x * 1.02))
}

/// `test.sim.pos2`, the renamed public array's writer.
fn near_renamed(v: &mut View<'_>) -> Result<(), OpError> {
    let x = value_of(v)?;
    v.write("test.sim.pos2", Val::typed(2.0 * x * (1.0 + 1e-5)))
}

fn work(scratch: &'static str) -> Run {
    match scratch {
        "test.sim.scratch" => |v| {
            let x = value_of(v)?;
            v.write("test.sim.scratch", Val::typed(x))
        },
        _ => |v| {
            let x = value_of(v)?;
            v.write("test.sim.scratch2", Val::typed(x))
        },
    }
}

fn board(title: &str, value: f64) -> Value {
    json!({"format": 1, "profile": "board", "title": title,
           "description": "A fixture of the test.sim test canvas module.",
           "size": [320, 200], "requires": {"modules": {"test.sim": "^1"}},
           "items": {"s1": {"id": "s1", "kind": "test.sim@1", "name": "Item s1", "order": "a0",
                            "params": {"box": [20, 20, 60, 40], "value": value}}}})
}

/// The shapes every implementation registers, with its public array `pos` of type `ty`, its
/// private array `scratch`, and the operator `step` that writes `pos`.
fn shapes(r: &mut Registrar, pos: &'static str, ty: &str, scratch: &'static str, step: Run) {
    r.kind(
        super::kind("test", "sim", vec![super::box_param(), super::number("value")]),
        &[pos],
        "rect@1",
    )
    .drawn(|params| {
        json!({"box": params.get("box").cloned().unwrap_or(Value::Null), "paint": {"fill": {"role": "ink"}}})
    });
    r.array(pos, ty, "item", "params", "items");
    r.private_array(scratch, "f32", "item", "params", "items");
    r.operator("work", "items", &["self"], &[scratch])
        .run(work(scratch));
    r.operator("step", "items", &["self", scratch], &[pos])
        .run(step);
    let sidecar = json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
                         "oracles": ["seek_play"], "codes": []});
    r.parity("kernel", "sim-small", board("Small", 1.5), sidecar.clone());
    r.parity("kernel", "sim-large", board("Large", 40.0), sidecar);
}

/// A: bit and canonical, the reference.
pub fn a() -> Module {
    Module {
        manifest: implementation("test.sim.a", Equivalence::Bit, StateClass::Canonical),
        register: |r| shapes(r, "test.sim.pos", "f32", "test.sim.scratch", exact),
    }
}

fn measured(name: &str) -> Manifest {
    implementation(name, Equivalence::Measured, StateClass::BackendBytes)
}

/// B: measured, with backend_bytes state.
pub fn b() -> Module {
    Module {
        manifest: measured("test.sim.b"),
        register: |r| shapes(r, "test.sim.pos", "f32", "test.sim.scratch", near),
    }
}

/// B with `test.sim.pos` registered as f64.
pub fn b_f64() -> Module {
    Module {
        manifest: measured("test.sim.b"),
        register: |r| shapes(r, "test.sim.pos", "f64", "test.sim.scratch", near),
    }
}

/// B with its private array renamed `test.sim.scratch2`.
pub fn b_private_renamed() -> Module {
    Module {
        manifest: measured("test.sim.b"),
        register: |r| shapes(r, "test.sim.pos", "f32", "test.sim.scratch2", near),
    }
}

/// B with its public array renamed `test.sim.pos2`.
pub fn b_public_renamed() -> Module {
    Module {
        manifest: measured("test.sim.b"),
        register: |r| shapes(r, "test.sim.pos2", "f32", "test.sim.scratch", near_renamed),
    }
}

/// Planted: B declaring bit, whose answers aren't A's bits.
pub fn b_false_bit() -> Module {
    Module {
        manifest: implementation("test.sim.b", Equivalence::Bit, StateClass::BackendBytes),
        register: |r| shapes(r, "test.sim.pos", "f32", "test.sim.scratch", near),
    }
}

/// Planted: B landing 2% off every answer.
pub fn b_off() -> Module {
    Module {
        manifest: measured("test.sim.b"),
        register: |r| shapes(r, "test.sim.pos", "f32", "test.sim.scratch", off),
    }
}

/// `test.c`, of its own interface, which reads B's private array.
pub fn c() -> Module {
    Module {
        manifest: super::manifest("test.c", &[("test.sim", false)]),
        register: |r| {
            r.array("test.c.seen", "f32", "item", "params", "items");
            r.operator("peek", "items", &["test.sim.scratch"], &["test.c.seen"]);
        },
    }
}

fn answer(name: &str, value: f64, tolerance: f64) -> BehaviorFixture {
    BehaviorFixture {
        name: name.into(),
        document: board(name, value),
        answers: vec![Answer {
            item: "s1".into(),
            array: "test.sim.pos".into(),
            value: 2.0 * value,
            tolerance,
        }],
    }
}

/// `test.sim@1`, whose reference is A; with `behavior`, its behavior part: three fixtures whose
/// answer is twice the item's value, at tolerances of 1%, 5% and 0.1%.
pub fn interface(kit: Vec<String>, behavior: bool) -> Interface {
    let behavior = behavior.then(|| Behavior {
        name: "behavior".into(),
        fixtures: vec![
            answer("sim-half", 0.75, 0.01),
            answer("sim-unit", 1.0, 0.05),
            answer("sim-far", 250.0, 0.001),
        ],
    });
    let mut kit = kit;
    if let Some(b) = &behavior {
        kit.push(b.name.clone());
    }
    Interface {
        name: SIM.into(),
        reference: a(),
        kit,
        behavior,
    }
}
