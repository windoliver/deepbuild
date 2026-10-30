//! Shared by card.rs (the criteria) and planted.rs (the wrong programs they name): the fixtures,
//! the live events the cases append, the judges that read a card, and the harness. Written blind
//! for #327; the surface it reaches is pinned in this folder's README.md (The surfaces: the
//! replica), and every name below that the base lacks is listed there.
#![allow(dead_code)]

use std::cell::Cell;
use std::path::PathBuf;
use std::time::Duration;

use deep_replica::{repo_root, CardSeen, Input, On, Phase, Posted, Replica, Source};
use serde_json::{json, Value};

pub const DAY: u64 = 86_400_000;
pub const HOUR: u64 = 3_600_000;
/// Question card: `arm_after` is 500 ms.
pub const ARM_AFTER: u64 = 500;

pub const S1: &str = "01MD327SESS000000000000S01";
pub const S2: &str = "01MD327SESS000000000000S02";
pub const S3: &str = "01MD327SESS000000000000S03";

pub fn fixture(name: &str) -> PathBuf {
    repo_root().join("tests/acceptance/327/fixtures").join(name)
}

pub fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

// ---- Live events, from fixtures/live.json's templates.

thread_local! {
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

/// A fresh event ID: a ULID-shaped string of digits, never one the fixtures use.
pub fn next_id() -> String {
    NEXT.with(|next| {
        let n = next.get();
        next.set(n + 1);
        format!("01MD3279{n:018}")
    })
}

pub fn live(name: &str) -> Value {
    let path = fixture("live.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let all: Value = serde_json::from_str(&text).expect("live.json is JSON");
    let mut event = all.get(name).cloned().unwrap_or_else(|| panic!("live.json has no {name} template"));
    event["id"] = json!(next_id());
    event
}

pub fn stamped(mut event: Value, replica: &Replica) -> Value {
    event["ts"] = json!(replica.now());
    event
}

/// Raises a taste call on the checkout total in `session` now, with its own question; answers its handle.
pub fn raise_taste(replica: &mut Replica, session: &str, question: &str) -> String {
    let mut event = stamped(live("taste"), replica);
    event["data"]["question"] = json!(question);
    event["data"]["deadline"] = json!(replica.now() + 3 * DAY);
    let handle = format!("ask:{}", event["id"].as_str().unwrap());
    replica.append(session, event);
    handle
}

/// Raises the taste call with options A, C, B in record order, B recommended; answers its handle.
pub fn raise_taste_abc(replica: &mut Replica, session: &str) -> String {
    let mut event = stamped(live("taste-abc"), replica);
    event["data"]["deadline"] = json!(replica.now() + 3 * DAY);
    let handle = format!("ask:{}", event["id"].as_str().unwrap());
    replica.append(session, event);
    handle
}

/// Raises a push's authority ask with its plan; answers `(handle, plan hash)`.
pub fn raise_push(replica: &mut Replica, session: &str) -> (String, String) {
    let mut event = stamped(live("push"), replica);
    event["data"]["deadline"] = json!(replica.now() + DAY);
    let handle = format!("ask:{}", event["id"].as_str().unwrap());
    replica.append(session, event);
    let mut plan = stamped(live("plan.proposed"), replica);
    plan["data"]["ask"] = json!(handle);
    let hash = plan["data"]["hash"].as_str().unwrap().to_string();
    replica.append(session, plan);
    (handle, hash)
}

/// The ask the kind fixture holds open, by `ask.created` order: the first, or the `n`th.
pub fn fixture_ask(name: &str, n: usize) -> String {
    let path = fixture(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let ids: Vec<String> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).expect("a fixture line is JSON"))
        .filter(|row| row["event"]["kind"] == "ask.created")
        .map(|row| format!("ask:{}", row["event"]["id"].as_str().unwrap()))
        .collect();
    ids.get(n).cloned().unwrap_or_else(|| panic!("{name} has no ask.created number {n}"))
}

/// The `ask.created` data of an ask in a fixture.
pub fn fixture_ask_data(name: &str, ask: &str) -> Value {
    let path = fixture(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).expect("a fixture line is JSON"))
        .find(|row| row["event"]["kind"] == "ask.created" && format!("ask:{}", row["event"]["id"].as_str().unwrap()) == ask)
        .map(|row| row["event"]["data"].clone())
        .unwrap_or_else(|| panic!("{name} has no ask.created for {ask}"))
}

// ---- Presses.

pub fn hid(at: u64, on: On, phase: Phase) -> Input {
    Input { at, source: Source::Hid, on, phase }
}

/// A hardware click: down and, 30 ms later, up, both stamped by the platform.
pub fn click(replica: &mut Replica, device: usize, on: On) {
    let at = replica.now();
    replica.press(device, hid(at, on.clone(), Phase::Down));
    replica.advance(ms(30));
    replica.press(device, hid(at + 30, on, Phase::Up));
}

/// A click from `source` on `on`, down and up 30 ms apart.
pub fn click_from(replica: &mut Replica, device: usize, source: Source, on: On) {
    let at = replica.now();
    replica.press(device, Input { at, source: source.clone(), on: on.clone(), phase: Phase::Down });
    replica.advance(ms(30));
    replica.press(device, Input { at: at + 30, source, on, phase: Phase::Up });
}

/// Presents `ask` on device 0 and lets its arm interval pass; answers the card as armed.
pub fn present_armed(replica: &mut Replica, ask: &str) -> CardSeen {
    let card = replica.present(0, ask);
    assert_eq!(card.state, "presented", "{ask}: the card is presented first; got {card:?}");
    replica.advance(ms(ARM_AFTER + 20));
    let card = replica.card_seen(0).unwrap_or_else(|| panic!("{ask}: no card on device 0 after presenting it"));
    assert_eq!(card.state, "armed", "{ask}: the card arms {ARM_AFTER} ms after presentation; got {card:?}");
    card
}

/// The draw-order index of the option with `label` on a card.
pub fn option_index(card: &CardSeen, label: &str) -> usize {
    card.options
        .iter()
        .position(|o| o == label)
        .unwrap_or_else(|| panic!("{}: no option labelled {label:?} among {:?}", card.ask, card.options))
}

/// The `ask.answer` calls the app sent for `ask`.
pub fn answers_for(replica: &Replica, ask: &str) -> Vec<Value> {
    replica.answers().into_iter().filter(|a| a["ask"] == ask).collect()
}

pub fn posts_for(replica: &Replica, ask: &str) -> Vec<Posted> {
    replica.notifications().into_iter().filter(|posted| posted.ask.as_deref() == Some(ask)).collect()
}

/// Usage rows for `ask`, as `(row, kind)` with their fields checked.
pub fn usage_for(replica: &Replica, ask: &str) -> Vec<Value> {
    replica.usage().into_iter().filter(|row| row["ask"] == ask).collect()
}

// ---- Judges: what a card's text must hold. Each answers the failures, naming the kind and the ask.

/// The span until a deadline as the card must say it: the whole days or hours left, as "3 d" or "4 h"
/// (README, Assumptions: a card may say "3 days"; the digit and unit are what is checked).
pub fn span_words(now: u64, deadline: u64) -> Vec<String> {
    let left = deadline.saturating_sub(now);
    if left >= DAY {
        let days = left / DAY;
        vec![format!("{days} d")]
    } else {
        let hours = left / HOUR;
        vec![format!("{hours} h")]
    }
}

/// AC6's common words on every kind: the question, every option's label, the deadline, the default and when it applies.
pub fn judge_common(card: &CardSeen, data: &Value, now: u64) -> Vec<String> {
    let kind = data["kind"].as_str().unwrap_or("?");
    let mut failures = Vec::new();
    let text = &card.text;
    let question = data["question"].as_str().unwrap_or("");
    if !text.contains(question) {
        failures.push(format!("{kind} card {}: the text doesn't hold the question {question:?}", card.ask));
    }
    for option in data["options"].as_array().unwrap() {
        let label = option["label"].as_str().unwrap();
        if !text.contains(label) {
            failures.push(format!("{kind} card {}: the text doesn't hold the option label {label:?}", card.ask));
        }
        if !card.options.iter().any(|o| o == label) {
            failures.push(format!("{kind} card {}: the options drawn ({:?}) leave out {label:?}", card.ask, card.options));
        }
    }
    let default_id = data["default"].as_str().unwrap();
    let default_label = data["options"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["id"] == default_id)
        .and_then(|o| o["label"].as_str())
        .unwrap_or(default_id);
    let lower = text.to_lowercase();
    if !lower.contains("default") {
        failures.push(format!("{kind} card {}: the text never says what the default is (no \"default\")", card.ask));
    }
    // The default's label appears after the word "default" somewhere: the default is named as such.
    let names_default = lower.find("default").map(|i| text[i..].contains(default_label)).unwrap_or(false);
    if !names_default {
        failures.push(format!("{kind} card {}: the text doesn't name the default {default_label:?} as the default", card.ask));
    }
    let deadline = data["deadline"].as_u64().unwrap();
    let spans = span_words(now, deadline);
    if !spans.iter().any(|span| text.contains(span.as_str())) {
        failures.push(format!(
            "{kind} card {}: the text doesn't say when the default applies, {} from now (deadline {deadline}); text: {text:?}",
            card.ask,
            spans.join(" or ")
        ));
    }
    failures
}

/// The fields this issue's Scope lists for each kind (README, Criteria: AC6).
pub fn judge_fields(card: &CardSeen, data: &Value) -> Vec<String> {
    let kind = data["kind"].as_str().unwrap_or("?");
    let text = &card.text;
    let lower = text.to_lowercase();
    let mut failures = Vec::new();
    let mut need = |words: &[&str], what: &str| {
        for word in words {
            if !lower.contains(&word.to_lowercase()) {
                failures.push(format!("{kind} card {}: {what}: the text doesn't hold {word:?}", card.ask));
            }
        }
    };
    match kind {
        "authority" => {
            // A batched approval: the diff preview, whether the target is public and whether it can be undone.
            need(&["diff"], "the diff preview");
            need(&["public"], "whether the target is public");
            need(&["undo"], "whether it can be undone");
        }
        "taste" => {
            let subject = &data["subject"];
            need(&[subject["screen"].as_str().unwrap_or(""), subject["element"].as_str().unwrap_or("")], "the screen and the element the reference is beside");
            need(&["reference"], "the reference beside the live render");
        }
        "unblock" => {
            for step in data["steps"].as_array().unwrap() {
                need(&[step.as_str().unwrap()], "a step only you can take");
            }
            need(&[data["where"].as_str().unwrap(), data["why"].as_str().unwrap()], "where and why");
            need(&[data["proves"].as_str().unwrap()], "the check that proves it");
            if let Some(cost) = data["cost_usd"].as_f64() {
                need(&[&format!("{cost:.2}")], "its cost");
            }
        }
        "choice" if data["subject"]["point"].as_str().map_or(false, |p| p.starts_with("claim:")) => {
            // A stalled claim: split, fund or accept, with costs.
            need(&["split", "fund", "accept", "USD"], "split, fund or accept, with costs");
        }
        "choice" => need(&[data["subject"]["point"].as_str().unwrap_or("")], "the point the choice is pinned to"),
        "exception" => need(&["waive"], "what it would waive or change"),
        "definition" => need(&["done"], "what done means"),
        _ => failures.push(format!("{kind}: not one of the seven card kinds")),
    }
    failures
}

/// The whole AC6 judgement of one kind's card, read now.
pub fn judge_kind(card: &CardSeen, data: &Value, now: u64) -> Vec<String> {
    let mut failures = judge_common(card, data, now);
    failures.extend(judge_fields(card, data));
    if card.kind != data["kind"] {
        failures.push(format!("the card says its kind is {:?}, the record {:?}", card.kind, data["kind"]));
    }
    failures
}

/// The seven kinds, by fixture: file, the name the criterion gives the kind.
pub const KINDS: [(&str, &str); 7] = [
    ("kinds/batched.events.jsonl", "batched authority"),
    ("kinds/taste.events.jsonl", "taste"),
    ("kinds/unblock.events.jsonl", "unblock"),
    ("kinds/stalled.events.jsonl", "stalled claim"),
    ("kinds/choice.events.jsonl", "choice"),
    ("kinds/exception.events.jsonl", "exception"),
    ("kinds/definition.events.jsonl", "early question about done"),
];

// ---- The harness: libtest's result lines, every case on the main thread. A case that panics with a
// message starting "BLOCKED" is printed BLOCKED, and counts as not passed.

pub fn run(cases: &[(&str, fn())]) -> i32 {
    let filter = std::env::args().skip(1).find(|arg| !arg.starts_with('-'));
    let cases: Vec<&(&str, fn())> = cases.iter().filter(|(name, _)| filter.as_deref().is_none_or(|filter| name.contains(filter))).collect();
    if cases.is_empty() {
        println!("\ntest result: INCONCLUSIVE. the filter {:?} names no test; nothing ran", filter.unwrap_or_default());
        return 1;
    }
    println!("\nrunning {} tests", cases.len());
    let mut failed = 0;
    let mut blocked = 0;
    for (name, case) in &cases {
        match std::panic::catch_unwind(case) {
            Ok(()) => println!("test {name} ... ok"),
            Err(payload) => {
                let message = payload
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                if message.starts_with("BLOCKED") {
                    blocked += 1;
                    println!("test {name} ... BLOCKED\n    {message}");
                } else {
                    failed += 1;
                    println!("test {name} ... FAILED");
                }
            }
        }
    }
    println!(
        "\ntest result: {}. {} passed; {failed} failed; {blocked} blocked",
        if failed == 0 && blocked == 0 { "ok" } else if failed == 0 { "BLOCKED" } else { "FAILED" },
        cases.len() - failed - blocked
    );
    i32::from(failed > 0 || blocked > 0)
}
