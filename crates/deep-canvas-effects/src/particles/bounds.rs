//! An item's bounds at t in closed form (#449: bounds and stopping): a box that holds every
//! particle live at t, found from the emit region, the births that can be live then, the
//! motion's reach over the oldest live age, the turbulence table's reach and the bounce planes,
//! without evaluating a particle, so culling, relations and picks read them. Speed never grows at
//! a bounce (restitution and friction run from 0 to 1), so once a particle can turn its reach is
//! a ball: |x(a) − x0| ≤ V k1(a) + |g| k2(a), V the fastest launch.

use super::eval::Baked;
use super::regions;
use super::solve::Arc;
use super::spec::{KillRegion, Launch, Motion, Plane, Shape};
use super::{add, len, V3};

type Box3 = [V3; 2];

fn grow(b: &mut Option<Box3>, lo: V3, hi: V3) {
    match b {
        None => *b = Some([lo, hi]),
        Some([l, h]) => {
            for k in 0..3 {
                l[k] = l[k].min(lo[k]);
                h[k] = h[k].max(hi[k]);
            }
        }
    }
}

/// The births that can be live at t: their birth places' box, the oldest live age, and the
/// fastest velocity a burst adds; none when no particle can be live.
fn live(b: &Baked, t: f64) -> Option<(Box3, f64, f64)> {
    let s = &b.spec;
    let life = s.life[1];
    let region = |at: V3| -> Box3 {
        match (&s.shape, &b.surface) {
            // A surface's reach over the span, or (planted) its bind pose's box alone.
            (Shape::Surface(_), Some(sf)) => match sf.bind.filter(|_| b.planted.bounds_bind_pose) {
                Some(bind) => bind,
                None => sf.reach,
            },
            (Shape::Along(_), _) => curve_box(&b.curve).unwrap_or([at, at]),
            (shape, _) => {
                let [lo, hi] = regions::extent(shape);
                [add(at, lo), add(at, hi)]
            }
        }
    };
    if t < 0.0 || (b.planted.hides_at_span_end && t >= s.span) {
        return None;
    }
    match &b.bursts {
        Some(table) => {
            let mut e = None;
            let (mut oldest, mut push) = (0.0f64, 0.0f64);
            for r in table.rows.iter().filter(|r| r.t <= t && r.t > t - life) {
                let [lo, hi] = region(r.point);
                grow(&mut e, lo, hi);
                oldest = oldest.max(t - r.t);
                let p = add(
                    super::scale(r.normal, s.inherit[0] * r.speed),
                    super::scale(r.velocity, s.inherit[1]),
                );
                push = push.max(len(p));
            }
            e.map(|e| (e, oldest, push + inherited(b)))
        }
        None => {
            let last = match &b.births {
                Some(bt) => bt.time_of(super::eval::last_birth(bt.n(s.span)).max(0.0)),
                None if s.rate > 0.0 => super::eval::last_birth(s.rate * s.span).max(0.0) / s.rate,
                None => return None,
            };
            if t - life >= last {
                return None;
            }
            Some((region(b.origin), t.min(life), inherited(b)))
        }
    }
}

/// The fastest a surface particle's launch inherits: its point's speed and its normal's scale.
fn inherited(b: &Baked) -> f64 {
    b.surface.as_ref().map_or(0.0, |sf| {
        b.spec.inherit[1].abs() * sf.speed * 1.01 + b.spec.inherit[0].abs()
    })
}

fn curve_box(curve: &[V3]) -> Option<Box3> {
    let mut out = None;
    for p in curve {
        grow(&mut out, *p, *p);
    }
    out
}

/// Clamps `bx` by an axis-aligned plane that keeps particles where n·p ≥ offset, when every
/// birth in `e` is on that side (or `always`: a kill region, whose other side holds none live).
fn clamp_by(bx: &mut Box3, e: &Box3, p: &Plane, always: bool) {
    let Some(k) = (0..3).find(|&k| p.normal[k].abs() == 1.0) else {
        return;
    };
    if p.normal[k] > 0.0 {
        // x ≥ offset.
        if always || e[0][k] >= p.offset {
            bx[0][k] = bx[0][k].max(p.offset);
        }
    } else if always || e[1][k] <= -p.offset {
        // x ≤ −offset.
        bx[1][k] = bx[1][k].min(-p.offset);
    }
}

/// The largest distance from the emitter's origin to a corner of `e`.
fn radius(b: &Baked, e: &Box3) -> f64 {
    (0..8)
        .map(|c: usize| {
            let p = [0, 1, 2].map(|k| if c >> k & 1 == 1 { e[1][k] } else { e[0][k] });
            len(super::sub(p, b.origin))
        })
        .fold(0.0, f64::max)
}

/// The item's bounds at t, world metres, `[min, max]`; none when no particle can be live then.
pub fn bounds(b: &Baked, t: f64) -> Option<Box3> {
    let s = &b.spec;
    let (e, age, push) = live(b, t)?;
    if b.planted.emit_bounds {
        return Some(e);
    }
    let mut bx = e;
    match &s.motion {
        Motion::Ballistic {
            launch,
            gravity,
            drag,
        } => {
            let unit = Arc {
                x0: [0.0; 3],
                v0: [0.0; 3],
                g: [0.0; 3],
                drag: *drag,
            };
            let (k1, k2, _) = unit.ks(age);
            let turns = s.bounce.as_ref().is_some_and(|b| !b.planes.is_empty()) || s.land.is_some();
            let fastest = match launch {
                Launch::Cone(v) => v[0].abs().max(v[1].abs()),
                Launch::Vector(v) => len(*v),
            } + push;
            if turns {
                let r = fastest * k1 + len(*gravity) * k2;
                for k in 0..3 {
                    bx[0][k] -= r;
                    bx[1][k] += r;
                }
                for p in s.bounce.iter().flat_map(|b| &b.planes) {
                    clamp_by(&mut bx, &e, p, false);
                }
            } else {
                for k in 0..3 {
                    let (lo_v, hi_v) = match launch {
                        Launch::Vector(v) => (v[k].min(0.0) - push, v[k].max(0.0) + push),
                        Launch::Cone(_) => (-fastest, fastest),
                    };
                    bx[0][k] += lo_v * k1 + gravity[k].min(0.0) * k2;
                    bx[1][k] += hi_v * k1 + gravity[k].max(0.0) * k2;
                }
            }
        }
        Motion::Along { .. } => {
            bx = curve_box(&b.curve).unwrap_or(e);
        }
        Motion::Orbit { .. } => {
            let r = radius(b, &e);
            bx = [
                [0, 1, 2].map(|k| b.origin[k] - r),
                [0, 1, 2].map(|k| b.origin[k] + r),
            ];
        }
        Motion::Drift { amplitude, .. } => {
            for k in 0..3 {
                bx[0][k] -= amplitude;
                bx[1][k] += amplitude;
            }
        }
    }
    if let Some(k) = &s.kill {
        match k.region {
            KillRegion::Box([lo, hi]) if k.keep_inside => {
                for i in 0..3 {
                    bx[0][i] = bx[0][i].max(lo[i]);
                    bx[1][i] = bx[1][i].min(hi[i]);
                }
            }
            KillRegion::Plane(p) => {
                // Kept where n·p ≤ offset inside, ≥ outside.
                let flipped = Plane {
                    normal: super::scale(p.normal, -1.0),
                    offset: -p.offset,
                };
                let keep = if k.keep_inside { flipped } else { p };
                clamp_by(&mut bx, &e, &keep, true);
            }
            _ => {}
        }
    }
    if let (Some(table), Some(tb)) = (&b.turbulence, s.turbulence) {
        let r = tb.strength * table.reach();
        for k in 0..3 {
            bx[0][k] -= r;
            bx[1][k] += r;
        }
    }
    Some(bx)
}

/// The fastest any live particle moves at t, m/s (a streak's reach on screen).
pub fn speed(b: &Baked, t: f64) -> f64 {
    let Some((e, age, push)) = live(b, t) else {
        return 0.0;
    };
    match &b.spec.motion {
        Motion::Ballistic {
            launch,
            gravity,
            drag,
        } => {
            let unit = Arc {
                x0: [0.0; 3],
                v0: [0.0; 3],
                g: [0.0; 3],
                drag: *drag,
            };
            let (k1, _, _) = unit.ks(age);
            let v = match launch {
                Launch::Cone(v) => v[1].abs().max(v[0].abs()),
                Launch::Vector(v) => len(*v),
            };
            v + push + len(*gravity) * k1
        }
        Motion::Along { speed, .. } => speed.abs(),
        Motion::Orbit { spin, .. } => spin.abs() * radius(b, &e),
        Motion::Drift {
            amplitude,
            frequency,
        } => amplitude * frequency * deep_canvas::ops::TAU * 1.8,
    }
}
