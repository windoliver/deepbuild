//! #327.fab7d30b, redrafted blind from ISSUE-327.md, docs/technical-design.md, docs/canvas-primitives.md,
//! the base 5a6d09a4 and this folder's common.rs:
//!
//! "Before the card arms, an answer that will be saved as a decision shows its scope in words and how many
//! open asks it will also answer: with two matching asks open, the card says it answers 2 more, and answering
//! closes exactly those two as decided for you; a third that comes to match while the card shows doesn't change
//! the card and is listed on its receipt. A card that shows no scope, or a count that changes while it shows,
//! fails this test"
//!
//! Its record checks (decision.created, decision.applied, open asks after the answer) were dropped with the
//! maintainer's approval: the replica runs no asks core, and scope.test.ts proves them on the core.
//!
//! What "matching" means here, from the design:
//! - technical-design.md, Decided, "Question matching": "By kind and scope in v0, never by exact wording."
//! - technical-design.md, asks ("Asks stay current"): "an answer saved as a decision also answers every open ask
//!   it matches by kind and scope, as decided for you. Before you answer, the card says in words what the answer
//!   will be saved as and how many open asks it will also answer, counted when the card is presented; an ask that
//!   comes to match while the card shows is answered as decided for you and listed on the answered card's receipt."
//! - canvas-primitives.md, Question card: "An answer that will be saved as a decision shows, before the card arms,
//!   the decision's scope in words and how many open asks it will also answer, both fixed when the card is presented."
//! - The ask's kind is its `key` (asks(…, kind, key, …) in the record; the base's packages/asks: a decision answers
//!   asks "of the ask's kind (its key)", and an ask that names its subject in structured fields "is keyed from the
//!   subject alone, never from its words"), so the matching asks below share the shown ask's key and subject but not
//!   its wording.
//! - The scope an answer is saved at is the ask's session's repo (technical-design.md's resolver-decisions row:
//!   "your answer, saved at that ask's scope"; the base's packages/asks: "Your answer on the trusted path is saved
//!   for its repo"), so a match is an open ask of the same key raised in a session of the same repo, `shop`.
//!
//! The scenario, so that every match is a separate ask and nothing else closes it:
//! - Each matching ask comes from its own session, since "A newer ask from the same session on the same subject
//!   supersedes an older one" (asks section), and each is pinned to its own commit, since "An ask with the same
//!   kind, normalized question and scope as an open one, pinned to the same thing, joins it" (it would ride the
//!   card rather than be one of the "N more").
//! - Two controls that don't match and must stay open: the same key in a session of another repo (`docs`, another
//!   scope), and another key (the cart badge) in a session of the same repo (another kind).
//! - "Decided for you" is read from the record as `decision.applied {decision, ask}` (canvas-primitives.md's record
//!   kinds: "`decision.created`, `decision.applied` … `{key, scope, answer, ask}`; `{decision, ask}` … past calls and
//!   what was decided for you").
//!
//! Fixture: fixtures/ac1_redraft.events.jsonl: S1, S2, S4 and S5 started in ~/src/shop (project `shop`), S3 in
//! ~/src/docs (project `docs`); nothing asked. The asks are raised live from live.json's `taste` template.
//!
//! Target (beside card.rs and planted.rs in crates/deep-replica/Cargo.toml; no harness, as AppKit needs the main
//! thread):
//!   [[test]] name = "acceptance_327_ac1_redraft", path = "../../tests/acceptance/327/ac1_redraft.rs", harness = false
#![allow(dead_code)]

mod common;

use common::*;
use deep_replica::{On, Planted, Replica};
use serde_json::json;

pub const S4: &str = "01MD327SESS000000000000S04";
pub const S5: &str = "01MD327SESS000000000000S05";

const FIXTURE: &str = "ac1_redraft.events.jsonl";
/// live.json's taste key: the checkout total's header colour.
const TOTAL_KEY: &str = "539c4df1e78db9007c78ba41531fadba910ddaa34b2327b1ae02923e1ff0cf3d";
/// past.events.jsonl's cart badge key: another kind of question.
const BADGE_KEY: &str = "a98b58b2deeb41512b451a65665dd384f568a7a4801592e6326a3f0753410fbb";

const SHOWN_Q: &str = "Which header colour on the checkout total?";
const M1_Q: &str = "Header colour for the total on the checkout step?";
const M2_Q: &str = "What colour should the checkout total's header be in the drawer?";
const M3_Q: &str = "Pick the checkout total header colour for the receipt page";
const N1_Q: &str = "Which header colour on the checkout total in the docs example?";
const N2_Q: &str = "Which badge on the cart icon?";

/// A taste call on the checkout total in `session`, worded `question`, pinned to `commit`; its handle.
fn raise_total(replica: &mut Replica, session: &str, question: &str, commit: &str) -> String {
    let mut event = stamped(live("taste"), replica);
    event["data"]["question"] = json!(question);
    event["data"]["deadline"] = json!(replica.now() + 3 * DAY);
    event["data"]["pinned_to"] = json!({"kind": "commit", "ref": commit});
    assert_eq!(event["data"]["key"], TOTAL_KEY, "live.json's taste template is the checkout total's key");
    let handle = format!("ask:{}", event["id"].as_str().unwrap());
    replica.append(session, event);
    handle
}

/// A taste call on the cart badge in `session`: another key, so it never matches the checkout total.
fn raise_badge(replica: &mut Replica, session: &str) -> String {
    let mut event = stamped(live("taste"), replica);
    event["data"]["question"] = json!(N2_Q);
    event["data"]["deadline"] = json!(replica.now() + 3 * DAY);
    event["data"]["key"] = json!(BADGE_KEY);
    event["data"]["subject"] = json!({"screen": "cart", "element": "badge"});
    event["data"]["options"] = json!([
        {"id": "dot", "label": "A dot", "decision": "none"},
        {"id": "count", "label": "A count", "decision": "none"}
    ]);
    event["data"]["recommended"] = json!("dot");
    event["data"]["default"] = json!("dot");
    event["data"]["pinned_to"] = json!({"kind": "commit", "ref": "5b0f7c1e9a2d4c6b8e0f1a3c5d7e9b2a4c6e8f01"});
    let handle = format!("ask:{}", event["id"].as_str().unwrap());
    replica.append(session, event);
    handle
}

/// An ask or decision handle without its `ask:` / `decision:` prefix, as a record field may name it either way.
fn bare(handle: &str) -> &str {
    handle.rsplit(':').next().unwrap_or(handle)
}

/// Every count the text gives as "<n> more", in order.
fn more_counts(text: &str) -> Vec<u64> {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .collect();
    words
        .windows(2)
        .filter(|pair| pair[1] == "more")
        .filter_map(|pair| pair[0].parse::<u64>().ok())
        .collect()
}

/// The scope in words: the repo the decision will be saved for, named as a repo (or project).
fn judge_scope(text: &str, ask: &str, when: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut failures = Vec::new();
    if !lower.contains("shop") || !(lower.contains("repo") || lower.contains("project")) {
        failures.push(format!(
            "{ask} {when}: the card shows no scope: its text doesn't say in words that the answer is saved for the repo shop; text: {text:?}"
        ));
    }
    failures
}

fn judge_count(text: &str, ask: &str, when: &str) -> Vec<String> {
    let counts = more_counts(text);
    if counts == [2] {
        Vec::new()
    } else {
        vec![format!("{ask} {when}: the count changed or is wrong: the card should say it answers 2 more, and says {counts:?} more; text: {text:?}")]
    }
}

fn names(text: &str, ask: &str, question: &str) -> bool {
    text.contains(question) || text.contains(bare(ask))
}

/// The whole criterion against one replica; the failures, each naming what broke.
fn scenario(mut replica: Replica) -> Vec<String> {
    let mut failures = Vec::new();

    // The ask the card shows, in S1 (repo shop).
    let shown = raise_total(&mut replica, S1, SHOWN_Q, "e9cef72c1b547c88386cb22fb5370f80c854d76c");
    // Two matches: same key, same repo, each from its own session and pinned to its own commit.
    let m1 = raise_total(&mut replica, S2, M1_Q, "1f2e3d4c5b6a79881726354453627180a9b8c7d6");
    let m2 = raise_total(&mut replica, S4, M2_Q, "2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d");
    // Not matches: same key in another repo (scope), another key in the same repo (kind).
    let n1 = raise_total(&mut replica, S3, N1_Q, "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f");
    let n2 = raise_badge(&mut replica, S4);
    replica.advance(ms(1_000));

    let open = replica.open_asks();
    for ask in [&shown, &m1, &m2, &n1, &n2] {
        if !open.contains(ask) {
            failures.push(format!("{ask}: not open before the card is presented (open: {open:?}); the scenario can't be judged"));
        }
    }
    if !failures.is_empty() {
        return failures;
    }

    // Before the card arms: the scope in words and "2 more".
    let card = replica.present(0, &shown);
    if card.state != "presented" {
        failures.push(format!("{shown}: the card is presented, unarmed, first; got {card:?}"));
    }
    failures.extend(judge_scope(&card.text, &shown, "before it arms"));
    failures.extend(judge_count(&card.text, &shown, "before it arms"));
    let presented_text = card.text.clone();
    let presented_seq = card.seq;

    // A third comes to match while the card shows, 200 ms into the arm interval.
    replica.advance(ms(200));
    let m3 = raise_total(&mut replica, S5, M3_Q, "4e5f60718293a4b5c6d7e8f9011a2b3c4d5e6f70");
    replica.advance(ms(50));
    match replica.card_seen(0) {
        None => failures.push(format!("{shown}: the card left device 0 when {m3} came to match")),
        Some(after) => {
            if after.text != presented_text {
                failures.push(format!(
                    "{shown}: the card changed when {m3} came to match while it showed: before {presented_text:?}, after {:?}",
                    after.text
                ));
            }
            if after.seq != presented_seq || after.state != "presented" {
                failures.push(format!(
                    "{shown}: the card was presented again when {m3} came to match (seq {presented_seq} → {}, state {:?})",
                    after.seq, after.state
                ));
            }
            failures.extend(judge_scope(&after.text, &shown, &format!("after {m3} came to match")));
            failures.extend(judge_count(&after.text, &shown, &format!("after {m3} came to match")));
        }
    }

    // It arms on its first interval: the third didn't restart it. Still the same scope and count.
    replica.advance(ms(ARM_AFTER - 250 + 20));
    let armed = match replica.card_seen(0) {
        Some(armed) if armed.state == "armed" => armed,
        other => {
            failures.push(format!(
                "{shown}: not armed {} ms after presentation; a third match changed the card ({other:?})",
                ARM_AFTER + 20
            ));
            return failures;
        }
    };
    failures.extend(judge_scope(&armed.text, &shown, "once armed"));
    failures.extend(judge_count(&armed.text, &shown, "once armed"));

    // Answer with an option, so the answer is saved as a decision.
    let green = option_index(&armed, "Green header");
    click(&mut replica, 0, On::Option(green));
    replica.advance(ms(200));

    let sent = answers_for(&replica, &shown);
    if sent.len() != 1 || sent[0]["option"] != "green" {
        failures.push(format!("{shown}: the card should send one answer, option green; sent {sent:?}"));
    }
    // The app answers only the ask it shows; the others close as decided for you, not by an answer of its own.
    for ask in [&m1, &m2, &m3, &n1, &n2] {
        let extra = answers_for(&replica, ask);
        if !extra.is_empty() {
            failures.push(format!("{ask}: the card sent an answer for an ask it didn't show: {extra:?}"));
        }
    }

    // The record's side, the decision saved and applied to exactly the matches with the others left open, is the
    // asks core's: tests/acceptance/327/scope.test.ts proves it on the core itself. The replica runs no core.

    // The receipt lists the third.
    match replica.card_seen(0) {
        Some(receipt) if receipt.state == "answered" => {
            if !names(&receipt.text, &m3, M3_Q) {
                failures.push(format!("{shown}: the receipt doesn't list {m3}, which came to match while the card showed; text: {:?}", receipt.text));
            }
            for (ask, question) in [(&n1, N1_Q), (&n2, N2_Q)] {
                if names(&receipt.text, ask, question) {
                    failures.push(format!("{shown}: the receipt lists {ask}, which the answer didn't close"));
                }
            }
        }
        other => failures.push(format!("{shown}: no answered card keeps its slot as a receipt; got {other:?}")),
    }
    failures
}

fn the_card_says_its_scope_and_2_more_and_closes_exactly_those() {
    let failures = scenario(Replica::open(&fixture(FIXTURE)));
    assert!(failures.is_empty(), "#327.fab7d30b:\n  {}", failures.join("\n  "));
}

/// The wrong programs the criterion names fail this test, naming what broke.
fn a_card_that_shows_no_scope_fails() {
    let failures = scenario(Replica::planted(&fixture(FIXTURE), Planted::NoScope));
    assert!(
        failures.iter().any(|f| f.contains("shows no scope")),
        "a card that shows no scope passed the scope judge: {failures:?}"
    );
}

fn a_count_that_changes_while_it_shows_fails() {
    let failures = scenario(Replica::planted(&fixture(FIXTURE), Planted::CountFollowsRecord));
    assert!(
        failures.iter().any(|f| f.contains("count changed") || f.contains("the card changed")),
        "a card whose count follows the record passed the count judge: {failures:?}"
    );
}

fn main() {
    std::process::exit(run(&[
        ("ac1_redraft_the_card_says_its_scope_and_2_more_and_closes_exactly_those", the_card_says_its_scope_and_2_more_and_closes_exactly_those),
        ("ac1_redraft_planted_a_card_that_shows_no_scope_fails", a_card_that_shows_no_scope_fails),
        ("ac1_redraft_planted_a_count_that_changes_while_it_shows_fails", a_count_that_changes_while_it_shows_fails),
    ]));
}
