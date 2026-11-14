//! A particle's state at t in f64, the closed form evaluated data and checks read (Particles
//! `particles@1`: Semantics). Particle i's slot is born every `count ÷ rate` seconds while the
//! emitter runs; its draws are a hash of the item's seed, its index and its generation, by the
//! shipped graph's keys, so a base item's particles are where the shipped graph puts them.

use deep_canvas::ops::{self, TAU};

use super::births::Births;
use super::regions::{self, Draws};
use super::solve::{self, Arc, Ground};
use super::spec::{Launch, Motion, Shape, Spec, Then};
use super::{add, bursts, dot, heightmap, len, scale, sub, surface, turbulence, Planted, V3};
use crate::interp::{hash, hash1};

/// Instance floats per particle, as the draw reads them: its position, its age over its life
/// (−1 when it isn't alive), its velocity, and one unused (the shipped graph's columns).
pub const FLOATS: usize = 8;

/// An item ready to evaluate: its params read, its seed and emitter origin, the curve it runs
/// along, and the tables built at check.
#[derive(Clone, Debug)]
pub struct Baked {
    pub id: String,
    pub spec: Spec,
    pub seed: u32,
    /// The emitter's origin in world metres, from its anchor.
    pub origin: V3,
    /// The curve the shape or the motion runs along, resampled evenly by arc length, and its
    /// length.
    pub curve: Vec<V3>,
    pub curve_len: f64,
    /// The landing map, when the item lands.
    pub map: Option<heightmap::Map>,
    /// The bursts, when the item bursts rather than emitting at its rate.
    pub bursts: Option<bursts::Table>,
    /// The turbulence table, when the item has turbulence.
    pub turbulence: Option<turbulence::Table>,
    /// The emitted count, when a channel keys the rate.
    pub births: Option<Births>,
    /// The surface it emits on, when its shape is one.
    pub surface: Option<std::sync::Arc<surface::Surface>>,
    /// The frames the process drew, s: only the planted inherit reads them.
    pub drawn: Vec<f64>,
    pub planted: Planted,
}

impl Baked {
    pub fn new(id: &str, spec: Spec, seed: u32, origin: V3) -> Self {
        Self {
            id: id.to_string(),
            spec,
            seed,
            origin,
            curve: Vec::new(),
            curve_len: 0.0,
            map: None,
            bursts: None,
            turbulence: None,
            births: None,
            surface: None,
            drawn: Vec::new(),
            planted: Planted::default(),
        }
    }
}

/// A particle's birth: its generation (a burst's row for a burst's particle), when, its key,
/// the point its region is about, and the velocity it inherits.
#[derive(Clone, Copy)]
pub(crate) struct Birth {
    pub(crate) generation: u32,
    born: f64,
    pub(crate) h: u32,
    at: V3,
    push: V3,
    pub(crate) age: f64,
}

/// Slot `e`'s latest birth at t, from the bursts or from the emitter's rate.
pub(crate) fn birth(b: &Baked, e: u32, t: f64) -> Option<Birth> {
    let spec = &b.spec;
    match &b.bursts {
        Some(table) => {
            let (row, j) = table.slot(e, spec.count, t)?;
            let r = table.rows[row];
            let push = add(
                scale(r.normal, spec.inherit[0] * r.speed),
                scale(r.velocity, spec.inherit[1]),
            );
            Some(Birth {
                generation: row as u32,
                born: r.t,
                h: hash(&[b.seed, j, row as u32, 0xb0b5]),
                at: r.point,
                push,
                age: t - r.t,
            })
        }
        None => {
            let (generation, age) = born(spec, b.births.as_ref(), e, t)?;
            Some(Birth {
                generation,
                born: t - age,
                h: hash(&[b.seed, e, generation]),
                at: b.origin,
                push: [0.0; 3],
                age,
            })
        }
    }
}

/// One particle at a time t.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct State {
    /// Its slot.
    pub index: u32,
    /// Its generation in the slot.
    pub generation: u32,
    /// When it was born, in seconds of the document.
    pub born: f64,
    pub age: f64,
    pub life: f64,
    pub pos: V3,
    pub vel: V3,
    /// How many times it met a plane or the ground.
    pub contacts: u8,
    pub resting: bool,
}

/// The uniform draw `k` of a particle whose key is `h`, as the shipped graph's `rand@1`.
pub fn draw(h: u32, k: u32) -> f64 {
    f64::from(hash1(hash(&[h, k])) >> 8) * 5.960_464_5e-8
}

fn mix(a: f64, b: f64, t: f64) -> f64 {
    a * (1.0 - t) + b * t
}

/// Slot `e`'s latest birth at t from the emitter's rate: (its generation, its age), or none
/// before its first birth or when its first birth comes after the span. Births so far are
/// n(t) = ∫₀ᵗ rate (rate × t when no channel keys it), birth k is slot k mod count's, and the span
/// allows births up to n(span): slot e's latest is k = e + count ⌊(min(⌊n⌋, ⌊n(span)⌋) − e) ÷
/// count⌋, born when n reached k (the shipped graph's slots, in whole numbers).
pub fn born(spec: &Spec, births: Option<&Births>, e: u32, t: f64) -> Option<(u32, f64)> {
    if spec.count == 0 || (births.is_none() && spec.rate <= 0.0) {
        return None;
    }
    let (n, n_span) = match births {
        Some(b) => (b.n(t), b.n(spec.span)),
        None => (spec.rate * t, spec.rate * spec.span),
    };
    let last = n.floor().min(last_birth(n_span));
    let e = f64::from(e);
    if last < e {
        return None;
    }
    let count = f64::from(spec.count);
    let gen = ((last - e) / count).floor();
    let k = e + gen * count;
    let age = match births {
        Some(b) => t - b.time_of(k),
        None => (n - k) / spec.rate,
    };
    Some((gen as u32, age))
}

/// The last birth the span allows when n(span) particles are emitted by its end: births come
/// strictly within the span, so one due exactly at its end isn't born.
pub fn last_birth(n_span: f64) -> f64 {
    n_span.ceil() - 1.0
}

/// The point at `u` ∈ [0, 1] of a curve resampled evenly, and its unit tangent there.
fn curve_at(curve: &[V3], u: f64) -> (V3, V3) {
    if curve.len() < 2 {
        let p = curve.first().copied().unwrap_or([0.0; 3]);
        return (p, [0.0; 3]);
    }
    let last = (curve.len() - 1) as f64;
    let x = u.clamp(0.0, 1.0) * last;
    let fl = x.floor().min(last - 1.0);
    let f = x - fl;
    let (p0, p1) = (curve[fl as usize], curve[fl as usize + 1]);
    let d = sub(p1, p0);
    let l = len(d);
    let tan = if l > 0.0 { scale(d, 1.0 / l) } else { [0.0; 3] };
    (add(p0, scale(d, f)), tan)
}

/// The launch up a cone about +Y whose cosine runs from 1 to 0.4, at a speed in the range.
fn cone(speed: [f64; 2], h: u32) -> V3 {
    let s = mix(speed[0], speed[1], draw(h, 2));
    let az = TAU * draw(h, 3);
    let cu = 1.0 - 0.6 * draw(h, 4);
    let su = ops::sqrt((1.0 - cu * cu).max(0.0));
    [su * ops::cos(az) * s, cu * s, su * ops::sin(az) * s]
}

/// Particle `e` at t, or none when no particle of the slot is alive then.
pub fn state(b: &Baked, e: u32, t: f64) -> Option<State> {
    state_on(b, e, t, None)
}

/// Particle `e` at t, with a surface it follows as evaluated at t (`now`: its vertices then).
pub fn state_on(b: &Baked, e: u32, t: f64, now: Option<&[V3]>) -> Option<State> {
    if b.planted.hides_at_span_end && t >= b.spec.span {
        return None;
    }
    let birth = birth(b, e, t)?;
    particle(b, e, &birth, Some(birth.age), now)
}

/// The window a surface particle born at `born` takes its point's velocity over: the step about
/// its birth, or (planted) from the last frame the process drew before it; none when there was
/// no such frame.
pub fn window(b: &Baked, born: f64) -> Option<(f64, f64)> {
    let s = b.surface.as_ref()?;
    if b.planted.inherit_previous_frame {
        let last = b
            .drawn
            .iter()
            .copied()
            .filter(|f| *f < born)
            .reduce(f64::max)?;
        Some((last, born))
    } else {
        Some((born - s.half_step, born + s.half_step))
    }
}

/// Where a particle starts and how fast: its birth place, its launch velocity (the motion's own
/// plus what it inherits), and on a surface its triangle and its weights there.
struct Start {
    at: V3,
    v0: V3,
    on: Option<(usize, [f64; 3])>,
}

fn start(b: &Baked, birth: &Birth) -> Start {
    let spec = &b.spec;
    let h = birth.h;
    let own = match &spec.motion {
        Motion::Ballistic { launch, .. } => match launch {
            Launch::Cone(speed) => cone(*speed, h),
            Launch::Vector(v) => *v,
        },
        _ => [0.0; 3],
    };
    match (&spec.shape, &b.surface) {
        (Shape::Surface(_), Some(sf)) => {
            let tri = surface::pick(&sf.cdf, h, b.planted.uniform_triangles);
            let w = surface::weights(draw(h, 5), draw(h, 6));
            let at = sf.point_at(tri, w, birth.born);
            let mut push = scale(sf.normal_at(tri, birth.born), spec.inherit[0]);
            if let Some((from, to)) = window(b, birth.born).filter(|(f, t)| t > f) {
                let v = scale(
                    sub(sf.point_at(tri, w, to), sf.point_at(tri, w, from)),
                    1.0 / (to - from),
                );
                push = add(push, scale(v, spec.inherit[1]));
            }
            Start {
                at,
                v0: add(own, push),
                on: Some((tri, w)),
            }
        }
        _ => Start {
            at: start_point(b, birth),
            v0: add(own, birth.push),
            on: None,
        },
    }
}

/// A particle from its birth: at `age` while it lives, or with `None` where and when it ends
/// (its death, its rest or its life's end), its age then. `now`: the surface it follows, as
/// evaluated at the time read.
pub(crate) fn particle(
    b: &Baked,
    e: u32,
    birth: &Birth,
    age: Option<f64>,
    now: Option<&[V3]>,
) -> Option<State> {
    let spec = &b.spec;
    let Birth {
        generation,
        born: born_at,
        h,
        ..
    } = *birth;
    let life = mix(spec.life[0], spec.life[1], draw(h, 1));
    if age.is_some_and(|a| a >= life) {
        return None;
    }
    let r5 = draw(h, 5);
    let begin = start(b, birth);
    let start = begin.at;
    let mut age = age.unwrap_or(life);
    let (pos, vel, contacts, resting) = match &spec.motion {
        Motion::Ballistic { gravity, drag, .. } => {
            let arc = Arc {
                x0: start,
                v0: begin.v0,
                g: *gravity,
                drag: *drag,
            };
            let ground = b.map.as_ref().map(|g| {
                let then = spec.land.as_ref().map_or(Then::Rest, |l| l.then);
                (g as &dyn Ground, then)
            });
            let (bounce, kill) = (spec.bounce.as_ref(), spec.kill.as_ref());
            if age >= life {
                // Where it ends: its death, its rest, or its life's end.
                let track = solve::track(arc, life, bounce, ground, kill, b.planted);
                match track.end {
                    solve::End::Dies(a, p, v) => {
                        age = a;
                        (p, v, 0, false)
                    }
                    solve::End::Rests(_, p) => (p, [0.0; 3], 0, true),
                    solve::End::Life => {
                        let (s, a) = track.segments[track.segments.len() - 1];
                        (a.at(life - s), a.vel(life - s), 0, false)
                    }
                }
            } else {
                let p = solve::ballistic(arc, age, life, bounce, ground, kill, b.planted)?;
                (p.pos, p.vel, p.contacts, p.resting)
            }
        }
        Motion::Along { speed, .. } => {
            let l = b.curve_len.max(1e-6);
            let s0 = match spec.shape {
                Shape::Along(_) => r5 * b.curve_len,
                _ => 0.0,
            };
            let (p, tan) = curve_at(&b.curve, (s0 + speed * age) / l);
            (p, scale(tan, *speed), 0, false)
        }
        Motion::Orbit { axis, spin } => {
            let al = len(*axis);
            let k = if al > 0.0 {
                scale(*axis, 1.0 / al)
            } else {
                [0.0; 3]
            };
            let rel = sub(start, b.origin);
            let ang = spin * age;
            let (ca, sn) = (ops::cos(ang), ops::sin(ang));
            let rot = add(
                add(scale(rel, ca), scale(cross(k, rel), sn)),
                scale(k, dot(k, rel) * (1.0 - ca)),
            );
            (add(b.origin, rot), scale(cross(k, rot), *spin), 0, false)
        }
        Motion::Drift {
            amplitude,
            frequency,
        } => {
            let w = TAU * frequency;
            let mut p = start;
            let mut v = [0.0; 3];
            for k in 0..3 {
                let x = w * age + TAU * draw(h, 8 + k as u32);
                p[k] += amplitude * ops::sin(x);
                v[k] = amplitude * w * ops::cos(x);
            }
            (p, v, 0, false)
        }
    };
    if spec.kill.is_some_and(|k| !solve::keeps(&k, pos))
        && !matches!(spec.motion, Motion::Ballistic { .. })
    {
        return None;
    }
    // Follow: it keeps its triangle and its place on it, on the surface as evaluated at t, its
    // motion carried from there.
    let (pos, vel) = match (spec.follow, begin.on, &b.surface) {
        (true, Some((tri, w)), Some(sf)) => {
            let t = born_at + age;
            let here = match now {
                Some(v) => sf.point_in(tri, w, v),
                None => sf.point_at(tri, w, t),
            };
            let moving = window(b, t)
                .filter(|(f, to)| to > f)
                .map_or([0.0; 3], |(f, to)| {
                    scale(
                        sub(sf.point_at(tri, w, to), sf.point_at(tri, w, f)),
                        1.0 / (to - f),
                    )
                });
            (add(here, sub(pos, start)), add(vel, moving))
        }
        _ => (pos, vel),
    };
    // Turbulence: the particle's path's offset at its age, times the strength (none at 0).
    let (pos, vel) = match (&b.turbulence, spec.turbulence) {
        (Some(table), Some(tb)) if tb.strength != 0.0 => {
            let p = table.path(h);
            let (off, rate) = table.at_with_rate(p, age);
            (
                add(pos, scale(off, tb.strength)),
                add(vel, scale(rate, tb.strength)),
            )
        }
        _ => (pos, vel),
    };
    Some(State {
        index: e,
        generation,
        born: born_at,
        age,
        life,
        pos,
        vel,
        contacts,
        resting,
    })
}

/// The first `max` births (`death` false) or deaths of an item's particles, in time order: when,
/// where, and the velocity there. Every one is the closed form's, so nothing reads live state.
pub fn fates(b: &Baked, death: bool, max: usize) -> Vec<(f64, V3, V3)> {
    let spec = &b.spec;
    let mut out: Vec<(f64, V3, V3)> = Vec::new();
    let take = |birth: Birth, e: u32, out: &mut Vec<(f64, V3, V3)>| {
        let s = if death {
            particle(b, e, &birth, None, None)
        } else {
            particle(b, e, &birth, Some(0.0), None)
        };
        if let Some(s) = s {
            out.push((s.born + s.age, s.pos, s.vel));
        }
    };
    // Births in time order; a death comes at least its birth's time later, so once a birth comes
    // after the `max`-th death found, no later one dies sooner.
    let enough = |out: &mut Vec<(f64, V3, V3)>, next_birth: f64| -> bool {
        if out.len() < max {
            return false;
        }
        out.sort_by(|a, b| a.0.total_cmp(&b.0));
        out.truncate(max);
        !death || next_birth > out[max - 1].0
    };
    match &b.bursts {
        Some(table) => {
            for (row, r) in table.rows.iter().enumerate() {
                if enough(&mut out, r.t) {
                    break;
                }
                let push = add(
                    scale(r.normal, spec.inherit[0] * r.speed),
                    scale(r.velocity, spec.inherit[1]),
                );
                for j in 0..r.count {
                    let birth = Birth {
                        generation: row as u32,
                        born: r.t,
                        h: hash(&[b.seed, j, row as u32, 0xb0b5]),
                        at: r.point,
                        push,
                        age: 0.0,
                    };
                    take(birth, j, &mut out);
                }
            }
        }
        None if spec.rate > 0.0 && spec.count > 0 => {
            let last = last_birth(spec.rate * spec.span).min(1e7);
            for k in (0..=last.max(0.0) as u64).take_while(|_| last >= 0.0) {
                let born = k as f64 / spec.rate;
                if enough(&mut out, born) {
                    break;
                }
                let (e, generation) = (
                    (k % u64::from(spec.count)) as u32,
                    (k / u64::from(spec.count)) as u32,
                );
                let birth = Birth {
                    generation,
                    born,
                    h: hash(&[b.seed, e, generation]),
                    at: b.origin,
                    push: [0.0; 3],
                    age: 0.0,
                };
                take(birth, e, &mut out);
            }
        }
        None => {}
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out.truncate(max);
    out
}

/// One particle as the closed form solves it, from its birth to its end.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub row: u32,
    pub born: f64,
    pub from: V3,
    pub velocity: V3,
    pub life: f64,
    /// Each contact: when (s of the document), where, and the plane's index (none for the
    /// ground).
    pub hits: Vec<(f64, V3, Option<usize>)>,
    /// Where it rests, and from when.
    pub rest: Option<(f64, V3)>,
    /// When it stops being live.
    pub ends: f64,
}

/// Every particle born by `until` (s), in order of birth, ties by row.
pub fn records(b: &Baked, until: f64) -> Vec<Record> {
    let spec = &b.spec;
    let mut out = Vec::new();
    let mut one = |row: u32, birth: Birth| {
        let h = birth.h;
        let life = mix(spec.life[0], spec.life[1], draw(h, 1));
        let Some(start) = particle(b, row, &birth, Some(0.0), None) else {
            return;
        };
        let mut rec = Record {
            row,
            born: birth.born,
            from: start.pos,
            velocity: start.vel,
            life,
            hits: Vec::new(),
            rest: None,
            ends: birth.born + life,
        };
        if let Motion::Ballistic { gravity, drag, .. } = &spec.motion {
            let begin = self::start(b, &birth);
            let arc = Arc {
                x0: begin.at,
                v0: begin.v0,
                g: *gravity,
                drag: *drag,
            };
            rec.velocity = arc.v0;
            rec.from = arc.x0;
            let ground = b.map.as_ref().map(|g| {
                let then = spec.land.as_ref().map_or(Then::Rest, |l| l.then);
                (g as &dyn Ground, then)
            });
            let track = solve::track(
                arc,
                life,
                spec.bounce.as_ref(),
                ground,
                spec.kill.as_ref(),
                b.planted,
            );
            rec.hits = track
                .hits
                .iter()
                .map(|(a, p, k)| (birth.born + a, *p, *k))
                .collect();
            match track.end {
                solve::End::Dies(a, _, _) => rec.ends = birth.born + a,
                solve::End::Rests(a, p) => rec.rest = Some((birth.born + a, p)),
                solve::End::Life => {}
            }
        }
        if b.planted.hides_at_span_end {
            rec.ends = rec.ends.min(spec.span);
        }
        out.push(rec);
    };
    match &b.bursts {
        Some(table) => {
            for (row_i, r) in table.rows.iter().enumerate().filter(|(_, r)| r.t <= until) {
                let push = add(
                    scale(r.normal, spec.inherit[0] * r.speed),
                    scale(r.velocity, spec.inherit[1]),
                );
                for j in 0..r.count {
                    let g = r.first + u64::from(j);
                    let row = (g % u64::from(spec.count.max(1))) as u32;
                    one(
                        row,
                        Birth {
                            generation: row_i as u32,
                            born: r.t,
                            h: hash(&[b.seed, j, row_i as u32, 0xb0b5]),
                            at: r.point,
                            push,
                            age: 0.0,
                        },
                    );
                }
            }
        }
        None if spec.count > 0 => {
            let (n_end, n_span) = match &b.births {
                Some(bt) => (bt.n(until), bt.n(spec.span)),
                None => (spec.rate * until, spec.rate * spec.span),
            };
            let last = n_end.floor().min(last_birth(n_span)).min(1e7);
            if last < 0.0 {
                return out;
            }
            for k in 0..=last as u64 {
                let born = match &b.births {
                    Some(bt) => bt.time_of(k as f64),
                    None => k as f64 / spec.rate,
                };
                let (row, generation) = (
                    (k % u64::from(spec.count)) as u32,
                    (k / u64::from(spec.count)) as u32,
                );
                one(
                    row,
                    Birth {
                        generation,
                        born,
                        h: hash(&[b.seed, row, generation]),
                        at: b.origin,
                        push: [0.0; 3],
                        age: 0.0,
                    },
                );
            }
        }
        None => {}
    }
    out
}

/// Where a particle is born: its region's point about its birth place.
fn start_point(b: &Baked, birth: &Birth) -> V3 {
    let h = birth.h;
    let d = Draws {
        r5: draw(h, 5),
        r6: draw(h, 6),
        r7: draw(h, 7),
        r12: draw(h, 12),
    };
    let on_curve = match &b.spec.shape {
        Shape::Along(_) => sub(curve_at(&b.curve, d.r5).0, b.origin),
        _ => [0.0; 3],
    };
    add(
        birth.at,
        add(
            regions::offset(&b.spec.shape, b.spec.on_surface, d),
            on_curve,
        ),
    )
}

pub(crate) fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Every slot's columns at t, `count × 8` floats in the draw's layout: a slot with no live
/// particle holds zeros and −1 for its age over its life.
pub fn columns(b: &Baked, t: f64) -> Vec<f64> {
    columns_on(b, t, None)
}

/// [`columns`] with the surface the item follows as evaluated at t.
pub fn columns_on(b: &Baked, t: f64, now: Option<&[V3]>) -> Vec<f64> {
    let n = b.spec.count as usize;
    let mut out = vec![0.0; n * FLOATS];
    for e in 0..n {
        let row = &mut out[e * FLOATS..(e + 1) * FLOATS];
        match state_on(b, e as u32, t, now) {
            Some(s) => {
                row[..3].copy_from_slice(&s.pos);
                row[3] = s.age / s.life;
                row[4..7].copy_from_slice(&s.vel);
            }
            None => row[3] = -1.0,
        }
    }
    out
}
