//! Issue #855's planted twins, each compiled in only under its feature: `test.json`, whose
//! operator in phase items writes JSON, which the seal refuses (`test-json`), and `test.dbg`,
//! whose result's canonical bytes are its Debug text, so a build that prints Debug another way
//! (`test-debug-alt`) gives it another digest (`test-debug-digest`). Neither is in a shipped build.
//! Its helpers build #387's `test.accent` and #857's `test.serial` and `test.racy` too.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
#[cfg(any(feature = "test-json", feature = "test-debug-digest"))]
use deep_canvas::registry::Module;
use deep_canvas::registry::{Manifest, Range, Registrar, Semver};
use serde_json::Value;

/// #421's planted implementation of scene3d@1, `scene3d.tie_by_order`: the shipped module
/// declared bit and canonical whose light policy breaks a tie by registration order instead of by
/// ID, which the kit's `bit` part fails, naming the fixture and the first field.
pub(crate) fn scene3d_tie_by_order() -> deep_canvas::registry::Module {
    let mut m = deep_canvas_scene3d::module::module();
    m.manifest.implementation.name = "scene3d.tie_by_order".into();
    m.register =
        |r| deep_canvas_scene3d::module::register_with(r, deep_canvas_scene3d::light::Tie::Order);
    m
}

/// #443's planted scene3d: the shipped module with one more operator, whose extrude reads
/// vector@1's items itself through vector's own array instead of the core's `outline.source@1`;
/// scene3d declares no dependency on vector, so the seal refuses the edge, naming both.
#[cfg(feature = "test-scene3d-reads-vector")]
pub(crate) fn scene3d_reads_vector() -> deep_canvas::registry::Module {
    let mut m = deep_canvas_scene3d::module::module();
    m.register = |r| {
        deep_canvas_scene3d::module::register_with(r, deep_canvas_scene3d::light::Tie::Id);
        r.array(
            "scene3d.svgoutlines",
            "outlines",
            "item",
            "geometry",
            "items",
        );
        r.operator(
            "svgoutlines",
            "items",
            &["vector.paint"],
            &["scene3d.svgoutlines"],
        )
        .run(|_| Ok(()));
    };
    m
}

/// #538's planted data module: the shipped module with one more operator, whose read set names a
/// logic item's array (`logic.cells`) itself instead of reading it through the core's column view;
/// the seal refuses the read, naming the data module and the array.
#[cfg(feature = "test-data-reads-logic-array")]
pub(crate) fn data_reads_logic_array() -> deep_canvas::registry::Module {
    let mut m = deep_canvas_marks::modules::data();
    m.register = |r| {
        (deep_canvas_marks::modules::data().register)(r);
        r.array("data.direct", "values", "item", "geometry", "items");
        r.operator("direct", "items", &["logic.cells"], &["data.direct"])
            .run(|_| Ok(()));
    };
    m
}

/// A test module's manifest: version 1.0.0, any core, under its feature.
pub(crate) fn test_manifest(name: &str, feature: &str) -> Manifest {
    Manifest {
        name: name.into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: Default::default(),
        feature: feature.into(),
        license: "Apache-2.0".into(),
        implements: format!("{name}@1"),
        implementation: deep_canvas::registry::Implementation::reference(
            name,
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// Registers a test kind `test.<name>@1` with a box, drawn as `rect@1`.
pub(crate) fn boxed_kind(r: &mut Registrar, name: &'static str) {
    r.kind(
        Entry {
            family: "test",
            name,
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: vec![Param {
                    name: "box",
                    ty: ParamType::Json("[x, y, w, h]"),
                    unit: "",
                    default: Value::Null,
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                }],
            }],
            migrations: vec![],
        },
        &[],
        "rect@1",
    );
}

pub(crate) fn of_kind(item: &Value, kind: &str) -> bool {
    item.get("kind").and_then(Value::as_str) == Some(kind)
}

/// The item's box's area.
#[cfg(any(feature = "test-accent", feature = "test-threads"))]
pub(crate) fn area(
    v: &mut deep_canvas::schedule::View<'_>,
) -> Result<f64, deep_canvas::schedule::OpError> {
    Ok(v.item()?
        .pointer("/params/box")
        .and_then(Value::as_array)
        .map(|b| {
            b.get(2).and_then(Value::as_f64).unwrap_or(0.0)
                * b.get(3).and_then(Value::as_f64).unwrap_or(0.0)
        })
        .unwrap_or(0.0))
}

/// #855's planted frame-phase JSON writer: `test.json.out` writes its item's box as JSON in
/// phase items, which the seal refuses; `test.json.audit` writes JSON in phase check, which it
/// admits.
#[cfg(feature = "test-json")]
pub fn json_writer() -> Module {
    use deep_canvas::registry::JSON;
    use deep_canvas::schedule::Val;
    use serde_json::json;
    Module {
        manifest: test_manifest("test.json", "test-json"),
        register: |r| {
            boxed_kind(r, "json");
            r.array("test.json.out", JSON, "item", "geometry", "items");
            r.array("test.json.audit", JSON, "item", "geometry", "check");
            r.operator("out", "items", &["self"], &["test.json.out"])
                .applies(|_, _, item| of_kind(item, "test.json@1"))
                .run(|v| {
                    let b = v.item()?.pointer("/params/box").cloned();
                    v.write("test.json.out", Val::json(json!({"box": b})))
                });
            r.operator("audit", "check", &["self"], &["test.json.audit"])
                .applies(|_, _, item| of_kind(item, "test.json@1"))
                .run(|v| {
                    let ok = v.item()?.pointer("/params/box").is_some();
                    v.write("test.json.audit", Val::json(json!({"ok": ok})))
                });
        },
    }
}

/// #855's planted result: canonical bytes that are its Debug text, so a build whose Debug
/// output differs gives it another digest.
#[cfg(feature = "test-debug-digest")]
#[derive(Debug)]
pub struct DebugDigested {
    #[allow(dead_code)] // read only through its Debug text
    pub area: f64,
}

#[cfg(feature = "test-debug-digest")]
impl deep_canvas::schedule::Canonical for DebugDigested {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(crate::frames::debug_text(self).as_bytes());
    }
}

/// `test.dbg`: `test.dbg.out` writes a [`DebugDigested`] of its item's box area.
#[cfg(feature = "test-debug-digest")]
pub fn debug_digest() -> Module {
    use deep_canvas::schedule::Val;
    Module {
        manifest: test_manifest("test.dbg", "test-debug-digest"),
        register: |r| {
            boxed_kind(r, "dbg");
            r.array("test.dbg.out", "area", "item", "geometry", "items");
            r.operator("out", "items", &["self"], &["test.dbg.out"])
                .applies(|_, _, item| of_kind(item, "test.dbg@1"))
                .run(|v| {
                    let b = v.item()?.pointer("/params/box").and_then(Value::as_array);
                    let side = |k: usize| b.and_then(|b| b.get(k)?.as_f64()).unwrap_or(0.0);
                    v.write(
                        "test.dbg.out",
                        Val::typed(DebugDigested {
                            area: side(2) * side(3),
                        }),
                    )
                });
        },
    }
}
