//! Issue #882: the chrome's colors. Every color the app draws, outside a status mark's core, is a role of
//! its look, the clean one, in the appearance macOS reports for the window: ground, raised and divider; the
//! one ink at four tiers; hover and selected; accent; and the session's readout and line. No module names a
//! color of its own, and `scripts/color-literal-guard.mjs` holds the source to that. The same roles fill
//! gpui-base's semantic theme, which a script panel reads as `color.*` and the dock's handles draw with.

use std::cell::Cell;
use std::sync::OnceLock;

use deep_canvas_marks::look::{self, Look, Rgba as Rgba8};
use gpui_kit::base::{Theme, ThemeAppearance};
use gpui_kit::{App, Hsla, Rgba, Window, WindowAppearance};

/// One appearance's chrome roles.
#[derive(Clone, Copy, Debug)]
pub struct Chrome {
    pub ground: Hsla,
    pub raised: Hsla,
    pub divider: Hsla,
    pub ink_primary: Hsla,
    pub ink_secondary: Hsla,
    pub ink_tertiary: Hsla,
    pub ink_disabled: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    pub accent: Hsla,
    pub session_readout: Hsla,
    pub session_line: Hsla,
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
        ink_tertiary: role("ink_tertiary", dark),
        ink_disabled: role("ink_disabled", dark),
        hover: role("hover", dark),
        selected: role("selected", dark),
        accent: role("accent", dark),
        session_readout: role("session_readout", dark),
        session_line: role("session_line", dark),
    })
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
    colors.ring = c.accent;
    colors.selection = c.selected;
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
