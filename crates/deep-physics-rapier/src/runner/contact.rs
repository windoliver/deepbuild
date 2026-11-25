//! #2309: a contact's frequency on the runner, and its planted programs (tests/acceptance/2309):
//! a check that holds `solver.contact_hz` to a quarter of (step rate × substeps), as it holds a
//! joint's spring, not to the sixth a contact settles at; a backend wrapper that holds a contact
//! with a static body at the same frequency as any other, not twice it; and a default that keeps
//! 30 Hz whatever the step. #2241's planted belts (tests/acceptance/2241): a backend wrapper that
//! leaves the contact hook out; one that applies a belt's speed along world +X; and one that
//! takes it along level ground, not in the contact's plane.
//! #2308's (tests/acceptance/2308): a wrapper that never sets the backend's length; one that
//! keeps the backend's own contact frequency whatever `solver.contact_hz` says; one that lets the
//! length scale the backend's speed cap; one that lets it scale each body's sleep speed; a lint
//! `physics.small_body` that reads only the first shape of each body; and a check that reads
//! only the range of `solver.length_unit`, never whether the backend scales by it.
//! #2317's (tests/acceptance/2317): a wrapper that leaves the backend's reuse of a pair's contact
//! points as the backend has it, on for every pair; and one that turns it off for every world.

use super::*;

/// The planted programs this file runs.
pub const PLANTED: [&str; 14] = [
    "contact_hz_quarter",
    "static_contact_same_hz",
    "contact_default_30",
    "belt_hook_left_out",
    "belt_speed_along_world_x",
    "belt_speed_along_level_ground",
    "wrapper_ignores_length_unit",
    "wrapper_ignores_contact_hz",
    "wrapper_scales_speed_cap",
    "wrapper_scales_sleep_speed",
    "lint_reads_first_shape",
    "check_reads_range_only",
    "wrapper_leaves_contact_reuse_on",
    "wrapper_turns_contact_reuse_off",
];

/// #2308's planted programs, and #2317's two, as `Twin::Small` holds them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Small {
    LengthIgnored,
    ContactOwn,
    SpeedCapScaled,
    SleepSpeedScaled,
    FirstShape,
    RangeOnly,
    ReuseKept,
    ReuseOff,
}

/// #2308: what the wrapper hands Rapier of `w` under `twin`: its contact frequency, Hz; its
/// length, m; the lengths its speed cap and each body's sleep speed are divided by, so that
/// `solver.max_speed` and `solver.sleep.speed` stay in m/s whatever the length is; and (#2317)
/// the share of its length within which a pair keeps its contact points (belt.rs).
pub(crate) fn lengths(twin: Twin, w: &World) -> (f32, f64, f64, f64, f32) {
    let own = rapier3d::prelude::SpringCoefficients::<f32>::contact_defaults().natural_frequency;
    let hz = match twin {
        Twin::Small(Small::ContactOwn) => own,
        _ => w.solver.contact_hz as f32,
    };
    let unit = match twin {
        Twin::Small(Small::LengthIgnored) => 1.0,
        _ => w.solver.length_unit,
    };
    let reuse = crate::belt::reused(twin);
    match twin {
        Twin::Small(Small::SpeedCapScaled) => (hz, unit, 1.0, unit, reuse),
        Twin::Small(Small::SleepSpeedScaled) => (hz, unit, unit, 1.0, reuse),
        _ => (hz, unit, unit, unit, reuse),
    }
}

/// #2308: `issues` with the lint `physics.small_body`'s after them, under the planted lint or none.
pub(super) fn warned(run: &Run, w: &World, mut issues: Vec<Value>) -> Vec<Value> {
    use deep_canvas_physics::small::{issues as small, Planted};
    let planted = match run.twin {
        Twin::Small(Small::FirstShape) => Planted::FirstShape,
        _ => Planted::None,
    };
    issues.extend(small(w, planted));
    issues
}

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    run.twin = match name {
        "contact_hz_quarter" => Twin::ContactsAtAQuarter,
        "static_contact_same_hz" => Twin::StaticContactSame,
        "contact_default_30" => Twin::Contact30,
        "belt_hook_left_out" => Twin::BeltWithoutHook,
        "belt_speed_along_world_x" => Twin::BeltAlongWorldX,
        "belt_speed_along_level_ground" => Twin::BeltAlongLevel,
        "wrapper_ignores_length_unit" => Twin::Small(Small::LengthIgnored),
        "wrapper_ignores_contact_hz" => Twin::Small(Small::ContactOwn),
        "wrapper_scales_speed_cap" => Twin::Small(Small::SpeedCapScaled),
        "wrapper_scales_sleep_speed" => Twin::Small(Small::SleepSpeedScaled),
        "lint_reads_first_shape" => Twin::Small(Small::FirstShape),
        "check_reads_range_only" => Twin::Small(Small::RangeOnly),
        "wrapper_leaves_contact_reuse_on" => Twin::Small(Small::ReuseKept),
        "wrapper_turns_contact_reuse_off" => Twin::Small(Small::ReuseOff),
        _ => return false,
    };
    true
}

/// The world check (vehicle.rs), under this file's planted check or default.
pub(super) fn check(v: &Value, run: &Run) -> Result<World, Vec<Refusal>> {
    let written = v.pointer("/solver/contact_hz").and_then(Value::as_f64);
    match (run.twin, written) {
        (Twin::Contact30, None) => vehicle::check(v, run).map(|mut w| {
            w.solver.contact_hz = 30.0;
            w
        }),
        // The world checked as if it wrote none, then held to a quarter.
        (Twin::ContactsAtAQuarter, Some(hz)) => {
            let mut unwritten = v.clone();
            if let Some(s) = unwritten["solver"].as_object_mut() {
                s.remove("contact_hz");
            }
            let mut w = vehicle::check(&unwritten, run)?;
            if hz > w.step_rate * f64::from(w.substeps) / 4.0 {
                return vehicle::check(v, run);
            }
            w.solver.contact_hz = hz;
            Ok(w)
        }
        _ => vehicle::check(v, run),
    }
}
