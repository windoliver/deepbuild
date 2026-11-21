//! #2248: an output's value after a step (Physics output), for the outputs whose value is one
//! number or one vector ([`Output::valued`]): a body's or a joint's read, a fold of the particles
//! its `from` names, or its `expr` over its named reads. It is read from what the backend
//! interface gives after a step and nothing else, so every backend's outputs read alike. An
//! angle is kept as its rotation while frames and samples are mixed, so that it nlerps as a pose
//! does, and shown as the canvas writes a rotation.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use deep_canvas::expr::V;
use deep_canvas::ops;
use serde_json::{json, Value};

use crate::backend::{Backend, CharacterState, JointState, State};
use crate::doc::{Output, Read, Reduce, World};
use crate::occurrence::step_flicks;

/// A rotation `[x, y, z, w]` as the canvas writes one: degrees about X, then Y, then Z, in fixed
/// axes (R = Rz·Ry·Rx, Units and conventions), on pinned math.
fn euler(q: &[f64]) -> Vec<f64> {
    let n = ops::sqrt(q.iter().map(|x| x * x).sum());
    let [x, y, z, w] = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    let rx = ops::atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + y * y));
    let ry = ops::asin((2.0 * (w * y - z * x)).clamp(-1.0, 1.0));
    let rz = ops::atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z));
    [rx, ry, rz].map(ops::deg).to_vec()
}

/// What `read` reads of `from` in `s`: one number or one vector; an angle its rotation
/// `[x, y, z, w]`, which [`shown`] turns into degrees.
fn raw(
    read: Read,
    from: &str,
    s: &State,
    joints: &[JointState],
    walkers: &[CharacterState],
) -> Option<Vec<f64>> {
    let body = || s.bodies.iter().find(|b| b.id == from);
    let joint = || joints.iter().find(|j| j.id == from);
    let walker = || walkers.iter().find(|c| c.id == from);
    let flag = |on: bool| vec![f64::from(u8::from(on))];
    Some(match read {
        Read::Position => body()?.pos.to_vec(),
        Read::Velocity => body()?.linear.to_vec(),
        Read::Angle => body()?.rot.to_vec(),
        Read::Speed => vec![ops::sqrt(body()?.linear.iter().map(|x| x * x).sum())],
        Read::Mass => vec![body()?.mass],
        Read::Energy => vec![body()?.energy],
        Read::ContactCount => vec![f64::from(body()?.contacts)],
        Read::JointCoordinate => vec![joint()?.coordinate.unwrap_or(0.0)],
        Read::JointForce => vec![joint()?.force, joint()?.torque],
        Read::Grounded => flag(walker()?.grounded),
        Read::Sliding => flag(walker()?.sliding),
        Read::Crouched => flag(walker()?.crouched),
        Read::Pose | Read::ParticlePositions | Read::Expr => return None,
    })
}

/// A read's value as an output shows it, from the value [`mixed`] or [`mean`] gives.
pub fn shown(read: Read, v: Vec<f64>) -> Vec<f64> {
    match read {
        Read::Angle => euler(&v),
        _ => v,
    }
}

/// `b` as it mixes with `a`: a rotation takes the sign nearer `a`, the shorter way round.
fn toward(read: Read, a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    if read == Read::Angle && dot < 0.0 {
        -1.0
    } else {
        1.0
    }
}

/// The value α of the way from step value `a` to the next step's `b` (Physics output: values
/// lerp and rotations nlerp between the two buffered steps).
pub fn mixed(read: Read, a: &[f64], b: &[f64], alpha: f64) -> Vec<f64> {
    let sign = toward(read, a, b);
    a.iter()
        .zip(b)
        .map(|(x, y)| x + alpha * (sign * y - x))
        .collect()
}

/// The mean of the step values `values`, which holds at least one.
pub fn mean(read: Read, values: &[Vec<f64>]) -> Vec<f64> {
    let last = &values[values.len() - 1];
    (0..last.len())
        .map(|i| {
            let sum: f64 = values.iter().map(|v| toward(read, last, v) * v[i]).sum();
            sum / values.len() as f64
        })
        .collect()
}

/// Output `o`'s value after the step that left `s`, `joints` and `walkers`; none for an output
/// whose value is no one number or vector.
pub fn value(
    o: &Output,
    w: &World,
    s: &State,
    joints: &[JointState],
    walkers: &[CharacterState],
) -> Option<Vec<f64>> {
    if let Some(f) = &o.expr {
        let var = |(from, read): &(String, Read)| {
            let v = shown(*read, raw(*read, from, s, joints, walkers)?);
            Some(match v.as_slice() {
                [x] => V::S(*x),
                v => {
                    let mut c = [0.0; 4];
                    c[..v.len()].copy_from_slice(v);
                    V::V(v.len() as u8, c)
                }
            })
        };
        let vars: Option<Vec<V>> = f.reads.iter().map(var).collect();
        return Some(match f.expr.eval(&vars?) {
            V::S(x) => vec![x],
            V::V(n, c) => c[..n as usize].to_vec(),
        });
    }
    let Some(fold) = o.reduce else {
        return raw(o.read, &o.from, s, joints, walkers);
    };
    let (id, part) = match o.from.split_once('#') {
        Some((id, part)) => (id, Some(part)),
        None => (o.from.as_str(), None),
    };
    let positions = &s.soft.iter().find(|x| x.id == id)?.positions;
    let named = w.soft.get(id)?.read(part);
    let folded = |i: usize| {
        let xs = named.iter().map(|p| positions[*p][i]);
        match fold {
            Reduce::Sum => xs.sum(),
            Reduce::Mean => xs.sum::<f64>() / named.len() as f64,
            Reduce::Max => xs.fold(f64::NEG_INFINITY, f64::max),
        }
    };
    Some((0..3).map(folded).collect())
}

/// After a step of `b`: each valued output's value onto its list in `values`.
pub fn take(
    b: &impl Backend,
    w: &World,
    joints: &[JointState],
    walkers: &[CharacterState],
    values: &mut BTreeMap<String, Vec<Vec<f64>>>,
) {
    if !w.outputs.values().any(Output::valued) {
        return;
    }
    let s = b.read();
    for (id, o) in w.outputs.iter().filter(|(_, o)| o.valued()) {
        let v = value(o, w, &s, joints, walkers).unwrap_or_else(|| vec![f64::NAN]);
        values.entry(id.clone()).or_default().push(v);
    }
}

/// A value as a series holds it: a number, a vector, or a joint's `{force, torque}`.
fn held(read: Read, v: Vec<f64>) -> Value {
    match shown(read, v).as_slice() {
        [force, torque] if read == Read::JointForce => json!({"force": force, "torque": torque}),
        [x] => json!(x),
        v => json!(v),
    }
}

/// Each valued output's series into a bake's `outputs` (Bake), and its bytes into their hash.
/// `values[id][k]` is output `id`'s value after step k, the built state's at 0. An output that
/// writes `sample`, `average` or `keep` has the rows a series that takes it reads at the bake's
/// last step, `{t, v}`: one every `sample` steps, `t` the flicks of the step it ends at and `v`
/// the mean of the read over the `average` steps that end there, and only those of the last
/// `keep`; with a `to`, what it writes there at each frame is under `written`. Any other has one
/// value a frame of `frame` flicks, the two steps around the frame mixed, or the earlier with
/// `hold`.
pub fn series(
    outputs: &mut Value,
    w: &World,
    values: &BTreeMap<String, Vec<Vec<f64>>>,
    frame: i64,
) {
    let step = step_flicks(w);
    let hash = outputs["hash"].as_str().unwrap_or_default().to_string();
    let mut bytes = hash.into_bytes();
    for (id, at) in values {
        let Some(o) = w.outputs.get(id) else {
            continue;
        };
        let end = (at.len() as i64 - 1) * step;
        let frames = || -> Vec<Value> {
            (0..)
                .map(|j: i64| j * frame)
                .take_while(|t| *t <= end)
                .map(|t| {
                    let (s, rem) = ((t / step) as usize, t % step);
                    let v = match rem {
                        0 => at[s].clone(),
                        _ if o.hold => at[s].clone(),
                        _ => mixed(o.read, &at[s], &at[s + 1], rem as f64 / step as f64),
                    };
                    held(o.read, v)
                })
                .collect()
        };
        let series = match &o.sampled {
            None => frames(),
            Some(sampled) => {
                if o.to.is_some() {
                    outputs["written"][id] = Value::Array(frames());
                }
                (1..)
                    .map(|i| i * sampled.every as usize)
                    .take_while(|k| *k < at.len())
                    .filter(|k| {
                        sampled
                            .keep
                            .is_none_or(|keep| *k as i64 * step > end - keep)
                    })
                    .map(|k| {
                        let first = (k + 1).saturating_sub(sampled.average as usize).max(1);
                        let v = held(o.read, mean(o.read, &at[first..=k]));
                        json!({"t": k as i64 * step, "v": v})
                    })
                    .collect()
            }
        };
        let series = Value::Array(series);
        bytes.extend_from_slice(id.as_bytes());
        bytes.extend_from_slice(series.to_string().as_bytes());
        outputs["series"][id] = series;
    }
    if !values.is_empty() {
        outputs["hash"] = json!(sha256_hex(&bytes));
    }
}

/// What output `oid` writes at each frame, from its bake's `reply`: its series, or for an output
/// a series samples, the frames kept beside its rows.
pub fn frames<'r>(reply: &'r Value, oid: &str) -> &'r [Value] {
    let outputs = &reply["outputs"];
    let frames = outputs["written"]
        .get(oid)
        .unwrap_or(&outputs["series"][oid]);
    frames.as_array().map_or(&[], Vec::as_slice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::BodyState;
    use crate::doc::Sampled;

    fn doc(outputs: Value) -> Value {
        json!({"kind": "physics.world@1",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.1}}, "contact_materials": {"m": {"density": 100}},
            "bodies": {"ball": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}]}},
            "outputs": outputs})
    }

    fn world(outputs: Value) -> World {
        crate::doc::read(&doc(outputs)).expect("the world reads")
    }

    fn state(rot: [f64; 4], linear: [f64; 3]) -> State {
        let ball = BodyState {
            id: "ball".into(),
            pos: [0.0, 1.0, 0.0],
            rot,
            linear,
            angular: [0.0; 3],
            contact_impulse: 0.0,
            sleeping: false,
            mass: 2.0,
            energy: 7.5,
            contacts: 3,
        };
        State {
            step: 0,
            bodies: vec![ball],
            soft: Vec::new(),
        }
    }

    /// Each read #2248 gives a series: a body's angle as degrees about X, Y and Z, its contact
    /// count, its energy, its speed and its mass, and an expr over two of them.
    #[test]
    fn each_read_is_the_bodys_own_after_the_step() {
        let w = world(json!({
            "turn": {"from": "ball", "read": "angle"},
            "touch": {"from": "ball", "read": "contact_count"},
            "joules": {"from": "ball", "read": "energy"},
            "ke": {"expr": "0.5 * m * v * v", "unit": "J",
                   "reads": {"v": {"from": "ball", "read": "speed"}, "m": {"from": "ball", "read": "mass"}}},
        }));
        // A quarter turn about +Z, moving at 5 m/s.
        let h = std::f64::consts::FRAC_1_SQRT_2;
        let s = state([0.0, 0.0, h, h], [3.0, -4.0, 0.0]);
        let of = |id: &str| {
            let o = &w.outputs[id];
            shown(o.read, value(o, &w, &s, &[], &[]).expect("a value"))
        };
        let turn = of("turn");
        assert!(turn[0].abs() < 1e-9 && turn[1].abs() < 1e-9 && (turn[2] - 90.0).abs() < 1e-9);
        assert_eq!(of("touch"), [3.0]);
        assert_eq!(of("joules"), [7.5]);
        assert_eq!(of("ke"), [25.0], "half of 2 kg times 5 m/s squared");
    }

    /// A row every `sample` steps, each the mean over the `average` steps that end at it, and
    /// with `keep` only those of its last flicks; a frame between two steps mixes them, or holds
    /// the earlier.
    #[test]
    fn rows_average_the_steps_that_end_at_them_and_frames_mix_two_steps() {
        let mut w = world(json!({"fall": {"from": "ball", "read": "speed"}}));
        let step = step_flicks(&w);
        let values = BTreeMap::from([(
            "fall".to_string(),
            (0..=8).map(|k| vec![f64::from(k)]).collect(),
        )]);
        let run = |w: &World, frame: i64| {
            let mut outputs = json!({"hash": "", "series": {}});
            series(&mut outputs, w, &values, frame);
            outputs["series"]["fall"].clone()
        };
        assert_eq!(
            run(&w, step * 3 / 2)[1],
            json!(1.5),
            "linear between steps 1 and 2"
        );
        w.outputs.get_mut("fall").expect("the output").hold = true;
        assert_eq!(
            run(&w, step * 3 / 2)[1],
            json!(1.0),
            "hold shows the earlier step"
        );
        let mut sample = |average, keep| {
            let sampled = Sampled {
                every: 4,
                average,
                keep,
            };
            w.outputs.get_mut("fall").expect("the output").sampled = Some(sampled);
            run(&w, step)
        };
        let rows = |v: [(i64, f64); 2]| json!(v.map(|(k, v)| json!({"t": k * step, "v": v})));
        assert_eq!(sample(1, None), rows([(4, 4.0), (8, 8.0)]));
        assert_eq!(
            sample(4, None),
            rows([(4, 2.5), (8, 6.5)]),
            "steps 1 to 4, and 5 to 8"
        );
        assert_eq!(
            sample(6, None),
            rows([(4, 2.5), (8, 5.5)]),
            "no step before the first"
        );
        assert_eq!(
            sample(4, Some(4 * step)),
            json!([{"t": 8 * step, "v": 6.5}])
        );
    }

    /// `reduce` folds the particles a `from` names, a soft body's or its `#pins`, into their
    /// sum, mean or max, part by part.
    #[test]
    fn reduce_folds_the_particles_a_from_names() {
        let rope = json!({"shape": "rope", "from": [0, 2, 0], "to": [3, 2, 0], "particles": 4, "edges": "chain",
            "masses": {"default": 0.05}, "pins": ["0", "3"]});
        let fold = |from: &str, reduce: &str| json!({"from": from, "read": "particle_positions", "reduce": reduce});
        let doc = json!({"kind": "physics.world@1",
            "capacity": {"bodies": 0, "shapes": 0, "joints": 0, "contacts": 0, "particles": 4},
            "soft": {"rope": rope},
            "outputs": {"sum": fold("rope", "sum"), "mean": fold("rope", "mean"), "max": fold("rope#pins", "max")}});
        let w = crate::doc::read(&doc).expect("the world reads");
        let positions = vec![
            [0.0, 2.0, 0.0],
            [1.0, 1.0, 0.0],
            [2.0, 0.5, 0.0],
            [3.0, 2.0, -1.0],
        ];
        let soft = crate::backend::SoftState {
            id: "rope".into(),
            velocities: vec![[0.0; 3]; 4],
            positions,
        };
        let s = State {
            step: 1,
            bodies: Vec::new(),
            soft: vec![soft],
        };
        let of = |id: &str| value(&w.outputs[id], &w, &s, &[], &[]).expect("a value");
        assert_eq!(of("sum"), [6.0, 5.5, -1.0]);
        assert_eq!(of("mean"), [1.5, 1.375, -0.25]);
        assert_eq!(of("max"), [3.0, 2.0, 0.0], "of the two pinned ends");
    }

    /// The reader takes `sample`, `average` and `keep` as steps and a duration, and refuses, each
    /// at its field: an expr that names no read of its output's, reads with no expr, a series
    /// of a pose, a fold of one value, half a step and a keep that is no duration.
    #[test]
    fn the_reader_takes_the_fields_and_refuses_what_has_no_one_value() {
        let fall =
            json!({"from": "ball", "read": "velocity", "sample": 12, "average": 3, "keep": "0.5s"});
        let sampled = Sampled {
            every: 12,
            average: 3,
            keep: Some(352_800_000),
        };
        assert_eq!(
            world(json!({"o": fall})).outputs["o"].sampled,
            Some(sampled)
        );
        let refused = |output: Value| -> Vec<String> {
            let e = crate::doc::read(&doc(json!({"o": output}))).expect_err("a refusal");
            e.into_iter().map(|r| r.path).collect()
        };
        let speed = json!({"v": {"from": "ball", "read": "speed"}});
        for (output, path) in [
            (
                json!({"expr": "0.5 * m * v * v", "unit": "J"}),
                "outputs/o/expr",
            ),
            (
                json!({"expr": "0.5 * m * v", "reads": speed}),
                "outputs/o/expr",
            ),
            (json!({"expr": "2 + 3", "reads": speed}), "outputs/o/expr"),
            (json!({"reads": speed}), "outputs/o/expr"),
            (
                json!({"expr": "v", "reads": {"v": {"from": "ball", "read": "pose"}}}),
                "outputs/o/reads/v/read",
            ),
            (
                json!({"expr": "v", "reads": {"v": {"from": "gone", "read": "speed"}}}),
                "outputs/o/reads/v/from",
            ),
            (
                json!({"expr": "v", "reads": speed, "from": "ball"}),
                "outputs/o/from",
            ),
            (
                json!({"from": "ball", "read": "pose", "sample": 2}),
                "outputs/o/sample",
            ),
            (
                json!({"from": "ball", "read": "velocity", "reduce": "sum"}),
                "outputs/o/reduce",
            ),
            (
                json!({"from": "ball", "read": "velocity", "sample": 1.5}),
                "outputs/o/sample",
            ),
            (
                json!({"from": "ball", "read": "velocity", "keep": "soon"}),
                "outputs/o/keep",
            ),
        ] {
            assert!(
                refused(output.clone()).iter().any(|p| p == path),
                "{output} at {path}"
            );
        }
    }
}
