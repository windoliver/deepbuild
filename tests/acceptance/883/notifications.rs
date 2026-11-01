//! Issue #883: notifications leave once their ask closes, give the default as a clock time, and never repeat after a
//! restart. Written blind, before any implementation, from the issue, docs/technical-design.md and the base commit
//! 0f7fb686; the surface it reaches is pinned in this folder's README.md.
//!
//!   AC1  ac1_*      an ask answered in the CLI leaves Notification Center within 2 s; main's notifier fails, naming it
//!   AC2  ac2_*      two asks from one session 30 s apart leave one, the second's; from two sessions, two
//!   AC3  ac3_*      a default at 16:40 today reads "at 16:40", tomorrow "tomorrow at 16:40"; "in 2 h" fails
//!   AC4  ac4_*      quit and reopen, then a hub restart, post nothing again; a notifier that queues every open ask
//!                   on start fails, naming the ask
//!   Scope scope_*   withdrawn when superseded, moot or past its deadline, on every device; nothing again for an
//!                   ask you saw on screen, or after a channel reconnect; the title names DeepBuild and the task
//!   Planted planted_*  the wrong programs the criteria name, through the same judges
//!
//! Wired into deep-replica by one `[[test]]` entry in crates/deep-replica/Cargo.toml (`acceptance_883`,
//! `harness = false`) and run with `cargo test --locked -p deep-replica --test acceptance_883`. Like the replica's own
//! suite it has no libtest harness: every case runs on the main thread, where AppKit wants the offscreen renderer, and
//! it prints libtest's result lines; a positional argument narrows the run to the cases whose names hold it.
//!
//! The time zone is fixed for the whole process before anything else runs: `TZ=Europe/Berlin` (README: Time zone).

/// The time zone every case runs in. On the virtual clock's `NOW` (2027-01-15 08:00 UTC) it is 09:00 there, CET.
const TIME_ZONE: &str = "Europe/Berlin";

fn main() {
    // Before any thread or the app starts: the app reads "your time zone" from the OS, which honours TZ.
    std::env::set_var("TZ", TIME_ZONE);
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the suite is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_883: INCONCLUSIVE; the replica runs on macOS only, so none of #883's checks ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::cell::Cell;
    use std::path::PathBuf;
    use std::time::Duration;

    use deep_replica::{repo_root, Posted, Replica, NOW};
    use serde_json::{json, Value};

    use surface::*;

    // ---- The surface this issue adds (README: The surface). Every use of it goes through these few lines.

    mod surface {
        use deep_replica::{Killed, Planted, Posted, Replica};
        use std::path::Path;

        /// The wrong programs the criteria name.
        #[derive(Clone, Copy, Debug)]
        pub enum Wrong {
            /// AC1: the notifier on main: it posts, and never withdraws or replaces anything.
            NeverWithdraws,
            /// AC4: a notifier that queues every open ask on start.
            QueuesOpenAsksOnStart,
        }

        pub fn wrong(fixture: &Path, wrong: Wrong) -> Replica {
            Replica::planted(
                fixture,
                match wrong {
                    Wrong::NeverWithdraws => Planted::NeverWithdraws,
                    Wrong::QueuesOpenAsksOnStart => Planted::QueuesOpenAsksOnStart,
                },
            )
        }

        /// What Notification Center on `device` holds now.
        pub fn delivered(replica: &Replica, device: usize) -> Vec<Posted> {
            replica.delivered(device)
        }

        /// The notification's title, as the OS shows it.
        pub fn title(posted: &Posted) -> String {
            posted.title.clone()
        }

        pub fn relaunch(killed: Killed) -> Replica {
            Replica::relaunch(killed)
        }

        pub fn restart_hub(replica: &mut Replica) {
            replica.restart_hub();
        }

        pub fn reconnect(replica: &mut Replica) {
            replica.reconnect();
        }
    }

    // ---- The fixtures (fixtures/, README: Fixtures).

    /// Two sessions, each with a task, and nothing asked yet.
    const RECORD: &str = "two-sessions.events.jsonl";
    const S1: &str = "01MD883SESS000000000000S01";
    const S2: &str = "01MD883SESS000000000000S02";
    const TASK1: &str = "Cart totals";
    const TASK2: &str = "Release notes";

    /// 14:40 in Berlin on NOW's day, 2027-01-15, as ms past NOW; 16:40 the same day and the next, as epoch ms.
    const TO_14_40: u64 = 20_400_000;
    const TODAY_16_40: u64 = 1_800_027_600_000;
    const TOMORROW_16_40: u64 = 1_800_114_000_000;

    fn fixture(name: &str) -> PathBuf {
        repo_root().join("tests/acceptance/883/fixtures").join(name)
    }

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    // ---- Events the cases append, from fixtures/live.json's templates.

    thread_local! {
        static NEXT: Cell<u64> = const { Cell::new(1) };
    }

    /// A fresh event ID: ULID-shaped, never one the fixtures use.
    fn next_id() -> (u64, String) {
        NEXT.with(|next| {
            let n = next.get();
            next.set(n + 1);
            (n, format!("01MD8839{n:018}"))
        })
    }

    fn live(kind: &str, replica: &Replica) -> Value {
        let path = fixture("live.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let all: Value = serde_json::from_str(&text).expect("live.json is JSON");
        let mut event = all
            .get(kind)
            .cloned()
            .unwrap_or_else(|| panic!("live.json has no {kind} template"));
        event["id"] = json!(next_id().1);
        event["ts"] = json!(replica.now());
        event
    }

    /// The questions the cases' asks ask, so no two open asks read alike.
    const QUESTIONS: [&str; 3] = [
        "Push feat/cart to origin?",
        "Delete the stale preview deploy?",
        "Open port 8080 to the network?",
    ];

    /// Raises an ask in `session` now, its default "No" applying at `deadline`; answers its handle, `ask:<id>`.
    fn raise_until(replica: &mut Replica, session: &str, deadline: u64) -> String {
        let mut event = live("ask.created", replica);
        let (n, id) = next_id();
        event["id"] = json!(id);
        event["data"]["deadline"] = json!(deadline);
        event["data"]["question"] = json!(QUESTIONS[n as usize % QUESTIONS.len()]);
        event["data"]["key"] = json!(format!("{n:064x}"));
        let handle = format!("ask:{id}");
        replica.append(session, event);
        handle
    }

    /// Raises an ask whose default applies two days on.
    fn raise(replica: &mut Replica, session: &str) -> String {
        let deadline = replica.now() + 2 * 86_400_000;
        raise_until(replica, session, deadline)
    }

    /// The core closes `ask`: `kind` is one of live.json's closing templates, `data` merged into its data.
    fn close(replica: &mut Replica, session: &str, kind: &str, ask: &str, data: Value) {
        let mut event = live(kind, replica);
        event["subject"] = json!(ask);
        if let Value::Object(fields) = data {
            for (key, value) in fields {
                event["data"][key] = value;
            }
        }
        replica.append(session, event);
    }

    /// You answer `ask` in the CLI, `deep inbox answer`: the core records it `via: "inbox"`.
    fn answer_in_cli(replica: &mut Replica, session: &str, ask: &str) {
        close(
            replica,
            session,
            "ask.answered",
            ask,
            json!({ "via": "inbox" }),
        );
    }

    fn posts_for(replica: &Replica, ask: &str) -> Vec<Posted> {
        replica
            .notifications()
            .into_iter()
            .filter(|posted| posted.ask.as_deref() == Some(ask))
            .collect()
    }

    fn left_for(replica: &Replica, device: usize, ask: &str) -> Vec<Posted> {
        delivered(replica, device)
            .into_iter()
            .filter(|posted| posted.ask.as_deref() == Some(ask))
            .collect()
    }

    /// The setup every withdrawal case shares: `ask` notified and sits in Notification Center on device 0.
    fn notified(replica: &mut Replica, ask: &str) {
        replica.advance(secs(1));
        assert_eq!(
            posts_for(replica, ask).len(),
            1,
            "setup: {ask} should notify once a second after it showed: {:?}",
            replica.notifications()
        );
        assert_eq!(
            left_for(replica, 0, ask).len(),
            1,
            "setup: {ask} notified, so Notification Center should hold it: {:?}",
            delivered(replica, 0)
        );
    }

    /// The judge every withdrawal case shares: 2 s after the record says `ask` closed, Notification Center on
    /// `device` holds nothing for it. A failure names the ask.
    fn gone_within_2_s(
        replica: &mut Replica,
        device: usize,
        ask: &str,
        how: &str,
    ) -> Result<(), String> {
        replica.advance(secs(2));
        let left = left_for(replica, device, ask);
        if left.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "{ask}: {how}, yet Notification Center on device {device} still holds it 2 s later: {left:?}"
            ))
        }
    }

    fn holds(result: Result<(), String>) {
        if let Err(failure) = result {
            panic!("{failure}");
        }
    }

    // ---- AC1: an ask that notified and is then answered in the CLI leaves Notification Center within 2 s.

    fn ac1_scenario(mut replica: Replica) -> (String, Result<(), String>) {
        let ask = raise(&mut replica, S1);
        notified(&mut replica, &ask);
        answer_in_cli(&mut replica, S1, &ask);
        let result = gone_within_2_s(&mut replica, 0, &ask, "answered in the CLI");
        (ask, result)
    }

    fn ac1_an_ask_answered_in_the_cli_leaves_notification_center_within_2_s() {
        holds(ac1_scenario(Replica::open(&fixture(RECORD))).1);
    }

    fn planted_ac1_the_notifier_on_main_leaves_it_and_fails_naming_the_ask() {
        let (ask, result) = ac1_scenario(wrong(&fixture(RECORD), Wrong::NeverWithdraws));
        let failure =
            result.expect_err("AC1's judge passed the notifier on main, which never withdraws");
        assert!(
            failure.contains(&ask),
            "AC1's failure doesn't name the ask {ask}: {failure}"
        );
    }

    // ---- AC2: one notification per session at a time.

    fn ac2_one_session_scenario(mut replica: Replica) -> Result<(), String> {
        let first = raise(&mut replica, S1);
        replica.advance(secs(30));
        let second = raise(&mut replica, S1);
        replica.advance(secs(2));
        let held = delivered(&replica, 0);
        let asks: Vec<_> = held.iter().map(|posted| posted.ask.clone()).collect();
        if asks == [Some(second.clone())] {
            Ok(())
        } else {
            Err(format!(
                "two asks from one session 30 s apart ({first}, then {second}) should leave one notification, the \
                 second's; Notification Center holds {asks:?}: {held:?}"
            ))
        }
    }

    fn ac2_two_asks_from_one_session_30_s_apart_leave_one_the_seconds() {
        holds(ac2_one_session_scenario(Replica::open(&fixture(RECORD))));
    }

    fn ac2_two_asks_from_two_sessions_leave_two() {
        let mut replica = Replica::open(&fixture(RECORD));
        let first = raise(&mut replica, S1);
        replica.advance(secs(30));
        let second = raise(&mut replica, S2);
        replica.advance(secs(2));
        let held = delivered(&replica, 0);
        let mut asks: Vec<_> = held
            .iter()
            .filter_map(|posted| posted.ask.clone())
            .collect();
        asks.sort();
        let mut want = vec![first, second];
        want.sort();
        assert_eq!(
            (held.len(), asks),
            (2, want),
            "two asks from two sessions should leave two notifications, one each: {held:?}"
        );
    }

    fn planted_ac2_the_notifier_on_main_leaves_both_of_one_sessions_asks() {
        let result = ac2_one_session_scenario(wrong(&fixture(RECORD), Wrong::NeverWithdraws));
        result.expect_err("AC2's judge passed the notifier on main, which replaces nothing");
    }

    // ---- AC3: the default's time as a clock time in your time zone.

    /// The judge: what a notification's text must say of when its default applies. `want` is "at 16:40" or
    /// "tomorrow at 16:40".
    fn reads_default_at(text: &str, want: &str) -> Result<(), String> {
        if text.contains("in 2 h") {
            return Err(format!(
                "the default's time reads \"in 2 h\", not {want:?}: {text:?}"
            ));
        }
        if !text.contains(want) {
            return Err(format!("the default's time should read {want:?}: {text:?}"));
        }
        if want == "at 16:40" && text.contains("tomorrow") {
            return Err(format!(
                "a default at 16:40 today reads as tomorrow: {text:?}"
            ));
        }
        Ok(())
    }

    /// The case's own premise: 16:40 today and tomorrow, as epoch ms, are 16:40 in the fixed zone.
    fn premise_16_40(at: u64) {
        let out = std::process::Command::new("date")
            .env("TZ", super::TIME_ZONE)
            .args(["-r", &(at / 1000).to_string(), "+%Y-%m-%d %H:%M"])
            .output()
            .expect("date runs");
        let local = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        assert!(
            local.ends_with(" 16:40"),
            "premise: {at} should be 16:40 in {}, is {local}",
            super::TIME_ZONE
        );
    }

    /// At 14:40 local an ask is raised whose default applies at `deadline`; answers its notification's text.
    fn text_for_default_at(deadline: u64) -> String {
        premise_16_40(deadline);
        let mut replica = Replica::open(&fixture(RECORD));
        replica.advance(ms(TO_14_40));
        assert_eq!(replica.now(), NOW + TO_14_40, "setup: the clock at 14:40");
        let ask = raise_until(&mut replica, S1, deadline);
        replica.advance(secs(2));
        let posts = posts_for(&replica, &ask);
        assert_eq!(
            posts.len(),
            1,
            "setup: {ask} should notify once: {:?}",
            replica.notifications()
        );
        posts[0].text.clone()
    }

    fn ac3_a_default_at_16_40_today_reads_at_16_40() {
        holds(reads_default_at(
            &text_for_default_at(TODAY_16_40),
            "at 16:40",
        ));
    }

    fn ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40() {
        holds(reads_default_at(
            &text_for_default_at(TOMORROW_16_40),
            "tomorrow at 16:40",
        ));
    }

    fn planted_ac3_a_text_with_in_2_h_fails() {
        // The base's own wording for a default two hours off, planted as the text.
        let planted =
            "Cart totals · needs you — Push feat/cart to origin? If you don't answer: No, in 2 h.";
        for want in ["at 16:40", "tomorrow at 16:40"] {
            let failure = reads_default_at(planted, want)
                .expect_err("AC3's judge passed a text with \"in 2 h\"");
            assert!(
                failure.contains("in 2 h"),
                "AC3's failure doesn't say why: {failure}"
            );
        }
        // The control: the judge passes the issue's own example, so it fails "in 2 h" for what it says.
        holds(reads_default_at(
            "If you don't answer: No, at 16:40",
            "at 16:40",
        ));
        holds(reads_default_at(
            "If you don't answer: No, tomorrow at 16:40",
            "tomorrow at 16:40",
        ));
    }

    // ---- AC4: quitting and reopening the app, then restarting the hub, post no second notification.

    /// Posts for `ask` after its first, at `first`.
    fn again(replica: &Replica, ask: &str, first: u64) -> Vec<Posted> {
        posts_for(replica, ask)
            .into_iter()
            .filter(|posted| posted.at > first)
            .collect()
    }

    /// Quits and reopens the app, restarts the hub and reconnects a channel, 5 s apart; after each, nothing new
    /// may be posted for `ask` since `first`. `channel` adds the reconnect (Scope). Then a new ask still notifies.
    fn restarts(mut replica: Replica, ask: &str, first: u64, channel: bool) -> Result<(), String> {
        let killed = replica.kill();
        replica = relaunch(killed);
        replica.advance(secs(5));
        let posts = again(&replica, ask, first);
        if !posts.is_empty() {
            return Err(format!(
                "{ask}: posted again after the app was quit and reopened: {posts:?}"
            ));
        }
        restart_hub(&mut replica);
        replica.advance(secs(5));
        let posts = again(&replica, ask, first);
        if !posts.is_empty() {
            return Err(format!(
                "{ask}: posted again after the hub restarted: {posts:?}"
            ));
        }
        if channel {
            reconnect(&mut replica);
            replica.advance(secs(5));
            let posts = again(&replica, ask, first);
            if !posts.is_empty() {
                return Err(format!(
                    "{ask}: posted again after a channel reconnected: {posts:?}"
                ));
            }
        }
        let left = left_for(&replica, 0, ask);
        if left.len() > 1 {
            return Err(format!(
                "{ask}: Notification Center holds it {} times: {left:?}",
                left.len()
            ));
        }
        // The control: the reopened app still notifies a change you could have seen, a new ask opening.
        let fresh = raise(&mut replica, S2);
        replica.advance(secs(2));
        let posts = posts_for(&replica, &fresh);
        if posts.len() != 1 {
            return Err(format!(
                "{fresh}: an ask opening after the restarts should notify once, not {}: {posts:?}",
                posts.len()
            ));
        }
        Ok(())
    }

    fn ac4_scenario(mut replica: Replica) -> (String, Result<(), String>) {
        let ask = raise(&mut replica, S1);
        replica.advance(secs(2));
        let posts = posts_for(&replica, &ask);
        assert_eq!(
            posts.len(),
            1,
            "setup: {ask} should notify once: {:?}",
            replica.notifications()
        );
        let first = posts[0].at;
        let result = restarts(replica, &ask, first, false);
        (ask, result)
    }

    fn ac4_quitting_and_reopening_the_app_then_restarting_the_hub_posts_nothing_again() {
        holds(ac4_scenario(Replica::open(&fixture(RECORD))).1);
    }

    fn planted_ac4_a_notifier_that_queues_every_open_ask_on_start_fails_naming_the_ask() {
        let (ask, result) = ac4_scenario(wrong(&fixture(RECORD), Wrong::QueuesOpenAsksOnStart));
        let failure =
            result.expect_err("AC4's judge passed a notifier that queues every open ask on start");
        assert!(
            failure.contains(&ask),
            "AC4's failure doesn't name the ask {ask}: {failure}"
        );
    }

    // ---- Scope: a delivered notification is withdrawn however the record says its ask closed.

    fn superseded_scenario(mut replica: Replica) -> Result<(), String> {
        let old = raise(&mut replica, S1);
        notified(&mut replica, &old);
        // You open S1's page, so the newer ask posts nothing that could replace the old one: only withdrawal clears it.
        replica.focus(0, Some(S1));
        let newer = raise(&mut replica, S1);
        close(
            &mut replica,
            S1,
            "ask.superseded",
            &old,
            json!({ "by": newer }),
        );
        gone_within_2_s(&mut replica, 0, &old, "superseded")
    }

    fn scope_withdrawn_when_superseded() {
        holds(superseded_scenario(Replica::open(&fixture(RECORD))));
    }

    fn moot_scenario(mut replica: Replica) -> Result<(), String> {
        let ask = raise(&mut replica, S1);
        notified(&mut replica, &ask);
        let verdict = format!("verdict:{}", next_id().1);
        close(
            &mut replica,
            S1,
            "ask.moot",
            &ask,
            json!({ "because": "check_passed", "verdict": verdict }),
        );
        gone_within_2_s(&mut replica, 0, &ask, "moot")
    }

    fn scope_withdrawn_when_moot() {
        holds(moot_scenario(Replica::open(&fixture(RECORD))));
    }

    fn deadline_scenario(mut replica: Replica) -> Result<(), String> {
        let deadline = replica.now() + 10_000;
        let ask = raise_until(&mut replica, S1, deadline);
        notified(&mut replica, &ask);
        replica.advance(ms(deadline - replica.now()));
        // Past its deadline the core applies the default and records it.
        close(&mut replica, S1, "ask.defaulted", &ask, json!({}));
        gone_within_2_s(&mut replica, 0, &ask, "past its deadline, defaulted")
    }

    fn scope_withdrawn_when_its_deadline_passes() {
        holds(deadline_scenario(Replica::open(&fixture(RECORD))));
    }

    fn scope_withdrawn_from_every_device() {
        let mut replica = Replica::open_devices(&fixture(RECORD), 2);
        let ask = raise(&mut replica, S1);
        replica.advance(secs(2));
        let holding: Vec<usize> = (0..2)
            .filter(|device| !left_for(&replica, *device, &ask).is_empty())
            .collect();
        assert!(
            !holding.is_empty(),
            "setup: {ask} should be in some device's Notification Center"
        );
        answer_in_cli(&mut replica, S1, &ask);
        replica.advance(secs(2));
        for device in 0..2 {
            let left = left_for(&replica, device, &ask);
            assert!(
                left.is_empty(),
                "{ask}: answered in the CLI, still on device {device} 2 s later: {left:?}"
            );
        }
    }

    fn planted_scope_the_notifier_on_main_fails_each_withdrawal() {
        for (what, scenario) in [
            (
                "superseded",
                superseded_scenario as fn(Replica) -> Result<(), String>,
            ),
            ("moot", moot_scenario),
            ("past its deadline", deadline_scenario),
        ] {
            let failure = scenario(wrong(&fixture(RECORD), Wrong::NeverWithdraws))
                .expect_err("the withdrawal judge passed the notifier on main");
            assert!(
                failure.contains("ask:"),
                "{what}: the failure names no ask: {failure}"
            );
        }
    }

    // ---- Scope: only a change you could have seen notifies.

    fn seen_on_screen_scenario(mut replica: Replica) -> (String, Result<(), String>) {
        replica.focus(0, Some(S1));
        let ask = raise(&mut replica, S1);
        replica.advance(secs(2));
        let posts = posts_for(&replica, &ask);
        assert!(
            posts.is_empty(),
            "setup: {ask}, from the session on screen, should not notify: {posts:?}"
        );
        let result = restarts(replica, &ask, 0, true);
        (ask, result)
    }

    fn scope_an_ask_you_saw_on_screen_posts_nothing_after_restarts_or_a_reconnect() {
        holds(seen_on_screen_scenario(Replica::open(&fixture(RECORD))).1);
    }

    fn scope_an_ask_that_notified_posts_nothing_after_a_channel_reconnect() {
        let mut replica = Replica::open(&fixture(RECORD));
        let ask = raise(&mut replica, S1);
        replica.advance(secs(2));
        let posts = posts_for(&replica, &ask);
        assert_eq!(posts.len(), 1, "setup: {ask} should notify once: {posts:?}");
        let first = posts[0].at;
        reconnect(&mut replica);
        replica.advance(secs(5));
        let posts = again(&replica, &ask, first);
        assert!(
            posts.is_empty(),
            "{ask}: posted again after a channel reconnected: {posts:?}"
        );
        holds(restarts(replica, &ask, first, true));
    }

    fn planted_scope_queueing_on_start_fails_an_ask_you_saw_on_screen() {
        let (ask, result) =
            seen_on_screen_scenario(wrong(&fixture(RECORD), Wrong::QueuesOpenAsksOnStart));
        let failure =
            result.expect_err("the judge passed a notifier that queues every open ask on start");
        assert!(
            failure.contains(&ask),
            "the failure doesn't name the ask {ask}: {failure}"
        );
    }

    // ---- Scope: the title names DeepBuild and the session's task.

    fn scope_the_title_names_deepbuild_and_the_sessions_task() {
        let mut replica = Replica::open(&fixture(RECORD));
        let asks = [
            (raise(&mut replica, S1), TASK1),
            (raise(&mut replica, S2), TASK2),
        ];
        replica.advance(secs(2));
        for (ask, task) in asks {
            let posts = posts_for(&replica, &ask);
            assert_eq!(posts.len(), 1, "setup: {ask} should notify once: {posts:?}");
            let title = title(&posts[0]);
            assert!(
                title.contains("DeepBuild"),
                "{ask}: the title doesn't name DeepBuild: {title:?}"
            );
            assert!(
                title.contains(task),
                "{ask}: the title doesn't name the session's task, {task:?}: {title:?}"
            );
        }
    }

    // ---- The harness: libtest's result lines, every case on the main thread.

    pub fn run() -> i32 {
        let mut cases: Vec<(&str, fn())> = vec![
            (
                "ac1_an_ask_answered_in_the_cli_leaves_notification_center_within_2_s",
                ac1_an_ask_answered_in_the_cli_leaves_notification_center_within_2_s,
            ),
            (
                "ac2_two_asks_from_one_session_30_s_apart_leave_one_the_seconds",
                ac2_two_asks_from_one_session_30_s_apart_leave_one_the_seconds,
            ),
            (
                "ac2_two_asks_from_two_sessions_leave_two",
                ac2_two_asks_from_two_sessions_leave_two,
            ),
            (
                "ac3_a_default_at_16_40_today_reads_at_16_40",
                ac3_a_default_at_16_40_today_reads_at_16_40,
            ),
            (
                "ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40",
                ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40,
            ),
            (
                "ac4_quitting_and_reopening_the_app_then_restarting_the_hub_posts_nothing_again",
                ac4_quitting_and_reopening_the_app_then_restarting_the_hub_posts_nothing_again,
            ),
            (
                "scope_withdrawn_when_superseded",
                scope_withdrawn_when_superseded,
            ),
            ("scope_withdrawn_when_moot", scope_withdrawn_when_moot),
            (
                "scope_withdrawn_when_its_deadline_passes",
                scope_withdrawn_when_its_deadline_passes,
            ),
            (
                "scope_withdrawn_from_every_device",
                scope_withdrawn_from_every_device,
            ),
            (
                "scope_an_ask_you_saw_on_screen_posts_nothing_after_restarts_or_a_reconnect",
                scope_an_ask_you_saw_on_screen_posts_nothing_after_restarts_or_a_reconnect,
            ),
            (
                "scope_an_ask_that_notified_posts_nothing_after_a_channel_reconnect",
                scope_an_ask_that_notified_posts_nothing_after_a_channel_reconnect,
            ),
            (
                "scope_the_title_names_deepbuild_and_the_sessions_task",
                scope_the_title_names_deepbuild_and_the_sessions_task,
            ),
            (
                "planted_ac1_the_notifier_on_main_leaves_it_and_fails_naming_the_ask",
                planted_ac1_the_notifier_on_main_leaves_it_and_fails_naming_the_ask,
            ),
            (
                "planted_ac2_the_notifier_on_main_leaves_both_of_one_sessions_asks",
                planted_ac2_the_notifier_on_main_leaves_both_of_one_sessions_asks,
            ),
            (
                "planted_ac3_a_text_with_in_2_h_fails",
                planted_ac3_a_text_with_in_2_h_fails,
            ),
            (
                "planted_ac4_a_notifier_that_queues_every_open_ask_on_start_fails_naming_the_ask",
                planted_ac4_a_notifier_that_queues_every_open_ask_on_start_fails_naming_the_ask,
            ),
            (
                "planted_scope_the_notifier_on_main_fails_each_withdrawal",
                planted_scope_the_notifier_on_main_fails_each_withdrawal,
            ),
            (
                "planted_scope_queueing_on_start_fails_an_ask_you_saw_on_screen",
                planted_scope_queueing_on_start_fails_an_ask_you_saw_on_screen,
            ),
        ];

        // As libtest does, a positional argument narrows the run to the cases whose names hold it.
        let filter = std::env::args().skip(1).find(|arg| !arg.starts_with('-'));
        cases.retain(|(name, _)| filter.as_deref().is_none_or(|filter| name.contains(filter)));
        if cases.is_empty() {
            // A filter that names nothing ran nothing, and nothing unrun passes.
            println!(
                "\ntest result: INCONCLUSIVE. the filter {:?} names no test; nothing ran",
                filter.unwrap_or_default()
            );
            return 1;
        }
        println!("\nrunning {} tests", cases.len());
        let mut failed = 0;
        for (name, case) in &cases {
            let ok = std::panic::catch_unwind(*case).is_ok();
            println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
            failed += usize::from(!ok);
        }
        println!(
            "\ntest result: {}. {} passed; {failed} failed",
            if failed == 0 { "ok" } else { "FAILED" },
            cases.len() - failed
        );
        i32::from(failed > 0)
    }
}
