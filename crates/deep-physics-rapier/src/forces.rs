//! A world's forces on Rapier in 3D (Force): each force's push on each body it applies to, from
//! the state at t(k), held over the step; and (#2098) the triangles a wind pushes, each box's
//! faces where its collider sits on its body.

use std::collections::BTreeMap;

use deep_canvas_physics::backend::Targets;
use deep_canvas_physics::doc::{ForceKind, Law, Region, Shape, World};
use deep_canvas_physics::wind::{self, Triangle};
use rapier3d::prelude::*;

use crate::{back, laws, planted, pose, spring, v3, Rapier, Twin};

/// The triangles each wind of `w` pushes, by body, in the body's frame.
pub(crate) fn aero(w: &World) -> BTreeMap<String, Vec<Triangle>> {
    let winds = w.forces.values();
    let winds = winds.filter(|f| matches!(f.kind, ForceKind::Wind(_)));
    let faces = |id: &String| {
        let solid = w.bodies[id].shapes.iter().filter(|u| !u.sensor);
        let on = solid.flat_map(|u| {
            let Some(Shape::Box { half }) = w.shapes.get(&u.shape) else {
                return Vec::new();
            };
            let at = pose(&u.offset);
            let q = at.rotation;
            wind::faces(
                *half,
                back(at.translation),
                [q.x, q.y, q.z, q.w].map(f64::from),
            )
        });
        (id.clone(), on.collect())
    };
    winds.flat_map(|f| &f.applies_to).map(faces).collect()
}

/// Whether `p` is inside a force's `region`; everywhere is, with none.
fn within(region: &Option<Region>, p: Vector) -> bool {
    match region {
        None => true,
        Some(Region::Box { center, half }) => {
            let d = (p - v3(*center)).abs();
            let h = v3(*half);
            d.x <= h.x && d.y <= h.y && d.z <= h.z
        }
        Some(Region::Sphere { center, radius }) => (p - v3(*center)).length() <= *radius as f32,
    }
}

impl Rapier {
    /// Each force's push on each body it applies to, from the state at t(k), held over the step.
    /// A drag's medium or a spring's point that reads a channel is what `targets` holds for the
    /// force at this step's time (#2371), and with nothing read the force pushes nothing.
    pub(crate) fn push(&mut self, targets: &Targets) {
        for (id, h) in &self.bodies {
            self.world.bodies[*h].reset_forces(false);
            // #2098: a wind's torque is this step's alone.
            if self.aero.contains_key(id) {
                self.world.bodies[*h].reset_torques(false);
            }
        }
        let t = deep_canvas_physics::wind::seconds(self.step, self.step_flicks);
        let noise = match self.twin {
            Twin::WindNoiseFromSin => planted::noise_from_sin,
            _ => deep_canvas_physics::wind::NOISE,
        };
        let ids: BTreeMap<&str, RigidBodyHandle> = self
            .bodies
            .iter()
            .map(|(id, h)| (id.as_str(), *h))
            .collect();
        let (twin, dt) = (self.twin, self.world.integration_parameters.dt);
        for (name, f) in &self.forces {
            let read = targets.forces.get(name);
            if f.channel.is_some() && read.is_none() {
                continue;
            }
            // #1931: where the bodies a pair law applies to stand, in canonical order.
            let pairs = matches!(f.kind, ForceKind::Law(Law::LennardJones { .. }));
            let all = f.applies_to.iter().filter(|_| pairs);
            let live = all.map(|id| &self.world.bodies[ids[id.as_str()]]);
            let stands: Vec<Vector> = live
                .filter(|rb| rb.is_enabled() && within(&f.region, rb.translation()))
                .map(|rb| rb.translation())
                .collect();
            for id in &f.applies_to {
                let rb = &mut self.world.bodies[ids[id.as_str()]];
                let p = rb.translation();
                let inside = within(&f.region, p);
                // #2371: a deactivated body sleeps, and no force wakes it.
                let deactivated = rb.is_sleeping() && !rb.is_enabled();
                if !rb.is_dynamic() || deactivated || !inside {
                    continue;
                }
                let (m, v) = (rb.mass(), rb.linvel());
                let force = match &f.kind {
                    ForceKind::Wind(_) => {
                        let q = rb.rotation();
                        let seen = deep_canvas_physics::wind::Seen {
                            pos: back(p),
                            rot: [q.x, q.y, q.z, q.w].map(f64::from),
                            com: back(rb.center_of_mass()),
                            linear: back(v),
                            angular: back(rb.angvel()),
                        };
                        let on = self.aero.get(id).map_or(&[][..], Vec::as_slice);
                        let (force, torque) =
                            deep_canvas_physics::wind::push(f, t, &seen, on, noise);
                        rb.add_torque(v3(torque) * f.strength as f32, true);
                        v3(force)
                    }
                    ForceKind::Uniform { accel } => v3(*accel) * m,
                    ForceKind::Drag {
                        linear,
                        quadratic,
                        medium,
                    } => {
                        let rel = v - v3(*read.unwrap_or(medium));
                        -rel * (m * *linear as f32) - rel * (rel.length() * *quadratic as f32)
                    }
                    ForceKind::SpringToPoint {
                        point,
                        hz,
                        damping_ratio,
                        max_force,
                    } => {
                        let (k, c) = spring(*hz, *damping_ratio);
                        let f = ((v3(*read.unwrap_or(point)) - p) * k - v * c) * m;
                        match max_force {
                            Some(max) if f.length() > *max as f32 => f * (*max as f32 / f.length()),
                            _ => f,
                        }
                    }
                    // #1931: a law takes the strength itself, since a magnetic turn scales its
                    // field, never its push.
                    ForceKind::Law(law) => {
                        let at = (p, v, m);
                        let push = laws::push(law, twin, f.strength as f32, at, &stands, dt);
                        rb.add_force(push, true);
                        continue;
                    }
                };
                rb.add_force(force * f.strength as f32, true);
            }
        }
    }
}
