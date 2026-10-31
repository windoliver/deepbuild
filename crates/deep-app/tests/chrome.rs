//! Issue #882: a script panel reads its colors as `color.*` from gpui-base's semantic theme, so the app fills
//! that theme from the look's roles in the window's appearance. gpui's test window can't be set to dark from
//! outside gpui, so dark is the replica's way in, `chrome::force_dark`.

use deep_app::chrome;
use gpui_kit::base::{Theme, ThemeAppearance};
use gpui_kit::{div, AppContext as _, Render, TestAppContext, WindowOptions};

struct Empty;

impl Render for Empty {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        div()
    }
}

fn theme_in(cx: &mut TestAppContext, dark: Option<bool>) -> Theme {
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    chrome::force_dark(dark);
    cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
            chrome::follow(window, cx);
            cx.new(|_| Empty)
        })
        .expect("open window");
        Theme::global(cx)
    })
}

#[gpui_kit::test]
fn a_script_panels_theme_is_the_looks_light_roles(cx: &mut TestAppContext) {
    let theme = theme_in(cx, None);
    let (colors, light) = (theme.tokens.colors, chrome::chrome(false));
    assert_eq!(theme.appearance, ThemeAppearance::Light);
    assert_eq!(colors.background, light.ground);
    assert_eq!(colors.foreground, light.ink_primary);
    assert_eq!(colors.surface, light.raised);
    assert_eq!(colors.border, light.divider);
    assert_eq!(colors.primary, light.accent);
}

#[gpui_kit::test]
fn with_macos_in_dark_a_script_panels_theme_is_the_looks_dark_roles(cx: &mut TestAppContext) {
    let theme = theme_in(cx, Some(true));
    chrome::force_dark(None);
    let (colors, dark) = (theme.tokens.colors, chrome::chrome(true));
    assert_eq!(theme.appearance, ThemeAppearance::Dark);
    assert_eq!(colors.background, dark.ground);
    assert_eq!(colors.foreground, dark.ink_primary);
    assert_eq!(colors.surface, dark.raised);
    assert_eq!(colors.border, dark.divider);
    // An alpha role goes in opaque, as it shows over the ground: a script's colors carry no alpha.
    assert_eq!(colors.muted.a, 1.);
    assert_ne!(colors.muted, dark.ground);
}
