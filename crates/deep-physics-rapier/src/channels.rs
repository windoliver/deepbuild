//! #2293 and #524: the channels a world's outputs write in its scene, shared by the hosts that
//! draw a world's bake (deep-show's frames and deep-gpu's view3d): each output to an item's `at` or
//! a vec3 field, its body's pose at every frame from the states after each step, positions lerped
//! and rotations nlerped between the two steps around the frame (Physics output).

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
/// earlier step's with `hold`.
pub fn pose_at(states: &[Value], t: i64, step: i64, hold: bool) -> Option<([f64; 3], [f64; 4])> {
    let (k, rem) = ((t / step) as usize, t % step);
    let a = pose_of(states.get(k)?)?;
    if rem == 0 || hold {
        return Some(a);
    }
    let Some(b) = states.get(k + 1).and_then(pose_of) else {
        return Some(a);
    };
    let alpha = rem as f64 / step as f64;
    let pos = [0, 1, 2].map(|i| a.0[i] + alpha * (b.0[i] - a.0[i]));
    let dot: f64 = (0..4).map(|i| a.1[i] * b.1[i]).sum();
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let q = [0, 1, 2, 3].map(|i| a.1[i] + alpha * (sign * b.1[i] - a.1[i]));
    let n = q.iter().map(|x| x * x).sum::<f64>().sqrt();
    Some((pos, q.map(|x| x / n)))
}

/// A channel keyed at each of `values`' frames, linear between them.
fn keyed(target: String, values: Vec<[f64; 3]>) -> Value {
    let keys: Map<String, Value> = values
        .into_iter()
        .enumerate()
        .map(|(f, v)| {
            (
                format!("f{f}"),
                json!({"t": format!("{f}f"), "value": v, "interp": "linear"}),
            )
        })
        .collect();
    json!({"target": target, "type": "vec3", "keys": keys})
}

/// The channels a world's outputs write in its scene, each `to` an item's `at` (a pose: its
/// position and rotation, never its scale) or a vec3 field (a position), keyed at every frame of
/// the span; a `<body>#*` output writes an instancer's columns instead (#1921: written.rs).
/// `whole`: #1921's planted output, which writes a scale of 1 with the pose.
pub fn output_channels(
    id: &str,
    w: &World,
    bodies: &Value,
    frames: &[i64],
    whole: bool,
    out: &mut Map<String, Value>,
) -> Result<(), Value> {
    let step = step_flicks(w);
    for (oid, o) in w.outputs.iter().filter(|(_, o)| !o.from.ends_with("#*")) {
        let Some(to) = &o.to else { continue };
        let states = bodies[&o.from].as_array().cloned().unwrap_or_default();
        let poses: Vec<_> = frames
            .iter()
            .filter_map(|t| pose_at(&states, *t, step, o.hold))
            .collect();
        let name = |part: &str| format!("physics-{id}-{oid}-{part}");
        match (o.read, to.strip_suffix("/at")) {
            (Read::Pose, Some(item)) => {
                out.insert(
                    name("pos"),
                    keyed(
                        format!("{item}/at/pos"),
                        poses.iter().map(|p| p.0).collect(),
                    ),
                );
                out.insert(
                    name("rot"),
                    keyed(
                        format!("{item}/at/rot"),
                        poses.iter().map(|p| euler(p.1)).collect(),
                    ),
                );
                if whole {
                    let ones = vec![[1.0; 3]; poses.len()];
                    out.insert(name("scale"), keyed(format!("{item}/at/scale"), ones));
                }
            }
            (Read::Pose | Read::Position, _) => {
                let to = to
                    .strip_suffix("/at")
                    .map_or(to.clone(), |i| format!("{i}/at/pos"));
                out.insert(name("pos"), keyed(to, poses.iter().map(|p| p.0).collect()));
            }
            (r, _) => {
                let what = format!(
                    "an output's to with read {} isn't drawn by this host yet; #2248 brings it",
                    r.name()
                );
                return Err(
                    json!({"code": "physics.unsupported", "path": format!("outputs/{oid}/to"), "what": what}),
                );
            }
        }
    }
    Ok(())
}
