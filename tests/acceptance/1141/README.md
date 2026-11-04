# Acceptance tests for #1141: the app's record reader keeps what the app shows, not every streamed event

Written first, blind, from issue #1141 (its text as of November 3, 2026: the problem, Scope, the three acceptance
criteria, Proof and Depends on #326), and from `docs/technical-design.md`: Numbers version 0 has to hold (the app under
300 MB with 30 sessions; every task carries its own budgets; the reference Macs; the five-run timing rule), One event
log, with tables built from it, and How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong
programs); and from the base commit `15de8c5b` (the worktree's HEAD; `crates/deep-app` and `crates/deep-replica` are
identical at `502541f6`): `crates/deep-app/src/{record.rs,states.rs,notify.rs,views.rs,hub.rs,main.rs}`, the replica's
use of the reader (`crates/deep-replica/src/replica.rs`), the KISS commits `5dc58309` and `b64c872e` that the issue
cites, and the earlier blind suites `tests/acceptance/34` (the scripted hub on a Unix socket), `tests/acceptance/883`
(a `surface` module a base run can swap), `tests/acceptance/69` and `tests/acceptance/397` (the timing judge and the
reference-Mac check). Nothing of #1141 is implemented at the base, and no implementation of it was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

From the checkout, with cargo (the first build compiles gpui-kit; set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`
on a shared machine). The dev profile is enough: memory per held event is the same in a release build, and AC3 judges
growth with the count plus a budget a folded read is far inside.

```sh
# AC2 and AC3 (the plants are ignored in this build); one test at a time, since AC3 times.
cargo test --locked -p deep-app --test acceptance_1141 -- --test-threads=1
# AC1, a binary of its own so the process holds only the reader.
cargo test --locked -p deep-app --test acceptance_1141_memory
# The wrong programs, each in a build with its plant.
cargo test --locked -p deep-app --features plant-drops-close  --test acceptance_1141 -- --test-threads=1 plant_drops_close
cargo test --locked -p deep-app --features plant-walks-events --test acceptance_1141 -- --test-threads=1 plant_walks_events
```

- AC1's scripted hub makes its folder under `/tmp/da1141-<pid>` and removes it; it starts no process.
- Results: a test passes only on PASS. A failure message starts `FAIL:` (the program is wrong), `INCONCLUSIVE` (a
  reading only: off a reference Mac, Low Power Mode on or unknown, a thermal warning, or a 1-minute load average above
  half the cores; mains power never gates) or `BLOCKED:` (the setup didn't get where it needed to). An unmeasured
  budget is never a pass.

## The surface

The issue names the reads that must stay the same (`states::state`, `states::open_asks`, `states::title` and the
notifier) and says `View.events` goes, so those reads can no longer take the whole list. These tests reach the reader
through what stays (#34's and #326's) and the smallest new surface below, all in `crates/deep-app`. Every use of the
new surface is in `app/surface.rs`, so a run against another program swaps that one file.

What stays, and these tests use: `record::RecordReader::open`, `record::install`, `record::install_local`,
`record::feed`, `record::poll`, `record::with_view`, `record::View`'s `log_pos` (#34's), `notify::{Notifier,
Notification, NOTIFY_AFTER}`, `Notifier::{new, saw, delivered}`, `Notification`'s five fields, `states::State` with
its variants and their fields as at the base. Nothing here reads `View.events`, `View.inbox` or any other field of
`View`.

New or changed:

```rust
// crates/deep-app/src/views.rs
/// What the sidebar draws, from the one record reader: every session, in the order each first appears in the record,
/// with its task's title and its state: what the merge base's `states::every_session(&view.events)` gives over every
/// event the reader has applied. Empty before a reader is installed. The sidebar's `Render` draws exactly these rows
/// and reads nothing else of the record, so timing this times a render's read.
pub fn sidebar() -> Vec<(String, String, crate::states::State)>;

// crates/deep-app/src/record.rs
impl View {
    /// The open asks' handles (`ask:<id of its ask.created>`), oldest first; of one session when `session` names
    /// one: what the merge base's `states::open_asks(&events, session)` gives, by handle.
    pub fn open_asks(&self, session: Option<&str>) -> Vec<String>;
    /// When the open ask `ask` (a handle) defaults: what the merge base's `states::deadline(&events, created)` gives
    /// for its `ask.created`. Asked only of an open ask.
    pub fn deadline(&self, ask: &str) -> Option<u64>;
}

// crates/deep-app/src/notify.rs: the two methods that took the whole list take the view instead; same behavior.
impl Notifier {
    pub fn start(&mut self, view: &crate::record::View, delivered: Vec<Notification>);
    pub fn due(&mut self, view: &crate::record::View, now: u64, looking_at: Option<&str>, sounds: bool)
        -> Vec<Notification>;
}
```

```toml
# crates/deep-app/Cargo.toml: the plants (below), off by default and in no shipped build.
[features]
plant-drops-close = []
plant-walks-events = []
```

The two `[[test]]` entries are already in `crates/deep-app/Cargo.toml` (this job's wiring, as #34's):

```toml
[[test]]
name = "acceptance_1141"
path = "../../tests/acceptance/1141/app/folded.rs"

[[test]]
name = "acceptance_1141_memory"
path = "../../tests/acceptance/1141/app/memory.rs"
```

## The plants

| Feature | What the plant must do | Which test fails on it, and how |
|---|---|---|
| `plant-drops-close` | The record reader's fold drops every `ask.moot`: it applies none to what it keeps, so an ask whose close is an `ask.moot` stays open in the view (`View::open_asks` lists it, its session reads needs you, the notifier never withdraws it). Every other event folds as in the right build. | `plant_drops_close_a_reader_that_drops_an_asks_close_fails_naming_the_ask` runs AC2's judge and requires it to fail naming an ask that an `ask.moot` closed in that seed's stream |
| `plant-walks-events` | The reader also keeps every event it applies, as the merge base's `View.events` did, and `views::sidebar()` and `Notifier::due` read by walking all of them on every call (the merge base's `states::every_session`, `open_asks` and `closed_asks` over that list). What they return is unchanged. | `plant_walks_events_a_reader_that_walks_every_event_per_render_fails_at_100000_events` runs AC3's judge and requires a FAIL whose message starts `at 100,000 events held` |

In the default build both plant tests are `#[ignore]`d with the reason, so the criteria's run reports them ignored,
never passed; each runs in its own build (How to run).

## The records

- **AC2's seeded streams** (`stream` in `folded.rs`): 12 seeds, 1,200 records each, over 8 working sessions and a
  ninth that only stops and gets notices (so it stays queued). Asks (taste and authority, with options, a default and
  a deadline) closed by each of the seven close kinds (`decision.applied`, `ask.answered`, `ask.defaulted`,
  `ask.escalated`, `ask.cancelled`, `ask.superseded`, `ask.moot`) written by each of `core`, `app`, `hook` and
  `mcp:agent`, half with the ask's session column; decisions applied whose data names another ask than their subject;
  `default.undone` by the core and others, with and without a deadline; `deadline.moved` by the core and others;
  claims with `run.started`/`run.finished` (the expected check time), half of them followed at once by a verdict and a
  third of those by its `verdict.stale`, verdicts of all five outcomes, `verdict.stale`,
  `claim.sent_back` with rounds; `session.attention` in four states; `task.created` naming any thread, with or without
  a session column; `notice.sent`; tool calls, prompts and stops. The test fails `BLOCKED` if the streams miss any of
  these, any close kind actually closing an ask, or any of the 11 state words.
- **The heavy record** (`bulk.rs`): 30 sessions, each starting with its `task.created`, then mostly the hook's
  `tool.before`/`tool.after` in the record's shape (~600 bytes of JSON each), an ask every 1,000 events that the core
  answers 100 events later, and a claim, a run and a PASS every 1,000. Made event by event, so nothing but the reader
  holds it. AC1 ends it with `tail`: each even session's claim and PASS, each odd session's open ask.

## Criteria to tests

| ID | Criterion (short) | Test | What it proves |
|---|---|---|---|
| AC1 `#1141.d671320f` | 30 sessions, 200,000 streamed events: resident under 300 MB; the base exceeds it, naming the count | `memory.rs` `ac1_with_30_sessions_and_200000_streamed_events_the_apps_resident_memory_stays_under_300_mb` | The real `RecordReader` opens on a scripted hub (#16's line protocol; `inbox.read`, `sessions.read`, paged `events.read`, `stream.subscribe`), installed as the app's one reader and polled until its view reflects log_pos 200,000. The process's peak resident memory (`getrusage` `ru_maxrss`, bytes on macOS; 300 MB read as 300,000,000 bytes) must be under 300 MB, or it fails `FAIL: … past the 300 MB budget at 200,000 events`. Then the sidebar must show the 30 sessions, their titles and the states the stream left (so a reader that keeps nothing fails). Under the budget off a reference Mac: INCONCLUSIVE. |
| AC2 `#1141.a41acab7` | state, title, open asks, notifier posts and withdrawals equal the base's whole-list reads on ≥1,000-record streams; a reader dropping a close fails naming the ask | `folded.rs` `ac2_each_sessions_state_title_and_open_asks_and_the_notifiers_posts_and_withdrawals_equal_the_merge_bases` | Per seed the app starts holding the first 300 records (`install_local`), with Notification Center holding each session's newest open ask; the other 900 stream in by `feed`. Every third record: every open ask (each session's and all) and each open ask's deadline (`View::open_asks`, `View::deadline`), then a notifier tick (`Notifier::due`, the record's session sometimes focused) whose posts and what Notification Center then holds must equal the merge base's notifier run on the whole list; every 24th and at the end, the sidebar's rows (session, title, state). The reference is `reference/`, the base's `states.rs` and `notify.rs` copied verbatim. The first difference fails, naming the ask (or session, or notification). |
| AC2's wrong program | a reader that drops an ask's close | `plant_drops_close_…` | as in The plants |
| AC3 `#1141.aafc5a77` | a sidebar render and a notifier tick each under 4 ms with 200,000 events held, independent of the count; a walker fails at 100,000 | `folded.rs` `ac3_a_sidebar_render_and_a_notifier_tick_take_under_4_ms_with_200000_events_held_independent_of_the_count` | The heavy record is fed to the one reader to 20,000, 100,000 and 200,000 events. At each, the sidebar's read (`views::sidebar()`) and a notifier tick that posts a newly due ask and withdraws the last one (`Notifier::due`) are timed: two warm-ups, then 21 calls or as many as 3 s allow (at least 5), median. Independent of the count: at 100,000 and 200,000 each median must stay within twice its 20,000 median plus 0.5 ms, or it fails `FAIL: at <count> events held, …` (a relation within one run, so it gates under load too). Then at 200,000, five single runs of each against 4 ms by the design's rule (PASS all within; FAIL all over by more than the margin, the larger of 5% and the runs' spread; else INCONCLUSIVE), judged only where a timing counts and INCONCLUSIVE elsewhere. Sanity: each render shows 30 sessions and each tick posts its ask. |
| AC3's wrong program | a reader that walks every event per render | `plant_walks_events_…` | as in The plants |

## Readings where the issue and the design leave a choice

- **"The app's resident memory"** is read as the resident memory of a process that holds the app's one record reader,
  fed through the hub's socket, and nothing else: the issue's 980 MB is the reader's (`View.events`), and the rest of
  the app (GPUI, the window) doesn't grow with the count. The budget is held whole against that process, peak not
  final. A redraft could launch the shipped app on the scripted hub instead.
- **"A render of the sidebar"** is its read of the record, `views::sidebar()`, which the sidebar's render must draw and
  nothing else (The surface). GPUI's layout and paint of 30 rows don't grow with the count and aren't timed; the
  issue's own sidebar numbers (228 ms, 13 ms) are that read.
- **"A notifier tick"** is one `Notifier::due` call that has work: an ask come due to post and a closed one to
  withdraw. An idle tick already reads nothing at the base (`b64c872e`).
- **"Independent of the event count"** is judged by the medians' growth from 20,000 to 100,000 and 200,000 (twice plus
  0.5 ms), not by a fixed ratio of 1, so a fold whose maps grow logarithmically passes and a walk (5 and 10 times)
  fails; "fails at 100,000 events" is the first count after 20,000.
- **Equality over "seeded streams of at least 1,000 records"** is checked as the records arrive, not only at the end,
  since a fold can agree at the end and differ on the way (an ask closed, undone and moved). The notifier's text
  carries the deadline as a clock time in the process's time zone; both notifiers run in the same process, so it
  needs no fixed zone.
- **What `View` holds** is the implementation's: no test reads a field of it but `log_pos`.

## What this suite doesn't cover

- **The Scope's other lines**: a view that needs history reading it from the hub in pages, and a restart or a new hub
  start rebuilding the folded view from the hub's reads. No criterion names them; AC1's scripted hub serves
  `sessions.read` (empty) and `events.read` (paged, at most 1,000) in case the reader reads at connect.
- **The menu bar**, which reads `states::menu` over the whole list at the base; the issue names it in its problem but
  in no criterion.
- **Other suites that read `View.events`**: `tests/acceptance/34/app/record_reader.rs` reads `view.events` (its
  `positions`), and the replica (`crates/deep-replica`) feeds its notifier from it. Those are the implementer's to
  carry; #34's tests go to their own blind redraft if they can't hold.

## Files

- `app/folded.rs`: AC2, AC3 and the two plant tests; AC2's seeded streams and both judges.
- `app/memory.rs`: AC1 and its scripted hub.
- `app/bulk.rs`: the heavy 30-session record, made event by event.
- `app/surface.rs`: every use of the new surface.
- `app/environment.rs`: the reference-Mac and timing-environment checks.
- `app/reference/`: the merge base's `states.rs` and `notify.rs`, verbatim, AC2's reference.
- `BASE-FAILURE.txt`: the run at the base.
