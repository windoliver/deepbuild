//! `scene.scale` (#1938; canvas primitives: Check input: loop kinds): each item of a sized kind
//! measured on its evaluated geometry against the real-world range its size names, within
//! `tolerance`, its fix the nearest end of the range as a patch op.

use deep_canvas::registry::{Raised, Report};
use deep_canvas_scene3d::scene::Scene;
use serde_json::{json, Value};

use crate::scene::{self, blocked};

pub const KIND: &str = "scene.scale";
pub const CODE: &str = "loop.scale";

/// studio@1's sizes (Studio pack: `sizes`): the height range of each size, in m.
const SIZES: [(&str, [f64; 2]); 1] = [("door", [1.9, 2.4])];

/// The size an item is measured against: a door opening's.
fn sized(item: &Value) -> Option<(&'static str, [f64; 2])> {
    let door = item.get("kind").and_then(Value::as_str) == Some("arch.opening@1")
        && item.pointer("/params/type").is_none_or(|t| t == "door");
    door.then_some(SIZES[0])
}

/// `id`'s height in `scene`: the vertical extent of everything it draws.
fn height(scene: &Scene, id: &str) -> Result<f64, Value> {
    let (lo, hi) = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| scene::is_of(&s.id, id))
        .flat_map(|s| s.points())
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p[1]), hi.max(p[1]))
        });
    if lo.is_finite() && hi.is_finite() {
        Ok(hi - lo)
    } else {
        Err(blocked("not_drawn", KIND, &[id.to_string()], &format!("items/{id}")))
    }
}

pub fn report(lowered: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    // A size reads no camera.
    let lowered = &scene::camera_free(lowered);
    // A brief may only tighten the design's ratio.
    let tol = crate::number(input, "/tolerance", 2.0).clamp(1.0, 2.0);
    let sized: Vec<(&String, &'static str, [f64; 2])> = lowered
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| sized(item).map(|(n, r)| (id, n, r)))
        .collect();
    if sized.is_empty() {
        return out;
    }
    let times = match scene::times(input, KIND) {
        Ok(t) => t,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    let in_band = |h: f64, [lo, hi]: [f64; 2]| h >= lo / tol && h <= hi * tol;
    let mut failed: Vec<&String> = Vec::new();
    for &t in &times {
        let scene = match scene::evaluate(lowered, input, t, KIND) {
            Ok(s) => s,
            Err(b) => {
                out.blocked.push(b);
                return out;
            }
        };
        for &(id, name, range) in &sized {
            let measured = match height(&scene, id) {
                Ok(h) => h,
                Err(b) => {
                    out.blocked.push(b);
                    continue;
                }
            };
            let ok = in_band(measured, range);
            out.results.push(json!({
                "item": id, "size": name, "t": t, "measured": measured, "range": range,
                "tolerance": tol, "pass": ok,
            }));
            if ok || failed.contains(&id) {
                continue;
            }
            failed.push(id);
            let [lo, hi] = range;
            let nearest = if measured > hi * tol { hi } else { lo };
            let path = format!("items/{id}/params/height");
            // The fix is named as ops only when the item measures in range with it applied.
            let fixed = scene::with_set(lowered, &path, json!(nearest));
            let cures = scene::evaluate(&fixed, input, t, KIND)
                .and_then(|s| height(&s, id))
                .is_ok_and(|h| in_band(h, range));
            let fix_ops = cures
                .then(|| vec![json!({"op": "set", "id": id, "path": path, "value": nearest})]);
            let raised = Raised {
                code: CODE,
                severity: "error",
                path: path.clone(),
                what: format!(
                    "the {name} is {measured:.2} m tall and a {name} is {lo} to {hi} m: set its height to {nearest} m"
                ),
                fix_ops,
            };
            let actual = json!({"size": name, "t": t, "measured": measured, "range": range,
                                "tolerance": tol, "nearest": nearest});
            out.raised.push((id.clone(), raised, actual));
        }
    }
    out
}
