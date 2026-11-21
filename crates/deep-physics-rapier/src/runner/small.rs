//! #2308: small things on the runner: its planted programs (tests/acceptance/2308). Four are
//! backend wrappers: one that never sets the backend's length, so a world's `solver.length_unit`
//! changes nothing; one that keeps the backend's own contact frequency whatever
//! `solver.contact_hz` says; one that lets the length scale the backend's speed cap, so
//! `solver.max_speed` shrinks with it; and one that lets it scale each body's sleep speed. One
//! is a lint `physics.small_body` that reads only the first shape of each body, and one a check
//! that reads only the range of `solver.length_unit`, never whether the backend scales by it.

use deep_canvas_physics::small::Planted;

use super::Run;
use crate::Twin;

/// The planted programs this file runs.
pub const PLANTED: [&str; 6] = [
    "wrapper_ignores_length_unit",
    "wrapper_ignores_contact_hz",
    "wrapper_scales_speed_cap",
    "wrapper_scales_sleep_speed",
    "lint_reads_first_shape",
    "check_reads_range_only",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    match name {
        "wrapper_ignores_length_unit" => run.twin = Twin::LengthIgnored,
        "wrapper_ignores_contact_hz" => run.twin = Twin::ContactOwn,
        "wrapper_scales_speed_cap" => run.twin = Twin::SpeedCapScaled,
        "wrapper_scales_sleep_speed" => run.twin = Twin::SleepSpeedScaled,
        "lint_reads_first_shape" => run.small = Planted::FirstShape,
        "check_reads_range_only" => run.twin = Twin::LengthRangeOnly,
        _ => return false,
    }
    true
}
