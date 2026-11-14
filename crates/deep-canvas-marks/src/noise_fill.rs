//! A noise fill on the CPU (canvas primitives: Paint: noise fill; #1938): the fill's value at a
//! point from the core's public noise and cells steps in pinned f64 math, mapped through its ramp
//! of look roles in OKLab, so the CPU raster render-back draws with shows the noise and the seed
//! a channel gives it at t, where it drew the first stop alone. Evolution's 4D phase is the
//! drawn pass's; here the fill is drawn at evolution 0.

use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
use deep_canvas::ops::{cos, rad, sin};
use deep_canvas::steps::{cells, fbm2, hash1, Metric};
use deep_canvas_drawn::spec::Noise;
use serde_json::Value;

use crate::scene::{Palette, Rgb};

/// A noise fill as evaluated at t, its stops' roles resolved in the palette.
#[derive(Clone, Debug, PartialEq)]
pub struct NoiseFill {
    pub noise: Noise,
    /// `(at, color)`, in OKLab.
    ramp: Vec<(f64, Oklab)>,
}

/// The noise fill of an item's evaluated `params`, if its paint names one whose stops all
/// resolve.
pub fn of(params: &Value, palette: &Palette, path: &str) -> Option<NoiseFill> {
    let mut n = params.pointer("/paint/fill/noise")?.as_object()?.clone();
    // A seed a channel writes arrives as a number of its type, an f32's a float: its whole part.
    if let Some(s) = n.get("seed").and_then(Value::as_f64).filter(|s| *s >= 0.0) {
        n.insert("seed".into(), Value::from(s.floor() as u64));
    }
    let noise = deep_canvas_drawn::spec::noise(&n, &format!("{path}/paint/fill/noise")).ok()?;
    let ramp = noise
        .stops
        .iter()
        .map(|(at, role)| {
            let c = palette.get(role)?;
            let s = Srgb {
                r: f64::from(c[0]) / 255.0,
                g: f64::from(c[1]) / 255.0,
                b: f64::from(c[2]) / 255.0,
            };
            Some((*at, srgb_to_oklab(s)))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(NoiseFill { noise, ramp })
}

/// Value noise: the lattice's own values, from the integer hash, blended by the quintic fade;
/// about -1..1.
fn value2(p: [f64; 2], seed: u32) -> f64 {
    let (ix, iy) = (p[0].floor(), p[1].floor());
    let (fx, fy) = (p[0] - ix, p[1] - iy);
    let (cx, cy) = (ix as i32, iy as i32);
    let at = |x: i32, y: i32| {
        let h = hash1(hash1(hash1(seed) ^ x as u32) ^ y as u32);
        f64::from(h >> 8) / 8_388_607.5 - 1.0
    };
    let fade = |t: f64| t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    let (ux, uy) = (fade(fx), fade(fy));
    let mix = |a: f64, b: f64, t: f64| a * (1.0 - t) + b * t;
    let bottom = mix(at(cx, cy), at(cx + 1, cy), ux);
    let top = mix(at(cx, cy + 1), at(cx + 1, cy + 1), ux);
    mix(bottom, top, uy)
}

impl NoiseFill {
    /// The fill's value at `p`, in the document's units, in 0..1.
    pub fn value(&self, p: [f64; 2]) -> f64 {
        let n = &self.noise;
        let seed = n.seed as u32;
        let (c, s) = (cos(rad(n.rotation)), sin(rad(n.rotation)));
        let q = [
            (p[0] - n.offset[0]) / n.scale.max(1e-9),
            (p[1] - n.offset[1]) / n.scale.max(1e-9),
        ];
        let q = [q[0] * c + q[1] * s, (-q[0] * s + q[1] * c) * n.aspect];
        let v = match n.kind {
            // Cells: the distance to the nearest feature point.
            2 => cells(&q, seed, 0.7, Metric::Euclidean, [0; 3]).f1.clamp(0.0, 1.0),
            kind => {
                let (mut sum, mut amp, mut norm, mut at) = (0.0, 1.0, 0.0, q);
                for k in 0..n.octaves.max(1) {
                    let x = match kind {
                        3 => value2(at, seed.wrapping_add(k)),
                        _ => fbm2(at, seed.wrapping_add(k), 1, 2.0, 0.5, [0, 0]),
                    };
                    sum += amp * if kind == 1 { x.abs() * 2.0 - 1.0 } else { x };
                    norm += amp;
                    amp *= n.roughness * 1.2;
                    at = [at[0] * 2.0, at[1] * 2.0];
                }
                0.5 + 0.5 * (1.6 * sum / norm).clamp(-1.0, 1.0)
            }
        };
        ((v - 0.5) * n.contrast + 0.5 + n.brightness).clamp(0.0, 1.0)
    }

    /// The fill's color at `p`: its value through the ramp, in OKLab.
    pub fn color(&self, p: [f64; 2]) -> Rgb {
        let v = self.value(p);
        let r = &self.ramp;
        let k = r.iter().position(|(at, _)| *at >= v).unwrap_or(r.len());
        let c = match (k.checked_sub(1).and_then(|j| r.get(j)), r.get(k)) {
            (Some((a, x)), Some((b, y))) if b > a => {
                let t = (v - a) / (b - a);
                Oklab {
                    l: x.l + (y.l - x.l) * t,
                    a: x.a + (y.a - x.a) * t,
                    b: x.b + (y.b - x.b) * t,
                }
            }
            (_, Some((_, y))) => *y,
            (Some((_, x)), None) => *x,
            (None, None) => Oklab { l: 0.0, a: 0.0, b: 0.0 },
        };
        let s = oklab_to_srgb(c);
        [s.r, s.g, s.b].map(|x| (x * 255.0).round().clamp(0.0, 255.0) as u8)
    }
}
