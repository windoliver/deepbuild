//! The flicker check's reseed rule on a film's group passes (#161; Pack: fx@1 named operators):
//! an operator that draws anew at each step of quantized time, such as `fx.slice_shift@1`, takes
//! its drawing from the seed and the step's index, never from playback. So two frames that hold
//! the same marks inside one step of such a pass draw the same picture; where they don't, the
//! pass reseeded with the frame, and the check fails naming its operator.

use std::sync::Arc;

use deep_canvas_effects::fx::Named;
use deep_canvas_effects::module::pass_graph;
use deep_canvas_marks::scene::{Drawn, Scope};
use serde_json::{json, Value};

/// One frame as the rule reads it: its writer layers' marks and its time in flicks.
pub(crate) type Seen = (Vec<Vec<Arc<Drawn>>>, i64);

/// The operators `layers`' group passes name that draw by steps of time, each with its step in
/// flicks: a param whose unit is `flick`, as the pass gives it or as the operator defaults it.
fn stepped(layers: &[Vec<Arc<Drawn>>], packs: &[Named]) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let scopes = layers.iter().flatten().flat_map(|d| &d.scopes);
    for s in scopes {
        let Scope::Opacity {
            effect: Some(e), ..
        } = s
        else {
            continue;
        };
        for p in &e.passes {
            let Ok(graph) = pass_graph(&p.op, p.item.as_ref(), &p.params, packs) else {
                continue;
            };
            let inputs = graph.stages.iter().filter_map(|g| g["inputs"].as_object());
            for input in inputs.flatten().map(|(_, i)| i) {
                let Some(name) = input["from"]["param"].as_str() else {
                    continue;
                };
                let step = p.params.get(name).unwrap_or(&input["default"]).as_f64();
                let step = step.filter(|s| input["unit"] == "flick" && *s >= 1.0);
                if let Some(step) = step {
                    if !out.iter().any(|(op, _)| *op == p.op) {
                        out.push((p.op.clone(), step as i64));
                    }
                }
            }
        }
    }
    out
}

/// Each operator that reseeded with the frame, with the first frame it did at: a frame that
/// holds the marks of the one before it, inside the same step of the operator's pass, whose
/// picture's luminance differs from that frame's.
pub(crate) fn reseeded(frames: &[Seen], lumas: &[Vec<f32>], packs: &[Named]) -> Vec<Value> {
    let mut found: Vec<Value> = Vec::new();
    for k in 1..frames.len().min(lumas.len()) {
        let ((marks, t), (before, t0)) = (&frames[k], &frames[k - 1]);
        if marks != before || lumas[k] == lumas[k - 1] {
            continue;
        }
        for (op, step) in stepped(marks, packs) {
            let named = found.iter().any(|f| f["op"] == op.as_str());
            if !named && t.div_euclid(step) == t0.div_euclid(step) {
                found.push(json!({"op": op, "frame": k}));
            }
        }
    }
    found
}
