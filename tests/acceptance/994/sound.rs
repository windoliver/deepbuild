//! Issue #994, AC4 and the sound half of Scope: on the replica's virtual clock, through the notifier the app runs.
//! Written blind from the issue, docs/technical-design.md and the base commit 58862789. It uses no new surface, so it
//! compiles and runs on the merge base, where it fails on ten sounds (README: The base).
//!
//!   AC4 #994.857c4868  ten asks across four sessions coming due in one tick play one sound and leave four notifications
//!   Scope            asks due within 2 s of each other share one sound; an ask due later plays its own
//!
//! `cargo test --locked -p deep-replica --test acceptance_994_sound`. No libtest harness, as the replica's suites.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the suite is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!(
            "acceptance_994_sound: INCONCLUSIVE; the replica runs on macOS only, so nothing ran"
        );
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
#[path = "common.rs"]
mod common;

#[cfg(target_os = "macos")]
mod suite {
    use std::time::Duration;

    use deep_replica::{Posted, Replica};

    use super::common::{raise, record, secs, SESSIONS};

    fn sounds(replica: &Replica) -> Vec<Posted> {
        replica
            .notifications()
            .into_iter()
            .filter(|posted| posted.sound.is_some())
            .collect()
    }

    fn ac4_ten_asks_across_four_sessions_in_one_tick_play_one_sound_and_leave_four_notifications() {
        let mut replica = Replica::open(&record());
        for n in 0..10 {
            raise(&mut replica, SESSIONS[n % SESSIONS.len()]);
        }
        replica.advance(secs(3));
        assert_eq!(
            replica.open_asks().len(),
            10,
            "setup: the ten asks should all be open"
        );
        let played = sounds(&replica);
        assert_eq!(
            played.len(),
            1,
            "ten asks coming due in one tick should play one sound; they played {}, with {:?}",
            played.len(),
            played
                .iter()
                .filter_map(|posted| posted.ask.as_deref())
                .collect::<Vec<_>>()
        );
        let held = replica.delivered(0);
        let mut sessions: Vec<&str> = held.iter().map(|posted| posted.session.as_str()).collect();
        sessions.sort();
        sessions.dedup();
        assert_eq!(
            (held.len(), sessions.len()),
            (4, 4),
            "four sessions should leave four notifications, one each: {held:?}"
        );
    }

    fn scope_asks_due_within_2_s_share_one_sound_and_a_later_ask_plays_its_own() {
        let mut replica = Replica::open(&record());
        let first = raise(&mut replica, SESSIONS[0]);
        replica.advance(Duration::from_millis(1_500));
        let second = raise(&mut replica, SESSIONS[1]);
        replica.advance(Duration::from_millis(3_500));
        let third = raise(&mut replica, SESSIONS[2]);
        replica.advance(secs(2));
        let played: Vec<Option<String>> = sounds(&replica)
            .into_iter()
            .map(|posted| posted.ask)
            .collect();
        assert!(
            played.len() == 2 && played[1].as_deref() == Some(third.handle.as_str()),
            "{} and {} come due 1.5 s apart and share one sound, and {}, due 3.5 s later, plays its own; the sounds \
             came with {played:?}",
            first.handle,
            second.handle,
            third.handle
        );
    }

    pub fn run() -> i32 {
        super::common::run(vec![
            (
                "ac4_ten_asks_across_four_sessions_in_one_tick_play_one_sound_and_leave_four_notifications",
                ac4_ten_asks_across_four_sessions_in_one_tick_play_one_sound_and_leave_four_notifications,
            ),
            (
                "scope_asks_due_within_2_s_share_one_sound_and_a_later_ask_plays_its_own",
                scope_asks_due_within_2_s_share_one_sound_and_a_later_ask_plays_its_own,
            ),
        ])
    }
}
