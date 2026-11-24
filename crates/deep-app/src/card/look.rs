//! Whether a person can see the card, which its controller is told as that changes: a card arms, and a picture it judges
//! is on screen, only while they can.

use gpui_kit::{App, Context, Window};

use super::{shown, Card};
use crate::shown::Seen;

/// The tick read `window`'s state as `seen`, and the shown card hears it.
pub(crate) fn look(window: &Window, seen: Seen, cx: &mut App) {
    if let Some((_, card)) = shown() {
        card.update(cx, |card, cx| card.look(window, seen, cx));
    }
}

impl Card {
    /// The card is in `window`, and hears it hidden and shown as that happens; the tick alone hears a lock.
    pub(super) fn watch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        cx.observe_window_visibility(window, |card, _, window, cx| {
            card.look(window, crate::shown::seen(window), cx)
        })
        .detach();
        self.look(window, crate::shown::seen(window), cx);
    }

    /// The window's state counts as shown (#262), and its platform presents its frames, which is all a platform but macOS
    /// says.
    fn look(&mut self, window: &Window, seen: Seen, cx: &mut Context<Self>) {
        let seen = window.is_visible() && seen.shown();
        let now = crate::views::now();
        if self
            .controller
            .as_mut()
            .is_some_and(|controller| controller.look(seen, now))
        {
            cx.notify();
        }
    }
}
