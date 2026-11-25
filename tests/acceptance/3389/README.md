# #3389 acceptance: a state pass reads the sessions its appends name

Written blind from the issue (#3389: its report, Scope, its five checkbox criteria, Proof), the design (One event log,
with tables built from it; Numbers version 0 has to hold; Criteria to tests, Criteria in a checked shape, Wrong programs,
The edit guard, Dogfooding), `AGENTS.md` and base `1f6fd2dcd`. No implementation was seen. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base I read, for their surfaces: `packages/hub/src` (`session-state.ts`, `status.ts`, `rows.ts`, `watch.ts`,
`core.ts`, `server.ts`, `plant.ts`, `hub-shared.ts`, `hub-control.ts`, `trusted-actions.ts`, `answer-delivery.ts`,
`answers.ts`, `mcp-operations.ts`, `human-answers.ts`, `open-items.ts`, `stop-judging.ts`, `hub-canvas.ts`,
`session-flags.ts`, `agents.ts`), `packages/asks/src`, `packages/record/src` (`index.ts`, `projections.ts`),
`packages/contracts/schemas`, `benchmarks/hub-churn.mjs`, `packages/hub/test/{hub,forgotten-sessions.test}.ts`,
`scripts/proof-change.mjs`, `scripts/proof-runs.mjs`, `scripts/twins-lint.mjs`, and the suites `2646` (whose `lib.mjs`
these files import), `1866`, `1832` and `25` for their conventions.

## Run

The checkout built: `npm ci && npm run build --workspaces` and
`cargo build --locked -q --bin deep-hook --bin deep-show` (a hub refuses to start without the first; `states.test.mjs`
shows a document through the second). One file at a time; each starts real hubs.

```
node --test tests/acceptance/3389/passes.test.mjs       # AC1, AC2: about 90 s
node --test tests/acceptance/3389/states.test.mjs       # AC3: one hub, and 17 fresh ones after it: about 3 minutes
node --test tests/acceptance/3389/quiet.test.mjs        # AC4: up to a minute past its sessions; 4 minutes when it fails
node --test tests/acceptance/3389/deliveries.test.mjs   # AC5: about 30 s
```

Every hub gets a home of its own under `/tmp/dh2646-*` (#2646's), removed afterwards, and is stopped by its PID. Nothing
is killed by name or port. No verdict rests on a time: each is read from the record's events and rows, the read log
(`DEEP_HUB_TEST_READS`) and query plans. A poll ends as soon as what it waits for is there; where a test shows that
nothing happened it waits until two seconds pass with none, ten times a pass's 200 ms. A missing build, a hub that doesn't
start, a fixture a hub doesn't read as seeded or an event that never comes is BLOCKED, and passes the read log doesn't
show are INCONCLUSIVE, in the failure's message; neither passes.

## Requirement, check, proof

| Criterion | Check | Passes when |
|---|---|---|
| AC1 `#3389.d8c0dd63` 20 appends of no session that name nothing start no pass | `passes.test.mjs` (first) | On a record of 60 ended sessions, each reading `finished`, a hub's start is let finish. Then 20 times `setup.report` records one `setup.step` of no session, and the read log is followed until two seconds pass with no read of those sessions. No read in the 20 windows gives the state of any of the 60; and once one of them is named by `session.rename`, an append of its own, a read gives its state. |
| AC2 `#3389.c0c50375` one session's life reads that session alone, and ends as on the merge base | `passes.test.mjs` (second) | Beside the same 60, one more Claude Code session starts, prompts (its definition handed by `DEEP_HUB_TEST_DRAFTS`), edits a file, stops, its claim is judged to PASS by the repo's drafted check, it asks through `deep_ask`, the CLI answers in words, and it ends. No read from its first hook until the hub is quiet after its end gives another session's state, and one gives its own. It ends `PASS/pass`, its row is the one the merge base gives it, whole, and its ask has left the list. |
| AC3 `#3389.63db82fc` every state and row is the one a whole pass gives | `states.test.mjs`; twin `state-pass-own-session-only` | One hub runs on one seeded record. After each of the 15 appends below, once the hub is quiet, the record is copied as it stands (SQLite's backup) and a hub starts on the copy, at this hub's time and under its settings. The newest `session.state` of each session and every row of `rows` (its order and its whole content) are equal in the two; and in the fresh hub's list the append changed each row it is about. |
| AC4 `#3389.145cd5e7` the minute pass records as quiet the sessions the hub let go of | `quiet.test.mjs`; twin `let-go-forgets-time` | 80 sessions start, prompt, stop and end through their hooks, the state of each recorded well before 64 more have ended. The hub's clock steps to a day and a minute past the last end (`test.clock`), and nothing else is sent. Within the hub's next minutes every one of the 80 has `quiet/quiet` as its newest `session.state`. |
| AC5 `#3389.c1bfb4a2` the reads of `delivery.outcome` | `deliveries.test.mjs` | On a seeded record of 20 sessions that each hold an answered choice whose delivery stalled and then timed out, and on one of 80, a hub's start is read. Each session's row says `needs you`, `your words didn't reach it: their delivery timed out`, since the second outcome's time. The reads that name `delivery.outcome` before the first row or state is set are one on each. The plan of each (`EXPLAIN QUERY PLAN` on the record's file) uses a new index on `events` by the delivery, and no other index of `events`, and no scan of it. The record of 20 has that index as it was made; that of 80 has every index the merge base doesn't make dropped before its hub opens it, and has it after. |

### How a state pass's read is told from another

The pass is recognized by what it must read. Each of the 60 sessions has the status `finished`, the recorded state
`finished/finished` and the row word `finished`, and never changes. A read gives a session's state when, run again on the
record's file, it returns a row that says `finished` and that row, the read's SQL or a value bound to it names the
session (`given` in `lib.mjs`). Nothing is matched by its SQL's wording, so a pass that makes fewer reads, or words them
otherwise, is read the same; the other readers that name sessions (who else is in the repo, each agent's newest session)
return no state. Reads whose `via` is `raw` or `table` are judged; the asks core's cursor reads, which return events to
fold, aren't passes. The test makes none of the hub's reads of the list itself while it judges the log (`inbox.read` reads
every row). Each test also finds a read that gives the state of a session its own append touched (AC1's named session,
AC2's one more); with none it is INCONCLUSIVE, since this hub's passes don't show in its log.

### AC3's appends

| Append | Reached by | Recorded as, at the base | The row it is about |
|---|---|---|---|
| `deep off`, `deep on` (`holds.watch`) | `gates.off`, `gates.on` from the CLI, before any hook (each names the calling process, which no agent session may be above) | of no session | every session's that isn't quiet; two are named |
| an ask put off with Later (`ask.later`) | `ask.later` from the app, of an ask still waiting for its batch, which Later puts in the list | of no session | the ask's |
| batched (`ask.batched`) | the clock stepped to the next batch | of no session | the ask's |
| its answer undone (`default.undone`) | `ask.undo` from the CLI, of an ask that took its default once the clock stepped past its deadline | of no session | the ask's and its session's |
| answered (`ask.answered`) | `ask.answer` from the CLI, in words | of no session | the ask's and its session's |
| an answer's delivery timed out (`delivery.outcome`) | that answer handed to its session's resumed start, whose transcript can't be read, 10 s on | of no session | its session's |
| superseded (`ask.superseded`) | `deep_ask` on one subject in a session (a step of its own, before) and, after `/clear`, in the next of its thread | under the older ask's own session, right after the newer ask's, under the newer's | the older ask's |
| a verdict made (`verdict.made`) | `test.verdict` (`DEEP_HUB_TEST_VERDICT=1`) from the CLI, under one session, on another's claim | under another session | the claim's session's |
| a claim sent back (`claim.sent_back`) | `test.verdict`, a FAIL at round 2 | under another session | the claim's session's, which says round 2 |
| a verdict gone stale (`verdict.stale`) | `canvas.show` of a document whose earlier revision a seeded verdict is keyed by | of no session | the claim's session's |
| an open item opened (`open_item.opened`) | `deep_open_item` in a session whose newest claim is on the same task as another's | under another session | the other's, BLOCKED, whose evidence it becomes |
| an open item closed (`open_item.closed`) | `ask.answer` `waive`, of the item's seeded ask, which has no session | of no session | the claim's session's, and that ask's |
| an ask of no session raised (`ask.created`) | `agents.propose` from the CLI | of no session | the ask's |
| and closed (`ask.answered`) | `ask.answer` from the CLI | of no session | the ask's |

Each is a real append of the running hub; none is seeded before a start. What is seeded is only what they act on: the
sessions, their asks, claims and verdicts, the item opened before, and its waiver's ask. A claim is sent back only with the
verdict it is sent back on, so that step's record holds both.

## Planted programs

Two, for the implementer to add as names `DEEP_HUB_PLANT` selects, in `Plant` and `PLANTS` of `packages/hub/src/plant.ts`,
and to act on where the hub does what they leave out. Each twin is `plantOf` giving that name when the variable is unset
(`twins/*/lines.json`, #1832's form), so `plantOf` must keep its first two lines. Neither name exists at the base, so there
a hub given one stops at its start.

- **`state-pass-own-session-only`** (`#3389.63db82fc`). An append touches the session it was made in, and nothing else:
  one of a session starts a pass that reads that session alone, whatever its subject and data name; one of no session
  touches none and starts no pass, an ask of no session's and `deep off`'s and `deep on`'s included. Everything else is as
  shipped: a start, and a pass after one that failed, still read every session, and the clock still ends states.
  `states.test.mjs` then fails at its last assertion: `<n> states and rows aren't those a whole pass gives. The first:
  session:33890001-…'s row after deep off (holds.watch, of no session) is {…}, and {…} from a hub started afresh on a copy
  of the record`.
- **`let-go-forgets-time`** (`#3389.145cd5e7`). When the hub lets go of an ended session (past the newest 64), it also
  lets go of when the clock ends that session's state, as the merge base does, and only a pass over every session finds it
  again. Everything else is as shipped. `quiet.test.mjs` then fails at its last assertion: `with the clock a day past
  their last event, the minute pass left 16 of 80 sessions unrecorded as quiet: session 33890000-…, number 1 of 80 to end,
  which the hub let go of, was left finished/finished; …`.

A planted program that can only exist on the change (both do: the merge base reads every session after any append of no
session) was run here as scratch changes of the base's built hub, never committed (BASE-FAILURE.txt). The first plant's
behavior fails 12 of the 15 steps; it is right at `deep on` and at the close of the ask of no session, whose opposites it
never showed, and at `ask.superseded`, which is recorded under the ask's own session.

AC1, AC2 and AC5 name the merge base as their wrong program. The merge base also fails AC3 and AC4: it leaves the states
and rows of three appends made under another session (a verdict made, a claim sent back, an open item opened) until its
next whole pass, and loses the times of the 16 sessions it let go of when nothing of no session is appended.

## Not named by the issue, so assumed

- **"After the first append the read log holds no read by a state pass"** (AC1): from the first append on, its own pass
  included, since the merge base "holds at least 20 passes" for the 20 appends.
- **"None at work"**: the 60 sessions have stopped and ended within the day, so each reads `finished`.
- **"Naming the append before it"** (AC2): the newest append of no session before the read's time, states and rows aside,
  or the newest append of all where there is none. A pass is put off 200 ms, so the one that widened it can be a few
  appends back, and the read log and the events carry times, not each other's positions.
- **"The state and row the merge base gives it"** (AC2): `PASS/pass`, and the row written out in the test, as the base
  gave it here (BASE-FAILURE.txt).
- **"A claim judged to a verdict"** (AC2): PASS, by the gate, through a check the hub really runs.
- **"The rows table"** (AC3): each row's `ord` and `row`. Its `log_pos` says when it was last set, not what it says.
- **"A hub started afresh on a copy of that record"** (AC3): with this hub's `config.json` (your ask settings) and
  `gates.json` (`deep off`), which are the hub's own files beside the record, at the first hub's time
  (`DEEP_HUB_TEST_CLOCK`). The copy is of a running hub's record, so its start finds no clean stop; no claim is open in it,
  so nothing is judged for that.
- **"Its answer undone"** (AC3): `ask.undo` of a default. A yes undone inside the hub's hold (#1101) goes through the same
  method and needs a plan that can't be undone; it isn't exercised.
- **"Recorded … under another session"** (AC3): for a verdict and a send-back, by `test.verdict`, whose `session` and
  `claim` may differ; the hub's gate records a verdict of no session and a send-back under the claim's own.
- **"Naming the first session and the append"** (AC3): the first state or row, in the order of the steps and then by name,
  so an ask's row is named by its ask.
- **"As on the merge base after a whole pass"** (AC4): `quiet/quiet`.
- **"A record made by the merge base"** (AC5): the record as this checkout's `@deepbuild/record` makes it, with every index
  on `events` but the merge base's seven dropped. The new index is told by being on `events`, not among those seven, and
  holding `$.delivery` or the subject, which names the delivery too.
- **"The first pass of a start"** (AC5): the reads logged up to the time of the first `row.set` or `session.state` of the
  start. A pass reads before it appends, and the next can't start within 200 ms.
- **"The same number of times"** (AC5): one, as the Scope says.

## Lanes

`lane.json` runs the folder alone: it starts real hubs. Nothing else lists it.
