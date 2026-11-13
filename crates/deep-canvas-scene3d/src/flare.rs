//! Effect: flare (#465): an `effect@1` item of `kind: flare`, and the evaluated lights in view a
//! frame builds it from, each with its projected point, its projected disc and its exposed light.
//! With `from: {emissive: EV100}` the renderer finds its sources on the GPU instead: the brightest
//! pixels at or above that level.
//! Everything is a pure function of the scene at t, so seeking equals playing.

use deep_canvas::camera::Vec3;
use deep_canvas::ops;
use serde_json::Value;

use crate::light::LightKind;
use crate::look::Look3;
use crate::scene::{Refused, Scene};

/// The most sources one flare draws, the brightest first.
pub const MAX_SOURCES: usize = 16;
/// The most ghosts.
pub const MAX_GHOSTS: u32 = 8;

/// A flare's fields (Effect: flare).
#[derive(Clone, Debug, PartialEq)]
pub struct Flare {
    pub id: String,
    /// `from: {emissive: EV100}`: the level, as a luminance in cd/m²; `None` for `lights`.
    pub emissive: Option<f64>,
    pub ghosts: u32,
    /// Arms: 0, 2, 4 or 6; their length a share of the frame's width.
    pub streaks: u32,
    pub length: f64,
    pub anamorphic: bool,
    /// The halo's radius, a share of the frame's width.
    pub halo: f64,
    pub blades: u32,
    pub intensity: f64,
    /// The tint role's color, linear.
    pub tint: Vec3,
}

/// One source a frame flares: its projected point and disc radius in frame px, its depth along
/// the view, and its exposed linear radiance times the flare's intensity and tint.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Source {
    pub at: [f64; 2],
    pub radius: f64,
    /// The world point the depth test reads, or `None` for a sun, at infinity.
    pub point: Option<Vec3>,
    pub color: Vec3,
    /// The share of the fade disc (the halo's disc grown by the source's) inside the frame.
    pub inside: f64,
}

fn bad(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Reads an `effect@1`'s params; `None` for another effect kind than flare.
pub fn parse(id: &str, params: &Value, look: &Look3) -> Result<Flare, Refused> {
    let path = |k: &str| format!("items/{id}/params/{k}");
    if params.get("kind").and_then(Value::as_str) != Some("flare") {
        return Err(bad("out_of_range", path("kind")));
    }
    let f = params
        .get("flare")
        .filter(|f| f.is_object())
        .ok_or_else(|| bad("bad_input", path("flare")))?;
    let at = |k: &str| format!("items/{id}/params/flare/{k}");
    let num = |v: Option<&Value>, k: &str, default: f64, range: [f64; 2]| -> Result<f64, Refused> {
        match v {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
                .ok_or_else(|| bad("out_of_range", at(k))),
        }
    };
    let emissive = match f.get("from") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "lights" => None,
        Some(v) => match v.get("emissive").and_then(Value::as_f64) {
            // EV100 as a luminance: L = 2^EV × K ÷ 100, K = 12.5.
            Some(ev) if ev.is_finite() => Some(ops::pow(2.0, ev) * 0.125),
            _ => return Err(bad("out_of_range", at("from"))),
        },
    };
    let ghosts = num(f.get("ghosts"), "ghosts", 0.0, [0.0, f64::from(MAX_GHOSTS)])?;
    let streak = f.get("streak");
    let streaks = num(
        streak.and_then(|s| s.get("count")),
        "streak/count",
        0.0,
        [0.0, 6.0],
    )?;
    if streaks % 2.0 != 0.0 || ghosts.fract() != 0.0 {
        return Err(bad(
            "out_of_range",
            at(if ghosts.fract() != 0.0 {
                "ghosts"
            } else {
                "streak/count"
            }),
        ));
    }
    let length = num(
        streak.and_then(|s| s.get("length")),
        "streak/length",
        0.0,
        [0.0, 4.0],
    )?;
    let anamorphic = streak
        .and_then(|s| s.get("anamorphic"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let halo = num(f.get("halo"), "halo", 0.0, [0.0, 4.0])?;
    let blades = num(
        f.get("starburst").and_then(|s| s.get("blades")),
        "starburst/blades",
        0.0,
        [0.0, 16.0],
    )?;
    let intensity = num(f.get("intensity"), "intensity", 1.0, [0.0, 1e6])?;
    let tint = match f.get("tint").and_then(Value::as_str) {
        None => [1.0; 3],
        Some(role) => {
            let c = look
                .role(role)
                .ok_or_else(|| bad("ref_unresolved", at("tint")))?;
            c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0))
        }
    };
    Ok(Flare {
        id: id.to_string(),
        emissive,
        ghosts: ghosts as u32,
        streaks: streaks as u32,
        length,
        anamorphic,
        halo,
        blades: blades.round() as u32,
        intensity,
        tint,
    })
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The share of a disc of `r` px at `c` inside a `w` × `h` frame, on a 64 × 64 grid over its
/// bounding square (exact 0 and 1 when it lies wholly out or in).
pub fn inside(c: [f64; 2], r: f64, size: [f64; 2]) -> f64 {
    if r <= 0.0 {
        let inn = c[0] >= 0.0 && c[1] >= 0.0 && c[0] < size[0] && c[1] < size[1];
        return if inn { 1.0 } else { 0.0 };
    }
    if c[0] - r >= 0.0 && c[1] - r >= 0.0 && c[0] + r <= size[0] && c[1] + r <= size[1] {
        return 1.0;
    }
    if c[0] + r <= 0.0 || c[1] + r <= 0.0 || c[0] - r >= size[0] || c[1] - r >= size[1] {
        return 0.0;
    }
    const N: usize = 64;
    let (mut disc, mut both) = (0u32, 0u32);
    for i in 0..N {
        for j in 0..N {
            let x = ((i as f64 + 0.5) / N as f64 * 2.0 - 1.0) * r;
            let y = ((j as f64 + 0.5) / N as f64 * 2.0 - 1.0) * r;
            if x * x + y * y > r * r {
                continue;
            }
            disc += 1;
            let (px, py) = (c[0] + x, c[1] + y);
            if px >= 0.0 && py >= 0.0 && px < size[0] && py < size[1] {
                both += 1;
            }
        }
    }
    f64::from(both) / f64::from(disc.max(1))
}

/// Scales a source's radiance times its disc's area in px² to the flare's linear light: the
/// shapes are each of unit area, so this is the light a whole component spreads.
pub const GAIN: f64 = 0.015;

/// The flare's sources in `scene` at its size: every light (or emissive part) whose fade disc
/// reaches the frame, the brightest [`MAX_SOURCES`].
pub fn sources(scene: &Scene, flare: &Flare, look: &Look3) -> Vec<Source> {
    let cam = &scene.camera;
    let size = [f64::from(scene.size[0]), f64::from(scene.size[1])];
    let halo = flare.halo * size[0];
    let mut out: Vec<(f64, Source)> = Vec::new();
    let mut push = |at: [f64; 2], radius: f64, point: Option<Vec3>, radiance: Vec3| {
        let fade = halo + radius;
        let share = inside(at, fade, size);
        if share <= 0.0 {
            return;
        }
        let area = std::f64::consts::PI * ops::powi(radius.max(0.5), 2);
        let k = look.exposure * area * flare.intensity * GAIN;
        let color: Vec3 = std::array::from_fn(|c| radiance[c] * flare.tint[c] * k);
        let weight = color.iter().sum::<f64>();
        if weight > 0.0 {
            out.push((
                weight,
                Source {
                    at,
                    radius,
                    point,
                    color,
                    inside: share,
                },
            ));
        }
    };
    // From emissive pixels the GPU finds the sources in the frame it draws (scene3d's flare pass).
    if flare.emissive.is_some() {
        return Vec::new();
    }
    for l in &scene.lights {
        let (point, radius_m, radiance) = match l.kind {
            LightKind::Sun => {
                let half = (l.angle.max(0.53) / 2.0).to_radians();
                let solid = std::f64::consts::PI * ops::powi(ops::sin(half), 2);
                let toward = l.dir.map(|v| -v);
                let far = std::array::from_fn(|c| cam.eye[c] + toward[c] * 1e6);
                let Some(p) = cam.project(far) else { continue };
                let r = cam.px_per_m(p[2]) * 1e6 * ops::tan(half);
                push(
                    [p[0], p[1]],
                    r,
                    None,
                    l.color.map(|c| c * l.intensity / solid),
                );
                continue;
            }
            LightKind::Area => {
                // Its axes are half its size long.
                let a = l.area.as_ref().map_or(0.0, |a| {
                    let side = |x: Vec3| ops::sqrt(dot(x, x));
                    side(a.right) * side(a.up) * if a.disk { std::f64::consts::PI } else { 4.0 }
                });
                let r = ops::sqrt(a / std::f64::consts::PI);
                // Its face's radiance: Φ ÷ (π A), with intensity = Φ ÷ 4π.
                (
                    l.pos,
                    r,
                    l.color.map(|c| c * 4.0 * l.intensity / a.max(1e-9)),
                )
            }
            LightKind::Point | LightKind::Spot => {
                let r = l.radius.max(1e-3);
                let mut cone = 1.0;
                if l.kind == LightKind::Spot {
                    let to_eye: Vec3 = std::array::from_fn(|c| cam.eye[c] - l.pos[c]);
                    let len = ops::sqrt(dot(to_eye, to_eye)).max(1e-9);
                    let cos = dot(to_eye, l.dir) / len;
                    let [outer, inner] = l.cone;
                    cone = ((cos - outer) / (inner - outer).max(1e-6)).clamp(0.0, 1.0);
                }
                (
                    l.pos,
                    r,
                    l.color
                        .map(|c| c * cone * l.intensity / (std::f64::consts::PI * r * r)),
                )
            }
        };
        let Some(p) = cam.project(point) else {
            continue;
        };
        let r = cam.px_per_m(p[2]) * radius_m;
        push([p[0], p[1]], r, Some(point), radiance);
    }
    out.sort_by(|a, b| b.0.total_cmp(&a.0));
    out.truncate(MAX_SOURCES);
    out.into_iter().map(|(_, s)| s).collect()
}
