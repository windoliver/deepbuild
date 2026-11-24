//! #3258: the runner's planted readings of what passed through what (`deep_canvas_physics::through`).

use deep_canvas_physics::through::Planted;

use super::Run;

/// The planted programs this file runs.
pub const PLANTED: [&str; 4] = [
    "through_reads_contact_pairs",
    "through_in_world_frame",
    "through_reads_one_step",
    "through_counts_inside",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    run.through = match name {
        "through_reads_contact_pairs" => Planted::ContactPairs,
        "through_in_world_frame" => Planted::WorldPath,
        "through_reads_one_step" => Planted::OneStep,
        "through_counts_inside" => Planted::AnyInside,
        _ => return false,
    };
    true
}
