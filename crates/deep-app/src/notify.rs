//! Issue #326: notifications, the app shell's. An ask notifies only if it's still open a moment after it showed,
//! and never for the session whose page is open in the focused window; its notification carries the question, the
//! default and when the default applies, and a click opens its card and answers nothing. Finished work notifies
//! only through a notice you asked for, and makes no sound; a question sounds like a question. Of your devices, only
//! the one you used last plays a sound.

use std::time::Duration;

use serde_json::Value;

use crate::states;

/// How long an ask must stay open after it shows before it notifies.
pub const NOTIFY_AFTER: Duration = Duration::from_secs(1);

/// The sounds a notification can play. Finished work has none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sound {
    Question,
}

/// One notification, as the OS is asked to show it.
#[derive(Clone, Debug, PartialEq)]
pub struct Notification {
    /// The ask it opens, `ask:<id>`; `None` for a notice.
    pub ask: Option<String>,
    pub session: String,
    pub text: String,
    pub sound: Option<Sound>,
}

pub struct Notifier {
    after: Duration,
    /// Asks that showed, each with when it may notify, in the order they showed.
    waiting: Vec<(String, u64)>,
    /// Notices sent, each with the session it's about.
    notices: Vec<String>,
}

impl Notifier {
    /// The app's own waits [`NOTIFY_AFTER`].
    pub fn new(after: Duration) -> Notifier {
        Notifier {
            after,
            waiting: Vec::new(),
            notices: Vec::new(),
        }
    }

    /// An event reached the app at `now`.
    pub fn saw(&mut self, event: &Value, now: u64) {
        match event["kind"].as_str().unwrap_or_default() {
            "ask.created" => self
                .waiting
                .push((states::handle(event), now + self.after.as_millis() as u64)),
            "notice.sent" => self
                .notices
                .push(event["session"].as_str().unwrap_or_default().to_owned()),
            _ => {}
        }
    }

    /// When something next comes due, if anything waits.
    pub fn next_due(&self) -> Option<u64> {
        let notice = (!self.notices.is_empty()).then_some(0);
        self.waiting
            .iter()
            .map(|(_, due)| *due)
            .min()
            .into_iter()
            .chain(notice)
            .min()
    }

    /// What is due at `now`, over the record's `events`: `looking_at` is the session whose page is open in the
    /// focused window, and `sounds` whether this device is the one that plays sounds.
    pub fn due(
        &mut self,
        events: &[Value],
        now: u64,
        looking_at: Option<&str>,
        sounds: bool,
    ) -> Vec<Notification> {
        let mut out = Vec::new();
        for session in self.notices.drain(..) {
            out.push(Notification {
                ask: None,
                text: notification_text(events, &session, now),
                session,
                sound: None,
            });
        }
        let (due, waiting): (Vec<_>, Vec<_>) =
            self.waiting.drain(..).partition(|(_, at)| *at <= now);
        self.waiting = waiting;
        let open = states::open_asks(events, None);
        for (handle, _) in due {
            let Some(ask) = open.iter().find(|ask| states::handle(ask) == handle) else {
                continue;
            };
            let session = ask["session"].as_str().unwrap_or_default();
            if looking_at == Some(session) {
                continue;
            }
            out.push(Notification {
                ask: Some(handle),
                session: session.to_owned(),
                text: ask_text(events, ask, now),
                sound: sounds.then_some(Sound::Question),
            });
        }
        out
    }
}

/// The notification a session's state posts: its mark, its task and its state's words.
pub fn notification_text(events: &[Value], session: &str, now: u64) -> String {
    match states::open_asks(events, Some(session)).first() {
        Some(ask) => ask_text(events, ask, now),
        None => {
            let state = states::state(events, session);
            format!(
                "{} {} · {}",
                states::glyph(state.entry()),
                states::title(events, session),
                state.text(now)
            )
        }
    }
}

/// An ask's notification: the session's task, the question, and the default with when it applies.
fn ask_text(events: &[Value], ask: &Value, now: u64) -> String {
    let data = &ask["data"];
    let default = data["default"].as_str().unwrap_or_default();
    let label = data["options"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == default))
        .and_then(|option| option["label"].as_str())
        .unwrap_or(default);
    // The undo of its default gives it a new deadline.
    let deadline = states::deadline(events, ask).unwrap_or(now);
    format!(
        "{} {} · {} — {} If you don't answer: {label}, in {}.",
        states::glyph(states::State::NeedsYou.entry()),
        states::title(events, ask["session"].as_str().unwrap_or_default()),
        states::State::NeedsYou.word(),
        data["question"].as_str().unwrap_or_default(),
        states::span_until(deadline, now),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_notification_says_when_the_default_applies_after_its_undo() {
        let ask = json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
            "question": "Push?", "default": "no", "deadline": 1_000,
            "options": [{"id": "no", "label": "No"}]}});
        let events = vec![
            ask,
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a1", "data": {}}),
            json!({"kind": "default.undone", "writer": "core", "subject": "ask:a1",
                   "data": {"deadline": 2_000 + 2 * 3_600_000}}),
        ];
        let text = notification_text(&events, "s1", 2_000);
        assert!(text.ends_with("If you don't answer: No, in 2 h."), "{text}");
    }
}
