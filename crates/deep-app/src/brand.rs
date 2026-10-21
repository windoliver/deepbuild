//! The kit's files the app shows (issue #79), embedded as they are: each surface draws the bytes
//! of a file in `brand/`, never a redrawn or re-encoded copy, so an asset's hash proves its source.
//! `brand/surfaces.json` lists every use with its kit file.

/// The macOS app icon, `brand/DeepBuild.icns`, set on the running app as its dock icon.
pub const APP_ICON: &[u8] = include_bytes!("../../../brand/DeepBuild.icns");
/// The menu-bar template at 1x and 2x: black on transparent, shown at 16 pt, tinted by macOS.
pub const MENU_BAR_TEMPLATE: &[u8] = include_bytes!("../../../brand/png/trayTemplate.png");
pub const MENU_BAR_TEMPLATE_2X: &[u8] = include_bytes!("../../../brand/png/trayTemplate@2x.png");
/// The title-bar mark: the small cut, for uses at 24 px and below.
pub const TITLE_BAR_MARK: &[u8] = include_bytes!("../../../brand/symbol-small-ink.svg");
/// The welcome screen's artwork: the stacked lockup in Ink, for a light ground.
pub const WELCOME_LOCKUP: &[u8] = include_bytes!("../../../brand/lockup-stacked-ink.svg");

/// `brand/palette.json`: Ink and Paper, the lockup's approved light ground.
pub const INK: u32 = 0x151619;
pub const PAPER: u32 = 0xF6F6F4;

/// The point size each use shows the D at; `brand/surfaces.json` records the same numbers.
/// `MENU_BAR_PT` is an `f64` because it sizes an `NSSize`; the others size GPUI pixels.
pub const MENU_BAR_PT: f64 = 16.;
pub const TITLE_BAR_D_PX: f32 = 18.;
pub const WELCOME_D_PX: f32 = 96.;

/// `symbol-small-ink.svg`'s view box is 256 units with the D spanning 192 of them (32 to 224), so
/// the element that shows the D at `TITLE_BAR_D_PX` is this big: 24 px, still at or under the 24
/// px where the small cut is the right one.
pub const TITLE_BAR_MARK_PX: f32 = TITLE_BAR_D_PX * 256. / 192.;

/// `lockup-stacked-ink.svg`'s view box is 695 by 393 units, with the D 190 units tall (1.9 times
/// the wordmark's cap height of 100), so the element that shows the D at `WELCOME_D_PX` is this tall
/// and wide.
pub const WELCOME_LOCKUP_HEIGHT_PX: f32 = WELCOME_D_PX * 393. / 190.;
pub const WELCOME_LOCKUP_WIDTH_PX: f32 = WELCOME_LOCKUP_HEIGHT_PX * 695. / 393.;
