# Acceptance tests for #854: the efficiency bar for agent work

Written first, from issue #854 (its scope, its five acceptance criteria, its proof line and its Oracle note), the
design sections it names and those they lean on, and the base commit `6f637e33` ("Merge pull request #876 …
feat/857-parallel-nodes"), by a job that never saw an implementation; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: The cost model (the budget class table; "Cold, warm and while authoring": cold "from
  opening the document in a fresh process to its first settled frame, its compiles … included", the authoring loop
  "from a patch's latch to the settled frame it causes"; coefficients from the reference Mac); Admission and latch;
  Frame clock and scheduler ("Arms a frame only on a commit, a changed reading, input, a finished GPU frame, a
  `valid_until` …, and stops the display link when idle"; Cost: "Idle: 0 frames and 0 wakeups as the target, with
  wakeups reported"); Invalidation and damage ("It can never: Rebuild an unchanged item"); Meter and degrade ladder
  ("A rung's pipelines compile off-screen before the swap"); Replica `deep_drive` (a separate app process rendering
  headless with the same core; "Launch ≤ 2 s"); Check input: playtest; Frame budget (five runs after warm-up, each
  run's p95 against its limit, PASS / FAIL / INCONCLUSIVE with the margin the larger of 5% and the runs' spread);
  the extension API's `read` ("evaluates a revision as `deep_query` does … 200 rows in under 50 ms").
- `docs/technical-design.md`: How we know version 0 works, Dogfooding, Tests written first; Numbers version 0 has
  to hold, Every task carries its own budgets ("compared with the merge base … A regression is a p50 more than 50%
  above the merge base's … A frame-time limit an issue states at p95 does gate: each timing run takes its p95 over
  every frame of the fixture's run"; "A timing result comes from five runs after warm-up"), The reference Macs.
- At the base: AGENTS.md; `benchmarks/budgets.json`, `benchmarks/canvas.mjs` (its `costs`, `class` and `judge`
  modes), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`, `compare`), `scripts/perf.mjs`,
  `scripts/lanes.mjs`, `scripts/proof-change.mjs` (criterion IDs); `crates/deep-show` (`run`, `--costs`,
  `costs_refused`), `crates/deep-gpu-layer` (`deep-gpu run`'s `live` window: per-frame `gpu_ms` and `cpu_ms`, a
  revision's `settled_ms` and `pipelines`), `crates/deep-replica` (R1's headless snapshots of the app shell's
  views, and `deep-replica-canvas`), `crates/deep-canvas/src/cost.rs` and `costs.json` (its `build`), the
  `crates/deep-canvas/src/registry` tool list (`deep_query` is a name, nothing more); `adapters/*.facts.json` (no
  tokenizer named); the suites `tests/acceptance/379/` (the perf lane's record-and-judge shape this suite follows),
  `387/`, `855/` (the coefficient file's profile and its refusal), `857/` (the reference-Mac gate and judge).

What the base already does and these tests don't credit: an unchanged frame runs nothing (#387); the cost model
refuses a coefficient file whose `build.profile` isn't optimized, `costs_refused` naming it (#855); `deep-gpu`'s
`live` window reports frame times and a revision's settle time on a virtual clock; `canvas.mjs class` records a
class's cold start and authoring loop as readings. But budgets.json has none of the four tasks, `canvas.mjs` has
no mode for them and its `judge` knows only budget-class reports, nothing answers `deep_query`, no adapter's facts
pin a tokenizer, the perf lane's fingerprint names no build profile, nothing reads idle frames, wakeups or CPU from
a process on the real clock, and the replica has no fixture document to open. So these tests define the surface
below.

## Run them

The tasks build their own release binaries (several minutes cold) and `idle.test.ts` runs at least ten minutes of
real time (two recordings of five 60 s runs), so the folder runs one file at a time, after the parallel block. `scripts/lanes.mjs` needs
`'tests/acceptance/854/'` added to its `alone` list beside `'tests/acceptance/857/'`; this README is the
instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/854 --no-file-parallelism
npx tsc -p tests/acceptance/854/tsconfig.json   # type-check
```

The tests run each task exactly as the perf lane does, `node benchmarks/canvas.mjs <mode> [--planted <name>]`
from the checkout root, and judge with `node benchmarks/canvas.mjs judge`; they build nothing themselves except
`release.test.ts`, which builds the shipped `deep-show` (`cargo build --locked --bin deep-show`) for the cost
model's refusal. Every process is started by `spawnSync` and stopped only by its own timeout. A run with `--root
tests/acceptance/854` leaves Vitest's cache in `tests/acceptance/854/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base: all 21 tests fail there, at the missing task or judge.

The tasks need macOS's Metal device; off macOS each test that runs one skips as `INCONCLUSIVE`. Timing and
process readings (patch to settled frame, the two read times, wakeups, CPU, cold start) are judged only on a
reference Mac (Mac15,7 / Apple M3 Pro / 36 GiB or Mac15,12 / Apple M3 / 16 GiB): elsewhere those tests record and
check their reports, then skip as `INCONCLUSIVE (reading only)`; they never pass by skipping. As #379's and #857's
gates do, and by the owner's rule, power, Low Power Mode, heat and load aren't gated by the tests' own judge; each
result prints them. The lane's judge does gate them (`judgeLimit`), so when it alone keeps a run a reading on those
grounds the test skips as INCONCLUSIVE, saying so. Counts (tokens, rows, frames drawn) are judged on any Mac.

## The surface under test

The issue names four perf-lane tasks, their targets, deep_query's summary and paged read, a pinned tokenizer in
the adapters' facts, frames drawn, wakeups and CPU read from the process, a replica's cold start, the build
profile in a task's fingerprint and four planted programs, but no API. These tests extend `benchmarks/canvas.mjs`
and `benchmarks/budgets.json` the way #379 did (a task records a report; `judge` judges it), and the adapters'
facts. Which binaries a task drives is the implementer's choice; only the reports below are observed.

### budgets.json: four tasks

| id | command | targets |
|---|---|---|
| `canvas-patch-settled` | `["node", "benchmarks/canvas.mjs", "patch-settled"]` | `{"settled_p95_ms": 4}` |
| `canvas-scene-read` | `["node", "benchmarks/canvas.mjs", "scene-read"]` | `{"summary_ms": 20, "summary_tokens": 2000, "page_ms": 50, "page_rows": 1000}` |
| `canvas-idle` | `["node", "benchmarks/canvas.mjs", "idle"]` | `{"frames": 0, "wakeups": 1, "cpu_fraction": 0.001}` |
| `replica-cold-start` | `["node", "benchmarks/canvas.mjs", "replica-cold-start"]` | `{"first_settled_ms": 300}` |

Each entry has `margin: 0.5` (the perf lane's, against the merge base), `limits` the lane's validator accepts
(`{}` is fine: the targets aren't wall times of the command), an `initialReason` naming #854, and the new field
`targets`, the issue's numbers, which `judge` reads from here (never from a report), and which `validateBudgets`
freezes with the entry once it reaches main. budgets.json must still pass `validateBudgets` against the merge
base's.

### A task's report

Each mode builds the binaries it times with `--release` (as `costs` does), runs one warm-up run, then five runs,
exits 0 whether or not a target holds, and prints one JSON report as its last stdout line:

```json
{"task": "<budgets.json id>",
 "fingerprint": {…scripts/benchmark.mjs fingerprint()…, "build": {"profile": "release", "toolchain": "rustc 1.99.1 (…)"}},
 "runs": [Run, Run, Run, Run, Run], …the task's own fields}
```

`fingerprint.build` is the Cargo profile and `rustc -V` of the binaries whose timings the report holds ("the build
profile in its fingerprint"). `--planted <name>` runs the task's wrong program, reachable only there.

- **`patch-settled`**: `"items": 10000, "patches": 200`; `Run = {"p95_ms", "samples": [Sample × 200]}`;
  `Sample = {"patch": 1..200, "item": ID, "frame": integer, "cpu_ms", "gpu_ms", "ms", "ran": {operator: count}}`.
  A window shows a 10,000-item board; each patch changes one item (`item`); `frame` is the number, in the
  window's sequence, of the settled frame the patch caused (rising within a run); `cpu_ms` is CPU time from the
  patch's arrival to that frame, `gpu_ms` the GPU time of the frames it took, `ms` their sum; `ran` counts the
  nodes that ran for it, by operator; `p95_ms` is the run's nearest-rank p95 of `ms`.
  `--planted runs_every_node`: a scheduler that runs every node on each frame.
- **`scene-read`**: `"items": 10000, "tokenizer": {"adapter", "name", "version"}`; `Run = {"summary": Read,
  "page": Read & {"next": cursor | null}}`; `Read = {"ms", "tokens", "bytes", "rows"}`. On the same board,
  deep_query's summary and one paged read of 1,000 rows, each timed; `bytes` is the reply's UTF-8 length,
  `tokens` its count by the tokenizer named, `rows` the item rows it holds, `next` the cursor to the following page.
  `--planted unpaged`: deep_query answers the paged read with every row, unpaged (`next: null`).
- **`idle`**: `"fixture": path, "seconds": 60`; `Run = {"opened_frames", "seconds", "frames", "drawn": [{"frame",
  "at_ms"}], "wakeups", "cpu_ms", "cpu_fraction"}`. A window opens the still fixture document (`opened_frames` ≥ 1
  drawn while it opens), then for at least 60 s of real time the run reads from the window's process the frames
  it drew (`frames`, each in `drawn` with its number and time into the run), its wakeups and its CPU time;
  `cpu_fraction` is `cpu_ms` over the run's milliseconds, a fraction of one core. `--planted arms_each_vsync`: a
  frame clock that arms a frame each vsync.
- **`replica-cold-start`**: `"fixture": path`; `Run = {"ms", "pipelines": [{"name", "on_first_frame": bool}]}`.
  Each run spawns a fresh replica process on the fixture document; `ms` is from the spawn to its first settled
  frame; `pipelines` lists every pipeline the fixture draws with, once, and whether it was compiled during that
  first frame. `--planted compiles_on_first_frame`: a replica that compiles its pipelines on the first frame.

### The adapters' facts: the pinned tokenizer

At least one agent adapter's facts (`adapters/claude-code.facts.json`, `codex` or `pi`) gains `"tokenizer":
{"name": string, "version": exact version, …}` (the facts' usual `readBy` and `conformance` beside them are the
implementer's), and `scene-read`'s report names that adapter, name and version.

### `node benchmarks/canvas.mjs judge`, for these tasks

It reads `{"current": Report, "base": null}` on stdin, as #379's `judge` does, dispatches on `current.task`, exits 0
and prints one verdict line:

```json
{"task", "status": "PASS" | "FAIL" | "INCONCLUSIVE" | "BLOCKED" | "INVALID", "profile": string | null,
 "targets": {target: {"status", "limit", "runs": [5 numbers], "reason"?}}, "reason"?: string}
```

- A report whose `fingerprint.build.profile` isn't `release`, or names none, is refused: `status: "INVALID"`,
  `profile` the profile it names (or null), `reason` naming it. Nothing of it is judged.
- Each target's `runs` are the five runs' values: `p95_ms`; `summary.ms`, `summary.tokens`, `page.ms`,
  `page.rows`; `frames`, `wakeups`, `cpu_fraction`; `ms`. `limit` is the budgets.json target.
- Counts (`summary_tokens`, `page_rows`, `frames`) are judged on any machine: FAIL when any run is over the
  target, else PASS. Every other target is judged by `judgeLimit` with the report's fingerprint (PASS all five
  within; FAIL all five over by more than the margin; INCONCLUSIVE otherwise and off the reference Macs).
- `status` is INVALID if refused, else FAIL if any target fails, else BLOCKED if any is, else INCONCLUSIVE if any
  is, else PASS. A FAIL's `reason` names what each criterion says it names:
  - `settled_p95_ms`: for each failing run, its slowest patch's frame (`frame <n>`) and the nodes that frame ran,
    each operator with its count;
  - `summary_tokens` or `page_rows`: the reply (`summary` or `page`) and its size, rows and tokens (and bytes);
  - `frames`: for a failing run, how many frames it drew and which (`frame <n>` for at least the first);
  - `first_settled_ms`: every pipeline compiled on the first frame in the failing runs.

Numbers in a reason may be printed plain or grouped by threes (`10000`, `10,000`).

## Criteria to tests

IDs are `#854.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed
(scripts/proof-change.mjs `criterionId`). Each test's name starts with its criterion's ID. Where a criterion names a
wrong program, the test runs it through `--planted` and asserts that it fails the way the criterion says, naming
what it says. Each task's recording test also carries `#854.926cdce7`, since it is where a task's timings are seen
to come from a release build.

| ID | Criterion (the issue's text) | Tests, and the wrong programs each fails on |
|---|---|---|
| `#854.ad11ae91` | Patch to settled frame is timed over 200 one-item patches on a 10,000-item board, CPU plus GPU, and fails past 4 ms at p95; a planted scheduler that runs every node on each frame fails, naming the frame and the nodes it ran (was `#854.a24082e8`; holding 4 ms moved to #896, see AC1-MOVE.md) | `budgets.test.ts` (the task and its 4 ms). `patch.test.ts`: the report holds five runs of 200 one-item patches on 10,000 items, each with its own rising frame, CPU and GPU both above 0 and `ms` their sum, `p95_ms` the run's p95, and no frame running as many nodes as the board has items; on a reference Mac the five p95s judged within 4 ms by the design's rule and the lane's judge PASS on the same five; `runs_every_node` runs ≥ 10,000 nodes on every frame, and on a reference Mac is over 4 ms in all five runs by the margin and the lane FAILs, naming each run's slowest frame and every operator it ran with its count; a made-up reading at 9 ms p95 FAILs naming the same, its twin at 1 ms PASSes. Wrong programs: the base; a scheduler that runs every node; a task timing only the CPU or a debug build; a judge that never fails or names nothing |
| `#854.3f8dbc12` | deep_query's summary returns in 20 ms and under 2,000 tokens, and a 1,000-row page in 50 ms; a planted query that returns every row unpaged fails, naming its size | `budgets.test.ts`. `scene-read.test.ts`: the report's tokenizer is the one an agent adapter's facts pin at an exact version; each reply's count lies between one token per byte and one per 16 bytes; every page holds 1,000 rows with a cursor; every summary is under 2,000 tokens; on a reference Mac the five summary times within 20 ms and page times within 50 ms, and the lane PASSes; `unpaged` returns all 10,000 rows with no cursor and the lane FAILs on `page_rows` on any Mac, naming `page`, its rows and its tokens; a made-up 2,437-token summary FAILs naming `summary` and 2,437, its twin PASSes. Wrong programs: the base; the unpaged query; a count by no pinned tokenizer; a judge that never fails or names no size |
| `#854.022ea575` | A still document draws 0 frames and makes at most 1 wakeup a minute over 60 s, under 0.1% of a core; a planted clock that arms a frame each vsync fails, naming the frames it drew | `budgets.test.ts`. `idle.test.ts`: five runs each of at least 60 s on the real clock (the command takes at least 300 s), the window drew the document when it opened, `drawn` lists each frame, `cpu_fraction` is `cpu_ms` over the run, and every run draws 0 frames; on a reference Mac every run's wakeups within 1 and CPU within 0.001 of a core by the design's rule, and the lane PASSes; `arms_each_vsync` draws at least 60 frames a run and the lane FAILs on `frames` on any Mac, naming run 1's count and its first frame; a made-up reading drawing 3 frames FAILs naming them, its twin PASSes. Wrong programs: the base; the vsync clock; a run on the virtual clock or under 60 s; a judge that never fails or names no frames |
| `#854.0393e70f` | A replica reaches its first settled frame in 300 ms from spawn; a planted replica that compiles its pipelines on the first frame fails, naming the pipelines | `budgets.test.ts`. `replica.test.ts`: the report names a fixture file in the checkout; each run is timed from spawn and lists the fixture's pipelines once each, none compiled on the first frame; on a reference Mac the five times within 300 ms and the lane PASSes; `compiles_on_first_frame` marks pipelines (the fixture's) compiled on the first frame in every run, and on a reference Mac is over 300 ms in all five by the margin and the lane FAILs, naming every one; a made-up reading at 700 ms FAILs naming its two first-frame pipelines, its twin at 150 ms PASSes. Wrong programs: the base; the planted replica; a judge that never fails or names none |
| `#854.926cdce7` | Every task's timings come from a release build, and a coefficient file or a perf reading taken from a debug build is refused, naming the profile | The four recording tests require `fingerprint.build.profile` `release` and a `rustc` toolchain. `release.test.ts`: for each task, a made-up reading within every target on a reference Mac's fingerprint is INVALID naming `dev` when marked `dev`, INVALID with `profile: null` when it names no build, and PASSes when marked `release`; then the shipped `deep-show run --costs` on the committed costs.json marked `dev` exits 2 with `costs_refused` naming `dev`, and the same file marked `release` is read. Wrong programs: the base; a judge that judges a debug reading, or refuses every reading; a cost model that reads a debug file |

## Readings where the issue and design leave a choice

- **Record, then judge.** "Each task fails past its target" is the lane's `judge`, as #379 split recording from
  judging; a task exits 0 with its report whatever it measured, so the perf lane's 20 merge-base rounds and its
  50% margin ("compares with the merge base at the perf lane's margin") run on every task as on any other. The
  tests also judge the five runs with their own copy of the design's rule, since the lane's judge is code under
  test, and require the lane's judge to agree on the same numbers.
- **The targets live in budgets.json**, frozen once on main, so no change moves its own target and the judge never
  takes a target from a report.
- **"CPU plus GPU"** is a sample's `cpu_ms + gpu_ms`, from the patch's arrival to its settled frame. "4 ms at p95
  over 200 patches" is each run's nearest-rank p95 over its 200, five runs judged as the design judges a timing.
- **"Naming the frame and the nodes it ran"**: a 10,000-item frame's nodes can't be listed one by one in a
  reason, so they are named by operator with their counts, for each failing run's slowest frame. A one-item patch
  whose frame runs as many nodes as the board has items is the planted scheduler's mark; the shipped frame must
  run fewer.
- **deep_query** has no surface at the base. The tests observe it only through the `scene-read` report: two
  calls, a summary and one page of 1,000 rows with a cursor, each reply's bytes, rows and tokens. A page that
  holds more rows than it was asked for is no page, so `page_rows` ≤ 1,000 is a target; that is how the unpaged
  query fails "naming its size" on any machine, its rows and tokens.
- **The pinned tokenizer** is one adapter's facts' `tokenizer` with an exact version; the report names it. The
  tests can't run the tokenizer, so they bound each count by its reply's bytes (1 to 16 bytes a token).
- **"Under 2,000 tokens", "at most 1 wakeup", "under 0.1% of a core"**: judged within when ≤ the number, as the
  lane's `judgeLimit` judges every limit; the tests' own check of the summary's tokens is strict (< 2,000).
- **Counts are judged anywhere.** Tokens, rows and frames drawn don't move with a machine's load, so they're
  judged on any Mac; wakeups and CPU are readings of the process and gate on the reference Mac like timings.
- **Idle on the real clock.** "For 60 s, with frames drawn, wakeups and CPU read from the process" needs real time,
  so a run is at least 60 s and the tests check the command took at least five minutes. 0 frames is the target
  from the frame clock's Cost; the window drew the document once when it opened, before the minute.
- **The replica's "first settled frame"** is timed from the spawn of a fresh process to that frame, five runs after
  a warm-up one. "Compiles its pipelines on the first frame" is read from each pipeline's `on_first_frame`; the
  shipped replica compiles none there (the meter's rule that pipelines compile off-screen before they're needed,
  with cold start's compiles still counted in its time). The planted replica fails by the 300 ms target on a
  reference Mac, and its failure names the pipelines.
- **"A coefficient file … taken from a debug build is refused"** is #855's cost-model refusal, already at the base;
  it is checked here beside the perf reading's refusal, after it, so the test fails at the base on the judge.
  "Debug build" is Cargo's `dev` profile; a reading naming no profile is refused too (nothing missing passes).
- **Each task's `--release` build** happens inside the task, so the perf lane's command is the release-build
  command; the report's fingerprint is where the tests see it.

Not tested, because no criterion asks or the surface can't reach it: playtest throughput (#184); the merge-base
comparison's own numbers (the perf lane's, unchanged); which binaries each task drives; deep_query beyond its
summary and one page; wakeups and CPU off the reference Macs.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (all five are budgets and rules measured on our own build), so
these tests are the local proof for all five.
