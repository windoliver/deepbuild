//! A builder's modifier stack (canvas primitives: Modifier; issue #420): pure steps on the
//! built mesh, top to bottom in the order the item declares, each of a class its kind fixes
//! (`deform` moves points, `generate` makes new ones), reading time where a channel binds one
//! of its params or where the kind reads it by nature (sway, bob, wave, spin, boil), always as a
//! closed form in t. A modifier with `enabled: false` is skipped and reads nothing.

use std::collections::BTreeMap;

use deep_canvas::ops::{cos, rad, sin};
use deep_canvas::schedule::Canonical;
use serde_json::{json, Value};

use crate::builders::{path, Fault};
use crate::geom::{add, cross, dot, scale, sub, unit, Mesh, V3};
use crate::poly::{Boundary, Poly, Scheme, UvRule};

/// The modifier kinds: each one's class, whether it is a GPU kind (a sway moves on the GPU, #2016;
/// the others are evaluated here on the CPU from their per-instance params) and whether it reads
/// time by its nature.
pub const KINDS: [(&str, &str, bool, bool); 18] = [
    ("mod.array@1", "generate", false, false),
    ("mod.mirror@1", "generate", false, false),
    ("mod.subdivide@1", "generate", false, false),
    ("mod.bevel@1", "generate", false, false),
    ("mod.solidify@1", "generate", false, false),
    ("mod.build@1", "generate", false, false),
    ("mod.store@1", "generate", false, false),
    ("mod.normals@1", "deform", false, false),
    ("mod.curve_deform@1", "deform", false, false),
    ("mod.simple_deform@1", "deform", false, false),
    ("mod.displace@1", "deform", false, false),
    ("mod.sway@1", "deform", true, true),
    ("mod.bob@1", "deform", true, true),
    ("mod.wave@1", "deform", true, true),
    ("mod.spin@1", "deform", true, true),
    // A line's stroke modifiers (with `mod.build@1`), which scene3d's line evaluation applies.
    ("mod.dash@1", "generate", false, false),
    ("mod.outline@1", "generate", false, false),
    ("mod.boil@1", "deform", false, true),
];

/// The stroke modifiers a `mark.line@1` takes.
pub const STROKE: [&str; 4] = ["mod.dash@1", "mod.outline@1", "mod.boil@1", "mod.build@1"];

/// The block count scene3d registers for its build operators (Operator: `parallel:
/// fixed_blocks`): a subdivision's and a normals pass's elements split into this many ranges,
/// each written alone and joined in block order, so one block and many give the same bits.
pub const BLOCKS: usize = 4;

/// How a stack runs: the planted wrong program, the block count (scene3d's unless a proof
/// surface asks for one), and how many corners each face of the builder's mesh is turned by
/// before the stack runs (a proof surface's `rotate_corners`).
#[derive(Clone, Debug, Default)]
pub struct Run {
    pub planted: Option<String>,
    pub blocks: Option<usize>,
    pub rotate: usize,
    /// The build's outline sources an `extrude` reads (#443).
    pub outlines: Vec<deep_canvas::registry::SealedOutline>,
    /// A monotonic clock in milliseconds that times each step into its row (#2017): the
    /// `geometry` call's `timings` hand one in; no check runs with one.
    pub clock: Option<fn() -> f64>,
}

impl Run {
    pub fn blocks(&self) -> usize {
        self.blocks.unwrap_or(BLOCKS).max(1)
    }
    fn planted(&self, name: &str) -> bool {
        self.planted.as_deref() == Some(name)
    }
}

fn kind_row(kind: &str) -> Option<(&'static str, bool, bool)> {
    KINDS.iter().find(|k| k.0 == kind).map(|k| (k.1, k.2, k.3))
}

/// Whether the modifier kind reads time by its nature (sway, bob, wave, spin, boil).
pub fn timed(kind: &str) -> bool {
    kind_row(kind).is_some_and(|k| k.2)
}

/// An item whose enabled stack holds a modifier that reads time by its nature at build: a sway
/// reads it on the GPU (#2016), so it never rebuilds the mesh.
pub fn reads_time_by_kind(item: &Value) -> bool {
    list(item).iter().any(|m| {
        let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
        enabled(m) && timed(kind) && kind != SWAY
    })
}

const SWAY: &str = "mod.sway@1";
/// Where a sway's weights ride through the modifiers after it, as any float point attribute does.
const SWAY_WEIGHTS: &str = "\u{0}sway";

/// A GPU sway (Modifier: sway; #2016): what the stack keeps for the renderer instead of moving
/// anything at build. Vertex k moves along the wind, in the world, by amount × weights[k] ×
/// ((1 − strength) × sin(2π hz t + phase) + strength × gust), with gust in [−1, 1] noise over
/// the item's place less the wind's velocity × t, so no vertex moves more than amount.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sway {
    pub amount: f64,
    /// Where the wind blows toward, in degrees from +x toward +z.
    pub direction: f64,
    /// The wind's speed in m/s and its gusts' scale in m and strength in [0, 1].
    pub speed: f64,
    pub scale: f64,
    pub strength: f64,
    pub hz: f64,
    /// The slow sway's phase in radians, from the modifier's seed alone: identical items sway
    /// together, and a seed per instance sets them apart.
    pub phase: f64,
    /// Each vertex's weight in [0, 1]: its height (0 at the lowest point, 1 at the highest) or a
    /// stored attribute, clamped, where the sway stood; 0 off the part it names.
    pub weights: Vec<f64>,
}

impl Canonical for Sway {
    fn encode(&self, out: &mut Vec<u8>) {
        let s = self;
        [
            s.amount,
            s.direction,
            s.speed,
            s.scale,
            s.strength,
            s.hz,
            s.phase,
        ]
        .encode(out);
        s.weights.encode(out);
    }
}

/// One modifier as the `geometry` call lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub kind: String,
    pub class: &'static str,
    pub reads_time: bool,
    pub enabled: bool,
    pub gpu: bool,
    /// The step's time in milliseconds by the run's clock (0 for a skipped one); none without
    /// one (#2017). `to_json` leaves it out, so a build's key never reads it.
    pub ms: Option<f64>,
}

impl Row {
    pub fn to_json(&self) -> Value {
        json!({"kind": self.kind, "class": self.class, "reads_time": self.reads_time,
               "enabled": self.enabled, "gpu": self.gpu})
    }
}

/// Whether a channel or driver of `doc` binds a param of the item's modifier `k`.
pub fn reads_time(doc: &Value, id: &str, k: usize) -> bool {
    let prefix = format!("items/{id}/modifiers/{k}/");
    ["channels", "drivers"].iter().any(|section| {
        doc.get(*section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, c)| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&prefix))
            })
    })
}

pub(crate) fn enabled(m: &Value) -> bool {
    m.get("enabled").and_then(Value::as_bool).unwrap_or(true)
}

/// The items an item's modifiers name (a `curve_deform`'s path, an array's `along`), each
/// enabled one's; the planted `keeps_disabled_refs` keeps a disabled one's too (AC9's wrong
/// program).
pub fn refs(item: &Value, planted: Option<&str>) -> Vec<String> {
    let keep_disabled = planted == Some("keeps_disabled_refs");
    item.get("modifiers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| keep_disabled || enabled(m))
        .flat_map(|m| {
            ["/params/path", "/params/along"]
                .into_iter()
                .filter_map(|p| m.pointer(p).and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// The item with only its first `k` modifiers: what modifier `k` takes.
pub fn prefix(item: &Value, k: usize) -> Value {
    let mut cut = item.clone();
    if let Some(list) = cut.get_mut("modifiers").and_then(Value::as_array_mut) {
        list.truncate(k);
    }
    cut
}

fn list(item: &Value) -> Vec<Value> {
    item.get("modifiers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// An array's count: given, or as many copies `offset` apart as fit in `fit` metres.
fn array_count(m: &Value) -> Option<u64> {
    if let Some(fit) = m.pointer("/params/fit") {
        let fit = fit.as_f64().filter(|f| *f >= 0.0)?;
        let step = vec3(m.pointer("/params/offset")).map_or(0.0, crate::geom::length);
        if step <= 0.0 {
            return None;
        }
        return Some(((fit / step).floor() as u64 + 1).clamp(1, 1024));
    }
    m.pointer("/params/count")
        .and_then(Value::as_u64)
        .filter(|c| (1..=1024).contains(c))
}

fn levels(m: &Value) -> Option<u64> {
    match m.pointer("/params/levels") {
        None => Some(1),
        Some(v) => v.as_u64().filter(|l| *l <= 3),
    }
}

/// The triangles a `build` keeps of `t`, by index or by a seeded order, in index order.
fn kept(m: &Value, t: u64) -> Option<Vec<u32>> {
    let num = |k: &str, d: f64| match m.pointer(&format!("/params/{k}")) {
        None => Some(d),
        Some(v) => v.as_f64(),
    };
    let (from, to) = (num("from", 0.0)?, num("to", 1.0)?);
    if !(0.0..=1.0).contains(&from) || !(0.0..=1.0).contains(&to) {
        return None;
    }
    let (a, b) = (
        (from * t as f64).floor() as usize,
        (to * t as f64).floor() as usize,
    );
    let mut order: Vec<u32> = (0..t as u32).collect();
    match m
        .pointer("/params/order")
        .and_then(Value::as_str)
        .unwrap_or("index")
    {
        "index" => {}
        "seeded" => {
            let seed = m
                .pointer("/params/seed")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            order.sort_by_key(|i| (mix(seed ^ mix(u64::from(*i))), *i));
        }
        _ => return None,
    }
    let mut keep: Vec<u32> = order.get(a.min(b)..b.max(a)).unwrap_or(&[]).to_vec();
    keep.sort_unstable();
    Some(keep)
}

fn axes(m: &Value) -> Option<Vec<usize>> {
    m.pointer("/params/axes")?
        .as_array()?
        .iter()
        .map(|a| axis_of(a.as_str()?))
        .collect()
}

fn axis_of(a: &str) -> Option<usize> {
    match a {
        "x" => Some(0),
        "y" => Some(1),
        "z" => Some(2),
        _ => None,
    }
}

fn vec3(v: Option<&Value>) -> Option<V3> {
    let a = v?.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// splitmix64: the noise the seeded modifiers draw from.
pub(crate) fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// A seed from the item's stable ID and the modifier's own `seed` (Builder: "seeds from stable
/// IDs").
pub(crate) fn seed_of(id: &str, m: &Value) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
    }
    mix(h ^ m
        .pointer("/params/seed")
        .and_then(Value::as_u64)
        .unwrap_or(0))
}

/// A number in [−1, 1] from a seed and a key.
pub(crate) fn unit_noise(seed: u64, key: u64) -> f64 {
    (mix(seed ^ mix(key)) >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
}

/// Noise in [−1, 1] at a point, the same for every vertex welded to it.
fn noise(seed: u64, p: V3) -> f64 {
    let k = p.map(|x| (x / 1e-6).round() as i64 as u64);
    unit_noise(seed, k[0] ^ mix(k[1] ^ mix(k[2])))
}

/// The vertices `on` (a named part's, or every one) a deform moves.
fn targets(m: &Mesh, on: &str) -> Option<Vec<bool>> {
    if on == "all" {
        return Some(vec![true; m.positions.len()]);
    }
    let tris = m.parts.get(on).or_else(|| m.closed.get(on).map(|c| &c.0))?;
    let mut out = vec![false; m.positions.len()];
    for &t in tris {
        for j in 0..3 {
            out[m.indices[3 * t as usize + j] as usize] = true;
        }
    }
    Some(out)
}

/// The mesh with the vertices `on` moved by `f(p, k)` and their normals by `g`.
fn deform(m: &Mesh, on: &[bool], f: impl Fn(V3, usize) -> V3, g: impl Fn(V3) -> V3) -> Mesh {
    let mut out = m.clone();
    for (k, _) in on.iter().enumerate().filter(|(_, x)| **x) {
        out.positions[k] = f(m.positions[k], k);
        out.normals[k] = unit(g(m.normals[k]));
    }
    out
}

/// `moved`'s vertices where `only` holds them, `m`'s elsewhere.
fn mask(m: &Mesh, moved: Mesh, only: &[bool]) -> Mesh {
    if only.iter().all(|x| *x) {
        return moved;
    }
    let mut out = m.clone();
    for (k, _) in only.iter().enumerate().filter(|(_, x)| **x) {
        out.positions[k] = moved.positions[k];
        out.normals[k] = moved.normals[k];
    }
    out
}

/// Each vertex's normal averaged over the vertices welded to it, so a move along it keeps the
/// mesh closed.
fn welded_normals(m: &Mesh) -> Vec<V3> {
    let w = m.welded();
    let n = w.iter().max().map_or(0, |x| *x as usize + 1);
    let mut acc = vec![[0.0; 3]; n];
    for (k, id) in w.iter().enumerate() {
        acc[*id as usize] = add(acc[*id as usize], m.normals[k]);
    }
    w.iter().map(|id| unit(acc[*id as usize])).collect()
}

fn rotate(p: V3, axis: usize, a: f64) -> V3 {
    let (c, s) = (cos(a), sin(a));
    let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut q = p;
    q[i] = p[i] * c - p[j] * s;
    q[j] = p[i] * s + p[j] * c;
    q
}

const TAU: f64 = core::f64::consts::TAU;

/// Each modifier of `item` applied to `mesh` in its declared order at `t` seconds, with the
/// rows that say what each is; why one can't apply, by its path under the item.
pub fn apply(
    mesh: Mesh,
    item: &Value,
    doc: &Value,
    id: &str,
    t: f64,
    run: &Run,
) -> Result<(Mesh, Vec<Row>), Fault> {
    let mut m = if run.rotate > 0 {
        rotated(&mesh, run.rotate)
    } else {
        mesh
    };
    let mut rows = Vec::new();
    for (k, modifier) in list(item).iter().enumerate() {
        let kind = modifier
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let at = |f: &str| format!("modifiers/{k}/{f}");
        // A line's stroke modifiers (but `build`) are no builder's.
        let (class, gpu, timed) = kind_row(&kind)
            .filter(|_| kind == "mod.build@1" || !STROKE.contains(&kind.as_str()))
            .ok_or_else(|| at("kind"))?;
        let on = enabled(modifier);
        rows.push(Row {
            kind: kind.clone(),
            class,
            reads_time: timed || reads_time(doc, id, k),
            enabled: on,
            gpu,
            ms: (run.clock.is_some() && !on).then_some(0.0),
        });
        if !on {
            continue;
        }
        let started = run.clock.map(|now| now());
        let params = modifier.get("params").cloned().unwrap_or(json!({}));
        let part = modifier.get("on").and_then(Value::as_str).unwrap_or("all");
        // A generate step makes the mesh anew; only a deform moves part of it.
        if class == "generate" && part != "all" {
            return Err(at("on"));
        }
        let only = targets(&m, part).ok_or_else(|| at("on"))?;
        let num = |f: &str, d: f64| -> Result<f64, Fault> {
            match params.get(f) {
                None => Ok(d),
                Some(v) => v
                    .as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or_else(|| at(&format!("params/{f}"))),
            }
        };
        let seed = seed_of(id, modifier);
        let phase = (unit_noise(seed, 1) + 1.0) * core::f64::consts::PI;
        m = match kind.as_str() {
            "mod.array@1" => array(&m, modifier, &params, doc).ok_or_else(|| at("params"))?,
            "mod.mirror@1" => {
                let mut out = m;
                for axis in axes(modifier).ok_or_else(|| at("params/axes"))? {
                    let flip = |mut p: V3| {
                        p[axis] = -p[axis];
                        p
                    };
                    let reflected = out.mapped(flip, |_, n| flip(n)).turned();
                    let suffix = format!(".m{}", ["x", "y", "z"][axis]);
                    out.append(&reflected, &suffix);
                }
                out
            }
            "mod.subdivide@1" => {
                let n = levels(modifier).ok_or_else(|| at("params/levels"))?;
                subdivide(m, &params, n as u32, run).map_err(|f| at(&f))?
            }
            "mod.bevel@1" => bevel(m, &params, run).map_err(|f| at(&f))?,
            "mod.normals@1" => normals(m, &params, run).map_err(|f| at(&f))?,
            "mod.solidify@1" => {
                let h = num("thickness", 0.01)?;
                if h <= 0.0 {
                    return Err(at("params/thickness"));
                }
                solidify(&m, h)
            }
            "mod.build@1" => {
                let keep = kept(modifier, m.triangles() as u64).ok_or_else(|| at("params"))?;
                build(&m, &keep)
            }
            "mod.store@1" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|n| !n.is_empty())
                    .ok_or_else(|| at("params/name"))?;
                let field = params
                    .get("field")
                    .and_then(Value::as_str)
                    .unwrap_or("height");
                let mut out = m;
                match params
                    .get("domain")
                    .and_then(Value::as_str)
                    .unwrap_or("point")
                {
                    "point" => {
                        let values = field_of(&out, field).ok_or_else(|| at("params/field"))?;
                        out.attributes.insert(name.to_string(), values);
                    }
                    "face" => {
                        let values = face_field(&out, field).ok_or_else(|| at("params/field"))?;
                        out.face_attributes.insert(name.to_string(), values);
                    }
                    _ => return Err(at("params/domain")),
                }
                out
            }
            "mod.curve_deform@1" => {
                let curve = path(doc, params.get("path")).ok_or_else(|| at("params/path"))?;
                let axis = params
                    .get("axis")
                    .and_then(Value::as_str)
                    .map_or(Some(0), axis_of)
                    .ok_or_else(|| at("params/axis"))?;
                let bent = curve_deform(&m, &curve, axis);
                mask(&m, bent, &only)
            }
            "mod.simple_deform@1" => {
                let amount = params
                    .get("amount")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| at("params/amount"))?;
                let mode = params
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or("twist");
                match mode {
                    "twist" | "bend" | "taper" | "stretch" => {
                        mask(&m, simple_deform(&m, mode, amount), &only)
                    }
                    _ => return Err(at("params/mode")),
                }
            }
            "mod.displace@1" => {
                let amount = num("amount", 0.05)?;
                if params
                    .get("field")
                    .and_then(Value::as_str)
                    .unwrap_or("noise")
                    != "noise"
                {
                    return Err(at("params/field"));
                }
                let normals = welded_normals(&m);
                deform(
                    &m,
                    &only,
                    |p, k| add(p, scale(normals[k], amount * noise(seed, p))),
                    |n| n,
                )
            }
            "mod.sway@1" => {
                // The GPU keeps one sway per instance.
                if m.attributes.contains_key(SWAY_WEIGHTS) {
                    return Err(at("kind"));
                }
                let amount = num("amount", 0.1)?;
                let hz = num("hz", 0.4)?;
                let wind = params.get("wind").cloned().unwrap_or(json!({}));
                let w = |f: &str, d: f64| wind.get(f).and_then(Value::as_f64).unwrap_or(d);
                let (direction, speed) = (w("direction", 0.0), w("speed", 3.0));
                let gust = wind.get("gust").cloned().unwrap_or(json!({}));
                let g = |f: &str, d: f64| gust.get(f).and_then(Value::as_f64).unwrap_or(d);
                let (gscale, strength) = (g("scale", 20.0), g("strength", 0.5));
                if gscale <= 0.0 || !(0.0..=1.0).contains(&strength) {
                    return Err(at("params/wind/gust"));
                }
                let weights = match params
                    .get("weight")
                    .and_then(Value::as_str)
                    .unwrap_or("height")
                {
                    "height" => field_of(&m, "height").ok_or_else(|| at("params/weight"))?,
                    name => m
                        .attributes
                        .get(name)
                        .cloned()
                        .ok_or_else(|| at("params/weight"))?,
                };
                let weights = weights
                    .iter()
                    .zip(&only)
                    .map(|(w, on)| if *on { w.clamp(0.0, 1.0) } else { 0.0 })
                    .collect();
                let own = modifier.pointer("/params/seed").and_then(Value::as_u64);
                let mut out = m;
                out.attributes.insert(SWAY_WEIGHTS.into(), weights);
                out.sway = Some(Sway {
                    amount,
                    direction,
                    speed,
                    scale: gscale,
                    strength,
                    hz,
                    phase: (unit_noise(mix(own.unwrap_or(0)), 1) + 1.0) * core::f64::consts::PI,
                    weights: Vec::new(),
                });
                out
            }
            "mod.bob@1" => {
                let dy = num("amount", 0.05)? * sin(TAU * num("hz", 0.5)? * t + phase);
                deform(&m, &only, |p, _| [p[0], p[1] + dy, p[2]], |n| n)
            }
            "mod.wave@1" => {
                let (amount, length, speed) = (
                    num("amount", 0.05)?,
                    num("length", 1.0)?,
                    num("speed", 1.0)?,
                );
                if length <= 0.0 {
                    return Err(at("params/length"));
                }
                let dr = rad(num("direction", 0.0)?);
                let d = [cos(dr), 0.0, sin(dr)];
                deform(
                    &m,
                    &only,
                    |p, _| {
                        let along = p[0] * d[0] + p[2] * d[2];
                        let dy = amount * sin(TAU * (along - speed * t) / length);
                        [p[0], p[1] + dy, p[2]]
                    },
                    |n| n,
                )
            }
            "mod.spin@1" => {
                let axis = params
                    .get("axis")
                    .and_then(Value::as_str)
                    .map_or(Some(1), axis_of)
                    .ok_or_else(|| at("params/axis"))?;
                let a = rad(num("rate", 90.0)? * t);
                deform(&m, &only, |p, _| rotate(p, axis, a), |n| rotate(n, axis, a))
            }
            _ => return Err(at("kind")),
        };
        if let (Some(now), Some(started), Some(row)) = (run.clock, started, rows.last_mut()) {
            row.ms = Some(now() - started);
        }
    }
    if let Some(weights) = m.attributes.remove(SWAY_WEIGHTS) {
        let k = rows.iter().position(|r| r.kind == SWAY && r.enabled);
        if weights.len() != m.positions.len() {
            return Err(format!("modifiers/{}/kind", k.unwrap_or(0)));
        }
        if let Some(s) = m.sway.as_mut() {
            s.weights = weights;
        }
    }
    Ok((m, rows))
}

/// A per-vertex field: `height` (0 at the lowest point, 1 at the highest), `x`, `y`, `z`, or
/// `distance` from the item's origin.
fn field_of(m: &Mesh, field: &str) -> Option<Vec<f64>> {
    let [lo, hi] = m.bounds();
    Some(match field {
        "height" => {
            let span = (hi[1] - lo[1]).max(1e-12);
            m.positions
                .iter()
                .map(|p| ((p[1] - lo[1]) / span).clamp(0.0, 1.0))
                .collect()
        }
        "x" | "y" | "z" => {
            let a = axis_of(field)?;
            m.positions.iter().map(|p| p[a]).collect()
        }
        "distance" => m
            .positions
            .iter()
            .map(|p| crate::geom::length(*p))
            .collect(),
        // The geometry measures, read like attributes (#2015).
        _ => return crate::measures::point(m, field),
    })
}

/// `count` copies: `offset` apart, laid along a curve (`along`), or turned `around` an axis.
fn array(m: &Mesh, modifier: &Value, params: &Value, doc: &Value) -> Option<Mesh> {
    let count = array_count(modifier)?;
    let offset = match params.get("offset") {
        None => [0.0; 3],
        v => vec3(v)?,
    };
    let mut out = m.clone();
    if let Some(along) = params.get("along") {
        let curve = path(doc, Some(along))?;
        let step = match crate::geom::length(offset) {
            s if s > 0.0 => s,
            _ if count > 1 => curve.length() / (count - 1) as f64,
            _ => 0.0,
        };
        let start = curve.at(0.0).0;
        for c in 1..count {
            let shift = sub(curve.at(step * c as f64).0, start);
            out.append(&m.mapped(|p| add(p, shift), |_, n| n), &format!(".{c}"));
        }
    } else if let Some(around) = params.get("around") {
        let axis = around
            .get("axis")
            .and_then(Value::as_str)
            .map_or(Some(1), axis_of)?;
        let pivot = match around.get("pivot") {
            None => [0.0; 3],
            Some(Value::Number(n)) => [n.as_f64()?, 0.0, 0.0],
            v => vec3(v)?,
        };
        let angle = around.get("angle").map_or(Some(360.0), Value::as_f64)?;
        // A whole turn spaces its copies around it; a part turn ends on its last copy.
        let per = if (angle - 360.0).abs() < 1e-9 || count < 2 {
            angle / count as f64
        } else {
            angle / (count - 1) as f64
        };
        for c in 1..count {
            let a = rad(per * c as f64);
            let turned = m.mapped(
                |p| add(pivot, rotate(sub(p, pivot), axis, a)),
                |_, n| rotate(n, axis, a),
            );
            out.append(&turned, &format!(".{c}"));
        }
    } else {
        for c in 1..count {
            let shift = scale(offset, c as f64);
            out.append(&m.mapped(|p| add(p, shift), |_, n| n), &format!(".{c}"));
        }
    }
    Some(out)
}

/// The triangles `keep` names, every vertex kept (so the count stays the builder's); a closed
/// part stays closed only when all of it stays.
fn build(m: &Mesh, keep: &[u32]) -> Mesh {
    let mut out = m.clone();
    out.indices.clear();
    out.faces.clear();
    let mut at = vec![u32::MAX; m.triangles()];
    for (n, &t) in keep.iter().enumerate() {
        at[t as usize] = n as u32;
        out.indices
            .extend(&m.indices[3 * t as usize..3 * t as usize + 3]);
        out.faces.push(m.faces[t as usize]);
    }
    for (name, values) in &mut out.face_attributes {
        *values = keep
            .iter()
            .map(|&t| m.face_attributes[name][t as usize])
            .collect();
    }
    let remap = |tris: &Vec<u32>| -> Vec<u32> {
        tris.iter()
            .map(|t| at[*t as usize])
            .filter(|x| *x != u32::MAX)
            .collect()
    };
    out.parts = m.parts.iter().map(|(k, v)| (k.clone(), remap(v))).collect();
    out.closed = m
        .closed
        .iter()
        .filter(|(_, (v, _))| v.iter().all(|t| at[*t as usize] != u32::MAX))
        .map(|(k, (v, g))| (k.clone(), (remap(v), *g)))
        .collect();
    out
}

/// A triangle of `m` facing `n`.
fn facing(m: &mut Mesh, a: u32, b: u32, c: u32, n: V3, face: u32) {
    let [pa, pb, pc] = [a, b, c].map(|i| m.positions[i as usize]);
    if dot(cross(sub(pb, pa), sub(pc, pa)), n) < 0.0 {
        m.tri(a, c, b, face);
    } else {
        m.tri(a, b, c, face);
    }
}

/// A shell `h` thick: the mesh, its copy moved in along the welded normals and turned over, and
/// a rim along every open edge; each closed piece after is a closed part.
fn solidify(m: &Mesh, h: f64) -> Mesh {
    let normals = welded_normals(m);
    let w = m.welded();
    let mut out = m.clone();
    let mut inner = m.mapped(|p| p, |_, n| scale(n, -1.0)).turned();
    for (k, n) in normals.iter().enumerate() {
        inner.positions[k] = sub(m.positions[k], scale(*n, h));
    }
    inner.parts.clear();
    out.append(&inner, ".inner");
    // Each edge on welded points, with its two vertices and the triangle on it.
    type Uses = Vec<(usize, usize, usize)>;
    let mut uses: BTreeMap<(u32, u32), Uses> = BTreeMap::new();
    for t in 0..m.triangles() {
        for j in 0..3 {
            let (a, b) = (
                m.indices[3 * t + j] as usize,
                m.indices[3 * t + (j + 1) % 3] as usize,
            );
            uses.entry((w[a].min(w[b]), w[a].max(w[b])))
                .or_default()
                .push((a, b, t));
        }
    }
    let first = out.next_face();
    for (rim, list) in uses.values().filter(|l| l.len() == 1).enumerate() {
        let face = first + rim as u32;
        let (a, b, t) = list[0];
        let centre = scale(
            [0, 1, 2]
                .map(|j| m.positions[m.indices[3 * t + j] as usize])
                .into_iter()
                .fold([0.0; 3], add),
            1.0 / 3.0,
        );
        let outward = unit(sub(scale(add(m.positions[a], m.positions[b]), 0.5), centre));
        let base = out.positions.len() as u32;
        for c in [
            m.positions[a],
            m.positions[b],
            sub(m.positions[b], scale(normals[b], h)),
            sub(m.positions[a], scale(normals[a], h)),
        ] {
            out.vertex(c, outward);
        }
        facing(&mut out, base, base + 1, base + 2, outward, face);
        facing(&mut out, base, base + 2, base + 3, outward, face);
    }
    out.close_components();
    out
}

/// The mesh laid along the curve: its coordinate along `axis`, from its least, becomes arc
/// length, and the other two its offsets across the curve's frame.
fn curve_deform(m: &Mesh, curve: &crate::curve::Sampled, axis: usize) -> Mesh {
    let low = m.bounds()[0][axis];
    let (o1, o2) = ((axis + 1) % 3, (axis + 2) % 3);
    // The curve's own frames where it has them (curve@1's, rotation-minimizing), else up.
    let frame = |s: f64| -> (V3, V3, V3, V3) {
        let (c, t, own) = curve.framed(s);
        let up = if t[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        };
        let n = own.unwrap_or_else(|| unit(sub(up, scale(t, dot(up, t)))));
        (c, t, n, cross(t, n))
    };
    // Along x the frame's normal is the item's y and its binormal z; the other axes turn with it.
    let place = |p: V3| -> V3 {
        let (c, _, n, b) = frame(p[axis] - low);
        let (u, w) = if axis == 0 {
            (p[1], p[2])
        } else {
            (p[o1], p[o2])
        };
        add(c, add(scale(n, u), scale(b, w)))
    };
    m.mapped(place, |p, nrm| {
        let (_, t, n, b) = frame(p[axis] - low);
        let (u, w) = if axis == 0 {
            (nrm[1], nrm[2])
        } else {
            (nrm[o1], nrm[o2])
        };
        add(scale(t, nrm[axis]), add(scale(n, u), scale(b, w)))
    })
}

/// Twist about y, bend about z, taper across y or stretch along y, by `amount` (degrees per
/// metre for twist and bend, per metre for taper, a fraction for stretch).
fn simple_deform(m: &Mesh, mode: &str, amount: f64) -> Mesh {
    let f = |p: V3| -> V3 {
        match mode {
            "twist" => {
                let a = rad(amount * p[1]);
                [
                    p[0] * cos(a) - p[2] * sin(a),
                    p[1],
                    p[0] * sin(a) + p[2] * cos(a),
                ]
            }
            "bend" => {
                let a = rad(amount * p[0]);
                [
                    p[0] * cos(a) - p[1] * sin(a),
                    p[0] * sin(a) + p[1] * cos(a),
                    p[2],
                ]
            }
            "taper" => {
                let k = 1.0 + amount * p[1];
                [p[0] * k, p[1], p[2] * k]
            }
            _ => [p[0], p[1] * (1.0 + amount), p[2]],
        }
    };
    let mut out = m.mapped(f, |_, n| n);
    // Normals from the moved faces: flat per triangle, accumulated at shared vertices.
    let mut acc = vec![[0.0; 3]; out.positions.len()];
    for t in 0..out.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| out.indices[3 * t + j] as usize);
        let n = cross(
            sub(out.positions[b], out.positions[a]),
            sub(out.positions[c], out.positions[a]),
        );
        for v in [a, b, c] {
            acc[v] = add(acc[v], n);
        }
    }
    out.normals = acc.into_iter().map(unit).collect();
    out
}

/// The mesh with each face's corner list started `r` corners later (a proof surface's
/// `rotate_corners`), its corners' normals and uvs carried with them.
fn rotated(m: &Mesh, r: usize) -> Mesh {
    let mut p = Poly::of(m);
    let mut normals = Vec::with_capacity(p.faces.len());
    for f in 0..p.faces.len() {
        let k = r % p.faces[f].len();
        p.faces[f].rotate_left(k);
        p.vertex[f].rotate_left(k);
        if let Some(uv) = &mut p.uv {
            uv[f].rotate_left(k);
        }
        normals.push(p.vertex[f].iter().map(|&v| m.normals[v as usize]).collect());
    }
    let mut out = p.mesh(m, Some(&normals));
    keep_annotations(m, &mut out);
    out
}

/// What a builder annotated that a step leaves standing: anchors, values and the true shape.
fn keep_annotations(src: &Mesh, out: &mut Mesh) {
    out.anchors = src.anchors.clone();
    out.values = src.values.clone();
    out.true_shape = src.true_shape.clone();
    out.cage = src.cage.clone();
}

fn word<'a>(p: &'a Value, name: &str, default: &'a str, of: &[&str]) -> Result<&'a str, String> {
    let v = match p.get(name) {
        None => default,
        Some(v) => v.as_str().ok_or_else(|| format!("params/{name}"))?,
    };
    of.contains(&v)
        .then_some(v)
        .ok_or_else(|| format!("params/{name}"))
}

fn number(p: &Value, name: &str, default: f64, ok: impl Fn(f64) -> bool) -> Result<f64, String> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && ok(*x))
            .ok_or_else(|| format!("params/{name}")),
    }
}

fn truth(p: &Value, name: &str, default: bool) -> Result<bool, String> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v.as_bool().ok_or_else(|| format!("params/{name}")),
    }
}

fn scheme_of(p: &Value) -> Result<Scheme, String> {
    Ok(
        match word(
            p,
            "scheme",
            "catmull_clark",
            &["catmull_clark", "loop", "simple"],
        )? {
            "loop" => Scheme::Loop,
            "simple" => Scheme::Simple,
            _ => Scheme::CatmullClark,
        },
    )
}

/// The polygon view a subdivision refines: Loop's triangles, or the mesh's faces.
fn subdivision_view(m: &Mesh, scheme: Scheme) -> Poly {
    if scheme == Scheme::Loop {
        Poly::triangles_of(m)
    } else {
        Poly::of(m)
    }
}

/// Modifier: subdivide: `levels` of uniform refinement, creased where `creases` names a part (its
/// faces' edges, 0..1, 1 sharp at every level) or `crease_angle` finds an edge sharper, with the
/// boundary and uv rules; the mesh's quads before it are kept as its cage.
fn subdivide(m: Mesh, p: &Value, levels: u32, run: &Run) -> Result<Mesh, String> {
    let scheme = scheme_of(p)?;
    let boundary = match word(p, "boundary", "sharp_corners", &["smooth", "sharp_corners"])? {
        "smooth" => Boundary::Smooth,
        _ => Boundary::SharpCorners,
    };
    let uv = match word(
        p,
        "uv",
        "keep_corners",
        &["linear", "keep_corners", "smooth"],
    )? {
        "linear" => UvRule::Linear,
        "smooth" => UvRule::Smooth,
        _ => UvRule::KeepCorners,
    };
    let mut poly = subdivision_view(&m, scheme);
    let mut crease: BTreeMap<(u32, u32), f64> = BTreeMap::new();
    if let Some(c) = p.get("creases") {
        let c = c.as_object().ok_or("params/creases")?;
        for (name, w) in c {
            let w = w
                .as_f64()
                .filter(|w| (0.0..=1.0).contains(w))
                .ok_or("params/creases")?;
            let tris: std::collections::BTreeSet<u32> = m
                .parts
                .get(name)
                .or_else(|| m.closed.get(name).map(|c| &c.0))
                .ok_or("params/creases")?
                .iter()
                .copied()
                .collect();
            for (f, face) in poly.faces.iter().enumerate() {
                if tris.contains(&poly.origin[f]) {
                    for k in 0..face.len() {
                        let e = crate::poly::key(face[k], face[(k + 1) % face.len()]);
                        let s = crease.entry(e).or_insert(0.0);
                        *s = s.max(w);
                    }
                }
            }
        }
    }
    if let Some(a) = p.get("crease_angle") {
        let a = a
            .as_f64()
            .filter(|a| (0.0..=180.0).contains(a))
            .ok_or("params/crease_angle")?;
        for (e, faces) in poly.edges() {
            if poly.dihedral(&faces) > a {
                crease.insert(e, 1.0);
            }
        }
    }
    // A crease of c is sharp for 10 c² levels, so 1 stays sharp at every level.
    poly.sharp = crease
        .into_iter()
        .filter(|(_, c)| *c > 0.0)
        .map(|(e, c)| (e, 10.0 * c * c))
        .collect();
    let cage = m.cage.clone().unwrap_or_else(|| m.edges(false, true));
    let plants = crate::poly::Plants {
        first_corner_order: run.planted("subdivide_first_corner"),
    };
    let out = poly.subdivided(levels, scheme, boundary, uv, plants, run.blocks());
    let mut mesh = out.mesh(&m, None);
    mesh.cage = Some(cage);
    Ok(mesh)
}

/// A bevel's params.
fn bevel_of(p: &Value) -> Result<(crate::bevel::Bevel, Vec<String>), String> {
    let width = number(p, "width", 0.02, |w| w > 0.0)?;
    let segments = match p.get("segments") {
        None => 1,
        Some(v) => v
            .as_u64()
            .filter(|s| (1..=8).contains(s))
            .ok_or("params/segments")? as usize,
    };
    let shape = number(p, "shape", 0.5, |s| (0.0..=1.0).contains(&s))?;
    let angle = number(p, "angle", 30.0, |a| (0.0..=180.0).contains(&a))?;
    let parts: Vec<String> = match p.get("parts") {
        None => Vec::new(),
        Some(v) => v
            .as_array()
            .and_then(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect())
            .ok_or("params/parts")?,
    };
    let limit = match word(p, "limit", "angle", &["angle", "parts", "all"])? {
        "parts" => crate::bevel::Limit::Parts((0..parts.len() as u32).collect()),
        "all" => crate::bevel::Limit::All,
        _ => crate::bevel::Limit::Angle(angle),
    };
    Ok((
        crate::bevel::Bevel {
            width,
            segments,
            shape,
            limit,
            clamp: truth(p, "clamp", true)?,
            harden: truth(p, "harden", true)?,
        },
        parts,
    ))
}

/// The bevel of `m`'s polygon view, each face's place in `parts` known from its origin.
fn beveled(m: &Mesh, p: &Value) -> Result<(Poly, crate::bevel::Beveled), String> {
    let (b, parts) = bevel_of(p)?;
    let poly = Poly::of(m);
    let part_of: Vec<Option<u32>> = poly
        .origin
        .iter()
        .map(|o| {
            parts
                .iter()
                .position(|name| m.parts.get(name).is_some_and(|t| t.contains(o)))
                .map(|k| k as u32)
        })
        .collect();
    let out = crate::bevel::bevel(&poly, &b, &part_of);
    Ok((poly, out))
}

/// Modifier: bevel, on the polygon view; its own faces are weak.
fn bevel(m: Mesh, p: &Value, run: &Run) -> Result<Mesh, String> {
    let (_, b) = beveled(&m, p)?;
    let mut poly = b.poly;
    poly.weak = b.weak;
    let mut out = poly.mesh(&m, b.normals.as_deref());
    out.cage = m.cage.clone();
    // #440's planted bevels: one that drops its own faces' face attributes, one that leaves them
    // out of every part.
    if run.planted("bevel_drops_wear") {
        for values in out.face_attributes.values_mut() {
            for (t, v) in values.iter_mut().enumerate() {
                if out.weak[t] {
                    *v = f64::NAN;
                }
            }
        }
    }
    if run.planted("bevel_faces_unparted") {
        let weak = out.weak.clone();
        for tris in out.parts.values_mut() {
            tris.retain(|t| !weak[*t as usize]);
        }
    }
    Ok(out)
}

/// Modifier: normals: corner normals only; nothing moves.
fn normals(m: Mesh, p: &Value, run: &Run) -> Result<Mesh, String> {
    let by_angle = word(p, "mode", "weighted", &["weighted", "by_angle"])? == "by_angle";
    let weight = word(p, "weight", "area", &["area", "angle", "both"])?;
    let opts = crate::bevel::Normals {
        by_angle,
        angle: number(p, "angle", 30.0, |a| (0.0..=180.0).contains(&a))?,
        area: weight != "angle",
        corner_angle: weight != "area",
        keep_sharp: truth(p, "keep_sharp", true)?,
    };
    let w = m.welded();
    let poly = Poly::of_welded(&m, &w);
    // Only keep_sharp reads the edges the mesh already shades sharp.
    let sharp = if opts.keep_sharp && !opts.by_angle {
        shaded_sharp(&m, &w)
    } else {
        Vec::new()
    };
    let n = crate::bevel::normals_sorted(&poly, &opts, &poly.weak, &sharp, run.blocks());
    let mut out = poly.mesh_flat(&m, &n);
    keep_annotations(&m, &mut out);
    Ok(out)
}

/// Each edge of `m`'s triangles on its welded points `w`, by its sorted ends in that order, and
/// whether the mesh shades it sharp: two of its corners at one point have normals more than 1e-6
/// apart.
fn shaded_sharp(m: &Mesh, w: &[u32]) -> Vec<((u32, u32), bool)> {
    // Triangle edge i's two vertices, and their welded points.
    let ends = |i: u32| {
        let i = i as usize;
        (
            m.indices[i] as usize,
            m.indices[i - i % 3 + (i + 1) % 3] as usize,
        )
    };
    let welded: Vec<(u32, u32)> = (0..3 * m.triangles() as u32)
        .map(|i| {
            let (a, b) = ends(i);
            (w[a], w[b])
        })
        .collect();
    let edge = |i: u32| {
        let (a, b) = welded[i as usize];
        crate::poly::key(a, b)
    };
    let points = w.iter().max().map_or(0, |x| *x as usize + 1);
    let order = crate::poly::by_ends(welded.len(), points, |i| welded[i as usize]);
    // Each edge's run of triangle edges in `order`, read once.
    let mut out = Vec::new();
    let mut start = 0;
    while start < order.len() {
        let e = edge(order[start]);
        let mut end = start + 1;
        while end < order.len() && edge(order[end]) == e {
            end += 1;
        }
        // The run's corners (two per triangle edge): each one's welded point and normal.
        let run = &order[start..end];
        let corner = |j: usize| {
            let i = run[j / 2];
            let (a, b) = ends(i);
            let (wa, wb) = welded[i as usize];
            if j.is_multiple_of(2) {
                (wa, m.normals[a])
            } else {
                (wb, m.normals[b])
            }
        };
        let n = 2 * run.len();
        let split = (0..n).any(|x| {
            let (u, p) = corner(x);
            (x + 1..n).any(|y| {
                let (v, q) = corner(y);
                u == v && crate::geom::length(sub(p, q)) > 1e-6
            })
        });
        out.push((e, split));
        start = end;
    }
    out
}

/// A per-face field, one value per triangle, read at each face's centroid (the mean of its
/// distinct welded points): `height`, `x`, `y`, `z` or `distance` from the item's origin.
fn face_field(m: &Mesh, field: &str) -> Option<Vec<f64>> {
    // The geometry measures, read like attributes (#2015).
    if let Some(values) = crate::measures::face(m, field) {
        return Some(values);
    }
    let w = m.welded();
    let mut points: BTreeMap<u32, BTreeMap<u32, V3>> = BTreeMap::new();
    for t in 0..m.triangles() {
        for j in 0..3 {
            let v = m.indices[3 * t + j] as usize;
            points
                .entry(m.faces[t])
                .or_default()
                .insert(w[v], m.positions[v]);
        }
    }
    let [lo, hi] = m.bounds();
    let centre: BTreeMap<u32, V3> = points
        .into_iter()
        .map(|(f, ps)| {
            let n = ps.len() as f64;
            (f, scale(ps.into_values().fold([0.0; 3], add), 1.0 / n))
        })
        .collect();
    (0..m.triangles())
        .map(|t| {
            let c = centre[&m.faces[t]];
            Some(match field {
                "height" => ((c[1] - lo[1]) / (hi[1] - lo[1]).max(1e-12)).clamp(0.0, 1.0),
                "x" | "y" | "z" => c[axis_of(field)?],
                "distance" => crate::geom::length(c),
                _ => return None,
            })
        })
        .collect()
}

/// A mesh's welded points, edges and faces: its polygon view's.
pub fn welded(m: &Mesh) -> [u64; 3] {
    let (p, e, f, _) = topology(&Poly::of(m));
    [p, e, f]
}

/// The welded points, edges, faces and corners of a polygon view.
fn topology(p: &Poly) -> (u64, u64, u64, u64) {
    (
        p.points.len() as u64,
        p.edges().len() as u64,
        p.faces.len() as u64,
        p.corners() as u64,
    )
}

/// What a stack declares before it builds: the vertices it leaves, and its welded points, edges
/// and faces.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Declared {
    pub vertices: u64,
    pub welded: Option<[u64; 3]>,
}

/// The vertices (and welded counts) the stack leaves of a builder's `(vertices, triangles)`,
/// counted from the params: array and mirror multiply, subdivide counts by the design's formulas
/// from the polygon view of the mesh it takes, normals leaves one vertex per corner, bevel counts
/// the faces it makes on the mesh it takes; `before(k)` is the mesh modifier `k` takes.
pub fn estimate(
    counts: (u64, u64),
    item: &Value,
    before: &dyn Fn(usize) -> Result<Mesh, Fault>,
) -> Result<Declared, Fault> {
    let (mut v, mut t) = counts;
    let mut topo: Option<(u64, u64, u64, u64)> = None;
    let list = list(item);
    for (k, m) in list.iter().enumerate() {
        if !enabled(m) {
            continue;
        }
        let at = |f: &str| format!("modifiers/{k}/params/{f}");
        let params = m.get("params").cloned().unwrap_or(json!({}));
        let view = |scheme: Scheme| -> Result<(u64, u64, u64, u64), Fault> {
            Ok(topology(&subdivision_view(&before(k)?, scheme)))
        };
        match m.get("kind").and_then(Value::as_str).unwrap_or("") {
            "mod.array@1" => {
                let c = array_count(m).ok_or_else(|| at("count"))?;
                (v, t) = (v * c, t * c);
                topo = topo.map(|(a, b, f, d)| (a * c, b * c, f * c, d * c));
            }
            "mod.mirror@1" => {
                let a = axes(m).ok_or_else(|| at("axes"))?.len();
                (v, t) = (v << a, t << a);
                topo = None;
            }
            "mod.subdivide@1" => {
                let scheme = scheme_of(&params).map_err(|_| at("scheme"))?;
                let mut c = match (topo, scheme) {
                    (Some(c), Scheme::CatmullClark | Scheme::Simple) => c,
                    _ => view(scheme)?,
                };
                for _ in 0..levels(m).ok_or_else(|| at("levels"))? {
                    c = crate::poly::counts(scheme, c);
                }
                v = c.3;
                t = if scheme == Scheme::Loop { c.2 } else { 2 * c.2 };
                topo = Some(c);
            }
            "mod.bevel@1" => {
                let (_, b) =
                    beveled(&before(k)?, &params).map_err(|f| format!("modifiers/{k}/{f}"))?;
                let c = topology(&b.poly);
                v = c.3;
                t = b.poly.faces.iter().map(|f| f.len() as u64 - 2).sum();
                topo = Some(c);
            }
            "mod.normals@1" => {
                let c = match topo {
                    Some(c) => c,
                    None => view(Scheme::CatmullClark)?,
                };
                v = c.3;
                topo = Some(c);
            }
            "mod.build@1" => {
                t = kept(m, t).ok_or_else(|| at("from"))?.len() as u64;
                topo = None;
            }
            "mod.solidify@1" => {
                let after = before(k + 1)?;
                (v, t) = (after.positions.len() as u64, after.triangles() as u64);
                topo = None;
            }
            _ => {}
        }
    }
    let (a, b, c, _) = match topo {
        Some(c) => c,
        None => topology(&Poly::of(&before(list.len())?)),
    };
    Ok(Declared {
        vertices: v,
        welded: Some([a, b, c]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builders::{self, Ctx};

    fn box_mesh() -> Mesh {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            id: "it",
            doc: &doc,
            plants: Default::default(),
            outlines: &[],
            planted: None,
        };
        builders::build("slab@1", &json!({"size": [1, 1, 1]}), &ctx).unwrap()
    }

    fn plate() -> Mesh {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            id: "it",
            doc: &doc,
            plants: Default::default(),
            outlines: &[],
            planted: None,
        };
        builders::build("plate@1", &json!({"grid": [2, 2], "size": [1, 1]}), &ctx).unwrap()
    }

    fn run(m: Mesh, modifiers: Value, t: f64) -> Mesh {
        let item = json!({"modifiers": modifiers});
        apply(m, &item, &json!({"items": {}}), "it", t, &Run::default())
            .unwrap()
            .0
    }

    /// Every closed part's welded V − E + F, with its open edges: what `close_components` and
    /// a watertight build agree on.
    fn euler(m: &Mesh) -> Vec<(i64, usize, u32)> {
        let w = m.welded();
        m.closed
            .values()
            .map(|(tris, g)| {
                let mut edges: BTreeMap<(u32, u32), u32> = BTreeMap::new();
                let mut verts = std::collections::BTreeSet::new();
                for &t in tris {
                    let v = [0, 1, 2].map(|j| w[m.indices[3 * t as usize + j] as usize]);
                    for j in 0..3 {
                        let (a, b) = (v[j], v[(j + 1) % 3]);
                        verts.insert(a);
                        *edges.entry((a.min(b), a.max(b))).or_default() += 1;
                    }
                }
                let open = edges.values().filter(|c| **c != 2).count();
                (
                    verts.len() as i64 - edges.len() as i64 + tris.len() as i64,
                    open,
                    *g,
                )
            })
            .collect()
    }

    fn declared(modifiers: Value, base: &Mesh) -> u64 {
        let item = json!({"modifiers": modifiers});
        let before = |k: usize| -> Result<Mesh, Fault> {
            Ok(apply(
                base.clone(),
                &prefix(&item, k),
                &json!({"items": {}}),
                "it",
                0.0,
                &Run::default(),
            )?
            .0)
        };
        estimate(
            (base.positions.len() as u64, base.triangles() as u64),
            &item,
            &before,
        )
        .unwrap()
        .vertices
    }

    #[test]
    fn subdivide_splits_each_triangle_in_four_and_keeps_the_box_closed() {
        let m = run(
            box_mesh(),
            json!([{"kind": "mod.subdivide@1", "params": {"levels": 2}}]),
            0.0,
        );
        assert_eq!(m.triangles(), 12 * 16);
        assert_eq!(
            m.positions.len() as u64,
            declared(
                json!([{"kind": "mod.subdivide@1", "params": {"levels": 2}}]),
                &box_mesh()
            )
        );
        assert_eq!(euler(&m), vec![(2, 0, 0)]);
    }

    #[test]
    fn bevel_chamfers_a_box_closed_with_its_count_declared() {
        for segments in [1, 3] {
            let mods =
                json!([{"kind": "mod.bevel@1", "params": {"width": 0.1, "segments": segments}}]);
            let m = run(box_mesh(), mods.clone(), 0.0);
            assert_eq!(m.positions.len() as u64, declared(mods, &box_mesh()));
            assert_eq!(euler(&m), vec![(2, 0, 0)], "segments {segments}");
            // The corners are cut: no point stays at a cube's corner.
            assert!(m.positions.iter().all(|p| !(p[0].abs() > 0.4999
                && (p[1] - 0.5).abs() > 0.4999
                && p[2].abs() > 0.4999)));
            let vol = m.closed.values().map(|(t, _)| m.volume(t)).sum::<f64>();
            assert!(vol < 1.0 && vol > 0.9, "{vol}");
        }
    }

    #[test]
    fn solidify_closes_an_open_plate_into_one_shell() {
        let mods = json!([{"kind": "mod.solidify@1", "params": {"thickness": 0.1}}]);
        let m = run(plate(), mods.clone(), 0.0);
        assert_eq!(euler(&m), vec![(2, 0, 0)]);
        assert_eq!(m.positions.len() as u64, declared(mods, &plate()));
        let vol: f64 = m.closed.values().map(|(t, _)| m.volume(t)).sum();
        assert!((vol.abs() - 0.1).abs() < 1e-9, "{vol}");
    }

    #[test]
    fn build_keeps_its_fraction_of_triangles_in_order_or_seeded() {
        let half = run(
            box_mesh(),
            json!([{"kind": "mod.build@1", "params": {"from": 0, "to": 0.5}}]),
            0.0,
        );
        assert_eq!(half.triangles(), 6);
        assert_eq!(&half.indices[..], &box_mesh().indices[..18]);
        assert!(half.closed.is_empty());
        let seeded = run(
            box_mesh(),
            json!([{"kind": "mod.build@1", "params": {"to": 0.5, "order": "seeded", "seed": 3}}]),
            0.0,
        );
        assert_eq!(seeded.triangles(), 6);
        assert_ne!(seeded.indices, half.indices);
    }

    #[test]
    fn store_keeps_a_height_field_that_sway_reads_by_name() {
        let mods = json!([
            {"kind": "mod.store@1", "params": {"name": "wind", "field": "height"}},
            {"kind": "mod.sway@1", "params": {"amount": 0.2, "weight": "wind", "hz": 1.0}}
        ]);
        let base = box_mesh();
        let at = |t: f64| run(base.clone(), mods.clone(), t);
        let m = at(0.3);
        assert_eq!(m.attributes["wind"].len(), m.positions.len());
        // The sway moves nothing at build (#2016): it keeps the stored field as its weights, the
        // foot's 0 and the top's 1, for the GPU to move by at each frame, and no t changes it.
        let sway = m.sway.as_ref().expect("a sway");
        assert_eq!(m.positions, base.positions);
        assert_eq!(sway.weights, m.attributes["wind"]);
        for (k, p) in base.positions.iter().enumerate() {
            assert_eq!(sway.weights[k], if p[1] < 1e-9 { 0.0 } else { 1.0 });
        }
        assert_eq!((sway.amount, sway.hz), (0.2, 1.0));
        assert_eq!(at(0.7), m);
        let rows = apply(
            base.clone(),
            &json!({"modifiers": mods}),
            &json!({}),
            "it",
            0.0,
            &Run::default(),
        )
        .unwrap()
        .1;
        assert_eq!(
            rows.iter()
                .map(|r| (r.reads_time, r.gpu))
                .collect::<Vec<_>>(),
            vec![(false, false), (true, true)]
        );
    }

    #[test]
    fn displace_moves_welded_points_together_so_the_box_stays_closed() {
        let a = run(
            box_mesh(),
            json!([{"kind": "mod.displace@1", "params": {"amount": 0.05, "seed": 1}}]),
            0.0,
        );
        assert_eq!(euler(&a), vec![(2, 0, 0)]);
        assert_ne!(a.positions, box_mesh().positions);
        let b = run(
            box_mesh(),
            json!([{"kind": "mod.displace@1", "params": {"amount": 0.05, "seed": 2}}]),
            0.0,
        );
        assert_ne!(a.positions, b.positions);
    }

    #[test]
    fn bob_wave_and_spin_are_closed_forms_in_t() {
        for kind in ["mod.bob@1", "mod.wave@1", "mod.spin@1"] {
            let mods = json!([{"kind": kind, "params": {}}]);
            let at = |t: f64| run(box_mesh(), mods.clone(), t).positions;
            assert_eq!(at(0.25), at(0.25), "{kind}");
            assert_ne!(at(0.25), at(0.5), "{kind}");
        }
        // A quarter turn at 90 deg/s after 1 s.
        let p = run(
            box_mesh(),
            json!([{"kind": "mod.spin@1", "params": {"rate": 90}}]),
            1.0,
        );
        for (q, r) in p.positions.iter().zip(&box_mesh().positions) {
            assert!(
                (q[1] - r[1]).abs() < 1e-12
                    && (q[0] - r[2]).abs() < 1e-9
                    && (q[2] + r[0]).abs() < 1e-9
            );
        }
    }

    #[test]
    fn array_fits_lays_along_and_turns_around_with_exact_counts() {
        let doc = json!({"items": {"rail": {"kind": "curve@1", "params": {"points": [[0, 0, 0], [4, 0, 0]]}}}});
        let base = box_mesh();
        for (params, copies) in [
            (json!({"fit": 3, "offset": [1, 0, 0]}), 4),
            (json!({"count": 3, "along": "rail"}), 3),
            (
                json!({"count": 4, "around": {"axis": "y", "pivot": [2, 0, 0]}}),
                4,
            ),
        ] {
            let item = json!({"modifiers": [{"kind": "mod.array@1", "params": params}]});
            let m = apply(base.clone(), &item, &doc, "it", 0.0, &Run::default())
                .unwrap()
                .0;
            assert_eq!(m.positions.len(), copies * base.positions.len(), "{params}");
            let before = |k: usize| -> Result<Mesh, Fault> {
                Ok(apply(
                    base.clone(),
                    &prefix(&item, k),
                    &doc,
                    "it",
                    0.0,
                    &Run::default(),
                )?
                .0)
            };
            let n = estimate(
                (base.positions.len() as u64, base.triangles() as u64),
                &item,
                &before,
            )
            .unwrap()
            .vertices;
            assert_eq!(n as usize, m.positions.len(), "{params}");
        }
        let along = apply(base.clone(), &json!({"modifiers": [{"kind": "mod.array@1", "params": {"count": 3, "along": "rail"}}]}), &doc, "it", 0.0, &Run::default()).unwrap().0;
        assert!((along.bounds()[1][0] - 4.5).abs() < 1e-9);
    }

    #[test]
    fn a_deform_on_a_part_moves_only_that_part() {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            id: "it",
            doc: &doc,
            plants: Default::default(),
            outlines: &[],
            planted: None,
        };
        let d = builders::build("display@1", &json!({"size": [0.6, 0.4]}), &ctx).unwrap();
        let m = run(
            d.clone(),
            json!([{"kind": "mod.bob@1", "on": "screen", "params": {"amount": 0.1, "hz": 1}}]),
            0.25,
        );
        let idx = &d.indices;
        let screen: std::collections::BTreeSet<u32> = d.parts["screen"]
            .iter()
            .flat_map(|t| (0..3).map(move |j| idx[3 * *t as usize + j]))
            .collect();
        for k in 0..d.positions.len() {
            assert_eq!(
                m.positions[k] == d.positions[k],
                !screen.contains(&(k as u32)),
                "vertex {k}"
            );
        }
        let item = json!({"modifiers": [{"kind": "mod.subdivide@1", "on": "screen"}]});
        assert!(apply(d, &item, &doc, "it", 0.0, &Run::default()).is_err());
    }
}
