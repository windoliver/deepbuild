//! #182: the character body's planted programs (tests/acceptance/182/README.md: wrong programs),
//! each a wrong character controller, checkpoint or kit the criteria are seen to catch: one that
//! climbs under 45° whatever the body's slope limit; a checkpoint that leaves out each
//! character's vertical speed; a kit that passes a fixture its caps exclude; a character stepped
//! as a plain kinematic body; a place that keeps the vertical speed; a ceiling that keeps the
//! upward speed; a crouch that stands on release; and a corner whose walls are resolved one at a
//! time.

use std::collections::BTreeMap;

use super::{shape_use, Run};
use crate::{Rapier, Twin};
use deep_canvas_physics::backend::{Backend, CharacterState};
use deep_canvas_physics::doc::{Read, World};
use deep_canvas_physics::kit::Planted;
use serde_json::{json, Value};

/// The planted programs this file runs.
pub const PLANTED: [&str; 8] = [
    "slope_limit_ignored",
    "checkpoint_drops_vertical",
    "kit_passes_excluded",
    "character_as_kinematic",
    "place_keeps_vertical",
    "ceiling_keeps_upward",
    "crouch_stands_on_release",
    "corner_one_wall_at_a_time",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    run.twin = match name {
        "kit_passes_excluded" => {
            run.kit_planted = Planted::CountsExcludedPassed;
            return true;
        }
        "slope_limit_ignored" => Twin::SlopeIgnored,
        "checkpoint_drops_vertical" => Twin::CheckpointWithoutVertical,
        "character_as_kinematic" => Twin::PlainKinematic,
        "place_keeps_vertical" => Twin::PlaceKeepsVertical,
        "ceiling_keeps_upward" => Twin::KeepsUpward,
        "crouch_stands_on_release" => Twin::StandsOnRelease,
        "corner_one_wall_at_a_time" => Twin::EachWallAlone,
        _ => return false,
    };
    true
}

/// Each character output's reading after a step into `readings`: grounded, sliding or crouched,
/// 0 or 1; and the character bodies' states.
pub(super) fn readings(
    b: &Rapier,
    w: &World,
    readings: &mut BTreeMap<String, (bool, Vec<[f64; 2]>)>,
) -> Vec<CharacterState> {
    let walkers = b.characters();
    for (id, o) in w.outputs.iter().filter(|(_, o)| o.read.of_character()) {
        if let Some(c) = walkers.iter().find(|x| x.id == o.from) {
            let on = match o.read {
                Read::Grounded => c.grounded,
                Read::Sliding => c.sliding,
                _ => c.crouched,
            };
            let e = readings.entry(id.clone()).or_insert((false, Vec::new()));
            e.1.push([f64::from(u8::from(on)), 0.0]);
        }
    }
    walkers
}

/// Body `id`'s state as a reply holds it, with its own state when it is a character body, each
/// shape use it touches named.
pub(super) fn with_character(
    mut state: Value,
    id: &str,
    walkers: &[CharacterState],
    w: &World,
) -> Value {
    if let Some(c) = walkers.iter().find(|c| c.id == id) {
        let touching: Vec<Value> = c.touching.iter().map(|r| shape_use(w, r)).collect();
        state["character"] = json!({"wants": c.wants, "vertical": c.vertical, "grounded": c.grounded,
                                    "sliding": c.sliding, "crouched": c.crouched, "touching": touching});
    }
    state
}
