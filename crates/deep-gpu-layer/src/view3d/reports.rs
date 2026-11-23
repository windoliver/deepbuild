//! The frame's light clusters, level-of-detail masks and shadow maps as its report lists them
//! (#2360: moved out of `run_view` whole).

use deep_canvas_scene3d::lod::Choice;

use super::*;
use crate::session3::Drawn;

/// Names in `frame` the light clusters, blend masks, cascades and local shadow maps a frame's call
/// asks for, as `run_view` does for each frame it draws.
#[allow(clippy::too_many_arguments)]
pub(super) fn light_reports(
    frame: &mut Map<String, Value>,
    app: &mut App,
    out: &str,
    args: &Args,
    drawn: &Drawn,
    choices: &[Choice],
    capture: bool,
    noop: bool,
) -> Result<(), Value> {
    if args.clusters && capture {
        let rows: Vec<Value> = session3::clusters(app)
            .into_iter()
            .map(|(cluster, lights)| {
                let lights: Vec<Value> = lights
                    .into_iter()
                    .map(|(light, weight)| json!({"light": light, "weight": weight}))
                    .collect();
                json!({"cluster": cluster, "lights": lights})
            })
            .collect();
        frame.insert("clusters".into(), json!(rows));
    }
    if args.masks && capture && !noop {
        let mut rows = Vec::new();
        for c in choices.iter().filter(|c| c.bands.len() == 2) {
            let (Some(level), Some(&(_, key))) =
                (c.blend, drawn.picks.iter().find(|(id, _)| *id == c.item))
            else {
                continue;
            };
            for (pass, size, bytes) in session3::masks(app, key, level) {
                let file = write_named(out, &bytes, "u8")?;
                rows.push(json!({"item": c.item, "pass": pass, "size": size, "file": file}));
            }
        }
        frame.insert("masks".into(), json!(rows));
    }
    if args.cascades {
        // Each shadow map the key sun draws: its key, which holds the planes that cut its
        // casters, and its texel in m (#424).
        let maps: Vec<Value> = drawn
            .counts
            .shadow_maps
            .iter()
            .enumerate()
            .map(|(i, (key, texel, clip))| {
                let drawn = drawn.counts.cascades_drawn.contains(&(i as u32));
                json!({"key": format!("{key:016x}"), "texel_m": texel, "clip": clip, "drawn": drawn})
            })
            .collect();
        frame.insert(
            "cascades".into(),
            json!({"splits": drawn.counts.cascade_splits, "maps": maps}),
        );
    }
    if args.shadows {
        let counts = &drawn.counts;
        let mut passes = counts.cascades_drawn.len() as u32;
        let maps: Vec<Value> = counts
            .local_maps
            .iter()
            .map(|m| {
                passes += if m.drawn { m.faces } else { 0 };
                let kind = match m.faces {
                    1 => "spot",
                    5 => "area",
                    _ => "point",
                };
                json!({"light": m.light, "kind": kind, "key": format!("{:016x}", m.key), "drawn": m.drawn})
            })
            .collect();
        frame.insert("shadows".into(), json!({"passes": passes, "maps": maps}));
    }
    Ok(())
}
