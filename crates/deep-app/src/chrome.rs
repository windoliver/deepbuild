//! Issue #882: the chrome's colors. Every color the app draws, outside a status mark's core, is a role of
//! its look, the clean one, in the appearance macOS reports for the window: ground, raised and divider; the
//! one ink at two tiers and disabled (#1458); muted; hover and selected; accent; the keyboard focus ring (#1003); and the session's
//! readout and line. A terminal's 16 colors and its background are the look's too (#1003). No module names a
//! color of its own, and `scripts/color-literal-guard.mjs` holds the source to that. The same roles fill
//! gpui-base's semantic theme, which a script panel reads as `color.*` and the dock's handles draw with.
//!
//! Issue #1458: the chrome's sizes are roles of the same look: three text roles (`title`, `body`, `small`),
//! the `space` scale, one corner radius, the shell's two sizes and the chrome's faces. No module names a
//! size or a distance of its own, and the same guard holds the source to that. The theme writes the kit's
//! type, faces, radii and spacing from them too.

use std::cell::Cell;
use std::sync::OnceLock;

use deep_canvas_marks::look::{self, Look, Rgba as Rgba8};
use gpui_kit::base::{TextStyleToken, Theme, ThemeAppearance};
use gpui_kit::{
    px, App, FontFeatures, FontWeight, Hsla, Pixels, Rgba, SharedString, Styled, Window,
    WindowAppearance,
};

/// One appearance's chrome roles.
#[derive(Clone, Copy, Debug)]
pub struct Chrome {
    pub ground: Hsla,
    pub raised: Hsla,
    pub divider: Hsla,
    pub ink_primary: Hsla,
    pub ink_secondary: Hsla,
    pub ink_disabled: Hsla,
    /// A bound value past its freshness (#1172).
    pub muted: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    /// The keyboard focus ring, which reads on every fill a row is drawn on (#1003).
    pub focus: Hsla,
    pub accent: Hsla,
    pub session_readout: Hsla,
    pub session_line: Hsla,
}

impl Chrome {
    /// A chrome role by its name in the look (`ground`, `ink_secondary`, …), if it's one.
    pub fn named(&self, name: &str) -> Option<Hsla> {
        Some(match name {
            "ground" => self.ground,
            "raised" => self.raised,
            "divider" => self.divider,
            "ink_primary" => self.ink_primary,
            "ink_secondary" => self.ink_secondary,
            "ink_disabled" => self.ink_disabled,
            "muted" => self.muted,
            "hover" => self.hover,
            "selected" => self.selected,
            "focus" => self.focus,
            "accent" => self.accent,
            "session_readout" => self.session_readout,
            "session_line" => self.session_line,
            _ => return None,
        })
    }
}

fn look() -> &'static Look {
    static LOOK: OnceLock<Look> = OnceLock::new();
    LOOK.get_or_init(deep_canvas_marks::modules::clean)
}

fn color([r, g, b, a]: Rgba8) -> Hsla {
    Rgba {
        r: f32::from(r) / 255.,
        g: f32::from(g) / 255.,
        b: f32::from(b) / 255.,
        a: f32::from(a) / 255.,
    }
    .into()
}

/// A role of the look in light or dark; the clean look defines every chrome role in both.
fn role(name: &str, dark: bool) -> Hsla {
    let look = look();
    let (opaque, alpha) = if dark {
        (&look.dark, &look.dark_alpha)
    } else {
        (&look.light, &look.light_alpha)
    };
    alpha
        .get(name)
        .copied()
        .or_else(|| opaque.get(name).map(|[r, g, b]| [*r, *g, *b, 255]))
        .map(color)
        .unwrap_or_else(|| panic!("the clean look has no {name} role"))
}

/// The chrome in light (`dark: false`) or dark.
pub fn chrome(dark: bool) -> &'static Chrome {
    static LIGHT: OnceLock<Chrome> = OnceLock::new();
    static DARK: OnceLock<Chrome> = OnceLock::new();
    (if dark { &DARK } else { &LIGHT }).get_or_init(|| Chrome {
        ground: role("ground", dark),
        raised: role("raised", dark),
        divider: role("divider", dark),
        ink_primary: role("ink_primary", dark),
        ink_secondary: role("ink_secondary", dark),
        ink_disabled: role("ink_disabled", dark),
        muted: role("muted", dark),
        hover: role("hover", dark),
        selected: role("selected", dark),
        focus: role("focus", dark),
        accent: role("accent", dark),
        session_readout: role("session_readout", dark),
        session_line: role("session_line", dark),
    })
}

/// One text role (#1458): its size, line height and weight.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Text {
    pub size: Pixels,
    pub line: Pixels,
    pub weight: FontWeight,
}

/// Sets an element's text in a role of the look, in the chrome's text face, with tabular figures so a count, a time
/// or a duration that changes never moves its neighbours (#1458).
pub trait Typed: Styled + Sized {
    fn typed(self, role: Text) -> Self {
        self.font_family(sizes().face.clone())
            .font_features(FontFeatures(std::sync::Arc::new(vec![("tnum".into(), 1)])))
            .text_size(role.size)
            .line_height(role.line)
            .font_weight(role.weight)
    }
}

impl<E: Styled> Typed for E {}

/// The chrome's sizes, read from the clean look (#1458).
#[derive(Clone, Debug)]
pub struct Sizes {
    pub title: Text,
    pub body: Text,
    pub small: Text,
    space: Vec<Pixels>,
    pub radius: Pixels,
    /// The shell's two sizes, the list's width and the bottom band's height; the window it opens at; and the
    /// height an installed view gets in the sidebar.
    pub sidebar: Pixels,
    pub band: Pixels,
    pub window: (Pixels, Pixels),
    /// The list's narrowest width, the page's narrowest, and the reading lane's widest (#1461).
    pub list_min: Pixels,
    pub page_min: Pixels,
    pub lane: Pixels,
    pub placed: Pixels,
    /// The widths of the chrome's lines: a divider, the focus ring and the open row's bar.
    pub hairline: Pixels,
    pub ring: Pixels,
    pub bar: Pixels,
    /// The chrome's text face, and its code face.
    pub face: SharedString,
    pub code: SharedString,
}

impl Sizes {
    /// The space scale's `step`th size, smallest first: 0 is the look's 4 pt.
    pub fn space(&self, step: usize) -> Pixels {
        self.space[step.min(self.space.len() - 1)]
    }
}

/// The chrome's sizes; the clean look gives every one.
pub fn sizes() -> &'static Sizes {
    static SIZES: OnceLock<Sizes> = OnceLock::new();
    SIZES.get_or_init(|| {
        let given = look()
            .sizes
            .as_ref()
            .expect("the clean look gives the chrome's sizes");
        let text = |role: &str| {
            let r = &given.text[role];
            Text {
                size: px(r.size as f32),
                line: px(r.line as f32),
                weight: match r.weight {
                    "semibold" => FontWeight::SEMIBOLD,
                    "medium" => FontWeight::MEDIUM,
                    _ => FontWeight::NORMAL,
                },
            }
        };
        let face = |name: &str| SharedString::from(given.face[name].clone());
        Sizes {
            title: text("title"),
            body: text("body"),
            small: text("small"),
            space: given.space.iter().map(|s| px(*s as f32)).collect(),
            radius: px(given.radius as f32),
            sidebar: px(given.shell["sidebar"] as f32),
            band: px(given.shell["band"] as f32),
            window: (
                px(given.shell["window_width"] as f32),
                px(given.shell["window_height"] as f32),
            ),
            list_min: px(given.shell["list_min"] as f32),
            page_min: px(given.shell["page_min"] as f32),
            lane: px(given.shell["lane"] as f32),
            placed: px(given.shell["placed"] as f32),
            hairline: px(given.stroke["hairline"] as f32),
            ring: px(given.stroke["ring"] as f32),
            bar: px(given.stroke["bar"] as f32),
            face: face("text"),
            code: face("code"),
        }
    })
}

/// The reading lane on a page `page` wide (#1461): the card, a session's content and the box share
/// `min(720, page − 48)`, centred, so text keeps one left edge.
pub fn lane(page: Pixels) -> Pixels {
    let s = sizes();
    s.lane.min(page - s.space(4) * 2.).max(px(0.))
}

/// The list's width in a window `window` wide when `wanted` was asked for (#1461): from the list's
/// narrowest to the window less the page's narrowest, or `None`, hidden, when both don't fit.
pub fn list_width(wanted: Pixels, window: Pixels) -> Option<Pixels> {
    let s = sizes();
    let widest = window - s.page_min;
    (widest >= s.list_min).then(|| wanted.clamp(s.list_min, widest))
}

/// A terminal's colors in light or dark (#1003): the look's 16 by ANSI index, the background they keep 3:1
/// against (`term_background`, or else the ground), and the default text, the ink.
pub fn terminal(dark: bool) -> ([[u8; 3]; 16], [u8; 3], [u8; 3]) {
    let palette = if dark { &look().dark } else { &look().light };
    look::terminal_colors(palette).expect("the clean look gives its terminal colors")
}

thread_local! {
    static FORCED: Cell<Option<bool>> = const { Cell::new(None) };
}

/// Draws as if macOS reported dark (`Some(true)`) or light, for the replica: gpui's headless window always
/// reports light. `None` follows the window again.
pub fn force_dark(dark: Option<bool>) {
    FORCED.with(|forced| forced.set(dark));
}

/// Whether the window draws in dark: macOS's appearance for it, unless the replica set one.
pub fn is_dark(window: &Window) -> bool {
    FORCED.with(Cell::get).unwrap_or(matches!(
        window.appearance(),
        WindowAppearance::Dark | WindowAppearance::VibrantDark
    ))
}

/// The chrome in the window's appearance.
pub fn of(window: &Window) -> &'static Chrome {
    chrome(is_dark(window))
}

/// sRGB bytes of a color, its alpha over `base`.
fn bytes(color: Hsla, base: Hsla) -> [u8; 3] {
    let (c, b) = (Rgba::from(color), Rgba::from(base));
    let mix = |v: f32, under: f32| ((v * c.a + under * (1. - c.a)) * 255.).round() as u8;
    [mix(c.r, b.r), mix(c.g, b.g), mix(c.b, b.b)]
}

/// Fills gpui-base's semantic theme from the chrome in light or dark. A script's colors are opaque, so an
/// alpha role goes in as it shows over the ground, and each fill's text is the ground or the ink, whichever
/// reads better on it.
fn theme(dark: bool, cx: &mut App) {
    let c = chrome(dark);
    let solid = |color: Hsla| {
        let [r, g, b] = bytes(color, c.ground);
        self::color([r, g, b, 255])
    };
    let fail = {
        let v = crate::states::color("fail");
        self::color([(v >> 16) as u8, (v >> 8) as u8, v as u8, 255])
    };
    let on = |fill: Hsla| {
        let fill = bytes(fill, c.ground);
        let better = look::contrast(bytes(c.ground, c.ground), fill)
            > look::contrast(bytes(c.ink_primary, c.ground), fill);
        if better {
            c.ground
        } else {
            c.ink_primary
        }
    };
    let theme = Theme::global_mut(cx);
    theme.appearance = if dark {
        ThemeAppearance::Dark
    } else {
        ThemeAppearance::Light
    };
    let colors = &mut theme.tokens.colors;
    colors.background = c.ground;
    colors.foreground = c.ink_primary;
    colors.surface = c.raised;
    colors.surface_foreground = c.ink_primary;
    colors.primary = c.accent;
    colors.primary_foreground = on(c.accent);
    colors.secondary = solid(c.selected);
    colors.secondary_foreground = c.ink_primary;
    colors.muted = solid(c.hover);
    colors.muted_foreground = solid(c.ink_secondary);
    colors.accent = solid(c.hover);
    colors.accent_foreground = c.ink_primary;
    colors.destructive = fail;
    colors.destructive_foreground = on(fail);
    colors.border = c.divider;
    colors.input = c.divider;
    colors.ring = c.focus;
    colors.selection = c.selected;
    // The kit's type, faces, radii and spacing are the look's too (#1458): its five text sizes fall on
    // the three roles, and every radius but none and full is the one radius.
    let s = sizes();
    let token = |t: Text| TextStyleToken {
        size: t.size,
        line_height: t.line,
        weight: t.weight,
    };
    let ty = &mut theme.tokens.typography;
    ty.sans = s.face.clone();
    ty.mono = s.code.clone();
    ty.xs = token(s.small);
    ty.sm = token(s.body);
    ty.md = token(s.body);
    ty.lg = token(s.title);
    ty.xl = token(s.title);
    ty.mono_md = token(s.body);
    let radius = &mut theme.tokens.radius;
    (radius.sm, radius.md, radius.lg, radius.xl) = (s.radius, s.radius, s.radius, s.radius);
    let space = &mut theme.tokens.spacing;
    (space.xxs, space.xs, space.sm, space.md) = (s.space(0), s.space(0), s.space(1), s.space(2));
    (space.lg, space.xl, space.xxl) = (s.space(3), s.space(4), s.space(5));
}

/// Keeps gpui-base's semantic theme in the window's appearance: now, and whenever macOS changes it.
pub fn follow(window: &Window, cx: &mut App) {
    theme(is_dark(window), cx);
    window
        .observe_window_appearance(|window, cx| {
            theme(is_dark(window), cx);
            window.refresh();
        })
        .detach();
}
