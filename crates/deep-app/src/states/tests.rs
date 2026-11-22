use super::*;
use serde_json::json;

/// #1925: a running job's row shows its tool's count as the hub wrote it; with no counter, the word running and
/// how long it has run, in the row's time slot, never a count it wasn't given.
#[test]
fn a_job_row_counts_only_from_its_tools_counter() {
    let counted = json!({"title": "test.encode", "progress": "300 of 600 · 40 s left", "since": 0});
    assert_eq!(
        job_words(&counted, 45_000),
        "test.encode · 300 of 600 · 40 s left"
    );
    let bare = json!({"title": "test.encode", "since": 1_000});
    let words = job_words(&bare, 41_000);
    assert_eq!(words, "test.encode · running 40 s");
    assert_eq!(time_at_end(&words), ("test.encode · running", Some("40 s")));
}

/// #1546: an age's next tick is the first ms its span reads differently, never later, never earlier.
#[test]
fn an_age_changes_exactly_when_its_span_next_reads_differently() {
    let ages = (0..200_000).step_by(997).chain([
        59_999,
        60_000,
        90_000,
        3_599_999,
        3_600_000,
        7_300_123,
        86_399_999,
        86_400_000,
        200_000_000,
    ]);
    for age in ages {
        let wait = changes_in(age);
        assert!(wait > 0, "{age}");
        assert_eq!(
            span(age + wait - 1),
            span(age),
            "{age} reads the same until {wait} ms on"
        );
        assert_ne!(
            span(age + wait),
            span(age),
            "{age} reads differently {wait} ms on"
        );
    }
}

fn table(events: &[Value]) -> Table {
    let mut table = Table::default();
    for event in events {
        table.apply(event);
    }
    table
}

fn ask(id: &str) -> Value {
    json!({"v": 4, "id": id, "kind": "ask.created", "session": "s1", "data": {"question": "Push?"}})
}

#[test]
fn the_menu_bar_shows_a_titles_controls_and_direction_marks() {
    // #1738: the menu bar lists every session by its task's title, which the agent chose.
    let events = vec![
        json!({"kind": "task.created", "writer": "core", "log_pos": 1, "ts": 1,
               "data": {"thread": "s1", "title": "Fix\u{202e}txt\x1b[2K\rok\nship"}}),
        json!({"kind": "session.start", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 1, "data": {}}),
    ];
    let menu = menu(&table(&events), 1);
    assert!(
        menu[0].starts_with("Fix\\u{202e}txt\\x1b[2K\\rok\\nship · "),
        "{menu:?}"
    );
}

#[test]
fn a_sessions_readings_show_beside_it_and_move_nothing() {
    // #990: a terminal program's status readings are signal only: the row keeps the newest three, and the
    // session's state and row words are what they were without them.
    let before = vec![
        json!({"kind": "permission.request", "writer": "hook", "session": "s1", "log_pos": 1, "ts": 1, "data": {}}),
    ];
    let mut events = before.clone();
    for (i, word) in ["started", "working", "blocked", "done"].iter().enumerate() {
        events.push(json!({"kind": "session.reading", "writer": "core", "session": "s1", "log_pos": 2 + i,
                           "ts": 1_000_000 + i, "data": {"reading": format!("its terminal's program reports {word}")}}));
    }
    let (with, without) = (table(&events), table(&before));
    assert_eq!(
        with.readings("s1"),
        ["working", "blocked", "done"].map(|w| format!("its terminal's program reports {w}"))
    );
    assert_eq!(with.state("s1"), without.state("s1"));
    assert_eq!(with.row("s1", 2_000_000), without.row("s1", 2_000_000));
}

#[test]
fn every_hooks_attention_is_attention_as_the_whole_list_read_has_it() {
    // #1141's equivalence: the fold reads a session as the record's whole-list reading does, so a hook's finished
    // after the core read the session quiet is attention too, and the session works.
    let events = vec![
        json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 1, "ts": 1,
               "data": {"state": "unknown"}}),
        json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 2,
               "data": {"state": "finished"}}),
    ];
    assert_eq!(table(&events).state("s1"), State::Working);
}

#[test]
fn a_hooks_word_that_the_session_works_again_is_its_attention() {
    // A hook's working after the core read the session quiet is the session at work again, as the record's
    // whole-list reading has it (#1141).
    let events = vec![
        json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 1, "ts": 1,
               "data": {"state": "unknown"}}),
        json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 2, "ts": 2,
               "data": {"state": "working"}}),
    ];
    assert_eq!(table(&events).state("s1"), State::Working);
}

#[test]
fn the_sidebar_row_keeps_its_stops_claim_past_the_turns_end_and_the_idle_prompt() {
    // A turn's claim at its stop, the turn's end the core records again after it, then the idle prompt's
    // Notification a minute later (#992), as the hub's record has them: the sidebar names the state the core
    // recorded, and the stop's claim, which neither the turn's end nor the idle prompt hides.
    let events = vec![
        json!({"kind": "tool.before", "writer": "hook", "session": "s1", "log_pos": 1, "ts": 1, "data": {}}),
        json!({"kind": "claim.made", "writer": "core", "session": "s1", "id": "c1", "log_pos": 2, "ts": 2, "data": {}}),
        json!({"kind": "session.attention", "writer": "core", "session": "s1", "log_pos": 3, "ts": 3,
               "data": {"state": "finished"}}),
        json!({"kind": "session.state", "writer": "core", "session": "s1", "log_pos": 4, "ts": 4,
               "data": {"state": "finished", "cause": "finished"}}),
        json!({"kind": "session.attention", "writer": "hook", "session": "s1", "log_pos": 5, "ts": 60_000,
               "data": {"state": "finished"}}),
    ];
    let (words, entry) = table(&events).row("s1", 60_000);
    assert_eq!((words.as_str(), entry), ("finished · says done", "running"));
    // Later work hides it: a tool call after the stop.
    let mut later = events.clone();
    later.push(json!({"kind": "tool.before", "writer": "hook", "session": "s1", "log_pos": 6, "ts": 61_000, "data": {}}));
    assert_eq!(
        table(&later).row("s1", 61_000),
        ("finished".to_owned(), "idle")
    );
}

#[test]
fn a_decision_the_core_applied_closes_the_ask_it_names() {
    let events = vec![
        ask("a1"),
        ask("a2"),
        json!({"kind": "decision.applied", "writer": "core", "subject": "ask:a1",
               "data": {"decision": "d1", "ask": "ask:a2"}}),
    ];
    let open: Vec<&str> = open_asks(&events, None)
        .iter()
        .map(|ask| ask["id"].as_str().unwrap())
        .collect();
    assert_eq!(open, ["a1"]);
}

#[test]
fn the_cores_undo_of_a_default_opens_the_ask_again_with_its_new_deadline() {
    let undo = |id: &str, writer: &str| json!({"kind": "default.undone", "writer": writer, "subject": format!("ask:{id}"), "data": {"deadline": 9}});
    let events = vec![
        ask("a1"),
        ask("a2"),
        ask("a3"),
        ask("a4"),
        json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a1", "data": {}}),
        json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a2", "data": {}}),
        json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a3", "data": {}}),
        json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a4", "data": {}}),
        // A close after the first changes nothing: the core still undoes the default.
        json!({"kind": "ask.cancelled", "writer": "core", "subject": "ask:a1", "data": {}}),
        undo("a1", "core"),
        undo("a2", "mcp:agent"),
        undo("a3", "core"),
        undo("a4", "core"),
        json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a4", "data": {}}),
    ];
    let open: Vec<&str> = open_asks(&events, None)
        .iter()
        .map(|ask| ask["id"].as_str().unwrap())
        .collect();
    assert_eq!(open, ["a1"]);
    assert_eq!(deadline(&events, &events[0]), Some(9));
    let mut own = ask("a5");
    own["data"]["deadline"] = json!(5);
    assert_eq!(deadline(&[own.clone()], &own), Some(5));
}

#[test]
fn a_session_whose_asks_all_closed_no_longer_needs_you() {
    let events = vec![
        ask("a1"),
        json!({"kind": "tool.before", "session": "s1", "writer": "hook", "log_pos": 2, "data": {}}),
        json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a1", "data": {}}),
    ];
    assert_eq!(table(&events).state("s1"), State::Working);
    assert_eq!(table(&events[..2]).state("s1"), State::NeedsYou);
    assert_eq!(table(&events).every_session()[0].2, State::Working);
}

#[test]
fn no_agent_closes_an_ask() {
    let events = vec![
        ask("a1"),
        ask("a2"),
        ask("a3"),
        json!({"kind": "ask.answered", "writer": "hook", "subject": "ask:a1", "data": {}}),
        json!({"kind": "ask.cancelled", "writer": "mcp:agent", "subject": "ask:a2", "data": {}}),
        json!({"kind": "ask.cancelled", "writer": "core", "subject": "ask:a3", "data": {}}),
    ];
    let open: Vec<&str> = open_asks(&events, None)
        .iter()
        .map(|ask| ask["id"].as_str().unwrap())
        .collect();
    assert_eq!(open, ["a1", "a2"]);
}

/// A record of asks and the events that move them, drawn from `seed`: closes of every kind by every writer,
/// decisions applied that name an ask in their data, undone defaults, moved deadlines and events about no ask.
fn drawn(seed: u64) -> Vec<Value> {
    let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    let mut next = |n: u64| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state % n
    };
    let kinds = [
        "ask.created",
        "ask.answered",
        "ask.defaulted",
        "ask.escalated",
        "ask.cancelled",
        "ask.superseded",
        "ask.moot",
        "decision.applied",
        "default.undone",
        "deadline.moved",
        "tool.before",
        "agent.stop",
        "session.attention",
        "claim.made",
        "verdict.made",
        "verdict.stale",
        "claim.sent_back",
        "task.created",
        "run.started",
        "run.finished",
    ];
    let writers = ["core", "hook", "mcp:agent", "app"];
    let outcomes = ["PASS", "FAIL", "BLOCKED", "INVALID", "INCONCLUSIVE"];
    let attention = ["unknown", "waiting", "finished"];
    let finished = ["passed", "failed"];
    (0..next(60) + 1)
        .map(|i| {
            let kind = kinds[next(kinds.len() as u64) as usize];
            let about = format!("ask:a{}", next(6));
            let other = format!("ask:a{}", next(6));
            let writer = writers[next(writers.len() as u64) as usize];
            let session = format!("s{}", next(3));
            let claim = format!("claim:c{}", next(3));
            let pos = i + 1;
            match kind {
                "ask.created" => json!({"kind": kind, "id": about[4..], "session": session, "writer": "core", "log_pos": pos,
                                        "data": {"deadline": next(9)}}),
                "decision.applied" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "subject": about, "log_pos": pos,
                                             "data": {"ask": other}}),
                "default.undone" | "deadline.moved" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "log_pos": pos,
                                                       "subject": about, "data": {"deadline": next(9)}}),
                "tool.before" | "agent.stop" => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "session": session,
                                                "log_pos": pos, "ts": next(1000), "subject": format!("session:{session}"), "data": {}}),
                "session.attention" => json!({"kind": kind, "id": format!("e{i}"), "writer": "hook", "session": session, "log_pos": pos,
                                              "ts": next(1000), "data": {"state": attention[next(3) as usize]}}),
                "claim.made" => json!({"kind": kind, "id": claim[6..], "writer": "mcp:agent", "session": session, "log_pos": pos, "data": {}}),
                "verdict.made" => json!({"kind": kind, "id": format!("v{}", next(3)), "writer": "core", "session": session, "log_pos": pos,
                                         "data": {"claim": claim, "verdict": format!("verdict:v{}", next(3)), "outcome": outcomes[next(5) as usize]}}),
                "verdict.stale" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos,
                                          "data": {"verdict": format!("verdict:v{}", next(3))}}),
                "claim.sent_back" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos,
                                            "data": {"claim": claim, "round": next(4)}}),
                "task.created" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "log_pos": pos,
                                         "data": {"thread": format!("s{}", next(3)), "title": format!("task {}", next(3))}}),
                "run.started" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos, "ts": next(1000),
                                        "data": {"claim": claim, "check": format!("k{}", next(2)), "run": format!("r{}", next(4))}}),
                "run.finished" => json!({"kind": kind, "id": format!("e{i}"), "writer": "core", "session": session, "log_pos": pos, "ts": next(2000),
                                         "data": {"run": format!("r{}", next(4)), "outcome": finished[next(2) as usize]}}),
                _ => json!({"kind": kind, "id": format!("e{i}"), "writer": writer, "subject": about, "log_pos": pos, "data": {}}),
            }
        })
        .collect()
}

#[test]
fn the_open_asks_read_in_one_pass_and_folded_are_those_each_asks_own_reading_leaves_open() {
    // The reference: each ask read alone over every event, as the core reads it.
    for seed in 0..2_000 {
        let events = drawn(seed);
        let folded = table(&events);
        for session in [None, Some("s0"), Some("s1")] {
            let want: Vec<&Value> = events
                .iter()
                .filter(|event| event["kind"] == "ask.created")
                .filter(|ask| session.is_none_or(|session| ask["session"] == session))
                .filter(|ask| is_open(&events, &handle(ask)))
                .collect();
            assert_eq!(
                open_asks(&events, session),
                want,
                "seed {seed}, session {session:?}: {events:#?}"
            );
            assert_eq!(
                folded.open_asks(session),
                want,
                "folded, seed {seed}, session {session:?}: {events:#?}"
            );
        }
        // Every ask the events name, created in them or not, reads open folded exactly when it reads open alone,
        // with the same deadline.
        for n in 0..7 {
            let handle = format!("ask:a{n}");
            assert_eq!(
                folded.is_open(&handle),
                is_open(&events, &handle),
                "seed {seed}, {handle}: {events:#?}"
            );
            let ask = json!({"id": format!("a{n}"), "data": {"deadline": 99}});
            assert_eq!(
                folded.deadline(&ask),
                deadline(&events, &ask),
                "seed {seed}, {handle}: {events:#?}"
            );
        }
    }
}
