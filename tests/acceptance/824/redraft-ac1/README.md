# Blind redraft of #824 AC1: the hub stays flat over 5,000 cycles

AC1 `#824.5d5b3077`: "Over 5,000 cycles after warm-up, the hub's retained heap grows under 1 MB and its resident memory
under 10 MB, compared with the merge base, on the reference Mac". Written from the issue, the design and base `0466575b`.
It never saw an implementation of #824.

## What it read

- Issue #824 as of October 30, 2026 (Scope, the three criteria, Proof).
- `docs/technical-design.md`: Numbers version 0 has to hold ("Every task carries its own budgets"); Dogfooding; "Speed
  claims name their baseline" (both sides in one run).
- AGENTS.md; `tests/acceptance/27/desktop-redraft`; the fit gate in `tests/acceptance/104/helpers.ts` and `401`;
  `benchmarks/hub.mjs` (the `.deepbuild/ledger.db` path); `scripts/benchmark.mjs` (a first measurement, `INITIAL`);
  `packages/hub/src/core.ts` (event kinds only).
- The benchmark's surface, as the job's brief gave it: `node benchmarks/hub-churn.mjs [--cycles n] [--home dir]
  [--merge-base]`, one JSON line, then a PASS, FAIL or BLOCKED line.

## How to run

Node 24.22 first on `PATH`, on a reference Mac, on mains, at a 1-minute load no higher than its core count:

```sh
npm ci && npm run build --workspaces
npx vitest run --root tests/acceptance/824/redraft-ac1 --no-file-parallelism --disable-console-intercept --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/824/redraft-ac1/tsconfig.json
```

One test, allowed four hours for the benchmark. Its home is a temp folder under `/private/tmp/dh824-*`, removed after.
On a timeout it stops only the benchmark it started, by its PID. Vitest hides a passing test's console output without
`--disable-console-intercept`, and the readings printed there are the issue's Proof, so keep that output. With `--root`
Vitest writes `node_modules/.vite/` in this folder; delete it before committing.

## Expected values

| | Limit over 5,000 cycles | The issue's reading, per 1,000 cycles | Per cycle |
|---|---|---|---|
| Retained heap | under 1 MB (1,000,000 bytes) | under 200 kB | under 200 bytes |
| Resident memory | under 10 MB (10,000,000 bytes) | under 2 MB | under 2,000 bytes |

## Choices, and why

1. **The limit is for the whole 5,000 cycles, not per 1,000.** The issue's reading is growth per 1,000 cycles, and the
   criterion's numbers are "over 5,000 cycles". So 1 MB over the run is 200 kB per 1,000. Reading 1 MB per 1,000 would let
   5 MB through.
2. **Growth is the larger of two figures,** `last - cycle 0` and the median pairwise slope x 5,000 (Theil-Sen, over all
   51 readings). The slope x 1,000 is the issue's reading. Each covers what the other misses: the endpoint sees a step at
   the end that the median slope ignores, and the slope sees a steady leak behind an inflated cycle 0, which makes the
   endpoint small or negative. An ordinary least-squares slope let that second case through at 1.05 MB (one high cycle 0
   pulled it to 0.83 MB), found by the stand-in `inflated-zero`, so the median replaced it. A rise that falls back by the
   end, such as a capped cache, doesn't count: it isn't growth over the run.
3. **"Compared with the merge base" is two conditions.** This side's growth must be under the limit outright, and under it
   above the merge base's growth, same estimator. Difference alone would pass a leak the merge base already has, while the
   issue's title says flat and its motivation is a list growing one entry per cycle. The outright limit is also the only
   number left at a first measurement. The difference isn't clamped: a change that grows 0.75 MB beside a base that shrank
   0.5 MB is 1.25 MB above it. **This can fail on noise** where resident memory swings near the limit; the test doesn't
   retry, and a dispute goes to a redraft.
4. **`mergeBase.initial` counts only where it's true.** The repo's rule for a new benchmark is a first measurement with a
   reason (`scripts/benchmark.mjs`, `INITIAL`). The test accepts it only with a non-empty reason and only where
   `benchmarks/hub-churn.mjs` is absent at the merge base, checked by git; the outright limit still holds. **This is the
   choice most open to question:** the issue's Proof asks for the merge base's readings beside this side's, and the
   merge base's hub exists, so a benchmark able to drive it should give readings. A strict reading would refuse `initial`.
   This test doesn't, since the surface and the repo allow it, and the run prints that it was a first measurement.
5. **The benchmark's verdict is required, and isn't evidence.** The test recomputes growth from the readings (invariant 1).
   It passes only when its own reading is under the limits, the verdict is PASS and the exit is 0. PASS on readings over the
   limit fails and says so; FAIL fails even on flat readings, since the preflight would refuse it; BLOCKED fails as BLOCKED,
   never skips (invariant 2); PASS with a non-zero exit, or FAIL or BLOCKED with exit 0, fails.
6. **The readings must be of a real run.** 51 readings at cycles 0, 100, ... 5,000 on both sides; `cycles` 5000 (from the
   default, as the test passes no `--cycles`), `warmup` 100, `every` 100; byte counts of a plausible size (heap at least
   1 MB, resident at least 10 MB and above heap, which catches a report in kB); resident not constant. The record at
   `--home`'s `.deepbuild/ledger.db` must hold at least 5,100 `session.start`, `session.end`, `ask.answered` and
   `promise.woken` and 51,000 `tool.before`, the issue's cycle. The check run and extension reload aren't counted: the
   design names no event kind this test could rely on.
7. **`--merge-base` is read as "measure the merge base's side too, in this run",** following the design's both sides on
   one machine in one run. `mergeBase.commit` must equal `git merge-base HEAD origin/main`.
8. **MB is decimal,** the issue's word and the stricter reading; "under" is strict.
9. **One run, not five.** The design's five-run rule is for timing results, and five runs would take far past the four
   hours. The 51 readings are the repeats. A single run's noise therefore can decide it.
10. **Fit gate:** reference Mac (Mac15,7 or Mac15,12, chip and memory), mains, Low Power Mode off, thermal nominal, load
    no higher than its core count, checked before and after the run; otherwise the test skips as `INCONCLUSIVE`, printing
    any readings. A missing benchmark fails first, on any machine, so the base failure is an assertion.

## Requirement → test

| Requirement | Where |
|---|---|
| Heap under 1 MB, resident under 10 MB, over 5,000 cycles after warm-up | The one test, `growth`, cycle 0 baseline |
| Compared with the merge base | `mergeBase` checks, difference against its growth |
| On the reference Mac | `environmentProblem`, before and after |
| PASS only when it's so; BLOCKED never passes | The verdict checks |

AC2 (planted leaks) and AC3 (no open sockets, timers or children) aren't in this redraft.

## Proof of the test, and what wasn't run

`BASE-FAILURE.txt` has the assertion failure at the base and the reader's results against scratch stand-ins, never
committed. **Never run: a real benchmark, a real hub, the 5,000 cycles, and the record query against a ledger with
events.** The stand-ins replaced the benchmark, `git`, the record and the fit gate. A wrong program for the before lane
beyond the merge base is the implementer's planted twin (AC2's leaks).

## Files

- `budgets.long.test.ts`: the test. `tsconfig.json`: the root options with `noEmit`. `BASE-FAILURE.txt`: the runs above.
