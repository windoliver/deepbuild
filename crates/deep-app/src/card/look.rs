//! What the card hears of its window: whether a person can see it, and each change of it that re-arms the card
//! (`rearm_on`). A card arms, and a picture it judges is on screen, only while its window can be seen.

use gpui_kit::{App, Context, MouseDownEvent, Window};

use super::{edge, shown, Card};
use crate::arming::Rearm;
use crate::question::{Controller, Target};
use crate::shown::Seen;
use crate::trusted_input::PressEdge;

/// The tick read `window`'s state as `seen`, and the shown card hears it.
pub(crate) fn look(window: &Window, seen: Seen, cx: &mut App) {
    if let Some((_, card)) = shown() {
        card.update(cx, |card, cx| card.look(window, seen, cx));
    }
}

/// The window's content area, `[x, y, w, h]`, which a slot must lie in.
pub(super) fn content_area(window: &Window) -> [i64; 4] {
    let size = window.viewport_size();
    [
        0,
        0,
        f32::from(size.width) as i64,
        f32::from(size.height) as i64,
    ]
}

/// #1843's planted card takes no notice of a resize: the slot and the size it was armed with stand.
pub(super) fn resize_unheard(controller: &Controller, window: &Window) -> bool {
    crate::plain::planted("card-ignores-resize")
        && controller.slot().visible != content_area(window)
}

impl Card {
    /// The card is in `window`, and hears each change of it as that happens; the tick alone hears a lock.
    pub(super) fn watch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        cx.observe_window_visibility(window, |card, _, window, cx| {
            card.look(window, crate::shown::seen(window), cx)
        })
        .detach();
        cx.observe_window_activation(window, |card, window, cx| {
            card.rearm(Rearm::Activation, window, cx)
        })
        .detach();
        cx.observe_window_display(window, |card, window, cx| {
            card.rearm(Rearm::Display, window, cx)
        })
        .detach();
        let frame = |window: &Window| {
            let (origin, size) = (window.bounds().origin, window.viewport_size());
            (origin, size, window.scale_factor())
        };
        let mut was = frame(window);
        // GPUI says this of a window that came forward too, whose frame stays as it was.
        cx.observe_window_bounds(window, move |card, window, cx| {
            let (origin, size, scale) = frame(window);
            let before = std::mem::replace(&mut was, (origin, size, scale));
            let on = if scale != before.2 {
                Rearm::Display
            } else if size != before.1 {
                Rearm::Resize
            } else if origin != before.0 {
                Rearm::Move
            } else {
                return;
            };
            card.rearm(on, window, cx);
        })
        .detach();
        self.look(window, crate::shown::seen(window), cx);
    }

    /// The window's state counts as shown (#262), and its platform presents its frames, which is all a platform but macOS
    /// says.
    fn look(&mut self, window: &Window, seen: Seen, cx: &mut Context<Self>) {
        let seen = window.is_visible() && seen.shown();
        self.rearm(Rearm::Occluded { seen }, window, cx);
    }

    fn rearm(&mut self, on: Rearm, window: &Window, cx: &mut Context<Self>) {
        // #1843's planted cards each take no notice of one change.
        if crate::plain::planted(match on {
            Rearm::Move => "card-ignores-move",
            Rearm::Resize => "card-ignores-resize",
            Rearm::Occluded { .. } => "card-ignores-occluded",
            Rearm::Display => "card-ignores-display",
            Rearm::Activation => "card-ignores-activation",
        }) {
            return;
        }
        let (visible, now) = (content_area(window), crate::views::now());
        if self
            .controller
            .as_mut()
            .is_some_and(|controller| controller.rearm(on, visible, now))
        {
            cx.notify();
        }
    }

    /// The down of a press on `target`. The one that brings the window forward re-arms the card itself: GPUI says the
    /// window is active later, on a turn of its own, which a busy app can take after the release.
    pub(crate) fn pressing(
        &mut self,
        target: Target,
        down: &MouseDownEvent,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        if down.first_mouse {
            self.rearm(Rearm::Activation, window, cx);
        }
        let (t, hardware) = edge(PressEdge::Down);
        self.down = Some((target, t, hardware));
    }
}
