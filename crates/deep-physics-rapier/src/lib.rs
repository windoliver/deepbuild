//! physics.world@1 on Rapier 0.36.1 (issue #2009; canvas primitives: World and backend). A world
//! read by deep-canvas-physics is built in canonical order into one `PhysicsWorld`, stepped once a
//! step with the world's substeps as Rapier's solver iterations, and checkpointed as that world's
//! own bytes, stamped with the backend and the version that wrote them.

use std::collections::BTreeMap;
use std::f32::consts::PI;

use deep_canvas_physics::backend::{Backend, BodyState, Checkpoint, Input, State};
use deep_canvas_physics::caps::{Caps, RAPIER3D};
use deep_canvas_physics::doc::{
    BodyKind, End, Force, ForceKind, Joint, JointKind, Material, Pose as DocPose, Refusal, Region,
    Rot, Rule, Shape, World,
};
use rapier3d::math::glamx::EulerRot;
use rapier3d::math::{Pose, Rotation};
use rapier3d::prelude::*;
use serde_json::{json, Value};

/// The planted twin of criterion 4 (#2009 Proof): two public items that name Rapier types.
#[cfg(feature = "test-leaks-rapier")]
pub use rapier3d::prelude::RigidBodyHandle;
#[cfg(feature = "test-leaks-rapier")]
pub fn leaked_world() -> rapier3d::prelude::PhysicsWorld {
    PhysicsWorld::default()
}

/// The code of a checkpoint refused at restore.
pub const CHECKPOINT_REFUSED: &str = "physics.checkpoint_refused";

/// A Rapier world behind the backend interface.
#[derive(Default)]
pub struct Rapier {
    world: PhysicsWorld,
    /// Each body's handle, in canonical (ID) order.
    bodies: Vec<(String, RigidBodyHandle)>,
    forces: Vec<Force>,
    /// The fixed body a joint end of `world` holds to.
    world_body: Option<RigidBodyHandle>,
    step: u64,
    /// The planted twin (#2009 Proof): restore skips the version comparison.
    pub restore_any_version: bool,
}

fn v3(a: [f64; 3]) -> Vector {
    Vector::new(a[0] as f32, a[1] as f32, a[2] as f32)
}

fn back(v: Vector) -> [f64; 3] {
    [f64::from(v.x), f64::from(v.y), f64::from(v.z)]
}

fn rotation(r: &Rot) -> Rotation {
    match r {
        Rot::Quat(q) => {
            Rotation::from_xyzw(q[0] as f32, q[1] as f32, q[2] as f32, q[3] as f32).normalize()
        }
        Rot::Deg(d) => Rotation::from_euler(
            EulerRot::XYZ,
            d[0] as f32 * PI / 180.0,
            d[1] as f32 * PI / 180.0,
            d[2] as f32 * PI / 180.0,
        ),
    }
}

fn pose(p: &DocPose) -> Pose {
    Pose::from_parts(v3(p.pos), rotation(&p.rot))
}

fn combine(r: Rule) -> CoefficientCombineRule {
    match r {
        Rule::Geometric => CoefficientCombineRule::GeometricMean,
        Rule::Average => CoefficientCombineRule::Average,
        Rule::Min => CoefficientCombineRule::Min,
        Rule::Max => CoefficientCombineRule::Max,
        Rule::Multiply => CoefficientCombineRule::Multiply,
    }
}

fn refusal(code: &'static str, path: String, actual: Value, what: String) -> Refusal {
    Refusal {
        code,
        path,
        actual,
        what,
    }
}

/// Angular frequency and the acceleration-based spring's stiffness and damping for `hz` and `zeta`.
fn spring(hz: f64, zeta: f64) -> (f32, f32) {
    let w = 2.0 * PI * hz as f32;
    (w * w, 2.0 * zeta as f32 * w)
}

impl Rapier {
    fn collider(
        &self,
        w: &World,
        id: &str,
        b: &deep_canvas_physics::doc::Body,
        i: usize,
        out: &mut Vec<Refusal>,
    ) -> Option<ColliderBuilder> {
        let u = &b.shapes[i];
        let path = format!("bodies/{id}/shapes/{i}");
        let mut c = match &w.shapes[&u.shape] {
            Shape::Sphere { radius } => ColliderBuilder::ball(*radius as f32),
            Shape::Box { half } => {
                ColliderBuilder::cuboid(half[0] as f32, half[1] as f32, half[2] as f32)
            }
            Shape::Capsule {
                half_height,
                radius,
            } => ColliderBuilder::capsule_y(*half_height as f32, *radius as f32),
            Shape::Cylinder {
                half_height,
                radius,
            } => ColliderBuilder::cylinder(*half_height as f32, *radius as f32),
            Shape::Plane { normal } => {
                if b.kind != BodyKind::Static {
                    out.push(refusal(
                        "out_of_range",
                        format!("{path}/shape"),
                        json!(u.shape),
                        format!("{} is a plane, which only a static body holds", u.shape),
                    ));
                    return None;
                }
                ColliderBuilder::halfspace(rapier3d::na::Unit::new_unchecked(
                    v3(*normal).normalize(),
                ))
            }
        };
        let m: &Material = u
            .material
            .as_ref()
            .map_or(&w.defaults, |m| &w.contact_materials[m]);
        c = c
            .position(pose(&u.offset))
            .friction(m.friction as f32)
            .restitution(m.restitution as f32)
            .friction_combine_rule(combine(w.friction_rule))
            .restitution_combine_rule(combine(w.restitution_rule))
            .collision_groups(InteractionGroups::new(
                Group::from_bits_retain(u.member),
                Group::from_bits_retain(u.collides),
                InteractionTestMode::And,
            ))
            .sensor(u.sensor);
        if b.kind == BodyKind::Static || b.mass.is_some() {
            return Some(c);
        }
        match m.density {
            Some(d) => Some(c.density(d as f32)),
            None => {
                out.push(refusal("physics.missing_field", format!("bodies/{id}/mass"), Value::Null, format!("dynamic body {id} needs a mass, or a density on the contact material of its shape {i}")));
                None
            }
        }
    }

    fn handle(&mut self, handles: &BTreeMap<String, RigidBodyHandle>, e: &End) -> RigidBodyHandle {
        match &e.body {
            Some(id) => handles[id],
            None => *self
                .world_body
                .get_or_insert_with(|| self.world.insert_body(RigidBodyBuilder::fixed())),
        }
    }

    fn joint(
        &mut self,
        handles: &BTreeMap<String, RigidBodyHandle>,
        id: &str,
        j: &Joint,
        out: &mut Vec<Refusal>,
    ) {
        let (h1, h2) = (self.handle(handles, &j.a), self.handle(handles, &j.b));
        let (p1, p2) = (v3(j.a.point), v3(j.b.point));
        let at = |w: &PhysicsWorld, h: RigidBodyHandle, p: Vector| {
            w.bodies[h].position().transform_point(p)
        };
        let length = (at(&self.world, h1, p1) - at(&self.world, h2, p2)).length();
        let axis = v3(j.a.axis).normalize();
        let deg = |x: f64| x as f32 * PI / 180.0;
        let mut data: GenericJoint = match j.kind {
            JointKind::Fixed => FixedJointBuilder::new()
                .local_anchor1(p1)
                .local_anchor2(p2)
                .into(),
            JointKind::Ball => {
                if j.limits.is_some() {
                    out.push(refusal(
                        "physics.unsupported",
                        format!("joints/{id}/limits"),
                        Value::Null,
                        "a ball joint's limits are its swing and twist cones, which #132 brings"
                            .into(),
                    ));
                }
                SphericalJointBuilder::new()
                    .local_anchor1(p1)
                    .local_anchor2(p2)
                    .into()
            }
            JointKind::Hinge => {
                let mut b = RevoluteJointBuilder::new(axis)
                    .local_anchor1(p1)
                    .local_anchor2(p2);
                if let Some([lo, hi]) = j.limits {
                    b = b.limits([deg(lo), deg(hi)]);
                }
                if let Some(m) = &j.motor {
                    let (k, c) = spring(m.hz, m.damping_ratio);
                    b = b.motor_model(MotorModel::AccelerationBased);
                    b = if m.velocity {
                        b.motor_velocity(deg(m.target), c)
                    } else {
                        b.motor_position(deg(m.target), k, c)
                    };
                    if let Some(max) = m.max {
                        b = b.motor_max_force(max as f32);
                    }
                }
                b.into()
            }
            JointKind::Slider => {
                let mut b = PrismaticJointBuilder::new(axis)
                    .local_anchor1(p1)
                    .local_anchor2(p2);
                if let Some([lo, hi]) = j.limits {
                    b = b.limits([lo as f32, hi as f32]);
                }
                if let Some(m) = &j.motor {
                    let (k, c) = spring(m.hz, m.damping_ratio);
                    b = b.motor_model(MotorModel::AccelerationBased);
                    b = if m.velocity {
                        b.motor_velocity(m.target as f32, c)
                    } else {
                        b.motor_position(m.target as f32, k, c)
                    };
                    if let Some(max) = m.max {
                        b = b.motor_max_force(max as f32);
                    }
                }
                b.into()
            }
            JointKind::Distance => {
                let rest = j
                    .spring
                    .as_ref()
                    .and_then(|s| s.rest)
                    .map_or(length, |r| r as f32);
                match &j.spring {
                    Some(s) => {
                        let (k, c) = spring(s.hz, s.damping_ratio);
                        SpringJointBuilder::new(rest, k, c)
                            .spring_model(MotorModel::AccelerationBased)
                            .local_anchor1(p1)
                            .local_anchor2(p2)
                            .into()
                    }
                    None => {
                        let [lo, hi] = j
                            .limits
                            .map_or([rest, rest], |[lo, hi]| [lo as f32, hi as f32]);
                        GenericJointBuilder::new(JointAxesMask::empty())
                            .coupled_axes(JointAxesMask::LIN_AXES)
                            .limits(JointAxis::LinX, [lo, hi])
                            .local_anchor1(p1)
                            .local_anchor2(p2)
                            .build()
                    }
                }
            }
            JointKind::Rope => {
                let max = j.limits.map_or(length, |[_, hi]| hi as f32);
                RopeJointBuilder::new(max)
                    .local_anchor1(p1)
                    .local_anchor2(p2)
                    .into()
            }
        };
        data.set_contacts_enabled(j.collide_connected);
        data.set_enabled(j.active);
        self.world.insert_impulse_joint(h1, h2, data);
    }

    /// Each force's push on each body it applies to, from the state at t(k), held over the step.
    fn push(&mut self) {
        for (_, h) in &self.bodies {
            self.world.bodies[*h].reset_forces(false);
        }
        let ids: BTreeMap<&str, RigidBodyHandle> = self
            .bodies
            .iter()
            .map(|(id, h)| (id.as_str(), *h))
            .collect();
        for f in &self.forces {
            for id in &f.applies_to {
                let rb = &mut self.world.bodies[ids[id.as_str()]];
                let p = rb.translation();
                let inside = match &f.region {
                    None => true,
                    Some(Region::Box { center, half }) => {
                        let d = (p - v3(*center)).abs();
                        let h = v3(*half);
                        d.x <= h.x && d.y <= h.y && d.z <= h.z
                    }
                    Some(Region::Sphere { center, radius }) => {
                        (p - v3(*center)).length() <= *radius as f32
                    }
                };
                if !rb.is_dynamic() || !inside {
                    continue;
                }
                let (m, v) = (rb.mass(), rb.linvel());
                let force = match &f.kind {
                    ForceKind::Uniform { accel } => v3(*accel) * m,
                    ForceKind::Drag {
                        linear,
                        quadratic,
                        medium,
                    } => {
                        let rel = v - v3(*medium);
                        -rel * (m * *linear as f32) - rel * (rel.length() * *quadratic as f32)
                    }
                    ForceKind::SpringToPoint {
                        point,
                        hz,
                        damping_ratio,
                        max_force,
                    } => {
                        let (k, c) = spring(*hz, *damping_ratio);
                        let f = ((v3(*point) - p) * k - v * c) * m;
                        match max_force {
                            Some(max) if f.length() > *max as f32 => f * (*max as f32 / f.length()),
                            _ => f,
                        }
                    }
                };
                rb.add_force(force * f.strength as f32, true);
            }
        }
    }
}

impl Backend for Rapier {
    fn id(&self) -> String {
        format!("{}@{}", RAPIER3D.backend, RAPIER3D.version)
    }

    fn caps(&self) -> &'static Caps {
        &RAPIER3D
    }

    fn build(&mut self, w: &World) -> Result<(), Vec<Refusal>> {
        let mut out = Vec::new();
        self.world = PhysicsWorld::default();
        self.world_body = None;
        self.bodies.clear();
        self.step = 0;
        self.world.gravity = v3(w.gravity);
        let p = &mut self.world.integration_parameters;
        p.dt = (1.0 / w.step_rate) as f32;
        // The world's substeps are the solver's iterations, not repeated steps (World and backend).
        p.num_solver_iterations = w.substeps as usize;
        p.contact_softness =
            SpringCoefficients::new(w.solver.contact_hz as f32, w.solver.contact_damping as f32);
        // Rapier holds a contact with a fixed body at twice the frequency; the world keeps that.
        p.static_contact_softness = SpringCoefficients::new(
            2.0 * w.solver.contact_hz as f32,
            w.solver.contact_damping as f32,
        );
        p.normalized_max_linear_velocity = w.solver.max_speed as f32;
        p.max_ccd_substeps = usize::from(w.solver.ccd);
        let mut handles = BTreeMap::new();
        for (id, b) in &w.bodies {
            let mut locks = LockedAxes::empty();
            let flags = [
                (b.lock_linear[0], LockedAxes::TRANSLATION_LOCKED_X),
                (b.lock_linear[1], LockedAxes::TRANSLATION_LOCKED_Y),
                (b.lock_linear[2], LockedAxes::TRANSLATION_LOCKED_Z),
                (b.lock_angular[0], LockedAxes::ROTATION_LOCKED_X),
                (b.lock_angular[1], LockedAxes::ROTATION_LOCKED_Y),
                (b.lock_angular[2], LockedAxes::ROTATION_LOCKED_Z),
            ];
            for (on, f) in flags {
                if on {
                    locks |= f;
                }
            }
            let deg = |a: [f64; 3]| v3(a) * (PI / 180.0);
            let builder = match b.kind {
                BodyKind::Static => RigidBodyBuilder::fixed(),
                BodyKind::Dynamic => RigidBodyBuilder::dynamic(),
            };
            let mut rb = builder
                .pose(pose(&b.pose))
                .linvel(v3(b.linear))
                .angvel(deg(b.angular))
                .linear_damping(b.linear_damping as f32)
                .angular_damping(b.angular_damping as f32)
                .gravity_scale(b.gravity_scale as f32)
                .ccd_enabled(b.ccd)
                .can_sleep(b.sleep && w.solver.sleep.on)
                .enabled(b.active)
                .locked_axes(locks)
                .build();
            let a = rb.activation_mut();
            a.normalized_linear_threshold = w.solver.sleep.speed as f32;
            a.time_until_sleep = w.solver.sleep.time as f32;
            let colliders: Vec<ColliderBuilder> = (0..b.shapes.len())
                .filter_map(|i| self.collider(w, id, b, i, &mut out))
                .collect();
            let h = self.world.insert_body(rb);
            // A body's mass, when set, is shared among its shapes by volume.
            let volumes: Vec<f32> = colliders
                .iter()
                .map(|c| c.shape.mass_properties(1.0).mass())
                .collect();
            let total: f32 = volumes.iter().sum();
            for (c, vol) in colliders.into_iter().zip(volumes) {
                let c = match b.mass {
                    Some(m) if b.kind == BodyKind::Dynamic && total > 0.0 => {
                        c.mass(m as f32 * vol / total)
                    }
                    _ => c,
                };
                self.world.insert_collider(c, Some(h));
            }
            handles.insert(id.clone(), h);
            self.bodies.push((id.clone(), h));
        }
        for (id, j) in &w.joints {
            self.joint(&handles, id, j, &mut out);
        }
        self.forces = w.forces.values().cloned().collect();
        if out.is_empty() {
            Ok(())
        } else {
            Err(out)
        }
    }

    fn step(&mut self, inputs: &[Input]) -> Result<(), Box<Refusal>> {
        // A world declares no inputs yet (the reader refuses `inputs`), so none can arrive.
        if let Some(i) = inputs.first() {
            return Err(Box::new(refusal(
                "physics.unsupported",
                "inputs/kind".into(),
                json!(i.kind),
                format!(
                    "the input {} isn't run by this backend interface yet; #522 brings it",
                    i.kind
                ),
            )));
        }
        self.push();
        self.world.step();
        self.step += 1;
        Ok(())
    }

    fn read(&self) -> State {
        let bodies = self
            .bodies
            .iter()
            .map(|(id, h)| {
                let rb = &self.world.bodies[*h];
                let q = rb.rotation();
                // Each contact's impulse as it pushed this body, summed over its pairs.
                let mut impulse = Vector::ZERO;
                for c in rb.colliders() {
                    for pair in self.world.contact_pairs_with(*c) {
                        let sign = if pair.collider1 == *c { -1.0 } else { 1.0 };
                        impulse += pair.total_impulse() * sign;
                    }
                }
                BodyState {
                    id: id.clone(),
                    pos: back(rb.translation()),
                    rot: [
                        f64::from(q.x),
                        f64::from(q.y),
                        f64::from(q.z),
                        f64::from(q.w),
                    ],
                    linear: back(rb.linvel()),
                    angular: back(rb.angvel() * (180.0 / PI)),
                    contact_impulse: f64::from(impulse.length()),
                    sleeping: rb.is_sleeping(),
                }
            })
            .collect();
        State {
            step: self.step,
            bodies,
        }
    }

    fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            backend: RAPIER3D.backend.into(),
            version: RAPIER3D.version.into(),
            features: RAPIER3D.features.iter().map(|f| f.to_string()).collect(),
            step: self.step,
            state: bincode::serialize(&self.world).expect("a Rapier world serializes"),
        }
    }

    fn restore(&mut self, cp: &Checkpoint) -> Result<(), Box<Refusal>> {
        if !self.restore_any_version
            && (cp.backend != RAPIER3D.backend || cp.version != RAPIER3D.version)
        {
            return Err(Box::new(refusal(
                CHECKPOINT_REFUSED,
                "checkpoint/version".into(),
                json!(format!("{}@{}", cp.backend, cp.version)),
                format!(
                    "the checkpoint was written by {} {} and this build pins {} {}; checkpoints never mix across backend versions, so it was refused and nothing was loaded",
                    cp.backend, cp.version, RAPIER3D.backend, RAPIER3D.version
                ),
            )));
        }
        let world: PhysicsWorld = bincode::deserialize(&cp.state).map_err(|e| {
            Box::new(refusal(
                CHECKPOINT_REFUSED,
                "checkpoint/state".into(),
                Value::Null,
                format!(
                    "the checkpoint's state doesn't load as a {} {} world: {e}; nothing was loaded",
                    RAPIER3D.backend, RAPIER3D.version
                ),
            ))
        })?;
        self.world = world;
        self.step = cp.step;
        Ok(())
    }
}
