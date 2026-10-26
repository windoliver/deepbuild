//! What a 3D writer layer reads of the look (canvas primitives: Look `look@1` and its tone
//! mapping): each role's color, the ground, the exposure as a linear scale and the tone map. The
//! finish runs at identity, so it reads nothing here.

use std::collections::BTreeMap;

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

#[derive(Clone, Debug, PartialEq)]
pub struct Look3 {
    /// Role → its color, sRGB-encoded.
    pub roles: BTreeMap<String, [u8; 3]>,
    pub ground: [u8; 3],
    pub tone_map: ToneMap,
    /// Linear light's scale: 1 ÷ (1.2 × 2^EV100), the saturation-based photometric exposure.
    pub exposure: f64,
}

/// The EV100 whose exposure scale is 1, a look's default.
pub fn unit_ev100() -> f64 {
    -ops::log2(1.2)
}

pub fn exposure_scale(ev100: f64) -> f64 {
    1.0 / (1.2 * ops::pow(2.0, ev100))
}

fn hex(text: &str) -> Option<[u8; 3]> {
    let h = text.strip_prefix('#')?;
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

impl Look3 {
    /// The roles a look already resolved (a session's palette), with no tone map at unit exposure.
    pub fn from_roles(roles: BTreeMap<String, [u8; 3]>) -> Look3 {
        let ground = roles.get("ground").copied().unwrap_or([255, 255, 255]);
        Look3 {
            roles,
            ground,
            tone_map: ToneMap::None,
            exposure: 1.0,
        }
    }

    /// A `look@1` object: its roles through its palette, its ground, tone map and exposure.
    pub fn read(look: &Value) -> Result<Look3, String> {
        let palette = look.get("palette").and_then(Value::as_object);
        let color = |name: &str| -> Option<[u8; 3]> {
            hex(name).or_else(|| palette?.get(name)?.as_str().and_then(hex))
        };
        let mut roles = BTreeMap::new();
        if let Some(r) = look.get("roles").and_then(Value::as_object) {
            for (role, v) in r {
                if let Some(c) = v.as_str().and_then(color) {
                    roles.insert(role.clone(), c);
                }
            }
        }
        let mut out = Look3::from_roles(roles);
        out.tone_map = match look.get("tone_map") {
            None | Some(Value::Null) => ToneMap::None,
            Some(Value::String(s)) => match s.as_str() {
                "none" => ToneMap::None,
                "filmic" => ToneMap::Filmic,
                "agx" => ToneMap::Agx {
                    white: 16.29,
                    contrast: 1.25,
                },
                "neutral" => ToneMap::Neutral,
                other => {
                    return Err(format!(
                        "tone_map: {other} is not none, filmic, agx or neutral"
                    ))
                }
            },
            Some(Value::Object(o)) if o.contains_key("agx") => ToneMap::Agx {
                white: o["agx"]["white"].as_f64().unwrap_or(16.29),
                contrast: o["agx"]["contrast"].as_f64().unwrap_or(1.25),
            },
            Some(other) => return Err(format!("tone_map: {other} is not a tone map")),
        };
        out.exposure = match look.get("exposure") {
            None | Some(Value::Null) => 1.0,
            Some(v) => exposure_scale(v.as_f64().ok_or("exposure is an EV100 number")?),
        };
        Ok(out)
    }

    pub fn role(&self, name: &str) -> Option<[u8; 3]> {
        self.roles.get(name).copied()
    }
}
