# Acceptance tests for #823: deep_wait and deep_run wake on the event that settles them

Written first, blind, by a job that never saw an implementation of #823 (none existed). It read:

- issue #823 (its title, "What happens on main", three checkbox criteria and Proof line, as handed to this job);
- `docs/technical-design.md`: Extension API (TypeScript, in-process), with the MCP tools row (`deep_ask` waits and
  says "still waiting", `deep_wait`, `deep_run`); the hook protocol and the delivery rows of What each agent gives us
  (the Stop hold); the `deep_ask` row of the timing relations; Dogfooding (who drafts checks);
- AGENTS.md;
- base commit `ff81b0d2` (origin/main): `packages/hub/src/{core,server,mcp,plant,tools,claude-settings}.ts`
  (`waitFor`, `runCheck`, `answerOrTimeout`, `stopHold` and its `stop-hold-polls` twin, the hub's and `deep mcp`'s
  stop paths), `packages/record/src/index.ts` (`RecordStore`), `scripts/proof-change.mjs` (criterion IDs) and
  `scripts/proof-runs.mjs` (twins, "at its assertion");
- the suites whose patterns it follows: `tests/acceptance/25/live/` (its budgets file and the `stop-hold-polls` plant,
  the load rule), `26/` (the agent stand-in, the hub, the socket, the outage test), `27/` (twins), and
  `packages/hub/test/{hub.ts,waits-hub.test.ts}`.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` (`fnm exec --using=24 …`):

```sh
npm ci && npm run build --workspaces          # the tests run the built CLI: deep hub run, deep mcp
npx vitest run --root tests/acceptance/823 --no-file-parallelism --silent=false
node node_modules/typescript/bin/tsc -p tests/acceptance/823/tsconfig.json
```

- The six tests take about 3 minutes: `wait.test.ts` about 2 (100 answers at 150 to 300 ms each, and two 40 s
  waits), `run.test.ts` about 20 s, `stop.test.ts` about 10 s. Each starts its own hub. The timing tests must run
  with nothing beside them (`--no-file-parallelism`), so the implementer adds `tests/acceptance/823/` to `alone` in
  `scripts/lanes.mjs` (this job edits nothing outside this folder).
- Every test makes its folders under `/tmp/dh823-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`. It stops only processes it started, by PID
  (`helpers.ts`, `cleanup`). No child inherits a `DEEP_*`, `CLAUDE*`, `CODEX*`, `GIT_*` or `XDG_*` variable of the
  runner's.
- With `--root` here, Vitest writes its cache to `tests/acceptance/823/node_modules/.vite/`; delete it before committing.
- **Machine load.** A timing over its limit while the 1-minute load average is above the core count, at the start of
  the measurement or at its end, is skipped as INCONCLUSIVE with the readings and the load, never passed (#25's rule).
  On a machine that isn't loaded past its cores it fails. The read counts (AC2) and the stop (AC3) don't depend on load.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temporary home, its ready line, the socket's line protocol on a
  `cli` connection with the control token: `events.read` (the record's `ask.answered`, `run.started`, `run.finished`,
  each with its `ts`, the hub's clock in epoch ms, and its `subject`), and `ask.answer` (`{ask, option}`, what
  `deep inbox answer` sends, #24). `DEEP_HUB_TEST_CONFIRM` names a file holding `confirmed` (#24's OS confirmation
  stub). `DEEP_HUB_PLANT=<name>` selects a planted program; a name the hub doesn't know makes it exit at start.
  SIGTERM to its PID stops it cleanly (what `deep hub stop` does).
- **`deep mcp`** started by the agent's own process (#26), and its tools: `deep_status`, `deep_wait` (`{ask}`; returns
  `{ask, status: "answered", answer}` once answered, `status: "waiting"` once its 40 s wait runs out), `deep_claim`,
  `deep_run` (`{check, claim}`; waits for the run and returns `{run, claim, outcome, evidence}`). An error is a tool
  result with `isError` holding error@2; with the hub unreachable its `code` is `unavailable`.
- **The repo's spec** `.deepbuild/done.yaml`: two command checks, `pause` (`sleep $(cat pause)`, the seconds in the
  worktree's `pause` file, which the test sets before each run) and `long` (`sleep 60`).
- **The record seeded before the hub starts** through `@deepbuild/record` and `@deepbuild/asks` by their
  `src/index.ts` (as #26's suite does): the session's `session.start` and its open taste asks, each with a question
  and key of its own, so no saved answer decides another.

### The agent stand-in

`fixtures/agent.mjs` is #26's stand-in, copied, with one change: each MCP reply it hands back also carries `arrived`,
`Date.now()` in the stand-in when the reply's line reached it, and `sent`, when the request's line was written. Its
hooks are its children (deep-hook's wire), its `deep mcp` is its child, so the hub binds the calls to its session as it
binds a real agent's. **"Reaches the agent"** is that arrival.

### Defined here, where the issue names no surface

1. **The read log, `DEEP_HUB_TEST_READS=<absolute file path>`**, read from `deep hub run`'s environment; only tests
   set it, and unset, nothing is logged and nothing changes. Before its ready line, the hub creates the file (empty,
   replacing any file there). From then on, every read the hub makes of its record appends one JSON line, whole, in the
   order the reads begin:

   ```
   {"at": 1761800000123, "via": "raw", "query": "SELECT session_id, status, answer, … FROM asks WHERE id = '01K8…'"}
   ```

   - `at`: when the read began, the hub's clock (`Date.now()` with no test clock), epoch ms, an integer.
   - `via`: the `RecordStore` method: `raw`, `read`, `table`, `session`, `resolve`, `startSlice` or `loadLearned`.
   - `query`: for `raw` the SQL text as passed; for any other method `JSON.stringify` of its arguments.
   - **Every read counts, whoever makes it**: the core, the asks core and every module the hub hands its record or its
     `raw` to (wrapping the `RecordStore` the hub opens, as `crashing()` and `streamed()` wrap it, covers them all). A
     read of `ledger.db` through any other connection must be logged the same way.
   - **A read of an ask** (or a run) is a line whose `query` contains the ask's ID, the ULID after `ask:` (or `run:`).
     Reads that name no ask, such as the asks core's deadline tick, are not reads of it.
2. **The planted waiter `deep-wait-polls`** (`DEEP_HUB_PLANT=deep-wait-polls`): `deep_wait`, and `deep_ask` while it
   waits, read the ask from the record every 100 ms until it is answered or the wait runs out, as the merge base's
   `waitFor` does (the `stop-hold-polls` of this issue). Everything else is the implementation's.
3. **The planted stop `stop-answers-waiting`** (`DEEP_HUB_PLANT=stop-answers-waiting`): a hub that stops answers each
   `deep_wait` and `deep_run` still waiting as if its wait had run out, as a success (`deep_wait` with `status:
   "waiting"`, `deep_run` with `outcome: "running"`), before it closes their connections.

Both plant names go in `packages/hub/src/plant.ts`'s lists. `twins/<name>/packages/hub/src/plant.ts` force each one for
the proof lane, and `twins.json` maps the criteria to them.

## Readings where the issue leaves a choice

1. **AC1, deep_wait's half.** 102 asks are seeded open; the first two are a warm-up and not timed. For each, the agent
   calls `deep_wait`; 150 to 300 ms later (random, so no answer lands at a fixed phase of anything the hub does) you
   answer it `green` on the socket. The call must not have come back before the answer, and must come back
   `{ask, status: "answered", answer: "green"}`. A delay is the reply's arrival at the agent less the `ts` of the ask's
   `ask.answered` event. The `ts` is stamped when the hub makes the event, at or before its append, so a delay is never
   shorter than the true one. p95 is the nearest rank of the 100.
2. **AC1, deep_run's half.** The issue gives no count and says "within 20 ms"; this job reads it with the first
   half's statistic: one `deep_claim`, then 22 `deep_run`s of `pause` for that claim, each run sleeping 200 to 300 ms
   (random), the first two a warm-up; each must come back with `outcome: "passed"`. A delay is the reply's arrival less
   the `ts` of the run's `run.finished`; p95, nearest rank of 20.
3. **AC2.** One open ask nobody answers, the session established, nothing else called. The agent calls `deep_wait`
   on it; it must come back `status: "waiting"` no sooner than 30 s after it was sent (at the base it waits 40 s).
   Counted: the read log's reads of the ask with `at` from when the call was sent to 30 s later; at most 2 pass. The
   failure names the count. The planted waiter's test runs the same measurement with `deep-wait-polls`: it must read at
   least 150 times in the 30 s (about every 100 ms), and the count's verdict must fail it, naming the count.
4. **AC3, "as today".** At the base, a hub that gets SIGTERM destroys every connection before its core stops
   (`server.ts`, `stop`), so `deep mcp` answers each waiting call `unavailable` ("it closed the connection"), within
   tens of ms of the hub's exit, for `deep_wait` and `deep_run` alike (`BASE-FAILURE.txt`). The tests leave each call
   waiting 1.5 s (`deep_run` on a run of `long` that has started), stop the hub, and require a tool error with `code:
   "unavailable"`, arriving within 1 s of the hub's exit (#26's outage bound). Any non-error reply, such as `status:
   "waiting"`, an answer, or a run's outcome, is a success and fails.

## Disputes

1. **deep_run's "within 20 ms" as a p95 over 20 runs.** Read literally, every run must be within 20 ms; one late run
   in twenty on a busy machine would then fail a correct program. If the owner reads it as every run, a redraft
   replaces the p95 with the maximum.
2. **No reference-Mac rule.** The issue's numbers are a hub test's, not a budget in the design's timing table, so the
   timings are judged on any machine not loaded past its cores; #25's and #26's budget files skip off a reference Mac.
3. **Counting by ID.** A read log can only attribute reads to a call by what they read; a waiter that polled the
   record without naming the ask (a cursor over every new event) would not be counted. Such a waiter still fails AC1
   when its period is longer than about 20 ms; one polling faster is a gap this job leaves to review of the diff.

## Criteria to tests

IDs are `#823.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed>`, as
`scripts/proof-change.mjs` computes them. Each test's name starts with its criterion's ID.

| Criterion | Test | Wrong program it fails on | On the base (`ff81b0d2`) |
|---|---|---|---|
| AC1 `#823.da880762`: answer within 20 ms of `ask.answered` at p95 over 100; a run's result within 20 ms of `run.finished` | `wait.test.ts`: an answer to an ask deep_wait waits on reaches the agent within 20 ms … ; `run.test.ts`: a run's result reaches a waiting deep_run within 20 ms … | `deep-wait-polls` (twin); the base's own `runCheck` | FAIL at the p95 (≈95 ms for deep_wait: delays spread 10 to 100 ms by the 100 ms poll), or INCONCLUSIVE when loaded past the cores |
| AC2 `#823.f1b9ae1e`: at most two reads in 30 s idle; the 100 ms planted waiter fails naming the count | `wait.test.ts`: a deep_wait that waits 30 s with nothing happening reads … no more than 2 times; (wrong program) the planted waiter deep-wait-polls … fails the 30 s count, naming it | `deep-wait-polls` (twin and plant) | FAIL: no read log (`DEEP_HUB_TEST_READS`); the hub refuses `DEEP_HUB_PLANT=deep-wait-polls` |
| AC3 `#823.d60a913c`: a hub stopping while a call waits answers unavailable, never a success | `stop.test.ts`: a deep_wait waiting when the hub stops …; a deep_run waiting on its run when the hub stops … | `stop-answers-waiting` (twin) | PASS: regression protection, "as today" |

No implementation was run: the passing side of each failing test, and each plant's failure, are unverified until it
exists. What the base shows about the instrument: the delays at the base spread evenly from about 10 to 100 ms, the
poll's period, for deep_wait and deep_run alike, at load 7 and at load 75 on 12 cores. The low end, 9 to 11 ms, is the
best case of a poll: the event's commit, one read, the reply through the socket, `deep mcp` and the agent. A woken
call pays about that, so the 20 ms leaves roughly 10 ms of margin; this job measured no woken call.

## Files

- `helpers.ts`: temp homes, the worktree and its spec, the seeded record, the hub and its socket, the agent stand-in's
  client, the read log, p95 and the load rule. Adapted from `tests/acceptance/26/helpers.ts`.
- `fixtures/agent.mjs`: #26's agent stand-in, copied, with each MCP reply's arrival time.
- `wait.test.ts` (AC1's deep_wait half, AC2), `run.test.ts` (AC1's deep_run half), `stop.test.ts` (AC3).
- `twins.json` and `twins/{deep-wait-polls,stop-answers-waiting}/packages/hub/src/plant.ts`: the proof lane's twins.
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
