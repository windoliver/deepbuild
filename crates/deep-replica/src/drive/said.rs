//! What the replica's window tells you with nothing drawn: the notifications its notifier posts, and the lines its
//! live region says (#3232), each kept as data. The notifier is told the session whose page is open in the window, as
//! the app's is (#326, #1845), so an ask from that session posts nothing and the window says it.

use super::*;

impl Replica {
    pub(super) fn notify(&mut self) {
        let now = self.now + self.clock.t * 1000 / FLICKS;
        // The Set up click asks macOS (#1100); the stand-in answers at once, as a person pressing Allow.
        if deep_app::notify::take_ask() {
            self.permission_requests
                .push(json!({"t": self.clock.t, "ask": null}));
            self.notifier.set_setting(NotificationSetting::Allowed, now);
        }
        let (looking_at, asked) = self.cx.update(|cx| {
            (
                deep_app::open::looking_at(cx),
                deep_app::said::take_asked(cx),
            )
        });
        for ask in asked {
            self.notifier.said(ask);
        }
        let notifier = &mut self.notifier;
        // Sounds off in the box's words (#1998) leave the question unsounded, as in the app.
        let sounds = deep_app::hub::sounds_on();
        let due = deep_app::record::with_view(|view| {
            notifier.due(view, now, looking_at.as_deref(), sounds)
        });
        for posted in due.unwrap_or_default() {
            // A post while macOS was never asked asks it then, as GPUI's center does on its first post.
            if self.notifier.reach(false).setting == NotificationSetting::NotAsked {
                self.permission_requests
                    .push(json!({"t": self.clock.t, "ask": posted.ask}));
                self.notifier.set_setting(NotificationSetting::Allowed, now);
            }
            #[cfg(target_os = "macos")]
            if self.plant == Some(Plant::StartsSound) && posted.sound.is_some() {
                plant::play_sound();
            }
            self.notified.push(json!({
                "t": self.clock.t, "ask": posted.ask, "session": posted.session, "text": posted.text,
                "sound": posted.sound.map(|_| "question"),
            }));
        }
        let unposted = self.notifier.take_unposted();
        self.cx
            .update(|cx| deep_app::said::asks(&unposted, now, cx));
        self.heard();
    }

    /// Keeps what the window said as of this frame (#3232): a new line is added, and one that took another change
    /// within its 2 s reads as it now does, at the time it was first said.
    fn heard(&mut self) {
        let lines = self.cx.update(|cx| deep_app::said::lines(cx));
        for line in lines.into_iter().rev() {
            let t = line.at.saturating_sub(self.now) * FLICKS / 1000;
            match self.said.iter_mut().find(|(seq, ..)| *seq == line.seq) {
                Some(said) => said.2 = line.text,
                None => self.said.push((line.seq, t, line.text)),
            }
        }
    }

    /// The window's announcements, in the order made (#3232): `[{t, text}]`, `t` in flicks since launch.
    pub(super) fn announcements(&self) -> Value {
        self.said
            .iter()
            .map(|(_, t, text)| json!({"t": t, "text": text}))
            .collect()
    }
}
