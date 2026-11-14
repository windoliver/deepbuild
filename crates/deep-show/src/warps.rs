//! #223: what an item under a group's warp draws at a frame, for `path` at t and for `eval`'s
//! evaluated-data hash: the frame's items as the marks read them (each one's fields at its world
//! transform, a warp's `time` vars already bound by marks2d's `warp` operator), and the item's
//! outline through the scene's own build, so the reply is the outline the frame draws.

use deep_canvas::schedule::core_ops::{Fields, Transform};
use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_marks::scene;
use serde_json::{Map, Value};

/// Whether the item `id` of `doc` sits under a group with a warp.
pub(crate) fn under_warp(doc: &Value, id: &str) -> bool {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return false;
    };
    let mut at = items
        .get(id)
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str);
    for _ in 0..items.len() {
        let Some(p) = at else { return false };
        let Some(group) = items.get(p) else {
            return false;
        };
        if group.pointer("/params/warp").is_some_and(|w| !w.is_null()) {
            return true;
        }
        at = group.get("parent").and_then(Value::as_str);
    }
    false
}

/// The frame's items as the marks read them, with each warp's vars that read time bound.
pub(crate) fn items_at(sched: &Scheduler<'_>, s: &DocSession) -> Option<Map<String, Value>> {
    let doc = s.document()?.get("items")?.as_object()?;
    let mut items = Map::new();
    for id in doc.keys() {
        let Some(fields) = s
            .read(sched, "core.fields", Some(id))
            .and_then(|(v, _)| v.as_typed::<Fields>())
        else {
            continue;
        };
        let world = s
            .read(sched, "core.world", Some(id))
            .and_then(|(v, _)| v.as_typed::<Transform>());
        items.insert(
            id.clone(),
            deep_canvas_marks::modules::item_json(&fields, world.as_deref()),
        );
    }
    Some(items)
}

/// The scene's planted twin a scenario's `planted` names, if it is one of #223's.
pub(crate) fn planted(name: Option<&str>) -> scene::Planted {
    match name {
        Some(deep_canvas_marks::warp::FLOW_BY_KIND) => scene::Planted::WarpFlowByKind,
        _ => scene::Planted::None,
    }
}

/// The outline item `id` draws among `items`, each sub-path flattened to its points: `Ok(None)`
/// for an item with no outline, `Err` with the scene's refusal (its code and path).
pub(crate) fn drawn(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    id: &str,
    planted: scene::Planted,
) -> Result<Option<Vec<Vec<[f64; 2]>>>, scene::Refused> {
    let palette = scene::Palette::new();
    let Some(report) =
        scene::path_report(doc, items, (&palette, &scene::Type::default()), id, planted)?
    else {
        return Ok(None);
    };
    let tolerance = deep_canvas_marks::path::tolerance(0);
    Ok(Some(
        report
            .placed
            .iter()
            .flat_map(|v| deep_canvas_marks::path::flatten(v, tolerance))
            .map(|l| l.points)
            .collect(),
    ))
}
