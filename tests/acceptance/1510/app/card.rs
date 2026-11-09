//! #1510, the app's question card: written blind from the issue, docs/technical-design.md and the merge base
//! c12a65bb, before any implementation (../README.md says what was read and the surface these reach).
//!
//!   AC2 `#1510.6263c922`  ac2_*   a question holding U+202E, and each other invisible or direction-changing
//!                                 character, shows a visible mark at that place in the card's text
//!   AC4 `#1510.5fbd0a55`  ac4_*   plain text, Chinese and emoji questions show unchanged in the card's text
//!
//! The card's text is `question::Controller::lines()`, every row's words in reading order, of a card presented from
//! record events (`kinds::Model` reads the card from them). Wired into deep-app by a `[[test]]` entry
//! (`acceptance_1510`); run with `cargo test --locked -p deep-app --test acceptance_1510`.

use deep_app::arming::Slot;
use deep_app::question::{Controller, Faults, CARD_SIZE};
use serde_json::{json, Value};

const SLOT: Slot = Slot {
    rect: [100, 100, CARD_SIZE[0], CARD_SIZE[1]],
    visible: [0, 0, 1512, 982],
};
const NOW: u64 = 1_800_000_000_000;

/// An open ask as the record holds it: its ask.created, with the question given.
fn ask(id: &str, kind: &str, question: &str) -> Value {
    let (options, extra) = if kind == "authority" {
        (
            json!([{"id": "approve", "label": "Allow", "decision": "allow"}, {"id": "decline", "label": "Decline", "decision": "deny"}]),
            json!({"default": "decline", "subject": {"effect": "push", "target": {"ref": "origin/main"}}}),
        )
    } else {
        (
            json!([{"id": "blue", "label": "Blue", "decision": "none"}, {"id": "green", "label": "Green", "decision": "none"}]),
            json!({"default": "blue"}),
        )
    };
    let mut data = json!({
        "kind": kind, "question": question, "options": options, "recommended": null,
        "deadline": NOW + 86_400_000, "key": format!("k-{id}"), "pinned_to": {"kind": "commit", "ref": "abc"},
    });
    for (name, value) in extra.as_object().unwrap() {
        data[name] = value.clone();
    }
    json!({"kind": "ask.created", "id": id, "session": "S", "log_pos": 1, "data": data})
}

/// The card's text for one ask holding `question`.
fn card_lines(id: &str, kind: &str, question: &str) -> Vec<String> {
    let events = vec![ask(id, kind, question)];
    let card = Controller::present(&events, &format!("ask:{id}"), NOW, SLOT, Faults::default())
        .unwrap_or_else(|| panic!("the card presents ask:{id}"));
    card.lines()
}

/// The characters that change what a line looks like without showing: the direction controls (embeddings, overrides,
/// isolates and marks) and the zero-width characters that join or break nothing visible.
const HIDDEN: &[(char, &str)] = &[
    ('\u{202E}', "RIGHT-TO-LEFT OVERRIDE"),
    ('\u{202D}', "LEFT-TO-RIGHT OVERRIDE"),
    ('\u{202A}', "LEFT-TO-RIGHT EMBEDDING"),
    ('\u{202B}', "RIGHT-TO-LEFT EMBEDDING"),
    ('\u{202C}', "POP DIRECTIONAL FORMATTING"),
    ('\u{2066}', "LEFT-TO-RIGHT ISOLATE"),
    ('\u{2067}', "RIGHT-TO-LEFT ISOLATE"),
    ('\u{2068}', "FIRST STRONG ISOLATE"),
    ('\u{2069}', "POP DIRECTIONAL ISOLATE"),
    ('\u{200E}', "LEFT-TO-RIGHT MARK"),
    ('\u{200F}', "RIGHT-TO-LEFT MARK"),
    ('\u{061C}', "ARABIC LETTER MARK"),
    ('\u{200B}', "ZERO WIDTH SPACE"),
    ('\u{2060}', "WORD JOINER"),
    ('\u{FEFF}', "ZERO WIDTH NO-BREAK SPACE"),
];

/// Whether `c` shows as nothing: one of HIDDEN, or white space.
fn shows_nothing(c: char) -> bool {
    c.is_whitespace() || HIDDEN.iter().any(|(h, _)| *h == c)
}

/// The card holds no raw `hidden`, and its question's line is `before`, a visible mark, then `after`: the mark stands
/// where the character was. The mark's spelling is the implementation's (the issue names none).
fn expect_marked(lines: &[String], hidden: char, name: &str, before: &str, after: &str) {
    let raw: Vec<&String> = lines.iter().filter(|line| line.contains(hidden)).collect();
    assert!(
        raw.is_empty(),
        "the card's text holds U+{:04X} {name} raw, unmarked: {raw:?}",
        hidden as u32
    );
    let line = lines
        .iter()
        .find(|line| line.contains(before))
        .unwrap_or_else(|| panic!("the card's text shows the question's start {before:?}: {lines:?}"));
    let rest = &line[line.find(before).unwrap() + before.len()..];
    let end = rest.find(after).unwrap_or_else(|| {
        panic!("the card's question line shows {after:?} after {before:?}, U+{:04X} {name} between them: {line:?}", hidden as u32)
    });
    let mark = &rest[..end];
    assert!(
        mark.chars().any(|c| !shows_nothing(c)),
        "the card shows a visible mark where U+{:04X} {name} was, between {before:?} and {after:?}; it shows {mark:?}: {line:?}",
        hidden as u32
    );
}

#[test]
fn ac2_6263c922_a_question_with_u202e_shows_a_visible_mark_at_that_place_in_the_card() {
    // The override makes the name read backwards from it on: `invoice` then `exe.txt`.
    let before = "Open the attachment invoice";
    let after = "txt.exe for the review?";
    let lines = card_lines("Q202E", "taste", &format!("{before}\u{202E}{after}"));
    expect_marked(&lines, '\u{202E}', "RIGHT-TO-LEFT OVERRIDE", before, after);
}

#[test]
fn ac2_6263c922_a_call_with_u202e_in_an_authority_card_shows_a_visible_mark_at_that_place() {
    let before = "Run `git push origin ";
    let after = "niam` in shop?";
    let lines = card_lines("A202E", "authority", &format!("{before}\u{202E}{after}"));
    expect_marked(&lines, '\u{202E}', "RIGHT-TO-LEFT OVERRIDE", before, after);
}

#[test]
fn ac2_6263c922_each_invisible_or_direction_changing_character_shows_a_visible_mark_at_its_place() {
    let before = "Run `rm -rf build";
    let after = "/cache` in shop?";
    let mut failed = Vec::new();
    for (i, (hidden, name)) in HIDDEN.iter().enumerate() {
        let lines = card_lines(&format!("H{i}"), "taste", &format!("{before}{hidden}{after}"));
        if let Err(panic) = std::panic::catch_unwind(|| expect_marked(&lines, *hidden, name, before, after)) {
            failed.push(
                panic
                    .downcast_ref::<String>()
                    .cloned()
                    .unwrap_or_else(|| format!("U+{:04X} {name}", *hidden as u32)),
            );
        }
    }
    assert!(failed.is_empty(), "{} of {} characters reach the card's text unmarked:\n{}", failed.len(), HIDDEN.len(), failed.join("\n"));
}

#[test]
fn ac4_5fbd0a55_plain_chinese_and_emoji_questions_show_unchanged_in_the_card() {
    for (i, question) in [
        "Which header color for the checkout page?",
        "结账页面的标题用哪种颜色？",
        // A heart with its emoji presentation selector (U+FE0F) and a family joined by zero-width joiners (U+200D).
        "Ship the new header? 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧",
    ]
    .into_iter()
    .enumerate()
    {
        let lines = card_lines(&format!("P{i}"), "taste", question);
        assert!(
            lines.iter().any(|line| line == question),
            "the card shows the question {question:?} unchanged, on a line of its own: {lines:?}"
        );
    }
}
