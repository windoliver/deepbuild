//! #523: a joint's own state and readings beside its bodies' (Joint). A hinge's `joint_coordinate`
//! counts whole turns: its angle between its bodies, which wraps at ±180°, plus 360° a turn,
//! counted when a step's shortest signed change crosses the wrap. A joint's force is its locks' and
//! limits' impulses over the substep they came from, never its motor's. Its turns and its steps
//! past `breaks_at` live in its `user_data`, which the world's bytes carry, so a checkpoint keeps
//! them. A step that would turn a hinge 180° or more, or whose start finds a body past the speed
//! the backend caps, writes `fault {kind: speed_cap}` naming it, so no cap is silent.

use std::f32::consts::PI;

use deep_canvas_physics::backend::{hinge_angle, turn, JointState};
use deep_canvas_physics::doc::{JointKind, Read};
use deep_canvas_physics::occurrence::{code, Payload, Raw};
use rapier3d::prelude::*;

use crate::{Rapier, Twin};

/// Rapier's cap on a body's turn in one step (its solver's `MAX_ROTATION`), rad.
const MAX_TURN: f32 = PI / 4.0;

/// The steps a joint has spent past `breaks_at`: its `user_data`'s low 32 bits.
pub(crate) fn past(user_data: u128) -> u32 {
    user_data as u32
}

/// A hinge's whole turns: its `user_data`'s next 32 bits, signed.
pub(crate) fn turns(user_data: u128) -> i32 {
    (user_data >> 32) as u32 as i32
}

pub(crate) fn packed(past: u32, turns: i32) -> u128 {
    u128::from(past) | (u128::from(turns as u32) << 32)
}

/// What a step's start holds for its faults: each hinge's angle and its turn this step at its
/// bodies' velocities (deg), and each dynamic body's speed and turn rate.
#[derive(Default)]
pub(crate) struct Start {
    hinges: Vec<(ImpulseJointHandle, f64, f64)>,
    bodies: Vec<(usize, f32, f32)>,
}

/// A `fault {kind}` row naming `id`.
pub(crate) fn fault(id: &str, kind: &'static str) -> Raw {
    Raw {
        kind: code("fault").expect("a physics kind"),
        a: id.to_string(),
        a_use: None,
        b: None,
        b_use: None,
        payload: Payload::Fault { kind },
    }
}

impl Rapier {
    /// Hinge `h`'s angle between its bodies, deg in (−180, 180]: the twist of its second body's
    /// frame about its first's axis.
    fn angle(&self, h: ImpulseJointHandle) -> Option<f64> {
        let j = self.world.impulse_joints.get(h)?;
        let r = |b: RigidBodyHandle| Some(*self.world.bodies.get(b)?.rotation());
        let q1 = r(j.body1())? * j.data.local_frame1.rotation;
        let q2 = r(j.body2())? * j.data.local_frame2.rotation;
        let e = q1.inverse() * q2;
        Some(hinge_angle([e.x, e.y, e.z, e.w].map(f64::from)))
    }

    /// How far hinge `h`'s bodies turn it in one step at their velocities now, deg.
    fn turn_rate(&self, h: ImpulseJointHandle) -> Option<f64> {
        let j = self.world.impulse_joints.get(h)?;
        let (b1, b2) = (
            self.world.bodies.get(j.body1())?,
            self.world.bodies.get(j.body2())?,
        );
        let axis = *b1.rotation() * (j.data.local_frame1.rotation * Vector::X);
        let dt = self.world.integration_parameters.dt;
        Some(f64::from((b2.angvel() - b1.angvel()).dot(axis) * dt).to_degrees())
    }

    /// The step's start, after its inputs.
    pub(crate) fn start(&self) -> Start {
        let hinges = self
            .joints
            .iter()
            .filter(|(_, _, k)| *k == JointKind::Hinge)
            .filter_map(|(_, h, _)| Some((*h, self.angle(*h)?, self.turn_rate(*h)?)))
            .collect();
        let bodies = self
            .bodies
            .iter()
            .enumerate()
            .filter(|(_, (_, h))| self.world.bodies[*h].is_dynamic())
            .map(|(i, (_, h))| {
                let rb = &self.world.bodies[*h];
                (i, rb.linvel().length(), rb.angvel().length())
            })
            .collect();
        Start { hinges, bodies }
    }

    /// After the step: each hinge's turn counted, and the faults of each cap the step met.
    pub(crate) fn turned(&mut self, s: &Start) -> Vec<Raw> {
        let mut out = Vec::new();
        for (h, a0, rate) in &s.hinges {
            let Some(a1) = self.angle(*h) else { continue };
            let crossed = turn(*a0, a1);
            let id = self.joints.iter().find(|j| j.1 == *h).map(|j| j.0.clone());
            if rate.abs() >= 180.0 && self.twin != Twin::SpeedCapSilent {
                out.extend(id.as_deref().map(|id| fault(id, "speed_cap")));
            }
            if crossed != 0 {
                if let Some(j) = self.world.impulse_joints.get_mut(*h, false) {
                    let u = j.data.user_data;
                    j.data.user_data = packed(past(u), turns(u) + crossed);
                }
            }
        }
        let p = &self.world.integration_parameters;
        let (most, turn) = (p.max_linear_velocity(), MAX_TURN / p.dt);
        for (i, v0, w0) in &s.bodies {
            let (id, h) = &self.bodies[*i];
            let rb = &self.world.bodies[*h];
            let (v1, w1) = (rb.linvel().length(), rb.angvel().length());
            // Capped: it started past the cap, or the step carried it up to the cap from below. A
            // body that starts at the cap is in a cap it already wrote, so it writes no other.
            let at = |x: f32, cap: f32| x >= cap * (1.0 - 1e-4);
            let past = |x: f32, cap: f32| x > cap * (1.0 + 1e-4);
            let capped = past(*v0, most)
                || past(*w0, turn)
                || (at(v1, most) && !at(*v0, most))
                || (at(w1, turn) && !at(*w0, turn));
            if capped && self.twin != Twin::SpeedCapSilent {
                out.push(fault(id, "speed_cap"));
            }
        }
        out
    }

    /// Joint `h`'s force and torque after the step: its locks' and limits' impulses, never its
    /// motor's, over the substep they came from.
    pub(crate) fn load(&self, h: ImpulseJointHandle) -> Option<(f32, f32)> {
        let j = self.world.impulse_joints.get(h)?;
        // A broken or inactive joint holds nothing; Rapier keeps the impulses of its last step.
        if !j.data.is_enabled() {
            return Some((0.0, 0.0));
        }
        let p = &self.world.integration_parameters;
        let substep = match self.twin {
            Twin::ForcePerStep => p.dt,
            _ => p.dt / p.num_solver_iterations.max(1) as f32,
        };
        let i = |a: usize| j.impulses[a] + j.data.limits[a].impulse;
        let force = Vector::new(i(0), i(1), i(2)).length() / substep;
        let torque = Vector::new(i(3), i(4), i(5)).length() / substep;
        Some((force, torque))
    }

    /// Joint `h`'s `joint_coordinate`: a hinge's angle plus its turns, deg; a slider's travel, m.
    fn coordinate(&self, h: ImpulseJointHandle, kind: JointKind) -> Option<f64> {
        let j = self.world.impulse_joints.get(h)?;
        match kind {
            JointKind::Hinge => {
                let a = self.angle(h)?;
                let turns = match self.twin {
                    Twin::CoordinateWraps => 0,
                    _ => turns(j.data.user_data),
                };
                Some(a + 360.0 * f64::from(turns))
            }
            JointKind::Slider => {
                let b1 = self.world.bodies.get(j.body1())?.position();
                let b2 = self.world.bodies.get(j.body2())?.position();
                let f1 = *b1 * j.data.local_frame1;
                let f2 = *b2 * j.data.local_frame2;
                let axis = f1.rotation * Vector::X;
                Some(f64::from((f2.translation - f1.translation).dot(axis)))
            }
            _ => None,
        }
    }

    /// The planted twin's restore: every hinge's turn count dropped.
    pub(crate) fn drop_turns(&mut self) {
        for (_, h, _) in &self.joints {
            if let Some(j) = self.world.impulse_joints.get_mut(*h, false) {
                j.data.user_data = packed(past(j.data.user_data), 0);
            }
        }
    }

    /// Each watched output's reading now: a joint's coordinate, or its force.
    pub(crate) fn readings(&self) -> Vec<Option<f64>> {
        if self.watched.is_empty() {
            return Vec::new();
        }
        let states = self.joint_states();
        self.watched
            .iter()
            .map(|(_, joint, read, _)| {
                let s = states.iter().find(|s| &s.id == joint)?;
                match read {
                    Read::JointCoordinate => s.coordinate,
                    _ => Some(s.force),
                }
            })
            .collect()
    }

    /// The crossings the step just run wrote: each watched level its output's reading passed
    /// from `before`, at the time interpolated between the two steps, floored to a flick.
    pub(crate) fn crossings(&self, before: &[Option<f64>]) -> Vec<Raw> {
        let after = self.readings();
        let mut out = Vec::new();
        let h = self.step_flicks;
        let t0 = (self.step as i64 - 1) * h;
        for (((output, joint, _, levels), r0), r1) in self.watched.iter().zip(before).zip(&after) {
            let (Some(r0), Some(r1)) = (r0, r1) else {
                continue;
            };
            for level in levels {
                let direction = if *r0 < *level && *r1 >= *level {
                    1
                } else if *r0 > *level && *r1 <= *level {
                    -1
                } else {
                    continue;
                };
                let at = (level - r0) / (r1 - r0) * h as f64;
                out.push(Raw {
                    kind: code("crossing").expect("a physics kind"),
                    a: joint.clone(),
                    a_use: None,
                    b: None,
                    b_use: None,
                    payload: Payload::Crossing {
                        t: t0 + at.floor() as i64,
                        output: output.clone(),
                        level: *level,
                        direction,
                    },
                });
            }
        }
        out
    }

    /// Every joint's state and readings, by ID.
    pub(crate) fn joint_states(&self) -> Vec<JointState> {
        self.joints
            .iter()
            .map(|(id, h, kind)| {
                let u = self
                    .world
                    .impulse_joints
                    .get(*h)
                    .map_or(0, |j| j.data.user_data);
                let (force, torque) = self.load(*h).unwrap_or_default();
                JointState {
                    id: id.clone(),
                    turns: turns(u),
                    past: past(u),
                    coordinate: self.coordinate(*h, *kind),
                    force: f64::from(force),
                    torque: f64::from(torque),
                }
            })
            .collect()
    }
}
