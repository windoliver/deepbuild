//! #226's readings of 3D axes in `view3d`: each `axes3d@1` item's ticks as a frame draws them
//! (each value and opacity through the data module's own rule, where it meets its axis and its
//! label's corners as the vertex stage faces them, in world metres), and the vertices items are
//! drawn with, in the world.

use std::collections::BTreeMap;

use deep_canvas_scene3d::scene::{label_axes, Label, Scene};
use serde_json::{json, Map, Value};

use crate::{refused, Planted};

/// The data module's wrong program `planted` is, if it is one; the host plants the third
/// (`axes_mod_maps_every_frame`) itself, by keeping nothing between frames.
pub(crate) fn plant_name(planted: Option<Planted>) -> Option<&'static str> {
    match planted? {
        Planted::AxesModAppliesTransform => Some("axes_mod_applies_transform"),
        Planted::Axes3dOwnTickRule => Some("axes3d_own_tick_rule"),
        // #506: scene3d draws an eye inset's centred twin.
        Planted::EyeInsetCentredFrustum => Some("eye_inset_centred_frustum"),
        _ => None,
    }
}

type Affine = [[f64; 4]; 3];

fn at(m: &Affine, p: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

/// A label's text box in the world, as the vertex stage places it about its centre, facing
/// applied: bottom-left (where its text starts), bottom-right, top-right, top-left.
fn quad(l: &Label, scene: &Scene) -> [[f64; 3]; 4] {
    let [r, u] = label_axes(l, &scene.camera);
    let (w, h) = (l.quad[0] / 2.0, l.quad[1] / 2.0);
    let corner = |x: f64, y: f64| [0, 1, 2].map(|k| l.pos[k] + r[k] * x + u[k] * y);
    [corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)]
}

/// Each `axes3d@1` item of `doc` at `t`: the ticks this frame draws on each axis.
pub(crate) fn report(
    scene: &Scene,
    doc: &Value,
    t: i64,
    planted: Option<&str>,
) -> Result<Value, Value> {
    let placed =
        deep_canvas_scene3d::scene::placed_at(doc, t).map_err(|r| refused(r.code, r.path))?;
    let items: Map<String, Value> = placed
        .iter()
        .map(|(id, v, _)| (id.clone(), v.clone()))
        .collect();
    let labels: BTreeMap<&str, &Label> = scene
        .layers
        .iter()
        .flat_map(|l| &l.labels)
        .map(|l| (l.id.as_str(), l))
        .collect();
    let channels = doc.get("channels");
    let mut rows = Vec::new();
    for (id, item, world) in &placed {
        if item.get("kind").and_then(Value::as_str) != Some(deep_canvas_marks::axes3d::KIND) {
            continue;
        }
        let axes = deep_canvas_marks::axes3d::read(id, item, &|k| items.get(k), channels)
            .map_err(|r| refused(r.code, r.path))?;
        let mut ticks = Vec::new();
        for (name, shown) in ["x", "y", "z"].into_iter().zip(axes.shown(planted)) {
            for tick in shown {
                let label = labels
                    .get(format!("{id}#{name}.label{}", tick.k).as_str())
                    .map(|l| json!({"text": l.text, "quad": quad(l, scene)}));
                ticks.push(
                    json!({"axis": name, "value": tick.value, "opacity": tick.opacity,
                                  "at": at(world, tick.at), "label": label}),
                );
            }
        }
        rows.push(json!({"item": id, "ticks": ticks}));
    }
    Ok(Value::Array(rows))
}

/// Each of `ids`' vertices as this frame draws them, in world metres: a built solid's mesh
/// through its model, a point's place, a line's segment ends.
pub(crate) fn world(scene: &Scene, ids: &[String]) -> Value {
    let mut out = Map::new();
    for id in ids {
        let mut vertices: Vec<[f64; 3]> = Vec::new();
        for layer in &scene.layers {
            if let Some(s) = layer.solids.iter().find(|s| &s.id == id) {
                if let Some(mesh) = &s.mesh {
                    vertices.extend(mesh.positions.iter().map(|p| at(&s.model, *p)));
                }
            }
            vertices.extend(layer.points.iter().filter(|p| &p.id == id).map(|p| p.pos));
            for l in layer.lines.iter().filter(|l| &l.id == id) {
                vertices.extend(l.segments.iter().flat_map(|s| [s.a, s.b]));
            }
        }
        out.insert(id.clone(), json!(vertices));
    }
    Value::Object(out)
}
