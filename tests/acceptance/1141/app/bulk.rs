//! A heavy record of 30 sessions, made event by event so nothing but the app's reader has to hold it (README: The
//! records). Event `n` (from 1) is the record's n-th, at log_pos `n`, in the shape the hub's record writes (`toJson`
//! of @deepbuild/record, plus `verified`): the first 30 are each session's `task.created`; after them, mostly the
//! hook's `tool.before` and `tool.after`, with an ask every 1,000 events that the core answers 100 events later, and a
//! claim with a run and a PASS every 1,000 events. `tail` ends each session in a known state for AC1's check.
#![allow(dead_code)]

use deep_app::states::State;
use serde_json::{json, Value};

pub const SESSIONS: u64 = 30;
pub const T0: u64 = 1_760_000_000_000;

pub fn session(k: u64) -> String {
    format!("5e551141-0000-4000-8000-{k:012}")
}

pub fn title(k: u64) -> String {
    format!("Task {k:02}: cart totals round to the cent")
}

/// The event ID of the record's n-th event: ULID-shaped.
pub fn id(n: u64) -> String {
    format!("01K9{n:022}")
}

pub fn ts(n: u64) -> u64 {
    T0 + n * 400
}

/// The session the n-th event is about: they take turns.
fn of(n: u64) -> u64 {
    (n - 1) % SESSIONS
}

fn event_in(n: u64, k: u64, kind: &str, writer: &str, data: Value) -> Value {
    json!({
        "v": 1, "id": id(n), "kind": kind, "log_pos": n, "writer": writer, "actor": "you", "scope": "you",
        "ts": ts(n), "seq": format!("{}", ts(n) * 1_000_000 + n % 1_000_000), "session": session(k),
        "agent": "claude-code", "project": "01K9PROJECT0000000000SHOP01", "data": data, "evidence": [], "verified": true,
    })
}

pub fn ask(n: u64, k: u64) -> Value {
    event_in(
        n,
        k,
        "ask.created",
        "core",
        json!({
            "kind": "taste", "question": "Round the cart total half up or half even?",
            "options": [
                { "id": "up", "label": "Half up", "decision": "none" },
                { "id": "even", "label": "Half even", "decision": "none" }
            ],
            "recommended": "up", "deadline": ts(n) + 86_400_000, "fallback": "you", "default": "up",
            "provisional": false, "owner": "you",
            "key": "e3ec83bf9a447263636dfa7746083bdc44fedc91cb656f21f18d9060159b7bcd",
        }),
    )
}

pub fn answered(n: u64, k: u64, ask_handle: &str) -> Value {
    let mut event = event_in(
        n,
        k,
        "ask.answered",
        "core",
        json!({ "answer": "up", "via": "inbox", "verified": true }),
    );
    event["subject"] = json!(ask_handle);
    event
}

fn claim(n: u64, k: u64) -> Value {
    event_in(
        n,
        k,
        "claim.made",
        "mcp:agent",
        json!({ "summary": "Cart totals round half up", "commit": "4f2a9c1e0b7d", "turn": format!("turn:{}", id(n)) }),
    )
}

fn verdict(n: u64, k: u64, claim_n: u64) -> Value {
    event_in(
        n,
        k,
        "verdict.made",
        "core",
        json!({ "claim": format!("claim:{}", id(claim_n)), "verdict": format!("verdict:{}", id(n)), "outcome": "PASS" }),
    )
}

/// The record's n-th event.
pub fn event(n: u64) -> Value {
    if n <= SESSIONS {
        return event_in(
            n,
            of(n),
            "task.created",
            "core",
            json!({ "thread": session(of(n)), "title": title(of(n)) }),
        );
    }
    // Events that belong to a flow name the session of the event that started it.
    let r = n % 1_000;
    match r {
        0 => ask(n, of(n)),
        100 if n > 1_000 => answered(n, of(n - 100), &format!("ask:{}", id(n - 100))),
        500 => claim(n, of(n)),
        501 => event_in(
            n,
            of(n - 1),
            "run.started",
            "core",
            json!({ "claim": format!("claim:{}", id(n - 1)), "check": "unit", "run": format!("run:{}", id(n)) }),
        ),
        502 => event_in(
            n,
            of(n - 2),
            "run.finished",
            "core",
            json!({ "run": format!("run:{}", id(n - 1)), "outcome": "passed", "exit": 0 }),
        ),
        503 => verdict(n, of(n - 3), n - 3),
        _ if r % 97 == 0 => event_in(
            n,
            of(n),
            "session.attention",
            "hook",
            json!({ "state": "working" }),
        ),
        _ if r % 3 == 0 => event_in(
            n,
            of(n),
            "tool.after",
            "hook",
            json!({ "kind": "shell", "call": format!("toolu_{}", id(n - 1)), "exit": 0, "took_ms": 1_840 }),
        ),
        _ => tool_before(n, of(n)),
    }
}

fn tool_before(n: u64, k: u64) -> Value {
    event_in(
        n,
        k,
        "tool.before",
        "hook",
        json!({
            "kind": "shell",
            "paths": ["src/cart/totals.ts", "src/cart/totals.test.ts"],
            "command": "npx vitest run src/cart/totals.test.ts --reporter=dot",
            "call": format!("toolu_{}", id(n)),
        }),
    )
}

/// Two events a session, from log_pos `from`: an even session's claim and its PASS, an odd session's tool call and an
/// ask it leaves open. Each ends its session in [`expected`]'s state.
pub fn tail(from: u64) -> Vec<Value> {
    (0..SESSIONS)
        .flat_map(|k| {
            let n = from + 2 * k;
            if k % 2 == 0 {
                vec![claim(n, k), verdict(n + 1, k, n)]
            } else {
                vec![tool_before(n, k), ask(n + 1, k)]
            }
        })
        .collect()
}

/// The state [`tail`] leaves session `k` in.
pub fn expected(k: u64) -> State {
    if k % 2 == 0 {
        State::Pass
    } else {
        State::NeedsYou
    }
}
