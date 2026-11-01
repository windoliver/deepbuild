# Acceptance tests for #883: notifications leave once their ask closes, give the default as a clock time, and never repeat after a restart

Written blind at base commit `0f7fb686` ("Merge pull request #873 …"), from the issue, the design doc and the base
alone, before any implementation. Per AGENTS.md the implementing agent doesn't edit them; a dispute goes to a blind
redraft by this job.

## What was read

- Issue #883 as given to this job: its Scope (five lines), AC1–AC4, Proof, and "Depends on #326".
- `docs/technical-design.md`: "An ask, and your answer getting back" (every ask ends; outcomes from a closed set,
  superseded and moot among them; "Where they reach you": one item is one thread on every channel, answering it
  anywhere closes it everywhere, you're never asked twice); "First-party extensions that ship on by default", the
  `view` row (a notification carries the question, its default and when the default applies, fires only if the
  state still holds a second later, skips the session you're looking at; an item leaves only on your answer, a rule,
  its deadline, superseded or moot); "States people see"; the DeepBuild app and Trusted ring rows near the top
  (notifications are the app shell's).
- The base's notifier and harness: `crates/deep-app/src/{notify.rs,states.rs,record.rs,events.rs}`,
  `crates/deep-replica/src/{lib.rs,replica.rs,kit.rs}` (`Replica`, `Posted`, `Planted`, `kill`/`relaunch` on gpui's
  virtual clock). At the base `Notifier` posts and never removes, its text ends "If you don't answer: <label>, in
  <span>." (`states::span_until`), and `Replica::relaunch` builds a fresh notifier that is never shown the record.
- `packages/contracts/schemas`: `ask.created@4`, `ask.answered@4` (`via`: card, inbox, session), `ask.superseded@1`,
  `ask.moot@1`, `ask.defaulted@1`, and their fixtures.
- The earlier blind suites' conventions: `tests/acceptance/326/surfaces` and `tests/acceptance/327` (harness-less
  targets in `crates/deep-replica/Cargo.toml`, `Planted` variants, scenario judges that return the failure text).

## The surface (my choice, since the issue names none)

Everything is on the `deep_replica` crate root, where `Replica`, `Posted`, `Planted`, `Killed` already are. Existing
items keep their meaning (`open`, `open_devices`, `append`, `advance`, `now`, `focus`, `notifications`, `kill`,
`relaunch`, `open_asks`, `NOW`, `repo_root`). New:

```rust
// crates/deep-replica, the crate root

pub struct Posted {
    // … the base's fields (device, ask, session, at, text, sound), unchanged; `text` stays its title and body …
    pub title: String,                 // NEW: the notification's title, as the OS shows it
}

pub enum Planted {
    // … the base's variants …
    NeverWithdraws,                    // NEW, AC1: the notifier on main: posts, never withdraws or replaces anything
    QueuesOpenAsksOnStart,             // NEW, AC4: a notifier that queues every open ask in the record on start
}

impl Replica {
    /// What Notification Center on `device` holds now, oldest first: every notification posted there and not yet
    /// withdrawn, with a replaced one shown as the notification that replaced it.
    pub fn delivered(&self, device: usize) -> Vec<Posted>;
    /// The hub restarts: a new start ID, so every device's record reader redoes its reads of the whole record and
    /// subscribes again. The record and the clock are unchanged.
    pub fn restart_hub(&mut self);
    /// A channel reconnects: every device's stream to the hub drops and connects again, and the record's events
    /// reach the app again, as a channel resubscribing from the start would deliver them.
    pub fn reconnect(&mut self);
}
```

How the tests read them:

- **Notification Center** is per device and belongs to the OS. `notifications()` stays the list of every post, as
  the OS was asked to show it; `delivered(device)` is what is in Notification Center now, after posts, replacements
  and withdrawals. The cases never require a notification to survive a relaunch, only that the app posts nothing
  again and that Notification Center never holds the ask twice.
- **"In place"** (a newer notification replaces the older one in place) is read only as its visible result: one
  notification left for the session, the newer one. Posted carries no OS identifier, so the identifier reuse isn't
  asserted.
- **`relaunch`** (the base's) must open the app on the record and clock the kill left the way the app starts: its
  notifier sees the record as the app reads it on start. That is what makes `Planted::QueuesOpenAsksOnStart` post
  again; the right app must not.
- **Planted programs** are `Replica::planted(fixture, Planted::…)`, one device, as #327's are; the fault survives
  `kill`/`relaunch` (the base's `Killed` already carries faults).

## Time zone

The issue says "your time zone". The suite fixes it for the whole test process: the first line of `main`, before
any thread or app starts, sets `TZ=Europe/Berlin`. The app must read the zone from the OS (libc `localtime_r`,
`chrono::Local` and macOS's `CFTimeZone`/`NSTimeZone` system zone all honour `TZ`); it must not take UTC or a zone of
its own. Berlin is CET (UTC+1) in January, so a UTC reading says 15:40 where 16:40 is due and fails.

The virtual clock starts at `deep_replica::NOW`, 1,800,000,000,000 ms = 2027-01-15 08:00 UTC = 09:00 in Berlin. The
AC3 cases advance to 14:40 local (`NOW + 20,400,000`), then raise an ask whose default applies at 16:40 today
(1,800,027,600,000) or 16:40 tomorrow (1,800,114,000,000). Each case first checks its own premise with
`TZ=Europe/Berlin date -r <s> +%H:%M` reading 16:40. At 14:40 the base's text for today's case is "in 2 h", the
wrong text AC3 names.

## How the cases drive the record

- **An ask opens**: `append(session, ask.created@4)`, an authority ask whose default `no` is labelled "No".
- **Answered in the CLI**: the core's `ask.answered@4` with `via: "inbox"` (`deep inbox answer`), appended after the
  ask notified.
- **Superseded / moot / past its deadline**: the core's `ask.superseded@1` (`by` the newer ask from the same
  session), `ask.moot@1` (`check_passed`), and, once the clock reaches the ask's deadline, `ask.defaulted@1`. The
  record saying it closed is what withdraws it ("from wherever the record says it closed").
- **Quitting and reopening the app**: `kill()` then `Replica::relaunch(killed)`, the base's.
- **Restarting the hub**: `restart_hub()`. **A channel reconnect**: `reconnect()`.
- **Seen on screen**: `focus(0, Some(session))` before the ask opens, the base's: that ask never notifies.

## Fixtures

`fixtures/`, every event checked against its kind's published schema (9 events, 0 invalid; the command is in
BASE-FAILURE.txt):

| File | Holds |
|---|---|
| `two-sessions.events.jsonl` | two sessions, `…S01` (task "Cart totals", `~/src/shop`) and `…S02` (task "Release notes"), and nothing asked |
| `live.json` | templates the cases append: `ask.created@4`, `ask.answered@4` (`via: "inbox"`), `ask.superseded@1`, `ask.moot@1`, `ask.defaulted@1` |

The cases set only `id`, `ts`, `subject`, `ask.created`'s `data.deadline`, `data.question` and `data.key`,
`ask.superseded`'s `data.by` and `ask.moot`'s `data.verdict`.

## How to run

```sh
cargo test --locked -p deep-replica --test acceptance_883            # all 19 cases
cargo test --locked -p deep-replica --test acceptance_883 -- ac1_     # the cases whose names hold ac1_
```

One `[[test]]` entry in `crates/deep-replica/Cargo.toml` (`name = "acceptance_883"`, `harness = false`). No libtest
harness, as the replica's other suites: every case on the main thread, libtest's result lines printed, a non-zero
exit on any failure. A filter naming no case runs nothing and exits 1 (INCONCLUSIVE); off macOS the target prints
INCONCLUSIVE and exits 1.

## Criteria, tests and wrong programs

| Criterion | Tests (notifications.rs) | Wrong program it fails |
|---|---|---|
| AC1: an ask that notified and is answered in the CLI leaves Notification Center within 2 s | `ac1_an_ask_answered_in_the_cli_leaves_notification_center_within_2_s`: notified at 1 s and in Notification Center; `ask.answered` via inbox; 2 s later `delivered(0)` holds nothing for it | `planted_ac1_the_notifier_on_main_leaves_it_and_fails_naming_the_ask`: `Planted::NeverWithdraws` through the same scenario; the judge's failure must name the ask |
| AC2: two asks from one session 30 s apart leave one, the second's | `ac2_two_asks_from_one_session_30_s_apart_leave_one_the_seconds`: `delivered(0)`'s asks are exactly `[second]` | `planted_ac2_the_notifier_on_main_leaves_both_of_one_sessions_asks` (`NeverWithdraws` leaves both) |
| AC2: two asks from two sessions leave two | `ac2_two_asks_from_two_sessions_leave_two`: exactly two, one per ask | a notifier that keeps one notification in all (not planted; the base model can't build it) |
| AC3: a default at 16:40 today reads "at 16:40" | `ac3_a_default_at_16_40_today_reads_at_16_40`: the post's text holds "at 16:40", not "tomorrow", not "in 2 h" | the base's own text ("in 2 h", BASE-FAILURE.txt), and `planted_ac3_a_text_with_in_2_h_fails` |
| AC3: one tomorrow reads "tomorrow at 16:40"; a text with "in 2 h" fails | `ac3_a_default_at_16_40_tomorrow_reads_tomorrow_at_16_40`; `planted_ac3_a_text_with_in_2_h_fails`: the judge fails a text ending "No, in 2 h." for both, saying why, and passes the issue's own example | as left |
| AC4: one ask notified; quit and reopen the app, then restart the hub: no second notification | `ac4_quitting_and_reopening_the_app_then_restarting_the_hub_posts_nothing_again`: 5 s after the relaunch and 5 s after the hub restart, no post for the ask after its first; Notification Center never holds it twice; then a new ask in the other session still notifies once (the control: a notifier silenced by a restart fails) | `planted_ac4_a_notifier_that_queues_every_open_ask_on_start_fails_naming_the_ask`: `Planted::QueuesOpenAsksOnStart`; the failure must name the ask |

The issue's Scope, beyond the criteria:

| Scope line | Test | Wrong program |
|---|---|---|
| withdrawn when superseded | `scope_withdrawn_when_superseded`: S1's page is focused before the newer ask opens, so the newer one posts nothing and only a withdrawal clears the old one | `planted_scope_the_notifier_on_main_fails_each_withdrawal` |
| withdrawn when moot | `scope_withdrawn_when_moot` | as above |
| withdrawn when it passes its deadline | `scope_withdrawn_when_its_deadline_passes`: deadline 10 s on; at the deadline the core records `ask.defaulted`; 2 s later nothing left | as above |
| from wherever the record says it closed | `scope_withdrawn_from_every_device`: two paired devices; answered in the CLI; neither holds it 2 s later | (main's notifier) |
| nothing for an ask you already saw on screen, after an app restart, a hub restart or a channel reconnect | `scope_an_ask_you_saw_on_screen_posts_nothing_after_restarts_or_a_reconnect` | `planted_scope_queueing_on_start_fails_an_ask_you_saw_on_screen` |
| nothing again after a channel reconnect | `scope_an_ask_that_notified_posts_nothing_after_a_channel_reconnect`: reconnect first, then the restarts | (the queueing program, via the shared judge) |
| the title names DeepBuild and the session's task | `scope_the_title_names_deepbuild_and_the_sessions_task`: `Posted.title` holds "DeepBuild" and "Cart totals" / "Release notes" | the base's text, which names the task but not DeepBuild |

The withdrawal and restart judges are shared functions that return the failure text, so each planted case runs the
very judge its criterion's case runs.

## What the base commit has

At `0f7fb686` the target doesn't compile: `Replica` has no `delivered`, `restart_hub` or `reconnect`, `Planted` has
no `NeverWithdraws` or `QueuesOpenAsksOnStart`, and `Posted` has no `title` (6 errors, every one naming the missing
surface). So all 19 cases fail at the base. BASE-FAILURE.txt also holds a run of the same file with only its
`mod surface` block swapped for a shim over the base's own surface (kept outside the checkout), to show where each
case fails at a named assertion on main's notifier, and a run against a test-side model of a right Notification
Center, to show the judges pass a right program. Under the base shim AC1, AC2 (one session), AC3, the four
withdrawal cases and the title case fail at their named assertions. AC4 and the two restart scope cases pass there,
because the base replica's relaunch never shows the record to its notifier and the base has no hub restart or
reconnect. So at the base they fail only for the missing surface, and their wrong program, a notifier that queues
every open ask on start, is shown failing by the planted cases.

## Not covered here

- **Proof on the reference Mac.** The issue's Proof asks for Notification Center before and after each case,
  captured on the reference Mac. These are the replica's cases; the live captures are the implementer's.
- **"A session moving into needs you"** is covered only as an ask opening, the one way the record moves a session
  into needs you.
- **A day other than today or tomorrow.** The issue says the day is given when it isn't today, and shows only
  "tomorrow"; the word for a later day isn't stated, so it isn't asserted.
- **Replacement "in place"** beyond one notification left (above).
- **Withdrawal while the app is quit.** Whether a notification of an ask closed while the app was down is withdrawn
  on relaunch isn't stated; not asserted.

## Assumptions a redraft may revisit

- I picked every name above. `delivered` models Notification Center rather than the OS calls, since the replica
  posts nothing to the real OS.
- "Within 2 s" is on the virtual clock, from the closing event's append.
- `TZ` is the deterministic stand-in for "your time zone"; a redraft could add an explicit zone to the replica.
- "At 16:40" is matched as a substring; "today at 16:40" would also pass the today case, since the issue forbids
  only the relative wording and the wrong day.
- A channel reconnect is read as the app's stream to the hub reconnecting and the record's events reaching the app
  again; channels to a phone or a chat app aren't in the replica.
