//! What `sound.rs` and `window.rs` share: the four sessions' record, an ask raised on the replica's record, and the
//! harness-less runner the replica's suites use (AppKit wants the main thread).
#![allow(dead_code)]

use std::cell::Cell;
use std::path::PathBuf;
use std::time::Duration;

use deep_replica::{repo_root, Posted, Replica};
use serde_json::{json, Value};

pub const SESSIONS: [&str; 4] = [
    "01MD994SESS000000000000S01",
    "01MD994SESS000000000000S02",
    "01MD994SESS000000000000S03",
    "01MD994SESS000000000000S04",
];

/// Four sessions, each with its task, and nothing asked yet.
pub fn record() -> PathBuf {
    repo_root().join("tests/acceptance/994/fixtures/four-sessions.events.jsonl")
}

pub fn secs(n: u64) -> Duration {
    Duration::from_secs(n)
}

pub struct Raised {
    pub handle: String,
    pub question: String,
}

thread_local! {
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

/// Opens an ask in `session` now: an authority ask of the core's, its default "No" applying two days on.
pub fn raise(replica: &mut Replica, session: &str) -> Raised {
    let n = NEXT.with(|next| next.replace(next.get() + 1));
    let id = format!("01MD9949{n:018}");
    let question = format!("Ship change {n} to origin?");
    let event: Value = json!({
        "v": 4, "id": id, "kind": "ask.created", "writer": "core", "actor": "you", "scope": "you",
        "ts": replica.now(),
        "data": {
            "kind": "authority", "question": question,
            "options": [
                { "id": "yes", "label": "Yes", "decision": "allow" },
                { "id": "no", "label": "No", "decision": "deny" }
            ],
            "recommended": null, "deadline": replica.now() + 2 * 86_400_000, "fallback": "you", "default": "no",
            "provisional": false, "owner": "you", "key": format!("{n:064x}"),
            "pinned_to": { "kind": "commit", "ref": "3f2a1c0b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b" }
        }
    });
    replica.append(session, event);
    Raised {
        handle: format!("ask:{id}"),
        question,
    }
}

/// Every post for `ask` so far, as the OS was asked to show it.
pub fn posts_for(replica: &Replica, ask: &str) -> Vec<Posted> {
    replica
        .notifications()
        .into_iter()
        .filter(|posted| posted.ask.as_deref() == Some(ask))
        .collect()
}

/// Runs the cases on this thread, as libtest would print them; a positional argument narrows them by name.
pub fn run(mut cases: Vec<(&'static str, fn())>) -> i32 {
    let filter = std::env::args().skip(1).find(|arg| !arg.starts_with('-'));
    cases.retain(|(name, _)| filter.as_deref().is_none_or(|filter| name.contains(filter)));
    if cases.is_empty() {
        // A filter that names nothing ran nothing, and nothing unrun passes.
        println!(
            "\ntest result: INCONCLUSIVE. the filter {:?} names no test; nothing ran",
            filter.unwrap_or_default()
        );
        return 1;
    }
    println!("\nrunning {} tests", cases.len());
    let mut failed = 0;
    for (name, case) in &cases {
        let ok = std::panic::catch_unwind(*case).is_ok();
        println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
        failed += usize::from(!ok);
    }
    println!(
        "\ntest result: {}. {} passed; {failed} failed",
        if failed == 0 { "ok" } else { "FAILED" },
        cases.len() - failed
    );
    i32::from(failed > 0)
}
