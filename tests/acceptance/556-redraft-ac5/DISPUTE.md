# Dispute: criterion 5's grid.reach part in the first draft (`556/ac05-budgets.test.ts`)

**The test as written can't pass on a build that keeps the suite's own rule.** Its grid.reach part (lines 80 to 84) runs
`CRAWLER_REACH` from `556/programs.ts`, whose `depths` are `[1, 2]`, over 200 descender runs of 2 steps, and expects
`passed`. A run of 2 steps never generates depth 2. The suite's README (Failures: a depth in `depths` that no run
generated is a failure starting `BLOCKED:`, and the outcome is `missing`) and criterion 1's test (depths `[1, 2, 3, 4]`
read `missing`, naming depth 4) make depth 2 BLOCKED, never PASS. One run on the work (`b8977ed18`) fails there, before
its idle-work and record checks are asserted and before any timing:

```
AssertionError: grid.reach passes over the 200 floors: missing, testsRun 200; failures: [depth 2] BLOCKED: depth 2: 0 runs generated it: expected 'missing' to be 'passed'
```

**The redraft.** A fresh run of the blind job wrote `ac5-budgets.test.ts` in this folder (commit `afcd296f0`, cherry-picked
as `1924c88d0`). It was given the issue, the design, the base with the first suite (`9521772d5`) and criterion 5's
clause. It never saw the work, the diff, the first draft's ac05 file or this dispute. It reads "200 recorded floors" as
200 runs of one step with `depths: [1]`, one floor each at step 0 (its README: Readings). It fails at the base on the
missing `playtest-crawler` record (`BASE-FAILURE.txt`).

On the work (one run, Nov 17, 2026, at `1924c88d0`), every part that doesn't depend on the machine passes:
- the clean crawler with no play interface spends the bake's fuel at all 4,000 steps;
- the record;
- grid.reach over the 200 runs passes: 200 floors, each reached, coverage 200 at depth 1, `search_ms` within the
  check's wall time, and each run played by the descender from its own seed.

It then stops at the perf lane's gate, as it must off a reference Mac at rest:

```
Error: INCONCLUSIVE: the budgets are judged only where the perf lane judges them, on a reference Mac at rest: a reading, not a budget result: off the reference Macs (Mac15,7 (M3 Pro, 36 GB) or Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal state nominal): thermal state is "fair", not "nominal"; load 238.7080078125 at a run's start or end is above the 18 cores; this is not a pass
```

Its five release readings of each timing (part 3) have never run anywhere.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` moves
  `tests/acceptance/556/ac05-budgets.test.ts` to `byHand`, and this folder stays `alone` with its file `timed`. Owed
  with it: the signed approval tag on that lanes commit.
- **A third draft**: name the reading to change (for example, floors from longer runs), and a blind job writes criterion
  5 again on that ruling.

Until then both files stay in the lanes as their commits registered them, and nothing in either draft was edited.
