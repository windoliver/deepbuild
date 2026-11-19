# Blind redraft of #2032's criterion 8: the budget's judge is given each run's load

`ac8-budget.test.ts` here runs in place of `../2032/ac8-budget.test.ts`. It redrafts criterion 8 only
(`AC8 #2032.1a4ae9f6`): "Budget, on the reference Mac in the local preflight: 16 lights and 4,096 occluder segments at
1920 × 1080 cost under 2 ms of GPU time a frame (a target, to be measured)". Criteria 1 to 7 stay with `../2032/`.
Written blind from the issue, the design and base commit `e748313c3`; no implementation was seen and nothing outside
this folder changed. The first draft stays as written.

## Why

Since #1555 `scripts/benchmark.mjs`'s `judgeLimit` reads INCONCLUSIVE unless a call gives `loads`, one `{start, end}`
per run: the one-minute load at that run's start and at its end. The first draft gates on `timingProblem` and judges
through `judge`, both from `../465/helpers.ts`, which call `judgeLimit` with `limit`, `runs` and `fingerprint` only. So
it read INCONCLUSIVE on every machine, the reference Macs included, and could never judge the budget.

## What was read

The issue, live (`gh issue view 2032`); `docs/technical-design.md` (Every task carries its own budgets: the timing
rule; The reference Macs) and `docs/canvas-primitives.md` (Path's `occlude` field; Frame and group's occluding
outlines and the 4,096-segment cap); AGENTS.md; `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`),
`scripts/loads-lint.mjs`, `scripts/lanes.mjs` (`alone`, `timed`, `redrafted`); `../1427-redraft-1830/` and the head of
`../465-redraft-1830/` (the pattern); `../2032/` (README, `helpers.ts`, `ac8-budget.test.ts`) and the helpers it
re-exports from `../2031/`, `../467/` and `../465/` (`films`, `runGpu`, `useBin`, `requireMetal`, `inconclusive`,
`judge`, `timingProblem`).

## The test

Describe and test names are the first draft's, so both start with `AC8 #2032.1a4ae9f6`.

| | Value |
|---|---|
| Fixture | the first draft's, unchanged: 16 point lights on a 4 × 4 grid and 64 closed occluding outlines of 64 corners (4,096 segments) over a 1920 × 1080 white floor; the plain side is the same document with the group's `light` and every `occlude` removed |
| A run | one `deep-gpu run` process playing each side with `film2d` for 120 frames at 60 fps |
| A reading | the shadowed side's median `gpu_ms` less the plain side's, below 0 read as 0 |
| First | a warm-up run with a third side, the shadowed document with `occlude` off: the shadowed side's first frame must hash apart from it. Not judged |
| A run's load | `os.loadavg()[0]` right before the process is spawned and right after it exits |
| Judge | `judgeLimit({ limit: 2, runs, fingerprint: fingerprint(), loads })` on the five runs after the warm-up, imported from `scripts/benchmark.mjs` |

Outcomes: only PASS passes. FAIL fails with a message starting `FAIL:`. INCONCLUSIVE or BLOCKED fails with a message
starting `INCONCLUSIVE:` that carries `judgeLimit`'s reason, the five readings and the five loads. Off macOS, or where
`deep-gpu` answers `unsupported_platform`, it fails `INCONCLUSIVE:`. Every reading is printed with `console.log`.

Wrong programs: the base, where `occlude` isn't read, fails at the hash check; a shadow pass over 2 ms a frame in all
five runs by more than the margin reads FAIL on a fit reference Mac. A loaded run can't pass: INCONCLUSIVE, naming the load.

## Run it

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/2032-redraft-ac8 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/2032-redraft-ac8    # type-check
rm -rf tests/acceptance/2032-redraft-ac8/node_modules/.vite
```

It builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`) and draws on Metal, so it runs alone and under a timed
grant.

## What the implementer adds to `scripts/lanes.mjs`

This job edits nothing outside its folder. The first draft's own two lines stay as `../2032/README.md` gives them.

```js
// #2032's criterion 8, redrafted blind: it builds deep-gpu, draws on Metal and judges the shadows' GPU budget with
// each run's load.
alone.push('tests/acceptance/2032-redraft-ac8/');
timed.push('tests/acceptance/2032-redraft-ac8/ac8-budget.test.ts');
// and, as an entry of the array `redrafted` is built from, so the first draft runs by hand only:
['tests/acceptance/2032/ac8-budget.test.ts', 'tests/acceptance/2032-redraft-ac8/'],
```

## Readings

- **A run**, for the load, is one `deep-gpu run` process with both sides, since one reading comes from it.
- **No gate before the runs.** The first draft stopped before its five runs when `timingProblem` named a problem; that
  helper gives no loads either, so it would stop every machine. Here the five runs are always taken where Metal draws
  and `judgeLimit` alone decides, so an unfit machine spends five runs and reads INCONCLUSIVE with its readings.
- **"Under 2 ms"** is judged by the lane's rule: PASS when all five are within 2 ms, FAIL when all five are over it by
  more than the margin (the larger of 5% and the five runs' spread). A reading of exactly 2 counts as within.
- **BLOCKED** (not five finite readings) is reported as INCONCLUSIVE here, never a pass.
- The debug build is timed, as the first draft times it.

## Not run

Type-check only (`tsc` exits 0). The test was not run and no base failure was recorded by this job: the lead records
the runs. `scripts/loads-lint.mjs` was not run either.
