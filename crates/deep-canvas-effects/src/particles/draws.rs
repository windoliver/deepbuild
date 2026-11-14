//! #450: a particles item's ribbon and mesh draws (canvas primitives: Particles `particles@1`:
//! trails and mesh draws), in the same f64 closed form as its places.
//!
//! A ribbon evaluates the same particle at earlier ages, back along its `length` in `segments`
//! equal steps and never before its birth, so a trail needs no history and a scrub draws it
//! exactly. A mesh draw places one of its prototypes at each live particle, turned by a tumble
//! about a hashed axis, along its velocity, or not at all, and scaled by its channel over life.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::ops::{self, TAU};
use serde_json::Value;

use super::eval::{self, draw, Baked};
use super::spec::Refusal;
use super::{len, scale, V3};

/// The most segments a ribbon takes, and the most prototypes a mesh draw names.
pub const MAX_SEGMENTS: u64 = 16;
pub const MAX_PROTOTYPES: usize = 8;

/// `draw: ribbon {segments, length, width, taper, fade}`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ribbon {
    pub segments: u32,
    /// How far back it reaches, s of the particle's age.
    pub length: f64,
    /// Its width at the particle, px.
    pub width: f64,
    pub taper: f64,
    pub fade: f64,
}

/// How a mesh particle turns.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Orient {
    Tumble([f64; 2]),
    Velocity,
    Fixed,
}

/// `draw: mesh {of, pick, orient, tumble, scale}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Mesh {
    pub of: Vec<String>,
    /// Prototypes by the particle's slot in turn, rather than by its hash.
    pub by_index: bool,
    pub orient: Orient,
    /// Its scale at birth and at death.
    pub scale: [f64; 2],
}

/// The item's draw, when it is a ribbon or a mesh; any other draw is the shipped graph's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Draws {
    pub ribbon: Option<Ribbon>,
    pub mesh: Option<Mesh>,
}

/// Item `id`'s `draw` read and checked, or the first refusal, naming the field.
pub fn read(id: &str, p: &Value) -> Result<Draws, Refusal> {
    let d = &p["draw"];
    let at = |f: &str| format!("items/{id}/params/draw/{f}");
    let bad = |f: &str, what: &str| Refusal::new("out_of_range", at(f), format!("{id}: {what}"));
    let num = |v: &Value, f: &str, default: f64| match v {
        Value::Null => Ok(default),
        v => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= 0.0)
            .ok_or_else(|| bad(f, &format!("{f} must be 0 or more"))),
    };
    let pair = |v: &Value, f: &str, default: [f64; 2]| match v {
        Value::Array(a) if a.len() == 2 => Ok([num(&a[0], f, 0.0)?, num(&a[1], f, 0.0)?]),
        v => num(v, f, default[0]).map(|x| if v.is_null() { default } else { [x, x] }),
    };
    if let Some(r) = d.get("ribbon") {
        let segments = match &r["segments"] {
            Value::Null => 8,
            v => v
                .as_u64()
                .filter(|n| (1..=MAX_SEGMENTS).contains(n))
                .ok_or_else(|| bad("ribbon/segments", "a ribbon takes 1 to 16 segments"))?,
        } as u32;
        let length = num(&r["length"], "ribbon/length", 0.2)?;
        if length <= 0.0 {
            return Err(bad("ribbon/length", "a ribbon's length is above 0 s"));
        }
        return Ok(Draws {
            ribbon: Some(Ribbon {
                segments,
                length,
                width: num(&r["width"], "ribbon/width", 2.0)?,
                taper: num(&r["taper"], "ribbon/taper", 1.0)?,
                fade: num(&r["fade"], "ribbon/fade", 1.0)?,
            }),
            mesh: None,
        });
    }
    let Some(m) = d.get("mesh") else {
        return Ok(Draws::default());
    };
    let of: Vec<String> = m["of"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(String::from)
        .collect();
    if of.is_empty()
        || of.len() > MAX_PROTOTYPES
        || m["of"].as_array().is_some_and(|a| a.len() != of.len())
    {
        return Err(bad("mesh/of", "a mesh draw names 1 to 8 prototype items"));
    }
    let by_index = match m["pick"].as_str() {
        None | Some("hash") => false,
        Some("index") => true,
        Some(_) => return Err(bad("mesh/pick", "pick is hash or index")),
    };
    let orient = match m["orient"].as_str() {
        None | Some("tumble") => Orient::Tumble(pair(
            &m["tumble"]["rate"],
            "mesh/tumble/rate",
            [90.0, 360.0],
        )?),
        Some("velocity") => Orient::Velocity,
        Some("fixed") => Orient::Fixed,
        Some(_) => return Err(bad("mesh/orient", "orient is velocity, tumble or fixed")),
    };
    Ok(Draws {
        ribbon: None,
        mesh: Some(Mesh {
            of,
            by_index,
            orient,
            scale: pair(&m["scale"], "mesh/scale", [1.0, 1.0])?,
        }),
    })
}

/// The ribbon behind slot `e`'s particle at `t` flicks: point j, j = 0 to segments, is the slot's
/// closed-form place at t − j × step, the step ⌊length ÷ segments⌋ in whole flicks, as
/// [`eval::state_on`] gives it at that time, or its birth point where that time falls before its
/// birth; none when no particle of the slot is alive at t.
pub fn ribbon(b: &Baked, r: &Ribbon, e: u32, t: i64, now: Option<&[V3]>) -> Option<Vec<V3>> {
    let secs = |t: i64| t as f64 / FLICKS_PER_SECOND as f64;
    eval::state_on(b, e, secs(t), now)?;
    let head = eval::birth(b, e, secs(t))?;
    let step = (r.length * FLICKS_PER_SECOND as f64 / f64::from(r.segments)).floor() as i64;
    (0..=r.segments)
        .map(|j| {
            let at = eval::birth(b, e, secs(t - i64::from(j) * step));
            match at.filter(|bj| bj.generation == head.generation) {
                Some(bj) => eval::particle(b, e, &bj, Some(bj.age), now),
                None => eval::particle(b, e, &head, Some(0.0), now),
            }
            .map(|s| s.pos)
        })
        .collect()
}

/// One mesh particle at t: its prototype's index in `of`, its place, its rotation as a unit
/// quaternion [x, y, z, w] and its scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Instance {
    pub proto: usize,
    pub pos: V3,
    pub rot: [f64; 4],
    pub scale: f64,
}

/// The quaternion turning +Z onto unit `d`.
fn onto(d: V3) -> [f64; 4] {
    let c = d[2];
    if c < -1.0 + 1e-12 {
        return [0.0, 1.0, 0.0, 0.0];
    }
    // The half-way rotation: axis +Z × d, w = 1 + cos, normalised.
    let q = [-d[1], d[0], 0.0, 1.0 + c];
    let n = ops::sqrt(q.iter().map(|x| x * x).sum());
    q.map(|x| x / n)
}

/// Slot `e`'s mesh particle at t, or none when no particle of the slot is alive then.
pub fn instance(b: &Baked, m: &Mesh, e: u32, t: f64, now: Option<&[V3]>) -> Option<Instance> {
    let s = eval::state_on(b, e, t, now)?;
    let h = eval::birth(b, e, t)?.h;
    let proto = if m.by_index {
        e as usize % m.of.len()
    } else {
        ((draw(h, 30) * m.of.len() as f64) as usize).min(m.of.len() - 1)
    };
    let rot = match m.orient {
        Orient::Fixed => [0.0, 0.0, 0.0, 1.0],
        Orient::Velocity => match len(s.vel) {
            l if l > 0.0 => onto(scale(s.vel, 1.0 / l)),
            _ => [0.0, 0.0, 0.0, 1.0],
        },
        Orient::Tumble(rate) => {
            // A hashed axis uniform on the sphere, a hashed rate in the range and phase.
            let z = 2.0 * draw(h, 31) - 1.0;
            let az = TAU * draw(h, 32);
            let r = ops::sqrt((1.0 - z * z).max(0.0));
            let axis = [r * ops::cos(az), r * ops::sin(az), z];
            let deg = rate[0] + (rate[1] - rate[0]) * draw(h, 33);
            let half = 0.5 * (deg.to_radians() * s.age + TAU * draw(h, 34));
            let k = ops::sin(half);
            [axis[0] * k, axis[1] * k, axis[2] * k, ops::cos(half)]
        }
    };
    let life = (s.age / s.life).clamp(0.0, 1.0);
    Some(Instance {
        proto,
        pos: s.pos,
        rot,
        scale: m.scale[0] + (m.scale[1] - m.scale[0]) * life,
    })
}
