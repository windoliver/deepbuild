//! The test canvas modules of the #305 acceptance README (The surface under test: Build sets and
//! the test canvas modules): `test.a` and `test.b` (b reads a's array through one operator, a
//! optional or required), and the fault modules whose set the seal must refuse: two writers of
//! one array, a read of a later phase, a cycle and a missing dependency. Each is one manifest and
//! one register call; `deep-show` puts each in a build under its own Cargo feature.

use std::collections::BTreeMap;

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Raised, Range, Registrar, Semver};
use deep_canvas::schedule::{OpError, Val, View};
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

// ------------------------------------------------------------------------------------------------
// Issue #387: the test canvas modules of the #387 acceptance README (The test canvas modules).

fn number(name: &'static str) -> Param {
    Param {
        name,
        ty: ParamType::F32,
        unit: "u",
        default: json!(0),
        min: Some(-1.0e6),
        max: Some(1.0e6),
        minor: 0,
        module: "",
        operator: "",
    }
}

fn json_param(name: &'static str) -> Param {
    Param {
        name,
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

fn of_kind(item: &Value, kind: &str) -> bool {
    item.get("kind").and_then(Value::as_str) == Some(kind)
}

fn has_kind(doc: &Value, kind: &str) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| items.values().any(|i| of_kind(i, kind)))
}

fn with_version(name: &str, minor: u64) -> Manifest {
    let mut m = manifest(name, &[]);
    m.version.minor = minor;
    m
}

fn register_up(r: &mut Registrar) {
    r.kind(
        kind("test", "up", vec![box_param(), number("value")]),
        &[],
        "rect@1",
    );
    r.array("test.up.value", "f32", "item", "geometry", "items");
    r.array("test.up.audit", "bool", "item", "geometry", "check");
    r.operator("value", "items", &["self"], &["test.up.value"])
        .applies(|_, _, item| of_kind(item, "test.up@1"))
        .run(|v| {
            let value = v
                .item()?
                .pointer("/params/value")
                .cloned()
                .unwrap_or(json!(0));
            v.write("test.up.value", Val::json(value))
        });
    r.operator("audit", "check", &["self"], &["test.up.audit"])
        .applies(|_, _, item| of_kind(item, "test.up@1"))
        .run(|v| {
            let ok = v
                .item()?
                .pointer("/params/box")
                .and_then(Value::as_array)
                .is_some_and(|b| b.len() == 4);
            v.write("test.up.audit", Val::json(json!(ok)))
        });
}

/// `test.up` 1.0.0: a kind `test.up@1`, an items operator and a check whose results its
/// version keys.
pub fn up_1_0() -> Module {
    Module {
        manifest: with_version("test.up", 0),
        register: register_up,
    }
}

/// `test.up` 1.1.0, registered the same: an upgrade.
pub fn up_1_1() -> Module {
    Module {
        manifest: with_version("test.up", 1),
        register: register_up,
    }
}

fn register_nudge(r: &mut Registrar) {
    r.kind(
        kind(
            "test",
            "nudge",
            vec![box_param(), number("dx"), number("dy")],
        ),
        &[],
        "rect@1",
    );
    r.contribution(
        "test.nudge.offset",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.operator("offset", "items", &["self"], &["test.nudge.offset"])
        .applies(|_, _, item| of_kind(item, "test.nudge@1"))
        .run(|v| {
            let item = v.item()?;
            let at = |k: &str| {
                item.pointer(&format!("/params/{k}"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
            };
            let edits = json!([{"op": "add", "path": ["pos"], "value": [at("dx"), at("dy"), 0.0]}]);
            v.write("test.nudge.offset", Val::json(edits))
        });
}

/// `test.nudge`: its items move by `[dx, dy]`, contributed to the core's transform, which never
/// names it.
pub fn nudge() -> Module {
    Module {
        manifest: manifest("test.nudge", &[]),
        register: register_nudge,
    }
}

/// One step: this module's count one up from what its last step left, and the other module's
/// count read at this step's time (`at_time`) or as earlier steps left it.
fn step(v: &mut View<'_>, own: &str, other: &str, at_time: bool) -> Result<(), OpError> {
    let count = v
        .carried(own)
        .and_then(|c| match c {
            Val::Json(j) => j.as_i64(),
            _ => None,
        })
        .unwrap_or(0)
        + 1;
    let read = if at_time {
        v.array(other)?
    } else {
        v.earlier(other)?
    };
    let read = read
        .and_then(|c| match c {
            Val::Json(j) => j.as_i64(),
            _ => None,
        })
        .unwrap_or(0);
    v.note_step(count, read);
    v.write(own, Val::json(json!(count)))
}

/// A stepping module `name` at `hz`, reading `other`'s count at its own step's time or as
/// earlier steps left it.
fn stepper(
    r: &mut Registrar,
    name: &'static str,
    hz: i64,
    reads: &str,
    run: deep_canvas::registry::Run,
) {
    let (family, rest) = name.split_once('.').expect("a dotted name");
    let short: &'static str = match rest {
        "step.a" => "step.a",
        "step.b" => "step.b",
        "step.y" => "step.y",
        "step.x" => "step.x",
        "loop.p" => "loop.p",
        _ => "loop.q",
    };
    r.kind(kind(leak(family), short, vec![]), &[], "");
    let count = format!("{name}.count");
    r.array(&count, "i64", "document", "time", "simulate");
    r.operator("step", "simulate", &[reads], &[&count])
        .steps(705_600_000 / hz)
        .applies(match name {
            "test.step.a" => |doc, _, _| has_kind(doc, "test.step.a@1"),
            "test.step.b" => |doc, _, _| has_kind(doc, "test.step.b@1"),
            "test.step.y" => |doc, _, _| has_kind(doc, "test.step.y@1"),
            "test.step.x" => |doc, _, _| has_kind(doc, "test.step.x@1"),
            "test.loop.p" => |doc, _, _| has_kind(doc, "test.loop.p@1"),
            _ => |doc, _, _| has_kind(doc, "test.loop.q@1"),
        })
        .run(run);
}

fn leak(family: &str) -> &'static str {
    match family {
        "test" => "test",
        _ => "",
    }
}

/// `test.step.a` (60 Hz) and `test.step.b` (120 Hz): b reads a's count at its own step's time,
/// a reads b's as earlier steps left it.
pub fn steps() -> [Module; 2] {
    [
        Module {
            manifest: manifest("test.step.a", &[("test.step.b", false)]),
            register: |r| {
                stepper(r, "test.step.a", 60, "earlier(test.step.b.count)", |v| {
                    step(v, "test.step.a.count", "test.step.b.count", false)
                })
            },
        },
        Module {
            manifest: manifest("test.step.b", &[("test.step.a", false)]),
            register: |r| {
                stepper(r, "test.step.b", 120, "test.step.a.count", |v| {
                    step(v, "test.step.b.count", "test.step.a.count", true)
                })
            },
        },
    ]
}

/// The same pair renamed so b's name sorts first: `test.step.y` in a's role, `test.step.x` in
/// b's.
pub fn steps_renamed() -> [Module; 2] {
    [
        Module {
            manifest: manifest("test.step.y", &[("test.step.x", false)]),
            register: |r| {
                stepper(r, "test.step.y", 60, "earlier(test.step.x.count)", |v| {
                    step(v, "test.step.y.count", "test.step.x.count", false)
                })
            },
        },
        Module {
            manifest: manifest("test.step.x", &[("test.step.y", false)]),
            register: |r| {
                stepper(r, "test.step.x", 120, "test.step.y.count", |v| {
                    step(v, "test.step.x.count", "test.step.y.count", true)
                })
            },
        },
    ]
}

/// `test.loop.p` and `test.loop.q`, each reading the other's count at its own step's time: a
/// cycle the seal refuses.
pub fn steps_cycle() -> [Module; 2] {
    [
        Module {
            manifest: manifest("test.loop.p", &[("test.loop.q", false)]),
            register: |r| {
                stepper(r, "test.loop.p", 60, "test.loop.q.count", |v| {
                    step(v, "test.loop.p.count", "test.loop.q.count", true)
                })
            },
        },
        Module {
            manifest: manifest("test.loop.q", &[("test.loop.p", false)]),
            register: |r| {
                stepper(r, "test.loop.q", 60, "test.loop.p.count", |v| {
                    step(v, "test.loop.q.count", "test.loop.p.count", true)
                })
            },
        },
    ]
}

/// A placed point set: one position per row, in the item's box.
#[derive(Debug)]
pub struct Points(pub Vec<[f64; 2]>);

fn points_val(points: Vec<[f64; 2]>) -> Val {
    let mut bytes = Vec::with_capacity(points.len() * 16);
    for p in &points {
        bytes.extend_from_slice(&p[0].to_le_bytes());
        bytes.extend_from_slice(&p[1].to_le_bytes());
    }
    Val::typed(Points(points), bytes)
}

fn register_scatter(r: &mut Registrar) {
    r.kind(
        kind(
            "test",
            "scatter",
            vec![
                box_param(),
                json_param("source"),
                json_param("column"),
                number("n"),
            ],
        ),
        &[],
        "rect@1",
    );
    r.array("test.scatter.positions", "vec2", "row", "geometry", "items");
    r.array(
        "test.scatter.drawn",
        "draw_list",
        "row",
        "geometry",
        "items",
    );
    r.operator(
        "layout",
        "items",
        &["self", "reading"],
        &["test.scatter.positions"],
    )
    .applies(|_, _, item| of_kind(item, "test.scatter@1"))
    .run(|v| {
        let item = v.item()?;
        let p = |k: &str| {
            item.pointer(&format!("/params/{k}"))
                .cloned()
                .unwrap_or(Value::Null)
        };
        let b: Vec<f64> = p("box")
            .as_array()
            .map(|b| b.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        let [x, y, w, h] = <[f64; 4]>::try_from(b.as_slice()).unwrap_or([0.0; 4]);
        let n = p("n").as_u64().unwrap_or(0) as usize;
        let name = format!(
            "{}.{}",
            p("source").as_str().unwrap_or(""),
            p("column").as_str().unwrap_or("")
        );
        let outside = v.outside()?;
        let values: Vec<f64> = outside
            .columns
            .get(&name)
            .map(|c| {
                let (eights, _) = c.bytes.as_chunks::<8>();
                eights.iter().map(|b| f64::from_le_bytes(*b)).collect()
            })
            .unwrap_or_default();
        let rows = n.min(values.len());
        let step = if rows > 1 { w / (rows - 1) as f64 } else { 0.0 };
        let points = (0..rows)
            .map(|i| [x + step * i as f64, y + h * (1.0 - values[i])])
            .collect();
        v.write("test.scatter.positions", points_val(points))
    });
    r.operator(
        "draw",
        "items",
        &["self", "test.scatter.positions"],
        &["test.scatter.drawn"],
    )
    .applies(|_, _, item| of_kind(item, "test.scatter@1"))
    .run(|v| {
        let item = v.item()?;
        let b: Vec<f64> = item
            .pointer("/params/box")
            .and_then(Value::as_array)
            .map(|b| b.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        let [x, y, w, h] = <[f64; 4]>::try_from(b.as_slice()).unwrap_or([0.0; 4]);
        let points = v
            .typed::<Points>("test.scatter.positions")?
            .map(|p| p.0.clone())
            .unwrap_or_default();
        // The draw list: each point inside the box, as one instance record.
        let drawn = points
            .into_iter()
            .filter(|p| p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h)
            .collect();
        v.write("test.scatter.drawn", points_val(drawn))
    });
}

/// `test.scatter`: a mark set of `n` points whose positions a layout operator places from a
/// source's column, and a draw operator that reads them.
pub fn scatter() -> Module {
    Module {
        manifest: manifest("test.scatter", &[]),
        register: register_scatter,
    }
}

fn register_peek(r: &mut Registrar) {
    r.kind(kind("test", "peek", vec![box_param()]), &[], "rect@1");
    r.array("test.peek.out", "str", "item", "text", "items");
    // It asks for the view's locale, which it didn't declare: refused, and in a test build
    // logged.
    r.operator("out", "items", &["self"], &["test.peek.out"])
        .applies(|_, _, item| of_kind(item, "test.peek@1"))
        .run(|v| {
            let _ = v.item()?;
            let locale = v.locale()?.to_string();
            v.write("test.peek.out", Val::json(json!(locale)))
        });
}

/// `test.peek`: an operator that reads what it didn't declare.
pub fn peek() -> Module {
    Module {
        manifest: manifest("test.peek", &[]),
        register: register_peek,
    }
}

fn str_param(name: &'static str, default: &str) -> Param {
    Param {
        ty: ParamType::Str,
        default: json!(default),
        ..json_param(name)
    }
}

/// The pass that draws `test.texture@1` and `test.mesh@1` items into the 3D linear target.
pub const TEST_GPU_DRAW: &str = "test.gpu.draw";
/// `test.burn`, the operator `test.burn@1` items run: one pass over the view.
pub const TEST_BURN: &str = "test.burn";

fn register_test_gpu(r: &mut Registrar) {
    r.kind(
        kind(
            "test",
            "texture",
            vec![
                json_param("size"),
                str_param("format", "rgba8"),
                json_param("mips"),
                str_param("pattern", ""),
            ],
        ),
        &[],
        "",
    );
    r.kind(
        kind(
            "test",
            "mesh",
            vec![
                json_param("vertices"),
                str_param("seed", ""),
                str_param("asset", ""),
            ],
        ),
        &[],
        "",
    );
    r.kind(kind("test", "burn", vec![json_param("loops")]), &[], "");
    r.pass(TEST_GPU_DRAW, "geometry");
    r.pass(TEST_BURN, "effects");
}

/// `test.gpu` (issue #379, tests/acceptance/379/README.md: The test canvas module): a texture
/// with its whole mip chain and a generated mesh, each a result keyed by its content key, and
/// `test.burn`, an effect whose fragment loops `loops` times per pixel. Only `deep-gpu`'s
/// `test-meter` build holds it.
pub fn test_gpu() -> Module {
    Module {
        manifest: manifest("test.gpu", &[]),
        register: register_test_gpu,
    }
}

// Issue #371: the test canvas modules of the #371 acceptance README (Test builds).

/// The most characters `test.titlecap` lets a title have.
const TITLE_CAP: usize = 20;

fn title_rule(_doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let text = item["params"]["text"].as_str().unwrap_or_default();
    if text.chars().count() <= TITLE_CAP {
        return Vec::new();
    }
    vec![Raised {
        code: "title_too_long",
        severity: "error",
        path: format!("items/{id}/params/text"),
        what: format!("a title of over {TITLE_CAP} characters"),
        fix_ops: None,
    }]
}

fn register_title_cap(r: &mut Registrar) {
    r.rule("text", title_rule);
    r.code(
        "title_too_long",
        "A text item over 20 characters, which this release's stricter rule refuses.",
        "Shorten the text to 20 characters or fewer.",
        false,
    );
}

/// `test.titlecap`: a new release's stricter rule, an error on every `text@1` over 20
/// characters.
pub fn title_cap() -> Module {
    Module {
        manifest: manifest("test.titlecap", &[]),
        register: register_title_cap,
    }
}

fn register_deprecated(r: &mut Registrar) {
    r.kind(kind("test", "old", vec![box_param()]), &[], "rect@1")
        .deprecated("1.1.0", "test.new@1");
    r.kind(kind("test", "new", vec![box_param()]), &[], "rect@1");
}

/// `test.deprecated`: `test.old@1`, deprecated since 1.1.0 for `test.new@1`; each draws its `box`
/// as a `rect@1`.
pub fn deprecated() -> Module {
    Module {
        manifest: manifest("test.deprecated", &[]),
        register: register_deprecated,
    }
}
