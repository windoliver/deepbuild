# Acceptance tests for #2870: canvas.mjs judge gives judgeLimit the loads

Written blind at base `2b36234a7` from issue #2870, `docs/technical-design.md` (How we know version 0 works: The
reference Macs, Criteria to tests, Wrong programs, Dogfooding), AGENTS.md, `benchmarks/canvas.mjs` (`judge`,
`judgeEfficiency`, `runs`, `EFFICIENCY`, `FLOORS`, `COUNTS`), `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`,
`references`), `scripts/loads-lint.mjs`, `benchmarks/budgets.json` and `scripts/proof-change.mjs` (`criterionId`).
Nothing of #2870 exists at the base. The implementer doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2870 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2870/tsconfig.json
```

Both tests run on any machine in about a second: no build, no GPU, no timing, no throttle window or grant. No test file
calls a timing helper at its own call site, so none belongs in `scripts/lanes.mjs`'s `timed` list (#1114's grep), and
none needs `alone`. No lanes entry is needed. On the base each test fails at its first assertion, as `BASE-FAILURE.txt`
shows.

## Surfaces

- `node benchmarks/canvas.mjs judge` reads `{ current, base }` on stdin, as the budget window's `judgeTargets` gives it,
  and prints its verdict as its last stdout line, `{ task, status, targets: { <target>: { status, reason, ... } } }`. For
  an efficiency task it judges each of the task's targets in `benchmarks/budgets.json` on `current.runs`, with
  `current.fingerprint` as the machine. The tests read `targets.<target>.status`, and its reason for a message.
- `judgeLimit` reads one thing from the machine it runs on rather than from the report: the core count
  (`availableParallelism`) each run's load is held against. So every load the reports record at rest is at most 1, which
  no machine's core count is under, and a loaded run reads 4096, above any machine's. The verdicts don't depend on the
  machine that runs the tests or on its load.
- `node scripts/loads-lint.mjs --root <checkout>` prints one `FAIL loads: <path>:<line>: judgeLimit gives no loads` line
  per call it finds, the path relative to the root, and exits 1, or prints one `PASS loads` line and exits 0 (#1830).

## Criteria, tests and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`).

| ID | Criterion | Test | Wrong program it fails on |
|---|---|---|---|
| `#2870.635d9a6f` | `canvas.mjs judge` gives `judgeLimit` each run's `{start: loadStart, end: loadEnd}`, for plain targets and floors alike, so a time target on a reference Mac at rest reads PASS or FAIL, not INCONCLUSIVE. A planted judge that drops the loads fails, naming the target | `ac1-judge`: *on recorded reports from a reference Mac at rest, canvas.mjs judge reads a plain target and a floor PASS when every run meets it and FAIL when every run misses it, and INCONCLUSIVE when a run's own load at its start or end is above the cores or missing; the same check fails a planted judge that drops the loads, naming each target* | The base: the plain target reads INCONCLUSIVE at rest and the floor BLOCKED. The planted judge, `twins/drops-loads.mjs.txt`: this checkout's judge with its loads dropped, whose cases at rest the check lists, each by its target. A judge that reads a missing load as 0, gives constant loads or a run's start or end load twice, gives loads to plain targets only or floors only, or leaves the floor negated (see the mutants below) |
| `#2870.348a454d` | The loads lint reads `benchmarks/` as well as `tests/acceptance`, so a judge there that gives no loads fails the lint | `ac2-lint`: *over a checkout holding this one's benchmarks/, the loads lint lists a judge planted under benchmarks/ and a suite planted under tests/acceptance that give no loads, each by its file and line, nothing else, and fails* | The base lint, which reads `tests/acceptance` only. A lint that reads `benchmarks/` only. A `benchmarks/` whose own judge still gives no loads in a call, such as canvas.mjs's class judge |

## The reports

`reports/canvas-surface.json` and `reports/playtest-throughput.json` are efficiency reports as a reference Mac at rest
records them, one per kind of time target: `canvas-surface`'s `rebuild_128_ms`, a plain target (2 ms in `budgets.json`
at the base; #224's `ac02-rebuild-budget` runs this task's judge), and `playtest-throughput`'s `fixture_realtime_x`, the
one floor in `FLOORS` (at least 50 times real time). Each names a reference Mac (Mac15,7 and Mac17,10) on mains power,
Low Power Mode off, thermal state nominal, with its macOS build and a release build, and five runs, each with the
target's reading and the one-minute load at its start and end as `runs()` stamps them (`loadStart`, `loadEnd`). Each
case judges a copy (`helpers.ts` `CASES`):

| Case | The copy | Its target reads |
|---|---|---|
| at rest, every run meets it | as recorded: 1.19 to 1.25 ms against 2 ms; 71.2 to 74.3 times against a floor of 50 | PASS |
| at rest, every run misses it by far more than the margin | plain readings times 2.8 (3.32 to 3.49 ms); the floor's times 0.3 (21.4 to 22.3) | FAIL |
| run 3's load at its start is 4096, above the cores | that one load | INCONCLUSIVE |
| run 3's load at its end is 4096, above the cores | that one load | INCONCLUSIVE |
| run 3 carries no load | its `loadStart` and `loadEnd` removed | INCONCLUSIVE |

## How the plants work

- **The planted judge** (AC1): `twins/drops-loads.mjs.txt` is laid as `scripts/benchmark.mjs` in a scratch checkout
  that holds copies of this checkout's `scripts/` and `benchmarks/`, its `node_modules` linked. It re-exports this
  checkout's `scripts/benchmark.mjs` and calls its `judgeLimit` with every argument the judge gives except `loads`. The
  scratch checkout's `benchmarks/canvas.mjs` is this checkout's, so the plant is the judge as written with its loads
  dropped on the way in, in whatever form it passes them.
- **The planted calls** (AC2): `twins/benchmarks/judge-without-loads.mjs.txt`, a judge in the two forms canvas.mjs's
  `judgeEfficiency` had at the base (a floor's call inside a spread, a plain target's call), is laid as
  `benchmarks/judge-without-loads.mjs`; `twins/acceptance/judge-without-loads.test.mjs.txt`, a timing suite, as
  `tests/acceptance/9870/judge-without-loads.test.mjs`. Both go into one scratch checkout beside copies of this
  checkout's `scripts/` and `benchmarks/`. The expected FAIL lines are the lines marked `// finding`.
- Plants are stored with a `.txt` suffix under `twins/`, so no lane, typecheck or the lint itself reads them in place.
  Scratch checkouts are temporary folders built from those files, never from `.git`, and removed when the test ends.

## Readings where the issue leaves a choice

1. **"each run's `{start: loadStart, end: loadEnd}`"** is held through verdicts, not through the call's arguments: a
   run's own load above the cores at its start or at its end reads INCONCLUSIVE, and so does a run that carries no load,
   since `judgeLimit` reads a load it can't read as INCONCLUSIVE (#1555) and a missing load is never read as 0
   (invariant 2).
2. **"a reference Mac at rest"** is the report's own fingerprint, one of `references` in the conditions `judgeLimit`
   requires, with a release build, and loads of at most 1. This Mac isn't a reference Mac; the reports carry theirs.
3. **"plain targets and floors alike … reads PASS or FAIL"** holds for both kinds: PASS when every run meets the target,
   FAIL when every run misses it by far more than the margin. On the base the floor reads BLOCKED, not INCONCLUSIVE:
   `judgeEfficiency` judges a floor as the limit on its negated readings, and `judgeLimit` refuses any reading below 0
   before it reads the loads. Giving it loads alone leaves the floor BLOCKED, so the floor half of the criterion needs
   the floor judged in a form `judgeLimit` takes. The cases read the same under any judge that passes runs at or above
   the floor and fails runs far under it (the sample below judges a floor on reciprocals).
4. **"A planted judge that drops the loads fails, naming the target"**: the check that holds this checkout's judge must
   list the planted judge's cases at rest, each reading INCONCLUSIVE, each line starting with its target's name. It runs
   after the checkout's own judge, so on the base the test fails there.
5. **"reads `benchmarks/` as well as `tests/acceptance`"**: one lint run over a checkout holding both plants lists
   exactly the planted calls, so it reads both folders, and the copy of this checkout's `benchmarks/` adds no finding.
   That copy includes canvas.mjs's class judge (`current.class`, the warm frames), whose call gives no loads at the
   base; once the lint reads `benchmarks/` it lists that call as it lists any other.
6. **Where the plants sit**: at the top of `benchmarks/`, and in a numbered suite folder under `tests/acceptance`, as
   `.mjs` files, where canvas.mjs and the timing suites sit.

## Checked against a sample implementation and mutants

In a scratch copy outside this checkout (not committed) I wrote a sample fix: `judgeEfficiency` gives `judgeLimit`
`(current.runs ?? []).map((r) => ({ start: r.loadStart, end: r.loadEnd }))` for plain targets and floors, a floor judged
on reciprocals (`limit: 1 / limit`, `runs: values.map((v) => 1 / v)`), the class judge gives its warm runs' loads the
same way, and the lint reads `tests/acceptance` and `benchmarks/`, each where it exists. Both tests passed (2/2). Each
mutant of it failed the tests named:

| Mutant | Failed |
|---|---|
| A run's missing load read as 0 | AC1: *run 3 carries no load*, both targets |
| Loads `{start: loadStart, end: loadStart}` | AC1: *load at its end*, both targets |
| Loads `{start: loadEnd, end: loadEnd}` | AC1: *load at its start*, both targets |
| Constant loads | AC1: the three loaded or missing cases, both targets |
| Loads for plain targets only | AC1: the floor at rest; AC2: canvas.mjs's floor call |
| Loads for floors only | AC1: the plain target at rest; AC2: canvas.mjs's plain call |
| Loads given, the floor still negated | AC1: the floor BLOCKED in all five cases |
| The class judge left without loads | AC2: canvas.mjs's class call |
| A lint that reads `benchmarks/` only | AC2: the `tests/acceptance` plant |
| The lint unchanged | AC2: the `benchmarks/` plant |

## Not covered here

- Real runs. `benchmarks/playtest.mjs` (`playtest-maze`, `playtest-throughput`, `playtest-crawler`) and
  `benchmarks/logic-budgets.mjs` (`canvas-logic-budgets`) build their runs in their own loops, not through canvas.mjs's
  `runs()`, so at the base their reports carry no `loadStart` or `loadEnd`. Once the judge gives each run's loads, those
  tasks' time targets, the floor among them, still read INCONCLUSIVE on a reference Mac at rest until their runs carry
  the loads. The criteria name the judge; these tests judge recorded reports that carry them.
- The class judge's verdicts on warm frames; only its call, through the lint.
- #1830's suite runs the lint over scratch checkouts with no `benchmarks/` folder, so a lint that needs one breaks it.
