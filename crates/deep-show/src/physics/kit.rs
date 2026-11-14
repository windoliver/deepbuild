//! #522: the physics module in the conformance kit (#138; tests/acceptance/522/README.md: the
//! physics module in the kit). Its stepper carries a world as the backend's whole-world
//! checkpoint, so a seek or a rollback loads what the world held, joint state and warm-start
//! impulses with it; its fixture `parity/physics/late-joint.board` hangs a 2 kg box from the
//! world on a fixed joint with `breaks_at: {force: 15 N, over_steps: 3}`, past it from the first
//! step, and declares a poke of a second body at the step whose checkpoint a late entry restores.
//! `test-physics-checkpoint-drops-break-steps` plants a checkpoint that leaves out each joint's
//! count of steps past `breaks_at`, so it is restored as 0.

use deep_canvas::registry::{Registrar, StepInput, Stepper};
use deep_canvas_physics::backend::{Backend, Checkpoint, Input, Targets};
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::doc::World;
use deep_canvas_physics::{occurrence, track};
use deep_physics_rapier::planted::Restore;
use deep_physics_rapier::Rapier;
use serde_json::{json, Value};

const HZ: i64 = 120;
/// The step whose checkpoint (the state before it runs) a late entry at it restores: the joint
/// crossed its threshold on the step before it.
const RESTORED: i64 = 2;

/// The fixture's world: `heavy` (2 kg) on `snap`, and `puck`, free, which the entry pokes.
fn world() -> Value {
    let hang = |x: f64, mass: f64| {
        json!({"kind": "dynamic", "shapes": [{"shape": "tall", "contact_material": "block"}],
                                          "pose": {"pos": [x, 1.5, 0]}, "mass": mass, "sleep": false})
    };
    json!({"kind": "physics.world@1", "dimensions": 3, "step_rate": HZ, "substeps": 4, "gravity": [0, -9.81, 0],
           "mode": "dynamic", "capacity": {"bodies": 2, "shapes": 2, "joints": 1, "contacts": 8, "particles": 0},
           "contact_materials": {"block": {"friction": 0.5, "restitution": 0, "density": 1000}},
           "shapes": {"tall": {"kind": "box", "half": [0.25, 0.5, 0.25]}},
           "bodies": {"heavy": hang(-2.0, 2.0), "puck": hang(4.0, 1.0)},
           "joints": {"snap": {"kind": "fixed", "a": "world", "b": "heavy", "frame_a": {"anchor": [-2, 2, 0]},
                               "frame_b": {"anchor": [0, 0.5, 0]}, "breaks_at": {"force": 15, "over_steps": 3}}}})
}

fn built() -> (World, Rapier) {
    let w = check(&world(), &RAPIER3D, &deep_canvas_physics::roles::TABLE)
        .expect("the kit's world checks");
    let mut b = Rapier::default();
    b.build(&w).expect("the kit's world builds");
    (w, b)
}

/// A state: the world's whole checkpoint, and the rows its last step wrote, each break with its
/// joint's `over_steps`.
fn state_of(b: &Rapier, rows: Vec<Value>) -> Value {
    let cp = b.checkpoint();
    let hex: String = cp.state.iter().map(|x| format!("{x:02x}")).collect();
    json!({"step": cp.step, "world": hex, "rows": rows})
}

fn bytes(hex: &str) -> Vec<u8> {
    (0..hex.len() / 2)
        .filter_map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok())
        .collect()
}

fn load(state: &Value) -> (World, Rapier) {
    let (w, mut b) = built();
    let cp = Checkpoint {
        backend: RAPIER3D.backend.into(),
        version: RAPIER3D.version.into(),
        features: Vec::new(),
        step: state["step"].as_u64().unwrap_or(0),
        state: bytes(state["world"].as_str().unwrap_or_default()),
    };
    b.restore(&cp).expect("the kit's checkpoint loads");
    (w, b)
}

fn init() -> Value {
    state_of(&built().1, Vec::new())
}

fn step(state: &mut Value, input: &StepInput<'_>) {
    let (w, mut b) = load(state);
    let inputs: Vec<Input> = input
        .entries
        .iter()
        .filter_map(|e| track::entry(&w, e, "inputs").ok())
        .map(|e| Input {
            kind: e.kind,
            target: e.target,
            data: Value::Object(e.data),
        })
        .collect();
    b.step(&inputs, &Targets::default())
        .expect("the kit's world steps");
    let rows = occurrence::sorted(input.step as u32, b.occurrences(), &occurrence::ranks(&w));
    let rows = occurrence::listed(&rows).into_iter().map(|mut r| {
        if r["kind"] == "break" {
            let over = r["a"]
                .as_str()
                .and_then(|j| w.joints.get(j))
                .and_then(|j| j.breaks_at.as_ref())
                .map(|b| b.over_steps);
            r["over_steps"] = json!(over);
        }
        r
    });
    *state = state_of(&b, rows.collect());
}

/// The planted checkpoint: the world with each joint's steps past `breaks_at` set to 0.
fn checkpoint_dropping_breaks(state: &Value) -> Value {
    let (_, mut b) = load(state);
    let built = built().1.checkpoint();
    b.plant(Restore::NoBreakCount, &built);
    state_of(&b, state["rows"].as_array().cloned().unwrap_or_default())
}

pub(super) fn register(r: &mut Registrar) {
    let checkpoint = if cfg!(feature = "test-physics-checkpoint-drops-break-steps") {
        checkpoint_dropping_breaks
    } else {
        Value::clone
    };
    r.stepper(Stepper {
        hz: HZ,
        checkpoints: vec![RESTORED],
        init,
        step,
        checkpoint,
        restore: Value::clone,
        rollback: |_, cp| cp.clone(),
        occurrences: |s| s["rows"].as_array().cloned().unwrap_or_default(),
    });
    // An item for the kit's time_order twin to move, of scene3d's kind, as media's board has.
    let plate = json!({"id": "plate", "kind": "mark.box@1", "name": "Plate", "order": "a0",
                       "params": {"size": [0.3, 0.3, 0.3], "paint": {"fill": {"role": "muted"}}}});
    let board = json!({"format": 1, "profile": "board", "title": "Late joint",
                       "description": "A fixture of the physics module: a joint past its threshold when a late entry's rollback restores.",
                       "size": [320, 200], "requires": {"modules": {"scene3d": "^1", "physics": "^1"}}, "items": {"plate": plate}});
    r.parity(
        "physics",
        "late-joint",
        board,
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [],
               "at_times": ["0s", "0.25s"], "inputs": [{"step": RESTORED, "kind": "poke", "target": "puck", "data": {"push": [1, 0, 0]}}]}),
    );
}
