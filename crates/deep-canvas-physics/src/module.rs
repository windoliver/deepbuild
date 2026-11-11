//! The physics canvas module's manifest and register call (#1918): `physics@1`, which fills the
//! core's `column.source@1` with each world's occurrence list, `<world ID>.occurrences`, and its
//! readings of a body or joint, `<world ID>.<ID>.<read>` (Array and table: column view), so a
//! driver, a spawn or a logic item reads them by form and depends on no physics crate. Its one
//! array, `physics.occurrences`, is the list a step writes: a module that names it instead of the
//! form reads physics by name, which the seal refuses unless it declares the dependency. The host
//! bakes the lists and readings at check, as the logic module's are. Its implementation is the
//! backend's crate, declared measured with backend_bytes state (World and backend; #1920), its
//! pins the backend and the crates under it as the build resolved them, so the seal's runtime
//! digest names them.

use std::collections::BTreeMap;

use deep_canvas::columns::REGISTRY;
use deep_canvas::registry::{
    Equivalence, Implementation, Manifest, Module, Pin, Range, Registrar, Semver, StateClass,
};
use serde_json::{json, Value};

use crate::bake::Build;

/// The interface this module implements.
pub const INTERFACE: &str = "physics@1";

/// The most changed ranges a source hands the view a step; any more merge into their span
/// (Array and table: column view).
pub const HANDED: usize = 64;

/// The index ranges `[start, end)` where `next` differs from `prev`, at most [`HANDED`]: the
/// rows a source hands the view after a step.
pub fn changed(prev: &[Value], next: &[Value]) -> Vec<[u64; 2]> {
    let n = prev.len().max(next.len());
    let mut runs: Vec<[u64; 2]> = Vec::new();
    for i in (0..n).filter(|i| prev.get(*i) != next.get(*i)) {
        match runs.last_mut() {
            Some(r) if r[1] == i as u64 => r[1] += 1,
            _ => runs.push([i as u64, i as u64 + 1]),
        }
    }
    if runs.len() > HANDED {
        let tail = runs.split_off(HANDED - 1);
        runs.push([tail[0][0], tail[tail.len() - 1][1]]);
    }
    runs
}

fn manifest(build: &Build) -> Manifest {
    let pins = std::iter::once(&build.backend)
        .chain(&build.pins)
        .map(|p| {
            let pin = Pin {
                version: p.version.clone(),
                features: p.features.clone(),
            };
            (p.name.clone(), pin)
        })
        .collect();
    Manifest {
        name: "physics".into(),
        version: Semver::parse("1.0.0").expect("a version"),
        core: Range::parse("*").expect("a range"),
        depends_on: BTreeMap::new(),
        feature: "physics".into(),
        license: "Apache-2.0".into(),
        implements: INTERFACE.into(),
        implementation: Implementation {
            name: build.implementation.clone(),
            version: Semver::parse(&build.version).expect("a crate's version"),
            pins,
            equivalence: Equivalence::Measured,
            state: StateClass::BackendBytes,
        },
    }
}

/// The shipped module, on the backend `build` names.
pub fn module(build: &Build) -> Module {
    Module {
        manifest: manifest(build),
        register,
    }
}

/// The planted module (#1918, criterion 3): its readings entry hands the view no changed ranges
/// while the ball moves, so the registry's kit fails clean-rebuild equality at the seal, naming
/// the frame.
pub fn hands_no_changes(build: &Build) -> Module {
    Module {
        manifest: manifest(build),
        register: |r| entries(r, |_, _| Vec::new()),
    }
}

fn register(r: &mut Registrar) {
    entries(r, changed);
}

/// A fixture's frames, with the ranges `hand` reports between each and the one before.
fn fixture(frames: &[Vec<Value>], hand: fn(&[Value], &[Value]) -> Vec<[u64; 2]>) -> Value {
    let mut ranges = vec![json!([])];
    ranges.extend(frames.windows(2).map(|w| json!(hand(&w[0], &w[1]))));
    json!({"frames": frames, "changed": ranges, "seeks": [{"from": 2, "to": 1, "rows": frames[1]}]})
}

/// The two entries, the readings' fixture's changed ranges `hand`'s: a list's kind column
/// filling its rows as a ball lands and bounces, and the ball-and-goal lab's ball, kicked at
/// (6, 3, 0.4) m/s, read at its first three 60 fps frames (`lab.ball.position`).
fn entries(r: &mut Registrar, hand: fn(&[Value], &[Value]) -> Vec<[u64; 2]>) {
    let rows = |f: Value| f.as_array().cloned().unwrap_or_default();
    let list = [json!([0, 0, 0]), json!([1, 0, 0]), json!([1, 3, 0])].map(rows);
    let ball = [
        json!([[0.0, 0.10999999940395355, 0.0]]),
        json!([[0.10000001639127731, 0.15846720337867737, 0.0066666672937572]]),
        json!([[0.20000003278255463, 0.20420940220355988, 0.0133333345875144]]),
    ]
    .map(rows);
    r.entry(
        REGISTRY,
        "physics.occurrences@1",
        json!({"form": "<world ID>.occurrences", "types": ["u32", "u8"], "fixture": fixture(&list, changed)}),
        "R6",
    );
    r.entry(
        REGISTRY,
        "physics.reading@1",
        json!({"form": "<world ID>.<ID>.<read>", "types": ["f64", "vec3", "quat"], "fixture": fixture(&ball, hand)}),
        "R6",
    );
    r.array(
        "physics.occurrences",
        "occurrences",
        "document",
        "time",
        "simulate",
    );
}
