# #2646 acceptance: four reads that grow with history

Written blind from the issue (#2646: Scope, its five checkbox criteria, Proof), the four audit findings it links
(`reports/hillclimb-audit-2026-11-09/`: 01 F2, F5, F7 and 02 F4), the design (Every task carries its own budgets;
Criteria to tests, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding) and base `9ae04c6cd`. No
implementation was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

## Run

Both checkouts built: `npm ci && npm run build --workspaces` and `cargo build -p deep-hook` (a hub refuses to start
without deep-hook). The change is the checkout the tests run from. The merge base is a second built checkout, named by
`DEEP_2646_BASE`, as #2332's suite takes main (`DEEP_2332_MAIN`); the proof lanes hand their environment to the tests.

```
DEEP_2646_BASE=/path/to/merge-base node --test tests/acceptance/2646/ask-check.test.mjs     # about 2 minutes, macOS
node --test tests/acceptance/2646/statements.test.mjs                                       # about 3 minutes, no merge base needed
DEEP_2646_BASE=/path/to/merge-base node --test tests/acceptance/2646/minute.test.mjs        # about 6 minutes
DEEP_2646_BASE=/path/to/merge-base node --test tests/acceptance/2646/asks-kinds.test.mjs    # about 3 minutes
DEEP_2646_BASE=/path/to/merge-base node --test tests/acceptance/2646/budgets.long.test.mjs  # by hand: about half an hour, macOS
```

Every hub gets a home of its own under `/tmp/dh2646-*`, removed afterwards, and is stopped by its PID. Nothing is
killed by name or port. No verdict rests on wall-clock time: results are a query plan, rows, statements compiled,
events decoded and instructions retired.

## Requirement, check, proof

| Criterion | Check | Passes when |
|---|---|---|
| `#2646.98036aec` ask check: plan names the partial index, at most a fifth of the merge base's instructions, the merge base's rows, on 200,000 events with one live session of 20,000 holding three undelivered asks | `ask-check.test.mjs` (one test, and one of the judgement on planted numbers) | Each side's hub starts on a fresh home; its ask check is the raw read of `asks` in its reads log that names `session.start` and `session.end`. Each side's `@deepbuild/record` seeds the record (the audit's shape: 300 sessions, 299 ended ones holding 180,000 events and 1,000 undelivered asks, one live session of 20,000 events with three). `EXPLAIN QUERY PLAN` of the change's check on its record's file names an index whose definition is `events (session_id, log_pos)` partial on exactly those two kinds, whatever its name. Both checks return the same rows, the live session's three asks. Over 20 alternated pairs after a warm-up, 20 runs of the check through the record's `raw()` retire at most 20% of the merge base's instructions: median pair at most 0.2, and a seeded one-sided sign-flip test rejects "above a fifth" at p under 0.01. |
| `#2646.44dd0631` 200 state passes with different touched sets over eight live sessions compile at most 16 statements; a statement compiled before them stays compiled | `statements.test.mjs` (one test) | One hub of this checkout. Eight sessions start by `SessionStart`; then for one set of two or more of them after another (247 exist, 200 are needed) each session of the set sends a `PreToolUse` at once. The reads log, replayed through the record's rule (the 256 most recently used raw statements stay compiled, by SQL text), shows at most 16 compiles of the statements whose reads name two or more of the eight sessions, over 200 passes with different sets. The newest statement another read compiled before the first pass, unused since, is still kept at the end. |
| `#2646.11122565` minute pass: under 1% of the merge base's rows, the merge base's states at each of 120 minutes; a pass that skips a session whose promise falls due fails, naming it | `minute.test.mjs` (one test); twin `pass-skips-due-promise` | Each side's hub starts on the seeded month (below) five minutes before minute 0 of a test clock. At each of 120 minutes the test steps the hub's clock to the minute (`test.clock`), fires the hub's one-minute interval (`minute-clock.mjs`), waits behind the state pass (`inbox.read`) and reads every session's newest `session.state` from the record's file. Every session reads the same state as on the merge base at every minute, and the rows the change's 120 passes read sum to under 1% of the merge base's. |
| `#2646.9ca53003` at a hub's start on #16's 30-day record the asks core decodes no event of a kind it doesn't apply; asks, tasks and stops as on the merge base; a core without `tool.before` fails, naming the ask it missed | `asks-kinds.test.mjs` (one test); twin `asks-without-tool-before` | Each side's hub starts on #16's 30-day record with one ask (below) and stops once its start has landed. The record's asks, tasks and continues read the same as the merge base's. Then the side's `@deepbuild/asks` is opened on a copy of that record through a record that counts each event `read` hands it: none is of a kind outside the 27 the core applies. |
| `#2646.0e7e5ac3` `hub-history`, `hub-idle`, `asks-inbox-10k`, `deep-status-30` retire no more instructions than on the merge base | `budgets.long.test.mjs` (four tests) | Each task's command, from each checkout's `benchmarks/budgets.json`, measured and judged as the perf lane does (`measure` and `judgeInstructions` of `scripts/benchmark.mjs`: a warm-up, 20 alternated rounds, children counted, two seeded sign-flip tests). PASS only: a rise above 2% at p under 0.01 FAILs, anything undecided is INCONCLUSIVE. |

A missing `DEEP_2646_BASE`, an unbuilt checkout, a hub that doesn't start, a fixture a side doesn't read as seeded, a
host with no instruction counter (not macOS, no `cc`), a missing count or too few pairs fails its test with BLOCKED or
INCONCLUSIVE at the head of its message. None passes.

## Fixtures

All are seeded through the side's own `@deepbuild/record`, with fixed times and counted IDs, so both sides hold the
same events (`probe.mjs`).

- **The month** (criterion 3): #16's history (20 sessions a day for 30 days, each ten turns of a prompt, 13 tool events
  and a stop) moved a day back, so each of its 600 sessions was last seen over a day before minute 0 and reads quiet
  throughout. Beside it: one session whose last stop is a day old at minute 30.5, so it reads `finished/finished`
  through minute 30 and `quiet/quiet` from minute 31 with no event of its own; and one session, two hours old, with a
  `promise.set` due a minute before the hub starts, which the hub finds due at its start (`promise.due`), so it reads
  `flagged/promised`. No session is live: no hook arrives.
- **#16's 30-day record** (criterion 4): `seedHistory(root, 30)` of `tests/acceptance/16/budgets.test.ts`, ending a
  minute before the hub's start, then one `ask.created` its newest session raised a second after its last event. #16's
  history holds no ask, and the criterion's wrong program has to miss one.

## Planted programs

Two, for the implementer to add as names `DEEP_HUB_PLANT` selects, in `Plant` and `PLANTS` of
`packages/hub/src/plant.ts` and nothing else in that file: each twin replaces it whole with the base's other exports,
so a new export there breaks the twins. `twins.json` maps each criterion to its twin; a twin is the base's `plant.ts`
with `Plant` widened to `string` and `plantOf` and `activePlant` giving that plant whatever the variable says.

- **`pass-skips-due-promise`** (`#2646.11122565`). The hub's state pass, each time it runs, at a minute and after
  appends alike, leaves out every session whose newest promise event in the record is a `promise.due`. Everything else
  is as shipped: the promise still falls due and is recorded. `minute.test.mjs` then fails at its states assertion:
  `the states the hub reports differ from the merge base's … at minute 1 session <id>, whose promise fell due, is
  reported finished/finished` (or `in no state`) `, and flagged/promised on the merge base`.
- **`asks-without-tool-before`** (`#2646.9ca53003`). The hub opens its asks core as a planted core (an `AsksPlant` of
  the same name, passed as `openAsks`'s `plant`) whose sync leaves `tool.before` out of the kinds it reads. Everything
  else is as shipped. `asks-kinds.test.mjs` then fails at its outcomes assertion: `ask:<id> reads open, unanswered, not
  shown, and open, unanswered, shown on the merge base` and `It missed ask:<id>, raised after its session's last tool
  call`. Checked here on the base's core with a record that drops `tool.before` events: the ask stays `held`, with no
  `ask.batched` and no `batch_id`.

Criteria 1 and 2 name the merge base as their wrong program. Criterion 5 names none (Open points).

## On the unchanged base

With `DEEP_2646_BASE` the base itself (or a second copy of it), both built:

- `ask-check`: FAIL at the plan. `the ask check's query plan names no partial index on events (session_id, log_pos) for
  the kinds session.start and session.end (the record has none). The plan:` then the plan's lines, the last
  `SEARCH events USING INDEX events_session (session_id=?)`, then the check's SQL. (Plan, rows and counts were run here
  on the base's record with the base's SQL: 20 runs retire about 3.5e9 instructions; with a partial index, about 1.3e8.)
- `statements`: FAIL at the count. `the core compiled <n> statements for 200 state passes whose touched sets all differ
  (<about 8 or more> a pass); at most 16 are allowed. One of them: SELECT …`.
- `minute`: FAIL at the rows. `the minute pass read <n> rows over 120 minutes and <about n> on the merge base: <about
  100>%, not under 1%`. The states agree, as they should between two copies of one program.
- `asks-kinds`: FAIL at the count. `at a hub's start the asks core decoded <n> events of kinds it does not apply, among
  <m>: session.state ×…, row.set ×…, …`. The outcomes agree.
- `budgets.long`: PASS against an identical program, or INCONCLUSIVE where 20 pairs can't tell (`hub-idle` waits, so its
  count moves with the schedule).

With no `DEEP_2646_BASE`, every test but `statements` fails `BLOCKED: set DEEP_2646_BASE to a built checkout of the
merge base …`. With no deep-hook built, every hub test fails `BLOCKED: the hub of <checkout> didn't start: … no
deep-hook is built under <checkout>/target; run cargo build -p deep-hook first`.

## Not named by the issue, so assumed

- **The merge base's checkout**: `DEEP_2646_BASE`, a per-suite variable as #2332, #1632 and #1551 use.
- **The ask check** is found by what it is, not by a name: the raw read of `asks` that names both kinds. A change that
  splits the check so that no single read does both reads BLOCKED, and needs a redraft.
- **"Retires at most a fifth"** is measured on the check's read alone, 20 runs a reading, in a process that loads only
  the side's record: the hub's other work would drown it. The step count the audit used (61,003 against 1,003) needs a
  counting SQL function written into the query, so it is not asserted; the plan and the instructions are.
- **"Compiles"**: a statement is compiled when a raw read's SQL text is not among the record's 256 kept, which the reads
  log decides. **"For the pass"**: the statements of raw reads that name two or more of the eight sessions, in their
  SQL or bound values; every set used has two or more sessions, since a hook's own reads name one. A pass whose reads
  name no session at all can't be seen this way and reads INCONCLUSIVE. **"A statement another read compiled before"**:
  the newest one no later read uses. If reads other than the passes' push it out, the test is INCONCLUSIVE, not FAIL.
- **The minute pass on a test clock.** The base's minute pass runs on a wall-clock `setInterval` of 60,000 ms that
  `test.clock` doesn't move, and no surface runs it on demand. `minute-clock.mjs`, loaded into the hub's process with
  `node --import`, keeps every 60,000 ms interval and runs it when the test says: Node's timers are a boundary this
  repo doesn't own. It depends on the minute pass staying a 60,000 ms `setInterval`. If the change moves it to another
  timer, the test reads BLOCKED (`no thread of the hub ran its one-minute interval`), and the seam it then needs is
  `test.clock` running the minute pass for each whole minute a step crosses.
- **"Rows it reads"**: the rows its raw reads return, less the next wait's. The asks core's cursor reads are left to
  criterion 4. Compared as sums over the 120 passes.
- **"30 days of history and no live session"**: the month above. With #16's history ending a minute before the hub's
  start, 20 of 600 sessions are within their first day, and a pass that reads each session still in a timed state
  reads over 3% of the merge base's rows, so under 1% could not hold; here two sessions of 602 are.
- **"Falls due"**: at the hub's start. A promise's timer runs on the wall clock, so one due inside the 120 test minutes
  would never fire.
- **"Its asks, tasks and stops"**: the record's `asks` rows (status, outcome, shown or not, answer), its `tasks` rows
  (state, owner) and each session's `session.continued` events, read from the file after the hub's start.
- **"The kinds it applies"**: the 27 cases of the asks core's `apply` at the base, listed in `asks-kinds.test.mjs`. The
  issue changes no ask outcome, so the set stands; a later issue that makes the core apply another kind adds it by an
  approved proposal.
- **"Counted by the test"**: on a hub's reads log, the asks core's reads can't be told from another reader's, so the
  count is taken from the asks core itself, opened as the hub's start opens it on the record that start left.

## Outside this folder, for the implementer

- `scripts/lanes.mjs`: `byHand` lists `tests/acceptance/2646/budgets.long.test.mjs` (20 rounds a side of four budget
  tasks can't sit in a lane that stops at 20 minutes). `alone` lists `ask-check.test.mjs`, `statements.test.mjs`,
  `minute.test.mjs` and `asks-kinds.test.mjs` by name: they start real hubs and count instructions.
- `benchmarks/budgets.json`: `"criteria": ["#2646.0e7e5ac3"]` on `hub-history`, `hub-idle`, `asks-inbox-10k` and
  `deep-status-30`, so the budget window measures the criterion and can close it.
- The two planted programs above, in `packages/hub/src/plant.ts` and `packages/asks/src/model.ts` (`AsksPlant`).
- The lanes need `DEEP_2646_BASE` in their environment. Without it four files read BLOCKED.

## Open points

- **Criterion 5 names no wrong program.** Its tests can't fail on the merge base. In the trace lane it is proven only
  by a mutant, or it stays open and the pull request says `Part of #2646`.
- **Nothing that starts a hub was run when this suite was written**: the drafting workspace had no deep-hook built.
  Run there: both seeds, the asks core's count and the planted behaviour on the base's packages, the plan, rows and
  instruction counts on the base's record, the judgement on planted numbers, and `minute-clock.mjs` on a worker thread.
