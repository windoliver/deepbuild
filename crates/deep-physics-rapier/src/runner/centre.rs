//! #2240: a body's centre of mass on the runner (tests/acceptance/2240/README.md: The surface
//! under test). A body's `pose` output samples the body's own origin and rotation into
//! `outputs.series`, `{pos, rot}` as a wheel's does, never its centre of mass. And its planted
//! programs: a wrapper that reads `centre_of_mass` and leaves the weight where the shapes put it;
//! one that moves the weight and adds a parallel-axis term to the shapes' inertia; a check that
//! takes a point outside the bounds of the body's shapes; and a `pose` output that reads the
//! centre of mass.

use super::*;

/// The planted programs this file runs.
pub const PLANTED: [&str; 4] = [
    "centre_of_mass_ignored",
    "centre_of_mass_parallel_axis",
    "check_accepts_centre_outside",
    "pose_reads_centre_of_mass",
];

/// The planted check or output, if any.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    CheckAcceptsOutside,
    PoseReadsCentre,
}

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    match name {
        "centre_of_mass_ignored" => run.twin = Twin::CentreIgnored,
        "centre_of_mass_parallel_axis" => run.twin = Twin::CentreParallelAxis,
        "check_accepts_centre_outside" => run.centre = Plant::CheckAcceptsOutside,
        "pose_reads_centre_of_mass" => run.centre = Plant::PoseReadsCentre,
        _ => return false,
    }
    true
}

/// The world check (contact.rs); the planted check holds no dynamic body's `centre_of_mass` to
/// the bounds of its shapes: the world is checked without those points, each then set as written.
pub(super) fn check(v: &Value, run: &Run) -> Result<World, Vec<Refusal>> {
    if run.centre != Plant::CheckAcceptsOutside {
        return contact::check(v, run);
    }
    let (mut bare, mut written) = (v.clone(), Vec::new());
    let bodies = bare.get_mut("bodies").and_then(Value::as_object_mut);
    for (id, b) in bodies.into_iter().flatten() {
        let dynamic = matches!(b["kind"].as_str(), Some("dynamic" | "vehicle"));
        let point = serde_json::from_value::<[f64; 3]>(b["centre_of_mass"].clone());
        if let (true, Ok(p), Some(b)) = (dynamic, point, b.as_object_mut()) {
            b.remove("centre_of_mass");
            written.push((id.clone(), p));
        }
    }
    let mut w = contact::check(&bare, run)?;
    for (id, p) in written {
        if let Some(b) = w.bodies.get_mut(&id) {
            b.centre_of_mass = Some(p);
        }
    }
    Ok(w)
}

/// After a step: each body `pose` output's sample, its body's position and rotation among the
/// canonical values `c`; the planted output reads the body's centre of mass for its position.
pub(super) fn take(run: &Run, b: &Rapier, w: &World, c: &[Canonical], t: &mut Trace) {
    for (id, o) in w.outputs.iter().filter(|(_, o)| o.read == Read::Pose) {
        let Some(x) = c
            .iter()
            .find(|x| x.id == o.from && w.bodies.contains_key(&x.id))
        else {
            continue;
        };
        let mut sample: Vec<f64> = x.values[..7].iter().map(|v| f64::from(*v)).collect();
        if run.centre == Plant::PoseReadsCentre {
            if let Some(at) = b.centre_of_mass(&o.from) {
                sample[..3].copy_from_slice(&at);
            }
        }
        t.wheels.entry(id.clone()).or_default().push(sample);
    }
}
