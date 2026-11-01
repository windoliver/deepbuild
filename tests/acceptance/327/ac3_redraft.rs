//! #327.f53f09db, redrafted blind from issue #327, docs/technical-design.md, docs/canvas-primitives.md, the base
//! 0f7fb686 and this folder's common.rs and fixtures:
//!
//! "With the app's window closed or hidden, every ask that shows at once reaches you as a notification carrying its
//! question, its default and when the default applies; clicking it opens that ask's card, and no notification action
//! writes an answer"
//!
//! The design passages this check relies on:
//! - technical-design.md, States people see (view row): "A notification carries the question, its default and when
//!   the default applies, opens the ask's card when clicked and answers nothing; it fires only if the state still
//!   holds a second later, and skips the session you're looking at."
//! - technical-design.md, the DeepBuild app row: "notifications carry each ask's question, its default and when the
//!   default applies, open the ask's card when clicked and answer nothing".
//! - technical-design.md, asks, "Every ask ends": "Asks come in batches, a few visits a day, and one whose deadline
//!   would pass before the next batch shows at once". So the asks below all have deadlines under four hours, short
//!   enough that each shows at once whatever the batch cadence; none of them could wait for a later batch.
//! - technical-design.md, Decided, "Ask deadlines and defaults": authority defaults to no, taste to the recommended
//!   option. The default an ask carries is its `default` option, named here by that option's label.
//! - canvas-primitives.md, Question card: an answer is `{option | null, decision, words, image, serial, plan_hash}`
//!   sent as `ask.answer`; the card "can never ... be answered by an agent, by a synthetic or unnamed accessibility
//!   input without the OS confirming you, or before it arms". A notification is none of the inputs that may answer.
//!
//! The scenario: device 0's window shows S1's page and is then hidden, so nothing is being looked at and even S1's own
//! ask must notify (the "skips the session you're looking at" rule can't excuse it). Three asks of two kinds then show
//! at the same moment in three sessions: a taste call in S1, a push's authority ask in S2 and a taste call in S3 (repo
//! docs, so it joins nothing). Each must reach you as its own notification (`Posted.ask` names it, since clicking it
//! must open that ask's card) carrying its question, its default's label and when the default applies. Clicking each
//! opens that ask's card on the device, sends no `ask.answer`, writes no `answered` usage row and leaves the ask open,
//! also after the card's arm interval has passed with no press.
//!
//! What this leaves open, and why:
//! - "Closed": the replica has `hide_window` and no way to close the window while the app keeps running (on macOS a
//!   closed window leaves the app in the menu bar, which for notifications is the same state: no page is looked at).
//!   Only "hidden" is exercised here.
//! - The notification's wording and layout. Neither the issue nor the design fixes them, so the question is matched
//!   as the ask's question text, the default as its option's label, and "when the default applies" as the time left
//!   from the notification's own post time to the ask's deadline, in whole minutes or (an hour or more) whole hours,
//!   rounded either way, with the unit abbreviated or spelled out ("25 m", "25 min", "3 h", "3 hours", "180 min"),
//!   or else as the deadline's clock time "HH:MM" in the process's time zone. Neither the issue nor the design names a
//!   zone, so the test doesn't choose one for the app: `main` fixes the process's zone (TZ=UTC) before anything runs,
//!   so the app's local time and the time this check computes are the same zone whatever the machine is set to, and
//!   the result doesn't depend on the machine's zone. The deadlines are chosen so no ask's accepted spans are
//!   another's. A notification that holds the default's label beside another option's label must mark which is the
//!   default (the word "default" before the label), or it doesn't carry its default; one that names only the default
//!   option isn't asked to use that word.
//! - How many notifications an ask may post, which device sounds and the one-second wait are #326's; this check asks
//!   only that each ask has one and that every one it has carries all three.
//! - Whether clicking a notification also shows the hidden window: the replica's `click` opens the card on the
//!   notification's device, and that is what is judged (`Replica::card` and `card_seen` name the ask).
//!
//! Target (beside card.rs and planted.rs in crates/deep-replica/Cargo.toml; no harness, as AppKit needs the main
//! thread):
//!   [[test]] name = "acceptance_327_ac3_redraft", path = "../../tests/acceptance/327/ac3_redraft.rs", harness = false
#![allow(dead_code)]

mod common;

use common::*;
use deep_replica::{Planted, Posted, Replica};
use serde_json::{json, Value};

const MINUTE: u64 = 60_000;

const S1_Q: &str = "Which header colour on the checkout total?";
const S3_Q: &str = "Which header for the docs example's total?";

/// One ask raised for the scenario: its handle, question, deadline and the labels of its options, the default first.
struct Raised {
    handle: String,
    question: String,
    deadline: u64,
    default_label: String,
    other_labels: Vec<String>,
}

fn raised(event: &Value) -> Raised {
    let data = &event["data"];
    let default_id = data["default"].as_str().expect("the ask has a default");
    let options = data["options"].as_array().expect("the ask has options");
    let label = |o: &Value| o["label"].as_str().unwrap().to_string();
    Raised {
        handle: format!("ask:{}", event["id"].as_str().unwrap()),
        question: data["question"].as_str().unwrap().to_string(),
        deadline: data["deadline"].as_u64().unwrap(),
        default_label: options.iter().find(|o| o["id"] == default_id).map(label).expect("the default is an option"),
        other_labels: options.iter().filter(|o| o["id"] != default_id).map(label).collect(),
    }
}

/// Raises the three asks at the same moment; answers them in the order raised.
fn raise_three(replica: &mut Replica) -> Vec<Raised> {
    let now = replica.now();

    // S1, the session the window showed: a taste call, defaulting to the recommended "Blue header", 25 minutes left.
    let mut taste = stamped(live("taste"), replica);
    taste["data"]["question"] = json!(S1_Q);
    taste["data"]["deadline"] = json!(now + 25 * MINUTE);

    // S2: a push's authority ask, defaulting to "Decline", 3 hours left, with its plan.
    let mut push = stamped(live("push"), replica);
    push["data"]["deadline"] = json!(now + 180 * MINUTE);
    let mut plan = stamped(live("plan.proposed"), replica);

    // S3 (repo docs): a taste call, defaulting to "B: bone header", 50 minutes left.
    let mut abc = stamped(live("taste-abc"), replica);
    abc["data"]["question"] = json!(S3_Q);
    abc["data"]["deadline"] = json!(now + 50 * MINUTE);
    abc["data"]["subject"] = json!({"screen": "docs-example", "element": "total"});

    let asks = vec![raised(&taste), raised(&push), raised(&abc)];
    plan["data"]["ask"] = json!(asks[1].handle);
    replica.append(S1, taste);
    replica.append(S2, push);
    replica.append(S2, plan);
    replica.append(S3, abc);
    asks
}

/// Every `<number><optional space><unit word>` in the text, as (number, unit), the unit lowercased.
fn spans_in(text: &str) -> Vec<(u64, String)> {
    let chars: Vec<char> = text.chars().collect();
    let mut found = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() || (i > 0 && (chars[i - 1].is_ascii_digit() || chars[i - 1] == ':')) {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i < chars.len() && chars[i] == ':' {
            continue; // a clock time, read by says_when
        }
        let number: u64 = chars[start..i].iter().collect::<String>().parse().unwrap_or(u64::MAX);
        let mut j = i;
        if j < chars.len() && chars[j] == ' ' {
            j += 1;
        }
        let unit: String = chars[j..].iter().take_while(|c| c.is_alphabetic()).collect::<String>().to_lowercase();
        if !unit.is_empty() {
            found.push((number, unit));
        }
    }
    found
}

fn is_minutes(unit: &str) -> bool {
    matches!(unit, "m" | "min" | "mins" | "minute" | "minutes")
}

fn is_hours(unit: &str) -> bool {
    matches!(unit, "h" | "hr" | "hrs" | "hour" | "hours")
}

/// The renderings of "when the default applies" this check accepts for a deadline, read at `at` (see the header).
fn says_when(text: &str, at: u64, deadline: u64) -> bool {
    let left = deadline.saturating_sub(at);
    let minutes = [left / MINUTE, left.div_ceil(MINUTE)];
    let hours = [left / (60 * MINUTE), left.div_ceil(60 * MINUTE)];
    let by_span = spans_in(text).iter().any(|(n, unit)| {
        (is_minutes(unit) && minutes.contains(n)) || (is_hours(unit) && left >= 60 * MINUTE && hours.contains(n))
    });
    // The deadline's clock time in the process's zone, which `main` fixes to UTC (offset 0, no daylight saving).
    let of_day = (deadline / MINUTE) % (24 * 60);
    let clock = format!("{:02}:{:02}", of_day / 60, of_day % 60);
    by_span || text.contains(&clock)
}

/// Whether the text carries the ask's default: its label, marked as the default when other options are named too.
fn carries_default(text: &str, ask: &Raised) -> bool {
    if !text.contains(&ask.default_label) {
        return false;
    }
    if !ask.other_labels.iter().any(|other| text.contains(other.as_str())) {
        return true;
    }
    let lower = text.to_lowercase();
    lower.match_indices("default").any(|(i, _)| text[i..].contains(&ask.default_label))
}

/// The whole criterion against one replica; the failures, each naming the ask and what broke.
fn scenario(mut replica: Replica) -> Vec<String> {
    let mut failures = Vec::new();

    // The window showed S1's page, then was hidden: nothing is looked at.
    replica.focus(0, Some(S1));
    replica.hide_window(0);
    replica.advance(ms(100));

    let asks = raise_three(&mut replica);
    let open = replica.open_asks();
    for ask in &asks {
        if !open.contains(&ask.handle) {
            failures.push(format!("{}: not open after it was raised (open: {open:?}); the scenario can't be judged", ask.handle));
        }
    }
    if !failures.is_empty() {
        return failures;
    }

    // Past the one-second hold the design gives every notification.
    replica.advance(ms(2_000));

    let mut to_click: Vec<(&Raised, Posted)> = Vec::new();
    for ask in &asks {
        let posts = posts_for(&replica, &ask.handle);
        if posts.is_empty() {
            failures.push(format!(
                "{}: with the window hidden, the ask {:?} reached you as no notification of its own (posted: {:?})",
                ask.handle,
                ask.question,
                replica.notifications()
            ));
            continue;
        }
        for posted in &posts {
            if !posted.text.contains(&ask.question) {
                failures.push(format!("{}: its notification doesn't carry its question {:?}; text: {:?}", ask.handle, ask.question, posted.text));
            }
            if !carries_default(&posted.text, ask) {
                failures.push(format!("{}: its notification doesn't carry its default {:?}; text: {:?}", ask.handle, ask.default_label, posted.text));
            }
            if !says_when(&posted.text, posted.at, ask.deadline) {
                failures.push(format!(
                    "{}: its notification doesn't say when the default applies ({} min after it was posted); text: {:?}",
                    ask.handle,
                    ask.deadline.saturating_sub(posted.at) / MINUTE,
                    posted.text
                ));
            }
        }
        to_click.push((ask, posts[0].clone()));
    }

    // Nothing answered before any click.
    let before = replica.answers();
    if !before.is_empty() {
        failures.push(format!("an answer was sent before any notification was clicked: {before:?}"));
    }

    // Click each notification in turn: it opens that ask's card and answers nothing, also once the card has armed.
    for (ask, posted) in &to_click {
        replica.click(posted);
        replica.advance(ms(50));
        match replica.card(posted.device) {
            Some(card) if &card == &ask.handle => {}
            other => failures.push(format!("{}: clicking its notification opened {other:?}, not its card", ask.handle)),
        }
        match replica.card_seen(posted.device) {
            Some(seen) if seen.ask == ask.handle && seen.state != "answered" => {}
            other => failures.push(format!("{}: after clicking its notification the card shown is {other:?}", ask.handle)),
        }
        replica.advance(ms(ARM_AFTER + 100));
        if let Some(seen) = replica.card_seen(posted.device) {
            if seen.ask == ask.handle && seen.state == "answered" {
                failures.push(format!("{}: the card a notification opened is answered without a press", ask.handle));
            }
        }
    }

    for ask in &asks {
        let sent = answers_for(&replica, &ask.handle);
        if !sent.is_empty() {
            failures.push(format!("{}: a notification action wrote an answer: {sent:?}", ask.handle));
        }
        let answered: Vec<Value> = usage_for(&replica, &ask.handle).into_iter().filter(|row| row["row"] == "answered").collect();
        if !answered.is_empty() {
            failures.push(format!("{}: an answered usage row was written with no press on its card: {answered:?}", ask.handle));
        }
    }
    let open = replica.open_asks();
    for ask in &asks {
        if !open.contains(&ask.handle) {
            failures.push(format!("{}: closed after its notification was clicked, with no press on its card", ask.handle));
        }
    }
    failures
}

fn every_ask_notifies_and_its_click_opens_its_card_and_answers_nothing() {
    let failures = scenario(Replica::open(&fixture("base.events.jsonl")));
    assert!(failures.is_empty(), "#327.f53f09db:\n  {}", failures.join("\n  "));
}

/// The wrong program the criterion names, a notification action that writes an answer, fails, naming the ask.
fn a_notification_action_that_answers_fails() {
    let failures = scenario(Replica::planted(&fixture("base.events.jsonl"), Planted::NotificationActionAnswers));
    assert!(
        failures.iter().any(|f| f.starts_with("ask:") && (f.contains("wrote an answer") || f.contains("answered"))),
        "a notification action that answers passed the check: {failures:?}"
    );
}

fn main() {
    // The process's time zone, fixed before any thread starts or any time is read, so a clock time the app draws in
    // local time and the one says_when computes are in the same zone on any machine (see the header).
    std::env::set_var("TZ", "UTC");
    std::process::exit(run(&[
        ("ac3_redraft_every_ask_notifies_and_its_click_opens_its_card_and_answers_nothing", every_ask_notifies_and_its_click_opens_its_card_and_answers_nothing),
        ("ac3_redraft_planted_a_notification_action_that_answers_fails", a_notification_action_that_answers_fails),
    ]));
}
