//! AC1: the fold of a 90,600-event record at connect allocates at most 1.5 times the bytes of its parsed pages
//! (drafted), counted by the test. On the merge base it allocates about three times, and the test fails, naming the
//! bytes.
//!
//! The record is #1141's heavy record of 30 sessions (`bulk.rs`, reused by import), 90,540 events of its body and its
//! 60-event tail, so it ends with every session in a known state. The stand-in hub answers the reads the window's
//! reader makes at connect: an inbox read at log_pos 90,600 with no asks and no rows, so the record before it is folded
//! (#2026), its pages a thousand events at a time, and the subscription. The test counts every byte its own thread
//! allocates from the moment the window's reader opens until the reader says the record is folded, and it counts what
//! parsing each page the hub sent, once, allocates: the bytes of the parsed pages.

use std::time::{Duration, Instant};

use deep_app::record::{self, RecordReader};
use serde_json::Value;

use crate::alloc::counted;
use crate::bulk;
use crate::hub::{record_answer, StandIn};

/// The issue's record and its drafted bound.
const EVENTS: u64 = 90_600;
const BOUND: f64 = 1.5;
/// The body's events, then `bulk::tail`'s two a session.
const BODY: u64 = EVENTS - 2 * bulk::SESSIONS;

/// The record's event at `log_pos`.
fn at(log_pos: u64) -> Value {
    if log_pos <= BODY {
        bulk::event(log_pos)
    } else {
        let mut tail = bulk::tail(BODY + 1);
        tail.swap_remove((log_pos - BODY - 1) as usize)
    }
}

fn mb(bytes: u64) -> String {
    format!("{bytes} bytes ({:.1} MB)", bytes as f64 / 1e6)
}

#[test]
fn ac1_the_fold_of_a_90600_event_record_at_connect_allocates_at_most_1_5_times_its_parsed_pages() {
    crate::quiet_home();
    let hub = StandIn::start(std::sync::Arc::new(|method: &str, params: &Value, _: usize| {
        record_answer(method, params, &at, EVENTS).unwrap_or(Value::Object(Default::default()))
    }));

    // The window's reader (#1172, #2026): it checks the hello, reads, subscribes and folds the record before its read.
    let ((), allocated, blocks) = counted(|| {
        let reader = RecordReader::open_folded(&hub.socket, &hub.token_file)
            .unwrap_or_else(|error| panic!("BLOCKED: the window's reader can't open on the stand-in hub: {error:?}"));
        record::install(reader);
        let began = Instant::now();
        // A reader that folds on its next read, not at connect, folds here, still counted.
        while !(record::folded() && record::with_view(|view| view.log_pos) == Some(EVENTS)) {
            assert!(
                began.elapsed() < Duration::from_secs(600),
                "BLOCKED: the reader didn't fold the record in 600 s: folded {}, log_pos {:?}",
                record::folded(),
                record::with_view(|view| view.log_pos)
            );
            record::poll(Duration::from_millis(1)).expect("the reader's read");
        }
    });

    // The fold is the record's: every session, its title and the state the record left it in.
    let got: Vec<(String, String, String)> = deep_app::views::sidebar()
        .into_iter()
        .map(|(session, title, state)| (session, title, format!("{state:?}")))
        .collect();
    let want: Vec<(String, String, String)> = (0..bulk::SESSIONS)
        .map(|k| (bulk::session(k), bulk::title(k), format!("{:?}", bulk::expected(k))))
        .collect();
    assert_eq!(got, want, "the folded record shows other sessions, titles or states than the record holds");

    // The bytes of the parsed pages: each page the reader read, parsed once.
    let pages: Vec<String> = hub
        .calls()
        .into_iter()
        .filter(|call| call.method == "events.read")
        .map(|call| call.reply)
        .collect();
    let read: u64 = pages
        .iter()
        .map(|line| line.len() as u64)
        .sum();
    let mut parsed = 0;
    for line in &pages {
        let (value, bytes, _) = counted(|| serde_json::from_str::<Value>(line).expect("a page the hub sent parses"));
        drop(value);
        parsed += bytes;
    }
    assert!(pages.len() >= 91, "BLOCKED: the reader read {} pages of a 90,600-event record", pages.len());
    let ratio = allocated as f64 / parsed as f64;
    let reading = format!(
        "the fold of {EVENTS} events read {} pages ({} of JSON lines) and allocated {} in {blocks} blocks; parsing those \
         pages once allocates {}: {ratio:.2} times the bytes of its parsed pages",
        pages.len(),
        mb(read),
        mb(allocated),
        mb(parsed)
    );
    println!("{reading}");
    assert!(
        ratio <= BOUND,
        "FAIL: {reading}, past the drafted {BOUND} times ({} at most)",
        mb((parsed as f64 * BOUND) as u64)
    );
}
