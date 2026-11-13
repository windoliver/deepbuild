//! #1606 AC5 and AC9, redrafted (../README.md): an answer on the real app's question card with no window, as the
//! replica drives the card (crates/deep-replica). The card's own controller is presented from the hub's record, its
//! option pressed by an input that isn't hardware, the OS asked through the app's own `answer::confirm` (the
//! `test-confirm` stand-in), and what the card wrote sent by the app's own `answer::send`, which signs it as the app's
//! device, pairing one first when the app has none: the steps `card.rs` takes after a press, in that order.
//!
//! Wired into deep-app by a `[[test]]` entry, `acceptance_1606`, `harness = false` (README, Surface). card.test.ts runs
//!   cargo test --locked -p deep-app --test acceptance_1606 --features test-confirm,test-secrets[,plant-key-in-file] -- <ask> <option>
//! with HOME the test's home and the stand-ins' variables set. With no ask it answers nothing, and says so.

use deep_app::answer;
use deep_app::arming::{Client, Slot, Source};
use deep_app::hub::HubClient;
use deep_app::question::{Controller, Did, Faults, Input, Phase, Target, CARD_SIZE};
use serde_json::{json, Value};

/// A slot the card fits in, wholly inside a window of the reference size: a card there arms.
const SLOT: Slot = Slot {
    rect: [100, 100, CARD_SIZE[0], CARD_SIZE[1]],
    visible: [0, 0, 1512, 982],
};
/// How long after it is presented the press comes: past the card's arming (`arming::ARM_AFTER`, 500 ms).
const PRESS_AFTER: u64 = 1_000;

fn main() {
    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    let [ask, option] = args.as_slice() else {
        println!("acceptance_1606: no ask to answer (card.test.ts names one)");
        return;
    };
    match answer_on_card(ask, option) {
        Ok(sent) => println!("{}", json!({ "answered": sent })),
        Err(why) => {
            println!("{}", json!({ "failed": why }));
            std::process::exit(1);
        }
    }
}

/// The record's events, oldest first, as the app reads them: `events.read` on an app connection, page by page.
fn history() -> Result<Vec<Value>, String> {
    let mut client = HubClient::app().map_err(|e| format!("the app couldn't connect to the hub: {e:?}"))?;
    let mut all = Vec::new();
    let mut after = 0u64;
    loop {
        let page = client
            .call("events.read", json!({ "after": after, "limit": 1000 }))
            .map_err(|e| format!("the hub refused events.read: {e:?}"))?;
        let events = page["events"].as_array().cloned().unwrap_or_default();
        let Some(last) = events.last().and_then(|e| e["log_pos"].as_u64()) else {
            return Ok(all);
        };
        after = last;
        all.extend(events);
    }
}

/// Presents the card for `ask`, presses `option` with an accessibility action once it armed, has the OS stand-in
/// confirm, and sends what the card wrote: the params sent, or why nothing was.
fn answer_on_card(ask: &str, option: &str) -> Result<Vec<Value>, String> {
    let events = history()?;
    let shown = deep_app::views::now();
    let mut card = Controller::present(&events, ask, shown, SLOT, Faults::default())
        .ok_or_else(|| format!("the card doesn't present {ask}: the record holds no open ask by that handle"))?;
    let index = card
        .model()
        .options
        .iter()
        .position(|choice| choice.id == option)
        .ok_or_else(|| format!("{ask}'s card shows no option {option}"))?;
    let source = Source::Accessibility { client: Client::Unknown };
    let at = shown + PRESS_AFTER;
    let input = |phase, t| Input { t, source, target: Target::Option(index), phase };
    let did = match card.press(input(Phase::Down, at), &events, at) {
        Did::Nothing => card.press(input(Phase::Up, at + 80), &events, at + 80),
        other => other,
    };
    let Did::NeedsConfirmation(reason) = did else {
        return Err(format!("the card took the press on {option} as {did:?}, not as one the OS must confirm"));
    };
    let said = answer::confirm(ask, &reason);
    card.confirmed(said.is_ok(), &events, at + 200);
    if let Err(error) = said {
        return Err(format!("the OS stand-in didn't confirm: {error:?}"));
    }
    let answers = card.take_answers();
    if answers.is_empty() {
        return Err(format!("the card wrote no answer after the OS confirmed the press on {option}"));
    }
    for params in &answers {
        answer::send(params).map_err(|e| format!("the app's answer was refused: {e:?}"))?;
    }
    Ok(answers)
}
