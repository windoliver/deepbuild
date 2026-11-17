//! A 3D document's frame as the app's and the web player's scene3d renderers draw it (#378, #172):
//! the scene evaluated at a time and size, in the look its camera exposes.

use deep_canvas_marks::scene::Palette;
use deep_canvas_scene3d::contributed::Fills;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate_any, Assets, Labels, Refused, Scene};
use serde_json::{json, Value};

/// The look a revision draws in here: the palette's roles, exposed as its camera's `exposure`
/// says, an EV100 (#1938; Camera `camera@1`: lens), else at the unit exposure.
pub fn look_of(doc: &Value, palette: &Palette) -> Look3 {
    let mut look = Look3::from_roles(palette.clone());
    let camera = doc
        .get("camera")
        .and_then(Value::as_str)
        .and_then(|id| doc.get("items")?.get(id));
    // #468: `from_lens` exposes from the lens's aperture, shutter and ISO at the frame rate.
    let rate = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .filter(|(p, q)| *p > 0 && *q > 0)
        .map_or(60.0, |(p, q)| f64::from(p) / f64::from(q));
    let ev = camera
        .and_then(|c| c.get("params")?.as_object())
        .and_then(|p| {
            deep_canvas_scene3d::lens::read(p, "", false)
                .ok()?
                .ev100(rate)
        });
    if let Some(ev) = ev {
        look.exposure = deep_canvas_scene3d::finish::exposure_scale(ev);
    }
    look
}

/// `doc` at `t` on a frame of `size`, its `mesh.asset@1` items read from `assets`: the evaluated
/// scene a draw reads, and the look it draws in (#427).
pub fn evaluate(
    doc: &Value,
    t: i64,
    palette: &Palette,
    size: [u16; 2],
    labels: &mut Labels,
    assets: Assets<'_>,
    fills: Fills<'_>,
) -> Result<(Scene, Look3), Refused> {
    let mut doc = doc.clone();
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
    }
    #[cfg(feature = "physics")]
    deep_canvas_physics::skin::write(&mut doc, t);
    let look = look_of(&doc, palette);
    let scene = evaluate_any(&doc, t, &look, labels, Some(assets), fills)?;
    Ok((scene, look))
}
