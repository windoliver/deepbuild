//! #2098: what a wind blows (Force: `wind`), in pinned f64 math, so every backend and machine
//! reads it alike. The wind at a time and a place is its velocity there, times 1 + its gust's
//! amplitude × the closed function list's `noise` at the place moved upwind by the gust's speed ×
//! t and divided by its scale. Its `aero_triangles` coupling pushes each triangle of a body's
//! boxes, two a face, along its normal by coefficient × its area × the part along that normal of
//! the wind at its centroid less the body's velocity there, at that centroid.

use deep_canvas::ops;

use crate::backend::rotate;
use crate::doc::{Body, BodyKind, Force, ForceKind, Refusal, Shape, Wind, World};

type V3 = [f64; 3];

/// The noise a gust reads: the closed function list's, or a planted one.
pub type Noise = fn(&[f64], u32) -> f64;
/// The closed function list's `noise(p, seed)`: gradient noise on the integer lattice hash.
pub const NOISE: Noise = deep_canvas::expr::noise::noise;

/// The time of the state after `step` steps of `step_flicks` flicks each, s.
pub fn seconds(step: u64, step_flicks: i64) -> f64 {
    (step as i64 * step_flicks) as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// One triangle of a body's surface, in the body's frame: its centroid, m, its unit normal and
/// its area, m².
#[derive(Clone, Debug, PartialEq)]
pub struct Triangle {
    pub at: V3,
    pub normal: V3,
    pub area: f64,
}

/// The 12 triangles of a box of half extents `half`, two a face, placed at `pos` and turned by
/// `rot` (`[x, y, z, w]`) in its body's frame.
pub fn faces(half: V3, pos: V3, rot: [f64; 4]) -> Vec<Triangle> {
    let place = |v: V3| {
        let r = rotate(rot, v);
        [0, 1, 2].map(|k| pos[k] + r[k])
    };
    let mut out = Vec::new();
    for axis in 0..3 {
        let (j, k) = ((axis + 1) % 3, (axis + 2) % 3);
        for side in [-1.0, 1.0] {
            let mut normal = [0.0; 3];
            normal[axis] = side;
            // The face's two triangles meet along a diagonal; each centroid is a third of the
            // way from the face's centre to a corner off it.
            for corner in [-1.0, 1.0] {
                let mut at = [0.0; 3];
                at[axis] = side * half[axis];
                at[j] = corner * half[j] / 3.0;
                at[k] = -corner * half[k] / 3.0;
                out.push(Triangle {
                    at: place(at),
                    normal: rotate(rot, normal),
                    area: 2.0 * half[j] * half[k],
                });
            }
        }
    }
    out
}

/// The shape of `b`'s first solid shape use that isn't a box, if one isn't.
fn unboxed<'a>(w: &World, b: &'a Body) -> Option<&'a str> {
    let mut solid = b.shapes.iter().filter(|u| !u.sensor);
    let odd = solid.find(|u| !matches!(w.shapes.get(&u.shape), Some(Shape::Box { .. })));
    odd.map(|u| u.shape.as_str())
}

/// A wind on a body it can't push yet, refused at the body's place in `applies_to`: a body with a
/// solid shape that isn't a box, and a vehicle body, whose controller owns its torque.
pub fn uncaught(w: &World) -> Vec<Refusal> {
    let mut out = Vec::new();
    let winds = w.forces.iter();
    for (id, f) in winds.filter(|(_, f)| matches!(f.kind, ForceKind::Wind(_))) {
        for (i, name) in f.applies_to.iter().enumerate() {
            let b = &w.bodies[name];
            let why = match unboxed(w, b) {
                _ if b.kind != BodyKind::Dynamic => continue,
                _ if b.vehicle.is_some() => "is a vehicle body".to_string(),
                Some(shape) => format!("holds {shape}, which isn't a box"),
                None => continue,
            };
            out.push(Refusal {
                code: "physics.unsupported",
                path: format!("forces/{id}/applies_to/{i}"),
                actual: name.as_str().into(),
                what: format!("wind {id} can't push {name}, which {why}: aero_triangles pushes the faces of a plain body's boxes so far; #2098's follow-up brings the rest"),
            });
        }
    }
    out
}

/// The wind's velocity at `t` s and `p` m, its gust in it, m/s.
pub fn at(w: &Wind, t: f64, p: V3, noise: Noise) -> V3 {
    let v = w.velocity.at(t, p);
    let speed = ops::sqrt(dot(v, v));
    let Some(g) = w.gust.as_ref().filter(|_| speed > 0.0) else {
        return v;
    };
    let q = [0, 1, 2].map(|k| (p[k] - v[k] / speed * g.speed * t) / g.scale);
    let gain = 1.0 + g.amplitude * noise(&q, w.seed);
    v.map(|x| x * gain)
}

/// A body as a step finds it: its position, m, and rotation `[x, y, z, w]`, its centre of mass,
/// m, and its velocity, m/s and rad/s.
#[derive(Clone, Debug, PartialEq)]
pub struct Seen {
    pub pos: V3,
    pub rot: [f64; 4],
    pub com: V3,
    pub linear: V3,
    pub angular: V3,
}

/// The force, N, and the torque about its centre of mass, N·m, that `f`, a wind, puts at `t` s on
/// the body `seen` whose triangles are `on`: each triangle's push summed in order, before the
/// force's `strength`. Zero for a force that isn't a wind.
pub fn push(f: &Force, t: f64, seen: &Seen, on: &[Triangle], noise: Noise) -> (V3, V3) {
    let (mut force, mut torque) = ([0.0; 3], [0.0; 3]);
    let ForceKind::Wind(w) = &f.kind else {
        return (force, torque);
    };
    for tri in on {
        let r = rotate(seen.rot, tri.at);
        let c = [0, 1, 2].map(|k| seen.pos[k] + r[k]);
        let arm = [0, 1, 2].map(|k| c[k] - seen.com[k]);
        let (n, spin) = (rotate(seen.rot, tri.normal), cross(seen.angular, arm));
        let wind = at(w, t, c, noise);
        let rel = [0, 1, 2].map(|k| wind[k] - seen.linear[k] - spin[k]);
        let size = w.coefficient * tri.area * dot(rel, n);
        let p = n.map(|x| x * size);
        let turn = cross(arm, p);
        for k in 0..3 {
            force[k] += p[k];
            torque[k] += turn[k];
        }
    }
    (force, torque)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::caps::RAPIER3D;
    use crate::check::check;
    use crate::roles::TABLE;

    /// A world of one 1 m cube `vane` under the wind `wind` writes.
    fn world(wind: serde_json::Value, shape: serde_json::Value) -> Result<World, Vec<Refusal>> {
        let doc = json!({
            "kind": "physics.world@1", "seed": 5,
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "shapes": {"s": shape},
            "bodies": {"vane": {"kind": "dynamic", "shapes": [{"shape": "s"}], "mass": 1}},
            "forces": {"wind": {"kind": {"wind": wind}, "applies_to": ["vane"]}}
        });
        check(&doc, &RAPIER3D, &TABLE)
    }

    fn cube() -> serde_json::Value {
        json!({"kind": "box", "half": [0.5, 0.5, 0.5]})
    }

    fn still() -> Seen {
        Seen {
            pos: [0.0; 3],
            rot: [0.0, 0.0, 0.0, 1.0],
            com: [0.0; 3],
            linear: [0.0; 3],
            angular: [0.0; 3],
        }
    }

    fn near(a: V3, b: V3) -> bool {
        (0..3).all(|k| (a[k] - b[k]).abs() < 1e-12)
    }

    #[test]
    fn a_steady_wind_pushes_both_faces_across_it_and_slows_a_spin() {
        let coupling = json!({"kind": "aero_triangles", "coefficient": 3});
        let w = world(json!({"velocity": [2, 0, 0], "coupling": coupling}), cube()).unwrap();
        let (f, on) = (
            &w.forces["wind"],
            faces([0.5; 3], [0.0; 3], [0.0, 0.0, 0.0, 1.0]),
        );
        assert_eq!(on.len(), 12);
        // 3 kg/(m²·s) × the two 1 m² faces across x × 2 m/s, and no turn.
        let (force, torque) = push(f, 0.0, &still(), &on, NOISE);
        assert!(
            near(force, [12.0, 0.0, 0.0]) && near(torque, [0.0; 3]),
            "{force:?} {torque:?}"
        );
        // Moving with the wind it feels none; faster, it is held back.
        let with = |v: f64| Seen {
            linear: [v, 0.0, 0.0],
            ..still()
        };
        assert!(near(push(f, 0.0, &with(2.0), &on, NOISE).0, [0.0; 3]));
        assert!(near(
            push(f, 0.0, &with(3.0), &on, NOISE).0,
            [-6.0, 0.0, 0.0]
        ));
        // A spin about z in still air: each face across x and y turns against it. Two triangles a
        // face also lean that drag toward the faces' diagonals, so it is held along z alone.
        let calm = json!({"velocity": [0, 0, 0], "coupling": coupling});
        let w = world(calm, cube()).unwrap();
        let spun = Seen {
            angular: [0.0, 0.0, 1.0],
            ..still()
        };
        let (force, torque) = push(&w.forces["wind"], 0.0, &spun, &on, NOISE);
        assert!(near(force, [0.0; 3]) && torque[2] < -0.1, "{torque:?}");
    }

    #[test]
    fn a_velocity_reads_t_and_p_and_a_gust_scales_it_by_the_lattice_noise() {
        let coupling = json!({"kind": "aero_triangles", "coefficient": 1});
        let field = json!({"velocity": "vec3(t, p.y * 2, 0)", "coupling": coupling});
        let w = world(field, cube()).unwrap();
        let ForceKind::Wind(wind) = &w.forces["wind"].kind else {
            panic!()
        };
        assert_eq!(at(wind, 3.0, [9.0, 4.0, 1.0], NOISE), [3.0, 8.0, 0.0]);
        let gust = json!({"amplitude": 0.5, "scale": 2, "speed": 4});
        let gusty = json!({"velocity": [2, 0, 0], "gust": gust, "coupling": coupling});
        let w = world(gusty, cube()).unwrap();
        let ForceKind::Wind(wind) = &w.forces["wind"].kind else {
            panic!()
        };
        // The world's seed, since the wind writes none; the place moved 4 m/s upwind, over 2 m.
        let (t, p) = (1.5, [1.0, 0.25, -3.0]);
        let n = NOISE(&[(1.0 - 4.0 * 1.5) / 2.0, 0.125, -1.5], 5);
        assert!(n != 0.0);
        assert_eq!(at(wind, t, p, NOISE), [2.0 * (1.0 + 0.5 * n), 0.0, 0.0]);
        assert_eq!(seconds(180, 5_880_000), 1.5);
    }

    #[test]
    fn a_wind_is_refused_where_it_is_not_written_whole_or_cannot_push() {
        let coupling = json!({"kind": "aero_triangles", "coefficient": 1});
        let paths = |r: Result<World, Vec<Refusal>>| -> Vec<String> {
            r.err()
                .unwrap_or_default()
                .into_iter()
                .map(|r| r.path)
                .collect()
        };
        let steady = json!({"velocity": [2, 0, 0], "coupling": coupling});
        assert_eq!(paths(world(steady.clone(), cube())), Vec::<String>::new());
        let ball = json!({"kind": "sphere", "radius": 0.5});
        assert_eq!(paths(world(steady, ball)), ["forces/wind/applies_to/0"]);
        let bad = [
            (json!({"coupling": coupling}), "forces/wind/kind/velocity"),
            (
                json!({"velocity": "vec3(q, 0, 0)", "coupling": coupling}),
                "forces/wind/kind/velocity",
            ),
            (
                json!({"velocity": "t", "coupling": coupling}),
                "forces/wind/kind/velocity",
            ),
            (
                json!({"velocity": "vec3(1 / t, 0, 0)", "coupling": coupling}),
                "forces/wind/kind/velocity",
            ),
            (
                json!({"velocity": [2, 0, 0]}),
                "forces/wind/kind/coupling/kind",
            ),
            (
                json!({"velocity": [2, 0, 0], "coupling": coupling, "gust": {"amplitude": 1, "speed": 1}}),
                "forces/wind/kind/gust/scale",
            ),
            (
                json!({"velocity": [2, 0, 0], "coupling": coupling, "seed": -1}),
                "forces/wind/kind/seed",
            ),
        ];
        for (wind, path) in bad {
            assert_eq!(paths(world(wind, cube()))[0], path);
        }
    }
}
