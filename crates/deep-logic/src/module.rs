//! The logic canvas module (canvas primitives: Canvas module, Logic `logic@1`; #533): `logic@1`'s
//! implementation, bit and canonical, its engine sandbox@1's pinned wasmtime. It registers the
//! logic item's kind, a check that refuses what only the physics module fills, and one operator
//! in simulate that steps a document's logic items at their rates, carrying each item's memory,
//! globals and arrays from step to step as plain data, so a seek restores a checkpoint and steps
//! on. Its kit runs every part of the canvas kit on its own fixture.
//!
//! A step loads the carried state into a fresh instance of the item's rewritten program; the
//! checked piece behind it is cached per thread by the document's logic content, which a step
//! only reads. A document's control and reading entries don't reach its items here yet: a logic
//! item that reads one is refused by the logic module's own check, as a piece without the
//! control is.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas::kinds::{Entry as KindEntry, Param, ParamType, Version};
use deep_canvas::registry::{
    Dependency, Equivalence, Implementation, Manifest, Module, Pin, Raised, Range, Registrar,
    Semver, StateClass, StepInput, Stepper,
};
use deep_canvas::schedule::{canonical, sha256_hex, Canonical, OpError, Val, View};
use serde_json::{json, Map, Value};

use crate::piece::{self, Piece};
use crate::world::{track_of, Entry, Record, World};
use crate::Planted;

/// The interface this module implements, apart from the logic item kind of that name.
pub const INTERFACE: &str = "logic@1";
/// The array the step operator carries: every logic item's state after the last step.
pub const STATE: &str = "logic.state";
/// A step at 60 Hz, in flicks: the rate of a document whose items name none.
const STEP: i64 = 11_760_000;
/// The params a logic item takes here; `wasm` is the program's bytes, which whoever holds the
/// evidence store inlines by the program's hash before a frame, as a vector's outline is.
const PARAMS: [&str; 9] = [
    "program",
    "step_rate",
    "reads",
    "writes",
    "fires",
    "budget",
    "checkpoint",
    "assets",
    "wasm",
];

/// The shipped module.
pub fn module() -> Module {
    implementation(Semver::parse("1.0.0").expect("a version"))
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
    let param = |name| Param {
        name,
        ty: ParamType::Json,
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
    r.rule("logic", needs_physics);
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
    static PIECES: RefCell<BTreeMap<String, Rc<Piece>>> = RefCell::new(BTreeMap::new());
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
    let piece = json!({"seed": seed, "items": items, "assets": assets});
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
    let mut rec = Record::default();
    let mut world = match v.carried(STATE).and_then(|s| s.as_typed::<State>()) {
        None => World::new(
            piece.clone(),
            Default::default(),
            false,
            Planted::default(),
            &mut rec,
            None,
        ),
        Some(s) => World::from_saved(
            piece.clone(),
            Default::default(),
            &s.saved,
            Planted::default(),
        ),
    }
    .map_err(failed)?;
    world.run_through(t, &mut rec);
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
            value: e["value"].as_f64().unwrap_or(1.0),
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
