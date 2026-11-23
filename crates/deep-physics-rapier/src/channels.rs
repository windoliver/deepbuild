//! #2293 and #524: the channels a world's outputs write in its scene, shared by the hosts that
//! draw a world's bake (deep-show's frames and deep-gpu's view3d): each output to an item's `at` or
//! a vec3 field, its body's pose at every frame from the states after each step, positions lerped
//! and rotations nlerped between the two steps around the frame (Physics output).

use std::collections::BTreeSet;

use deep_canvas_physics::doc::{Read, World};
use deep_canvas_physics::occurrence::step_flicks;
use serde_json::{json, Map, Value};

/// A body's state after a step: its position and rotation `[x, y, z, w]`.
fn pose_of(s: &Value) -> Option<([f64; 3], [f64; 4])> {
    let v = |k: &str, n: usize| -> Option<Vec<f64>> {
        let a = s.get(k)?.as_array()?;
        (a.len() == n).then(|| a.iter().filter_map(Value::as_f64).collect())
    };
    let (p, r) = (v("pos", 3)?, v("rot", 4)?);
    Some(([p[0], p[1], p[2]], [r[0], r[1], r[2], r[3]]))
}

/// A rotation as the canvas writes it: degrees about X, then Y, then Z, in fixed axes
/// (R = Rz·Ry·Rx, Units and conventions).
fn euler(q: [f64; 4]) -> [f64; 3] {
    let [x, y, z, w] = q;
    let rx = (2.0 * (w * x + y * z)).atan2(1.0 - 2.0 * (x * x + y * y));
    let ry = (2.0 * (w * y - z * x)).clamp(-1.0, 1.0).asin();
    let rz = (2.0 * (w * z + x * y)).atan2(1.0 - 2.0 * (y * y + z * z));
    [rx, ry, rz].map(f64::to_degrees)
}

/// A body's pose at `t` flicks from its states after each step (`step` flicks apart): the two
/// steps around it mixed by α, positions lerped and rotations nlerped (Physics output), or the
/// earlier step's with `hold`; #2035: the later one, with no blend, where `cuts` lists it, a
/// place's step having ended there.
pub fn pose_at(
    states: &[Value],
    t: i64,
    step: i64,
    hold: bool,
    cuts: &BTreeSet<u64>,
) -> Option<([f64; 3], [f64; 4])> {
    let (k, rem) = ((t / step) as usize, t % step);
    let a = pose_of(states.get(k)?)?;
    if rem == 0 || hold {
        return Some(a);
    }
    let Some(b) = states.get(k + 1).and_then(pose_of) else {
        return Some(a);
    };
    if cuts.contains(&(k as u64 + 1)) {
        return Some(b);
    }
    let alpha = rem as f64 / step as f64;
    let pos = [0, 1, 2].map(|i| a.0[i] + alpha * (b.0[i] - a.0[i]));
    let dot: f64 = (0..4).map(|i| a.1[i] * b.1[i]).sum();
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let q = [0, 1, 2, 3].map(|i| a.1[i] + alpha * (sign * b.1[i] - a.1[i]));
    let n = q.iter().map(|x| x * x).sum::<f64>().sqrt();
    Some((pos, q.map(|x| x / n)))
}

/// #251: a bake reply's states by ID, the bodies' and each wheel's (`<body>#<wheel>`), for the
/// outputs to item paths.
fn states(reply: &Value) -> Value {
    let mut all = reply["bodies"].clone();
    if let (Some(all), Some(wheels)) = (all.as_object_mut(), reply["wheels"].as_object()) {
        all.extend(wheels.clone());
    }
    all
}

/// A channel of `ty` keyed at each of `values`' frames, linear between them.
fn keyed<V: Into<Value>>(target: String, ty: &str, values: Vec<V>) -> Value {
    let keys: Map<String, Value> = values
        .into_iter()
        .enumerate()
        .map(|(f, v)| {
            (
                format!("f{f}"),
                json!({"t": format!("{f}f"), "value": v.into(), "interp": "linear"}),
            )
        })
        .collect();
    json!({"target": target, "type": ty, "keys": keys})
}

/// The channels a world's outputs write in its scene from its bake's `reply`, each `to` an
/// item's `at` (a pose: its position and rotation, never its scale) or a vec3 field (a position),
/// keyed at every frame of the span; a `<body>#*` output writes an instancer's columns instead
/// (#1921: written.rs). #2248: any other read writes its series' value at each frame to its path,
/// three numbers to a vec3 field and one to a number, a joint's force for its `joint_force`.
/// `whole`: #1921's planted output, which writes a scale of 1 with the pose.
pub fn output_channels(
    id: &str,
    w: &World,
    reply: &Value,
    frames: &[i64],
    whole: bool,
    out: &mut Map<String, Value>,
) -> Result<(), Value> {
    let step = step_flicks(w);
    let bodies = states(reply);
    for (oid, o) in w.outputs.iter().filter(|(_, o)| !o.from.ends_with("#*")) {
        // #182: a `to` that names a readout, not an item path, draws no channel: the readout
        // takes the value each frame (#2248: written.rs).
        let Some(to) = o.to.as_ref().filter(|t| t.contains('/')) else {
            continue;
        };
        let states = bodies[&o.from].as_array().cloned().unwrap_or_default();
        let cuts = deep_canvas_physics::cut::of(&reply["outputs"], &o.from);
        let poses: Vec<_> = frames
            .iter()
            .filter_map(|t| pose_at(&states, *t, step, o.hold, &cuts))
            .collect();
        let name = |part: &str| format!("physics-{id}-{oid}-{part}");
        match (o.read, to.strip_suffix("/at")) {
            (Read::Pose, Some(item)) => {
                let pos = poses.iter().map(|p| p.0).collect();
                out.insert(name("pos"), keyed(format!("{item}/at/pos"), "vec3", pos));
                let rot = poses.iter().map(|p| euler(p.1)).collect();
                out.insert(name("rot"), keyed(format!("{item}/at/rot"), "vec3", rot));
                if whole {
                    let ones = vec![[1.0; 3]; poses.len()];
                    let scale = keyed(format!("{item}/at/scale"), "vec3", ones);
                    out.insert(name("scale"), scale);
                }
            }
            (Read::Pose | Read::Position, _) => {
                let to = to
                    .strip_suffix("/at")
                    .map_or(to.clone(), |i| format!("{i}/at/pos"));
                let pos = poses.iter().map(|p| p.0).collect();
                out.insert(name("pos"), keyed(to, "vec3", pos));
            }
            _ => {
                let force = |v: &Value| v.get("force").unwrap_or(v).clone();
                let frames = deep_canvas_physics::reading::frames(reply, oid);
                let values: Vec<Value> = frames.iter().map(force).collect();
                let ty = match values.first() {
                    Some(Value::Array(v)) if v.len() == 3 => "vec3",
                    Some(Value::Number(_)) => "f32",
                    v => {
                        let what = format!(
                            "an output's to takes one number or three; {oid} writes {}",
                            json!(v)
                        );
                        let path = format!("outputs/{oid}/to");
                        return Err(json!({"code": "out_of_range", "path": path, "what": what}));
                    }
                };
                out.insert(name("value"), keyed(to.clone(), ty, values));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_physics::caps::RAPIER3D;
    use deep_canvas_physics::check::check;
    use deep_canvas_physics::roles::TABLE;

    /// #2248: every read writes where its `to` names. A ball dropped 0.5 m onto a floor and a
    /// 1 kg weight on a fixed joint, baked 1 s: the ball's contact count goes from none to one,
    /// its energy holds while it falls, and each output is a channel on its path, three numbers
    /// for an angle and one for a count, a joint's force (the weight's 9.81 N) and a speed a
    /// series samples, which still writes every frame beside its rows.
    #[test]
    fn every_read_writes_its_series_to_its_path() {
        let shape = |s: &str| json!([{"shape": s, "contact_material": "m"}]);
        let world = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4, "gravity": [0, -9.81, 0],
            "seed": 2248, "mode": "dynamic", "capacity": {"bodies": 8, "shapes": 8, "joints": 4, "contacts": 32, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 1000}},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.1}, "floor": {"kind": "box", "half": [5, 0.1, 5]},
                       "tall": {"kind": "box", "half": [0.25, 0.5, 0.25]}},
            "bodies": {
                "floor": {"kind": "static", "shapes": shape("floor"), "pose": {"pos": [0, -0.1, 0]}},
                "ball": {"kind": "dynamic", "shapes": shape("ball"), "pose": {"pos": [0, 0.6, 0]}, "mass": 1},
                "weight": {"kind": "dynamic", "shapes": shape("tall"), "pose": {"pos": [3, 1.5, 0]}, "mass": 1, "sleep": false}},
            "joints": {"hold": {"kind": "fixed", "a": "world", "b": "weight",
                                "frame_a": {"anchor": [3, 2, 0]}, "frame_b": {"anchor": [0, 0.5, 0]}}},
            "outputs": {
                "touch": {"from": "ball", "read": "contact_count", "to": "items/count/at/pos/0"},
                "joules": {"from": "ball", "read": "energy"},
                "lean": {"from": "ball", "read": "angle", "to": "items/ball/at/rot"},
                "load": {"from": "hold", "read": "joint_force", "to": "items/gauge/at/pos/1"},
                "pace": {"from": "ball", "read": "speed", "sample": 12, "average": 12, "to": "items/needle/at/pos/0"}}});
        let run = crate::runner::Run::new(None).expect("the unplanted runner");
        let call = json!({"call": "bake", "world": world, "steps": 120, "frame_rate": "60/1"});
        let reply = run.answer(&call).expect("a reply");
        assert_eq!(reply["ok"], json!(true), "{reply}");
        let series = &reply["outputs"]["series"];
        let number = |id: &str, f: usize| series[id][f].as_f64().expect("a number");
        assert_eq!((number("touch", 0), number("touch", 60)), (0.0, 1.0));
        // Its energy is what its own state gives: m g y + ½ m v², 0.6 × 9.81 J as built.
        let fell = &reply["bodies"]["ball"][30];
        let (y, v) = (fell["pos"][1].as_f64(), fell["linear"][1].as_f64());
        let (y, v) = (y.expect("m"), v.expect("m/s"));
        let (e0, e15) = (number("joules", 0), number("joules", 15));
        assert!((e0 - 0.6 * 9.81).abs() < 1e-3, "{e0} J as built");
        let own = 9.81 * y + 0.5 * v * v;
        assert!(v < -2.0 && (e15 - own).abs() < 1e-3, "{e15} J; {own} J");
        assert_eq!(
            series["pace"].as_array().map(Vec::len),
            Some(10),
            "ten rows a second"
        );

        let w = check(&world, &RAPIER3D, &TABLE).expect("the world checks");
        let frames: Vec<i64> = (0..=60).map(|f| f * 11_760_000).collect();
        let mut out = Map::new();
        output_channels("w", &w, &reply, &frames, false, &mut out).expect("channels");
        let channel = |id: &str| &out[&format!("physics-w-{id}-value")];
        let shape = |id: &str| (channel(id)["type"].clone(), channel(id)["target"].clone());
        assert_eq!(
            shape("touch"),
            (json!("f32"), json!("items/count/at/pos/0"))
        );
        assert_eq!(shape("lean"), (json!("vec3"), json!("items/ball/at/rot")));
        assert_eq!(
            channel("lean")["keys"]["f0"]["value"],
            json!([0.0, 0.0, 0.0])
        );
        let load = channel("load")["keys"]["f60"]["value"].as_f64().expect("N");
        assert!((load - 9.81).abs() < 0.2, "the weight's {load} N");
        let pace = channel("pace")["keys"].as_object().expect("keys");
        assert_eq!(pace.len(), 61, "a key a frame, beside the series' ten rows");
        assert!((pace["f15"]["value"].as_f64().expect("m/s") - 9.81 * 0.25).abs() < 0.01);
    }
}
