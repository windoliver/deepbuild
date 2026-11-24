//! DeepBuild patch (windoliver/deepbuild#3232): an assistive client hears a window nobody can see. A draw is what gives
//! the platform a frame's tree, and what has it announce a live region, and a display asks for no frame of a covered or
//! minimized window, so a client of one read a bare root and was told of no change. While a client is connected, a
//! hidden window with something new is drawn for it, at most once each `EVERY`, and not presented. With no client, or
//! nothing new, nothing is drawn and nothing wakes (#1551). A view tells such a draw from one a person sees by
//! `Window::is_visible`, and the window is drawn anew once it's shown.

use std::{cell::Cell, rc::Rc, sync::atomic::Ordering::SeqCst, time::Duration};

use super::A11y;
use crate::{App, Window};

/// The least time between two draws of a window nobody can see.
const EVERY: Duration = Duration::from_millis(100);

#[derive(Default)]
pub(super) struct Unseen {
    /// Whether a draw of the hidden window is on its way, or began less than `EVERY` ago.
    pending: Rc<Cell<bool>>,
    /// Whether one was drawn since the window was last shown.
    drawn: Cell<bool>,
}

impl A11y {
    /// Whether an assistive client asked for the window's tree.
    fn asked(&self) -> bool {
        self.is_enabled() && self.active_flag.load(SeqCst)
    }
}

impl Window {
    /// Draws the window for its assistive client, soon after the app's update, where no display will.
    pub(crate) fn draw_unseen(&self, cx: &App) {
        if !self.owed_unseen() || self.a11y.unseen.pending.replace(true) {
            return;
        }
        let (handle, pending) = (self.handle, self.a11y.unseen.pending.clone());
        let drawn = cx.to_async().spawn(async move |cx| {
            // As for a frame a display asks for: what waited for the next frame runs, then the frame is drawn.
            let owed = handle.update(cx, |_, window, cx| {
                let owed = window.owed_unseen();
                if owed {
                    window.a11y.unseen.drawn.set(true);
                    let callbacks = window.next_frame_callbacks.take();
                    for callback in callbacks {
                        callback(window, cx);
                    }
                }
                owed
            });
            if owed.unwrap_or(false) {
                let _ = handle.update(cx, |_, window, cx| window.draw(cx).clear(cx));
            }
            cx.background_executor().timer(EVERY).await;
            // What came meanwhile is drawn once this update ends.
            pending.set(false);
            let _ = handle.update(cx, |_, _, _| ());
        });
        drawn.detach();
    }

    /// The window was hidden or shown. One drawn while it was hidden is drawn anew as it's shown, so what its views count
    /// as seen was.
    pub(crate) fn draw_seen(&mut self) {
        if self.visibility.is_visible() && self.a11y.unseen.drawn.take() {
            self.refresh();
        }
    }

    fn owed_unseen(&self) -> bool {
        self.invalidator.is_dirty() && !self.visibility.is_visible() && self.a11y.asked()
    }
}
