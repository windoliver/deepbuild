# Acceptance tests for #3539: what a session with a person at it waits behind other sessions' slow checks

Written first, blind, from issue #3539 (its title, labels and body; it has no comments), the design sections it links
and those they lean on, and base commit `c4b178596` (origin/main; its last merge is #3368), by a job that never saw the
work; none was in what it could read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The issue is a spike: it changes no code on main. Its work is kept in `docs/spikes/3539/`, as #3444's, #3222's and
#2649's are, and these tests check what is kept there: the record, the scripts and the run outputs it cites, the
report, and the harness. Nothing is taken on the spike's word (invariant 1). The scheduler runs on a virtual clock and
is a pure function of its script, so every row of a kept output under the package's order, today's or the changed one,
is worked out again here by the gate package's own `simulate`, as the record's `main` has it, on the kept script; every
median, 95th percentile, longest wait and "starts at a different time" is worked out from those rows. Two files run the
spike's harness: against a pool this suite holds full (criterion 3), and with its planted twin on the script in which
the person's session never stops (criterion 2). No test takes or judges a time on a real clock.

## What was read

- Issue #3539 as saved in the job's inputs. GitHub was not read: the issues it names (#3, #29, #907, #965, #1982,
  #1011, #43) were read only as the base holds them, in suites and code.
- `docs/technical-design.md`: An agent says it's done (Fast and slow lanes, Held time is counted, Slow runs start when
  the turn ends, A loop's turn end isn't a hand-back, Latest snapshot wins, Stale results stay stale); Plan usage, per
  account and per task; Numbers version 0 has to hold; How we know version 0 works (Criteria to tests, Closed issues
  stay proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding, Repo guards).
  `docs/parallel-proof.md`: sections 5 to 7. `AGENTS.md`.
- At the base, for names, shapes and conventions, never for an expected value:
  - the scheduler: `packages/gate/src/scheduler.ts` (`simulate`, `Scenario`, `SessionScript`, `CheckDef`,
    `ScriptEvent`, `Origin`, `AUTOMATIC`, `Trace`, `dispatch`, `atFastEnd`, `starterAt`, `loopFit`, `queueSlow`,
    `holdSlow`, `heldSplit`), `index.ts`, the packages' `package.json` (their `development` entry and build steps);
  - the hub's runner: `packages/hub/src/gate-runner.ts` (`GateOptions`, `queue`, `place`, `hold`, `release`, `pump`,
    `turnEnded`, `UNFORESEEN`), `packages/hub/test/gate-queue.test.ts`, the `slots` of `packages/hub/src/core.ts`;
  - spike suites and their spikes: `tests/acceptance/3222/` and `3444/` (README, `validate.mjs`, the tests,
    `BASE-FAILURE.txt`), `2649/` (README), with `docs/spikes/3222/`, `3444/`, `2649/` and `2175/` by their file lists;
  - `tests/acceptance/29/helpers.ts` (the scenario builders), `tests/acceptance/2365-redraft-ac5/` (`base.ts`,
    `base-copy.mjs`, `base-resolve.mjs`: a commit's sources exported and run), `scripts/lifecycle-sim.mjs` (package
    sources loaded in plain node);
  - the lanes that read a suite: `scripts/proof-change.mjs` (`TAG`, `tagsIn`, `isTestFile`, `criterionId`),
    `proof-runs.mjs` (`atAssertion`, `twinsOf`), `lanes.mjs` (`testPaths`, the unit lane's commands),
    `wait-ratchet.mjs`, `alone-lint.mjs`, `reach-preload.cjs`, `throttle.mjs`, `repo-rules.mjs`.
- Probes, run in a scratch folder and not kept; none is a reading of the spike:
  - plain node can't load the gate package's public entry from this checkout as it stands: its sources read build
    data (`packages/evidence/dist/patterns.json`, `packages/record/dist/versions.json`) that only a build writes, and
    Node's own type stripping refuses `packages/evidence/src/records.ts`. An export of `packages/` at a commit, with
    those two build steps run in it and the repo's TypeScript stripping the types, loads it (`base.mjs`);
  - the changed order as this suite runs it (Readings, "The changed order, to a test") against a scratch copy of the
    scheduler with one more sort key, the origin of the prompt that opened a place's turn: the whole `Trace` was the
    same on 600 seeded scripts (1, 3 and 6 others, pools of 1 to 9, up to five stops a session, every automatic
    origin), 347 of which the changed order moved; and 600 scripts in which the person's session never stops gave
    the same `Trace` under both orders;
  - the three harness-running tests' code against a stand-in harness in the scratch folder: without a harness
    (BLOCKED), with one that reads right (no problem), and with each twin (the problem that names the check, and the
    one that names the script).

## How to run

```sh
node --test tests/acceptance/3539/ac1-table.test.mjs
node --test tests/acceptance/3539/ac2-changed-order.test.mjs
node --test tests/acceptance/3539/ac3-held-full.test.mjs
node --test tests/acceptance/3539/ac4-orders.test.mjs
node --test tests/acceptance/3539/ac5-follow-up.test.mjs
node --test tests/acceptance/3539/validate.test.mjs
```

Each needs Node 24.22 first on `PATH`. Nothing of this suite needs a build, a Rust binary or the network.

- `ac1`, `ac2`'s first test, `ac4` and `validate.test.mjs` need `git`, `tar` and this checkout's `node_modules`
  (`npm ci`). Each exports `packages/` at one commit (the record's `main`; `validate.test.mjs` takes `HEAD`) into a
  temporary folder, about 70 MB, runs there the two `node` build steps the gate package's dependencies name before
  `tsc`, loads `simulate` from the export, and removes the folder when the process ends. Nothing is written in the
  checkout. On this Mac, at a 1-minute load near 90, the export took 3 to 4 s and `validate.test.mjs`, run as a plain
  node script, 3.3 s in all.
- `ac2`'s second test and `ac3` run `node docs/spikes/3539/harness.mjs` (two runs each), from the checkout's root, in
  a temporary home. They need what the harness needs, which the spike's report says; this suite adds nothing to it.
  A harness that loads the gate package from this checkout's sources needs their build data, as above.
- `ac5` needs nothing.

`validate.test.mjs` is this suite's own check that its validators pass a well-formed spike (`example.mjs`'s, which
doubles as the formats' worked example) and fail each planted wrong one. It carries no criterion and passes on the
base. The suite has no lane file: no file of it starts a binary of this repository, reads a clock or shares a
resource, so it runs in the parallel block.

## The surface under test

- The gate package's `simulate`, the export of its public entry the issue names (`packages/gate/src/index.ts`,
  `@deepbuild/gate`), with its `Scenario` and the `Trace` it returns. This suite runs it; the spike runs its scripts
  through it.
- The spike's folder, `docs/spikes/3539/`: `record.json`, the scripts and run outputs it cites, the report
  `README.md`, and the harness `harness.mjs`.
- This checkout's git history at the record's `main`.

Every name below that the issue or the design doesn't give is this suite's choice and a requirement on the
implementer. `example.mjs` builds one complete, well-formed spike in these formats (its scripts are made up), which
`validate.test.mjs` passes through every check; the snippets below are cut from it. Times are milliseconds on the
script's virtual clock, the clock its events' `at` are on, everywhere but in the report, which shows seconds.

### The spike's folder

`docs/spikes/3539/`: `record.json`, `README.md` (the report), `harness.mjs`, and every file the record cites, at a path
relative to the folder (no absolute path, no `..`), each pinned by the sha256 of its bytes. The tests read no other
file there: whatever else took the runs is the implementer's, kept beside the report as #2649's and #3222's are.

### A script

A script is the scheduler's `Scenario` as data: the same fields with the same names, except that a check's `run`
function is replaced by `took_ms`, the time one run of it takes. Every run passes.

```json
{ "config": { "slots": 2 },
  "sessions": [
    { "id": "person",
      "checks": [ { "id": "check-1m",  "on_base": "passes", "inputs": ["src/**"], "expected_ms": 60000,   "took_ms": 60000 },
                  { "id": "check-5m",  "on_base": "passes", "inputs": ["src/**"], "expected_ms": 300000,  "took_ms": 300000 },
                  { "id": "check-20m", "on_base": "passes", "inputs": ["src/**"], "expected_ms": 1200000, "took_ms": 1200000 } ],
      "events": [ { "at": 0,      "kind": "prompt", "origin": "human" },
                  { "at": 120000, "kind": "stop", "snapshot": "person-1", "changed": ["src/person.ts"] } ] },
    { "id": "other-1",
      "checks": [ { "id": "check-1m",  "on_base": "passes", "inputs": ["src/**"], "expected_ms": 60000,   "took_ms": 60000 },
                  { "id": "check-5m",  "on_base": "passes", "inputs": ["src/**"], "expected_ms": 300000,  "took_ms": 300000 },
                  { "id": "check-20m", "on_base": "passes", "inputs": ["src/**"], "expected_ms": 1200000, "took_ms": 1200000 } ],
      "events": [ { "at": 1000,  "kind": "prompt", "origin": "scheduled" },
                  { "at": 61000, "kind": "stop", "snapshot": "other-1-1", "changed": ["src/other-1.ts"] } ] } ] }
```

- `config`: any of the scheduler's settings (`budget_ms`, `hold_ms`, `slots`, `grace_ms`, `stop_timeout_ms`); the
  rest are its defaults. `foreign`: slots others hold, `[{ "at", "ms", "slots" }]`, as in a `Scenario`.
- A session: `id`, `checks`, `events`, and, passed through as they are, the `Scenario`'s `agent`, `ask` and `facts`.
- A check holds exactly `id`, `on_base` (`fails` or `passes`), `inputs` (globs), `expected_ms` (the time it took when
  drafted) and `took_ms`. No other field: a script has no `runs`, `needs`, `deadline_ms`, `stack` or `timing`.
- An event is a `ScriptEvent` as the scheduler has it: `at`, a `kind` among `prompt` (with `origin`), `words`, `edit`,
  `claim`, `facts`, `tool_call`, `retention` and `stop` (with `snapshot` and `changed`, and `checkout_ms`, `sorted` or
  `id` when wanted).
- The `Scenario` a script stands for is the script itself with each check given
  `run: () => ({ took_ms, outcome: 'passed' })` (`validate.mjs`, `scenarioOf`).
- **Who opened a session's turns** is read from its prompts (`whoOf`). The person's session: every prompt has origin
  `human`. A session whose turns nobody typed: every prompt has one of `continuation`, `scheduled`, `subagent`,
  `session`, `unknown`, and it holds no `words` event. Any other session (a prompt of the app's or an answer's, both
  kinds of prompt, no prompt) is neither.

A **script of the table** (the Scope's first bullet) is further held to this, for `others` of 0 (the person's session
alone), 1, 3 or 6 and a pool of 2, 4 or 9:

- exactly one person's session, exactly `others` sessions whose turns nobody typed, and no session that is neither;
- `config` is exactly `{ "slots": <pool> }`, and there is no `foreign`;
- every session has exactly three checks, with `expected_ms` of 60000, 300000 and 1200000, each with `took_ms` equal
  to its `expected_ms`, and at least one `stop`; under the package's `simulate` each session has at least one green
  stop;
- every check of the script has the same `on_base` (Readings, "The changed order, to a test");
- the person's session, and the `config`, of the script with `others` sessions on a pool are those of the alone
  script on that pool, field for field.

### A run's output

One JSON object for one script under one order:

```json
{ "script_sha256": "237d36403e6011da81eb59fcc3fdd957243865536494a7a80a392bbdbb6f9582",
  "order": "today",
  "places": [ { "session": "other-1", "check": "check-20m", "snapshot": "other-1-1", "queued_at": 61000,  "started_at": 121000, "ended_at": 1321000 },
              { "session": "person",  "check": "check-1m",  "snapshot": "person-1",  "queued_at": 120000, "started_at": 361000, "ended_at": 421000 } ],
  "stops":  [ { "session": "person", "stop": "person#1", "snapshot": "person-1", "at": 120000, "verdict_at": 1921000 } ] }
```

- `script_sha256`: the sha256 of the bytes of the script file the run was given. `order`: `today`, the package's
  order as it is; `person-first`, the changed order; `hub`, the hub's order.
- `places`: one row for every slow-lane place, a session's check on one snapshot that took a place in the queue,
  queued or held (an entry of `Trace.queue` with `op` `queued` or `held`). `queued_at`: when it took the place, at its
  green stop's reply (that entry's `at`, the `queued_at` of its run). `started_at`: the `started_at` of its first
  slow-lane run (`Trace.runs`), or `null` when it never started (a newer snapshot took its place, or the script ended).
  `ended_at`: the `ended_at` of its last slow-lane run, `null` when it never started.
- `stops`: one row for every green stop, a stop whose fast lane ended green and whose reply ended the turn
  (`StopReply.kind` is `ends_turn`). `stop`: its id (`<session>#<n>`, or the event's own `id`). `at`: the stop's
  time. `verdict_at`: when its claim's verdict landed, the latest `ended_at` among the runs its claim's checks rest on
  (`ClaimRecord.checks[*].runs` and `carried_runs`) and never before the stop's `reply_at`; `null` while its claim's
  verdict is `pending` when the script ends.
- An output under the hub's order holds `script_sha256`, `order: "hub"` and `places` with `session`, `check`,
  `snapshot` and `started_at` (a time or `null`) for each; nothing else of it is read.
- Rows are matched by session, check and snapshot (stops by session and stop), in any order. Other fields are
  allowed and not read. `validate.mjs`'s `rowsOf` is the reading of a `Trace` the kept rows are held to.

### `record.json`

```json
{ "main": "c4b1785966dbfad4bbc0e4b4007acab03d7bebe5",
  "runs": [
    { "others": 0, "pool": 2, "script": "scripts/alone-pool-2.json", "sha256": "...",
      "today":        { "out": "out/alone-pool-2.today.json",        "sha256": "..." },
      "person-first": { "out": "out/alone-pool-2.person-first.json", "sha256": "..." } },
    { "others": 1, "pool": 2, "script": "scripts/beside-1-pool-2.json", "sha256": "237d3640...",
      "today":        { "out": "out/beside-1-pool-2.today.json",        "sha256": "e4661214..." },
      "person-first": { "out": "out/beside-1-pool-2.person-first.json", "sha256": "05061a33..." } } ],
  "table": [
    { "others": 3, "pool": 4,
      "today":        { "alone":  { "wait": { "n": 9, "unstarted": 0, "p50": 0, "p95": 0 },          "verdict": { "n": 3, "none": 0, "p50": 1200000, "p95": 1200000 } },
                        "beside": { "wait": { "n": 9, "unstarted": 0, "p50": 60000, "p95": 961000 }, "verdict": { "n": 3, "none": 0, "p50": 1621000, "p95": 2161000 } } },
      "person-first": { "alone":  { "wait": { "n": 9, "unstarted": 0, "p50": 0, "p95": 0 },          "verdict": { "n": 3, "none": 0, "p50": 1200000, "p95": 1200000 } },
                        "beside": { "wait": { "n": 9, "unstarted": 0, "p50": 1000, "p95": 61000 },   "verdict": { "n": 3, "none": 0, "p50": 1260000, "p95": 1261000 } },
                        "others":  { "n": 18, "unstarted": 0, "p50": 119000, "p95": 958000 },
                        "longest": { "session": "other-3", "check": "check-20m", "snapshot": "other-3-1", "wait": 958000 } } } ],
  "neverStops": { "script": "scripts/never-stops.json", "sha256": "...",
                  "today": { "out": "out/never-stops.today.json", "sha256": "..." },
                  "person-first": { "out": "out/never-stops.person-first.json", "sha256": "..." } },
  "orders": { "script": "scripts/orders.json", "sha256": "...",
              "package": { "out": "out/orders.today.json", "sha256": "..." },
              "hub":     { "out": "out/orders.hub.json",   "sha256": "..." },
              "differs": [ { "session": "a", "check": "a2", "snapshot": "a-1", "package": 361000, "hub": 301000 },
                           { "session": "b", "check": "b1", "snapshot": "b-1", "package": 301000, "hub": 601000 } ] },
  "followUp": { "issue": 3601, "title": "...", "criteria": [ "- [ ] ..." ] } }
```

- `main`: the full hash of the main commit the readings ran on, a commit of this checkout's history (an ancestor of
  `HEAD`). The tests run that commit's `simulate`, so the readings stay what they were when main's order changes.
- `runs`: twelve, one for each `others` of 0, 1, 3 and 6 on each `pool` of 2, 4 and 9, each once: the script of the
  table (above) and its output under `today` and under `person-first`. A cited file is `{ "out" | "script", "sha256" }`.
- `table`: nine rows, one for each `others` of 1, 3 and 6 on each `pool`. Under each order, `alone` and `beside` are
  the person's session's reading in the alone run and in the run beside the others on that pool. A reading is
  `wait`, its places' waits for a slot (`n` that started, `unstarted` that never did, `p50`, `p95`), and `verdict`,
  its green stops' times to a verdict (`n` with a verdict, `none` without, `p50`, `p95`). Under `person-first` the row
  also holds `others`, the waits of every place of the other sessions together (`n`, `unstarted`, `p50`, `p95`), and
  `longest`, the place with the longest wait of any place of the run that started and that `wait`; under `today`
  both are checked when they are there. A percentile of no sample is `null`, and so is `longest` when nothing started.
- `neverStops`: the script in which the person's session never stops, and its output under both orders.
- `orders`: the one script; its output under the package's order (`order: "today"`) and under the hub's
  (`order: "hub"`); and `differs`, every place whose start is not the same under both, with its start under each
  (`null`: no start). An empty list says none differs.
- `followUp` (the task filed: its issue number, its title and its own criteria) or `stays` (one paragraph saying why
  the order stays as it is), not both.

Other fields are allowed and not read.

### The report (`docs/spikes/3539/README.md`)

The tests read two kinds of table in it, as #3444's suite reads a report's: a table is rows that each start with `|`,
a header row, then a `|---|` row; header cells are matched without backticks, in any case. A number is digits, with
`,` between thousands or not, a decimal point or not, `s` after it or not, backticks around it or not; a shown number
must be the worked-out one, in seconds, rounded to the decimals it shows. A reading that is `null` is an empty cell
(or `-`, `n/a`).

**The table.** Every table whose header holds `Order`, `Others` and `Pool` is read. For each order (`today`,
`person-first`, in the `Order` cell), each count of others (1, 3, 6) and each pool (2, 4, 9) there is a row, and the
columns of its order are shown for it, in one table or several:

```markdown
| Order | Others | Pool | Wait p50 alone s | Wait p95 alone s | Wait p50 beside s | Wait p95 beside s | Verdict p50 alone s | Verdict p95 alone s | Verdict p50 beside s | Verdict p95 beside s | Others wait p50 s | Others wait p95 s | Longest wait s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `person-first` | 3 | 4 | 0 | 0 | 1 | 61 | 1200 | 1200 | 1260 | 1261 | 119 | 958 | 958 |
```

The first eight columns after `Pool` are needed under both orders; `Others wait p50 s`, `Others wait p95 s` and
`Longest wait s` under `person-first`. The `Others` and `Pool` cells hold the number alone. Other columns and other
rows are allowed.

**The places that start at a different time.** When `orders.differs` is not empty: a table whose header holds
`Session`, `Check`, `Snapshot`, `Package start s` and `Hub start s`, with a row for every place of `differs`, its two
starts as the outputs give them, and no row for a place whose start is the same under both.

```markdown
| Session | Check | Snapshot | Package start s | Hub start s |
| --- | --- | --- | --- | --- |
| `a` | `a2` | `a-1` | 361 | 301 |
```

**The follow-up.** `#<followUp.issue>` somewhere in the report, or the `stays` paragraph, white space aside.

### The harness's command

```sh
node docs/spikes/3539/harness.mjs --script <file> --order <today|person-first> --out <file> [--plant <name>]
```

Run from the checkout's root. It runs the script at `--script` through the gate package's `simulate` under the order,
writes one run's output (above) to `--out`, and exits 0. The suite gives it a script of the table's own shape or one
of its own (below), and runs it with `HOME` and `XDG_CONFIG_HOME` in a temporary folder and without the caller's
`DEEP_*`, `GIT_*` and `NODE_OPTIONS`. How the spike takes the hub's starts is its own: the suite never runs the
harness under the hub's order.

`--plant <name>` selects a planted twin (below). A flag, not an environment variable: the design's Wrong programs
rule says a planted program is never chosen by one.

### The pool held full (`harness-run.mjs`, `heldFullScript`)

The script this suite writes for criterion 3: one session, `person`, whose one turn a person opened at 0 and which
stops at 60000 on snapshot `person-1` with the three slow checks (`check-1m`, `check-5m`, `check-20m`, each taking its
expected time), on a pool of 2 slots, with `"foreign": [{ "at": 0, "ms": 3600000, "slots": 2 }]`: the test holds every
slot of the pool from the script's start until an hour in, through the `Scenario`'s own `foreign`, the slots others
hold, which the scheduler counts as busy.

What a right harness must read there (`validate.mjs`, `heldFullProblems`), for each of the three checks: a place on
`person-1`; `queued_at` no earlier than the stop (60000); `started_at` no earlier than the hold's end (3600000); so a
wait of at least 3540000 ms. The package's own `simulate` reads 60000 and 3600000, 3600000 and 3660000
(`validate.test.mjs`).

### The wrong harnesses

Both are the same harness with one thing wrong, built beside it by the implementer and chosen by `--plant`.

- `--plant times-from-start` (criterion 3): it times each slow check from its start, so it never reads the queue:
  each place's `queued_at` is its `started_at`, and every wait it reads is 0. Its run on the pool held full must fail
  `heldFullProblems`, for each of the three checks, with `the harness read a wait of 0 ms for person's check
  <check> on snapshot person-1, a slow check queued at its green stop (60000) while the test held every slot of the
  pool until 3600000; it waited at least 3540000 ms`.
- `--plant reports-a-gain` (criterion 2): on a script in which the person's session never stops, its `person-first`
  output reports a gain: at least one place waits less for a slot there than in its own `today` output (or a green
  stop's verdict lands sooner). How it comes to is the implementer's: for one, a harness that takes a session of the
  script for the person's whoever opened its turns. Its two runs on the record's `neverStops` script must fail
  `sameUnderBothProblems` with `script docs/spikes/3539/<neverStops.script>, in which the person's session never
  stops: the harness reports a gain: <session>'s check <check> on snapshot <snapshot> waits <n> ms for a slot under
  person-first and <m> ms under today's order`.

Each twin's test passes only when that problem is there. On the base there is no harness and no record, so those
tests fail `BLOCKED`, and that BLOCKED is not counted as the twin's failure.

## Criteria to tests

| Criterion | Test | What it asserts | On the base |
|---|---|---|---|
| AC1 `#3539.c6029842` The table is on this issue: for each count of sessions and each pool, the person's session's wait for a slot and its time to a verdict at the median and the 95th percentile, alone and beside the others | `ac1-table.test.mjs` | `main` is a commit of this history; for the person's session alone and beside 1, 3 and 6 others, on pools of 2, 4 and 9, a kept, pinned script that is the Scope's (above) and its kept, pinned output under `today`, equal row for row to what the package's `simulate` at `main` gives for the script; each row of the record's `table` under `today` equals the reading worked out from those outputs (counts, median and 95th percentile by nearest rank, alone and beside); the report's table shows each of those eight numbers for each count and pool | fails BLOCKED: no spike record |
| AC2 `#3539.bed90c36` The same table under the changed order, with the other sessions' waits beside it and the longest wait of any place. A script in which the person's session never stops reads the same under both orders, and a harness that reports a gain there fails, naming the script | `ac2-changed-order.test.mjs`, first test | the same twelve scripts' kept, pinned outputs under `person-first`, each equal row for row to what the package's `simulate` at `main` gives with the places whose turn a person opened first and then as today; the record's `table` under `person-first` equals the reading worked out from them, with the other sessions' waits and the longest wait of any place; the report's table shows all eleven numbers; the `neverStops` script is kept and pinned, its person's session has no stop and another session does, some place waits in it, both its outputs are what `simulate` at `main` gives, and they read the same: no place or green stop of the person's, every other place and green stop equal | fails BLOCKED: no spike record |
| | `ac2-changed-order.test.mjs`, second test (the wrong program) | the harness's twin `--plant reports-a-gain`, run on the `neverStops` script under both orders, fails the same check with a problem that says it reports a gain and names the script | fails BLOCKED: no spike record (not counted as the twin's failure) |
| AC3 `#3539.6078bd33` A harness that times a slow check from its start, and so reads no wait, fails against a pool held full by the test, naming the check | `ac3-held-full.test.mjs`, first test | the spike's harness, on the script whose pool this suite holds full, reads each of the three checks as queued no earlier than its green stop, started no earlier than the hold's end, and so as waiting at least from one to the other | fails BLOCKED: no `docs/spikes/3539/harness.mjs` |
| | `ac3-held-full.test.mjs`, second test (the wrong program) | the twin `--plant times-from-start` fails the same check, with a problem naming each of the three checks | fails BLOCKED: no harness (not counted as the twin's failure) |
| AC4 `#3539.1c4e0033` One script run through the hub's order and the package's shows each place's start under both, and the issue names every place that starts at a different time | `ac4-orders.test.mjs` | one kept, pinned script in which some place waits; its kept output under the package's order equals what `simulate` at `main` gives; its kept output under the hub's order (`order: "hub"`) shows a start, or `null`, for every place the package's has, each row a check of one of the script's sessions on a snapshot it stops on, never started before that stop; `orders.differs` is exactly the places whose two starts differ, with both starts; the report's table names each of them with both starts, and no other place | fails BLOCKED: no spike record |
| AC5 `#3539.f207836e` A follow-up is filed for what the table justifies, with its own criteria, or this issue says in one paragraph why the order stays as it is | `ac5-follow-up.test.mjs` | exactly one of `followUp` (an issue number above 3539, a title, its own criteria, the number named in the report) and `stays` (one paragraph, no blank line, held in the report) | fails BLOCKED: no spike record |

Each test's name starts with its criterion's number and ID, the first 8 hex digits of the SHA-256 of the criterion's
text as `scripts/proof-change.mjs`'s `criterionId` reads it; they came out as the brief gave them. Criterion 2 names a
wrong harness and criterion 3 is one, so each has a test of the harness's twin beside the test the well-formed spike
passes.

### The wrong programs

The merge base, with no spike, is the wrong program each criterion's own test fails on. The two the criteria name
are the harness's twins (above), run by the suite. Each check is also held, in `validate.test.mjs`, to altered copies
of `example.mjs`'s spike and to rows read as a twin would read them; the check must fail with the problem shown.

| Criterion | The planted wrong spike or reading | It must fail with |
|---|---|---|
| 1 | a kept `today` output in which one of the person's places starts a minute later | `runs: 3 other sessions on a pool of 4 slots, today (out/...): person's check <check> on snapshot <snapshot> has started_at ...; the package's simulate at main gives ...` |
| 1 | the record's table gives another 95th percentile | `table: 3 others, a pool of 4: today.beside.wait.p95 is ...; the kept run of the person's session beside the others gives ...` |
| 1 | a script of 3 others that holds 2, or whose other session has a prompt a person typed | `...: 2 sessions whose turns nobody typed, not 3`; `...: the turns of "other-1" are neither all a person's nor all ones nobody typed (...)` |
| 2 | today's rows kept as the changed order's | `runs: ..., person-first (out/...): ... has started_at ...; the package's simulate at main, taking the places whose turn a person opened first and then as today, gives ...` |
| 2 | the changed order's row without the others' waits, or with another longest wait | `...: person-first.others (the other sessions' waits) is missing`; `...: person-first.longest.wait is ...; the longest wait of any place in the kept run is ... ms, ...` |
| 2 | a kept `person-first` output of the `neverStops` script in which a place that waited starts when it was queued (and the twin's reading of that script, on rows) | `script docs/spikes/3539/scripts/never-stops.json, in which the person's session never stops: the harness reports a gain: ...'s check ... on snapshot ... waits 0 ms for a slot under person-first and ... ms under today's order` |
| 2 | a `neverStops` script in which the person's session stops | `docs/spikes/3539/scripts/never-stops.json: the person's session "person" stops in it` |
| 3 | the package's rows of the pool held full, each place's `queued_at` set to its `started_at` | `the harness read a wait of 0 ms for person's check check-1m on snapshot person-1, a slow check queued at its green stop (60000) while the test held every slot of the pool until 3600000; it waited at least 3540000 ms`, and the same for `check-5m` and `check-20m` |
| 4 | `orders.differs` without a place whose starts differ, or with one whose starts don't | `orders.differs doesn't name b's check b1 on snapshot b-1, which starts at 301000 under the package's order and 601000 under the hub's`; `orders.differs[2]: a's check a1 on snapshot a-1 doesn't start at a different time: ...` |
| 4 | a hub output without one of the package's places; a report without one of the places that differ | `orders, the hub's order (out/orders.hub.json): shows no start for a's check a2 on snapshot a-1: ...`; `the report doesn't name b's check b1 on snapshot b-1, which starts at a different time under the hub's order (...)` |
| 5 | neither, both, a follow-up with no criteria, a number not above 3539, two paragraphs | `the record holds either followUp (the task filed) or stays (why the order stays as it is), not both and not neither`, and the like |

### What a failure reads as

A failure's message starts with its state, as `scripts/lanes.mjs` reads one, then the criterion's tag; with none, it
is a FAIL. The worst state among a check's problems stands, by the design's precedence (FAIL, INVALID, BLOCKED,
INCONCLUSIVE), as in #3444's suite.

- `BLOCKED`: something outside the code is missing or unrun. No record, no report, no harness; a count or a pool with
  no run or no table row; a script that wasn't run under an order; a cited file that isn't kept or whose sha256 isn't
  the record's; a `main` this checkout's git doesn't have, or whose packages can't be exported and loaded; a harness
  that didn't run to its end.
- `INVALID`: the check can't fail. A `neverStops` script in which no place waits for a slot, so that no order could
  read differently; an `orders` script in which none waits under the package's order, so that order decides no start
  in it.
- FAIL: everything else, the wrong programs above among them. Nothing is skipped.

## Readings

Where the issue and the design leave a choice, the choice made here:

- **"The table is on this issue", "this issue says in one paragraph", "a follow-up is filed".** A test can't read
  GitHub. As #3222's and #3444's suites do, this one holds the table in the record and in the spike's report against
  the kept runs, and the paragraph or the follow-up's number in the report; that the same is on issue #3539 is the
  Proof's and the reviewer's.
- **A place, and its start.** Under the package's order a place is what the scheduler calls one: a session's check on
  one snapshot, queued or held in the slow lane's queue (`queueSlow`, `holdSlow`), and its start is the start of its
  first slow-lane run. Under the hub's order a place is the same three names, the session, the check and the snapshot
  (the claim's commit there), and its start is when the hub's runner started its slow-lane run, on the script's clock.
  So a place of one order is the place of the other with the same session, check and snapshot.
- **The wait for a slot.** For one place: from the time it took its place, at its green stop's reply, to its start
  (`started_at - queued_at`). The Scope says "from each green stop to its slow checks' start"; a stop with nothing in
  the fast lane and no `checkout_ms` replies at its own time, so the two are one number there, and where they are not
  the time before the reply is the snapshot's and the fast lane's, not a wait for a slot (the issue: "A held stop's
  time is split, and one part is its queue wait"; this is the wait after the reply). A place a loop holds counts its
  hold in its wait, since the `Trace` has no time for the hold's end; a script whose other sessions' origins are
  `continuation`, `scheduled` or `subagent`, with no due time, goal or background work among their facts, holds none.
  A place that never started has no wait and is counted (`unstarted`), never dropped.
- **The time to a verdict.** For one green stop: from the stop's time to the time its claim's verdict landed, the end
  of the last run its checks rest on. A green stop whose claim still reads `pending` when the script ends (a newer
  stop took its checks' places before they ran) has none and is counted (`none`).
- **A green stop.** A stop whose reply ended the turn (`StopReply.kind` `ends_turn`): its fast lane ended green and
  nothing kept the agent working. In a script of the table no check fits the fast lane (each expects a minute or
  more against the default 10 s budget), so every such stop queues or holds all three.
- **Alone and beside the others.** Alone: a script that holds the person's session and nothing else, on the same
  pool. Beside: the script with that same session, field for field, and the others. One alone run for each pool
  serves the three counts.
- **One row of the table.** One count of others (1, 3 or 6) on one pool (2, 4 or 9): nine rows for each order. The
  samples are every place of the person's session in the run (its waits) and every green stop of it (its times to a
  verdict), so a session that stops once gives three waits and one time. How many times a session stops is the
  spike's: the issue asks for a median and a 95th percentile and sets no count, and this suite sets none.
- **The median and the 95th percentile.** Nearest rank: the smallest sample with at least that share of the samples
  at or below it, as #2649's, #3222's and #3444's suites take them.
- **1, 5 and 20 minutes (drafted).** Three checks a session that take 1, 5 and 20 minutes: `took_ms`, and
  `expected_ms`, the time the scheduler sizes a check by, which before a check has run is the time it took when
  drafted (design: Fast and slow lanes), are 60000, 300000 and 1200000. "Drafted" is also the issue's word for a
  number it proposes; either way the three numbers are these, and this suite sets none of its own.
- **Whose turns a person opened, and nobody typed.** By the origin of every prompt of the session: `human` for the
  person's; one of the scheduler's five automatic origins, and no typed words, for the others. The origins `app` and
  `answer` are in no script of the table: whether the changed order takes them for a person's is not this issue's.
- **Pools of 2, 4 and 9 slots.** `config.slots`, with every other setting the scheduler's default, so that today's
  order is read at the design's own budget, hold and grace window.
- **The package's order, to a test.** What `simulate` gives. The tests run the scheduler of the record's `main`,
  exported from git (`base.mjs`), not the working tree's, so the kept readings stay proven when a later change, the
  follow-up's for one, alters the order on main.
- **The changed order, to a test.** "Places whose turn a person opened first and then as today". The spike changes no
  code on main and `simulate` has its order built in, so how the harness comes by the changed order is the
  implementer's (a copy of the scheduler with a patch kept beside the report, as #2649's cuts are, or the way below).
  To a test it is this: the package's own `simulate` on the script with every check of the person's session marked
  `on_base: fails` and every other check `passes`. The package's dispatch takes ready places `on_base: fails` first,
  then by the time they queued, then by number; with one `on_base` in the script and every turn of a session opened
  the same way, that is the person's places first and, among the person's and among the others, exactly today's
  order. `on_base` decides nothing else in a script whose checks all go to the slow lane. A probe held the two to
  the same `Trace` on 600 scripts (What was read). This is why a script of the table has one `on_base`: with two, "as
  today" would sort by it too, and the reading would mix two orders. A script in which the person's session never
  stops has no place whose turn a person opened, so its changed order is today's, and it is run as it is.
- **"Reads the same under both orders".** The two outputs of the `neverStops` script hold no place and no green stop
  of the person's session, and every other place (`queued_at`, `started_at`, `ended_at`) and green stop (`at`,
  `verdict_at`) is equal. The others in it are sessions whose turns nobody typed, at least one of which stops, and
  some place waits for a slot, or no order could read differently (INVALID).
- **A gain.** A place that waits less for a slot, or starts where it never did, or a green stop whose verdict lands
  sooner, in the `person-first` output than in the `today` output of the same harness. Any other difference is "doesn't
  read the same". Both name the script by its path, `docs/spikes/3539/<neverStops.script>`.
- **The harness that reports a gain** is run on the spike's own `neverStops` script, since the criterion says "there".
  What makes it report one is left open (The wrong harnesses).
- **A pool held full by the test.** Through `foreign`, the `Scenario`'s slots that others hold, the one surface the
  base gives a script for slots busy with what isn't its sessions': every slot, from before the stop until long
  after it. The bound is certain on a virtual clock: no slow check starts while no slot is free.
- **The hub's order, to a test.** The issue's words for it are `pump`'s: queued slow checks start while slots are
  free, in the order the queue holds them, with no sort. To a test it is the starts the spike kept under
  `order: "hub"` for the one script: what they are held to, and why not to the hub's code, is in the table below. The
  one script must have a place that waits under the package's order, or that order decides no start in it (INVALID);
  whether its starts under the hub's order differ is the spike's reading, and an empty `differs` is one.
- **"The issue names every place that starts at a different time".** `orders.differs` lists them, worked out here
  from the two outputs, and the report's table names each with both starts; that the issue does is the reviewer's.
- **A filed follow-up, to a test.** As #3222's and #3444's suites hold one: the record names the task's number, above
  3539 since it was filed after it, its title and its own criteria, and the report names the number.
- **The wrong harnesses are chosen by a flag**, by the design's Wrong programs rule.

### What a test holds of a run, and what it could not

| The record says | A test holds | Not held |
|---|---|---|
| which sessions a script holds, and who opened their turns | the kept script's own sessions and the origin of every prompt of each | |
| how many slots its pool has | the kept script's `config`, which holds `slots` and nothing else | |
| which script an output is of | `script_sha256` is the sha256 of the kept script, which the record pins | |
| it ran under today's order, through the package's code | every row equals what the package's `simulate` at `main` gives for the kept script | that the spike's harness wrote the kept file |
| it ran under the changed order | every row equals what the package's `simulate` at `main` gives in that order (Readings) | that the spike's harness wrote the kept file; how the harness comes by the order |
| the harness reads a wait | its run on the pool this suite holds full, and its twin's | the harness's run on the scripts of the table: the kept outputs are held to `simulate` instead |
| it ran through the hub's order | the output says `order: "hub"`, shows a start or `null` for every place the package's has, names only places of the kept script, none started before its stop | that the starts came from the hub's runner (`GateRunner`, `pump`), on what clock, with how many slots, and what stood for a checkout or a run: see below |

**Why the hub's run is not held to the hub's code.** The base lets a test drive the real `GateRunner` with options of
its own (`packages/hub/test/gate-queue.test.ts`). To hold a kept start to it, a test would have to turn a script's
events into the runner's calls itself: its clock, its free slots, its checkouts, what ends a run, when a turn ends
and with which reading. Each is a choice that moves a start, none is a surface the issue or the design names, and
making them is the spike's work on its fourth Scope line. Two drivers that chose differently would disagree with
neither being wrong. So the hub's starts are held only to the script and to the package's places, and the Proof ("the
hub's and the package's starts on the one script") and the reviewer hold the rest.

## What isn't asserted

- Any wait or time against a limit of this suite's own: the issue sets no budget on one. No minimum number of stops.
- Scope lines no criterion reaches: "the same reading from a record where one exists: the dogfood week's replays
  (#43)" (#43 is open, and no criterion names a record's reading); "what the person's session gains, what the others
  lose" as numbers of their own (the two tables give both sides); "the spike changes no code on main".
- That the table, the places that differ, and the paragraph or the follow-up's number are on issue #3539, and that
  the follow-up is filed on GitHub, open, in the shape the open issues have, and is what the table justifies.
- That the hub's starts came from the hub's code (above), and that the hub's order is anything in particular: no
  property of its starts is asserted beyond the script's own.
- That the spike's harness wrote the kept outputs, and how it comes by the changed order.
- The other sessions' waits and the longest wait under today's order, unless the record gives them.
- A script's sessions' stop times, how many stops, which automatic origins, its `agent`.

## What the implementer adds outside this folder

Nothing for this suite: no lane list, manifest or dependency changes. The spike's own folder, `docs/spikes/3539/`,
is the work.

## Gaps and deviations

- **The base fails every criterion's test on a missing record or harness.** The base is the wrong program for each;
  that each check also fails the wrong spike its criterion names is shown by `validate.test.mjs`, on a synthetic spike.
- **Never run against a real spike or a real harness.** None exists. The formats were checked against `example.mjs`,
  and the harness-running tests' code against a stand-in harness in a scratch folder (What was read).
- **The harness is run by the suite at `HEAD`, the kept outputs are held at `main`.** A later change to the
  scheduler leaves the record's tests as they were; the three tests that run the harness depend on the harness still
  running then. Both of their checks hold for any order: a slow check can't start in a full pool, and a script with
  no place of the person's reads the same under both orders.
- **A harness that leaves a process running** when the suite's deadline ends it is ended by PID; what it started
  itself is not followed.
- **The export is about 70 MB a test file**, in the system's temporary folder, removed when the process ends; a
  process ended by a signal leaves it there.
- **One `on_base` in a script of the table** is this suite's need (Readings), not the issue's.
