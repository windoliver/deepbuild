//! Issue #1462: the window's notices. A command that ran or didn't, an action the hub refused and an installed view
//! that failed to load each end in one line in the window, never only on the error stream. Each notice is one
//! accessibility node named by its words, keyed `notice:<n>`; the same words twice are one notice.

use std::cell::{Cell, RefCell};

use gpui_kit::*;

use crate::chrome::{self, sizes, Typed as _};

/// How many notices the window keeps, the newest last.
const KEPT: usize = 3;

thread_local! {
    static SHOWN: RefCell<(u64, Vec<(u64, String)>)> = const { RefCell::new((0, Vec::new())) };
    /// How far above the window's foot the box's top was last drawn, so notices never cover the box's Send.
    static ABOVE_BOX: Cell<Option<Pixels>> = const { Cell::new(None) };
}

/// Shows `words` in the window's notices.
pub fn show(words: String, cx: &mut App) {
    SHOWN.with(|shown| {
        let (next, notices) = &mut *shown.borrow_mut();
        notices.retain(|(_, said)| *said != words);
        *next += 1;
        notices.push((*next, words));
        let extra = notices.len().saturating_sub(KEPT);
        notices.drain(..extra);
    });
    cx.refresh_windows();
}

/// The notices the window shows now, oldest first.
pub fn shown() -> Vec<String> {
    SHOWN.with(|shown| shown.borrow().1.iter().map(|(_, w)| w.clone()).collect())
}

/// The box was drawn at `bounds`: from the next frame the notices sit above it.
pub fn box_drawn(bounds: Bounds<Pixels>, window: &mut Window) {
    let above = window.viewport_size().height - bounds.origin.y;
    if ABOVE_BOX.with(|a| a.replace(Some(above))) != Some(above) {
        window.on_next_frame(|window, _| window.refresh());
    }
}

fn dismiss(id: u64, cx: &mut App) {
    SHOWN.with(|shown| shown.borrow_mut().1.retain(|(at, _)| *at != id));
    cx.refresh_windows();
}

/// The notices, drawn at the window's foot over the views, above the box where the page has one.
pub fn notices(window: &Window) -> impl IntoElement {
    let chrome = chrome::of(window);
    let notices = SHOWN.with(|shown| shown.borrow().1.clone());
    let foot = ABOVE_BOX
        .with(Cell::get)
        .map_or(sizes().space(8), |above| above + sizes().space(1));
    div()
        .absolute()
        .bottom(foot)
        .right(sizes().space(2))
        .flex()
        .flex_col()
        .gap(sizes().space(1))
        .children(notices.into_iter().map(|(id, words)| {
            crate::views::observed(ElementId::Name(format!("notice:{id}").into()))
                .role(Role::Status)
                .aria_label(words.clone())
                .typed(sizes().body)
                .max_w(sizes().sidebar * 2.)
                .px(sizes().space(2))
                .py(sizes().space(1))
                .rounded(sizes().radius)
                .bg(chrome.raised)
                .border(sizes().hairline)
                .border_color(chrome.divider)
                .text_color(chrome.ink_primary)
                .child(words)
                .on_click(move |_, _, cx| dismiss(id, cx))
        }))
}
