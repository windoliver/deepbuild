//! Issue #251: vehicle bodies on Rapier's own ray-cast vehicle controller, behind the backend
//! interface (canvas primitives: Body `body@1`: vehicle). Each step, before the backend step,
//! each vehicle body in canonical (priority, ID) order casts each wheel's ray down its chassis
//! against the world as the last step left it. A brake above 0 first holds each touching braking
//! wheel by the controller's own rolling rule, up to its share; then the controller's springs and
//! grip are handed to the step as forces, integrated beside gravity, rather than as the impulses
//! it would apply before it, so a spring settles at g ÷ (2π × hz)² with no leftover speed for its
//! damper to read; and the drive pushes each touching driving wheel by its share. (The controller
//! itself would let a wheel with no load on its spring neither brake nor drive, which the
//! interface's brake and drive don't say.) A chassis asleep rests its controller, and a drive
//! other than 0 wakes it first. The controller, each wheel's spin rate and contact, and the drive,
//! steer and brake each body holds are wrapper state: they ride in the checkpoint after the
//! world's bytes, and in the canonical state after every body's.
//!
//! #2306: ground that moves. A wheel's ray meets any shape but its own chassis's, within the
//! chassis's collision groups. Its spring's damper, its brake and its grip read the chassis's
//! velocity at the contact less the touched body's there, a kinematic body's over the coming step
//! (the pose it is set to reach), which the controller reads only for a dynamic body's grip; and
//! what its spring, drive, brake and grip push the chassis with goes back, equal and opposite, at
//! the contact, to a dynamic body under it, as an impulse over the step. A static or kinematic
//! body takes nothing, so a car on static ground moves exactly as before.

use std::f32::consts::PI;

use deep_canvas_physics::backend::{
    about_x, Canonical, ShapeRef, VehicleState, WheelState, HELD_FIELDS, WHEEL_FIELDS,
};
use deep_canvas_physics::doc::{self, World};
use deep_canvas_physics::occurrence::{self, Payload, Raw};
use rapier3d::control::{DynamicRayCastVehicleController, Wheel, WheelTuning};
use rapier3d::dynamics::RigidBodyPosition;
use rapier3d::math::Rotation;
use rapier3d::prelude::*;

use crate::v3;

/// The tag that starts the vehicles a checkpoint carries after the world's bytes.
const TAG: &[u8] = b"deep.vehicles@1";

/// #251's planted wrong programs, each one criterion's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// Each spring sized on the whole chassis mass, not its share per wheel.
    WholeMassSprings,
    /// Each braking wheel given the whole brake force, not its share.
    WholeBrake,
    /// The steer angle itself clamped at `steer_max`, not the wheel inside the turn.
    ClampSteer,
    /// Both steering wheels turned by the steer angle, with no Ackermann rule.
    ParallelSteer,
    /// A wheel's contact names only the body.
    BodyOnly,
    /// A restored checkpoint leaves out the steer each body holds.
    DropSteer,
    /// A place that keeps each wheel's spin rate, or the chassis's angular velocity.
    PlaceKeepsSpinRate,
    PlaceKeepsAngular,
    /// A check that refuses only a vehicle body's wheel too many (the runner's).
    WheelsOnly,
    /// #2306: the controller as it is: nothing goes back to the body under a wheel, and a kinematic
    /// one's velocity is read as the last step left it, by the brake only.
    GroundTakesNothing,
    /// #2306: each wheel's grip reads the chassis's velocity alone, whatever is under it.
    GripChassisOnly,
}

/// One vehicle body: its chassis, its wheels as written (by name, the controller's order), the
/// controller, the drive (N), steer (deg) and brake (N) it holds, the turn each wheel made in its
/// last step (rad), its spin rate, and the shape each wheel's ray met as the last step left it.
#[derive(Clone, Debug)]
struct Car {
    id: String,
    chassis: RigidBodyHandle,
    spec: doc::Vehicle,
    ctl: DynamicRayCastVehicleController,
    drive: f32,
    steer: f32,
    brake: f32,
    turned: Vec<f32>,
    touch: Vec<Option<ColliderHandle>>,
}

/// What a checkpoint carries of one body: its controller, held inputs, spin rates and contacts.
type Kept = (
    DynamicRayCastVehicleController,
    f32,
    f32,
    f32,
    Vec<f32>,
    Vec<Option<ColliderHandle>>,
);

/// The world's vehicle bodies in canonical (priority, ID) order.
#[derive(Clone, Debug, Default)]
pub(crate) struct Vehicles {
    cars: Vec<Car>,
    pub(crate) plant: Plant,
}

/// A controller for `v` on `chassis`, its wheels at rest: each spring k = (m ÷ n) × (2π × hz)²
/// and its damper 2ζ × (m ÷ n) × 2π × hz, which the controller takes per kg of the chassis.
fn controller(
    v: &doc::Vehicle,
    chassis: RigidBodyHandle,
    plant: Plant,
) -> DynamicRayCastVehicleController {
    let mut ctl = DynamicRayCastVehicleController::new(chassis);
    ctl.index_up_axis = 1;
    ctl.index_forward_axis = 2;
    let n = if plant == Plant::WholeMassSprings {
        1.0
    } else {
        v.wheels.len() as f32
    };
    for w in v.wheels.values() {
        let omega = 2.0 * PI * w.hz as f32;
        let damper = 2.0 * w.damping_ratio as f32 * omega / n;
        let tuning = WheelTuning {
            suspension_stiffness: omega * omega / n,
            suspension_compression: damper,
            suspension_damping: damper,
            max_suspension_travel: w.travel as f32,
            side_friction_stiffness: 1.0,
            // The controller would clip a wheel's brake or drive with its sideways push by grip
            // × load; the interface's grip limits only the sideways slip (`drive`, below).
            friction_slip: f32::MAX,
            max_suspension_force: f32::MAX,
        };
        // Its axle along −X, so the heading the controller rolls along, the ground's normal
        // crossed with the axle, is +Z; a wheel rolling forward spins about −X.
        ctl.add_wheel(
            v3(w.at),
            -Vector::Y,
            -Vector::X,
            w.rest as f32,
            w.radius as f32,
            &tuning,
        );
    }
    ctl
}

/// Each wheel's steer, deg, for steer angle `steer` by Ackermann's rule, clamped so the wheel
/// inside the turn stays within `steer_max` (the interface's: doc/vehicle.rs); the planted ones
/// clamp the steer angle itself, or turn each steering wheel by it.
fn steers(v: &doc::Vehicle, steer: f64, plant: Plant) -> Vec<f64> {
    match plant {
        Plant::ClampSteer => v.ackermann(steer.clamp(-v.steer_max, v.steer_max)),
        Plant::ParallelSteer => {
            let delta = steer.clamp(-v.steer_limit(), v.steer_limit());
            let turn = |w: &doc::Wheel| if w.steers { delta } else { 0.0 };
            v.wheels.values().map(turn).collect()
        }
        _ => v.ackermann(steer.clamp(-v.steer_limit(), v.steer_limit())),
    }
}

/// What a wheel's ray of `chassis` meets: a shape on any body but its own, dynamic bodies'
/// included, within the collision groups of the chassis's shape uses taken together.
fn meets(world: &PhysicsWorld, chassis: RigidBodyHandle) -> QueryFilter<'static> {
    let none = InteractionGroups::new(Group::empty(), Group::empty(), InteractionTestMode::And);
    let groups = world.bodies[chassis].colliders().iter().fold(none, |g, h| {
        let c = world.colliders[*h].collision_groups();
        InteractionGroups::new(
            g.memberships | c.memberships,
            g.filter | c.filter,
            InteractionTestMode::And,
        )
    });
    QueryFilter::default()
        .exclude_rigid_body(chassis)
        .groups(groups)
}

/// The body under a wheel's contact `p` on `ground`, when it isn't static: a kinematic one's
/// velocity there over the coming step, from its pose to the pose it is set to reach, and none to
/// push back; a dynamic one, whose velocity there is read as it changes, and which takes back
/// what the wheel pushes the chassis with.
fn under(world: &PhysicsWorld, ground: ColliderHandle, p: Vector) -> Option<Under> {
    let h = world.colliders.get(ground)?.parent()?;
    let rb = world.bodies.get(h)?;
    if rb.is_dynamic() {
        return Some(Under::Dynamic(h));
    }
    if !rb.is_kinematic() {
        return None;
    }
    let local = rb.mass_properties().local_mprops.local_com;
    let poses = RigidBodyPosition {
        position: *rb.position(),
        next_position: *rb.next_position(),
    };
    let v = poses.interpolate_velocity(world.integration_parameters.inv_dt(), local);
    Some(Under::Kinematic(
        v.velocity_at_point(p, *rb.position() * local),
    ))
}

/// A body under a wheel that isn't static (`under`).
#[derive(Clone, Copy, Debug)]
enum Under {
    Kinematic(Vector),
    Dynamic(RigidBodyHandle),
}

/// How much an impulse along `dir` at `p` changes the velocity of body `rb` there, along `dir`.
fn reach(rb: &RigidBody, p: Vector, dir: Vector) -> f32 {
    let m = rb.mass_properties();
    let d = p - m.world_com;
    let turn = (m.effective_world_inv_inertia * d.cross(dir)).cross(d);
    m.local_mprops.inv_mass + dir.dot(turn)
}

/// Each wheel's ray cast down its chassis from its mount over its rest length and radius,
/// against the world as it stands: the point and normal it meets, and the shape's collider.
fn rays(world: &PhysicsWorld, c: &Car) -> Vec<Option<(Vector, Vector, ColliderHandle)>> {
    let pose = *world.bodies[c.chassis].position();
    let down = pose.rotation * -Vector::Y;
    let queries = world.query_pipeline_with_filter(meets(world, c.chassis));
    c.spec
        .wheels
        .values()
        .map(|w| {
            let ray = Ray::new(pose * v3(w.at), down);
            let hit = queries.cast_ray_and_get_normal(&ray, (w.rest + w.radius) as f32, true);
            hit.map(|(h, i)| (ray.point_at(i.time_of_impact), i.normal, h))
        })
        .collect()
}

/// The brake: each touching braking wheel's rolling resisted by the controller's own rule, the
/// impulse along its heading that brings its contact's rolling to rest against the ground, taken
/// in turn over the wheels a few times so they hold together, each wheel's whole impulse within
/// `most` (its share of the brake over the step) and never past rest, so it never pushes a wheel
/// backwards. The impulses change the chassis's velocity before the step, as a contact's do; a
/// dynamic body under a wheel takes each back at the contact, and its own velocity and give join
/// the rule's.
fn hold(world: &mut PhysicsWorld, c: &Car, steer: &[f64], most: f32, plant: Plant) {
    // Each braking wheel on the ground: its contact, heading (its axle turned by its steer, on
    // the ground's plane, crossed into the normal), the velocity there of a static or kinematic
    // body under it, and a dynamic body under it.
    let rot = *world.bodies[c.chassis].rotation();
    let hits = rays(world, c);
    let wheels: Vec<(Vector, Vector, Vector, Option<RigidBodyHandle>)> = hits
        .iter()
        .zip(c.spec.wheels.values())
        .zip(steer)
        .filter_map(|((hit, w), s)| {
            let (p, n, g) = (*hit).filter(|_| w.brakes)?;
            let axle =
                rot * Rotation::from_axis_angle(Vector::Y, s.to_radians() as f32) * -Vector::X;
            let axle = (axle - n * axle.dot(n)).normalize_or_zero();
            let ground = world
                .colliders
                .get(g)?
                .parent()
                .and_then(|b| world.bodies.get(b));
            let forward = n.cross(axle).normalize_or_zero();
            let (v, back) = match under(world, g, p).filter(|_| plant != Plant::GroundTakesNothing)
            {
                Some(Under::Kinematic(v)) => (v, None),
                Some(Under::Dynamic(h)) => (Vector::ZERO, Some(h)),
                None => (
                    ground.map_or(Vector::ZERO, |b| b.velocity_at_point(p)),
                    None,
                ),
            };
            Some((p, forward, v, back))
        })
        .collect();
    let mut total = vec![0.0f32; wheels.len()];
    for _ in 0..HOLD_PASSES {
        for ((p, forward, ground, back), sum) in wheels.iter().zip(&mut total) {
            let rb = &world.bodies[c.chassis];
            let mut denominator = reach(rb, *p, *forward);
            let mut rel = rb.velocity_at_point(*p) - *ground;
            if let Some(b) = back.map(|h| &world.bodies[h]) {
                denominator += reach(b, *p, *forward);
                rel -= b.velocity_at_point(*p);
            }
            let j = -forward.dot(rel) / denominator;
            let next = (*sum + j).clamp(-most, most);
            let impulse = *forward * (next - *sum);
            world.bodies[c.chassis].apply_impulse_at_point(impulse, *p, false);
            if let Some(h) = back {
                world.bodies[*h].apply_impulse_at_point(-impulse, *p, true);
            }
            *sum = next;
        }
    }
}

/// A touching wheel's spring push on a chassis `rb` (at the velocities the controller read) with
/// its damper reading the chassis's velocity at the contact less `ground`'s there, by the
/// controller's own rule.
fn sprung(w: &Wheel, rb: &RigidBody, ground: Vector) -> f32 {
    let r = w.raycast_info();
    let n = r.contact_normal_ws;
    let denominator = n.dot(w.suspension());
    let (inv, rel) = if denominator >= -0.1 {
        (1.0 / 0.1, 0.0)
    } else {
        let inv = -1.0 / denominator;
        (
            inv,
            n.dot(rb.velocity_at_point(r.contact_point_ws) - ground) * inv,
        )
    };
    let spring = w.suspension_stiffness * (w.suspension_rest_length - r.suspension_length) * inv;
    let damper = if rel < 0.0 {
        w.damping_compression
    } else {
        w.damping_relaxation
    };
    ((spring - damper * rel) * rb.mass()).max(0.0)
}

/// The controller's grip impulse along `axle` at `p` on a chassis `rb` alone, by its own rule
/// (a fifth of the impulse that stops the slip there), for the slip velocity `slip` along it.
fn grip(rb: &RigidBody, p: Vector, axle: Vector, slip: f32) -> f32 {
    let m = rb.mass_properties();
    let iaj = m.effective_world_inv_inertia * (p - m.world_com).cross(axle);
    -0.2 * slip / (m.local_mprops.inv_mass + iaj.dot(iaj))
}

/// How many times the brake takes its wheels in turn.
const HOLD_PASSES: usize = 4;

/// The rotation `[x, y, z, w]` by `yaw` deg about +Y, then `roll` deg about +X.
fn turn(yaw: f64, roll: f64) -> [f64; 4] {
    // The half-angle sine and cosine of `yaw` (about_x's), as (0, s, 0, c) times (r.x, 0, 0, r.w).
    let [s, _, _, c] = about_x(yaw);
    let r = about_x(roll);
    [c * r[0], s * r[3], -s * r[0], c * r[3]]
}

impl Vehicles {
    /// The world's vehicle bodies, each on its chassis as built.
    pub(crate) fn build(
        &mut self,
        w: &World,
        handles: &std::collections::BTreeMap<String, RigidBodyHandle>,
    ) {
        let mut ids: Vec<&String> = w
            .bodies
            .iter()
            .filter(|(_, b)| b.vehicle.is_some())
            .map(|(id, _)| id)
            .collect();
        ids.sort_by_key(|id| (w.bodies[*id].priority, occurrence::id_order(id)));
        self.cars = ids
            .into_iter()
            .filter_map(|id| {
                let (spec, chassis) = (w.bodies[id].vehicle.clone()?, *handles.get(id)?);
                let ctl = controller(&spec, chassis, self.plant);
                let turned = vec![0.0; spec.wheels.len()];
                Some(Car {
                    id: id.clone(),
                    chassis,
                    spec,
                    ctl,
                    drive: 0.0,
                    steer: 0.0,
                    brake: 0.0,
                    touch: vec![None; turned.len()],
                    turned,
                })
            })
            .collect();
    }

    /// The bodies in canonical order.
    pub(crate) fn ids(&self) -> Vec<String> {
        self.cars.iter().map(|c| c.id.clone()).collect()
    }

    fn car(&mut self, id: &str) -> Option<&mut Car> {
        self.cars.iter_mut().find(|c| c.id == id)
    }

    /// Holds `drive`, `steer` or `brake` `value` on body `id` until its next; false for a body
    /// that isn't a vehicle.
    pub(crate) fn hold(&mut self, id: &str, kind: &str, value: f64) -> bool {
        let Some(c) = self.car(id) else { return false };
        match kind {
            "drive" => c.drive = value as f32,
            "steer" => c.steer = value as f32,
            _ => c.brake = value as f32,
        }
        true
    }

    /// A place's reset of body `id`'s wheels: each wheel's spin, spin rate and suspension back at
    /// rest, the drive, steer and brake it holds kept; the `contact_end` each wheel that touched
    /// writes, naming the shape it left. False for a body that isn't a vehicle.
    pub(crate) fn place(
        &mut self,
        id: &str,
        uses: &std::collections::HashMap<ColliderHandle, ShapeRef>,
    ) -> Option<Vec<Raw>> {
        let plant = self.plant;
        let c = self.car(id)?;
        let kept = std::mem::replace(&mut c.ctl, controller(&c.spec, c.chassis, plant));
        if plant == Plant::PlaceKeepsSpinRate {
            // The planted place keeps each wheel as it was, but for its spin.
            for (w, old) in c.ctl.wheels_mut().iter_mut().zip(kept.wheels()) {
                *w = *old;
                w.rotation = 0.0;
            }
        } else {
            c.turned.iter_mut().for_each(|t| *t = 0.0);
        }
        let ended = vec![None; c.touch.len()];
        let before = std::mem::replace(&mut c.touch, ended);
        Some(c.contacts(uses, &before, &[], plant))
    }

    /// Each wheel's ray cast down its chassis against the world as the step that just ran left
    /// it, over its rest length and radius: the `contact_begin` and `contact_end` each wheel whose
    /// ray started or stopped meeting a shape writes on that step, naming the body's wheel
    /// (`<body>#<wheel>`) and the shape use its ray met.
    pub(crate) fn touch(
        &mut self,
        world: &PhysicsWorld,
        uses: &std::collections::HashMap<ColliderHandle, ShapeRef>,
    ) -> Vec<Raw> {
        let mut out = Vec::new();
        let plant = self.plant;
        for c in &mut self.cars {
            let hits = rays(world, c);
            let now = hits.iter().map(|h| h.map(|h| h.2)).collect();
            let before = std::mem::replace(&mut c.touch, now);
            let at: Vec<_> = hits.iter().map(|h| h.map(|h| (h.0, h.1))).collect();
            out.extend(c.contacts(uses, &before, &at, plant));
        }
        out
    }

    /// Moves body `id` one step through its controller, its pushes handed to the coming step
    /// as forces; `None` for a body that isn't one.
    pub(crate) fn drive(&mut self, id: &str, world: &mut PhysicsWorld) -> Option<()> {
        let plant = self.plant;
        let dt = world.integration_parameters.dt;
        let c = self.car(id)?;
        let h = c.chassis;
        if c.drive != 0.0 {
            world.bodies[h].wake_up(true);
        }
        let rb = &world.bodies[h];
        if rb.is_sleeping() || !rb.is_enabled() || !rb.is_dynamic() {
            return Some(());
        }
        let steer = steers(&c.spec, f64::from(c.steer), plant);
        let count = |f: fn(&doc::Wheel) -> bool| {
            c.spec.wheels.values().filter(|w| f(w)).count().max(1) as f32
        };
        let (drives, brakes) = (count(|w| w.drives), count(|w| w.brakes));
        let brake_share = if plant == Plant::WholeBrake {
            c.brake
        } else {
            c.brake / brakes
        };
        // A brake above 0 keeps every wheel from driving, and holds each touching braking wheel
        // first, so the controller works from the velocities it leaves.
        if c.brake > 0.0 {
            hold(world, c, &steer, brake_share * dt, plant);
        }
        let rb = &world.bodies[h];
        let (v0, w0) = (rb.linvel(), rb.angvel());
        for (w, s) in c.ctl.wheels_mut().iter_mut().zip(steer) {
            w.steering = s.to_radians() as f32;
            // The drive and the brake are the interface's, below: the controller would let a
            // wheel with no load neither drive nor brake.
            (w.engine_force, w.brake) = (0.0, 0.0);
        }
        let spun: Vec<f32> = c.ctl.wheels().iter().map(|w| w.rotation).collect();
        let filter = meets(world, h);
        let queries = world.broad_phase.as_query_pipeline_mut(
            world.narrow_phase.query_dispatcher(),
            &mut world.bodies,
            &mut world.colliders,
            filter,
        );
        c.ctl.update_vehicle(dt, queries);
        for ((t, w), s) in c.turned.iter_mut().zip(c.ctl.wheels()).zip(spun) {
            *t = w.rotation - s;
        }
        // The controller applied its pushes as impulses; they go to the step as forces instead.
        let rb = &mut world.bodies[h];
        rb.set_linvel(v0, false);
        rb.set_angvel(w0, false);
        // Rapier keeps a torque from step to step until it is reset; `push` resets forces only.
        rb.reset_torques(false);
        // Each touching wheel's spring push and grip impulse: the controller's on static ground;
        // on a body that isn't, its damper and grip read the chassis's velocity less that body's.
        let pushes: Vec<(f32, f32, Option<RigidBodyHandle>)> = c
            .ctl
            .wheels()
            .iter()
            .map(|w| {
                let r = w.raycast_info();
                let (load, side) = (w.wheel_suspension_force, w.side_impulse);
                let below = r.ground_object.filter(|_| r.is_in_contact);
                let below = below.and_then(|g| under(world, g, r.contact_point_ws));
                let rb = &world.bodies[h];
                let n = r.contact_normal_ws;
                let axle = (w.axle() - n * w.axle().dot(n)).normalize_or_zero();
                let p = r.contact_point_ws;
                match (below, plant) {
                    (None, _) | (_, Plant::GroundTakesNothing) => (load, side, None),
                    (Some(Under::Dynamic(g)), Plant::GripChassisOnly) => {
                        let ground = world.bodies[g].velocity_at_point(p);
                        let slip = axle.dot(rb.velocity_at_point(p));
                        (sprung(w, rb, ground), grip(rb, p, axle, slip), Some(g))
                    }
                    // The controller's grip already reads a dynamic body's velocity.
                    (Some(Under::Dynamic(g)), _) => {
                        let ground = world.bodies[g].velocity_at_point(p);
                        (sprung(w, rb, ground), side, Some(g))
                    }
                    (Some(Under::Kinematic(_)), Plant::GripChassisOnly) => {
                        (sprung(w, rb, Vector::ZERO), side, None)
                    }
                    (Some(Under::Kinematic(v)), _) => {
                        let carried = side - grip(rb, p, axle, axle.dot(v));
                        (sprung(w, rb, v), carried, None)
                    }
                }
            })
            .collect();
        let mut back = Vec::new();
        let rb = &mut world.bodies[h];
        let (up, com) = (*rb.rotation() * Vector::Y, rb.center_of_mass());
        let wheels = c.ctl.wheels().iter().zip(c.spec.wheels.values());
        for ((w, spec), (load, side, below)) in wheels.zip(pushes) {
            let r = w.raycast_info();
            if !r.is_in_contact {
                continue;
            }
            let n = r.contact_normal_ws;
            let axle = (w.axle() - n * w.axle().dot(n)).normalize_or_zero();
            let p = r.contact_point_ws;
            let forward = n.cross(axle).normalize_or_zero();
            let mut pushed = n * load;
            rb.add_force_at_point(pushed, p, false);
            // A drive pushes each touching driving wheel along its heading by its share.
            if c.brake <= 0.0 && spec.drives && c.drive != 0.0 {
                let drive = forward * (c.drive / drives);
                rb.add_force_at_point(drive, p, false);
                pushed += drive;
            }
            if side != 0.0 {
                // Its grip resists the sideways slip up to grip × the load its spring carries; at
                // the point the controller applies it, lifted toward the centre of mass by its
                // roll influence of 0.1.
                let most = spec.grip as f32 * load;
                let side = (side / dt).clamp(-most, most);
                let q = p - up * (up.dot(p - com) * 0.9);
                rb.add_force_at_point(axle * side, q, false);
                pushed += axle * side;
            }
            back.extend(below.map(|g| (g, pushed, p)));
        }
        // A dynamic body under a wheel takes back what the wheel pushed the chassis with, over
        // the step, at its contact.
        for (g, pushed, p) in back {
            world.bodies[g].apply_impulse_at_point(-pushed * dt, p, true);
        }
        Some(())
    }

    /// Each wheel of each vehicle body as `world` stands: its address `<body>#<wheel>`, its hub's
    /// position at its suspension's length below its mount, its rotation `[x, y, z, w]` (the
    /// chassis's, turned by its steer about the chassis's up and by its spin about its axle), and
    /// whether its ray meets a shape.
    pub(crate) fn wheel_poses(
        &self,
        world: &PhysicsWorld,
    ) -> Vec<(String, [f64; 3], [f64; 4], bool)> {
        let mut out = Vec::new();
        for (c, v) in self.cars.iter().zip(self.read()) {
            let chassis = world.bodies[c.chassis].position();
            for (spec, state) in c.spec.wheels.values().zip(v.wheels) {
                let hub = *chassis * (v3(spec.at) - Vector::Y * state.length as f32);
                // Turned by its steer about the chassis's up, then by its spin about its axle (−X),
                // on pinned math so every machine draws it alike.
                let [x, y, z, w4] = turn(state.steer, -state.spin);
                let q =
                    chassis.rotation * Rotation::from_xyzw(x as f32, y as f32, z as f32, w4 as f32);
                let f = |x: f32| f64::from(x);
                let at = format!("{}#{}", c.id, state.name);
                out.push((
                    at,
                    [f(hub.x), f(hub.y), f(hub.z)],
                    [f(q.x), f(q.y), f(q.z), f(q.w)],
                    state.touching,
                ));
            }
        }
        out
    }

    /// Each vehicle body's own state.
    pub(crate) fn read(&self) -> Vec<VehicleState> {
        self.cars
            .iter()
            .map(|c| {
                let steer = steers(&c.spec, f64::from(c.steer), self.plant);
                let wheels = c
                    .ctl
                    .wheels()
                    .iter()
                    .zip(c.spec.wheels.iter())
                    .zip(steer)
                    .zip(&c.turned)
                    .zip(&c.touch)
                    .map(|((((w, (name, spec)), s), t), touch)| {
                        let r = w.raycast_info();
                        WheelState {
                            name: name.clone(),
                            spin: f64::from(w.rotation).to_degrees(),
                            spin_rate: f64::from(*t).to_degrees(),
                            touching: touch.is_some(),
                            length: if r.is_in_contact {
                                f64::from(r.suspension_length)
                            } else {
                                spec.rest
                            },
                            steer: s,
                        }
                    })
                    .collect();
                VehicleState {
                    id: c.id.clone(),
                    wheels,
                    drive: f64::from(c.drive),
                    steer: f64::from(c.steer),
                    brake: f64::from(c.brake),
                }
            })
            .collect()
    }

    /// Each body's held inputs under its ID, then each wheel's spin, spin rate and contact under
    /// `<body>#<wheel>`, as the backend holds them (deg).
    pub(crate) fn canonical(&self) -> Vec<Canonical> {
        let mut out = Vec::new();
        for c in &self.cars {
            out.push(Canonical {
                id: c.id.clone(),
                values: vec![c.drive, c.steer, c.brake],
                names: &HELD_FIELDS,
            });
            let wheels = c
                .ctl
                .wheels()
                .iter()
                .zip(c.spec.wheels.keys())
                .zip(&c.turned)
                .zip(&c.touch);
            for (((w, name), t), touch) in wheels {
                out.push(Canonical {
                    id: format!("{}#{name}", c.id),
                    values: vec![
                        w.rotation * (180.0 / PI),
                        t * (180.0 / PI),
                        f32::from(u8::from(touch.is_some())),
                    ],
                    names: &WHEEL_FIELDS,
                });
            }
        }
        out
    }

    /// The vehicles as the bytes a checkpoint carries after the world's; none without one, so a
    /// world with no vehicle body checkpoints the bytes it always did.
    pub(crate) fn bytes(&self) -> Vec<u8> {
        if self.cars.is_empty() {
            return Vec::new();
        }
        let held: Vec<Kept> = self
            .cars
            .iter()
            .map(|c| {
                let t = (c.turned.clone(), c.touch.clone());
                (c.ctl.clone(), c.drive, c.steer, c.brake, t.0, t.1)
            })
            .collect();
        let body = bincode::serialize(&held).expect("vehicles serialize");
        [TAG, &(body.len() as u64).to_le_bytes(), &body].concat()
    }

    /// Loads the vehicles a checkpoint's bytes after the world carry; the rest of them.
    pub(crate) fn restore<'a>(&mut self, rest: &'a [u8]) -> &'a [u8] {
        let Some(after) = rest.strip_prefix(TAG) else {
            return rest;
        };
        let (len, after) = after.split_at(8.min(after.len()));
        let len = u64::from_le_bytes(len.try_into().unwrap_or([0; 8])) as usize;
        let (body, after) = after.split_at(len.min(after.len()));
        let held: Vec<Kept> = bincode::deserialize(body).unwrap_or_default();
        for (c, (ctl, drive, steer, brake, turned, touch)) in self.cars.iter_mut().zip(held) {
            (c.ctl, c.drive, c.steer, c.brake) = (ctl, drive, steer, brake);
            (c.turned, c.touch) = (turned, touch);
            if self.plant == Plant::DropSteer {
                c.steer = 0.0;
            }
        }
        after
    }
}

impl Car {
    /// The `contact_begin` and `contact_end` this body's wheels wrote since `before`, each
    /// naming the body's wheel (`<body>#<wheel>`) and the shape use its ray met.
    /// The `contact_end` and `contact_begin` this body's wheels write going from `before` to
    /// their contacts now, each naming the body's wheel and the shape use its ray met; a begun
    /// contact carries its hit's point and normal from `hits`.
    fn contacts(
        &self,
        uses: &std::collections::HashMap<ColliderHandle, ShapeRef>,
        before: &[Option<ColliderHandle>],
        hits: &[Option<(Vector, Vector)>],
        plant: Plant,
    ) -> Vec<Raw> {
        let mut out = Vec::new();
        let wheels = self.spec.wheels.keys().zip(before).zip(&self.touch);
        for (i, ((name, old), new)) in wheels.enumerate() {
            if old == new {
                continue;
            }
            let a = if plant == Plant::BodyOnly {
                self.id.clone()
            } else {
                format!("{}#{name}", self.id)
            };
            let row = |kind: &str, met: ColliderHandle, payload: Payload| {
                let shape = uses.get(&met);
                Raw {
                    kind: occurrence::code(kind).expect("a physics kind"),
                    a: a.clone(),
                    a_use: None,
                    b: shape.map(|s| s.body.clone()),
                    b_use: shape.map(|s| s.index as u32),
                    payload,
                }
            };
            if let Some(h) = old {
                out.push(row("contact_end", *h, Payload::None));
            }
            if let (Some(h), Some(Some((p, n)))) = (new, hits.get(i)) {
                let f = |v: &Vector| [v.x, v.y, v.z];
                let payload = Payload::Contact {
                    point: f(p),
                    normal: f(n),
                };
                out.push(row("contact_begin", *h, payload));
            }
        }
        out
    }
}
