//! The trusted builders (canvas primitives: Builder; issue #420): pure functions of their params
//! that build a mesh, each with a vertex count computable from its params alone, so a count is
//! known, and an over-budget build refused, before anything is built. A closed builder reports
//! each closed part with the genus its params give it; `shade: flat` gives every triangle its own
//! three vertices and normal (Builder: shading).

use deep_canvas::ops::{atan2, cos, rad, sin, sqrt, tan};
use deep_canvas::schedule::{HashVersion, Hasher};
use serde_json::{json, Value};

use crate::curve::{self, Sampled};
use crate::geom::{add, area2, cross, dot, length, scale, sub, triangulate, unit, Mesh, V2, V3};

/// The builder kinds, as documents name them.
pub const KINDS: [&str; 9] = [
    "hull@1",
    "slab@1",
    "lathe@1",
    "extrude@1",
    "tube@1",
    "ball@1",
    "coil@1",
    "plate@1",
    "display@1",
];

/// The builders with known charts, which emit uv1 analytically (Builder: uv; #440).
const CHARTED: [&str; 7] = [
    "slab@1",
    "lathe@1",
    "extrude@1",
    "plate@1",
    "ball@1",
    "tube@1",
    "coil@1",
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
    /// #441's plants in the sweep and the curve it reads.
    pub sweep: crate::sweep::Plants,
    /// #440's plants in the hull builder.
    pub hull: crate::hull::Plants,
    /// #443's planted outline reader: every contour filled on its own, so no counter is a hole.
    pub outline_ignores_rule: bool,
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
            "sweep_frenet" => p.sweep.frenet = true,
            "corner_square" => p.sweep.square_corners = true,
            "u_by_span" => p.sweep.u_by_span = true,
            "seam_twist_left" => p.sweep.seam_twist = true,
            "hull_keeps_face_points" => p.hull.keeps_face_points = true,
            "hull_fan_input_order" => p.hull.fan_input_order = true,
            "outline_ignores_fill_rule" => p.outline_ignores_rule = true,
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

/// Builder: shading's `shade`.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Shade {
    Smooth,
    Flat,
    ByAngle(f64),
}

fn shading(p: &Value) -> Result<Shade, Fault> {
    match p.get("shade") {
        Some(Value::Object(o)) => {
            let a = o.get("by_angle").ok_or_else(|| bad("shade"))?;
            let angle = match a.get("angle") {
                None => 30.0,
                Some(v) => v
                    .as_f64()
                    .filter(|x| (0.0..=180.0).contains(x))
                    .ok_or_else(|| bad("shade"))?,
            };
            Ok(Shade::ByAngle(angle))
        }
        _ => Ok(
            match text(p, "shade", "smooth", &["smooth", "flat", "by_angle"])? {
                "flat" => Shade::Flat,
                "by_angle" => Shade::ByAngle(30.0),
                _ => Shade::Smooth,
            },
        ),
    }
}

fn shade_flat(p: &Value) -> Result<bool, Fault> {
    Ok(shading(p)? != Shade::Smooth)
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
            Some(Sampled::bare(points, false))
        }
    }
}

/// What a builder builds with: the document (for the curves it names), the item's stable ID
/// (its seeds come from it) and the plants.
pub struct Ctx<'a> {
    pub doc: &'a Value,
    pub id: &'a str,
    pub plants: Plants,
    /// The build's outline sources (#443), which an `extrude`'s text, path or vector outline
    /// comes through; empty where nothing reads one.
    pub outlines: &'a [deep_canvas::registry::SealedOutline],
    /// The planted wrong program by name, which an outline source may hold (#443).
    pub planted: Option<&'a str>,
}

/// Builds `kind` from `params`, smooth or flat as `shade` says.
pub fn build(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let mut m = match kind {
        "slab@1" => slab(params, ctx)?,
        "lathe@1" => lathe(params, ctx.plants)?,
        "extrude@1" if params.get("along").is_some() => sweep_of(params, ctx)?.build(),
        "extrude@1" if sourced(params) => extrude_sourced(params, ctx)?,
        "extrude@1" => extrude(params)?,
        "tube@1" => tube_item(params, ctx)?,
        "ball@1" => ball(params, ctx.plants)?,
        "coil@1" => coil(params)?,
        "plate@1" if crate::terrain::of_params(params).is_some() => crate::terrain::built(params, ctx.planted)?,
        "plate@1" => plate(params)?,
        "display@1" => display(params)?,
        "hull@1" => crate::hull::hull(&hull_points(params, ctx)?, ctx.plants.hull)
            .map_err(|code| code.to_string())?,
        _ => return Err("kind".into()),
    };
    m.orient();
    if kind == "slab@1" {
        slab_parts(&mut m);
    }
    match shading(params)? {
        Shade::Flat if !ctx.plants.flat_as_smooth => m = m.flat(),
        Shade::ByAngle(angle) => m = by_angle(&m, angle),
        _ => {}
    }
    annotate(&mut m, kind, params, ctx)?;
    Ok(m)
}

/// The positions a hull takes: its `points`, or the built positions of the item (or the part)
/// `of` names, welded at 1e-6 m; never more than 4,096.
fn hull_points(p: &Value, ctx: &Ctx<'_>) -> Result<Vec<V3>, Fault> {
    let pts: Vec<V3> = match (p.get("points"), p.get("of").and_then(Value::as_str)) {
        (Some(list), None) => list
            .as_array()
            .and_then(|a| {
                a.iter()
                    .map(|q| {
                        let q = q.as_array().filter(|q| q.len() == 3)?;
                        let v = [q[0].as_f64()?, q[1].as_f64()?, q[2].as_f64()?];
                        v.iter().all(|x| x.is_finite()).then_some(v)
                    })
                    .collect::<Option<Vec<V3>>>()
            })
            .ok_or_else(|| bad("points"))?,
        (None, Some(of)) => {
            let (id, part) = match of.split_once('#') {
                Some((i, q)) => (i, Some(q)),
                None => (of, None),
            };
            let item = ctx
                .doc
                .get("items")
                .and_then(|i| i.get(id))
                .filter(|i| KINDS.contains(&i.get("kind").and_then(Value::as_str).unwrap_or("")))
                .filter(|_| id != ctx.id)
                .ok_or_else(|| bad("of"))?;
            let built = crate::build::built(ctx.doc, id, item, &Default::default(), 0.0)
                .map_err(|_| bad("of"))?;
            let m = built.mesh.ok_or_else(|| bad("of"))?;
            let tris: Vec<u32> = match part {
                None => (0..m.triangles() as u32).collect(),
                Some(q) => m
                    .parts
                    .get(q)
                    .or_else(|| m.closed.get(q).map(|c| &c.0))
                    .cloned()
                    .ok_or_else(|| bad("of"))?,
            };
            let w = m.welded();
            let mut seen = std::collections::BTreeMap::new();
            for t in tris {
                for j in 0..3 {
                    let v = m.indices[3 * t as usize + j] as usize;
                    seen.entry(w[v]).or_insert(m.positions[v]);
                }
            }
            seen.into_values().collect()
        }
        _ => return Err(bad("points")),
    };
    if pts.len() > crate::hull::MAX_POINTS {
        return Err(bad(if p.get("of").is_some() {
            "of"
        } else {
            "points"
        }));
    }
    Ok(pts)
}

/// The positions a hull declares it takes, from its params: its points, or the vertices the
/// item `of` names declares.
fn hull_count(p: &Value, ctx: &Ctx<'_>) -> Result<u64, Fault> {
    let n = match (p.get("points"), p.get("of").and_then(Value::as_str)) {
        (Some(Value::Array(a)), None) => a.len() as u64,
        (None, Some(of)) => {
            let id = of.split('#').next().unwrap_or("");
            let item = ctx
                .doc
                .get("items")
                .and_then(|i| i.get(id))
                .filter(|_| id != ctx.id)
                .ok_or_else(|| bad("of"))?;
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "hull@1" || !KINDS.contains(&kind) {
                return Err(bad("of"));
            }
            let params = item.get("params").cloned().unwrap_or(json!({}));
            let sub = Ctx { id, ..*ctx };
            counts(kind, &params, &sub)?.0
        }
        _ => return Err(bad("points")),
    };
    if n > crate::hull::MAX_POINTS as u64 {
        return Err(bad(if p.get("of").is_some() {
            "of"
        } else {
            "points"
        }));
    }
    Ok(n)
}

/// A slab's parts: `top` its faces facing up, `bottom` those facing down, `side` the rest, so
/// every face is in exactly one.
fn slab_parts(m: &mut Mesh) {
    let mut normal: std::collections::BTreeMap<u32, V3> = std::collections::BTreeMap::new();
    for t in 0..m.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| m.positions[m.indices[3 * t + j] as usize]);
        let e = normal.entry(m.faces[t]).or_insert([0.0; 3]);
        *e = add(*e, cross(sub(b, a), sub(c, a)));
    }
    for t in 0..m.triangles() {
        let n = normal[&m.faces[t]];
        let name = if n[1] > 0.9 * length(n) {
            "top"
        } else if n[1] < -0.9 * length(n) {
            "bottom"
        } else {
            "side"
        };
        m.parts.entry(name.into()).or_default().push(t as u32);
    }
}

/// `shade: by_angle`: each triangle its own three vertices, as flat, each corner's normal smooth
/// across the edges at it no sharper than `angle` (Modifier: normals, by_angle).
fn by_angle(m: &Mesh, angle: f64) -> Mesh {
    let mut out = m.flat();
    let p = crate::poly::Poly::triangles_of(m);
    let opts = crate::bevel::Normals {
        by_angle: true,
        angle,
        area: true,
        corner_angle: false,
        keep_sharp: false,
    };
    let n = crate::bevel::normals(&p, &opts, &[], &std::collections::BTreeMap::new(), 1);
    for (t, row) in n.iter().enumerate() {
        for (k, q) in row.iter().enumerate() {
            out.normals[3 * t + k] = *q;
        }
    }
    out
}

/// The vertices `kind` builds from `params`, counted without building it.
pub fn estimate(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<u64, Fault> { counts(kind, params, ctx).map(|c| c.0) }

/// The vertices `kind` declares and the triangles it builds, counted from `params` alone.
pub fn counts(kind: &str, params: &Value, ctx: &Ctx<'_>) -> Result<(u64, u64), Fault> {
    let (vertices, triangles) = match kind {
        "slab@1" => match slab_shape(params, ctx)? {
            SlabShape::Levels(levels, _) => layered_count(&levels),
            SlabShape::Along(section, path) => sweep_count(&section, &path),
        },
        "lathe@1" => lathe_count(params, ctx.plants)?,
        "extrude@1" if params.get("along").is_some() => sweep_of(params, ctx)?.counts(),
        "extrude@1" if sourced(params) => {
            let mut total = (0, 0);
            for shell in shells_of(params, ctx)? {
                let (o, h) = (shell.outer, shell.holes);
                let c = layered_count(&shaped(p_depth(params)?, o, h, params)?.0);
                total = (total.0 + c.0, total.1 + c.1);
            }
            total
        }
        "extrude@1" => layered_count(&extrude_shape(params)?.0),
        "tube@1" => {
            let p = tube_path(params, ctx)?;
            tube_count(params, &p)?
        }
        "ball@1" => ball_count(params)?,
        "coil@1" => {
            let p = Sampled::bare(coil_path(params)?, false);
            tube_count(&coil_tube(params)?, &p)?
        }
        "plate@1" if crate::terrain::of_params(params).is_some() => return crate::terrain::counted(params, ctx.planted),
        "plate@1" => plate_count(params)?,
        "display@1" => {
            display_size(params)?;
            (28, 14)
        }
        // A bound, as an implicit surface's: n points make at most n corners and 2n − 4
        // triangles (Builder `hull`).
        "hull@1" => {
            let n = hull_count(params, ctx)?;
            (n, (2 * n).saturating_sub(4))
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

/// The rings made one way round: the outline counter-clockwise, each hole clockwise.
fn oriented(outer: &[V2], holes: &[Vec<V2>]) -> (Vec<V2>, Vec<Vec<V2>>) {
    let mut o = outer.to_vec();
    if area2(&o) < 0.0 {
        o.reverse();
    }
    let hs = holes
        .iter()
        .map(|h| {
            let mut h = h.clone();
            if area2(&h) > 0.0 {
                h.reverse();
            }
            h
        })
        .collect();
    (o, hs)
}

/// One level of a prism: its outline and holes.
pub type Level = (Vec<V2>, Vec<Vec<V2>>);

/// A prism: the plan polygon `outer` (made counter-clockwise) with `holes` (made clockwise),
/// each plan point lifted to its two caps by `lift(point, cap)`; one face per cap and per side
/// quad. Each closed part is turned outward after.
pub fn prism(outer: &[V2], holes: &[Vec<V2>], lift: impl Fn(V2, usize) -> V3) -> Mesh {
    let (o, hs) = oriented(outer, holes);
    layered(&[(o.clone(), hs.clone()), (o, hs)], lift)
}

/// A prism through `levels`, each the same rings (outline, then holes, made one way round),
/// lifted to its place by `lift(point, level)`: a cap at the first and the last level and a band
/// of side quads between each two, so a level whose rings are inset bevels the edge.
pub fn layered(levels: &[Level], lift: impl Fn(V2, usize) -> V3) -> Mesh {
    let last = levels.len() - 1;
    let rings = |l: usize| -> Vec<&Vec<V2>> {
        std::iter::once(&levels[l].0)
            .chain(levels[l].1.iter())
            .collect()
    };
    let mut m = Mesh::default();
    for (cap, l) in [(0, 0), (1, last)] {
        let (o, hs) = &levels[l];
        let tris = triangulate(o, hs);
        let base = m.positions.len() as u32;
        let n = crate::geom::newell(&o.iter().map(|p| lift(*p, l)).collect::<Vec<_>>());
        let n = if cap == 0 { n } else { scale(n, -1.0) };
        for p in o.iter().chain(hs.iter().flatten()) {
            m.vertex(lift(*p, l), n);
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
    for l in 0..last {
        for (lo, hi) in rings(l).into_iter().zip(rings(l + 1)) {
            for k in 0..lo.len() {
                let j = (k + 1) % lo.len();
                let corners = [
                    lift(lo[k], l),
                    lift(hi[k], l + 1),
                    lift(hi[j], l + 1),
                    lift(lo[j], l),
                ];
                let n = crate::geom::newell(&corners);
                let base = m.positions.len() as u32;
                for c in corners {
                    m.vertex(c, n);
                }
                let face = m.next_face();
                m.quad(base, base + 1, base + 2, base + 3, face);
            }
        }
    }
    m.close("solid", 0, levels[0].1.len() as u32);
    m
}

/// What [`layered`] makes of `levels`: its vertices and triangles.
fn layered_count(levels: &[Level]) -> (u64, u64) {
    let n = (levels[0].0.len() + levels[0].1.iter().map(Vec::len).sum::<usize>()) as u64;
    let bands = levels.len() as u64 - 1;
    let tris: u64 = [&levels[0], &levels[levels.len() - 1]]
        .iter()
        .map(|l| triangulate(&l.0, &l.1).len() as u64)
        .sum();
    (2 * n + 4 * n * bands, tris + 2 * n * bands)
}

/// Each corner of a ring moved `d` toward the solid along its mitre (the ring counter-clockwise
/// for an outline, clockwise for a hole, so the solid lies on its left).
fn inset(ring: &[V2], d: f64) -> Vec<V2> {
    let n = ring.len();
    let left = |u: V2, v: V2| -> V2 {
        let (dx, dy) = (v[0] - u[0], v[1] - u[1]);
        let l = sqrt(dx * dx + dy * dy).max(1e-15);
        [-dy / l, dx / l]
    };
    (0..n)
        .map(|k| {
            let (a, p, b) = (ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]);
            let (n1, n2) = (left(a, p), left(p, b));
            let m = [n1[0] + n2[0], n1[1] + n2[1]];
            let ml = sqrt(m[0] * m[0] + m[1] * m[1]).max(1e-15);
            let m = [m[0] / ml, m[1] / ml];
            let reach = d / (m[0] * n1[0] + m[1] * n1[1]).max(1e-6);
            [p[0] + m[0] * reach, p[1] + m[1] * reach]
        })
        .collect()
}

/// Levels for a plan from `y0` to `y1`, its far edge bevelled by `bevel` (none when 0).
fn bevelled(
    o: Vec<V2>,
    h: Vec<Vec<V2>>,
    y0: f64,
    y1: f64,
    bevel: f64,
) -> Result<(Vec<Level>, Vec<f64>), Fault> {
    if bevel < 0.0 || bevel >= y1 - y0 {
        return Err(bad("bevel"));
    }
    let (o, h) = oriented(&o, &h);
    if bevel == 0.0 {
        return Ok((vec![(o.clone(), h.clone()), (o, h)], vec![y0, y1]));
    }
    let top: Level = (
        inset(&o, bevel),
        h.iter().map(|r| inset(r, bevel)).collect(),
    );
    if area2(&top.0) <= 0.0 {
        return Err(bad("bevel"));
    }
    Ok((
        vec![(o.clone(), h.clone()), (o, h), top],
        vec![y0, y1 - bevel, y1],
    ))
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

/// A slab's shape: plan levels with their heights, or a section swept along a path.
enum SlabShape {
    Levels(Vec<Level>, Vec<f64>),
    Along(Vec<V2>, Vec<V3>),
}

/// A slab's `groove {depth, width}`: a channel along x down the middle of its top.
fn groove_of(p: &Value) -> Result<Option<(f64, f64)>, Fault> {
    let Some(g) = p.get("groove") else {
        return Ok(None);
    };
    let (d, w) = (num(g, "depth", 0.0)?, num(g, "width", 0.0)?);
    if d <= 0.0 || w <= 0.0 {
        return Err(bad("groove"));
    }
    Ok(Some((d, w)))
}

fn slab_size(p: &Value, what: &str) -> Result<V3, Fault> {
    p.get("size")
        .and_then(|s| curve::points(&Value::Array(vec![s.clone()])))
        .and_then(|v| v.first().copied())
        .filter(|s| s.iter().all(|x| *x > 0.0))
        .ok_or_else(|| bad(what))
}

/// The part of `path` from `from` to `to` of its length.
fn stretch(path: &Sampled, from: f64, to: f64) -> Vec<V3> {
    let length = path.length();
    let mut pts = vec![path.at(from * length).0];
    let mut line = path.points.clone();
    if path.closed {
        line.push(path.points[0]);
    }
    let mut run = 0.0;
    for w in line.windows(2) {
        run += crate::geom::length(sub(w[1], w[0]));
        if run > from * length + 1e-9 && run < to * length - 1e-9 {
            pts.push(w[1]);
        }
    }
    pts.push(path.at(to * length).0);
    pts
}

fn slab_shape(p: &Value, ctx: &Ctx<'_>) -> Result<SlabShape, Fault> {
    let bevel = num(p, "bevel", 0.0)?;
    if let Some(along) = p.get("along") {
        // Along a path: the size's z across it and y up, from `from` to `to` of its length.
        let s = slab_size(p, "along")?;
        let path = path(ctx.doc, along.get("path")).ok_or_else(|| bad("along"))?;
        let (from, to) = (num(along, "from", 0.0)?, num(along, "to", 1.0)?);
        if !(0.0..1.0).contains(&from) || to <= from || to > 1.0 {
            return Err(bad("along"));
        }
        let (hz, h) = (s[2] / 2.0, s[1]);
        let section = vec![[-hz, 0.0], [hz, 0.0], [hz, h], [-hz, h]];
        return Ok(SlabShape::Along(section, stretch(&path, from, to)));
    }
    if let Some((depth, width)) = groove_of(p)? {
        let s = slab_size(p, "groove")?;
        let (hz, h) = (s[2] / 2.0, s[1]);
        if depth >= h || width >= 2.0 * hz || bevel != 0.0 || num(p, "radius", 0.0)? != 0.0 {
            return Err(bad("groove"));
        }
        // The section across x, swept along x: its levels are the slab's two ends.
        let w = width / 2.0;
        let section = vec![
            [-hz, 0.0],
            [hz, 0.0],
            [hz, h],
            [w, h],
            [w, h - depth],
            [-w, h - depth],
            [-w, h],
            [-hz, h],
        ];
        let (o, hs) = oriented(&section, &[]);
        let levels = vec![(o.clone(), hs.clone()), (o, hs)];
        return Ok(SlabShape::Levels(levels, vec![-s[0] / 2.0, s[0] / 2.0]));
    }
    let (o, y0, y1) = slab_plan(p)?;
    let (levels, heights) = bevelled(o, Vec::new(), y0, y1, bevel)?;
    Ok(SlabShape::Levels(levels, heights))
}

fn slab(p: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let grooved = groove_of(p)?.is_some() && p.get("along").is_none();
    Ok(match slab_shape(p, ctx)? {
        SlabShape::Levels(levels, x) if grooved => layered(&levels, |q, l| [x[l], q[1], q[0]]),
        SlabShape::Levels(levels, y) => layered(&levels, |q, l| [q[0], y[l], q[1]]),
        SlabShape::Along(section, path) => sweep(&section, &path),
    })
}

/// A point of a section (x across, y up) at a path point's frame.
fn place(c: V3, (t, n): (V3, V3), q: V2) -> V3 {
    add(c, add(scale(cross(t, n), q[0]), scale(n, q[1])))
}

/// A closed section (x across, y up) swept along an open path, with flat ends.
fn sweep(section: &[V2], path: &[V3]) -> Mesh {
    let (section, _) = oriented(section, &[]);
    let fr = frames(path, false, false);
    let mid = section.iter().map(|q| q[1]).sum::<f64>() / section.len() as f64;
    let mut m = Mesh::default();
    let mut rings = Vec::with_capacity(path.len());
    for (c, f) in path.iter().zip(&fr) {
        rings.push(m.positions.len() as u32);
        for q in &section {
            let out = unit(sub(place(*c, *f, *q), place(*c, *f, [0.0, mid])));
            m.vertex(place(*c, *f, *q), out);
        }
    }
    let s = section.len() as u32;
    for i in 0..path.len() - 1 {
        let (a, b) = (rings[i], rings[i + 1]);
        for k in 0..s {
            let j = (k + 1) % s;
            // Outward: right of the section's edge, across the path.
            let (q0, q1) = (section[k as usize], section[j as usize]);
            let (t, n) = fr[i];
            let out = add(
                scale(cross(t, n), q1[1] - q0[1]),
                scale(n, -(q1[0] - q0[0])),
            );
            let face = m.next_face();
            tri_facing(&mut m, a + k, a + j, b + j, out, face);
            tri_facing(&mut m, a + k, b + j, b + k, out, face);
        }
    }
    for (end, sign) in [(0usize, -1.0), (path.len() - 1, 1.0)] {
        let mut pts: Vec<V3> = section
            .iter()
            .map(|q| place(path[end], fr[end], *q))
            .collect();
        if dot(crate::geom::newell(&pts), scale(fr[end].0, sign)) < 0.0 {
            pts.reverse();
        }
        m.polygon(&pts, &[]);
    }
    m.close("solid", 0, 0);
    m
}

fn sweep_count(section: &[V2], path: &[V3]) -> (u64, u64) {
    let (s, n) = (section.len() as u64, path.len() as u64);
    let caps = 2 * triangulate(section, &[]).len() as u64;
    (n * s + 2 * s, 2 * s * (n - 1) + caps)
}

/// An `extrude@1` with `along`: its outline and holes swept along the curve it names.
fn sweep_of(p: &Value, ctx: &Ctx<'_>) -> Result<crate::sweep::Sweep, Fault> {
    let (o, h) = oriented(&outline(p, "outline")?, &holes(p, "holes")?);
    crate::sweep::Sweep::new(p, o, h, ctx.doc, ctx.plants.sweep)
}

/// An extrusion's levels from `from` to `to` along `up`, its far edge bevelled, their places
/// along `up`, `up`, and the twist it turns through by the far end.
type Extrusion = (Vec<Level>, Vec<f64>, V3, f64);

fn extrude_shape(p: &Value) -> Result<Extrusion, Fault> {
    if p.get("levels").is_some() {
        return extrude_levels(p);
    }
    let (o, h) = (outline(p, "outline")?, holes(p, "holes")?);
    shaped(p_depth(p)?, o, h, p)
}

/// An `extrude`'s span along its axis: from, to and up.
fn p_depth(p: &Value) -> Result<(f64, f64, V3), Fault> {
    let (from, to, up) = match p.get("depth") {
        Some(d @ Value::Object(_)) => {
            let up = match d.get("up") {
                None => [0.0, 0.0, 1.0],
                Some(u) => curve::points(&Value::Array(vec![u.clone()]))
                    .and_then(|v| v.first().copied())
                    .filter(|u| crate::geom::length(*u) > 1e-9)
                    .map(unit)
                    .ok_or_else(|| bad("depth"))?,
            };
            (num(d, "from", 0.0)?, num(d, "to", 0.1)?, up)
        }
        _ => (0.0, positive(p, "depth", 0.1)?, [0.0, 0.0, 1.0]),
    };
    if to <= from {
        return Err(bad("depth"));
    }
    Ok((from, to, up))
}

/// One outline with its holes extruded over `depth`, bevelled and twisted as `p` says.
fn shaped(
    depth: (f64, f64, V3),
    o: Vec<V2>,
    h: Vec<Vec<V2>>,
    p: &Value,
) -> Result<Extrusion, Fault> {
    let (from, to, up) = depth;
    let (levels, heights) = bevelled(o, h, from, to, num(p, "bevel", 0.0)?)?;
    Ok((levels, heights, up, rad(num(p, "twist", 0.0)?)))
}

/// An `extrude` whose `outline` names a source: `{text}`, `{path}` or `{vector}` (#443).
pub fn sourced(p: &Value) -> bool {
    p.get("outline")
        .is_some_and(|o| o.is_object() && deep_canvas::outline::form_of(o).is_some())
}

/// A refusal a builder raises with its own code, beside the path it names (#443).
pub fn coded(code: &str, path: &str) -> Fault {
    format!("{code}{CODED}{path}")
}

/// What splits a [`coded`] fault's code from its path.
pub const CODED: char = '\u{1f}';

/// The codes an outline source refuses with (#443), beside `module_missing`.
pub const OUTLINE_CODES: [&str; 5] = [
    "module_missing",
    "outline.stroke",
    "ref_unresolved",
    "asset_missing",
    "text.glyph_missing",
];

/// The outlines an `extrude`'s `outline` names, through the build's outline sources, and the
/// shells their fill rule makes of them, in meters in the item's plane.
pub fn outlines_of(p: &Value, ctx: &Ctx<'_>) -> Result<deep_canvas::outline::Outlines, Fault> {
    let o = p.get("outline").ok_or_else(|| bad("outline"))?;
    let form = deep_canvas::outline::form_of(o).ok_or_else(|| bad("outline"))?;
    let size = o
        .get("size")
        .and_then(Value::as_f64)
        .filter(|s| s.is_finite() && *s > 0.0)
        .ok_or_else(|| bad("outline/size"))?;
    let flatten = num(p, "flatten", 0.001)?;
    if !(flatten > 0.0 && flatten <= 0.1) {
        return Err(bad("flatten"));
    }
    let source = ctx
        .outlines
        .iter()
        .find(|s| s.form == form)
        .ok_or_else(|| {
            coded(
                "module_missing",
                deep_canvas::outline::module_of(form).unwrap_or(form),
            )
        })?;
    let none = |_: &str| None;
    let request = deep_canvas::outline::Request {
        outline: o,
        size,
        flatten,
        doc: ctx.doc,
        bytes: &none,
        planted: ctx.planted,
    };
    (source.fill)(&request).map_err(|r| coded(r.code, &r.path))
}

fn shells_of(p: &Value, ctx: &Ctx<'_>) -> Result<Vec<deep_canvas::outline::Shell>, Fault> {
    let o = outlines_of(p, ctx)?;
    let shells = deep_canvas::outline::shells(&o, ctx.plants.outline_ignores_rule);
    if shells.is_empty() {
        return Err(bad("outline"));
    }
    Ok(shells)
}

/// Each shell its fill rule makes of the outlines, extruded; the shells of one glyph or one item
/// make one closed part, named as the source names them (`glyph<k>` for text), its genus their
/// holes'.
fn extrude_sourced(p: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let depth = p_depth(p)?;
    let mut m = Mesh::default();
    for shell in shells_of(p, ctx)? {
        let name = shell.of.split(' ').next().unwrap_or("solid").to_string();
        let (levels, z, up, twist) = shaped(depth, shell.outer, shell.holes, p)?;
        let (z0, z1) = (z[0], z[z.len() - 1]);
        let mut one = layered(&levels, |q, l| {
            let a = twist * (z[l] - z0) / (z1 - z0);
            let (c, s) = (cos(a), sin(a));
            add(
                [q[0] * c - q[1] * s, q[0] * s + q[1] * c, 0.0],
                scale(up, z[l]),
            )
        });
        let (tris, genus) = one.closed.remove("solid").unwrap_or_default();
        let base = m.triangles() as u32;
        m.append(&one, "");
        let entry = m.closed.entry(name).or_default();
        entry.0.extend(tris.iter().map(|t| t + base));
        entry.1 += genus;
    }
    Ok(m)
}

/// `levels: [[z, polygon]]`, in place of the outline, holes, depth and bevel: a prism through
/// each polygon at its height, rising, every polygon with the first's point count and turned the
/// same way, so a familiar extrusion's bevel layers keep their own corners (#433).
fn extrude_levels(p: &Value) -> Result<Extrusion, Fault> {
    let list = p
        .get("levels")
        .and_then(Value::as_array)
        .filter(|l| l.len() >= 2)
        .ok_or_else(|| bad("levels"))?;
    let mut levels: Vec<Level> = Vec::new();
    let mut heights = Vec::new();
    for l in list {
        let pair = l
            .as_array()
            .filter(|a| a.len() == 2)
            .ok_or_else(|| bad("levels"))?;
        let z = pair[0]
            .as_f64()
            .filter(|z| z.is_finite())
            .ok_or_else(|| bad("levels"))?;
        let ring = v2s(&pair[1])
            .filter(|r| r.len() >= 3)
            .ok_or_else(|| bad("levels"))?;
        if heights.last().is_some_and(|last| z <= *last)
            || levels
                .first()
                .is_some_and(|f: &Level| f.0.len() != ring.len())
        {
            return Err(bad("levels"));
        }
        heights.push(z);
        levels.push((ring, Vec::new()));
    }
    // One way round for every level, as the first is made counter-clockwise.
    if area2(&levels[0].0) < 0.0 {
        for l in &mut levels {
            l.0.reverse();
        }
    }
    Ok((levels, heights, [0.0, 0.0, 1.0], rad(num(p, "twist", 0.0)?)))
}

fn extrude(p: &Value) -> Result<Mesh, Fault> {
    let (levels, z, up, twist) = extrude_shape(p)?;
    let (z0, z1) = (z[0], z[z.len() - 1]);
    Ok(layered(&levels, |q, l| {
        let a = twist * (z[l] - z0) / (z1 - z0);
        let (c, s) = (cos(a), sin(a));
        add(
            [q[0] * c - q[1] * s, q[0] * s + q[1] * c, 0.0],
            scale(up, z[l]),
        )
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
    /// `ribs {count, depth, span}`: grooves `depth` deep for `span` of each of `count` turns.
    ribs: Option<(f64, f64, f64)>,
    /// `thread {pitch, depth}`: a helix `depth` proud, `pitch` a turn.
    thread: Option<(f64, f64)>,
    /// `rim`: the plan each ring follows instead of a circle, counter-clockwise in (x, z).
    rim: Option<Vec<V2>>,
    /// `bands [{y0, y1, material}]`: named parts between two heights.
    bands: Vec<(f64, f64, Value)>,
}

fn lathe_spec(p: &Value) -> Result<LatheSpec, Fault> {
    let outline = lathe_outline(p)?;
    let n = count(p, "segments", 32, 3, 1024)? as usize;
    let sweep = num(p, "sweep", 360.0)?;
    if !(sweep > 0.0 && sweep <= 360.0) {
        return Err(bad("sweep"));
    }
    if !num(p, "from", 0.0)?.is_finite() {
        return Err(bad("from"));
    }
    let caps = text(p, "caps", "flat", &["none", "flat", "cut"])?.to_string();
    let closed = flag(p, "closed", false)?;
    if closed && outline.len() < 3 {
        return Err(bad("outline"));
    }
    let axis = text(p, "axis", "y", &["x", "y", "z"])?.to_string();
    let full = (sweep - 360.0).abs() < 1e-9;
    let ribs = match p.get("ribs") {
        None => None,
        Some(r) => {
            let (c, d, s) = (
                num(r, "count", 0.0)?,
                num(r, "depth", 0.0)?,
                num(r, "span", 0.5)?,
            );
            if c < 1.0 || c.fract() != 0.0 || d <= 0.0 || !(0.0..1.0).contains(&s) {
                return Err(bad("ribs"));
            }
            Some((c, d, s))
        }
    };
    let thread = match p.get("thread") {
        None => None,
        Some(t) => {
            let (pitch, d) = (num(t, "pitch", 0.0)?, num(t, "depth", 0.0)?);
            if pitch <= 0.0 || d <= 0.0 {
                return Err(bad("thread"));
            }
            Some((pitch, d))
        }
    };
    let rim = match p.get("rim") {
        None => None,
        Some(_) if !full => return Err(bad("rim")),
        Some(_) => {
            let mut r = self::outline(p, "rim")?;
            if area2(&r) < 0.0 {
                r.reverse();
            }
            Some(r)
        }
    };
    let bands = match p.get("bands") {
        None => Vec::new(),
        Some(Value::Array(list)) => list
            .iter()
            .map(|b| {
                Ok((
                    num(b, "y0", 0.0)?,
                    num(b, "y1", 0.0)?,
                    b.get("material").cloned().unwrap_or(Value::Null),
                ))
            })
            .collect::<Result<_, Fault>>()
            .map_err(|_| bad("bands"))?,
        Some(_) => return Err(bad("bands")),
    };
    Ok(LatheSpec {
        outline,
        n: rim.as_ref().map_or(n, Vec::len),
        full,
        sweep,
        caps,
        closed,
        axis,
        ribs,
        thread,
        rim,
        bands,
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
    // A ring's point: on the circle or the rim, its radius grooved by ribs and raised by a
    // thread, both of which close where the ring does.
    let ring = |r: f64, y: f64, k: usize| -> V3 {
        let f = k as f64 / s.n as f64;
        let mut r = r;
        if r > EPS {
            if let Some((count, depth, span)) = s.ribs {
                if (count * f).fract() < span {
                    r = (r - depth).max(0.0);
                }
            }
            if let Some((pitch, depth)) = s.thread {
                let turn = 2.0 * core::f64::consts::PI * (y / pitch + f);
                r += depth * 0.5 * (1.0 + sin(turn));
            }
        }
        match &s.rim {
            Some(rim) => {
                let q = rim[k % rim.len()];
                [r * q[0], y, r * q[1]]
            }
            None => {
                let a = sweep * f;
                [r * cos(a), y, r * sin(a)]
            }
        }
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
    for (i, (y0, y1, material)) in s.bands.iter().enumerate() {
        let name = format!("band.{i}");
        let tris: Vec<u32> = (0..m.triangles() as u32)
            .filter(|&t| {
                let k = 3 * t as usize;
                let y = (0..3)
                    .map(|j| m.positions[m.indices[k + j] as usize][1])
                    .sum::<f64>()
                    / 3.0;
                (*y0..=*y1).contains(&y)
            })
            .collect();
        m.parts.insert(name.clone(), tris);
        m.outputs
            .entry("bands".into())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .expect("a list")
            .push(json!({"part": name, "material": material}));
    }
    // `from`: the sweep starts that far round, from +x toward +z (#433).
    let from = rad(num(p, "from", 0.0)?);
    let m = if from == 0.0 {
        m
    } else {
        let (c, sn) = (cos(from), sin(from));
        let turn = move |v: V3| [v[0] * c - v[2] * sn, v[1], v[0] * sn + v[2] * c];
        m.mapped(turn, move |_, n| turn(n))
    };
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

/// A tube's path, each corner rounded through `bend` when it has one.
fn tube_path(p: &Value, ctx: &Ctx<'_>) -> Result<Sampled, Fault> {
    let path = path(ctx.doc, p.get("path")).ok_or_else(|| bad("path"))?;
    let bend = num(p, "bend", 0.0)?;
    if bend < 0.0 {
        return Err(bad("bend"));
    }
    if bend == 0.0 {
        return Ok(path);
    }
    let pts = &path.points;
    let n = pts.len();
    let mut out = Vec::new();
    for k in 0..n {
        let corner = path.closed || (k > 0 && k + 1 < n);
        if !corner {
            out.push(pts[k]);
            continue;
        }
        let (a, c, b) = (pts[(k + n - 1) % n], pts[k], pts[(k + 1) % n]);
        let (da, db) = (sub(a, c), sub(b, c));
        let t = bend
            .min(0.5 * crate::geom::length(da))
            .min(0.5 * crate::geom::length(db));
        let (s0, s1) = (add(c, scale(unit(da), t)), add(c, scale(unit(db), t)));
        // The corner as a quadratic Bézier from one tangent point to the other.
        for j in 0..=BEND_STEPS {
            let u = j as f64 / BEND_STEPS as f64;
            let q = add(
                add(
                    scale(s0, (1.0 - u) * (1.0 - u)),
                    scale(c, 2.0 * u * (1.0 - u)),
                ),
                scale(s1, u * u),
            );
            out.push(q);
        }
    }
    Ok(Sampled::bare(out, path.closed))
}

/// Segments in a bent tube's corner.
const BEND_STEPS: usize = 4;

fn tube_item(p: &Value, ctx: &Ctx<'_>) -> Result<Mesh, Fault> {
    let path = tube_path(p, ctx)?;
    let mut m = tube(p, &path)?;
    if !path.closed {
        let (first, last) = (path.points[0], path.points[path.points.len() - 1]);
        let fr = frames(&path.points, false, false);
        for (name, at, (t, n)) in [("start", first, fr[0]), ("end", last, fr[fr.len() - 1])] {
            m.anchors.insert(name.into(), [at, cross(t, n), n, t]);
        }
    }
    Ok(m)
}

fn tube(p: &Value, path: &Sampled) -> Result<Mesh, Fault> {
    let s = tube_spec(p)?;
    let pts = &path.points;
    let mut fr = frames(pts, path.closed, s.z_up);
    // `normal`: the first ring's normal, carried along by parallel transport (#433).
    if let Some(n0) = p.get("normal") {
        let n0 = curve::points(&Value::Array(vec![n0.clone()]))
            .and_then(|v| v.first().copied())
            .ok_or_else(|| bad("normal"))?;
        let mut normal = n0;
        for (t, n) in fr.iter_mut() {
            normal = sub(normal, scale(*t, dot(normal, *t)));
            if length(normal) < 1e-9 {
                return Err(bad("normal"));
            }
            normal = unit(normal);
            *n = normal;
        }
    }
    if !s.z_up && path.normals.len() == pts.len() {
        // Along a curve@1, its own rotation-minimizing frames, so a closed tube has no seam.
        for (k, ((t, n), cn)) in fr.iter_mut().zip(&path.normals).enumerate() {
            if let Some(ct) = path.tangents.get(k) {
                *t = *ct;
            }
            *n = unit(sub(*cn, scale(*t, dot(*cn, *t))));
        }
    }
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
    // Each ring as the `geometry` call reports it, at its point's u along the path.
    let total = path.length().max(1e-15);
    let mut run = 0.0;
    let mut rows = Vec::with_capacity(pts.len());
    for (i, ((c, (t, n)), base)) in pts.iter().zip(&fr).zip(&rings).enumerate() {
        if i > 0 {
            run += length(sub(*c, pts[i - 1]));
        }
        let u = path.us.get(i).copied().unwrap_or(run / total);
        let f = crate::curve::Frame {
            point: *c,
            tangent: *t,
            normal: *n,
        };
        rows.push(crate::sweep::ring_row(
            u,
            1.0,
            0.0,
            &f,
            (*base..base + s.segments as u32).collect(),
        ));
    }
    m.outputs.insert("rings".into(), Value::Array(rows));
    // The tube's own layout (Builder: uv, natural): round its rings by arc, along its path by length.
    let around = 2.0 * core::f64::consts::PI * s.radius;
    let mut lay: Vec<(u32, f64)> = Vec::with_capacity(pts.len());
    let mut run = 0.0;
    for (i, base) in rings.iter().enumerate() {
        if i > 0 {
            run += length(sub(pts[i], pts[i - 1]));
        }
        lay.push((*base, run));
    }
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
                        let along = lay.iter().find(|r| r.0 == rings[end]).map_or(0.0, |r| r.1);
                        lay.push((base, along + sign * s.radius * a));
                    }
                }
                _ => {}
            }
        }
    }
    let mut natural = vec![[f64::NAN; 2]; m.positions.len()];
    for (base, v) in lay {
        for k in 0..=s.segments {
            natural[base as usize + k] = [around * k as f64 / s.segments as f64, v];
        }
    }
    m.uv0 = natural;
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
    let path = Sampled::bare(coil_path(p)?, false);
    tube(&coil_tube(p)?, &path)
}

/// The four Platonic bases a geodesic ball subdivides (Builder `ball`: tessellation): their corners
/// on the unit sphere and triangles, each wound outward.
fn base_solid(base: &str) -> (Vec<V3>, Vec<[usize; 3]>) {
    let phi = (1.0 + sqrt(5.0)) / 2.0;
    if base == "dodeca" {
        return dodeca(phi);
    }
    let corners: Vec<V3> = if base == "tetra" {
        // Alternate corners of the cube, as web 3D libraries place them (#433).
        vec![
            [1.0, 1.0, 1.0],
            [-1.0, -1.0, 1.0],
            [-1.0, 1.0, -1.0],
            [1.0, -1.0, -1.0],
        ]
    } else if base == "octa" {
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

/// A geodesic ball's bases.
const BASES: &[&str] = &["tetra", "octa", "icosa", "dodeca"];

/// The dodecahedron: the cube's corners and three golden rectangles' (#433), each pentagon the
/// five corners nearest one of the icosahedron's corners, fanned from its first in turn.
fn dodeca(phi: f64) -> (Vec<V3>, Vec<[usize; 3]>) {
    let r = 1.0 / phi;
    let mut c: Vec<V3> = Vec::new();
    for x in [-1.0, 1.0] {
        for y in [-1.0, 1.0] {
            for z in [-1.0, 1.0] {
                c.push([x, y, z]);
            }
        }
    }
    for a in [-1.0, 1.0] {
        for b in [-1.0, 1.0] {
            c.push([0.0, a * r, b * phi]);
            c.push([a * r, b * phi, 0.0]);
            c.push([b * phi, 0.0, a * r]);
        }
    }
    let mut faces = Vec::new();
    for a in [-1.0, 1.0] {
        for b in [-phi, phi] {
            for d in [[0.0, a, b], [a, b, 0.0], [b, 0.0, a]] {
                let d = unit(d);
                let mut near: Vec<(f64, usize)> = c
                    .iter()
                    .enumerate()
                    .map(|(i, v)| (-dot(unit(*v), d), i))
                    .collect();
                near.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
                let five: Vec<usize> = near[..5].iter().map(|n| n.1).collect();
                // Round the face's normal, counter-clockwise from outside.
                let e1 = unit(sub(unit(c[five[0]]), scale(d, dot(unit(c[five[0]]), d))));
                let e2 = cross(d, e1);
                let mut around: Vec<(f64, usize)> = five
                    .iter()
                    .map(|&i| {
                        let v = unit(c[i]);
                        (atan2(dot(v, e2), dot(v, e1)), i)
                    })
                    .collect();
                around.sort_by(|x, y| x.0.total_cmp(&y.0));
                for k in 1..4 {
                    faces.push([around[0].1, around[k].1, around[k + 1].1]);
                }
            }
        }
    }
    (c.iter().map(|v| unit(*v)).collect(), faces)
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
    let base = text(p, "base", "icosa", BASES)?;
    let d = count(p, "detail", 0, 0, 5)?;
    let faces = match base {
        "tetra" => 4,
        "octa" => 8,
        "dodeca" => 36,
        _ => 20,
    };
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
    let base = text(p, "base", "icosa", BASES)?;
    let d = count(p, "detail", 0, 0, 5)? as usize;
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
        // Detail 0 is the solid itself, its faces flat; finer, each vertex's normal its own.
        let flat = d == 0;
        let tri = |m: &mut Mesh, x: V3, y: V3, z: V3| {
            let face_n = unit(cross(sub(y, x), sub(z, x)));
            let out = unit(add(add(x, y), z));
            let face_n = if crate::geom::dot(face_n, out) < 0.0 {
                scale(face_n, -1.0)
            } else {
                face_n
            };
            let ids = [x, y, z].map(|q| m.vertex(scale(q, r), if flat { face_n } else { q }));
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
    if let Some(field) = p.get("height") {
        for k in 0..m.positions.len() {
            let q = m.positions[k];
            m.positions[k][1] += height_at(field, q[0], q[2]).ok_or_else(|| bad("height"))?;
        }
        smooth_normals(&mut m, up);
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

/// A plate's `height` field at (x, z), metres: a number, `{wave: {amplitude, wavelength,
/// direction}}` or `{noise: {amplitude, scale, seed}}` (value noise on a lattice `scale` apart).
pub(crate) fn height_at(field: &Value, x: f64, z: f64) -> Option<f64> {
    if let Some(h) = field.as_f64() {
        return Some(h);
    }
    if let Some(w) = field.get("wave") {
        let a = w.get("amplitude")?.as_f64()?;
        let l = w.get("wavelength")?.as_f64().filter(|l| *l > 0.0)?;
        let d = rad(w.get("direction").and_then(Value::as_f64).unwrap_or(0.0));
        return Some(a * sin(2.0 * core::f64::consts::PI * (x * cos(d) + z * sin(d)) / l));
    }
    let n = field.get("noise")?;
    let a = n.get("amplitude")?.as_f64()?;
    let s = n.get("scale")?.as_f64().filter(|s| *s > 0.0)?;
    let seed = n.get("seed").and_then(Value::as_u64).unwrap_or(0);
    let (u, v) = (x / s, z / s);
    let (i, j) = (u.floor(), v.floor());
    let (fu, fv) = (u - i, v - j);
    let corner = |di: f64, dj: f64| -> f64 {
        let h = mix64(
            seed ^ mix64((i + di) as i64 as u64) ^ mix64(((j + dj) as i64 as u64).rotate_left(17)),
        );
        (h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    };
    let (sx, sz) = (fu * fu * (3.0 - 2.0 * fu), fv * fv * (3.0 - 2.0 * fv));
    let top = corner(0.0, 0.0) * (1.0 - sx) + corner(1.0, 0.0) * sx;
    let bottom = corner(0.0, 1.0) * (1.0 - sx) + corner(1.0, 1.0) * sx;
    Some(a * (top * (1.0 - sz) + bottom * sz))
}

/// SplitMix64's finaliser.
pub(crate) fn mix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// Each vertex's normal from the faces about it, facing `up`'s side.
fn smooth_normals(m: &mut Mesh, up: V3) {
    let mut acc = vec![[0.0; 3]; m.positions.len()];
    for t in 0..m.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
        let n = cross(
            sub(m.positions[b], m.positions[a]),
            sub(m.positions[c], m.positions[a]),
        );
        for v in [a, b, c] {
            acc[v] = add(acc[v], n);
        }
    }
    m.normals = acc
        .into_iter()
        .map(|n| {
            if dot(n, up) < 0.0 {
                unit(scale(n, -1.0))
            } else {
                unit(n)
            }
        })
        .collect();
}

/// What every builder returns beside its mesh (Builder: `build(…) → {…, anchors, values,
/// true_shape, bounds}`): anchors at its bounds' centre, bottom and top, its area and the volume
/// of its closed parts, its true shape, a texture coordinate per vertex, the `height` attribute a
/// material input reads, and with `scatter {count, part?}` that many points laid out on its
/// faces by area, seeded from the item's stable ID.
fn annotate(m: &mut Mesh, kind: &str, p: &Value, ctx: &Ctx<'_>) -> Result<(), Fault> {
    if m.positions.is_empty() {
        return Ok(());
    }
    let [lo, hi] = m.bounds();
    let c = scale(add(lo, hi), 0.5);
    let axes = |o: V3| [o, [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    m.anchors.entry("centre".into()).or_insert(axes(c));
    m.anchors
        .entry("bottom".into())
        .or_insert(axes([c[0], lo[1], c[2]]));
    m.anchors
        .entry("top".into())
        .or_insert(axes([c[0], hi[1], c[2]]));
    let all: Vec<u32> = (0..m.triangles() as u32).collect();
    m.values.insert("area".into(), surface(m, &all).1);
    if !m.closed.is_empty() {
        let v: f64 = m.closed.values().map(|(t, _)| m.volume(t)).sum();
        m.values.insert("volume".into(), v);
    }
    m.true_shape = true_shape(kind, p, lo, hi)?;
    // uv0 in metres (Builder: uv); uv1 from the builder's own charts where it has known ones.
    let (proj, uv_scale) = crate::uv::read(p)?;
    let natural = (m.uv0.len() == m.positions.len()).then(|| m.uv0.clone());
    let fallback = match kind {
        "lathe@1" => crate::uv::Projection::Cylinder(1),
        "ball@1" if p.get("tessellation").and_then(Value::as_str) != Some("geodesic") => {
            crate::uv::Projection::Sphere
        }
        _ => crate::uv::Projection::Box(1.0),
    };
    m.uv0 = crate::uv::uv0(m, proj, uv_scale, natural.as_deref(), fallback);
    if CHARTED.contains(&kind) {
        m.uv1 = crate::uv::uv1(m, natural.as_deref());
    }
    let span = (hi[1] - lo[1]).max(1e-12);
    let height = m.positions.iter().map(|q| (q[1] - lo[1]) / span).collect();
    m.attributes.insert("height".into(), height);
    if let Some(sc) = p.get("scatter") {
        let n = sc
            .get("count")
            .and_then(Value::as_u64)
            .filter(|n| (1..=10_000).contains(n))
            .ok_or_else(|| bad("scatter"))?;
        let tris = match sc.get("part").and_then(Value::as_str) {
            None => all,
            Some(name) => m
                .parts
                .get(name)
                .or_else(|| m.closed.get(name).map(|c| &c.0))
                .cloned()
                .ok_or_else(|| bad("scatter"))?,
        };
        let pts = scatter(m, &tris, n as usize, ctx.id);
        m.outputs.insert("points".into(), json!(pts));
    }
    Ok(())
}

/// The triangles' running areas and their total.
fn surface(m: &Mesh, tris: &[u32]) -> (Vec<f64>, f64) {
    let mut run = Vec::with_capacity(tris.len());
    let mut total = 0.0;
    for &t in tris {
        let k = 3 * t as usize;
        let [a, b, c] = [0, 1, 2].map(|j| m.positions[m.indices[k + j] as usize]);
        total += crate::geom::length(cross(sub(b, a), sub(c, a))) / 2.0;
        run.push(total);
    }
    (run, total)
}

/// `n` points on `tris`, each triangle drawn by its area, from a stream seeded by `id` through
/// hash@1, so the same item lays out the same points everywhere.
pub fn scatter(m: &Mesh, tris: &[u32], n: usize, id: &str) -> Vec<V3> {
    let (run, total) = surface(m, tris);
    if total <= 0.0 {
        return Vec::new();
    }
    let mut h = Hasher::of(HashVersion::V1, "scene3d.scatter");
    h.text(id);
    let key = h.finish().0;
    let mut state = u64::from_le_bytes([
        key[0], key[1], key[2], key[3], key[4], key[5], key[6], key[7],
    ]);
    let mut next = || {
        state = mix64(state);
        (state >> 11) as f64 / (1u64 << 53) as f64
    };
    (0..n)
        .map(|_| {
            let r = next() * total;
            let i = run.partition_point(|x| *x < r).min(tris.len() - 1);
            let k = 3 * tris[i] as usize;
            let [a, b, c] = [0, 1, 2].map(|j| m.positions[m.indices[k + j] as usize]);
            let (u, v) = (sqrt(next()), next());
            add(
                add(scale(a, 1.0 - u), scale(b, u * (1.0 - v))),
                scale(c, u * v),
            )
        })
        .collect()
}

/// The analytic pieces that stand for a builder's mesh: a box, a sphere, a solid of revolution,
/// a prism, capsules along a path, or its bounds where nothing simpler is exact.
fn true_shape(kind: &str, p: &Value, lo: V3, hi: V3) -> Result<Vec<Value>, Fault> {
    let bounds = json!({"box": {"min": lo, "max": hi}});
    Ok(vec![match kind {
        "ball@1" => json!({"sphere": {"centre": [0, 0, 0], "radius": num(p, "radius", 0.5)?}}),
        "lathe@1" => {
            json!({"revolved": {"outline": p.get("outline"), "axis": p.get("axis").cloned().unwrap_or(json!("y"))}})
        }
        "extrude@1" if p.get("bevel").is_none() && p.get("along").is_none() => {
            json!({"prism": {"outline": p.get("outline"), "holes": p.get("holes").cloned().unwrap_or(json!([])), "depth": p.get("depth")}})
        }
        "tube@1" | "coil@1" => {
            json!({"capsules": {"path": p.get("path"), "radius": p.get("radius").or_else(|| p.get("wire"))}})
        }
        _ => bounds,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn both(kind: &str, p: Value) -> (Mesh, u64) {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            doc: &doc,
            id: "",
            plants: Plants::default(),
            outlines: &[],
            planted: None,
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

    /// Welded on a 1e-6 m grid: each closed part's open edges and V − E + F.
    fn closed_parts(m: &Mesh) -> Vec<(String, usize, i64, u32)> {
        let key = |p: V3| p.map(|x| (x / 1e-6).round() as i64);
        let mut ids = std::collections::BTreeMap::new();
        let at: Vec<usize> = m
            .positions
            .iter()
            .map(|p| {
                let n = ids.len();
                *ids.entry(key(*p)).or_insert(n)
            })
            .collect();
        m.closed
            .iter()
            .map(|(name, (tris, genus))| {
                let mut edges = std::collections::BTreeMap::new();
                let mut verts = std::collections::BTreeSet::new();
                let mut faces = 0i64;
                for &t in tris {
                    let v = [0, 1, 2].map(|j| at[m.indices[3 * t as usize + j] as usize]);
                    if v[0] == v[1] || v[1] == v[2] || v[0] == v[2] {
                        continue;
                    }
                    faces += 1;
                    for j in 0..3 {
                        let (a, b) = (v[j], v[(j + 1) % 3]);
                        verts.insert(a);
                        *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
                    }
                }
                let open = edges.values().filter(|n| **n != 2).count();
                let chi = verts.len() as i64 - edges.len() as i64 + faces;
                (name.clone(), open, chi, *genus)
            })
            .collect()
    }

    #[test]
    fn the_issues_builder_params_change_the_mesh_keep_their_count_and_stay_watertight() {
        let doc = json!({"items": {"rail": {"kind": "curve@1", "params": {"points": [[0, 0, 0], [2, 0, 0], [2, 0, 2]]}}}});
        let ctx = Ctx {
            doc: &doc,
            id: "it",
            plants: Plants::default(),
            outlines: &[],
            planted: None,
        };
        for (kind, plain, p) in [
            (
                "slab@1",
                json!({"size": [2, 0.2, 1]}),
                json!({"size": [2, 0.2, 1], "bevel": 0.05}),
            ),
            (
                "slab@1",
                json!({"size": [2, 0.2, 1]}),
                json!({"size": [2, 0.2, 1], "groove": {"depth": 0.05, "width": 0.2}}),
            ),
            (
                "slab@1",
                json!({"size": [2, 0.2, 1]}),
                json!({"size": [2, 0.2, 1], "along": {"path": "rail", "from": 0.25, "to": 0.9}}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
                json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16, "ribs": {"count": 8, "depth": 0.05, "span": 0.5}}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
                json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16, "thread": {"pitch": 0.2, "depth": 0.02}}),
            ),
            (
                "lathe@1",
                json!({"outline": [[0.5, 0], [0.5, 1]], "segments": 16}),
                json!({"outline": [[0.5, 0], [0.5, 1]], "rim": [[1, 0], [0, 1], [-1, 0], [0, -1]]}),
            ),
            (
                "extrude@1",
                json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "depth": 0.5}),
                json!({"outline": [[0, 0], [2, 0], [2, 1], [0, 1]], "depth": {"from": 0.1, "to": 0.6, "up": [0, 1, 1]}, "bevel": 0.05}),
            ),
            (
                "tube@1",
                json!({"path": "rail", "radius": 0.1}),
                json!({"path": "rail", "radius": 0.1, "bend": 0.4}),
            ),
        ] {
            let (a, b) = (
                build(kind, &plain, &ctx).unwrap(),
                build(kind, &p, &ctx).unwrap(),
            );
            assert_ne!(
                a.positions, b.positions,
                "{kind} {p}: the param moves the mesh"
            );
            assert_eq!(
                b.positions.len() as u64,
                estimate(kind, &p, &ctx).unwrap(),
                "{kind} {p}: declared = built"
            );
            let parts = closed_parts(&b);
            assert!(!parts.is_empty(), "{kind} {p}: a closed part");
            for (name, open, chi, genus) in parts {
                assert_eq!(
                    (open, chi),
                    (0, 2 - 2 * i64::from(genus)),
                    "{kind} {p} part {name}"
                );
            }
        }
        let field = json!({"grid": [4, 3], "size": [2, 1.5], "height": {"noise": {"amplitude": 0.2, "scale": 0.5, "seed": 3}}});
        let flat = build("plate@1", &json!({"grid": [4, 3], "size": [2, 1.5]}), &ctx).unwrap();
        let hilly = build("plate@1", &field, &ctx).unwrap();
        assert_ne!(
            flat.positions, hilly.positions,
            "a height field lifts the plate"
        );
        assert_eq!(
            hilly.positions.len() as u64,
            estimate("plate@1", &field, &ctx).unwrap()
        );
        let bands = build("lathe@1", &json!({"outline": [[0.5, 0], [0.5, 1]], "bands": [{"y0": 0, "y1": 0.5, "material": "wood"}]}), &ctx).unwrap();
        assert!(
            !bands.parts["band.0"].is_empty(),
            "a band names the triangles between its heights"
        );
    }

    #[test]
    fn builders_return_anchors_values_attributes_and_points_on_their_faces_seeded_by_id() {
        let doc = json!({"items": {}});
        let p = json!({"size": [2, 1, 1], "scatter": {"count": 50}});
        let at = |id: &'static str| {
            build(
                "slab@1",
                &p,
                &Ctx {
                    doc: &doc,
                    id,
                    plants: Plants::default(),
                    outlines: &[],
                    planted: None,
                },
            )
            .unwrap()
        };
        let (a, again, other) = (at("a"), at("a"), at("b"));
        assert_eq!(a.anchors["top"][0], [0.0, 1.0, 0.0]);
        assert_eq!(a.anchors["bottom"][0], [0.0, 0.0, 0.0]);
        assert!((a.values["area"] - 10.0).abs() < 1e-9 && (a.values["volume"] - 2.0).abs() < 1e-9);
        assert_eq!(a.uv0.len(), a.positions.len());
        assert_eq!(a.attributes["height"].len(), a.positions.len());
        let pts = |m: &Mesh| m.outputs["points"].as_array().unwrap().clone();
        assert_eq!(pts(&a).len(), 50);
        assert_eq!(pts(&a), pts(&again), "one ID lays out one set of points");
        assert_ne!(pts(&a), pts(&other), "another ID another");
        for q in pts(&a) {
            let q: Vec<f64> = q
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_f64().unwrap())
                .collect();
            let on = (q[0].abs() - 1.0).abs() < 1e-9
                || q[1].abs() < 1e-9
                || (q[1] - 1.0).abs() < 1e-9
                || (q[2].abs() - 0.5).abs() < 1e-9;
            assert!(on, "{q:?} lies on a face");
        }
        let tube = build(
            "tube@1",
            &json!({"path": [[0, 0, 0], [0, 2, 0]], "radius": 0.1}),
            &Ctx {
                doc: &doc,
                id: "t",
                plants: Plants::default(),
                outlines: &[],
                planted: None,
            },
        )
        .unwrap();
        assert_eq!(
            (tube.anchors["start"][0], tube.anchors["end"][0]),
            ([0.0, 0.0, 0.0], [0.0, 2.0, 0.0])
        );
    }

    #[test]
    fn a_swept_square_shades_each_side_flat_with_hard_corners() {
        // An off-centre bar with a hole, swept along a straight line: every side is flat.
        let doc = json!({"items": {"c": {"kind": "curve@1",
            "params": {"points": [[0, 0, 0], [0, 0, 1]], "mode": "linear"}}}});
        let p = json!({"outline": [[0, 0], [0.1, 0], [0.1, 0.04], [0, 0.04]],
            "holes": [[[0.02, 0.01], [0.04, 0.01], [0.04, 0.03], [0.02, 0.03]]],
            "along": {"curve": "c", "rings": 4}});
        let ctx = Ctx {
            doc: &doc,
            id: "bar",
            plants: Plants::default(),
            outlines: &[],
            planted: None,
        };
        let m = build("extrude@1", &p, &ctx).unwrap();
        assert_eq!(
            estimate("extrude@1", &p, &ctx).unwrap(),
            m.positions.len() as u64
        );
        for t in 0..m.triangles() {
            let ids = [0, 1, 2].map(|j| m.indices[3 * t + j] as usize);
            let [a, b, c] = ids.map(|i| m.positions[i]);
            let face = unit(cross(sub(b, a), sub(c, a)));
            for i in ids {
                let n = m.normals[i];
                assert!(
                    dot(n, face) > 1.0 - 1e-9,
                    "triangle {t}: vertex {i} at {:?} has normal {n:?}, its face {face:?}",
                    m.positions[i]
                );
            }
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

#[cfg(test)]
mod platonic_tests {
    use super::*;
    use serde_json::json;

    /// Builder `ball`: tessellation (#423): detail 0 gives the four Platonic solids, closed, with
    /// flat faces and the declared 3 × faces × (detail + 1)² vertices; the dodecahedron's twelve
    /// pentagons are flat, so each of its 36 triangles shares its normal with two others.
    #[test]
    fn detail_zero_gives_the_four_platonic_solids_with_flat_faces() {
        for (base, faces, corners) in [
            ("tetra", 4, 4),
            ("octa", 8, 6),
            ("icosa", 20, 12),
            ("dodeca", 36, 20),
        ] {
            let p = json!({"tessellation": "geodesic", "base": base, "radius": 1.0});
            let m = ball(&p, Plants::default()).unwrap();
            assert_eq!(m.triangles(), faces, "{base}");
            assert_eq!(
                ball_count(&p).unwrap(),
                (3 * faces as u64, faces as u64),
                "{base}"
            );
            let mut distinct: Vec<V3> = Vec::new();
            for q in &m.positions {
                if !distinct.iter().any(|d| length(sub(*d, *q)) < 1e-9) {
                    distinct.push(*q);
                }
            }
            assert_eq!(distinct.len(), corners, "{base}");
            for t in m.indices.as_chunks::<3>().0 {
                let [a, b, c] = t.map(|i| m.positions[i as usize]);
                let n = unit(cross(sub(b, a), sub(c, a)));
                assert!(
                    dot(n, unit(add(add(a, b), c))) > 0.0,
                    "{base}: wound outward"
                );
                for i in t {
                    assert!(
                        length(sub(m.normals[*i as usize], n)) < 1e-9,
                        "{base}: flat"
                    );
                }
            }
        }
    }
}
