//! What a 3D writer layer reads of the look (canvas primitives: Look `look@1` and its tone
//! mapping, grade, ao and deband): each role's color, the ground, the exposure as a linear scale,
//! the tone map, the grade, ambient occlusion and the deband. The finish's other effects run at
//! identity, so they read nothing here.

use std::collections::BTreeMap;

use deep_canvas::ops;
use serde_json::Value;

pub use deep_canvas_marks::finish::exposure_scale;
pub use deep_canvas_marks::finish::ToneMap;
use deep_canvas_marks::finish::{read_grade, read_tone_map, Grade, DEBAND_MAX_LSB};

/// The look's basis: physical looks deband by default, drawings don't.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Basis {
    Physical,
    Drawing,
    Indexed,
}

/// Ambient occlusion (Look `look@1`: ao): from a depth and normal prepass, scaling only the
/// ambient, probe and environment terms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ao {
    /// Metres.
    pub radius: f64,
    pub strength: f64,
    /// 8 or 16.
    pub samples: u32,
    pub half: bool,
    pub multi_bounce: bool,
    pub specular: bool,
}

impl Default for Ao {
    fn default() -> Ao {
        Ao {
            radius: 0.5,
            strength: 1.0,
            samples: 8,
            half: true,
            multi_bounce: true,
            specular: true,
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
    /// Its named materials, each a `material@1`'s params, that a material's `from` starts from.
    pub materials: serde_json::Map<String, Value>,
    pub basis: Basis,
    pub grade: Grade,
    pub ao: Option<Ao>,
    /// The deband's amplitude in 8-bit steps, or `None` with it off.
    pub deband: Option<f64>,
    /// The most taps a mipmapped texture's sampler takes along its footprint's long axis (#423;
    /// Material: texture maps): 1, 2, 4 or 8, 8 by default.
    pub filter_taps: u8,
    /// Look: samples, `live`: the sub-samples a live frame is the mean of (#423), 1 by default.
    pub live_samples: u32,
    /// Look: samples in full (#419): live, export, settling, the filter and what samples vary.
    pub samples: crate::samples::Samples,
    /// Motion blur (#419), `None` with it off.
    pub blur: Option<crate::samples::Blur>,
    /// Frame history (#173), a live view's alone.
    pub history: crate::history::History,
    /// A drawing look's drawn fields (#149): its light, paper, lines and fills.
    pub drawn: Option<std::sync::Arc<deep_canvas_drawn::spec::Look>>,
    /// #464: its separations and print finishes, which the print pass draws after the output.
    pub print: std::sync::Arc<deep_canvas_marks::print::Print>,
    /// #462: strokes laid on its surfaces (Look `look@1`: strokes on surfaces).
    pub strokes: Option<std::sync::Arc<crate::strokes::Strokes>>,
    /// #462: its motifs (Look `look@1`: motifs), which move the items the document's
    /// `motif_slots` bind as each frame is evaluated.
    pub motifs: Vec<deep_canvas_motion::motif::Motif>,
    /// Reduced motion, the viewer's setting rather than the look's: its motifs hold still.
    pub reduced_motion: bool,
}

/// The EV100 whose exposure scale is 1, a look's default.
pub fn unit_ev100() -> f64 {
    -ops::log2(1.2)
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
            materials: serde_json::Map::new(),
            basis: Basis::Drawing,
            grade: Grade::default(),
            ao: None,
            deband: None,
            filter_taps: 8,
            live_samples: 1,
            samples: crate::samples::Samples::default(),
            blur: None,
            history: crate::history::History::default(),
            drawn: None,
            print: Default::default(),
            strokes: None,
            motifs: Vec::new(),
            reduced_motion: false,
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
        out.strokes = crate::strokes::read(look)?.map(std::sync::Arc::new);
        out.motifs = deep_canvas_motion::motif::parse(look)
            .map_err(|r| format!("{}: {}", r.code, r.path))?;
        if let Value::Object(def) = look {
            if def.get("basis").and_then(Value::as_str) == Some("drawing") {
                let mut lowered = look.clone();
                deep_canvas::grammar::lower_frame_literals(&mut lowered, (1920, 1080));
                if let Value::Object(def) = &lowered {
                    let read = deep_canvas_drawn::spec::Look::read(def)
                        .map_err(|r| format!("{}: {}", r.code, r.path))?;
                    out.drawn = Some(std::sync::Arc::new(read));
                }
            }
        }
        if let Some(m) = look.get("materials").and_then(Value::as_object) {
            out.materials = m.clone();
        }
        out.tone_map = read_tone_map(look.get("tone_map"))?;
        out.exposure = match look.get("exposure") {
            None | Some(Value::Null) => 1.0,
            Some(v) => exposure_scale(v.as_f64().ok_or("exposure is an EV100 number")?),
        };
        out.basis = match look.get("basis").and_then(Value::as_str) {
            None | Some("drawing") => Basis::Drawing,
            Some("physical") => Basis::Physical,
            Some("indexed") => Basis::Indexed,
            Some(other) => {
                return Err(format!(
                    "basis: {other} is not physical, drawing or indexed"
                ))
            }
        };
        out.grade = read_grade(look.get("grade"))?;
        out.print = std::sync::Arc::new(
            deep_canvas_marks::print::read(look, &out.roles, 1920.0)
                .map_err(|r| format!("{}: {}", r.code, r.path))?,
        );
        out.filter_taps = match look.get("filter_taps").map(Value::as_u64) {
            None => 8,
            Some(Some(n @ (1 | 2 | 4 | 8))) => n as u8,
            Some(_) => return Err("filter_taps is 1, 2, 4 or 8".into()),
        };
        out.samples = crate::samples::read_samples(look)?;
        out.live_samples = out.samples.live;
        out.blur = crate::samples::read_blur(look)?;
        out.history = crate::history::read_history(look)?;
        out.ao = match look.get("ao") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s == "none" => None,
            Some(Value::Object(o)) => {
                let d = Ao::default();
                let num = |k: &str, d: f64| o.get(k).and_then(Value::as_f64).unwrap_or(d);
                let flag = |k: &str, d: bool| o.get(k).and_then(Value::as_bool).unwrap_or(d);
                let samples = o.get("samples").and_then(Value::as_u64).unwrap_or(8);
                if samples != 8 && samples != 16 {
                    return Err(format!("ao.samples: {samples} is not 8 or 16"));
                }
                let half = match o.get("resolution").and_then(Value::as_str) {
                    None | Some("half") => true,
                    Some("full") => false,
                    Some(other) => {
                        return Err(format!("ao.resolution: {other} is not half or full"))
                    }
                };
                Some(Ao {
                    radius: num("radius", d.radius),
                    strength: num("strength", d.strength),
                    samples: samples as u32,
                    half,
                    multi_bounce: flag("multi_bounce", d.multi_bounce),
                    specular: flag("specular", d.specular),
                })
            }
            Some(other) => return Err(format!("ao: {other} is not none or an object")),
        };
        let lsb = match look.get("deband_lsb") {
            None | Some(Value::Null) => 1.0,
            Some(v) => v.as_f64().ok_or("deband_lsb is a number of 8-bit steps")?,
        };
        if !(0.0..=DEBAND_MAX_LSB).contains(&lsb) {
            return Err(format!(
                "deband_lsb: {lsb} is outside [0, {DEBAND_MAX_LSB}]"
            ));
        }
        let spatial = match look.get("deband").and_then(Value::as_str) {
            None => out.basis == Basis::Physical,
            Some("spatial") => true,
            Some("none") => false,
            Some(other) => return Err(format!("deband: {other} is not none or spatial")),
        };
        out.deband = spatial.then_some(lsb);
        Ok(out)
    }

    pub fn role(&self, name: &str) -> Option<[u8; 3]> {
        self.roles.get(name).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// studio@1's looks (#418): Neutral for product, toy and paper scenes, AgX for night, lamps
    /// and fire, with bloom and ao, and no tone map for drawings; physical looks deband.
    #[test]
    fn studio_looks_carry_their_defaults() {
        let read = |text: &str| Look3::read(&serde_json::from_str(text).unwrap()).unwrap();
        let neutral = read(include_str!(
            "../../../packs/studio-1.0.0/looks/physical_neutral.json"
        ));
        assert_eq!(neutral.tone_map, ToneMap::Neutral);
        assert_eq!(
            (neutral.basis, neutral.deband),
            (Basis::Physical, Some(1.0))
        );
        assert!((neutral.exposure - 1.0).abs() < 1e-12);
        for text in [
            include_str!("../../../packs/studio-1.0.0/looks/physical_film.json"),
            include_str!("../../../packs/studio-1.0.0/looks/physical_night.json"),
        ] {
            let l = read(text);
            assert!(matches!(l.tone_map, ToneMap::Agx { .. }));
            assert!(l.ao.is_some() && l.deband.is_some());
        }
        let ink = read(include_str!(
            "../../../packs/studio-1.0.0/looks/drawing_ink.json"
        ));
        assert_eq!(
            (ink.tone_map, ink.basis, ink.deband),
            (ToneMap::None, Basis::Drawing, None)
        );
        assert!(ink.grade.is_identity());
    }
}
