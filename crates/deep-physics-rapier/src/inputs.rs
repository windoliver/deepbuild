//! Issue #522: the inputs a step applies at its start, in the order the track gives them (canvas
//! primitives: Input track entries). A launch sets its body's velocities; a poke is an impulse,
//! or with `push` a velocity change, at a point or the body's center; a grab is a spring force
//! the wrapper adds each step toward the point its moves set, never a joint, until its release.
//! A held grab is wrapper state, so it rides in the checkpoint after the world's own bytes.

use std::collections::BTreeMap;
use std::f32::consts::PI;

use deep_canvas_physics::backend::Input;
use deep_canvas_physics::doc::Refusal;
use rapier3d::prelude::*;
use serde_json::{json, Value};

use crate::{refusal, spring, v3, Rapier};

/// The tag that starts the held grabs a checkpoint carries after the world's bytes.
const GRABS: &[u8] = b"deep.grabs@1";

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

fn num(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

impl Rapier {
    /// Applies each of a step's inputs, in order, or refuses one that names no body.
    pub(crate) fn apply(&mut self, inputs: &[Input]) -> Result<(), Box<Refusal>> {
        for i in inputs {
            let Some(h) = self.handle_of(&i.target) else {
                let what = format!(
                    "the input {} targets {}, which this world has no body for",
                    i.kind, i.target
                );
                return Err(Box::new(refusal(
                    "ref_unresolved",
                    "inputs/target".into(),
                    json!(i.target),
                    what,
                )));
            };
            let d = &i.data;
            match i.kind.as_str() {
                "launch" => {
                    let rb = &mut self.world.bodies[h];
                    rb.set_linvel(v3(vec(d, "linear").unwrap_or_default()), true);
                    rb.set_angvel(
                        v3(vec(d, "angular").unwrap_or_default()) * (PI / 180.0),
                        true,
                    );
                }
                "poke" => {
                    let rb = &mut self.world.bodies[h];
                    let impulse = match vec(d, "push") {
                        Some(push) => v3(push) * rb.mass(),
                        None => v3(vec(d, "impulse").unwrap_or_default()),
                    };
                    match vec(d, "point") {
                        Some(p) => rb.apply_impulse_at_point(impulse, v3(p), true),
                        None => rb.apply_impulse(impulse, true),
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
