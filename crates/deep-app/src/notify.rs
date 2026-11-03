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

use crate::record::View;
use crate::states::{self, Table};

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

    /// The app starts on the record's `view` with what Notification Center still holds from it: nothing already
    /// in the record notifies, since you could have seen it before.
    pub fn start(&mut self, view: &View, delivered: Vec<Notification>) {
        self.read.extend(view.unseen.iter().filter_map(opening));
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

    /// What is due at `now`, over the record's `view`: `looking_at` is the session whose page is open in the
    /// focused window, and `sounds` whether this device is the one that plays sounds. A notification of an ask
    /// that closed leaves Notification Center first, and each one posted replaces its session's.
    pub fn due(
        &mut self,
        view: &View,
        now: u64,
        looking_at: Option<&str>,
        sounds: bool,
    ) -> Vec<Notification> {
        // The asks are read only on a tick that can change what is shown: one with a notification to withdraw, a
        // notice to post or an ask come due. An idle tick reads nothing.
        let (due, waiting): (Vec<_>, Vec<_>) =
            self.waiting.drain(..).partition(|(_, at)| *at <= now);
        self.waiting = waiting;
        if self
            .delivered
            .iter()
            .all(|notification| notification.ask.is_none())
            && self.notices.is_empty()
            && due.is_empty()
        {
            return Vec::new();
        }
        let table = view.table();
        let table = &*table;
        // An ask stays shown until the events close it, whether or not they hold its creation: one raised before the
        // app started is read from the inbox, never from the events.
        self.delivered.retain(|notification| {
            notification
                .ask
                .as_ref()
                .is_none_or(|ask| table.is_open(ask))
        });
        let mut out = Vec::new();
        for session in self.notices.drain(..) {
            out.push(Notification {
                ask: None,
                title: title(table, &session),
                text: notification_text(table, &session, now),
                session,
                sound: None,
            });
        }
        // The open asks are read only for a tick with an ask come due.
        let open = if due.is_empty() {
            Vec::new()
        } else {
            table.open_asks(None)
        };
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
                title: title(table, session),
                text: ask_text(table, ask, now),
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

/// Whether the notifier reads the event: it opens an ask, gives it a new deadline or sends a notice.
pub fn reads(event: &Value) -> bool {
    opening(event).is_some() || event["kind"] == "notice.sent"
}

/// The id of the event, if it opens an ask or gives it a new deadline: its creation, the core's undo of its
/// default, or the core moving its deadline (#908), so the notification names the time its default applies.
fn opening(event: &Value) -> Option<String> {
    let opens = event["kind"] == "ask.created"
        || ((event["kind"] == "default.undone" || event["kind"] == "deadline.moved")
            && event["writer"] == "core"
            && event["data"]["deadline"].is_u64());
    opens.then(|| event["id"].as_str().unwrap_or_default().to_owned())
}

/// The notification a session's state posts: DeepBuild and the session's task, then its mark and its state's words.
pub fn notification_text(table: &Table, session: &str, now: u64) -> String {
    match table.open_asks(Some(session)).first() {
        Some(ask) => ask_text(table, ask, now),
        None => {
            let state = table.state(session);
            format!(
                "{}\n{} {}",
                title(table, session),
                states::glyph(state.entry()),
                state.text(now)
            )
        }
    }
}

/// A notification's title: it names DeepBuild and the session's task.
fn title(table: &Table, session: &str) -> String {
    format!("DeepBuild · {}", table.title(session))
}

/// An ask's notification: the session's task, the question, and the default with when it applies.
fn ask_text(table: &Table, ask: &Value, now: u64) -> String {
    let data = &ask["data"];
    let default = data["default"].as_str().unwrap_or_default();
    let label = data["options"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == default))
        .and_then(|option| option["label"].as_str())
        .unwrap_or(default);
    // The undo of its default gives it a new deadline.
    let deadline = table.deadline(ask).unwrap_or(now);
    format!(
        "{}\n{} {} — {} If you don't answer: {label}, {}.",
        title(table, ask["session"].as_str().unwrap_or_default()),
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

    fn view(events: &[Value]) -> View {
        let mut view = View::default();
        for event in events {
            view.apply(event.clone());
        }
        view
    }

    #[test]
    fn a_notification_held_from_before_the_app_started_stays_until_its_ask_closes() {
        // The ask was raised before the app started: its creation is in the inbox, not among the events streamed since.
        let held = Notification {
            ask: Some("ask:a1".into()),
            session: "s1".into(),
            title: String::new(),
            text: String::new(),
            sound: None,
        };
        let mut notifier = Notifier::new(Duration::from_secs(1));
        notifier.start(&View::default(), vec![held]);
        let unrelated =
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a2", "data": {}});
        notifier.notices.push("s2".into());
        notifier.due(&view(std::slice::from_ref(&unrelated)), 1_000, None, false);
        assert_eq!(notifier.delivered().len(), 2, "{:?}", notifier.delivered());
        let closed =
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a1", "data": {}});
        notifier.due(&view(&[unrelated, closed]), 2_000, None, false);
        let left: Vec<&str> = notifier
            .delivered()
            .iter()
            .map(|n| n.session.as_str())
            .collect();
        assert_eq!(left, ["s2"]);
    }

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
        let text = notification_text(&view(&events).table(), "s1", 2_000);
        let want = Local
            .timestamp_millis_opt(again as i64)
            .unwrap()
            .format("%H:%M");
        assert!(
            text.ends_with(&format!("If you don't answer: No, at {want}.")),
            "{text}"
        );
    }

    #[test]
    fn a_moved_deadline_posts_the_notification_again_with_the_time_it_moved_to() {
        // #908: posted at raise with its deadline then, the ask's deadline moves while the Mac sleeps.
        let raised = 1_000;
        let ask = json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
            "question": "Push?", "default": "no", "deadline": raised + 3_600_000,
            "options": [{"id": "no", "label": "No"}]}});
        let mut notifier = Notifier::new(Duration::from_secs(1));
        notifier.start(&view(std::slice::from_ref(&ask)), Vec::new());
        let woke = raised + 9 * 3_600_000;
        let moved = woke + 3_600_000;
        let event = json!({"kind": "deadline.moved", "id": "m1", "writer": "core", "subject": "ask:a1",
                           "data": {"span": moved - (raised + 3_600_000), "deadline": moved, "because": "notice"}});
        notifier.saw(&event, woke);
        let posted = notifier.due(&view(&[ask, event]), woke + 1_000, None, false);
        let want = Local
            .timestamp_millis_opt(moved as i64)
            .unwrap()
            .format("%H:%M");
        assert_eq!(posted.len(), 1, "{posted:?}");
        assert!(
            posted[0]
                .text
                .ends_with(&format!("If you don't answer: No, at {want}.")),
            "{}",
            posted[0].text
        );
    }
}
