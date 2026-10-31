//! The fixture's shipped views, registered as the app registers its own, each drawn in the look's roles.
use std::sync::Arc;

use gpui_kit::base::dock::register_panel;
use gpui_kit::*;

use crate::chrome::Chrome;

/// Teaches the panel registry every shipped view.
pub fn register_views(cx: &mut App) {
    register_panel(cx, "deepbuild/sidebar", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Sidebar, cx))));
    register_panel(cx, "deepbuild/home", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Home, cx))));
    register_panel(cx, "deepbuild/needs-you", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::NeedsYou, cx))));
    register_panel(cx, "deepbuild/session", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Session, cx))));
    register_panel(cx, "deepbuild/line", |_, _, cx| Arc::new(cx.new(|cx| Shipped::new(Kind::Line, cx))));
}

/// A page in the chrome's roles.
pub fn page(chrome: &Chrome) -> Div {
    div().bg(chrome.ground).text_color(chrome.ink_primary).border_color(chrome.divider)
}
