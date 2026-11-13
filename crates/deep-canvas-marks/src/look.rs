//! Look `look@1` for a 2D writer layer: palette and roles per theme, the status map with one glyph
//! per state, the shipped clean pipeline look, and the status guard over a look (canvas
//! primitives: Look look@1; The status-color rule; Status guard).
//!
//! The guard refuses a look that gives two states one glyph (the attention glyph among them),
//! naming the pair; one whose data roles come within `min_distance` (OKLab) of a status color,
//! naming the role and the state; and one where a status color keeps less than 3:1 against the
//! ground (without an outline that does) or no label color keeps 4.5:1 on it, naming the theme and
//! the state. A theme may change palette and roles only, the legend is always automatic, and every
//! font must be a bundled face that may be embedded.
//!
//! The app's chrome draws from the look's roles too (#882): ground, raised and divider; the one ink
//! at its tiers, and hover and selected fills, each the ink at an alpha (`#rrggbbaa`); accent; and
//! the session readout and line. The guard holds each ink tier to its contrast floor on the ground,
//! the raised ground and hover over either, and every role, an alpha role blended over the ground and
//! the raised ground, to the status distance.
//!
//! Issue #1003: every fill a row is drawn on is a surface the guard checks: the ground, the raised
//! ground, and hover and selected over either. Each ink tier keeps its floor, each status color 3:1
//! and the keyboard focus ring, the `focus` role every look with chrome roles gives, 3:1 on all of
//! them. A look's 16 terminal colors (`term_black` .. `term_bright_white`, by ANSI index) keep 3:1
//! against the terminal's background, `term_background` or else the ground; a look that gives one
//! gives all sixteen.
//!
//! Issue #417: four looks ship (clean, notebook pencil, chalk and dark math), each one asset with
//! its lines, fills, ground, fonts and time feel. A role may name one of the look's fonts, so the
//! `math` role names a math face, or be derived from other roles (`mix`, `lighter`, `darker`,
//! `invert`), resolved here in OKLab before 8-bit encoding. The look's `fallback` list names the
//! fonts a grapheme the run's face lacks is set in. The status distance holds wherever status can
//! show: always for the app's look ([`resolve`]); for a document's look only where the document
//! binds status, which the marks check judges ([`resolve_in`], [`clash_of`]), so an art film played
//! on its own keeps any palette.

use std::collections::BTreeMap;

use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::scene::{Palette, Rgb, Type};

/// A color at an alpha: sRGB-encoded bytes, the alpha last.
pub type Rgba = [u8; 4];

/// The ink tiers and the contrast each keeps on every fill a row is drawn on (#882): in the app's
/// chrome, and in a film played on its own. Text has two inks and disabled (#1458); a look that
/// still gives `ink_tertiary` holds it to the text floor wherever it's shown in chrome.
const INK_TIERS: [(&str, f64, f64); 4] = [
    ("ink_primary", 4.5, 4.5),
    ("ink_secondary", 4.5, 4.5),
    ("ink_tertiary", 4.5, 3.0),
    ("ink_disabled", 0.0, 0.0),
];

/// The chrome's text roles (#1458), the weights one may take, and the smallest size anything draws at.
pub const TEXT_ROLES: [&str; 3] = ["title", "body", "small"];
const WEIGHTS: [&str; 3] = ["regular", "medium", "semibold"];
const SMALLEST: f64 = 10.0;
/// The platform's own face, which chrome's text may be set in.
pub const SYSTEM_FACE: &str = ".SystemUIFont";

/// The chrome roles whose look must give the focus ring (#1003), and the ring's floor.
const CHROME: [&str; 7] = [
    "raised",
    "hover",
    "selected",
    "ink_primary",
    "ink_secondary",
    "ink_tertiary",
    "ink_disabled",
];
const FOCUS_FLOOR: f64 = 3.0;

/// A look's terminal colors by ANSI index, and how far each keeps from the terminal background (#1003).
const TERMINAL: [&str; 16] = [
    "term_black",
    "term_red",
    "term_green",
    "term_yellow",
    "term_blue",
    "term_magenta",
    "term_cyan",
    "term_white",
    "term_bright_black",
    "term_bright_red",
    "term_bright_green",
    "term_bright_yellow",
    "term_bright_blue",
    "term_bright_magenta",
    "term_bright_cyan",
    "term_bright_white",
];
const TERMINAL_FLOOR: f64 = 3.0;

/// The states of the status map, in the legend's order (Status binding).
pub const STATES: [&str; 9] = [
    "pass",
    "fail",
    "invalid",
    "blocked",
    "inconclusive",
    "running",
    "needs_you",
    "stale",
    "idle",
];

/// The word each state shows beside its glyph.
pub fn word(state: &str) -> Option<&'static str> {
    Some(match state {
        "pass" => "Pass",
        "fail" => "Fail",
        "invalid" => "Invalid",
        "blocked" => "Blocked",
        "inconclusive" => "Inconclusive",
        "running" => "Running",
        "needs_you" => "Needs you",
        "stale" => "Stale",
        "idle" => "Idle",
        _ => return None,
    })
}

/// The status map: each state's color, the same in every theme, and its glyph, with the
/// treatment every status mark takes (Look: `status_treatment`).
#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    pub colors: BTreeMap<&'static str, Rgb>,
    pub glyphs: BTreeMap<&'static str, String>,
    /// The smallest side of a status mark's colored core, and a stroke's width, in px.
    pub core_min_px: f64,
    /// A ring of a role's color around every status mark, `(px, role)`, for a status color that
    /// can't keep 3:1 against the ground alone.
    pub outline: Option<(f64, String)>,
    /// The status distance: how near (OKLab ΔE) a data color may come to a status color.
    pub min_distance: f64,
}

impl Status {
    /// The map as the core's `core.status` array holds it, which the look module contributes.
    pub fn to_json(&self) -> Value {
        let colors: Map<String, Value> = self
            .colors
            .iter()
            .map(|(s, c)| (s.to_string(), json!(c)))
            .collect();
        let glyphs: Map<String, Value> = self
            .glyphs
            .iter()
            .map(|(s, g)| (s.to_string(), json!(g)))
            .collect();
        json!({"colors": colors, "glyphs": glyphs, "core_min_px": self.core_min_px,
               "outline": self.outline, "min_distance": self.min_distance})
    }

    /// The map back from `to_json`'s form; `None` unless every state has a color and a glyph.
    pub fn from_json(v: &Value) -> Option<Status> {
        let mut colors = BTreeMap::new();
        let mut glyphs = BTreeMap::new();
        for state in STATES {
            let c: Vec<u8> = v["colors"][state]
                .as_array()?
                .iter()
                .map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
                .collect::<Option<_>>()?;
            colors.insert(state, <[u8; 3]>::try_from(c.as_slice()).ok()?);
            glyphs.insert(state, v["glyphs"][state].as_str()?.to_string());
        }
        let outline = match &v["outline"] {
            Value::Array(o) => Some((o.first()?.as_f64()?, o.get(1)?.as_str()?.to_string())),
            _ => None,
        };
        Some(Status {
            colors,
            glyphs,
            core_min_px: v["core_min_px"].as_f64()?,
            outline,
            min_distance: v["min_distance"].as_f64()?,
        })
    }
}

/// A resolved look: each theme's roles, and the status map when the look has one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Look {
    pub light: Palette,
    pub dark: Palette,
    /// Each theme's roles at an alpha: the one ink's color with the alpha it's drawn at.
    pub light_alpha: BTreeMap<String, Rgba>,
    pub dark_alpha: BTreeMap<String, Rgba>,
    pub status: Option<Status>,
    /// #417: each theme's opaque roles in OKLab as resolved, before 8-bit encoding.
    pub light_oklab: BTreeMap<String, [f64; 3]>,
    pub dark_oklab: BTreeMap<String, [f64; 3]>,
    /// #417: each theme's font roles, by the name of the look's font each names.
    pub light_fonts: BTreeMap<String, String>,
    pub dark_fonts: BTreeMap<String, String>,
    /// #417: each theme's type: the family each font name and font role sets text in, and the
    /// fallback families.
    pub light_type: Type,
    pub dark_type: Type,
    /// How far apart (OKLab ΔE) two data roles a chart tells apart by color alone stay, as seen
    /// and under each simulated color-vision deficiency (Look: `data_distance`).
    pub data_distance: f64,
    /// #1458: the chrome's sizes, when the look gives them.
    pub sizes: Option<Sizes>,
}

/// The chrome's sizes, roles of the look as its colors are (#1458): `type`'s three text roles, the
/// `space` scale, the one corner `radius`, the `shell`'s named sizes, the widths of its lines
/// (`stroke`) and the chrome's faces (`chrome_fonts`, #1035's field), all in points.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sizes {
    /// `title`, `body` and `small`.
    pub text: BTreeMap<String, TextRole>,
    /// Steps of 4, smallest first.
    pub space: Vec<f64>,
    pub radius: f64,
    pub shell: BTreeMap<String, f64>,
    pub stroke: BTreeMap<String, f64>,
    /// `text`, the platform's face (`.SystemUIFont`) or a family of the look's fonts, and `code`, a
    /// family of the look's fonts.
    pub face: BTreeMap<String, String>,
}

/// One text role: its size and line height in points, and its weight.
#[derive(Clone, Debug, PartialEq)]
pub struct TextRole {
    pub size: f64,
    pub line: f64,
    pub weight: &'static str,
}

/// Where a look's status distance holds (The status-color rule): everywhere, for the app's look,
/// or, for a document's look, only where the document binds status, which the check judges.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Distance {
    Everywhere,
    WhereStatusShows,
}

/// The look's data distance when its definition names none (Look: `data_distance = 0.06*`).
pub const DATA_DISTANCE: f64 = 0.06;

/// Why a look is refused.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// The status guard: two states share a glyph.
    GlyphShared([&'static str; 2]),
    /// A data role within the look's `min_distance` of a status color, in a theme, at `distance`.
    Distance {
        theme: &'static str,
        role: String,
        state: &'static str,
        distance: f64,
    },
    /// A role at an alpha that isn't the one ink's color.
    NotInk { theme: &'static str, role: String },
    /// An ink tier under its contrast floor on a surface (`ground`, `raised`, `hover over ...`,
    /// `selected over ...`).
    InkContrast {
        theme: &'static str,
        role: String,
        on: &'static str,
        ratio: f64,
    },
    /// The focus ring under 3:1 on a surface (#1003).
    FocusContrast {
        theme: &'static str,
        on: &'static str,
        ratio: f64,
    },
    /// A terminal color under 3:1 against the terminal's background (#1003).
    TerminalContrast {
        theme: &'static str,
        role: &'static str,
        ratio: f64,
    },
    /// A status color under 3:1 against a surface (`against` names it), or with no label color at
    /// 4.5:1 on it (`label`).
    Contrast {
        theme: &'static str,
        state: &'static str,
        against: &'static str,
    },
    /// A font that can't ship: not a bundled face, not embeddable, or with no license.
    Font(String),
    /// A field that isn't a look@1 field's value, at its path.
    Bad(String),
}

impl Refusal {
    pub fn to_json(&self) -> Value {
        match self {
            Refusal::GlyphShared(pair) => {
                json!({"ok": false, "code": "status_glyph_shared", "pair": pair})
            }
            Refusal::Distance {
                theme,
                role,
                state,
                distance,
            } => json!({
                "ok": false, "code": "status_distance", "theme": theme, "role": role, "state": state,
                "distance": distance,
            }),
            Refusal::NotInk { theme, role } => {
                json!({"ok": false, "code": "chrome_not_ink", "theme": theme, "role": role})
            }
            Refusal::InkContrast {
                theme,
                role,
                on,
                ratio,
            } => json!({
                "ok": false, "code": "ink_contrast", "theme": theme, "role": role, "on": on, "ratio": ratio,
            }),
            Refusal::FocusContrast { theme, on, ratio } => json!({
                "ok": false, "code": "focus_contrast", "theme": theme, "role": "focus", "on": on, "ratio": ratio,
            }),
            Refusal::TerminalContrast { theme, role, ratio } => json!({
                "ok": false, "code": "terminal_contrast", "theme": theme, "role": role, "ratio": ratio,
            }),
            Refusal::Contrast {
                theme,
                state,
                against,
            } => json!({
                "ok": false, "code": "status_contrast", "theme": theme, "state": state, "against": against,
            }),
            Refusal::Font(font) => json!({"ok": false, "code": "font_unshippable", "font": font}),
            Refusal::Bad(path) => json!({"ok": false, "code": "bad_look", "path": path}),
        }
    }
}

/// The shipped looks' IDs, in the order they're listed (#417).
pub const SHIPPED: [&str; 4] = ["clean", "notebook_pencil", "chalk", "dark_math"];

/// The definition of a shipped look by its ID.
pub fn shipped(id: &str) -> Option<Value> {
    let text = match id {
        "clean" => include_str!("../looks/clean.json"),
        "notebook_pencil" => include_str!("../looks/notebook_pencil.json"),
        "chalk" => include_str!("../looks/chalk.json"),
        "dark_math" => include_str!("../looks/dark_math.json"),
        _ => return None,
    };
    serde_json::from_str(text).ok()
}

/// `#rrggbb` as sRGB-encoded bytes.
fn hex(value: Option<&Value>) -> Option<Rgb> {
    hex_alpha(value)
        .filter(|c| c[3] == 255)
        .map(|c| [c[0], c[1], c[2]])
}

/// `#rrggbb` (opaque) or `#rrggbbaa` as sRGB-encoded bytes with the alpha.
fn hex_alpha(value: Option<&Value>) -> Option<Rgba> {
    let text = value?.as_str()?.strip_prefix('#')?;
    if !matches!(text.len(), 6 | 8) || !text.is_ascii() {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&text[i..i + 2], 16).ok();
    let alpha = if text.len() == 8 { byte(6)? } else { 255 };
    Some([byte(0)?, byte(2)?, byte(4)?, alpha])
}

/// `color` over an opaque `base`, blended in sRGB-encoded values as GPUI's renderer blends.
fn over(color: Rgba, base: Rgb) -> Rgb {
    let a = f64::from(color[3]) / 255.0;
    let mix = |c: u8, b: u8| (f64::from(c) * a + f64::from(b) * (1.0 - a)).round() as u8;
    [
        mix(color[0], base[0]),
        mix(color[1], base[1]),
        mix(color[2], base[2]),
    ]
}

fn object<'a>(
    value: Option<&'a Value>,
    path: &str,
) -> Result<Option<&'a Map<String, Value>>, Refusal> {
    match value {
        None => Ok(None),
        Some(Value::Object(m)) => Ok(Some(m)),
        Some(_) => Err(Refusal::Bad(path.into())),
    }
}

/// One theme's resolved roles: the opaque ones, those at an alpha, every opaque one in OKLab, and
/// the font roles by the name of the font each names.
type ThemeRoles = (
    Palette,
    BTreeMap<String, Rgba>,
    BTreeMap<String, [f64; 3]>,
    BTreeMap<String, String>,
);

/// One theme's roles, the look's palette and roles with the theme's own over them. A role names a
/// palette color, one of the look's fonts, or (#417) derives its color from other roles in OKLab.
fn theme(def: &Map<String, Value>, name: &'static str) -> Result<ThemeRoles, Refusal> {
    let over = object(
        def.get("themes").and_then(|t| t.get(name)),
        &format!("themes/{name}"),
    )?;
    if let Some(key) = over
        .into_iter()
        .flat_map(|o| o.keys())
        .find(|k| *k != "palette" && *k != "roles")
    {
        // A theme changes palette and roles only.
        return Err(Refusal::Bad(format!("themes/{name}/{key}")));
    }
    // The look's own map with the theme's entries over it.
    let merged = |field: &str| -> Result<BTreeMap<String, Value>, Refusal> {
        let mut out = BTreeMap::new();
        for (map, at) in [
            (def.get(field), field.to_string()),
            (
                over.and_then(|o| o.get(field)),
                format!("themes/{name}/{field}"),
            ),
        ] {
            if let Some(map) = object(map, &at)? {
                out.extend(map.iter().map(|(k, v)| (k.clone(), v.clone())));
            }
        }
        Ok(out)
    };
    let (palette, roles) = (merged("palette")?, merged("roles")?);
    let fonts = object(def.get("fonts"), "fonts")?;
    let (mut opaque, mut alpha) = (Palette::new(), BTreeMap::new());
    let (mut oklab, mut font_roles) = (BTreeMap::new(), BTreeMap::new());
    let mut derived = Vec::new();
    for (role, entry) in &roles {
        match entry {
            Value::String(n) if palette.contains_key(n) => {
                let color = hex_alpha(palette.get(n))
                    .ok_or_else(|| Refusal::Bad(format!("palette/{n}")))?;
                if color[3] == 255 {
                    let rgb = [color[0], color[1], color[2]];
                    opaque.insert(role.clone(), rgb);
                    let l = lab(rgb);
                    oklab.insert(role.clone(), [l.l, l.a, l.b]);
                } else {
                    alpha.insert(role.clone(), color);
                }
            }
            Value::String(n) if fonts.is_some_and(|f| f.contains_key(n)) => {
                font_roles.insert(role.clone(), n.clone());
            }
            Value::Object(_) => derived.push((role, entry)),
            _ => return Err(Refusal::Bad(format!("roles/{role}"))),
        }
    }
    // Derived roles read resolved ones, so each pass resolves those whose roles are; a pass that
    // resolves none leaves a role naming one that never resolves (or a cycle), refused.
    while !derived.is_empty() {
        let before = derived.len();
        let mut left = Vec::new();
        for (role, entry) in derived {
            match derive(entry, &oklab, role)? {
                Some(l) => {
                    opaque.insert(role.clone(), encode(l));
                    oklab.insert(role.clone(), l);
                }
                None => left.push((role, entry)),
            }
        }
        if left.len() == before {
            return Err(Refusal::Bad(format!("roles/{}", left[0].0)));
        }
        derived = left;
    }
    Ok((opaque, alpha, oklab, font_roles))
}

/// A derived role's color in OKLab (#417): `{mix: [a, b, t]}` the point `t` of the way from `a` to
/// `b`; `{lighter: r, by}` lightness raised by `by` of the way to 1 and `{darker: r, by}` lowered by
/// `by` of the way to 0, hue and chroma kept; `{invert: r}` the point opposite through mid grey.
/// `None` while a role it reads isn't resolved yet.
fn derive(
    entry: &Value,
    oklab: &BTreeMap<String, [f64; 3]>,
    role: &str,
) -> Result<Option<[f64; 3]>, Refusal> {
    let bad = || Refusal::Bad(format!("roles/{role}"));
    let Value::Object(op) = entry else {
        return Err(bad());
    };
    fn named(v: Option<&Value>) -> Option<&str> {
        v.and_then(Value::as_str)
    }
    let by = |v: Option<&Value>| {
        v.and_then(Value::as_f64)
            .filter(|f| (0.0..=1.0).contains(f))
            .ok_or_else(bad)
    };
    let (keys, read): (&[&str], Vec<&str>) = if let Some(mix) = op.get("mix") {
        let parts = mix.as_array().filter(|p| p.len() == 3).ok_or_else(bad)?;
        by(parts.get(2))?;
        let (a, b) = (named(parts.first()), named(parts.get(1)));
        (&["mix"], vec![a.ok_or_else(bad)?, b.ok_or_else(bad)?])
    } else if op.contains_key("lighter") {
        (
            &["lighter", "by"],
            vec![named(op.get("lighter")).ok_or_else(bad)?],
        )
    } else if op.contains_key("darker") {
        (
            &["darker", "by"],
            vec![named(op.get("darker")).ok_or_else(bad)?],
        )
    } else if op.contains_key("invert") {
        (&["invert"], vec![named(op.get("invert")).ok_or_else(bad)?])
    } else {
        return Err(bad());
    };
    if op.keys().any(|k| !keys.contains(&k.as_str())) {
        return Err(bad());
    }
    let Some(colors) = read
        .iter()
        .map(|r| oklab.get(*r).copied())
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(None);
    };
    let [l, a, b] = colors[0];
    Ok(Some(if let Some(mix) = op.get("mix") {
        let t = mix[2].as_f64().unwrap_or(0.0);
        let q = colors[1];
        [l + (q[0] - l) * t, a + (q[1] - a) * t, b + (q[2] - b) * t]
    } else if op.contains_key("lighter") {
        [l + by(op.get("by"))? * (1.0 - l), a, b]
    } else if op.contains_key("darker") {
        [l * (1.0 - by(op.get("by"))?), a, b]
    } else {
        [1.0 - l, -a, -b]
    }))
}

/// An OKLab color as sRGB-encoded bytes, each channel clamped to the gamut and rounded.
fn encode([l, a, b]: [f64; 3]) -> Rgb {
    let c = oklab_to_srgb(Oklab { l, a, b });
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    [byte(c.r), byte(c.g), byte(c.b)]
}

/// An sRGB-encoded color in OKLab.
fn lab(c: Rgb) -> Oklab {
    srgb_to_oklab(Srgb {
        r: f64::from(c[0]) / 255.0,
        g: f64::from(c[1]) / 255.0,
        b: f64::from(c[2]) / 255.0,
    })
}

/// OKLab ΔE between two colors already in OKLab.
fn delta(p: Oklab, q: Oklab) -> f64 {
    ops::sqrt((p.l - q.l) * (p.l - q.l) + (p.a - q.a) * (p.a - q.a) + (p.b - q.b) * (p.b - q.b))
}

/// OKLab ΔE between two sRGB-encoded colors.
pub fn distance(a: Rgb, b: Rgb) -> f64 {
    delta(lab(a), lab(b))
}

/// Machado, Oliveira and Fernandes 2009's simulation matrices at full severity, applied in linear
/// sRGB: protanopia, deuteranopia and tritanopia.
const MACHADO_100: [(&str, [[f64; 3]; 3]); 3] = [
    (
        "protanopia",
        [
            [0.152286, 1.052583, -0.204868],
            [0.114503, 0.786281, 0.099216],
            [-0.003882, -0.048116, 1.051998],
        ],
    ),
    (
        "deuteranopia",
        [
            [0.367322, 0.860646, -0.227968],
            [0.280085, 0.672501, 0.047413],
            [-0.011820, 0.042940, 0.968881],
        ],
    ),
    (
        "tritanopia",
        [
            [1.255528, -0.076749, -0.178779],
            [-0.078411, 0.930809, 0.147602],
            [0.004733, 0.691367, 0.303900],
        ],
    ),
];

/// The nearest two colors come as seen or under a simulated deficiency: the vision and its
/// OKLab ΔE.
pub fn nearest_vision(a: Rgb, b: Rgb) -> (&'static str, f64) {
    let lin = |c: Rgb| c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0));
    let oklab = |[r, g, b]: [f64; 3]| {
        deep_canvas::color::linear_to_oklab(deep_canvas::color::LinearRgb { r, g, b })
    };
    let (la, lb) = (lin(a), lin(b));
    let mut nearest = ("seen", delta(oklab(la), oklab(lb)));
    for (vision, m) in MACHADO_100 {
        let sim = |c: [f64; 3]| m.map(|row| row[0] * c[0] + row[1] * c[1] + row[2] * c[2]);
        let d = delta(oklab(sim(la)), oklab(sim(lb)));
        if d < nearest.1 {
            nearest = (vision, d);
        }
    }
    nearest
}

/// WCAG 2.x relative luminance of an sRGB-encoded color.
fn luminance(c: Rgb) -> f64 {
    let lin = |v: u8| deep_canvas::color::srgb_decode(f64::from(v) / 255.0);
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

/// WCAG 2.x contrast ratio of two relative luminances.
fn ratio(x: f64, y: f64) -> f64 {
    (x.max(y) + 0.05) / (x.min(y) + 0.05)
}

/// WCAG 2.x contrast ratio of two colors.
pub fn contrast(a: Rgb, b: Rgb) -> f64 {
    ratio(luminance(a), luminance(b))
}

/// Every font entry names a bundled face file (`bundled`), may be embedded and carries a license;
/// each by its name with the family its face registers (#417).
fn fonts(
    def: &Map<String, Value>,
    bundled: &[&str],
) -> Result<BTreeMap<String, &'static str>, Refusal> {
    let mut out = BTreeMap::new();
    for (name, font) in object(def.get("fonts"), "fonts")?.into_iter().flatten() {
        let shippable = font.get("embed") == Some(&Value::Bool(true))
            && font
                .get("license")
                .and_then(Value::as_str)
                .is_some_and(|l| !l.is_empty())
            && font
                .get("file")
                .and_then(Value::as_str)
                .is_some_and(|f| bundled.contains(&f));
        let face = font
            .get("file")
            .and_then(Value::as_str)
            .and_then(|f| deep_text::FACES.iter().find(|face| face.file == f));
        match face {
            Some(face) if shippable => out.insert(name.clone(), face.family),
            _ => return Err(Refusal::Font(name.clone())),
        };
    }
    Ok(out)
}

/// The chrome's sizes (#1458), `None` for a look that gives none of them. Each text role has a size
/// of at least 10 pt, a line at least its size and one of three weights; `space` is steps of 4,
/// smallest first; the radius, every shell size and every stroke are numbers; the chrome's code face is
/// a family of the look's fonts and its text face the platform's or one of them. A look gives `type`'s three sizes and
/// `space` as the clean look does, or not at all, so a look pack (#1035) can't change a page's layout.
fn sizes(
    def: &Map<String, Value>,
    fonts: &BTreeMap<String, &'static str>,
) -> Result<Option<Sizes>, Refusal> {
    const KEYS: [&str; 6] = ["type", "space", "radius", "shell", "stroke", "chrome_fonts"];
    if !KEYS.iter().any(|k| def.contains_key(*k)) {
        return Ok(None);
    }
    let clean = shipped("clean").unwrap_or_default();
    for key in ["type", "space"] {
        if def.get(key).is_some_and(|v| Some(v) != clean.get(key)) {
            return Err(Refusal::Bad(key.into()));
        }
    }
    let bad = |path: String| Refusal::Bad(path);
    let number = |v: Option<&Value>, path: String| {
        v.and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n >= 0.0)
            .ok_or_else(|| bad(path))
    };
    let mut out = Sizes::default();
    let ty = object(def.get("type").or_else(|| clean.get("type")), "type")?;
    let ty = ty.ok_or_else(|| bad("type".into()))?;
    if ty.len() != TEXT_ROLES.len() {
        return Err(bad("type".into()));
    }
    for role in TEXT_ROLES {
        let path = format!("type/{role}");
        let r = ty.get(role).ok_or_else(|| bad(path.clone()))?;
        let size = number(r.get("size"), format!("{path}/size"))?;
        let line = number(r.get("line"), format!("{path}/line"))?;
        let weight = r.get("weight").and_then(Value::as_str);
        let weight = WEIGHTS
            .into_iter()
            .find(|w| Some(*w) == weight)
            .ok_or_else(|| bad(format!("{path}/weight")))?;
        if size < SMALLEST {
            return Err(bad(format!("{path}/size")));
        }
        if line < size {
            return Err(bad(format!("{path}/line")));
        }
        out.text
            .insert(role.into(), TextRole { size, line, weight });
    }
    let space = def.get("space").or_else(|| clean.get("space"));
    let space = space
        .and_then(Value::as_array)
        .ok_or_else(|| bad("space".into()))?;
    for (i, step) in space.iter().enumerate() {
        let step = number(Some(step), format!("space/{i}"))?;
        if step == 0.0 || step % 4.0 != 0.0 || out.space.last().is_some_and(|l| *l >= step) {
            return Err(bad(format!("space/{i}")));
        }
        out.space.push(step);
    }
    out.radius = number(
        def.get("radius").or_else(|| clean.get("radius")),
        "radius".into(),
    )?;
    for (key, into) in [("shell", &mut out.shell), ("stroke", &mut out.stroke)] {
        for (name, size) in object(def.get(key), key)?.into_iter().flatten() {
            into.insert(name.clone(), number(Some(size), format!("{key}/{name}"))?);
        }
    }
    for (name, face) in object(def.get("chrome_fonts"), "chrome_fonts")?
        .into_iter()
        .flatten()
    {
        let face = face.as_str().unwrap_or("");
        let bundled = fonts.values().any(|family| *family == face);
        if !(bundled || name == "text" && face == SYSTEM_FACE) {
            return Err(bad(format!("chrome_fonts/{name}")));
        }
        out.face.insert(name.clone(), face.into());
    }
    Ok(Some(out))
}

/// A theme's type (#417): each font by its name, each font role by the font it names, and the
/// fallback list's fonts in order, each one of the look's fonts.
fn type_of(
    def: &Map<String, Value>,
    fonts: &BTreeMap<String, &'static str>,
    font_roles: &BTreeMap<String, String>,
) -> Result<Type, Refusal> {
    let mut ty = Type {
        fonts: fonts.clone(),
        ..Type::default()
    };
    for (role, font) in font_roles {
        ty.fonts.insert(role.clone(), fonts[font]);
    }
    if let Some(list) = def.get("fallback") {
        let list = list
            .as_array()
            .ok_or_else(|| Refusal::Bad("fallback".into()))?;
        for (i, name) in list.iter().enumerate() {
            let family = name
                .as_str()
                .and_then(|n| fonts.get(n))
                .ok_or_else(|| Refusal::Bad(format!("fallback/{i}")))?;
            ty.fallback.push(family);
        }
    }
    Ok(ty)
}

/// The marks a look's `diff` gives a role (#1965).
const DIFF_MARKS: [&str; 3] = ["added", "removed", "changed"];

/// A look's `code` or `diff` map (#1965; Look `look@1`: `code: {class → role}`, `diff: {added,
/// removed, changed → role}`): none, or a role for each of `names` and nothing else, each a color
/// both themes give, so the guard holds it to the status distance as it holds every role.
fn role_map(
    def: &Map<String, Value>,
    field: &str,
    names: &[&str],
    themes: [&Palette; 2],
) -> Result<BTreeMap<String, String>, Refusal> {
    let Some(map) = object(def.get(field), field)? else {
        return Ok(BTreeMap::new());
    };
    if let Some(key) = map.keys().find(|k| !names.contains(&k.as_str())) {
        return Err(Refusal::Bad(format!("{field}/{key}")));
    }
    names
        .iter()
        .map(|name| {
            map.get(*name)
                .and_then(Value::as_str)
                .filter(|role| themes.iter().all(|p| p.contains_key(*role)))
                .map(|role| (name.to_string(), role.to_string()))
                .ok_or_else(|| Refusal::Bad(format!("{field}/{name}")))
        })
        .collect()
}

/// The nearest status color within `min_distance` of `color` (in OKLab), with its distance: the
/// status color a data color clashes with (The status-color rule).
pub fn clash(color: Rgb, status: &Status) -> Option<(&'static str, f64)> {
    let at = lab(color);
    status
        .colors
        .iter()
        .map(|(s, c)| (*s, delta(at, lab(*c))))
        .filter(|(_, d)| *d < status.min_distance)
        .min_by(|a, b| a.1.total_cmp(&b.1))
}

/// A look@1 definition's status map (`status`, `status_treatment`, `min_distance`), held to the
/// guard's own rules: one glyph per state, each different and none the attention glyph; every
/// state a color and a glyph; a finite non-negative distance (0.10 when unset). It reads nothing
/// of the palette, so a host's status map and a document's roles can be checked apart.
pub fn status_map(def: &Map<String, Value>) -> Result<Status, Refusal> {
    let glyph_map = object(
        def.get("status_treatment").and_then(|t| t.get("glyph")),
        "status_treatment/glyph",
    )?;
    let status_map = object(def.get("status"), "status")?;
    let glyph = |s: &str| glyph_map.and_then(|g| g.get(s)).and_then(Value::as_str);
    // One glyph per state, each different, checked before anything else so the pair is named;
    // the attention treatment's glyph is one more that no state may share.
    let attention = object(def.get("attention_treatment"), "attention_treatment")?;
    let attention_glyph = attention
        .and_then(|a| a.get("glyph"))
        .and_then(Value::as_str);
    for (i, a) in STATES.iter().enumerate() {
        for b in &STATES[i + 1..] {
            if glyph(a).is_some_and(|g| Some(g) == glyph(b)) {
                return Err(Refusal::GlyphShared([a, b]));
            }
        }
        if glyph(a).is_some_and(|g| Some(g) == attention_glyph) {
            return Err(Refusal::GlyphShared([a, "attention"]));
        }
    }
    let treatment = def.get("status_treatment");
    let core_min_px = match treatment.and_then(|t| t.get("core_min_px")) {
        None => 4.0,
        Some(v) => v
            .as_f64()
            .filter(|px| px.is_finite() && *px >= 1.0)
            .ok_or_else(|| Refusal::Bad("status_treatment/core_min_px".into()))?,
    };
    let outline = match treatment.and_then(|t| t.get("outline")) {
        None => None,
        Some(o) => Some((
            o.get("px")
                .and_then(Value::as_f64)
                .filter(|px| px.is_finite() && *px >= 1.0)
                .ok_or_else(|| Refusal::Bad("status_treatment/outline/px".into()))?,
            o.get("role")
                .and_then(Value::as_str)
                .ok_or_else(|| Refusal::Bad("status_treatment/outline/role".into()))?
                .to_string(),
        )),
    };
    let min = match def.get("min_distance") {
        None => 0.10,
        Some(v) => v
            .as_f64()
            .filter(|d| d.is_finite() && *d >= 0.0)
            .ok_or_else(|| Refusal::Bad("min_distance".into()))?,
    };
    let mut status = Status {
        colors: BTreeMap::new(),
        glyphs: BTreeMap::new(),
        core_min_px,
        outline,
        min_distance: min,
    };
    for state in STATES {
        let color = hex(status_map.and_then(|m| m.get(state)))
            .ok_or_else(|| Refusal::Bad(format!("status/{state}")))?;
        let g = glyph(state)
            .filter(|g| !g.is_empty())
            .ok_or_else(|| Refusal::Bad(format!("status_treatment/glyph/{state}")))?;
        status.colors.insert(state, color);
        status.glyphs.insert(state, g.to_string());
    }
    Ok(status)
}

/// Resolves a look@1 definition and holds it to the status guard, the status distance included,
/// as the app's look, where status always shows; `bundled` lists the font files the build ships.
pub fn resolve(def: &Value, bundled: &[&str]) -> Result<Look, Refusal> {
    resolve_in(def, bundled, Distance::Everywhere)
}

/// [`resolve`], with the status distance held `where` the look is shown (#417).
pub fn resolve_in(def: &Value, bundled: &[&str], at: Distance) -> Result<Look, Refusal> {
    let Value::Object(def) = def else {
        return Err(Refusal::Bad(String::new()));
    };
    if def.get("legend").is_some_and(|l| l != "auto") {
        return Err(Refusal::Bad("legend".into()));
    }
    // #149: a look's drawn fields, at any frame: the frame only gives their `fw` and `fh` a size.
    let mut drawn = Value::Object(def.clone());
    deep_canvas::grammar::lower_frame_literals(&mut drawn, (1920, 1080));
    if let Value::Object(drawn) = &drawn {
        deep_canvas_drawn::spec::check(drawn).map_err(|r| Refusal::Bad(r.path))?;
    }
    let status = status_map(def)?;
    let fonts = fonts(def, bundled)?;
    let attention = object(def.get("attention_treatment"), "attention_treatment")?;
    let attention_glyph = attention
        .and_then(|a| a.get("glyph"))
        .and_then(Value::as_str);
    let (light, light_alpha, light_oklab, light_fonts) = theme(def, "light")?;
    let (dark, dark_alpha, dark_oklab, dark_fonts) = theme(def, "dark")?;
    for (name, palette, alpha) in [
        ("light", &light, &light_alpha),
        ("dark", &dark, &dark_alpha),
    ] {
        let named = |role: &str, path: &str| {
            palette
                .get(role)
                .copied()
                .ok_or_else(|| Refusal::Bad(format!("{path} ({name})")))
        };
        let (ground, ink) = (named("ground", "roles/ground")?, named("ink", "roles/ink")?);
        let ring = match &status.outline {
            Some((_, role)) => Some(named(role, "status_treatment/outline/role")?),
            None => None,
        };
        if let Some(a) = attention {
            if a.get("line").and_then(Value::as_str) != Some("dashed") {
                return Err(Refusal::Bad("attention_treatment/line".into()));
            }
            let role = a.get("role").and_then(Value::as_str).unwrap_or("");
            named(role, "attention_treatment/role")?;
            if attention_glyph.is_none_or(str::is_empty) {
                return Err(Refusal::Bad("attention_treatment/glyph".into()));
            }
        }
        // A status mark keeps 3:1 against every fill it's drawn on, by its own color or its
        // outline's, and its glyph or word 4.5:1 in the theme's ink or ground (The status-color
        // rule; #1003).
        let (g, i) = (luminance(ground), luminance(ink));
        // The chrome's fills hold status only where status can show; a film played on its own is
        // drawn on its ground alone (the status-color rule; #464).
        let mut surfaces = surfaces(palette, alpha);
        if at == Distance::WhereStatusShows {
            surfaces.retain(|(on, _)| *on == "ground");
        }
        for (state, color) in &status.colors {
            let c = luminance(*color);
            let held = |s: Rgb| {
                contrast(*color, s) >= 3.0
                    || ring.is_some_and(|r| contrast(r, s) >= 3.0 && contrast(r, *color) >= 3.0)
            };
            let against = if let Some((on, _)) = surfaces.iter().find(|(_, s)| !held(*s)) {
                on
            } else if ratio(i, c).max(ratio(g, c)) < 4.5 {
                "label"
            } else {
                continue;
            };
            return Err(Refusal::Contrast {
                theme: name,
                state,
                against,
            });
        }
    }
    let code = role_map(def, "code", &crate::code::CLASSES, [&light, &dark])?;
    role_map(def, "diff", &DIFF_MARKS, [&light, &dark])?;
    let look = Look {
        light_type: Type {
            code: code.clone(),
            ..type_of(def, &fonts, &light_fonts)?
        },
        dark_type: Type {
            code,
            ..type_of(def, &fonts, &dark_fonts)?
        },
        light,
        dark,
        light_alpha,
        dark_alpha,
        status: Some(status),
        light_oklab,
        dark_oklab,
        light_fonts,
        dark_fonts,
        data_distance: def
            .get("data_distance")
            .and_then(Value::as_f64)
            .unwrap_or(DATA_DISTANCE),
        sizes: sizes(def, &fonts)?,
    };
    // Data colors keep the look's distance from every status color where status shows; the
    // ground sits behind them.
    let everywhere = (at == Distance::Everywhere)
        .then_some(look.status.as_ref())
        .flatten();
    if let Some(status) = everywhere {
        for (name, palette) in [("light", &look.light), ("dark", &look.dark)] {
            for (role, color) in palette.iter().filter(|(r, _)| *r != "ground") {
                if let Some((state, distance)) = clash(*color, status) {
                    return Err(Refusal::Distance {
                        theme: name,
                        role: role.clone(),
                        state,
                        distance,
                    });
                }
            }
        }
    }
    for (name, palette, alpha) in [
        ("light", &look.light, &look.light_alpha),
        ("dark", &look.dark, &look.dark_alpha),
    ] {
        chrome(name, palette, alpha, everywhere)?;
        terminal(name, palette, alpha)?;
    }
    Ok(look)
}

/// The first role of `look` within the status distance of a status color (`min`, or the look's
/// own): an opaque role but the ground, which sits behind them, or a role at an alpha over the
/// ground and the raised ground, in light then dark (The status-color rule).
pub fn clash_of(look: &Look, min: Option<f64>) -> Option<Refusal> {
    let mut status = look.status.clone()?;
    if let Some(min) = min {
        status.min_distance = min;
    }
    for (theme, palette, alpha) in [
        ("light", &look.light, &look.light_alpha),
        ("dark", &look.dark, &look.dark_alpha),
    ] {
        let named = |role: &String, (state, distance): (&'static str, f64)| Refusal::Distance {
            theme,
            role: role.clone(),
            state,
            distance,
        };
        for (role, color) in palette.iter().filter(|(r, _)| *r != "ground") {
            if let Some(found) = clash(*color, &status) {
                return Some(named(role, found));
            }
        }
        let Some(&ground) = palette.get("ground") else {
            continue;
        };
        let raised = palette.get("raised").copied().unwrap_or(ground);
        for (role, c) in alpha {
            for base in [ground, raised] {
                if let Some(found) = clash(over(*c, base), &status) {
                    return Some(named(role, found));
                }
            }
        }
    }
    None
}
/// The chrome's half of the guard for one theme (#882): a role at an alpha is the one ink's color,
/// and keeps the status distance (`status`, where it holds) over the ground and the raised ground; each ink tier keeps its
/// contrast floor on the ground, the raised ground and hover over either. A look without chrome
/// roles or a focus ring has nothing here to hold.
fn chrome(
    theme: &'static str,
    palette: &Palette,
    alpha: &BTreeMap<String, Rgba>,
    status: Option<&Status>,
) -> Result<(), Refusal> {
    let (Some(&ground), Some(&ink)) = (palette.get("ground"), palette.get("ink")) else {
        return Ok(());
    };
    let raised = palette.get("raised").copied().unwrap_or(ground);
    let color = |role: &str| role_color(palette, alpha, role);
    for (role, c) in alpha {
        if c[..3] != ink {
            return Err(Refusal::NotInk {
                theme,
                role: role.clone(),
            });
        }
        for base in [ground, raised] {
            if let Some((state, distance)) = status.and_then(|s| clash(over(*c, base), s)) {
                return Err(Refusal::Distance {
                    theme,
                    role: role.clone(),
                    state,
                    distance,
                });
            }
        }
    }
    let surfaces = surfaces(palette, alpha);
    // The app's chrome, which a look holds wherever it's shown, not a film played on its own (#464).
    let shown_in_chrome = status.is_some();
    for (role, in_chrome, alone) in INK_TIERS {
        let floor = if shown_in_chrome { in_chrome } else { alone };
        let Some(tier) = color(role) else { continue };
        for (on, surface) in &surfaces {
            let ratio = contrast(over(tier, *surface), *surface);
            if ratio < floor {
                return Err(Refusal::InkContrast {
                    theme,
                    role: role.into(),
                    on,
                    ratio,
                });
            }
        }
    }
    // The focus ring reads on every fill, so a focused row shows beside a selected one (#1003).
    if shown_in_chrome && (CHROME.iter().any(|r| color(r).is_some()) || color("focus").is_some()) {
        let focus = color("focus").ok_or_else(|| Refusal::Bad(format!("roles/focus ({theme})")))?;
        for (on, surface) in &surfaces {
            let ratio = contrast(over(focus, *surface), *surface);
            if ratio < FOCUS_FLOOR {
                return Err(Refusal::FocusContrast { theme, on, ratio });
            }
        }
    }
    Ok(())
}

/// Every ink tier's contrast on every fill a row is drawn on, in light then dark: the pairs the guard holds (#1458).
pub fn ink_pairs(look: &Look) -> Vec<(&'static str, &'static str, &'static str, f64)> {
    let mut out = Vec::new();
    for (theme, palette, alpha) in [
        ("light", &look.light, &look.light_alpha),
        ("dark", &look.dark, &look.dark_alpha),
    ] {
        let surfaces = surfaces(palette, alpha);
        for (role, ..) in INK_TIERS {
            let Some(ink) = role_color(palette, alpha, role) else {
                continue;
            };
            for (on, surface) in &surfaces {
                out.push((theme, role, *on, contrast(over(ink, *surface), *surface)));
            }
        }
    }
    out
}

/// A role's color, opaque or at an alpha.
fn role_color(palette: &Palette, alpha: &BTreeMap<String, Rgba>, role: &str) -> Option<Rgba> {
    alpha
        .get(role)
        .copied()
        .or_else(|| palette.get(role).map(|c| [c[0], c[1], c[2], 255]))
}

/// Every fill a row is drawn on, in the order the guard names them (#1003): the ground, the raised
/// ground (the ground where a look has none), and hover and selected over either, where the look
/// gives them.
fn surfaces(palette: &Palette, alpha: &BTreeMap<String, Rgba>) -> Vec<(&'static str, Rgb)> {
    let Some(&ground) = palette.get("ground") else {
        return Vec::new();
    };
    let raised = palette.get("raised").copied().unwrap_or(ground);
    let mut out = vec![("ground", ground), ("raised", raised)];
    for (role, on_ground, on_raised) in [
        ("hover", "hover over ground", "hover over raised"),
        ("selected", "selected over ground", "selected over raised"),
    ] {
        if let Some(fill) = role_color(palette, alpha, role) {
            out.push((on_ground, over(fill, ground)));
            out.push((on_raised, over(fill, raised)));
        }
    }
    out
}

/// A theme's terminal colors as a terminal draws them (#1003): the 16 by ANSI index, the background
/// they keep 3:1 against (`term_background`, or else the ground), and the default text, the ink.
/// `None` for a look that gives no terminal colors.
pub fn terminal_colors(palette: &Palette) -> Option<([Rgb; 16], Rgb, Rgb)> {
    let mut ansi = [[0; 3]; 16];
    for (slot, role) in ansi.iter_mut().zip(TERMINAL) {
        *slot = *palette.get(role)?;
    }
    let ground = *palette.get("ground")?;
    let background = palette.get("term_background").copied().unwrap_or(ground);
    Some((ansi, background, *palette.get("ink")?))
}

/// A theme's terminal colors (#1003): none, or all sixteen, each opaque and 3:1 against the
/// terminal background, `term_background` or else the ground. A program's own colors, true color
/// or a palette it sets, are drawn as it sent them; only the look's are held here.
fn terminal(
    theme: &'static str,
    palette: &Palette,
    alpha: &BTreeMap<String, Rgba>,
) -> Result<(), Refusal> {
    if let Some(role) = TERMINAL
        .iter()
        .chain(&["term_background"])
        .find(|r| alpha.contains_key(**r))
    {
        return Err(Refusal::Bad(format!("roles/{role} ({theme})")));
    }
    if !TERMINAL.iter().any(|r| palette.contains_key(*r)) {
        return Ok(());
    }
    let named = |role: &str| {
        palette
            .get(role)
            .copied()
            .ok_or_else(|| Refusal::Bad(format!("roles/{role} ({theme})")))
    };
    let background = match palette.get("term_background") {
        Some(c) => *c,
        None => named("ground")?,
    };
    for role in TERMINAL {
        let ratio = contrast(named(role)?, background);
        if ratio < TERMINAL_FLOOR {
            return Err(Refusal::TerminalContrast { theme, role, ratio });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(def: &Value) -> Result<Look, Refusal> {
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        super::resolve(def, &bundled)
    }

    #[test]
    fn a_data_role_near_a_status_color_is_refused_naming_both() {
        let mut def = shipped("clean").unwrap();
        def["palette"]["slate"] = json!("#636465");
        assert_eq!(
            resolve(&def),
            Err(Refusal::Distance {
                theme: "light",
                role: "muted".into(),
                state: "idle",
                distance: distance([0x63, 0x64, 0x65], [0x63, 0x64, 0x64]),
            })
        );
    }

    #[test]
    fn a_theme_that_changes_more_than_palette_and_roles_is_refused() {
        let mut def = shipped("clean").unwrap();
        def["themes"]["dark"]["status"] = json!({"pass": "#000000"});
        assert_eq!(
            resolve(&def),
            Err(Refusal::Bad("themes/dark/status".into()))
        );
    }

    #[test]
    fn the_clean_look_passes_its_own_guard() {
        assert!(resolve(&shipped("clean").unwrap()).is_ok());
    }

    #[test]
    fn a_status_color_too_close_to_a_ground_is_refused_unless_an_outline_holds_it() {
        let mut def = shipped("clean").unwrap();
        // Darker than the night ground allows: under 3:1 against it.
        def["status"]["idle"] = json!("#5a0a0a");
        assert_eq!(
            resolve(&def),
            Err(Refusal::Contrast {
                theme: "dark",
                state: "idle",
                against: "ground"
            })
        );
        def["palette"]["rim"] = json!("#c8c8c8");
        def["roles"]["rim"] = json!("rim");
        def["status_treatment"]["outline"] = json!({"px": 1, "role": "rim"});
        assert_eq!(resolve(&def).err(), None, "an outline at 3:1 holds it");
    }

    #[test]
    fn a_status_color_no_label_can_read_on_is_refused() {
        let mut def = shipped("clean").unwrap();
        // Mid grey: 3:1 on white but under 4.5:1 for both white and the ink on it.
        def["status"]["idle"] = json!("#7a7a7a");
        assert_eq!(
            resolve(&def),
            Err(Refusal::Contrast {
                theme: "light",
                state: "idle",
                against: "label"
            })
        );
    }

    #[test]
    fn the_attention_glyph_is_one_no_state_may_share() {
        let mut def = shipped("clean").unwrap();
        def["attention_treatment"]["glyph"] = json!("!");
        assert_eq!(
            resolve(&def),
            Err(Refusal::GlyphShared(["needs_you", "attention"]))
        );
        def["attention_treatment"]["line"] = json!("solid");
        def["attention_treatment"]["glyph"] = json!("⚠");
        assert_eq!(
            resolve(&def),
            Err(Refusal::Bad("attention_treatment/line".into()))
        );
    }

    #[test]
    fn a_focus_ring_is_held_in_a_look_without_other_chrome_roles() {
        let mut def = shipped("chalk").unwrap();
        def["roles"]["focus"] = def["roles"]["ground"].clone();
        assert!(matches!(
            resolve(&def),
            Err(Refusal::FocusContrast {
                theme: "light",
                on: "ground",
                ..
            })
        ));
    }

    #[test]
    fn every_shipped_look_gives_each_token_class_and_diff_mark_a_role_the_guard_holds() {
        for id in SHIPPED {
            let def = shipped(id).unwrap();
            // The guard as the app's look: every role at the status distance, in both themes.
            let look = resolve(&def).unwrap_or_else(|r| panic!("{id}: {r:?}"));
            let classes: Vec<&str> = look.light_type.code.keys().map(String::as_str).collect();
            let mut listed = crate::code::CLASSES.to_vec();
            listed.sort_unstable();
            assert_eq!(classes, listed, "{id}");
            assert_eq!(look.dark_type.code, look.light_type.code, "{id}");
            for mark in DIFF_MARKS {
                let role = def["diff"][mark].as_str().unwrap_or_default();
                assert!(look.light.contains_key(role), "{id}: diff/{mark} in light");
                assert!(look.dark.contains_key(role), "{id}: diff/{mark} in dark");
            }
        }
    }

    #[test]
    fn a_code_or_diff_map_is_refused_at_what_it_lacks_or_adds() {
        let refused = |edit: &dyn Fn(&mut Value)| {
            let mut def = shipped("clean").unwrap();
            edit(&mut def);
            resolve(&def).err()
        };
        let bad = |path: &str| Some(Refusal::Bad(path.into()));
        assert_eq!(
            refused(&|d| d["code"]["identifier"] = json!("ink")),
            bad("code/identifier")
        );
        assert_eq!(
            refused(&|d| {
                d["code"].as_object_mut().unwrap().remove("comment");
            }),
            bad("code/comment")
        );
        // A role the look doesn't give, a font role, and a role only one theme gives.
        assert_eq!(
            refused(&|d| d["code"]["keyword"] = json!("crimson")),
            bad("code/keyword")
        );
        assert_eq!(
            refused(&|d| d["code"]["plain"] = json!("math")),
            bad("code/plain")
        );
        assert_eq!(
            refused(&|d| {
                d["palette"]["leaf"] = json!("#0f4f32");
                d["themes"]["dark"]["roles"]["leaf"] = json!("leaf");
                d["diff"]["added"] = json!("leaf");
            }),
            bad("diff/added")
        );
        assert_eq!(
            refused(&|d| d["diff"]["moved"] = json!("ink")),
            bad("diff/moved")
        );
        // A look with neither is still a look: its tokens draw in plain.
        let mut bare = shipped("clean").unwrap();
        bare.as_object_mut().unwrap().remove("code");
        bare.as_object_mut().unwrap().remove("diff");
        assert!(resolve(&bare).unwrap().light_type.code.is_empty());
    }

    #[test]
    fn a_font_that_can_t_ship_is_refused_naming_it() {
        let mut def = shipped("clean").unwrap();
        def["fonts"]["body"]["file"] = json!("Helvetica.ttc");
        assert_eq!(resolve(&def), Err(Refusal::Font("body".into())));
        let mut def = shipped("clean").unwrap();
        def["fonts"]["mono"]["embed"] = json!(false);
        assert_eq!(resolve(&def), Err(Refusal::Font("mono".into())));
    }
}
