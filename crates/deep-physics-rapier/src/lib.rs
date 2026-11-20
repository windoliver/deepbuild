//! physics.world@1 on Rapier 0.36.1 (issue #2009; canvas primitives: World and backend). A world
//! read by deep-canvas-physics is built in canonical order into one `PhysicsWorld`, stepped once a
//! step with the world's substeps as Rapier's solver iterations, and checkpointed as that world's
//! own bytes, stamped with the backend and the version that wrote them.

use std::collections::BTreeMap;
use std::f32::consts::PI;

use deep_canvas_physics::backend::{
    Backend, BodyState, Canonical, Checkpoint, Held, Hit, Input, JointState, Query, ShapeRef,
    State, Targets, VehicleState, FIELDS,
};
use deep_canvas_physics::bake::{Build, Pin};
use deep_canvas_physics::caps::{Caps, RAPIER2D, RAPIER3D};
use deep_canvas_physics::doc::{
    BodyKind, Breaks, End, Force, Joint, JointKind, Material, Mode, Motor, Pose as DocPose, Read,
    Refusal, Rot, Rule, Shape, World,
};
use deep_canvas_physics::occurrence::Raw;
use rapier3d::control::KinematicCharacterController;
use rapier3d::math::glamx::EulerRot;
use rapier3d::math::{Pose, Rotation};
use rapier3d::parry::query::{self as parry_query, ShapeCastOptions};
use rapier3d::prelude::*;
use serde_json::{json, Value};

/// The planted twin of criterion 4 (#2009 Proof): two public items that name Rapier types.
#[cfg(feature = "test-leaks-rapier")]
pub use rapier3d::prelude::RigidBodyHandle;
#[cfg(feature = "test-leaks-rapier")]
pub fn leaked_world() -> rapier3d::prelude::PhysicsWorld {
    PhysicsWorld::default()
}

mod belt;
pub mod bound;
pub mod cast;
pub mod channels;
mod character;
mod dim2;
mod forces;
pub mod fp;
mod inputs;
mod joints;
mod kinematic;
mod occurrences;
pub mod planted;
pub mod runner;
pub mod scene;
mod soft;
pub mod source;
mod vehicle;
pub use vehicle::Plant as VehiclePlant;

/// #1919 criterion 1's test backend (`test-count-calls`): each backend-interface call this process
/// made, by method, `query`'s by kind (`query.ray`), which `backend_calls` answers.
#[cfg(feature = "test-count-calls")]
pub static CALLS: std::sync::Mutex<BTreeMap<&str, u32>> = std::sync::Mutex::new(BTreeMap::new());

/// Counts one backend-interface call in the test backend; nothing in a shipped build.
fn tally(_method: &'static str) {
    #[cfg(feature = "test-count-calls")]
    if let Ok(mut calls) = CALLS.lock() {
        *calls.entry(_method).or_default() += 1;
    }
}

/// The code of a checkpoint refused at restore.
pub const CHECKPOINT_REFUSED: &str = "physics.checkpoint_refused";

/// `name version f1,f2`, as build.rs writes a resolved crate.
fn pin(text: &str) -> Pin {
    let mut w = text.splitn(3, ' ');
    let mut next = || w.next().unwrap_or_default().to_string();
    let (name, version, features) = (next(), next(), next());
    Pin {
        name,
        version,
        features: features
            .split(',')
            .filter(|f| !f.is_empty())
            .map(String::from)
            .collect(),
    }
}

/// This build as cargo resolved it (build.rs): this crate, rapier3d and the crates under it whose
/// results it depends on, the target triple and rustc.
pub fn build() -> Build {
    built(env!("DEEP_PHYSICS_BACKEND"), env!("DEEP_PHYSICS_PINS"))
}

/// #2098: this build as a 2D world runs on it: rapier2d and the crates under it, so a 2D world's
/// bake key and runtime digest name them, and a 3D world's stay what they were.
pub fn build_2d() -> Build {
    built(
        env!("DEEP_PHYSICS_BACKEND_2D"),
        env!("DEEP_PHYSICS_PINS_2D"),
    )
}

fn built(backend: &str, pins: &str) -> Build {
    Build {
        implementation: env!("CARGO_PKG_NAME").into(),
        version: env!("CARGO_PKG_VERSION").into(),
        backend: pin(backend),
        pins: pins.split(';').filter(|s| !s.is_empty()).map(pin).collect(),
        target: env!("DEEP_PHYSICS_TARGET").into(),
        rustc: env!("DEEP_PHYSICS_RUSTC").into(),
    }
}

/// `x` moved `ulps` f32 values, toward +∞ when positive.
fn by_ulps(x: f32, ulps: i64) -> f32 {
    (0..ulps.unsigned_abs()).fold(x, |v, _| if ulps > 0 { v.next_up() } else { v.next_down() })
}

/// #523's planted wrong programs (its Proof: the flywheel, disc and hanging-body fixtures with
/// their planted twins), each one criterion's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Twin {
    #[default]
    None,
    /// A hinge's `joint_coordinate` is its angle wrapped at ±180°, with no turn count.
    CoordinateWraps,
    /// A restored checkpoint keeps no turn count.
    CheckpointDropsTurns,
    /// The backend caps as before but writes no `fault {kind: speed_cap}`.
    SpeedCapSilent,
    /// A joint's force is its impulse over the whole step, not the substep it came from.
    ForcePerStep,
    /// A kinematic solve that ends its iteration cap past its tolerance reports success.
    SolveCapSuccess,
    /// #191's test backends, each wrong one way: friction combined by the average and
    /// restitution by the minimum whatever the world declares; joint limits skipped; `query()`
    /// blind to collision groups; gravity 2% strong; swept collision off for the whole world; and
    /// sensors left on the engine's default pair filter, which skips kinematic–static pairs.
    FrictionAverage,
    RestitutionMin,
    NoJointLimits,
    QueryIgnoresGroups,
    GravityOff2,
    NoSweep,
    DefaultPairFilter,
    /// #182's wrong character controllers: one that climbs steps a quarter higher than its step
    /// height; one that ignores snap; one whose ground distance is 0.001 m; a character stepped
    /// as a plain kinematic body; one that keeps its upward speed under a ceiling; one that
    /// takes a launch only on the ground; a place that keeps its vertical speed; a crouch that
    /// stands on release; one that resolves each wall of a corner alone; a checkpoint that
    /// leaves out each character's vertical speed; and one that climbs under 45° whatever the
    /// body's slope limit.
    StepsHigher,
    IgnoresSnap,
    GroundNear,
    PlainKinematic,
    KeepsUpward,
    LaunchGroundedOnly,
    PlaceKeepsVertical,
    StandsOnRelease,
    EachWallAlone,
    CheckpointWithoutVertical,
    SlopeIgnored,
    /// #2309's: a check that holds `solver.contact_hz` to a quarter of (step rate × substeps), as
    /// it holds a joint's spring; a contact with a static body held at the same frequency as any
    /// other; and a world that writes no `contact_hz` held at 30 Hz whatever its step.
    ContactsAtAQuarter,
    StaticContactSame,
    Contact30,
    /// #2240's wrong wrappers: one that reads `centre_of_mass` and leaves the weight where the
    /// shapes put it; and one that moves the weight and adds a parallel-axis term to the shapes'
    /// inertia.
    CentreIgnored,
    CentreParallelAxis,
    /// #2239's: a wrapper that drops each body's `ccd`, so none starts a sweep of another body.
    DropsBodyCcd,
    /// #2241's wrong belts: a wrapper that leaves the contact hook out; one that applies a
    /// belt's speed along world +X, however its shape use is turned; and one that takes it
    /// along level ground, not in the contact's plane.
    BeltWithoutHook,
    BeltAlongWorldX,
    BeltAlongLevel,
    /// #2243's wrong wrappers: one that leaves each moved character body's pose stale until the
    /// engine's step, so every character body moves against the last step's poses; and one
    /// whose walker passes into a character body that wants no move, which its own controller
    /// then moves out of the way.
    StalePoses,
    StandingGivesWay,
    /// #2098's: a check that lets a 2D world through to Rapier in 3D, where it goes on to be
    /// built; a wind whose gusts read the platform's sin, not the integer lattice hash; and a
    /// wrapper that reads a body's `inertia` and keeps its shapes'.
    FlatOnRapier3d,
    WindNoiseFromSin,
    InertiaIgnored,
}

/// A Rapier world behind the backend interface.
#[derive(Default)]
pub struct Rapier {
    world: PhysicsWorld,
    /// Each body's handle, in canonical (ID) order.
    bodies: Vec<(String, RigidBodyHandle)>,
    forces: Vec<Force>,
    /// The fixed body a joint end of `world` holds to.
    world_body: Option<RigidBodyHandle>,
    /// Each collider's shape use.
    uses: std::collections::HashMap<ColliderHandle, ShapeRef>,
    step: u64,
    /// The planted twin (#2009 Proof): restore skips the version comparison.
    pub restore_any_version: bool,
    /// #1918: the joints that break at a threshold and those whose motor target a channel sets.
    breakable: Vec<(String, ImpulseJointHandle, Breaks)>,
    /// #523: every joint, by ID, with its kind.
    joints: Vec<(String, ImpulseJointHandle, JointKind)>,
    /// #523: a kinematic world's solve, and the joints its last step jammed on.
    kin: Option<kinematic::Kinematic>,
    jams: Vec<String>,
    /// #523: each output watching levels on a joint's reading: (output, joint, read, levels).
    watched: Vec<(String, String, Read, Vec<f64>)>,
    /// The world's step length, flicks, which a crossing's time counts in.
    step_flicks: i64,
    /// #523's planted twin, if any.
    pub twin: Twin,
    motors: Vec<(String, ImpulseJointHandle, JointKind, Motor)>,
    /// Each tagged shape use's material tag, by (body, shape-use index).
    tags: BTreeMap<(String, u32), String>,
    hit_threshold: f32,
    /// What the last step wrote.
    last: Vec<Raw>,
    /// #1918's test backend (`test-reverse-pairs`): reads every pair last to first, from its
    /// second collider's side.
    reverse_pairs: bool,
    /// The world's shapes, which a query's probe shape names as a compound's children (#1919).
    shapes: BTreeMap<String, Shape>,
    /// #522: each held grab, by body; and the planted restore's: the next step applies no
    /// warm-start impulse.
    grabs: BTreeMap<String, inputs::Grab>,
    cold: bool,
    /// #524: its soft bodies' particles by name, the most particles its capacity holds, and the
    /// steps between its checkpoints.
    soft: soft::Softs,
    particle_capacity: u64,
    checkpoint_every: u64,
    /// #191: a test backend's name and caps in place of Rapier's (`runner::kit`).
    pub test: Option<(&'static str, &'static Caps)>,
    /// #182: the character bodies, in canonical (priority, ID) order; the contacts the step's
    /// places and moves wrote; the world's up and the size of its gravity.
    walkers: Vec<character::Walker>,
    walked: Vec<Raw>,
    up: Vector,
    fall: f32,
    /// #2243: within a step's character moves, what the later ones cast against.
    stage: Option<character::Stage>,
    /// #251: its vehicle bodies, and the wheel contacts this step's places and drives wrote.
    pub(crate) vehicles: vehicle::Vehicles,
    wheel_rows: Vec<Raw>,
    /// #2098: a 2D world, which rapier2d runs in this one's place.
    flat: Option<dim2::World2>,
    /// #2098: the triangles a wind pushes, by body, in the body's frame.
    aero: BTreeMap<String, Vec<deep_canvas_physics::wind::Triangle>>,
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

/// #2240: a body's mass properties with its weight at the written point `at`: its shapes' mass,
/// and their inertia about their own centre, now taken about `at`. The planted wrapper also adds
/// a parallel-axis term for the move, as if the shapes' inertia were being read about another
/// point.
fn centred(shapes: MassProperties, at: Vector, twin: Twin) -> MassProperties {
    if twin != Twin::CentreParallelAxis {
        return MassProperties {
            local_com: at,
            ..shapes
        };
    }
    let d = at - shapes.local_com;
    let term = (Matrix::from_diagonal(Vector::splat(d.length_squared()))
        - Matrix::from_cols(d * d.x, d * d.y, d * d.z))
        * shapes.mass();
    MassProperties::with_inertia_matrix(
        at,
        shapes.mass(),
        shapes.reconstruct_inertia_matrix() + term,
    )
}

/// `shape` as Rapier's, a compound's children read from the world's `shapes`, or `None` when it
/// builds nothing (a flat hull, a degenerate mesh).
fn shared(shapes: &BTreeMap<String, Shape>, shape: &Shape) -> Option<SharedShape> {
    let pts = |p: &[[f64; 3]]| p.iter().map(|x| v3(*x)).collect::<Vec<_>>();
    Some(match shape {
        Shape::Sphere { radius } => SharedShape::ball(*radius as f32),
        Shape::Box { half } => SharedShape::cuboid(half[0] as f32, half[1] as f32, half[2] as f32),
        Shape::Capsule {
            half_height,
            radius,
        } => SharedShape::capsule_y(*half_height as f32, *radius as f32),
        Shape::Cylinder {
            half_height,
            radius,
        } => SharedShape::cylinder(*half_height as f32, *radius as f32),
        Shape::Plane { normal } => SharedShape::halfspace(v3(*normal).normalize()),
        Shape::Convex { points, radius } if *radius > 0.0 => {
            SharedShape::round_convex_hull(&pts(points), *radius as f32)?
        }
        Shape::Convex { points, .. } => SharedShape::convex_hull(&pts(points))?,
        Shape::Mesh {
            vertices,
            triangles,
        } => SharedShape::trimesh(pts(vertices), triangles.clone()).ok()?,
        // #2014: row along +Z, column along +X, in Rapier's column-major layout; no cell zigzags,
        // so each splits as a terrain plate draws it.
        Shape::Heightfield {
            cols,
            rows,
            heights,
            scale,
        } => {
            let mut zx = vec![0.0f32; rows * cols];
            for r in 0..*rows {
                for c in 0..*cols {
                    zx[r + c * rows] = heights[r * cols + c] as f32;
                }
            }
            SharedShape::heightfield(Array2::new(*rows, *cols, zx), v3(*scale))
        }
        Shape::Compound { children } => SharedShape::compound(
            children
                .iter()
                .map(|(id, p)| Some((pose(p), shared(shapes, shapes.get(id)?)?)))
                .collect::<Option<Vec<_>>>()?,
        ),
    })
}

impl Rapier {
    /// The bodies in the order this world built them (#1921: `check`'s `built`).
    pub fn built(&self) -> Vec<String> {
        match &self.flat {
            Some(f) => f.built(),
            None => self.bodies.iter().map(|(id, _)| id.clone()).collect(),
        }
    }

    /// Moves body `id`'s canonical field `field` (an index of `FIELDS`) by `ulps` f32 values: the
    /// one-field shift a golden's locator is proved on (Checkpoint ring). False for no such body.
    pub fn shift(&mut self, id: &str, field: usize, ulps: i64) -> bool {
        let Some((_, h)) = self.bodies.iter().find(|(b, _)| b == id) else {
            return false;
        };
        let rb = &mut self.world.bodies[*h];
        let nudge = |v: Vector, i: usize| {
            let mut a = [v.x, v.y, v.z];
            a[i] = by_ulps(a[i], ulps);
            Vector::new(a[0], a[1], a[2])
        };
        match field {
            0..=2 => rb.set_translation(nudge(rb.translation(), field), true),
            3..=6 => {
                let q = rb.rotation();
                let mut a = [q.x, q.y, q.z, q.w];
                a[field - 3] = by_ulps(a[field - 3], ulps);
                rb.set_rotation(Rotation::from_xyzw(a[0], a[1], a[2], a[3]), true);
            }
            7..=9 => rb.set_linvel(nudge(rb.linvel(), field - 7), true),
            _ => rb.set_angvel(nudge(rb.angvel(), field - 10), true),
        }
        true
    }

    /// A pair of colliders as its two shape uses, the lower first.
    fn pair(&self, c1: ColliderHandle, c2: ColliderHandle) -> Option<(ShapeRef, ShapeRef)> {
        let (a, b) = (self.uses.get(&c1)?.clone(), self.uses.get(&c2)?.clone());
        Some(if a <= b { (a, b) } else { (b, a) })
    }

    /// The narrow-phase tests the last step ran, per pair of shape uses: a composite shape's
    /// sub-shapes tested against the other shape (one manifold each), one for a convex pair or a
    /// sensor's overlap test; sorted by count, most first, then by the pair.
    pub fn narrow_phase_tests(&self) -> Vec<(ShapeRef, ShapeRef, usize)> {
        let mut out: Vec<(ShapeRef, ShapeRef, usize)> = self
            .world
            .narrow_phase
            .contact_pairs()
            .filter_map(|p| {
                let (a, b) = self.pair(p.collider1, p.collider2)?;
                Some((a, b, p.manifolds().len().max(1)))
            })
            .chain(
                self.world
                    .narrow_phase
                    .intersection_pairs()
                    .filter_map(|(c1, c2, _)| {
                        let (a, b) = self.pair(c1, c2)?;
                        Some((a, b, 1))
                    }),
            )
            .collect();
        out.sort_by(|x, y| y.2.cmp(&x.2).then_with(|| (&x.0, &x.1).cmp(&(&y.0, &y.1))));
        out
    }

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
        // #2098: a 2D world's shape, which only rapier2d builds (dim2.rs).
        let Some(shape) = w.shapes.get(&u.shape) else {
            let what = format!(
                "{} is a 2D world's shape, which Rapier in 3D doesn't build",
                u.shape
            );
            out.push(refusal(
                "out_of_range",
                format!("shapes/{}", u.shape),
                Value::Null,
                what,
            ));
            return None;
        };
        if matches!(
            shape,
            Shape::Plane { .. } | Shape::Mesh { .. } | Shape::Heightfield { .. }
        ) && b.kind != BodyKind::Static
        {
            out.push(refusal(
                "out_of_range",
                format!("{path}/shape"),
                json!(u.shape),
                format!(
                    "{} is a plane, a mesh or a heightfield, which only a static body holds",
                    u.shape
                ),
            ));
            return None;
        }
        let Some(shared) = shared(&w.shapes, shape) else {
            out.push(refusal(
                "out_of_range",
                format!("shapes/{}", u.shape),
                Value::Null,
                format!(
                    "{} builds no shape: its points are flat or its triangles degenerate",
                    u.shape
                ),
            ));
            return None;
        };
        let mut c = ColliderBuilder::new(shared);
        let m: &Material = u
            .material
            .as_ref()
            .map_or(&w.defaults, |m| &w.contact_materials[m]);
        c = c
            .position(pose(&u.offset))
            .friction(m.friction as f32)
            .restitution(m.restitution as f32)
            .friction_combine_rule(combine(match self.twin {
                Twin::FrictionAverage => Rule::Average,
                _ => w.friction_rule,
            }))
            .restitution_combine_rule(combine(match self.twin {
                Twin::RestitutionMin => Rule::Min,
                _ => w.restitution_rule,
            }))
            .collision_groups(InteractionGroups::new(
                Group::from_bits_retain(u.member),
                Group::from_bits_retain(u.collides),
                InteractionTestMode::And,
            ))
            .sensor(u.sensor);
        c = belt::carrying(c, m.tangent_speed, self.twin);
        // #191: a sensor reports every body that overlaps it, kinematic ones included, which the
        // engine's default pair filter would skip against a static or kinematic sensor.
        if u.sensor && self.twin != Twin::DefaultPairFilter {
            c = c.active_collision_types(
                ActiveCollisionTypes::default()
                    | ActiveCollisionTypes::KINEMATIC_FIXED
                    | ActiveCollisionTypes::KINEMATIC_KINEMATIC,
            );
        }
        if b.kind != BodyKind::Dynamic || w.mode == Mode::Kinematic || b.mass.is_some() {
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
                if let Some([lo, hi]) = j.limits.filter(|_| self.twin != Twin::NoJointLimits) {
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
                if let Some([lo, hi]) = j.limits.filter(|_| self.twin != Twin::NoJointLimits) {
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
            // #523: couplings Rapier lacks, which only the kinematic solve runs (kinematic.rs).
            JointKind::Gear | JointKind::Pulley => return,
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
        let h = self.world.insert_impulse_joint(h1, h2, data);
        self.joints.push((id.into(), h, j.kind));
        if let Some(b) = &j.breaks_at {
            self.breakable.push((id.into(), h, b.clone()));
        }
        if let Some(m) = j.motor.as_ref().filter(|m| m.channel.is_some()) {
            self.motors.push((id.into(), h, j.kind, m.clone()));
        }
    }

    /// #2098: the backend that runs this world: rapier2d once it has built a 2D one.
    fn pin(&self) -> &'static Caps {
        match self.flat {
            Some(_) => &RAPIER2D,
            None => &RAPIER3D,
        }
    }

    fn handle_of(&self, id: &str) -> Option<RigidBodyHandle> {
        self.bodies.iter().find(|(b, _)| b == id).map(|(_, h)| *h)
    }

    /// #523: body `id`'s mass as its shapes give it, density × volume, kg.
    pub fn shapes_mass(&self, id: &str) -> Option<f64> {
        let rb = &self.world.bodies[self.handle_of(id)?];
        let m: f32 = rb
            .colliders()
            .iter()
            .map(|c| self.world.colliders[*c].mass())
            .sum();
        // #2240, #2098: a body with a written centre of mass or inertia carries its shapes' mass
        // itself.
        Some(f64::from(if m == 0.0 { rb.mass() } else { m }))
    }

    /// #2240: where body `id`'s weight acts, in the world, m: what its `pose` never reads.
    pub(crate) fn centre_of_mass(&self, id: &str) -> Option<[f64; 3]> {
        Some(back(
            self.world.bodies[self.handle_of(id)?].center_of_mass(),
        ))
    }

    /// Sets what a step reads of its scene (#1918): each kinematic body's next position, keeping
    /// its rotation; each channel motor's target, touching the joint only when it changes; and in
    /// kinematic mode the solve's placements, each driven joint at its channel's coordinate (#523:
    /// kinematic.rs).
    fn aim(&mut self, t: &Targets) {
        for (id, pos) in &t.poses {
            if let Some(h) = self.handle_of(id) {
                let rb = &mut self.world.bodies[h];
                let p = Pose::from_parts(v3(*pos), *rb.rotation());
                rb.set_next_kinematic_position(p);
            }
        }
        for (id, h, kind, m) in &self.motors {
            let Some(target) = t.motors.get(id) else {
                continue;
            };
            let (axis, x) = match kind {
                JointKind::Hinge => (JointAxis::AngX, *target as f32 * PI / 180.0),
                _ => (JointAxis::LinX, *target as f32),
            };
            let now = self
                .world
                .impulse_joints
                .get(*h)
                .and_then(|j| j.data.motor(axis));
            if now.is_some_and(|n| {
                if m.velocity {
                    n.target_vel == x
                } else {
                    n.target_pos == x
                }
            }) {
                continue;
            }
            let Some(j) = self.world.impulse_joints.get_mut(*h, true) else {
                continue;
            };
            let (k, c) = spring(m.hz, m.damping_ratio);
            if m.velocity {
                j.data.set_motor_velocity(axis, x, c);
            } else {
                j.data.set_motor_position(axis, x, k, c);
            }
        }
        self.jams = self.solve_step(t).into_iter().collect();
    }
}

impl Rapier {
    /// What `query()` answers, from Rapier's own spatial queries: every shape use `q` meets among
    /// those in `groups`, sorted by distance, then shape use. Only the backend interface calls it,
    /// but for #1919's planted physics.query, which reaches it past the interface.
    pub fn hits(&self, q: &Query, groups: u32) -> Vec<Hit> {
        let w = &self.world;
        // A probe shape as Rapier's, at its pose, with the motion a sweep takes.
        let probe = |shape: &Shape, at: &DocPose, to: [f64; 3]| {
            let (at, s) = (pose(at), shared(&self.shapes, shape)?);
            let motion = v3(to) - at.translation;
            let aabb = s.compute_aabb(&at);
            let end = s.compute_aabb(&Pose::from_parts(v3(to), at.rotation));
            Some((s, at, motion, aabb.merged(&end)))
        };
        let (cast, aabb) = match q {
            Query::Ray { from, dir, max } => {
                let ray = Ray::new(v3(*from), v3(*dir).normalize());
                let max = *max as f32;
                let aabb = Aabb::from_points([ray.origin, ray.point_at(max)]);
                (Err((ray, max)), aabb)
            }
            Query::Sweep { shape, from, to } => match probe(shape, from, to.pos) {
                Some((s, at, motion, aabb)) => (Ok((s, at, motion)), aabb),
                None => return Vec::new(),
            },
            Query::Overlap { shape, at } => match probe(shape, at, at.pos) {
                Some((s, at, motion, aabb)) => (Ok((s, at, motion)), aabb),
                None => return Vec::new(),
            },
        };
        // The distance along the probe at which collider `c` meets it, if it does, with the point
        // it meets in world space and the collider's outward normal there (zero for an overlap).
        let meet = |c: &Collider| -> Option<(f32, Vector, Vector)> {
            match &cast {
                Err((ray, max)) => {
                    // The distance from the plain cast, as #1919's physics.query reads it.
                    let toi = c.shape().cast_ray(c.position(), ray, *max, true)?;
                    let normal = c
                        .shape()
                        .cast_ray_and_get_normal(c.position(), ray, *max, true)
                        .map_or(Vector::ZERO, |i| i.normal);
                    Some((toi, ray.point_at(toi), normal))
                }
                Ok((s, at, motion)) if *motion == Vector::ZERO => {
                    parry_query::intersection_test(at, s.as_ref(), c.position(), c.shape())
                        .ok()?
                        .intersecting
                        .then_some((0.0, Vector::ZERO, Vector::ZERO))
                }
                Ok((s, at, motion)) => {
                    let hit = parry_query::cast_shapes(
                        at,
                        *motion,
                        s.as_ref(),
                        c.position(),
                        Vector::ZERO,
                        c.shape(),
                        ShapeCastOptions::with_max_time_of_impact(1.0),
                    )
                    .ok()??;
                    let (p, n) = (c.position(), c.position().rotation * hit.normal2);
                    Some((
                        hit.time_of_impact * motion.length(),
                        p.transform_point(hit.witness2),
                        n,
                    ))
                }
            }
        };
        let member =
            |_: ColliderHandle, c: &Collider| c.collision_groups().memberships.bits() & groups != 0;
        let filter = QueryFilter::default().predicate(&member);
        // A world never stepped has no broad-phase tree yet; after a step, the tree's boxes hold
        // each collider's current pose, so only those under the probe's box are tested.
        let candidates: Vec<(ColliderHandle, &Collider)> = if self.step == 0 {
            w.all_colliders()
                .filter(|(h, c)| c.is_enabled() && member(*h, c))
                .collect()
        } else if let Err((ray, max)) = &cast {
            // #213: a ray walks the tree along itself, so only the colliders it meets are tested.
            w.intersect_ray(*ray, *max, true, filter)
                .map(|(h, c, _)| (h, c))
                .collect()
        } else {
            w.intersect_aabb_conservative(aabb, filter).collect()
        };
        let mut hits: Vec<Hit> = candidates
            .into_iter()
            .filter_map(|(h, c)| {
                let (distance, point, normal) = meet(c)?;
                let f = |v: Vector| [v.x, v.y, v.z].map(f64::from);
                Some(Hit {
                    shape: self.uses.get(&h)?.clone(),
                    distance: f64::from(distance),
                    point: f(point),
                    normal: f(normal),
                })
            })
            .collect();
        hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.shape.cmp(&b.shape))
        });
        hits
    }
}

impl Backend for Rapier {
    fn id(&self) -> String {
        match self.test {
            Some((name, _)) => name.into(),
            None => format!("{}@{}", self.pin().backend, self.pin().version),
        }
    }

    fn caps(&self) -> &'static Caps {
        self.test.map_or(self.pin(), |t| t.1)
    }

    fn build(&mut self, w: &World) -> Result<(), Vec<Refusal>> {
        tally("build");
        self.flat = None;
        if w.dimensions == 2 && self.twin != Twin::FlatOnRapier3d {
            self.flat = Some(dim2::World2::build(w)?);
            return Ok(());
        }
        let mut out = Vec::new();
        self.world = PhysicsWorld::default();
        self.world_body = None;
        self.bodies.clear();
        self.uses.clear();
        self.breakable.clear();
        self.joints.clear();
        self.motors.clear();
        self.jams.clear();
        self.watched = w
            .outputs
            .iter()
            .filter(|(_, o)| !o.crossings.is_empty())
            .map(|(id, o)| (id.clone(), o.from.clone(), o.read, o.crossings.clone()))
            .collect();
        self.step_flicks = deep_canvas_physics::occurrence::step_flicks(w);
        self.last.clear();
        self.shapes = w.shapes.clone();
        self.hit_threshold = w.solver.hit_threshold as f32;
        self.tags = w
            .bodies
            .iter()
            .flat_map(|(id, b)| b.shapes.iter().enumerate().map(move |(i, u)| (id, i, u)))
            .filter_map(|(id, i, u)| {
                let tag = w.contact_materials.get(u.material.as_ref()?)?.tag.clone()?;
                Some(((id.clone(), i as u32), tag))
            })
            .collect();
        self.step = 0;
        self.world.gravity = v3(w.gravity);
        if self.twin == Twin::GravityOff2 {
            self.world.gravity *= 1.02;
        }
        let p = &mut self.world.integration_parameters;
        p.dt = (1.0 / w.step_rate) as f32;
        // The world's substeps are the solver's iterations, not repeated steps (World and backend).
        p.num_solver_iterations = w.substeps as usize;
        p.contact_softness =
            SpringCoefficients::new(w.solver.contact_hz as f32, w.solver.contact_damping as f32);
        // Rapier holds a contact with a fixed body at twice the frequency; the world keeps that.
        let fixed = if self.twin == Twin::StaticContactSame { 1.0 } else { 2.0 };
        p.static_contact_softness = SpringCoefficients::new(
            fixed * w.solver.contact_hz as f32,
            w.solver.contact_damping as f32,
        );
        p.normalized_max_linear_velocity = w.solver.max_speed as f32;
        p.max_ccd_substeps = usize::from(w.solver.ccd && self.twin != Twin::NoSweep);
        let mut handles = BTreeMap::new();
        for id in deep_canvas_physics::occurrence::built_order(w) {
            let b = &w.bodies[id];
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
            // In kinematic mode the solve places every body that isn't static (#1918).
            let builder = match b.kind {
                BodyKind::Static => RigidBodyBuilder::fixed(),
                BodyKind::Dynamic if w.mode != Mode::Kinematic => RigidBodyBuilder::dynamic(),
                // #182: a character body never sleeps, so its controller's target always moves it.
                BodyKind::Character => {
                    RigidBodyBuilder::kinematic_position_based().can_sleep(false)
                }
                _ => RigidBodyBuilder::kinematic_position_based(),
            };
            let ccd = b.ccd && !matches!(self.twin, Twin::NoSweep | Twin::DropsBodyCcd);
            let mut rb = builder
                .pose(pose(&b.pose))
                .linvel(v3(b.linear))
                .angvel(deg(b.angular))
                .linear_damping(b.linear_damping as f32)
                .angular_damping(b.angular_damping as f32)
                .gravity_scale(b.gravity_scale as f32)
                .ccd_enabled(ccd)
                // #191: a body with ccd is also met by the contacts its next step reaches, so its
                // contact begins in the step it hits, not the one after.
                .soft_ccd_prediction(if ccd {
                    (w.solver.max_speed / w.step_rate) as f32
                } else {
                    0.0
                })
                .can_sleep(b.sleep && w.solver.sleep.on && b.kind != BodyKind::Character)
                .enabled(b.active)
                .locked_axes(locks)
                .build();
            let a = rb.activation_mut();
            a.normalized_linear_threshold = w.solver.sleep.speed as f32;
            a.time_until_sleep = w.solver.sleep.time as f32;
            let colliders: Vec<(usize, ColliderBuilder)> = (0..b.shapes.len())
                .filter_map(|i| Some((i, self.collider(w, id, b, i, &mut out)?)))
                .collect();
            let h = self.world.insert_body(rb);
            // A body's mass, when set, is shared among its shapes by volume.
            let volumes: Vec<f32> = colliders
                .iter()
                .map(|(_, c)| c.shape.mass_properties(1.0).mass())
                .collect();
            let total: f32 = volumes.iter().sum();
            // #2240: a written centre of mass, which the body carries in its shapes' place.
            let centre = b
                .centre_of_mass
                .filter(|_| self.world.bodies[h].is_dynamic() && self.twin != Twin::CentreIgnored);
            // #2098: a written inertia stands in place of the shapes' at their mass, about their
            // centre of mass or the written one, so the body carries it in their place too.
            let written = b.inertia.filter(|_| {
                b.kind == BodyKind::Dynamic
                    && w.mode != Mode::Kinematic
                    && self.twin != Twin::InertiaIgnored
            });
            let mut weight = MassProperties::default();
            for ((index, c), vol) in colliders.into_iter().zip(volumes) {
                let mut c = match b.mass {
                    Some(m) if b.kind == BodyKind::Dynamic && total > 0.0 => {
                        c.mass(m as f32 * vol / total)
                    }
                    _ => c,
                };
                if centre.is_some() || written.is_some() {
                    weight += c
                        .mass_properties
                        .mass_properties(&*c.shape)
                        .transform_by(&c.position);
                    c = c.density(0.0);
                }
                let ch = self.world.insert_collider(c, Some(h));
                self.uses.insert(
                    ch,
                    ShapeRef {
                        body: id.clone(),
                        index,
                    },
                );
            }
            if centre.is_some() || written.is_some() {
                let whole = centre.map_or(weight, |at| centred(weight, v3(at), self.twin));
                let whole = written.map_or(whole, |i| {
                    MassProperties::new(whole.local_com, whole.mass(), v3(i))
                });
                let rb = &mut self.world.bodies[h];
                rb.set_additional_mass_properties(whole, false);
                rb.recompute_mass_properties_from_colliders(&self.world.colliders);
            }
            handles.insert(id.clone(), h);
            self.bodies.push((id.clone(), h));
        }
        self.aero = forces::aero(w);
        for (id, j) in &w.joints {
            self.joint(&handles, id, j, &mut out);
        }
        self.vehicles.build(w, &handles);
        self.kinematic(w);
        self.walked.clear();
        self.characters_build(w);
        self.soft.build(w, &mut self.world, &handles);
        self.particle_capacity = w.capacity.get("particles").copied().unwrap_or(u64::MAX);
        self.checkpoint_every = w.checkpoint_every;
        self.forces = w.forces.values().cloned().collect();
        if out.is_empty() {
            Ok(())
        } else {
            Err(out)
        }
    }

    fn step(&mut self, inputs: &[Input], targets: &Targets) -> Result<(), Box<Refusal>> {
        tally("step");
        if let Some(f) = &mut self.flat {
            f.step();
            return Ok(());
        }
        self.wheel_rows.clear();
        let resting = self.vehicles.resting(&self.world);
        self.apply(inputs)?;
        self.walk();
        let before = self.before();
        let start = self.start();
        let watched = self.readings();
        self.aim(targets);
        self.push();
        let vehicles = self.vehicles.ids();
        let belts = belt::Belts {
            twin: self.twin,
            up: self.up,
        };
        // #251: a world never stepped has no broad phase yet, so a wheel's ray would meet nothing
        // on the first step; it is built first, as the world stands.
        if self.step == 0 && !vehicles.is_empty() {
            // #2306: a joint puts its bodies in the engine's islands when it is inserted, before
            // any step, and the collision pass then takes every body's insertion without putting
            // the rest in them, which a debug build refuses; so a world with a joint seeds only
            // its broad phase's boxes, and its first step finds its contacts.
            if self.world.impulse_joints.is_empty() {
                self.world.detect_collisions(&belts, &());
            } else {
                let params = self.world.integration_parameters;
                let enabled = self.world.colliders.iter().filter(|(_, c)| c.is_enabled());
                let all: Vec<ColliderHandle> = enabled.map(|(h, _)| h).collect();
                for h in all {
                    let aabb = self.world.colliders[h]
                        .compute_broad_phase_aabb(&params, &self.world.bodies);
                    self.world.broad_phase.set_aabb(&params, h, aabb);
                }
            }
        }
        for id in vehicles {
            self.drive_vehicle(&id)?;
        }
        self.pull();
        let (particles, quarantined) = (
            self.soft.particles(&self.world),
            self.soft.quarantined(&self.world),
        );
        let warm = self.world.integration_parameters.warmstart_coefficient;
        if std::mem::take(&mut self.cold) {
            self.world.integration_parameters.warmstart_coefficient = 0.0;
        }
        let torn = self.soft.step(&mut self.world, &belts);
        self.world.integration_parameters.warmstart_coefficient = warm;
        self.step += 1;
        self.vehicles.rouse(&mut self.world, &resting);
        self.last = self.gather(&before);
        self.last.append(&mut self.walked);
        let turned = self.turned(&start);
        self.last.extend(turned);
        let broken = self.breaks();
        self.last.extend(broken);
        let crossed = self.crossings(&watched);
        self.last.extend(crossed);
        let jams: Vec<Raw> = self.jams.iter().map(|j| joints::fault(j, "jam")).collect();
        self.last.extend(jams);
        self.last.extend(torn);
        self.last.append(&mut self.wheel_rows);
        let touched = self.vehicles.touch(&self.world, &self.uses);
        self.last.extend(touched);
        let faults = self.soft_faults(particles, &quarantined);
        self.last.extend(faults);
        // #524: a world with soft bodies continues from its own checkpoint at every checkpoint's
        // step, since the engine's checkpoint leaves out caches its soft contacts keep; so a run
        // and a seek from any checkpoint pass through the same states.
        if self.soft.has_any() && self.step.is_multiple_of(self.checkpoint_every.max(1)) {
            let (last, cp) = (std::mem::take(&mut self.last), self.checkpoint());
            self.restore(&cp)?;
            self.last = last;
        }
        Ok(())
    }

    fn occurrences(&self) -> Vec<Raw> {
        tally("occurrences");
        match &self.flat {
            Some(f) => f.last.clone(),
            None => self.last.clone(),
        }
    }

    fn read(&self) -> State {
        tally("read");
        if let Some(f) = &self.flat {
            return f.read();
        }
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
                    ..self.measured(rb)
                }
            })
            .collect();
        State {
            step: self.step,
            bodies,
            soft: self.soft.read(&self.world),
        }
    }

    fn canonical(&self) -> Vec<Canonical> {
        tally("canonical");
        if let Some(f) = &self.flat {
            return f.canonical();
        }
        self.bodies
            .iter()
            .map(|(id, h)| {
                let rb = &self.world.bodies[*h];
                let (p, q, v, w) = (rb.translation(), rb.rotation(), rb.linvel(), rb.angvel());
                Canonical {
                    id: id.clone(),
                    values: vec![
                        p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z,
                    ],
                    names: &FIELDS,
                }
            })
            .chain(self.character_canonical())
            .chain(self.vehicles.canonical())
            .chain(self.soft.canonical(&self.world))
            .collect()
    }

    fn held(&self) -> Held {
        if let Some(f) = &self.flat {
            return f.held();
        }
        let (rigid_bodies, joints) = self.rigid_held();
        Held {
            rigid_bodies,
            joints,
            soft: self.soft.held(&self.world),
        }
    }

    fn joints(&self) -> Vec<JointState> {
        match self.flat {
            Some(_) => Vec::new(),
            None => self.joint_states(),
        }
    }

    fn checkpoint(&self) -> Checkpoint {
        tally("checkpoint");
        if let Some(f) = &self.flat {
            return f.checkpoint();
        }
        Checkpoint {
            backend: RAPIER3D.backend.into(),
            version: RAPIER3D.version.into(),
            features: RAPIER3D.features.iter().map(|f| f.to_string()).collect(),
            step: self.step,
            state: [
                bincode::serialize(&self.world).expect("a Rapier world serializes"),
                self.vehicles.bytes(),
                self.soft.bytes(),
                self.character_bytes(),
                self.grab_bytes(),
            ]
            .concat(),
        }
    }

    fn restore(&mut self, cp: &Checkpoint) -> Result<(), Box<Refusal>> {
        tally("restore");
        let pin = self.pin();
        if !self.restore_any_version && (cp.backend != pin.backend || cp.version != pin.version) {
            return Err(Box::new(refusal(
                CHECKPOINT_REFUSED,
                "checkpoint/version".into(),
                json!(format!("{}@{}", cp.backend, cp.version)),
                format!(
                    "the checkpoint was written by {} {} and this build pins {} {}; checkpoints never mix across backend versions, so it was refused and nothing was loaded",
                    cp.backend, cp.version, pin.backend, pin.version
                ),
            )));
        }
        let mut rest = &cp.state[..];
        let unread = |e: bincode::Error| {
            Box::new(refusal(
                CHECKPOINT_REFUSED,
                "checkpoint/state".into(),
                Value::Null,
                format!(
                    "the checkpoint's state doesn't load as a {} {} world: {e}; nothing was loaded",
                    pin.backend, pin.version
                ),
            ))
        };
        if let Some(f) = &mut self.flat {
            f.world = bincode::deserialize_from(&mut rest).map_err(unread)?;
            (f.step, f.last) = (cp.step, Vec::new());
            return Ok(());
        }
        let world: PhysicsWorld = bincode::deserialize_from(&mut rest).map_err(unread)?;
        self.world = world;
        let rest = self.vehicles.restore(rest);
        let rest = self.soft.restore(rest);
        let rest = self.characters_of(rest);
        self.grabs = Rapier::grabs_of(rest);
        self.step = cp.step;
        self.last.clear();
        if self.twin == Twin::CheckpointDropsTurns {
            self.drop_turns();
        }
        Ok(())
    }

    fn query(&self, q: &Query, groups: u32) -> Vec<Hit> {
        tally(match q {
            Query::Ray { .. } => "query.ray",
            Query::Sweep { .. } => "query.sweep",
            Query::Overlap { .. } => "query.overlap",
        });
        let groups = if self.twin == Twin::QueryIgnoresGroups {
            u32::MAX
        } else {
            groups
        };
        self.hits(q, groups)
    }

    fn characters(&self) -> Vec<deep_canvas_physics::backend::CharacterState> {
        self.character_states()
    }

    fn move_character(
        &mut self,
        body: &str,
        translation: [f64; 3],
    ) -> Result<[f64; 3], Box<Refusal>> {
        tally("move_character");
        let refuse = |what: String| {
            Box::new(refusal(
                "physics.not_character",
                format!("bodies/{body}"),
                json!(body),
                what,
            ))
        };
        let h = self
            .handle_of(body)
            .ok_or_else(|| refuse(format!("{body} isn't a body of this world")))?;
        let rb = &self.world.bodies[h];
        let shape = rb.colliders().first().map(|c| &self.world.colliders[*c]);
        let Some(c) = shape.filter(|_| rb.is_kinematic()) else {
            return Err(refuse(format!(
                "{body} isn't a kinematic body with a shape, so no character controller moves it"
            )));
        };
        let moved = KinematicCharacterController::default().move_shape(
            self.world.integration_parameters.dt,
            &self
                .world
                .query_pipeline_with_filter(QueryFilter::default().exclude_rigid_body(h)),
            c.shape(),
            c.position(),
            v3(translation),
            |_| {},
        );
        let to = rb.translation() + moved.translation;
        self.world.bodies[h].set_next_kinematic_translation(to);
        Ok(back(moved.translation))
    }

    fn drive_vehicle(&mut self, body: &str) -> Result<(), Box<Refusal>> {
        tally("drive_vehicle");
        self.vehicles.drive(body, &mut self.world).ok_or_else(|| {
            let what = format!("{body} isn't a vehicle body, so no vehicle controller moves it");
            let path = format!("bodies/{body}");
            Box::new(refusal("physics.not_vehicle", path, json!(body), what))
        })
    }

    fn vehicles(&self) -> Vec<VehicleState> {
        self.vehicles.read()
    }

    /// Each collider's own ray cast at its placed pose, so a world never stepped answers too.
    fn ray(&self, from: [f64; 3], dir: [f64; 3], max: f64) -> Option<f64> {
        tally("ray");
        let ray = Ray::new(v3(from), v3(dir));
        self.world
            .colliders
            .iter()
            .filter_map(|(_, c)| c.shape().cast_ray(c.position(), &ray, max as f32, true))
            .min_by(f32::total_cmp)
            .map(f64::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A static 2 × 2 m height field of 3 × 3 samples, raised only at its (column 2, row 0)
    /// corner, through the physics document and the backend interface.
    #[test]
    fn a_ray_down_meets_a_heightfield_on_its_shipped_split() {
        let mut heights = vec![0.0; 9];
        heights[2] = 1.0;
        let doc = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
            "gravity": [0, 0, 0], "mode": "dynamic",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "shapes": {"land": {"kind": "heightfield", "cols": 3, "rows": 3, "heights": heights, "scale": [2, 1, 2]}},
            "bodies": {"ground": {"kind": "static", "shapes": [{"shape": "land"}]}}
        });
        let w =
            deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
                .unwrap_or_else(|e| panic!("{e:?}"));
        let mut b = Rapier::default();
        b.build(&w).unwrap();
        let down = [0.0, -1.0, 0.0];
        // The raised cell's centre lies on the diagonal through its raised corner: 0.5 m.
        let k = b.ray([0.5, 2.0, -0.5], down, 10.0).unwrap();
        assert!((2.0 - k - 0.5).abs() < 1e-6, "{k}");
        assert!((2.0 - b.ray([-0.5, 2.0, 0.5], down, 10.0).unwrap()).abs() < 1e-6);
        assert_eq!(b.ray([5.0, 2.0, 0.0], down, 10.0), None);
    }

    /// #2240: a body that leaves its mass to its shapes still reads that mass, density × volume,
    /// with its centre of mass written, so #523's mass-ratio check reads it as before.
    #[test]
    fn a_written_centre_of_mass_keeps_the_mass_the_shapes_give() {
        let body = |centre: Option<[f64; 3]>| {
            let mut b =
                json!({"kind": "dynamic", "shapes": [{"shape": "box", "contact_material": "m"}]});
            if let Some(c) = centre {
                b["centre_of_mass"] = json!(c);
            }
            b
        };
        let doc = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
            "gravity": [0, 0, 0], "mode": "dynamic",
            "capacity": {"bodies": 2, "shapes": 2, "joints": 0, "contacts": 0, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 250}},
            "shapes": {"box": {"kind": "box", "half": [0.5, 1.0, 0.5]}},
            "bodies": {"bare": body(None), "low": body(Some([0.0, -0.75, 0.0]))}
        });
        let w =
            deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
                .unwrap_or_else(|e| panic!("{e:?}"));
        let mut b = Rapier::default();
        b.build(&w).unwrap();
        // 250 kg/m³ × 1 × 2 × 1 m, as f32 holds it.
        let bare = b.shapes_mass("bare").unwrap();
        assert!((bare - 500.0).abs() < 1e-3, "{bare}");
        assert_eq!(b.shapes_mass("low"), Some(bare));
    }

    /// #2240: the bounds the check holds a centre of mass to are those of the shapes as built: a
    /// box turned by degrees about three axes, a capsule turned by a quaternion, a rounded hull
    /// and a compound of a turned box and a turned cylinder, each at an offset.
    #[test]
    fn the_bounds_a_centre_of_mass_is_held_to_are_the_built_shapes() {
        let turned = [0.1, 0.2, 0.3, 0.9];
        let child = |shape: &str, pos: [f64; 3], rot: Value| json!({"shape": shape, "pose": {"pos": pos, "rot": rot}});
        let body = |shape: &str, pos: [f64; 3], rot: Value| json!({"kind": "dynamic", "shapes": [{"shape": shape, "contact_material": "m", "offset": {"pos": pos, "rot": rot}}]});
        let doc = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 60, "substeps": 1,
            "gravity": [0, 0, 0], "mode": "dynamic",
            "capacity": {"bodies": 4, "shapes": 8, "joints": 0, "contacts": 0, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 1000}},
            "shapes": {"box": {"kind": "box", "half": [0.5, 1.0, 0.25]},
                       "pill": {"kind": "capsule", "half_height": 0.6, "radius": 0.2},
                       "can": {"kind": "cylinder", "half_height": 0.7, "radius": 0.3},
                       "hull": {"kind": "convex", "points": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], "radius": 0.05},
                       "pair": {"kind": "compound", "children": [child("box", [1.0, 0.0, 0.0], json!([10, 20, 30])),
                                                                 child("can", [0.0, 2.0, 0.0], json!(turned))]}},
            "bodies": {"a": body("box", [0.1, 0.2, 0.3], json!([30, 40, 50])),
                       "b": body("pill", [-0.3, 0.0, 0.2], json!(turned)),
                       "c": body("hull", [0.0, 0.5, 0.0], json!([0, 0, 75])),
                       "d": body("pair", [0.4, -0.1, 0.0], json!([0, 0, 0]))}
        });
        let w =
            deep_canvas_physics::check::check(&doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
                .unwrap_or_else(|e| panic!("{e:?}"));
        let mut b = Rapier::default();
        b.build(&w).unwrap();
        for (id, h) in &b.bodies {
            let built = b.world.bodies[*h]
                .colliders()
                .iter()
                .map(|c| b.world.colliders[*c].compute_aabb())
                .reduce(|x, y| x.merged(&y))
                .unwrap();
            let (lo, hi) =
                deep_canvas_physics::doc::bounds(&w.shapes, &w.bodies[id].shapes).unwrap();
            for (read, built) in [(lo, built.mins), (hi, built.maxs)] {
                let off = (v3(read) - built).abs().max_element();
                assert!(off < 1e-5, "{id}: {read:?} at check, {built:?} built");
            }
        }
    }
}
