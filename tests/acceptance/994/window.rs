//! Issue #994, what the window says: an ask's row and the count, on the replica's virtual clock. The replica stands in
//! for two things it can't have in a test: the OS's notification setting and a hub that stops answering. Written blind
//! from the issue, docs/technical-design.md and the base commit 58862789; the surface it reaches is pinned in this
//! folder's README.md and used only in `mod surface`.
//!
//!   AC3 #994.649376f0  with notifications denied, an open ask's row says not notified and nothing posts
//!   Scope            alerts set to none reads the same; the count says so with the fix; the setting is read when the
//!                    app becomes active; the count says the hub isn't answering, for a refused poll too
//!
//! `cargo test --locked -p deep-replica --test acceptance_994_window`. With `DA994_SCREENS=<dir>` it runs only the
//! screenshot AC5 needs of the row (taste.test.ts). No libtest harness, as the replica's suites.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the suite is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!(
            "acceptance_994_window: INCONCLUSIVE; the replica runs on macOS only, so nothing ran"
        );
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
#[path = "common.rs"]
mod common;

#[cfg(target_os = "macos")]
mod suite {
    use std::path::Path;

    use deep_replica::Replica;

    use super::common::{posts_for, raise, record, secs, Raised, SESSIONS};
    use surface::*;

    // ---- The surface this issue adds (README: The surface). Every use of it goes through these few lines.

    mod surface {
        pub use deep_app::notify::NotificationSetting as Setting;
        use deep_replica::Replica;
        use std::path::Path;

        /// What the OS answers from now on when the app reads the setting. The app hasn't read it yet.
        pub fn os_says(replica: &mut Replica, setting: Setting) {
            replica.set_notification_setting(0, setting);
        }

        /// The app becomes active.
        pub fn activate(replica: &mut Replica) {
            replica.activate(0);
        }

        /// The window's center shows `view`: `home`, `needs-you` or `session`.
        pub fn show(replica: &mut Replica, view: &str) {
            replica.show_view(0, view);
        }

        pub fn hub_stops(replica: &mut Replica) {
            replica.hub_stops();
        }

        pub fn hub_refuses(replica: &mut Replica) {
            replica.hub_refuses();
        }

        pub fn hub_answers(replica: &mut Replica) {
            replica.hub_answers();
        }

        pub fn screenshot(replica: &mut Replica, path: &Path) {
            replica.screenshot(0, path);
        }
    }

    /// Every name and value in the window's accessibility tree, as drawn now.
    fn drawn(replica: &mut Replica) -> Vec<String> {
        replica
            .window()
            .flatten()
            .iter()
            .flat_map(|node| {
                let value = node
                    .value
                    .as_ref()
                    .and_then(|value| value.as_str())
                    .map(str::to_owned);
                node.name.clone().into_iter().chain(value)
            })
            .collect()
    }

    /// The ask's row in Needs you: the node that names its handle or its question.
    fn row(replica: &mut Replica, ask: &Raised) -> String {
        show(replica, "needs-you");
        let names = drawn(replica);
        names
            .iter()
            .find(|name| name.contains(&ask.handle) || name.contains(&ask.question))
            .cloned()
            .unwrap_or_else(|| panic!("{}: Needs you has no row for it: {names:?}", ask.handle))
    }

    fn says_not_notified(text: &str) -> bool {
        text.to_lowercase().contains("not notified")
    }

    /// The window's count, on Home: whatever line `says` picks out, or None.
    fn count_saying(replica: &mut Replica, says: fn(&str) -> bool) -> Option<String> {
        show(replica, "home");
        drawn(replica)
            .into_iter()
            .find(|name| says(&name.to_lowercase()))
    }

    fn notifications_off_with_the_fix(text: &str) -> bool {
        text.contains("notifications") && text.contains("off") && text.contains("system settings")
    }

    fn alerts_none_with_the_fix(text: &str) -> bool {
        text.contains("alerts") && text.contains("none") && text.contains("system settings")
    }

    fn hub_not_answering(text: &str) -> bool {
        text.contains("hub")
            && (text.contains("isn't answering")
                || text.contains("isn\u{2019}t answering")
                || text.contains("not answering"))
    }

    /// The window as the app starts it with `setting` from the OS.
    fn opened_with(setting: Setting) -> Replica {
        let mut replica = Replica::open(&record());
        os_says(&mut replica, setting);
        activate(&mut replica);
        replica
    }

    fn ac3_with_notifications_denied_an_open_asks_row_says_not_notified_and_nothing_posts() {
        let mut replica = opened_with(Setting::Denied);
        let ask = raise(&mut replica, SESSIONS[0]);
        replica.advance(secs(3));
        let posted = posts_for(&replica, &ask.handle);
        assert!(
            posted.is_empty(),
            "{}: notifications are denied, so nothing posts: {posted:?}",
            ask.handle
        );
        let text = row(&mut replica, &ask);
        assert!(
            says_not_notified(&text),
            "{}: its row should say not notified: {text:?}",
            ask.handle
        );

        // The control: allowed, the same ask notifies and its row says no such thing.
        let mut replica = opened_with(Setting::Allowed);
        let ask = raise(&mut replica, SESSIONS[0]);
        replica.advance(secs(3));
        assert_eq!(
            posts_for(&replica, &ask.handle).len(),
            1,
            "{}: allowed, it notifies once",
            ask.handle
        );
        let text = row(&mut replica, &ask);
        assert!(
            !says_not_notified(&text),
            "{}: it notified, so its row shouldn't say not notified: {text:?}",
            ask.handle
        );
    }

    fn scope_the_count_says_notifications_are_off_with_the_fix() {
        let mut replica = opened_with(Setting::Denied);
        raise(&mut replica, SESSIONS[0]);
        replica.advance(secs(3));
        let said = count_saying(&mut replica, notifications_off_with_the_fix);
        assert!(
            said.is_some(),
            "the count should say notifications are off and name System Settings: {:?}",
            drawn(&mut replica)
        );
    }

    fn scope_alerts_set_to_none_read_as_off_on_the_row_and_the_count() {
        let mut replica = opened_with(Setting::AlertsNone);
        let ask = raise(&mut replica, SESSIONS[1]);
        replica.advance(secs(3));
        let posted = posts_for(&replica, &ask.handle);
        assert!(
            posted.is_empty(),
            "{}: alerts are set to none, so nothing posts: {posted:?}",
            ask.handle
        );
        let text = row(&mut replica, &ask);
        assert!(
            says_not_notified(&text),
            "{}: its row should say not notified: {text:?}",
            ask.handle
        );
        let said = count_saying(&mut replica, alerts_none_with_the_fix);
        assert!(
            said.is_some(),
            "the count should say alerts are set to none and name System Settings: {:?}",
            drawn(&mut replica)
        );
    }

    fn scope_the_app_reads_the_setting_again_when_it_becomes_active() {
        let mut replica = opened_with(Setting::Allowed);
        os_says(&mut replica, Setting::Denied);
        let before = raise(&mut replica, SESSIONS[0]);
        replica.advance(secs(3));
        assert_eq!(
            posts_for(&replica, &before.handle).len(),
            1,
            "{}: the app hasn't read the change yet, so it still posts",
            before.handle
        );

        activate(&mut replica);
        let off = raise(&mut replica, SESSIONS[1]);
        replica.advance(secs(3));
        let posted = posts_for(&replica, &off.handle);
        assert!(
            posted.is_empty(),
            "{}: the app read denied when it became active, so nothing posts: {posted:?}",
            off.handle
        );
        assert!(
            count_saying(&mut replica, notifications_off_with_the_fix).is_some(),
            "the count should say notifications are off once the app read it: {:?}",
            drawn(&mut replica)
        );

        os_says(&mut replica, Setting::Allowed);
        activate(&mut replica);
        let on = raise(&mut replica, SESSIONS[2]);
        replica.advance(secs(3));
        assert_eq!(
            posts_for(&replica, &on.handle).len(),
            1,
            "{}: the app read allowed when it became active, so it notifies",
            on.handle
        );
        assert_eq!(
            count_saying(&mut replica, notifications_off_with_the_fix),
            None,
            "the count should stop saying notifications are off"
        );
    }

    fn the_count_says_the_hub_isnt_answering_until_it_does(stops: fn(&mut Replica)) {
        let mut replica = opened_with(Setting::Allowed);
        assert_eq!(
            count_saying(&mut replica, hub_not_answering),
            None,
            "setup: the hub answers, so the count says nothing of it"
        );
        stops(&mut replica);
        replica.advance(secs(3));
        assert!(
            count_saying(&mut replica, hub_not_answering).is_some(),
            "the count should say the hub isn't answering: {:?}",
            drawn(&mut replica)
        );
        hub_answers(&mut replica);
        replica.advance(secs(3));
        assert_eq!(
            count_saying(&mut replica, hub_not_answering),
            None,
            "the hub answers again, so the count should stop saying it doesn't"
        );
    }

    fn scope_the_count_says_the_hub_isnt_answering_while_it_cant_read() {
        the_count_says_the_hub_isnt_answering_until_it_does(hub_stops);
    }

    fn scope_a_refused_poll_is_shown_the_same_way() {
        the_count_says_the_hub_isnt_answering_until_it_does(hub_refuses);
    }

    /// AC5's row, in the file the taste call names. Whether it looks right is a person's call (taste.test.ts).
    fn write_the_row_screenshot(dir: &Path) {
        let mut replica = opened_with(Setting::Denied);
        let ask = raise(&mut replica, SESSIONS[0]);
        replica.advance(secs(3));
        let text = row(&mut replica, &ask);
        assert!(
            says_not_notified(&text),
            "{}: its row should say not notified: {text:?}",
            ask.handle
        );
        screenshot(&mut replica, &dir.join("not-notified-row.png"));
    }

    pub fn run() -> i32 {
        if let Some(dir) = std::env::var_os("DA994_SCREENS") {
            let dir = std::path::PathBuf::from(dir);
            return i32::from(
                std::panic::catch_unwind(move || write_the_row_screenshot(&dir)).is_err(),
            );
        }
        super::common::run(vec![
            (
                "ac3_with_notifications_denied_an_open_asks_row_says_not_notified_and_nothing_posts",
                ac3_with_notifications_denied_an_open_asks_row_says_not_notified_and_nothing_posts,
            ),
            (
                "scope_the_count_says_notifications_are_off_with_the_fix",
                scope_the_count_says_notifications_are_off_with_the_fix,
            ),
            (
                "scope_alerts_set_to_none_read_as_off_on_the_row_and_the_count",
                scope_alerts_set_to_none_read_as_off_on_the_row_and_the_count,
            ),
            (
                "scope_the_app_reads_the_setting_again_when_it_becomes_active",
                scope_the_app_reads_the_setting_again_when_it_becomes_active,
            ),
            (
                "scope_the_count_says_the_hub_isnt_answering_while_it_cant_read",
                scope_the_count_says_the_hub_isnt_answering_while_it_cant_read,
            ),
            (
                "scope_a_refused_poll_is_shown_the_same_way",
                scope_a_refused_poll_is_shown_the_same_way,
            ),
        ])
    }
}
