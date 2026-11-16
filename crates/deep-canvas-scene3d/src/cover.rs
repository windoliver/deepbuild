//! #1383: a terrain plate's cover (canvas primitives: Builder plate: terrain). Up to four entries
//! lie in order over the plate's own material, each a `material@1` mixed over what lies under it
//! by its weight. `where` holds an entry by ranges of the ground's slope (degrees), height (m, the
//! plate's own), aspect (the compass facing of its down-slope direction, 0° north along −Z and 90°
//! east along +X, read as cos(aspect − direction)) and curvature (minus the Laplacian of the
//! heights, per m, so a ridge is positive); within `blend` m of ground of a range's edge the
//! weight crosses from 0 to 1. Each sample holds its signed distance to the edge of where its
//! entry holds (m, inside positive, the nearest edge of all its terms), evaluated from the params
//! at t, so a threshold or an amount a channel keys is a closed form of t and nothing accumulates
//! over frames; the fragment stage mixes the distances of the three samples of the triangle under
//! a pixel, as the drawn surface splits its cell, and only then crosses `blend`, so an edge runs
//! smooth between samples. `projection` samples an entry's base color map by uv0, by three
//! projections in metres weighted |n|^(1.5 × sharpness) from the geometric normal, or (`auto`)
//! triplanar above 35° of slope. `modify` changes an entry's material where its own `where`
//! holds: wet multiplies base color by 1 − 0.3a and roughness by 1 − 0.5a, dust lays a pale
//! dust color over base color and raises roughness, each by half of a. [`Cover::reading`] is the
//! fragment stage's function on the CPU, which view3d's `cover_points` reports.

use std::sync::Arc;

use deep_canvas::ops;
use serde_json::{json, Value};

use crate::geom::Mesh;
use crate::light::MapSlot;
use crate::look::Look3;
use crate::scene::{Affine3, Refused};

/// The most entries a plate's cover holds.
pub const MAX_ENTRIES: usize = 4;
/// The most modifies an entry holds: wet and dust.
pub const MAX_MODIFY: usize = 2;
/// Above this slope, degrees, `auto` samples triplanar.
pub const AUTO_SLOPE_DEG: f64 = 35.0;
/// Triplanar weights are |n|^(1.5 × SHARPNESS), normalized.
pub const SHARPNESS: f64 = 2.0;
/// Dust's color, linear, which amount 1 takes base color halfway to.
pub const DUST: [f64; 3] = [0.6, 0.53, 0.43];

/// How an entry samples its base color map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Projection {
    Uv,
    Triplanar,
    Auto,
}

/// What a modify does to an entry's material.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Wet,
    Dust,
}

/// One modify of an entry: its kind, its amount at t (0 to 1), and the byte of a sample's run
/// that holds its own `where` weight, none where it has no `where`.
#[derive(Clone, Debug, PartialEq)]
pub struct Modify {
    pub kind: Kind,
    pub amount: f64,
    pub slot: Option<usize>,
}

/// One cover entry: its material's values, its base color map, its projection, its modifies,
/// its blend (m) and the distance its samples' bytes span each side of an edge (m).
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub material: String,
    pub shading: Shading,
    pub map: Option<MapSlot>,
    pub projection: Projection,
    pub modify: Vec<Modify>,
    pub blend: f64,
    pub span: f64,
}

/// What a point shades with before any light: base color (linear), roughness and metallic.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shading {
    pub base: [f64; 3],
    pub roughness: f64,
    pub metallic: f64,
}

/// The wrong programs a cover reading follows, as the fragment stage does (#1383's plants).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// Every projection samples by the ground's (x, z) in metres at every slope.
    PlanarUv,
    /// Triplanar weights from the interpolated shading normal.
    ShadedNormal,
}

/// A terrain plate's cover at t.
#[derive(Clone, Debug, PartialEq)]
pub struct Cover {
    /// The plate's item ID.
    pub plate: String,
    /// Its extent along X and Z, m, centred on its own origin, and its samples.
    pub size: [f64; 2],
    pub cols: usize,
    pub rows: usize,
    /// What lies under the entries: the plate's own material.
    pub under: Shading,
    pub entries: Vec<Entry>,
    /// Bytes a sample takes: one per entry, then one per modify with a `where`.
    pub stride: usize,
    /// Each sample's distances, row by row, [`encode`]d over their entry's span.
    pub bytes: Vec<u8>,
    /// Each sample's curvature, per m.
    pub curvature: Vec<f64>,
    /// Its full-detail mesh, a vertex per sample, in its own space, and where it stands.
    pub mesh: Arc<Mesh>,
    pub model: Affine3,
}

/// One cover entry at a ground point: its weight, and the projections' weights along X, Y and Z
/// where it samples triplanar.
#[derive(Clone, Debug, PartialEq)]
pub struct EntryAt {
    pub weight: f64,
    pub triplanar: Option<[f64; 3]>,
}

/// The cover at a ground point, as the fragment stage takes it.
#[derive(Clone, Debug, PartialEq)]
pub struct Reading {
    pub curvature: f64,
    pub entries: Vec<EntryAt>,
    pub shading: Shading,
}

fn bad(path: String) -> Refused {
    Refused {
        code: "out_of_range",
        path,
    }
}

/// A ground measure a `where` term reads.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Term {
    Slope,
    Height,
    /// cos(aspect − direction), the direction in degrees.
    Aspect(f64),
    Curvature,
}

/// One term: its measure and its open or closed range.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Range {
    term: Term,
    min: Option<f64>,
    max: Option<f64>,
}

fn number(v: Option<&Value>, path: &str) -> Result<Option<f64>, Refused> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .map(Some)
            .ok_or_else(|| bad(path.to_string())),
    }
}

/// A `where`: an object of terms, each optional; `{}` or none holds everywhere.
fn ranges(v: Option<&Value>, at: &str) -> Result<Vec<Range>, Refused> {
    let Some(v) = v.filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let o = v.as_object().ok_or_else(|| bad(at.to_string()))?;
    let mut out = Vec::new();
    for (name, t) in o {
        let p = format!("{at}/{name}");
        let tobj = t.as_object().ok_or_else(|| bad(p.clone()))?;
        let term = match name.as_str() {
            "slope" => Term::Slope,
            "height" => Term::Height,
            "curvature" => Term::Curvature,
            "aspect" => Term::Aspect(
                number(tobj.get("direction"), &format!("{p}/direction"))?
                    .ok_or_else(|| bad(format!("{p}/direction")))?,
            ),
            _ => return Err(bad(p)),
        };
        let allowed: &[&str] = match term {
            Term::Aspect(_) => &["direction", "min", "max"],
            _ => &["min", "max"],
        };
        if let Some(k) = tobj.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(bad(format!("{p}/{k}")));
        }
        out.push(Range {
            term,
            min: number(tobj.get("min"), &format!("{p}/min"))?,
            max: number(tobj.get("max"), &format!("{p}/max"))?,
        });
    }
    Ok(out)
}

/// A plate's heights on its grid, and the measures `where` reads, per sample.
struct Ground<'a> {
    h: &'a [f64],
    cols: usize,
    rows: usize,
    /// Spacing along X and Z, m.
    d: [f64; 2],
}

impl Ground<'_> {
    fn at(&self, v: &[f64], c: usize, r: usize) -> f64 {
        v[r * self.cols + c]
    }

    /// The gradient of `v` at sample (c, r), per m: central differences, one-sided at an edge.
    fn grad(&self, v: &[f64], c: usize, r: usize) -> [f64; 2] {
        let (c0, c1) = (c.saturating_sub(1), (c + 1).min(self.cols - 1));
        let (r0, r1) = (r.saturating_sub(1), (r + 1).min(self.rows - 1));
        [
            (self.at(v, c1, r) - self.at(v, c0, r)) / ((c1 - c0) as f64 * self.d[0]),
            (self.at(v, c, r1) - self.at(v, c, r0)) / ((r1 - r0) as f64 * self.d[1]),
        ]
    }

    /// Minus the five-point Laplacian of the heights at (c, r), per m; at an edge, the next
    /// sample in's.
    fn curvature(&self, c: usize, r: usize) -> f64 {
        let second = |lo: f64, mid: f64, hi: f64, d: f64| (lo - 2.0 * mid + hi) / (d * d);
        let h = |c: usize, r: usize| self.at(self.h, c, r);
        let xx = if self.cols >= 3 {
            let c = c.clamp(1, self.cols - 2);
            second(h(c - 1, r), h(c, r), h(c + 1, r), self.d[0])
        } else {
            0.0
        };
        let zz = if self.rows >= 3 {
            let r = r.clamp(1, self.rows - 2);
            second(h(c, r - 1), h(c, r), h(c, r + 1), self.d[1])
        } else {
            0.0
        };
        -(xx + zz)
    }

    /// The value a term reads at every sample.
    fn values(&self, term: Term) -> Vec<f64> {
        let n = self.cols * self.rows;
        let mut out = Vec::with_capacity(n);
        for r in 0..self.rows {
            for c in 0..self.cols {
                out.push(match term {
                    Term::Height => self.at(self.h, c, r),
                    Term::Curvature => self.curvature(c, r),
                    Term::Slope => {
                        let g = self.grad(self.h, c, r);
                        ops::deg(ops::atan(ops::hypot(g[0], g[1])))
                    }
                    Term::Aspect(direction) => {
                        // The down-slope direction, (−∂h/∂x, −∂h/∂z); north is −Z, east +X.
                        let g = self.grad(self.h, c, r);
                        let (dx, dz) = (-g[0], -g[1]);
                        let l = ops::hypot(dx, dz);
                        if l < 1e-12 {
                            0.0
                        } else {
                            let d = ops::rad(direction);
                            (dx / l) * ops::sin(d) + (-dz / l) * ops::cos(d)
                        }
                    }
                });
            }
        }
        out
    }

    /// Each sample's signed distance to the nearest edge of `ranges`, m, inside positive (a
    /// range's edge read as the value's offset over its gradient); +∞ where there are none.
    fn distances(&self, ranges: &[Range]) -> Vec<f64> {
        let mut d = vec![f64::INFINITY; self.cols * self.rows];
        for range in ranges {
            let v = self.values(range.term);
            for r in 0..self.rows {
                for c in 0..self.cols {
                    let s = r * self.cols + c;
                    let g = self.grad(&v, c, r);
                    let slope = ops::hypot(g[0], g[1]).max(1e-12);
                    for (edge, sign) in [(range.min, 1.0), (range.max, -1.0)] {
                        let Some(edge) = edge else { continue };
                        d[s] = d[s].min(sign * (v[s] - edge) / slope);
                    }
                }
            }
        }
        d
    }
}

/// A distance as a sample's byte: `d` over `span`, from −1 at 0 to +1 at 255.
pub fn encode(d: f64, span: f64) -> u8 {
    ((d / span).clamp(-1.0, 1.0) * 127.5 + 127.5).round() as u8
}

/// A sample's byte as a distance, m.
pub fn decode(b: f64, span: f64) -> f64 {
    (b - 127.5) / 127.5 * span
}

/// An entry's weight at signed distance `d` from its edge: crossing from 0 to 1 over `blend` m
/// centred on the edge, a hard edge at 0.
pub fn weight(d: f64, blend: f64) -> f64 {
    if blend > 0.0 {
        smoothstep(0.5 + d / blend)
    } else if d >= 0.0 {
        1.0
    } else {
        0.0
    }
}

fn smoothstep(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// The triplanar weights for normal `n`: |n_i|^(1.5 × SHARPNESS), summing to 1.
pub fn triplanar(n: [f64; 3]) -> [f64; 3] {
    let p = 1.5 * SHARPNESS;
    let a = n.map(|x| ops::pow(x.abs(), p));
    let sum = a[0] + a[1] + a[2];
    if sum <= 0.0 {
        return [0.0, 1.0, 0.0];
    }
    a.map(|x| x / sum)
}

/// Whether an entry samples triplanar where the ground's geometric normal is `geometric`.
pub fn samples_triplanar(projection: Projection, geometric: [f64; 3]) -> bool {
    match projection {
        Projection::Uv => false,
        Projection::Triplanar => true,
        Projection::Auto => {
            let [x, y, z] = geometric;
            let l = ops::sqrt(x * x + y * y + z * z);
            l > 0.0 && y.abs() / l < ops::cos(ops::rad(AUTO_SLOPE_DEG))
        }
    }
}

/// An entry's material after its modifies, each by its amount times its own `where` weight.
pub fn modified(s: Shading, modify: &[(Kind, f64)]) -> Shading {
    let mut s = s;
    for &(kind, a) in modify {
        let a = a.clamp(0.0, 1.0);
        match kind {
            Kind::Wet => {
                s.base = s.base.map(|c| c * (1.0 - 0.3 * a));
                s.roughness *= 1.0 - 0.5 * a;
            }
            Kind::Dust => {
                let k = 0.5 * a;
                s.base = [0, 1, 2].map(|i| s.base[i] + (DUST[i] - s.base[i]) * k);
                s.roughness += (1.0 - s.roughness) * k;
            }
        }
    }
    s
}

/// `over` laid over `under` by weight `w`.
pub fn mixed(under: Shading, over: Shading, w: f64) -> Shading {
    let m = |a: f64, b: f64| a + (b - a) * w;
    Shading {
        base: [0, 1, 2].map(|i| m(under.base[i], over.base[i])),
        roughness: m(under.roughness, over.roughness),
        metallic: m(under.metallic, over.metallic),
    }
}

/// The cover of the plate `id` from its evaluated `params` at t, its full-detail `mesh` and its
/// `model`, over `under`; `None` where it has none. Materials resolve through `named`.
pub fn of<'a>(
    id: &str,
    params: &Value,
    named: impl Fn(&str) -> Option<&'a Value> + Copy,
    look: &Look3,
    mesh: &Arc<Mesh>,
    model: Affine3,
    under: Shading,
) -> Result<Option<Cover>, Refused> {
    let at = format!("items/{id}/params/cover");
    let list = match params.get("cover") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Array(list)) => list,
        Some(_) => return Err(bad(at)),
    };
    if list.is_empty() {
        return Ok(None);
    }
    if list.len() > MAX_ENTRIES {
        return Err(bad(format!("{at}/{MAX_ENTRIES}")));
    }
    // A cover lies on a terrain plate alone.
    let t = crate::terrain::of_params(params).ok_or_else(|| bad(at.clone()))?;
    let (size, [cols, rows]) = crate::terrain::grid(t, false).map_err(|_| bad(at.clone()))?;
    let built;
    let h: Vec<f64> = if mesh.positions.len() == cols * rows {
        mesh.positions.iter().map(|p| p[1]).collect()
    } else {
        built = crate::terrain::build(params, false).map_err(|_| bad(at.clone()))?;
        built.h.clone()
    };
    let ground = Ground {
        h: &h,
        cols,
        rows,
        d: [size[0] / (cols - 1) as f64, size[1] / (rows - 1) as f64],
    };
    // Each entry, and its weights and its modifies' own weights per sample.
    let mut entries = Vec::new();
    let mut layers: Vec<Vec<u8>> = Vec::new();
    let mut own: Vec<Vec<u8>> = Vec::new();
    for (k, e) in list.iter().enumerate() {
        let p = format!("{at}/{k}");
        let o = e.as_object().ok_or_else(|| bad(p.clone()))?;
        if let Some(key) = o.keys().find(|key| {
            !["material", "where", "blend", "projection", "modify"].contains(&key.as_str())
        }) {
            return Err(bad(format!("{p}/{key}")));
        }
        let name = o
            .get("material")
            .and_then(Value::as_str)
            .ok_or_else(|| Refused {
                code: "ref_unresolved",
                path: format!("{p}/material"),
            })?;
        let holder = json!({"material": name});
        let m = crate::light::material(&holder, named, look, &format!("{id}/params/cover/{k}"))?
            .ok_or_else(|| Refused {
                code: "ref_unresolved",
                path: format!("{p}/material"),
            })?;
        let map = crate::light::maps(&holder, named)?.and_then(|m| m.base_color.clone());
        let projection = match o.get("projection").map(Value::as_str) {
            None | Some(Some("auto")) => Projection::Auto,
            Some(Some("uv")) => Projection::Uv,
            Some(Some("triplanar")) => Projection::Triplanar,
            _ => return Err(bad(format!("{p}/projection"))),
        };
        let blend = number(o.get("blend"), &format!("{p}/blend"))?.unwrap_or(0.0);
        if blend < 0.0 {
            return Err(bad(format!("{p}/blend")));
        }
        let span = blend.max(2.0 * ground.d[0].max(ground.d[1]));
        let terms = ranges(o.get("where"), &format!("{p}/where"))?;
        layers.push(
            ground
                .distances(&terms)
                .iter()
                .map(|&d| encode(d, span))
                .collect(),
        );
        let mut modify = Vec::new();
        match o.get("modify") {
            None | Some(Value::Null) => {}
            Some(Value::Array(ms)) if ms.len() <= MAX_MODIFY => {
                for (j, m) in ms.iter().enumerate() {
                    let mp = format!("{p}/modify/{j}");
                    let mo = m.as_object().ok_or_else(|| bad(mp.clone()))?;
                    if let Some(key) = mo
                        .keys()
                        .find(|key| !["kind", "where", "amount"].contains(&key.as_str()))
                    {
                        return Err(bad(format!("{mp}/{key}")));
                    }
                    let kind = match mo.get("kind").and_then(Value::as_str) {
                        Some("wet") => Kind::Wet,
                        Some("dust") => Kind::Dust,
                        _ => return Err(bad(format!("{mp}/kind"))),
                    };
                    let amount = number(mo.get("amount"), &format!("{mp}/amount"))?
                        .filter(|a| (0.0..=1.0).contains(a))
                        .ok_or_else(|| bad(format!("{mp}/amount")))?;
                    let slot = match mo.get("where").filter(|w| !w.is_null()) {
                        Some(w) => {
                            let terms = ranges(Some(w), &format!("{mp}/where"))?;
                            own.push(
                                ground
                                    .distances(&terms)
                                    .iter()
                                    .map(|&d| encode(d, span))
                                    .collect(),
                            );
                            Some(own.len() - 1)
                        }
                        None => None,
                    };
                    modify.push(Modify { kind, amount, slot });
                }
            }
            Some(Value::Array(_)) => return Err(bad(format!("{p}/modify/{MAX_MODIFY}"))),
            Some(_) => return Err(bad(format!("{p}/modify"))),
        }
        entries.push(Entry {
            material: name.to_string(),
            shading: Shading {
                base: [m.base[0], m.base[1], m.base[2]],
                roughness: m.roughness,
                metallic: m.metallic,
            },
            map,
            projection,
            modify,
            blend,
            span,
        });
    }
    // A modify's byte follows the entries'.
    let first = entries.len();
    for e in &mut entries {
        for m in &mut e.modify {
            m.slot = m.slot.map(|s| first + s);
        }
    }
    let stride = first + own.len();
    let n = cols * rows;
    let mut bytes = vec![0u8; n * stride];
    for (b, d) in layers.iter().chain(&own).enumerate() {
        for s in 0..n {
            bytes[s * stride + b] = d[s];
        }
    }
    let mut curvature = Vec::with_capacity(n);
    for r in 0..rows {
        for c in 0..cols {
            curvature.push(ground.curvature(c, r));
        }
    }
    Ok(Some(Cover {
        plate: id.to_string(),
        size,
        cols,
        rows,
        under,
        entries,
        stride,
        bytes,
        curvature,
        mesh: mesh.clone(),
        model,
    }))
}

impl Cover {
    /// The samples of the triangle under (x, z) of the plate's own space and their shares, as
    /// the drawn surface splits a cell (from its (c, r + 1) corner to its (c + 1, r) one);
    /// `None` off the plate.
    pub fn corners(&self, x: f64, z: f64) -> Option<[(usize, f64); 3]> {
        let (nc, nr) = ((self.cols - 1) as f64, (self.rows - 1) as f64);
        let u = (x / self.size[0] + 0.5) * nc;
        let v = (z / self.size[1] + 0.5) * nr;
        if !(0.0..=nc).contains(&u) || !(0.0..=nr).contains(&v) {
            return None;
        }
        let c = (u.floor() as usize).min(self.cols - 2);
        let r = (v.floor() as usize).min(self.rows - 2);
        let (fx, fz) = (u - c as f64, v - r as f64);
        let s = |c: usize, r: usize| r * self.cols + c;
        Some(if fx + fz <= 1.0 {
            [
                (s(c, r), 1.0 - fx - fz),
                (s(c + 1, r), fx),
                (s(c, r + 1), fz),
            ]
        } else {
            [
                (s(c + 1, r + 1), fx + fz - 1.0),
                (s(c, r + 1), 1.0 - fx),
                (s(c + 1, r), 1.0 - fz),
            ]
        })
    }

    /// Byte `b` of the samples `at`, mixed by their shares.
    fn byte(&self, at: &[(usize, f64); 3], b: usize) -> f64 {
        at.iter()
            .map(|&(s, k)| k * f64::from(self.bytes[s * self.stride + b]))
            .sum()
    }

    /// The cover at (x, z) of the plate's own space, as the fragment stage shades it there:
    /// each entry's weight and triplanar weights, and what the point shades with before any
    /// light (each entry's material factors; a map's texels aren't read here). `None` off the
    /// plate.
    pub fn reading(&self, x: f64, z: f64, plant: Plant) -> Option<Reading> {
        let at = self.corners(x, z)?;
        let p = at.map(|(s, _)| self.mesh.positions[s]);
        // The triangle's own normal, facing +Y.
        let (a, b) = (sub(p[1], p[0]), sub(p[2], p[0]));
        let mut geometric = cross(a, b);
        if geometric[1] < 0.0 {
            geometric = geometric.map(|x| -x);
        }
        let shaded = {
            let mut n = [0.0; 3];
            for &(s, k) in &at {
                let v = self.mesh.normals.get(s).copied().unwrap_or([0.0, 1.0, 0.0]);
                for i in 0..3 {
                    n[i] += k * v[i];
                }
            }
            n
        };
        let unit = |n: [f64; 3]| {
            let l = ops::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).max(1e-300);
            n.map(|x| x / l)
        };
        let weighs_by = unit(match plant {
            Plant::ShadedNormal => shaded,
            _ => geometric,
        });
        let mut shading = self.under;
        let mut entries = Vec::new();
        for (k, e) in self.entries.iter().enumerate() {
            let held = |b: usize| weight(decode(self.byte(&at, b), e.span), e.blend);
            let weight = held(k);
            let tri = plant != Plant::PlanarUv && samples_triplanar(e.projection, geometric);
            let modify: Vec<(Kind, f64)> = e
                .modify
                .iter()
                .map(|m| (m.kind, m.amount * m.slot.map_or(1.0, held)))
                .collect();
            shading = mixed(shading, modified(e.shading, &modify), weight);
            entries.push(EntryAt {
                weight,
                triplanar: tri.then(|| triplanar(weighs_by)),
            });
        }
        Some(Reading {
            curvature: at.iter().map(|&(s, k)| k * self.curvature[s]).sum(),
            entries,
            shading,
        })
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
