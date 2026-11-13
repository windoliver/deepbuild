//! #523: the kinematic solve (Kinematic solve; Joint: gear, pulley). In kinematic mode each step
//! places every body a hinge, slider or fixed joint carries from the world or a placed body, at its
//! coordinate through the joint's own frames, so a placed hinge reads the coordinate it was given.
//! A driver's coordinate is its channel's; every other one is solved, warm-started from the
//! world's own joint coordinates, so that each gear, pulley and closing joint holds, by
//! Gauss–Newton with the world's fixed iteration cap. A solve that ends its cap with a residual
//! past the tolerance jams, naming the joint whose residual is largest: it never reports a jam as
//! success. Nothing here is kept between steps but what the world's bytes hold, so a restored
//! world solves as a played one.

use std::collections::HashMap;

use deep_canvas_physics::backend::{about_x, Targets};
use deep_canvas_physics::doc::{BodyKind, JointKind, Mode, World};
use rapier3d::math::glamx::glam::{DQuat, DVec3};
use rapier3d::math::{Pose, Rotation};
use rapier3d::prelude::*;

use crate::{Rapier, Twin};

/// A pose in f64, which the solve works in.
#[derive(Clone, Copy, Debug)]
struct P {
    r: DQuat,
    t: DVec3,
}

impl P {
    const ID: P = P {
        r: DQuat::IDENTITY,
        t: DVec3::ZERO,
    };

    fn of(p: &Pose) -> P {
        let (q, t) = (p.rotation, p.translation);
        P {
            r: DQuat::from_xyzw(q.x.into(), q.y.into(), q.z.into(), q.w.into()),
            t: DVec3::new(t.x.into(), t.y.into(), t.z.into()),
        }
    }

    fn pose(&self) -> Pose {
        let r = self.r.normalize();
        Pose::from_parts(
            Vector::new(self.t.x as f32, self.t.y as f32, self.t.z as f32),
            Rotation::from_xyzw(r.x as f32, r.y as f32, r.z as f32, r.w as f32),
        )
    }

    fn mul(&self, o: &P) -> P {
        P {
            r: self.r * o.r,
            t: self.r * o.t + self.t,
        }
    }

    fn inverse(&self) -> P {
        let r = self.r.inverse();
        P {
            r,
            t: -(r * self.t),
        }
    }

    fn point(&self, v: DVec3) -> DVec3 {
        self.r * v + self.t
    }
}

/// A body a joint carries: the joint, its kind, the body it hangs from (`None` for one the solve
/// doesn't place) and the body it places.
struct Link {
    joint: String,
    handle: ImpulseJointHandle,
    kind: JointKind,
    driven: bool,
}

/// What the solve holds besides the links: each row's joint.
enum Rule {
    /// Its second hinge's coordinate is `ratio` × its first's (rad).
    Gear {
        joint: String,
        a: usize,
        b: usize,
        ratio: f64,
    },
    /// `|a's anchor − ground_a| + ratio × |b's anchor − ground_b|` keeps `sum` (m), its first
    /// length within `range`.
    Pulley {
        joint: String,
        a: (RigidBodyHandle, DVec3, DVec3),
        b: (RigidBodyHandle, DVec3, DVec3),
        ratio: f64,
        sum: f64,
        range: [f64; 2],
    },
    /// A joint whose two bodies are both placed otherwise: its frames meet.
    Closing {
        joint: String,
        handle: ImpulseJointHandle,
        kind: JointKind,
    },
}

/// The solve a kinematic world built.
#[derive(Default)]
pub(crate) struct Kinematic {
    links: Vec<Link>,
    rules: Vec<Rule>,
    iterations: u32,
    tolerance: f64,
}

/// Solves `a x = b` for small square `a`, by elimination with partial pivoting.
fn solve(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for c in 0..n {
        let p = (c..n)
            .max_by(|&i, &j| a[i][c].abs().total_cmp(&a[j][c].abs()))
            .unwrap_or(c);
        a.swap(c, p);
        b.swap(c, p);
        if a[c][c].abs() < 1e-300 {
            continue;
        }
        let pivot = a[c].clone();
        for r in c + 1..n {
            let f = a[r][c] / pivot[c];
            for (x, y) in a[r][c..].iter_mut().zip(&pivot[c..]) {
                *x -= f * y;
            }
            b[r] -= f * b[c];
        }
    }
    let mut x = vec![0.0; n];
    for r in (0..n).rev() {
        let s: f64 = (r + 1..n).map(|k| a[r][k] * x[k]).sum();
        x[r] = if a[r][r].abs() < 1e-300 {
            0.0
        } else {
            (b[r] - s) / a[r][r]
        };
    }
    x
}

fn max_abs(r: &[(f64, usize)]) -> f64 {
    r.iter().fold(0.0, |m, (x, _)| m.max(x.abs()))
}

impl Rapier {
    fn frames(&self, h: ImpulseJointHandle) -> Option<(RigidBodyHandle, P, RigidBodyHandle, P)> {
        let j = self.world.impulse_joints.get(h)?;
        Some((
            j.body1(),
            P::of(&j.data.local_frame1),
            j.body2(),
            P::of(&j.data.local_frame2),
        ))
    }

    /// The solve for `w`, in kinematic mode: the links from the world and each body that doesn't
    /// move by itself, in the solve's driver order, then by joint ID, and the rules the rest make.
    pub(crate) fn kinematic(&mut self, w: &World) {
        self.kin = None;
        if w.mode != Mode::Kinematic {
            return;
        }
        let drivers: Vec<&String> = w
            .solve
            .iter()
            .flat_map(|s| &s.drivers)
            .map(|d| &d.0)
            .collect();
        let mut order: Vec<&(String, ImpulseJointHandle, JointKind)> = drivers
            .iter()
            .filter_map(|d| self.joints.iter().find(|j| &j.0 == *d))
            .collect();
        order.extend(self.joints.iter().filter(|j| !drivers.contains(&&j.0)));
        // Placed by themselves: the world, each static body and each that follows a channel.
        let mut placed: Vec<RigidBodyHandle> = self.world_body.into_iter().collect();
        for (id, h) in &self.bodies {
            let b = &w.bodies[id];
            if b.kind == BodyKind::Static || b.follow.is_some() {
                placed.push(*h);
            }
        }
        let mut links = Vec::new();
        let mut taken = vec![false; order.len()];
        loop {
            let mut grew = false;
            for (i, (id, h, kind)) in order.iter().enumerate() {
                if taken[i]
                    || !matches!(
                        kind,
                        JointKind::Hinge | JointKind::Slider | JointKind::Fixed
                    )
                {
                    continue;
                }
                let Some((b1, _, b2, _)) = self.frames(*h) else {
                    continue;
                };
                if placed.contains(&b1) && !placed.contains(&b2) {
                    placed.push(b2);
                    taken[i] = true;
                    grew = true;
                    links.push(Link {
                        joint: id.clone(),
                        handle: *h,
                        kind: *kind,
                        driven: drivers.contains(&id),
                    });
                }
            }
            if !grew {
                break;
            }
        }
        let mut rules = Vec::new();
        for (i, (id, h, kind)) in order.iter().enumerate() {
            let Some((b1, _, b2, _)) = self.frames(*h) else {
                continue;
            };
            let closes = matches!(kind, JointKind::Hinge | JointKind::Ball | JointKind::Fixed);
            if !taken[i] && closes && placed.contains(&b1) && placed.contains(&b2) {
                rules.push(Rule::Closing {
                    joint: id.clone(),
                    handle: *h,
                    kind: *kind,
                });
            }
        }
        let link_of = |j: &str| links.iter().position(|l: &Link| l.joint == j);
        let anchor = |e: &deep_canvas_physics::doc::End| {
            let p = e.point;
            (
                e.body.as_ref().and_then(|b| self.handle_of(b)),
                DVec3::new(p[0], p[1], p[2]),
            )
        };
        for (id, j) in &w.joints {
            match j.kind {
                JointKind::Gear => {
                    if let (Some(a), Some(b)) = (
                        j.coupling.of.first().and_then(|x| link_of(x)),
                        j.coupling.of.get(1).and_then(|x| link_of(x)),
                    ) {
                        rules.push(Rule::Gear {
                            joint: id.clone(),
                            a,
                            b,
                            ratio: j.coupling.ratio,
                        });
                    }
                }
                JointKind::Pulley => {
                    let (Some(p), (Some(ha), pa), (Some(hb), pb)) =
                        (&j.coupling.pulley, anchor(&j.a), anchor(&j.b))
                    else {
                        continue;
                    };
                    let g = |v: [f64; 3]| DVec3::new(v[0], v[1], v[2]);
                    let (ga, gb) = (g(p.ground_a), g(p.ground_b));
                    let len = |h: RigidBodyHandle, at: DVec3, ground: DVec3| {
                        (P::of(self.world.bodies[h].position()).point(at) - ground).length()
                    };
                    let sum = len(ha, pa, ga) + j.coupling.ratio * len(hb, pb, gb);
                    rules.push(Rule::Pulley {
                        joint: id.clone(),
                        a: (ha, pa, ga),
                        b: (hb, pb, gb),
                        ratio: j.coupling.ratio,
                        sum,
                        range: [
                            p.length_min.unwrap_or(f64::MIN),
                            p.length_max.unwrap_or(f64::MAX),
                        ],
                    });
                }
                _ => {}
            }
        }
        let (iterations, tolerance) = w
            .solve
            .as_ref()
            .map_or((20, 1e-5), |s| (s.iterations, s.tolerance));
        self.kin = Some(Kinematic {
            links,
            rules,
            iterations,
            tolerance,
        });
    }

    /// Each link's child placed from its parent at coordinates `q` (deg for a hinge, m for a
    /// slider), from the roots' poses `at`.
    fn place(
        &self,
        k: &Kinematic,
        q: &[f64],
        at: &HashMap<RigidBodyHandle, P>,
    ) -> HashMap<RigidBodyHandle, P> {
        let mut poses = at.clone();
        for (l, q) in k.links.iter().zip(q) {
            let Some((b1, f1, b2, f2)) = self.frames(l.handle) else {
                continue;
            };
            let a = poses.get(&b1).copied().unwrap_or(P::ID);
            let joint = match l.kind {
                JointKind::Hinge => P {
                    r: DQuat::from_array(about_x(*q)),
                    t: DVec3::ZERO,
                },
                JointKind::Slider => P {
                    r: DQuat::IDENTITY,
                    t: DVec3::X * *q,
                },
                _ => P::ID,
            };
            poses.insert(b2, a.mul(&f1).mul(&joint).mul(&f2.inverse()));
        }
        poses
    }

    /// Every rule's residual rows at `q`, each with its rule's index.
    fn residuals(
        &self,
        k: &Kinematic,
        q: &[f64],
        at: &HashMap<RigidBodyHandle, P>,
    ) -> Vec<(f64, usize)> {
        let poses = self.place(k, q, at);
        let pose = |h: RigidBodyHandle| {
            poses
                .get(&h)
                .copied()
                .unwrap_or_else(|| P::of(self.world.bodies[h].position()))
        };
        let mut out = Vec::new();
        for (i, rule) in k.rules.iter().enumerate() {
            match rule {
                Rule::Gear { a, b, ratio, .. } => {
                    out.push(((q[*b] - ratio * q[*a]).to_radians(), i));
                }
                Rule::Pulley {
                    a,
                    b,
                    ratio,
                    sum,
                    range,
                    ..
                } => {
                    let len = |(h, p, g): &(RigidBodyHandle, DVec3, DVec3)| {
                        (pose(*h).point(*p) - *g).length()
                    };
                    let la = len(a);
                    out.push((la + ratio * len(b) - sum, i));
                    out.push(((la - range[0]).min(0.0), i));
                    out.push(((la - range[1]).max(0.0), i));
                }
                Rule::Closing { handle, kind, .. } => {
                    let Some((b1, f1, b2, f2)) = self.frames(*handle) else {
                        continue;
                    };
                    let (x1, x2) = (pose(b1).mul(&f1), pose(b2).mul(&f2));
                    let gap = x2.t - x1.t;
                    out.extend([gap.x, gap.y, gap.z].map(|g| (g, i)));
                    match kind {
                        JointKind::Hinge => {
                            let c = (x1.r * DVec3::X).cross(x2.r * DVec3::X);
                            out.extend([c.x, c.y, c.z].map(|g| (g, i)));
                        }
                        JointKind::Fixed => {
                            let e = x1.r.inverse() * x2.r;
                            let e = if e.w < 0.0 { -e } else { e };
                            out.extend([e.x, e.y, e.z].map(|g| (2.0 * g, i)));
                        }
                        _ => {}
                    }
                }
            }
        }
        out
    }

    /// The coordinate each link holds now: a hinge's `joint_coordinate`, a slider's travel.
    fn held(&self, k: &Kinematic) -> Vec<f64> {
        let states = self.joint_states();
        k.links
            .iter()
            .map(|l| {
                states
                    .iter()
                    .find(|s| s.id == l.joint)
                    .and_then(|s| s.coordinate)
                    .unwrap_or(0.0)
            })
            .collect()
    }

    /// Places every body the solve carries for a step at targets `t`, and returns the joint a jam
    /// names, if the solve ended its cap with a residual past its tolerance.
    pub(crate) fn solve_step(&mut self, t: &Targets) -> Option<String> {
        let k = self.kin.take()?;
        let mut at = HashMap::new();
        for (_, h) in &self.bodies {
            let rb = &self.world.bodies[*h];
            // A kinematic body's next pose: where a channel it follows sets it this step.
            let p = if rb.is_kinematic() {
                P::of(rb.next_position())
            } else {
                P::of(rb.position())
            };
            at.insert(*h, p);
        }
        if let Some(h) = self.world_body {
            at.insert(h, P::ID);
        }
        let mut q = self.held(&k);
        for (i, l) in k.links.iter().enumerate() {
            if let Some((_, v)) = t
                .coords
                .iter()
                .find(|(j, _)| *j == l.joint)
                .filter(|_| l.driven)
            {
                q[i] = *v;
            }
        }
        let unknown: Vec<usize> = (0..k.links.len())
            .filter(|&i| !k.links[i].driven && k.links[i].kind != JointKind::Fixed)
            .collect();
        let mut jam = None;
        if !k.rules.is_empty() {
            let mut r = self.residuals(&k, &q, &at);
            let mut it = 0;
            while max_abs(&r) > k.tolerance && it < k.iterations && !unknown.is_empty() {
                it += 1;
                // Each column by central differences.
                let h = 1e-6;
                let cols: Vec<Vec<f64>> = unknown
                    .iter()
                    .map(|&u| {
                        let (mut up, mut down) = (q.clone(), q.clone());
                        up[u] += h;
                        down[u] -= h;
                        let (ru, rd) =
                            (self.residuals(&k, &up, &at), self.residuals(&k, &down, &at));
                        ru.iter()
                            .zip(&rd)
                            .map(|(a, b)| (a.0 - b.0) / (2.0 * h))
                            .collect()
                    })
                    .collect();
                let n = unknown.len();
                let mut a = vec![vec![0.0; n]; n];
                let mut g = vec![0.0; n];
                for i in 0..n {
                    for j in 0..n {
                        a[i][j] = cols[i].iter().zip(&cols[j]).map(|(x, y)| x * y).sum();
                    }
                    g[i] = -cols[i].iter().zip(&r).map(|(x, y)| x * y.0).sum::<f64>();
                    a[i][i] += 1e-12 * (1.0 + a[i][i]);
                }
                let step = solve(a, g);
                // Halve a step that makes it worse, at most four times.
                let before = r.iter().map(|x| x.0 * x.0).sum::<f64>();
                let mut scale = 1.0;
                let mut next = q.clone();
                for _ in 0..5 {
                    next = q.clone();
                    for (s, &u) in step.iter().zip(&unknown) {
                        next[u] += scale * s;
                    }
                    let rn = self.residuals(&k, &next, &at);
                    if rn.iter().map(|x| x.0 * x.0).sum::<f64>() <= before {
                        break;
                    }
                    scale *= 0.5;
                }
                q = next;
                r = self.residuals(&k, &q, &at);
            }
            if max_abs(&r) > k.tolerance && self.twin != Twin::SolveCapSuccess {
                let worst = r
                    .iter()
                    .max_by(|a, b| a.0.abs().total_cmp(&b.0.abs()))
                    .map(|x| x.1);
                jam = worst.map(|i| match &k.rules[i] {
                    Rule::Gear { joint, .. }
                    | Rule::Pulley { joint, .. }
                    | Rule::Closing { joint, .. } => joint.clone(),
                });
            }
        }
        let poses = self.place(&k, &q, &at);
        for l in &k.links {
            let Some((_, _, b2, _)) = self.frames(l.handle) else {
                continue;
            };
            if let Some(p) = poses.get(&b2) {
                self.world.bodies[b2].set_next_kinematic_position(p.pose());
            }
        }
        self.kin = Some(k);
        jam
    }
}
