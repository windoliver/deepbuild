//! Material: water (#166): a material's `water` on a plate's part. Waves are up to four
//! trochoidal waves in closed form of rest position and t; ripples are seeded noise drifting with
//! the wind; rain rings sit at places and times hashed from the seed, each a closed form of its
//! age; foam whitens where the waves' steepness passes a threshold; a wake follows a named item
//! along the path it took over the last `span` s, read from its positions at whole multiples of the
//! frame interval. Under its own mirror the water shows the bed behind it, tinted by depth.
//!
//! Everything here is a pure function of the document and t, so seeking equals playing; nothing
//! is simulated, integrated or read from an earlier frame.

use std::cell::RefCell;
use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::scene::{Layer3, Refused, Scene};

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
        (G * self.k()).sqrt()
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

/// The most rings touches may keep alive at one time on one part (#2760); a list that would
/// keep more is refused at check.
pub const MAX_RINGS: usize = 64;

/// #2760: one ring a touch starts: the part it lies on, its occurrence's index in the list its
/// `on` names (counted before the filter, as a Spawn's voice names it), its point dropped onto
/// the plate at rest (world x and z) and its flick.
#[derive(Clone, Debug, PartialEq)]
pub struct Touch {
    pub part: String,
    pub occurrence: usize,
    pub at: [f64; 2],
    pub born: i64,
}

/// #2760: rings where something touches the water. Each occurrence its `on` matches starts one
/// ring at its flick, at its point: the rain's ring, its crest at radius speed × age, fading to
/// nothing at `span`.
#[derive(Clone, Debug, PartialEq)]
pub struct Rings {
    /// The baked occurrence list and its filter, as Spawn takes it.
    pub on: Value,
    pub speed: f64,
    pub span: f64,
    pub strength: f64,
    /// The touches of the whole list, in flick order, read from its bake at check.
    pub touches: Vec<Touch>,
    /// The frame's flick.
    pub now: i64,
}

const FLICKS: f64 = deep_canvas::camera::FLICKS_PER_SECOND as f64;

/// #2760: [`Rings::cells`]' grid: its origin in world x and z, its cells per m along each, and
/// each cell's rings as bits, row by row along z.
#[derive(Clone, Debug, PartialEq)]
pub struct Cells {
    pub origin: [f64; 2],
    pub per_m: [f64; 2],
    pub masks: Vec<u32>,
}

impl Rings {
    /// A ring's life in flicks.
    fn life(&self) -> i64 {
        (self.span * FLICKS).round() as i64
    }

    /// The grid the shading pass finds a pixel's rings by: over the box the alive rings' crests
    /// reach, [`RING_GRID`] cells a side, each cell a bit for every ring (by its place among the
    /// first `most` alive, 32 a word) whose crest can bend a point of it. A point outside the box
    /// is bent by none, so a pixel reads the few rings near it and never all of them.
    pub fn cells(&self, most: usize) -> Cells {
        let reach = 3.0 * RING_WIDTH + 1e-3;
        let live: Vec<([f64; 2], f64)> = (self.alive().take(most))
            .map(|(c, age)| (c.at, self.speed * age))
            .collect();
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for (at, radius) in &live {
            for a in 0..2 {
                lo[a] = lo[a].min(at[a] - radius - reach);
                hi[a] = hi[a].max(at[a] + radius + reach);
            }
        }
        let words = live.len().div_ceil(32);
        let mut cells = Cells {
            origin: lo,
            per_m: [0, 1].map(|a| RING_GRID as f64 / (hi[a] - lo[a])),
            masks: vec![0; RING_GRID * RING_GRID * words],
        };
        for (k, (at, radius)) in live.iter().enumerate() {
            let (near, far) = (radius + reach, (radius - reach).max(0.0));
            for j in 0..RING_GRID {
                for i in 0..RING_GRID {
                    // The cell's nearest and furthest points from the ring's centre, squared.
                    let (mut nearest, mut furthest) = (0.0, 0.0);
                    for (a, c) in [i, j].into_iter().enumerate() {
                        let (c0, c1) = (c as f64, (c + 1) as f64);
                        let (d0, d1) = (
                            lo[a] + c0 / cells.per_m[a] - at[a],
                            at[a] - lo[a] - c1 / cells.per_m[a],
                        );
                        let (out, across) = (d0.max(d1).max(0.0), (-d0).max(-d1));
                        nearest += out * out;
                        furthest += across * across;
                    }
                    if nearest <= near * near && furthest >= far * far {
                        cells.masks[(j * RING_GRID + i) * words + k / 32] |= 1 << (k % 32);
                    }
                }
            }
        }
        cells
    }

    /// The rings alive at the frame's flick, in the list's order, each with its age in s: a
    /// touch draws from its flick until its age reaches `span`.
    pub fn alive(&self) -> impl Iterator<Item = (&Touch, f64)> {
        let life = self.life();
        self.touches.iter().filter_map(move |c| {
            let age = self.now - c.born;
            (0..life).contains(&age).then(|| (c, age as f64 / FLICKS))
        })
    }

    /// Reads the list's touches on `plates` (each part's extent at rest): `kept`, its `on`'s
    /// matches in flick order, each numbered by its place in `whole`, the list unfiltered. An
    /// occurrence with no point, or whose point lies off every plate, starts no ring. More than
    /// [`MAX_RINGS`] alive at one time on one part are refused, naming the part, the time and the
    /// count: the list is whole before playback.
    fn read(
        &mut self,
        material: &str,
        plates: &[(String, [f64; 4])],
        whole: &[deep_canvas_motion::occurrence::Occurrence],
        kept: &[deep_canvas_motion::occurrence::Occurrence],
    ) -> Result<(), Fault> {
        let mut next = 0;
        self.touches = kept
            .iter()
            .filter_map(|o| {
                // The filter keeps the list's order, so each match lies past the one before.
                let occurrence = next + whole[next..].iter().position(|w| w == o)?;
                next = occurrence + 1;
                let p = o.payload.get("point")?.as_array()?;
                let at = [p.first()?.as_f64()?, p.get(2)?.as_f64()?];
                let (part, _) = plates.iter().find(|(_, [x0, z0, x1, z1])| {
                    at[0] >= *x0 && at[0] <= *x1 && at[1] >= *z0 && at[1] <= *z1
                })?;
                Some(Touch {
                    part: part.clone(),
                    occurrence,
                    at,
                    born: o.t,
                })
            })
            .collect();
        let life = self.life();
        for (part, _) in plates {
            let born: Vec<i64> = (self.touches.iter())
                .filter(|c| c.part == *part)
                .map(|c| c.born)
                .collect();
            // At each birth, the rings alive are those born in the `span` up to it.
            let mut from = 0;
            for (k, &b) in born.iter().enumerate() {
                while born[from] <= b - life {
                    from += 1;
                }
                let alive = k + 1 - from;
                if alive > MAX_RINGS {
                    let at = b as f64 / FLICKS;
                    return Err(carrying(
                        "over_budget",
                        &format!("items/{material}/params/water/rings"),
                        json!({"ids": [material, part], "actual": {"part": part, "count": alive, "t": b},
                            "what": format!("{alive} rings are alive at one time on {part}, at {at} s: a part draws {MAX_RINGS}"),
                            "fix": "Start fewer rings at one time on the part: narrow `on`, or shorten `span`."}),
                    ));
                }
            }
        }
        Ok(())
    }
}

/// #2760: a list none of whose kinds carries a point starts no ring ever, so a water's rings on
/// it are refused at check, naming the list. A logic item's kinds are those it declares in
/// `emits`, a kind's point its field named `point`; a marker and an input entry have no place,
/// and a world's contacts and hits do.
fn pointed(
    doc: &serde_json::Map<String, Value>,
    material: &str,
    list: &str,
    path: &str,
) -> Result<(), Fault> {
    let emits = list
        .strip_suffix(".occurrences")
        .and_then(|id| doc.get("items")?.get(id))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
        .map(|i| i.pointer("/params/emits").and_then(Value::as_object));
    let carries = match emits {
        Some(kinds) => kinds
            .into_iter()
            .flat_map(|k| k.values())
            .any(|k| k.pointer("/fields/point").is_some()),
        None => !(list.starts_with("markers.") || list.starts_with("input.")),
    };
    if carries {
        return Ok(());
    }
    Err(carrying(
        "out_of_range",
        path,
        json!({"ids": [material], "actual": {"list": list},
            "what": format!("no kind of {list} carries a point, so none of its occurrences starts a ring"),
            "fix": "Name a list one of whose kinds carries a point: a physics world's, or a logic item's with a field named `point`."}),
    ))
}

/// What [`find`] refuses with: the refusal every host gets and, for a refusal that names more
/// than its path, the issue a host that checks a document raises (`{code, severity, ids, path,
/// actual, what, fix}`).
#[derive(Debug)]
pub struct Fault(Refused, Option<Value>);

impl From<Refused> for Fault {
    fn from(r: Refused) -> Fault {
        Fault(r, None)
    }
}

impl Fault {
    /// The refusal, its issue left in the host's memo where the host keeps one.
    pub(crate) fn kept(self, memo: Option<&RefCell<crate::contributed::Memo>>) -> Refused {
        if let (Some(memo), Some(issue)) = (memo, self.1) {
            memo.borrow_mut().refused = Some(issue);
        }
        self.0
    }
}

/// A refusal at `path` with the `ids`, `actual`, `what` and `fix` of its issue; a host that
/// keeps no issue reads what it found after the path.
fn carrying(code: &'static str, path: &str, mut issue: Value) -> Fault {
    issue["code"] = json!(code);
    issue["severity"] = json!("error");
    issue["path"] = json!(path);
    let what = issue["what"].as_str().unwrap_or_default();
    Fault(bad(code, format!("{path}: {what}")), Some(issue))
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
    /// #968: the flow faster than which foam covers the water, m/s, or none.
    pub foam_speed: Option<f64>,
    /// #968: the flow the ripples' and the foam's noise moves along, or none.
    pub flow: Option<crate::flow::Flow>,
    pub wake: Option<Wake>,
    /// #2760: the rings its touches start, or none.
    pub rings: Option<Rings>,
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
        let cell = (1.0 / (self.rain * RING_LIFE).sqrt()).max(2.0 * RING_SPEED * RING_LIFE);
        let slot = 1.0 / (self.rain * cell * cell);
        (cell, slot, (RING_LIFE / slot - 1e-9).ceil() as u32)
    }

    /// #3034: the part whose surface at rest `eye` lies below: inside its extent in x and z,
    /// and lower than the water's level.
    pub fn over(&self, eye: [f64; 3]) -> Option<&str> {
        let covers = |[x0, z0, x1, z1]: &[f64; 4]| {
            eye[0] >= *x0 && eye[0] <= *x1 && eye[2] >= *z0 && eye[2] <= *z1
        };
        (self.plates.iter())
            .find(|(_, plate)| eye[1] < self.level && covers(plate))
            .map(|(part, _)| part.as_str())
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
    [r.sin(), r.cos()]
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
    let foam_speed = match spec.get("foam").and_then(|f| f.get("speed")) {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(v) => Some(
            v.as_f64()
                .filter(|x| x.is_finite() && *x >= 0.0)
                .ok_or_else(|| bad("out_of_range", at("foam/speed")))?,
        ),
    };
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
    let rings = match spec.get("rings") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(r) => Some(Rings {
            on: r
                .get("on")
                .filter(|on| on.is_string() || on.is_object())
                .ok_or_else(|| bad("bad_input", at("rings/on")))?
                .clone(),
            speed: num(r.get("speed"), "rings/speed", 0.3, [1e-3, 100.0])?,
            span: num(r.get("span"), "rings/span", 2.0, [1e-3, 60.0])?,
            strength: num(r.get("strength"), "rings/strength", 0.2, [0.0, 1.0])?,
            touches: Vec::new(),
            now: 0,
        }),
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
        foam_speed,
        flow: crate::flow::parse(material, spec.get("flow"))?,
        wake,
        rings,
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

/// The view's water at flick `t`, from the materials its solids name: the first in item order,
/// its parts the solids whose material it is. `None` when no drawn solid's material carries one.
pub fn find<'a>(
    layers: &[Layer3],
    get: impl Fn(&str) -> Option<&'a Value>,
    doc: &serde_json::Map<String, Value>,
    program: &deep_canvas_motion::program::Program,
    t: i64,
) -> Result<Option<Water>, Fault> {
    let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32;
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
            found = Some(parse(name, spec, seed, t as f64 / FLICKS)?);
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
    // #2760: the rings its touches start, from the baked list its `on` names.
    if let Some(w) = &mut found {
        if let Some(rings) = &mut w.rings {
            let path = format!("items/{}/params/water/rings/on", w.material);
            let list = |on: &Value| {
                deep_canvas_motion::occurrence::matches(program, doc, on, &path)
                    .map_err(|r| bad(r.code, r.path))
            };
            let name = rings.on.get("list").unwrap_or(&rings.on);
            let (whole, kept) = (list(name)?, list(&rings.on)?);
            pointed(doc, &w.material, name.as_str().unwrap_or(""), &path)?;
            rings.now = t;
            rings.read(&w.material, &w.plates, &whole, &kept)?;
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
/// A ring's crest's width in m, and the side in cells of the grid a touch's rings are found by
/// (water.wgsl's RING_WIDTH and TOUCH_GRID).
pub const RING_WIDTH: f64 = 0.015;
pub const RING_GRID: usize = 16;

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

impl Water {
    /// #2760's wrong rings, reachable only through `deep-gpu --planted`: each ring centred where
    /// the rain's hash puts a drop on its part, by the seed and the ring's place among the
    /// touches, never at its occurrence's point.
    pub fn plant_rings_at_rain_hash(&mut self) {
        let touches = self.rings.iter_mut().flat_map(|r| &mut r.touches);
        for (k, c) in touches.enumerate() {
            let plate = self.plates.iter().find(|(part, _)| *part == c.part);
            if let Some((_, [x0, z0, x1, z1])) = plate {
                let h = hash3(k as i32, 0, 0, self.seed);
                c.at = [x0 + unit(h) * (x1 - x0), z0 + unit(hash(h)) * (z1 - z0)];
            }
        }
    }
}

/// A wake or a trail (#450) behind an item a live drag moves is refused at check, naming the
/// item: a document control whose handle drags the item or one of its parents, whose earlier
/// places nothing keeps for either to read. One a logic array moves reads the logic bake's
/// earlier steps through its drivers (#265).
pub fn dragged(doc: &serde_json::Map<String, Value>) -> Result<(), Refused> {
    let empty = serde_json::Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let handles: Vec<&str> = doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|c| c.values())
        .filter_map(|c| c.pointer("/handle/item").and_then(Value::as_str))
        .collect();
    if handles.is_empty() {
        return Ok(());
    }
    for item in items.values() {
        let source = item
            .pointer("/params/water/wake/item")
            .or_else(|| item.pointer("/params/trail/of"));
        let Some(wake) = source
            .and_then(Value::as_str)
            .map(|s| s.split('#').next().unwrap_or(s))
        else {
            continue;
        };
        // The item and its parents.
        let mut chain = vec![wake];
        while let Some(p) = items
            .get(chain[chain.len() - 1])
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
        {
            if chain.contains(&p) {
                break;
            }
            chain.push(p);
        }
        if chain.iter().any(|c| handles.contains(c)) {
            return Err(bad("out_of_range", format!("items/{wake}")));
        }
    }
    Ok(())
}

/// #3034: water is drawn for an eye above it, so a camera whose eye goes below a water part
/// during the document's span is refused at check: the issue, naming the camera, the part and
/// the first frame time the eye is below, or `None`. `at` is the scene at a time as the host
/// draws it; a document with no water reads none.
pub fn submerged(doc: &Value, mut at: impl FnMut(i64) -> Option<Scene>) -> Option<Value> {
    let map = doc.as_object()?;
    let wet = |i: &Value| i.pointer("/params/water").is_some_and(Value::is_object);
    if !map.get("items")?.as_object()?.values().any(wet) {
        return None;
    }
    let camera = map.get("camera")?.as_str()?;
    let span = doc.pointer("/transport/span").cloned().unwrap_or(json!(0));
    let span = deep_canvas::document::duration(doc, &span).unwrap_or(0);
    let step = crate::scene::frame_interval(map).max(1);
    (0..=span.max(0) / step).map(|k| k * step).find_map(|t| {
        let scene = at(t)?;
        let part = scene.water.as_ref()?.over(scene.camera.eye)?;
        let s = t as f64 / FLICKS;
        Some(json!({"code": "out_of_range", "severity": "error", "path": format!("items/{camera}/params"),
            "ids": [camera, part], "actual": {"camera": camera, "part": part, "t": t},
            "what": format!("the eye of {camera} is below the water of {part} at {s} s: water is drawn for an eye above it"),
            "fix": "Keep the camera's eye above the water's surface through the document's span."}))
    })
}

#[cfg(test)]
mod tests {
    use deep_canvas_motion::occurrence::Occurrence;
    use serde_json::json;

    use super::*;

    const F: i64 = deep_canvas::camera::FLICKS_PER_SECOND;

    fn rings(now: i64) -> Rings {
        let spec = json!({"rings": {"on": "game.occurrences"}});
        let mut r = parse("pond", &spec, 0, 0.0).unwrap().rings.unwrap();
        r.now = now;
        r
    }

    fn touch(t: i64, point: Value) -> Occurrence {
        Occurrence {
            t,
            end: t,
            a: None,
            b: None,
            kind: "lap".into(),
            tags: Vec::new(),
            payload: json!({"point": point}),
        }
    }

    /// #2760: a touch starts one ring at its flick, at its point dropped onto the plate; one with
    /// no point, or off the plate, starts none; a ring is gone when its age reaches the span.
    #[test]
    fn a_touch_starts_a_ring_at_its_point_and_it_dies_at_its_span() {
        let plates = [("pond".to_string(), [-2.0, -2.0, 2.0, 2.0])];
        let list = [
            touch(F, json!([0.5, 3.0, -1.0])),
            touch(F * 3 / 2, json!([3.0, 0.0, 0.0])),
            touch(F * 3 / 2, Value::Null),
            touch(F * 2, json!([0.0, 0.0, 0.0])),
        ];
        let mut r = rings(F * 9 / 4);
        r.read("lake", &plates, &list, &list).unwrap();
        let alive: Vec<(usize, [f64; 2], f64)> = r
            .alive()
            .map(|(c, age)| (c.occurrence, c.at, age))
            .collect();
        assert_eq!(alive, [(0, [0.5, -1.0], 1.25), (3, [0.0, 0.0], 0.25)]);
        assert!(r.alive().all(|(c, _)| c.part == "pond"));
        // The first touch, at 1 s, with the default span of 2 s: alive a flick before 3 s, gone at 3 s.
        r.now = F * 3 - 1;
        assert_eq!(r.alive().count(), 2);
        r.now = F * 3;
        assert_eq!(
            r.alive().map(|(c, _)| c.occurrence).collect::<Vec<_>>(),
            [3]
        );
        // A filter's matches keep their places in the whole list, as a Spawn's voices name them.
        r.read("lake", &plates, &list, &list[3..]).unwrap();
        assert_eq!(r.touches[0].occurrence, 3);
        // The planted rings sit where the rain's hash puts them, not at their points.
        let mut w = parse("lake", &json!({}), 2760, 0.0).unwrap();
        (w.plates, w.rings) = (plates.to_vec(), Some(r));
        w.plant_rings_at_rain_hash();
        let at = w.rings.unwrap().touches[0].at;
        assert!(
            at != [0.0, 0.0] && at.iter().all(|x| x.abs() <= 2.0),
            "{at:?}"
        );
    }

    /// #2760: every point a ring's crest bends lies in a cell that holds the ring's bit, so the
    /// grid drops no ring a pixel would draw; and a cell inside a wide ring's crest holds none.
    #[test]
    fn the_grid_holds_every_ring_that_reaches_a_point() {
        let mut r = rings(F * 2);
        r.touches = (0..40)
            .map(|k: i64| Touch {
                part: "pond".into(),
                occurrence: k as usize,
                at: [
                    (k * 37 % 23) as f64 * 0.31 - 3.0,
                    (k * 53 % 19) as f64 * 0.27 - 2.0,
                ],
                born: F * 2 - (k + 1) * F / 21,
            })
            .collect();
        let cells = r.cells(64);
        let live: Vec<([f64; 2], f64)> = r.alive().map(|(c, age)| (c.at, 0.3 * age)).collect();
        assert_eq!((live.len(), cells.masks.len()), (40, 16 * 16 * 2));
        let (mut held, mut reached) = (0, 0);
        for n in 0..90_000 {
            let p = [(n % 300) as f64 * 0.03 - 4.5, (n / 300) as f64 * 0.03 - 4.5];
            let cell = [0, 1].map(|a| ((p[a] - cells.origin[a]) * cells.per_m[a]).floor());
            let inside = cell.iter().all(|c| (0.0..16.0).contains(c));
            let at = (cell[1] as usize * 16 + cell[0] as usize) * 2;
            for (k, (c, radius)) in live.iter().enumerate() {
                let d2 = (p[0] - c[0]) * (p[0] - c[0]) + (p[1] - c[1]) * (p[1] - c[1]);
                let (lo, hi) = ((radius - 0.045).max(0.0), radius + 0.045);
                if d2 > lo * lo && d2 < hi * hi {
                    reached += 1;
                    assert!(
                        inside && cells.masks[at + k / 32] >> (k % 32) & 1 == 1,
                        "ring {k} bends {p:?}"
                    );
                }
                held += usize::from(inside && cells.masks[at + k / 32] >> (k % 32) & 1 == 1);
            }
        }
        // Far fewer rings are held at a point than are alive, and the crests are all found.
        assert!(
            reached > 5_000 && held < 90_000 * 40 / 8,
            "{reached} {held}"
        );
    }

    /// #2760: 64 rings alive at one time on one part draw; 65 are refused, naming the part, the
    /// time and the count; the same 65 over two parts, or further apart than the span, draw.
    #[test]
    fn more_than_64_rings_alive_on_one_part_are_refused() {
        let plates = [
            ("east".to_string(), [0.0, -2.0, 2.0, 2.0]),
            ("west".to_string(), [-2.0, -2.0, -0.01, 2.0]),
        ];
        let within = |n: i64, gap: i64, x: fn(i64) -> f64| -> Vec<Occurrence> {
            (0..n)
                .map(|k| touch(F + k * gap, json!([x(k), 0.0, 0.0])))
                .collect()
        };
        let mut r = rings(0);
        let mut read = |list: Vec<Occurrence>| r.read("lake", &plates, &list, &list);
        assert!(read(within(64, F / 65, |_| 1.0)).is_ok());
        let Fault(refused, issue) = read(within(65, F / 65, |_| 1.0)).unwrap_err();
        assert_eq!(refused.code, "over_budget");
        let at = (F + 64 * (F / 65)) as f64 / F as f64;
        assert_eq!(
            refused.path,
            format!("items/lake/params/water/rings: 65 rings are alive at one time on east, at {at} s: a part draws 64")
        );
        let issue = issue.unwrap();
        assert_eq!(issue["path"], json!("items/lake/params/water/rings"));
        assert_eq!(
            issue["actual"],
            json!({"part": "east", "count": 65, "t": F + 64 * (F / 65)})
        );
        assert_eq!(issue["ids"], json!(["lake", "east"]));
        let split = |k: i64| if k % 2 == 0 { 1.0 } else { -1.0 };
        assert!(read(within(65, F / 65, split)).is_ok());
        assert!(read(within(65, F / 32, |_| 1.0)).is_ok());
    }

    /// #3034: a 20 m lake at y = 0 seen from `eye`, over a span of 4 s.
    fn lake(eye: [f64; 3]) -> Value {
        json!({
            "format": 1, "profile": "scene", "title": "T", "size": [320, 180], "camera": "cam",
            "transport": {"span": "4s"},
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "position": eye, "target": [0, 0, 0], "fov": 40}},
                "wet": {"id": "wet", "kind": "material@1", "name": "M", "order": "a1", "layer": "main", "params": {"water": {}}},
                "lake": {"id": "lake", "kind": "plate@1", "name": "L", "order": "b0", "layer": "main", "material": "wet", "params": {"grid": [4, 4], "size": [20, 20]}, "at": {"pos": [0, 0, 0]}}
            }
        })
    }

    fn look() -> crate::look::Look3 {
        crate::look::Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}}))
            .unwrap()
    }

    /// #3034: a camera keyed through the surface is refused, naming the camera, the part and the
    /// first frame time its eye is below; one that stays above the water is not.
    #[test]
    fn a_camera_keyed_below_the_water_is_refused_at_its_first_frame_below() {
        let look = look();
        let at = |doc: &Value, t: i64| {
            crate::scene::evaluate(doc, t, &look, &mut crate::label::Labels::new()).ok()
        };
        let mut doc = lake([0.0, 2.0, 3.0]);
        assert_eq!(submerged(&doc, |t| at(&doc, t)), None);
        doc["channels"] = json!({"dive": {"target": "items/cam/params/position/1", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 2.0078125, "interp": "linear"},
                     "k1": {"t": "4s", "value": -1.9921875, "interp": "linear"}}}});
        let issue = submerged(&doc, |t| at(&doc, t)).expect("the dive is refused");
        // The eye meets the surface between the frames at 2 s and a sixtieth of a second later.
        assert_eq!(
            issue["actual"],
            json!({"camera": "cam", "part": "lake", "t": 2 * F + F / 60})
        );
        assert_eq!(issue["ids"], json!(["cam", "lake"]));
    }

    /// #2760: a list none of whose kinds carries a point is refused, naming the list.
    #[test]
    fn a_list_with_no_point_is_refused_by_name() {
        let doc = |fields: Value| {
            let doc = json!({"items": {"game": {"kind": "logic@1", "params": {"emits": {"step": {}, "lap": {"fields": fields}}}}}});
            doc.as_object().cloned().unwrap()
        };
        let list = "game.occurrences";
        assert!(pointed(&doc(json!({"point": "vec3"})), "pond", list, "p").is_ok());
        let Fault(refused, issue) =
            pointed(&doc(json!({"speed": "f64"})), "pond", list, "p").unwrap_err();
        assert_eq!(refused.code, "out_of_range");
        assert!(refused
            .path
            .starts_with("p: no kind of game.occurrences carries a point"));
        assert_eq!(issue.unwrap()["actual"], json!({"list": list}));
        let world = doc(json!({}));
        assert!(pointed(&world, "pond", "pool.occurrences", "p").is_ok());
        assert!(pointed(&world, "pond", "markers.beat", "p").is_err());
    }
}
