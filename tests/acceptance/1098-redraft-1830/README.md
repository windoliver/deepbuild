# Blind redraft for #1830 of #1098's budgets (AC5)

A redraft of `tests/acceptance/1098/budgets.test.ts`, written blind for #1830. It runs in that file's place: the
same two tests, the same names (with AC5's ID, `#1098.4e407b8b`), the same criterion, the same work and the same
limit. What changes: every timing run reads the one-minute load average (`os.loadavg()[0]`) at its start and at its
end, and the `judgeLimit` call passes those readings as `loads`, one `{ start, end }` per run, in the runs' order, as
the design's timing rule says. The first draft called `judgeLimit` with `limit`, `runs` and `fingerprint` only, so
since #1555 its timing read INCONCLUSIVE on every machine, the reference Macs included; its own check of the load,
read once after the runs, let a loaded PASS through.

It read only:

- issue #1830's body (the dispute) and issue #1098's body (AC5: "Budgets, on the reference Mac in the local
  preflight, compared with the merge base: placing every target of one plan, over a session with 5,000 recorded tool
  results, adds under 20 ms");
- `AGENTS.md`;
- the first draft at the base: `tests/acceptance/1098/budgets.test.ts`, `helpers.ts` and `README.md`;
- `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`);
- `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; The
  reference Macs) and Dogfooding (a disputed test goes to a fresh run of the job that wrote it).

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What the base has

The base is `3557b348` (main). It has #1098's target origins on an authority ask's card, and
`benchmarks/budgets.json` holds `target-origins` (`node benchmarks/asks.mjs target-origins`, which imports the
packages' `dist`). `judgeLimit` there reads INCONCLUSIVE whenever `loads` is missing, malformed, or holds a reading
above the core count (`availableParallelism()`).

## How to run

With Node 24.22 first on `PATH`, from the checkout's root:

```sh
npm ci --no-audit --no-fund              # once, in a fresh worktree
npm run build --workspaces               # once: the perf-lane task's command imports the packages' dist
node node_modules/typescript/bin/tsc -p tests/acceptance/1098-redraft-1830/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1098-redraft-1830 --testTimeout=600000 --no-file-parallelism --reporter=verbose --silent=false
```

The verbose reporter with `--silent=false` prints each timing's readings, loads and verdict; without them an
agent's shell may get only the counts.

The file imports the first draft's `helpers.ts` (unchanged, frozen) for the world, the transcript builder and the
archive step, so the same rules hold: each world is under `/tmp/dh1098-*` and removed afterwards, nothing touches
`~/.deepbuild`, `~/.claude` or `~/.codex`, and only `git` is started. The timing test builds 12 sessions of 5,000
tool results, so it runs alone, as the first draft's file does; putting this folder on `scripts/lanes.mjs`'s `alone`
list and retiring the first draft's file are outside this folder and not done here.

## What each test proves

| Test | What it proves |
|---|---|
| `AC5 #1098.4e407b8b the perf lane has the task target-origins, a #1098 first measurement, valid against the merge base's budgets, and it runs` | `benchmarks/budgets.json` is valid by `validateBudgets` against the merge base's, holds `target-origins` with an `initialReason` naming #1098, and its command exits 0. Not a timing, unchanged. |
| `AC5 #1098.4e407b8b placing every target of one plan, over a session with 5,000 recorded tool results, adds under 20 ms` | Six runs, the first a warm-up. In each, two fresh sessions of 5,000 tool results; an authority ask whose step names eight targets is timed from `raise` to `card` in one, and the same ask with no targets in the other, alternating which goes first; the timed card must place all eight, on any machine. A run's reading is the difference, a negative one counting as 0, and its load is read just before the first timed raise and just after the second. `judgeLimit` at 20 ms with the five loads. |

The verdict is `judgeLimit`'s: PASS passes; FAIL fails, the message holding the five runs, the loads, the machine and
the reason; INCONCLUSIVE, and BLOCKED (five readings that aren't five finite non-negative numbers), print the same
and skip as INCONCLUSIVE with `judgeLimit`'s reason. A skip is never a pass.

## The base run

On the base `3557b348`, after `npm run build --workspaces`, on a Mac17,10 (a reference Mac) on mains power, macOS
26B8119, 18 cores, with other work holding the one-minute load near 255. Type check: clean. Vitest, run once:
1 passed, 1 skipped (46 s).

- `AC5 #1098.4e407b8b the perf lane has the task target-origins, …, and it runs`: **PASS**.
- `AC5 #1098.4e407b8b placing every target of one plan, …, adds under 20 ms`: every timed card placed all eight
  targets; the timing is **INCONCLUSIVE** and skipped:

  ```text
  AC5 placing 8 targets over 5000 tool results adds (ms): 122.41, 6.24, 399.91, 4.65, 225.99 against 20, one-minute
  load at each run's start and end 253.9/253.9, 257.5/257.5, 255.3/255.3, 255.3/255.3, 252.8/252.8, on Mac17,10
  macOS 26B8119: INCONCLUSIVE (a reading, not a budget result: off the reference Macs (Mac15,7 (M3 Pro, 36 GB) or
  Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal state nominal): thermal
  state is "fair", not "nominal"; load 257.54248046875 at a run's start or end is above the 18 cores)
  ```

The readings under that load count neither way. A PASS or FAIL needs a fit reference Mac with every run's load at or
under its core count; that run hasn't been made.
