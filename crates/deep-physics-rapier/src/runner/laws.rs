//! #1931: the force laws' planted wrong programs on the runner (tests/acceptance/1931): an
//! inverse square that falls off as 1 ÷ r; a check that admits a held central force at any
//! substeps; a magnetic law that holds q (v × B) over the step, and one that takes B × v; a pair
//! law without the factor 2, and one without the cutoff; and a kit with the three fixtures taken
//! out, on which a candidate that claims a law is refused.

use super::*;
use deep_canvas_physics::kit::Planted;

/// The planted programs this file runs.
pub const PLANTED: [&str; 7] = [
    "inverse_square_one_over_r",
    "check_admits_force_substeps",
    "magnetic_force_held",
    "magnetic_b_cross_v",
    "lennard_jones_no_factor_2",
    "lennard_jones_no_cutoff",
    "kit_without_force_law_fixtures",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    run.twin = match name {
        "inverse_square_one_over_r" => Twin::LawFallsAsR,
        "check_admits_force_substeps" => Twin::SubstepsAdmitted,
        "magnetic_force_held" => Twin::LawHoldsQvb,
        "magnetic_b_cross_v" => Twin::LawTakesBv,
        "lennard_jones_no_factor_2" => Twin::LawWithoutTwo,
        "lennard_jones_no_cutoff" => Twin::LawWithoutCutoff,
        "kit_without_force_law_fixtures" => {
            run.kit_planted = Planted::WithoutLaws;
            return true;
        }
        _ => return false,
    };
    true
}

/// The world check (contact.rs). Under the planted check, a world holding an `inverse_square`
/// or a `lennard_jones` is checked at the 1 substep those ask for and run at the substeps it
/// wrote, each step's force held across them.
pub(super) fn check(v: &Value, run: &Run) -> Result<World, Vec<Refusal>> {
    let central = |f: &Value| {
        ["inverse_square", "lennard_jones"]
            .iter()
            .any(|law| f["kind"].get(law).is_some() || f["kind"] == *law)
    };
    let holds = v["forces"]
        .as_object()
        .is_some_and(|m| m.values().any(central));
    let written = v["substeps"].as_u64().filter(|n| *n != 1 && holds);
    let (Twin::SubstepsAdmitted, Some(n)) = (run.twin, written) else {
        return contact::check(v, run);
    };
    let mut one = v.clone();
    one["substeps"] = json!(1);
    let mut w = contact::check(&one, run)?;
    w.substeps = n as u32;
    Ok(w)
}
