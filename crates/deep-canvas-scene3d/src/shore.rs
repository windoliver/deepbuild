//! Material: water's shore (#268): a water material names static items as its shore, and the core
//! bakes at check, on the CPU in f64, a field over the water's plate at `cell`: in each cell the
//! distance in the water's plane at rest to the nearest outline where an item meets that plane,
//! and how far the cell lies inside or outside the footprint of what of them stands above it. The
//! field is keyed by the items' content and transforms, baked once per key, never per frame. The
//! renderer reads it for a foam band, calmer waves near the items and shade under them.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::scene::{Layer3, Refused, Shape, Solid};

/// The most cells a field holds along each side.
pub const MAX_SIDE: u64 = 2048;
/// How far past its zero the footprint's signed distance is kept, in cells: only its sign and
/// where it crosses zero are read.
const COVER_REACH: f64 = 2.0;

/// A water's `shore`, as parsed, with its field once baked.
#[derive(Clone, Debug, PartialEq)]
pub struct Shore {
    /// The collection naming the items.
    pub collection: String,
    pub cell: f64,
    pub width: f64,
    pub strength: f64,
    pub breakup: f64,
    pub near: f64,
    pub far: f64,
    pub shade: f64,
    pub field: Option<Arc<Field>>,
}

/// The baked field over the water's plate.
#[derive(Debug, PartialEq)]
pub struct Field {
    /// SHA-256 of what it's baked from: the plate, the cell, and each item's shape and transform.
    pub key: String,
    /// World x and z of cell (0, 0)'s corner, the cell's side in m, and how many cells along x and z.
    pub origin: [f64; 2],
    pub cell: f64,
    pub dims: [u32; 2],
    /// The water's plane at rest, world y.
    pub level: f64,
    /// The distance to an outline is kept up to `reach` m; past it nothing reads it.
    pub reach: f64,
    /// Each cell's two values, rows along z, packed as the renderer reads them: the low 16 bits
    /// the outline's distance over `reach`, the high 16 the footprint's signed distance over
    /// [`COVER_REACH`] cells, offset by half (below half is inside).
    pub cells: Vec<u32>,
    /// How long the bake took, ms: a reading, not part of the field.
    pub bake_ms: f64,
}

impl Field {
    /// How far past its zero the footprint's signed distance is kept, in m.
    pub fn cover_reach(&self) -> f64 {
        COVER_REACH * self.cell
    }

    /// Cell (i, j)'s outline distance in m and footprint signed distance in m (negative inside).
    pub fn at(&self, i: u32, j: u32) -> (f64, f64) {
        let v = self.cells[(j * self.dims[0] + i) as usize];
        let d = f64::from(v & 0xffff) / 65535.0 * self.reach;
        let c = (f64::from(v >> 16) / 65535.0 - 0.5) * 2.0 * COVER_REACH * self.cell;
        (d, c)
    }
}

fn bad(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Reads `shore` at `items/<material>/params/water/shore`: `None` for none.
pub fn parse(material: &str, spec: Option<&Value>) -> Result<Option<Shore>, Refused> {
    let at = |k: &str| format!("items/{material}/params/water/shore/{k}");
    let spec = match spec {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if s == "none" => return Ok(None),
        Some(s @ Value::Object(_)) => s,
        Some(_) => {
            return Err(bad(
                "out_of_range",
                at("").trim_end_matches('/').to_string(),
            ))
        }
    };
    let num = |v: Option<&Value>, k: &str, default: f64, range: [f64; 2]| -> Result<f64, Refused> {
        match v {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
                .ok_or_else(|| bad("out_of_range", at(k))),
        }
    };
    let collection = spec
        .get("items")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("bad_input", at("items")))?;
    let foam = spec.get("foam");
    let calm = spec.get("calm");
    Ok(Some(Shore {
        collection: collection.to_string(),
        cell: num(spec.get("cell"), "cell", 0.1, [1e-3, 1e3])?,
        width: num(
            foam.and_then(|f| f.get("width")),
            "foam/width",
            0.5,
            [0.0, 1e3],
        )?,
        strength: num(
            foam.and_then(|f| f.get("strength")),
            "foam/strength",
            1.0,
            [0.0, 1.0],
        )?,
        breakup: num(
            foam.and_then(|f| f.get("breakup")),
            "foam/breakup",
            0.5,
            [0.0, 1.0],
        )?,
        near: num(
            calm.and_then(|c| c.get("near")),
            "calm/near",
            0.25,
            [0.0, 1.0],
        )?,
        far: num(
            calm.and_then(|c| c.get("far")),
            "calm/far",
            20.0,
            [1e-3, 1e4],
        )?,
        shade: num(spec.get("shade"), "shade", 0.0, [0.0, 1.0])?,
        field: None,
    }))
}

/// The collection's members; an unknown collection is `ref_unresolved` at the shore's `items`.
fn members<'a>(
    doc: &'a Map<String, Value>,
    material: &str,
    collection: &str,
) -> Result<BTreeSet<&'a str>, Refused> {
    doc.get("collections")
        .and_then(|c| c.get(collection))
        .and_then(|c| c.get("members"))
        .and_then(Value::as_array)
        .map(|m| m.iter().filter_map(Value::as_str).collect())
        .ok_or_else(|| {
            bad(
                "ref_unresolved",
                format!("items/{material}/params/water/shore/items"),
            )
        })
}

/// `id` and its parents, nearest first (a part `owner#part` starts at its owner).
fn chain<'a>(items: Option<&'a Map<String, Value>>, id: &'a str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut at = id.split('#').next();
    while let Some(i) = at.filter(|i| !out.contains(i) && out.len() < 4096) {
        out.push(i);
        at = items
            .and_then(|m| m.get(i))
            .and_then(|item| item.get("parent"))
            .and_then(Value::as_str);
    }
    out
}

/// Whether a path a channel, driver or clip writes moves or reshapes item `id`: its transform or
/// its params, other than its paint.
fn moves(path: &str, id: &str) -> bool {
    let Some(rest) = path.strip_prefix(&format!("items/{id}/")) else {
        return false;
    };
    rest.starts_with("at/")
        || rest == "at"
        || (rest.starts_with("params") && !rest.starts_with("params/paint"))
}

/// A shore item that a channel, driver, constraint, clip, physics or logic moves or reshapes
/// during the document's span is refused at check, naming it: the field is baked once and never
/// follows a move. An item moves with every parent it has.
pub fn static_items(doc: &Map<String, Value>) -> Result<(), Refused> {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    for (material, item) in items {
        let Some(collection) = item
            .pointer("/params/water/shore/items")
            .and_then(Value::as_str)
        else {
            continue;
        };
        let Ok(set) = members(doc, material, collection) else {
            continue;
        };
        if let Some(member) = moving_member(doc, set) {
            return Err(bad(
                "out_of_range",
                format!("items/{member}: a shore item of material {material} moves or reshapes during the span"),
            ));
        }
    }
    Ok(())
}

/// The first of `members` that a channel, driver, constraint, clip, physics or logic moves or
/// reshapes during the document's span, with every parent it has (#449's landing map reads only
/// static items, as a shore's field does).
pub fn moving_member<'a>(
    doc: &Map<String, Value>,
    members: impl IntoIterator<Item = &'a str>,
) -> Option<&'a str> {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let section = |k: &str| -> Vec<(&String, &Value)> {
        doc.get(k)
            .and_then(Value::as_object)
            .map(|m| m.iter().collect())
            .unwrap_or_default()
    };
    let target = |v: &Value| {
        v.get("target")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    // Every path written over the span: channels, drivers, and each clip's channels, a slot's
    // through the items its placements bind to it.
    let mut written: Vec<String> = section("channels").iter().map(|(_, c)| target(c)).collect();
    written.extend(section("drivers").iter().map(|(_, d)| target(d)));
    let mut slots: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (_, p) in section("placements") {
        for (slot, bound) in p
            .get("slots")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let list: Vec<&str> = match bound {
                Value::Array(l) => l.iter().filter_map(Value::as_str).collect(),
                one => one.as_str().into_iter().collect(),
            };
            slots.entry(slot.as_str()).or_default().extend(list);
        }
    }
    for (_, clip) in section("clips") {
        for (_, ch) in clip
            .get("channels")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let t = target(ch);
            match t.strip_prefix("slot:").and_then(|s| s.split_once('/')) {
                Some((slot, param)) => {
                    for item in slots.get(slot).into_iter().flatten() {
                        written.push(format!("items/{item}/{param}"));
                    }
                }
                None => written.push(t),
            }
        }
    }
    // Constraints move their owner (a limit only bounds what else moves it).
    let constrained: BTreeSet<&str> = section("constraints")
        .iter()
        .filter(|(_, c)| c.get("kind").and_then(Value::as_str) != Some("limit"))
        .filter_map(|(_, c)| c.get("owner").and_then(Value::as_str))
        .collect();
    let kind = |id: &str| {
        items
            .get(id)
            .and_then(|i| i.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("")
    };
    // Simulated, or placed or shaped by a logic array its params read (an instancer's or a mark
    // set's logic columns).
    let simulated = |id: &str| {
        let k = kind(id);
        k.starts_with("physics")
            || k.starts_with("fixture.world")
            || k.starts_with("logic")
            || items
                .get(id)
                .and_then(|i| i.get("params"))
                .is_some_and(|p| reads_logic(p, &|owner| kind(owner).starts_with("logic")))
    };
    members.into_iter().find(|member| {
        let line = chain(Some(items), member);
        let moved = line.iter().any(|c| {
            constrained.contains(c) || simulated(c) || written.iter().any(|w| moves(w, c))
        });
        moved || member.contains('#') && simulated(member.split('#').next().unwrap_or(""))
    })
}

/// Whether `v` holds an `{array: "<item>.<name>"}` whose item `is_logic` says is a logic item.
fn reads_logic(v: &Value, is_logic: &dyn Fn(&str) -> bool) -> bool {
    match v {
        Value::Object(m) => {
            m.get("array")
                .and_then(Value::as_str)
                .and_then(|a| a.split_once('.'))
                .is_some_and(|(owner, _)| is_logic(owner))
                || m.values().any(|x| reads_logic(x, is_logic))
        }
        Value::Array(a) => a.iter().any(|x| reads_logic(x, is_logic)),
        _ => false,
    }
}

/// A unit primitive's triangles, as the renderer draws it: 1 m across about the origin, a
/// cylinder about +Y in 48 segments and a sphere in 24 rings of 48.
fn primitive(shape: Shape) -> (Vec<[f64; 3]>, Vec<u32>) {
    use std::f64::consts::{PI, TAU};
    let (mut p, mut i) = (Vec::new(), Vec::new());
    match shape {
        Shape::Box => {
            for c in 0..8 {
                p.push([
                    if c & 1 == 0 { -0.5 } else { 0.5 },
                    if c & 2 == 0 { -0.5 } else { 0.5 },
                    if c & 4 == 0 { -0.5 } else { 0.5 },
                ]);
            }
            for f in [
                [0, 2, 6, 4],
                [1, 5, 7, 3],
                [0, 4, 5, 1],
                [2, 3, 7, 6],
                [0, 1, 3, 2],
                [4, 6, 7, 5],
            ] {
                i.extend([f[0], f[1], f[2], f[0], f[2], f[3]]);
            }
        }
        Shape::Cylinder => {
            let n = 48u32;
            for k in 0..n {
                let a = TAU * f64::from(k) / f64::from(n);
                p.push([0.5 * a.cos(), -0.5, 0.5 * a.sin()]);
                p.push([0.5 * a.cos(), 0.5, 0.5 * a.sin()]);
            }
            p.push([0.0, -0.5, 0.0]);
            p.push([0.0, 0.5, 0.0]);
            for k in 0..n {
                let (a, b) = (2 * k, 2 * ((k + 1) % n));
                i.extend([a, a + 1, b, a + 1, b + 1, b]);
                i.extend([2 * n, a, b, 2 * n + 1, b + 1, a + 1]);
            }
        }
        Shape::Sphere => {
            let (rings, segs) = (24u32, 48u32);
            for r in 0..=rings {
                let phi = PI * f64::from(r) / f64::from(rings);
                for k in 0..=segs {
                    let th = TAU * f64::from(k) / f64::from(segs);
                    p.push([
                        0.5 * phi.sin() * th.cos(),
                        0.5 * phi.cos(),
                        0.5 * phi.sin() * th.sin(),
                    ]);
                }
            }
            let row = segs + 1;
            for r in 0..rings {
                for k in 0..segs {
                    let a = r * row + k;
                    i.extend([a, a + 1, a + row, a + 1, a + row + 1, a + row]);
                }
            }
        }
        Shape::Built(_) => {}
    }
    (p, i)
}

/// A solid's triangles in world space.
pub fn triangles(s: &Solid) -> Vec<[[f64; 3]; 3]> {
    let (positions, indices) = match (&s.mesh, s.shape) {
        (Some(m), _) => (m.positions.clone(), m.indices.clone()),
        (None, shape) => primitive(shape),
    };
    let m = &s.model;
    let world = |q: [f64; 3]| -> [f64; 3] {
        std::array::from_fn(|r| m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3])
    };
    let w: Vec<[f64; 3]> = positions.into_iter().map(world).collect();
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter_map(|t| {
            Some([
                *w.get(t[0] as usize)?,
                *w.get(t[1] as usize)?,
                *w.get(t[2] as usize)?,
            ])
        })
        .collect()
}

type Seg = [[f64; 2]; 2];

/// Where a triangle meets the plane y = level: the segment between the two edges that cross it,
/// a point on the plane counting as above.
fn slice(t: &[[f64; 3]; 3], level: f64) -> Option<Seg> {
    let h = t.map(|p| p[1] - level);
    let mut pts = Vec::with_capacity(2);
    for k in 0..3 {
        let (a, b) = (k, (k + 1) % 3);
        if (h[a] < 0.0) != (h[b] < 0.0) {
            let f = h[a] / (h[a] - h[b]);
            pts.push([
                t[a][0] + f * (t[b][0] - t[a][0]),
                t[a][2] + f * (t[b][2] - t[a][2]),
            ]);
        }
    }
    (pts.len() == 2).then(|| [pts[0], pts[1]])
}

/// The part of a triangle at or above the plane, projected to (x, z): up to four corners.
fn above(t: &[[f64; 3]; 3], level: f64) -> Vec<[f64; 2]> {
    let mut out = Vec::with_capacity(4);
    for k in 0..3 {
        let (a, b) = (t[k], t[(k + 1) % 3]);
        let (ha, hb) = (a[1] - level, b[1] - level);
        if ha >= 0.0 {
            out.push([a[0], a[2]]);
        }
        if (ha >= 0.0) != (hb >= 0.0) {
            let f = ha / (ha - hb);
            out.push([a[0] + f * (b[0] - a[0]), a[2] + f * (b[2] - a[2])]);
        }
    }
    out
}

fn area2(p: &[[f64; 2]]) -> f64 {
    (0..p.len())
        .map(|k| {
            let (a, b) = (p[k], p[(k + 1) % p.len()]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum()
}

fn inside(poly: &[[f64; 2]], q: [f64; 2]) -> bool {
    // Convex, either winding.
    let mut sign = 0.0f64;
    for k in 0..poly.len() {
        let (a, b) = (poly[k], poly[(k + 1) % poly.len()]);
        let c = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        if c != 0.0 {
            if sign != 0.0 && c.signum() != sign {
                return false;
            }
            sign = c.signum();
        }
    }
    true
}

fn seg_distance(s: &Seg, q: [f64; 2]) -> f64 {
    let [a, b] = *s;
    let ab = [b[0] - a[0], b[1] - a[1]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    let h = if l2 > 0.0 {
        (((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let (dx, dz) = (q[0] - a[0] - h * ab[0], q[1] - a[1] - h * ab[1]);
    (dx * dx + dz * dz).sqrt()
}

/// The grid a field lays over the water's plates.
struct Grid {
    origin: [f64; 2],
    cell: f64,
    dims: [u32; 2],
}

impl Grid {
    fn centre(&self, i: u32, j: u32) -> [f64; 2] {
        [
            self.origin[0] + (f64::from(i) + 0.5) * self.cell,
            self.origin[1] + (f64::from(j) + 0.5) * self.cell,
        ]
    }

    /// The cells whose centres lie within `pad` m of the box `[lo, hi]`.
    fn span(&self, lo: [f64; 2], hi: [f64; 2], pad: f64) -> Option<[u32; 4]> {
        let first = |v: f64, o: f64| ((v - pad - o) / self.cell - 0.5).ceil().max(0.0);
        let last = |v: f64, o: f64, n: u32| {
            ((v + pad - o) / self.cell - 0.5)
                .floor()
                .min(f64::from(n) - 1.0)
        };
        let (i0, j0) = (first(lo[0], self.origin[0]), first(lo[1], self.origin[1]));
        let (i1, j1) = (
            last(hi[0], self.origin[0], self.dims[0]),
            last(hi[1], self.origin[1], self.dims[1]),
        );
        (i0 <= i1 && j0 <= j1).then_some([i0 as u32, j0 as u32, i1 as u32, j1 as u32])
    }

    /// Each cell's distance to the nearest of `segs`, kept up to `reach` m.
    fn distances(&self, segs: &[Seg], reach: f64) -> Vec<f64> {
        let mut d = vec![reach; (self.dims[0] * self.dims[1]) as usize];
        for s in segs {
            let lo = [s[0][0].min(s[1][0]), s[0][1].min(s[1][1])];
            let hi = [s[0][0].max(s[1][0]), s[0][1].max(s[1][1])];
            let Some([i0, j0, i1, j1]) = self.span(lo, hi, reach) else {
                continue;
            };
            for j in j0..=j1 {
                for i in i0..=i1 {
                    let k = (j * self.dims[0] + i) as usize;
                    d[k] = d[k].min(seg_distance(s, self.centre(i, j)));
                }
            }
        }
        d
    }
}

/// Which wrong field a planted program bakes, reachable only through `deep-gpu --planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// The distance measured from each item's centre rather than from where it meets the water.
    FromCentre,
}

/// The shore's items among `layers`' solids: each solid whose item, or a parent of it, the
/// collection holds.
fn shore_solids<'a>(
    doc: &Map<String, Value>,
    layers: &'a [Layer3],
    set: &BTreeSet<&str>,
) -> Vec<&'a Solid> {
    let items = doc.get("items").and_then(Value::as_object);
    layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| chain(items, &s.id).iter().any(|c| set.contains(c)))
        .collect()
}

/// The field's key: the plate's grid and level, and each item's shape, mesh and transform.
fn key_of(grid: &Grid, level: f64, reach: f64, solids: &[&Solid], planted: Planted) -> String {
    let mut h = Sha256::new();
    h.update(b"shore@1");
    for v in [grid.origin[0], grid.origin[1], grid.cell, level, reach] {
        h.update(v.to_bits().to_le_bytes());
    }
    h.update(grid.dims[0].to_le_bytes());
    h.update(grid.dims[1].to_le_bytes());
    h.update([u8::from(planted == Planted::FromCentre)]);
    let mut sorted: Vec<&&Solid> = solids.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    for s in sorted {
        h.update(s.id.as_bytes());
        h.update([0]);
        let shape = match s.shape {
            Shape::Box => 1u64,
            Shape::Cylinder => 2,
            Shape::Sphere => 3,
            Shape::Built(x) => x,
        };
        h.update(shape.to_le_bytes());
        if let Some(m) = &s.mesh {
            for p in &m.positions {
                for v in p {
                    h.update(v.to_bits().to_le_bytes());
                }
            }
            for i in &m.indices {
                h.update(i.to_le_bytes());
            }
        }
        for r in &s.model {
            for v in r {
                h.update(v.to_bits().to_le_bytes());
            }
        }
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Fields baked, by key, so a frame never bakes again what an earlier one did.
static BAKED: Mutex<Vec<Arc<Field>>> = Mutex::new(Vec::new());
const KEPT: usize = 8;

/// The field for `shore` over the plates `plates` ([min x, min z, max x, max z] at rest) at
/// `level`, from the solids of `layers` the shore's collection holds: baked, or the one already
/// baked under its key. A field past [`MAX_SIDE`] cells a side is refused, naming the count.
pub fn field(
    doc: &Map<String, Value>,
    material: &str,
    shore: &Shore,
    layers: &[Layer3],
    plates: &[[f64; 4]],
    level: f64,
    planted: Planted,
) -> Result<Arc<Field>, Refused> {
    let set = members(doc, material, &shore.collection)?;
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for p in plates {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[2]), hi[1].max(p[3])];
    }
    if !(lo[0] <= hi[0] && lo[1] <= hi[1]) {
        lo = [0.0; 2];
        hi = [0.0; 2];
    }
    let cell = shore.cell;
    // A whole number of cells to within float error isn't rounded up past it.
    let side = |a: f64, b: f64| ((((b - a) / cell) - 1e-9).ceil() as u64).max(1);
    let (nx, nz) = (side(lo[0], hi[0]), side(lo[1], hi[1]));
    if nx > MAX_SIDE || nz > MAX_SIDE {
        return Err(bad(
            "out_of_range",
            format!(
                "items/{material}/params/water/shore/cell: {nx} × {nz} cells is past {MAX_SIDE} × {MAX_SIDE}"
            ),
        ));
    }
    let grid = Grid {
        origin: lo,
        cell,
        dims: [nx as u32, nz as u32],
    };
    // Past the calm's far end and the foam's band nothing reads the distance.
    let reach = shore.far.max(shore.width) + 2.0 * cell;
    let solids = shore_solids(doc, layers, &set);
    let key = key_of(&grid, level, reach, &solids, planted);
    {
        let baked = BAKED.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = baked.iter().find(|f| f.key == key) {
            return Ok(f.clone());
        }
    }
    let f = Arc::new(bake(&grid, level, reach, &solids, key, planted));
    let mut baked = BAKED.lock().unwrap_or_else(|e| e.into_inner());
    if baked.len() >= KEPT {
        baked.remove(0);
    }
    baked.push(f.clone());
    Ok(f)
}

/// The bake itself, in f64: the outline's distance and the footprint's signed distance per cell.
fn bake(
    grid: &Grid,
    level: f64,
    reach: f64,
    solids: &[&Solid],
    key: String,
    planted: Planted,
) -> Field {
    let start = std::time::Instant::now();
    let mut outline: Vec<Seg> = Vec::new();
    let mut polys: Vec<Vec<[f64; 2]>> = Vec::new();
    for s in solids {
        let tris = triangles(s);
        if planted == Planted::FromCentre {
            // The planted field: each item's centre stands for its outline.
            let c = [s.model[0][3], s.model[2][3]];
            outline.push([c, c]);
        } else {
            outline.extend(tris.iter().filter_map(|t| slice(t, level)));
        }
        polys.extend(
            tris.iter()
                .map(|t| above(t, level))
                .filter(|p| p.len() >= 3 && area2(p).abs() > 1e-12),
        );
    }
    let d = grid.distances(&outline, reach);
    // The footprint: which cell centres a polygon above the water covers, and its edges where
    // one side is covered and the other isn't.
    let n = (grid.dims[0] * grid.dims[1]) as usize;
    let mut covered = vec![false; n];
    let covers = |q: [f64; 2]| polys.iter().any(|p| inside(p, q));
    for p in &polys {
        let lo = p
            .iter()
            .fold([f64::INFINITY; 2], |a, q| [a[0].min(q[0]), a[1].min(q[1])]);
        let hi = p.iter().fold([f64::NEG_INFINITY; 2], |a, q| {
            [a[0].max(q[0]), a[1].max(q[1])]
        });
        let Some([i0, j0, i1, j1]) = grid.span(lo, hi, 0.0) else {
            continue;
        };
        for j in j0..=j1 {
            for i in i0..=i1 {
                let k = (j * grid.dims[0] + i) as usize;
                if !covered[k] && inside(p, grid.centre(i, j)) {
                    covered[k] = true;
                }
            }
        }
    }
    let eps = 1e-4 * grid.cell;
    let mut edges: Vec<Seg> = Vec::new();
    if covered.iter().any(|c| *c) {
        for p in &polys {
            for k in 0..p.len() {
                let (a, b) = (p[k], p[(k + 1) % p.len()]);
                let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
                let l = (dx * dx + dz * dz).sqrt();
                if l <= 0.0 {
                    continue;
                }
                let m = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
                let (nx, nz) = (-dz / l * eps, dx / l * eps);
                if covers([m[0] + nx, m[1] + nz]) != covers([m[0] - nx, m[1] - nz]) {
                    edges.push([a, b]);
                }
            }
        }
    }
    let cover_reach = COVER_REACH * grid.cell;
    let c = grid.distances(&edges, cover_reach);
    let cells = (0..n)
        .map(|k| {
            let dq = ((d[k].min(reach) / reach) * 65535.0).round() as u32;
            let signed = if covered[k] { -c[k] } else { c[k] };
            let cq =
                ((signed / (2.0 * cover_reach) + 0.5).clamp(0.0, 1.0) * 65535.0).round() as u32;
            dq | (cq << 16)
        })
        .collect();
    Field {
        key,
        origin: grid.origin,
        cell: grid.cell,
        dims: grid.dims,
        level,
        reach,
        cells,
        bake_ms: start.elapsed().as_secs_f64() * 1e3,
    }
}
