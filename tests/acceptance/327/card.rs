//! Issue #327, the question card in the replica (deep-replica: the app headless on gpui's virtual
//! clock, one device per window), written blind before any implementation. The surface it reaches is
//! pinned in this folder's README.md (The surfaces: the replica); the criteria it covers, by ID:
//!   AC1  #327.fab7d30b  the scope and the count on the card, and the receipt (with scope.test.ts)
//!   AC2  #327.da06e3b1  a hardware click on C sends option C (the hub half is answers.test.ts)
//!   AC3  #327.f53f09db  with the window hidden, every ask notifies; a click opens the card; no action answers
//!   AC4  #327.a3e67d66  a click inside the arm interval never answers; a synthetic click needs the OS
//!   AC5  #327.d3f997a2  unknown accessibility clients, Full Keyboard Access, Voice Control, Switch Control, VoiceOver
//!   AC6  #327.c4f81936  the seven kinds' text snapshots; the batch of four
//!   AC8  #327.38aabe79  a taste card lists past calls from the decisions table
//!   AC9  #327.78f6951b  a moved provisional choice shows the diff before arming
//!   AC10 #327.089d44f5  killing the app answers nothing; relaunch presents again unarmed
//!   AC11 #327.918e0cbc  one confirmation answers one card
//!   AC12 #327.ff421b1d  a 1 × 1 slot, or one scrolled out, never arms; a press is refused
//!   AC13 #327.fd4714c7  the usage rows
//!   AC15 #327.2459a9a6  "Answers this ask only" (the record half is answers.test.ts)
//!   AC16 #327.f9d8bea9  "Sends your words as the reason; this won't run" (the record half is answers.test.ts)
//!
//! Wired into deep-replica by the `[[test]]` entry this folder adds to crates/deep-replica/Cargo.toml and
//! run with `cargo test --locked -p deep-replica --test acceptance_327_card`; a positional argument narrows the
//! run to the cases whose names hold it. No libtest harness: AppKit needs the main thread.

#[path = "common.rs"]
mod common;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_327_card: INCONCLUSIVE; the replica runs on macOS only, so none of #327's card checks ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use deep_replica::{Client, On, Phase, Replica, Slot, Source};
    use serde_json::{json, Value};

    use super::common::*;

    // ---- AC1 #327.fab7d30b: the card says its scope and how many more it answers; the receipt lists them.

    fn ac1_the_card_says_its_scope_and_that_it_answers_2_more_and_the_receipt_lists_a_third() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let first = raise_taste(&mut replica, S1, "Darker header on the checkout total?");
        let _second = raise_taste(&mut replica, S2, "Header colour over the total?");
        let _third = raise_taste(&mut replica, S3, "Which header on the total line?");
        let card = replica.present(0, &first);
        // Before it arms: the scope in words, and the count.
        assert!(
            card.text.to_lowercase().contains("repo") && card.text.contains("shop"),
            "{first}: before it arms the card doesn't say in words that the answer is saved for the repo shop; text: {:?}",
            card.text
        );
        assert!(card.text.contains("2 more"), "{first}: with two matching asks open the card doesn't say it answers 2 more; text: {:?}", card.text);
        // A fourth comes to match while the card shows: the card doesn't change.
        replica.advance(ms(200));
        let fourth = raise_taste(&mut replica, S2, "Header on the total, take four?");
        replica.advance(ms(100));
        let during = replica.card_seen(0).expect("the card is still up");
        assert!(during.text.contains("2 more"), "{first}: the count changed while the card showed, after {fourth} came to match; text: {:?}", during.text);
        assert_eq!(during.seq, card.seq, "{first}: the card was presented again when {fourth} came to match");
        replica.advance(ms(ARM_AFTER));
        let armed = replica.card_seen(0).expect("the card is still up");
        assert_eq!(armed.state, "armed", "{first}: {armed:?}");
        click(&mut replica, 0, On::Option(option_index(&armed, "Green header")));
        let answers = answers_for(&replica, &first);
        assert_eq!(answers.len(), 1, "{first}: the click sent one answer: {answers:?}");
        assert_eq!(answers[0]["option"], "green", "{first}: {answers:?}");
        // The receipt: one line with Undo, listing the one that came to match while the card showed.
        let receipt = replica.card_seen(0).expect("the answered card keeps its slot as a receipt");
        assert_eq!(receipt.state, "answered", "{first}: {receipt:?}");
        assert!(receipt.text.contains("Undo"), "{first}: the receipt has no Undo; text: {:?}", receipt.text);
        assert!(
            receipt.text.contains("Header on the total, take four?") || receipt.text.contains(&fourth),
            "{first}: the receipt doesn't list {fourth}, which came to match while the card showed; text: {:?}",
            receipt.text
        );
    }

    // ---- AC2 #327.da06e3b1: a hardware click on C sends option C, never the record's index.

    fn ac2_a_hardware_click_on_c_sends_option_c_not_the_recommended_b_drawn_first() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let ask = raise_taste_abc(&mut replica, S1);
        let card = present_armed(&mut replica, &ask);
        assert_eq!(
            card.options,
            vec!["B: bone header", "A: amber header", "C: cobalt header"],
            "{ask}: B, the recommended option, is drawn first, then the record's order"
        );
        click(&mut replica, 0, On::Option(2));
        let answers = answers_for(&replica, &ask);
        assert_eq!(answers.len(), 1, "{ask}: one answer sent: {answers:?}");
        assert_eq!(
            answers[0]["option"], "c",
            "{ask}: the click on C (drawn third) sent option {:?}, not c; a card that maps the click to the record's index sends b",
            answers[0]["option"]
        );
    }

    // ---- AC3 #327.f53f09db: with the window hidden, every ask that shows at once notifies.

    fn ac3_with_the_window_hidden_every_ask_notifies_with_its_question_default_and_when() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        replica.hide_window(0);
        let taste = raise_taste(&mut replica, S1, "Which header colour on the checkout total?");
        let (push, _) = raise_push(&mut replica, S2);
        replica.advance(ms(1_500));
        for (ask, question, default, span) in [
            (&taste, "Which header colour on the checkout total?", "Blue header", "3 d"),
            (&push, "Push feat/cart to origin?", "Decline", "1 d"),
        ] {
            let posts = posts_for(&replica, ask);
            assert_eq!(posts.len(), 1, "{ask}: with the window hidden, exactly one notification: {posts:?}");
            let text = &posts[0].text;
            assert!(text.contains(question), "{ask}: the notification doesn't carry the question: {text:?}");
            assert!(text.contains(default), "{ask}: the notification doesn't carry the default {default:?}: {text:?}");
            assert!(text.contains(span), "{ask}: the notification doesn't say when the default applies ({span}): {text:?}");
        }
        // Clicking one opens that ask's card, and answers nothing.
        let posts = posts_for(&replica, &push);
        replica.click(&posts[0]);
        assert_eq!(replica.card(0).as_deref(), Some(push.as_str()), "clicking the notification opens its ask's card");
        assert!(replica.answers().is_empty(), "a notification action wrote an answer: {:?}", replica.answers());
        assert!(
            !replica.usage().iter().any(|row| row["row"] == "answered"),
            "a notification action answered: {:?}",
            replica.usage()
        );
    }

    // ---- AC4 #327.a3e67d66: a click inside the arm interval never answers; a synthetic click needs the OS.

    fn ac4_a_click_inside_the_arm_interval_never_answers() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let ask = raise_taste(&mut replica, S1, "Which header colour?");
        let card = replica.present(0, &ask);
        replica.advance(ms(ARM_AFTER - 1));
        click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
        assert!(answers_for(&replica, &ask).is_empty(), "{ask}: a click 499 ms after presentation answered: {:?}", replica.answers());
        let after = replica.card_seen(0).unwrap();
        assert_ne!(after.state, "answered", "{ask}: {after:?}");
        let refused: Vec<_> = usage_for(&replica, &ask).into_iter().filter(|r| r["row"] == "refused").collect();
        assert_eq!(refused.len(), 1, "{ask}: the refused click is recorded once: {:?}", replica.usage());
    }

    fn ac4_a_synthetic_click_answers_only_after_the_os_confirms_you() {
        for confirms in [true, false] {
            let mut replica = Replica::open(&fixture("base.events.jsonl"));
            let ask = raise_taste(&mut replica, S1, "Which header colour?");
            let card = present_armed(&mut replica, &ask);
            click_from(&mut replica, 0, Source::Synthetic { pid: 4242 }, On::Option(option_index(&card, "Green header")));
            assert!(answers_for(&replica, &ask).is_empty(), "{ask}: a synthetic click answered before the OS confirmed you: {:?}", replica.answers());
            let prompts = replica.confirmations();
            assert_eq!(prompts.len(), 1, "{ask}: a synthetic click raises one OS confirmation: {prompts:?}");
            assert!(prompts[0].answered.is_none(), "{ask}: the prompt is open: {prompts:?}");
            replica.confirm(confirms);
            let answers = answers_for(&replica, &ask);
            if confirms {
                assert_eq!(answers.len(), 1, "{ask}: once the OS confirms you the synthetic click answers: {answers:?}");
                assert_eq!(answers[0]["option"], "green", "{ask}: {answers:?}");
            } else {
                assert!(answers.is_empty(), "{ask}: a cancelled confirmation answered: {answers:?}");
                assert_ne!(replica.card_seen(0).unwrap().state, "answered", "{ask}: the ask stays open");
            }
        }
    }

    // ---- AC5 #327.d3f997a2: accessibility clients, Full Keyboard Access, Voice Control, Switch Control, VoiceOver.

    fn ac5_an_unknown_client_action_answers_only_after_the_os_confirms_you() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let ask = raise_taste(&mut replica, S1, "Which header colour?");
        let card = present_armed(&mut replica, &ask);
        click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, On::Option(option_index(&card, "Green header")));
        assert!(answers_for(&replica, &ask).is_empty(), "{ask}: an unknown client's action answered before the OS confirmed you: {:?}", replica.answers());
        let prompts = replica.confirmations();
        assert_eq!(prompts.len(), 1, "{ask}: one OS confirmation (Touch ID or your password): {prompts:?}");
        assert!(prompts[0].prompt.contains("Which header colour?"), "{ask}: the prompt names the question: {prompts:?}");
        assert!(prompts[0].prompt.contains("Green header"), "{ask}: the prompt names the option: {prompts:?}");
        replica.confirm(true);
        let answers = answers_for(&replica, &ask);
        assert_eq!(answers.len(), 1, "{ask}: confirmed, the action answers once: {answers:?}");
        assert_eq!(answers[0]["option"], "green", "{ask}: {answers:?}");
    }

    fn ac5_a_test_client_that_cant_pass_the_confirmation_never_answers() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let ask = raise_taste(&mut replica, S1, "Which header colour?");
        let card = present_armed(&mut replica, &ask);
        let on = On::Option(option_index(&card, "Green header"));
        // A test client (an agent's computer use): it can act, repeat the action, and cancel the prompt, never pass it.
        for _ in 0..3 {
            click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, on.clone());
            replica.confirm(false);
            replica.advance(ms(100));
        }
        assert!(answers_for(&replica, &ask).is_empty(), "{ask}: a client that can't pass the confirmation answered: {:?}", replica.answers());
        assert_ne!(replica.card_seen(0).unwrap().state, "answered", "{ask}: the ask stays open");
    }

    fn ac5_with_full_keyboard_access_tab_reaches_each_option_of_every_kind_and_space_answers_once_armed() {
        for (file, name) in KINDS {
            let mut replica = Replica::open(&fixture(file));
            let ask = fixture_ask(file, 0);
            let card = replica.present(0, &ask);
            let count = card.options.len();
            assert!(count >= 1, "{name}: the card has options: {card:?}");
            // Before it arms: Tab reaches each option, Space answers nothing.
            for i in 0..count {
                let at = replica.now();
                replica.key(0, "tab", at, Source::Hid);
                let focused = replica.card_seen(0).unwrap().focused;
                assert_eq!(focused, Some(i), "{name} card {ask}: after {} Tab(s) the focus isn't on option {i} ({:?})", i + 1, card.options);
            }
            let at = replica.now();
            replica.key(0, "space", at, Source::Hid);
            assert!(answers_for(&replica, &ask).is_empty(), "{name} card {ask}: Space answered before the card armed: {:?}", replica.answers());
            replica.advance(ms(ARM_AFTER + 20));
            assert_eq!(replica.card_seen(0).unwrap().state, "armed", "{name} card {ask}");
            let at = replica.now();
            replica.key(0, "space", at, Source::Hid);
            let answers = answers_for(&replica, &ask);
            assert_eq!(answers.len(), 1, "{name} card {ask}: Space on the focused option, once armed, answers once: {answers:?}");
            let last = card.options.last().unwrap();
            let data = fixture_ask_data(file, &ask);
            let expected = data["options"].as_array().unwrap().iter().find(|o| o["label"] == *last).map(|o| o["id"].clone()).unwrap();
            assert_eq!(answers[0]["option"], expected, "{name} card {ask}: Space answered with the focused option {last:?}");
            assert!(replica.confirmations().is_empty(), "{name} card {ask}: hardware keys need no OS confirmation: {:?}", replica.confirmations());
        }
    }

    fn ac5_with_voice_control_every_card_kind_can_be_answered_through_the_confirmation() {
        panic!(
            "BLOCKED: needs a person at a Mac with Voice Control on. Manual step: open the app, present each of the seven \
             kinds from tests/acceptance/327/fixtures/kinds/*.events.jsonl (deep-show live or the replica's window), say \
             \"Click <option label>\" on each armed card, pass the Touch ID or password prompt it raises, and confirm the ask \
             is answered with that option (deep inbox); then cancel the prompt on one card and confirm it stays open. Record \
             the result for each kind in BASE-FAILURE.txt's manual section."
        );
    }

    fn ac5_with_switch_control_every_card_kind_can_be_answered_through_the_confirmation() {
        panic!(
            "BLOCKED: needs a person at a Mac with Switch Control on. Manual step: as for Voice Control, selecting each armed \
             card's option with the switch, passing the Touch ID or password prompt, and confirming the answer in deep inbox; \
             then cancelling one prompt and confirming the ask stays open. Record the result per kind in BASE-FAILURE.txt."
        );
    }

    fn ac5_voiceover_reads_each_cards_question_options_deadline_and_default() {
        panic!(
            "BLOCKED: needs a person at a Mac with VoiceOver on (the agent can't observe VoiceOver here). Manual step: present \
             each of the seven kinds, move VoiceOver's cursor through the card, and confirm by ear it reads the question, every \
             option's label, the deadline and the default. The text snapshot each card exposes to assistive clients is what \
             ac6_each_kind_renders_… checks; this step checks what is spoken."
        );
    }

    // ---- AC6 #327.c4f81936: the seven kinds, and the batch of four.

    fn ac6_each_kind_renders_from_its_fixture_with_question_options_deadline_default_and_its_fields() {
        let mut failures = Vec::new();
        for (file, name) in KINDS {
            let mut replica = Replica::open(&fixture(file));
            let ask = fixture_ask(file, 0);
            let card = replica.present(0, &ask);
            let data = fixture_ask_data(file, &ask);
            let now = replica.now();
            for failure in judge_kind(&card, &data, now) {
                failures.push(format!("{name}: {failure}"));
            }
        }
        assert!(failures.is_empty(), "the seven kinds' text snapshots:\n{}", failures.join("\n"));
    }

    fn ac6_a_batched_approval_shows_the_diff_public_and_undo_and_approving_part_runs_only_those() {
        let file = "kinds/batched.events.jsonl";
        let mut replica = Replica::open(&fixture(file));
        let ask = fixture_ask(file, 0);
        let card = replica.present(0, &ask);
        assert_eq!(card.steps.len(), 4, "{ask}: the batch of four: {card:?}");
        let delete = card.steps.iter().position(|s| s.does.contains("--delete")).expect("the delete step");
        for (i, step) in card.steps.iter().enumerate() {
            assert_eq!(step.undoable, i != delete, "{ask}: step {i} ({}) undoable", step.does);
            assert_eq!(step.on, i != delete, "{ask}: step {i} ({}) starts switched {}", step.does, if i != delete { "on" } else { "off" });
        }
        let approve = card.approve.clone().expect("the approve button says how many it runs");
        assert_eq!((approve.runs, approve.cannot_undo), (3, 1), "{ask}: the approve button runs 3, 1 can't be undone: {approve:?}");
        assert!(card.text.contains("diff"), "{ask}: the diff preview; text: {:?}", card.text);
        assert!(card.text.to_lowercase().contains("public"), "{ask}: whether the target is public; text: {:?}", card.text);
        assert!(card.text.to_lowercase().contains("undo"), "{ask}: whether it can be undone; text: {:?}", card.text);
        replica.advance(ms(ARM_AFTER + 20));
        click(&mut replica, 0, On::Option(option_index(&card, "Push it")));
        let answers = answers_for(&replica, &ask);
        assert_eq!(answers.len(), 1, "{ask}: one answer for the batch: {answers:?}");
        let ran: Vec<u64> = answers[0]["steps"].as_array().map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
        let expected: Vec<u64> = (0..4u64).filter(|i| *i as usize != delete).collect();
        assert_eq!(ran, expected, "{ask}: approving the batch runs the three switched on, not the one that can't be undone: {answers:?}");

        // The fourth runs only after its own switch is turned on.
        let mut replica = Replica::open(&fixture(file));
        let card = replica.present(0, &ask);
        replica.toggle_step(0, delete);
        let card = replica.card_seen(0).unwrap();
        let approve = card.approve.clone().expect("the approve button");
        assert_eq!((approve.runs, approve.cannot_undo), (4, 1), "{ask}: with the switch on the approve button runs 4: {approve:?}");
        replica.advance(ms(ARM_AFTER + 20));
        click(&mut replica, 0, On::Option(option_index(&card, "Push it")));
        let answers = answers_for(&replica, &ask);
        let ran: Vec<u64> = answers.last().and_then(|a| a["steps"].as_array()).map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
        assert_eq!(ran, vec![0, 1, 2, 3], "{ask}: with its switch on the fourth runs too: {answers:?}");
    }

    // ---- AC8 #327.38aabe79: a taste card lists past calls on the same screen and step.

    fn ac8_a_taste_card_lists_your_past_calls_on_the_same_screen_and_step() {
        let file = "past.events.jsonl";
        let mut replica = Replica::open(&fixture(file));
        let ask = fixture_ask(file, 3);
        let card = replica.present(0, &ask);
        assert_eq!(card.kind, "taste", "{card:?}");
        for (question, answer) in [("Darker header on the checkout total?", "Green header"), ("Header colour over the total, after the redesign?", "Blue header")] {
            assert!(card.text.contains(question), "{ask}: the past call {question:?} on the same screen and step isn't listed; text: {:?}", card.text);
            assert!(card.text.contains(answer), "{ask}: the past call's answer {answer:?} isn't listed; text: {:?}", card.text);
        }
        assert!(!card.text.contains("Which badge on the cart icon?"), "{ask}: a past call on another screen and step is listed; text: {:?}", card.text);
    }

    // ---- AC9 #327.78f6951b: a moved provisional choice shows the diff since its pin before arming.

    fn ac9_a_provisional_choice_whose_pin_moved_shows_the_diff_and_its_checks_before_arming() {
        let file = "moved.events.jsonl";
        let mut replica = Replica::open(&fixture(file));
        let ask = fixture_ask(file, 0);
        let data = fixture_ask_data(file, &ask);
        let pinned = data["pinned_to"]["ref"].as_str().unwrap();
        let card = replica.present(0, &ask);
        assert_eq!(card.state, "presented", "{card:?}");
        let text = std::fs::read_to_string(fixture(file)).unwrap();
        let sha = text
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|r| r["event"]["kind"] == "commit.made")
            .map(|r| r["event"]["data"]["sha"].as_str().unwrap().to_string())
            .expect("the fixture's commit.made");
        assert!(
            card.text.contains(&sha[..7]) && card.text.contains(&pinned[..7]),
            "{ask}: before it arms the card doesn't show the diff from its pin {} to {}; text: {:?}",
            &pinned[..7],
            &sha[..7],
            card.text
        );
        assert!(card.text.contains("unit"), "{ask}: the checks that ran on the moved commit (unit) aren't shown; text: {:?}", card.text);
        assert!(card.text.to_lowercase().contains("pass"), "{ask}: the unit check's outcome isn't shown; text: {:?}", card.text);
    }

    // ---- AC10 #327.089d44f5: killing the app leaves the ask open, unanswered, undefaulted, its deadline unchanged.

    fn ac10_killing_the_app_with_an_armed_card_answers_nothing_and_relaunch_presents_unarmed() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let ask = raise_taste(&mut replica, S1, "Which header colour?");
        let card = present_armed(&mut replica, &ask);
        let deadline_words = card.text.clone();
        let killed = replica.kill();
        assert!(killed.sent.is_empty(), "{ask}: the dying app sent {:?}; a shell that writes an answer or a default on exit fails", killed.sent);
        let mut replica = Replica::relaunch(killed);
        assert!(replica.answers().is_empty(), "{ask}: on relaunch an answer exists: {:?}", replica.answers());
        assert!(
            replica.open_asks().contains(&ask),
            "{ask}: on relaunch the ask isn't open (answered or defaulted); open: {:?}",
            replica.open_asks()
        );
        let again = replica.present(0, &ask);
        assert_eq!(again.state, "presented", "{ask}: the card presents again unarmed: {again:?}");
        assert_ne!(again.seq, card.seq, "{ask}: the relaunched card has a new seq");
        let said = |text: &str| text.split_whitespace().filter(|w| w.ends_with('d') || w.ends_with('h')).count();
        assert_eq!(said(&again.text), said(&deadline_words), "{ask}: the deadline changed across the relaunch; before: {deadline_words:?}, after: {:?}", again.text);
        replica.advance(ms(ARM_AFTER - 1));
        assert_eq!(replica.card_seen(0).unwrap().state, "presented", "{ask}: not armed before its interval");
        replica.advance(ms(2));
        assert_eq!(replica.card_seen(0).unwrap().state, "armed", "{ask}: armed after its interval");
    }

    // ---- AC11 #327.918e0cbc: one confirmation answers exactly one card.

    fn ac11_one_confirmation_answers_one_card_and_the_next_card_raises_a_new_prompt() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let first = raise_taste(&mut replica, S1, "Which header colour?");
        let second = raise_taste(&mut replica, S2, "Which footer colour?");
        let card = present_armed(&mut replica, &first);
        click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, On::Option(option_index(&card, "Green header")));
        replica.confirm(true);
        assert_eq!(answers_for(&replica, &first).len(), 1, "{first}: confirmed, answered once");
        replica.advance(ms(2_000));
        let card = present_armed(&mut replica, &second);
        click_from(&mut replica, 0, Source::Accessibility { client: Client::Unknown }, On::Option(option_index(&card, "Blue header")));
        let prompts = replica.confirmations();
        assert_eq!(prompts.len(), 2, "{second}: an unknown-client action on the next card 2 s later raises a new prompt: {prompts:?}");
        let prompt = &prompts[1].prompt;
        assert!(prompt.contains("Which footer colour?"), "{second}: the new prompt names that card's question: {prompt:?}");
        assert!(prompt.contains("Blue header"), "{second}: the new prompt names the option: {prompt:?}");
        assert!(answers_for(&replica, &second).is_empty(), "{second}: answered on the first confirmation: {:?}", replica.answers());
        replica.confirm(false);
        assert!(answers_for(&replica, &second).is_empty(), "{second}: a cancelled prompt answered: {:?}", replica.answers());
        assert_ne!(replica.card_seen(0).unwrap().state, "answered", "{second}: the ask stays open");
    }

    // ---- AC12 #327.ff421b1d: a 1 × 1 slot, or one scrolled 1 px out, never arms; a press is refused.

    fn ac12_a_1x1_slot_or_one_scrolled_1_px_out_never_arms_and_a_press_is_refused() {
        for (slot, what) in [
            (Slot { rect: [10, 10, 1, 1], scrolled_out: 0 }, "a 1 × 1 px slot"),
            (Slot { rect: [10, 10, 420, 220], scrolled_out: 1 }, "a slot scrolled 1 px outside its area"),
        ] {
            let mut replica = Replica::open(&fixture("base.events.jsonl"));
            let ask = raise_taste(&mut replica, S1, "Which header colour?");
            let card = replica.present_in(0, &ask, slot);
            replica.advance(ms(5_000));
            let later = replica.card_seen(0).unwrap();
            assert_ne!(later.state, "armed", "{ask}: {what} armed: {later:?}");
            click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
            assert!(answers_for(&replica, &ask).is_empty(), "{ask}: {what}: a press answered: {:?}", replica.answers());
            let refused: Vec<_> = usage_for(&replica, &ask).into_iter().filter(|r| r["row"] == "refused").collect();
            assert_eq!(refused.len(), 1, "{ask}: {what}: the press is recorded as a refused click: {:?}", replica.usage());
        }
    }

    // ---- AC13 #327.fd4714c7: the usage rows.

    fn ac13_three_presented_one_refused_one_answer_and_one_undo_produce_exactly_those_rows() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let asks: Vec<String> = ["Which header colour?", "Which footer colour?", "Which badge?"]
            .iter()
            .map(|q| raise_taste(&mut replica, S1, q))
            .collect();
        let mut seqs = Vec::new();
        // Three presented; on the first, a click refused before arming, then the answer and its undo.
        let card = replica.present(0, &asks[0]);
        seqs.push(card.seq);
        replica.advance(ms(100));
        click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
        replica.advance(ms(ARM_AFTER));
        click(&mut replica, 0, On::Option(option_index(&card, "Green header")));
        assert_eq!(answers_for(&replica, &asks[0]).len(), 1, "{}: answered", asks[0]);
        replica.advance(ms(100));
        click(&mut replica, 0, On::Undo);
        for ask in &asks[1..] {
            seqs.push(replica.present(0, ask).seq);
            replica.advance(ms(100));
        }
        let rows = replica.usage();
        let mut got: Vec<(String, String)> = rows.iter().map(|r| (r["row"].as_str().unwrap_or("?").to_string(), r["ask"].as_str().unwrap_or("?").to_string())).collect();
        let mut want: Vec<(String, String)> = vec![
            ("presented".into(), asks[0].clone()),
            ("refused".into(), asks[0].clone()),
            ("answered".into(), asks[0].clone()),
            ("undone".into(), asks[0].clone()),
            ("presented".into(), asks[1].clone()),
            ("presented".into(), asks[2].clone()),
        ];
        got.sort();
        want.sort();
        assert_eq!(got, want, "exactly those usage rows; got {rows:?}");
        for row in &rows {
            assert_eq!(row["kind"], "taste", "the row carries the card's kind: {row:?}");
            let seq = row["seq"].as_u64().unwrap_or_else(|| panic!("the row carries the card's seq: {row:?}"));
            assert!(seqs.contains(&seq), "the row's seq {seq} is one of the presented cards' {seqs:?}: {row:?}");
            let at = row["at"].as_u64().unwrap_or_else(|| panic!("the row carries host time: {row:?}"));
            assert!(at >= deep_replica::NOW && at <= replica.now(), "the row's host time {at} is on the clock: {row:?}");
        }
    }

    // ---- AC15 #327.2459a9a6: the card half: before it arms, "Answers this ask only"; Send sends the words alone.

    fn ac15_typing_with_no_option_says_answers_this_ask_only_and_sends_the_words_alone() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let first = raise_taste(&mut replica, S1, "Which header on the checkout total?");
        let second = raise_taste(&mut replica, S2, "Header colour over the total?");
        replica.present(0, &first);
        replica.type_words(0, "darker, and keep the total in view");
        let card = replica.card_seen(0).unwrap();
        assert_eq!(card.state, "presented", "{first}: still unarmed: {card:?}");
        assert!(card.text.contains("Answers this ask only"), "{first}: before it armed, with words typed and no option, the card doesn't say \"Answers this ask only\"; text: {:?}", card.text);
        replica.advance(ms(ARM_AFTER + 20));
        click(&mut replica, 0, On::Send);
        let answers = answers_for(&replica, &first);
        assert_eq!(answers.len(), 1, "{first}: Send sent one answer: {answers:?}");
        assert_eq!(answers[0]["words"], "darker, and keep the total in view", "{first}: the words: {answers:?}");
        assert!(answers[0].get("option").map_or(true, Value::is_null), "{first}: no option chosen: {answers:?}");
        assert!(answers_for(&replica, &second).is_empty(), "{second}: the card answered a second open ask with the same key from the first one's words: {:?}", replica.answers());
        let other = replica.present(0, &second);
        assert_eq!(other.state, "presented", "{second}: stays open: {other:?}");
    }

    // ---- AC16 #327.f9d8bea9: the card half: typed "yes" says it won't run; only Allow sends the allow.

    fn ac16_a_typed_yes_on_a_push_card_says_it_wont_run_and_only_allow_runs_the_plan() {
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let (ask, hash) = raise_push(&mut replica, S1);
        let card = replica.present(0, &ask);
        assert_eq!(card.kind, "authority", "{card:?}");
        replica.type_words(0, "yes");
        let typed = replica.card_seen(0).unwrap();
        assert_eq!(typed.state, "presented", "{ask}: still unarmed: {typed:?}");
        assert!(
            typed.text.contains("Sends your words as the reason; this won't run"),
            "{ask}: before it armed, with \"yes\" typed, the card doesn't say \"Sends your words as the reason; this won't run\"; text: {:?}",
            typed.text
        );
        replica.advance(ms(ARM_AFTER + 20));
        click(&mut replica, 0, On::Send);
        let answers = answers_for(&replica, &ask);
        assert_eq!(answers.len(), 1, "{ask}: Send sent one answer: {answers:?}");
        assert_eq!(answers[0]["words"], "yes", "{ask}: the words: {answers:?}");
        assert!(answers[0].get("option").map_or(true, Value::is_null), "{ask}: a typed \"yes\" was sent as an option: {answers:?}");
        assert!(answers[0].get("plan_hash").map_or(true, Value::is_null), "{ask}: a typed \"yes\" was sent with the plan's hash: {answers:?}");

        // Only Allow, once the card arms, runs the plan: the option with the plan's hash and the click's token.
        let mut replica = Replica::open(&fixture("base.events.jsonl"));
        let (ask, hash2) = raise_push(&mut replica, S1);
        assert_eq!(hash, hash2, "the live plan's hash");
        let card = present_armed(&mut replica, &ask);
        click(&mut replica, 0, On::Option(option_index(&card, "Allow")));
        let answers = answers_for(&replica, &ask);
        assert_eq!(answers.len(), 1, "{ask}: Allow sent one answer: {answers:?}");
        assert_eq!(answers[0]["option"], "approve", "{ask}: {answers:?}");
        assert_eq!(answers[0]["plan_hash"], json!(hash), "{ask}: Allow carries the plan's hash: {answers:?}");
        assert!(answers[0]["token"].as_str().map_or(false, |t| !t.is_empty()), "{ask}: Allow carries the click's token: {answers:?}");
    }

    pub fn run() -> i32 {
        super::common::run(&[
            ("ac1_the_card_says_its_scope_and_that_it_answers_2_more_and_the_receipt_lists_a_third", ac1_the_card_says_its_scope_and_that_it_answers_2_more_and_the_receipt_lists_a_third),
            ("ac2_a_hardware_click_on_c_sends_option_c_not_the_recommended_b_drawn_first", ac2_a_hardware_click_on_c_sends_option_c_not_the_recommended_b_drawn_first),
            ("ac3_with_the_window_hidden_every_ask_notifies_with_its_question_default_and_when", ac3_with_the_window_hidden_every_ask_notifies_with_its_question_default_and_when),
            ("ac4_a_click_inside_the_arm_interval_never_answers", ac4_a_click_inside_the_arm_interval_never_answers),
            ("ac4_a_synthetic_click_answers_only_after_the_os_confirms_you", ac4_a_synthetic_click_answers_only_after_the_os_confirms_you),
            ("ac5_an_unknown_client_action_answers_only_after_the_os_confirms_you", ac5_an_unknown_client_action_answers_only_after_the_os_confirms_you),
            ("ac5_a_test_client_that_cant_pass_the_confirmation_never_answers", ac5_a_test_client_that_cant_pass_the_confirmation_never_answers),
            ("ac5_with_full_keyboard_access_tab_reaches_each_option_of_every_kind_and_space_answers_once_armed", ac5_with_full_keyboard_access_tab_reaches_each_option_of_every_kind_and_space_answers_once_armed),
            ("ac5_with_voice_control_every_card_kind_can_be_answered_through_the_confirmation", ac5_with_voice_control_every_card_kind_can_be_answered_through_the_confirmation),
            ("ac5_with_switch_control_every_card_kind_can_be_answered_through_the_confirmation", ac5_with_switch_control_every_card_kind_can_be_answered_through_the_confirmation),
            ("ac5_voiceover_reads_each_cards_question_options_deadline_and_default", ac5_voiceover_reads_each_cards_question_options_deadline_and_default),
            ("ac6_each_kind_renders_from_its_fixture_with_question_options_deadline_default_and_its_fields", ac6_each_kind_renders_from_its_fixture_with_question_options_deadline_default_and_its_fields),
            ("ac6_a_batched_approval_shows_the_diff_public_and_undo_and_approving_part_runs_only_those", ac6_a_batched_approval_shows_the_diff_public_and_undo_and_approving_part_runs_only_those),
            ("ac8_a_taste_card_lists_your_past_calls_on_the_same_screen_and_step", ac8_a_taste_card_lists_your_past_calls_on_the_same_screen_and_step),
            ("ac9_a_provisional_choice_whose_pin_moved_shows_the_diff_and_its_checks_before_arming", ac9_a_provisional_choice_whose_pin_moved_shows_the_diff_and_its_checks_before_arming),
            ("ac10_killing_the_app_with_an_armed_card_answers_nothing_and_relaunch_presents_unarmed", ac10_killing_the_app_with_an_armed_card_answers_nothing_and_relaunch_presents_unarmed),
            ("ac11_one_confirmation_answers_one_card_and_the_next_card_raises_a_new_prompt", ac11_one_confirmation_answers_one_card_and_the_next_card_raises_a_new_prompt),
            ("ac12_a_1x1_slot_or_one_scrolled_1_px_out_never_arms_and_a_press_is_refused", ac12_a_1x1_slot_or_one_scrolled_1_px_out_never_arms_and_a_press_is_refused),
            ("ac13_three_presented_one_refused_one_answer_and_one_undo_produce_exactly_those_rows", ac13_three_presented_one_refused_one_answer_and_one_undo_produce_exactly_those_rows),
            ("ac15_typing_with_no_option_says_answers_this_ask_only_and_sends_the_words_alone", ac15_typing_with_no_option_says_answers_this_ask_only_and_sends_the_words_alone),
            ("ac16_a_typed_yes_on_a_push_card_says_it_wont_run_and_only_allow_runs_the_plan", ac16_a_typed_yes_on_a_push_card_says_it_wont_run_and_only_allow_runs_the_plan),
        ])
    }
}
