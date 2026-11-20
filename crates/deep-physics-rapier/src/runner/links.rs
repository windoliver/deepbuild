//! #2310: joints of one tree as one articulation, on the runner: its planted programs
//! (tests/acceptance/2310). Three are backend wrappers: one that builds every articulated joint
//! as a separate one, one that drops an articulated joint's limits, and one that leaves every
//! articulated joint at coordinate 0, whatever poses the document writes. One is a check that
//! holds the articulated joints' trees only by counting joints against bodies. One is a restore
//! that leaves the articulated joints' coordinates out of what it loads.

use deep_canvas_physics::check::ARTICULATION_TREE;

use super::*;

/// The planted programs this file runs.
pub const PLANTED: [&str; 5] = [
    "articulated_built_separate",
    "articulated_drops_limits",
    "articulated_tree_counts_only",
    "articulated_starts_at_zero",
    "checkpoint_drops_joint_coordinates",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    match name {
        "articulated_built_separate" => run.twin = Twin::LinksSeparate,
        "articulated_drops_limits" => run.twin = Twin::LinksWithoutLimits,
        "articulated_tree_counts_only" => run.twin = Twin::TreeCountsOnly,
        "articulated_starts_at_zero" => run.twin = Twin::LinksAtZero,
        "checkpoint_drops_joint_coordinates" => run.restore = Restore::NoCoordinates,
        _ => return false,
    }
    true
}

/// The world check (centre.rs); under the planted `articulated_tree_counts_only`, a world with
/// no more articulated joints than bodies passes whatever trees they form.
pub(super) fn check(v: &Value, run: &Run) -> Result<World, Vec<Refusal>> {
    let checked = centre::check(v, run);
    let Err(refused) = &checked else {
        return checked;
    };
    let count = |key: &str, of: fn(&Value) -> bool| {
        let all = v.get(key).and_then(Value::as_object);
        all.map_or(0, |m| m.values().filter(|x| of(x)).count())
    };
    let joints = count("joints", |j| j["articulated"] == true);
    if run.twin != Twin::TreeCountsOnly || joints > count("bodies", |_| true) {
        return checked;
    }
    // The joints the tree rule names, checked as if separate, then handed on as written.
    let tree = refused.iter().filter(|r| r.code == ARTICULATION_TREE);
    let named: Vec<&str> = tree.filter_map(|r| r.path.split('/').nth(1)).collect();
    let mut open = v.clone();
    for id in &named {
        if let Some(j) = open["joints"][*id].as_object_mut() {
            j.remove("articulated");
        }
    }
    let mut w = centre::check(&open, run)?;
    for id in named {
        if let Some(j) = w.joints.get_mut(id) {
            j.articulated = true;
        }
    }
    Ok(w)
}
