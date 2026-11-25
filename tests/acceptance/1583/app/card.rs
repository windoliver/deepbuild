//! #1583, the app's question card as text: written blind from the issue, the design and the merge base 86376102,
//! before any implementation (../README.md says what was read and the surface this reaches). It judges nothing: it
//! draws what ../app.test.ts names and prints it, and that file's judges (../judge.ts) decide each criterion.
//!
//! The card's text is `question::Controller::lines()`, every row's words in reading order, of a card presented from
//! record events, as #1510's `app/card.rs` reads it. A session's name is `states::Table::title`, the one call every
//! surface of the app draws a session's name with, on the row the hub built for it.
//!
//! Wired into deep-app by a `[[test]]` entry, `acceptance_1583`, `harness = false` (README, What the implementer
//! adds). ../app.test.ts builds it with `--features env-plants` and runs
//!   <the built target> cards <file>
//! where <file> holds `{"now": <ms>, "cards": [{"ask": "ask:<id>", "events": [...]}], "rows": [...], "sessions":
//! ["<id>"]}`. It prints one line, `{"cards": [{"ask", "lines"}], "titles": [...]}`, `lines` null for a card that
//! doesn't present. Run with nothing to draw, as in a workspace run, it draws nothing and says so.

use deep_app::arming::Slot;
use deep_app::question::{Controller, Faults, CARD_SIZE};
use deep_app::states::Table;
use serde_json::{json, Value};

/// A slot the card fits in, wholly inside a window of the reference size.
const SLOT: Slot = Slot {
    rect: [100, 100, CARD_SIZE[0], CARD_SIZE[1]],
    visible: [0, 0, 1512, 982],
};

fn main() {
    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    let file = match args.as_slice() {
        [verb, file] if verb == "cards" => file,
        _ => {
            println!("acceptance_1583: nothing to draw (app.test.ts names a file of cards)");
            return;
        }
    };
    match drawn(file) {
        Ok(said) => println!("{said}"),
        Err(why) => {
            println!("{}", json!({ "failed": why }));
            std::process::exit(1);
        }
    }
}

/// Each card of the file presented and its lines read, and each session's name on the rows given.
fn drawn(file: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{file} can't be read: {e}"))?;
    let asked: Value = serde_json::from_str(&text).map_err(|e| format!("{file} isn't JSON: {e}"))?;
    let now = asked["now"]
        .as_u64()
        .ok_or_else(|| format!("{file} names no now"))?;
    let cards: Vec<Value> = asked["cards"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|card| {
            let ask = card["ask"].as_str().unwrap_or_default();
            let events = card["events"].as_array().cloned().unwrap_or_default();
            let lines = Controller::present(&events, ask, now, SLOT, Faults::default())
                .map(|presented| presented.lines());
            json!({ "ask": ask, "lines": lines })
        })
        .collect();
    let rows = asked["rows"].as_array().cloned().unwrap_or_default();
    let table = Table::seeded(&rows);
    let titles: Vec<String> = asked["sessions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|session| table.title(session))
        .collect();
    Ok(json!({ "cards": cards, "titles": titles }))
}
