//! Issue #326, criterion group "surfaces": notifications on the virtual clock (AC2, #326.47455776) and every row of
//! States people see on every surface (AC3, #326.6cfad91f), in the replica: the app headless on gpui's virtual clock.
//! Written blind, before any implementation; the surface it reaches is pinned in this folder's README.md.
//!
//! Wired into deep-replica by one `[[test]]` entry in crates/deep-replica/Cargo.toml:
//!     [[test]]
//!     name = "acceptance_326_surfaces"
//!     path = "../../tests/acceptance/326/surfaces/surfaces.rs"
//!     harness = false
//! and run from the checkout with `cargo test --locked -p deep-replica --test acceptance_326_surfaces`. Like the
//! replica's own suite (crates/deep-replica/headless.rs), it runs without the libtest harness, every case on the main
//! thread, and prints libtest's result lines; a positional argument narrows the run to the cases whose names hold it.
//!
//! The checks that judge what a surface shows and what the notifier did are the tests' own (below), and each is also
//! asked of the implementation's kits, `deep_replica::kit::notifications` and `deep_replica::kit::states`, which must
//! pass the app and fail the planted wrong programs, naming the ask, or the surface and the row.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    // Unrun is not passed: off macOS the suite is INCONCLUSIVE, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_326_surfaces: INCONCLUSIVE; the replica runs on macOS only, so none of #326's surface checks ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::cell::Cell;
    use std::path::PathBuf;
    use std::time::Duration;

    use deep_replica::snapshot::Snapshot;
    use deep_replica::{kit, repo_root, Notifier, Posted, Replica, Seen, Sound, NOTIFY_AFTER, NOW};
    use serde_json::{json, Value};

    // ---- The fixtures (fixtures/, README: Fixtures).

    /// The notifier's base record: two sessions, each with a task, and nothing asked yet.
    const NOTIFY: &str = "notify.events.jsonl";
    const S1: &str = "01MD326SESS000000000000N01";
    const S2: &str = "01MD326SESS000000000000N02";
    const T1: &str = "task:01MD326TASK00000000000N01";
    const T2: &str = "task:01MD326TASK00000000000N02";
    /// What every ask the tests raise asks, and the label of its default option.
    const QUESTION: &str = "Create a registry token for the publish check?";
    const DEFAULT_LABEL: &str = "Leave it blocked";

    /// The surfaces of States people see that the criterion names, by the ids `Seen.surface` uses.
    const SURFACES: [&str; 6] = [
        "sidebar-row",
        "line",
        "return-card",
        "verdict-line",
        "menu-bar",
        "notification",
    ];

    fn fixture(name: &str) -> PathBuf {
        repo_root()
            .join("tests/acceptance/326/surfaces/fixtures")
            .join(name)
    }

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    // ---- Events the notifier tests append live, from fixtures/live.json's templates.

    thread_local! {
        static NEXT: Cell<u64> = const { Cell::new(1) };
    }

    /// A fresh event ID: a ULID-shaped string of digits, never one the fixtures use.
    fn next_id() -> String {
        NEXT.with(|next| {
            let n = next.get();
            next.set(n + 1);
            format!("01MD3269{n:018}")
        })
    }

    fn live(kind: &str) -> Value {
        let path = fixture("live.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let all: Value = serde_json::from_str(&text).expect("live.json is JSON");
        let mut event = all
            .get(kind)
            .cloned()
            .unwrap_or_else(|| panic!("live.json has no {kind} template"));
        event["id"] = json!(next_id());
        event
    }

    fn stamped(mut event: Value, replica: &Replica) -> Value {
        event["ts"] = json!(replica.now());
        if event.get("seq").is_some() {
            event["seq"] = json!(format!("{}000000", replica.now()));
        }
        event
    }

    /// Raises an ask in `session` now; answers its handle, `ask:<id>`.
    fn raise(replica: &mut Replica, session: &str, task: &str) -> String {
        let mut event = stamped(live("ask.created"), replica);
        event["data"]["deadline"] = json!(replica.now() + 2 * 86_400_000);
        event["data"]["unblocks"] = json!([task]);
        let handle = format!("ask:{}", event["id"].as_str().unwrap());
        replica.append(session, event);
        handle
    }

    fn answer(replica: &mut Replica, session: &str, ask: &str) {
        let mut event = stamped(live("ask.answered"), replica);
        event["subject"] = json!(ask);
        replica.append(session, event);
    }

    /// Finished work in `session`: a stop, its claim, one passing run and a PASS verdict. Answers the verdict's handle.
    fn finish(replica: &mut Replica, session: &str, task: &str) -> String {
        let claim = format!("claim:{}", next_id());
        let run = format!("run:{}", next_id());
        let verdict = format!("verdict:{}", next_id());
        let mut stop = stamped(live("agent.stop"), replica);
        stop["subject"] = json!(format!("session:{session}"));
        let mut made = stamped(live("claim.made"), replica);
        made["id"] = json!(&claim["claim:".len()..]);
        made["data"]["task_ref"] = json!(task);
        let mut started = stamped(live("run.started"), replica);
        started["data"]["run"] = json!(run);
        started["data"]["claim"] = json!(claim);
        let mut finished = stamped(live("run.finished"), replica);
        finished["data"]["run"] = json!(run);
        let mut judged = stamped(live("verdict.made"), replica);
        judged["data"]["verdict"] = json!(verdict);
        judged["data"]["claim"] = json!(claim);
        if let Some(requirements) = judged["data"]["requirements"].as_array_mut() {
            for requirement in requirements {
                requirement["runs"]["counted"] = json!([run]);
            }
        }
        for event in [stop, made, started, finished, judged] {
            replica.append(session, event);
        }
        verdict
    }

    fn posts_for(replica: &Replica, ask: &str) -> Vec<Posted> {
        replica
            .notifications()
            .into_iter()
            .filter(|posted| posted.ask.as_deref() == Some(ask))
            .collect()
    }

    fn kit_passes(replica: &Replica, what: &str) {
        let verdict = kit::notifications(replica);
        assert!(
            verdict.pass,
            "{what}: the notifications kit failed the app's own notifier, naming {:?}; it posted {:?}",
            verdict.names,
            replica.notifications()
        );
    }

    // ---- AC2 (#326.47455776): notifications on a virtual clock.

    fn ac2_an_ask_answered_0_9_s_after_it_shows_fires_no_notification() {
        let mut replica = Replica::open(&fixture(NOTIFY));
        let ask = raise(&mut replica, S1, T1);
        replica.advance(ms(900));
        let posts = posts_for(&replica, &ask);
        assert!(
            posts.is_empty(),
            "{ask} notified within 0.9 s of showing: {posts:?}"
        );
        answer(&mut replica, S1, &ask);
        replica.advance(ms(100));
        replica.advance(ms(5_000));
        let posts = posts_for(&replica, &ask);
        assert!(
            posts.is_empty(),
            "{ask}, answered 0.9 s after it showed, fired a notification: {posts:?}"
        );
        kit_passes(&replica, "an ask answered at 0.9 s");
    }

    fn ac2_an_ask_still_open_1_s_after_it_shows_fires_exactly_one() {
        let mut replica = Replica::open(&fixture(NOTIFY));
        let shown = replica.now();
        let ask = raise(&mut replica, S1, T1);
        replica.advance(ms(999));
        let posts = posts_for(&replica, &ask);
        assert!(
            posts.is_empty(),
            "{ask} notified 0.999 s after it showed, before the state had held a second: {posts:?}"
        );
        replica.advance(ms(1));
        let posts = posts_for(&replica, &ask);
        assert_eq!(
            posts.len(),
            1,
            "{ask}, still open 1 s after it showed, fired {} notifications: {posts:?}",
            posts.len()
        );
        replica.advance(ms(10_000));
        let posts = posts_for(&replica, &ask);
        assert_eq!(
            posts.len(),
            1,
            "{ask} fired {} notifications by 11 s: {posts:?}",
            posts.len()
        );
        let posted = &posts[0];
        assert!(
            posted.at >= shown + 1_000,
            "{ask} was posted at {} ms, {} ms after it showed",
            posted.at,
            posted.at.saturating_sub(shown)
        );
        // Scope: a notification carries the ask's question and its default, and a question sounds like one.
        assert!(
            posted.text.contains(QUESTION),
            "the notification doesn't carry the question: {posted:?}"
        );
        assert!(
            posted.text.contains(DEFAULT_LABEL),
            "the notification doesn't carry the default, {DEFAULT_LABEL:?}: {posted:?}"
        );
        assert_eq!(
            posted.sound,
            Some(Sound::Question),
            "a question's notification: {posted:?}"
        );
        kit_passes(&replica, "an ask still open at 1 s");
    }

    fn ac2_an_ask_from_the_session_open_in_the_focused_window_fires_none() {
        let mut replica = Replica::open(&fixture(NOTIFY));
        replica.focus(0, Some(S1));
        let looked_at = raise(&mut replica, S1, T1);
        let elsewhere = raise(&mut replica, S2, T2);
        replica.advance(ms(2_000));
        let posts = posts_for(&replica, &looked_at);
        assert!(
            posts.is_empty(),
            "{looked_at}, from the session whose page is open in the focused window, fired a notification: {posts:?}"
        );
        // The positive control: the other session's ask, raised at the same moment, still notifies once.
        assert_eq!(
            posts_for(&replica, &elsewhere).len(),
            1,
            "{elsewhere}, from a session nobody is looking at, should fire exactly one: {:?}",
            replica.notifications()
        );
        kit_passes(&replica, "a focused session");
    }

    /// The criterion's wrong program: a notifier that posts the moment an ask shows.
    fn fires_at_once() -> Notifier {
        Notifier::new(Duration::ZERO)
    }

    fn ac2_a_notifier_that_fires_at_once_fails_naming_the_ask() {
        // The app's notifier waits the second the design gives it; the planted one waits nothing.
        assert_eq!(
            NOTIFY_AFTER,
            Duration::from_secs(1),
            "the app's notifier waits a second"
        );
        for answered in [true, false] {
            let what = if answered {
                "answered at 0.9 s"
            } else {
                "still open"
            };
            let mut replica = Replica::with_notifier(&fixture(NOTIFY), fires_at_once());
            let shown = replica.now();
            let ask = raise(&mut replica, S1, T1);
            replica.advance(ms(900));
            if answered {
                answer(&mut replica, S1, &ask);
            }
            replica.advance(ms(2_000));
            // The planted program is the wrong one: it posted before the state had held a second.
            let posts = posts_for(&replica, &ask);
            assert!(
                posts.iter().any(|posted| posted.at < shown + 1_000),
                "{what}: the planted notifier didn't fire at once: {posts:?}"
            );
            let verdict = kit::notifications(&replica);
            assert!(
                !verdict.pass,
                "{what}: the notifications kit passed a notifier that fires at once ({posts:?})"
            );
            let names = verdict.names.unwrap_or_default();
            assert!(
                names.contains(&ask),
                "{what}: the kit's failure names {names:?}, not the ask it notified at once, {ask}"
            );
        }
    }

    fn ac2_finished_work_makes_no_sound_and_never_sounds_like_a_question() {
        let mut replica = Replica::open(&fixture(NOTIFY));
        // You asked for a notice when S2's task gets its verdict; nothing like it for S1's.
        let mut subscribed = stamped(live("notice.subscribed"), &replica);
        subscribed["data"]["key"] = json!(T2);
        replica.append(S2, subscribed);
        let question = raise(&mut replica, S1, T1);
        finish(&mut replica, S1, T1);
        let verdict = finish(&mut replica, S2, T2);
        let mut sent = stamped(live("notice.sent"), &replica);
        sent["data"]["notice"] = json!(format!("notice:{}", next_id()));
        sent["data"]["cites"] = json!([verdict]);
        replica.append(S2, sent);
        replica.advance(ms(2_000));
        let all = replica.notifications();
        // The positive control: in the same run, a question does sound, as a question.
        let asked = posts_for(&replica, &question);
        assert_eq!(asked.len(), 1, "the question's notifications: {all:?}");
        assert_eq!(
            asked[0].sound,
            Some(Sound::Question),
            "the question's notification: {all:?}"
        );
        let work: Vec<&Posted> = all.iter().filter(|posted| posted.ask.is_none()).collect();
        assert!(
            work.iter().all(|posted| posted.session != S1),
            "finished work you asked no notice for notified you: {work:?}"
        );
        assert_eq!(
            work.iter().filter(|posted| posted.session == S2).count(),
            1,
            "the notice you asked for, on S2's verdict, should notify once: {all:?}"
        );
        for posted in &work {
            assert_ne!(
                posted.sound,
                Some(Sound::Question),
                "finished work sounded like a question: {posted:?}"
            );
            assert_eq!(posted.sound, None, "finished work made a sound: {posted:?}");
        }
    }

    fn ac2_only_one_device_plays_a_sound() {
        let mut replica = Replica::open_devices(&fixture(NOTIFY), 2);
        for (session, task) in [(S1, T1), (S2, T2)] {
            let ask = raise(&mut replica, session, task);
            replica.advance(ms(1_500));
            let posts = posts_for(&replica, &ask);
            assert!(
                !posts.is_empty(),
                "{ask} notified no device: {:?}",
                replica.notifications()
            );
            for device in 0..2 {
                assert!(
                    posts
                        .iter()
                        .filter(|posted| posted.device == device)
                        .count()
                        <= 1,
                    "device {device} notified {ask} more than once: {posts:?}"
                );
            }
            let sounding: Vec<&Posted> = posts
                .iter()
                .filter(|posted| posted.sound.is_some())
                .collect();
            assert_eq!(
                sounding.len(),
                1,
                "{} devices played a sound for {ask}: {posts:?}",
                sounding.len()
            );
            assert_eq!(sounding[0].sound, Some(Sound::Question), "{posts:?}");
        }
    }

    // ---- The issue's scope, in the replica: notifications open the ask's card and answer nothing; one count.

    fn scope_a_notification_opens_its_asks_card_and_answers_nothing() {
        let mut replica = Replica::open(&fixture(NOTIFY));
        let ask = raise(&mut replica, S1, T1);
        replica.advance(ms(1_000));
        let posts = posts_for(&replica, &ask);
        assert_eq!(posts.len(), 1, "{posts:?}");
        let count = replica.menu_bar(0);
        assert_eq!(count.trim(), "1", "the menu bar's count with one open ask");
        replica.click(&posts[0]);
        assert_eq!(
            replica.card(0).as_deref(),
            Some(ask.as_str()),
            "clicking the notification opens its ask's card"
        );
        assert_eq!(
            replica.menu_bar(0),
            count,
            "clicking the notification answered the ask"
        );
    }

    fn scope_one_count_the_same_on_every_device() {
        let mut replica = Replica::open_devices(&fixture(NOTIFY), 2);
        let _first = raise(&mut replica, S1, T1);
        let second = raise(&mut replica, S1, T1);
        let _third = raise(&mut replica, S2, T2);
        replica.advance(ms(10));
        for device in 0..2 {
            assert_eq!(
                replica.menu_bar(device).trim(),
                "3",
                "device {device}'s menu bar with three open asks"
            );
        }
        answer(&mut replica, S1, &second);
        replica.advance(ms(10));
        for device in 0..2 {
            assert_eq!(
                replica.menu_bar(device).trim(),
                "2",
                "device {device}'s menu bar after one answer"
            );
        }
    }

    // ---- AC3 (#326.6cfad91f): every row of States people see, on every surface.

    #[derive(Clone, Copy, Debug)]
    struct Row {
        /// The fixture record, fixtures/<file>.events.jsonl.
        file: &'static str,
        /// The word on every surface.
        word: &'static str,
        /// Its status-map entry.
        entry: &'static str,
        /// Never call it: these words never show for this row (whole words, any case).
        never: &'static [&'static str],
    }

    /// technical-design.md, States people see, row for row.
    const ROWS: [Row; 11] = [
        Row {
            file: "queued",
            word: "queued",
            entry: "idle",
            never: &[],
        },
        Row {
            file: "working",
            word: "working",
            entry: "running",
            never: &["in progress"],
        },
        Row {
            file: "says-done",
            word: "says done",
            entry: "running",
            never: &["done"],
        },
        Row {
            file: "pass",
            word: "PASS",
            entry: "pass",
            never: &["proven", "passed"],
        },
        Row {
            file: "sent-back",
            word: "sent back",
            entry: "fail",
            never: &["failed"],
        },
        Row {
            file: "blocked",
            word: "BLOCKED",
            entry: "blocked",
            never: &[],
        },
        Row {
            file: "invalid",
            word: "INVALID",
            entry: "invalid",
            never: &[],
        },
        Row {
            file: "inconclusive",
            word: "INCONCLUSIVE",
            entry: "inconclusive",
            never: &[],
        },
        Row {
            file: "needs-you",
            word: "needs you",
            entry: "needs_you",
            never: &["waiting on you"],
        },
        // "A view that shows PASS for a stale verdict ... fails."
        Row {
            file: "stale",
            word: "stale",
            entry: "stale",
            never: &["pass", "passed", "proven"],
        },
        Row {
            file: "quiet",
            word: "quiet",
            entry: "idle",
            never: &[],
        },
    ];

    fn row(file: &str) -> Row {
        *ROWS.iter().find(|row| row.file == file).expect("a row")
    }

    /// The glyph the clean look, the app's look, gives a status-map entry.
    fn glyph(entry: &str) -> String {
        let path = repo_root().join("crates/deep-canvas-marks/looks/clean.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let look: Value = serde_json::from_str(&text).expect("the clean look is JSON");
        look["status_treatment"]["glyph"][entry]
            .as_str()
            .unwrap_or_else(|| panic!("the clean look has no glyph for {entry}"))
            .to_owned()
    }

    /// Where `word` occurs in `text` as a whole word (no letter or digit on either side), case-insensitive.
    fn whole_words(text: &str, word: &str) -> Vec<usize> {
        let (text, word) = (text.to_lowercase(), word.to_lowercase());
        let alnum = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric());
        text.match_indices(&word)
            .map(|(at, _)| at)
            .filter(|&at| {
                !alnum(text[..at].chars().next_back())
                    && !alnum(text[at + word.len()..].chars().next())
            })
            .collect()
    }

    /// The row's word: exactly as the table writes it, or, for a lower-case word, with its first letter capitalized.
    fn shows_word(text: &str, word: &str) -> bool {
        let mut forms = vec![word.to_owned()];
        if word.chars().next().is_some_and(|c| c.is_lowercase()) {
            let mut chars = word.chars();
            let first = chars.next().unwrap().to_uppercase().collect::<String>();
            forms.push(first + chars.as_str());
        }
        forms.iter().any(|form| {
            text.match_indices(form.as_str()).any(|(at, _)| {
                let alnum = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric());
                !alnum(text[..at].chars().next_back())
                    && !alnum(text[at + form.len()..].chars().next())
            })
        })
    }

    /// `<n>` followed by `unit`, spaces aside, with no digit before `<n>`: "4 min", "4min", "2 h", "2h", "2 hours".
    fn shows_amount(text: &str, n: &str, unit: &str) -> bool {
        let compact: String = text
            .to_lowercase()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let needle = format!("{n}{unit}");
        compact.match_indices(&needle).any(|(at, _)| {
            !compact[..at]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_digit())
        })
    }

    /// The row's extra, where the criterion names one.
    fn extra(row: &Row, text: &str) -> Result<(), String> {
        match row.file {
            // "sent back with its round, 'sent back 1 of 3'"
            "sent-back" if !shows_word(text, "sent back 1 of 3") => {
                Err("it doesn't show the round, \"sent back 1 of 3\"".into())
            }
            // "says done with the checks' expected time": `unit` took 4 minutes on each of its three clean runs.
            "says-done" if !shows_amount(text, "4", "min") => {
                Err("it doesn't show the checks' expected time, 4 min".into())
            }
            // "quiet with when it was last seen": two hours before the virtual clock's now.
            "quiet" => {
                let lower = text.to_lowercase();
                match lower.find("last seen") {
                    Some(at)
                        if shows_amount(
                            &lower[at + "last seen".len()..]
                                .chars()
                                .take(16)
                                .collect::<String>(),
                            "2",
                            "h",
                        ) =>
                    {
                        Ok(())
                    }
                    _ => Err("it doesn't show when it was last seen, 2 h ago".into()),
                }
            }
            _ => Ok(()),
        }
    }

    /// Words the row must never show, including "done" except as "says done".
    fn never_shown(row: &Row, text: &str) -> Result<(), String> {
        for word in row.never {
            let mut at = whole_words(text, word);
            if *word == "done" {
                let lower = text.to_lowercase();
                at.retain(|&at| !lower[..at].ends_with("says "));
            }
            if !at.is_empty() {
                return Err(format!("it shows {word:?}, which never names this state"));
            }
        }
        Ok(())
    }

    /// The tests' own check of one surface's text snapshot and drawn status entry against the row.
    fn judge(row: &Row, seen: &Seen) -> Result<(), String> {
        let fail = |why: String| {
            Err(format!(
                "{}, row {:?}: {why}; it shows {:?}",
                seen.surface, row.word, seen.text
            ))
        };
        if !shows_word(&seen.text, row.word) {
            return fail(format!("the word {:?} isn't shown", row.word));
        }
        if let Err(why) = extra(row, &seen.text).and_then(|()| never_shown(row, &seen.text)) {
            return fail(why);
        }
        if seen.entry != row.entry {
            return fail(format!(
                "its status mark draws the entry {:?}, not {:?}",
                seen.entry, row.entry
            ));
        }
        let want = glyph(row.entry);
        if seen.glyph != want {
            return fail(format!(
                "its status mark draws the glyph {:?}, not {want:?}, the look's for {}",
                seen.glyph, row.entry
            ));
        }
        Ok(())
    }

    /// The window the replica drew: the row's word and glyph are in its text snapshot (an accessible node's name or
    /// value, or a canvas item's value), and none of the words that never name the row are.
    fn judge_window(row: &Row, window: &Snapshot) -> Result<(), String> {
        let mut texts: Vec<String> = Vec::new();
        for node in window.flatten() {
            texts.extend(node.name.clone());
            texts.extend(node.value.as_ref().map(|value| match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            }));
        }
        texts.extend(window.items.iter().map(|(_, value)| value.to_string()));
        if !texts.iter().any(|text| shows_word(text, row.word)) {
            return Err(format!(
                "row {:?}: the window's snapshot never shows the word",
                row.word
            ));
        }
        let want = glyph(row.entry);
        if !texts.iter().any(|text| text.contains(&want)) {
            return Err(format!(
                "row {:?}: the window's snapshot never draws {want:?}, the look's glyph for {}",
                row.word, row.entry
            ));
        }
        for text in &texts {
            never_shown(row, text)
                .map_err(|why| format!("row {:?}: in the window, {text:?}: {why}", row.word))?;
        }
        Ok(())
    }

    fn surfaces_of(row: &Row) -> (Replica, Vec<Seen>) {
        let mut replica = Replica::open(&fixture(&format!("{}.events.jsonl", row.file)));
        assert_eq!(
            replica.now(),
            NOW,
            "the replica's virtual clock starts at deep_replica::NOW, which the fixtures' times are written against"
        );
        let seen = replica.surfaces();
        for surface in SURFACES {
            let n = seen.iter().filter(|seen| seen.surface == surface).count();
            assert_eq!(
                n, 1,
                "row {:?}: the replica read {n} {surface} snapshots: {seen:?}",
                row.word
            );
        }
        (replica, seen)
    }

    fn ac3_row_on_every_surface(file: &str) {
        let row = row(file);
        let (mut replica, seen) = surfaces_of(&row);
        let mut failures: Vec<String> = seen
            .iter()
            .filter_map(|seen| judge(&row, seen).err())
            .collect();
        if let Err(why) = judge_window(&row, &replica.window()) {
            failures.push(why);
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
        let verdict = kit::states(row.word, &seen);
        assert!(
            verdict.pass,
            "row {:?}: the states kit failed the app's own surfaces, naming {:?}",
            row.word, verdict.names
        );
    }

    /// `seen` with the snapshot of `surface` changed by `plant`: what a wrong view there would show.
    fn planted(seen: &[Seen], surface: &str, plant: impl Fn(&mut Seen)) -> Vec<Seen> {
        seen.iter()
            .cloned()
            .map(|mut seen| {
                if seen.surface == surface {
                    plant(&mut seen);
                }
                seen
            })
            .collect()
    }

    /// The planted view fails the tests' own check and the states kit, which names the surface and the row.
    fn fails_naming(row: &Row, surface: &str, view: &str, planted: &[Seen]) {
        let wrong = planted.iter().find(|seen| seen.surface == surface).unwrap();
        assert!(
            judge(row, wrong).is_err(),
            "the tests' own check passed {view} on the {surface}: {wrong:?}"
        );
        let verdict = kit::states(row.word, planted);
        assert!(
            !verdict.pass,
            "the states kit passed {view} on the {surface}: {wrong:?}"
        );
        let names = verdict.names.unwrap_or_default();
        assert!(
            names.contains(surface) && names.contains(row.word),
            "the states kit failed {view} on the {surface} naming {names:?}, not the surface and the row {:?}",
            row.word
        );
    }

    fn ac3_a_view_that_shows_pass_for_a_stale_verdict_fails_naming_the_surface_and_the_row() {
        let row = row("stale");
        let (_replica, seen) = surfaces_of(&row);
        for surface in SURFACES {
            let in_place = planted(&seen, surface, |seen| {
                seen.text = seen.text.replace("stale", "PASS").replace("Stale", "PASS");
                seen.entry = "pass".into();
                seen.glyph = glyph("pass");
            });
            fails_naming(
                &row,
                surface,
                "a view showing PASS in place of stale",
                &in_place,
            );
            let beside = planted(&seen, surface, |seen| seen.text.push_str(" · PASS"));
            fails_naming(&row, surface, "a view showing PASS beside stale", &beside);
        }
    }

    fn ac3_a_view_that_shows_done_for_says_done_fails_naming_the_surface_and_the_row() {
        let row = row("says-done");
        let (_replica, seen) = surfaces_of(&row);
        for surface in SURFACES {
            let done = planted(&seen, surface, |seen| {
                seen.text = seen
                    .text
                    .replace("says done", "done")
                    .replace("Says done", "Done");
            });
            let before = &seen
                .iter()
                .find(|seen| seen.surface == surface)
                .unwrap()
                .text;
            let after = &done
                .iter()
                .find(|seen| seen.surface == surface)
                .unwrap()
                .text;
            assert_ne!(
                before, after,
                "the {surface} of the says done row doesn't show \"says done\": {before:?}"
            );
            fails_naming(&row, surface, "a view showing done for says done", &done);
        }
    }

    fn ac3_a_view_that_draws_another_rows_status_entry_fails_naming_the_surface_and_the_row() {
        for row in ROWS {
            let (_replica, seen) = surfaces_of(&row);
            // The next entry in the status map's order that isn't this row's.
            let entries = [
                "pass",
                "fail",
                "invalid",
                "blocked",
                "inconclusive",
                "running",
                "needs_you",
                "stale",
                "idle",
            ];
            let at = entries
                .iter()
                .position(|entry| *entry == row.entry)
                .unwrap();
            let other = entries[(at + 1) % entries.len()];
            for surface in SURFACES {
                let wrong = planted(&seen, surface, |seen| {
                    seen.entry = other.into();
                    seen.glyph = glyph(other);
                });
                fails_naming(
                    &row,
                    surface,
                    &format!("a view drawing the {other} entry"),
                    &wrong,
                );
            }
        }
    }

    // ---- The harness: libtest's result lines, every case on the main thread.

    pub fn run() -> i32 {
        let mut cases: Vec<(String, Box<dyn Fn()>)> = vec![
            (
                "ac2_an_ask_answered_0_9_s_after_it_shows_fires_no_notification".into(),
                Box::new(ac2_an_ask_answered_0_9_s_after_it_shows_fires_no_notification),
            ),
            (
                "ac2_an_ask_still_open_1_s_after_it_shows_fires_exactly_one".into(),
                Box::new(ac2_an_ask_still_open_1_s_after_it_shows_fires_exactly_one),
            ),
            (
                "ac2_an_ask_from_the_session_open_in_the_focused_window_fires_none".into(),
                Box::new(ac2_an_ask_from_the_session_open_in_the_focused_window_fires_none),
            ),
            (
                "ac2_a_notifier_that_fires_at_once_fails_naming_the_ask".into(),
                Box::new(ac2_a_notifier_that_fires_at_once_fails_naming_the_ask),
            ),
            (
                "ac2_finished_work_makes_no_sound_and_never_sounds_like_a_question".into(),
                Box::new(ac2_finished_work_makes_no_sound_and_never_sounds_like_a_question),
            ),
            (
                "ac2_only_one_device_plays_a_sound".into(),
                Box::new(ac2_only_one_device_plays_a_sound),
            ),
            (
                "scope_a_notification_opens_its_asks_card_and_answers_nothing".into(),
                Box::new(scope_a_notification_opens_its_asks_card_and_answers_nothing),
            ),
            (
                "scope_one_count_the_same_on_every_device".into(),
                Box::new(scope_one_count_the_same_on_every_device),
            ),
        ];
        for row in ROWS {
            cases.push((
                format!("ac3_{}_on_every_surface", row.file.replace('-', "_")),
                Box::new(move || ac3_row_on_every_surface(row.file)),
            ));
        }
        cases.push((
            "ac3_a_view_that_shows_pass_for_a_stale_verdict_fails_naming_the_surface_and_the_row"
                .into(),
            Box::new(
                ac3_a_view_that_shows_pass_for_a_stale_verdict_fails_naming_the_surface_and_the_row,
            ),
        ));
        cases.push((
            "ac3_a_view_that_shows_done_for_says_done_fails_naming_the_surface_and_the_row".into(),
            Box::new(ac3_a_view_that_shows_done_for_says_done_fails_naming_the_surface_and_the_row),
        ));
        cases.push(("ac3_a_view_that_draws_another_rows_status_entry_fails_naming_the_surface_and_the_row".into(), Box::new(ac3_a_view_that_draws_another_rows_status_entry_fails_naming_the_surface_and_the_row)));

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
            let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(case)).is_ok();
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
