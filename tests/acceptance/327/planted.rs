//! #327: the wrong programs the criteria name, run through the same judges as card.rs, to show each
//! judge fails them naming what the issue says. Each is a `Planted` variant the replica builds the
//! app with (`Replica::planted(fixture, Planted::…)`, README: The surfaces); none runs at the base.
//!
//!   AC1  NoScope               a card that shows no scope                       fails naming "scope"
//!   AC1  CountFollowsRecord    a count that changes while it shows              fails naming the count
//!   AC2  ClickByRecordIndex    the click mapped to the record's index           delivers b, fails naming the option
//!   AC3  NotificationActionAnswers  a notification action writes an answer      fails
//!   AC6  NoDefault             a card that leaves out the default               fails naming the kind
//!   AC9  DiffAfterAnswer       the diff shown only after the answer             fails
//!   AC10 AnswersOnExit         a shell that writes an answer or default on exit fails naming the ask
//!   AC11 ReusesConfirmation    the first confirmation reused for the next card  fails naming the second ask
//!   AC13 RecordsOnlyAnswers    an app that records only answers                 fails naming the missing row
//!   AC15 AnswersSecondFromWords  the words answer a second open ask of the key  fails naming the ask
//!   AC16 TypedYesAllows        a typed "yes" read as allow                      fails naming the card
//!
//! Run with `cargo test --locked -p deep-replica --test acceptance_327_planted`.

#[path = "common.rs"]
mod common;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_327_planted: INCONCLUSIVE; the replica runs on macOS only, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use deep_replica::{Client, On, Planted, Replica, Source};

    use super::common::*;

    /// Runs `case` against a planted replica and answers the panic's message: the judge must fail.
    fn caught(what: &str, case: impl FnOnce() + std::panic::UnwindSafe) -> String {
        match std::panic::catch_unwind(case) {
            Ok(()) => panic!("{what}: the judge passed the planted program"),
            Err(payload) => payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default(),
        }
    }

    // AC1's wrong programs run in ac1_redraft.rs, the test redrafted blind after a dispute.

    fn ac2_a_card_that_maps_the_click_to_the_records_index_delivers_b_and_fails_naming_the_option() {
        let message = caught("ClickByRecordIndex", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::ClickByRecordIndex);
            let ask = raise_taste_abc(&mut replica, S1);
            let card = present_armed(&mut replica, &ask);
            click(&mut replica, 0, On::Option(option_index(&card, "C: cobalt header")));
            let answers = answers_for(&replica, &ask);
            assert_eq!(answers.len(), 1, "{ask}: one answer: {answers:?}");
            assert_eq!(answers[0]["option"], "c", "{ask}: the click on C sent option {:?}, not c", answers[0]["option"]);
        });
        assert!(message.contains("\"b\"") || message.contains("not c"), "the failure names the option delivered: {message}");
    }

    fn ac3_a_notification_action_that_writes_an_answer_fails() {
        let message = caught("NotificationActionAnswers", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::NotificationActionAnswers);
            replica.hide_window(0);
            let ask = raise_taste(&mut replica, S1, "Which header colour?");
            replica.advance(ms(1_500));
            let posts = posts_for(&replica, &ask);
            assert_eq!(posts.len(), 1, "{ask}: one notification: {posts:?}");
            replica.click(&posts[0]);
            assert!(replica.answers().is_empty(), "{ask}: a notification action wrote an answer: {:?}", replica.answers());
        });
        assert!(message.contains("wrote an answer"), "{message}");
    }

    fn ac6_a_card_that_leaves_out_the_default_fails_naming_the_kind() {
        for (file, name) in KINDS {
            let message = caught(name, || {
                let mut replica = Replica::planted(&fixture(file), Planted::NoDefault);
                let ask = fixture_ask(file, 0);
                let card = replica.present(0, &ask);
                let data = fixture_ask_data(file, &ask);
                let failures = judge_kind(&card, &data, replica.now());
                assert!(failures.is_empty(), "{}", failures.join("\n"));
            });
            let kind = fixture_ask_data(file, &fixture_ask(file, 0))["kind"].as_str().unwrap().to_string();
            assert!(message.contains(&format!("{kind} card")), "{name}: the failure names the kind {kind}: {message}");
            assert!(message.contains("default"), "{name}: the failure names the default: {message}");
        }
    }

    fn ac9_a_card_that_shows_the_diff_only_after_the_answer_fails() {
        let message = caught("DiffAfterAnswer", || {
            let file = "moved.events.jsonl";
            let mut replica = Replica::planted(&fixture(file), Planted::DiffAfterAnswer);
            let ask = fixture_ask(file, 0);
            let card = replica.present(0, &ask);
            assert!(card.text.contains("unit"), "{ask}: before it arms the card doesn't show the checks that ran on the moved commit; text: {:?}", card.text);
        });
        assert!(message.contains("before it arms"), "{message}");
    }

    fn ac10_a_shell_that_writes_an_answer_or_a_default_on_exit_fails_naming_the_ask() {
        let message = caught("AnswersOnExit", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::AnswersOnExit);
            let ask = raise_taste(&mut replica, S1, "Which header colour?");
            present_armed(&mut replica, &ask);
            let killed = replica.kill();
            assert!(killed.sent.is_empty(), "{ask}: the dying app sent {:?}; a shell that writes an answer or a default on exit fails", killed.sent);
        });
        assert!(message.contains("ask:"), "the failure names the ask: {message}");
    }

    fn ac11_a_shell_that_reuses_the_first_confirmation_fails_naming_the_second_ask() {
        let message = caught("ReusesConfirmation", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::ReusesConfirmation);
            let first = raise_taste(&mut replica, S1, "Which header colour?");
            let second = raise_taste(&mut replica, S2, "Which footer colour?");
            let card = present_armed(&mut replica, &first);
            click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, On::Option(option_index(&card, "Green header")));
            replica.confirm(true);
            replica.advance(ms(2_000));
            let card = present_armed(&mut replica, &second);
            click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, On::Option(option_index(&card, "Blue header")));
            let prompts = replica.confirmations();
            assert!(
                prompts.len() == 2 && answers_for(&replica, &second).is_empty(),
                "{second}: the first confirmation was reused for the next card: prompts {prompts:?}, answers {:?}",
                replica.answers()
            );
        });
        // The judge names the second ask, whichever handle it drew.
        assert!(message.contains("ask:") && message.contains("reused"), "the failure names the second ask: {message}");
    }

    fn ac13_an_app_that_records_only_answers_fails_naming_the_missing_row() {
        let message = caught("RecordsOnlyAnswers", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::RecordsOnlyAnswers);
            let ask = raise_taste(&mut replica, S1, "Which header colour?");
            let card = replica.present(0, &ask);
            replica.advance(ms(100));
            click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
            replica.advance(ms(ARM_AFTER));
            click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
            let rows = replica.usage();
            for row in ["presented", "refused", "answered"] {
                assert!(rows.iter().any(|r| r["row"] == row && r["ask"] == ask), "{ask}: the usage row {row:?} is missing; rows: {rows:?}");
            }
        });
        assert!(message.contains("\"presented\" is missing"), "the failure names the missing row: {message}");
    }

    fn ac15_a_card_that_answers_the_second_ask_from_the_first_ones_words_fails_naming_the_ask() {
        let message = caught("AnswersSecondFromWords", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::AnswersSecondFromWords);
            let first = raise_taste(&mut replica, S1, "Which header on the checkout total?");
            let second = raise_taste(&mut replica, S2, "Header colour over the total?");
            replica.present(0, &first);
            replica.type_words(0, "darker, and keep the total in view");
            replica.advance(ms(ARM_AFTER + 20));
            click(&mut replica, 0, On::Send);
            assert!(
                answers_for(&replica, &second).is_empty(),
                "{second}: the card answered a second open ask with the same key from the first one's words: {:?}",
                replica.answers()
            );
        });
        assert!(message.contains("ask:") && message.contains("second open ask"), "the failure names the ask: {message}");
    }

    fn ac16_a_card_that_reads_the_typed_yes_as_allow_fails_naming_the_card() {
        let message = caught("TypedYesAllows", || {
            let mut replica = Replica::planted(&fixture("base.events.jsonl"), Planted::TypedYesAllows);
            let (ask, _) = raise_push(&mut replica, S1);
            replica.present(0, &ask);
            replica.type_words(0, "yes");
            replica.advance(ms(ARM_AFTER + 20));
            click(&mut replica, 0, On::Send);
            let answers = answers_for(&replica, &ask);
            assert!(
                answers.iter().all(|a| a.get("option").map_or(true, serde_json::Value::is_null)),
                "{ask}: the card read the typed \"yes\" as allow and sent an option: {answers:?}"
            );
        });
        assert!(message.contains("ask:") && message.contains("read the typed"), "the failure names the card: {message}");
    }

    pub fn run() -> i32 {
        super::common::run(&[
            ("ac2_a_card_that_maps_the_click_to_the_records_index_delivers_b_and_fails_naming_the_option", ac2_a_card_that_maps_the_click_to_the_records_index_delivers_b_and_fails_naming_the_option),
            ("ac3_a_notification_action_that_writes_an_answer_fails", ac3_a_notification_action_that_writes_an_answer_fails),
            ("ac6_a_card_that_leaves_out_the_default_fails_naming_the_kind", ac6_a_card_that_leaves_out_the_default_fails_naming_the_kind),
            ("ac9_a_card_that_shows_the_diff_only_after_the_answer_fails", ac9_a_card_that_shows_the_diff_only_after_the_answer_fails),
            ("ac10_a_shell_that_writes_an_answer_or_a_default_on_exit_fails_naming_the_ask", ac10_a_shell_that_writes_an_answer_or_a_default_on_exit_fails_naming_the_ask),
            ("ac11_a_shell_that_reuses_the_first_confirmation_fails_naming_the_second_ask", ac11_a_shell_that_reuses_the_first_confirmation_fails_naming_the_second_ask),
            ("ac13_an_app_that_records_only_answers_fails_naming_the_missing_row", ac13_an_app_that_records_only_answers_fails_naming_the_missing_row),
            ("ac15_a_card_that_answers_the_second_ask_from_the_first_ones_words_fails_naming_the_ask", ac15_a_card_that_answers_the_second_ask_from_the_first_ones_words_fails_naming_the_ask),
            ("ac16_a_card_that_reads_the_typed_yes_as_allow_fails_naming_the_card", ac16_a_card_that_reads_the_typed_yes_as_allow_fails_naming_the_card),
        ])
    }
}
