//! The logic canvas module (canvas primitives: Canvas module, Logic `logic@1`; #533): `logic@1`'s
//! implementation, bit and canonical, its engine sandbox@1's pinned wasmtime. It registers the
//! logic item's kind, in a build without physics a check that refuses what only the physics
//! module fills, and one operator in simulate that steps a document's logic items at their rates, carrying each item's memory,
//! globals and arrays from step to step as plain data, so a seek restores a checkpoint and steps
//! on. Its kit runs every part of the canvas kit on its own fixture. Its arrays also fill the
//! core's `column.source@1` as `<logic>.<name>` (Mark set: logic columns; #535), so a mark set
//! reads a logic array through the core's column view and no reading module depends on this one.
//!
//! A step loads the carried state into a fresh instance of the item's rewritten program; the
//! checked piece behind it is cached per thread by the document's logic content, which a step
//! only reads. Its items read the played form's input track, the entries of the controls they
//! read; a trapped item fails the step (`logic.trap`). Readings don't reach them here yet: an
//! item that reads one is refused by the logic module's own check, as a piece without the
//! source is.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas::kinds::{Entry as KindEntry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Equivalence, Implementation, Manifest, Module, Pin, Raised, Range, Registrar,
    Report, Semver, StateClass, StepInput, Stepper,
};
use deep_canvas::schedule::{canonical, sha256_hex, Canonical, OpError, Val, View};
use serde_json::{json, Map, Value};

use crate::bake::handed;
use crate::piece::{self, History, Piece};
use crate::world::{track_of, Entry, Record, World};
use crate::Planted;

/// The interface this module implements, apart from the logic item kind of that name.
pub const INTERFACE: &str = "logic@1";
/// The array the step operator carries: every logic item's state after the last step.
pub const STATE: &str = "logic.state";
/// A step at 60 Hz, in flicks: the rate of a document whose items name none.
const STEP: i64 = 11_760_000;
/// The params a logic item takes here: every field the logic check reads (`piece::declared`) and
/// `fires`, each with the form its reader takes (#1973); `wasm` is the program's bytes, which
/// whoever holds the evidence store inlines by the program's hash before a frame, as a vector's
/// outline is.
const PARAMS: [(&str, &str); 15] = [
    ("program", "asset ID"),
    ("debug", "asset ID"),
    ("step_rate", "Hz"),
    ("clock", "fixed | on_input"),
    ("due", "name"),
    ("reads", "[control ID | reading ID | path]"),
    (
        "writes",
        "{name → {type, count?: u32, interpolate?, unit?}}",
    ),
    ("emits", "{kind → {fields, max_per_step?: u16}}"),
    ("fires", "{world → [input ID]}"),
    (
        "budget",
        "{fuel?: integer, memory?: number, stack?: number}",
    ),
    ("checkpoint", "{every?: integer, budget?: bytes}"),
    ("assets", "[asset ID]"),
    (
        "saves",
        "{slots?: integer, request?: name, ends?: name, migrate?}",
    ),
    (
        "preview",
        "{reads?: [control ID | path], writes?: {name → {type, count?: u32}}}",
    ),
    ("wasm", "text (the program's bytes, which the hub inlines)"),
];

/// The shipped module.
pub fn module() -> Module {
    implementation(Semver::parse("1.0.0").expect("a version"))
}

/// `m` in a build without the physics module: it also refuses the logic items that need physics
/// (Logic before physics).
pub fn without_physics(m: Module) -> Module {
    Module {
        register: |r| {
            register(r);
            r.rule("logic", needs_physics);
        },
        ..m
    }
}

/// The shipped implementation at `version`: a test build's patch release of it (#533).
pub fn implementation(version: Semver) -> Module {
    let sandbox = deep_canvas_sandbox::module::module()
        .manifest
        .implementation;
    Module {
        manifest: Manifest {
            name: "logic".into(),
            version: Semver::parse("1.0.0").expect("a version"),
            core: Range::parse("*").expect("a range"),
            depends_on: [(
                "sandbox".to_string(),
                Dependency {
                    range: Range::parse("^1").expect("a range"),
                    optional: false,
                },
            )]
            .into_iter()
            .collect(),
            feature: "logic".into(),
            license: "Apache-2.0".into(),
            implements: INTERFACE.into(),
            implementation: Implementation {
                name: "logic".into(),
                version,
                pins: sandbox.pins.into_iter().collect::<BTreeMap<String, Pin>>(),
                equivalence: Equivalence::Bit,
                state: StateClass::Canonical,
            },
        },
        register,
    }
}

fn kind() -> KindEntry {
    let param = |(name, form)| Param {
        name,
        ty: ParamType::Json(form),
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    KindEntry {
        family: "",
        name: "logic",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: PARAMS.into_iter().map(param).collect(),
        }],
        migrations: Vec::new(),
    }
}

fn register(r: &mut Registrar) {
    // The kind keeps the module's name, as the design writes it.
    r.kind(kind(), &[], "");
    r.array(STATE, "logic.state", "document", "time", "simulate");
    r.carried("checkpoint", STATE, 4 << 20);
    r.operator("step", "simulate", &["refs"], &[STATE])
        .steps_at(STEP, rate)
        .applies(|doc, _, _| logic_items(doc).next().is_some())
        .run(step);
    r.stepper(Stepper {
        hz: 60,
        checkpoints: vec![10, 20, 30, 40, 50],
        init: fixture_init,
        step: fixture_step,
        checkpoint: Value::clone,
        restore: Value::clone,
        rollback: |_, cp| cp.clone(),
        occurrences: |_| Vec::new(),
    });
    let (sha, bytes) = fixture_program();
    // The document's item reads no control, since a document's entries don't reach it here;
    // the stepper's reads `press`, which the kit's entries press.
    let mut params = json!({"program": sha, "step_rate": 60,
                            "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}});
    params["wasm"] = json!(B64.encode(&bytes));
    r.parity(
        "logic",
        "counter",
        json!({"format": 1, "profile": "board", "title": "Counter", "seed": 533,
               "description": "The logic module's kit fixture: one item counting its steps.",
               "size": [320, 200], "requires": {"modules": {"logic": "^1"}},
               "items": {"counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a0", "params": params}}}),
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [],
               "at_times": ["0s", "1s"], "inputs": [{"step": 20, "kind": "press", "value": 1}]}),
    )
    .fixture_assets(vec![bytes]);
    // #548: deep_run's logic kinds (Check input: logic kinds), each on the lowered document's
    // logic items, their programs read from the assets the check names.
    r.check("logic.determinism", "any", &["logic.determinism"], |d, i| issues(determinism(d, i)))
        .check_report(determinism);
    r.check("logic.budget", "any", &["logic.budget"], |d, i| issues(budget(d, i)))
        .check_report(budget);
    r.code(
        "logic.determinism",
        "Seeking a logic item doesn't equal playing it: a step or full-state hash, an array or a continuation probe differs.",
        "Keep every bit of state in the program's memory and globals, and draw each roll from the seed init gets.",
        false,
    );
    r.code(
        "logic.budget",
        "A logic step passes its fuel share or its class's step ceiling, or a frame's steps pass the class's frame time.",
        "Split the work across steps with its progress in memory.",
        false,
    );
    // Each code's planted fixture (#138's kit): a program that traps at step 0, which fails the
    // determinism check that ran it, and one whose every step spends most of its fuel.
    planted(r, "logic.determinism", "(unreachable)");
    planted(r, "logic.budget", "(local $i i32) (loop $l (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_u (local.get $i) (i32.const 200000))))");
    // #535: each logic item's arrays, by `<logic>.<name>`. Its fixture's changed ranges are the
    // ones the module hands over, so the kit's clean-rebuild rule runs [`handed`] itself.
    let frames = json!([[0, 0, 0], [0, 5, 0], [0, 5, 7]]);
    let changed = json!([handed(&[]), handed(&[[1, 2]]), handed(&[[2, 3]])]);
    r.entry(
        deep_canvas::columns::REGISTRY,
        "logic.array@1",
        json!({"form": "<logic>.<name>", "types": ["bool", "i32", "f64", "vec2", "vec3", "quat"],
               "fixture": {"frames": frames, "changed": changed,
                           "seeks": [{"from": 2, "to": 1, "rows": [0, 5, 0]}]}}),
        "R6",
    );
}

fn logic_items(doc: &Value) -> impl Iterator<Item = (&String, &Value)> {
    doc.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some(INTERFACE))
}

/// A world's occurrence list and its inputs are the physics module's: no entry in a build
/// without it fills `<world ID>.occurrences` or takes a fired input (Canvas module).
fn needs_physics(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let logic: Vec<&String> = logic_items(doc).map(|(id, _)| id).collect();
    let missing = |path: String, what: String| Raised {
        code: "module_missing",
        severity: "error",
        path,
        what,
        fix_ops: None,
    };
    let mut out = Vec::new();
    let reads = item.pointer("/params/reads").and_then(Value::as_array);
    for (i, r) in reads.into_iter().flatten().enumerate() {
        let Some(world) = r.as_str().and_then(|r| r.strip_suffix(".occurrences")) else {
            continue;
        };
        if !logic.iter().any(|l| *l == world) {
            out.push(missing(
                format!("items/{id}/params/reads/{i}"),
                format!("{id} reads {world}.occurrences, a world's occurrence list, which only the physics module fills, and this build holds no physics module"),
            ));
        }
    }
    let fires = item.pointer("/params/fires").and_then(Value::as_object);
    for world in fires.into_iter().flatten().map(|(w, _)| w) {
        out.push(missing(
            format!("items/{id}/params/fires/{world}"),
            format!("{id} fires {world}'s inputs, which only the physics module applies, and this build holds no physics module"),
        ));
    }
    out
}

/// The operator's step: the gcd of its items' step lengths, so each steps on its own rate.
fn rate(doc: &Value) -> Option<i64> {
    let gcd = |a: i64, b: i64| {
        let (mut a, mut b) = (a, b);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        a
    };
    logic_items(doc)
        .map(|(_, i)| {
            let hz = i
                .pointer("/params/step_rate")
                .and_then(Value::as_f64)
                .unwrap_or(60.0);
            deep_canvas::time::step_length(hz).ok()
        })
        .try_fold(0, |g, s| Some(gcd(g, s?)))
        .filter(|g| *g > 0)
}

/// Every logic item's state after a step, as plain data, and its arrays by `<logic ID>.<name>`.
#[derive(Debug)]
pub struct State {
    pub saved: Value,
    pub arrays: BTreeMap<String, Vec<Value>>,
}

impl Canonical for State {
    fn encode(&self, out: &mut Vec<u8>) {
        out.extend(canonical(&self.saved));
    }
}

/// How many checked pieces a thread keeps.
const PIECES_KEPT: usize = 8;

thread_local! {
    /// Checked pieces by the hash of the logic they hold: what each step reads, checked once.
    static PIECES: RefCell<BTreeMap<String, Rc<Piece>>> = const { RefCell::new(BTreeMap::new()) };
}

/// The piece a document's logic items make, checked by the logic module (`piece::check`).
fn piece_of(doc: &Value) -> Result<Rc<Piece>, OpError> {
    let mut items = Map::new();
    let mut assets = Map::new();
    for (id, item) in logic_items(doc) {
        let mut params = item
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let program = params
            .get("program")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let wasm = params.remove("wasm");
        let bytes = wasm
            .as_ref()
            .and_then(Value::as_str)
            .and_then(|b| B64.decode(b).ok());
        if bytes
            .as_deref()
            .map(deep_canvas_sandbox::rewrite::hash)
            .as_deref()
            != Some(&program)
        {
            return Err(OpError::new(
                "asset_missing",
                format!("items/{id}/params/program"),
            ));
        }
        assets.insert(program, wasm.unwrap_or_default());
        items.insert(id.clone(), json!({"kind": INTERFACE, "params": params}));
    }
    let seed = doc.get("seed").and_then(Value::as_i64).unwrap_or(0);
    // The document's controls, so an item that reads one reads its input entries (#544's Fire).
    let controls = doc.get("controls").cloned().unwrap_or(json!({}));
    let piece = json!({"seed": seed, "controls": controls, "items": items, "assets": assets});
    let key = sha256_hex(&canonical(&piece));
    if let Some(p) = PIECES.with(|c| c.borrow().get(&key).cloned()) {
        return Ok(p);
    }
    let p = piece::check(&piece, &Planted::default(), &mut Default::default())
        .map(Rc::new)
        .map_err(|r| {
            OpError::new(
                "logic_refused",
                r.0["item"].as_str().unwrap_or("").to_string(),
            )
        })?;
    PIECES.with(|c| {
        let mut c = c.borrow_mut();
        // A few documents' pieces at once; an edited one's old pieces go.
        if c.len() >= PIECES_KEPT {
            c.clear();
        }
        c.insert(key, p.clone());
    });
    Ok(p)
}

fn failed(e: Value) -> OpError {
    OpError::new("logic_failed", e["item"].as_str().unwrap_or("").to_string())
}

/// One step of the document's logic items: those due at the step's time, from the state the
/// last step carried, or from their start function and `init` at the first.
fn step(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let t = v.t()?;
    let piece = piece_of(doc)?;
    // The played form's input track (Input track): the entries of the controls its items read.
    let read = |c: &str| piece.items.iter().any(|i| i.reads.iter().any(|r| r == c));
    let mut entries = Vec::new();
    for e in doc
        .get("track")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if e.get("control").and_then(Value::as_str).is_some_and(read) {
            entries.push(Entry::parse(e).ok_or_else(|| OpError::new("bad_input", e.to_string()))?);
        }
    }
    let track = track_of(&entries);
    let mut rec = Record::default();
    let mut world = match v.carried(STATE).and_then(|s| s.as_typed::<State>()) {
        None => World::new(
            piece.clone(),
            track,
            false,
            Planted::default(),
            &mut rec,
            None,
        ),
        Some(s) => World::from_saved(piece.clone(), track, &s.saved, Planted::default()),
    }
    .map_err(failed)?;
    world.run_through(t, &mut rec);
    // A trapped item never draws its last arrays as if it ran on (Logic: `logic.trap`).
    let trapped = world.failed();
    if !trapped.is_empty() {
        return Err(OpError::new("logic.trap", trapped.join(", ")));
    }
    let mut arrays = BTreeMap::new();
    for (i, item) in piece.items.iter().enumerate() {
        for w in &item.writes {
            if let Some(a) = world.array(i, &w.name) {
                arrays.insert(format!("{}.{}", item.id, w.name), a);
            }
        }
    }
    v.note_step(t / rate(doc).unwrap_or(STEP), 0);
    v.write(
        STATE,
        Val::typed(State {
            saved: world.saved(),
            arrays,
        }),
    )
}

/// The kit fixture's program, assembled from its text, with its hash.
fn fixture_program() -> (String, Vec<u8>) {
    let bytes = wat::parse_str(include_str!("fixture.wat")).expect("the fixture assembles");
    (deep_canvas_sandbox::rewrite::hash(&bytes), bytes)
}

thread_local! {
    static FIXTURE: Rc<Piece> = {
        let (sha, bytes) = fixture_program();
        let piece = json!({"seed": 533, "controls": {"press": {}},
            "items": {"counter": {"kind": INTERFACE, "params": {"program": sha, "reads": ["press"],
                "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}},
            "assets": {sha: B64.encode(&bytes)}});
        Rc::new(piece::check(&piece, &Planted::default(), &mut Default::default()).expect("the fixture checks"))
    };
}

/// The kit's stepper: the fixture's item from its `init`, as plain data.
fn fixture_init() -> Value {
    let piece = FIXTURE.with(Rc::clone);
    let mut world = World::new(
        piece,
        Default::default(),
        false,
        Planted::default(),
        &mut Record::default(),
        None,
    )
    .expect("the fixture starts");
    world.saved()
}

/// One step of the fixture: each input entry the kit stamps at it is a press.
fn fixture_step(state: &mut Value, input: &StepInput<'_>) {
    let piece = FIXTURE.with(Rc::clone);
    let next = state[0]["next"].as_i64().unwrap_or(0);
    let t = next * piece.items[0].step;
    let entries: Vec<Entry> = input
        .entries
        .iter()
        .enumerate()
        .map(|(seq, e)| Entry {
            t,
            seq: seq as u32,
            control: "press".into(),
            value: e["value"].as_f64().unwrap_or(1.0).into(),
            writer: "you".into(),
            player: 1,
            as_of: None,
            arrived: 0,
        })
        .collect();
    let mut world = World::from_saved(piece, track_of(&entries), state, Planted::default())
        .expect("the fixture's state loads");
    world.run_through(t, &mut Record::default());
    *state = world.saved();
}

/// The fixture that raises exactly `code`: a figure of one logic item whose step is `body`, its
/// program a fixture asset, since a kit fixture has no evidence store. It names no other module's
/// kind, which the kit's seal of this module alone would refuse as unknown.
fn planted(r: &mut Registrar, code: &str, body: &str) {
    let text = format!(r#"(module (memory (export "memory") 1 1) (global (export "reads_at") i32 (i32.const 0))
        (global (export "writes_at") i32 (i32.const 1024)) (func (export "init") (param i64)) (func (export "step") (param i64) {body}))"#);
    let program = wat::parse_str(text).expect("a planted program");
    let sha = deep_canvas::canon::sha256_hex(&program);
    let doc = json!({
        "format": 1, "profile": "figure", "title": code, "description": format!("The logic module's planted {code}."), "size": [320, 180],
        "seed": 1, "transport": {"span": "1s", "frame_rate": [60, 1]}, "requires": {"modules": {"logic": "^1"}},
        "items": {
            "rules": {"id": "rules", "kind": "logic@1", "name": "Rules", "order": "a1", "params": {"program": sha, "writes": {"n": {"type": "i32"}}}},
        },
    });
    r.fixture(&format!("logic-{}", &code[6..]), doc, None)
        // The module registers its own kind (#533), so the kit's seal of this module alone knows
        // logic@1 and the fixture raises its code and no other.
        .sidecar(json!({"codes": [code], "checks": [{"kind": code}]}))
        .fixture_assets(vec![program]);
}

/// What a report raises, as a check over items gives it.
fn issues(report: Report) -> Vec<(String, Raised)> {
    report.raised.into_iter().map(|(id, r, _)| (id, r)).collect()
}

/// The lowered document's logic items as one checked piece, its input track, and the steps its
/// transport's span covers; or why it can't be read, as a blocked row.
fn baked(doc: &Value, input: &Value) -> Result<(Rc<Piece>, Vec<Entry>, i64), Value> {
    let items: serde_json::Map<String, Value> = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i["kind"] == "logic@1")
        .map(|(id, i)| (id.clone(), json!({"kind": "logic@1", "params": i.get("params").cloned().unwrap_or(json!({}))})))
        .collect();
    let line = json!({"seed": doc.get("seed").and_then(Value::as_i64).unwrap_or(0),
        "controls": doc.get("controls").cloned().unwrap_or(json!({})), "items": items,
        "assets": input.get("assets").cloned().unwrap_or(json!({}))});
    let piece = piece::check(&line, &Default::default(), &mut History::new()).map_err(|r| r.0)?;
    let entries: Vec<Entry> = doc
        .get("track")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|e| e.get("present").is_none())
        .filter_map(Entry::parse)
        .collect();
    let span = doc
        .pointer("/transport/span")
        .map_or(Ok(0), |v| deep_canvas::document::duration(doc, v))
        .map_err(|e| json!({"what": format!("the transport's span: {e}")}))?;
    let steps = piece.items.iter().map(|i| (span + i.step - 1) / i.step.max(1)).max().unwrap_or(0);
    Ok((Rc::new(piece), entries, steps))
}

/// Each failure of a logic check as the report raises it: on its item, its row as `actual`.
fn raised(kind: &'static str, failures: &[Value], piece: &Piece) -> Vec<(String, Raised, Value)> {
    failures
        .iter()
        .map(|f| {
            let item = f["item"].as_str().or_else(|| piece.items.first().map(|i| i.id.as_str())).unwrap_or_default().to_string();
            let what = format!("{kind}: {}", f.get("rule").or_else(|| f.get("run")).map_or_else(|| f.to_string(), Value::to_string));
            let r = Raised { code: kind, severity: "error", path: format!("items/{item}"), what, fix_ops: None };
            (item, r, f.clone())
        })
        .collect()
}

/// `logic.determinism {at_times, compare}`: the bake run twice and from each checkpoint before
/// each sampled time, with continuation probes; another machine or the web player is BLOCKED
/// until it has run.
fn determinism(doc: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    let (piece, entries, steps) = match baked(doc, input) {
        Ok(b) => b,
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    };
    let len = piece.items.first().map_or(1, |i| i.step.max(1));
    let mut at: Vec<i64> = input
        .get("at_times")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| deep_canvas::document::duration(doc, t).ok())
        .map(|t| (t / len).clamp(1, steps.max(1)))
        .collect();
    if at.is_empty() {
        at.push((steps / 2).max(1));
    }
    // A trap in any run fails the check that ran it (Check input: logic kinds).
    let mut rec = Record::default();
    match World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None) {
        Ok(mut w) => w.run(steps, &mut rec, &mut |_, _| {}),
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    }
    let mut failures: Vec<Value> = rec.traps.iter().map(|t| json!({"rule": "trap", "item": t["item"], "trap": t})).collect();
    match crate::checks::determinism(&piece, &entries, steps, &at, Default::default()) {
        Ok(v) => failures.extend(v["failures"].as_array().cloned().unwrap_or_default()),
        Err(e) => out.blocked.push(e),
    }
    out.raised = raised("logic.determinism", &failures, &piece);
    if let Some(c @ ("cross_machine" | "web")) = input.get("compare").and_then(Value::as_str) {
        out.blocked.push(json!({"compare": c, "ask": format!("logic.determinism {c} replays the golden on another host; it hasn't run")}));
    }
    out.results.push(json!({"kind": "logic.determinism", "steps": steps, "at": at}));
    out
}

/// `logic.budget {fuel_share, on}`: the bake's fuel per step held to its share and its class's
/// step ceiling on each host, and the web BLOCKED until the player's timed run.
fn budget(doc: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    let (piece, entries, steps) = match baked(doc, input) {
        Ok(b) => b,
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    };
    let share = input.get("fuel_share").and_then(Value::as_f64).unwrap_or(0.5);
    let on: Vec<String> = input
        .get("on")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_else(|| vec!["app".into()]);
    let mut rec = Record::default();
    match World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None) {
        Ok(mut w) => w.run(steps, &mut rec, &mut |_, _| {}),
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    }
    // A trap fails the check that ran it (Check input: logic kinds).
    let mut failures: Vec<Value> = rec.traps.iter().map(|t| json!({"rule": "trap", "item": t["item"], "trap": t})).collect();
    let reply = crate::budget::budget(&piece, &rec, share, &on, Default::default());
    failures.extend(reply["failures"].as_array().cloned().unwrap_or_default());
    out.raised = raised("logic.budget", &failures, &piece);
    out.blocked.extend(reply["blocked"].as_array().cloned().unwrap_or_default());
    out.results.push(json!({"kind": "logic.budget", "report": reply["report"]}));
    out
}
