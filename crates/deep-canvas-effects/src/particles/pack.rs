//! The words the closed-form kernel reads (`deep-effects-render`'s `closed.wgsl`): one uniform
//! block of [`SLOTS`] four-word slots per frame, and one table of words per bake. Floats travel as
//! their f32 bits. The CPU computes each frame's count of births so far in f64 and sends it as a
//! whole number and a fraction, so the kernel finds each slot's generation in integers, as the
//! f64 form does.

use super::eval::Baked;
use super::spec::{KillRegion, Launch, Motion, Shape, Then};
use super::V3;

/// The uniform block's four-word slots.
pub const SLOTS: usize = 32;
/// Words a burst row takes in the table.
pub const BURST_WORDS: usize = 16;
/// A map cell with no mesh, as the kernel reads it.
pub const EMPTY: f32 = -1e30;

/// The planted kernel's switches, the uniform's flags word.
pub const FIRST_ORDER_DRAG: u32 = 1;
pub const HIDES_AT_SPAN_END: u32 = 2;

fn f(x: f64) -> u32 {
    (x as f32).to_bits()
}

/// The table: the curve's points, the bursts, the turbulence paths and the map, and where each
/// starts, in words.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tables {
    pub words: std::sync::Arc<Vec<u32>>,
    pub curve: u32,
    pub bursts: u32,
    pub turbulence: u32,
    pub map: u32,
    pub births: u32,
    pub tris: u32,
    pub cdf: u32,
    pub poses: u32,
}

/// The bake's tables, as words.
pub fn tables(b: &Baked) -> Tables {
    let mut w: Vec<u32> = vec![0; 4];
    let mut out = Tables {
        curve: w.len() as u32,
        ..Tables::default()
    };
    for p in &b.curve {
        w.extend(p.iter().map(|x| f(*x)));
    }
    out.bursts = w.len() as u32;
    for r in b.bursts.iter().flat_map(|t| &t.rows) {
        let mut row = [0u32; BURST_WORDS];
        let vals = [
            r.t,
            r.point[0],
            r.point[1],
            r.point[2],
            r.normal[0],
            r.normal[1],
            r.normal[2],
            r.speed,
            r.velocity[0],
            r.velocity[1],
            r.velocity[2],
        ];
        for (k, v) in vals.iter().enumerate() {
            row[k] = f(*v);
        }
        row[11] = r.count;
        row[12] = r.first.min(u64::from(u32::MAX)) as u32;
        // The window a surface particle of the burst takes its point's velocity over.
        if let Some((from, to)) = super::eval::window(b, r.t) {
            row[13] = f(from);
            row[14] = f(to);
            row[15] = 1;
        }
        w.extend(row);
    }
    out.turbulence = w.len() as u32;
    if let Some(t) = &b.turbulence {
        for o in &t.offsets {
            w.extend(o.iter().map(|x| f(*x)));
        }
    }
    out.map = w.len() as u32;
    if let Some(m) = b.map.as_ref() {
        w.extend(m.heights.iter().map(|h| h.map_or(EMPTY.to_bits(), f)));
    }
    out.births = w.len() as u32;
    for p in b.births.iter().flat_map(|bt| &bt.pieces) {
        w.extend(p.iter().map(|x| f(*x)));
    }
    if let Some(sf) = &b.surface {
        out.tris = w.len() as u32;
        w.extend(sf.tris.iter().flatten());
        out.cdf = w.len() as u32;
        w.extend(&sf.cdf);
        out.poses = w.len() as u32;
        for (t, verts) in &sf.poses {
            w.push(f(*t));
            w.extend(verts.iter().flatten().map(|x| f(*x)));
        }
    }
    out.words = std::sync::Arc::new(w);
    out
}

/// One frame's uniform block at t, `SLOTS × 4` words, with the tables' offsets.
pub fn uniform(b: &Baked, t: f64, tables: &Tables, flags: u32) -> Vec<u32> {
    let s = &b.spec;
    let mut u = vec![0u32; SLOTS * 4];
    let mut put = |slot: usize, words: [u32; 4]| u[slot * 4..slot * 4 + 4].copy_from_slice(&words);
    let v3 = |v: V3, w: u32| [f(v[0]), f(v[1]), f(v[2]), w];
    // Births so far, whole and fraction, and the last birth the span allows.
    let (n, n_span) = match &b.births {
        Some(bt) => (bt.n(t), bt.n(s.span)),
        None => (s.rate * t, s.rate * s.span),
    };
    let n_int = n.floor().clamp(0.0, f64::from(u32::MAX));
    // One past the last birth the span allows (super::eval::last_birth); 0 when none is.
    let m_int = (super::eval::last_birth(n_span) + 1.0).clamp(0.0, f64::from(u32::MAX));
    put(0, [f(t), 0, s.count, b.seed]);
    put(1, v3(b.origin, f(s.rate)));
    let shape = match s.shape {
        Shape::Point => 0,
        Shape::Disk(_) => 1,
        Shape::Sphere(_) => 2,
        Shape::Along(_) => 3,
        Shape::Box(_) => 4,
        Shape::Ring { .. } => 5,
        Shape::Cylinder { .. } => 6,
        Shape::Capsule { .. } => 7,
        Shape::Surface(_) => 8,
    };
    put(2, [f(s.span), f(s.life[0]), f(s.life[1]), shape]);
    let sizes = match s.shape {
        Shape::Disk(r) | Shape::Sphere(r) => [r, 0.0, 0.0],
        Shape::Box(v) => v,
        Shape::Ring { r, inner } => [r, inner, 0.0],
        Shape::Cylinder { r, h } | Shape::Capsule { r, h } => [r, h, 0.0],
        _ => [0.0; 3],
    };
    put(3, v3(sizes, 0));
    let (motion, launch, drag, v0, g) = match &s.motion {
        Motion::Ballistic {
            launch,
            gravity,
            drag,
        } => match launch {
            Launch::Cone(r) => (0, 0, *drag, [r[0], r[1], 0.0], *gravity),
            Launch::Vector(v) => (0, 1, *drag, *v, *gravity),
        },
        Motion::Along { .. } => (1, 0, 0.0, [0.0; 3], [0.0; 3]),
        Motion::Orbit { .. } => (2, 0, 0.0, [0.0; 3], [0.0; 3]),
        Motion::Drift { .. } => (3, 0, 0.0, [0.0; 3], [0.0; 3]),
    };
    put(4, [u32::from(s.on_surface), motion, launch, f(drag)]);
    put(5, v3(v0, 0));
    put(6, v3(g, 0));
    let bounce = s.bounce.clone().unwrap_or_default();
    let planes = if b.planted.two_planes {
        bounce.planes.len().min(2)
    } else {
        bounce.planes.len()
    };
    put(
        7,
        [
            planes as u32,
            u32::from(bounce.max),
            u32::from(bounce.then == Then::Rest),
            f(bounce.restitution),
        ],
    );
    let land = match s.land.as_ref().map(|l| l.then) {
        None => 0,
        Some(Then::Rest) => 1,
        Some(Then::Die) => 2,
        Some(Then::Bounce) => 3,
    };
    let (kill, ka, kb) = match s.kill.map(|k| k.region) {
        None => (0, [0.0; 4], [0.0; 4]),
        Some(KillRegion::Box([lo, hi])) => {
            (1, [lo[0], lo[1], lo[2], 0.0], [hi[0], hi[1], hi[2], 0.0])
        }
        Some(KillRegion::Plane(p)) => (
            2,
            [p.normal[0], p.normal[1], p.normal[2], p.offset],
            [0.0; 4],
        ),
    };
    let keep = u32::from(s.kill.is_none_or(|k| k.keep_inside));
    put(8, [f(bounce.friction), land, kill, keep]);
    for (k, p) in bounce.planes.iter().take(6).enumerate() {
        put(9 + k, v3(p.normal, f(p.offset)));
    }
    put(15, ka.map(f));
    put(16, kb.map(f));
    let (strength, paths, steps, travel) = match (&b.turbulence, s.turbulence) {
        (Some(t), Some(tb)) => (tb.strength, t.paths, t.steps, t.travel),
        _ => (0.0, 0, 0, 1.0),
    };
    put(17, [f(strength), paths, steps, f(travel)]);
    let n_bursts = b.bursts.as_ref().map_or(0, |t| t.rows.len() as u32);
    put(18, [tables.turbulence, tables.bursts, n_bursts, tables.map]);
    let (map4, nx, nz, bottom) = match b.map.as_ref() {
        Some(m) => (
            [m.x0, m.z0, m.cell, m.top],
            m.nx as u32,
            m.nz as u32,
            m.bottom,
        ),
        None => ([0.0; 4], 0, 0, 0.0),
    };
    put(19, map4.map(f));
    put(20, [nx, nz, f(bottom), u32::from(b.bursts.is_some())]);
    put(
        21,
        [f(s.inherit[0]), f(s.inherit[1]), n_int as u32, m_int as u32],
    );
    let (speed, axis, spin, amplitude, frequency) = match &s.motion {
        Motion::Along { speed, .. } => (*speed, [0.0; 3], 0.0, 0.0, 0.0),
        Motion::Orbit { axis, spin } => (0.0, *axis, *spin, 0.0, 0.0),
        Motion::Drift {
            amplitude,
            frequency,
        } => (0.0, [0.0; 3], 0.0, *amplitude, *frequency),
        Motion::Ballistic { .. } => (0.0, [0.0; 3], 0.0, 0.0, 0.0),
    };
    put(22, [f(n - n_int), tables.curve, f(b.curve_len), f(speed)]);
    put(23, v3(axis, f(spin)));
    let flags = flags
        | if b.planted.hides_at_span_end {
            HIDES_AT_SPAN_END
        } else {
            0
        };
    put(
        24,
        [f(amplitude), f(frequency), flags, b.curve.len() as u32],
    );
    let pieces = b.births.as_ref().map_or(0, |bt| bt.pieces.len() as u32);
    put(25, [tables.births, pieces, 0, 0]);
    if let Some(sf) = &b.surface {
        let nv = sf.poses.first().map_or(0, |p| p.1.len()) as u32;
        put(
            26,
            [tables.tris, tables.cdf, sf.tris.len() as u32, tables.poses],
        );
        put(
            27,
            [
                sf.poses.len() as u32,
                nv,
                u32::from(s.follow),
                u32::from(b.planted.uniform_triangles),
            ],
        );
        let planted = u32::from(b.planted.inherit_previous_frame);
        put(28, [f(sf.half_step), planted, 0, 0]);
    }
    u
}
