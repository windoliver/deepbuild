//! Issue #522: the inputs a step applies at its start, in the order the track gives them (canvas
//! primitives: Input track entries). A launch sets its body's velocities; a poke is an impulse,
//! or with `push` a velocity change, at a point or the body's center; a grab is a spring force
//! the wrapper adds each step toward the point its moves set, never a joint, until its release.
//! A held grab is wrapper state, so it rides in the checkpoint after the world's own bytes.
//!
//! Issue #2371: a `set` gives the force it targets its strength from its step on, wrapper state a
//! checkpoint carries too; `activate` enables and wakes its body and its colliders, `deactivate`
//! puts it to sleep and disables them; a `blast` is an impulse on its target where a shape of it
//! is within `radius` of `at`, `impulse_per_length` times that shape's width (the diameter of
//! its bounding sphere), away from `at`, at the shape's nearest point; a poke by `address` lands
//! on that anchor where it is now, and one with a `radius` reaches its target as a blast does.
//! Past the radius either falls linearly to nothing over `falloff` m.

use std::collections::BTreeMap;
use std::f32::consts::PI;

use deep_canvas_physics::backend::Input;
use deep_canvas_physics::doc::{Refusal, Rot};
use rapier3d::math::Pose;
use rapier3d::prelude::*;
use serde_json::{json, Value};

use crate::{refusal, rotation, spring, v3, Rapier};

/// The tag that starts the held grabs a checkpoint carries after the world's bytes.
const GRABS: &[u8] = b"deep.grabs@1";

/// #2371: the tag that starts the strengths inputs set, which a checkpoint carries before them.
const STRENGTHS: &[u8] = b"deep.strengths@1";

/// #2371: how much of an impulse reaches a shape `gap` m from its point: all of it within
/// `radius`, none from `radius + falloff` on, and in between what is left of the falloff.
fn reach(gap: f32, radius: f64, falloff: f64) -> f32 {
    let (radius, falloff) = (radius as f32, falloff as f32);
    if gap <= radius {
        1.0
    } else if gap < radius + falloff {
        (radius + falloff - gap) / falloff
    } else {
        0.0
    }
}

/// A held grab: the body's local point it holds, the point it pulls toward, and its spring.
#[derive(Clone, Debug, PartialEq)]
pub struct Grab {
    pub local: [f64; 3],
    pub to: [f64; 3],
    pub hz: f64,
    pub damping_ratio: f64,
    pub max_accel: f64,
}

fn vec(v: &Value, key: &str) -> Option<[f64; 3]> {
    let a = v.get(key)?.as_array()?;
    Some([
        a.first()?.as_f64()?,
        a.get(1)?.as_f64()?,
        a.get(2)?.as_f64()?,
    ])
}

/// A launch's `from` (#540): a position `[x, y, z]`, or a pose `{pos, rot}` whose rot is a
/// quaternion or degrees, as the world reader checked it; none without one.
fn from(v: &Value) -> Option<([f64; 3], Option<Rot>)> {
    let f = v.get("from")?;
    if f.is_array() {
        return Some((vec(v, "from")?, None));
    }
    let pos = vec(f, "pos").unwrap_or_default();
    let rot = f.get("rot").and_then(Value::as_array).and_then(|r| {
        let n: Vec<f64> = r.iter().filter_map(Value::as_f64).collect();
        match n.as_slice() {
            [x, y, z, w] => Some(Rot::Quat([*x, *y, *z, *w])),
            [x, y, z] => Some(Rot::Deg([*x, *y, *z])),
            _ => None,
        }
    });
    Some((pos, rot))
}

fn num(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

/// #251: the refusal of a vehicle's input on a body that isn't one.
fn not_vehicle(i: &Input) -> Box<Refusal> {
    let what = format!(
        "{} moves a vehicle body, and {} isn't one",
        i.kind, i.target
    );
    Box::new(refusal(
        "physics.not_vehicle",
        "inputs/target".into(),
        json!(i.target),
        what,
    ))
}

/// The refusal of an input whose target the world has no body, or for a `set` no force, for.
fn no_target(i: &Input, what: &str) -> Box<Refusal> {
    let what = format!(
        "the input {} targets {}, which this world has no {what} for",
        i.kind, i.target
    );
    Box::new(refusal(
        "ref_unresolved",
        "inputs/target".into(),
        json!(i.target),
        what,
    ))
}

impl Rapier {
    /// #2371: the point of each of body `h`'s shapes nearest `p`, `p` itself inside one, with
    /// the shape's width.
    fn nearest(&self, h: RigidBodyHandle, p: Vector) -> Vec<(Vector, f32)> {
        let shapes = self.world.bodies[h].colliders().iter();
        shapes
            .map(|c| {
                let c = &self.world.colliders[*c];
                let near = c.shape().project_point(c.position(), p, true).point;
                let width = 2.0 * c.shape().compute_local_bounding_sphere().radius();
                (near, width)
            })
            .collect()
    }

    /// Applies each of a step's inputs, in order, or refuses one that names no body.
    pub(crate) fn apply(&mut self, inputs: &[Input]) -> Result<(), Box<Refusal>> {
        for i in inputs {
            let d = &i.data;
            // #2371: a set's target is a force, which has its strength from this step on.
            if i.kind == "set" {
                let force = self.forces.iter_mut().find(|(id, _)| *id == i.target);
                let Some((_, f)) = force else {
                    return Err(no_target(i, "force"));
                };
                f.strength = num(d, "value");
                continue;
            }
            let Some(h) = self.handle_of(&i.target) else {
                return Err(no_target(i, "body"));
            };
            // #182: a character body's move, jump, launch, place and crouch.
            if self.character_input(&i.kind, &i.target, d) {
                continue;
            }
            match i.kind.as_str() {
                "launch" => {
                    let rb = &mut self.world.bodies[h];
                    // #540: a launch with `from` first places its body there, keeping its
                    // rotation unless the pose gives one; the velocities it sets next replace
                    // the body's own.
                    if let Some((pos, rot)) = from(d) {
                        let rot = rot.map_or(*rb.rotation(), |r| rotation(&r));
                        rb.set_position(Pose::from_parts(v3(pos), rot), true);
                    }
                    rb.set_linvel(v3(vec(d, "linear").unwrap_or_default()), true);
                    rb.set_angvel(
                        v3(vec(d, "angular").unwrap_or_default()) * (PI / 180.0),
                        true,
                    );
                }
                "poke" => {
                    let at = match d.get("address").and_then(Value::as_str) {
                        Some(address) => {
                            let Some((body, local)) = self.anchors.get(address) else {
                                let what =
                                    format!("the poke's address {address} names no body's anchor");
                                return Err(Box::new(refusal(
                                    "ref_unresolved",
                                    "inputs/data/address".into(),
                                    json!(address),
                                    what,
                                )));
                            };
                            Some(self.world.bodies[*body].position() * v3(*local))
                        }
                        None => vec(d, "point").map(v3),
                    };
                    let scale = match (at, d.get("radius").and_then(Value::as_f64)) {
                        (Some(p), Some(radius)) => {
                            let gaps = self
                                .nearest(h, p)
                                .into_iter()
                                .map(|(q, _)| (q - p).length());
                            let gap = gaps.fold(f32::INFINITY, f32::min);
                            reach(gap, radius, num(d, "falloff"))
                        }
                        _ => 1.0,
                    };
                    let rb = &mut self.world.bodies[h];
                    let impulse = match vec(d, "push") {
                        Some(push) => v3(push) * rb.mass(),
                        None => v3(vec(d, "impulse").unwrap_or_default()),
                    } * scale;
                    match at {
                        Some(p) => rb.apply_impulse_at_point(impulse, p, true),
                        None => rb.apply_impulse(impulse, true),
                    }
                }
                "blast" => {
                    let at = v3(vec(d, "at").unwrap_or_default());
                    let (radius, falloff) = (num(d, "radius"), num(d, "falloff"));
                    let per = num(d, "impulse_per_length") as f32;
                    let reached = self.nearest(h, at);
                    let rb = &mut self.world.bodies[h];
                    for (near, width) in reached {
                        let scale = reach((near - at).length(), radius, falloff);
                        // A blast inside a shape pushes it from its body's centre of mass.
                        let from = if near == at {
                            rb.center_of_mass()
                        } else {
                            near
                        };
                        let away = (from - at).normalize_or_zero();
                        if scale > 0.0 {
                            rb.apply_impulse_at_point(away * (per * width * scale), from, true);
                        }
                    }
                }
                "grab" => {
                    let local = vec(d, "point").unwrap_or_default();
                    let at = self.world.bodies[h].position() * v3(local);
                    let g = Grab {
                        local,
                        to: [f64::from(at.x), f64::from(at.y), f64::from(at.z)],
                        hz: num(d, "hz"),
                        damping_ratio: num(d, "damping_ratio"),
                        max_accel: num(d, "max_accel"),
                    };
                    self.grabs.insert(i.target.clone(), g);
                }
                // A move with no grab held moves nothing.
                "move" => {
                    if let (Some(g), Some(to)) = (self.grabs.get_mut(&i.target), vec(d, "to")) {
                        g.to = to;
                    }
                }
                "release" => {
                    self.grabs.remove(&i.target);
                    if d.get("keeps_velocity") == Some(&json!(false)) {
                        let rb = &mut self.world.bodies[h];
                        rb.set_linvel(Vector::ZERO, true);
                        rb.set_angvel(Vector::ZERO, true);
                    }
                }
                // #191: the body and its colliders leave the world's steps; a sensor it was in
                // writes its exit on this step. #2371: it sleeps, so it reads still.
                "deactivate" => {
                    let rb = &mut self.world.bodies[h];
                    rb.sleep();
                    rb.set_enabled(false);
                }
                // #2371: the body and its colliders join the world's steps again, awake.
                "activate" => {
                    let rb = &mut self.world.bodies[h];
                    rb.set_enabled(true);
                    rb.wake_up(true);
                }
                // #251: a vehicle body holds each until its next.
                "drive" | "steer" | "brake" => {
                    let key = if i.kind == "steer" { "angle" } else { "force" };
                    if !self.vehicles.hold(&i.target, &i.kind, num(d, key)) {
                        return Err(not_vehicle(i));
                    }
                }
                // #251: the chassis set at the pose, still; its wheels back at rest, each that
                // touched writing its contact_end; the drive, steer and brake it holds kept.
                "place" => {
                    let Some((pos, rot)) = d.get("pose").and_then(|p| from(&json!({"from": p})))
                    else {
                        let what = format!("place on {} needs its pose", i.target);
                        return Err(Box::new(refusal(
                            "physics.missing_field",
                            "inputs/data/pose".into(),
                            d.clone(),
                            what,
                        )));
                    };
                    let Some(rows) = self.vehicles.place(&i.target, &self.uses) else {
                        return Err(not_vehicle(i));
                    };
                    self.wheel_rows.extend(rows);
                    let rb = &mut self.world.bodies[h];
                    let rot = rot.map_or(*rb.rotation(), |r| rotation(&r));
                    rb.set_position(Pose::from_parts(v3(pos), rot), true);
                    rb.set_linvel(Vector::ZERO, true);
                    if self.vehicles.plant != crate::VehiclePlant::PlaceKeepsAngular {
                        rb.set_angvel(Vector::ZERO, true);
                    }
                }
                other => {
                    let what = format!("the input {other} isn't run by this backend interface");
                    return Err(Box::new(refusal(
                        "physics.unsupported",
                        "inputs/kind".into(),
                        json!(other),
                        what,
                    )));
                }
            }
        }
        Ok(())
    }

    /// Adds each held grab's spring force for this step, at the point it holds, its acceleration
    /// capped at `max_accel`. Forces were reset by `push`, which runs first.
    pub(crate) fn pull(&mut self) {
        for (id, g) in &self.grabs {
            let Some(h) = self.handle_of(id) else {
                continue;
            };
            let rb = &mut self.world.bodies[h];
            // #2371: a deactivated body sleeps, and a grab held on it doesn't wake it.
            if rb.is_sleeping() && !rb.is_enabled() {
                continue;
            }
            let p = rb.position() * v3(g.local);
            let (k, c) = spring(g.hz, g.damping_ratio);
            let mut a = (v3(g.to) - p) * k - rb.velocity_at_point(p) * c;
            let max = g.max_accel as f32;
            if a.length() > max {
                a *= max / a.length();
            }
            let f = a * rb.mass();
            rb.add_force_at_point(f, p, true);
        }
    }

    /// #2371: the strength of each force an input sets, as the bytes a checkpoint carries after
    /// the character bodies'; none where no force names an input, so such a world checkpoints
    /// the bytes it always did.
    pub(crate) fn strength_bytes(&self) -> Vec<u8> {
        let set = self.forces.iter().filter(|(_, f)| f.set_by.is_some());
        let bits: BTreeMap<&String, u64> = set.map(|(id, f)| (id, f.strength.to_bits())).collect();
        if bits.is_empty() {
            return Vec::new();
        }
        let body = serde_json::to_vec(&bits).expect("strengths serialize");
        [STRENGTHS, &(body.len() as u64).to_le_bytes(), &body].concat()
    }

    /// Loads the strengths a checkpoint's bytes carry, and returns what follows them.
    pub(crate) fn strengths_of<'a>(&mut self, rest: &'a [u8]) -> &'a [u8] {
        let Some(after) = rest.strip_prefix(STRENGTHS) else {
            return rest;
        };
        let (len, after) = after.split_at(8.min(after.len()));
        let n = u64::from_le_bytes(len.try_into().unwrap_or([0; 8])) as usize;
        let (body, rest) = after.split_at(n.min(after.len()));
        let bits: BTreeMap<String, u64> = serde_json::from_slice(body).unwrap_or_default();
        for (id, f) in &mut self.forces {
            if let Some(b) = bits.get(id.as_str()) {
                f.strength = f64::from_bits(*b);
            }
        }
        rest
    }

    /// The held grabs as the bytes a checkpoint carries after the world's; none when none is
    /// held, so a world that takes no grab checkpoints the bytes it always did.
    pub(crate) fn grab_bytes(&self) -> Vec<u8> {
        if self.grabs.is_empty() {
            return Vec::new();
        }
        let held: BTreeMap<&String, Value> = self
            .grabs
            .iter()
            .map(|(id, g)| {
                (
                    id,
                    json!([g.local, g.to, g.hz, g.damping_ratio, g.max_accel]),
                )
            })
            .collect();
        let mut out = GRABS.to_vec();
        out.extend(serde_json::to_vec(&held).expect("grabs serialize"));
        out
    }

    /// The held grabs a checkpoint's bytes after the world carry.
    pub(crate) fn grabs_of(rest: &[u8]) -> BTreeMap<String, Grab> {
        let Some(body) = rest.strip_prefix(GRABS) else {
            return BTreeMap::new();
        };
        let held: BTreeMap<String, Vec<Value>> = serde_json::from_slice(body).unwrap_or_default();
        held.into_iter()
            .filter_map(|(id, g)| {
                let three = |v: &Value| {
                    Some([
                        v.get(0)?.as_f64()?,
                        v.get(1)?.as_f64()?,
                        v.get(2)?.as_f64()?,
                    ])
                };
                let grab = Grab {
                    local: three(g.first()?)?,
                    to: three(g.get(1)?)?,
                    hz: g.get(2)?.as_f64()?,
                    damping_ratio: g.get(3)?.as_f64()?,
                    max_accel: g.get(4)?.as_f64()?,
                };
                Some((id, grab))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use deep_canvas_physics::backend::{Backend, BodyState, Input, Targets};
    use deep_canvas_physics::caps::RAPIER3D;
    use serde_json::{json, Value};

    use crate::Rapier;

    /// A world of 1 kg bodies at `at`, each one shape `shape`, under gravity `g` and `forces`.
    fn world(shape: &str, at: &[(&str, [f64; 3])], g: f64, forces: Value) -> Rapier {
        let body = |pos: &[f64; 3]| {
            json!({"kind": "dynamic", "mass": 1, "pose": {"pos": pos},
            "shapes": [{"shape": shape, "contact_material": "m"}]})
        };
        let bodies: serde_json::Map<String, Value> =
            at.iter().map(|(id, p)| (id.to_string(), body(p))).collect();
        let doc = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4,
            "gravity": [0, g, 0], "mode": "dynamic",
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "contact_materials": {"m": {"density": 1000}},
            "shapes": {"bead": {"kind": "sphere", "radius": 0.05},
                       "crate": {"kind": "box", "half": [0.25, 0.25, 0.25]}},
            "bodies": bodies, "forces": forces
        });
        let table = &deep_canvas_physics::roles::TABLE;
        let w = deep_canvas_physics::check::check(&doc, &RAPIER3D, table)
            .unwrap_or_else(|e| panic!("{e:?}"));
        let mut b = Rapier::default();
        b.build(&w).unwrap();
        b
    }

    /// `steps` steps, the first with `inputs` as `(kind, target, data)`.
    fn run(b: &mut Rapier, inputs: &[(&str, &str, Value)], steps: usize) {
        let first: Vec<Input> = inputs
            .iter()
            .map(|(kind, target, data)| Input {
                kind: kind.to_string(),
                target: target.to_string(),
                data: data.clone(),
            })
            .collect();
        b.step(&first, &Targets::default()).unwrap();
        for _ in 1..steps {
            b.step(&[], &Targets::default()).unwrap();
        }
    }

    fn body(b: &Rapier, id: &str) -> BodyState {
        let all = b.read().bodies;
        all.into_iter().find(|s| s.id == id).unwrap()
    }

    /// A deactivated body sleeps where it is, whatever force or grab holds it, and an activated
    /// one is awake again: the one gravity alone pulls falls, the held one moves.
    #[test]
    fn a_deactivated_body_sleeps_until_it_is_activated() {
        let wind =
            json!({"wind": {"kind": {"uniform": {"accel": [3, 0, 0]}}, "applies_to": ["held"]}});
        let at = [("free", [2.0, 0.0, 0.0]), ("held", [0.0; 3])];
        let mut b = world("bead", &at, -9.81, wind);
        let grab = json!({"point": [0, 0, 0], "hz": 2, "damping_ratio": 0.6, "max_accel": 140});
        let to = json!({"to": [0, 0, 1]});
        run(&mut b, &[("grab", "held", grab), ("move", "held", to)], 5);
        assert!(body(&b, "held").linear[0] > 0.0 && body(&b, "free").linear[1] < 0.0);
        let off = [
            ("deactivate", "free", json!({})),
            ("deactivate", "held", json!({})),
        ];
        run(&mut b, &off, 1);
        let asleep = [body(&b, "free"), body(&b, "held")];
        for s in &asleep {
            assert!(s.sleeping && s.linear == [0.0; 3], "{s:?}");
        }
        run(&mut b, &[], 5);
        assert_eq!([body(&b, "free"), body(&b, "held")], asleep);
        let on = [
            ("activate", "free", json!({})),
            ("activate", "held", json!({})),
        ];
        run(&mut b, &on, 5);
        let (free, held) = (body(&b, "free"), body(&b, "held"));
        assert!(!free.sleeping && free.pos[1] < asleep[0].pos[1], "{free:?}");
        assert!(!held.sleeping && held.pos[0] > asleep[1].pos[0], "{held:?}");
    }

    /// A blast's impulse is whole within its radius, falls linearly over its falloff past it and
    /// reaches nothing beyond; a poke with a radius reaches its body the same way from its point.
    #[test]
    fn a_blast_and_a_poke_fall_off_past_their_radius() {
        // Beads of radius 0.05 m whose nearest points are 0.5 m, 1.25 m and 1.6 m from the blast.
        let at = [
            ("a", [0.55, 0.0, 0.0]),
            ("b", [0.0, 1.3, 0.0]),
            ("c", [0.0, 0.0, 1.65]),
        ];
        let mut b = world("bead", &at, 0.0, json!({}));
        let blast = json!({"at": [0, 0, 0], "radius": 1, "falloff": 0.5, "impulse_per_length": 1});
        let all = ["a", "b", "c"].map(|id| ("blast", id, blast.clone()));
        run(&mut b, &all, 1);
        // 1 N·s/m over a bead 0.1 m wide on 1 kg: 0.1 m/s, away from the blast.
        let speed = |id: &str, axis: usize| body(&b, id).linear[axis];
        assert!((speed("a", 0) - 0.1).abs() < 1e-5, "{}", speed("a", 0));
        assert!((speed("b", 1) - 0.05).abs() < 1e-5, "{}", speed("b", 1));
        assert_eq!(body(&b, "c").linear, [0.0; 3]);

        // A crate whose +x face is 0.5 m from the poke's point, poked 1 N·s along +y.
        let poked = |radius: Option<f64>, falloff: f64| {
            let mut b = world("crate", &[("crate", [0.0; 3])], 0.0, json!({}));
            let mut poke = json!({"point": [0.75, 0, 0], "impulse": [0, 1, 0], "falloff": falloff});
            if let Some(r) = radius {
                poke["radius"] = json!(r);
            }
            run(&mut b, &[("poke", "crate", poke)], 1);
            body(&b, "crate").linear[1]
        };
        assert!((poked(None, 0.0) - 1.0).abs() < 1e-6);
        assert!((poked(Some(1.0), 0.0) - 1.0).abs() < 1e-6);
        assert!((poked(Some(0.25), 0.5) - 0.5).abs() < 1e-5);
        assert_eq!(poked(Some(0.25), 0.25), 0.0);
    }
}
