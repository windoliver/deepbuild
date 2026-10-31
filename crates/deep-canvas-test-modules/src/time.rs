//! The #488 acceptance README's test canvas modules (The test canvas modules): `test.tick`, a
//! stepping module with checkpoints whose state reaches the pixels, and `test.cache`, a module
//! whose own cache is keyed by frame number, the wrong program a warm play against a cold seek
//! catches. Neither is in a shipped build.

use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::{OpError, Val, View};
use std::collections::BTreeMap;

use super::{box_param, count_of, has_kind, kind, manifest, moved_by, of_kind};

/// The document frame at 60 fps: the tick's step, and the cache's frame.
const FRAME: i64 = 11_760_000;

fn as_i64(v: Option<Val>) -> Option<i64> {
    count_of(&v?)
}

fn register_tick(r: &mut Registrar) {
    r.kind(kind("test", "tick", vec![box_param()]), &[], "rect@1");
    r.array("test.tick.count", "i64", "document", "time", "simulate");
    r.contribution(
        "test.tick.offset",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.carried("checkpoint", "test.tick.state", 64);
    r.operator("step", "simulate", &[], &["test.tick.count"])
        .steps(FRAME)
        .applies(|doc, _, _| has_kind(doc, "test.tick@1"))
        .run(|v| {
            let count = as_i64(v.carried("test.tick.count")).unwrap_or(0) + 1;
            v.note_step(count, 0);
            v.write("test.tick.count", Val::typed(count))
        });
    r.operator(
        "offset",
        "items",
        &["self", "test.tick.count"],
        &["test.tick.offset"],
    )
    .applies(|_, _, item| of_kind(item, "test.tick@1"))
    .run(|v| {
        let count = as_i64(v.array("test.tick.count")?).unwrap_or(0);
        v.write(
            "test.tick.offset",
            moved_by([count.rem_euclid(48) as f64, 0.0, 0.0]),
        )
    });
}

/// `test.tick` 1.0.0: steps at 60 Hz counting its steps, carried from the last step and
/// checkpointed every 0.5 s, and moves its items by `[count mod 48, 0]` u, so each step
/// changes the frame.
pub fn tick() -> Module {
    Module {
        manifest: manifest("test.tick", &[]),
        register: register_tick,
    }
}

fn register_cache(r: &mut Registrar) {
    r.kind(kind("test", "cache", vec![box_param()]), &[], "rect@1");
    r.contribution(
        "test.cache.offset",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.carried("tail", "test.cache.memo", 65_536);
    r.operator("offset", "items", &["self", "t"], &["test.cache.offset"])
        .applies(|_, _, item| of_kind(item, "test.cache@1"))
        .run(cache_offset);
}

/// The item moves by `[⌊(t mod Δ) ÷ 490,000⌋, 0]` u, computed from the exact t the first time
/// the frame number ⌊t ÷ Δ⌋ is seen in the session and answered from the memo whenever that
/// frame number was seen before: the cache keyed by frame number.
fn cache_offset(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let frame = t.div_euclid(FRAME).to_string();
    let mut memo: BTreeMap<String, f64> = v
        .tail("test.cache.memo")
        .and_then(|m| m.as_typed::<BTreeMap<String, f64>>())
        .map(|m| (*m).clone())
        .unwrap_or_default();
    let dx = match memo.get(&frame) {
        Some(dx) => *dx,
        None => {
            let dx = (t.rem_euclid(FRAME) / 490_000) as f64;
            memo.insert(frame, dx);
            v.set_tail("test.cache.memo", Val::typed(memo))?;
            dx
        }
    };
    v.write("test.cache.offset", moved_by([dx, 0.0, 0.0]))
}

/// `test.cache` 1.0.0: its items move with the exact time inside the document frame, from a
/// memo keyed by frame number.
pub fn cache() -> Module {
    Module {
        manifest: manifest("test.cache", &[]),
        register: register_cache,
    }
}
