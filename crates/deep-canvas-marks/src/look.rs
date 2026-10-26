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

use std::collections::BTreeMap;

use deep_canvas::color::{srgb_to_oklab, Oklab, Srgb};
use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::scene::{Palette, Rgb};

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

/// A resolved look: each theme's roles, and the status map when the look has one.
#[derive(Clone, Debug, PartialEq)]
pub struct Look {
    pub light: Palette,
    pub dark: Palette,
    pub status: Option<Status>,
}

/// Why a look is refused.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// The status guard: two states share a glyph.
    GlyphShared([&'static str; 2]),
    /// A data role within the look's `min_distance` of a status color, in a theme.
    Distance {
        theme: &'static str,
        role: String,
        state: &'static str,
    },
    /// A status color under 3:1 against the ground, or with no label color at 4.5:1 on it.
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
            Refusal::Distance { theme, role, state } => json!({
                "ok": false, "code": "status_distance", "theme": theme, "role": role, "state": state,
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

/// The definition of a shipped look by its ID.
pub fn shipped(id: &str) -> Option<Value> {
    match id {
        "clean" => serde_json::from_str(include_str!("../looks/clean.json")).ok(),
        _ => None,
    }
}

/// `#rrggbb` as sRGB-encoded bytes.
fn hex(value: Option<&Value>) -> Option<Rgb> {
    let text = value?.as_str()?.strip_prefix('#')?;
    if text.len() != 6 || !text.is_ascii() {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&text[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
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

/// One theme's roles: the look's palette and roles with the theme's own over them.
fn theme(def: &Map<String, Value>, name: &'static str) -> Result<Palette, Refusal> {
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
    roles
        .iter()
        .map(|(role, entry)| {
            let color = entry
                .as_str()
                .and_then(|name| hex(palette.get(name)))
                .ok_or_else(|| Refusal::Bad(format!("roles/{role}")))?;
            Ok((role.clone(), color))
        })
        .collect()
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

/// Every font entry names a bundled face file (`bundled`), may be embedded and carries a license.
fn fonts(def: &Map<String, Value>, bundled: &[&str]) -> Result<(), Refusal> {
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
        if !shippable {
            return Err(Refusal::Font(name.clone()));
        }
    }
    Ok(())
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

/// Resolves a look@1 definition and holds it to the status guard; `bundled` lists the font files
/// the build ships.
pub fn resolve(def: &Value, bundled: &[&str]) -> Result<Look, Refusal> {
    let Value::Object(def) = def else {
        return Err(Refusal::Bad(String::new()));
    };
    if def.get("legend").is_some_and(|l| l != "auto") {
        return Err(Refusal::Bad("legend".into()));
    }
    let status = status_map(def)?;
    fonts(def, bundled)?;
    let attention = object(def.get("attention_treatment"), "attention_treatment")?;
    let attention_glyph = attention
        .and_then(|a| a.get("glyph"))
        .and_then(Value::as_str);
    let (light, dark) = (theme(def, "light")?, theme(def, "dark")?);
    for (name, palette) in [("light", &light), ("dark", &dark)] {
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
        // A status mark keeps 3:1 against what's behind it, by its own color or its outline's,
        // and its glyph or word 4.5:1 in the theme's ink or ground (The status-color rule).
        let (g, i) = (luminance(ground), luminance(ink));
        for (state, color) in &status.colors {
            let c = luminance(*color);
            let held = ratio(c, g) >= 3.0
                || ring.is_some_and(|r| contrast(r, ground) >= 3.0 && contrast(r, *color) >= 3.0);
            let against = if !held {
                "ground"
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
    // Data colors keep the look's distance from every status color; the ground sits behind them.
    for (name, palette) in [("light", &light), ("dark", &dark)] {
        for (role, color) in palette.iter().filter(|(r, _)| *r != "ground") {
            if let Some((state, _)) = clash(*color, &status) {
                return Err(Refusal::Distance {
                    theme: name,
                    role: role.clone(),
                    state,
                });
            }
        }
    }
    Ok(Look {
        light,
        dark,
        status: Some(status),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUNDLED: &[&str] = &["Inter-Regular.ttf", "JetBrainsMono-Regular.ttf"];
    fn resolve(def: &Value) -> Result<Look, Refusal> {
        super::resolve(def, BUNDLED)
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
                state: "idle"
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
    fn a_font_that_can_t_ship_is_refused_naming_it() {
        let mut def = shipped("clean").unwrap();
        def["fonts"]["body"]["file"] = json!("Helvetica.ttc");
        assert_eq!(resolve(&def), Err(Refusal::Font("body".into())));
        let mut def = shipped("clean").unwrap();
        def["fonts"]["mono"]["embed"] = json!(false);
        assert_eq!(resolve(&def), Err(Refusal::Font("mono".into())));
    }
}
