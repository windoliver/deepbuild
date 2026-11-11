//! #1918: what a step wrote (Occurrence list), read from the world after the step against the
//! world as the step found it. The gather only reads, so a world's bytes, hashes and checkpoints
//! are what they were; touching and sensing pairs and sleep come from the world itself, so a
//! restored world reads them again with nothing kept beside it. A breakable joint's steps past its
//! threshold are counted in its own `user_data`, which the world's bytes carry.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_physics::doc::Breaks;
use deep_canvas_physics::occurrence::{code, Payload, Raw};
use rapier3d::parry::query::intersection_test;
use rapier3d::prelude::*;

use crate::Rapier;

type Key = (u32, u32);
/// A pair as the engine holds it: (collider1, collider2).
type Pair = (Key, Key);

/// The world as a step found it.
#[derive(Default)]
pub(crate) struct Before {
    touching: BTreeSet<Pair>,
    sensing: BTreeSet<Pair>,
    /// Each body's (sleeping, linear and angular velocity, centre of mass) by handle.
    bodies: BTreeMap<Key, (bool, Vector, Vector, Vector)>,
}

fn kind(name: &str) -> u8 {
    code(name).expect("a physics kind")
}

fn arr(v: Vector) -> [f32; 3] {
    [v.x, v.y, v.z]
}

impl Rapier {
    /// A pair's two colliders as this backend reads them: Rapier's (collider1, collider2), or on
    /// #1918's reversed test backend from the second collider's side.
    fn sides(&self, c1: ColliderHandle, c2: ColliderHandle) -> (ColliderHandle, ColliderHandle) {
        if self.reverse_pairs {
            (c2, c1)
        } else {
            (c1, c2)
        }
    }

    fn key(&self, c1: ColliderHandle, c2: ColliderHandle) -> Pair {
        let (a, b) = self.sides(c1, c2);
        (a.into_raw_parts(), b.into_raw_parts())
    }

    /// The pairs touching now, in the order this backend reads them.
    fn touching(&self) -> Vec<&ContactPair> {
        let mut out: Vec<&ContactPair> = self
            .world
            .contact_pairs()
            .filter(|p| p.has_any_active_contact())
            .collect();
        if self.reverse_pairs {
            out.reverse();
        }
        out
    }

    /// The sensor pairs overlapping now, each candidate tested on the poses the world holds:
    /// Rapier sets a pair's flag only when the next step starts, a step after the overlap.
    fn sensing(&self) -> Vec<Pair> {
        let mut out: Vec<Pair> = self
            .world
            .intersection_pairs()
            .filter(|(_, c1, _, c2, _)| {
                intersection_test(c1.position(), c1.shape(), c2.position(), c2.shape())
                    .is_ok_and(|i| i.intersecting)
            })
            .map(|p| self.key(p.0, p.2))
            .collect();
        if self.reverse_pairs {
            out.reverse();
        }
        out
    }

    /// The world as the next step finds it.
    pub(crate) fn before(&self) -> Before {
        Before {
            touching: self
                .touching()
                .into_iter()
                .map(|p| self.key(p.collider1, p.collider2))
                .collect(),
            sensing: self.sensing().into_iter().collect(),
            bodies: self
                .bodies
                .iter()
                .map(|(_, h)| {
                    let rb = &self.world.bodies[*h];
                    let at = (
                        rb.is_sleeping(),
                        rb.linvel(),
                        rb.angvel(),
                        rb.center_of_mass(),
                    );
                    (h.into_raw_parts(), at)
                })
                .collect(),
        }
    }

    /// Each collider's body ID and shape-use index.
    fn uses(&self) -> BTreeMap<Key, (&str, u32)> {
        let mut out = BTreeMap::new();
        for (id, h) in &self.bodies {
            for (i, c) in self.world.bodies[*h].colliders().iter().enumerate() {
                out.insert(c.into_raw_parts(), (id.as_str(), i as u32));
            }
        }
        out
    }

    fn raw(
        &self,
        name: &str,
        uses: &BTreeMap<Key, (&str, u32)>,
        p: Pair,
        payload: Payload,
    ) -> Option<Raw> {
        let (a, au) = uses.get(&p.0)?;
        let (b, bu) = uses.get(&p.1)?;
        Some(Raw {
            kind: kind(name),
            a: a.to_string(),
            a_use: Some(*au),
            b: Some(b.to_string()),
            b_use: Some(*bu),
            payload,
        })
    }

    /// A body's velocity at `p` as the step found it.
    fn velocity_at(&self, before: &Before, c: ColliderHandle, p: Vector) -> Vector {
        let body = self.world.colliders[c]
            .parent()
            .map(RigidBodyHandle::into_raw_parts);
        match body.and_then(|b| before.bodies.get(&b)) {
            Some((_, v, w, com)) => *v + w.cross(p - *com),
            None => Vector::ZERO,
        }
    }

    /// A new contact's `contact_begin {point, normal}`, and its `hit` when its normal approach
    /// speed before the solve reaches the world's `hit_threshold`: the point is the mean of its
    /// solver contacts' midpoints and the normal points from the first side read to the second.
    fn began(
        &self,
        before: &Before,
        pair: &ContactPair,
        uses: &BTreeMap<Key, (&str, u32)>,
        out: &mut Vec<Raw>,
    ) {
        let manifolds = pair.solver_manifolds();
        let engine = manifolds.first().map_or(Vector::ZERO, |m| m.data.normal);
        let normal = if self.reverse_pairs { -engine } else { engine };
        let (c1, c2) = self.sides(pair.collider1, pair.collider2);
        let (mut sum, mut n) = (Vector::ZERO, 0.0f32);
        for m in manifolds {
            for c in &m.data.solver_contacts {
                let (p1, p2) = m.data.solver_contact_world_points(c, &self.world.bodies);
                sum += (p1 + p2) * 0.5;
                n += 1.0;
            }
        }
        let point = if n > 0.0 { sum / n } else { Vector::ZERO };
        let key = (c1.into_raw_parts(), c2.into_raw_parts());
        let contact = Payload::Contact {
            point: arr(point),
            normal: arr(normal),
        };
        out.extend(self.raw("contact_begin", uses, key, contact));
        let rel = self.velocity_at(before, c2, point) - self.velocity_at(before, c1, point);
        let speed = -rel.dot(normal);
        if speed < self.hit_threshold {
            return;
        }
        let mut tags: Vec<String> = [key.0, key.1]
            .iter()
            .filter_map(|k| uses.get(k))
            .filter_map(|(id, u)| self.tags.get(&(id.to_string(), *u)).cloned())
            .collect();
        tags.sort();
        tags.dedup();
        let impulse = pair.total_impulse().length();
        let hit = Payload::Hit {
            point: arr(point),
            normal: arr(normal),
            speed,
            impulse,
            tags,
        };
        out.extend(self.raw("hit", uses, key, hit));
    }

    /// What the step that ran since `before` wrote: contacts begun and ended, sensors entered and
    /// left, and bodies come to rest or woken, in the engine's order.
    pub(crate) fn gather(&self, before: &Before) -> Vec<Raw> {
        let uses = self.uses();
        let mut out = Vec::new();
        let touching = self.touching();
        let now: BTreeSet<Pair> = touching
            .iter()
            .map(|p| self.key(p.collider1, p.collider2))
            .collect();
        for pair in &touching {
            if !before
                .touching
                .contains(&self.key(pair.collider1, pair.collider2))
            {
                self.began(before, pair, &uses, &mut out);
            }
        }
        let mut ended: Vec<&Pair> = before.touching.difference(&now).collect();
        let sensing = self.sensing();
        let sensed: BTreeSet<Pair> = sensing.iter().copied().collect();
        let mut left: Vec<&Pair> = before.sensing.difference(&sensed).collect();
        if self.reverse_pairs {
            ended.reverse();
            left.reverse();
        }
        out.extend(
            ended
                .into_iter()
                .filter_map(|p| self.raw("contact_end", &uses, *p, Payload::None)),
        );
        for p in sensing.iter().filter(|p| !before.sensing.contains(p)) {
            out.extend(self.raw("sensor_enter", &uses, *p, Payload::None));
        }
        out.extend(
            left.into_iter()
                .filter_map(|p| self.raw("sensor_exit", &uses, *p, Payload::None)),
        );
        for (id, h) in &self.bodies {
            let rb = &self.world.bodies[*h];
            let was = before.bodies.get(&h.into_raw_parts()).is_some_and(|b| b.0);
            if rb.is_dynamic() && was != rb.is_sleeping() {
                let name = if was { "wake" } else { "rest" };
                out.push(Raw {
                    kind: kind(name),
                    a: id.clone(),
                    a_use: None,
                    b: None,
                    b_use: None,
                    payload: Payload::None,
                });
            }
        }
        out
    }

    /// Each breakable joint's force and torque after the step, from its lock impulses over the
    /// substep they came from; one past `breaks_at` for `over_steps` steps is disabled and writes
    /// `break`. The count lives in the joint's `user_data`, written only when it changes.
    pub(crate) fn breaks(&mut self) -> Vec<Raw> {
        let p = &self.world.integration_parameters;
        let substep = p.dt / p.num_solver_iterations.max(1) as f32;
        let mut out = Vec::new();
        let breakable: Vec<(String, ImpulseJointHandle, Breaks)> = self.breakable.clone();
        for (id, h, b) in breakable {
            let Some(j) = self
                .world
                .impulse_joints
                .get(h)
                .filter(|j| j.data.is_enabled())
            else {
                continue;
            };
            let i = j.impulses;
            let force = Vector::new(i[0], i[1], i[2]).length() / substep;
            let torque = Vector::new(i[3], i[4], i[5]).length() / substep;
            let past = b.force.is_some_and(|x| f64::from(force) > x)
                || b.torque.is_some_and(|x| f64::from(torque) > x);
            let count = j.data.user_data as u32;
            let next = if past { count + 1 } else { 0 };
            if next == count {
                continue;
            }
            let Some(j) = self.world.impulse_joints.get_mut(h, false) else {
                continue;
            };
            j.data.user_data = u128::from(next);
            if next >= b.over_steps {
                j.data.set_enabled(false);
                let payload = Payload::Break { force, torque };
                out.push(Raw {
                    kind: kind("break"),
                    a: id,
                    a_use: None,
                    b: None,
                    b_use: None,
                    payload,
                });
            }
        }
        out
    }
}
