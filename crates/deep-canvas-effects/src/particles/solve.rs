//! The ballistic arc in closed form, and the times it meets a plane, a kill region or a landing
//! map (Particles `particles@1`: bounce and kill). Each bounce time is a quadratic root without
//! drag and a fixed eight Newton steps with drag, so a particle's whole path is a pure function of
//! its birth and its age: nothing is stepped, and nothing depends on the time it is read at.

use deep_canvas::ops;

use super::spec::{Bounce, Kill, KillRegion, Plane, Then, NO_DRAG};
use super::{add, dot, scale, sub, Planted, V3};

/// Newton steps a root takes with drag, and a landing's refinement.
pub const NEWTON: usize = 8;

/// One ballistic arc: from `x0` at velocity `v0`, under gravity `g` and linear drag `drag` per
/// second. x(a) = x0 + v0 k1 + g k2 and v(a) = v0 e^(−d a) + g k1, with k1 = (1 − e^(−d a)) ÷ d and
/// k2 = (a − k1) ÷ d; with no drag, k1 = a and k2 = a² ÷ 2.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Arc {
    pub x0: V3,
    pub v0: V3,
    pub g: V3,
    pub drag: f64,
}

impl Arc {
    /// (k1, k2, e^(−d a)) at age `a` of the arc.
    pub fn ks(&self, a: f64) -> (f64, f64, f64) {
        if self.drag < NO_DRAG {
            (a, 0.5 * a * a, 1.0)
        } else {
            let d = self.drag;
            let gone = -ops::expm1(-d * a);
            let k1 = gone / d;
            (k1, (a - k1) / d, 1.0 - gone)
        }
    }

    pub fn at(&self, a: f64) -> V3 {
        let (k1, k2, _) = self.ks(a);
        add(add(self.x0, scale(self.v0, k1)), scale(self.g, k2))
    }

    pub fn vel(&self, a: f64) -> V3 {
        let (k1, _, decay) = self.ks(a);
        add(scale(self.v0, decay), scale(self.g, k1))
    }

    /// The planted wrong form: drag integrated by explicit Euler at 1/120 s.
    pub fn euler(&self, a: f64) -> (V3, V3) {
        let dt = 1.0 / 120.0;
        let (mut x, mut v) = (self.x0, self.v0);
        let mut left = a;
        while left > 0.0 {
            let h = left.min(dt);
            x = add(x, scale(v, h));
            v = add(v, scale(sub(self.g, scale(v, self.drag)), h));
            left -= h;
        }
        (x, v)
    }
}

/// A signed distance along the arc: s(a) = σ (n·x(a) − offset), σ chosen so the arc starts on
/// the positive side.
struct Along {
    s0: f64,
    b: f64,
    g: f64,
    drag: f64,
}

impl Along {
    fn new(arc: &Arc, n: V3, offset: f64, side: f64, on: bool) -> Self {
        Self {
            s0: if on {
                0.0
            } else {
                side * (dot(n, arc.x0) - offset)
            },
            b: side * dot(n, arc.v0),
            g: side * dot(n, arc.g),
            drag: arc.drag,
        }
    }

    fn s(&self, a: f64) -> f64 {
        let arc = Arc {
            x0: [0.0; 3],
            v0: [0.0; 3],
            g: [0.0; 3],
            drag: self.drag,
        };
        let (k1, k2, _) = arc.ks(a);
        self.s0 + self.b * k1 + self.g * k2
    }

    fn ds(&self, a: f64) -> f64 {
        if self.drag < NO_DRAG {
            return self.b + self.g * a;
        }
        let gone = -ops::expm1(-self.drag * a);
        self.b * (1.0 - gone) + self.g * gone / self.drag
    }

    /// The first a in (0, hi] where s falls to 0.
    fn first_root(&self, hi: f64) -> Option<f64> {
        if self.drag < NO_DRAG {
            return self.quadratic(hi);
        }
        // s'' = e^(−d a) (g − d b) keeps one sign, so s' turns at most once: at a* where
        // e^(−d a*) = g ÷ (g − d b). Each side of it s is monotone, and its one root there is
        // found by Newton from the end where s and s'' share a sign.
        let d = self.drag;
        let curve = self.g - d * self.b;
        let mut cuts = vec![0.0];
        if curve != 0.0 {
            let e = self.g / curve;
            if e > 0.0 && e < 1.0 {
                let turn = -ops::log(e) / d;
                if turn < hi {
                    cuts.push(turn);
                }
            }
        }
        cuts.push(hi);
        for w in cuts.windows(2) {
            let (lo, up) = (w[0], w[1]);
            let (slo, sup) = (self.s(lo), self.s(up));
            if !(slo > 0.0 && sup <= 0.0) {
                continue;
            }
            if sup == 0.0 {
                return Some(up);
            }
            let mut x = if sup * curve > 0.0 { up } else { lo };
            for _ in 0..NEWTON {
                let f = self.s(x);
                let df = self.ds(x);
                if df == 0.0 || f == 0.0 {
                    break;
                }
                x = (x - f / df).clamp(lo, up);
            }
            return Some(x);
        }
        None
    }

    /// The first root of s0 + b a + g a² ÷ 2 in (0, hi] where s is falling.
    fn quadratic(&self, hi: f64) -> Option<f64> {
        let (c, b, s0) = (0.5 * self.g, self.b, self.s0);
        let mut roots = [f64::NAN; 2];
        if c == 0.0 {
            if b != 0.0 {
                roots[0] = -s0 / b;
            }
        } else {
            let disc = b * b - 4.0 * c * s0;
            if disc < 0.0 {
                return None;
            }
            let q = -0.5 * (b + ops::sqrt(disc).copysign(b));
            if q != 0.0 {
                roots = [q / c, s0 / q];
            } else {
                roots[0] = 0.0;
            }
        }
        roots
            .into_iter()
            .filter(|r| *r > 0.0 && *r <= hi && b + self.g * r <= 1e-9 * (1.0 + b.abs()))
            .min_by(f64::total_cmp)
    }
}

/// The first time in (0, hi] the arc meets `plane` moving against its normal: particles stay on
/// the side n·p ≥ offset. `on`: the arc starts on this plane, having just bounced off it.
pub fn plane_root(arc: &Arc, plane: &Plane, on: bool, hi: f64) -> Option<f64> {
    Along::new(arc, plane.normal, plane.offset, 1.0, on).first_root(hi)
}

/// The first time in (0, hi] the arc crosses `plane` either way.
pub fn crossing(arc: &Arc, plane: &Plane, hi: f64) -> Option<f64> {
    let s0 = dot(plane.normal, arc.x0) - plane.offset;
    let side = if s0 == 0.0 {
        dot(plane.normal, arc.v0).signum()
    } else {
        s0.signum()
    };
    if side == 0.0 {
        return None;
    }
    Along::new(arc, plane.normal, plane.offset, side, false).first_root(hi)
}

/// What a ground the particle can land on answers: the first time in (0, hi] the arc meets it
/// and the ground's normal there, `on` when the arc starts on it.
pub trait Ground {
    fn first_hit(&self, arc: &Arc, hi: f64, on: bool) -> Option<(f64, V3)>;
}

/// What happened to a ballistic particle by its age: where it is and how it moves, how many
/// times it met a plane or the ground, and whether it rests; `None` when it died.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Path {
    pub pos: V3,
    pub vel: V3,
    pub contacts: u8,
    pub resting: bool,
}

/// How a particle's path ends before its life does.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum End {
    /// It flies until its life ends.
    Life,
    /// It rests from this age on, here.
    Rests(f64, V3),
    /// It dies at this age, here, moving so.
    Dies(f64, V3, V3),
}

/// A ballistic particle's whole path over its life: each segment's start age and arc, the
/// contacts before each, and how it ends.
#[derive(Clone, Debug, PartialEq)]
pub struct Track {
    pub segments: Vec<(f64, Arc)>,
    pub end: End,
    /// Each contact in order: its age, where, and the plane's index (none for the ground), the
    /// one it dies or rests at included.
    pub hits: Vec<(f64, V3, Option<usize>)>,
}

impl Track {
    /// Where the particle is at `age`, or none once it died.
    pub fn at(&self, age: f64) -> Option<Path> {
        let k = self.segments.partition_point(|(s, _)| *s <= age).max(1) - 1;
        let contacts = k as u8;
        match self.end {
            End::Dies(a, _, _) if age >= a => return None,
            End::Rests(a, p) if age >= a => {
                return Some(Path {
                    pos: p,
                    vel: [0.0; 3],
                    contacts: contacts + 1,
                    resting: true,
                })
            }
            _ => {}
        }
        let (start, arc) = self.segments[k];
        Some(Path {
            pos: arc.at(age - start),
            vel: arc.vel(age - start),
            contacts,
            resting: false,
        })
    }
}

/// What ends one segment of the path.
enum Event {
    Plane(usize),
    Ground(V3),
    Killed,
}

/// The velocity after a bounce off a surface of unit normal `n`: the normal part reversed and
/// scaled by the restitution, the tangent part by 1 − friction.
pub fn reflect(v: V3, n: V3, restitution: f64, friction: f64) -> V3 {
    let vn = scale(n, dot(v, n));
    let vt = sub(v, vn);
    sub(scale(vt, 1.0 - friction), scale(vn, restitution))
}

/// A ballistic particle at `age` of a life of `life` (see [`track`]).
#[allow(clippy::too_many_arguments)]
pub fn ballistic(
    first: Arc,
    age: f64,
    life: f64,
    bounce: Option<&Bounce>,
    ground: Option<(&dyn Ground, Then)>,
    kill: Option<&Kill>,
    planted: Planted,
) -> Option<Path> {
    if planted.euler_drag && bounce.is_none() && ground.is_none() && kill.is_none() {
        let (pos, vel) = first.euler(age);
        return Some(Path {
            pos,
            vel,
            contacts: 0,
            resting: false,
        });
    }
    track(first, life, bounce, ground, kill, planted).at(age)
}

/// A ballistic particle's path over a life of `life`: its arc from birth, each bounce off the
/// declared planes or the ground and each kill region's exit solved in closed form, in order.
/// Every event's time is found over the particle's whole remaining life, never over an age it is
/// read at, so the path is the same whenever it is read.
pub fn track(
    first: Arc,
    life: f64,
    bounce: Option<&Bounce>,
    ground: Option<(&dyn Ground, Then)>,
    kill: Option<&Kill>,
    planted: Planted,
) -> Track {
    let defaults = Bounce::default();
    let rules = bounce.unwrap_or(&defaults);
    let planes: &[Plane] = match bounce {
        Some(b) if planted.two_planes => &b.planes[..b.planes.len().min(2)],
        Some(b) => &b.planes,
        None => &[],
    };
    let (mut arc, mut start, mut contacts) = (first, 0.0, 0u8);
    // The plane or ground the arc starts on, having just bounced off it.
    let (mut on_plane, mut on_ground) = (None::<usize>, false);
    let mut segments = vec![(0.0, first)];
    let mut hits = Vec::new();
    if kill.is_some_and(|k| !keeps(k, first.x0)) {
        return Track {
            segments,
            end: End::Dies(0.0, first.x0, first.v0),
            hits,
        };
    }
    loop {
        let hi = life - start;
        let mut next: Option<(f64, Event)> = None;
        let take = |a: f64, e: Event, next: &mut Option<(f64, Event)>| {
            if next.as_ref().is_none_or(|(b, _)| a < *b) {
                *next = Some((a, e));
            }
        };
        for (k, p) in planes.iter().enumerate() {
            if let Some(a) = plane_root(&arc, p, on_plane == Some(k), hi) {
                take(a, Event::Plane(k), &mut next);
            }
        }
        if let Some((g, _)) = ground {
            if let Some((a, n)) = g.first_hit(&arc, hi, on_ground) {
                take(a, Event::Ground(n), &mut next);
            }
        }
        if let Some(a) = kill.and_then(|k| exit(&arc, k, hi)) {
            take(a, Event::Killed, &mut next);
        }
        let Some((a, event)) = next else {
            return Track {
                segments,
                end: End::Life,
                hits,
            };
        };
        let (at, v) = (arc.at(a), arc.vel(a));
        let (normal, then) = match event {
            Event::Killed => {
                return Track {
                    segments,
                    end: End::Dies(start + a, at, v),
                    hits,
                }
            }
            Event::Plane(k) => (planes[k].normal, Then::Bounce),
            Event::Ground(n) => (n, ground.map_or(Then::Rest, |(_, t)| t)),
        };
        contacts += 1;
        let plane = match event {
            Event::Plane(k) => Some(k),
            _ => None,
        };
        hits.push((start + a, at, plane));
        let ends = match then {
            Then::Bounce if contacts < rules.max => None,
            Then::Bounce => Some(rules.then),
            other => Some(other),
        };
        match ends {
            Some(Then::Die) => {
                return Track {
                    segments,
                    end: End::Dies(start + a, at, v),
                    hits,
                }
            }
            Some(_) => {
                return Track {
                    segments,
                    end: End::Rests(start + a, at),
                    hits,
                }
            }
            None => {}
        }
        on_plane = match event {
            Event::Plane(k) => Some(k),
            _ => None,
        };
        on_ground = matches!(event, Event::Ground(_));
        arc = Arc {
            x0: at,
            v0: reflect(v, normal, rules.restitution, rules.friction),
            ..arc
        };
        start += a;
        segments.push((start, arc));
    }
}

/// Whether a kill region keeps a point.
pub fn keeps(k: &Kill, x: V3) -> bool {
    let inside = match k.region {
        KillRegion::Box([lo, hi]) => (0..3).all(|i| x[i] >= lo[i] && x[i] <= hi[i]),
        KillRegion::Plane(p) => dot(p.normal, x) <= p.offset,
    };
    inside == k.keep_inside
}

/// The first time in (0, hi] the arc leaves what the kill region keeps.
fn exit(arc: &Arc, k: &Kill, hi: f64) -> Option<f64> {
    let planes: Vec<Plane> = match k.region {
        KillRegion::Plane(p) => vec![p],
        KillRegion::Box([lo, up]) => (0..3)
            .flat_map(|i| {
                let mut n = [0.0; 3];
                n[i] = 1.0;
                [
                    Plane {
                        normal: n,
                        offset: lo[i],
                    },
                    Plane {
                        normal: n,
                        offset: up[i],
                    },
                ]
            })
            .collect(),
    };
    let mut times: Vec<f64> = planes.iter().filter_map(|p| crossing(arc, p, hi)).collect();
    times.sort_by(f64::total_cmp);
    // A crossing ends the particle when just past it the region no longer keeps it.
    times.into_iter().find(|&a| {
        let after = (a + 1e-9 * (1.0 + a)).min(hi);
        !keeps(k, arc.at(after))
    })
}
