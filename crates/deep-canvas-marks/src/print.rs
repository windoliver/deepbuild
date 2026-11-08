//! Issue #464: print and pixel looks as the look declares them (canvas primitives: Look `look@1`:
//! separations, print finishes and indexed basis): each field read and checked, with its identity
//! defaults, and the values a frame draws from hash(the frame index at the finish's rate, the
//! document seed), never from playback. The finish pass that draws them runs on the GPU
//! (deep-scene3d-render's `print`); the index target's operator is deep-gpu-layer's `indexed`.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::scene::{Palette, Rgb};

/// Flicks per second, the document clock's unit.
pub const FLICKS: i64 = 705_600_000;

/// A refusal at check: its code and the path it names, plus fields a caller adds to the reply.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
    pub extra: Map<String, Value>,
}

fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
        extra: Map::new(),
    })
}

/// A number, or a literal `4%`, `1px` or `0.01fw`: its value and its unit.
fn literal(v: &Value) -> Option<(f64, &'static str)> {
    match v {
        Value::Number(n) => n.as_f64().map(|x| (x, "")),
        Value::String(s) => {
            let s = s.trim();
            for unit in ["%", "px", "fw"] {
                if let Some(n) = s.strip_suffix(unit) {
                    return n.trim().parse::<f64>().ok().map(|x| (x, unit));
                }
            }
            s.parse::<f64>().ok().map(|x| (x, ""))
        }
        _ => None,
    }
}

/// A share: `4%` is 0.04, a bare number is itself.
fn share(o: &Map<String, Value>, key: &str, default: f64, path: &str) -> Result<f64, Refused> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => match literal(v) {
            Some((x, "%")) => Ok(x / 100.0),
            Some((x, "")) => Ok(x),
            _ => refuse("out_of_range", format!("{path}/{key}")),
        },
    }
}

/// A length in px: `px` or bare, or `fw` (a frame width) at `width`.
fn length(
    o: &Map<String, Value>,
    key: &str,
    default: f64,
    width: f64,
    path: &str,
) -> Result<f64, Refused> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => match literal(v) {
            Some((x, "px" | "")) if x.is_finite() => Ok(x),
            Some((x, "fw")) if x.is_finite() => Ok(x * width),
            _ => refuse("out_of_range", format!("{path}/{key}")),
        },
    }
}

fn number(o: &Map<String, Value>, key: &str, default: f64, path: &str) -> Result<f64, Refused> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v.as_f64().filter(|x| x.is_finite()).ok_or_else(|| Refused {
            code: "out_of_range",
            path: format!("{path}/{key}"),
            extra: Map::new(),
        }),
    }
}

fn word<'a>(
    o: &'a Map<String, Value>,
    key: &str,
    words: &[&'a str],
    path: &str,
) -> Result<&'a str, Refused> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(words[0]),
        Some(Value::String(s)) if words.contains(&s.as_str()) => Ok(s.as_str()),
        _ => refuse("out_of_range", format!("{path}/{key}")),
    }
}

/// The roles a look's ink may name: its own roles, never a status color.
fn ink(roles: &Palette, role: &Value, path: &str) -> Result<(String, Rgb), Refused> {
    let Some(name) = role.as_str() else {
        return refuse("bad_input", path);
    };
    if crate::look::STATES.contains(&name) {
        return refuse("status_role", path);
    }
    match roles.get(name) {
        Some(c) => Ok((name.to_string(), *c)),
        None => refuse("ref_unresolved", path),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spot {
    Round,
    Line,
    Square,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    Frame,
    Sheet,
    Plate,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Offset {
    Fixed([f64; 2]),
    /// Registration jitter: up to `px` either way, drawn at `hz` from `seed`.
    Jitter {
        px: f64,
        hz: f64,
        seed: u32,
    },
}

/// One ink: `role`'s coverage screened by its halftone (`None`: solid), shifted by its
/// registration, laid at `order`, overprinting by multiply or knocking out.
#[derive(Clone, Debug, PartialEq)]
pub struct Separation {
    pub role: String,
    pub color: Rgb,
    /// `(angle in degrees, pitch in px, spot)`.
    pub halftone: Option<(f64, f64, Spot)>,
    pub offset: Offset,
    pub order: u8,
    pub multiply: bool,
    pub anchor: Anchor,
}

/// The most separations one finish pass prints.
pub const MAX_SEPARATIONS: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grain {
    /// The deviation of linear luminance as a share of it.
    pub amount: f64,
    /// A grain cell's side, px.
    pub size: f64,
    pub midtones: bool,
    /// Steps a second; 0 is one still pattern for the film.
    pub rate: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vignette {
    pub color: Rgb,
    pub hood: bool,
    pub inner: f64,
    pub outer: f64,
    /// The color's share at the frame's corners.
    pub amount: f64,
    /// `aspect: round`: the radius in px over the short half-axis, not per half-axis.
    pub round: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wear {
    /// ± share of linear luminance.
    pub flicker: f64,
    pub weave: f64,
    pub scratches: ([u32; 2], f64, u32),
    /// `(density in specks per 100 × 100 px, size px)`.
    pub dust: (f64, f64),
    pub hair: f64,
    /// `(corner radius px, softness px)`.
    pub gate: (f64, f64),
    pub rate: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToneCurve {
    pub black: [f64; 3],
    pub white: f64,
    pub contrast: f64,
    pub toe: f64,
    pub shoulder: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mask {
    None,
    Aperture,
    Shadow,
    Slot,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub kind: &'static str,
    pub scanlines: u32,
    pub mask: Mask,
    pub curvature: f64,
    pub convergence: f64,
    pub bleed: f64,
    pub noise: f64,
    pub rate: f64,
}

/// The look's print fields: its separations and the finishes this issue adds. A field it leaves
/// out, and every field of a finish named with none set, is at its identity default.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Print {
    pub separations: Vec<Separation>,
    pub grain: Option<Grain>,
    pub vignette: Option<Vignette>,
    pub wear: Option<Wear>,
    pub tone: Option<ToneCurve>,
    pub screen: Option<Screen>,
}

impl Print {
    /// Nothing to print: the finish pass would change no pixel, so it doesn't run.
    pub fn is_identity(&self) -> bool {
        self.separations.is_empty()
            && self.grain.is_none()
            && self.vignette.is_none()
            && self.wear.is_none()
            && self.tone.is_none()
            && self.screen.is_none()
    }

    /// The separations' roles, in their order.
    pub fn inks(&self) -> Vec<&str> {
        self.separations.iter().map(|s| s.role.as_str()).collect()
    }
}

/// The finish's entries this issue reads, each a one-key object naming it.
const FINISHES: [&str; 5] = ["grain", "vignette", "print_wear", "tone_curve", "screen"];

/// The look's separations and finish read against its resolved roles at a frame `width` px wide
/// (for `fw`). Each finish that comes out at its identity is left out.
pub fn read(look: &Value, roles: &Palette, width: f64) -> Result<Print, Refused> {
    let mut print = Print::default();
    if let Some(list) = look.get("separations").filter(|v| !v.is_null()) {
        let Some(list) = list.as_array() else {
            return refuse("bad_input", "look/separations");
        };
        if list.len() > MAX_SEPARATIONS {
            return refuse("out_of_range", "look/separations");
        }
        for (i, s) in list.iter().enumerate() {
            print
                .separations
                .push(separation(s, roles, &format!("look/separations/{i}"))?);
        }
        print.separations.sort_by_key(|s| s.order);
    }
    for (i, entry) in look
        .get("finish")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let Some((name, fields)) = entry.as_object().and_then(|o| o.iter().next()) else {
            continue;
        };
        if !FINISHES.contains(&name.as_str()) {
            continue;
        }
        let path = format!("look/finish/{i}/{name}");
        let empty = Map::new();
        let o = match fields {
            Value::Object(o) => o,
            Value::Null => &empty,
            _ => return refuse("bad_input", path),
        };
        if o.contains_key("lut") {
            return refuse("lut_image", path);
        }
        match name.as_str() {
            "grain" => print.grain = grain(o, width, &path)?,
            "vignette" => print.vignette = vignette(o, roles, &path)?,
            "print_wear" => print.wear = wear(o, &path)?,
            "tone_curve" => print.tone = tone_curve(o, roles, &path)?,
            _ => print.screen = screen(o, &path)?,
        }
    }
    Ok(print)
}

fn separation(v: &Value, roles: &Palette, path: &str) -> Result<Separation, Refused> {
    let Some(o) = v.as_object() else {
        return refuse("bad_input", path);
    };
    let (role, color) = ink(
        roles,
        o.get("role").unwrap_or(&Value::Null),
        &format!("{path}/role"),
    )?;
    let halftone = match o.get("halftone") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "solid" => None,
        Some(Value::Object(h)) => {
            let hp = format!("{path}/halftone");
            let pitch = length(h, "pitch", 8.0, 1.0, &hp)?;
            if pitch <= 0.0 {
                return refuse("out_of_range", format!("{hp}/pitch"));
            }
            let spot = match word(h, "spot", &["round", "line", "square"], &hp)? {
                "round" => Spot::Round,
                "line" => Spot::Line,
                _ => Spot::Square,
            };
            Some((number(h, "angle", 0.0, &hp)?, pitch, spot))
        }
        Some(_) => return refuse("bad_input", format!("{path}/halftone")),
    };
    let offset = match o.get("offset") {
        None | Some(Value::Null) => Offset::Fixed([0.0, 0.0]),
        Some(Value::Array(a)) if a.len() == 2 => {
            let at = |i: usize| a[i].as_f64().filter(|x| x.is_finite());
            match (at(0), at(1)) {
                (Some(x), Some(y)) => Offset::Fixed([x, y]),
                _ => return refuse("out_of_range", format!("{path}/offset")),
            }
        }
        Some(Value::Object(j)) => {
            let jp = format!("{path}/offset");
            Offset::Jitter {
                px: length(j, "jitter", 0.0, 1.0, &jp)?,
                hz: number(j, "hz", 0.0, &jp)?.max(0.0),
                seed: number(j, "seed", 0.0, &jp)? as u32,
            }
        }
        Some(_) => return refuse("bad_input", format!("{path}/offset")),
    };
    let order = o.get("order").and_then(Value::as_u64).unwrap_or(0).min(255) as u8;
    let multiply = word(o, "overprint", &["multiply", "knockout"], path)? == "multiply";
    let anchor = match word(o, "anchor", &["plate", "sheet", "frame"], path)? {
        "plate" => Anchor::Plate,
        "sheet" => Anchor::Sheet,
        _ => Anchor::Frame,
    };
    Ok(Separation {
        role,
        color,
        halftone,
        offset,
        order,
        multiply,
        anchor,
    })
}

fn grain(o: &Map<String, Value>, width: f64, path: &str) -> Result<Option<Grain>, Refused> {
    let g = Grain {
        amount: share(o, "amount", 0.0, path)?.abs(),
        size: length(o, "size", 1.0, width, path)?.max(1.0),
        midtones: word(o, "tone", &["midtones", "flat"], path)? == "midtones",
        rate: number(o, "rate", 24.0, path)?.max(0.0),
    };
    Ok((g.amount > 0.0).then_some(g))
}

fn vignette(
    o: &Map<String, Value>,
    roles: &Palette,
    path: &str,
) -> Result<Option<Vignette>, Refused> {
    let color = match o.get("color") {
        None | Some(Value::Null) => roles.get("ink").copied().unwrap_or([0, 0, 0]),
        Some(c) => ink(roles, c, &format!("{path}/color"))?.1,
    };
    let v = Vignette {
        color,
        hood: word(o, "shape", &["round", "hood"], path)? == "hood",
        inner: number(o, "inner", 0.5, path)?,
        outer: number(o, "outer", 1.0, path)?,
        amount: share(o, "amount", 0.0, path)?,
        round: word(o, "aspect", &["frame", "round"], path)? == "round",
    };
    if !(0.0..=1.0).contains(&v.amount) || v.outer <= v.inner {
        return refuse("out_of_range", path);
    }
    Ok((v.amount > 0.0).then_some(v))
}

fn wear(o: &Map<String, Value>, path: &str) -> Result<Option<Wear>, Refused> {
    let empty = Map::new();
    let sub = |key: &str| o.get(key).and_then(Value::as_object).unwrap_or(&empty);
    let scratches = sub("scratches");
    let count = scratches
        .get("count")
        .and_then(Value::as_array)
        .map(|a| [0, 1].map(|i| a.get(i).and_then(Value::as_u64).unwrap_or(0) as u32))
        .unwrap_or([0, 0]);
    let sp = format!("{path}/scratches");
    let dp = format!("{path}/dust");
    let gp = format!("{path}/gate");
    let w = Wear {
        flicker: share(o, "flicker", 0.0, path)?.abs(),
        weave: length(o, "weave", 0.0, 1.0, path)?.abs(),
        scratches: (
            [count[0], count[1].max(count[0])],
            length(scratches, "width", 1.0, 1.0, &sp)?.max(0.0),
            number(scratches, "life", 1.0, &sp)?.max(1.0) as u32,
        ),
        dust: (
            number(sub("dust"), "density", 0.0, &dp)?.max(0.0),
            length(sub("dust"), "size", 2.0, 1.0, &dp)?.max(0.0),
        ),
        hair: share(o, "hair", 0.0, path)?.clamp(0.0, 1.0),
        gate: (
            length(sub("gate"), "corner_radius", 0.0, 1.0, &gp)?.max(0.0),
            length(sub("gate"), "softness", 0.0, 1.0, &gp)?.max(0.0),
        ),
        rate: number(o, "rate", 24.0, path)?.max(0.0),
    };
    // Flicker is a gain on linear luminance held to the flicker check: at most ±10%.
    if w.flicker > 0.1 {
        return refuse("flicker_out_of_bounds", format!("{path}/flicker"));
    }
    let identity = w.flicker == 0.0
        && w.weave == 0.0
        && w.scratches.0[1] == 0
        && w.dust.0 == 0.0
        && w.hair == 0.0
        && w.gate == (0.0, 0.0);
    Ok((!identity).then_some(w))
}

fn tone_curve(
    o: &Map<String, Value>,
    roles: &Palette,
    path: &str,
) -> Result<Option<ToneCurve>, Refused> {
    let black = match o.get("black") {
        None | Some(Value::Null) => [0.0; 3],
        Some(Value::String(role)) if literal(&Value::String(role.clone())).is_none() => ink(
            roles,
            &Value::String(role.clone()),
            &format!("{path}/black"),
        )?
        .1
        .map(|c| f64::from(c) / 255.0),
        Some(_) => [share(o, "black", 0.0, path)?; 3],
    };
    let t = ToneCurve {
        black,
        white: share(o, "white", 1.0, path)?,
        contrast: number(o, "contrast", 1.0, path)?,
        toe: number(o, "toe", 0.0, path)?.clamp(0.0, 0.5),
        shoulder: number(o, "shoulder", 0.0, path)?.clamp(0.0, 0.5),
    };
    if t.contrast <= 0.0 || t.white <= 0.0 {
        return refuse("out_of_range", path);
    }
    let identity = t.black == [0.0; 3]
        && t.white == 1.0
        && t.contrast == 1.0
        && t.toe == 0.0
        && t.shoulder == 0.0;
    Ok((!identity).then_some(t))
}

fn screen(o: &Map<String, Value>, path: &str) -> Result<Option<Screen>, Refused> {
    const KINDS: [&str; 5] = ["crt", "kinescope", "fiche", "dv", "vhs"];
    let named = word(o, "kind", &KINDS, path)?;
    let kind = KINDS.iter().copied().find(|k| *k == named).unwrap_or("crt");
    let mask = match o.get("mask") {
        None | Some(Value::Null) => Mask::None,
        _ => match word(o, "mask", &["aperture", "shadow", "slot", "none"], path)? {
            "aperture" => Mask::Aperture,
            "shadow" => Mask::Shadow,
            "slot" => Mask::Slot,
            _ => Mask::None,
        },
    };
    let s = Screen {
        kind,
        scanlines: number(o, "scanlines", 0.0, path)?.max(0.0) as u32,
        mask,
        curvature: number(o, "curvature", 0.0, path)?.max(0.0),
        convergence: length(o, "convergence", 0.0, 1.0, path)?,
        bleed: number(o, "bleed", 0.0, path)?.clamp(0.0, 1.0),
        noise: share(o, "noise", 0.0, path)?.clamp(0.0, 1.0),
        rate: number(o, "rate", 30.0, path)?.max(0.0),
    };
    let identity = s.scanlines == 0
        && s.mask == Mask::None
        && s.curvature == 0.0
        && s.convergence == 0.0
        && s.bleed == 0.0
        && s.noise == 0.0;
    Ok((!identity).then_some(s))
}

/// The integer hash the finish pass draws from (a lowbias32 avalanche of three words), exact on
/// every machine; print.wgsl's `hash3` is the same function.
pub fn hash3(a: u32, b: u32, c: u32) -> u32 {
    let mut x = a ^ b.wrapping_mul(0x9e37_79b9) ^ c.wrapping_mul(0x85eb_ca6b);
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

/// `hash3` as a value in [0, 1).
pub fn unit(a: u32, b: u32, c: u32) -> f64 {
    f64::from(hash3(a, b, c)) / 4_294_967_296.0
}

/// The frame index at `rate` for document time `t` (flicks): ⌊t × rate⌋, 0 at rate 0 or when
/// held still under reduced motion.
pub fn step(t: i64, rate: f64, held: bool) -> u32 {
    if held || rate <= 0.0 || t <= 0 {
        return 0;
    }
    // In flicks, so a step boundary on a whole frame lands exactly.
    let whole = rate.fract() == 0.0;
    if whole {
        return ((t as i128 * rate as i128) / i128::from(FLICKS)) as u32;
    }
    (t as f64 * rate / FLICKS as f64 + 1e-9).floor() as u32
}

/// What a frame of the finish draws from, fixed for the frame: each value from its step and the
/// document seed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Frame {
    pub seed: u32,
    pub grain_step: u32,
    pub wear_step: u32,
    pub screen_step: u32,
    /// Print wear's gain on linear luminance.
    pub flicker: f64,
    /// Gate weave, px.
    pub weave: [f64; 2],
    /// Each separation's registration offset, px.
    pub offsets: [[f64; 2]; MAX_SEPARATIONS],
}

/// The frame at document time `t` (flicks), held still under reduced motion.
pub fn frame(print: &Print, seed: u32, t: i64, reduced_motion: bool) -> Frame {
    let mut f = Frame {
        seed,
        ..Frame::default()
    };
    if let Some(g) = print.grain {
        f.grain_step = step(t, g.rate, reduced_motion);
    }
    if let Some(s) = print.screen {
        f.screen_step = step(t, s.rate, reduced_motion);
    }
    if let Some(w) = print.wear {
        let n = step(t, w.rate, reduced_motion);
        f.wear_step = n;
        let signed = |k: u32| 2.0 * unit(n, seed, k) - 1.0;
        f.flicker = 1.0 + w.flicker * signed(0x11);
        f.weave = [w.weave * signed(0x22), w.weave * 0.5 * signed(0x33)];
    }
    for (i, s) in print.separations.iter().enumerate() {
        f.offsets[i] = match s.offset {
            Offset::Fixed(o) => o,
            Offset::Jitter { px, hz, seed: own } => {
                let n = step(t, hz, reduced_motion);
                [0x44, 0x55].map(|k| px * (2.0 * unit(n, own ^ seed, k + i as u32) - 1.0))
            }
        };
    }
    f
}

/// The indexed basis (Look `look@1`: indexed basis): marks write palette indices into a target
/// of `size`, shaded through tables built at check, upscaled by nearest at `scale`.
#[derive(Clone, Debug, PartialEq)]
pub struct Indexed {
    pub size: [u32; 2],
    pub scale: u32,
    /// Index i's role, and its color.
    pub palette: Vec<(String, Rgb)>,
    /// Each table by name, as a whole map from index to index.
    pub tables: BTreeMap<String, Vec<u16>>,
    pub protected: Vec<u16>,
    pub blend: bool,
    /// The light target's saturation, or `None` with no light target.
    pub light: Option<u8>,
}

impl Indexed {
    /// The table `name` as a map from index to index, the identity for `none`.
    pub fn table(&self, name: &str) -> Option<Vec<u16>> {
        match name {
            "none" => Some((0..self.palette.len() as u16).collect()),
            _ => self.tables.get(name).cloned(),
        }
    }

    pub fn index_of(&self, role: &str) -> Option<u16> {
        self.palette
            .iter()
            .position(|(r, _)| r == role)
            .map(|i| i as u16)
    }

    pub fn is_protected(&self, index: u16) -> bool {
        self.protected.contains(&index)
    }
}

/// A look's indexed basis, `basis: {indexed: {…}}`, read and checked against its roles; `None`
/// for any other basis. A table that would remap a protected index is refused, naming both.
pub fn indexed(look: &Value, roles: &Palette) -> Result<Option<Indexed>, Refused> {
    let Some(b) = look.get("basis").and_then(|b| b.get("indexed")) else {
        return Ok(None);
    };
    let path = "look/basis/indexed";
    let Some(o) = b.as_object() else {
        return refuse("bad_input", path);
    };
    let pair = |key: &str, default: [u32; 2]| -> Result<[u32; 2], Refused> {
        match o.get(key) {
            None => Ok(default),
            Some(Value::Array(a)) if a.len() == 2 => {
                let n = |i: usize| a[i].as_u64().filter(|v| (1..=4096).contains(v));
                match (n(0), n(1)) {
                    (Some(w), Some(h)) => Ok([w as u32, h as u32]),
                    _ => refuse("out_of_range", format!("{path}/{key}")),
                }
            }
            Some(_) => refuse("out_of_range", format!("{path}/{key}")),
        }
    };
    let size = pair("size", [320, 180])?;
    let scale = o.get("scale").and_then(Value::as_u64).unwrap_or(1);
    if !(1..=255).contains(&scale) {
        return refuse("out_of_range", format!("{path}/scale"));
    }
    let names = o
        .get("palette")
        .and_then(Value::as_array)
        .ok_or_else(|| Refused {
            code: "bad_input",
            path: format!("{path}/palette"),
            extra: Map::new(),
        })?;
    if names.is_empty() || names.len() > 256 {
        return refuse("out_of_range", format!("{path}/palette"));
    }
    let mut palette = Vec::with_capacity(names.len());
    for (i, n) in names.iter().enumerate() {
        palette.push(ink(roles, n, &format!("{path}/palette/{i}"))?);
    }
    let mut ix = Indexed {
        size,
        scale: scale as u32,
        palette,
        tables: BTreeMap::new(),
        protected: Vec::new(),
        blend: false,
        light: None,
    };
    for (i, r) in o
        .get("protected")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let at = format!("{path}/protected/{i}");
        let index = r.as_str().and_then(|r| ix.index_of(r));
        match index {
            Some(k) => ix.protected.push(k),
            None => return refuse("ref_unresolved", at),
        }
    }
    let identity: Vec<u16> = (0..ix.palette.len() as u16).collect();
    for (name, map) in o
        .get("tables")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let at = format!("{path}/tables/{name}");
        if name == "none" {
            return refuse("bad_input", at);
        }
        let Some(map) = map.as_object() else {
            return refuse("bad_input", at);
        };
        let mut table = identity.clone();
        for (from, to) in map {
            let (Some(a), Some(b)) = (ix.index_of(from), to.as_str().and_then(|t| ix.index_of(t)))
            else {
                return refuse("ref_unresolved", format!("{at}/{from}"));
            };
            if a != b && ix.is_protected(a) {
                let mut extra = Map::new();
                extra.insert("table".into(), Value::String(name.clone()));
                extra.insert("index".into(), Value::from(a));
                return Err(Refused {
                    code: "protected_remap",
                    path: format!("{at}/{from}"),
                    extra,
                });
            }
            table[a as usize] = b;
        }
        ix.tables.insert(name.clone(), table);
    }
    ix.blend = word(o, "see_through", &["dither", "blend"], path)? == "blend";
    ix.light = match o.get("light") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(Value::Object(l)) => Some(
            l.get("max")
                .map_or(Some(255), Value::as_u64)
                .filter(|m| *m <= 255)
                .ok_or_else(|| Refused {
                    code: "out_of_range",
                    path: format!("{path}/light/max"),
                    extra: Map::new(),
                })? as u8,
        ),
        Some(_) => return refuse("bad_input", format!("{path}/light")),
    };
    Ok(Some(ix))
}

/// The 4 × 4 ordered (Bayer) threshold the see-through dither reads at `[y mod 4][x mod 4]` of a
/// target pixel, and the dither fill's 8 × 8.
pub const BAYER4: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

pub fn bayer8(x: u32, y: u32) -> u8 {
    let (x, y) = (x % 8, y % 8);
    4 * BAYER4[(y % 4) as usize][(x % 4) as usize]
        + [[0, 2], [3, 1]][(y / 4) as usize][(x / 4) as usize]
}

/// The see-through blend of two resolved 8-bit colors at opacity `a` (0..255), in integers.
pub fn blend8(a: u32, src: Rgb, dst: Rgb) -> Rgb {
    [0, 1, 2].map(|c| ((a * u32::from(src[c]) + (255 - a) * u32::from(dst[c]) + 127) / 255) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn roles() -> Palette {
        [
            ("ink", [27, 29, 34]),
            ("cyan", [40, 170, 230]),
            ("guard", [95, 127, 59]),
            ("body", [44, 62, 123]),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
    }

    #[test]
    fn every_finish_named_with_no_field_is_the_identity() {
        let look = json!({"finish": [{"grain": {}}, {"vignette": {}}, {"print_wear": {}}, {"tone_curve": {}}, {"screen": {}}]});
        assert!(read(&look, &roles(), 800.0).unwrap().is_identity());
        let off = json!({"finish": [{"grain": {"amount": "4%"}}]});
        assert_eq!(
            read(&off, &roles(), 800.0).unwrap().grain.unwrap().amount,
            0.04
        );
    }

    #[test]
    fn a_status_role_is_never_an_ink() {
        let mut r = roles();
        r.insert("fail".into(), [191, 35, 43]);
        let look = json!({"separations": [{"role": "fail"}]});
        assert_eq!(read(&look, &r, 800.0).unwrap_err().code, "status_role");
    }

    #[test]
    fn steps_count_whole_frames_at_the_rate() {
        let at = |n: i64, fps: i64| n * FLICKS / fps;
        assert_eq!(
            (0..12)
                .map(|n| step(at(n, 96), 24.0, false))
                .collect::<Vec<_>>(),
            [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]
        );
        assert_eq!(step(at(37, 10), 24.0, true), 0);
        assert_eq!(step(at(37, 10), 0.0, false), 0);
    }

    #[test]
    fn a_table_remapping_a_protected_index_is_refused_naming_both() {
        let look = json!({"basis": {"indexed": {"palette": ["ink", "body", "guard"], "protected": ["guard"],
            "tables": {"bad": {"guard": "body"}}}}});
        let r = indexed(&look, &roles()).unwrap_err();
        assert_eq!(
            (r.code, r.extra["table"].clone(), r.extra["index"].clone()),
            ("protected_remap", json!("bad"), json!(2))
        );
    }

    #[test]
    fn flicker_stays_inside_its_bounds() {
        let look = json!({"finish": [{"print_wear": {"flicker": "5%"}}]});
        let p = read(&look, &roles(), 320.0).unwrap();
        for n in 0..200 {
            let f = frame(&p, 464, n * FLICKS / 24, false);
            assert!((0.95..=1.05).contains(&f.flicker));
        }
    }

    #[test]
    fn blend_is_the_rounded_integer_mix() {
        assert_eq!(blend8(128, [200, 180, 160], [44, 62, 123]), [122, 121, 142]);
    }
}
