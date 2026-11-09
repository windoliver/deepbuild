//! The media canvas module `media@1` (issue #499; technical design: The media module): strips on
//! tracks, buses with processors whose state checkpoints its tail, emitters, and a video's frames
//! on image@1. Its kit is every part of the canvas kit on its fixtures, the carried-state part
//! over a reverb's checkpointed tail among them, with no behavior part.

use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Range, Raised, Registrar, Semver, StepInput,
    Stepper,
};
use serde_json::{json, Value};

use crate::mix::BLOCK;
use crate::reverb::{Reverb, Spec, State};

/// The fixture reverb the carried-state stepper runs: small, so its state hashes cheaply.
const SPEC: Spec = Spec {
    decay: 0.4,
    size: 0.05,
    damping: 0.5,
    mix: 0.5,
};
const RATE: i64 = 48_000;
/// Steps a second: one a block.
const HZ: i64 = RATE / BLOCK;

fn manifest(implementation: &str) -> Manifest {
    let dep = |r: &str| Dependency {
        range: Range::parse(r).expect("a range"),
        optional: false,
    };
    Manifest {
        name: "media".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [("scene3d".to_string(), dep("^1"))].into_iter().collect(),
        feature: "media".into(),
        license: "Apache-2.0".into(),
        implements: "media@1".into(),
        implementation: Implementation::reference(
            implementation,
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// `media`, the shipped implementation of media@1.
pub fn module() -> Module {
    Module {
        manifest: manifest("media"),
        register: |r| register(r, restore),
    }
}

/// The planted implementation (#499): its reverb checkpoint leaves out its tail.
pub fn checkpoint_without_tail() -> Module {
    Module {
        manifest: manifest("media.checkpoint_without_tail"),
        register: |r| register(r, restore_without_tail),
    }
}

fn register(r: &mut Registrar, restore: fn(&Value) -> Value) {
    // A bell on a box, so the kit checks a document with strips and an emitter (#427).
    r.fixture("bell", deep_canvas_scene3d::emitters::bell(), None)
        .sidecar(json!({"codes": []}));
    r.fixture("reverb", crate::fixtures::reverb_board(), None)
        .sidecar(json!({"codes": [], "at_times": ["0s", "3s"]}));
    r.stepper(Stepper {
        hz: HZ,
        // The first block boundary at or after each whole second (Blocks), as steps from 1.
        checkpoints: (0..4).map(|s| s * HZ + 1).collect(),
        init,
        step,
        checkpoint: Value::clone,
        restore,
        rollback: |_, cp| cp.clone(),
        occurrences: |_| Vec::new(),
    });
    r.rule("image@1", av_link);
}

fn init() -> Value {
    json!({"step": 0, "reverb": Reverb::new(SPEC, RATE).state.to_json()})
}

/// One block of the fixture's input (a click every 0.1 s) through the reverb.
fn step(state: &mut Value, input: &StepInput<'_>) {
    let mut reverb = Reverb::new(SPEC, RATE);
    if let Some(s) = State::from_json(&state["reverb"]) {
        reverb.state = s;
    }
    let first = (input.step - 1) * BLOCK;
    let mut block = vec![0f32; 2 * BLOCK as usize];
    for (i, f) in block.chunks_exact_mut(2).enumerate() {
        if (first + i as i64) % (RATE / 10) == 0 {
            f[0] = 0.5;
            f[1] = 0.5;
        }
    }
    reverb.process(&mut block);
    let out: f64 = block.iter().map(|x| *x as f64).sum();
    *state = json!({"step": input.step, "out": out, "reverb": reverb.state.to_json()});
}

fn restore(cp: &Value) -> Value {
    cp.clone()
}

fn restore_without_tail(cp: &Value) -> Value {
    let mut v = cp.clone();
    if let Some(s) = State::from_json(&cp["reverb"]) {
        v["reverb"] = s.without_tail().to_json();
    }
    v
}

/// `av_unlinked`: a picture of a video asset and a sound strip of the same asset agree on start,
/// in and rate unless the strip declares an `offset`.
fn av_link(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let Some(frames) = item.pointer("/params/frames") else {
        return Vec::new();
    };
    let Some(asset) = item.pointer("/params/asset").and_then(Value::as_str) else {
        return Vec::new();
    };
    let start_only = crate::planted("av_link_compares_start_only");
    let mut out = Vec::new();
    for (sid, strip) in doc["strips"].as_object().into_iter().flatten() {
        if crate::doc::strip_asset(strip) != Some(asset) || strip.get("offset").is_some() {
            continue;
        }
        let fields: &[&str] = if start_only { &["start"] } else { &["start", "in", "rate"] };
        for f in fields {
            let (a, b) = (crate::doc::link_value(doc, frames, f), crate::doc::link_value(doc, strip, f));
            if a != b {
                out.push(Raised {
                    code: "av_unlinked",
                    severity: "error",
                    path: format!("strips/{sid}/{f}"),
                    what: format!(
                        "the picture {id} and the sound strip {sid} of one video disagree on {f}; move both together, or give the strip an offset"
                    ),
                    fix_ops: None,
                });
            }
        }
    }
    out
}
