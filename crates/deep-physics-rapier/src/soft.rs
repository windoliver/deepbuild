//! #524: `soft@1` on Rapier 0.36.1's soft bodies, the one file of this crate that names an engine
//! soft-body type, so swapping the soft-body solver changes this module and no world document.
//! Each soft body is built from the lattice the physics module read (its particles in address
//! order, its edges by kind, its triangles), stepped with the world's rigid bodies, contacts and
//! joints, and followed through tears: the engine splits a torn particle into copies and a torn
//! body into pieces with new handles, so this file keeps each particle's name (its address, or
//! `<address>~<n>` for a copy a tear made) with where the engine holds it, and that map rides in
//! the checkpoint after the world's own bytes. A closed body holds `inflate` times its rest
//! volume by a volume constraint `VOLUME_STIFFER` times as stiff as its stretch (caps.declared).
#![cfg_attr(feature = "test-swap-soft-solver", allow(unused_imports, dead_code))]

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use deep_canvas_physics::backend::{Canonical, SoftHeld, SoftState};
use deep_canvas_physics::doc::{Rule, Soft, SoftShape, Stiffness, World};
use deep_canvas_physics::occurrence::{self, Payload, Raw};
use rapier3d::prelude::*;
use serde_json::{json, Value};

use crate::{v3, Rapier};

/// The solver that steps soft bodies in this build (`runtime`'s `soft_solver`).
#[cfg(not(feature = "test-swap-soft-solver"))]
pub const SOLVER: &str = "rapier3d 0.36.1 soft bodies (constraints)";
/// #524 criterion 3's test build: the cargo feature `test-swap-soft-solver` swaps the soft-body
/// solver for a small one of ours (`ours`), in this module alone; no world document changes.
#[cfg(feature = "test-swap-soft-solver")]
pub const SOLVER: &str = "deep xpbd particles, a test build (no contacts or tears)";
#[cfg(feature = "test-swap-soft-solver")]
pub(crate) use ours::Softs;

/// The volume constraint's frequency over the stretch's: stiff enough that a closed body's edges
/// can't hold it below `inflate` times its rest volume (caps.declared).
pub const VOLUME_STIFFER: f32 = 8.0;

/// The tag that starts the soft bodies' particle names a checkpoint carries after the world's
/// bytes, before the held grabs.
const TAG: &[u8] = b"deep.soft@1";

/// Where the engine holds one particle: its soft body and its index there.
type At = (SoftBodyHandle, u32);

/// Each soft@1 body's particles by name, in its lattice's order and then each copy a tear made,
/// with where the engine holds each; how many of them are its lattice's; its lattice's edges (a
/// tear's rows name these); and those already torn, so each is listed once. An edge is torn once
/// the engine no longer joins its two lattice particles, the ones its addresses draw.
#[cfg(not(feature = "test-swap-soft-solver"))]
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Softs {
    pub(crate) bodies: BTreeMap<String, Vec<(String, At)>>,
    lattice: BTreeMap<String, usize>,
    edges: BTreeMap<String, Vec<[u32; 2]>>,
    torn: BTreeMap<String, BTreeSet<[u32; 2]>>,
    /// A closed body built without its volume constraint: the planted twin of #524 criterion 6.
    pub(crate) no_volume: bool,
}

/// The tear events a step's soft bodies wrote, in the order the engine wrote them.
#[cfg(not(feature = "test-swap-soft-solver"))]
#[derive(Default)]
struct Tears(Mutex<Vec<SoftBodyTearEvent>>);

#[cfg(not(feature = "test-swap-soft-solver"))]
impl EventHandler for Tears {
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }

    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }

    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, event: &SoftBodyTearEvent) {
        if let Ok(mut all) = self.0.lock() {
            all.push(event.clone());
        }
    }
}

#[cfg(not(feature = "test-swap-soft-solver"))]
fn coefficients(k: Stiffness, times: f32) -> SpringCoefficients<Real> {
    SpringCoefficients::new(k.hz as f32 * times, k.damping_ratio as f32)
}

#[cfg(not(feature = "test-swap-soft-solver"))]
fn combine(r: Rule) -> CoefficientCombineRule {
    match r {
        Rule::Geometric => CoefficientCombineRule::GeometricMean,
        Rule::Average => CoefficientCombineRule::Average,
        Rule::Min => CoefficientCombineRule::Min,
        Rule::Max => CoefficientCombineRule::Max,
        Rule::Multiply => CoefficientCombineRule::Multiply,
    }
}

#[cfg(not(feature = "test-swap-soft-solver"))]
impl Softs {
    /// Builds each of `w`'s soft bodies into `world`, after its rigid bodies (`handles`), so a
    /// particle pinned to a body holds to it.
    pub(crate) fn build(
        &mut self,
        w: &World,
        world: &mut PhysicsWorld,
        handles: &BTreeMap<String, RigidBodyHandle>,
    ) {
        self.bodies.clear();
        self.lattice.clear();
        self.edges.clear();
        self.torn.clear();
        for (id, s) in &w.soft {
            let h = world.insert_soft_body(self.builder(w, s, world, handles));
            for pin in &s.pins {
                if let Some(rb) = pin.body.as_ref().and_then(|b| handles.get(b)) {
                    let sb = &mut world.soft_bodies[h];
                    sb.attach_particle(pin.particle as usize, *rb, &world.bodies);
                }
            }
            let named = s.addresses.iter().enumerate();
            self.bodies.insert(
                id.clone(),
                named.map(|(i, a)| (a.clone(), (h, i as u32))).collect(),
            );
            self.lattice.insert(id.clone(), s.addresses.len());
            let edges = s
                .edges
                .iter()
                .chain(&s.shear_edges)
                .map(|[a, b]| [*a.min(b), *a.max(b)]);
            self.edges.insert(id.clone(), edges.collect());
        }
    }

    fn builder(
        &self,
        w: &World,
        s: &Soft,
        world: &PhysicsWorld,
        handles: &BTreeMap<String, RigidBodyHandle>,
    ) -> SoftBodyBuilder {
        let mut positions: Vec<Vector> = s.positions.iter().map(|p| v3(*p)).collect();
        // A particle pinned to a body's anchor starts at the anchor.
        for pin in &s.pins {
            if let (Some(rb), Some(point)) =
                (pin.body.as_ref().and_then(|b| handles.get(b)), pin.point)
            {
                positions[pin.particle as usize] = world.bodies[*rb].position() * v3(point);
            }
        }
        let structural = s.edges.len() as u32;
        let mut edges = s.edges.clone();
        edges.extend(&s.shear_edges);
        let mut material = SoftBodyMaterial::uniform(coefficients(s.stretch, 1.0));
        material.bend_softness = coefficients(s.bend, 1.0);
        material.volume_softness = coefficients(s.stretch, VOLUME_STIFFER);
        // A declared tear always tears: no piece too small waits.
        material.min_piece = Some(1);
        if let Some(t) = s.tear {
            material.tear_strain = t.strain.map(|x| x as f32);
            material.tear_force = t.force.map(|x| x as f32);
            material.tear_smoothing = t.smoothing as f32;
        }
        let m = s
            .material
            .as_ref()
            .map_or(&w.defaults, |m| &w.contact_materials[m]);
        let collider = ColliderBuilder::ball(0.05)
            .friction(m.friction as f32)
            .restitution(m.restitution as f32)
            .friction_combine_rule(combine(w.friction_rule))
            .restitution_combine_rule(combine(w.restitution_rule))
            .collision_groups(InteractionGroups::new(
                Group::from_bits_retain(s.member),
                Group::from_bits_retain(s.collides),
                InteractionTestMode::And,
            ));
        let mut b = SoftBodyBuilder::new(positions)
            .edges(edges)
            .bend_edges(s.bend_edges.clone())
            .material(material)
            .masses(s.masses.iter().map(|m| *m as f32).collect())
            .pinned_particles(
                s.pins
                    .iter()
                    .filter(|p| p.body.is_none())
                    .map(|p| p.particle),
            )
            .particle_radius(s.particle_radius as f32)
            .self_contacts(s.self_contacts)
            .linear_damping(s.damping as f32)
            .surface_collider(collider);
        b.edge_softness = s
            .shear_edges
            .iter()
            .enumerate()
            .map(|(i, _)| (structural + i as u32, coefficients(s.shear, 1.0)))
            .collect();
        if s.tension_only {
            b = b.tension_only();
        }
        match s.shape {
            SoftShape::Rope => b = b.wire(s.edges.clone()),
            SoftShape::Cloth { .. } => b = b.surface(s.triangles.clone()),
            SoftShape::Balloon { .. } | SoftShape::Volume { .. } => {
                b = b.surface(s.triangles.clone());
                let dihedrals = b.surface_dihedrals();
                b = b
                    .dihedrals(dihedrals)
                    .volume_preservation(!self.no_volume)
                    .volume_factor(s.inflate as f32);
            }
        }
        b
    }

    /// Steps `world` once with its soft bodies, and the `tear` rows its tears wrote.
    pub(crate) fn step(&mut self, world: &mut PhysicsWorld) -> Vec<Raw> {
        if self.bodies.is_empty() {
            world.step();
            return Vec::new();
        }
        let tears = Tears::default();
        world.step_with_events(&(), &tears);
        let events = tears.0.into_inner().unwrap_or_default();
        let mut touched = BTreeSet::new();
        for e in &events {
            touched.extend(self.follow(e));
        }
        touched
            .into_iter()
            .filter_map(|id| self.cut(&id, world))
            .collect()
    }

    /// Soft body `id`'s `tear` row for the lattice edges a step's tears cut, if any: the edges
    /// whose two lattice particles the engine no longer joins, the lower address first, sorted,
    /// none listed before.
    fn cut(&mut self, id: &str, world: &PhysicsWorld) -> Option<Raw> {
        let named = self.bodies.get(id)?;
        let mut joined = BTreeSet::new();
        let handles: BTreeSet<(u32, u32)> =
            named.iter().map(|(_, (h, _))| h.into_raw_parts()).collect();
        for (index, generation) in handles {
            let h = SoftBodyHandle::from_raw_parts(index, generation);
            for e in world.soft_bodies.get(h).map_or(&[][..], |b| b.edges()) {
                let [a, b] = e.vertices;
                joined.insert([(h, a.min(b)), (h, a.max(b))].map(|(h, i)| (h.into_raw_parts(), i)));
            }
        }
        let at = |i: u32| {
            named
                .get(i as usize)
                .map(|(_, (h, k))| (h.into_raw_parts(), *k))
        };
        let torn = self.torn.entry(id.to_string()).or_default();
        let mut cut = Vec::new();
        for [a, b] in self.edges.get(id).into_iter().flatten() {
            let (Some(x), Some(y)) = (at(*a), at(*b)) else {
                continue;
            };
            let pair = if (x.0, x.1) <= (y.0, y.1) {
                [x, y]
            } else {
                [y, x]
            };
            if !joined.contains(&pair) && torn.insert([*a, *b]) {
                cut.push([named[*a as usize].0.clone(), named[*b as usize].0.clone()]);
            }
        }
        if cut.is_empty() {
            return None;
        }
        Some(Raw {
            kind: occurrence::code("tear")?,
            a: id.to_string(),
            a_use: None,
            b: None,
            b_use: None,
            payload: Payload::Tear { edges: cut },
        })
    }

    /// Follows one tear event: each particle it moved to its new body and index, and each copy it
    /// made as `<address>~<n>`; the soft body it tore, if one of these.
    fn follow(&mut self, e: &SoftBodyTearEvent) -> Option<String> {
        let (id, named) = self
            .bodies
            .iter_mut()
            .find(|(_, n)| n.iter().any(|(_, (h, _))| *h == e.soft_body))?;
        let id = id.clone();
        let order: BTreeMap<u32, String> = named
            .iter()
            .filter(|(_, (h, _))| *h == e.soft_body)
            .map(|(name, (_, i))| (*i, name.clone()))
            .collect();
        for (_, at) in named.iter_mut() {
            if at.0 == e.soft_body {
                if let Some(to) = e.particle_destination(at.1) {
                    *at = to;
                }
            }
        }
        for (copy, source) in &e.split_particles {
            let Some(name) = order.get(source) else {
                continue;
            };
            let copies = |x: &String| x.rsplit_once('~').is_some_and(|(base, _)| base == name);
            let n = named.iter().filter(|(x, _)| copies(x)).count();
            if let Some(to) = e.particle_destination(*copy) {
                named.push((format!("{name}~{}", n + 1), to));
            }
        }
        Some(id)
    }

    fn particle(world: &PhysicsWorld, (h, i): At) -> Option<&SoftBodyParticle> {
        world.soft_bodies.get(h)?.particles().get(i as usize)
    }

    /// Each particle's canonical state, by soft body ID, then name in order (#524).
    pub(crate) fn canonical(&self, world: &PhysicsWorld) -> Vec<Canonical> {
        let mut out = Vec::new();
        for (id, named) in &self.bodies {
            for (name, at) in named {
                let (p, v) = Self::particle(world, *at)
                    .map_or((Vector::splat(f32::NAN), Vector::splat(f32::NAN)), |q| {
                        (q.position(), q.velocity())
                    });
                out.push(Canonical {
                    id: format!("{id}#{name}"),
                    values: vec![p.x, p.y, p.z, v.x, v.y, v.z],
                });
            }
        }
        out
    }

    /// Each soft body's lattice particles as a step left them, in address order.
    pub(crate) fn read(&self, world: &PhysicsWorld) -> Vec<SoftState> {
        let back = |v: Vector| [f64::from(v.x), f64::from(v.y), f64::from(v.z)];
        self.bodies
            .iter()
            .map(|(id, named)| {
                let n = self.lattice.get(id).copied().unwrap_or(named.len());
                let (positions, velocities) = named[..n]
                    .iter()
                    .map(|(_, at)| {
                        Self::particle(world, *at).map_or(([f64::NAN; 3], [f64::NAN; 3]), |q| {
                            (back(q.position()), back(q.velocity()))
                        })
                    })
                    .unzip();
                SoftState {
                    id: id.clone(),
                    positions,
                    velocities,
                }
            })
            .collect()
    }

    /// Each soft body as the engine holds it.
    pub(crate) fn held(&self, world: &PhysicsWorld) -> Vec<SoftHeld> {
        self.bodies
            .iter()
            .map(|(id, named)| {
                let mut handles: Vec<SoftBodyHandle> = named.iter().map(|(_, (h, _))| *h).collect();
                handles.sort_by_key(|h| h.into_raw_parts());
                handles.dedup();
                let bodies: Vec<&SoftBody> = handles
                    .iter()
                    .filter_map(|h| world.soft_bodies.get(*h))
                    .collect();
                let closed = bodies.iter().find(|b| !b.volume_pieces().is_empty());
                SoftHeld {
                    id: id.clone(),
                    bodies: bodies.len(),
                    particles: bodies.iter().map(|b| b.num_particles()).sum(),
                    volume_ratio: closed.map(|b| f64::from(b.volume_factor())),
                    volume_held: closed.is_some_and(|b| b.volume_preservation_enabled()),
                }
            })
            .collect()
    }

    /// The soft@1 body whose surface `c` is, if it is one's.
    pub(crate) fn owner(&self, world: &PhysicsWorld, c: ColliderHandle) -> Option<&String> {
        let h = world.colliders.get(c)?.deformable_mesh_ref()?.body;
        let named = self.bodies.iter();
        named
            .filter(|(_, n)| n.iter().any(|(_, (x, _))| *x == h))
            .map(|(id, _)| id)
            .next()
    }

    /// Whether the world holds a soft body.
    pub(crate) fn has_any(&self) -> bool {
        !self.bodies.is_empty()
    }

    /// The engine's soft-body particles, every piece's.
    pub(crate) fn particles(&self, world: &PhysicsWorld) -> usize {
        world
            .soft_bodies
            .iter()
            .map(|(_, b)| b.num_particles())
            .sum()
    }

    /// The soft bodies the engine quarantined for a non-finite state, by soft@1 ID.
    pub(crate) fn quarantined(&self, world: &PhysicsWorld) -> Vec<String> {
        let q = world.quarantine().soft_bodies();
        self.bodies
            .iter()
            .filter(|(_, named)| named.iter().any(|(_, (h, _))| q.contains(h)))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// The particle names a checkpoint carries after the world's bytes: none for a world with no
    /// soft body, so a rigid world checkpoints the bytes it always did.
    pub(crate) fn bytes(&self) -> Vec<u8> {
        if self.bodies.is_empty() {
            return Vec::new();
        }
        let named: BTreeMap<&String, Value> = self
            .bodies
            .iter()
            .map(|(id, n)| {
                let list: Vec<Value> = n
                    .iter()
                    .map(|(name, (h, i))| {
                        let (index, generation) = h.into_raw_parts();
                        json!([name, index, generation, i])
                    })
                    .collect();
                (id, json!({"particles": list, "torn": self.torn.get(id)}))
            })
            .collect();
        let body = serde_json::to_vec(&named).expect("particle names serialize");
        let mut out = TAG.to_vec();
        out.extend((body.len() as u64).to_le_bytes());
        out.extend(body);
        out
    }

    /// Takes the particle names `rest` starts with, if any, and returns the bytes after them.
    pub(crate) fn restore<'a>(&mut self, rest: &'a [u8]) -> &'a [u8] {
        let Some(after) = rest.strip_prefix(TAG) else {
            return rest;
        };
        let (len, after) = after.split_at(8.min(after.len()));
        let len = u64::from_le_bytes(len.try_into().unwrap_or([0; 8])) as usize;
        let (body, after) = after.split_at(len.min(after.len()));
        let named: BTreeMap<String, Value> = serde_json::from_slice(body).unwrap_or_default();
        for (id, v) in named {
            let list: Vec<(String, u32, u32, u32)> =
                serde_json::from_value(v["particles"].clone()).unwrap_or_default();
            let at = list
                .into_iter()
                .map(|(name, index, generation, i)| {
                    (name, (SoftBodyHandle::from_raw_parts(index, generation), i))
                })
                .collect();
            self.bodies.insert(id.clone(), at);
            let torn: BTreeSet<[u32; 2]> =
                serde_json::from_value(v["torn"].clone()).unwrap_or_default();
            self.torn.insert(id, torn);
        }
        after
    }
}

impl Rapier {
    /// The fault rows a step's soft bodies wrote: `nan` for each the engine newly quarantined for
    /// a non-finite state, and `capacity` once the engine's particles first pass
    /// `capacity.particles`, naming the soft body whose tear passed it; `before` and
    /// `quarantined` are the particles and quarantined bodies the step started with.
    pub(crate) fn soft_faults(&self, before: usize, quarantined: &[String]) -> Vec<Raw> {
        let fault = |a: &str, kind| Raw {
            kind: occurrence::code("fault").unwrap_or(u8::MAX),
            a: a.to_string(),
            a_use: None,
            b: None,
            b_use: None,
            payload: Payload::Fault { kind },
        };
        let now = self.soft.quarantined(&self.world);
        let mut out: Vec<Raw> = now
            .iter()
            .filter(|id| !quarantined.contains(id))
            .map(|id| fault(id, "nan"))
            .collect();
        let cap = self.particle_capacity;
        if self.soft.particles(&self.world) as u64 > cap && before as u64 <= cap {
            let tear = occurrence::code("tear");
            if let Some(r) = self.last.iter().rev().find(|r| Some(r.kind) == tear) {
                out.push(fault(&r.a, "capacity"));
            }
        }
        out
    }

    /// The engine's rigid bodies, none a soft body's own frame, and its joints.
    pub(crate) fn rigid_held(&self) -> (usize, usize) {
        let rigid = self
            .world
            .bodies
            .iter()
            .filter(|(_, b)| !b.is_soft_frame())
            .count();
        let joints =
            self.world.impulse_joints.iter().count() + self.world.multibody_joints.iter().count();
        (rigid, joints)
    }
}

/// #524 criterion 3's swapped solver, a test build: each soft body's particles stepped by our own
/// position-based solver after the engine steps the rigid world, each substep moving every free
/// particle by gravity, holding a particle pinned to a body at its anchor, then projecting each
/// edge to its rest length and a closed body to `inflate` times its rest volume, softened by
/// their frequencies (XPBD). It meets no contact and tears nothing.
#[cfg(feature = "test-swap-soft-solver")]
mod ours {
    use super::*;

    /// One soft body's particles: where each is, its velocity and inverse mass; its constraints;
    /// and the bodies some particles are pinned to, at a point in each body's frame.
    #[derive(Clone, Debug, Default, PartialEq)]
    struct Body {
        addresses: Vec<String>,
        x: Vec<Vector>,
        v: Vec<Vector>,
        w: Vec<f32>,
        edges: Vec<(usize, usize, f32, f32)>,
        attached: Vec<(usize, RigidBodyHandle, Vector)>,
        volume: Option<(Vec<[u32; 3]>, f32, f32)>,
        damping: f32,
    }

    fn volume(x: &[Vector], triangles: &[[u32; 3]]) -> f32 {
        let at = |i: u32| x[i as usize];
        triangles
            .iter()
            .map(|[a, b, c]| at(*a).dot(at(*b).cross(at(*c))) / 6.0)
            .sum()
    }

    #[derive(Clone, Debug, Default, PartialEq)]
    pub(crate) struct Softs {
        bodies: BTreeMap<String, Body>,
        pub(crate) no_volume: bool,
    }

    impl Softs {
        pub(crate) fn build(
            &mut self,
            w: &World,
            world: &mut PhysicsWorld,
            handles: &BTreeMap<String, RigidBodyHandle>,
        ) {
            self.bodies.clear();
            for (id, s) in &w.soft {
                let x: Vec<Vector> = s.positions.iter().map(|p| v3(*p)).collect();
                let mut b = Body {
                    addresses: s.addresses.clone(),
                    v: vec![Vector::ZERO; x.len()],
                    w: s.masses.iter().map(|m| 1.0 / *m as f32).collect(),
                    damping: s.damping as f32,
                    ..Body::default()
                };
                for pin in &s.pins {
                    let i = pin.particle as usize;
                    match pin.body.as_ref().and_then(|id| handles.get(id)) {
                        Some(h) => {
                            let local = world.bodies[*h].position().inverse_transform_point(x[i]);
                            b.attached.push((i, *h, local));
                        }
                        None => b.w[i] = 0.0,
                    }
                }
                let kinds = [
                    (&s.edges, s.stretch),
                    (&s.shear_edges, s.shear),
                    (&s.bend_edges, s.bend),
                ];
                for (list, k) in kinds {
                    for [a, c] in list {
                        let (a, c) = (*a as usize, *c as usize);
                        b.edges.push((a, c, (x[a] - x[c]).length(), k.hz as f32));
                    }
                }
                if s.closed() && !self.no_volume {
                    let rest = volume(&x, &s.triangles);
                    b.volume = Some((
                        s.triangles.clone(),
                        rest * s.inflate as f32,
                        s.stretch.hz as f32 * VOLUME_STIFFER,
                    ));
                }
                b.x = x;
                self.bodies.insert(id.clone(), b);
            }
        }

        pub(crate) fn step(&mut self, world: &mut PhysicsWorld) -> Vec<Raw> {
            world.step();
            let n = world.integration_parameters.num_solver_iterations.max(1);
            let h = world.integration_parameters.dt / n as f32;
            let g = world.gravity;
            for b in self.bodies.values_mut() {
                for _ in 0..n {
                    let mut p: Vec<Vector> = (0..b.x.len())
                        .map(|i| {
                            if b.w[i] > 0.0 {
                                b.x[i] + (b.v[i] + g * h) * h
                            } else {
                                b.x[i]
                            }
                        })
                        .collect();
                    for (i, body, local) in &b.attached {
                        p[*i] = world.bodies[*body].position() * *local;
                    }
                    for (a, c, rest, hz) in &b.edges {
                        let (wa, wc) = (b.w[*a], b.w[*c]);
                        let d = p[*a] - p[*c];
                        let len = d.length();
                        if wa + wc == 0.0 || len == 0.0 {
                            continue;
                        }
                        let omega = 2.0 * std::f32::consts::PI * hz;
                        let lambda =
                            -(len - rest) / ((wa + wc) * (1.0 + 1.0 / (omega * omega * h * h)));
                        let n = d / len;
                        p[*a] += n * (wa * lambda);
                        p[*c] -= n * (wc * lambda);
                    }
                    if let Some((triangles, target, hz)) = &b.volume {
                        let mut grad = vec![Vector::ZERO; p.len()];
                        for [i, j, k] in triangles {
                            let (pi, pj, pk) = (p[*i as usize], p[*j as usize], p[*k as usize]);
                            grad[*i as usize] += pj.cross(pk) / 6.0;
                            grad[*j as usize] += pk.cross(pi) / 6.0;
                            grad[*k as usize] += pi.cross(pj) / 6.0;
                        }
                        let sum: f32 = (0..p.len())
                            .map(|i| b.w[i] * grad[i].length_squared())
                            .sum();
                        let omega = 2.0 * std::f32::consts::PI * hz;
                        if sum > 0.0 {
                            let lambda = -(volume(&p, triangles) - target)
                                / (sum * (1.0 + 1.0 / (omega * omega * h * h)));
                            for ((q, g), w) in p.iter_mut().zip(&grad).zip(&b.w) {
                                *q += *g * (w * lambda);
                            }
                        }
                    }
                    let keep = (1.0 - b.damping * h).max(0.0);
                    for ((q, x), v) in p.iter().zip(b.x.iter_mut()).zip(b.v.iter_mut()) {
                        *v = (*q - *x) / h * keep;
                        *x = *q;
                    }
                }
            }
            Vec::new()
        }

        pub(crate) fn canonical(&self, _: &PhysicsWorld) -> Vec<Canonical> {
            let mut out = Vec::new();
            for (id, b) in &self.bodies {
                for (i, a) in b.addresses.iter().enumerate() {
                    let (p, v) = (b.x[i], b.v[i]);
                    out.push(Canonical {
                        id: format!("{id}#{a}"),
                        values: vec![p.x, p.y, p.z, v.x, v.y, v.z],
                    });
                }
            }
            out
        }

        pub(crate) fn read(&self, _: &PhysicsWorld) -> Vec<SoftState> {
            let back = |v: &Vector| [f64::from(v.x), f64::from(v.y), f64::from(v.z)];
            let state = |(id, b): (&String, &Body)| SoftState {
                id: id.clone(),
                positions: b.x.iter().map(back).collect(),
                velocities: b.v.iter().map(back).collect(),
            };
            self.bodies.iter().map(state).collect()
        }

        pub(crate) fn held(&self, _: &PhysicsWorld) -> Vec<SoftHeld> {
            let held = |(id, b): (&String, &Body)| SoftHeld {
                id: id.clone(),
                bodies: 1,
                particles: b.x.len(),
                volume_ratio: b.volume.as_ref().map(|(t, target, _)| {
                    f64::from(target / volume(&b.x, t).max(f32::MIN_POSITIVE))
                }),
                volume_held: b.volume.is_some(),
            };
            self.bodies.iter().map(held).collect()
        }

        pub(crate) fn particles(&self, _: &PhysicsWorld) -> usize {
            self.bodies.values().map(|b| b.x.len()).sum()
        }

        pub(crate) fn has_any(&self) -> bool {
            !self.bodies.is_empty()
        }

        pub(crate) fn quarantined(&self, _: &PhysicsWorld) -> Vec<String> {
            Vec::new()
        }

        pub(crate) fn owner(&self, _: &PhysicsWorld, _: ColliderHandle) -> Option<&String> {
            None
        }

        pub(crate) fn bytes(&self) -> Vec<u8> {
            if self.bodies.is_empty() {
                return Vec::new();
            }
            let all: BTreeMap<&String, Value> = self
                .bodies
                .iter()
                .map(|(id, b)| {
                    let f = |v: &Vec<Vector>| {
                        v.iter()
                            .flat_map(|p| [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()])
                            .collect::<Vec<_>>()
                    };
                    (id, json!({"x": f(&b.x), "v": f(&b.v)}))
                })
                .collect();
            let body = serde_json::to_vec(&all).expect("particles serialize");
            [
                TAG.to_vec(),
                (body.len() as u64).to_le_bytes().to_vec(),
                body,
            ]
            .concat()
        }

        pub(crate) fn restore<'a>(&mut self, rest: &'a [u8]) -> &'a [u8] {
            let Some(after) = rest.strip_prefix(TAG) else {
                return rest;
            };
            let (len, after) = after.split_at(8.min(after.len()));
            let len = u64::from_le_bytes(len.try_into().unwrap_or([0; 8])) as usize;
            let (body, after) = after.split_at(len.min(after.len()));
            let all: BTreeMap<String, Value> = serde_json::from_slice(body).unwrap_or_default();
            for (id, v) in all {
                let read = |k: &str| -> Vec<Vector> {
                    let bits: Vec<u32> = serde_json::from_value(v[k].clone()).unwrap_or_default();
                    bits.as_chunks::<3>()
                        .0
                        .iter()
                        .map(|c| {
                            Vector::new(
                                f32::from_bits(c[0]),
                                f32::from_bits(c[1]),
                                f32::from_bits(c[2]),
                            )
                        })
                        .collect()
                };
                if let Some(b) = self.bodies.get_mut(&id) {
                    (b.x, b.v) = (read("x"), read("v"));
                }
            }
            after
        }
    }
}
