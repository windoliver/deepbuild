//! `sky@1` (#422; canvas primitives: Sky `sky@1`, its environment and its height fog): the
//! scene's background gradient, fog, stars and moon, and the environment that lights and
//! reflects, as one document's first sky reads at t.

use serde_json::Value;

use crate::look::Look3;
use crate::scene::{num, Refused};

type Vec3 = [f64; 3];

/// What fog mixes a surface toward.
#[derive(Clone, Debug, PartialEq)]
pub enum Fog {
    Color(Vec3),
    /// What the background shows along the pixel's view ray.
    Background,
}

/// What lights and reflects.
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    /// The document's own sky.
    Sky,
    /// The shipped neutral room.
    Studio,
    /// An equirectangular HDR, by its hash, with its bytes when the store holds them.
    Asset(String, Option<std::sync::Arc<Vec<u8>>>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Environment {
    pub from: Source,
    pub intensity: f64,
    /// Degrees about +Y.
    pub rotation: f64,
    /// The prefiltered cube's face, in px.
    pub size: u32,
    /// A second HDR and how far toward it, 0..1.
    pub mix: Option<(Source, f64)>,
}

/// What draws behind the scene.
#[derive(Clone, Debug, PartialEq)]
pub enum Background {
    Auto,
    Sky,
    Environment,
    /// An equirectangular video by its hash, its frame at t.
    Video(String),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Exp,
    Exp2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sky {
    pub id: String,
    /// The gradient's radiance above and at the horizon, linear RGB, exposed so the look shows
    /// the colors given.
    pub top: Vec3,
    pub low: Vec3,
    /// The ambient light from above and below, linear RGB (#418).
    pub ambient: [Vec3; 2],
    pub fog: Fog,
    /// 1/m; 0 is off.
    pub fog_density: f64,
    pub fog_curve: Curve,
    /// Mist below `top` (m) at `density` (1/m), added to the distance fog.
    pub fog_height: Option<(f64, f64)>,
    pub stars: f64,
    /// Azimuth, elevation and radius, in degrees.
    pub moon: Option<Vec3>,
    /// The light whose direction the sky follows.
    pub sun: Option<String>,
    pub environment: Option<Environment>,
    pub background: Background,
    /// The roughness whose prefiltered mip the background shows.
    pub background_blur: f64,
    /// The ground an HDR background lies on: the photo camera's height and the floor's reach.
    pub background_ground: Option<(f64, f64)>,
    /// Whether the sky names a background field of its own (`top`, `low`, `stars`, `moon`).
    pub painted: bool,
}

impl Sky {
    /// Whether the sky draws a background behind the scene (#1162): any but `auto`; `auto` with
    /// an environment or a background field of its own. A sky that only sets the ambient light
    /// leaves the look's ground behind the scene.
    pub fn draws_background(&self) -> bool {
        match self.background {
            Background::Auto => self.painted || self.environment.is_some(),
            _ => true,
        }
    }

    /// Whether the background shows the environment rather than the sky's own fields.
    pub fn shows_environment(&self) -> bool {
        match (&self.background, &self.environment) {
            (Background::Environment, Some(_)) => true,
            (Background::Auto, Some(e)) => matches!(e.from, Source::Asset(..)),
            _ => false,
        }
    }
}

fn srgb_decode(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// A color: linear RGB numbers, `#rrggbb` (sRGB), or a look role.
fn color(v: &Value, look: &Look3) -> Option<Vec3> {
    match v {
        Value::Array(a) if a.len() == 3 || a.len() == 4 => {
            let mut out = [0.0; 3];
            for (o, x) in out.iter_mut().zip(a) {
                *o = num(Some(x)).filter(|x| *x >= 0.0)?;
            }
            Some(out)
        }
        Value::String(s) => {
            let rgb = if let Some(h) = s.strip_prefix('#') {
                if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
                    return None;
                }
                let b = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
                [b(0)?, b(2)?, b(4)?]
            } else {
                *look.roles.get(s.as_str())?
            };
            Some(rgb.map(|c| srgb_decode(f64::from(c) / 255.0)))
        }
        _ => None,
    }
}

fn is_sha(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// The sky `id` with `params`, read through `assets` for its HDRs; `exposure` is the look's
/// scale, which the sky's own `exposure` (EV100) replaces when set, so the background shows its
/// colors under it.
pub fn parse(
    id: &str,
    params: &Value,
    look: &Look3,
    assets: Option<&dyn Fn(&str) -> Option<Vec<u8>>>,
) -> Result<Sky, Refused> {
    let path = format!("items/{id}/params");
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: format!("{path}/{k}"),
    };
    let col = |k: &str, default: Vec3| -> Result<Vec3, Refused> {
        match params.get(k) {
            None => Ok(default),
            Some(v) => color(v, look).ok_or_else(|| bad(k)),
        }
    };
    let f = |k: &str, default: f64| -> Result<f64, Refused> {
        match params.get(k) {
            None => Ok(default),
            Some(v) => num(Some(v)).ok_or_else(|| bad(k)),
        }
    };
    let scale = match params.get("exposure") {
        None => look.exposure,
        Some(v) => {
            let ev = num(Some(v)).ok_or_else(|| bad("exposure"))?;
            1.0 / (1.2 * 2f64.powf(ev))
        }
    }
    .max(1e-12);
    let shown = |c: Vec3| c.map(|v| v / scale);
    let top = shown(col("top", [0.0; 3])?);
    let low = shown(col("low", [0.0; 3])?);
    let ambient = [col("ambient_top", [0.0; 3])?, col("ambient_low", [0.0; 3])?];
    let fog = match params.get("fog") {
        None => Fog::Color([0.0; 3]),
        Some(Value::String(s)) if s == "background" => Fog::Background,
        Some(v) => Fog::Color(shown(color(v, look).ok_or_else(|| bad("fog"))?)),
    };
    let fog_density = f("fog_density", 0.0)?;
    if fog_density < 0.0 {
        return Err(bad("fog_density"));
    }
    let fog_curve = match params.get("fog_curve").and_then(Value::as_str) {
        None | Some("exp2") => Curve::Exp2,
        Some("exp") => Curve::Exp,
        Some(_) => return Err(bad("fog_curve")),
    };
    let fog_height = match params.get("fog_height") {
        None | Some(Value::Null) => None,
        Some(h) => {
            let top = num(h.get("top")).ok_or_else(|| bad("fog_height/top"))?;
            let density = match h.get("density") {
                None => 0.0,
                Some(v) => num(Some(v))
                    .filter(|d| *d >= 0.0)
                    .ok_or_else(|| bad("fog_height/density"))?,
            };
            (density > 0.0).then_some((top, density))
        }
    };
    let stars = f("stars", 0.0)?;
    if !(0.0..=1.0).contains(&stars) {
        return Err(bad("stars"));
    }
    let moon = match params.get("moon") {
        None | Some(Value::Null) => None,
        Some(m) => Some([
            num(m.get("azimuth")).ok_or_else(|| bad("moon/azimuth"))?,
            num(m.get("elevation")).ok_or_else(|| bad("moon/elevation"))?,
            num(m.get("radius")).ok_or_else(|| bad("moon/radius"))?,
        ]),
    };
    let sun = params
        .get("sun")
        .and_then(Value::as_str)
        .map(str::to_string);
    let source = |v: &Value, k: &str| -> Result<Source, Refused> {
        match v.as_str() {
            Some("sky") => Ok(Source::Sky),
            Some("studio") => Ok(Source::Studio),
            // Never a URL: an HDR comes by its hash from the document's assets.
            Some(s) if is_sha(s) => Ok(Source::Asset(
                s.to_string(),
                assets.and_then(|a| a(s)).map(std::sync::Arc::new),
            )),
            _ => Err(bad(k)),
        }
    };
    let environment = match params.get("environment") {
        None | Some(Value::Null) => None,
        Some(e) => {
            let from = source(e.get("from").unwrap_or(&Value::Null), "environment/from")?;
            let intensity = match e.get("intensity") {
                None => 1.0,
                Some(v) => num(Some(v))
                    .filter(|x| *x >= 0.0)
                    .ok_or_else(|| bad("environment/intensity"))?,
            };
            let rotation = match e.get("rotation") {
                None => 0.0,
                Some(v) => num(Some(v)).ok_or_else(|| bad("environment/rotation"))?,
            };
            let size = match e.get("size") {
                None => 256,
                Some(v) => v
                    .as_u64()
                    .filter(|s| (8..=2048).contains(s) && s.is_power_of_two())
                    .ok_or_else(|| bad("environment/size"))? as u32,
            };
            let mix = match e.get("mix") {
                None | Some(Value::Null) => None,
                Some(m) => {
                    let to = source(m.get("to").unwrap_or(&Value::Null), "environment/mix/to")?;
                    if !matches!(to, Source::Asset(..)) {
                        return Err(bad("environment/mix/to"));
                    }
                    let by = match m.get("by") {
                        None => 0.0,
                        Some(v) => num(Some(v))
                            .filter(|b| (0.0..=1.0).contains(b))
                            .ok_or_else(|| bad("environment/mix/by"))?,
                    };
                    Some((to, by))
                }
            };
            Some(Environment {
                from,
                intensity,
                rotation,
                size,
                mix,
            })
        }
    };
    let background = match params.get("background") {
        None => Background::Auto,
        Some(Value::String(s)) => match s.as_str() {
            "auto" => Background::Auto,
            "sky" => Background::Sky,
            "environment" => Background::Environment,
            _ => return Err(bad("background")),
        },
        Some(v) => match v.pointer("/video/asset").and_then(Value::as_str) {
            Some(sha) if is_sha(sha) => Background::Video(sha.to_string()),
            _ => return Err(bad("background")),
        },
    };
    let background_blur = f("background_blur", 0.0)?;
    if !(0.0..=1.0).contains(&background_blur) {
        return Err(bad("background_blur"));
    }
    let background_ground = match params.get("background_ground") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(g) => {
            let h = num(g.get("height")).ok_or_else(|| bad("background_ground/height"))?;
            let r = num(g.get("radius"))
                .filter(|r| *r > h)
                .ok_or_else(|| bad("background_ground/radius"))?;
            Some((h, r))
        }
    };
    let sky = Sky {
        id: id.to_string(),
        top,
        low,
        ambient,
        fog,
        fog_density,
        fog_curve,
        fog_height,
        stars,
        moon,
        sun,
        environment,
        background,
        background_blur,
        background_ground,
        painted: ["top", "low", "stars", "moon"]
            .iter()
            .any(|k| params.get(*k).is_some_and(|v| !v.is_null())),
    };
    // A video's frames can't be blurred or laid on a ground, and a ground needs a background
    // that shows the environment; each refused naming its field.
    if matches!(sky.background, Background::Video(_)) && sky.background_blur > 0.0 {
        return Err(bad("background_blur"));
    }
    if sky.background_ground.is_some() && !sky.shows_environment() {
        return Err(bad("background_ground"));
    }
    if matches!(sky.background, Background::Environment) && sky.environment.is_none() {
        return Err(bad("background"));
    }
    // A 360° video behind the scene takes its frames as `image@1`'s video frames do, which no
    // renderer decodes yet: refused naming the field, never drawn as an empty sky.
    if matches!(sky.background, Background::Video(_)) {
        return Err(Refused {
            code: "unsupported",
            path: format!("{path}/background"),
        });
    }
    Ok(sky)
}
