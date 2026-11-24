//! #226's readings of 3D axes in `view3d`: each `axes3d@1` item's ticks as a frame draws them
//! (each value and opacity through the data module's own rule, where it meets its axis and its
//! label's corners as the vertex stage faces them, in world metres), its titles (#2450), and the
//! vertices items are drawn with, in the world.

use std::collections::BTreeMap;

use deep_canvas_marks::axes3d::Title;
use deep_canvas_scene3d::scene::{label_axes, quad_axes, Label, Scene};
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
        // #1634: scene3d cuts an automatic range at a fixed 0.05 lx.
        Planted::AutoRangeFixedCut => Some("auto_range_fixed_cut"),
        // #298: scene3d places a clamped overlay and its leader wrongly.
        Planted::ClampEachAxis => Some("clamp_each_axis"),
        Planted::ClampUnmirroredBehind => Some("clamp_unmirrored_behind"),
        Planted::ClampToFrame => Some("clamp_to_frame"),
        Planted::LeaderDrawsWhileClamped => Some("leader_draws_while_clamped"),
        // #3036: scene3d keeps a plate's surface from the frame before.
        Planted::TracksKeepLastFrame => Some(deep_canvas_scene3d::tracks::KEEPS_LAST_FRAME),
        _ => None,
    }
}

type Affine = [[f64; 4]; 3];

fn at(m: &Affine, p: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

/// A label's text box or an image's quad in the world, `size` about its centre `pos` along its
/// axes `[r, u]`, as the vertex stage places it, facing applied: bottom-left (where its text
/// starts), bottom-right, top-right, top-left.
fn quad(pos: [f64; 3], size: [f64; 2], [r, u]: [[f64; 3]; 2]) -> [[f64; 3]; 4] {
    let (w, h) = (size[0] / 2.0, size[1] / 2.0);
    let corner = |x: f64, y: f64| [0, 1, 2].map(|k| pos[k] + r[k] * x + u[k] * y);
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
    let boxed = |l: &Label| quad(l.pos, l.quad, label_axes(l, &scene.camera));
    let mut rows = Vec::new();
    for (id, item, world) in &placed {
        if item.get("kind").and_then(Value::as_str) != Some(deep_canvas_marks::axes3d::KIND) {
            continue;
        }
        let axes = deep_canvas_marks::axes3d::read(id, item, &|k| items.get(k), channels, planted)
            .map_err(|r| refused(r.code, r.path))?;
        let mut ticks = Vec::new();
        for (name, shown) in ["x", "y", "z"].into_iter().zip(axes.shown(planted)) {
            for tick in shown {
                let label = labels
                    .get(format!("{id}#{name}.label{}", tick.k).as_str())
                    .map(|l| json!({"text": l.text, "quad": boxed(l)}));
                ticks.push(
                    json!({"axis": name, "value": tick.value, "opacity": tick.opacity,
                                  "at": at(world, tick.at), "label": label}),
                );
            }
        }
        // #2450: each title the frame draws, a text's box or a vector item's quad.
        let mut titles = Vec::new();
        for (name, title) in ["x", "y", "z"].into_iter().zip(&axes.titles) {
            let sub = format!("{id}#{name}.title");
            let mut images = scene.layers.iter().flat_map(|l| &l.images);
            let image = images.find(|i| i.id == sub);
            titles.extend(match (title, labels.get(sub.as_str()), image) {
                (Some(Title::Text(text)), Some(l), _) => {
                    Some(json!({"axis": name, "text": text, "quad": boxed(l)}))
                }
                (Some(Title::Vector(item, _)), _, Some(i)) => {
                    let turned = quad_axes(i.facing, i.axes, &scene.camera);
                    Some(json!({"axis": name, "vector": item, "quad": quad(i.pos, i.size, turned)}))
                }
                _ => None,
            });
        }
        rows.push(json!({"item": id, "ticks": ticks, "titles": titles}));
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
