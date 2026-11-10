//! Issue #326: notifications, the app shell's. An ask notifies only if it's still open a moment after it showed,
//! and never for the session whose page is open in the focused window; its notification carries the question, the
//! default and when the default applies, and a click opens its card and answers nothing. Finished work notifies
//! only through a notice you asked for, and makes no sound; a question sounds like a question. Of your devices, only
//! the one you used last plays a sound.
//!
//! Issue #883: what Notification Center holds from the app is one notification per session, withdrawn once its ask
//! closes, wherever the record says it closed. The default's time is a clock time in your time zone. Only a change
//! you could have seen notifies: re-reading the record, after a restart or a reconnect, posts nothing.
//!
//! Issue #994: asks that come due within [`SOUND_WINDOW`] of each other play one sound, and a tick posts one
//! notification per session, its newest. The app reads whether macOS will show it ([`NotificationSetting`]): off, an
//! ask due posts nothing and logs nothing as notified, and it posts once the setting allows. What the window says of
//! this and of the hub is one [`Reach`].

use std::cell::RefCell;
use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;

use crate::record::View;
use crate::states::{self, Table};

/// How long an ask must stay open after it shows before it notifies.
pub const NOTIFY_AFTER: Duration = Duration::from_secs(1);

/// Asks that come due this close together play one sound.
pub const SOUND_WINDOW: Duration = Duration::from_secs(2);

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

/// What macOS says of the app's notifications. "Not asked yet" reads allowed: the first post asks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NotificationSetting {
    #[default]
    Allowed,
    Denied,
    AlertsNone,
}

impl NotificationSetting {
    /// Its word on the app's log and to the hub (`notifications.report`).
    pub fn name(self) -> &'static str {
        match self {
            NotificationSetting::Allowed => "allowed",
            NotificationSetting::Denied => "denied",
            NotificationSetting::AlertsNone => "alerts_none",
        }
    }

    pub fn parse(name: &str) -> Option<NotificationSetting> {
        match name {
            "allowed" => Some(NotificationSetting::Allowed),
            "denied" => Some(NotificationSetting::Denied),
            "alerts_none" => Some(NotificationSetting::AlertsNone),
            _ => None,
        }
    }

    fn off(self) -> bool {
        self != NotificationSetting::Allowed
    }
}

/// What the app can't reach: the hub, and you, through macOS. The window's count and an ask's row read it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reach {
    pub hub_down: bool,
    pub setting: NotificationSetting,
    /// The asks Notification Center holds.
    pub delivered: Vec<String>,
}

const HUB_DOWN: &str = "The hub isn't answering";

impl Reach {
    /// The count: `count`, or with the hub down that it isn't answering, since a number may be old.
    pub fn count(&self, count: String) -> String {
        if self.hub_down {
            return HUB_DOWN.to_owned();
        }
        count
    }

    /// What you should know beside the count, a row of its own (#1455): notifications are off, and the fix.
    pub fn notice(&self) -> Option<&'static str> {
        match self.setting {
            NotificationSetting::Allowed => None,
            NotificationSetting::Denied => Some(
                "Notifications are off: turn on Allow notifications for DeepBuild in System Settings",
            ),
            NotificationSetting::AlertsNone => Some(
                "Alerts are set to None: pick an Alert style for DeepBuild in System Settings",
            ),
        }
    }

    /// The menu bar's room for the same: `None` when there's nothing to say.
    pub fn short(&self) -> Option<&'static str> {
        if self.hub_down {
            return Some(HUB_DOWN);
        }
        self.setting.off().then_some("Notifications off")
    }

    /// Whether `ask`'s row says it wasn't notified.
    pub fn not_notified(&self, ask: &str) -> bool {
        self.setting.off() && !self.delivered.iter().any(|held| held == ask)
    }
}

thread_local! {
    static REACH: RefCell<Reach> = RefCell::default();
}

/// What the window draws from now on.
pub fn publish(reach: Reach) {
    REACH.with(|cell| *cell.borrow_mut() = reach);
}

pub fn reach() -> Reach {
    REACH.with(|cell| cell.borrow().clone())
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
    /// When an ask last came due and posted: the next one sounds only after a gap of [`SOUND_WINDOW`].
    last_due: Option<u64>,
    /// What macOS says, as last read.
    setting: NotificationSetting,
    /// Asks that came due with notifications off, `(handle, session)`, and how many of them the log has.
    missed: Vec<(String, String)>,
    logged: usize,
    /// The work runs whose end was told, by their approval's ask, and the log position last read for one (#1348).
    told: HashSet<String>,
    told_at: Option<u64>,
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
            last_due: None,
            setting: NotificationSetting::Allowed,
            missed: Vec::new(),
            logged: 0,
            told: HashSet::new(),
            told_at: None,
        }
    }

    /// The app read `setting` at `now`: asks missed while it was off and still open post once it allows.
    pub fn set_setting(&mut self, setting: NotificationSetting, now: u64) {
        self.setting = setting;
        if !setting.off() {
            self.waiting
                .extend(self.missed.drain(..).map(|(ask, _)| (ask, now)));
            self.logged = 0;
        }
    }

    /// The asks that came due with notifications off since this was last asked, `(handle, session)`.
    pub fn newly_missed(&mut self) -> Vec<(String, String)> {
        let new = self.missed[self.logged..].to_vec();
        self.logged = self.missed.len();
        new
    }

    /// The setting as last read, and the asks Notification Center holds.
    pub fn reach(&self, hub_down: bool) -> Reach {
        Reach {
            hub_down,
            setting: self.setting,
            delivered: self
                .delivered
                .iter()
                .filter_map(|notification| notification.ask.clone())
                .collect(),
        }
    }

    /// The app starts on the record's `view` with what Notification Center still holds from it: nothing already
    /// in the record notifies, since you could have seen it before.
    pub fn start(&mut self, view: &View, delivered: Vec<Notification>) {
        self.read.extend(view.unseen.iter().filter_map(opening));
        self.delivered = delivered;
        // A run that had ended already was told, or could have been seen.
        self.told
            .extend(view.table().ended_runs().into_iter().map(|(ask, _)| ask));
        self.told_at = Some(view.log_pos);
    }

    /// An event reached the app at `now`.
    pub fn saw(&mut self, event: &Value, now: u64) {
        if let Some(id) = opening(event) {
            if self.read.insert(id) {
                let handle = match event["kind"].as_str() {
                    Some("ask.created") => states::handle(event),
                    _ => event["subject"].as_str().unwrap_or_default().to_owned(),
                };
                if !self.waiting.iter().any(|(waiting, _)| *waiting == handle) {
                    self.waiting
                        .push((handle, now + self.after.as_millis() as u64));
                }
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
        // A work run that has ended is told once (#1348), read only when the record moved.
        let ended = if self.told_at == Some(view.log_pos) {
            Vec::new()
        } else {
            self.told_at = Some(view.log_pos);
            let ended: Vec<_> = view
                .table()
                .ended_runs()
                .into_iter()
                .filter(|(ask, _)| !self.told.contains(ask))
                .collect();
            self.told.extend(ended.iter().map(|(ask, _)| ask.clone()));
            ended
        };
        if self
            .delivered
            .iter()
            .all(|notification| notification.ask.is_none())
            && self.notices.is_empty()
            && due.is_empty()
            && ended.is_empty()
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
        for (ask, sessions) in ended {
            if self.setting.off() {
                continue;
            }
            out.push(Notification {
                ask: None,
                title: "DeepBuild".to_owned(),
                text: end_notice(table, &sessions),
                session: ask,
                sound: None,
            });
        }
        for session in self.notices.drain(..) {
            if self.setting.off() {
                continue;
            }
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
            if self.setting.off() {
                if !self.missed.iter().any(|(ask, _)| *ask == handle) {
                    self.missed.push((handle, session.to_owned()));
                }
                continue;
            }
            out.push(Notification {
                ask: Some(handle),
                session: session.to_owned(),
                title: title(table, session),
                text: ask_text(table, ask, now),
                sound: None,
            });
        }
        // Each session keeps its newest; the one sound goes on what is left.
        let mut kept: Vec<Notification> = Vec::new();
        for notification in out.into_iter().rev() {
            if !kept
                .iter()
                .any(|newer| newer.session == notification.session)
            {
                kept.insert(0, notification);
            }
        }
        let mut out = kept;
        if let Some(first) = out.iter_mut().find(|n| n.ask.is_some()) {
            let quiet = self
                .last_due
                .is_none_or(|at| now.saturating_sub(at) >= SOUND_WINDOW.as_millis() as u64);
            first.sound = (sounds && quiet).then_some(Sound::Question);
            self.last_due = Some(now);
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

/// Whether a notification Notification Center still holds carries this ask's question, as the notification shows it:
/// marked (#1510).
pub fn carries(text: &str, question: &str) -> bool {
    !question.is_empty() && text.contains(&crate::question::visible(question))
}

/// The run's end notice (#1348), in plain words: its tasks have stopped, and how many each state holds, such as
/// "DeepBuild\nAll 2 tasks have stopped: 1 PASS, 1 needs you."
pub fn end_notice(table: &Table, sessions: &[String]) -> String {
    let mut counts: Vec<(&'static str, usize)> = Vec::new();
    for session in sessions {
        let word = table.state(session).word();
        match counts.iter_mut().find(|(known, _)| *known == word) {
            Some((_, count)) => *count += 1,
            None => counts.push((word, 1)),
        }
    }
    let tasks = match sessions.len() {
        1 => "The run's 1 task has stopped".to_owned(),
        n => format!("All {n} tasks have stopped"),
    };
    let counts: Vec<String> = counts
        .iter()
        .map(|(word, count)| format!("{count} {word}"))
        .collect();
    format!("DeepBuild\n{tasks}: {}.", counts.join(", "))
}

/// A notification's title: it names DeepBuild and the session's task.
fn title(table: &Table, session: &str) -> String {
    // With the list's rows (#1463), the row's project and title: an untitled session reads by its project and agent,
    // never an ID. The planted app puts the session's ID where its title goes, in a build with env-plants only.
    if let Some(row) = table.row_of(&format!("session:{session}")) {
        let text = |key: &str| row[key].as_str().unwrap_or_default().to_owned();
        let named = if crate::plain::planted("notification-title-id") {
            session.to_owned()
        } else {
            crate::question::visible(&text("title"))
        };
        return match row["project"].as_str() {
            Some(project) => format!("{} · {named}", crate::question::visible(project)),
            None => named,
        };
    }
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
    // The ask's words as the card draws them, its controls and direction marks shown (#1510).
    let (question, label) = (
        crate::question::visible(data["question"].as_str().unwrap_or_default()),
        crate::question::visible(label),
    );
    // The undo of its default gives it a new deadline.
    let deadline = table.deadline(ask).unwrap_or(now);
    format!(
        "{}\n{} {} — {} If you don't answer: {label}, at {}.",
        title(table, ask["session"].as_str().unwrap_or_default()),
        states::glyph(states::State::NeedsYou.entry()),
        states::State::NeedsYou.word(),
        question,
        states::moment(deadline, now),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone as _};
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
    fn a_notification_shows_a_direction_mark_as_the_card_does() {
        // #1510: an override in the question or the default's label would read the rest backwards.
        let ask = json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
            "question": "Open invoice\u{202e}txt.exe?", "default": "no", "deadline": 1_000,
            "options": [{"id": "no", "label": "No\u{202e}"}]}});
        let text = notification_text(&view(&[ask]).table(), "s1", 1_000);
        assert!(text.contains("Open invoice\\u{202e}txt.exe?"), "{text}");
        assert!(text.contains("If you don't answer: No\\u{202e},"), "{text}");
        assert!(!text.contains('\u{202e}'), "{text}");
    }

    #[test]
    fn a_notification_the_app_finds_after_a_relaunch_still_carries_its_marked_question() {
        // #1510: the posted text holds the marked question, so a relaunch that looks for the raw one withdraws it.
        let question = "Deploy?\nThis restarts prod\u{202e}";
        let ask = json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
            "question": question, "default": "no", "deadline": 1_000,
            "options": [{"id": "no", "label": "No"}]}});
        let text = notification_text(&view(&[ask]).table(), "s1", 1_000);
        assert!(carries(&text, question), "{text}");
        assert!(!carries(&text, "Push?"), "{text}");
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
