//! The kit's test canvas modules (issue #138; the #138 acceptance README: The test canvas
//! modules): each a clean module and its planted twin, never in a shipped build, each under its
//! own Cargo feature of this binary. They live here rather than in `deep-canvas-test-modules`
//! because some keep values in statics, which the canvas lint keeps out of every deep-canvas*
//! crate, and the kit judges what they do with them.

#![allow(dead_code)]

use std::collections::BTreeMap;

use deep_canvas::kinds::{Entry, Migration, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Manifest, Module, Raised, Range, Registrar, Semver, StepInput, Stepper,
};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Map, Value};

fn manifest(name: &str, major: u32) -> Manifest {
    Manifest {
        name: name.into(),
        version: Semver {
            major: u64::from(major),
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: BTreeMap::<String, Dependency>::new(),
        feature: format!("test-kit-{}", name.trim_start_matches("test.kit.")),
        license: "Apache-2.0".into(),
        implements: format!("{name}@{major}"),
        implementation: deep_canvas::registry::Implementation::reference(name, Semver { major: u64::from(major), minor: 0, patch: 0 }),
    }
}

fn param(
    name: &'static str,
    ty: ParamType,
    default: Value,
    min: Option<f64>,
    max: Option<f64>,
) -> Param {
    Param {
        name,
        ty,
        unit: if ty == ParamType::F32 { "u" } else { "" },
        default,
        min,
        max,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn boxed() -> Param {
    param("box", ParamType::Json, Value::Null, None, None)
}

fn number(name: &'static str, default: f64, min: f64, max: f64) -> Param {
    param(name, ParamType::F32, json!(default), Some(min), Some(max))
}

fn flag(name: &'static str) -> Param {
    param(name, ParamType::Json, json!(false), None, None)
}

fn kind(name: &'static str, params: Vec<Param>) -> Entry {
    Entry {
        family: "test.kit",
        name,
        versions: vec![Version {
            major: 1,
            minor: 0,
            params,
        }],
        migrations: vec![],
    }
}

/// A board of one module's items, requiring the module.
fn board(module: &str, title: &str, items: Value) -> Value {
    json!({"format": 1, "profile": "board", "title": title,
           "description": format!("A fixture of the {module} test canvas module."),
           "size": [320, 200], "requires": {"modules": {module: "^1"}}, "items": items})
}

fn item(id: &str, kind: &str, order: &str, params: Value) -> Value {
    json!({"id": id, "kind": kind, "name": format!("Item {id}"), "order": order, "params": params})
}

/// The sidecar of a plain fixture: it raises nothing, and a seek draws what a play does.
fn plain() -> Value {
    json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
           "oracles": ["seek_play"], "codes": []})
}

fn ink_box(params: &Value) -> Value {
    json!({"box": params.get("box").cloned().unwrap_or(Value::Null), "paint": {"fill": {"role": "ink"}}})
}

fn num_of(item: &Value, name: &str) -> f64 {
    item["params"][name].as_f64().unwrap_or(0.0)
}

// ------------------------------------------------------------------------------------------------
// test.kit.crash: an operator that panics when `n` passes 90.

fn crash_out(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let n = num_of(item, "n");
    if n > 90.0 {
        panic!("test.kit.crash: n is {n}");
    }
    v.write("test.kit.crash.out", Val::typed(n))
}

fn register_crash(r: &mut Registrar) {
    r.kind(
        kind("crash", vec![boxed(), number("n", 0.0, 0.0, 100.0)]),
        &[],
        "rect@1",
    );
    r.array("test.kit.crash.out", "f32", "item", "params", "items");
    r.operator("out", "items", &["self"], &["test.kit.crash.out"])
        .run(crash_out);
    r.parity(
        "kernel",
        "crash",
        board("test.kit.crash", "Crash", json!({"c1": item("c1", "test.kit.crash@1", "a0", json!({"box": [20, 20, 60, 40], "n": 0}))})),
        plain(),
    );
}

pub fn crash() -> Module {
    Module {
        manifest: manifest("test.kit.crash", 1),
        register: register_crash,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.blind: a reftest whose twin changes a param that draws nothing (its twin passes), or,
// fixed, moves the box.

fn blind_fixture(r: &mut Registrar, twin: Value) {
    r.kind(
        kind("blind", vec![boxed(), number("shade", 0.0, 0.0, 1.0)]),
        &[],
        "rect@1",
    )
    .drawn(ink_box);
    r.parity(
        "kernel",
        "blind-reftest",
        board("test.kit.blind", "Blind reftest", json!({"b1": item("b1", "test.kit.blind@1", "a0", json!({"box": [40, 40, 80, 50], "shade": 0}))})),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "reftest", "expect": {"item": "b1"}}],
               "oracles": ["reftest"], "codes": [], "twin": twin}),
    );
}

fn register_blind(r: &mut Registrar) {
    blind_fixture(r, json!({"path": "items/b1/params/shade", "value": 1}));
}

fn register_blind_fixed(r: &mut Registrar) {
    blind_fixture(
        r,
        json!({"path": "items/b1/params/box", "value": [40, 40, 81, 50]}),
    );
}

pub fn blind() -> Module {
    Module {
        manifest: manifest("test.kit.blind", 1),
        register: register_blind,
    }
}

pub fn blind_fixed() -> Module {
    Module {
        manifest: manifest("test.kit.blind", 1),
        register: register_blind_fixed,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.noisy: a fault that also raises over_budget, and a clean twin that raises a notice it
// doesn't name; fixed, neither.

fn noisy_rule(_doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let mut out = Vec::new();
    if item["params"]["bad"] == json!(true) {
        out.push(Raised {
            code: "test.kit.noisy.bad",
            severity: "error",
            path: format!("items/{id}/params/bad"),
            what: "the item is marked bad".into(),
            fix_ops: None,
        });
    }
    if item["params"]["hint"] == json!(true) {
        out.push(Raised {
            code: "test.kit.noisy.hint",
            severity: "notice",
            path: format!("items/{id}/params/hint"),
            what: "the item asks for a hint".into(),
            fix_ops: None,
        });
    }
    out
}

fn noisy_cost(item: &Value) -> f64 {
    num_of(item, "weight")
}

fn noisy_with(r: &mut Registrar, weight: f64, hint: bool) {
    r.kind(
        kind(
            "noisy",
            vec![
                boxed(),
                flag("bad"),
                number("weight", 0.0, 0.0, 1e9),
                flag("hint"),
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(ink_box);
    r.rule("test.kit.noisy", noisy_rule)
        .cost("test.kit.noisy", noisy_cost);
    r.code(
        "test.kit.noisy.bad",
        "The item is marked bad.",
        "Clear the item's bad flag.",
        false,
    );
    r.code(
        "test.kit.noisy.hint",
        "The item asks for a hint.",
        "Clear the item's hint flag.",
        false,
    );
    let one = |id: &str, params: Value| {
        board(
            "test.kit.noisy",
            "Noisy",
            json!({id: item(id, "test.kit.noisy@1", "a0", params)}),
        )
    };
    r.parity(
        "kernel",
        "noisy-fault",
        one("n1", json!({"box": [20, 20, 40, 40], "bad": true, "weight": weight})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.noisy.bad"]}),
    );
    r.parity(
        "kernel",
        "noisy-twin",
        one("n2", json!({"box": [20, 20, 40, 40], "hint": hint})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": []}),
    );
    r.parity(
        "kernel",
        "noisy-hint",
        one("n3", json!({"box": [20, 20, 40, 40], "hint": true})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.noisy.hint"]}),
    );
}

fn register_noisy(r: &mut Registrar) {
    noisy_with(r, 1e6, true);
}

fn register_noisy_fixed(r: &mut Registrar) {
    noisy_with(r, 0.0, false);
}

pub fn noisy() -> Module {
    Module {
        manifest: manifest("test.kit.noisy", 1),
        register: register_noisy,
    }
}

pub fn noisy_fixed() -> Module {
    Module {
        manifest: manifest("test.kit.noisy", 1),
        register: register_noisy_fixed,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.fixer: y past 100 is an error whose fix is patch ops; an odd x a warning with a text
// fix; a link to no item is unresolved. `-dangles`: the ops fix also links to a ghost;
// `-unproved`: an ops fix no fixture raises.

fn fixer_ops(id: &str, dangles: bool) -> Vec<Value> {
    let path = format!("items/{id}/params/y");
    let mut ops = vec![json!({"op": "set", "id": id, "path": path, "value": 100})];
    if dangles {
        ops.push(json!({"op": "set", "id": id, "path": format!("items/{id}/params/link"), "value": "ghost"}));
    }
    ops
}

fn fixer_rule_with(doc: &Value, id: &str, item: &Value, dangles: bool) -> Vec<Raised> {
    let mut out = Vec::new();
    let y = num_of(item, "y");
    let x = num_of(item, "x");
    if y > 100.0 {
        out.push(Raised {
            code: "test.kit.fixer.y_over",
            severity: "error",
            path: format!("items/{id}/params/y"),
            what: format!("y is {y}, past the fixer's limit of 100"),
            fix_ops: Some(fixer_ops(id, dangles)),
        });
    }
    if y < 0.0 {
        out.push(Raised {
            code: "test.kit.fixer.y_under",
            severity: "error",
            path: format!("items/{id}/params/y"),
            what: format!("y is {y}, below 0"),
            fix_ops: Some(vec![
                json!({"op": "set", "id": id, "path": format!("items/{id}/params/y"), "value": 0}),
            ]),
        });
    }
    if x.fract() == 0.0 && (x as i64) % 2 != 0 {
        out.push(Raised {
            code: "test.kit.fixer.x_odd",
            severity: "warning",
            path: format!("items/{id}/params/x"),
            what: format!("x is {x}, an odd number"),
            fix_ops: None,
        });
    }
    if let Some(link) = item["params"]["link"].as_str() {
        if doc["items"].get(link).is_none() {
            out.push(Raised {
                code: "ref_unresolved",
                severity: "error",
                path: format!("items/{id}/params/link"),
                what: format!("no item has the ID `{link}`"),
                fix_ops: None,
            });
        }
    }
    out
}

fn fixer_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    fixer_rule_with(doc, id, item, false)
}

fn fixer_rule_dangles(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    fixer_rule_with(doc, id, item, true)
}

fn fixer_with(r: &mut Registrar, rule: deep_canvas::registry::Rule, unproved: bool) {
    let link = param("link", ParamType::Json, Value::Null, None, None);
    r.kind(
        kind(
            "fixer",
            vec![
                boxed(),
                number("x", 0.0, 0.0, 1000.0),
                number("y", 0.0, 0.0, 1000.0),
                link,
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(ink_box);
    r.rule("test.kit.fixer", rule);
    r.code(
        "test.kit.fixer.y_over",
        "y is past the fixer's limit of 100.",
        "Set y to 100.",
        true,
    );
    r.code(
        "test.kit.fixer.x_odd",
        "x is an odd number.",
        "Make x even.",
        false,
    );
    if unproved {
        r.code(
            "test.kit.fixer.y_under",
            "y is below 0.",
            "Set y to 0.",
            true,
        );
    }
    let one = |id: &str, params: Value| {
        board(
            "test.kit.fixer",
            "Fixer",
            json!({id: item(id, "test.kit.fixer@1", "a0", params)}),
        )
    };
    r.parity(
        "framework",
        "fixer-y-over",
        one("f1", json!({"box": [20, 20, 40, 40], "x": 0, "y": 150})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.fixer.y_over"]}),
    );
    r.parity(
        "framework",
        "fixer-x-odd",
        one("f2", json!({"box": [20, 20, 40, 40], "x": 3, "y": 10})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.fixer.x_odd"]}),
    );
    r.parity(
        "framework",
        "fixer-clean",
        one("f3", json!({"box": [20, 20, 40, 40], "x": 2, "y": 10})),
        plain(),
    );
}

fn register_fixer(r: &mut Registrar) {
    fixer_with(r, fixer_rule, false);
}

fn register_fixer_dangles(r: &mut Registrar) {
    fixer_with(r, fixer_rule_dangles, false);
}

fn register_fixer_unproved(r: &mut Registrar) {
    fixer_with(r, fixer_rule, true);
}

pub fn fixer() -> Module {
    Module {
        manifest: manifest("test.kit.fixer", 1),
        register: register_fixer,
    }
}

pub fn fixer_dangles() -> Module {
    Module {
        manifest: manifest("test.kit.fixer", 1),
        register: register_fixer_dangles,
    }
}

pub fn fixer_unproved() -> Module {
    Module {
        manifest: manifest("test.kit.fixer", 1),
        register: register_fixer_unproved,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.rogue: a code its check emits that its catalog doesn't list; `-listed`, listed.

fn rogue_rule(_doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    if item["params"]["odd"] != json!(true) {
        return Vec::new();
    }
    vec![Raised {
        code: "test.kit.rogue.unlisted",
        severity: "error",
        path: format!("items/{id}/params/odd"),
        what: "the item is odd".into(),
        fix_ops: None,
    }]
}

fn rogue_with(r: &mut Registrar, listed: bool) {
    r.kind(kind("rogue", vec![boxed(), flag("odd")]), &[], "rect@1")
        .drawn(ink_box);
    r.rule("test.kit.rogue", rogue_rule);
    if listed {
        r.code(
            "test.kit.rogue.unlisted",
            "The item is odd.",
            "Clear the item's odd flag.",
            false,
        );
    }
    r.parity(
        "kernel",
        "rogue",
        board("test.kit.rogue", "Rogue", json!({"r1": item("r1", "test.kit.rogue@1", "a0", json!({"box": [20, 20, 40, 40], "odd": true}))})),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["analytic"], "codes": ["test.kit.rogue.unlisted"]}),
    );
}

fn register_rogue(r: &mut Registrar) {
    rogue_with(r, false);
}

fn register_rogue_listed(r: &mut Registrar) {
    rogue_with(r, true);
}

pub fn rogue() -> Module {
    Module {
        manifest: manifest("test.kit.rogue", 1),
        register: register_rogue,
    }
}

pub fn rogue_listed() -> Module {
    Module {
        manifest: manifest("test.kit.rogue", 1),
        register: register_rogue_listed,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.carry: carried state {count, hits} stepped at 60 Hz, checkpointed before steps 10,
// 20, …, 50; `-drops-hits` leaves hits out of its checkpoint.

fn carry_init() -> Value {
    json!({"count": 0, "hits": 0})
}

fn carry_step(state: &mut Value, _input: &StepInput<'_>) {
    let count = state["count"].as_i64().unwrap_or(0) + 1;
    state["count"] = json!(count);
    if count % 3 == 0 {
        state["hits"] = json!(state["hits"].as_i64().unwrap_or(0) + 1);
    }
}

fn whole(state: &Value) -> Value {
    state.clone()
}

fn count_only(state: &Value) -> Value {
    json!({"count": state["count"]})
}

fn carry_restore(cp: &Value) -> Value {
    json!({"count": cp["count"].as_i64().unwrap_or(0), "hits": cp["hits"].as_i64().unwrap_or(0)})
}

fn rollback_to(_now: &Value, cp: &Value) -> Value {
    cp.clone()
}

fn none(_: &Value) -> Vec<Value> {
    Vec::new()
}

fn carry_with(r: &mut Registrar, checkpoint: fn(&Value) -> Value) {
    r.kind(kind("carry", vec![]), &[], "");
    r.carried("checkpoint", "test.kit.carry.state", 64);
    r.stepper(Stepper {
        hz: 60,
        checkpoints: vec![10, 20, 30, 40, 50],
        init: carry_init,
        step: carry_step,
        checkpoint,
        restore: carry_restore,
        rollback: |_, cp| carry_restore(cp),
        occurrences: none,
    });
    r.parity(
        "kernel",
        "carry",
        board("test.kit.carry", "Carry", json!({"k1": item("k1", "test.kit.carry@1", "a0", json!({}))})),
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [], "at_times": ["0s", "1s"]}),
    );
}

fn register_carry(r: &mut Registrar) {
    carry_with(r, whole);
}

fn register_carry_drops_hits(r: &mut Registrar) {
    carry_with(r, count_only);
}

pub fn carry() -> Module {
    Module {
        manifest: manifest("test.kit.carry", 1),
        register: register_carry,
    }
}

pub fn carry_drops_hits() -> Module {
    Module {
        manifest: manifest("test.kit.carry", 1),
        register: register_carry_drops_hits,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.tally: bumps from input entries and an occurrence when count + bumps is even.
// `-keeps-occurrence` keeps a replaced step's occurrences on a rollback; `-skips-restored` skips
// an entry stamped at the restored step itself.

fn tally_init() -> Value {
    json!({"count": 0, "bumps": 0, "occurrences": []})
}

fn tally_step_with(state: &mut Value, input: &StepInput<'_>, skips: bool) {
    let skip = skips && input.restored == Some(input.step);
    if !skip {
        for e in input.entries.iter().filter(|e| e["kind"] == "bump") {
            let bumps = state["bumps"].as_i64().unwrap_or(0) + e["value"].as_i64().unwrap_or(0);
            state["bumps"] = json!(bumps);
        }
    }
    let count = state["count"].as_i64().unwrap_or(0) + 1;
    state["count"] = json!(count);
    if (count + state["bumps"].as_i64().unwrap_or(0)) % 2 == 0 {
        if let Some(list) = state["occurrences"].as_array_mut() {
            list.push(json!({"kind": "test.kit.tally.even", "step": input.step}));
        }
    }
}

fn tally_step(state: &mut Value, input: &StepInput<'_>) {
    tally_step_with(state, input, false);
}

fn tally_step_skips(state: &mut Value, input: &StepInput<'_>) {
    tally_step_with(state, input, true);
}

fn tally_keeps(now: &Value, cp: &Value) -> Value {
    let mut out = cp.clone();
    out["occurrences"] = now["occurrences"].clone();
    out
}

fn occurrences(state: &Value) -> Vec<Value> {
    state["occurrences"].as_array().cloned().unwrap_or_default()
}

fn tally_with(
    r: &mut Registrar,
    step: fn(&mut Value, &StepInput<'_>),
    rollback: fn(&Value, &Value) -> Value,
) {
    r.kind(kind("tally", vec![]), &[], "");
    r.carried("checkpoint", "test.kit.tally.state", 256);
    r.stepper(Stepper {
        hz: 60,
        checkpoints: vec![10, 20, 30, 40, 50],
        init: tally_init,
        step,
        checkpoint: whole,
        restore: whole,
        rollback,
        occurrences,
    });
    r.parity(
        "kernel",
        "tally",
        board(
            "test.kit.tally",
            "Tally",
            json!({"t1": item("t1", "test.kit.tally@1", "a0", json!({}))}),
        ),
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [],
               "at_times": ["0s", "1s"], "inputs": [{"step": 20, "kind": "bump", "value": 1}]}),
    );
}

fn register_tally(r: &mut Registrar) {
    tally_with(r, tally_step, rollback_to);
}

fn register_tally_keeps(r: &mut Registrar) {
    tally_with(r, tally_step, tally_keeps);
}

fn register_tally_skips(r: &mut Registrar) {
    tally_with(r, tally_step_skips, rollback_to);
}

pub fn tally() -> Module {
    Module {
        manifest: manifest("test.kit.tally", 1),
        register: register_tally,
    }
}

pub fn tally_keeps_occurrence() -> Module {
    Module {
        manifest: manifest("test.kit.tally", 1),
        register: register_tally_keeps,
    }
}

pub fn tally_skips_restored() -> Module {
    Module {
        manifest: manifest("test.kit.tally", 1),
        register: register_tally_skips,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.cover: drawn `w` wide; `ghost` read by nothing. Its case declares ghost (fixed: not).

fn cover_draw(params: &Value) -> Value {
    let b: Vec<f64> = params["box"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .collect();
    let w = params["w"].as_f64().unwrap_or(10.0);
    let (x, y, h) = (
        b.first().copied().unwrap_or(0.0),
        b.get(1).copied().unwrap_or(0.0),
        b.get(3).copied().unwrap_or(10.0),
    );
    json!({"box": [x, y, w, h], "paint": {"fill": {"role": "ink"}}})
}

fn cover_width(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let w = item["params"]["w"].as_f64().unwrap_or(10.0);
    v.write("test.kit.cover.width", Val::typed(w))
}

fn cover_with(r: &mut Registrar, fields: Value) {
    r.kind(
        kind(
            "cover",
            vec![
                boxed(),
                number("w", 10.0, 0.0, 100.0),
                number("ghost", 0.0, 0.0, 1.0),
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(cover_draw);
    r.array("test.kit.cover.width", "f32", "item", "params", "items");
    r.operator("width", "items", &["self"], &["test.kit.cover.width"])
        .run(cover_width);
    r.parity(
        "kernel",
        "cover",
        board("test.kit.cover", "Cover", json!({"v1": item("v1", "test.kit.cover@1", "a0", json!({"box": [20, 20, 10, 30], "w": 20}))})),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
               "oracles": ["seek_play"], "codes": [],
               "covers": {"kinds": ["test.kit.cover@1"], "fields": fields, "modules": ["test.kit.cover"]}}),
    );
}

fn register_cover(r: &mut Registrar) {
    cover_with(
        r,
        json!(["test.kit.cover@1/params/w", "test.kit.cover@1/params/ghost"]),
    );
}

fn register_cover_fixed(r: &mut Registrar) {
    cover_with(r, json!(["test.kit.cover@1/params/w"]));
}

pub fn cover() -> Module {
    Module {
        manifest: manifest("test.kit.cover", 1),
        register: register_cover,
    }
}

pub fn cover_fixed() -> Module {
    Module {
        manifest: manifest("test.kit.cover", 1),
        register: register_cover_fixed,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.snap: a reftest and a golden; `-snap-off` fills in another role. (Vello CPU paints by
// the look's roles, so the CPU twin can't be one code value off; the GPU twin, test.kit.gpu's,
// is.)

fn muted_box(params: &Value) -> Value {
    json!({"box": params.get("box").cloned().unwrap_or(Value::Null), "paint": {"fill": {"role": "muted"}}})
}

fn snap_with(r: &mut Registrar, draw: fn(&Value) -> Value) {
    r.kind(kind("snap", vec![boxed()]), &[], "rect@1")
        .drawn(draw);
    r.parity(
        "kernel",
        "snap-reftest",
        board("test.kit.snap", "Snap reftest", json!({"s1": item("s1", "test.kit.snap@1", "a0", json!({"box": [40, 40, 80, 50]}))})),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "reftest", "expect": {"item": "s1"}}],
               "oracles": ["reftest"], "codes": [], "twin": {"path": "items/s1/params/box", "value": [40, 40, 81, 50]}}),
    );
    r.parity(
        "kernel",
        "snap-golden",
        board(
            "test.kit.snap",
            "Snap golden",
            json!({"s2": item("s2", "test.kit.snap@1", "a0", json!({"box": [60, 30, 90, 60]}))}),
        ),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "golden"}],
               "oracles": ["golden"], "codes": []}),
    );
}

fn register_snap(r: &mut Registrar) {
    snap_with(r, ink_box);
}

fn register_snap_off(r: &mut Registrar) {
    snap_with(r, muted_box);
}

pub fn snap() -> Module {
    Module {
        manifest: manifest("test.kit.snap", 1),
        register: register_snap,
    }
}

pub fn snap_off() -> Module {
    Module {
        manifest: manifest("test.kit.snap", 1),
        register: register_snap_off,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.glyphs: draws its text from the core's glyph atlas; contributes glyph boxes, or, in
// `-no-box`, doesn't.

fn glyph_boxes(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let mut b = [0.0; 4];
    for (k, x) in item["params"]["box"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .take(4)
    {
        b[k] = x.as_f64().unwrap_or(0.0);
    }
    v.write("test.kit.glyphs.boxes", Val::typed(vec![b]))
}

fn glyphs_with(r: &mut Registrar, contributes: bool) {
    r.kind(
        kind(
            "glyphs",
            vec![
                boxed(),
                param("text", ParamType::Str, json!(""), None, None),
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(ink_box)
    .draws(&["glyphs"]);
    if contributes {
        r.contribution(
            "test.kit.glyphs.boxes",
            "list",
            "item",
            "geometry",
            "items",
            "core.glyphs",
        );
    } else {
        r.array("test.kit.glyphs.boxes", "list", "item", "geometry", "items");
    }
    r.operator("boxes", "items", &["self"], &["test.kit.glyphs.boxes"])
        .run(glyph_boxes);
    r.parity(
        "kernel",
        "glyphs",
        board("test.kit.glyphs", "Glyphs", json!({"g1": item("g1", "test.kit.glyphs@1", "a0", json!({"box": [20, 20, 120, 20], "text": "Glyphs"}))})),
        plain(),
    );
}

fn register_glyphs(r: &mut Registrar) {
    glyphs_with(r, true);
}

fn register_glyphs_no_box(r: &mut Registrar) {
    glyphs_with(r, false);
}

pub fn glyphs() -> Module {
    Module {
        manifest: manifest("test.kit.glyphs", 1),
        register: register_glyphs,
    }
}

pub fn glyphs_no_box() -> Module {
    Module {
        manifest: manifest("test.kit.glyphs", 1),
        register: register_glyphs_no_box,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.keys: a value keyed in time, linear between keys and held outside them.
// `-kept-index` keeps its last key index between evaluations and searches only forward from it.

/// The value at `t` seconds, linear between keys and held outside them, and the index of the
/// last key at or before `t`, found searching forward from `from`.
fn value_at(keys: &[(f64, f64)], t: f64, from: usize) -> (f64, usize) {
    if keys.is_empty() {
        return (0.0, 0);
    }
    let from = from.min(keys.len() - 1);
    let mut k = from;
    while k + 1 < keys.len() && keys[k + 1].0 <= t {
        k += 1;
    }
    let value = match keys.get(k + 1) {
        Some(next) if t > keys[k].0 && next.0 > keys[k].0 => {
            let u = ((t - keys[k].0) / (next.0 - keys[k].0)).clamp(0.0, 1.0);
            keys[k].1 + (next.1 - keys[k].1) * u
        }
        _ => keys[k].1,
    };
    (value, k)
}

fn keys_of(item: &Value) -> Vec<(f64, f64)> {
    item["params"]["keys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|k| Some((k.get(0)?.as_f64()?, k.get(1)?.as_f64()?)))
        .collect()
}

fn keys_value(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let t = v.t()? as f64 / 705_600_000.0;
    let (value, _) = value_at(&keys_of(item), t, 0);
    v.write("test.kit.keys.value", Val::typed(value))
}

thread_local! {
    /// The planted twin's kept key index, by item.
    static KEPT: std::cell::RefCell<BTreeMap<String, usize>> = const { std::cell::RefCell::new(BTreeMap::new()) };
}

fn keys_value_kept(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let t = v.t()? as f64 / 705_600_000.0;
    let id = v.id().unwrap_or("").to_string();
    let from = KEPT.with(|k| k.borrow().get(&id).copied().unwrap_or(0));
    let (value, at) = value_at(&keys_of(item), t, from);
    KEPT.with(|k| k.borrow_mut().insert(id, at));
    v.write("test.kit.keys.value", Val::typed(value))
}

fn keys_with(r: &mut Registrar, run: deep_canvas::registry::Run) {
    r.kind(
        kind(
            "keys",
            vec![
                boxed(),
                param("keys", ParamType::Json, json!([]), None, None),
            ],
        ),
        &[],
        "rect@1",
    )
    .drawn(ink_box);
    r.array("test.kit.keys.value", "f32", "item", "time", "items");
    r.operator("value", "items", &["self", "t"], &["test.kit.keys.value"])
        .run(run);
    r.parity(
        "kernel",
        "keys",
        board("test.kit.keys", "Keys", json!({"y1": item("y1", "test.kit.keys@1", "a0", json!({"box": [20, 20, 40, 40], "keys": [[0, 0], [0.5, 10], [1, 20]]}))})),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
               "oracles": ["seek_play"], "codes": [], "at_times": {"from": "0s", "to": "1s", "every": "1/60s"}}),
    );
}

fn register_keys(r: &mut Registrar) {
    keys_with(r, keys_value);
}

fn register_keys_kept(r: &mut Registrar) {
    keys_with(r, keys_value_kept);
}

pub fn keys() -> Module {
    Module {
        manifest: manifest("test.kit.keys", 1),
        register: register_keys,
    }
}

pub fn keys_kept_index() -> Module {
    Module {
        manifest: manifest("test.kit.keys", 1),
        register: register_keys_kept,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.formula: sidecars with a formula, a check kind no registry holds and an oracle off
// the list.

fn register_formula(r: &mut Registrar) {
    r.kind(kind("formula", vec![boxed()]), &[], "rect@1")
        .drawn(ink_box);
    let doc = || {
        board(
            "test.kit.formula",
            "Formula",
            json!({"x1": item("x1", "test.kit.formula@1", "a0", json!({"box": [20, 20, 40, 40]}))}),
        )
    };
    r.parity(
        "kernel",
        "formula-expect",
        doc(),
        json!({"checks": [{"kind": "document.validate", "expect": "box.w * 2 + 1"}], "oracles": ["analytic"], "codes": []}),
    );
    r.parity(
        "kernel",
        "formula-kind",
        doc(),
        json!({"checks": [{"kind": "test.kit.formula.made_up"}], "oracles": ["analytic"], "codes": []}),
    );
    r.parity(
        "kernel",
        "formula-oracle",
        doc(),
        json!({"checks": [{"kind": "document.validate"}], "oracles": ["eyeball"], "codes": []}),
    );
}

pub fn formula() -> Module {
    Module {
        manifest: manifest("test.kit.formula", 1),
        register: register_formula,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.gpu: a kind a GPU pass fills, with a Vello CPU path for its CPU reference.
// `-shifted`: the pass is one code value off in red. `-cpu-ref-fails`: the CPU path draws 4 px
// narrower.

const GPU_PASS: &str = r"
struct In { @location(0) pos: vec2<f32>, @location(1) color: vec4<f32> };
struct Out { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(v: In) -> Out { var o: Out; o.pos = vec4<f32>(v.pos, 0.0, 1.0); o.color = v.color; return o; }
@fragment fn fs_main(o: Out) -> @location(0) vec4<f32> { return o.color; }
";

const GPU_PASS_SHIFTED: &str = r"
struct In { @location(0) pos: vec2<f32>, @location(1) color: vec4<f32> };
struct Out { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(v: In) -> Out { var o: Out; o.pos = vec4<f32>(v.pos, 0.0, 1.0); o.color = v.color; return o; }
@fragment fn fs_main(o: Out) -> @location(0) vec4<f32> { return o.color + vec4<f32>(1.0 / 255.0, 0.0, 0.0, 0.0); }
";

fn narrower(params: &Value) -> Value {
    let b: Vec<f64> = params["box"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .collect();
    let mut out = ink_box(params);
    if b.len() == 4 {
        out["box"] = json!([b[0], b[1], b[2] - 4.0, b[3]]);
    }
    out
}

fn gpu_with(r: &mut Registrar, shader: &'static str, draw: fn(&Value) -> Value) {
    r.kind(kind("gpu", vec![boxed()]), &[], "rect@1")
        .drawn(draw);
    r.gpu_pass("fill", "geometry", "test.kit.gpu", shader);
    for (name, b) in [
        ("gpu-pass-a", [40, 40, 80, 50]),
        ("gpu-pass-b", [100, 60, 64, 32]),
    ] {
        r.parity(
            "scene",
            name,
            board("test.kit.gpu", "GPU pass", json!({"g1": item("g1", "test.kit.gpu@1", "a0", json!({"box": b}))})),
            json!({
                "checks": [
                    {"kind": "geometry.audit", "probe": "bounds", "expect": {"item": "g1", "bounds": b}},
                    {"kind": "document.determinism", "render": "cpu_reference", "expect": {"item": "g1", "bounds": b}},
                    {"kind": "document.determinism", "probe": "pixels", "render": "reftest", "expect": {"item": "g1"}},
                ],
                "oracles": ["analytic", "cpu_reference", "reftest"], "codes": [],
                "twin": {"path": "items/g1/params/box", "value": [b[0], b[1], b[2] + 1, b[3]]},
            }),
        );
    }
}

fn register_gpu(r: &mut Registrar) {
    gpu_with(r, GPU_PASS, ink_box);
}

fn register_gpu_shifted(r: &mut Registrar) {
    gpu_with(r, GPU_PASS_SHIFTED, ink_box);
}

fn register_gpu_cpu_ref_fails(r: &mut Registrar) {
    gpu_with(r, GPU_PASS, narrower);
}

pub fn gpu() -> Module {
    Module {
        manifest: manifest("test.kit.gpu", 1),
        register: register_gpu,
    }
}

pub fn gpu_shifted() -> Module {
    Module {
        manifest: manifest("test.kit.gpu", 1),
        register: register_gpu_shifted,
    }
}

pub fn gpu_cpu_ref_fails() -> Module {
    Module {
        manifest: manifest("test.kit.gpu", 1),
        register: register_gpu_cpu_ref_fails,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.sneak: `out` reads, through a static, the array `src` writes, declaring only its item.

thread_local! {
    static SNEAKED: std::cell::RefCell<Option<f64>> = const { std::cell::RefCell::new(None) };
}

fn sneak_src(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let x = item["params"]["box"][0].as_f64().unwrap_or(0.0) * 2.0;
    SNEAKED.with(|s| *s.borrow_mut() = Some(x));
    v.write("test.kit.sneak.src", Val::typed(x))
}

fn sneak_out(v: &mut View<'_>) -> Result<(), OpError> {
    let _ = v.item()?;
    let seen = SNEAKED.with(|s| *s.borrow());
    v.write("test.kit.sneak.out", Val::typed(seen))
}

fn register_sneak(r: &mut Registrar) {
    r.kind(kind("sneak", vec![boxed()]), &[], "rect@1")
        .drawn(ink_box);
    r.array("test.kit.sneak.src", "f32", "item", "params", "items");
    r.array("test.kit.sneak.out", "f32", "item", "params", "views");
    r.operator("src", "items", &["self"], &["test.kit.sneak.src"])
        .run(sneak_src);
    r.operator("out", "views", &["self"], &["test.kit.sneak.out"])
        .run(sneak_out);
    r.parity(
        "kernel",
        "sneak",
        board(
            "test.kit.sneak",
            "Sneak",
            json!({"s1": item("s1", "test.kit.sneak@1", "a0", json!({"box": [20, 20, 40, 40]}))}),
        ),
        plain(),
    );
}

pub fn sneak() -> Module {
    Module {
        manifest: manifest("test.kit.sneak", 1),
        register: register_sneak,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.order: `b` writes what `a` last left in a static, so its result depends on the order
// the two run in.

thread_local! {
    static LAST_A: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn order_a(v: &mut View<'_>) -> Result<(), OpError> {
    let _ = v.item()?;
    let id = v.id().unwrap_or("").to_string();
    LAST_A.with(|s| *s.borrow_mut() = id.clone());
    v.write("test.kit.order.a", Val::typed(id))
}

fn order_b(v: &mut View<'_>) -> Result<(), OpError> {
    let _ = v.item()?;
    let seen = LAST_A.with(|s| s.borrow().clone());
    v.write("test.kit.order.b", Val::typed(seen))
}

fn register_order(r: &mut Registrar) {
    r.kind(kind("order", vec![boxed()]), &[], "rect@1")
        .drawn(ink_box);
    r.array("test.kit.order.a", "str", "item", "params", "items");
    r.array("test.kit.order.b", "str", "item", "params", "items");
    r.operator("a", "items", &["self"], &["test.kit.order.a"])
        .run(order_a);
    r.operator("b", "items", &["self"], &["test.kit.order.b"])
        .run(order_b);
    let mut items = Map::new();
    for (k, id) in ["o1", "o2", "o3", "o4"].iter().enumerate() {
        items.insert(
            id.to_string(),
            item(
                id,
                "test.kit.order@1",
                &format!("a{k}"),
                json!({"box": [20 + 60 * k as i64, 20, 40, 40]}),
            ),
        );
    }
    r.parity(
        "kernel",
        "order",
        board("test.kit.order", "Order", Value::Object(items)),
        plain(),
    );
}

pub fn order() -> Module {
    Module {
        manifest: manifest("test.kit.order", 1),
        register: register_order,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.mig: 1.0.0 draws `w` wide; 2.0.0 draws `width / 2` wide, migrating `width = 2 w`
// (`-moves`: 2 w + 1; `-overflow`: 3 w, so the old max maps out of range).

fn draw_w(params: &Value) -> Value {
    cover_draw(params)
}

fn draw_half_width(params: &Value) -> Value {
    let mut p = params.clone();
    p["w"] = json!(params["width"].as_f64().unwrap_or(20.0) / 2.0);
    cover_draw(&p)
}

fn to_width(params: &mut Map<String, Value>, k: f64, plus: f64) {
    let w = params.shift_remove("w").and_then(|v| v.as_f64());
    if let Some(w) = w {
        params.insert("width".into(), json!(w * k + plus));
    }
}

fn twice(params: &mut Map<String, Value>) {
    to_width(params, 2.0, 0.0);
}

/// One more than it should be, held inside the range: it moves a value and keeps every param set
/// in the new schema.
fn twice_plus_one(params: &mut Map<String, Value>) {
    to_width(params, 2.0, 1.0);
    if let Some(w) = params.get("width").and_then(Value::as_f64) {
        params.insert("width".into(), json!(w.min(200.0)));
    }
}

fn thrice(params: &mut Map<String, Value>) {
    to_width(params, 3.0, 0.0);
}

fn register_mig_1(r: &mut Registrar) {
    r.kind(
        kind("mig", vec![boxed(), number("w", 10.0, 0.0, 100.0)]),
        &[],
        "rect@1",
    )
    .drawn(draw_w);
    r.parity(
        "kernel",
        "mig",
        board("test.kit.mig", "Mig", json!({"m1": item("m1", "test.kit.mig@1", "a0", json!({"box": [20, 20, 40, 30], "w": 30}))})),
        plain(),
    );
}

fn mig_2_with(r: &mut Registrar, map: fn(&mut Map<String, Value>)) {
    let entry = Entry {
        family: "test.kit",
        name: "mig",
        versions: vec![
            Version {
                major: 1,
                minor: 0,
                params: vec![boxed(), number("w", 10.0, 0.0, 100.0)],
            },
            Version {
                major: 2,
                minor: 0,
                params: vec![boxed(), number("width", 20.0, 0.0, 200.0)],
            },
        ],
        migrations: vec![Migration {
            from: 1,
            to: 2,
            renames: vec![],
            map: Some(map),
        }],
    };
    r.kind(entry, &[], "rect@1").drawn(draw_half_width);
    r.parity(
        "kernel",
        "mig",
        json!({"format": 1, "profile": "board", "title": "Mig", "size": [320, 200],
               "description": "A fixture of the test.kit.mig test canvas module.",
               "requires": {"modules": {"test.kit.mig": "^2"}},
               "items": {"m1": item("m1", "test.kit.mig@2", "a0", json!({"box": [20, 20, 40, 30], "width": 60}))}}),
        plain(),
    );
}

fn register_mig_2(r: &mut Registrar) {
    mig_2_with(r, twice);
}

fn register_mig_2_moves(r: &mut Registrar) {
    mig_2_with(r, twice_plus_one);
}

fn register_mig_2_overflow(r: &mut Registrar) {
    mig_2_with(r, thrice);
}

pub fn mig_1() -> Module {
    Module {
        manifest: manifest("test.kit.mig", 1),
        register: register_mig_1,
    }
}

pub fn mig_2() -> Module {
    Module {
        manifest: manifest("test.kit.mig", 2),
        register: register_mig_2,
    }
}

pub fn mig_2_moves() -> Module {
    Module {
        manifest: manifest("test.kit.mig", 2),
        register: register_mig_2_moves,
    }
}

pub fn mig_2_overflow() -> Module {
    Module {
        manifest: manifest("test.kit.mig", 2),
        register: register_mig_2_overflow,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.loose: three tolerance classes, each missing one of its ceiling, window or reason.

fn register_loose(r: &mut Registrar) {
    r.kind(kind("loose", vec![boxed()]), &[], "rect@1")
        .drawn(ink_box);
    let doc = || {
        board(
            "test.kit.loose",
            "Loose",
            json!({"l1": item("l1", "test.kit.loose@1", "a0", json!({"box": [20, 20, 40, 40]}))}),
        )
    };
    let full = json!({"within": 1, "on": 99.9, "ceiling": 16, "window": {"size": 16, "off": 64}, "reason": "antialiased edges may move one code value"});
    for (name, drop) in [
        ("loose-no-ceiling", "ceiling"),
        ("loose-no-window", "window"),
        ("loose-no-reason", "reason"),
    ] {
        let mut t = full.clone();
        if let Some(m) = t.as_object_mut() {
            m.remove(drop);
        }
        r.parity(
            "kernel",
            name,
            doc(),
            json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "reftest", "expect": {"item": "l1"}, "tolerance": t}],
                   "oracles": ["reftest"], "codes": []}),
        );
    }
}

pub fn loose() -> Module {
    Module {
        manifest: manifest("test.kit.loose", 1),
        register: register_loose,
    }
}

// ------------------------------------------------------------------------------------------------
// test.kit.selfish: a kind whose only fixture is its own first render; `-analytic` adds one whose
// expected bounds are written in its sidecar.

fn selfish_with(r: &mut Registrar, analytic: bool) {
    r.kind(kind("selfish", vec![boxed()]), &[], "rect@1")
        .drawn(ink_box);
    let doc = |id: &str, b: Value| {
        board(
            "test.kit.selfish",
            "Selfish",
            json!({id: item(id, "test.kit.selfish@1", "a0", json!({"box": b}))}),
        )
    };
    r.parity(
        "kernel",
        "selfish",
        doc("q1", json!([30, 30, 70, 40])),
        json!({"checks": [{"kind": "document.determinism", "probe": "pixels", "render": "golden"}],
               "oracles": ["golden"], "codes": [], "criteria": ["#999.0badc0de"]}),
    );
    if analytic {
        r.parity(
            "kernel",
            "selfish-analytic",
            doc("q2", json!([30, 30, 70, 40])),
            json!({"checks": [{"kind": "geometry.audit", "probe": "bounds", "expect": {"item": "q2", "bounds": [30, 30, 70, 40]}}],
                   "oracles": ["analytic"], "codes": [], "expected_from": "analytic", "criteria": ["#999.0badc0de"]}),
        );
    }
}

fn register_selfish(r: &mut Registrar) {
    selfish_with(r, false);
}

fn register_selfish_analytic(r: &mut Registrar) {
    selfish_with(r, true);
}

pub fn selfish() -> Module {
    Module {
        manifest: manifest("test.kit.selfish", 1),
        register: register_selfish,
    }
}

pub fn selfish_analytic() -> Module {
    Module {
        manifest: manifest("test.kit.selfish", 1),
        register: register_selfish_analytic,
    }
}

/// The kit's test canvas modules this build holds, each under its own feature.
pub fn built() -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out: Vec<Module> = Vec::new();
    macro_rules! with {
        ($feature:literal, $make:expr) => {
            #[cfg(feature = $feature)]
            out.push($make);
        };
    }
    with!("test-kit-crash", crash());
    with!("test-kit-blind", blind());
    with!("test-kit-blind-fixed", blind_fixed());
    with!("test-kit-noisy", noisy());
    with!("test-kit-noisy-fixed", noisy_fixed());
    with!("test-kit-fixer", fixer());
    with!("test-kit-fixer-dangles", fixer_dangles());
    with!("test-kit-fixer-unproved", fixer_unproved());
    with!("test-kit-rogue", rogue());
    with!("test-kit-rogue-listed", rogue_listed());
    with!("test-kit-carry", carry());
    with!("test-kit-carry-drops-hits", carry_drops_hits());
    with!("test-kit-tally", tally());
    with!("test-kit-tally-keeps-occurrence", tally_keeps_occurrence());
    with!("test-kit-tally-skips-restored", tally_skips_restored());
    with!("test-kit-cover", cover());
    with!("test-kit-cover-fixed", cover_fixed());
    with!("test-kit-snap", snap());
    with!("test-kit-snap-off", snap_off());
    with!("test-kit-glyphs", glyphs());
    with!("test-kit-glyphs-no-box", glyphs_no_box());
    with!("test-kit-keys", keys());
    with!("test-kit-keys-kept-index", keys_kept_index());
    with!("test-kit-formula", formula());
    with!("test-kit-gpu-pass", gpu());
    with!("test-kit-gpu-pass-shifted", gpu_shifted());
    with!("test-kit-gpu-pass-cpu-ref-fails", gpu_cpu_ref_fails());
    with!("test-kit-sneak", sneak());
    with!("test-kit-order", order());
    with!("test-kit-mig-1", mig_1());
    with!("test-kit-mig-2", mig_2());
    with!("test-kit-mig-2-moves", mig_2_moves());
    with!("test-kit-mig-2-overflow", mig_2_overflow());
    with!("test-kit-loose", loose());
    with!("test-kit-selfish", selfish());
    with!("test-kit-selfish-analytic", selfish_analytic());
    out
}
