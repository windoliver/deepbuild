//! Issue #411's test canvas module, compiled in only under the `test-machines` feature:
//! `test.machines`, whose swatches each get two arrays a GPU operator writes and reads back, one
//! with float steps (same machine) and one with integer steps only (exact), each class computed
//! from its steps by the effects check; and three document check kinds that read the CPU data,
//! the float array and the exact array. It runs wgpu, which the canvas lint keeps out of every
//! deep-canvas* crate, so it lives here, beside #857's `test.serial`.

use std::sync::{Arc, OnceLock};

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Manifest, Module, Raised, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};
use deep_effects_render::compile::{compile, Compiled};
use deep_gpu::device::{Backend, Device, Gpu};
use serde_json::{json, Value};

const SWATCH: &str = "test.machines.swatch@1";
/// Words per swatch: its box's four numbers.
const WORDS: u32 = 4;

/// A compute operator over a swatch's four words, as the effects module reads one.
fn graph(id: &str, steps: Value) -> Value {
    json!({
        "id": id, "kind": "compute", "origin": "shipped",
        "about": "A test operator over a swatch's box, for #411's machines check.",
        "inputs": {"words": {"type": "u32", "count": WORDS, "from": {"storage": {"op": "core", "output": "slot"}}}},
        "steps": steps,
        "outputs": {"out": {"storage": {"type": "u32", "count": WORDS}}},
        "elements": WORDS, "workgroup": 64, "cost": {"ns_per_element": 0.01},
    })
}

/// Each word through f32: halved as a float, then back to a word. Float steps: same machine.
fn float_op() -> Value {
    graph(
        "test.machines.float@1",
        json!({
            "e": {"op": "element@1", "args": {}},
            "w": {"op": "read@1", "args": {"buf": "words", "i": "e"}},
            "f": {"op": "convert@1", "args": {"x": "w", "to": "f32"}},
            "k": {"op": "const@1", "args": {"value": 0.5}},
            "h": {"op": "mul@1", "args": {"a": "f", "b": "k"}},
            "u": {"op": "convert@1", "args": {"x": "h", "to": "u32"}},
            "o": {"op": "write@1", "args": {"buf": "out", "i": "e", "v": "u"}},
        }),
    )
}

/// Each word hashed with its index by the fixed integer hash. Integer steps only: exact.
fn exact_op() -> Value {
    graph(
        "test.machines.exact@1",
        json!({
            "e": {"op": "element@1", "args": {}},
            "w": {"op": "read@1", "args": {"buf": "words", "i": "e"}},
            "h": {"op": "hash@1", "args": {"a": "w", "b": "e"}},
            "o": {"op": "write@1", "args": {"buf": "out", "i": "e", "v": "h"}},
        }),
    )
}

/// The operator compiled once, and its class as the effects check computes it from its steps.
fn compiled(op: fn() -> Value) -> (Compiled, &'static str) {
    let c = compile(&op()).unwrap_or_else(|i| panic!("the test operator compiles: {i:?}"));
    let class = c.checked.class.name();
    (c, class)
}

static FLOAT: OnceLock<(Compiled, &'static str)> = OnceLock::new();
static EXACT: OnceLock<(Compiled, &'static str)> = OnceLock::new();
static DEVICE: OnceLock<Option<Arc<Device>>> = OnceLock::new();

fn device() -> Option<Arc<Device>> {
    DEVICE
        .get_or_init(|| Gpu::open(Backend::Gpu).ok().map(|g| g.device()))
        .clone()
}

/// The swatch's box as words, run through `op` on the GPU and read back.
fn run(v: &mut View<'_>, op: &(Compiled, &'static str), array: &str) -> Result<(), OpError> {
    let words: Vec<u32> = v
        .item()?
        .pointer("/params/box")
        .and_then(Value::as_array)
        .map(|b| b.iter().map(|n| n.as_f64().unwrap_or(0.0) as u32).collect())
        .unwrap_or_default();
    let mut words = words;
    words.resize(WORDS as usize, 0);
    let device = device().ok_or_else(|| OpError::new("device_lost", v.path()))?;
    let out = deep_effects_render::runner::dispatch(&device, &op.0, &[words]);
    v.write(array, Val::typed(out))
}

/// A check over every swatch: an error for one whose read array the check got nothing for.
fn needs(input: &Value, array: &str) -> Vec<(String, Raised)> {
    let read = input
        .pointer(&format!("/read/{array}"))
        .and_then(Value::as_object);
    let ids: Vec<String> = input
        .get("swatches")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    ids.into_iter()
        .filter(|id| read.and_then(|r| r.get(id)).is_none_or(Value::is_null))
        .map(|id| {
            let raised = Raised {
                code: "test.machines.unread",
                severity: "error",
                path: format!("items/{id}"),
                what: format!("the check got no value of {array} for this swatch"),
                fix_ops: None,
            };
            (id, raised)
        })
        .collect()
}

/// The swatches of a lowered document, by ID.
fn swatches(lowered: &Value) -> Vec<String> {
    lowered
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some(SWATCH))
        .map(|(id, _)| id.clone())
        .collect()
}

fn with_swatches(lowered: &Value, input: &Value) -> Value {
    let mut i = input.clone();
    i["swatches"] = json!(swatches(lowered));
    i
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
            name: "machines.swatch",
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
    let is_swatch =
        |_: &Value, _: &str, item: &Value| item.get("kind").and_then(Value::as_str) == Some(SWATCH);
    let float = FLOAT.get_or_init(|| compiled(float_op));
    let exact = EXACT.get_or_init(|| compiled(exact_op));
    r.array("test.machines.float", "words", "item", "shading", "render");
    r.operator("float", "render", &["self"], &["test.machines.float"])
        .applies(is_swatch)
        .serial()
        .determinism(float.1)
        .run(|v| run(v, FLOAT.get().expect("registered"), "test.machines.float"));
    r.array("test.machines.exact", "words", "item", "shading", "render");
    r.operator("exact", "render", &["self"], &["test.machines.exact"])
        .applies(is_swatch)
        .serial()
        .determinism(exact.1)
        .run(|v| run(v, EXACT.get().expect("registered"), "test.machines.exact"));
    r.check(
        "test.machines.cpu",
        "any",
        &["test.machines.unread"],
        |lowered, _| {
            // CPU data only: each swatch's box, from the lowered document.
            swatches(lowered)
                .into_iter()
                .filter(|id| {
                    lowered
                        .pointer(&format!("/items/{id}/params/box"))
                        .is_none()
                })
                .map(|id| {
                    let raised = Raised {
                        code: "test.machines.unread",
                        severity: "error",
                        path: format!("items/{id}/params/box"),
                        what: "a swatch without its box".into(),
                        fix_ops: None,
                    };
                    (id, raised)
                })
                .collect()
        },
    );
    r.check(
        "test.machines.float",
        "same",
        &["test.machines.unread"],
        |lowered, input| needs(&with_swatches(lowered, input), "test.machines.float"),
    )
    .check_reads(&["test.machines.float"]);
    r.check(
        "test.machines.exact",
        "any",
        &["test.machines.unread"],
        |lowered, input| needs(&with_swatches(lowered, input), "test.machines.exact"),
    )
    .check_reads(&["test.machines.exact"]);
    r.code(
        "test.machines.unread",
        "A swatch whose array the check read nothing of.",
        "Evaluate the swatch before its check runs.",
        false,
    );
}

/// `test.machines`.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
            name: "test.machines".into(),
            version: Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "test-machines".into(),
            license: "Apache-2.0".into(),
            implements: "test.machines@1".into(),
        },
        register,
    }
}
