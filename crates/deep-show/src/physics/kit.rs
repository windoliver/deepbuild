//! #522: the physics module in the conformance kit (#138; tests/acceptance/522/README.md: the
//! physics module in the kit). Its stepper carries a world as the backend's whole-world
//! checkpoint, so a seek or a rollback loads what the world held, joint state and warm-start
//! impulses with it; its fixture `parity/physics/late-joint.board` hangs a 2 kg box from the
//! world on a fixed joint with `breaks_at: {force: 15 N, over_steps: 3}`, past it from the first
//! step, and declares a poke of a second body at the step whose checkpoint a late entry restores.
//! `test-physics-checkpoint-drops-break-steps` plants a checkpoint that leaves out each joint's
//! count of steps past `breaks_at`, so it is restored as 0. #182: the same world holds the
//! character course 20 m along z (a 1 m gap, a 30° ramp rising 2 m, a 0.3 m step), whose fixture
//! `parity/physics/character-course.board` walks its character body over the gap with a jump and
//! onto the ramp's foot, so seeks and late entries restore a character's own state, mid-jump
//! included.

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

/// The course's lane along z (#182), clear of the joint's bodies.
const LANE: f64 = 20.0;

/// The fixture's world: `heavy` (2 kg) on `snap`, and `puck`, free, which the entry pokes; and
/// (#182) the character course, `hero` standing on its start.
fn world() -> Value {
    let hang = |x: f64, mass: f64| {
        json!({"kind": "dynamic", "shapes": [{"shape": "tall", "contact_material": "block"}],
                                          "pose": {"pos": [x, 1.5, 0]}, "mass": mass, "sleep": false})
    };
    let mut shapes = json!({"tall": {"kind": "box", "half": [0.25, 0.5, 0.25]},
                            "capsule": {"kind": "capsule", "half_height": 0.6, "radius": 0.3}});
    let mut bodies = json!({"heavy": hang(-2.0, 2.0), "puck": hang(4.0, 1.0),
                            "hero": {"kind": "character", "shapes": [{"shape": "capsule", "contact_material": "block"}],
                                     "pose": {"pos": [0, 0.91, LANE]}, "character": {"slope_limit": 45, "step": {"height": 0.35}}}});
    let crest = 5.0 + 2.0 / (30f64).to_radians().tan();
    let slab = |x0: f64, x1: f64, y0: f64, y1: f64| {
        (
            json!({"kind": "box", "half": [(x1 - x0) / 2.0, (y1 - y0) / 2.0, 2.0]}),
            json!([(x0 + x1) / 2.0, (y0 + y1) / 2.0, LANE]),
        )
    };
    let mut part = |id: &str, (shape, pos): (Value, Value)| {
        shapes[id] = shape;
        bodies[id] = json!({"kind": "static", "shapes": [{"shape": id, "contact_material": "block"}], "pose": {"pos": pos}});
    };
    part("pit", slab(-4.0, 31.0, -5.0, -4.0));
    part("start", slab(-3.0, 2.0, -1.0, 0.0));
    part("shelf", slab(3.0, 5.0, -1.0, 0.0));
    let wedge = json!({"kind": "convex", "points": [[5, 0, LANE - 2.0], [5, 0, LANE + 2.0], [crest, 0, LANE - 2.0],
                       [crest, 0, LANE + 2.0], [crest, 2, LANE - 2.0], [crest, 2, LANE + 2.0]]});
    part("ramp", (wedge, json!([0, 0, 0])));
    part("top", slab(crest, 11.0, -1.0, 2.0));
    part("step", slab(11.0, 30.0, -1.0, 2.3));
    json!({"kind": "physics.world@1", "dimensions": 3, "step_rate": HZ, "substeps": 4, "gravity": [0, -9.81, 0],
           "mode": "dynamic", "capacity": {"bodies": 16, "shapes": 16, "joints": 1, "contacts": 64, "particles": 0},
           "contact_materials": {"block": {"friction": 0.5, "restitution": 0, "density": 1000}},
           "shapes": shapes, "bodies": bodies,
           "inputs": {"walk": {"kind": "move", "targets": ["hero"]}, "hop": {"kind": "jump", "targets": ["hero"]}},
           "joints": {"snap": {"kind": "fixed", "a": "world", "b": "heavy", "frame_a": {"anchor": [-2, 2, 0]},
                               "frame_b": {"anchor": [0, 0.5, 0]}, "breaks_at": {"force": 15, "over_steps": 3}}}})
}

fn built() -> (World, Rapier) {
    built_from(&world())
}

/// `doc` checked and built on Rapier; #251's course too (physics/lap.rs).
pub(super) fn built_from(doc: &Value) -> (World, Rapier) {
    let w =
        check(doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE).expect("the kit's world checks");
    let mut b = Rapier::default();
    b.build(&w).expect("the kit's world builds");
    (w, b)
}

/// A state: the world's whole checkpoint, and the rows its last step wrote, each break with its
/// joint's `over_steps`.
pub(super) fn state_of(b: &Rapier, rows: Vec<Value>) -> Value {
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
    load_in(built(), state)
}

/// The world `built` as `state` holds it.
pub(super) fn load_in((w, mut b): (World, Rapier), state: &Value) -> (World, Rapier) {
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
    step_on(load(state), state, input);
}

/// One step of the world `loaded`, which `state` held, with the entries `input` stamps.
pub(super) fn step_on((w, mut b): (World, Rapier), state: &mut Value, input: &StepInput<'_>) {
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
        board.clone(),
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [],
               "at_times": ["0s", "0.25s"], "inputs": [{"step": RESTORED, "kind": "poke", "target": "puck", "data": {"push": [1, 0, 0]}}]}),
    );
    // #182: the character course, walked from the restored step and jumped over its gap, over
    // 3 s: past its landing on the far side and onto the ramp's foot.
    let mut course = board;
    course["title"] = json!("Character course");
    course["description"] = json!("A fixture of the physics module: a character body walking a course with a gap, a ramp and a step, and jumping.");
    r.parity(
        "physics",
        "character-course",
        course,
        json!({"checks": [{"kind": "document.determinism"}], "oracles": ["seek_play"], "codes": [], "at_times": ["0s", "3s"],
               "inputs": [{"step": RESTORED, "kind": "move", "target": "hero", "data": {"velocity": [2, 0, 0]}},
                          {"step": RESTORED + 96, "kind": "jump", "target": "hero", "data": {"height": 1}}]}),
    );
}

/// #191: the physics interface's behavior part on this build's backend, through the same
/// `behavior_kit` call the `deep-physics` binary answers: a case per fixture that ran, failing with
/// the backend, the fixture, the measure, the answer and the tolerance; each fixture its caps
/// exclude listed beside the cases, never passed; a refused candidate failing, naming its claims.
pub(crate) fn behavior(module: &str) -> Option<super::super::kit::PartRun> {
    use super::super::kit::{failure, Case, PartRun, Verdict};
    if module != "physics" {
        return None;
    }
    let reply =
        deep_physics_rapier::runner::Run::new(None)?.answer(&json!({"call": "behavior_kit"}))?;
    let results = reply["results"].as_array().cloned().unwrap_or_default();
    if reply["admitted"] != true {
        let mut part = PartRun::new(1);
        let mut case = Case::new("behavior:refused", Verdict::Pass);
        case.fail(
            Verdict::Fail,
            failure("refused", module, "behavior", reply["refused"].clone()),
        );
        part.cases.push(case);
        return Some(part);
    }
    let (excluded, ran): (Vec<Value>, Vec<Value>) = results
        .into_iter()
        .partition(|r| r["result"] == "excluded_by_caps");
    // Each fixture that runs is a case; one its caps exclude is listed beside them, never a case.
    let mut part = PartRun::new(ran.len() as u64);
    for r in ran {
        let mut case = Case::new(
            format!("behavior:{}", r["fixture"].as_str().unwrap_or("")),
            Verdict::Pass,
        )
        .with("result", r.clone());
        if r["result"] != "pass" {
            case.fail(
                Verdict::Fail,
                failure("outside_tolerance", module, "behavior", r),
            );
        }
        part.cases.push(case);
    }
    part.extra
        .insert("excluded_by_caps".into(), json!(excluded));
    Some(part)
}
