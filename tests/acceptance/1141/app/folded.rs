//! #1141, the folded record reader: written blind from the issue, docs/technical-design.md and the merge base
//! 15de8c5b, before any implementation (README.md says what was read and the surface these reach).
//!
//!   AC2 `#1141.a41acab7`  ac2_*   each session's state, title and open asks, and the notifier's posts and
//!                                 withdrawals, equal the merge base's whole-list reads (reference/, copied from
//!                                 the base) on 12 seeded streams of 1,200 records
//!   AC3 `#1141.aafc5a77`  ac3_*   a sidebar render and a notifier tick under 4 ms with 200,000 events held,
//!                                 independent of the event count (20,000, 100,000 and 200,000 held)
//!   plant_drops_close_*           AC2's wrong program: a reader that drops an ask's close fails, naming the ask
//!   plant_walks_events_*          AC3's wrong program: a reader that walks every event per render fails at 100,000
//!
//! Wired into deep-app by a `[[test]]` entry (`acceptance_1141`); run with
//! `cargo test --locked -p deep-app --test acceptance_1141 -- --test-threads=1`, and each plant with its feature:
//! `cargo test --locked -p deep-app --features plant-drops-close --test acceptance_1141 -- --test-threads=1 plant_drops_close`.
//! AC3 times, so the tests run one at a time.

#[path = "bulk.rs"]
mod bulk;
#[path = "environment.rs"]
mod environment;
#[path = "reference/mod.rs"]
mod reference;
#[path = "surface.rs"]
mod surface;

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use deep_app::notify::{Notification, Notifier, NOTIFY_AFTER};
use deep_app::record;
use environment::grouped;
use reference::{notify as base_notify, states as base};
use serde_json::{json, Value};

// ---- AC2's seeded streams.

const SEEDS: std::ops::RangeInclusive<u64> = 1..=12;
const RECORDS: u64 = 1_200;
/// The records the app holds when it starts; the rest stream to it one by one.
const BEFORE_START: usize = 300;
/// Sessions with work, and one more that only ever stops and gets notices, so it stays queued.
const SESSIONS: u64 = 8;
const CLOSES: [&str; 7] = [
    "decision.applied",
    "ask.answered",
    "ask.defaulted",
    "ask.escalated",
    "ask.cancelled",
    "ask.superseded",
    "ask.moot",
];
/// Who writes: the core and the app close an ask; the hook and an agent's MCP calls never do.
const WRITERS: [&str; 4] = ["core", "app", "hook", "mcp:agent"];
const OUTCOMES: [&str; 5] = ["PASS", "FAIL", "BLOCKED", "INVALID", "INCONCLUSIVE"];
const ATTENTION: [&str; 4] = ["working", "waiting", "unknown", "finished"];

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        // xorshift*: the high bits of the product, since the plain state's low bits follow each other.
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 32) % n
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

fn stream_session(seed: u64, k: u64) -> String {
    format!("{:08x}-1141-4000-8000-{seed:06}{k:06}", 0x5e55_0000 + k)
}

/// One seeded stream of `RECORDS` records, in log order: asks closed by every kind and writer, decisions applied that
/// name their ask in their data, defaults undone, deadlines moved, claims with runs, verdicts, stale verdicts and
/// send-backs, attention, tasks, notices and tool calls, over 9 sessions.
fn stream(seed: u64) -> Vec<Value> {
    let mut rng = Rng::new(seed);
    let mut ts = bulk::T0;
    let mut asks: Vec<(String, String)> = Vec::new();
    let mut defaulted: Vec<String> = Vec::new();
    let mut claims: Vec<(String, String)> = Vec::new();
    let mut runs: Vec<(String, String)> = Vec::new();
    let mut verdicts: Vec<(String, String)> = Vec::new();
    let mut out = Vec::new();
    let mut follow: Vec<Value> = Vec::new();
    for n in 1..=RECORDS {
        ts += 200 + rng.below(2_800);
        let id = format!("01KA{seed:04}{n:018}");
        let k = rng.below(SESSIONS + 1);
        let session = stream_session(seed, k);
        let event = |kind: &str, writer: &str, session: Option<&str>, data: Value| {
            let mut event = json!({ "v": 1, "id": id, "kind": kind, "log_pos": n, "writer": writer, "actor": "you",
                                    "scope": "you", "ts": ts, "data": data, "evidence": [], "verified": true });
            if let Some(session) = session {
                event["session"] = json!(session);
            }
            event
        };
        let tool = |rng: &mut Rng| {
            let kind = *rng.pick(&[
                "tool.before",
                "tool.after",
                "prompt.submitted",
                "agent.stop",
            ]);
            event(
                kind,
                "hook",
                Some(&session),
                json!({ "kind": "shell", "command": "npm test" }),
            )
        };
        if k == SESSIONS {
            // The quiet ninth session: stops and notices only, so nothing ever starts it.
            let kind = *rng.pick(&["agent.stop", "notice.sent"]);
            out.push(event(kind, "hook", Some(&session), json!({})));
            continue;
        }
        let closing = if rng.below(3) == 0 {
            *rng.pick(&WRITERS)
        } else {
            "core"
        };
        let deadline = ts + (1 + rng.below(48)) * 1_800_000;
        let roll = rng.below(100);
        let made = match roll {
            0..=21 => tool(&mut rng),
            22..=27 => event(
                "session.attention",
                "hook",
                Some(&session),
                json!({ "state": *rng.pick(&ATTENTION) }),
            ),
            28..=31 => {
                let thread = stream_session(seed, rng.below(SESSIONS));
                let column = (rng.below(2) == 0).then_some(session.as_str());
                event(
                    "task.created",
                    "core",
                    column,
                    json!({ "thread": thread, "title": format!("Task {}", rng.below(20)) }),
                )
            }
            32..=39 => {
                asks.push((format!("ask:{id}"), session.clone()));
                event(
                    "ask.created",
                    "core",
                    Some(&session),
                    json!({
                        "kind": *rng.pick(&["taste", "authority"]), "question": format!("Question {n}?"),
                        "options": [{ "id": "yes", "label": "Yes" }, { "id": "no", "label": "No" }],
                        "default": *rng.pick(&["yes", "no"]), "deadline": deadline, "owner": "you",
                    }),
                )
            }
            40..=63 if !asks.is_empty() => {
                // Mostly one of the newest asks, so sessions often have none open.
                let (ask, of) = if rng.below(5) < 4 {
                    asks[asks.len() - 1 - rng.below(asks.len().min(6) as u64) as usize].clone()
                } else {
                    rng.pick(&asks).clone()
                };
                let kind = *rng.pick(&CLOSES);
                let column = (rng.below(2) == 0).then_some(of.as_str());
                let mut close = if kind == "decision.applied" {
                    let (named, _) = rng.pick(&asks).clone();
                    let mut close = event(
                        kind,
                        closing,
                        column,
                        json!({ "decision": format!("decision:{id}"), "ask": ask }),
                    );
                    close["subject"] = json!(named);
                    close
                } else {
                    event(kind, closing, column, json!({}))
                };
                if kind != "decision.applied" {
                    close["subject"] = json!(ask);
                }
                if kind == "ask.defaulted" {
                    defaulted.push(ask);
                }
                close
            }
            64..=68 if !asks.is_empty() => {
                let ask = if !defaulted.is_empty() && rng.below(10) < 7 {
                    rng.pick(&defaulted).clone()
                } else {
                    rng.pick(&asks).0.clone()
                };
                let writer = if rng.below(4) < 3 {
                    "core"
                } else {
                    *rng.pick(&WRITERS)
                };
                let data = if rng.below(20) < 17 {
                    json!({ "deadline": deadline })
                } else {
                    json!({})
                };
                let mut undo = event("default.undone", writer, None, data);
                undo["subject"] = json!(ask);
                undo
            }
            69..=73 if !asks.is_empty() => {
                let ask = rng.pick(&asks).0.clone();
                let writer = if rng.below(4) < 3 {
                    "core"
                } else {
                    *rng.pick(&WRITERS)
                };
                let mut moved = event(
                    "deadline.moved",
                    writer,
                    None,
                    json!({ "deadline": deadline, "span": 3_600_000, "because": "notice" }),
                );
                moved["subject"] = json!(ask);
                moved
            }
            74..=79 => {
                claims.push((format!("claim:{id}"), session.clone()));
                let claim = event(
                    "claim.made",
                    "mcp:agent",
                    Some(&session),
                    json!({ "summary": "done" }),
                );
                // Half the claims get their verdict next, and a third of those go stale, so a session ends a
                // checkpoint on each verdict.
                if rng.below(2) == 0 {
                    let verdict = format!("verdict:01KB{seed:04}{n:018}");
                    follow.push(event("verdict.made", "core", Some(&session),
                        json!({ "claim": format!("claim:{id}"), "verdict": verdict, "outcome": *rng.pick(&OUTCOMES) })));
                    verdicts.push((verdict.clone(), session.clone()));
                    if rng.below(3) == 0 {
                        follow.push(event(
                            "verdict.stale",
                            "core",
                            Some(&session),
                            json!({ "verdict": verdict }),
                        ));
                    }
                }
                claim
            }
            80..=83 if !claims.is_empty() => {
                let (claim, of) = claims
                    [claims.len() - 1 - rng.below(claims.len().min(3) as u64) as usize]
                    .clone();
                runs.push((format!("run:{id}"), of.clone()));
                event(
                    "run.started",
                    "core",
                    Some(&of),
                    json!({ "claim": claim, "check": format!("k{}", rng.below(3)), "run": format!("run:{id}") }),
                )
            }
            84..=86 if !runs.is_empty() => {
                let (run, of) = rng.pick(&runs).clone();
                let outcome = if rng.below(4) < 3 { "passed" } else { "failed" };
                event(
                    "run.finished",
                    "core",
                    Some(&of),
                    json!({ "run": run, "outcome": outcome }),
                )
            }
            87..=91 if !claims.is_empty() => {
                let (claim, of) = claims
                    [claims.len() - 1 - rng.below(claims.len().min(4) as u64) as usize]
                    .clone();
                verdicts.push((format!("verdict:{id}"), of.clone()));
                event(
                    "verdict.made",
                    "core",
                    Some(&of),
                    json!({ "claim": claim, "verdict": format!("verdict:{id}"), "outcome": *rng.pick(&OUTCOMES) }),
                )
            }
            92..=93 if !verdicts.is_empty() => {
                let (verdict, of) = rng.pick(&verdicts).clone();
                event(
                    "verdict.stale",
                    "core",
                    Some(&of),
                    json!({ "verdict": verdict }),
                )
            }
            94..=95 if !claims.is_empty() => {
                let (claim, of) = rng.pick(&claims).clone();
                event(
                    "claim.sent_back",
                    "core",
                    Some(&of),
                    json!({ "claim": claim, "round": 1 + rng.below(3) }),
                )
            }
            96..=99 => event("notice.sent", "core", Some(&session), json!({})),
            _ => tool(&mut rng),
        };
        out.push(made);
        // What follows in the same turn takes the next log positions, IDs and times.
        for (i, mut next) in follow.drain(..).enumerate() {
            next["id"] = json!(format!("01K{}{seed:04}{n:018}", ["B", "C"][i]));
            out.push(next);
        }
    }
    out.truncate(RECORDS as usize);
    for (i, event) in out.iter_mut().enumerate() {
        event["log_pos"] = json!(i as u64 + 1);
    }
    out
}

// ---- AC2's judge: the app's folded reads against the merge base's whole-list reads, as the record streams in.

/// What the streams reached, so a stream that never reaches a case the criterion lists fails the test, not passes it.
#[derive(Default)]
struct Reached {
    /// (close kind, writer) pairs written.
    closes_written: BTreeSet<(String, String)>,
    /// Close kinds that were the close an ask's reading took.
    closed_by: BTreeSet<String>,
    /// A decision that closed the ask its data names, not its subject.
    decision_by_data: bool,
    /// An ask opened again by the core's undo of its default; an open ask whose deadline the core moved.
    reopened: bool,
    moved: bool,
    /// Every state word a session was in at a checkpoint.
    states: BTreeSet<String>,
    ask_posts: usize,
    notice_posts: usize,
    withdrawals: usize,
}

fn row(notification: &Notification) -> String {
    format!(
        "{} · session {} · {:?} · {:?} · sound {:?}",
        notification.ask.as_deref().unwrap_or("notice"),
        notification.session,
        notification.title,
        notification.text,
        notification.sound
    )
}

fn base_row(notification: &base_notify::Notification) -> String {
    format!(
        "{} · session {} · {:?} · {:?} · sound {:?}",
        notification.ask.as_deref().unwrap_or("notice"),
        notification.session,
        notification.title,
        notification.text,
        notification.sound
    )
}

/// The events about `ask`, as `kind writer @log_pos`, for a failure message.
fn history(events: &[Value], ask: &str) -> String {
    events
        .iter()
        .filter(|event| {
            event["subject"] == ask || event["data"]["ask"] == ask || base::handle(event) == ask
        })
        .map(|event| {
            format!(
                "{} {} @{}",
                event["kind"].as_str().unwrap_or("?"),
                event["writer"].as_str().unwrap_or("?"),
                event["log_pos"]
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The open asks, each session's and every one, and each open ask's deadline: the app's against the base's.
fn compare_asks(events: &[Value], at: &str) -> Result<(), String> {
    let mut scopes: Vec<Option<String>> = vec![None];
    scopes.extend(base::sessions(events).into_iter().map(Some));
    for scope in &scopes {
        let want: Vec<String> = base::open_asks(events, scope.as_deref())
            .into_iter()
            .map(base::handle)
            .collect();
        let got = surface::open_asks(scope.as_deref());
        if got != want {
            let ask = got
                .iter()
                .find(|ask| !want.contains(ask))
                .or_else(|| want.iter().find(|ask| !got.contains(ask)))
                .cloned()
                .unwrap_or_else(|| "the order".into());
            let reading = if want.contains(&ask) {
                "open"
            } else {
                "closed"
            };
            return Err(format!(
                "{at}: {ask} reads {reading} in the merge base's whole-list read and not in the app's folded view \
                 (open asks of {}: app {got:?}, base {want:?}); the events about it: {}",
                scope.as_deref().unwrap_or("every session"),
                history(events, &ask)
            ));
        }
    }
    for ask in base::open_asks(events, None) {
        let handle = base::handle(ask);
        let (want, got) = (base::deadline(events, ask), surface::deadline(&handle));
        if got != want {
            return Err(format!(
                "{at}: {handle} defaults at {want:?} in the merge base's read, at {got:?} in the app's; the events about it: {}",
                history(events, &handle)
            ));
        }
    }
    Ok(())
}

/// Each session's title and state, as the sidebar shows them: the app's against the base's.
fn compare_sessions(events: &[Value], at: &str, reached: &mut Reached) -> Result<(), String> {
    let want: Vec<(String, String, String)> = base::every_session(events)
        .into_iter()
        .map(|(session, title, state)| (session, title, format!("{state:?}")))
        .collect();
    let got: Vec<(String, String, String)> = surface::sidebar()
        .into_iter()
        .map(|(session, title, state)| (session, title, format!("{state:?}")))
        .collect();
    if got != want {
        let first = (0..want.len().max(got.len()))
            .find(|&i| got.get(i) != want.get(i))
            .unwrap_or(0);
        return Err(format!(
            "{at}: session row {first} reads {:?} in the app's sidebar and {:?} in the merge base's whole-list read",
            got.get(first),
            want.get(first)
        ));
    }
    for (_, _, state) in base::every_session(events) {
        reached.states.insert(state.word().to_owned());
    }
    Ok(())
}

/// What Notification Center holds from the app, as one comparable line each.
fn held(notifier: &Notifier) -> Vec<String> {
    notifier.delivered().iter().map(row).collect()
}

/// One seed's stream: the app holds its first records when it starts, with what Notification Center held from before
/// (each session's newest open ask), and the rest stream in one by one; every third record the notifier ticks, the
/// session it was about sometimes open in the focused window.
fn judge_seed(seed: u64, reached: &mut Reached) -> Result<(), String> {
    let all = stream(seed);
    let (start, rest) = all.split_at(BEFORE_START);
    record::install_local(start.iter().cloned());
    let mut events: Vec<Value> = start.to_vec();

    let mut before: Vec<(String, String, String)> = Vec::new();
    for ask in base::open_asks(&events, None) {
        let session = ask["session"].as_str().unwrap_or_default().to_owned();
        let title = format!("DeepBuild · {}", base::title(&events, &session));
        before.retain(|(_, of, _)| *of != session);
        before.push((base::handle(ask), session, title));
    }
    let mut app = Notifier::new(NOTIFY_AFTER);
    let mut merge_base = base_notify::Notifier::new(NOTIFY_AFTER);
    surface::start(
        &mut app,
        before
            .iter()
            .map(|(ask, session, title)| Notification {
                ask: Some(ask.clone()),
                session: session.clone(),
                title: title.clone(),
                text: format!("{title}\nheld from before"),
                sound: None,
            })
            .collect(),
    );
    merge_base.start(
        &events,
        before
            .iter()
            .map(|(ask, session, title)| base_notify::Notification {
                ask: Some(ask.clone()),
                session: session.clone(),
                title: title.clone(),
                text: format!("{title}\nheld from before"),
                sound: None,
            })
            .collect(),
    );
    let at = |events: &[Value]| {
        format!(
            "seed {seed}, after log_pos {}",
            events.last().map_or(json!(0), |e| e["log_pos"].clone())
        )
    };
    compare_asks(&events, &at(&events))?;
    compare_sessions(&events, &at(&events), reached)?;

    for (i, event) in rest.iter().enumerate() {
        let now = event["ts"].as_u64().unwrap();
        record::feed(event.clone());
        events.push(event.clone());
        app.saw(event, now);
        merge_base.saw(event, now);
        let here = at(&events);
        let last = i + 1 == rest.len();
        if i % 3 == 0 || last {
            compare_asks(&events, &here)?;
            let looking_at = (i % 4 == 0).then(|| event["session"].as_str()).flatten();
            let was: Vec<String> = merge_base.delivered().iter().map(base_row).collect();
            let posted: Vec<String> = surface::due(&mut app, now, looking_at, true)
                .iter()
                .map(row)
                .collect();
            let want: Vec<String> = merge_base
                .due(&events, now, looking_at, true)
                .iter()
                .map(base_row)
                .collect();
            if posted != want {
                return Err(format!(
                    "{here}: the app's notifier posted {posted:#?}, the merge base's {want:#?}"
                ));
            }
            let (got, kept) = (
                held(&app),
                merge_base
                    .delivered()
                    .iter()
                    .map(base_row)
                    .collect::<Vec<_>>(),
            );
            if got != kept {
                let ask = |line: &String| line.split(" · ").next().unwrap_or_default().to_owned();
                let odd = got
                    .iter()
                    .find(|line| !kept.contains(line))
                    .or_else(|| kept.iter().find(|line| !got.contains(line)));
                return Err(format!(
                    "{here}: {} — Notification Center holds {got:#?} from the app and {kept:#?} from the merge base's notifier",
                    odd.map_or_else(|| "the order differs".to_owned(), |line| format!("{} differs", ask(line)))
                ));
            }
            reached.ask_posts += want.iter().filter(|line| line.starts_with("ask:")).count();
            reached.notice_posts += want
                .iter()
                .filter(|line| line.starts_with("notice"))
                .count();
            reached.withdrawals += was
                .iter()
                .filter(|line| {
                    !kept
                        .iter()
                        .any(|now| now.split(" · ").nth(1) == line.split(" · ").nth(1))
                })
                .count();
        }
        // Sessions only where the asks were just compared, so a difference in an ask is named as the ask.
        if i % 24 == 0 || last {
            compare_sessions(&events, &here, reached)?;
        }
    }
    // What the stream reached, read from the record as the base reads it.
    for event in &all {
        let kind = event["kind"].as_str().unwrap_or_default();
        if CLOSES.contains(&kind) {
            reached.closes_written.insert((
                kind.to_owned(),
                event["writer"].as_str().unwrap_or_default().to_owned(),
            ));
        }
    }
    for ask in all.iter().filter(|event| event["kind"] == "ask.created") {
        let handle = base::handle(ask);
        let mut closed: Option<&Value> = None;
        for event in &all {
            if closed.is_none() && base::closes(event, &handle) {
                closed = Some(event);
            } else if closed.is_some_and(|close| close["kind"] == "ask.defaulted")
                && event["kind"] == "default.undone"
                && event["writer"] == "core"
                && event["subject"] == handle.as_str()
                && event["data"]["deadline"].is_u64()
            {
                closed = None;
                reached.reopened = true;
            } else if closed.is_none()
                && event["kind"] == "deadline.moved"
                && event["writer"] == "core"
                && event["subject"] == handle.as_str()
            {
                reached.moved = true;
            }
        }
        if let Some(close) = closed {
            reached
                .closed_by
                .insert(close["kind"].as_str().unwrap_or_default().to_owned());
            if close["kind"] == "decision.applied" && close["subject"] != handle.as_str() {
                reached.decision_by_data = true;
            }
        }
    }
    Ok(())
}

/// AC2's judge over every seed: the first difference, naming the ask, the session or the notification.
fn judge_streams() -> Result<Reached, String> {
    let mut reached = Reached::default();
    for seed in SEEDS {
        judge_seed(seed, &mut reached)?;
    }
    Ok(reached)
}

#[test]
fn ac2_each_sessions_state_title_and_open_asks_and_the_notifiers_posts_and_withdrawals_equal_the_merge_bases(
) {
    let reached = judge_streams().unwrap_or_else(|difference| panic!("FAIL: {difference}"));
    // Unreached is not passed: the streams must hold every case the criterion lists.
    let mut missing: Vec<String> = Vec::new();
    for kind in CLOSES {
        for writer in WRITERS {
            if !reached
                .closes_written
                .contains(&(kind.to_owned(), writer.to_owned()))
            {
                missing.push(format!("{kind} by {writer}"));
            }
        }
        if !reached.closed_by.contains(kind) {
            missing.push(format!("an ask closed by {kind}"));
        }
    }
    for (word, ..) in base::TABLE {
        if !reached.states.contains(word) {
            missing.push(format!("a session that is {word}"));
        }
    }
    for (hit, case) in [
        (
            reached.decision_by_data,
            "a decision applied that closes the ask its data names",
        ),
        (reached.reopened, "a default the core undid"),
        (reached.moved, "a deadline the core moved"),
        (reached.ask_posts > 0, "an ask notified"),
        (reached.notice_posts > 0, "a notice posted"),
        (reached.withdrawals > 0, "a notification withdrawn"),
    ] {
        if !hit {
            missing.push(case.to_owned());
        }
    }
    assert!(
        missing.is_empty(),
        "BLOCKED: the seeded streams never reach {missing:?}"
    );
    println!(
        "{} streams of {} records: {} ask notifications, {} notices, {} withdrawals, states {:?}",
        SEEDS.count(),
        grouped(RECORDS),
        reached.ask_posts,
        reached.notice_posts,
        reached.withdrawals,
        reached.states
    );
}

#[test]
#[cfg_attr(
    not(feature = "plant-drops-close"),
    ignore = "the plant runs only in a build with --features plant-drops-close"
)]
fn plant_drops_close_a_reader_that_drops_an_asks_close_fails_naming_the_ask() {
    let difference = match judge_streams() {
        Ok(_) => panic!("the planted reader that drops every ask.moot passed AC2's judge"),
        Err(difference) => difference,
    };
    // The ask it names is one an ask.moot closed, as the merge base reads the record.
    let seed: u64 = difference
        .strip_prefix("seed ")
        .and_then(|rest| rest.split(',').next())
        .and_then(|seed| seed.parse().ok())
        .unwrap_or_else(|| panic!("the failure names no seed: {difference}"));
    let events = stream(seed);
    let named: Vec<String> = events
        .iter()
        .filter(|event| event["kind"] == "ask.created")
        .map(base::handle)
        .filter(|handle| difference.contains(&format!("{handle} ")))
        .collect();
    let mooted = |handle: &String| {
        events
            .iter()
            .any(|event| event["kind"] == "ask.moot" && base::closes(event, handle))
    };
    assert!(
        named.iter().any(mooted),
        "the failure doesn't name an ask an ask.moot closed: {difference}"
    );
    println!("the planted reader fails: {difference}");
}

// ---- AC3: the sidebar's render and the notifier's tick, with 20,000, 100,000 and 200,000 events held.

const COUNTS: [u64; 3] = [20_000, 100_000, 200_000];
const BUDGET_MS: f64 = 4.0;

enum Outcome {
    Pass(String),
    Fail(String),
    Inconclusive(String),
}

/// The record the app holds: `bulk`'s events in order, and between ticks an ask that the tick posts and the core then
/// answers, so each tick reads the open asks and withdraws the last one.
struct Held {
    notifier: Notifier,
    body: u64,
    log_pos: u64,
    now: u64,
    asks: u64,
    problem: Option<String>,
}

impl Held {
    fn push(&mut self, mut event: Value) {
        self.log_pos += 1;
        event["log_pos"] = json!(self.log_pos);
        self.now = self.now.max(event["ts"].as_u64().unwrap_or(0));
        self.notifier.saw(&event, self.now);
        record::feed(event);
    }

    fn feed_to(&mut self, count: u64) {
        while self.body < count {
            self.body += 1;
            self.push(bulk::event(self.body));
        }
    }

    /// One sidebar render's read, timed.
    fn render(&mut self) -> Duration {
        let began = Instant::now();
        let rows = surface::sidebar();
        let took = began.elapsed();
        if rows.len() as u64 != bulk::SESSIONS && self.problem.is_none() {
            self.problem = Some(format!(
                "the sidebar shows {} sessions of {}",
                rows.len(),
                bulk::SESSIONS
            ));
        }
        took
    }

    /// One notifier tick with an ask come due, timed.
    fn tick(&mut self) -> Duration {
        self.asks += 1;
        // Past the body's IDs: the ask, and its answer at the next ID.
        let n = 10_000_000 + 2 * self.asks;
        let ask = bulk::ask(n, self.asks % bulk::SESSIONS);
        let handle = format!("ask:{}", ask["id"].as_str().unwrap());
        self.push(ask);
        self.now += NOTIFY_AFTER.as_millis() as u64 + 1;
        let began = Instant::now();
        let posted = surface::due(&mut self.notifier, self.now, None, true);
        let took = began.elapsed();
        if !posted
            .iter()
            .any(|notification| notification.ask.as_deref() == Some(handle.as_str()))
            && self.problem.is_none()
        {
            self.problem = Some(format!("a tick with {handle} come due posted {posted:?}"));
        }
        self.push(bulk::answered(n + 1, self.asks % bulk::SESSIONS, &handle));
        took
    }
}

fn ms(took: Duration) -> f64 {
    took.as_secs_f64() * 1e3
}

/// Calls after two warm-ups: 21, or as many as 3 s allow but at least 5.
fn sample(held: &mut Held, once: fn(&mut Held) -> Duration) -> Vec<f64> {
    once(held);
    once(held);
    let began = Instant::now();
    let mut out = Vec::new();
    while out.len() < 21 && (out.len() < 5 || began.elapsed() < Duration::from_secs(3)) {
        out.push(ms(once(held)));
    }
    out
}

fn median(runs: &[f64]) -> f64 {
    let mut sorted = runs.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[sorted.len() / 2]
}

/// The design's timing rule on five runs: PASS when all are within the limit, FAIL when all are over it by more than
/// the margin (the larger of 5% and the runs' spread), otherwise INCONCLUSIVE.
fn five_runs(name: &str, runs: &[f64]) -> Outcome {
    let (min, max) = runs
        .iter()
        .fold((f64::MAX, 0f64), |(lo, hi), r| (lo.min(*r), hi.max(*r)));
    let margin = 0.05f64.max((max - min) / min.max(1e-9));
    let shown = format!(
        "{name}: {} ms against {BUDGET_MS} ms (margin {:.0}%)",
        runs.iter()
            .map(|r| format!("{r:.3}"))
            .collect::<Vec<_>>()
            .join(", "),
        margin * 100.0
    );
    if runs.iter().all(|r| *r <= BUDGET_MS) {
        Outcome::Pass(shown)
    } else if runs.iter().all(|r| *r > BUDGET_MS * (1.0 + margin)) {
        Outcome::Fail(shown)
    } else {
        Outcome::Inconclusive(shown)
    }
}

/// AC3's judge. Independent of the event count: at 100,000 and 200,000 events held, each read's median is within
/// twice its median at 20,000 plus 0.5 ms, or it fails naming the count. Then the 4 ms budget at 200,000, judged on
/// five runs each where a timing counts, and a reading only (INCONCLUSIVE) anywhere else.
fn judge_timing() -> Outcome {
    record::install_local(std::iter::empty());
    let mut held = Held {
        notifier: Notifier::new(NOTIFY_AFTER),
        body: 0,
        log_pos: 0,
        now: bulk::T0,
        asks: 0,
        problem: None,
    };
    surface::start(&mut held.notifier, Vec::new());
    let mut first: Option<(f64, f64)> = None;
    let mut readings = Vec::new();
    for count in COUNTS {
        held.feed_to(count);
        let (render, tick) = (
            median(&sample(&mut held, Held::render)),
            median(&sample(&mut held, Held::tick)),
        );
        if let Some(problem) = held.problem.take() {
            return Outcome::Fail(format!("at {} events held, {problem}", grouped(count)));
        }
        readings.push(format!(
            "{} events: sidebar {render:.3} ms, tick {tick:.3} ms (medians)",
            grouped(count)
        ));
        let (render_at_first, tick_at_first) = *first.get_or_insert((render, tick));
        for (name, now, then) in [
            ("the sidebar's render", render, render_at_first),
            ("a notifier tick", tick, tick_at_first),
        ] {
            if now > 2.0 * then + 0.5 {
                return Outcome::Fail(format!(
                    "at {} events held, {name} took {now:.3} ms (median) against {then:.3} ms at {}: it grows with the \
                     event count; {}",
                    grouped(count),
                    grouped(COUNTS[0]),
                    readings.join("; ")
                ));
            }
        }
    }
    let renders: Vec<f64> = (0..5).map(|_| ms(held.render())).collect();
    let ticks: Vec<f64> = (0..5).map(|_| ms(held.tick())).collect();
    let at = grouped(COUNTS[2]);
    let judged = [
        five_runs(&format!("the sidebar's render at {at} events"), &renders),
        five_runs(&format!("a notifier tick at {at} events"), &ticks),
    ];
    let shown = |outcome: &Outcome| match outcome {
        Outcome::Pass(text) | Outcome::Fail(text) | Outcome::Inconclusive(text) => text.clone(),
    };
    let all = format!(
        "{}; {}",
        readings.join("; "),
        judged.iter().map(shown).collect::<Vec<_>>().join("; ")
    );
    if let Some(problem) = environment::timing_problem() {
        return Outcome::Inconclusive(format!("a reading only ({problem}): {all}"));
    }
    if judged
        .iter()
        .any(|outcome| matches!(outcome, Outcome::Fail(_)))
    {
        Outcome::Fail(all)
    } else if judged
        .iter()
        .any(|outcome| matches!(outcome, Outcome::Inconclusive(_)))
    {
        Outcome::Inconclusive(all)
    } else {
        Outcome::Pass(all)
    }
}

#[test]
fn ac3_a_sidebar_render_and_a_notifier_tick_take_under_4_ms_with_200000_events_held_independent_of_the_count(
) {
    match judge_timing() {
        Outcome::Pass(readings) => println!("PASS: {readings}"),
        Outcome::Fail(why) => panic!("FAIL: {why}"),
        Outcome::Inconclusive(why) => panic!("INCONCLUSIVE: {why}"),
    }
}

#[test]
#[cfg_attr(
    not(feature = "plant-walks-events"),
    ignore = "the plant runs only in a build with --features plant-walks-events"
)]
fn plant_walks_events_a_reader_that_walks_every_event_per_render_fails_at_100000_events() {
    match judge_timing() {
        Outcome::Fail(why) if why.starts_with("at 100,000 events held") => {
            println!("the planted reader fails: {why}")
        }
        Outcome::Fail(why) => panic!("the planted reader failed, but not at 100,000 events: {why}"),
        Outcome::Pass(readings) | Outcome::Inconclusive(readings) => {
            panic!("the planted reader that walks every event per render didn't fail at 100,000 events: {readings}")
        }
    }
}
