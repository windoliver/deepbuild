//! #251: a vehicle body on the runner (tests/acceptance/251/README.md: The surface under test).
//! `bake` and `restore` replies carry `vehicles`, each vehicle body's own state beside `bodies`,
//! for the bodies `read` names; an output on a wheel's address `<body>#<wheel>` samples its `pose`
//! (`{pos, rot}`, positions lerped and rotations nlerped between steps) or its `contact_count`
//! (held from the step at or before the frame) into `outputs.series`; and #251's, #2306's and
//! #2307's planted names.

use super::*;
use crate::VehiclePlant;
use deep_canvas_physics::backend::VehicleState;
use deep_canvas_physics::cut;
use deep_canvas_physics::kit::Planted;

/// #251's, #2306's, #2307's and #2035's planted wrong programs, by name.
pub const PLANTED: [&str; 21] = [
    "place_blends",
    "place_blends_rotation",
    "place_blends_wheels",
    "restore_forgets_place",
    "spring_on_whole_mass",
    "brake_whole_force_each_wheel",
    "steer_clamps_angle",
    "steer_parallel",
    "contact_names_body_only",
    "checkpoint_drops_steer",
    "check_counts_wheels_only",
    "kit_counts_excluded_passed",
    "place_keeps_spin_rate",
    "place_keeps_angular_velocity",
    "controller_as_is",
    "grip_reads_chassis_only",
    "controller_without_hold",
    "hold_ignores_brake_limit",
    "hold_takes_out_side_slip",
    "controller_runs_asleep",
    "leaves_asleep_on_moving_ground",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    let twin = match name {
        "place_blends" => Some(Twin::PlaceBlends),
        "place_blends_rotation" => Some(Twin::PlaceBlendsRotation),
        "place_blends_wheels" => Some(Twin::PlaceBlendsWheels),
        "restore_forgets_place" => Some(Twin::RestoreForgetsPlace),
        _ => None,
    };
    if let Some(twin) = twin {
        run.twin = twin;
        return true;
    }
    run.vehicle = match name {
        "spring_on_whole_mass" => VehiclePlant::WholeMassSprings,
        "brake_whole_force_each_wheel" => VehiclePlant::WholeBrake,
        "steer_clamps_angle" => VehiclePlant::ClampSteer,
        "steer_parallel" => VehiclePlant::ParallelSteer,
        "contact_names_body_only" => VehiclePlant::BodyOnly,
        "checkpoint_drops_steer" => VehiclePlant::DropSteer,
        "check_counts_wheels_only" => VehiclePlant::WheelsOnly,
        "place_keeps_spin_rate" => VehiclePlant::PlaceKeepsSpinRate,
        "place_keeps_angular_velocity" => VehiclePlant::PlaceKeepsAngular,
        "controller_as_is" => VehiclePlant::GroundTakesNothing,
        "grip_reads_chassis_only" => VehiclePlant::GripChassisOnly,
        "controller_without_hold" => VehiclePlant::NoHold,
        "hold_ignores_brake_limit" => VehiclePlant::HoldPastBrake,
        "hold_takes_out_side_slip" => VehiclePlant::HoldTakesSlip,
        "controller_runs_asleep" => VehiclePlant::RunsAsleep,
        "leaves_asleep_on_moving_ground" => VehiclePlant::StaysAsleep,
        "kit_counts_excluded_passed" => {
            run.kit_planted = Planted::CountsExcludedPassed;
            return true;
        }
        _ => return false,
    };
    true
}

/// The world check; under the planted `check_counts_wheels_only`, a vehicle body's only refusal
/// is a wheel too many: not a 2D world, not a follow channel.
pub(super) fn check(v: &Value, run: &Run) -> Result<World, Vec<Refusal>> {
    let checked = deep_canvas_physics::check::check(v, &run.caps_of(v), run.table);
    if run.vehicle != VehiclePlant::WheelsOnly {
        return checked;
    }
    let bodies = v.get("bodies").and_then(Value::as_object);
    let vehicles: Vec<&String> = bodies
        .into_iter()
        .flatten()
        .filter(|(_, b)| b["kind"] == "vehicle")
        .map(|(id, _)| id)
        .collect();
    let counted = |r: &Refusal| {
        !vehicles.iter().any(|id| {
            r.path == format!("bodies/{id}/kind") || r.path == format!("bodies/{id}/follow")
        })
    };
    checked.map_err(|e| e.into_iter().filter(counted).collect())
}

/// The `vehicles` a run holds, each vehicle body `read` names (all when absent) as an empty list.
pub(super) fn named(call: &Value, b: &Rapier) -> Map<String, Value> {
    let read: Option<Vec<&str>> = call
        .get("read")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect());
    b.vehicles
        .ids()
        .into_iter()
        .filter(|id| read.as_ref().is_none_or(|r| r.contains(&id.as_str())))
        .map(|id| (id, json!([])))
        .collect()
}

fn state(v: &VehicleState) -> Value {
    let wheels: Vec<Value> = v
        .wheels
        .iter()
        .map(|w| json!({"name": w.name, "spin": w.spin, "spin_rate": w.spin_rate, "touching": w.touching}))
        .collect();
    json!({"wheels": wheels, "drive": v.drive, "steer": v.steer, "brake": v.brake})
}

/// The wheel outputs of `w`: (output ID, wheel address, whether it reads pose).
fn wheel_outputs(w: &World) -> Vec<(&String, &String, bool)> {
    w.outputs
        .iter()
        .filter(|(_, o)| {
            o.from.contains('#')
                && w.bodies
                    .contains_key(o.from.split('#').next().unwrap_or(""))
        })
        .map(|(id, o)| (id, &o.from, o.read == Read::Pose))
        .collect()
}

/// After step `k` of a run from `start`: each named vehicle body's state every `every` steps, and
/// each wheel output's reading.
pub(super) fn take(b: &Rapier, w: &World, t: &mut Trace, (k, start, every): (u64, u64, u64)) {
    if !t.vehicles.is_empty() && (k - start).is_multiple_of(every) {
        for v in b.vehicles() {
            if let Some(Value::Array(list)) = t.vehicles.get_mut(&v.id) {
                list.push(state(&v));
            }
        }
    }
    let outputs = wheel_outputs(w);
    if outputs.is_empty() {
        return;
    }
    let poses = b.vehicles.wheel_poses(&b.world);
    for (id, from, pose) in outputs {
        if let Some((_, pos, rot, touching)) = poses.iter().find(|p| p.0 == *from) {
            let sample = if pose {
                t.posed.entry(id.clone()).or_insert_with(|| from.clone());
                [pos.as_slice(), rot.as_slice()].concat()
            } else {
                vec![f64::from(u8::from(*touching))]
            };
            t.wheels.entry(id.clone()).or_default().push(sample);
        }
    }
}

/// A bake's `outputs` over `steps` steps at the document's frames (bake.rs): each position and
/// joint output's samples, each wheel and pose output's, and (#2248) each valued output's series,
/// rows for one a series samples (reading.rs). #2035: each frame between a place's step and the
/// one before shows the state the place left, with no blend, and `cuts` lists those states by
/// body; the planted outputs blend across it, or blend a wheel's or a rotation.
pub(super) fn outputs(
    run: &Run,
    t: &Trace,
    (rate, frame): (&str, i64),
    w: &World,
    steps: u64,
) -> Value {
    let step = deep_canvas_physics::occurrence::step_flicks(w);
    let none = cut::Cuts::new();
    let cuts = if run.twin == Twin::PlaceBlends {
        &none
    } else {
        &t.cuts
    };
    let wheels = run.twin != Twin::PlaceBlendsWheels;
    let cut = |id: &str, k: u64| {
        let o = w.outputs.get(id);
        o.is_some_and(|o| (wheels || !o.from.contains('#')) && cut::at(cuts, o, k))
    };
    let mut outputs = bake::outputs(
        &t.positions,
        &t.readings,
        (rate, frame),
        (w.step_rate, steps),
        cut,
    );
    bake::wheel_series(&mut outputs, &t.wheels, (frame, step), cut);
    if run.twin == Twin::PlaceBlendsRotation {
        let mut blended = json!({});
        bake::wheel_series(&mut blended, &t.wheels, (frame, step), |_, _| false);
        for (id, frames) in outputs["series"].as_object_mut().into_iter().flatten() {
            for (j, v) in frames.as_array_mut().into_iter().flatten().enumerate() {
                if v.get("rot").is_some() {
                    v["rot"] = blended["series"][id][j]["rot"].clone();
                }
            }
        }
    }
    deep_canvas_physics::reading::series(&mut outputs, w, &t.values, frame, cuts);
    if !cuts.is_empty() {
        outputs["cuts"] = cut::json(cuts, steps);
    }
    outputs
}

/// A bake reply's `wheels`: each wheel a pose output reads, by its address, as its states after
/// each step (`{pos, rot}`), which an output to an item path draws from (channels.rs); none
/// without one.
pub(super) fn wheel_states(
    reply: &mut Value,
    posed: &BTreeMap<String, String>,
    wheels: &BTreeMap<String, Vec<Vec<f64>>>,
) {
    let mut out = Map::new();
    for (id, from) in posed {
        let at = wheels.get(id).into_iter().flatten();
        let states = at
            .map(|v| json!({"pos": &v[..3], "rot": &v[3..]}))
            .collect();
        out.insert(from.clone(), Value::Array(states));
    }
    if !out.is_empty() {
        reply["wheels"] = Value::Object(out);
    }
}
