//! #2098: physics.world@1 with `dimensions: 2` on rapier2d 0.36.1, beside the 3D world and behind
//! the same backend interface (World and backend). It runs a 2D world's static and dynamic bodies
//! on its shapes (`circle`, `segment`, `polygon`, `chain`), with its contact materials, combine
//! rules and collision groups, and writes its contacts, rests and speed caps; what it doesn't run
//! yet the world check refuses. A point is (x, y) and a turn is about +Z, so every state reads
//! back with z at 0 and its rotation about +Z.

use std::collections::{BTreeMap, BTreeSet};
use std::f32::consts::PI;

use deep_canvas_physics::backend::{BodyState, Canonical, Checkpoint, Held, State, FLAT_FIELDS};
use deep_canvas_physics::caps::RAPIER2D;
use deep_canvas_physics::doc::{Body, BodyKind, Flat, Material, Refusal, Rot, Rule, World};
use deep_canvas_physics::occurrence::{built_order, code, Payload, Raw};
use rapier2d::prelude::*;
use serde_json::{json, Value};

use crate::refusal;

/// Rapier's cap on a body's turn in one step (its solver's `MAX_ROTATION`), rad.
const MAX_TURN: f32 = PI / 4.0;

type Key = (u32, u32);
/// A pair as the engine holds it: (collider1, collider2).
type Pair = (Key, Key);

/// The world as a step found it: its touching pairs, and each body's sleep, velocity, turn rate
/// and centre of mass, in the bodies' order.
struct Before {
    touching: BTreeSet<Pair>,
    bodies: Vec<(bool, Vector, f32, Vector)>,
}

/// A 2D world on rapier2d.
#[derive(Default)]
pub(crate) struct World2 {
    pub(crate) world: PhysicsWorld,
    /// Each body's handle, in canonical (ID) order.
    bodies: Vec<(String, RigidBodyHandle)>,
    pub(crate) step: u64,
    /// Each tagged shape use's material tag, by (body, shape-use index).
    tags: BTreeMap<(String, u32), String>,
    hit_threshold: f32,
    /// What the last step wrote.
    pub(crate) last: Vec<Raw>,
}

fn v2(a: [f64; 3]) -> Vector {
    Vector::new(a[0] as f32, a[1] as f32)
}

fn back(v: Vector) -> [f64; 3] {
    [f64::from(v.x), f64::from(v.y), 0.0]
}

/// A pose's turn about +Z, rad: a 2D world writes it in degrees (`doc::dim2`).
fn turn(r: &Rot) -> f32 {
    match r {
        Rot::Deg(d) => d[2] as f32 * PI / 180.0,
        Rot::Quat(_) => 0.0,
    }
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

/// `shape` as Rapier's, or `None` when it builds nothing: a polygon whose points lie on a line.
fn shared(shape: &Flat) -> Option<SharedShape> {
    let pts = |p: &[[f64; 2]]| -> Vec<Vector> {
        p.iter()
            .map(|x| Vector::new(x[0] as f32, x[1] as f32))
            .collect()
    };
    match shape {
        Flat::Circle { radius } => Some(SharedShape::ball(*radius as f32)),
        Flat::Segment { a, b } => {
            let ends = pts(&[*a, *b]);
            Some(SharedShape::segment(ends[0], ends[1]))
        }
        Flat::Polygon { points } => SharedShape::convex_hull(&pts(points)),
        Flat::Chain { points, closed } => {
            let n = points.len() as u32;
            let mut links: Vec<[u32; 2]> = (1..n).map(|i| [i - 1, i]).collect();
            if *closed {
                links.push([n - 1, 0]);
            }
            Some(SharedShape::polyline(pts(points), Some(links)))
        }
    }
}

/// Shape use `i` of body `id` as a collider, or its refusal: a segment or a chain, which has no
/// area to weigh, on a body that isn't static; a shape that builds nothing; or a dynamic body
/// with neither a mass nor a density.
fn collider(
    w: &World,
    id: &str,
    b: &Body,
    i: usize,
    out: &mut Vec<Refusal>,
) -> Option<ColliderBuilder> {
    let u = &b.shapes[i];
    let shape = &w.flat[&u.shape];
    if matches!(shape, Flat::Segment { .. } | Flat::Chain { .. }) && b.kind != BodyKind::Static {
        out.push(refusal(
            "out_of_range",
            format!("bodies/{id}/shapes/{i}/shape"),
            json!(u.shape),
            format!(
                "{} is a segment or a chain, which has no area to weigh, so only a static body holds it",
                u.shape
            ),
        ));
        return None;
    }
    let Some(shared) = shared(shape) else {
        out.push(refusal(
            "out_of_range",
            format!("shapes/{}", u.shape),
            Value::Null,
            format!("{} builds no 2D shape: its points lie on one line", u.shape),
        ));
        return None;
    };
    let m: &Material = u
        .material
        .as_ref()
        .map_or(&w.defaults, |m| &w.contact_materials[m]);
    let c = ColliderBuilder::new(shared)
        .position(Pose::new(v2(u.offset.pos), turn(&u.offset.rot)))
        .friction(m.friction as f32)
        .restitution(m.restitution as f32)
        .friction_combine_rule(combine(w.friction_rule))
        .restitution_combine_rule(combine(w.restitution_rule))
        .collision_groups(InteractionGroups::new(
            Group::from_bits_retain(u.member),
            Group::from_bits_retain(u.collides),
            InteractionTestMode::And,
        ));
    if b.kind != BodyKind::Dynamic || b.mass.is_some() {
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

impl World2 {
    /// `w` built in canonical order, or the refusals that stop it.
    pub(crate) fn build(w: &World) -> Result<Self, Vec<Refusal>> {
        let mut out = Vec::new();
        let mut me = Self {
            hit_threshold: w.solver.hit_threshold as f32,
            ..Self::default()
        };
        me.world.gravity = v2(w.gravity);
        let p = &mut me.world.integration_parameters;
        p.dt = (1.0 / w.step_rate) as f32;
        // The world's substeps are the solver's iterations, not repeated steps (World and backend).
        p.num_solver_iterations = w.substeps as usize;
        let (hz, damping) = (w.solver.contact_hz as f32, w.solver.contact_damping as f32);
        p.contact_softness = SpringCoefficients::new(hz, damping);
        // Rapier holds a contact with a fixed body at twice the frequency; the world keeps that.
        p.static_contact_softness = SpringCoefficients::new(2.0 * hz, damping);
        p.normalized_max_linear_velocity = w.solver.max_speed as f32;
        p.max_ccd_substeps = 0;
        for id in built_order(w) {
            let b = &w.bodies[id];
            let mut locks = LockedAxes::empty();
            let flags = [
                (b.lock_linear[0], LockedAxes::TRANSLATION_LOCKED_X),
                (b.lock_linear[1], LockedAxes::TRANSLATION_LOCKED_Y),
                (b.lock_angular[2], LockedAxes::ROTATION_LOCKED_Z),
            ];
            for (on, f) in flags {
                if on {
                    locks |= f;
                }
            }
            let builder = match b.kind {
                BodyKind::Dynamic => RigidBodyBuilder::dynamic(),
                _ => RigidBodyBuilder::fixed(),
            };
            let mut rb = builder
                .pose(Pose::new(v2(b.pose.pos), turn(&b.pose.rot)))
                .linvel(v2(b.linear))
                .angvel(b.angular[2] as f32 * PI / 180.0)
                .linear_damping(b.linear_damping as f32)
                .angular_damping(b.angular_damping as f32)
                .gravity_scale(b.gravity_scale as f32)
                .can_sleep(b.sleep && w.solver.sleep.on)
                .enabled(b.active)
                .locked_axes(locks)
                .build();
            let a = rb.activation_mut();
            a.normalized_linear_threshold = w.solver.sleep.speed as f32;
            a.time_until_sleep = w.solver.sleep.time as f32;
            let colliders: Vec<(usize, ColliderBuilder)> = (0..b.shapes.len())
                .filter_map(|i| Some((i, collider(w, id, b, i, &mut out)?)))
                .collect();
            let h = me.world.insert_body(rb);
            // A body's mass, when set, is shared among its shapes by area.
            let areas: Vec<f32> = colliders
                .iter()
                .map(|(_, c)| c.shape.mass_properties(1.0).mass())
                .collect();
            let total: f32 = areas.iter().sum();
            for ((i, c), area) in colliders.into_iter().zip(areas) {
                let c = match b.mass {
                    Some(m) if b.kind == BodyKind::Dynamic && total > 0.0 => {
                        c.mass(m as f32 * area / total)
                    }
                    _ => c,
                };
                me.world.insert_collider(c, Some(h));
                let tag = b.shapes[i].material.as_ref();
                let tag = tag.and_then(|m| w.contact_materials[m].tag.clone());
                me.tags.extend(tag.map(|t| ((id.clone(), i as u32), t)));
            }
            me.bodies.push((id.clone(), h));
        }
        if out.is_empty() {
            Ok(me)
        } else {
            Err(out)
        }
    }

    /// The bodies in the order this world built them.
    pub(crate) fn built(&self) -> Vec<String> {
        self.bodies.iter().map(|(id, _)| id.clone()).collect()
    }

    pub(crate) fn held(&self) -> Held {
        Held {
            rigid_bodies: self.bodies.len(),
            joints: 0,
            soft: Vec::new(),
        }
    }

    pub(crate) fn step(&mut self) {
        let before = self.before();
        self.world.step();
        self.step += 1;
        self.last = self.gather(&before);
    }

    pub(crate) fn read(&self) -> State {
        let bodies = self
            .bodies
            .iter()
            .map(|(id, h)| {
                let rb = &self.world.bodies[*h];
                // Its turn about +Z as the quaternion every state carries.
                let half = Rotation::new(rb.rotation().angle() / 2.0);
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
                    rot: [0.0, 0.0, f64::from(half.im), f64::from(half.re)],
                    linear: back(rb.linvel()),
                    angular: [0.0, 0.0, f64::from(rb.angvel() * (180.0 / PI))],
                    contact_impulse: f64::from(impulse.length()),
                    sleeping: rb.is_sleeping(),
                }
            })
            .collect();
        State {
            step: self.step,
            bodies,
            soft: Vec::new(),
        }
    }

    pub(crate) fn canonical(&self) -> Vec<Canonical> {
        self.bodies
            .iter()
            .map(|(id, h)| {
                let rb = &self.world.bodies[*h];
                let (p, r, v) = (rb.translation(), rb.rotation(), rb.linvel());
                Canonical {
                    id: id.clone(),
                    values: vec![p.x, p.y, r.re, r.im, v.x, v.y, rb.angvel()],
                    names: &FLAT_FIELDS,
                }
            })
            .collect()
    }

    pub(crate) fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            backend: RAPIER2D.backend.into(),
            version: RAPIER2D.version.into(),
            features: RAPIER2D.features.iter().map(|f| f.to_string()).collect(),
            step: self.step,
            state: bincode::serialize(&self.world).expect("a Rapier world serializes"),
        }
    }

    fn before(&self) -> Before {
        let touching = self.world.contact_pairs();
        let touching = touching.filter(|p| p.has_any_active_contact());
        let key = |p: &ContactPair| (p.collider1.into_raw_parts(), p.collider2.into_raw_parts());
        let at = |(_, h): &(String, RigidBodyHandle)| {
            let rb = &self.world.bodies[*h];
            (
                rb.is_sleeping(),
                rb.linvel(),
                rb.angvel(),
                rb.center_of_mass(),
            )
        };
        Before {
            touching: touching.map(key).collect(),
            bodies: self.bodies.iter().map(at).collect(),
        }
    }

    /// What the step that ran since `before` wrote: contacts begun, with a `hit` when one's normal
    /// approach speed before the solve reaches the world's `hit_threshold`, and ended; bodies
    /// come to rest or woken; and a `fault {kind: speed_cap}` for each body the backend capped.
    fn gather(&self, before: &Before) -> Vec<Raw> {
        let kind = |name: &str| code(name).expect("a physics kind");
        let mut uses = BTreeMap::new();
        let mut owner = BTreeMap::new();
        for (n, (id, h)) in self.bodies.iter().enumerate() {
            for (i, c) in self.world.bodies[*h].colliders().iter().enumerate() {
                uses.insert(c.into_raw_parts(), (id.as_str(), i as u32));
                owner.insert(c.into_raw_parts(), n);
            }
        }
        let row = |name: &str, p: &Pair, payload: Payload| {
            let ((a, au), (b, bu)) = (uses.get(&p.0)?, uses.get(&p.1)?);
            Some(Raw {
                kind: kind(name),
                a: a.to_string(),
                a_use: Some(*au),
                b: Some(b.to_string()),
                b_use: Some(*bu),
                payload,
            })
        };
        // A body's velocity at `p` as the step found it.
        let velocity = |c: &Key, p: Vector| match owner.get(c).map(|n| before.bodies[*n]) {
            Some((_, v, w, com)) => v + Vector::new(-(p.y - com.y), p.x - com.x) * w,
            None => Vector::ZERO,
        };
        let arr = |v: Vector| [v.x, v.y, 0.0];
        let mut out = Vec::new();
        let mut now = BTreeSet::new();
        let touching = self.world.contact_pairs();
        for pair in touching.filter(|p| p.has_any_active_contact()) {
            let key = (
                pair.collider1.into_raw_parts(),
                pair.collider2.into_raw_parts(),
            );
            now.insert(key);
            if before.touching.contains(&key) {
                continue;
            }
            let manifolds = pair.solver_manifolds();
            let normal = manifolds.first().map_or(Vector::ZERO, |m| m.data.normal);
            let (mut sum, mut n) = (Vector::ZERO, 0.0f32);
            for m in manifolds {
                for c in &m.data.solver_contacts {
                    let (p1, p2) = m.data.solver_contact_world_points(c, &self.world.bodies);
                    sum += (p1 + p2) * 0.5;
                    n += 1.0;
                }
            }
            let point = if n > 0.0 { sum / n } else { Vector::ZERO };
            let (point3, normal3) = (arr(point), arr(normal));
            let contact = Payload::Contact {
                point: point3,
                normal: normal3,
            };
            out.extend(row("contact_begin", &key, contact));
            let speed = -(velocity(&key.1, point) - velocity(&key.0, point)).dot(normal);
            if speed < self.hit_threshold {
                continue;
            }
            let mut tags: Vec<String> = [key.0, key.1]
                .iter()
                .filter_map(|k| uses.get(k))
                .filter_map(|(id, u)| self.tags.get(&(id.to_string(), *u)).cloned())
                .collect();
            tags.sort();
            tags.dedup();
            let hit = Payload::Hit {
                point: point3,
                normal: normal3,
                speed,
                impulse: pair.total_impulse().length(),
                tags,
            };
            out.extend(row("hit", &key, hit));
        }
        let ended = before.touching.difference(&now);
        out.extend(ended.filter_map(|p| row("contact_end", p, Payload::None)));
        let p = &self.world.integration_parameters;
        let (most, turn) = (p.max_linear_velocity(), MAX_TURN / p.dt);
        for ((id, h), (slept, v0, w0, _)) in self.bodies.iter().zip(&before.bodies) {
            let rb = &self.world.bodies[*h];
            if !rb.is_dynamic() {
                continue;
            }
            let alone = |name: &str, payload: Payload| Raw {
                kind: kind(name),
                a: id.clone(),
                a_use: None,
                b: None,
                b_use: None,
                payload,
            };
            if *slept != rb.is_sleeping() {
                let name = if *slept { "wake" } else { "rest" };
                out.push(alone(name, Payload::None));
            }
            // Capped: it started past the cap, or the step carried it up to the cap from below.
            let (v0, w0, v1, w1) = (
                v0.length(),
                w0.abs(),
                rb.linvel().length(),
                rb.angvel().abs(),
            );
            let at = |x: f32, cap: f32| x >= cap * (1.0 - 1e-4);
            let past = |x: f32, cap: f32| x > cap * (1.0 + 1e-4);
            if past(v0, most)
                || past(w0, turn)
                || (at(v1, most) && !at(v0, most))
                || (at(w1, turn) && !at(w0, turn))
            {
                out.push(alone("fault", Payload::Fault { kind: "speed_cap" }));
            }
        }
        out
    }
}
