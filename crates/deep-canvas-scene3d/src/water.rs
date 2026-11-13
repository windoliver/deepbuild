//! Material: water (#166): a material's `water` on a plate's part. Waves are up to four
//! trochoidal waves in closed form of rest position and t; ripples are seeded noise drifting with
//! the wind; rain rings sit at places and times hashed from the seed, each a closed form of its
//! age; foam whitens where the waves' steepness passes a threshold; a wake follows a named item
//! along the path it took over the last `span` s, read from its positions at whole multiples of the
//! frame interval. Under its own mirror the water shows the bed behind it, tinted by depth.
//!
//! Everything here is a pure function of the document and t, so seeking equals playing; nothing
//! is simulated, integrated or read from an earlier frame.

use std::collections::BTreeSet;

use deep_canvas::ops;
use serde_json::Value;

use crate::scene::{Layer3, Refused};

/// The most waves one water sums.
pub const MAX_WAVES: usize = 4;
/// Gravity, m/s², for deep water's dispersion ω² = g k.
pub const G: f64 = 9.81;

/// One trochoidal wave: its unit direction in the water's plane (x, z), its length, amplitude
/// and steepness (the horizontal share of the amplitude).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wave {
    pub dir: [f64; 2],
    pub length: f64,
    pub amplitude: f64,
    pub steepness: f64,
}

impl Wave {
    pub fn k(&self) -> f64 {
        std::f64::consts::TAU / self.length
    }

    /// Its angular frequency by deep water's dispersion.
    pub fn omega(&self) -> f64 {
        ops::sqrt(G * self.k())
    }

    /// Its phase at rest point `x` and `t` s.
    pub fn phase(&self, x: [f64; 2], t: f64) -> f64 {
        self.k() * (self.dir[0] * x[0] + self.dir[1] * x[1]) - self.omega() * t
    }
}

/// A wake: the item it follows, its span and the path the item took, newest first, each point
/// the item's position in the water's plane at t − k × the frame interval.
#[derive(Clone, Debug, PartialEq)]
pub struct Wake {
    pub item: String,
    pub span: f64,
    pub path: Vec<[f64; 2]>,
    /// The document's frame interval in s, the path's spacing.
    pub step: f64,
}

/// A view's water (at most one per view, like its mirror).
#[derive(Clone, Debug, PartialEq)]
pub struct Water {
    /// The `material@1` item whose `water` it is.
    pub material: String,
    /// The solids whose material it is, by ID.
    pub parts: BTreeSet<String>,
    /// Each part's extent at rest in world x and z: (part, [min x, min z, max x, max z]).
    pub plates: Vec<(String, [f64; 4])>,
    pub waves: Vec<Wave>,
    /// Ripples: their scale in m and strength 0..1, and the wind they drift with in m/s (x, z).
    pub ripple_scale: f64,
    pub ripple_strength: f64,
    pub drift: [f64; 2],
    /// Rain drops per m² per s.
    pub rain: f64,
    /// The absorption color, linear, and its depth in m.
    pub absorption: [f64; 3],
    pub depth: f64,
    /// How far the mirror's lookup moves along the bent normal, in frame px.
    pub distort: f64,
    /// Foam's steepness threshold; 1 is off.
    pub foam: f64,
    pub wake: Option<Wake>,
    /// Its shore (#268), with the field baked at check, or none.
    pub shore: Option<crate::shore::Shore>,
    /// The water's plane at rest: its first part's world y.
    pub level: f64,
    /// The document's seed, which ripples and rain hash from.
    pub seed: u32,
    /// t in s.
    pub t: f64,
}

fn bad(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

impl Water {
    /// The rain's grid: each cell of side `cell` m holds one drop a slot of `slot` s, so drops
    /// fall at `rain` per m² per s; and how many slots back a ring still lives. A cell holds about
    /// one ring at a time and is never narrower than a ring's width, so the 2 × 2 cells nearest a
    /// point hold every ring that reaches it.
    pub fn rain_grid(&self) -> (f64, f64, u32) {
        if self.rain <= 0.0 {
            return (1.0, 1.0, 0);
        }
        let cell = (1.0 / ops::sqrt(self.rain * RING_LIFE)).max(2.0 * RING_SPEED * RING_LIFE);
        let slot = 1.0 / (self.rain * cell * cell);
        (cell, slot, (RING_LIFE / slot - 1e-9).ceil() as u32)
    }
}

/// The wind table: four waves from a wind of `speed` m/s toward `direction`, by the
/// Pierson–Moskowitz peak (ω_p = 0.877 g ÷ U, so the peak length is 2π U² ÷ (0.877² g)) and its
/// significant height (0.21 U² ÷ g), split over four waves fanned about the wind.
const WIND: [(f64, f64, f64, f64); 4] = [
    // (turn from the wind in deg, length ÷ the peak's, share of the height, steepness)
    (0.0, 1.0, 0.5, 0.5),
    (25.0, 0.62, 0.25, 0.45),
    (-35.0, 0.41, 0.15, 0.4),
    (60.0, 0.27, 0.1, 0.35),
];

/// A heading in deg as a unit vector in the water's plane (x, z): (sin d, cos d), so 0° runs
/// along +z and 90° along +x.
pub fn heading(deg: f64) -> [f64; 2] {
    let r = deg.to_radians();
    [ops::sin(r), ops::cos(r)]
}

/// The four waves a wind of `speed` m/s toward `direction` deg picks.
pub fn wind(speed: f64, direction: f64) -> Vec<Wave> {
    if speed <= 0.0 {
        return Vec::new();
    }
    let peak = std::f64::consts::TAU * speed * speed / (0.877 * 0.877 * G);
    // Half the significant height, the amplitude the four share.
    let height = 0.5 * 0.21 * speed * speed / G;
    WIND.iter()
        .map(|&(turn, length, share, steepness)| Wave {
            dir: heading(direction + turn),
            length: peak * length,
            amplitude: height * share,
            steepness,
        })
        .collect()
}

/// Reads a material's `water`, at `items/<material>/params/water`. `t` in s, `seed` the
/// document's.
pub fn parse(material: &str, spec: &Value, seed: u32, t: f64) -> Result<Water, Refused> {
    let at = |k: &str| format!("items/{material}/params/water/{k}");
    let num = |v: Option<&Value>, k: &str, default: f64, range: [f64; 2]| -> Result<f64, Refused> {
        match v {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
                .ok_or_else(|| bad("out_of_range", at(k))),
        }
    };
    let (waves, drift) = match spec.get("waves") {
        Some(Value::Array(list)) => {
            if list.len() > MAX_WAVES {
                return Err(bad("out_of_range", at("waves")));
            }
            let mut waves = Vec::new();
            for (i, w) in list.iter().enumerate() {
                let k = |f: &str| format!("waves/{i}/{f}");
                let field = |f: &str| w.get(f);
                let direction = num(field("direction"), &k("direction"), 0.0, [-3600.0, 3600.0])?;
                let length = num(field("length"), &k("length"), f64::NAN, [1e-3, 1e4])?;
                let amplitude = num(field("amplitude"), &k("amplitude"), f64::NAN, [0.0, 1e3])?;
                let steepness = num(field("steepness"), &k("steepness"), 0.0, [0.0, 1.0])?;
                if length.is_nan() || amplitude.is_nan() {
                    return Err(bad(
                        "bad_input",
                        at(&k(if length.is_nan() {
                            "length"
                        } else {
                            "amplitude"
                        })),
                    ));
                }
                waves.push(Wave {
                    dir: heading(direction),
                    length,
                    amplitude,
                    steepness,
                });
            }
            // Ripples drift along the waves' mean direction at the first wave's phase speed.
            let drift = waves.first().map_or([0.0; 2], |w| {
                let c = w.omega() / w.k();
                [w.dir[0] * c, w.dir[1] * c]
            });
            (waves, drift)
        }
        None | Some(Value::Null) => wind_of(None, &at)?,
        Some(w @ Value::Object(_)) => wind_of(w.get("wind").or(Some(w)), &at)?,
        Some(_) => return Err(bad("out_of_range", at("waves"))),
    };
    let ripples = spec.get("ripples");
    let ripple_scale = num(
        ripples.and_then(|r| r.get("scale")),
        "ripples/scale",
        0.5,
        [1e-3, 1e3],
    )?;
    let ripple_strength = num(
        ripples.and_then(|r| r.get("strength")),
        "ripples/strength",
        0.3,
        [0.0, 1.0],
    )?;
    let rain = num(spec.get("rain"), "rain", 0.0, [0.0, 1e4])?;
    let absorption = spec.get("absorption");
    let color = match absorption.and_then(|a| a.get("color")) {
        None | Some(Value::Null) => [0.12, 0.42, 0.40],
        Some(c) => c
            .as_array()
            .filter(|c| c.len() == 3)
            .and_then(|c| {
                let v: Vec<f64> = c.iter().filter_map(Value::as_f64).collect();
                (v.len() == 3 && v.iter().all(|x| x.is_finite() && *x >= 0.0))
                    .then(|| [v[0], v[1], v[2]])
            })
            .ok_or_else(|| bad("out_of_range", at("absorption/color")))?,
    };
    let depth = num(
        absorption.and_then(|a| a.get("depth")),
        "absorption/depth",
        3.0,
        [1e-3, 1e5],
    )?;
    let distort = num(spec.get("distort"), "distort", 16.0, [0.0, 256.0])?;
    let foam = num(
        spec.get("foam").and_then(|f| f.get("threshold")),
        "foam/threshold",
        1.0,
        [0.0, 1.0],
    )?;
    let wake = match spec.get("wake") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(w) => {
            let item = w
                .get("item")
                .and_then(Value::as_str)
                .ok_or_else(|| bad("bad_input", at("wake/item")))?;
            let span = num(w.get("span"), "wake/span", 8.0, [1e-3, 60.0])?;
            Some(Wake {
                item: item.to_string(),
                span,
                path: Vec::new(),
                step: 1.0 / 60.0,
            })
        }
    };
    Ok(Water {
        material: material.to_string(),
        parts: BTreeSet::new(),
        plates: Vec::new(),
        waves,
        ripple_scale,
        ripple_strength,
        drift,
        rain,
        absorption: color,
        depth,
        distort,
        foam,
        wake,
        shore: crate::shore::parse(material, spec.get("shore"))?,
        level: 0.0,
        seed,
        t,
    })
}

/// `waves: wind {speed, direction}` (or absent: the default 3 m/s breeze along +x).
fn wind_of(
    w: Option<&Value>,
    at: &dyn Fn(&str) -> String,
) -> Result<(Vec<Wave>, [f64; 2]), Refused> {
    let get = |k: &str, default: f64, range: [f64; 2]| match w.and_then(|w| w.get(k)) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
            .ok_or_else(|| bad("out_of_range", at(&format!("waves/{k}")))),
    };
    let speed = get("speed", 3.0, [0.0, 60.0])?;
    let direction = get("direction", 0.0, [-3600.0, 3600.0])?;
    let d = heading(direction);
    Ok((wind(speed, direction), [d[0] * speed, d[1] * speed]))
}

/// The view's water, from the materials its solids name: the first in item order, its parts the
/// solids whose material it is. `None` when no drawn solid's material carries one.
pub fn find<'a>(
    layers: &[Layer3],
    get: impl Fn(&str) -> Option<&'a Value>,
    seed: u32,
    t: f64,
) -> Result<Option<Water>, Refused> {
    let mut found: Option<Water> = None;
    for s in layers.iter().flat_map(|l| &l.solids) {
        let owner = s.id.split_once('#').map_or(s.id.as_str(), |(o, _)| o);
        let Some(name) = get(owner)
            .and_then(|i| i.get("material"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Some(spec) = get(name)
            .and_then(|m| m.pointer("/params/water"))
            .filter(|w| w.is_object())
        else {
            continue;
        };
        let first = found.is_none();
        if first {
            found = Some(parse(name, spec, seed, t)?);
        }
        if let Some(w) = found.as_mut().filter(|w| w.material == name) {
            w.parts.insert(s.id.clone());
            let corners = crate::scene::corners_of(s);
            if first {
                w.level = corners.iter().map(|c| c[1]).sum::<f64>() / corners.len().max(1) as f64;
            }
            let (xs, zs) = (corners.iter().map(|c| c[0]), corners.iter().map(|c| c[2]));
            w.plates.push((
                s.id.clone(),
                [
                    xs.clone().fold(f64::INFINITY, f64::min),
                    zs.clone().fold(f64::INFINITY, f64::min),
                    xs.fold(f64::NEG_INFINITY, f64::max),
                    zs.fold(f64::NEG_INFINITY, f64::max),
                ],
            ));
        }
    }
    Ok(found)
}

/// The most points a wake's path holds: 60 s at 60 fps is past any span; the frame interval and
/// span keep it far below.
pub const MAX_WAKE: usize = 1024;

/// The times a wake reads its item at, newest first, in flicks: t, then every whole multiple of
/// the frame interval `step` at or before t back to t − `span` s.
pub fn wake_times(t: i64, step: i64, span: f64) -> Vec<i64> {
    let step = step.max(1);
    let back = (span * deep_canvas::camera::FLICKS_PER_SECOND as f64).round() as i64;
    let mut times = vec![t];
    let mut at = t.div_euclid(step) * step;
    if at == t {
        at -= step;
    }
    while at >= t - back && times.len() < MAX_WAKE {
        times.push(at);
        at -= step;
    }
    times
}

/// A rain ring's speed outward in m/s and its life in s (water.wgsl's RING_SPEED and RING_LIFE).
pub const RING_SPEED: f64 = 0.3;
pub const RING_LIFE: f64 = 0.35;

/// The rain's hash (water.wgsl's `hash`, bit for bit).
pub fn hash(a: u32) -> u32 {
    let mut h = a.wrapping_mul(0x9e37_79b9);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}

fn hash3(x: i32, y: i32, z: u32, seed: u32) -> u32 {
    hash(x as u32 ^ hash(y as u32 ^ hash(z ^ seed)))
}

fn unit(h: u32) -> f64 {
    f64::from(h >> 8) / 16_777_216.0
}

/// One rain ring alive at t: its part, its drop's index in the hash's sequence, its centre in
/// world x and z on the water at rest, its birth in s and its radius in m.
#[derive(Clone, Debug, PartialEq)]
pub struct Ring {
    pub part: String,
    pub drop: u64,
    pub at: [f64; 2],
    pub born: f64,
    pub radius: f64,
}

/// Drop (cell i, cell j, slot s)'s place and birth, from the seed alone.
fn drop_at(i: i32, j: i32, slot: i64, seed: u32, cell: f64, length: f64) -> ([f64; 2], f64) {
    let h = hash3(i, j, slot as u32, seed);
    (
        [
            (f64::from(i) + unit(h)) * cell,
            (f64::from(j) + unit(hash(h))) * cell,
        ],
        (slot as f64 + unit(hash(h ^ 0x5bd1_e995))) * length,
    )
}

impl Water {
    /// Every rain ring alive at t on each part, by part, then drop: the drops the renderer draws.
    pub fn rings(&self) -> Vec<Ring> {
        if self.rain <= 0.0 {
            return Vec::new();
        }
        let (cell, length, back) = self.rain_grid();
        let now = (self.t / length).floor() as i64;
        let back = i64::from(back);
        let mut out = Vec::new();
        for (part, [x0, z0, x1, z1]) in &self.plates {
            let (i0, i1) = ((x0 / cell).floor() as i32, (x1 / cell).floor() as i32);
            let (j0, j1) = ((z0 / cell).floor() as i32, (z1 / cell).floor() as i32);
            for j in j0..=j1 {
                for i in i0..=i1 {
                    for slot in now - back..=now {
                        let (at, born) = drop_at(i, j, slot, self.seed, cell, length);
                        let age = self.t - born;
                        let inside = at[0] >= *x0 && at[0] <= *x1 && at[1] >= *z0 && at[1] <= *z1;
                        if !(0.0..RING_LIFE).contains(&age) || !inside {
                            continue;
                        }
                        // The drop's index: its slot, then its cell, packed.
                        let drop = (((slot + 1) as u64) << 24)
                            | ((((j + 2048) as u64) & 0xfff) << 12)
                            | (((i + 2048) as u64) & 0xfff);
                        out.push(Ring {
                            part: part.clone(),
                            drop,
                            at,
                            born,
                            radius: RING_SPEED * age,
                        });
                    }
                }
            }
        }
        out.sort_by(|a, b| a.part.cmp(&b.part).then(a.drop.cmp(&b.drop)));
        out
    }
}

/// A wake behind an item a logic array moves is refused at check, naming the item: a driver whose
/// target is the item or one of its parents and one of whose variables reads a `logic` item's
/// array. A logic program's earlier steps aren't kept for a wake to read.
pub fn logic_moved(doc: &serde_json::Map<String, Value>) -> Result<(), Refused> {
    let empty = serde_json::Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let kind = |id: &str| {
        items
            .get(id)
            .and_then(|i| i.get("kind"))
            .and_then(Value::as_str)
    };
    let drivers: Vec<&Value> = doc
        .get("drivers")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|d| d.values())
        .collect();
    if drivers.is_empty() {
        return Ok(());
    }
    let from_logic = |d: &Value| {
        d.get("vars")
            .and_then(Value::as_object)
            .is_some_and(|vars| {
                vars.values().any(|v| {
                    v.as_str()
                        .and_then(|p| p.split_once('.'))
                        .and_then(|(owner, _)| kind(owner))
                        .is_some_and(|k| k.starts_with("logic"))
                })
            })
    };
    for item in items.values() {
        let Some(wake) = item
            .pointer("/params/water/wake/item")
            .and_then(Value::as_str)
        else {
            continue;
        };
        // The item and its parents.
        let mut chain = vec![wake.to_string()];
        while let Some(p) = items
            .get(chain.last().map_or("", String::as_str))
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
        {
            if chain.iter().any(|c| c == p) {
                break;
            }
            chain.push(p.to_string());
        }
        for d in &drivers {
            let target = d.get("target").and_then(Value::as_str).unwrap_or("");
            if from_logic(d)
                && chain
                    .iter()
                    .any(|c| target.starts_with(&format!("items/{c}/")))
            {
                return Err(bad("out_of_range", format!("items/{wake}")));
            }
        }
    }
    Ok(())
}
