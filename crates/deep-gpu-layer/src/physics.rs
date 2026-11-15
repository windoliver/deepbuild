//! #1921: a scene's physics worlds in `view3d`. Each world the document lists is baked by the
//! physics module behind the backend interface over the transport's span, in its scene, and each
//! `<body>#*` output's columns go into the document's `arrays`; every frame writes them into its
//! instancers at the frame's time (deep-canvas-physics: written.rs), so hundreds of bodies draw as
//! one instanced draw per prototype and material and a frame uploads only the rows that moved.
//! #524: an output to an item path writes the channels deep_show writes for it (deep-physics-
//! rapier: channels.rs), and a skin's array draws its soft body (deep-canvas-physics: skin.rs).

use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::occurrence::{step_flicks, timed};
use deep_canvas_physics::roles::TABLE;
use deep_canvas_physics::written;
use deep_physics_rapier::runner::Run;
use serde_json::{json, Map, Value};

/// Bakes each world `doc` lists into the arrays its `<body>#*` outputs and skins write and the
/// channels its outputs to item paths write; a world the physics module refuses refuses the call.
pub(crate) fn bake(doc: &mut Value) -> Result<(), Value> {
    let Some(worlds) = doc.get("worlds").and_then(Value::as_object).cloned() else {
        return Ok(());
    };
    let span = doc.pointer("/transport/span").cloned().unwrap_or(json!(0));
    let span = deep_canvas::document::duration(doc, &span)
        .unwrap_or(0)
        .max(0);
    let rate = doc
        .pointer("/transport/frame_rate")
        .cloned()
        .unwrap_or(json!([60, 1]));
    let run = Run::new(None).expect("the unplanted runner");
    let (mut arrays, mut channels) = (Map::new(), Map::new());
    // #449: each world's occurrence list, as the column view reads it, for particles' bursts.
    let mut lists = Map::new();
    for (id, world) in &worlds {
        let w = deep_physics_rapier::bound::expand(Some(doc), world)
            .and_then(|d| check(&d, &RAPIER3D, &TABLE))
            .map_err(|e| {
                let issues: Vec<Value> = e.iter().map(|r| json!({"code": r.code, "path": r.path, "what": r.what})).collect();
                json!({"code": "physics_refused", "reason": format!("worlds/{id}"), "issues": issues})
            })?;
        let step = step_flicks(&w);
        let call = json!({"call": "bake", "scene": doc, "world": id, "steps": (span + step - 1) / step, "frame_rate": rate});
        let reply = run.answer(&call).unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return Err(
                json!({"code": "physics_refused", "reason": format!("worlds/{id}"), "bake": reply}),
            );
        }
        arrays.extend(written::arrays(id, &w, doc, &reply["bodies"]));
        // #524: an output to an item path draws as the channels deep_show writes for it.
        let frame = deep_canvas_physics::bake::frame_rate(&rate).map_or(step, |(_, f)| f);
        let frames: Vec<i64> = (0..)
            .map(|f: i64| f * frame)
            .take_while(|t| *t <= span)
            .collect();
        deep_physics_rapier::channels::output_channels(
            id,
            &w,
            &reply["bodies"],
            &frames,
            false,
            &mut channels,
        )
        .map_err(
            |e| json!({"code": "physics_refused", "reason": format!("worlds/{id}"), "what": e}),
        )?;
        arrays.extend(deep_canvas_physics::skin::arrays(
            id,
            &w,
            &reply["particles"],
        ));
        let rows = reply["occurrences"].as_array().cloned().unwrap_or_default();
        lists.insert(format!("{id}.occurrences"), json!(timed(&rows, &w)));
    }
    if let Some(doc) = doc.as_object_mut() {
        for (key, add) in [
            ("arrays", arrays),
            ("occurrences", lists),
            ("channels", channels),
        ] {
            if let Some(all) = doc.entry(key).or_insert_with(|| json!({})).as_object_mut() {
                all.extend(add);
            }
        }
    }
    Ok(())
}
