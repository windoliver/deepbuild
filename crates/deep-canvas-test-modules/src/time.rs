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

/// The step `test.held@1` sets: its first item's `step_rate`, which the check holds to a
/// whole-flick step.
fn held_step(doc: &serde_json::Value) -> Option<i64> {
    let items = doc.get("items")?.as_object()?;
    let item = items.values().find(|i| of_kind(i, "test.held@1"))?;
    let hz = item.get("params")?.get("step_rate")?.as_f64()?;
    deep_canvas::time::step_length(hz).ok()
}

fn register_held(r: &mut Registrar) {
    let rate = deep_canvas::kinds::Param {
        name: "step_rate",
        ty: deep_canvas::kinds::ParamType::F32,
        unit: "Hz",
        default: serde_json::json!(60),
        min: Some(1.0),
        max: Some(705_600_000.0),
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(kind("test", "held", vec![box_param(), rate]), &[], "rect@1");
    r.array("test.held.index", "i64", "document", "time", "simulate");
    r.carried("checkpoint", "test.held.state", 64);
    r.operator("step", "simulate", &[], &["test.held.index"])
        .steps_at(FRAME, held_step)
        .applies(|doc, _, _| has_kind(doc, "test.held@1"))
        .run(|v| {
            let index = as_i64(v.carried("test.held.index")).map_or(0, |k| k + 1);
            v.note_step(index, 0);
            v.write("test.held.index", Val::typed(index))
        });
}

/// `test.held` 1.0.0 (the #497 acceptance README): steps at its item's `step_rate`, writing
/// each step's index k into the held array `test.held.index`, checkpointed as `test.tick`.
pub fn held() -> Module {
    Module {
        manifest: manifest("test.held", &[]),
        register: register_held,
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

/// The control `watch` names: its value at `time` on the document's input track, its last entry
/// at or before then, else its default.
fn control_at(doc: &serde_json::Value, watch: &str, time: i64) -> serde_json::Value {
    let entry = (doc["track"].as_array().into_iter().flatten())
        .rfind(|e| e["control"] == watch && e["t"].as_i64().is_some_and(|t| t <= time));
    entry.map_or_else(
        || doc["controls"][watch]["default"].clone(),
        |e| e["value"].clone(),
    )
}

fn register_latch(r: &mut Registrar) {
    let watch = deep_canvas::kinds::Param {
        name: "watch",
        ty: deep_canvas::kinds::ParamType::Str,
        unit: "",
        default: serde_json::json!(""),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(
        kind("test", "latch", vec![box_param(), watch]),
        &[],
        "rect@1",
    );
    r.array("test.latch.seen", "i64", "document", "time", "simulate");
    r.contribution(
        "test.latch.offset",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.carried("checkpoint", "test.latch.state", 64);
    r.operator("step", "simulate", &["refs"], &["test.latch.seen"])
        .steps(FRAME)
        .applies(|doc, _, _| has_kind(doc, "test.latch@1"))
        .run(|v| {
            let mut seen = as_i64(v.carried("test.latch.seen")).unwrap_or(0);
            if seen == 0 {
                let doc = v.document()?;
                let time = v.t()?;
                let items = doc["items"].as_object().into_iter().flatten();
                for (_, item) in items.filter(|(_, i)| of_kind(i, "test.latch@1")) {
                    let watch = item["params"]["watch"].as_str().unwrap_or_default();
                    let default = &doc["controls"][watch]["default"];
                    if control_at(doc, watch, time) != *default {
                        seen = 1;
                    }
                }
            }
            v.note_step(seen, 0);
            v.write("test.latch.seen", Val::typed(seen))
        });
    r.operator(
        "offset",
        "items",
        &["self", "test.latch.seen"],
        &["test.latch.offset"],
    )
    .applies(|_, _, item| of_kind(item, "test.latch@1"))
    .run(|v| {
        let seen = as_i64(v.array("test.latch.seen")?).unwrap_or(0);
        v.write(
            "test.latch.offset",
            moved_by([120.0 * seen as f64, 0.0, 0.0]),
        )
    });
}

/// `test.latch` 1.0.0 (the #169 acceptance README): steps at 60 Hz, holding in its checkpointed
/// carried state whether the control its item watches has ever left its default, never set
/// back, and moves its items 120 u right once it has: two plays that draw alike can carry
/// different state.
pub fn latch() -> Module {
    Module {
        manifest: manifest("test.latch", &[]),
        register: register_latch,
    }
}
