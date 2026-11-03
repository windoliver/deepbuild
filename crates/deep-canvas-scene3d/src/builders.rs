//! The trusted builders (canvas primitives: Builder; issue #420): pure functions of their params
//! that build a mesh, each with a vertex count computable from its params alone, so a count is
//! known, and an over-budget build refused, before anything is built. A closed builder reports
//! each closed part with the genus its params give it; `shade: flat` gives every triangle its own
//! three vertices and normal (Builder: shading).

use deep_canvas::ops::{atan2, cos, rad, sin, sqrt, tan};
use serde_json::Value;

use crate::curve::{self, Sampled};
use crate::geom::{add, area2, cross, dot, length, scale, sub, triangulate, unit, Mesh, V2, V3};

/// The builder kinds, as documents name them.
pub const KINDS: [&str; 8] = [
    "slab@1",
    "lathe@1",
    "extrude@1",
    "tube@1",
    "ball@1",
    "coil@1",
    "plate@1",
    "display@1",
];

/// The most vertices one builder makes (Builder: "exceed its declared vertex count").
pub const MAX_VERTICES: u64 = 4_000_000;

/// The wrong programs #420's criteria plant, each reachable only through a proof surface.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// A lathe on a closed outline reports genus 0 (AC5's twin).
    pub torus_genus_0: bool,
    /// A slab declares one vertex fewer than it builds.
    pub vertex_count_off_by_one: bool,
    /// A lathe leaves its top flat cap out and still reports the part closed.
    pub cap_left_open: bool,
    /// A geodesic ball builds at 1.01 times its radius.
    pub ball_scaled: bool,
    /// `shade: flat` builds the smooth mesh (AC4's mutant).
    pub flat_as_smooth: bool,
}

impl Plants {
    /// The plant `name`, when it is one of these.
    pub fn named(name: &str) -> Option<Plants> {
        let mut p = Plants::default();
        match name {
            "torus_genus_0" => p.torus_genus_0 = true,
            "vertex_count_off_by_one" => p.vertex_count_off_by_one = true,
            "cap_left_open" => p.cap_left_open = true,
            "ball_scaled" => p.ball_scaled = true,
            "flat_as_smooth" => p.flat_as_smooth = true,
            _ => return None,
        }
        Some(p)
    }
}

/// Why a builder can't build: the path of the param at fault, under the item.
pub type Fault = String;

fn bad(name: &str) -> Fault {
    format!("params/{name}")
}

fn num(p: &Value, name: &str, default: f64) -> Result<f64, Fault> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .ok_or_else(|| bad(name)),
    }
}

fn positive(p: &Value, name: &str, default: f64) -> Result<f64, Fault> {
    let x = num(p, name, default)?;
    (x > 0.0).then_some(x).ok_or_else(|| bad(name))
}

fn count(p: &Value, name: &str, default: u64, min: u64, max: u64) -> Result<u64, Fault> {
    let n = match p.get(name) {
        None => default,
        Some(v) => v.as_u64().ok_or_else(|| bad(name))?,
    };
    (min..=max)
        .contains(&n)
        .then_some(n)
        .ok_or_else(|| bad(name))
}

fn text<'a>(p: &'a Value, name: &str, default: &'a str, of: &[&str]) -> Result<&'a str, Fault> {
    let t = match p.get(name) {
        None => default,
        Some(v) => v.as_str().ok_or_else(|| bad(name))?,
    };
    of.contains(&t).then_some(t).ok_or_else(|| bad(name))
}

fn flag(p: &Value, name: &str, default: bool) -> Result<bool, Fault> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v.as_bool().ok_or_else(|| bad(name)),
    }
}

fn v2s(v: &Value) -> Option<Vec<V2>> {
    v.as_array()?
        .iter()
        .map(|q| {
            let a = q.as_array().filter(|a| a.len() == 2)?;
            Some([a[0].as_f64()?, a[1].as_f64()?])
        })
        .collect()
}

/// A polygon param: at least three points with a non-zero area.
pub fn outline(p: &Value, name: &str) -> Result<Vec<V2>, Fault> {
    p.get(name)
        .and_then(v2s)
        .filter(|o| o.len() >= 3 && area2(o).abs() > 1e-12)
        .ok_or_else(|| bad(name))
}

fn holes(p: &Value, name: &str) -> Result<Vec<Vec<V2>>, Fault> {
    match p.get(name) {
        None => Ok(Vec::new()),
        Some(Value::Array(list)) => list
            .iter()
            .map(|h| v2s(h).filter(|h| h.len() >= 3))
            .collect::<Option<_>>()
            .ok_or_else(|| bad(name)),
        Some(_) => Err(bad(name)),
    }
}

fn shade_flat(p: &Value) -> Result<bool, Fault> {
    Ok(text(p, "shade", "smooth", &["smooth", "flat"])? == "flat")
}

/// A point on a vertex's ring: the normal `n` it should face, from `a`, `b`, `c`.
fn tri_facing(m: &mut Mesh, a: u32, b: u32, c: u32, n: V3, face: u32) {
    let [pa, pb, pc] = [a, b, c].map(|i| m.positions[i as usize]);
    if dot(cross(sub(pb, pa), sub(pc, pa)), n) < 0.0 {
        m.tri(a, c, b, face);
    } else {
        m.tri(a, b, c, face);
    }
}

/// The curve a param names, sampled: inline points, or a `curve@1` item of `doc` by ID.
pub fn path(doc: &Value, v: Option<&Value>) -> Option<Sampled> {
    match v? {
        Value::String(id) => {
            let item = doc.get("items")?.get(id)?;
            if item.get("kind").and_then(Value::as_str) != Some("curve@1") {
                return None;
            }
            curve::sample(item.get("params").unwrap_or(&Value::Null)).ok()
        }
        v => {
            let points = curve::points(v).filter(|p| p.len() >= 2)?;
            Some(Sampled {
                points,
                closed: false,
            })
        }
    }
}

/// What a builder builds with: the document (for the curves it names) and the plants.
pub struct Ctx<'a> {
    pub doc: &'a Value,
    pub plants: Plants,
}

/// Builds `kind` from `params`, smooth or flat as `shade` says.
pub fn build(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let mut m = match kind {
        "slab@1" => slab(params)?,
        "lathe@1" => lathe(params, ctx.plants)?,
        "extrude@1" => extrude(params)?,
        "tube@1" => tube_item(params, ctx)?,
        "ball@1" => ball(params, ctx.plants)?,
        "coil@1" => coil(params)?,
        "plate@1" => plate(params)?,
        "display@1" => display(params)?,
        _ => return Err("kind".into()),
    };
    m.orient();
    if shade_flat(params)? && !ctx.plants.flat_as_smooth {
        m = m.flat();
    }
    Ok(m)
}

/// The vertices `kind` builds from `params`, counted without building it.
pub fn estimate(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<u64, Fault> {
    counts(kind, params, ctx).map(|c| c.0)
}

/// The vertices `kind` declares and the triangles it builds, counted from `params` alone.
pub fn counts(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<(u64, u64), Fault> {
    let (vertices, triangles) = match kind {
        "slab@1" => {
            let o = slab_plan(params)?.0;
            let n = o.len() as u64;
            (6 * n, 2 * triangulate(&o, &[]).len() as u64 + 2 * n)
        }
        "lathe@1" => lathe_count(params, ctx.plants)?,
        "extrude@1" => {
            let (o, h) = (outline(params, "outline")?, holes(params, "holes")?);
            let n = (o.len() + h.iter().map(Vec::len).sum::<usize>()) as u64;
            (6 * n, 2 * triangulate(&o, &h).len() as u64 + 2 * n)
        }
        "tube@1" => {
            let p = path(ctx.doc, params.get("path")).ok_or_else(|| bad("path"))?;
            tube_count(params, &p)?
        }
        "ball@1" => ball_count(params)?,
        "coil@1" => {
            let p = Sampled {
                points: coil_path(params)?,
                closed: false,
            };
            tube_count(&coil_tube(params)?, &p)?
        }
        "plate@1" => plate_count(params)?,
        "display@1" => {
            display_size(params)?;
            (28, 14)
        }
        _ => return Err("kind".into()),
    };
    let declared = if shade_flat(params)? && !ctx.plants.flat_as_smooth {
        3 * triangles
    } else {
        vertices
    };
    if declared > MAX_VERTICES {
        return Err("params".into());
    }
    if kind == "slab@1" && ctx.plants.vertex_count_off_by_one {
        return Ok((declared - 1, triangles));
    }
    Ok((declared, triangles))
}

/// A prism: the plan polygon `outer` (made counter-clockwise) with `holes` (made clockwise),
/// each plan point lifted to its two caps by `lift(point, cap)`; one face per cap and per side
/// quad. Each closed part is turned outward after.
pub fn prism(outer: &[V2], holes: &[Vec<V2>], lift: impl Fn(V2, usize) -> V3) -> Mesh {
    let mut o = outer.to_vec();
    if area2(&o) < 0.0 {
        o.reverse();
    }
    let hs: Vec<Vec<V2>> = holes
        .iter()
        .map(|h| {
            let mut h = h.clone();
            if area2(&h) > 0.0 {
                h.reverse();
            }
            h
        })
        .collect();
    let tris = triangulate(&o, &hs);
    let all: Vec<V2> = o.iter().chain(hs.iter().flatten()).copied().collect();
    let mut m = Mesh::default();
    for cap in 0..2 {
        let base = m.positions.len() as u32;
        let pts: Vec<V3> = all.iter().map(|p| lift(*p, cap)).collect();
        let n = crate::geom::newell(&o.iter().map(|p| lift(*p, cap)).collect::<Vec<_>>());
        let n = if cap == 0 { n } else { scale(n, -1.0) };
        for p in &pts {
            m.vertex(*p, n);
        }
        let face = m.next_face();
        for [a, b, c] in &tris {
            if cap == 0 {
                m.tri(base + a, base + b, base + c, face);
            } else {
                m.tri(base + a, base + c, base + b, face);
            }
        }
    }
    for ring in std::iter::once(&o).chain(hs.iter()) {
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            let corners = [lift(a, 0), lift(a, 1), lift(b, 1), lift(b, 0)];
            let n = crate::geom::newell(&corners);
            let base = m.positions.len() as u32;
            for c in corners {
                m.vertex(c, n);
            }
            let face = m.next_face();
            m.quad(base, base + 1, base + 2, base + 3, face);
        }
    }
    m.close("solid", 0, holes.len() as u32);
    m
}

/// A polygon with each corner turned through a quarter-circle-ish arc of `radius`, `steps`
/// segments each.
fn rounded(o: &[V2], radius: f64, steps: usize) -> Vec<V2> {
    if radius <= 0.0 {
        return o.to_vec();
    }
    let n = o.len();
    let mut out = Vec::new();
    for k in 0..n {
        let (a, p, b) = (o[(k + n - 1) % n], o[k], o[(k + 1) % n]);
        let la = sqrt((a[0] - p[0]) * (a[0] - p[0]) + (a[1] - p[1]) * (a[1] - p[1]));
        let lb = sqrt((b[0] - p[0]) * (b[0] - p[0]) + (b[1] - p[1]) * (b[1] - p[1]));
        let u = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
        let w = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
        let half = 0.5 * acos((u[0] * w[0] + u[1] * w[1]).clamp(-1.0, 1.0));
        let t = (radius / tan(half)).min(0.5 * la.min(lb));
        let r = t * tan(half);
        let bis = [u[0] + w[0], u[1] + w[1]];
        let bl = sqrt(bis[0] * bis[0] + bis[1] * bis[1]);
        let c = [
            p[0] + bis[0] / bl * r / sin(half),
            p[1] + bis[1] / bl * r / sin(half),
        ];
        let (s, e) = (
            [p[0] + u[0] * t, p[1] + u[1] * t],
            [p[0] + w[0] * t, p[1] + w[1] * t],
        );
        let a0 = atan2(s[1] - c[1], s[0] - c[0]);
        let mut a1 = atan2(e[1] - c[1], e[0] - c[0]);
        let pi = core::f64::consts::PI;
        while a1 - a0 > pi {
            a1 -= 2.0 * pi;
        }
        while a0 - a1 > pi {
            a1 += 2.0 * pi;
        }
        for j in 0..=steps {
            let ang = a0 + (a1 - a0) * j as f64 / steps as f64;
            out.push([c[0] + r * cos(ang), c[1] + r * sin(ang)]);
        }
    }
    out
}

/// acos through atan2, the ops module's.
fn acos(x: f64) -> f64 {
    atan2(sqrt((1.0 - x * x).max(0.0)), x)
}

/// A slab's plan (x, z) and its two heights.
fn slab_plan(p: &Value) -> Result<(Vec<V2>, f64, f64), Fault> {
    let radius = num(p, "radius", 0.0)?;
    if radius < 0.0 {
        return Err(bad("radius"));
    }
    let (o, y0, y1) = match p.get("size") {
        Some(s) => {
            let s = curve::points(&Value::Array(vec![s.clone()]))
                .and_then(|v| v.first().copied())
                .filter(|s| s.iter().all(|x| *x > 0.0))
                .ok_or_else(|| bad("size"))?;
            // A slab stands on its plan: centred across it, its thickness up from it.
            let (x, z) = (s[0] / 2.0, s[2] / 2.0);
            (vec![[-x, -z], [x, -z], [x, z], [-x, z]], 0.0, s[1])
        }
        None => (outline(p, "outline")?, 0.0, positive(p, "thickness", 0.2)?),
    };
    Ok((rounded(&o, radius, 4), y0, y1))
}

fn slab(p: &Value) -> Result<Mesh, Fault> {
    let (o, y0, y1) = slab_plan(p)?;
    Ok(prism(&o, &[], |q, cap| {
        [q[0], if cap == 0 { y0 } else { y1 }, q[1]]
    }))
}

fn extrude(p: &Value) -> Result<Mesh, Fault> {
    let (o, h) = (outline(p, "outline")?, holes(p, "holes")?);
    let depth = positive(p, "depth", 0.1)?;
    let twist = rad(num(p, "twist", 0.0)?);
    Ok(prism(&o, &h, |q, cap| {
        if cap == 0 {
            [q[0], q[1], 0.0]
        } else {
            let (c, s) = (cos(twist), sin(twist));
            [q[0] * c - q[1] * s, q[0] * s + q[1] * c, depth]
        }
    }))
}

/// A lathe's outline `[[r, y, smooth]]`.
fn lathe_outline(p: &Value) -> Result<Vec<(f64, f64, bool)>, Fault> {
    let list = p
        .get("outline")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("outline"))?;
    let out: Option<Vec<(f64, f64, bool)>> = list
        .iter()
        .map(|q| {
            let a = q.as_array().filter(|a| a.len() == 2 || a.len() == 3)?;
            let r = a[0].as_f64().filter(|r| *r >= 0.0)?;
            let smooth = match a.get(2) {
                None => false,
                Some(s) => s.as_bool()?,
            };
            Some((r, a[1].as_f64()?, smooth))
        })
        .collect();
    out.filter(|o| o.len() >= 2).ok_or_else(|| bad("outline"))
}

struct LatheSpec {
    outline: Vec<(f64, f64, bool)>,
    n: usize,
    sweep: f64,
    full: bool,
    caps: String,
    closed: bool,
    axis: String,
}

fn lathe_spec(p: &Value) -> Result<LatheSpec, Fault> {
    let outline = lathe_outline(p)?;
    let n = count(p, "segments", 32, 3, 1024)? as usize;
    let sweep = num(p, "sweep", 360.0)?;
    if !(sweep > 0.0 && sweep <= 360.0) {
        return Err(bad("sweep"));
    }
    let caps = text(p, "caps", "flat", &["none", "flat", "cut"])?.to_string();
    let closed = flag(p, "closed", false)?;
    if closed && outline.len() < 3 {
        return Err(bad("outline"));
    }
    let axis = text(p, "axis", "y", &["x", "y", "z"])?.to_string();
    Ok(LatheSpec {
        outline,
        n,
        full: (sweep - 360.0).abs() < 1e-9,
        sweep,
        caps,
        closed,
        axis,
    })
}

const EPS: f64 = 1e-12;

impl LatheSpec {
    fn bands(&self) -> Vec<(usize, usize)> {
        let l = self.outline.len();
        let mut out: Vec<(usize, usize)> = (0..l - 1).map(|i| (i, i + 1)).collect();
        if self.closed {
            out.push((l - 1, 0));
        }
        out
    }

    /// The flat caps at the outline's first and last point, where its radius isn't zero.
    fn end_caps(&self, plants: Plants) -> Vec<usize> {
        if self.closed || self.caps == "none" {
            return Vec::new();
        }
        let l = self.outline.len();
        let mut ends = Vec::new();
        if self.outline[0].0 > EPS {
            ends.push(0);
        }
        if self.outline[l - 1].0 > EPS && !plants.cap_left_open {
            ends.push(l - 1);
        }
        ends
    }

    /// The profile a partial sweep's two cut faces close: the outline, through the axis when
    /// it is open.
    fn profile(&self) -> Option<Vec<V2>> {
        if self.full || self.caps == "none" {
            return None;
        }
        let mut pts: Vec<V2> = self.outline.iter().map(|(r, y, _)| [*r, *y]).collect();
        if !self.closed {
            let (first, last) = (pts[0], pts[pts.len() - 1]);
            if last[0] > EPS {
                pts.push([0.0, last[1]]);
            }
            if first[0] > EPS {
                pts.push([0.0, first[1]]);
            }
        }
        Some(pts)
    }

    fn genus(&self, plants: Plants) -> u32 {
        u32::from(self.full && self.closed && !plants.torus_genus_0)
    }

    fn is_closed(&self) -> bool {
        (self.full && (self.closed || self.caps != "none")) || (!self.full && self.caps != "none")
    }
}

fn lathe_count(p: &Value, plants: Plants) -> Result<(u64, u64), Fault> {
    let s = lathe_spec(p)?;
    let (n, rings) = (s.n as u64, s.n as u64 + 1);
    let mut v = 0;
    let mut t = 0;
    for (i, k) in s.bands() {
        let (a, b) = (s.outline[i], s.outline[k]);
        v += 2 * rings;
        if (a.0 - b.0).abs() < EPS && (a.1 - b.1).abs() < EPS {
            continue;
        }
        t += n * (u64::from(a.0 > EPS) + u64::from(b.0 > EPS));
    }
    let caps = s.end_caps(plants).len() as u64;
    v += caps * (1 + rings);
    t += caps * n;
    if let Some(profile) = s.profile() {
        v += 2 * profile.len() as u64;
        t += 2 * triangulate(&profile, &[]).len() as u64;
    }
    Ok((v, t))
}

fn lathe(p: &Value, plants: Plants) -> Result<Mesh, Fault> {
    let s = lathe_spec(p)?;
    let sweep = rad(s.sweep);
    let ring = |r: f64, y: f64, k: usize| -> V3 {
        let a = sweep * k as f64 / s.n as f64;
        [r * cos(a), y, r * sin(a)]
    };
    let turn = |v: V3, k: usize| -> V3 {
        let a = sweep * k as f64 / s.n as f64;
        [v[0] * cos(a), v[1], v[0] * sin(a)]
    };
    let bands = s.bands();
    // The outline, through the axis when open: the solid lies on its left when it turns
    // counter-clockwise in (r, y), and on its right otherwise.
    let mut around: Vec<V2> = s.outline.iter().map(|(r, y, _)| [*r, *y]).collect();
    if !s.closed {
        around.push([0.0, around[around.len() - 1][1]]);
        around.push([0.0, around[0][1]]);
    }
    let side = if area2(&around) < 0.0 { -1.0 } else { 1.0 };
    // Each band's profile normal, right of its direction in (r, y) with the solid on the left.
    let normal = |i: usize, k: usize| -> V3 {
        let (a, b) = (s.outline[i], s.outline[k]);
        unit([side * (b.1 - a.1), -side * (b.0 - a.0), 0.0])
    };
    let mut m = Mesh::default();
    for (bi, &(i, k)) in bands.iter().enumerate() {
        let nb = normal(i, k);
        // A smooth point shares its normal with the band beside it.
        let at = |j: usize, own: V3| -> V3 {
            if !s.outline[j].2 {
                return own;
            }
            let other = bands
                .iter()
                .enumerate()
                .find(|(o, (x, y))| *o != bi && (*x == j || *y == j));
            match other {
                Some((_, &(x, y))) => unit(add(own, normal(x, y))),
                None => own,
            }
        };
        let (na, nk) = (at(i, nb), at(k, nb));
        let (a, b) = (s.outline[i], s.outline[k]);
        let base = m.positions.len() as u32;
        for r in 0..=s.n {
            m.vertex(ring(a.0, a.1, r), turn([na[0], na[1], 0.0], r));
            m.vertex(ring(b.0, b.1, r), turn([nk[0], nk[1], 0.0], r));
        }
        let face_base = m.next_face();
        for r in 0..s.n as u32 {
            let (p0, q0, p1, q1) = (
                base + 2 * r,
                base + 2 * r + 1,
                base + 2 * r + 2,
                base + 2 * r + 3,
            );
            if side > 0.0 {
                m.tri(p0, q0, q1, face_base + r);
                m.tri(p0, q1, p1, face_base + r);
            } else {
                m.tri(p0, q1, q0, face_base + r);
                m.tri(p0, p1, q1, face_base + r);
            }
        }
    }
    for end in s.end_caps(plants) {
        let l = s.outline.len();
        let (r, y, _) = s.outline[end];
        let other = if end == 0 {
            s.outline[1].1
        } else {
            s.outline[l - 2].1
        };
        let n = [
            0.0,
            if y < other || (y == other && end == 0) {
                -1.0
            } else {
                1.0
            },
            0.0,
        ];
        let centre = m.vertex([0.0, y, 0.0], n);
        let base = m.positions.len() as u32;
        for k in 0..=s.n {
            m.vertex(ring(r, y, k), n);
        }
        let face = m.next_face();
        for k in 0..s.n as u32 {
            tri_facing(&mut m, centre, base + k, base + k + 1, n, face);
        }
    }
    if let Some(profile) = s.profile() {
        for (k, side) in [(0, -1.0), (s.n, 1.0)] {
            let a = sweep * k as f64 / s.n as f64;
            let n = [-sin(a) * side, 0.0, cos(a) * side];
            let pts: Vec<V3> = profile.iter().map(|q| ring(q[0], q[1], k)).collect();
            let mut pts = pts;
            if dot(crate::geom::newell(&pts), n) < 0.0 {
                pts.reverse();
            }
            m.polygon(&pts, &[]);
        }
    }
    if s.is_closed() {
        m.close("solid", 0, s.genus(plants));
    }
    let axis = s.axis.clone();
    Ok(match axis.as_str() {
        "x" => m.mapped(|p| [p[1], -p[0], p[2]], |_, n| [n[1], -n[0], n[2]]),
        "z" => m.mapped(|p| [p[0], -p[2], p[1]], |_, n| [n[0], -n[2], n[1]]),
        _ => m,
    })
}

/// A tube's frames along its path: each point's tangent and normal.
fn frames(path: &[V3], closed: bool, z_up: bool) -> Vec<(V3, V3)> {
    let n = path.len();
    let tangent = |k: usize| -> V3 {
        let (prev, next) = if closed {
            (path[(k + n - 1) % n], path[(k + 1) % n])
        } else {
            (path[k.saturating_sub(1)], path[(k + 1).min(n - 1)])
        };
        unit(sub(next, prev))
    };
    let mut out = Vec::with_capacity(n);
    let t0 = tangent(0);
    let up = if t0[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let mut normal = unit(cross(cross(t0, up), t0));
    for k in 0..n {
        let t = tangent(k);
        if z_up {
            let up = if t[2].abs() < 0.9 {
                [0.0, 0.0, 1.0]
            } else {
                [1.0, 0.0, 0.0]
            };
            normal = unit(cross(cross(t, up), t));
        } else {
            // Parallel transport: the last normal with its part along the tangent taken out.
            normal = unit(sub(normal, scale(t, dot(normal, t))));
        }
        out.push((t, normal));
    }
    out
}

/// A tube's params checked: radius, segments, twist and caps.
struct TubeSpec {
    radius: f64,
    segments: usize,
    z_up: bool,
    caps: String,
}

fn tube_spec(p: &Value) -> Result<TubeSpec, Fault> {
    Ok(TubeSpec {
        radius: positive(p, "radius", 0.05)?,
        segments: count(p, "segments", 16, 3, 512)? as usize,
        z_up: text(p, "twist", "minimum", &["minimum", "z_up"])? == "z_up",
        caps: text(p, "caps", "flat", &["none", "flat", "round"])?.to_string(),
    })
}

/// Rings in a round cap.
const ROUND: u64 = 4;

fn tube_count(p: &Value, path: &Sampled) -> Result<(u64, u64), Fault> {
    let s = tube_spec(p)?;
    let (np, ring, seg) = (
        path.points.len() as u64,
        s.segments as u64 + 1,
        s.segments as u64,
    );
    let spans = if path.closed { np } else { np - 1 };
    let mut v = np * ring;
    let mut t = 2 * seg * spans;
    if !path.closed {
        match s.caps.as_str() {
            "flat" => {
                v += 2 * (1 + ring);
                t += 2 * seg;
            }
            "round" => {
                v += 2 * ROUND * ring;
                t += 2 * (2 * seg * (ROUND - 1) + seg);
            }
            _ => {}
        }
    }
    Ok((v, t))
}

fn tube_item(p: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let path = path(ctx.doc, p.get("path")).ok_or_else(|| bad("path"))?;
    tube(p, &path)
}

fn tube(p: &Value, path: &Sampled) -> Result<Mesh, Fault> {
    let s = tube_spec(p)?;
    let pts = &path.points;
    let fr = frames(pts, path.closed, s.z_up);
    let mut m = Mesh::default();
    let ring_at = |m: &mut Mesh, centre: V3, t: V3, n: V3, r: f64| -> u32 {
        let b = cross(t, n);
        let base = m.positions.len() as u32;
        for k in 0..=s.segments {
            let a = 2.0 * core::f64::consts::PI * k as f64 / s.segments as f64;
            let dir = add(scale(n, cos(a)), scale(b, sin(a)));
            m.vertex(add(centre, scale(dir, r)), dir);
        }
        base
    };
    let rings: Vec<u32> = pts
        .iter()
        .zip(&fr)
        .map(|(c, (t, n))| ring_at(&mut m, *c, *t, *n, s.radius))
        .collect();
    let spans = if path.closed {
        pts.len()
    } else {
        pts.len() - 1
    };
    for i in 0..spans {
        let (a, b) = (rings[i], rings[(i + 1) % pts.len()]);
        let face = m.next_face();
        for k in 0..s.segments as u32 {
            m.quad(a + k, a + k + 1, b + k + 1, b + k, face + k);
        }
    }
    if !path.closed {
        for (end, sign) in [(0usize, -1.0), (pts.len() - 1, 1.0)] {
            let (t, n) = fr[end];
            let out = scale(t, sign);
            match s.caps.as_str() {
                "flat" => {
                    let centre = m.vertex(pts[end], out);
                    let base = ring_at(&mut m, pts[end], t, n, s.radius);
                    for k in 0..=s.segments as u32 {
                        m.normals[(base + k) as usize] = out;
                    }
                    let face = m.next_face();
                    for k in 0..s.segments as u32 {
                        tri_facing(&mut m, centre, base + k, base + k + 1, out, face);
                    }
                }
                "round" => {
                    let mut last = rings[end];
                    for j in 1..=ROUND {
                        let a = core::f64::consts::FRAC_PI_2 * j as f64 / ROUND as f64;
                        let centre = add(pts[end], scale(out, s.radius * sin(a)));
                        let base = ring_at(&mut m, centre, t, n, s.radius * cos(a));
                        let face = m.next_face();
                        for k in 0..s.segments as u32 {
                            let mid = scale(
                                add(
                                    m.positions[(last + k) as usize],
                                    m.positions[(base + k + 1) as usize],
                                ),
                                0.5,
                            );
                            let dir = sub(mid, pts[end]);
                            tri_facing(&mut m, last + k, last + k + 1, base + k + 1, dir, face + k);
                            tri_facing(&mut m, last + k, base + k + 1, base + k, dir, face + k);
                        }
                        last = base;
                    }
                }
                _ => {}
            }
        }
    }
    if path.closed {
        m.close("solid", 0, 1);
    } else if s.caps != "none" {
        m.close("solid", 0, 0);
    }
    Ok(m)
}

fn coil_path(p: &Value) -> Result<Vec<V3>, Fault> {
    let r = positive(p, "radius", 0.2)?;
    let pitch = positive(p, "pitch", 0.05)?;
    let turns = positive(p, "turns", 5.0)?;
    let samples = (turns * 24.0).ceil().max(2.0) as usize;
    if samples > 100_000 {
        return Err(bad("turns"));
    }
    Ok((0..=samples)
        .map(|k| {
            let f = k as f64 / samples as f64;
            let a = 2.0 * core::f64::consts::PI * turns * f;
            [r * cos(a), pitch * turns * f, r * sin(a)]
        })
        .collect())
}

/// The tube a coil sweeps: its wire's radius, eight sides, flat ends.
fn coil_tube(p: &Value) -> Result<Value, Fault> {
    Ok(serde_json::json!({"radius": positive(p, "wire", 0.01)?, "segments": 8, "caps": "flat"}))
}

fn coil(p: &Value) -> Result<Mesh, Fault> {
    let path = Sampled {
        points: coil_path(p)?,
        closed: false,
    };
    tube(&coil_tube(p)?, &path)
}

/// The two Platonic bases a geodesic ball subdivides: their corners and triangles.
fn base_solid(base: &str) -> (Vec<V3>, Vec<[usize; 3]>) {
    let phi = (1.0 + sqrt(5.0)) / 2.0;
    let corners: Vec<V3> = if base == "octa" {
        vec![
            [1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ]
    } else {
        let mut c = Vec::new();
        for a in [-1.0, 1.0] {
            for b in [-phi, phi] {
                c.push([0.0, a, b]);
                c.push([a, b, 0.0]);
                c.push([b, 0.0, a]);
            }
        }
        c
    };
    let edge = corners
        .iter()
        .skip(1)
        .map(|c| length(sub(*c, corners[0])))
        .fold(f64::INFINITY, f64::min);
    let near = |a: usize, b: usize| (length(sub(corners[a], corners[b])) - edge).abs() < 1e-9;
    let mut faces = Vec::new();
    for i in 0..corners.len() {
        for j in i + 1..corners.len() {
            for k in j + 1..corners.len() {
                if near(i, j) && near(j, k) && near(i, k) {
                    faces.push([i, j, k]);
                }
            }
        }
    }
    (corners.iter().map(|c| unit(*c)).collect(), faces)
}

fn ball_kind(p: &Value) -> Result<(&str, f64), Fault> {
    let t = text(p, "tessellation", "uv", &["uv", "geodesic"])?;
    Ok((t, positive(p, "radius", 0.5)?))
}

fn ball_count(p: &Value) -> Result<(u64, u64), Fault> {
    let (t, _) = ball_kind(p)?;
    if t == "uv" {
        let s = count(p, "segments", 32, 4, 1024)?;
        let h = (s / 2).max(2);
        return Ok(((s + 1) * (h + 1), 2 * s * (h - 1)));
    }
    let base = text(p, "base", "icosa", &["octa", "icosa"])?;
    let d = count(p, "detail", 1, 0, 6)?;
    let faces = if base == "octa" { 8 } else { 20 };
    let tris = faces * (d + 1) * (d + 1);
    Ok((3 * tris, tris))
}

fn ball(p: &Value, plants: Plants) -> Result<Mesh, Fault> {
    let (t, radius) = ball_kind(p)?;
    let mut m = Mesh::default();
    if t == "uv" {
        let s = count(p, "segments", 32, 4, 1024)? as usize;
        let h = (s / 2).max(2);
        let pi = core::f64::consts::PI;
        for j in 0..=h {
            let phi = pi * j as f64 / h as f64;
            for i in 0..=s {
                let th = 2.0 * pi * i as f64 / s as f64;
                let n = [sin(phi) * cos(th), cos(phi), sin(phi) * sin(th)];
                m.vertex(scale(n, radius), n);
            }
        }
        let at = |j: usize, i: usize| (j * (s + 1) + i) as u32;
        for j in 0..h {
            for i in 0..s {
                let face = (j * s + i) as u32;
                let (a, b, c, d) = (at(j, i), at(j + 1, i), at(j + 1, i + 1), at(j, i + 1));
                let mid = unit(add(m.positions[a as usize], m.positions[c as usize]));
                tri_facing(&mut m, a, b, c, mid, face);
                tri_facing(&mut m, a, c, d, mid, face);
            }
        }
        m.close("solid", 0, 0);
        return Ok(m);
    }
    let base = text(p, "base", "icosa", &["octa", "icosa"])?;
    let d = count(p, "detail", 1, 0, 6)? as usize;
    let r = if plants.ball_scaled {
        radius * 1.01
    } else {
        radius
    };
    let (corners, faces) = base_solid(base);
    let n = d + 1;
    for [a, b, c] in &faces {
        let (pa, pb, pc) = (corners[*a], corners[*b], corners[*c]);
        let at = |i: usize, j: usize| -> V3 {
            let k = (n - i - j) as f64;
            let q = scale(
                add(add(scale(pa, k), scale(pb, i as f64)), scale(pc, j as f64)),
                1.0 / n as f64,
            );
            unit(q)
        };
        let tri = |m: &mut Mesh, x: V3, y: V3, z: V3| {
            let ids = [x, y, z].map(|q| m.vertex(scale(q, r), q));
            let out = unit(add(add(x, y), z));
            let face = m.triangles() as u32;
            tri_facing(m, ids[0], ids[1], ids[2], out, face);
        };
        for i in 0..n {
            for j in 0..n - i {
                tri(&mut m, at(i, j), at(i + 1, j), at(i, j + 1));
                if i + j + 2 <= n {
                    tri(&mut m, at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
                }
            }
        }
    }
    m.close("solid", 0, 0);
    Ok(m)
}

fn plate_count(p: &Value) -> Result<(u64, u64), Fault> {
    let sides = if flag(p, "two_sided", false)? { 2 } else { 1 };
    if p.get("grid").is_some() {
        let (nx, ny, _) = plate_grid(p)?;
        return Ok((sides * (nx + 1) * (ny + 1), sides * 2 * nx * ny));
    }
    let o = outline(p, "outline")?;
    Ok((
        sides * o.len() as u64,
        sides * triangulate(&o, &[]).len() as u64,
    ))
}

fn plate_grid(p: &Value) -> Result<(u64, u64, [f64; 2]), Fault> {
    let g = p
        .get("grid")
        .and_then(Value::as_array)
        .filter(|g| g.len() == 2)
        .ok_or_else(|| bad("grid"))?;
    let (nx, ny) = (g[0].as_u64(), g[1].as_u64());
    let (Some(nx), Some(ny)) = (nx, ny) else {
        return Err(bad("grid"));
    };
    if !(1..=1024).contains(&nx) || !(1..=1024).contains(&ny) {
        return Err(bad("grid"));
    }
    let size = p
        .get("size")
        .and_then(v2s_one)
        .filter(|s| s[0] > 0.0 && s[1] > 0.0)
        .ok_or_else(|| bad("size"))?;
    Ok((nx, ny, size))
}

fn v2s_one(v: &Value) -> Option<V2> {
    let a = v.as_array().filter(|a| a.len() == 2)?;
    Some([a[0].as_f64()?, a[1].as_f64()?])
}

fn plate(p: &Value) -> Result<Mesh, Fault> {
    let up = [0.0, 1.0, 0.0];
    let mut m = Mesh::default();
    if p.get("grid").is_some() {
        let (nx, ny, size) = plate_grid(p)?;
        let (nx, ny) = (nx as usize, ny as usize);
        for j in 0..=ny {
            for i in 0..=nx {
                let x = size[0] * (i as f64 / nx as f64 - 0.5);
                let z = size[1] * (j as f64 / ny as f64 - 0.5);
                m.vertex([x, 0.0, z], up);
            }
        }
        let at = |i: usize, j: usize| (j * (nx + 1) + i) as u32;
        for j in 0..ny {
            for i in 0..nx {
                let face = (j * nx + i) as u32;
                tri_facing(&mut m, at(i, j), at(i + 1, j), at(i + 1, j + 1), up, face);
                tri_facing(&mut m, at(i, j), at(i + 1, j + 1), at(i, j + 1), up, face);
            }
        }
    } else {
        let o = outline(p, "outline")?;
        let mut pts: Vec<V3> = o.iter().map(|q| [q[0], 0.0, q[1]]).collect();
        if dot(crate::geom::newell(&pts), up) < 0.0 {
            pts.reverse();
        }
        m.polygon(&pts, &[]);
    }
    m.part("top", 0);
    if flag(p, "two_sided", false)? {
        let back = m.turned().mapped(|q| q, |_, n| scale(n, -1.0));
        let mut back = back;
        back.parts.clear();
        let from = m.triangles();
        m.append(&back, "");
        m.part("bottom", from);
    }
    Ok(m)
}

fn display_size(p: &Value) -> Result<(V2, f64), Fault> {
    let size = p
        .get("size")
        .and_then(v2s_one)
        .filter(|s| s[0] > 0.0 && s[1] > 0.0)
        .ok_or_else(|| bad("size"))?;
    let bezel = num(p, "bezel", 0.01)?;
    if bezel < 0.0 || 2.0 * bezel >= size[0].min(size[1]) {
        return Err(bad("bezel"));
    }
    Ok((size, bezel))
}

/// The display's depth, metres.
const DISPLAY_DEPTH: f64 = 0.04;

fn display(p: &Value) -> Result<Mesh, Fault> {
    let (size, bezel) = display_size(p)?;
    let (x, y) = (size[0] / 2.0, size[1] / 2.0);
    let rect = [[-x, -y], [x, -y], [x, y], [-x, y]];
    let mut m = prism(&rect, &[], |q, cap| {
        [
            q[0],
            q[1],
            if cap == 0 {
                -DISPLAY_DEPTH / 2.0
            } else {
                DISPLAY_DEPTH / 2.0
            },
        ]
    });
    m.parts
        .insert("body".into(), (0..m.triangles() as u32).collect());
    let from = m.triangles();
    let z = DISPLAY_DEPTH / 2.0 + 1e-4;
    let (sx, sy) = (x - bezel, y - bezel);
    m.polygon(
        &[[-sx, -sy, z], [sx, -sy, z], [sx, sy, z], [-sx, sy, z]],
        &[],
    );
    m.part("screen", from);
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn both(kind: &str, p: Value) -> (Mesh, u64) {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            doc: &doc,
            plants: Plants::default(),
        };
        (
            build(kind, &p, &ctx).unwrap(),
            estimate(kind, &p, &ctx).unwrap(),
        )
    }

    #[test]
    fn declared_counts_equal_built_counts() {
        for (kind, p) in [
            ("slab@1", json!({"size": [1, 2, 3]})),
            ("slab@1", json!({"size": [1, 1, 1], "radius": 0.1})),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0.5, 2]], "segments": 16}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0, 1]], "segments": 16}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0.5, 1]], "sweep": 180, "caps": "cut"}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.12, 0], [0.08, 0.8]], "segments": 6, "shade": "flat"}),
            ),
            ("ball@1", json!({"radius": 1, "segments": 32})),
            (
                "ball@1",
                json!({"radius": 1, "tessellation": "geodesic", "detail": 2}),
            ),
            (
                "extrude@1",
                json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "holes": [[[0.5, 0.25], [1.5, 0.25], [1.5, 0.75], [0.5, 0.75]]], "depth": 0.5}),
            ),
            (
                "tube@1",
                json!({"path": [[0, 0, 0], [0, 2, 0]], "radius": 0.5, "caps": "round"}),
            ),
            (
                "coil@1",
                json!({"radius": 0.5, "pitch": 0.2, "wire": 0.05, "turns": 3}),
            ),
            (
                "plate@1",
                json!({"grid": [4, 3], "size": [2, 1.5], "two_sided": true}),
            ),
            ("display@1", json!({"size": [0.6, 0.4], "bezel": 0.02})),
        ] {
            let (m, n) = both(kind, p.clone());
            assert_eq!(m.positions.len() as u64, n, "{kind} {p}");
        }
    }

    #[test]
    fn a_uv_ball_of_32_has_561_vertices_and_a_geodesic_icosahedron_at_detail_2_has_540() {
        assert_eq!(both("ball@1", json!({"radius": 1, "segments": 32})).1, 561);
        assert_eq!(
            both(
                "ball@1",
                json!({"radius": 1, "tessellation": "geodesic", "base": "icosa", "detail": 2})
            )
            .1,
            540
        );
    }
}
