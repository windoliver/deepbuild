//! The surface #1141 adds or changes in deep-app (README: The surface). Every use of it in this suite goes through
//! these few functions, so a run against another program (the merge base, BASE-FAILURE.txt) swaps this one file.
#![allow(dead_code)]

use deep_app::notify::{Notification, Notifier};
use deep_app::record;
use deep_app::states::State;

const INSTALLED: &str = "the app's one record reader is installed";

/// What the sidebar draws, from the one record reader: every session, in the order each first appears, with its
/// task's title and its state.
pub fn sidebar() -> Vec<(String, String, State)> {
    deep_app::views::sidebar()
}

/// The one reader's open asks, by handle (`ask:<id>`), oldest first; of one session when `session` names one.
pub fn open_asks(session: Option<&str>) -> Vec<String> {
    record::with_view(|view| view.open_asks(session)).expect(INSTALLED)
}

/// When the open ask `ask` (a handle) defaults, as the one reader holds it.
pub fn deadline(ask: &str) -> Option<u64> {
    record::with_view(|view| view.deadline(ask)).expect(INSTALLED)
}

/// The notifier starts on the one reader's view, with what Notification Center still holds from the app.
pub fn start(notifier: &mut Notifier, delivered: Vec<Notification>) {
    record::with_view(|view| notifier.start(view, delivered)).expect(INSTALLED)
}

/// One notifier tick at `now`, over the one reader's view.
pub fn due(
    notifier: &mut Notifier,
    now: u64,
    looking_at: Option<&str>,
    sounds: bool,
) -> Vec<Notification> {
    record::with_view(|view| notifier.due(view, now, looking_at, sounds)).expect(INSTALLED)
}
