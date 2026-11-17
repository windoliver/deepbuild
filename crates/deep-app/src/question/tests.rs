use super::*;
use crate::arming::ARM_AFTER;

const SLOT: Slot = Slot {
    rect: [100, 100, CARD_SIZE[0], CARD_SIZE[1]],
    visible: [0, 0, 1512, 982],
};
const NOW: u64 = 1_800_000_000_000;

fn ask(id: &str, kind: &str, options: Value, extra: Value) -> Value {
    let mut data = json!({
        "kind": kind, "question": format!("Question {id}?"), "options": options, "recommended": null,
        "deadline": NOW + 3 * 86_400_000, "default": options[0]["id"], "key": "k",
        "pinned_to": {"kind": "commit", "ref": "abc"},
    });
    if let Some(extra) = extra.as_object() {
        for (name, value) in extra {
            data[name] = value.clone();
        }
    }
    json!({"kind": "ask.created", "id": id, "session": "S", "log_pos": 1, "data": data})
}

fn taste(id: &str) -> Value {
    ask(
        id,
        "taste",
        json!([{"id": "blue", "label": "Blue", "decision": "none"}, {"id": "green", "label": "Green", "decision": "none"}]),
        json!({}),
    )
}

fn hardware(t: u64, target: Target, phase: Phase) -> Input {
    Input {
        t,
        source: Source::Hardware,
        target,
        phase,
    }
}

/// A press the OS can't vouch for, from pid 4242.
fn synthetic(t: u64, target: Target, phase: Phase) -> Input {
    Input {
        t,
        source: Source::Synthetic { pid: Some(4242) },
        target,
        phase,
    }
}

/// An authority ask to push origin/x, declined by default.
fn approval(id: &str) -> Value {
    ask(
        id,
        "authority",
        json!([{"id": "approve", "label": "Allow", "decision": "allow"}, {"id": "decline", "label": "Decline", "decision": "deny"}]),
        json!({"default": "decline", "subject": {"effect": "push", "target": {"ref": "origin/x"}}}),
    )
}

/// The usage rows the card wrote since they were last taken, by name.
fn usage_rows(card: &mut Controller) -> Vec<String> {
    card.take_usage()
        .iter()
        .map(|row| row["row"].as_str().unwrap().to_owned())
        .collect()
}

fn click(controller: &mut Controller, events: &[Value], t: u64, target: Target) -> Did {
    match controller.press(hardware(t, target, Phase::Down), events, t) {
        Did::Nothing => controller.press(hardware(t + 30, target, Phase::Up), events, t + 30),
        other => other,
    }
}

#[test]
fn a_sign_in_task_draws_one_button_and_its_steps_and_its_press_starts_the_agents_sign_in_answering_nothing(
) {
    let events = vec![ask(
        "S",
        "unblock",
        json!([{"id": "done", "label": "I did it", "decision": "none"}, {"id": "wait", "label": "Leave it blocked", "decision": "none"}]),
        json!({
            "steps": ["Press Sign in: Claude Code opens its own window or browser page", "Claude Code needs a paid plan."],
            "where": "Claude Code's own window or browser page", "why": "w", "unblocks": ["req:0"], "proves": "claude-code sign-in probe",
        }),
    )];
    let mut card = Controller::present(&events, "ask:S", NOW, SLOT, Faults::default()).unwrap();
    let controls: Vec<Row> = card
        .rows()
        .into_iter()
        .filter(|row| !matches!(row, Row::Text(_)))
        .collect();
    assert_eq!(
        controls,
        vec![Row::SignIn],
        "one button, Sign in: no option and no Send"
    );
    assert!(card
        .lines()
        .contains(&"Claude Code needs a paid plan.".to_owned()));
    assert_eq!(
        click(&mut card, &events, NOW + 10, Target::SignIn),
        Did::SignIn("ask:S".into())
    );
    assert!(card.take_answers().is_empty(), "Sign in answers nothing");
}

#[test]
fn a_sign_in_tasks_plan_line_opens_the_makers_price_page_from_the_apps_own_facts() {
    // The record's step names the page's host; the address opened is the one the app ships, whatever the record says.
    let events = vec![ask(
        "P",
        "unblock",
        json!([{"id": "done", "label": "I did it", "decision": "none"}]),
        json!({
            "steps": ["Press Sign in", "Claude Code needs a paid plan. Its plans: claude.com/pricing"],
            "where": "w", "why": "w", "unblocks": ["req:0"], "proves": "claude-code sign-in probe",
        }),
    )];
    let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
    let controls: Vec<Row> = card
        .rows()
        .into_iter()
        .filter(|row| !matches!(row, Row::Text(_)))
        .collect();
    assert_eq!(
        controls,
        vec![
            Row::SignIn,
            Row::Page("Claude Code needs a paid plan. Its plans: claude.com/pricing".into())
        ],
        "Sign in, and the plan line as the way to the price page"
    );
    assert_eq!(
        click(&mut card, &events, NOW + 10, Target::Page),
        Did::Page("https://claude.com/pricing".into())
    );
    assert!(
        card.take_answers().is_empty(),
        "the price page answers nothing"
    );
}

#[test]
fn a_click_before_the_interval_is_refused_and_recorded_once_and_one_after_answers_the_drawn_option()
{
    let events = vec![taste("A")];
    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER - 1, Target::Option(1)),
        Did::Refused
    );
    assert!(card.lines().contains(&HOLD_STILL.to_owned()));
    assert!(card.take_answers().is_empty());
    card.tick(NOW + ARM_AFTER);
    assert!(
        !card.lines().contains(&HOLD_STILL.to_owned()),
        "armed, it no longer says to hold still"
    );
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Option(1)),
        Did::Answered
    );
    let answers = card.take_answers();
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0]["option"], "green");
    assert_eq!(answers[0]["ask"], "ask:A");
    assert!(
        answers[0].get("token").is_none(),
        "a taste answer carries no click token"
    );
    let rows = usage_rows(&mut card);
    assert_eq!(rows, ["presented", "refused", "answered"]);
    assert_eq!(card.state_name(), "answered");
    assert!(card.lines().contains(&"Undo".to_owned()));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER + 100, Target::Undo),
        Did::Undone
    );
    assert_eq!(card.state_name(), "presented");
    assert_eq!(card.take_usage()[0]["row"], "undone");
}

#[test]
fn an_approval_whose_own_step_cant_be_undone_waits_for_its_switch() {
    let delete = approval("D");
    let events = vec![
        delete,
        json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:D", "steps": [{"does": "delete the branch", "undo": "none", "public": true}], "diff": "d", "hash": "h"}}),
    ];
    let mut card = Controller::present(&events, "ask:D", NOW, SLOT, Faults::default()).unwrap();
    assert_eq!(card.approve(), Some((0, 1)));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Option(0)),
        Did::Nothing
    );
    assert!(
        card.take_answers().is_empty(),
        "the core would run the delete: nothing is sent"
    );
    assert!(card.lines().contains(&SWITCH_FIRST.to_owned()));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER + 100, Target::Step(0)),
        Did::Switched
    );
    assert!(!card.lines().contains(&SWITCH_FIRST.to_owned()));
    assert_eq!(card.approve(), Some((1, 1)));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER + 200, Target::Option(0)),
        Did::Answered
    );
    assert_eq!(card.take_answers()[0]["option"], "approve");
}

#[test]
fn switching_the_asks_own_steps_off_while_the_os_asks_sends_nothing() {
    let push = approval("P");
    let events = vec![
        push,
        json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:P", "steps": [{"does": "push the branch", "undo": "force back", "public": true}], "diff": "d", "hash": "h"}}),
    ];
    let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
    let t = NOW + ARM_AFTER;
    for (dt, phase) in [(0, Phase::Down), (30, Phase::Up)] {
        card.press(synthetic(t + dt, Target::Option(0), phase), &events, t + dt);
    }
    assert!(
        card.machine.confirming().is_some(),
        "the OS asks about the approval"
    );
    assert_eq!(
        click(&mut card, &events, t + 100, Target::Step(0)),
        Did::Switched
    );
    assert_eq!(card.confirmed(true, &events, t + 200), Did::Nothing);
    assert!(
        card.take_answers().is_empty(),
        "the step was switched off: nothing is sent"
    );
    assert!(card.lines().contains(&SWITCH_FIRST.to_owned()));
}

#[test]
fn on_an_asks_page_the_box_holds_the_words_and_says_no_on_an_approval() {
    let events = vec![approval("P"), taste("B")];
    let mut push = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
    assert_eq!(push.words_send(), ("Say no", vec![]));
    push.type_words("yes, but squash first");
    assert_eq!(
        push.words_send(),
        ("Say no", vec![ANSWERS_THIS_ASK_ONLY, WONT_RUN])
    );
    let rows = push.page_rows();
    assert!(
        !rows.contains(&Row::Send),
        "the card draws no Send of its own"
    );
    assert!(rows
        .iter()
        .all(|r| !r.label().starts_with("Your words") && r.label() != WONT_RUN));
    let mut taste = Controller::present(&events, "ask:B", NOW, SLOT, Faults::default()).unwrap();
    taste.type_words("keep it, but smaller");
    assert_eq!(taste.words_send(), ("Answer", vec![ANSWERS_THIS_ASK_ONLY]));
    // A moved slot presents it again, unarmed.
    taste.tick(NOW + ARM_AFTER);
    assert_eq!(taste.state_name(), "armed");
    taste.placed(
        Slot {
            rect: [10, 10, CARD_SIZE[0], CARD_SIZE[1]],
            ..SLOT
        },
        NOW + ARM_AFTER + 1,
    );
    assert_eq!(taste.state_name(), "presented");
}

#[test]
fn words_alone_answer_this_ask_only_and_a_typed_yes_never_runs_the_plan() {
    let push = approval("P");
    let events = vec![
        push,
        taste("B"),
        json!({"kind": "plan.proposed", "id": "p", "writer": "core", "session": "S", "log_pos": 2, "data": {"ask": "ask:P", "steps": [{"does": "git push", "undo": "force back", "public": true}], "diff": "d", "hash": "h"}}),
    ];
    let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
    card.type_words("yes");
    assert!(card.lines().contains(&WONT_RUN.to_owned()));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Send),
        Did::Answered
    );
    let answers = card.take_answers();
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0]["words"], "yes");
    assert!(answers[0].get("option").is_none() && answers[0].get("plan_hash").is_none());

    let mut card = Controller::present(&events, "ask:P", NOW, SLOT, Faults::default()).unwrap();
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Option(0)),
        Did::Answered
    );
    let answers = card.take_answers();
    assert_eq!(answers[0]["option"], "approve");
    assert_eq!(answers[0]["plan_hash"], "h");
    assert!(answers[0]["token"]
        .as_str()
        .is_some_and(|token| token.len() == 64));

    let mut card = Controller::present(&events, "ask:B", NOW, SLOT, Faults::default()).unwrap();
    card.type_words("darker");
    assert!(card.lines().contains(&ANSWERS_THIS_ASK_ONLY.to_owned()));
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Send),
        Did::Answered
    );
    assert_eq!(
        card.take_answers().len(),
        1,
        "the words answer this ask alone, never the other open ask with the key"
    );
}

#[test]
fn an_untrusted_press_waits_for_the_os_and_a_cancelled_prompt_leaves_the_card_armed() {
    let events = vec![taste("A")];
    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    let t = NOW + ARM_AFTER;
    card.press(synthetic(t, Target::Option(1), Phase::Down), &events, t);
    let did = card.press(
        synthetic(t + 30, Target::Option(1), Phase::Up),
        &events,
        t + 30,
    );
    let Did::NeedsConfirmation(reason) = did else {
        panic!("{did:?}")
    };
    assert!(
        reason.contains("Question A?") && reason.contains("Green"),
        "{reason}"
    );
    assert_eq!(card.confirmed(false, &events, t + 40), Did::Nothing);
    assert_eq!(card.state_name(), "armed");
    assert!(card.take_answers().is_empty());
    card.press(
        synthetic(t + 50, Target::Option(1), Phase::Down),
        &events,
        t + 50,
    );
    card.press(
        synthetic(t + 80, Target::Option(1), Phase::Up),
        &events,
        t + 80,
    );
    assert_eq!(card.confirmed(true, &events, t + 90), Did::Answered);
    assert_eq!(card.take_answers()[0]["option"], "green");
}

#[test]
fn tab_reaches_each_option_and_space_presses_the_focused_one() {
    let events = vec![taste("A")];
    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    card.key("tab", NOW, Source::Hardware, &events, NOW);
    assert_eq!(card.focused(), Some(0));
    card.key("tab", NOW, Source::Hardware, &events, NOW);
    assert_eq!(card.focused(), Some(1));
    assert_eq!(
        card.key("space", NOW + 10, Source::Hardware, &events, NOW + 10),
        Did::Refused
    );
    assert_eq!(
        card.key(
            "space",
            NOW + ARM_AFTER,
            Source::Hardware,
            &events,
            NOW + ARM_AFTER
        ),
        Did::Answered
    );
    assert_eq!(card.take_answers()[0]["option"], "green");
}

#[test]
fn a_check_finishing_while_the_card_shows_changes_what_it_says_and_presents_it_again_unarmed() {
    let start = json!({"kind": "run.started", "writer": "core", "data": {"run": "r1", "check": "unit", "claim": "c", "commit": "abc"}});
    let mut events = vec![taste("A"), start];
    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    assert!(card
        .lines()
        .contains(&"look at: unit, still running".to_owned()));
    card.tick(NOW + ARM_AFTER);
    let first = card.seq();
    assert_eq!(card.state_name(), "armed");

    // A change the card doesn't show leaves it armed on the same presentation.
    events.push(json!({"kind": "note.added", "writer": "core", "data": {}}));
    card.record_changed(&events, NOW + ARM_AFTER + 10);
    assert_eq!((card.state_name(), card.seq()), ("armed", first));

    events.push(json!({"kind": "run.finished", "writer": "core", "data": {"run": "r1", "check": "unit", "outcome": "failed", "points_to": "src/a.rs:3", "findings": []}}));
    card.record_changed(&events, NOW + ARM_AFTER + 20);
    let lines = card.lines();
    assert!(
        lines.contains(&"checks: 0 of 1 passed".to_owned()),
        "{lines:?}"
    );
    assert!(
        lines.contains(&"look at: src/a.rs:3".to_owned()),
        "{lines:?}"
    );
    assert_eq!(card.state_name(), "presented");
    assert_ne!(card.seq(), first);
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER + 30, Target::Option(1)),
        Did::Refused,
        "a press on what it said before is refused"
    );
    let rows = usage_rows(&mut card);
    assert_eq!(rows, ["presented", "presented", "refused"]);

    // Send held down on what it said before answers nothing on release, even once armed again.
    card.tick(NOW + ARM_AFTER + 1_000);
    card.type_words("Blue, but darker");
    let at = NOW + ARM_AFTER + 1_100;
    assert_eq!(
        card.press(hardware(at, Target::Send, Phase::Down), &events, at),
        Did::Nothing
    );
    events.push(json!({"kind": "run.started", "writer": "core", "data": {"run": "r2", "check": "unit", "claim": "c", "commit": "abc"}}));
    card.record_changed(&events, at + 50);
    let up = at + 50 + ARM_AFTER + 100;
    assert_eq!(
        card.press(hardware(up, Target::Send, Phase::Up), &events, up),
        Did::Nothing
    );
    assert!(card.take_answers().is_empty());
}

#[test]
fn a_batch_card_follows_a_member_closing_and_a_plan_landing_and_keeps_your_switches() {
    let authority = |id: &str| {
        ask(
            id,
            "authority",
            json!([{"id": "allow", "label": "Allow", "decision": "allow"}, {"id": "deny", "label": "Deny", "decision": "deny"}]),
            json!({"subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}}),
        )
    };
    let plan = |id: &str, undo: &str| {
        json!({"kind": "plan.proposed", "id": format!("P{id}"), "writer": "core", "log_pos": 2, "data": {
                "ask": format!("ask:{id}"), "diff": "d".repeat(64), "hash": id.repeat(64),
                "steps": [{"does": format!("push {id}"), "changes": [], "undo": undo, "public": false, "cost": 0}]}})
    };
    let mut events = vec![
        authority("A"),
        authority("B"),
        authority("C"),
        plan("A", "force-push back"),
        plan("B", "none"),
        json!({"kind": "ask.batched", "id": "K", "writer": "core", "log_pos": 4, "data": {"batch": "b", "asks": [
                {"ask": "ask:A", "plan_hash": null}, {"ask": "ask:B", "plan_hash": null}, {"ask": "ask:C", "plan_hash": null}]}}),
    ];
    let mut card = Controller::present(&events, "ask:C", NOW, SLOT, Faults::default()).unwrap();
    let doing = |card: &Controller| -> Vec<(String, bool)> {
        card.model()
            .steps
            .iter()
            .map(|step| (step.does.clone(), step.on))
            .collect()
    };
    assert_eq!(
        doing(&card),
        [("push A".to_owned(), true), ("push B".to_owned(), false)]
    );
    assert_eq!(card.model().plan_hash, None);
    card.toggle_step(1);
    card.toggle_step(0);
    assert_eq!(
        doing(&card),
        [("push A".to_owned(), false), ("push B".to_owned(), true)]
    );
    card.tick(NOW + ARM_AFTER);
    let first = card.seq();

    // C's own plan lands after the card showed: its step draws, its hash binds, and your switches stand.
    events.push(plan("C", "none"));
    card.record_changed(&events, NOW + ARM_AFTER + 10);
    assert_eq!(
        doing(&card),
        [
            ("push A".to_owned(), false),
            ("push B".to_owned(), true),
            ("push C".to_owned(), false)
        ]
    );
    assert_eq!(card.model().plan_hash, Some("C".repeat(64)));
    assert_eq!(card.state_name(), "presented");
    assert_ne!(card.seq(), first);

    // A is answered on its own card: the core won't run it, so the card neither draws nor counts it.
    events.push(json!({"kind": "ask.answered", "writer": "core", "subject": "ask:A", "data": {}}));
    card.record_changed(&events, NOW + ARM_AFTER + 20);
    assert_eq!(
        doing(&card),
        [("push B".to_owned(), true), ("push C".to_owned(), false)]
    );
    assert_eq!(card.model().runs(), [1, 2]);
}

#[test]
fn a_record_change_the_card_doesnt_show_leaves_it_armed_however_late_it_comes() {
    let mut events = vec![taste("A")];
    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    card.tick(NOW + ARM_AFTER);
    let first = card.seq();
    // A day on, when its default applies reads differently: that's the clock, not the record.
    events.push(json!({"kind": "note.added", "writer": "core", "data": {}}));
    card.record_changed(&events, NOW + 86_400_000);
    assert_eq!((card.state_name(), card.seq()), ("armed", first));
}

#[test]
fn a_closed_ask_is_never_presented_and_one_closing_elsewhere_takes_its_card_down() {
    let mut events = vec![taste("A"), taste("B")];
    events.push(json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:B", "data": {}}));
    assert!(Controller::present(&events, "ask:B", NOW, SLOT, Faults::default()).is_none());

    let mut card = Controller::present(&events, "ask:A", NOW, SLOT, Faults::default()).unwrap();
    card.tick(NOW + ARM_AFTER);
    // Answered on another device: the core takes no answer now, so this card answers nothing.
    events.push(json!({"kind": "ask.answered", "writer": "core", "subject": "ask:A", "data": {}}));
    card.record_changed(&events, NOW + ARM_AFTER + 10);
    assert_eq!(card.state_name(), "hidden");
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER + 20, Target::Option(1)),
        Did::Nothing
    );
    assert!(card.take_answers().is_empty());
}

#[test]
fn a_batch_approvals_receipt_lists_the_other_members_it_ran() {
    let authority = |id: &str| {
        ask(
            id,
            "authority",
            json!([{"id": "allow", "label": "Allow", "decision": "allow"}, {"id": "deny", "label": "Deny", "decision": "deny"}]),
            json!({"key": format!("k{id}"), "subject": {"effect": "push", "target": {"kind": "branch", "ref": "main", "owner": "you"}, "change": null}}),
        )
    };
    let plan = |id: &str| {
        json!({"kind": "plan.proposed", "id": format!("P{id}"), "writer": "core", "log_pos": 2, "data": {
                "ask": format!("ask:{id}"), "diff": "d".repeat(64), "hash": id.repeat(64),
                "steps": [{"does": format!("push {id}"), "changes": [], "undo": "force-push back", "public": false, "cost": 0}]}})
    };
    let events = vec![
        authority("A"),
        authority("B"),
        authority("C"),
        plan("A"),
        plan("B"),
        plan("C"),
        json!({"kind": "ask.batched", "id": "K", "writer": "core", "log_pos": 4, "data": {"batch": "b", "asks": [
                {"ask": "ask:A", "plan_hash": null}, {"ask": "ask:B", "plan_hash": null}, {"ask": "ask:C", "plan_hash": null}]}}),
    ];
    let mut card = Controller::present(&events, "ask:B", NOW, SLOT, Faults::default()).unwrap();
    card.toggle_step(2);
    card.tick(NOW + ARM_AFTER);
    assert_eq!(
        click(&mut card, &events, NOW + ARM_AFTER, Target::Option(0)),
        Did::Answered
    );
    assert_eq!(card.take_answers()[0]["steps"], json!([0, 1]));
    let lines = card.lines();
    assert!(
        lines.contains(&"Also answered: Question A?".to_owned()),
        "{lines:?}"
    );
    assert!(
        !lines.iter().any(|line| line.contains("Question C?")),
        "C was switched off: {lines:?}"
    );
    assert!(
        !lines.contains(&"Also answered: Question B?".to_owned()),
        "the receipt is B's own: {lines:?}"
    );
}

/// #1510: the card marks the set `deep inbox` marks, each character in place; joiners and selectors stay.
#[test]
fn visible_marks_each_control_direction_and_invisible_character() {
    let marked = [
        (0x00, 0x1f),
        (0x7f, 0x9f),
        (0x61c, 0x61c),
        (0x200b, 0x200b),
        (0x200e, 0x200f),
        (0x2028, 0x202e),
        (0x2060, 0x2064),
        (0x2066, 0x206f),
        (0xfeff, 0xfeff),
        (0xfff9, 0xfffb),
        (0xe0000, 0xe007f),
    ];
    for (from, to) in marked {
        for n in from..=to {
            let c = char::from_u32(n).unwrap();
            let escape = match c {
                '\n' => "\\n".to_owned(),
                '\r' => "\\r".to_owned(),
                '\t' => "\\t".to_owned(),
                _ if n < 0x100 => format!("\\x{n:02x}"),
                _ => format!("\\u{{{n:x}}}"),
            };
            assert_eq!(
                visible(&format!("a{c}b")),
                format!("a{escape}b"),
                "U+{n:04X}"
            );
        }
    }
    for n in [
        0x20, 0x7e, 0xa0, 0x61b, 0x200c, 0x200d, 0x2027, 0x202f, 0x2065, 0xfe0f, 0xfffc, 0xe0080,
    ] {
        let c = char::from_u32(n).unwrap().to_string();
        assert_eq!(visible(&c), c, "U+{n:04X}");
    }
}
