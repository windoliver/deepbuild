//! Stepped particles (#853; canvas primitives: Particles `particles.stepped@1`): a particle
//! buffer the GPU advances at a fixed rate, lowered here to shipped stepped compute operators
//! (#252), so its checkpoints, seeks, class and timings are any carried state's. The buffer is
//! one carried output, `buffer`, of the operator that takes the item's own ID: 7 f32 words a
//! particle, its position, its velocity and its age in seconds, below 0 while it isn't live.
//!
//! A step is births by index (bursts first, then the emitter's k-th particle at k ÷ rate), forces,
//! and a swept test against the collide world's boxes where the step's own time puts them: a
//! particle a box moved into is set on its nearest face at the speed that took it there, and one
//! that would cross a face stops on it. With `spacing`, grains at rest stand one to a cell of a
//! lattice that wide: each step the columns' heights are read from the grains at rest, a grain in
//! flight lands on the column under it (one a column a step, the lowest index; the rest hover a
//! cell above), and two columns the step's schedule pairs level out, the higher one's top grains
//! taking the lower one's top. Every operator stays within a compute operator's 8 fetches.

use serde_json::{json, Value};

use super::spec::{count_cap, seconds, Refusal, Turbulence};

mod ops;
pub use ops::lower;

/// Words a particle holds in the buffer, and in the rows the particle draw reads.
pub const STRIDE: u32 = 7;
pub const ROW: u32 = 8;
/// At most this many boxes a world gives, bursts an emitter has and readings an item publishes.
pub const MAX_BOXES: usize = 16;
pub const MAX_BURSTS: usize = 16;
pub const MAX_READINGS: usize = 8;
/// At most this many attributes a particle holds, attractors and planes an item names, and
/// occurrences that give births or deaths.
pub const MAX_ATTRIBUTES: usize = 4;
pub const MAX_ATTRACTORS: usize = 4;
pub const MAX_PLANES: usize = 6;
pub const MAX_EVENTS: usize = 16;
/// A turbulence table's paths and offsets a path: 16 segments, an operator's largest array.
const PATHS: u32 = 2;
const OFFSETS: u32 = 9;

/// A box of the collide world: its centre where the world starts, its half extents, and the
/// channel path a kinematic body follows.
#[derive(Clone, Debug, PartialEq)]
pub struct Collider {
    pub centre: [f64; 3],
    pub half: [f64; 3],
    pub follow: Option<String>,
}

/// What the item publishes after each step of the live particles inside a box: their count, or
/// with `centroid` their mean place.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    pub name: String,
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub centroid: bool,
}

impl Reading {
    /// The mean place its four words give: the count, then the sums of the places counted in
    /// steps across the box; the box's middle when it holds no particle.
    pub fn centre(&self, words: &[u32]) -> [f64; 3] {
        std::array::from_fn(|a| {
            let size = self.max[a] - self.min[a];
            match words[0] {
                0 => self.min[a] + size / 2.0,
                n => self.min[a] + f64::from(words[1 + a]) / f64::from(n) / ops::QUANTA * size,
            }
        })
    }
}

/// A half-space particles stay out of: the points p with normal · p < offset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub normal: [f64; 3],
    pub offset: f64,
}

/// An occurrence of a baked list: its time, s, its point, and the particles born at it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Event {
    pub t: f64,
    pub point: [f64; 3],
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub count: u32,
    pub rate: u32,
    pub at: [f64; 3],
    pub size: [f64; 3],
    pub emit_rate: f64,
    pub span: f64,
    /// Each burst's time, s, and count, in the order written.
    pub bursts: Vec<(f64, u32)>,
    pub velocity: [f64; 3],
    pub life: Option<f64>,
    pub gravity: [f64; 3],
    pub drag: f64,
    pub restitution: f64,
    pub world: Option<String>,
    pub spacing: Option<f64>,
    pub every: u32,
    pub budget: u64,
    pub readings: Vec<Reading>,
    /// Each attractor's point and the acceleration toward it, m/s².
    pub attractors: Vec<([f64; 3], f64)>,
    /// Curl-noise drift along the closed form's table (Particles `particles@1`: turbulence).
    pub turbulence: Option<Turbulence>,
    /// Each attribute's name and the range its value is hashed in.
    pub attributes: Vec<(String, [f64; 2])>,
    /// Declared planes, and the collide world's static plane shapes.
    pub planes: Vec<Plane>,
    /// Occurrences that give births (`emit.on`), and that kill within `kill_radius` (`kill.on`).
    pub births: Vec<Event>,
    pub deaths: Vec<Event>,
    pub kill_radius: f64,
}

impl Spec {
    /// Words a particle holds: position, velocity, age and its attributes.
    pub fn stride(&self) -> u32 {
        STRIDE + self.attributes.len() as u32
    }
}

/// The wrong programs of #853, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The particles advance once a frame drawn, by that frame's time since the last.
    pub by_frame_time: bool,
    /// A particle is tested against the boxes only where its step ends.
    pub collide_at_end: bool,
}

/// The names the buffer, the counts and the draw's rows go by: `<item>.buffer` and the rest.
pub const BUFFER: &str = "buffer";
pub const COUNTS: &str = "counts";
pub const ROWS: &str = "rows";
pub fn readings_op(id: &str) -> String {
    format!("{id}.readings")
}
pub fn rows_op(id: &str) -> String {
    format!("{id}-rows")
}

/// Every particles.stepped@1 item of `doc`, by ID.
pub fn items(doc: &Value) -> Vec<(&String, &Value)> {
    (doc["items"].as_object().into_iter().flatten())
        .filter(|(_, v)| v["kind"] == "particles.stepped@1")
        .collect()
}

fn vec3(v: &Value, or: [f64; 3]) -> Option<[f64; 3]> {
    match v {
        Value::Null => Some(or),
        Value::Array(a) if a.len() == 3 => {
            let x: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
            (x.len() == 3 && x.iter().all(|n| n.is_finite())).then(|| [x[0], x[1], x[2]])
        }
        _ => None,
    }
}

/// Reads item `id`'s fields, refusing each one out of its range, naming it.
pub fn read(doc: &Value, id: &str, item: &Value) -> Result<Spec, Refusal> {
    let p = &item["params"];
    let at = |f: &str| format!("items/{id}/params/{f}");
    let bad = |f: &str, what: String, actual: &Value| {
        Refusal::new("out_of_range", at(f), format!("{id}: {what}")).with(actual.clone())
    };
    let num = |f: &str, or: f64, lo: f64, hi: f64| -> Result<f64, Refusal> {
        let v = p.pointer(&format!("/{f}")).unwrap_or(&Value::Null);
        match v.as_f64().or(v.is_null().then_some(or)) {
            Some(x) if x.is_finite() && x >= lo && x <= hi => Ok(x),
            _ => Err(bad(f, format!("{f} is a number from {lo} to {hi}"), v)),
        }
    };
    let v3 = |f: &str, or: [f64; 3]| -> Result<[f64; 3], Refusal> {
        let v = p.pointer(&format!("/{f}")).unwrap_or(&Value::Null);
        vec3(v, or).ok_or_else(|| bad(f, format!("{f} is three numbers"), v))
    };
    let class = super::rule::class_of(doc);
    let cap = count_cap(class);
    let count = num("count", 256.0, 1.0, f64::from(u32::MAX))? as u32;
    if count > cap {
        let what = format!(
            "{id}: count {count} is past the {class} class's cap of {cap} particles an item"
        );
        return Err(Refusal::new("out_of_range", at("count"), what)
            .with(json!({"count": count, "cap": cap, "class": class})));
    }
    // The valid-rates rule (Time and the flick): a step is a whole number of flicks.
    let rate = num("step_rate", 60.0, 1.0, 1000.0)?;
    if rate.fract() != 0.0 || 705_600_000 % (rate as u64) != 0 {
        let what = format!("{id}: a step at {rate} Hz is no whole number of flicks");
        return Err(Refusal::new("bad_rate", at("step_rate"), what).with(json!(rate)));
    }
    let size = match &p["emit"]["shape"] {
        Value::Null => [0.0; 3],
        s => vec3(&s["box"]["size"], [0.0; 3])
            .filter(|_| s["box"].is_object())
            .ok_or_else(|| {
                bad(
                    "emit/shape",
                    "emit.shape is {box: {size: [x, y, z]}}".into(),
                    s,
                )
            })?,
    };
    let mut bursts = Vec::new();
    let listed = p["emit"]["bursts"].as_array().cloned().unwrap_or_default();
    if listed.len() > MAX_BURSTS {
        let what = format!("at most {MAX_BURSTS} bursts");
        return Err(bad("emit/bursts", what, &json!(listed.len())));
    }
    for (j, b) in listed.iter().enumerate() {
        let f = format!("emit/bursts/{j}");
        let t = match &b["t"] {
            Value::String(s) => seconds(doc, s).ok(),
            v => v.as_f64(),
        };
        match (t.filter(|t| *t >= 0.0), b["count"].as_u64()) {
            (Some(t), Some(n)) if n <= u64::from(count) => bursts.push((t, n as u32)),
            _ => return Err(bad(&f, "a burst is {t, count}".into(), b)),
        }
    }
    let spacing = match &p["spacing"] {
        Value::Null => None,
        _ => Some(num("spacing", 0.0, 1e-4, 1e3)?),
    };
    let mut readings = Vec::new();
    for (name, r) in p["readings"].as_object().into_iter().flatten() {
        let f = format!("readings/{name}");
        let centroid = r["centroid"].is_object();
        let b = &r[if centroid { "centroid" } else { "count" }]["box"];
        match (vec3(&b[0], [0.0; 3]), vec3(&b[1], [0.0; 3])) {
            (Some(min), Some(max)) if b[0].is_array() && b[1].is_array() => {
                readings.push(Reading {
                    name: name.clone(),
                    min,
                    max,
                    centroid,
                });
            }
            _ => {
                let what = "a reading is {count: {box: [min, max]}} or {centroid: {box}}";
                return Err(bad(&f, what.into(), r));
            }
        }
    }
    // The lists a field names, each at most as long as an operator's arrays.
    let few = |f: &str, n: usize, max: usize| match n > max {
        true => Err(bad(f, format!("at most {max}"), &json!(n))),
        false => Ok(()),
    };
    let mut attractors = Vec::new();
    for (j, a) in (p["forces"]["attractors"].as_array().into_iter().flatten()).enumerate() {
        match (vec3(&a["at"], [0.0; 3]), a["strength"].as_f64()) {
            (Some(at), Some(k)) if a["at"].is_array() && k.is_finite() => attractors.push((at, k)),
            _ => {
                let f = format!("forces/attractors/{j}");
                return Err(bad(&f, "an attractor is {at, strength}".into(), a));
            }
        }
    }
    few("forces/attractors", attractors.len(), MAX_ATTRACTORS)?;
    let mut attributes = Vec::new();
    for (name, v) in p["attributes"].as_object().into_iter().flatten() {
        let range = match (v.as_f64(), v[0].as_f64(), v[1].as_f64()) {
            (Some(x), _, _) => [x, x],
            (None, Some(lo), Some(hi)) if lo <= hi => [lo, hi],
            _ => {
                let f = format!("attributes/{name}");
                return Err(bad(&f, "an attribute is a number or [min, max]".into(), v));
            }
        };
        attributes.push((name.clone(), range));
    }
    few("attributes", attributes.len(), MAX_ATTRIBUTES)?;
    let mut planes = Vec::new();
    for (j, pl) in (p["collide"]["planes"].as_array().into_iter().flatten()).enumerate() {
        let n = vec3(&pl["normal"], [0.0; 3]).filter(|n| n.iter().any(|x| *x != 0.0));
        match (
            n,
            pl["offset"]
                .as_f64()
                .or(pl["offset"].is_null().then_some(0.0)),
        ) {
            (Some(n), Some(offset)) => {
                let len = deep_canvas::ops::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
                planes.push(Plane {
                    normal: n.map(|x| x / len),
                    offset: offset / len,
                });
            }
            _ => {
                let f = format!("collide/planes/{j}");
                return Err(bad(&f, "a plane is {normal, offset}".into(), pl));
            }
        }
    }
    few("collide/planes", planes.len(), MAX_PLANES)?;
    // Births and deaths at the rows of a baked occurrence list.
    let events = |f: &str, on: &Value| -> Result<Vec<Event>, Refusal> {
        if on.is_null() {
            return Ok(Vec::new());
        }
        // The list's reader names `emit.on`'s fields: a refusal names the field read here.
        let rows = super::bursts::from_list(id, on, doc).map_err(|mut r| {
            r.path = r.path.replace("emit/on", f);
            r
        })?;
        few(f, rows.len(), MAX_EVENTS)?;
        let of = |e: &super::bursts::Event| Event {
            t: e.t,
            point: e.point,
            count: e.count,
        };
        Ok(rows.iter().map(of).collect())
    };
    let births = events("emit/on", &p["emit"]["on"])?;
    // Stated bursts and occurrences' births share one list of timed births.
    few("emit/on", bursts.len() + births.len(), MAX_EVENTS)?;
    let deaths = events("kill/on", &p["kill"]["on"])?;
    let turbulence = match &p["forces"]["turbulence"] {
        Value::Null => None,
        t => Some(Turbulence {
            strength: num("forces/turbulence/strength", 0.5, 0.0, 1e3)?,
            frequency: num("forces/turbulence/frequency", 1.0, 1e-6, 1e6)?,
            paths: PATHS,
            steps: OFFSETS,
            travel: num("forces/turbulence/travel", 4.0, 1e-3, 1e6)?,
            seed: t["seed"].as_u64().map(|s| s as u32),
        }),
    };
    if readings.len() > MAX_READINGS {
        let what = format!("at most {MAX_READINGS} readings");
        return Err(bad("readings", what, &json!(readings.len())));
    }
    Ok(Spec {
        count,
        rate: rate as u32,
        at: vec3(&item["at"]["pos"], [0.0; 3]).unwrap_or([0.0; 3]),
        size,
        emit_rate: num("emit/rate", 0.0, 0.0, 1e9)?,
        span: num("emit/span", 0.0, 0.0, 1e9)?,
        bursts,
        velocity: v3("emit/velocity", [0.0; 3])?,
        life: match &p["life"] {
            Value::Null => None,
            _ => Some(num("life", 1.0, 1e-3, 1e9)?),
        },
        gravity: v3("forces/gravity", [0.0, -9.81, 0.0])?,
        drag: num("forces/drag", 0.0, 0.0, 1e3)?,
        restitution: num("collide/restitution", 0.0, 0.0, 1.0)?,
        world: p["collide"]["world"].as_str().map(str::to_string),
        spacing,
        every: num("checkpoint/every", 60.0, 1.0, 1e9)? as u32,
        budget: num("checkpoint/budget", 16_777_216.0, 0.0, 1e15)? as u64,
        readings,
        attractors,
        turbulence,
        attributes,
        planes,
        births,
        deaths,
        kill_radius: num("kill/radius", 0.1, 0.0, 1e6)?,
    })
}

/// The lattice a spacing lays over the boxes and the emit box: its low corner, its cell and its
/// columns across x and z.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lattice {
    pub lo: [f64; 3],
    pub d: f64,
    pub g: [u32; 2],
}

pub fn lattice(s: &Spec, boxes: &[Collider]) -> Option<Lattice> {
    let d = s.spacing?;
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let half: [f64; 3] = std::array::from_fn(|a| s.size[a] / 2.0);
    for (c, h) in boxes
        .iter()
        .map(|b| (&b.centre, &b.half))
        .chain([(&s.at, &half)])
    {
        for a in 0..3 {
            lo[a] = lo[a].min(c[a] - h[a]);
            hi[a] = hi[a].max(c[a] + h[a]);
        }
    }
    // A plane that faces up is ground: the lattice starts no higher than it.
    for p in s.planes.iter().filter(|p| p.normal[1] > 0.999) {
        lo[1] = lo[1].min(p.offset - d);
    }
    let g = [0, 2].map(|a| (((hi[a] - lo[a]) / d).ceil() as u32).max(1));
    Some(Lattice { lo, d, g })
}

/// The refusals that read the item with its world's solids: too many boxes or planes, or a
/// lattice of more columns than one dispatch runs.
pub fn fits(id: &str, s: &Spec, boxes: &[Collider]) -> Option<Refusal> {
    if boxes.len() > MAX_BOXES {
        let what = format!(
            "{id}: its world holds {} boxes, past the {MAX_BOXES} a step tests",
            boxes.len()
        );
        return Some(
            Refusal::new(
                "out_of_range",
                format!("items/{id}/params/collide/world"),
                what,
            )
            .with(json!(boxes.len())),
        );
    }
    // Declared planes and the world's static plane shapes together.
    if s.planes.len() > MAX_PLANES {
        let what = format!(
            "{id}: {} planes with its world's, past the {MAX_PLANES} a step tests",
            s.planes.len()
        );
        let path = format!("items/{id}/params/collide/planes");
        return Some(Refusal::new("out_of_range", path, what).with(json!(s.planes.len())));
    }
    let l = lattice(s, boxes)?;
    let columns = u64::from(l.g[0]) * u64::from(l.g[1]);
    (columns > 1_048_576).then(|| {
        let what = format!(
            "{id}: a spacing of {} m lays {columns} columns over its world, past 1,048,576",
            l.d
        );
        Refusal::new("out_of_range", format!("items/{id}/params/spacing"), what)
            .with(json!(columns))
    })
}

/// The item's seed: the hash of the document's seed and its ID, as an operator item's is.
pub fn seed_of(doc_seed: u64, id: &str) -> u32 {
    use crate::interp::hash1;
    let mut h = hash1(doc_seed as u32) ^ hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
    for b in id.bytes() {
        h = hash1(h ^ u32::from(b));
    }
    h
}

#[cfg(test)]
mod tests;
