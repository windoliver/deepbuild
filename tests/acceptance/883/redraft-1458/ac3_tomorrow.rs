//! Issue #883 AC3, its tomorrow case, redrafted blind for #1458's "One way to write a time": a notification whose
//! default applies at 16:40 tomorrow names that moment as "tomorrow 16:40". It never says "in 2 h" or "tomorrow at
//! 16:40". Replaces `ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40` in ../notifications.rs once swapped in;
//! the today case and the "in 2 h" plant stay there. README.md in this folder maps old test, new test and criterion.
//!
//! Wired into deep-replica by one `[[test]]` entry in crates/deep-replica/Cargo.toml (`acceptance_883_ac3_redraft`,
//! `harness = false`). As ../notifications.rs, it has no libtest harness: every case runs on the main thread and it
//! prints libtest's result lines. The fixtures, the fixed zone and the fixed clock are ../notifications.rs's.

/// The time zone every case runs in, as ../notifications.rs fixes it. On `NOW` (2027-01-15 08:00 UTC) it is 09:00, CET.
const TIME_ZONE: &str = "Europe/Berlin";

fn main() {
    // Before any thread or the app starts: the app reads "your time zone" from the OS, which honours TZ.
    std::env::set_var("TZ", TIME_ZONE);
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the case is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_883_ac3_redraft: INCONCLUSIVE; the replica runs on macOS only, so the case didn't run");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::path::PathBuf;
    use std::time::Duration;

    use deep_replica::{repo_root, Replica, NOW};
    use serde_json::{json, Value};

    // ---- ../notifications.rs's fixture and clock, unchanged.

    /// Two sessions, each with a task, and nothing asked yet.
    const RECORD: &str = "two-sessions.events.jsonl";
    const S1: &str = "01MD883SESS000000000000S01";

    /// 14:40 in Berlin on NOW's day, as ms past NOW; 16:40 the next day, 2027-01-16, as epoch ms.
    const TO_14_40: u64 = 20_400_000;
    const TOMORROW_16_40: u64 = 1_800_114_000_000;

    /// The moment as #1458 writes it on another day, and the two forms the amended criterion forbids.
    const WANT: &str = "tomorrow 16:40";
    const OLD_FORM: &str = "tomorrow at 16:40";
    const RELATIVE: &str = "in 2 h";

    fn fixture(name: &str) -> PathBuf {
        repo_root().join("tests/acceptance/883/fixtures").join(name)
    }

    /// live.json's `ask.created@4` template: an authority ask in S1 whose default "No" applies at `deadline`.
    fn raise_until(replica: &mut Replica, deadline: u64) -> String {
        let path = fixture("live.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let all: Value = serde_json::from_str(&text).expect("live.json is JSON");
        let mut event = all["ask.created"].clone();
        assert!(event.is_object(), "live.json has no ask.created template");
        // ULID-shaped, in the redraft's own range, never one the fixtures or ../notifications.rs use.
        let id = "01MD8839R00000000000000001";
        event["id"] = json!(id);
        event["ts"] = json!(replica.now());
        event["data"]["deadline"] = json!(deadline);
        event["data"]["question"] = json!("Push feat/cart to origin?");
        event["data"]["key"] = json!(format!("{:064x}", 0x1458));
        replica.append(S1, event);
        format!("ask:{id}")
    }

    /// The case's own premise: `at` is 16:40 on the day after the clock's 14:40, in the fixed zone.
    fn premise_tomorrow_16_40(at: u64, now: u64) {
        let local = |ms: u64, format: &str| {
            let out = std::process::Command::new("date")
                .env("TZ", super::TIME_ZONE)
                .args(["-r", &(ms / 1000).to_string(), format])
                .output()
                .expect("date runs");
            String::from_utf8_lossy(&out.stdout).trim().to_owned()
        };
        assert_eq!(
            (local(now, "+%Y-%m-%d %H:%M"), local(at, "+%Y-%m-%d %H:%M")),
            ("2027-01-15 14:40".to_owned(), "2027-01-16 16:40".to_owned()),
            "premise: the clock at 14:40 and the default at 16:40 the next day, in {}",
            super::TIME_ZONE
        );
    }

    /// The judge: what the notification's text must say of when its default applies. A failure says which rule broke.
    fn reads_tomorrow_16_40(text: &str) -> Result<(), String> {
        if text.contains(OLD_FORM) {
            return Err(format!(
                "the default's moment reads {OLD_FORM:?}, the form #1458 replaces, not {WANT:?}: {text:?}"
            ));
        }
        if text.contains(RELATIVE) {
            return Err(format!(
                "the default's moment reads {RELATIVE:?}, a length, not {WANT:?}: {text:?}"
            ));
        }
        let Some(at) = text.find(WANT) else {
            return Err(format!(
                "the default's moment should read {WANT:?}: {text:?}"
            ));
        };
        // "tomorrow 16:40" and no more: not a seconds field or a longer number after it.
        let next = text[at + WANT.len()..].chars().next();
        if next.is_some_and(|c| c == ':' || c.is_ascii_digit()) {
            return Err(format!(
                "the default's moment runs on past {WANT:?}: {text:?}"
            ));
        }
        Ok(())
    }

    fn holds(result: Result<(), String>) {
        if let Err(failure) = result {
            panic!("{failure}");
        }
    }

    /// At 14:40 local an ask is raised whose default applies at 16:40 tomorrow; answers its one notification's text.
    fn text_for_tomorrow_16_40() -> String {
        let mut replica = Replica::open(&fixture(RECORD));
        replica.advance(Duration::from_millis(TO_14_40));
        assert_eq!(replica.now(), NOW + TO_14_40, "setup: the clock at 14:40");
        premise_tomorrow_16_40(TOMORROW_16_40, replica.now());
        let ask = raise_until(&mut replica, TOMORROW_16_40);
        replica.advance(Duration::from_secs(2));
        let posts: Vec<_> = replica
            .notifications()
            .into_iter()
            .filter(|posted| posted.ask.as_deref() == Some(ask.as_str()))
            .collect();
        assert_eq!(
            posts.len(),
            1,
            "setup: {ask} should notify once: {:?}",
            replica.notifications()
        );
        posts[0].text.clone()
    }

    fn ac3_a_default_at_16_40_tomorrow_reads_tomorrow_16_40() {
        holds(reads_tomorrow_16_40(&text_for_tomorrow_16_40()));
    }

    fn planted_ac3_the_judge_fails_each_forbidden_form_and_passes_the_right_one() {
        // The wrong programs, as text: the base's form, a relative length, and a moment with seconds.
        for (planted, why) in [
            ("If you don't answer: No, tomorrow at 16:40.", OLD_FORM),
            ("If you don't answer: No, in 2 h.", RELATIVE),
            ("If you don't answer: No, tomorrow 16:40:00.", "runs on"),
        ] {
            let failure = reads_tomorrow_16_40(planted)
                .expect_err("AC3's redraft judge passed a forbidden form");
            assert!(
                failure.contains(why),
                "AC3's redraft failure doesn't say why ({why}): {failure}"
            );
        }
        // The control: the judge passes #1458's own form, so it fails the others for what they say.
        holds(reads_tomorrow_16_40(
            "DeepBuild · Cart totals\nneeds you — Push feat/cart to origin? If you don't answer: No, tomorrow 16:40.",
        ));
    }

    // ---- The harness: libtest's result lines, every case on the main thread.

    pub fn run() -> i32 {
        let mut cases: Vec<(&str, fn())> = vec![
            (
                "ac3_a_default_at_16_40_tomorrow_reads_tomorrow_16_40",
                ac3_a_default_at_16_40_tomorrow_reads_tomorrow_16_40,
            ),
            (
                "planted_ac3_the_judge_fails_each_forbidden_form_and_passes_the_right_one",
                planted_ac3_the_judge_fails_each_forbidden_form_and_passes_the_right_one,
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
