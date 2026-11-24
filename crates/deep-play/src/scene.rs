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
    // #231: a document that has the frame's size already, and whose worlds write nothing into
    // it, is read as it stands: an export evaluates it at every frame.
    let as_is = doc.get("size") == Some(&json!(size));
    #[cfg(feature = "physics")]
    let as_is = as_is && !deep_canvas_physics::written::writes(doc);
    let written;
    let doc = if as_is {
        doc
    } else {
        let mut doc = doc.clone();
        if let Some(d) = doc.as_object_mut() {
            d.insert("size".into(), json!(size));
        }
        #[cfg(feature = "physics")]
        deep_canvas_physics::skin::write(&mut doc, t);
        // #2248: and each readout a world's output writes shows that output's value at `t`.
        #[cfg(feature = "physics")]
        deep_canvas_physics::written::readouts(&mut doc, t);
        written = doc;
        &written
    };
    let look = look_of(doc, palette);
    let scene = evaluate_any(doc, t, &look, labels, Some(assets), fills)?;
    Ok((scene, look))
}

#[cfg(all(test, feature = "physics"))]
mod tests {
    use super::*;

    /// #2248: a readout a world's output writes draws what that output writes at the frame's
    /// time, through its template's `{value}` slot.
    #[test]
    fn a_readout_draws_what_its_output_writes_at_the_frames_time() {
        let step = |k: u64, y: f64| json!({"step": k, "changed": [[0, 1]], "values": [[0, [[0.0, y, 0.0]]]]});
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64], "camera": "cam",
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "worlds": {"rig": {"outputs": {"fall": {"from": "ball", "read": "velocity", "to": "vy"}}}},
            "arrays": {"rig.fall.value": {"type": "vec3", "count": 1, "every": 11_760_000, "linear": false,
                                          "hold": false, "steps": [step(0, 0.0), step(1, -0.5)]}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 20], "fov": 40}},
                "vy": {"id": "vy", "kind": "overlay.text@1", "layer": "main", "name": "vy", "order": "a1",
                    "params": {"anchor": "corner", "role": "readout", "template": "{value/1} m/s"}}}});
        let shown = |t: i64| {
            let (palette, mut labels) = (Palette::new(), Labels::new());
            let none: Assets<'_> = &|_| None;
            let scene = evaluate(
                &doc,
                t,
                &palette,
                [64, 64],
                &mut labels,
                none,
                Fills::default(),
            );
            let (scene, _) = scene.expect("the scene evaluates");
            scene.readouts[0].text.clone()
        };
        assert_eq!(shown(0), "0 m/s");
        assert_eq!(shown(11_760_000), "-0.5 m/s");
    }
}
