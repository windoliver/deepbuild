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

/// The local tone map (Look `look@1`: tone mapping, `local`; #971): the frame's base, an
/// edge-aware smoothing of its log2 luminance, compressed toward middle grey and its detail
/// scaled, in linear light after the exposure and before the tone curve.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Local {
    /// How far the base moves toward middle grey, 0 to 1.
    pub strength: f64,
    /// The detail's scale, 0 to 2.
    pub detail: f64,
    /// The range sigma that brings the base back up, in stops.
    pub sigma: f64,
    /// The pyramid's levels on a frame whose longer side is 1920 px, 2 to 7.
    pub levels: u32,
}

impl Default for Local {
    fn default() -> Local {
        Local {
            strength: 0.0,
            detail: 1.0,
            sigma: 0.9,
            levels: 6,
        }
    }
}

impl Local {
    /// Strength 0 and detail 1 change no pixel.
    pub fn is_identity(&self) -> bool {
        self.strength == 0.0 && self.detail == 1.0
    }

    /// The pyramid's levels on a frame of `size`: one more for each doubling of its longer side
    /// from 1920 px and one fewer for each halving, so the coarsest level's cells cover the same
    /// share of a frame at every output size; never fewer than 2, the first level's 4 px cells.
    pub fn levels_at(&self, size: [u32; 2]) -> u32 {
        let long = size[0].max(size[1]).max(1);
        let doublings = if long >= 1920 {
            i64::from((long / 1920).ilog2())
        } else {
            -i64::from(1920u32.div_ceil(long).next_power_of_two().ilog2())
        };
        (i64::from(self.levels) + doublings).max(2) as u32
    }

    /// A look's `local`: `none`, or an object whose fields default to the identity.
    fn read(v: Option<&Value>) -> Result<Option<Local>, String> {
        let o = match v {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::String(s)) if s == "none" => return Ok(None),
            Some(Value::Object(o)) => o,
            Some(other) => return Err(format!("local: {other} is not none or an object")),
        };
        let d = Local::default();
        let num = |k: &str, d: f64, lo: f64, hi: f64| match o.get(k) {
            None => Ok(d),
            Some(v) => v
                .as_f64()
                .filter(|x| (lo..=hi).contains(x))
                .ok_or(format!("local.{k}: {v} is outside [{lo}, {hi}]")),
        };
        let sigma = match o.get("sigma") {
            None => d.sigma,
            Some(v) => v.as_f64().filter(|s| *s > 0.0).ok_or(format!(
                "local.sigma: {v} is not a positive number of stops"
            ))?,
        };
        let levels = match o.get("levels") {
            None => d.levels,
            Some(v) => v.as_u64().filter(|n| (2..=7).contains(n)).ok_or(format!(
                "local.levels: {v} is not a whole number from 2 to 7"
            ))? as u32,
        };
        Ok(Some(Local {
            strength: num("strength", d.strength, 0.0, 1.0)?,
            detail: num("detail", d.detail, 0.0, 2.0)?,
            sigma,
            levels,
        }))
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
    /// #971: the local tone map, `None` with it off.
    pub local: Option<Local>,
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
            local: None,
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
        out.local = Local::read(look.get("local"))?;
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

    /// #971: `local` defaults to the identity and refuses a field outside the design's range;
    /// its pyramid gains a level for each doubling of the frame's longer side from 1920 px.
    #[test]
    fn local_reads_its_fields_and_its_levels_follow_the_size() {
        let read = |text: &str| Local::read(Some(&serde_json::from_str(text).unwrap()));
        assert_eq!(read(r#""none""#), Ok(None));
        let half = read(r#"{"strength": 0.5}"#).unwrap().unwrap();
        let wanted = Local {
            strength: 0.5,
            ..Local::default()
        };
        assert_eq!(half, wanted);
        assert!(Local::default().is_identity() && !half.is_identity());
        for bad in [
            r#"{"strength": 1.5}"#,
            r#"{"detail": 2.5}"#,
            r#"{"sigma": 0}"#,
            r#"{"levels": 8}"#,
            r#"{"levels": 1}"#,
            "3",
        ] {
            assert!(read(bad).is_err(), "{bad} is refused");
        }
        let at = |w, h| Local::default().levels_at([w, h]);
        assert_eq!(
            [
                at(1920, 1080),
                at(3840, 2160),
                at(3839, 2160),
                at(1080, 1920)
            ],
            [6, 7, 6, 6]
        );
        assert_eq!([at(960, 540), at(959, 540), at(1, 1)], [5, 4, 2]);
    }
}
