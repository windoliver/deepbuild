//! #182: character bodies (canvas primitives: Body `body@1`: character) on Rapier's own
//! kinematic character controller, behind the backend interface. Each step, after the step's
//! inputs apply and before forces and the engine's step, each character body moves in canonical
//! (priority, ID) order against the world as the last step left it: off the ground its vertical
//! speed first falls by g × gravity_scale × the step's length, on it it's 0, and a jump or a
//! launch sets it instead; the controller moves its capsule by (wants + up × vertical) × the
//! step's length, and the new pose is its kinematic target for the step. Its own state rides in
//! the checkpoint after the soft bodies' bytes, and in the canonical state after every body's.

use deep_canvas_physics::backend::{Canonical, CharacterState, ShapeRef};
use deep_canvas_physics::doc::{BodyKind, Character, World};
use deep_canvas_physics::occurrence::{code, Payload, Raw};
use rapier3d::control::{CharacterLength, KinematicCharacterController};
use rapier3d::math::Pose;
use rapier3d::parry::query::ShapeCastOptions;
use rapier3d::parry::query::{
    self as parry_query, DefaultQueryDispatcher, PersistentQueryDispatcher,
};
use rapier3d::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::{pose, v3, Rapier, Twin};

/// m: the most a body walking on the ground drifts up off it in a step, which it settles back;
/// and how far past its offset it settles, so its next walk's cast along the ground starts
/// clear of it (a capsule's cast against a very large shape, started at the cast's target
/// distance, reads a normal f32 can't hold).
const DRIFT: f32 = 2.0e-3;
const CLEAR: f32 = 1.0e-3;

/// The tag that starts the character bodies' state a checkpoint carries after the soft bodies'.
const TAG: &[u8] = b"deep.characters@1";

/// One character body as this backend moves it.
#[derive(Clone, Debug)]
pub(crate) struct Walker {
    body: RigidBodyHandle,
    collider: ColliderHandle,
    conf: Character,
    gravity_scale: f32,
    /// Its capsule's pose on its body, standing.
    tall: Pose,
    pub(crate) state: CharacterState,
    /// The held `crouch {on}`.
    crouch: bool,
    /// This step's jump or launch, and whether a place moved it.
    set: Option<f32>,
    placed: bool,
}

fn vec_of(v: &Value, key: &str) -> Option<[f64; 3]> {
    let a = v.get(key)?.as_array()?;
    Some([
        a.first()?.as_f64()?,
        a.get(1)?.as_f64()?,
        a.get(2)?.as_f64()?,
    ])
}

fn f3(v: Vector) -> [f32; 3] {
    [v.x, v.y, v.z]
}

/// A contact row between `a` (the character's shape use) and `b`.
fn row(name: &str, a: &ShapeRef, b: &ShapeRef, payload: Payload) -> Raw {
    Raw {
        kind: code(name).expect("a physics kind"),
        a: a.body.clone(),
        a_use: Some(a.index as u32),
        b: Some(b.body.clone()),
        b_use: Some(b.index as u32),
        payload,
    }
}

impl Rapier {
    /// Each character body of `w`, in canonical (priority, ID) order, grounded as built; and the
    /// broad phase filled from the world as built, so the first step's controller meets it.
    pub(crate) fn characters_build(&mut self, w: &World) {
        let g = v3(w.gravity);
        self.up = g.try_normalize().map_or(Vector::Y, |n| -n);
        self.fall = g.length();
        let mut walkers: Vec<(i64, String, Walker)> = Vec::new();
        for (id, b) in &w.bodies {
            let (Some(conf), BodyKind::Character) = (&b.character, b.kind) else {
                continue;
            };
            let Some(h) = self.handle_of(id) else {
                continue;
            };
            let Some(c) = self.world.bodies[h].colliders().first().copied() else {
                continue;
            };
            let state = CharacterState {
                id: id.clone(),
                ..CharacterState::default()
            };
            let mut conf = conf.clone();
            if self.twin == Twin::SlopeIgnored {
                conf.slope_limit = 45.0;
            }
            let walker = Walker {
                body: h,
                collider: c,
                conf,
                gravity_scale: b.gravity_scale as f32,
                tall: pose(&b.shapes[0].offset),
                state,
                crouch: false,
                set: None,
                placed: false,
            };
            walkers.push((b.priority, id.clone(), walker));
        }
        walkers.sort_by(|x, y| (x.0, &x.1).cmp(&(y.0, &y.1)));
        self.walkers = walkers.into_iter().map(|w| w.2).collect();
        if self.walkers.is_empty() {
            return;
        }
        let params = self.world.integration_parameters;
        let all: Vec<ColliderHandle> = self
            .world
            .colliders
            .iter()
            .filter(|(_, c)| c.is_enabled())
            .map(|(h, _)| h)
            .collect();
        for h in all {
            let aabb =
                self.world.colliders[h].compute_broad_phase_aabb(&params, &self.world.bodies);
            self.world.broad_phase.set_aabb(&params, h, aabb);
        }
        for i in 0..self.walkers.len() {
            let (shape, at) = self.capsule(i);
            let (grounded, _, _) = self.probe(i, shape.as_ref(), &at);
            self.walkers[i].state.grounded = grounded;
        }
    }

    /// Walker `i`'s capsule as it is now: its shape and its pose in the world, on its body's
    /// current pose.
    fn capsule(&self, i: usize) -> (SharedShape, Pose) {
        let wk = &self.walkers[i];
        let c = &self.world.colliders[wk.collider];
        let local = *c.position_wrt_parent().unwrap_or(&Pose::IDENTITY);
        (
            c.shared_shape().clone(),
            *self.world.bodies[wk.body].position() * local,
        )
    }

    fn walker_of(&self, id: &str) -> Option<usize> {
        self.walkers.iter().position(|w| w.state.id == id)
    }

    /// Applies one of a character body's inputs (Input track entries), or returns false when
    /// `target` isn't a character body.
    pub(crate) fn character_input(&mut self, kind: &str, target: &str, d: &Value) -> bool {
        let Some(i) = self.walker_of(target) else {
            return false;
        };
        let (up, g) = (self.up, self.fall);
        let twin = self.twin;
        let wk = &mut self.walkers[i];
        match kind {
            "move" => {
                let v = v3(vec_of(d, "velocity").unwrap_or_default());
                wk.state.wants = f3(v - up * v.dot(up));
            }
            "jump" if wk.state.grounded => {
                let h = d
                    .get("height")
                    .and_then(Value::as_f64)
                    .unwrap_or(wk.conf.jump);
                let gs = f64::from(wk.gravity_scale);
                wk.set = Some(Character::jump_speed(f64::from(g), gs, h) as f32);
            }
            "launch" if twin != Twin::LaunchGroundedOnly || wk.state.grounded => {
                let v = d.get("vertical").and_then(Value::as_f64).unwrap_or(0.0);
                wk.set = Some(v as f32);
            }
            "place" => {
                let (pos, rot) = match d.get("pose") {
                    Some(p) if p.is_array() => (vec_of(d, "pose"), None),
                    Some(p) => (vec_of(p, "pos"), p.get("rot").cloned()),
                    None => (None, None),
                };
                let rb = &mut self.world.bodies[wk.body];
                let rot = rot
                    .and_then(|r| {
                        let n: Vec<f64> = r.as_array()?.iter().filter_map(Value::as_f64).collect();
                        Some(crate::rotation(&match n.as_slice() {
                            [x, y, z, w] => deep_canvas_physics::doc::Rot::Quat([*x, *y, *z, *w]),
                            [x, y, z] => deep_canvas_physics::doc::Rot::Deg([*x, *y, *z]),
                            _ => return None,
                        }))
                    })
                    .unwrap_or(*rb.rotation());
                let to = pos.map_or(rb.translation(), v3);
                rb.set_position(Pose::from_parts(to, rot), true);
                let me = ShapeRef {
                    body: wk.state.id.clone(),
                    index: 0,
                };
                for t in std::mem::take(&mut wk.state.touching) {
                    self.walked.push(row("contact_end", &me, &t, Payload::None));
                }
                if twin != Twin::PlaceKeepsVertical {
                    wk.state.vertical = 0.0;
                }
                wk.set = None;
                wk.placed = true;
            }
            "crouch" => wk.crouch = d.get("on").and_then(Value::as_bool).unwrap_or(true),
            _ => {}
        }
        true
    }

    /// The controller of `c`, as the interface's rules set it and this backend's twin bends it.
    /// Steps are this wrapper's own ([`Rapier::step_up`]): the engine's autostep checks its way up
    /// from the gap the cast left, `offset`, which its up-cast reads as a hit, so a rounded capsule
    /// never climbs a step whose edge lies under its lower sphere's centre.
    fn controller(&self, c: &Character) -> KinematicCharacterController {
        let rad = |deg: f64| deg.to_radians() as f32;
        KinematicCharacterController {
            up: self.up,
            offset: CharacterLength::Absolute(c.offset as f32),
            slide: true,
            autostep: None,
            max_slope_climb_angle: rad(c.slope_limit),
            min_slope_slide_angle: rad(c.slope_limit),
            // Snap is ours (`settle`): the engine's snap is a shape cast, which loses precision
            // against a very large shape.
            snap_to_ground: None,
            normal_nudge_factor: 1.0e-4,
        }
    }

    /// The query pipeline walker `i` moves through: everything but its own body and sensors.
    fn walls(&self, i: usize) -> QueryPipeline<'_> {
        self.world.query_pipeline_with_filter(
            QueryFilter::default()
                .exclude_rigid_body(self.walkers[i].body)
                .exclude_sensors(),
        )
    }

    /// Walker `i`'s `shape` at `at` cast along the unit `dir` up to `max` m, keeping `gap` m from
    /// what it meets: how far it goes and the outward normal of what it meets.
    fn cast(
        &self,
        i: usize,
        shape: &dyn Shape,
        at: &Pose,
        dir: Vector,
        max: f32,
        gap: f32,
    ) -> Option<(f32, Vector)> {
        let opts = ShapeCastOptions {
            target_distance: gap,
            stop_at_penetration: false,
            max_time_of_impact: max,
            compute_impact_geometry_on_penetration: true,
        };
        let (_, hit) = self.walls(i).cast_shape(at, dir, shape, opts)?;
        Some((hit.time_of_impact, hit.normal1))
    }

    /// One move of walker `i`'s `shape` from `at` by `by` through the engine's controller: the
    /// translation it took, each collider it met and the outward normal it met it at.
    fn controlled(
        &self,
        i: usize,
        shape: &dyn Shape,
        at: &Pose,
        by: Vector,
        dt: f32,
    ) -> (Vector, Vec<(ColliderHandle, Vector)>) {
        let ctrl = self.controller(&self.walkers[i].conf);
        let mut met = Vec::new();
        let out = ctrl.move_shape(dt, &self.walls(i), shape, at, by, |k| {
            met.push((k.handle, k.hit.normal1))
        });
        (out.translation, met)
    }

    /// #182's step: how far walker `i`, standing at `at` and walking `by` (along the ground),
    /// rises onto a step ahead no higher than its step height with its step width free on top,
    /// whose top is walkable; none when there is no such step. Each cast keeps exact contact, so a
    /// gap of `offset` to the step's edge doesn't read as a hit.
    fn step_up(&self, i: usize, shape: &dyn Shape, at: &Pose, by: Vector) -> Option<f32> {
        let c = &self.walkers[i].conf;
        let lift = match self.twin {
            Twin::StepsHigher => c.step_height * 1.25,
            _ => c.step_height,
        } as f32;
        let dir = by.try_normalize()?;
        if lift <= 0.0 || self.cast(i, shape, at, self.up, lift, 0.0).is_some() {
            return None;
        }
        // Its step's width free on top, and at least its radius, so its lowest point stands over
        // the step's top: a lift too low for the step then meets its riser.
        let up = Pose::from_translation(self.up * lift) * *at;
        let width = (c.step_width.max(c.radius) + c.offset) as f32;
        if self.cast(i, shape, &up, dir, width, 0.0).is_some() {
            return None;
        }
        let over = Pose::from_translation(dir * width) * up;
        let (toi, n) = self.cast(i, shape, &over, -self.up, lift, c.offset as f32)?;
        (n.dot(self.up) >= c.walkable() as f32 - 1.0e-6).then_some(lift - toi)
    }

    /// Each shape use under walker `i`'s `shape` at `at` within `reach` of it: the collider,
    /// its closest point under it, the separation and the normal from the shape toward the
    /// character. Read from contact manifolds, as the engine's own grounded test reads them: a
    /// single closest-point query or a cast between a capsule and a very large box loses its
    /// precision in f32.
    fn under(
        &self,
        i: usize,
        shape: &dyn Shape,
        at: &Pose,
        reach: f32,
    ) -> Vec<(ColliderHandle, Vector, f32, Vector)> {
        let q = self.walls(i);
        let aabb = shape.compute_aabb(at).loosened(reach);
        let mut out = Vec::new();
        let mut manifolds: Vec<parry_query::ContactManifold<(), ()>> = Vec::new();
        for (h, c) in q.intersect_aabb_conservative(aabb) {
            manifolds.clear();
            let pos12 = at.inv_mul(c.position());
            let _ = DefaultQueryDispatcher.contact_manifolds(
                &pos12,
                shape,
                c.shape(),
                reach,
                &mut manifolds,
                &mut None,
            );
            // The closest point of each manifold whose normal faces up.
            let mut best: Option<(f32, Vector, Vector)> = None;
            for m in &manifolds {
                let n = -(at.rotation * m.local_n1);
                let up = n.dot(self.up);
                for p in m.points.iter().filter(|p| p.dist <= reach && up >= 1.0e-3) {
                    if best.is_none_or(|b| p.dist < b.0) {
                        best = Some((p.dist, *c.position() * p.local_p2, n));
                    }
                }
            }
            if let Some((d, point, n)) = best {
                out.push((h, point, d, n));
            }
        }
        out
    }

    /// What lies under walker `i`'s `shape` at `at`, within its ground distance: whether a
    /// walkable surface does, whether a steeper one does, and each shape use met with the
    /// contact's point and the normal from the character to it.
    fn probe(
        &self,
        i: usize,
        shape: &dyn Shape,
        at: &Pose,
    ) -> (bool, bool, Vec<(ColliderHandle, Vector, Vector)>) {
        let wk = &self.walkers[i];
        let dist = match self.twin {
            Twin::GroundNear => 0.001,
            _ => wk.conf.ground_distance() as f32,
        };
        let walkable = wk.conf.walkable() as f32;
        let (mut grounded, mut steep, mut under) = (false, false, Vec::new());
        for (h, point, _, n) in self.under(i, shape, at, dist) {
            under.push((h, point, -n));
            if n.dot(self.up) >= walkable - 1.0e-6 {
                grounded = true;
            } else {
                steep = true;
            }
        }
        (grounded, steep, under)
    }

    /// How far walker `i`'s `shape` at `at` drops, straight down, to stand `offset` and
    /// [`CLEAR`] off the nearest walkable surface under it within `reach`; none when there is none.
    fn settle(&self, i: usize, shape: &dyn Shape, at: &Pose, reach: f32) -> Option<f32> {
        let c = &self.walkers[i].conf;
        let (walkable, offset) = (c.walkable() as f32, c.offset as f32);
        self.under(i, shape, at, reach + offset)
            .into_iter()
            .filter(|(_, _, _, n)| n.dot(self.up) >= walkable - 1.0e-6)
            .map(|(_, _, d, n)| (d - offset - CLEAR) / n.dot(self.up))
            .min_by(f32::total_cmp)
            .filter(|drop| *drop > 0.0)
    }

    /// Whether walker `i`'s standing capsule, on its body at `to`, overlaps nothing.
    fn fits(&self, i: usize, to: Vector) -> bool {
        let wk = &self.walkers[i];
        let rb = &self.world.bodies[wk.body];
        let at = Pose::from_parts(to, *rb.rotation()) * wk.tall;
        let shape = Capsule::new_y(wk.conf.half_height as f32, wk.conf.radius as f32);
        let q = self.walls(i);
        let fits = q.intersect_shape(at, &shape).next().is_none();
        fits
    }

    /// Puts walker `i` on its crouching capsule, its lowest point the standing one's, or back on
    /// its standing one.
    fn crouch_to(&mut self, i: usize, low: bool) {
        let wk = &mut self.walkers[i];
        let (r, hh) = (wk.conf.radius as f32, wk.conf.half_height as f32);
        let Some(lh) = wk.conf.crouch_half_height().map(|x| x as f32) else {
            return;
        };
        let (shape, at) = if low {
            let down = wk.tall.rotation * Vector::new(0.0, lh - hh, 0.0);
            (
                SharedShape::capsule_y(lh, r),
                Pose::from_parts(wk.tall.translation + down, wk.tall.rotation),
            )
        } else {
            (SharedShape::capsule_y(hh, r), wk.tall)
        };
        wk.state.crouched = low;
        let c = &mut self.world.colliders[wk.collider];
        c.set_shape(shape);
        c.set_position_wrt_parent(at);
    }

    /// The walls walker `i`'s `shape` at `at` touches that `want` presses into: each as the normal
    /// from the wall toward it, surfaces steeper than its slope limit that aren't ceilings.
    fn pressed(&self, i: usize, at: &Pose, shape: &dyn Shape, want: Vector) -> Vec<Vector> {
        let wk = &self.walkers[i];
        let near = wk.conf.offset as f32 + 1.0e-3;
        let q = self.walls(i);
        let aabb = shape.compute_aabb(at).loosened(near);
        let walkable = wk.conf.walkable() as f32;
        let mut walls: Vec<Vector> = Vec::new();
        for (_, c) in q.intersect_aabb_conservative(aabb) {
            let Ok(Some(k)) = parry_query::contact(at, shape, c.position(), c.shape(), near) else {
                continue;
            };
            // Pressed into, not walked along: a wall the walk runs beside reads a dot product of
            // 0 up to rounding.
            let n = -k.normal1;
            if n.dot(self.up).abs() < walkable && want.dot(n) < -1.0e-4 * want.length() {
                walls.push(n);
            }
        }
        walls
    }

    /// #182's corner rule: a walk into two walls the body touches at once is resolved against
    /// both together, left only its part along their crease, so it rests touching both.
    fn cornered(walls: &[Vector], want: Vector) -> Vector {
        let [a, b, ..] = walls else {
            return want;
        };
        let along = |v: Vector, n: Vector| v - n * v.dot(n);
        let on_a = along(want, *a);
        if on_a.dot(*b) >= 0.0 {
            return on_a;
        }
        let on_b = along(want, *b);
        if on_b.dot(*a) >= 0.0 {
            return on_b;
        }
        let crease = a.cross(*b).try_normalize().unwrap_or(Vector::ZERO);
        crease * want.dot(crease)
    }

    /// Moves every character body one step (#182), writing the contacts each starts and stops.
    pub(crate) fn walk(&mut self) {
        let dt = self.world.integration_parameters.dt;
        for i in 0..self.walkers.len() {
            let rows = self.walk_one(i, dt);
            self.walked.extend(rows);
        }
    }

    fn walk_one(&mut self, i: usize, dt: f32) -> Vec<Raw> {
        let h = self.walkers[i].body;
        if !self.world.bodies[h].is_enabled() {
            return Vec::new();
        }
        if std::mem::take(&mut self.walkers[i].placed) {
            let (shape, at) = self.capsule(i);
            let (grounded, _, _) = self.probe(i, shape.as_ref(), &at);
            let wk = &mut self.walkers[i];
            wk.state.grounded = grounded && wk.state.vertical <= 0.0;
            wk.state.sliding = false;
            return Vec::new();
        }
        let wk = &self.walkers[i];
        let mut vertical = match wk.set {
            Some(v) => v,
            None if wk.state.grounded => 0.0,
            None => wk.state.vertical - self.fall * wk.gravity_scale * dt,
        };
        if wk.crouch && !wk.state.crouched {
            self.crouch_to(i, true);
        }
        let wk = &self.walkers[i];
        let (shape, at) = self.capsule(i);
        let mut want = v3(wk.state.wants.map(f64::from)) + self.up * vertical;
        let walls = self.pressed(i, &at, shape.as_ref(), want);
        // The planted controller resolves one wall's contact a step, alternating, and leaves the
        // other alone.
        let alone = (self.twin == Twin::EachWallAlone && walls.len() >= 2)
            .then(|| walls[(self.step % 2) as usize]);
        // A plain kinematic body (the planted program) runs no controller rule.
        if alone.is_none() && self.twin != Twin::PlainKinematic {
            want = Rapier::cornered(&walls, want);
        }
        let desired = want * dt;
        let walking = wk.state.grounded && vertical <= 0.0;
        let walkable = wk.conf.walkable() as f32;
        let snap =
            (wk.conf.snap > 0.0 && self.twin != Twin::IgnoresSnap).then_some(wk.conf.snap as f32);
        let (mut moved, mut met) = if self.twin == Twin::PlainKinematic {
            (desired, Vec::new())
        } else if let Some(n) = alone {
            (desired - n * desired.dot(n), Vec::new())
        } else {
            self.controlled(i, shape.as_ref(), &at, desired, dt)
        };
        // A walk blocked by a wall: a step ahead lifts it, then it walks on from the top.
        let along = desired - self.up * desired.dot(self.up);
        let blocked = met
            .iter()
            .any(|(_, n)| n.dot(self.up) < walkable && n.dot(self.up) > -1.0e-3);
        let mut stepped = false;
        if walking && blocked && self.twin != Twin::PlainKinematic {
            if let Some(lift) = self.step_up(i, shape.as_ref(), &at, along) {
                let up = Pose::from_translation(self.up * lift) * at;
                let (m, more) = self.controlled(i, shape.as_ref(), &up, along, dt);
                (moved, stepped) = (self.up * lift + m, true);
                met.extend(more);
            }
        }
        // Walking on the ground, it keeps to it: moving down from it, it snaps to a walkable
        // surface within its snap, and it settles back the drift the engine's nudge off what it
        // meets adds (1e-4 m a move), which would lift a body walking along a floor, or pressed
        // into a slope it can't climb, a little every step.
        if walking && !stepped {
            let end = Pose::from_translation(moved) * at;
            let reach = snap.unwrap_or(0.0).max(DRIFT);
            if let Some(drop) = self.settle(i, shape.as_ref(), &end, reach) {
                moved -= self.up * drop;
            }
        }
        let ceiling = met.iter().any(|(_, n)| -n.dot(self.up) >= walkable);
        let met: Vec<ColliderHandle> = met.into_iter().map(|(c, _)| c).collect();
        if vertical > 0.0 && ceiling && self.twin != Twin::KeepsUpward {
            vertical = 0.0;
        }
        let to = self.world.bodies[h].translation() + moved;
        self.world.bodies[h].set_next_kinematic_translation(to);
        let end = Pose::from_translation(moved) * at;
        let (found, steep, under) = self.probe(i, shape.as_ref(), &end);
        let grounded = vertical <= 0.0 && found;
        let sliding = !grounded && steep && moved.dot(self.up) < 0.0;
        let wk = &self.walkers[i];
        if wk.state.crouched
            && !wk.crouch
            && (self.twin == Twin::StandsOnRelease || self.fits(i, to))
        {
            self.crouch_to(i, false);
        }
        // What it touches now: what its move met and what lies under it, by shape use.
        let mut now: BTreeMap<ShapeRef, (Vector, Vector)> = BTreeMap::new();
        for (c, p, n) in under {
            if let Some(u) = self.uses.get(&c) {
                now.insert(u.clone(), (p, n));
            }
        }
        for c in met {
            let Some(u) = self.uses.get(&c) else { continue };
            if now.contains_key(u) {
                continue;
            }
            let other = &self.world.colliders[c];
            let k =
                parry_query::contact(&end, shape.as_ref(), other.position(), other.shape(), 1.0)
                    .ok()
                    .flatten();
            let (p, n) = k.map_or((Vector::ZERO, Vector::ZERO), |k| (k.point2, k.normal1));
            now.insert(u.clone(), (p, n));
        }
        let wk = &mut self.walkers[i];
        let me = ShapeRef {
            body: wk.state.id.clone(),
            index: 0,
        };
        let mut rows = Vec::new();
        for (u, (p, n)) in &now {
            if !wk.state.touching.contains(u) {
                let payload = Payload::Contact {
                    point: f3(*p),
                    normal: f3(*n),
                };
                rows.push(row("contact_begin", &me, u, payload));
            }
        }
        for u in &wk.state.touching {
            if !now.contains_key(u) {
                rows.push(row("contact_end", &me, u, Payload::None));
            }
        }
        wk.state.touching = now.into_keys().collect();
        wk.state.vertical = if grounded { 0.0 } else { vertical };
        wk.state.grounded = grounded;
        wk.state.sliding = sliding;
        wk.set = None;
        rows
    }

    /// Each character body's own state, as the canonical state carries it after every body's.
    pub(crate) fn character_canonical(&self) -> Vec<Canonical> {
        let place = |id: &str| {
            self.bodies
                .iter()
                .position(|(b, _)| b == id)
                .unwrap_or(usize::MAX)
        };
        self.walkers
            .iter()
            .map(|w| {
                let s = &w.state;
                let flag = |b: bool| if b { 1.0 } else { 0.0 };
                let mut values = vec![
                    s.wants[0],
                    s.wants[1],
                    s.wants[2],
                    s.vertical,
                    flag(s.grounded),
                    flag(s.sliding),
                    flag(s.crouched),
                    s.touching.len() as f32,
                ];
                for t in &s.touching {
                    values.push(place(&t.body) as f32);
                    values.push(t.index as f32);
                }
                Canonical {
                    id: s.id.clone(),
                    values,
                }
            })
            .collect()
    }

    /// The character bodies' state as the bytes a checkpoint carries; none without one, so a
    /// world with none checkpoints the bytes it always did. The planted checkpoint leaves out
    /// each one's vertical speed.
    pub(crate) fn character_bytes(&self) -> Vec<u8> {
        if self.walkers.is_empty() {
            return Vec::new();
        }
        let all: Vec<Value> = self
            .walkers
            .iter()
            .map(|w| {
                let s = &w.state;
                let vertical = if self.twin == Twin::CheckpointWithoutVertical {
                    0.0f32
                } else {
                    s.vertical
                };
                let touching: Vec<Value> =
                    s.touching.iter().map(|t| json!([t.body, t.index])).collect();
                json!({"id": s.id, "wants": s.wants.map(f32::to_bits), "vertical": vertical.to_bits(),
                       "grounded": s.grounded, "sliding": s.sliding, "crouched": s.crouched,
                       "crouch": w.crouch, "touching": touching})
            })
            .collect();
        let body = serde_json::to_vec(&all).expect("character state serializes");
        let mut out = TAG.to_vec();
        out.extend((body.len() as u64).to_le_bytes());
        out.extend(body);
        out
    }

    /// Loads the character bodies' state from `rest`, a checkpoint's bytes after the soft
    /// bodies', and returns what follows it.
    pub(crate) fn characters_of<'a>(&mut self, rest: &'a [u8]) -> &'a [u8] {
        let Some(after) = rest.strip_prefix(TAG) else {
            return rest;
        };
        let (len, after) = after.split_at(8.min(after.len()));
        let n = u64::from_le_bytes(len.try_into().unwrap_or([0; 8])) as usize;
        let (body, rest) = after.split_at(n.min(after.len()));
        let all: Vec<Value> = serde_json::from_slice(body).unwrap_or_default();
        for v in all {
            let Some(i) = v["id"].as_str().and_then(|id| self.walker_of(id)) else {
                continue;
            };
            let bits = |x: &Value| f32::from_bits(x.as_u64().unwrap_or(0) as u32);
            let wk = &mut self.walkers[i];
            let s = &mut wk.state;
            for (k, x) in v["wants"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .take(3)
            {
                s.wants[k] = bits(x);
            }
            s.vertical = bits(&v["vertical"]);
            s.grounded = v["grounded"] == true;
            s.sliding = v["sliding"] == true;
            s.crouched = v["crouched"] == true;
            s.touching = v["touching"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|t| {
                    Some(ShapeRef {
                        body: t.get(0)?.as_str()?.to_string(),
                        index: t.get(1)?.as_u64()? as usize,
                    })
                })
                .collect();
            wk.crouch = v["crouch"] == true;
            wk.set = None;
            wk.placed = false;
        }
        rest
    }

    /// Each character body's state as the last step left it.
    pub(crate) fn character_states(&self) -> Vec<CharacterState> {
        self.walkers.iter().map(|w| w.state.clone()).collect()
    }
}
