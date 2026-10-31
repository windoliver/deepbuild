//! Issue #326: notifications, the app shell's. An ask notifies only if it's still open a moment after it showed,
//! and never for the session whose page is open in the focused window; its notification carries the question, the
//! default and when the default applies, and a click opens its card and answers nothing. Finished work notifies
//! only through a notice you asked for, and makes no sound; a question sounds like a question. Of your devices, only
//! the one you used last plays a sound.
//!
//! Issue #883: what Notification Center holds from the app is one notification per session, withdrawn once its ask
//! closes, wherever the record says it closed. The default's time is a clock time in your time zone. Only a change
//! you could have seen notifies: re-reading the record, after a restart or a reconnect, posts nothing.

use std::collections::HashSet;
use std::time::Duration;

use chrono::{Local, TimeZone as _};
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
    /// Its title: DeepBuild and the session's task.
    pub title: String,
    /// Its title and body.
    pub text: String,
    pub sound: Option<Sound>,
}

pub struct Notifier {
    after: Duration,
    /// Asks that opened, each with when it may notify, in the order they opened.
    waiting: Vec<(String, u64)>,
    /// Notices sent, each with the session it's about.
    notices: Vec<String>,
    /// The events that opened an ask, by id, that this notifier has read: reading one again posts nothing.
    read: HashSet<String>,
    /// What Notification Center holds from the app: one notification per session.
    delivered: Vec<Notification>,
}

impl Notifier {
    /// The app's own waits [`NOTIFY_AFTER`].
    pub fn new(after: Duration) -> Notifier {
        Notifier {
            after,
            waiting: Vec::new(),
            notices: Vec::new(),
            read: HashSet::new(),
            delivered: Vec::new(),
        }
    }

    /// The app starts on the record's `events` with what Notification Center still holds from it: nothing already
    /// in the record notifies, since you could have seen it before.
    pub fn start(&mut self, events: &[Value], delivered: Vec<Notification>) {
        self.read.extend(events.iter().filter_map(opening));
        self.delivered = delivered;
    }

    /// An event reached the app at `now`.
    pub fn saw(&mut self, event: &Value, now: u64) {
        if let Some(id) = opening(event) {
            if self.read.insert(id) {
                let handle = match event["kind"].as_str() {
                    Some("ask.created") => states::handle(event),
                    _ => event["subject"].as_str().unwrap_or_default().to_owned(),
                };
                self.waiting
                    .push((handle, now + self.after.as_millis() as u64));
            }
        } else if event["kind"] == "notice.sent" {
            self.notices
                .push(event["session"].as_str().unwrap_or_default().to_owned());
        }
    }

    /// What Notification Center holds from the app now.
    pub fn delivered(&self) -> &[Notification] {
        &self.delivered
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
    /// focused window, and `sounds` whether this device is the one that plays sounds. A notification of an ask
    /// that closed leaves Notification Center first, and each one posted replaces its session's.
    pub fn due(
        &mut self,
        events: &[Value],
        now: u64,
        looking_at: Option<&str>,
        sounds: bool,
    ) -> Vec<Notification> {
        self.delivered.retain(|notification| {
            notification
                .ask
                .as_ref()
                .is_none_or(|ask| states::is_open(events, ask))
        });
        let mut out = Vec::new();
        for session in self.notices.drain(..) {
            out.push(Notification {
                ask: None,
                title: title(events, &session),
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
                title: title(events, session),
                text: ask_text(events, ask, now),
                sound: sounds.then_some(Sound::Question),
            });
        }
        for notification in &out {
            match self
                .delivered
                .iter_mut()
                .find(|delivered| delivered.session == notification.session)
            {
                Some(delivered) => *delivered = notification.clone(),
                None => self.delivered.push(notification.clone()),
            }
        }
        out
    }
}

/// The id of the event, if it opens an ask: its creation, or the core's undo of its default.
fn opening(event: &Value) -> Option<String> {
    let opens = event["kind"] == "ask.created"
        || (event["kind"] == "default.undone"
            && event["writer"] == "core"
            && event["data"]["deadline"].is_u64());
    opens.then(|| event["id"].as_str().unwrap_or_default().to_owned())
}

/// The notification a session's state posts: DeepBuild and the session's task, then its mark and its state's words.
pub fn notification_text(events: &[Value], session: &str, now: u64) -> String {
    match states::open_asks(events, Some(session)).first() {
        Some(ask) => ask_text(events, ask, now),
        None => {
            let state = states::state(events, session);
            format!(
                "{}\n{} {}",
                title(events, session),
                states::glyph(state.entry()),
                state.text(now)
            )
        }
    }
}

/// A notification's title: it names DeepBuild and the session's task.
fn title(events: &[Value], session: &str) -> String {
    format!("DeepBuild · {}", states::title(events, session))
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
        "{}\n{} {} — {} If you don't answer: {label}, {}.",
        title(events, ask["session"].as_str().unwrap_or_default()),
        states::glyph(states::State::NeedsYou.entry()),
        states::State::NeedsYou.word(),
        data["question"].as_str().unwrap_or_default(),
        clock_time(deadline, now),
    )
}

/// When `at` comes, as a clock time in your time zone, with the day when it isn't today's.
fn clock_time(at: u64, now: u64) -> String {
    let local = |ms: u64| Local.timestamp_millis_opt(ms as i64).unwrap();
    let (at, today) = (local(at), local(now).date_naive());
    let time = at.format("%H:%M");
    match (at.date_naive() - today).num_days() {
        0 => format!("at {time}"),
        1 => format!("tomorrow at {time}"),
        _ => format!("on {} at {time}", at.format("%a %-d %b")),
    }
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
        let again = 2_000 + 2 * 3_600_000;
        let events = vec![
            ask,
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a1", "data": {}}),
            json!({"kind": "default.undone", "writer": "core", "subject": "ask:a1",
                   "data": {"deadline": again}}),
        ];
        let text = notification_text(&events, "s1", 2_000);
        let want = Local
            .timestamp_millis_opt(again as i64)
            .unwrap()
            .format("%H:%M");
        assert!(
            text.ends_with(&format!("If you don't answer: No, at {want}.")),
            "{text}"
        );
    }
}
