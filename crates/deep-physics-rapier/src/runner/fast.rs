//! #2239: fast movers the backend can't hold, on the runner: its planted programs
//! (tests/acceptance/2239). Two are caps that say more than the backend holds, which the lint
//! `physics.fast_body` then believes: a sweep that starts from a kinematic body, and one that
//! holds any body once either of a pair has `ccd` on. Two are lints that read less: only a body's
//! move, and one body at a time. One is a backend wrapper that drops each body's `ccd`, and one a
//! kit that turns `ccd` on for a kinematic body too.

use deep_canvas_physics::fast::Planted;

use super::Run;
use crate::Twin;

/// The planted programs this file runs.
pub const PLANTED: [&str; 6] = [
    "lint_kinematic_as_dynamic",
    "wrapper_drops_body_ccd",
    "lint_reads_move_only",
    "lint_one_body_at_a_time",
    "lint_pair_held_by_one_ccd",
    "kit_turns_ccd_on_kinematic",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    let sweep = &mut run.caps.sweep;
    match name {
        "lint_kinematic_as_dynamic" => sweep.starts = &["dynamic", "kinematic"],
        "wrapper_drops_body_ccd" => run.twin = Twin::DropsBodyCcd,
        "lint_reads_move_only" => run.lint = Planted::MoveOnly,
        "lint_one_body_at_a_time" => run.lint = Planted::OneBody,
        "lint_pair_held_by_one_ccd" => (sweep.holds_ccd, sweep.holds_fast) = (true, true),
        "kit_turns_ccd_on_kinematic" => run.ccd_on_kinematic = true,
        _ => return false,
    }
    true
}
