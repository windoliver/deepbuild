//! The look's finish in f64 (canvas primitives: Look `look@1`: tone mapping, grade, deband): the
//! curves, the grade and the deband dither as the output pass runs them, so a check can apply the
//! grade to a palette role and a fixture can hold the GPU's curves to their analytic forms.
//!
//! Order, per pixel: exposure, the white balance (a Bradford adaptation in linear light), the tone
//! curve, the ASC CDL and saturation, the sRGB encode, then the deband dither just before the
//! target quantizes to 8 bits. Status colors draw after all of it.

use deep_canvas::ops;
use serde_json::Value;

/// The look's tone map, applied after the exposure and before the sRGB encode.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ToneMap {
    None,
    /// The ACES filmic fit.
    Filmic,
    /// AgX's analytic curve between its inset and outset matrices.
    Agx {
        white: f64,
        contrast: f64,
    },
    /// Khronos PBR Neutral.
    Neutral,
}

impl ToneMap {
    /// The code the output pass switches on.
    pub fn code(self) -> u32 {
        match self {
            ToneMap::None => 0,
            ToneMap::Filmic => 1,
            ToneMap::Agx { .. } => 2,
            ToneMap::Neutral => 3,
        }
    }
}

/// Rec. 709 luma weights, linear light.
pub const LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];

/// AgX's inset matrix, rows.
pub const AGX_INSET: [[f64; 3]; 3] = [
    [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
    [0.137318972929847, 0.761241990602591, 0.101439036467562],
    [0.11189821299995, 0.0767994186031903, 0.811302368396859],
];

/// AgX's outset matrix, rows.
pub const AGX_OUTSET: [[f64; 3]; 3] = [
    [
        1.1271005818144368,
        -0.11060664309660323,
        -0.016493938717834573,
    ],
    [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
    [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405],
];

pub type Mat3 = [[f64; 3]; 3];

pub fn mul(m: &Mat3, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|r| m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2])
}

fn matmul(a: &Mat3, b: &Mat3) -> Mat3 {
    [0, 1, 2].map(|r| [0, 1, 2].map(|c| (0..3).map(|k| a[r][k] * b[k][c]).sum()))
}

fn inverse(m: &Mat3) -> Mat3 {
    let [[a, b, c], [d, e, f], [g, h, i]] = *m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
}

/// A look's `tone_map`: `none`, `filmic`, `agx` (at its defaults) or `{agx: {white, contrast}}`,
/// or `neutral`; absent is none.
pub fn read_tone_map(v: Option<&Value>) -> Result<ToneMap, String> {
    Ok(match v {
        None | Some(Value::Null) => ToneMap::None,
        Some(Value::String(s)) => match s.as_str() {
            "none" => ToneMap::None,
            "filmic" => ToneMap::Filmic,
            "agx" => ToneMap::Agx {
                white: 16.29,
                contrast: 1.25,
            },
            "neutral" => ToneMap::Neutral,
            other => return Err(format!("tone_map: {other} is not none, filmic, agx or neutral")),
        },
        Some(Value::Object(o)) if o.contains_key("agx") => ToneMap::Agx {
            white: o["agx"]["white"].as_f64().unwrap_or(16.29),
            contrast: o["agx"]["contrast"].as_f64().unwrap_or(1.25),
        },
        Some(other) => return Err(format!("tone_map: {other} is not a tone map")),
    })
}

/// Linear light's scale at `ev100`: 1 ÷ (1.2 × 2^EV100), the saturation-based photometric
/// exposure.
pub fn exposure_scale(ev100: f64) -> f64 {
    1.0 / (1.2 * ops::pow(2.0, ev100))
}

/// AgX's per-channel curve: a toe x^c ÷ (x^c + a) up to 0.18 and a shoulder from there with the
/// toe's slope, reaching 1 at `white` and clamped to 1 above it.
pub fn agx_curve(x: f64, white: f64, contrast: f64) -> f64 {
    let c = contrast;
    if x.is_nan() || x <= 0.0 {
        return 0.0;
    }
    let a = (1.0 / 0.18 - 1.0) * ops::pow(0.18, c);
    if x <= 0.18 {
        let xc = ops::pow(x, c);
        return xc / (xc + a);
    }
    if x >= white {
        return 1.0;
    }
    let s = ops::pow(0.18, c) + a;
    let k = c * ops::pow(0.18, c - 1.0) * a / (s * s);
    let w = k * (white - 0.18) * (white - 0.18) / 0.82;
    let d = x - 0.18;
    0.18 + k * d * (1.0 + d / w) / (1.0 + k * d / 0.82)
}

/// The ACES filmic fit.
pub fn filmic(x: f64) -> f64 {
    let v = x.max(0.0);
    ((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)).clamp(0.0, 1.0)
}

/// Khronos PBR Neutral.
pub fn neutral(x: [f64; 3]) -> [f64; 3] {
    let start = 0.8 - 0.04;
    let desat = 0.15;
    let m = x[0].min(x[1]).min(x[2]);
    let offset = if m < 0.08 { m - 6.25 * m * m } else { 0.04 };
    let mut c = x.map(|v| v - offset);
    let peak = c[0].max(c[1]).max(c[2]);
    if peak < start {
        return c.map(|v| v.clamp(0.0, 1.0));
    }
    let d = 1.0 - start;
    let new_peak = 1.0 - d * d / (peak + d - start);
    c = c.map(|v| v * new_peak / peak);
    let g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0);
    c.map(|v| (v * (1.0 - g) + new_peak * g).clamp(0.0, 1.0))
}

/// A linear, exposed value through the tone curve, into [0, 1].
pub fn tone(map: ToneMap, x: [f64; 3]) -> [f64; 3] {
    match map {
        ToneMap::None => x.map(|v| v.clamp(0.0, 1.0)),
        ToneMap::Filmic => x.map(filmic),
        ToneMap::Agx { white, contrast } => {
            let v = mul(&AGX_INSET, x.map(|v| v.max(0.0)));
            let curved = v.map(|v| agx_curve(v, white, contrast));
            mul(&AGX_OUTSET, curved).map(|v| v.clamp(0.0, 1.0))
        }
        ToneMap::Neutral => neutral(x),
    }
}

/// The grade (Look `look@1`: grade): a white balance in linear light before the tone curve, and
/// an ASC CDL with saturation after it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grade {
    /// Kelvin.
    pub temperature: f64,
    /// Along the green–magenta axis, as Δuv × 100 off the locus (positive is magenta).
    pub tint: f64,
    pub slope: [f64; 3],
    pub offset: [f64; 3],
    pub power: [f64; 3],
    pub saturation: f64,
}

pub const NEUTRAL_K: f64 = 6500.0;

impl Default for Grade {
    fn default() -> Grade {
        Grade {
            temperature: NEUTRAL_K,
            tint: 0.0,
            slope: [1.0; 3],
            offset: [0.0; 3],
            power: [1.0; 3],
            saturation: 1.0,
        }
    }
}

/// Linear sRGB to XYZ (D65).
const SRGB_XYZ: Mat3 = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
];

const BRADFORD: Mat3 = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];

/// The white of a Planckian light at `k` kelvin shifted by `tint`, as XYZ with Y = 1: Krystek's
/// rational fit of the locus in CIE 1960 uv, the tint along the locus's normal.
fn white_xyz(k: f64, tint: f64) -> [f64; 3] {
    let t = k.clamp(1000.0, 15000.0);
    let u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t)
        / (1.0 + 8.42420235e-4 * t + 7.08145163e-7 * t * t);
    let v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t)
        / (1.0 - 2.89741816e-5 * t + 1.61456053e-7 * t * t);
    // The locus's direction from a small step (u and v both fall as t rises), and its normal
    // toward magenta (lower v).
    let h = 1.0;
    let t2 = t + h;
    let u2 = (0.860117757 + 1.54118254e-4 * t2 + 1.28641212e-7 * t2 * t2)
        / (1.0 + 8.42420235e-4 * t2 + 7.08145163e-7 * t2 * t2);
    let v2 = (0.317398726 + 4.22806245e-5 * t2 + 4.20481691e-8 * t2 * t2)
        / (1.0 - 2.89741816e-5 * t2 + 1.61456053e-7 * t2 * t2);
    let (du, dv) = (u2 - u, v2 - v);
    let len = ops::sqrt(du * du + dv * dv);
    let (nu, nv) = if len > 0.0 {
        (-dv / len, du / len)
    } else {
        (0.0, -1.0)
    };
    let shift = tint / 100.0;
    let (u, v) = (u + nu * shift, v + nv * shift);
    // 1960 uv to xy.
    let d = 2.0 * u - 8.0 * v + 4.0;
    let (x, y) = (3.0 * u / d, 2.0 * v / d);
    [x / y, 1.0, (1.0 - x - y) / y]
}

impl Grade {
    pub fn is_identity(&self) -> bool {
        *self == Grade::default()
    }

    /// The white balance as one matrix on linear sRGB: a Bradford adaptation from the white at
    /// `temperature` and `tint` to the one at 6500 K with no tint, so the default is exactly the
    /// identity.
    pub fn white_balance(&self) -> Mat3 {
        if self.temperature == NEUTRAL_K && self.tint == 0.0 {
            return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        }
        let src = mul(&BRADFORD, white_xyz(self.temperature, self.tint));
        let dst = mul(&BRADFORD, white_xyz(NEUTRAL_K, 0.0));
        let scale = [
            [dst[0] / src[0], 0.0, 0.0],
            [0.0, dst[1] / src[1], 0.0],
            [0.0, 0.0, dst[2] / src[2]],
        ];
        let adapt = matmul(&inverse(&BRADFORD), &matmul(&scale, &BRADFORD));
        matmul(&inverse(&SRGB_XYZ), &matmul(&adapt, &SRGB_XYZ))
    }

    /// The CDL and saturation on a tone-mapped value.
    pub fn cdl(&self, x: [f64; 3]) -> [f64; 3] {
        let v = [0, 1, 2].map(|i| {
            let s = (x[i] * self.slope[i] + self.offset[i]).clamp(0.0, 1.0);
            ops::pow(s, self.power[i])
        });
        if self.saturation == 1.0 {
            return v;
        }
        let l = LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2];
        v.map(|c| l + self.saturation * (c - l))
    }
}

/// The finish on one linear value: exposure, white balance, the curve and the CDL, as linear
/// light in [0, 1] before the encode.
pub fn finish(map: ToneMap, exposure: f64, grade: &Grade, x: [f64; 3]) -> [f64; 3] {
    let lit = x.map(|v| v * exposure);
    let balanced = mul(&grade.white_balance(), lit);
    grade.cdl(tone(map, balanced)).map(|v| v.clamp(0.0, 1.0))
}

pub fn srgb_encode(v: f64) -> f64 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * ops::pow(v, 1.0 / 2.4) - 0.055
    }
}

pub fn srgb_decode(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ops::pow((v + 0.055) / 1.055, 2.4)
    }
}

/// The deband's most, in 8-bit steps.
pub const DEBAND_MAX_LSB: f64 = 2.0;

/// An integer hash of a pixel and a lane (lowbias32), the same in the shader.
pub fn hash(x: u32, y: u32, lane: u32) -> u32 {
    let mut h = x
        .wrapping_mul(0x8da6_b343)
        .wrapping_add(y.wrapping_mul(0xd816_3841))
        .wrapping_add(lane.wrapping_mul(0xcb1a_b31f));
    h ^= h >> 16;
    h = h.wrapping_mul(0x7feb_352d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x846c_a68b);
    h ^= h >> 16;
    h
}

/// The deband's offset at pixel (x, y) in 8-bit steps: a triangular dither of `lsb` steps, the
/// sum of two uniform hashes, so it is in (−lsb, lsb) and never depends on time or frame.
pub fn deband(x: u32, y: u32, lsb: f64) -> f64 {
    let u = |lane| f64::from(hash(x, y, lane) >> 8) / 16_777_216.0;
    (u(0) + u(1) - 1.0) * lsb.clamp(0.0, DEBAND_MAX_LSB)
}

/// A look's `grade`: its white balance and CDL, each field defaulting to the identity; a LUT is
/// refused.
pub fn read_grade(v: Option<&Value>) -> Result<Grade, String> {
    let mut g = Grade::default();
    let Some(v) = v.filter(|v| !v.is_null()) else {
        return Ok(g);
    };
    let o = v.as_object().ok_or("grade is an object")?;
    for k in o.keys() {
        if !matches!(
            k.as_str(),
            "white_balance" | "slope" | "offset" | "power" | "saturation"
        ) {
            return Err(format!(
                "grade.{k}: a grade is a white balance and an ASC CDL; it takes no LUT or other field"
            ));
        }
    }
    if let Some(wb) = o.get("white_balance") {
        let num = |k: &str| wb.get(k).and_then(Value::as_f64);
        g.temperature = num("temperature").unwrap_or(g.temperature);
        g.tint = num("tint").unwrap_or(g.tint);
        if !(1000.0..=15000.0).contains(&g.temperature) {
            return Err(format!(
                "grade.white_balance.temperature: {} K is outside [1000, 15000]",
                g.temperature
            ));
        }
    }
    let rgb = |k: &str, d: [f64; 3]| -> Result<[f64; 3], String> {
        match o.get(k) {
            None => Ok(d),
            Some(a) => {
                let a = a.as_array().filter(|a| a.len() == 3);
                let a = a.ok_or(format!("grade.{k} is three linear RGB numbers"))?;
                let mut out = [0.0; 3];
                for (i, x) in a.iter().enumerate() {
                    out[i] = x.as_f64().ok_or(format!("grade.{k} is three numbers"))?;
                }
                Ok(out)
            }
        }
    };
    g.slope = rgb("slope", g.slope)?;
    g.offset = rgb("offset", g.offset)?;
    g.power = rgb("power", g.power)?;
    if g.power.iter().any(|p| *p <= 0.0) || g.slope.iter().any(|s| *s < 0.0) {
        return Err("grade: power is positive and slope at least 0".into());
    }
    if let Some(s) = o.get("saturation") {
        g.saturation = s.as_f64().ok_or("grade.saturation is a number")?;
    }
    Ok(g)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agx_curve_meets_at_mid_grey_and_white() {
        for c in [1.0, 1.25, 1.5] {
            let at = agx_curve(0.18, 16.29, c);
            assert!((at - 0.18).abs() < 1e-12);
            assert!((agx_curve(16.29 - 1e-9, 16.29, c) - 1.0).abs() < 1e-6);
            assert_eq!(agx_curve(20.0, 16.29, c), 1.0);
        }
    }

    #[test]
    fn grade_default_is_identity_and_greys_stay_grey() {
        let g = Grade::default();
        let x = [0.3, 0.5, 0.7];
        assert_eq!(finish(ToneMap::None, 1.0, &g, x), x);
        let warm = Grade {
            temperature: 3200.0,
            ..Grade::default()
        };
        let out = mul(&warm.white_balance(), [1.0, 1.0, 1.0]);
        // A warm light balanced to neutral: white shifts blue.
        assert!(out[2] > out[0]);
    }

    #[test]
    fn deband_is_bounded_and_centred() {
        let mut sum = 0.0;
        for y in 0..64 {
            for x in 0..64 {
                let d = deband(x, y, 2.0);
                assert!(d.abs() < 2.0);
                sum += d;
            }
        }
        assert!((sum / 4096.0).abs() < 0.05);
    }
}
