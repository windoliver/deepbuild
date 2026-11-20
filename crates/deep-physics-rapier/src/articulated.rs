//! #2310: joints of one tree as one articulation (Joint: `articulated`). An articulated joint is
//! a link of Rapier's multibody: the engine places its second body from the joint's own
//! coordinates, so its anchors never part, whatever the masses it holds. Each joint's coordinates
//! are set from its two bodies' authored poses, so a body starts where the document puts it; what
//! of their turn the joint's own freedom can't hold is taken into its second frame. The
//! coordinates live in the world's bytes, so a checkpoint carries them.

use std::f32::consts::PI;

use deep_canvas_physics::backend::{hinge_angle, JointState, Targets};
use deep_canvas_physics::check::{ARTICULATION_GAP, ARTICULATION_TREE};
use deep_canvas_physics::doc::{Joint, JointKind, Motor, Refusal};
use rapier3d::math::Rotation;
use rapier3d::prelude::*;
use serde_json::json;

use crate::{refusal, Rapier, Twin};

/// The farthest apart an articulated joint's two anchors may be written, m.
const MOST_GAP: f32 = 1e-3;

/// Sets `data`'s motor to `target`: deg/s or deg for a hinge, m/s or m for a slider.
pub(crate) fn drive(data: &mut GenericJoint, kind: JointKind, m: &Motor, target: f64) {
    let (axis, x) = match kind {
        JointKind::Hinge => (JointAxis::AngX, target as f32 * PI / 180.0),
        _ => (JointAxis::LinX, target as f32),
    };
    let (k, c) = crate::spring(m.hz, m.damping_ratio);
    if m.velocity {
        data.set_motor_velocity(axis, x, c);
    } else {
        data.set_motor_position(axis, x, k, c);
    }
}

impl Rapier {
    /// Builds joint `id` as a link from `h1` to `h2`, its coordinates set from the two bodies'
    /// poses as written; or refuses a pair whose anchors are written more than 1 mm apart,
    /// naming the joint and the gap.
    pub(crate) fn link(
        &mut self,
        id: &str,
        j: &Joint,
        (h1, h2): (RigidBodyHandle, RigidBodyHandle),
        mut data: GenericJoint,
        out: &mut Vec<Refusal>,
    ) {
        let at = |h: RigidBodyHandle| *self.world.bodies[h].position();
        // The second frame as the first sees it: where the joint's own freedom must put it.
        let rel = data.local_frame1.inverse() * at(h1).inverse() * at(h2) * data.local_frame2;
        let (d, r) = (rel.translation, rel.rotation);
        // What the joint's freedom holds of that: a slider's travel, a hinge's turn about its
        // axis, a ball's whole turn; the rest of the turn goes into the second frame.
        let (apart, held, coords) = match j.kind {
            JointKind::Slider => (Vector::new(0.0, d.y, d.z), Rotation::IDENTITY, vec![d.x]),
            JointKind::Hinge => {
                let turn = hinge_angle([r.x, r.y, r.z, r.w].map(f64::from)).to_radians() as f32;
                (d, Rotation::from_axis_angle(Vector::X, turn), vec![turn])
            }
            JointKind::Ball => {
                let turn = r.to_scaled_axis();
                (d, r, vec![turn.x, turn.y, turn.z])
            }
            _ => (d, Rotation::IDENTITY, Vec::new()),
        };
        let gap = apart.length();
        if gap > MOST_GAP {
            let mm = f64::from(gap) * 1000.0;
            let what = format!("articulated joint {id}'s two anchors are written {mm:.3} mm apart, more than the 1 mm an articulated joint closes; write its second body with its anchor on the first's");
            let path = format!("joints/{id}/frame_b/anchor");
            out.push(refusal(ARTICULATION_GAP, path, json!(f64::from(gap)), what));
            return;
        }
        data.local_frame2.rotation *= (held.inverse() * r).inverse();
        // The check refuses a joint the engine's trees can't take; its planted twin lets one
        // through, and nothing is built for it.
        let Some(h) = self.world.multibody_joints.insert(h1, h2, data, true) else {
            if self.twin != Twin::TreeCountsOnly {
                let what = format!("articulated joint {id} gives its second body a second parent or closes a loop, and the articulated joints of a world form trees");
                let path = format!("joints/{id}/articulated");
                out.push(refusal(ARTICULATION_TREE, path, json!(true), what));
            }
            return;
        };
        if self.twin != Twin::LinksAtZero {
            if let Some((mb, link)) = self.world.multibody_joints.get_mut(h) {
                let from = mb.link(link).map_or(0, |l| l.assembly_id());
                let mut by = vec![0.0; mb.ndofs()];
                by[from..from + coords.len()].copy_from_slice(&coords);
                mb.apply_displacements(&by);
            }
        }
        self.links.push((id.into(), h, j.kind));
        if let Some(m) = j.motor.as_ref().filter(|m| m.channel.is_some()) {
            self.link_motors.push((id.into(), h, j.kind, m.clone()));
        }
    }

    /// Each articulated joint's channel motor at the target its channel sets for this step.
    pub(crate) fn aim_links(&mut self, t: &Targets) {
        for (id, h, kind, m) in &self.link_motors {
            let Some(target) = t.motors.get(id) else {
                continue;
            };
            let held = self.world.multibody_joints.get_mut(*h);
            if let Some(l) = held.and_then(|(mb, link)| mb.link_mut(link)) {
                drive(&mut l.joint.data, *kind, m, *target);
            }
        }
    }

    /// Each articulated joint's state and readings, by ID: a hinge's coordinate is the engine's
    /// own, which counts its turns; it has no lock or limit impulse to read a force from.
    pub(crate) fn link_states(&self) -> Vec<JointState> {
        let state = |(id, h, kind): &(String, MultibodyJointHandle, JointKind)| {
            let (mb, link) = self.world.multibody_joints.get(*h)?;
            let q = mb.link(link)?.joint().coords();
            let coordinate = match kind {
                JointKind::Hinge => Some(f64::from(q[3]).to_degrees()),
                JointKind::Slider => Some(f64::from(q[0])),
                _ => None,
            };
            // The whole turns past ±180°, as a separate hinge counts them.
            let turns = coordinate.filter(|_| *kind == JointKind::Hinge);
            let turns = turns.map_or(0, |a| ((a + 180.0) / 360.0).ceil() as i32 - 1);
            Some(JointState {
                id: id.clone(),
                turns,
                past: 0,
                coordinate,
                force: 0.0,
                torque: 0.0,
            })
        };
        self.links.iter().filter_map(state).collect()
    }
}

#[cfg(test)]
mod tests {
    use deep_canvas_physics::backend::{Backend, Input, Targets};
    use deep_canvas_physics::caps::RAPIER3D;
    use deep_canvas_physics::check::check;
    use deep_canvas_physics::roles::TABLE;
    use serde_json::{json, Value};

    use crate::Rapier;

    /// A 1 kg ball on an articulated ball joint to the world, `velocity` written on it.
    fn pendulum(velocity: Value) -> Value {
        json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4,
            "gravity": [0, -9.81, 0], "mode": "dynamic",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 1, "contacts": 0, "particles": 0},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.05}},
            "bodies": {"bob": {"kind": "dynamic", "shapes": [{"shape": "ball"}], "mass": 1,
                               "pose": {"pos": [0, 1, 0]}, "velocity": velocity}},
            "joints": {"rod": {"kind": "ball", "a": "world", "b": "bob", "articulated": true,
                               "frame_a": {"anchor": [0, 2, 0]}, "frame_b": {"anchor": [0, 1, 0]}}}
        })
    }

    /// A body of an articulation moves by its joints' coordinates alone: a velocity written on
    /// it is refused at check, naming the field, and a launch or a poke at its step.
    #[test]
    fn what_sets_the_velocity_of_a_body_of_an_articulation_is_refused() {
        let moving = pendulum(json!({"linear": [1, 0, 0]}));
        let refused = check(&moving, &RAPIER3D, &TABLE).unwrap_err();
        let paths: Vec<&str> = refused.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(paths, ["bodies/bob/velocity"]);
        let w = check(&pendulum(json!({})), &RAPIER3D, &TABLE).unwrap_or_else(|e| panic!("{e:?}"));
        let mut b = Rapier::default();
        b.build(&w).unwrap();
        b.step(&[], &Targets::default()).unwrap();
        for kind in ["launch", "poke"] {
            let data = json!({"linear": [1, 0, 0], "impulse": [1, 0, 0]});
            let input = Input {
                kind: kind.into(),
                target: "bob".into(),
                data,
            };
            let r = b.step(&[input], &Targets::default()).unwrap_err();
            assert!(
                r.what.contains(kind) && r.what.contains("bob"),
                "{}",
                r.what
            );
        }
    }
}
