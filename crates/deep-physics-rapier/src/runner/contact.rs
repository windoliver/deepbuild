//! #2309: a contact's frequency on the runner, and its planted programs (tests/acceptance/2309):
//! a check that holds `solver.contact_hz` to a quarter of (step rate × substeps), as it holds a
//! joint's spring, not to the sixth a contact settles at; a backend wrapper that holds a contact
//! with a static body at the same frequency as any other, not twice it; and a default that keeps
//! 30 Hz whatever the step.

use super::*;

/// The planted programs this file runs.
pub const PLANTED: [&str; 3] = [
    "contact_hz_quarter",
    "static_contact_same_hz",
    "contact_default_30",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    run.twin = match name {
        "contact_hz_quarter" => Twin::ContactsAtAQuarter,
        "static_contact_same_hz" => Twin::StaticContactSame,
        "contact_default_30" => Twin::Contact30,
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
