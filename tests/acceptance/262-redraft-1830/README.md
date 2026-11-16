# Blind redraft for #1830 of #262's budgets (AC18's timings)

A redraft of `tests/acceptance/262/budgets.test.ts`, written blind for #1830. It runs in that file's place: the
same three tests, the same names (with AC18's ID, `#262.7859de09`), the same criterion, the same work and the same
limits. What changes: every timing run reads the one-minute load average (`os.loadavg()[0]`) at its start and at its
end, and every `judgeLimit` call passes those readings as `loads`, one `{ start, end }` per run, in the runs' order,
as the design's timing rule says. The first draft called `judgeLimit` with `limit`, `runs` and `fingerprint` only, so
since #1555 its timings read INCONCLUSIVE on every machine, the reference Macs included. AC18's sizes are judged in
`tests/acceptance/262/day.test.ts`, which calls no `judgeLimit` and isn't redrafted.

It read only:

- issue #1830's body (the dispute) and issue #262's body (AC18: "… a landed batch refreshes its 500 bound values in
  under 1 ms in all; a value at a past log position resolves in under 1 ms at p50, with p95 reported");
- `AGENTS.md`;
- the first draft at the base: `tests/acceptance/262/budgets.test.ts`, `helpers.ts` and `README.md`;
- `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`);
- `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; The
  reference Macs) and Dogfooding (a disputed test goes to a fresh run of the job that wrote it).

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What the base has

The base is `3557b348` (main). It has #262's series sources, `boundValues` with a pinned log position, and
`benchmarks/budgets.json` holds `reading-batch-refresh` and `reading-value-at-position`. `judgeLimit` there reads
INCONCLUSIVE whenever `loads` is missing, malformed, or holds a reading above the core count
(`availableParallelism()`).

## How to run

macOS, the repo's Node (24.22) first on `PATH`, and a shell whose own sandbox is off (the plug-ins run in the platform
sandbox through the supervisor), from the checkout's root:

```sh
npm ci --no-audit --no-fund              # once, in a fresh worktree
node node_modules/typescript/bin/tsc -p tests/acceptance/262-redraft-1830/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/262-redraft-1830 --testTimeout=600000 --no-file-parallelism --reporter=verbose --silent=false
```

The verbose reporter with `--silent=false` prints each timing's readings, loads and verdict; without them an
agent's shell may get only the counts.

The file imports the first draft's `helpers.ts` (unchanged, frozen), which copies its `fixtures/shop` package, so the
same environment rules hold: `HOME` is a temp folder, every package, record and evidence store is under `/tmp/dh262-*`
and removed after the file, every host is closed after the file, `api.metrics.example` is a server on 127.0.0.1
reached only through the test's HTTP client, and nothing is stopped by name or port. It times bound values on the
real clock, so it runs alone, as the first draft's file does; putting this folder on `scripts/lanes.mjs`'s `alone`
list and retiring the first draft's file are outside this folder and not done here.

## What each test proves

| Test | What it proves |
|---|---|
| `AC18 the perf lane has a task for each timing, and the budgets are valid against the merge base's` | `benchmarks/budgets.json` has the two tasks and is valid by `validateBudgets` against the merge base's (`git merge-base HEAD origin/main`); with no merge base it fails BLOCKED. Not a timing, unchanged. |
| `AC18 a landed batch refreshes its 500 bound values in under 1 ms in all (five runs of 20 batches after a warm-up)` | A 500-series source read on demand; a run is 20 batches, each landed by a `readSource` and followed by one timed `boundValues` of the 500 handles, which must all read; the run's reading is the mean. One warm-up run, then five, each with its load read before and after. `judgeLimit` at 1 ms with the five loads. |
| `AC18 a value at a past log position resolves in under 1 ms at p50, with p95 reported (five runs of 200 over 360 batches after a warm-up)` | After 360 batches, a run is 200 timed `boundValues` of one random handle pinned to a random earlier batch's log position, which must read; the run's reading is the p50, and the five runs' p95s are printed. One warm-up run, then five, each with its load read before and after. `judgeLimit` at 1 ms with the five loads. |

The verdict is `judgeLimit`'s: PASS passes; FAIL fails, the message holding the five runs, the loads, the machine and
the reason; INCONCLUSIVE, and BLOCKED (five readings that aren't five finite non-negative numbers), print the same and
skip as INCONCLUSIVE with `judgeLimit`'s reason. The gate stays where the first draft had it, before any work in each
of the two timings: there the test skips as INCONCLUSIVE when this machine can't count a run now. The first draft's
gate called `judgeLimit` on five zero runs with no `loads`, so since #1555 it skipped everywhere; this one gives
`judgeLimit` five empty runs, each with the load read at its start and its end, so it passes on a fit reference Mac
under its core count and names the load otherwise. Past the gate, the five real runs are judged again with their own
loads. A skip is never a pass.

## The base run

On the base `3557b348`, on a Mac17,10 (a reference Mac) on mains power, macOS 26B8119, 18 cores, with other work
holding the one-minute load near 370. Type check: clean. Vitest, run once: 1 passed, 2 skipped (8 s).

- `AC18 the perf lane has a task for each timing, …`: **PASS**.
- `AC18 a landed batch refreshes its 500 bound values in under 1 ms in all …`: **INCONCLUSIVE** at the gate, skipped
  before any work:

  ```text
  AC18 INCONCLUSIVE: a landed batch's refresh not timed: a reading, not a budget result: off the reference Macs
  (Mac15,7 (M3 Pro, 36 GB) or Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off,
  thermal state nominal): thermal state is "fair", not "nominal"; load 373.58056640625 at a run's start or end is
  above the 18 cores
  ```

- `AC18 a value at a past log position resolves in under 1 ms at p50, with p95 reported …`: **INCONCLUSIVE** at the
  gate, the same reason (thermal state fair, load 373.58).

A PASS or FAIL needs a fit reference Mac with every run's load at or under its core count; that run hasn't been made.

An earlier draft of this file, with no gate, was also run once on the base; its timed runs were judged with their
loads and read INCONCLUSIVE, naming the load and the fair thermal state: a landed batch's refresh 1.912, 1.888, 0.186,
0.474, 2.683 ms at loads 274 to 279; a value at a past log position p50 2.605, 1.409, 0.328, 0.666, 1.967 ms (p95
76.815, 47.845, 5.584, 28.279, 53.317 ms) at loads 232 to 235.
