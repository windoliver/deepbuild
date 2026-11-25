//! #269: what a 2D call (`layers`, `window2d`, `film2d`) does for a document whose grid images
//! read a piece's logic arrays (tests/acceptance/269/README.md: The surface under test): its
//! logic items run from the call's `assets`, as `view3d`'s do (#537), their arrays baked into the
//! document's `arrays`, so each frame's grid images take their grid as the logic module gives it
//! at the frame's t; and what a film's frame tells of them.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::Planted;

/// `doc`'s logic items run from the call's `assets` (`{sha256: path}`) through the step the last
/// of `frames` (at `fps`) reads, each array they wrote baked into `doc`'s `arrays`; a call without
/// `assets` runs none.
pub(crate) fn bake(
    doc: &mut Map<String, Value>,
    call: &Value,
    (frames, fps): (&[u64], u64),
    planted: Option<Planted>,
) -> Result<(), Value> {
    let Some(assets) = call["assets"].as_object() else {
        return Ok(());
    };
    let assets: BTreeMap<String, PathBuf> = assets
        .iter()
        .filter_map(|(sha, p)| Some((sha.clone(), PathBuf::from(p.as_str()?))))
        .collect();
    let mut whole = Value::Object(std::mem::take(doc));
    let baked = crate::fed::bake(&mut whole, &assets, (frames, fps), planted);
    if let Value::Object(m) = whole {
        *doc = m;
    }
    let arrays = baked?.into_arrays();
    if !arrays.is_empty() {
        let all = doc.entry("arrays").or_insert_with(|| json!({}));
        if let Some(all) = all.as_object_mut() {
            all.extend(arrays);
        }
    }
    Ok(())
}

/// Each grid image of the evaluated `items` takes its grid in `doc`'s `arrays` at `t`.
pub(crate) fn fill(doc: &Map<String, Value>, items: &mut Map<String, Value>, t: i64) {
    if let Some(arrays) = doc.get("arrays") {
        deep_canvas_marks::grid_image::fill(items, arrays, t, None);
    }
}

/// A film frame's report of its grid images: with `counts`, the rows each uploaded
/// (`row_uploads`, every grid image's, `[]` for none); with `timings`, each one's uploads and pass
/// on the GPU (`draw_ms`).
pub(crate) fn report(
    row: &mut Value,
    items: &Map<String, Value>,
    frame: &deep_marks_render::grid_gpu::GridFrame,
    draw_ms: &BTreeMap<String, f64>,
    (counts, timings): (bool, bool),
) {
    let grids = items
        .iter()
        .filter(|(_, i)| deep_canvas_marks::grid_image::is_grid_image(i));
    if counts {
        let rows: Map<String, Value> = grids
            .clone()
            .map(|(id, _)| {
                (
                    id.clone(),
                    json!(frame.rows.get(id).cloned().unwrap_or_default()),
                )
            })
            .collect();
        row["row_uploads"] = Value::Object(rows);
    }
    if timings {
        let ms: Map<String, Value> = grids
            .filter_map(|(id, _)| Some((id.clone(), json!(draw_ms.get(id)?))))
            .collect();
        row["draw_ms"] = Value::Object(ms);
    }
}
