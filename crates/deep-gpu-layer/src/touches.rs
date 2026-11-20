//! #2760: the rings a water's touches start, in `view3d` (tests/acceptance/2760/README.md: The
//! surface under test): each captured frame's `rings` rows, the check's refusal as its issues,
//! and the two planted programs.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas_scene3d::contributed::Memo;
use deep_canvas_scene3d::scene::Scene;
use serde_json::{json, Value};

use crate::Planted;

const FLICKS: f64 = crate::view3d::FLICKS_PER_SECOND as f64;

/// A frame's `rings`: the rain's rings alive on each water part (#166), then each ring an
/// occurrence started that is alive at the frame's t, as the renderer draws it.
pub(crate) fn rows(scene: &Scene) -> Vec<Value> {
    let Some(w) = scene.water.as_ref() else {
        return Vec::new();
    };
    let rain = w.rings().into_iter().map(
        |r| json!({"part": r.part, "drop": r.drop, "at": r.at, "born": r.born, "radius": r.radius}),
    );
    let touched = w.rings.iter().flat_map(|r| {
        r.alive().map(move |(c, age)| {
            json!({"part": c.part, "occurrence": c.occurrence, "at": c.at,
                "born": c.born as f64 / FLICKS, "radius": r.speed * age})
        })
    });
    rain.chain(touched).collect()
}

/// A frame's refusal as the check's, `{code: "refused", issues}`, where the evaluation left the
/// issue it names in the host's memo; any other refusal as it is.
pub(crate) fn refusal(refused: Value, memo: Option<&RefCell<Memo>>) -> Value {
    match memo.and_then(|m| m.borrow_mut().take_refused()) {
        Some(issue) => json!({"code": "refused", "issues": [issue]}),
        None => refused,
    }
}

/// What the planted `water_rings_start_on_drawn_frame` keeps from frame to frame: the last
/// flick drawn, the occurrences a drawn frame has passed and those whose rings it started.
#[derive(Default)]
pub(crate) struct Started {
    last: Option<i64>,
    passed: BTreeSet<usize>,
    kept: BTreeSet<usize>,
}

/// The planted rings (README: Planted programs). `water_rings_at_rain_hash` centres each ring
/// where the rain's hash puts a drop. `water_rings_start_on_drawn_frame` starts a ring when a
/// drawn frame first passes its occurrence and keeps it as session state, so a session that
/// drew past an occurrence and seeks back draws no ring for it.
pub(crate) fn plant(scene: &mut Scene, planted: Option<Planted>, t: i64, started: &mut Started) {
    let Some(w) = scene.water.as_mut().filter(|w| w.rings.is_some()) else {
        return;
    };
    match planted {
        Some(Planted::WaterRingsAtRainHash) => Arc::make_mut(w).plant_rings_at_rain_hash(),
        Some(Planted::WaterRingsStartOnDrawnFrame) => {
            let last = started.last.replace(t);
            if let Some(rings) = &mut Arc::make_mut(w).rings {
                rings.touches.retain(|c| {
                    let first = c.born <= t && started.passed.insert(c.occurrence);
                    if first && last.is_some_and(|l| l < c.born) {
                        started.kept.insert(c.occurrence);
                    }
                    c.born > t || started.kept.contains(&c.occurrence)
                });
            }
        }
        _ => {}
    }
}
