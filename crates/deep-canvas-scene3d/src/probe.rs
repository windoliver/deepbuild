//! Light probes (issue #427; canvas primitives: Light probe `light.probe@1`): a reflection
//! probe's capture and an irradiance probe's bake, each made on the CPU in pinned math from what
//! the probe sees at its centre (the lights, the sky and the solids around it), and kept as bytes
//! the probes diagnostic mode names by hash and shades its sphere from. Nothing here is per frame
//! or from the camera, and a probe draws nothing in the look.
//!
//! The data: an irradiance probe holds 9 spherical-harmonic coefficients of its incoming light,
//! RGB each, as 27 little-endian f32 (coefficient-major); a reflection probe holds six cube faces
//! of [`FACE`] × [`FACE`] texels of radiance, RGB each, little-endian f32, in the faces' order
//! +X, −X, +Y, −Y, +Z, −Z. Each is prefixed with its type's tag, so two probes that see the same
//! light never share data across types.

use std::sync::Arc;

use deep_canvas::camera::Vec3;
use deep_canvas::ops::{cos, powi, sin, sqrt};
use serde_json::Value;

use crate::light::{Light, LightKind};
use crate::scene::{Layer3, Refused, Shape};

/// A reflection capture's face size, texels.
pub const FACE: usize = 8;
/// The directions an irradiance bake gathers the environment and the solids over.
const RAYS: usize = 128;
/// The most probes of each type a document holds (`budget.probes`).
pub const MAX_REFLECTION: usize = 8;
pub const MAX_IRRADIANCE: usize = 4;
/// The ambient light from above and below with no `sky@1`, linear RGB.
const AMBIENT: [Vec3; 2] = [[0.2, 0.2, 0.22], [0.08, 0.08, 0.08]];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeKind {
    Irradiance,
    Reflection,
}

impl ProbeKind {
    pub fn name(self) -> &'static str {
        match self {
            ProbeKind::Irradiance => "irradiance",
            ProbeKind::Reflection => "reflection",
        }
    }
}

/// One probe at t: where it is in the world and the data it shades from.
#[derive(Clone, Debug, PartialEq)]
pub struct Probe {
    pub id: String,
    pub kind: ProbeKind,
    /// Its centre in world m.
    pub pos: Vec3,
    /// Its influence volume, m.
    pub size: Vec3,
    pub falloff: f64,
    pub priority: f64,
    /// Its capture or bake, as described in the module docs.
    pub data: Arc<Vec<u8>>,
}

/// A probe item's fields, read before the scene's lights are known.
pub struct Wanted {
    pub id: String,
    pub kind: ProbeKind,
    pub pos: Vec3,
    pub size: Vec3,
    pub falloff: f64,
    pub priority: f64,
}

fn bad<T>(path: String) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path,
    })
}

/// A `light.probe@1` item's fields at its world centre `pos`.
pub fn read(id: &str, params: &Value, pos: Vec3, path: &str) -> Result<Wanted, Refused> {
    let kind = match params.get("type").and_then(Value::as_str) {
        Some("irradiance") => ProbeKind::Irradiance,
        Some("reflection") | None => ProbeKind::Reflection,
        Some(_) => return bad(format!("{path}/type")),
    };
    let size = match params.get("size") {
        None => [4.0, 3.0, 4.0],
        Some(v) => {
            let s: Option<Vec<f64>> = v
                .as_array()
                .map(|a| a.iter().map(Value::as_f64).collect::<Option<_>>())
                .unwrap_or(None);
            match s.as_deref() {
                Some([x, y, z]) if *x > 0.0 && *y > 0.0 && *z > 0.0 => [*x, *y, *z],
                _ => return bad(format!("{path}/size")),
            }
        }
    };
    match params.get("shape").and_then(Value::as_str) {
        None | Some("box") | Some("ellipsoid") => {}
        Some(_) => return bad(format!("{path}/shape")),
    }
    let falloff = params.get("falloff").and_then(Value::as_f64).unwrap_or(0.2);
    if !(0.0..=1.0).contains(&falloff) {
        return bad(format!("{path}/falloff"));
    }
    let priority = params
        .get("priority")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    Ok(Wanted {
        id: id.to_string(),
        kind,
        pos,
        size,
        falloff,
        priority,
    })
}

/// What a probe sees besides the lights: the sky's ambient and the solids' world boxes.
pub struct Surroundings {
    /// Radiance from straight above and straight below, linear RGB.
    pub ambient: [Vec3; 2],
    /// Each solid's world box and its linear color.
    pub boxes: Vec<([Vec3; 2], Vec3)>,
}

impl Surroundings {
    /// From the scene's layers and its sky's ambient (`None`: the fixed ambient term).
    pub fn of(layers: &[Layer3], ambient: Option<[Vec3; 2]>) -> Surroundings {
        let mut boxes = Vec::new();
        for s in layers.iter().flat_map(|l| &l.solids) {
            let points: Vec<Vec3> = match (&s.shape, &s.mesh) {
                (Shape::Built(_), Some(m)) => {
                    m.positions.iter().map(|p| apply(&s.model, *p)).collect()
                }
                _ => crate::scene::corners(&s.model),
            };
            if points.is_empty() {
                continue;
            }
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            for p in points {
                for k in 0..3 {
                    lo[k] = lo[k].min(p[k]);
                    hi[k] = hi[k].max(p[k]);
                }
            }
            let color = s
                .color
                .map(|c| deep_canvas::color::srgb_decode(f64::from(c) / 255.0));
            boxes.push(([lo, hi], color));
        }
        Surroundings {
            ambient: ambient.unwrap_or(AMBIENT),
            boxes,
        }
    }

    /// The nearest box a ray from `o` along unit `d` enters past a small start, with its
    /// distance and the face normal it enters through.
    fn hit(&self, o: Vec3, d: Vec3) -> Option<(f64, Vec3, Vec3)> {
        let mut best: Option<(f64, Vec3, Vec3)> = None;
        for (b, color) in &self.boxes {
            let (mut near, mut far, mut axis) = (1e-4, f64::INFINITY, None);
            let mut miss = false;
            for k in 0..3 {
                if d[k].abs() < 1e-12 {
                    if o[k] < b[0][k] || o[k] > b[1][k] {
                        miss = true;
                        break;
                    }
                    continue;
                }
                let (t0, t1) = ((b[0][k] - o[k]) / d[k], (b[1][k] - o[k]) / d[k]);
                let (a, z) = if t0 < t1 { (t0, t1) } else { (t1, t0) };
                if a > near {
                    near = a;
                    axis = Some(k);
                }
                far = far.min(z);
            }
            // A ray from inside a box (the probe's own stand) doesn't hit it.
            if miss || near > far || axis.is_none() {
                continue;
            }
            if best.as_ref().is_none_or(|(t, _, _)| near < *t) {
                let k = axis.unwrap_or(0);
                let mut n = [0.0; 3];
                n[k] = if d[k] > 0.0 { -1.0 } else { 1.0 };
                best = Some((near, n, *color));
            }
        }
        best
    }

    /// The environment's radiance along unit `d`: from below to above.
    fn sky(&self, d: Vec3) -> Vec3 {
        let up = 0.5 * (d[1] + 1.0);
        [0, 1, 2].map(|k| self.ambient[1][k] + (self.ambient[0][k] - self.ambient[1][k]) * up)
    }
}

fn apply(m: &crate::scene::Affine3, p: Vec3) -> Vec3 {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn unit(a: Vec3) -> Vec3 {
    let l = sqrt(dot(a, a));
    if l > 0.0 {
        a.map(|v| v / l)
    } else {
        a
    }
}

/// The irradiance each light gives a point at `p` facing everywhere, unoccluded by the boxes:
/// its direction toward the light and its RGB illuminance.
fn arriving(p: Vec3, lights: &[Light], around: &Surroundings) -> Vec<(Vec3, Vec3)> {
    let mut out = Vec::new();
    for l in lights {
        let (toward, e, reach) = match l.kind {
            LightKind::Sun => (l.dir.map(|v| -v), l.intensity, f64::INFINITY),
            _ => {
                let v = sub(l.pos, p);
                let d2 = dot(v, v).max(1e-6);
                let d = sqrt(d2);
                let toward = v.map(|c| c / d);
                let mut e = l.intensity / d2;
                if l.range > 0.0 && l.range.is_finite() {
                    let r = powi(d / l.range, 4);
                    e *= powi((1.0 - r).max(0.0), 2);
                }
                if l.kind == LightKind::Spot {
                    // cone: cos of the outer and inner half angles.
                    let c = dot(l.dir, toward.map(|v| -v));
                    let (outer, inner) = (l.cone[0], l.cone[1]);
                    let t = ((c - outer) / (inner - outer).max(1e-9)).clamp(0.0, 1.0);
                    e *= t * t * (3.0 - 2.0 * t);
                }
                (toward, e, d)
            }
        };
        if e <= 0.0 {
            continue;
        }
        if around.hit(p, toward).is_some_and(|(t, _, _)| t < reach) {
            continue;
        }
        out.push((toward, l.color.map(|c| c * e)));
    }
    out
}

/// The 9 real SH basis functions at unit `d`.
fn sh9(d: Vec3) -> [f64; 9] {
    let [x, y, z] = d;
    [
        0.282_095,
        0.488_603 * y,
        0.488_603 * z,
        0.488_603 * x,
        1.092_548 * x * y,
        1.092_548 * y * z,
        0.315_392 * (3.0 * z * z - 1.0),
        1.092_548 * x * z,
        0.546_274 * (x * x - y * y),
    ]
}

/// `n` directions spread over the sphere, the same on every machine (a Fibonacci lattice).
fn lattice(n: usize) -> Vec<Vec3> {
    let golden = core::f64::consts::PI * (3.0 - sqrt(5.0));
    (0..n)
        .map(|i| {
            let y = 1.0 - 2.0 * (i as f64 + 0.5) / n as f64;
            let r = sqrt((1.0 - y * y).max(0.0));
            let a = golden * i as f64;
            [r * cos(a), y, r * sin(a)]
        })
        .collect()
}

/// What a ray from the probe's centre along `d` sees: the box it hits, lit by the lights, or the
/// environment.
fn seen(p: Vec3, d: Vec3, lit: &[(Vec3, Vec3)], around: &Surroundings) -> Vec3 {
    match around.hit(p, d) {
        Some((_, n, color)) => {
            let up = around.sky(n);
            let mut c = [0, 1, 2].map(|k| color[k] * up[k]);
            for (toward, e) in lit {
                let lambert = dot(n, *toward).max(0.0) / core::f64::consts::PI;
                for k in 0..3 {
                    c[k] += color[k] * e[k] * lambert;
                }
            }
            c
        }
        None => around.sky(d),
    }
}

/// The face direction of texel (i, j) of cube face `f`.
fn texel_dir(f: usize, i: usize, j: usize) -> Vec3 {
    let u = 2.0 * (i as f64 + 0.5) / FACE as f64 - 1.0;
    let v = 2.0 * (j as f64 + 0.5) / FACE as f64 - 1.0;
    unit(match f {
        0 => [1.0, -v, -u],
        1 => [-1.0, -v, u],
        2 => [u, 1.0, v],
        3 => [u, -1.0, -v],
        4 => [u, -v, 1.0],
        _ => [-u, -v, -1.0],
    })
}

fn push(out: &mut Vec<u8>, c: Vec3) {
    for v in c {
        out.extend_from_slice(&(v as f32).to_le_bytes());
    }
}

/// The probe's capture or bake, made from what it sees at its centre.
pub fn capture(w: Wanted, lights: &[Light], around: &Surroundings) -> Probe {
    let lit = arriving(w.pos, lights, around);
    let mut data = w.kind.name().as_bytes().to_vec();
    match w.kind {
        ProbeKind::Irradiance => {
            let mut c = [[0.0f64; 3]; 9];
            for (toward, e) in &lit {
                for (i, y) in sh9(*toward).iter().enumerate() {
                    for k in 0..3 {
                        c[i][k] += e[k] * y;
                    }
                }
            }
            let weight = 4.0 * core::f64::consts::PI / RAYS as f64;
            for d in lattice(RAYS) {
                let l = seen(w.pos, d, &lit, around);
                for (i, y) in sh9(d).iter().enumerate() {
                    for k in 0..3 {
                        c[i][k] += l[k] * y * weight;
                    }
                }
            }
            for coeff in c {
                push(&mut data, coeff);
            }
        }
        ProbeKind::Reflection => {
            for f in 0..6 {
                for j in 0..FACE {
                    for i in 0..FACE {
                        push(&mut data, seen(w.pos, texel_dir(f, i, j), &lit, around));
                    }
                }
            }
        }
    }
    Probe {
        id: w.id,
        kind: w.kind,
        pos: w.pos,
        size: w.size,
        falloff: w.falloff,
        priority: w.priority,
        data: Arc::new(data),
    }
}

fn read_f32s(data: &[u8], skip: usize) -> Vec<f64> {
    data[skip..]
        .chunks_exact(4)
        .map(|b| f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])))
        .collect()
}

/// The probe's data shading unit direction `d`, linear RGB: an irradiance probe's radiance off a
/// white Lambertian surface facing `d`, a reflection probe's radiance seen along `d`.
pub fn probe_color(probe: &Probe, d: Vec3) -> Vec3 {
    let tag = probe.kind.name().len();
    let v = read_f32s(&probe.data, tag);
    match probe.kind {
        ProbeKind::Irradiance => {
            // Cosine lobe convolution per band, then irradiance ÷ π.
            let band = [
                1.0,
                2.0 / 3.0,
                2.0 / 3.0,
                2.0 / 3.0,
                0.25,
                0.25,
                0.25,
                0.25,
                0.25,
            ];
            let y = sh9(unit(d));
            [0, 1, 2].map(|k| {
                (0..9)
                    .map(|i| band[i] * y[i] * v.get(3 * i + k).copied().unwrap_or(0.0))
                    .sum::<f64>()
                    .max(0.0)
            })
        }
        ProbeKind::Reflection => {
            let d = unit(d);
            let a = d.map(f64::abs);
            let (f, s, t, m) = if a[0] >= a[1] && a[0] >= a[2] {
                if d[0] > 0.0 {
                    (0, -d[2], -d[1], a[0])
                } else {
                    (1, d[2], -d[1], a[0])
                }
            } else if a[1] >= a[2] {
                if d[1] > 0.0 {
                    (2, d[0], d[2], a[1])
                } else {
                    (3, d[0], -d[2], a[1])
                }
            } else if d[2] > 0.0 {
                (4, d[0], -d[1], a[2])
            } else {
                (5, -d[0], -d[1], a[2])
            };
            let texel = |c: f64| ((((c / m) + 1.0) * 0.5 * FACE as f64) as usize).min(FACE - 1);
            let at = 3 * ((f * FACE + texel(t)) * FACE + texel(s));
            [0, 1, 2].map(|k| v.get(at + k).copied().unwrap_or(0.0))
        }
    }
}

/// A sphere of `radius` m around the probe's centre, in its own space (centred at the origin),
/// `segments` around and half as many rings, with each vertex's color from the probe's data
/// along its normal: what the probes mode draws it as.
pub fn sphere(probe: &Probe, radius: f64, segments: u32) -> (crate::geom::Mesh, Vec<Vec3>) {
    let segments = segments.max(4) as usize;
    let rings = segments / 2;
    let mut mesh = crate::geom::Mesh::default();
    for j in 0..=rings {
        let phi = core::f64::consts::PI * j as f64 / rings as f64;
        for i in 0..=segments {
            let th = 2.0 * core::f64::consts::PI * i as f64 / segments as f64;
            let n = [sin(phi) * cos(th), cos(phi), sin(phi) * sin(th)];
            mesh.positions.push(n.map(|c| c * radius));
            mesh.normals.push(n);
        }
    }
    let row = segments as u32 + 1;
    for j in 0..rings as u32 {
        for i in 0..segments as u32 {
            let (a, b) = (j * row + i, (j + 1) * row + i);
            mesh.indices.extend([a, a + 1, b + 1, a, b + 1, b]);
        }
    }
    let colors = mesh
        .normals
        .iter()
        .map(|n| probe_color(probe, *n))
        .collect();
    (mesh, colors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wanted(kind: ProbeKind, pos: Vec3) -> Wanted {
        Wanted {
            id: "p".into(),
            kind,
            pos,
            size: [4.0, 3.0, 4.0],
            falloff: 0.2,
            priority: 0.0,
        }
    }

    fn open() -> Surroundings {
        Surroundings {
            ambient: AMBIENT,
            boxes: Vec::new(),
        }
    }

    #[test]
    fn irradiance_faces_the_light_brighter_than_away_from_it() {
        let light = crate::light::light(
            "lamp",
            "light.point@1",
            &serde_json::json!({"power": 1200}),
            [0.0, 3.0, 0.0],
            [0.0, 0.0, -1.0],
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            1.0,
        )
        .expect("a point light");
        let p = capture(
            wanted(ProbeKind::Irradiance, [0.0, 0.0, 0.0]),
            &[light],
            &open(),
        );
        assert_eq!(p.data.len(), "irradiance".len() + 27 * 4);
        let up = probe_color(&p, [0.0, 1.0, 0.0]);
        let down = probe_color(&p, [0.0, -1.0, 0.0]);
        assert!(up[0] > down[0] + 1.0, "{up:?} vs {down:?}");
    }

    #[test]
    fn a_reflection_sees_the_box_beside_it_and_the_sky_elsewhere() {
        let around = Surroundings {
            ambient: AMBIENT,
            boxes: vec![([[2.0, -1.0, -1.0], [3.0, 1.0, 1.0]], [1.0, 0.0, 0.0])],
        };
        let p = capture(wanted(ProbeKind::Reflection, [0.0; 3]), &[], &around);
        assert_eq!(p.data.len(), "reflection".len() + 6 * FACE * FACE * 12);
        let toward = probe_color(&p, [1.0, 0.0, 0.0]);
        assert!(toward[0] > 0.0 && toward[1] == 0.0, "{toward:?}");
        let away = probe_color(&p, [-1.0, 0.0, 0.0]);
        assert!(away[1] > 0.0, "{away:?}");
        // Elsewhere, the data differs from a probe that sees no box.
        let bare = capture(wanted(ProbeKind::Reflection, [0.0; 3]), &[], &open());
        assert_ne!(p.data, bare.data);
    }
}
