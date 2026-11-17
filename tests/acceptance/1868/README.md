# #1868 acceptance: canvas calls and deep_status that read the whole record

Written blind from the issue (#1868: Scope, its three checkbox criteria, Proof), the design (One event log, with tables
built from it; Numbers version 0 has to hold: Every task carries its own budgets, The reference Macs; How we know
version 0 works: Criteria to tests, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding) and base
`212f16d09`. No implementation was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

## Run

The checkout built: `npm ci && npm run build --workspaces`, `cargo build -p deep-hook` (a hub refuses to start without
deep-hook) and `cargo build --bin deep-show` (the canvas core the hub starts at its first canvas call). Every program
under test is the checkout the tests run from. No second checkout is needed: criteria 1 and 3 compare one program on
two records, and their wrong program is the merge base itself, run by the before lane.

```
node --test tests/acceptance/1868/canvas-cells.test.mjs                 # criterion 1: timed, macOS, a reference Mac
node_modules/.bin/vitest run tests/acceptance/1868/world-fresh.test.ts  # criterion 2
node --test tests/acceptance/1868/status-runs.test.mjs                  # criterion 3: timed, macOS, a reference Mac
```

On the loaded Mac this was written on they took about 2.5 minutes, 40 seconds and 1.7 minutes.

Criterion 2's file is a Vitest file because it drives two sessions to a carried check with #1018's helpers
(`../1018/helpers.ts`, which use #29's, #31's and #875's): it needs what #1018's suite needs, Vitest in the checkout's
node_modules included. The two timed files are plain `node --test` files and need only the built checkout.

Every hub gets a home of its own, under `/tmp/dh1868-*` for the timed files and `/tmp/dh1018-*` (#1018's helper)
for criterion 2, removed afterwards, and is stopped by its PID, as are the agent stand-ins and their `deep mcp`.
Nothing is killed by name or port.

## Requirement, check, proof

| Criterion | Check | Passes when |
|---|---|---|
| `#1868.f34f3f9c` with 200,000 `reading.recorded` events and 5,000 asks in the record, a `canvas.user` `cells` call answers within 20% of its time with an empty record, on the reference Mac; the merge base fails, naming both times | `canvas-cells.test.mjs` (one test) | Two hubs of this checkout, one on no record and one on the seeded record (below). In each, one session starts through its hooks, and the test connects with the `app` hello and the control token and calls `canvas.user` with `{ call: { call: "cells", session, tab: "terminal" } }`, the call `crates/deep-app/src/views.rs` sends every 250 ms. Both hubs give the same reply. Then the timing (below): five runs a side, the limit 1.2 times the empty record's time. The failure's message names both times. |
| `#1868.a903f1c6` a reading recorded after the world was built shows in the next deep_show's world, and an ask answered since shows as done; a planted world built once at start reads the old values and fails, naming the reading | `world-fresh.test.ts` (one test); twin `world-built-once` | One hub, started on a record that holds a session's open ask and one reading. (1) That session's deep_show (through its own `deep mcp`) of a board with a status mark bound to the ask and a value bound to the reading is presented, and deep_query reads the mark as `needs_you`. (2) Then the hub records a reading: two other sessions in two worktrees claim one task, the second claim reads a check as carried from the first session's run, and the gate records `runs saved by carrying across sessions` (1 run) under a handle of its own. And you answer the ask (`ask.answer`). (3) The next deep_show, of a board with a value bound to that reading, is presented; refused `ref_unresolved` naming the reading fails, with the reading's handle in the message. (4) The deep_show after, of a board with a status mark bound to the ask, reads the ask's state as `done`. |
| `#1868.bf84aa8b` with 200,000 run events in the record, one deep_status call for a session with 10 claims answers within 20% of its time with 1,000 run events, on the reference Mac; the merge base reads every run event for each claim and fails, naming both times | `status-runs.test.mjs` (one test) | Two hubs of this checkout, one on a record of 1,000 run events and one of 200,000 (below). In each, the session starts through its hooks and calls deep_status through its own `deep mcp`. Both answer with the session's 10 claims, newest first, each with its 10 runs and their outcomes. Then the timing (below): five runs a side, the limit 1.2 times the time with 1,000 run events. The failure's message names both times. |

**The timing**, for criteria 1 and 3, is the design's (Every task carries its own budgets; The reference Macs), judged by
the repo's own rule, `judgeLimit` and `fingerprint` of `scripts/benchmark.mjs`. After one warm-up run of each side, five
runs of each, the sides alternating and swapping which goes first. A run is the median of consecutive calls (three
`cells` calls; five deep_status calls), each timed from its request written to its reply read: on the app's connection
for `cells`, at the agent stand-in's pipe to `deep mcp` for deep_status. The limit is 1.2 times the median of the
reference side's five runs. PASS when all five runs of the long record are within the limit; FAIL when all five are
over it by more than the margin, the larger of 5% and the five runs' spread; anything else is INCONCLUSIVE. Off the
reference Macs (Mac15,7, Mac15,12, Mac17,10), off mains power, in Low Power Mode, with a thermal state that isn't
nominal, or with a one-minute load above the core count at a run's start or end, the result is a reading and the test
fails INCONCLUSIVE, naming both times and what kept it from counting. It never passes there.

A checkout that isn't built, a missing deep-hook or deep-show, a hub that doesn't start, a seed the record doesn't hold
as asked, a hook the hub doesn't acknowledge, a refused call or a fixture that doesn't read as seeded fails its test
with BLOCKED at the head of its message. None passes.

## Fixtures

All are seeded before the hub starts, through the checkout's own `@deepbuild/record` in a process of its own
(`probe.mjs`), each event appended with the record's `append` as the hub's core appends it, in batches of 1,000. IDs are
counted and times end a minute before the seed's `now`.

- **The long canvas record** (criterion 1, `seed-canvas`): 30 days, 250 ended sessions. 200,000 `reading.recorded`
  events spread evenly over the days, each written by the core for no session under a name of its own
  (`reading:<ULID>`), as the base's three writers name them (`sources.ts`, `gate-runner.ts`, `runs.ts`), over 20 source
  names. 5,000 asks, 20 a session (`ask.created@5`, the asks package's taste fixture): 19 of each 20 answered
  (`ask.answered@1`) a millisecond later, the 20th left open with a deadline 30 days ahead, so 4,750 read done and 250
  read as needing you.
- **The empty record** (criterion 1): none. The hub starts on a fresh home, so the record holds what the hub's start
  and the one session's three hooks wrote: no ask and no reading.
- **The world** (criterion 2, `seed-world`): the session's `session.start` an hour ago, one open taste ask of its own
  with a deadline three days ahead, and one reading of 3 no session owns, all in the record before the hub starts. The
  reading recorded later is the hub's own, from #1018's criterion-2 scenario as its suite builds it: #31's sample repo
  with three drafted checks (`price.sh`, `format.sh`, `journey:checkout`, each a Vitest run) in two linked worktrees,
  one Claude Code session in each (#29's stand-in, through deep-hook), the same prompt and handed definition, and two
  fixes that differ only in `src/cart.ts`. The second claim carries the two checks that leave `src/cart.ts` out, and
  the gate appends its sharing readings (`gate-runner.ts`, `saved`), each `reading:<ULID>`, for no session.
- **The run records** (criterion 3, `seed-runs`): the session under test started an hour ago and made 10 claims
  (`claim.made@1`), the newest in the record, each with 10 finished runs (`run.started@1` and `run.finished@1` by the
  core, five runs of `unit` and five of `lint`, one of each five failed): 200 run events, the same in both records.
  The other 800, or 199,800, run events are the runs of older, ended sessions' claims over 30 days, 10 claims a session
  and 10 runs a claim. The reply is the same size on both records, so only the history differs.

## Planted programs

One, for the implementer to add as a name `DEEP_HUB_PLANT` selects, in `Plant` and `PLANTS` of
`packages/hub/src/plant.ts` and nothing else in that file: the twin replaces it whole with the base's other exports
(`plantedSessionEnd`, `plantedReload`, `plantedStart`, `plantedStop`, `piAcceptsReplaced`), so a new export there
breaks the twin. `twins.json` maps the criterion to its twin; the twin is the base's `plant.ts` with `Plant` widened to
`string` and `plantOf` and `activePlant` giving that plant whatever the variable says.

- **`world-built-once`** (`#1868.a903f1c6`). The hub builds the record's part of the world its canvas core reads, each
  ask's state and each reading's value, once: at its start, or at its first canvas call. Every later canvas call
  (deep_show, deep_query, `canvas.user`, `canvas.revisions`, `canvas.messages`) reads those asks and readings as they
  were then, whatever the record has gained since. Everything else is as shipped: the sessions, the world file and the
  shown documents are read as the change reads them, and events are still recorded. `world-fresh.test.ts` then passes
  its step 1 and fails at step 3's assertion: `the reading reading:<id> (1 runs, "runs saved by carrying across
  sessions · …"), recorded at log_pos <n> after the world was built, is not in the next deep_show's world: the
  deep_show that binds a value to it was refused, ref_unresolved naming reading:<id>`. `BASE-FAILURE.txt` ends with
  that failure from a scratch stand-in for this plant (the base's hub with `canvasWorld()` keeping its first build's
  asks and readings, laid over the built file in memory).

Criteria 1 and 3 name the merge base as their wrong program.

## On the unchanged base

`BASE-FAILURE.txt` holds the runs made when this suite was written, with the machine, its power, thermal state and load.

- `canvas-cells`: fails at its assertion. On a quiet reference Mac it is a counted FAIL, `a canvas.user cells call took
  <t> ms with 200,000 reading.recorded events and 5,000 asks in the record (five runs: …) and <t> ms with an empty
  record (five runs: …): <n> times as long, where at most 1.20 times (<t> ms) is allowed. all five runs are over
  <limit> by more than the <m>% margin`. The Mac it was run on was loaded, so it failed `INCONCLUSIVE: a canvas.user
  cells call took 1657.3 ms with 200,000 reading.recorded events and 5,000 asks in the record (five runs: 2173.67,
  1657.33, 1608.09, 1627.18, 1922.73 ms) and 541.9 ms with an empty record (five runs: 541.32, 541.95, 484.20, 737.40,
  546.48 ms): 3.06 times as long, where at most 1.20 times (650.3 ms) is allowed. As a reading, all five runs are over
  the limit by more than the margin. …`, then what kept the reading from counting (thermal state "fair", load above
  the 8 cores).
- `world-fresh`: PASS. The base builds the world again at every canvas call, so a test of freshness can't fail on it;
  this criterion's wrong program is the planted one (Open points).
- `status-runs`: as `canvas-cells`: `INCONCLUSIVE: one deep_status call for the session with 10 claims took 2031.1 ms
  with 200,000 run events in the record (five runs: 1778.43, 1978.67, 2047.60, 2031.11, 2126.78 ms) and 7.19 ms with
  1,000 (five runs: 11.01, 7.19, 7.04, 7.21, 7.09 ms): 282.67 times as long, where at most 1.20 times (8.62 ms) is
  allowed. As a reading, all five runs are over the limit by more than the margin. …`.

With nothing built, every test fails `BLOCKED: this checkout is not built …`; with no deep-show, `canvas-cells` and
`world-fresh` fail `BLOCKED: no canvas core is built under target/; run cargo build --bin deep-show`.

## Not named by the issue, so assumed

- **"Its time"**: the median of consecutive calls, five such runs a side after a warm-up, judged by the design's
  five-run rule with the limit at 1.2 times the reference side's median run. The issue gives a ratio and no sample
  count; the design's timing rule gives five runs, and a single call of a few milliseconds is too noisy to be one.
- **Where a call's time is read**: on the client's side of the hub's socket for `cells`, and at the agent's pipe to
  `deep mcp` for deep_status, so `deep mcp`'s relay is in both sides' times alike.
- **"An empty record"**: no ask and no reading. A hub's own start and the one live session the call names write a few
  events; a `cells` call for no session would not be the app's call.
- **The `cells` call** is the one `crates/deep-app/src/views.rs` sends for an open Terminal tab, for a live session
  with no terminal open in the hub. What it answers is not this issue's; both records must answer alike.
- **The readings' names**: every writer at the base names each reading `reading:<ULID>` of its own (only
  `numbers.ts` reuses names), so 200,000 `reading.recorded` events are 200,000 names in the world. A record whose
  readings shared a few names would be an easier one than the base's writers make.
- **The asks' states**: 4,750 answered and 250 open. The issue says 5,000 asks and not their states; a month's asks
  are mostly settled, and both states have to be in the world.
- **"200,000 run events"**: `run.started` and `run.finished` events, 100,000 runs, as "1,000 run events" are 500. The
  session's own 200 are among them in both records.
- **"A session with 10 claims"**: 10 claims, each with 10 finished runs, so the reply holds 100 runs. The issue gives
  no runs per claim.
- **"The world was built"**: by the first deep_show at the latest. The fixture's ask and first reading are in the
  record before the hub starts, so a world built at the hub's start and one built at the first canvas call both hold
  them, and step 1 holds on every program.
- **"Shows in the next deep_show's world"** is read on deep_show's own outcome: a value bound to a handle the world
  lacks is refused `ref_unresolved` naming the handle (#393), and one the world holds is presented. The reading's
  number isn't checked: at the base, deep_query's rows of a revision give no value at a bound value's target (it read
  `""` for the seeded reading of 3), so the test has no surface that reads it back.
- **"A reading recorded"** has to be the hub's own append, and under a name a document can bind. Only the core writes
  `reading.recorded`; a second process writing the record's file is no surface, and a world kept up from the hub's
  event stream needn't see such a write. A document's handle must be a ULID or a content hash, which rules out the
  readings `numbers.baseline` records (`reading:baseline…`, refused `bad_handle`). Of the base's writers that name a
  reading `reading:<ULID>` while the hub runs, the gate's sharing readings are the ones a test can cause with no
  extension and no network, so the test makes one check carry across two sessions.
- **"Shows as done"**: the ask's state in the world reads `done`, the word the base's world gives every ask that is
  neither open nor put off, where an open one reads `needs_you`. The state is read where a status mark bound to the
  ask reads it: deep_query's `status` of the mark in the presented revision, or the state named in the deep_show's
  issue at the binding's source (`status_bindings/gate-state/source: done`). The base takes the second road: its
  status map has no `done`, so it refuses that document `out_of_range`, naming `done` (Open points). Either reads as
  done; `needs_you`, or no state at all, fails.
- **"The old values"**: the planted world keeps the asks and readings of its first build, so the reading recorded
  since is not in it at all and the answered ask still reads `needs_you`. The test checks the reading first, so the
  planted program's failure names the reading, as the criterion says.
- **Three sessions**: the reading comes from two sessions' claims and is read by a third, the one that owns the ask.
  The gate's sharing readings belong to no session, and a document of any session may bind one (the seeded reading is
  such a one too, and step 1 binds it).

## Outside this folder, for the implementer

- `packages/hub/src/plant.ts`: the name `world-built-once` in `Plant` and in `PLANTS`, and its behaviour where the
  change builds the world (Planted programs). No other change to that file.
- `scripts/lanes.mjs` (a guarded file: a signed approval tag): `alone` lists `tests/acceptance/1868/` (its tests start
  real hubs, seed 200,000 events, run Vitest checks in worktrees and time calls); `timed` lists `tests/acceptance/1868/canvas-cells.test.mjs` and
  `tests/acceptance/1868/status-runs.test.mjs`, which judge a time on a reference Mac and need a timed grant; `slow`
  lists both too if their fastest run takes over two minutes (here they took 2.5 and 1.7 minutes under load).
  `world-fresh.test.ts` is a Vitest file the unit lane finds by its name.
- `benchmarks/budgets.json`: criteria 1 and 3 are reference-Mac times. The budget window closes a criterion only when
  a task names it in `criteria` (`#1868.f34f3f9c`, `#1868.bf84aa8b`); no task at the base times a `cells` call on a
  long record or deep_status on 200,000 run events (`deep-status-30` seeds no runs). Until one does, the pull request
  says `Part of #1868` for those two (Open points).
- No environment variable is needed: the tests read no merge-base checkout. The before lane runs them on the merge
  base itself.
- deep-show and deep-hook have to be built wherever the lanes run these files, the merge base's copy included, and
  the twin's copy for `world-fresh.test.ts`.

## Open points

- **Criterion 2 can't fail on the merge base.** The base rebuilds the world at every call, so `world-fresh` passes
  there. It is proven only by its twin, which exists once the implementer adds `world-built-once`; until then the
  before lane has no wrong program for it.
- **Criteria 1 and 3 fail on the merge base as a counted FAIL only on a quiet reference Mac.** Anywhere else the
  design makes a time a reading, so the test fails INCONCLUSIVE, with both times in its message. The before lane reads
  either as a failure at the test's assertion; whether an INCONCLUSIVE on the merge base is the failure the criterion
  names is the owner's call.
- **"Done" has no status in the base's status map.** A status mark bound to an answered ask is refused
  `out_of_range` at `status_bindings/<id>/source: done` on the base (`text.status can't evaluate this`): the world
  says `done` and the status map (`pass` … `needs_you`, `stale`, `idle`) has no such state. That is outside this issue
  and noted here as a finding; the test reads the state from either road so that a later fix of it doesn't break it.
- **The reading's value isn't read back** (Not named by the issue): criterion 2 is proven on the reading being in the
  world and the ask's state, not on the number.
- **Criterion 2's ask half is not shown failing.** The stale stand-in fails at the reading, as the criterion says the
  planted program must, so the run never reaches the ask's assertion there.
- **Types.** This folder has no `tsconfig.json`; `world-fresh.test.ts` imports `lib.mjs` under a
  `@ts-expect-error`. If the folder is added to a type-check, that line is the one to look at.
- **A budget task for criteria 1 and 3** is not this job's to write: a task's command, limits and first measurement
  are the implementer's and the owner's.
