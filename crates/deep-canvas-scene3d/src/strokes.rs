//! Look `look@1`: strokes on surfaces (#462). Brush, dab and dot looks lay their strokes on the
//! surfaces of a 3D scene, never on the screen: each candidate stroke is a point on one of an
//! item's triangles, from stable IDs (the item, the triangle, the layer and the stroke's index),
//! so an orbit never makes them swim. A triangle shows the first ⌊density × its projected area +
//! its own seeded share⌋ of its candidates, so strokes come and go at fixed sizes as a surface
//! nears or turns away, chosen by the frame alone, never by history. Each shown stroke is drawn
//! where its anchor projects through the frame's camera, oriented along the surface's u or v
//! direction as seen, sized in px, colored from the look's palette for the role that paints the
//! surface, and hidden where something nearer covers its anchor.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops;
use serde_json::Value;

use crate::scene::{Camera, Scene, Shape, Solid};

type V3 = [f64; 3];

/// The surface direction a stroke lies along.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orient {
    U,
    V,
}

/// A look's `strokes`.
#[derive(Clone, Debug, PartialEq)]
pub struct Strokes {
    /// The collection they land on, or every item.
    pub on: Option<String>,
    /// Strokes per px² at design size, over all layers.
    pub density: f64,
    /// The smallest and largest stroke, px.
    pub size: [f64; 2],
    pub orient: Orient,
    /// Each fill role's colors, sRGB-encoded, from the look's palette.
    pub palette: BTreeMap<String, Vec<[u8; 3]>>,
    pub layers: u32,
}

/// One stroke a frame draws.
#[derive(Clone, Debug, PartialEq)]
pub struct Dab {
    /// Stable: `<item>:<triangle>:<layer>:<index>`.
    pub id: String,
    pub item: String,
    /// Where it is laid on the item's surface, world m.
    pub anchor: V3,
    /// Where its quad's centre draws, frame px.
    pub at: [f64; 2],
    /// Its anchor drawn a hair toward the eye, the depth its quad tests against.
    pub near: V3,
    /// Its long axis on screen, radians from +x toward +y (down).
    pub angle: f64,
    pub length: f64,
    pub width: f64,
    pub color: [u8; 3],
    /// How the key sun lights the surface under it, as plain solids are lit: 0.25 + 0.75 ×
    /// facing, 1 with no sun. Its linear color is scaled by it.
    pub shade: f64,
    pub layer: u32,
    /// Its own seed, which shapes its bristles.
    pub seed: u32,
}

fn hex(text: &str) -> Option<[u8; 3]> {
    let h = text.strip_prefix('#')?;
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// A look's `strokes`, its palette names resolved through the look's palette; `None` without.
pub fn read(look: &Value) -> Result<Option<Strokes>, String> {
    let Some(s) = look.get("strokes").filter(|s| !s.is_null()) else {
        return Ok(None);
    };
    let Some(s) = s.as_object() else {
        return Err("strokes is an object".into());
    };
    let palette = look.get("palette").and_then(Value::as_object);
    let color = |name: &str| -> Option<[u8; 3]> {
        hex(name).or_else(|| palette?.get(name)?.as_str().and_then(hex))
    };
    let num = |k: &str, d: f64| -> Result<f64, String> {
        match s.get(k) {
            None | Some(Value::Null) => Ok(d),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= 0.0)
                .ok_or_else(|| format!("strokes/{k}")),
        }
    };
    let on = match s.get("on").and_then(Value::as_str) {
        None | Some("all") => None,
        Some(c) => Some(c.to_string()),
    };
    let size = match s.get("size") {
        None | Some(Value::Null) => [8.0, 20.0],
        Some(Value::Array(a)) if a.len() == 2 => {
            let px = |v: &Value| v.as_f64().filter(|x| x.is_finite() && *x > 0.0);
            match (px(&a[0]), px(&a[1])) {
                (Some(lo), Some(hi)) if lo <= hi => [lo, hi],
                _ => return Err("strokes/size".into()),
            }
        }
        Some(_) => return Err("strokes/size".into()),
    };
    let orient = match s.get("orient") {
        None | Some(Value::Null) => Orient::U,
        Some(o) => match o.get("surface").and_then(Value::as_str) {
            Some("u") => Orient::U,
            Some("v") => Orient::V,
            // A flow field names a vector field item, a kind no module of this build registers.
            _ if o.get("flow").is_some() => {
                return Err("strokes/orient/flow: no vector field kind to read".into())
            }
            _ => return Err("strokes/orient".into()),
        },
    };
    let mut colors = BTreeMap::new();
    for (role, names) in s
        .get("palette")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let list = names
            .as_array()
            .ok_or_else(|| format!("strokes/palette/{role}"))?
            .iter()
            .map(|n| n.as_str().and_then(color))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| format!("strokes/palette/{role}"))?;
        colors.insert(role.clone(), list);
    }
    let layers = num("layers", 1.0)?;
    if !(1.0..=3.0).contains(&layers) || layers.fract() != 0.0 {
        return Err("strokes/layers".into());
    }
    match s.get("seed").and_then(Value::as_str) {
        None | Some("item") => {}
        Some(_) => return Err("strokes/seed".into()),
    }
    Ok(Some(Strokes {
        on,
        density: num("density", 0.002)?,
        size,
        orient,
        palette: colors,
        layers: layers as u32,
    }))
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn norm(a: V3) -> f64 {
    ops::sqrt(dot(a, a))
}

fn point(m: &[[f64; 4]; 3], p: V3) -> V3 {
    std::array::from_fn(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}
fn direction(m: &[[f64; 4]; 3], d: V3) -> V3 {
    std::array::from_fn(|r| m[r][0] * d[0] + m[r][1] * d[1] + m[r][2] * d[2])
}

/// A triangle in the item's own space, with its surface's u and v directions.
struct Tri {
    p: [V3; 3],
    u: V3,
    v: V3,
}

const SEGMENTS: u32 = 48;
const RINGS: u32 = 24;

/// A shipped shape's triangles, as the renderer's unit meshes lay them out (a box, a cylinder
/// about +Y and a sphere, each 1 m across, centred on the origin).
fn unit_tris(shape: Shape) -> Vec<Tri> {
    let mut out = Vec::new();
    let tau = 2.0 * std::f64::consts::PI;
    match shape {
        Shape::Box => {
            let faces: [(V3, V3, V3); 6] = [
                ([1., 0., 0.], [0., 1., 0.], [0., 0., 1.]),
                ([-1., 0., 0.], [0., 0., 1.], [0., 1., 0.]),
                ([0., 1., 0.], [0., 0., 1.], [1., 0., 0.]),
                ([0., -1., 0.], [1., 0., 0.], [0., 0., 1.]),
                ([0., 0., 1.], [1., 0., 0.], [0., 1., 0.]),
                ([0., 0., -1.], [0., 1., 0.], [1., 0., 0.]),
            ];
            for (n, a, b) in faces {
                let c = |sa: f64, sb: f64| add(add(mul(n, 0.5), mul(a, sa)), mul(b, sb));
                let q = [c(-0.5, -0.5), c(0.5, -0.5), c(0.5, 0.5), c(-0.5, 0.5)];
                for t in [[0, 1, 2], [0, 2, 3]] {
                    out.push(Tri {
                        p: t.map(|i| q[i]),
                        u: a,
                        v: b,
                    });
                }
            }
        }
        Shape::Cylinder => {
            let around = |k: u32| {
                let a = tau * f64::from(k) / f64::from(SEGMENTS);
                (ops::cos(a), ops::sin(a))
            };
            for k in 0..SEGMENTS {
                let ((c0, s0), (c1, s1)) = (around(k), around(k + 1));
                let lo0 = [0.5 * c0, -0.5, 0.5 * s0];
                let hi0 = [0.5 * c0, 0.5, 0.5 * s0];
                let lo1 = [0.5 * c1, -0.5, 0.5 * s1];
                let hi1 = [0.5 * c1, 0.5, 0.5 * s1];
                let u = [-(s0 + s1) / 2.0, 0.0, (c0 + c1) / 2.0];
                let v = [0.0, 1.0, 0.0];
                out.push(Tri {
                    p: [lo0, hi0, lo1],
                    u,
                    v,
                });
                out.push(Tri {
                    p: [hi0, hi1, lo1],
                    u,
                    v,
                });
                for (y, up) in [(0.5, true), (-0.5, false)] {
                    let (a, b) = ([0.5 * c0, y, 0.5 * s0], [0.5 * c1, y, 0.5 * s1]);
                    let p = if up {
                        [[0., y, 0.], b, a]
                    } else {
                        [[0., y, 0.], a, b]
                    };
                    out.push(Tri {
                        p,
                        u: [1.0, 0.0, 0.0],
                        v: [0.0, 0.0, 1.0],
                    });
                }
            }
        }
        Shape::Sphere => {
            let at = |r: u32, k: u32| {
                let phi = std::f64::consts::PI * f64::from(r) / f64::from(RINGS);
                let th = tau * f64::from(k) / f64::from(SEGMENTS);
                [
                    0.5 * ops::sin(phi) * ops::cos(th),
                    0.5 * ops::cos(phi),
                    0.5 * ops::sin(phi) * ops::sin(th),
                ]
            };
            for r in 0..RINGS {
                for k in 0..SEGMENTS {
                    let th = tau * (f64::from(k) + 0.5) / f64::from(SEGMENTS);
                    let phi = std::f64::consts::PI * (f64::from(r) + 0.5) / f64::from(RINGS);
                    let u = [-ops::sin(th), 0.0, ops::cos(th)];
                    let v = [
                        ops::cos(phi) * ops::cos(th),
                        -ops::sin(phi),
                        ops::cos(phi) * ops::sin(th),
                    ];
                    let (a, b, c, d) = (at(r, k), at(r, k + 1), at(r + 1, k), at(r + 1, k + 1));
                    out.push(Tri { p: [a, b, c], u, v });
                    out.push(Tri { p: [b, d, c], u, v });
                }
            }
        }
        Shape::Built(_) => {}
    }
    out
}

/// A builder's mesh's triangles, u from its first texture coordinate where it has one.
fn mesh_tris(m: &crate::geom::Mesh) -> Vec<Tri> {
    let mut out = Vec::new();
    for t in m.indices.as_chunks::<3>().0 {
        let i = [t[0] as usize, t[1] as usize, t[2] as usize];
        let Some(p) = i
            .iter()
            .map(|&k| m.positions.get(k).copied())
            .collect::<Option<Vec<V3>>>()
        else {
            continue;
        };
        let p = [p[0], p[1], p[2]];
        let (e1, e2) = (sub(p[1], p[0]), sub(p[2], p[0]));
        let n = cross(e1, e2);
        let mut u = e1;
        if let (Some(a), Some(b), Some(c)) = (m.uv0.get(i[0]), m.uv0.get(i[1]), m.uv0.get(i[2])) {
            let (du1, dv1, du2, dv2) = (b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
            let det = du1 * dv2 - du2 * dv1;
            if det.abs() > 1e-12 {
                u = mul(sub(mul(e1, dv2), mul(e2, dv1)), 1.0 / det);
            }
        }
        let v = cross(n, u);
        out.push(Tri { p, u, v });
    }
    out
}

/// FNV-1a over `text`.
fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// A fixed hash of `(a, b, c)` → [0, 1).
fn unit(a: u64, b: u64, c: u64) -> f64 {
    let mut z = a ^ b.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ c.wrapping_mul(0xc2b2_ae3d_27d4_eb4f);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// The plastic number's R2 steps: a low-discrepancy walk over the unit square.
const R2: [f64; 2] = [0.754_877_666_246_692_7, 0.569_840_290_998_053_3];

/// Whether the segment from `eye` to `p` passes through `s` before it reaches `p`.
fn blocks(s: &Solid, eye: V3, p: V3) -> bool {
    let Some(inv) = inverse(&s.model) else {
        return false;
    };
    let (o, d) = (point(&inv, eye), sub(point(&inv, p), point(&inv, eye)));
    let before = |t: f64| t > 1e-6 && t < 1.0 - 1e-6;
    match s.shape {
        Shape::Box => {
            let (mut lo, mut hi) = (f64::NEG_INFINITY, f64::INFINITY);
            for a in 0..3 {
                if d[a].abs() < 1e-15 {
                    if o[a].abs() > 0.5 {
                        return false;
                    }
                    continue;
                }
                let (t0, t1) = ((-0.5 - o[a]) / d[a], (0.5 - o[a]) / d[a]);
                lo = lo.max(t0.min(t1));
                hi = hi.min(t0.max(t1));
            }
            lo <= hi && (before(lo) || before(hi))
        }
        Shape::Sphere => {
            let (a, b, c) = (dot(d, d), 2.0 * dot(o, d), dot(o, o) - 0.25);
            let disc = b * b - 4.0 * a * c;
            disc > 0.0 && {
                let r = ops::sqrt(disc);
                before((-b - r) / (2.0 * a)) || before((-b + r) / (2.0 * a))
            }
        }
        Shape::Cylinder => {
            let (a, b, c) = (
                d[0] * d[0] + d[2] * d[2],
                2.0 * (o[0] * d[0] + o[2] * d[2]),
                o[0] * o[0] + o[2] * o[2] - 0.25,
            );
            let side = |t: f64| before(t) && (o[1] + t * d[1]).abs() <= 0.5;
            let disc = b * b - 4.0 * a * c;
            let walls = a > 1e-15 && disc > 0.0 && {
                let r = ops::sqrt(disc);
                side((-b - r) / (2.0 * a)) || side((-b + r) / (2.0 * a))
            };
            let caps = d[1].abs() > 1e-15
                && [-0.5, 0.5].iter().any(|y| {
                    let t = (y - o[1]) / d[1];
                    let (x, z) = (o[0] + t * d[0], o[2] + t * d[2]);
                    before(t) && x * x + z * z <= 0.25
                });
            walls || caps
        }
        Shape::Built(_) => s.mesh.as_ref().is_some_and(|m| {
            m.indices.as_chunks::<3>().0.iter().any(|t| {
                let v = |k: u32| m.positions.get(k as usize).copied();
                let (Some(a), Some(b), Some(c)) = (v(t[0]), v(t[1]), v(t[2])) else {
                    return false;
                };
                let (e1, e2) = (sub(b, a), sub(c, a));
                let h = cross(d, e2);
                let det = dot(e1, h);
                if det.abs() < 1e-15 {
                    return false;
                }
                let f = 1.0 / det;
                let sv = sub(o, a);
                let u = f * dot(sv, h);
                let q = cross(sv, e1);
                let w = f * dot(d, q);
                u >= 0.0 && w >= 0.0 && u + w <= 1.0 && before(f * dot(e2, q))
            })
        }),
    }
}

fn inverse(m: &[[f64; 4]; 3]) -> Option<[[f64; 4]; 3]> {
    let a = |r: usize, c: usize| m[r][c];
    let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
        - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
    if det.abs() < 1e-18 {
        return None;
    }
    let mut out = [[0.0; 4]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, x) in row.iter_mut().take(3).enumerate() {
            let (r1, r2) = ((c + 1) % 3, (c + 2) % 3);
            let (c1, c2) = ((r + 1) % 3, (r + 2) % 3);
            *x = (a(r1, c1) * a(r2, c2) - a(r1, c2) * a(r2, c1)) / det;
        }
        row[3] = -(0..3).map(|c| row[c] * m[c][3]).sum::<f64>();
    }
    Some(out)
}

/// The items a look's strokes land on, each with the fill role that paints it: every solid, or
/// the members of the collection `on` names.
pub fn targets(
    doc: &serde_json::Map<String, Value>,
    s: &Strokes,
    solids: impl Iterator<Item = String>,
) -> BTreeMap<String, Option<String>> {
    let members: Option<BTreeSet<&str>> = s.on.as_ref().map(|c| {
        doc.get("collections")
            .and_then(|cs| cs.pointer(&format!("/{c}/members")))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    });
    solids
        .filter(|id| members.as_ref().is_none_or(|m| m.contains(id.as_str())))
        .map(|id| {
            let role = doc
                .get("items")
                .and_then(|i| i.pointer(&format!("/{id}/params/paint/fill/role")))
                .and_then(Value::as_str)
                .map(str::to_string);
            (id, role)
        })
        .collect()
}

/// What a frame lays on the scene's stroked items, `place` the camera a stroke's anchor is
/// projected through for where it draws (the frame's own, but for a planted wrong program).
pub fn lay(scene: &Scene, s: &Strokes, place: &Camera) -> Vec<Dab> {
    let cam = &scene.camera;
    let [w, h] = cam.size;
    let solids: Vec<&Solid> = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| !s.cast_only && s.alpha > 0.0)
        .collect();
    let per_layer = s.density / f64::from(s.layers);
    let mut out = Vec::new();
    for (own, solid) in solids.iter().enumerate() {
        let Some(role) = scene.stroked.get(&solid.id) else {
            continue;
        };
        let tris = match (solid.shape, &solid.mesh) {
            (Shape::Built(_), Some(m)) => mesh_tris(m),
            (shape, _) => unit_tris(shape),
        };
        let colors = role
            .as_ref()
            .and_then(|r| s.palette.get(r))
            .filter(|c| !c.is_empty());
        let seed = fnv(&solid.id);
        let convex = !matches!(solid.shape, Shape::Built(_));
        for (ti, tri) in tris.iter().enumerate() {
            let p = tri.p.map(|q| point(&solid.model, q));
            let normal = cross(sub(p[1], p[0]), sub(p[2], p[0]));
            let centroid = mul(add(add(p[0], p[1]), p[2]), 1.0 / 3.0);
            let toward = if cam.perspective {
                sub(cam.eye, centroid)
            } else {
                mul(cam.forward, -1.0)
            };
            if dot(normal, toward) <= 0.0 {
                continue;
            }
            let Some(q) = p
                .iter()
                .map(|x| cam.project(*x).filter(|q| q[2] > cam.near))
                .collect::<Option<Vec<_>>>()
            else {
                continue;
            };
            let area = ((q[1][0] - q[0][0]) * (q[2][1] - q[0][1])
                - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]))
                .abs()
                / 2.0;
            let shade = scene.sun.as_ref().map_or(1.0, |sun| {
                let facing = dot(normal, sun.toward) / (norm(normal) * norm(sun.toward)).max(1e-12);
                0.25 + 0.75 * facing.max(0.0)
            });
            let dir = match s.orient {
                Orient::U => direction(&solid.model, tri.u),
                Orient::V => direction(&solid.model, tri.v),
            };
            for layer in 0..s.layers {
                let l = u64::from(layer);
                let n = (per_layer * area + unit(seed, ti as u64, l)).floor() as u64;
                let offset = [
                    unit(seed ^ 0x51, ti as u64, l),
                    unit(seed ^ 0x52, ti as u64, l),
                ];
                for j in 0..n {
                    let k = (j + 1) as f64;
                    let mut a = (offset[0] + k * R2[0]).fract();
                    let mut b = (offset[1] + k * R2[1]).fract();
                    if a + b > 1.0 {
                        (a, b) = (1.0 - a, 1.0 - b);
                    }
                    let anchor = add(p[0], add(mul(sub(p[1], p[0]), a), mul(sub(p[2], p[0]), b)));
                    let eye = if cam.perspective {
                        cam.eye
                    } else {
                        sub(anchor, mul(cam.forward, 1e3))
                    };
                    let hidden = solids
                        .iter()
                        .enumerate()
                        .any(|(i, o)| !(i == own && convex) && blocks(o, eye, anchor));
                    if hidden {
                        continue;
                    }
                    let (Some(here), Some(at)) = (cam.project(anchor), place.project(anchor))
                    else {
                        continue;
                    };
                    let id_seed = unit(seed, ti as u64, (l << 32) | j);
                    let size = s.size[0]
                        + (s.size[1] - s.size[0]) * unit(seed ^ 0x5e, ti as u64, (l << 32) | j);
                    let size = size * (1.0 - 0.2 * layer as f64);
                    if here[0] < -size
                        || here[0] > w + size
                        || here[1] < -size
                        || here[1] > h + size
                    {
                        continue;
                    }
                    let ahead = cam.project(add(anchor, mul(dir, 0.01 / norm(dir).max(1e-12))));
                    let base = ahead.map_or(0.0, |x| ops::atan2(x[1] - here[1], x[0] - here[0]));
                    let jitter = (unit(seed ^ 0xa9, ti as u64, (l << 32) | j) - 0.5) * 0.5;
                    let to_eye = sub(eye, anchor);
                    let dist = norm(to_eye);
                    let near = add(
                        anchor,
                        mul(to_eye, (0.002 * dist).min(0.01) / dist.max(1e-9)),
                    );
                    let color = match colors {
                        Some(c) => c[(id_seed * c.len() as f64) as usize % c.len()],
                        None => solid.color,
                    };
                    out.push(Dab {
                        id: format!("{}:{ti}:{layer}:{j}", solid.id),
                        item: solid.id.clone(),
                        anchor,
                        at: [at[0], at[1]],
                        near,
                        angle: base + jitter,
                        length: size,
                        // A wide size range draws long brush strokes; an even one round dots.
                        width: size * (0.3 + 0.7 * s.size[0] / s.size[1]),
                        color,
                        shade,
                        layer,
                        seed: (id_seed * f64::from(u32::MAX)) as u32,
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strokes_read_their_palette_through_the_look() {
        let look = json!({"palette": {"c-a": "#102030"}, "strokes": {"palette": {"body": ["c-a"]}, "size": [2, 4], "orient": {"surface": "v"}, "layers": 2}});
        let s = read(&look).unwrap().unwrap();
        assert_eq!(s.palette["body"], vec![[0x10, 0x20, 0x30]]);
        assert_eq!((s.size, s.orient, s.layers), ([2.0, 4.0], Orient::V, 2));
        assert!(read(&json!({"strokes": {"orient": {"flow": "f"}}})).is_err());
    }

    #[test]
    fn a_box_lays_every_anchor_on_its_faces() {
        for t in unit_tris(Shape::Box) {
            for p in t.p {
                assert!(p.iter().any(|x| (x.abs() - 0.5).abs() < 1e-12));
            }
        }
    }
}
