//! #3033: a water's wave table in `view3d` (tests/acceptance/3033/README.md: Surface choices):
//! `receipt.water`, and the three planted seas.

use std::sync::Arc;

use deep_canvas_scene3d::scene::Scene;
use deep_canvas_scene3d::water::SEA_DRAWN;
use serde_json::{json, Value};

use crate::Planted;

/// `receipt.water`: the view's water by its material, and one row for each wave it sums: a
/// sea's table, longest first, or a list's or a wind's waves, which start at phase 0 and all
/// move the vertices.
pub(crate) fn table(scene: &Scene) -> Option<Value> {
    let w = scene.water.as_ref()?;
    let row = |wave: &deep_canvas_scene3d::water::Wave,
               direction: f64,
               phase: f64,
               speed: f64,
               vertex: bool| {
        json!({"direction": direction, "length": wave.length, "amplitude": wave.amplitude,
            "phase": phase, "speed": speed, "vertex": vertex})
    };
    let waves: Vec<Value> = match &w.sea {
        Some(sea) => (sea.rows.iter().enumerate())
            .map(|(i, r)| row(&r.wave, r.direction, r.phase, r.speed, i < SEA_DRAWN))
            .collect(),
        None => (w.waves.iter())
            .map(|v| {
                row(
                    v,
                    v.dir[0].atan2(v.dir[1]).to_degrees(),
                    0.0,
                    v.speed(),
                    true,
                )
            })
            .collect(),
    };
    Some(json!({"material": w.material, "waves": waves}))
}

/// The planted seas (README: Planted programs), each on the table as the check made it, before
/// the receipt lists it and before anything draws from it: every amplitude halved, every row at
/// the longest wave's speed, or only the four longest rows kept.
pub(crate) fn plant(scene: &mut Scene, planted: Option<Planted>) {
    use Planted::{
        WaterSeaAmplitudesHalved as Halved, WaterSeaDrawsFourLongest as Four,
        WaterSeaSpeedOfLongest as OneSpeed,
    };
    let Some(p @ (Halved | Four | OneSpeed)) = planted else {
        return;
    };
    let Some(sea) = (scene.water.as_mut()).and_then(|w| Arc::make_mut(w).sea.as_mut()) else {
        return;
    };
    let fastest = sea.rows.first().map_or(0.0, |r| r.speed);
    match p {
        Halved => sea.rows.iter_mut().for_each(|r| r.wave.amplitude *= 0.5),
        OneSpeed => sea.rows.iter_mut().for_each(|r| r.speed = fastest),
        _ => sea.rows.truncate(4),
    }
}
