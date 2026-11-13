//! The test canvas modules of the #200 acceptance README (Test canvas modules and features of
//! `deep-show`): `test.mark`, which declares `test.mark@1` and fills its entry `dot`, and its
//! variants; `test.mode`, whose closed list `a | b` opens as `test.mode@1`; `test.fill.a`,
//! `test.fill.b` and `test.fill.c`, which fill the core's `test.shape@1` and `test.fill.c`'s own
//! `test.part@1`; `test.gpustep`, which registers a GPU step; `test.rules`, a kit of three rules;
//! and `test.load`, ten registries of 100 entries.

use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::registry::lists::RegistryDef;
use deep_canvas::registry::{Module, Raised, Registrar};
use deep_canvas::schedule::Val;
use serde_json::{json, Value};

use super::{box_param, kind, manifest};

/// The release the test registries open in.
const SINCE: &str = "R2";

fn mark_schema() -> Value {
    json!({"type": "object", "properties": {"name": {"type": "string"},
           "size": {"type": "integer", "minimum": 0, "maximum": 4294967295u64}},
           "required": ["name", "size"], "additionalProperties": false})
}

/// The schema `test-mark-schema-changed` and `test.mark@2` have: a required `color` added.
fn colored_schema() -> Value {
    json!({"type": "object", "properties": {"name": {"type": "string"},
           "size": {"type": "integer", "minimum": 0, "maximum": 4294967295u64}, "color": {"type": "string"}},
           "required": ["name", "size", "color"], "additionalProperties": false})
}

fn size_at_most_64(v: &Value) -> Result<(), String> {
    match v["size"].as_u64() {
        Some(s) if s > 64 => Err(format!("size {s} is over 64")),
        _ => Ok(()),
    }
}

fn size_even(v: &Value) -> Result<(), String> {
    match v["size"].as_u64() {
        Some(s) if s % 2 == 1 => Err(format!("size {s} is odd")),
        _ => Ok(()),
    }
}

fn name_lowercase(v: &Value) -> Result<(), String> {
    match v["name"].as_str() {
        Some(n) if n.chars().any(|c| c.is_ascii_uppercase()) => {
            Err(format!("`{n}` has an upper-case letter"))
        }
        _ => Ok(()),
    }
}

const OVER_64: &str = "an entry whose size is over 64";

/// `test.mark@1` as `test-mark` declares it: filled by modules at the seal and packs at check.
fn mark_def() -> RegistryDef {
    RegistryDef::new("test.mark@1", mark_schema(), &["module", "pack"], SINCE)
        .rule("size_at_most_64", OVER_64, size_at_most_64)
        .planted("big", json!({"name": "big", "size": 65}))
}

/// The document check kind that holds a requirement to an entry of `test.mark@1`: it passes when
/// the entry the input names resolves through the deliverable's pinned packs (or is the module's
/// own) and passes the kit; the hub hands the resolved entry in as `resolved`.
fn fits(_doc: &Value, input: &Value) -> Vec<(String, Raised)> {
    let entry = input["entry"].as_str().unwrap_or_default();
    if input["resolved"]["kit"]["verdict"] == "PASS" {
        return Vec::new();
    }
    vec![(
        String::new(),
        Raised {
            code: "test_mark_unfit",
            severity: "error",
            path: "entry".into(),
            what: format!(
                "`{entry}` doesn't resolve to an entry of test.mark@1 that passes its kit"
            ),
            fix_ops: None,
        },
    )]
}

fn mark_shapes(r: &mut Registrar, def: RegistryDef, dot: Value) {
    r.registry(def);
    r.entry("test.mark@1", "dot", dot, SINCE);
    r.check("test.mark.fits", "any", &["test_mark_unfit"], fits);
    r.code(
        "test_mark_unfit",
        "A requirement names an entry of test.mark@1 that doesn't resolve or fails its kit.",
        "Name an entry the document's packs fill, which passes test.mark@1's kit.",
        false,
    );
}

fn mark_module(register: fn(&mut Registrar)) -> Module {
    Module {
        manifest: manifest("test.mark", &[]),
        register,
    }
}

/// `test-mark`: `test.mark@1` with its entry `dot {size: 8}`.
pub fn mark() -> Module {
    mark_module(|r| mark_shapes(r, mark_def(), json!({"name": "dot", "size": 8})))
}

/// `test-mark-dot-9`: the same with `dot {size: 9}`.
pub fn mark_dot_9() -> Module {
    mark_module(|r| mark_shapes(r, mark_def(), json!({"name": "dot", "size": 9})))
}

/// `test-mark-no-planted`: `test.mark@1` declared with no planted wrong entry.
pub fn mark_no_planted() -> Module {
    mark_module(|r| {
        let mut def = mark_def();
        def.planted.clear();
        mark_shapes(r, def, json!({"name": "dot", "size": 8}));
    })
}

/// `test-mark-no-since`: `test.mark@1` declared with no since.
pub fn mark_no_since() -> Module {
    mark_module(|r| {
        let mut def = mark_def();
        def.since = None;
        mark_shapes(r, def, json!({"name": "dot", "size": 8}));
    })
}

/// `test-mark-binds-author`: `test.mark@1` binding author.
pub fn mark_binds_author() -> Module {
    mark_module(|r| {
        let mut def = mark_def();
        def.binds = "author";
        mark_shapes(r, def, json!({"name": "dot", "size": 8}));
    })
}

/// `test-mark-schema-changed`: `test.mark@1`'s entry schema with a required `color`, under the
/// same major.
pub fn mark_schema_changed() -> Module {
    mark_module(|r| {
        let mut def = mark_def();
        def.entry = colored_schema();
        def.planted[0].value["color"] = json!("red");
        mark_shapes(r, def, json!({"name": "dot", "size": 8, "color": "black"}));
    })
}

/// `test-mark-v2`: `test.mark@1` as `test-mark`, deprecated since R3 and replaced by
/// `test.mark@2`, beside `test.mark@2` with the changed schema, since R3.
pub fn mark_v2() -> Module {
    mark_module(|r| {
        let mut one = mark_def();
        one.deprecated_since = Some("R3".into());
        one.replaced_by = Some("test.mark@2".into());
        mark_shapes(r, one, json!({"name": "dot", "size": 8}));
        r.registry(
            RegistryDef::new("test.mark@2", colored_schema(), &["module", "pack"], "R3")
                .rule("size_at_most_64", OVER_64, size_at_most_64)
                .planted("big", json!({"name": "big", "size": 65, "color": "red"})),
        );
    })
}

/// `test.mark.other`, which `test-mark-dot-twice` adds: it fills a second entry `dot` into
/// `test.mark@1`, which `test.mark` declares.
pub fn mark_other() -> Module {
    Module {
        manifest: manifest("test.mark.other", &[]),
        register: |r| {
            r.entry(
                "test.mark@1",
                "dot",
                json!({"name": "dot", "size": 4}),
                SINCE,
            );
        },
    }
}

// ---- test.mode: a closed list a | b, and its opening as test.mode@1.

/// The ordinal each mode codes to: the closed list's order, which the opening's first entries
/// keep; the planted opening renumbers them.
const MODES: [(&str, f64); 2] = [("a", 0.0), ("b", 1.0)];
const RENUMBERED: [(&str, f64); 2] = [("a", 1.0), ("b", 0.0)];

fn mode_param() -> Param {
    Param {
        name: "mode",
        ty: ParamType::Str,
        unit: "",
        default: json!("a"),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn ordinal(modes: &[(&str, f64); 2], params: &Value) -> f64 {
    let mode = params["mode"].as_str().unwrap_or("a");
    modes
        .iter()
        .find(|(m, _)| *m == mode)
        .map_or(-1.0, |(_, n)| *n)
}

fn mode_rule(_doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let mode = item["params"]["mode"].as_str().unwrap_or("a");
    if MODES.iter().any(|(m, _)| *m == mode) {
        return Vec::new();
    }
    vec![Raised {
        code: "test_mode_unknown",
        severity: "error",
        path: format!("items/{id}/params/mode"),
        what: format!("mode `{mode}` is not one of a | b"),
        fix_ops: None,
    }]
}

fn swatches() -> Value {
    json!({
        "format": 1, "profile": "board", "title": "Swatches of both modes",
        "description": "A fixture of the test.mode test canvas module: one swatch in each mode.",
        "size": [320, 200], "requires": {"modules": {"test.mode": "^1"}},
        "items": {
            "one": {"id": "one", "kind": "test.swatch@1", "name": "One", "order": "a0", "params": {"box": [20, 20, 100, 60], "mode": "a"}},
            "two": {"id": "two", "kind": "test.swatch@1", "name": "Two", "order": "a1", "params": {"box": [160, 20, 100, 60], "mode": "b"}}
        }
    })
}

/// The kind, its operator writing each swatch's ordinal, its rule, its fixture and, opened,
/// `test.mode@1` with the list's values as its first entries.
fn mode_shapes(
    r: &mut Registrar,
    modes: &'static [(&'static str, f64); 2],
    opened: bool,
    draw: fn(&Value) -> Value,
    code: deep_canvas::registry::Run,
) {
    r.kind(
        kind("test", "swatch", vec![box_param(), mode_param()]),
        &["test.mode.code"],
        "rect@1",
    )
    .drawn(draw);
    r.array("test.mode.code", "f64", "item", "params", "items");
    r.operator("code", "items", &["self"], &["test.mode.code"])
        .applies(|_, _, item| item["kind"] == "test.swatch@1")
        .run(code);
    r.rule("test.swatch", |d, i, it, _| mode_rule(d, i, it));
    r.code(
        "test_mode_unknown",
        "A swatch whose mode is not one of the closed list a | b.",
        "Set the mode to a or b.",
        false,
    );
    r.fixture("swatches", swatches(), None);
    if opened {
        r.registry(
            RegistryDef::new("test.mode@1", json!({"type": "object", "properties": {"ordinal": {"type": "number"}}, "required": ["ordinal"]}), &["module"], SINCE)
                .rule("ordinal", "a mode without a whole ordinal", |v| match v["ordinal"].as_f64() {
                    Some(n) if n >= 0.0 && n.fract() == 0.0 => Ok(()),
                    _ => Err(format!("ordinal {} is no whole number", v["ordinal"])),
                })
                .planted("half", json!({"ordinal": 0.5})),
        );
        for (mode, n) in modes {
            r.entry("test.mode@1", mode, json!({"ordinal": n}), SINCE);
        }
    }
}

fn swatch_draw(modes: &[(&str, f64); 2], params: &Value) -> Value {
    let role = if ordinal(modes, params) == 0.0 {
        "accent"
    } else {
        "muted"
    };
    json!({"box": params.get("box").cloned().unwrap_or(Value::Null), "paint": {"fill": {"role": role}}})
}

fn write_code(
    v: &mut deep_canvas::schedule::View<'_>,
    modes: &[(&str, f64); 2],
) -> Result<(), deep_canvas::schedule::OpError> {
    let n = ordinal(modes, &v.item()?["params"]);
    v.write("test.mode.code", Val::typed(n))
}

/// `test-mode-closed`: the list a | b closed.
pub fn mode_closed() -> Module {
    Module {
        manifest: manifest("test.mode", &[]),
        register: |r| {
            mode_shapes(
                r,
                &MODES,
                false,
                |p| swatch_draw(&MODES, p),
                |v| write_code(v, &MODES),
            )
        },
    }
}

/// `test-mode-registry`: the list opened as `test.mode@1`, whose first entries keep the list's
/// order.
pub fn mode_registry() -> Module {
    Module {
        manifest: manifest("test.mode", &[]),
        register: |r| {
            mode_shapes(
                r,
                &MODES,
                true,
                |p| swatch_draw(&MODES, p),
                |v| write_code(v, &MODES),
            )
        },
    }
}

/// `test-mode-renumbered`: the planted opening that renumbers the entries.
pub fn mode_renumbered() -> Module {
    Module {
        manifest: manifest("test.mode", &[]),
        register: |r| {
            mode_shapes(
                r,
                &RENUMBERED,
                true,
                |p| swatch_draw(&RENUMBERED, p),
                |v| write_code(v, &RENUMBERED),
            )
        },
    }
}

// ---- test.fill: entries in the core's test.shape@1, and test.fill.c's own test.part@1.

fn small(v: &Value) -> Result<(), String> {
    match v["sides"].as_u64() {
        Some(s) if s <= 64 => Ok(()),
        _ => Err(format!("sides {} is not a count up to 64", v["sides"])),
    }
}

/// `test.shape@1`, which the core declares in a build with a `test-fill-*` feature.
pub fn shape_def() -> RegistryDef {
    RegistryDef::new("test.shape@1", json!({"type": "object", "properties": {"sides": {"type": "integer"}}, "required": ["sides"]}), &["module"], SINCE)
        .rule("sides_up_to_64", "a shape of more than 64 sides", small)
        .planted("many", json!({"sides": 65}))
}

/// `test.fill.a`: fills `square` into `test.shape@1`.
pub fn fill_a() -> Module {
    Module {
        manifest: manifest("test.fill.a", &[]),
        register: |r| {
            r.entry("test.shape@1", "square", json!({"sides": 4}), SINCE);
        },
    }
}

/// `test.fill.b`: fills `circle` into `test.shape@1`.
pub fn fill_b() -> Module {
    Module {
        manifest: manifest("test.fill.b", &[]),
        register: |r| {
            r.entry("test.shape@1", "circle", json!({"sides": 0}), SINCE);
        },
    }
}

/// `test.fill.b` as `test-fill-b-part` has it: also an entry `wheel` in `test.part@1`, which
/// `test.fill.c` declares.
pub fn fill_b_part() -> Module {
    Module {
        manifest: manifest("test.fill.b", &[]),
        register: |r| {
            r.entry("test.shape@1", "circle", json!({"sides": 0}), SINCE);
            r.entry("test.part@1", "wheel", json!({"sides": 0}), SINCE);
        },
    }
}

/// `test.fill.c`: declares `test.part@1`.
pub fn fill_c() -> Module {
    Module {
        manifest: manifest("test.fill.c", &[]),
        register: |r| {
            r.registry(
                RegistryDef::new("test.part@1", json!({"type": "object", "properties": {"sides": {"type": "integer"}}, "required": ["sides"]}), &["module"], SINCE)
                    .rule("sides_up_to_64", "a part of more than 64 sides", small)
                    .planted("many", json!({"sides": 65})),
            );
            r.entry("test.part@1", "axle", json!({"sides": 2}), SINCE);
        },
    }
}

// ---- test.gpustep: a GPU step a canvas module registers.

fn mix_step() -> Value {
    json!({
        "signature": {"ports": ["a", "b", "t"], "kinds": ["material", "pass", "compute"]},
        "weight": 3, "fetches": 0, "exact": false,
        "impl": {"body": ["add", ["mul", "a", ["sub", 1, "t"]], ["mul", "b", "t"]]},
        "fixture": [{"args": [{"f": 0}, {"f": 10}, {"f": 0.25}], "expect": {"f": 2.5}},
                    {"args": [{"f": 2}, {"f": 4}, {"f": 1}], "expect": {"f": 4}}],
        "twin": {"perturb": "off_by_one"},
    })
}

fn gpustep_module(register: fn(&mut Registrar)) -> Module {
    Module {
        manifest: manifest("test.gpustep", &[]),
        register,
    }
}

/// `test-gpustep`: `test.gpustep.mix@1` in `gpu.step@1`, with its exactness fixture and twin.
pub fn gpustep() -> Module {
    gpustep_module(|r| {
        r.entry("gpu.step@1", "test.gpustep.mix@1", mix_step(), SINCE);
    })
}

/// `test-gpustep-no-fixture`: the step without its exactness fixture.
pub fn gpustep_no_fixture() -> Module {
    gpustep_module(|r| {
        let mut v = mix_step();
        v.as_object_mut().map(|o| o.remove("fixture"));
        r.entry("gpu.step@1", "test.gpustep.mix@1", v, SINCE);
    })
}

/// `test-gpustep-no-twin`: the step without its planted twin.
pub fn gpustep_no_twin() -> Module {
    gpustep_module(|r| {
        let mut v = mix_step();
        v.as_object_mut().map(|o| o.remove("twin"));
        r.entry("gpu.step@1", "test.gpustep.mix@1", v, SINCE);
    })
}

// ---- test.rules: a kit of three rules.

fn rules_def() -> RegistryDef {
    RegistryDef::new("test.rules@1", mark_schema(), &["module"], SINCE)
        .rule("size_at_most_64", OVER_64, size_at_most_64)
        .rule("size_even", "an entry whose size is odd", size_even)
        .rule(
            "name_lowercase",
            "an entry whose name has an upper-case letter",
            name_lowercase,
        )
}

/// `test-rules-shared`: one planted entry, breaking two rules at once.
pub fn rules_shared() -> Module {
    Module {
        manifest: manifest("test.rules", &[]),
        register: |r| {
            r.registry(rules_def().planted("odd", json!({"name": "odd", "size": 65})));
        },
    }
}

/// `test-rules-isolated`: one planted entry per rule.
pub fn rules_isolated() -> Module {
    Module {
        manifest: manifest("test.rules", &[]),
        register: |r| {
            r.registry(
                rules_def()
                    .planted("big", json!({"name": "big", "size": 66}))
                    .planted("odd", json!({"name": "odd", "size": 7}))
                    .planted("Upper", json!({"name": "Upper", "size": 8})),
            );
        },
    }
}

// ---- test.load: ten registries of 100 entries, for the seal's budget.

/// `test-registries-load`: `test.load.r0@1` to `test.load.r9@1`, each with its kit, a planted
/// entry and 100 entries.
pub fn load() -> Module {
    Module {
        manifest: manifest("test.load", &[]),
        register: |r| {
            for k in 0..10 {
                let name = format!("test.load.r{k}@1");
                r.registry(
                    RegistryDef::new(&name, mark_schema(), &["module", "pack"], SINCE)
                        .rule("size_at_most_64", OVER_64, size_at_most_64)
                        .rule("size_even", "an entry whose size is odd", size_even)
                        .planted("big", json!({"name": "big", "size": 66}))
                        .planted("odd", json!({"name": "odd", "size": 7})),
                );
                for i in 0..100 {
                    let entry = format!("e{i:03}");
                    r.entry(
                        &name,
                        &entry,
                        json!({"name": entry, "size": (i % 32) * 2}),
                        SINCE,
                    );
                }
            }
        },
    }
}

/// `test-column-source` (#397's acceptance README: The column view): `test.columns`, which fills
/// the core's `column.source@1` with `test.column@1` (`test.column.<name>`, i32) and one source,
/// `test.column.big`: 5 in every row but row 3, which holds 70,000, the same at every t.
pub fn columns() -> Module {
    Module {
        manifest: manifest("test.columns", &[]),
        register: |r| {
            let rows = json!([5, 5, 5, 70_000, 5, 5]);
            r.entry(
                deep_canvas::columns::REGISTRY,
                "test.column@1",
                json!({"form": "test.column.<name>", "types": ["i32"],
                       "sources": {"big": {"dtype": "i32", "rows": rows}},
                       "fixture": {"frames": [rows, rows], "changed": [[], []],
                                   "seeks": [{"from": 1, "to": 0, "rows": rows}]}}),
                SINCE,
            );
        },
    }
}

/// `test-export-target` (#501): `test.export`, which fills the core's `export.target@1` with
/// `raw`, read back by something other than its writer, in a build without media.
pub fn export_raw() -> Module {
    Module {
        manifest: manifest("test.export", &[]),
        register: |r| {
            r.entry(
                "export.target@1",
                "test.raw",
                json!({"writer": "test.export", "fidelity": ["export.fidelity"],
                       "reader": "test.reader", "hidden": "listed"}),
                "R6",
            );
        },
    }
}

/// `test-export-target-self-read` (#501): the planted target `self_read`, whose reader is its
/// own writer.
pub fn export_self_read() -> Module {
    Module {
        manifest: manifest("test.export.selfread", &[]),
        register: |r| {
            r.entry(
                "export.target@1",
                "self_read",
                json!({"writer": "test.export.selfread", "fidelity": ["export.fidelity"],
                       "reader": "test.export.selfread", "hidden": "listed"}),
                "R6",
            );
        },
    }
}
